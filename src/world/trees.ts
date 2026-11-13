// src/world/trees.ts
// Trees: bark and species-leaf blocks, altitude zones and species mixes, and every
// tree builder (plantZoneTree / plantSphereTree and their forms). Split out of
// terrain.ts; terrain.ts drives placement.
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { makeRng } from '../core/rng';
import { BLOCKS, PATTERN, registerBlock } from '../core/palette';

const c = (hex: number) => new THREE.Color(hex);

/**
 * Dead, weathered wood: bleached grey-brown. The bark pattern gives it furrows,
 * and isTrunk makes it solid and lets the vegetation layer read it as a trunk.
 */
export const DEADWOOD = registerBlock('DEADWOOD', {
    top: c(0x9a8c78),
    side: c(0x857866),
    bottom: c(0x6e6252),
    tint: c(0x6a5e4e),
    pattern: PATTERN.BARK,
    rough: 0.7,
    isTrunk: true,
});
/** Birch: pale bark with the bark pattern's furrows (reads as dark streaks on white). */
export const BIRCH = registerBlock('BIRCH', {
    top: c(0xd8d2c4),
    side: c(0xcac2b2),
    bottom: c(0xa8a092),
    tint: c(0x5a5248),
    pattern: PATTERN.BARK,
    barkStyle: 1, // papery: lenticel dashes, peeling curls
    rough: 0.5,
    isTrunk: true,
});
/*
 * Bark variety. Every trunk used one furrowed-bark texture, so a palm, a pine and
 * a birch differed only in colour. `barkStyle` picks a distinct texture in the
 * voxel shader (0 furrowed, 1 papery, 2 scaly, 3 ringed, 4 smooth).
 */
/** Conifer bark: scaly reddish plates (pine, fir, spruce, krummholz, juniper). */
export const BARK_SCALY = registerBlock('BARK_SCALY', {
    top: c(0x5a3424),
    side: c(0x4a2a1c),
    bottom: c(0x3a2014),
    tint: c(0x2a1610),
    pattern: PATTERN.BARK,
    barkStyle: 2,
    rough: 0.7,
    isTrunk: true,
});
/** Palm bark: ringed leaf scars on a fibrous tan trunk. */
export const BARK_RINGED = registerBlock('BARK_RINGED', {
    top: c(0x9a8462),
    side: c(0x8a7454),
    bottom: c(0x6e5c42),
    tint: c(0x4a3c2a),
    pattern: PATTERN.BARK,
    barkStyle: 3,
    rough: 0.75,
    isTrunk: true,
});
/** Smooth grey-green bark (cypress, mangrove, willow, acacia). */
export const BARK_SMOOTH = registerBlock('BARK_SMOOTH', {
    top: c(0x6e6a5a),
    side: c(0x5e5a4c),
    bottom: c(0x4a463a),
    tint: c(0x3a3a2e),
    pattern: PATTERN.BARK,
    barkStyle: 4,
    rough: 0.55,
    isTrunk: true,
});

/*
 * Species with their own canopy colours (not the palette's foliage slots, which
 * every broadleaf shares): sway-flagged, so wind and canopy shading apply.
 */
const leafBlock = (name: string, top: number, side: number) =>
    registerBlock(name, {
        top: c(top),
        side: c(side),
        bottom: c(side).multiplyScalar(0.8),
        tint: c(top).lerp(c(0xffffff), 0.2),
        pattern: PATTERN.NONE,
        rough: 0.22,
        sway: true,
    });
