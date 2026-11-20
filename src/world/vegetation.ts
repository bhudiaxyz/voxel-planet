/**
 * Vegetation — grass, flowers, ground-cover plants, waterside growth and ground clutter drawn as
 * thin quads on the sphere surface.
 *
 * Purpose
 *   Everything too fine to be a voxel: grass tufts, flower drifts, ferns/moss/reeds/yucca
 *   sprites, lily pads, reed clumps, leaf litter, hanging vines, fallen logs, mushrooms, pebbles
 *   and boulders. Rendered as per-patch meshes next to the voxel terrain.
 *
 * Operations
 *   - Built lazily, one VEG_PATCH x VEG_PATCH (32x32) column patch at a time, when the terrain
 *     streamer loads a chunk under it (chunkLoaded / chunkUnloaded ref-count chunks per patch;
 *     built at the first, released at zero). Never for the whole planet up front. Each patch
 *     has its own seeded RNG streams (grass stream `rng`, ground-detail stream `drng`), so a
 *     patch looks identical every rebuild, and toggling ground detail never shifts the grass.
 *   - build() walks the patch's columns: fresh water gets lily pads on still surfaces; canopy
 *     columns get leaf litter, understorey plants and hanging vines (warm, low zones only; vines
 *     capped by VINE_MAX_DROP / VINE_MAX_LEN); plant columns (grid.plantAt, recorded by
 *     terrain.ts, PLANT block ids) draw via drawPlant instead of grass; bank columns next to
 *     water (wet map distance 1) get reed clumps in noise stands; other grass/stone columns get
 *     boulders, logs, mushrooms (scatterGroundDetail, rocks.ts) and grass/flowers
 *     (scatterColumn: flower drifts from a noise field, tall blades, pebbles, foliage clumps,
 *     tufts scaled by meadow lushness). Bare stone gets boulders only.
 *   - Geometry goes through veg-geom's QuadBuffer into one BufferGeometry per patch (null if
 *     empty). tuft() is the basic crossed-blade primitive; vertex colour darkens the root
 *     (ROOT_SHADE) for contact shadow.
 *   - One shared MeshLambertMaterial (one program, one clock) with a vertex-shader wind sway
 *     along the surface; aDetail = (sway, phase). Phase >= HANGING marks vines, which first
 *     follow the voxel canopy's sway through the shared canopyWind uniforms (setCanopyWind).
 *     No depth write (avoids scratchy outlines); drawn at renderOrder 2, after the terrain and the
 *     sea (water.ts draws the sea in the opaque list at renderOrder 1, so it can't paint over a
 *     plant standing in front of it).
 *   - drawPlant draws the sprite plants (PLANT marker blocks from plants.ts) from their blocks'
 *     colours, beside the other non-voxel drawers here.
 *   - Walker obstacles: rocks (scatterBoulder returns its extent) and fallen logs at least
 *     OBSTACLE_MIN_H (0.2) tall are recorded per column in obstacleH (OBSTACLE_STEP 0.05 units)
 *     as patches build; big ones (reach > 1.2) also mark their 8 neighbours. obstacleAt() feeds
 *     player/controller.ts. Never cleared: placement is deterministic, so rebuilds write the
 *     same values.
 *
 * Usage
 *   const veg = createSphereVegetation(grid, seed, scene, density, windAmp, groundDetail, wet);
 *   world.ts creates it and attaches it with streaming.setListener(veg) BEFORE the first chunk
 *   fill; it is also in world.animated (update(dt) advances the wind clock). main.ts calls
 *   setCanopyWind(voxel uniforms) and uses bloomAt / lushAt (butterfly and firefly habitat).
 *   Draws the sprite plants (drawPlant) from their marker blocks in plants.ts (PLANT), alongside
 *   the other non-voxel ground cover here (grass, flowers, reed clumps, lilies, vines, logs).
 *
 * See also: veg-geom.ts, rocks.ts, plants.ts, distance-maps.ts, terrain.ts, world.ts; DESIGN.md
 * "7. Vegetation".
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/voxel';
import { columnDir } from '../core/geoutil';
import { PETAL_COLORS } from '../core/palette';
import { BLOCK_BY_ID, BLOCKS, PATTERN } from '../core/blocks';
import { makeRng, makeNoise3D } from '../core/rng';
import { QuadBuffer, _up, _ta, _tb, _base, _base2, box, boxYawed, root, tuft, type Rng } from './veg-geom';
import { PLANT } from './plants';
import { STONE_IDS, scatterBoulder, scatterPebble } from './rocks';

const SEA_LAYER = 11;
const TREE_P = 0.04;
const GRASS_P = 0.35;
/** Tall single blades poking out of the turf, at full density. */
const BLADE_P = 0.12;
/** Flowers only grow where the drift field exceeds this; probability ramps above it. */
const FLOWER_EDGE = 0.58;
const FLOWER_P = 0.55;
/** Per still fresh-water column: a few lily pads. */
const LILY_P = 0.09;
/** Per bank column (1 from water) inside a reed stand: a dense reed clump. */
const REED_P = 0.75;
/** Per canopy column in warm zones: vines / moss strands from the underside. */
const HANG_P = 0.12;
/** Vines hang at most this share of the way from canopy to ground, and no longer than VINE_MAX_LEN. */
const VINE_MAX_DROP = 0.6;
const VINE_MAX_LEN = 5;
/** Noise frequencies are per world unit, sampled in 3D so patches cross cube seams. */
const MEADOW_FREQ = 0.026;
const FLOWER_FREQ = 0.055;
export const VEG_PATCH = 32;
/** Walker obstacle map resolution (world units per step) and the smallest rock/log that blocks. */
const OBSTACLE_STEP = 0.05;
const OBSTACLE_MIN_H = 0.2;
const PATCHES_PER_EDGE = Math.ceil(FACE_RES / VEG_PATCH);


