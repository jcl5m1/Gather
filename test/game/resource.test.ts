import { describe, it, expect, beforeEach } from 'vitest';
import { Resource } from '../../src/game/resource';

describe('Resource — natural deposit semantics', () => {
    let iron: Resource;
    beforeEach(() => {
        iron = new Resource('Iron', 0xb0bec5, 10_000, 1_000);  // 10 kg deposit, 1 kg tap
    });

    it('initializes deposit = depositInitial, gathered = 0', () => {
        expect(iron.deposit).toBe(10_000);
        expect(iron.depositInitial).toBe(10_000);
        expect(iron.gathered).toBe(0);
    });

    it('gather debits deposit and credits inventory', () => {
        expect(iron.gather(1000)).toBe(true);
        expect(iron.gathered).toBe(1000);
        expect(iron.deposit).toBe(9000);
    });

    it('gather returns false when deposit empty', () => {
        iron.deposit = 0;
        expect(iron.gather(100)).toBe(false);
        expect(iron.gathered).toBe(0);
    });

    it('gather clamps to remaining deposit', () => {
        iron.deposit = 300;
        expect(iron.gather(1000)).toBe(true);
        expect(iron.gathered).toBe(300);
        expect(iron.deposit).toBe(0);
    });

    it('consume debits inventory only, never restores deposit', () => {
        iron.gather(1000);
        expect(iron.consume(500)).toBe(true);
        expect(iron.gathered).toBe(500);
        expect(iron.deposit).toBe(9000);   // unchanged by consume
    });

    it('consume returns false on insufficient inventory', () => {
        expect(iron.consume(100)).toBe(false);
        expect(iron.gathered).toBe(0);
    });
});

describe('Resource — manufactured semantics', () => {
    let steel: Resource;
    beforeEach(() => {
        // depositInitial ignored when isManufactured=true
        steel = new Resource('Steel', 0x90a4ae, 999, 0, false, 0, true);
    });

    it('manufactured resource has zero deposit', () => {
        expect(steel.depositInitial).toBe(0);
        expect(steel.deposit).toBe(0);
    });

    it('gather adds to inventory without touching deposit', () => {
        expect(steel.gather(500)).toBe(true);
        expect(steel.gathered).toBe(500);
        expect(steel.deposit).toBe(0);
    });

    it('produce adds to inventory (refinery / power-plant path)', () => {
        steel.produce(2000);
        expect(steel.gathered).toBe(2000);
    });
});

describe('Resource — manufactured pickup buffer (haul accounting)', () => {
    let steel: Resource;
    beforeEach(() => { steel = new Resource('Steel', 0x90a4ae, 0, 0, false, 0, true); });

    it('produce fills BOTH spendable inventory and the pickup buffer', () => {
        steel.produce(3000);
        expect(steel.gathered).toBe(3000);   // spendable now
        expect(steel.deposit).toBe(3000);    // available for trucks to pick up
    });

    it('extract draws from the pickup buffer, not from spendable inventory', () => {
        steel.produce(3000);
        const got = steel.extract(2000);
        expect(got).toBe(2000);
        expect(steel.deposit).toBe(1000);    // buffer drained
        expect(steel.gathered).toBe(3000);   // inventory untouched — you still own it
    });

    it('extract is clamped to the buffer and returns 0 when empty', () => {
        steel.produce(500);
        expect(steel.extract(2000)).toBe(500);
        expect(steel.deposit).toBe(0);
        expect(steel.extract(1000)).toBe(0);
    });

    it('deliver is inventory-neutral for manufactured goods (already counted at produce)', () => {
        steel.produce(1000);
        steel.extract(1000);       // hauled away
        steel.deliver(1000);       // arrives at destination
        // Inventory stays at what was produced; delivered steel does NOT re-enter
        // the pickup buffer, so it can never be hauled (and credited) twice.
        expect(steel.gathered).toBe(1000);
        expect(steel.deposit).toBe(0);
    });

    it('a full produce→extract→deliver cycle cannot inflate stock past production', () => {
        // Reproduces the fixed bug: without the buffer, delivered steel looped back.
        steel.produce(1000);
        let hauled = 0;
        for (let i = 0; i < 5; i++) {           // five trucks try to grab 1000 each
            const got = steel.extract(1000);
            steel.deliver(got);
            hauled += got;
        }
        expect(hauled).toBe(1000);              // only the produced 1000 ever moves
        expect(steel.gathered).toBe(1000);
    });

    it('consume removes from both inventory and the pickup buffer', () => {
        steel.produce(2000);
        expect(steel.consume(1500)).toBe(true);
        expect(steel.gathered).toBe(500);
        expect(steel.deposit).toBe(500);       // spent steel is no longer pick-up-able
    });
});

describe('Resource — requiresExtraction flag', () => {
    it('defaults to false', () => {
        const wood = new Resource('Wood', 0x8b5e3c);
        expect(wood.requiresExtraction).toBe(false);
    });

    it('is settable to true (Oil)', () => {
        const oil = new Resource('Oil', 0x3e2723, 10_000_000, 0, true, 42.7, false, 'kg', true);
        expect(oil.requiresExtraction).toBe(true);
    });
});

describe('Resource — displayAmount uses formatScaled', () => {
    it('formats gathered inventory with kg prefixes', () => {
        const r = new Resource('Test', 0, 100_000, 0);
        r.gathered = 1500;
        expect(r.displayAmount).toBe('1.5 Mg');
    });

    it('uses kWh tail for Electricity', () => {
        const elec = new Resource('Electricity', 0, 0, 0, false, 0, true, 'kWh');
        elec.gathered = 2500;
        expect(elec.displayAmount).toBe('2.5 MWh');
    });
});
