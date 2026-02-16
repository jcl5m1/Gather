import * as THREE from 'three';
import { G } from './config';
import { gravitationalConstantUnit, seconds, formatTime, Measure, Length } from './units';
import type { OrbitalBody } from './orbitalBody';

// Re-export G for backward compatibility
export { G };

// ============================================================================
// Shared Interfaces and Classes
// ============================================================================

export interface BezierCurvePoints {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    p3: THREE.Vector3;
}

export class BezierCurve {
    private points: BezierCurvePoints;

    constructor(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) {
        this.points = { p0, p1, p2, p3 };
    }

    getPoint(t: number): THREE.Vector3 {
        const point = new THREE.Vector3();
        const mt = 1 - t;
        const mt2 = mt * mt;
        const mt3 = mt2 * mt;
        const t2 = t * t;
        const t3 = t2 * t;

        point.x = mt3 * this.points.p0.x + 3 * mt2 * t * this.points.p1.x + 3 * mt * t2 * this.points.p2.x + t3 * this.points.p3.x;
        point.y = mt3 * this.points.p0.y + 3 * mt2 * t * this.points.p1.y + 3 * mt * t2 * this.points.p2.y + t3 * this.points.p3.y;
        point.z = mt3 * this.points.p0.z + 3 * mt2 * t * this.points.p1.z + 3 * mt * t2 * this.points.p2.z + t3 * this.points.p3.z;

        return point;
    }

    getControlPoints(): BezierCurvePoints {
        return this.points;
    }

    getDerivative(t: number): THREE.Vector3 {
        // Derivative of cubic Bezier curve:
        // B'(t) = 3(1-t)^2(P1-P0) + 6(1-t)t(P2-P1) + 3t^2(P3-P2)
        const derivative = new THREE.Vector3();
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;

        const p0 = this.points.p0;
        const p1 = this.points.p1;
        const p2 = this.points.p2;
        const p3 = this.points.p3;

        // Terms
        // 3(1-t)^2 * (P1 - P0)
        const term1 = new THREE.Vector3().subVectors(p1, p0).multiplyScalar(3 * mt2);
        // 6(1-t)t * (P2 - P1)
        const term2 = new THREE.Vector3().subVectors(p2, p1).multiplyScalar(6 * mt * t);
        // 3t^2 * (P3 - P2)
        const term3 = new THREE.Vector3().subVectors(p3, p2).multiplyScalar(3 * t2);

        derivative.add(term1).add(term2).add(term3);
        return derivative;
    }

    // Generate points along the curve for visualization
    getPoints(numPoints: number = 25): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            points.push(this.getPoint(t));
        }
        return points;
    }

    // Static helper to generate points from multiple curves
    static getPointsFromCurves(curves: BezierCurve[], numPointsPerCurve: number = 25): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        curves.forEach(curve => {
            points.push(...curve.getPoints(numPointsPerCurve));
        });
        return points;
    }
}

export interface BezierTimeWarpLUT {
    M: number[];
    bezierT: number[];
    // Control points for each interval: P1 and P2 (scalar values for T)
    bezierPoints: { p1: number, p2: number }[];
    errors: number[];
}

export interface OrbitalState {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
}

/**
 * Generate position and velocity vectors from orbital parameters
 */
export function generateStateFromOrbitalElements(
    rp: number,
    ra: number,
    e: number,
    centralBodyMass: number,
    trueAnomaly: number = 0,
    inclination: number = 0,
    longitudeOfAscendingNode: number = 0,
    argumentOfPeriapsis: number = 0
): OrbitalState {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * centralBodyMass;

    // Calculate semi-major axis
    const a = (rp + ra) / 2;

    // Calculate semi-latus rectum
    const p = a * (1 - e * e);

    // Calculate current radius from true anomaly
    const r = p / (1 + e * Math.cos(trueAnomaly));

    // Calculate velocity components in perifocal frame
    // Radial component: v_r = sqrt(mu/p) * e * sin(ν)
    // Transverse component: v_t = sqrt(mu/p) * (1 + e * cos(ν))
    const sqrtMuP = Math.sqrt(mu / p);
    const vRadial = sqrtMuP * e * Math.sin(trueAnomaly);
    const vTransverse = sqrtMuP * (1 + e * Math.cos(trueAnomaly));

    // Position in orbital plane (perifocal frame)
    const xPerifocal = r * Math.cos(trueAnomaly);
    const yPerifocal = r * Math.sin(trueAnomaly);

    // Velocity in orbital plane (perifocal frame)
    // Radial direction is along position vector, transverse is perpendicular
    const radialDir = new THREE.Vector3(Math.cos(trueAnomaly), Math.sin(trueAnomaly), 0);
    const transverseDir = new THREE.Vector3(-Math.sin(trueAnomaly), Math.cos(trueAnomaly), 0);

    const vxPerifocal = vRadial * radialDir.x + vTransverse * transverseDir.x;
    const vyPerifocal = vRadial * radialDir.y + vTransverse * transverseDir.y;

    // Rotation matrices for orbital plane orientation
    // 1. Rotation around z-axis by argument of periapsis
    const cosArgPeri = Math.cos(argumentOfPeriapsis);
    const sinArgPeri = Math.sin(argumentOfPeriapsis);

    // 2. Rotation around x-axis by inclination
    const cosInc = Math.cos(inclination);
    const sinInc = Math.sin(inclination);

    // 3. Rotation around z-axis by longitude of ascending node
    const cosLAN = Math.cos(longitudeOfAscendingNode);
    const sinLAN = Math.sin(longitudeOfAscendingNode);

    // Combined rotation matrix (Z-X-Z Euler angles)
    // First apply argument of periapsis rotation
    let x1 = xPerifocal * cosArgPeri - yPerifocal * sinArgPeri;
    let y1 = xPerifocal * sinArgPeri + yPerifocal * cosArgPeri;
    let z1 = 0;

    // Then apply inclination rotation
    let x2 = x1;
    let y2 = y1 * cosInc - z1 * sinInc;
    let z2 = y1 * sinInc + z1 * cosInc;

    // Finally apply longitude of ascending node rotation
    const x = x2 * cosLAN - y2 * sinLAN;
    const y = x2 * sinLAN + y2 * cosLAN;
    const z = z2;

    // Same rotations for velocity
    let vx1 = vxPerifocal * cosArgPeri - vyPerifocal * sinArgPeri;
    let vy1 = vxPerifocal * sinArgPeri + vyPerifocal * cosArgPeri;
    let vz1 = 0;

    let vx2 = vx1;
    let vy2 = vy1 * cosInc - vz1 * sinInc;
    let vz2 = vy1 * sinInc + vz1 * cosInc;

    const vx = vx2 * cosLAN - vy2 * sinLAN;
    const vy = vx2 * sinLAN + vy2 * cosLAN;
    const vz = vz2;

    return {
        position: new THREE.Vector3(x, y, z),
        velocity: new THREE.Vector3(vx, vy, vz)
    };
}

export function calculateInitialE(
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    a: number,
    e: number,
    mu: number
): number {
    // Calculate specific angular momentum vector
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);

    // Calculate radius and velocity magnitudes
    const r = initialPos.length();

    // Calculate radial velocity component
    const radialVel = initialVel.dot(initialPos.clone().normalize());

    // Calculate true anomaly directly from position and velocity
    const theta = Math.atan2(
        h.length() * radialVel,
        h.length() * h.length() / r - mu
    );

    // Convert true anomaly to eccentric anomaly
    return 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta / 2));
}

export function calculateHyperbolicPosition(
    time: number,
    a: number,
    e: number,
    startTime: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    planetMass: number
): THREE.Vector3 {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * planetMass;
    const F0 = calculateInitialE(initialPos, initialVel, a, e, mu); // Using same function but result is hyperbolic anomaly

    // Mean anomaly at t=0 for hyperbolic orbit
    const M0 = e * Math.sinh(F0) - F0;

    // Current mean anomaly
    const n = Math.sqrt(mu / (-a * a * a)); // Mean motion for hyperbolic orbit
    const M = M0 + n * (time - startTime);

    // Solve Kepler's equation iteratively for hyperbolic case (M = e*sinh(F) - F)
    let F = M; // Initial guess
    for (let i = 0; i < 10; i++) {
        const dF = (M - e * Math.sinh(F) + F) / (e * Math.cosh(F) - 1);
        F += dF;
        if (Math.abs(dF) < 1e-6) break;
    }

    // Calculate position in orbital plane coordinates
    const x = a * (e - Math.cosh(F));
    const y = a * Math.sqrt(e * e - 1) * Math.sinh(F);

    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();

    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, x)
        .addScaledVector(perpDir, y);
}

