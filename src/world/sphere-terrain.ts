// src/world/sphere-terrain.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/sphere-voxel';
import { basisFromCode } from '../core/geoutil';
import { Noise3 } from '../core/noise3';
import { makeRng } from '../core/rng';
import { BLOCKS } from '../core/palette';

// Sea level is layer 9; terrace step is 2 (same aesthetic as flat terrain)
const SEA_LAYER = 9;
const TERRACE_STEP = 2;
const AMPLITUDE = 24; // max layers above/below sea level

export function generateSphereTerrain(
  seed: number,
  onProgress?: (p: number) => void,
): { grid: SphereVoxelGrid; spawn: { face: number; u: number; v: number } } {
  const grid = new SphereVoxelGrid();
  const noise = new Noise3(seed);
  const noise2 = new Noise3(seed + 101);
  const _n = new THREE.Vector3(), _tu = new THREE.Vector3(), _tv = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const { GRASS, GRASS_LIGHT, STONE, STONE_PALE, SOIL, SAND } = BLOCKS;

  for (let face = 0; face < 6; face++) {
    basisFromCode(face, _n, _tu, _tv);
    for (let v = 0; v < FACE_RES; v++) {
      for (let u = 0; u < FACE_RES; u++) {
        _dir.copy(_n)
          .addScaledVector(_tu, (2 * (u + 0.5)) / FACE_RES - 1)
          .addScaledVector(_tv, (2 * (v + 0.5)) / FACE_RES - 1)
          .normalize();

        const e = elevationAt(noise, noise2, _dir.x, _dir.y, _dir.z);
        const terraced = TERRACE_STEP * Math.round((e * AMPLITUDE) / TERRACE_STEP);
        const surfaceLayer = Math.max(1, Math.min(SHELL_DEPTH - 10, SEA_LAYER + terraced));
        const isLand = surfaceLayer > SEA_LAYER;

        for (let layer = 0; layer <= surfaceLayer; layer++) {
          let id: number;
          if (!isLand) {
            id = layer === surfaceLayer ? SAND.id : STONE.id;
          } else if (layer === surfaceLayer) {
            id = selectSurface(noise, _dir, e, GRASS, GRASS_LIGHT, STONE_PALE);
          } else if (layer >= surfaceLayer - 2) {
            id = SOIL.id;
          } else {
            id = selectRock(noise, _dir, layer, STONE, STONE_PALE);
          }
          grid.set(face, u, v, layer, id);
        }
      }
      if (onProgress && v % 40 === 0)
        onProgress((face * FACE_RES + v) / (6 * FACE_RES));
    }
  }

  const spawn = findSpawn(grid);

  // Scatter voxel trees on land grass columns
  const treeRng = makeRng(seed ^ 0x7ace31);
  const LEAVES = [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC,
                  BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT, BLOCKS.LEAF_ROSE];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < FACE_RES; v++) {
      for (let u = 0; u < FACE_RES; u++) {
        if (treeRng() > 0.02) continue;
        const sl = grid.columnTop(face, u, v);
        if (sl <= SEA_LAYER + 1) continue;
        const topId = grid.get(face, u, v, sl);
        // Only plant on grass blocks
        if (topId !== BLOCKS.GRASS.id && topId !== BLOCKS.GRASS_LIGHT.id) continue;
        plantSphereTree(grid, face, u, v, sl, treeRng, LEAVES);
      }
    }
  }

  return { grid, spawn };
}

