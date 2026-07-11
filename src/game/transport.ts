import {
    Scene, Mesh, Vector3, Matrix4,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE, HOUSE_R } from './constants';
import { Resource, formatScaled } from './resource';
import { Structure } from './structure';
import { arcLengthM, isSameStructureNormal } from './geo';
import { TransportRequest } from './transportRequest';

// Returns the surface normal of the structure that can PROVIDE `resource`
// (InventoryRole 'output' or 'both') closest to `destNormal`, or null if none.
// The destination itself is excluded so a structure that is also a provider
// (e.g. Homebase with role 'both') can't select itself and collapse the haul to ~0.
export function resolveSource(
    resource:   Resource,
    structures: Structure[],
    destNormal: Vector3,
): Vector3 | null {
    const isDest = (s: Structure) => isSameStructureNormal(s.surfaceNormal, destNormal);

    // Prefer dedicated output providers (ResourceNode, OilWell, Refinery, PowerPlant).
    // 'both'-role structures (Homebase) are only fallback so a truck never collects from itself.
    const outputs = structures.filter(s =>
        s.getResourceRole(resource) === 'output' && !isDest(s),
    );
    const fallback = structures.filter(s =>
        s.getResourceRole(resource) === 'both' && !isDest(s),
    );
    const providers = outputs.length ? outputs : fallback;

    if (!providers.length) return null;
    let best = providers[0];
    let bestDot = destNormal.dot(best.surfaceNormal);
    for (let i = 1; i < providers.length; i++) {
        const d = destNormal.dot(providers[i].surfaceNormal);
        if (d > bestDot) { best = providers[i]; bestDot = d; }
    }
    return best.surfaceNormal.clone();
}

// ─── Serialization ────────────────────────────────────────────────────────────
// Transports are stateless pool members: they persist only their vehicle type,
// fuel choice, and parked location. Active jobs are transient (re-dispatched on
// load), so they are never serialized.

export interface TransportSave {
    type:         string;
    fuelResource: string;
    // current (parked) surface normal
    cnx?: number; cny?: number; cnz?: number;
    // legacy v7 fields — destination normal, used as parked location on migration
    hnx?: number; hny?: number; hnz?: number;
}

// ─── Spec ─────────────────────────────────────────────────────────────────────

export class TransportSpec {
    constructor(
        readonly name:         string,
        readonly maxSpeed:     number,   // m/s
        readonly acceleration: number,   // m/s²
        readonly height:       number,   // m — used for surface rise
        readonly width:        number,   // m — used for lane offset
        readonly length:       number,   // m — vehicle body length
        readonly pauseTime:    number,   // s parked at each endpoint
        readonly payloadKg:    number,   // kg delivered per trip

        // ── Fuel physics ──────────────────────────────────────────────────────
        // Reference: loaded semi at 6 mpg US highway
        //   → 39.2 L/100 km, diesel density 0.832 kg/L, LHV 42.8 MJ/kg
        readonly fuelLPer100km:     number,  // diesel-equivalent L/100 km
        readonly fuelRefDensityKgL: number,  // reference fuel density (kg/L)
        readonly fuelRefEnergyMJkg: number,  // reference fuel energy density (MJ/kg LHV)
    ) {}

    /**
     * Mass of a given fuel resource consumed to travel `distanceKm` km.
     * Converts via diesel-equivalent energy: diesel_mass → MJ → kg of alt fuel.
     */
    fuelKgForKm(distanceKm: number, fuel: Resource): number {
        const dieselKg = (this.fuelLPer100km / 100) * distanceKm * this.fuelRefDensityKgL;
        const energyMJ = dieselKg * this.fuelRefEnergyMJkg;
        return energyMJ / fuel.energyDensityMJkg;
    }

    /** Time in seconds to drive `distM` metres from rest to rest (trapezoid/triangle). */
    travelSec(distM: number): number {
        const a = this.acceleration, v = this.maxSpeed;
        const L = Math.max(distM, 0);
        if (L <= 0) return 0;
        const dAccel = (v * v) / (2 * a);
        if (L > 2 * dAccel) {
            const tAccel  = v / a;
            const tCruise = (L - 2 * dAccel) / v;
            return 2 * tAccel + tCruise;
        }
        return 2 * Math.sqrt(L / a);   // triangular profile, peak below cruise speed
    }
}

// ─── Job ────────────────────────────────────────────────────────────────────

type JobPhase = 'to_source' | 'load' | 'to_dest' | 'unload';