/** Shared across every patch: one program, one uniform set, one wind clock. */
/** Canopy wind uniforms from the voxel material, shared by reference (see setCanopyWind). */
const canopyWind = {
    uWindTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0 },
    uPlanetRadius: { value: 350 },
};
/** Phase offset that marks hanging growth (vines): it rides the canopy's sway. */
const HANGING = 100;

const _centre = new THREE.Vector3();
const _dark = new THREE.Color();
const _light = new THREE.Color();

/**
 * Ground-cover plants recorded by the terrain step (grid.plants), each drawn
 * from its block's own colours so the palette stays authored in one place.
 * Bottom colour = block.side (shaded base), tip = block.topTint ?? block.top.
 */
const YUCCA_BLOOM = new THREE.Color(0xf2ecd0);
const _pDark = new THREE.Color();
const _pLight = new THREE.Color();

/** Per-patch palette snapshot — palette colours are only filled once the palette loads. */
interface DetailColours {
    flowers: THREE.Color[];
    pebbles: THREE.Color[];
    bark: THREE.Color[];
    caps: THREE.Color[];
    stem: THREE.Color;
    moss: THREE.Color;
    lily: THREE.Color;
    lilyFlower: THREE.Color;
    reedBase: THREE.Color;
    reedTip: THREE.Color;
    cattail: THREE.Color;
    vine: THREE.Color;
    vineTip: THREE.Color;
}
const readColours = (): DetailColours => ({
    // Flowers use the theme's petal colours, not its leaves: canopies are mostly
    // green now, and a meadow of green flowers would vanish into the grass.
    flowers: PETAL_COLORS as THREE.Color[],
    pebbles: [BLOCKS.STONE, BLOCKS.STONE_PALE, BLOCKS.STONE_WARM].map((b: any) => b.top),
    bark: [BLOCKS.TRUNK, BLOCKS.TRUNK_PALE].map((b: any) => b.side),
    // Same caps as the flat world's damp-grove mushrooms.
    caps: [PETAL_COLORS[0], PETAL_COLORS[2], PETAL_COLORS[3], BLOCKS.STONE_WARM.top] as THREE.Color[],
    stem: BLOCKS.STONE_PALE.top as THREE.Color,
    moss: BLOCKS.GRASS_DEEP.top as THREE.Color,
    // Waterside colours come off the theme's own greens and petals.
    lily: (BLOCKS.LEAF_MINT.top as THREE.Color).clone().lerp(BLOCKS.GRASS_DEEP.top, 0.5),
    lilyFlower: (PETAL_COLORS[3] as THREE.Color).clone().lerp(new THREE.Color(1, 1, 1), 0.4),
    reedBase: (BLOCKS.GRASS_DEEP.top as THREE.Color).clone().multiplyScalar(0.8),
    reedTip: (BLOCKS.GRASS_LIGHT.top as THREE.Color).clone().lerp(BLOCKS.SAND.top, 0.35),
    cattail: new THREE.Color(0.22, 0.13, 0.07),
    vine: (BLOCKS.GRASS_DEEP.top as THREE.Color).clone().multiplyScalar(0.75),
    vineTip: (BLOCKS.LEAF_MINT.top as THREE.Color).clone().lerp(BLOCKS.GRASS_DEEP.top, 0.4),
});

/* ---- ground details: fallen logs, mushrooms (boulders: rocks.ts) ---------
 * Drawn from their own RNG stream so turning them on or off (tier setting)
 * never shifts where the grass and flowers land. */
const LOG_P = 0.006; // per column next to a tree trunk
const MUSHROOM_P = 0.05; // per column next to a tree trunk; ×0.25 in open lush meadow

const NEIGHBOURS4: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/* ---- waterside, canopy floor and hanging growth -------------------------- */

const _flat = new THREE.Color();
const _pad = new THREE.Color();
const _padRim = new THREE.Color();

const LITTER_BROWN = new THREE.Color(0.32, 0.22, 0.12);

const _down = new THREE.Vector3();

