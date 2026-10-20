import * as THREE from 'three';
import type { CubeSphere, ChunkAddress } from './CubeSphere';
import type { TerrainNoise } from './TerrainNoise';
import type { Biomes } from './Biomes';
import type { BlockAtlas } from './BlockAtlas';
import { BlockType } from './BlockAtlas';
import { PLANET } from '../config';
import { Biome } from './Biomes';

export interface VoxelChunkMesh {
  mesh: THREE.Mesh;
  colliderHeight: number;
  dispose(): void;
}

const VOXEL_SIZE        = 1;    // horizontal voxel width (m)
export const VOXEL_HEIGHT = 1;   // vertical voxel height (m) — cubic voxels
const CAVE_THRESHOLD  = PLANET.caveThreshold;
const CAVE_SHELL_DEPTH = PLANET.caveShellDepth;

interface FaceDef {
  axis: number;
  positive: boolean;
  uAxis: number;
  vAxis: number;
}

const FACES: FaceDef[] = [
  { axis: 0, positive: true,  uAxis: 2, vAxis: 1 },
  { axis: 0, positive: false, uAxis: 2, vAxis: 1 },
  { axis: 1, positive: true,  uAxis: 0, vAxis: 2 },
  { axis: 1, positive: false, uAxis: 0, vAxis: 2 },
  { axis: 2, positive: true,  uAxis: 0, vAxis: 1 },
  { axis: 2, positive: false, uAxis: 0, vAxis: 1 },
];

const ATLAS_FACE_FOR_DIR = [1, 1, 0, 2, 1, 1];

// Module-level constants for greedy mesh corner offsets (no per-quad allocation)
// Corner order: [0]=bottom-left, [1]=bottom-right, [2]=top-right, [3]=top-left
const CORNER_U_SCALE = [0, 1, 1, 0]; // offset along u (× height)
const CORNER_V_SCALE = [0, 0, 1, 1]; // offset along v (× width)
const CORNER_U_DIR   = [-1, 1, 1, -1]; // AO u-direction per corner
const CORNER_V_DIR   = [-1, -1, 1, 1]; // AO v-direction per corner
// Triangle winding constants — picked once per face direction, not per quad
const TRI_CW  = [0, 2, 1, 0, 3, 2]; // positive !== (axis===2)
const TRI_CCW = [0, 1, 2, 0, 2, 3];

export class VoxelChunkBuilder {
  private _capacity = 300_000;
  private _posBuf   = new Float32Array(300_000 * 3);
  private _normBuf  = new Float32Array(300_000 * 3);
  private _uvBuf    = new Float32Array(300_000 * 2);
  private _aoBuf    = new Float32Array(300_000);
  // Greedy mesher scratch — avoids allocating mask/done Uint8Array on every slice.
  // Sized for the largest possible face: max(dimX,dimZ) × maxShellDepthVoxels = 32×192 = 6144.
  private _maskBuf  = new Uint8Array(8192);
  private _doneBuf  = new Uint8Array(8192);
  // Per-build column scratch — sized for max colCount(32)×32 and max effectiveDepth(192).
  // Reused each buildChunk call; fill(0) only the slice actually used.
  private _spherePtsFlat  = new Float32Array(32 * 32 * 3);   // 12 KB
  private _columnHeights  = new Float32Array(32 * 32);        // 4 KB
  private _surfaceTopGrid = new Int16Array(32 * 32);          // 2 KB
  private _voxelBuf       = new Uint8Array(32 * 32 * 192);   // 192 KB — biggest per-frame alloc gone
  // Per-quad scratch for 4 corner positions/uvs/ao (replaces quadCorners, localPositions, etc.)
  private _cLx = new Float32Array(4);
  private _cLy = new Float32Array(4);
  private _cLz = new Float32Array(4);
  private _cLu = new Float32Array(4);
  private _cLv = new Float32Array(4);
  private _cAO = new Float32Array(4);

  private _ensureVertexCapacity(needed: number): void {
    if (needed <= this._capacity) return;
    const cap = Math.max(needed, this._capacity * 2);
    this._posBuf  = new Float32Array(cap * 3);
    this._normBuf = new Float32Array(cap * 3);
    this._uvBuf   = new Float32Array(cap * 2);
    this._aoBuf   = new Float32Array(cap);
    this._capacity = cap;
  }

