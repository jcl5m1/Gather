import * as THREE from 'three';
import { 
    G, 
    generateEllipsePoints, 
    generateBezierOrbitPoints, 
    generateHyperbolicPoints, 
    generateHyperbolicBezierPoints, 
    calculateOrbitBasis, 
    OrbitBasis, 
    calculateEllipticalPositionFromBasis, 
    calculateEllipticalPosition, 
    calculateEllipticalVelocity, 
    calculateHyperbolicPosition, 
    calculateHyperbolicVelocity,
    BezierCurve,
    BezierCurvePoints,
    TimeWarpLUT,
    calculateTimeWarp,
    calculateTimeWarpDerivative,
    getBezierState as getBezierStateCentral,
    getAnalyticalState,
    OrbitalState,
    buildTimeWarpLUT
} from './orbitUtils';

// Re-export common types for backward compatibility and to fix build errors
export { BezierCurve, BezierCurvePoints, TimeWarpLUT };
import { config, hexToNumber } from './config';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, kilograms, ZERO_LENGTH, ZERO_TIME, ZERO_VELOCITY, INFINITE_LENGTH, INFINITE_TIME, cubicKilometersPerSecondSquared, squareKilometersPerSecondSquared, kilometersPerSecond, secondsSquared, gravitationalConstantUnit, formatDistanceWithAstronomicalUnits, formatTime } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3, ZERO_LENGTH_VECTOR3 } from './unitsVector3';

// ============================================================================
// Bezier Curve Classes
// ============================================================================


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
    debugIcon: THREE.Sprite;
    debugText: THREE.Sprite;
    container: THREE.Group;
    lutPoints: THREE.Points;

    // Methods for updating the visual representation
    updateOrbitLine(points: THREE.Vector3[]): void;
    updateBezierLine(points: THREE.Vector3[]): void;
    updateBezierCurves(curves: BezierCurve[]): void;
    updateMarkers(periapsisPos: THREE.Vector3, apoapsisPos: THREE.Vector3, visible: boolean, showApoapsis?: boolean, periDist?: Length, apoDist?: Length): void;
    updateDebugMarker(position: THREE.Vector3 | null, visible: boolean, lines: string[]): void;
    updateLUTMarkers(points: THREE.Vector3[]): void;
    setMarkersVisible(visible: boolean): void;
    setVisibility(show: boolean): void;
    cleanup(): void;
    getContainer(): THREE.Group;
}



export class TrajectoryRenderer implements TrajectoryRender {
    orbitLine: THREE.Line;
    bezierLine: THREE.Line;
    bezierRenderers: BezierCurveRenderer[] = [];
    periapsisIcon: THREE.Sprite;
    periapsisText: THREE.Sprite;
    apoapsisIcon: THREE.Sprite;
    apoapsisText: THREE.Sprite;
    debugIcon: THREE.Sprite;
    debugText: THREE.Sprite;
    container: THREE.Group; // Unified container for visibility
    lutPoints: THREE.Points;

    protected scene: THREE.Scene;
    protected color: number;