/**
 * Solve Kepler's Equation for Eccentric Anomaly: M = E - e*sin(E)
 * Uses Newton-Raphson iteration for robust convergence, especially for high eccentricity.
 * 
 * @param M Mean anomaly (radians)
 * @param e Eccentricity (0 <= e < 1 for elliptical orbits)
 * @returns Eccentric anomaly E (radians)
 */
export function solveEccentricAnomaly(M: number, e: number): number {
    // Normalize M to [0, 2π)
    const M_normalized = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    
    // Initial guess using smart heuristic
    // For low eccentricity: E ≈ M
    // For high eccentricity near periapsis/apoapsis: use better approximation
    let E: number;
    if (e < 0.8) {
        E = M_normalized;
    } else {
        // For high eccentricity, use a better initial guess
        E = M_normalized + e * Math.sin(M_normalized) / (1 - Math.sin(M_normalized + e) + Math.sin(M_normalized));
    }
    
    // Newton-Raphson iteration: E_{n+1} = E_n - f(E_n) / f'(E_n)
    // where f(E) = E - e*sin(E) - M
    // and f'(E) = 1 - e*cos(E)
    const tolerance = 1e-12;
    const maxIterations = 50;
    
    for (let i = 0; i < maxIterations; i++) {
        const sinE = Math.sin(E);
        const cosE = Math.cos(E);
        
        // f(E) = E - e*sin(E) - M
        const f = E - e * sinE - M_normalized;
        
        // f'(E) = 1 - e*cos(E)
        const fPrime = 1 - e * cosE;
        
        // Check for singularity (shouldn't happen for e < 1)
        if (Math.abs(fPrime) < 1e-14) {
            console.warn(`solveEccentricAnomaly: Near-singular derivative at E=${E}, e=${e}, M=${M_normalized}`);
            break;
        }
        
        // Newton-Raphson step
        const delta = f / fPrime;
        E = E - delta;
        
        // Check convergence
        if (Math.abs(delta) < tolerance) {
            return E;
        }
    }
    
    // If we didn't converge, log a warning but return best estimate
    console.warn(`solveEccentricAnomaly: Failed to converge after ${maxIterations} iterations (e=${e.toFixed(6)}, M=${M_normalized.toFixed(6)}, final E=${E.toFixed(6)})`);
    return E;
}

export function calculateEllipticalPosition(
    time: number,
    a: number,
    e: number,
    period: number,
    startTime: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    planetMass: number
): THREE.Vector3 {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * planetMass;
    const E0 = calculateInitialE(initialPos, initialVel, a, e, mu);

    // Mean anomaly at t=0
    const M0 = E0 - e * Math.sin(E0);

    // Current mean anomaly
    const M = M0 + 2 * Math.PI * ((time - startTime) / period);

    // Solve Kepler's equation iteratively (M = E - e*sin(E))
    const E = solveEccentricAnomaly(M, e);

    // Calculate position in orbital plane coordinates
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e * e) * Math.sin(E);



    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();

    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, x)
        .addScaledVector(perpDir, y);
}

export function calculateEllipticalVelocity(
    time: number,
    a: number,
    e: number,
    period: number,
    startTime: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    planetMass: number
): THREE.Vector3 {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * planetMass;
    const E0 = calculateInitialE(initialPos, initialVel, a, e, mu);

    // Mean anomaly at t=0
    const M0 = E0 - e * Math.sin(E0);

    // Current mean anomaly
    const M = M0 + 2 * Math.PI * ((time - startTime) / period);

    // Solve Kepler's equation iteratively (M = E - e*sin(E))
    let E = M; // Initial guess
    for (let i = 0; i < 10; i++) {
        E = M + e * Math.sin(E);
    }

    // Mean motion
    const n = 2 * Math.PI / period;

    // Calculate velocity in orbital plane coordinates
    // vx = -a*n*sin(E) / (1 - e*cos(E))
    // vy = a*n*sqrt(1-e²)*cos(E) / (1 - e*cos(E))
    const denominator = 1 - e * Math.cos(E);
    const vx = -a * n * Math.sin(E) / denominator;
    const vy = a * n * Math.sqrt(1 - e * e) * Math.cos(E) / denominator;

    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();

    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, vx)
        .addScaledVector(perpDir, vy);
}

export function calculateHyperbolicVelocity(
    time: number,
    a: number,
    e: number,
    startTime: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    planetMass: number
): THREE.Vector3 {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * planetMass;
    const F0 = calculateInitialE(initialPos, initialVel, a, e, mu);

    // Mean anomaly at t=0 for hyperbolic orbit
    const M0 = e * Math.sinh(F0) - F0;

    // Current mean anomaly
    const n = Math.sqrt(mu / (-a * a * a)); // Mean motion for hyperbolic orbit
    const M = M0 + n * (time - startTime);

    // Solve Kepler's equation iteratively for hyperbolic case
    let F = M; // Initial guess
    for (let i = 0; i < 10; i++) {
        const dF = (M - e * Math.sinh(F) + F) / (e * Math.cosh(F) - 1);
        F += dF;
        if (Math.abs(dF) < 1e-6) break;
    }

    // Calculate velocity in orbital plane coordinates
    const denominator = e * Math.cosh(F) - 1;
    const vx = -a * n * Math.sinh(F) / denominator;
    const vy = a * n * Math.sqrt(e * e - 1) * Math.cosh(F) / denominator;

    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();

    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, vx)
        .addScaledVector(perpDir, vy);
}

export function generateHyperbolicPoints(
    a: number,
    e: number,
    h: THREE.Vector3,
    eVec: THREE.Vector3,
    numPoints: number = 100
): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const b = a * Math.sqrt(e * e - 1); // semi-minor axis for hyperbola
    const c = a * e; // distance from center to focus

    // Normalize vectors
    const hNorm = h.clone().normalize();
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Calculate center of hyperbola (offset from focus by -c along periapsis direction)
    const center = periapsisDir.clone().multiplyScalar(-c);

    // For hyperbola, we need to calculate the maximum angle based on asymptotes
    const maxTheta = Math.acos(-1 / e); // Angle between asymptote and periapsis direction

    // Generate hyperbola points in the orbit plane
    for (let i = 0; i <= numPoints; i++) {
        // Map i to range [-maxTheta, maxTheta]
        const theta = -maxTheta + (2 * maxTheta * i / numPoints);

        // Parametric equations for hyperbola
        const r = a * (e * e - 1) / (1 + e * Math.cos(theta));
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);

        // Calculate point relative to focus
        const point = new THREE.Vector3()
            .addScaledVector(periapsisDir, x)
            .addScaledVector(perpDir, y);

        points.push(point);
    }

    return points;
}

