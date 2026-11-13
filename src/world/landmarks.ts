// src/world/landmarks.ts
// Sphere-native landmark structures — ported geometry from voxel-world/stamps.ts,
// rewritten to use SphereVoxelGrid face-local (face, u, v, layer) coordinates.
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH, PLANET_RADIUS } from '../core/voxel';
import { BLOCKS, BLOCK_BY_ID, PATTERN, ROCK, registerBlock } from '../core/palette';
import { makeRng } from '../core/rng';
import { columnDir } from '../core/geoutil';
import { LANDMARK_NAMES_BY_KIND } from '../core/names';

export interface LandmarkRecord {
    kind:
        | 'spire'
        | 'obelisk'
        | 'ring'
        | 'tombs'
        | 'biosphere'
        | 'well'
        | 'arch'
        | 'ziggurat'
        | 'tower'
        | 'grove'
        | 'aqueduct';
    dir: THREE.Vector3; // world-space unit direction from planet centre
    /** A floating sky island (drawn on the map, but not a ground landmark). */
    sky?: boolean;
    /** Procedural name from core/names.ts, unique per planet. */
    name: string;
}

const _tmp = new THREE.Vector3();

type Kind = LandmarkRecord['kind'];

/**
 * One colour per landmark kind (sRGB hex), shared with the map badges so a
 * violet badge on the map is a violet-accented spire in the world.
 */
export const LANDMARK_COLOR: Record<Kind, number> = {
    spire: 0x9b5de5,
    obelisk: 0x2f80ed,
    ring: 0xf2b705,
    tombs: 0x7c8794,
    biosphere: 0x27ae60,
    well: 0x00a6a6,
    arch: 0xe8590c,
    ziggurat: 0xd4a017, // ochre
    tower: 0xc0392b, // crimson
    grove: 0xff5fa2, // magenta
    aqueduct: 0x5dade2, // sky
};

/*
 * Landmark stone. Landmarks used the terrain's own stone (they read as boulders),
 * then a coursed brick masonry (which read as brickwork, not ancient rock). Each
 * kind is now built from the natural stone that suits it, via the voxel shader's
 * shared `patRock` library (grain, veins, bedding, speckle, pits — no courses):
 *
 *   spire       basalt      dark, rough, vesicle pits
 *   obelisk     dark marble near-black, pale veins
 *   ring        marble      pale, cloudy, fine dark veins
 *   tombs       slate       dark blue-grey, tight cleavage, flaky
 *   biosphere   basalt      island rock under the soil
 *   well        granite     speckled crystal grain
 *   arch        slate       dark stone-slate
 *   ziggurat    sandstone   warm, soft bedding bands, grainy
 *   tower       granite     coarse grey, speckled
 *   grove       quartzite   pale crystalline sockets for the glowing shards
 *   aqueduct    sandstone   warm Roman stone
 *
 * BODY[kind] is the main stone; ACCENT[kind] is the same stone shot with the
 * kind's colour (so map badge and world agree); GEM[kind] is emissive, faceted.
 */
