/**
 * check-dog-path — the dog's pathfinder on a hand-built patch of face 0.
 *
 * Purpose
 *   Verifies src/player/path.ts routes around obstacles, respects climb limits and stays
 *   incremental, without generating a planet.
 *
 * Operations
 *   Builds a patch with ground layer 20 everywhere, then:
 *   - a wall (layer 30) across v=60 from u=40..80: the route must go round an end;
 *   - water (layer 5) at u=50..54, v=40..44 and a trunk at (45, 50): must be avoided;
 *   - a 2-layer terrace at u >= 90: climbable; a 6-layer cliff at u >= 120: unreachable from
 *     below, and the drop back down exceeds maxDown 4 too (state must be 'failed');
 *   - a long route is searched with step(400) and must still be found;
 *   - walk rules shared with the player (walk-rules.ts): a bush and a tall-shrub sprite (obstacleH
 *     1.0) wall must be routed round; with jumpClear 0.6 (the dog's) a row of dry scrub (0.45) or
 *     a low rock (0.3) may be crossed, a 1.5 boulder may not; without jumpClear, scrub blocks.
 *   Every path step is also checked to be legal (passable, rise <= 2, drop <= 4).
 *
 * Usage
 *   Part of `npm run check`; alone: `node --import ./scripts/ts-resolve.mjs scripts/check-dog-path.ts`.
 *   A failure means the dog would walk through obstacles or fail to find a reachable route.
 *
 * See also: src/player/path.ts, src/player/dog.ts; DESIGN.md "15. Dog", "17. Checks and tooling".
 */
import assert from 'node:assert/strict';
import { SphereVoxelGrid } from '../src/core/voxel.ts';
import { BLOCKS } from '../src/core/blocks.ts';
import { createSpherePathfinder, type Col } from '../src/player/path.ts';
import { SHRUB_TALL, SCRUB_DRY } from '../src/world/plants.ts';

const grid = new SphereVoxelGrid();
const F = 0;
const column = (u: number, v: number, top: number, id = BLOCKS.GRASS.id) => {
    // Clear above first: grid.set only ever raises a column's surface layer.
    for (let l = 40; l > top; l--) grid.set(F, u, v, l, 0);
    for (let l = 0; l <= top; l++) grid.set(F, u, v, l, l === top ? id : BLOCKS.STONE.id);
};
for (let v = 20; v < 140; v++) for (let u = 20; u < 160; u++) column(u, v, u >= 120 ? 28 : u >= 90 ? 22 : 20);
for (let u = 40; u <= 80; u++) column(u, 60, 30);
for (let v = 40; v <= 44; v++) for (let u = 50; u <= 54; u++) column(u, v, 5, BLOCKS.SAND.id);
grid.set(F, 45, 50, 21, BLOCKS.TRUNK.id);

const pf = createSpherePathfinder(grid);
const run = (from: Col, to: Col) => {
    pf.start(from, to);
    let frames = 0;
    while (pf.step(400) === 'searching') frames++;
    return { state: pf.state, path: pf.path, frames };
};
const at = (u: number, v: number): Col => ({ face: F, u, v });
const legal = (path: Col[]) => {
    for (let i = 1; i < path.length; i++) {
        const a = pf.groundOf(path[i - 1].face, path[i - 1].u, path[i - 1].v);
        const b = pf.groundOf(path[i].face, path[i].u, path[i].v);
        assert.ok(b >= 0, `step ${i} onto impassable column ${JSON.stringify(path[i])}`);
        assert.ok(b - a <= 2 && a - b <= 4, `step ${i} rises ${b - a} (from ${a} to ${b})`);
    }
};

