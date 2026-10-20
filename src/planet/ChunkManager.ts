import * as THREE from 'three';
import { STREAMING, PLANET, HORIZON, WIND, VEGETATION, BIOMES } from '../config';
import type { QualitySettings } from '../config';
import type { CubeSphere, ChunkAddress } from './CubeSphere';
import type { TerrainNoise } from './TerrainNoise';
import type { Biomes } from './Biomes';
import type { BlockAtlas } from './BlockAtlas';
import { BlockType } from './BlockAtlas';
import type { SharedEnvUniforms } from './Environment';
import type { VoxelTreeTemplate, TreeSpecies } from '../vegetation/VoxelTree';
import type { CylinderCollider } from '../core/CameraController';
import { VoxelChunkBuilder, VOXEL_HEIGHT } from './VoxelChunk';
import { createVoxelChunkMaterial } from '../shaders/voxelChunk';
import { combineSeed } from '../utils/Random';
import { snapToVoxelColumn } from '../utils/MathUtils';
import { lodForDist } from '../utils/ViewTools';
import { VoxelGrass } from '../vegetation/VoxelGrass';
import { applyWindSway } from '../vegetation/WindSway';
import type { VoxelUndergrowthTemplate, UndergrowthType } from '../vegetation/VoxelUndergrowth';
import { Biome } from './Biomes';
import { SeededRandom } from '../utils/Random';


interface LoadedChunk {
  key: string;
  addr: ChunkAddress;
  meshGroup: THREE.Group;
  treeInstances: THREE.InstancedMesh[];
  grassInstances: THREE.InstancedMesh[];
  undergrowthInstances: THREE.InstancedMesh[];
  colliders: CylinderCollider[];
  lod: number;
  centerWorld: THREE.Vector3;
}

interface PendingVeg {
  key: string;
  addr: ChunkAddress;
  center: THREE.Vector3;
  oRight: THREE.Vector3;
  oUp: THREE.Vector3;
  oFwd: THREE.Vector3;
  orientMat: THREE.Matrix4;
  chunkSeed: number;
  hCenter: number;
  group: THREE.Group;
}

function chunkKey(addr: ChunkAddress): string {
  return `${addr.face}_${addr.cx}_${addr.cz}`;
}

export class ChunkManager {
  private scene: THREE.Scene;
  private cubeSphere: CubeSphere;
  private terrainNoise: TerrainNoise;
  private biomes: Biomes;
  private treeTemplates: Map<TreeSpecies, VoxelTreeTemplate[]>;
  private snowTreeTemplates: Map<TreeSpecies, VoxelTreeTemplate[]>;
  private undergrowthTemplates: Map<UndergrowthType, VoxelUndergrowthTemplate[]>;
  private chunkMaterial: THREE.ShaderMaterial;
  private seed: number;
  private quality: QualitySettings;

  private loaded = new Map<string, LoadedChunk>();
  private _buildQueue: ChunkAddress[] = [];    // main build queue; consumed via _buildQueueHead
  private _buildQueueHead = 0;                  // O(1) consumption without shift()
  private _lodPriorityQueue: ChunkAddress[] = []; // LOD swaps — small, prepended here not to _buildQueue
  private pendingLodSwap = new Set<string>();
  private totalBuilt = 0;
  private _pendingVeg: PendingVeg[] = [];
  private _pendingVegHead = 0;
  private _pendingVegMap = new Map<string, PendingVeg>(); // O(1) cancel on unload
  // Queue-rebuild scratch — avoids filter/Array.from/map allocations every time player moves
  private _candidatesBuf: ChunkAddress[] = [];
  private _dist2Buf: Float64Array = new Float64Array(2048);
  private _idxBuf: number[] = [];
  private grass: VoxelGrass;
  private _lastQueuePos = new THREE.Vector3(Infinity, Infinity, Infinity);

