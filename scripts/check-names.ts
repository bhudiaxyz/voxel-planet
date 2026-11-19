/**
 * check-names — landmark naming pools are complete, disjoint and used without repeats.
 *
 * Purpose
 *   Keeps the Locations panel readable: every kind has names, and no two places share one.
 *
 * Operations
 *   1. Every landmark kind (the LANDMARK_COLOR keys) plus 'island' has a non-empty pool in
 *      LANDMARK_NAMES_BY_KIND (core/names.ts).
 *   2. No name appears twice across (or within) pools.
 *   3. For seeds 1337 and 42, generates the planet and landmarks and asserts all names are
 *      distinct and each comes from its own kind's pool (sky islands use 'island').
 *
 * Usage
 *   Part of `npm run check`; alone: `node --import ./scripts/ts-resolve.mjs scripts/check-names.ts`.
 *   A failure means a new landmark kind lacks a pool, or a pool has duplicates or too few names.
 *
 * See also: src/core/names.ts, src/world/landmarks.ts; DESIGN.md "17. Checks and tooling".
 */
import assert from 'node:assert/strict';
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { buildSphereLandmarks, LANDMARK_COLOR } from '../src/world/landmarks.ts';
import { LANDMARK_NAMES_BY_KIND } from '../src/core/names.ts';
import { makeRng } from '../src/core/rng.ts';

// 1. A pool for every kind (LANDMARK_COLOR is keyed by every kind), plus sky islands.
const kinds = [...Object.keys(LANDMARK_COLOR), 'island'];
for (const k of kinds) assert.ok(LANDMARK_NAMES_BY_KIND[k]?.length, `no names pool for landmark kind '${k}'`);

// 2. No name shared between (or repeated within) pools.
const all = Object.values(LANDMARK_NAMES_BY_KIND).flat();
const dup = all.filter((n, i) => all.indexOf(n) !== i);
assert.deepEqual(dup, [], `duplicate names: ${dup.join(', ')}`);

// 3. Every landmark on real planets gets a distinct name from its own pool.
for (const seed of [1337, 42]) {
    const { grid } = await generateSphereTerrain(seed);
    const lm = buildSphereLandmarks(grid, makeRng(seed ^ 0x4c2e9a1f));
    const names = lm.map((r) => r.name);
    assert.equal(new Set(names).size, names.length, `seed ${seed}: duplicate landmark names`);
    for (const r of lm) {
        const pool = LANDMARK_NAMES_BY_KIND[r.sky ? 'island' : r.kind];
        assert.ok(pool.includes(r.name), `seed ${seed}: '${r.name}' is not from the ${r.kind} pool`);
    }
}
console.log(`names ok (${kinds.length} pools, ${all.length} names)`);