function makeVegMaterial(windAmp: number) {
    const uniforms = {
        uTime: { value: 0 },
        uWindAmp: { value: windAmp },
    };
    const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        dithering: true,
        // No depth write: thousands of overlapping blades writing depth fed the
        // ink-outline pass a scratchy edge on every lawn. They still depth-test.
        depthWrite: false,
    });
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms, canopyWind);
        // Normals carry the surface up, not the blade facing. DoubleSide would
        // flip them on back faces — pointing into the ground and rendering the
        // blade black — so keep the same normal on both sides.
        shader.fragmentShader = shader.fragmentShader.replace(
            'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
            'float faceDirection = 1.0;',
        );
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                /* glsl */ `#include <common>
                attribute vec2 aDetail;
                uniform float uTime;
                uniform float uWindAmp;
                uniform float uWindTime, uWindStrength, uPlanetRadius;
                uniform vec2 uWindDir;`,
            )
            .replace(
                '#include <begin_vertex>',
                /* glsl */ `#include <begin_vertex>
                {
                    // Blade tips sway along the surface, not along world X/Z,
                    // so grass on the planet's flank bends sideways rather
                    // than into the ground. Positions are world-space here.
                    float sway = aDetail.x, phase = aDetail.y;
                    // Hanging vines (phase >= 100): first move the whole vine with the
                    // canopy it hangs from — the voxel shader's exact leaf sway (same
                    // phase, height ramp and tangent wind, default stiffness 0.55) —
                    // so it doesn't detach from a swaying crown. Its own tip sway
                    // below then trails on top.
                    if (phase >= ${HANGING}.0 && uWindStrength > 0.0) {
                        phase -= ${HANGING}.0;
                        float cph = transformed.x * 0.31 + transformed.z * 0.27;
                        float flex = mix(0.35, 1.6, 0.55), rate = mix(0.85, 1.25, 0.55);
                        float cs = (sin(uWindTime * 1.1 * rate + cph) * 0.6
                                  + sin(uWindTime * 0.47 * rate + cph * 1.9) * 0.4) * uWindStrength * flex;
                        float hT = clamp((length(transformed) - uPlanetRadius) / 28.0, 0.0, 1.0);
                        vec3 rad = normalize(transformed);
                        vec3 w3 = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
                        vec3 wt = w3 - dot(w3, rad) * rad;
                        float wl = length(wt);
                        wt = wl > 0.001 ? wt / wl : vec3(1.0, 0.0, 0.0);
                        transformed += wt * cs * hT;
                    } else if (phase >= ${HANGING}.0) phase -= ${HANGING}.0;
                    vec3 up = normalize(transformed);
                    vec3 t1 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
                    vec3 t2 = cross(up, t1);
                    float w = sin(uTime * 0.85 + dot(transformed, vec3(0.13, 0.07, 0.09)) + phase) * 0.72
                            + sin(uTime * 2.30 + dot(transformed, vec3(0.41, 0.0, 0.17)) + phase * 1.7) * 0.28;
                    float a = sway * sway * uWindAmp;
                    transformed += (t1 + t2 * 0.55) * (w * a) - up * (abs(w) * a * 0.18);
                }`,
            );
    };
    mat.customProgramCacheKey = () => 'VoxelWorld-sphereveg-v4';
    return { mat, uniforms };
}

/** Draw one sprite plant (`id` from grid.plants, see plants.ts PLANT) at a column centre. */
function drawPlant(buf: QuadBuffer, centre: THREE.Vector3, rng: Rng, id: number) {
    const b = BLOCK_BY_ID[id] as any;
    _pLight.copy(b.topTint ?? b.top);
    // Base partway between the block's side and tip colour: the raw side colour
    // is authored for a shaded cube face and reads as a black stem on a blade.
    _pDark.copy(b.side).lerp(_pLight, 0.45);
    const blades = (
        n: number,
        spread: number,
        w0: number,
        w1: number,
        h0: number,
        h1: number,
        lean: number,
        sway: number,
    ) => {
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-spread, spread), rng.range(-spread, spread));
            tuft(
                buf,
                r,
                _up,
                rng.range(w0, w1),
                rng.range(h0, h1),
                _pDark,
                _pLight,
                rng() * 6.28,
                rng.range(-lean, lean),
                rng.range(-lean, lean),
                sway,
            );
        }
    };
    switch (id) {
        case PLANT.FERN.id:
        case PLANT.FERN_RED.id: {
            // Three-to-five arching fronds radiating from one root.
            const n = rng.int(3, 5);
            const rot0 = rng() * 6.28;
            for (let k = 0; k < n; k++) {
                const a = rot0 + (k / n) * 6.28;
                const lean = rng.range(0.32, 0.5);
                tuft(
                    buf,
                    root(centre, 0, 0),
                    _up,
                    rng.range(0.22, 0.3),
                    rng.range(0.5, 0.75),
                    _pDark,
                    _pLight,
                    a,
                    Math.cos(a) * lean,
                    Math.sin(a) * lean,
                    0.75,
                );
            }
            break;
        }
        case PLANT.GRASS_TALL.id:
            blades(rng.int(4, 6), 0.3, 0.12, 0.2, 0.7, 1.15, 0.2, 1.1);
            break;
        case PLANT.SCRUB_DRY.id:
            // Low, splayed, wiry desert scrub that barely moves in the wind.
            blades(rng.int(5, 8), 0.4, 0.06, 0.1, 0.3, 0.6, 0.35, 0.3);
            break;
        case PLANT.YUCCA.id: {
            // Rosette of long stiff blades fanning up and out from one root,
            // sometimes with a tall pale flower spike in the middle.
            const n = rng.int(9, 14);
            const rot0 = rng() * 6.28;
            for (let k = 0; k < n; k++) {
                const a = rot0 + (k / n) * 6.28 + rng.range(-0.2, 0.2);
                const lean = rng.range(0.25, 0.55);
                tuft(
                    buf,
                    root(centre, 0, 0),
                    _up,
                    rng.range(0.07, 0.11),
                    rng.range(0.7, 1.1),
                    _pDark,
                    _pLight,
                    a,
                    Math.cos(a) * lean,
                    Math.sin(a) * lean,
                    0.12,
                );
            }
            if (rng() < 0.4) {
                const h = rng.range(1.6, 2.4);
                tuft(buf, root(centre, 0, 0), _up, 0.05, h, _pDark, _pDark, 0, 0, 0, 0.2);
                box(buf, _base2.copy(centre).addScaledVector(_up, h - 0.5), _up, 0.16, 0.55, YUCCA_BLOOM, 0.2, 0);
            }
            break;
        }
        case PLANT.REED.id:
            // Reeds stand tall and nearly straight, with a darker seed head.
            blades(rng.int(3, 5), 0.25, 0.06, 0.1, 1.1, 1.7, 0.08, 0.7);
            break;
        case PLANT.SHRUB_TALL.id:
            // A dense, broad clump — the shrub without the cube.
            blades(rng.int(6, 9), 0.38, 0.3, 0.45, 0.6, 1.05, 0.18, 0.55);
            break;
        case PLANT.MOSS_THICK.id:
            // Low, flat cushion of very short tufts.
            blades(rng.int(6, 9), 0.42, 0.22, 0.34, 0.08, 0.16, 0.05, 0.15);
            break;
        case PLANT.LICHEN_PALE.id: {
            // A few pale, flat flecks hugging the stone.
            const n = rng.int(2, 4);
            for (let k = 0; k < n; k++) {
                const r = root(centre, rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)).addScaledVector(_up, -0.04);
                box(buf, r, _up, rng.range(0.16, 0.3), 0.06, _pLight, 0, 0);
            }
            break;
        }
    }
}

