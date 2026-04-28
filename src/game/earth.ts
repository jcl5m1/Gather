import {
    Scene, WebGLRenderer,
    AmbientLight,
    DirectionalLight,
    Color,
    BufferGeometry,
    BufferAttribute,
    Points,
    PointsMaterial,
    Mesh,
    PlaneGeometry,
    SphereGeometry,
    ShaderMaterial,
    AdditiveBlending,
    NormalBlending,
    DoubleSide,
    FrontSide,
    Vector3,
} from 'three';
import { R } from './constants';
import { EarthLOD } from './earthLOD';

// ── Scene lighting (sun + ambient) ────────────────────────────────────────────

export class SceneLighting {
    private _ambient: AmbientLight;
    private _sun:     DirectionalLight;
    private _sunDir = new Vector3(0.9962, 0.0872, 0);

    constructor(scene: Scene) {
        this._ambient = new AmbientLight(0xffffff, 0.01);
        this._sun     = new DirectionalLight(0xfff4e0, 1.65);
        this._sun.position.copy(this._sunDir).multiplyScalar(R * 3);
        scene.add(this._ambient, this._sun);
    }

    setSunAngles(elDeg: number, azDeg: number): Vector3 {
        const el    = elDeg * Math.PI / 180;
        const az    = azDeg * Math.PI / 180;
        const cosEl = Math.cos(el);
        this._sunDir.set(cosEl * Math.cos(az), Math.sin(el), cosEl * Math.sin(az));
        this._sun.position.copy(this._sunDir).multiplyScalar(R * 3);
        return this._sunDir;
    }

    setSunIntensity(v: number): void     { this._sun.intensity     = v; }
    setAmbientIntensity(v: number): void { this._ambient.intensity = v; }
    get sunDir(): Vector3                { return this._sunDir; }
}

export function addLighting(scene: Scene): SceneLighting {
    return new SceneLighting(scene);
}

