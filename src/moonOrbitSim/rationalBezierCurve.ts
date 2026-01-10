import * as THREE from 'three';

/**
 * Rational Bezier Curve class supporting quadratic and cubic curves with weights
 * This allows exact representation of conic sections (circles, ellipses) using rational quadratics
 */
export class RationalBezierCurve {
    private points: THREE.Vector3[];
    private weights: number[];
    private degree: number;

    /**
     * Create a rational Bezier curve
     * @param points Control points (3 for quadratic, 4 for cubic)
     * @param weights Weights for each control point (same length as points)
     */
    constructor(points: THREE.Vector3[], weights: number[]) {
        if (points.length !== weights.length) {
            throw new Error('Number of points must match number of weights');
        }
        if (points.length < 3 || points.length > 4) {
            throw new Error('Only quadratic (3 points) and cubic (4 points) curves are supported');
        }
        
        this.points = points.map(p => p.clone());
        this.weights = [...weights];
        this.degree = points.length - 1;
    }

    /**
     * Evaluate the curve at parameter t ∈ [0, 1]
     * Uses the rational Bezier formula: B(t) = Σ(wi * Bi,n(t) * Pi) / Σ(wi * Bi,n(t))
     */
    getPoint(t: number): THREE.Vector3 {
        t = Math.max(0, Math.min(1, t)); // Clamp to [0, 1]
        
        const point = new THREE.Vector3();
        let weightSum = 0;
        
        if (this.degree === 2) {
            // Quadratic: B(t) = w0(1-t)²P0 + w1*2t(1-t)P1 + w2*t²P2
            const mt = 1 - t;
            const mt2 = mt * mt;
            const t2 = t * t;
            const tmt = 2 * t * mt;
            
            const b0 = this.weights[0] * mt2;
            const b1 = this.weights[1] * tmt;
            const b2 = this.weights[2] * t2;
            
            weightSum = b0 + b1 + b2;
            
            point.addScaledVector(this.points[0], b0);
            point.addScaledVector(this.points[1], b1);
            point.addScaledVector(this.points[2], b2);
            
        } else if (this.degree === 3) {
            // Cubic: B(t) = w0(1-t)³P0 + w1*3t(1-t)²P1 + w2*3t²(1-t)P2 + w3*t³P3
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            const t2 = t * t;
            const t3 = t2 * t;
            
            const b0 = this.weights[0] * mt3;
            const b1 = this.weights[1] * 3 * mt2 * t;
            const b2 = this.weights[2] * 3 * mt * t2;
            const b3 = this.weights[3] * t3;
            
            weightSum = b0 + b1 + b2 + b3;
            
            point.addScaledVector(this.points[0], b0);
            point.addScaledVector(this.points[1], b1);
            point.addScaledVector(this.points[2], b2);
            point.addScaledVector(this.points[3], b3);
        }
        
        // Divide by weight sum to get rational Bezier point
        if (weightSum > 0) {
            point.divideScalar(weightSum);
        }
        
        return point;
    }

    /**
     * Get control points
     */
    getControlPoints(): THREE.Vector3[] {
        return this.points.map(p => p.clone());
    }

    /**
     * Get weights
     */
    getWeights(): number[] {
        return [...this.weights];
    }

    /**
     * Get degree (2 for quadratic, 3 for cubic)
     */
    getDegree(): number {
        return this.degree;
    }

