import {
    WebGLRenderer, WebGLRenderTarget, Scene, OrthographicCamera,
    Mesh, PlaneGeometry, ShaderMaterial, Color,
} from 'three';

export interface TerrainParams {
    featureScale:    number;
    lacunarity:      number;
    persistence:     number;
    heightCurve:     number;
    layer2Scale:     number;
    continentalBias: number;
    deepOceanLevel:  number;
    shorelineLevel:  number;
    lowlandLevel:    number;
    highlandLevel:   number;
    snowlineLevel:   number;
    // Base terrain visibility
    baseEnabled:     number;   // 0 or 1
    // Polar Ice layer
    iceEnabled:      number;   // 0 or 1
    iceScale:        number;
    iceAzimuth:      number;   // power on |cos(lat)|; higher = sharper polar cap
    iceOpacity:      number;
    iceBlendMode:    number;   // 0=Normal 1=Screen 2=Multiply 3=Add
    iceClearColor:   string;   // hex RGB at the "clear" stop
    iceClearAlpha:   number;   // alpha at the "clear" stop
    iceIceColor:     string;   // hex RGB at the "ice" stop
    iceIceAlpha:     number;   // alpha at the "ice" stop
    iceClearLevel:   number;   // iceAlpha threshold for clear end (0–1)
    iceIceLevel:     number;   // iceAlpha threshold for ice end  (0–1)
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
    featureScale:    1.4,
    lacunarity:      2.9,
    persistence:     0.54,
    heightCurve:     1.0,
    layer2Scale:     1.8,
    continentalBias: 0.35,
    deepOceanLevel:  0.50,
    shorelineLevel:  0.50,
    lowlandLevel:    0.54,
    highlandLevel:   0.70,
    snowlineLevel:   0.70,
    baseEnabled:     1,
    iceEnabled:      1,
    iceScale:        9.5,
    iceAzimuth:      10.0,
    iceOpacity:      3.5,
    iceBlendMode:    3,
    iceClearColor:   '#b0cce0',
    iceClearAlpha:   0.0,
    iceIceColor:     '#d9edff',
    iceIceAlpha:     1.0,
    iceClearLevel:   0.39,
    iceIceLevel:     0.86,
};

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform float uPhiStart;
uniform float uDPhi;
uniform float uThetaStart;
uniform float uDTheta;

// ── Base terrain parameters ───────────────────────────────────────────────────
const int   OCTAVE_COUNT = 12;
uniform float uFeatureScale;
uniform float uLacunarity;
uniform float uPersistence;
uniform float uHeightCurve;
uniform float uLayer2Scale;
uniform float uContinentalBias;

// ── Terrain zone thresholds ───────────────────────────────────────────────────
uniform float uDeepOceanLevel;
uniform float uShorelineLevel;
uniform float uLowlandLevel;
uniform float uHighlandLevel;
uniform float uSnowlineLevel;

// ── Layer visibility ──────────────────────────────────────────────────────────
uniform float uBaseEnabled;

// ── Ice layer ─────────────────────────────────────────────────────────────────
uniform float uIceEnabled;
uniform float uIceScale;
uniform float uIceAzimuth;
uniform float uIceOpacity;
uniform float uIceBlendMode;  // 0=Normal 1=Screen 2=Multiply 3=Add
uniform vec3  uIceClearColor;
uniform float uIceClearAlpha;
uniform vec3  uIceIceColor;
uniform float uIceIceAlpha;
uniform float uIceClearLevel;
uniform float uIceIceLevel;

// ── Lighting constants ────────────────────────────────────────────────────────
// Sun direction = normalize(vec3(3, 4, 1.5)) matching the DirectionalLight in earth.ts
const vec3  SUN_DIR       = vec3(0.5746, 0.7662, 0.2873);
const float AMBIENT_LIGHT = 0.18;   // dark-side fill so night isn't pure black
const float BUMP_STRENGTH = 0.02;   // height-gradient scale for terrain normals
const float BUMP_EPS      = 0.002;  // finite-difference step (radians on unit sphere ≈ 12 km)

