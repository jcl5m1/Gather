
import * as THREE from 'three';
import { Trajectory, TrajectoryParameters, TimeWarpLUT } from './trajectory';

/**
 * Handles GPU-accelerated batch computation of orbit positions
 */
export class GPUOrbitCompute {

    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private material: THREE.ShaderMaterial;
    private renderTarget: THREE.WebGLRenderTarget | null = null;
    private outputBuffer: Float32Array | null = null;
    private initialized: boolean = false;

    // Data textures
    private lutTexture: THREE.DataTexture | null = null;
    private curvesTexture: THREE.DataTexture | null = null;

    constructor() {
        // Create a dedicated offscreen renderer or reuse existing? 
        // We'll create a minimal one for compute, but ideally we should reuse the main one context.
        // For this demo, let's assume we can access the global renderer or create a small one.
        // Assuming we need to pass the renderer in. 
        // BUT, creating a new WebGLRenderer is expensive and might lose context if limited.
        // Let's rely on the main app passing it or finding it.
        // For now, we will require the renderer to be passed in compute method or init.

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // geometry: full screen quad
        const geometry = new THREE.PlaneGeometry(2, 2);

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uInputTimes: { value: null }, // Data Texture of time samples
                uLutData: { value: null },    // Data Texture of LUT (M, T, p1, p2)
                uCurvesData: { value: null }, // Data Texture of Curves (p0, p1, p2, p3)
                uLutSize: { value: 0 },
                uNumCurves: { value: 0 },
                uDataSize: { value: new THREE.Vector2(0, 0) } // Width/Height of input texture
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uInputTimes;
                uniform sampler2D uLutData;
                uniform sampler2D uCurvesData;
                uniform int uLutSize;
                uniform int uNumCurves;
                uniform vec2 uDataSize;
                
                varying vec2 vUv;

                // Helper to read float from RGBA texture (simple encoding for now, assuming float texture support)
                // We assume usage of FloatType textures.

                // LUT Data Structure (Width = uLutSize, Height = 1)
                // Accessing index i:
                // We need more than 1 pixel per entry if using standard RGBA?
                // M, T, p1, p2 fit in one RGBA pixel! 
                // R=M, G=T, B=p1, A=p2. Perfect.

                // Curves Data Structure (Width = uNumCurves, Height = 1?)
                // Each curve has 4 points (vec3). 12 floats.
                // Pack into 3 pixels? 
                // Pixel 0: P0.xyz, P1.x
                // Pixel 1: P1.yz, P2.xy
                // Pixel 2: P2.z, P3.xyz -> This is getting messy.
                // Alternative: 4 pixels per curve. 
                // Pixel 0: P0 (rgb), unused (a)
                // Pixel 1: P1 (rgb), unused (a) ...
                // Texture width = uNumCurves * 4.

                vec3 getCurvePoint(int curveIndex, int pointIndex) {
                    float texWidth = float(uNumCurves * 4);
                    // int textureIndex = curveIndex * 4 + pointIndex;
                    // float u = (float(textureIndex) + 0.5) / texWidth;
                    // return texture2D(uCurvesData, vec2(u, 0.5)).rgb;
                    
                    // Optimization: Use texelFetch if available (GLSL 3.0), but sticking to standard WebGL 1/2 compat
                    float u = (float(curveIndex * 4 + pointIndex) + 0.5) / texWidth;
                    return texture2D(uCurvesData, vec2(u, 0.5)).rgb;
                }

                void main() {
                    // 1. Get Input Time t from texture
                    // vUv corresponds to the output pixel (which maps 1:1 to input time sample)
                    // Be careful with UV alignment.
                    // gl_FragCoord.xy
                    
                    vec4 timeSample = texture2D(uInputTimes, vUv);
                    float t = timeSample.r; // Assuming time is in Red channel
                    
                    // Clamp t
                    t = clamp(t, 0.0, 1.0);

                    // 2. Time Warp (LUT lookup)
                    // t is normalized M (relative to Apoapsis in existing logic?)
                    // Logic from trajectory.ts:
                    // t = normalizedT
                    
                    float warpedT = t;
                    bool isMirrored = false;
                    
                    if (t > 0.5) {
                        warpedT = 1.0 - t;
                        isMirrored = true;
                    }
                    
                    // Binary Search in LUT
                    // uLutData is 1D texture of size uLutSize
                    // We search for M (Red channel)
                    
                    int left = 0;
                    int right = uLutSize - 1;
                    
                    // GLSL loops must be unrolled or simple. Binary search might be heavy?
                    // Max iterations log2(uLutSize). For 128 items = 7 iters. Safe.
                    
                    for (int i = 0; i < 16; i++) {
                         if (right - left <= 1) break;
                         int mid = (left + right) / 2;
                         float uMid = (float(mid) + 0.5) / float(uLutSize);
                         float mVal = texture2D(uLutData, vec2(uMid, 0.5)).r;
                         
                         if (mVal <= warpedT) {
                             left = mid;
                         } else {
                             right = mid;
                         }
                    }
                    
                    float uLeft = (float(left) + 0.5) / float(uLutSize);
                    float uRight = (float(right) + 0.5) / float(uLutSize);
                    
                    vec4 dataLeft = texture2D(uLutData, vec2(uLeft, 0.5));
                    vec4 dataRight = texture2D(uLutData, vec2(uRight, 0.5));
                    
                    float M0 = dataLeft.r;
                    float T0 = dataLeft.g;
                    // p1, p2 are in B, A of LEFT pixel? 
                    // Wait, logic says pts comes from left node.
                    float p1 = dataLeft.b;
                    float p2 = dataLeft.a;
                    
                    float M1 = dataRight.r;
                    float T1 = dataRight.g;
                    
                    // Linear fallback
                    float resultT = T0 + (T1 - T0) * ((warpedT - M0) / (M1 - M0));
                    
                    // Cubic interpolation
                    // Assuming we always want cubic here as requested "bezier time warp"
                    float uMap = (warpedT - M0) / (M1 - M0);
                    float oneMinusU = 1.0 - uMap;
                    
                    resultT = (oneMinusU * oneMinusU * oneMinusU) * T0 +
                              3.0 * (oneMinusU * oneMinusU) * uMap * p1 +
                              3.0 * oneMinusU * (uMap * uMap) * p2 +
                              (uMap * uMap * uMap) * T1;
                              
                    if (isMirrored) {
                        resultT = 1.0 - resultT;
                    }
                    
                    // 3. Spatial Bezier Evaluation
                    // resultT is normalized time (0-1) across all curves
                    
                    float totalProgress = resultT * float(uNumCurves);
                    float curveIndexFloat = floor(totalProgress);
                    int curveIndex = int(curveIndexFloat);
                    
                    // Wrap/Clamp
                    if (curveIndex >= uNumCurves) curveIndex = uNumCurves - 1;
                    if (curveIndex < 0) curveIndex = 0;
                    
                    float tSpatial = totalProgress - curveIndexFloat;
                    
                    // Fetch control points
                    vec3 P0 = getCurvePoint(curveIndex, 0);
                    vec3 P1 = getCurvePoint(curveIndex, 1);
                    vec3 P2 = getCurvePoint(curveIndex, 2);
                    vec3 P3 = getCurvePoint(curveIndex, 3);
                    
                    // Compute Bezier
                    float mt = 1.0 - tSpatial;
                    float mt2 = mt * mt;
                    float mt3 = mt2 * mt;
                    float t2 = tSpatial * tSpatial;
                    float t3 = t2 * tSpatial;
                    
                    vec3 pos = mt3 * P0 +
                               3.0 * mt2 * tSpatial * P1 +
                               3.0 * mt * t2 * P2 +
                               t3 * P3;
                               
                    gl_FragColor = vec4(pos, 1.0);
                }
            `
        });

        this.mesh = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.mesh);
    }

    public compute(
        renderer: THREE.WebGLRenderer,
        times: number[],
        lut: TimeWarpLUT,
        bezierCurves: any[]
    ): Float32Array | null {
        if (times.length === 0) return null;

        // Setup Output Texture
        // Determine size: closest square power of 2? Or just width=N, height=1 if texture limits allow?
        // 1,000,000 samples -> 1000x1000 texture. Safe.
        const width = Math.ceil(Math.sqrt(times.length));
        const height = Math.ceil(times.length / width);

        if (!this.renderTarget || this.renderTarget.width !== width || this.renderTarget.height !== height) {
            this.renderTarget?.dispose();
            this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
                type: THREE.FloatType, // Important for storing position values > 1
                format: THREE.RGBAFormat,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                generateMipmaps: false
            });
        }

        // 1. Upload Inputs
        if (!this.prepareInputTexture(times, width, height)) return null;
        if (!this.prepareLUTTexture(lut)) return null;
        if (!this.prepareCurvesTexture(bezierCurves)) return null;

        // 2. Render
        this.material.uniforms.uLutSize.value = lut.M.length;
        this.material.uniforms.uNumCurves.value = bezierCurves.length;
        this.material.uniforms.uDataSize.value.set(width, height);

        const oldTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(this.renderTarget);
        renderer.render(this.scene, this.camera);
        renderer.setRenderTarget(oldTarget);

        // 3. Readback
        const totalPixels = width * height;
        const readBuffer = new Float32Array(totalPixels * 4);

        renderer.readRenderTargetPixels(this.renderTarget, 0, 0, width, height, readBuffer);

        // Extract relevant data (ignore padding pixels) and pack into (x,y,z) array?
        // Or keep as rgba?
        // Benchmark likely expects processed positions.
        // Let's return just the requested samples (first times.length)
        // Since we are measuring compute time including overhead, keeping it raw Float32Array (RGBA) is simplest,
        // but to be fair with CPU, CPU returns Array<Vector3>. 
        // We will just return the raw buffer and let caller interpret, or strip alpha.

        return readBuffer;
    }

    private prepareInputTexture(times: number[], width: number, height: number): boolean {
        // reuse texture if size match?
        const size = width * height;
        const data = new Float32Array(size * 4); // RGBA

        for (let i = 0; i < times.length; i++) {
            const stride = i * 4;
            data[stride] = times[i];
            // g,b,a unused
        }

        const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
        texture.needsUpdate = true;

        this.material.uniforms.uInputTimes.value = texture;
        return true;
    }

    private prepareLUTTexture(lut: TimeWarpLUT): boolean {
        // Reuse if LUT hasn't changed? For now rebuild.
        const size = lut.M.length;
        const data = new Float32Array(size * 4);

        for (let i = 0; i < size; i++) {
            const stride = i * 4;
            data[stride] = lut.M[i];     // R = M
            data[stride + 1] = lut.bezierT[i]; // G = T

            // P1, P2
            // bezierPoints[i] contains control points for interval starting at i
            // The shader logic expects p1, p2 at the 'left' index
            if (i < lut.bezierPoints.length) {
                data[stride + 2] = lut.bezierPoints[i].p1;
                data[stride + 3] = lut.bezierPoints[i].p2;
            } else {
                // Last point boundary
                data[stride + 2] = 0; // Don't care
                data[stride + 3] = 0;
            }
        }

        const texture = new THREE.DataTexture(data, size, 1, THREE.RGBAFormat, THREE.FloatType);
        texture.needsUpdate = true;

        this.material.uniforms.uLutData.value = texture;
        return true;
    }

    private prepareCurvesTexture(curves: any[]): boolean {
        const numCurves = curves.length;
        const width = numCurves * 4; // 4 pixels per curve
        const data = new Float32Array(width * 4);

        for (let i = 0; i < numCurves; i++) {
            const curve = curves[i];
            // curve.points = {p0, p1, p2, p3} (Vector3)

            // Pixel 0: P0
            let stride = (i * 4 + 0) * 4;
            data[stride] = curve.points.p0.x;
            data[stride + 1] = curve.points.p0.y;
            data[stride + 2] = curve.points.p0.z;

            // Pixel 1: P1
            stride = (i * 4 + 1) * 4;
            data[stride] = curve.points.p1.x;
            data[stride + 1] = curve.points.p1.y;
            data[stride + 2] = curve.points.p1.z;

            // Pixel 2: P2
            stride = (i * 4 + 2) * 4;
            data[stride] = curve.points.p2.x;
            data[stride + 1] = curve.points.p2.y;
            data[stride + 2] = curve.points.p2.z;

            // Pixel 3: P3
            stride = (i * 4 + 3) * 4;
            data[stride] = curve.points.p3.x;
            data[stride + 1] = curve.points.p3.y;
            data[stride + 2] = curve.points.p3.z;
        }

        const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
        texture.needsUpdate = true;

        this.material.uniforms.uCurvesData.value = texture;
        return true;
    }

    public dispose() {
        if (this.renderTarget) this.renderTarget.dispose();
        if (this.material) this.material.dispose();
        if (this.mesh && this.mesh.geometry) this.mesh.geometry.dispose();
    }
}
