/**
 * Rocks — boulders, scree, slabs, tors, standing stones and pebbles.
 *
 * Purpose
 *   Authors the stone clutter that vegetation.ts draws into each surface-detail patch mesh.
 *   Rocks are not voxels: they are yawed boxes in the shared QuadBuffer, so they cost no grid
 *   space and need no block registration.
 *
 * Operations
 *   Altitude drives everything: how many rocks (rockAt, a multiplier by rise above sea that
 *   climbs steeply above the highland line), which shapes (SHAPES, weighted per zone from
 *   trees.ts zoneOf) and how they weather (WEATHER: size scale, moss chance, bleaching):
 *     coast     sea-worn cobbles and low rounded stones, little moss
 *     lowland   half-buried mossy boulders
 *     midland   stacked boulders, slabs, the first scree
 *     highland  big erratics, tors, scree fields
 *     treeline  frost-shattered shards, standing stones, scree, bare and pale
 *   - scatterBoulder makes one roll per column (BOULDER_P x detail x rockAt, x3 on bare stone),
 *     then builds a group of sunk, yawed boxes. Colours come from the theme's three stones,
 *     varied light/dark, mossy low down, bleached high up. It returns the group's extent
 *     ({ h: top above ground, r: reach from the column centre }, or null) so the vegetation layer
 *     can record it as a walker obstacle.
 *   - scatterPebble does the small stones (PEBBLE_P x rockAt), on the grass RNG stream so the
 *     grass layout is unchanged.
 *   - STONE_IDS lists bare ground that takes rocks but no grass: stone blocks and SNOW.
 *   Boulders draw from vegetation.ts's separate ground-detail stream, so tier settings never
 *   shift where the grass lands.
 *
 * Usage
 *   Called per column from vegetation.ts (scatterGroundDetail / scatterColumn). Drawing needs the
 *   caller to have set veg-geom's tangent frame (_up, _ta, _tb) for the column first.
 *
 * See also: vegetation.ts, veg-geom.ts, trees.ts (Zone, zoneOf, weightedPick); DESIGN.md
 * "7. Vegetation" (Rocks).
 */
import * as THREE from 'three';
import { BLOCKS } from '../core/blocks';
import { makeRng } from '../core/rng';
import { QuadBuffer, _up, box, boxYawed, root } from './veg-geom';
import { SNOW, weightedPick, zoneOf } from './trees';
import type { Zone } from './trees';

type Rng = ReturnType<typeof makeRng>;

const BOULDER_P = 0.0045; // per grass column; ×3 on bare stone
const PEBBLE_P = 0.008;
/**
 * Boulder/pebble multiplier by layers above sea: ~0.35 on the coast, 1 at midland,
 * then a steep climb above the highland line (rise 15) to 7 on the peaks.
 */
export const rockAt = (rise: number) => Math.min(7, Math.max(0.35, 0.1 + rise * 0.11 + Math.max(0, rise - 15) * 0.4));

type Shape = 'cobbles' | 'rounded' | 'stacked' | 'scree' | 'slab' | 'erratic' | 'tor' | 'shards' | 'standing';
/** Shape weights per zone. */
const SHAPES: Record<Zone, Array<[Shape, number]>> = {
    coast: [
        ['cobbles', 5],
        ['rounded', 3],
        ['slab', 1],
    ],
    lowland: [
        ['rounded', 5],
        ['stacked', 2],
        ['cobbles', 1],
        ['slab', 1],
    ],
    midland: [
        ['stacked', 4],
        ['rounded', 2],
        ['slab', 2],
        ['scree', 2],
        ['erratic', 1],
    ],
    highland: [
        ['erratic', 3],
        ['tor', 3],
        ['scree', 3],
        ['stacked', 2],
        ['slab', 1],
        ['shards', 1],
    ],
    treeline: [
        ['shards', 4],
        ['scree', 4],
        ['standing', 2],
        ['tor', 2],
        ['erratic', 1],
    ],
};
/** Weathering per zone: size scale, moss chance, and lighten toward bleached (frost/lichen). */
const WEATHER: Record<Zone, { size: number; moss: number; pale: number }> = {
    coast: { size: 0.75, moss: 0.05, pale: 0.15 },
    lowland: { size: 0.9, moss: 0.45, pale: 0 },
    midland: { size: 1, moss: 0.22, pale: 0.05 },
    highland: { size: 1.2, moss: 0.1, pale: 0.15 },
    treeline: { size: 1.1, moss: 0.03, pale: 0.3 },
};

