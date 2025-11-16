import * as THREE from 'three';
import { OrbitalBody } from './orbitalBody';
import { CameraManager } from './cameraManager';
import { G, config, hexToNumber } from './config';

/**
 * Main game loop class that manages the simulation, rendering, and update cycle
 */
export class GameLoop {
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private cameraManager!: CameraManager;
    private animationFrameId: number = 0;
    
    // Simulation state
    private centralBody!: OrbitalBody;
    private orbitalBodies: OrbitalBody[] = [];
    private currentTime: number = 0;
    private timeScale: number = config.physics.defaultTimeScale;
    private dt: number = config.physics.timeStep;
    private isRunning: boolean = false;

    // Trail rendering
    private trailLines: Map<OrbitalBody, THREE.Line> = new Map();

    constructor() {
        this.initScene();
        this.initLights();
        this.initCentralBody();
        this.initCameraManager();
    }

    private initScene(): void {
        this.scene = new THREE.Scene();
        const cameraConfig = config.scene.camera;
        this.camera = new THREE.PerspectiveCamera(
            cameraConfig.fov,
            window.innerWidth / window.innerHeight,
            cameraConfig.near,
            cameraConfig.far
        );
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        // Camera and controls are initialized in CameraManager
        this.camera.position.set(
            cameraConfig.position[0],
            cameraConfig.position[1],
            cameraConfig.position[2]
        );
        this.camera.lookAt(this.scene.position);

        // Add axes helper
        const axesHelper = new THREE.AxesHelper(config.scene.axes.size);
        this.scene.add(axesHelper);

        // Add dark grey grid on xz plane with 1000km intervals
        const gridConfig = config.scene.grid;
        const gridColor = hexToNumber(gridConfig.color);
        const gridHelper = new THREE.GridHelper(gridConfig.size, gridConfig.divisions, gridColor, gridColor);
        this.scene.add(gridHelper);
    }

    private initCameraManager(): void {
        this.cameraManager = new CameraManager(
            this.camera,
            this.renderer,
            this.centralBody,
            this.orbitalBodies
        );

        // Handle window resize (after camera manager is initialized)
        window.addEventListener('resize', () => {
            this.cameraManager.handleResize();
        });
    }

    private initLights(): void {
        const lightsConfig = config.scene.lights;
        const ambientLight = new THREE.AmbientLight(hexToNumber(lightsConfig.ambient.color));
        this.scene.add(ambientLight);

        const dirConfig = lightsConfig.directional;
        const directionalLight = new THREE.DirectionalLight(hexToNumber(dirConfig.color), dirConfig.intensity);
        directionalLight.position.set(
            dirConfig.position[0],
            dirConfig.position[1],
            dirConfig.position[2]
        );
        this.scene.add(directionalLight);
    }

    private initCentralBody(): void {
        // Create central body (Earth) at origin with actual Earth parameters
        const centralPosition = new THREE.Vector3(0, 0, 0);
        const centralVelocity = new THREE.Vector3(0, 0, 0);
        const earthConfig = config.bodies.earth;
        
        this.centralBody = new OrbitalBody(
            this.scene,
            centralPosition,
            centralVelocity,
            earthConfig.mass,
            earthConfig.radius,
            hexToNumber(earthConfig.color || '3366cc'),
            0x000000, // no trajectory color (central body doesn't orbit)
            earthConfig.name
        );
    }

