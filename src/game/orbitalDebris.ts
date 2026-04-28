/**
 * OrbitalDebris — 10,000 GPU-simulated particles in random low-Earth orbits.
 *
 * Each particle is rendered as a short streak:  a line segment with two vertices
 * — the head (current position) and the tail (a fixed arc behind it).  The
 * fragment shader fades alpha from 1.0 at the head to 0.0 at the tail so the
 * streak looks like a motion-blur trail.
 *
 * All orbital mechanics run entirely on the GPU:
 *   • Each particle has a random orbital plane (inclination + RAAN) and a
 *     random starting mean-anomaly, stored in a BufferAttribute.
 *   • The vertex shader advances the angle each frame using uTime and the
 *     fixed circular orbital speed at 1 Mm altitude.
 *   • No CPU work per-frame beyond uploading uTime.
 */

import {
    BufferGeometry,
    BufferAttribute,
    ShaderMaterial,
    AdditiveBlending,
    LineSegments,
    Scene,
    Vector3,
} from 'three';
import { R } from './constants';

// ── Constants ─────────────────────────────────────────────────────────────────
const COUNT       = 10_000;
const ORBIT_ALT   = 1_000_000;          // 1 Mm above surface (m)
const ORBIT_R     = R + ORBIT_ALT;      // orbital radius (m)
// Circular orbital speed: v = sqrt(GM / r)
// GM_Earth = 3.986004418e14 m³/s²
const GM          = 3.986004418e14;
const ORBIT_SPEED = Math.sqrt(GM / ORBIT_R); // m/s  ≈ 7351 m/s
const ORBIT_OMEGA = ORBIT_SPEED / ORBIT_R;   // rad/s ≈ 9.98e-4 rad/s
// Streak angular half-length (radians)
const STREAK_ARC  = 0.012;              // ~0.69° — visible but tight

// ── Vertex shader ─────────────────────────────────────────────────────────────
// Each LINE SEGMENT has 2 vertices.  vertexIndex selects head (0) or tail (1).
//
// aOrbit.x = inclination   (rad)
// aOrbit.y = RAAN Ω        (rad)   – right ascension of ascending node
// aOrbit.z = initial mean anomaly M0 (rad)
// aVertRole = 0.0 → head vertex,  1.0 → tail vertex
//             also used as the alpha source in the fragment shader

const DEBRIS_VERT = /* glsl */`
attribute vec3  aOrbit;      // (inclination, RAAN, M0)
attribute float aVertRole;   // 0 = head, 1 = tail

uniform float uTime;         // elapsed seconds
uniform float uOmega;        // orbital angular speed (rad/s)
uniform float uOrbitR;       // orbital radius (m)
uniform float uStreakArc;    // tail angular offset (rad)

varying float vRole;         // passed to fragment for alpha fade

// Rotate vector v around unit axis k by angle theta (Rodrigues)
vec3 rotateAxis(vec3 v, vec3 k, float theta) {
    float c = cos(theta), s = sin(theta);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
    float incl = aOrbit.x;
    float raan = aOrbit.y;
    float M0   = aOrbit.z;

    // Current true anomaly (circular orbit → M = θ)
    float theta = M0 + uOmega * uTime;
    // Tail is STREAK_ARC radians behind the head
    float angle = theta - aVertRole * uStreakArc;

    // ── Build orbital position in the orbital plane ───────────────────────
    // Reference direction: X axis.  Orbital plane is tilted by inclination
    // around the ascending node direction, then rotated by RAAN around Y.

    // Perifocal position (orbit in equatorial reference before inclination):
    //   p = (cos(angle), 0, sin(angle)) in the X-Z plane (equatorial)
    // 1. Apply inclination: tilt the orbit plane around the ascending-node axis.
    //    Ascending node direction = (cos(RAAN), 0, sin(RAAN))  (in X-Z plane)
    vec3 nodeDir = vec3(cos(raan), 0.0, sin(raan));

    // Position on a unit circle in the equatorial plane
    vec3 unitX   = nodeDir;
    vec3 unitY   = vec3(0.0, 1.0, 0.0);                // north pole
    vec3 unitZ   = cross(unitX, unitY);                 // = (-sin(raan), 0, cos(raan)) ... actually nope
    // Recompute: the orbit lies in a plane whose ascending node is nodeDir.
    // The in-plane Y-axis after inclination tilt is perpendicular to nodeDir
    // and tilted by inclination from the equatorial Y (north).
    vec3 orbitY  = rotateAxis(unitY, nodeDir, incl);    // tilted north pole
    vec3 orbitX  = nodeDir;                             // ascending node direction

    vec3 pos = uOrbitR * (orbitX * cos(angle) + orbitY * sin(angle));

    vRole = aVertRole;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// ── Fragment shader ───────────────────────────────────────────────────────────
const DEBRIS_FRAG = /* glsl */`
varying float vRole;    // 0 = head (bright), 1 = tail (transparent)

