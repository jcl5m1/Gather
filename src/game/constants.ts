export const R            = 6_371_000; // Earth radius (m)
export const SURFACE_RISE = 0;          // m above R to place surface objects (sphere is rendered at R-100, so 0 suffices)
export const HOUSE_R  = 6;         // homebase cylinder radius (m)
export const HOUSE_H  = 12;        // homebase cylinder height (m)
export const PAD_W    = 12;        // resource pad width/depth (m)
export const PAD_H    = 0.3;       // resource pad height (m)
export const RES_DIST = 200;       // distance from homebase to each resource pad (m)

// Threshold for "two surface normals point at the same structure".
// Pads sit ~200 m apart on a 6371 km sphere → dot ≈ 1 − 5e-10 between them, so
// a loose threshold (e.g. 0.9999) collapses adjacent pads into one.
// 1 − 1e-12 admits float-rounded clones of the same vector and rejects 200 m-apart pads.
export const SAME_NORMAL_DOT = 1 - 1e-12;

// Home base location
export const KSC_LAT = 13.204394 * Math.PI / 180;   // radians N
export const KSC_LON = -43.093765 * Math.PI / 180;  // radians (W = negative)
