// src/world/terrain.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { basisFromCode } from '../core/geoutil';
import { Noise3 } from '../core/noise3';
import { makeRng } from '../core/rng';
import { BLOCKS, PATTERN, registerBlock } from '../core/palette';

// Sea level is layer 9; terrace step is 2 (same aesthetic as flat terrain)
const SEA_LAYER = 11;
const TERRACE_STEP = 2;
const AMPLITUDE = 24; // max layers above/below sea level

// Ground-cover and shrub block types — registered once, reused by scatter
const c = (hex: number) => new THREE.Color(hex);
const BUSH_ROSE = registerBlock('BUSH_ROSE', {
    top: c(0xdec3c8),
    side: c(0xd3b5bc),
    bottom: c(0xc1a3aa),
    tint: c(0xd0adb4),
    topTint: c(0xd6b9be),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
const BUSH_MAUVE = registerBlock('BUSH_MAUVE', {
    top: c(0xd2c3ca),
    side: c(0xc6b5be),
    bottom: c(0xb3a3ab),
    tint: c(0xc2afb8),
    topTint: c(0xcabac1),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
const BUSH_CREAM = registerBlock('BUSH_CREAM', {
    top: c(0xe6dac9),
    side: c(0xdbcdbb),
    bottom: c(0xc8baa8),
    tint: c(0xd6c7b4),
    topTint: c(0xdfd2c1),
    pattern: PATTERN.GRASS,
    rough: 0.45,
});
const SCRUB_BLOCK = registerBlock('SCRUB', {
    top: c(0xc6bcbe),
    side: c(0xbaafb2),
    bottom: c(0xa79ca0),
    tint: c(0xb5a9ad),
    topTint: c(0xbfb4b7),
    pattern: PATTERN.GRASS,
    rough: 0.6,
});
const FERN = registerBlock('FERN', {
    top: c(0x4a6b3e),
    side: c(0x3d5933),
    bottom: c(0x2e4226),
    tint: c(0x3f5f35),
    topTint: c(0x5a7a48),
    pattern: PATTERN.GRASS,
    rough: 0.55,
});
const FERN_RED = registerBlock('FERN_RED', {
    top: c(0x8b4a2e),
    side: c(0x7a3e26),
    bottom: c(0x612f1a),
    tint: c(0x7a3e26),
    topTint: c(0x9e5535),
    pattern: PATTERN.GRASS,
    rough: 0.55,
});
const MOSS_THICK = registerBlock('MOSS_THICK', {
    top: c(0x8ab068),
    side: c(0x7da05a),
    bottom: c(0x6a8a4c),
    tint: c(0x7aa058),
    topTint: c(0x99c075),
    pattern: PATTERN.GRASS,
    rough: 0.5,
});
const LICHEN_PALE = registerBlock('LICHEN_PALE', {
    top: c(0xc8cdb8),
    side: c(0xbcc1ab),
    bottom: c(0xadb295),
    tint: c(0xb8bda8),
    pattern: PATTERN.STONE,
    rough: 0.65,
});
const SHRUB_TALL = registerBlock('SHRUB_TALL', {
    top: c(0xb8a0a8),
    side: c(0xac9298),
    bottom: c(0x9a8088),
    tint: c(0xa89098),
    topTint: c(0xb8a2a8),
    pattern: PATTERN.GRASS,
    rough: 0.5,
});
const GRASS_TALL = registerBlock('GRASS_TALL', {
    top: c(0x5a7245),
    side: c(0x4e643c),
    bottom: c(0x3f5230),
    tint: c(0x526e3f),
    topTint: c(0x6a8450),
    pattern: PATTERN.GRASS,
    rough: 0.48,
});
// Reed: single tall column — placed near waterline
const REED_BLOCK = registerBlock('REED', {
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
const CACTUS = registerBlock('CACTUS', {
    top: c(0x9cc064),
    side: c(0x84ae52),
    bottom: c(0x6a9040),
    tint: c(0x5e8a3c),
    pattern: PATTERN.CACTUS,
    rough: 0.5,
    isTrunk: true,
});
/** Dry desert scrub, drawn by the vegetation layer (see plantSingle). */
const SCRUB_DRY = registerBlock('SCRUB_DRY', {
    top: c(0xb8a070),
    side: c(0x9c8458),
    bottom: c(0x7e6a44),
    tint: c(0x8a7650),
    topTint: c(0xc8b484),
    pattern: PATTERN.GRASS,
    rough: 0.6,
});
/**
 * Dead, weathered wood: bleached grey-brown. The bark pattern gives it furrows,
 * and isTrunk makes it solid and lets the vegetation layer read it as a trunk.
 */
const DEADWOOD = registerBlock('DEADWOOD', {
    top: c(0x9a8c78),
    side: c(0x857866),
    bottom: c(0x6e6252),
    tint: c(0x6a5e4e),
    pattern: PATTERN.BARK,
    rough: 0.7,
    isTrunk: true,
});
/** Birch: pale bark with the bark pattern's furrows (reads as dark streaks on white). */
const BIRCH = registerBlock('BIRCH', {
    top: c(0xd8d2c4),
    side: c(0xcac2b2),
    bottom: c(0xa8a092),
    tint: c(0x5a5248),
    pattern: PATTERN.BARK,
    rough: 0.5,
    isTrunk: true,
});

/** Per grass/stone column above the lowlands: a dead trunk, rarer than living trees. */
const DEAD_TRUNK_P = 0.0012;
/** Dead trunks only from the grassland/forest band upward (layers above sea). */
const DEAD_TRUNK_MIN_RISE = 3;

/** Desert band: the hottest land (see isDesert's temp), within this many layers of the sea. */
const DESERT_TEMP = 0.8;
const DESERT_MAX_RISE = 6;
/** Chance per desert sand column of a cactus — sparse, so each one stands alone. */
const CACTUS_P = 0.006;

const BUSH_PALETTE = [BUSH_ROSE, BUSH_MAUVE, BUSH_CREAM, BUSH_ROSE, BUSH_MAUVE];

/** Ground-cover kinds the vegetation layer draws as sprites (see plantSingle). */
export const PLANT = { FERN, FERN_RED, MOSS_THICK, LICHEN_PALE, SHRUB_TALL, GRASS_TALL, REED: REED_BLOCK, SCRUB_DRY };

export function generateSphereTerrain(
    seed: number,
    onProgress?: (p: number) => void,
): { grid: SphereVoxelGrid; spawn: { face: number; u: number; v: number } } {
    const grid = new SphereVoxelGrid();
    const noise = new Noise3(seed);
    const noise2 = new Noise3(seed + 101);
    const _n = new THREE.Vector3(),
        _tu = new THREE.Vector3(),
        _tv = new THREE.Vector3();
    const _dir = new THREE.Vector3();
    const { GRASS, GRASS_LIGHT, STONE, STONE_PALE, SOIL, SAND } = BLOCKS;

    for (let face = 0; face < 6; face++) {
        basisFromCode(face, _n, _tu, _tv);
        for (let v = 0; v < FACE_RES; v++) {
            for (let u = 0; u < FACE_RES; u++) {
                _dir.copy(_n)
                    .addScaledVector(_tu, (2 * (u + 0.5)) / FACE_RES - 1)
                    .addScaledVector(_tv, (2 * (v + 0.5)) / FACE_RES - 1)
                    .normalize();

                const e = elevationAt(noise, noise2, _dir.x, _dir.y, _dir.z);
                const terraced = TERRACE_STEP * Math.round((e * AMPLITUDE) / TERRACE_STEP);
                const surfaceLayer = Math.max(1, Math.min(SHELL_DEPTH - 10, SEA_LAYER + terraced));
                const isLand = surfaceLayer > SEA_LAYER;
                const desert = isLand && isDesert(noise, _dir, e, surfaceLayer);

                for (let layer = 0; layer <= surfaceLayer; layer++) {
                    let id: number;
                    if (!isLand) {
                        id = layer === surfaceLayer ? SAND.id : STONE.id;
                    } else if (layer === surfaceLayer) {
                        id = desert ? SAND.id : selectSurface(noise, _dir, e, GRASS, GRASS_LIGHT, STONE_PALE);
                    } else if (layer >= surfaceLayer - 2) {
                        id = desert ? SAND.id : SOIL.id; // dunes are sand all the way down to rock
                    } else {
                        id = selectRock(noise, _dir, layer, STONE, STONE_PALE);
                    }
                    grid.set(face, u, v, layer, id);
                }
            }
            if (onProgress && v % 40 === 0) onProgress((face * FACE_RES + v) / (6 * FACE_RES));
        }
    }

    const spawn = findSpawn(grid);

    // Scatter voxel trees and bushes on land columns
    const treeRng = makeRng(seed ^ 0x7ace31);
    const LEAVES = [
        BLOCKS.LEAF_PINK,
        BLOCKS.LEAF_BLUSH,
        BLOCKS.LEAF_LILAC,
        BLOCKS.LEAF_CREAM,
        BLOCKS.LEAF_MINT,
        BLOCKS.LEAF_ROSE,
    ];
    const GRASS_IDS = new Set([BLOCKS.GRASS.id, BLOCKS.GRASS_LIGHT.id, BLOCKS.GRASS_DEEP.id]);
    const STONE_IDS = new Set([BLOCKS.STONE.id, BLOCKS.STONE_PALE.id]);
    // Leaf colours by role (palette slot roles: 0 primary, 1 pale, 2 accent, 3 cream,
    // 4 leaf green, 5 deep). Each zone draws from the roles that suit it, so every
    // theme keeps the altitude logic in its own colours.
    const LEAF_ROLE = {
        broad: [LEAVES[0], LEAVES[1], LEAVES[4], LEAVES[4]],
        flowering: [LEAVES[2]],
        conifer: [LEAVES[5], LEAVES[4], LEAVES[5]],
        birch: [LEAVES[1], LEAVES[3]],
    };

    for (let face = 0; face < 6; face++) {
        for (let v = 0; v < FACE_RES; v++) {
            for (let u = 0; u < FACE_RES; u++) {
                const sl = grid.columnTop(face, u, v);
                const topId = grid.get(face, u, v, sl);

                const roll = treeRng();
                if (sl > SEA_LAYER + 1 && GRASS_IDS.has(topId)) {
                    const zone = zoneOf(sl - SEA_LAYER);
                    if (roll < ZONE[zone].treeP) plantZoneTree(grid, face, u, v, sl, treeRng, zone, LEAF_ROLE);
                    else if (roll < 0.012 + DEAD_TRUNK_P && sl >= SEA_LAYER + DEAD_TRUNK_MIN_RISE)
                        plantDeadTrunk(grid, face, u, v, sl, treeRng);
                    else if (roll < 0.042) plantSphereBush(grid, face, u, v, sl, treeRng, treeRng.pick(BUSH_PALETTE));
                    else if (roll < 0.065) plantSingle(grid, face, u, v, sl, treeRng.chance(0.6) ? FERN : FERN_RED);
                    else if (roll < 0.08)
                        plantSingle(grid, face, u, v, sl, sl < SEA_LAYER + 4 ? GRASS_TALL : SHRUB_TALL);
                } else if (sl > SEA_LAYER + 1 && STONE_IDS.has(topId)) {
                    // Cold rock: conifers where the highland is, a thin cover lower down,
                    // and wind-killed snags standing alone on the slopes.
                    const zone = zoneOf(sl - SEA_LAYER);
                    const onRockP = zone === 'highland' ? 0.01 : zone === 'treeline' ? 0.005 : 0.0025;
                    if (roll < onRockP)
                        plantZoneTree(
                            grid,
                            face,
                            u,
                            v,
                            sl,
                            treeRng,
                            zone === 'treeline' ? 'treeline' : 'highland',
                            LEAF_ROLE,
                        );
                    else if (roll < onRockP + DEAD_TRUNK_P * 1.5) plantDeadTrunk(grid, face, u, v, sl, treeRng);
                    else if (roll < 0.018)
                        plantSphereBush(grid, face, u, v, sl, treeRng, treeRng.chance(0.7) ? SCRUB_BLOCK : BUSH_MAUVE);
                    else if (roll < 0.055)
                        plantSingle(grid, face, u, v, sl, treeRng.chance(0.5) ? MOSS_THICK : LICHEN_PALE);
                } else if (sl > SEA_LAYER + 1 && topId === BLOCKS.SAND.id) {
                    // Desert dunes: sparse cacti, each one its own height and shape.
                    if (roll < CACTUS_P) plantCactus(grid, face, u, v, sl, treeRng);
                    else if (roll < CACTUS_P + 0.012) plantSingle(grid, face, u, v, sl, SCRUB_DRY);
                } else if (sl >= SEA_LAYER - 1 && sl <= SEA_LAYER + 2) {
                    // Waterline: reeds and waterside ferns
                    if (roll < 0.08) plantSingle(grid, face, u, v, sl, REED_BLOCK);
                    else if (roll < 0.13) plantSingle(grid, face, u, v, sl, FERN);
                }
            }
        }
    }

    return { grid, spawn };
}

function elevationAt(noise: Noise3, noise2: Noise3, x: number, y: number, z: number): number {
    // Domain-warped FBM — identical to planet-explorer Planet.elevationAt()
    const f = 1.6,
        o = 5,
        w = 0.25,
        q = f * 0.8;
    const wx = x + w * noise2.get(x * q + 11, y * q, z * q);
    const wy = y + w * noise2.get(x * q, y * q + 17, z * q);
    const wz = z + w * noise2.get(x * q, y * q, z * q + 23);
    const base = noise.fbm(wx * f, wy * f, wz * f, o, 2.0, 0.5) * 1.1;
    const hills = noise.get(wx * f * 3.1 + 9, wy * f * 3.1, wz * f * 3.1) * 0.06;
    const mm = smoothstep(-0.1, 0.35, noise2.get(wx * f * 0.6 + 7, wy * f * 0.6, wz * f * 0.6));
    const ridged = Math.max(0, 1 - Math.abs(noise2.fbm(wx * f * 1.5, wy * f * 1.5, wz * f * 1.5, o, 2.0, 0.5) * 2));
    const e = base + hills + 0.8 * mm * ridged * ridged * 0.8 - 0.05;
    return e < 0 ? e * 0.5 : e;
}

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Hot, dry, low land: the warmest band near the equator, close to sea level. */
function isDesert(noise: Noise3, dir: THREE.Vector3, e: number, surfaceLayer: number): boolean {
    const temp = 1 - 1.1 * dir.y * dir.y - 1.2 * Math.max(e, 0);
    if (surfaceLayer > SEA_LAYER + DESERT_MAX_RISE) return false;
    // Ragged edge: noise pushes the boundary in and out so dunes meet grass in tongues.
    const edge = noise.get(dir.x * 9 + 40, dir.y * 9, dir.z * 9) * 0.08;
    return temp + edge > DESERT_TEMP;
}

function selectSurface(
    noise: Noise3,
    dir: THREE.Vector3,
    e: number,
    grass: any,
    grassLight: any,
    stonePale: any,
): number {
    // ponytail: simple temp proxy from latitude (dir.y) + elevation
    const temp = 1 - 1.1 * dir.y * dir.y - 1.2 * Math.max(e, 0);
    if (temp > 0.6) return grass.id;
    if (temp > 0.2) return grassLight.id;
    return stonePale.id;
}

function selectRock(noise: Noise3, dir: THREE.Vector3, layer: number, stone: any, stonePale: any): number {
    const v = noise.get(dir.x * 12 + layer * 0.3, dir.y * 12, dir.z * 12);
    return v > 0.2 ? stonePale.id : stone.id;
}

/* ============================================================================
 * Trees by altitude.
 *
 * Height above sea (layers) picks a zone; the zone picks the species mix, the
 * size range and which leaf-colour roles to use. Within a zone every tree draws
 * its own continuous size, so a forest holds saplings, mid trees and giants.
 *
 *   coast     2–3   palms, broad shade trees
 *   lowland   4–7   rainforest emergents, broadleaf canopy, palms near water
 *   midland   8–11  mixed broadleaf, birch, the first firs
 *   highland 12–15  firs and spruces, tall tiered conifers
 *   treeline   16+  sparse, short, wind-bent pines (krummholz)
 * ========================================================================== */
type Zone = 'coast' | 'lowland' | 'midland' | 'highland' | 'treeline';
type Species = 'broadleaf' | 'palm' | 'emergent' | 'birch' | 'fir' | 'spruce' | 'krummholz';

const zoneOf = (rise: number): Zone =>
    rise <= 3 ? 'coast' : rise <= 7 ? 'lowland' : rise <= 11 ? 'midland' : rise <= 15 ? 'highland' : 'treeline';

/** Per zone: tree chance per grass column, species weights, size range (0..1). */
const ZONE: Record<Zone, { treeP: number; mix: Array<[Species, number]>; size: [number, number] }> = {
    coast: {
        treeP: 0.011,
        mix: [
            ['palm', 5],
            ['broadleaf', 3],
        ],
        size: [0.35, 0.85],
    },
    lowland: {
        treeP: 0.016,
        mix: [
            ['broadleaf', 6],
            ['emergent', 2],
            ['palm', 1],
        ],
        size: [0.2, 1.0],
    },
    midland: {
        treeP: 0.013,
        mix: [
            ['broadleaf', 5],
            ['birch', 3],
            ['fir', 2],
        ],
        size: [0.2, 0.9],
    },
    highland: {
        treeP: 0.012,
        mix: [
            ['fir', 5],
            ['spruce', 4],
            ['birch', 1],
        ],
        size: [0.3, 1.0],
    },
    treeline: {
        treeP: 0.006,
        mix: [
            ['krummholz', 6],
            ['spruce', 1],
        ],
        size: [0.15, 0.5],
    },
};

function weightedPick<T>(mix: Array<[T, number]>, rng: ReturnType<typeof makeRng>): T {
    let total = 0;
    for (const [, w] of mix) total += w;
    let r = rng() * total;
    for (const [s, w] of mix) if ((r -= w) <= 0) return s;
    return mix[mix.length - 1][0];
}

function plantZoneTree(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    rng: ReturnType<typeof makeRng>,
    zone: Zone,
    roles: Record<'broad' | 'flowering' | 'conifer' | 'birch', any[]>,
) {
    const z = ZONE[zone];
    const species = weightedPick(z.mix, rng);
    const size = rng.range(z.size[0], z.size[1]);
    if (species === 'broadleaf') {
        // The existing broadleaf forms, with zone-picked colours (a few flowering trees).
        const leaves = rng.chance(0.12) ? roles.flowering.concat(roles.broad) : roles.broad;
        plantSphereTree(grid, face, u, v, surfaceLayer, rng, leaves, size);
        return;
    }
    const set = (du: number, dl: number, dv: number, id: number) => {
        const nu = u + du,
            nv = v + dv,
            nl = surfaceLayer + 1 + dl;
        if (nu < 1 || nv < 1 || nu >= FACE_RES - 1 || nv >= FACE_RES - 1 || nl >= SHELL_DEPTH) return false;
        if (grid.get(face, nu, nv, nl) !== 0) return false;
        grid.set(face, nu, nv, nl, id);
        return true;
    };
    /** A flat disc of leaves (radius r, Chebyshev with clipped corners) at height dl. */
    const disc = (cu: number, dl: number, cv: number, r: number, id: number, ragged = 0.0) => {
        for (let dv = -r; dv <= r; dv++)
            for (let du = -r; du <= r; du++) {
                const d = Math.abs(du) + Math.abs(dv);
                if (d > r + Math.floor(r / 2)) continue; // round off the square
                if (ragged && d >= r && rng() < ragged) continue;
                set(cu + du, dl, cv + dv, id);
            }
    };
    const pick = (arr: any[]) => arr[Math.floor(rng() * arr.length)].id;
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    switch (species) {
        case 'palm': {
            // Slim trunk curving one way as it climbs, a crown of drooping fronds.
            const h = Math.round(6 + size * 7);
            const [lu, lv] = dirs[Math.floor(rng() * 4)];
            let ou = 0,
                ov = 0;
            for (let l = 0; l < h; l++) {
                if (l > h * 0.45 && l % 3 === 0) {
                    set(ou + lu, l - 1, ov + lv, BLOCKS.TRUNK_PALE.id); // joint, so the bend reads as one trunk
                    ou += lu;
                    ov += lv;
                }
                set(ou, l, ov, BLOCKS.TRUNK_PALE.id);
            }
            const leaf = pick(roles.broad);
            const len = Math.round(2 + size * 3);
            set(ou, h, ov, leaf);
            for (const [du, dv] of [...dirs, [1, 1], [1, -1], [-1, 1], [-1, -1]] as Array<[number, number]>)
                for (let r = 1; r <= len; r++) set(ou + du * r, h - (r > len / 2 ? 1 : 0), ov + dv * r, leaf); // fronds droop at the tips
            return;
        }
        case 'emergent': {
            // Rainforest giant: tall bare trunk (2×2 when big), buttress roots, a wide
            // flat-topped layered crown above the canopy around it.
            const h = Math.round(11 + size * 9);
            const thick = size > 0.55;
            const trunk = BLOCKS.TRUNK.id;
            for (let l = 0; l < h; l++) {
                set(0, l, 0, trunk);
                if (thick) {
                    set(1, l, 0, trunk);
                    set(0, l, 1, trunk);
                    set(1, l, 1, trunk);
                }
            }
            for (const [du, dv] of dirs) set(du * (thick ? 2 : 1), 0, dv * (thick ? 2 : 1), trunk); // buttresses
            const leaf = pick(roles.broad),
                leaf2 = pick(roles.broad);
            const r = Math.round(3 + size * 3);
            disc(0, h, 0, r, leaf, 0.35);
            disc(rng.int(-1, 1), h + 1, rng.int(-1, 1), r - 1, leaf2, 0.25);
            disc(0, h + 2, 0, Math.max(1, r - 3), leaf, 0.2);
            // A lower, smaller tier partway up — the canopy's layered look.
            const mid = Math.round(h * 0.6);
            const [bu, bv] = dirs[Math.floor(rng() * 4)];
            disc(bu * 2, mid, bv * 2, Math.max(1, r - 3), leaf2, 0.3);
            return;
        }
        case 'birch': {
            // Slim pale trunk, light open crown in pale/cream leaves.
            const h = Math.round(5 + size * 6);
            for (let l = 0; l < h; l++) set(0, l, 0, BIRCH.id);
            const leaf = pick(roles.birch);
            const r = size > 0.5 ? 2 : 1;
            for (let l = Math.round(h * 0.55); l <= h; l++) disc(0, l, 0, l === h ? Math.max(1, r - 1) : r, leaf, 0.45);
            set(0, h + 1, 0, leaf);
            return;
        }
        case 'fir':
        case 'spruce': {
            // Conifer: tiers that shrink toward a pointed top. Firs are taller and
            // narrower with gaps between tiers; spruces are denser and wider.
            const fir = species === 'fir';
            const h = Math.round((fir ? 8 : 6) + size * (fir ? 10 : 7));
            const base = fir ? 2 : 1; // bare trunk below the lowest tier
            for (let l = 0; l < h; l++) set(0, l, 0, BLOCKS.TRUNK.id);
            const leaf = pick(roles.conifer);
            const maxR = Math.max(1, Math.round((fir ? 2 : 3) * (0.5 + size * 0.6)));
            for (let l = base; l <= h; l++) {
                const t = (l - base) / Math.max(1, h - base); // 0 at the bottom tier, 1 at the top
                if (fir && l % 2 === 1 && t < 0.85) continue; // gaps between fir tiers
                const r = Math.max(0, Math.round(maxR * (1 - t)));
                if (r === 0) set(0, l, 0, leaf);
                else disc(0, l, 0, r, leaf, fir ? 0.15 : 0.08);
            }
            set(0, h + 1, 0, leaf); // the point
            return;
        }
        case 'krummholz': {
            // Treeline pine: short, gnarled, crown swept to one side by the wind.
            const h = Math.round(2 + size * 3);
            const [wu, wv] = dirs[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(0, l, 0, BLOCKS.TRUNK.id);
            const leaf = pick(roles.conifer);
            for (let l = 1; l <= h; l++) {
                set(0, l, 0, leaf);
                for (let r = 1; r <= 1 + (l < h ? 1 : 0); r++) set(wu * r, l, wv * r, leaf); // downwind flag
            }
            return;
        }
    }
}

type TreeForm = 'stack' | 'round' | 'spire' | 'broad' | 'weeping' | 'twin' | 'palm' | 'nub';

function pickTreeForm(scale: number, rng: ReturnType<typeof makeRng>): TreeForm {
    if (scale > 0.72) return rng.pick(['stack', 'round', 'broad', 'weeping', 'twin', 'palm'] as TreeForm[]);
    if (scale > 0.55) return rng.pick(['round', 'spire', 'twin', 'stack', 'broad'] as TreeForm[]);
    return rng.pick(['round', 'spire', 'stack', 'nub'] as TreeForm[]);
}

function plantSphereTree(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    surfaceLayer: number,
    rng: ReturnType<typeof makeRng>,
    leaves: (typeof BLOCKS)[keyof typeof BLOCKS][],
    /** 0..1 — chosen by the zone; spans saplings (small/unit 1) to the largest forms. */
    sizeIn?: number,
) {
    const leaf = rng.pick(leaves) as any;
    // Pale variant = next in list (cyclic), for two-tone canopies
    const pale = leaves[(leaves.indexOf(leaf) + 1) % leaves.length] as any;
    const trunk = rng.chance(0.55) ? BLOCKS.TRUNK : BLOCKS.TRUNK_PALE;
    const scale = sizeIn ?? rng.range(0.4, 1.0);
    const form = pickTreeForm(scale, rng);
    const twoTone = rng.chance(0.62);
    const li = twoTone ? pale.id : leaf.id;
    const dx = rng.chance(0.5) ? 1 : -1;
    const dz = rng.chance(0.5) ? 1 : -1;

    // Trunk height varies by form and scale
    // jitter adds ±1-2 blocks of variety on top of the scale-driven height
    const jitter = Math.round(rng.range(-1.5, 1.5));
    const bare =
        form === 'spire'
            ? Math.max(5, Math.round(5 + scale * 7) + jitter)
            : form === 'palm'
              ? Math.max(8, Math.round(8 + scale * 8) + jitter)
              : form === 'broad'
                ? Math.max(4, Math.round(4 + scale * 3) + jitter)
                : form === 'weeping'
                  ? Math.max(5, Math.round(5 + scale * 4) + jitter)
                  : Math.max(4, Math.round(4 + scale * 5) + jitter);
    const large = scale >= 0.72;
    const unit = scale >= 0.42 ? 2 : 1;

    // Place a block safely in face-local (u+du, surfaceLayer+1+dl, v+dv) space
    const set = (du: number, dl: number, dv: number, id: number) => {
        const nu = u + du,
            nv = v + dv;
        const nl = surfaceLayer + 1 + dl;
        if (nu < 1 || nv < 1 || nu >= FACE_RES - 1 || nv >= FACE_RES - 1 || nl >= SHELL_DEPTH) return;
        if (grid.get(face, nu, nv, nl) !== 0) return;
        grid.set(face, nu, nv, nl, id);
    };

    // Helper: fill a box at canopy-relative (ou, oy, ov) with size (su, sy, sv)
    let _topDl = bare;
    const fill = (ou: number, oy: number, ov: number, su: number, sy: number, sv: number, id: number) => {
        const pu = ou - Math.floor(su / 2);
        const pv = ov - Math.floor(sv / 2);
        for (let y = 0; y < sy; y++)
            for (let bv = 0; bv < sv; bv++) for (let bu = 0; bu < su; bu++) set(pu + bu, bare + oy + y, pv + bv, id);
        _topDl = Math.max(_topDl, bare + oy + sy - 1);
    };

    // Trunk
    for (let l = 0; l < bare + unit; l++) set(0, l, 0, trunk.id);

    // Canopy by form — ported from voxel-world/vegetation.ts
    switch (form) {
        case 'round':
            if (large) {
                fill(0, 0, 0, 5, 3, 5, leaf.id);
                fill(3 * dx, 0, dz, 2, 3, 3, leaf.id);
                fill(-2 * dx, 0, 3 * dz, 3, 3, 2, leaf.id);
                fill(dx, 3, -dz, 4, 2, 4, li);
                fill(-2 * dx, 3, dz, 2, 2, 2, leaf.id);
                fill(dx, 5, dz, 3, 2, 3, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 4, 3, 4, leaf.id);
                fill(2 * dx, 0, dz, 2, 3, 2, leaf.id);
                fill(-dx, 3, 2 * dz, 2, 2, 2, li);
                fill(0, 4, 0, 3, 2, 3, li);
                fill(dx, 5, dz, 2, 2, 2, li);
            } else {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx, 2, dz, 2, 2, 2, li);
                fill(0, 4, 0, 2, 2, 2, li);
            }
            break;
        case 'broad':
            if (large) {
                fill(0, 0, 0, 5, 2, 5, leaf.id);
                fill(3 * dx, 0, dz, 2, 2, 3, leaf.id);
                fill(-2 * dx, 0, -2 * dz, 3, 2, 2, leaf.id);
                fill(dx, 2, -dz, 4, 2, 4, li);
                fill(-2 * dx, 2, 2 * dz, 2, 2, 2, li);
                fill(0, 4, 0, 3, 2, 3, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 4, 2, 4, leaf.id);
                fill(2 * dx, 0, dz, 2, 2, 2, leaf.id);
                fill(dx, 2, 0, 3, 2, 3, li);
                fill(-dx, 2, 2 * dz, 2, 2, 2, li);
                fill(0, 4, 0, 3, 2, 3, li);
            } else {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(2 * dx, 0, dz, 2, 2, 2, leaf.id);
                fill(dx, 2, dz, 3, 2, 3, li);
            }
            break;
        case 'spire':
            if (large) {
                fill(0, 0, 0, 4, 2, 4, leaf.id);
                fill(dx, 2, dz, 3, 2, 3, li);
                fill(0, 4, 0, 2, 2, 2, leaf.id);
                fill(dx, 6, 0, 2, 2, 2, li);
                fill(0, 8, 0, 1, 2, 1, leaf.id);
                fill(0, 10, 0, 1, 1, 1, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx, 2, dz, 2, 2, 2, li);
                fill(0, 4, 0, 2, 2, 2, leaf.id);
                fill(0, 6, 0, 1, 2, 1, li);
            } else {
                fill(0, 0, 0, 2, 2, 2, leaf.id);
                fill(dx, 2, dz, 1, 2, 1, li);
                fill(0, 4, 0, 1, 1, 1, leaf.id);
            }
            break;
        case 'twin':
            if (large) {
                fill(-3 * dx, 0, 0, 4, 2, 4, leaf.id);
                fill(3 * dx, 1, dz, 3, 2, 3, li);
                fill(-dx, 2, -dz, 2, 2, 2, li);
                fill(2 * dx, 3, 0, 2, 2, 2, li);
            } else if (unit === 2) {
                fill(-2 * dx, 0, 0, 3, 2, 3, leaf.id);
                fill(2 * dx, 1, dz, 3, 2, 3, li);
                fill(0, 2, 0, 2, 1, 2, li);
            } else {
                fill(-dx, 0, 0, 2, 1, 2, leaf.id);
                fill(dx, 1, dz, 2, 1, 2, li);
            }
            break;
        case 'weeping':
            if (large) {
                fill(0, 0, 0, 5, 2, 5, leaf.id);
                fill(3 * dx, 0, dz, 2, 3, 2, leaf.id);
                fill(-2 * dx, 0, 3 * dz, 2, 3, 2, leaf.id);
                fill(0, 3, 0, 4, 2, 4, li);
                fill(dx, 5, dz, 3, 2, 3, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 4, 2, 4, leaf.id);
                fill(2 * dx, 0, dz, 2, 3, 2, leaf.id);
                fill(0, 3, 0, 3, 2, 3, li);
                fill(dx, 5, dz, 2, 2, 2, li);
            } else {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx, 2, dz, 2, 2, 2, li);
                fill(0, 4, 0, 3, 2, 3, li);
            }
            break;
        case 'palm': {
            const frondW = large ? 9 : unit === 2 ? 7 : 5;
            fill(0, 0, 0, frondW, 2, frondW, leaf.id);
            fill(3 * dx, 0, dz, 2, 3, 2, leaf.id);
            fill(-2 * dx, 0, 2 * dz, 2, 3, 2, leaf.id);
            fill(dx, 2, -dz, Math.ceil(frondW / 2), 2, Math.ceil(frondW / 2), li);
            break;
        }
        case 'nub':
            if (unit === 2) {
                fill(0, 0, 0, 3, 3, 3, leaf.id);
                fill(dx, 3, dz, 2, 2, 2, li);
            } else {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx, 2, dz, 2, 2, 2, li);
            }
            break;
        case 'stack':
        default:
            if (large) {
                fill(0, 0, 0, 6, 2, 4, leaf.id);
                fill(-4 * dx, 0, 0, 2, 2, 2, leaf.id);
                fill(4 * dx, 1, dz, 2, 2, 2, li);
                fill(-dx, 0, -3 * dz, 2, 2, 2, leaf.id);
                fill(dx, 1, 3 * dz, 2, 2, 2, li);
                fill(dx, 2, -dz, 4, 2, 4, li);
                fill(-3 * dx, 2, dz, 2, 2, 2, leaf.id);
                fill(3 * dx, 3, -dz, 2, 2, 2, li);
                fill(-dx, 4, dz, 2, 2, 2, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 4, 2, 4, leaf.id);
                fill(-3 * dx, 0, 0, 2, 2, 2, leaf.id);
                fill(3 * dx, 1, dz, 2, 2, 2, li);
                fill(0, 0, -3 * dz, 2, 2, 2, leaf.id);
                fill(dx, 2, 0, 4, 2, 2, li);
                fill(-dx, 4, dz, 2, 2, 2, li);
            } else {
                fill(0, 0, 0, 3, 1, 3, leaf.id);
                fill(-2 * dx, 0, 0, 1, 1, 2, leaf.id);
                fill(2 * dx, 1, dz, 1, 1, 1, li);
                fill(dx, 1, 0, 2, 1, 2, li);
                fill(-dx, 2, dz, 1, 1, 1, li);
            }
    }
}

/** Small mound bush — 1-2 layers high, 1-3 wide */
/**
 * A dead trunk (snag): a bare column of weathered wood, broken off at the top,
 * with a few short dead branch stubs. Varied height (3–9) and stub count/heights;
 * one in four leans a step partway up, and one in five is just a low stump.
 */
function plantDeadTrunk(
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
 * A voxel cactus, varied in kind, height and size:
 *   saguaro  — tall column (4–9) with 0–3 arms that step out then turn upward,
 *              each arm at its own height and length
 *   barrel   — squat 1–2 high, 1 or 2 wide
 *   columns  — a clump of 2–4 slim columns of mixed heights
 * Only placed where the column above is clear, like every other plant.
 */
function plantCactus(
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
        grid.set(face, nu, nv, nl, CACTUS.id);
        return true;
    };
    // Only on level ground: a cactus straddling a dune step would float on one side.
    const ground = (du: number, dv: number) => grid.columnTop(face, u + du, v + dv);
    const kind = rng.pick(['saguaro', 'saguaro', 'saguaro', 'barrel', 'columns'] as const);

    if (kind === 'barrel') {
        const wide = rng.chance(0.4);
        const h = rng.int(1, 2);
        const cells: Array<[number, number]> = wide
            ? [
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
              ]
            : [[0, 0]];
        if (cells.some(([du, dv]) => ground(du, dv) !== surfaceLayer)) return;
        for (const [du, dv] of cells) for (let l = 0; l < h; l++) set(du, l, dv);
        return;
    }

    if (kind === 'columns') {
        const n = rng.int(2, 4);
        const spots: Array<[number, number]> = [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
        ];
        for (let k = 0; k < n; k++) {
            const [du, dv] = spots[k];
            if (ground(du, dv) !== surfaceLayer) continue;
            const h = rng.int(2, k === 0 ? 5 : 4);
            for (let l = 0; l < h; l++) set(du, l, dv);
        }
        return;
    }

    // Saguaro
    const height = rng.int(4, 9);
    for (let l = 0; l < height; l++) if (!set(0, l, 0)) return;
    const dirs: Array<[number, number]> = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    // Shuffle so arms point different ways on different cacti.
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    const arms = height >= 5 ? rng.int(0, Math.min(3, height - 3)) : 0;
    for (let a = 0; a < arms; a++) {
        const [du, dv] = dirs[a];
        const at = rng.int(2, height - 2); // arm height on the trunk
        const reach = rng.chance(0.3) ? 2 : 1; // how far it steps out
        const rise = rng.int(1, Math.max(1, height - at - 1)); // how far it climbs after turning up
        let ok = true;
        for (let r = 1; r <= reach && ok; r++) ok = set(du * r, at, dv * r);
        for (let l = 1; l <= rise && ok; l++) ok = set(du * reach, at + l, dv * reach);
    }
}

function plantSphereBush(
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
function plantSingle(
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

function findSpawn(grid: SphereVoxelGrid): { face: number; u: number; v: number } {
    // Search face 0 near centre for a land column above sea level
    for (let attempt = 0; attempt < 200; attempt++) {
        const u = 160 + (attempt % 20) * 4;
        const v = 160 + Math.floor(attempt / 20) * 4;
        if (u >= FACE_RES || v >= FACE_RES) continue;
        const top = grid.columnTop(0, u, v);
        if (top > SEA_LAYER + 2) return { face: 0, u, v };
    }
    return { face: 0, u: 200, v: 200 };
}
