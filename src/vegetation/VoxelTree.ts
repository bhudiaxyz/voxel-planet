import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BlockAtlas, BlockType } from "../planet/BlockAtlas";
import { SeededRandom } from "../utils/Random";
import { makeBox } from "./VoxelBlocks";

export type TreeSpecies =
  | "spruce"
  | "pine"
  | "oak"
  | "beech"
  | "birch"
  | "snag"
  | "karst"
  | "cherry"
  | "willow"     // lowland moist: drooping branches, wide oval crown
  | "palm"       // beach/desert: bare trunk, fan crown at top
  | "fir"        // mid-altitude conifer: dense layered cone, wider than spruce
  | "krummholz"; // near-treeline: short wind-bent prostrate form

export const TREE_SPECIES: TreeSpecies[] = [
  "spruce",
  "pine",
  "oak",
  "beech",
  "birch",
  "snag",
  "karst",
  "cherry",
  "willow",
  "palm",
  "fir",
  "krummholz",
];

export interface VoxelTreeTemplate {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  species: TreeSpecies;
  trunkRadius: number;
  height: number;
}


/** Stacked square crown layers for conical trees (spruce, pine). */
function buildConeCrown(
  geos: THREE.BufferGeometry[],
  rng: SeededRandom,
  atlas: BlockAtlas,
  trunkHeight: number,
  layers: number,
): void {
  for (let l = 0; l < layers; l++) {
    const y = trunkHeight - 1 + l;
    const half = layers - l; // decreases toward tip
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) {
        // Rounded cone: skip far corners
        if (Math.abs(dx) + Math.abs(dz) > half + 1) continue;
        if (rng.next() < 0.08) continue; // slight randomness
        geos.push(makeBox(dx, y, dz, atlas, BlockType.Leaf));
      }
    }
  }
  // tip
  geos.push(makeBox(0, trunkHeight - 1 + layers, 0, atlas, BlockType.Leaf));
}

/** Roughly spherical crown. */
function buildSphereCrown(
  geos: THREE.BufferGeometry[],
  rng: SeededRandom,
  atlas: BlockAtlas,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): void {
  const r = radius;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const dist = Math.sqrt(dx * dx + dy * dy * 0.8 + dz * dz);
        if (dist > r + 0.5) continue;
        if (dist > r - 0.5 && rng.next() < 0.35) continue; // feathered edge
        geos.push(makeBox(cx + dx, cy + dy, cz + dz, atlas, BlockType.Leaf));
      }
    }
  }
}

/** Trunk column. Returns array of geometries. */
function buildTrunk(
  geos: THREE.BufferGeometry[],
  atlas: BlockAtlas,
  height: number,
  width: number,
  xOff = 0,
  zOff = 0,
): void {
  for (let y = 0; y < height; y++) {
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < width; dz++) {
        geos.push(makeBox(xOff + dx, y, zOff + dz, atlas, BlockType.Log));
      }
    }
  }
}

