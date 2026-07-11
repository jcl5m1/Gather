import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource, RESOURCES } from '../../src/game/resource';
import { Homebase } from '../../src/game/homebase';
import { ResourceNode } from '../../src/game/resourceNode';
import { buildWorld, KSC_NORMAL } from '../../src/game/world';
import { arcLengthM } from '../../src/game/geo';
import { RES_DIST } from '../../src/game/constants';

const N = new Vector3(0, 1, 0);

describe('Homebase', () => {
    it('acts as a both-role global staging area for every resource', () => {
        const home = new Homebase(new Scene(), N);
        for (const r of RESOURCES) expect(home.getResourceRole(r)).toBe('both');
    });
});

describe('ResourceNode', () => {
    it('provides its own resource for pickup (output role)', () => {
        const wood = new Resource('Wood', 0x8b5e3c);
        const node = new ResourceNode(new Scene(), wood, N);
        expect(node.getResourceRole(wood)).toBe('output');
    });

    it('has no role for a different resource', () => {
        const wood = new Resource('Wood', 0x8b5e3c);
        const iron = new Resource('Iron', 0xb0bec5);
        const node = new ResourceNode(new Scene(), wood, N);
        expect(node.getResourceRole(iron)).toBeNull();
    });

    it('is NOT a truck source for extraction-gated resources (e.g. Oil)', () => {
        const oil = new Resource('Oil', 0x3e2723, 1e7, 0, true, 42.7, false, 'kg', true);
        const node = new ResourceNode(new Scene(), oil, N);
        expect(node.getResourceRole(oil)).toBeNull();   // needs a dedicated OilWell
    });
});

describe('buildWorld', () => {
    it('places a homebase at KSC and one pad per natural resource', () => {
        const scene = new Scene();
        const { homebase, resourceNodes } = buildWorld(scene, RESOURCES);
        const natural = RESOURCES.filter(r => !r.isManufactured);
        expect(resourceNodes.length).toBe(natural.length);
        expect(homebase.surfaceNormal.dot(KSC_NORMAL)).toBeCloseTo(1, 6);
    });

    it('rings the pads ~RES_DIST metres from the homebase', () => {
        const scene = new Scene();
        const { resourceNodes } = buildWorld(scene, RESOURCES);
        for (const node of resourceNodes) {
            const d = arcLengthM(node.surfaceNormal, KSC_NORMAL);
            expect(d).toBeGreaterThan(RES_DIST * 0.5);
            expect(d).toBeLessThan(RES_DIST * 2);
        }
    });
});
