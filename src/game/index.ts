import { Scene, Vector3 } from 'three';
import {
    SUN_ELEVATION, SUN_AZIMUTH, SUN_INTENSITY, AMBIENT,
    ATM_DAY_WIDTH, ATM_NIGHT_WIDTH, ATM_DAY_OPACITY, ATM_NIGHT_OPACITY,
    ATM_INNER_OPACITY, ATM_INNER_WIDTH,
    ATM_SHADOW_COLOR, ATM_SUN_COLOR,
    TERRAIN_FEATURE_SCALE, TERRAIN_PERSISTENCE, TERRAIN_LACUNARITY,
    TERRAIN_L2_SCALE, TERRAIN_CONTINENTAL_BIAS,
    TERRAIN_OCEAN_LEVEL, TERRAIN_SHORE_LEVEL, TERRAIN_LOWLAND_LEVEL,
    TERRAIN_HIGHLAND_LEVEL, TERRAIN_SNOW_LEVEL,
    ICE_SCALE, ICE_AZIMUTH, ICE_OPACITY, ICE_BLEND_MODE,
    ICE_CLEAR_COLOR, ICE_CLEAR_ALPHA, ICE_ICE_COLOR, ICE_ICE_ALPHA,
    ICE_CLEAR_LEVEL, ICE_ICE_LEVEL,
} from './uiDefaults';
import { log, installGlobalErrorHandlers } from './logger';
import { RESOURCES, formatScaled } from './resource';
import { saveGame, loadGame, clearSave } from './saveState';
import { createRenderer, createCamera } from './scene';
import { addLighting, addStars, addEarth, addAtmosphere, addDaylightOverlay, addOceanSpecular, OceanSpecular } from './earth';
// import { OrbitalDebris } from './orbitalDebris'; // DISABLED
import type { EarthLOD } from './earthLOD';
import { buildWorld } from './world';
import { KSC_NORMAL } from './world';
import { ZoomController } from './zoomController';
import { HUD } from './hud';
import { Flash } from './flash';
import { Notify } from './notify';
import { InputHandler } from './inputHandler';
import { HomebaseIcon } from './homebaseIcon';
import { DragOrbitHandler } from './dragOrbitHandler';
import { Transport, TruckTransport, resolveSourceNormal } from './transport';
import { Refinery } from './refinery';
import { OilWell } from './oilWell';
import { PowerPlant } from './powerPlant';
import { Structure } from './structure';
import { BuildMenu } from './buildMenu';
import { StatsPanel } from './statsPanel';
import { TechPanel } from './techPanel';
import { TECH_TREE, autoFuel } from './tech';
import { R } from './constants';
import { isSameStructureNormal, formatLatLon } from './geo';

installGlobalErrorHandlers();
log.info('Game init start');

const renderer = createRenderer();
log.info('Renderer created');

const scene  = new Scene();
// Separate scene for fullscreen-quad overlays — never shifted by the
// floating-origin trick, so clip-space shaders work correctly.
const overlayScene = new Scene();
const camera = createCamera();
log.info('Scene + camera ready');

const lighting = addLighting(scene);
// addStars(scene);

function hideLoadingScreen(): void {
    const el = document.getElementById('loading');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
}

const earthTiles: EarthLOD = addEarth(scene, renderer, () => {
    log.info('Earth textures loaded');
    hideLoadingScreen();
});
const atmosphere     = addAtmosphere(overlayScene);
const oceanSpecular  = addOceanSpecular(overlayScene);
const daylightOverlay = addDaylightOverlay(scene, lighting.sunDir);
// const orbitalDebris   = new OrbitalDebris(scene); // DISABLED
// orbitalDebris.setSunDir(lighting.sunDir); // DISABLED
log.info('Earth added to scene');

const { homebase, resourceNodes } = buildWorld(scene, RESOURCES);
log.info('World built, homebase at', homebase.position);

const structures: Structure[] = [homebase, ...resourceNodes];

const zoom = new ZoomController();
const hud  = new HUD(RESOURCES);

// ── Restore saved state ───────────────────────────────────────────────────────

const saved = loadGame(zoom, RESOURCES, scene, KSC_NORMAL, TECH_TREE);
const transports:  Transport[]  = saved.transports;
const refineries:  Refinery[]   = saved.refineries;
const oilWells:    OilWell[]    = saved.oilWells;
const powerPlants: PowerPlant[] = saved.powerPlants;

// Add loaded placed structures to the live array
for (const ref  of refineries)  structures.push(ref);
for (const well of oilWells)    structures.push(well);
for (const pp   of powerPlants) structures.push(pp);

hud.refreshAll(RESOURCES);
log.info(`Loaded ${transports.length} transport(s), ${refineries.length} refiner(ies), ${oilWells.length} oil well(s), ${powerPlants.length} power plant(s) from save`);

// Single save function captures all mutable state
function save(): void { saveGame(zoom, RESOURCES, transports, refineries, oilWells, powerPlants, TECH_TREE); }
setInterval(save, 60_000);

// ── Input ─────────────────────────────────────────────────────────────────────

const flash     = new Flash();
const notify    = new Notify();
const dragOrbit = new DragOrbitHandler(camera, zoom, scene, renderer.domElement, save);
const inputHandler = new InputHandler(
    camera, scene, RESOURCES, transports, hud, flash, renderer.domElement,
    () => { hud.refreshAll(RESOURCES); save(); },
    lines => dragOrbit.setTapInfo(lines),
);
inputHandler.setStructures(structures);
inputHandler.setSaveCallback(save);
inputHandler.setNotifyCallback(msg => notify.show(msg));
inputHandler.setCursorInfoCallback(text => dragOrbit.setCursorInfo(text));

// Build-truck shortcut from the assign dialog: dest = tapped structure.
inputHandler.setBuildTruckCallback((destNormal, destName, resource) => {
    const iron = RESOURCES.find(r => r.name === 'Iron')!;
    if (iron.gathered < TruckTransport.IRON_COST) return false;

    const fuel = autoFuel(RESOURCES, TECH_TREE);
    if (!fuel) return false;

    const sourceNormal = resolveSourceNormal(resource, structures, destNormal, destNormal);
    iron.consume(TruckTransport.IRON_COST);
    hud.update(iron);

    const truck = new TruckTransport(scene, destNormal, resource, fuel, sourceNormal, destName);
    transports.push(truck);
    hud.refreshAll(RESOURCES);
    log.info(`Built ${truck.spec.name} #${truck.id} via assign dialog: ${resource.name} → ${destName}`);
    return true;
});

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
            if (isSameStructureNormal(t.destinationNormal, n)) t.stopped = true;
        }
    } else if (structure instanceof OilWell) {
        oilWells.splice(oilWells.indexOf(structure), 1);
        // Stop trucks collecting from this well
        const n = structure.surfaceNormal;
        for (const t of transports) {
            if (t.sourceResource === structure.providesResource &&
                isSameStructureNormal(t.srcNormal, n)) {
                t.stopped = true;
            }
        }
    } else if (structure instanceof PowerPlant) {
        powerPlants.splice(powerPlants.indexOf(structure), 1);
        // Stop trucks delivering to this power plant
        const n = structure.surfaceNormal;
        for (const t of transports) {
            if (isSameStructureNormal(t.destinationNormal, n)) t.stopped = true;
        }
    }

    hud.refreshAll(RESOURCES);
    save();
    log.info(`Deleted ${structure.label}`);
});
zoom.onLevelChange = save;
log.info('Controllers ready');