function scatterGroundDetail(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    detail: number,
    onStone: boolean,
    nearTrunk: boolean,
    lush: number,
    cols: DetailColours,
    /** Layers above sea. */
    rise: number,
): { h: number; r: number } | null {
    if (detail <= 0) return null;
    // Obstacles drawn here (rock group, fallen log) are returned for the walker's map.
    let ob = scatterBoulder(buf, centre, rng, detail, onStone, rise, cols.pebbles, cols.moss);
    if (nearTrunk) {
        // Fallen log: a long bark box with a moss strip along its top.
        if (rng() < LOG_P * detail) {
            const yaw = rng() * 6.28,
                len = rng.range(1.6, 2.6),
                th = rng.range(0.32, 0.42);
            const r = root(centre, rng.range(-0.2, 0.2), rng.range(-0.2, 0.2)).addScaledVector(_up, -0.06);
            boxYawed(buf, r, _up, th, th, len, cols.bark[(rng() * cols.bark.length) | 0], yaw);
            const top = _base2.copy(r).addScaledVector(_up, th);
            boxYawed(buf, top, _up, th * 0.7, 0.05, len * 0.8, cols.moss, yaw);
            // A log blocks the walker like a low rock (it reaches half its length out).
            if (!ob || ob.h < th) ob = { h: th - 0.06, r: len * 0.5 };
        }
    }
    // Mushrooms: damp ground at a tree's foot, occasionally out in lush meadow.
    if (rng() < MUSHROOM_P * detail * (nearTrunk ? 1 : lush > 0.7 ? 0.25 : 0)) {
        const cap = cols.caps[(rng() * cols.caps.length) | 0];
        const n = rng.int(2, 4);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
            const h = rng.range(0.14, 0.3),
                w = rng.range(0.22, 0.4);
            tuft(buf, r, _up, 0.06, h, cols.stem, cols.stem, rng() * 6.28, 0, 0, 0);
            box(buf, _base2.copy(r).addScaledVector(_up, h - 0.03), _up, w, w * 0.32, cap, 0.25, rng() * 6.28);
        }
    }
    return ob;
}

/**
 * A flat surface-aligned quad (a leaf on the ground, a lily pad on the water),
 * rotated by `yaw` in the tangent plane. `sway` lets pads bob a little.
 */
function flatQuad(
    buf: QuadBuffer,
    base: THREE.Vector3,
    up: THREE.Vector3,
    w: number,
    l: number,
    color: THREE.Color,
    yaw: number,
    sway: number,
) {
    const c = Math.cos(yaw),
        s = Math.sin(yaw);
    const ax = (_ta.x * c + _tb.x * s) * w * 0.5,
        ay = (_ta.y * c + _tb.y * s) * w * 0.5,
        az = (_ta.z * c + _tb.z * s) * w * 0.5;
    const bx = (_tb.x * c - _ta.x * s) * l * 0.5,
        by = (_tb.y * c - _ta.y * s) * l * 0.5,
        bz = (_tb.z * c - _ta.z * s) * l * 0.5;
    buf.vert(base.x - ax - bx, base.y - ay - by, base.z - az - bz, up, color, sway, yaw);
    buf.vert(base.x + ax - bx, base.y + ay - by, base.z + az - bz, up, color, sway, yaw);
    buf.vert(base.x + ax + bx, base.y + ay + by, base.z + az + bz, up, color, sway, yaw);
    buf.vert(base.x - ax + bx, base.y - ay + by, base.z - az + bz, up, color, sway, yaw);
}

/**
 * Lily pads on still fresh water: a few round-ish pads (an octagon of two quads
 * crossed would be heavier; two overlapping rotated squares read as round at
 * this size), a darker rim, and now and then a pale flower.
 */
