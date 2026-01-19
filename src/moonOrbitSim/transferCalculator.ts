import * as THREE from 'three';
import { OrbitalBody } from './orbitalBody';
import { G } from './config';
import { gravitationalConstantUnit, kilometers, seconds, squareKilometersPerSecondSquared, cubicKilometersPerSecondSquared, Measure, Length, Velocity, formatTime } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { 
    calculateEllipticalPosition, 
    calculateEllipticalVelocity, 
    calculateHyperbolicPosition, 
    calculateHyperbolicVelocity,
    calculateOrbitalElementsFromState
} from './orbitUtils';

/**
 * Result of a transfer calculation
 */
export interface TransferResult {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    deltaV1: number; // Delta-V required at start (km/s)
    deltaV2: number; // Delta-V required at end (km/s)
    timeOfFlight: number; // Seconds
    startPosition: THREE.Vector3;
    endPosition: THREE.Vector3;
    startVelocity: THREE.Vector3;
    endVelocity: THREE.Vector3;
    startDelay: number; // Seconds to wait before starting transfer
}

/**
 * Result of a global optimization search including heatmap data for visualization
 */
export interface GlobalOptimizationResult {
    result: TransferResult | null;
    heatmap: {
        x: number[];
        y: number[];
        z: number[][];
        zMin: number;
        zMax: number;
        tooltips: string[][];
    };
}

/**
 * Calculator for orbital transfers
 */
export class TransferCalculator {

    /**
     * Calculate a simplified transfer between two bodies
     * Now uses Lambert solver for generalized non-coplanar transfers.
     * Uses current physical state for propagation to ensure accuracy.
     */
    static calculateHohmannTransfer(
        startBody: OrbitalBody, 
        endBody: OrbitalBody, 
        centralBodyMass: number,
        startTime: number = 0,
        startDelay: number = 0,
        timeOfFlight?: number // Optional TOF override
    ): TransferResult | null {
        
        const evalTime = startTime + startDelay;

        // Setup physics constants
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        // 1. Get positions at evaluation time based on CURRENT state prediction
        // This ensures we account for numerical drift or manual state changes
        const rocketState = this.predictState(startBody, centralBodyMass, mu, startTime, evalTime);
        const r1Vec = rocketState.pos;
        const v1Vec = rocketState.vel;
        
        // 2. Determine target position at arrival
        const targetStateNow = this.predictState(endBody, centralBodyMass, mu, startTime, evalTime);
        const r2Vec_now = targetStateNow.pos;
        
        if (!r1Vec || !r2Vec_now) return null;

        if (!timeOfFlight) {
            const r1 = r1Vec.length();
            const r2 = r2Vec_now.length();
            const a_trans_est = (r1 + r2) / 2;
            timeOfFlight = Math.PI * Math.sqrt(Math.pow(a_trans_est, 3) / mu);
        }

        const arrivalTime = evalTime + timeOfFlight;
        const targetStateArrival = this.predictState(endBody, centralBodyMass, mu, startTime, arrivalTime);
        const r2Vec_arrival = targetStateArrival.pos;
        const v2ArrivalVec = targetStateArrival.vel;
        
        if (!r2Vec_arrival || !v2ArrivalVec) return null;

        // 3. Solve Lambert's Problem to find required velocities
        const lambert = this.solveLambert(r1Vec, r2Vec_arrival, timeOfFlight, mu);
        if (!lambert) return null;

        // 4. Calculate Delta-V
        // Current velocity of start body at evalTime was predicted above
        const deltaV1 = lambert.v1.distanceTo(v1Vec);
        const deltaV2 = lambert.v2.distanceTo(v2ArrivalVec);

        return {
            position: r1Vec.clone(),
            velocity: lambert.v1,
            deltaV1,
            deltaV2,
            timeOfFlight,
            startPosition: r1Vec.clone(),
            endPosition: r2Vec_arrival.clone(),
            startVelocity: lambert.v1.clone(),
            endVelocity: lambert.v2.clone(),
            startDelay: startDelay
        };
    }

