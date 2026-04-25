import {
    PerspectiveCamera, Vector3, MathUtils,
    Scene, Mesh, SphereGeometry, MeshBasicMaterial,
    Raycaster, Vector2, Sphere,
} from 'three';
import { R } from './constants';
import { ZoomController } from './zoomController';

const DRAG_THRESHOLD_PX = 8;

// Module-level reusable temps (single-threaded, no re-entrancy)
const _backward  = new Vector3();
const _north     = new Vector3();
const _right     = new Vector3();
const _up        = new Vector3();
const _worldY    = new Vector3(0, 1, 0);
const _ndc       = new Vector3();
const _dP        = new Vector3();
const _cn        = new Vector3();
const _nDir      = new Vector3();
const _eDir      = new Vector3();
const _Cn        = new Vector3();
const _Ce        = new Vector3();

export class DragOrbitHandler {
    private get halfFovTan(): number {
        return Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    }

    // Red 3-D sphere fixed at the touch-start Earth intersection
    private raycaster   = new Raycaster();
    private pointer     = new Vector2();
    private earthSphere = new Sphere(new Vector3(0, 0, 0), R);
    private hitMarker:  Mesh;

    // White 2-D ring that follows the live touch position
    private touchRing: HTMLDivElement;

    // Debug text overlay
    private debugLabel: HTMLDivElement;

    private dragging      = false;
    private mouseDown     = false;
    private startX        = 0;
    private startY        = 0;
    private currentCx     = 0;
    private currentCy     = 0;
    private tapInfo:      string[] = [];
    private tileInfo = '';

    private pinching      = false;
    private lastPinchDist = 0;

