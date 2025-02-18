import * as THREE from 'three';
import { MoonState, PlanetState, OrbitGeometry } from './types';
import { G, generateEllipsePoints, generateBezierOrbitPoints, calculateEllipticalPosition } from './orbitUtils';

export class SimulationManager {
    private moonIterativeState: MoonState;
    private moonAnalyticalState: MoonState;
    private planetState: PlanetState;
    private iterativeOrbitPoints: THREE.Vector3[] = [];
    private analyticalOrbitPoints: THREE.Vector3[] = [];
    private bezierOrbitPoints: THREE.Vector3[] = [];
    private maxOrbitPoints: number = 500;
    private currentTime: number = 0;
    private timeScale: number = 1.0;
    private dt: number = 0.001;
    private cachedOrbitInfo: {
        type: string;
        parameters?: {
            a: number;
            e: number;
            periapsis: number;
            apoapsis: number;
        };
    } | null = null;

    constructor() {

        this.moonAnalyticalState = {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            mass: 1.0,
            initialPos: new THREE.Vector3(),
            initialVel: new THREE.Vector3(),
            orbitGeometry: {
                type: 'elliptical',
                analyticalPoints: [],
                bezierPoints: [],
                parameters: {
                    a: 0,
                    e: 0,
                    period: 0,
                    h: new THREE.Vector3(),
                    eVec: new THREE.Vector3()
                }
            }
        };

        // Initialize states
        this.moonIterativeState = {
            position: new THREE.Vector3(),
            velocity: new THREE.Vector3(),
            initialPos: new THREE.Vector3(),
            initialVel: new THREE.Vector3(),
            mass: 1.0
        };

        this.planetState = {
            position: new THREE.Vector3(0, 0, 0),
            mass: 1000
        };
    }

    setTimeScale(scale: number): void {
        this.timeScale = scale;
    }

    resetSimulation(
        position: THREE.Vector3,
        velocity: THREE.Vector3,
        mass: number
    ): void {
        // Reset moonInterative
        this.moonIterativeState.position.copy(position);
        this.moonIterativeState.velocity.copy(velocity);
        this.moonIterativeState.mass = mass;

        // Reset moonAnalytical
        this.moonAnalyticalState.position.copy(position);
        this.moonAnalyticalState.velocity.copy(velocity);
        this.moonAnalyticalState.mass = mass;
        this.moonAnalyticalState.initialPos = position.clone();
        this.moonAnalyticalState.initialVel = velocity.clone();

        // Calculate orbital parameters for moon2
        const mu = G * this.planetState.mass;
        const r = position.length();
        const v = velocity.length();
        // Clear moon1 orbit trail
        this.iterativeOrbitPoints = [position.clone()];
        
        // Calculate orbit geometry vectors
        const hVec = new THREE.Vector3().crossVectors(position, velocity);
        const vCrossH = new THREE.Vector3().crossVectors(velocity, hVec);
        const eVec = vCrossH.multiplyScalar(1/(G * this.planetState.mass)).sub(position.clone().normalize());
        
        // Calculate orbital elements
        const specificEnergy = (v * v / 2) - (mu / r);
        const a = -mu / (2 * specificEnergy);
        const e = Math.sqrt(1 + (2 * specificEnergy * hVec.lengthSq()) / (mu * mu));
        const period = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / mu);

        // For circular orbits (e ≈ 0), use position vector as reference direction
        const referenceVec = e < 1e-6 ? position.clone() : eVec;
        
        // Calculate orbit orientation vectors
        const hNorm = hVec.clone().normalize();
        const periapsisDir = referenceVec.clone().normalize();
        
        // Calculate center offset (same as in generateEllipsePoints)
        const c = a * e; // distance from center to focus
        const center = periapsisDir.clone().multiplyScalar(-c);
        
        // Generate ellipse points
        const ellipsePoints = generateEllipsePoints(a, e, hVec, referenceVec, 100);
        
        // Find periapsis and apoapsis points from the generated ellipse points
        let periapsisPoint = new THREE.Vector3();
        let apoapsisPoint = new THREE.Vector3();
        let minDist = Infinity;
        let maxDist = -Infinity;
        