    /**
     * Predict future state of a body using analytical propagation from its CURRENT state
     */
    private static predictState(
        body: OrbitalBody, 
        centralBodyMass: number, 
        mu: number,
        currentTime: number, 
        futureTime: number
    ): { pos: THREE.Vector3, vel: THREE.Vector3 } {
        const dt = futureTime - currentTime;
        if (Math.abs(dt) < 0.001) return { pos: body.position.clone(), vel: body.velocity.clone() };

        const trajectory = body.getTrajectory();
        
        // Use Bezier estimation if available for massive speedup in optimization loops
        if (trajectory.useBezierEstimation && trajectory.getType() === 'elliptical') {
            const state = trajectory.getBezierState(futureTime, { calcVelocity: true });
            if (state.position && state.velocity) {
                return { pos: state.position, vel: state.velocity };
            }
        }

        const pos0 = body.position;
        const vel0 = body.velocity;

        // Fallback to elements to propagate analytically
        const elements = calculateOrbitalElementsFromState(pos0, vel0, centralBodyMass);
        const a = elements.semiMajorAxis;
        const e = elements.eccentricity;
        const period = elements.period;

        if (e < 1.0) {
            const pos = calculateEllipticalPosition(futureTime, a, e, period, currentTime, pos0, vel0, centralBodyMass);
            const vel = calculateEllipticalVelocity(futureTime, a, e, period, currentTime, pos0, vel0, centralBodyMass);
            return { pos, vel };
        } else {
            const pos = calculateHyperbolicPosition(futureTime, a, e, currentTime, pos0, vel0, centralBodyMass);
            const vel = calculateHyperbolicVelocity(futureTime, a, e, currentTime, pos0, vel0, centralBodyMass);
            return { pos, vel };
        }
    }

    /**
     * Search for the optimal transfer (varying both start delay and time of flight)
     */
    static calculateOptimalHohmannTransfer(
        startBody: OrbitalBody,
        endBody: OrbitalBody,
        centralBodyMass: number,
        startTime: number
    ): TransferResult | null {
        // Search range for delay: 4 orbits of start body to find better alignments
        const startParams = startBody.getTrajectory().parameters;
        const startPeriod = (startParams.period as any).over(seconds).value || 3600 * 24;
        
        // Ensure bodies are different
        if (startBody === endBody) return null;

        // Search range for TOF: 0.5x to 1.5x of estimated Hohmann TOF
        const startPos = startBody.getPosition();
        const targetPos = endBody.getPosition();
        const r1 = startPos.length();
        const r2 = targetPos.length();
        
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        const estTOF = Math.PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu);

        let bestResult: TransferResult | null = null;
        let minTotalDV = Infinity;

        const delaySteps = 64; 
        const tofSteps = 64;

        // Search range for delay: exactly 1 period of start body
        const searchRange = startPeriod; 
        const yMinVal = estTOF * 0.5;
        const yMaxVal = estTOF * 1.5;

        const dx = searchRange / delaySteps;
        const dy = (yMaxVal - yMinVal) / tofSteps;

        for (let i = 0; i < delaySteps; i++) {
            const delay = (i + 0.5) * dx;
            
            for (let j = 0; j < tofSteps; j++) {
                const tof = yMinVal + (j + 0.5) * dy;
                const result = this.calculateHohmannTransfer(startBody, endBody, centralBodyMass, startTime, delay, tof);
                
                if (result) {
                    const totalDV = result.deltaV1 + result.deltaV2;
                    if (totalDV < minTotalDV) {
                        minTotalDV = totalDV;
                        bestResult = result;
                    }
                }
            }
        }

        // Refine if we found a broad result
        if (bestResult) {
            // Initial refinement range: half of grid spacing
            return this.calculateOptimizedTransferFromSeed(
                startBody, endBody, centralBodyMass, startTime,
                bestResult.startDelay, bestResult.timeOfFlight,
                searchRange / delaySteps, estTOF / tofSteps
            );
        }

