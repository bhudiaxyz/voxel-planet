/**
 * Planet constants shared outside the voxel core.
 *
 * (This file used to hold the flat world's "planet bend" vertex shader, which
 * curved a flat map to fake a horizon. The world is a real sphere now — see
 * core/voxel.ts — so only the radius default remains.)
 */

/** Default for the settings panel's planet-radius slider. Matches PLANET_RADIUS in core/voxel.ts. */
export const PLANET_RADIUS_DEFAULT = 350.0;
