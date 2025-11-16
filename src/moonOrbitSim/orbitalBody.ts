import * as THREE from 'three';
import { Trajectory } from './trajectory';

/**
 * OrbitalBody class representing a celestial body with position, velocity, mass, and a trajectory
 */
export class OrbitalBody {
    private position: THREE.Vector3;
    private velocity: THREE.Vector3;
    private initialPosition: THREE.Vector3;
    private initialVelocity: THREE.Vector3;
    private mass: number;
    private radius: number;
    private name: string;
    private trajectory: Trajectory;
    private mesh: THREE.Mesh;
    private trailPoints: THREE.Vector3[] = [];
    private maxTrailPoints: number = 500;
    private scene: THREE.Scene;

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
        this.scene = scene;
        this.position = position.clone();
        this.velocity = velocity.clone();
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();
        this.mass = mass;
        this.radius = radius;
        this.name = name;

        // Create mesh for the body
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshPhongMaterial({ color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);

        // Create trajectory (one per body)
        this.trajectory = new Trajectory(scene, trajectoryColor);
        this.trailPoints = [position.clone()];
    }

    /**
     * Update position and velocity based on gravitational force
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: number): void {
        const r = this.position.clone().sub(centralBodyPosition);
        const distance = r.length();
        
        // Prevent division by zero and extreme forces at very small distances
        if (distance >= 2.5) {
            const force = r.normalize().multiplyScalar(
                -G * this.mass * centralBodyMass / (distance * distance)
            );

            // Update velocity and position using Euler integration
            this.velocity.add(force.multiplyScalar(dt / this.mass));
            this.position.add(this.velocity.clone().multiplyScalar(dt));
        }

        // Update mesh position
        this.mesh.position.copy(this.position);

        // Add to trail
        this.trailPoints.push(this.position.clone());
        if (this.trailPoints.length > this.maxTrailPoints) {
            this.trailPoints.shift();
        }
    }

    /**
     * Reset to initial conditions and recalculate trajectory
     */
    reset(position: THREE.Vector3, velocity: THREE.Vector3, mass: number, centralBodyMass: number): void {
        this.position.copy(position);
        this.velocity.copy(velocity);
        this.mass = mass;
        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Clear trail
        this.trailPoints = [position.clone()];

        // Recalculate trajectory
        this.trajectory.clear();
        this.trajectory.calculateFromState(position, velocity, centralBodyMass);
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
        return this.trajectory;
    }

    /**
     * Get trail points
     */
    getTrailPoints(): THREE.Vector3[] {
        return this.trailPoints;
    }

    /**
     * Get mesh
     */
    getMesh(): THREE.Mesh {
        return this.mesh;
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
        this.trajectory.clear();
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) {
            this.mesh.material.dispose();
        }
    }
}

