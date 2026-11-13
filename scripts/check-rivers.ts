/**
 * Fresh water must be carved INTO the land: no river/lake water surface may sit
 * above the dry ground beside it. Run: npm run check
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
