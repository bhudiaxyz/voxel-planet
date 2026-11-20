/**
 * Distance maps — per-column "how far is it to ..." fields, baked once after generation.
 *
 * Purpose
 *   Two answers that several systems need and that would be costly to re-derive from the voxel
 *   grid each time. Both are one value per column of the six cube faces, computed after the
 *   terrain is final (rivers carved, landmarks placed), and never change afterwards.
 *     wet   — distance to the nearest water, sea or fresh (CPU array): waterside plants,
 *             bank-loving trees, firefly habitat.
 *     shore — distance from sea to the nearest land (GPU texture + GLSL): the sea's depth
 *             colour, shallow caustics and the foam line.
 *
 * Operations
 *   Wet map (bakeWetMap):
 *   - Seeds every column whose top is at or below sea level, or whose top block is isWater
 *     (river/lake), with 0, then runs a unit-weight 4-way BFS per face out to WET_MAX columns
 *     (each cell queued at most once). One Uint8 per column, 6*FACE_RES^2 (960 KB). Index with
 *     wetIdx(face, u, v).
 *   Shore map (bakeShoreMap, SHORE_GLSL):
 *   - 0 on land, else the distance in columns to the nearest land column (two-pass 8-way
 *     chamfer, D1 = 1, D2 = sqrt 2), capped at MAX (8), stored as 0..255. Land is
 *     columnTop > seaLayer.
 *   - Specks first: each 4-connected land body smaller than MIN_ISLAND columns is sunk back to
 *     sea, because lone sea-floor columns poking one layer up each grew a foam ring that read
 *     as random cream circles. The whole body is always flood-filled before the size test.
 *   - Packed into one R8 DataTexture as a 3x2 atlas of the six faces, linear-filtered so column
 *     steps become a soft gradient. SHORE_GLSL's shoreDist(dir) picks the face from the
 *     direction, projects to face UV (mirroring geoutil.dirToFaceUV and the face bases) and
 *     samples the atlas: 0 (land) .. 1 (far out). The shader reads this instead of scene depth,
 *     which would be a feedback loop (the depth pass renders the water too).
 *   Both: distances don't cross cube seams. A bank at a seam reads up to WET_MAX columns
 *   "drier" on the far side, and a foam band can stop short at a seam; neither is visible.
 *
 * Usage
 *   terrain.ts bakes a wet map before the tree scatter (willows/mangroves keep to banks);
 *   world.ts bakes the final one after landmarks, passes it to createSphereVegetation (reed
 *   clumps at distance 1) and returns it as world.wet; main.ts reads it (wetIdx, WET_MAX) for the
 *   fireflies' habitat. world.ts bakes the shore map (skipped on tier 'very-low') and hands the
 *   texture to createSphereWater; water.ts splices SHORE_GLSL into its fragment shader.
 *     const wet = bakeWetMap(grid, SEA_LAYER);      const shore = bakeShoreMap(grid, SEA_LAYER);
 *   Bake after generation: the grid must not change afterwards.
 *
 * See also: rivers.ts, terrain.ts, vegetation.ts, water.ts, world.ts, core/geoutil.ts;
 * DESIGN.md "7. Vegetation" and "8. Water" (shore-distance atlas).
 */
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/voxel';
import { BLOCK_BY_ID } from '../core/blocks';

/* ==================================================================== *
 * Wet map: distance to water
 * ==================================================================== */

export const WET_MAX = 4;

/** Column index into the wet map. */
export const wetIdx = (face: number, u: number, v: number) => (face * FACE_RES + v) * FACE_RES + u;

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

/* ==================================================================== *
 * Shore map: distance from sea to land (for the water shader)
 * ==================================================================== */

const MAX = 8; // columns; foam lives within the first few
/**
 * Islets this small don't count as shore. Hundreds of lone sea-floor columns
 * poke one layer above the sea; each one ringed itself with foam, which read
 * as random cream circles on open water.
 */
const MIN_ISLAND = 6;

/**
 * GLSL: direction → atlas UV, mirroring geoutil.dirToFaceUV and the face
 * bases in sphere-voxel.ts. Returns the shore distance 0..1 (0 = land).
 */
