import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';

export class TransferTrajectory extends Trajectory {
    // Transfer Annotation Markers
    private _startLabel: THREE.Sprite | null = null;
    private _midLabel: THREE.Sprite | null = null;
    private _endLabel: THREE.Sprite | null = null;
    
    // Markers
    private _startMarker: THREE.Mesh | null = null;
    private _endMarker: THREE.Mesh | null = null;
    private _transferStartTime: number = 0;
    private _transferEndTime: number = 0;

    // Public properties for Property Inspector
    public deltaV1: Velocity = Measure.of(0, kilometers.per(seconds));
    public deltaV2: Velocity = Measure.of(0, kilometers.per(seconds));
    public totalDeltaV: Velocity = Measure.of(0, kilometers.per(seconds));
    public timeOfFlight: Time = Measure.of(0, seconds);
    public startDelay: Time = Measure.of(0, seconds);

    constructor(scene: THREE.Scene, color: number = 0xffff00) {
        super(scene, color);
    }

    setTimes(startTime: number, endTime: number, startDelay: number = 0): void {
        this._transferStartTime = startTime + startDelay;
        this._transferEndTime = endTime + startDelay;
        this._startTime = this._transferStartTime;
        this._endTime = this._transferEndTime;
        this.timeOfFlight = Measure.of(endTime - startTime, seconds);
        this.startDelay = Measure.of(startDelay, seconds);
    }
    
    setDeltaVs(dv1: number, dv2: number): void {
        this.deltaV1 = Measure.of(dv1, kilometers.per(seconds));
        this.deltaV2 = Measure.of(dv2, kilometers.per(seconds));
        this.totalDeltaV = Measure.of(dv1 + dv2, kilometers.per(seconds));
    }
    