  constructor(
    private cubeSphere: CubeSphere,
    private terrainNoise: TerrainNoise,
    private biomes: Biomes,
    private atlas: BlockAtlas,
    private material: THREE.ShaderMaterial,
    _seed: number
  ) {}

  /**
   * hCenter: terrain height at chunk center (mesh translated to PLANET.radius + hCenter).
   * shellDepth: total voxel layers in the shell (must be even). Shell covers
   *   [hCenter - shellDepth/2, hCenter + shellDepth/2] meters.
   * Local Y=0 is at hCenter; Y increases toward sky.
   */
  buildChunk(
    addr: ChunkAddress,
    lodStep: number,
    hCenter: number,
    shellDepth: number,
  ): VoxelChunkMesh {
    const { face, cx, cz } = addr;
    const colCount = Math.max(1, Math.round(this.cubeSphere.chunkSize / (VOXEL_SIZE * lodStep)));

    // --- Per-column data (needed for cave carve pass) ---
    // Reuse pre-allocated scratch buffers; zero only the slice we use.
    const colSq = colCount * colCount;
    const spherePtsFlat  = this._spherePtsFlat.subarray(0, colSq * 3);
    const columnHeights  = this._columnHeights.subarray(0, colSq);
    const surfaceTopGrid = this._surfaceTopGrid.subarray(0, colSq);
    surfaceTopGrid.fill(0);
    const _spTmp = new THREE.Vector3();

    // --- Chunk-centre biome (for frost pass) ---
    this.cubeSphere.chunkToSphereInto(face, cx, cz, 0.5, 0.5, _spTmp);
    const centerSphere = _spTmp.clone().normalize();
    const chunkBiome = this.biomes.classify(centerSphere, hCenter);

    // --- Cave probe: 4 interior points, 15 m below surface ---
    let hasCaves = false;
    const probeUVs: [number, number][] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    for (const [pu, pv] of probeUVs) {
      this.cubeSphere.chunkToSphereInto(face, cx, cz, pu, pv, _spTmp);
      const sp = _spTmp.clone().normalize();
      const pH = this.terrainNoise.getHeight(sp);
      const r = PLANET.radius + pH - PLANET.caveProbeDepthM;
      if (this.terrainNoise.getCaveDensity(sp.x * r, sp.y * r, sp.z * r) > CAVE_THRESHOLD) {
        hasCaves = true;
        break;
      }
    }
    // Convert metre depths → voxel layers using VOXEL_HEIGHT
    const shellLayers = Math.round(shellDepth    / VOXEL_HEIGHT);
    const caveLayers  = Math.round(CAVE_SHELL_DEPTH / VOXEL_HEIGHT);
    const effectiveDepth = hasCaves ? Math.max(shellLayers, caveLayers) : shellLayers;
    const effectiveHalf  = effectiveDepth >> 1;

    // voxels indexed as [x * colCount * effectiveDepth + z * effectiveDepth + y]
    // gy=0 = deepest (toward planet core), gy=effectiveDepth-1 = sky side (+Y local)
    const voxelCount = colCount * colCount * effectiveDepth;
    const voxels = this._voxelBuf.subarray(0, voxelCount);
    voxels.fill(0);

    const vidx = (x: number, z: number, y: number) =>
      x * colCount * effectiveDepth + z * effectiveDepth + y;

    // --- Fill voxel grid ---
    for (let i = 0; i < colCount; i++) {
      for (let j = 0; j < colCount; j++) {
        // Boundary columns sample at the exact chunk edge so adjacent chunks
        // evaluate the same noise point → identical floor() → no 1-voxel height step.
        const u = i === 0 ? 0.0 : i === colCount - 1 ? 1.0 : (i + 0.5) / colCount;
        const v = j === 0 ? 0.0 : j === colCount - 1 ? 1.0 : (j + 0.5) / colCount;
        this.cubeSphere.chunkToSphereInto(face, cx, cz, u, v, _spTmp);
        _spTmp.normalize();
        const H = this.terrainNoise.getHeight(_spTmp);
        const biome = this.biomes.classify(_spTmp, H);

        // Height relative to chunk centre — shell covers ±effectiveHalf metres
        // Convention: gy=0 = deepest (toward planet core), gy increases toward sky (+Y local)
        const relH = H - hCenter;
        const heightVoxels = Math.floor(relH / VOXEL_HEIGHT);
        // Surface block top is at gy = effectiveHalf + heightVoxels; fill downward from there
        const surfaceTop = Math.max(0, Math.min(effectiveDepth - 1, effectiveHalf + heightVoxels));

        const ptBase = (i * colCount + j) * 3;
        spherePtsFlat[ptBase]     = _spTmp.x;
        spherePtsFlat[ptBase + 1] = _spTmp.y;
        spherePtsFlat[ptBase + 2] = _spTmp.z;
        columnHeights[i * colCount + j] = H;
        surfaceTopGrid[i * colCount + j] = surfaceTop;

        for (let y = 0; y <= surfaceTop; y++) {
          voxels[vidx(i, j, y)] = this.biomes.getBlock(biome, surfaceTop - y);
        }
      }
    }

    // --- Cave carve pass ---
    if (hasCaves) {
      for (let i = 0; i < colCount; i++) {
        for (let j = 0; j < colCount; j++) {
          const sTop = surfaceTopGrid[i * colCount + j];
          const ptBase = (i * colCount + j) * 3;
          _spTmp.set(spherePtsFlat[ptBase], spherePtsFlat[ptBase + 1], spherePtsFlat[ptBase + 2]);
          const sp   = _spTmp;
          const H    = columnHeights[i * colCount + j];
          // Carve layers caveCarveCapVoxels..(sTop-caveCarveCapVoxels): skip surface cap and deepest floor
          for (let y = PLANET.caveCarveCapVoxels; y < sTop - PLANET.caveCarveCapVoxels; y++) {
            if (voxels[vidx(i, j, y)] === BlockType.Bedrock) continue;
            const layerDepth = (sTop - y) * VOXEL_HEIGHT; // metres below surface
            const r = PLANET.radius + H - layerDepth;
            if (this.terrainNoise.getCaveDensity(sp.x * r, sp.y * r, sp.z * r) > CAVE_THRESHOLD) {
              voxels[vidx(i, j, y)] = BlockType.Air;
            }
          }
        }
      }
    }

    // --- Frost pass: Stone neighbours of carved Air → Snow (Mountain/Snow biomes) ---
    if (hasCaves && (chunkBiome === Biome.Mountain || chunkBiome === Biome.Snow)) {
      for (let i = 0; i < colCount; i++) {
        for (let j = 0; j < colCount; j++) {
          for (let y = 0; y < effectiveDepth; y++) {
            if (voxels[vidx(i, j, y)] !== BlockType.Air) continue;
            const frost = (ni: number, nj: number, ny: number) => {
              if (ni < 0 || ni >= colCount || nj < 0 || nj >= colCount) return;
              if (ny < 0 || ny >= effectiveDepth) return;
              if (voxels[vidx(ni, nj, ny)] === BlockType.Stone) voxels[vidx(ni, nj, ny)] = BlockType.Snow;
            };
            frost(i-1,j,y); frost(i+1,j,y);
            frost(i,j-1,y); frost(i,j+1,y);
            frost(i,j,y-1); frost(i,j,y+1);
          }
        }
      }
    }

    // --- Water fill: above terrain up to waterLevel for submerged columns ---
    // Fills Water voxels so adjacent beach/stone blocks render their side faces.
    // Water blocks are treated as non-solid in the mesher (no mesh generated).
    const waterTopGy = Math.max(0, Math.min(effectiveDepth - 1,
      effectiveHalf + Math.floor((PLANET.waterLevel - hCenter) / VOXEL_HEIGHT)));
    for (let i = 0; i < colCount; i++) {
      for (let j = 0; j < colCount; j++) {
        const sTop = surfaceTopGrid[i * colCount + j];
        if (sTop < waterTopGy) {
          for (let y = sTop + 1; y <= waterTopGy; y++) {
            voxels[vidx(i, j, y)] = BlockType.Water;
          }
        }
      }
    }

    // --- Ghost edge pre-sampling ---
    // Sample terrain one column outside each of the 4 boundaries.  This gives the
    // true adjacent-chunk surface height in the current chunk's voxel coordinate
    // system.  Using the clamped boundary column was wrong when adjacent terrain
    // differs (hilltops with flat neighbours → entire hillside suppressed).
    // 4 × colCount samples — negligible vs. rest of build.
    const ghostLeft  = new Int16Array(colCount); // gx = -1,      gz = 0..colCount-1
    const ghostRight = new Int16Array(colCount); // gx = colCount, gz = 0..colCount-1
    const ghostFront = new Int16Array(colCount); // gz = -1,      gx = 0..colCount-1
    const ghostBack  = new Int16Array(colCount); // gz = colCount, gx = 0..colCount-1
    const _ghostUOOB = new THREE.Vector3();
    {
      const sampleGhostNst = (u: number, v: number): number => {
        this.cubeSphere.chunkToSphereInto(face, cx, cz, u, v, _ghostUOOB);
        _ghostUOOB.normalize();
        const H = this.terrainNoise.getHeight(_ghostUOOB);
        return Math.max(0, Math.min(effectiveDepth - 1,
          effectiveHalf + Math.floor((H - hCenter) / VOXEL_HEIGHT)));
      };
      // Sample ghost at the adjacent chunk's first interior column centre.
      // u=0/u=1 (exact boundary) equals this chunk's own boundary column → ghost equals
      // own height → boundary column never generates cliff faces → top faces appear to
      // float unsupported above lower adjacent terrain (3 m gap at LOD3).
      // Sampling 1.5/colCount inside the adjacent gives the actual adjacent interior
      // height so the boundary column generates the correct descending cliff face.
      // For ascending adjacent terrain the boundary column is already below the surface
      // at those heights (AIR), so no false faces are added.
      // chunkToSphereInto handles OOB u/v via the cube-to-sphere normalisation: a cube
      // point just outside a face normalises to a continuous sphere point on the adjacent
      // face.  No fallback needed — always sample 1.5 columns into the adjacent chunk,
      // including across cube-face boundaries (fixes whole-hillside invisibility at face edges).
      const colStep   = 1.5 / colCount;
      const uOOBLeft  = -colStep;
      const uOOBRight = 1.0 + colStep;
      const vOOBFront = -colStep;
      const vOOBBack  = 1.0 + colStep;
      for (let k = 0; k < colCount; k++) {
        const mid = k === 0 ? 0.0 : k === colCount - 1 ? 1.0 : (k + 0.5) / colCount;
        ghostLeft[k]  = sampleGhostNst(uOOBLeft,  mid);
        ghostRight[k] = sampleGhostNst(uOOBRight, mid);
        ghostFront[k] = sampleGhostNst(mid, vOOBFront);
        ghostBack[k]  = sampleGhostNst(mid, vOOBBack);
      }
    }

    // --- Greedy mesher ---
    // Realistic overestimate: each column face can generate at most 1 quad = 6 verts
    this._ensureVertexCapacity(colCount * effectiveDepth * colCount * 4);
    let posCursor = 0, normCursor = 0, uvCursor = 0, aoCursor = 0;
    const voxelScale = this.cubeSphere.chunkSize / colCount;
    const halfChunk  = this.cubeSphere.chunkSize / 2;
    const dimX = colCount, dimY = effectiveDepth, dimZ = colCount;

    for (let dirIdx = 0; dirIdx < 6; dirIdx++) {
      const fd = FACES[dirIdx];
      const { axis, positive, uAxis, vAxis } = fd;
      const atlasFace = ATLAS_FACE_FOR_DIR[dirIdx];

      const normalSign = positive ? 1 : -1;
      const nx = axis === 0 ? normalSign : 0;
      const ny = axis === 1 ? normalSign : 0;
      const nz = axis === 2 ? normalSign : 0;

      const sliceCount = axis  === 0 ? dimX : axis  === 1 ? dimY : dimZ;
      const uCount     = uAxis === 0 ? dimX : uAxis === 1 ? dimY : dimZ;
      const vCount     = vAxis === 0 ? dimX : vAxis === 1 ? dimY : dimZ;
      // Winding constant for this face direction — selected once, not per quad
      const triOrder = (positive !== (axis === 2)) ? TRI_CW : TRI_CCW;

      const getVoxel = (sliceVal: number, uVal: number, vVal: number): number => {
        const gx = axis === 0 ? sliceVal : uAxis === 0 ? uVal : vVal;
        const gy = axis === 1 ? sliceVal : uAxis === 1 ? uVal : vVal;
        const gz = axis === 2 ? sliceVal : uAxis === 2 ? uVal : vVal;
        // Horizontal OOB: look up the pre-sampled ghost-edge surface top.
        // Using the clamped boundary column was wrong: it has THIS chunk's terrain height
        // at the edge, not the adjacent chunk's — causing hillside faces to be suppressed
        // when adjacent terrain is much lower (floating-chunks visual).
        if (gx < 0 || gx >= dimX || gz < 0 || gz >= dimZ) {
          const nst = gx < 0       ? ghostLeft[gz]
                    : gx >= dimX   ? ghostRight[gz]
                    : gz < 0       ? ghostFront[gx]
                                   : ghostBack[gx];
          if (gy <= nst) return BlockType.Stone;
          const worldH = hCenter + (gy - effectiveHalf) * VOXEL_HEIGHT;
          return worldH <= PLANET.waterLevel ? BlockType.Water : BlockType.Air;
        }
        // Above chunk top = genuine air; below chunk bottom = solid core.
        if (gy >= dimY) return BlockType.Air;
        if (gy < 0)     return BlockType.Stone;
        return voxels[vidx(gx, gz, gy)];
      };

      const mask = this._maskBuf;
      const done = this._doneBuf;

      for (let s = 0; s < sliceCount; s++) {
        for (let u = 0; u < uCount; u++) {
          for (let v = 0; v < vCount; v++) {
            const block = getVoxel(s, u, v);
            const neighborS = positive ? s + 1 : s - 1;
            const neighbor = getVoxel(neighborS, u, v);
            // Water is invisible (mesh comes from the water sphere) but counts as transparent
            // for adjacent solid blocks so their side faces render at the shoreline.
            const curSolid = block !== BlockType.Air && block !== BlockType.Water;
            const neighborTransparent =
              neighbor === BlockType.Air ||
              (block !== BlockType.Water && neighbor === BlockType.Water);
            mask[u * vCount + v] = (curSolid && neighborTransparent) ? block : 0;
          }
        }

        done.fill(0, 0, uCount * vCount);

        for (let u = 0; u < uCount; u++) {
          for (let v = 0; v < vCount; v++) {
            const block = mask[u * vCount + v];
            if (!block || done[u * vCount + v]) continue;

            let width = 1;
            while (v + width < vCount &&
                   mask[u * vCount + v + width] === block &&
                   !done[u * vCount + v + width]) {
              width++;
            }

            let height = 1;
            expandU: while (u + height < uCount) {
              for (let k = 0; k < width; k++) {
                if (mask[(u + height) * vCount + v + k] !== block ||
                    done[(u + height) * vCount + v + k]) break expandU;
              }
              height++;
            }

            for (let du = 0; du < height; du++)
              for (let dv = 0; dv < width; dv++)
                done[(u + du) * vCount + v + dv] = 1;

            const faceSlice = positive ? s + 1 : s;
            const SEAM = PLANET.chunkSeamOverlapM;
            const { u: tu, v: tv } = this.atlas.getTileUV(block as BlockType, atlasFace);
            const ts   = 1 / 32;
            const half = 0.5 / 1024;
            const normalDir = positive ? 0 : -1;

            // Pre-compute 4 corner positions, uvs, and AO into scratch arrays — no allocations
            for (let ci = 0; ci < 4; ci++) {
              const cu = u + CORNER_U_SCALE[ci] * height;
              const cv = v + CORNER_V_SCALE[ci] * width;
              const gx = axis === 0 ? faceSlice : uAxis === 0 ? cu : cv;
              const gy = axis === 1 ? faceSlice : uAxis === 1 ? cu : cv;
              const gz = axis === 2 ? faceSlice : uAxis === 2 ? cu : cv;
              // Seam extension fills corner gaps between side faces only.
              // Top/bottom faces (axis=1) must NOT extend — adjacent boundary columns share
              // the same world height, so any horizontal overlap creates exact Z-fighting.
              // Z-side faces (axis=2) extend in X; X-side faces (axis=0) extend in Z.
              const bx = axis === 2 ? (gx === 0 ? -SEAM : gx === dimX ? SEAM : 0) : 0;
              const bz = axis === 0 ? (gz === 0 ? -SEAM : gz === dimZ ? SEAM : 0) : 0;
              this._cLx[ci] = gx * voxelScale - halfChunk + bx;
              this._cLy[ci] = (gy - effectiveHalf) * VOXEL_HEIGHT;
              this._cLz[ci] = gz * voxelScale - halfChunk + bz;
              this._cLu[ci] = ci === 0 ? tu + half : ci === 1 ? tu + ts - half : ci === 2 ? tu + ts - half : tu + half;
              this._cLv[ci] = ci === 0 ? tv + half : ci === 1 ? tv + half     : ci === 2 ? tv + ts - half : tv + ts - half;
              this._cAO[ci] = this._cornerAO(voxels, gx, gy, gz, axis, uAxis, vAxis,
                CORNER_U_DIR[ci], CORNER_V_DIR[ci], normalDir, dimX, dimY, dimZ, vidx) / 3;
            }

            for (const ci of triOrder) {
              this._posBuf[posCursor++] = this._cLx[ci];
              this._posBuf[posCursor++] = this._cLy[ci];
              this._posBuf[posCursor++] = this._cLz[ci];
              this._normBuf[normCursor++] = nx;
              this._normBuf[normCursor++] = ny;
              this._normBuf[normCursor++] = nz;
              this._uvBuf[uvCursor++] = this._cLu[ci];
              this._uvBuf[uvCursor++] = this._cLv[ci];
              this._aoBuf[aoCursor++] = this._cAO[ci];
            }
          }
        }

      }
    }

    // --- Assemble geometry ---
    // .slice() is an optimised SIMD memcpy — far cheaper than building from number[].
    // Three.js owns the standalone buffer; the class-level scratch is reused next build.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this._posBuf.slice(0, posCursor), 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(this._normBuf.slice(0, normCursor), 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(this._uvBuf.slice(0, uvCursor), 2));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(this._aoBuf.slice(0, aoCursor), 1));

    const orientMatrix = this.cubeSphere.chunkOrientation(face, cx, cz);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.userData.ownsGeometry = true;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(orientMatrix);
    mesh.matrixWorldNeedsUpdate = true;

    return {
      mesh,
      colliderHeight: 0,
      dispose() { geo.dispose(); },
    };
  }

