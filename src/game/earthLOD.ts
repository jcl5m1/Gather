/**
 * earthLOD.ts — seven-level recursive tiled grid.
 * L1 = 4×8; each level splits every tile into 4×4 children:
 * L2 = 16×32, L3 = 64×128, L4 = 256×512, L5 = 1024×2048, L6 = 4096×8192, L7 = 16384×32768, L8 = 65536×131072, L9 = 262144×524288.
 *
 * Per frame, for each active LOD level:
 *   1. Project camDir onto tile grid — O(1) seed.
 *   2. BFS outward, rejecting tiles past the geometric horizon OR outside
 *      the camera frustum.  Only truly on-screen tiles are spawned.
 *   3. Each tile gets a filled mesh + a white LineLoop border.
 */

import {
    Scene, Mesh, SphereGeometry, WebGLRenderer, WebGLRenderTarget,
    MeshBasicMaterial,
    Vector3,
    BufferGeometry, Float32BufferAttribute,
    Frustum, Matrix4, Sphere,
    PerspectiveCamera,
} from 'three';
import { R } from './constants';
import { TerrainGen, TerrainParams } from './terrainGen';

interface LodDef { Nr: number; Nc: number; hue: number; radius: number; }

const LODS: LodDef[] = [
    { Nr:      4, Nc:      8, hue:  50, radius: R - 150 },
    { Nr:     16, Nc:     32, hue: 185, radius: R - 100 },
    { Nr:     64, Nc:    128, hue: 270, radius: R -  70 },
    { Nr:    256, Nc:    512, hue:  30, radius: R -  40 },
    { Nr:   1024, Nc:   2048, hue: 340, radius: R -  10 },
    { Nr:   4096, Nc:   8192, hue: 120, radius: R -   5 },
    { Nr:  16384, Nc:  32768, hue: 300, radius: R -   2 },
    { Nr:   65536, Nc:  131072, hue:  10, radius: R -   1 },
    { Nr:  262144, Nc:  524288, hue: 200, radius: R -   1 },
];

const LOD_TRANSITION_DEG = 50;

const SEGS = [16, 12, 8, 6, 4, 3, 2, 2, 2];
const TEX  = 256;

// ── Utilities ─────────────────────────────────────────────────────────────────

function tileKey(l: number, r: number, c: number): string { return `${l}_${r}_${c}`; }

function tileDot(l: number, r: number, c: number, d: Vector3): number {
    const { Nr, Nc } = LODS[l];
    const phi   = 2 * Math.PI * (c + 0.5) / Nc;
    const theta =     Math.PI * (r + 0.5) / Nr;
    const sinT  = Math.sin(theta);
    return (-Math.cos(phi) * sinT) * d.x
         +  Math.cos(theta)        * d.y
         + ( Math.sin(phi) * sinT) * d.z;
}

// ── EarthLOD ──────────────────────────────────────────────────────────────────

interface Entry { mesh: Mesh; alpha: number; level: number; rt: WebGLRenderTarget; }

export class EarthLOD {
    private pool         = new Map<string, Entry>();
    private _camDir      = new Vector3();
    private _lastAlpha   = LODS.map(() => 0);
    private _lastHeight  = 1;
    private _visibleCount = 0;
    private _bakesThisFrame = 0;
    private _lastBakesPerFrame = 0;
    private _bakesPeak = 0;
    private _frustum     = new Frustum();
    private _vpMatrix    = new Matrix4();
    private _tileSphere  = new Sphere();
    private _tileCenter  = new Vector3();

    get activeLevel(): number {
        for (let l = LODS.length - 1; l > 0; l--)
            if (this._lastAlpha[l] > 0.5) return l + 1;
        return 1;
    }

    get visibleTileCount(): number { return this._visibleCount; }
    get bakesPerFrame(): number { return this._lastBakesPerFrame; }
    get bakesPeak(): number { return this._bakesPeak; }
    resetBakesPeak(): void { this._bakesPeak = 0; }

    get textureMemoryMB(): number {
        return this._visibleCount * TEX * TEX * 4 / (1024 * 1024);
    }

    get activeTileFovDeg(): number {
        const Nr = LODS[this.activeLevel - 1].Nr;
        const halfChord = R * Math.sin(Math.PI / (2 * Nr));
        return 2 * Math.atan2(halfChord, this._lastHeight) * 180 / Math.PI;
    }

    private _terrainGen: TerrainGen;

    constructor(private scene: Scene, renderer: WebGLRenderer) {
        this._terrainGen = new TerrainGen(renderer, TEX);
        scene.add(new Mesh(
            new SphereGeometry(R - 200, 64, 32),
            new MeshBasicMaterial({ color: 0x060d1a }),
        ));
    }

    setBaseTexture(): void {}

    setTerrainParams(params: Partial<TerrainParams>): void {
        this._terrainGen.setParams(params);
    }

    get terrainParams(): TerrainParams { return this._terrainGen.params; }

    regenerateTiles(): void {
        for (const [k, e] of this.pool) {
            const parts = k.split('_');
            const l = +parts[0], r = +parts[1], c = +parts[2];
            const { Nr, Nc } = LODS[l];
            const newRt = this._terrainGen.generate(
                2 * Math.PI * c / Nc, 2 * Math.PI / Nc,
                    Math.PI * r / Nr,     Math.PI / Nr,
            );
            e.rt.dispose();
            e.rt = newRt;
            (e.mesh.material as MeshBasicMaterial).map = newRt.texture;
            (e.mesh.material as MeshBasicMaterial).needsUpdate = true;
        }
    }

