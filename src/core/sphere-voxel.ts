// src/core/sphere-voxel.ts
import { BLOCK_BY_ID } from './palette';

export const PLANET_RADIUS = 350;
export const FACE_RES = 400;
export const SHELL_DEPTH = 96;

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

  /** Highest solid layer in the column, or -1 if empty. */
  columnTop(face: number, u: number, v: number): number {
    if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return -1;
    return this.surfaceLayer[this.colIdx(face, u, v)];
  }

  /** World-space radius of the surface (columnTop + 1 above planet centre), min PLANET_RADIUS. */
  surfaceRadius(face: number, u: number, v: number): number {
    const top = this.columnTop(face, u, v);
    return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
  }
}
