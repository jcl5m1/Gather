/**
 * Demo for PlotWindow - Creates plots showing bezier animation analysis
 */

import { PlotWindow } from './plotWindow';
import { G } from './config';
import { gravitationalConstantUnit } from './units';
import * as THREE from 'three';
import './performanceTest'; // Import to register benchmark function



export function createOrbitErrorPlot(): PlotWindow | null {
    // Get the simulation controller from window
    const simulationController = (window as any).simulationController;
    if (!simulationController) {
        console.error('[OrbitErrorPlot] SimulationController not available');
        return null;
    }

    // Get the game loop
    const gameLoop = simulationController.getGameLoop();
    if (!gameLoop) {
        console.error('[OrbitErrorPlot] GameLoop not available');
        return null;
    }

    // Get the Moon body (now has dual-rendering capability)
    const bodies = gameLoop.getOrbitalBodies();
    const moon = bodies.find((b: any) => b.getName() === 'Moon');

    if (!moon) {
        console.error('[OrbitErrorPlot] Moon body not found');
        return null;
    }

    // Check if dual-rendering is enabled
    if (!moon.isDualRenderingEnabled()) {
        console.warn('[OrbitErrorPlot] Dual-rendering not enabled on Moon');
    }

    // Get trajectory and orbital parameters
    const trajectory = moon.getTrajectory();
    const params = trajectory.getParameters();
    const bezierCurves = trajectory.getBezierCurves();

    if (!bezierCurves || bezierCurves.length === 0) {
        console.error('[OrbitErrorPlot] No bezier curves available');
        return null;
    }

    // Extract orbital parameters
    const period = (params.period as any).over(require('./units').seconds).value;
    const semiMajorAxis = (params._a as any).over(require('./units').kilometers).value;
    const eccentricity = params.e;

    console.log(`[OrbitErrorPlot] Period: ${period}s, a: ${semiMajorAxis}km, e: ${eccentricity}`);

    // Get initial position and velocity
    const initialPos = moon.getInitialPosition();
    const initialVel = moon.getInitialVelocity();
    const centralBodyMass = gameLoop.getCentralBody().getMass();

    // Pre-compute 100 positions
    const numPoints = 2048;
    const xData: number[] = [];
    const warpData: number[] = [];
    const errorData: number[] = [];

    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * centralBodyMass;

    // Calculate initial eccentric anomaly
    const r0 = initialPos.length();
    const radialVel0 = initialVel.dot(initialPos.clone().normalize());
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hMag = h.length();
    const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r0 - mu);
    const E0 = 2 * Math.atan(Math.sqrt((1 - eccentricity) / (1 + eccentricity)) * Math.tan(theta0 / 2));
    const M0 = E0 - eccentricity * Math.sin(E0);

    const hNorm = h.clone().normalize();
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Get the warp function from Moon (single body with dual-rendering)
    const warpFunction = moon.getTimeWarpFunction();

    // Get LUT sample positions to generate 8 points per interval
    const lutSamplePositions = moon.getLUTSamplePositions();

    // Use LUT sample positions plus intermediate samples for smoother plots
    const sortedLutPositions = [...lutSamplePositions].sort((a, b) => a - b);
    const sampleXPositions: number[] = [];
    const samplesPerInterval = 32;

    if (sortedLutPositions.length > 0) {
        for (let i = 0; i < sortedLutPositions.length - 1; i++) {
            const start = sortedLutPositions[i];
            const end = sortedLutPositions[i + 1];

            // Add start point
            sampleXPositions.push(start);

            // Add intermediate points
            for (let j = 1; j <= samplesPerInterval; j++) {
                const t = j / (samplesPerInterval + 1);
                sampleXPositions.push(start + (end - start) * t);
            }
        }
        // Add the last point
        sampleXPositions.push(sortedLutPositions[sortedLutPositions.length - 1]);
    }

    for (let i = 0; i < sampleXPositions.length; i++) {
        const normalizedTime = sampleXPositions[i];

        // Get warped time from the warp function
        const warpedTime = warpFunction(normalizedTime);

        // Calculate analytical position using shared function from OrbitalBody
        const analyticalPos = moon.computeAnalyticalPositionFromNormalizedTime(normalizedTime);

        if (!analyticalPos) continue;

        // Calculate bezier position using warped time (from single Moon body)
        const bezierPos = moon.computeWarpedBezierPosition(normalizedTime);

        // Calculate distance if bezier position exists
        let distance = 0;
        if (bezierPos) {
            distance = analyticalPos.distanceTo(bezierPos);
        }

        xData.push(normalizedTime);
        warpData.push(warpedTime);
        errorData.push(distance + 1); // Add 1 to avoid log(0) issues
    }

    // Find max values for y-axis scaling
    const maxError = Math.max(...errorData);
    const maxWarp = Math.max(...warpData);

    console.log(`[OrbitErrorPlot] Max error: ${maxError.toFixed(2)} km, Max warp: ${maxWarp.toFixed(3)}`);

    // Create separate plot windows for time warp and distance error

    // Time Warp Plot
    const warpPlotWindow = new PlotWindow({
        title: 'Time Warp Function',
        x: 50,
        y: 50,
        width: 600,
        height: 350,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: Math.max(maxWarp, 1.0) * 1.1,
        xLabel: 'Normalized Time (0-1)',
        yLabel: 'Warped Time',
    });

    // Add the warp function output
    warpPlotWindow.addData({
        x: xData,
        y: warpData,
        color: '#00ff00',  // Green for warp function
        lineWidth: 2.5,
    });

    // Add vertical lines at LUT sample positions
    const yMax = Math.max(maxWarp, 1.0) * 1.1;
    for (const sampleX of lutSamplePositions) {
        warpPlotWindow.addData({
            x: [sampleX, sampleX],
            y: [0, yMax],
            color: '#888888',  // Gray for sample markers
            lineWidth: 1.0,
        });
    }

    const lutData = moon.getLUTData();

    // Add scatter plot of LUT samples to the warp function plot
    if (lutData) {
        // Extract M and bezierT values (handling padding/wraparound if needed)
        // lutSamplePositions contains the M values (without padding)
        const scatterM: number[] = [];
        const scatterT: number[] = [];
        const scatterTooltips: string[] = [];
        const lutIndexOffset = 0; // No offset, samples align with data

        for (let i = 0; i < lutSamplePositions.length; i++) {
            const lutIdx = i + lutIndexOffset;
            if (lutIdx < lutData.M.length && lutIdx < lutData.bezierT.length) {
                const mVal = lutData.M[lutIdx];
                const tVal = lutData.bezierT[lutIdx];
                scatterM.push(mVal);
                scatterT.push(tVal);

                scatterTooltips.push(`
                    <div><strong>LUT Sample ${i}</strong></div>
                    <div>M: ${mVal.toFixed(4)}</div>
                    <div>T: ${tVal.toFixed(4)}</div>
                 `);
            }
        }

        warpPlotWindow.addData({
            x: scatterM,
            y: scatterT,
            color: '#0000ff', // Blue for scatter points
            plotType: 'scatter',
            pointSize: 4,
            tooltips: scatterTooltips
        });
    }

    // Distance Error Plot
    const errorPlotWindow = new PlotWindow({
        title: 'Bezier Position Error',
        x: 50,
        y: 420,
        width: 600,
        height: 350,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: maxError * 1.1,
        xLabel: 'Normalized Time (0-1)',
        yLabel: 'Distance Error + 1 (km)',
        yLogScale: false,
        xTickPositions: lutSamplePositions,
    });

    // Add the error curve (no scaling needed now)
    errorPlotWindow.addData({
        x: xData,
        y: errorData,
        color: '#ff6666',  // Red for error
        lineWidth: 2.5,
    });

    // Use stored optimization errors from LUT for scatter plot and create tooltips
    const lutSampleErrors: number[] = [];
    const lutTooltips: string[] = [];
    const lutIndexOffset = 0; // No offset, samples align with data

    if (lutData && lutData.errors) {
        for (let idx = 0; idx < lutSamplePositions.length; idx++) {
            // Use stored optimization error from LUT (account for padding)
            const lutIdx = idx + lutIndexOffset;

            // Safety check
            if (lutIdx >= lutData.errors.length || lutIdx >= lutData.M.length) continue;

            const optimizationError = lutData.errors[lutIdx];
            lutSampleErrors.push(optimizationError + 1); // Add 1 to match error curve offset

            // Create custom tooltip
            const M_value = lutData.M[lutIdx];
            const bezierT_value = lutData.bezierT[lutIdx];

            const tooltipHTML = `
                <div><strong>LUT Sample ${idx}</strong></div>
                <div>M: ${M_value.toFixed(4)}</div>
                <div>bezierT: ${bezierT_value.toFixed(4)}</div>
                <div>Opt Error: ${optimizationError.toFixed(2)} km</div>
            `;
            lutTooltips.push(tooltipHTML);
        }
    }

    // Add scatter plot of LUT sample errors with custom tooltips
    errorPlotWindow.addData({
        x: lutSamplePositions,
        y: lutSampleErrors,
        color: '#00ff00',  // Green for LUT samples
        plotType: 'scatter',
        pointSize: 5,
        tooltips: lutTooltips,
    });

    // Add vertical lines at LUT sample positions
    const errorYMax = maxError * 1.1;
    for (const sampleX of lutSamplePositions) {
        errorPlotWindow.addData({
            x: [sampleX, sampleX],
            y: [0, errorYMax],
            color: '#888888',  // Gray for sample markers
            lineWidth: 1.0,
        });
    }

    // Hook into game loop to update animation indicator
    const updatePlotIndicators = () => {
        // Get the current normalized time from Moon (single body with dual-rendering)
        const currentNormalizedTime = moon.getCurrentNormalizedTime();

        if (currentNormalizedTime !== null && currentNormalizedTime !== undefined) {
            warpPlotWindow.setAnimationPosition(currentNormalizedTime);
            errorPlotWindow.setAnimationPosition(currentNormalizedTime);
        }
    };

    // Register update function with game loop
    gameLoop.registerPlotUpdateCallback(updatePlotIndicators);

    // Store references globally for cleanup
    (window as any).plotWindows = {
        warp: warpPlotWindow,
        error: errorPlotWindow,
        cleanup: () => {
            gameLoop.unregisterPlotUpdateCallback(updatePlotIndicators);
        }
    };

    // Verify that recalculation at LUT positions matches stored errors
    if (lutData && lutData.errors) {
        console.log('\n=== LUT Error Verification (Detailed) ===');
        const lutIndexOffset = 0; // No offset, samples align with data
        let maxDiff = 0;

        for (let idx = 0; idx < lutSamplePositions.length; idx++) {
            const lutIdx = idx + lutIndexOffset;
            if (lutIdx >= lutData.M.length || lutIdx >= lutData.errors.length) continue;

            const sampleM = lutSamplePositions[idx];
            const storedM = lutData.M[lutIdx];
            const storedBezierT = lutData.bezierT[lutIdx];

            // Get bezierT from time warp function
            const warpedBezierT = warpFunction(sampleM);

            // Recalculate analytical position using SHARED function
            const analyticalPos = moon.computeAnalyticalPositionFromNormalizedTime(sampleM);

            if (!analyticalPos) continue;

            // Get bezier position using time warp (goes through computeWarpedBezierPosition)
            const bezierPos = moon.computeWarpedBezierPosition(sampleM);

            // Recalculate error
            const recalcError = bezierPos ? analyticalPos.distanceTo(bezierPos) : Infinity;
            const storedError = lutData.errors[lutIdx];
            const diff = Math.abs(recalcError - storedError);
            const bezierTDiff = Math.abs(warpedBezierT - storedBezierT);
            maxDiff = Math.max(maxDiff, diff);

            if (diff > 0.01 || bezierTDiff > 0.0001) { // Log if significant difference
                console.log(`  LUT[${idx}]:`);
                console.log(`    M: sample=${sampleM.toFixed(6)}, stored=${storedM.toFixed(6)}, diff=${Math.abs(sampleM - storedM).toFixed(9)}`);
                console.log(`    bezierT: warped=${warpedBezierT.toFixed(6)}, stored=${storedBezierT.toFixed(6)}, diff=${bezierTDiff.toFixed(9)}`);
                console.log(`    Error: recalc=${recalcError.toFixed(6)} km, stored=${storedError.toFixed(6)} km, diff=${diff.toFixed(6)} km`);
            }
        }
        console.log(`Max error difference: ${maxDiff.toFixed(6)} km ${maxDiff < 0.01 ? '✓ MATCH' : '⚠ MISMATCH'}`);
        console.log('==================================================\n');
    }

    // Print LUT table to console with stored optimization errors
    if (lutData && lutData.errors) {
        console.log('=== LUT (Look-Up Table) Data ===');
        console.log(`Total entries: ${lutData.M.length}`);
        console.log('\nIndex | Mean Anomaly (M) | Bezier Parameter (t) | Optimization Error (km)');
        console.log('------|------------------|----------------------|------------------------');

        for (let i = 0; i < lutData.M.length; i++) {
            const idx = String(i).padStart(5, ' ');
            const M_val = lutData.M[i].toFixed(6).padStart(10, ' ');
            const t_val = lutData.bezierT[i].toFixed(6).padStart(10, ' ');

            // Get stored optimization error (not interpolated)
            let error_val = '                  N/A';
            if (i < lutData.errors.length) {
                const optError = lutData.errors[i];
                error_val = optError.toFixed(6).padStart(22, ' ');
            }

            console.log(`${idx} | ${M_val} | ${t_val} | ${error_val}`);
        }
        console.log('================================\n');
        console.log('Note: These are the optimization errors from LUT build time,');
        console.log('      NOT the interpolated errors through the cubic spline.');
    } else {
        console.warn('[OrbitErrorPlot] LUT data not available');
    }

    // Return the warp plot window (for backward compatibility)
    // Both windows will be displayed
    return warpPlotWindow;
}

// Alias for backward compatibility
export function createSinePlotDemo(): PlotWindow | null {
    return createOrbitErrorPlot();
}

// Make it available globally for easy testing via console
(window as any).createSinePlotDemo = createSinePlotDemo;
(window as any).createOrbitErrorPlot = createOrbitErrorPlot;
// Alias for backward compatibility

