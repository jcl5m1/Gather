/**
 * Demo for PlotWindow - Creates plots showing bezier animation analysis
 */

import { PlotWindow } from './plotWindow';
import './performanceTest'; // Import to register benchmark function
import { OrbitalBody } from './orbitalBody';
import { calculateEllipticalVelocity } from './orbitUtils';
import { seconds, kilometers } from './units';
import { config } from './config';
import * as THREE from 'three';

// Global state for plot window tracking
interface PlotSet {
    warp: PlotWindow;
    error: PlotWindow;
    velocity: PlotWindow;
    cleanup: () => void;
    bodyName: string;
}

let activePlotSet: PlotSet | null = null;

export function createOrbitErrorPlot(targetBody?: OrbitalBody | null): PlotWindow | null {
    if (!config.visualization.enablePlots) {
        return null;
    }
    // No-op for now, focus on velocity plot
    return null;
}

export function createVelocityComparisonPlot(targetBody: OrbitalBody): PlotWindow | null {
    if (!config.visualization.enablePlots) return null;

    const trajectory = targetBody.getTrajectory();
    if (!trajectory || trajectory.type !== 'elliptical') {
        console.warn('Velocity plot requires elliptical trajectory');
        return null;
    }

    const params = trajectory.getParameters();
    const period = (params.period as any).over(seconds).value;
    const a = (params._a as any).over(kilometers).value;
    const e = params.e;
    // We need start time and other params which are private in Trajectory
    // But calculateEllipticalVelocity needs them.
    // Trajectory stores them but they are private.
    // However, we can use 0 start time relative to Periapsis/Apoapsis if we align correctly.
    // Or we can ask Trajectory to verify its internal state?
    // Actually, calculateEllipticalVelocity is what Trajectory uses.

    // We can iterate over time 0->Period.
    // Trajectory.startTime is used for alignment.
    // If we just plot one full orbit, the absolute time doesn't matter as much as relative time.

    // HOWEVER, Trajectory.getBezierVelocity(time) USES internal startTime.
    // So we must access it or match it.
    // Trajectory doesn't expose startTime publically.
    // Accessing via `any` for debug purposes as this is a dev tool.
    const startTime = (trajectory as any)._startTime || 0;
    const initialPos = (trajectory as any)._initialPosition;
    const initialVel = (trajectory as any)._initialVelocity;
    const mass = (trajectory as any)._centralBodyMass;

    // Create Plot Window
    const win = new PlotWindow({
        title: `Velocity Error: ${targetBody.getName() ? targetBody.getName() : 'Unknown'}`,
        x: 400,
        y: 50,
        width: 600,
        height: 400,
        xLabel: 'Normalized Time (t/T)',
        yLabel: 'Velocity (km/s)',
        backgroundColor: 'rgba(0, 0, 0, 0.9)'
    });

    const numSamples = 200;
    const analyticalMag: number[] = [];
    const bezierMag: number[] = [];
    const error: number[] = [];
    const times: number[] = [];

    for (let i = 0; i <= numSamples; i++) {
        const normalizedT = i / numSamples;
        const t = startTime + (period * normalizedT);
        times.push(normalizedT); // Normalized time for X axis

        // Analytical
        const vAnaVec = calculateEllipticalVelocity(
            t, a, e, period, startTime, initialPos, initialVel, mass
        );
        const vAna = vAnaVec.length();
        analyticalMag.push(vAna);

        // Bezier
        const vBezVec = trajectory.getBezierVelocity(t);
        let vBez = 0;
        if (vBezVec) {
            vBez = vBezVec.length();
        } else {
            console.warn(`Bezier velocity null at t=${t}`);
        }
        bezierMag.push(vBez);

        // Error
        error.push(Math.abs(vAna - vBez));
    }

    /*
    win.addData({
        x: times,
        y: analyticalMag,
        color: '#00ff00',
        lineWidth: 2,
        plotType: 'line',
        tooltips: times.map((t, i) => `T: ${t.toFixed(3)}<br>Ana: ${analyticalMag[i].toFixed(4)} km/s`)
    });

    win.addData({
        x: times,
        y: bezierMag,
        color: '#ff0000',
        lineWidth: 2,
        plotType: 'line', // Dashed? PlotWindow doesn't support custom dash easily yet, maybe points?
        pointSize: 2,
        tooltips: times.map((t, i) => `T: ${t.toFixed(3)}<br>Bez: ${bezierMag[i].toFixed(4)} km/s`)
    });
    */

    // Plot Error
    win.addData({
        x: times,
        y: error,
        color: '#ffff00',
        lineWidth: 2,
        plotType: 'line',
        tooltips: times.map((t, i) => `T: ${t.toFixed(3)}<br>Error: ${error[i].toExponential(2)} km/s`)
    });

    win.setXRange(0, 1.0);

    // Auto-scale Y range
    const minError = Math.min(...error);
    const maxError = Math.max(...error);
    // Add 10% padding to max, floor min at 0
    const yMax = maxError > 0 ? maxError * 1.1 : 1.0;
    win.setYRange(0, yMax);

    // Focus Tracking Logic
    const controller = (window as any).simulationController;
    if (controller) {
        // Register update callback for animation indicator
        const gameLoop = controller.getGameLoop();
        gameLoop.registerPlotUpdateCallback(() => {
            // Check for Focus Change First
            const cameraManager = gameLoop.getCameraManager();
            if (cameraManager) {
                const currentTarget = cameraManager.getTarget();
                // If target exists, is elliptical, and is different from currently tracked body
                if (currentTarget && currentTrackedBody && currentTarget !== currentTrackedBody) {
                    const traj = currentTarget.getTrajectory();
                    if (traj && traj.type === 'elliptical') {
                        console.log(`[Plot] Switching velocity plot to ${currentTarget.getName()}`);
                        currentTrackedBody = currentTarget;
                        updatePlotDataForBody(win, currentTarget);
                    }
                }
            }

            // Update Animation Indicator using current tracked body
            if (currentTrackedBody) {
                const normalizedTime = currentTrackedBody.getCurrentNormalizedTime();
                win.setAnimationPosition(normalizedTime);
            }
        });
    }

    // Store as active
    // Store as active
    activePlotSet = {
        warp: win, // reusing type definition though it's error plot
        error: win,
        velocity: win,
        cleanup: () => { },
        bodyName: targetBody.getName()
    };
    currentTrackedBody = targetBody;

    return win;
}