/** Bare ground that takes rocks but no grass: stone, and snowfields above the snowline. */
export const STONE_IDS = new Set([BLOCKS.STONE.id, BLOCKS.STONE_PALE.id, BLOCKS.STONE_WARM.id, SNOW.id]);
const _stone = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/**
 * One roll per column on the ground-detail stream; draws a rock group on a hit.
 * Returns what it drew as an obstacle — `h` the top above the ground, `r` how far it
 * reaches from the column centre (world units) — or null if nothing was drawn. The
 * vegetation layer records it so the walker can't pass through boulders (controller.ts).
 */
export function scatterBoulder(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    detail: number,
    onStone: boolean,
    /** Layers above sea at this column. */
    rise: number,
    stones: THREE.Color[],
    moss: THREE.Color,
): { h: number; r: number } | null {
    if (rng() >= BOULDER_P * detail * rockAt(rise) * (onStone ? 3 : 1)) return null;
    const zone = zoneOf(rise);
    const w = WEATHER[zone];
    // Stone colour per block: one of the theme's three stones, lightened or
    // darkened (weathered vs fresh-split), mossy low down, bleached up high.
    // Built from the palette, so every theme keeps its own rock.
    const col = () => {
        _stone.copy(stones[(rng() * stones.length) | 0]).multiplyScalar(rng.range(0.7, 1.12));
        if (rng() < w.moss) _stone.lerp(moss, rng.range(0.15, 0.4));
        else if (w.pale && rng() < 0.5) _stone.lerp(WHITE, rng.range(0, w.pale));
        return _stone;
    };
    // Per-group size: the zone's scale times a wide spread, with the odd giant.
    const S = w.size * rng.range(0.6, 1.3) * (rng() < 0.08 ? 1.6 : 1);
    const yaw = () => rng() * 6.28;
    // Extent of the group, for the obstacle record: highest top, furthest reach.
    let top = 0,
        reach = 0;
    /** A yawed block whose base sits `sink` below the ground at tangent offset (a, b). */
    const block = (a: number, b: number, sink: number, bw: number, bh: number, bl: number) => {
        top = Math.max(top, bh - sink);
        reach = Math.max(reach, Math.hypot(a, b) + Math.max(bw, bl) * 0.5);
        boxYawed(buf, root(centre, a, b).addScaledVector(_up, -sink), _up, bw, bh, bl, col(), yaw());
    };

    switch (weightedPick(SHAPES[zone], rng)) {
        case 'cobbles': {
            // Sea-worn cobbles: a handful of low, rounded-off stones (two stacked
            // shrinking boxes each, so the top reads round, not cut).
            const n = rng.int(3, 7);
            for (let k = 0; k < n; k++) {
                const a = rng.range(-0.42, 0.42),
                    b = rng.range(-0.42, 0.42),
                    sz = rng.range(0.18, 0.38) * S,
                    h = sz * rng.range(0.35, 0.55);
                block(a, b, 0.04, sz, h, sz * rng.range(0.9, 1.4));
                block(a, b, 0.04 - h, sz * 0.65, h * 0.5, sz * 0.8);
            }
            break;
        }
        case 'rounded': {
            // Rounded boulder, half sunk: three stacked tiers narrowing to a dome.
            const s0 = rng.range(0.6, 1.0) * S;
            const a = rng.range(-0.15, 0.15),
                b = rng.range(-0.15, 0.15);
            block(a, b, s0 * 0.35, s0, s0 * 0.55, s0 * rng.range(0.9, 1.25));
            block(a, b, -s0 * 0.15, s0 * 0.78, s0 * 0.25, s0 * 0.85);
            block(a, b, -s0 * 0.38, s0 * 0.48, s0 * 0.15, s0 * 0.55);
            break;
        }
        case 'stacked': {
            // Two or three stacked, rotated blocks, half sunk into the ground.
            const n = rng.int(1, 3);
            const s0 = rng.range(0.55, 0.95) * S;
            for (let k = 0; k < n; k++) {
                const sz = s0 * (1 - k * 0.3);
                block(
                    rng.range(-0.25, 0.25),
                    rng.range(-0.25, 0.25),
                    0.15 - k * s0 * 0.45,
                    sz,
                    sz * rng.range(0.55, 0.8),
                    sz,
                );
            }
            break;
        }
        case 'scree': {
            // Loose scree: many small angular stones spread over the column.
            const n = rng.int(4, 9);
            for (let k = 0; k < n; k++) {
                const sz = rng.range(0.15, 0.42) * S;
                block(
                    rng.range(-0.46, 0.46),
                    rng.range(-0.46, 0.46),
                    0.06,
                    sz,
                    sz * rng.range(0.3, 0.7),
                    sz * rng.range(0.7, 1.5),
                );
            }
            break;
        }
        case 'slab': {
            // Flat slab: wide, low, a little sunk; sometimes a second broken piece.
            const sw = rng.range(0.7, 1.1) * S;
            block(
                rng.range(-0.15, 0.15),
                rng.range(-0.15, 0.15),
                0.1,
                sw,
                rng.range(0.22, 0.34),
                sw * rng.range(1.1, 1.6),
            );
            if (rng() < 0.4) block(rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), 0.08, sw * 0.5, 0.2, sw * 0.6);
            break;
        }
        case 'erratic': {
            // Big erratic: a sunk core of 1.2-2 units with smaller blocks fused to
            // its flanks and top, so it spills past its column.
            const s0 = rng.range(1.2, 2.0) * S;
            block(0, 0, 0.3, s0, s0 * rng.range(0.6, 0.85), s0 * rng.range(0.9, 1.3));
            const n = rng.int(2, 4);
            for (let k = 0; k < n; k++) {
                const sz = s0 * rng.range(0.4, 0.65);
                block(
                    rng.range(-0.6, 0.6) * s0,
                    rng.range(-0.6, 0.6) * s0,
                    -rng.range(-0.25, s0 * 0.45),
                    sz,
                    sz * rng.range(0.55, 0.85),
                    sz,
                );
            }
            break;
        }
        case 'tor': {
            // Tor: a pile of flat, weathered slabs, each offset and narrower than
            // the one below — the layered granite stacks of upland moors.
            const n = rng.int(3, 5);
            let y = -0.15,
                sw = rng.range(1.1, 1.6) * S;
            for (let k = 0; k < n; k++) {
                const h = rng.range(0.3, 0.5) * S;
                block(rng.range(-0.2, 0.2), rng.range(-0.2, 0.2), -y, sw, h, sw * rng.range(0.8, 1.2));
                y += h * 0.95;
                sw *= rng.range(0.7, 0.9);
            }
            break;
        }
        case 'shards': {
            // Frost-shattered shards: a cluster of thin upright blocks of mixed height.
            const n = rng.int(3, 6);
            for (let k = 0; k < n; k++) {
                const t = rng.range(0.15, 0.3) * S;
                block(
                    rng.range(-0.4, 0.4),
                    rng.range(-0.4, 0.4),
                    0.1,
                    t,
                    rng.range(0.4, 1.1) * S,
                    t * rng.range(1.5, 3),
                );
            }
            break;
        }
        case 'standing': {
            // Standing stone: a tall, narrow block, often with a shorter shard beside it.
            const sw = rng.range(0.45, 0.75) * S;
            const h = rng.range(1.2, 2.2) * S;
            block(rng.range(-0.15, 0.15), rng.range(-0.15, 0.15), 0.2, sw, h, sw * rng.range(0.7, 1.2));
            if (rng() < 0.5)
                block(rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), 0.15, sw * 0.7, h * rng.range(0.35, 0.6), sw * 0.8);
            break;
        }
    }
    return { h: top, r: reach };
}

