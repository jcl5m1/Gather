import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Mass, Measure, Length, Velocity, kilograms, kilometers, seconds, GenericMeasure, gravitationalConstantUnit } from './units';
import { Body } from './types';
import { calculateEllipticalPosition, calculateEllipticalVelocity, calculateHyperbolicPosition, calculateHyperbolicVelocity } from './orbitUtils';
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

    // Bezier rendering (for dual-rendering mode)
    bezierMesh: THREE.Mesh | null = null;
    bezierDotSprite: THREE.Sprite | null = null;

    private scene: THREE.Scene;
    private trailPoints: THREE.Vector3[] = [];
    private maxTrailPoints: number = 100;
    private useDotRendering: boolean = false;
    private bezierUseDotRendering: boolean = false;
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
     * Create bezier rendering objects (mesh and sprite) for dual-rendering mode
     * Uses a red tint to distinguish from analytical position
     */
    createBezierRendering(position: THREE.Vector3): void {
        if (this.bezierMesh) {
            return; // Already created
        }

        // Create bezier mesh with red tint (0xff6666)
        const bezierColor = 0xff6666;
        const geometry = new THREE.SphereGeometry(this.radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({ color: bezierColor });
        this.bezierMesh = new THREE.Mesh(geometry, material);
        this.bezierMesh.position.copy(position);
        // Don't add to scene yet - will be added when needed

        // Create bezier dot sprite
        const dotTexture = this.createDotTexture(bezierColor);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: dotTexture,
            sizeAttenuation: false,
            depthTest: true
        });
        this.bezierDotSprite = new THREE.Sprite(spriteMaterial);
        this.bezierDotSprite.scale.set(0.01, 0.01, 1);
        this.bezierDotSprite.position.copy(position);
        // Don't add to scene yet - will be added when needed
    }

    /**
     * Update bezier rendering mode based on screen size
     * Switches between 3D mesh and 2D dot sprite for bezier position
     */
    updateBezierRenderingMode(position: THREE.Vector3, camera: THREE.Camera): void {
        if (!this.bezierMesh || !this.bezierDotSprite) {
            return; // Bezier rendering not initialized
        }

        const screenSize = this.calculateScreenSize(position, camera);
        const shouldUseDot = screenSize < 10;

        if (shouldUseDot !== this.bezierUseDotRendering) {
            this.bezierUseDotRendering = shouldUseDot;

            if (this.bezierUseDotRendering) {
                // Switch to dot rendering
                this.scene.remove(this.bezierMesh);
                this.scene.add(this.bezierDotSprite);
            } else {
                // Switch to mesh rendering
                this.scene.remove(this.bezierDotSprite);
                this.scene.add(this.bezierMesh);
            }
        }

        // Update position for whichever is visible
        if (this.bezierUseDotRendering) {
            this.bezierDotSprite.position.copy(position);
        } else {
            this.bezierMesh.position.copy(position);
        }
    }

    /**
     * Set visibility of bezier mesh/sprite
     */
    setBezierVisibility(visible: boolean): void {
        if (this.bezierMesh) {
            this.bezierMesh.visible = visible;
        }
        if (this.bezierDotSprite) {
            this.bezierDotSprite.visible = visible;
        }
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

        // Clean up bezier rendering if it exists
        if (this.bezierMesh) {
            this.scene.remove(this.bezierMesh);
            this.bezierMesh.geometry.dispose();
            if (this.bezierMesh.material instanceof THREE.Material) {
                this.bezierMesh.material.dispose();
            }
        }
        if (this.bezierDotSprite) {
            this.scene.remove(this.bezierDotSprite);
            if (this.bezierDotSprite.material.map) {
                this.bezierDotSprite.material.map.dispose();
            }
            this.bezierDotSprite.material.dispose();
        }
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

    // Orbital parameters for analytical updates
    private _orbitalParams: {
        semiMajorAxis: number;      // a (km)
        eccentricity: number;       // e (dimensionless)
        period: number;             // T (seconds) - only for elliptical orbits
        startTime: number;          // t0 (seconds) - simulation time when orbit was calculated
        isElliptical: boolean;      // true for elliptical, false for hyperbolic
    } | null = null;

    // Bezier animation parameters
    private _bezierAnimationEnabled: boolean = false;
    private _bezierAnimationStartTime: number = 0;

    private _timeWarpFunction: ((t: number) => number) | null = null;
    private _currentTime: number = 0;

    // Dual-rendering mode: calculate both analytical and bezier positions
    private _dualRenderingEnabled: boolean = false;
    private _bezierPosition: THREE.Vector3 | null = null;

    // Time warp LUT (Lookup Table) for True Anomaly based interpolation with fit bezier curves
    private _timeWarpLUT: {
        M: number[],
        bezierT: number[],
        // Control points for each interval: P1 and P2 (scalar values for T)
        bezierPoints: { p1: number, p2: number }[],
        errors: number[]
    } | null = null;



    // Visual markers for LUT sample positions (using sprites for constant screen size)
    private _lutSampleMarkers: THREE.Sprite[] = [];
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

        // Store scene reference for markers
        this._scene = scene;

        // Create renderer for the body
        this._render = new OrbitalBodyRenderer(scene, position, radius, color);

        // Create trajectory (one per body)
        this._trajectory = new Trajectory(scene, trajectoryColor);
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
        if (this._dualRenderingEnabled && this._bezierPosition && this._render instanceof OrbitalBodyRenderer) {
            this._render.updateBezierRenderingMode(this._bezierPosition, camera);
        }
    }

    /**
     * Calculate orbital parameters from current state for analytical updates
     */
    private calculateOrbitalParameters(centralBodyMass: number, G: GenericMeasure<number, any, any>, currentTime: number): void {
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        const r = this.position.length();
        const v = this.velocity.length();

        // Calculate specific orbital energy: ε = v²/2 - μ/r
        const specificEnergy = (v * v) / 2 - mu / r;

        // Calculate semi-major axis: a = -μ/(2ε)
        const a = -mu / (2 * specificEnergy);

        // Calculate specific angular momentum vector
        const h = new THREE.Vector3().crossVectors(this.position, this.velocity);
        const hMag = h.length();

        // Calculate eccentricity: e = sqrt(1 + (2εh²)/μ²)
        const e = Math.sqrt(1 + (2 * specificEnergy * hMag * hMag) / (mu * mu));

        // Determine if orbit is elliptical or hyperbolic
        const isElliptical = e < 1.0;

        // Calculate period (only for elliptical orbits)
        const period = isElliptical ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : 0;

        this._orbitalParams = {
            semiMajorAxis: a,
            eccentricity: e,
            period: period,
            startTime: currentTime,
            isElliptical: isElliptical
        };
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
     * Update position and velocity using analytical orbital mechanics (Kepler's equations)
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    private updateAnalytical(currentTime: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>): void {
        // Calculate orbital parameters if not yet computed
        if (!this._orbitalParams) {
            this.calculateOrbitalParameters(centralBodyMass, G, currentTime);
        }

        if (!this._orbitalParams) return;

        const { semiMajorAxis, eccentricity, period, startTime, isElliptical } = this._orbitalParams;

        // Calculate new position and velocity using Kepler's equations
        if (isElliptical) {
            const newPos = calculateEllipticalPosition(
                currentTime,
                semiMajorAxis,
                eccentricity,
                period,
                startTime,
                this.initialPosition,
                this.initialVelocity,
                centralBodyMass
            );

            const newVel = calculateEllipticalVelocity(
                currentTime,
                semiMajorAxis,
                eccentricity,
                period,
                startTime,
                this.initialPosition,
                this.initialVelocity,
                centralBodyMass
            );

            this.position.copy(newPos).add(centralBodyPosition);
            this.velocity.copy(newVel);
        } else {
            // Hyperbolic orbit
            const newPos = calculateHyperbolicPosition(
                currentTime,
                semiMajorAxis,
                eccentricity,
                startTime,
                this.initialPosition,
                this.initialVelocity,
                centralBodyMass
            );

            const newVel = calculateHyperbolicVelocity(
                currentTime,
                semiMajorAxis,
                eccentricity,
                startTime,
                this.initialPosition,
                this.initialVelocity,
                centralBodyMass
            );

            this.position.copy(newPos).add(centralBodyPosition);
            this.velocity.copy(newVel);
        }
    }

    /**
     * Update position and velocity based on gravitational force
     * Supports both numerical integration and analytical (Kepler's equations) methods
     * In dual-rendering mode, calculates both analytical AND bezier positions
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>, currentTime: number = 0): void {
        // Store current time for animation position tracking
        this._currentTime = currentTime;

        // If dual-rendering is enabled, calculate BOTH positions
        if (this._dualRenderingEnabled && this._bezierAnimationEnabled) {
            // Calculate analytical position (as the primary position)
            if (ORBIT_UPDATE_METHOD === 'analytical') {
                this.updateAnalytical(currentTime, centralBodyPosition, centralBodyMass, G);
            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            // Calculate bezier position separately and store it
            const { period } = this._orbitalParams || { period: 0 };
            if (period > 0) {
                const elapsedTime = currentTime - this._bezierAnimationStartTime;
                const rawNormalizedTime = (elapsedTime % period) / period;

                if (!isNaN(rawNormalizedTime)) {
                    const warpedTime = this.getTimeWarpFunction()(rawNormalizedTime);
                    if (!isNaN(warpedTime)) {
                        const bezierPos = this.computeBezierPositionFromTime(warpedTime);
                        if (bezierPos) {
                            this._bezierPosition = bezierPos.clone().add(centralBodyPosition);
                        }
                    }
                }
            }
        } else {
            // Normal single-position update
            if (this._bezierAnimationEnabled) {
                this.updateBezier(currentTime, centralBodyPosition);
            } else if (ORBIT_UPDATE_METHOD === 'analytical') {
                this.updateAnalytical(currentTime, centralBodyPosition, centralBodyMass, G);
            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            // Clear bezier position if not in dual-rendering mode
            this._bezierPosition = null;
        }

        // Note: mesh/sprite position is updated in updateRenderingMode(), called from game loop

        // Update trajectory current state (altitude and velocity)
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

        // Clear orbital parameters to force recalculation
        this._orbitalParams = null;

        // Update radius and regenerate mesh if radius is provided
        if (radius !== undefined && radius !== this.radius) {
            this.radius = radius;
            // Get color from existing mesh material
            const color = (this._render.mesh.material as THREE.MeshPhongMaterial).color.getHex();
            this._render.updateRadius(radius, color);
        }

        // Clear trail
        this._render.clearTrail(position);

        // Recalculate trajectory
        this._trajectory.clear();
        const positionVec = MeasureVector3.fromVector3<Length>(position, kilometers);
        const velocityVec = MeasureVector3.fromVector3<Velocity>(velocity, kilometers.per(seconds));
        const centralMass = Measure.of(centralBodyMass, kilograms);
        this._trajectory.calculateFromState(positionVec, velocityVec, centralMass);
    }

    /**
     * Reset to initial conditions (stored when body was created or last reset)
     * and recompute trajectory
     */
    resetToInitial(centralBodyMass: number): void {
        this.position.copy(this.initialPosition);
        this.velocity.copy(this.initialVelocity);

        // Clear orbital parameters to force recalculation
        this._orbitalParams = null;

        // Clear trail
        this._render.clearTrail(this.initialPosition);

        // Recompute trajectory
        this._trajectory.clear();
        const positionVec = MeasureVector3.fromVector3<Length>(this.initialPosition, kilometers);
        const velocityVec = MeasureVector3.fromVector3<Velocity>(this.initialVelocity, kilometers.per(seconds));
        const centralMass = Measure.of(centralBodyMass, kilograms);
        this._trajectory.calculateFromState(positionVec, velocityVec, centralMass);
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
            // Enable dual rendering - create bezier rendering objects
            this._dualRenderingEnabled = true;
            if (this._render instanceof OrbitalBodyRenderer) {
                this._render.createBezierRendering(this.initialPosition);
            }
            console.log(`[OrbitalBody] Dual rendering enabled for ${this.name}`);
        } else if (!enabled && this._dualRenderingEnabled) {
            // Disable dual rendering
            this._dualRenderingEnabled = false;
            if (this._render instanceof OrbitalBodyRenderer) {
                this._render.setBezierVisibility(false);
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
    }

    /**
     * Helper function to compute bezier position from a normalized time value (0-1)
     * @param normalizedTime Value between 0 and 1 representing position along the orbit
     * @returns Position vector in orbital frame (relative to central body)
     */
    private computeBezierPositionFromTime(normalizedTime: number): THREE.Vector3 | null {
        const bezierCurves = this._trajectory.getBezierCurves();
        if (!bezierCurves || bezierCurves.length === 0) {
            return null;
        }

        // Check for NaN in inputs
        if (isNaN(normalizedTime)) {
            console.warn(`[OrbitalBody] NaN detected in bezier calculation: normalizedTime=${normalizedTime}`);
            return null;
        }

        const numCurves = bezierCurves.length;
        // SIMPLIFIED: Remove offsets - assume 0-1 maps directly to the full curve sequence
        // We assume the curves are generated starting from Apoapsis (t=0)
        const totalProgress = normalizedTime * numCurves;

        const normalizedTotal = totalProgress - Math.floor(totalProgress); // Curve parameter t (0-1)

        // Handle wrapping for curve index
        let curveIndex = Math.floor(totalProgress) % numCurves;
        if (curveIndex < 0) curveIndex += numCurves;

        const curveT = normalizedTotal;

        // Extra safety check: verify the curve at this index exists and is valid
        if (isNaN(curveIndex) || curveIndex < 0 || curveIndex >= numCurves ||
            !bezierCurves[curveIndex] || typeof bezierCurves[curveIndex].getPoint !== 'function') {
            console.warn(`[OrbitalBody] Bezier curve at index ${curveIndex} is invalid (numCurves: ${numCurves}, totalProgress: ${totalProgress})`);
            return null;
        }

        return bezierCurves[curveIndex].getPoint(curveT);
    }

    /**
     * Compute cubic spline coefficients for natural cubic spline interpolation
     * @param x Array of x values (sorted)
     * @param y Array of y values  
     * @returns Array of coefficient arrays [a, b, c, d] for each interval, or empty if computation fails
     */
    /**
     * Fit a cubic Bezier curve to a set of points (fixed endpoints)
     * Solving for control points P1 and P2 to minimize least squares error
     * @param p0 Start point
     * @param p3 End point
     * @param samples Intermediate sample points
     * @returns { p1: THREE.Vector2, p2: THREE.Vector2 } Control points
     */
    private fitCubicBezier(p0: THREE.Vector2, p3: THREE.Vector2, samples: THREE.Vector2[]): { p1: THREE.Vector2, p2: THREE.Vector2 } {
        if (samples.length === 0) {
            // No samples, assume linear (points at 1/3 and 2/3)
            return {
                p1: new THREE.Vector2().copy(p0).lerp(p3, 1 / 3),
                p2: new THREE.Vector2().copy(p0).lerp(p3, 2 / 3)
            };
        }

        // We assign a 'u' parameter to each sample based on its index
        // e.g. if we have 3 samples, they are at u=0.25, 0.5, 0.75 relative to the interval
        // because we include p0 at u=0 and p3 at u=1 implicit logic

        let c11 = 0, c12 = 0, c22 = 0;
        let rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0;

        const n = samples.length;
        for (let i = 0; i < n; i++) {
            const u = (i + 1) / (n + 1);
            const u2 = u * u;
            const u3 = u2 * u;
            const oneMinusU = 1 - u;
            const oneMinusU2 = oneMinusU * oneMinusU;
            const oneMinusU3 = oneMinusU2 * oneMinusU;

            // Basis functions for P1 and P2
            // B1(u) = 3(1-u)^2 * u
            // B2(u) = 3(1-u) * u^2
            const b1 = 3 * oneMinusU2 * u;
            const b2 = 3 * oneMinusU * u2;

            // Known parts contribution from P0 and P3
            // B0(u) = (1-u)^3
            // B3(u) = u^3
            const b0 = oneMinusU3;
            const b3 = u3;

            // Target point P(u) - known parts
            const qx = samples[i].x - (b0 * p0.x + b3 * p3.x);
            const qy = samples[i].y - (b0 * p0.y + b3 * p3.y);

            // Accumulate least squares matrix elements and RHS vector
            c11 += b1 * b1;
            c12 += b1 * b2;
            c22 += b2 * b2;

            rx1 += b1 * qx;
            ry1 += b1 * qy;
            rx2 += b2 * qx;
            ry2 += b2 * qy;
        }

        // Solve linear system:
        // | c11 c12 | | P1 |   | R1 |
        // | c12 c22 | | P2 | = | R2 |

        const det = c11 * c22 - c12 * c12;
        if (Math.abs(det) < 1e-9) {
            // Fallback Linear
            return {
                p1: new THREE.Vector2().copy(p0).lerp(p3, 1 / 3),
                p2: new THREE.Vector2().copy(p0).lerp(p3, 2 / 3)
            };
        }

        const invDet = 1.0 / det;

        const p1x = (c22 * rx1 - c12 * rx2) * invDet;
        const p1y = (c22 * ry1 - c12 * ry2) * invDet;
        const p2x = (c11 * rx2 - c12 * rx1) * invDet;
        const p2y = (c11 * ry2 - c12 * ry1) * invDet;

        return {
            p1: new THREE.Vector2(p1x, p1y),
            p2: new THREE.Vector2(p2x, p2y)
        };
    }

    /**
     * Solve for u such that cubicBezier.x(u) = xTarget
     * Uses Newton-Raphson method
     */
    private solveCubicBezierXForT(xTarget: number, p0: THREE.Vector2, p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2): number {
        // Initial guess: assume linear relationship (u approx (x - x0) / (x3 - x0))
        let u = (xTarget - p0.x) / (p3.x - p0.x);
        u = Math.max(0, Math.min(1, u));

        // Newton-Raphson iterations
        for (let i = 0; i < 8; i++) {
            const u2 = u * u;
            const u3 = u2 * u;
            const oneMinusU = 1 - u;
            const oneMinusU2 = oneMinusU * oneMinusU;
            const oneMinusU3 = oneMinusU2 * oneMinusU;

            // Evaluate x(u)
            // x(u) = (1-u)^3*x0 + 3(1-u)^2*u*x1 + 3(1-u)u^2*x2 + u^3*x3
            const xVal = oneMinusU3 * p0.x +
                3 * oneMinusU2 * u * p1.x +
                3 * oneMinusU * u2 * p2.x +
                u3 * p3.x;

            const err = xVal - xTarget;
            if (Math.abs(err) < 1e-7) return u;

            // Evaluate dx/du
            // x'(u) = 3(1-u)^2(x1-x0) + 6(1-u)u(x2-x1) + 3u^2(x3-x2)
            const dx = 3 * oneMinusU2 * (p1.x - p0.x) +
                6 * oneMinusU * u * (p2.x - p1.x) +
                3 * u2 * (p3.x - p2.x);

            if (Math.abs(dx) < 1e-9) break; // Zero derivative, stop

            u -= err / dx;
            u = Math.max(0, Math.min(1, u)); // Clamp to valid range
        }
        return u;
    }

    /**
     * Time warping function - takes 0-1 input (Mean Anomaly normalized) and outputs warped 0-1 (bezier t)
     * Uses linear interpolation from the LUT
     */
    private timeWarpFunction(t: number): number {
        // Clamp input to [0, 1]
        t = Math.max(0, Math.min(1, t));

        // Use LUT if available, otherwise return identity
        if (!this._timeWarpLUT || this._timeWarpLUT.M.length === 0) {
            return t;
        }

        // Find the two closest points in the LUT by Mean Anomaly
        const M_values = this._timeWarpLUT.M;
        const bezierT_values = this._timeWarpLUT.bezierT;

        // Handle edge cases
        if (t <= M_values[0]) return bezierT_values[0];
        if (t >= M_values[M_values.length - 1]) return bezierT_values[bezierT_values.length - 1];

        // Binary search to find the interval
        let left = 0;
        let right = M_values.length - 1;

        while (right - left > 1) {
            const mid = Math.floor((left + right) / 2);
            if (M_values[mid] <= t) {
                left = mid;
            } else {
                right = mid;
            }
        }

        // Get interval data for interpolation
        const M0 = M_values[left];
        const M1 = M_values[right];
        const bezierT0 = bezierT_values[left];
        const bezierT1 = bezierT_values[right];

        // Check if bezier control points are available
        const pts = this._timeWarpLUT.bezierPoints ? this._timeWarpLUT.bezierPoints[left] : null;

        if (pts) {
            // Cubic Bezier interpolation
            // B(u) = (1-u)^3*p0 + 3(1-u)^2*u*p1 + 3(1-u)u^2*p2 + u^3*p3
            // u is normalized time within interval [0,1]
            const u = (t - M0) / (M1 - M0);

            const oneMinusU = 1 - u;
            const u2 = u * u;
            const u3 = u * u * u;
            const oneMinusU2 = oneMinusU * oneMinusU;
            const oneMinusU3 = oneMinusU * oneMinusU * oneMinusU;

            const T0 = bezierT0;
            const T1 = bezierT1;

            return oneMinusU3 * T0 +
                3 * oneMinusU2 * u * pts.p1 +
                3 * oneMinusU * u2 * pts.p2 +
                u3 * T1;
        }

        // Fallback to Linear interpolation if no coeffs
        const u = (t - M0) / (M1 - M0);
        return bezierT0 + (bezierT1 - bezierT0) * u;
    }

    /**
     * Set a custom time warp function
     */
    setTimeWarpFunction(warpFn: (t: number) => number): void {
        this._timeWarpFunction = warpFn;
    }

    /**
     * Get the current time warp function
     */
    getTimeWarpFunction(): (t: number) => number {
        return this._timeWarpFunction || this.timeWarpFunction.bind(this);
    }

    /**
     * Compute bezier position using time warp - public helper for external use
     */
    public computeWarpedBezierPosition(normalizedTime: number): THREE.Vector3 | null {
        // Check if bezier curves are available
        const bezierCurves = this._trajectory.getBezierCurves();
        if (!bezierCurves || bezierCurves.length === 0) {
            return null;
        }

        const warpedTime = this.getTimeWarpFunction()(normalizedTime);
        return this.computeBezierPositionFromTime(warpedTime);
    }

    /**
     * DEPRECATED: Old time correction table computation
     */
    private computeTimeCorrectionTable(centralBodyMass: number): void {
        if (!this._orbitalParams || !this._orbitalParams.isElliptical) {
            return;
        }

        const { period, semiMajorAxis, eccentricity } = this._orbitalParams;
        const bezierCurves = this._trajectory.getBezierCurves();

        if (!bezierCurves || bezierCurves.length === 0) {
            return;
        }

        const numCurves = bezierCurves.length;
        // SIMPLIFIED: Assume offsets are 0
        const startOffset = 0;

        // Sample 100 points to find the time correction
        const numSamples = 100;
        const analyticalTimes: number[] = [];
        const correctedTimes: number[] = [];

        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        // Calculate initial eccentric anomaly
        const r0 = this.initialPosition.length();
        const radialVel0 = this.initialVelocity.dot(this.initialPosition.clone().normalize());
        const h = new THREE.Vector3().crossVectors(this.initialPosition, this.initialVelocity);
        const hMag = h.length();
        const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r0 - mu);
        const E0 = 2 * Math.atan(Math.sqrt((1 - eccentricity) / (1 + eccentricity)) * Math.tan(theta0 / 2));
        const M0 = E0 - eccentricity * Math.sin(E0);

        const hNorm = h.clone().normalize();
        const vCrossH = new THREE.Vector3().crossVectors(this.initialVelocity, h);
        const eVec = vCrossH.multiplyScalar(1 / mu).sub(this.initialPosition.clone().normalize());
        const eNorm = eVec.clone().normalize();
        const periapsisDir = eNorm;
        const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

        for (let i = 0; i <= numSamples; i++) {
            const analyticalTime = i / numSamples;

            // Calculate analytical position
            const M = M0 + 2 * Math.PI * analyticalTime;
            let E = M;
            for (let iter = 0; iter < 10; iter++) {
                E = M + eccentricity * Math.sin(E);
            }

            const x = semiMajorAxis * (Math.cos(E) - eccentricity);
            const y = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E);

            const analyticalPos = new THREE.Vector3()
                .addScaledVector(periapsisDir, x)
                .addScaledVector(perpDir, y);

            // Find the closest point on the bezier curves
            let bestBezierTime = 0;
            let minDistance = Infinity;

            for (let searchT = 0; searchT <= 1; searchT += 0.01) {
                const totalProgress = startOffset + searchT * numCurves;
                const curveIndex = Math.floor(totalProgress) % numCurves;
                const curveT = totalProgress % 1;
                const bezierPos = bezierCurves[curveIndex].getPoint(curveT);
                const distance = analyticalPos.distanceTo(bezierPos);

                if (distance < minDistance) {
                    minDistance = distance;
                    bestBezierTime = searchT;
                }
            }

            analyticalTimes.push(analyticalTime);
            correctedTimes.push(bestBezierTime);
        }

        // Store the lookup table
        this._timeCorrectionTable = {
            analytical: analyticalTimes,
            corrected: correctedTimes
        };

        console.log('[Bezier Animation] DEPRECATED: Time correction table no longer used');
    }

    /**
     * Create a circular texture for LUT markers
     */
    private createMarkerTexture(color: number): THREE.Texture {
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
     * Update position using bezier curve approximation with time warping
     * Interpolates position along bezier curves with the same period as analytical orbit
     */
    private updateBezier(currentTime: number, centralBodyPosition: THREE.Vector3): void {
        if (!this._orbitalParams || !this._orbitalParams.isElliptical) {
            return;
        }

        const { period } = this._orbitalParams;

        // Calculate normalized time (0 to 1) for one orbital period
        const elapsedTime = currentTime - this._bezierAnimationStartTime;
        const rawNormalizedTime = (elapsedTime % period) / period;

        // Check for NaN in time calculations
        if (isNaN(rawNormalizedTime)) {
            console.warn(`[OrbitalBody] rawNormalizedTime is NaN: currentTime=${currentTime}, startTime=${this._bezierAnimationStartTime}, period=${period}, elapsedTime=${elapsedTime}`);
            return;
        }

        // Apply time warp function
        const warpedTime = this.getTimeWarpFunction()(rawNormalizedTime);

        // Check if warp function returned NaN
        if (isNaN(warpedTime)) {
            console.warn(`[OrbitalBody] warpedTime is NaN: rawNormalizedTime=${rawNormalizedTime}`);
            return;
        }

        // Get position from bezier curve using warped time
        const newPos = this.computeBezierPositionFromTime(warpedTime);
        if (!newPos) {
            return;
        }

        this.position.copy(newPos).add(centralBodyPosition);

        // Calculate velocity by finite difference
        const dt = 0.001;
        const nextRawTime = rawNormalizedTime + dt;
        const nextWarpedTime = this.getTimeWarpFunction()(nextRawTime);
        const nextPos = this.computeBezierPositionFromTime(nextWarpedTime);

        if (nextPos) {
            const dtSimulation = dt * period;
            this.velocity.copy(nextPos).sub(newPos).multiplyScalar(1 / dtSimulation);
        }
    }
    /**
     * Optimize bezierT to minimize position error from analytical position
     * Uses coarse grid search + golden section search for robust global optimization
     * @param analyticalPos Target analytical position
     * @param initialGuess Initial guess for bezierT (from Mean Anomaly) - used as hint
     * @returns Optimized bezierT value
     */
    private optimizeBezierT(analyticalPos: THREE.Vector3, initialGuess: number): number {
        const bezierCurves = this._trajectory.getBezierCurves();
        if (!bezierCurves || bezierCurves.length === 0) {
            return initialGuess;
        }

        // Objective function: distance from bezier position to analytical position
        const objectiveFunction = (bezierT: number): number => {
            const bezierPos = this.computeBezierPositionFromTime(bezierT);
            if (!bezierPos) return Infinity;
            return analyticalPos.distanceTo(bezierPos);
        };

        // Phase 1: Coarse grid search to find global minimum (avoid local minima)
        const gridSize = 100;
        let bestT = initialGuess;
        let bestError = objectiveFunction(initialGuess);

        for (let i = 0; i <= gridSize; i++) {
            const t = i / gridSize;
            const error = objectiveFunction(t);
            if (error < bestError) {
                bestError = error;
                bestT = t;
            }
        }

        // Phase 2: Golden section search for fine refinement around best point
        const phi = (1 + Math.sqrt(5)) / 2; // Golden ratio
        const tolerance = 1e-6;  // Tighter tolerance (was 1e-5)
        const maxIterations = 100;  // More iterations (was 50)

        // Bracket around best point from grid search (±0.01 for fine tuning)
        let a = Math.max(0, bestT - 0.01);
        let b = Math.min(1, bestT + 0.01);

        // Golden section search
        let c = b - (b - a) / phi;
        let d = a + (b - a) / phi;

        for (let iter = 0; iter < maxIterations; iter++) {
            const fc = objectiveFunction(c);
            const fd = objectiveFunction(d);

            if (fc < fd) {
                b = d;
                d = c;
                c = b - (b - a) / phi;
            } else {
                a = c;
                c = d;
                d = a + (b - a) / phi;
            }

            // Check convergence
            if (Math.abs(b - a) < tolerance) {
                break;
            }
        }

        // Return the midpoint of the final bracket
        return (a + b) / 2;
    }

    /**
     * Build time warp LUT by sampling evenly in True Anomaly
     * For each True Anomaly, compute analytical position and optimize bezierT to minimize error
     * Uses Mean Anomaly as initial guess for optimization
     * @param centralBodyMass Mass of central body
     */
    private buildTimeWarpLUT(centralBodyMass: number): void {
        if (!this._orbitalParams || !this._orbitalParams.isElliptical) {
            return;
        }

        const { semiMajorAxis, eccentricity } = this._orbitalParams;
        const bezierCurves = this._trajectory.getBezierCurves();

        if (!bezierCurves || bezierCurves.length === 0) {
            return;
        }

        const numCurves = bezierCurves.length;
        // SIMPLIFIED: Assume offsets are 0
        const startOffset = 0;

        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        // Calculate orbital basis vectors
        const r0 = this.initialPosition.length();
        const radialVel0 = this.initialVelocity.dot(this.initialPosition.clone().normalize());
        const h = new THREE.Vector3().crossVectors(this.initialPosition, this.initialVelocity);
        const hMag = h.length();
        const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r0 - mu);
        const E0 = 2 * Math.atan(Math.sqrt((1 - eccentricity) / (1 + eccentricity)) * Math.tan(theta0 / 2));
        const M0 = E0 - eccentricity * Math.sin(E0);

        const hNorm = h.clone().normalize();
        const vCrossH = new THREE.Vector3().crossVectors(this.initialVelocity, h);
        const eVec = vCrossH.multiplyScalar(1 / mu).sub(this.initialPosition.clone().normalize());
        const eNorm = eVec.clone().normalize();
        const periapsisDir = eNorm;
        const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

        // Cache the orbit basis for runtime consistency
        this._cachedOrbitBasis = {
            periapsisDir: periapsisDir,
            perpDir: perpDir,
            M0: M0
        };

        // Clear any existing markers
        this.clearLUTMarkers();

        // Sample 32 points evenly in True Anomaly (physics-based spacing)
        const numSamplesForCalculation = 8;
        const allSamples: { M: number, bezierT: number, position: THREE.Vector3, analyticalPos: THREE.Vector3, error: number }[] = [];

        console.log('[Time Warp LUT] Building LUT with optimization...');

        for (let i = 0; i < numSamplesForCalculation; i++) {
            // Sample evenly in Eccentric Anomaly starting at apoapsis (π to 3π)
            // This provides a distribution between uniform Mean Anomaly and uniform True Anomaly
            const E = Math.PI + (i / numSamplesForCalculation) * 2 * Math.PI;

            // Compute Mean Anomaly: M = E - e*sin(E)
            const M = E - eccentricity * Math.sin(E);

            // Normalize M to [0, 1] range relative to M0
            const M_normalized = (M - M0) / (2 * Math.PI);
            const M_wrapped = ((M_normalized % 1) + 1) % 1;

            // Compute analytical position from M (NOT Theta) using the SHARED internal helper
            // This guarantees that the target we optimize for is EXACTLY what the runtime/plot will see
            const analyticalPos = this.calculateAnalyticalPositionInternal(M_wrapped);

            // Use Mean Anomaly as initial guess for bezierT
            const initialGuess = M_wrapped;

            // Optimize bezierT to minimize distance to analytical position
            const optimizedBezierT = this.optimizeBezierT(analyticalPos, initialGuess);

            // Get the optimized bezier position for marker placement
            const bezierPos = this.computeBezierPositionFromTime(optimizedBezierT);
            const markerPosition = bezierPos || analyticalPos.clone();

            // Calculate final error
            const error = bezierPos ? analyticalPos.distanceTo(bezierPos) : Infinity;

            allSamples.push({
                M: M_wrapped,
                bezierT: optimizedBezierT,
                position: markerPosition,
                analyticalPos: analyticalPos,
                error: error
            });

            // Log ALL samples to debug the large errors
            console.log(`  Sample ${i}/${numSamplesForCalculation}: M=${M_wrapped.toFixed(4)}, bezierT=${optimizedBezierT.toFixed(4)}, error=${error.toFixed(2)} km`);
        }

        // Sort all samples by Mean Anomaly
        allSamples.sort((a, b) => a.M - b.M);

        // Extract sorted arrays from all samples
        const M_values = allSamples.map(e => e.M);
        let bezierT_values = allSamples.map(e => e.bezierT);

        // Shift bezierT values: REMOVED. 
        // We do NOT shift to 0, because we want M (Mean Anomaly) to map to the correct absolute bezierT
        // that corresponds to the same position. The initial position (M=0) might not be at bezierT=0.
        // Keeping the values aligned ensures Pos(M) ~= Pos(timeWarp(M)).

        // Add padded wraparound points for smooth interpolation at boundaries 0 and 1
        if (M_values.length > 0) {
            const firstM = M_values[0];
            const firstT = bezierT_values[0];
            const lastM = M_values[M_values.length - 1];
            const lastT = bezierT_values[bezierT_values.length - 1];

            // Pre-pend (last - 1.0) to cover the range [0, firstM)
            M_values.unshift(lastM - 1.0);
            bezierT_values.unshift(lastT - 1.0);

            // Append (first + 1.0) to cover the range [lastM, 1]
            M_values.push(firstM + 1.0);
            bezierT_values.push(firstT + 1.0);
        }

        // Create visual markers at optimized positions (before adding wraparound point to allSamples)
        const markerTexture = this.createMarkerTexture(0x00ff00);

        for (const sample of allSamples) {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: markerTexture,
                sizeAttenuation: false,
                depthTest: true
            });
            const marker = new THREE.Sprite(spriteMaterial);
            marker.scale.set(0.01, 0.01, 1);  // 10x10 pixels
            marker.position.copy(sample.position);
            this._scene.add(marker);
            this._lutSampleMarkers.push(marker);
        }

        console.log('[Time Warp LUT] Computing Bezier curve segments...');

        // Group samples into intervals and fit Bezier curves
        // usage: 8 intervals (numSamplesForCalculation)
        // each interval has sub-samples for fitting. But wait, we used 'numSamplesForCalculation' for the knot points.
        // We need to change the sampling strategy to support the fitting.

        // RE-PLANNING SAMPLING:
        // We want 8 intervals. So we need 32 sub-samples (4 per interval).
        // Let's re-generate samples if we want high precision, OR we can just use the ones we have?
        // Actually, the previous code generated 'numSamplesForCalculation' (8) samples.
        // This is not enough for fitting 8 cubic beziers (needs 8 * 4 samples).

        // Let's clear the samples and re-generate them with the correct count.
        // This is a bit inefficient to have 32 markers, but acceptable.

        // ACTUALLY, let's keep the existing loop structure but change the count:
        // We want N=8 intervals. So we need samples at 0, 1/8, ... 1 (9 knots).
        // Plus 3 intermediate points per interval. Total points = 8 * 4 + 1 = 33 points.

        // Changing the generation loop is complex with 'replace'.
        // Instead, let's assume we change the sampling above or handle it here.
        // But the previous loop was: for (let i = 0; i < numSamplesForCalculation; i++)

        // Let's simpler approach: Use the 8 generated samples as the KNOTS.
        // And we will use 'fitCubicBezier1D' which falls back to linear if we lack intermediate samples.
        // But the goal was "4x sampling".

        // To fix this correctly without editing the loop above (which is hard to target),
        // we will ignore the samples generated above for the LUT and generate FRESH samples for the fitting.
        // This is safer.

        const numIntervals = 8;
        const subSamplesPerInterval = 8;
        const bezierPoints: { p1: number, p2: number }[] = [];

        // We need the KNOTS (M values) to be evenly spaced or specific?
        // The previous loop generated samples evenly in Eccentric Anomaly.
        // We should preserve that knot structure for the intervals.
        // So we need to re-run the sampling loop logic but with higher resolution,
        // then pick out the knots.

        // Actually, let's just use a dedicated loop here to generate the data for the LUT
        // and ignore the 'allSamples' (which are just for debug markers/previous logic).

        const lutM: number[] = [];
        const lutBezierT: number[] = [];
        const lutErrors: number[] = [];

        // Generate knots and intermediate samples
        // We want 'numIntervals' segments.
        // The knots will be at indices 0, 4, 8, ... 32.

        const totalFitSamples = numIntervals * subSamplesPerInterval;
        // We need to generate 'totalFitSamples + 1' points.

        const fitData: { u: number, M: number, bezierT: number }[] = [];

        for (let i = 0; i <= totalFitSamples; i++) {
            // Sample evenly in Eccentric Anomaly from Pi to 3Pi
            const E = Math.PI + (i / totalFitSamples) * 2 * Math.PI;
            const M = E - eccentricity * Math.sin(E);

            // Normalize M
            const M_norm = (M - M0) / (2 * Math.PI);
            const M_wrapped = ((M_norm % 1) + 1) % 1;

            // Optimize T
            const analyticalPos = this.calculateAnalyticalPositionInternal(M_wrapped);
            const T = this.optimizeBezierT(analyticalPos, M_wrapped);

            fitData.push({ u: i / totalFitSamples, M: M_wrapped, bezierT: T });
        }
        // Handle wrap around: Ensure strict monotonicity and boundary matching if needed
        // Sort by M to be safe (though E-monotonicity implies M-monotonicity)
        fitData.sort((a, b) => a.M - b.M);

        if (fitData.length > 0) {
            const first = fitData[0];
            const last = fitData[fitData.length - 1];

            // Pad with wrap-around points to ensure covereage of [0, 1]
            // Prepend last point shifted by -1
            fitData.unshift({
                u: 0, // u is not really used for the padding points in the list context
                M: last.M - 1.0,
                bezierT: last.bezierT - 1.0
            });

            // Append first point shifted by +1
            fitData.push({
                u: 0,
                M: first.M + 1.0,
                bezierT: first.bezierT + 1.0
            });
        }

        // Now build the LUT intervals from the augmented data
        for (let i = 0; i < fitData.length - 1; i += subSamplesPerInterval) {
            // Define segment from index i to i + subSamples (capped)
            const p0Index = i;
            let p3Index = i + subSamplesPerInterval;

            // Should we merge the last small chunk? 
            // If the remaining points are too few?
            // With the padding strategy, we have 80 + 2 points = 82 points.
            // 82 points.
            // 0..10 (11 pts)
            // 10..20 (11 pts)
            // ...
            // 70..80 (11 pts)
            // 80..81 (2 pts) -> This is the last small segment.

            // Adjust p3Index to not exceed bounds
            if (p3Index >= fitData.length) {
                p3Index = fitData.length - 1;
            }

            // If the segment is too small (just 1 point?), skip or merge?
            // If p3Index == p0Index, we are done.
            if (p3Index <= p0Index) break;

            const segmentSamples = fitData.slice(p0Index, p3Index + 1);

            const startNode = segmentSamples[0];
            const endNode = segmentSamples[segmentSamples.length - 1];

            // Add knot to LUT
            if (lutM.length === 0) {
                lutM.push(startNode.M);
                lutBezierT.push(startNode.bezierT);
            }
            // Avoid duplicate knots if we chain perfectly (which we do)
            lutM.push(endNode.M);
            lutBezierT.push(endNode.bezierT);

            // Normalize samples for this interval (u: 0->1)
            const mStart = startNode.M;
            const mEnd = endNode.M;
            const tStart = startNode.bezierT;
            const tEnd = endNode.bezierT;

            const samplesForFit = segmentSamples.map(s => {
                // Approximate local parameter u by M fraction (since we map M->T)
                // u = (M - M_start) / (M_end - M_start)
                let u_local = (s.M - mStart) / (mEnd - mStart);
                if (isNaN(u_local)) u_local = 0;
                return {
                    u: u_local,
                    y: s.bezierT
                };
            });

            // Fit Bezier
            const control = this.fitCubicBezier1D(tStart, tEnd, samplesForFit);
            bezierPoints.push(control);

            // If we reached the end, break
            if (p3Index === fitData.length - 1) break;
        }

        // Store
        this._timeWarpLUT = {
            M: lutM,
            bezierT: lutBezierT,
            bezierPoints: bezierPoints,
            errors: [] // Skip error calc for now
        };

        console.log(`[Time Warp LUT] Built Bezier LUT with ${numIntervals} intervals.`);
    }

    /**
     * Fit a 1D cubic Bezier curve to a set of points (fixed endpoints)
     * Solving for scalar control points P1 and P2 to minimize least squares error
     */
    private fitCubicBezier1D(y0: number, y3: number, samples: { u: number, y: number }[]): { p1: number, p2: number } {
        if (samples.length === 0) {
            return { p1: y0 + (y3 - y0) / 3, p2: y0 + 2 * (y3 - y0) / 3 };
        }

        let c11 = 0, c12 = 0, c22 = 0;
        let r1 = 0, r2 = 0;

        for (const sample of samples) {
            const u = sample.u;
            const y = sample.y;

            const oneMinusU = 1 - u;
            const u2 = u * u;
            const oneMinusU2 = oneMinusU * oneMinusU;

            const b1 = 3 * oneMinusU2 * u;
            const b2 = 3 * oneMinusU * u2;

            const b0 = oneMinusU * oneMinusU2;
            const b3 = u * u2;

            const startEndContrib = b0 * y0 + b3 * y3;
            const residual = y - startEndContrib;

            c11 += b1 * b1;
            c12 += b1 * b2;
            c22 += b2 * b2;

            r1 += b1 * residual;
            r2 += b2 * residual;
        }

        const det = c11 * c22 - c12 * c12;
        if (Math.abs(det) < 1e-9) {
            return { p1: y0 + (y3 - y0) / 3, p2: y0 + 2 * (y3 - y0) / 3 };
        }

        const invDet = 1.0 / det;
        const p1 = (c22 * r1 - c12 * r2) * invDet;
        const p2 = (c11 * r2 - c12 * r1) * invDet;

        return { p1, p2 };
    }

    /**
     * Compute analytical position from normalized time (0-1) representing Mean Anomaly
     * matches the logic used in LUT building and plotting
     */
    public computeAnalyticalPositionFromNormalizedTime(normalizedTime: number): THREE.Vector3 | null {
        if (!this._orbitalParams) {
            return null;
        }

        const { semiMajorAxis, eccentricity } = this._orbitalParams;
        if (!this._orbitalParams.isElliptical) return null;

        // Calculate orbital basis vectors (re-deriving here to ensure we use the current state/params)
        // Ideally these should be cached, but for now we follow the pattern in buildLUT
        // Note: We use initial conditions to determine the orbit orientation
        const GValue = (G as any).over(gravitationalConstantUnit).value;
        // We need central mass. Since proper orbital params are stored, we can try to assume 
        // they are consistent. However, orientation vectors are not stored in _orbitalParams.
        // We really should store basis vectors in orbitalParams or a separate struct.
        // For now, let's re-calculate them from initialPos/Vel as consistent with buildLUT.

        // This requires access to mu, which we don't have stored directly in the class 
        // in a simple way without passing it in.
        // BUT, we can derive orbit basis vectors purely from state vectors without mu 
        // (except for periapsis direction definition which needs eccentricity vector).
        // Let's use the helper internal method standardizing this.

        return this.calculateAnalyticalPositionInternal(normalizedTime);
    }

    // Helper to share logic between buildLUT and public accessor
    private calculateAnalyticalPositionInternal(normalizedTime: number): THREE.Vector3 {
        // We need the parameters from the time `buildLUT` was called.
        // The safest way is to recalculate the basis vectors from `initialPosition` and `initialVelocity`
        // which define the orbit geometry completely.

        // We need 'mu' to compute 'eVec' correctly for the periapsis direction.
        // However, 'mu' is not stored. 
        // We can solve this: we have 'e' stored in _orbitalParams. 
        // We can reconstruct the frame if we have h (angular momentum).
        // h = r x v. 
        // radius vector in perifocal frame: r = a(1-e^2)/(1+e cos theta)

        // Let's rely on the fact that buildLUT works.
        // We will cache the basis vectors when we build the LUT or calculate params.

        if (!this._cachedOrbitBasis) {
            // If we don't have cached basis, we cannot accurately reconstruct without mu.
            // Fallback: This might fail if central body mass isn't available.
            // But simpler: we Recalculate everything inside buildLUT and cache it there.
            return new THREE.Vector3();
        }

        const { semiMajorAxis, eccentricity } = this._orbitalParams!;
        const { periapsisDir, perpDir, M0 } = this._cachedOrbitBasis;

        // Convert normalized M to absolute M
        // M = M0 + 2PI * t
        // BUT wait, normalizedTime usually means "fraction of period since periapsis" 
        // OR "fraction of period since simulation start".
        // In LUT build: M_normalized = (M - M0) / 2PI.
        // So M = M0 + normalizedTime * 2PI.

        const M_abs = M0 + 2 * Math.PI * normalizedTime;

        // Solve Kepler's Eq: E - e*sin(E) = M
        let E = M_abs;
        for (let iter = 0; iter < 10; iter++) {
            E = M_abs + eccentricity * Math.sin(E);
        }

        const theta = 2 * Math.atan2(
            Math.sqrt(1 + eccentricity) * Math.sin(E / 2),
            Math.sqrt(1 - eccentricity) * Math.cos(E / 2)
        );

        const r = semiMajorAxis * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(theta));
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);

        return new THREE.Vector3()
            .addScaledVector(periapsisDir, x)
            .addScaledVector(perpDir, y);
    }

    private _cachedOrbitBasis: { periapsisDir: THREE.Vector3, perpDir: THREE.Vector3, M0: number } | null = null;


    /**
     * DEPRECATED: Compute total distance error between analytical and bezier positions (symmetric version)
     * @param p1x Control point 1 x coordinate
     * @param p1y Control point 1 y coordinate
     * @param w0 Weight for P0 (and P3 by symmetry)
     * @param w1 Weight for P1 (and P2 by symmetry)
     * @param centralBodyMass Mass of central body
     * @param numSamples Number of sample points around orbit
     * @returns Total sum of squared distances
     */
    private computeWarpError(p1x: number, p1y: number, w0: number, w1: number, centralBodyMass: number, numSamples: number = 50): number {
        if (!this._orbitalParams || !this._orbitalParams.isElliptical) {
            return Infinity;
        }

        const { semiMajorAxis, eccentricity } = this._orbitalParams;
        const bezierCurves = this._trajectory.getBezierCurves();

        if (!bezierCurves || bezierCurves.length === 0) {
            return Infinity;
        }

        const GValue = (G as any).over(gravitationalConstantUnit).value;
        const mu = GValue * centralBodyMass;

        // Calculate orbital basis vectors
        const r0 = this.initialPosition.length();
        const radialVel0 = this.initialVelocity.dot(this.initialPosition.clone().normalize());
        const h = new THREE.Vector3().crossVectors(this.initialPosition, this.initialVelocity);
        const hMag = h.length();
        const theta0 = Math.atan2(hMag * radialVel0, hMag * hMag / r0 - mu);
        const E0 = 2 * Math.atan(Math.sqrt((1 - eccentricity) / (1 + eccentricity)) * Math.tan(theta0 / 2));
        const M0 = E0 - eccentricity * Math.sin(E0);

        const hNorm = h.clone().normalize();
        const vCrossH = new THREE.Vector3().crossVectors(this.initialVelocity, h);
        const eVec = vCrossH.multiplyScalar(1 / mu).sub(this.initialPosition.clone().normalize());
        const eNorm = eVec.clone().normalize();
        const periapsisDir = eNorm;
        const perpDir = new THREE.Vector3().crossVectors(hNorm, periapsisDir).normalize();

        // Temporarily set warp parameters (P2 and weights w2, w3 are computed from symmetry)
        const oldP1x = this._warpP1x;
        const oldP1y = this._warpP1y;
        const oldW0 = this._warpW0;
        const oldW1 = this._warpW1;

        this._warpP1x = p1x;
        this._warpP1y = p1y;
        this._warpW0 = w0;
        this._warpW1 = w1;

        let totalError = 0;

        for (let i = 0; i <= numSamples; i++) {
            const normalizedTime = i / numSamples;

            // Calculate analytical position
            const M = M0 + 2 * Math.PI * normalizedTime;
            let E = M;
            for (let iter = 0; iter < 10; iter++) {
                E = M + eccentricity * Math.sin(E);
            }

            const x = semiMajorAxis * (Math.cos(E) - eccentricity);
            const y = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(E);

            const analyticalPos = new THREE.Vector3()
                .addScaledVector(periapsisDir, x)
                .addScaledVector(perpDir, y);

            // Get bezier position using warped time
            const warpedTime = this.timeWarpFunction(normalizedTime);
            const bezierPos = this.computeBezierPositionFromTime(warpedTime);

            if (bezierPos) {
                const distance = analyticalPos.distanceTo(bezierPos);
                totalError += distance * distance; // Sum of squared errors
            }
        }

        // Restore old parameters (only p1x, p1y, w0, w1 exist - symmetry handles the rest)
        this._warpP1x = oldP1x;
        this._warpP1y = oldP1y;
        this._warpW0 = oldW0;
        this._warpW1 = oldW1;

        return totalError;
    }

    /**
     * Optimize time warp control points using Nelder-Mead simplex method (symmetric version)
     * @param centralBodyMass Mass of central body
     */
    private optimizeTimeWarp(centralBodyMass: number): void {
        console.log('[Time Warp Optimization] Starting symmetric optimization...');

        // Initial simplex: [p1x, p1y, w0, w1] - only 4 independent parameters due to symmetry
        const initial = [this._warpP1x, this._warpP1y, this._warpW0, this._warpW1];

        // Create initial simplex (5 points in 4D space)
        const simplex: number[][] = [
            [...initial],
            [initial[0] + 0.1, initial[1], initial[2], initial[3]],
            [initial[0], initial[1] + 0.1, initial[2], initial[3]],
            [initial[0], initial[1], initial[2] + 0.1, initial[3]],
            [initial[0], initial[1], initial[2], initial[3] + 0.1]
        ];

        // Evaluate initial simplex
        const values = simplex.map(point =>
            this.computeWarpError(point[0], point[1], point[2], point[3], centralBodyMass)
        );

        const maxIterations = 100;
        const alpha = 1.0;  // Reflection
        const gamma = 2.0;  // Expansion
        const rho = 0.5;    // Contraction
        const sigma = 0.5;  // Shrink

        for (let iter = 0; iter < maxIterations; iter++) {
            // Sort simplex by function values
            const indices = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
            const sorted = indices.map(i => simplex[i]);
            const sortedValues = indices.map(i => values[i]);

            // Check for convergence
            const range = sortedValues[sortedValues.length - 1] - sortedValues[0];
            if (range < 0.01) {
                console.log(`[Time Warp Optimization] Converged after ${iter} iterations`);
                break;
            }

            // Compute centroid of best n points
            const centroid = [0, 0, 0, 0];
            for (let i = 0; i < sorted.length - 1; i++) {
                for (let j = 0; j < 4; j++) {
                    centroid[j] += sorted[i][j];
                }
            }
            for (let j = 0; j < 4; j++) {
                centroid[j] /= (sorted.length - 1);
            }

            // Reflection
            const worst = sorted[sorted.length - 1];
            const reflected = centroid.map((c, j) => c + alpha * (c - worst[j]));
            const reflectedValue = this.computeWarpError(reflected[0], reflected[1], reflected[2], reflected[3], centralBodyMass);

            if (reflectedValue < sortedValues[sortedValues.length - 2] && reflectedValue >= sortedValues[0]) {
                // Accept reflection
                simplex[indices[indices.length - 1]] = reflected;
                values[indices[indices.length - 1]] = reflectedValue;
            } else if (reflectedValue < sortedValues[0]) {
                // Try expansion
                const expanded = centroid.map((c, j) => c + gamma * (reflected[j] - c));
                const expandedValue = this.computeWarpError(expanded[0], expanded[1], expanded[2], expanded[3], centralBodyMass);

                if (expandedValue < reflectedValue) {
                    simplex[indices[indices.length - 1]] = expanded;
                    values[indices[indices.length - 1]] = expandedValue;
                } else {
                    simplex[indices[indices.length - 1]] = reflected;
                    values[indices[indices.length - 1]] = reflectedValue;
                }
            } else {
                // Try contraction
                const contracted = centroid.map((c, j) => c + rho * (worst[j] - c));
                const contractedValue = this.computeWarpError(contracted[0], contracted[1], contracted[2], contracted[3], centralBodyMass);

                if (contractedValue < sortedValues[sortedValues.length - 1]) {
                    simplex[indices[indices.length - 1]] = contracted;
                    values[indices[indices.length - 1]] = contractedValue;
                } else {
                    // Shrink
                    for (let i = 1; i < simplex.length; i++) {
                        for (let j = 0; j < 4; j++) {
                            simplex[indices[i]][j] = sorted[0][j] + sigma * (simplex[indices[i]][j] - sorted[0][j]);
                        }
                        values[indices[i]] = this.computeWarpError(
                            simplex[indices[i]][0],
                            simplex[indices[i]][1],
                            simplex[indices[i]][2],
                            simplex[indices[i]][3],
                            centralBodyMass
                        );
                    }
                }
            }
        }

        // Use best solution
        const bestIndex = values.indexOf(Math.min(...values));
        const best = simplex[bestIndex];

        this._warpP1x = best[0];
        this._warpP1y = best[1];
        this._warpW0 = best[2];
        this._warpW1 = best[3];

        const p2x = 1 - best[0];
        const p2y = 1 - best[1];
        console.log(`[Time Warp Optimization] Optimized control points: P1=(${best[0].toFixed(3)}, ${best[1].toFixed(3)}), P2=(${p2x.toFixed(3)}, ${p2y.toFixed(3)}) [symmetric]`);
        console.log(`[Time Warp Optimization] Optimized weights: w0=${best[2].toFixed(3)}, w1=${best[3].toFixed(3)}, w2=${best[3].toFixed(3)}, w3=${best[2].toFixed(3)} [symmetric]`);
        console.log(`[Time Warp Optimization] Final error: ${Math.min(...values).toFixed(2)}`);
    }

    /**
     * Enable bezier animation mode
     * Body will follow bezier curve approximation with same period as analytical orbit
     * Automatically enables dual-rendering to show both analytical and bezier positions
     */
    enableBezierAnimation(currentTime: number, centralBodyMass: number, G: GenericMeasure<number, any, any>): void {
        // Calculate orbital parameters if not already set
        if (!this._orbitalParams) {
            this.calculateOrbitalParameters(centralBodyMass, G, currentTime);
        }

        // Bezier curves start at the same position as initial conditions
        // So animation always starts at curve 0, t=0
        this._bezierStartCurveIndex = 0;
        this._bezierStartCurveT = 0;

        // Build time warp LUT sampled evenly in Eccentric Anomaly
        this.buildTimeWarpLUT(centralBodyMass);

        this._bezierAnimationEnabled = true;
        this._bezierAnimationStartTime = currentTime;

        // Automatically enable dual-rendering mode
        this.setDualRenderingEnabled(true);

        console.log(`[Bezier Animation] Starting at curve ${this._bezierStartCurveIndex}, t=${this._bezierStartCurveT.toFixed(3)} with LUT-based time warp function`);
        console.log(`[Bezier Animation] Dual-rendering automatically enabled`);
    }

    /**
     * Disable bezier animation mode (return to normal analytical/numerical updates)
     */
    disableBezierAnimation(): void {
        this._bezierAnimationEnabled = false;
    }

    /**
     * Check if bezier animation is enabled
     */
    isBezierAnimationEnabled(): boolean {
        return this._bezierAnimationEnabled;
    }

    getCurrentNormalizedTime(): number | null {
        if (!this._bezierAnimationEnabled) {
            return null;
        }

        const params = this._trajectory.getParameters();
        if (!params) {
            return null;
        }

        const period = (params.period as any).over(require('./units').seconds).value;
        const elapsedTime = this._currentTime - this._bezierAnimationStartTime;
        const rawNormalizedTime = (elapsedTime % period) / period;

        return rawNormalizedTime;
    }

    /**
     * Get trail points (sub-sampled to 10 segments for rendering)
     */
    getTrailPoints(): THREE.Vector3[] {
        return this._render.getTrailPoints();
    }

    /**
     * Get mesh
     */
    getMesh(): THREE.Mesh {
        return this._render.mesh;
    }

    /**
     * Set time scale (for trajectory calculations)
     */
    setTimeScale(scale: number): void {
        // Time scale can be used for trajectory calculations if needed
    }

    /**
     * Clear LUT sample markers from the scene
     */
    private clearLUTMarkers(): void {
        for (const marker of this._lutSampleMarkers) {
            this._scene.remove(marker);
            // Sprites don't have geometry, only material and texture
            if (marker.material.map) {
                marker.material.map.dispose();
            }
            marker.material.dispose();
        }
        this._lutSampleMarkers = [];
    }

    /**
     * Show LUT sample markers
     */
    public showLUTMarkers(): void {
        for (const marker of this._lutSampleMarkers) {
            marker.visible = true;
        }
    }

    /**
     * Hide LUT sample markers
     */
    public hideLUTMarkers(): void {
        for (const marker of this._lutSampleMarkers) {
            marker.visible = false;
        }
    }

    /**
     * Get LUT sample positions (Mean Anomaly values)
     */
    public getLUTSamplePositions(): number[] {
        if (!this._timeWarpLUT) {
            return [];
        }
        // Return M values without the wraparound points (start and end padding)
        return this._timeWarpLUT.M.slice(1, -1);
    }

    /**
     * Get full LUT data for inspection
     */
    public getLUTData(): { M: number[], bezierT: number[], bezierPoints: { p1: number, p2: number }[], errors: number[] } | null {
        return this._timeWarpLUT;
    }

    /**
     * Cleanup and remove from scene
     */
    dispose(): void {
        this.clearLUTMarkers();
        this._trajectory.clear();
        this._render.cleanup();
    }
}