const icon = new HomebaseIcon(homebase.position, () => { zoom.zoomTo(0); zoom.centerOnHome(); }, renderer.domElement);

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

// ── Time scale buttons ────────────────────────────────────────────────────────
document.getElementById('btn-time-down')!.addEventListener('click', () => setTimeScale(timeScale * 0.1));
document.getElementById('btn-time-up')!  .addEventListener('click', () => setTimeScale(timeScale * 10.0));


// ── Terrain panel ─────────────────────────────────────────────────────────────

const _terrainPanel = document.getElementById('terrain-panel')!;
// ── Ice colormap (mirrors base-terrain colormap) ──────────────────────────────

let _cachedIceCounts: number[] | null = null;

function _fbm(sx: number, sy: number, sz: number, lac: number, per: number): number {
    let x = sx, y = sy, z = sz, h = 0, amp = 0.5;
    for (let i = 0; i < 12; i++) {
        h += amp * _gnoise(x, y, z);
        const nx = (       -0.80*y -0.60*z) * lac;
        const ny = (0.80*x +0.36*y -0.48*z) * lac;
        const nz = (0.60*x -0.48*y +0.64*z) * lac;
        x = nx; y = ny; z = nz;
        amp *= per;
    }
    return h * 0.5 + 0.5;
}

function _sampleIceAlpha(sx: number, sy: number, sz: number): number {
    const p = earthTiles.terrainParams;
    const n = _fbm(sx*p.iceScale+53.7, sy*p.iceScale+12.3, sz*p.iceScale+87.4, p.lacunarity, p.persistence);
    const lat = Math.pow(Math.abs(sy), Math.max(0.01, p.iceAzimuth));
    return Math.max(0, Math.min(1, n * lat * p.iceOpacity));
}

function _computeIceHistogram(W: number): number[] {
    const counts = new Array(W).fill(0);
    const N = 2000, goldenAngle = 2.399963229;
    for (let i = 0; i < N; i++) {
        const cosT = 1 - 2*(i+0.5)/N;
        const sinT = Math.sqrt(Math.max(0, 1-cosT*cosT));
        const phi = i * goldenAngle;
        const a = _sampleIceAlpha(Math.cos(phi)*sinT, cosT, Math.sin(phi)*sinT);
        counts[Math.min(W-1, Math.floor(a * W))]++;
    }
    return counts;
}

function _iceGradRGB(t: number): [number, number, number] {
    const p = earthTiles.terrainParams;
    const gradT = Math.max(0, Math.min(1,
        (t - p.iceClearLevel) / Math.max(0.001, p.iceIceLevel - p.iceClearLevel)));
    const parse = (h: string) => {
        const n = parseInt(h.replace('#',''), 16);
        return [(n >> 16 & 0xff), (n >> 8 & 0xff), (n & 0xff)];
    };
    const [r0,g0,b0] = parse(p.iceClearColor);
    const [r1,g1,b1] = parse(p.iceIceColor);
    return [r0+(r1-r0)*gradT|0, g0+(g1-g0)*gradT|0, b0+(b1-b0)*gradT|0];
}

