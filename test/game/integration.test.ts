import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { Structure } from '../../src/game/structure';
import { TruckTransport } from '../../src/game/transport';
import { Refinery, GASOLINE_RECIPE, STEEL_RECIPE } from '../../src/game/refinery';
import { PowerPlant } from '../../src/game/powerPlant';
import { Homebase } from '../../src/game/homebase';
import { ResourceNode } from '../../src/game/resourceNode';
import { TransportQueue } from '../../src/game/transportRequest';
import { GameEngine } from '../../src/game/engine';
import { TechTree } from '../../src/game/tech';

// Drive an engine at 10x until `done()` or a sim-time cap; returns sim seconds.
function runUntil(engine: GameEngine, done: () => boolean, maxSec = 40_000): number {
    let t = 0;
    const dt = (1 / 60) * 10;
    while (t < maxSec) { engine.step(dt); t += dt; if (done()) break; }
    return t;
}

const near = (dx: number, dz: number) => new Vector3(dx, 1, dz).normalize();

describe('integration — gasoline (2nd manufactured good) haul accounting', () => {
    it('never delivers more gasoline than produced; inventory matches the request', () => {
        const oil  = new Resource('Oil', 0x3e2723, 1e7, 0, true, 42.7, false, 'kg', true);
        const coal = new Resource('Coal', 0x455a64, 1e7, 1000, true, 24);
        const gas  = new Resource('Gasoline', 0xffd700, 0, 0, true, 44.5, true);
        const wood = new Resource('Wood', 0x8b5e3c, 1e7, 1000, true, 15);
        const all  = [oil, coal, gas, wood];
        // Inputs pre-stocked so this isolates the OUTPUT haul; wood fuels trucks.
        oil.gathered = 1e6; coal.gathered = 1e6; wood.gathered = 1e6;

        const scene = new Scene();
        const home     = new Homebase(scene, new Vector3(0, 1, 0));
        const refinery = new Refinery(scene, near(0.001, 0.001), GASOLINE_RECIPE, all, null);
        const structures: Structure[] = [home, refinery];

        let produced = 0, delivered = 0;
        const engine = new GameEngine(
            { resources: all, structures, transports: [], refineries: [refinery],
              oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree() },
            {
                onProduced: (_s, r) => { if (r[0] === gas) produced += GASOLINE_RECIPE.outputKgPerBatch; },
                onDeliver:  (_t, req, loaded) => { if (req.resource === gas) delivered += loaded; },
            },
        );
        for (let i = 0; i < 2; i++) engine.addTransport(new TruckTransport(scene, wood, new Vector3(0, 1, 0)));
        const req = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', gas, 5_000);

        runUntil(engine, () => req.complete && !engine.queue.requests.includes(req) && engine.transports.every(t => t.isIdle));

        expect(delivered).toBeLessThanOrEqual(produced + 1e-6);
        expect(req.complete).toBe(true);
        expect(req.qtyDelivered).toBeCloseTo(5_000, 3);
        expect(gas.gathered).toBeGreaterThanOrEqual(5_000 - 1e-6);
    });
});

describe('integration — raw source depletion', () => {
    it('stops hauling when a deposit runs dry and never over-delivers', () => {
        const iron = new Resource('Iron', 0xb0bec5, 3_000, 1000);   // only 3 t in the ground
        const wood = new Resource('Wood', 0x8b5e3c, 1e7, 1000, true, 15);
        wood.gathered = 1e6;
        const all = [iron, wood];

        const scene = new Scene();
        const home     = new Homebase(scene, new Vector3(0, 1, 0));
        const ironNode = new ResourceNode(scene, iron, near(0.001, 0));

        let exhausted = 0;
        const engine = new GameEngine(
            { resources: all, structures: [home, ironNode], transports: [],
              refineries: [], oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree() },
            { onSourceExhausted: () => { exhausted++; } },
        );
        for (let i = 0; i < 2; i++) engine.addTransport(new TruckTransport(scene, wood, new Vector3(0, 1, 0)));
        // Request > 1 truckload so two trucks dispatch together; one drains the
        // deposit, the second arrives to find it dry (the exhaustion path).
        const req = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', iron, 30_000);

        runUntil(engine, () => iron.deposit <= 0 && engine.transports.every(t => t.isIdle), 20_000);

        // The whole deposit (and no more) reached inventory; the request is unmet.
        expect(iron.gathered).toBeCloseTo(3_000, 3);
        expect(req.qtyDelivered).toBeLessThanOrEqual(3_000 + 1e-6);
        expect(req.complete).toBe(false);
        expect(exhausted).toBeGreaterThan(0);
    });
});

