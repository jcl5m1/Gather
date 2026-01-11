import * as THREE from 'three';
import { G, generateEllipsePoints, generateBezierOrbitPoints, generateHyperbolicPoints, generateHyperbolicBezierPoints, calculateOrbitBasis, OrbitBasis, calculateEllipticalPositionFromBasis, calculateEllipticalPosition } from './orbitUtils';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, kilograms, ZERO_LENGTH, ZERO_TIME, ZERO_VELOCITY, INFINITE_LENGTH, INFINITE_TIME, cubicKilometersPerSecondSquared, squareKilometersPerSecondSquared, kilometersPerSecond, secondsSquared, gravitationalConstantUnit, formatDistanceWithAstronomicalUnits } from './units';
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
        // Handle both BezierCurve (returns BezierCurvePoints) and RationalBezierCurve (returns array)
        const controlPoints = this.curve.getControlPoints();

        if (Array.isArray(controlPoints)) {
            // RationalBezierCurve returns an array
            if (controlPoints.length === 3) {
                // Quadratic curve (3 control points)
                this.startPoint.position.copy(controlPoints[0]);
                this.endPoint.position.copy(controlPoints[2]);
                this.controlPoints[0].position.copy(controlPoints[1]);
                this.controlPoints[1].visible = false; // Hide second control point for quadratic

                // Update control lines
                this.controlLines[0].geometry.setFromPoints([controlPoints[0], controlPoints[1]]);
                this.controlLines[1].geometry.setFromPoints([controlPoints[1], controlPoints[2]]);
            } else if (controlPoints.length === 4) {
                // Cubic curve (4 control points)
                this.startPoint.position.copy(controlPoints[0]);
                this.endPoint.position.copy(controlPoints[3]);
                this.controlPoints[0].position.copy(controlPoints[1]);
                this.controlPoints[1].position.copy(controlPoints[2]);
                this.controlPoints[1].visible = true;

                // Update control lines
                this.controlLines[0].geometry.setFromPoints([controlPoints[0], controlPoints[1]]);
                this.controlLines[1].geometry.setFromPoints([controlPoints[2], controlPoints[3]]);
            }
        } else {
            // BezierCurve returns BezierCurvePoints object
            const points = controlPoints as any;
            this.startPoint.position.copy(points.p0);
            this.endPoint.position.copy(points.p3);
            this.controlPoints[0].position.copy(points.p1);
            this.controlPoints[1].position.copy(points.p2);
            this.controlPoints[1].visible = true;

            // Update control lines
            this.controlLines[0].geometry.setFromPoints([points.p0, points.p1]);
            this.controlLines[1].geometry.setFromPoints([points.p2, points.p3]);
        }
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
    bezierLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[];
    periapsisIcon: THREE.Sprite;
    periapsisText: THREE.Sprite;
    apoapsisIcon: THREE.Sprite;
    apoapsisText: THREE.Sprite;

    // Methods for updating the visual representation
    updateOrbitLine(points: THREE.Vector3[]): void;
    updateBezierLine(points: THREE.Vector3[]): void;
    updateBezierCurves(curves: BezierCurve[]): void;
    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis?: boolean, periDist?: Length, apoDist?: Length): void;
    updateLUTMarkers(points: THREE.Vector3[]): void;
    setMarkersVisible(visible: boolean): void;
    setVisibility(show: boolean): void;
    cleanup(): void;
}

export class TrajectoryRenderer implements TrajectoryRender {
    orbitLine: THREE.Line;
    bezierLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[] = [];
    periapsisIcon: THREE.Sprite;
    periapsisText: THREE.Sprite;
    apoapsisIcon: THREE.Sprite;
    apoapsisText: THREE.Sprite;
    lutPoints: THREE.Points;

    private scene: THREE.Scene;
    private color: number;

