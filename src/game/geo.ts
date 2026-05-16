import { Vector3 } from 'three';
import { R, SAME_NORMAL_DOT } from './constants';

// Clamp a dot product to the legal [−1, 1] domain of acos.
// Floating-point error can produce 1 + 1e-16; passing that to acos returns NaN.
export function clampDot(d: number): number {
    return Math.min(1, Math.max(-1, d));
}

// Arc length on the Earth sphere between two unit normals, in metres.
export function arcLengthM(a: Vector3, b: Vector3): number {
    return Math.acos(clampDot(a.dot(b))) * R;
}

// Arc length in kilometres.
export function arcLengthKm(a: Vector3, b: Vector3): number {
    return arcLengthM(a, b) / 1000;
}

// World-up convention from world.ts:
//   X = cos(lat)·cos(lon), Y = sin(lat), Z = −cos(lat)·sin(lon)
// Inverse:
//   lat = asin(Y),   lon = atan2(−Z, X)   (degrees)
export function normalToLatLon(n: Vector3): { lat: number; lon: number } {
    return {
        lat: Math.asin(clampDot(n.y))      * 180 / Math.PI,
        lon: Math.atan2(-n.z, n.x)         * 180 / Math.PI,
    };
}

// Compact "lat,lon" string for debug HUDs.
export function formatLatLon(n: Vector3): string {
    const { lat, lon } = normalToLatLon(n);
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// Two surface normals refer to the same structure (within float-rounding tolerance).
// Threshold from constants.ts is tight enough to distinguish 200 m-apart pads.
export function isSameStructureNormal(a: Vector3, b: Vector3): boolean {
    return a.dot(b) > SAME_NORMAL_DOT;
}
