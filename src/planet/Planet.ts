import * as THREE from 'three';
import { PLANET, WIND } from '../config';
import { eyeRadius } from '../utils/ViewTools';
import type { QualitySettings } from '../config';
import { CubeSphere } from './CubeSphere';
import { BIOMES } from '../config';
import { TerrainNoise } from './TerrainNoise';
import type { NoiseType } from './TerrainNoise';
import { BlockAtlas } from './BlockAtlas';
import { Biomes, Biome } from './Biomes';
import { Environment } from './Environment';
import { SmoothSphere } from './SmoothSphere';
import { Water } from './Water';
import { ChunkManager } from './ChunkManager';
import { TREE_SPECIES, buildVoxelTree } from '../vegetation/VoxelTree';
import type { VoxelTreeTemplate, TreeSpecies } from '../vegetation/VoxelTree';
import { buildUndergrowth } from '../vegetation/VoxelUndergrowth';
import type { UndergrowthType, VoxelUndergrowthTemplate } from '../vegetation/VoxelUndergrowth';
import { combineSeed } from '../utils/Random';
import { applyWindSway } from '../vegetation/WindSway';

export class Planet {
  readonly environment: Environment;
  readonly terrainNoise: TerrainNoise;

  private cubeSphere: CubeSphere;
  private atlas: BlockAtlas;
  private biomes: Biomes;
  private smoothSphere: SmoothSphere;
  private water: Water;
  private chunkManager: ChunkManager;

