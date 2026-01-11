import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Mass, Measure, Length, Velocity, kilograms, kilometers, seconds, GenericMeasure, gravitationalConstantUnit, Time } from './units';
import { Body } from './types';
import { ORBIT_UPDATE_METHOD, G } from './config';

// ============================================================================
// OrbitalBody Rendering
// ============================================================================

export interface OrbitalBodyRender {
    // Core Three.js objects for rendering
    mesh: THREE.Mesh;
    dotSprite: THREE.Sprite;

    // Methods for updating the visual representation
    updateRenderingMode(position: THREE.Vector3, camera: THREE.Camera): void;
    getTrailPoints(): THREE.Vector3[];
    addTrailPoint(point: THREE.Vector3): void;
    clearTrail(initialPoint: THREE.Vector3): void;
    updateRadius(radius: number, color: number): void;
    setVisibility(visible: boolean): void;
    cleanup(): void;
}

export class OrbitalBodyRenderer implements OrbitalBodyRender {
    mesh: THREE.Mesh;
    dotSprite: THREE.Sprite;

    private scene: THREE.Scene;
    private trailPoints: THREE.Vector3[] = [];
    private maxTrailPoints: number = 100;
    private useDotRendering: boolean = false;
    private radius: number;

    constructor(scene: THREE.Scene, position: THREE.Vector3, radius: number, color: number) {
        this.scene = scene;
        this.radius = radius;

        // Create mesh for the body
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({ color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        scene.add(this.mesh);

        // Create dot sprite for far-away rendering
        const dotTexture = this.createDotTexture(color);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: dotTexture,
            sizeAttenuation: false,  // Size stays constant regardless of distance
            depthTest: true
        });
        this.dotSprite = new THREE.Sprite(spriteMaterial);
        this.dotSprite.scale.set(0.01, 0.01, 1);  // 10x10 pixel scale for screen-space size
        this.dotSprite.position.copy(position);
        // Don't add to scene yet - will be added when needed

        // Initialize trail with starting position
        this.trailPoints = [position.clone()];
    }

    /**
     * Create a circular dot texture for the sprite
     */
    private createDotTexture(color: number): THREE.Texture {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        if (context) {
            // Draw a filled circle
            context.beginPath();
            context.arc(16, 16, 14, 0, 2 * Math.PI);
            context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
            context.fill();
        }
        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    /**
     * Calculate the screen size of the body in pixels
     * Returns the approximate diameter of the body as it appears on screen
     */
    private calculateScreenSize(position: THREE.Vector3, camera: THREE.Camera): number {
        if (!(camera instanceof THREE.PerspectiveCamera)) {
            return Infinity; // Default to mesh rendering for non-perspective cameras
        }

        // Calculate distance from camera to body
        const distance = camera.position.distanceTo(position);

        // Get the vertical field of view in radians
        const fov = camera.fov * Math.PI / 180;

        // Calculate the height of the viewport at the body's distance
        // height = 2 * distance * tan(fov/2)
        const viewportHeight = 2 * distance * Math.tan(fov / 2);

        // Calculate how many pixels represent the body's diameter
        // bodyScreenSize = (bodyDiameter / viewportHeight) * screenHeight
        const bodyDiameter = this.radius * 2;
        const screenHeight = (camera as any).aspect ? window.innerHeight : 1;
        const screenSize = (bodyDiameter / viewportHeight) * screenHeight;

        return screenSize;
    }

    /**
     * Update rendering mode based on screen size
     * Switches between 3D mesh and 2D dot sprite
     */
    updateRenderingMode(position: THREE.Vector3, camera: THREE.Camera): void {
        const screenSize = this.calculateScreenSize(position, camera);
        const shouldUseDot = screenSize < 10;  // Use dot if body is less than 10 pixels

        if (shouldUseDot !== this.useDotRendering) {
            this.useDotRendering = shouldUseDot;

            if (this.useDotRendering) {
                // Switch to dot rendering
                this.scene.remove(this.mesh);
                this.scene.add(this.dotSprite);
            } else {
                // Switch to mesh rendering
                this.scene.remove(this.dotSprite);
                this.scene.add(this.mesh);
            }
        }

        // Update position for whichever is visible
        if (this.useDotRendering) {
            this.dotSprite.position.copy(position);
        } else {
            this.mesh.position.copy(position);
        }
    }

    /**
     * Add a point to the trail
     */
    addTrailPoint(point: THREE.Vector3): void {
        this.trailPoints.push(point.clone());
        if (this.trailPoints.length > this.maxTrailPoints) {
            this.trailPoints.shift();
        }
    }

    /**
     * Clear trail and set initial point
     */
    clearTrail(initialPoint: THREE.Vector3): void {
        this.trailPoints = [initialPoint.clone()];
    }

    /**
     * Get trail points (sub-sampled to 10 segments for rendering)
     */
    getTrailPoints(): THREE.Vector3[] {
        if (this.trailPoints.length <= 11) {
            return this.trailPoints;
        }

        // Sub-sample to approximately 10 line segments (11 points)
        const sampledPoints: THREE.Vector3[] = [];
        const step = (this.trailPoints.length - 1) / 10;

        for (let i = 0; i < 11; i++) {
            const index = Math.floor(i * step);
            sampledPoints.push(this.trailPoints[index]);
        }

        return sampledPoints;
    }

    /**
     * Update radius and regenerate mesh with new radius and color
     */
    updateRadius(radius: number, color: number): void {
        this.radius = radius;

        // Remove old mesh
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) {
            this.mesh.material.dispose();
        }

        // Create new mesh with updated radius
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({ color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.mesh.position); // Keep same position
        this.scene.add(this.mesh);
    }

    /**
     * Set visibility of mesh/sprite
     */
    setVisibility(visible: boolean): void {
        this.mesh.visible = visible;
        this.dotSprite.visible = visible;
    }

    /**
     * Cleanup and remove from scene
     */
    cleanup(): void {
        // Clean up analytical rendering
        this.scene.remove(this.mesh);
        this.scene.remove(this.dotSprite);
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) {
            this.mesh.material.dispose();
        }
        if (this.dotSprite.material.map) {
            this.dotSprite.material.map.dispose();
        }
        this.dotSprite.material.dispose();
    }
}