  private _desiredSet = new Set<string>();
  private _desiredAddrs: ChunkAddress[] = [];
  private _samplePt = new THREE.Vector3(); // scratch for terrain range sampling
  private _collidersNear: CylinderCollider[] = [];
  private _colliderCachePos = new THREE.Vector3(Infinity, 0, Infinity);
  private _colliderCacheDirty = true;
  private undergrowthMaterials = new Map<UndergrowthType, THREE.MeshLambertMaterial>();
  private _undergrowthTypeHashes = new Map<UndergrowthType, number>();
  private _treeMatScratch = new Float32Array(VEGETATION.treeCandidatesPerChunk * 16);
  private _treeAcceptedTmpls: (VoxelTreeTemplate | null)[] = new Array(VEGETATION.treeCandidatesPerChunk).fill(null);
  // Scratch objects reused across _buildChunk calls to avoid per-chunk GC pressure
  private _oRight  = new THREE.Vector3();
  private _oUp     = new THREE.Vector3();
  private _oFwd    = new THREE.Vector3();
  private _colMat4 = new THREE.Matrix4();
  private _colDecomp = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
  private _centerNorm   = new THREE.Vector3();
  private _treeDummy    = new THREE.Object3D();
  private _treePt       = new THREE.Vector3();
  private _surfacePt2   = new THREE.Vector3();
  private _lookTarget   = new THREE.Vector3();
  private _ugDummy      = new THREE.Object3D();
  private _ugPt         = new THREE.Vector3();
  private _builder!: VoxelChunkBuilder;

