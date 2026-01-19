import * as THREE from 'three';
import { Trajectory, TrajectoryRender, TrajectoryRenderer } from './trajectory';
import { config } from './config';
import { Length, Time, Mass, Velocity, Measure, kilometers, seconds, formatVelocity, formatTime, formatDistanceWithAstronomicalUnits } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';
import { G, calculateInitialE, getAnalyticalState, calculateOrbitBasis, calculateEllipticalPositionFromBasis, BezierCurve } from './orbitUtils';
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

    // Associated optimization plot
    private _plot: any | null = null;
    private _plotStartTime: number = 0;

    constructor(scene: THREE.Scene, color: number = 0xffff00) {
        super(scene, color);
        // Debug markers enabled by default for transfers
        this._debugMarkerEnabled = true; 

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
    * Update annotations and rendering based on current simulation time
    * All visibility control and rendering happens here
    */
    update(currentTime: number, options?: { visible: boolean, camera?: THREE.Camera, targetPosition?: THREE.Vector3, startPosition?: THREE.Vector3 }): void {
        super.update(currentTime);
        
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

        // === RENDERING CONTROL FLAGS ===
        const ENABLE_TRAJECTORY_LINE = false;      // Yellow Bezier path
        const ENABLE_ANALYTICAL_LINE = true;       // Cyan analytical orbit  
        const ENABLE_LUT_MARKERS = false;          // Raycasting points
        const ENABLE_START_END_MARKERS = false;    // T+/T- markers at start/end
        const ENABLE_MID_LABEL = false;            // TOF/ΔV label
        const ENABLE_HERRINGBONE_LINE = false;     // Chevron pattern line to target
        
        // Master visibility control from parent
        const isVisible = options?.visible ?? false;
        
        console.log('[TransferTrajectory.update]', {
            isVisible,
            ENABLE_ANALYTICAL_LINE,
            hasRenderer: !!this._renderer,
            hasOptions: !!options
        });
        
        // Force container invisible (master switch)
        if (this._renderer) {
            const containerVisible = isVisible && (
                ENABLE_TRAJECTORY_LINE || 
                ENABLE_ANALYTICAL_LINE || 
                ENABLE_LUT_MARKERS || 
                ENABLE_START_END_MARKERS || 
                ENABLE_MID_LABEL
            );
            this._renderer.getContainer().visible = containerVisible;
            console.log('[TransferTrajectory.update] Container visible:', containerVisible);
        }

        // Early exit if not visible or all rendering disabled
        if (!isVisible || (!ENABLE_TRAJECTORY_LINE && !ENABLE_ANALYTICAL_LINE && 
            !ENABLE_LUT_MARKERS && !ENABLE_START_END_MARKERS && !ENABLE_MID_LABEL && !ENABLE_HERRINGBONE_LINE)) {
            // Hide herringbone if not enabled
            if (!ENABLE_HERRINGBONE_LINE) {
                this._herringboneLine.visible = false;
            }
            console.log('[TransferTrajectory.update] Early exit');
            return;
        }

        // === 1. TRAJECTORY LINES ===
        if (ENABLE_TRAJECTORY_LINE || ENABLE_ANALYTICAL_LINE || ENABLE_LUT_MARKERS) {
            console.log('[TransferTrajectory.update] Calling renderTrajectoryLines');
            this.renderTrajectoryLines(currentTime, {
                bezier: ENABLE_TRAJECTORY_LINE,
                analytical: ENABLE_ANALYTICAL_LINE,
                lut: ENABLE_LUT_MARKERS
            });
        }

        // === 2. START/END MARKERS ===
        if (ENABLE_START_END_MARKERS) {
            this.renderStartEndMarkers(currentTime);
        }

        // === 3. MID LABEL ===
        if (ENABLE_MID_LABEL) {
            this.renderMidLabel();
        }

        // === 4. HERRINGBONE LINE ===
        // if (ENABLE_HERRINGBONE_LINE && options?.camera && options?.targetPosition && options?.startPosition) {
        //     this.updateHerringboneLine(options.startPosition, options.targetPosition, options.camera);
        // } else if (!ENABLE_HERRINGBONE_LINE) {
        //     this._herringboneLine.visible = false;
        // }
    }

    /**
     * Render trajectory lines (Bezier, Analytical, LUT)
     */
    private renderTrajectoryLines(currentTime: number, options: { bezier: boolean, analytical: boolean, lut: boolean }): void {
        if (!this._transferStartTime || !this._transferEndTime) {
            console.log('[renderTrajectoryLines] Missing transfer times');
            return;
        }

        // Get normalized T values
        const startNormalizedTime = this.getBezierT(this._transferStartTime);
        const endNormalizedTime = this.getBezierT(this._transferEndTime);

        // Filter points for visualization
        let segmentedPoints: { position: THREE.Vector3, t: number, simulationTime?: number }[] = [];

        if (startNormalizedTime <= endNormalizedTime) {
            segmentedPoints = this._bezierPoints
                .filter(p => p.t >= startNormalizedTime && p.t <= endNormalizedTime)
                .sort((a, b) => a.t - b.t);
        } else {
            const segmentA = this._bezierPoints
                .filter(p => p.t >= startNormalizedTime)
                .sort((a, b) => a.t - b.t);
            const segmentB = this._bezierPoints
                .filter(p => p.t <= endNormalizedTime)
                .sort((a, b) => a.t - b.t);
            segmentedPoints = [...segmentA, ...segmentB];
        }

        // Add exact start/end positions
        const startPos = this.getPosition(this._transferStartTime);
        if (startPos) {
            segmentedPoints.unshift({
                position: startPos, 
                t: startNormalizedTime,
                simulationTime: this._transferStartTime
            });
        }

        const endPos = this.getPosition(this._transferEndTime);
        if (endPos) {
            segmentedPoints.push({
                position: endPos,
                t: endNormalizedTime, 
                simulationTime: this._transferEndTime
            });
        }

        // Render Bezier line
        if (options.bezier) {
            this._renderer.updateBezierLine(segmentedPoints.map(p => p.position));
            this._renderer.bezierLine.visible = true;
        } else {
            this._renderer.bezierLine.visible = false;
        }

        // Render Analytical line (full orbit)
        if (options.analytical) {
            console.log('[renderTrajectoryLines] Generating analytical points');
            const analyticalPoints = this.generateAnalyticalPoints();
            console.log('[renderTrajectoryLines] Generated', analyticalPoints.length, 'analytical points');
            this._renderer.updateAnalyticalLine(analyticalPoints);
        }

        // Render LUT markers
        if (options.lut && this._renderer.updateLUTMarkers) {
            this._renderer.updateLUTMarkers(segmentedPoints.map(p => p.position));
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
    private renderStartEndMarkers(currentTime: number): void {
        const startPos = this.getPosition(this._transferStartTime);
        const endPos = this.getPosition(this._transferEndTime);

        const startTextLines: string[] = [];
        const endTextLines: string[] = [];

        // Time to Start
        const timeToStart = currentTime - this._transferStartTime;
        const startPrefix = timeToStart < 0 ? 'T-' : 'T+';
        const startDuration = Measure.of(Math.abs(timeToStart), seconds);
        startTextLines.push(`${startPrefix}${formatTime(startDuration, true)}`);
        startTextLines.push(`Start: ${this._transferStartTime.toFixed(2)} s`);

        // Distance at Start
        if (this._startTrajectory) {
            const startBodyPos = this._startTrajectory.getPosition(this._transferStartTime);
            if (startBodyPos) {
                const exactPos = this._exactStartPosition || startPos;
                if (exactPos) {
                    const dist = exactPos.distanceTo(startBodyPos);
                    startTextLines.push(`Dist: ${formatDistanceWithAstronomicalUnits(Measure.of(dist, kilometers), true)}`);
                    
                    if (this._exactStartPosition && startPos) {
                        const bezierError = this._exactStartPosition.distanceTo(startPos);
                        startTextLines.push(`Bezier Err: ${bezierError.toFixed(2)} km`);
                    }
                }
            }
        }

        // Time to End
        const timeToEnd = currentTime - this._transferEndTime;
        const endPrefix = timeToEnd < 0 ? 'T-' : 'T+';
        const endDuration = Measure.of(Math.abs(timeToEnd), seconds);
        endTextLines.push(`${endPrefix}${formatTime(endDuration, true)}`);
        endTextLines.push(`End: ${this._transferEndTime.toFixed(2)} s`);

        // Distance at End
        if (this._targetTrajectory) {
            const targetBodyPos = this._targetTrajectory.getPosition(this._transferEndTime);
            if (targetBodyPos) {
                const exactPos = this._exactEndPosition || endPos;
                if (exactPos) {
                    const dist = exactPos.distanceTo(targetBodyPos);
                    endTextLines.push(`Dist: ${formatDistanceWithAstronomicalUnits(Measure.of(dist, kilometers), true)}`);
                    
                    if (this._exactEndPosition && endPos) {
                        const bezierError = this._exactEndPosition.distanceTo(endPos);
                        endTextLines.push(`Bezier Err: ${bezierError.toFixed(2)} km`);
                    }
                }
            }
        }

        (this._renderer as TransferTrajectoryRender).updateTransferMarkers(startPos, endPos, true, startTextLines, endTextLines);
    }

    /**
     * Render mid label with TOF and ΔV
     */
    private renderMidLabel(): void {
        const midText = [
            `TOF: ${formatTime(this.timeOfFlight, true)}`,
            `Total ΔV: ${formatVelocity(this.totalDeltaV, true)}`
        ];
        
        if (this.startDelay.value > 0) {
            midText.push(`Start Delay: ${formatTime(this.startDelay, true)}`);
        }

        this.updateLabelTexture(this._midLabel, midText, 0xffff00);
    }

    /**
     * Update herringbone line to point from start to target
     * Generates a billboarded herringbone/chevron pattern
     */
    updateHerringboneLine(
        start: THREE.Vector3,
        end: THREE.Vector3 | null,
        camera?: THREE.Camera
    ): void {
        if (!end || !camera) {
            this._herringboneLine.visible = false;
            return;
        }

        // Constants
        const CHEVRON_PIXEL_SIZE = 10.0; // Size of chevron wings in pixels

        // 1. Transform World Points to Camera Space for Clipping
        const startView = start.clone().applyMatrix4(camera.matrixWorldInverse);
        const endView = end.clone().applyMatrix4(camera.matrixWorldInverse);

        // Near plane clip distance
        const near = (camera as any).near || 0.1;
        const CLIP_Z = -near;

        if (startView.z > CLIP_Z && endView.z > CLIP_Z) {
            this._herringboneLine.visible = false;
            return;
        }

        let sClipped = start.clone();
        let eClipped = end.clone();
        let wStart = -startView.z;
        let wEnd = -endView.z;

        const clipLine = (
            p1: THREE.Vector3,
            p2: THREE.Vector3,
            w1: number,
            w2: number
        ) => {
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

        // 2. Calculate chevron sizing and spacing
        const height = window.innerHeight;
        const distToFirstChevron = sClipped.distanceTo(camera.position);
        const fov = (camera instanceof THREE.PerspectiveCamera) ? camera.fov : 50;
        const tan = Math.tan((fov * Math.PI / 180) / 2);
        const worldSizeAtFirstChevron = (CHEVRON_PIXEL_SIZE / height) * 2 * distToFirstChevron * tan;
        
        const CHEVRON_WING_LENGTH = worldSizeAtFirstChevron;
        const CHEVRON_WIDTH_OFFSET = worldSizeAtFirstChevron * 0.6;
        const CHEVRON_3D_SPACING = worldSizeAtFirstChevron * 3.0;

        // 3. Generate chevrons at equidistant 3D positions
        const points: THREE.Vector3[] = [];
        
        const lineDir = new THREE.Vector3().subVectors(eClipped, sClipped);
        const totalDistance = lineDir.length();
        lineDir.normalize();
        
        const numChevrons = Math.floor(totalDistance / CHEVRON_3D_SPACING);
        
        // Safety cap
        if (numChevrons > 2000) {
            this._herringboneLine.visible = false;
            return;
        }

        for (let i = 0; i <= numChevrons; i++) {
            const distance3D = i * CHEVRON_3D_SPACING;
            const centerPos = sClipped.clone().add(lineDir.clone().multiplyScalar(distance3D));

            // Billboarding
            const viewVec = new THREE.Vector3()
                .subVectors(centerPos, camera.position)
                .normalize();
            const right = new THREE.Vector3()
                .crossVectors(lineDir, viewVec)
                .normalize();
            if (right.lengthSq() < 0.001) {
                right.crossVectors(lineDir, new THREE.Vector3(0, 1, 0)).normalize();
            }

            const tip = centerPos
                .clone()
                .add(lineDir.clone().multiplyScalar(CHEVRON_WING_LENGTH * 0.5));
            const base = centerPos
                .clone()
                .sub(lineDir.clone().multiplyScalar(CHEVRON_WING_LENGTH * 0.5));

            const left = base
                .clone()
                .add(right.clone().multiplyScalar(CHEVRON_WIDTH_OFFSET));
            const rightPos = base
                .clone()
                .sub(right.clone().multiplyScalar(CHEVRON_WIDTH_OFFSET));

            points.push(left, tip);
            points.push(rightPos, tip);
        }

        this._herringboneLine.geometry.setFromPoints(points);
        if (this._herringboneLine.geometry.attributes.position) {
            this._herringboneLine.geometry.attributes.position.needsUpdate = true;
        }
        this._herringboneLine.geometry.computeBoundingSphere();
        this._herringboneLine.visible = true;
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
        super.calculateFromState(position, velocity, centralBodyMass, startTime);
        
        // 2. Ensure Bezier estimation is enabled for smooth rendering
        this.useBezierEstimation = true;
        this._isClosedLoop = false; // Disable closed loop to prevent tails

        // 3. Update the visual clipping for the renderer
        // Moved to update() loop
        // this.updateTransferClip();
    }

    /**
     * Override base class updateOrbitVisualization to disable automatic rendering
     * All rendering is disabled for debugging - will be re-enabled piece by piece
     */
    override updateOrbitVisualization(currentTime: number, currentPos: THREE.Vector3): void {
        // DISABLED: Base class rendering
        // This was causing the yellow ellipse to appear
        // super.updateOrbitVisualization(currentTime, currentPos);
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