    constructor(
        private camera: PerspectiveCamera,
        private zoom: ZoomController,
        scene: Scene,
        canvas: HTMLCanvasElement,
        private onPanEnd?: () => void,
    ) {
        this.hitMarker = new Mesh(
            new SphereGeometry(1, 16, 16),
            new MeshBasicMaterial({ color: 0xff2222 }),
        );
        this.hitMarker.visible = false;
        scene.add(this.hitMarker);

        this.touchRing = document.createElement('div');
        Object.assign(this.touchRing.style, {
            position:      'fixed',
            width:         '40px',
            height:        '40px',
            borderRadius:  '50%',
            border:        '2px solid rgba(255,255,255,0.85)',
            pointerEvents: 'none',
            display:       'none',
            transform:     'translate(-50%, -50%)',
            zIndex:        '999',
        });
        document.body.appendChild(this.touchRing);

        this.debugLabel = document.createElement('div');
        Object.assign(this.debugLabel.style, {
            position:   'fixed',
            top:        '8px',
            left:       '8px',
            color:      '#0f0',
            fontSize:   '12px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            display:    'block',
            zIndex:     '1000',
            background: 'rgba(0,0,0,0.55)',
            padding:    '4px 6px',
            lineHeight: '1.5',
            whiteSpace: 'pre',
        });
        document.body.appendChild(this.debugLabel);

        canvas.addEventListener('touchstart', e => {
            if (e.touches.length === 2) {
                this.pinching = true;
                this.dragging = false;
                this.lastPinchDist = Math.hypot(
                    e.touches[1].clientX - e.touches[0].clientX,
                    e.touches[1].clientY - e.touches[0].clientY,
                );
                return;
            }
            this.pinching = false;
            this.onStart(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });

        canvas.addEventListener('touchmove', e => {
            if (this.pinching && e.touches.length === 2) {
                const dist = Math.hypot(
                    e.touches[1].clientX - e.touches[0].clientX,
                    e.touches[1].clientY - e.touches[0].clientY,
                );
                if (this.lastPinchDist > 0) {
                    this.zoom.setHeightDirect(this.zoom.targetHeight * (this.lastPinchDist / dist));
                }
                this.lastPinchDist = dist;
                e.preventDefault();
                return;
            }
            if (!this.pinching) {
                this.onMove(e.touches[0].clientX, e.touches[0].clientY);
                if (this.dragging) e.preventDefault();
            }
        }, { passive: false });

        canvas.addEventListener('touchend', e => {
            if (e.touches.length < 2) this.pinching = false;
            if (e.touches.length === 0) this.onEnd();
        });

        canvas.addEventListener('mousedown', e => {
            this.mouseDown = true;
            this.onStart(e.clientX, e.clientY);
        });
        canvas.addEventListener('mousemove', e => {
            if (this.mouseDown) this.onMove(e.clientX, e.clientY);
        });
        canvas.addEventListener('mouseup', () => {
            this.mouseDown = false;
            this.onEnd();
        });
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const factor = 1 - Math.sign(e.deltaY) * 0.075;
            this.zoom.setHeightDirect(this.zoom.targetHeight * factor);
        }, { passive: false });
    }

    get isDragging(): boolean { return this.dragging; }

    setTapInfo(lines: string[]): void { this.tapInfo = lines; }
    setTileInfo(text: string): void { this.tileInfo = text; }

    private rayDir(pos: Vector3, cx: number, cy: number): Vector3 {
        _backward.copy(pos).normalize();
        _north.copy(_worldY).addScaledVector(_backward, -_worldY.dot(_backward)).normalize();
        _right.crossVectors(_north, _backward).normalize();
        _up.crossVectors(_backward, _right);

        const nx     = (2 * cx / window.innerWidth)  - 1;
        const ny     = 1 - (2 * cy / window.innerHeight);
        const aspect = window.innerWidth / window.innerHeight;

        return _backward.clone().negate()
            .addScaledVector(_right, nx * this.halfFovTan * aspect)
            .addScaledVector(_up,    ny * this.halfFovTan)
            .normalize();
    }

    // Project world point P onto screen from an arbitrary camera position camPos
    // (camera always looks at origin). Returns [screenX, screenY].
    private projectPoint(P: Vector3, camPos: Vector3): [number, number] {
        _cn.copy(camPos).normalize();                                   // backward (toward sky)
        _north.copy(_worldY).addScaledVector(_cn, -_cn.y).normalize(); // north/up
        if (_north.lengthSq() < 0.01) _north.set(1, 0, 0);            // pole fallback
        _right.crossVectors(_north, _cn).normalize();                  // screen right
        _up.crossVectors(_cn, _right);                                 // screen up

        _dP.subVectors(P, camPos);
        const depth = -_dP.dot(_cn);   // positive when P is in front of camera
        if (depth <= 0) return [0, 0];

        const aspect = window.innerWidth / window.innerHeight;
        const sx = _dP.dot(_right) / (depth * this.halfFovTan * aspect);
        const sy = _dP.dot(_up)    / (depth * this.halfFovTan);

        return [
            (sx + 1) * 0.5 * window.innerWidth,
            (1 - sy) * 0.5 * window.innerHeight,
        ];
    }

    private projectToScreen(p: Vector3): [number, number] {
        _ndc.copy(p).project(this.camera);
        return [
            ( _ndc.x + 1) / 2 * window.innerWidth,
            (1 - _ndc.y) / 2 * window.innerHeight,
        ];
    }

    // Always places the hitMarker. If the ray misses the Earth, falls back to
    // the nearest point on the Earth sphere to the ray.
    private placeHitMarker(cx: number, cy: number): void {
        this.pointer.set(
            (2 * cx / window.innerWidth)  - 1,
            1 - (2 * cy / window.innerHeight),
        );
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const hit = new Vector3();
        if (!this.raycaster.ray.intersectSphere(this.earthSphere, hit)) {
            // Ray misses Earth — project closest ray point onto the Earth sphere
            const dir = this.raycaster.ray.direction;
            const t0  = Math.max(0, -this.camera.position.dot(dir));
            hit.copy(this.camera.position).addScaledVector(dir, t0).normalize().multiplyScalar(R);
        }

        const dist = this.camera.position.distanceTo(hit);
        this.hitMarker.scale.setScalar(dist * this.halfFovTan * 20 / window.innerHeight);
        this.hitMarker.position.copy(hit);
        this.hitMarker.visible = true;
    }

    private moveTouchRing(cx: number, cy: number): void {
        this.touchRing.style.left    = `${cx}px`;
        this.touchRing.style.top     = `${cy}px`;
        this.touchRing.style.display = 'block';
    }

    private onStart(cx: number, cy: number): void {
        this.startX    = cx;
        this.startY    = cy;
        this.currentCx = cx;
        this.currentCy = cy;
        this.dragging  = false;
    }

    private onDragStart(cx: number, cy: number): void {
        this.zoom.targetLook.set(0, 0, 0);
        this.zoom.currentLook.set(0, 0, 0);
        this.placeHitMarker(cx, cy);
        this.moveTouchRing(cx, cy);
    }

    // Clamp (cx,cy) to 95% of the Earth silhouette radius from screen centre.
    // The silhouette is a circle of angular radius asin(R/d); when the camera
    // looks at the Earth centre (which onDragStart ensures) it projects as a
    // circle of pixel-radius = tan(asin(R/d)) / halfFovTan * screenH/2.
    private _clampToSilhouette(cx: number, cy: number): [number, number] {
        const d    = this.camera.position.length();
        const sinA = R / d;
        if (sinA >= 1) return [cx, cy];
        const tanA = sinA / Math.sqrt(1 - sinA * sinA);
        const rMax = tanA / this.halfFovTan * window.innerHeight * 0.5 * 0.95;
        const scx  = window.innerWidth  * 0.5;
        const scy  = window.innerHeight * 0.5;
        const dx   = cx - scx;
        const dy   = cy - scy;
        const dist = Math.hypot(dx, dy);
        if (dist <= rMax) return [cx, cy];
        return [scx + dx / dist * rMax, scy + dy / dist * rMax];
    }

    private onMove(cx: number, cy: number): void {
        if (!this.dragging) {
            if (Math.hypot(cx - this.startX, cy - this.startY) < DRAG_THRESHOLD_PX) return;
            this.dragging = true;
            this.onDragStart(this.startX, this.startY);
        }
        [cx, cy] = this._clampToSilhouette(cx, cy);
        this.currentCx = cx;
        this.currentCy = cy;
        this.moveTouchRing(cx, cy);
    }

    // Called every frame from the render loop (after render, so camera matrices are fresh).
    public update(): void {
        const dist = this.camera.position.length();
        const distStr = dist >= 1e6
            ? `${(dist / 1e6).toFixed(3)} Mm`
            : dist >= 1e3
                ? `${(dist / 1e3).toFixed(1)} km`
                : `${dist.toFixed(0)} m`;
        const heightM = Math.max(1, this.camera.position.length() - R);
        const heightStr = heightM >= 1e6
            ? `${(heightM / 1e6).toFixed(2)} Mm`
            : heightM >= 1e3
                ? `${(heightM / 1e3).toFixed(1)} km`
                : `${heightM.toFixed(0)} m`;

        if (!this.dragging) {
            const extra = this.tapInfo.length ? '\n\n' + this.tapInfo.join('\n') : '';
            const tile  = this.tileInfo ? '\n' + this.tileInfo : '';
            this.debugLabel.textContent = `height ${heightStr}\ndist   ${distStr}${tile}` + extra;
            return;
        }

        const P  = this.hitMarker.position;
        const cx = this.currentCx;
        const cy = this.currentCy;
        // Use the zoom controller's current radius — drag never changes distance.
        const r  = this.zoom.targetPos.length();

        // Gauss-Newton minimisation of screen-space distance² |proj(P,C) − (cx,cy)|²
        // on the orbit sphere |C| = r.  Always converges; handles the case where no
        // exact ray-through-P solution exists (cursor dragged off the Earth disc).
        let C = this.camera.position.clone().normalize().multiplyScalar(r);

        for (let iter = 0; iter < 8; iter++) {
            const [px, py] = this.projectPoint(P, C);
            const ex = cx - px;
            const ey = cy - py;
            if (ex * ex + ey * ey < 0.25) break;   // converged to sub-pixel

            // Tangent basis at C on the sphere
            _cn.copy(C).normalize();
            _nDir.copy(_worldY).addScaledVector(_cn, -_cn.y).normalize();
            if (_nDir.lengthSq() < 0.01) _nDir.set(1, 0, 0);
            _eDir.crossVectors(_nDir, _cn).normalize();

            // Finite-difference Jacobian.  eps scales with camera-to-P distance so
            // the perturbation is always a consistent fraction of the scene depth.
            const eps = Math.max(P.distanceTo(C) * 1e-3, 1.0);

            _Cn.copy(C).addScaledVector(_nDir, eps).normalize().multiplyScalar(r);
            _Ce.copy(C).addScaledVector(_eDir, eps).normalize().multiplyScalar(r);

            const [pxn, pyn] = this.projectPoint(P, _Cn);
            const [pxe, pye] = this.projectPoint(P, _Ce);

            // J = [[dpx/dn, dpx/de], [dpy/dn, dpy/de]]
            const jxx = (pxn - px) / eps,  jyx = (pyn - py) / eps;
            const jxy = (pxe - px) / eps,  jyy = (pye - py) / eps;

            // Gauss-Newton: solve (JᵀJ) δ = Jᵀ e
            const a = jxx*jxx + jyx*jyx;
            const b = jxx*jxy + jyx*jyy;
            const d = jxy*jxy + jyy*jyy;
            const rn = jxx*ex + jyx*ey;
            const re = jxy*ex + jyy*ey;

            const det = a * d - b * b;
            if (Math.abs(det) < 1e-30) break;

            let dn = (d * rn - b * re) / det;
            let de = (a * re - b * rn) / det;

            // Cap step to half the orbit circumference to prevent divergence
            const stepLen = Math.hypot(dn, de);
            const maxStep = r * Math.PI;
            if (stepLen > maxStep) { dn *= maxStep / stepLen; de *= maxStep / stepLen; }

            C.addScaledVector(_nDir, dn).addScaledVector(_eDir, de);
            C.normalize().multiplyScalar(r);
        }

        // C already has length = r (enforced inside the solver loop).
        // Copy it directly — r came from zoom.targetPos.length() so the radius is unchanged.
        this.zoom.targetPos.copy(C);

        const [rx, ry] = this.projectToScreen(P);
        const gap = Math.hypot(rx - cx, ry - cy);
        this.debugLabel.textContent =
            `height ${heightStr}\ndist   ${distStr}\n` +
            `red   (${rx.toFixed(0)}, ${ry.toFixed(0)})\n` +
            `ring  (${cx.toFixed(0)}, ${cy.toFixed(0)})\n` +
            `gap   ${gap.toFixed(1)} px`;
    }

    private onEnd(): void {
        if (this.dragging) this.onPanEnd?.();
        this.dragging = false;
        this.hitMarker.visible       = false;
        this.touchRing.style.display = 'none';
    }
}
