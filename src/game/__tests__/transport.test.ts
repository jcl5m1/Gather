import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../resource';
import { TruckTransport } from '../transport';
import { R } from '../constants';

// Build a fresh truck destNormal=X axis, sourceNormal `arcMetres` away.
function makeTruck(arcMetres: number) {
    const scene = new Scene();
    const wood  = new Resource('Wood', 0x8b5e3c, 1_000_000, 1000, true, 15);
    const coal  = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
    const dest  = new Vector3(1, 0, 0);
    const tangent = new Vector3(0, 1, 0);
    const theta = arcMetres / R;
    const src = dest.clone().multiplyScalar(Math.cos(theta))
                    .addScaledVector(tangent, Math.sin(theta)).normalize();
    return new TruckTransport(scene, dest, wood, coal, src);
}

describe('TruckTransport — initial state', () => {
    it('new truck starts at destination (cycle position 0)', () => {
        const t = makeTruck(200);
        // tripT=0, state='to_resource' → mesh at dest normal * R
        expect(t.tripT).toBeCloseTo(0, 6);
        expect(t.currentSpeed).toBeCloseTo(0, 6);
        expect(t.tripState).toBe('to_resource');
        const meshDir = t.mesh.position.clone().normalize();
        // Allow some offset due to lane offset; position direction ≈ destNormal.
        expect(meshDir.dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
    });

    it('stores buildTime at construction (now epoch)', () => {
        const before = Date.now();
        const t = makeTruck(200);
        const after = Date.now();
        expect(t.buildTime).toBeGreaterThanOrEqual(before);
        expect(t.buildTime).toBeLessThanOrEqual(after);
    });
});

describe('TruckTransport — setFromCyclePosition', () => {
    it('p=0 → at_dest / to_resource at start', () => {
        const t = makeTruck(200);
        t.setFromCyclePosition(0);
        expect(t.tripState).toBe('to_resource');
        expect(t.tripT).toBeCloseTo(0, 6);
        expect(t.currentSpeed).toBeCloseTo(0, 6);
    });

    it('mid-outbound → to_resource with t in (0, 1)', () => {
        // 200 m at spec (maxSpeed=25, accel=0.5): triangle profile.
        // v_peak = sqrt(0.5 * 200) = 10 m/s. trip = 2 * v_peak/0.5 = 40 s.
        const t = makeTruck(200);
        t.setFromCyclePosition(20);   // halfway through outbound
        expect(t.tripState).toBe('to_resource');
        expect(t.tripT).toBeGreaterThan(0);
        expect(t.tripT).toBeLessThan(1);
        expect(t.currentSpeed).toBeGreaterThan(0);
    });

    it('after outbound → pause_at_resource', () => {
        const t = makeTruck(200);
        // trip ~40 s; pause_at_resource window starts there for spec.pauseTime=3s.
        t.setFromCyclePosition(41);
        expect(t.tripState).toBe('pause_at_resource');
        expect(t.tripT).toBeCloseTo(1, 6);
        expect(t.pauseRemaining).toBeGreaterThan(0);
        expect(t.pauseRemaining).toBeLessThanOrEqual(3);
    });

    it('return leg → to_home', () => {
        const t = makeTruck(200);
        // Skip outbound (~40s) + pause (3s) + small.
        t.setFromCyclePosition(40 + 3 + 5);
        expect(t.tripState).toBe('to_home');
        expect(t.tripT).toBeGreaterThan(0);
        expect(t.tripT).toBeLessThan(1);
    });

    it('full cycle wraps modulo', () => {
        const t = makeTruck(200);
        // Cycle = 2*trip + 2*pause = 2*40 + 6 = 86 s.
        const cycle = 2 * 40 + 6;
        t.setFromCyclePosition(0);
        const t0State = t.tripState;
        t.setFromCyclePosition(cycle);
        expect(t.tripState).toBe(t0State);
        expect(t.tripT).toBeCloseTo(0, 4);
    });

    it('produces monotonically increasing distance during outbound', () => {
        const t = makeTruck(200);
        t.setFromCyclePosition(5);
        const t5 = t.tripT;
        t.setFromCyclePosition(10);
        const t10 = t.tripT;
        t.setFromCyclePosition(20);
        const t20 = t.tripT;
        expect(t5).toBeLessThan(t10);
        expect(t10).toBeLessThan(t20);
    });
});

describe('TruckTransport — parkAtHome', () => {
    it('parks at home with state=pause_at_home and zero speed', () => {
        const t = makeTruck(200);
        t.setFromCyclePosition(20);   // somewhere mid-arc
        expect(t.tripState).toBe('to_resource');
        t.parkAtHome();
        expect(t.tripState).toBe('pause_at_home');
        expect(t.tripT).toBe(1);
        expect(t.currentSpeed).toBe(0);
        // Mesh at home direction.
        const meshDir = t.mesh.position.clone().normalize();
        expect(meshDir.dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
    });
});

describe('TruckTransport — fuel cost scales with arc length', () => {
    it('longer route consumes more fuel per round trip', () => {
        const tShort = makeTruck(200);
        const tLong  = makeTruck(2_000);
        expect(tLong.fuelKgPerRoundTrip).toBeGreaterThan(tShort.fuelKgPerRoundTrip);
    });
});
