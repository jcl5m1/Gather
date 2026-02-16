import * as THREE from 'three';
import { Trajectory, TrajectoryRender, TrajectoryRenderer } from './trajectory';
import { config } from './config';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime, formatDistanceWithAstronomicalUnits } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';
import { G, calculateInitialE, getAnalyticalState, calculateOrbitBasis, calculateEllipticalPositionFromBasis, BezierCurve, TransferResult } from './orbitUtils';
import { gravitationalConstantUnit } from './units';

export interface TransferTrajectoryRender extends TrajectoryRender {
    updateTransferMarkers(startPos: THREE.Vector3 | null, endPos: THREE.Vector3 | null, visible: boolean, startTextLines?: string[], endTextLines?: string[]): void;
}

export class TransferTrajectoryRenderer extends TrajectoryRenderer implements TransferTrajectoryRender {
    // Markers
    private departStartLoc: THREE.Sprite;
    private departStopLoc: THREE.Sprite;
    private departStartText: THREE.Sprite;
    private departStopText: THREE.Sprite;
    private burnMarkers: THREE.Sprite[] = [];
    private burnArcs: THREE.Line[] = [];
   
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

        // Text labels for start/end
        const textColor = 0xffffff;
        this.departStartText = this.createSprite(this.createTextTexture([''], textColor), 1.0);
        this.departStopText = this.createSprite(this.createTextTexture([''], textColor), 1.0);
        
        this.departStartText.visible = false;
        this.departStopText.visible = false;

