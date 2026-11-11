// src/world/sphere-terrain.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/sphere-voxel';
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

const BUSH_PALETTE = [BUSH_ROSE, BUSH_MAUVE, BUSH_CREAM, BUSH_ROSE, BUSH_MAUVE];

/** Ground-cover kinds the vegetation layer draws as sprites (see plantSingle). */
export const PLANT = { FERN, FERN_RED, MOSS_THICK, LICHEN_PALE, SHRUB_TALL, GRASS_TALL, REED: REED_BLOCK };

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

                for (let layer = 0; layer <= surfaceLayer; layer++) {
                    let id: number;
                    if (!isLand) {
                        id = layer === surfaceLayer ? SAND.id : STONE.id;
                    } else if (layer === surfaceLayer) {
                        id = selectSurface(noise, _dir, e, GRASS, GRASS_LIGHT, STONE_PALE);
                    } else if (layer >= surfaceLayer - 2) {
                        id = SOIL.id;
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

    for (let face = 0; face < 6; face++) {
        for (let v = 0; v < FACE_RES; v++) {
            for (let u = 0; u < FACE_RES; u++) {
                const sl = grid.columnTop(face, u, v);
                const topId = grid.get(face, u, v, sl);

                const roll = treeRng();
                if (sl > SEA_LAYER + 1 && GRASS_IDS.has(topId)) {
                    if (roll < 0.012) plantSphereTree(grid, face, u, v, sl, treeRng, LEAVES);
                    else if (roll < 0.042) plantSphereBush(grid, face, u, v, sl, treeRng, treeRng.pick(BUSH_PALETTE));
                    else if (roll < 0.065) plantSingle(grid, face, u, v, sl, treeRng.chance(0.6) ? FERN : FERN_RED);
                    else if (roll < 0.08)
                        plantSingle(grid, face, u, v, sl, sl < SEA_LAYER + 4 ? GRASS_TALL : SHRUB_TALL);
                } else if (sl > SEA_LAYER + 1 && STONE_IDS.has(topId)) {
                    if (roll < 0.018)
                        plantSphereBush(grid, face, u, v, sl, treeRng, treeRng.chance(0.7) ? SCRUB_BLOCK : BUSH_MAUVE);
                    else if (roll < 0.055)
                        plantSingle(grid, face, u, v, sl, treeRng.chance(0.5) ? MOSS_THICK : LICHEN_PALE);
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
) {
    const leaf = rng.pick(leaves) as any;
    // Pale variant = next in list (cyclic), for two-tone canopies
    const pale = leaves[(leaves.indexOf(leaf) + 1) % leaves.length] as any;
    const trunk = rng.chance(0.55) ? BLOCKS.TRUNK : BLOCKS.TRUNK_PALE;
    const scale = rng.range(0.4, 1.0);
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
