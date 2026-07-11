import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { TransportRequest, TransportQueue } from '../../src/game/transportRequest';

const iron = () => new Resource('Iron', 0xb0bec5);
const dest = new Vector3(1, 0, 0);

describe('TransportRequest', () => {
    it('tracks remaining / outstanding / complete', () => {
        const req = new TransportRequest(dest, 'Homebase', iron(), 10_000);
        expect(req.remaining).toBe(10_000);
        expect(req.outstanding).toBe(10_000);
        expect(req.complete).toBe(false);

        req.qtyInFlight = 4_000;
        expect(req.remaining).toBe(6_000);      // excludes reserved
        expect(req.outstanding).toBe(10_000);   // ignores reserved

        req.qtyDelivered = 10_000;
        expect(req.remaining).toBe(0);
        expect(req.outstanding).toBe(0);
        expect(req.complete).toBe(true);
    });

    it('round-trips through JSON', () => {
        const req = new TransportRequest(dest, 'Homebase', iron(), 8_000, 42);
        req.qtyDelivered = 3_000;
        const restored = TransportRequest.fromJSON(req.toJSON(), [iron()]);
        expect(restored).not.toBeNull();
        expect(restored!.id).toBe(42);
        expect(restored!.qtyRequested).toBe(8_000);
        expect(restored!.qtyDelivered).toBe(3_000);
        expect(restored!.resource.name).toBe('Iron');
    });

    it('fromJSON returns null for an unknown resource', () => {
        const req = new TransportRequest(dest, 'Homebase', iron(), 8_000);
        expect(TransportRequest.fromJSON(req.toJSON(), [])).toBeNull();
    });

    it('round-trips the parent link (child supply requests)', () => {
        const child = new TransportRequest(dest, 'Refinery', iron(), 3_000, 7, 42);
        expect(child.parentId).toBe(42);
        const restored = TransportRequest.fromJSON(child.toJSON(), [iron()]);
        expect(restored!.parentId).toBe(42);
    });
});

describe('TransportQueue', () => {
    it('open() excludes fully-reserved and completed requests', () => {
        const q = new TransportQueue();
        const a = new TransportRequest(dest, 'A', iron(), 5_000);
        const b = new TransportRequest(dest, 'B', iron(), 5_000);
        q.add(a); q.add(b);
        expect(q.open()).toHaveLength(2);

        a.qtyInFlight = 5_000;             // fully reserved
        expect(q.open()).toEqual([b]);
    });

    it('prune() removes completed requests and reports them', () => {
        const q = new TransportQueue();
        const a = new TransportRequest(dest, 'A', iron(), 5_000);
        q.add(a);
        a.qtyDelivered = 5_000;
        expect(q.prune()).toEqual([a]);
        expect(q.requests).toHaveLength(0);
    });

    it('subtree collects a request and its transitive children', () => {
        const q = new TransportQueue();
        const root  = new TransportRequest(dest, 'Steel Refinery', iron(), 2_000);
        const iA    = new TransportRequest(dest, 'Steel Refinery', iron(), 3_000, undefined, root.id);
        const stone = new TransportRequest(dest, 'Iron Refinery',  iron(), 6_000, undefined, iA.id);
        const other = new TransportRequest(dest, 'Homebase',       iron(), 1_000);
        q.add(root); q.add(iA); q.add(stone); q.add(other);

        expect(q.childrenOf(root)).toEqual([iA]);
        const sub = q.subtree(root);
        expect(sub).toContain(root);
        expect(sub).toContain(iA);
        expect(sub).toContain(stone);
        expect(sub).not.toContain(other);
    });

    it('toJSON persists only unfinished requests', () => {
        const q = new TransportQueue();
        const a = new TransportRequest(dest, 'A', iron(), 5_000);
        const b = new TransportRequest(dest, 'B', iron(), 5_000);
        b.qtyDelivered = 5_000;            // complete
        q.add(a); q.add(b);
        const json = q.toJSON();
        expect(json).toHaveLength(1);
        expect(json[0].destName).toBe('A');
    });
});
