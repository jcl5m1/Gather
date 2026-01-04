import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Mass, Measure, Length, Velocity, kilograms, kilometers, seconds, GenericMeasure, gravitationalConstantUnit } from './units';
import { Body } from './types';
import { calculateEllipticalPosition, calculateEllipticalVelocity, calculateHyperbolicPosition, calculateHyperbolicVelocity } from './orbitUtils';
import { ORBIT_UPDATE_METHOD } from './config';

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
    
    // Orbital parameters for analytical updates
    private _orbitalParams: {
        semiMajorAxis: number;      // a (km)
        eccentricity: number;       // e (dimensionless)
        period: number;             // T (seconds) - only for elliptical orbits
        startTime: number;          // t0 (seconds) - simulation time when orbit was calculated
        isElliptical: boolean;      // true for elliptical, false for hyperbolic
    } | null = null;

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
     */
    updateRenderingMode(camera: THREE.Camera): void {
        this._render.updateRenderingMode(this.position, camera);
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
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>, currentTime: number = 0): void {
        // Choose update method based on configuration
        if (ORBIT_UPDATE_METHOD === 'analytical') {
            this.updateAnalytical(currentTime, centralBodyPosition, centralBodyMass, G);
        } else {
            this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
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
     * Get current position
     */
    getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    /**
     * Get current velocity
     */
    getVelocity(): THREE.Vector3 {
        return this.velocity.clone();
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
     * Cleanup and remove from scene
     */
    dispose(): void {
        this._trajectory.clear();
        this._render.cleanup();
    }
}
