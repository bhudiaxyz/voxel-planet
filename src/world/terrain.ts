// src/world/terrain.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { basisFromCode } from '../core/geoutil';
import { Noise3 } from '../core/noise3';
import { makeRng } from '../core/rng';
import { BLOCKS, BLOCK_BY_ID, PATTERN, registerBlock } from '../core/palette';
import { carveFreshWater } from './rivers';

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
const DESERT_TEMP = 0.815; // 0.8 → 0.815 trimmed sand cover ~10% (10.2% → 9.2% of land) in favour of grassland
const DESERT_MAX_RISE = 6;
/** Chance per desert sand column of a cactus — sparse, so each one stands alone. */
const CACTUS_P = 0.006;

const BUSH_PALETTE = [BUSH_ROSE, BUSH_MAUVE, BUSH_CREAM, BUSH_ROSE, BUSH_MAUVE];

/** Ground-cover kinds the vegetation layer draws as sprites (see plantSingle). */
export const PLANT = { FERN, FERN_RED, MOSS_THICK, LICHEN_PALE, SHRUB_TALL, GRASS_TALL, REED: REED_BLOCK, SCRUB_DRY };

/** Let the browser paint the loading screen between stages (no-op cost in node). */
const paint = () => new Promise((r) => setTimeout(r, 0));

