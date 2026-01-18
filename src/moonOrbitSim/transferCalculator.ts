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
     * @returns Transfer parameters
     */
    static calculateHohmannTransfer(
        startBody: OrbitalBody, 
        endBody: OrbitalBody, 
        centralBodyMass: number
    ): TransferResult | null {
        
        // 1. Get current positions
        const r1Vec = startBody.getPosition(); // Relative to central body? `getPosition` is absolute world pos.
        // We need positions relative to the central body. 
        // Assuming central body is at (0,0,0) or we need to subtract it.
        // `OrbitalBody` stores absolute position.
        // The `OrbitalBody.update` takes centralBodyPosition.
        // Let's assume for this calculation that we are in a frame where central body is at origin, 
        // OR we need access to central body position.
        // Since we don't have central body passed in (only mass), this is a bit risky if central body is moving.
        // However, usually central body is at 0,0,0 in this sim (Earth).
        // Let's try to get it from startBody properties if possible? No.
        // We will assume central body is at Origin (0,0,0) for now, as `OrbitalBody` constructor uses position relative to scene root.
        // If central body is at 0,0,0, then `startBody.getPosition()` is the radius vector.
        
        const r1 = r1Vec.length();
        const r2Vec = endBody.getPosition();
        const r2 = r2Vec.length();
        
        // 2. Calculate semi-major axis of transfer orbit
        // a_trans = (r1 + r2) / 2
        const a_trans = (r1 + r2) / 2;
        
        // 3. Calculate gravitational parameter mu
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        
        // 4. Calculate Velocity at Periapsis (start) of transfer orbit
        // Vis-viva equation: v^2 = mu * (2/r - 1/a)
        // v_trans_1 = sqrt( mu * (2/r1 - 1/a_trans) )
        const v_trans_1 = Math.sqrt(mu * (2/r1 - 1/a_trans));
        
        // 5. Calculate Velocity at Apoapsis (end) of transfer orbit
        // v_trans_2 = sqrt( mu * (2/r2 - 1/a_trans) )
        const v_trans_2 = Math.sqrt(mu * (2/r2 - 1/a_trans));
        
        // 6. Calculate Time of Flight
        // T = 2 * pi * sqrt(a^3 / mu) -> Half period for transfer
        const period = 2 * Math.PI * Math.sqrt(Math.pow(a_trans, 3) / mu);
        const timeOfFlight = period / 2;
        
        // 7. Calculate Delta V (Difference between transfer velocity and current velocity)
        // This assumes circular orbits for V1/V2.
        // v_circ_1 = sqrt(mu/r1)
        const v_circ_1 = Math.sqrt(mu / r1);
        const v_circ_2 = Math.sqrt(mu / r2);
        
        const deltaV1 = Math.abs(v_trans_1 - v_circ_1);
        const deltaV2 = Math.abs(v_trans_2 - v_circ_2);
        
        // 8. Construct State Vector for Transfer Orbit
        // Position is just current start position
        // Velocity direction needs to be tangent to the current orbit (assuming circular).
        // Tangent direction = Cross(Radius, Normal)
        // Assume orbit is in XZ plane or use current velocity to determine plane.
        
        // Normalize radius
        const r1Norm = r1Vec.clone().normalize();
        
        // Get current velocity direction (normalized)
        const currentRefVel = startBody.getVelocity();
        // If body is stationary or weird, fallback
        let velocityDir = currentRefVel.clone().normalize();
        
        // Ideally, for Hohmann, we burn Prograde (tangent to path).
        // So transfer velocity is in same direction as current velocity (if circular).
        const transferVelocityMean = velocityDir.clone().multiplyScalar(v_trans_1);
        
        // However, we want to visualize the orbit such that it connects r1 and r2.
        // Real Hohmann requires correct phase alignment.
        // For visualization, we just want to show THE transfer orbit arriving at r2 distance opposite to r1.
        // So visually, we just launch NOW.
        // The transfer orbit will be an ellipse with P at r1 and A at r2 (or vice versa).
        
        return {
            position: r1Vec.clone(),
            velocity: transferVelocityMean,
            deltaV1,
            deltaV2,
            timeOfFlight,
            startPosition: r1Vec.clone(),
            endPosition: r1Vec.clone().multiplyScalar(-r2/r1) // Approx opposite side
        };
    }
}
