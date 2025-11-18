import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { OrbitalBody } from './orbitalBody';
import { config } from './config';

/**
 * CameraManager class that handles all camera-related functionality
 * including target tracking, zoom, and rotation
 */
export class CameraManager {
    private _camera: THREE.PerspectiveCamera;              // Private - use underscore prefix
    private _controls!: OrbitControls;                    // Private - use underscore prefix
    private _renderer: THREE.WebGLRenderer;               // Private - use underscore prefix
    
    // Camera target tracking
    private _cameraTarget: OrbitalBody | null = null;     // Private - use underscore prefix
    private _cameraTargetIndex: number = -1;              // Private - use underscore prefix (-1 = no target, -2 = central body, >= 0 = orbital body index)
    private _cameraOffset: THREE.Vector3 = new THREE.Vector3(); // Private - use underscore prefix (relative offset from target to camera)
    private _previousTargetPosition: THREE.Vector3 = new THREE.Vector3(); // Private - use underscore prefix (previous target position for tracking)
    
    // Storage for camera state per body (to restore when switching back)
    private _bodyCameraStates: Map<string, THREE.Vector3> = new Map(); // Private - use underscore prefix (maps body name to camera offset)
    
    // Storage for free camera state (position and target)
    private _freeCameraPosition: THREE.Vector3 | null = null; // Private - use underscore prefix
    private _freeCameraTarget: THREE.Vector3 | null = null;    // Private - use underscore prefix
    
    // Keyboard state for free camera movement
    private _keysPressed: Set<string> = new Set();         // Private - use underscore prefix
    private _minMovementSpeed: number = 50000;            // Private - use underscore prefix (minimum movement speed in km per second)
    private _lastUpdateTime: number = 0;                  // Private - use underscore prefix (timestamp of last update for delta time calculation)
    
    // References to bodies for target switching
    private _centralBody: OrbitalBody;                     // Private - use underscore prefix
    private _orbitalBodies: OrbitalBody[] = [];           // Private - use underscore prefix
    
    // Callback for when target changes (for UI updates)
    private _onTargetChangeCallback?: (targetName: string | null) => void; // Private - use underscore prefix

    // Reference to GameLoop to get all bodies for cameraFocus options
    private _gameLoop: any; // Will be set after construction

    /**
     * Public property for inspector: camera focus with value and options
     * value: integer index into options array (0 = Free Camera, 1 = central body, 2+ = orbital bodies)
     * options: array of OrbitalBody objects from GameLoop [null (Free Camera), centralBody, ...orbitalBodies]
     */
    public cameraFocus: { value: number; options: (OrbitalBody | null)[] };

    /**
     * Set reference to GameLoop (called after construction)
     */
    public setGameLoop(gameLoop: any): void {
        this._gameLoop = gameLoop;
        this.updateCameraFocusProperty();
    }

    /**
     * Get all available camera targets as array of bodies from GameLoop
     * Returns array: [null (Free Camera), centralBody, ...orbitalBodies]
     */
    private getAllBodies(): (OrbitalBody | null)[] {
        const bodies: (OrbitalBody | null)[] = [null]; // null = Free Camera
        
        // Get bodies from GameLoop if available
        if (this._gameLoop) {
            // Add central body
            try {
                const centralBody = this._gameLoop.getCentralBody();
                if (centralBody) {
                    bodies.push(centralBody);
                }
            } catch (e) {
                // Fallback to stored central body
                if (this._centralBody) {
                    bodies.push(this._centralBody);
                }
            }
            
            // Add orbital bodies from GameLoop
            try {
                const orbitalBodies = this._gameLoop.getOrbitalBodies();
                if (orbitalBodies && orbitalBodies.length > 0) {
                    bodies.push(...orbitalBodies);
                }
            } catch (e) {
                // Fallback to stored orbital bodies
                bodies.push(...this._orbitalBodies);
            }
        } else {
            // Fallback: use stored bodies if GameLoop not available yet
            if (this._centralBody) {
                bodies.push(this._centralBody);
            }
            bodies.push(...this._orbitalBodies);
        }
        
        return bodies;
    }

    /**
     * Get current camera target index
     * Returns 0 for free camera (null at index 0), 1 for central body, 2+ for orbital bodies
     */
    private getCurrentFocusIndex(): number {
        if (this._cameraTarget === null) {
            return 0; // Free Camera (null at index 0)
        }
        
        // Get all bodies from GameLoop to find the correct index
        const allBodies = this.getAllBodies();
        
        // Find the index of the current target in the options array
        const index = allBodies.indexOf(this._cameraTarget);
        if (index >= 0) {
            return index;
        }
        
        return 0; // Default to free camera if not found
    }