  constructor(
    scene: THREE.Scene,
    cubeSphere: CubeSphere,
    terrainNoise: TerrainNoise,
    biomes: Biomes,
    atlas: BlockAtlas,
    treeTemplates: Map<TreeSpecies, VoxelTreeTemplate[]>,
    snowTreeTemplates: Map<TreeSpecies, VoxelTreeTemplate[]>,
    undergrowthTemplates: Map<UndergrowthType, VoxelUndergrowthTemplate[]>,
    envUniforms: SharedEnvUniforms,
    seed: number,
    quality: QualitySettings,
  ) {
    this.scene = scene;
    this.cubeSphere = cubeSphere;
    this.terrainNoise = terrainNoise;
    this.biomes = biomes;
    this.treeTemplates = treeTemplates;
    this.snowTreeTemplates = snowTreeTemplates;
    this.undergrowthTemplates = undergrowthTemplates;
    this.seed = seed;
    this.quality = quality;
    this.grass = new VoxelGrass(atlas, envUniforms);
    const viewDist   = PLANET.chunkSize * quality.viewRadius;
    const ditherFar  = viewDist * HORIZON.ditherFarFraction;
    const ditherNear = viewDist * HORIZON.ditherNearFraction;
    this.chunkMaterial = createVoxelChunkMaterial(atlas.texture, envUniforms, ditherNear, ditherFar);
    this._builder = new VoxelChunkBuilder(cubeSphere, terrainNoise, biomes, atlas, this.chunkMaterial, seed);
    for (const type of undergrowthTemplates.keys()) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: false, color: 0xffffff });
      applyWindSway(mat, envUniforms, WIND.sway.undergrowthAmplitude);
      this.undergrowthMaterials.set(type, mat);
      this._undergrowthTypeHashes.set(type,
        Array.from(type).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0));
    }
  }

  update(playerPos: THREE.Vector3, _dt: number): void {
    const viewR = this.quality.viewRadius ?? 6;
    const detailR = this.quality.detailRadius ?? 3;
    const midR = this.quality.midRadius ?? detailR + 3;

    // Only recompute desired set, rebuild queue, and unload when player moves significantly
    const queueDirty = playerPos.distanceToSquared(this._lastQueuePos) >
      (PLANET.chunkSize * 0.5) * (PLANET.chunkSize * 0.5);
    if (queueDirty) {
      this._lastQueuePos.copy(playerPos);
      this._desiredSet.clear();
      this._desiredAddrs.length = 0;
      for (const addr of this.cubeSphere.chunksInRadius(playerPos, viewR * this.cubeSphere.chunkSize)) {
        const key = chunkKey(addr);
        this._desiredSet.add(key);
        this._desiredAddrs.push(addr);
      }

      // Rebuild candidates into pre-allocated scratch (avoids filter/Array.from/map allocations)
      const cBuf = this._candidatesBuf;
      let cLen = 0;
      for (const a of this._desiredAddrs) {
        const k = chunkKey(a);
        if (!this.loaded.has(k) || this.pendingLodSwap.has(k)) {
          cBuf[cLen++] = a;
        }
      }
      // Grow distance/index scratch if needed
      if (cLen > this._dist2Buf.length) this._dist2Buf = new Float64Array(cLen * 2);
      const dist2 = this._dist2Buf;
      for (let i = 0; i < cLen; i++) {
        this.cubeSphere.chunkToSphereInto(cBuf[i].face, cBuf[i].cx, cBuf[i].cz, 0.5, 0.5, this._samplePt);
        dist2[i] = this._samplePt.distanceToSquared(playerPos);
      }
      // Reuse index scratch
      const idxBuf = this._idxBuf;
      idxBuf.length = cLen;
      for (let i = 0; i < cLen; i++) idxBuf[i] = i;
      idxBuf.sort((ia, ib) => dist2[ia] - dist2[ib]);
      // Write sorted addresses directly into the build queue; reset head pointer
      this._buildQueue.length = cLen;
      for (let i = 0; i < cLen; i++) this._buildQueue[i] = cBuf[idxBuf[i]];
      this._buildQueueHead = 0;
      this._lodPriorityQueue.length = 0;

      // Unload out-of-range (desired set is current so this is safe here)
      for (const [key, chunk] of this.loaded) {
        if (!this._desiredSet.has(key)) {
          this._unload(chunk);
          this.loaded.delete(key);
          this._colliderCacheDirty = true;
        }
      }
    }

    // LOD updates: queue a rebuild without unloading — old chunk stays visible until new one is ready
    for (const [key, chunk] of this.loaded) {
      if (this.pendingLodSwap.has(key)) continue;
      const center = chunk.centerWorld;
      const dist = center.distanceTo(playerPos);
      const wantedLod = lodForDist(dist, PLANET.chunkSize, detailR, midR);
      if (wantedLod !== chunk.lod) {
        this.pendingLodSwap.add(key);
        this._lodPriorityQueue.push(chunk.addr);
      }
    }

    // Build budget
    const warmup = this.totalBuilt < STREAMING.warmupBuildThreshold;
    // Signal to Playwright that initial terrain is loaded
    if (!warmup && !(document.body.dataset as any).loaded) {
      (document.body.dataset as any).loaded = 'true';
    }
    const budget = warmup
      ? STREAMING.warmupChunkBuildsPerFrame
      : STREAMING.chunkBuildsPerFrame;

    let built = 0;
    // Drain LOD-priority queue first (LOD swaps), then main build queue via head pointer
    while (built < budget) {
      let addr: ChunkAddress | undefined;
      if (this._lodPriorityQueue.length > 0) {
        addr = this._lodPriorityQueue.pop();
      } else if (this._buildQueueHead < this._buildQueue.length) {
        addr = this._buildQueue[this._buildQueueHead++];
      } else {
        break;
      }
      if (!addr) continue;
      const key = chunkKey(addr);
      if (this.loaded.has(key) && !this.pendingLodSwap.has(key)) continue;
      if (this.pendingLodSwap.has(key)) {
        const old = this.loaded.get(key);
        if (old) { this._unload(old); this.loaded.delete(key); }
        this.pendingLodSwap.delete(key);
      }
      this._buildChunk(addr, playerPos, detailR, midR);
      built++;
      this.totalBuilt++;
      this._colliderCacheDirty = true;
    }

    // Process deferred vegetation: 1 per frame normally, more during warmup.
    const vegBudget = warmup ? STREAMING.warmupChunkBuildsPerFrame : STREAMING.chunkBuildsPerFrame;
    let vegBuilt = 0;
    while (vegBuilt < vegBudget && this._pendingVegHead < this._pendingVeg.length) {
      const pv = this._pendingVeg[this._pendingVegHead++];
      // Compact array when head reaches halfway to avoid unbounded growth
      if (this._pendingVegHead > 512 && this._pendingVegHead > this._pendingVeg.length >> 1) {
        this._pendingVeg = this._pendingVeg.slice(this._pendingVegHead);
        this._pendingVegHead = 0;
      }
      const chunk = this.loaded.get(pv.key);
      // Skip if chunk was cancelled (removed from map) or unloaded before veg was processed
      if (!this._pendingVegMap.has(pv.key) || !chunk || chunk.meshGroup !== pv.group) continue;
      this._pendingVegMap.delete(pv.key);
      this._applyVeg(pv, chunk);
      vegBuilt++;
      this._colliderCacheDirty = true;
    }
  }

  private _buildChunk(addr: ChunkAddress, playerPos: THREE.Vector3, detailR: number, midR: number): void {
    const center = this.cubeSphere.chunkCenter(addr.face, addr.cx, addr.cz);
    const dist = center.distanceTo(playerPos);
    const lod = lodForDist(dist, PLANET.chunkSize, detailR, midR);

    this._centerNorm.copy(center).normalize();
    const centerNorm = this._centerNorm;

    // Sample a 5×5 grid within the chunk to find the actual terrain height range.
    // This determines the shell depth so cliffs and steep slopes are never clipped.
    const orientMat = this.cubeSphere.chunkOrientation(addr.face, addr.cx, addr.cz);
    const oRight = this._oRight, oUp = this._oUp, oFwd = this._oFwd;
    orientMat.extractBasis(oRight, oUp, oFwd);
    let hMin = Infinity, hMax = -Infinity;
    // Use chunkToSphereInto for exact sphere-coordinate sampling — the same method
    // the voxel fill loop uses. Linear-offset sampling diverges from the actual column
    // positions on small-radius planets (r=300), causing hMax to be underestimated,
    // shellDepth to be too shallow, and surfaceTop to overflow+clamp to effectiveDepth-1.
    // When a boundary column has surfaceTop==effectiveDepth-1 the OOB neighbour always
    // appears solid, suppressing every side face on that boundary (entire hillside invisible).
    const SAMPLE_GRID = 9;
    for (let si = 0; si < SAMPLE_GRID; si++) {
      for (let sj = 0; sj < SAMPLE_GRID; sj++) {
        const su = si / (SAMPLE_GRID - 1);
        const sv = sj / (SAMPLE_GRID - 1);
        this.cubeSphere.chunkToSphereInto(addr.face, addr.cx, addr.cz, su, sv, this._samplePt);
        this._samplePt.normalize();
        const h = this.terrainNoise.getHeight(this._samplePt);
        if (h < hMin) hMin = h;
        if (h > hMax) hMax = h;
      }
    }
    // Shell centred on (hMin+hMax)/2, deep enough to cover the full height range.
    // Integer hCenter aligns voxel top faces at Math.floor(h)+1, matching camera floor formula.
    // Clamp to even number so half = shellDepth>>1 is exact.
    const hCenter = Math.round((hMin + hMax) * 0.5);
    const rangeNeeded = Math.ceil(hMax - hMin) + PLANET.shellRangeMarginM;
    // shellDepth must always cover the actual terrain height range (rangeEven) to prevent
    // exposed underground side faces at chunk edges.  For LOD 2/3 we add no extra
    // underground depth beyond the terrain range, saving geometry for distant chunks.
    const rangeEven = rangeNeeded + (rangeNeeded & 1);
    // extraDepth must be large enough that the shell bottom reaches below the
    // surrounding terrain even for a flat hilltop chunk (small rangeEven).
    // All LODs use maxShellDepthVoxels: at the highest peaks (h≈65m) a shallow
    // LOD 3 extraDepth of 96 left the shell bottom at ~9m above the flat 5m
    // base terrain, producing a gap that made distant hills look airborne.
    // LOD 3 colCount=8 so geometry cost is low (8×192×8 ≈ 12k voxels).
    const extraDepth = PLANET.maxShellDepthVoxels;
    const shellDepth = Math.min(PLANET.maxShellDepthVoxels, rangeEven + extraDepth);

    const chunkSeed = combineSeed(this.seed, addr.face, addr.cx, addr.cz);

    const meshResult = this._builder.buildChunk(addr, lod, hCenter, shellDepth);
    const group = new THREE.Group();

    if (meshResult) {
      // Translate mesh so local Y=0 sits at PLANET.radius + hCenter along sphere normal
      const terrainPos = centerNorm.multiplyScalar(this.cubeSphere.radius + hCenter);
      orientMat.setPosition(terrainPos);
      meshResult.mesh.matrix.copy(orientMat);
      meshResult.mesh.matrixWorldNeedsUpdate = true;
      meshResult.mesh.frustumCulled = false;
      group.add(meshResult.mesh);
    }

    this.scene.add(group);

    const key = chunkKey(addr);
    this.loaded.set(key, {
      key,
      addr,
      meshGroup: group,
      treeInstances: [],
      grassInstances: [],
      undergrowthInstances: [],
      colliders: [],
      lod,
      centerWorld: center,
    });

    // Defer vegetation to next frame to halve per-frame build cost.
    // Clone the scratch vectors so they aren't overwritten by subsequent _buildChunk calls.
    if (lod === 1) {
      const pvEntry = {
        key,
        addr,
        center,
        oRight: oRight.clone(),
        oUp: oUp.clone(),
        oFwd: oFwd.clone(),
        orientMat,
        chunkSeed,
        hCenter,
        group,
      };
      this._pendingVeg.push(pvEntry);
      this._pendingVegMap.set(key, pvEntry);
    }
  }

  private _applyVeg(pv: PendingVeg, chunk: LoadedChunk): void {
    const { addr, center, oRight, oUp, oFwd, orientMat, chunkSeed, hCenter, group } = pv;

    chunk.treeInstances.push(...this._placeTrees(addr, center, oRight, oUp, oFwd, chunkSeed, group, hCenter));
    chunk.grassInstances.push(...this._placeGrass(center, orientMat, chunkSeed, group, hCenter));
    chunk.undergrowthInstances.push(...this._placeUndergrowth(addr, center, oRight, oUp, oFwd, chunkSeed, group, hCenter));

    const _decomp = this._colDecomp;
    const _mat4   = this._colMat4;
    for (const inst of chunk.treeInstances) {
      const radius     = (inst.userData.trunkRadius as number) ?? 0.5;
      const treeHeight = (inst.userData.treeHeight   as number) ?? VEGETATION.treeColliderHeightDefault;
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, _mat4);
        _mat4.decompose(_decomp.position, _decomp.quaternion, _decomp.scale);
        chunk.colliders.push({ position: _decomp.position.clone(), radius, height: treeHeight });
      }
    }
    const BLOCK_M = 1.0;
    for (const inst of chunk.undergrowthInstances) {
      const type = inst.userData.undergrowthType as string | undefined;
      if (type === 'rock-large' || type === 'ice-spike' || type === 'floating-island') {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, _mat4);
          _mat4.decompose(_decomp.position, _decomp.quaternion, _decomp.scale);
          chunk.colliders.push({ position: _decomp.position.clone(), radius: VEGETATION.largeObjectColliderRadius, height: VEGETATION.largeObjectColliderHeight * BLOCK_M });
        }
      } else if (type === 'rock-small') {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, _mat4);
          _mat4.decompose(_decomp.position, _decomp.quaternion, _decomp.scale);
          chunk.colliders.push({ position: _decomp.position.clone(), radius: VEGETATION.smallRockColliderRadius, height: BLOCK_M, stepOnly: true });
        }
      }
    }
  }

  private _placeTrees(
    addr: ChunkAddress,
    center: THREE.Vector3,
    oRight: THREE.Vector3,
    oUp: THREE.Vector3,
    oFwd: THREE.Vector3,
    seed: number,
    group: THREE.Group,
    hCenter: number,
  ): THREE.InstancedMesh[] {
    const instances: THREE.InstancedMesh[] = [];
    this._centerNorm.copy(center).normalize();
    if (this.terrainNoise.getHeightFast(this._centerNorm) < PLANET.waterLevel) return instances;

    const dummy = this._treeDummy;
    const worldPt = this._treePt;
    const surfacePt = this._surfacePt2;
    const lookTarget = this._lookTarget;
    let acceptedCount = 0;

    // Single pass: per-position density check so trees don't hard-cut at chunk boundaries
    for (let i = 0; i < VEGETATION.treeCandidatesPerChunk; i++) {
      const ts = combineSeed(seed, i, 0xbeef);
      const tx = (((ts * 1664525 + 1013904223) >>> 0) / 0xffffffff - 0.5) * PLANET.chunkSize;
      const tz = (((ts * 22695477 + 1) >>> 0) / 0xffffffff - 0.5) * PLANET.chunkSize;
      const [snapX, snapZ] = snapToVoxelColumn(tx, tz, PLANET.chunkSize);

      // Use chunkToSphere so the sampled direction exactly matches VoxelChunk's column mapping,
      // preventing floor() disagreements that would float trees above the rendered surface.
      const u = (snapX + PLANET.chunkSize / 2) / PLANET.chunkSize;
      const v = (snapZ + PLANET.chunkSize / 2) / PLANET.chunkSize;
      this.cubeSphere.chunkToSphereInto(addr.face, addr.cx, addr.cz, u, v, worldPt);
      worldPt.normalize();
      const tH = this.terrainNoise.getHeight(worldPt);
      if (tH < PLANET.waterLevel) continue;

      const localBiome = this.biomes.classify(worldPt, tH);
      const localDensity = this.biomes.getTreeDensity(worldPt, localBiome);
      if (localDensity <= 0) continue;
      if ((combineSeed(ts, 0xfa271e) >>> 0) / 0xffffffff >= localDensity) continue;

      const isLocalSnow = localBiome === Biome.Snow || localBiome === Biome.Mountain;
      const tmpl = this._pickTreeTemplate(ts, tH, worldPt, isLocalSnow);

      // Place trunk base at the surface voxel level (not above it) so the tree
      // appears grounded; the first block merges with the terrain surface.
      const localY = Math.floor((tH - hCenter) / VOXEL_HEIGHT) * VOXEL_HEIGHT;
      surfacePt.copy(oUp).multiplyScalar(PLANET.radius + hCenter + localY)
        .addScaledVector(oRight, snapX).addScaledVector(oFwd, snapZ);
      dummy.position.copy(surfacePt);
      dummy.up.copy(worldPt);
      lookTarget.copy(surfacePt).addScaledVector(oFwd, 1);
      dummy.lookAt(lookTarget);
      dummy.updateMatrix();

      this._treeMatScratch.set(dummy.matrix.elements, acceptedCount * 16);
      this._treeAcceptedTmpls[acceptedCount] = tmpl;
      acceptedCount++;
    }

    if (acceptedCount === 0) return instances;

    const templateCounts = new Map<VoxelTreeTemplate, number>();
    for (let k = 0; k < acceptedCount; k++) {
      const tmpl = this._treeAcceptedTmpls[k]!;
      templateCounts.set(tmpl, (templateCounts.get(tmpl) ?? 0) + 1);
    }

    const meshByTemplate = new Map<VoxelTreeTemplate, THREE.InstancedMesh>();
    const idxByTemplate = new Map<VoxelTreeTemplate, number>();
    for (const [tmpl, count] of templateCounts) {
      const inst = new THREE.InstancedMesh(tmpl.geometry, tmpl.material, count);
      inst.castShadow = true;
      inst.frustumCulled = false;
      inst.userData.trunkRadius = tmpl.trunkRadius;
      inst.userData.treeHeight  = tmpl.height; // BLOCK_SIZE=1 m per voxel unit
      group.add(inst);
      instances.push(inst);
      meshByTemplate.set(tmpl, inst);
      idxByTemplate.set(tmpl, 0);
    }

    const mat4 = new THREE.Matrix4();
    for (let k = 0; k < acceptedCount; k++) {
      const tmpl = this._treeAcceptedTmpls[k]!;
      mat4.fromArray(this._treeMatScratch, k * 16);
      const inst = meshByTemplate.get(tmpl)!;
      const idx = idxByTemplate.get(tmpl)!;
      inst.setMatrixAt(idx, mat4);
      idxByTemplate.set(tmpl, idx + 1);
    }
    for (const inst of instances) {
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
    }
    return instances;
  }

  private _pickTreeTemplate(
    ts: number,
    tH: number,
    spherePt: THREE.Vector3,
    isSnowBiome: boolean,
  ): VoxelTreeTemplate {
    const sp = this._pickTreeSpecies(ts, tH, spherePt);
    const variantRng = combineSeed(ts, 0x4a71e9);
    const templateMap = (isSnowBiome && this.snowTreeTemplates.has(sp))
      ? this.snowTreeTemplates : this.treeTemplates;
    const spVariants = templateMap.get(sp) ?? this.treeTemplates.get('spruce')!;
    return spVariants[variantRng % spVariants.length];
  }

  /**
   * Pick tree species by altitude band and moisture so species are ecologically
   * plausible: palms/willows at sea level, broadleaf forest mid-altitude,
   * conifers at high altitude, krummholz near treeline.
   */
  private _pickTreeSpecies(ts: number, tH: number, spherePt: THREE.Vector3): TreeSpecies {
    const moisture = this.biomes.getMoisture(spherePt);
    const roll = (ts >>> 0) % 100;

    // Near treeline (>treelineAltM): wind-beaten forms only
    if (tH > VEGETATION.treelineAltM) {
      const r = roll % 3;
      return r === 0 ? 'krummholz' : r === 1 ? 'snag' : 'fir';
    }

    // High altitude / mountain (treeAltHighM–treelineAltM): conifers dominate
    if (tH > VEGETATION.treeAltHighM) {
      const r = roll % 5;
      return r < 2 ? 'fir' : r < 4 ? 'spruce' : 'pine';
    }

    // Mid altitude (treeAltMidM–treeAltHighM): mixed conifer + broadleaf
    if (tH > VEGETATION.treeAltMidM) {
      const r = roll % 8;
      if (r < 2) return 'spruce';
      if (r < 3) return 'pine';
      if (r < 4) return 'fir';
      if (r < 5) return 'birch';
      if (r < 6) return 'beech';
      if (r < 7) return 'karst';
      return 'oak';
    }

    // Lowland forest (treeAltLowM–treeAltMidM): broadleaf, occasional conifer
    if (tH > VEGETATION.treeAltLowM) {
      const r = roll % 10;
      if (r < 3) return 'oak';
      if (r < 5) return 'beech';
      if (r < 6) return 'birch';
      if (r < 7) return 'cherry';
      if (r < 8) return moisture > VEGETATION.treeWillowMoistureThreshold ? 'willow' : 'oak';
      if (r < 9) return 'snag';
      return 'pine';
    }

    // Coastal / beach (waterLevel–6 m): willows, palms, isolated broadleaf
    const r = roll % 6;
    if (r < 2) return moisture > VEGETATION.treeCoastalMoistureThreshold ? 'willow' : 'palm';
    if (r < 3) return 'palm';
    if (r < 4) return 'cherry';
    return 'oak';
  }

  private _placeGrass(
    center: THREE.Vector3,
    orientMat: THREE.Matrix4,
    seed: number,
    group: THREE.Group,
    hCenter: number,
  ): THREE.InstancedMesh[] {
    this._centerNorm.copy(center).normalize();
    const h = this.terrainNoise.getHeightFast(this._centerNorm);

    // Shallow water (0–3 m below surface) → reeds instead of grass
    if (h < PLANET.waterLevel && h >= PLANET.waterLevel - BIOMES.oceanDepthOffset) {
      return this.grass.buildTile(center, orientMat, seed, group, 0.6, this.terrainNoise, hCenter, BlockType.Reed);
    }
    if (h < PLANET.waterLevel) return [];

    return this.grass.buildTile(center, orientMat, seed, group, 1.0, this.terrainNoise, hCenter, undefined, this.biomes);
  }

  private _placeUndergrowth(
    addr: ChunkAddress,
    center: THREE.Vector3,
    oRight: THREE.Vector3,
    oUp: THREE.Vector3,
    oFwd: THREE.Vector3,
    seed: number,
    group: THREE.Group,
    hCenter: number,
  ): THREE.InstancedMesh[] {
    this._centerNorm.copy(center).normalize();
    const h = this.terrainNoise.getHeightFast(this._centerNorm);
    if (h < PLANET.waterLevel) return [];
    const biome = this.biomes.classify(this._centerNorm, h);

    const specs: [UndergrowthType, number][] = (() => {
      switch (biome) {
        case Biome.Forest:    return [['shrub',5],['fern',10],['flower',3],['mushroom',7],['moss',9],['rock-small',2],['floating-island',1]] as [UndergrowthType,number][];
        case Biome.Grassland: return [['shrub',4],['fern',8],['flower',5],['moss',5],['mushroom',2]] as [UndergrowthType,number][];
        case Biome.Beach:     return [['flower',8],['shrub',3],['rock-small',2]] as [UndergrowthType,number][];
        case Biome.Mountain:  return [['shrub',3],['rock-small',4],['rock-large',3],['floating-island',2]] as [UndergrowthType,number][];
        case Biome.Snow:      return [['rock-large',3],['ice-spike',4],['rock-small',2],['floating-island',1]] as [UndergrowthType,number][];
        case Biome.Desert:    return [['rock-small',3],['rock-large',2]] as [UndergrowthType,number][];
        default: return [];
      }
    })();
    if (specs.length === 0) return [];

    const dummy   = this._ugDummy;
    const worldPt = this._ugPt;
    const instances: THREE.InstancedMesh[] = [];

    for (const [type, count] of specs) {
      const templates = this.undergrowthTemplates.get(type);
      if (!templates || templates.length === 0) continue;

      const typeHash = this._undergrowthTypeHashes.get(type)!;
      const rng = new SeededRandom(combineSeed(seed, typeHash, 0x6e6f77));

      const buckets = new Map<VoxelUndergrowthTemplate, THREE.Matrix4[]>();
      for (let i = 0; i < count; i++) {
        const tx = (rng.next() - 0.5) * PLANET.chunkSize;
        const tz = (rng.next() - 0.5) * PLANET.chunkSize;
        const [snapX, snapZ] = snapToVoxelColumn(tx, tz, PLANET.chunkSize);
        // Use chunkToSphere so height sample matches the voxel mesh's column direction exactly.
        const pu = (snapX + PLANET.chunkSize / 2) / PLANET.chunkSize;
        const pv = (snapZ + PLANET.chunkSize / 2) / PLANET.chunkSize;
        this.cubeSphere.chunkToSphereInto(addr.face, addr.cx, addr.cz, pu, pv, worldPt);
        worldPt.normalize();
        const tH = this.terrainNoise.getHeight(worldPt);
        if (tH < PLANET.waterLevel) continue;
        // Per-item biome check: skip if this position's biome doesn't include this type
        const itemBiome = this.biomes.classify(worldPt, tH);
        if (itemBiome !== biome) {
          const itemSpecs: [UndergrowthType, number][] = (() => {
            switch (itemBiome) {
              case Biome.Forest:    return [['shrub',1],['fern',1],['flower',1],['mushroom',1],['moss',1],['rock-small',1],['floating-island',1]] as [UndergrowthType,number][];
              case Biome.Grassland: return [['shrub',1],['fern',1],['flower',1],['moss',1]] as [UndergrowthType,number][];
              case Biome.Beach:     return [['flower',1],['shrub',1],['rock-small',1]] as [UndergrowthType,number][];
              case Biome.Mountain:  return [['shrub',1],['rock-small',1],['rock-large',1],['floating-island',1]] as [UndergrowthType,number][];
              case Biome.Snow:      return [['rock-large',1],['ice-spike',1],['rock-small',1],['floating-island',1]] as [UndergrowthType,number][];
              case Biome.Desert:    return [['rock-small',1],['rock-large',1]] as [UndergrowthType,number][];
              default: return [];
            }
          })();
          if (!itemSpecs.some(([t]) => t === type)) continue;
        }
        // floating-island: elevate 4–8 voxels above the terrain surface
        const isFloating = type === 'floating-island';
        const floatOffset = isFloating
          ? (4 + Math.floor(((combineSeed(seed, i, 0xf10a7) >>> 0) / 0xffffffff) * 5)) * VOXEL_HEIGHT
          : 0;
        const localY = (Math.floor((tH - hCenter) / VOXEL_HEIGHT) + 1) * VOXEL_HEIGHT + floatOffset;
        dummy.position.copy(oUp)
          .multiplyScalar(PLANET.radius + hCenter + localY)
          .addScaledVector(oRight, snapX)
          .addScaledVector(oFwd, snapZ);
        dummy.up.copy(worldPt);
        dummy.lookAt(dummy.position.clone().addScaledVector(oFwd, 1));
        dummy.updateMatrix();
        const tmpl = templates[Math.floor(rng.next() * templates.length)];
        let b = buckets.get(tmpl);
        if (!b) { b = []; buckets.set(tmpl, b); }
        b.push(dummy.matrix.clone());
      }

      const mat = this.undergrowthMaterials.get(type)!;
      for (const [tmpl, mats] of buckets) {
        const inst = new THREE.InstancedMesh(tmpl.geometry, mat, mats.length);
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.userData.undergrowthType = type; // read by collider builder
        for (let k = 0; k < mats.length; k++) inst.setMatrixAt(k, mats[k]);
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        group.add(inst);
        instances.push(inst);
      }
    }
    return instances;
  }

  private _unload(chunk: LoadedChunk): void {
    // Cancel any pending vegetation for this chunk before removing from scene
    this._pendingVegMap.delete(chunk.key); // O(1); the array entry is skipped at dequeue time

    this.scene.remove(chunk.meshGroup);

    // Dispose terrain mesh geometries
    chunk.meshGroup.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        if ((obj.userData as { ownsGeometry?: boolean }).ownsGeometry) {
          obj.geometry.dispose();
        }
      }
    });

    for (const inst of chunk.treeInstances) {
      inst.dispose();
    }
    for (const inst of chunk.grassInstances) {
      inst.dispose();
    }
    for (const inst of chunk.undergrowthInstances) {
      inst.dispose();
    }
  }

  collectCollidersNear(pos: THREE.Vector3, range: number): CylinderCollider[] {
    if (!this._colliderCacheDirty && pos.distanceToSquared(this._colliderCachePos) < 4) {
      return this._collidersNear;
    }
    this._colliderCachePos.copy(pos);
    this._colliderCacheDirty = false;
    const result = this._collidersNear;
    result.length = 0;
    const rangesq = range * range;
    const chunkReach = (range + PLANET.chunkSize) ** 2;
    for (const [, chunk] of this.loaded) {
      if (chunk.centerWorld.distanceToSquared(pos) < chunkReach) {
        for (const c of chunk.colliders) {
          if (c.position.distanceToSquared(pos) < rangesq) {
            result.push(c);
          }
        }
      }
    }
    return result;
  }

  rebuildAll(): void {
    this._pendingVeg.length = 0;
    this._pendingVegHead = 0;
    this._pendingVegMap.clear();
    for (const [, chunk] of this.loaded) {
      this._unload(chunk);
    }
    this.loaded.clear();
    this.totalBuilt = 0;
  }

  dispose(): void {
    this._pendingVeg.length = 0;
    this._pendingVegHead = 0;
    this._pendingVegMap.clear();
    for (const [, chunk] of this.loaded) {
      this._unload(chunk);
    }
    this.loaded.clear();
  }
}
