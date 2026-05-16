import {
    Scene, Mesh, Vector3, Matrix4,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE, HOUSE_R } from './constants';
import { Resource, formatScaled } from './resource';
import { Structure } from './structure';
import { arcLengthM, isSameStructureNormal } from './geo';

// Returns the surface normal of the closest structure that can PROVIDE `resource`
// (InventoryRole 'output' or 'both') nearest to `fromNormal`.
// `destNormal` is the destination's surface normal — excluded so a destination
// that is also a provider (e.g. Homebase with role 'both') cannot select itself
// as the source, which would collapse arcLength to ~0 and freeze the truck.
export function resolveSourceNormal(
    resource:   Resource,
    structures: Structure[],
    fromNormal: Vector3,
    destNormal?: Vector3,
): Vector3 {
    const isDest = (s: Structure) =>
        !!destNormal && isSameStructureNormal(s.surfaceNormal, destNormal);

    // Prefer dedicated output providers (ResourceNode, OilWell, Refinery, PowerPlant).
    // 'both'-role structures (Homebase) are only fallback so a truck never collects from itself.
    const outputs = structures.filter(s =>
        s.getResourceRole(resource) === 'output' && !isDest(s),
    );
    const fallback = structures.filter(s =>
        s.getResourceRole(resource) === 'both' && !isDest(s),
    );
    const providers = outputs.length ? outputs : fallback;

    if (!providers.length) return fromNormal.clone();
    let best = providers[0];
    let bestDot = fromNormal.dot(best.surfaceNormal);
    for (let i = 1; i < providers.length; i++) {
        const d = fromNormal.dot(providers[i].surfaceNormal);
        if (d > bestDot) { best = providers[i]; bestDot = d; }
    }
    return best.surfaceNormal.clone();
}

// ─── Serialization ────────────────────────────────────────────────────────────

export interface TransportSave {
    type:           string;
    sourceResource: string;
    fuelResource:   string;
    state:          string;
    t:              number;
    speed:          number;
    pauseTimer:     number;
    stopped:        boolean;
    // destination surface normal (optional for backward compat; falls back to homeNormal passed at load time)
    hnx?: number; hny?: number; hnz?: number;
    destName?: string;
    // source surface normal (optional for backward compat; falls back to resource hitMesh position)
    snx?: number; sny?: number; snz?: number;
    // ms epoch when the truck was built. Used to derive cycle position on load.
    buildTime?: number;
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
     * Mass of a given fuel resource consumed for a two-way trip of `distanceKm` km.
     * Converts via diesel-equivalent energy: diesel_mass → MJ → kg of alt fuel.
     */
    fuelKgForRoundTripKm(distanceKm: number, fuel: Resource): number {
        const dieselKg = (this.fuelLPer100km / 100) * distanceKm * this.fuelRefDensityKgL;
        const energyMJ = dieselKg * this.fuelRefEnergyMJkg;
        return energyMJ / fuel.energyDensityMJkg;
    }
}

// ─── Base ─────────────────────────────────────────────────────────────────────

type TripState = 'to_resource' | 'pause_at_resource' | 'to_home' | 'pause_at_home';

let _nextId = 1;

export abstract class Transport {
    abstract readonly spec: TransportSpec;
    protected abstract makeMesh(): Mesh;
    protected abstract makeHitMesh(): Mesh;

    readonly id: number = _nextId++;
    readonly mesh: Mesh;
    readonly hitMesh: Mesh;
    sourceResource: Resource;
    readonly fuelResource:  Resource;

    stopped = false;

    buildTime = Date.now();   // ms epoch — used to derive cycle position on load

    protected state:      TripState = 'to_resource';
    protected t           = 0;     // 0→1 along current arc segment
    protected speed       = 0;     // m/s
    protected pauseTimer  = 0;

    protected homeNormal:   Vector3;
    protected sourceNormal: Vector3;
    protected arcLength:    number;   // metres, source pad → destination
    protected destName:     string;

    get destinationNormal(): Vector3 { return this.homeNormal; }
    get destinationName():   string  { return this.destName; }
    get srcNormal():         Vector3 { return this.sourceNormal; }

    // Debug accessors
    get tripState():      TripState { return this.state; }
    get tripT():          number    { return this.t; }
    get currentSpeed():   number    { return this.speed; }
    get pauseRemaining(): number    { return this.pauseTimer; }
    get arcLengthM():     number    { return this.arcLength; }

