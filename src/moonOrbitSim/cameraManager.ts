import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { OrbitalBody } from './orbitalBody';
import { config } from './config';
import { Body } from './types';

/**
 * CameraManager class that handles all camera-related functionality
 * including target tracking, zoom, and rotation.
 * 
 * Extends Body to inherit spatial properties (position, velocity, mass, etc.)
 * allowing the camera to be treated as a first-class entity in the scene.
 * 
 * Architecture:
 * - Inherits from Body: position, velocity, mass, radius, name, id
 * - Manages THREE.PerspectiveCamera and OrbitControls
 * - Tracks target bodies (central body or orbital bodies)
 * - Supports free camera mode with keyboard controls (WASD+RF)
 * - Persists camera state per body using Body serialization (toJSON/fromJSON)
 * - Syncs Body.position with THREE.Camera.position each frame
 * 
 * Camera States:
 * - Free Camera (target = null): WASD+RF movement, no tracking
 * - Tracking Mode (target != null): Follows body while maintaining offset
 * - State Persistence: Camera position/offset saved per body, restored on switch
 * 
 * Integration:
 * - Created by GameLoop with camera, renderer, and body references
 * - Called via update() in render loop to handle tracking and movement
 * - Provides camera access via getCamera() for rendering
 * - Target switching: keyboard ([/]), inspector dropdown, or switchToBody() method
 */
export class CameraManager extends Body {
    private _camera: THREE.PerspectiveCamera;              // Private - use underscore prefix
    private _controls!: OrbitControls;                    // Private - use underscore prefix
    private _renderer: THREE.WebGLRenderer;               // Private - use underscore prefix

    // Camera target tracking
    private _cameraTarget: OrbitalBody | null = null;     // Private - use underscore prefix
    private _cameraTargetIndex: number = -1;              // Private - use underscore prefix (-1 = no target, -2 = central body, >= 0 = orbital body index)
    private _cameraOffset: THREE.Vector3 = new THREE.Vector3(); // Private - use underscore prefix (relative offset from target to camera)
    private _previousTargetPosition: THREE.Vector3 = new THREE.Vector3(); // Private - use underscore prefix (previous target position for tracking)

    // Storage for camera state per body (to restore when switching back)
    // Now stores full Body state with position, velocity, etc.
    private _bodyCameraStates: Map<string, any> = new Map(); // Private - use underscore prefix (maps body name to serialized camera state)

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
    public getAllBodies(): (OrbitalBody | null)[] {
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
        // Initialize Body with camera properties
        super({
            name: 'Camera',
            position: camera.position.clone(),
            velocity: new THREE.Vector3(),
            mass: 0,
            radius: 1,
            id: 'camera-main'
        });

        this._camera = camera;
        this._renderer = renderer;
        this._container = renderer.domElement;
        this._centralBody = centralBody;
        this._orbitalBodies = orbitalBodies;

        // Sync Body position with camera
        this.position.copy(this._camera.position);

        // Initialize cameraFocus property
        const allBodies = this.getAllBodies();
        this.cameraFocus = {
            value: 0, // 0 = Free Camera (null at index 0)
            options: allBodies
        };

        this.initControls();
        this.setupKeyboardControls(); // Keyboard controls for movement
        this.setupMouseInteraction(); // Mouse interaction for selection
    }

    // Raycasting and Selection
    private _raycaster: THREE.Raycaster = new THREE.Raycaster();
    
    private _mouse: THREE.Vector2 = new THREE.Vector2(-Infinity, -Infinity); // Initialize off-screen
    private _isSelectionMode: boolean = false;
    private _selectionCallback: ((body: OrbitalBody) => void) | null = null;
    private _container: HTMLElement;

    /**
     * Set selection mode to allow picking a body
     */
    setSelectionMode(active: boolean, callback?: (body: OrbitalBody) => void): void {
        this._isSelectionMode = active;
        if (active && callback) {
            this._selectionCallback = callback;
            // Change cursor to crosshair via CSS on renderer domElement
            this._renderer.domElement.style.cursor = 'crosshair';
        } else {
            this._selectionCallback = null;
            this._renderer.domElement.style.cursor = 'default';
        }
    }

