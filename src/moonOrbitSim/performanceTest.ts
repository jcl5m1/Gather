
import { Trajectory } from './trajectory';

/**
 * Run a performance benchmark comparing different orbit calculation methods
 */
// Update signature and default
export function runPerformanceBenchmark(numSamples: number = 1000000) {
    // ...
    // Note: numSamples declaration inside function removed as it is now an argument
    // Get simulation controller
    const simulationController = (window as any).simulationController;
    if (!simulationController) {
        console.error('[Benchmark] SimulationController not available');
        return;
    }

    const gameLoop = simulationController.getGameLoop();
    if (!gameLoop) {
        console.error('[Benchmark] GameLoop not available');
        return;
    }

    // Get Moon body
    const bodies = gameLoop.getOrbitalBodies();
    const moon = bodies.find((b: any) => b.getName() === 'Moon');

    if (!moon) {
        console.error('[Benchmark] Moon body not found');
        return;
    }

    const trajectory = moon.getTrajectory() as Trajectory;
    if (!trajectory) {
        console.error('[Benchmark] Trajectory not available');
        return;
    }

    // Parameters
    const params = trajectory.getParameters();
    // Use 'any' casting to access unit-wrapped values if necessary, or just rely on public API
    // Period is a Measure<Time>, enable access via 'any' if types are strict
    const period = (params.period as any).over(require('./units').seconds).value;

    // Generate random times within one period
    // const numSamples used from argument
    const testTimes: number[] = [];
    // Start time of simulation
    const startTime = 0;

    for (let i = 0; i < numSamples; i++) {
        testTimes.push(startTime + Math.random() * period);
    }

    console.log(`[Benchmark] Starting benchmark with ${numSamples} samples...`);

    // 1. Analytical Method
    const startAnalytical = performance.now();
    for (const t of testTimes) {
        trajectory.getPosition(t, 'analytical');
    }
    const endAnalytical = performance.now();
    const timeAnalytical = endAnalytical - startAnalytical;

    // 2. Bezier with Linear Interpolation
    trajectory.setInterpolationMode('linear');
    const startLinear = performance.now();
    for (const t of testTimes) {
        trajectory.getPosition(t, 'bezier');
    }
    const endLinear = performance.now();
    const timeLinear = endLinear - startLinear;

    // 3. Bezier with Cubic (Bezier) Interpolation
    trajectory.setInterpolationMode('cubic');
    const startCubic = performance.now();
    for (const t of testTimes) {
        trajectory.getPosition(t, 'bezier');
    }
    const endCubic = performance.now();
    const timeCubic = endCubic - startCubic;

    // Reset to default
    trajectory.setInterpolationMode('cubic');

    // Print Results
    console.log('\n=== Orbit Position Calculation Benchmark ===');
    console.log(`Samples: ${numSamples}`);
    console.log('-------------------------------------------');
    console.log(`Analytical Method:        ${timeAnalytical.toFixed(2)} ms (${(timeAnalytical / numSamples).toFixed(4)} ms/op)`);
    console.log(`Bezier (Linear Warp):     ${timeLinear.toFixed(2)} ms (${(timeLinear / numSamples).toFixed(4)} ms/op)`);
    console.log(`Bezier (Bezier Warp):     ${timeCubic.toFixed(2)} ms (${(timeCubic / numSamples).toFixed(4)} ms/op)`);
    console.log('-------------------------------------------');

    const speedupLinear = timeAnalytical / timeLinear;
    const speedupCubic = timeAnalytical / timeCubic;

    console.log(`Speedup (Linear vs Analytical): ${speedupLinear.toFixed(2)}x`);
    console.log(`Speedup (Bezier vs Analytical): ${speedupCubic.toFixed(2)}x`);
    console.log('===========================================\n');
}

// Expose to window
(window as any).runPerformanceBenchmark = runPerformanceBenchmark;
