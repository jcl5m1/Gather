import * as THREE from 'three';
import { OrbitalBody } from './orbitalBody';
import { CameraManager } from './cameraManager';
import { G, config, hexToNumber } from './config';
import { generateStateFromOrbitalElements } from './orbitUtils';

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
        this.setupKeyboardControls();
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
        
        // Update camera manager with new body list and pass the newly added body
        // This will automatically switch camera to the new body if no orbital body is currently focused
        this.cameraManager.updateOrbitalBodies(this.orbitalBodies, body);
        
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
     * Reset all simulation parameters and all orbital bodies to initial conditions
     */
    resetAll(): void {
        // Reset time scale to default
        this.timeScale = config.physics.defaultTimeScale;
        
        // Reset current time
        this.currentTime = 0;
        
        // Reset all orbital bodies to their initial conditions
        const centralMass = this.centralBody.getMass();
        this.orbitalBodies.forEach(body => {
            body.resetToInitial(centralMass);
            
            // Clear trail
            const trailLine = this.trailLines.get(body);
            if (trailLine) {
                trailLine.geometry.setFromPoints([]);
            }
        });
    }

    /**
     * Remove all orbital bodies (for full reset)
     * This completely clears the orbital bodies array and frees all resources
     */
    removeAllOrbitalBodies(): void {
        // Create a copy of the array to avoid modification during iteration
        const bodiesToRemove = [...this.orbitalBodies];
        bodiesToRemove.forEach(body => {
            this.removeOrbitalBody(body);
        });
        
        // Explicitly clear the array to ensure it's empty
        // (removeOrbitalBody should have removed all, but this ensures it)
        this.orbitalBodies.length = 0;
        
        // Verify the array is empty
        if (this.orbitalBodies.length !== 0) {
            console.warn('Warning: orbitalBodies array is not empty after removeAllOrbitalBodies()');
        }
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
     * Reset current simulation time to 0
     */
    resetCurrentTime(): void {
        this.currentTime = 0;
    }

    /**
     * Get camera manager (for UI integration)
     */
    getCameraManager(): CameraManager {
        return this.cameraManager;
    }

    /**
     * Setup keyboard controls for creating random orbital bodies
     * NOTE: Space key is now handled by UIManager to trigger RESET_ALL
     * This method is kept for potential future use but space handler is disabled
     */
    private setupKeyboardControls(): void {
        // Space key handling moved to UIManager to go through command interface
        // If random body creation is needed, it should be done via command: ADD_RANDOM_BODY
    }

    /**
     * Create a random orbital body with specified constraints
     */
    private createRandomOrbitalBody(): void {
        // Generate random eccentricity between 0.2 and 0.8
        const e = 0.2 + Math.random() * 0.6;
        
        // Generate random periapsis > 50km
        const rp = 50 + Math.random() * 450; // 50 to 500 km
        
        // Calculate apapsis from eccentricity and periapsis
        // e = (ra - rp) / (ra + rp) => ra = rp * (1 + e) / (1 - e)
        const ra = rp * (1 + e) / (1 - e);
        
        // Ensure apapsis < 1000km
        if (ra >= 1000) {
            // Adjust periapsis to meet constraint
            // ra = rp * (1 + e) / (1 - e) < 1000
            // rp < 1000 * (1 - e) / (1 + e)
            const maxRp = 1000 * (1 - e) / (1 + e);
            if (maxRp <= 50) {
                // If even minimum periapsis gives too large apapsis, reduce eccentricity
                const maxE = (1000 - rp) / (1000 + rp);
                const adjustedE = Math.min(e, maxE);
                const adjustedRa = rp * (1 + adjustedE) / (1 - adjustedE);
                console.log(`[Random Body] Adjusted eccentricity from ${e.toFixed(3)} to ${adjustedE.toFixed(3)} to meet apapsis constraint`);
                this.createBodyFromOrbitalParams(rp, adjustedRa, adjustedE);
            } else {
                const adjustedRp = 50 + Math.random() * (maxRp - 50);
                const adjustedRa = adjustedRp * (1 + e) / (1 - e);
                console.log(`[Random Body] Adjusted periapsis from ${rp.toFixed(1)}km to ${adjustedRp.toFixed(1)}km to meet apapsis constraint`);
                this.createBodyFromOrbitalParams(adjustedRp, adjustedRa, e);
            }
        } else {
            this.createBodyFromOrbitalParams(rp, ra, e);
        }
    }

    /**
     * Create an orbital body from orbital parameters using the command interface
     */
    private createBodyFromOrbitalParams(rp: number, ra: number, e: number): void {
        const centralMass = this.centralBody.getMass();
        
        // Generate random orbital orientation
        const trueAnomaly = Math.random() * 2 * Math.PI; // Random position along orbit
        const inclination = (Math.random() - 0.5) * Math.PI; // Random inclination
        const longitudeOfAscendingNode = Math.random() * 2 * Math.PI;
        const argumentOfPeriapsis = Math.random() * 2 * Math.PI;
        
        // Generate position and velocity from orbital elements
        const { position, velocity } = generateStateFromOrbitalElements(
            rp,
            ra,
            e,
            centralMass,
            trueAnomaly,
            inclination,
            longitudeOfAscendingNode,
            argumentOfPeriapsis
        );
        
        // Generate random color
        const hue = Math.random() * 360;
        const color = new THREE.Color().setHSL(hue / 360, 0.7, 0.5);
        const colorHex = color.getHexString();
        
        // Generate random trajectory color (lighter shade)
        const trajectoryColor = new THREE.Color().setHSL(hue / 360, 0.5, 0.7);
        const trajectoryColorHex = trajectoryColor.getHexString();
        
        // Small mass and radius for the body
        const mass = 1e10; // Small mass in kg
        const radius = 10; // 10 km radius
        
        // Create body name
        const bodyName = `RandomBody_${this.orbitalBodies.length + 1}`;
        
        // Use command interface to add the body (same code path as text commands)
        const simulationController = (window as any).simulationController;
        if (simulationController) {
            const command = `ADD_BODY position:${position.x},${position.y},${position.z} velocity:${velocity.x},${velocity.y},${velocity.z} mass:${mass} id:${bodyName} radius:${radius} color:${colorHex} trajectoryColor:${trajectoryColorHex}`;
            const result = simulationController.executeCommand(command);
            
            if (result.success) {
                console.log(`[Random Body] Created ${bodyName}:`, {
                    periapsis: `${rp.toFixed(1)} km`,
                    apapsis: `${ra.toFixed(1)} km`,
                    eccentricity: e.toFixed(3),
                    semiMajorAxis: `${((rp + ra) / 2).toFixed(1)} km`
                });
            } else {
                console.error(`[Random Body] Failed to create ${bodyName}:`, result.message);
            }
        } else {
            console.error('[Random Body] SimulationController not available. Cannot create body via command interface.');
        }
    }
}