export const SHORE_GLSL = /* glsl */ `
  uniform sampler2D uShoreMap;
  float shoreDist(vec3 d) {
    vec3 a = abs(d);
    int axis = 0;
    if (a.y > a.x) axis = 1;
    if (a.z > max(a.x, a.y)) axis = 2;
    float comp = axis == 0 ? d.x : axis == 1 ? d.y : d.z;
    int face = axis * 2 + (comp < 0.0 ? 1 : 0);
    vec3 n, tu, tv;
    if (face == 0)      { n = vec3( 1,0,0); tu = vec3(0,1,0); tv = vec3(0,0, 1); }
    else if (face == 1) { n = vec3(-1,0,0); tu = vec3(0,1,0); tv = vec3(0,0,-1); }
    else if (face == 2) { n = vec3(0, 1,0); tu = vec3(1,0,0); tv = vec3(0,0,-1); }
    else if (face == 3) { n = vec3(0,-1,0); tu = vec3(1,0,0); tv = vec3(0,0, 1); }
    else if (face == 4) { n = vec3(0,0, 1); tu = vec3(0,1,0); tv = vec3(-1,0,0); }
    else                { n = vec3(0,0,-1); tu = vec3(0,1,0); tv = vec3( 1,0,0); }
    float dn = dot(d, n);
    vec2 uv = vec2(dot(d, tu), dot(d, tv)) / dn * 0.5 + 0.5;          // 0..1 on the face
    uv = clamp(uv, 0.5 / ${FACE_RES}.0, 1.0 - 0.5 / ${FACE_RES}.0);   // stay inside this face's tile
    vec2 tile = vec2(float(face - (face / 3) * 3), float(face / 3));
    return texture2D(uShoreMap, (tile + uv) / vec2(3.0, 2.0)).r;
  }
`;

export function bakeShoreMap(grid: SphereVoxelGrid, seaLayer: number): THREE.DataTexture {
    const W = FACE_RES * 3,
        H = FACE_RES * 2;
    const data = new Uint8Array(W * H);
    const d = new Float32Array(FACE_RES * FACE_RES);
    const D1 = 1,
        D2 = Math.SQRT2;
    const stack: number[] = [];
    for (let face = 0; face < 6; face++) {
        // Init: land 0, sea "far".
        for (let v = 0; v < FACE_RES; v++)
            for (let u = 0; u < FACE_RES; u++) d[v * FACE_RES + u] = grid.columnTop(face, u, v) > seaLayer ? 0 : MAX;
        // Sink specks back into the sea: flood-fill each land body, drop the tiny ones.
        // (Per face, like the distances; a speck straddling a seam is rare and harmless.)
        const mark = new Uint8Array(FACE_RES * FACE_RES);
        for (let s = 0; s < d.length; s++) {
            if (d[s] !== 0 || mark[s]) continue;
            const body: number[] = [s];
            mark[s] = 1;
            stack.length = 0;
            stack.push(s);
            // Always fill the whole body: an early stop leaves its remainder to be
            // re-scanned later as a falsely 'small' fragment and sunk.
            while (stack.length) {
                const j = stack.pop()!;
                const a = j % FACE_RES,
                    b = (j / FACE_RES) | 0;
                for (const k of [
                    a > 0 ? j - 1 : -1,
                    a < FACE_RES - 1 ? j + 1 : -1,
                    b > 0 ? j - FACE_RES : -1,
                    b < FACE_RES - 1 ? j + FACE_RES : -1,
                ]) {
                    if (k < 0 || mark[k] || d[k] !== 0) continue;
                    mark[k] = 1;
                    body.push(k);
                    stack.push(k);
                }
            }
            if (body.length < MIN_ISLAND) for (const j of body) d[j] = MAX;
        }
        // Forward pass
        for (let v = 0; v < FACE_RES; v++)
            for (let u = 0; u < FACE_RES; u++) {
                const i = v * FACE_RES + u;
                let m = d[i];
                if (m === 0) continue;
                if (u > 0) m = Math.min(m, d[i - 1] + D1);
                if (v > 0) {
                    m = Math.min(m, d[i - FACE_RES] + D1);
                    if (u > 0) m = Math.min(m, d[i - FACE_RES - 1] + D2);
                    if (u < FACE_RES - 1) m = Math.min(m, d[i - FACE_RES + 1] + D2);
                }
                d[i] = m;
            }
        // Backward pass
        for (let v = FACE_RES - 1; v >= 0; v--)
            for (let u = FACE_RES - 1; u >= 0; u--) {
                const i = v * FACE_RES + u;
                let m = d[i];
                if (m === 0) continue;
                if (u < FACE_RES - 1) m = Math.min(m, d[i + 1] + D1);
                if (v < FACE_RES - 1) {
                    m = Math.min(m, d[i + FACE_RES] + D1);
                    if (u < FACE_RES - 1) m = Math.min(m, d[i + FACE_RES + 1] + D2);
                    if (u > 0) m = Math.min(m, d[i + FACE_RES - 1] + D2);
                }
                d[i] = m;
            }
        const ox = (face % 3) * FACE_RES,
            oy = Math.floor(face / 3) * FACE_RES;
        for (let v = 0; v < FACE_RES; v++)
            for (let u = 0; u < FACE_RES; u++)
                data[(oy + v) * W + ox + u] = Math.round((Math.min(d[v * FACE_RES + u], MAX) / MAX) * 255);
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    // Linear filtering smooths the column steps into a soft shoreline gradient.
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}