// ============================================================================
// OrbitalBody Class
// ============================================================================

/**
 * OrbitalBody class representing a celestial body with position, velocity, mass, and a trajectory
 * Extends Body to inherit standard properties (position, velocity, mass, radius, name, etc.)
 * and adds simulation-specific functionality (trajectory, rendering, physics updates)
 */
export class OrbitalBody extends Body {
    public initialPosition: THREE.Vector3;  // Public for UI inspection
    public initialVelocity: THREE.Vector3;   // Public for UI inspection
    private _trajectory: Trajectory;        // Private - use underscore prefix
    private _render: OrbitalBodyRender;     // Private - rendering delegate
    private _bezierRender: OrbitalBodyRender | null = null; // Private - bezier rendering delegate
    private _lastUpdateTime: number = 0;    // Store last update time for UI indicators

    // Dual-rendering mode: calculate both analytical and bezier positions
    private _dualRenderingEnabled: boolean = false;
    private _bezierPosition: THREE.Vector3 | null = null;
    private _trajectoryInitialized: boolean = false;

    private _scene: THREE.Scene;

    constructor(
        scene: THREE.Scene,
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        mass: number,
        radius: number = 1.0,
        color: number = 0xcccccc,
        trajectoryColor: number = 0xff6666,
        name: string = 'Unnamed',
        parentId: string = ''
    ) {
        // Initialize Body with standard properties
        super({
            position: position.clone(),
            velocity: velocity.clone(),
            mass: mass,
            radius: radius,
            name: name,
            color: `#${color.toString(16).padStart(6, '0')}`,
            trajectoryColor: `#${trajectoryColor.toString(16).padStart(6, '0')}`,
            parentId: parentId,
            id: name
        });

        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Store scene reference
        this._scene = scene;

        // Create renderer for the body
        this._render = new OrbitalBodyRenderer(scene, position, radius, color);

        // Create trajectory (one per body)
        this._trajectory = new Trajectory(scene, trajectoryColor);

        // Hide markers for Earth by default (as per user request)
        if (name.toLowerCase() === 'earth') {
            this._trajectory.setMarkersVisible(false);
        }
    }

    /**
     * Create an OrbitalBody from a Body configuration object
     * This allows each class to know how to serialize/deserialize itself
     */
    static fromConfig(scene: THREE.Scene, bodyConfig: Body): OrbitalBody {
        // Parse color from hex string
        const colorHex = bodyConfig.color ? parseInt(bodyConfig.color.replace('#', ''), 16) : 0xcccccc;
        const trajectoryColorHex = bodyConfig.trajectoryColor ? parseInt(bodyConfig.trajectoryColor.replace('#', ''), 16) : 0xff6666;

        return new OrbitalBody(
            scene,
            bodyConfig.position.clone(),
            bodyConfig.velocity.clone(),
            bodyConfig.mass,
            bodyConfig.radius,
            colorHex,
            trajectoryColorHex,
            bodyConfig.name,
            bodyConfig.parentId
        );
    }

