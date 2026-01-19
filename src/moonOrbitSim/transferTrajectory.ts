import * as THREE from 'three';
import { Trajectory, TrajectoryRender, TrajectoryRenderer } from './trajectory';
import { config } from './config';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime, formatDistanceWithAstronomicalUnits } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';
import { G, calculateInitialE, getAnalyticalState, calculateOrbitBasis, calculateEllipticalPositionFromBasis, BezierCurve } from './orbitUtils';
import { gravitationalConstantUnit } from './units';

export interface TransferTrajectoryRender extends TrajectoryRender {
    updateTransferMarkers(startPos: THREE.Vector3 | null, endPos: THREE.Vector3 | null, visible: boolean): void;
}

export class TransferTrajectoryRenderer extends TrajectoryRenderer implements TransferTrajectoryRender {
    // Markers
    private departStartLoc: THREE.Sprite;
    private departStopLoc: THREE.Sprite;
    
    constructor(scene: THREE.Scene, orbitColor: number = 0xffff00) {
        super(scene, orbitColor);

        // Simplified start/end markers
        const dotTexture = this.createDotTexture(orbitColor);
        // createSprite multiplies scale by 0.1. Passing 0.15 results in 0.015, which is visible (similar to OrbitalBody 0.01)
        const scale = 0.15; 
        this.departStartLoc = this.createSprite(dotTexture, scale);
        this.departStopLoc = this.createSprite(dotTexture, scale);
        
        this.departStartLoc.visible = false;
        this.departStopLoc.visible = false;
        
        this.container.add(this.departStartLoc, this.departStopLoc);
    }

    updateTransferMarkers(startPos: THREE.Vector3 | null, endPos: THREE.Vector3 | null, visible: boolean): void {
        if (visible && startPos) {
            this.departStartLoc.position.copy(startPos);
            this.departStartLoc.visible = true;
        } else {
            this.departStartLoc.visible = false;
        }

        if (visible && endPos) {
            this.departStopLoc.position.copy(endPos);
            this.departStopLoc.visible = true;
        } else {
            this.departStopLoc.visible = false;
        }
    }

    override cleanup(): void {
        [
            this.departStartLoc,
            this.departStopLoc
        ].forEach(obj => {
            if (obj.parent === this.container) this.container.remove(obj);
            if (obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
            }
        });
        super.cleanup();
    }
}

export class TransferTrajectory extends Trajectory {
    // Transfer Annotation Markers
    private _midLabel: THREE.Sprite | null = null;
    
    // Markers
    private _startMarker: THREE.Mesh | null = null;
    private _endMarker: THREE.Mesh | null = null;
    private _startTrajectory: Trajectory | null = null;
    private _targetTrajectory: Trajectory | null = null;
    