interface Job {
    request:  TransportRequest;
    source:   Vector3;    // source surface normal
    payload:  number;     // planned kg this trip (reserved in request.qtyInFlight)
    loaded:   number;     // actual kg mined at source (may be < payload if deposit ran low)
    fuelKg:   number;     // fuel burned this trip (start→source→dest distance)
    phase:    JobPhase;
}

// Result of a single update() step — index applies the inventory side-effects.
export interface TransportTick {
    // The truck finished loading at the source this step: index should mine the
    // deposit and report back the actual amount via setLoaded().
    load?:    { resource: Resource; payload: number };
    // The truck reached its destination this step (job already cleared).
    deliver?: { request: TransportRequest; resource: Resource; loaded: number; payload: number; fuelKg: number };
}

let _nextId = 1;

export abstract class Transport {
    abstract readonly spec: TransportSpec;
    protected abstract makeMesh(): Mesh;
    protected abstract makeHitMesh(): Mesh;

    readonly id: number = _nextId++;
    readonly mesh: Mesh;
    readonly hitMesh: Mesh;
    readonly fuelResource: Resource;

    // Where the truck sits when idle / the origin of its current leg.
    protected currentNormal: Vector3;
    protected job: Job | null = null;

    // Current leg kinematics (from → to over arcLength metres).
    protected legFrom:   Vector3;
    protected legTo:     Vector3;
    protected arcLength = 0.01;
    protected t         = 0;   // 0→1 along current leg
    protected speed     = 0;   // m/s
    protected pauseTimer = 0;

    // ── Accessors ───────────────────────────────────────────────────────────
    get isIdle():          boolean          { return this.job === null; }
    get servingRequest():  TransportRequest | null { return this.job?.request ?? null; }
    get sourceResource():  Resource | null  { return this.job?.request.resource ?? null; }
    get parkedNormal():    Vector3          { return this.currentNormal; }
    get srcNormal():       Vector3          { return this.job ? this.job.source : this.currentNormal; }
    get destinationNormal(): Vector3        { return this.job ? this.job.request.destNormal : this.currentNormal; }
    get destinationName():   string         { return this.job ? this.job.request.destName : 'idle'; }
    get jobPhase():        string           { return this.job ? this.job.phase : 'idle'; }
    // Planned kg reserved on the current job (the load this trip will deliver).
    get plannedPayloadKg(): number          { return this.job?.payload ?? 0; }
    get currentSpeed():    number           { return this.speed; }
    get legArcM():         number           { return this.arcLength; }

    constructor(
        protected scene: Scene,
        fuelResource:    Resource,
        currentNormal:   Vector3,
    ) {
        this.fuelResource  = fuelResource;
        this.currentNormal = currentNormal.clone().normalize();
        this.legFrom       = this.currentNormal.clone();
        this.legTo         = this.currentNormal.clone();

        this.mesh = this.makeMesh();
        this.mesh.userData['transport'] = this;
        scene.add(this.mesh);

        this.hitMesh = this.makeHitMesh();
        this.hitMesh.userData['transport'] = this;
        this.hitMesh.visible = false;
        scene.add(this.hitMesh);
        // _placeMesh deferred to first update()/park() so derived-class spec is ready.
    }

    // Park visually at the current (idle) location. Called once spec is available.
    park(): void {
        this._placeMesh(this.currentNormal, this.currentNormal);
    }