const col = (hex: number) => new THREE.Color(hex);
/** Base stone colours (sRGB hex): [top, side, bottom, tint (vein colour)]. */
const STONE_LOOK: Record<number, [number, number, number, number]> = {
    [ROCK.MARBLE]: [0xe8e4dc, 0xdcd6cc, 0xb8b2a8, 0x5a5660],
    [ROCK.DARK_MARBLE]: [0x3a3a44, 0x30303a, 0x22222a, 0xb8bcc8],
    [ROCK.SLATE]: [0x5a6270, 0x4c5462, 0x3a404c, 0x8a96a8],
    [ROCK.SANDSTONE]: [0xd8b88a, 0xc8a676, 0xa88a60, 0x8a6a44],
    [ROCK.GRANITE]: [0xb0aaa4, 0xa29c96, 0x847e78, 0x4a4644],
    [ROCK.BASALT]: [0x4a4644, 0x3e3a38, 0x2c2a28, 0x6a6460],
    [ROCK.QUARTZITE]: [0xece4e8, 0xe0d6dc, 0xc4b8c0, 0xffffff],
};
const KIND_STONE: Record<Kind, number> = {
    spire: ROCK.BASALT,
    obelisk: ROCK.DARK_MARBLE,
    ring: ROCK.MARBLE,
    tombs: ROCK.SLATE,
    biosphere: ROCK.BASALT,
    well: ROCK.GRANITE,
    arch: ROCK.SLATE,
    ziggurat: ROCK.SANDSTONE,
    tower: ROCK.GRANITE,
    grove: ROCK.QUARTZITE,
    aqueduct: ROCK.SANDSTONE,
};
/** A natural-stone block in a given style (reusable: any landmark or prop). */
function rockBlock(name: string, style: number, look: [number, number, number, number], tintWith?: THREE.Color) {
    const [t, s0, b0, v] = look.map(col);
    if (tintWith) for (const c of [t, s0, b0]) c.lerp(tintWith, 0.55);
    return registerBlock(name, {
        top: t,
        side: s0,
        bottom: b0,
        tint: v,
        pattern: PATTERN.STONE,
        rockStyle: style,
        rough: style === ROCK.DARK_MARBLE || style === ROCK.MARBLE ? 0.3 : 0.6,
    });
}
const BODY = {} as Record<Kind, { id: number }>;
const ACCENT = {} as Record<Kind, { id: number }>;
const GEM = {} as Record<Kind, { id: number }>;
for (const kind of Object.keys(LANDMARK_COLOR) as Kind[]) {
    const c = col(LANDMARK_COLOR[kind]);
    const style = KIND_STONE[kind];
    BODY[kind] = rockBlock(`LANDMARK_STONE_${kind.toUpperCase()}`, style, STONE_LOOK[style]);
    ACCENT[kind] = rockBlock(`LANDMARK_ACCENT_${kind.toUpperCase()}`, style, STONE_LOOK[style], c);
    GEM[kind] = registerBlock(`LANDMARK_GEM_${kind.toUpperCase()}`, {
        top: c.clone().lerp(col(0xffffff), 0.45),
        side: c.clone().lerp(col(0xffffff), 0.3),
        bottom: c.clone(),
        tint: c.clone().lerp(col(0xffffff), 0.6),
        pattern: PATTERN.NONE,
        rough: 0.1,
        emissive: 0.8,
    });
}

/** Clearing radius per kind (columns): enough open ground for the shape to read. */
const CLEAR_R: Record<Kind, number> = {
    spire: 6,
    obelisk: 6,
    ring: 16, // the ring itself is radius 13
    tombs: 14,
    biosphere: 8,
    well: 6,
    arch: 8,
    ziggurat: 9,
    tower: 6,
    grove: 9,
    aqueduct: 14,
};

/**
 * Clear trees, bushes, cacti and ground cover around a site (they were scattered
 * before landmarks are placed). Only foliage and trunk blocks go, so the land
 * and any river or lake water are untouched.
 */
function clearAround(grid: SphereVoxelGrid, face: number, cu: number, cv: number, r: number) {
    for (let dv = -r; dv <= r; dv++)
        for (let du = -r; du <= r; du++) {
            if (du * du + dv * dv > r * r) continue;
            const u = cu + du,
                v = cv + dv;
            if (u < 1 || v < 1 || u >= FACE_RES - 1 || v >= FACE_RES - 1) continue;
            grid.setPlant(face, u, v, 0);
            for (let l = grid.columnTop(face, u, v); l > 0; l--) {
                const b = BLOCK_BY_ID[grid.get(face, u, v, l)] as any;
                if (!b) continue; // air
                if (b.sway || b.isTrunk || b.name?.startsWith('BUSH') || b.name === 'SCRUB') grid.set(face, u, v, l, 0);
                else break; // reached the ground (or water)
            }
        }
}

const SEA_LAYER = 11;
/** Ground landmarks across the planet, dealt round-robin to the faces. */
// 27 = 2 full decks of the 11 kinds + 5 more, so every kind appears 2-3 times.
const LANDMARK_TOTAL = 27;
const MIN_SEP = 20; // minimum u/v distance between two landmarks on same face

// Safe block setter — clips to grid bounds, never overwrites non-air
function put(grid: SphereVoxelGrid, face: number, u: number, v: number, layer: number, id: number) {
    if (u < 1 || v < 1 || u >= FACE_RES - 1 || v >= FACE_RES - 1 || layer < 1 || layer >= SHELL_DEPTH) return;
    if (grid.get(face, u, v, layer) !== 0) return;
    grid.set(face, u, v, layer, id);
}