function elevationAt(noise: Noise3, noise2: Noise3, x: number, y: number, z: number): number {
  // Domain-warped FBM — identical to planet-explorer Planet.elevationAt()
  const f = 1.6, o = 5, w = 0.25, q = f * 0.8;
  const wx = x + w * noise2.get(x*q+11, y*q, z*q);
  const wy = y + w * noise2.get(x*q, y*q+17, z*q);
  const wz = z + w * noise2.get(x*q, y*q, z*q+23);
  const base = noise.fbm(wx*f, wy*f, wz*f, o, 2.0, 0.5) * 1.1;
  const hills = noise.get(wx*f*3.1+9, wy*f*3.1, wz*f*3.1) * 0.06;
  const mm = smoothstep(-0.1, 0.35, noise2.get(wx*f*0.6+7, wy*f*0.6, wz*f*0.6));
  const ridged = Math.max(0, 1 - Math.abs(noise2.fbm(wx*f*1.5, wy*f*1.5, wz*f*1.5, o, 2.0, 0.5) * 2));
  const e = base + hills + 0.8 * mm * ridged * ridged * 0.8 - 0.05;
  return e < 0 ? e * 0.5 : e;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t);
};

function selectSurface(
  noise: Noise3, dir: THREE.Vector3, e: number,
  grass: any, grassLight: any, stonePale: any,
): number {
  // ponytail: simple temp proxy from latitude (dir.y) + elevation
  const temp = 1 - 1.1 * dir.y * dir.y - 1.2 * Math.max(e, 0);
  if (temp > 0.6) return grass.id;
  if (temp > 0.2) return grassLight.id;
  return stonePale.id;
}

function selectRock(
  noise: Noise3, dir: THREE.Vector3, layer: number,
  stone: any, stonePale: any,
): number {
  const v = noise.get(dir.x * 12 + layer * 0.3, dir.y * 12, dir.z * 12);
  return v > 0.2 ? stonePale.id : stone.id;
}

function plantSphereTree(
  grid: SphereVoxelGrid,
  face: number, u: number, v: number,
  surfaceLayer: number,
  rng: ReturnType<typeof makeRng>,
  leaves: (typeof BLOCKS)[keyof typeof BLOCKS][],
) {
  const trunk = rng() < 0.55 ? BLOCKS.TRUNK : BLOCKS.TRUNK_PALE;
  const leaf = leaves[Math.floor(rng() * leaves.length)] as any;
  const trunkH = 6 + Math.floor(rng() * 7);   // 6–12 layers tall
  const cr = 2 + Math.floor(rng() * 2);        // canopy radius 2–3 in u/v
  const canopyH = 3 + Math.floor(rng() * 3);   // canopy depth 3–5 layers
  const canopyBase = surfaceLayer + trunkH - 1;
  const canopyTop  = surfaceLayer + trunkH + canopyH;

  // Trunk
  for (let l = surfaceLayer + 1; l <= surfaceLayer + trunkH; l++) {
    if (l >= SHELL_DEPTH) break;
    grid.set(face, u, v, l, trunk.id);
  }

  // Canopy box in u/v/layer space around trunk top
  for (let du = -cr; du <= cr; du++) {
    for (let dv = -cr; dv <= cr; dv++) {
      const nu = u + du, nv = v + dv;
      if (nu < 0 || nu >= FACE_RES || nv < 0 || nv >= FACE_RES) continue;
      const dist = Math.abs(du) + Math.abs(dv);
      const lMin = dist <= 1 ? canopyBase     : canopyBase + Math.floor(dist * 0.5);
      const lMax = dist === 0 ? canopyTop     : canopyTop  - dist;
      for (let l = lMin; l <= lMax; l++) {
        if (l >= SHELL_DEPTH) break;
        // Don't overwrite existing terrain
        if (grid.get(face, nu, nv, l) !== 0) continue;
        grid.set(face, nu, nv, l, leaf.id);
      }
    }
  }
}

function findSpawn(grid: SphereVoxelGrid): { face: number; u: number; v: number } {
  // Search face 0 near centre for a land column above sea level
  for (let attempt = 0; attempt < 200; attempt++) {
    const u = 160 + (attempt % 20) * 4;
    const v = 160 + Math.floor(attempt / 20) * 4;
    if (u >= FACE_RES || v >= FACE_RES) continue;
    const top = grid.columnTop(0, u, v);
    if (top > SEA_LAYER + 2) return { face: 0, u, v };
  }
  return { face: 0, u: 200, v: 200 };
}