  private _cornerAO(
    voxels: Uint8Array,
    gx: number, gy: number, gz: number,
    axis: number, uAxis: number, vAxis: number,
    uDir: number, vDir: number, normalDir: number,
    dimX: number, dimY: number, dimZ: number,
    vidx: (x: number, z: number, y: number) => number
  ): number {
    // base = (gx,gy,gz) shifted by normalDir along axis — fully inline, no array allocations.
    const bx = gx + (axis === 0 ? normalDir : 0);
    const by = gy + (axis === 1 ? normalDir : 0);
    const bz = gz + (axis === 2 ? normalDir : 0);
    const uDx = uAxis === 0 ? uDir : 0, uDy = uAxis === 1 ? uDir : 0, uDz = uAxis === 2 ? uDir : 0;
    const vDx = vAxis === 0 ? vDir : 0, vDy = vAxis === 1 ? vDir : 0, vDz = vAxis === 2 ? vDir : 0;

    // Horizontal OOB (adjacent chunk) = 0.5: removes bright seam without adding dark ring.
    // Vertical OOB = 0 (sky above / core below are always air).
    const sv = (sx: number, sy: number, sz: number): number => {
      if (sy < 0 || sy >= dimY) return 0;
      if (sx < 0 || sx >= dimX || sz < 0 || sz >= dimZ) return 0.5;
      const b = voxels[vidx(sx, sz, sy)];
      return (b !== BlockType.Air && b !== BlockType.Water) ? 1 : 0;
    };
    return sv(bx + uDx,       by + uDy,       bz + uDz)
         + sv(bx + vDx,       by + vDy,       bz + vDz)
         + sv(bx + uDx + vDx, by + uDy + vDy, bz + uDz + vDz);
  }
}
