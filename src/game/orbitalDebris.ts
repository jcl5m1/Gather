/**
 * OrbitalDebris — 10,000 GPU-simulated particles in random elliptical orbits.
 *
 * Full Keplerian two-body solution evaluated analytically per vertex:
 *   1. Mean anomaly  M = M0 + n·t           (linear in time)
 *   2. Eccentric anomaly E solved via 6-iteration Newton-Raphson on GPU
 *   3. True anomaly  ν from E and e
 *   4. Radius        r = a(1 − e·cos E)
 *   5. 3-D position via Rodrigues rotation into the tilted orbital plane
 *
 * Orbital elements per particle (packed into two attributes):
 *   aOrbit1 = (semi-major axis a, eccentricity e, inclination i, RAAN Ω)
 *   aOrbit2 = (arg-of-perigee ω, mean anomaly M0, _, _)   [zw unused]
 *
 * Eccentricity range: 0.7 – 0.99  (highly elliptical debris)
 * Semi-major axis chosen so perigee stays above ~200 km.
 *
 * No CPU work per frame beyond uploading uTime.
 */

import {
    BufferGeometry,
    BufferAttribute,
    ShaderMaterial,
    AdditiveBlending,
    LineSegments,
    Scene,
} from 'three';
import { R } from './constants';

// ── Physics ────────────────────────────────────────────────────────────────
const GM = 3.986004418e14;   // Earth gravitational parameter (m³/s²)

// ── Eccentricity range ─────────────────────────────────────────────────────
const ECC_MIN = 0.70;
const ECC_MAX = 0.99;

// ── Perigee altitude range (m) ─────────────────────────────────────────────
//   Perigee randomly placed between 200 km and 1000 km above surface.
//   Semi-major axis derived from: a = r_perigee / (1 - e)
const PERIGEE_MIN = R + 200_000;    // 200 km above surface
const PERIGEE_MAX = R + 1_000_000;  // 1 Mm above surface

// ── Streak ─────────────────────────────────────────────────────────────────
//   Streak is expressed as a fixed Δ in mean anomaly (radians).
//   At perigee the particle moves faster → streak appears longer there.
const STREAK_DM = 0.018;   // mean-anomaly offset for tail vertex

// ── Count ──────────────────────────────────────────────────────────────────
const COUNT = 10_000;

// ── Vertex shader ──────────────────────────────────────────────────────────
const DEBRIS_VERT = /* glsl */`
// Element set 1: (a, e, incl, raan)
attribute vec4 aOrbit1;
// Element set 2: (argPeri, M0, unused, unused)
attribute vec4 aOrbit2;
// 0 = head vertex, 1 = tail vertex
attribute float aVertRole;

uniform float uTime;       // simulation time (s)
uniform float uGM;         // gravitational parameter (m³/s²)
uniform float uStreakDM;   // mean-anomaly offset for tail (rad)

varying float vRole;

// ── Kepler solver (Newton-Raphson, 6 iterations) ──────────────────────────
float solveKepler(float M, float e) {
    // Reduce M to [0, 2π)
    M = mod(M, 6.28318530718);
    float E = M;    // initial guess
    for (int i = 0; i < 6; i++) {
        float dE = (E - e * sin(E) - M) / (1.0 - e * cos(E));
        E -= dE;
    }
    return E;
}

// ── Rodrigues rotation ────────────────────────────────────────────────────
vec3 rotateAxis(vec3 v, vec3 k, float theta) {
    float c = cos(theta), s = sin(theta);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
    float a        = aOrbit1.x;   // semi-major axis (m, scene units)
    float e        = aOrbit1.y;   // eccentricity
    float incl     = aOrbit1.z;   // inclination (rad)
    float raan     = aOrbit1.w;   // right ascension of ascending node (rad)
    float argPeri  = aOrbit2.x;   // argument of perigee (rad)
    float M0       = aOrbit2.y;   // initial mean anomaly (rad)

    // Mean motion n = sqrt(GM / a³)
    float n = sqrt(uGM / (a * a * a));

    // Mean anomaly at current time — offset tail by uStreakDM
    float M = M0 + n * uTime - aVertRole * uStreakDM;

    // Solve Kepler's equation for eccentric anomaly E
    float E = solveKepler(M, e);

    // True anomaly ν
    float sinHalf = sqrt((1.0 + e) / (1.0 - e)) * tan(E * 0.5);
    float nu      = 2.0 * atan(sinHalf);

    // Orbital radius at this true anomaly
    float r = a * (1.0 - e * cos(E));

    // Position in orbital plane (perifocal frame)
    float cosNu = cos(nu);
    float sinNu = sin(nu);

    // Build 3-D orbital frame via Rodrigues:
    //   nodeDir = ascending node direction
    //   orbitY  = normal direction tilted by inclination
    //   perigeeDir = rotated into orbital plane by argPeri
    vec3 north   = vec3(0.0, 1.0, 0.0);
    vec3 nodeDir = vec3(cos(raan), 0.0, sin(raan));
    vec3 orbitZ  = rotateAxis(north, nodeDir, incl);   // orbital plane normal
    vec3 perigeeDir = rotateAxis(nodeDir, orbitZ, argPeri);
    vec3 semilatDir = cross(orbitZ, perigeeDir);        // 90° from perigee in plane

    // Final world position
    vec3 pos = r * (perigeeDir * cosNu + semilatDir * sinNu);

    vRole       = aVertRole;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// ── Fragment shader ────────────────────────────────────────────────────────
const DEBRIS_FRAG = /* glsl */`
varying float vRole;   // 0 = head (bright), 1 = tail (transparent)