// Overwrite even if occupied (for base/footing blocks)
function overwrite(grid: SphereVoxelGrid, face: number, u: number, v: number, layer: number, id: number) {
    if (u < 1 || v < 1 || u >= FACE_RES - 1 || v >= FACE_RES - 1 || layer < 1 || layer >= SHELL_DEPTH) return;
    grid.set(face, u, v, layer, id);
}

function top(grid: SphereVoxelGrid, face: number, u: number, v: number): number {
    return grid.columnTop(face, u, v);
}

/** Dry land above the sea (a river or lake surface doesn't count). */
function isLand(grid: SphereVoxelGrid, face: number, u: number, v: number): boolean {
    const t = top(grid, face, u, v);
    return t > SEA_LAYER + 1 && !(BLOCK_BY_ID[grid.get(face, u, v, t)] as any)?.isWater;
}

// ── Landmark builders ────────────────────────────────────────────────────────

function twistedSpire(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);

    // 3×3 STONE_WARM footing
    for (let dy = 1; dy <= 2; dy++)
        for (let dv = -1; dv <= 1; dv++)
            for (let du = -1; du <= 1; du++) overwrite(grid, face, cu + du, cv + dv, baseL + dy, ACCENT.spire.id);

    // Twisted shaft
    const totalH = 14 + rng.int(0, 8);
    const dirs = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
    ];
    let ou = 0,
        ov = 0;
    for (let dy = 3; dy <= totalH; dy++) {
        // Masonry with an accent band every fifth course.
        put(grid, face, cu + ou, cv + ov, baseL + dy, dy % 5 === 0 ? ACCENT.spire.id : BODY.spire.id);
        if (dy % 4 === 2) {
            const [ddu, ddv] = dirs[rng.int(0, 3)];
            ou = Math.max(-2, Math.min(2, ou + ddu));
            ov = Math.max(-2, Math.min(2, ov + ddv));
        }
    }
    put(grid, face, cu + ou, cv + ov, baseL + totalH + 1, GEM.spire.id);
}

function obelisk(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);

    // 3×3 base
    for (let dy = 1; dy <= 2; dy++)
        for (let dv = -1; dv <= 1; dv++)
            for (let du = -1; du <= 1; du++) overwrite(grid, face, cu + du, cv + dv, baseL + dy, ACCENT.obelisk.id);

    // Taller shaft: 2x2 for the lower third, then 1x1, capped by a gem.
    const shaftH = 12 + rng.int(0, 6);
    for (let dy = 3; dy <= shaftH; dy++) {
        put(grid, face, cu, cv, baseL + dy, BODY.obelisk.id);
        if (dy < 3 + shaftH / 3) {
            put(grid, face, cu + 1, cv, baseL + dy, BODY.obelisk.id);
            put(grid, face, cu, cv + 1, baseL + dy, BODY.obelisk.id);
            put(grid, face, cu + 1, cv + 1, baseL + dy, BODY.obelisk.id);
        }
    }
    put(grid, face, cu, cv, baseL + shaftH + 1, GEM.obelisk.id);

    // Lantern stones either side, with small gems.
    for (const du of [-3, 3]) {
        const lL = top(grid, face, cu + du, cv);
        put(grid, face, cu + du, cv, lL + 1, BODY.obelisk.id);
        put(grid, face, cu + du, cv, lL + 2, GEM.obelisk.id);
    }
}

/**
 * Monolith ring, after planet-explorer's: nine tall slabs on a radius-13 circle,
 * each 2 wide and 1 deep and turned to face the centre (its long side along the
 * ring's tangent), 8-12 high, sunk one layer into the ground, with a slight lean
 * at the top. Voxel Planet extras: the slabs are capped in the ring's accent
 * colour, and a glowing altar marks the centre so the ring shows at night.
 * Stones are weathered marble (patRock style ROCK.MARBLE).
 */