function _drawIceCmap(recompute = false): void {
    const canvas = document.getElementById('trp-ice-cmap') as HTMLCanvasElement;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const HIST_H = 32;

    if (recompute || !_cachedIceCounts) _cachedIceCounts = _computeIceHistogram(W);
    const maxCount = Math.max(1, ..._cachedIceCounts);

    const img = ctx.createImageData(W, H);
    for (let x = 0; x < W; x++) {
        const [r, g, b] = _iceGradRGB((x + 0.5) / W);
        for (let y = HIST_H; y < H; y++) {
            const i = (y*W+x)*4;
            img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=255;
        }
        const barH = Math.round((_cachedIceCounts[x] / maxCount) * HIST_H);
        for (let y = 0; y < HIST_H; y++) {
            const i = (y*W+x)*4;
            if (y >= HIST_H - barH) {
                img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=210;
            } else {
                img.data[i]=14; img.data[i+1]=14; img.data[i+2]=18; img.data[i+3]=255;
            }
        }
    }
    ctx.putImageData(img, 0, 0);

    const p = earthTiles.terrainParams;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (const lv of [p.iceClearLevel, p.iceIceLevel]) {
        const x = Math.round(lv * W) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
}

function _updateIceSwatch(id: string, hexColor: string, alpha: number): void {
    const btn = document.getElementById(id) as HTMLButtonElement;
    const n = parseInt(hexColor.replace('#',''), 16);
    const r = n >> 16 & 0xff, g = n >> 8 & 0xff, b = n & 0xff;
    btn.style.backgroundColor = `rgba(${r},${g},${b},${alpha})`;
    btn.style.borderColor = `rgba(255,255,255,${0.15 + alpha * 0.35})`;
}

function _bindIceStop(
    swatchId: string, edId: string,
    colorId: string, alphaId: string, alphaValId: string,
    levelId: string, levelValId: string,
    colorKey: 'iceClearColor' | 'iceIceColor',
    alphaKey: 'iceClearAlpha' | 'iceIceAlpha',
    levelKey: 'iceClearLevel' | 'iceIceLevel',
    defaultColor: string, defaultAlpha: number, defaultLevel: number,
): void {
    const swatch     = document.getElementById(swatchId)!;
    const ed         = document.getElementById(edId)!;
    const colorInput = document.getElementById(colorId) as HTMLInputElement;
    const alphaInput = document.getElementById(alphaId) as HTMLInputElement;
    const alphaVal   = document.getElementById(alphaValId)!;
    const levelInput = document.getElementById(levelId) as HTMLInputElement;

    // Apply defaults from uiDefaults.ts on load
    colorInput.value = defaultColor;
    alphaInput.value = String(defaultAlpha);
    alphaVal.textContent = defaultAlpha.toFixed(2);
    levelInput.value = String(defaultLevel);
    document.getElementById(levelValId)!.textContent = defaultLevel.toFixed(2);
    earthTiles.setTerrainParams({
        [colorKey]: defaultColor,
        [alphaKey]: defaultAlpha,
        [levelKey]: defaultLevel,
    } as any);
    _updateIceSwatch(swatchId, defaultColor, defaultAlpha);

    swatch.addEventListener('click', () => ed.classList.toggle('bm-hidden'));

    let debounce: ReturnType<typeof setTimeout>;
    function applyColor(): void {
        const color = colorInput.value;
        const alpha = parseFloat(alphaInput.value);
        alphaVal.textContent = alpha.toFixed(2);
        earthTiles.setTerrainParams({ [colorKey]: color, [alphaKey]: alpha } as any);
        _updateIceSwatch(swatchId, color, alpha);
        _drawIceCmap();
        clearTimeout(debounce);
        debounce = setTimeout(() => earthTiles.regenerateTiles(), 300);
    }
    colorInput.addEventListener('input', applyColor);
    alphaInput.addEventListener('input', applyColor);

    let debounceLevel: ReturnType<typeof setTimeout>;
    (document.getElementById(levelId) as HTMLInputElement).addEventListener('input', function() {
        const v = parseFloat(this.value);
        document.getElementById(levelValId)!.textContent = v.toFixed(2);
        earthTiles.setTerrainParams({ [levelKey]: v } as any);
        if (levelKey === 'iceClearLevel') {
            const peer = document.getElementById('trp-ice-ice-level') as HTMLInputElement;
            if (parseFloat(peer.value) < v) {
                peer.value = String(v);
                document.getElementById('trp-ice-ice-level-val')!.textContent = v.toFixed(2);
                earthTiles.setTerrainParams({ iceIceLevel: v });
            }
        } else {
            const peer = document.getElementById('trp-ice-clear-level') as HTMLInputElement;
            if (parseFloat(peer.value) > v) {
                peer.value = String(v);
                document.getElementById('trp-ice-clear-level-val')!.textContent = v.toFixed(2);
                earthTiles.setTerrainParams({ iceClearLevel: v });
            }
        }
        _drawIceCmap();
        clearTimeout(debounceLevel);
        debounceLevel = setTimeout(() => earthTiles.regenerateTiles(), 300);
    });
}
_bindIceStop('trp-ice-clear-swatch', 'trp-ice-clear-ed',
    'trp-ice-clear-color', 'trp-ice-clear-alpha', 'trp-ice-clear-alpha-val',
    'trp-ice-clear-level', 'trp-ice-clear-level-val',
    'iceClearColor', 'iceClearAlpha', 'iceClearLevel',
    ICE_CLEAR_COLOR, ICE_CLEAR_ALPHA, ICE_CLEAR_LEVEL);
_bindIceStop('trp-ice-ice-swatch', 'trp-ice-ice-ed',
    'trp-ice-ice-color', 'trp-ice-ice-alpha', 'trp-ice-ice-alpha-val',
    'trp-ice-ice-level', 'trp-ice-ice-level-val',
    'iceIceColor', 'iceIceAlpha', 'iceIceLevel',
    ICE_ICE_COLOR, ICE_ICE_ALPHA, ICE_ICE_LEVEL);

document.getElementById('btn-terrain')!.addEventListener('click', () => {
    _terrainPanel.classList.toggle('bm-hidden');
    if (!_terrainPanel.classList.contains('bm-hidden')) { _drawColorMap(); _drawIceCmap(); }
});

function _bindSlider(
    id: string, valId: string, decimals: number,
    apply: (v: number) => void,
    onDebounce?: () => void,
    defaultVal?: number,
): void {
    const slider = document.getElementById(id) as HTMLInputElement;
    const label  = document.getElementById(valId)!;
    let debounce: ReturnType<typeof setTimeout>;
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        label.textContent = v.toFixed(decimals);
        apply(v);
        clearTimeout(debounce);
        debounce = setTimeout(() => { earthTiles.regenerateTiles(); onDebounce?.(); }, 300);
    });
    // If a default is provided from uiDefaults.ts, set the HTML value and label
    if (defaultVal !== undefined) {
        slider.value = String(defaultVal);
        label.textContent = defaultVal.toFixed(decimals);
    }
}

// ── Color map canvas ──────────────────────────────────────────────────────────

// TypeScript fBm port — mirrors the GLSL shader exactly for histogram sampling.
let _cachedCounts: number[] | null = null;

function _fract(x: number): number { return x - Math.floor(x); }

function _ghash(px: number, py: number, pz: number): [number, number, number] {
    let x = _fract(px * 0.1031), y = _fract(py * 0.1030), z = _fract(pz * 0.0973);
    const d = x*(y+33.33) + y*(x+33.33) + z*(z+33.33);
    x += d; y += d; z += d;
    return [_fract((x+y)*z)*2-1, _fract((x+x)*y)*2-1, _fract((y+x)*x)*2-1];
}

function _gdot(px: number, py: number, pz: number, fx: number, fy: number, fz: number): number {
    const [hx, hy, hz] = _ghash(px, py, pz);
    return hx*fx + hy*fy + hz*fz;
}

function _mix(a: number, b: number, t: number): number { return a + (b-a)*t; }

function _gnoise(px: number, py: number, pz: number): number {
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px-ix, fy = py-iy, fz = pz-iz;
    const ux = fx*fx*(3-2*fx), uy = fy*fy*(3-2*fy), uz = fz*fz*(3-2*fz);
    return _mix(
        _mix(_mix(_gdot(ix,   iy,   iz,   fx,   fy,   fz  ),
                  _gdot(ix+1, iy,   iz,   fx-1, fy,   fz  ), ux),
             _mix(_gdot(ix,   iy+1, iz,   fx,   fy-1, fz  ),
                  _gdot(ix+1, iy+1, iz,   fx-1, fy-1, fz  ), ux), uy),
        _mix(_mix(_gdot(ix,   iy,   iz+1, fx,   fy,   fz-1),
                  _gdot(ix+1, iy,   iz+1, fx-1, fy,   fz-1), ux),
             _mix(_gdot(ix,   iy+1, iz+1, fx,   fy-1, fz-1),
                  _gdot(ix+1, iy+1, iz+1, fx-1, fy-1, fz-1), ux), uy),
        uz);
}

function _sampleHeight(px: number, py: number, pz: number): number {
    const p = earthTiles.terrainParams;
    const l1 = _fbm(px*p.featureScale, py*p.featureScale, pz*p.featureScale, p.lacunarity, p.persistence);
    const l2 = _fbm(px*p.featureScale*p.layer2Scale+17.31,
                    py*p.featureScale*p.layer2Scale+43.27,
                    pz*p.featureScale*p.layer2Scale+31.83, p.lacunarity, p.persistence);
    const continental = _gnoise(px*0.8, py*0.8, pz*0.8) * p.continentalBias;
    const combined = Math.max(0, Math.min(1, l1*l2*2 + continental));
    return Math.pow(combined, p.heightCurve);
}