  constructor(scene: THREE.Scene, seed: number, quality: QualitySettings) {
    this.cubeSphere = new CubeSphere(PLANET.radius, PLANET.chunkSize);
    this.terrainNoise = new TerrainNoise(seed, {
      noiseType:    PLANET.noiseType as NoiseType,
      amplitude:    PLANET.amplitude,
      sharpness:    PLANET.sharpness,
      offset:       PLANET.offset,
      period:       PLANET.period,
      persistence:  PLANET.persistence,
      lacunarity:   PLANET.lacunarity,
      octaves:      PLANET.octaves,
      sphereRadius: PLANET.radius,
    });
    this.atlas = new BlockAtlas(seed);
    this.biomes = new Biomes(this.terrainNoise, combineSeed(seed, 0xb1077e5));
    this.environment = new Environment(scene, seed, quality);

    // Build tree templates
    const treeTemplates = new Map<TreeSpecies, VoxelTreeTemplate[]>();
    const speciesList = Array.from(TREE_SPECIES);
    for (let si = 0; si < speciesList.length; si++) {
      const species = speciesList[si];
      const variants: VoxelTreeTemplate[] = [];
      for (let v = 0; v < 5; v++) {
        variants.push(buildVoxelTree(species, v, this.atlas, combineSeed(seed, si, v, 0xf011a6e)));
      }
      treeTemplates.set(species, variants);
    }

    // Apply wind sway to all base tree materials — rigid trunk, tip-heavy curve
    for (const variants of treeTemplates.values()) {
      for (const t of variants) {
        applyWindSway(t.material as THREE.MeshLambertMaterial, this.environment.uniforms, WIND.sway.treeAmplitude, WIND.sway.treeExponent, WIND.sway.treeHeightRef);
      }
    }

    // Build snow-tinted tree templates for Mountain/Snow biomes
    const snowTreeTemplates = new Map<TreeSpecies, VoxelTreeTemplate[]>();
    const snowSpecies: TreeSpecies[] = ['spruce', 'pine', 'snag', 'karst'];
    for (let si = 0; si < snowSpecies.length; si++) {
      const species = snowSpecies[si];
      const variants: VoxelTreeTemplate[] = [];
      for (let v = 0; v < 5; v++) {
        const base = buildVoxelTree(species, v, this.atlas, combineSeed(seed, si, v, 0xf011a6e));
        const snowMat = (base.material as THREE.MeshLambertMaterial).clone();
        snowMat.color.set(0xdce8f0);
        variants.push({ ...base, material: snowMat });
      }
      snowTreeTemplates.set(species, variants);
    }

    // Apply wind sway to snow tree materials (cloned, so onBeforeCompile must be re-applied)
    for (const variants of snowTreeTemplates.values()) {
      for (const t of variants) {
        applyWindSway(t.material as THREE.MeshLambertMaterial, this.environment.uniforms, WIND.sway.treeAmplitude, WIND.sway.treeExponent, WIND.sway.treeHeightRef);
      }
    }

    // Build undergrowth templates
    const undergrowthTypes: UndergrowthType[] = ['shrub','fern','flower','mushroom','moss','rock-small','rock-large','ice-spike','floating-island'];
    const undergrowthTemplates = new Map<UndergrowthType, VoxelUndergrowthTemplate[]>();
    for (let ti = 0; ti < undergrowthTypes.length; ti++) {
      const type = undergrowthTypes[ti];
      const variants: VoxelUndergrowthTemplate[] = [];
      for (let v = 0; v < 3; v++) {
        variants.push(buildUndergrowth(type, v, this.atlas, combineSeed(seed, ti, v, 0x4c9d2e)));
      }
      undergrowthTemplates.set(type, variants);
    }

    // Shared color layer uniforms — passed by reference so HUD slider changes propagate
    // SmoothSphere biome bands: ocean, sand/lowland, grass/mid, stone/high, snow
    const pal = this.atlas.palette;
    const colorLayerUniforms = {
      uOceanColor:      { value: new THREE.Color('#05153F') },
      uBeachColor:      { value: new THREE.Color(pal.sand[0]) },
      uGrasslandColor:      { value: new THREE.Color(pal.grass[0]) },
      uMountainColor:      { value: new THREE.Color(pal.stone[0]) },
      uSnowColor:      { value: new THREE.Color(pal.snowTop) },
      uBeachTransition: { value: BIOMES.beachTransition },
      uGrasslandTransition: { value: BIOMES.grasslandTransition },
      uMountainTransition: { value: BIOMES.mountainTransition },
      uSnowTransition: { value: BIOMES.snowTransition },
      uOceanBeachBlend:     { value: BIOMES.oceanBeachBlend },
      uBeachGrasslandBlend:     { value: BIOMES.beachGrasslandBlend },
      uGrasslandMountainBlend:     { value: BIOMES.grasslandMountainBlend },
      uMountainSnowBlend:     { value: BIOMES.mountainSnowBlend },
    };

    this.chunkManager = new ChunkManager(
      scene,
      this.cubeSphere,
      this.terrainNoise,
      this.biomes,
      this.atlas,
      treeTemplates,
      snowTreeTemplates,
      undergrowthTemplates,
      this.environment.uniforms,
      seed,
      quality,
    );

    this.smoothSphere = new SmoothSphere(scene, this.terrainNoise, this.environment.uniforms, colorLayerUniforms);
    this.water = new Water(scene, PLANET.radius, PLANET.waterLevel, this.environment.uniforms);
  }

  update(dt: number, playerPos: THREE.Vector3, _camera: THREE.Camera): void {
    this.environment.update(dt, playerPos);
    this.chunkManager.update(playerPos, dt);
    this.smoothSphere.update(dt);
    this.water.update(dt, playerPos);
  }

  getHeightAt(spherePt: THREE.Vector3): number {
    return this.terrainNoise.getHeight(spherePt);
  }

