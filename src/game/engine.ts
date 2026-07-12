import { Vector3 } from 'three';
import { Resource } from './resource';
import { Structure } from './structure';
import { Transport, TruckTransport } from './transport';
import { Refinery, REFINERY_IRON_COST, REFINERY_STONE_COST } from './refinery';
import { OilWell, OIL_WELL_STEEL_COST } from './oilWell';
import { PowerPlant, POWER_PLANT_IRON_COST, POWER_PLANT_STONE_COST } from './powerPlant';
import { TransportQueue, TransportRequest } from './transportRequest';
import { dispatch as runDispatch, requestBlockReason, BlockReason } from './dispatcher';
import { findProducer, requiredInputs } from './supplyChain';
import { isSameStructureNormal } from './geo';
import { TechTree, TechDef, TECH_DEFS } from './tech';

// A resource amount spent to build a structure / research a tech.
export interface ResourceCost { resource: Resource; amount: number }

// Sub-step cap: each truck advances at most ~1 sim-second per iteration so a large
// timeScale still produces smooth arcs and refineries don't miss queued batches.
export const SIM_MAX_STEP = 1.0;

// Every state change the engine makes is surfaced as an event. The UI listener
// maps these to HUD refreshes / notifications / autosave; the headless runner
// maps them to log-file lines. Neither is visible to the engine, so both drive
// the *exact same* simulation code — that is the whole point of this class.
export interface EngineListener {
    onRequestCreated?(req: TransportRequest, parent: TransportRequest | null): void;
    onRequestFulfilled?(req: TransportRequest): void;
    onRequestCancelled?(req: TransportRequest, cascaded: number): void;
    // A truck finished loading at a source. `loaded` may be < `requested` if the
    // source was short. This is the moment cargo leaves the source pool.
    onLoad?(t: Transport, resource: Resource, loaded: number, requested: number): void;
    // A truck reached its destination and its cargo entered the global pool.
    onDeliver?(t: Transport, req: TransportRequest, loaded: number, payload: number, fuelKg: number): void;
    onSourceExhausted?(t: Transport, resource: Resource): void;
    onLowFuel?(t: Transport, fuel: Resource): void;
    onProduced?(structure: Structure, resources: Resource[]): void;
    // Fired once per step() when any inventory changed (drives autosave).
    onInventoryChanged?(): void;
    // Direct player actions, now routed through the engine:
    onGather?(resource: Resource, amount: number): void;
    onBuilt?(item: Transport | Structure, costs: ResourceCost[]): void;
    onResearched?(tech: TechDef, costs: ResourceCost[]): void;
}

export interface EngineInit {
    resources:   Resource[];
    structures:  Structure[];    // ALL structures (homebase, resource nodes, built ones)
    transports:  Transport[];
    refineries:  Refinery[];
    oilWells:    OilWell[];
    powerPlants: PowerPlant[];
    queue:       TransportQueue;
    techTree:    TechTree;
}

// The authoritative game simulation. Owns all mutable sim state and is the ONLY
// place that advances it. Rendering, input, and persistence live outside and
// talk to the engine exclusively through this API.
export class GameEngine {
    readonly resources:   Resource[];
    readonly structures:  Structure[];
    readonly transports:  Transport[];
    readonly refineries:  Refinery[];
    readonly oilWells:    OilWell[];
    readonly powerPlants: PowerPlant[];
    readonly queue:       TransportQueue;
    readonly techTree:    TechTree;

    private listener: EngineListener;

    constructor(init: EngineInit, listener: EngineListener = {}) {
        this.resources   = init.resources;
        this.structures  = init.structures;
        this.transports  = init.transports;
        this.refineries  = init.refineries;
        this.oilWells    = init.oilWells;
        this.powerPlants = init.powerPlants;
        this.queue       = init.queue;
        this.techTree    = init.techTree;
        this.listener    = listener;
    }

    setListener(l: EngineListener): void { this.listener = l; }

    // ── Requests ────────────────────────────────────────────────────────────

    // Post a haul request. If the resource is manufactured, the upstream input
    // deliveries are provisioned as child requests by provisionSupply() — which
    // runs on the dispatch() below and every dispatch after, so the same mechanism
    // both builds the initial supply tree and keeps it topped up.
    createRequest(
        destNormal: Vector3, destName: string, resource: Resource, qty: number,
    ): TransportRequest {
        const parent = new TransportRequest(destNormal, destName, resource, qty);
        this.queue.add(parent);
        this.listener.onRequestCreated?.(parent, null);
        this.dispatch();
        return parent;
    }

    // Remove `req` and its whole upstream supply subtree from the queue. With
    // `abortTrucks`, trucks mid-haul for a doomed request are recalled (user
    // cancellation); without it they finish their trip (completion cleanup — an
    // in-flight input load still usefully banks at the producer).
    private removeSubtree(req: TransportRequest, abortTrucks: boolean): TransportRequest[] {
        const doomed = this.queue.subtree(req);
        for (const r of doomed) {
            this.queue.remove(r);
            if (abortTrucks) for (const t of this.transports) t.cancelIfServing(r);
        }
        return doomed;
    }