export function buildVoxelTree(
  species: TreeSpecies,
  variant: number,
  atlas: BlockAtlas,
  seed: number,
): VoxelTreeTemplate {
  const rng = new SeededRandom(seed ^ (variant * 0x9e3779b9));
  const geos: THREE.BufferGeometry[] = [];

  let trunkRadius = 0.5;
  let height = 0;

  switch (species) {
    case "spruce":
    case "pine": {
      const trunkH = 7 + Math.floor(rng.next() * 4); // 7-10
      buildTrunk(geos, atlas, trunkH, 1);
      const layers = 4 + Math.floor(rng.next() * 3); // 4-6 crown layers
      buildConeCrown(geos, rng, atlas, trunkH, layers);
      height = trunkH + layers;
      trunkRadius = 0.5;
      break;
    }

    case "oak":
    case "beech": {
      const trunkH = 5 + Math.floor(rng.next() * 4); // 5-8
      buildTrunk(geos, atlas, trunkH, 2, -1, -1); // 2×2 trunk centered
      const crownR = 2 + Math.floor(rng.next() * 2); // 2-3
      buildSphereCrown(geos, rng, atlas, 0, trunkH + crownR - 1, 0, crownR);
      height = trunkH + crownR * 2;
      trunkRadius = 1.0;
      break;
    }

    case "birch": {
      const trunkH = 8 + Math.floor(rng.next() * 5); // 8-12
      buildTrunk(geos, atlas, trunkH, 1);
      // Oval crown: elongated vertically
      const crownR = 2;
      for (let dx = -crownR; dx <= crownR; dx++) {
        for (let dy = 0; dy <= crownR * 2; dy++) {
          for (let dz = -crownR; dz <= crownR; dz++) {
            const d = Math.sqrt(
              dx * dx + (dy - crownR) * (dy - crownR) * 0.5 + dz * dz,
            );
            if (d > crownR + 0.4) continue;
            if (d > crownR - 0.4 && rng.next() < 0.4) continue;
            geos.push(makeBox(dx, trunkH + dy, dz, atlas, BlockType.Leaf));
          }
        }
      }
      height = trunkH + crownR * 2 + 1;
      trunkRadius = 0.5;
      break;
    }

    case "snag": {
      const trunkH = 6 + Math.floor(rng.next() * 4); // 6-9
      buildTrunk(geos, atlas, trunkH, 1);
      // Broken branches: short horizontal log stubs
      const numBranches = 2 + Math.floor(rng.next() * 3);
      for (let b = 0; b < numBranches; b++) {
        const by = 2 + Math.floor(rng.next() * (trunkH - 3));
        const bdir = Math.floor(rng.next() * 4);
        const blen = 1 + Math.floor(rng.next() * 3);
        for (let bl = 1; bl <= blen; bl++) {
          const [bx, bz] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ][bdir];
          geos.push(makeBox(bx * bl, by, bz * bl, atlas, BlockType.Log));
        }
      }
      height = trunkH;
      trunkRadius = 0.5;
      break;
    }

    case "karst": {
      // Twisted trunk: 1×1 with random XZ offsets at each level
      let ox = 0,
        oz = 0;
      const trunkH = 6 + Math.floor(rng.next() * 4);
      for (let y = 0; y < trunkH; y++) {
        geos.push(makeBox(ox, y, oz, atlas, BlockType.Log));
        if (y % 3 === 2) {
          ox += Math.floor(rng.next() * 3) - 1;
          oz += Math.floor(rng.next() * 3) - 1;
          ox = Math.max(-2, Math.min(2, ox));
          oz = Math.max(-2, Math.min(2, oz));
        }
      }
      // Minimal leaves at top
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (rng.next() < 0.5) continue;
          geos.push(makeBox(ox + dx, trunkH, oz + dz, atlas, BlockType.Leaf));
        }
      }
      height = trunkH + 1;
      trunkRadius = 0.5;
      break;
    }

    case "cherry": {
      const trunkH = 4 + Math.floor(rng.next() * 3); // 4-6
      buildTrunk(geos, atlas, trunkH, 1);
      // Wide spreading crown (flat-ish)
      const crownR = 3;
      for (let dx = -crownR; dx <= crownR; dx++) {
        for (let dy = 0; dy <= 2; dy++) {
          for (let dz = -crownR; dz <= crownR; dz++) {
            const d = Math.sqrt(dx * dx + dz * dz) + dy * 1.5;
            if (d > crownR + 0.5) continue;
            if (d > crownR - 0.5 && rng.next() < 0.5) continue;
            geos.push(makeBox(dx, trunkH + dy, dz, atlas, BlockType.Leaf));
          }
        }
      }
      height = trunkH + 3;
      trunkRadius = 0.5;
      break;
    }

    case "willow": {
      // Tall trunk, drooping branch curtains hanging from mid-height upward
      const trunkH = 8 + Math.floor(rng.next() * 4); // 8-11
      buildTrunk(geos, atlas, trunkH, 1);
      // Oval top crown
      buildSphereCrown(geos, rng, atlas, 0, trunkH + 1, 0, 2);
      // Drooping branch arms: radial spokes with leaf drops hanging down
      const arms = 4 + Math.floor(rng.next() * 4); // 4-7 arms
      for (let a = 0; a < arms; a++) {
        const angle = (a / arms) * Math.PI * 2 + rng.next() * 0.4;
        const armLen = 2 + Math.floor(rng.next() * 2);
        const armY = trunkH - 2 - Math.floor(rng.next() * 3);
        for (let l = 1; l <= armLen; l++) {
          const ax = Math.round(Math.cos(angle) * l);
          const az = Math.round(Math.sin(angle) * l);
          geos.push(makeBox(ax, armY, az, atlas, BlockType.Log));
          // Leaf curtain hanging from branch tip
          const dropLen = 2 + Math.floor(rng.next() * 3);
          for (let d = 0; d <= dropLen; d++) {
            if (rng.next() < 0.2) continue;
            geos.push(makeBox(ax, armY - d, az, atlas, BlockType.Leaf));
          }
        }
      }
      height = trunkH + 3;
      trunkRadius = 0.5;
      break;
    }

    case "palm": {
      // Single straight trunk, bare, with a fan spray of leaves at the top
      const trunkH = 7 + Math.floor(rng.next() * 4); // 7-10
      buildTrunk(geos, atlas, trunkH, 1);
      // Fan fronds: 6-8 radial leaf arms arcing upward and outward
      const fronds = 6 + Math.floor(rng.next() * 3);
      for (let f = 0; f < fronds; f++) {
        const angle = (f / fronds) * Math.PI * 2;
        const frondLen = 3 + Math.floor(rng.next() * 2); // 3-4
        for (let l = 1; l <= frondLen; l++) {
          const fx = Math.round(Math.cos(angle) * l);
          const fz = Math.round(Math.sin(angle) * l);
          // Arc upward then droop: y rises then falls
          const fy = trunkH + Math.max(0, frondLen - l);
          geos.push(makeBox(fx, fy, fz, atlas, BlockType.Leaf));
          if (l <= frondLen - 1) geos.push(makeBox(fx, fy + 1, fz, atlas, BlockType.Leaf));
        }
      }
      // Small leaf tuft at very top
      geos.push(makeBox(0, trunkH + 1, 0, atlas, BlockType.Leaf));
      height = trunkH + 2;
      trunkRadius = 0.5;
      break;
    }

    case "fir": {
      // Dense layered conical crown — wider and more symmetrical than pine/spruce
      const trunkH = 8 + Math.floor(rng.next() * 4); // 8-11
      buildTrunk(geos, atlas, trunkH, 1);
      const layers = 6 + Math.floor(rng.next() * 3); // 6-8 layers, denser than spruce
      for (let l = 0; l < layers; l++) {
        const y = trunkH - 2 + l;
        const half = Math.ceil((layers - l) * 1.1); // wider base ratio
        for (let dx = -half; dx <= half; dx++) {
          for (let dz = -half; dz <= half; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > half + 1) continue;
            if (rng.next() < 0.05) continue; // very dense, few gaps
            geos.push(makeBox(dx, y, dz, atlas, BlockType.Leaf));
          }
        }
      }
      geos.push(makeBox(0, trunkH - 2 + layers, 0, atlas, BlockType.Leaf)); // tip
      height = trunkH + layers - 1;
      trunkRadius = 0.5;
      break;
    }

    case "krummholz": {
      // Wind-beaten near-treeline: short, tilted trunk leaning in one direction,
      // compressed asymmetric canopy hugging the leeward side
      const trunkH = 3 + Math.floor(rng.next() * 3); // 3-5, short
      const leanX = (rng.next() < 0.5 ? 1 : -1) * (1 + Math.floor(rng.next() * 2));
      const leanZ = Math.floor(rng.next() * 3) - 1;
      for (let y = 0; y < trunkH; y++) {
        // Trunk tilts progressively in leanX direction
        const ox = Math.floor((y / trunkH) * leanX);
        geos.push(makeBox(ox, y, 0, atlas, BlockType.Log));
      }
      // Asymmetric canopy: mostly on the leeward side (opposite to lean)
      const cx = Math.floor((trunkH / trunkH) * leanX); // tip offset
      for (let dx = -1; dx <= 2; dx++) {
        for (let dy = 0; dy <= 2; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            // Lean canopy away from wind
            const wx = dx - Math.sign(leanX);
            if (wx * Math.sign(leanX) > 1) continue; // trim windward side
            if (rng.next() < 0.3) continue;
            geos.push(makeBox(cx + dx, trunkH + dy, leanZ + dz, atlas, BlockType.Leaf));
          }
        }
      }
      height = trunkH + 3;
      trunkRadius = 0.5;
      break;
    }
  }

  const merged = mergeGeometries(geos, false);
  // Free individual geo allocations
  geos.forEach((g) => g.dispose());

  const material = new THREE.MeshLambertMaterial({ map: atlas.texture, alphaTest: 0.5 });
  return { geometry: merged, material, species, trunkRadius, height };
}
