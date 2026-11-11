/**
 * Distance-to-land map for the sphere sea, baked once at startup.
 *
 * For every column on every cube face: 0 on land, else how many columns away
 * the nearest land column is (8-way chamfer distance), capped at MAX. Packed
 * into one R8 texture as a 3×2 atlas of the six faces, so the water shader can
 * draw foam where the shore is near without reading scene depth (which would
 * be a feedback loop — the depth pass renders the water too).
 *
 * Distances don't cross cube seams; a foam band can stop short at a seam,
 * which is invisible under the haze at that range.
 */
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/sphere-voxel';

const MAX = 8; // columns; foam lives within the first few

export function bakeShoreMap(grid: SphereVoxelGrid, seaLayer: number): THREE.DataTexture {
    const W = FACE_RES * 3,
        H = FACE_RES * 2;
    const data = new Uint8Array(W * H);
    const d = new Float32Array(FACE_RES * FACE_RES);
    const D1 = 1,
        D2 = Math.SQRT2;
    for (let face = 0; face < 6; face++) {
        // Init: land 0, sea "far".
        for (let v = 0; v < FACE_RES; v++)
            for (let u = 0; u < FACE_RES; u++) d[v * FACE_RES + u] = grid.columnTop(face, u, v) > seaLayer ? 0 : MAX;
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
