import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { OrbitalBody } from './orbitalBody';
import { config } from './config';

/**
 * CameraManager class that handles all camera-related functionality
 * including target tracking, zoom, and rotation
 */
export class CameraManager {
    private camera: THREE.PerspectiveCamera;
    private controls!: OrbitControls;
    private renderer: THREE.WebGLRenderer;
    
    // Camera target tracking
    private cameraTarget: OrbitalBody | null = null;
    private cameraTargetIndex: number = -1; // -1 = no target (free camera), -2 = central body, >= 0 = orbital body index
    private cameraOffset: THREE.Vector3 = new THREE.Vector3(); // Relative offset from target to camera
    private previousTargetPosition: THREE.Vector3 = new THREE.Vector3(); // Previous target position for tracking
    
    // Storage for camera state per body (to restore when switching back)
    private bodyCameraStates: Map<string, THREE.Vector3> = new Map(); // Maps body name to camera offset
    
    // References to bodies for target switching
    private centralBody: OrbitalBody;
    private orbitalBodies: OrbitalBody[] = [];
    
    // Callback for when target changes (for UI updates)
    private onTargetChangeCallback?: (targetName: string | null) => void;

    constructor(
        camera: THREE.PerspectiveCamera,
        renderer: THREE.WebGLRenderer,
        centralBody: OrbitalBody,
        orbitalBodies: OrbitalBody[]
    ) {
        this.camera = camera;
        this.renderer = renderer;
        this.centralBody = centralBody;
        this.orbitalBodies = orbitalBodies;
        
        this.initControls();
        this.setupKeyboardControls();
    }

    private initControls(): void {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        const controlsConfig = config.scene.controls;
        this.controls.enableDamping = controlsConfig.enableDamping;
        this.controls.dampingFactor = controlsConfig.dampingFactor;
        
    }

    private setupKeyboardControls(): void {
        // Add keyboard listeners for camera target switching
        document.addEventListener('keydown', (event) => {
            // Only handle if not typing in an input field
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (event.key === '[') {
                this.switchCameraTarget(-1); // Previous body
            } else if (event.key === ']') {
                this.switchCameraTarget(1); // Next body
            }
        });
    }