    /**
     * Update cameraFocus property value and options
     * Called internally when camera target changes or bodies are added/removed
     */
    private updateCameraFocusProperty(): void {
        const allBodies = this.getAllBodies();
        const currentIndex = this.getCurrentFocusIndex();
        
        this.cameraFocus = {
            value: currentIndex,
            options: allBodies
        };
    }

    /**
     * Apply camera focus change from inspector
     * Called when inspector updates cameraFocus.value (the index)
     */
    public applyCameraFocusChange(): void {
        const index = this.cameraFocus.value;
        const allBodies = this.cameraFocus.options;
        
        if (index < 0 || index >= allBodies.length) {
            // Invalid index, switch to free camera
            this.switchToFreeCamera();
            return;
        }
        
        const targetBody = allBodies[index];
        if (targetBody === null) {
            // Index 0 = Free Camera
            this.switchToFreeCamera();
        } else {
            // Index 1+ = Body (1 = central, 2+ = orbital)
            this.switchToBody(targetBody);
        }
    }

    constructor(
        camera: THREE.PerspectiveCamera,
        renderer: THREE.WebGLRenderer,
        centralBody: OrbitalBody,
        orbitalBodies: OrbitalBody[]
    ) {
        this._camera = camera;
        this._renderer = renderer;
        this._centralBody = centralBody;
        this._orbitalBodies = orbitalBodies;
        
        // Initialize cameraFocus property
        const allBodies = this.getAllBodies();
        this.cameraFocus = {
            value: 0, // 0 = Free Camera (null at index 0)
            options: allBodies
        };
        
        this.initControls();
        this.setupKeyboardControls();
    }

    private initControls(): void {
        this._controls = new OrbitControls(this._camera, this._renderer.domElement);
        const controlsConfig = config.scene.controls;
        this._controls.enableDamping = controlsConfig.enableDamping;
        this._controls.dampingFactor = controlsConfig.dampingFactor;
        
    }

    private setupKeyboardControls(): void {
        // Add keyboard listeners for camera target switching and free camera movement
        document.addEventListener('keydown', (event) => {
            // Only handle if not typing in an input field
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (event.key === '[') {
                this.switchCameraTarget(-1); // Previous body
            } else if (event.key === ']') {
                this.switchCameraTarget(1); // Next body
            } else if (!this._cameraTarget) {
                // Free camera mode - handle movement keys
                const key = event.key.toLowerCase();
                if (['w', 'a', 's', 'd', 'r', 'f'].includes(key)) {
                    this._keysPressed.add(key);
                    event.preventDefault();
                }
            }
        });

        document.addEventListener('keyup', (event) => {
            // Only handle if not typing in an input field
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (!this._cameraTarget) {
                // Free camera mode - handle movement keys
                const key = event.key.toLowerCase();
                if (['w', 'a', 's', 'd', 'r', 'f'].includes(key)) {
                    this._keysPressed.delete(key);
                    event.preventDefault();
                }
            }
        });

        // Clear pressed keys when window loses focus to avoid stuck keys
        window.addEventListener('blur', () => {
            this._keysPressed.clear();
        });
    }