export async function generateSphereTerrain(
    seed: number,
    /** p: 0..1 through terrain generation; stage: label of the step it is in. */
    onProgress?: (p: number, stage?: string) => void,
): Promise<{ grid: SphereVoxelGrid; spawn: { face: number; u: number; v: number } }> {
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
            if (onProgress && v % 40 === 0)
                onProgress(((face * FACE_RES + v) / (6 * FACE_RES)) * 0.6, 'sculpting the planet');
        }
    }

    // Rivers, streams, lakes and ponds — carved into the land before anything grows.
    onProgress?.(0.6, 'carving rivers & lakes');
    await paint();
    carveFreshWater(grid, SEA_LAYER, seed);
    onProgress?.(0.75, 'growing forests');
    await paint();

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
                    // Altitude zone picks trees AND ground cover: cumulative shares per column.
                    const zone = zoneOf(sl - SEA_LAYER);
                    const g = GROUND[zone];
                    let t = ZONE[zone].treeP;
                    if (roll < t) plantZoneTree(grid, face, u, v, sl, treeRng, zone, LEAF_ROLE);
                    else if (roll < (t += DEAD_TRUNK_P) && sl >= SEA_LAYER + DEAD_TRUNK_MIN_RISE)
                        plantDeadTrunk(grid, face, u, v, sl, treeRng);
                    else if (roll < (t += g.bush))
                        plantSphereBush(grid, face, u, v, sl, treeRng, treeRng.pick(g.bushes));
                    else if (roll < (t += g.fern))
                        plantSingle(grid, face, u, v, sl, treeRng.chance(0.6) ? FERN : FERN_RED);
                    else if (roll < (t += g.tall)) plantSingle(grid, face, u, v, sl, treeRng.pick(g.talls));
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
                        // Moss on the lower, damper rock; pale lichen takes over with height.
                        plantSingle(
                            grid,
                            face,
                            u,
                            v,
                            sl,
                            treeRng.chance(zone === 'treeline' ? 0.15 : zone === 'highland' ? 0.4 : 0.7)
                                ? MOSS_THICK
                                : LICHEN_PALE,
                        );
                } else if (sl > SEA_LAYER + 1 && topId === BLOCKS.SAND.id) {
                    // Desert dunes: sparse cacti, each one its own height and shape.
                    if (roll < CACTUS_P) plantCactus(grid, face, u, v, sl, treeRng);
                    else if (roll < CACTUS_P + 0.012) plantSingle(grid, face, u, v, sl, SCRUB_DRY);
                } else if (sl >= SEA_LAYER - 1 && sl <= SEA_LAYER + 2 && !(BLOCK_BY_ID[topId] as any)?.isWater) {
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
    // -0.05 (was 0.2): grassland reaches further into the cold uplands — grass cover
    // 46.7% → 61.4% of land (+31%, measured over three seeds), from pale rock.
    if (temp > -0.05) return grassLight.id;
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
/** Species with their own builders below, plus voxel-world forms built by plantSphereTree. */
type Species =
    | 'broadleaf'
    | 'palm'
    | 'emergent'
    | 'birch'
    | 'fir'
    | 'spruce'
    | 'krummholz'
    | 'mangrove'
    | 'oak'
    | 'pine'
    | 'cypress'
    | 'acacia'
    | 'willow'
    | 'baobab'
    | 'juniper';
/** Species drawn by plantSphereTree (as a forced form) and which leaf role they wear. */
const FORM_SPECIES: Partial<Record<Species, 'broad' | 'conifer'>> = {
    mangrove: 'broad',
    oak: 'broad',
    acacia: 'broad',
    willow: 'broad',
    baobab: 'broad',
    pine: 'conifer',
    cypress: 'conifer',
    juniper: 'conifer',
};

const zoneOf = (rise: number): Zone =>
    rise <= 3 ? 'coast' : rise <= 7 ? 'lowland' : rise <= 11 ? 'midland' : rise <= 15 ? 'highland' : 'treeline';

/** Per zone: tree chance per grass column, species weights, size range (0..1). */
const ZONE: Record<Zone, { treeP: number; mix: Array<[Species, number]>; size: [number, number] }> = {
    coast: {
        treeP: 0.011,
        mix: [
            ['palm', 5],
            ['broadleaf', 3],
            ['mangrove', 2],
            ['willow', 1],
        ],
        size: [0.35, 0.85],
    },
    lowland: {
        treeP: 0.016,
        mix: [
            ['broadleaf', 6],
            ['emergent', 2],
            ['oak', 2],
            ['acacia', 1],
            ['baobab', 1],
            ['willow', 1],
            ['palm', 1],
        ],
        size: [0.2, 1.0],
    },
    midland: {
        treeP: 0.013,
        mix: [
            ['broadleaf', 4],
            ['oak', 3],
            ['birch', 3],
            ['cypress', 1],
            ['pine', 2],
            ['fir', 2],
        ],
        size: [0.2, 0.9],
    },
    highland: {
        treeP: 0.012,
        mix: [
            ['fir', 5],
            ['spruce', 4],
            ['pine', 3],
            ['birch', 1],
        ],
        size: [0.3, 1.0],
    },
    treeline: {
        treeP: 0.006,
        mix: [
            ['krummholz', 6],
            ['juniper', 3],
            ['spruce', 1],
        ],
        size: [0.15, 0.5],
    },
};

/**
 * Ground cover per zone (chance per grass column, after trees and dead trunks).
 * Lush ferns and tall grass by the water, flowering bushes in the lowlands,
 * tall shrubs mid-slope, then thin grey scrub and moss toward the treeline.
 */
const GROUND: Record<Zone, { bush: number; fern: number; tall: number; bushes: any[]; talls: any[] }> = {
    coast: { bush: 0.015, fern: 0.03, tall: 0.03, bushes: [BUSH_CREAM, BUSH_ROSE], talls: [GRASS_TALL] },
    lowland: { bush: 0.035, fern: 0.03, tall: 0.02, bushes: BUSH_PALETTE, talls: [GRASS_TALL, SHRUB_TALL] },
    midland: {
        bush: 0.03,
        fern: 0.015,
        tall: 0.02,
        bushes: [BUSH_MAUVE, BUSH_CREAM, SCRUB_BLOCK],
        talls: [SHRUB_TALL],
    },
    highland: {
        bush: 0.02,
        fern: 0.006,
        tall: 0.012,
        bushes: [SCRUB_BLOCK, SCRUB_BLOCK, BUSH_MAUVE],
        talls: [SHRUB_TALL, MOSS_THICK],
    },
    treeline: { bush: 0.012, fern: 0, tall: 0.02, bushes: [SCRUB_BLOCK], talls: [MOSS_THICK, LICHEN_PALE] },
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
    const role = FORM_SPECIES[species];
    if (role) {
        plantSphereTree(grid, face, u, v, surfaceLayer, rng, roles[role], size, species as TreeForm);
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

type TreeForm =
    | 'stack'
    | 'round'
    | 'spire'
    | 'broad'
    | 'weeping'
    | 'twin'
    | 'palm'
    | 'nub'
    | 'umbrella'
    | 'tall'
    | 'layered'
    // Named species from voxel-world, placed by zone (see ZONE)
    | 'mangrove'
    | 'oak'
    | 'pine'
    | 'cypress'
    | 'acacia'
    | 'willow'
    | 'baobab'
    | 'juniper';

function pickTreeForm(scale: number, rng: ReturnType<typeof makeRng>): TreeForm {
    if (scale > 0.72)
        return rng.pick(['stack', 'round', 'broad', 'weeping', 'twin', 'palm', 'umbrella', 'layered'] as TreeForm[]);
    if (scale > 0.55) return rng.pick(['round', 'spire', 'twin', 'stack', 'broad', 'umbrella', 'tall'] as TreeForm[]);
    return rng.pick(['round', 'spire', 'stack', 'nub', 'tall', 'layered'] as TreeForm[]);
}

/** Bare-trunk height for the forms ported from voxel-world: [min, + scale × extra]. */
const FORM_TRUNK: Partial<Record<TreeForm, [number, number]>> = {
    umbrella: [4, 3.5],
    tall: [6, 9],
    layered: [3, 4],
    mangrove: [2, 2],
    oak: [3, 3],
    pine: [6, 8],
    cypress: [1, 2],
    acacia: [4, 4],
    willow: [3, 3],
    baobab: [3, 4],
    juniper: [1, 2],
};
/** Forms whose silhouette the foliage tufts would blur. */
const NO_TUFTS = new Set<TreeForm>(['spire', 'palm', 'pine', 'cypress', 'willow', 'layered']);

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
    /** Forces a form (named species from the zone mix); otherwise picked by scale. */
    formIn?: TreeForm,
) {
    const leaf = rng.pick(leaves) as any;
    // Pale variant = next in list (cyclic), for two-tone canopies
    const pale = leaves[(leaves.indexOf(leaf) + 1) % leaves.length] as any;
    const scale = sizeIn ?? rng.range(0.4, 1.0);
    const form = formIn ?? pickTreeForm(scale, rng);
    const trunk =
        form === 'baobab' || form === 'juniper' || form === 'oak'
            ? BLOCKS.TRUNK
            : rng.chance(0.55)
              ? BLOCKS.TRUNK
              : BLOCKS.TRUNK_PALE;
    const twoTone = rng.chance(0.62);
    const li = twoTone ? pale.id : leaf.id;
    const dx = rng.chance(0.5) ? 1 : -1;
    const dz = rng.chance(0.5) ? 1 : -1;

    // Trunk height varies by form and scale
    // jitter adds ±1-2 blocks of variety on top of the scale-driven height
    const jitter = Math.round(rng.range(-1.5, 1.5));
    const ft = FORM_TRUNK[form];
    const bare = ft
        ? Math.max(ft[0], Math.round(ft[0] + scale * ft[1]) + jitter)
        : form === 'spire'
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

    // Trunk — baobab is 2×2 (3×3 when big), oak 2×2 when large, everything else 1×1.
    const tw = form === 'baobab' ? (scale >= 0.6 ? 3 : 2) : form === 'oak' && large ? 2 : 1;
    const to = -Math.floor((tw - 1) / 2);
    for (let l = 0; l < bare + unit; l++)
        for (let a = 0; a < tw; a++) for (let b = 0; b < tw; b++) set(to + a, l, to + b, trunk.id);

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
        /* ---- ported from voxel-world/vegetation.ts (x,y,z → u,layer,v) ---- */
        case 'umbrella': {
            // Wide flat disc crown — lone savanna tree.
            const w = large ? 7 : unit === 2 ? 5 : 4;
            fill(0, 0, 0, w, 1, w, leaf.id);
            fill(dx * 2, 0, dz, Math.ceil(w / 2), 1, Math.ceil(w / 3), leaf.id);
            fill(-dx, 1, -dz, Math.ceil(w / 2), 1, Math.ceil(w / 2), li);
            if (unit === 2) fill(dx, 2, dz, 2, 1, 2, li);
            break;
        }
        case 'tall':
            // Poplar: very tall bare trunk, small airy crown.
            if (large) {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx * 2, 1, dz, 2, 2, 2, li);
                fill(0, 3, 0, 2, 1, 2, li);
            } else if (unit === 2) {
                fill(0, 0, 0, 3, 2, 3, leaf.id);
                fill(dx, 2, dz, 2, 1, 2, li);
            } else {
                fill(0, 0, 0, 2, 1, 2, leaf.id);
                fill(dx, 1, dz, 1, 1, 1, li);
            }
            break;
        case 'layered': {
            // Tiered horizontal discs — pagoda / cedar.
            const tiers = large ? 4 : unit === 2 ? 3 : 2;
            const baseW = large ? 7 : unit === 2 ? 5 : 3;
            const gap = unit === 2 ? 3 : 2;
            for (let t = 0; t < tiers; t++) {
                fill(
                    t & 1 ? dx : 0,
                    t * gap,
                    t & 1 ? dz : 0,
                    Math.max(1, baseW - t * 2),
                    1,
                    Math.max(1, baseW - t * 2),
                    t === 0 ? leaf.id : li,
                );
                if (t > 0) for (let k = 1; k < gap; k++) set(0, bare + (t - 1) * gap + k, 0, trunk.id); // trunk through the gaps
            }
            break;
        }
        case 'mangrove':
            // Stilt roots fanning out near the base, broad low crown.
            for (const [ru, rv] of [
                [2 * dx, 0],
                [0, 2 * dz],
                [-dx, dz],
                [dx, -dz],
            ] as Array<[number, number]>)
                set(ru, 0, rv, trunk.id);
            if (large) {
                fill(0, 0, 0, 5, 1, 5, leaf.id);
                fill(3 * dx, 0, dz, 2, 2, 2, leaf.id);
                fill(-2 * dx, 0, -2 * dz, 2, 1, 3, leaf.id);
                fill(dx, 1, -dz, 3, 1, 3, li);
            } else {
                fill(0, 0, 0, 4, 1, 4, leaf.id);
                fill(2 * dx, 0, dz, 2, 1, 2, leaf.id);
                fill(dx, 1, 0, 3, 1, 3, li);
            }
            break;
        case 'oak': {
            // Broad, heavy, irregular crown wider than tall, on a short thick trunk.
            const w = large ? 9 : unit === 2 ? 7 : 5;
            fill(0, 0, 0, w, 2, w - 1, leaf.id);
            fill(3 * dx, 1, -2 * dz, 3, 2, 3, leaf.id);
            fill(-3 * dx, 1, 2 * dz, 3, 2, 3, leaf.id);
            fill(dx, 2, dz, w - 3, 2, w - 3, li);
            fill(-dx, 4, 0, Math.max(2, w - 5), 1, Math.max(2, w - 5), li);
            break;
        }
        case 'pine': {
            // Tall bare trunk, compact flat crown with short whorls just below.
            const w = large ? 5 : unit === 2 ? 4 : 3;
            fill(0, 0, 0, w, 1, w, leaf.id);
            fill(2 * dx, -2, 0, 2, 1, 2, leaf.id);
            fill(-2 * dx, -3, dz, 2, 1, 2, leaf.id);
            fill(0, 1, 0, w - 1, 1, w - 1, li);
            fill(dx, 2, dz, Math.max(1, w - 3), 1, Math.max(1, w - 3), li);
            break;
        }
        case 'cypress': {
            // Tall narrow column — Mediterranean cypress.
            const h = large ? 12 : unit === 2 ? 9 : 6;
            fill(0, 0, 0, 2, h - 2, 2, leaf.id);
            fill(dx, 2, 0, 1, h - 5, 1, li);
            fill(0, h - 2, 0, 1, 2, 1, li);
            break;
        }
        case 'acacia': {
            // Trunk forks into two limbs; very flat wide crown plus an offset lower layer.
            const w = large ? 9 : unit === 2 ? 7 : 5;
            set(dx, bare - 1, 0, trunk.id);
            set(-dx, bare - 1, dz, trunk.id);
            fill(0, 0, 0, w, 1, w - 2, leaf.id);
            fill(dx * Math.ceil(w / 3), -1, dz * 2, Math.ceil(w / 2), 1, Math.ceil(w / 2), leaf.id);
            fill(-dx, 1, 0, w - 3, 1, Math.max(2, w - 5), li);
            break;
        }
        case 'willow': {
            // Rounded crown with long strands hanging from the rim most of the way down.
            const w = large ? 7 : unit === 2 ? 5 : 4;
            fill(0, 0, 0, w, 2, w, leaf.id);
            fill(0, 2, 0, w - 2, 1, w - 2, li);
            const r = Math.floor(w / 2);
            const drop = Math.max(2, bare - 1);
            for (let a = 0; a < 12; a++) {
                if (!rng.chance(0.7)) continue;
                const th = (a / 12) * Math.PI * 2;
                const su = Math.round(Math.cos(th) * r),
                    sv = Math.round(Math.sin(th) * r);
                const len = rng.int(Math.ceil(drop * 0.5), drop);
                for (let k = 1; k <= len; k++) set(su, bare - k, sv, k & 1 ? leaf.id : li);
            }
            break;
        }
        case 'baobab':
            // Fat bottle trunk, a sparse crown of stubby branch tips on top.
            for (const [bu, bv] of [
                [2, 0],
                [-2, 1],
                [1, -2],
                [-1, 2],
            ] as Array<[number, number]>) {
                set(bu, bare, bv, trunk.id);
                fill(bu, 1, bv, 2, 1, 2, rng.chance(0.5) ? leaf.id : li);
            }
            fill(0, 1, 0, 3, 1, 3, leaf.id);
            break;
        case 'juniper':
            // Wind-twisted scrub: leaning limb, a few lopsided dense pads.
            set(dx, bare, 0, trunk.id);
            set(2 * dx, bare + 1, dz, trunk.id);
            fill(2 * dx, 1, dz, unit === 2 ? 4 : 3, 2, unit === 2 ? 3 : 2, leaf.id);
            fill(-dx, 0, -dz, 2, 2, 2, leaf.id);
            fill(3 * dx, 3, dz, 2, 1, 2, li);
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

    // Extra foliage tufts across the crown to break up the box silhouette (voxel-world).
    if (!NO_TUFTS.has(form)) {
        const spread = large ? 3 : unit === 2 ? 2 : 1;
        const crownH = _topDl - bare;
        const count = large ? rng.int(5, 9) : unit === 2 ? rng.int(3, 6) : rng.int(2, 4);
        for (let k = 0; k < count; k++) {
            const sw = rng.chance(0.55) ? 2 : 1;
            fill(
                rng.int(-spread, spread),
                rng.int(0, Math.max(1, crownH + 1)),
                rng.int(-spread, spread),
                sw,
                1,
                sw,
                rng.chance(0.55) ? li : leaf.id,
            );
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
function plantCactus(
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
        if (top > SEA_LAYER + 2 && !(BLOCK_BY_ID[grid.get(0, u, v, top)] as any)?.isWater) return { face: 0, u, v };
    }
    return { face: 0, u: 200, v: 200 };
}
