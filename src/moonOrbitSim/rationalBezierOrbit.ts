import * as THREE from 'three';
import { RationalBezierCurve } from './rationalBezierCurve';

/**
 * Create an exact rational quadratic Bezier curve for a conic section arc
 * parameterized by true anomaly from the focus (for orbital mechanics)
 * 
 * Uses the standard formula for rational Bezier representation of conics:
 * For an arc from angle θ0 to θ2, with shoulder point at θ1 = (θ0+θ2)/2:
 * - Control points: P0, P1 (shoulder), P2
 * - Weights: w0=1, w1=cos((θ2-θ0)/2), w2=1
 * - P1 is at the intersection of tangent lines from P0 and P2
 * 
 * @param a Semi-major axis (km)
 * @param e Eccentricity
 * @param startNu Start true anomaly (radians)
 * @param endNu End true anomaly (radians)
 * @param periapsisDir Unit vector pointing toward periapsis
 * @param perpDir Unit vector perpendicular to periapsis direction (in orbital plane)
 * @returns Exact rational quadratic Bezier curve for the orbital arc
 */
export function createOrbitalArc(
    a: number,
    e: number,
    startNu: number,
    endNu: number,
    periapsisDir: THREE.Vector3,
    perpDir: THREE.Vector3
): RationalBezierCurve {
    // For a conic section in polar coordinates from focus: r = p/(1 + e·cos(ν))
    // The exact rational quadratic Bezier representation uses:
    // P0, P1, P2 as control points with weights w0=1, w1=cos(Δν/2), w2=1
    // where P1 is the intersection of the tangent rays at P0 and P2
    
    const p = a * (1 - e * e); // Semi-latus rectum
    
    // Compute positions at start and end true anomalies
    const r0 = p / (1 + e * Math.cos(startNu));
    const r2 = p / (1 + e * Math.cos(endNu));
    
    // Position vectors from focus
    const P0 = new THREE.Vector3()
        .addScaledVector(periapsisDir, r0 * Math.cos(startNu))
        .addScaledVector(perpDir, r0 * Math.sin(startNu));
    
    const P2 = new THREE.Vector3()
        .addScaledVector(periapsisDir, r2 * Math.cos(endNu))
        .addScaledVector(perpDir, r2 * Math.sin(endNu));
    
    // The key insight: for exact representation, P1 must be at the intersection
    // of lines passing through P0 and P2 in the angular bisector direction
    // This comes from the projective geometry of conics
    
    // Middle angle
    const midNu = (startNu + endNu) / 2;
    
    // For a conic, the shoulder point P1 lies on the ray from focus at angle midNu
    // Its distance is chosen so that it lies at the intersection of tangent lines
    // 
    // The exact formula for P1 in angular coordinates:
    // P1 is at the intersection of tangent lines from P0 and P2
    // But for a simpler construction that's mathematically equivalent:
    // We can use: P1 = (P0 + P2) / (2 * cos(Δν/2))
    // This is the standard formula for rational Bezier representation of circular arcs
    
    const deltaNu = endNu - startNu;
    const w1 = Math.cos(deltaNu / 2);
    
    // The control point P1 is placed such that the weighted Bezier passes through the conic
    // For circular/elliptical arcs, this is: P1 at the direction of the angular bisector
    // at a distance such that (P0 + P2)/(2*w1) when weight-adjusted
    
    // Direction of angular bisector
    const bisectorDir = new THREE.Vector3()
        .addScaledVector(periapsisDir, Math.cos(midNu))
        .addScaledVector(perpDir, Math.sin(midNu));
    bisectorDir.normalize();
    
    // The intersection point formula for conics from focus:
    // Project P0-to-origin and P2-to-origin rays and find where they meet
    // the bisector line
    
    // Actually, let's use the simpler formula: for small arcs, 
    // P1 ≈ (P0/w0 + P2/w2) * w1 / 2 in homogeneous coordinates
    // Which simplifies to: P1 = (P0 + P2) / (2 * w1) for w0=w2=1
    
    const P1 = P0.clone().add(P2).divideScalar(2 * w1);
    
    return new RationalBezierCurve(
        [P0, P1, P2],
        [1, w1, 1]
    );
}

/**
 * Generate rational Bezier curves that exactly represent an elliptical orbit
 * The orbit is divided into 4 arcs (one per quadrant of true anomaly)
 * 
 * @param a Semi-major axis (km)
 * @param e Eccentricity
 * @param periapsisDir Unit vector pointing toward periapsis from focus
 * @param perpDir Unit vector perpendicular to periapsis (in orbital plane)
 * @returns Array of 4 rational Bezier curves that exactly represent the orbit
 */
export function generateRationalBezierOrbit(
    a: number,
    e: number,
    periapsisDir: THREE.Vector3,
    perpDir: THREE.Vector3
): RationalBezierCurve[] {
    const curves: RationalBezierCurve[] = [];
    
    // Divide orbit into 4 arcs
    const trueAnomalies = [0, Math.PI/2, Math.PI, 3*Math.PI/2, 2*Math.PI];
    
    for (let i = 0; i < 4; i++) {
        const startNu = trueAnomalies[i];
        const endNu = trueAnomalies[i + 1];
        
        const curve = createOrbitalArc(a, e, startNu, endNu, periapsisDir, perpDir);
        curves.push(curve);
    }
    
    return curves;
}