    constructor(scene: THREE.Scene, orbitColor: number = 0x00ff00) {
        this.scene = scene;
        this.color = orbitColor;

        this.container = new THREE.Group();
        scene.add(this.container);

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
        this.container.add(this.orbitLine);
        console.log('[DEBUG] Added orbitLine to container');

        // Initialize bezier approximation line (Solid now, to be the main visual)
        const bezierGeometry = new THREE.BufferGeometry();
        this.bezierLine = new THREE.Line(
            bezierGeometry,
            new THREE.LineBasicMaterial({ // Solid line
                color: orbitColor, // Use instance-specific color (from OrbitalBody -> config.bodies)
                opacity: 0.8,
                transparent: true,
                depthTest: true,
                depthWrite: true
            })
        );
        this.container.add(this.bezierLine);
        console.log('[DEBUG] Added bezierLine to container');

        this.container.add(this.bezierLine);
        console.log('[DEBUG] Added bezierLine to container');

        // Initialize markers as Sprites
        // Periapsis - Greenish
        const periColor = 0x00ff00;
        this.periapsisIcon = this.createSprite(this.createIconTexture(periColor, 'Pe'), 0.5);
        this.periapsisText = this.createSprite(this.createTextTexture([''], periColor), 1.0); // Size 1.0 for text

        // Apoapsis - Reddish
        const apoColor = 0xff0000;
        this.apoapsisIcon = this.createSprite(this.createIconTexture(apoColor, 'Ap'), 0.5);
        this.apoapsisText = this.createSprite(this.createTextTexture([''], apoColor), 1.0);

        // scene.add(this.periapsisIcon);
        // scene.add(this.periapsisText);
        // scene.add(this.apoapsisIcon);
        // scene.add(this.apoapsisText);
        // Debug Marker
        const debugColor = 0xffffff;
        this.debugIcon = this.createSprite(this.createIconTexture(debugColor, ''), 0.3);
        this.debugText = this.createSprite(this.createTextTexture([''], debugColor), 1.0);
        this.debugIcon.visible = false;
        this.debugText.visible = false;
        this.container.add(this.debugIcon);
        this.container.add(this.debugText);

        console.log('[DEBUG] Added markers to container');

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
        this.container.add(this.lutPoints);
    }

    protected createSprite(texture: THREE.Texture, scale: number): THREE.Sprite {
        const material = new THREE.SpriteMaterial({
            map: texture,
            sizeAttenuation: false, // Screen space
            depthTest: false, // Always on top
            depthWrite: false // Don't write to depth buffer
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scale * 0.1, scale * 0.1, 1); // Initial scale, will be adjusted
        sprite.renderOrder = 999; // Ensure it renders on top of everything
        return sprite;
    }

    /**
     * Create a circular dot texture for the sprite/points
     */
    protected createDotTexture(color: number): THREE.Texture {
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

    protected createIconTexture(color: number, label: string): THREE.Texture {
        try {
            if (typeof document === 'undefined') return new THREE.Texture();
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Draw a simple filled circle (dot)
                ctx.beginPath();
                ctx.arc(32, 32, 8, 0, 2 * Math.PI); // Reduced radius from 16 to 8 (50% size reduction)
                ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
                ctx.fill();

                // No text inside the marker anymore
            }
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            return texture;
        } catch (e) { return new THREE.Texture(); }
    }

    protected createTextTexture(lines: string[], color: number): THREE.Texture {
        try {
            if (typeof document === 'undefined') return new THREE.Texture();
            const canvas = document.createElement('canvas');
            canvas.width = 320; 
            canvas.height = 160; 
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Reduced font size to 22.5px
                ctx.font = 'bold 27px monospace';
                ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'black';
                ctx.shadowBlur = 4;

                const lineHeight = 36; // Spacing between lines
                const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

                lines.forEach((line, index) => {
                    ctx.fillText(line, 160, startY + index * lineHeight);
                });
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
            const renderer = new BezierCurveRenderer(this.container as any, curve, this.color);
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
        this.periapsisText.position.copy(periapsisPos);
        
        if (visible && periDist) {
            const distStr = formatDistanceWithAstronomicalUnits(periDist, true);
            const newTex = this.createTextTexture(['Pe', distStr], 0x00ff00);
            
            if (this.periapsisText.material.map) this.periapsisText.material.map.dispose();
            this.periapsisText.material.map = newTex;
            this.periapsisText.center.set(0.5, -0.2); 
            this.periapsisText.scale.set(periScale * 4.8, periScale * 2.4, 1);
        }
        this.periapsisText.visible = visible;

        // Update Apoapsis
        this.apoapsisIcon.position.copy(apoapsisPos);
        this.apoapsisIcon.scale.set(periScale, periScale, 1);
        this.apoapsisIcon.visible = visible && showApoapsis;

        this.apoapsisText.position.copy(apoapsisPos);
        if (visible && showApoapsis && apoDist) {
             const distStr = formatDistanceWithAstronomicalUnits(apoDist, true);
            const newTex = this.createTextTexture(['Ap', distStr], 0xff0000);
            
            if (this.apoapsisText.material.map) this.apoapsisText.material.map.dispose();
            this.apoapsisText.material.map = newTex;
            this.apoapsisText.scale.set(periScale * 4.8, periScale * 2.4, 1);
            this.apoapsisText.center.set(0.5, -0.2);
        }
        this.apoapsisText.visible = visible && showApoapsis;
    }

    updateDebugMarker(position: THREE.Vector3 | null, visible: boolean, lines: string[] = []): void {
        if (!position || !visible) {
            this.debugIcon.visible = false;
            this.debugText.visible = false;
            return;
        }

        const scale = 0.05;
        this.debugIcon.position.copy(position);
        this.debugIcon.scale.set(scale * 0.6, scale * 0.6, 1);
        this.debugIcon.visible = true;

        this.debugText.position.copy(position);
        this.debugText.visible = true;

        const newTex = this.createTextTexture(lines, 0xffffff);
        
        if (this.debugText.material.map) this.debugText.material.map.dispose();
        this.debugText.material.map = newTex;
        this.debugText.center.set(0.5, -0.2); 
        this.debugText.scale.set(scale * 4.8, scale * 2.4, 1);
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

    getContainer(): THREE.Group {
        return this.container;
    }

    setVisibility(show: boolean): void {
        this.container.visible = show;
        this.orbitLine.visible = false; 
        this.lutPoints.visible = show && config.visualization.showLUT;
    }

    cleanup(): void {
        console.log('[DEBUG] TrajectoryRenderer.cleanup() called');

        this.orbitLine.visible = false;
        this.bezierLine.visible = false;
        this.periapsisIcon.visible = false;
        this.periapsisText.visible = false;
        this.apoapsisIcon.visible = false;
        this.apoapsisText.visible = false;
        this.debugIcon.visible = false;
        this.debugText.visible = false;

        this.bezierRenderers.forEach(renderer => renderer.cleanup());
        this.bezierRenderers = [];

        [
            this.orbitLine,
            this.bezierLine,
            this.periapsisIcon,
            this.periapsisText,
            this.apoapsisIcon,
            this.apoapsisText,
            this.debugIcon,
            this.debugText,
            this.lutPoints
        ].forEach(obj => {
            if (obj.parent === this.container) this.container.remove(obj);
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points || obj instanceof THREE.Sprite) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                    if ((obj.material as any).map) (obj.material as any).map.dispose();
                }
            }
        });

        if (this.container.parent === this.scene) {
            this.scene.remove(this.container);
        }

        console.log('[DEBUG] TrajectoryRenderer.cleanup() completed');
    }
}



