import * as THREE from 'three';
import { Trajectory } from './trajectory';

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
    private _trailPoints: THREE.Vector3[] = [];  // Private - use underscore prefix
    private _maxTrailPoints: number = 500; // Private - use underscore prefix
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

        // Create trajectory (one per body)
        this._trajectory = new Trajectory(scene, trajectoryColor);
        this._trailPoints = [position.clone()];
    }

    /**
     * Update position and velocity based on gravitational force
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²)
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: number): void {
        const r = this._position.clone().sub(centralBodyPosition);
        const distance = r.length(); // km
        
        // Prevent division by zero and extreme forces at very small distances
        if (distance >= 2.5) {
            // Force = -G * m1 * m2 / r²
            // Units: G (km³/(kg·s²)) * mass (kg) * mass (kg) / distance² (km²) = kg·km/s²
            const force = r.normalize().multiplyScalar(
                -G * this.mass * centralBodyMass / (distance * distance)
            );

            // Update velocity: v += a * dt = (F/m) * dt
            // Units: (kg·km/s² / kg) * s = km/s
            this._velocity.add(force.multiplyScalar(dt / this.mass));
            
            // Update position: r += v * dt
            // Units: km/s * s = km
            this._position.add(this._velocity.clone().multiplyScalar(dt));
        }

        // Update mesh position
        this._mesh.position.copy(this._position);

        // Update trajectory current state (altitude and velocity)
        this._trajectory.updateCurrentState(this._position, this._velocity);

        // Add to trail
        this._trailPoints.push(this._position.clone());
        if (this._trailPoints.length > this._maxTrailPoints) {
            this._trailPoints.shift();
        }
    }

    /**
     * Reset to initial conditions and recalculate trajectory
     */
    reset(position: THREE.Vector3, velocity: THREE.Vector3, mass: number, centralBodyMass: number): void {
        this._position.copy(position);
        this._velocity.copy(velocity);
        this.mass = mass;
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Clear trail
        this._trailPoints = [position.clone()];

        // Recalculate trajectory
        this._trajectory.clear();
        this._trajectory.calculateFromState(position, velocity, centralBodyMass);
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
        this._trajectory.calculateFromState(this.initialPosition, this.initialVelocity, centralBodyMass);
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
     * Get trail points
     */
    getTrailPoints(): THREE.Vector3[] {
        return this._trailPoints;
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
        this._mesh.geometry.dispose();
        if (this._mesh.material instanceof THREE.Material) {
            this._mesh.material.dispose();
        }
    }
}