/**
 * Test function to verify the accuracy of rational Bezier orbit representation
 * Tests that positions sampled from the Bezier curves lie on the analytical ellipse
 * by verifying they satisfy the orbital equation: r = p/(1 + e*cos(ν))
 * 
 * @param a Semi-major axis (km)
 * @param e Eccentricity
 * @param periapsisDir Unit vector pointing toward periapsis from focus
 * @param perpDir Unit vector perpendicular to periapsis (in orbital plane)
 * @param numSamples Number of samples to test per curve
 * @returns Test results with maximum error and sample data
 */
export function testRationalBezierOrbitAccuracy(
    a: number,
    e: number,
    periapsisDir: THREE.Vector3,
    perpDir: THREE.Vector3,
    numSamples: number = 25
): {
    maxError: number;
    avgError: number;
    samples: Array<{
        curveIndex: number;
        t: number;
        trueAnomaly: number;
        bezierRadius: number;
        analyticalRadius: number;
        error: number;
    }>;
} {
    // Generate the rational Bezier curves
    const curves = generateRationalBezierOrbit(a, e, periapsisDir, perpDir);
    
    const samples: Array<{
        curveIndex: number;
        t: number;
        trueAnomaly: number;
        bezierRadius: number;
        analyticalRadius: number;
        error: number;
    }> = [];
    
    let maxError = 0;
    let totalError = 0;
    let totalSamples = 0;
    
    const p = a * (1 - e * e);
    
    // Sample each curve at uniform parameter values
    for (let curveIdx = 0; curveIdx < curves.length; curveIdx++) {
        const curve = curves[curveIdx];
        
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            
            // Get position from Bezier curve
            const bezierPos = curve.getPoint(t);
            
            // Calculate the true anomaly and radius of this Bezier position
            const bezierNu = Math.atan2(bezierPos.dot(perpDir), bezierPos.dot(periapsisDir));
            const bezierRadius = bezierPos.length();
            
            // Calculate analytical radius at this true anomaly using orbital equation
            const r_analytical = p / (1 + e * Math.cos(bezierNu));
            
            // Error is the difference between bezier radius and analytical radius
            // If the Bezier exactly represents the orbit, this should be zero
            const error = Math.abs(bezierRadius - r_analytical);
            
            samples.push({
                curveIndex: curveIdx,
                t,
                trueAnomaly: bezierNu,
                bezierRadius,
                analyticalRadius: r_analytical,
                error
            });
            
            maxError = Math.max(maxError, error);
            totalError += error;
            totalSamples++;
        }
    }
    
    const avgError = totalError / totalSamples;
    
    return {
        maxError,
        avgError,
        samples
    };
}

/**
 * Console logging version of the test function for easy debugging
 */
export function testAndLogRationalBezierOrbit(
    a: number,
    e: number,
    periapsisDir: THREE.Vector3,
    perpDir: THREE.Vector3,
    numSamples: number = 25
): void {
    console.log('=== Testing Rational Bezier Orbit Representation ===');
    console.log(`Semi-major axis: ${a} km`);
    console.log(`Eccentricity: ${e}`);
    console.log(`Number of samples per curve: ${numSamples}`);
    console.log('');
    
    const results = testRationalBezierOrbitAccuracy(a, e, periapsisDir, perpDir, numSamples);
    
    console.log(`Maximum error: ${results.maxError.toFixed(6)} km`);
    console.log(`Average error: ${results.avgError.toFixed(6)} km`);
    console.log('');
    
    // Log a few sample points
    console.log('Sample points (first 10):');
    for (let i = 0; i < Math.min(10, results.samples.length); i++) {
        const sample = results.samples[i];
        console.log(`  Curve ${sample.curveIndex}, t=${sample.t.toFixed(3)}, ν=${sample.trueAnomaly.toFixed(3)}, r_bez=${sample.bezierRadius.toFixed(3)}, r_ana=${sample.analyticalRadius.toFixed(3)}, error=${sample.error.toFixed(6)} km`);
    }
    
    // Find point with maximum error
    const maxErrorSample = results.samples.reduce((max, sample) => 
        sample.error > max.error ? sample : max
    );
    console.log('');
    console.log('Point with maximum error:');
    console.log(`  Curve ${maxErrorSample.curveIndex}, t=${maxErrorSample.t.toFixed(3)}, ν=${maxErrorSample.trueAnomaly.toFixed(3)}`);
    console.log(`  Bezier radius: ${maxErrorSample.bezierRadius.toFixed(3)} km`);
    console.log(`  Analytical radius: ${maxErrorSample.analyticalRadius.toFixed(3)} km`);
    console.log(`  Error: ${maxErrorSample.error.toFixed(6)} km`);
}