        ellipsePoints.forEach(point => {
            const dist = point.length();
            if (dist < minDist) {
                minDist = dist;
                periapsisPoint.copy(point);
            }
            if (dist > maxDist) {
                maxDist = dist;
                apoapsisPoint.copy(point);
            }
        });
        
        // For circular orbits, use initial position as periapsis and opposite point as apoapsis
        if (e < 1e-6) {
            periapsisPoint.copy(position);
            apoapsisPoint.copy(position).multiplyScalar(-1);
        }

        // Update orbit geometry
        this.moonAnalyticalState.orbitGeometry = {
            type: 'elliptical',
            analyticalPoints: ellipsePoints,
            bezierPoints: generateBezierOrbitPoints(a, e, hVec, referenceVec),
            periapsisPoint: periapsisPoint,
            apoapsisPoint: apoapsisPoint,
            parameters: {
                a,
                e,
                period,
                h: hVec,
                eVec: referenceVec
            }
        };
        
        // Update the cached points for rendering
        this.analyticalOrbitPoints = this.moonAnalyticalState.orbitGeometry.analyticalPoints;
        this.bezierOrbitPoints = this.moonAnalyticalState.orbitGeometry.bezierPoints;

        // Cache orbit info
        this.cachedOrbitInfo = {
            type: 'elliptical',
            parameters: {
                a,
                e,
                periapsis: a * (1 - e),
                apoapsis: a * (1 + e)
            }
        };