const CM_LO = 0.3, CM_HI = 0.7;

function _computeHeightHistogram(W: number): number[] {
    const counts = new Array(W).fill(0);
    // Fibonacci spiral — uniform area distribution on the sphere.
    const N = 2000;
    const goldenAngle = 2.399963229;
    for (let i = 0; i < N; i++) {
        const cosT = 1 - 2*(i+0.5)/N;
        const sinT = Math.sqrt(Math.max(0, 1 - cosT*cosT));
        const phi  = i * goldenAngle;
        const sx = Math.cos(phi)*sinT, sy = cosT, sz = Math.sin(phi)*sinT;
        const h = _sampleHeight(sx, sy, sz);
        if (h < CM_LO || h > CM_HI) continue;
        counts[Math.min(W-1, Math.floor((h - CM_LO) / (CM_HI - CM_LO) * W))]++;
    }
    return counts;
}

function _cmRGB(h: number): [number, number, number] {
    const p = earthTiles.terrainParams;
    const t = (h: number, lo: number, hi: number) => hi > lo ? (h - lo) / (hi - lo) : 1;
    const m = (a: number[], b: number[], t: number): [number,number,number] => {
        const c = Math.max(0, Math.min(1, t));
        return [(a[0]+(b[0]-a[0])*c)*255|0, (a[1]+(b[1]-a[1])*c)*255|0, (a[2]+(b[2]-a[2])*c)*255|0];
    };
    if (h < p.deepOceanLevel)  return m([0.03,0.06,0.20],[0.07,0.19,0.48], t(h,0,p.deepOceanLevel));
    if (h < p.shorelineLevel)  return m([0.07,0.19,0.48],[0.68,0.60,0.40], t(h,p.deepOceanLevel,p.shorelineLevel));
    if (h < p.lowlandLevel)    return m([0.22,0.44,0.14],[0.15,0.34,0.09], t(h,p.shorelineLevel,p.lowlandLevel));
    if (h < p.highlandLevel)   return m([0.15,0.34,0.09],[0.42,0.36,0.26], t(h,p.lowlandLevel,p.highlandLevel));
    if (h < p.snowlineLevel)   return m([0.42,0.36,0.26],[0.70,0.70,0.70], t(h,p.highlandLevel,p.snowlineLevel));
    return                         m([0.70,0.70,0.70],[0.95,0.96,1.00],    t(h,p.snowlineLevel,1.0));
}

function _drawColorMap(recompute = false): void {
    const canvas = document.getElementById('trp-colormap') as HTMLCanvasElement;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;  // 200 × 52
    const HIST_H = 32, GRAD_H = H - HIST_H;     // histogram top 32px, gradient bottom 20px

    if (recompute || !_cachedCounts) _cachedCounts = _computeHeightHistogram(W);
    const maxCount = Math.max(1, ..._cachedCounts);

    const img = ctx.createImageData(W, H);
    for (let x = 0; x < W; x++) {
        const [r, g, b] = _cmRGB(CM_LO + (x + 0.5) / W * (CM_HI - CM_LO));

        // Bottom GRAD_H rows: color gradient
        for (let y = HIST_H; y < H; y++) {
            const i = (y*W+x)*4;
            img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=255;
        }

        // Top HIST_H rows: histogram bar (grows upward)
        const barH = Math.round((_cachedCounts[x] / maxCount) * HIST_H);
        for (let y = 0; y < HIST_H; y++) {
            const i = (y*W+x)*4;
            if (y >= HIST_H - barH) {
                img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=210;
            } else {
                img.data[i]=14; img.data[i+1]=14; img.data[i+2]=18; img.data[i+3]=255;
            }
        }
    }
    ctx.putImageData(img, 0, 0);

    // Threshold tick marks spanning full height
    const p = earthTiles.terrainParams;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    for (const lv of [p.deepOceanLevel, p.shorelineLevel, p.lowlandLevel, p.highlandLevel, p.snowlineLevel]) {
        const x = Math.round((lv - CM_LO) / (CM_HI - CM_LO) * W) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
}

// ── Slider bindings ───────────────────────────────────────────────────────────

_bindSlider('trp-feature-scale', 'trp-feature-scale-val', 1,
    v => earthTiles.setTerrainParams({ featureScale: v }),
    () => _drawColorMap(true), TERRAIN_FEATURE_SCALE);
_bindSlider('trp-persistence',   'trp-persistence-val',   2,
    v => earthTiles.setTerrainParams({ persistence: v }),
    () => _drawColorMap(true), TERRAIN_PERSISTENCE);
_bindSlider('trp-lacunarity',    'trp-lacunarity-val',    2,
    v => earthTiles.setTerrainParams({ lacunarity: v }),
    () => _drawColorMap(true), TERRAIN_LACUNARITY);
_bindSlider('trp-l2scale',       'trp-l2scale-val',       2,
    v => earthTiles.setTerrainParams({ layer2Scale: v }),
    () => _drawColorMap(true), TERRAIN_L2_SCALE);
_bindSlider('trp-continental',   'trp-continental-val',   2,
    v => earthTiles.setTerrainParams({ continentalBias: v }),
    () => _drawColorMap(true), TERRAIN_CONTINENTAL_BIAS);

// ── Color-map sliders (ordinal coupling) ─────────────────────────────────────
// Thresholds must satisfy ocean ≤ shore ≤ lowland ≤ highland ≤ snowline.
// Moving one slider clamps its neighbours to maintain the invariant.

const _CM_ORDER = [
    { id: 'trp-ocean',    valId: 'trp-ocean-val',    key: 'deepOceanLevel' as const, def: TERRAIN_OCEAN_LEVEL    },
    { id: 'trp-shore',    valId: 'trp-shore-val',    key: 'shorelineLevel' as const, def: TERRAIN_SHORE_LEVEL    },
    { id: 'trp-lowland',  valId: 'trp-lowland-val',  key: 'lowlandLevel'   as const, def: TERRAIN_LOWLAND_LEVEL  },
    { id: 'trp-highland', valId: 'trp-highland-val', key: 'highlandLevel'  as const, def: TERRAIN_HIGHLAND_LEVEL },
    { id: 'trp-snow',     valId: 'trp-snow-val',     key: 'snowlineLevel'  as const, def: TERRAIN_SNOW_LEVEL     },
];

function _setCmEntry(idx: number, v: number): void {
    const e = _CM_ORDER[idx];
    (document.getElementById(e.id) as HTMLInputElement).value = String(v);
    document.getElementById(e.valId)!.textContent = v.toFixed(2);
    earthTiles.setTerrainParams({ [e.key]: v });
    // Keep ocean specular shader in sync with terrain thresholds
    if (e.key === 'deepOceanLevel')  oceanSpecular.setDeepOceanLevel(v);
    if (e.key === 'shorelineLevel')  oceanSpecular.setShorelineLevel(v);
}

(function _bindCmSliders() {
    _CM_ORDER.forEach((entry, i) => {
        let debounce: ReturnType<typeof setTimeout>;
        (document.getElementById(entry.id) as HTMLInputElement)
            .addEventListener('input', function () {
                const v = parseFloat(this.value);
                document.getElementById(entry.valId)!.textContent = v.toFixed(2);
                earthTiles.setTerrainParams({ [entry.key]: v });

                // Moving right: push higher sliders up so they stay ≥ v
                for (let j = i + 1; j < _CM_ORDER.length; j++) {
                    const s = document.getElementById(_CM_ORDER[j].id) as HTMLInputElement;
                    if (parseFloat(s.value) < v) _setCmEntry(j, v); else break;
                }
                // Moving left: push lower sliders down so they stay ≤ v
                for (let j = i - 1; j >= 0; j--) {
                    const s = document.getElementById(_CM_ORDER[j].id) as HTMLInputElement;
                    if (parseFloat(s.value) > v) _setCmEntry(j, v); else break;
                }

                _drawColorMap();
                clearTimeout(debounce);
                debounce = setTimeout(() => earthTiles.regenerateTiles(), 300);
            });
    });
    // Apply uiDefaults on load — set HTML value + label + terrain param
    _CM_ORDER.forEach(entry => {
        (document.getElementById(entry.id) as HTMLInputElement).value = String(entry.def);
        document.getElementById(entry.valId)!.textContent = entry.def.toFixed(2);
        earthTiles.setTerrainParams({ [entry.key]: entry.def });
    });
})();

// ── Layer toggle + Polar Ice controls ────────────────────────────────────────

function _setupLayerToggle(hdId: string, bdId: string, chId: string): void {
    document.getElementById(hdId)!.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest?.('button') || t.tagName === 'SELECT') return;
        const bd = document.getElementById(bdId)!;
        const ch = document.getElementById(chId)!;
        bd.classList.toggle('collapsed');
        ch.classList.toggle('open', !bd.classList.contains('collapsed'));
    });
}
_setupLayerToggle('trp-base-hd',     'trp-base-bd',     'trp-base-chevron');
_setupLayerToggle('trp-ice-hd',      'trp-ice-bd',      'trp-ice-chevron');
_setupLayerToggle('trp-lighting-hd', 'trp-lighting-bd', 'trp-lighting-chevron');
_setupLayerToggle('trp-atm-hd',      'trp-atm-bd',      'trp-atm-chevron');

