import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { TransferTrajectory } from './transferTrajectory';
import { MeasureVector3, LengthVector3, VelocityVector3 } from './unitsVector3';
import { Mass, Measure, Length, Velocity, kilograms, kilometers, seconds, GenericMeasure, gravitationalConstantUnit, Time } from './units';
import { Body } from './types';
import { ORBIT_UPDATE_METHOD, G } from './config';

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
    updateTrail(points: THREE.Vector3[]): void;
    updateTargetLine(start: THREE.Vector3, end: THREE.Vector3 | null, camera?: THREE.Camera): void;
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
    
    private targetLine: THREE.LineSegments;

    private texture: THREE.Texture | null = null;

    constructor(scene: THREE.Scene, position: THREE.Vector3, radius: number, color: number, textureUrl?: string) {
        this.scene = scene;
        this.radius = radius;

        // Create mesh for the body
        const geometry = new THREE.SphereGeometry(radius, 64, 64); // Increased segments for better texture mapping
        
        let material: THREE.MeshPhongMaterial;

        if (textureUrl) {
            // Load texture
            const textureLoader = new THREE.TextureLoader();
            this.texture = textureLoader.load(textureUrl);
            this.texture.colorSpace = THREE.SRGBColorSpace;
            
            // Use texture map and white color to avoid tinting
            material = new THREE.MeshPhongMaterial({ 
                map: this.texture,
                color: 0xffffff 
            });
        } else {
            // Fallback to solid color
            material = new THREE.MeshPhongMaterial({ color });
        }

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

        // Initialize trail (empty until updated)
        this.trailPoints = [];

        // Create target line (Herringbone pattern)
        const lineGeometry = new THREE.BufferGeometry();
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            opacity: 0.5,
            transparent: true,
            depthWrite: true,
            depthTest: true
        });
        this.targetLine = new THREE.LineSegments(lineGeometry, lineMaterial);
        this.targetLine.visible = false;
        this.targetLine.frustumCulled = false;
        scene.add(this.targetLine);
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
     * Update trail points directly
     */
    updateTrail(points: THREE.Vector3[]): void {
        this.trailPoints = points.map(p => p.clone());
    }

    /**
     * Update target line to point to a target position
     * Generates a billboarded herringbone/chevron pattern
     */
    updateTargetLine(start: THREE.Vector3, end: THREE.Vector3 | null, camera?: THREE.Camera): void {
        if (!end || !camera) {
            this.targetLine.visible = false;
            return;
        }

        // Constants
        const PIXEL_SPACING = 15.0; // Distance in pixels between chevrons (Doubled density)
        const CHEVRON_PIXEL_SIZE = 10.0; // Size of chevron wings in pixels

        // 1. Transform World Points to Camera Space for Clipping
        const startView = start.clone().applyMatrix4(camera.matrixWorldInverse);
        const endView = end.clone().applyMatrix4(camera.matrixWorldInverse);

        // Near plane clip distance
        const near = (camera as any).near || 0.1;
        const CLIP_Z = -near;

        if (startView.z > CLIP_Z && endView.z > CLIP_Z) {
            this.targetLine.visible = false;
            return;
        }

        let sClipped = start.clone();
        let eClipped = end.clone();
        let wStart = -startView.z;
        let wEnd = -endView.z;

        const clipLine = (p1: THREE.Vector3, p2: THREE.Vector3, w1: number, w2: number) => {
            if (p1.z > CLIP_Z) {
                const diff = p2.z - p1.z;
                const t = diff !== 0 ? (CLIP_Z - p1.z) / diff : 0;
                const pNew = new THREE.Vector3().lerpVectors(p1, p2, t);
                return { pos: pNew, w: -pNew.z, t: t }; 
            }
            return { pos: p1, w: w1, t: 0 };
        };

        let tStart = 0;
        let tEnd = 1;

        if (startView.z > CLIP_Z) {
            const res = clipLine(startView, endView, wStart, wEnd);
            startView.copy(res.pos);
            wStart = res.w;
            tStart = res.t;
        }
        if (endView.z > CLIP_Z) {
            const res = clipLine(endView, startView, wEnd, wStart);
            endView.copy(res.pos);
            wEnd = res.w;
            tEnd = 1.0 - res.t;
        }

        // Reconstruct clipped world points based on interpolation
        sClipped.lerpVectors(start, end, tStart);
        eClipped.lerpVectors(start, end, tEnd);

        // 2. Project to Screen Space (Pixels)
        const height = window.innerHeight;
        const width = window.innerWidth;

        const pScrStart = sClipped.clone().project(camera);
        const pScrEnd = eClipped.clone().project(camera);

        const sScr = new THREE.Vector2((pScrStart.x + 1) * width / 2, (-pScrStart.y + 1) * height / 2);
        const eScr = new THREE.Vector2((pScrEnd.x + 1) * width / 2, (-pScrEnd.y + 1) * height / 2);

        // Screen Segment Vector
        const vScr = new THREE.Vector2().subVectors(eScr, sScr);
        const lenScr = vScr.length();

        if (lenScr < 1.0) {
            this.targetLine.visible = false;
            return;
        }

        const dirScr = vScr.clone().normalize();

        // 3. Determine Anchor Point (Midpoint)
        const midWorld = new THREE.Vector3().lerpVectors(start, end, 0.5);
        const midView = midWorld.clone().applyMatrix4(camera.matrixWorldInverse);
        
        let anchorFromStartPixels = 0;
        
        if (midView.z <= CLIP_Z) {
            const temp = midWorld.clone().project(camera);
            const midScr = new THREE.Vector2((temp.x + 1) * width / 2, (-temp.y + 1) * height / 2);
            const vMid = new THREE.Vector2().subVectors(midScr, sScr);
            anchorFromStartPixels = vMid.dot(dirScr);
        } else {
            anchorFromStartPixels = 0;
        }

        // 4. Viewport Clipping (Liang-Barsky) to limit iterations
        // We only want to draw chevrons that are actually on screen.
        // Screen Rect: (0,0) to (width, height)
        // Segment: P(sigma) = sScr + sigma * (eScr - sScr), sigma in [0,1]
        
        const dx = eScr.x - sScr.x;
        const dy = eScr.y - sScr.y;
        
        let t0 = 0.0;
        let t1 = 1.0;
        
        const p = [-dx, dx, -dy, dy];
        const q = [sScr.x, width - sScr.x, sScr.y, height - sScr.y]; // Clip against Left, Right, Top, Bottom
        // Note: Y is pixels, 0 at top?
        // project formula: (-temp.y + 1) * height / 2.
        // temp.y=1 -> 0. temp.y=-1 -> height.
        // So 0 is Top. Height is Bottom.
        // q calc:
        // Left (x>0): -dx * t <= sScr.x -> -dx is p[0], sScr.x is q[0]
        // Right (x<W): dx * t <= W - sScr.x
        // Top (y>0): -dy * t <= sScr.y
        // Bottom (y<H): dy * t <= H - sScr.y

        let visible = true;
        for(let i=0; i<4; i++) {
            if (p[i] === 0) {
                if (q[i] < 0) visible = false;
            } else {
                const r = q[i] / p[i];
                if (p[i] < 0) {
                    if (r > t1) visible = false;
                    else if (r > t0) t0 = r;
                } else {
                    if (r < t0) visible = false;
                    else if (r < t1) t1 = r;
                }
            }
        }
        
        if (!visible) {
            this.targetLine.visible = false;
            return;
        }

        // 5. Generate Points
        const points: THREE.Vector3[] = [];
        
        // Helper to solve 3D point from fraction 'sigma' along screen segment
        const getPointAtSigma = (sigma: number): THREE.Vector3 => {
            const numerator = sigma * wStart;
            const denominator = wEnd * (1 - sigma) + wStart * sigma;
            // Guard against division by zero (unlikely with near clip but safe)
            const u = Math.abs(denominator) > 1e-6 ? numerator / denominator : sigma;
            return new THREE.Vector3().lerpVectors(sClipped, eClipped, u);
        };

        // Range of pixels to cover: from t0*lenScr to t1*lenScr
        // We step relative to anchor
        // anchor + k*Spacing = pixDist
        // We want pixDist between [t0 * lenScr, t1 * lenScr]
        
        const startPix = t0 * lenScr;
        const endPix = t1 * lenScr;
        
        const minK = Math.ceil((startPix - anchorFromStartPixels) / PIXEL_SPACING);
        const maxK = Math.floor((endPix - anchorFromStartPixels) / PIXEL_SPACING);
        
        // Safety cap to strictly prevent crashes/freezes
        const count = maxK - minK + 1;
        if (count > 2000) {
            // Should not happen with viewport clipping unless screen is massive or spacing huge
            // But good safety valve
             this.targetLine.visible = false;
             return;
        }

        const lineDir = new THREE.Vector3().subVectors(eClipped, sClipped).normalize();

        for (let k = minK; k <= maxK; k++) {
            const pixDist = anchorFromStartPixels + k * PIXEL_SPACING;
            const sigma = pixDist / lenScr;
            
            // Should be bounded by t0/t1 but float errors might push slightly
            if (sigma < 0 || sigma > 1) continue; 
            
            const centerPos = getPointAtSigma(sigma);
            
            const dist = centerPos.distanceTo(camera.position);
            
            // Assume FOV 50 if generic camera
            const fov = (camera instanceof THREE.PerspectiveCamera) ? camera.fov : 50;
            const tan = Math.tan((fov * Math.PI / 180) / 2);
            const worldSize = (CHEVRON_PIXEL_SIZE / height) * 2 * dist * tan;
            
            const chevronWingLength = worldSize; 
            const chevronWidthOffset = worldSize * 0.6; 

            // Billboarding
            const viewVec = new THREE.Vector3().subVectors(centerPos, camera.position).normalize();
            const right = new THREE.Vector3().crossVectors(lineDir, viewVec).normalize();
            if (right.lengthSq() < 0.001) {
                right.crossVectors(lineDir, new THREE.Vector3(0, 1, 0)).normalize();
            }

            const tip = centerPos.clone().add(lineDir.clone().multiplyScalar(chevronWingLength * 0.5));
            const base = centerPos.clone().sub(lineDir.clone().multiplyScalar(chevronWingLength * 0.5));
            
            const left = base.clone().add(right.clone().multiplyScalar(chevronWidthOffset));
            const rightPos = base.clone().sub(right.clone().multiplyScalar(chevronWidthOffset));
            
            points.push(left, tip);
            points.push(rightPos, tip);
        }

        this.targetLine.geometry.setFromPoints(points);
        this.targetLine.visible = true;
    }

    /**
     * Get trail points (return current stored points)
     */
    getTrailPoints(): THREE.Vector3[] {
        return this.trailPoints;
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
        // Clean up analytical rendering
        this.scene.remove(this.mesh);
        this.scene.remove(this.dotSprite);
        this.scene.remove(this.targetLine);
        this.mesh.geometry.dispose();
        if (this.mesh.material instanceof THREE.Material) {
            this.mesh.material.dispose();
        }
        if (this.dotSprite.material.map) {
            this.dotSprite.material.map.dispose();
        }
        this.dotSprite.material.dispose();

        // Clean up target line
        this.targetLine.geometry.dispose();
        if (this.targetLine.material instanceof THREE.Material) {
            this.targetLine.material.dispose();
        }
        
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }
        
        // Note: OrbitalBodyRenderer doesn't know about the OrbitalBody's transfer stuff.
        // The transfer stuff is on the OrbitalBody class, not OrbitalBodyRenderer.
        // So we need to handle cleanup in OrbitalBody.dispose() or similar?
        // OrbitalBody extends Body, does it have dispose?
        // existing code has `cleanup()` in OrbitalBodyRenderer.
        // `OrbitalBody` likely needs a cleanup/dispose method.
        // Let's check if OrbitalBody has one.
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
    private _bezierRender: OrbitalBodyRender | null = null; // Private - bezier rendering delegate
    private _lastUpdateTime: number = 0;    // Store last update time for UI indicators
    
    // Target Selection
    public target: OrbitalBody | null = null;
    public targetId: string = ''; // Serialized target ID

    // Dual-rendering mode: calculate both analytical and bezier positions
    private _dualRenderingEnabled: boolean = false;
    private _bezierPosition: THREE.Vector3 | null = null;
    private _bezierVelocity: THREE.Vector3 | null = null;
    private _trajectoryInitialized: boolean = false;
    
    // Transfer Trajectory (Hohmann)
    private _transferTrajectory: TransferTrajectory | null = null;
    // Unused properties removed during refactoring
    // private _transferStartPoint: THREE.Mesh | null = null;
    // private _transferEndPoint: THREE.Mesh | null = null;
    private _transferBezierRender: OrbitalBodyRender | null = null; // Re-use renderer for transfer visualization? Or just use Trajectory renderer.
    // Actually Trajectory has its own renderer. We just need to hold the Trajectory object.
    
    // Markers for transfer start/end
    // private _transferStartMarker: THREE.Mesh | null = null; // Removed - moved to TransferTrajectory
    // private _transferEndMarker: THREE.Mesh | null = null;   // Removed - moved to TransferTrajectory

    private _scene: THREE.Scene;

    constructor(
        scene: THREE.Scene,
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        mass: number,
        radius: number = 1.0,
        color: number = 0xcccccc,
        trajectoryColor: number = 0xff6666,
        name: string = 'Unnamed',
        parentId: string = '',
        texture?: string
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
            id: name,
            texture: texture
        });

        this.initialPosition = position.clone();
        this.initialVelocity = velocity.clone();

        // Store scene reference
        this._scene = scene;

        // Create renderer for the body
        this._render = new OrbitalBodyRenderer(scene, position, radius, color, texture);

        // Create trajectory (one per body)
        this._trajectory = new Trajectory(scene, trajectoryColor);

        // Hide markers for Earth by default (as per user request)
        if (name.toLowerCase() === 'earth') {
            this._trajectory.setMarkersVisible(false);
        }
    }

    /**
     * Create an OrbitalBody from a Body configuration object
     * This allows each class to know how to serialize/deserialize itself
     */
     
    dispose(): void {
        this.clearTransfer();
        this._render.cleanup();
        if (this._bezierRender) {
            this._bezierRender.cleanup();
        }
        // Trajectory cleanup?
        // this._trajectory... we might need to expose cleanup there.
    }

    static fromConfig(scene: THREE.Scene, bodyConfig: Body): OrbitalBody {
        const colorHex = bodyConfig.color ? parseInt(bodyConfig.color.replace('#', ''), 16) : 0xcccccc;
        const trajectoryColorHex = bodyConfig.trajectoryColor ? parseInt(bodyConfig.trajectoryColor.replace('#', ''), 16) : 0xff6666;

        const body = new OrbitalBody(
            scene,
            bodyConfig.position.clone(),
            bodyConfig.velocity.clone(),
            bodyConfig.mass,
            bodyConfig.radius,
            colorHex,
            trajectoryColorHex,
            bodyConfig.name,
            bodyConfig.parentId,
            bodyConfig.texture
        );
        
        if (bodyConfig.targetId) {
            body.targetId = bodyConfig.targetId;
            // Note: We can't resolve the actual body reference here yet because 
            // other bodies might not exist. Resolution should happen after all bodies are loaded.
        }
        
        return body;
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
            id: this.id,
            targetId: this.target ? this.target.getId() : this.targetId
        });
    }

    /**
     * Set the target body
     * Validates that the target is not this body and not the parent
     */
    setTarget(target: OrbitalBody | null): boolean {
        // Clear target
        if (target === null) {
            this.target = null;
            this.targetId = '';
            return true;
        }

        // Validate: Cannot target self
        if (target === this) {
            console.warn(`[OrbitalBody] ${this.name} cannot target itself.`);
            return false;
        }

        // Validate: Cannot target parent (if parentId matches target ID or name)
        // If we had a direct parent reference we would check that too
        if (this.parentId && (target.id === this.parentId || target.getName() === this.parentId)) {
            console.warn(`[OrbitalBody] ${this.name} cannot target its parent ${target.getName()}.`);
            return false;
        }
        
        // Also check if the target is the central body and this body is orbiting it?
        // The user said "parent", which usually implies the body it's orbiting. 
        // In our simple sim, everything orbits central body or is central body.
        // But let's stick to the explicit 'parentId' check for now.

        this.target = target;
        this.targetId = target.id;
        return true;
    }

    /**
     * Update rendering mode based on screen size
     * Switches between 3D mesh and 2D dot sprite
     * In dual-rendering mode, updates both analytical and bezier renderings
     */
    updateRenderingMode(camera: THREE.Camera): void {
        // If dual-rendering is enabled, we only want to show the Bezier (ghost) render
        // and hide the Analytical (primary) render, as per user request to "disable renderings of the analytical version".

        const targetPos = this.target ? this.target.getPosition() : null;

        if (this._dualRenderingEnabled) {
            // Hide primary (analytical)
            this._render.setVisibility(false);
            this._render.updateTargetLine(this.position, null, camera); // Ensure hidden

            // Show/Update bezier (ghost)
            if (this._bezierPosition && this._bezierRender) {
                this._bezierRender.setVisibility(true);
                this._bezierRender.updateRenderingMode(this._bezierPosition, camera);
                this._bezierRender.updateTargetLine(this._bezierPosition, targetPos, camera);
            }
        } else {
            // Normal mode: Show primary, dual rendering logic handles visibility of ghost if it existed but here we ensure primary is visible
            this._render.setVisibility(true);
            this._render.updateRenderingMode(this.position, camera);
            this._render.updateTargetLine(this.position, targetPos, camera);
        }
    }

    /**
     * Initialize trajectory if needed (called on first update to capture start time)
     */
    private ensureTrajectoryInitialized(centralBodyMass: number, currentTime: number): void {
        if (!this._trajectoryInitialized) {
            const positionVec = MeasureVector3.fromVector3<Length>(this.initialPosition, kilometers);
            const velocityVec = MeasureVector3.fromVector3<Velocity>(this.initialVelocity, kilometers.per(seconds));
            const centralMass = Measure.of(centralBodyMass, kilograms);
            const startTime = Measure.of(currentTime, seconds);

            this._trajectory.calculateFromState(positionVec, velocityVec, centralMass, startTime);
            this._trajectoryInitialized = true;
        }
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
     * Update position and velocity based on gravitational force
     * Supports both numerical integration and analytical (Kepler's equations) methods via Trajectory
     * In dual-rendering mode, calculates both analytical AND bezier positions
     * All units: distance in km, velocity in km/s, mass in kg, time in seconds
     * G must be in km³/(kg·s²) as a Measure
     */
    update(dt: number, centralBodyPosition: THREE.Vector3, centralBodyMass: number, G: GenericMeasure<number, any, any>, currentTime: number = 0): void {

        // Optimize: skip trajectory init if using Numerical (except for visualization?)
        // Visualization requires trajectory. So always init.
        this.ensureTrajectoryInitialized(centralBodyMass, currentTime);
        this._lastUpdateTime = currentTime; // Store for getCurrentNormalizedTime

        // Update trajectory debugging annotations
        this._trajectory.update(currentTime);

        // If dual-rendering is enabled, calculate BOTH positions
        if (this._dualRenderingEnabled) {
            // Dual Rendering: One is "Primary" (Analytical), other is "Ghost" (Bezier)
            // But wait, the request was: "The orbital body should just ask the trajectory object for either the analytical position or the bezier position"

            // Primary Position
            if (ORBIT_UPDATE_METHOD === 'analytical') {
                const pos = this._trajectory.getPosition(currentTime, 'analytical');
                if (pos) {
                    this.position.copy(pos).add(centralBodyPosition);
                    // Velocity? Trajectory doesn't currently return velocity. 
                    // Analytical velocity is needed for numerical fallback or display?
                    // For now, we only update position. 
                    // To keep velocity consistent, we might need Trajectory to return state { position, velocity }.
                    // But for now, we leave velocity as is or use finite diff if needed.
                }
            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            // Secondary (Ghost) Position -> Standard Bezier
            const ghostPos = this._trajectory.getPosition(currentTime, 'bezier');
            if (ghostPos) {
                this._bezierPosition = ghostPos.clone().add(centralBodyPosition);
            } else {
                this._bezierPosition = null;
            }

            // Secondary (Ghost) Velocity
            this._bezierVelocity = this._trajectory.getBezierVelocity(currentTime);

        } else {
            // Normal single-position update
            // Default "Bezier" estimation preferred for speed/smoothness as per request? 
            // Request: "default being the bezier position"

            let pos: THREE.Vector3 | null = null;

            if (ORBIT_UPDATE_METHOD === 'analytical') {
                // The user said: "The orbital body should just ask the trajectory object for either the analytical position or the bezier position, with the default being the bezier position"
                // So we use 'bezier' by default if possible?
                // But ORBIT_UPDATE_METHOD implies user choice.
                // I'll stick to 'bezier' as the implementation for analytical mode because it's the efficient way.
                // However, 'analytical' implies exact Kepler.
                // I will assume 'analytical' setting maps to 'bezier' optimized trajectory unless explicitly 'analytical' requested in getPosition call.

                // If default is bezier, I ask for bezier.
                // Use optimized getBezierState to get both position and velocity efficiently
                const state = this._trajectory.getBezierState(currentTime, { calcVelocity: true });

                if (state.position) {
                    this.position.copy(state.position).add(centralBodyPosition);
                    if (state.velocity) {
                        this.velocity.copy(state.velocity);
                    }
                } else {
                    // Fallback or skip if not ready
                    // const pos = this._trajectory.getPosition(currentTime, 'bezier');
                }


            } else {
                this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
            }

            this._bezierPosition = null;
        }

        // Note: mesh/sprite position is updated in updateRenderingMode(), called from game loop

        // Update trail using simplified static method
        // Use bezierT if available (closest to visual position on curve)
        // If trajectory not initialized or not using bezier, we might need fallback?
        // But user request implies trajectory-based tail.

        if (this._trajectoryInitialized) {
            // Visualization requires BEZIER T (warped), not linear T
            const bezierT = this._trajectory.getBezierT(this._lastUpdateTime);

            // 1. Update orbit visualization (line)
            this._trajectory.updateOrbitVisualization(bezierT, this.position);

            // 2. Update Trail (tail)
            if (typeof this._trajectory.getStaticTrailPoints === 'function') {
                // Get 16 previous points
                const trailPoints = this._trajectory.getStaticTrailPoints(bezierT, 16);
                // Append current body position to the end (newest)
                trailPoints.push(this.position);
                // Update renderer
                this._render.updateTrail(trailPoints);
            }
        } else {
            // Fallback for when trajectory is not ready? 
            // Just set trail to current position
            this._render.updateTrail([this.position]);
        }
        
        // Update transfer trajectory annotations if active
        if (this._transferTrajectory) {
             this._transferTrajectory.update(currentTime);
        }
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

        // Flag trajectory for re-initialization (will happen on next update with fresh time)
        this._trajectoryInitialized = false;

        // Update radius and regenerate mesh if radius is provided
        if (radius !== undefined && radius !== this.radius) {
            this.radius = radius;
            // Get color from existing mesh material
            const color = (this._render.mesh.material as THREE.MeshPhongMaterial).color.getHex();
            this._render.updateRadius(radius, color);

            // Update bezier renderer if it exists
            if (this._bezierRender) {
                const bezierColor = (this._bezierRender.mesh.material as THREE.MeshPhongMaterial).color.getHex();
                this._bezierRender.updateRadius(radius, bezierColor);
            }
        }

        // Clear trail
        this._render.updateTrail([position]);

        // Clear trajectory visualization until initialized
        this._trajectory.clear();
    }

    /**
     * Reset to initial conditions (stored when body was created or last reset)
     * and recompute trajectory
     */
    resetToInitial(centralBodyMass: number): void {
        this.position.copy(this.initialPosition);
        this.velocity.copy(this.initialVelocity);

        // Flag trajectory for re-initialization
        this._trajectoryInitialized = false;

        // Clear trail
        this._render.updateTrail([this.initialPosition]);

        // Clear trajectory
        this._trajectory.clear();
    }

    /**
     * Get current position (analytical/numerical position)
     */
    getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    /**
     * Get bezier position (only available in dual-rendering mode)
     */
    getBezierPosition(): THREE.Vector3 | null {
        return this._bezierPosition ? this._bezierPosition.clone() : null;
    }

    /**
     * Get bezier velocity (only available in dual-rendering mode, or acts as fallback)
     */
    getBezierVelocity(): THREE.Vector3 | null {
        return this._bezierVelocity ? this._bezierVelocity.clone() : null;
    }

    /**
     * Get current velocity
     */
    getVelocity(): THREE.Vector3 {
        return this.velocity.clone();
    }

    /**
     * Enable or disable dual-rendering mode
     * When enabled, both analytical and bezier positions are calculated and rendered
     */
    setDualRenderingEnabled(enabled: boolean): void {
        if (enabled && !this._dualRenderingEnabled) {
            // Enable dual rendering
            this._dualRenderingEnabled = true;
            if (!this._bezierRender) {
                // Use lighter red for bezier trajectory/ghost
                const bezierColor = 0xff6666;
                this._bezierRender = new OrbitalBodyRenderer(this._scene, this.initialPosition, this.radius, bezierColor);
            }
            this._bezierRender.setVisibility(true);
            console.log(`[OrbitalBody] Dual rendering enabled for ${this.name}`);
        } else if (!enabled && this._dualRenderingEnabled) {
            // Disable dual rendering
            this._dualRenderingEnabled = false;
            if (this._bezierRender) {
                this._bezierRender.setVisibility(false);
            }
            this._bezierPosition = null;
            console.log(`[OrbitalBody] Dual rendering disabled for ${this.name}`);
        }
    }

    /**
     * Check if dual-rendering is enabled
     */
    isDualRenderingEnabled(): boolean {
        return this._dualRenderingEnabled;
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
     * Get transfer trajectory
     */
    getTransferTrajectory(): TransferTrajectory | null {
        return this._transferTrajectory;
    }

    /**
     * Set transfer trajectory to visualize
     */
    setTransferTrajectory(trajectory: TransferTrajectory, startPos: THREE.Vector3, endPos: THREE.Vector3): void {
        this.clearTransfer();
        
        this._transferTrajectory = trajectory;
        
        // Delegate marker creation to the trajectory
        this._transferTrajectory.createMarkers(startPos, endPos, this.radius * 0.5);
        
        // Ensure visibility
        this._transferTrajectory.setVisibility(true);
    }
    
    /**
     * Clear transfer trajectory
     */
    clearTransfer(): void {
        if (this._transferTrajectory) {
             // Use cleanup method on trajectory
             this._transferTrajectory.cleanup();
             this._transferTrajectory.setVisibility(false);
             this._transferTrajectory = null; // Release reference
        }
    }

    /**
     * Set trajectory to share with another body
     * This allows multiple bodies to use the same bezier approximation
     */
    setTrajectory(trajectory: Trajectory): void {
        // Clean up old trajectory
        if (this._trajectory) {
            this._trajectory.clear();
        }
        this._trajectory = trajectory;
        this._trajectoryInitialized = true; // Assume shared trajectory is already init? 
        // Or we should assume sharing implies we don't recalculate logic internally?
    }


    /**
     * Get trail points from the renderer
     */
    getTrailPoints(): THREE.Vector3[] {
        if (!this._render) return [];
        return this._render.getTrailPoints();
    }

    /**
     * Get the time warp function from the trajectory
     */
    getTimeWarpFunction(): ((t: number) => number) | null {
        // Return a dummy identity function if trajectory not ready
        if (!this._trajectory) return (t: number) => t;

        // We need to check if the method exists on the trajectory instance
        if (typeof this._trajectory.getTimeWarpFunction === 'function') {
            return this._trajectory.getTimeWarpFunction();
        }
        return (t: number) => t;
    }

    /**
     * Get LUT sample positions from trajectory
     */
    getLUTSamplePositions(): number[] {
        if (!this._trajectory || typeof this._trajectory.getLUTSamplePositions !== 'function') return [];
        return this._trajectory.getLUTSamplePositions();
    }

    /**
     * Get full LUT data from trajectory
     */
    getLUTData(): any {
        if (!this._trajectory || typeof this._trajectory.getLUTData !== 'function') return null;
        return this._trajectory.getLUTData();
    }

    /**
     * Compute analytical position from normalized time
     */
    computeAnalyticalPositionFromNormalizedTime(normalizedTime: number): THREE.Vector3 | null {
        if (!this._trajectory || typeof this._trajectory.computeAnalyticalPositionFromNormalizedTime !== 'function') return null;
        return this._trajectory.computeAnalyticalPositionFromNormalizedTime(normalizedTime);
    }

    /**
     * Compute bezier position from normalized time
     */
    computeWarpedBezierPosition(normalizedTime: number): THREE.Vector3 | null {
        if (!this._trajectory) return null;

        const warpFunc = this.getTimeWarpFunction();
        if (!warpFunc) return null;

        const warpedTime = warpFunc(normalizedTime);

        if (typeof this._trajectory.computeBezierPositionFromTime === 'function') {
            return this._trajectory.computeBezierPositionFromTime(warpedTime);
        }
        return null;
    }

    /**
     * Get current normalized time (0-1) along the orbit
     */
    getCurrentNormalizedTime(): number {
        // We need the period and start time
        const trajectory = this.getTrajectory();
        if (!trajectory) return 0;

        // Use the trajectory's robust calculation which handles M0 and Epoch
        // Returns 0-1 Linear Time relative to Apoapsis
        if (typeof trajectory.getLinearNormalizedTime === 'function') {
            return trajectory.getLinearNormalizedTime(this._lastUpdateTime);
        }

        // Fallback (should not be reached if trajectory is updated)
        const params = trajectory.getParameters();
        const period = (params.period as any).over(seconds).value;
        if (period === 0) return 0;

        const startTime = (trajectory as any)._startTime || 0;
        const dt = this._lastUpdateTime - startTime;
        return (dt % period) / period;
    }
}