// 1. Around the wall: straight line (60,50)->(60,70) crosses it; route must go round an end.
{
    const r = run(at(60, 50), at(60, 70));
    assert.equal(r.state, 'found', 'wall: should find a way round');
    legal(r.path);
    assert.ok(!r.path.some((c) => c.v === 60 && c.u >= 40 && c.u <= 80), 'wall: route must not go through the wall');
    assert.ok(r.path.length > 21, 'wall: route must be longer than the straight line');
}
// 2. Water and trunk are avoided.
{
    const r = run(at(45, 42), at(60, 42));
    assert.equal(r.state, 'found');
    legal(r.path);
    assert.ok(!r.path.some((c) => c.u >= 50 && c.u <= 54 && c.v >= 40 && c.v <= 44), 'must not wade through water');
    const r2 = run(at(42, 50), at(48, 50));
    assert.ok(!r2.path.some((c) => c.u === 45 && c.v === 50), 'must not walk through a trunk');
}
// 3. A 2-layer terrace is climbable.
{
    const r = run(at(85, 100), at(95, 100));
    assert.equal(r.state, 'found', 'terrace: 2-layer step should be climbable');
    legal(r.path);
}
// 4. A 6-layer cliff is not; the search reports failure rather than a bogus route.
{
    const r = run(at(115, 100), at(125, 100));
    assert.equal(r.state, 'failed', 'cliff: 6-layer rise must be unreachable from below');
    // …but walking down it is fine.
    const down = run(at(125, 100), at(85, 100));
    assert.equal(down.state, 'failed', 'cliff: a 6-layer drop exceeds maxDown 4 too');
}
// 5. Incremental: a long route spreads over several step() calls.
{
    const r = run(at(25, 25), at(85, 135));
    assert.equal(r.state, 'found');
    legal(r.path);
    assert.ok(r.frames >= 1, 'long route should take more than one 400-node step');
}
// 6. Walk rules shared with the player (walk-rules.ts). Flat ground band at v = 20..30.
{
    const rocks = new Map<string, number>();
    const obstacleAt = (f: number, u: number, v: number) => (f === F ? rocks.get(`${u},${v}`) ?? 0 : 0);
    const jumper = createSpherePathfinder(grid, { obstacleAt, jumpClear: 0.6 });
    const go = (p: typeof pf, from: Col, to: Col) => {
        p.start(from, to);
        while (p.step(400) === 'searching');
        return p;
    };
    // A wall of tall shrubs (sprites, obstacleH 1.0) across u = 30, v = 20..28, and a bush at v = 29.
    for (let v = 20; v <= 28; v++) grid.setPlant(F, 30, v, SHRUB_TALL.id);
    grid.set(F, 30, 29, 21, (BLOCKS as any).SHRUB_SAGE.id); // a bush (sway + solid voxel) on the ground
    let r = go(jumper, at(25, 24), at(35, 24));
    assert.equal(r.state, 'found', 'shrub wall: should route round its end');
    assert.ok(!r.path.some((c) => c.u === 30 && c.v <= 29), 'must not pass through tall shrubs or the bush');
    // Dry scrub (0.45) at u = 30 for v = 31..33: the dog jumps it (straight across)...
    for (let v = 31; v <= 33; v++) grid.setPlant(F, 30, v, SCRUB_DRY.id);
    r = go(jumper, at(25, 32), at(35, 32));
    assert.equal(r.state, 'found');
    assert.ok(r.path.some((c) => c.u === 30 && c.v === 32), 'dog should jump low scrub, not detour');
    assert.ok(jumper.clutterOf(F, 30, 32) > 0, 'scrub column reports clutter for the jump arc');
    // ...but a pathfinder that can't jump treats it as a wall.
    r = go(pf, at(25, 32), at(29, 32));
    assert.equal(pf.groundOf(F, 30, 32), -1, 'without jumpClear, scrub blocks');
    // Rocks: a 0.3 rock is jumped, a 1.5 boulder is not.
    rocks.set('40,32', 0.3);
    rocks.set('40,24', 1.5);
    assert.ok(jumper.groundOf(F, 40, 32) >= 0, 'a low rock is jumpable');
    assert.equal(jumper.groundOf(F, 40, 24), -1, 'a boulder blocks');
}
console.log('dog path ok');
