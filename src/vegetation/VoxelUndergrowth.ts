import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BlockAtlas, BlockType } from "../planet/BlockAtlas";
import { SeededRandom } from "../utils/Random";
import { makeBox } from "./VoxelBlocks";

export type UndergrowthType = "shrub" | "fern" | "flower" | "mushroom" | "moss" | "rock-small" | "rock-large" | "ice-spike" | "floating-island";

export interface VoxelUndergrowthTemplate {
  geometry: THREE.BufferGeometry;
  type: UndergrowthType;
}


export function buildUndergrowth(
  type: UndergrowthType,
  variant: number,
  atlas: BlockAtlas,
  seed: number,
): VoxelUndergrowthTemplate {
  const rng = new SeededRandom(seed ^ (variant * 0x6b4c3d2e));
  const geos: THREE.BufferGeometry[] = [];

  switch (type) {
    case "shrub": {
      // 2-3 leaf blocks stacked slightly irregularly, 1×1×2 footprint
      const height = 2 + Math.floor(rng.next() * 2);
      for (let y = 0; y < height; y++) {
        const dx = Math.floor(rng.next() * 3) - 1;
        const dz = Math.floor(rng.next() * 3) - 1;
        geos.push(makeBox(dx, y, dz, atlas, BlockType.Leaf));
        // Add neighboring block occasionally for bushiness
        if (rng.next() < 0.55) {
          geos.push(
            makeBox(
              dx + (rng.next() < 0.5 ? 1 : -1),
              y,
              dz,
              atlas,
              BlockType.Leaf,
            ),
          );
        }
      }
      break;
    }

    case "fern": {
      // Flat spread of 3-5 leaf blocks at ground level
      const count = 3 + Math.floor(rng.next() * 3);
      const placed = new Set<string>();
      let px = 0,
        pz = 0;
      placed.add("0,0");
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Leaf));
      for (let i = 1; i < count; i++) {
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        const dir = dirs[Math.floor(rng.next() * 4)];
        px += dir[0];
        pz += dir[1];
        px = Math.max(-2, Math.min(2, px));
        pz = Math.max(-2, Math.min(2, pz));
        const key = `${px},${pz}`;
        if (!placed.has(key)) {
          placed.add(key);
          geos.push(makeBox(px, 0, pz, atlas, BlockType.Leaf));
        }
      }
      break;
    }

    case "flower": {
      // 1 stem block + 1 top leaf block (slight color variation via atlas)
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Leaf)); // stem
      geos.push(makeBox(0, 1, 0, atlas, BlockType.Grass)); // flower top using grass tile for variety
      break;
    }

    case "mushroom": {
      // Stem (log/bark) + cap using dedicated Mushroom tile
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Log));
      const capW = 1 + Math.floor(rng.next() * 2);
      for (let dx = -capW; dx <= capW; dx++) {
        for (let dz = -capW; dz <= capW; dz++) {
          if (Math.abs(dx) + Math.abs(dz) <= capW + 1)
            geos.push(makeBox(dx, 1, dz, atlas, BlockType.Mushroom));
        }
      }
      break;
    }

    case "moss": {
      // Flat irregular patch using dedicated Moss tile
      const count = 4 + Math.floor(rng.next() * 5);
      const placed = new Set<string>();
      placed.add("0,0");
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Moss));
      let px = 0, pz = 0;
      for (let i = 1; i < count; i++) {
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        const dir = dirs[Math.floor(rng.next() * 4)];
        px = Math.max(-2, Math.min(2, px + dir[0]));
        pz = Math.max(-2, Math.min(2, pz + dir[1]));
        const key = `${px},${pz}`;
        if (!placed.has(key)) { placed.add(key); geos.push(makeBox(px, 0, pz, atlas, BlockType.Moss)); }
      }
      break;
    }

    case "rock-small": {
      // 1-3 Stone blocks clustered, max height 1
      const count = 1 + Math.floor(rng.next() * 3);
      const placed = new Set<string>();
      placed.add("0,0");
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Stone));
      for (let i = 1; i < count; i++) {
        const dx = Math.floor(rng.next() * 3) - 1;
        const dz = Math.floor(rng.next() * 3) - 1;
        const key = `${dx},${dz}`;
        if (!placed.has(key)) { placed.add(key); geos.push(makeBox(dx, 0, dz, atlas, BlockType.Stone)); }
      }
      break;
    }

    case "rock-large": {
      // 3-6 Stone blocks, up to 2 high — irregular boulder shape
      const baseW = 1 + Math.floor(rng.next() * 2);
      for (let dx = -baseW; dx <= baseW; dx++) {
        for (let dz = -baseW; dz <= baseW; dz++) {
          if (Math.abs(dx) + Math.abs(dz) <= baseW + 1) {
            geos.push(makeBox(dx, 0, dz, atlas, BlockType.Stone));
            if (Math.abs(dx) + Math.abs(dz) <= baseW && rng.next() < 0.6)
              geos.push(makeBox(dx, 1, dz, atlas, BlockType.Stone));
          }
        }
      }
      break;
    }

    case "ice-spike": {
      // Narrow Snow column, 2-4 blocks tall, tapering at top
      const height = 2 + Math.floor(rng.next() * 3);
      geos.push(makeBox(0, 0, 0, atlas, BlockType.Snow));
      geos.push(makeBox(0, 1, 0, atlas, BlockType.Snow));
      for (let y = 2; y < height; y++) {
        if (rng.next() < 0.7) geos.push(makeBox(0, y, 0, atlas, BlockType.Snow));
      }
      break;
    }

    case "floating-island": {
      // Avatar-style floating rock slab: stone base, dirt mid, grass cap, stalactites below.
      // Y=0 is the BOTTOM of the island; caller elevates the whole thing above terrain.
      const radius = 1 + Math.floor(rng.next() * 2); // 1 or 2 blocks half-width
      // Stone body (Y 0..1)
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const d = Math.abs(dx) + Math.abs(dz);
          if (d > radius * 2) continue;
          geos.push(makeBox(dx, 0, dz, atlas, BlockType.Stone));
          if (d <= radius * 2 - 1) geos.push(makeBox(dx, 1, dz, atlas, BlockType.Stone));
          // Grass cap
          if (d <= radius * 2 - 1) geos.push(makeBox(dx, 2, dz, atlas, BlockType.Grass));
          // Stalactites hanging below Y=0
          if (d === 0 || (d <= 1 && rng.next() < 0.7)) {
            const stalH = 1 + Math.floor(rng.next() * 3);
            for (let sy = 1; sy <= stalH; sy++) {
              geos.push(makeBox(dx, -sy, dz, atlas, BlockType.Stone));
            }
          }
        }
      }
      break;
    }
  }

  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return { geometry: merged, type };
}
