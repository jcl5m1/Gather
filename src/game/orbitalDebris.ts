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
 * Geometry: 11 vertices per particle (1 head + 10 tail steps).
 *           10 line segments connecting them → true curved arc.
 *           aVertRole ∈ [0.0, 1.0] — 0=head, 1=tail tip.
 *           Each vertex independently solves Kepler at its own M offset,
 *           so the polyline follows the exact Keplerian arc.
 *
 * Orbital elements per particle (packed into two attributes):
 *   aOrbit1 = (semi-major axis a, eccentricity e, inclination i, RAAN Ω)
 *   aOrbit2 = (arg-of-perigee ω, mean anomaly M0, unused, unused)
 *
 * Eccentricity range: 0.00 – 0.60
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
    Vector3,
} from 'three';
import { R } from './constants';

// ── Physics ────────────────────────────────────────────────────────────────
const GM = 3.986004418e14;          // Earth gravitational parameter (m³/s²)

// ── Eccentricity range ─────────────────────────────────────────────────────
const ECC_MIN = 0.00;
const ECC_MAX = 0.60;

// ── Perigee altitude range (m) ─────────────────────────────────────────────
const PERIGEE_MIN = R + 200_000;    // 200 km above surface
const PERIGEE_MAX = R + 1_000_000;  // 1 Mm above surface

// ── Tail geometry ──────────────────────────────────────────────────────────
//   TAIL_STEPS segments → TAIL_STEPS+1 vertices per particle (including head).
//   Each vertex is offset by n * aVertRole * uTailDuration seconds behind the head.
const TAIL_STEPS    = 10;                     // number of line segments
const VERTS_PER     = TAIL_STEPS + 1;         // 11 vertices per particle

// ── Count ──────────────────────────────────────────────────────────────────
const COUNT = 10_000;

// ── Vertex shader ──────────────────────────────────────────────────────────
const DEBRIS_VERT = /* glsl */`
// Element set 1: (a, e, incl, raan)
attribute vec4 aOrbit1;
// Element set 2: (argPeri, M0, unused, unused)
attribute vec4 aOrbit2;
// 0.0 = head, 1.0 = tail tip  (evenly spaced at 0.0, 0.1, 0.2, ... 1.0)
attribute float aVertRole;

uniform float uTime;          // simulation time (s)
uniform float uGM;            // gravitational parameter (m³/s²)
uniform float uTailDuration;  // real sim-seconds the tail spans (= 1s * timeScale)
uniform vec3  uSunDir;        // unit vector toward the sun (world space)
uniform float uEarthRadius;   // Earth radius in scene units (m)

varying float vRole;
varying float vInShadow;      // 1.0 = fully in shadow, 0.0 = sunlit

// ── Kepler solver (Newton-Raphson, 6 iterations) ─────────────────────────
float solveKepler(float M, float e) {
    M = mod(M, 6.28318530718);
    float E = M;
    for (int i = 0; i < 6; i++) {
        E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }
    return E;
}

// ── Rodrigues rotation ────────────────────────────────────────────────────
vec3 rotateAxis(vec3 v, vec3 k, float theta) {
    float c = cos(theta), s = sin(theta);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
    float a       = aOrbit1.x;
    float e       = aOrbit1.y;
    float incl    = aOrbit1.z;
    float raan    = aOrbit1.w;
    float argPeri = aOrbit2.x;
    float M0      = aOrbit2.y;

    // Mean motion
    float n = sqrt(uGM / (a * a * a));

    // Each vertex sits at a different point along the tail arc.
    // aVertRole=0 → head (current position), aVertRole=1 → tail tip (furthest back).
    // Offset each tail vertex by aVertRole * uTailDuration seconds behind head.
    // Using this particle's own mean motion n so arc length is physically correct.
    float M = M0 + n * (uTime - aVertRole * uTailDuration);

    // Solve Kepler → eccentric anomaly
    float E = solveKepler(M, e);

    // True anomaly
    float nu = 2.0 * atan(sqrt((1.0 + e) / (1.0 - e)) * tan(E * 0.5));

    // Orbital radius
    float r = a * (1.0 - e * cos(E));

    // Build 3-D orbital frame
    vec3 north      = vec3(0.0, 1.0, 0.0);
    vec3 nodeDir    = vec3(cos(raan), 0.0, sin(raan));
    vec3 orbitZ     = rotateAxis(north,   nodeDir, incl);
    vec3 perigeeDir = rotateAxis(nodeDir, orbitZ,  argPeri);
    vec3 semilatDir = cross(orbitZ, perigeeDir);

    vec3 pos = r * (perigeeDir * cos(nu) + semilatDir * sin(nu));

    // ── Earth shadow (cylindrical umbra approximation) ──────────────────
    // Project pos onto the anti-sun axis.
    // A point is in shadow when:
    //   1. It is on the night side  (dot(pos, sunDir) < 0)
    //   2. Its perpendicular distance from the sun-Earth axis < Earth radius
    vec3  antiSun      = -uSunDir;
    float alongAntiSun = dot(pos, antiSun);              // > 0 → behind Earth
    vec3  axisPoint    = antiSun * alongAntiSun;         // nearest point on axis
    float perpDist     = length(pos - axisPoint);        // distance from axis
    float inShadow     = (alongAntiSun > 0.0 && perpDist < uEarthRadius) ? 1.0 : 0.0;

    vRole       = aVertRole;
    vInShadow   = inShadow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

// ── Fragment shader ────────────────────────────────────────────────────────
const DEBRIS_FRAG = /* glsl */`
varying float vRole;
varying float vInShadow;   // 1.0 = in Earth's shadow