const _baseEnBtn = document.getElementById('trp-base-en')!;
_baseEnBtn.addEventListener('click', () => {
    const enabled = !_baseEnBtn.classList.contains('enabled');
    _baseEnBtn.classList.toggle('enabled', enabled);
    earthTiles.setTerrainParams({ baseEnabled: enabled ? 1 : 0 });
    earthTiles.regenerateTiles();
});

const _iceEnBtn = document.getElementById('trp-ice-en')!;
_iceEnBtn.addEventListener('click', () => {
    const enabled = !_iceEnBtn.classList.contains('enabled');
    _iceEnBtn.classList.toggle('enabled', enabled);
    earthTiles.setTerrainParams({ iceEnabled: enabled ? 1 : 0 });
    earthTiles.regenerateTiles();
});

(document.getElementById('trp-ice-blend') as HTMLSelectElement)
    .addEventListener('change', function() {
        earthTiles.setTerrainParams({ iceBlendMode: parseFloat(this.value) });
        earthTiles.regenerateTiles();
    });

_bindSlider('trp-ice-scale',   'trp-ice-scale-val',   1,
    v => earthTiles.setTerrainParams({ iceScale:   v }),
    () => { _cachedIceCounts = null; _drawIceCmap(true); }, ICE_SCALE);
_bindSlider('trp-ice-azimuth', 'trp-ice-azimuth-val', 2,
    v => earthTiles.setTerrainParams({ iceAzimuth: v }),
    () => { _cachedIceCounts = null; _drawIceCmap(true); }, ICE_AZIMUTH);
_bindSlider('trp-ice-opacity', 'trp-ice-opacity-val', 2,
    v => earthTiles.setTerrainParams({ iceOpacity: v }),
    () => { _cachedIceCounts = null; _drawIceCmap(true); }, ICE_OPACITY);

// ── Lighting + Atmosphere live sliders (no tile regen needed) ─────────────────

function _bindLiveSlider(id: string, valId: string, decimals: number, apply: (v: number) => void, defaultVal?: number): void {
    const slider = document.getElementById(id) as HTMLInputElement;
    const label  = document.getElementById(valId)!;
    slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        label.textContent = v.toFixed(decimals);
        apply(v);
    });
    // If a default is provided from uiDefaults.ts, override the HTML value attribute
    if (defaultVal !== undefined) {
        slider.value = String(defaultVal);
    }
    const initVal = parseFloat(slider.value);
    label.textContent = initVal.toFixed(decimals);
    apply(initVal);
}

let _sunEl = SUN_ELEVATION;
let _sunAz = SUN_AZIMUTH;
function _applySunAngles(): void {
    const dir = lighting.setSunAngles(_sunEl, _sunAz);
    atmosphere.setSunDir(dir);
    oceanSpecular.setSunDir(dir);
    daylightOverlay.setSunDir(dir);
    // orbitalDebris.setSunDir(dir); // DISABLED
}

_bindLiveSlider('trp-sun-el',  'trp-sun-el-val',  0, v => { _sunEl = v; _applySunAngles(); }, SUN_ELEVATION);
_bindLiveSlider('trp-sun-az',  'trp-sun-az-val',  0, v => { _sunAz = v; _applySunAngles(); }, SUN_AZIMUTH);
_bindLiveSlider('trp-sun-int', 'trp-sun-int-val', 2, v => daylightOverlay.setSunIntensity(v), SUN_INTENSITY);
_bindLiveSlider('trp-ambient', 'trp-ambient-val', 3, v => daylightOverlay.setAmbient(v), AMBIENT);

