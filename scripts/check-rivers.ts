/**
 * check-rivers — fresh water is carved into the land, never perched above it.
 *
 * Purpose
 *   Guards the river/lake carving in src/world/rivers.ts: a water surface standing higher than
 *   the dry bank beside it would read as a wall of water.
 *
 * Operations
 *   Generates the seed-1337 planet, scans every column on all six faces whose top block is
 *   RIVER_WATER, and for each dry 4-neighbour counts a violation when the water top is above the
 *   neighbour's ground. Asserts more than 2000 water columns exist and zero violations.
 *
 * Usage
 *   Part of `npm run check`; alone: `node --import ./scripts/ts-resolve.mjs scripts/check-rivers.ts`.
 *   A failure means water stands above its bank (carving or fill level regressed), or rivers
 *   and lakes nearly vanished.
 *
 * See also: src/world/rivers.ts; DESIGN.md "17. Checks and tooling".
 */
import assert from 'node:assert/strict';
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { RIVER_WATER } from '../src/world/rivers.ts';
import { FACE_RES } from '../src/core/voxel.ts';

const { grid } = await generateSphereTerrain(1337);
const W = RIVER_WATER.id;
let cols = 0,
    bad = 0;
for (let f = 0; f < 6; f++)
    for (let v = 1; v < FACE_RES - 1; v++)
        for (let u = 1; u < FACE_RES - 1; u++) {
            const top = grid.columnTop(f, u, v);
            if (grid.get(f, u, v, top) !== W) continue;
            cols++;
            // Water's top is never above a dry 4-neighbour's ground.
            for (const [du, dv] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ]) {
                const nt = grid.columnTop(f, u + du, v + dv);
                if (grid.get(f, u + du, v + dv, nt) === W) continue;
                if (top > nt) bad++;
            }
        }
console.log({ waterColumns: cols, aboveBank: bad });
assert.ok(cols > 2000, `too little fresh water: ${cols} columns`);
assert.equal(bad, 0, 'water stands above its bank');
