import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { PowerPlant, BATCH_KG_FUEL } from '../../src/game/powerPlant';

function makeResources() {
    const coal = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
    const elec = new Resource('Electricity', 0xfdd835, 0, 0, false, 0, true, 'kWh');
    return { coal, elec, all: [coal, elec] };
}

const N = new Vector3(1, 0, 0);

describe('PowerPlant — electricity generation', () => {
    it('derives kWh/batch from fuel energy and thermal efficiency', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), N, coal, elec);
        // Coal η = 0.38 → kWh = 1000 kg × 24 MJ/kg × 0.38 / 3.6
        expect(pp.efficiency).toBeCloseTo(0.38, 5);
        expect(pp.kwhPerBatch).toBeCloseTo(1000 * 24 * 0.38 / 3.6, 3);
    });

    it('burns a batch of fuel and produces electricity once per batch time', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), N, coal, elec);
        coal.gathered = 5_000;

        expect(pp.tick(59).produced).toBe(false);   // batch is 60s
        expect(pp.tick(1).produced).toBe(true);
        expect(coal.gathered).toBe(5_000 - BATCH_KG_FUEL);
        expect(elec.gathered).toBeCloseTo(pp.kwhPerBatch, 3);
    });

    it('stalls when fuel is short', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), N, coal, elec);
        coal.gathered = 100;   // < BATCH_KG_FUEL
        expect(pp.tick(60).produced).toBe(false);
        expect(elec.gathered).toBe(0);
    });

    it('utilization tracks fuel availability and names the bottleneck', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), N, coal, elec);
        coal.gathered = BATCH_KG_FUEL / 2;
        const u = pp.getUtilization();
        expect(u.pct).toBe(50);
        expect(u.limitedBy).toBe('Coal');
    });

    it('declares output role for Electricity and input role for its fuel', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), N, coal, elec);
        expect(pp.getResourceRole(elec)).toBe('output');
        expect(pp.getResourceRole(coal)).toBe('input');
    });

    it('round-trips through JSON', () => {
        const { coal, elec, all } = makeResources();
        const pp = new PowerPlant(new Scene(), new Vector3(0, 1, 0), coal, elec);
        pp.tick(15);
        const restored = PowerPlant.fromJSON(pp.toJSON(), new Scene(), all);
        expect(restored.fuelResource.name).toBe('Coal');
        expect(restored.providesResource.name).toBe('Electricity');
        expect(restored.craftProgress01()).toBeGreaterThan(0);
    });
});