const LEAF_MAPLE = [
    leafBlock('LEAF_MAPLE_RED', 0xc8402a, 0xa8331f),
    leafBlock('LEAF_MAPLE_ORANGE', 0xe07a2c, 0xc06420),
];
const LEAF_CHERRY = [leafBlock('LEAF_CHERRY', 0xf4b6c8, 0xe39ab0), leafBlock('LEAF_CHERRY_PALE', 0xfad4de, 0xecbccb)];
const LEAF_JACARANDA = [
    leafBlock('LEAF_JACARANDA', 0x9b7fd8, 0x8268c0),
    leafBlock('LEAF_JACARANDA_PALE', 0xb9a4e6, 0x9f88d2),
];
const LEAF_ASPEN = [leafBlock('LEAF_ASPEN', 0xd8c84a, 0xbfae3a), leafBlock('LEAF_ASPEN_GREEN', 0x9cbf52, 0x84a744)];
/** Redwood: deep red-brown, fibrous furrowed bark. */
export const BARK_REDWOOD = registerBlock('BARK_REDWOOD', {
    top: c(0x7a3420),
    side: c(0x6a2a18),
    bottom: c(0x4e1e10),
    tint: c(0x3a140a),
    pattern: PATTERN.BARK,
    barkStyle: 0,
    rough: 0.75,
    isTrunk: true,
});

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
export type Zone = 'coast' | 'lowland' | 'midland' | 'highland' | 'treeline';
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
    | 'juniper'
    // Distinct silhouettes with their own leaf colours / bark:
    | 'maple'
    | 'cherry'
    | 'redwood'
    | 'jacaranda'
    | 'dragon'
    | 'aspen';
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

export const zoneOf = (rise: number): Zone =>
    rise <= 3 ? 'coast' : rise <= 7 ? 'lowland' : rise <= 11 ? 'midland' : rise <= 15 ? 'highland' : 'treeline';

