import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { OilWell, OIL_WELL_KG_PER_SEC } from '../../src/game/oilWell';

function makeOil(deposit = 1_000_000) {
    // Oil is a natural, extraction-gated resource.
    const oil = new Resource('Oil', 0x3e2723, deposit, 0, true, 42.7, false, 'kg', true);
    return oil;
}

const N = new Vector3(1, 0, 0);

describe('OilWell — automatic crude extraction', () => {
    it('pumps crude from the deposit into inventory at a fixed rate', () => {
        const oil = makeOil();
        const well = new OilWell(new Scene(), N, oil);
        const res = well.tick(10);   // 10 s
        expect(res.produced).toBe(true);
        const expected = OIL_WELL_KG_PER_SEC * 10;
        expect(oil.gathered).toBeCloseTo(expected, 6);
        expect(oil.deposit).toBeCloseTo(1_000_000 - expected, 6);
    });

    it('stops producing when the deposit is exhausted', () => {
        const oil = makeOil(0);
        const well = new OilWell(new Scene(), N, oil);
        expect(well.tick(10).produced).toBe(false);
        expect(oil.gathered).toBe(0);
    });

    it('clamps the final draw to the remaining deposit', () => {
        const oil = makeOil(0.1);   // less than one second of flow
        const well = new OilWell(new Scene(), N, oil);
        well.tick(100);
        expect(oil.deposit).toBe(0);
        expect(oil.gathered).toBeCloseTo(0.1, 6);
    });

    it('reports 0% utilization once the deposit is dry', () => {
        const oil = makeOil(0);
        const well = new OilWell(new Scene(), N, oil);
        const u = well.getUtilization();
        expect(u.pct).toBe(0);
        expect(u.limitedBy).toContain('Deposit');
    });

    it('provides Oil for pickup (output role)', () => {
        const oil = makeOil();
        const well = new OilWell(new Scene(), N, oil);
        expect(well.getResourceRole(oil)).toBe('output');
    });

    it('round-trips through JSON', () => {
        const oil = makeOil();
        const well = new OilWell(new Scene(), new Vector3(0, 1, 0), oil);
        const restored = OilWell.fromJSON(well.toJSON(), new Scene(), [oil]);
        expect(restored.providesResource.name).toBe('Oil');
        expect(restored.surfaceNormal.y).toBeCloseTo(1, 6);
    });
});
