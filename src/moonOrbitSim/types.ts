import * as THREE from 'three';

export interface OrbitGeometry {
    type: 'elliptical' | 'hyperbolic' | 'parabolic';
    analyticalPoints: THREE.Vector3[];
    bezierPoints: THREE.Vector3[];
    periapsisPoint?: THREE.Vector3;
    apoapsisPoint?: THREE.Vector3;
    parameters: {
        a: number;        // semi-major axis
        e: number;        // eccentricity
        period: number;   // orbital period
        h: THREE.Vector3; // angular momentum vector
        eVec: THREE.Vector3; // eccentricity vector
    };
}

export interface MoonState {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    mass: number;
    initialPos: THREE.Vector3;
    initialVel: THREE.Vector3;
    orbitGeometry?: OrbitGeometry;
}

export interface PlanetState {
    position: THREE.Vector3;
    mass: number;
}

export interface BezierCurvePoints {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    p3: THREE.Vector3;
}

export interface OrbitControls extends THREE.EventDispatcher {
    enabled: boolean;
    enableDamping: boolean;
    dampingFactor: number;
    update(): void;
}
