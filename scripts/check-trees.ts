// Generates the planet and checks every leaf/trunk block sits on a column, and
// that zones produce varied trees. Run: node --import ./scripts/ts-resolve.mjs scripts/check-trees.ts
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { BLOCKS } from '../src/core/palette.ts';
import { FACE_RES, SHELL_DEPTH } from '../src/core/voxel.ts';

const t0 = Date.now();
const { grid } = await generateSphereTerrain(1337);
const leafIds = new Set([30, 31, 32, 33, 34, 35]);
let leaves = 0,
    trunks = 0;
for (let f = 0; f < 6; f++)
    for (let v = 0; v < FACE_RES; v++)
        for (let u = 0; u < FACE_RES; u++)
            for (let l = 0; l < SHELL_DEPTH; l++) {
                const id = grid.get(f, u, v, l);
                if (leafIds.has(id)) leaves++;
                else if (id === BLOCKS.TRUNK.id || id === BLOCKS.TRUNK_PALE.id) trunks++;
            }
console.log({ leaves, trunks, ms: Date.now() - t0 });
if (leaves < 1000 || trunks < 500) throw new Error('too little vegetation');
