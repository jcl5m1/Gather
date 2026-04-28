/**
 * uiDefaults.ts — Single source of truth for ALL panel / slider / colour defaults.
 *
 * Rules:
 *  • Every numeric slider default lives here, NOT in index.html value="" attributes.
 *  • Every colour-picker default lives here, NOT in index.html value="" attributes.
 *  • index.ts reads this file to set HTML elements AND call apply() on load.
 *  • terrainGen.ts DEFAULT_TERRAIN_PARAMS still owns terrain shape/colour defaults
 *    but the values are imported from here so they stay in sync.
 */

// ── Terrain shape ─────────────────────────────────────────────────────────────
export const TERRAIN_FEATURE_SCALE    = 1.4;
export const TERRAIN_PERSISTENCE      = 0.54;
export const TERRAIN_LACUNARITY       = 2.90;
export const TERRAIN_L2_SCALE         = 1.30;
export const TERRAIN_CONTINENTAL_BIAS = 0.35;

// ── Terrain colour map thresholds ─────────────────────────────────────────────
export const TERRAIN_OCEAN_LEVEL    = 0.50;
export const TERRAIN_SHORE_LEVEL    = 0.52;
export const TERRAIN_LOWLAND_LEVEL  = 0.55;
export const TERRAIN_HIGHLAND_LEVEL = 0.62;
export const TERRAIN_SNOW_LEVEL     = 0.68;

// ── Ice layer ─────────────────────────────────────────────────────────────────
export const ICE_SCALE        = 9.5;
export const ICE_AZIMUTH      = 10.0;
export const ICE_OPACITY      = 3.5;
export const ICE_BLEND_MODE   = 3;        // 0=Normal 1=Screen 2=Multiply 3=Add
export const ICE_CLEAR_COLOR  = '#b0cce0';
export const ICE_CLEAR_ALPHA  = 0.0;
export const ICE_ICE_COLOR    = '#d9edff';
export const ICE_ICE_ALPHA    = 1.0;
export const ICE_CLEAR_LEVEL  = 0.39;
export const ICE_ICE_LEVEL    = 0.86;

// ── Sun / lighting ────────────────────────────────────────────────────────────
export const SUN_ELEVATION    = 5;     // degrees
export const SUN_AZIMUTH      = 0;     // degrees
export const SUN_INTENSITY    = 1.00;
export const AMBIENT          = 0.25;

// ── Atmosphere day/night band ─────────────────────────────────────────────────
export const ATM_DAY_WIDTH      = 20.0;
export const ATM_NIGHT_WIDTH    = 20.0;
export const ATM_DAY_OPACITY    = 1.00;
export const ATM_NIGHT_OPACITY  = 0.40;

// ── Atmosphere inner glow ─────────────────────────────────────────────────────
export const ATM_INNER_OPACITY  = 0.40;
export const ATM_INNER_WIDTH    = 0.09;

// ── Atmosphere colour pickers ─────────────────────────────────────────────────
export const ATM_SHADOW_COLOR   = '#1233b8';
export const ATM_SUN_COLOR      = '#85c2ff';

// ── Atmosphere misc (removed sliders — kept for reference) ───────────────────
export const ATM_SUN_MOD        = 0.75;
export const ATM_NIGHT_FLOOR    = 0.25;

// ── Orbital debris ────────────────────────────────────────────────────────────
export const DEBRIS_ECC_MIN     = 0.00;
export const DEBRIS_ECC_MAX     = 0.60;
export const DEBRIS_TAIL_STEPS  = 10;
export const DEBRIS_TAIL_REAL_SECONDS = 1.0;  // real seconds the tail spans at timeScale=1