    resolveDestName(structures: Structure[]): string {
        const match = structures.find(s => isSameStructureNormal(s.surfaceNormal, this.homeNormal));
        return match ? match.label : this.destName;
    }

    constructor(
        protected scene: Scene,
        homeNormal:      Vector3,
        sourceResource:  Resource,
        fuelResource:    Resource,
        sourceNormal:    Vector3,
        destName         = 'Homebase',
    ) {
        this.homeNormal     = homeNormal.clone();
        this.sourceNormal   = sourceNormal.clone();
        this.sourceResource = sourceResource;
        this.fuelResource   = fuelResource;
        this.destName       = destName;

        this.arcLength = Math.max(arcLengthM(this.homeNormal, this.sourceNormal), 0.01);

        this.mesh = this.makeMesh();
        this.mesh.userData['transport'] = this;
        scene.add(this.mesh);

        this.hitMesh = this.makeHitMesh();
        this.hitMesh.userData['transport'] = this;
        this.hitMesh.visible = false;
        scene.add(this.hitMesh);
        // _placeMesh deferred to first update() so derived-class field
        // initializers (spec) finish before this.spec.height/width are read.
    }

    // Fuel mass consumed per completed round trip for this route.
    get fuelKgPerRoundTrip(): number {
        return this.spec.fuelKgForRoundTripKm(
            (this.arcLength * 2) / 1000,
            this.fuelResource,
        );
    }

    getStatsLines(): string[] {
        const cargoLabel = (this.state === 'to_home' || this.state === 'pause_at_home')
            ? `${formatScaled(this.spec.payloadKg, 'kg')} ${this.sourceResource.name}`
            : 'Empty';

        const stateLabel: Record<string, string> = {
            to_resource:       `→ ${this.sourceResource.name}`,
            pause_at_resource: `Loading ${this.sourceResource.name}`,
            to_home:           `← ${this.destName}`,
            pause_at_home:     'Unloading',
        };

        return [
            `${this.spec.name} #${this.id}`,
            `Cargo: ${cargoLabel}`,
            `Fuel: ${this.fuelResource.name}  ${this.fuelKgPerRoundTrip.toFixed(3)} kg/trip`,
            stateLabel[this.state] ?? '',
        ];
    }

    update(dt: number): { pickup: boolean; fuelConsumed: boolean } {
        if (this.stopped) return { pickup: false, fuelConsumed: false };

        let pickup = false, fuelConsumed = false;

        switch (this.state) {
            case 'to_resource':
                if (this._advance(dt)) {
                    this.state      = 'pause_at_resource';
                    this.pauseTimer = this.spec.pauseTime;
                }
                this._placeMesh(this.homeNormal, this.sourceNormal);
                break;

            case 'pause_at_resource':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    pickup     = true;
                    this.t     = 0;
                    this.speed = 0;
                    this.state = 'to_home';
                }
                break;

            case 'to_home':
                if (this._advance(dt)) {
                    this.state      = 'pause_at_home';
                    this.pauseTimer = this.spec.pauseTime;
                }
                this._placeMesh(this.sourceNormal, this.homeNormal);
                break;

            case 'pause_at_home':
                this.pauseTimer -= dt;
                if (this.pauseTimer <= 0) {
                    fuelConsumed = true;
                    this.t     = 0;
                    this.speed = 0;
                    this.state = 'to_resource';
                }
                break;
        }

