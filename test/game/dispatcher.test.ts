import { describe, it, expect } from 'vitest';
import { Scene, Vector3, Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { Resource } from '../../src/game/resource';
import { Structure, InventoryRole } from '../../src/game/structure';
import { TruckTransport } from '../../src/game/transport';
import { TransportQueue, TransportRequest } from '../../src/game/transportRequest';
import { dispatch, requestBlockReason } from '../../src/game/dispatcher';
import { R } from '../../src/game/constants';

class StubStructure extends Structure {
    readonly label = 'Pad';
    readonly mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    readonly hitMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    readonly providesResource: Resource;
    constructor(normal: Vector3, provides: Resource) { super(normal); this.providesResource = provides; }
    getResourceRole(r: Resource): InventoryRole | null { return r === this.providesResource ? 'output' : null; }
    getStatsLines(): string[] { return []; }
    dispose(): void { /* noop */ }
}

function offsetNormal(arcMetres: number): Vector3 {
    const base = new Vector3(1, 0, 0);
    const theta = arcMetres / R;
    return base.clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(new Vector3(0, 1, 0), Math.sin(theta)).normalize();
}

function fueledTruck(): TruckTransport {
    const coal = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
    coal.gathered = 1_000_000;   // plenty of fuel
    return new TruckTransport(new Scene(), coal, new Vector3(1, 0, 0));
}

describe('dispatch', () => {
    const dest = new Vector3(1, 0, 0);

    it('assigns an idle truck to an open request with a stocked source', () => {
        const iron = new Resource('Iron', 0xb0bec5);   // default deposit > 0
        const pad  = new StubStructure(offsetNormal(200), iron);
        const t    = fueledTruck();
        const q    = new TransportQueue();
        q.add(new TransportRequest(dest, 'Homebase', iron, 5_000));

        expect(dispatch([t], q, [pad])).toBe(1);
        expect(t.isIdle).toBe(false);
        expect(t.servingRequest).toBe(q.requests[0]);
    });

    it('does not assign when the source deposit is empty', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        iron.deposit = 0;
        const pad  = new StubStructure(offsetNormal(200), iron);
        const t    = fueledTruck();
        const q    = new TransportQueue();
        q.add(new TransportRequest(dest, 'Homebase', iron, 5_000));

        expect(dispatch([t], q, [pad])).toBe(0);
        expect(t.isIdle).toBe(true);
    });

    it('does not over-dispatch once a request is fully reserved', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        const pad  = new StubStructure(offsetNormal(200), iron);
        const a = fueledTruck(), b = fueledTruck();
        const q = new TransportQueue();
        q.add(new TransportRequest(dest, 'Homebase', iron, 5_000));   // < one truckload

        expect(dispatch([a, b], q, [pad])).toBe(1);   // only one truck needed
        expect([a, b].filter(t => !t.isIdle)).toHaveLength(1);
    });

    it('requestBlockReason classifies why a request is stuck', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        const pad  = new StubStructure(offsetNormal(200), iron);
        const req  = new TransportRequest(dest, 'Homebase', iron, 5_000);

        // dispatchable: fuelled idle truck + stocked source
        expect(requestBlockReason(req, [fueledTruck()], [pad])).toBeNull();

        // no idle transport at all
        expect(requestBlockReason(req, [], [pad])).toBe('no-transport');

        // no source in the world
        expect(requestBlockReason(req, [fueledTruck()], [])).toBe('no-source');

        // idle truck exists but has no fuel
        const dry = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
        dry.gathered = 0;
        const brokeTruck = new TruckTransport(new Scene(), dry, new Vector3(1, 0, 0));
        expect(requestBlockReason(req, [brokeTruck], [pad])).toBe('no-fuel');

        // depleted source deposit
        const empty = new Resource('Iron', 0xb0bec5);
        empty.deposit = 0;
        const emptyPad = new StubStructure(offsetNormal(200), empty);
        const emptyReq = new TransportRequest(dest, 'Homebase', empty, 5_000);
        expect(requestBlockReason(emptyReq, [fueledTruck()], [emptyPad])).toBe('no-source');
    });

    it('reports "waiting" (not blocked) when the fleet exists but is busy', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        const pad  = new StubStructure(offsetNormal(200), iron);
        const busy = fueledTruck();
        busy.assignJob(new TransportRequest(dest, 'Elsewhere', iron, 5_000), offsetNormal(200));
        const req = new TransportRequest(dest, 'Homebase', iron, 5_000);
        expect(requestBlockReason(req, [busy], [pad])).toBe('waiting');
    });

    it('reports null (in progress) once trucks are carrying loads toward it', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        const pad  = new StubStructure(offsetNormal(200), iron);
        const req  = new TransportRequest(dest, 'Homebase', iron, 5_000);
        req.qtyInFlight = 5_000;   // a truck is hauling it
        expect(requestBlockReason(req, [fueledTruck()], [pad])).toBeNull();
    });

    it('skips a truck that cannot afford the fuel', () => {
        const iron = new Resource('Iron', 0xb0bec5);
        const pad  = new StubStructure(offsetNormal(200), iron);
        const coal = new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24);
        coal.gathered = 0;   // no fuel
        const t = new TruckTransport(new Scene(), coal, new Vector3(1, 0, 0));
        const q = new TransportQueue();
        q.add(new TransportRequest(dest, 'Homebase', iron, 5_000));

        expect(dispatch([t], q, [pad])).toBe(0);
        expect(t.isIdle).toBe(true);
    });
});