export function generateEllipsePoints(
    a: number,
    e: number,
    h: THREE.Vector3,
    eVec: THREE.Vector3,
    numPoints: number = 100
): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const b = a * Math.sqrt(1 - e * e); // semi-minor axis
    const c = a * e; // distance from center to focus

    // Normalize vectors
    const hNorm = h.clone().normalize();
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Calculate center of ellipse (offset from focus by -c along periapsis direction)
    const center = periapsisDir.clone().multiplyScalar(-c);

    // Generate ellipse points in the orbit plane
    for (let i = 0; i <= numPoints; i++) {
        const theta = (i / numPoints) * Math.PI * 2;

        // Calculate point relative to ellipse center
        const point = new THREE.Vector3()
            .addScaledVector(periapsisDir, a * Math.cos(theta))
            .addScaledVector(perpDir, b * Math.sin(theta))
            .add(center);

        points.push(point);
    }

    return points;
}
//TODO store bezier curves in the orbit class
export function generateHyperbolicBezierPoints(
    a: number,
    e: number,
    h: THREE.Vector3,
    eVec: THREE.Vector3
): { points: THREE.Vector3[], curves: BezierCurve[] } {
    const points: THREE.Vector3[] = [];
    const numPointsPerCurve = 25;
    const b = a * Math.sqrt(e * e - 1);
    const c = a * e;

    // Normalize vectors
    const hNorm = h.clone().normalize();
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Calculate center of hyperbola
    const center = periapsisDir.clone().multiplyScalar(-c);

    // Calculate angle of asymptotes
    const alpha = Math.acos(-1 / e);
    const tanAlpha = Math.tan(alpha);

    // Scale factor for control points (can be adjusted for better fit)
    const scale = 2.0;

    // Control points for both branches of the hyperbola
    const controlPoints = [
        // Right branch (periapsis side)
        new THREE.Vector3(a * (e - 1), 0, 0), // Periapsis point
        new THREE.Vector3(a * (e - 1 + scale), b * scale * 0.5, 0),
        new THREE.Vector3(a * (e - 1 + scale * 2), b * scale, 0),
        new THREE.Vector3(a * (e - 1 + scale * 3), b * scale * 1.5, 0),
        // Left branch (mirror of right branch)
        new THREE.Vector3(a * (-e + 1), 0, 0), // Mirror periapsis point
        new THREE.Vector3(a * (-e + 1 - scale), -b * scale * 0.5, 0),
        new THREE.Vector3(a * (-e + 1 - scale * 2), -b * scale, 0),
        new THREE.Vector3(a * (-e + 1 - scale * 3), -b * scale * 1.5, 0)
    ];

    // Transform control points to orbit plane
    const transformedPoints = controlPoints.map(p => {
        const transformed = new THREE.Vector3();
        transformed.addScaledVector(periapsisDir, p.x);
        transformed.addScaledVector(perpDir, p.y);
        return transformed.add(center);
    });

    // Create Bezier curves for both branches
    const rightCurve = new BezierCurve(
        transformedPoints[0],
        transformedPoints[1],
        transformedPoints[2],
        transformedPoints[3]
    );

    const leftCurve = new BezierCurve(
        transformedPoints[4],
        transformedPoints[5],
        transformedPoints[6],
        transformedPoints[7]
    );

    // Generate points for both curves
    for (let i = 0; i <= numPointsPerCurve; i++) {
        const t = i / numPointsPerCurve;
        points.push(rightCurve.getPoint(t));
    }
    for (let i = 0; i <= numPointsPerCurve; i++) {
        const t = i / numPointsPerCurve;
        points.push(leftCurve.getPoint(t));
    }

    return {
        points,
        curves: [rightCurve, leftCurve]  // Return both curves
    };
}

export function generateBezierOrbitPoints(
    a: number,
    e: number,
    h: THREE.Vector3,
    eVec: THREE.Vector3
): { points: { position: THREE.Vector3, t: number }[], curves: BezierCurve[] } {
    const points: { position: THREE.Vector3, t: number }[] = [];
    const numPointsPerCurve = 32; // 4 curves * 32 = 128 points
    const b = a * Math.sqrt(1 - e * e); // semi-minor axis
    const c = a * e; // distance from center to focus

    // Normalize vectors
    const hNorm = h.clone().normalize();
    const eNorm = eVec.clone().normalize();

    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    // Calculate center of ellipse (offset from focus by -c along periapsis direction)
    const center = periapsisDir.clone().multiplyScalar(-c);

    // Magic number for cubic Bezier approximation of circular arcs
    // This is (4/3)*tan(π/8) ≈ 0.5519150244935105707435627
    const k = 0.551915024494;

    // Create 4 cubic Bezier curves to approximate the ellipse
    const curves: BezierCurve[] = [];

    // Quarter ellipse 1: 0° to 90°
    const c1 = new BezierCurve(
        new THREE.Vector3().addScaledVector(periapsisDir, a).addScaledVector(perpDir, 0).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, a).addScaledVector(perpDir, k * b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, k * a).addScaledVector(perpDir, b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, 0).addScaledVector(perpDir, b).add(center)
    );

    // Quarter ellipse 2: 90° to 180°
    const c2 = new BezierCurve(
        new THREE.Vector3().addScaledVector(periapsisDir, 0).addScaledVector(perpDir, b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, -k * a).addScaledVector(perpDir, b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, -a).addScaledVector(perpDir, k * b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, -a).addScaledVector(perpDir, 0).add(center)
    );

    // Quarter ellipse 3: 180° to 270°
    const c3 = new BezierCurve(
        new THREE.Vector3().addScaledVector(periapsisDir, -a).addScaledVector(perpDir, 0).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, -a).addScaledVector(perpDir, -k * b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, -k * a).addScaledVector(perpDir, -b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, 0).addScaledVector(perpDir, -b).add(center)
    );

    // Quarter ellipse 4: 270° to 360°
    const c4 = new BezierCurve(
        new THREE.Vector3().addScaledVector(periapsisDir, 0).addScaledVector(perpDir, -b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, k * a).addScaledVector(perpDir, -b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, a).addScaledVector(perpDir, -k * b).add(center),
        new THREE.Vector3().addScaledVector(periapsisDir, a).addScaledVector(perpDir, 0).add(center)
    );

    // Add curves in order starting from Apoapsis (180°)
    // Analytical model starts at Apoapsis (180°), so we order curves: Q3, Q4, Q1, Q2
    // T = 0.0 -> Apoapsis
    // T = 0.5 -> Periapsis
    // T = 1.0 -> Apoapsis
    curves.push(c3); // 180°-270°
    curves.push(c4); // 270°-360°
    curves.push(c1); // 0°-90°
    curves.push(c2); // 90°-180°

    // Generate points for visualization with t values
    curves.forEach((curve, curveIndex) => {
        // Curve 0: 0.0 - 0.25
        // Curve 1: 0.25 - 0.50
        // Curve 2: 0.50 - 0.75
        // Curve 3: 0.75 - 1.00
        const tOffset = curveIndex * 0.25;

        for (let i = 0; i < numPointsPerCurve; i++) {
            // Include start point, skip end point (it's the start of next curve)
            // UNLESS it's the very last curve, then include end point (handled by closed loop plotting usually, but let's be safe)
            // Actually Three.js LineLoop handles closed loop, OR we provide start/end match.
            // Let's generate [0, 1) effectively.
            const tLocal = i / numPointsPerCurve;
            const tGlobal = tOffset + (tLocal * 0.25);

            points.push({
                position: curve.getPoint(tLocal),
                t: tGlobal
            });
        }
    });

    return { points, curves };
}

export interface OrbitalElements {
    semiMajorAxis: number;      // a (km)
    eccentricity: number;       // e (dimensionless)
    period: number;             // T (seconds)
    isElliptical: boolean;
}

export interface OrbitBasis {
    periapsisDir: THREE.Vector3;
    perpDir: THREE.Vector3;
    h: THREE.Vector3;
    eVec: THREE.Vector3;
    M0: number; // Mean Anomaly at epoch (t=0 relative to initial state)
}

/**
 * Calculate orbital elements from state vectors
 */
export function calculateOrbitalElementsFromState(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    centralBodyMass: number
): OrbitalElements {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * centralBodyMass;

    const r = position.length();
    const v = velocity.length();

    // Specific orbital energy: ε = v²/2 - μ/r
    const specificEnergy = (v * v) / 2 - mu / r;

    // Semi-major axis: a = -μ/(2ε)
    const a = -mu / (2 * specificEnergy);

    // Specific angular momentum
    const h = new THREE.Vector3().crossVectors(position, velocity);
    const hMag = h.length();

    // Eccentricity: e = sqrt(1 + (2εh²)/μ²)
    const e = Math.sqrt(1 + (2 * specificEnergy * hMag * hMag) / (mu * mu));

    const isElliptical = e < 1.0;
    const period = isElliptical ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : 0;

    return {
        semiMajorAxis: a,
        eccentricity: e,
        period: period,
        isElliptical: isElliptical
    };
}

/**
 * Calculate orbit basis vectors and M0 from state vectors
 */
export function calculateOrbitBasis(
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    centralBodyMass: number
): OrbitBasis {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * centralBodyMass;

    const r0 = initialPosition.length();

    // Orbital elements needed for M0
    const elements = calculateOrbitalElementsFromState(initialPosition, initialVelocity, centralBodyMass);
    const e = elements.eccentricity;

    const radialVel0 = initialVelocity.dot(initialPosition.clone().normalize());
    const h = new THREE.Vector3().crossVectors(initialPosition, initialVelocity);
    const hMag = h.length();

    // Calculate True Anomaly at epoch
    const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r0 - mu);

    // Calculate Eccentric Anomaly at epoch
    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta0 / 2));

    // Calculate Mean Anomaly at epoch
    const M0 = E0 - e * Math.sin(E0);

    const hNorm = h.clone().normalize();
    const vCrossH = new THREE.Vector3().crossVectors(initialVelocity, h);
    const eVec = vCrossH.multiplyScalar(1 / mu).sub(initialPosition.clone().normalize());
    const eNorm = eVec.clone().normalize();
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

    return {
        periapsisDir,
        perpDir,
        h,
        eVec,
        M0
    };
}

