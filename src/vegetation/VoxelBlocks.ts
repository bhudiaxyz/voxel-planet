import * as THREE from "three";
import { BlockAtlas, BlockType } from "../planet/BlockAtlas";

/** Side length of a voxel prop block (1 m — matches VOXEL_HEIGHT). */
export const BLOCK_SIZE = 1;

const TILE_SIZE = 16 / 512; // 1 atlas tile in UV space

/**
 * Create a BLOCK_SIZE cube at voxel grid position (x, y, z) with atlas UVs.
 * Top face uses faceIndex 0, bottom uses 2, sides use 1.
 */
export function makeBox(
  x: number,
  y: number,
  z: number,
  atlas: BlockAtlas,
  block: BlockType,
): THREE.BufferGeometry {
  const B = BLOCK_SIZE;
  const geo = new THREE.BoxGeometry(B, B, B);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let face = 0; face < 6; face++) {
    const isTop = face === 2;
    const isBottom = face === 3;
    const faceIndex = isTop ? 0 : isBottom ? 2 : 1;
    const { u, v } = atlas.getTileUV(block, faceIndex);
    const base = face * 4 * 2;
    const t = TILE_SIZE;
    uv.setXY(base + 0, u, v + t);
    uv.setXY(base + 1, u + t, v + t);
    uv.setXY(base + 2, u, v);
    uv.setXY(base + 3, u + t, v);
  }
  uv.needsUpdate = true;
  geo.translate(x * B + B / 2, y * B + B / 2, z * B + B / 2);
  return geo;
}
