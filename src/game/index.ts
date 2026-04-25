import { Scene, Vector3 } from 'three';
import { log, installGlobalErrorHandlers } from './logger';
import { RESOURCES } from './resource';
import { saveGame, loadGame, clearSave } from './saveState';
import { createRenderer, createCamera } from './scene';
import { addLighting, addStars, addEarth } from './earth';
import type { EarthLOD } from './earthLOD';
import { buildWorld } from './world';
import { KSC_NORMAL } from './world';
import { ZoomController } from './zoomController';
import { HUD } from './hud';
import { Flash } from './flash';
import { InputHandler } from './inputHandler';
import { HomebaseIcon } from './homebaseIcon';
import { DragOrbitHandler } from './dragOrbitHandler';
import { Transport } from './transport';
import { Refinery } from './refinery';
import { OilWell } from './oilWell';
import { PowerPlant } from './powerPlant';
import { Structure } from './structure';
import { BuildMenu } from './buildMenu';
import { StatsPanel } from './statsPanel';
import { TechPanel } from './techPanel';
import { TECH_TREE } from './tech';
import { R } from './constants';

installGlobalErrorHandlers();
log.info('Game init start');

const renderer = createRenderer();
log.info('Renderer created');

const scene  = new Scene();
const camera = createCamera();
log.info('Scene + camera ready');

addLighting(scene);
addStars(scene);

function hideLoadingScreen(): void {
    const el = document.getElementById('loading');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
}

const earthTiles: EarthLOD = addEarth(scene, () => {
    log.info('Earth textures loaded');
    hideLoadingScreen();
});
log.info('Earth added to scene');

const { homebase, resourceNodes } = buildWorld(scene, RESOURCES);
log.info('World built, homebase at', homebase.position);

const structures: Structure[] = [homebase, ...resourceNodes];

const zoom = new ZoomController();
const hud  = new HUD(RESOURCES);

// ── Restore saved state ───────────────────────────────────────────────────────