  /**
   * Return terrain height snapped to the nearest voxel column centre.
   * Used by collision so wall detection sees full integer column heights
   * rather than smoothly-interpolated noise values between column centres.
   */
  getVoxelColumnHeightAt(spherePt: THREE.Vector3): number {
    const { face, cx, cz } = this.cubeSphere.worldToChunk(spherePt);
    // Reconstruct face-local a, b in [-1, 1] — mirrors worldToChunk logic
    let a: number, b: number;
    const p = spherePt;
    switch (face) {
      case 0:  a =  p.z /  p.x;  b =  p.y /  p.x;  break; // +X
      case 1:  a = -p.z / -p.x;  b =  p.y / -p.x;  break; // -X
      case 2:  a =  p.x /  p.y;  b = -p.z /  p.y;  break; // +Y
      case 3:  a =  p.x / -p.y;  b =  p.z / -p.y;  break; // -Y
      case 4:  a = -p.x /  p.z;  b =  p.y /  p.z;  break; // +Z
      default: a =  p.x / -p.z;  b =  p.y / -p.z;  break; // -Z
    }
    const cpf = this.cubeSphere.chunksPerFace;
    const colCount = PLANET.chunkSize; // 1 voxel per metre at LOD 1
    const localA = (a + 1) * 0.5 * cpf - cx; // [0, 1)
    const localB = (b + 1) * 0.5 * cpf - cz;
    // Mirror VoxelChunk boundary logic: boundary columns sample at exactly 0 or 1
    // so adjacent chunks agree on edge heights and the player can't clip through seams.
    const colI = Math.max(0, Math.min(colCount - 1, Math.floor(localA * colCount)));
    const colJ = Math.max(0, Math.min(colCount - 1, Math.floor(localB * colCount)));
    const u = colI === 0 ? 0.0 : colI >= colCount - 1 ? 1.0 : (colI + 0.5) / colCount;
    const v = colJ === 0 ? 0.0 : colJ >= colCount - 1 ? 1.0 : (colJ + 0.5) / colCount;
    const snapped = this.cubeSphere.chunkToSphere(face, cx, cz, u, v).normalize();
    return this.terrainNoise.getHeight(snapped);
  }

  isUnderwater(worldPos: THREE.Vector3): boolean {
    return this.water.isUnderwater(worldPos);
  }

  findSpawnPoint(): THREE.Vector3 {
    // Spread candidates across the sphere to maximise chance of hitting dry land
    const candidates: THREE.Vector3[] = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0.7, 0, 0.7).normalize(),
      new THREE.Vector3(-0.5, 0, 0.8).normalize(),
      new THREE.Vector3(0.3, 0.1, -0.9).normalize(),
      new THREE.Vector3(0.6, 0.5, 0.6).normalize(),
      new THREE.Vector3(-0.8, 0.2, 0.3).normalize(),
      new THREE.Vector3(0.1, 0.4, -0.9).normalize(),
      new THREE.Vector3(0.9, -0.3, 0.1).normalize(),
      new THREE.Vector3(-0.4, -0.5, 0.8).normalize(),
    ];

    for (const n of candidates) {
      const height = this.terrainNoise.getHeight(n);
      if (height < 5 || height > 120) continue;
      const biome = this.biomes.classify(n, height);
      if (biome === Biome.Ocean || biome === Biome.Snow) continue;
      return n.clone().multiplyScalar(eyeRadius(height, PLANET.radius));
    }

    // Exhaustive fallback: walk the sphere in a grid until we find dry land
    for (let lat = -80; lat <= 80; lat += 10) {
      for (let lon = 0; lon < 360; lon += 15) {
        const phi = (lat * Math.PI) / 180;
        const theta = (lon * Math.PI) / 180;
        const n = new THREE.Vector3(
          Math.cos(phi) * Math.cos(theta),
          Math.sin(phi),
          Math.cos(phi) * Math.sin(theta),
        );
        const h = this.terrainNoise.getHeight(n);
        const biome = this.biomes.classify(n, h);
        if (biome !== Biome.Ocean && biome !== Biome.Snow) {
          return n.multiplyScalar(eyeRadius(h, PLANET.radius));
        }
      }
    }

    // Last resort: pick any point above water level
    const last = new THREE.Vector3(1, 0, 0);
    const h = this.terrainNoise.getHeight(last);
    return last.multiplyScalar(eyeRadius(Math.max(h, 6), PLANET.radius));
  }

  get chunkManagerRef(): ChunkManager {
    return this.chunkManager;
  }

  onTerrainParamsChange(): void {
    this.chunkManager.rebuildAll();
    this.smoothSphere.rebuild?.();
  }

  dispose(): void {
    this.chunkManager.dispose();
    this.environment.dispose?.();
  }
}