// 3-D gradient noise
vec3 ghash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(dot(ghash(i),             f),
                dot(ghash(i+vec3(1,0,0)), f-vec3(1,0,0)), u.x),
            mix(dot(ghash(i+vec3(0,1,0)), f-vec3(0,1,0)),
                dot(ghash(i+vec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
        mix(mix(dot(ghash(i+vec3(0,0,1)), f-vec3(0,0,1)),
                dot(ghash(i+vec3(1,0,1)), f-vec3(1,0,1)), u.x),
            mix(dot(ghash(i+vec3(0,1,1)), f-vec3(0,1,1)),
                dot(ghash(i+vec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y),
        u.z);
}

const mat3 OCTAVE_ROTATION = mat3(
     0.00,  0.80,  0.60,
    -0.80,  0.36, -0.48,
    -0.60, -0.48,  0.64);

float fbm(vec3 p) {
    float height = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < OCTAVE_COUNT; i++) {
        height    += amplitude * gnoise(p);
        p          = OCTAVE_ROTATION * p * uLacunarity;
        amplitude *= uPersistence;
    }
    return height * 0.5 + 0.5;
}

// ── Height field (extracted so computeNormal can sample neighbours) ───────────
float computeHeight(vec3 p) {
    float l1 = fbm(p * uFeatureScale);
    float l2 = fbm(p * uFeatureScale * uLayer2Scale + vec3(17.31, 43.27, 31.83));
    float continental = gnoise(p * 0.8) * uContinentalBias;
    return pow(clamp(l1 * l2 * 2.0 + continental, 0.0, 1.0), uHeightCurve);
}

// ── Terrain normal via finite differences of the height field ─────────────────
// Builds an orthonormal tangent frame on the sphere at p, samples height at ±eps
// in each tangent direction, and tilts the sphere normal by the gradient.
vec3 computeNormal(vec3 p) {
    vec3 up = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(p, up));
    vec3 t2 = cross(p, t1);  // already unit length (p ⊥ t1, both unit)

    float hE = computeHeight(normalize(p + t1 * BUMP_EPS));
    float hW = computeHeight(normalize(p - t1 * BUMP_EPS));
    float hN = computeHeight(normalize(p + t2 * BUMP_EPS));
    float hS = computeHeight(normalize(p - t2 * BUMP_EPS));

    // Slope in height-units-per-radian; BUMP_STRENGTH scales into world units
    float gradE = (hE - hW) / (2.0 * BUMP_EPS);
    float gradN = (hN - hS) / (2.0 * BUMP_EPS);
    return normalize(p - BUMP_STRENGTH * (gradE * t1 + gradN * t2));
}

vec3 terrainColor(float h) {
    if (h < uDeepOceanLevel)
        return mix(vec3(0.03,0.06,0.20), vec3(0.07,0.19,0.48),
                   h / uDeepOceanLevel);
    if (h < uShorelineLevel)
        return mix(vec3(0.07,0.19,0.48), vec3(0.68,0.60,0.40),
                   (h - uDeepOceanLevel) / (uShorelineLevel - uDeepOceanLevel));
    if (h < uLowlandLevel)
        return mix(vec3(0.22,0.44,0.14), vec3(0.15,0.34,0.09),
                   (h - uShorelineLevel) / (uLowlandLevel - uShorelineLevel));
    if (h < uHighlandLevel)
        return mix(vec3(0.15,0.34,0.09), vec3(0.42,0.36,0.26),
                   (h - uLowlandLevel) / (uHighlandLevel - uLowlandLevel));
    if (h < uSnowlineLevel)
        return mix(vec3(0.42,0.36,0.26), vec3(0.70,0.70,0.70),
                   (h - uHighlandLevel) / (uSnowlineLevel - uHighlandLevel));
    return mix(vec3(0.70,0.70,0.70), vec3(0.95,0.96,1.00),
               (h - uSnowlineLevel) / (1.0 - uSnowlineLevel));
}

void main() {
    float phi   = uPhiStart   +          vUv.x  * uDPhi;
    float theta = uThetaStart + (1.0 - vUv.y) * uDTheta;
    float sinT  = sin(theta);
    vec3 spherePos = vec3(-cos(phi)*sinT, cos(theta), sin(phi)*sinT);

    // ── Base terrain ──────────────────────────────────────────────────────────
    float height = computeHeight(spherePos);

    // Surface normal: terrain-displaced for land, flat sphere for water
    vec3 normal;
    if (height > uShorelineLevel) {
        normal = computeNormal(spherePos);
    } else {
        normal = spherePos;
    }

    // Diffuse sun lighting — pow(diff,2) softens the terminator (matches planet shader)
    float diff  = max(0.0, dot(normal, SUN_DIR));
    float light = AMBIENT_LIGHT + (1.0 - AMBIENT_LIGHT) * pow(diff, 2.0);

    vec3  baseColor = terrainColor(height) * light * uBaseEnabled;

    // Ocean sun-sheen: concentrate extra brightness near the subsolar point
    float oceanFactor = 1.0 - smoothstep(uDeepOceanLevel, uShorelineLevel, height);
    float oceanDiff   = max(0.0, dot(spherePos, SUN_DIR));
    float sheen       = oceanFactor * pow(oceanDiff, 5.0) * 0.45;
    baseColor        += vec3(0.20, 0.40, 0.70) * sheen * uBaseEnabled;

    // ── Ice layer — independent fBm, modulated by |cos(latitude)| ─────────────
    float iceNoise    = fbm(spherePos * uIceScale + vec3(53.7, 12.3, 87.4));
    float latFactor   = pow(abs(spherePos.y), max(0.01, uIceAzimuth));
    float iceAlpha    = clamp(iceNoise * latFactor * uIceOpacity, 0.0, 1.0) * uIceEnabled;
    float gradT       = clamp((iceAlpha - uIceClearLevel) / max(0.001, uIceIceLevel - uIceClearLevel), 0.0, 1.0);
    vec3  iceColor    = mix(uIceClearColor, uIceIceColor, gradT);
    float iceFinalAlpha = mix(uIceClearAlpha, uIceIceAlpha, gradT) * iceAlpha;

    vec3 finalColor;
    if      (uIceBlendMode < 0.5) finalColor = mix(baseColor, iceColor * light, iceFinalAlpha);
    else if (uIceBlendMode < 1.5) finalColor = 1.0 - (1.0 - baseColor) * (1.0 - iceColor * light * iceFinalAlpha);
    else if (uIceBlendMode < 2.5) finalColor = mix(baseColor, baseColor * iceColor * light, iceFinalAlpha);
    else                          finalColor = clamp(baseColor + iceColor * light * iceFinalAlpha, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, 1.0);
}`;

export class TerrainGen {
    private _scene  = new Scene();
    private _camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private _mat:   ShaderMaterial;
    private _mesh:  Mesh;
    params: TerrainParams = { ...DEFAULT_TERRAIN_PARAMS };

    constructor(private _renderer: WebGLRenderer, private _size: number) {
        const p = this.params;
        this._mat = new ShaderMaterial({
            vertexShader: VERT,
            fragmentShader: FRAG,
            uniforms: {
                uPhiStart:       { value: 0 },
                uDPhi:           { value: 0 },
                uThetaStart:     { value: 0 },
                uDTheta:         { value: 0 },
                uFeatureScale:   { value: p.featureScale },
                uLacunarity:     { value: p.lacunarity },
                uPersistence:    { value: p.persistence },
                uHeightCurve:    { value: p.heightCurve },
                uLayer2Scale:    { value: p.layer2Scale },
                uContinentalBias:{ value: p.continentalBias },
                uDeepOceanLevel: { value: p.deepOceanLevel },
                uShorelineLevel: { value: p.shorelineLevel },
                uLowlandLevel:   { value: p.lowlandLevel },
                uHighlandLevel:  { value: p.highlandLevel },
                uSnowlineLevel:  { value: p.snowlineLevel },
                uBaseEnabled:    { value: p.baseEnabled },
                uIceEnabled:     { value: p.iceEnabled },
                uIceScale:       { value: p.iceScale },
                uIceAzimuth:     { value: p.iceAzimuth },
                uIceOpacity:     { value: p.iceOpacity },
                uIceBlendMode:   { value: p.iceBlendMode },
                uIceClearColor:  { value: new Color(p.iceClearColor) },
                uIceClearAlpha:  { value: p.iceClearAlpha },
                uIceIceColor:    { value: new Color(p.iceIceColor) },
                uIceIceAlpha:    { value: p.iceIceAlpha },
                uIceClearLevel:  { value: p.iceClearLevel },
                uIceIceLevel:    { value: p.iceIceLevel },
            },
        });
        this._mesh = new Mesh(new PlaneGeometry(2, 2), this._mat);
        this._scene.add(this._mesh);
    }

    setParams(params: Partial<TerrainParams>): void {
        Object.assign(this.params, params);
        const u = this._mat.uniforms;
        const p = this.params;
        u.uFeatureScale.value    = p.featureScale;
        u.uLacunarity.value      = p.lacunarity;
        u.uPersistence.value     = p.persistence;
        u.uHeightCurve.value     = p.heightCurve;
        u.uLayer2Scale.value     = p.layer2Scale;
        u.uContinentalBias.value = p.continentalBias;
        u.uDeepOceanLevel.value  = p.deepOceanLevel;
        u.uShorelineLevel.value  = p.shorelineLevel;
        u.uLowlandLevel.value    = p.lowlandLevel;
        u.uHighlandLevel.value   = p.highlandLevel;
        u.uSnowlineLevel.value   = p.snowlineLevel;
        u.uBaseEnabled.value     = p.baseEnabled;
        u.uIceEnabled.value      = p.iceEnabled;
        u.uIceScale.value        = p.iceScale;
        u.uIceAzimuth.value      = p.iceAzimuth;
        u.uIceOpacity.value      = p.iceOpacity;
        u.uIceBlendMode.value    = p.iceBlendMode;
        (u.uIceClearColor.value as Color).set(p.iceClearColor);
        u.uIceClearAlpha.value   = p.iceClearAlpha;
        (u.uIceIceColor.value as Color).set(p.iceIceColor);
        u.uIceIceAlpha.value     = p.iceIceAlpha;
        u.uIceClearLevel.value   = p.iceClearLevel;
        u.uIceIceLevel.value     = p.iceIceLevel;
    }

    generate(phiStart: number, dPhi: number, thetaStart: number, dTheta: number): WebGLRenderTarget {
        this._mat.uniforms.uPhiStart.value   = phiStart;
        this._mat.uniforms.uDPhi.value       = dPhi;
        this._mat.uniforms.uThetaStart.value = thetaStart;
        this._mat.uniforms.uDTheta.value     = dTheta;

        const rt   = new WebGLRenderTarget(this._size, this._size, { depthBuffer: false });
        const prev = this._renderer.getRenderTarget();
        this._renderer.setRenderTarget(rt);
        this._renderer.render(this._scene, this._camera);
        this._renderer.setRenderTarget(prev);
        return rt;
    }

    dispose(): void {
        this._mat.dispose();
        (this._mesh.geometry as PlaneGeometry).dispose();
    }
}
