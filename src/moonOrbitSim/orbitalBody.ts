import * as THREE from "three";
import { Trajectory } from "./trajectory";
import { TransferTrajectory } from "./transferTrajectory";
import { MeasureVector3, LengthVector3, VelocityVector3 } from "./unitsVector3";
import {
  Mass,
  Measure,
  Length,
  Velocity,
  kilograms,
  kilometers,
  seconds,
  GenericMeasure,
  gravitationalConstantUnit,
  Time,
} from "./units";
import { Body } from "./types";
import { ORBIT_UPDATE_METHOD, G } from "./config";

// ============================================================================
// OrbitalBody Rendering
// ============================================================================

export interface OrbitalBodyRender {
  // Core Three.js objects for rendering
  mesh: THREE.Mesh;
  dotSprite: THREE.Sprite;

  // Methods for updating the visual representation
  updateRenderingMode(position: THREE.Vector3, camera: THREE.Camera): void;
  // updateTargetLine removed - now managed by TransferTrajectory
  updateRadius(radius: number, color: number): void;
  setVisibility(visible: boolean): void;
  cleanup(): void;
}

export class OrbitalBodyRenderer implements OrbitalBodyRender {
  mesh: THREE.Mesh;
  dotSprite: THREE.Sprite;

  private scene: THREE.Scene;
  private useDotRendering: boolean = false;
  private radius: number;

  // targetLine removed - now managed by TransferTrajectory

  private texture: THREE.Texture | null = null;

