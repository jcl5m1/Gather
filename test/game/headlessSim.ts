// Headless simulation runner.
//
// Builds a real game world (homebase + resource nodes + a steel refinery + a
// truck fleet) and advances it through the SAME GameEngine the browser UI uses —
// no Three.js renderer, no DOM. Every transport/production event is captured with
// a simulation timestamp so the run can be replayed from the log to debug haul
// accounting (e.g. "steel delivered popup, but the full amount never arrived").
//
// Three.js scene objects (Scene/Mesh/geometry) are pure math in Node, so the
// structures build fine without a WebGL context.

import { Scene, Vector3 } from 'three';
import { Resource, RESOURCES } from '../../src/game/resource';
import { Structure } from '../../src/game/structure';
import { TruckTransport } from '../../src/game/transport';
import { Refinery, STEEL_RECIPE } from '../../src/game/refinery';
import { TransportQueue, TransportRequest } from '../../src/game/transportRequest';
import { GameEngine, EngineListener } from '../../src/game/engine';
import { TechTree } from '../../src/game/tech';
import { buildWorld, KSC_NORMAL } from '../../src/game/world';

export interface SimEvent {
    t:      number;        // simulation time (s) when it happened
    kind:   string;
    truck?: number;
    resource?: string;
    dest?:  string;
    kg?:    number;        // amount involved (loaded / delivered / requested)
    of?:    number;        // out of (requested payload, or request total)
    detail?: string;
}

export interface SimResult {
    events:        SimEvent[];
    simSeconds:    number;
    steps:         number;
    // The Steel request we were tracking.
    requested:     number;
    credited:      number;   // request.qtyDelivered when it finished (or last seen)
    fulfilled:     boolean;
    // Ground truth measured independently of the request counter:
    steelActuallyDelivered: number;   // Σ loaded on Steel→Homebase deliveries
    steelInventoryEnd:      number;   // Steel.gathered at end of run
    steelProduced:          number;   // Σ refinery output
}

export interface SimOptions {
    timeScale?:      number;   // default 10
    trucks?:         number;   // default 3
    steelRequestKg?: number;   // default 20_000
    maxSimSeconds?:  number;   // safety cap, default 40_000
    onEvent?:        (e: SimEvent) => void;   // side-channel (e.g. write to file)
}

// Restore the shared RESOURCES singleton to a clean slate so repeat runs are
// deterministic (deposits full, nothing gathered).
function resetResources(): void {
    for (const r of RESOURCES) {
        r.deposit  = r.depositInitial;
        r.gathered = 0;
    }
}

// A surface normal a short distance from the homebase (so the refinery is a
// distinct site and never resolves itself as its own steel source).
function nearHomebase(): Vector3 {
    return KSC_NORMAL.clone().add(new Vector3(0.002, 0, 0.002)).normalize();
}

export function runHeadlessSim(opts: SimOptions = {}): SimResult {
    const timeScale     = opts.timeScale     ?? 10;
    const truckCount    = opts.trucks        ?? 3;
    const steelReqKg    = opts.steelRequestKg ?? 20_000;
    const maxSimSeconds = opts.maxSimSeconds ?? 40_000;

    resetResources();
    const byName = (n: string) => RESOURCES.find(r => r.name === n)!;
    const Steel = byName('Steel'), Wood = byName('Wood');

    const scene = new Scene();
    const world = buildWorld(scene, RESOURCES);
    const structures: Structure[] = [world.homebase, ...world.resourceNodes];

    // A steel refinery (Iron + Coal → Steel), Coal-fuelled, near the homebase.
    const refinery = new Refinery(scene, nearHomebase(), STEEL_RECIPE, RESOURCES, byName('Coal'));
    structures.push(refinery);
    const refineries = [refinery];

    // Fuel the fleet from Wood so the Coal/Iron supply chain isn't pre-satisfied
    // (the engine only provisions the shortfall vs current stock).
    Wood.gathered = 5_000_000;

    const queue = new TransportQueue();
    const transports: TruckTransport[] = [];

    // ── event capture ──────────────────────────────────────────────────────────
    let simTime = 0;
    let steelActuallyDelivered = 0;
    let steelProduced = 0;
    const events: SimEvent[] = [];
    const emit = (e: Omit<SimEvent, 't'>) => {
        const full: SimEvent = { t: Math.round(simTime * 10) / 10, ...e };
        events.push(full);
        opts.onEvent?.(full);
    };

    const isHome = (name: string) => name === 'Homebase';

    const listener: EngineListener = {
        onRequestCreated: (req, parent) =>
            emit({ kind: 'request', resource: req.resource.name, dest: req.destName, kg: req.qtyRequested,
                   detail: parent ? `child of #${parent.id} (${parent.resource.name})` : 'root' }),
        onLoad: (t, res, loaded, requested) =>
            emit({ kind: 'load', truck: t.id, resource: res.name, kg: loaded, of: requested,
                   detail: loaded < requested ? 'PARTIAL (source short)' : '' }),
        onDeliver: (t, req, loaded, payload) => {
            emit({ kind: 'deliver', truck: t.id, resource: req.resource.name, dest: req.destName,
                   kg: loaded, of: payload, detail: `req ${Math.round(req.qtyDelivered)}/${req.qtyRequested}` });
            if (req.resource === Steel && isHome(req.destName)) steelActuallyDelivered += loaded;
        },
        onProduced: (_s, resources) => {
            if (resources[0] === Steel) {
                steelProduced += STEEL_RECIPE.outputKgPerBatch;
                emit({ kind: 'produce', resource: 'Steel', kg: STEEL_RECIPE.outputKgPerBatch });
            }
        },
        onSourceExhausted: (t, res) => emit({ kind: 'source-dry', truck: t.id, resource: res.name }),
        onLowFuel:        (t, f)   => emit({ kind: 'low-fuel',  truck: t.id, resource: f.name }),
        onRequestFulfilled: (req) =>
            emit({ kind: 'fulfilled', resource: req.resource.name, dest: req.destName,
                   kg: req.qtyDelivered, of: req.qtyRequested }),
    };

    const engine = new GameEngine(
        { resources: RESOURCES, structures, transports, refineries, oilWells: [], powerPlants: [], queue,
          techTree: new TechTree() },
        listener,
    );

    for (let i = 0; i < truckCount; i++) {
        engine.addTransport(new TruckTransport(scene, Wood, KSC_NORMAL.clone()));
    }

    // Post the steel request (auto-plans Iron + Coal deliveries to the refinery).
    const steelReq = engine.createRequest(KSC_NORMAL.clone(), 'Homebase', Steel, steelReqKg);

    // ── run loop: fixed 60 fps frames, time-scaled ──────────────────────────────
    const frameDt = 1 / 60;
    let steps = 0;
    while (simTime < maxSimSeconds) {
        engine.step(frameDt * timeScale);
        simTime += frameDt * timeScale;
        steps++;
        // Stop once the tracked request is fulfilled and the fleet has settled.
        const done = steelReq.complete && !queue.requests.includes(steelReq);
        if (done && transports.every(t => t.isIdle)) break;
    }

    return {
        events,
        simSeconds: Math.round(simTime),
        steps,
        requested: steelReqKg,
        credited:  steelReq.qtyDelivered,
        fulfilled: steelReq.complete,
        steelActuallyDelivered,
        steelInventoryEnd: Steel.gathered,
        steelProduced,
    };
}
