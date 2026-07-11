import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { Refinery, STEEL_RECIPE } from '../../src/game/refinery';
import { findProducer, requiredInputs } from '../../src/game/supplyChain';

// Minimal resource set for the steel recipe (Iron + Coal → Steel, Coal fuel).
function makeResources() {
    const iron  = new Resource('Iron', 0xb0bec5);
    const coal  = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
    const steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true);
    return { iron, coal, steel, all: [iron, coal, steel] };
}

// The engine's continuous re-provisioner (GameEngine.provisionSupply) is built on
// these two primitives; the end-to-end provisioning behaviour is covered by the
// engine / integration / headless suites.
describe('findProducer', () => {
    it('finds the refinery that outputs a manufactured resource', () => {
        const { coal, steel, all } = makeResources();
        const refinery = new Refinery(new Scene(), new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        expect(findProducer(steel, [refinery])).toBe(refinery);
    });

    it('returns null for a raw resource', () => {
        const { iron, coal, all } = makeResources();
        const refinery = new Refinery(new Scene(), new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        expect(findProducer(iron, [refinery])).toBeNull();
    });

    it('returns null when no producer exists', () => {
        const { steel } = makeResources();
        expect(findProducer(steel, [])).toBeNull();
    });
});

describe('requiredInputs', () => {
    it('sums recipe inputs (+ fuel) for a given output quantity', () => {
        const { iron, coal, all } = makeResources();
        const refinery = new Refinery(new Scene(), new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);

        // 2 000 kg steel → 2 batches.
        const inputs = requiredInputs(refinery, 2_000, all);
        const byRes = (r: Resource) => inputs.find(i => i.res === r);

        // Iron: 1500/batch × 2 = 3000.
        expect(byRes(iron)!.kg).toBeCloseTo(3_000, 3);
        // Coal is BOTH a fixed input (600/batch) AND the fuel (20 000 MJ ÷ 24 MJ/kg
        // per batch) — merged into a single entry.
        expect(byRes(coal)!.kg).toBeCloseTo(2 * (600 + 20_000 / 24), 1);
        expect(inputs.filter(i => i.res === coal)).toHaveLength(1);
    });

    it('yields no inputs for a raw resource with no producer', () => {
        // A ResourceNode-less setup: requiredInputs is only meaningful for producers,
        // so an empty producer list is exercised via findProducer upstream. Here we
        // just confirm a refinery with zero output quantity needs nothing.
        const { coal, all } = makeResources();
        const refinery = new Refinery(new Scene(), new Vector3(1, 0, 0), STEEL_RECIPE, all, coal);
        expect(requiredInputs(refinery, 0, all)).toEqual([]);
    });
});