void main() {
    float alpha = 1.0 - vRole;          // linear fade: head→1, tail→0
    alpha = alpha * alpha;              // quadratic — faster fade toward tail
    gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * 0.85);
}`;

// ── Class ─────────────────────────────────────────────────────────────────────
export class OrbitalDebris {
    private _mat:  ShaderMaterial;
    private _mesh: LineSegments;
    private _t0:   number;              // wall-clock start time (ms)

    constructor(scene: Scene) {
        // Each streak = 2 vertices  →  2 * COUNT positions
        const VERTS = COUNT * 2;

        const orbit   = new Float32Array(VERTS * 3);  // (incl, raan, M0) per vertex
        const role    = new Float32Array(VERTS);       // 0 = head, 1 = tail
        const indices = new Uint32Array(COUNT * 2);    // index buffer: pairs

        for (let i = 0; i < COUNT; i++) {
            const incl = Math.acos(1 - 2 * Math.random()); // uniform on sphere → random inclination
            const raan = Math.random() * Math.PI * 2;
            const M0   = Math.random() * Math.PI * 2;

            const vi = i * 2;   // vertex index of head
            // Head vertex
            orbit[vi*3+0] = incl;  orbit[vi*3+1] = raan;  orbit[vi*3+2] = M0;
            role[vi]      = 0.0;

            // Tail vertex
            orbit[(vi+1)*3+0] = incl;  orbit[(vi+1)*3+1] = raan;  orbit[(vi+1)*3+2] = M0;
            role[vi+1]         = 1.0;

            // Index pair
            indices[i*2+0] = vi;
            indices[i*2+1] = vi + 1;
        }

        const geo = new BufferGeometry();
        geo.setAttribute('aOrbit',    new BufferAttribute(orbit, 3));
        geo.setAttribute('aVertRole', new BufferAttribute(role,  1));
        geo.setIndex(new BufferAttribute(indices, 1));

        this._mat = new ShaderMaterial({
            vertexShader:   DEBRIS_VERT,
            fragmentShader: DEBRIS_FRAG,
            uniforms: {
                uTime:      { value: 0.0 },
                uOmega:     { value: ORBIT_OMEGA },
                uOrbitR:    { value: ORBIT_R },
                uStreakArc: { value: STREAK_ARC },
            },
            transparent: true,
            blending:    AdditiveBlending,
            depthWrite:  false,
            depthTest:   true,
        });

        this._mesh = new LineSegments(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder   = 12;   // above terrain, below atmosphere glow
        scene.add(this._mesh);

        this._t0 = performance.now();
    }

    /** Call once per frame from the main render loop. */
    update(): void {
        this._mat.uniforms.uTime.value = (performance.now() - this._t0) * 0.001; // ms → s
    }

    dispose(): void {
        this._mesh.geometry.dispose();
        this._mat.dispose();
    }

    get mesh(): LineSegments { return this._mesh; }
}

export function addOrbitalDebris(scene: Scene): OrbitalDebris {
    return new OrbitalDebris(scene);
}