    // Cancel a request AND every upstream input request created to supply it,
    // freeing any trucks serving them. Returns all removed requests.
    cancelRequest(req: TransportRequest): TransportRequest[] {
        const doomed = this.removeSubtree(req, true);
        this.dispatch();
        this.listener.onRequestCancelled?.(req, doomed.length - 1);
        return doomed;
    }

    // Read-only query used by the UI warning board.
    blockReason(req: TransportRequest): BlockReason | null {
        return requestBlockReason(req, this.transports, this.structures);
    }

    // ── Structures & fleet ────────────────────────────────────────────────────

    addTransport(t: Transport): void { this.transports.push(t); this.dispatch(); }

    addRefinery(r: Refinery): void { this.refineries.push(r); this.structures.push(r); }
    addOilWell(w: OilWell): void { this.oilWells.push(w); this.structures.push(w); }
    addPowerPlant(p: PowerPlant): void { this.powerPlants.push(p); this.structures.push(p); }

    // Remove a placed structure from the simulation: drop it from the structure
    // lists, cancel requests delivering there, and free trucks routed to/from it.
    // (Mesh disposal is the caller's concern — the engine never touches the scene.)
    removeStructure(s: Structure): void {
        const si = this.structures.indexOf(s);
        if (si !== -1) this.structures.splice(si, 1);

        if (s instanceof Refinery)        this._spliceOut(this.refineries, s);
        else if (s instanceof OilWell)    this._spliceOut(this.oilWells, s);
        else if (s instanceof PowerPlant) this._spliceOut(this.powerPlants, s);

        const n = s.surfaceNormal;
        for (const req of [...this.queue.requests]) {
            if (isSameStructureNormal(req.destNormal, n)) this.queue.remove(req);
        }
        for (const t of this.transports) {
            if (!t.isIdle && (isSameStructureNormal(t.destinationNormal, n) ||
                              isSameStructureNormal(t.srcNormal, n))) {
                t.abortJob();
            }
        }
        this.dispatch();
    }

    private _spliceOut<T>(arr: T[], item: T): void {
        const i = arr.indexOf(item);
        if (i !== -1) arr.splice(i, 1);
    }

    // ── Direct player actions ───────────────────────────────────────────────────

    // Manual tap-to-gather on a resource pad. Mines one tap-yield from the deposit
    // into inventory. Returns false if the deposit is exhausted.
    gather(resource: Resource): boolean {
        const before = resource.gathered;
        if (!resource.gather()) return false;
        this.listener.onGather?.(resource, resource.gathered - before);
        return true;
    }

    // Build cost for a constructed (but not-yet-registered) item, by type.
    private buildCost(item: Transport | Structure): ResourceCost[] {
        const r = (name: string) => this.resources.find(x => x.name === name)!;
        if (item instanceof Refinery)   return [{ resource: r('Iron'), amount: REFINERY_IRON_COST },
                                                { resource: r('Stone'), amount: REFINERY_STONE_COST }];
        if (item instanceof OilWell)    return [{ resource: r('Steel'), amount: OIL_WELL_STEEL_COST }];
        if (item instanceof PowerPlant) return [{ resource: r('Iron'), amount: POWER_PLANT_IRON_COST },
                                                { resource: r('Stone'), amount: POWER_PLANT_STONE_COST }];
        if (item instanceof Transport)  return [{ resource: r('Iron'), amount: TruckTransport.IRON_COST }];
        return [];
    }

    // Atomically pay the build cost and register a freshly-constructed structure /
    // transport. The caller creates the object (it owns the scene/mesh); the engine
    // spends the resources and wires it into the simulation. Returns false (and
    // spends nothing) if the cost can't be met — the caller should dispose the item.
    build(item: Transport | Structure): boolean {
        const costs = this.buildCost(item);
        if (!costs.every(c => c.resource.gathered >= c.amount)) return false;
        for (const c of costs) c.resource.consume(c.amount);

        if (item instanceof Refinery)        this.addRefinery(item);
        else if (item instanceof OilWell)    this.addOilWell(item);
        else if (item instanceof PowerPlant) this.addPowerPlant(item);
        else if (item instanceof Transport)  this.addTransport(item);

        this.listener.onBuilt?.(item, costs);
        return true;
    }

    // Research a tech: verify prerequisites + affordability, then pay and unlock.
    // Returns false (spending nothing) if it can't be researched right now.
    research(techId: string): boolean {
        if (!this.techTree.canResearch(techId)) return false;
        const def = TECH_DEFS.find(t => t.id === techId);
        if (!def) return false;
        const costs: ResourceCost[] = def.cost.map(c => ({
            resource: this.resources.find(r => r.name === c.resourceName)!,
            amount:   c.amount,
        }));
        if (!costs.every(c => c.resource && c.resource.gathered >= c.amount)) return false;

        for (const c of costs) c.resource.consume(c.amount);
        this.techTree.research(techId);
        this.listener.onResearched?.(def, costs);
        return true;
    }

