import * as THREE from 'three';
import { BezierCurvePoints, BezierCurve } from './types';
import { G } from './config';

// Re-export G for backward compatibility
export { G };

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
