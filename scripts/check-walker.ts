/**
 * check-walker — the on-foot controller's collision on a real planet (seed 1337).
 *
 * Purpose
 *   Guards three behaviours that each regressed once and are easy to break again in
 *   src/player/controller.ts:
 *     1. The eye keeps CLEARANCE from cliff faces at any approach angle and frame rate, so the
 *        camera's near plane never clips a wall (you could see through cliffs and river banks).
 *     2. Bushes and tree trunks block the walker; small ground plants and flowers don't.
 *     3. Landing from above (drone/fly exit) stands you ON a floating island; teleporting under one
 *        (no fromRadius) still finds the terrain.
 *
 * Usage
 *   npm run check, or: node --import ./scripts/ts-resolve.mjs scripts/check-walker.ts
 *   A failure names the case (angle/frame rate, obstacle kind, island) that broke.
 *
 * See also: src/player/controller.ts (blocked, keepClear, standR, snapToDir); DESIGN.md "14. Player".
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateSphereTerrain } from '../src/world/terrain.ts';
import { buildSphereLandmarks } from '../src/world/landmarks.ts';
import { makeRng } from '../src/core/rng.ts';
import { SphereController } from '../src/player/controller.ts';
import { basisFromCode, dirToFaceUV } from '../src/core/geoutil.ts';
import { FACE_RES, PLANET_RADIUS } from '../src/core/voxel.ts';
import { BLOCK_BY_ID } from '../src/core/blocks.ts';

const { grid } = await generateSphereTerrain(1337);
const landmarks = buildSphereLandmarks(grid, makeRng(1337 ^ 0x4c2e9a1f));
const n = new THREE.Vector3(),
    tu = new THREE.Vector3(),
    tv = new THREE.Vector3();
basisFromCode(0, n, tu, tv);
const colDir = (fu: number, fv: number) =>
    new THREE.Vector3()
        .copy(n)
        .addScaledVector(tu, (2 * fu) / FACE_RES - 1)
        .addScaledVector(tv, (2 * fv) / FACE_RES - 1)
        .normalize();
const fuv = (d: THREE.Vector3) => {
    const dn = d.dot(n);
    return [((d.dot(tu) / dn + 1) * FACE_RES) / 2, ((d.dot(tv) / dn + 1) * FACE_RES) / 2];
};
/** Walk `secs` toward +u, rotated `angDeg` off the wall normal, at `hz`. */
const walk = (c: SphereController, secs: number, hz: number, angDeg = 0, each?: () => void) => {
    const a = (angDeg * Math.PI) / 180;
    for (let i = 0; i < secs * hz; i++) {
        const w = tu.clone().multiplyScalar(Math.cos(a)).addScaledVector(tv, Math.sin(a));
        c.update(1 / hz, w.addScaledVector(c.dir, -w.dot(c.dir)).normalize(), false, grid);
        each?.();
    }
};

// 1. Cliff clearance: columns with a +u neighbour >= 4 layers higher.
let cliffs = 0;
for (let v = 40; v < 360 && cliffs < 12; v += 7)
    for (let u = 40; u < 360; u += 3) {
        const a = grid.groundColumnTop(0, u, v);
        if (a <= 12 || grid.groundColumnTop(0, u + 1, v) - a < 4 || grid.columnTop(0, u + 1, v) !== grid.groundColumnTop(0, u + 1, v)) continue;
        if (grid.groundColumnTop(0, u - 1, v) > a + 1) continue;
        cliffs++;
        for (const [hz, ang] of [
            [60, 45],
            [240, 45],
            [144, 8],
        ]) {
            const c = new SphereController(colDir(u - 0.5, v + 0.5), grid);
            let closest = Infinity;
            walk(c, 2, hz, ang, () => {
                // Distance to each side face whose neighbour column is a wall (ground above
                // feet + MAX_STEP), wherever the walker has slid to.
                const [fu, fv] = fuv(c.dir);
                const cu = Math.floor(fu),
                    cv = Math.floor(fv);
                const feet = c.groundRadius - 1.75 - PLANET_RADIUS - 1;
                const colW = (2 * c.groundRadius) / FACE_RES;
                for (const [du, dv, frac] of [
                    [1, 0, cu + 1 - fu],
                    [-1, 0, fu - cu],
                    [0, 1, cv + 1 - fv],
                    [0, -1, fv - cv],
                ])
                    if (grid.groundColumnTop(0, cu + du, cv + dv) > feet + 1.1) closest = Math.min(closest, frac * colW);
            });
            assert.ok(closest > 0.1, `eye ${closest.toFixed(3)} from a cliff face at ${hz} Hz, ${ang}° (u=${u}, v=${v})`);
        }
        break;
    }
