import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Mass, Measure, Length, Velocity, kilograms, kilometers, seconds, GenericMeasure, gravitationalConstantUnit } from './units';

/**
 * OrbitalBody class representing a celestial body with position, velocity, mass, and a trajectory
 */
export class OrbitalBody {
    private _position: THREE.Vector3;      // Private - use underscore prefix
    private _velocity: THREE.Vector3;      // Private - use underscore prefix
    public initialPosition: THREE.Vector3;  // Public for UI inspection
    public initialVelocity: THREE.Vector3;   // Public for UI inspection
    public mass: number;                     // Public for UI inspection
    public radius: number;
    public name: string;
    private _trajectory: Trajectory;        // Private - use underscore prefix
    private _mesh: THREE.Mesh;              // Private - use underscore prefix
    private _dotSprite: THREE.Sprite;       // Private - use underscore prefix for 2D dot rendering
    private _useDotRendering: boolean = false;  // Private - use underscore prefix
    private _trailPoints: THREE.Vector3[] = [];  // Private - use underscore prefix
    private _maxTrailPoints: number = 100; // Private - use underscore prefix
    private _scene: THREE.Scene;            // Private - use underscore prefix

    constructor(
        scene: THREE.Scene,
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        mass: number,
        radius: number = 1.0,
        color: number = 0xcccccc,
        trajectoryColor: number = 0xff6666,
        name: string = 'Unnamed'
    ) {
        this._scene = scene;
        this._position = position.clone();
        this._velocity = velocity.clone();
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();
        this.mass = mass;
        this.radius = radius;
        this.name = name;

        // Create mesh for the body
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({ color });
        this._mesh = new THREE.Mesh(geometry, material);
        this._mesh.position.copy(this._position);
        scene.add(this._mesh);

        // Create dot sprite for far-away rendering
        const dotTexture = this.createDotTexture(color);
        const spriteMaterial = new THREE.SpriteMaterial({ 
            map: dotTexture,
            sizeAttenuation: false,  // Size stays constant regardless of distance
            depthTest: true
        });
        this._dotSprite = new THREE.Sprite(spriteMaterial);
        this._dotSprite.scale.set(0.01, 0.01, 1);  // 10x10 pixel scale for screen-space size
        this._dotSprite.position.copy(this._position);
        // Don't add to scene yet - will be added when needed

        // Create trajectory (one per body)
        this._trajectory = new Trajectory(scene, trajectoryColor);
        this._trailPoints = [position.clone()];
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
    private calculateScreenSize(camera: THREE.Camera): number {
        if (!(camera instanceof THREE.PerspectiveCamera)) {
            return Infinity; // Default to mesh rendering for non-perspective cameras
        }

        // Calculate distance from camera to body
        const distance = camera.position.distanceTo(this._position);
        
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
    updateRenderingMode(camera: THREE.Camera): void {
        const screenSize = this.calculateScreenSize(camera);
        const shouldUseDot = screenSize < 10;  // Use dot if body is less than 10 pixels
        
        if (shouldUseDot !== this._useDotRendering) {
            this._useDotRendering = shouldUseDot;
            
            if (this._useDotRendering) {
                // Switch to dot rendering
                this._scene.remove(this._mesh);
                this._scene.add(this._dotSprite);
            } else {
                // Switch to mesh rendering
                this._scene.remove(this._dotSprite);
                this._scene.add(this._mesh);
            }
        }
        
        // Update position for whichever is visible
        if (this._useDotRendering) {
            this._dotSprite.position.copy(this._position);
        } else {
            this._mesh.position.copy(this._position);
        }
    }

    /**
     * Update position and velocity based on gravitational force
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>): void {
        const r = this._position.clone().sub(centralBodyPosition);
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
            this._velocity.add(force.multiplyScalar(dt / this.mass));
            
            // Update position: r += v * dt
            // Units: km/s * s = km
            this._position.add(this._velocity.clone().multiplyScalar(dt));
        }

        // Note: mesh/sprite position is updated in updateRenderingMode(), called from game loop

        // Update trajectory current state (altitude and velocity)
        const positionVec = MeasureVector3.fromVector3<Length>(this._position, kilometers);
        const velocityVec = MeasureVector3.fromVector3<Velocity>(this._velocity, kilometers.per(seconds));
        this._trajectory.updateCurrentState(positionVec, velocityVec);

        // Add to trail
        this._trailPoints.push(this._position.clone());
        if (this._trailPoints.length > this._maxTrailPoints) {
            this._trailPoints.shift();
        }
    }

    /**
     * Reset to initial conditions and recalculate trajectory
     */
    reset(position: THREE.Vector3, velocity: THREE.Vector3, mass: number, centralBodyMass: number, radius?: number): void {
        this._position.copy(position);
        this._velocity.copy(velocity);
        this.mass = mass;
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Update radius and regenerate mesh if radius is provided
        if (radius !== undefined && radius !== this.radius) {
            this.radius = radius;
            
            // Remove old mesh
            this._scene.remove(this._mesh);
            this._mesh.geometry.dispose();
            if (this._mesh.material instanceof THREE.Material) {
                this._mesh.material.dispose();
            }
            
            // Create new mesh with updated radius
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            const material = new THREE.MeshPhongMaterial({ color: (this._mesh.material as THREE.MeshPhongMaterial).color });
            this._mesh = new THREE.Mesh(geometry, material);
            this._mesh.position.copy(this._position);
            this._scene.add(this._mesh);
        }

        // Clear trail
        this._trailPoints = [position.clone()];

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
        this._position.copy(this.initialPosition);
        this._velocity.copy(this.initialVelocity);

        // Clear trail
        this._trailPoints = [this.initialPosition.clone()];

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
        return this._position.clone();
    }

    /**
     * Get current velocity
     */
    getVelocity(): THREE.Vector3 {
        return this._velocity.clone();
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
        if (this._trailPoints.length <= 11) {
            return this._trailPoints;
        }
        
        // Sub-sample to approximately 10 line segments (11 points)
        const sampledPoints: THREE.Vector3[] = [];
        const step = (this._trailPoints.length - 1) / 10;
        
        for (let i = 0; i < 11; i++) {
            const index = Math.floor(i * step);
            sampledPoints.push(this._trailPoints[index]);
        }
        
        return sampledPoints;
    }

    /**
     * Get mesh
     */
    getMesh(): THREE.Mesh {
        return this._mesh;
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
        this._scene.remove(this._mesh);
        this._scene.remove(this._dotSprite);
        this._mesh.geometry.dispose();
        if (this._mesh.material instanceof THREE.Material) {
            this._mesh.material.dispose();
        }
        if (this._dotSprite.material.map) {
            this._dotSprite.material.map.dispose();
        }
        this._dotSprite.material.dispose();
    }
}