    update(camPos: Vector3, camera: PerspectiveCamera): void {
        this._bakesThisFrame = 0;
        const height = Math.max(1, camPos.length() - R);
        this._lastHeight = height;
        this._camDir.copy(camPos).normalize();

        // Build view-projection frustum from the live camera matrices.
        this._vpMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this._frustum.setFromProjectionMatrix(this._vpMatrix);

        const levelAlpha: number[] = [1];
        for (let l = 1; l < LODS.length; l++) {
            const { Nr } = LODS[l - 1];
            const fov = 2 * Math.atan2(R * Math.sin(Math.PI / (2 * Nr)), height) * 180 / Math.PI;
            levelAlpha.push(fov >= LOD_TRANSITION_DEG ? 1 : 0);
        }
        this._lastAlpha = levelAlpha;

        const horizonDot = Math.max(-0.5, R / (R + height));

        const wanted = new Set<string>();
        for (let l = 0; l < LODS.length; l++)
            if (levelAlpha[l] > 0.005)
                this._bfs(l, horizonDot, wanted);

        this._visibleCount = wanted.size;

        for (const k of wanted)
            if (!this.pool.has(k)) { this._spawn(k); this._bakesThisFrame++; }

        this._lastBakesPerFrame = this._bakesThisFrame;
        if (this._bakesThisFrame > this._bakesPeak) this._bakesPeak = this._bakesThisFrame;

        for (const [k, e] of this.pool) {
            const target = wanted.has(k) ? levelAlpha[e.level] : 0;
            e.alpha += (target - e.alpha) * 0.08;

            (e.mesh.material as MeshBasicMaterial).opacity = e.alpha;

            if (e.alpha < 0.005 && !wanted.has(k)) {
                this.scene.remove(e.mesh);
                (e.mesh.material as MeshBasicMaterial).dispose();
                e.mesh.geometry.dispose();
                e.rt.dispose();
                this.pool.delete(k);
            }
        }
    }

    /**
     * BFS from the seed tile outward.
     * A tile is rejected if:
     *   (a) its centre is past the geometric horizon (dot < horizonDot), OR
     *   (b) its bounding sphere does not intersect the camera frustum.
     */
    private _bfs(l: number, horizonDot: number, wanted: Set<string>): void {
        const { Nr, Nc, radius } = LODS[l];
        const d = this._camDir;

        let phi = Math.atan2(d.z, -d.x);
        if (phi < 0) phi += 2 * Math.PI;
        const theta = Math.acos(Math.max(-1, Math.min(1, d.y)));

        const r0 = Math.min(Nr - 1, Math.floor(theta * Nr / Math.PI));
        const c0 = Math.min(Nc - 1, Math.floor(phi   * Nc / (2 * Math.PI)));

        // Bounding-sphere radius: circumradius of tile patch (half-diagonal).
        // Tile spans PI/Nr in theta and PI/Nr in phi (Nc=2*Nr), so both half-extents
        // are PI/(2*Nr).  Exact corner-to-centre arc = acos(cos²(PI/(2*Nr))).
        // Use 1.1x oversize so tiles near the screen edge aren't incorrectly culled.
        const halfExt = Math.PI / (2 * Nr);
        const tileBS  = radius * Math.sin(Math.acos(Math.cos(halfExt) * Math.cos(halfExt))) * 1.1;

        const visited = new Set<number>();
        const queue: number[] = [r0 * Nc + c0];
        visited.add(r0 * Nc + c0);

        while (queue.length > 0) {
            const idx = queue.shift()!;
            const r   = Math.floor(idx / Nc);
            const c   = idx % Nc;

            // (a) Back-face / horizon cull — subtract halfExt margin so tiles whose
            // centre is just past the horizon are kept if their body is still visible.
            if (tileDot(l, r, c, d) < horizonDot - halfExt) continue;

            // (b) Frustum cull — bounding sphere centred at tile centre on sphere
            const pf   = 2 * Math.PI * (c + 0.5) / Nc;
            const tf   = Math.PI     * (r + 0.5) / Nr;
            const sinT = Math.sin(tf);
            this._tileCenter.set(-Math.cos(pf)*sinT*radius, Math.cos(tf)*radius, Math.sin(pf)*sinT*radius);
            this._tileSphere.set(this._tileCenter, tileBS);
            if (!this._frustum.intersectsSphere(this._tileSphere)) continue;

            wanted.add(tileKey(l, r, c));

            const nb = [
                r       * Nc + ((c - 1 + Nc) % Nc),
                r       * Nc + ((c + 1)      % Nc),
                r > 0      ? (r - 1) * Nc + c : -1,
                r < Nr - 1 ? (r + 1) * Nc + c : -1,
            ];
            for (const ni of nb)
                if (ni >= 0 && !visited.has(ni)) { visited.add(ni); queue.push(ni); }
        }
    }

    private _spawn(k: string): void {
        const parts = k.split('_');
        const l = +parts[0], r = +parts[1], c = +parts[2];
        const { Nr, Nc, radius } = LODS[l];
        const s = SEGS[l];

        const geo = new SphereGeometry(
            radius, s, s,
            2 * Math.PI * c / Nc, 2 * Math.PI / Nc,
                Math.PI * r / Nr,     Math.PI / Nr,
        );
        const rt  = this._terrainGen.generate(
            2 * Math.PI * c / Nc,  2 * Math.PI / Nc,
                Math.PI * r / Nr,      Math.PI / Nr,
        );
        const mat = new MeshBasicMaterial({
            map: rt.texture, transparent: true, opacity: 0, depthWrite: false,
        });
        const mesh = new Mesh(geo, mat);
        mesh.renderOrder = l + 1;
        this.scene.add(mesh);

        this.pool.set(k, { mesh, alpha: 0, level: l, rt });
    }
}