function drawLilyPads(buf: QuadBuffer, surface: THREE.Vector3, rng: Rng, cols: DetailColours) {
    _pad.copy(cols.lily);
    _padRim.copy(cols.lily).multiplyScalar(0.78);
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
        const r = root(surface, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)).addScaledVector(_up, 0.02 + k * 0.004);
        const sz = rng.range(0.32, 0.55),
            yaw = rng() * 6.28;
        flatQuad(buf, r, _up, sz, sz, _padRim, yaw, 0.12);
        flatQuad(buf, _base2.copy(r).addScaledVector(_up, 0.003), _up, sz * 0.9, sz * 0.9, _pad, yaw + 0.785, 0.12);
        if (rng() < 0.22) {
            const f = _base2.copy(r).addScaledVector(_up, 0.02);
            box(buf, f, _up, 0.13, 0.08, cols.lilyFlower, 0.1, rng() * 6.28);
        }
    }
}

/** Dense waterside reed clump (taller and thicker than the lone REED plant). */
function drawReedClump(buf: QuadBuffer, centre: THREE.Vector3, rng: Rng, cols: DetailColours) {
    const n = rng.int(5, 9);
    for (let k = 0; k < n; k++) {
        const r = root(centre, rng.range(-0.42, 0.42), rng.range(-0.42, 0.42));
        tuft(
            buf,
            r,
            _up,
            rng.range(0.05, 0.09),
            rng.range(1.0, 1.8),
            cols.reedBase,
            cols.reedTip,
            rng() * 6.28,
            rng.range(-0.1, 0.1),
            rng.range(-0.1, 0.1),
            0.75,
        );
        // Cattail heads on some stems.
        if (rng() < 0.3) {
            const h = rng.range(1.1, 1.6);
            box(buf, _base2.copy(r).addScaledVector(_up, h), _up, 0.08, 0.22, cols.cattail, 0.7, rng() * 6.28);
        }
    }
}

/** Leaf litter: flat flecks in the canopy's own colour on the ground beneath it. */
function drawLeafLitter(buf: QuadBuffer, centre: THREE.Vector3, rng: Rng, leaf: THREE.Color, n: number) {
    for (let k = 0; k < n; k++) {
        const r = root(centre, rng.range(-0.45, 0.45), rng.range(-0.45, 0.45)).addScaledVector(_up, 0.012 + k * 0.002);
        // Fallen leaves are a touch duller and browner than the living canopy.
        _flat.copy(leaf).multiplyScalar(rng.range(0.7, 0.92)).lerp(LITTER_BROWN, rng.range(0.15, 0.45));
        flatQuad(buf, r, _up, rng.range(0.1, 0.18), rng.range(0.14, 0.24), _flat, rng() * 6.28, 0);
    }
}

/**
 * Hanging growth under a canopy block: vines and moss strands drooping from the
 * leaf underside (`under` = the bottom face centre), swaying at the tips.
 */