function monolithRing(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const COUNT = 9;
    const R = 13;
    // Altar at the centre: an accent plinth with a glowing gem.
    if (isLand(grid, face, cu, cv)) {
        const cL = top(grid, face, cu, cv);
        for (let dv = -1; dv <= 1; dv++)
            for (let du = -1; du <= 1; du++) overwrite(grid, face, cu + du, cv + dv, cL + 1, ACCENT.ring.id);
        put(grid, face, cu, cv, cL + 2, GEM.ring.id);
    }
    for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const su = Math.round(cu + Math.cos(a) * R);
        const sv = Math.round(cv + Math.sin(a) * R);
        if (!isLand(grid, face, su, sv)) continue;
        const h = 8 + rng.int(0, 4);
        // Tangent direction, snapped to the grid axis it runs closest to: the
        // slab's 2-wide face then looks toward the centre.
        const tu = -Math.sin(a),
            tv = Math.cos(a);
        const [wu, wv] = Math.abs(tu) > Math.abs(tv) ? [Math.sign(tu), 0] : [0, Math.sign(tv)];
        // Slight lean: the top two layers step one block outward or inward.
        const lean = rng.chance(0.5) ? (rng.chance(0.5) ? 1 : -1) : 0;
        const ou = lean * Math.round(Math.cos(a)),
            ov = lean * Math.round(Math.sin(a));
        for (const w of [0, 1]) {
            const cu2 = su + wu * w,
                cv2 = sv + wv * w;
            const g = top(grid, face, cu2, cv2);
            // Sunk one layer into the ground, like planet-explorer's (- 0.6).
            for (let l = g; l <= g + h; l++) {
                const leaning = l > g + h - 2;
                const id = l === g + h ? ACCENT.ring.id : BODY.ring.id;
                overwrite(grid, face, cu2 + (leaning ? ou : 0), cv2 + (leaning ? ov : 0), l, id);
            }
        }
    }
}

function tombstoneField(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const count = 14 + rng.int(0, 8);
    const fieldR = 12;
    // A central memorial pillar with a gem, so the field has a focus.
    if (isLand(grid, face, cu, cv)) {
        const cL = top(grid, face, cu, cv);
        for (let dy = 1; dy <= 4; dy++) put(grid, face, cu, cv, cL + dy, dy === 1 ? ACCENT.tombs.id : BODY.tombs.id);
        put(grid, face, cu, cv, cL + 5, GEM.tombs.id);
    }
    for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(2, fieldR);
        const su = Math.round(cu + Math.cos(a) * d);
        const sv = Math.round(cv + Math.sin(a) * d);
        if (!isLand(grid, face, su, sv)) continue;
        const sL = top(grid, face, su, sv);
        const sh = 2 + rng.int(0, 2);
        for (let dy = 1; dy <= sh; dy++)
            put(
                grid,
                face,
                su,
                sv,
                sL + dy,
                dy === sh ? ACCENT.tombs.id : rng.chance(0.55) ? BODY.tombs.id : BLOCKS.STONE.id,
            );
        // Random lean cap
        if (rng.chance(0.35)) {
            const leans = [
                [1, 0],
                [0, 1],
                [-1, 0],
                [0, -1],
            ];
            const [ldu, ldv] = leans[rng.int(0, 3)];
            put(grid, face, su + ldu, sv + ldv, sL + sh, BLOCKS.STONE.id);
        }
    }
}

