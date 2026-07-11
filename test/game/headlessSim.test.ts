import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { runHeadlessSim, SimEvent } from './headlessSim';

// Runs the whole game simulation headlessly (no UI) through GameEngine at 10x and
// writes every transport event to a log file for debugging. Also asserts the haul
// accounting is sound — that a fulfilled request's credited amount equals what
// actually arrived at the destination.
// timeScale is configurable so the sim can be driven at 100x: `SIM_TIMESCALE=100`.
const TIME_SCALE = Number(process.env.SIM_TIMESCALE) || 10;

describe(`headless simulation (${TIME_SCALE}x)`, () => {
    it('runs the steel supply chain and logs every transport event', () => {
        const logDir = join(process.cwd(), 'logs');
        mkdirSync(logDir, { recursive: true });
        const eventLog: string[] = [];

        const result = runHeadlessSim({
            timeScale: TIME_SCALE,
            trucks: 3,
            steelRequestKg: 20_000,
            onEvent: (e: SimEvent) => eventLog.push(JSON.stringify(e)),
        });

        // Persist the per-event log (JSON lines) + a human-readable summary.
        writeFileSync(join(logDir, 'headless-sim.jsonl'), eventLog.join('\n') + '\n');
        const summary =
            `Headless sim @${TIME_SCALE}x — ${result.simSeconds}s sim time, ${result.steps} frames\n` +
            `  steel requested:          ${result.requested}\n` +
            `  request credited (qtyDelivered): ${result.credited}\n` +
            `  request fulfilled:        ${result.fulfilled}\n` +
            `  steel ACTUALLY delivered to Homebase: ${result.steelActuallyDelivered}\n` +
            `  steel produced by refinery:          ${result.steelProduced}\n` +
            `  steel inventory at end:              ${result.steelInventoryEnd}\n`;
        writeFileSync(join(logDir, 'headless-sim-summary.txt'), summary);
        // Surface it in the test output too.
        // eslint-disable-next-line no-console
        console.log('\n' + summary);

        // The simulation actually progressed.
        expect(result.events.length).toBeGreaterThan(0);
        expect(result.steelProduced).toBeGreaterThan(0);

        // Accounting soundness: you can never deliver more than was produced.
        // (This is the "delivered popup vs. amount that arrived" bug — before the
        // fix, delivered steel looped back into the source and got hauled again,
        // so credited/delivered exceeded steelProduced.)
        expect(result.credited).toBeLessThanOrEqual(result.steelProduced + 1e-6);
        expect(result.steelActuallyDelivered).toBeLessThanOrEqual(result.steelProduced + 1e-6);

        // The request should genuinely complete: enough was produced and the
        // player actually holds the requested amount.
        expect(result.fulfilled).toBe(true);
        expect(result.credited).toBeCloseTo(result.requested, 3);
        expect(result.steelProduced).toBeGreaterThanOrEqual(result.requested - 1e-6);
        expect(result.steelInventoryEnd).toBeGreaterThanOrEqual(result.requested - 1e-6);
    }, 30_000);
});