    getStatsLines(): string[] {
        if (!this.job) {
            return [`${this.spec.name} #${this.id}`, 'Idle — awaiting request'];
        }
        const j = this.job;
        const res = j.request.resource;
        const phaseLabel: Record<JobPhase, string> = {
            to_source: `→ pick up ${res.name}`,
            load:      `Loading ${res.name}`,
            to_dest:   `→ ${j.request.destName}`,
            unload:    `Unloading at ${j.request.destName}`,
        };
        return [
            `${this.spec.name} #${this.id}`,
            `Cargo: ${formatScaled(j.payload, 'kg')} ${res.name}`,
            `Fuel: ${this.fuelResource.name}  ${j.fuelKg.toFixed(3)} kg/trip`,
            phaseLabel[j.phase],
        ];
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    // Fuel (kg of this truck's fuel) burned on a round trip: park → source → dest.
    // Single source of truth for the trip-cost model, shared by the dispatcher's
    // affordability checks and assignJob.
    tripFuelKg(source: Vector3, destNormal: Vector3): number {
        const km = (arcLengthM(this.currentNormal, source) + arcLengthM(source, destNormal)) / 1000;
        return this.spec.fuelKgForKm(km, this.fuelResource);
    }

    // Can this truck afford the fuel for that trip right now?
    canAfford(source: Vector3, destNormal: Vector3): boolean {
        return this.fuelResource.gathered >= this.tripFuelKg(source, destNormal);
    }

    // Estimated seconds to reach the destination: drive park→source, pause, drive
    // source→dest. Used by the dispatcher to rank candidate jobs.
    tripEtaSec(source: Vector3, destNormal: Vector3): number {
        return this.spec.travelSec(arcLengthM(this.currentNormal, source))
             + this.spec.pauseTime
             + this.spec.travelSec(arcLengthM(source, destNormal));
    }

    // Assign a haul job: drive to `sourceNormal`, load, deliver to the request's
    // destination, then go idle. Reserves the planned payload on the request.
    assignJob(request: TransportRequest, sourceNormal: Vector3): void {
        const payload = Math.max(0, Math.min(this.spec.payloadKg, request.remaining));
        request.qtyInFlight += payload;

        this.job = {
            request,
            source:   sourceNormal.clone(),
            payload,
            loaded:   0,
            fuelKg:   this.tripFuelKg(sourceNormal, request.destNormal),
            phase:    'to_source',
        };
        this._startLeg(this.currentNormal, sourceNormal);
    }

    // Record how much was actually mined at the source (set after the 'load' tick)
    // and reconcile the reservation to it. When the source was short (kg < the
    // planned payload), the unfulfilled part of the reservation is released NOW —
    // not at delivery — so `request.remaining` and the job board reflect the real
    // cargo in transit instead of the optimistic full-truckload reservation.
    setLoaded(kg: number): void {
        if (!this.job) return;
        const shortfall = this.job.payload - kg;
        if (shortfall > 0) {
            this.job.request.qtyInFlight = Math.max(0, this.job.request.qtyInFlight - shortfall);
            this.job.payload = kg;   // reservation + reported cargo now match what was loaded
        }
        this.job.loaded = kg;
    }

    // Abort the current job (e.g. source deposit exhausted) and go idle where it stands.
    abortJob(): void {
        if (!this.job) return;
        this.job.request.qtyInFlight = Math.max(0, this.job.request.qtyInFlight - this.job.payload);
        this.currentNormal = this.job.source.clone();
        this.job = null;
        this.park();
    }

    // Called when a request is cancelled while this truck is serving it.
    cancelIfServing(request: TransportRequest): boolean {
        if (this.job && this.job.request === request) { this.abortJob(); return true; }
        return false;
    }

    update(dt: number): TransportTick {
        if (!this.job) return {};
        const job = this.job;

        switch (job.phase) {
            case 'to_source':
                if (this._advance(dt)) {
                    job.phase       = 'load';
                    this.pauseTimer = this.spec.pauseTime;
                }
                this._placeMesh(this.legFrom, this.legTo);
                break;

            case 'load':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    this._startLeg(job.source, job.request.destNormal);
                    job.phase = 'to_dest';
                    return { load: { resource: job.request.resource, payload: job.payload } };
                }
                break;

            case 'to_dest':
                if (this._advance(dt)) {
                    job.phase       = 'unload';
                    this.pauseTimer = this.spec.pauseTime;
                }
                this._placeMesh(this.legFrom, this.legTo);
                break;

            case 'unload':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    const deliver = {
                        request:  job.request,
                        resource: job.request.resource,
                        loaded:   job.loaded,
                        payload:  job.payload,
                        fuelKg:   job.fuelKg,
                    };
                    this.currentNormal = job.request.destNormal.clone();
                    this.job = null;
                    this.park();
                    return { deliver };
                }
                break;
        }
        return {};
    }

    dispose(): void { this.scene.remove(this.mesh); this.scene.remove(this.hitMesh); }

    toJSON(): TransportSave {
        return {
            type:         this.constructor.name,
            fuelResource: this.fuelResource.name,
            cnx: this.currentNormal.x,
            cny: this.currentNormal.y,
            cnz: this.currentNormal.z,
        };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _startLeg(from: Vector3, to: Vector3): void {
        this.legFrom   = from.clone();
        this.legTo     = to.clone();
        this.arcLength = Math.max(arcLengthM(from, to), 0.01);
        this.t         = 0;
        this.speed     = 0;
        this._placeMesh(this.legFrom, this.legTo);
    }

    private _advance(dt: number): boolean {
        const { maxSpeed, acceleration } = this.spec;
        const L = this.arcLength;

        const remaining = (1 - this.t) * L;
        const stopDist  = (this.speed * this.speed) / (2 * acceleration);

        if (stopDist >= remaining) {
            this.speed = Math.max(0, this.speed - acceleration * dt);
        } else {
            this.speed = Math.min(maxSpeed, this.speed + acceleration * dt);
        }

        this.t = Math.min(1, this.t + (this.speed * dt) / L);
        return this.t >= 1;
    }

    // Keep-right lane separation: outbound and inbound trucks stay on opposite sides
    // because from/to swap on the return leg, flipping the right vector.
    protected _placeMesh(from: Vector3, to: Vector3): void {
        const n = from.clone().lerp(to, this.t).normalize();

        // Great-circle tangent via rotation axis. axis = from × to is perpendicular
        // to the orbital plane; fwd = axis × n is the planar tangent at n pointing
        // toward `to`. Robust for any non-zero arc.
        const axis = new Vector3().crossVectors(from, to);
        if (axis.lengthSq() < 1e-20) axis.set(0, 0, 1);   // from ≈ ±to: zero-arc, parked
        axis.normalize();
        const fwd = new Vector3().crossVectors(axis, n).normalize();
        const right = new Vector3().crossVectors(n, fwd).normalize();

        // Lane offset clears the homebase cylinder (radius HOUSE_R=6m).
        const laneOffset = (HOUSE_R + this.spec.width) * 0.25;
        this.mesh.position
            .copy(n).multiplyScalar(R + this.spec.height / 2 + SURFACE_RISE)
            .addScaledVector(right, laneOffset);

        // Orient without reading parent world matrix (scene shifts each frame for precision).
        // Local X = right (truck width), local Y = n (up from surface), local Z = fwd (travel axis).
        this.mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, n, fwd));

        this.hitMesh.position.copy(this.mesh.position);
        this.hitMesh.quaternion.copy(this.mesh.quaternion);
    }
}

