import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { Refinery, STEEL_RECIPE } from '../../src/game/refinery';
import { TransportQueue } from '../../src/game/transportRequest';
import { GameEngine } from '../../src/game/engine';
import { ResourceNode } from '../../src/game/resourceNode';
import { Homebase } from '../../src/game/homebase';
import { TruckTransport } from '../../src/game/transport';
import { PowerPlant } from '../../src/game/powerPlant';
import { OilWell } from '../../src/game/oilWell';
import { TechTree } from '../../src/game/tech';

// Minimal resource set for the steel recipe (Iron + Coal → Steel, Coal fuel).
function makeResources() {
    const iron  = new Resource('Iron', 0xb0bec5);
    const coal  = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
    const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
    return { iron, coal, steel, all: [iron, coal, steel] };
}

function makeEngine(all: Resource[], structures: any[]) {
    return new GameEngine({
        resources: all, structures,
        transports: [], refineries: structures.filter(s => s instanceof Refinery),
        oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree(),
    });
}

describe('GameEngine.createRequest', () => {
    it('enqueues a parent plus its manufactured input tree with parent links', () => {
        const { coal, steel, all } = makeResources();
        const scene = new Scene();
        const refinery = new Refinery(scene, new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        const engine = makeEngine(all, [refinery]);

        const parent = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', steel, 2_000);
        const reqs = engine.queue.requests;
        expect(reqs).toContain(parent);
        // Iron + Coal children addressed to the refinery, linked to the parent.
        const children = engine.queue.childrenOf(parent);
        expect(children.length).toBe(2);
        for (const c of children) {
            expect(c.parentId).toBe(parent.id);
            expect(c.destName).toBe(refinery.label);
        }
    });

    it('cancelRequest cascades to the whole supply subtree', () => {
        const { coal, steel, all } = makeResources();
        const scene = new Scene();
        const refinery = new Refinery(scene, new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        const engine = makeEngine(all, [refinery]);

        const parent = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', steel, 2_000);
        expect(engine.queue.requests.length).toBe(3);   // steel + iron + coal
        const removed = engine.cancelRequest(parent);
        expect(removed.length).toBe(3);
        expect(engine.queue.requests.length).toBe(0);
    });
});

describe('GameEngine.step — manufactured haul accounting', () => {
    it('never delivers more of a manufactured good than was produced', () => {
        // World: homebase (dest) + an Iron node + a Coal node + a steel refinery.
        const iron  = new Resource('Iron', 0xb0bec5);
        const coal  = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
        const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
        const wood  = new Resource('Wood', 0x8b5e3c, 1_000_000, 1000, true, 15);
        const all   = [iron, coal, steel, wood];
        wood.gathered = 1_000_000;   // truck fuel

        // Keep all sites within a few km of the pole so hauls complete quickly.
        const scene = new Scene();
        const near = (dx: number, dz: number) => new Vector3(dx, 1, dz).normalize();
        const home     = new Homebase(scene, new Vector3(0, 1, 0));
        const ironNode = new ResourceNode(scene, iron, near(0.001, 0));
        const coalNode = new ResourceNode(scene, coal, near(0, 0.001));
        const refinery = new Refinery(scene, near(0.001, 0.001), STEEL_RECIPE, all, coal);

        const engine = new GameEngine({
            resources: all, structures: [home, ironNode, coalNode, refinery],
            transports: [], refineries: [refinery], oilWells: [], powerPlants: [],
            queue: new TransportQueue(), techTree: new TechTree(),
        });

        for (let i = 0; i < 3; i++) engine.addTransport(new TruckTransport(scene, wood, new Vector3(0, 1, 0)));

        const req = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', steel, 10_000);

        let produced = 0, delivered = 0;
        engine.setListener({
            onProduced: (_s, res) => { if (res[0] === steel) produced += STEEL_RECIPE.outputKgPerBatch; },
            onDeliver:  (_t, r, loaded) => { if (r.resource === steel && r.destName === 'Homebase') delivered += loaded; },
        });

        // Advance the simulation at 10x until the request settles.
        let simT = 0;
        while (simT < 40_000) {
            engine.step((1 / 60) * 10);
            simT += (1 / 60) * 10;
            if (req.complete && !engine.queue.requests.includes(req) && engine.transports.every(t => t.isIdle)) break;
        }

        // The core invariant: deliveries can never exceed production.
        expect(delivered).toBeLessThanOrEqual(produced + 1e-6);
        // And the request completes honestly with real steel in inventory.
        expect(req.complete).toBe(true);
        expect(req.qtyDelivered).toBeCloseTo(10_000, 3);
        expect(steel.gathered).toBeGreaterThanOrEqual(10_000 - 1e-6);
    });
});

describe('GameEngine — structure lifecycle', () => {
    function refineryEngine() {
        const { coal, steel, all } = makeResources();
        const scene = new Scene();
        const refinery = new Refinery(scene, new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        const engine = makeEngine(all, [refinery]);
        return { engine, refinery, steel, coal, all, scene };
    }

    it('addRefinery / addOilWell / addPowerPlant register into both lists', () => {
        const elec = new Resource('Electricity', 0xfdd835, 0, 0, false, 0, true, 'kWh');
        const coal = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
        const oil  = new Resource('Oil', 0x3e2723, 1e7, 0, true, 42.7, false, 'kg', true);
        const scene = new Scene();
        const engine = makeEngine([elec, coal, oil], []);

        engine.addPowerPlant(new PowerPlant(scene, new Vector3(1, 0, 0), coal, elec));
        engine.addOilWell(new OilWell(scene, new Vector3(0, 1, 0), oil));
        expect(engine.powerPlants).toHaveLength(1);
        expect(engine.oilWells).toHaveLength(1);
        // Both also appear in the shared structure list used by dispatch/resolveSource.
        expect(engine.structures).toHaveLength(2);
    });

    it('removeStructure drops it from lists, cancels its requests, frees its trucks', () => {
        const { engine, refinery, steel, scene, all } = refineryEngine();
        // A request delivering TO the refinery + a truck already routed there.
        engine.createRequest(refinery.surfaceNormal.clone(), refinery.label,
            all.find(r => r.name === 'Iron')!, 5_000);
        const iron = all.find(r => r.name === 'Iron')!;
        const truck = new TruckTransport(scene, all.find(r => r.name === 'Coal')!, new Vector3(0, 1, 0));
        (all.find(r => r.name === 'Coal')!).gathered = 1_000_000;
        engine.addTransport(truck);
        engine.dispatch();

        engine.removeStructure(refinery);
        expect(engine.refineries).toHaveLength(0);
        expect(engine.structures).not.toContain(refinery);
        // Requests addressed to the removed site are gone; trucks freed.
        expect(engine.queue.requests.filter(r => r.destName === refinery.label)).toHaveLength(0);
        expect(truck.isIdle).toBe(true);
    });

    it('blockReason delegates to the dispatcher classification', () => {
        // A stocked raw source (iron node) but no trucks → "no-transport".
        const iron = new Resource('Iron', 0xb0bec5);
        const scene = new Scene();
        const node = new ResourceNode(scene, iron, new Vector3(1, 0, 0));
        const engine = makeEngine([iron], [node]);
        const req = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', iron, 5_000);
        expect(engine.blockReason(req)).toBe('no-transport');
    });
});

describe('GameEngine — direct player actions', () => {
    it('gather() mines a tap-yield into inventory and emits onGather', () => {
        const wood = new Resource('Wood', 0x8b5e3c, 10_000, 1_000);
        let gathered = 0;
        const engine = new GameEngine({
            resources: [wood], structures: [], transports: [], refineries: [],
            oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree(),
        }, { onGather: (_r, amt) => { gathered += amt; } });

        expect(engine.gather(wood)).toBe(true);
        expect(wood.gathered).toBe(1_000);
        expect(wood.deposit).toBe(9_000);
        expect(gathered).toBe(1_000);

        wood.deposit = 0;
        expect(engine.gather(wood)).toBe(false);   // exhausted
    });

    it('build() charges the cost, registers the item, and emits onBuilt', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        iron.gathered = TruckTransport.IRON_COST + 5_000;
        let built = 0;
        const engine = new GameEngine({
            resources: [iron], structures: [], transports: [], refineries: [],
            oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree(),
        }, { onBuilt: () => { built++; } });

        const truck = new TruckTransport(new Scene(), iron, new Vector3(0, 1, 0));
        expect(engine.build(truck)).toBe(true);
        expect(engine.transports).toContain(truck);
        expect(iron.gathered).toBe(5_000);   // IRON_COST deducted
        expect(built).toBe(1);
    });

    it('build() refuses (and spends nothing) when the cost is unmet', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        iron.gathered = 100;   // far below truck cost
        const engine = new GameEngine({
            resources: [iron], structures: [], transports: [], refineries: [],
            oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: new TechTree(),
        });
        const truck = new TruckTransport(new Scene(), iron, new Vector3(0, 1, 0));
        expect(engine.build(truck)).toBe(false);
        expect(engine.transports).not.toContain(truck);
        expect(iron.gathered).toBe(100);   // untouched
    });

    it('research() enforces prereqs + cost, then unlocks and emits onResearched', () => {
        const stone = new Resource('Stone', 0x9e9e9e); stone.gathered = 1_000_000;
        const ironR = new Resource('Iron', 0xb0bec5);  ironR.gathered = 1_000_000;
        const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
        const tech = new TechTree();
        let researched = '';
        const engine = new GameEngine({
            resources: [stone, ironR, steel], structures: [], transports: [], refineries: [],
            oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: tech,
        }, { onResearched: (def) => { researched = def.id; } });

        // fuel_oil requires fuel_coal first.
        expect(engine.research('fuel_oil')).toBe(false);
        expect(engine.research('fuel_coal')).toBe(true);
        expect(tech.isResearched('fuel_coal')).toBe(true);
        expect(researched).toBe('fuel_coal');
        expect(stone.gathered).toBe(1_000_000 - 10_000);   // coal-tech cost paid

        // Can't re-research or research unaffordably.
        expect(engine.research('fuel_coal')).toBe(false);
    });

    it('research() spends nothing when a cost resource is short', () => {
        const stone = new Resource('Stone', 0x9e9e9e); stone.gathered = 100;   // need 10 000
        const ironR = new Resource('Iron', 0xb0bec5);  ironR.gathered = 1_000_000;
        const tech = new TechTree();
        const engine = new GameEngine({
            resources: [stone, ironR], structures: [], transports: [], refineries: [],
            oilWells: [], powerPlants: [], queue: new TransportQueue(), techTree: tech,
        });
        expect(engine.research('fuel_coal')).toBe(false);
        expect(tech.isResearched('fuel_coal')).toBe(false);
        expect(ironR.gathered).toBe(1_000_000);   // nothing spent
    });
});

describe('GameEngine — listener events', () => {
    it('emits request/produce/deliver events through the listener', () => {
        // Tiny world: iron/coal nodes + steel refinery near the pole, 2 trucks.
        const iron  = new Resource('Iron', 0xb0bec5);
        const coal  = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
        const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
        const wood  = new Resource('Wood', 0x8b5e3c, 1e7, 1000, true, 15);
        wood.gathered = 1_000_000;
        const all = [iron, coal, steel, wood];

        const scene = new Scene();
        const near = (dx: number, dz: number) => new Vector3(dx, 1, dz).normalize();
        const home = new Homebase(scene, new Vector3(0, 1, 0));
        const ironNode = new ResourceNode(scene, iron, near(0.001, 0));
        const coalNode = new ResourceNode(scene, coal, near(0, 0.001));
        const refinery = new Refinery(scene, near(0.001, 0.001), STEEL_RECIPE, all, coal);

        const events: string[] = [];
        const engine = new GameEngine(
            { resources: all, structures: [home, ironNode, coalNode, refinery],
              transports: [], refineries: [refinery], oilWells: [], powerPlants: [],
              queue: new TransportQueue(), techTree: new TechTree() },
            {
                onRequestCreated:   () => events.push('created'),
                onProduced:         () => events.push('produced'),
                onLoad:             () => events.push('load'),
                onDeliver:          () => events.push('deliver'),
                onRequestFulfilled: () => events.push('fulfilled'),
                onInventoryChanged: () => events.push('inv'),
            },
        );
        for (let i = 0; i < 2; i++) engine.addTransport(new TruckTransport(scene, wood, new Vector3(0, 1, 0)));
        const steelReq = engine.createRequest(new Vector3(0, 1, 0), 'Homebase', steel, 3_000);

        // Run until the STEEL request itself completes (not just an input child).
        let t = 0;
        while (t < 20_000) { engine.step((1 / 60) * 10); t += (1 / 60) * 10; if (steelReq.complete) break; }

        // Every stage of the pipeline reported at least once.
        for (const k of ['created', 'produced', 'load', 'deliver', 'fulfilled', 'inv']) {
            expect(events, `missing ${k}`).toContain(k);
        }
    });
});