    constructor(scene: THREE.Scene, orbitColor: number = 0x00ff00) {
        this.scene = scene;
        this.color = orbitColor;

        console.log('[DEBUG] TrajectoryRenderer constructor called', {
            sceneChildrenBefore: scene.children.length,
            orbitColor: '0x' + orbitColor.toString(16)
        });

        // Initialize analytical orbit line (HIDDEN by default now, as we only want Bezier)
        const orbitGeometry = new THREE.BufferGeometry();
        this.orbitLine = new THREE.Line(
            orbitGeometry,
            new THREE.LineBasicMaterial({
                color: 0xffffff,
                opacity: 0.8,
                transparent: true,
                visible: false // Hide analytical line
            })
        );
        this.orbitLine.visible = false;
        scene.add(this.orbitLine);
        console.log('[DEBUG] Added orbitLine to scene, scene children:', scene.children.length);

        // Initialize bezier approximation line (Solid now, to be the main visual)
        const bezierGeometry = new THREE.BufferGeometry();
        this.bezierLine = new THREE.Line(
            bezierGeometry,
            new THREE.LineBasicMaterial({ // Solid line
                color: orbitColor,
                opacity: 0.8,
                transparent: true
            })
        );
        scene.add(this.bezierLine);
        console.log('[DEBUG] Added bezierLine to scene, scene children:', scene.children.length);

        // Initialize markers as Sprites
        // Periapsis - Greenish
        const periColor = 0x00ff00;
        this.periapsisIcon = this.createSprite(this.createIconTexture(periColor, 'Pe'), 0.5);
        this.periapsisText = this.createSprite(this.createTextTexture('', periColor), 1.0); // Size 1.0 for text

        // Apoapsis - Reddish
        const apoColor = 0xff0000;
        this.apoapsisIcon = this.createSprite(this.createIconTexture(apoColor, 'Ap'), 0.5);
        this.apoapsisText = this.createSprite(this.createTextTexture('', apoColor), 1.0);

        scene.add(this.periapsisIcon);
        scene.add(this.periapsisText);
        scene.add(this.apoapsisIcon);
        scene.add(this.apoapsisText);
        console.log('[DEBUG] Added markers to scene, scene children:', scene.children.length);

        // Initialize LUT markers (Points for screen-space rendering)
        const lutGeometry = new THREE.BufferGeometry();
        const dotTexture = this.createDotTexture(0x0088ff); // Light blue for LUT
        const lutMaterial = new THREE.PointsMaterial({
            color: 0xffffff, // Use texture color
            map: dotTexture,
            size: 6, // 6 pixels constant size
            sizeAttenuation: false,
            transparent: true,
            alphaTest: 0.5
        });

        this.lutPoints = new THREE.Points(lutGeometry, lutMaterial);
        this.lutPoints.visible = false; // Hidden by default
        this.lutPoints.frustumCulled = false; // Always render if visible
        scene.add(this.lutPoints);
    }

