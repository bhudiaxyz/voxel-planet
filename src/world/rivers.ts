/**
 * Fresh water: rivers, streams, lakes and ponds, carved INTO the land.
 *
 * Ported from voxel-world's terrain.ts river carve, adapted to the sphere:
 * columns are (face, u, v) and "up" is the layer axis, so a river is traced
 * downhill across cube faces with crossFaceUV, and every bank lookup goes
 * through the grid's global accessors so a channel crossing a face seam carves
 * on both sides of it.
 *
 * The one rule that keeps water inside the terrain (as in voxel-world):
 * a column's water surface is at least one layer below the LOWEST dry bank
 * around it, then relaxed so neighbouring surfaces step by at most one layer.
 * The bed is carved below that surface and the gap filled with RIVER_WATER.
 * So water can never stand above ground level — it only ever sits in a cut.
 *
 * Runs after the surface pass and before vegetation, so plants grow on the
 * carved banks, not in the channels.
 */
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH, crossFaceUV } from '../core/voxel';
import { BLOCKS, registerBlock } from '../core/palette';
import { makeRng } from '../core/rng';
import { SNOW } from './trees';

/** River water: non-solid (isWater), so the player wades and the mesher draws banks behind it. */
export const RIVER_WATER = registerBlock('RIVER_WATER', {
    top: new THREE.Color(0x4fa8bc).convertSRGBToLinear(),
    side: new THREE.Color(0x3d97ae).convertSRGBToLinear(),
    bottom: new THREE.Color(0x2e8899).convertSRGBToLinear(),
    tint: new THREE.Color(0x7cc8d8).convertSRGBToLinear(),
    rough: 0.05,
    isWater: true,
});

const RIVER_DEPTH = 3; // layers below the surface at a channel's centre
const BANK_R = 3; // how far to look for the lowest bank
const N = FACE_RES;
const key = (f: number, u: number, v: number) => (f * N + v) * N + u;
const unkey = (k: number): [number, number, number] => [Math.floor(k / (N * N)), k % N, Math.floor(k / N) % N];

/** Canonical neighbour (crosses face seams). */
function step(f: number, u: number, v: number, du: number, dv: number): number {
    const nu = u + du,
        nv = v + dv;
    if (nu >= 0 && nu < N && nv >= 0 && nv < N) return key(f, nu, nv);
    const [f2, u2, v2] = crossFaceUV(f, nu, nv);
    return key(f2, u2, v2);
}

/** Yield to the browser (paints the loading bar; keeps the tab from being flagged hung). */
const paint = () => new Promise((r) => setTimeout(r, 0));