    /**
     * Generate points along the curve for visualization
     */
    getPoints(numPoints: number = 25): THREE.Vector3[] {
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            points.push(this.getPoint(t));
        }
        return points;
    }

    /**
     * Create an exact rational quadratic Bezier curve for a circular arc
     * @param center Center of the circle
     * @param radius Radius of the circle
     * @param startAngle Start angle in radians
     * @param endAngle End angle in radians
     * @param xAxis X-axis direction (unit vector)
     * @param yAxis Y-axis direction (unit vector)
     * @returns Exact rational quadratic Bezier curve for the arc
     */
    static createCircularArc(
        center: THREE.Vector3,
        radius: number,
        startAngle: number,
        endAngle: number,
        xAxis: THREE.Vector3,
        yAxis: THREE.Vector3
    ): RationalBezierCurve {
        // Calculate control points
        const P0 = new THREE.Vector3()
            .addScaledVector(xAxis, radius * Math.cos(startAngle))
            .addScaledVector(yAxis, radius * Math.sin(startAngle))
            .add(center);
        
        const P2 = new THREE.Vector3()
            .addScaledVector(xAxis, radius * Math.cos(endAngle))
            .addScaledVector(yAxis, radius * Math.sin(endAngle))
            .add(center);
        
        // Middle control point is at the intersection of tangents
        // Tangent at P0: perpendicular to radius at P0
        // Tangent at P2: perpendicular to radius at P2
        const tangent0 = new THREE.Vector3()
            .addScaledVector(xAxis, -Math.sin(startAngle))
            .addScaledVector(yAxis, Math.cos(startAngle));
        
        const tangent2 = new THREE.Vector3()
            .addScaledVector(xAxis, -Math.sin(endAngle))
            .addScaledVector(yAxis, Math.cos(endAngle));
        
        // Find intersection of the two tangent lines
        // Line 1: P0 + s * tangent0
        // Line 2: P2 + t * tangent2
        // Solve: P0 + s * tangent0 = P2 + t * tangent2
        
        const P0minusP2 = P0.clone().sub(P2);
        const denom = tangent0.x * tangent2.y - tangent0.y * tangent2.x;
        const s = (P0minusP2.y * tangent2.x - P0minusP2.x * tangent2.y) / denom;
        
        const P1 = P0.clone().addScaledVector(tangent0, s);
        
        // Calculate weight for middle control point
        const halfAngle = (endAngle - startAngle) / 2;
        const w1 = Math.cos(halfAngle);
        
        return new RationalBezierCurve(
            [P0, P1, P2],
            [1, w1, 1]
        );
    }

    /**
     * Create an exact rational quadratic Bezier curve for an elliptical arc
     * @param center Center of the ellipse
     * @param a Semi-major axis
     * @param b Semi-minor axis
     * @param startAngle Start angle in radians
     * @param endAngle End angle in radians
     * @param xAxis X-axis direction (unit vector, along semi-major axis)
     * @param yAxis Y-axis direction (unit vector, along semi-minor axis)
     * @returns Exact rational quadratic Bezier curve for the arc
     */
    static createEllipticalArc(
        center: THREE.Vector3,
        a: number,
        b: number,
        startAngle: number,
        endAngle: number,
        xAxis: THREE.Vector3,
        yAxis: THREE.Vector3
    ): RationalBezierCurve {
        // Calculate control points on the ellipse
        const P0 = new THREE.Vector3()
            .addScaledVector(xAxis, a * Math.cos(startAngle))
            .addScaledVector(yAxis, b * Math.sin(startAngle))
            .add(center);
        
        const P2 = new THREE.Vector3()
            .addScaledVector(xAxis, a * Math.cos(endAngle))
            .addScaledVector(yAxis, b * Math.sin(endAngle))
            .add(center);
        
        // Tangent vectors at P0 and P2
        // For ellipse: dx/dθ = -a*sin(θ), dy/dθ = b*cos(θ)
        const tangent0 = new THREE.Vector3()
            .addScaledVector(xAxis, -a * Math.sin(startAngle))
            .addScaledVector(yAxis, b * Math.cos(startAngle));
        
        const tangent2 = new THREE.Vector3()
            .addScaledVector(xAxis, -a * Math.sin(endAngle))
            .addScaledVector(yAxis, b * Math.cos(endAngle));
        
        // Find intersection of the two tangent lines
        const P0minusP2 = P0.clone().sub(P2);
        
        // Handle 2D intersection in the ellipse plane
        // We need to solve the intersection in the coordinate system defined by xAxis and yAxis
        const P0_x = P0.clone().sub(center).dot(xAxis);
        const P0_y = P0.clone().sub(center).dot(yAxis);
        const P2_x = P2.clone().sub(center).dot(xAxis);
        const P2_y = P2.clone().sub(center).dot(yAxis);
        const t0_x = tangent0.dot(xAxis);
        const t0_y = tangent0.dot(yAxis);
        const t2_x = tangent2.dot(xAxis);
        const t2_y = tangent2.dot(yAxis);
        
        const denom = t0_x * t2_y - t0_y * t2_x;
        const s = ((P2_y - P0_y) * t2_x - (P2_x - P0_x) * t2_y) / denom;
        
        const P1 = P0.clone().addScaledVector(tangent0, s);
        
        // Calculate weight for middle control point
        const halfAngle = (endAngle - startAngle) / 2;
        const w1 = Math.cos(halfAngle);
        
        return new RationalBezierCurve(
            [P0, P1, P2],
            [1, w1, 1]
        );
    }
}
