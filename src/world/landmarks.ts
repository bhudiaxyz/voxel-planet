// src/world/landmarks.ts
// Sphere-native landmark structures — ported geometry from voxel-world/stamps.ts,
// rewritten to use SphereVoxelGrid face-local (face, u, v, layer) coordinates.
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH, PLANET_RADIUS } from '../core/voxel';
import { BLOCKS, BLOCK_BY_ID, PATTERN, registerBlock } from '../core/palette';
import { makeRng } from '../core/rng';
import { columnDir } from '../core/geoutil';

export interface LandmarkRecord {
    kind: 'spire' | 'obelisk' | 'ring' | 'tombs' | 'biosphere' | 'well' | 'arch';
    dir: THREE.Vector3; // world-space unit direction from planet centre
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
};

/*
 * Landmarks used the terrain's own stone blocks, so they read as boulders.
 * They get their own: a carved, coursed masonry (brick pattern, warm cream —
 * nothing natural on the planet looks like it), an accent stone in the kind's
 * colour, and an emissive gem that the bloom pass catches, so a landmark shows
 * from a distance by day and glows at night.
 */
const col = (hex: number) => new THREE.Color(hex);
const MASON = registerBlock('LANDMARK_MASONRY', {
    top: col(0xf0e4c8),
    side: col(0xe2d0aa),
    bottom: col(0xc9b48c),
    tint: col(0xb8a07a), // mortar
    pattern: PATTERN.BRICK,
    rough: 0.55,
});
const ACCENT = {} as Record<Kind, { id: number }>;
const GEM = {} as Record<Kind, { id: number }>;
for (const kind of Object.keys(LANDMARK_COLOR) as Kind[]) {
    const c = col(LANDMARK_COLOR[kind]);
    ACCENT[kind] = registerBlock(`LANDMARK_ACCENT_${kind.toUpperCase()}`, {
        top: c.clone().lerp(col(0xffffff), 0.12),
        side: c.clone(),
        bottom: c.clone().multiplyScalar(0.75),
        tint: c.clone().multiplyScalar(0.7),
        pattern: PATTERN.BRICK,
        rough: 0.4,
    });
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
const CLEAR_R: Record<Kind, number> = { spire: 6, obelisk: 6, ring: 13, tombs: 14, biosphere: 8, well: 6, arch: 8 };

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
/** Landmarks across the planet: 16 (was 12, i.e. +33%), dealt round-robin to the faces. */
const LANDMARK_TOTAL = 16;
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
        put(grid, face, cu + ou, cv + ov, baseL + dy, dy % 5 === 0 ? ACCENT.spire.id : MASON.id);
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
        put(grid, face, cu, cv, baseL + dy, MASON.id);
        if (dy < 3 + shaftH / 3) {
            put(grid, face, cu + 1, cv, baseL + dy, MASON.id);
            put(grid, face, cu, cv + 1, baseL + dy, MASON.id);
            put(grid, face, cu + 1, cv + 1, baseL + dy, MASON.id);
        }
    }
    put(grid, face, cu, cv, baseL + shaftH + 1, GEM.obelisk.id);

    // Lantern stones either side, with small gems.
    for (const du of [-3, 3]) {
        const lL = top(grid, face, cu + du, cv);
        put(grid, face, cu + du, cv, lL + 1, MASON.id);
        put(grid, face, cu + du, cv, lL + 2, GEM.obelisk.id);
    }
}

