/**
 * OrbitalDebris — 10,000 GPU-simulated particles in random low-Earth orbits.
 *
 * Each particle is rendered as a short streak: a line segment with two vertices
 * — the head (current position) and the tail (a fixed arc behind it).  The
 * fragment shader fades alpha from 1.0 at the head to 0.0 at the tail.
 *
 * All orbital mechanics run entirely on the GPU:
 *   • aOrbit.xyz = (inclination, RAAN, M0)
 *   • aOrbit.w   = altFrac ∈ [-1, +1]  → radius = R + BASE_ALT + altFrac * ALT_SPREAD
 *   • Per-particle omega is derived from vis-viva in the vertex shader so
 *     every particle orbits at the correct speed for its altitude.
 *   • No CPU work per-frame beyond uploading uTime.
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

// ── Altitude range ─────────────────────────────────────────────────────────
//   Bottom : R + BASE_ALT - ALT_SPREAD  ≈  R + 100 km
//   Top    : R + BASE_ALT + ALT_SPREAD  ≈  R + 4100 km
const BASE_ALT   = 2_100_000;   // centre of range (m)
const ALT_SPREAD = 2_000_000;   // ± spread (m)  → total band = 4 Mm

// ── Physics ────────────────────────────────────────────────────────────────
const GM         = 3.986004418e14;  // Earth gravitational parameter (m³/s²)

// Streak arc length (radians) — same for all particles
const STREAK_ARC = 0.012;   // ~0.69°

// ── Particle count ─────────────────────────────────────────────────────────
const COUNT = 10_000;

// ── Vertex shader ──────────────────────────────────────────────────────────
const DEBRIS_VERT = /* glsl */`
attribute vec4  aOrbit;      // (inclination, RAAN, M0, altFrac)
attribute float aVertRole;   // 0 = head, 1 = tail

uniform float uTime;         // elapsed seconds (float)
uniform float uEarthR;       // Earth radius (m) in scene units
uniform float uBaseAlt;      // centre altitude above surface (m)
uniform float uAltSpread;    // ± altitude spread (m)
uniform float uGM;           // gravitational parameter (m³/s²)
uniform float uStreakArc;    // tail angular offset (rad)

varying float vRole;

// Rodrigues rotation
vec3 rotateAxis(vec3 v, vec3 k, float theta) {
    float c = cos(theta), s = sin(theta);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
    float incl    = aOrbit.x;
    float raan    = aOrbit.y;
    float M0      = aOrbit.z;
    float altFrac = aOrbit.w;   // ∈ [-1, +1]

    // Per-particle orbital radius and angular velocity
    float r     = uEarthR + uBaseAlt + altFrac * uAltSpread;
    float omega = sqrt(uGM / (r * r * r));   // rad/s  (vis-viva: v=sqrt(GM/r), ω=v/r)

    // Current angle (head) and tail angle
    float theta = M0 + omega * uTime;
    float angle = theta - aVertRole * uStreakArc;

    // Build tilted orbital frame via Rodrigues
    vec3 nodeDir = vec3(cos(raan), 0.0, sin(raan));   // ascending node
    vec3 north   = vec3(0.0, 1.0, 0.0);
    vec3 orbitY  = rotateAxis(north, nodeDir, incl);   // tilted polar axis
    vec3 orbitX  = nodeDir;

    // Position on the orbital circle at radius r
    vec3 pos = r * (orbitX * cos(angle) + orbitY * sin(angle));

    vRole       = aVertRole;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// ── Fragment shader ────────────────────────────────────────────────────────
const DEBRIS_FRAG = /* glsl */`
varying float vRole;    // 0 = head (bright), 1 = tail (transparent)

void main() {
    float alpha = 1.0 - vRole;
    alpha = alpha * alpha;              // quadratic fade toward tail
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.85);
}`;

// ── Class ──────────────────────────────────────────────────────────────────
export class OrbitalDebris {
    private _mat:  ShaderMaterial;
    private _mesh: LineSegments;
    private _t0:   number;

    constructor(scene: Scene) {
        const VERTS = COUNT * 2;

        // 4 floats per vertex: (incl, raan, M0, altFrac)
        const orbit   = new Float32Array(VERTS * 4);
        const role    = new Float32Array(VERTS);
        const indices = new Uint32Array(COUNT * 2);

        for (let i = 0; i < COUNT; i++) {
            // Uniform spherical distribution for inclination
            const incl    = Math.acos(1 - 2 * Math.random());
            const raan    = Math.random() * Math.PI * 2;
            const M0      = Math.random() * Math.PI * 2;
            const altFrac = Math.random() * 2 - 1;   // ∈ [-1, +1]

            const vi = i * 2;   // head vertex index

            // Head
            orbit[vi*4+0] = incl;  orbit[vi*4+1] = raan;
            orbit[vi*4+2] = M0;    orbit[vi*4+3] = altFrac;
            role[vi]      = 0.0;

            // Tail — same orbital parameters, role = 1 offsets angle in shader
            orbit[(vi+1)*4+0] = incl;  orbit[(vi+1)*4+1] = raan;
            orbit[(vi+1)*4+2] = M0;    orbit[(vi+1)*4+3] = altFrac;
            role[vi+1]         = 1.0;

            indices[i*2+0] = vi;
            indices[i*2+1] = vi + 1;
        }

        const geo = new BufferGeometry();
        geo.setAttribute('aOrbit',    new BufferAttribute(orbit, 4));  // itemSize=4
        geo.setAttribute('aVertRole', new BufferAttribute(role,  1));
        geo.setIndex(new BufferAttribute(indices, 1));

        this._mat = new ShaderMaterial({
            vertexShader:   DEBRIS_VERT,
            fragmentShader: DEBRIS_FRAG,
            uniforms: {
                uTime:      { value: 0.0 },
                uEarthR:    { value: R },
                uBaseAlt:   { value: BASE_ALT },
                uAltSpread: { value: ALT_SPREAD },
                uGM:        { value: GM },
                uStreakArc: { value: STREAK_ARC },
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
        this._t0 = performance.now();
    }

    update(): void {
        this._mat.uniforms.uTime.value = (performance.now() - this._t0) * 1e-3;
    }

    dispose(): void {
        this._mesh.geometry.dispose();
        this._mat.dispose();
    }
}