/**
 * Calculate position from Mean Anomaly using pre-calculated basis vectors
 * Efficient for LUT generation and repeated calculations
 */
export function calculateEllipticalPositionFromBasis(
    M: number,
    a: number,
    e: number,
    periapsisDir: THREE.Vector3,
    perpDir: THREE.Vector3
): THREE.Vector3 {
    // Solve Kepler's Eq: E - e*sin(E) = M
    let E = M;
    for (let iter = 0; iter < 10; iter++) {
        E = M + e * Math.sin(E);
    }

    // True Anomaly
    const theta = 2 * Math.atan2(
        Math.sqrt(1 + e) * Math.sin(E / 2),
        Math.sqrt(1 - e) * Math.cos(E / 2)
    );

    // Radius
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta));

    // Position in orbital plane
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);

    // Transform to 3D
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, x)
        .addScaledVector(perpDir, y);
}

/**
 * Calculate analytical orbital state for a given time
 */
export function getAnalyticalState(
    time: number,
    a: number,
    e: number,
    period: number,
    startTime: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    planetMass: number,
    isHyperbolic: boolean = false
): OrbitalState {
    if (isHyperbolic) {
        return {
            position: calculateHyperbolicPosition(time, a, e, startTime, initialPos, initialVel, planetMass),
            velocity: calculateHyperbolicVelocity(time, a, e, startTime, initialPos, initialVel, planetMass)
        };
    } else {
        return {
            position: calculateEllipticalPosition(time, a, e, period, startTime, initialPos, initialVel, planetMass),
            velocity: calculateEllipticalVelocity(time, a, e, period, startTime, initialPos, initialVel, planetMass)
        };
    }
}

/**
 * Calculate analytical orbital state from state vectors
 */
export function getAnalyticalStateFromState(
    time: number,
    initialPos: THREE.Vector3,
    initialVel: THREE.Vector3,
    centralBodyMass: number,
    startTime: number = 0
): OrbitalState {
    const elements = calculateOrbitalElementsFromState(initialPos, initialVel, centralBodyMass);
    return getAnalyticalState(
        time,
        elements.semiMajorAxis,
        elements.eccentricity,
        elements.period,
        startTime,
        initialPos,
        initialVel,
        centralBodyMass,
        !elements.isElliptical
    );
}

/**
 * Calculate time warp function value
 */
export function calculateBezierTimeWarp(
    t: number,
    lut: BezierTimeWarpLUT,
    interpolationMode: 'linear' | 'cubic' = 'cubic'
): number {
    t = Math.max(0, Math.min(1, t));
    const { M, bezierT, bezierPoints } = lut;

    let normalizedT = t;
    let isMirrored = false;
    if (t > 0.5) {
        normalizedT = 1.0 - t;
        isMirrored = true;
    }

    if (normalizedT <= M[0]) {
        const val = bezierT[0];
        return isMirrored ? 1.0 - val : val;
    }
    if (normalizedT >= M[M.length - 1]) {
        const val = bezierT[bezierT.length - 1];
        return isMirrored ? 1.0 - val : val;
    }

    let left = 0, right = M.length - 1;
    while (right - left > 1) {
        const mid = Math.floor((left + right) / 2);
        if (M[mid] <= normalizedT) left = mid;
        else right = mid;
    }

    const M0 = M[left], M1 = M[right];
    const T0 = bezierT[left], T1 = bezierT[right];
    const pts = bezierPoints[left];

    let result = T0 + (T1 - T0) * ((normalizedT - M0) / (M1 - M0));

    if (pts && interpolationMode === 'cubic') {
        const u = (normalizedT - M0) / (M1 - M0);
        const oneMinusU = 1 - u;
        result = (oneMinusU ** 3) * T0 +
            3 * (oneMinusU ** 2) * u * pts.p1 +
            3 * oneMinusU * (u ** 2) * pts.p2 +
            (u ** 3) * T1;
    }

    return isMirrored ? 1.0 - result : result;
}

/**
 * Calculate derivative of the time warp function dt/dM
 */
export function calculateTimeWarpDerivative(
    t: number,
    lut: BezierTimeWarpLUT,
    interpolationMode: 'linear' | 'cubic' = 'cubic'
): number {
    t = Math.max(0, Math.min(1, t));
    const { M, bezierT, bezierPoints } = lut;

    let normalizedT = t;
    if (t > 0.5) {
        normalizedT = 1.0 - t;
    }

    if (normalizedT <= M[0] || normalizedT >= M[M.length - 1]) return 1.0;

    let left = 0, right = M.length - 1;
    while (right - left > 1) {
        const mid = Math.floor((left + right) / 2);
        if (M[mid] <= normalizedT) left = mid;
        else right = mid;
    }

    const M0 = M[left], M1 = M[right];
    const T0 = bezierT[left], T1 = bezierT[right];
    const pts = bezierPoints[left];

    const dM = M1 - M0;
    if (dM < 1e-9) return 1.0;

    const u = (normalizedT - M0) / dM;
    const du_dM = 1.0 / dM;

    let dT_du = 0;

    if (pts && interpolationMode === 'cubic') {
        const oneMinusU = 1 - u;
        const term1 = 3 * oneMinusU * oneMinusU * (pts.p1 - T0);
        const term2 = 6 * oneMinusU * u * (pts.p2 - pts.p1);
        const term3 = 3 * u * u * (T1 - pts.p2);
        dT_du = term1 + term2 + term3;
    } else {
        dT_du = T1 - T0;
    }

    return dT_du * du_dM;
}

/**
 * Get Bezier orbital state
 */
export function getBezierState(
    time: number,
    startTime: number,
    period: number,
    basis: OrbitBasis,
    lut: BezierTimeWarpLUT,
    bezierCurves: BezierCurve[],
    options: { calcVelocity: boolean, interpolationMode?: 'linear' | 'cubic' } = { calcVelocity: true, interpolationMode: 'cubic' }
): { position: THREE.Vector3 | null, velocity: THREE.Vector3 | null } {
    if (period === 0) return { position: null, velocity: null };

    const n = 2 * Math.PI / period;
    const dt = time - startTime;
    const M_current_peri = basis.M0 + n * dt;
    const M_norm_peri = M_current_peri / (2 * Math.PI);
    const M_wrapped_peri = ((M_norm_peri % 1) + 1) % 1;
    const M_wrapped_apo = (M_wrapped_peri + 0.5) % 1.0;

    const interpMode = options.interpolationMode || 'cubic';
    const warpedTime = calculateBezierTimeWarp(M_wrapped_apo, lut, interpMode);

    if (isNaN(warpedTime)) return { position: null, velocity: null };

    const numCurves = bezierCurves.length;
    const totalProgress = warpedTime * numCurves;
    const normalizedTotal = totalProgress - Math.floor(totalProgress);
    let curveIndex = Math.floor(totalProgress) % numCurves;
    if (curveIndex < 0) curveIndex += numCurves;

    if (curveIndex >= numCurves || !bezierCurves[curveIndex]) return { position: null, velocity: null };
    
    const position = bezierCurves[curveIndex].getPoint(normalizedTotal);

    let velocity: THREE.Vector3 | null = null;
    if (options.calcVelocity && position) {
        const dT_dM = calculateTimeWarpDerivative(M_wrapped_apo, lut, interpMode);
        const dP_dT_local = bezierCurves[curveIndex].getDerivative(normalizedTotal);
        const dP_dT = dP_dT_local.multiplyScalar(numCurves);
        const dM_dt = 1.0 / (period); // dM/dt in 1/s (M is in radians here, so we need n = 2pi/P? No, if period is in seconds, n = 2pi/P)
        // Actually dT_dM is dimensionless (dt_bezier / dM_wrapped).
        // dM_wrapped = M_std / 2pi.
        // So dT/dt = (dT/dM_wrapped) * (dM_wrapped/dt) = dT_dM * (n / 2pi) = dT_dM * (1/P).
        velocity = dP_dT.multiplyScalar(dT_dM / period);
    }

    return { position, velocity };
}