describe('integration — self-healing supply (producer starved of a shared input)', () => {
    it('completes a manufactured request even when trucks burn the producer’s own input as fuel', () => {
        // Trucks are fuelled by Coal — the SAME resource the steel refinery needs
        // for input + fuel. One-shot provisioning would fall short as trucks siphon
        // Coal, stranding the job with idle trucks. Continuous top-up must recover.
        const iron  = new Resource('Iron', 0xb0bec5, 1e7, 1000);
        const coal  = new Resource('Coal', 0x455a64, 1e7, 1000, true, 24);
        const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
        coal.gathered = 8_000;   // small starter fuel; refinery + trucks share Coal
        const all = [iron, coal, steel];

        const scene = new Scene();
        const home     = new Homebase(scene, new Vector3(0, 1, 0));
        const ironNode = new ResourceNode(scene, iron, near(0.001, 0));
        const coalNode = new ResourceNode(scene, coal, near(0, 0.001));
        const refinery = new Refinery(scene, near(0.001, 0.001), STEEL_RECIPE, all, coal);

        let produced = 0, delivered = 0;
        const engine = new GameEngine(
            { resources: all, structures: [home, ironNode, coalNode, refinery], transports: [],
              refineries: [refinery], oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree() },
            {
                onProduced: (_s, r) => { if (r[0] === steel) produced += STEEL_RECIPE.outputKgPerBatch; },
                onDeliver:  (_t, req, loaded) => { if (req.resource === steel) delivered += loaded; },
            },
        );
        for (let i = 0; i < 3; i++) engine.addTransport(new TruckTransport(scene, coal, new Vector3(0, 1, 0)));
        const req = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', steel, 40_000);

        // Stop on completion, or bail if it stalls (idle fleet, no progress for a while).
        let t = 0; const dt = (1 / 60) * 100; let lastDelivered = 0, lastProgress = 0;
        while (t < 3_000_000) {
            engine.step(dt); t += dt;
            if (req.qtyDelivered > lastDelivered) { lastDelivered = req.qtyDelivered; lastProgress = t; }
            if (req.complete) break;
            if (engine.transports.every(x => x.isIdle) && t - lastProgress > 30_000) break;
        }
        // Let trucks finishing input hauls settle after completion.
        for (let i = 0; i < 4_000; i++) engine.step(dt);

        expect(delivered).toBeLessThanOrEqual(produced + 1e-6);   // never phantom
        expect(req.complete).toBe(true);                          // recovered, not stalled
        expect(steel.gathered).toBeGreaterThanOrEqual(40_000 - 1e-6);
        // No leftover supply requests once the job is done.
        expect(engine.queue.requests).toHaveLength(0);
    });
});

describe('integration — power plant electricity production', () => {
    it('burns fuel over time and accrues electricity inventory', () => {
        const coal = new Resource('Coal', 0x455a64, 1e7, 1000, true, 24);
        const elec = new Resource('Electricity', 0xfdd835, 0, 0, false, 0, true, 'kWh');
        coal.gathered = 100_000;
        const all = [coal, elec];

        const scene = new Scene();
        const pp = new PowerPlant(scene, new Vector3(0, 1, 0), coal, elec);
        const engine = new GameEngine(
            { resources: all, structures: [pp], transports: [], refineries: [],
              oilWells: [], powerPlants: [pp], queue: new TransportQueue(), techTree: new TechTree() },
        );

        const coalBefore = coal.gathered;
        runUntil(engine, () => elec.gathered >= pp.kwhPerBatch * 3, 5_000);

        expect(elec.gathered).toBeGreaterThan(0);
        expect(coal.gathered).toBeLessThan(coalBefore);   // fuel was consumed
        // Electricity accrues in whole batches; coal burned = batches × 1000 kg.
        const batches = Math.round(elec.gathered / pp.kwhPerBatch);
        expect(elec.gathered).toBeCloseTo(batches * pp.kwhPerBatch, 3);
        expect(coalBefore - coal.gathered).toBeCloseTo(batches * 1_000, 3);
    });
});
