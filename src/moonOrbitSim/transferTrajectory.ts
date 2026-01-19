import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime, formatDistanceWithAstronomicalUnits } from './units';
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
    private _targetTrajectory: Trajectory | null = null;

    // Public properties for Property Inspector
    public deltaV1: Velocity = Measure.of(0, kilometers.per(seconds));
    public deltaV2: Velocity = Measure.of(0, kilometers.per(seconds));
    public totalDeltaV: Velocity = Measure.of(0, kilometers.per(seconds));
    public timeOfFlight: Time = Measure.of(0, seconds);
    public startDelay: Time = Measure.of(0, seconds);

    // Associated optimization plot
    private _plot: any | null = null;
    private _plotStartTime: number = 0;

    constructor(scene: THREE.Scene, color: number = 0xffff00) {
        super(scene, color);
        this._debugMarkerEnabled = true; // Enable debug markers for transfers by default
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

    setTargetTrajectory(traj: Trajectory | null): void {
        this._targetTrajectory = traj;
    }

    /**
     * Get the associated optimization plot
     */
    public getOptimizationPlot(): any | null {
        return this._plot;
    }

    /**
     * Associate an optimization plot with this transfer
     */
    setOptimizationPlot(plot: any, startTime: number): void {
        this._plot = plot;
        this._plotStartTime = startTime;
    }
    
    createMarkers(startPos: THREE.Vector3, endPos: THREE.Vector3, radius: number): void {
        this.clearMarkers();
        
        // Create Mid Label Only (Start/End removed as per request)
        this._midLabel = this.createLabelSprite();
        const midPos = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        if (this._analyticalPoints.length > 0) {
            const midIdx = Math.floor(this._analyticalPoints.length / 2);
            midPos.copy(this._analyticalPoints[midIdx]);
        }
        this._midLabel.position.copy(midPos).add(new THREE.Vector3(0, radius * 3, 0));
        this._renderer.getContainer().add(this._midLabel);
    }
    
    /**
    * Update annotations based on current simulation time
    */
    update(currentTime: number): void {
        super.update(currentTime);
        
        // Update Mid Label (Static info mostly)
        const midText = [
            `TOF: ${formatTime(this.timeOfFlight, true)}`,
            `Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`
        ];
        
        if (this.startDelay.value > 0) {
            midText.push(`Start Delay: ${formatTime(this.startDelay, true)}`);
        }

        this.updateLabelTexture(this._midLabel, midText, 0xffff00);

        // Update plot animation if visible
        if (this._plot) {
             const isOpen = (typeof this._plot.isOpen === 'function') ? this._plot.isOpen() : true;
             
             if (isOpen) {
                 this._plot.setAnimationPosition(this.startDelay.value);
                 if (typeof this._plot.setAnimationYPosition === 'function') {
                     this._plot.setAnimationYPosition(this.timeOfFlight.value);
                 }
                 if (typeof this._plot.setTimelinePosition === 'function') {
                     this._plot.setTimelinePosition(currentTime - this._plotStartTime);
                 }
             }
        }
    }

    protected override getDebugLines(currentTime: number): string[] {
        const lines = super.getDebugLines(currentTime);

        lines.push(`Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`);

        if (this._targetTrajectory) {
            const myPos = this.getPosition(currentTime, 'bezier');
            const targetPos = this._targetTrajectory.getPosition(currentTime, 'bezier');

            if (myPos && targetPos) {
                const distKm = myPos.distanceTo(targetPos);
                const distMeasure = Measure.of(distKm, kilometers);
                const distStr = formatDistanceWithAstronomicalUnits(distMeasure, true);
                lines.push(`Dist: ${distStr}`);
            }
        }

        return lines;
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
            if (this._startMarker.parent) this._startMarker.parent.remove(this._startMarker);
            this._startMarker.geometry.dispose();
            if (this._startMarker.material instanceof THREE.Material) this._startMarker.material.dispose();
            this._startMarker = null;
        }
        
        if (this._endMarker) {
            if (this._endMarker.parent) this._endMarker.parent.remove(this._endMarker);
            this._endMarker.geometry.dispose();
            if (this._endMarker.material instanceof THREE.Material) this._endMarker.material.dispose();
            this._endMarker = null;
        }

        if (this._startLabel) {
            if (this._startLabel.parent) this._startLabel.parent.remove(this._startLabel);
            if (this._startLabel.material.map) this._startLabel.material.map.dispose();
            this._startLabel.material.dispose();
            this._startLabel = null;
        }

        if (this._midLabel) {
            if (this._midLabel.parent) this._midLabel.parent.remove(this._midLabel);
            if (this._midLabel.material.map) this._midLabel.material.map.dispose();
            this._midLabel.material.dispose();
            this._midLabel = null;
        }

        if (this._endLabel) {
            if (this._endLabel.parent) this._endLabel.parent.remove(this._endLabel);
            if (this._endLabel.material.map) this._endLabel.material.map.dispose();
            this._endLabel.material.dispose();
            this._endLabel = null;
        }
    }
    
    /**
     * Override setVisibility to also toggle associated plot visibility
     */
    public override setVisibility(visible: boolean): void {
        super.setVisibility(visible);
        if (this._plot) {
            if (visible) {
                /* 
                // Disabled as per request to not show plot entirely
                if (typeof this._plot.isOpen !== 'function' || this._plot.isOpen()) {
                    if (typeof this._plot.show === 'function') this._plot.show();
                }
                */
            } else {
                if (typeof this._plot.hide === 'function') this._plot.hide();
            }
        }
    }

    /**
     * Cleanup resources including markers
     */
    cleanup(): void {
        this.clearMarkers();
        if (this._plot && typeof this._plot.close === 'function') {
            this._plot.close();
            this._plot = null;
        }
        super.cleanup();
    }

    getStartTime(): number {
        return this._transferStartTime;
    }

    getEndTime(): number {
        return this._transferEndTime;
    }

    calculateFromState(position: LengthVector3, velocity: VelocityVector3, centralBodyMass: Mass, startTime: Time): void {
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // Ensure Bezier estimation is enabled for this trajectory
        this.useBezierEstimation = true;

        // Generate actual transfer arc points using Bezier approximation
        const tof = this.timeOfFlight.over(seconds).value;
        const startT = startTime.over(seconds).value;
        
        const numSamples = 100;
        const transferPoints: THREE.Vector3[] = [];
        const bezierPoints: { position: THREE.Vector3, t: number }[] = [];
        
        for (let i = 0; i <= numSamples; i++) {
            const u = i / numSamples;
            const t = startT + u * tof;
            
            // Primary path uses Bezier approximation for plotting
            const pos = this.getPosition(t, 'bezier');
            if (pos) {
                transferPoints.push(pos);
                bezierPoints.push({ position: pos.clone(), t: u });
            }
        }
        
        // Update both analytical (for baseline) and bezier visual paths
        // In the current renderer, bezierLine is the main visual.
        this._analyticalPoints = transferPoints;
        this._bezierPoints = bezierPoints;
        
        this._renderer.updateOrbitLine(this._analyticalPoints);
        this._renderer.updateBezierLine(this._bezierPoints.map(p => p.position));
        
        // Update label position
        if (this._midLabel && this._analyticalPoints.length > 0) {
            const midIdx = Math.floor(this._analyticalPoints.length / 2);
            this._midLabel.position.copy(this._analyticalPoints[midIdx]).add(new THREE.Vector3(0, 5, 0));
        }
    }
}