/**
 * Fit a cubic 1D Bezier curve to samples
 */
export function fitCubicBezier1D(y0: number, y3: number, samples: { u: number, y: number }[]): { p1: number, p2: number } {
    if (samples.length === 0) return { p1: y0 + (y3 - y0) / 3, p2: y0 + 2 * (y3 - y0) / 3 };

    let c11 = 0, c12 = 0, c22 = 0, r1 = 0, r2 = 0;
    for (const sample of samples) {
        const u = sample.u;
        const y = sample.y;
        const oneMinusU = 1 - u;
        const b1 = 3 * oneMinusU * oneMinusU * u;
        const b2 = 3 * (1 - u) * u * u;
        const b0 = (1 - u) ** 3;
        const b3 = u ** 3;
        const residual = y - (b0 * y0 + b3 * y3);
        c11 += b1 * b1; c12 += b1 * b2; c22 += b2 * b2;
        r1 += b1 * residual; r2 += b2 * residual;
    }

    const det = c11 * c22 - c12 * c12;
    if (Math.abs(det) < 1e-12) return { p1: y0 + (y3 - y0) / 3, p2: y0 + 2 * (y3 - y0) / 3 };

    const invDet = 1.0 / det;
    return { p1: (c22 * r1 - c12 * r2) * invDet, p2: (c11 * r2 - c12 * r1) * invDet };
}

/**
 * Optimize bezierT to minimize position error from analytical position
 */
export function optimizeBezierT(
    analyticalPos: THREE.Vector3, 
    initialGuess: number, 
    bezierCurves: BezierCurve[]
): number {
    if (!bezierCurves || bezierCurves.length === 0) return initialGuess;

    const numCurves = bezierCurves.length;
    const computePos = (t: number) => {
        const totalProgress = t * numCurves;
        const normalizedTotal = totalProgress - Math.floor(totalProgress);
        let curveIndex = Math.floor(totalProgress) % numCurves;
        if (curveIndex < 0) curveIndex += numCurves;
        return bezierCurves[curveIndex].getPoint(normalizedTotal);
    };

    const objectiveFunction = (bezierT: number): number => {
        const bezierPos = computePos(bezierT);
        return analyticalPos.distanceTo(bezierPos);
    };

    // Grid search
    const gridSize = 50;
    let bestT = initialGuess;
    let bestError = objectiveFunction(initialGuess);

    // Search around guess
    for (let i = -5; i <= 5; i++) {
        let t = initialGuess + (i / gridSize) * 0.1;
        t = ((t % 1) + 1) % 1;
        const error = objectiveFunction(t);
        if (error < bestError) {
            bestError = error;
            bestT = t;
        }
    }

    // Golden section search
    const phi = (1 + Math.sqrt(5)) / 2;
    const tolerance = 1e-8;
    let a_range = Math.max(0, bestT - 0.02);
    let b_range = Math.min(1, bestT + 0.02);
    let c = b_range - (b_range - a_range) / phi;
    let d_val = a_range + (b_range - a_range) / phi;

    for (let iter = 0; iter < 40; iter++) {
        if (objectiveFunction(c) < objectiveFunction(d_val)) {
            b_range = d_val; d_val = c; c = b_range - (b_range - a_range) / phi;
        } else {
            a_range = c; c = d_val; d_val = a_range + (b_range - a_range) / phi;
        }
        if (Math.abs(b_range - a_range) < tolerance) break;
    }

    return (a_range + b_range) / 2;
}

/**
 * Build Time Warp LUT
 */
export function buildTimeWarpLUT(
    centralBodyMass: number,
    initialPosition: THREE.Vector3,
    initialVelocity: THREE.Vector3,
    semiMajorAxis: number,
    eccentricity: number,
    bezierCurves: BezierCurve[],
    basis: OrbitBasis
): BezierTimeWarpLUT {
    const GValue = (G as any).over(gravitationalConstantUnit).value;
    const mu = GValue * centralBodyMass;
    const e = eccentricity;
    const { periapsisDir, perpDir } = basis;

    // Generate knots and intermediate samples
    const numIntervals = 4;
    const subSamplesPerInterval = 16;
    const totalFitSamples = numIntervals * subSamplesPerInterval;

    const lutM: number[] = [];
    const lutBezierT: number[] = [];
    const bezierPoints: { p1: number, p2: number }[] = [];
    const lutErrors: number[] = [];

    const fitData: { u: number, M: number, bezierT: number, error: number }[] = [];

    for (let i = 0; i <= totalFitSamples; i++) {
        // Sample in Eccentric Anomaly from Pi to 2Pi (Apo to Peri)
        const E = Math.PI + (i / totalFitSamples) * Math.PI;
        const M_standard = E - e * Math.sin(E);
        const M_relative_apo = (M_standard - Math.PI) / (2 * Math.PI);
        const M_wrapped = M_relative_apo;

        // Analytical position relative to Periapsis
        const M_target = (M_standard / (2 * Math.PI)) * 2 * Math.PI;
        const analyticalPos = calculateEllipticalPositionFromBasis(M_target, semiMajorAxis, e, periapsisDir, perpDir);

        const initialGuessT = (E - Math.PI) / (2 * Math.PI);
        const T = optimizeBezierT(analyticalPos, initialGuessT, bezierCurves);

        // Error
        const numCurves = bezierCurves.length;
        const totalProgress = T * numCurves;
        const normalizedTotal = totalProgress - Math.floor(totalProgress);
        let curveIndex = Math.floor(totalProgress) % numCurves;
        if (curveIndex < 0) curveIndex += numCurves;
        const bezierPos = bezierCurves[curveIndex].getPoint(normalizedTotal);
        const error = analyticalPos.distanceTo(bezierPos);

        fitData.push({ u: i / totalFitSamples, M: M_wrapped, bezierT: T, error });
    }

    fitData.sort((a, b) => a.M - b.M);

    for (let i = 0; i < fitData.length - 1; i += subSamplesPerInterval) {
        let p3Index = i + subSamplesPerInterval;
        if (p3Index >= fitData.length) p3Index = fitData.length - 1;
        if (p3Index <= i) break;

        const segmentSamples = fitData.slice(i, p3Index + 1);
        const startNode = segmentSamples[0];
        const endNode = segmentSamples[segmentSamples.length - 1];

        if (lutM.length === 0) {
            lutM.push(startNode.M);
            lutBezierT.push(startNode.bezierT);
            lutErrors.push(startNode.error);
        }
        lutM.push(endNode.M);
        lutBezierT.push(endNode.bezierT);
        lutErrors.push(endNode.error);

        const mStart = startNode.M;
        const mEnd = endNode.M;
        const tStart = startNode.bezierT;
        const tEnd = endNode.bezierT;

        const samplesForFit = segmentSamples.map(s => {
            let u_local = (s.M - mStart) / (mEnd - mStart);
            if (isNaN(u_local)) u_local = 0;
            return { u: u_local, y: s.bezierT };
        });

        const control = fitCubicBezier1D(tStart, tEnd, samplesForFit);
        bezierPoints.push(control);

        if (p3Index === fitData.length - 1) break;
    }

    return {
        M: lutM,
        bezierT: lutBezierT,
        bezierPoints: bezierPoints,
        errors: lutErrors
    };
}