void main() {
    float alpha = 1.0 - vRole;
    alpha = alpha * alpha;                         // quadratic fade
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.85);
}`;

// ── Class ──────────────────────────────────────────────────────────────────
export class OrbitalDebris {
    private _mat:     ShaderMaterial;
    private _mesh:    LineSegments;
    private _simTime: number = 0.0;

    constructor(scene: Scene) {
        const VERTS = COUNT * 2;

        const orbit1  = new Float32Array(VERTS * 4);   // (a, e, incl, raan)
        const orbit2  = new Float32Array(VERTS * 4);   // (argPeri, M0, 0, 0)
        const role    = new Float32Array(VERTS);
        const indices = new Uint32Array(COUNT * 2);

        for (let i = 0; i < COUNT; i++) {
            // ── Randomise orbital elements ─────────────────────────────────
            const e        = ECC_MIN + Math.random() * (ECC_MAX - ECC_MIN);
            const rPeri    = PERIGEE_MIN + Math.random() * (PERIGEE_MAX - PERIGEE_MIN);
            const a        = rPeri / (1 - e);           // semi-major axis (m)
            const incl     = Math.acos(1 - 2 * Math.random());  // uniform sphere
            const raan     = Math.random() * Math.PI * 2;
            const argPeri  = Math.random() * Math.PI * 2;
            const M0       = Math.random() * Math.PI * 2;

            const vi = i * 2;   // head vertex index

            for (let v = 0; v < 2; v++) {
                const idx = (vi + v) * 4;
                orbit1[idx+0] = a;     orbit1[idx+1] = e;
                orbit1[idx+2] = incl;  orbit1[idx+3] = raan;
                orbit2[idx+0] = argPeri; orbit2[idx+1] = M0;
                orbit2[idx+2] = 0;     orbit2[idx+3] = 0;
                role[vi + v] = v === 0 ? 0.0 : 1.0;
            }

            indices[i*2+0] = vi;
            indices[i*2+1] = vi + 1;
        }

        const geo = new BufferGeometry();
        geo.setAttribute('aOrbit1',   new BufferAttribute(orbit1, 4));
        geo.setAttribute('aOrbit2',   new BufferAttribute(orbit2, 4));
        geo.setAttribute('aVertRole', new BufferAttribute(role,   1));
        geo.setIndex(new BufferAttribute(indices, 1));

        this._mat = new ShaderMaterial({
            vertexShader:   DEBRIS_VERT,
            fragmentShader: DEBRIS_FRAG,
            uniforms: {
                uTime:     { value: 0.0 },
                uGM:       { value: GM },
                uStreakDM: { value: STREAK_DM },
            },
            transparent: true,
            blending:    AdditiveBlending,
            depthWrite:  false,
            depthTest:   true,
        });

        this._mesh = new LineSegments(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder   = 12;

        scene.add(this._mesh);
    }

    /** Advance simulation by dt seconds (already scaled by timeScale). */
    update(dt: number): void {
        this._simTime += dt;
        this._mat.uniforms.uTime.value = this._simTime;
    }

    dispose(): void {
        this._mesh.geometry.dispose();
        this._mat.dispose();
    }
}