    /**
     * Switch camera target between bodies
     * @param direction -1 for previous, 1 for next
     */
    private switchCameraTarget(direction: number): void {
        const allBodies: (OrbitalBody | null)[] = [this._centralBody, ...this._orbitalBodies, null];
        const currentIndex = this._cameraTargetIndex;

        // Find current index in allBodies array
        let currentArrayIndex = -1;
        if (currentIndex === -2) {
            currentArrayIndex = 0; // Central body
        } else if (currentIndex >= 0 && currentIndex < this._orbitalBodies.length) {
            currentArrayIndex = currentIndex + 1; // Orbital body (offset by 1 for central body)
        } else {
            currentArrayIndex = allBodies.length - 1; // null (free camera)
        }

        // Calculate new index with wrapping
        let newArrayIndex = currentArrayIndex + direction;
        if (newArrayIndex < 0) {
            newArrayIndex = allBodies.length - 1;
        } else if (newArrayIndex >= allBodies.length) {
            newArrayIndex = 0;
        }

        // Store current camera state before switching away
        if (this._cameraTarget) {
            const currentBodyName = this._cameraTarget.getName();
            // Store the current camera offset for this body
            this._bodyCameraStates.set(currentBodyName, this._cameraOffset.clone());
        } else {
            // Store free camera state before switching away
            this._freeCameraPosition = this._camera.position.clone();
            this._freeCameraTarget = this._controls.target.clone();
            // Clear pressed keys when leaving free camera mode
            this._keysPressed.clear();
        }

        // Store current offset before switching (for immediate use if no stored state exists)
        const oldTargetPosition = this._cameraTarget ? this._cameraTarget.getPosition() : this._controls.target;
        const currentCameraOffset = this._camera.position.clone().sub(oldTargetPosition);

        // Update camera target
        const newTarget = allBodies[newArrayIndex];
        if (newTarget === null) {
            // Switching to free camera - restore stored position and target
            this._cameraTarget = null;
            this._cameraTargetIndex = -1;
            
            if (this._freeCameraPosition && this._freeCameraTarget) {
                // Restore stored free camera state
                this._camera.position.copy(this._freeCameraPosition);
                this._controls.target.copy(this._freeCameraTarget);
                this._controls.update();
            } else {
                // First time entering free camera - initialize state from current position
                this._freeCameraPosition = this._camera.position.clone();
                this._freeCameraTarget = this._controls.target.clone();
            }
            
            this.notifyTargetChange(null);
        } else if (newTarget === this._centralBody) {
            this._cameraTarget = this._centralBody;
            this._cameraTargetIndex = -2;
            // Restore stored camera state if available, otherwise use current offset
            const storedState = this._bodyCameraStates.get(this._centralBody.getName());
            this._cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
            this.notifyTargetChange(this._centralBody.getName());
        } else {
            const orbitalIndex = this._orbitalBodies.indexOf(newTarget);
            if (orbitalIndex >= 0) {
                this._cameraTarget = newTarget;
                this._cameraTargetIndex = orbitalIndex;
                // Restore stored camera state if available, otherwise use current offset
                const storedState = this._bodyCameraStates.get(newTarget.getName());
                this._cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
                this.notifyTargetChange(newTarget.getName());
            }
        }

        // Update camera position immediately while preserving orientation
        this.updateCameraToTarget();
    }

    /**
     * Update camera to follow the current target body
     * Preserves camera orientation while translating to track the body
     * Maintains constant offset unless mouse is used to rotate
     */
    private updateCameraToTarget(): void {
        if (!this._cameraTarget) {
            return;
        }

        const targetPosition = this._cameraTarget.getPosition();
        const bodyRadius = this._cameraTarget.getRadius();
        
        // Initialize previous target position to current position to avoid jump on first frame
        this._previousTargetPosition.copy(targetPosition);
        
        // If this is the first time targeting any body (or offset is zero), set up default position
        // Default distance is 10x the body radius
        if (this._cameraOffset.length() === 0) {
            const cameraDistance = bodyRadius * 10;
            // Default viewing angle (slightly above and behind)
            this._cameraOffset = new THREE.Vector3(
                cameraDistance * 0.7,
                cameraDistance * 0.5,
                cameraDistance * 0.7
            );
        }
        
        // Set camera position based on target position + offset (restores stored camera state)
        this._camera.position.copy(targetPosition).add(this._cameraOffset);
        
        // Update controls target to the body's position (this is the focus point)
        // This makes OrbitControls orbit around the body
        this._controls.target.copy(targetPosition);
        
        // Update OrbitControls to sync with the camera position
        // This ensures OrbitControls' internal state matches our camera position
        this._controls.update();
    }

    /**
     * Update camera each frame - call this from the render loop
     */
    update(): void {
        // Calculate time delta
        const currentTime = performance.now() / 1000; // Convert to seconds
        let deltaTime = this._lastUpdateTime === 0 ? 0.016 : currentTime - this._lastUpdateTime; // Default to ~60fps on first frame
        // Clamp delta time to prevent huge jumps when tab is inactive (max 1/10th of a second)
        deltaTime = Math.min(deltaTime, 0.1);
        this._lastUpdateTime = currentTime;

        if (this._cameraTarget) {
            const targetPosition = this._cameraTarget.getPosition();
            
            // Calculate the offset that the target has moved
            const targetDelta = targetPosition.clone().sub(this._previousTargetPosition);
            
            // Update camera position by the same offset to maintain relative position
            this._camera.position.add(targetDelta);
            
            // Update the controls target to follow the body
            this._controls.target.copy(targetPosition);
            
            // Update OrbitControls (handles scroll wheel zoom and rotation)
            // OrbitControls manages camera.position internally, but we've already adjusted for target movement
            this._controls.update();
        
            // After controls.update(), capture the current offset (includes scroll wheel changes)
            // This captures any zoom/rotation changes from user input
            this._cameraOffset = this._camera.position.clone().sub(targetPosition);
            
            // Update stored camera state for this body to keep it in sync with user changes
            const currentBodyName = this._cameraTarget.getName();
            this._bodyCameraStates.set(currentBodyName, this._cameraOffset.clone());
            
            // Store current target position for next frame
            this._previousTargetPosition.copy(targetPosition);
        } else {
            // Free camera mode - handle keyboard movement and update controls
            this.handleFreeCameraMovement(deltaTime);
            this._controls.update();
            
            // Update stored free camera state
            this._freeCameraPosition = this._camera.position.clone();
            this._freeCameraTarget = this._controls.target.clone();
        }
    }