    /**
     * Check if currently in selection mode
     */
    isSelectionMode(): boolean {
        return this._isSelectionMode;
    }

    private setupMouseInteraction(): void {
        this._container = this._renderer.domElement;

        // Click handler for selection
        this._container.addEventListener('click', (event) => {
            if (!this._isSelectionMode) return;
            this.updateMouseCoordinates(event);
            const body = this.raycastBody();
            if (body && this._selectionCallback) {
                this._selectionCallback(body);
                this.setSelectionMode(false); // Exit mode
            }
        });

        // Mouse move handler for hover
        this._container.addEventListener('mousemove', (event) => {
            this.updateMouseCoordinates(event);
        });
    }

    private updateMouseCoordinates(event: MouseEvent): void {
        const rect = this._container.getBoundingClientRect();
        this._mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this._mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private raycastBody(): OrbitalBody | null {
        // Raycast
        this._raycaster.setFromCamera(this._mouse, this._camera);

        // Get meshes of all bodies (central + orbital)
        const bodies = this.getAllBodies().filter(b => b !== null) as OrbitalBody[];
        const meshes: THREE.Object3D[] = [];
        const meshToBodyMap = new Map<number, OrbitalBody>();
        
        bodies.forEach(body => {
            const renderDelegate = (body as any)._render;
            if (renderDelegate && renderDelegate.mesh) {
                meshes.push(renderDelegate.mesh);
                meshToBodyMap.set(renderDelegate.mesh.id, body);
                if (renderDelegate.dotSprite && renderDelegate.dotSprite.visible) {
                    meshes.push(renderDelegate.dotSprite);
                    meshToBodyMap.set(renderDelegate.dotSprite.id, body);
                }
            }
        });

        const intersects = this._raycaster.intersectObjects(meshes, false);
        if (intersects.length > 0) {
            return meshToBodyMap.get(intersects[0].object.id) || null;
        }
        return null;
    }

    /**
     * Get the body currently under the mouse cursor
     */
    public getHoveredBody(): OrbitalBody | null {
        return this.raycastBody();
    }

    private _isUserInteracting: boolean = false;
    private _localCameraOffset: THREE.Vector3 | null = null; // Store offset relative to target frame

    private initControls(): void {
        this._controls = new OrbitControls(this._camera, this._renderer.domElement);
        const controlsConfig = config.scene.controls;
        this._controls.enableDamping = controlsConfig.enableDamping;
        this._controls.dampingFactor = controlsConfig.dampingFactor;

        this._controls.addEventListener('start', () => {
            this._isUserInteracting = true;
        });

        this._controls.addEventListener('end', () => {
            this._isUserInteracting = false;
        });
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
            if (storedState && storedState.position) {
                // Restore from serialized Body state
                this.position.copy(new THREE.Vector3(storedState.position.x, storedState.position.y, storedState.position.z));
                this._cameraOffset = this.position.clone().sub(this._centralBody.getPosition());
            } else {
                this._cameraOffset = currentCameraOffset;
            }
            this.notifyTargetChange(this._centralBody.getName());
        } else {
            const orbitalIndex = this._orbitalBodies.indexOf(newTarget);
            if (orbitalIndex >= 0) {
                this._cameraTarget = newTarget;
                this._cameraTargetIndex = orbitalIndex;
                // Restore stored camera state if available, otherwise use current offset
                const storedState = this._bodyCameraStates.get(newTarget.getName());
                if (storedState && storedState.position) {
                    // Restore from serialized Body state
                    this.position.copy(new THREE.Vector3(storedState.position.x, storedState.position.y, storedState.position.z));
                    this._cameraOffset = this.position.clone().sub(newTarget.getPosition());
                } else {
                    this._cameraOffset = currentCameraOffset;
                }
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
    /**
     * Helper to compute the Rotation Matrix (Basis) for the Target Frame
     * Z-axis: Points from Selected Body to Target Body
     * Y-axis: Global Up (projected to be perpendicular to Z) OR fallback if Z is parallel to Up
     * X-axis: Cross product
     */
    private getTargetFrameMatrix(selectedBodyPos: THREE.Vector3, targetBodyPos: THREE.Vector3): THREE.Matrix4 {
        const zAxis = new THREE.Vector3().subVectors(targetBodyPos, selectedBodyPos).normalize();
        
        let up = new THREE.Vector3(0, 1, 0);
        // If zAxis is parallel to up, pick a different up
        if (Math.abs(zAxis.dot(up)) > 0.99) {
            up.set(0, 0, 1);
        }

        const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

        const matrix = new THREE.Matrix4();
        matrix.makeBasis(xAxis, yAxis, zAxis);
        return matrix;
    }

    /**
     * Compute and store the Local Camera Offset based on current relative position and Target Frame
     */
    private updateLocalCameraOffset(selectedBody: OrbitalBody, targetBody: OrbitalBody): void {
        const frameMatrix = this.getTargetFrameMatrix(selectedBody.getPosition(), targetBody.getPosition());
        const inverseFrameMatrix = frameMatrix.clone().invert();

        // Calculate Midpoint
        const midpoint = new THREE.Vector3().addVectors(selectedBody.getPosition(), targetBody.getPosition()).multiplyScalar(0.5);

        // Get current relative position (World Offset) from Midpoint
        const currentWorldOffset = this._camera.position.clone().sub(midpoint);
        
        // Transform World Offset to Local Offset: Local = InverseFrame * World
        this._localCameraOffset = currentWorldOffset.applyMatrix4(inverseFrameMatrix);
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

        // Calculate Focus Point (Midpoint if target defined, else Body Position)
        let focusPoint = targetPosition.clone();
        if (this._cameraTarget.target) {
            focusPoint.addVectors(targetPosition, this._cameraTarget.target.getPosition()).multiplyScalar(0.5);
        }

        // Initialize previous target position to current position to avoid jump on first frame
        this._previousTargetPosition.copy(focusPoint);

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

        // Set camera position based on focus point + offset (restores stored camera state)
        this._camera.position.copy(focusPoint).add(this._cameraOffset);

        // Update controls target to the focus point
        // This makes OrbitControls orbit around the midpoint or body
        this._controls.target.copy(focusPoint);

        // Set minimum distance based on config factor * radius
        // Default was 8x radius (4x diameter)
        this._controls.minDistance = bodyRadius * config.scene.camera.minBodyDistanceFactor;

        // Force a simplified update to set the internal state without triggering our frame loop logic yet
        this._controls.update();

        // Initialize local camera offset if we have a target
        if (this._cameraTarget.target) {
            this.updateLocalCameraOffset(this._cameraTarget, this._cameraTarget.target);
        } else {
            this._localCameraOffset = null;
        }
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

            // Check if selected body has a target
            const secondaryTarget = this._cameraTarget.target;

            if (secondaryTarget) {
                // --- TARGET LOCKING LOGIC ---
                const midpoint = new THREE.Vector3().addVectors(targetPosition, secondaryTarget.getPosition()).multiplyScalar(0.5);

                if (this._isUserInteracting) {
                    // Scenario A: User is moving/rotating camera
                    // 1. Let OrbitControls handle natural movement (we still need to track base movement)
                    
                    // Simple tracking: move camera by same amount target midpoint moved
                    const targetDelta = midpoint.clone().sub(this._previousTargetPosition);
                    this._camera.position.add(targetDelta);
                    this._controls.target.copy(midpoint);
                    
                    this._controls.update();

                    // 2. Capture new Local Offset for when interaction ends
                    // This "saves" the new angle relative to the frame
                    this.updateLocalCameraOffset(this._cameraTarget, secondaryTarget);
                } else if (this._localCameraOffset) {
                    // Scenario B: Simulation running, Camera Locked to Frame
                    
                    // 1. Update Controls first to handle Zoom (and damping)
                    this._controls.target.copy(midpoint);
                    this._controls.update();

                    // 2. Capture the distance (zoom level) resulting from controls update
                    const currentDist = this._camera.position.distanceTo(midpoint);

                    // 3. Calculate new Frame Matrix
                    const frameMatrix = this.getTargetFrameMatrix(targetPosition, secondaryTarget.getPosition());

                    // 4. Calculate World Offset from stored Local Offset: World = Frame * Local
                    const newWorldOffset = this._localCameraOffset.clone().applyMatrix4(frameMatrix);

                    // 5. Apply the current zoom distance to our locked orientation
                    newWorldOffset.setLength(currentDist);

                    // 6. Update Camera Position relative to Midpoint
                    this._camera.position.copy(midpoint).add(newWorldOffset);
                    
                    // 7. Update stored local offset length to match new zoom
                    this._localCameraOffset.setLength(currentDist);
                } else {
                    // Fallback if local offset wasn't set yet
                     this.updateLocalCameraOffset(this._cameraTarget, secondaryTarget);
                }
                
                // Store current midpoint for next frame
                this._previousTargetPosition.copy(midpoint);

            } else {
                // --- STANDARD LOGIC (No Target) ---
                this._localCameraOffset = null; // Reset local offset

                // Calculate the offset that the target has moved
                const targetDelta = targetPosition.clone().sub(this._previousTargetPosition);

                // Update camera position by the same offset to maintain relative position
                this._camera.position.add(targetDelta);

                // Update the controls target to follow the body
                this._controls.target.copy(targetPosition);

                // Update OrbitControls (handles scroll wheel zoom and rotation)
                this._controls.update();

                // Store current target position for next frame
                this._previousTargetPosition.copy(targetPosition);
            }

            // Sync Body position with camera
            this.position.copy(this._camera.position);

            // Capture current offset (includes scroll wheel zoom)
            // Even in Target Locking mode, we want to know the current world offset for serialization
            // Note: If using Target Locking, this offset is relative to midpoint now, but standard logic uses selection pos.
            // For now, let's keep it relative to actual selection for consistency in serialization
            this._cameraOffset = this._camera.position.clone().sub(targetPosition);

            // Update stored camera state for this body using Body serialization
            const currentBodyName = this._cameraTarget.getName();
            this._bodyCameraStates.set(currentBodyName, this.toJSON());

            // _previousTargetPosition is updated in the branches above

        } else {
            // Free camera mode - handle keyboard movement and update controls
            this.handleFreeCameraMovement(deltaTime);
            this._controls.update();

            // Sync Body position with camera
            this.position.copy(this._camera.position);

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
     * Get the current target body
     */
    getTarget(): OrbitalBody | null {
        return this._cameraTarget;
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
            this._controls.minDistance = 0; // Reset min distance for free camera
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
    public switchToBody(body: OrbitalBody): void {
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
            if (storedState && storedState.position) {
                // Restore from serialized Body state
                this.position.copy(new THREE.Vector3(storedState.position.x, storedState.position.y, storedState.position.z));
                this._cameraOffset = this.position.clone().sub(this._centralBody.getPosition());
            } else {
                this._cameraOffset = currentCameraOffset;
            }
            this.notifyTargetChange(this._centralBody.getName());
        } else {
            const orbitalIndex = this._orbitalBodies.indexOf(body);
            if (orbitalIndex >= 0) {
                this._cameraTarget = body;
                this._cameraTargetIndex = orbitalIndex;
                const storedState = this._bodyCameraStates.get(body.getName());
                if (storedState && storedState.position) {
                    // Restore from serialized Body state
                    this.position.copy(new THREE.Vector3(storedState.position.x, storedState.position.y, storedState.position.z));
                    this._cameraOffset = this.position.clone().sub(body.getPosition());
                } else {
                    this._cameraOffset = currentCameraOffset;
                }
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
        this._controls.minDistance = 0; // Reset min distance
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