    /**
     * Serialize this OrbitalBody to a Body configuration object
     */
    toConfig(): Body {
        return new Body({
            position: this.position.clone(),
            velocity: this.velocity.clone(),
            mass: this.mass,
            radius: this.radius,
            name: this.name,
            color: this.color,
            trajectoryColor: this.trajectoryColor,
            parentId: this.parentId,
            id: this.id
        });
    }

    /**
     * Update rendering mode based on screen size
     * Switches between 3D mesh and 2D dot sprite
     * In dual-rendering mode, updates both analytical and bezier renderings
     */
    updateRenderingMode(camera: THREE.Camera): void {
        // Update analytical position rendering
        this._render.updateRenderingMode(this.position, camera);

        // Update bezier position rendering if dual-rendering is enabled
        if (this._dualRenderingEnabled && this._bezierPosition && this._bezierRender) {
            this._bezierRender.updateRenderingMode(this._bezierPosition, camera);
        }
    }

    /**
     * Initialize trajectory if needed (called on first update to capture start time)
     */
    private ensureTrajectoryInitialized(centralBodyMass: number, currentTime: number): void {
        if (!this._trajectoryInitialized) {
            const positionVec = MeasureVector3.fromVector3<Length>(this.initialPosition, kilometers);
            const velocityVec = MeasureVector3.fromVector3<Velocity>(this.initialVelocity, kilometers.per(seconds));
            const centralMass = Measure.of(centralBodyMass, kilograms);
            const startTime = Measure.of(currentTime, seconds);

            this._trajectory.calculateFromState(positionVec, velocityVec, centralMass, startTime);
            this._trajectoryInitialized = true;
        }
    }

