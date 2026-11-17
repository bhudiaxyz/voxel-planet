/**
 * Rocks: boulders, scree, slabs, standing stones and pebbles, drawn into the
 * vegetation patch meshes (see vegetation.ts) but authored here. Density rises
 * with altitude (rockAt); the large shapes only appear up high.
 */
import * as THREE from 'three';
import { BLOCKS } from '../core/palette';
import { makeRng } from '../core/rng';
import { QuadBuffer, _up, box, boxYawed, root } from './veg-geom';

type Rng = ReturnType<typeof makeRng>;

const BOULDER_P = 0.0045; // per grass column; ×3 on bare stone
const PEBBLE_P = 0.008;
/**
 * Boulder/pebble multiplier by layers above sea: ~0.35 on the coast, 1 at midland,
 * then a steeper climb above the highland line (rise 12): ~3 at the treeline, 5 on the peaks.
 */
export const rockAt = (rise: number) => Math.min(5, Math.max(0.35, 0.1 + rise * 0.11 + Math.max(0, rise - 12) * 0.3));
/** rockK above this unlocks the large shapes (big boulders, standing stones). */
export const HIGH_ROCK = 1.5;

export const STONE_IDS = new Set([BLOCKS.STONE.id, BLOCKS.STONE_PALE.id, BLOCKS.STONE_WARM.id]);
const _stone = new THREE.Color();

/** One roll per column on the ground-detail stream; draws a boulder group on a hit. */
export function scatterBoulder(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    detail: number,
    onStone: boolean,
    rockK: number,
    stones: THREE.Color[],
    moss: THREE.Color,
) {
    // Boulders: rarer on the lowlands, common on the high slopes (rockK). Three
    // shapes: a stacked boulder, a scatter of loose stones, a flat slab.
    if (rng() < BOULDER_P * detail * rockK * (onStone ? 3 : 1)) {
        // Stone colour per block: one of the theme's three stones, lightened or
        // darkened (weathered vs fresh-split), sometimes greened by moss. Built
        // from the palette, so every theme keeps its own rock.
        const col = () => {
            _stone.copy(stones[(rng() * stones.length) | 0]).multiplyScalar(rng.range(0.7, 1.12));
            if (rng() < 0.18) _stone.lerp(moss, rng.range(0.15, 0.35));
            return _stone;
        };
        // Up high, a share of rolls become the large shapes; the rest keep the mix below.
        const big = rockK > HIGH_ROCK && rng() < 0.35;
        const kind = big ? 2 + rng() : rng();
        if (kind >= 2.6) {
            // Standing stone: a tall, narrow, slightly leaning block, frost-split off a crag.
            const w = rng.range(0.45, 0.75);
            const h = rng.range(1.2, 2.2);
            const r = root(centre, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)).addScaledVector(_up, -0.2);
            boxYawed(buf, r, _up, w, h, w * rng.range(0.7, 1.2), col(), rng() * 6.28);
            // A shorter shard leaning on it now and then.
            if (rng() < 0.5) {
                const r2 = root(centre, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)).addScaledVector(_up, -0.15);
                boxYawed(buf, r2, _up, w * 0.7, h * rng.range(0.35, 0.6), w * 0.8, col(), rng() * 6.28);
            }
        } else if (kind >= 2) {
            // Big boulder: a sunk core of 1.2-2 units with smaller blocks fused to
            // its flanks and top, so it spills past its column like a real erratic.
            const s0 = rng.range(1.2, 2.0);
            boxYawed(
                buf,
                root(centre, 0, 0).addScaledVector(_up, -0.3),
                _up,
                s0,
                s0 * rng.range(0.6, 0.85),
                s0 * rng.range(0.9, 1.3),
                col(),
                rng() * 6.28,
            );
            const n = rng.int(2, 4);
            for (let k = 0; k < n; k++) {
                const sz = s0 * rng.range(0.4, 0.65);
                const r = root(centre, rng.range(-0.6, 0.6) * s0, rng.range(-0.6, 0.6) * s0).addScaledVector(
                    _up,
                    rng.range(-0.25, s0 * 0.45),
                );
                boxYawed(buf, r, _up, sz, sz * rng.range(0.55, 0.85), sz, col(), rng() * 6.28);
            }
        } else if (kind < 0.5) {
            // Two or three stacked, rotated blocks, half sunk into the ground.
            const n = rng.int(1, 3);
            const s0 = rng.range(0.55, 0.95) * (0.8 + rockK * 0.2); // bigger up high
            for (let k = 0; k < n; k++) {
                const sz = s0 * (1 - k * 0.3);
                const r = root(centre, rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)).addScaledVector(
                    _up,
                    -0.15 + k * s0 * 0.45,
                );
                boxYawed(buf, r, _up, sz, sz * rng.range(0.55, 0.8), sz, col(), rng() * 6.28);
            }
        } else if (kind < 0.8) {
            // Loose scree: several small stones spread over the column.
            const n = rng.int(3, 6);
            for (let k = 0; k < n; k++) {
                const sz = rng.range(0.2, 0.45);
                const r = root(centre, rng.range(-0.42, 0.42), rng.range(-0.42, 0.42)).addScaledVector(_up, -0.06);
                boxYawed(buf, r, _up, sz, sz * rng.range(0.4, 0.7), sz * rng.range(0.8, 1.3), col(), rng() * 6.28);
            }
        } else {
            // Flat slab: wide, low, a little tilted into the ground.
            const w = rng.range(0.7, 1.1);
            const r = root(centre, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)).addScaledVector(_up, -0.1);
            boxYawed(buf, r, _up, w, rng.range(0.22, 0.34), w * rng.range(1.1, 1.6), col(), rng() * 6.28);
        }
    }
}

/** A single pebble, on the grass stream (so the grass layout is unchanged). */
export function scatterPebble(buf: QuadBuffer, centre: THREE.Vector3, rng: Rng, rockK: number, stones: THREE.Color[]) {
    // Pebbles: never animated — the still notes among the moving grass.
    if (rng() < PEBBLE_P * rockK) {
        const r = root(centre, rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)).addScaledVector(_up, -0.05);
        box(buf, r, _up, rng.range(0.24, 0.42), rng.range(0.12, 0.24), stones[(rng() * stones.length) | 0], 0, 0);
    }
}