        return { pickup, fuelConsumed };
    }

    // Spread trucks evenly across the round-trip cycle so they don't overlap.
    // fraction ∈ [0, 1): 0→0.5 = outbound, 0.5→1 = return leg.
    stagger(fraction: number): void {
        if (fraction < 0.5) {
            this.state = 'to_resource';
            this.t     = fraction * 2;
            this._placeMesh(this.homeNormal, this.sourceNormal);
        } else {
            this.state = 'to_home';
            this.t     = (fraction - 0.5) * 2;
            this._placeMesh(this.sourceNormal, this.homeNormal);
        }
        this.speed      = 0;
        this.pauseTimer = 0;
    }

    // Change the resource this transport collects and resume operation.
    // If structures is provided, routes to the closest structure providing the resource.
    reassign(source: Resource, structures: Structure[]): void {
        this.sourceResource = source;
        this.sourceNormal   = resolveSourceNormal(source, structures, this.homeNormal, this.homeNormal);
        this.arcLength = Math.max(arcLengthM(this.homeNormal, this.sourceNormal), 0.01);
        this.stopped    = false;
        this.state      = 'to_resource';
        this.t          = 0;
        this.speed      = 0;
        this.pauseTimer = 0;
    }

    // Reassign both destination and source; routes to the closest structure providing the resource.
    reassignRoute(destNormal: Vector3, destName: string, source: Resource, structures: Structure[]): void {
        this.homeNormal     = destNormal.clone();
        this.destName       = destName;
        this.sourceResource = source;
        this.sourceNormal   = resolveSourceNormal(source, structures, destNormal, destNormal);
        this.arcLength = Math.max(arcLengthM(this.homeNormal, this.sourceNormal), 0.01);
        this.stopped    = false;
        this.state      = 'to_resource';
        this.t          = 0;
        this.speed      = 0;
        this.pauseTimer = 0;
    }

    dispose(): void { this.scene.remove(this.mesh); }

    toJSON(): TransportSave {
        return {
            type:           this.constructor.name,
            sourceResource: this.sourceResource.name,
            fuelResource:   this.fuelResource.name,
            state:          this.state,
            t:              this.t,
            speed:          this.speed,
            pauseTimer:     this.pauseTimer,
            stopped:        this.stopped,
            hnx: this.homeNormal.x,
            hny: this.homeNormal.y,
            hnz: this.homeNormal.z,
            destName: this.destName,
            snx: this.sourceNormal.x,
            sny: this.sourceNormal.y,
            snz: this.sourceNormal.z,
            buildTime: this.buildTime,
        };
    }

    restoreFrom(save: TransportSave): void {
        this.stopped = save.stopped ?? false;
        if (save.destName) this.destName = save.destName;

        if (this.stopped) {
            this.parkAtHome();
            return;
        }

        if (typeof save.buildTime === 'number') {
            // Recompute cycle position from elapsed wall-clock since the truck was built.
            this.buildTime = save.buildTime;
            const elapsedSec = (Date.now() - this.buildTime) / 1000;
            this.setFromCyclePosition(elapsedSec);
            return;
        }

        // Legacy save: restore raw state fields.
        this.state      = save.state as TripState;
        this.t          = save.t;
        this.speed      = save.speed;
        this.pauseTimer = save.pauseTimer;
        if (this.state === 'to_resource' || this.state === 'pause_at_resource') {
            this._placeMesh(this.homeNormal, this.sourceNormal);
        } else {
            this._placeMesh(this.sourceNormal, this.homeNormal);
        }
    }

    // Trapezoid/triangle kinematics: distance + speed at trip-elapsed τ.
    private _trip(): { tripTime: number; trapezoid: boolean; tAccel: number; tCruise: number; dAccel: number } {
        const a = this.spec.acceleration;
        const v = this.spec.maxSpeed;
        const L = this.arcLength;
        const dAccel = (v * v) / (2 * a);
        if (L > 2 * dAccel) {
            const tAccel  = v / a;
            const tCruise = (L - 2 * dAccel) / v;
            return { tripTime: 2 * tAccel + tCruise, trapezoid: true, tAccel, tCruise, dAccel };
        }
        const vPeak = Math.sqrt(a * L);
        const tHalf = vPeak / a;
        return { tripTime: 2 * tHalf, trapezoid: false, tAccel: tHalf, tCruise: 0, dAccel: L / 2 };
    }

    private _positionInTrip(tau: number): { t: number; speed: number } {
        const a = this.spec.acceleration;
        const v = this.spec.maxSpeed;
        const L = this.arcLength;
        const trip = this._trip();
        tau = Math.max(0, Math.min(trip.tripTime, tau));
        let d: number, sp: number;
        if (trip.trapezoid) {
            if (tau < trip.tAccel)                       { d = 0.5 * a * tau * tau;                                 sp = a * tau; }
            else if (tau < trip.tAccel + trip.tCruise)   { d = trip.dAccel + v * (tau - trip.tAccel);               sp = v; }
            else { const taup = trip.tripTime - tau;       d = L - 0.5 * a * taup * taup;                            sp = a * taup; }
        } else {
            const tHalf = trip.tripTime / 2;
            if (tau < tHalf)                              { d = 0.5 * a * tau * tau;                                 sp = a * tau; }
            else { const taup = trip.tripTime - tau;       d = L - 0.5 * a * taup * taup;                            sp = a * taup; }
        }
        return { t: Math.max(0, Math.min(1, d / L)), speed: sp };
    }

    // Park at home — used when stopped (no fuel / source exhausted). Idle visual.
    parkAtHome(): void {
        this.state      = 'pause_at_home';
        this.t          = 1;
        this.speed      = 0;
        this.pauseTimer = 0;
        this._placeMesh(this.sourceNormal, this.homeNormal);
    }

    setFromCyclePosition(elapsedSec: number): void {
        const trip  = this._trip().tripTime;
        const pause = this.spec.pauseTime;
        const cycle = 2 * trip + 2 * pause;
        if (cycle <= 0) return;
        let p = elapsedSec % cycle;
        if (p < 0) p += cycle;

        if (p < trip) {
            this.state = 'to_resource';
            const { t, speed } = this._positionInTrip(p);
            this.t = t; this.speed = speed; this.pauseTimer = 0;
            this._placeMesh(this.homeNormal, this.sourceNormal);
        } else if (p < trip + pause) {
            this.state = 'pause_at_resource';
            this.t = 1; this.speed = 0;
            this.pauseTimer = Math.max(0, pause - (p - trip));
            this._placeMesh(this.homeNormal, this.sourceNormal);
        } else if (p < 2 * trip + pause) {
            this.state = 'to_home';
            const tau = p - trip - pause;
            const { t, speed } = this._positionInTrip(tau);
            this.t = t; this.speed = speed; this.pauseTimer = 0;
            this._placeMesh(this.sourceNormal, this.homeNormal);
        } else {
            this.state = 'pause_at_home';
            this.t = 1; this.speed = 0;
            this.pauseTimer = Math.max(0, pause - (p - 2 * trip - pause));
            this._placeMesh(this.sourceNormal, this.homeNormal);
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
    // because from/to are swapped on the return leg, flipping the right vector.
    protected _placeMesh(from: Vector3, to: Vector3): void {
        const n = from.clone().lerp(to, this.t).normalize();

        // Great-circle tangent via rotation axis. axis = from × to is perpendicular
        // to the orbital plane; fwd = axis × n is the planar tangent at n pointing
        // toward `to`. Robust for any non-zero arc — the prior project-and-clamp
        // approach degenerated for sub-metre arcs (|fwd|² ~ θ²) and produced a
        // garbage quaternion, leaving the truck pointed straight up.
        const axis = new Vector3().crossVectors(from, to);
        if (axis.lengthSq() < 1e-20) axis.set(0, 0, 1);   // from ≈ ±to: zero-arc, won't render motion
        axis.normalize();
        const fwd = new Vector3().crossVectors(axis, n).normalize();
        const right = new Vector3().crossVectors(n, fwd).normalize();

        // Lane offset clears the homebase cylinder (radius HOUSE_R=6m).
        // Reduced 50% — inner truck edge sits closer to centreline now.
        const laneOffset = (HOUSE_R + this.spec.width) * 0.25;
        this.mesh.position
            .copy(n).multiplyScalar(R + this.spec.height / 2 + SURFACE_RISE)
            .addScaledVector(right, laneOffset);

        // Orient without reading parent world matrix (scene shifts each frame for precision).
        // Local X = right (truck width), local Y = n (up from surface), local Z = fwd (11 m travel axis).
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

    constructor(
        scene:          Scene,
        homeNormal:     Vector3,
        sourceResource: Resource,
        fuelResource:   Resource,
        sourceNormal:   Vector3,
        destName?:      string,
    ) {
        super(scene, homeNormal, sourceResource, fuelResource, sourceNormal, destName);
        // Place at cycle position 0 = at destination, about to leave.
        // Subclass `spec` field is initialized by the time this runs, so _placeMesh is safe.
        this.setFromCyclePosition(0);
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
        const src   = resources.find(r => r.name === save.sourceResource)!;
        const fuel  = resources.find(r => r.name === save.fuelResource)!;
        const destN = (save.hnx !== undefined)
            ? new Vector3(save.hnx, save.hny!, save.hnz!)
            : homeNormal;
        // sourceNormal: prefer saved value, fall back to hitMesh position for old saves
        const srcN  = (save.snx !== undefined)
            ? new Vector3(save.snx, save.sny!, save.snz!)
            : (src.hitMesh ? src.hitMesh.position.clone().normalize() : destN);
        const rawName = save.destName ?? 'Homebase';
        const destName = rawName === 'Home' || rawName === 'Home Base' ? 'Homebase' : rawName;
        const t = new TruckTransport(scene, destN, src, fuel, srcN, destName);
        t.restoreFrom(save);
        return t;
    }
}
