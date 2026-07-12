import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Resource } from '../../src/game/resource';
import { TruckTransport } from '../../src/game/transport';
import { TransportRequest } from '../../src/game/transportRequest';
import { R } from '../../src/game/constants';

function coal(): Resource { return new Resource('Coal', 0x455a64, 1_000_000, 1000, true, 24); }

// A normal `arcMetres` from the +X axis along +Y.
function offsetNormal(arcMetres: number): Vector3 {
    const base = new Vector3(1, 0, 0);
    const theta = arcMetres / R;
    return base.clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(new Vector3(0, 1, 0), Math.sin(theta)).normalize();
}

describe('TruckTransport — idle pool member', () => {
    it('a freshly built truck is idle with no cargo', () => {
        const t = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        expect(t.isIdle).toBe(true);
        expect(t.sourceResource).toBeNull();
        expect(t.servingRequest).toBeNull();
        // parked near its current normal
        expect(t.mesh.position.clone().normalize().dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
    });
});

describe('TransportSpec — kinematics & fuel', () => {
    const spec = TruckTransport.SPEC;

    it('travelSec matches the triangular profile for short arcs', () => {
        // 200 m at a=0.5, v=25: peak below cruise → 2·sqrt(L/a) = 2·sqrt(400) = 40 s
        expect(spec.travelSec(200)).toBeCloseTo(40, 6);
    });

    it('travelSec is zero for a zero-length leg', () => {
        expect(spec.travelSec(0)).toBe(0);
    });

    it('travelSec increases monotonically with distance', () => {
        expect(spec.travelSec(2_000)).toBeGreaterThan(spec.travelSec(200));
    });

    it('fuel scales with distance', () => {
        const fuel = coal();
        expect(spec.fuelKgForKm(4, fuel)).toBeGreaterThan(spec.fuelKgForKm(0.4, fuel));
    });
});

describe('TruckTransport — job lifecycle', () => {
    // Drive an assigned truck until it delivers, mimicking index's load/deliver handling.
    function runToDelivery(t: TruckTransport, depositCap = Infinity) {
        let mined = 0;
        for (let i = 0; i < 1_000_000; i++) {
            const { load, deliver } = t.update(0.5);
            if (load) {
                const got = Math.min(load.payload, depositCap - mined);
                mined += got;
                t.setLoaded(got);
            }
            if (deliver) return deliver;
        }
        throw new Error('never delivered');
    }

    it('assignJob reserves the planned payload on the request', () => {
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 5_000);
        t.assignJob(req, offsetNormal(200));
        expect(t.isIdle).toBe(false);
        expect(t.servingRequest).toBe(req);
        expect(req.qtyInFlight).toBe(5_000);   // < payload capacity (20 t)
        expect(req.remaining).toBe(0);
    });

    it('reconciles the reservation down to the actual cargo on a short pickup', () => {
        // Truck reserves a full 20 t payload, but the source only yields 1 t.
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 50_000);
        t.assignJob(req, offsetNormal(200));

        const fullPayload = t.plannedPayloadKg;
        expect(fullPayload).toBe(20_000);          // capped at truck capacity
        expect(req.qtyInFlight).toBe(20_000);      // full reservation before pickup

        t.setLoaded(1_000);                        // source was short

        // Reservation, reported cargo, and remaining now reflect the real 1 t —
        // not the optimistic 20 t (this is what the job board reads).
        expect(req.qtyInFlight).toBe(1_000);
        expect(t.plannedPayloadKg).toBe(1_000);
        expect(req.remaining).toBe(49_000);
    });

    it('delivers the reserved payload and credits the request', () => {
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 5_000);
        t.assignJob(req, offsetNormal(200));

        const deliver = runToDelivery(t);
        expect(deliver.payload).toBe(5_000);
        expect(deliver.loaded).toBe(5_000);
        expect(deliver.fuelKg).toBeGreaterThan(0);

        // Apply index-side accounting.
        req.qtyInFlight  -= deliver.payload;
        req.qtyDelivered += deliver.loaded;
        expect(req.complete).toBe(true);

        // Truck is idle again, parked at the destination.
        expect(t.isIdle).toBe(true);
        expect(t.parkedNormal.dot(new Vector3(1, 0, 0))).toBeGreaterThan(0.999);
    });

    it('inventory rises only on delivery, not at pickup', () => {
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);   // natural, deposit > 0
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 5_000);
        t.assignJob(req, offsetNormal(200));

        const startGathered = res.gathered;
        const startDeposit  = res.deposit;
        let sawLoadWithNoInventoryGain = false;

        for (let i = 0; i < 1_000_000; i++) {
            const { load, deliver } = t.update(0.5);
            if (load) {
                const got = res.extract(load.payload);   // debits deposit, NOT inventory
                t.setLoaded(got);
                // At pickup: deposit dropped, inventory unchanged.
                sawLoadWithNoInventoryGain = res.gathered === startGathered && res.deposit < startDeposit;
            }
            if (deliver) {
                expect(sawLoadWithNoInventoryGain).toBe(true);   // pickup didn't credit inventory
                expect(res.gathered).toBe(startGathered);        // still nothing before delivery credit
                res.deliver(deliver.loaded);
                expect(res.gathered).toBe(startGathered + 5_000); // credited on delivery
                return;
            }
        }
        throw new Error('never delivered');
    });

    it('caps a trip at the vehicle payload capacity', () => {
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 1_000_000);
        t.assignJob(req, offsetNormal(200));
        expect(req.qtyInFlight).toBe(TruckTransport.SPEC.payloadKg);   // 20 t
    });

    it('abortJob releases the reservation and returns to idle', () => {
        const t   = new TruckTransport(new Scene(), coal(), new Vector3(1, 0, 0));
        const res = new Resource('Iron', 0xb0bec5);
        const req = new TransportRequest(new Vector3(1, 0, 0), 'Homebase', res, 5_000);
        t.assignJob(req, offsetNormal(200));
        t.abortJob();
        expect(t.isIdle).toBe(true);
        expect(req.qtyInFlight).toBe(0);
        expect(req.remaining).toBe(5_000);
    });
});
