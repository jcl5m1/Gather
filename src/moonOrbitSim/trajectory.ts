import * as THREE from 'three';
import { G, generateEllipsePoints, generateBezierOrbitPoints, generateHyperbolicPoints, generateHyperbolicBezierPoints } from './orbitUtils';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, kilograms, ZERO_LENGTH, ZERO_TIME, ZERO_VELOCITY, INFINITE_LENGTH, INFINITE_TIME, cubicKilometersPerSecondSquared, squareKilometersPerSecondSquared, kilometersPerSecond, secondsSquared } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3, ZERO_LENGTH_VECTOR3 } from './unitsVector3';

// ============================================================================
// Bezier Curve Classes
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

export interface BezierCurveRender {
    curve: BezierCurve;
    startPoint: THREE.Mesh;
    endPoint: THREE.Mesh;
    controlPoints: THREE.Mesh[];
    controlLines: THREE.Line[];
    setVisibility(show: boolean, showControls: boolean): void;
    updatePoints(): void;
    cleanup(): void;
}

export class BezierCurveRenderer implements BezierCurveRender {
    curve: BezierCurve;
    startPoint: THREE.Mesh;
    endPoint: THREE.Mesh;
    controlPoints: THREE.Mesh[] = [];
    controlLines: THREE.Line[] = [];
    private scene: THREE.Scene;
    private color: number;

    constructor(scene: THREE.Scene, curve: BezierCurve, color: number = 0x00ff00) {
        this.scene = scene;
        this.curve = curve;
        this.color = color;

        // Initialize end points
        const endPointGeometry = new THREE.SphereGeometry(0.3, 16, 16);
        const endPointMaterial = new THREE.MeshBasicMaterial({ 
            color: this.color,
            transparent: true,
            opacity: 0.8
        });
        
        this.startPoint = new THREE.Mesh(endPointGeometry, endPointMaterial);
        this.endPoint = new THREE.Mesh(endPointGeometry, endPointMaterial);
        scene.add(this.startPoint);
        scene.add(this.endPoint);

        // Initialize control points
        const controlPointGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const controlPointMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffff00,
            transparent: true,
            opacity: 0.4
        });
        
        for (let i = 0; i < 2; i++) {
            const point = new THREE.Mesh(controlPointGeometry, controlPointMaterial);
            point.visible = false;
            scene.add(point);
            this.controlPoints.push(point);
        }

        // Initialize control lines
        const controlLineMaterial = new THREE.LineBasicMaterial({ 
            color: 0xffff00,
            opacity: 0.3,
            transparent: true
        });
        
        for (let i = 0; i < 2; i++) {
            const lineGeometry = new THREE.BufferGeometry();
            const line = new THREE.Line(lineGeometry, controlLineMaterial);
            line.visible = false;
            scene.add(line);
            this.controlLines.push(line);
        }

        this.updatePoints();
    }

    updatePoints(): void {
        const points = this.curve.getControlPoints();
        
        // Update end points
        this.startPoint.position.copy(points.p0);
        this.endPoint.position.copy(points.p3);

        // Update control points
        this.controlPoints[0].position.copy(points.p1);
        this.controlPoints[1].position.copy(points.p2);

        // Update control lines
        this.controlLines[0].geometry.setFromPoints([points.p0, points.p1]);
        this.controlLines[1].geometry.setFromPoints([points.p2, points.p3]);
    }

    setVisibility(show: boolean, showControls: boolean = false): void {
        this.startPoint.visible = show;
        this.endPoint.visible = show;
        this.controlPoints.forEach(point => point.visible = show && showControls);
        this.controlLines.forEach(line => line.visible = show && showControls);
    }

    cleanup(): void {
        console.log('[DEBUG] BezierCurveRenderer.cleanup() called', {
            controlPointsCount: this.controlPoints.length,
            controlLinesCount: this.controlLines.length,
            startPointInScene: this.startPoint.parent === this.scene,
            endPointInScene: this.endPoint.parent === this.scene
        });

        // Hide objects first
        this.startPoint.visible = false;
        this.endPoint.visible = false;
        this.controlPoints.forEach(point => point.visible = false);
        this.controlLines.forEach(line => line.visible = false);
        
        // Remove from scene
        if (this.startPoint.parent === this.scene) {
            console.log('[DEBUG] Removing startPoint from scene');
            this.scene.remove(this.startPoint);
        }
        if (this.endPoint.parent === this.scene) {
            console.log('[DEBUG] Removing endPoint from scene');
            this.scene.remove(this.endPoint);
        }
        this.controlPoints.forEach((point, index) => {
            if (point.parent === this.scene) {
                console.log(`[DEBUG] Removing controlPoint ${index} from scene`);
                this.scene.remove(point);
            }
        });
        this.controlLines.forEach((line, index) => {
            if (line.parent === this.scene) {
                console.log(`[DEBUG] Removing controlLine ${index} from scene`);
                this.scene.remove(line);
            }
        });
        
        // Dispose of geometries and materials
        this.startPoint.geometry.dispose();
        this.endPoint.geometry.dispose();
        if (this.startPoint.material instanceof THREE.Material) {
            this.startPoint.material.dispose();
        }
        if (this.endPoint.material instanceof THREE.Material) {
            this.endPoint.material.dispose();
        }
        this.controlPoints.forEach(point => {
            point.geometry.dispose();
            if (point.material instanceof THREE.Material) {
                point.material.dispose();
            }
        });
        this.controlLines.forEach(line => {
            line.geometry.dispose();
            if (line.material instanceof THREE.Material) {
                line.material.dispose();
            }
        });
        
        console.log('[DEBUG] BezierCurveRenderer.cleanup() completed');
    }
}

// ============================================================================
// Trajectory Renderer
// ============================================================================

