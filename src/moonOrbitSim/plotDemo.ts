/**
 * Demo for PlotWindow - Creates plots showing bezier animation analysis
 */

import { PlotWindow } from './plotWindow';
import { G } from './config';
import { gravitationalConstantUnit } from './units';
import * as THREE from 'three';
import './performanceTest'; // Import to register benchmark function
import { OrbitalBody } from './orbitalBody';

// Global state for plot window tracking (simple singleton-ish pattern to avoid duplicates if desired, 
// though the user might want multiple. For now, we'll replace the existing ones if they exist 
// to avoid clutter or create new ones if requested.)
interface PlotSet {
    warp: PlotWindow;
    error: PlotWindow;
    cleanup: () => void;
    bodyName: string;
}

let activePlotSet: PlotSet | null = null;

export function createOrbitErrorPlot(targetBody?: OrbitalBody | null): PlotWindow | null {
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

    // Determine initial body to track
    let currentBody: OrbitalBody | null = targetBody || null;

    if (!currentBody) {
        // Find Moon by default
        const bodies = gameLoop.getOrbitalBodies();
        const moon = bodies.find((b: any) => b.getName() === 'Moon');
        if (moon) {
            currentBody = moon;
        } else if (bodies.length > 0) {
            currentBody = bodies[0];
        }
    }

    if (!currentBody) {
        console.error('[OrbitErrorPlot] No orbital body found to track');
        return null;
    }

    console.log(`[OrbitErrorPlot] Initializing plots for body: ${currentBody.getName()}`);

    // Clean up existing plots if they exist (optional, but good for "resetting" the view)
    // The requirement is "refactor... to take an orbitalBody as a parameter".
    // If we call this multiple times, maybe we want multiple windows?
    // But `index.ts` calls it once. And `createSinePlotDemo` is an alias.
    // Let's assume we want one set of "Analysis Windows" that tracks the "Selected" body or the "Passed" body.

    // If we already have an active plot set, we might want to close it? 
    // Or just return it if it's the same body?
    if (activePlotSet) {
        // For now, let's close the old ones to avoid overlapping windows unless we want multi-window comparison.
        // Given the UI layout (fixed x/y), overlapping is likely.
        activePlotSet.warp.close();
        activePlotSet.error.close();
        activePlotSet.cleanup();
        activePlotSet = null;
    }

    // Initialize Plot Windows
    const warpPlotWindow = new PlotWindow({
        title: `Time Warp: ${currentBody.getName()}`,
        x: 50,
        y: 50,
        width: 600,
        height: 350,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        xLabel: 'Normalized Time (0-1)',
        yLabel: 'Warped Time',
    });

    const errorPlotWindow = new PlotWindow({
        title: `Bezier Position Error: ${currentBody.getName()}`,
        x: 50,
        y: 420,
        width: 600,
        height: 350,
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        xLabel: 'Normalized Time (0-1)',
        yLabel: 'Distance Error + 1 (km)',
        yLogScale: false,
    });

    // Helper function to update plot data for a specific body
    const updatePlotData = (body: OrbitalBody) => {
        // Update titles
        warpPlotWindow.setTitle(`Time Warp: ${body.getName()}`);
        errorPlotWindow.setTitle(`Bezier Position Error: ${body.getName()}`);

        warpPlotWindow.clearData();
        errorPlotWindow.clearData();

        // Get trajectory and orbital parameters
        const trajectory = body.getTrajectory();
        if (!trajectory) return;

        // Check if dual-rendering is enabled (implying we have bezier + analytical comparison)
        // Even if not enabled, we might have the trajectory data to plot "theoretical" error?
        // But `computeWarpedBezierPosition` might rely on internal state or standard bezier logic.

        const params = trajectory.getParameters();
        const bezierCurves = trajectory.getBezierCurves();

        if (!bezierCurves || bezierCurves.length === 0) {
            return;
        }

        // Get LUT sample positions
        const lutSamplePositions = body.getLUTSamplePositions();

        // Generate uniform sample points
        const sampleXPositions: number[] = [];
        const samplesPerInterval = 32;

        // Combine LUT positions with intermediate points
        const sortedLutPositions = [...lutSamplePositions].sort((a, b) => a - b);
        if (sortedLutPositions.length > 0) {
            // Ensure 0 and 1 are included? LUT usually covers full range if closed orbit.
            // If open orbit (hyperbolic), normalized time might behave differently.

            for (let i = 0; i < sortedLutPositions.length - 1; i++) {
                const start = sortedLutPositions[i];
                const end = sortedLutPositions[i + 1];
                sampleXPositions.push(start);
                for (let j = 1; j <= samplesPerInterval; j++) {
                    const t = j / (samplesPerInterval + 1);
                    sampleXPositions.push(start + (end - start) * t);
                }
            }
            sampleXPositions.push(sortedLutPositions[sortedLutPositions.length - 1]);
        } else {
            for (let i = 0; i <= 100; i++) sampleXPositions.push(i / 100);
        }

        const xData: number[] = [];
        const warpData: number[] = [];
        const errorData: number[] = [];

        // Warp function
        const warpFunction = body.getTimeWarpFunction();
        if (!warpFunction) return;

        for (let i = 0; i < sampleXPositions.length; i++) {
            const normalizedTime = sampleXPositions[i];
            const warpedTime = warpFunction(normalizedTime);

            // Analytical pos
            const analyticalPos = body.computeAnalyticalPositionFromNormalizedTime(normalizedTime);
            if (!analyticalPos) continue;

            // Bezier pos (warped)
            // Note: computeWarpedBezierPosition calls computeBezierPositionFromTime(warpFunction(t))
            const bezierPos = body.computeWarpedBezierPosition(normalizedTime);

            let distance = 0;
            if (bezierPos) {
                distance = analyticalPos.distanceTo(bezierPos);
            }

            xData.push(normalizedTime);
            warpData.push(warpedTime);
            errorData.push(distance + 1); // +1 for log scaling safety/visibility
        }

        // Max values
        const maxError = Math.max(...errorData);
        const maxWarp = Math.max(...warpData);

        // -- Warp Plot --
        warpPlotWindow.setYRange(0, Math.max(maxWarp, 1.0) * 1.1);
        warpPlotWindow.addData({
            x: xData,
            y: warpData,
            color: '#00ff00',
            lineWidth: 2.5,
        });

        // Vertical lines at LUT positions
        const yMaxWarp = Math.max(maxWarp, 1.0) * 1.1;
        for (const sampleX of lutSamplePositions) {
            warpPlotWindow.addData({
                x: [sampleX, sampleX],
                y: [0, yMaxWarp],
                color: '#888888',
                lineWidth: 1.0,
            });
        }

        // LUT Scatter (Warp)
        const lutData = body.getLUTData();
        if (lutData) {
            const scatterM: number[] = [];
            const scatterT: number[] = [];
            const scatterTooltips: string[] = [];

            for (let i = 0; i < lutSamplePositions.length; i++) {
                if (i < lutData.M.length && i < lutData.bezierT.length) {
                    const mVal = lutData.M[i];
                    const tVal = lutData.bezierT[i];
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
                color: '#0000ff',
                plotType: 'scatter',
                pointSize: 4,
                tooltips: scatterTooltips
            });
        }

        // -- Error Plot --
        errorPlotWindow.setYRange(0, maxError * 1.1);
        errorPlotWindow.setXTickPositions(lutSamplePositions);
        errorPlotWindow.addData({
            x: xData,
            y: errorData,
            color: '#ff6666',
            lineWidth: 2.5,
        });

        // Optimization Errors Scatter
        const lutSampleErrors: number[] = [];
        const lutTooltips: string[] = [];
        if (lutData && lutData.errors) {
            for (let idx = 0; idx < lutSamplePositions.length; idx++) {
                if (idx >= lutData.errors.length) continue;
                const err = lutData.errors[idx];
                lutSampleErrors.push(err + 1);
                lutTooltips.push(`
                    <div><strong>LUT Sample ${idx}</strong></div>
                    <div>Opt Error: ${err.toFixed(4)} km</div>
                `);
            }
        }
        errorPlotWindow.addData({
            x: lutSamplePositions,
            y: lutSampleErrors,
            color: '#00ff00',
            plotType: 'scatter',
            pointSize: 5,
            tooltips: lutTooltips,
        });

        // Vertical lines (Error)
        const errorYMax = maxError * 1.1;
        for (const sampleX of lutSamplePositions) {
            errorPlotWindow.addData({
                x: [sampleX, sampleX],
                y: [0, errorYMax],
                color: '#888888',
                lineWidth: 1.0,
            });
        }
    };

    // Initial Data Load
    if (currentBody) {
        updatePlotData(currentBody);
    }

    // Update Callback (Optimization: check for selection change if no specific body was passed?)
    // The user said "tie the plots to that particular orbitalBody's trajectory". 
    // This implies if I pass `Moon`, it should ALWAYS plot Moon, regardless of selection.
    // BUT the previous request was "matches the currently selected body animation".
    // AND "refactor ... to take an orbitalBody as a parameter".

    // Combining these:
    // If a body is passed, plot THAT body. 
    // If NO body is passed (default call from index.ts), behave as "Track Selected".

    // Variable to track which body we are currently viewing
    let trackedBody: OrbitalBody | null = targetBody || null;
    let trackedBodyName: string | null = trackedBody ? trackedBody.getName() : null;

    // If we are in "Tracking Mode" (no explicit body), we rely on the camera manager
    const isTrackingMode = !targetBody;

    if (isTrackingMode && currentBody) {
        // Initialize tracking with the default found body (Moon/First)
        trackedBody = currentBody;
        trackedBodyName = currentBody.getName();
    }

    const updatePlotIndicators = () => {
        // 1. Handle Selection Change (Only in Tracking Mode)
        if (isTrackingMode) {
            const cameraManager = gameLoop.getCameraManager();
            if (cameraManager) {
                const selectedName = cameraManager.getCurrentTargetName();
                if (selectedName && selectedName !== trackedBodyName && selectedName !== 'Earth') {
                    // Try to find the new body
                    const bodies = gameLoop.getOrbitalBodies();
                    const newBody = bodies.find((b: any) => b.getName() === selectedName);
                    if (newBody) {
                        trackedBody = newBody;
                        trackedBodyName = selectedName;
                        updatePlotData(newBody);
                    }
                }
            }
        }

        // 2. Update Animation Position (Cursor)
        if (trackedBody) {
            const currentNormalizedTime = trackedBody.getCurrentNormalizedTime();
            if (currentNormalizedTime !== null && currentNormalizedTime !== undefined) {
                warpPlotWindow.setAnimationPosition(currentNormalizedTime);
                errorPlotWindow.setAnimationPosition(currentNormalizedTime);
            }
        }
    };

    gameLoop.registerPlotUpdateCallback(updatePlotIndicators);

    // Save global state
    activePlotSet = {
        warp: warpPlotWindow,
        error: errorPlotWindow,
        cleanup: () => {
            gameLoop.unregisterPlotUpdateCallback(updatePlotIndicators);
        },
        bodyName: trackedBodyName || 'Unknown'
    };

    // Store references globally for console access/cleanup
    (window as any).plotWindows = activePlotSet;

    return warpPlotWindow;
}

// Alias for backward compatibility
export function createSinePlotDemo(): PlotWindow | null {
    return createOrbitErrorPlot();
}

// Make it available globally
(window as any).createSinePlotDemo = createSinePlotDemo;
(window as any).createOrbitErrorPlot = createOrbitErrorPlot;
