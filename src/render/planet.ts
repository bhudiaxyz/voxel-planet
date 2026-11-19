/**
 * Planet constants — the default planet radius shared with the settings UI.
 *
 * Purpose
 *   Holds PLANET_RADIUS_DEFAULT outside the voxel core, so ui/settings.ts can default its
 *   planet-radius slider without importing the whole grid module.
 *
 * Operations
 *   Constants only. The world is a real sphere (core/voxel.ts); this file used to hold the flat
 *   world's "planet bend" vertex shader, which is gone.
 *
 * Usage
 *   import { PLANET_RADIUS_DEFAULT } from '../render/planet' (ui/settings.ts). Keep it equal to
 *   PLANET_RADIUS in core/voxel.ts.
 *
 * See also: core/voxel.ts; DESIGN.md "2. Sphere grid".
 */

/** Default for the settings panel's planet-radius slider. Matches PLANET_RADIUS in core/voxel.ts. */
export const PLANET_RADIUS_DEFAULT = 350.0;
