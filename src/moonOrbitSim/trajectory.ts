import * as THREE from 'three';
import { OrbitGeometry, OrbitGeometryRenderer } from './types';
import { G, generateEllipsePoints, generateBezierOrbitPoints, generateHyperbolicPoints, generateHyperbolicBezierPoints } from './orbitUtils';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, kilograms, ZERO_LENGTH, ZERO_TIME, ZERO_VELOCITY, INFINITE_LENGTH, INFINITE_TIME, cubicKilometersPerSecondSquared, squareKilometersPerSecondSquared, kilometersPerSecond, secondsSquared } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3, ZERO_LENGTH_VECTOR3 } from './unitsVector3';

export interface TrajectoryParameters {
    _a: Length;        // semi-major axis
    e: number;        // eccentricity (dimensionless)
    period: Time;   // orbital period
    _h: LengthVector3; // angular momentum vector (length vector3)
    _eVec: LengthVector3; // eccentricity vector (length vector3)
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
    private _periapsisPoint?: LengthVector3;         // Private - use underscore prefix
    private _apoapsisPoint?: LengthVector3;          // Private - use underscore prefix
    public parameters: TrajectoryParameters;
    private _color: number;                    // Private - use underscore prefix
    public periapsis: Length = ZERO_LENGTH;
    public apoapsis: Length = ZERO_LENGTH;
    public altitude: Length = ZERO_LENGTH;
    public velocity: Velocity = ZERO_VELOCITY;

    constructor(scene: THREE.Scene, color: number = 0xff6666) {
        this._scene = scene;
        this._color = color;
        this._renderer = new OrbitGeometryRenderer(scene, color);
        this.type = 'elliptical';
        this.parameters = {
            _a: ZERO_LENGTH,
            e: 0,
            period: ZERO_TIME,
            _h: ZERO_LENGTH_VECTOR3,
            _eVec: ZERO_LENGTH_VECTOR3
        };
    }