// ============================================================================
// Trajectory Parameters and Type
// ============================================================================

export interface TrajectoryParameters {
    rp: Length;
    ra: Length;
    a: Length;
    _a: Length;        // semi-major axis
    e: number;        // eccentricity (dimensionless)
    mu: number;       // gravitational parameter value
    period: Time;   // orbital period
    _h: LengthVector3; // angular momentum vector (length vector3)
    _eVec: LengthVector3; // eccentricity vector (length vector3)
}

export type TrajectoryType = 'elliptical' | 'hyperbolic' | 'parabolic';


/**
 * Trajectory class that consolidates all data required to represent and render an orbital trajectory
 */
export class Trajectory {
    protected _scene: THREE.Scene;              // Protected - use underscore prefix
    protected _renderer: TrajectoryRender; // Changed type to TrajectoryRender
    public type: TrajectoryType;
    protected _analyticalPoints: THREE.Vector3[] = [];  // Protected - use underscore prefix
    protected _bezierPoints: { position: THREE.Vector3, t: number, simulationTime?: number }[] = [];      // Protected - use underscore prefix
    protected _bezierCurves: any[] = [];               // Protected - use underscore prefix
    protected _periapsisPoint?: LengthVector3;         // Protected - use underscore prefix
    protected _apoapsisPoint?: LengthVector3;          // Protected - use underscore prefix
    public parameters: TrajectoryParameters;
    protected _color: number;                    // Protected - use underscore prefix
    public periapsis: Length = ZERO_LENGTH;
    public apoapsis: Length = ZERO_LENGTH;
    protected _initialVelocityMagnitude: Velocity = ZERO_VELOCITY;