export function addStars(scene: Scene): void {
    const geo = new BufferGeometry();
    const pts = new Float32Array(3000 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * R * 80;
    geo.setAttribute('position', new BufferAttribute(pts, 3));
    scene.add(new Points(geo, new PointsMaterial({ color: 0xffffff, size: R * 0.003 })));
}

export function addEarth(scene: Scene, renderer: WebGLRenderer, onReady: () => void): EarthLOD {
    const lod = new EarthLOD(scene, renderer);
    onReady();
    return lod;
}

// ── Day/Night shadow overlay ──────────────────────────────────────────────────
// MeshBasicMaterial terrain tiles ignore Three.js lights entirely.
// This sphere sits just above the surface and darkens the night side by
// alpha-blending a black layer whose opacity = f(NdotL).

const SHADOW_VERT = /* glsl */`
varying vec3 vWorldNormal;
void main() {
    vWorldNormal = normalize(position);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHADOW_FRAG = /* glsl */`
uniform vec3  uSunDir;
uniform float uSunIntensity;  // sharpens terminator and expands day side (0–2)
uniform float uAmbient;       // minimum illumination on night side (0–1)
varying vec3 vWorldNormal;
void main() {
    float NdotL   = dot(normalize(vWorldNormal), uSunDir);
    // uSunIntensity scales NdotL: higher = sharper terminator, more of the sphere in full day
    float dayness = smoothstep(-0.12, 0.12, NdotL * max(0.05, uSunIntensity));
    // uAmbient lifts the shadow floor — night side shows (1-uAmbient)*maxDark opacity
    float alpha   = (1.0 - dayness) * 0.95 * (1.0 - uAmbient);
    gl_FragColor  = vec4(0.0, 0.0, 0.0, alpha);
}`;

export class DaylightOverlay {
    private _mat:  ShaderMaterial;
    private _mesh: Mesh;

    constructor(scene: Scene, sunDir: Vector3) {
        this._mat = new ShaderMaterial({
            vertexShader:   SHADOW_VERT,
            fragmentShader: SHADOW_FRAG,
            uniforms: {
                uSunDir:        { value: sunDir.clone() },
                uSunIntensity:  { value: 1.0 },
                uAmbient:       { value: 0.25 },
            },
            transparent: true,
            blending:    NormalBlending,
            side:        FrontSide,
            depthWrite:  false,
            depthTest:   false,
        });
        this._mesh = new Mesh(new SphereGeometry(R + 100, 64, 32), this._mat);
        this._mesh.renderOrder = 15;   // above terrain tiles (1–9), below atmosphere (20)
        scene.add(this._mesh);
    }

    /** Call each frame with the real camera world position to counteract the scene-shift trick. */
    update(_camPos: Vector3): void { this._mesh.position.set(0, 0, 0); }

    setSunDir(dir: Vector3):       void { (this._mat.uniforms.uSunDir.value as Vector3).copy(dir); }
    setSunIntensity(v: number):    void { this._mat.uniforms.uSunIntensity.value = v; }
    setAmbient(v: number):         void { this._mat.uniforms.uAmbient.value      = v; }
}

export function addDaylightOverlay(scene: Scene, sunDir: Vector3): DaylightOverlay {
    return new DaylightOverlay(scene, sunDir);
}

// ── Atmospheric glow (fullscreen-quad, overlayScene) ─────────────────────────
// Drawn as a screen-space shader on a fullscreen quad so it is never clipped
// by the near/far planes (the atmosphere sphere at R*7 has all vertices either
// behind the camera or beyond the far plane when the camera is inside it).
//
// The fragment shader reconstructs the camera ray for each pixel and computes
// the closest approach to the planet centre using the same silhouette math as
// the 2-D canvas white ring diagnostic.

const ATM_VERT = /* glsl */`
void main() {
    // Pass geometry positions directly as clip-space coords — bypasses MVP.
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const ATM_FRAG = /* glsl */`
uniform vec2  uResolution;   // viewport size in pixels
uniform float uFov;          // vertical FOV (radians)
uniform vec3  uCamDir;       // unit vector from planet to camera
uniform float uCamDist;      // camera distance from planet centre (metres)
uniform vec3  uSunDir;       // unit vector toward sun (planet-centred)
uniform float uPlanetR;      // planet radius (metres)
uniform float uGlowFront;    // outer glow intensity on sun-facing limb
uniform float uGlowBack;     // outer glow intensity on anti-sun limb
uniform float uRimFront;     // outer glow width on sun-facing limb (higher = tighter)
uniform float uRimBack;      // outer glow width on anti-sun limb (higher = tighter)
uniform float uFade;         // 0 at surface, 1 above ~1 Mm
uniform vec3  uSkyColor;
uniform vec3  uSunColor;
uniform float uInnerOpacity; // inner limb glow opacity
uniform float uInnerWidth;   // inner limb falloff width

void main() {
    // ── Reconstruct the camera ray for this pixel ─────────────────────────
    // NDC in [-1,1] (y up)
    vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;

    // Build a camera-space ray direction
    float tanHFov = tan(uFov * 0.5);
    // Right and up vectors are perpendicular to uCamDir
    // uCamDir points FROM planet TO camera (i.e. away from planet)
    // camera looks TOWARD the planet, so forward = -uCamDir
    vec3 forward = -uCamDir;
    // Build right/up perpendicular to forward
    vec3 worldUp = abs(forward.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(forward, worldUp));
    vec3 up    = cross(right, forward);

    // Ray direction in world space
    vec3 rd = normalize(forward + right * (ndc.x * aspect * tanHFov) + up * (ndc.y * tanHFov));

    // ── Ray vs planet silhouette ──────────────────────────────────────────
    // Camera world position (planet at origin)
    vec3 C = uCamDir * uCamDist;
    // Closest approach of ray to planet centre
    float tClose = max(0.0, -dot(C, rd));
    vec3  qClose = C + tClose * rd;
    float dClose = length(qClose);   // perpendicular distance from ray to planet centre

    // ── Silhouette-normalised edge factor ─────────────────────────────────
    // t=1 when the ray grazes the planet silhouette (dClose == uPlanetR at distance D)
    // Using: sin(theta_sil) = R/D, sin(theta_ray) = dClose/D
    float sinSil = uPlanetR / uCamDist;
    float sinRay = clamp(dClose / uCamDist, 0.0, 1.0);
    float t = sinRay / max(sinSil, 0.0001);

    // ── Outer glow: Gaussian bell peaked at t=1 (outside the disc, t>1) ──
    // Rim uniforms are sharpness (higher = narrower). Convert to width: width = 1/uRim.
    float rimWidthFront = 1.0 / max(uRimFront, 0.1);
    float rimWidthBack  = 1.0 / max(uRimBack,  0.1);
    // We'll compute per-pixel rim width after we know sun side (below).
    // Pre-compute both and blend:
    float outerGlowFront = exp(-pow((t - 1.0) / rimWidthFront, 2.0));
    float outerGlowBack  = exp(-pow((t - 1.0) / rimWidthBack,  2.0));

    // ── Inner limb: thin atmospheric tint inside the silhouette edge ──────
    // Decays from the silhouette inward, only on the planet-facing side.
    // Uses 1-t so it is 0 at the silhouette and rises toward disc centre,
    // but multiplied by t^4 so it stays close to the edge (limb darkening).
    float innerWidth = 0.35;
    float innerLimb  = exp(-pow((1.0 - t) / innerWidth, 2.0)) * pow(t, 1.5);

    // ── Determine if this ray hits the planet body ────────────────────────
    float tPlanet = -dot(C, rd) - sqrt(max(0.0, uPlanetR * uPlanetR - dClose * dClose));
    bool  hitsBody = (dClose < uPlanetR) && (tPlanet > 0.0);

    // Sun tint (shared for both terms)
    vec3  qNorm   = dClose > 0.001 ? normalize(qClose) : uCamDir;
    float NdotS   = dot(qNorm, uSunDir);
    float sunTint = pow(max(0.0, NdotS) * 0.5 + 0.5, 3.0);
    vec3  color   = mix(uSkyColor, uSunColor, sunTint);

    if (hitsBody) {
        // Compute the actual surface hit point and its normal
        float tHit     = -dot(C, rd) - sqrt(max(0.0, uPlanetR * uPlanetR - dClose * dClose));
        vec3  hitPoint = C + tHit * rd;
        vec3  surfNorm = normalize(hitPoint);   // planet-centred unit normal at surface

        // Day/night: NdotL on the actual surface — matches the planet's lit hemisphere exactly
        float NdotL    = dot(surfNorm, uSunDir);
        // innerDayMask: 1 on fully-lit dayside, 0 on night side (inverted)
        float innerDayMask = smoothstep(0.0, 0.3, NdotL);

        float innerLimb = exp(-pow((1.0 - t) / uInnerWidth, 2.0)) * step(0.0, 1.0 - t);
        float innerGlow = innerLimb * uInnerOpacity * innerDayMask;
        gl_FragColor = vec4(color * innerGlow, innerGlow);
    } else {
        // Outside the disc: outer halo glow only.
        // Split intensity by sun direction at the silhouette point:
        //   qNorm is the normalised silhouette point direction.
        //   NdotS > 0 = sun-facing limb (front), < 0 = back-lit limb (back).
        float NdotS_outer   = dot(normalize(qClose), uSunDir);
        float frontWeight   = smoothstep(-0.3, 0.3, NdotS_outer);   // 0=back, 1=front
        float glowIntensity = mix(uGlowBack, uGlowFront, frontWeight);
        float outerGlow     = mix(outerGlowBack, outerGlowFront, frontWeight);
        float atm = outerGlow * glowIntensity * uFade;
        gl_FragColor = vec4(color * atm, atm);
    }
}`;

export class AtmosphereGlow {
    private _mat:  ShaderMaterial;
    private _mesh: Mesh;

    // overlayScene must be a separate scene that is never shifted by the
    // never shifted by the floating-origin trick, so the quad stays fullscreen.
    constructor(overlayScene: Scene) {
        this._mat = new ShaderMaterial({
            vertexShader:   ATM_VERT,
            fragmentShader: ATM_FRAG,
            uniforms: {
                uResolution:  { value: [window.innerWidth, window.innerHeight] },
                uFov:         { value: 45 * Math.PI / 180 },
                uCamDir:      { value: new Vector3(0, 1, 0) },
                uCamDist:     { value: R * 2 },
                uPlanetR:     { value: R },
                uSunDir:      { value: new Vector3(0.9962, 0.0872, 0) },
                uGlowFront:   { value: 0.7 },
                uGlowBack:    { value: 0.4 },
                uRimFront:    { value: 11.1 },  // 1/0.09 — half of old 0.18
                uRimBack:     { value: 11.1 },
                uFade:        { value: 1.0 },
                uSkyColor:    { value: new Color(0.07, 0.20, 0.72) },
                uSunColor:    { value: new Color(0.52, 0.76, 1.00) },
                uInnerOpacity:{ value: 1.0 },
                uInnerWidth:  { value: 0.25 },
            },
            transparent: true,
            blending:    AdditiveBlending,
            depthWrite:  false,
            depthTest:   false,
        });
        const geo = new PlaneGeometry(2, 2);
        this._mesh = new Mesh(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder = 20;
        overlayScene.add(this._mesh);
    }

    update(camPos: Vector3, renderer: WebGLRenderer): void {
        const dist = camPos.length();
        (this._mat.uniforms.uCamDir.value as Vector3).copy(camPos).normalize();
        this._mat.uniforms.uCamDist.value = dist;
        // Physical framebuffer pixels (gl_FragCoord is in physical px, not CSS px)
        const dpr = renderer.getPixelRatio();
        this._mat.uniforms.uResolution.value = [window.innerWidth * dpr, window.innerHeight * dpr];
        const height = dist - R;
        this._mat.uniforms.uFade.value = Math.min(1, Math.max(0, (height - 5e5) / 5e5));
    }

    setSunDir(dir: Vector3):      void { (this._mat.uniforms.uSunDir.value as Vector3).copy(dir); }
    setGlowFront(v: number):      void { this._mat.uniforms.uGlowFront.value  = v; }
    setGlowBack(v: number):       void { this._mat.uniforms.uGlowBack.value   = v; }
    setRimFront(v: number):       void { this._mat.uniforms.uRimFront.value   = v; }
    setRimBack(v: number):        void { this._mat.uniforms.uRimBack.value    = v; }
    setSkyColor(hex: string):     void { (this._mat.uniforms.uSkyColor.value as Color).set(hex); }
    setSunColor(hex: string):     void { (this._mat.uniforms.uSunColor.value as Color).set(hex); }
    setInnerOpacity(v: number):   void { this._mat.uniforms.uInnerOpacity.value = v; }
    setInnerWidth(v: number):     void { this._mat.uniforms.uInnerWidth.value   = v; }
}

export function addAtmosphere(overlayScene: Scene): AtmosphereGlow {
    return new AtmosphereGlow(overlayScene);
}


// ── Ocean Specular reflection (fullscreen-quad, overlayScene) ─────────────────
// Reconstructs the ray for each pixel, intersects the planet sphere, evaluates
// the same procedural height field to find ocean pixels (height < shorelineLevel),
// then computes a Blinn-Phong specular highlight using the true view direction.
// Drawn additively on top of the terrain tiles.

const OCEAN_SPEC_VERT = /* glsl */`
void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const OCEAN_SPEC_FRAG = /* glsl */`
precision highp float;

uniform vec2  uResolution;
uniform float uFov;
uniform vec3  uCamDir;
uniform float uCamDist;
uniform vec3  uSunDir;
uniform float uPlanetR;
uniform float uShorelineLevel;
uniform float uDeepOceanLevel;
uniform float uSpecPower;       // shininess exponent (default 80)
uniform float uSpecIntensity;   // overall brightness (default 0.6)
uniform vec3  uSpecColor;       // highlight colour (default near-white)

// ── Noise / height field (mirrors terrainGen.ts) ──────────────────────────────
const int   OCTAVE_COUNT = 8;   // fewer octaves for perf (ocean is smooth)
const float FEATURE_SCALE    = 1.4;
const float LACUNARITY       = 2.9;
const float PERSISTENCE      = 0.54;
const float HEIGHT_CURVE     = 1.0;
const float LAYER2_SCALE     = 1.8;
const float CONTINENTAL_BIAS = 0.35;
const mat3 OCT_ROT = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64);

vec3 ghash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
float gnoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(dot(ghash(i),             f),             dot(ghash(i+vec3(1,0,0)), f-vec3(1,0,0)), u.x),
            mix(dot(ghash(i+vec3(0,1,0)), f-vec3(0,1,0)),dot(ghash(i+vec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
        mix(mix(dot(ghash(i+vec3(0,0,1)), f-vec3(0,0,1)),dot(ghash(i+vec3(1,0,1)), f-vec3(1,0,1)), u.x),
            mix(dot(ghash(i+vec3(0,1,1)), f-vec3(0,1,1)),dot(ghash(i+vec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y),
        u.z);
}
float fbm(vec3 p) {
    float h = 0.0, a = 0.5;
    for (int i = 0; i < OCTAVE_COUNT; i++) {
        h += a * gnoise(p);
        p  = OCT_ROT * p * LACUNARITY;
        a *= PERSISTENCE;
    }
    return h * 0.5 + 0.5;
}
float oceanHeight(vec3 p) {
    float l1 = fbm(p * FEATURE_SCALE);
    float l2 = fbm(p * FEATURE_SCALE * LAYER2_SCALE + vec3(17.31, 43.27, 31.83));
    float cont = gnoise(p * 0.8) * CONTINENTAL_BIAS;
    return pow(clamp(l1 * l2 * 2.0 + cont, 0.0, 1.0), HEIGHT_CURVE);
}

void main() {
    // ── Reconstruct camera ray ────────────────────────────────────────────
    vec2 ndc    = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;
    float aspect = uResolution.x / uResolution.y;
    float tanHFov = tan(uFov * 0.5);
    vec3 forward = -uCamDir;
    vec3 worldUp = abs(forward.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 right   = normalize(cross(forward, worldUp));
    vec3 up      = cross(right, forward);
    vec3 rd      = normalize(forward + right*(ndc.x*aspect*tanHFov) + up*(ndc.y*tanHFov));

    // ── Ray–sphere intersection ───────────────────────────────────────────
    vec3  C   = uCamDir * uCamDist;          // camera world pos (planet at origin)
    float b   = dot(C, rd);
    float det = b*b - dot(C,C) + uPlanetR*uPlanetR;
    if (det < 0.0) { gl_FragColor = vec4(0.0); return; }

    float sqrtDet = sqrt(det);
    float t0 = -b - sqrtDet;
    float t1 = -b + sqrtDet;
    float t  = (t0 > 0.0) ? t0 : t1;
    if (t < 0.0) { gl_FragColor = vec4(0.0); return; }

    // ── Surface point & ocean mask ────────────────────────────────────────
    vec3 hitPos  = normalize(C + t * rd);   // unit-sphere surface point
    float h      = oceanHeight(hitPos);
    float oceanMask = 1.0 - smoothstep(uDeepOceanLevel, uShorelineLevel, h);
    if (oceanMask < 0.001) { gl_FragColor = vec4(0.0); return; }

    // ── Blinn-Phong specular ──────────────────────────────────────────────
    vec3  N      = hitPos;                          // ocean normal = sphere normal
    vec3  V      = normalize(-rd);                  // view direction (toward camera)
    vec3  H      = normalize(uSunDir + V);          // half-vector
    float NdotH  = max(0.0, dot(N, H));
    float NdotL  = max(0.0, dot(N, uSunDir));
    float spec   = pow(NdotH, uSpecPower) * NdotL;  // NdotL kills spec on night side

    float alpha  = spec * uSpecIntensity * oceanMask;
    gl_FragColor = vec4(uSpecColor * alpha, alpha);
}`;

export class OceanSpecular {
    private _mat:  ShaderMaterial;
    private _mesh: Mesh;

    constructor(overlayScene: Scene) {
        this._mat = new ShaderMaterial({
            vertexShader:   OCEAN_SPEC_VERT,
            fragmentShader: OCEAN_SPEC_FRAG,
            uniforms: {
                uResolution:    { value: [window.innerWidth, window.innerHeight] },
                uFov:           { value: 45 * Math.PI / 180 },
                uCamDir:        { value: new Vector3(0, 1, 0) },
                uCamDist:       { value: R * 2 },
                uSunDir:        { value: new Vector3(0.9962, 0.0872, 0) },
                uPlanetR:       { value: R },
                uShorelineLevel:{ value: 0.50 },
                uDeepOceanLevel:{ value: 0.50 },
                uSpecPower:     { value: 40.0 },
                uSpecIntensity: { value: 0.6 },
                uSpecColor:     { value: new Color(0.85, 0.95, 1.0) },
            },
            transparent: true,
            blending:    AdditiveBlending,
            depthWrite:  false,
            depthTest:   false,
        });
        const geo = new PlaneGeometry(2, 2);
        this._mesh = new Mesh(geo, this._mat);
        this._mesh.frustumCulled = false;
        this._mesh.renderOrder = 18;   // above terrain (1-9), below atmosphere (20)
        overlayScene.add(this._mesh);
    }

    update(camPos: Vector3, renderer: WebGLRenderer, fovRad: number): void {
        (this._mat.uniforms.uCamDir.value as Vector3).copy(camPos).normalize();
        this._mat.uniforms.uCamDist.value = camPos.length();
        this._mat.uniforms.uFov.value     = fovRad;
        const dpr = renderer.getPixelRatio();
        this._mat.uniforms.uResolution.value = [window.innerWidth * dpr, window.innerHeight * dpr];
    }

    setSunDir(dir: Vector3):        void { (this._mat.uniforms.uSunDir.value as Vector3).copy(dir); }
    setShorelineLevel(v: number):   void { this._mat.uniforms.uShorelineLevel.value = v; }
    setDeepOceanLevel(v: number):   void { this._mat.uniforms.uDeepOceanLevel.value = v; }
    setSpecPower(v: number):        void { this._mat.uniforms.uSpecPower.value      = v; }
    setSpecIntensity(v: number):    void { this._mat.uniforms.uSpecIntensity.value  = v; }
}

export function addOceanSpecular(overlayScene: Scene): OceanSpecular {
    return new OceanSpecular(overlayScene);
}