function floatingBiosphere(
    grid: SphereVoxelGrid,
    face: number,
    cu: number,
    cv: number,
    rng: ReturnType<typeof makeRng>,
) {
    const baseL = top(grid, face, cu, cv);
    const floatL = baseL + 18 + rng.int(0, 10);
    const rx = 5 + rng.int(0, 2),
        rv = rx,
        ry = 3;

    for (let dy = -ry; dy <= ry; dy++) {
        for (let dv = -rv; dv <= rv; dv++) {
            for (let du = -rx; du <= rx; du++) {
                const q = (du / rx) ** 2 + (dy / ry) ** 2 + (dv / rv) ** 2;
                if (q > 1.0) continue;
                const qTop = (du / rx) ** 2 + ((dy + 1) / ry) ** 2 + (dv / rv) ** 2;
                const isTop = qTop > 1.0;
                let id: number;
                if (isTop && dy > 0) id = BLOCKS.LEAF_CREAM.id;
                else if (isTop) id = BODY.biosphere.id;
                else if (dy > 0) id = BLOCKS.SOIL.id;
                else id = ACCENT.biosphere.id;
                overwrite(grid, face, cu + du, cv + dv, floatL + dy, id);
            }
        }
    }

    // Stalactite drips
    for (let k = 0; k < 8; k++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(1, rx - 1);
        const su = cu + Math.round(Math.cos(a) * d);
        const sv = cv + Math.round(Math.sin(a) * d);
        const len = rng.int(3, 8);
        for (let dy = 1; dy <= len; dy++) {
            // Glowing tips hang below the island.
            const id = dy === len ? GEM.biosphere.id : dy <= 2 ? ACCENT.biosphere.id : BODY.biosphere.id;
            put(grid, face, su, sv, floatL - ry - dy, id);
        }
    }

    // Small tree on top
    const topL = floatL + ry + 1;
    overwrite(grid, face, cu, cv, topL, BLOCKS.SOIL.id);
    const trunk = BLOCKS.TRUNK_PALE;
    const leaf = rng.pick([BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT, BLOCKS.LEAF_LILAC] as any[]) as any;
    for (let dy = 1; dy <= 3; dy++) put(grid, face, cu, cv, topL + dy, trunk.id);
    for (let dv = -2; dv <= 2; dv++)
        for (let du = -2; du <= 2; du++)
            if (Math.abs(du) + Math.abs(dv) <= 3) put(grid, face, cu + du, cv + dv, topL + 4, leaf.id);
    for (let dv = -1; dv <= 1; dv++)
        for (let du = -1; du <= 1; du++) put(grid, face, cu + du, cv + dv, topL + 5, leaf.id);
}

function ancientWell(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);

    // Stone rim — 3×3 ring, hollow centre
    for (let dv = -1; dv <= 1; dv++)
        for (let du = -1; du <= 1; du++) {
            if (du === 0 && dv === 0) continue;
            overwrite(grid, face, cu + du, cv + dv, baseL + 1, BODY.well.id);
            overwrite(grid, face, cu + du, cv + dv, baseL + 2, ACCENT.well.id);
        }
    // Glowing water-gem in the shaft.
    overwrite(grid, face, cu, cv, baseL, GEM.well.id);

    // Posts and crossbeam
    for (const du of [-1, 1]) for (let dy = 3; dy <= 4; dy++) put(grid, face, cu + du, cv, baseL + dy, BODY.well.id);
    for (let du = -1; du <= 1; du++) put(grid, face, cu + du, cv, baseL + 5, ACCENT.well.id);

    // Scattered worn stones nearby
    for (let i = 0; i < 4 + rng.int(0, 3); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(3, 6);
        const su = Math.round(cu + Math.cos(a) * d);
        const sv = Math.round(cv + Math.sin(a) * d);
        if (isLand(grid, face, su, sv)) put(grid, face, su, sv, top(grid, face, su, sv) + 1, BODY.well.id);
    }
}

function ruinedArch(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);
    const span = 3 + rng.int(0, 2);
    const pillarH = 5 + rng.int(0, 2);

    // Two pillars along U axis
    for (const du of [-span, span]) {
        const pL = top(grid, face, cu + du, cv);
        for (let dy = 1; dy <= pillarH; dy++)
            put(grid, face, cu + du, cv, pL + dy, dy % 3 === 0 ? ACCENT.arch.id : BODY.arch.id);
    }

    // Partial lintel
    const lintelL = baseL + pillarH + 1;
    const missing = new Set<number>();
    const missCt = 1 + rng.int(0, 1);
    for (let m = 0; m < missCt; m++) missing.add(rng.int(1, span * 2 - 1));
    for (let i = 0; i <= span * 2; i++) {
        if (missing.has(i)) continue;
        put(grid, face, cu - span + i, cv, lintelL, i === span ? GEM.arch.id : ACCENT.arch.id);
    }

    // Rubble scatter
    for (let i = 0; i < 6 + rng.int(0, 4); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(1, span + 3);
        const ru = Math.round(cu + Math.cos(a) * d);
        const rv = Math.round(cv + Math.sin(a) * d);
        if (isLand(grid, face, ru, rv))
            put(grid, face, ru, rv, top(grid, face, ru, rv) + 1, rng.chance(0.5) ? BLOCKS.STONE.id : BODY.arch.id);
    }
}