/** Per zone: tree chance per grass column, species weights, size range (0..1). */
export const ZONE: Record<Zone, { treeP: number; mix: Array<[Species, number]>; size: [number, number] }> = {
    coast: {
        treeP: 0.011,
        mix: [
            ['palm', 5],
            ['broadleaf', 3],
            ['mangrove', 2],
            ['willow', 1],
            ['dragon', 1],
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
            ['cherry', 2],
            ['jacaranda', 1],
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
            ['maple', 3],
            ['cherry', 1],
            ['aspen', 2],
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
            ['redwood', 2],
            ['aspen', 2],
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

export function weightedPick<T>(mix: Array<[T, number]>, rng: ReturnType<typeof makeRng>): T {
    let total = 0;
    for (const [, w] of mix) total += w;
    let r = rng() * total;
    for (const [s, w] of mix) if ((r -= w) <= 0) return s;
    return mix[mix.length - 1][0];
}

const dirs4: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

export function plantZoneTree(
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
    // Size variety: the zone range, a ±25% per-tree jitter, and a real age mix —
    // ~10% young saplings (0.4-0.6x) and ~7% old giants (1.4-1.7x). A forest used to
    // sit mostly in a 5-14 layer band, so stands read as uniform.
    const age = rng();
    const ageK = age < 0.1 ? rng.range(0.4, 0.6) : age > 0.93 ? rng.range(1.4, 1.7) : rng.range(0.75, 1.25);
    const size = Math.min(1.7, rng.range(z.size[0], z.size[1]) * ageK);
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
    // Crown lean (shape variety): about a third of trees drift their canopy one
    // or two columns downwind as it rises. Trunks stay vertical; the shift grows
    // with height, so a tall crown curves and a short one barely moves.
    // Only open-crowned species lean: conifers (whose trunk runs up through the
    // tiers) and the palm/dragon/aspen builders that place their own crown tops
    // stay true, or the crown would detach from the trunk.
    const LEANS = species === 'emergent' || species === 'maple' || species === 'cherry' || species === 'jacaranda';
    const leaning = LEANS && rng() < 0.33;
    const [leanU, leanV] = leaning ? dirs4[Math.floor(rng() * 4)] : [0, 0];
    const leanK = leaning ? rng.range(0.05, 0.11) : 0; // columns of drift per layer
    /** A flat disc of leaves (radius r, Chebyshev with clipped corners) at height dl. */
    const disc = (cu: number, dl: number, cv: number, r: number, id: number, ragged = 0.0) => {
        const drift = Math.round(Math.max(0, dl) * leanK);
        cu += leanU * drift;
        cv += leanV * drift;
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
                    set(ou + lu, l - 1, ov + lv, BARK_RINGED.id); // joint, so the bend reads as one trunk
                    ou += lu;
                    ov += lv;
                }
                set(ou, l, ov, BARK_RINGED.id);
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
            for (let l = 0; l < h; l++) set(0, l, 0, BARK_SCALY.id);
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
            for (let l = 0; l < h; l++) set(0, l, 0, BARK_SCALY.id);
            const leaf = pick(roles.conifer);
            for (let l = 1; l <= h; l++) {
                set(0, l, 0, leaf);
                for (let r = 1; r <= 1 + (l < h ? 1 : 0); r++) set(wu * r, l, wv * r, leaf); // downwind flag
            }
            return;
        }
        case 'maple': {
            // Dense, rounded crown in autumn reds and oranges, on a sturdy trunk.
            const h = Math.round(4 + size * 4);
            for (let l = 0; l < h; l++) set(0, l, 0, BLOCKS.TRUNK.id);
            const r = Math.max(2, Math.round(2 + size * 2));
            const [a, b] = LEAF_MAPLE;
            // A tall ellipsoid crown (about 1.5x as tall as wide), not a squat ball.
            const H = Math.round(r * 3);
            for (let l = 0; l <= H; l++) {
                const t = (l - H / 2) / (H / 2 + 0.5);
                const rr = Math.round(r * Math.sqrt(Math.max(0, 1 - t * t)));
                disc(0, h - 1 + l, 0, Math.max(1, rr), rng() < 0.5 ? a.id : b.id, 0.18);
            }
            return;
        }
        case 'cherry': {
            // Wide, low, spreading crown — blossom pink — on a short smooth trunk.
            const h = Math.round(3 + size * 2);
            const [lu, lv] = dirs[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(l > h - 2 ? lu : 0, l, l > h - 2 ? lv : 0, BARK_SMOOTH.id);
            const r = Math.round(3 + size * 3);
            const [a, b] = LEAF_CHERRY;
            // Spreading but domed: a broad base tapering over 4-6 layers to a
            // rounded top, not a flat disc.
            const tiers = 4 + Math.round(size * 2);
            for (let k = 0; k < tiers; k++)
                disc(
                    lu,
                    h + k,
                    lv,
                    Math.max(1, Math.round(r * (1 - (k / tiers) ** 1.6))),
                    k & 1 ? b.id : a.id,
                    0.3 + k * 0.03,
                );
            return;
        }
        case 'redwood': {
            // Very tall straight trunk (2x2 when big), bare most of the way, a short
            // narrow conical crown high up.
            const h = Math.round(16 + size * 12);
            const thick = size > 0.5;
            for (let l = 0; l < h; l++) {
                set(0, l, 0, BARK_REDWOOD.id);
                if (thick) {
                    set(1, l, 0, BARK_REDWOOD.id);
                    set(0, l, 1, BARK_REDWOOD.id);
                    set(1, l, 1, BARK_REDWOOD.id);
                }
            }
            const leaf = pick(roles.conifer);
            const crown = Math.round(5 + size * 4);
            for (let k = 0; k < crown; k++) {
                const r = Math.max(1, Math.round((crown - k) * 0.45) + (thick ? 1 : 0));
                disc(0, h - crown + k + 2, 0, r, leaf, 0.12);
            }
            set(0, h + 2, 0, leaf);
            return;
        }
        case 'jacaranda': {
            // Open umbrella crown of violet blossom on a leaning, forked trunk.
            const h = Math.round(5 + size * 3);
            const [lu, lv] = dirs[Math.floor(rng() * 4)];
            for (let l = 0; l < h; l++) set(l > h / 2 ? lu : 0, l, l > h / 2 ? lv : 0, BARK_SMOOTH.id);
            // Fork: two limbs to opposite sides of the crown.
            set(lu + lv, h - 1, lv - lu, BARK_SMOOTH.id);
            set(lu - lv, h - 1, lv + lu, BARK_SMOOTH.id);
            const r = Math.round(4 + size * 3);
            const [a, b] = LEAF_JACARANDA;
            disc(lu, h, lv, r, a.id, 0.4);
            disc(lu, h + 1, lv, Math.max(2, r - 2), b.id, 0.45);
            return;
        }
        case 'dragon': {
            // Dragon tree: thick trunk forking into radiating arms, each ending in a
            // flat rosette of stiff leaves — an upturned umbrella.
            const h = Math.round(3 + size * 3);
            for (let l = 0; l < h; l++) set(0, l, 0, BARK_RINGED.id);
            const leaf = pick(roles.broad);
            const arms: Array<[number, number]> = [...dirs, [1, 1], [-1, 1], [1, -1], [-1, -1]];
            const reach = Math.round(2 + size * 2);
            for (const [du, dv] of arms) {
                if (rng() < 0.25) continue;
                for (let k = 1; k <= reach; k++) set(du * k, h + k, dv * k, BARK_RINGED.id);
                disc(du * reach, h + reach + 1, dv * reach, 1, leaf, 0.1);
            }
            return;
        }
        case 'aspen': {
            // Slim white trunk, small trembling crown, grown in a small clonal stand.
            const n = 1 + Math.floor(rng() * 3);
            for (let t = 0; t < n; t++) {
                const ou = t === 0 ? 0 : Math.round((rng() - 0.5) * 6),
                    ov = t === 0 ? 0 : Math.round((rng() - 0.5) * 6);
                const h = Math.round(6 + size * 6 + (rng() - 0.5) * 3);
                for (let l = 0; l < h; l++) set(ou, l, ov, BIRCH.id);
                const leaf = LEAF_ASPEN[rng() < 0.6 ? 0 : 1].id;
                for (let l = Math.round(h * 0.6); l <= h; l++)
                    disc(ou, l, ov, l === h ? 0 : 1, leaf, l === h ? 0 : 0.3);
                set(ou, h + 1, ov, leaf);
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
/** Forms that get a tapering dome on top (not the ones meant to be flat or spired). */
const DOMED = new Set<TreeForm>([
    'round',
    'broad',
    'twin',
    'weeping',
    'stack',
    'nub',
    'tall',
    'oak',
    'mangrove',
    'baobab',
]);
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
    // Bark by species: conifers scaly, palms ringed, wetland and savanna trees
    // smooth; the broadleaf blossom forms keep the furrowed browns.
    const trunk =
        form === 'pine' || form === 'juniper' || form === 'spire' || form === 'layered'
            ? BARK_SCALY
            : form === 'palm'
              ? BARK_RINGED
              : form === 'cypress' || form === 'mangrove' || form === 'willow' || form === 'acacia'
                ? BARK_SMOOTH
                : form === 'baobab' || form === 'oak'
                  ? BLOCKS.TRUNK
                  : rng.chance(0.55)
                    ? BLOCKS.TRUNK
                    : BLOCKS.TRUNK_PALE;
    const twoTone = rng.chance(0.62);
    const li = twoTone ? pale.id : leaf.id;
    const dx = rng.chance(0.5) ? 1 : -1;
    const dz = rng.chance(0.5) ? 1 : -1;

    // Trunk height varies by form and scale. The jitter is wide (±3) and independent
    // of crown size, so one species comes both tall-and-lanky and short-and-full.
    const jitter = Math.round(rng.range(-3, 3));
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

    // Domed crown: many forms are wide but only 1-2 layers deep, so a forest read
    // as a sea of flat tops. Over half the trees of the forms that aren't meant to
    // be flat raise a tapering dome on their crown — 2-5 layers, each narrower —
    // so canopies gain real vertical height and rounded tops.
    if (DOMED.has(form) && rng() < 0.55) {
        const base = _topDl - bare + 1; // the layer just above the current crown top
        const layers = large ? rng.int(3, 5) : unit === 2 ? rng.int(2, 4) : rng.int(1, 3);
        const w0 = large ? 5 : unit === 2 ? 4 : 3;
        for (let k = 0; k < layers; k++) {
            const w = Math.max(1, Math.round(w0 * (1 - k / (layers + 0.5))));
            fill(k & 1 ? dx : 0, base + k, k & 1 ? dz : 0, w, 1, w, k === layers - 1 ? li : leaf.id);
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
