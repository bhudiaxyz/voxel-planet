/**
 * check-trees — the generated planet has plenty of varied vegetation.
 *
 * Purpose
 *   Smoke test for the tree/vegetation pass: leaves and trunks exist in quantity and every bark
 *   style is represented, so zones really produce different trees.
 *
 * Operations
 *   Generates the seed-1337 planet, then scans every block of every column. Leaf blocks are the
 *   BLOCK_BY_ID entries with `sway`; bark blocks are those with isTrunk and the BARK pattern
 *   (oak, birch, scaly, ringed, smooth, deadwood, ...). Throws unless there are at least 5
 *   distinct bark styles, 1000 leaf blocks and 500 trunk blocks; prints the counts and time.
 *
 * Usage
 *   Part of `npm run check`; alone: `node --import ./scripts/ts-resolve.mjs scripts/check-trees.ts`.
 *   A failure means tree generation regressed (too sparse, or a species or bark style lost).
 *
 * See also: src/world/trees.ts, src/world/vegetation.ts, src/core/blocks.ts;
 * DESIGN.md "17. Checks and tooling".
 */
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { BLOCK_BY_ID, PATTERN } from '../src/core/blocks.ts';
import { FACE_RES, SHELL_DEPTH } from '../src/core/voxel.ts';

const t0 = Date.now();
const { grid } = await generateSphereTerrain(1337);
// Every leaf block: the six palette slots plus species canopies (maple, cherry…).
const leafIds = new Set(
    Object.values(BLOCK_BY_ID)
        .filter((b: any) => b?.sway)
        .map((b: any) => b.id),
);
// Every bark block (oak/birch/scaly/ringed/smooth/deadwood), not just TRUNK and
// TRUNK_PALE: conifers and palms have their own bark blocks now.
const barkIds = new Set(
    Object.values(BLOCK_BY_ID)
        .filter((b: any) => b?.isTrunk && b.pattern === PATTERN.BARK)
        .map((b: any) => b.id),
);
const barkStyles = new Set<number>();
let leaves = 0,
    trunks = 0;
for (let f = 0; f < 6; f++)
    for (let v = 0; v < FACE_RES; v++)
        for (let u = 0; u < FACE_RES; u++)
            for (let l = 0; l < SHELL_DEPTH; l++) {
                const id = grid.get(f, u, v, l);
                if (leafIds.has(id)) leaves++;
                else if (barkIds.has(id)) {
                    trunks++;
                    barkStyles.add((BLOCK_BY_ID[id] as any).barkStyle ?? 0);
                }
            }
console.log({ leaves, trunks, barkStyles: barkStyles.size, ms: Date.now() - t0 });
if (barkStyles.size < 5) throw new Error(`expected all 5 bark styles on the planet, got ${barkStyles.size}`);
if (leaves < 1000 || trunks < 500) throw new Error('too little vegetation');