    createMarkers(startPos: THREE.Vector3, endPos: THREE.Vector3, radius: number): void {
        this.clearMarkers();
        
        const markerGeometry = new THREE.SphereGeometry(radius, 16, 16); // Use radius passed from body
        const startMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); // Green for start
        const endMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });   // Red for end
        
        this._startMarker = new THREE.Mesh(markerGeometry, startMat);
        this._startMarker.position.copy(startPos);
        this._scene.add(this._startMarker);
        
        this._endMarker = new THREE.Mesh(markerGeometry, endMat);
        this._endMarker.position.copy(endPos);
        this._scene.add(this._endMarker);

        // Create Text Labels
        this._startLabel = this.createLabelSprite();
        this._startLabel.position.copy(startPos).add(new THREE.Vector3(0, radius * 3, 0));
        this._scene.add(this._startLabel);

        this._endLabel = this.createLabelSprite();
        this._endLabel.position.copy(endPos).add(new THREE.Vector3(0, radius * 3, 0));
        this._scene.add(this._endLabel);

        this._midLabel = this.createLabelSprite();
        const midPos = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        // Better mid pos: peak of arc? For now, linear mid is okay, or we can sample trajectory.
        // If we have analytical points, use mid index?
        if (this._analyticalPoints.length > 0) {
            const midIdx = Math.floor(this._analyticalPoints.length / 2);
            midPos.copy(this._analyticalPoints[midIdx]);
        }
        this._midLabel.position.copy(midPos).add(new THREE.Vector3(0, radius * 3, 0));
        this._scene.add(this._midLabel);
    }
    
    /**
    * Update annotations based on current simulation time
    */
    update(currentTime: number): void {
        super.update(currentTime);
        const timeUntilStart = Measure.of(this._transferStartTime - currentTime, seconds);
        const timeUntilEnd = Measure.of(this._transferEndTime - currentTime, seconds);
        
        // Update Start Label
        const startPrefix = timeUntilStart.value > 0 ? "T- " : "T+ ";
        const startText = [
            `Start: ${startPrefix}${formatTime(Measure.of(Math.abs(timeUntilStart.value), seconds), true)}`,
            `ΔV: ${formatVelocity(this.deltaV1, true)}`
        ];
        this.updateLabelTexture(this._startLabel, startText, 0x00ff00);

        // Update End Label
        const endPrefix = timeUntilEnd.value > 0 ? "T- " : "T+ ";
        const endText = [
            `End: ${endPrefix}${formatTime(Measure.of(Math.abs(timeUntilEnd.value), seconds), true)}`,
            `Insert ΔV: ${formatVelocity(this.deltaV2, true)}`
        ];
        this.updateLabelTexture(this._endLabel, endText, 0xff0000);

        // Update Mid Label (Static info mostly)
        const midText = [
            `TOF: ${formatTime(this.timeOfFlight, true)}`,
            `Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`
        ];
        this.updateLabelTexture(this._midLabel, midText, 0xffff00);
    }

    private createLabelSprite(): THREE.Sprite {
        const material = new THREE.SpriteMaterial({
            map: new THREE.Texture(), 
            sizeAttenuation: false,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.24, 0.12, 1); // Aspect 2:1 roughly (Reduced 20% from 0.3, 0.15)
        sprite.renderOrder = 1000;
        return sprite;
    }

    private updateLabelTexture(sprite: THREE.Sprite | null, lines: string[], color: number): void {
        if (!sprite) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 160;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.font = 'bold 24px monospace';
            ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Shadow for readability
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 4;
            ctx.lineWidth = 2;

            const lineHeight = 30;
            const startY = (canvas.height - (lines.length - 1) * lineHeight) / 2;

            lines.forEach((line, index) => {
                ctx.fillText(line, 160, startY + index * lineHeight);
            });
        }
        
        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.map = texture;
    }

    clearMarkers(): void {
        if (this._startMarker) {
            this._scene.remove(this._startMarker);
            this._startMarker.geometry.dispose();
            if (this._startMarker.material instanceof THREE.Material) this._startMarker.material.dispose();
            this._startMarker = null;
        }
        
        if (this._endMarker) {
            this._scene.remove(this._endMarker);
            this._endMarker.geometry.dispose();
            if (this._endMarker.material instanceof THREE.Material) this._endMarker.material.dispose();
            this._endMarker = null;
        }

        if (this._startLabel) {
            this._scene.remove(this._startLabel);
            if (this._startLabel.material.map) this._startLabel.material.map.dispose();
            this._startLabel.material.dispose();
            this._startLabel = null;
        }

        if (this._midLabel) {
            this._scene.remove(this._midLabel);
            if (this._midLabel.material.map) this._midLabel.material.map.dispose();
            this._midLabel.material.dispose();
            this._midLabel = null;
        }

        if (this._endLabel) {
            this._scene.remove(this._endLabel);
            if (this._endLabel.material.map) this._endLabel.material.map.dispose();
            this._endLabel.material.dispose();
            this._endLabel = null;
        }
    }
    
    /**
     * Cleanup resources including markers
     */
    cleanup(): void {
        this.clearMarkers();
        super.cleanup();
    }

    getStartTime(): number {
        return this._transferStartTime;
    }

    getEndTime(): number {
        return this._transferEndTime;
    }

    /**
     * Override calculateFromState to limit validation or customized behavior
     * For now, we generally use the parent's physics calculation, 
     * but we might want to trim the trajectory to just the transfer arc.
     */
    calculateFromState(position: LengthVector3, velocity: VelocityVector3, centralBodyMass: Mass, startTime: Time): void {
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // Post-process the generated points to only show the transfer segment
        // A Hohmann transfer is typically half an ellipse (0 to PI eccentric anomaly).
        
        // Determine if we are launching from Periapsis or Apoapsis
        // We can check the dot product of position vector and eccentricity vector.
        // If dot > 0, we are at Periapsis (angle 0).
        // If dot < 0, we are at Apoapsis (angle 180).
        
        const posVec = position.getVector3();
        const eVec = this.parameters._eVec.getVector3();
        const dot = posVec.dot(eVec);
        const isPeriapsisLaunch = dot >= 0;

        // Analytical Points: Generated Periapsis -> Apoapsis -> Periapsis
        // First Half: Pe -> Ap
        // Second Half: Ap -> Pe
        if (this._analyticalPoints.length > 0) {
            const mid = Math.floor(this._analyticalPoints.length / 2);
            if (isPeriapsisLaunch) {
                // We want Pe -> Ap (First Half)
                this._analyticalPoints = this._analyticalPoints.slice(0, mid + 1);
            } else {
                // We want Ap -> Pe (Second Half)
                this._analyticalPoints = this._analyticalPoints.slice(mid);
            }
            
            this._renderer.updateOrbitLine(this._analyticalPoints);
        }

        // Bezier Points: Generated Apoapsis -> Periapsis -> Apoapsis
        // First Half: Ap -> Pe
        // Second Half: Pe -> Ap
        if (this._bezierPoints.length > 0) {
             const mid = Math.floor(this._bezierPoints.length / 2);
             
             if (isPeriapsisLaunch) {
                 // We want Pe -> Ap (Second Half)
                 this._bezierPoints = this._bezierPoints.slice(mid);
             } else {
                 // We want Ap -> Pe (First Half)
                 this._bezierPoints = this._bezierPoints.slice(0, mid + 1);
             }
             
             // Regenerate visual line
             const points = this._bezierPoints.map(p => p.position);
             this._renderer.updateBezierLine(points);
        }

        // Update markers to the actual analytical points if they exist
        if (this._analyticalPoints.length > 0) {
            const startPos = this._analyticalPoints[0];
            const endPos = this._analyticalPoints[this._analyticalPoints.length - 1];
            
            if (this._startMarker) this._startMarker.position.copy(startPos);
            if (this._endMarker) this._endMarker.position.copy(endPos);
            if (this._startLabel) this._startLabel.position.copy(startPos).add(new THREE.Vector3(0, 5, 0));
            if (this._endLabel) this._endLabel.position.copy(endPos).add(new THREE.Vector3(0, 5, 0));
            
            if (this._midLabel) {
                 const midIdx = Math.floor(this._analyticalPoints.length / 2);
                 this._midLabel.position.copy(this._analyticalPoints[midIdx]).add(new THREE.Vector3(0, 5, 0));
            }
        }
    }
}