    private createSprite(texture: THREE.Texture, scale: number): THREE.Sprite {
        const material = new THREE.SpriteMaterial({
            map: texture,
            sizeAttenuation: false, // Screen space
            depthTest: true // Keep depth test so they hide behind planets
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scale * 0.1, scale * 0.1, 1); // Initial scale, will be adjusted
        return sprite;
    }

    /**
     * Create a circular dot texture for the sprite/points
     */
    private createDotTexture(color: number): THREE.Texture {
        try {
            if (typeof document === 'undefined') return new THREE.Texture();
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const context = canvas.getContext('2d');
            if (context) {
                context.beginPath();
                context.arc(16, 16, 14, 0, 2 * Math.PI);
                context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
                context.fill();
            }
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        } catch (e) {
            return new THREE.Texture();
        }
    }

    private createIconTexture(color: number, label: string): THREE.Texture {
        try {
            if (typeof document === 'undefined') return new THREE.Texture();
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Draw a circle with border
                ctx.beginPath();
                ctx.arc(32, 32, 24, 0, 2 * Math.PI);
                ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}44`; // Transparent fill
                ctx.fill();
                ctx.lineWidth = 4;
                ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
                ctx.stroke();

                // Draw label in center
                ctx.font = 'bold 24px Arial';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, 32, 32);
            }
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        } catch (e) { return new THREE.Texture(); }
    }

    private createTextTexture(text: string, color: number): THREE.Texture {
        try {
            if (typeof document === 'undefined') return new THREE.Texture();
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.font = 'bold 20px monospace';
                ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'black';
                ctx.shadowBlur = 4;
                ctx.fillText(text, 128, 32);
            }
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        } catch (e) { return new THREE.Texture(); }
    }

    updateOrbitLine(points: THREE.Vector3[]): void {
        this.orbitLine.geometry.setFromPoints(points);
        // Force invisible as requested ("just plot the bezier orbit")
        this.orbitLine.visible = false;
    }

    updateBezierLine(points: THREE.Vector3[]): void {
        this.bezierLine.geometry.setFromPoints(points);
        // computeLineDistances not needed for solid line
    }

    updateBezierCurves(curves: BezierCurve[]): void {
        this.bezierRenderers.forEach(renderer => renderer.cleanup());
        this.bezierRenderers = [];
        curves.forEach(curve => {
            const renderer = new BezierCurveRenderer(this.scene, curve, this.color);
            this.bezierRenderers.push(renderer);
        });
    }

    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis: boolean = true, periDist?: Length, apoDist?: Length): void {
        const periScale = 0.05; // Base scale for sprites

        // Update Periapsis
        this.periapsisIcon.position.copy(periapsisPos);
        this.periapsisIcon.scale.set(periScale, periScale, 1);
        this.periapsisIcon.visible = visible;

        // Offset text slightly above icon
        // We can't easily know "above" in screen space without projecting. 
        // For simplicity, we just put it near the icon in 3D space, assuming typical view. 
        // Or we use the same position and let them overlap/rendering order handle it? 
        // Better: Offset in Y slightly.
        this.periapsisText.position.copy(periapsisPos);
        // To offset in screen space, we would need to do it in vertex shader or manipulate matrix.
        // For now, let's just create the texture such that text is at bottom/top?
        // Or create a combined texture?
        // Actually, just placing them at same position is fine if texture has offset.
        // My createTextTexture centers text.
        // Let's just create a new texture with the label.

        if (visible && periDist) {
            const label = `Pe: ${formatDistanceWithAstronomicalUnits(periDist)}`;
            const newTex = this.createTextTexture(label, 0x00ff00);
            if (this.periapsisText.material.map) this.periapsisText.material.map.dispose();
            this.periapsisText.material.map = newTex;
            // Scale text sprite to maintain aspect ratio (256x64 = 4:1)
            this.periapsisText.scale.set(periScale * 4, periScale, 1);
            // Offset text sprite slightly in Y to not overlap icon
            // Note: This is 3D offset, so it scales with distance...
            // Screen space constant offset needs a different approach (Canvas texture with both?)
            // For now, simplified:
            this.periapsisText.center.set(0.5, -0.5); // Anchor at top-center
        }
        this.periapsisText.visible = visible;

        // Update Apoapsis
        this.apoapsisIcon.position.copy(apoapsisPos);
        this.apoapsisIcon.scale.set(periScale, periScale, 1);
        this.apoapsisIcon.visible = visible && showApoapsis;

        this.apoapsisText.position.copy(apoapsisPos);
        if (visible && showApoapsis && apoDist) {
            const label = `Ap: ${formatDistanceWithAstronomicalUnits(apoDist)}`;
            const newTex = this.createTextTexture(label, 0xff0000);
            if (this.apoapsisText.material.map) this.apoapsisText.material.map.dispose();
            this.apoapsisText.material.map = newTex;
            this.apoapsisText.scale.set(periScale * 4, periScale, 1);
            this.apoapsisText.center.set(0.5, -0.5);
        }
        this.apoapsisText.visible = visible && showApoapsis;
    }

    setMarkersVisible(visible: boolean): void {
        this.periapsisIcon.visible = visible;
        this.periapsisText.visible = visible;
        this.apoapsisIcon.visible = visible;
        this.apoapsisText.visible = visible;
    }

    updateLUTMarkers(points: THREE.Vector3[]): void {
        this.lutPoints.geometry.setFromPoints(points);
        this.lutPoints.geometry.computeBoundingSphere();
    }

    setVisibility(show: boolean): void {
        this.orbitLine.visible = false; // Always hidden
        this.bezierLine.visible = show;
        this.bezierRenderers.forEach(renderer => renderer.setVisibility(show, false));
        this.periapsisIcon.visible = show;
        this.periapsisText.visible = show;
        this.apoapsisIcon.visible = show;
        this.apoapsisText.visible = show;
        this.lutPoints.visible = show;
    }

    cleanup(): void {
        console.log('[DEBUG] TrajectoryRenderer.cleanup() called');

        this.orbitLine.visible = false;
        this.bezierLine.visible = false;
        this.periapsisIcon.visible = false;
        this.periapsisText.visible = false;
        this.apoapsisIcon.visible = false;
        this.apoapsisText.visible = false;

        this.bezierRenderers.forEach(renderer => renderer.cleanup());
        this.bezierRenderers = [];

        [
            this.orbitLine,
            this.bezierLine,
            this.periapsisIcon,
            this.periapsisText,
            this.apoapsisIcon,
            this.apoapsisText,
            this.lutPoints
        ].forEach(obj => {
            if (obj.parent === this.scene) this.scene.remove(obj);
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                    if ((obj.material as any).map) (obj.material as any).map.dispose();
                }
            }
        });

        console.log('[DEBUG] TrajectoryRenderer.cleanup() completed');
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

export interface TimeWarpLUT {
    M: number[];
    bezierT: number[];
    // Control points for each interval: P1 and P2 (scalar values for T)
    bezierPoints: { p1: number, p2: number }[];
    errors: number[];
}

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

    private _useBezierEstimation: boolean = true;
    private _timeWarpLUT: TimeWarpLUT | null = null;
    private _cachedOrbitBasis: OrbitBasis | null = null;
    private _startTime: number = 0;
    private _initialPosition: THREE.Vector3 = new THREE.Vector3();
    private _initialVelocity: THREE.Vector3 = new THREE.Vector3();
    private _centralBodyMass: number = 0;
    private _timeWarpFunction: ((t: number) => number) | null = null;
    private _markersVisible: boolean = true;

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
     * Set visibility of periapsis/apoapsis markers
     */
    setMarkersVisible(visible: boolean): void {
        this._markersVisible = visible;
        // Also update renderer immediately if it exists
        if (this._renderer) {
            this._renderer.setMarkersVisible(visible);
        }
    }

    /**
     * Calculate and update trajectory from position and velocity
     */
    calculateFromState(position: LengthVector3, velocity: VelocityVector3, centralBodyMass: Mass, startTime: Time = ZERO_TIME): void {
        const startTimeSec = startTime.over(seconds).value;
        this._startTime = startTimeSec;
        this._centralBodyMass = centralBodyMass.over(kilograms).value;
        this._initialPosition.copy(position.getVector3());
        this._initialVelocity.copy(velocity.getVector3());
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

            // Update visualization - render BOTH analytical orbit and bezier approximation
            this._renderer.updateOrbitLine(ellipsePoints);
            this._renderer.updateBezierLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            // Extract THREE.Vector3 for renderer
            this._renderer.updateMarkers(
                this._periapsisPoint!.getVector3(),
                this._apoapsisPoint!.getVector3(),
                this._markersVisible,
                true,
                this.periapsis,
                this.apoapsis
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

            // Update visualization - render BOTH analytical orbit and bezier approximation
            this._renderer.updateOrbitLine(hyperbolicPoints);
            this._renderer.updateBezierLine(bezierResult.points);
            this._renderer.updateBezierCurves(bezierResult.curves);
            // Extract THREE.Vector3 for renderer
            const periapsisVec3 = this._periapsisPoint!.getVector3();
            this._renderer.updateMarkers(periapsisVec3, periapsisVec3, this._markersVisible, false, this.periapsis);
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

        // Build Time Warp LUT if applicable
        if (this.type === 'elliptical' && this._useBezierEstimation) {
            this.buildTimeWarpLUT(this._centralBodyMass);
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
     * Get bezier curves
     */
    getBezierCurves(): any[] {
        return this._bezierCurves;
    }

    /**
     * Set visibility
     */
    setVisibility(visible: boolean): void {
        this._renderer.setVisibility(visible);
    }

    /**
     * Set whether to use Bezier estimation (Time Warp LUT)
     */
    set useBezierEstimation(value: boolean) {
        this._useBezierEstimation = value;
        if (value && !this._timeWarpLUT && this.type === 'elliptical') {
            this.buildTimeWarpLUT(this._centralBodyMass);
        }
    }

    get useBezierEstimation(): boolean {
        return this._useBezierEstimation;
    }

    /**
     * Build time warp LUT by sampling evenly in True Anomaly
     * Uses Mean Anomaly as initial guess for optimization
     */
    private buildTimeWarpLUT(centralBodyMass: number): void {
        const { _a, e, period } = this.parameters;
        const semiMajorAxis = _a.over(kilometers).value;
        // eccentricity uses this.parameters.e

        const bezierCurves = this._bezierCurves;

        if (!bezierCurves || bezierCurves.length === 0) {
            return;
        }

        // Calculate orbital basis vectors
        this._cachedOrbitBasis = calculateOrbitBasis(this._initialPosition, this._initialVelocity, centralBodyMass);
        const { M0 } = this._cachedOrbitBasis;

        // Generate knots and intermediate samples
        const numIntervals = 4;
        const subSamplesPerInterval = 16;
        const totalFitSamples = numIntervals * subSamplesPerInterval;

        const lutM: number[] = [];
        const lutBezierT: number[] = [];
        const bezierPoints: { p1: number, p2: number }[] = [];

        const fitData: { u: number, M: number, bezierT: number, error: number }[] = [];

        for (let i = 0; i <= totalFitSamples; i++) {
            // Sample evenly in Eccentric Anomaly from Pi to 2Pi (Half orbit, Apoapsis to Periapsis)
            // This aligns with 0 input -> 0 output (Apoapsis -> Apoapsis)
            const E = Math.PI + (i / totalFitSamples) * Math.PI;

            // M relative to Periapsis (Standard Kepler M)
            const M_standard = E - e * Math.sin(E);

            // Normalize M relative to Apoapsis (0 to 0.5)
            // M_standard ranges from Pi to 2Pi
            const M_relative_apo = (M_standard - Math.PI) / (2 * Math.PI);

            // We don't wrap here because we know we are in 0-0.5 range (relative to Apo)
            const M_wrapped = M_relative_apo;

            // Optimize T
            // Note: calculateAnalyticalPositionInternal now expects M_standard relative to Periapsis (0-1)?
            // Actually, let's just pass the normalized standard M to it.
            const M_standard_norm = M_standard / (2 * Math.PI);

            // DEBUG: Use Eccentric Anomaly directly for T mapping as INITIAL GUESS
            // T range for this half orbit (Apo -> Peri) is 0.0 to 0.5
            // E range is Pi to 2Pi
            const initialGuessT = (E - Math.PI) / (2 * Math.PI);

            const analyticalPos = this.calculateAnalyticalPositionInternal(M_standard_norm);
            const T = this.optimizeBezierT(analyticalPos, initialGuessT);

            // Calculate error
            const bezierPos = this.computeBezierPositionFromTime(T);
            const error = bezierPos ? analyticalPos.distanceTo(bezierPos) : Infinity;

            fitData.push({ u: i / totalFitSamples, M: M_wrapped, bezierT: T, error });
        }

        fitData.sort((a, b) => a.M - b.M);

        // Build LUT intervals
        const lutErrors: number[] = [];

        for (let i = 0; i < fitData.length - 1; i += subSamplesPerInterval) {
            let p3Index = i + subSamplesPerInterval;
            if (p3Index >= fitData.length) p3Index = fitData.length - 1;
            if (p3Index <= i) break;

            const segmentSamples = fitData.slice(i, p3Index + 1);
            const startNode = segmentSamples[0];
            const endNode = segmentSamples[segmentSamples.length - 1];

            // Add knot to LUT
            if (lutM.length === 0) {
                lutM.push(startNode.M);
                lutBezierT.push(startNode.bezierT);
                lutErrors.push(startNode.error);
            }
            lutM.push(endNode.M);
            lutBezierT.push(endNode.bezierT);
            lutErrors.push(endNode.error);

            // Fit Bezier
            const mStart = startNode.M;
            const mEnd = endNode.M;
            const tStart = startNode.bezierT;
            const tEnd = endNode.bezierT;

            const samplesForFit = segmentSamples.map(s => {
                let u_local = (s.M - mStart) / (mEnd - mStart);
                if (isNaN(u_local)) u_local = 0;
                return { u: u_local, y: s.bezierT };
            });

            const control = this.fitCubicBezier1D(tStart, tEnd, samplesForFit);
            bezierPoints.push(control);

            if (p3Index === fitData.length - 1) break;
        }

        this._timeWarpLUT = {
            M: lutM,
            bezierT: lutBezierT,
            bezierPoints: bezierPoints,
            errors: lutErrors
        };

        console.log(`[Trajectory] Built Time Warp LUT with ${numIntervals} intervals.`);

        // Visualize LUT samples (original + mirrored)
        const samplePositions: THREE.Vector3[] = [];

        console.log('[Trajectory] LUT M values (Apo-relative):', lutM);
        console.log('[Trajectory] Orbit Info:', { M0, e });

        // Add original samples (0 to 0.5, Apo -> Peri)
        lutM.forEach(m_apo => {
            // Convert Apo-relative M back to Peri-relative M for analytical calc
            // m_apo = (M_std - PI) / 2PI => M_std = m_apo * 2PI + PI
            const M_std = m_apo * 2 * Math.PI + Math.PI;
            const M_std_norm = M_std / (2 * Math.PI);
            const pos = this.calculateAnalyticalPositionInternal(M_std_norm);
            samplePositions.push(pos);
        });

        // Add mirrored samples (0.5 to 1.0, Peri -> Apo)
        lutM.forEach(m => {
            const mMirrored = 1.0 - m;
            // Avoid duplicates
            if (Math.abs(mMirrored - m) > 1e-6 && Math.abs(mMirrored - 1.0) > 1e-6) {
                // Mirrored M_apo corresponds to the other side of orbit
                // m_mirror = 1 - m_apo.
                // If m_apo -> E in [PI, 2PI], then m_mirror -> E in [0, PI]?
                // Let's check. m (Apo->Peri). m=0 (Apo), m=0.5 (Peri).
                // m_mirror (Peri->Apo). m=1 (Apo), m=0.5 (Peri).
                // M_std = m_mirror * 2PI + PI?
                // No, m_mirror=1 => M_std=3PI (same as PI, Apo).
                // m_mirror=0.5 => M_std=2PI (Peri).
                // So yes, M_std = m_mirror * 2PI + PI works (modulo 2PI).

                const M_std = mMirrored * 2 * Math.PI + Math.PI;
                const M_std_norm = (M_std % (2 * Math.PI)) / (2 * Math.PI);
                const pos = this.calculateAnalyticalPositionInternal(M_std_norm);
                samplePositions.push(pos);
            }
        });

        console.log(`[Trajectory] Generated ${samplePositions.length} LUT sample dots.`);

        this._renderer.updateLUTMarkers(samplePositions);
    }

    /**
     * Helper to compute analytical position for internal logic (using stored basis)
     * normalizedTime is fraction of orbit relative to Periapsis (0 to 1)
     */
    private calculateAnalyticalPositionInternal(normalizedTime: number): THREE.Vector3 {
        if (!this._cachedOrbitBasis) return new THREE.Vector3();

        const { _a, e } = this.parameters;
        const a = _a.over(kilometers).value;
        const { periapsisDir, perpDir } = this._cachedOrbitBasis;

        // M is Mean Anomaly relative to Periapsis
        const M_target = normalizedTime * 2 * Math.PI;

        return calculateEllipticalPositionFromBasis(M_target, a, e, periapsisDir, perpDir);
    }

    /**
     * Optimize bezierT to minimize position error from analytical position
     */
    private optimizeBezierT(analyticalPos: THREE.Vector3, initialGuess: number): number {
        const bezierCurves = this._bezierCurves;
        if (!bezierCurves || bezierCurves.length === 0) return initialGuess;

        const objectiveFunction = (bezierT: number): number => {
            const bezierPos = this.computeBezierPositionFromTime(bezierT);
            if (!bezierPos) return Infinity;
            return analyticalPos.distanceTo(bezierPos);
        };

        // Grid search
        const gridSize = 50;
        let bestT = initialGuess;
        let bestError = objectiveFunction(initialGuess);

        // Search around guess
        for (let i = -5; i <= 5; i++) {
            let t = initialGuess + (i / gridSize) * 0.1;
            // Wrap t
            t = ((t % 1) + 1) % 1;
            const error = objectiveFunction(t);
            if (error < bestError) {
                bestError = error;
                bestT = t;
            }
        }

        // Golden section search
        const phi = (1 + Math.sqrt(5)) / 2;
        const tolerance = 1e-6;
        let a = Math.max(0, bestT - 0.02);
        let b = Math.min(1, bestT + 0.02);
        let c = b - (b - a) / phi;
        let d = a + (b - a) / phi;

        for (let iter = 0; iter < 20; iter++) {
            if (objectiveFunction(c) < objectiveFunction(d)) {
                b = d; d = c; c = b - (b - a) / phi;
            } else {
                a = c; c = d; d = a + (b - a) / phi;
            }
            if (Math.abs(b - a) < tolerance) break;
        }

        return (a + b) / 2;
    }

    public computeBezierPositionFromTime(normalizedTime: number): THREE.Vector3 | null {
        const bezierCurves = this._bezierCurves;
        if (!bezierCurves || bezierCurves.length === 0) return null;
        if (isNaN(normalizedTime)) return null;

        const numCurves = bezierCurves.length;
        const totalProgress = normalizedTime * numCurves;
        const normalizedTotal = totalProgress - Math.floor(totalProgress);
        let curveIndex = Math.floor(totalProgress) % numCurves;
        if (curveIndex < 0) curveIndex += numCurves;

        if (curveIndex >= numCurves || !bezierCurves[curveIndex]) return null;
        return bezierCurves[curveIndex].getPoint(normalizedTotal);
    }

    private fitCubicBezier1D(y0: number, y3: number, samples: { u: number, y: number }[]): { p1: number, p2: number } {
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
        if (Math.abs(det) < 1e-9) return { p1: y0 + (y3 - y0) / 3, p2: y0 + 2 * (y3 - y0) / 3 };

        const invDet = 1.0 / det;
        return { p1: (c22 * r1 - c12 * r2) * invDet, p2: (c11 * r2 - c12 * r1) * invDet };
    }

    private _interpolationMode: 'linear' | 'cubic' = 'cubic';

    public setInterpolationMode(mode: 'linear' | 'cubic'): void {
        this._interpolationMode = mode;
    }

    private timeWarpFunction(t: number): number {
        t = Math.max(0, Math.min(1, t));
        if (this._timeWarpFunction) return this._timeWarpFunction(t);
        if (!this._timeWarpLUT || this._timeWarpLUT.M.length === 0) return t;

        const { M, bezierT, bezierPoints } = this._timeWarpLUT;

        // t is normalized M relative to Apoapsis

        let normalizedT = t;
        let isMirrored = false;
        if (t > 0.5) {
            normalizedT = 1.0 - t;
            isMirrored = true;
        }

        // Find interval
        let left = 0, right = M.length - 1;
        // Optimization: check bounds
        if (normalizedT <= M[0]) {
            const val = bezierT[0];
            return isMirrored ? 1.0 - val : val;
        }
        if (normalizedT >= M[M.length - 1]) {
            const val = bezierT[bezierT.length - 1];
            return isMirrored ? 1.0 - val : val;
        }

        while (right - left > 1) {
            const mid = Math.floor((left + right) / 2);
            if (M[mid] <= normalizedT) left = mid;
            else right = mid;
        }

        const M0 = M[left], M1 = M[right];
        const T0 = bezierT[left], T1 = bezierT[right];

        const pts = bezierPoints[left];

        let result = T0 + (T1 - T0) * ((normalizedT - M0) / (M1 - M0)); // Linear fallback

        if (pts && this._interpolationMode === 'cubic') {
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
     * Get position at a specific time
     * @param time Time in seconds
     * @param method method to use ('analytical' or 'bezier')
     */
    getPosition(time: number, method: 'analytical' | 'bezier' = 'bezier'): THREE.Vector3 | null {
        if (this.type === 'parabolic') return null; // TODO support parabolic

        // Default to analytical if Bezier not ready or not requested
        if (method === 'analytical' || !this._useBezierEstimation || !this._timeWarpLUT) {
            return calculateEllipticalPosition(
                time,
                this.parameters._a.over(kilometers).value,
                this.parameters.e,
                this.parameters.period.over(seconds).value,
                this._startTime,
                this._initialPosition,
                this._initialVelocity,
                this._centralBodyMass
            );
        }

        // Bezier Estimation
        if (!this._cachedOrbitBasis) return null;

        const p = this.parameters.period.over(seconds).value;
        if (p === 0) return null;

        // Calculate Mean Anomaly relative to Periapsis
        // M(t) = M0 + n * (t - t0)
        const n = 2 * Math.PI / p;
        const dt = time - this._startTime;
        const M_current_peri = this._cachedOrbitBasis.M0 + n * dt;

        // Normalize to 0-1 range (relative to Periapsis)
        const M_norm_peri = M_current_peri / (2 * Math.PI);
        const M_wrapped_peri = ((M_norm_peri % 1) + 1) % 1;

        // Convert to Apoapsis-relative for timeWarpFunction
        // M_apo = M_peri + PI. M_apo_norm = (M_peri_norm + 0.5) % 1.
        const M_wrapped_apo = (M_wrapped_peri + 0.5) % 1.0;

        const warpedTime = this.timeWarpFunction(M_wrapped_apo);
        return this.computeBezierPositionFromTime(warpedTime);
    }


    /**
     * Get the time warp function
     */
    public getTimeWarpFunction(): (t: number) => number {
        return this.timeWarpFunction.bind(this);
    }

    /**
     * Get LUT sample positions (M values)
     * Returns full range 0->1 by mirroring
     */
    public getLUTSamplePositions(): number[] {
        if (!this._timeWarpLUT) return [];
        const lutM = this._timeWarpLUT.M;
        const fullM = [...lutM];

        // Add mirrored samples (0.5 to 1.0)
        // Iterate backwards to keep order
        for (let i = lutM.length - 1; i >= 0; i--) {
            const m = lutM[i];
            const mMirrored = 1.0 - m;
            // Avoid duplicates at 0.5 (if present)
            // We DO want to include 1.0 to close the loop for plotting
            if (Math.abs(mMirrored - m) > 1e-6) {
                fullM.push(mMirrored);
            }
        }

        return fullM;
    }

    /**
     * Get full LUT data
     * Returns full range 0->1 by mirroring
     */
    public getLUTData(): TimeWarpLUT | null {
        if (!this._timeWarpLUT) return null;

        const lutM = this._timeWarpLUT.M;
        const lutBezierT = this._timeWarpLUT.bezierT;
        const lutErrors = this._timeWarpLUT.errors;
        const fullM = [...lutM];
        const fullBezierT = [...lutBezierT];
        const fullErrors = [...lutErrors];

        // Add mirrored samples
        for (let i = lutM.length - 1; i >= 0; i--) {
            const m = lutM[i];
            const t = lutBezierT[i];
            const err = lutErrors[i] || 0;

            const mMirrored = 1.0 - m;
            // Mirror T: if M -> T, then 1-M -> 1-T
            const tMirrored = 1.0 - t;

            // Avoid duplicate M checks (mostly for 0.5)
            // We DO want to include 1.0 to close the loop for plotting
            if (Math.abs(mMirrored - m) > 1e-6) {
                fullM.push(mMirrored);
                fullBezierT.push(tMirrored);
                fullErrors.push(err);
            }
        }

        // Return a new object with full arrays
        return {
            M: fullM,
            bezierT: fullBezierT,
            bezierPoints: this._timeWarpLUT.bezierPoints,
            errors: fullErrors
        };
    }

    /**
     * Compute analytical position from normalized time
     */
    /**
     * Compute analytical position from normalized time
     * Input time is assumed to be in the same frame as the LUT (Apoapsis-relative)
     */
    public computeAnalyticalPositionFromNormalizedTime(normalizedTime: number): THREE.Vector3 {
        // Internal calculation expects Periapsis-relative time
        // We need to shift: Apoapsis-relative 0 -> Periapsis-relative 0.5
        const periapsisRelativeTime = (normalizedTime + 0.5) % 1.0;
        return this.calculateAnalyticalPositionInternal(periapsisRelativeTime);
    }

    private _gpuCompute: import('./gpuOrbitCompute').GPUOrbitCompute | null = null;

    /**
     * Compute batch of positions using GPU acceleration
     */
    public computePositionsGPU(times: number[]): Float32Array | null {
        if (!this.type) return null; // Safety check
        // Check for bezier/LUT availability? GPU compute handles missing LUT?
        // Actually best to ensure LUT exists if using Time Warp
        if (this._useBezierEstimation && (!this._timeWarpLUT || this._timeWarpLUT.M.length === 0)) {
            // Try building it?
            this.buildTimeWarpLUT(this._centralBodyMass);
        }

        // Lazy initialize GPU compute
        if (!this._gpuCompute) {
            const { GPUOrbitCompute } = require('./gpuOrbitCompute');
            this._gpuCompute = new GPUOrbitCompute();
        }

        // We need access to the renderer. 
        // Hack: SimulationController attaches renderer to window? Or we search?
        const controller = (window as any).simulationController;
        const renderer = controller?.getGameLoop()?.getRenderer();
        if (!renderer) {
            console.error('[Trajectory] Renderer not found for GPU compute');
            return null;
        }

        return this._gpuCompute!.compute(renderer, times, this._timeWarpLUT!, this._bezierCurves);
    }
}