    // Original Transfer Window
    private _transferStartTime: number = 0;
    private _transferEndTime: number = 0;
    
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
        // Debug markers enabled by default for transfers, but standard Trajectory logic handles visibility
        this._debugMarkerEnabled = true; 

    }

    protected override createRenderer(): TrajectoryRender {
        return new TransferTrajectoryRenderer(this._scene, this._color);
    }

    setTimes(startTime: number, endTime: number, startDelay: number = 0): void {
        this._transferStartTime = startTime + startDelay;
        this._transferEndTime = endTime + startDelay;
        this.timeOfFlight = Measure.of(endTime - startTime, seconds);
        this.startDelay = Measure.of(startDelay, seconds);
        
        // Exact window
        this._startTime = this._transferStartTime;
        this._endTime = this._transferEndTime;
    }
    
    setDeltaVs(dv1: number, dv2: number): void {
        this.deltaV1 = Measure.of(dv1, kilometers.per(seconds));
        this.deltaV2 = Measure.of(dv2, kilometers.per(seconds));
        this.totalDeltaV = Measure.of(dv1 + dv2, kilometers.per(seconds));
    }

    setStartTrajectory(traj: Trajectory | null): void {
        this._startTrajectory = traj;
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
        
        // Create Mid Label Only
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
        
        // Dynamic Position Insertion
        // We manually trigger updateOrbitVisualization here because TransferTrajectory might not be owned by an OrbitalBody
        // that handles this automatically.
        // const currentT = this.getBezierT(currentTime);
        // const currentPos = this.getPosition(currentTime);
        // if (currentPos) {
        //   this.updateOrbitVisualization(currentT, currentPos);
        // }
        
        // Update the visual clipping based on current state
        this.updateTransferClip();



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

        // Update Start/Stop Markers
        const startPos = this.getPosition(this._transferStartTime);
        const endPos = this.getPosition(this._transferEndTime);
        (this._renderer as TransferTrajectoryRender).updateTransferMarkers(startPos, endPos, true);
    }

    protected override getDebugLines(currentTime: number): string[] {
        const lines = super.getDebugLines(currentTime);

        lines.push(`Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`);

        if (this._targetTrajectory) {
            const myPos = this.getPosition(currentTime);
            const targetPos = this._targetTrajectory.getPosition(currentTime);

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
        sprite.scale.set(0.24, 0.12, 1); 
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

        if (this._midLabel) {
            if (this._midLabel.parent) this._midLabel.parent.remove(this._midLabel);
            if (this._midLabel.material.map) this._midLabel.material.map.dispose();
            this._midLabel.material.dispose();
            this._midLabel = null;
        }
    }
    
    /**
     * Override setVisibility to also toggle associated plot visibility
     */
    public override setVisibility(visible: boolean): void {
        super.setVisibility(visible);
        if (this._plot) {
            if (!visible) {
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
        return this._startTime;
    }

    getEndTime(): number {
        return this._endTime!;
    }

    calculateFromState(position: LengthVector3, velocity: VelocityVector3, centralBodyMass: Mass, startTime: Time): void {
        // 1. Calculate Standard Orbit using superclass (Math-Free Architecture)
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // 2. Ensure Bezier estimation is enabled for smooth rendering
        this.useBezierEstimation = true;
        this._isClosedLoop = false; // Disable closed loop to prevent tails

        // 3. Update the visual clipping for the renderer
        // Moved to update() loop
        // this.updateTransferClip();
    }

    /**
     * Filter points for the renderer to only show the transfer segment
     * This does NOT modify the underlying geometry calculation, only the visual representation
     */
    private updateTransferClip(): void {
        if (!this._transferStartTime || !this._transferEndTime) return;

        // Get normalized T values
        const startNormalizedTime = this.getBezierT(this._transferStartTime);
        const endNormalizedTime = this.getBezierT(this._transferEndTime);

        // Filter points for visualization
        let segmentedPoints: { position: THREE.Vector3, t: number, simulationTime?: number }[] = [];

        if (startNormalizedTime <= endNormalizedTime) {
            // Standard case
            segmentedPoints = this._bezierPoints
                .filter(p => p.t >= startNormalizedTime && p.t <= endNormalizedTime)
                .sort((a, b) => a.t - b.t);
        } else {
            // Wrap-around case
            const segmentA = this._bezierPoints
                .filter(p => p.t >= startNormalizedTime)
                .sort((a, b) => a.t - b.t);
            
            const segmentB = this._bezierPoints
                .filter(p => p.t <= endNormalizedTime)
                .sort((a, b) => a.t - b.t);
            
            segmentedPoints = [...segmentA, ...segmentB];
        }

        // Add start connection
        const startPos = this.getPosition(this._transferStartTime);
        if (startPos) {
            segmentedPoints.unshift({
                position: startPos, 
                t: startNormalizedTime,
                simulationTime: this._transferStartTime
            });
        }

        // Add end connection
        const endPos = this.getPosition(this._transferEndTime);
        if (endPos) {
            segmentedPoints.push({
                position: endPos,
                t: endNormalizedTime, 
                simulationTime: this._transferEndTime
            });
        }

        // Update renderer with clipped points
        this._renderer.updateBezierLine(segmentedPoints.map(p => p.position));
        
        // Update LUT markers for raycasting
        if (this._renderer.updateLUTMarkers) {
            this._renderer.updateLUTMarkers(segmentedPoints.map(p => p.position));
        }
    }

    /**
     * Get the hit points for raycasting
     */
    getLUTPoints(): THREE.Points | null {
        if (this._renderer && this._renderer.lutPoints) {
            return this._renderer.lutPoints;
        }
        return null;
    }

    /**
     * Get data for a specific point index (from raycast intersection)
     */
    getPointData(index: number): string[] {
        if (index < 0 || index >= this._bezierPoints.length) return [];
        
        const point = this._bezierPoints[index];
        const pointTime = point.simulationTime !== undefined ? point.simulationTime : this.getTimeFromT(point.t);
        
        // Calculate velocity at this time
        const state = this.getBezierState(pointTime);
        const velocity = state.velocity ? new THREE.Vector3().copy(state.velocity).length() : 0;
        const altitude = state.position ? state.position.length() - config.bodies.earth.radius : 0; // Approx if Earth centered
        
        // Calculate delta T relative to start
        const dt = pointTime - this._transferStartTime;
        const prefix = dt >= 0 ? '+' : '-';
        
        return [
            `T${prefix}${formatTime(Measure.of(Math.abs(dt), seconds), true)}`,
            `Vel: ${velocity.toFixed(2)} km/s`,
            `Alt: ${altitude.toFixed(0)} km`
            // `Idx: ${index}`
        ];
    }
    
    /**
     * Helper to reverse t back to time
     * For elliptical, t is 0..1 mapping to 0..period
     */
    private getTimeFromT(t: number): number {
        // Simple linear approximation for now if strict inverse isn't available
        // But since we know the mapping is linear with Mean Anomaly usually, checks:
        // t = (time - T0) / Period (wrapped)
        // So time = t * Period + T0
        
        // However, t might be wrapped.
        // We know the transfer is between start and end.
        // Let's assume t maps linearly to the period roughly, and find the closest time within the transfer window.
        
        // Better: use the trajectory parameters (period, etc.)
        if (this.parameters && this.parameters.period.value > 0) {
            const period = this.parameters.period.value;
            // t is normalized 0..1
            
            // We need to match it to the transfer window
            // Start T
            const startT = this.getBezierT(this._transferStartTime);
            
            // Calculate time since periapsis (which is t=0 typically)
            // This is rough.
            // Let's rely on the property that for most of our linear sampling,
            // we probably want to just interpolate? No, exact physics is better.
            
            // Fallback: Just return rough estimate or use the exact start/end if close
            if (pointMatches(t, this.getBezierT(this._transferStartTime))) return this._transferStartTime;
            if (pointMatches(t, this.getBezierT(this._transferEndTime))) return this._transferEndTime;
            
            // Just return a rough timestamp based on period relative to start
            // This needs improvement but works for debug
             const timeSincePeriapsis = t * period;
             // Now find the periapsis time close to transfer start
             // T_sim = k*P + timeSincePeriapsis
             
             // Rough guess:
             return this._transferStartTime + (t - startT) * period; // Very rough if wrapping happens
        }
        
        return 0;
    }
}

function pointMatches(t1: number, t2: number): boolean {
    return Math.abs(t1 - t2) < 0.0001;
}
