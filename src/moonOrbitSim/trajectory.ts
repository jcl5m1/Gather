import * as THREE from 'three';
import { OrbitGeometry, OrbitGeometryRenderer } from './types';
import { G, generateEllipsePoints, generateBezierOrbitPoints, generateHyperbolicPoints, generateHyperbolicBezierPoints } from './orbitUtils';

export interface TrajectoryParameters {
    _a: number;        // semi-major axis
    e: number;        // eccentricity
    period: number;   // orbital period
    _h: THREE.Vector3; // angular momentum vector
    _eVec: THREE.Vector3; // eccentricity vector
}

export type TrajectoryType = 'elliptical' | 'hyperbolic' | 'parabolic';

/**
 * Trajectory class that consolidates all data required to represent and render an orbital trajectory
 */
export class Trajectory {
    private _scene: THREE.Scene;              // Private - use underscore prefix
    private _renderer: OrbitGeometryRenderer; // Private - use underscore prefix
    public type: TrajectoryType;
    private _analyticalPoints: THREE.Vector3[] = [];  // Private - use underscore prefix
    private _bezierPoints: THREE.Vector3[] = [];      // Private - use underscore prefix
    private _bezierCurves: any[] = [];               // Private - use underscore prefix
    private _periapsisPoint?: THREE.Vector3;         // Private - use underscore prefix
    private _apoapsisPoint?: THREE.Vector3;          // Private - use underscore prefix
    public parameters: TrajectoryParameters;
    private _color: number;                    // Private - use underscore prefix
    public periapsis: number = 0;
    public apoapsis: number = 0;
    public altitude: number = 0;
    public velocity: number = 0;

    constructor(scene: THREE.Scene, color: number = 0xff6666) {
        this._scene = scene;
        this._color = color;
        this._renderer = new OrbitGeometryRenderer(scene, color);
        this.type = 'elliptical';
        this.parameters = {
            _a: 0,
            e: 0,
            period: 0,
            _h: new THREE.Vector3(),
            _eVec: new THREE.Vector3()
        };
    }

    /**
     * Calculate and update trajectory from position and velocity
     */
    calculateFromState(position: THREE.Vector3, velocity: THREE.Vector3, centralBodyMass: number): void {
        // Clean up old renderer before creating new one
        if (this._renderer) {
            this._renderer.cleanup();
        }
        this._renderer = new OrbitGeometryRenderer(this._scene, this._color);
        const mu = G * centralBodyMass;
        const r = position.length();
        const v = velocity.length();
        
        // Update current altitude and velocity
        this.altitude = r;
        this.velocity = v;

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
            this._analyticalPoints = ellipsePoints;
            this._bezierPoints = bezierResult.points;
            this._bezierCurves = bezierResult.curves;
            this._periapsisPoint = periapsisPoint;
            this._apoapsisPoint = apoapsisPoint;
            this.parameters = {
                _a: a,
                e,
                period,
                _h: hVec,
                _eVec: referenceVec
            };
            
            // Update periapsis and apoapsis for elliptical orbits
            this.periapsis = a * (1 - e);
            this.apoapsis = a * (1 + e);

            // Update visualization
            this._renderer.updateOrbitLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            this._renderer.updateMarkers(periapsisPoint, apoapsisPoint, true, true);
            this._renderer.setVisibility(true);

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
            this._analyticalPoints = hyperbolicPoints;
            this._bezierPoints = bezierResult.points;
            this._bezierCurves = bezierResult.curves;
            this._periapsisPoint = periapsisPoint;
            this._apoapsisPoint = undefined;
            this.parameters = {
                _a: a,
                e,
                period: Infinity,
                _h: hVec,
                _eVec: eVec
            };
            
            // Update periapsis for hyperbolic orbits (apoapsis is undefined)
            // For hyperbolic orbits, a is negative, so periapsis = |a| * (e - 1)
            this.periapsis = Math.abs(a) * (e - 1);
            this.apoapsis = Infinity;

            // Update visualization
            this._renderer.updateOrbitLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            this._renderer.updateMarkers(periapsisPoint, periapsisPoint, true, false);
            this._renderer.setVisibility(true);

        } else {
            // Parabolic orbit
            this.type = 'parabolic';
            this._analyticalPoints = [];
            this._bezierPoints = [];
            this._bezierCurves = [];
            this._periapsisPoint = undefined;
            this._apoapsisPoint = undefined;
            this.parameters = {
                _a: 0,
                e: 1,
                period: Infinity,
                _h: hVec,
                _eVec: eVec
            };
            
            // For parabolic orbits, periapsis is the distance at closest approach
            this.periapsis = hVec.length() * hVec.length() / (mu * (1 + e));
            this.apoapsis = Infinity;

            // Hide visualization for parabolic orbit
            this._renderer.setVisibility(false);
        }
    }

    /**
     * Clear the trajectory (remove from scene and reset)
     */
    clear(): void {
        if (this._renderer) {
            this._renderer.cleanup();
        }
        this._analyticalPoints = [];
        this._bezierPoints = [];
        this._bezierCurves = [];
        this._periapsisPoint = undefined;
        this._apoapsisPoint = undefined;
        this.periapsis = 0;
        this.apoapsis = 0;
        this.altitude = 0;
        this.velocity = 0;
    }
    
    /**
     * Update current altitude and velocity (called during simulation updates)
     */
    updateCurrentState(position: THREE.Vector3, velocity: THREE.Vector3): void {
        this.altitude = position.length();
        this.velocity = velocity.length();
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
        return this._periapsisPoint;
    }

    /**
     * Get apoapsis point
     */
    getApoapsisPoint(): THREE.Vector3 | undefined {
        return this._apoapsisPoint;
    }

    /**
     * Get analytical points
     */
    getAnalyticalPoints(): THREE.Vector3[] {
        return this._analyticalPoints;
    }

    /**
     * Get bezier points
     */
    getBezierPoints(): THREE.Vector3[] {
        return this._bezierPoints;
    }

    /**
     * Set visibility
     */
    setVisibility(visible: boolean): void {
        this._renderer.setVisibility(visible);
    }
}