_bindLiveSlider('trp-day-width',   'trp-day-width-val',   1, v => atmosphere.setDayWidth(v), ATM_DAY_WIDTH);
_bindLiveSlider('trp-night-width',    'trp-night-width-val',    1, v  => atmosphere.setNightWidth(v), ATM_NIGHT_WIDTH);
_bindLiveSlider('trp-day-opacity',    'trp-day-opacity-val',    2, v => atmosphere.setDayOpacity(v), ATM_DAY_OPACITY);
_bindLiveSlider('trp-night-opacity',     'trp-night-opacity-val',     2, v  => atmosphere.setNightOpacity(v), ATM_NIGHT_OPACITY);
_bindLiveSlider('trp-inner-opacity', 'trp-inner-opacity-val', 2, v => atmosphere.setInnerOpacity(v), ATM_INNER_OPACITY);
_bindLiveSlider('trp-inner-width',   'trp-inner-width-val',   2, v => atmosphere.setInnerWidth(v), ATM_INNER_WIDTH);
_bindLiveSlider('trp-sun-mod',     'trp-sun-mod-val',     2, _v => {});  // removed
_bindLiveSlider('trp-night-floor', 'trp-night-floor-val', 2, _v => {});  // removed

(function() {
    const shadowPicker = document.getElementById('trp-atm-shadow-color') as HTMLInputElement;
    shadowPicker.value = ATM_SHADOW_COLOR;
    atmosphere.setSkyColor(ATM_SHADOW_COLOR);
    shadowPicker.addEventListener('input', function() { atmosphere.setSkyColor(this.value); });

    const sunPicker = document.getElementById('trp-atm-sun-color') as HTMLInputElement;
    sunPicker.value = ATM_SUN_COLOR;
    atmosphere.setSunColor(ATM_SUN_COLOR);
    sunPicker.addEventListener('input', function() { atmosphere.setSunColor(this.value); });
})();


function _syncSliders(): void {
    const p = earthTiles.terrainParams;
    const set = (sliderId: string, valId: string, v: number, dec: number) => {
        (document.getElementById(sliderId) as HTMLInputElement).value = String(v);
        document.getElementById(valId)!.textContent = v.toFixed(dec);
    };
    set('trp-feature-scale', 'trp-feature-scale-val', p.featureScale,   1);
    set('trp-persistence',   'trp-persistence-val',   p.persistence,    2);
    set('trp-lacunarity',    'trp-lacunarity-val',    p.lacunarity,    2);
    set('trp-l2scale',       'trp-l2scale-val',       p.layer2Scale,     2);
    set('trp-continental',   'trp-continental-val',   p.continentalBias, 2);
    set('trp-ocean',         'trp-ocean-val',         p.deepOceanLevel, 2);
    set('trp-shore',         'trp-shore-val',         p.shorelineLevel,  2);
    set('trp-lowland',       'trp-lowland-val',       p.lowlandLevel,    2);
    set('trp-highland',      'trp-highland-val',      p.highlandLevel,  2);
    set('trp-snow',          'trp-snow-val',          p.snowlineLevel,  2);
    set('trp-ice-scale',   'trp-ice-scale-val',   p.iceScale,   1);
    set('trp-ice-azimuth', 'trp-ice-azimuth-val', p.iceAzimuth, 2);
    set('trp-ice-opacity', 'trp-ice-opacity-val', p.iceOpacity, 2);
    _baseEnBtn.classList.toggle('enabled', p.baseEnabled > 0.5);
    _iceEnBtn.classList.toggle('enabled', p.iceEnabled > 0.5);
    (document.getElementById('trp-ice-blend') as HTMLSelectElement).value = String(p.iceBlendMode);
    // Ice colormap stops
    (document.getElementById('trp-ice-clear-level') as HTMLInputElement).value = String(p.iceClearLevel);
    document.getElementById('trp-ice-clear-level-val')!.textContent = p.iceClearLevel.toFixed(2);
    (document.getElementById('trp-ice-ice-level') as HTMLInputElement).value = String(p.iceIceLevel);
    document.getElementById('trp-ice-ice-level-val')!.textContent = p.iceIceLevel.toFixed(2);
    (document.getElementById('trp-ice-clear-color') as HTMLInputElement).value = p.iceClearColor;
    (document.getElementById('trp-ice-clear-alpha') as HTMLInputElement).value = String(p.iceClearAlpha);
    document.getElementById('trp-ice-clear-alpha-val')!.textContent = p.iceClearAlpha.toFixed(2);
    (document.getElementById('trp-ice-ice-color') as HTMLInputElement).value = p.iceIceColor;
    (document.getElementById('trp-ice-ice-alpha') as HTMLInputElement).value = String(p.iceIceAlpha);
    document.getElementById('trp-ice-ice-alpha-val')!.textContent = p.iceIceAlpha.toFixed(2);
    _updateIceSwatch('trp-ice-clear-swatch', p.iceClearColor, p.iceClearAlpha);
    _updateIceSwatch('trp-ice-ice-swatch',   p.iceIceColor,   p.iceIceAlpha);
    _drawColorMap(true);
    _drawIceCmap();
}

// Load saved terrain params from previous session
const _savedTerrain = localStorage.getItem('terrainParams');
if (_savedTerrain) {
    try {
        earthTiles.setTerrainParams(JSON.parse(_savedTerrain));
        _syncSliders();
    } catch (_) {}
}

// Save to localStorage + copy JSON to clipboard
const _trpSaveBtn = document.getElementById('trp-save-btn') as HTMLButtonElement;
_trpSaveBtn.addEventListener('click', () => {
    const json = JSON.stringify(earthTiles.terrainParams, null, 2);
    localStorage.setItem('terrainParams', json);
    navigator.clipboard?.writeText(json).catch(() => {});
    _trpSaveBtn.textContent = 'Saved ✓';
    setTimeout(() => { _trpSaveBtn.textContent = 'Save & Copy to Clipboard'; }, 1500);
});

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
        // New trucks always start at the destination (set in TruckTransport constructor).
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
    (ghost, rise, cb, validator, invalidMessage) => inputHandler.startPlacement(ghost, rise, cb, validator, invalidMessage),
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