    /**
     * Calculate and update trajectory from position and velocity
     */
    calculateFromState(position: LengthVector3, velocity: VelocityVector3, centralBodyMass: Mass): void {
        // Clean up old renderer before creating new one
        if (this._renderer) {
            this._renderer.cleanup();
        }
        this._renderer = new OrbitGeometryRenderer(this._scene, this._color);
        
        // Get position and velocity magnitudes as Length and Velocity
        const r = position.length(); // Length
        const v = velocity.length(); // Velocity
        
        // Update current altitude and velocity (now with units)
        this.altitude = r;
        this.velocity = v;
        
        // Calculate gravitational parameter mu = G * mass (with units)
        // Units: (km³/(kg·s²)) * kg = km³/s²
        const mu = (G as any).times(centralBodyMass) as any;
        
        // Calculate orbit geometry vectors using MeasureVector3 operations
        // Angular momentum: h = r × v (result has units of length²/time, but we'll use Length for convenience)
        const hVec = MeasureVector3.crossVectorsLengthVelocity(position, velocity);
        
        // v × h for eccentricity vector calculation
        // v has units velocity, h has units length, so v × h has units velocity × length = length²/time
        // But we need to work with this carefully - let's use the static method
        const velocityVec3 = velocity.getVector3();
        const hVecVec3 = hVec.getVector3();
        const vCrossHVec3 = new THREE.Vector3().crossVectors(velocityVec3, hVecVec3);
        
        // Calculate specific energy: v²/2 - mu/r
        // v² has units (km/s)² = km²/s²
        // v²/2 has units km²/s² (dividing by dimensionless 2)
        // mu/r has units (km³/s²) / km = km²/s²
        // So specific energy is in km²/s²
        const vSquared = (v as any).times(v) as any; // (km/s)² = km²/s²
        // Extract values for division (safe-units doesn't have direct divide method)
        const muValue = (mu as any).over(cubicKilometersPerSecondSquared).value;
        const rValue = r.over(kilometers).value;
        const muOverRValue = muValue / rValue; // (km³/s²) / km = km²/s²
        // For dimensionless division by 2, extract only at the end
        const vSquaredValue = (vSquared as any).over(squareKilometersPerSecondSquared).value;
        const specificEnergy = Measure.of((vSquaredValue / 2) - muOverRValue, squareKilometersPerSecondSquared);
        
        // Calculate semi-major axis: a = -mu / (2 * specificEnergy)
        // Units: (km³/s²) / (km²/s²) = km
        // Extract mu value once and reuse for both calculations
        // muValue already extracted above, reuse it
        const energyValue = (specificEnergy as any).over(squareKilometersPerSecondSquared).value;
        const a = Measure.of(-muValue / (2 * energyValue), kilometers);
        
        // Calculate eccentricity vector: e = (v × h) / mu - r̂
        // where r̂ is the unit vector in the direction of r
        // v × h has units velocity × length = length²/time (but stored as Length for convenience)
        // We need to work with THREE.Vector3 for the cross product, but minimize extractions
        // Reuse muValue extracted above
        const vCrossHDividedVec3 = vCrossHVec3.multiplyScalar(1 / muValue);
        const rNormalizedVec3 = position.normalize(); // Returns THREE.Vector3 (normalized direction)
        const eVecVec3 = vCrossHDividedVec3.sub(rNormalizedVec3);
        const eVec = MeasureVector3.fromVector3<Length>(eVecVec3, kilometers);
        // Keep e as a Measure until we need the dimensionless value for comparison
        const eMeasure = eVec.length();
        const e = eMeasure.over(kilometers).value;

        // For circular/elliptical orbits (e ≈ 0), use position vector as reference direction
        const referenceVec = e < 1e-6 ? position : eVec;

        // Check specific energy value for orbit type (need to extract for comparison)
        const specificEnergyValue = (specificEnergy as any).over(squareKilometersPerSecondSquared).value;
        
        if (specificEnergyValue < 0) {
            // Elliptical orbit
            // Calculate period: T = 2π * sqrt(a³/mu)
            // Units: sqrt(km³ / (km³/s²)) = sqrt(s²) = s
            // Extract values for division and sqrt
            const aValue = a.over(kilometers).value;
            const aCubedValue = aValue * aValue * aValue; // km³
            // muValue already extracted above, reuse it
            const aCubedOverMuValue = aCubedValue / muValue; // km³ / (km³/s²) = s²
            const periodValue = 2 * Math.PI * Math.sqrt(aCubedOverMuValue);
            const period = Measure.of(periodValue, seconds);
            
            // Extract numeric values and THREE.Vector3 only for visualization functions
            // aValue already extracted above for period calculation, reuse it
            const referenceVecVec3 = referenceVec.getVector3();
            
            // Generate ellipse points (requires numeric values and THREE.Vector3)
            const ellipsePoints = generateEllipsePoints(aValue, e, hVecVec3, referenceVecVec3, 100);
            
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
                periapsisPoint.copy(position.getVector3());
                apoapsisPoint.copy(position.getVector3()).multiplyScalar(-1);
            }

            // Generate bezier curves and points (requires numeric values and THREE.Vector3)
            const bezierResult = generateBezierOrbitPoints(aValue, e, hVecVec3, referenceVecVec3);

            this.type = 'elliptical';
            this._analyticalPoints = ellipsePoints;
            this._bezierPoints = bezierResult.points;
            this._bezierCurves = bezierResult.curves;
            // Convert to LengthVector3
            this._periapsisPoint = MeasureVector3.fromVector3<Length>(periapsisPoint, kilometers);
            this._apoapsisPoint = MeasureVector3.fromVector3<Length>(apoapsisPoint, kilometers);
            
            // Store parameters with units
            this.parameters = {
                _a: a,
                e,
                period,
                _h: hVec,
                _eVec: referenceVec
            };
            
            // Update periapsis and apoapsis for elliptical orbits (with units)
            // a * (1 - e) and a * (1 + e) are dimensionless scalars times length
            // Keep a as Measure, extract only for dimensionless multiplication
            const periapsisValue = aValue * (1 - e);
            const apoapsisValue = aValue * (1 + e);
            this.periapsis = Measure.of(periapsisValue, kilometers);
            this.apoapsis = Measure.of(apoapsisValue, kilometers);

            // Update visualization
            this._renderer.updateOrbitLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            // Extract THREE.Vector3 for renderer
            this._renderer.updateMarkers(
                this._periapsisPoint!.getVector3(),
                this._apoapsisPoint!.getVector3(),
                true,
                true
            );
            this._renderer.setVisibility(true);

        } else if (specificEnergyValue > 0) {
            // Hyperbolic orbit
            // Extract numeric values and THREE.Vector3 only for visualization functions
            // Extract a only once and reuse
            const aValue = a.over(kilometers).value;
            const hVecVec3 = hVec.getVector3();
            const eVecVec3 = eVec.getVector3();
            
            const hyperbolicPoints = generateHyperbolicPoints(aValue, e, hVecVec3, eVecVec3, 100);
            
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
            const bezierResult = generateHyperbolicBezierPoints(aValue, e, hVecVec3, eVecVec3);

            this.type = 'hyperbolic';
            this._analyticalPoints = hyperbolicPoints;
            this._bezierPoints = bezierResult.points;
            this._bezierCurves = bezierResult.curves;
            // Convert to LengthVector3
            this._periapsisPoint = MeasureVector3.fromVector3<Length>(periapsisPoint, kilometers);
            this._apoapsisPoint = undefined;
            
            // Store parameters with units
            this.parameters = {
                _a: a,
                e,
                period: INFINITE_TIME,
                _h: hVec,
                _eVec: eVec
            };
            
            // Update periapsis for hyperbolic orbits (apoapsis is undefined)
            // For hyperbolic orbits, a is negative, so periapsis = |a| * (e - 1)
            // Keep calculation in Measure form until dimensionless multiplication
            const periapsisValue = Math.abs(aValue) * (e - 1);
            this.periapsis = Measure.of(periapsisValue, kilometers);
            this.apoapsis = INFINITE_LENGTH;

            // Update visualization
            this._renderer.updateOrbitLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            // Extract THREE.Vector3 for renderer
            const periapsisVec3 = this._periapsisPoint!.getVector3();
            this._renderer.updateMarkers(periapsisVec3, periapsisVec3, true, false);
            this._renderer.setVisibility(true);

        } else {
            // Parabolic orbit
            this.type = 'parabolic';
            this._analyticalPoints = [];
            this._bezierPoints = [];
            this._bezierCurves = [];
            this._periapsisPoint = undefined;
            this._apoapsisPoint = undefined;
            
            // Store parameters with units
            this.parameters = {
                _a: ZERO_LENGTH,
                e: 1,
                period: INFINITE_TIME,
                _h: hVec,
                _eVec: eVec
            };
            
            // For parabolic orbits, periapsis is the distance at closest approach
            // periapsis = h² / (mu * (1 + e))
            // h has units of length²/time (from r × v), but we're using Length for convenience
            // Keep h as Measure, calculate h², then extract for dimensionless operations
            const hVecLength = hVec.length();
            const hVecLengthSquared = (hVecLength as any).times(hVecLength) as any; // length² (but stored as Length)
            // Extract values only for dimensionless operations
            const hVecLengthSquaredValue = (hVecLengthSquared as any).over(kilometers).value;
            const hVecLengthSquaredActual = hVecLengthSquaredValue * hVecLengthSquaredValue; // (length)² = length²
            // Reuse muValue from earlier in the function
            const periapsisValue = hVecLengthSquaredActual / (muValue * (1 + e));
            this.periapsis = Measure.of(periapsisValue, kilometers);
            this.apoapsis = INFINITE_LENGTH;

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
        this.periapsis = ZERO_LENGTH;
        this.apoapsis = ZERO_LENGTH;
        this.altitude = ZERO_LENGTH;
        this.velocity = ZERO_VELOCITY;
    }
    
    /**
     * Update current altitude and velocity (called during simulation updates)
     */
    updateCurrentState(position: LengthVector3, velocity: VelocityVector3): void {
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
    getPeriapsisPoint(): LengthVector3 | undefined {
        return this._periapsisPoint;
    }

    /**
     * Get apoapsis point
     */
    getApoapsisPoint(): LengthVector3 | undefined {
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

