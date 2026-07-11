import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import {
    Refinery, STEEL_RECIPE, GASOLINE_RECIPE, REFINERY_RECIPES,
} from '../../src/game/refinery';

// Resource set covering both shipped recipes.
function makeResources() {
    const iron  = new Resource('Iron',  0xb0bec5, 1_000_000, 1000);
    const coal  = new Resource('Coal',  0x455a64, 1_000_000, 1000, true, 24);
    const oil   = new Resource('Oil',   0x3e2723, 1_000_000, 0, true, 42.7, false, 'kg', true);
    const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
    const gas   = new Resource('Gasoline', 0xffd700, 0, 0, true, 44.5, true);
    return { iron, coal, oil, steel, gas, all: [iron, coal, oil, steel, gas] };
}

const N = new Vector3(1, 0, 0);

describe('Refinery — steel batch production', () => {
    it('produces nothing before a full batch time elapses', () => {
        const { iron, coal, steel, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        iron.gathered = 10_000; coal.gathered = 10_000;   // inputs ready; only time gates
        expect(ref.tick(STEEL_RECIPE.batchSeconds - 1).produced).toBe(false);
        expect(steel.gathered).toBe(0);
    });

    it('consumes inputs + fuel and emits one output batch', () => {
        const { iron, coal, steel, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        iron.gathered = 10_000; coal.gathered = 10_000;

        const before = { iron: iron.gathered, coal: coal.gathered };
        const res = ref.tick(STEEL_RECIPE.batchSeconds);
        expect(res.produced).toBe(true);
        expect(steel.gathered).toBe(STEEL_RECIPE.outputKgPerBatch);
        // Iron 1500/batch consumed
        expect(before.iron - iron.gathered).toBeCloseTo(1_500, 3);
        // Coal = 600 input + fuel (20 000 MJ ÷ 24 MJ/kg = 833.3)
        expect(before.coal - coal.gathered).toBeCloseTo(600 + 20_000 / 24, 1);
    });

    it('stalls (produces nothing, keeps timer credit) when an input is short', () => {
        const { iron, coal, steel, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        iron.gathered = 100;    // not enough for a batch (needs 1500)
        coal.gathered = 10_000;
        const res = ref.tick(STEEL_RECIPE.batchSeconds);
        expect(res.produced).toBe(false);
        expect(res.reason).toContain('Iron');
        expect(steel.gathered).toBe(0);
        expect(iron.gathered).toBe(100);   // inputs not consumed on a stall
    });

    it('reports utilization limited by the scarcest input', () => {
        const { iron, coal, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        iron.gathered = 750;     // 50% of a batch
        coal.gathered = 1_000_000;
        const u = ref.getUtilization();
        expect(u.limitedBy).toBe('Iron');
        expect(u.pct).toBe(50);
    });

    it('feeds the manufactured pickup buffer so trucks can haul the output', () => {
        const { iron, coal, steel, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        iron.gathered = 10_000; coal.gathered = 10_000;
        ref.tick(STEEL_RECIPE.batchSeconds);
        expect(steel.deposit).toBe(STEEL_RECIPE.outputKgPerBatch);
    });
});

describe('Refinery — gasoline (self-fuelled) recipe', () => {
    it('needs no external fuel (energyMJPerBatch = 0)', () => {
        const { oil, coal, gas, all } = makeResources();
        const ref = new Refinery(new Scene(), N, GASOLINE_RECIPE, all, null);
        expect(ref.fuelKgPerBatch()).toBe(0);
        oil.gathered = 10_000; coal.gathered = 10_000;
        expect(ref.tick(GASOLINE_RECIPE.batchSeconds).produced).toBe(true);
        expect(gas.gathered).toBe(GASOLINE_RECIPE.outputKgPerBatch);
    });
});

describe('Refinery — roles & serialization', () => {
    it('declares output role for its product and input role for its ingredients', () => {
        const { iron, coal, steel, gas, all } = makeResources();
        const ref = new Refinery(new Scene(), N, STEEL_RECIPE, all, coal);
        expect(ref.getResourceRole(steel)).toBe('output');
        expect(ref.getResourceRole(iron)).toBe('input');
        expect(ref.getResourceRole(coal)).toBe('input');   // both ingredient AND fuel
        expect(ref.getResourceRole(gas)).toBeNull();
    });

    it('round-trips through JSON (recipe, fuel, timer, position, id)', () => {
        const { coal, all } = makeResources();
        const ref = new Refinery(new Scene(), new Vector3(0, 1, 0), STEEL_RECIPE, all, coal, 7);
        ref.tick(10);   // advance the timer a bit
        const restored = Refinery.fromJSON(ref.toJSON(), new Scene(), all);
        expect(restored.id).toBe(7);
        expect(restored.recipe.id).toBe('Steel');
        expect(restored.fuelResource?.name).toBe('Coal');
        expect(restored.craftProgress01()).toBeGreaterThan(0);
    });

    it('exposes both shipped recipes', () => {
        expect(REFINERY_RECIPES.map(r => r.id).sort()).toEqual(['Gasoline', 'Steel']);
    });
});