export async function carveFreshWater(grid: SphereVoxelGrid, seaLayer: number, seed: number) {
    // Yield whenever this much main-thread time has passed since the last one.
    // Pure scheduling: the RNG stream and results are unchanged.
    let lastYield = performance.now();
    const maybeYield = async () => {
        if (performance.now() - lastYield < 40) return;
        await paint();
        lastYield = performance.now();
    };
    const rng = makeRng(seed ^ 0x51e7a);
    const grassIds = new Set([BLOCKS.GRASS.id, BLOCKS.GRASS_LIGHT.id, BLOCKS.GRASS_DEEP.id]);
    const sourceIds = new Set([...grassIds, SNOW.id]);
    const top = (k: number) => {
        const [f, u, v] = unkey(k);
        return grid.columnTop(f, u, v);
    };
    /**
     * Ground height (ignores trees, so a canopy on the bank doesn't raise it).
     * Memoised: phases 4-5 read the grid ~50× per channel column (the bank
     * search) and only write it in phase 5, after the last read. Uncached this
     * was ~1.3 s of unyielding main thread on desktop, several seconds on phones.
     */
    const groundMemo = new Int16Array(6 * N * N).fill(-2);
    const ground = (k: number) => {
        if (groundMemo[k] === -2) {
            const [f, u, v] = unkey(k);
            groundMemo[k] = grid.groundColumnTop(f, u, v);
        }
        return groundMemo[k];
    };

    /* ---- 1. channels: key → half-width at that column ------------------- */
    // Max-merged, so where a stream joins a river the wider one wins.
    const half = new Map<number, number>();
    const stamp = (k: number, w: number) => {
        // Disc of radius ceil(w) around the column; record distance as "inside".
        const [f, u, v] = unkey(k);
        const r = Math.ceil(w);
        for (let dv = -r; dv <= r; dv++)
            for (let du = -r; du <= r; du++) {
                const d = Math.hypot(du, dv);
                if (d > w) continue;
                const j = step(f, u, v, du, dv);
                // Store remaining depth weight: 1 at the centre, ~0 at the rim.
                const c = 1 - d / Math.max(w, 0.5);
                if ((half.get(j) ?? -1) < c) half.set(j, c);
            }
    };

    /* ---- 2. rivers & streams: steepest descent with inertia ------------- */
    const RIVERS = 180; // was 110
    const D8: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ];
    const lakeSeeds: number[] = [];
    for (let r = 0, tries = 0; r < RIVERS && tries < RIVERS * 40; tries++) {
        // Highest of a few random spots on one face: sources sit nearer the
        // ridges, so rivers run further before they reach the sea.
        const f = rng.int(0, 5);
        let u = 0,
            v = 0,
            h0 = -1;
        for (let s = 0; s < 4; s++) {
            const su = rng.int(4, N - 5),
                sv = rng.int(4, N - 5),
                sh = grid.columnTop(f, su, sv);
            if (sh > h0) [u, v, h0] = [su, sv, sh];
        }
        // Sources in the uplands, on grass (springs, snowmelt below the bare rock).
        // Sources from 5 layers up (was 6), so lower hills get their own streams too.
        // Snowfields count too: snowmelt feeds the highest streams.
        if (h0 < seaLayer + 5 || !sourceIds.has(grid.get(f, u, v, h0))) continue;
        r++;
        let k = key(f, u, v);
        let hu = 0,
            hv = 0; // heading, in the current face's frame (reset on seam crossings)
        const seen = new Set<number>();
        let len = 0,
            flat = 0;
        // Per-river character, so no two rivers look alike: a few stay thin
        // streams, most widen into rivers; each snakes at its own amplitude and
        // wavelength, and its width swells and narrows along its length.
        const maxW = rng.chance(0.25) ? rng.range(1.2, 2) : rng.range(2.4, 4.6);
        const grow = rng.range(0.015, 0.035);
        const swing = rng.range(0.7, 1.5); // radians of heading swing at the bend apex
        const bendF = 1 / rng.range(10, 26); // bends per column (wavelength 2π/f)
        const inertia = rng.range(0.45, 0.8);
        const ph = rng() * 6.28,
            wph = rng() * 6.28;
        const flatMax = rng.int(8, 16);
        for (; len < 1600; len++) {
            seen.add(k);
            // Width grows downstream from a 1-block spring, wobbling ±20%.
            const wob = 1 + 0.2 * Math.sin(len * 0.045 + wph);
            stamp(k, Math.min(0.6 + len * grow, maxW) * wob);
            // Preferred heading swings side to side: the river meanders.
            const a = swing * Math.sin(len * bendF + ph),
                ca = Math.cos(a),
                sa = Math.sin(a);
            const pu = hu * ca - hv * sa,
                pv = hu * sa + hv * ca;
            const [cf, cu, cv] = unkey(k);
            const h = grid.columnTop(cf, cu, cv);
            if (h <= seaLayer) break; // reached the sea
            let best = -1,
                bestScore = Infinity,
                bu = 0,
                bv = 0;
            for (const [du, dv] of D8) {
                const j = step(cf, cu, cv, du, dv);
                if (seen.has(j)) continue;
                const hj = top(j);
                // Lower is better; inertia favours the current heading so it meanders
                // instead of zig-zagging; jitter breaks ties on flat terraces.
                const score = hj - (du * pu + dv * pv) * inertia + rng() * 0.3;
                if (score < bestScore) {
                    bestScore = score;
                    best = j;
                    bu = du;
                    bv = dv;
                }
            }
            if (best < 0) {
                // Boxed in by its own loops: pool into a lake rather than a dry tip.
                lakeSeeds.push(k);
                break;
            }
            const hb = top(best);
            if (hb > h) {
                // Uphill everywhere: a pit. Long flats end in a lake instead of a dry tip.
                if (++flat > flatMax) {
                    lakeSeeds.push(k);
                    break;
                }
            } else if (hb < h) flat = 0;
            if (unkey(best)[0] !== cf) {
                hu = 0; // new face, new frame
                hv = 0;
            } else {
                hu = hu * 0.6 + bu * 0.4;
                hv = hv * 0.6 + bv * 0.4;
            }
            k = best;
        }
    }

    /* ---- 3. lakes & ponds: rounded basins on gentle land ----------------- */
    // Spread evenly: each face gets its share, and a seed too close to an earlier
    // one is rejected, so lakes scatter over the land instead of clumping.
    const LAKES = 650; // was 450
    const MIN_GAP = 12; // was 14: room for the extra lakes
    const placed: Array<[number, number, number]> = [];
    for (let n = 0, tries = 0; n < LAKES && tries < LAKES * 60; tries++) {
        const f = n % 6,
            u = rng.int(10, N - 11),
            v = rng.int(10, N - 11);
        const h = grid.columnTop(f, u, v);
        if (h < seaLayer + 2 || !grassIds.has(grid.get(f, u, v, h))) continue;
        // Gentle ground only — a pond on a cliff edge would just spill.
        let ok = true;
        for (const [du, dv] of D8) if (Math.abs(grid.columnTop(f, u + du * 3, v + dv * 3) - h) > 2) ok = false;
        for (const [pf, pu, pv] of placed) if (pf === f && Math.hypot(pu - u, pv - v) < MIN_GAP) ok = false;
        if (!ok) continue;
        n++;
        placed.push([f, u, v]);
        lakeSeeds.push(key(f, u, v));
    }
    for (const k of lakeSeeds) {
        const [f, u, v] = unkey(k);
        const pond = rng.chance(0.6);
        const R = pond ? rng.range(1.6, 3.2) : rng.range(4, 8);
        // Lumpy outline: a few overlapping discs rather than one circle.
        stamp(k, R);
        for (let b = 0; b < (pond ? 1 : 4); b++)
            stamp(
                step(f, u, v, Math.round(rng.range(-R, R) * 0.6), Math.round(rng.range(-R, R) * 0.6)),
                R * rng.range(0.5, 0.8),
            );
    }

    /* ---- 4. surface per column: below the lowest bank -------------------- */
    // EVERY dry neighbour counts as a bank, including low beaches at sea level —
    // skipping those (and then flooring the surface at sea + 1) is what stood
    // water a layer above the sand beside it. A surface at or below the sea is
    // the sea's job: that reach is carved as a dry mouth and the sea fills it.
    const surf = new Map<number, number>();
    await maybeYield();
    let visited = 0;
    for (const [k] of half) {
        if ((++visited & 4095) === 0) await maybeYield();
        const [f, u, v] = unkey(k);
        const h = grid.columnTop(f, u, v);
        if (h <= seaLayer) continue; // the sea already covers it
        let bank = Infinity;
        for (let dv = -BANK_R; dv <= BANK_R; dv++)
            for (let du = -BANK_R; du <= BANK_R; du++) {
                const j = step(f, u, v, du, dv);
                if (!half.has(j)) bank = Math.min(bank, ground(j));
            }
        if (!Number.isFinite(bank)) bank = h;
        surf.set(k, Math.min(h, bank - 1));
    }
    // Relax: no surface more than one layer above a neighbour's surface, and never
    // above a dry 4-neighbour, so the river steps down with the land.
    // Iterate to a fixed point: a fixed pass count left long reaches unsettled.
    const D4 = D8.slice(0, 4);
    for (let changed = true; changed; ) {
        changed = false;
        await maybeYield();
        for (const [k, s0] of surf) {
            const [f, u, v] = unkey(k);
            let s = s0;
            for (const [du, dv] of D4) {
                const j = step(f, u, v, du, dv);
                const n = surf.get(j);
                // A neighbour whose water is the sea (surface at/below sea level, so it
                // holds no voxels) caps this column at sea level too — `n + 1` there
                // left a one-layer water ledge hanging over the open sea floor.
                if (n !== undefined) s = Math.min(s, n <= seaLayer ? seaLayer : n + 1);
                else if (!half.has(j)) s = Math.min(s, ground(j));
                // A channel column already in the sea (a mouth): likewise.
                else s = Math.min(s, seaLayer);
            }
            if (s !== s0) {
                surf.set(k, s);
                changed = true;
            }
        }
    }

    /* ---- 5. carve, then fill --------------------------------------------- */
    let cols = 0;
    for (const [k, s] of surf) {
        const [f, u, v] = unkey(k);
        const h = grid.columnTop(f, u, v);
        const depth = 1 + Math.round((half.get(k) ?? 0) * (RIVER_DEPTH - 1));
        const bed = Math.max(1, s - depth);
        // Clear everything above the bed — including any tree or bush standing here.
        for (let l = Math.min(h, SHELL_DEPTH - 1); l > bed; l--) grid.set(f, u, v, l, 0);
        grid.set(f, u, v, bed, BLOCKS.SAND.id);
        // At or below sea level the sea sphere is the water; no voxels needed.
        for (let l = Math.max(bed + 1, seaLayer + 1); l <= s; l++) grid.set(f, u, v, l, RIVER_WATER.id);
        grid.setPlant(f, u, v, 0);
        cols++;
    }

    /* ---- 6. drop stray puddles ------------------------------------------- */
    // Relaxation can strand a lone column or two of water between reaches that
    // fell to the sea; a 1-block puddle reads as a glitch, not a pond. Drain
    // any connected body smaller than MIN_BODY (its carved hollow stays as a dip).
    const MIN_BODY = 4;
    const isW = (k: number) => {
        const [f, u, v] = unkey(k);
        return grid.get(f, u, v, grid.columnTop(f, u, v)) === RIVER_WATER.id;
    };
    const done = new Set<number>();
    for (const k0 of surf.keys()) {
        if (done.has(k0) || !isW(k0)) continue;
        const body = [k0];
        done.add(k0);
        // Fill the whole body (not just MIN_BODY): a partial fill would leave the
        // rest of a big lake unvisited, to be mistaken for puddles later.
        for (let i = 0; i < body.length; i++) {
            const [f, u, v] = unkey(body[i]);
            for (const [du, dv] of D8.slice(0, 4)) {
                const j = step(f, u, v, du, dv);
                if (!done.has(j) && isW(j)) {
                    done.add(j);
                    body.push(j);
                }
            }
        }
        if (body.length >= MIN_BODY) continue;
        for (const k of body) {
            const [f, u, v] = unkey(k);
            for (let l = grid.columnTop(f, u, v); l > 0 && grid.get(f, u, v, l) === RIVER_WATER.id; l--)
                grid.set(f, u, v, l, 0);
            cols--;
        }
    }
    return { columns: cols, lakes: lakeSeeds.length };
}
