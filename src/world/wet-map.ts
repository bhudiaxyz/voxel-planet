/**
 * Distance to the nearest water (sea or fresh), per column, in columns, capped
 * at WET_MAX. Baked once after generation, CPU-side.
 *
 * Shared by everything that wants to know "is this near water": the mesher's
 * wet-ground darkening, reed clumps and lily pads in the vegetation layer, and
 * the fireflies' habitat score. One Uint8 per column (960 KB).
 *
 * 4-way BFS per face; distances don't cross cube seams (a bank at a seam reads
 * as up to WET_MAX columns "drier" on the far side, which nobody can see).
 */
import { SphereVoxelGrid, FACE_RES } from '../core/voxel';
import { BLOCK_BY_ID } from '../core/palette';

export const WET_MAX = 4;

export function bakeWetMap(grid: SphereVoxelGrid, seaLayer: number): Uint8Array {
    const N = FACE_RES;
    const out = new Uint8Array(6 * N * N).fill(WET_MAX);
    const queue = new Int32Array(N * N);
    for (let f = 0; f < 6; f++) {
        const base = f * N * N;
        let head = 0,
            tail = 0;
        for (let v = 0; v < N; v++)
            for (let u = 0; u < N; u++) {
                const top = grid.columnTop(f, u, v);
                const water = top <= seaLayer || !!(BLOCK_BY_ID[grid.get(f, u, v, top)] as any)?.isWater;
                if (!water) continue;
                const i = v * N + u;
                out[base + i] = 0;
                queue[tail++] = i;
            }
        while (head < tail) {
            const i = queue[head++];
            const d = out[base + i] + 1;
            if (d >= WET_MAX) continue;
            const u = i % N,
                v = (i / N) | 0;
            // Unit-weight BFS: a cell's first assignment is final, so each cell is
            // queued at most once and the N² queue cannot overflow.
            const visit = (j: number) => {
                if (out[base + j] > d) {
                    out[base + j] = d;
                    queue[tail++] = j;
                }
            };
            if (u > 0) visit(i - 1);
            if (u < N - 1) visit(i + 1);
            if (v > 0) visit(i - N);
            if (v < N - 1) visit(i + N);
        }
    }
    return out;
}

/** Column index into the wet map. */
export const wetIdx = (face: number, u: number, v: number) => (face * FACE_RES + v) * FACE_RES + u;