export interface TrajectoryRender {
    // Core Three.js objects for rendering
    orbitLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[];
    periapsisMarker: THREE.Mesh;
    apoapsisMarker: THREE.Mesh;

    // Methods for updating the visual representation
    updateOrbitLine(points: THREE.Vector3[]): void;
    updateBezierCurves(curves: BezierCurve[]): void;
    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis?: boolean): void;
    setVisibility(show: boolean): void;
    cleanup(): void;
}

export class TrajectoryRenderer implements TrajectoryRender {
    orbitLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[] = [];
    periapsisMarker: THREE.Mesh;
    apoapsisMarker: THREE.Mesh;

    private scene: THREE.Scene;
    private color: number;

    constructor(scene: THREE.Scene, orbitColor: number = 0x00ff00) {
        this.scene = scene;
        this.color = orbitColor;

        console.log('[DEBUG] TrajectoryRenderer constructor called', {
            sceneChildrenBefore: scene.children.length,
            orbitColor: '0x' + orbitColor.toString(16)
        });

        // Initialize orbit line
        const orbitGeometry = new THREE.BufferGeometry();
        this.orbitLine = new THREE.Line(
            orbitGeometry,
            new THREE.LineBasicMaterial({ 
                color: orbitColor, 
                opacity: 0.8, 
                transparent: true 
            })
        );
        scene.add(this.orbitLine);
        console.log('[DEBUG] Added orbitLine to scene, scene children:', scene.children.length);

        // Initialize markers
        const markerGeometry = new THREE.SphereGeometry(0.5, 16, 16);
        this.periapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.apoapsisMarker = new THREE.Mesh(
            markerGeometry,
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        scene.add(this.periapsisMarker);
        scene.add(this.apoapsisMarker);
        console.log('[DEBUG] Added markers to scene, scene children:', scene.children.length);
    }

    updateOrbitLine(points: THREE.Vector3[]): void {
        this.orbitLine.geometry.setFromPoints(points);
    }

    updateBezierCurves(curves: BezierCurve[]): void {
        // Clean up old bezier renderers
        this.bezierRenderers.forEach(renderer => renderer.cleanup());
        this.bezierRenderers = [];

        // Create new bezier renderers
        curves.forEach(curve => {
            const renderer = new BezierCurveRenderer(this.scene, curve, this.color);
            this.bezierRenderers.push(renderer);
        });
    }

    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis: boolean = true): void {
        this.periapsisMarker.position.copy(periapsisPos);
        this.apoapsisMarker.position.copy(apoapsisPos);
        this.periapsisMarker.visible = visible;
        this.apoapsisMarker.visible = visible && showApoapsis;
    }

    setVisibility(show: boolean): void {
        this.orbitLine.visible = show;
        this.bezierRenderers.forEach(renderer => renderer.setVisibility(show, false));
        this.periapsisMarker.visible = show;
        this.apoapsisMarker.visible = show;
    }

    cleanup(): void {
        console.log('[DEBUG] TrajectoryRenderer.cleanup() called', {
            bezierRenderersCount: this.bezierRenderers.length,
            orbitLineInScene: this.orbitLine.parent === this.scene,
            periapsisMarkerInScene: this.periapsisMarker.parent === this.scene,
            apoapsisMarkerInScene: this.apoapsisMarker.parent === this.scene,
            sceneChildrenBefore: this.scene.children.length
        });

        // Hide all objects first
        this.orbitLine.visible = false;
        this.periapsisMarker.visible = false;
        this.apoapsisMarker.visible = false;
        
        // Clean up bezier renderers
        this.bezierRenderers.forEach((renderer, index) => {
            console.log(`[DEBUG] Cleaning up bezier renderer ${index}`);
            renderer.cleanup();
        });
        
        // Remove all objects from scene (check if they're actually in the scene first)
        if (this.orbitLine.parent === this.scene) {
            console.log('[DEBUG] Removing orbitLine from scene');
            this.scene.remove(this.orbitLine);
        } else {
            console.log('[DEBUG] orbitLine not in scene, parent:', this.orbitLine.parent);
        }
        if (this.periapsisMarker.parent === this.scene) {
            console.log('[DEBUG] Removing periapsisMarker from scene');
            this.scene.remove(this.periapsisMarker);
        } else {
            console.log('[DEBUG] periapsisMarker not in scene, parent:', this.periapsisMarker.parent);
        }
        if (this.apoapsisMarker.parent === this.scene) {
            console.log('[DEBUG] Removing apoapsisMarker from scene');
            this.scene.remove(this.apoapsisMarker);
        } else {
            console.log('[DEBUG] apoapsisMarker not in scene, parent:', this.apoapsisMarker.parent);
        }

        // Dispose of geometry and material to free resources
        this.orbitLine.geometry.dispose();
        if (this.orbitLine.material instanceof THREE.Material) {
            this.orbitLine.material.dispose();
        }
        this.periapsisMarker.geometry.dispose();
        if (this.periapsisMarker.material instanceof THREE.Material) {
            this.periapsisMarker.material.dispose();
        }
        this.apoapsisMarker.geometry.dispose();
        if (this.apoapsisMarker.material instanceof THREE.Material) {
            this.apoapsisMarker.material.dispose();
        }

        // Clear arrays
        this.bezierRenderers = [];
        
        console.log('[DEBUG] TrajectoryRenderer.cleanup() completed', {
            sceneChildrenAfter: this.scene.children.length,
            bezierRenderersCleared: true
        });
    }
}

// ============================================================================
// Trajectory Parameters and Type
// ============================================================================

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
    private _renderer: TrajectoryRenderer; // Private - use underscore prefix
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
        this._renderer = new TrajectoryRenderer(scene, color);
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
        this._renderer = new TrajectoryRenderer(this._scene, this._color);
        
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
