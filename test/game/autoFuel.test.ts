import { describe, it, expect } from 'vitest';
import { Resource } from '../../src/game/resource';
import { TechTree, autoFuel } from '../../src/game/tech';

function makeFuels(): Resource[] {
    return [
        new Resource('Wood',     0, 1, 0, true, 15.0),   // tier 1
        new Resource('Coal',     0, 1, 0, true, 24.0),   // tier 2 (locked initially)
        new Resource('Oil',      0, 1, 0, true, 42.7),   // tier 3
        new Resource('Gasoline', 0, 0, 0, true, 44.5, true),  // manufactured, highest density
        new Resource('Stone',    0),  // not a fuel
    ];
}

describe('autoFuel', () => {
    it('returns most energy-dense unlocked fuel (no stock filtering)', () => {
        const fuels = makeFuels();
        const tt = new TechTree();
        // Default: only first tier unlocked (Wood) per FUEL_TIER null techId
        const out = autoFuel(fuels, tt);
        expect(out?.name).toBe('Wood');
    });

    it('prefers stocked fuels when any have stock', () => {
        const fuels = makeFuels();
        fuels[0].gathered = 100;   // Wood in stock
        const tt = new TechTree();
        // Only Wood unlocked AND in stock → returns Wood.
        expect(autoFuel(fuels, tt)?.name).toBe('Wood');
    });

    it('picks densest stocked fuel across multiple unlocked', () => {
        const fuels = makeFuels();
        const tt = new TechTree();
        tt.research('fuel_coal');
        tt.research('fuel_oil');
        tt.research('fuel_gasoline');
        fuels[0].gathered = 100;  // Wood
        fuels[2].gathered = 100;  // Oil
        // Oil 42.7 > Wood 15.0 — both in stock, Oil wins.
        expect(autoFuel(fuels, tt)?.name).toBe('Oil');
    });

    it('falls back to densest unlocked when no stock', () => {
        const fuels = makeFuels();
        const tt = new TechTree();
        tt.research('fuel_coal');
        tt.research('fuel_oil');
        // Wood + Coal + Oil unlocked, none in stock → Oil (highest density).
        const out = autoFuel(fuels, tt);
        expect(out?.name).toBe('Oil');
    });

    it('returns null when no fuels unlocked', () => {
        const fuels: Resource[] = [];   // no fuels at all
        expect(autoFuel(fuels, new TechTree())).toBeNull();
    });
});
