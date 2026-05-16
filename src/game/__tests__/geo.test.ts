import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import {
    clampDot, arcLengthM, arcLengthKm,
    normalToLatLon, formatLatLon, isSameStructureNormal,
} from '../geo';
import { R } from '../constants';

describe('clampDot', () => {
    it('clamps above 1', () => { expect(clampDot(1 + 1e-9)).toBe(1); });
    it('clamps below -1', () => { expect(clampDot(-1 - 1e-9)).toBe(-1); });
    it('passes legal values through', () => { expect(clampDot(0.3)).toBe(0.3); });
});

describe('arcLength', () => {
    it('zero distance for identical normals', () => {
        const n = new Vector3(1, 0, 0);
        expect(arcLengthM(n, n)).toBeCloseTo(0, 6);
    });

    it('quarter circle = π/2 · R', () => {
        const a = new Vector3(1, 0, 0);
        const b = new Vector3(0, 1, 0);
        expect(arcLengthM(a, b)).toBeCloseTo(Math.PI / 2 * R, 0);
    });

    it('arcLengthKm = arcLengthM / 1000', () => {
        const a = new Vector3(1, 0, 0);
        const b = new Vector3(0, 1, 0);
        expect(arcLengthKm(a, b)).toBeCloseTo(arcLengthM(a, b) / 1000, 6);
    });
});

describe('normalToLatLon / formatLatLon', () => {
    it('north pole → 90,0-ish', () => {
        const { lat } = normalToLatLon(new Vector3(0, 1, 0));
        expect(lat).toBeCloseTo(90, 6);
    });

    it('equator at +X → 0,0', () => {
        const { lat, lon } = normalToLatLon(new Vector3(1, 0, 0));
        expect(lat).toBeCloseTo(0, 6);
        expect(lon).toBeCloseTo(0, 6);
    });

    it('formatLatLon returns "lat,lon" with 2 decimals', () => {
        const s = formatLatLon(new Vector3(1, 0, 0));
        expect(s).toMatch(/^[-\d.]+,[-\d.]+$/);
        const [latStr] = s.split(',');
        expect(latStr.split('.')[1]?.length).toBe(2);
    });
});

describe('isSameStructureNormal', () => {
    it('identical clones match', () => {
        const a = new Vector3(0.6, 0.8, 0).normalize();
        const b = a.clone();
        expect(isSameStructureNormal(a, b)).toBe(true);
    });

    it('200 m-apart pads do NOT match (tight threshold)', () => {
        // arc 200 m → angle 200/R rad → dot ≈ 1 - 5e-10
        const a = new Vector3(1, 0, 0);
        const t = new Vector3(0, 1, 0);
        const theta = 200 / R;
        const b = a.clone().multiplyScalar(Math.cos(theta))
                    .addScaledVector(t, Math.sin(theta)).normalize();
        expect(isSameStructureNormal(a, b)).toBe(false);
    });
});