    /**
     * Handle keyboard movement in free camera mode
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    private handleFreeCameraMovement(deltaTime: number): void {
        if (this._keysPressed.size === 0) {
            return;
        }

        // Get camera's forward direction (negative z-axis in camera space)
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyQuaternion(this._camera.quaternion);
        
        // Get camera's right direction (positive x-axis in camera space)
        const right = new THREE.Vector3(1, 0, 0);
        right.applyQuaternion(this._camera.quaternion);
        
        // Get world up direction
        const up = new THREE.Vector3(0, 1, 0);

        // Project forward onto xz plane (remove y component)
        const forwardXZ = forward.clone();
        forwardXZ.y = 0;
        forwardXZ.normalize();

        // Project right onto xz plane (remove y component)
        const rightXZ = right.clone();
        rightXZ.y = 0;
        rightXZ.normalize();

        // Calculate movement delta
        const movementDelta = new THREE.Vector3(0, 0, 0);
        
        // w, s keys: move forward/backward along xz plane
        if (this._keysPressed.has('w')) {
            movementDelta.add(forwardXZ);
        }
        if (this._keysPressed.has('s')) {
            movementDelta.sub(forwardXZ);
        }
        
        // a, d keys: move left/right along xz plane
        if (this._keysPressed.has('a')) {
            movementDelta.sub(rightXZ);
        }
        if (this._keysPressed.has('d')) {
            movementDelta.add(rightXZ);
        }
        
        // r, f keys: move up/down along y-axis
        if (this._keysPressed.has('r')) {
            movementDelta.add(up);
        }
        if (this._keysPressed.has('f')) {
            movementDelta.sub(up);
        }

        // Calculate movement speed proportional to absolute y position, with minimum
        const currentSpeed = Math.max(this._minMovementSpeed, Math.abs(this._camera.position.y));
        
        // Normalize and scale by movement speed and actual time delta
        if (movementDelta.length() > 0) {
            movementDelta.normalize();
            movementDelta.multiplyScalar(currentSpeed * deltaTime);
            
            // Apply movement to both camera and controls target
            this._camera.position.add(movementDelta);
            this._controls.target.add(movementDelta);
        }
    }

    /**
     * Get the current camera target name, or null if in free camera mode
     */
    getCurrentTargetName(): string | null {
        if (this._cameraTarget === null) {
            return null;
        }
        return this._cameraTarget.getName();
    }

    /**
     * Set callback for when camera target changes
     */
    setOnTargetChange(callback: (targetName: string | null) => void): void {
        this._onTargetChangeCallback = callback;
    }

    /**
     * Notify that the target has changed
     */
    private notifyTargetChange(targetName: string | null): void {
        // Update cameraFocus property to reflect the change
        this.updateCameraFocusProperty();
        
        if (this._onTargetChangeCallback) {
            this._onTargetChangeCallback(targetName);
        }
    }

    /**
     * Update the list of orbital bodies (called when bodies are added/removed)
     * @param orbitalBodies - New list of orbital bodies
     * @param newlyAddedBody - Optional newly added body to automatically focus on
     */
    updateOrbitalBodies(orbitalBodies: OrbitalBody[], newlyAddedBody?: OrbitalBody): void {
        this._orbitalBodies = orbitalBodies;
        
        // If current target was removed, switch to free camera
        if (this._cameraTarget && this._cameraTargetIndex >= 0) {
            if (!this._orbitalBodies.includes(this._cameraTarget)) {
                this._cameraTarget = null;
                this._cameraTargetIndex = -1;
                this.notifyTargetChange(null);
            } else {
                // Update index if it changed
                this._cameraTargetIndex = this._orbitalBodies.indexOf(this._cameraTarget);
            }
        }
        
        // Update cameraFocus options to reflect new body list
        this.updateCameraFocusProperty();
        
        // If a new body was added, always switch to it so the user can see its stats
        // Use setTimeout to ensure the body is registered in the command processor's map first
        if (newlyAddedBody) {
            setTimeout(() => {
                this.switchToBody(newlyAddedBody);
            }, 0);
        }
    }
    