// ============================================================================
// Transfer Calculator Logic
// ============================================================================

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
    startTime: number; // Time of the transfer began
    
    // Optional heatmap data for visualization (populated when returnHeatmap=true)
    heatmap?: {
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
    static calculateTransfer(
        startBody: OrbitalBody, 
        endBody: OrbitalBody, 
        centralBodyMass: number,
        startTime: number = 0,
        timeOfFlight: number
    ): TransferResult | null {
        
        // Setup physics constants
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        // 1. Get positions at evaluation time based on CURRENT state prediction
        // This ensures we account for numerical drift or manual state changes
        const rocketState = startBody.getTrajectory().getBezierState(startTime, {calcVelocity:true}); 
        const r1Vec = rocketState.position;
        const v1Vec = rocketState.velocity;
        
        const targetStateArrival = endBody.getTrajectory().getBezierState(startTime+timeOfFlight,{calcVelocity:true})
        const r2Vec_arrival = targetStateArrival.position;
        const v2ArrivalVec = targetStateArrival.velocity;
        
        // print error
        if (!r2Vec_arrival || !v2ArrivalVec || !r1Vec || !v1Vec) {
            console.log("State calculation failed");
            return null;
        }

        // 3. Solve Lambert's Problem to find required velocities
        const solutions = this.solveLambert(r1Vec, r2Vec_arrival, timeOfFlight, mu, v1Vec, v2ArrivalVec);
        if (solutions.length === 0) return null;
        
        // Use the first solution (lowest delta-v)
        const lambert = solutions[0];

        // 4. Calculate Delta-V (already calculated in solveLambert, but recalculate for consistency)
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
            startTime
        };
    }


    
    /**
     * Search for the optimal transfer (varying both start delay and time of flight).
     * 
     * If seed parameters are provided, performs only the refinement phase (hill-climbing).
     * If seed parameters are omitted, performs a coarse grid search first to find a good seed,
     * then refines it.
     * 
     * @param seedDelay Optional initial delay to refine around (seconds relative to startTime)
     * @param seedTOF Optional initial time of flight to refine around (seconds)
     * @param initialDelayRange Optional search range for delay refinement (seconds)
     * @param initialTOFRange Optional search range for TOF refinement (seconds)
     * @param returnHeatmap If true, populates the heatmap property with visualization data
     */
    static calculateOptimalTransfer(
        startBody: OrbitalBody,
        endBody: OrbitalBody,
        centralBodyMass: number,
        startTime: number,
        seedDelay?: number,
        seedTOF?: number,
        initialDelayRange?: number,
        initialTOFRange?: number,
        returnHeatmap?: boolean
    ): TransferResult | null {
        // Ensure bodies are different
        if (startBody === endBody) return null;

        // Calculate common parameters
        const startParams = startBody.getTrajectory().parameters;
        const startPeriod = (startParams.period as any).over(seconds).value || 3600 * 24;
        
        const startPos = startBody.getPosition();
        const targetPos = endBody.getPosition();
        const r1 = startPos.length();
        const r2 = targetPos.length();
        
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;
        const estTOF = Math.PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu);

        // Phase 1: Coarse grid search (only if no seed provided)
        let currentDelay = seedDelay;
        let currentTOF = seedTOF;
        let dRange = initialDelayRange ?? 0;
        let tRange = initialTOFRange ?? 0;

        // Heatmap data collection (if requested)
        const heatmapX: number[] = [];
        const heatmapY: number[] = [];
        const heatmapZ: number[][] = [];
        const heatmapTooltips: string[][] = [];
        let zMin = Infinity;
        let zMax = -Infinity;

        if (currentDelay === undefined || currentTOF === undefined) {
            const delaySteps = returnHeatmap ? 32 : 64; 
            const tofSteps = returnHeatmap ? 32 : 64;

            const searchRange = startPeriod; 
            const yMinVal = estTOF * 0.5;
            const yMaxVal = estTOF * 1.5;

            const dx = searchRange / delaySteps;
            const dy = (yMaxVal - yMinVal) / tofSteps;

            let bestResult: TransferResult | null = null;
            let minTotalDV = Infinity;

            // Build heatmap grid if requested
            if (returnHeatmap) {
                for (let i = 0; i < delaySteps; i++) heatmapX.push((i + 0.5) * dx);
                for (let j = 0; j < tofSteps; j++) heatmapY.push(yMinVal + (j + 0.5) * dy);
            }

            for (let j = 0; j < tofSteps; j++) {
                const rowZ: number[] = [];
                const rowTooltips: string[] = [];
                const tof = yMinVal + (j + 0.5) * dy;

                for (let i = 0; i < delaySteps; i++) {
                    const delay = (i + 0.5) * dx;
                    const result = this.calculateTransfer(startBody, endBody, centralBodyMass, startTime + delay, tof);
                    
                    if (result) {
                        const totalDV = result.deltaV1 + result.deltaV2;
                        if (totalDV < minTotalDV) {
                            minTotalDV = totalDV;
                            bestResult = result;
                        }

                        if (returnHeatmap) {
                            const logDV = Math.log10(Math.max(totalDV, 0.001));
                            rowZ.push(logDV);
                            zMin = Math.min(zMin, logDV);
                            zMax = Math.max(zMax, logDV);
                            rowTooltips.push(`Delay: ${formatTime(Measure.of(delay, seconds), true)}<br>TOF: ${formatTime(Measure.of(tof, seconds), true)}<br>Total ΔV: ${totalDV.toFixed(4)} km/s`);
                        }
                    } else if (returnHeatmap) {
                        rowZ.push(-3);
                        rowTooltips.push(`Delay: ${formatTime(Measure.of(delay, seconds), true)}<br>TOF: ${formatTime(Measure.of(tof, seconds), true)}<br>ΔV: N/A`);
                    }
                }

                if (returnHeatmap) {
                    heatmapZ.push(rowZ);
                    heatmapTooltips.push(rowTooltips);
                }
            }

            if (!bestResult) return null;

            // Use grid search result as seed
            currentDelay = bestResult.startTime - startTime;
            currentTOF = bestResult.timeOfFlight;
            dRange = dx;
            tRange = dy;
        }

        // Phase 2: Hill-climbing refinement
        let bestResult = this.calculateTransfer(startBody, endBody, centralBodyMass, startTime + currentDelay, currentTOF);
        if (!bestResult) return null;

        let bestDV = bestResult.deltaV1 + bestResult.deltaV2;

        const passes = 4;
        const stepsPerPass = 10;

        for (let pass = 0; pass < passes; pass++) {
            let passFoundBetter = false;

            for (let i = 0; i < stepsPerPass; i++) {
                // Simultaneous search in 2D space around current best
                const gridRes = 5;
                for (let dj = -(gridRes-1)/2; dj <= (gridRes-1)/2; dj++) {
                    for (let tk = -(gridRes-1)/2; tk <= (gridRes-1)/2; tk++) {
                        if (dj === 0 && tk === 0) continue;

                        const testDelay = Math.max(0, currentDelay + (dj / (gridRes/2)) * dRange);
                        const testTOF = Math.max(0.1, currentTOF + (tk / (gridRes/2)) * tRange);

                        const result = this.calculateTransfer(startBody, endBody, centralBodyMass, startTime + testDelay, testTOF);
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

    // Populate heatmap data if requested
    if (returnHeatmap && bestResult) {
        bestResult.heatmap = {
            x: heatmapX,
            y: heatmapY,
            z: heatmapZ,
            zMin: zMin === Infinity ? -3 : zMin,
            zMax: zMax === -Infinity ? 0 : zMax,
            tooltips: heatmapTooltips
        };
    }

    return bestResult;
}


/**
 * Solve Lambert's problem and return all valid solutions sorted by total delta-v.
 * Returns both prograde and retrograde solutions when applicable.
 * 
 * @param r1Vec Starting position vector
 * @param r2Vec Ending position vector  
 * @param dt Time of flight
 * @param mu Gravitational parameter
 * @param r1Vel Current velocity at r1 (for delta-v calculation)
 * @param r2Vel Current velocity at r2 (for delta-v calculation)
 * @returns Array of solutions sorted by total delta-v (lowest first), or empty array if no solutions
 */
public static solveLambert(
    r1Vec: THREE.Vector3, 
    r2Vec: THREE.Vector3, 
    dt: number, 
    mu: number, 
    r1Vel?: THREE.Vector3,
    r2Vel?: THREE.Vector3
): Array<{ v1: THREE.Vector3, v2: THREE.Vector3, deltaV: number, type: 'prograde' | 'retrograde' }> {
    
    const solutions: Array<{ v1: THREE.Vector3, v2: THREE.Vector3, deltaV: number, type: 'prograde' | 'retrograde' }> = [];
    
    // Try both prograde and retrograde solutions
    for (const prograde of [true, false]) {
        const solution = this.solveLambertSingle(r1Vec, r2Vec, dt, mu, prograde);
        
        if (solution) {
            // Calculate total delta-v if velocities provided
            let deltaV = 0;
            if (r1Vel && r2Vel) {
                const dv1 = solution.v1.clone().sub(r1Vel).length();
                const dv2 = solution.v2.clone().sub(r2Vel).length();
                deltaV = dv1 + dv2;
            }
            
            solutions.push({
                v1: solution.v1,
                v2: solution.v2,
                deltaV: deltaV,
                type: prograde ? 'prograde' : 'retrograde'
            });
        }
    }
    
    // Sort by delta-v (lowest first)
    solutions.sort((a, b) => a.deltaV - b.deltaV);
    
    return solutions;
}

/**
 * Internal single-solution Lambert solver for a specific direction (prograde/retrograde)
 */
private static solveLambertSingle(
    r1Vec: THREE.Vector3, 
    r2Vec: THREE.Vector3, 
    dt: number, 
    mu: number, 
    prograde: boolean
): { v1: THREE.Vector3, v2: THREE.Vector3 } | null {
    
    const r1 = r1Vec.length();
    const r2 = r2Vec.length();

    // 1. Geometry & Angle Calculation
    let cosTheta = r1Vec.dot(r2Vec) / (r1 * r2);
    cosTheta = Math.max(-1, Math.min(1, cosTheta));
    
    let theta = Math.acos(cosTheta);
    const cross = new THREE.Vector3().crossVectors(r1Vec, r2Vec);

    // FIX: Handling the 180-degree (Opposition) Singularity
    // If the transfer is exactly 180 degrees, the orbital plane is infinite.
    // We nudge slightly or assume the XY plane to maintain numerical stability.
    const isOpposition = Math.abs(theta - Math.PI) < 1e-11;
    if (isOpposition) {
        theta -= 1e-10; // Epsilon nudge to define a plane
    }

    if (prograde ? cross.z < 0 : cross.z > 0) {
        theta = 2 * Math.PI - theta;
    }

    // 2. Geometric Constant A
    const A = Math.sin(theta) * Math.sqrt(r1 * r2 / (1 - cosTheta));
    if (Math.abs(A) < 1e-12) return null;

    // 3. Robust Root Finding (z-parameter)
    // z > 0: Elliptic, z < 0: Hyperbolic, z = 0: Parabolic
    let z = 0.0;
    let zLow = -100; // Deeply hyperbolic limit
    let zHigh = 4 * Math.PI * Math.PI; // Single-rev elliptic limit

    let dt_est = 0;
    const maxIter = 150;
    const tol = 1e-12;

    for (let i = 0; i < maxIter; i++) {
        const { c, s } = this.stumpff(z);
        
        // y is the core Lagrange helper
        const sqrtC = Math.sqrt(c);
        let y = r1 + r2 + A * (z * s - 1) / sqrtC;

        // Physical constraint: y must be positive
        if (A > 0 && y < 0) {
            // If y is negative, we are in a non-physical region for the current z.
            // We must adjust zLow to "pinch" the root into the physical domain.
            zLow = z;
            z = (zLow + zHigh) / 2;
            continue;
        }

        const chi = Math.sqrt(y / c);
        dt_est = (Math.pow(chi, 3) * s + A * Math.sqrt(y)) / Math.sqrt(mu);

        if (Math.abs(dt - dt_est) < tol) break;

        // Bisection is used here for absolute "never-fail" convergence.
        // Newton-Raphson is faster but can oscillate near e=1; bisection is safer for random tests.
        if (dt_est < dt) {
            zLow = z;
        } else {
            zHigh = z;
        }
        z = (zLow + zHigh) / 2;
    }

    // 4. Final Velocity Extraction
    const { c, s } = this.stumpff(z);
    const y = r1 + r2 + A * (z * s - 1) / Math.sqrt(c);
    
    const f = 1 - y / r1;
    const g = A * Math.sqrt(y / mu);
    const gDot = 1 - y / r2;

    // Avoid division by zero in g
    if (Math.abs(g) < 1e-12) return null;

    const v1 = r2Vec.clone().sub(r1Vec.clone().multiplyScalar(f)).divideScalar(g);
    const v2 = r2Vec.clone().multiplyScalar(gDot).sub(r1Vec).divideScalar(g);

    return { v1, v2 };
}


private static stumpff(z: number): { c: number, s: number } {
    const eps = 1e-8;
    if (z > eps) {
        const sz = Math.sqrt(z);
        return {
            c: (1 - Math.cos(sz)) / z,
            s: (sz - Math.sin(sz)) / Math.pow(sz, 3)
        };
    } else if (z < -eps) {
        const sz = Math.sqrt(-z);
        return {
            c: (Math.cosh(sz) - 1) / -z,
            s: (Math.sinh(sz) - sz) / Math.pow(sz, 3)
        };
    } else {
        // Taylor series expansion for high precision near parabolic limit (z=0)
        return {
            c: 1/2 - z/24 + (z*z)/720 - (z*z*z)/40320,
            s: 1/6 - z/120 + (z*z)/5040 - (z*z*z)/362880
        };
    }
}


public static testLambertSolver(numTests: number = 10, centralBodyMass: number = 5.972e24): void {
    const GValue = 6.67430e-20; // Ensure units match (km^3 / kg*s^2)
    const mu = GValue * centralBodyMass;

    let r1Errors: number[] = [];
    let r2Errors: number[] = [];
    let failedTests = 0;

    for (let testNum = 0; testNum < numTests; testNum++) {
        try {
            // 1. Generate TWO random elliptical orbits
            // Orbit 1 (departure)
            const rp1 = 6371 + 400 + Math.random() * 5000; 
            const ra1 = rp1 + Math.random() * 5000;
            const e1 = (ra1 - rp1) / (ra1 + rp1);
            
            const orbit1State = generateStateFromOrbitalElements(
                rp1, ra1, e1, centralBodyMass, 
                Math.random() * Math.PI, // random true anomaly
                Math.random() * 0.5,      // low inclination for stability
                0, 0
            );
            
            // Orbit 2 (arrival)
            const rp2 = 6371 + 400 + Math.random() * 8000; 
            const ra2 = rp2 + Math.random() * 8000;
            const e2 = (ra2 - rp2) / (ra2 + rp2);
            
            const orbit2State = generateStateFromOrbitalElements(
                rp2, ra2, e2, centralBodyMass, 
                Math.random() * Math.PI, // random true anomaly
                Math.random() * 0.5,      // low inclination for stability
                0, 0
            );

            // 2. Choose a transfer time (30 mins to 3 hours)
            const dt = 1800 + Math.random() * 9000; 
            
            // 3. Get the orbital elements for both orbits
            const elements1 = calculateOrbitalElementsFromState(orbit1State.position, orbit1State.velocity, centralBodyMass);
            const elements2 = calculateOrbitalElementsFromState(orbit2State.position, orbit2State.velocity, centralBodyMass);
            
            // Validate orbital elements
            if (!isFinite(elements1.semiMajorAxis) || !isFinite(elements1.eccentricity) || 
                !isFinite(elements2.semiMajorAxis) || !isFinite(elements2.eccentricity)) {
                console.warn(`Test ${testNum + 1}: Invalid orbital elements generated, skipping`);
                failedTests++;
                continue;
            }
            
            // 4. Propagate both orbits forward by dt to get r1 and r2 at transfer endpoints
            const r1 = calculateEllipticalPosition(
                dt, elements1.semiMajorAxis, elements1.eccentricity, 
                elements1.period, 0, orbit1State.position, orbit1State.velocity, centralBodyMass
            );
            
            const r2 = calculateEllipticalPosition(
                dt, elements2.semiMajorAxis, elements2.eccentricity, 
                elements2.period, 0, orbit2State.position, orbit2State.velocity, centralBodyMass
            );

            // Validate positions
            if (!r1 || !r2 || !isFinite(r1.x) || !isFinite(r2.x)) {
                console.warn(`Test ${testNum + 1}: Invalid propagated positions, skipping`);
                failedTests++;
                continue;
            }


            // 5. Solve Lambert's Problem between r1 and r2
            const solutions = this.solveLambert(r1, r2, dt, mu);

            if (solutions.length === 0) {
                console.warn(`Test ${testNum + 1}: Lambert solver failed to converge, skipping`);
                failedTests++;
                continue;
            }
            
            // Use the first (best) solution
            const lambert = solutions[0];

            // Validate Lambert velocities
            if (!isFinite(lambert.v1.x) || !isFinite(lambert.v2.x)) {
                console.warn(`Test ${testNum + 1}: Lambert solver returned invalid velocities, skipping`);
                failedTests++;
                continue;
            }

            // 6. Propagate using Lambert velocities to verify accuracy
            // Start from r1 with Lambert v1, propagate forward by dt
            const lambertElements1 = calculateOrbitalElementsFromState(r1, lambert.v1, centralBodyMass);
            
            // Check for hyperbolic/parabolic orbits (e >= 1)
            if (lambertElements1.eccentricity >= 0.99) {
                console.warn(`Test ${testNum + 1}: Lambert solution is near-parabolic (e=${lambertElements1.eccentricity.toFixed(4)}), skipping`);
                failedTests++;
                continue;
            }
            
            const propagatedR2FromLambert = calculateEllipticalPosition(
                dt, lambertElements1.semiMajorAxis, lambertElements1.eccentricity, 
                lambertElements1.period, 0, r1, lambert.v1, centralBodyMass
            );
            
            // Start from r2 with Lambert v2, propagate backward by -dt
            const lambertElements2 = calculateOrbitalElementsFromState(r2, lambert.v2, centralBodyMass);
            
            if (lambertElements2.eccentricity >= 0.99) {
                console.warn(`Test ${testNum + 1}: Lambert solution is near-parabolic (e=${lambertElements2.eccentricity.toFixed(4)}), skipping`);
                failedTests++;
                continue;
            }
            
            const propagatedR1FromLambert = calculateEllipticalPosition(
                -dt, lambertElements2.semiMajorAxis, lambertElements2.eccentricity, 
                lambertElements2.period, 0, r2, lambert.v2, centralBodyMass
            );
            
            // Validate propagated results
            if (!propagatedR1FromLambert || !propagatedR2FromLambert || 
                !isFinite(propagatedR1FromLambert.x) || !isFinite(propagatedR2FromLambert.x)) {
                console.warn(`Test ${testNum + 1}: Propagation failed, skipping`);
                failedTests++;
                continue;
            }
            
            // Compute errors
            const r1Error = propagatedR1FromLambert.distanceTo(r1);
            const r2Error = propagatedR2FromLambert.distanceTo(r2);
            
            if (!isFinite(r1Error) || !isFinite(r2Error)) {
                console.warn(`Test ${testNum + 1}: Error calculation resulted in NaN, skipping`);
                failedTests++;
                continue;
            }
            
            r1Errors.push(r1Error);
            r2Errors.push(r2Error);

            console.log(`Test ${testNum + 1}: r1 Error = ${r1Error.toFixed(8)} km, r2 Error = ${r2Error.toFixed(8)} km`);
            
            // Debug output when errors exceed 1km
            if (r1Error > 1.0 || r2Error > 1.0) {
                console.log(`\n========== DEBUG: Test ${testNum + 1} - Error > 1km ==========`);
                console.log(`\nOriginal Orbit 1 (Departure):`);
                console.log(`  Periapsis: ${rp1.toFixed(3)} km`);
                console.log(`  Apoapsis: ${ra1.toFixed(3)} km`);
                console.log(`  Eccentricity: ${e1.toFixed(6)}`);
                console.log(`  Semi-major axis: ${elements1.semiMajorAxis.toFixed(3)} km`);
                console.log(`  Period: ${elements1.period.toFixed(3)} s`);
                console.log(`  Initial position: (${orbit1State.position.x.toFixed(3)}, ${orbit1State.position.y.toFixed(3)}, ${orbit1State.position.z.toFixed(3)}) km`);
                console.log(`  Initial velocity: (${orbit1State.velocity.x.toFixed(6)}, ${orbit1State.velocity.y.toFixed(6)}, ${orbit1State.velocity.z.toFixed(6)}) km/s`);
                
                console.log(`\nOriginal Orbit 2 (Arrival):`);
                console.log(`  Periapsis: ${rp2.toFixed(3)} km`);
                console.log(`  Apoapsis: ${ra2.toFixed(3)} km`);
                console.log(`  Eccentricity: ${e2.toFixed(6)}`);
                console.log(`  Semi-major axis: ${elements2.semiMajorAxis.toFixed(3)} km`);
                console.log(`  Period: ${elements2.period.toFixed(3)} s`);
                console.log(`  Initial position: (${orbit2State.position.x.toFixed(3)}, ${orbit2State.position.y.toFixed(3)}, ${orbit2State.position.z.toFixed(3)}) km`);
                console.log(`  Initial velocity: (${orbit2State.velocity.x.toFixed(6)}, ${orbit2State.velocity.y.toFixed(6)}, ${orbit2State.velocity.z.toFixed(6)}) km/s`);
                
                console.log(`\nTransfer Parameters:`);
                console.log(`  Time of flight (dt): ${dt.toFixed(3)} s`);
                console.log(`  r1 (departure): (${r1.x.toFixed(3)}, ${r1.y.toFixed(3)}, ${r1.z.toFixed(3)}) km`);
                console.log(`  r2 (arrival): (${r2.x.toFixed(3)}, ${r2.y.toFixed(3)}, ${r2.z.toFixed(3)}) km`);
                console.log(`  |r1|: ${r1.length().toFixed(3)} km`);
                console.log(`  |r2|: ${r2.length().toFixed(3)} km`);
                
                console.log(`\nLambert Solution:`);
                console.log(`  Type: ${lambert.type}`);
                console.log(`  v1 (departure): (${lambert.v1.x.toFixed(6)}, ${lambert.v1.y.toFixed(6)}, ${lambert.v1.z.toFixed(6)}) km/s`);
                console.log(`  v2 (arrival): (${lambert.v2.x.toFixed(6)}, ${lambert.v2.y.toFixed(6)}, ${lambert.v2.z.toFixed(6)}) km/s`);
                console.log(`  |v1|: ${lambert.v1.length().toFixed(6)} km/s`);
                console.log(`  |v2|: ${lambert.v2.length().toFixed(6)} km/s`);
                
                console.log(`\nLambert Transfer Orbit (from r1, v1):`);
                console.log(`  Semi-major axis: ${lambertElements1.semiMajorAxis.toFixed(3)} km`);
                console.log(`  Eccentricity: ${lambertElements1.eccentricity.toFixed(6)}`);
                console.log(`  Period: ${lambertElements1.period.toFixed(3)} s`);
                
                console.log(`\nLambert Transfer Orbit (from r2, v2):`);
                console.log(`  Semi-major axis: ${lambertElements2.semiMajorAxis.toFixed(3)} km`);
                console.log(`  Eccentricity: ${lambertElements2.eccentricity.toFixed(6)}`);
                console.log(`  Period: ${lambertElements2.period.toFixed(3)} s`);
                
                console.log(`\nPropagation Results:`);
                console.log(`  Propagated r2 (from r1+v1+dt): (${propagatedR2FromLambert.x.toFixed(3)}, ${propagatedR2FromLambert.y.toFixed(3)}, ${propagatedR2FromLambert.z.toFixed(3)}) km`);
                console.log(`  Expected r2: (${r2.x.toFixed(3)}, ${r2.y.toFixed(3)}, ${r2.z.toFixed(3)}) km`);
                console.log(`  r2 Error: ${r2Error.toFixed(8)} km`);
                console.log(`  Propagated r1 (from r2+v2-dt): (${propagatedR1FromLambert.x.toFixed(3)}, ${propagatedR1FromLambert.y.toFixed(3)}, ${propagatedR1FromLambert.z.toFixed(3)}) km`);
                console.log(`  Expected r1: (${r1.x.toFixed(3)}, ${r1.y.toFixed(3)}, ${r1.z.toFixed(3)}) km`);
                console.log(`  r1 Error: ${r1Error.toFixed(8)} km`);
                console.log(`========================================\n`);
            }
        } catch (error) {
            console.error(`Test ${testNum + 1}: Exception occurred:`, error);
            failedTests++;
        }
    }

    if (r1Errors.length > 0) {
        const meanR1 = r1Errors.reduce((a, b) => a + b, 0) / r1Errors.length;
        const meanR2 = r2Errors.reduce((a, b) => a + b, 0) / r2Errors.length;
        console.log(`\nSuccessful tests: ${r1Errors.length}/${numTests}`);
        console.log(`Failed tests: ${failedTests}`);
        console.log(`Average r1 Error: ${meanR1.toFixed(10)} km`);
        console.log(`Average r2 Error: ${meanR2.toFixed(10)} km`);
    } else {
        console.log(`\nAll ${numTests} tests failed!`);
    }
}



}