void main() {
    float alpha      = (1.0 - vRole) * (1.0 - vRole);   // quadratic fade to tail
    // Particles in shadow are invisible; add a tiny ambient so they're not
    // completely black (earthshine / reflected light).
    float brightness = mix(1.0, 0.0, vInShadow);
    gl_FragColor = vec4(vec3(brightness), alpha * 0.85);
}`;

// ── Class ──────────────────────────────────────────────────────────────────
export class OrbitalDebris {
    private _mat:     ShaderMaterial;
    private _mesh:    LineSegments;
    private _simTime: number = 0.0;

    constructor(scene: Scene) {
        const TOTAL_VERTS   = COUNT * VERTS_PER;
        const TOTAL_INDICES = COUNT * TAIL_STEPS * 2;

        const { orbit1, orbit2, role, indices } = OrbitalDebris._fillBuffers(
            new Float32Array(TOTAL_VERTS * 4),
            new Float32Array(TOTAL_VERTS * 4),
            new Float32Array(TOTAL_VERTS),
            new Uint32Array(TOTAL_INDICES),
        );

        const geo = new BufferGeometry();
        geo.setAttribute('aOrbit1',   new BufferAttribute(orbit1, 4));
        geo.setAttribute('aOrbit2',   new BufferAttribute(orbit2, 4));
        geo.setAttribute('aVertRole', new BufferAttribute(role,   1));
        geo.setIndex(new BufferAttribute(indices, 1));

        this._mat = new ShaderMaterial({
            vertexShader:   DEBRIS_VERT,
            fragmentShader: DEBRIS_FRAG,
            uniforms: {
                uTime:         { value: 0.0 },
                uGM:           { value: GM },
                uTailDuration: { value: 1.0 },          // updated each frame
                uSunDir:       { value: new Vector3(1, 0, 0) },
                uEarthRadius:  { value: R },
            },
            transparent: true,
            blending:    AdditiveBlending,
            depthWrite:  false,
        });

        this._mesh = new LineSegments(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder   = 20;
        scene.add(this._mesh);
    }

    /** Re-randomise all particle orbital elements and re-upload to GPU. */
    reinitParticles(): void {
        const geo         = this._mesh.geometry;
        const TOTAL_VERTS = COUNT * VERTS_PER;
        const TOTAL_IDX   = COUNT * TAIL_STEPS * 2;

        const o1 = (geo.getAttribute('aOrbit1') as BufferAttribute).array as Float32Array;
        const o2 = (geo.getAttribute('aOrbit2') as BufferAttribute).array as Float32Array;
        const ro = (geo.getAttribute('aVertRole') as BufferAttribute).array as Float32Array;
        const ix = (geo.index as BufferAttribute).array as Uint32Array;

        OrbitalDebris._fillBuffers(o1, o2, ro, ix);

        (geo.getAttribute('aOrbit1')  as BufferAttribute).needsUpdate = true;
        (geo.getAttribute('aOrbit2')  as BufferAttribute).needsUpdate = true;
        (geo.getAttribute('aVertRole') as BufferAttribute).needsUpdate = true;
        (geo.index as BufferAttribute).needsUpdate = true;

        // Reset sim time so new orbits start from t=0
        this._simTime = 0.0;
    }

    /** Fill orbit1, orbit2, role, and index buffers with fresh random particles. */
    private static _fillBuffers(
        orbit1:  Float32Array,
        orbit2:  Float32Array,
        role:    Float32Array,
        indices: Uint32Array,
    ): { orbit1: Float32Array; orbit2: Float32Array; role: Float32Array; indices: Uint32Array } {
        for (let i = 0; i < COUNT; i++) {
            const e       = ECC_MIN + Math.random() * (ECC_MAX - ECC_MIN);
            const rPeri   = PERIGEE_MIN + Math.random() * (PERIGEE_MAX - PERIGEE_MIN);
            const a       = rPeri / (1 - e);
            const incl    = Math.acos(1 - 2 * Math.random());
            const raan    = Math.random() * Math.PI * 2;
            const argPeri = Math.random() * Math.PI * 2;
            const M0      = Math.random() * Math.PI * 2;

            const vBase = i * VERTS_PER;

            for (let s = 0; s < VERTS_PER; s++) {
                const vi  = vBase + s;
                const vi4 = vi * 4;
                orbit1[vi4+0] = a;       orbit1[vi4+1] = e;
                orbit1[vi4+2] = incl;    orbit1[vi4+3] = raan;
                orbit2[vi4+0] = argPeri; orbit2[vi4+1] = M0;
                orbit2[vi4+2] = 0;       orbit2[vi4+3] = 0;
                role[vi] = s / TAIL_STEPS;
            }

            for (let s = 0; s < TAIL_STEPS; s++) {
                const ii = (i * TAIL_STEPS + s) * 2;
                indices[ii+0] = vBase + s;
                indices[ii+1] = vBase + s + 1;
            }
        }
        return { orbit1, orbit2, role, indices };
    }

    /**
     * Advance simulation.
     * @param dt        Frame delta already multiplied by timeScale (seconds of sim time)
     * @param timeScale Current time multiplier — used to scale tail duration so the
     *                  tail always represents TAIL_REAL_SECONDS of real-world time.
     */
    /** Update the sun direction used for shadow computation. */
    setSunDir(dir: Vector3): void {
        (this._mat.uniforms['uSunDir'].value as Vector3).copy(dir);
    }

    update(dt: number, timeScale: number = 1.0): void {
        this._simTime += dt;
        (this._mat.uniforms['uTime']         as { value: number }).value = this._simTime;
        // Tail always covers 1 real-world second worth of orbit behind the head.
        (this._mat.uniforms['uTailDuration'] as { value: number }).value = 1.0 * timeScale;
    }

    dispose(): void {
        this._mesh.geometry.dispose();
        this._mat.dispose();
    }
}
