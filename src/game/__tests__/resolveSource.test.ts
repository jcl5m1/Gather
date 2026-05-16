import { describe, it, expect } from 'vitest';
import { Vector3, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { Resource } from '../resource';
import { Structure, InventoryRole } from '../structure';
import { resolveSourceNormal } from '../transport';
import { R } from '../constants';

class StubStructure extends Structure {
    readonly label = 'Stub';
    readonly mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    readonly hitMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    readonly providesResource: Resource | null;
    private readonly _role: (r: Resource) => InventoryRole | null;
    constructor(normal: Vector3, providedRole: (r: Resource) => InventoryRole | null, provides: Resource | null = null) {
        super(normal);
        this._role = providedRole;
        this.providesResource = provides;
    }
    getResourceRole(r: Resource): InventoryRole | null { return this._role(r); }
    getStatsLines(): string[] { return []; }
    dispose(): void { /* noop */ }
}

const iron = new Resource('Iron', 0xb0bec5);

// A normal `arcMetres` away from `base` along a tangent direction.
function offsetNormal(base: Vector3, arcMetres: number): Vector3 {
    const tangent = new Vector3(0, 1, 0);
    // Tangent in plane perpendicular to base
    tangent.addScaledVector(base, -base.dot(tangent)).normalize();
    if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
    const theta = arcMetres / R;
    return base.clone().multiplyScalar(Math.cos(theta)).addScaledVector(tangent, Math.sin(theta)).normalize();
}

describe('resolveSourceNormal', () => {
    const dest = new Vector3(1, 0, 0).normalize();          // Homebase position

    it('prefers output-role provider over both-role fallback', () => {
        const ironPad = new StubStructure(offsetNormal(dest, 200), r => r === iron ? 'output' : null);
        const homebase = new StubStructure(dest, () => 'both');
        const out = resolveSourceNormal(iron, [homebase, ironPad], dest, dest);
        expect(out.distanceTo(ironPad.surfaceNormal)).toBeLessThan(1e-9);
    });

    it('falls back to both-role when no output exists', () => {
        const homebase = new StubStructure(dest.clone(), () => 'both');
        // destNormal excludes homebase as self → providers empty → returns fromNormal
        const out = resolveSourceNormal(iron, [homebase], dest, dest);
        expect(out.distanceTo(dest)).toBeLessThan(1e-9);
    });

    it('excludes the destination structure itself', () => {
        const homebaseAtDest = new StubStructure(dest.clone(), () => 'both');
        const ironPad = new StubStructure(offsetNormal(dest, 200), r => r === iron ? 'output' : null);
        const out = resolveSourceNormal(iron, [homebaseAtDest, ironPad], dest, dest);
        expect(out.distanceTo(ironPad.surfaceNormal)).toBeLessThan(1e-9);
    });

    it('200 m pad is NOT collapsed with destination (tight SAME_NORMAL_DOT threshold)', () => {
        const ironPad = new StubStructure(offsetNormal(dest, 200), r => r === iron ? 'output' : null);
        const out = resolveSourceNormal(iron, [ironPad], dest, dest);
        // Pad survives the destNormal exclusion — even though dot ≈ 1 - 5e-10.
        expect(out.distanceTo(ironPad.surfaceNormal)).toBeLessThan(1e-9);
    });

    it('picks closest provider when multiple outputs exist', () => {
        const near = new StubStructure(offsetNormal(dest, 200),  r => r === iron ? 'output' : null);
        const far  = new StubStructure(offsetNormal(dest, 5_000_000), r => r === iron ? 'output' : null);
        const out = resolveSourceNormal(iron, [far, near], dest, dest);
        expect(out.distanceTo(near.surfaceNormal)).toBeLessThan(1e-9);
    });

    it('returns fromNormal clone when no providers', () => {
        const out = resolveSourceNormal(iron, [], dest, dest);
        expect(out.distanceTo(dest)).toBeLessThan(1e-9);
    });
});