    // Assign idle trucks to the best open request. Safe to call any time.
    // Re-provisions manufactured requests first so a producer that's been starved
    // (inputs consumed by trucks/other jobs, or a source that ran low) gets fresh
    // input requests instead of leaving the job stuck with idle trucks.
    dispatch(): number {
        this.provisionSupply();
        return runDispatch(this.transports, this.queue, this.structures);
    }

    // Smallest shortfall worth a new haul (kg) — avoids float-dust top-up requests.
    private static readonly MIN_TOPUP = 1;

    // For each open manufactured request, ensure its producer has (or has inbound)
    // enough input material to make the amount still needed. Any shortfall not
    // already covered by an in-flight input request is enqueued as a child request.
    // This makes the supply chain self-sustaining: one-shot provisioning at request
    // time is no longer the only chance to feed the producer.
    private provisionSupply(): void {
        for (const req of this.queue.requests) {
            if (req.complete || !req.resource.isManufactured) continue;
            const producer = findProducer(req.resource, this.structures);
            if (!producer) continue;

            // Output still to PRODUCE = still-needed delivery minus what's already
            // sitting in the producer's pickup buffer.
            const toProduce = req.remaining - req.resource.deposit;
            if (toProduce <= GameEngine.MIN_TOPUP) continue;

            for (const { res, kg } of requiredInputs(producer, toProduce, this.resources)) {
                const inbound = this.inboundTo(producer.surfaceNormal, res);
                const add = kg - res.gathered - inbound;   // gross need − on hand − already coming
                if (add > GameEngine.MIN_TOPUP) {
                    const child = new TransportRequest(
                        producer.surfaceNormal.clone(), producer.label, res, add, undefined, req.id,
                    );
                    this.queue.add(child);
                    this.listener.onRequestCreated?.(child, req);
                }
            }
        }
    }

    // kg of `res` already inbound to the structure at `destNormal` (sum of the
    // undelivered portion of open requests delivering there) — used to de-dupe
    // top-up requests so they don't pile up every dispatch.
    private inboundTo(destNormal: Vector3, res: Resource): number {
        let total = 0;
        for (const r of this.queue.requests) {
            if (!r.complete && r.resource === res && isSameStructureNormal(r.destNormal, destNormal)) {
                total += r.outstanding;
            }
        }
        return total;
    }

    // ── Simulation tick ────────────────────────────────────────────────────────

    // Advance the simulation by `gameDt` seconds (already time-scaled by the
    // caller). Sub-steps internally so no truck moves more than SIM_MAX_STEP per
    // integration step. Returns true if any inventory changed this step.
    step(gameDt: number): boolean {
        const subSteps = Math.max(1, Math.ceil(gameDt / SIM_MAX_STEP));
        const stepDt   = gameDt / subSteps;

        // Idle trucks pick up open requests (also catches requests that became
        // serviceable as stock or fuel replenished).
        this.dispatch();

        let dirty = false;
        for (let s = 0; s < subSteps; s++) {
            for (const t of this.transports) {
                const { load, deliver } = t.update(stepDt);
                if (load) {
                    // Take from the source (debits deposit/stock); cargo is now in
                    // transit. Inventory does NOT rise until delivery.
                    const got = load.resource.extract(load.payload);
                    t.setLoaded(got);
                    dirty = true;
                    this.listener.onLoad?.(t, load.resource, got, load.payload);
                    if (got <= 0) {
                        const res = load.resource;
                        t.abortJob();
                        this.listener.onSourceExhausted?.(t, res);
                    }
                }
                if (deliver) {
                    // Cargo arrives: inventory rises now. Credit the request,
                    // release the reserved capacity, burn trip fuel.
                    deliver.resource.deliver(deliver.loaded);
                    deliver.request.qtyInFlight = Math.max(0, deliver.request.qtyInFlight - deliver.payload);
                    deliver.request.qtyDelivered += deliver.loaded;
                    const fuelOk = t.fuelResource.consume(deliver.fuelKg);
                    dirty = true;
                    this.listener.onDeliver?.(t, deliver.request, deliver.loaded, deliver.payload, deliver.fuelKg);
                    if (!fuelOk) this.listener.onLowFuel?.(t, t.fuelResource);
                    for (const done of this.queue.prune()) {
                        this.listener.onRequestFulfilled?.(done);
                        // Drop leftover input requests spawned to supply this now-finished
                        // job so trucks don't keep hauling for it (trucks mid-haul finish).
                        this.removeSubtree(done, false);
                    }
                }
            }

            for (const ref of this.refineries) {
                if (ref.tick(stepDt).produced) {
                    dirty = true;
                    this.listener.onProduced?.(ref, [ref.providesResource!]);
                }
            }
            for (const pp of this.powerPlants) {
                if (pp.tick(stepDt).produced) {
                    dirty = true;
                    this.listener.onProduced?.(pp, [pp.providesResource, pp.fuelResource]);
                }
            }
            for (const well of this.oilWells) {
                if (well.tick(stepDt).produced) {
                    dirty = true;
                    this.listener.onProduced?.(well, [well.providesResource]);
                }
            }
        }

        if (dirty) this.listener.onInventoryChanged?.();
        return dirty;
    }
}