/** Stepped temple: four shrinking terraces, a stair up one side, a shrine and gem on top. */
function ziggurat(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);
    const tiers = 4;
    const R0 = 6 + rng.int(0, 1);
    let l = baseL + 1;
    for (let t = 0; t < tiers; t++) {
        const r = R0 - t * 2;
        for (let h = 0; h < 2; h++, l++)
            for (let dv = -r; dv <= r; dv++)
                for (let du = -r; du <= r; du++) {
                    const edge = Math.max(Math.abs(du), Math.abs(dv)) === r;
                    overwrite(grid, face, cu + du, cv + dv, l, edge && h === 1 ? ACCENT.ziggurat.id : BODY.ziggurat.id);
                }
    }
    // Stair up the +v side: one step per layer, cut into the terraces.
    for (let k = 0; k < tiers * 2; k++) overwrite(grid, face, cu, cv + R0 - k, baseL + 1 + k, ACCENT.ziggurat.id);
    // Shrine: four posts and a gem.
    for (const [du, dv] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
    ])
        for (let h = 0; h < 2; h++) put(grid, face, cu + du, cv + dv, l + h, BODY.ziggurat.id);
    put(grid, face, cu, cv, l, GEM.ziggurat.id);
}

/** Ruined watchtower: hollow round tower, broken crown, a lit window slit. */
function watchtower(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);
    const H = 14 + rng.int(0, 6);
    const R = 2.6;
    for (let h = 1; h <= H; h++)
        for (let dv = -3; dv <= 3; dv++)
            for (let du = -3; du <= 3; du++) {
                const d = Math.hypot(du, dv);
                if (d > R + 0.4 || d < R - 0.8) continue; // hollow ring wall
                // Broken crown: the top few courses crumble away on one side.
                if (h > H - 3 && du + dv > (H - h) * 1.5) continue;
                const band = h % 6 === 0;
                overwrite(grid, face, cu + du, cv + dv, baseL + h, band ? ACCENT.tower.id : BODY.tower.id);
            }
    // Lit window slit high on the wall, and a beacon gem on the crown.
    put(grid, face, cu + 3, cv, baseL + Math.floor(H * 0.6), GEM.tower.id);
    overwrite(grid, face, cu - 2, cv - 1, baseL + H - 2, GEM.tower.id);
    // Fallen stones at the foot.
    for (let i = 0; i < 6; i++) {
        const a = rng.range(0, Math.PI * 2),
            d = rng.range(3.5, 6);
        const su = Math.round(cu + Math.cos(a) * d),
            sv = Math.round(cv + Math.sin(a) * d);
        if (isLand(grid, face, su, sv)) put(grid, face, su, sv, top(grid, face, su, sv) + 1, BODY.tower.id);
    }
}

/** Crystal grove: clusters of glowing leaning shards of mixed height — eerie at night. */
function crystalGrove(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const n = 7 + rng.int(0, 5);
    for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2),
            d = i === 0 ? 0 : rng.range(1.5, 7);
        const su = Math.round(cu + Math.cos(a) * d),
            sv = Math.round(cv + Math.sin(a) * d);
        if (!isLand(grid, face, su, sv)) continue;
        const sL = top(grid, face, su, sv);
        const H = i === 0 ? 9 + rng.int(0, 4) : 3 + rng.int(0, 5);
        const [lu, lv] = rng.pick([
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ] as Array<[number, number]>);
        let ou = 0,
            ov = 0;
        overwrite(grid, face, su, sv, sL + 1, ACCENT.grove.id); // rooted socket
        for (let h = 2; h <= H; h++) {
            if (h % 3 === 0) {
                ou += lu;
                ov += lv;
            }
            put(grid, face, su + ou, sv + ov, sL + h, GEM.grove.id);
        }
    }
}

/** Aqueduct: a run of arches carrying a channel, broken partway along. */
function aqueduct(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const baseL = top(grid, face, cu, cv);
    const half = 9 + rng.int(0, 3);
    const deckL = baseL + 7;
    const gap = rng.int(-half + 3, half - 3); // where it has fallen
    for (let du = -half; du <= half; du++) {
        const g = top(grid, face, cu + du, cv);
        if (Math.abs(du - gap) <= 1) continue; // the break
        // Piers every 4 columns, arches between them (open below the deck).
        const pier = du % 4 === 0;
        const archTop = deckL - 1 - (pier ? 0 : Math.round(2 * Math.sin(((((du % 4) + 4) % 4) / 4) * Math.PI)));
        for (let l = g + 1; l <= deckL; l++) {
            if (!pier && l < archTop) continue;
            overwrite(grid, face, cu + du, cv, l, l === deckL ? ACCENT.aqueduct.id : BODY.aqueduct.id);
            overwrite(grid, face, cu + du, cv + 1, l, BODY.aqueduct.id);
        }
        // Channel lip with glowing water-gems along the deck every few columns.
        put(grid, face, cu + du, cv - 1, deckL + 1, BODY.aqueduct.id);
        put(grid, face, cu + du, cv + 2, deckL + 1, BODY.aqueduct.id);
        if (du % 3 === 0) put(grid, face, cu + du, cv, deckL + 1, GEM.aqueduct.id);
    }
}

