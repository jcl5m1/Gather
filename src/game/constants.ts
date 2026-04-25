export const R            = 6_371_000; // Earth radius (m)
export const SURFACE_RISE = 0;          // m above R to place surface objects (sphere is rendered at R-100, so 0 suffices)
export const HOUSE_R  = 6;         // homebase cylinder radius (m)
export const HOUSE_H  = 12;        // homebase cylinder height (m)
export const PAD_W    = 12;        // resource pad width/depth (m)
export const PAD_H    = 0.3;       // resource pad height (m)
export const RES_DIST = 200;       // distance from homebase to each resource pad (m)

// Kennedy Space Center Launch Complex 39, Cape Canaveral FL
export const KSC_LAT = 28.5728 * Math.PI / 180;   // radians N
export const KSC_LON = -80.6490 * Math.PI / 180;  // radians (W = negative)