  constructor(
    scene: THREE.Scene,
    position: THREE.Vector3,
    radius: number,
    color: number,
    textureUrl?: string,
  ) {
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
        color: 0xffffff,
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
      sizeAttenuation: false, // Size stays constant regardless of distance
      depthTest: true,
    });
    this.dotSprite = new THREE.Sprite(spriteMaterial);
    this.dotSprite.scale.set(0.01, 0.01, 1); // 10x10 pixel scale for screen-space size
    this.dotSprite.position.copy(position);
    // Don't add to scene yet - will be added when needed

    // Target line (Herringbone pattern) removed - now managed by TransferTrajectory
  }

  /**
   * Create a circular dot texture for the sprite
   */
  private createDotTexture(color: number): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (context) {
      // Draw a filled circle
      context.beginPath();
      context.arc(16, 16, 14, 0, 2 * Math.PI);
      context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
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
  private calculateScreenSize(
    position: THREE.Vector3,
    camera: THREE.Camera,
  ): number {
    if (!(camera instanceof THREE.PerspectiveCamera)) {
      return Infinity; // Default to mesh rendering for non-perspective cameras
    }

    // Calculate distance from camera to body
    const distance = camera.position.distanceTo(position);

    // Get the vertical field of view in radians
    const fov = (camera.fov * Math.PI) / 180;

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
    const shouldUseDot = screenSize < 10; // Use dot if body is less than 10 pixels

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
    // targetLine cleanup removed - now managed by TransferTrajectory
    this.mesh.geometry.dispose();
    if (this.mesh.material instanceof THREE.Material) {
      this.mesh.material.dispose();
    }
    if (this.dotSprite.material.map) {
      this.dotSprite.material.map.dispose();
    }
    this.dotSprite.material.dispose();

    // targetLine cleanup removed - now managed by TransferTrajectory

    // Clean up texture if it exists
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
  public initialPosition: THREE.Vector3; // Public for UI inspection
  public initialVelocity: THREE.Vector3; // Public for UI inspection
  private _trajectory: Trajectory; // Private - use underscore prefix
  private _render: OrbitalBodyRender; // Private - rendering delegate
  private _lastUpdateTime: number = 0; // Store last update time for UI indicators

  // Target Selection
  public target: OrbitalBody | null = null;
  public targetId: string = ""; // Serialized target ID

  // Dual-rendering mode: calculate both analytical and bezier positions
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
    name: string = "Unnamed",
    parentId: string = "",
    texture?: string,
  ) {
    // Initialize Body with standard properties
    super({
      position: position.clone(),
      velocity: velocity.clone(),
      mass: mass,
      radius: radius,
      name: name,
      color: `#${color.toString(16).padStart(6, "0")}`,
      trajectoryColor: `#${trajectoryColor.toString(16).padStart(6, "0")}`,
      parentId: parentId,
      id: name,
      texture: texture,
    });

    this.initialPosition = position.clone();
    this.initialVelocity = velocity.clone();

    // Store scene reference
    this._scene = scene;

    // Create renderer for the body
    this._render = new OrbitalBodyRenderer(
      scene,
      position,
      radius,
      color,
      texture,
    );

    // Create trajectory (one per body)
    this._trajectory = new Trajectory(scene, trajectoryColor);

    // Hide markers for Earth by default (as per user request)
    if (name.toLowerCase() === "earth") {
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
    // Trajectory cleanup?
    // this._trajectory... we might need to expose cleanup there.
  }

  static fromConfig(scene: THREE.Scene, bodyConfig: Body): OrbitalBody {
    const colorHex = bodyConfig.color
      ? parseInt(bodyConfig.color.replace("#", ""), 16)
      : 0xcccccc;
    const trajectoryColorHex = bodyConfig.trajectoryColor
      ? parseInt(bodyConfig.trajectoryColor.replace("#", ""), 16)
      : 0xff6666;

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
      bodyConfig.texture,
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
      targetId: this.target ? this.target.getId() : this.targetId,
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
      this.targetId = "";
      return true;
    }

    // Validate: Cannot target self
    if (target === this) {
      console.warn(`[OrbitalBody] ${this.name} cannot target itself.`);
      return false;
    }

    // Validate: Cannot target parent (if parentId matches target ID or name)
    // If we had a direct parent reference we would check that too
    if (
      this.parentId &&
      (target.id === this.parentId || target.getName() === this.parentId)
    ) {
      console.warn(
        `[OrbitalBody] ${this.name} cannot target its parent ${target.getName()}.`,
      );
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
   */
  updateRenderingMode(camera: THREE.Camera, isSelected: boolean = false): void {
    const targetPos =
      this.target && isSelected ? this.target.getPosition() : null;

    // Custom start position for target line: use transfer debug position if available
    let lineStartPos = this.position;

    if (this._transferTrajectory && isSelected) {
      const debugPos = this._transferTrajectory.getDebugPosition();
      if (debugPos) {
        lineStartPos = debugPos;
      }
    }

    // Update rendering mode (mesh vs sprite)
    this._render.setVisibility(true);
    this._render.updateRenderingMode(this.position, camera);
    // DISABLED: Herringbone now managed by TransferTrajectory
    // this._render.updateTargetLine(lineStartPos, targetPos, camera);
  }

  /**
   * Initialize trajectory if needed (called on first update to capture start time)
   */
  private ensureTrajectoryInitialized(
    centralBodyMass: number,
    currentTime: number,
  ): void {
    if (!this._trajectoryInitialized) {
      const positionVec = MeasureVector3.fromVector3<Length>(
        this.initialPosition,
        kilometers,
      );
      const velocityVec = MeasureVector3.fromVector3<Velocity>(
        this.initialVelocity,
        kilometers.per(seconds),
      );
      const centralMass = Measure.of(centralBodyMass, kilograms);
      const startTime = Measure.of(currentTime, seconds);

      this._trajectory.calculateFromState(
        positionVec,
        velocityVec,
        centralMass,
        startTime,
      );
      this._trajectoryInitialized = true;
    }
  }

  /**
   * Update position and velocity using numerical integration
   * All units: distance in km, velocity in km/s, mass in kg, time in seconds
   * G must be in km³/(kg·s²) as a Measure
   */
  private updateNumerical(
    dt: number,
    centralBodyPosition: THREE.Vector3,
    centralBodyMass: number,
    G: GenericMeasure<number, any, any>,
  ): void {
    const r = this.position.clone().sub(centralBodyPosition);
    const distance = r.length(); // km

    // Prevent division by zero and extreme forces at very small distances
    if (distance >= 2.5) {
      // Force = -G * m1 * m2 / r²
      // Units: G (km³/(kg·s²)) * mass (kg) * mass (kg) / distance² (km²) = kg·km/s²
      const GValue = (G as any).over(gravitationalConstantUnit).value;
      const force = r
        .normalize()
        .multiplyScalar(
          (-GValue * this.mass * centralBodyMass) / (distance * distance),
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
   * 
   * Now also handles rendering/visibility control
   */
  update(
    dt: number,
    centralBodyPosition: THREE.Vector3,
    centralBodyMass: number,
    G: GenericMeasure<number, any, any>,
    currentTime: number = 0,
    renderOptions?: { isSelected: boolean, isTarget: boolean, trajectoriesVisible: boolean, camera?: THREE.Camera }
  ): void {
    // Optimize: skip trajectory init if using Numerical (except for visualization?)
    // Visualization requires trajectory. So always init.
    this.ensureTrajectoryInitialized(centralBodyMass, currentTime);
    this._lastUpdateTime = currentTime; // Store for getCurrentNormalizedTime

    // Update trajectory debugging annotations
    this._trajectory.update(currentTime);

    // Update position and velocity using trajectory or numerical integration
    if (ORBIT_UPDATE_METHOD === "analytical") {
      // Use optimized getBezierState to get both position and velocity efficiently
      const state = this._trajectory.getBezierState(currentTime, {
        calcVelocity: true,
      });

      if (state.position) {
        this.position.copy(state.position).add(centralBodyPosition);
        if (state.velocity) {
          this.velocity.copy(state.velocity);
        }
      }
    } else {
      this.updateNumerical(dt, centralBodyPosition, centralBodyMass, G);
    }

    // Note: mesh/sprite position is updated in updateRenderingMode(), called from game loop

    // Update orbit visualization if trajectory is initialized
    if (this._trajectoryInitialized) {
      // Trajectory handles all visualization including orbit line and trail
      this._trajectory.updateOrbitVisualization(
        this._lastUpdateTime,
        this.position,
      );
    }

    // Update transfer trajectory with rendering options
    if (this._transferTrajectory && renderOptions) {
      const showTransfer = renderOptions.isSelected;
      
      // Prepare target position for herringbone line
      let targetPosition: THREE.Vector3 | undefined;
      if (this.target) {
        targetPosition = this.target.getPosition();
      }
      
      // Call transfer trajectory's update method with visibility options
      this._transferTrajectory.update(currentTime, { 
        visible: showTransfer,
        camera: renderOptions.camera,
        targetPosition: targetPosition,
        startPosition: this.position
      });
    } else if (this._transferTrajectory) {
      // No render options provided, just update without visibility control
      this._transferTrajectory.update(currentTime);
    }
  }

  /**
   * Reset to initial conditions and recalculate trajectory
   */
  reset(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    mass: number,
    centralBodyMass: number,
    radius?: number,
  ): void {
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
      const color = (
        this._render.mesh.material as THREE.MeshPhongMaterial
      ).color.getHex();
      this._render.updateRadius(radius, color);
    }

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

    // Clear trajectory
    this._trajectory.clear();
  }

  /**
   * Force-update the trajectory parameters and visualization based on the CURRENT physical state.
   * Useful for aligning visualizations before computing transfers.
   */
  updateTrajectoryFromCurrentState(
    currentTime: number,
    centralBodyMass: number,
  ): void {
    const positionVec = MeasureVector3.fromVector3<Length>(
      this.position,
      kilometers,
    );
    const velocityVec = MeasureVector3.fromVector3<Velocity>(
      this.velocity,
      kilometers.per(seconds),
    );
    const centralMass = Measure.of(centralBodyMass, kilograms);
    const startTime = Measure.of(currentTime, seconds);

    this._trajectory.calculateFromState(
      positionVec,
      velocityVec,
      centralMass,
      startTime,
    );
    this._trajectoryInitialized = true;
  }

  /**
   * Get current position (analytical/numerical position)
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
  setTransferTrajectory(
    trajectory: TransferTrajectory,
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
  ): void {
    this.clearTransfer();

    this._transferTrajectory = trajectory;

    // Set target trajectory for distance tracking in debug labels
    if (this.target) {
      this._transferTrajectory.setTargetTrajectory(this.target.getTrajectory());
    }

    // Delegate marker creation to the trajectory
    this._transferTrajectory.createMarkers(startPos, endPos, this.radius * 0.5);
  }

  /**
   * Clear transfer trajectory
   */
  clearTransfer(): void {
    if (this._transferTrajectory) {
      // Use cleanup method on trajectory
      this._transferTrajectory.cleanup();
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

}