    protected _useBezierEstimation: boolean = true;
    protected _timeWarpLUT: TimeWarpLUT | null = null;
    protected _cachedOrbitBasis: OrbitBasis | null = null;
    protected _startTime: number = 0;
    protected _initialPosition: THREE.Vector3 = new THREE.Vector3();
    protected _initialVelocity: THREE.Vector3 = new THREE.Vector3();
    protected _centralBodyMass: number = 0;
    protected _endTime: number | null = null;
    protected _debugMarkerEnabled: boolean = false; // Disabled by default
    protected _lastDebugPosition: THREE.Vector3 | null = null;
    private _timeWarpFunction: ((t: number) => number) | null = null;
    private _markersVisible: boolean = true;
    protected _isClosedLoop: boolean = true;

    constructor(scene: THREE.Scene, color: number = 0xff6666) {
        this._scene = scene;
        this._color = color;
        this._renderer = this.createRenderer();
        this.type = 'elliptical';
        this.parameters = {
            rp: ZERO_LENGTH,
            ra: ZERO_LENGTH,
            a: ZERO_LENGTH,
            _a: ZERO_LENGTH,
            e: 0,
            mu: 0,
            period: ZERO_TIME,
            _h: ZERO_LENGTH_VECTOR3,
            _eVec: ZERO_LENGTH_VECTOR3
        };
    }