    /**
     * Switch camera to a specific body by name
     * @param bodyName - Name of the body to switch to
     */
    switchToBodyByName(bodyName: string): boolean {
        // Check if it's the central body
        if (this._centralBody.getName() === bodyName) {
            this.switchToBody(this._centralBody);
            return true;
        }
        
        // Check orbital bodies
        const body = this._orbitalBodies.find(b => b.getName() === bodyName);
        if (body) {
            this.switchToBody(body);
            return true;
        }
        
        return false;
    }

    /**
     * Switch camera to free camera mode (no target)
     */
    switchToFreeCamera(): void {
        // Store current camera state before switching away
        if (this._cameraTarget) {
            const currentBodyName = this._cameraTarget.getName();
            this._bodyCameraStates.set(currentBodyName, this._cameraOffset.clone());
        } else {
            // Already in free camera mode
            return;
        }

        // Store current offset before switching
        const oldTargetPosition = this._cameraTarget ? this._cameraTarget.getPosition() : this._controls.target;
        const currentCameraOffset = this._camera.position.clone().sub(oldTargetPosition);

        // Switch to free camera
        this._cameraTarget = null;
        this._cameraTargetIndex = -1;
        
        if (this._freeCameraPosition && this._freeCameraTarget) {
            // Restore stored free camera state
            this._camera.position.copy(this._freeCameraPosition);
            this._controls.target.copy(this._freeCameraTarget);
            this._controls.update();
        } else {
            // First time entering free camera - initialize state from current position
            this._freeCameraPosition = this._camera.position.clone();
            this._freeCameraTarget = this._controls.target.clone();
        }
        
        this.notifyTargetChange(null);
    }
    
    /**
     * Switch camera to a specific body
     * @param body - The body to switch to
     */
    private switchToBody(body: OrbitalBody): void {
        // Store current camera state before switching away
        if (this._cameraTarget) {
            const currentBodyName = this._cameraTarget.getName();
            this._bodyCameraStates.set(currentBodyName, this._cameraOffset.clone());
        } else {
            this._freeCameraPosition = this._camera.position.clone();
            this._freeCameraTarget = this._controls.target.clone();
            this._keysPressed.clear();
        }
        
        // Store current offset before switching
        const oldTargetPosition = this._cameraTarget ? this._cameraTarget.getPosition() : this._controls.target;
        const currentCameraOffset = this._camera.position.clone().sub(oldTargetPosition);
        
        // Update camera target
        if (body === this._centralBody) {
            this._cameraTarget = this._centralBody;
            this._cameraTargetIndex = -2;
            const storedState = this._bodyCameraStates.get(this._centralBody.getName());
            this._cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
            this.notifyTargetChange(this._centralBody.getName());
        } else {
            const orbitalIndex = this._orbitalBodies.indexOf(body);
            if (orbitalIndex >= 0) {
                this._cameraTarget = body;
                this._cameraTargetIndex = orbitalIndex;
                const storedState = this._bodyCameraStates.get(body.getName());
                this._cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
                this.notifyTargetChange(body.getName());
            }
        }
        
        // Update camera position immediately
        this.updateCameraToTarget();
    }

    /**
     * Handle window resize
     */
    handleResize(): void {
        this._camera.aspect = window.innerWidth / window.innerHeight;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Get the camera (for external access if needed)
     */
    getCamera(): THREE.PerspectiveCamera {
        return this._camera;
    }

    /**
     * Get the controls (for external access if needed)
     */
    getControls(): OrbitControls {
        return this._controls;
    }

    /**
     * Reset camera to initial position (as on page load)
     */
    resetToInitial(): void {
        const cameraConfig = config.scene.camera;
        this._camera.position.copy(cameraConfig.position);
        this._controls.target.set(0, 0, 0);
        this._controls.update();
        
        // Reset camera target tracking
        this._cameraTarget = null;
        this._cameraTargetIndex = -1;
        this._cameraOffset.set(0, 0, 0);
        this._freeCameraPosition = this._camera.position.clone();
        this._freeCameraTarget = this._controls.target.clone();
        this._bodyCameraStates.clear();
        
        this.notifyTargetChange(null);
    }
}