function monolithRing(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
    const count = 7 + rng.int(0, 1);
    const ringR = 8 + rng.int(0, 3);
    // Altar at the centre: an accent plinth with a glowing gem.
    if (isLand(grid, face, cu, cv)) {
        const cL = top(grid, face, cu, cv);
        for (let dv = -1; dv <= 1; dv++)
            for (let du = -1; du <= 1; du++) overwrite(grid, face, cu + du, cv + dv, cL + 1, ACCENT.ring.id);
        put(grid, face, cu, cv, cL + 2, GEM.ring.id);
    }

    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const su = Math.round(cu + Math.cos(a) * ringR);
        const sv = Math.round(cv + Math.sin(a) * ringR);
        if (!isLand(grid, face, su, sv)) continue;
        const sL = top(grid, face, su, sv);
        const sh = 5 + rng.int(0, 3);
        for (let dy = 1; dy <= sh; dy++) put(grid, face, su, sv, sL + dy, dy === sh ? ACCENT.ring.id : MASON.id);

        // Lintel connecting every other pair
        if (i % 2 === 0) {
            const a2 = ((i + 1) / count) * Math.PI * 2;
            const eu = Math.round(cu + Math.cos(a2) * ringR);
            const ev = Math.round(cv + Math.sin(a2) * ringR);
            if (!isLand(grid, face, eu, ev)) continue;
            const lintelL = sL + sh + 1;
            const steps = Math.max(Math.abs(eu - su), Math.abs(ev - sv));
            if (steps > 0 && steps < 10) {
                for (let k = 0; k <= steps; k++) {
                    const lu = Math.round(su + ((eu - su) * k) / steps);
                    const lv = Math.round(sv + ((ev - sv) * k) / steps);
                    put(grid, face, lu, lv, lintelL, MASON.id);
                }
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
        for (let dy = 1; dy <= 4; dy++) put(grid, face, cu, cv, cL + dy, dy === 1 ? ACCENT.tombs.id : MASON.id);
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
            put(grid, face, su, sv, sL + dy, dy === sh ? ACCENT.tombs.id : rng.chance(0.55) ? MASON.id : BLOCKS.STONE.id);
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
                else if (isTop) id = MASON.id;
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
            const id = dy === len ? GEM.biosphere.id : dy <= 2 ? ACCENT.biosphere.id : MASON.id;
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
            overwrite(grid, face, cu + du, cv + dv, baseL + 1, MASON.id);
            overwrite(grid, face, cu + du, cv + dv, baseL + 2, ACCENT.well.id);
        }
    // Glowing water-gem in the shaft.
    overwrite(grid, face, cu, cv, baseL, GEM.well.id);

    // Posts and crossbeam
    for (const du of [-1, 1]) for (let dy = 3; dy <= 4; dy++) put(grid, face, cu + du, cv, baseL + dy, MASON.id);
    for (let du = -1; du <= 1; du++) put(grid, face, cu + du, cv, baseL + 5, ACCENT.well.id);

    // Scattered worn stones nearby
    for (let i = 0; i < 4 + rng.int(0, 3); i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(3, 6);
        const su = Math.round(cu + Math.cos(a) * d);
        const sv = Math.round(cv + Math.sin(a) * d);
        if (isLand(grid, face, su, sv)) put(grid, face, su, sv, top(grid, face, su, sv) + 1, MASON.id);
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
            put(grid, face, cu + du, cv, pL + dy, dy % 3 === 0 ? ACCENT.arch.id : MASON.id);
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
            put(
                grid,
                face,
                ru,
                rv,
                top(grid, face, ru, rv) + 1,
                rng.chance(0.5) ? BLOCKS.STONE.id : MASON.id,
            );
    }
}

// ── Site picker & entry point ────────────────────────────────────────────────

const BUILDERS = [twistedSpire, obelisk, monolithRing, tombstoneField, floatingBiosphere, ancientWell, ruinedArch];

const KINDS: LandmarkRecord['kind'][] = ['spire', 'obelisk', 'ring', 'tombs', 'biosphere', 'well', 'arch'];

export function buildSphereLandmarks(grid: SphereVoxelGrid, rng: ReturnType<typeof makeRng>): LandmarkRecord[] {
    const records: LandmarkRecord[] = [];

    for (let face = 0; face < 6; face++) {
        const placed: [number, number][] = [];
        let attempts = 0;
        let landmarkIdx = Math.floor(rng() * BUILDERS.length);
        // 16 over 6 faces: faces 0-3 get 3, faces 4-5 get 2.
        const quota = Math.floor(LANDMARK_TOTAL / 6) + (face < LANDMARK_TOTAL % 6 ? 1 : 0);

        while (placed.length < quota && attempts < 400) {
            attempts++;
            const u = 10 + Math.floor(rng() * (FACE_RES - 20));
            const v = 10 + Math.floor(rng() * (FACE_RES - 20));

            if (!isLand(grid, face, u, v)) continue;

            const tooClose = placed.some(([pu, pv]) => Math.abs(u - pu) < MIN_SEP && Math.abs(v - pv) < MIN_SEP);
            if (tooClose) continue;

            const kind = KINDS[landmarkIdx % KINDS.length];
            const builder = BUILDERS[landmarkIdx % BUILDERS.length];
            // Open ground first: trees were planted before landmarks, and they hid
            // them (and lifted 'top' onto the canopy).
            clearAround(grid, face, u, v, CLEAR_R[kind]);
            builder(grid, face, u, v, makeRng((rng() * 0xffffffff) | 0));
            placed.push([u, v]);
            landmarkIdx++;

            columnDir(face, u, v, FACE_RES, _tmp);
            records.push({ kind, dir: _tmp.clone() });
        }
    }

    return records;
}