/** @param clearance layers of air under the canopy: vines stop short of the ground. */
function drawHanging(buf: QuadBuffer, under: THREE.Vector3, rng: Rng, cols: DetailColours, clearance = 3) {
    const n = rng.int(1, 4);
    for (let k = 0; k < n; k++) {
        // Three kinds, so a canopy edge has a natural mix rather than one length:
        // short wisps (50%), medium strands (35%) and long thick lianas (15%).
        // Lengths scale with the canopy's height: a low crown (~3 layers up) keeps
        // these base lengths; a tall tree's crown trails proportionally longer vines.
        const reach = Math.max(1, clearance / 3);
        const kind = rng();
        const [len, width] =
            kind < 0.5
                ? [rng.range(0.3, 0.9), rng.range(0.04, 0.08)]
                : kind < 0.85
                  ? [rng.range(0.9, 2.2), rng.range(0.06, 0.11)]
                  : [rng.range(2.2, 4.0), rng.range(0.08, 0.14)];
        // Never more than VINE_MAX_DROP of the way to the ground, nor longer than
        // VINE_MAX_LEN: tall crowns used to trail lianas to within 0.6 of the floor.
        const maxLen = Math.max(0.3, Math.min(clearance * VINE_MAX_DROP, VINE_MAX_LEN));
        const L = (x: number) => Math.min(maxLen, x * reach);
        // A tuft grown DOWN: base at the leaf underside, tip below it.
        const r = root(under, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
        _down.copy(_up).negate();
        // Lianas often hang as a pair of cords twisting a little apart.
        if (kind >= 0.85 && rng() < 0.6) {
            const r2 = _base2
                .copy(r)
                .addScaledVector(_ta, rng.range(-0.12, 0.12))
                .addScaledVector(_tb, rng.range(-0.12, 0.12));
            tuft(
                buf,
                r2,
                _down,
                width * 0.7,
                L(len * rng.range(0.75, 0.95)),
                cols.vine,
                cols.vineTip,
                rng() * 6.28,
                0,
                0,
                1.0,
                HANGING,
            );
        }
        tuft(
            buf,
            r,
            _down,
            width * Math.min(1.6, Math.sqrt(reach)), // long vines are thicker cords
            L(len),
            cols.vine,
            cols.vineTip,
            rng() * 6.28,
            0,
            0,
            kind >= 0.85 ? 1.0 : 0.9,
            HANGING,
        );
    }
}

/**
 * @param lush   0..1 meadow field: lush shelves vs close-cropped ones
 * @param bloom  0..1 flower-drift field
 */
function scatterColumn(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    block: any,
    density: number,
    lush: number,
    bloom: number,
    cols: DetailColours,
    /** Layers above sea. */
    rise: number,
) {
    const roll = rng();
    // Colours mirror the flat-world grass tufts: dark = topTint × 0.86, light = top × 1.08.
    _dark.copy(block.topTint ?? block.top).multiplyScalar(0.86);
    _light.copy(block.top).multiplyScalar(1.08);

    // Flowers gather in drifts rather than dusting evenly: a stem tuft and a
    // small coloured head that nods with the wind.
    if (bloom > FLOWER_EDGE && rng() < (bloom - FLOWER_EDGE) * FLOWER_P * density) {
        const col = cols.flowers[(rng() * cols.flowers.length) | 0];
        const alt = cols.flowers[(rng() * cols.flowers.length) | 0];
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
            const h = rng.range(0.24, 0.42);
            const head = _base2.copy(r).addScaledVector(_up, h - 0.04);
            tuft(buf, r, _up, 0.07, h, _dark, _dark, 0, 0, 0, 0.6);
            // One head in five takes a second colour, so a drift isn't a single swatch.
            box(buf, head, _up, 0.2, 0.16, rng() < 0.2 ? alt : col, 0.9, rng() * 6.28);
        }
    }

    // Tall lone blades: thin, long, leaning — the stray strands above the turf.
    if (rng() < BLADE_P * density * (0.4 + lush)) {
        const r = root(centre, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
        tuft(
            buf,
            r,
            _up,
            rng.range(0.05, 0.09),
            rng.range(0.6, 1.05),
            _dark,
            _light,
            rng() * 6.28,
            rng.range(-0.22, 0.22),
            rng.range(-0.22, 0.22),
            1.2,
        );
    }

    scatterPebble(buf, centre, rng, rise, cols.pebbles, cols.moss);

    if (roll < TREE_P) {
        // Small foliage clump: a stump tuft plus a wider cross ~1 unit up.
        tuft(
            buf,
            root(centre, 0, 0),
            _up,
            rng.range(0.25, 0.35),
            rng.range(0.6, 0.9),
            _dark,
            _light,
            rng() * 6.28,
            0,
            0,
            0.15,
        );
        const lift = _base.copy(centre).addScaledVector(_up, 0.85).addScaledVector(_ta, rng.range(-0.1, 0.1));
        tuft(buf, lift, _up, rng.range(0.55, 0.75), rng.range(0.9, 1.4), _dark, _light, rng() * 6.28, 0, 0, 0.4);
    } else if (roll < TREE_P + GRASS_P * density * (0.45 + lush * 1.1)) {
        // Lush shelves get fuller clumps; cropped ones a single tuft.
        const n = rng.int(1, lush > 0.6 ? 4 : 2);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.32, 0.32), rng.range(-0.32, 0.32));
            tuft(
                buf,
                r,
                _up,
                rng.range(0.16, 0.3),
                rng.range(0.26, 0.52),
                _dark,
                _light,
                rng() * 6.28,
                rng.range(-0.14, 0.14),
                rng.range(-0.14, 0.14),
                1,
            );
        }
    }
}

/**
 * @param density 0..1+ scales grass coverage (tier setting). Trees are kept at
 *        every tier — they are landmarks, grass is texture.
 */
