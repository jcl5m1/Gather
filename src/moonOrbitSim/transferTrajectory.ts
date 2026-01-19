import * as THREE from 'three';
import { Trajectory, TrajectoryRender, TransferTrajectoryRender, TransferTrajectoryRenderer } from './trajectory';
import { config } from './config';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime, formatDistanceWithAstronomicalUnits } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';
import { G, calculateInitialE, getAnalyticalState, calculateOrbitBasis, calculateEllipticalPositionFromBasis, BezierCurve } from './orbitUtils';
import { gravitationalConstantUnit } from './units';

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
        this._isClosedLoop = false;
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
        const currentT = this.getBezierT(currentTime);
        const currentPos = this.getPosition(currentTime);
        if (currentPos) {
            this.updateOrbitVisualization(currentT, currentPos);
        }



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
        // 1. Calculate Standard Orbit
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // 2. Ensure Bezier estimation is enabled
        this.useBezierEstimation = true;

        // 3. Trim Points to Transfer Window
        // Use high-precision checking against start/end times
        if (this._bezierPoints.length > 0) {
            const startT = this.getBezierT(this._startTime);
            const endT = this.getBezierT(this._endTime!);
            
            // Handle wrap-around case depending on orbit direction and window
            // Since this is a transfer, it should be a contiguous segment.
            // However, getBezierT wraps to [0,1].
            
            // Simple approach: Filter points whose time falls within [startTime, endTime]
            // We can reconstruct time from T, or just use getPosition(t_sec) for each point to check?
            // Expensive.
            // Better: We know the points are sorted by T.
            
            // Let's rely on the fact that for a transfer, we likely want the segment that corresponds to the duration
            // But super.calculateFromState gives 0..1 (full orbit).
            
            // Filter logic:
            let newPoints: { position: THREE.Vector3, t: number }[] = [];
            
            // Case 1: startT <= endT (Normal segment)
            if (startT <= endT) {
                 newPoints = this._bezierPoints.filter(p => p.t >= startT && p.t <= endT);
                 
                 // Add exact start/end
                 const pStart = this.getPosition(this._startTime);
                 const pEnd = this.getPosition(this._endTime!);
                 
                 if (pStart) newPoints.push({ position: pStart, t: startT });
                 if (pEnd) newPoints.push({ position: pEnd, t: endT });
                 
                 // Sort strictly by T for normal segment
                 newPoints.sort((a, b) => a.t - b.t);
            } 
            // Case 2: startT > endT (Wraps around apoapsis/0.0)
            else {
                 // We need two segments: [startT, 1.0] AND [0.0, endT]
                 // And we want to render them in that order: start->1->0->end
                 
                 const latePoints = this._bezierPoints.filter(p => p.t >= startT);
                 const earlyPoints = this._bezierPoints.filter(p => p.t <= endT);
                 
                 // Sort internal segments
                 latePoints.sort((a, b) => a.t - b.t);
                 earlyPoints.sort((a, b) => a.t - b.t);
                 
                 // Add exact points to respective segments
                 const pStart = this.getPosition(this._startTime);
                 const pEnd = this.getPosition(this._endTime!);

                 if (pStart) latePoints.unshift({ position: pStart, t: startT }); // Add to start of late sequence (or end, but it's start of Transfer)
                 // Actually pStart has t=startT. latePoints are t >= startT. So pStart is the first point.
                 // Ensure we don't duplicate if filter caught it? Filter is inclusive.
                 // Let's rely on sort + unique filter later? Or just insert and sort.
                 
                 // Push to arrays then sort again to be safe
                 if (pStart) latePoints.push({ position: pStart, t: startT });
                 if (pEnd) earlyPoints.push({ position: pEnd, t: endT });
                 
                 latePoints.sort((a, b) => a.t - b.t);
                 earlyPoints.sort((a, b) => a.t - b.t);

                 // Concatenate: Late (Start->1) then Early (0->End)
                 newPoints = [...latePoints, ...earlyPoints];
            }
            
            // Deduplicate points (simple distance check or T check)
            // T check might be tricky with wrap around if we just concat.
            // But we know late points are t>0.5 and early are t<0.5 typically.
            // Just return the newPoints array, do NOT sort it globally by T.
            
            this._bezierPoints = newPoints;

            // Also update analytical points for consistency (approximation)
            // Just clear them or filter? Super uses them for "orbitLine" which we hide.
            // Let's just keep them as is or clear them to save memory.
            this._analyticalPoints = []; 
            
            // Update renderer
            this._renderer.updateBezierLine(this._bezierPoints.map(p => p.position));
        }
    }
}
