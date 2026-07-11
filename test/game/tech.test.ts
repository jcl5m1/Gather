import { describe, it, expect } from 'vitest';
import { TechTree, TECH_DEFS } from '../../src/game/tech';

describe('TechTree', () => {
    it('gates research behind prerequisites', () => {
        const tt = new TechTree();
        expect(tt.canResearch('fuel_coal')).toBe(true);    // no prereqs
        expect(tt.canResearch('fuel_oil')).toBe(false);    // needs fuel_coal
        tt.research('fuel_coal');
        expect(tt.canResearch('fuel_oil')).toBe(true);
    });

    it('cannot re-research an already-owned tech', () => {
        const tt = new TechTree();
        tt.research('fuel_coal');
        expect(tt.isResearched('fuel_coal')).toBe(true);
        expect(tt.canResearch('fuel_coal')).toBe(false);
    });

    it('rejects unknown tech ids', () => {
        expect(new TechTree().canResearch('nope')).toBe(false);
    });

    it('unlocks fuels tier by tier (Wood always available)', () => {
        const tt = new TechTree();
        expect(tt.unlockedFuelNames()).toEqual(['Wood']);
        tt.research('fuel_coal');
        expect(tt.unlockedFuelNames()).toEqual(['Wood', 'Coal']);
        tt.research('fuel_oil');
        tt.research('fuel_gasoline');
        expect(tt.unlockedFuelNames()).toEqual(['Wood', 'Coal', 'Oil', 'Gasoline']);
    });

    it('round-trips researched ids through JSON', () => {
        const tt = new TechTree();
        tt.research('fuel_coal'); tt.research('fuel_oil');
        const restored = TechTree.fromJSON(tt.toJSON());
        expect(restored.isResearched('fuel_coal')).toBe(true);
        expect(restored.isResearched('fuel_oil')).toBe(true);
        expect(restored.isResearched('fuel_gasoline')).toBe(false);
    });

    it('every tech cost references a known-shaped entry', () => {
        for (const def of TECH_DEFS) {
            expect(def.cost.length).toBeGreaterThan(0);
            for (const c of def.cost) {
                expect(typeof c.resourceName).toBe('string');
                expect(c.amount).toBeGreaterThan(0);
            }
        }
    });
});
