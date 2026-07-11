/**
 * Minimal truck orientation test.
 * Two endpoints 100 m apart on a NE–SW axis; one truck running the exact
 * same TruckTransport logic as the main game.  Camera uses the same
 * ZoomController + DragOrbitHandler as index.ts.
 *
 * URL: http://<host>:9000/testTruck.html
 */

import {
    Scene, Vector3, WebGLRenderer, PerspectiveCamera,
    Mesh, MeshStandardMaterial, AmbientLight, DirectionalLight,
    SphereGeometry, BufferGeometry, Line, LineBasicMaterial,
} from 'three';
import { R } from './constants';
import { KSC_NORMAL } from './world';
import { RESOURCES } from './resource';
import { TruckTransport } from './transport';
import { TransportRequest } from './transportRequest';
import { ZoomController } from './zoomController';
import { DragOrbitHandler } from './dragOrbitHandler';

// ── Route: dest = KSC (SW), source = 100 m NE of KSC ────────────────────

const KSC_LAT = 28.5728 * Math.PI / 180;
const KSC_LON = -80.6490 * Math.PI / 180;

const northTangent = new Vector3(
    -Math.sin(KSC_LAT) * Math.cos(KSC_LON),
     Math.cos(KSC_LAT),
     Math.sin(KSC_LAT) * Math.sin(KSC_LON),
).normalize();

const eastTangent = new Vector3(
    -Math.cos(KSC_LAT) * Math.sin(KSC_LON),
     0,
    -Math.cos(KSC_LAT) * Math.cos(KSC_LON),
).normalize();

const neTangent = northTangent.clone().add(eastTangent).normalize();

const ROUTE_M      = 100;
const destNormal   = KSC_NORMAL.clone();
const sourceNormal = KSC_NORMAL.clone()
    .addScaledVector(neTangent, ROUTE_M / R)
    .normalize();

// ── Resources: keep permanently full so the truck never stops ────────────

const wood = RESOURCES.find(r => r.name === 'Wood')!;
const coal = RESOURCES.find(r => r.name === 'Coal')!;

// ── Renderer ──────────────────────────────────────────────────────────────

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// ── Scene ─────────────────────────────────────────────────────────────────

const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 0.6));
const sun = new DirectionalLight(0xffffff, 1.0);
sun.position.set(R * 3, R * 4, R * 1.5);
scene.add(sun);

scene.add(new Mesh(
    new SphereGeometry(R - 100, 64, 64),
    new MeshStandardMaterial({ color: 0x1a4c20, roughness: 1.0 }),
));

const routeGeo = new BufferGeometry().setFromPoints([
    destNormal.clone().multiplyScalar(R + 5),
    sourceNormal.clone().multiplyScalar(R + 5),
]);
scene.add(new Line(routeGeo, new LineBasicMaterial({ color: 0x888888 })));

// ── Truck ─────────────────────────────────────────────────────────────────

const truck = new TruckTransport(scene, coal, destNormal);
// A never-ending haul request so the truck loops the fixed route forever.
const req = new TransportRequest(destNormal, 'Dest', wood, 1e12);

// ── Camera + shared controllers ───────────────────────────────────────────

// startIdx=0 → 'pico' (600 m), appropriate for a 100 m route
const zoom      = new ZoomController(0);
const camera    = new PerspectiveCamera(zoom.fov, innerWidth / innerHeight, 1, 5e7);
const dragOrbit = new DragOrbitHandler(camera, zoom, scene, renderer.domElement);

zoom.initCamera(camera);

// ── Camera-up helper (same as index.ts) ───────────────────────────────────

const _pNorm  = new Vector3();
const _north  = new Vector3();
const _worldY = new Vector3(0, 1, 0);

function updateCameraUp(): void {
    _pNorm.copy(camera.position).normalize();
    _north.copy(_worldY).addScaledVector(_pNorm, -_worldY.dot(_pNorm));
    if (_north.lengthSq() > 0.001) camera.up.copy(_north.normalize());
}

// ── Screen-space dot projection ───────────────────────────────────────────

const dotDst = document.getElementById('dot-dst') as HTMLElement;
const dotSrc = document.getElementById('dot-src') as HTMLElement;

const _srcWorld = sourceNormal.clone().multiplyScalar(R + 5);
const _dstWorld = destNormal.clone().multiplyScalar(R + 5);
const _ndc      = new Vector3();

function projectDot(worldPos: Vector3, el: HTMLElement): void {
    _ndc.copy(worldPos).project(camera);
    el.style.left    = `${( _ndc.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top     = `${(-_ndc.y * 0.5 + 0.5) * innerHeight}px`;
    el.style.display = _ndc.z > 1 ? 'none' : 'block';
}

// ── Pause control ─────────────────────────────────────────────────────────

let paused = false;
const pauseBtn = document.getElementById('btn-pause')!;
pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶' : '⏸';
});

const statusEl = document.getElementById('status')!;

// ── Render loop ───────────────────────────────────────────────────────────

let lastTime = performance.now();

function animate(): void {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt  = paused ? 0 : Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    // Camera lerp — same as index.ts
    camera.position.lerp(zoom.targetPos, dragOrbit.isDragging ? 0.5 : 0.07);
    zoom.currentLook.lerp(zoom.targetLook, 0.07);
    const _h = Math.max(1, camera.position.length() - R);
    camera.near = Math.max(1, (_h * _h) / 8.55e8);
    camera.updateProjectionMatrix();
    updateCameraUp();
    camera.lookAt(zoom.currentLook);
    camera.updateMatrixWorld();

    // Project endpoint dots (camera at real position, before precision shift)
    projectDot(_dstWorld, dotDst);
    projectDot(_srcWorld, dotSrc);

    // Keep resources full — truck must never stop
    if (wood.gathered < 1e10) wood.gathered = 1e10;
    if (coal.gathered < 1e10) coal.gathered = 1e10;

    // Keep the request perpetually open so the truck re-runs the route.
    req.qtyDelivered = 0;
    req.qtyInFlight  = 0;
    if (truck.isIdle) truck.assignJob(req, sourceNormal);

    const { load } = truck.update(dt);
    if (load) truck.setLoaded(load.payload);

    const t     = (truck as any).t     as number;
    const spd   = (truck as any).speed as number;
    const state = truck.jobPhase;
    statusEl.textContent =
        `${state}  ·  t=${t.toFixed(3)}  ·  ${spd.toFixed(1)} m/s` +
        (paused ? '  · PAUSED' : '');

    // Precision shift — same as index.ts
    const camPos = camera.position.clone();
    scene.position.set(-camPos.x, -camPos.y, -camPos.z);
    camera.position.set(0, 0, 0);
    renderer.render(scene, camera);
    camera.position.copy(camPos);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    dragOrbit.update();
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});