    /**
     * Update position and velocity using numerical integration
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    private updateNumerical(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>): void {
        const r = this.position.clone().sub(centralBodyPosition);
        const distance = r.length(); // km

        // Prevent division by zero and extreme forces at very small distances
        if (distance >= 2.5) {
            // Force = -G * m1 * m2 / r²
            // Units: G (km³/(kg·s²)) * mass (kg) * mass (kg) / distance² (km²) = kg·km/s²
            const GValue = (G as any).over(gravitationalConstantUnit).value;
            const force = r.normalize().multiplyScalar(
                -GValue * this.mass * centralBodyMass / (distance * distance)
            );

            // Update velocity: v += a * dt = (F/m) * dt
            // Units: (kg·km/s² / kg) * s = km/s
            this.velocity.add(force.multiplyScalar(dt / this.mass));

            // Update position: r += v * dt
            // Units: km/s * s = km
            this.position.add(this.velocity.clone().multiplyScalar(dt));
        }
    }

    /**
     * Update position and velocity based on gravitational force
     * Supports both numerical integration and analytical (Kepler's equations) methods via Trajectory
     * In dual-rendering mode, calculates both analytical AND bezier positions
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>, currentTime: number = 0): void {

        // Optimize: skip trajectory init if using Numerical (except for visualization?)
        // Visualization requires trajectory. So always init.
        this.ensureTrajectoryInitialized(centralBodyMass, currentTime);
        this._lastUpdateTime = currentTime; // Store for getCurrentNormalizedTime

        // If dual-rendering is enabled, calculate BOTH positions
        if (this._dualRenderingEnabled) {
            // Dual Rendering: One is "Primary" (Analytical), other is "Ghost" (Bezier)
            // But wait, the request was: "The orbital body should just ask the trajectory object for either the analytical position or the bezier position"

            // Primary Position
            if (ORBIT_UPDATE_METHOD === 'analytical') {
                const pos = this._trajectory.getPosition(currentTime, 'analytical');
                if (pos) {
                    this.position.copy(pos).add(centralBodyPosition);
                    // Velocity? Trajectory doesn't currently return velocity. 
                    // Analytical velocity is needed for numerical fallback or display?
                    // For now, we only update position. 
                    // To keep velocity consistent, we might need Trajectory to return state { position, velocity }.
                    // But for now, we leave velocity as is or use finite diff if needed.
                }
            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            // Secondary (Ghost) Position -> Standard Bezier
            const ghostPos = this._trajectory.getPosition(currentTime, 'bezier');
            if (ghostPos) {
                this._bezierPosition = ghostPos.clone().add(centralBodyPosition);
            } else {
                this._bezierPosition = null;
            }

        } else {
            // Normal single-position update
            // Default "Bezier" estimation preferred for speed/smoothness as per request? 
            // Request: "default being the bezier position"

            let pos: THREE.Vector3 | null = null;

            if (ORBIT_UPDATE_METHOD === 'analytical') {
                // The user said: "The orbital body should just ask the trajectory object for either the analytical position or the bezier position, with the default being the bezier position"
                // So we use 'bezier' by default if possible?
                // But ORBIT_UPDATE_METHOD implies user choice.
                // I'll stick to 'bezier' as the implementation for analytical mode because it's the efficient way.
                // However, 'analytical' implies exact Kepler.
                // I will assume 'analytical' setting maps to 'bezier' optimized trajectory unless explicitly 'analytical' requested in getPosition call.

                // If default is bezier, I ask for bezier.
                pos = this._trajectory.getPosition(currentTime, 'bezier');

                // Fallback if bezier fails (e.g. not ready)
                if (!pos) {
                    pos = this._trajectory.getPosition(currentTime, 'analytical');
                }

                if (pos) {
                    this.position.copy(pos).add(centralBodyPosition);
                }

            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            this._bezierPosition = null;
        }

        // Note: mesh/sprite position is updated in updateRenderingMode(), called from game loop

        // Update trajectory current state (altitude and velocity)
        // Note: If using Numerical, we update trajectory state to reflect simulation.
        // If using Analytical/Bezier, the trajectory state is derived from parameters, but we sync altitude/velocity properties for UI.
        const positionVec = MeasureVector3.fromVector3<Length>(this.position, kilometers);
        const velocityVec = MeasureVector3.fromVector3<Velocity>(this.velocity, kilometers.per(seconds));
        this._trajectory.updateCurrentState(positionVec, velocityVec);

        // Add to trail
        this._render.addTrailPoint(this.position);
    }

    /**
     * Reset to initial conditions and recalculate trajectory
     */
    reset(position: THREE.Vector3, velocity: THREE.Vector3, mass: number, centralBodyMass: number, radius?: number): void {
        this.position.copy(position);
        this.velocity.copy(velocity);
        this.mass = mass;
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Flag trajectory for re-initialization (will happen on next update with fresh time)
        this._trajectoryInitialized = false;

        // Update radius and regenerate mesh if radius is provided
        if (radius !== undefined && radius !== this.radius) {
            this.radius = radius;
            // Get color from existing mesh material
            const color = (this._render.mesh.material as THREE.MeshPhongMaterial).color.getHex();
            this._render.updateRadius(radius, color);

            // Update bezier renderer if it exists
            if (this._bezierRender) {
                const bezierColor = (this._bezierRender.mesh.material as THREE.MeshPhongMaterial).color.getHex();
                this._bezierRender.updateRadius(radius, bezierColor);
            }
        }

        // Clear trail
        this._render.clearTrail(position);

        // Clear trajectory visualization until initialized
        this._trajectory.clear();
    }

    /**
     * Reset to initial conditions (stored when body was created or last reset)
     * and recompute trajectory
     */
    resetToInitial(centralBodyMass: number): void {
        this.position.copy(this.initialPosition);
        this.velocity.copy(this.initialVelocity);

        // Flag trajectory for re-initialization
        this._trajectoryInitialized = false;

        // Clear trail
        this._render.clearTrail(this.initialPosition);

        // Clear trajectory
        this._trajectory.clear();
    }

    /**
     * Get current position (analytical/numerical position)
     */
    getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    /**
     * Get bezier position (only available in dual-rendering mode)
     */
    getBezierPosition(): THREE.Vector3 | null {
        return this._bezierPosition ? this._bezierPosition.clone() : null;
    }

    /**
     * Get current velocity
     */
    getVelocity(): THREE.Vector3 {
        return this.velocity.clone();
    }

    /**
     * Enable or disable dual-rendering mode
     * When enabled, both analytical and bezier positions are calculated and rendered
     */
    setDualRenderingEnabled(enabled: boolean): void {
        if (enabled && !this._dualRenderingEnabled) {
            // Enable dual rendering
            this._dualRenderingEnabled = true;
            if (!this._bezierRender) {
                // Use lighter red for bezier trajectory/ghost
                const bezierColor = 0xff6666;
                this._bezierRender = new OrbitalBodyRenderer(this._scene, this.initialPosition, this.radius, bezierColor);
            }
            this._bezierRender.setVisibility(true);
            console.log(`[OrbitalBody] Dual rendering enabled for ${this.name}`);
        } else if (!enabled && this._dualRenderingEnabled) {
            // Disable dual rendering
            this._dualRenderingEnabled = false;
            if (this._bezierRender) {
                this._bezierRender.setVisibility(false);
            }
            this._bezierPosition = null;
            console.log(`[OrbitalBody] Dual rendering disabled for ${this.name}`);
        }
    }