// ── Truck debug HUD ─────────────────────────────────────────────────────────
function findStructureByNormal(structs: Structure[], n: Vector3): Structure | undefined {
    return structs.find(s => isSameStructureNormal(s.surfaceNormal, n));
}
function buildTruckDebugInfo(ts: Transport[], structs: Structure[]): string {
    if (!ts.length) return 'trucks: none';
    const lines: string[] = [`trucks ${ts.length}`];
    const N = Math.min(ts.length, 3);
    for (let i = 0; i < N; i++) {
        const t = ts[i];
        const dn = t.destinationNormal;
        const sn = t.srcNormal;
        const srcStruct = findStructureByNormal(structs, sn);
        const srcName   = srcStruct ? srcStruct.label : t.sourceResource.name;
        const dstName   = t.destinationName;
        const pos       = t.mesh.position;
        const alt       = pos.length() - R;
        const cargo     = (t.tripState === 'to_home' || t.tripState === 'pause_at_home')
            ? `${formatScaled(t.spec.payloadKg, 'kg')} ${t.sourceResource.name}`
            : 'empty';
        const stopFlag  = t.stopped ? ' STOPPED' : '';
        const fuelKgTrip = t.fuelKgPerRoundTrip;
        const fuelStock  = t.fuelResource.gathered;
        const tripsLeft  = fuelKgTrip > 0 ? Math.floor(fuelStock / fuelKgTrip) : Infinity;
        const fuelLabel  = `${formatScaled(fuelKgTrip, 'kg')}/trip  stock ${formatScaled(fuelStock, 'kg')}  (${isFinite(tripsLeft) ? tripsLeft : '∞'} trips)`;
        lines.push(
            `#${t.id} ${t.spec.name} ${t.tripState}${stopFlag}`,
            `  src ${srcName} (${t.sourceResource.name}) ll ${formatLatLon(sn)}`,
            `  dst ${dstName} ll ${formatLatLon(dn)}`,
            `  pos (${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}) alt ${alt.toFixed(0)}m`,
            `  t ${t.tripT.toFixed(3)} v ${t.currentSpeed.toFixed(2)} m/s arc ${(t.arcLengthM/1000).toFixed(2)} km`,
            `  cargo ${cargo} pause ${t.pauseRemaining.toFixed(1)}s`,
            `  fuel ${t.fuelResource.name}: ${fuelLabel}`,
        );
    }
    if (ts.length > N) lines.push(`... +${ts.length - N} more`);
    return lines.join('\n');
}

// ── Time scale (for orbital debris simulation) ──────────────────────────────
let timeScale = 1.0;
const TIME_STEP_UP   = 10.0;   // multiply on ▶▶
const TIME_STEP_DOWN = 0.1;    // multiply on ◀◀
const TIME_SCALE_MIN = 0.0001;
const TIME_SCALE_MAX = 1_000_000;

function setTimeScale(s: number): void {
    timeScale = Math.max(TIME_SCALE_MIN, Math.min(TIME_SCALE_MAX, s));
    const el = document.getElementById('time-scale-label');
    if (el) {
        const v = timeScale;
        el.textContent = v >= 1
            ? `${v >= 1000 ? (v >= 1e6 ? (v/1e6).toFixed(1)+'M' : (v/1000).toFixed(0)+'k') : v.toFixed(0)}×`
            : `1/${Math.round(1/v)}×`;
    }
}

// ── Per-frame perf timing (EMA α=0.1, in ms) ─────────────────────────────
let _tCamera   = 0;   // camera lerp + near-plane
let _tRender   = 0;   // three.js render (scene + overlay)
let _tTiles    = 0;   // earthTiles.update (LOD / texture streaming)
let _tLogic    = 0;   // transports, refineries, power-plants
let _tGpuSync  = 0;   // gl.finish() stall after render — true GPU-bound time
let _tFrame    = 0;   // total rAF-to-rAF gap (EMA)
let _frameMin  = Infinity;
let _frameMax  = 0;
let _frameWindowStart = 0;
const _EMA_A   = 0.1; // smoothing factor (higher = more responsive)

// Press G to toggle the GPU-sync probe.  gl.finish() blocks until the GPU
// drains its queue, exposing GPU-bound stalls that CPU timers never see.
// Heavy when on — only turn on for diagnosis.
// Master perf-instrumentation flag. When OFF, every per-frame measurement,
// HUD-update, and lat/lon raycast is skipped — full game performance.
// Press Tab (or F) to toggle.  G (GPU sync) and the lat/lon readout are gated under it.
let _perfEnabled    = false;
let _gpuSyncEnabled = false;
let _vsyncEnabled   = true;
function scheduleNext(): void {
    if (_vsyncEnabled) requestAnimationFrame(animate);
    else setTimeout(animate, 0);
}