    /**
     * Switch camera target between bodies
     * @param direction -1 for previous, 1 for next
     */
    private switchCameraTarget(direction: number): void {
        const allBodies: (OrbitalBody | null)[] = [this.centralBody, ...this.orbitalBodies, null];
        const currentIndex = this.cameraTargetIndex;

        // Find current index in allBodies array
        let currentArrayIndex = -1;
        if (currentIndex === -2) {
            currentArrayIndex = 0; // Central body
        } else if (currentIndex >= 0 && currentIndex < this.orbitalBodies.length) {
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

        // Store current camera state before switching away from current body
        if (this.cameraTarget) {
            const currentBodyName = this.cameraTarget.getName();
            // Store the current camera offset for this body
            this.bodyCameraStates.set(currentBodyName, this.cameraOffset.clone());
        }

        // Store current offset before switching (for immediate use if no stored state exists)
        const oldTargetPosition = this.cameraTarget ? this.cameraTarget.getPosition() : this.controls.target;
        const currentCameraOffset = this.camera.position.clone().sub(oldTargetPosition);

        // Update camera target
        const newTarget = allBodies[newArrayIndex];
        if (newTarget === null) {
            // Switching to free camera - preserve current camera position
            this.cameraTarget = null;
            this.cameraTargetIndex = -1;
            // Keep controls enabled and don't change camera position
            this.notifyTargetChange(null);
        } else if (newTarget === this.centralBody) {
            this.cameraTarget = this.centralBody;
            this.cameraTargetIndex = -2;
            // Restore stored camera state if available, otherwise use current offset
            const storedState = this.bodyCameraStates.get(this.centralBody.getName());
            this.cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
            this.notifyTargetChange(this.centralBody.getName());
        } else {
            const orbitalIndex = this.orbitalBodies.indexOf(newTarget);
            if (orbitalIndex >= 0) {
                this.cameraTarget = newTarget;
                this.cameraTargetIndex = orbitalIndex;
                // Restore stored camera state if available, otherwise use current offset
                const storedState = this.bodyCameraStates.get(newTarget.getName());
                this.cameraOffset = storedState ? storedState.clone() : currentCameraOffset;
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
        if (!this.cameraTarget) {
            return;
        }

        const targetPosition = this.cameraTarget.getPosition();
        const bodyRadius = this.cameraTarget.getRadius();
        
        // Initialize previous target position to current position to avoid jump on first frame
        this.previousTargetPosition.copy(targetPosition);
        
        // If this is the first time targeting any body (or offset is zero), set up default position
        // Default distance is 10x the body radius
        if (this.cameraOffset.length() === 0) {
            const cameraDistance = bodyRadius * 10;
            // Default viewing angle (slightly above and behind)
            this.cameraOffset = new THREE.Vector3(
                cameraDistance * 0.7,
                cameraDistance * 0.5,
                cameraDistance * 0.7
            );
        }
        
        // Set camera position based on target position + offset (restores stored camera state)
        this.camera.position.copy(targetPosition).add(this.cameraOffset);
        
        // Update controls target to the body's position (this is the focus point)
        // This makes OrbitControls orbit around the body
        this.controls.target.copy(targetPosition);
        
        // Update OrbitControls to sync with the camera position
        // This ensures OrbitControls' internal state matches our camera position
        this.controls.update();
    }

    /**
     * Update camera each frame - call this from the render loop
     */
    update(): void {
        if (this.cameraTarget) {
            const targetPosition = this.cameraTarget.getPosition();
            
            // Calculate the offset that the target has moved
            const targetDelta = targetPosition.clone().sub(this.previousTargetPosition);
            
            // Update camera position by the same offset to maintain relative position
            this.camera.position.add(targetDelta);
            
            // Update the controls target to follow the body
            this.controls.target.copy(targetPosition);
            
            // Update OrbitControls (handles scroll wheel zoom and rotation)
            // OrbitControls manages camera.position internally, but we've already adjusted for target movement
            this.controls.update();
        
            // After controls.update(), capture the current offset (includes scroll wheel changes)
            // This captures any zoom/rotation changes from user input
            this.cameraOffset = this.camera.position.clone().sub(targetPosition);
            
            // Update stored camera state for this body to keep it in sync with user changes
            const currentBodyName = this.cameraTarget.getName();
            this.bodyCameraStates.set(currentBodyName, this.cameraOffset.clone());
            
            // Store current target position for next frame
            this.previousTargetPosition.copy(targetPosition);
        } else {
            // Free camera mode - just update controls normally
            this.controls.update();
        }
    }

    /**
     * Get the current camera target name, or null if in free camera mode
     */
    getCurrentTargetName(): string | null {
        if (this.cameraTarget === null) {
            return null;
        }
        return this.cameraTarget.getName();
    }

    /**
     * Set callback for when camera target changes
     */
    setOnTargetChange(callback: (targetName: string | null) => void): void {
        this.onTargetChangeCallback = callback;
    }

    /**
     * Notify that the target has changed
     */
    private notifyTargetChange(targetName: string | null): void {
        if (this.onTargetChangeCallback) {
            this.onTargetChangeCallback(targetName);
        }
    }

    /**
     * Update the list of orbital bodies (called when bodies are added/removed)
     */
    updateOrbitalBodies(orbitalBodies: OrbitalBody[]): void {
        this.orbitalBodies = orbitalBodies;
        
        // If current target was removed, switch to free camera
        if (this.cameraTarget && this.cameraTargetIndex >= 0) {
            if (!this.orbitalBodies.includes(this.cameraTarget)) {
                this.cameraTarget = null;
                this.cameraTargetIndex = -1;
                this.notifyTargetChange(null);
            } else {
                // Update index if it changed
                this.cameraTargetIndex = this.orbitalBodies.indexOf(this.cameraTarget);
            }
        }
    }

    /**
     * Handle window resize
     */
    handleResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Get the camera (for external access if needed)
     */
    getCamera(): THREE.PerspectiveCamera {
        return this.camera;
    }

    /**
     * Get the controls (for external access if needed)
     */
    getControls(): OrbitControls {
        return this.controls;
    }
}