/* ---- sky islands ----------------------------------------------------------
 * Extra floating islands spread through the sky, over land and sea, on top of
 * the ground landmarks. Each is an inverted cone of rock under a grassy cap,
 * with glowing drips and a tree or two; sizes and heights vary so the sky has
 * depth. Kept below SHELL_DEPTH (the grid's ceiling) including the trees. */
const SKY_ISLANDS = 10;
const SKY_MIN_L = 46; // above the highest peaks (~layer 35)
const SKY_MAX_L = 78; // leaves room for the cap + trees under SHELL_DEPTH (96)

function skyIsland(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const R = 3 + rng.int(0, 5); // 3..8
    const capL = SKY_MIN_L + rng.int(0, SKY_MAX_L - SKY_MIN_L);
    const depth = Math.round(R * rng.range(1.1, 1.6)); // cone below the cap
    const nB = makeRng((rng() * 0xffffffff) | 0);
    // Lumpy outline: a per-angle radius jitter.
    const jag = Array.from({ length: 12 }, () => nB.range(0.75, 1.15));
    const rAt = (du: number, dv: number) => {
        const a = ((Math.atan2(dv, du) / (Math.PI * 2) + 1) % 1) * 12;
        const i = Math.floor(a),
            t = a - i;
        return R * (jag[i % 12] * (1 - t) + jag[(i + 1) % 12] * t);
    };
    for (let dv = -R - 2; dv <= R + 2; dv++)
        for (let du = -R - 2; du <= R + 2; du++) {
            const d = Math.hypot(du, dv),
                rr = rAt(du, dv);
            if (d > rr) continue;
            // Cone: deeper at the centre, shallow at the rim.
            const bottom = Math.round(depth * (1 - (d / rr) ** 1.6));
            for (let k = 0; k <= bottom; k++) {
                const l = capL - k;
                const id =
                    k === 0
                        ? BLOCKS.GRASS.id
                        : k <= 2
                          ? BLOCKS.SOIL.id
                          : k === bottom
                            ? ACCENT.biosphere.id
                            : BODY.biosphere.id;
                overwrite(grid, face, cu + du, cv + dv, l, id);
            }
        }
    // Glowing drips from the underside.
    for (let k = 0; k < 3 + R; k++) {
        const a = rng.range(0, Math.PI * 2),
            d = rng.range(0, R * 0.7);
        const su = cu + Math.round(Math.cos(a) * d),
            sv = cv + Math.round(Math.sin(a) * d);
        const under = capL - Math.round(depth * (1 - (d / R) ** 1.6)) - 1;
        const len = rng.int(1, 4);
        for (let j = 0; j < len; j++)
            put(grid, face, su, sv, under - j, j === len - 1 ? GEM.biosphere.id : BODY.biosphere.id);
    }
    // A tree or two on top.
    const trees = R >= 5 ? rng.int(1, 3) : 1;
    const leaf = rng.pick([BLOCKS.LEAF_MINT, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_PINK, BLOCKS.LEAF_LILAC] as any[]) as any;
    for (let t = 0; t < trees; t++) {
        const tu = cu + rng.int(-Math.floor(R / 2), Math.floor(R / 2)),
            tv = cv + rng.int(-Math.floor(R / 2), Math.floor(R / 2));
        const h = rng.int(3, 5);
        for (let l = 1; l <= h; l++) put(grid, face, tu, tv, capL + l, BLOCKS.TRUNK_PALE.id);
        for (let dv = -2; dv <= 2; dv++)
            for (let du = -2; du <= 2; du++)
                if (Math.abs(du) + Math.abs(dv) <= 3) put(grid, face, tu + du, tv + dv, capL + h + 1, leaf.id);
        for (let dv = -1; dv <= 1; dv++)
            for (let du = -1; du <= 1; du++) put(grid, face, tu + du, tv + dv, capL + h + 2, leaf.id);
    }
}