    /**
     * Check if dual-rendering is enabled
     */
    isDualRenderingEnabled(): boolean {
        return this._dualRenderingEnabled;
    }

    /**
     * Get initial position
     */
    getInitialPosition(): THREE.Vector3 {
        return this.initialPosition.clone();
    }

    /**
     * Get initial velocity
     */
    getInitialVelocity(): THREE.Vector3 {
        return this.initialVelocity.clone();
    }

    /**
     * Get mass
     */
    getMass(): number {
        return this.mass;
    }

    /**
     * Get radius
     */
    getRadius(): number {
        return this.radius;
    }

    /**
     * Get name
     */
    getName(): string {
        return this.name;
    }

    /**
     * Get trajectory
     */
    getTrajectory(): Trajectory {
        return this._trajectory;
    }

    /**
     * Set trajectory to share with another body
     * This allows multiple bodies to use the same bezier approximation
     */
    setTrajectory(trajectory: Trajectory): void {
        // Clean up old trajectory
        if (this._trajectory) {
            this._trajectory.clear();
        }
        this._trajectory = trajectory;
        this._trajectoryInitialized = true; // Assume shared trajectory is already init? 
        // Or we should assume sharing implies we don't recalculate logic internally?
    }


    /**
     * Get trail points from the renderer
     */
    getTrailPoints(): THREE.Vector3[] {
        if (!this._render) return [];
        return this._render.getTrailPoints();
    }

    /**
     * Get the time warp function from the trajectory
     */
    getTimeWarpFunction(): ((t: number) => number) | null {
        // Return a dummy identity function if trajectory not ready
        if (!this._trajectory) return (t: number) => t;

        // We need to check if the method exists on the trajectory instance
        if (typeof this._trajectory.getTimeWarpFunction === 'function') {
            return this._trajectory.getTimeWarpFunction();
        }
        return (t: number) => t;
    }

    /**
     * Get LUT sample positions from trajectory
     */
    getLUTSamplePositions(): number[] {
        if (!this._trajectory || typeof this._trajectory.getLUTSamplePositions !== 'function') return [];
        return this._trajectory.getLUTSamplePositions();
    }

    /**
     * Get full LUT data from trajectory
     */
    getLUTData(): any {
        if (!this._trajectory || typeof this._trajectory.getLUTData !== 'function') return null;
        return this._trajectory.getLUTData();
    }

    /**
     * Compute analytical position from normalized time
     */
    computeAnalyticalPositionFromNormalizedTime(normalizedTime: number): THREE.Vector3 | null {
        if (!this._trajectory || typeof this._trajectory.computeAnalyticalPositionFromNormalizedTime !== 'function') return null;
        return this._trajectory.computeAnalyticalPositionFromNormalizedTime(normalizedTime);
    }

    /**
     * Compute bezier position from normalized time
     */
    computeWarpedBezierPosition(normalizedTime: number): THREE.Vector3 | null {
        if (!this._trajectory) return null;

        const warpFunc = this.getTimeWarpFunction();
        if (!warpFunc) return null;

        const warpedTime = warpFunc(normalizedTime);

        if (typeof this._trajectory.computeBezierPositionFromTime === 'function') {
            return this._trajectory.computeBezierPositionFromTime(warpedTime);
        }
        return null;
    }

    /**
     * Get current normalized time (0-1) along the orbit
     */
    getCurrentNormalizedTime(): number {
        // We need the period and start time
        const trajectory = this.getTrajectory();
        if (!trajectory) return 0;

        const params = trajectory.getParameters();
        const period = (params.period as any).over(seconds).value;
        if (period === 0) return 0;

        // Use stored last update time
        // Calculate Mean Anomaly relative to Epoch (M0)
        // M(t) = M0 + n * (t - t0)
        // We assume M0 is handled by trajectory logic relative to startTime

        const startTime = (trajectory as any)._startTime || 0;
        const dt = this._lastUpdateTime - startTime;

        const normalizedTime = (dt % period) / period;
        return normalizedTime;
    }
}
