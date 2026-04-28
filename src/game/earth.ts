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
uniform float uIntensity;    // glow brightness
uniform float uFade;         // 0 at surface, 1 above ~1 Mm
uniform vec3  uSkyColor;
uniform vec3  uSunColor;

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
    float atmWidth = 0.18;
    float outerGlow = exp(-pow((t - 1.0) / atmWidth, 2.0));

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
        // innerDayMask: 1 on night/terminator side, 0 on fully-lit dayside
        float innerDayMask = 1.0 - smoothstep(0.0, 0.3, NdotL);

        float innerLimb = exp(-pow((1.0 - t) / 0.0875, 2.0)) * step(0.0, 1.0 - t);
        float innerGlow = innerLimb * 0.4 * innerDayMask;
        gl_FragColor = vec4(color * innerGlow, innerGlow);
    } else {
        // Outside the disc: outer halo glow only.
        float atm = outerGlow * uIntensity * uFade;
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
                uIntensity:   { value: 1.2 },
                uFade:        { value: 1.0 },
                uSkyColor:    { value: new Color(0.07, 0.20, 0.72) },
                uSunColor:    { value: new Color(0.52, 0.76, 1.00) },
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
    setIntensity(v: number):      void { this._mat.uniforms.uIntensity.value  = v; }
    setSkyColor(hex: string):     void { (this._mat.uniforms.uSkyColor.value as Color).set(hex); }
    setSunColor(hex: string):     void { (this._mat.uniforms.uSunColor.value as Color).set(hex); }
}

export function addAtmosphere(overlayScene: Scene): AtmosphereGlow {
    return new AtmosphereGlow(overlayScene);
}

