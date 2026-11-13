/**
 * Floating islands must not count as ground: under every sky island the
 * walkable ground is the real terrain, far below the island. Run: npm run check
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