/** A single pebble, on the grass stream (so the grass layout is unchanged). */
export function scatterPebble(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    rise: number,
    stones: THREE.Color[],
    moss: THREE.Color,
) {
    // Pebbles: never animated — the still notes among the moving grass. One to
    // four per hit, each its own shape: round (square, low), flat and elongated,
    // or a small chip; shaded and weathered like the boulders of the zone.
    if (rng() >= PEBBLE_P * rockAt(rise)) return;
    const w = WEATHER[zoneOf(rise)];
    const n = rng() < 0.6 ? 1 : rng.int(2, 4);
    for (let k = 0; k < n; k++) {
        _stone.copy(stones[(rng() * stones.length) | 0]).multiplyScalar(rng.range(0.75, 1.15));
        if (rng() < w.moss * 0.5) _stone.lerp(moss, rng.range(0.1, 0.3));
        else if (w.pale && rng() < 0.4) _stone.lerp(WHITE, rng.range(0, w.pale));
        const r = root(centre, rng.range(-0.38, 0.38), rng.range(-0.38, 0.38)).addScaledVector(_up, -0.05);
        const sz = rng.range(0.12, 0.42) * (n > 1 ? 0.75 : 1);
        const form = rng();
        if (form < 0.45) box(buf, r, _up, sz, sz * rng.range(0.45, 0.65), _stone, 0, 0);
        else if (form < 0.8)
            boxYawed(buf, r, _up, sz, sz * rng.range(0.25, 0.4), sz * rng.range(1.4, 2.2), _stone, rng() * 6.28);
        else boxYawed(buf, r, _up, sz * 0.6, sz * rng.range(0.5, 0.9), sz * 0.8, _stone, rng() * 6.28);
    }
}