        // Reset current time
        this.currentTime = 0;
    }

    update(): void {
        const scaledDt = this.dt * this.timeScale;
        this.currentTime += scaledDt;
        
        // Update moon1 using numerical integration
        const r = this.moonIterativeState.position.clone().sub(this.planetState.position);
        const distance = r.length();
        
        // Prevent division by zero and extreme forces at very small distances
        if (distance >= 2.5) {
            const force = r.normalize().multiplyScalar(
                -G * this.moonIterativeState.mass * this.planetState.mass / (distance * distance)
            );

            // Update velocity and position using Euler integration
            this.moonIterativeState.velocity.add(force.multiplyScalar(scaledDt / this.moonIterativeState.mass));
            this.moonIterativeState.position.add(this.moonIterativeState.velocity.clone().multiplyScalar(scaledDt));
        }

        // Update analytical moon using analytical solution
        if (this.moonAnalyticalState.orbitGeometry && this.moonAnalyticalState.initialPos && this.moonAnalyticalState.initialVel) {
            const newPosition = calculateEllipticalPosition(
                this.currentTime,
                this.moonAnalyticalState.orbitGeometry.parameters.a,
                this.moonAnalyticalState.orbitGeometry.parameters.e,
                this.moonAnalyticalState.orbitGeometry.parameters.period,
                0, // startTime is always 0 since we reset time on orbit changes
                this.moonAnalyticalState.initialPos,
                this.moonAnalyticalState.initialVel,
                this.planetState.mass
            );
            this.moonAnalyticalState.position.copy(newPosition);
        }

        // Update only moon1's orbit trail
        this.iterativeOrbitPoints.push(this.moonIterativeState.position.clone());
        if (this.iterativeOrbitPoints.length > this.maxOrbitPoints) this.iterativeOrbitPoints.shift();
    }

    calculateOrbitType(): OrbitGeometry {
        const v = this.moonAnalyticalState.initialVel.length();
        const r = this.moonAnalyticalState.initialPos.length();

        const mu = G * this.planetState.mass;
        const specificEnergy = (v * v / 2) - (mu / r);
        
        if (specificEnergy < 0) {
            const pos = this.moonAnalyticalState.initialPos.clone();
            const vel = this.moonAnalyticalState.initialVel.clone();

            // Calculate specific angular momentum
            const h = new THREE.Vector3().crossVectors(pos, vel);
            
            // Calculate eccentricity vector
            const vCrossH = new THREE.Vector3().crossVectors(vel, h);
            const eVec = vCrossH.multiplyScalar(1/mu).sub(pos.normalize());
            const e = eVec.length();
            
            // Calculate semi-major axis
            const a = -mu / (2 * specificEnergy);
            
            // Calculate periapsis and apoapsis distances
            const period = 2 * Math.PI * Math.sqrt(Math.pow(a, 3) / mu);
            
            // For circular orbits (e ≈ 0), use position vector as reference direction
            const referenceVec = e < 1e-6 ? pos.clone() : eVec;
            
            // Generate ellipse points
            const ellipsePoints = generateEllipsePoints(a, e, h, referenceVec, 100);
            
            // Find periapsis and apoapsis points from the generated ellipse points
            let periapsisPoint = new THREE.Vector3();
            let apoapsisPoint = new THREE.Vector3();
            let minDist = Infinity;
            let maxDist = -Infinity;
            
            ellipsePoints.forEach(point => {
                const dist = point.length();
                if (dist < minDist) {
                    minDist = dist;
                    periapsisPoint.copy(point);
                }
                if (dist > maxDist) {
                    maxDist = dist;
                    apoapsisPoint.copy(point);
                }
            });

            // Update cached orbit info for elliptical orbit
            this.cachedOrbitInfo = {
                type: 'elliptical',
                parameters: {
                    a,
                    e,
                    periapsis: a * (1 - e),
                    apoapsis: a * (1 + e)
                }
            };

            // For circular orbits, use initial position as periapsis and opposite point as apoapsis
            if (e < 1e-6) {
                periapsisPoint.copy(pos);
                apoapsisPoint.copy(pos).multiplyScalar(-1);
            }

            return {
                type: 'elliptical',
                analyticalPoints: ellipsePoints,
                bezierPoints: generateBezierOrbitPoints(a, e, h, referenceVec),
                periapsisPoint: periapsisPoint,
                apoapsisPoint: apoapsisPoint,
                parameters: {
                    a,
                    e,
                    period,
                    h,
                    eVec: referenceVec
                }
            };
        } else if (specificEnergy > 0) {
            // Update cached orbit info for hyperbolic orbit
            this.cachedOrbitInfo = {
                type: 'hyperbolic'
            };

            // Clear orbit points for hyperbolic orbit
            this.analyticalOrbitPoints = [];
            this.bezierOrbitPoints = [];

            return {
                type: 'hyperbolic',
                analyticalPoints: [],
                bezierPoints: [],
                parameters: {
                    a: 0,
                    e: 0,
                    period: 0,
                    h: new THREE.Vector3(),
                    eVec: new THREE.Vector3()
                }
            };
        } else {
            // Update cached orbit info for parabolic orbit
            this.cachedOrbitInfo = {
                type: 'parabolic'
            };

            // Clear orbit points for parabolic orbit
            this.analyticalOrbitPoints = [];
            this.bezierOrbitPoints = [];

            return {
                type: 'parabolic',
                analyticalPoints: [],
                bezierPoints: [],
                parameters: {
                    a: 0,
                    e: 0,
                    period: 0,
                    h: new THREE.Vector3(),
                    eVec: new THREE.Vector3()
                }
            };
        }
    }

    getMoonStates(): { moonIterative: MoonState; moonAnalytical: MoonState } {
        return {
            moonIterative: this.moonIterativeState,
            moonAnalytical: this.moonAnalyticalState
        };
    }


    getUIOrbitInfo(): {
        type: string;
        parameters?: {
            a: number;
            e: number;
            periapsis: number;
            apoapsis: number;
        };
    } {
        return this.cachedOrbitInfo || { type: 'unknown' };
    }

    getOrbitPoints(): { 
        orbitIterative: THREE.Vector3[]; 
        orbitAnalytical: THREE.Vector3[];
        orbitBezier: THREE.Vector3[]
    } {
        return {
            orbitIterative: this.iterativeOrbitPoints,
            orbitAnalytical: this.analyticalOrbitPoints,
            orbitBezier: this.bezierOrbitPoints
        };
    }
}