    protected createRenderer(): TrajectoryRender {
        return new TrajectoryRenderer(this._scene, this._color);
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        if (this._renderer) {
            this._renderer.cleanup();
        }
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
     * Enable or disable the debug marker (white dot and time label)
     */
    setDebugMarkerEnabled(enabled: boolean): void {
        this._debugMarkerEnabled = enabled;
        if (!enabled && this._renderer) {
            this._renderer.updateDebugMarker(null, false, []);
        }
    }

    /**
     * Update trajectory state and debugging annotations
     */
    update(currentTime: number): void {
        // Tighten isActive logic: must be strictly within the time window if _endTime is provided
        const isFuture = currentTime < this._startTime;
        const isPast = this._endTime !== null && currentTime > this._endTime;
        const isInWindow = !isFuture && !isPast;
        
        // Render debug marker ONLY if enabled and within active window
        if (this._debugMarkerEnabled && isInWindow) {
            const pos = this.getPosition(currentTime);
            
            if (pos && this._renderer) {
                this._lastDebugPosition = pos.clone();
                const lines = this.getDebugLines(currentTime);
                this._renderer.updateDebugMarker(pos, true, lines);
            }
        } else if (this._renderer) {
            this._lastDebugPosition = null;
            // Ensure hidden if not enabled or out of window
            this._renderer.updateDebugMarker(null, false, []);
        }
    }

    /**
     * Get lines for the debug annotation sprite
     */
    protected getDebugLines(currentTime: number): string[] {
        const timeOffset = currentTime - this._startTime;
        const prefix = timeOffset < 0 ? 'T-' : 'T+';
        return [`${prefix} ${formatTime(Measure.of(Math.abs(timeOffset), seconds), true)}`];
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
        this._renderer = this.createRenderer();

        // Get position and velocity magnitudes as Length and Velocity
        const r = position.length(); // Length
        const v = velocity.length(); // Velocity

        // Update current initial velocity (now with units)
        this._initialVelocityMagnitude = v;

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
                rp: Measure.of(aValue * (1 - e), kilometers),
                ra: Measure.of(aValue * (1 + e), kilometers),
                a: a,
                _a: a,
                e: e,
                mu: muValue,
                period: period,
                _h: hVec,
                _eVec: referenceVec
            };

            // Update periapsis and apoapsis for elliptical orbits (with units)
            const periapsisValue = aValue * (1 - e);
            const apoapsisValue = aValue * (1 + e);
            this.periapsis = Measure.of(periapsisValue, kilometers);
            this.apoapsis = Measure.of(apoapsisValue, kilometers);

            // Update visualization - render ONLY bezier approximation for main orbit line if possible? 
            // No, renderer.updateOrbitLine takes Vector3[]. We'll pass the analytical points for the PREVIEW 
            // but the actual class state lookups use Bezier.
            const initialBezierPositions = bezierResult.points.map(p => p.position);
            this._renderer.updateOrbitLine(ellipsePoints);
            this._renderer.updateBezierLine(initialBezierPositions);
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
            // Map Vector3[] to { position, t }[] with dummy t=0 for now as hyperbolic doesn't use the t-based insertion yet
            this._bezierPoints = bezierResult.points.map(p => ({ position: p, t: 0 }));
            this._bezierCurves = bezierResult.curves;
            // Convert to LengthVector3
            this._periapsisPoint = MeasureVector3.fromVector3<Length>(periapsisPoint, kilometers);
            this._apoapsisPoint = undefined;

            // Store parameters with units
            this.parameters = {
                rp: Measure.of(Math.abs(aValue) * (e - 1), kilometers),
                ra: INFINITE_LENGTH,
                a: a,
                _a: a,
                e: e,
                mu: muValue,
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
            // Points are already Vector3[] in bezierResult (hyperbolic version)
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
                rp: Measure.of(hVec.length().over(kilometers).value ** 2 / (2 * muValue), kilometers), // simplified p/2
                ra: INFINITE_LENGTH,
                a: INFINITE_LENGTH,
                _a: ZERO_LENGTH,
                e: 1,
                mu: muValue,
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
     * Update the orbit visualization with the current position inserted dynamically
     * @param currentT Current normalized time (0-1)
     * @param currentPos Current position vector
     */
    /**
     * Update the orbit visualization with the current position inserted dynamically
     * @param currentTime Current simulation time
     * @param currentPos Current position vector
     */
    updateOrbitVisualization(currentTime: number, currentPos: THREE.Vector3): void {
        if (!this._renderer || this._bezierPoints.length === 0) return;

        // Calculate normalized time T from simulation time
        const currentT = this.getBezierT(currentTime);

        // High-density sampling parameters
        // Base density is 128 points. 4x density means step size is (1/128)/4
        const baseStep = 1.0 / 128.0;
        const highDefStep = baseStep / 4.0;

        // Collect dynamic points to insert (current + 3 before + 3 after)
        const dynamicPoints: { position: THREE.Vector3, t: number }[] = [];

        // Add current position
        dynamicPoints.push({ position: currentPos, t: currentT });

        // Add 3 points before and 3 after
        for (let i = 1; i <= 3; i++) {
            // Before
            let tBefore = currentT - i * highDefStep;
            // Wrap t to 0-1 for sorting
            if (tBefore < 0) tBefore += 1.0;
            const posBefore = this.getPointFromCurves(tBefore);
            if (posBefore) dynamicPoints.push({ position: posBefore, t: tBefore });

            // After
            let tAfter = currentT + i * highDefStep;
            // Wrap t to 0-1
            if (tAfter >= 1.0) tAfter -= 1.0;
            const posAfter = this.getPointFromCurves(tAfter);
            if (posAfter) dynamicPoints.push({ position: posAfter, t: tAfter });
        }

        // Sort dynamic points by t to simplify insertion
        dynamicPoints.sort((a, b) => a.t - b.t);

        // Create a new array of points for rendering
        const renderPoints: THREE.Vector3[] = [];

        // Iterate through pre-calculated points and merge with dynamic points
        let dynamicIdx = 0;

        for (let i = 0; i < this._bezierPoints.length; i++) {
            const point = this._bezierPoints[i];

            // Insert any dynamic points that come before this static point
            while (dynamicIdx < dynamicPoints.length) {
                const dynPoint = dynamicPoints[dynamicIdx];
                if (dynPoint.t < point.t) {
                    renderPoints.push(dynPoint.position);
                    dynamicIdx++;
                } else {
                    break;
                }
            }

            renderPoints.push(point.position);
        }

        // Append any remaining dynamic points (those after the last static point)
        while (dynamicIdx < dynamicPoints.length) {
            renderPoints.push(dynamicPoints[dynamicIdx].position);
            dynamicIdx++;
        }

        // Close the loop for elliptical orbits (connect updated list back to start)
        if (this.type === 'elliptical' && this._isClosedLoop && this._bezierPoints.length > 0) {
            // Usually start point is at t=0, so it's already in the list.
            // But we want a visually closed loop. 
            // Three.js Line doesn't close automatically unless it's LineLoop.
            // We can append the first point (which is t=0) to the end.
            renderPoints.push(this._bezierPoints[0].position);
        }

        this._renderer.updateBezierLine(renderPoints);
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
        this._initialVelocityMagnitude = ZERO_VELOCITY;
    }

    /**
     * Update current state (deprecated/no-op after removing internal altitude/velocity properties)
     */
    updateCurrentState(position: LengthVector3, velocity: VelocityVector3): void {
        // No longer store instantaneous altitude/velocity directly on trajectory
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
     * Get bezier points (positions only for compatibility)
     */
    getBezierPoints(): THREE.Vector3[] {
        return this._bezierPoints.map(p => p.position);
    }

    /**
     * Get bezier data (positions and t values)
     */
    getBezierData(): { position: THREE.Vector3, t: number }[] {
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
     * Get the current debug position (white dot) if visible
     */
    getDebugPosition(): THREE.Vector3 | null {
        return this._lastDebugPosition ? this._lastDebugPosition.clone() : null;
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
        const { _a, e } = this.parameters;
        const semiMajorAxis = _a.over(kilometers).value;
        const bezierCurves = this._bezierCurves;

        if (!bezierCurves || bezierCurves.length === 0) return;

        this._cachedOrbitBasis = calculateOrbitBasis(this._initialPosition, this._initialVelocity, centralBodyMass);
        
        this._timeWarpLUT = buildTimeWarpLUT(
            centralBodyMass,
            this._initialPosition,
            this._initialVelocity,
            semiMajorAxis,
            e,
            this._bezierCurves,
            this._cachedOrbitBasis
        );
        
        // Visualize LUT samples
        const samplePositions: THREE.Vector3[] = [];
        this._timeWarpLUT.M.forEach((m_apo, idx) => {
            const M_std = m_apo * 2 * Math.PI + Math.PI;
            const M_std_norm = M_std / (2 * Math.PI);
            const pos = calculateEllipticalPositionFromBasis(M_std, semiMajorAxis, e, this._cachedOrbitBasis!.periapsisDir, this._cachedOrbitBasis!.perpDir);
            samplePositions.push(pos);
        });

        this._renderer.updateLUTMarkers(samplePositions);
    }

    public getPointFromCurves(t: number): THREE.Vector3 | null {
        const numCurves = this._bezierCurves.length;
        if (numCurves === 0) return null;
        const totalProgress = t * numCurves;
        const normalizedTotal = totalProgress - Math.floor(totalProgress);
        let curveIndex = Math.floor(totalProgress) % numCurves;
        if (curveIndex < 0) curveIndex += numCurves;
        return this._bezierCurves[curveIndex].getPoint(normalizedTotal);
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

    private _interpolationMode: 'linear' | 'cubic' = 'cubic';

    public setInterpolationMode(mode: 'linear' | 'cubic'): void {
        this._interpolationMode = mode;
    }

    private timeWarpFunction(t: number): number {
        if (this._timeWarpFunction) return this._timeWarpFunction(t);
        if (!this._timeWarpLUT) return t;
        return calculateTimeWarp(t, this._timeWarpLUT, this._interpolationMode);
    }

    /**
     * Calculate the derivative of the time warp function dt/dM at a given normalized time M (relative to Apoapsis)
     */
    private getTimeWarpDerivative(t: number): number {
        if (!this._timeWarpLUT) return 1.0;
        return calculateTimeWarpDerivative(t, this._timeWarpLUT, this._interpolationMode);
    }

    public getBezierVelocity(time: number): THREE.Vector3 | null {
        const res = this.getBezierState(time, { calcVelocity: true });
        return res.velocity;
    }

    /**
     * Get both position and optional velocity in a single efficient call
     * Reuses the expensive Time Warp LUT lookup
     */
    public getBezierState(time: number, options: { calcVelocity: boolean } = { calcVelocity: true }): { position: THREE.Vector3 | null, velocity: THREE.Vector3 | null } {
        if (!this._useBezierEstimation || !this._timeWarpLUT || !this._cachedOrbitBasis || !this.parameters.period) {
            return { position: null, velocity: null };
        }

        return getBezierStateCentral(
            time,
            this._startTime,
            this.parameters.period.over(seconds).value,
            this._cachedOrbitBasis,
            this._timeWarpLUT,
            this._bezierCurves,
            { ...options, interpolationMode: this._interpolationMode }
        );
    }

    /**
     * Get position at a specific time
     * @param time Time in seconds
     */
    getPosition(time: number): THREE.Vector3 | null {
        if (this.type === 'parabolic') return null;

        const res = this.getBezierState(time, { calcVelocity: false });
        return res.position;
    }

    /**
     * Get velocity at a specific time
     * @param time Time in seconds
     */
    getVelocity(time: number): THREE.Vector3 | null {
        if (this.type === 'parabolic') return null;

        const res = this.getBezierState(time, { calcVelocity: true });
        return res.velocity;
    }


    /**
     * Get the bezier parameter t (0-1 relative to Apoapsis) for a specific time
     * Handles Mean Anomaly offset and time warping
     */
    getBezierT(time: number): number {
        const linearT = this.getLinearNormalizedTime(time);
        return this.timeWarpFunction(linearT);
    }

    /**
     * Get the linear normalized time (0-1 relative to Apoapsis) for a specific time
     * Handles Mean Anomaly offset (M0)
     */
    getLinearNormalizedTime(time: number): number {
        if (!this._cachedOrbitBasis || !this.parameters.period) return 0;

        const p = this.parameters.period.over(seconds).value;
        if (p === 0) return 0;

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
        return (M_wrapped_peri + 0.5) % 1.0;
    }

    /**
     * Get the time warp function
     */
    public getTimeWarpFunction(): (t: number) => number {
        return this.timeWarpFunction.bind(this);
    }

    /**
     * Get static trail points from the pre-computed bezier points
     * Returns 'count' points preceding 'currentTime', handling wrap-around
     * Returns points in order: [oldest, ..., newest] (closest to currentTime)
     * @param currentTime Current simulation time
     * @param count Number of points to return
     */
    getStaticTrailPoints(currentTime: number, count: number): THREE.Vector3[] {
        if (this._bezierPoints.length === 0) return [];
        
        // Calculate normalized time T from simulation time
        const currentT = this.getBezierT(currentTime);

        // Find the index of the point immediately preceding or equal to currentT
        // _bezierPoints is sorted by t
        // We can do a simple linear scan or finding the last point where t <= currentT

        let endIndex = -1;
        // Optimization: since points are sorted, we can search
        // Check if we need to wrap around initially (e.g. t=0.01 but points start at 0.0)
        // Actually, just find the largest t <= currentT

        // Linear scan backwards from end might be faster if currentT is near 1, 
        // but forward is standard. Given 128 points, linear is fine.

        for (let i = this._bezierPoints.length - 1; i >= 0; i--) {
            if (this._bezierPoints[i].t <= currentT) {
                endIndex = i;
                break;
            }
        }

        // If not found (currentT < all points), wrap to the end
        if (endIndex === -1) {
            endIndex = this._bezierPoints.length - 1;
        }

        const result: THREE.Vector3[] = [];
        const len = this._bezierPoints.length;

        // Collect 'count' points backwards from endIndex
        for (let i = 0; i < count; i++) {
            // Index calculation with wrap-around
            // let idx = (endIndex - i) % len; // JS % operator handles negatives poorly (-1 % 5 = -1)
            let idx = endIndex - i;
            while (idx < 0) idx += len;

            result.push(this._bezierPoints[idx].position);
        }

        // Result is currently [newest, ..., oldest]
        // We want [oldest, ..., newest]
        return result.reverse();
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
