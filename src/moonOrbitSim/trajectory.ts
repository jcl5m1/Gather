import * as THREE from 'three';
import { OrbitGeometry, OrbitGeometryRenderer } from './types';
import { G, generateEllipsePoints, generateBezierOrbitPoints, generateHyperbolicPoints, generateHyperbolicBezierPoints } from './orbitUtils';

export interface TrajectoryParameters {
    a: number;        // semi-major axis
    e: number;        // eccentricity
    period: number;   // orbital period
    h: THREE.Vector3; // angular momentum vector
    eVec: THREE.Vector3; // eccentricity vector
}

export type TrajectoryType = 'elliptical' | 'hyperbolic' | 'parabolic';

/**
 * Trajectory class that consolidates all data required to represent and render an orbital trajectory
 */
export class Trajectory {
    private scene: THREE.Scene;
    private renderer: OrbitGeometryRenderer;
    private type: TrajectoryType;
    private analyticalPoints: THREE.Vector3[] = [];
    private bezierPoints: THREE.Vector3[] = [];
    private bezierCurves: any[] = [];
    private periapsisPoint?: THREE.Vector3;
    private apoapsisPoint?: THREE.Vector3;
    private parameters: TrajectoryParameters;
    private color: number;

    constructor(scene: THREE.Scene, color: number = 0xff6666) {
        this.scene = scene;
        this.color = color;
        this.renderer = new OrbitGeometryRenderer(scene, color);
        this.type = 'elliptical';
        this.parameters = {
            a: 0,
            e: 0,
            period: 0,
            h: new THREE.Vector3(),
            eVec: new THREE.Vector3()
        };
    }

    /**
     * Calculate and update trajectory from position and velocity
     */
    calculateFromState(position: THREE.Vector3, velocity: THREE.Vector3, centralBodyMass: number): void {
        // Clean up old renderer before creating new one
        if (this.renderer) {
            this.renderer.cleanup();
        }
        this.renderer = new OrbitGeometryRenderer(this.scene, this.color);
        const mu = G * centralBodyMass;
        const r = position.length();
        const v = velocity.length();

        // Calculate orbit geometry vectors
        const hVec = new THREE.Vector3().crossVectors(position, velocity);
        const vCrossH = new THREE.Vector3().crossVectors(velocity, hVec);
        const eVec = vCrossH.multiplyScalar(1 / mu).sub(position.clone().normalize());
        const e = eVec.length();

        // Calculate orbital elements
        const specificEnergy = (v * v / 2) - (mu / r);
        const a = -mu / (2 * specificEnergy);

        // For circular/elliptical orbits (e ≈ 0), use position vector as reference direction
        const referenceVec = e < 1e-6 ? position.clone() : eVec;

        if (specificEnergy < 0) {
            // Elliptical orbit
            const period = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / mu);
            
            // Generate ellipse points
            const ellipsePoints = generateEllipsePoints(a, e, hVec, referenceVec, 100);
            
            // Find periapsis and apoapsis points
            let periapsisPoint = new THREE.Vector3();
            let apoapsisPoint = new THREE.Vector3();
            let minDist = Infinity;
            let maxDist = -Infinity;
            
            ellipsePoints.forEach(point => {
                const dist = point.length();
                if (dist < minDist) {
                    minDist = dist;
                    periapsisPoint.copy(point);
                }
                if (dist > maxDist) {
                    maxDist = dist;
                    apoapsisPoint.copy(point);
                }
            });
            
            // For circular orbits, use initial position as periapsis and opposite point as apoapsis
            if (e < 1e-6) {
                periapsisPoint.copy(position);
                apoapsisPoint.copy(position).multiplyScalar(-1);
            }

            // Generate bezier curves and points
            const bezierResult = generateBezierOrbitPoints(a, e, hVec, referenceVec);

            this.type = 'elliptical';
            this.analyticalPoints = ellipsePoints;
            this.bezierPoints = bezierResult.points;
            this.bezierCurves = bezierResult.curves;
            this.periapsisPoint = periapsisPoint;
            this.apoapsisPoint = apoapsisPoint;
            this.parameters = {
                a,
                e,
                period,
                h: hVec,
                eVec: referenceVec
            };

            // Update visualization
            this.renderer.updateOrbitLine(bezierResult.points);
            this.renderer.updateBezierCurves(bezierResult.curves);
            this.renderer.updateMarkers(periapsisPoint, apoapsisPoint, true, true);
            this.renderer.setVisibility(true);

        } else if (specificEnergy > 0) {
            // Hyperbolic orbit
            const hyperbolicPoints = generateHyperbolicPoints(a, e, hVec, eVec, 100);
            
            // Find periapsis point
            let periapsisPoint = new THREE.Vector3();
            let minDist = Infinity;
            
            hyperbolicPoints.forEach(point => {
                const dist = point.length();
                if (dist < minDist) {
                    minDist = dist;
                    periapsisPoint.copy(point);
                }
            });

            // Generate bezier curves and points for hyperbolic orbit
            const bezierResult = generateHyperbolicBezierPoints(a, e, hVec, eVec);

            this.type = 'hyperbolic';
            this.analyticalPoints = hyperbolicPoints;
            this.bezierPoints = bezierResult.points;
            this.bezierCurves = bezierResult.curves;
            this.periapsisPoint = periapsisPoint;
            this.apoapsisPoint = undefined;
            this.parameters = {
                a,
                e,
                period: Infinity,
                h: hVec,
                eVec
            };

            // Update visualization
            this.renderer.updateOrbitLine(bezierResult.points);
            this.renderer.updateBezierCurves(bezierResult.curves);
            this.renderer.updateMarkers(periapsisPoint, periapsisPoint, true, false);
            this.renderer.setVisibility(true);

        } else {
            // Parabolic orbit
            this.type = 'parabolic';
            this.analyticalPoints = [];
            this.bezierPoints = [];
            this.bezierCurves = [];
            this.periapsisPoint = undefined;
            this.apoapsisPoint = undefined;
            this.parameters = {
                a: 0,
                e: 1,
                period: Infinity,
                h: hVec,
                eVec
            };

            // Hide visualization for parabolic orbit
            this.renderer.setVisibility(false);
        }
    }

    /**
     * Clear the trajectory (remove from scene and reset)
     */
    clear(): void {
        if (this.renderer) {
            this.renderer.cleanup();
        }
        this.analyticalPoints = [];
        this.bezierPoints = [];
        this.bezierCurves = [];
        this.periapsisPoint = undefined;
        this.apoapsisPoint = undefined;
    }

    /**
     * Get trajectory type
     */
    getType(): TrajectoryType {
        return this.type;
    }

    /**
     * Get trajectory parameters
     */
    getParameters(): TrajectoryParameters {
        return this.parameters;
    }

    /**
     * Get periapsis point
     */
    getPeriapsisPoint(): THREE.Vector3 | undefined {
        return this.periapsisPoint;
    }

    /**
     * Get apoapsis point
     */
    getApoapsisPoint(): THREE.Vector3 | undefined {
        return this.apoapsisPoint;
    }

    /**
     * Get analytical points
     */
    getAnalyticalPoints(): THREE.Vector3[] {
        return this.analyticalPoints;
    }

    /**
     * Get bezier points
     */
    getBezierPoints(): THREE.Vector3[] {
        return this.bezierPoints;
    }

    /**
     * Set visibility
     */
    setVisibility(visible: boolean): void {
        this.renderer.setVisibility(visible);
    }
}