        this.container.add(this.departStartText, this.departStopText);
    }

    updateTransferMarkers(startPos: THREE.Vector3 | null, endPos: THREE.Vector3 | null, visible: boolean, startTextLines: string[] = [], endTextLines: string[] = []): void {
        const scale = 0.05; // Base scale for sprites from base class (though we used 0.15 for dots here)

        if (visible && startPos) {
            this.departStartLoc.position.copy(startPos);
            this.departStartLoc.visible = true;

            // Update Start Text
            this.departStartText.position.copy(startPos);
            if (startTextLines.length > 0) {
                 const newTex = this.createTextTexture(startTextLines, 0x00ff00); // Greenish title context
                 if (this.departStartText.material.map) this.departStartText.material.map.dispose();
                 this.departStartText.material.map = newTex;
                 this.departStartText.center.set(0.5, 0.0); // Offset above/below
                 this.departStartText.scale.set(scale * 4.8, scale * 2.4, 1);
                 this.departStartText.visible = true;
            } else {
                this.departStartText.visible = false;
            }
        } else {
            this.departStartLoc.visible = false;
            this.departStartText.visible = false;
        }

        if (visible && endPos) {
            this.departStopLoc.position.copy(endPos);
            this.departStopLoc.visible = true;

             // Update End Text
            this.departStopText.position.copy(endPos);
            if (endTextLines.length > 0) {
                 const newTex = this.createTextTexture(endTextLines, 0xff0000); // Reddish title context
                 if (this.departStopText.material.map) this.departStopText.material.map.dispose();
                 this.departStopText.material.map = newTex;
                 this.departStopText.center.set(0.5, 0.0);
                 this.departStopText.scale.set(scale * 4.8, scale * 2.4, 1);
                 this.departStopText.visible = true;
            } else {
                this.departStopText.visible = false;
            }
        } else {
            this.departStopLoc.visible = false;
            this.departStopText.visible = false;
        }
        
        // Update burn markers visibility
        for (const marker of this.burnMarkers) {
            marker.visible = visible;
        }
        
        // Update burn arcs visibility
        for (const arc of this.burnArcs) {
            arc.visible = visible;
        }
    }
    
    /**
     * Add a burn marker at a specific position with a specific color
     */
    addMarker(position: THREE.Vector3, color: number): void {
        // Create dot texture for the marker
        const dotTexture = this.createDotTexture(color);
        
        // Create sprite with the dot texture
        const material = new THREE.SpriteMaterial({
            map: dotTexture,
            sizeAttenuation: false, // Screen space
            depthTest: false, // Always on top
            depthWrite: false // Don't write to depth buffer
        });
        const marker = new THREE.Sprite(material);
        marker.scale.set(0.02, 0.02, 1); // Scale for visibility
        marker.renderOrder = 999; // Ensure it renders on top
        marker.position.copy(position);
        marker.visible = false; // Will be controlled by updateTransferMarkers
        this.container.add(marker);
        this.burnMarkers.push(marker);
    }
    
    /**
     * Clear all burn markers
     */
    clearMarkers(): void {
        for (const marker of this.burnMarkers) {
            if (marker.parent === this.container) this.container.remove(marker);
            if (marker.material instanceof THREE.Material) {
                if (marker.material.map) marker.material.map.dispose();
                marker.material.dispose();
            }
        }
        this.burnMarkers = [];
    }

    /**
     * Add a burn arc (Bezier curve) between two positions with velocity-based control points
     */
    addArc(startPos: THREE.Vector3, endPos: THREE.Vector3, startVel: THREE.Vector3, endVel: THREE.Vector3, color: number, curvatureScale: number = 10): void {
        // Create control points based on velocities
        const controlPoint1 = startPos.clone().add(startVel.clone().multiplyScalar(curvatureScale));
        const controlPoint2 = endPos.clone().add(endVel.clone().multiplyScalar(-curvatureScale));
        
        // Create cubic Bezier curve
        const curve = new THREE.CubicBezierCurve3(
            startPos,
            controlPoint1,
            controlPoint2,
            endPos
        );
        
        // Generate points along the curve
        const points = curve.getPoints(50);
        
        // Create line geometry
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ 
            color: color,
            linewidth: 2,
            opacity: 0.8,
            transparent: true
        });
        
        const line = new THREE.Line(geometry, material);
        line.visible = false; // Will be controlled by updateTransferMarkers
        this.container.add(line);
        this.burnArcs.push(line);
    }

    /**
     * Clear all burn arcs
     */
    clearBurnArcs(): void {
        for (const arc of this.burnArcs) {
            if (arc.parent === this.container) this.container.remove(arc);
            if (arc.geometry) arc.geometry.dispose();
            if (arc.material instanceof THREE.Material) {
                arc.material.dispose();
            }
        }
        this.burnArcs = [];
    }

    override cleanup(): void {
        [
            this.departStartLoc,
            this.departStopLoc,
            this.departStartText,
            this.departStopText
        ].forEach(obj => {
            if (obj.parent === this.container) this.container.remove(obj);
            if (obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
            }
        });
        this.clearMarkers();
        this.clearBurnArcs();
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
    
    private _transferResult: TransferResult | null = null;
    
    // Herringbone target line
    private _herringboneLine: THREE.LineSegments;
    
    // Original Transfer Window
    private _transferStartTime: number = 0;
    private _transferEndTime: number = 0;
    
    // Exact Lambert Solver Positions (for accurate distance calculations)
    private _exactStartPosition: THREE.Vector3 | null = null;
    private _exactEndPosition: THREE.Vector3 | null = null;
    
    // Public properties for Property Inspector
    public deltaV1: Velocity = Measure.of(0, kilometers.per(seconds));
    public deltaV2: Velocity = Measure.of(0, kilometers.per(seconds));
    public totalDeltaV: Velocity = Measure.of(0, kilometers.per(seconds));
    public timeOfFlight: Time = Measure.of(0, seconds);
    public startDelay: Time = Measure.of(0, seconds);

    // Burn time properties (duration of burns based on fixed acceleration)
    private _departureBurnTime: number = 0; // seconds
    private _arrivalBurnTime: number = 0; // seconds

    // Associated optimization plot
    private _plot: any | null = null;
    private _plotStartTime: number = 0;

    constructor(scene: THREE.Scene, color: number = 0xffff00) {
        super(scene, color);
        // Debug markers enabled by default for transfers
        this._debugMarkerEnabled = true; 
        this._isClosedLoop = false;

        // Create herringbone line (visibility controlled by render() method)
        const lineGeometry = new THREE.BufferGeometry();
        const lineMaterial = new THREE.LineBasicMaterial({
            color: 0x808080,
            opacity: 1.0,
            transparent: false,
            depthWrite: true,
            depthTest: true,
            linewidth: 5
        });
        this._herringboneLine = new THREE.LineSegments(lineGeometry, lineMaterial);
        this._herringboneLine.frustumCulled = false;
        scene.add(this._herringboneLine);
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
     * Store exact Lambert solver positions for accurate distance calculations
     */
    setExactPositions(startPos: THREE.Vector3, endPos: THREE.Vector3): void {
        this._exactStartPosition = startPos.clone();
        this._exactEndPosition = endPos.clone();
    }

    /**
     * Store the complete transfer result from the Lambert solver
     */
    setTransferResult(result: TransferResult): void {
        this._transferResult = result;
        // Also set exact positions from the result
        this.setExactPositions(result.startPosition, result.endPosition);
    }

    /**
     * Store the burn times for departure and arrival maneuvers
     */
    setBurnTimes(departureBurnTime: number, arrivalBurnTime: number): void {
        this._departureBurnTime = departureBurnTime;
        this._arrivalBurnTime = arrivalBurnTime;
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
    
    
    /**
    * Update annotations and rendering based on current simulation time
    * All visibility control and rendering happens here
    * 
    * For TransferTrajectory, we override to handle visibility through a custom options parameter
    * while still supporting the base class signature
    */
    override update(currentTime: number, currentPos?: THREE.Vector3, isSelected: boolean = false, options?: { visible: boolean, camera?: THREE.Camera, targetPosition?: THREE.Vector3, startPosition?: THREE.Vector3 }): void {
        // Don't call super.update with currentPos since we handle rendering ourselves
        // Only call it for debug marker updates
        super.update(currentTime, currentPos, isSelected);
        
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

        // Master visibility control from parent
        const isVisible = true;
        
        // Set container visibility
        if (this._renderer) {
            this._renderer.getContainer().visible = isVisible;
        }

        // Early exit if not visible
        if (!isVisible) {
            return;
        }

        // Render points along the trajractory        
        // Create a new array of points for rendering
        const renderPoints: THREE.Vector3[] = [];

        //for 128 points from start to end in time, don't use bezierT conversion
        for (let i = 0; i < 128; i++) {
            const t = this._transferStartTime + (this._transferEndTime - this._transferStartTime) * i / 127;
            const point = this.getBezierPosition(t);
            if (point) {
                renderPoints.push(point);
            }
        } 

        // Render using bezier line (yellow)
        this._renderer.updateBezierLine(renderPoints);
        this._renderer.bezierLine.visible = true;
        
        // Render start/end markers at exact positions
        const startPos = this.getBezierPosition(this._transferStartTime);
        const endPos = this.getBezierPosition(this._transferEndTime);
        
        // Calculate time deltas for labels
        const startDelta = this._transferStartTime - currentTime;
        const endDelta = this._transferEndTime - currentTime;
        const startPrefix = startDelta >= 0 ? '+' : '-';
        const endPrefix = endDelta >= 0 ? '+' : '-';
        
        // Build label text
        const startTextLines: string[] = [];
        const endTextLines: string[] = [];
        
        if (startPos && this._startTrajectory) {
            // Use exact Lambert solver position if available, otherwise fall back to Bezier approximation
            let startDistKm: number;
            if (this._exactStartPosition) {
                // Calculate distance between exact Lambert position and source trajectory's exact analytical position
                const sourceAnalyticalState = this._startTrajectory.getBezierState(this._transferStartTime, { calcVelocity: false });
                if (sourceAnalyticalState.position) {
                    startDistKm = this._exactStartPosition.distanceTo(sourceAnalyticalState.position);
                } else {
                    // Fallback if analytical position is not available
                    startDistKm = startPos.distanceTo(this._startTrajectory.getBezierPosition(this._transferStartTime) || startPos);
                }
            } else {
                // Fallback to Bezier approximation (less accurate)
                startDistKm = startPos.distanceTo(this._startTrajectory.getBezierPosition(this._transferStartTime) || startPos);
            }
            startTextLines.push(`T${startPrefix}${formatTime(Measure.of(Math.abs(startDelta), seconds), true)}`);
            startTextLines.push(`Start: ${formatDistanceWithAstronomicalUnits(Measure.of(startDistKm, kilometers), true)}`);
            startTextLines.push(`Time: ${this._transferStartTime.toFixed(1)}s`);
            startTextLines.push(`Burn Time: ${formatTime(Measure.of(this._departureBurnTime, seconds), true)}`);
        }
        
        if (endPos && this._targetTrajectory) {
            // Use exact Lambert solver position if available, otherwise fall back to Bezier approximation
            let endDistKm: number;
            if (this._exactEndPosition) {
                // Calculate distance between exact Lambert position and target trajectory's exact analytical position
                const targetAnalyticalState = this._targetTrajectory.getBezierState(this._transferEndTime, { calcVelocity: false });
                if (targetAnalyticalState.position) {
                    endDistKm = this._exactEndPosition.distanceTo(targetAnalyticalState.position);
                } else {
                    // Fallback if analytical position is not available
                    endDistKm = endPos.distanceTo(this._targetTrajectory.getBezierPosition(this._transferEndTime) || endPos);
                }
            } else {
                // Fallback to Bezier approximation (less accurate)
                endDistKm = endPos.distanceTo(this._targetTrajectory.getBezierPosition(this._transferEndTime) || endPos);
            }
            endTextLines.push(`T${endPrefix}${formatTime(Measure.of(Math.abs(endDelta), seconds), true)}`);
            endTextLines.push(`End: ${formatDistanceWithAstronomicalUnits(Measure.of(endDistKm, kilometers), true)}`);
            endTextLines.push(`Time: ${this._transferEndTime.toFixed(1)}s`);
            endTextLines.push(`Burn Time: ${formatTime(Measure.of(this._arrivalBurnTime, seconds), true)}`);
        }
        
        // Update markers through renderer
        if (this._renderer instanceof TransferTrajectoryRenderer) {
            this._renderer.updateTransferMarkers(startPos, endPos, isVisible, startTextLines, endTextLines);
        }
    }

    /**
     * Generate analytical trajectory points for the FULL orbit
     */
    private generateAnalyticalPoints(): THREE.Vector3[] {
        const analyticalPoints: THREE.Vector3[] = [];
        const numSamples = 128;
        
        if (!this.parameters || this.parameters.period.value <= 0) {
            return analyticalPoints;
        }

        const a = this.parameters._a.value;
        const e = this.parameters.e;
        const period = this.parameters.period.value;
        const isHyperbolic = this.type === 'hyperbolic';
        
        if (isHyperbolic) {
            // For hyperbolic orbits, sample a reasonable time range
            const timeRange = (this._transferEndTime - this._transferStartTime) * 2;
            const startSampleTime = this._transferStartTime - timeRange / 4;
            const timeStep = timeRange / (numSamples - 1);
            
            for (let i = 0; i < numSamples; i++) {
                const time = startSampleTime + i * timeStep;
                const state = getAnalyticalState(
                    time, a, e, period,
                    this._startTime,
                    this._initialPosition,
                    this._initialVelocity,
                    this._centralBodyMass,
                    isHyperbolic
                );
                analyticalPoints.push(state.position);
            }
        } else {
            // For elliptical orbits, sample the FULL orbital period
            const timeStep = period / numSamples;
            
            for (let i = 0; i < numSamples; i++) {
                const time = this._startTime + i * timeStep;
                const state = getAnalyticalState(
                    time, a, e, period,
                    this._startTime,
                    this._initialPosition,
                    this._initialVelocity,
                    this._centralBodyMass,
                    isHyperbolic
                );
                analyticalPoints.push(state.position);
            }
            
            // Close the loop
            if (analyticalPoints.length > 0) {
                analyticalPoints.push(analyticalPoints[0].clone());
            }
        }
        
        return analyticalPoints;
    }

    /**
     * Render start/end markers with T+/T- labels
     */


    protected override getDebugLines(currentTime: number): string[] {
        const lines = super.getDebugLines(currentTime);

        lines.push(`Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`);

        if (this._targetTrajectory) {
            const myPos = this.getBezierPosition(currentTime);
            const targetPos = this._targetTrajectory.getBezierPosition(currentTime);

            if (myPos && targetPos) {
                const distKm = myPos.distanceTo(targetPos);
                const distMeasure = Measure.of(distKm, kilometers);
                const distStr = formatDistanceWithAstronomicalUnits(distMeasure, true);
                lines.push(`Dist: ${distStr}`);
            }
        }

        return lines;
    }



    /**
     * Add a burn marker at a specific position with a specific color
     */
    addMarker(position: THREE.Vector3, color: number): void {
        if (this._renderer instanceof TransferTrajectoryRenderer) {
            this._renderer.addMarker(position, color);
        }
    }

    /**
     * Add a burn arc (Bezier curve) between two positions with velocity-based control points
     */
    addArc(startPos: THREE.Vector3, endPos: THREE.Vector3, startVel: THREE.Vector3, endVel: THREE.Vector3, color: number, curvatureScale: number = 10): void {
        if (this._renderer instanceof TransferTrajectoryRenderer) {
            this._renderer.addArc(startPos, endPos, startVel, endVel, color, curvatureScale);
        }
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
        
        // Clear burn markers through renderer
        if (this._renderer instanceof TransferTrajectoryRenderer) {
            this._renderer.clearMarkers();
        }
    }
    


    /**
     * Cleanup resources including markers
     */
    cleanup(): void {
        this.clearMarkers();
        
        // Cleanup herringbone line
        if (this._herringboneLine) {
            if (this._herringboneLine.parent) {
                this._herringboneLine.parent.remove(this._herringboneLine);
            }
            this._herringboneLine.geometry.dispose();
            if (this._herringboneLine.material instanceof THREE.Material) {
                this._herringboneLine.material.dispose();
            }
        }
        
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
        // This generates the FULL orbit Bezier approximation with time warp LUT optimization
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // 2. Ensure Bezier estimation is enabled for smooth rendering of the full orbit
        this.useBezierEstimation = true;

        this._isClosedLoop = false;
        // Note: The parent class already builds the time warp LUT for elliptical orbits
        // when useBezierEstimation is true (see Trajectory.calculateFromState line 1002-1004)
        // This LUT optimizes the Bezier approximation for accurate time-based sampling
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