assert.ok(cliffs >= 6, `too few cliffs found (${cliffs})`);

// 2. Obstacles: bushes and trunks block; a column with only a small plant doesn't.
const isBush = (u: number, v: number) => {
    const b: any = BLOCK_BY_ID[grid.get(0, u, v, grid.groundColumnTop(0, u, v))];
    return !!(b?.sway && b?.solid);
};
const isTrunk = (u: number, v: number) => {
    const g = grid.groundColumnTop(0, u, v);
    return !!(BLOCK_BY_ID[grid.get(0, u, v, g + 1)] as any)?.isTrunk;
};
const isSmallPlant = (u: number, v: number) => {
    const id = grid.plantAt(0, u, v); // 0 = none (BLOCK_BY_ID[0] is the AIR record, so test the id)
    return id !== 0 && !(BLOCK_BY_ID[id] as any).obstacleH && !isBush(u, v) && grid.columnTop(0, u, v) === grid.groundColumnTop(0, u, v);
};
const counts = { bush: 0, trunk: 0, small: 0 };
for (let v = 20; v < 380; v += 1)
    for (let u = 20; u < 376; u += 1) {
        const kind = isBush(u + 2, v) ? 'bush' : isTrunk(u + 2, v) ? 'trunk' : isSmallPlant(u + 2, v) ? 'small' : null;
        if (!kind || counts[kind] >= 15) continue;
        const g0 = grid.groundColumnTop(0, u, v);
        const clear = (uu: number) =>
            grid.groundColumnTop(0, uu, v) === g0 &&
            grid.columnTop(0, uu, v) === g0 &&
            !isBush(uu, v) &&
            !(BLOCK_BY_ID[grid.plantAt(0, uu, v)] as any)?.obstacleH;
        if (!clear(u) || !clear(u + 1) || Math.abs(grid.groundColumnTop(0, u + 2, v) - g0) > 1) continue;
        counts[kind]++;
        const c = new SphereController(colDir(u + 0.5, v + 0.5), grid);
        walk(c, 1.5, 60);
        const entered = dirToFaceUV(c.dir, FACE_RES).u >= u + 2;
        if (kind === 'small') assert.ok(entered, `walker blocked by a small plant at (${u + 2}, ${v})`);
        else assert.ok(!entered, `walker passed through a ${kind} at (${u + 2}, ${v})`);
    }
assert.ok(counts.bush >= 10 && counts.trunk >= 5 && counts.small >= 10, `too few obstacle cases ${JSON.stringify(counts)}`);

// 3. Floating islands: land on from above; teleport under stays on the terrain.
const sky = landmarks.filter((r) => r.sky);
for (const r of sky) {
    const { face, u, v } = dirToFaceUV(r.dir, FACE_RES);
    const ground = grid.groundColumnTop(face, u, v);
    const c = new SphereController(r.dir.clone(), grid);
    c.snapToDir(r.dir.clone(), grid, PLANET_RADIUS + grid.columnTop(face, u, v) + 20);
    assert.ok(c.groundRadius - 1.75 - PLANET_RADIUS > ground + 10, `landing missed sky island at ${face},${u},${v}`);
    const t = new SphereController(r.dir.clone(), grid);
    t.snapToDir(r.dir.clone(), grid);
    assert.ok(t.groundRadius - 1.75 - PLANET_RADIUS <= ground + 1.5, `teleport under island ${face},${u},${v} snapped onto it`);
}
console.log({ cliffs, obstacles: counts, skyIslands: sky.length });
