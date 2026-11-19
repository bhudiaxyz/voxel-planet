/**
 * check-islands — floating sky islands must not count as ground.
 *
 * Purpose
 *   Under every sky island the walkable ground (grid.groundColumnTop) must be the real terrain,
 *   far below the island, so the player, dog and critters never treat an island as the surface.
 *
 * Operations
 *   Generates the seed-1337 planet, builds its landmarks, and asserts there are at least 8 sky
 *   islands; for each, the column top is high (>= layer 40) and the ground under it is below
 *   layer 40.
 *
 * Usage
 *   Part of `npm run check`; alone: `node --import ./scripts/ts-resolve.mjs scripts/check-islands.ts`.
 *   A failure means islands leak into ground queries (or too few islands were generated).
 *
 * See also: src/world/landmarks.ts, src/core/voxel.ts (groundColumnTop);
 * DESIGN.md "17. Checks and tooling".
 */
import assert from 'node:assert/strict';
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { buildSphereLandmarks } from '../src/world/landmarks.ts';
import { makeRng } from '../src/core/rng.ts';
import { dirToFaceUV } from '../src/core/geoutil.ts';
import { FACE_RES } from '../src/core/voxel.ts';

const { grid } = await generateSphereTerrain(1337);
const lm = buildSphereLandmarks(grid, makeRng(1337 ^ 0x4c2e9a1f));
const sky = lm.filter((r) => r.sky);
assert.ok(sky.length >= 8, `too few sky islands: ${sky.length}`);
let checked = 0;
for (const r of sky) {
    const { face, u, v } = dirToFaceUV(r.dir, FACE_RES);
    const top = grid.columnTop(face, u, v);
    const ground = grid.groundColumnTop(face, u, v);
    assert.ok(top >= 40, `island column top should be high (got ${top})`);
    assert.ok(ground < 40, `ground under an island must be the terrain, got layer ${ground} (top ${top})`);
    checked++;
}
console.log({ skyIslands: sky.length, checked });
