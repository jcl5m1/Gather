
import { Trajectory } from './trajectory';

interface BenchmarkOptions {
    numSamples?: number;
    skipAnalytical?: boolean;
    onlyGPU?: boolean;
}

// Update signature to accept number (legacy) or options object
export function runPerformanceBenchmark(args: number | BenchmarkOptions = 1000000) {
    let numSamples = 1000000;
    let skipAnalytical = false;
    let onlyGPU = false;

    if (typeof args === 'number') {
        numSamples = args;
    } else {
        numSamples = args.numSamples ?? 1000000;
        skipAnalytical = args.skipAnalytical ?? false;
        onlyGPU = args.onlyGPU ?? false;
    }

    if (onlyGPU) {
        skipAnalytical = true;
    }

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

    let timeAnalytical = 0;
    let timeLinear = 0;
    let timeCubic = 0;

    // 1. Analytical Method
    if (!skipAnalytical) {
        const startAnalytical = performance.now();
        for (const t of testTimes) {
            trajectory.getPosition(t, 'analytical');
        }
        const endAnalytical = performance.now();
        timeAnalytical = endAnalytical - startAnalytical;
    }

    // 2. Bezier with Linear Interpolation
    if (!onlyGPU) {
        trajectory.setInterpolationMode('linear');
        const startLinear = performance.now();
        for (const t of testTimes) {
            trajectory.getPosition(t, 'bezier');
        }
        const endLinear = performance.now();
        timeLinear = endLinear - startLinear;
    }

    // 3. Bezier with Cubic (Bezier) Interpolation
    if (!onlyGPU) {
        trajectory.setInterpolationMode('cubic');
        const startCubic = performance.now();
        for (const t of testTimes) {
            trajectory.getPosition(t, 'bezier');
        }
        const endCubic = performance.now();
        timeCubic = endCubic - startCubic;
    }

    // 4. GPU Computation
    const startGPU = performance.now();
    // Warmup? First run might compile shaders.
    // Let's run once to warm up if needed, but for fair cold-benchmark let's just run.
    const gpuResult = trajectory.computePositionsGPU(testTimes);
    const endGPU = performance.now();
    const timeGPU = endGPU - startGPU;

    // Reset to default
    trajectory.setInterpolationMode('cubic');

    // Print Results
    console.log('\n=== Orbit Position Calculation Benchmark ===');
    console.log(`Samples: ${numSamples} `);
    console.log('-------------------------------------------');

    if (!skipAnalytical) {
        console.log(`Analytical Method:        ${timeAnalytical.toFixed(2)} ms(${(timeAnalytical / numSamples).toFixed(4)} ms / op)`);
    } else {
        console.log(`Analytical Method: SKIPPED`);
    }

    if (!onlyGPU) {
        console.log(`Bezier(Linear Warp):     ${timeLinear.toFixed(2)} ms(${(timeLinear / numSamples).toFixed(4)} ms / op)`);
        console.log(`Bezier(Bezier Warp):     ${timeCubic.toFixed(2)} ms(${(timeCubic / numSamples).toFixed(4)} ms / op)`);
    } else {
        console.log(`Bezier(CPU): SKIPPED`);
    }

    if (gpuResult) {
        console.log(`GPU Compute(Batch):      ${timeGPU.toFixed(2)} ms(${(timeGPU / numSamples).toFixed(6)} ms / op)`);
    } else {
        console.log(`GPU Compute(Batch): FAILED`);
    }

    console.log('-------------------------------------------');

    if (!skipAnalytical && !onlyGPU) {
        const speedupLinear = timeAnalytical / timeLinear;
        const speedupCubic = timeAnalytical / timeCubic;

        console.log(`Speedup(Linear vs Analytical): ${speedupLinear.toFixed(2)} x`);
        console.log(`Speedup(Bezier vs Analytical): ${speedupCubic.toFixed(2)} x`);
    }

    if (gpuResult && timeGPU > 0 && !skipAnalytical) {
        const speedupGPU = timeAnalytical / timeGPU;
        console.log(`Speedup(GPU vs Analytical):    ${speedupGPU.toFixed(2)} x`);
    }

    if (gpuResult && timeGPU > 0 && !onlyGPU && timeCubic > 0) {
        const speedupGPUVsCPU = timeCubic / timeGPU;
        console.log(`Speedup(GPU vs Bezier CPU):    ${speedupGPUVsCPU.toFixed(2)} x`);
    }

    console.log('===========================================\n');
}

// Expose to window
(window as any).runPerformanceBenchmark = runPerformanceBenchmark;

