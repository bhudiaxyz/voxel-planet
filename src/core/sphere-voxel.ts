// src/core/sphere-voxel.ts
import { BLOCK_BY_ID } from './palette';

export const PLANET_RADIUS = 350;
export const FACE_RES = 400;
export const SHELL_DEPTH = 96;

// Precomputed face bases matching basisFromCode:
//   face 0 +X: n=(1,0,0), tu=(0,1,0), tv=(0,0,1)
//   face 1 -X: n=(-1,0,0), tu=(0,1,0), tv=(0,0,-1)
//   face 2 +Y: n=(0,1,0), tu=(1,0,0), tv=(0,0,-1)
//   face 3 -Y: n=(0,-1,0), tu=(1,0,0), tv=(0,0,1)
//   face 4 +Z: n=(0,0,1), tu=(0,1,0), tv=(-1,0,0)
//   face 5 -Z: n=(0,0,-1), tu=(0,1,0), tv=(1,0,0)
const _FN  = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const _FTU = [[0,1,0],[0,1,0],[1,0,0],[1,0,0],[0,1,0],[0,1,0]];
const _FTV = [[0,0,1],[0,0,-1],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];

/** Convert (face, u, v) where u or v may be out of [0, FACE_RES) to the canonical face+UV. */
function crossFaceUV(face: number, u: number, v: number): [number, number, number] {
  const n = _FN[face], tu = _FTU[face], tv = _FTV[face];
  // Column centre in cube space (unnormalised — dominant axis determines new face)
  const pu = (2 * (u + 0.5)) / FACE_RES - 1;
  const pv = (2 * (v + 0.5)) / FACE_RES - 1;
  const cx = n[0] + tu[0]*pu + tv[0]*pv;
  const cy = n[1] + tu[1]*pu + tv[1]*pv;
  const cz = n[2] + tu[2]*pu + tv[2]*pv;
  // Find dominant axis → new face
  const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
  let axis = 0;
  if (ay > ax) axis = 1;
  if (az > Math.max(ax, ay)) axis = 2;
  const comp = axis === 0 ? cx : axis === 1 ? cy : cz;
  const f2 = axis * 2 + (comp < 0 ? 1 : 0);
  // Project cube vector onto new face plane
  const n2 = _FN[f2], tu2 = _FTU[f2], tv2 = _FTV[f2];
  const dn = cx*n2[0] + cy*n2[1] + cz*n2[2];
  const du = cx*tu2[0] + cy*tu2[1] + cz*tu2[2];
  const dv = cx*tv2[0] + cy*tv2[1] + cz*tv2[2];
  const u2 = Math.max(0, Math.min(FACE_RES-1, Math.floor(((du/dn + 1) * FACE_RES) / 2)));
  const v2 = Math.max(0, Math.min(FACE_RES-1, Math.floor(((dv/dn + 1) * FACE_RES) / 2)));
  return [f2, u2, v2];
}

export class SphereVoxelGrid {
  readonly data: Uint8Array;
  // highest solid layer per column, -1 if empty
  readonly surfaceLayer: Int16Array;

  constructor() {
    // ponytail: 92 MB for the voxel data; acceptable on desktop
    this.data = new Uint8Array(6 * FACE_RES * FACE_RES * SHELL_DEPTH);
    this.surfaceLayer = new Int16Array(6 * FACE_RES * FACE_RES).fill(-1);
  }

  private idx(face: number, u: number, v: number, layer: number): number {
    return ((face * FACE_RES + v) * FACE_RES + u) * SHELL_DEPTH + layer;
  }

  private colIdx(face: number, u: number, v: number): number {
    return (face * FACE_RES + v) * FACE_RES + u;
  }

  get(face: number, u: number, v: number, layer: number): number {
    if (
      face < 0 || face >= 6 ||
      u < 0 || u >= FACE_RES ||
      v < 0 || v >= FACE_RES ||
      layer < 0 || layer >= SHELL_DEPTH
    ) return 0;
    return this.data[this.idx(face, u, v, layer)];
  }

  set(face: number, u: number, v: number, layer: number, id: number): void {
    if (
      face < 0 || face >= 6 ||
      u < 0 || u >= FACE_RES ||
      v < 0 || v >= FACE_RES ||
      layer < 0 || layer >= SHELL_DEPTH
    ) return;
    this.data[this.idx(face, u, v, layer)] = id;
    const col = this.colIdx(face, u, v);
    if (id !== 0) {
      if (layer > this.surfaceLayer[col]) this.surfaceLayer[col] = layer;
    } else if (this.surfaceLayer[col] === layer) {
      let l = layer - 1;
      while (l >= 0 && this.data[this.idx(face, u, v, l)] === 0) l--;
      this.surfaceLayer[col] = l;
    }
  }

  isSolid(face: number, u: number, v: number, layer: number): boolean {
    const id = this.get(face, u, v, layer);
    return id !== 0 && !(BLOCK_BY_ID[id] as any)?.isWater;
  }

  /** Like isSolid but crosses face boundaries when u/v are out of [0, FACE_RES). */
  isSolidGlobal(face: number, u: number, v: number, layer: number): boolean {
    if (u >= 0 && u < FACE_RES && v >= 0 && v < FACE_RES)
      return this.isSolid(face, u, v, layer);
    const [f2, u2, v2] = crossFaceUV(face, u, v);
    return this.isSolid(f2, u2, v2, layer);
  }

  /** Highest solid layer in the column, or -1 if empty. */
  columnTop(face: number, u: number, v: number): number {
    if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return -1;
    return this.surfaceLayer[this.colIdx(face, u, v)];
  }

  /** Highest walkable (non-foliage) layer — ignores TRUNK, LEAF, and air. */
  groundColumnTop(face: number, u: number, v: number): number {
    if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return -1;
    let l = this.surfaceLayer[this.colIdx(face, u, v)];
    while (l >= 0) {
      const id = this.data[this.idx(face, u, v, l)];
      if (id === 0) { l--; continue; }
      const b = (BLOCK_BY_ID[id] as any);
      if (!b?.sway && !b?.isTrunk) break;
      l--;
    }
    return l;
  }

  /** World-space radius of the surface (columnTop + 1 above planet centre), min PLANET_RADIUS. */
  surfaceRadius(face: number, u: number, v: number): number {
    const top = this.groundColumnTop(face, u, v);
    return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
  }
}
