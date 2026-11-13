/**
 * Landmark names: every kind has a pool in core/names.ts, no name appears in
 * two pools, and every landmark on a planet gets a distinct name.
 * Run: npm run check
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
