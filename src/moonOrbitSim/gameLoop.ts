import * as THREE from 'three';
import { OrbitalBody } from './orbitalBody';
import { CameraManager } from './cameraManager';
import { G, config, hexToNumber } from './config';
import { generateStateFromOrbitalElements } from './orbitUtils';
import { kilometers, kilograms, seconds, Mass, Measure, Length, Velocity } from './units';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';

// Shader for fading trail
const TRAIL_VERTEX_SHADER = `
attribute float alpha;
varying float vAlpha;
void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAGMENT_SHADER = `
uniform vec3 color;
varying float vAlpha;
void main() {
    gl_FragColor = vec4(color, vAlpha);
}
`;

/**
 * Main game loop class that manages the simulation, rendering, and update cycle
 */
export class GameLoop {
    private _scene!: THREE.Scene;
    private _camera!: THREE.PerspectiveCamera;
    private _renderer!: THREE.WebGLRenderer;
    private _cameraManager!: CameraManager;
    private _animationFrameId: number = 0;

    // Simulation state - properties with underscores are not shown in inspector
    private _centralBody!: OrbitalBody;
    private _orbitalBodies: OrbitalBody[] = [];
    public currentTime: number = 0;  // Shown in inspector
    public timeScale: number = config.physics.defaultTimeScale;  // Shown in inspector
    public fps: number = 0;  // Shown in inspector
    public bodyCount: number = 0;  // Shown in inspector
    private _dt: number = 0;  // Calculated from real-world time, initialized on first frame
    private _lastFrameTime: number = 0;
    private _isRunning: boolean = false;
    private _frameCount: number = 0;
    private _fpsUpdateTime: number = 0;

    // Trail rendering
    private _trailLines: Map<OrbitalBody, THREE.Line> = new Map();
    private _trajectoriesVisible: boolean = true;

    // Plot update callbacks
    private _plotUpdateCallbacks: Array<() => void> = [];

    constructor() {
        this.initScene();
        this.initLights();
        this.initCentralBody();
        this.initCameraManager();
        this.setupKeyboardControls();
    }

    private initScene(): void {
        this._scene = new THREE.Scene();
        const cameraConfig = config.scene.camera;
        // Extract numeric values from Measure types
        const near = cameraConfig.near.over(kilometers).value;
        const far = cameraConfig.far.over(kilometers).value;
        this._camera = new THREE.PerspectiveCamera(
            cameraConfig.fov,
            window.innerWidth / window.innerHeight,
            near,
            far
        );
        this._renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
            logarithmicDepthBuffer: true
        });
        this._renderer.setSize(window.innerWidth, window.innerHeight);
        this._renderer.setPixelRatio(window.devicePixelRatio);
        document.body.appendChild(this._renderer.domElement);

        // Camera and controls are initialized in CameraManager
        this._camera.position.copy(cameraConfig.position);
        this._camera.lookAt(this._scene.position);

        // Add axes helper
        // const axesSize = config.scene.axes.size.over(kilometers).value;
        // const axesHelper = new THREE.AxesHelper(axesSize);
        // if (axesHelper.material instanceof THREE.Material) {
        //     axesHelper.material.depthTest = true;
        //     axesHelper.material.depthWrite = true;
        // }
        // this._scene.add(axesHelper);

        // Add dark grey grid on xz plane with 1000km intervals
        const gridConfig = config.scene.grid;
        const gridColor = hexToNumber(gridConfig.color);
        const gridSize = gridConfig.size.over(kilometers).value;
        const gridHelper = new THREE.GridHelper(gridSize, gridConfig.divisions, gridColor, gridColor);
        if (gridHelper.material instanceof THREE.Material) {
            gridHelper.material.depthTest = true;
            gridHelper.material.depthWrite = true;
        }
        this._scene.add(gridHelper);

        // Add fog if configured
        if (config.scene.fog) {
            const fogConfig = config.scene.fog;
            const fogColor = hexToNumber(fogConfig.color);
            const fogNear = fogConfig.near.over(kilometers).value;
            const fogFar = fogConfig.far.over(kilometers).value;
            this._scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
        }
    }

    private initCameraManager(): void {
        this._cameraManager = new CameraManager(
            this._camera,
            this._renderer,
            this._centralBody,
            this._orbitalBodies
        );

        // Set GameLoop reference so CameraManager can access all bodies
        this._cameraManager.setGameLoop(this);

        // Handle window resize (after camera manager is initialized)
        window.addEventListener('resize', () => {
            this._cameraManager.handleResize();
        });
    }

    private initLights(): void {
        const lightsConfig = config.scene.lights;
        const ambientLight = new THREE.AmbientLight(hexToNumber(lightsConfig.ambient.color));
        this._scene.add(ambientLight);

        const dirConfig = lightsConfig.directional;
        const directionalLight = new THREE.DirectionalLight(hexToNumber(dirConfig.color), dirConfig.intensity);
        directionalLight.position.copy(dirConfig.position);
        this._scene.add(directionalLight);
    }

    private initCentralBody(): void {
        // Create central body (Earth) at origin with actual Earth parameters
        const centralPosition = new THREE.Vector3(0, 0, 0);
        const centralVelocity = new THREE.Vector3(0, 0, 0);
        const earthBody = config.bodies.earth;

        this._centralBody = new OrbitalBody(
            this._scene,
            centralPosition,
            centralVelocity,
            earthBody.mass,
            earthBody.radius,
            hexToNumber(earthBody.color || '3366cc'),
            0x000000, // no trajectory color (central body doesn't orbit)
            earthBody.name,
            '',
            earthBody.texture
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
        name: string = 'Unnamed',
        parentId: string = '',
        texture?: string
    ): OrbitalBody {
        const body = new OrbitalBody(
            this._scene,
            position,
            velocity,
            mass,
            radius,
            color,
            trajectoryColor,
            name,
            parentId,
            texture
        );

        // Calculate initial trajectory
        const positionVec = MeasureVector3.fromVector3<Length>(position, kilometers);
        const velocityVec = MeasureVector3.fromVector3<Velocity>(velocity, kilometers.per(seconds));
        const centralMass = Measure.of(this._centralBody.getMass(), kilograms);
        body.getTrajectory().calculateFromState(positionVec, velocityVec, centralMass);

        // Create trail line with ShaderMaterial for fading effect
        const trailConfig = config.trail;
        const trailGeometry = new THREE.BufferGeometry();

        // Use custom shader material for fading trail
        const trailMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(hexToNumber(trailConfig.color)) }
            },
            vertexShader: TRAIL_VERTEX_SHADER,
            fragmentShader: TRAIL_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false, // Prevents z-fighting and ensures proper transparency
            blending: THREE.NormalBlending
        });

        const trailLine = new THREE.Line(trailGeometry, trailMaterial);
        this._scene.add(trailLine);
        this._trailLines.set(body, trailLine);

        this._orbitalBodies.push(body);

        // Update camera manager with new body list and pass the newly added body
        // This will automatically switch camera to the new body if no orbital body is currently focused
        this._cameraManager.updateOrbitalBodies(this._orbitalBodies, body);

        return body;
    }

    /**
     * Remove an orbital body from the simulation
     */
    removeOrbitalBody(body: OrbitalBody): void {
        const index = this._orbitalBodies.indexOf(body);
        if (index > -1) {
            this._orbitalBodies.splice(index, 1);

            // Remove trail line
            const trailLine = this._trailLines.get(body);
            if (trailLine) {
                this._scene.remove(trailLine);
                trailLine.geometry.dispose();
                if (trailLine.material instanceof THREE.Material) {
                    trailLine.material.dispose();
                }
                this._trailLines.delete(body);
            }

            body.dispose();
        }

        // Update camera manager with new body list
        this._cameraManager.updateOrbitalBodies(this._orbitalBodies);
    }

    /**
     * Reset an orbital body with new parameters
     */
    resetOrbitalBody(body: OrbitalBody, position: THREE.Vector3, velocity: THREE.Vector3, mass: number, radius?: number): void {
        body.reset(position, velocity, mass, this._centralBody.getMass(), radius);

        // Clear trail
        const trailLine = this._trailLines.get(body);
        if (trailLine) {
            trailLine.geometry.setFromPoints([]);
        }
    }

    /**
     * Set time scale for simulation
     */
    setTimeScale(scale: number): void {
        this.timeScale = scale;
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
        const centralMass = this._centralBody.getMass();
        this._orbitalBodies.forEach(body => {
            body.resetToInitial(centralMass);

            // Clear trail
            const trailLine = this._trailLines.get(body);
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
        const bodiesToRemove = [...this._orbitalBodies];
        bodiesToRemove.forEach(body => {
            this.removeOrbitalBody(body);
        });

        // Explicitly clear the array to ensure it's empty
        // (removeOrbitalBody should have removed all, but this ensures it)
        this._orbitalBodies.length = 0;

        // Verify the array is empty
        if (this._orbitalBodies.length !== 0) {
            console.warn('Warning: orbitalBodies array is not empty after removeAllOrbitalBodies()');
        }
    }

    /**
     * Start the game loop
     */
    start(): void {
        if (this._isRunning) return;
        this._isRunning = true;
        this.currentTime = 0;
        this._lastFrameTime = performance.now() / 1000; // Convert to seconds
        this.gameLoop();
    }

    /**
     * Stop the game loop
     */
    stop(): void {
        this._isRunning = false;
        if (this._animationFrameId) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = 0;
        }
        // Reset lastFrameTime so it's recalculated on next start
        this._lastFrameTime = 0;
    }

    /**
     * Main game loop
     */
    private gameLoop = (): void => {
        if (!this._isRunning) return;

        this._animationFrameId = requestAnimationFrame(this.gameLoop);

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
        // Calculate dt from real-world time elapsed since last frame
        const currentTime = performance.now() / 1000; // Convert to seconds
        if (this._lastFrameTime > 0) {
            this._dt = currentTime - this._lastFrameTime;
        } else {
            // First frame - use a reasonable default (typically ~16ms for 60fps)
            this._dt = 0.016; // Fallback for first frame
        }
        this._lastFrameTime = currentTime;

        // Update FPS counter every second
        this._frameCount++;
        if (currentTime - this._fpsUpdateTime >= 1.0) {
            this.fps = Math.round(this._frameCount / (currentTime - this._fpsUpdateTime));
            this._frameCount = 0;
            this._fpsUpdateTime = currentTime;
        }

        // Update body count
        this.bodyCount = this._orbitalBodies.length;

        const scaledDt = this._dt * this.timeScale;
        this.currentTime += scaledDt;

        const centralPosition = this._centralBody.getPosition();
        const centralMass = this._centralBody.getMass();

        // Update all orbital bodies
        this._orbitalBodies.forEach(body => {
            body.update(scaledDt, centralPosition, centralMass, G, this.currentTime);

            // Transfer completion logic
            const transfer = body.getTransferTrajectory();
            if (transfer && body.target) {
                const endTime = transfer.getEndTime();
                // If transfer was active last frame but now it's finished
                // We check if it finished just now (within scaledDt of currentTime)
                if (this.currentTime >= endTime && (this.currentTime - scaledDt) < endTime) {
                    // Transfer completed!
                    const targetBody = body.target;
                    console.log(`[GameLoop] Transfer for ${body.getName()} completed. Switching focus to ${targetBody.getName()}.`);
                    
                    // Switch focus to the arrival body, preserving the current view (no jerking)
                    this._cameraManager.switchToBody(targetBody, true);
                    
                    // Cleanup: Delete transfer trajectory and clear target for the original body
                    body.clearTransfer();
                    body.setTarget(null);
                }
            }

            // Update trail
            const trailLine = this._trailLines.get(body);
            if (trailLine) {
                const points = body.getTrailPoints();
                trailLine.geometry.setFromPoints(points);

                // Update alpha attribute for fading effect
                const alphas = new Float32Array(points.length);
                const maxIndex = points.length > 1 ? points.length - 1 : 1;

                // Set alphas: 0 at start (tail), 1 at end (head/body)
                for (let i = 0; i < points.length; i++) {
                    // Linear fade from 0 to 1
                    alphas[i] = i / maxIndex;
                }

                trailLine.geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
            }
        });
    }

    /**
     * Render the scene
     */
    private render(): void {
        // Update camera (handles target tracking, mouse input, zoom, etc.)
        this._cameraManager.update();

        // Get currently selected body name from camera manager
        const selectedBodyName = this._cameraManager.getCurrentTargetName();

        // Update rendering mode for all orbital bodies based on camera distance
        // and set trajectory visibility based on selection
        const selectedBody = this._cameraManager.getTarget();
        const targetBody = selectedBody ? selectedBody.target : null;

        this._orbitalBodies.forEach(body => {
            const isSelected = body === selectedBody;
            body.updateRenderingMode(this._camera, isSelected);

            // Only show full trajectory for the currently selected body OR its target
            const isTarget = body === targetBody;
            body.getTrajectory().setVisibility((isSelected || isTarget) && this._trajectoriesVisible);

            // Transfer trajectory visibility - only for currently selected body
            const transfer = body.getTransferTrajectory();
            if (transfer) {
                // If the body is selected, show its transfer. Otherwise, hide it.
                // This will also toggle the visibility of the associated optimization plot.
                transfer.setVisibility(isSelected);
            }
        });

        // Also update rendering mode for central body
        this._centralBody.updateRenderingMode(this._camera, this._centralBody === selectedBody);

        this._renderer.render(this._scene, this._camera);

        // Call plot update callbacks
        this._plotUpdateCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('Error in plot update callback:', error);
            }
        });
    }

    /**
     * Get the scene (for UI integration)
     */
    getScene(): THREE.Scene {
        return this._scene;
    }

    /**
     * Get all orbital bodies
     */
    getOrbitalBodies(): OrbitalBody[] {
        return this._orbitalBodies;
    }

    /**
     * Get central body
     */
    getCentralBody(): OrbitalBody {
        return this._centralBody;
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
     * Get current dt (time step in seconds)
     */
    getDt(): number {
        return this._dt;
    }

    /**
     * Reset current simulation time to 0
     */
    resetCurrentTime(): void {
        this.currentTime = 0;
    }

    /**
     * Get the renderer (for GPU compute)
     */
    getRenderer(): THREE.WebGLRenderer {
        return this._renderer;
    }

    /**
     * Get camera manager (for UI integration)
     */
    getCameraManager(): CameraManager {
        return this._cameraManager;
    }

    /**
     * Toggle trajectory visibility for all orbital bodies
     */
    toggleTrajectoryVisibility(): void {
        this._trajectoriesVisible = !this._trajectoriesVisible;
        this._orbitalBodies.forEach(body => {
            body.getTrajectory().setVisibility(this._trajectoriesVisible);
        });
    }

    /**
     * Get trajectory visibility state
     */
    getTrajectoriesVisible(): boolean {
        return this._trajectoriesVisible;
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
        const centralMass = this._centralBody.getMass();

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
        const bodyName = `RandomBody_${this._orbitalBodies.length + 1}`;

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

    /**
     * Register a callback function to be called on each render frame
     * Used for updating plots with current animation state
     */
    registerPlotUpdateCallback(callback: () => void): void {
        this._plotUpdateCallbacks.push(callback);
    }

    unregisterPlotUpdateCallback(callback: () => void): void {
        const index = this._plotUpdateCallbacks.indexOf(callback);
        if (index > -1) {
            this._plotUpdateCallbacks.splice(index, 1);
        }
    }


}