function staggerByRoute(transports: Transport[]): void {
    const groups = new Map<string, Transport[]>();
    for (const t of transports) {
        const dn  = t.destinationNormal;
        const key = `${t.sourceResource.name}|${dn.x.toFixed(3)},${dn.y.toFixed(3)},${dn.z.toFixed(3)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(t);
    }
    for (const group of groups.values()) {
        for (let i = 0; i < group.length; i++) group[i].stagger(i / group.length);
    }
}

const saved = loadGame(zoom, RESOURCES, scene, KSC_NORMAL, TECH_TREE);
const transports:  Transport[]  = saved.transports;
const refineries:  Refinery[]   = saved.refineries;
const oilWells:    OilWell[]    = saved.oilWells;
const powerPlants: PowerPlant[] = saved.powerPlants;

// Add loaded placed structures to the live array
for (const ref  of refineries)  structures.push(ref);
for (const well of oilWells)    structures.push(well);
for (const pp   of powerPlants) structures.push(pp);

staggerByRoute(transports);
hud.refreshAll(RESOURCES);
log.info(`Loaded ${transports.length} transport(s), ${refineries.length} refiner(ies), ${oilWells.length} oil well(s), ${powerPlants.length} power plant(s) from save`);

// Single save function captures all mutable state
function save(): void { saveGame(zoom, RESOURCES, transports, refineries, oilWells, powerPlants, TECH_TREE); }
setInterval(save, 60_000);

// ── Input ─────────────────────────────────────────────────────────────────────

const flash     = new Flash();
const dragOrbit = new DragOrbitHandler(camera, zoom, scene, renderer.domElement, save);
const inputHandler = new InputHandler(
    camera, scene, RESOURCES, transports, hud, flash, renderer.domElement,
    () => { hud.refreshAll(RESOURCES); save(); },
    lines => dragOrbit.setTapInfo(lines),
);
inputHandler.setStructures(structures);
inputHandler.setSaveCallback(save);
inputHandler.setDeleteCallback((structure) => {
    // Remove from scene
    structure.dispose();

    // Remove from live structures array
    const si = structures.indexOf(structure);
    if (si !== -1) structures.splice(si, 1);

    if (structure instanceof Refinery) {
        refineries.splice(refineries.indexOf(structure), 1);
        // Stop trucks delivering to this refinery
        const n = structure.surfaceNormal;
        for (const t of transports) {
            if (t.destinationNormal.dot(n) > 0.9999) t.stopped = true;
        }
    } else if (structure instanceof OilWell) {
        oilWells.splice(oilWells.indexOf(structure), 1);
        // Stop trucks collecting from this well
        const n = structure.surfaceNormal;
        for (const t of transports) {
            if (t.sourceResource === structure.providesResource &&
                t.srcNormal.dot(n) > 0.9999) {
                t.stopped = true;
            }
        }
    } else if (structure instanceof PowerPlant) {
        powerPlants.splice(powerPlants.indexOf(structure), 1);
        // Stop trucks delivering to this power plant
        const n = structure.surfaceNormal;
        for (const t of transports) {
            if (t.destinationNormal.dot(n) > 0.9999) t.stopped = true;
        }
    }

    hud.refreshAll(RESOURCES);
    save();
    log.info(`Deleted ${structure.label}`);
});
zoom.onLevelChange = save;
log.info('Controllers ready');

const icon = new HomebaseIcon(homebase.position, () => { zoom.zoomTo(0); zoom.centerOnHome(); });

document.getElementById('btn-home')!.addEventListener('click', () => zoom.centerOnHome());

const stats = new StatsPanel(RESOURCES, transports);
stats.setStructures(structures);
stats.setSaveCallback(save);
document.getElementById('btn-stats')!.addEventListener('click', () => stats.toggle());

const techPanel = new TechPanel(RESOURCES, TECH_TREE, () => {
    hud.refreshAll(RESOURCES);
    save();
});
document.getElementById('btn-tech')!.addEventListener('click', () => techPanel.toggle());

// ── Settings modal ────────────────────────────────────────────────────────────

const _settingsModal   = document.getElementById('settings-modal')!;
const _settingsClearRow = document.getElementById('settings-clear-row')!;
const _settingsConfirm = document.getElementById('settings-confirm')!;

function _openSettings(): void {
    _settingsClearRow.style.display = '';
    _settingsConfirm.style.display  = 'none';
    _settingsModal.classList.remove('bm-hidden');
}
function _closeSettings(): void {
    _settingsModal.classList.add('bm-hidden');
}

document.getElementById('btn-settings')!.addEventListener('click', _openSettings);
document.getElementById('settings-close')!.addEventListener('click', _closeSettings);
_settingsModal.querySelector('.bm-backdrop')!.addEventListener('click', _closeSettings);

document.getElementById('settings-clear-btn')!.addEventListener('click', () => {
    _settingsClearRow.style.display = 'none';
    _settingsConfirm.style.display  = '';
});
document.getElementById('settings-confirm-no')!.addEventListener('click', () => {
    _settingsClearRow.style.display = '';
    _settingsConfirm.style.display  = 'none';
});
document.getElementById('settings-confirm-yes')!.addEventListener('click', () => {
    clearSave();
    location.reload();
});

// ── Build system ──────────────────────────────────────────────────────────────

const buildMenu = new BuildMenu(
    RESOURCES,
    KSC_NORMAL,
    scene,
    structures,    // live array — stays current as structures are added/removed
    (transport) => {
        const sameRoute = transports.filter(t => t.sourceResource.name === transport.sourceResource.name);
        if (sameRoute.length > 0) transport.stagger(sameRoute.length / (sameRoute.length + 1));
        transports.push(transport);
        hud.refreshAll(RESOURCES);
        save();
        log.info(`Built ${transport.spec.name}: ${transport.sourceResource.name} ← ${transport.fuelResource.name}`);
    },
    (refinery) => {
        refineries.push(refinery);
        structures.push(refinery);
        hud.refreshAll(RESOURCES);
        save();
        log.info(`Built Refinery → ${refinery.recipe.outputName} (fuel: ${refinery.fuelResource?.name ?? 'self'})`);
    },
    (oilWell) => {
        oilWells.push(oilWell);
        structures.push(oilWell);
        hud.refreshAll(RESOURCES);
        save();
        log.info('Built Oil Well');
    },
    (powerPlant) => {
        powerPlants.push(powerPlant);
        structures.push(powerPlant);
        hud.refreshAll(RESOURCES);
        save();
        log.info(`Built Power Plant (fuel: ${powerPlant.fuelResource.name}, η=${Math.round(powerPlant.efficiency * 100)}%)`);
    },
    (res) => hud.update(res),
);

buildMenu.setPlacementHandler(
    (ghost, rise, cb) => inputHandler.startPlacement(ghost, rise, cb),
);

// ── Camera init ───────────────────────────────────────────────────────────────

zoom.initCamera(camera);
log.info('Camera initialized, starting render loop');

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render loop ───────────────────────────────────────────────────────────────

const _pNorm     = new Vector3();
const _north     = new Vector3();
const _worldY    = new Vector3(0, 1, 0);
const _camDir    = new Vector3();
const _targetDir = new Vector3();

function updateCameraUp(): void {
    _pNorm.copy(camera.position).normalize();
    _north.copy(_worldY).addScaledVector(_pNorm, -_worldY.dot(_pNorm));
    if (_north.lengthSq() > 0.001) camera.up.copy(_north.normalize());
}

// ── Scale bar ─────────────────────────────────────────────────────────────────

const _scaleLine  = document.getElementById('scale-line')!  as HTMLElement;
const _scaleLabel = document.getElementById('scale-label')! as HTMLElement;

const _NICE_M = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000,
    1_000_000, 2_000_000, 5_000_000,
];

function updateScaleBar(): void {
    const groundDist = Math.max(camera.position.length() - R, 1);
    const fovRad     = camera.fov * Math.PI / 180;
    const mPerPx     = (2 * Math.tan(fovRad / 2) * groundDist) / window.innerWidth;

    const targetM  = 80 * mPerPx;
    let   niceM    = _NICE_M[0];
    for (const n of _NICE_M) { if (n <= targetM) niceM = n; else break; }

    const barPx = Math.round(niceM / mPerPx);
    _scaleLine.style.width = `${barPx}px`;
    _scaleLabel.textContent = niceM >= 1000
        ? `${Math.round(niceM / 1000)} km`
        : `${Math.round(niceM)} m`;
}

let lastTime   = performance.now();
let frameCount = 0;

function animate(): void {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    // Separate direction and radius so zoom-level transitions animate smoothly
    // and drag rotation never alters the orbital distance.
    // Direction: instant during drag (camera tracks cursor exactly), smooth otherwise.
    // Radius:    always lerps at 0.07 so clicking +/- zooms with a smooth fly-in.
    _camDir.copy(camera.position).normalize();
    _targetDir.copy(zoom.targetPos).normalize();
    _camDir.lerp(_targetDir, dragOrbit.isDragging ? 1.0 : 0.07).normalize();
    const _newR = camera.position.length() + (zoom.targetPos.length() - camera.position.length()) * 0.07;
    camera.position.copy(_camDir).multiplyScalar(_newR);
    zoom.currentLook.lerp(zoom.targetLook, 0.07);

    // Dynamic near plane: keep depth precision tight enough to see trucks (102 m above Earth sphere).
    // Δz_min = h² / (near × 2²⁴) < 102  →  near > h² / 1.71e9
    // Use factor-2 safety margin; floor at 1 m so close-zoom geometry is never clipped.
    const _camHeight = Math.max(1, camera.position.length() - R);
    camera.near = Math.max(1, (_camHeight * _camHeight) / 8.55e8);
    camera.updateProjectionMatrix();
    updateCameraUp();
    camera.lookAt(zoom.currentLook);

    const camPos = camera.position.clone();
    scene.position.set(-camPos.x, -camPos.y, -camPos.z);
    camera.position.set(0, 0, 0);
    renderer.render(scene, camera);

    camera.position.copy(camPos);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    dragOrbit.update();
    inputHandler.update();
    icon.update(camera);
    earthTiles.update(camPos, camera);
    const _fov    = earthTiles.activeTileFovDeg;
    const _fovStr = _fov < 10 ? _fov.toFixed(1) : Math.round(_fov).toString();
    const _tiles  = earthTiles.visibleTileCount;
    const _memStr = earthTiles.textureMemoryMB.toFixed(1);
    dragOrbit.setTileInfo(`tile   z${earthTiles.activeLevel}  ${_fovStr}°\ntex    ${_tiles} tiles  ${_memStr} MB`);
    updateScaleBar();

    // ── Transport tick ────────────────────────────────────────────────────────
    buildMenu.tick();
    techPanel.tick();

    let inventoryDirty = false;
    for (const t of transports) {
        const { pickup, fuelConsumed } = t.update(dt);
        if (pickup) {
            const gathered = t.sourceResource.gather(t.spec.payloadKg);
            hud.update(t.sourceResource);
            inventoryDirty = true;
            if (!gathered) {
                t.stopped = true;
                log.info(`${t.spec.name}: source ${t.sourceResource.name} exhausted — stopping`);
            }
        }
        if (fuelConsumed) {
            const ok = t.fuelResource.consume(t.fuelKgPerRoundTrip);
            hud.update(t.fuelResource);
            inventoryDirty = true;
            if (!ok) {
                t.stopped = true;
                log.info(`${t.spec.name}: out of ${t.fuelResource.name} — stopping`);
            }
        }
    }

    // ── Refinery tick ─────────────────────────────────────────────────────────
    for (const ref of refineries) {
        const { produced } = ref.tick(dt);
        if (produced) {
            hud.update(ref.providesResource!);
            inventoryDirty = true;
        }
    }

    // ── Power plant tick ──────────────────────────────────────────────────────
    for (const pp of powerPlants) {
        const { produced } = pp.tick(dt);
        if (produced) {
            hud.update(pp.providesResource);
            hud.update(pp.fuelResource);
            inventoryDirty = true;
        }
    }

    if (inventoryDirty) save();

    if (++frameCount === 1) log.info('First frame rendered');
}
animate();
