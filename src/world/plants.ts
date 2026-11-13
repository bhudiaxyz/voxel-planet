// src/world/plants.ts
// Ground cover: bush, shrub, cactus, fern/grass/moss blocks, the per-zone ground
// cover table, and their builders (bushes, cacti, dead trunks, single plants).
// Split out of terrain.ts; terrain.ts drives placement.
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { makeRng } from '../core/rng';
import { PATTERN, registerBlock } from '../core/palette';
import { DEADWOOD } from './trees';
import type { Zone } from './trees';

// Ground-cover and shrub block types — registered once, reused by scatter
const c = (hex: number) => new THREE.Color(hex);
// Flowering-shrub accents. These were pale blossom pastels that read as washed-out
// pink under the leafy shading; now deeper, richer flowering-shrub tones.
export const BUSH_ROSE = registerBlock('BUSH_ROSE', {
    top: c(0xa8485e), // deep raspberry
    side: c(0x8e3a4e),
    bottom: c(0x6e2c3c),
    tint: c(0xc46a7e),
    topTint: c(0xb4526a),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
export const BUSH_MAUVE = registerBlock('BUSH_MAUVE', {
    top: c(0x7a4a72), // plum heather
    side: c(0x653c5e),
    bottom: c(0x4e2e48),
    tint: c(0x9a6890),
    topTint: c(0x86547e),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
export const BUSH_CREAM = registerBlock('BUSH_CREAM', {
    top: c(0xb8924a), // warm honey / golden broom
    side: c(0x9c7a3c),
    bottom: c(0x7a5e2e),
    tint: c(0xd0ac64),
    topTint: c(0xc29c52),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
// Alpine scrub: was a pale pinky grey that stood out among the greens; now a
// deeper weathered grey-green, like wind-cut heath on high ground.
export const SCRUB_BLOCK = registerBlock('SCRUB', {
    top: c(0x6e7a64),
    side: c(0x5c6754),
    bottom: c(0x464f40),
    tint: c(0x8a9478),
    topTint: c(0x78846c),
    pattern: PATTERN.GRASS,
    rough: 0.6,
});
export const FERN = registerBlock('FERN', {
    top: c(0x4a6b3e),
    side: c(0x3d5933),
    bottom: c(0x2e4226),
    tint: c(0x3f5f35),
    topTint: c(0x5a7a48),
    pattern: PATTERN.GRASS,
    rough: 0.55,
});
export const FERN_RED = registerBlock('FERN_RED', {
    top: c(0x8b4a2e),
    side: c(0x7a3e26),
    bottom: c(0x612f1a),
    tint: c(0x7a3e26),
    topTint: c(0x9e5535),
    pattern: PATTERN.GRASS,
    rough: 0.55,
});
export const MOSS_THICK = registerBlock('MOSS_THICK', {
    top: c(0x8ab068),
    side: c(0x7da05a),
    bottom: c(0x6a8a4c),
    tint: c(0x7aa058),
    topTint: c(0x99c075),
    pattern: PATTERN.GRASS,
    rough: 0.5,
});
export const LICHEN_PALE = registerBlock('LICHEN_PALE', {
    top: c(0xc8cdb8),
    side: c(0xbcc1ab),
    bottom: c(0xadb295),
    tint: c(0xb8bda8),
    pattern: PATTERN.STONE,
    rough: 0.65,
});
// Tall shrub plant: was a pinky grey; now a dusky sage.
export const SHRUB_TALL = registerBlock('SHRUB_TALL', {
    top: c(0x7e8a62),
    side: c(0x6a7552),
    bottom: c(0x535c40),
    tint: c(0x96a276),
    topTint: c(0x8a966c),
    pattern: PATTERN.GRASS,
    rough: 0.5,
});
export const GRASS_TALL = registerBlock('GRASS_TALL', {
    top: c(0x5a7245),
    side: c(0x4e643c),
    bottom: c(0x3f5230),
    tint: c(0x526e3f),
    topTint: c(0x6a8450),
    pattern: PATTERN.GRASS,
    rough: 0.48,
});
// Reed: single tall column — placed near waterline
export const REED_BLOCK = registerBlock('REED', {
    top: c(0x8a9e6a),
    side: c(0x7a8e5c),
    bottom: c(0x68794c),
    tint: c(0x7a8e5c),
    topTint: c(0x9ab07a),
    pattern: PATTERN.GRASS,
    rough: 0.5,
});

/**
 * Cactus: solid like a trunk (isTrunk), so the player and the dog's pathfinder
 * treat it as an obstacle. Its own pattern gives ribbed green sides.
 */
export const CACTUS = registerBlock('CACTUS', {
    top: c(0x9cc064),
    side: c(0x84ae52),
    bottom: c(0x6a9040),
    tint: c(0x5e8a3c),
    pattern: PATTERN.CACTUS,
    rough: 0.5,
    isTrunk: true,
});
/** Saguaro / barrel crown: the pale, woolly growing tip. */
const CACTUS_CROWN = registerBlock('CACTUS_CROWN', {
    top: c(0xd8e0a8),
    side: c(0xb8cc80),
    bottom: c(0x9cb468),
    tint: c(0x8aa858),
    pattern: PATTERN.CACTUS,
    rough: 0.6,
    isTrunk: true,
});
/** Cactus flowers (crown and barrel rim). */
const CACTUS_FLOWER = registerBlock('CACTUS_FLOWER', {
    top: c(0xffe066),
    side: c(0xf2c94c),
    bottom: c(0xd4a52c),
    tint: c(0xfff2a8),
    pattern: PATTERN.NONE,
    rough: 0.3,
    isTrunk: true,
});
const CACTUS_FLOWER_PINK = registerBlock('CACTUS_FLOWER_PINK', {
    top: c(0xff7eb3),
    side: c(0xf06292),
    bottom: c(0xc2185b),
    tint: c(0xffb3d1),
    pattern: PATTERN.NONE,
    rough: 0.3,
    isTrunk: true,
});
/** Prickly-pear fruit on the paddle rims. */
const CACTUS_FRUIT = registerBlock('CACTUS_FRUIT', {
    top: c(0xd6336c),
    side: c(0xb02a5b),
    bottom: c(0x8a1f47),
    tint: c(0xe85d8a),
    pattern: PATTERN.NONE,
    rough: 0.35,
    isTrunk: true,
});
/** Dry desert scrub, drawn by the vegetation layer (see plantSingle). */
export const SCRUB_DRY = registerBlock('SCRUB_DRY', {
    top: c(0xb8a070),
    side: c(0x9c8458),
    bottom: c(0x7e6a44),
    tint: c(0x8a7650),
    topTint: c(0xc8b484),
    pattern: PATTERN.GRASS,
    rough: 0.6,
});

/*
 * Foliage bushes. The old bushes were dusty rose/mauve/cream (blossom palette)
 * with the grass pattern, so they read as pink lumps, not shrubs. These are real
 * leaf greens and are `sway` blocks, so they get the canopy shading (lit clumps,
 * shaded pockets, leaf speckle), per-plant shade variety, and a gentle sway —
 * and, like leaves, you can push through them.
 */
const shrub = (name: string, top: number, side: number) =>
    registerBlock(name, {
        top: c(top),
        side: c(side),
        bottom: c(side).multiplyScalar(0.78),
        tint: c(top).lerp(c(0xd8e8a0), 0.25),
        pattern: PATTERN.NONE,
        rough: 0.4,
        sway: true, // leafy shading + gentle sway…
        solid: true, // …but a bush is an obstacle, not walk-through like a canopy
    });
const SHRUB_SAGE = shrub('SHRUB_SAGE', 0x8aa070, 0x748a5c);
export const SHRUB_OLIVE = shrub('SHRUB_OLIVE', 0x7a8a3c, 0x66752f);
const SHRUB_DEEP = shrub('SHRUB_DEEP', 0x3f6a32, 0x325627);
const SHRUB_FOREST = shrub('SHRUB_FOREST', 0x4f7d3a, 0x41692f);
export const SHRUB_BLUEGREEN = shrub('SHRUB_BLUEGREEN', 0x5a8a74, 0x4a7461);
const SHRUB_LIME = shrub('SHRUB_LIME', 0x9cb84a, 0x84a03c);
export const SHRUB_RUSSET = shrub('SHRUB_RUSSET', 0x9a6a3a, 0x7e562e); // autumn / dry
/** Flowering accents: the old blossom bushes, now leafy too, used sparingly. */
for (const b of [BUSH_ROSE, BUSH_MAUVE, BUSH_CREAM, SCRUB_BLOCK])
    Object.assign(b, { sway: true, solid: true, pattern: PATTERN.NONE });
const BUSH_PALETTE = [SHRUB_FOREST, SHRUB_SAGE, SHRUB_DEEP, SHRUB_LIME, SHRUB_FOREST, BUSH_ROSE];

/** Ground-cover kinds the vegetation layer draws as sprites (see plantSingle). */
export const PLANT = { FERN, FERN_RED, MOSS_THICK, LICHEN_PALE, SHRUB_TALL, GRASS_TALL, REED: REED_BLOCK, SCRUB_DRY };

/**
 * Ground cover per zone (chance per grass column, after trees and dead trunks).
 * Lush ferns and tall grass by the water, flowering bushes in the lowlands,
 * tall shrubs mid-slope, then thin grey scrub and moss toward the treeline.
 */
export const GROUND: Record<Zone, { bush: number; fern: number; tall: number; bushes: any[]; talls: any[] }> = {
    coast: {
        bush: 0.015,
        fern: 0.03,
        tall: 0.03,
        bushes: [SHRUB_SAGE, SHRUB_BLUEGREEN, SHRUB_LIME, BUSH_CREAM],
        talls: [GRASS_TALL],
    },
    lowland: { bush: 0.035, fern: 0.03, tall: 0.02, bushes: BUSH_PALETTE, talls: [GRASS_TALL, SHRUB_TALL] },
    midland: {
        bush: 0.03,
        fern: 0.015,
        tall: 0.02,
        bushes: [SHRUB_FOREST, SHRUB_DEEP, SHRUB_OLIVE, SHRUB_RUSSET, BUSH_MAUVE],
        talls: [SHRUB_TALL],
    },
    highland: {
        bush: 0.02,
        fern: 0.006,
        tall: 0.012,
        bushes: [SHRUB_DEEP, SHRUB_BLUEGREEN, SCRUB_BLOCK, SHRUB_OLIVE],
        talls: [SHRUB_TALL, MOSS_THICK],
    },
    treeline: {
        bush: 0.012,
        fern: 0,
        tall: 0.02,
        bushes: [SHRUB_BLUEGREEN, SCRUB_BLOCK, SHRUB_RUSSET],
        talls: [MOSS_THICK, LICHEN_PALE],
    },
};

/** Small mound bush — 1-2 layers high, 1-3 wide */
/**
 * A dead trunk (snag): a bare column of weathered wood, broken off at the top,
 * with a few short dead branch stubs. Varied height (3–9) and stub count/heights;
 * one in four leans a step partway up, and one in five is just a low stump.
 */
export function plantDeadTrunk(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    rng: ReturnType<typeof makeRng>,
) {
    const set = (du: number, dl: number, dv: number) => {
        const nu = u + du,
            nv = v + dv,
            nl = surfaceLayer + 1 + dl;
        if (nu < 1 || nv < 1 || nu >= FACE_RES - 1 || nv >= FACE_RES - 1 || nl >= SHELL_DEPTH) return false;
        if (grid.get(face, nu, nv, nl) !== 0) return false;
        grid.set(face, nu, nv, nl, DEADWOOD.id);
        return true;
    };
    if (rng.chance(0.2)) {
        // Stump: 1–2 high, sometimes with a fallen section lying beside it.
        const h = rng.int(1, 2);
        for (let l = 0; l < h; l++) set(0, l, 0);
        if (rng.chance(0.5)) {
            const [du, dv] = rng.pick([
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
            ] as Array<[number, number]>);
            const len = rng.int(2, 3);
            for (let r = 2; r < 2 + len; r++)
                if (grid.columnTop(face, u + du * r, v + dv * r) === surfaceLayer) set(du * r, 0, dv * r);
        }
        return;
    }
    const height = rng.int(3, 9);
    // Lean: the upper part steps one block sideways.
    const leanAt = rng.chance(0.25) ? rng.int(2, height - 1) : height + 1;
    const [lu, lv] = rng.pick([
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ] as Array<[number, number]>);
    let ou = 0,
        ov = 0;
    for (let l = 0; l < height; l++) {
        if (l === leanAt) {
            // Joint block at the bend, so the lean reads as one trunk, not two stacked cubes.
            set(ou + lu, l - 1, ov + lv);
            ou += lu;
            ov += lv;
        }
        if (!set(ou, l, ov)) return;
    }
    // Dead branch stubs: short, one or two blocks, sticking straight out.
    const stubs = height >= 5 ? rng.int(1, 3) : rng.int(0, 1);
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    for (let s = 0; s < stubs; s++) {
        const [du, dv] = dirs[Math.floor(rng() * 4)];
        const at = rng.int(Math.max(2, Math.floor(height / 3)), height - 1);
        const base = at >= leanAt ? [ou, ov] : [0, 0];
        const len = rng.chance(0.35) ? 2 : 1;
        for (let r = 1; r <= len; r++) set(base[0] + du * r, at, base[1] + dv * r);
    }
}

/**
 * A voxel cactus, shaped after the real plants:
 *   saguaro      — tall ribbed column, 2x2 at the base when big; arms leave the
 *                  trunk at different heights, run out one block, turn up
 *                  through a joint and taper; a pale crown, sometimes in flower
 *   barrel       — squat and round: a plus-shaped body wider in the middle, a
 *                  ring of flowers on the crown
 *   prickly pear — flat paddle pads (2 wide, 1 thick) stacked at angles off one
 *                  another, red fruit on the rims
 *   organ pipe   — many slim stems fanning out from one shared base
 * Only placed where the cells are clear and the ground is level, like every
 * other plant.
 */
export function plantCactus(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    rng: ReturnType<typeof makeRng>,
) {
    const setId = (du: number, dl: number, dv: number, id: number) => {
        const nu = u + du,
            nv = v + dv,
            nl = surfaceLayer + 1 + dl;
        if (nu < 1 || nv < 1 || nu >= FACE_RES - 1 || nv >= FACE_RES - 1 || nl >= SHELL_DEPTH) return false;
        if (grid.get(face, nu, nv, nl) !== 0) return false;
        grid.set(face, nu, nv, nl, id);
        return true;
    };
    const set = (du: number, dl: number, dv: number) => setId(du, dl, dv, CACTUS.id);
    const ground = (du: number, dv: number) => grid.columnTop(face, u + du, v + dv);
    const level = (cells: Array<[number, number]>) => cells.every(([du, dv]) => ground(du, dv) === surfaceLayer);
    const DIRS: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    const kind = rng.pick(['saguaro', 'saguaro', 'saguaro', 'barrel', 'barrel', 'pear', 'pear', 'organ'] as const);

    if (kind === 'barrel') {
        // Plus-shaped body (centre + 4 sides), the sides one layer shorter, so
        // the silhouette bulges in the middle and rounds over at the top.
        const big = rng.chance(0.5);
        const cells: Array<[number, number]> = big ? [[0, 0], ...DIRS] : [[0, 0]];
        if (!level(cells)) return;
        const h = big ? rng.int(2, 3) : rng.int(1, 2);
        for (let l = 0; l < h; l++) set(0, l, 0);
        if (big) for (const [du, dv] of DIRS) for (let l = 0; l < h - 1; l++) set(du, l, dv);
        // Flowers ring the crown.
        const flower = rng.pick([CACTUS_FLOWER, CACTUS_FLOWER_PINK]);
        if (big) for (const [du, dv] of DIRS) if (rng.chance(0.6)) setId(du, h - 1, dv, flower.id);
        setId(0, h, 0, rng.chance(0.5) ? flower.id : CACTUS_CROWN.id);
        return;
    }

    if (kind === 'pear') {
        // Paddles: each a 2-wide, 2-tall, 1-thick slab; the next one grows off a
        // top corner of the last, turned 90 degrees, so the clump zig-zags.
        if (!level([[0, 0]])) return;
        let ou = 0,
            ol = 0,
            ov = 0;
        let alongU = rng.chance(0.5);
        const pads = rng.int(3, 6);
        for (let k = 0; k < pads; k++) {
            const cells: Array<[number, number]> = alongU
                ? [
                      [ou, ov],
                      [ou + 1, ov],
                  ]
                : [
                      [ou, ov],
                      [ou, ov + 1],
                  ];
            for (const [cu, cv] of cells) for (let l = 0; l < 2; l++) set(cu, ol + l, cv);
            // Fruit on the rim.
            if (rng.chance(0.35)) setId(cells[1][0], ol + 2, cells[1][1], CACTUS_FRUIT.id);
            // Next pad from a top corner, turned.
            const [nu, nv] = rng.pick(cells);
            ou = nu;
            ov = nv;
            ol += 2;
            alongU = !alongU;
            if (ol > 7) break;
        }
        return;
    }

    if (kind === 'organ') {
        // Many slim stems from one shared low base, fanning out a little as they rise.
        if (!level([[0, 0], ...DIRS])) return;
        set(0, 0, 0);
        for (const [du, dv] of DIRS) set(du, 0, dv);
        const stems: Array<[number, number]> = [[0, 0], ...DIRS, [1, 1], [-1, -1], [1, -1], [-1, 1]];
        const n = rng.int(4, 7);
        for (let k = 0; k < n; k++) {
            let [su, sv] = stems[k];
            const h = rng.int(3, 7);
            for (let l = 1; l <= h; l++) {
                // Lean outward one step partway up.
                if (l === Math.floor(h / 2) && (su || sv) && rng.chance(0.5)) {
                    set(su, l, sv); // joint
                    su += Math.sign(su);
                    sv += Math.sign(sv);
                }
                set(su, l, sv);
            }
            setId(su, h + 1, sv, CACTUS_CROWN.id);
        }
        return;
    }

    // Saguaro
    const height = rng.int(5, 11);
    const thick =
        height >= 8 &&
        level([
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]);
    if (!level([[0, 0]])) return;
    // Trunk: 2x2 for the lower third of a big one, then a single column.
    for (let l = 0; l < height; l++) {
        if (!set(0, l, 0)) return;
        if (thick && l < height / 3) {
            set(1, l, 0);
            set(0, l, 1);
            set(1, l, 1);
        }
    }
    // Pale crown, and in flower now and then.
    setId(0, height, 0, rng.chance(0.3) ? CACTUS_FLOWER.id : CACTUS_CROWN.id);
    // Arms: shuffled directions, each at its own height; out one (or two), up
    // through a joint, tapering to a pale tip.
    const dirs = DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    const arms = height >= 6 ? rng.int(1, Math.min(4, height - 4)) : 0;
    const used = new Set<number>();
    for (let a = 0; a < arms; a++) {
        const [du, dv] = dirs[a];
        let at = rng.int(Math.ceil(height * 0.35), height - 3);
        while (used.has(at) && at < height - 2) at++; // stagger the arm heights
        used.add(at);
        const off = thick && at < height / 3 && (du > 0 || dv > 0) ? 1 : 0; // clear the 2x2 base
        const reach = 1 + off + (rng.chance(0.25) ? 1 : 0);
        const rise = rng.int(2, Math.max(2, height - at - 1));
        let ok = true;
        for (let r = 1; r <= reach && ok; r++) ok = set(du * r, at, dv * r);
        for (let l = 1; l <= rise && ok; l++) ok = set(du * reach, at + l, dv * reach);
        if (ok) setId(du * reach, at + rise + 1, dv * reach, CACTUS_CROWN.id);
    }
}

export function plantSphereBush(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    rng: ReturnType<typeof makeRng>,
    block: { id: number },
) {
    const w = rng.chance(0.3) ? 2 : rng.chance(0.7) ? 1 : 0;
    const h = w >= 2 ? rng.int(2, 3) : w === 1 ? rng.int(1, 2) : 1;
    for (let dv = -w; dv <= w; dv++) {
        for (let du = -w; du <= w; du++) {
            const nu = u + du,
                nv = v + dv;
            if (nu < 1 || nv < 1 || nu >= FACE_RES - 1 || nv >= FACE_RES - 1) continue;
            // only on flat ground (same surface layer ±1)
            if (Math.abs(grid.columnTop(face, nu, nv) - surfaceLayer) > 1) continue;
            const e = Math.abs(du) + Math.abs(dv);
            if (e > w + (w >= 2 ? 1 : 0)) continue;
            const hh = Math.max(1, h - (e >= w ? 1 : 0));
            for (let dy = 1; dy <= hh; dy++) {
                const nl = surfaceLayer + dy;
                if (nl >= SHELL_DEPTH) break;
                if (grid.get(face, nu, nv, nl) !== 0) continue;
                grid.set(face, nu, nv, nl, block.id);
            }
        }
    }
}

/** Place a single decorative block one layer above the surface. */
/**
 * Ground cover (ferns, tall grass, reeds, moss, lichen). Recorded per column
 * and drawn by the vegetation layer as blades/fronds — not a voxel cube, so
 * it doesn't block movement or read as a box. Same occupancy rule as before:
 * only where nothing already stands on the column.
 */
export function plantSingle(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    block: { id: number },
) {
    const nl = surfaceLayer + 1;
    if (nl >= SHELL_DEPTH) return;
    if (grid.get(face, u, v, nl) !== 0) return;
    grid.setPlant(face, u, v, block.id);
}