export function createSphereVegetation(
    grid: SphereVoxelGrid,
    seed: number,
    scene: THREE.Scene,
    density = 1,
    windAmp = 0.1,
    /** Ground clutter multiplier (boulders, logs, mushrooms), 0 = none. */
    groundDetail = 1,
    /** Distance-to-water per column (distance-maps.ts); null = no waterside growth. */
    wet: Uint8Array | null = null,
) {
    const reedNoise = makeNoise3D(seed ^ 0x2eed);
    const { mat, uniforms } = makeVegMaterial(windAmp);
    const meadowNoise = makeNoise3D(seed ^ 0x51ed);
    const flowerNoise = makeNoise3D(seed ^ 0xf10e);
    const field = (noise: (x: number, y: number, z: number) => number, p: THREE.Vector3, f: number) =>
        (noise(p.x * f, p.y * f, p.z * f) * 0.65 + noise(p.x * f * 2.1, p.y * f * 2.1, p.z * f * 2.1) * 0.35 + 1) * 0.5;
    const group = new THREE.Group();
    group.name = 'veg';
    group.matrixAutoUpdate = false;
    scene.add(group);

    const buf = new QuadBuffer();
    /** Built patches by key; null = built and empty (no grass there). */
    const patches = new Map<number, THREE.Mesh | null>();
    /**
     * Walker obstacles drawn into the patches (rocks, logs): height above the ground per
     * column, in OBSTACLE_STEP units (0 = clear). Filled as patches build, which is always
     * the case around the player (LISTEN_RADIUS). Never cleared: placement is deterministic,
     * so a patch rebuilt later writes the same values. 960 KB.
     */
    const obstacleH = new Uint8Array(6 * FACE_RES * FACE_RES);
    /** How many loaded terrain chunks sit under each patch — built at >0, freed at 0. */
    const refs = new Map<number, number>();

    const keyOf = (face: number, pu: number, pv: number) => (face * PATCHES_PER_EDGE + pv) * PATCHES_PER_EDGE + pu;

    /**
     * Record an obstacle for the walker: its own column, plus neighbours it reaches into
     * (a big erratic, tor or log spills past its column; columns are ~1.8 units wide here).
     */
    function markObstacle(face: number, u: number, v: number, ob: { h: number; r: number }) {
        const q = Math.min(255, Math.ceil(ob.h / OBSTACLE_STEP));
        const spill = ob.r > 1.2 ? 1 : 0;
        for (let dv = -spill; dv <= spill; dv++)
            for (let du = -spill; du <= spill; du++) {
                const uu = u + du,
                    vv = v + dv;
                if (uu < 0 || vv < 0 || uu >= FACE_RES || vv >= FACE_RES) continue;
                const i = (face * FACE_RES + vv) * FACE_RES + uu;
                if (obstacleH[i] < q) obstacleH[i] = q;
            }
    }

    function build(face: number, pu: number, pv: number): THREE.Mesh | null {
        buf.reset();
        const cols = readColours();
        const rng = makeRng((seed ^ Math.imul(keyOf(face, pu, pv) + 1, 0x9e3779b1)) >>> 0);
        const drng = makeRng((seed ^ 0x6d2b79f5 ^ Math.imul(keyOf(face, pu, pv) + 1, 0x85ebca6b)) >>> 0);
        /** A trunk stands on a neighbouring column (logs and mushrooms gather at tree feet). */
        const nearTrunk = (u: number, v: number, layer: number) => {
            for (const [du, dv] of NEIGHBOURS4) {
                const b = BLOCK_BY_ID[grid.get(face, u + du, v + dv, layer + 1)] as any;
                // Living or dead wood only — cacti are solid "trunks" too, but no
                // mushrooms or fallen logs at a cactus foot.
                if (b?.isTrunk && b.pattern === PATTERN.BARK) return true;
            }
            return false;
        };
        /** Tangent frame (_ta, _tb) for the current _up. */
        const frame = () => {
            _ta.crossVectors(_up, Math.abs(_up.y) < 0.95 ? THREE.Object3D.DEFAULT_UP : _tb.set(1, 0, 0)).normalize();
            _tb.crossVectors(_up, _ta);
        };
        /** Still water: no 4-neighbour water surface lower than this one (a lake, not a rapid). */
        const isStill = (u: number, v: number, layer: number) => {
            for (const [du, dv] of NEIGHBOURS4) {
                const t = grid.columnTop(face, u + du, v + dv);
                if (t < layer && (BLOCK_BY_ID[grid.get(face, u + du, v + dv, t)] as any)?.isWater) return false;
            }
            return true;
        };
        const u1 = Math.min((pu + 1) * VEG_PATCH, FACE_RES),
            v1 = Math.min((pv + 1) * VEG_PATCH, FACE_RES);
        for (let v = pv * VEG_PATCH; v < v1; v++) {
            for (let u = pu * VEG_PATCH; u < u1; u++) {
                const layer = grid.columnTop(face, u, v);
                const plant = grid.plantAt(face, u, v);
                if (layer < 0 || (!plant && layer <= SEA_LAYER)) continue;
                const block = BLOCK_BY_ID[grid.get(face, u, v, layer)] as any;

                // Fresh water: lily pads on still lake/pond surfaces.
                if (block?.isWater) {
                    if (groundDetail > 0 && isStill(u, v, layer) && drng() < LILY_P * groundDetail) {
                        columnDir(face, u, v, FACE_RES, _up);
                        frame();
                        drawLilyPads(buf, _centre.copy(_up).multiplyScalar(PLANET_RADIUS + layer + 1), drng, cols);
                    }
                    continue;
                }

                // Under a canopy: the ground beneath gets leaf litter, and the
                // canopy's underside gets hanging growth in warm, damp zones.
                if (block?.sway) {
                    const g = grid.groundColumnTop(face, u, v);
                    if (g > SEA_LAYER && groundDetail > 0) {
                        columnDir(face, u, v, FACE_RES, _up);
                        frame();
                        const gb = BLOCK_BY_ID[grid.get(face, u, v, g)] as any;
                        if (gb?.grassCap || gb?.id === BLOCKS.SOIL.id || gb?.id === BLOCKS.SAND.id) {
                            const ground = _centre.copy(_up).multiplyScalar(PLANET_RADIUS + g + 1);
                            // Understorey ferns/moss (terrain.ts) on the shaded floor.
                            if (plant) drawPlant(buf, ground, rng, plant);
                            drawLeafLitter(buf, ground, drng, block.top, drng.int(2, 5));
                        }
                        // Lowest leaf block over open air (the canopy's underside).
                        let low = g + 1;
                        while (low < layer && !(BLOCK_BY_ID[grid.get(face, u, v, low)] as any)?.sway) low++;
                        const rise = g - SEA_LAYER;
                        const hangP = HANG_P * groundDetail * (rise <= 7 ? 1 : rise <= 14 ? 0.35 : 0);
                        if (low - g >= 3 && drng() < hangP)
                            drawHanging(
                                buf,
                                _base.copy(_up).multiplyScalar(PLANET_RADIUS + low),
                                drng,
                                cols,
                                low - g - 1,
                            );
                    }
                    continue;
                }
                const onStone = !!block && STONE_IDS.has(block.id);
                if (!plant && !block?.grassCap && !onStone) continue;
                columnDir(face, u, v, FACE_RES, _up);
                _ta.crossVectors(
                    _up,
                    Math.abs(_up.y) < 0.95 ? THREE.Object3D.DEFAULT_UP : _tb.set(1, 0, 0),
                ).normalize();
                _tb.crossVectors(_up, _ta);
                const centre = _centre.copy(_up).multiplyScalar(PLANET_RADIUS + layer + 1);
                if (plant) {
                    // The plant replaces this column's grass so the two don't pile up.
                    drawPlant(buf, centre, rng, plant);
                    continue;
                }
                const lush = field(meadowNoise, centre, MEADOW_FREQ);
                // Reed clumps on the bank right beside water, gathered by noise
                // into stands rather than a uniform fringe.
                const wd = wet ? wet[(face * FACE_RES + v) * FACE_RES + u] : 99;
                if (wd === 1 && !onStone && field(reedNoise, centre, 0.09) > 0.55 && rng() < REED_P * density) {
                    drawReedClump(buf, centre, rng, cols);
                    continue;
                }
                const rise = layer - SEA_LAYER;
                if (groundDetail > 0) {
                    const ob = scatterGroundDetail(
                        buf,
                        centre,
                        drng,
                        groundDetail,
                        onStone,
                        nearTrunk(u, v, layer),
                        lush,
                        cols,
                        rise,
                    );
                    if (ob && ob.h >= OBSTACLE_MIN_H) markObstacle(face, u, v, ob);
                }
                if (onStone) continue; // bare rock: boulders only, no grass
                const bloom = field(flowerNoise, centre, FLOWER_FREQ);
                scatterColumn(buf, centre, rng, block, density, lush, bloom, cols, rise);
            }
        }
        if (buf.n === 0) return null;

        const quads = buf.n / 4;
        const idx = buf.n <= 65535 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
        for (let q = 0; q < quads; q++) {
            const v = q * 4,
                i = q * 6;
            idx[i] = v;
            idx[i + 1] = v + 1;
            idx[i + 2] = v + 2;
            idx[i + 3] = v;
            idx[i + 4] = v + 2;
            idx[i + 5] = v + 3;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(buf.pos.slice(0, buf.n * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(buf.nrm.slice(0, buf.n * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(buf.col.slice(0, buf.n * 3), 3));
        geo.setAttribute('aDetail', new THREE.BufferAttribute(buf.det.slice(0, buf.n * 2), 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.boundingSphere!.radius += windAmp * 2 + 0.25; // keep swaying tips inside the cull volume

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `veg-${face}-${pu}-${pv}`;
        // Blades are too fine to cast anything but shadow-map noise, but they
        // receive cliff shadows or they float off the ground.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 2; // no depth write, so draw after terrain
        mesh.updateMatrixWorld();
        group.add(mesh);
        return mesh;
    }

    function release(key: number) {
        const mesh = patches.get(key);
        if (mesh) {
            group.remove(mesh);
            mesh.geometry.dispose();
        }
        patches.delete(key);
    }

    const _fp = new THREE.Vector3();
    return {
        group,
        /** Share the voxel canopy's wind uniforms, so hanging vines sway with the crowns. */
        setCanopyWind(u: { uWindTime: any; uWindDir: any; uWindStrength: any; uPlanetRadius: any }) {
            canopyWind.uWindTime = u.uWindTime;
            canopyWind.uWindDir = u.uWindDir;
            canopyWind.uWindStrength = u.uWindStrength;
            canopyWind.uPlanetRadius = u.uPlanetRadius;
            mat.needsUpdate = true;
        },
        /** Flower-drift density 0..1 at a unit direction (same field the flowers use). */
        bloomAt(dir: THREE.Vector3): number {
            return field(flowerNoise, _fp.copy(dir).multiplyScalar(PLANET_RADIUS + 20), FLOWER_FREQ);
        },
        /** Meadow lushness 0..1 at a unit direction. */
        lushAt(dir: THREE.Vector3): number {
            return field(meadowNoise, _fp.copy(dir).multiplyScalar(PLANET_RADIUS + 20), MEADOW_FREQ);
        },
        /**
         * Height (world units above the ground) of a rock or log the walker can't pass at
         * this column, or 0. Only rocks/logs of OBSTACLE_MIN_H or more are recorded; small
         * plants, flowers, grass and pebbles are always walk-through.
         */
        obstacleAt(face: number, u: number, v: number): number {
            return obstacleH[(face * FACE_RES + v) * FACE_RES + u] * OBSTACLE_STEP;
        },
        get patchCount() {
            return group.children.length;
        },
        /** Terrain chunk (face, ci, ck) of CHUNK columns has loaded. */
        chunkLoaded(face: number, u0: number, v0: number) {
            const pu = Math.floor(u0 / VEG_PATCH),
                pv = Math.floor(v0 / VEG_PATCH);
            const key = keyOf(face, pu, pv);
            const n = (refs.get(key) ?? 0) + 1;
            refs.set(key, n);
            if (n === 1 && !patches.has(key)) patches.set(key, build(face, pu, pv));
        },
        chunkUnloaded(face: number, u0: number, v0: number) {
            const key = keyOf(face, Math.floor(u0 / VEG_PATCH), Math.floor(v0 / VEG_PATCH));
            const n = (refs.get(key) ?? 1) - 1;
            if (n > 0) refs.set(key, n);
            else {
                refs.delete(key);
                release(key);
            }
        },
        update(dt: number) {
            uniforms.uTime.value += dt;
        },
        dispose() {
            for (const key of [...patches.keys()]) release(key);
            mat.dispose();
            scene.remove(group);
        },
    };
}
