import * as THREE from 'three';
import { Trajectory } from './trajectory';
import { Length, Time, Mass, Velocity } from './units';
import { LengthVector3, VelocityVector3 } from './unitsVector3';

export class TransferTrajectory extends Trajectory {
    private _startMarker: THREE.Mesh | null = null;
    private _endMarker: THREE.Mesh | null = null;
    private _transferStartTime: number = 0;
    private _transferEndTime: number = 0;
    
    // Public properties for Property Inspector
    public deltaV: number = 0;
    public timeOfFlight: number = 0;

    constructor(scene: THREE.Scene, color: number = 0xffff00) {
        super(scene, color);
    }

    setTimes(startTime: number, endTime: number): void {
        this._transferStartTime = startTime;
        this._transferEndTime = endTime;
        this.timeOfFlight = endTime - startTime;
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
    }

    clearMarkers(): void {
        if (this._startMarker) {
            this._scene.remove(this._startMarker);
            this._startMarker.geometry.dispose();
            if (this._startMarker.material instanceof THREE.Material) {
                this._startMarker.material.dispose();
            }
            this._startMarker = null;
        }
        
        if (this._endMarker) {
            this._scene.remove(this._endMarker);
            this._endMarker.geometry.dispose();
            if (this._endMarker.material instanceof THREE.Material) {
                this._endMarker.material.dispose();
            }
            this._endMarker = null;
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
    }
}