window.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F' || e.key === 'Tab') {
        if (e.key === 'Tab') e.preventDefault();   // Tab: toggle perf HUD, don't shift DOM focus
        _perfEnabled = !_perfEnabled;
        dragOrbit.setDebugVisible(_perfEnabled);
        inputHandler.setCursorReadoutEnabled(_perfEnabled);
        if (!_perfEnabled) {
            _tCamera = _tRender = _tTiles = _tLogic = _tGpuSync = _tFrame = 0;
            _frameMin = Infinity; _frameMax = 0;
            _gpuSyncEnabled = false;
        }
        earthTiles.resetBakesPeak();
    }
    if (!_perfEnabled) return;
    if (e.key === 'g' || e.key === 'G') {
        _gpuSyncEnabled = !_gpuSyncEnabled;
        if (!_gpuSyncEnabled) _tGpuSync = 0;
        earthTiles.resetBakesPeak();
    }
    if (e.key === 'v' || e.key === 'V') {
        _vsyncEnabled = !_vsyncEnabled;
    }
});
function animate(): void {
    scheduleNext();

    const now = performance.now();
    const _dtMs = now - lastTime;
    const dt  = Math.min(_dtMs / 1000, 0.1);
    lastTime  = now;

    if (_perfEnabled) {
        _tFrame = _tFrame * (1 - _EMA_A) + _dtMs * _EMA_A;
        if (_dtMs < _frameMin) _frameMin = _dtMs;
        if (_dtMs > _frameMax) _frameMax = _dtMs;
        if (now - _frameWindowStart > 1000) {
            _frameWindowStart = now;
            _frameMin = _dtMs;
            _frameMax = _dtMs;
        }
    }

    // Separate direction and radius so zoom-level transitions animate smoothly
    // and drag rotation never alters the orbital distance.
    // Direction: instant during drag (camera tracks cursor exactly), smooth otherwise.
    // Radius:    always lerps at 0.07 so clicking +/- zooms with a smooth fly-in.
    const _t0 = _perfEnabled ? performance.now() : 0;
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
    if (_perfEnabled) _tCamera = _tCamera * (1-_EMA_A) + (performance.now() - _t0) * _EMA_A;

    const camPos = camera.position.clone();
    atmosphere.update(camPos, renderer);
    oceanSpecular.update(camPos, renderer, camera.fov * Math.PI / 180);
    daylightOverlay.update(camPos);
    // orbitalDebris.update(dt * timeScale, timeScale); // DISABLED
    scene.position.set(-camPos.x, -camPos.y, -camPos.z);
    camera.position.set(0, 0, 0);
    const _t1 = _perfEnabled ? performance.now() : 0;
    renderer.render(scene, camera);
    // Render overlay (fullscreen-quad effects) without clearing
    renderer.autoClearDepth = false;
    renderer.autoClearColor = false;
    renderer.render(overlayScene, camera);
    renderer.autoClearDepth = true;
    renderer.autoClearColor = true;
    if (_perfEnabled) _tRender = _tRender * (1-_EMA_A) + (performance.now() - _t1) * _EMA_A;

    // GPU-sync probe: wait for GPU to finish all queued work and measure stall.
    if (_perfEnabled && _gpuSyncEnabled) {
        const _tg = performance.now();
        renderer.getContext().finish();
        _tGpuSync = _tGpuSync * (1-_EMA_A) + (performance.now() - _tg) * _EMA_A;
    }


    camera.position.copy(camPos);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    dragOrbit.update();
    inputHandler.update();
    inputHandler.refreshTooltip();
    inputHandler.refreshAssignDialog();
    icon.update(camera);
    const _t2 = _perfEnabled ? performance.now() : 0;
    earthTiles.update(camPos, camera);
    if (_perfEnabled) {
        _tTiles = _tTiles * (1-_EMA_A) + (performance.now() - _t2) * _EMA_A;
        const _fov    = earthTiles.activeTileFovDeg;
        const _fovStr = _fov < 10 ? _fov.toFixed(1) : Math.round(_fov).toString();
        const _tiles  = earthTiles.visibleTileCount;
        const _memStr = earthTiles.textureMemoryMB.toFixed(1);
        const _bakes     = earthTiles.bakesPerFrame;
        const _bakesPeak = earthTiles.bakesPeak;
        dragOrbit.setTileInfo(
            `tile   z${earthTiles.activeLevel}  ${_fovStr}°\n`
          + `tex    ${_tiles} tiles  ${_memStr} MB\n`
          + `bake   ${_bakes}/f (peak ${_bakesPeak})`,
        );
    }
    updateScaleBar();

    const _t3 = _perfEnabled ? performance.now() : 0;
    // ── Transport tick ────────────────────────────────────────────────────────
    buildMenu.tick();
    techPanel.tick();

    // Apply time multiplier to all game-state ticks. Sub-step so each truck
    // advances at most ~1 sim-second per iteration; otherwise large timeScale
    // produces coarse arcs and refineries miss queued batches.
    const SIM_MAX_STEP = 1.0;
    const gameDt = dt * timeScale;
    const subSteps = Math.max(1, Math.ceil(gameDt / SIM_MAX_STEP));
    const stepDt   = gameDt / subSteps;

    // Auto-resume stopped trucks when both fuel and source are available again.
    for (const t of transports) {
        if (!t.stopped) continue;
        const fuelOk   = t.fuelResource.gathered >= t.fuelKgPerRoundTrip;
        const sourceOk = t.sourceResource.isManufactured || t.sourceResource.deposit > 0;
        if (fuelOk && sourceOk) {
            t.stopped   = false;
            t.buildTime = Date.now();
            t.setFromCyclePosition(0);
            log.info(`${t.spec.name} #${t.id}: resuming`);
        }
    }

    let inventoryDirty = false;
    for (let s = 0; s < subSteps; s++) {
        for (const t of transports) {
            const { pickup, fuelConsumed } = t.update(stepDt);
            if (pickup) {
                const gathered = t.sourceResource.gather(t.spec.payloadKg);
                hud.update(t.sourceResource);
                inventoryDirty = true;
                if (!gathered) {
                    t.stopped = true;
                    t.parkAtHome();
                    const msg = `${t.spec.name} #${t.id}: ${t.sourceResource.name} deposit exhausted`;
                    log.info(msg);
                    notify.show(msg, t.sourceResource.hex);
                }
            }
            if (fuelConsumed) {
                const ok = t.fuelResource.consume(t.fuelKgPerRoundTrip);
                hud.update(t.fuelResource);
                inventoryDirty = true;
                if (!ok) {
                    t.stopped = true;
                    t.parkAtHome();
                    const msg = `${t.spec.name} #${t.id}: out of ${t.fuelResource.name}`;
                    log.info(msg);
                    notify.show(msg, t.fuelResource.hex);
                }
            }
        }

        // ── Refinery tick ─────────────────────────────────────────────────────
        for (const ref of refineries) {
            const { produced } = ref.tick(stepDt);
            if (produced) {
                hud.update(ref.providesResource!);
                inventoryDirty = true;
            }
        }

        // ── Power plant tick ──────────────────────────────────────────────────
        for (const pp of powerPlants) {
            const { produced } = pp.tick(stepDt);
            if (produced) {
                hud.update(pp.providesResource);
                hud.update(pp.fuelResource);
                inventoryDirty = true;
            }
        }

        // ── Oil well auto-extraction ──────────────────────────────────────────
        for (const well of oilWells) {
            const { produced } = well.tick(stepDt);
            if (produced) {
                hud.update(well.providesResource);
                inventoryDirty = true;
            }
        }
    }

    if (inventoryDirty) save();

    if (_perfEnabled) {
        _tLogic = _tLogic * (1-_EMA_A) + (performance.now() - _t3) * _EMA_A;
        const _gpuLine = _gpuSyncEnabled
            ? `\ngpu*   ${_tGpuSync.toFixed(1)} ms  (G to disable)`
            : `\ngpu    off  (G to probe)`;
        const _busy = _tCamera + _tRender + _tTiles + _tLogic + (_gpuSyncEnabled ? _tGpuSync : 0);
        const _idle = Math.max(0, _tFrame - _busy);
        // Shader render resolution = drawing-buffer size (matches uResolution in earth.ts)
        const _dpr = renderer.getPixelRatio();
        const _rw  = Math.round(window.innerWidth  * _dpr);
        const _rh  = Math.round(window.innerHeight * _dpr);
        dragOrbit.setPerfInfo(
            `res    ${_rw}×${_rh} @${_dpr}x\n`
          + `cam    ${_tCamera.toFixed(1)} ms\n`
          + `render ${_tRender.toFixed(1)} ms\n`
          + `tiles  ${_tTiles.toFixed(1)} ms\n`
          + `logic  ${_tLogic.toFixed(1)} ms`
          + _gpuLine
          + `\nframe  ${_tFrame.toFixed(1)} ms  [${_frameMin.toFixed(1)}–${_frameMax.toFixed(1)}]`
          + `\nidle   ${_idle.toFixed(1)} ms  (vsync wait)`
          + `\nvsync  ${_vsyncEnabled ? 'on' : 'OFF'}  (V to toggle)`
        );

        // ── Truck debug stats ────────────────────────────────────────────
        dragOrbit.setTruckInfo(buildTruckDebugInfo(transports, structures));
    }

    if (++frameCount === 1) log.info('First frame rendered');
}

animate();
