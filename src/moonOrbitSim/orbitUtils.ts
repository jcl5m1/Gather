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
 * Iteratively solves for E given M and e.
 */
export function solveEccentricAnomaly(M: number, e: number): number {
    let E = M; // Initial guess
    for (let i = 0; i < 10; i++) {
        E = M + e * Math.sin(E);
    }
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
export function calculateTimeWarp(
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
    const warpedTime = calculateTimeWarp(M_wrapped_apo, lut, interpMode);

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
        const trajectory = body.getTrajectory();
        
        // STRICT BEZIER ONLY POLICY
        // We assume all trajectories are initialized with Bezier curves and TimeWarpLUTs
        // including Hyperbolic and Elliptical.
        
        const state = trajectory.getBezierState(futureTime, { calcVelocity: true });
        
        if (state.position && state.velocity) {
            return { pos: state.position, vel: state.velocity };
        }

        // If Bezier fails (should not happen if initialized correctly), 
        // we return current state or zeroes to avoid crashes, 
        // but we DO NOT fall back to analytical calculation.
        console.warn(`[TransferCalculator] Bezier prediction failed for ${body.name} at t=${futureTime}`);
        
        return { 
            pos: state.position || body.position.clone(), 
            vel: state.velocity || body.velocity.clone() 
        };
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

        const resX = 32;
        const resY = 32;
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
