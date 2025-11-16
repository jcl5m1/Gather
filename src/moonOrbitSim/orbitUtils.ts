import * as THREE from 'three';
import { BezierCurvePoints, BezierCurve } from './types';
import { G } from './config';

// Re-export G for backward compatibility
export { G };

/**
 * Generate position and velocity vectors from orbital parameters
 * @param rp Periapsis distance in km
 * @param ra Apapsis distance in km
 * @param e Eccentricity (0-1 for elliptical)
 * @param centralBodyMass Mass of central body in kg
 * @param trueAnomaly True anomaly at initial position (0 = periapsis, π = apapsis) in radians
 * @param inclination Orbital inclination in radians (default: 0 = equatorial)
 * @param longitudeOfAscendingNode Longitude of ascending node in radians (default: 0)
 * @param argumentOfPeriapsis Argument of periapsis in radians (default: 0)
 * @returns Object with position and velocity vectors
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
): { position: THREE.Vector3; velocity: THREE.Vector3 } {
    const mu = G * centralBodyMass;
    
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
    const mu = G * planetMass;
    const F0 = calculateInitialE(initialPos, initialVel, a, e, mu); // Using same function but result is hyperbolic anomaly
    
    // Mean anomaly at t=0 for hyperbolic orbit
    const M0 = e * Math.sinh(F0) - F0;
    
    // Current mean anomaly
    const n = Math.sqrt(mu / (-a * a * a)); // Mean motion for hyperbolic orbit
    const M = M0 + n * (time - startTime);
    
    // Solve Kepler's equation iteratively for hyperbolic case (M = e*sinh(F) - F)
    let F = M; // Initial guess
    for(let i = 0; i < 10; i++) {
        const dF = (M - e * Math.sinh(F) + F) / (e * Math.cosh(F) - 1);
        F += dF;
        if (Math.abs(dF) < 1e-6) break;
    }
    
    // Calculate position in orbital plane coordinates
    const x = a * (e - Math.cosh(F));
    const y = a * Math.sqrt(e*e - 1) * Math.sinh(F);
    
    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();
    
    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1/mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();
    
    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();
    
    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, x)
        .addScaledVector(perpDir, y);
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
    const mu = G * planetMass;
    const E0 = calculateInitialE(initialPos, initialVel, a, e, mu);
    
    // Mean anomaly at t=0
    const M0 = E0 - e * Math.sin(E0);
    
    // Current mean anomaly
    const M = M0 + 2 * Math.PI * ((time - startTime) / period);
    
    // Solve Kepler's equation iteratively (M = E - e*sin(E))
    let E = M; // Initial guess
    for(let i = 0; i < 10; i++) {
        E = M + e * Math.sin(E);
    }
    
    // Calculate position in orbital plane coordinates
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e*e) * Math.sin(E);
    
    // Calculate orbit orientation vectors
    const h = new THREE.Vector3().crossVectors(initialPos, initialVel);
    const hNorm = h.clone().normalize();
    
    // Calculate eccentricity vector
    const vCrossH = new THREE.Vector3().crossVectors(initialVel, h);
    const eVec = vCrossH.multiplyScalar(1/mu).sub(initialPos.clone().normalize());
    const eNorm = eVec.clone().normalize();
    
    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();
    
    // Transform from orbital plane to 3D space
    return new THREE.Vector3()
        .addScaledVector(periapsisDir, x)
        .addScaledVector(perpDir, y);
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
    const maxTheta = Math.acos(-1/e); // Angle between asymptote and periapsis direction
    
    // Generate hyperbola points in the orbit plane
    for (let i = 0; i <= numPoints; i++) {
        // Map i to range [-maxTheta, maxTheta]
        const theta = -maxTheta + (2 * maxTheta * i / numPoints);
        
        // Parametric equations for hyperbola
        const r = a * (e*e - 1) / (1 + e * Math.cos(theta));
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
    const alpha = Math.acos(-1/e);
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
): { points: THREE.Vector3[], curves: BezierCurve[] } {
    const points: THREE.Vector3[] = [];
    const numPointsPerCurve = 25;
    const b = a * Math.sqrt(1 - e * e);
    const c = a * e;

    // Normalize vectors
    const hNorm = h.clone().normalize();
    const eNorm = eVec.clone().normalize();
    
    // Calculate orbit plane basis vectors
    const periapsisDir = eNorm;
    const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();
    
    // Calculate center of ellipse
    const center = periapsisDir.clone().multiplyScalar(-c);

    // Magic number to approximate circle with Bezier curves
    const k = 0.551915024494;
    
    // Control points
    const controlPoints = [
        new THREE.Vector3(a, 0, 0),
        new THREE.Vector3(a, b * k, 0),
        new THREE.Vector3(a * k, b, 0),
        new THREE.Vector3(0, b, 0),
        new THREE.Vector3(-a * k, b, 0),
        new THREE.Vector3(-a, b * k, 0),
        new THREE.Vector3(-a, 0, 0),
        new THREE.Vector3(-a, -b * k, 0),
        new THREE.Vector3(-a * k, -b, 0),
        new THREE.Vector3(0, -b, 0),
        new THREE.Vector3(a * k, -b, 0),
        new THREE.Vector3(a, -b * k, 0)
    ];

    // Transform control points to orbit plane
    const transformedPoints = controlPoints.map(p => {
        const transformed = new THREE.Vector3();
        transformed.addScaledVector(periapsisDir, p.x);
        transformed.addScaledVector(perpDir, p.y);
        return transformed.add(center);
    });

    // Create Bezier curves
    const curves = [
        new BezierCurve(transformedPoints[0], transformedPoints[1], transformedPoints[2], transformedPoints[3]),
        new BezierCurve(transformedPoints[3], transformedPoints[4], transformedPoints[5], transformedPoints[6]),
        new BezierCurve(transformedPoints[6], transformedPoints[7], transformedPoints[8], transformedPoints[9]),
        new BezierCurve(transformedPoints[9], transformedPoints[10], transformedPoints[11], transformedPoints[0])
    ];

    // Generate points for each curve
    curves.forEach(curve => {
        for (let i = 0; i <= numPointsPerCurve; i++) {
            const t = i / numPointsPerCurve;
            points.push(curve.getPoint(t));
        }
    });

    return { points, curves };
}