// ── Site picker & entry point ────────────────────────────────────────────────

const BUILDERS = [
    twistedSpire,
    obelisk,
    monolithRing,
    tombstoneField,
    floatingBiosphere,
    ancientWell,
    ruinedArch,
    ziggurat,
    watchtower,
    crystalGrove,
    aqueduct,
];

const KINDS: LandmarkRecord['kind'][] = [
    'spire',
    'obelisk',
    'ring',
    'tombs',
    'biosphere',
    'well',
    'arch',
    'ziggurat',
    'tower',
    'grove',
    'aqueduct',
];

export function buildSphereLandmarks(grid: SphereVoxelGrid, rng: ReturnType<typeof makeRng>): LandmarkRecord[] {
    const records: LandmarkRecord[] = [];
    // Names: per pool, a seeded shuffle dealt in order, so each name is unique on
    // this planet and the same for the same seed. Pools hold 18; no kind places
    // more than 3, and there are 10 sky islands, so a pool never runs out.
    const nameDecks = new Map<string, string[]>();
    const nameFor = (pool: string) => {
        let d = nameDecks.get(pool);
        if (!d) {
            d = [...(LANDMARK_NAMES_BY_KIND[pool] ?? [])];
            for (let i = d.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [d[i], d[j]] = [d[j], d[i]];
            }
            nameDecks.set(pool, d);
        }
        return d.pop() ?? pool;
    };
    // Deal kinds from shuffled decks across the whole planet, so all eleven
    // appear before any repeats (a random start per face gave five tombstone
    // fields on one seed and no ziggurat at all).
    let deck: number[] = [];
    const nextKind = () => {
        if (!deck.length) {
            deck = KINDS.map((_, i) => i);
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
        }
        return deck.pop()!;
    };

    for (let face = 0; face < 6; face++) {
        const placed: [number, number][] = [];
        let attempts = 0;
        // 16 over 6 faces: faces 0-3 get 3, faces 4-5 get 2.
        const quota = Math.floor(LANDMARK_TOTAL / 6) + (face < LANDMARK_TOTAL % 6 ? 1 : 0);

        while (placed.length < quota && attempts < 1200) {
            attempts++;
            const u = 10 + Math.floor(rng() * (FACE_RES - 20));
            const v = 10 + Math.floor(rng() * (FACE_RES - 20));

            if (!isLand(grid, face, u, v)) continue;

            const tooClose = placed.some(([pu, pv]) => Math.abs(u - pu) < MIN_SEP && Math.abs(v - pv) < MIN_SEP);
            if (tooClose) continue;

            const k = nextKind();
            const kind = KINDS[k];
            const builder = BUILDERS[k];
            // Open ground first: trees were planted before landmarks, and they hid
            // them (and lifted 'top' onto the canopy).
            clearAround(grid, face, u, v, CLEAR_R[kind]);
            builder(grid, face, u, v, makeRng((rng() * 0xffffffff) | 0));
            placed.push([u, v]);

            columnDir(face, u, v, FACE_RES, _tmp);
            records.push({ kind, dir: _tmp.clone(), name: nameFor(kind) });
        }
    }

    // Sky islands: anywhere (land or sea), well apart from each other and from
    // the ground landmarks' columns.
    const sky: Array<[number, number, number]> = [];
    for (let n = 0, tries = 0; n < SKY_ISLANDS && tries < SKY_ISLANDS * 80; tries++) {
        const face = n % 6;
        const u = 14 + Math.floor(rng() * (FACE_RES - 28));
        const v = 14 + Math.floor(rng() * (FACE_RES - 28));
        if (sky.some(([f, pu, pv]) => f === face && Math.hypot(u - pu, v - pv) < 60)) continue;
        skyIsland(grid, face, u, v, makeRng((rng() * 0xffffffff) | 0));
        sky.push([face, u, v]);
        n++;
        columnDir(face, u, v, FACE_RES, _tmp);
        records.push({ kind: 'biosphere', dir: _tmp.clone(), sky: true, name: nameFor('island') });
    }

    return records;
}
