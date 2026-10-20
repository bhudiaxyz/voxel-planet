import { PLAYER } from '../config';
import { VOXEL_HEIGHT } from '../planet/VoxelChunk';

/** Voxel-quantised terrain top height above planet surface for noise height h. */
export function terrainFloorVt(h: number): number {
  return (Math.floor(Math.max(h, 0) / VOXEL_HEIGHT) + 1) * VOXEL_HEIGHT;
}

/** World-space eye radius when standing on terrain noise height h. */
export function eyeRadius(h: number, planetRadius: number): number {
  return planetRadius + terrainFloorVt(h) + PLAYER.eyeHeight;
}

/** LOD level (1 = full detail, 3 = coarsest) for a chunk at distance dist. */
export function lodForDist(dist: number, chunkSize: number, detailR: number, midR: number): number {
  return dist < chunkSize * detailR ? 1 : dist < chunkSize * midR ? 2 : 3;
}