// ─── Truck ────────────────────────────────────────────────────────────────────

export class TruckTransport extends Transport {
    // Iron cost = tare weight of an empty 18-wheeler (~15 t)
    static readonly IRON_COST = 15_000;

    // Physics-grounded spec:
    //   6 mpg US highway → 39.2 L/100 km
    //   diesel: 0.832 kg/L, 42.8 MJ/kg LHV
    //   payload: US GVW 80 klb − 35 klb tare ≈ 20,000 kg
    static readonly SPEC = new TransportSpec(
        'Truck',
        25,        // maxSpeed m/s  (~90 km/h)
        0.5,       // acceleration m/s²
        4.1,       // height m
        2.6,       // width m
        11.0,      // length m
        3.0,       // pauseTime s
        20_000,    // payloadKg
        39.2,      // fuelLPer100km
        0.832,     // fuelRefDensityKgL  (diesel)
        42.8,      // fuelRefEnergyMJkg  (diesel LHV)
    );

    readonly spec: TransportSpec = TruckTransport.SPEC;

    constructor(scene: Scene, fuelResource: Resource, currentNormal: Vector3) {
        super(scene, fuelResource, currentNormal);
        // Subclass `spec` field is initialized by now, so _placeMesh is safe.
        this.park();
    }

    protected makeMesh(): Mesh {
        return new Mesh(
            new BoxGeometry(2.6, 4.1, 11),
            new MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.2, roughness: 0.6 }),
        );
    }

    protected makeHitMesh(): Mesh {
        return new Mesh(
            new BoxGeometry(2.6 * 6, 4.1, 11 * 3),
            new MeshBasicMaterial({ visible: false }),
        );
    }

    static fromJSON(
        save:       TransportSave,
        scene:      Scene,
        resources:  Resource[],
        homeNormal: Vector3,
    ): TruckTransport {
        const fuel = resources.find(r => r.name === save.fuelResource) ?? resources[0];
        // Parked location: prefer saved current normal, fall back to legacy dest
        // normal, then the home base.
        const parked = (save.cnx !== undefined)
            ? new Vector3(save.cnx, save.cny!, save.cnz!)
            : (save.hnx !== undefined)
                ? new Vector3(save.hnx, save.hny!, save.hnz!)
                : homeNormal;
        return new TruckTransport(scene, fuel, parked);
    }
}