        return bestResult;
    }

    /**
     * Refines a transfer calculation starting from a seed (delay, TOF).
     * Uses a multi-pass hill-climbing approach to optimize both simultaneously.
     */
    static calculateOptimizedTransferFromSeed(
        startBody: OrbitalBody,
        endBody: OrbitalBody,
        centralBodyMass: number,
        startTime: number,
        seedDelay: number,
        seedTOF: number,
        initialDelayRange: number,
        initialTOFRange: number
    ): TransferResult | null {
        let currentDelay = seedDelay;
        let currentTOF = seedTOF;
        let bestResult = this.calculateHohmannTransfer(startBody, endBody, centralBodyMass, startTime, currentDelay, currentTOF);
        if (!bestResult) return null;

        let bestDV = bestResult.deltaV1 + bestResult.deltaV2;
        
        let dRange = initialDelayRange;
        let tRange = initialTOFRange;

        const passes = 4;
        const stepsPerPass = 10;

        for (let pass = 0; pass < passes; pass++) {
            let passFoundBetter = false;

            for (let i = 0; i < stepsPerPass; i++) {
                // Simultaneous search in 2D space around current best
                // Sample a small grid around current point
                const gridRes = 5;
                for (let dj = -(gridRes-1)/2; dj <= (gridRes-1)/2; dj++) {
                    for (let tk = -(gridRes-1)/2; tk <= (gridRes-1)/2; tk++) {
                        if (dj === 0 && tk === 0) continue;

                        const testDelay = Math.max(0, currentDelay + (dj / (gridRes/2)) * dRange);
                        const testTOF = Math.max(0.1, currentTOF + (tk / (gridRes/2)) * tRange);

                        const result = this.calculateHohmannTransfer(startBody, endBody, centralBodyMass, startTime, testDelay, testTOF);
                        if (result) {
                            const dv = result.deltaV1 + result.deltaV2;
                            if (dv < bestDV) {
                                bestDV = dv;
                                currentDelay = testDelay;
                                currentTOF = testTOF;
                                bestResult = result;
                                passFoundBetter = true;
                            }
                        }
                    }
                }
            }

            // Shrink search radius for next pass
            dRange *= 0.4;
            tRange *= 0.4;
            
            if (!passFoundBetter && pass > 0) break; // Convergence check
        }

        return bestResult;
    }

    /**
     * Simple Lambert Solver using universal variables.
     */
    public static solveLambert(r1Vec: THREE.Vector3, r2Vec: THREE.Vector3, dt: number, mu: number, prograde: boolean = true): { v1: THREE.Vector3, v2: THREE.Vector3 } | null {
        const r1 = r1Vec.length();
        const r2 = r2Vec.length();
        const cosDeltaTheta = r1Vec.dot(r2Vec) / (r1 * r2);
        
        const normal = new THREE.Vector3().crossVectors(r1Vec, r2Vec);
        let deltaTheta = Math.acos(THREE.MathUtils.clamp(cosDeltaTheta, -1, 1));
        
        if (!prograde) {
            deltaTheta = 2 * Math.PI - deltaTheta;
        }

        const c = Math.sqrt(r1*r1 + r2*r2 - 2*r1*r2*cosDeltaTheta);
        const s = (r1 + r2 + c) / 2;
        
        let low_a = s / 2;
        let high_a = 1e12; 
        let a = s / 2;
        
        const dt_min = Math.sqrt(Math.pow(s / 2, 3) / mu) * (Math.PI - (2 * Math.asin(Math.sqrt((s - c) / s)) - Math.sin(2 * Math.asin(Math.sqrt((s - c) / s)))));
        const isLongWay = dt > dt_min;

        const maxIter = 100;
        for (let i = 0; i < maxIter; i++) {
            const mid_a = (low_a + high_a) / 2;
            let alpha_0 = 2 * Math.asin(Math.sqrt(s / (2 * mid_a)));
            let beta = 2 * Math.asin(Math.sqrt((s - c) / (2 * mid_a)));
            
            let alpha = isLongWay ? 2 * Math.PI - alpha_0 : alpha_0;
            
            const dt_est = Math.sqrt(Math.pow(mid_a, 3) / mu) * ((alpha - Math.sin(alpha)) - (beta - Math.sin(beta)));
            
            // For both branches, dt_est increases as mid_a increases 
            // once we properly handle the alpha branch.
            // Actually, for isLongWay=false, as a increases, dt_est decreases.
            // For isLongWay=true, as a increases, dt_est increases.
            
            if (isLongWay) {
                if (dt_est < dt) low_a = mid_a;
                else high_a = mid_a;
            } else {
                if (dt_est < dt) high_a = mid_a;
                else low_a = mid_a;
            }

            if (Math.abs(dt_est - dt) / dt < 1e-8) {
                break;
            }
        }

        a = (low_a + high_a) / 2;
        let alpha_0 = 2 * Math.asin(Math.sqrt(s / (2 * a)));
        let beta = 2 * Math.asin(Math.sqrt((s - c) / (2 * a)));
        let alpha = isLongWay ? 2 * Math.PI - alpha_0 : alpha_0;
        
        const deltaE = alpha - beta;
        const f = 1 - (a / r1) * (1 - Math.cos(deltaE));
        const g = dt - Math.sqrt(Math.pow(a, 3) / mu) * (deltaE - Math.sin(deltaE));
        const g_dot = 1 - (a / r2) * (1 - Math.cos(deltaE));

        const v1 = r2Vec.clone().sub(r1Vec.clone().multiplyScalar(f)).multiplyScalar(1 / g);
        const v2 = v1.clone().multiplyScalar(g_dot).addScaledVector(r1Vec, (f * g_dot - 1) / g);

        return { v1, v2 };
    }

    /**
     * Performs a global optimization search for a transfer:
     * 1. 2D grid search (8x8) to find a good seed
     * 2. Refined hill-climbing optimization from that seed
     * 
     * This isolates the mathematical search from the plotting code.
     */
    static calculateGlobalOptimizedTransfer(
        startBody: OrbitalBody,
        targetBody: OrbitalBody,
        centralBodyMass: number,
        startTime: number
    ): GlobalOptimizationResult {
        const startParams = startBody.getTrajectory().parameters;
        const startPeriod = (startParams.period as any).over(seconds).value || 3600 * 24;
        
        const startPos = startBody.getPosition();
        const targetPos = targetBody.getPosition();
        const r1 = startPos.length();
        const r2 = targetPos.length();
        
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        const estTOF = Math.PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu);

        const searchRange = startPeriod; 
        const xMinVal = 0;
        const xMaxVal = searchRange;
        const yMinVal = estTOF * 0.5;
        const yMaxVal = estTOF * 1.5;

        const resX = 8;
        const resY = 8;
        const dx = (xMaxVal - xMinVal) / resX;
        const dy = (yMaxVal - yMinVal) / resY;

        const heatmapX: number[] = [];
        const heatmapY: number[] = [];
        const heatmapZ: number[][] = [];
        const heatmapTooltips: string[][] = [];

        for (let i = 0; i < resX; i++) heatmapX.push(xMinVal + (i + 0.5) * dx);
        for (let j = 0; j < resY; j++) heatmapY.push(yMinVal + (j + 0.5) * dy);

        let zMin = Infinity;
        let zMax = -Infinity;
        let seedDelay = heatmapX[0];
        let seedTOF = heatmapY[0];
        let seedDV = Infinity;

        for (let j = 0; j < resY; j++) {
            const rowZ: number[] = [];
            const rowTooltips: string[] = [];
            const tof = heatmapY[j];

            for (let i = 0; i < resX; i++) {
                const delay = heatmapX[i];
                const result = this.calculateHohmannTransfer(startBody, targetBody, centralBodyMass, startTime, delay, tof);

                if (result) {
                    const totalDV = result.deltaV1 + result.deltaV2;
                    const logDV = Math.log10(Math.max(totalDV, 0.001));
                    rowZ.push(logDV);
                    zMin = Math.min(zMin, logDV);
                    zMax = Math.max(zMax, logDV);

                    if (totalDV < seedDV) {
                        seedDV = totalDV;
                        seedDelay = delay;
                        seedTOF = tof;
                    }
                    rowTooltips.push(`Delay: ${formatTime(Measure.of(delay, seconds), true)}<br>TOF: ${formatTime(Measure.of(tof, seconds), true)}<br>Total ΔV: ${totalDV.toFixed(4)} km/s`);
                } else {
                    rowZ.push(-3);
                    rowTooltips.push(`Delay: ${formatTime(Measure.of(delay, seconds), true)}<br>TOF: ${formatTime(Measure.of(tof, seconds), true)}<br>ΔV: N/A`);
                }
            }
            heatmapZ.push(rowZ);
            heatmapTooltips.push(rowTooltips);
        }

        const optimizedResult = this.calculateOptimizedTransferFromSeed(
            startBody, targetBody, centralBodyMass, startTime,
            seedDelay, seedTOF, dx, dy
        );

        return {
            result: optimizedResult,
            heatmap: {
                x: heatmapX,
                y: heatmapY,
                z: heatmapZ,
                zMin: zMin === Infinity ? -3 : zMin,
                zMax: zMax === -Infinity ? 0 : zMax,
                tooltips: heatmapTooltips
            }
        };
    }
}
