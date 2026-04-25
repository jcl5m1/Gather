import {
    Scene, Mesh, Vector3, Matrix4,
    BoxGeometry, MeshStandardMaterial, MeshBasicMaterial,
} from 'three';
import { R, SURFACE_RISE, HOUSE_R } from './constants';
import { Resource } from './resource';
import { Structure } from './structure';

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
    const providers = structures.filter(s => {
        const role = s.getResourceRole(resource);
        if (role !== 'output' && role !== 'both') return false;
        if (destNormal && s.surfaceNormal.dot(destNormal) > 0.9999) return false;
        return true;
    });
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

    resolveDestName(structures: Structure[]): string {
        const match = structures.find(s => s.surfaceNormal.dot(this.homeNormal) > 0.9999);
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

        const cosAngle = Math.min(1, Math.max(-1, this.homeNormal.dot(this.sourceNormal)));
        this.arcLength = Math.max(Math.acos(cosAngle) * R, 0.01);

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
            ? `${(this.spec.payloadKg / 1000).toFixed(0)} t ${this.sourceResource.name}`
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
        const cosAngle = Math.min(1, Math.max(-1, this.homeNormal.dot(this.sourceNormal)));
        this.arcLength  = Math.max(Math.acos(cosAngle) * R, 0.01);
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
        const cosAngle = Math.min(1, Math.max(-1, this.homeNormal.dot(this.sourceNormal)));
        this.arcLength  = Math.max(Math.acos(cosAngle) * R, 0.01);
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
        };
    }

    restoreFrom(save: TransportSave): void {
        this.state      = save.state as TripState;
        this.t          = save.t;
        this.speed      = save.speed;
        this.pauseTimer = save.pauseTimer;
        this.stopped    = save.stopped;
        if (save.destName) this.destName = save.destName;
        if (this.state === 'to_resource' || this.state === 'pause_at_resource') {
            this._placeMesh(this.homeNormal, this.sourceNormal);
        } else {
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

        // Great-circle tangent at n toward `to`: component of `to` in the tangent plane at n.
        // This is exact at every point on the arc, unlike projecting the chord (to−from).
        let fwd = to.clone().addScaledVector(n, -to.dot(n));
        if (fwd.lengthSq() < 1e-10) {
            // n ≈ to (arrived): fall back to the reverse approach from `from` side
            fwd = n.clone().addScaledVector(from, -n.dot(from)).negate();
        }
        if (fwd.lengthSq() < 1e-10) fwd.set(1, 0, 0);
        fwd.normalize();

        const right = new Vector3().crossVectors(n, fwd).normalize();

        // Lane offset must clear the homebase cylinder (radius HOUSE_R=6m):
        // inner truck edge = offset − spec.width/2 must exceed HOUSE_R.
        const laneOffset = HOUSE_R + this.spec.width;  // 6 + 2.6 = 8.6 m
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