    /**
     * Add an orbital body to the simulation
     */
    addOrbitalBody(
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        mass: number,
        radius: number = 1.0,
        color: number = 0xcccccc,
        trajectoryColor: number = 0xff6666,
        name: string = 'Unnamed'
    ): OrbitalBody {
        const body = new OrbitalBody(
            this.scene,
            position,
            velocity,
            mass,
            radius,
            color,
            trajectoryColor,
            name
        );

        // Calculate initial trajectory
        body.getTrajectory().calculateFromState(position, velocity, this.centralBody.getMass());

        // Create trail line
        const trailConfig = config.trail;
        const trailGeometry = new THREE.BufferGeometry();
        const trailLine = new THREE.Line(
            trailGeometry,
            new THREE.LineBasicMaterial({ 
                color: hexToNumber(trailConfig.color), 
                opacity: trailConfig.opacity 
            })
        );
        this.scene.add(trailLine);
        this.trailLines.set(body, trailLine);

        this.orbitalBodies.push(body);
        
        // Update camera manager with new body list
        this.cameraManager.updateOrbitalBodies(this.orbitalBodies);
        
        return body;
    }

    /**
     * Remove an orbital body from the simulation
     */
    removeOrbitalBody(body: OrbitalBody): void {
        const index = this.orbitalBodies.indexOf(body);
        if (index > -1) {
            this.orbitalBodies.splice(index, 1);
            
            // Remove trail line
            const trailLine = this.trailLines.get(body);
            if (trailLine) {
                this.scene.remove(trailLine);
                trailLine.geometry.dispose();
                if (trailLine.material instanceof THREE.Material) {
                    trailLine.material.dispose();
                }
                this.trailLines.delete(body);
            }
            
            body.dispose();
        }
        
        // Update camera manager with new body list
        this.cameraManager.updateOrbitalBodies(this.orbitalBodies);
    }

    /**
     * Reset an orbital body with new parameters
     */
    resetOrbitalBody(body: OrbitalBody, position: THREE.Vector3, velocity: THREE.Vector3, mass: number): void {
        body.reset(position, velocity, mass, this.centralBody.getMass());
        
        // Clear trail
        const trailLine = this.trailLines.get(body);
        if (trailLine) {
            trailLine.geometry.setFromPoints([]);
        }
    }

    /**
     * Set time scale for simulation
     */
    setTimeScale(scale: number): void {
        this.timeScale = scale;
        this.orbitalBodies.forEach(body => body.setTimeScale(scale));
    }

    /**
     * Start the game loop
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.currentTime = 0;
        this.gameLoop();
    }

    /**
     * Stop the game loop
     */
    stop(): void {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = 0;
        }
    }

    /**
     * Main game loop
     */
    private gameLoop = (): void => {
        if (!this.isRunning) return;

        this.animationFrameId = requestAnimationFrame(this.gameLoop);

        try {
            // Update simulation
            this.update();

            // Render scene
            this.render();
        } catch (error) {
            console.error('Error in game loop:', error);
        }
    };

    /**
     * Update simulation state
     */
    private update(): void {
        const scaledDt = this.dt * this.timeScale;
        this.currentTime += scaledDt;

        const centralPosition = this.centralBody.getPosition();
        const centralMass = this.centralBody.getMass();

        // Update all orbital bodies
        this.orbitalBodies.forEach(body => {
            body.update(scaledDt, centralPosition, centralMass, G);

            // Update trail
            const trailLine = this.trailLines.get(body);
            if (trailLine) {
                trailLine.geometry.setFromPoints(body.getTrailPoints());
            }
        });
    }

    /**
     * Render the scene
     */
    private render(): void {
        // Update camera (handles target tracking, mouse input, zoom, etc.)
        this.cameraManager.update();
        
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Get the scene (for UI integration)
     */
    getScene(): THREE.Scene {
        return this.scene;
    }

    /**
     * Get all orbital bodies
     */
    getOrbitalBodies(): OrbitalBody[] {
        return this.orbitalBodies;
    }

    /**
     * Get central body
     */
    getCentralBody(): OrbitalBody {
        return this.centralBody;
    }

    /**
     * Get current simulation time
     */
    getCurrentTime(): number {
        return this.currentTime;
    }

    /**
     * Get time scale
     */
    getTimeScale(): number {
        return this.timeScale;
    }

    /**
     * Get camera manager (for UI integration)
     */
    getCameraManager(): CameraManager {
        return this.cameraManager;
    }
}

