// src/world/terrain.ts
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { basisFromCode } from '../core/geoutil';
import { Noise3 } from '../core/noise3';
import { makeRng } from '../core/rng';
import { BLOCKS, BLOCK_BY_ID } from '../core/palette';
import { carveFreshWater } from './rivers';
import {
    FERN,
    FERN_RED,
    GROUND,
    LICHEN_PALE,
    MOSS_THICK,
    REED_BLOCK,
    SCRUB_BLOCK,
    SCRUB_DRY,
    SHRUB_BLUEGREEN,
    SHRUB_OLIVE,
    SHRUB_RUSSET,
    plantCactus,
    plantDeadTrunk,
    plantSingle,
    plantSphereBush,
} from './plants';
import { ZONE, plantZoneTree, zoneOf } from './trees';
import type { Zone } from './trees';
export { PLANT } from './plants';

// Sea level is layer 9; terrace step is 2 (same aesthetic as flat terrain)
const SEA_LAYER = 11;
const TERRACE_STEP = 2;
const AMPLITUDE = 24; // max layers above/below sea level

/** Minimum clear radius (columns) around a tree / a bush (see the spacing claim grid). */
const TREE_GAP = 4;
const BUSH_GAP = 2;

/** Per grass/stone column above the lowlands: a dead trunk, rarer than living trees. */
const DEAD_TRUNK_P = 0.0012;
/** Dead trunks only from the grassland/forest band upward (layers above sea). */
const DEAD_TRUNK_MIN_RISE = 3;

/** Desert band: the hottest land (see isDesert's temp), within this many layers of the sea. */
const DESERT_TEMP = 0.815; // 0.8 → 0.815 trimmed sand cover ~10% (10.2% → 9.2% of land) in favour of grassland
const DESERT_MAX_RISE = 6;
/** Chance per desert sand column of a cactus — sparse, so each one stands alone. */
const CACTUS_P = 0.006;

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
            if (v % 40 === 0) {
                onProgress?.(((face * FACE_RES + v) / (6 * FACE_RES)) * 0.6, 'sculpting the planet');
                // Yield so the bar actually paints (and the tab isn't flagged as hung
                // on slow phones): reporting progress without yielding drew nothing.
                await paint();
            }
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

    /*
     * Spacing. Placement is one roll per column, so trees and bushes could land in
     * neighbouring columns and clump into dense mats. A per-face claim grid keeps
     * them apart: a tree needs TREE_GAP clear columns around it, a bush BUSH_GAP.
     * The roll still happens for every column (the RNG stream is unchanged), so a
     * spot that's too crowded just grows nothing.
     */
    const claim = new Uint8Array(FACE_RES * FACE_RES);
    const free = (u: number, v: number) => claim[v * FACE_RES + u] === 0;
    const stake = (u: number, v: number, r: number) => {
        for (let dv = -r; dv <= r; dv++)
            for (let du = -r; du <= r; du++) {
                if (du * du + dv * dv > r * r) continue;
                const uu = u + du,
                    vv = v + dv;
                if (uu >= 0 && vv >= 0 && uu < FACE_RES && vv < FACE_RES) claim[vv * FACE_RES + uu] = 1;
            }
    };
    const tree = (face: number, u: number, v: number, sl: number, zone: Zone) => {
        if (!free(u, v)) return;
        plantZoneTree(grid, face, u, v, sl, treeRng, zone, LEAF_ROLE);
        stake(u, v, TREE_GAP);
    };
    const bush = (face: number, u: number, v: number, sl: number, block: { id: number }) => {
        if (!free(u, v)) return;
        plantSphereBush(grid, face, u, v, sl, treeRng, block);
        stake(u, v, BUSH_GAP);
    };

    for (let face = 0; face < 6; face++) {
        claim.fill(0);
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
                    if (roll < t) tree(face, u, v, sl, zone);
                    else if (roll < (t += DEAD_TRUNK_P) && sl >= SEA_LAYER + DEAD_TRUNK_MIN_RISE)
                        plantDeadTrunk(grid, face, u, v, sl, treeRng);
                    else if (roll < (t += g.bush)) bush(face, u, v, sl, treeRng.pick(g.bushes));
                    else if (roll < (t += g.fern))
                        plantSingle(grid, face, u, v, sl, treeRng.chance(0.6) ? FERN : FERN_RED);
                    else if (roll < (t += g.tall)) plantSingle(grid, face, u, v, sl, treeRng.pick(g.talls));
                } else if (sl > SEA_LAYER + 1 && STONE_IDS.has(topId)) {
                    // Cold rock: conifers where the highland is, a thin cover lower down,
                    // and wind-killed snags standing alone on the slopes.
                    const zone = zoneOf(sl - SEA_LAYER);
                    const onRockP = zone === 'highland' ? 0.01 : zone === 'treeline' ? 0.005 : 0.0025;
                    if (roll < onRockP) tree(face, u, v, sl, zone === 'treeline' ? 'treeline' : 'highland');
                    else if (roll < onRockP + DEAD_TRUNK_P * 1.5) plantDeadTrunk(grid, face, u, v, sl, treeRng);
                    else if (roll < 0.018)
                        bush(face, u, v, sl, treeRng.pick([SCRUB_BLOCK, SHRUB_OLIVE, SHRUB_BLUEGREEN, SHRUB_RUSSET]));
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