// Helper to update an existing window with new body data
function updatePlotDataForBody(win: PlotWindow, body: OrbitalBody) {
    const trajectory = body.getTrajectory();
    if (!trajectory || trajectory.type !== 'elliptical') return;

    win.setTitle(`Velocity Error: ${body.getName()}`);
    win.clearData();

    const params = trajectory.getParameters();
    const period = (params.period as any).over(seconds).value;
    const a = (params._a as any).over(kilometers).value;
    const e = params.e;
    const startTime = (trajectory as any)._startTime || 0;
    const initialPos = (trajectory as any)._initialPosition;
    const initialVel = (trajectory as any)._initialVelocity;
    const mass = (trajectory as any)._centralBodyMass;

    const numSamples = 200;
    const error: number[] = [];
    const times: number[] = [];

    for (let i = 0; i <= numSamples; i++) {
        const normalizedT = i / numSamples;
        const t = startTime + (period * normalizedT);
        times.push(normalizedT);

        // Analytical
        const vAnaVec = calculateEllipticalVelocity(
            t, a, e, period, startTime, initialPos, initialVel, mass
        );
        const vAna = vAnaVec.length();

        // Bezier
        const vBezVec = trajectory.getBezierVelocity(t);
        let vBez = 0;
        if (vBezVec) {
            vBez = vBezVec.length();
        }

        // Error
        error.push(Math.abs(vAna - vBez));
    }

    win.addData({
        x: times,
        y: error,
        color: '#ffff00',
        lineWidth: 2,
        plotType: 'line',
        tooltips: times.map((t, i) => `T: ${t.toFixed(3)}<br>Error: ${error[i].toExponential(2)} km/s`)
    });

    // Auto-scale Y
    const maxError = Math.max(...error);
    const yMax = maxError > 0 ? maxError * 1.1 : 1.0;
    win.setYRange(0, yMax);

    // Update global state tracking so we know we switched
    if (activePlotSet) {
        activePlotSet.bodyName = body.getName();
    }

    // NOTE: The update callback in registerPlotUpdateCallback still closes over the OLD body.
    // This is a problem. The animation indicator will track the OLD body.
    // We need to update the callback or make the callback read from a shared source.
}

let plotUpdateLoopRegistered = false;
let currentTrackedBody: OrbitalBody | null = null;



// Alias for backward compatibility
export function createSinePlotDemo(): PlotWindow | null {
    return createOrbitErrorPlot();
}

// Global exposure
(window as any).createSinePlotDemo = createSinePlotDemo;
(window as any).createOrbitErrorPlot = createOrbitErrorPlot;
(window as any).createVelocityComparisonPlot = createVelocityComparisonPlot;
