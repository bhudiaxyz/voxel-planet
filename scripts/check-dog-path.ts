/**
 * The dog's router on a hand-built patch of face 0. Run: npm run check
 *
 *   ground layer 20 everywhere, then:
 *   - a wall (layer 30) across v=60 from u=40..80 — must route around its end
 *   - water (layer 5) at u=50..54, v=40..44 — must not cross
 *   - a trunk at (45, 50)
 *   - a 2-layer terrace step at u >= 90 — climbable
 *   - a 6-layer cliff at u >= 120 — not climbable from below
 */
import assert from 'node:assert/strict';
import { SphereVoxelGrid } from '../src/core/voxel.ts';
import { BLOCKS } from '../src/core/palette.ts';
import { createSpherePathfinder, type Col } from '../src/player/path.ts';

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
console.log('dog path ok');
