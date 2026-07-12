import { describe, it, expect, beforeEach } from 'vitest';
import { Scene, Vector3 } from 'three';
import { RESOURCES } from '../../src/game/resource';
import { TransportQueue, TransportRequest } from '../../src/game/transportRequest';
import { TruckTransport } from '../../src/game/transport';
import { Refinery, STEEL_RECIPE } from '../../src/game/refinery';
import { OilWell } from '../../src/game/oilWell';
import { PowerPlant } from '../../src/game/powerPlant';
import { TechTree } from '../../src/game/tech';
import { saveGame, loadGame, clearSave } from '../../src/game/saveState';

// Minimal in-memory localStorage (Node has none, and we avoid JSDOM by design).
class MemStorage {
    private store = new Map<string, string>();
    getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
    setItem(k: string, v: string) { this.store.set(k, String(v)); }
    removeItem(k: string) { this.store.delete(k); }
    clear() { this.store.clear(); }
    key() { return null; }
    get length() { return this.store.size; }
}

// The v8 load path never reads the zoom controller; a stub satisfies the type.
const stubZoom = { toJSON: () => ({}) } as any;
const byName = (n: string) => RESOURCES.find(r => r.name === n)!;

function resetResources() {
    for (const r of RESOURCES) { r.gathered = 0; r.deposit = r.depositInitial; }
}

beforeEach(() => {
    (globalThis as any).localStorage = new MemStorage();
    resetResources();
});

describe('saveGame / loadGame — full round trip', () => {
    it('restores inventory, deposits, structures, requests and tech', () => {
        const scene = new Scene();
        const steel = byName('Steel'), iron = byName('Iron'), coal = byName('Coal'), oil = byName('Oil');

        // Arrange a rich game state.
        steel.gathered = 8_000; steel.deposit = 3_000;   // produced buffer (new model)
        iron.gathered  = 2_000; iron.deposit  = 500_000; // partially mined
        coal.gathered  = 50_000;

        const transports = [new TruckTransport(scene, coal, new Vector3(0, 1, 0))];
        const refineries = [new Refinery(scene, new Vector3(1, 0, 0), STEEL_RECIPE, RESOURCES, coal)];
        const oilWells   = [new OilWell(scene, new Vector3(0, 1, 0), oil)];
        const powerPlants = [new PowerPlant(scene, new Vector3(0, 0, 1), coal, byName('Electricity'))];
        const queue = new TransportQueue();
        queue.add(new TransportRequest(new Vector3(0, 1, 0), 'Homebase', steel, 10_000));
        const tech = new TechTree(); tech.research('fuel_coal');

        saveGame(stubZoom, RESOURCES, transports, queue, refineries, oilWells, powerPlants, tech);

        // Wipe live state, then load.
        resetResources();
        const loadTech = new TechTree();
        const out = loadGame(stubZoom, RESOURCES, scene, new Vector3(0, 1, 0), loadTech);

        expect(byName('Steel').gathered).toBe(8_000);
        expect(byName('Iron').gathered).toBe(2_000);
        expect(byName('Iron').deposit).toBe(500_000);
        expect(out.transports).toHaveLength(1);
        expect(out.refineries).toHaveLength(1);
        expect(out.oilWells).toHaveLength(1);
        expect(out.powerPlants).toHaveLength(1);
        expect(out.requests).toHaveLength(1);
        expect(loadTech.isResearched('fuel_coal')).toBe(true);
    });

    it('persists the manufactured pickup buffer (deposit) across a reload', () => {
        const scene = new Scene();
        byName('Steel').gathered = 8_000;
        byName('Steel').deposit  = 3_000;   // produced-but-unhauled
        saveGame(stubZoom, RESOURCES, [], new TransportQueue(), [], [], [], new TechTree());

        resetResources();
        expect(byName('Steel').deposit).toBe(0);   // wiped
        loadGame(stubZoom, RESOURCES, scene, new Vector3(0, 1, 0), new TechTree());
        expect(byName('Steel').deposit).toBe(3_000);   // restored
    });

    it('legacy save without a manufactured deposit falls back to gathered', () => {
        // Hand-craft a v8 save whose deposits map omits Steel (older format).
        const save = {
            version: 8,
            inventory: { Steel: 6_000 },
            deposits:  { Iron: 1_234 },   // no Steel entry
            camera: {}, transports: [], requests: [], refineries: [],
            oilWells: [], powerPlants: [], techs: [],
        };
        (globalThis as any).localStorage.setItem('gather_save_v8', JSON.stringify(save));

        loadGame(stubZoom, RESOURCES, new Scene(), new Vector3(0, 1, 0), new TechTree());
        expect(byName('Steel').gathered).toBe(6_000);
        expect(byName('Steel').deposit).toBe(6_000);   // fallback = owned stock is haulable
        expect(byName('Iron').deposit).toBe(1_234);
    });
});

describe('saveState — empty / cleared', () => {
    it('with no save, inventory is zero and deposits are full', () => {
        const out = loadGame(stubZoom, RESOURCES, new Scene(), new Vector3(0, 1, 0), new TechTree());
        expect(out.transports).toHaveLength(0);
        expect(byName('Iron').gathered).toBe(0);
        expect(byName('Iron').deposit).toBe(byName('Iron').depositInitial);
    });

    it('clearSave wipes persisted data', () => {
        saveGame(stubZoom, RESOURCES, [], new TransportQueue(), [], [], [], new TechTree());
        expect((globalThis as any).localStorage.getItem('gather_save_v8')).not.toBeNull();
        clearSave();
        expect((globalThis as any).localStorage.getItem('gather_save_v8')).toBeNull();
    });
});
