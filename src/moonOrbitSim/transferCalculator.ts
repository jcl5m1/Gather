import * as THREE from 'three';
import { OrbitalBody } from './orbitalBody';
import { G } from './config';
import { gravitationalConstantUnit, kilometers, seconds, squareKilometersPerSecondSquared, cubicKilometersPerSecondSquared, Measure, Length, Velocity } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';

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
    startDelay: number; // Seconds to wait before starting transfer
}

/**
 * Calculator for orbital transfers
 */
export class TransferCalculator {

    /**
     * Calculate a Hohmann transfer between two bodies orbiting the same central body
     * Assumes circular/coplanar orbits for simplicity, but calculates based on current positions.
     * 
     * @param startBody The body starting the transfer (or the body we are launching from)
     * @param endBody The target body
     * @param centralBodyMass Mass of the central body
     * @param startTime The current simulation time
     * @param startDelay Optional delay before starting the transfer (seconds)
     * @returns Transfer parameters
     */
    static calculateHohmannTransfer(
        startBody: OrbitalBody, 
        endBody: OrbitalBody, 
        centralBodyMass: number,
        startTime: number = 0,
        startDelay: number = 0
    ): TransferResult | null {
        
        const evalTime = startTime + startDelay;

        // 1. Get positions at evaluation time (taking into account startDelay)
        // We use the trajectory objects to predict future positions
        const r1Vec = startBody.getTrajectory().getPosition(evalTime, 'analytical');
        const r2Vec = endBody.getTrajectory().getPosition(evalTime, 'analytical');

        if (!r1Vec || !r2Vec) return null;
        
        const r1 = r1Vec.length();
        const r2 = r2Vec.length();
        
        // 2. Calculate semi-major axis of transfer orbit
        const a_trans = (r1 + r2) / 2;
        
        // 3. Calculate gravitational parameter mu
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        
        // 4. Calculate Velocity at Periapsis (start) and Apoapsis (end)
        const v_trans_1 = Math.sqrt(mu * (2/r1 - 1/a_trans));
        const v_trans_2 = Math.sqrt(mu * (2/r2 - 1/a_trans));
        
        // 5. Calculate Time of Flight
        const period = 2 * Math.PI * Math.sqrt(Math.pow(a_trans, 3) / mu);
        const timeOfFlight = period / 2;
        
        // 6. Calculate Delta V (Difference between transfer velocity and current velocity)
        // We need velocity at evalTime
        const v1Vec = startBody.getTrajectory().getPosition(evalTime + 0.1, 'analytical');
        if (!v1Vec) return null;
        
        // v_circ_1 = sqrt(mu/r1) - just use the actual velocity magnitude from trajectory if possible
        // But for Hohmann, we assume tangential burn.
        // Let's get the velocity vector from finite difference if Trajectory doesn't provide it easily
        const currentVelVec = v1Vec.clone().sub(r1Vec).multiplyScalar(10);
        const v_circ_1 = currentVelVec.length();
        
        // For target velocity at arrival, we need to know its speed then
        const arrivalTime = evalTime + timeOfFlight;
        const r2ArrivalVec = endBody.getTrajectory().getPosition(arrivalTime, 'analytical');
        const r2ArrivalPlusVec = endBody.getTrajectory().getPosition(arrivalTime + 0.1, 'analytical');
        
        if (!r2ArrivalVec || !r2ArrivalPlusVec) return null;
        const v2ArrivalVec = r2ArrivalPlusVec.clone().sub(r2ArrivalVec).multiplyScalar(10);
        const v_circ_2 = v2ArrivalVec.length();
        
        const deltaV1 = Math.abs(v_trans_1 - v_circ_1);
        const deltaV2 = Math.abs(v_trans_2 - v_circ_2);
        
        // 7. Construct State Vector
        // Normalize radius
        const r1Norm = r1Vec.clone().normalize();
        
        // For Hohmann, we burn in direction of velocity
        const velocityDir = currentVelVec.clone().normalize();
        const transferVelocity = velocityDir.clone().multiplyScalar(v_trans_1);
        
        // End position is exactly opposite to r1 in the transfer orbit
        const endPosition = r1Vec.clone().multiplyScalar(-r2/r1);
        
        return {
            position: r1Vec.clone(),
            velocity: transferVelocity,
            deltaV1,
            deltaV2,
            timeOfFlight,
            startPosition: r1Vec.clone(),
            endPosition: endPosition,
            startDelay: startDelay
        };
    }

    /**
     * Search for the optimal start delay to minimize distance at arrival
     */
    static calculateOptimalHohmannTransfer(
        startBody: OrbitalBody,
        endBody: OrbitalBody,
        centralBodyMass: number,
        startTime: number
    ): TransferResult | null {
        // We want to find a delay d such that at t = startTime + d + TOF,
        // the target body position is closest to the transfer arrival point.

        // Synodic period estimate or just use one orbit of target
        const endParams = endBody.getTrajectory().parameters;
        const period = (endParams.period as any).over(seconds).value || 3600 * 24 * 30; // 30 days fallback
        
        let bestDelay = 0;
        let minDistance = Infinity;
        let bestResult: TransferResult | null = null;

        // Sampling search - start from 0 and go positive
        const steps = 100;
        for (let i = 0; i < steps; i++) {
            const delay = (i / steps) * period;
            const result = this.calculateHohmannTransfer(startBody, endBody, centralBodyMass, startTime, delay);
            
            if (result) {
                const arrivalTime = startTime + delay + result.timeOfFlight;
                const targetPosAtArrival = endBody.getTrajectory().getPosition(arrivalTime, 'analytical');
                
                if (targetPosAtArrival) {
                    const dist = targetPosAtArrival.distanceTo(result.endPosition);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestDelay = delay;
                        bestResult = result;
                    }
                }
            }
        }

        // Refine with finer search around bestDelay
        // Ensure we stay non-negative
        if (bestResult) {
            const range = period / steps;
            const subSteps = 20;
            for (let i = 0; i < subSteps; i++) {
                const delay = Math.max(0, bestDelay - range/2 + (i / subSteps) * range);
                const result = this.calculateHohmannTransfer(startBody, endBody, centralBodyMass, startTime, delay);
                
                if (result) {
                    const arrivalTime = startTime + delay + result.timeOfFlight;
                    const targetPosAtArrival = endBody.getTrajectory().getPosition(arrivalTime, 'analytical');
                    
                    if (targetPosAtArrival) {
                        const dist = targetPosAtArrival.distanceTo(result.endPosition);
                        if (dist < minDistance) {
                            minDistance = dist;
                            bestDelay = delay;
                            bestResult = result;
                        }
                    }
                }
            }
        }

        return bestResult;
    }
}
