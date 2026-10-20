import * as THREE from 'three';
import type { TerrainNoise } from './TerrainNoise';
import { BlockType } from './BlockAtlas';
import { PLANET, BIOMES } from '../config';

export const enum Biome { Ocean = 0, Beach = 1, Grassland = 2, Forest = 3, Desert = 4, Mountain = 5, Snow = 6 }

// Simple LCG hash for 3D point → [0,1]
function hash3(x: number, y: number, z: number, seed: number): number {
  let s = seed >>> 0;
  s ^= (x * 73856093) >>> 0;
  s ^= (y * 19349663) >>> 0;
  s ^= (z * 83492791) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return (s >>> 0) / 0xffffffff;
}

// Low-frequency noise by quantizing sphere point
function lowFreqNoise(pt: THREE.Vector3, seed: number, scale: number): number {
  const ix = Math.floor(pt.x * scale);
  const iy = Math.floor(pt.y * scale);
  const iz = Math.floor(pt.z * scale);
  // Trilinear blend
  const fx = pt.x * scale - ix;
  const fy = pt.y * scale - iy;
  const fz = pt.z * scale - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz, seed);

  return (
    c(0,0,0)*(1-ux)*(1-uy)*(1-uz) + c(1,0,0)*ux*(1-uy)*(1-uz) +
    c(0,1,0)*(1-ux)*uy*(1-uz)     + c(1,1,0)*ux*uy*(1-uz) +
    c(0,0,1)*(1-ux)*(1-uy)*uz     + c(1,0,1)*ux*(1-uy)*uz +
    c(0,1,1)*(1-ux)*uy*uz         + c(1,1,1)*ux*uy*uz
  );
}

export class Biomes {
  constructor(_noise: TerrainNoise, private seed: number) {}

  classify(spherePt: THREE.Vector3, heightOffset: number): Biome {
    const jitter = lowFreqNoise(spherePt, this.seed ^ 0x7f3a, BIOMES.jitterScale) * 2 - 1;

    if (heightOffset < PLANET.waterLevel - BIOMES.oceanDepthOffset) return Biome.Ocean;
    if (heightOffset < PLANET.waterLevel + BIOMES.beachWaterOffset + jitter * BIOMES.beachJitter) return Biome.Beach;

    const moisture = this.getMoisture(spherePt) + jitter * BIOMES.moistureJitter;

    if (heightOffset > BIOMES.snowCapHeight   + jitter * BIOMES.snowCapJitter)   return Biome.Snow;
    if (heightOffset > BIOMES.snowBlendHeight + jitter * BIOMES.snowBlendJitter) {
      const cold = lowFreqNoise(spherePt, this.seed ^ 0xC01D, BIOMES.snowPatchScale);
      if (cold > BIOMES.snowPatchColdThreshold) return Biome.Snow;
    }

    if (heightOffset > BIOMES.mountainHeight + jitter * BIOMES.mountainJitter) return Biome.Mountain;

    if (moisture < BIOMES.desertThreshold)    return Biome.Desert;
    if (moisture < BIOMES.grasslandThreshold) return Biome.Grassland;
    return Biome.Forest;
  }

  // layerFromTop: 0 = surface block, 1..3 = sub-surface, 4+ = stone, last = bedrock
  getBlock(biome: Biome, layerFromTop: number): BlockType {
    if (layerFromTop >= BIOMES.bedrockLayerDepth) return BlockType.Bedrock;

    switch (biome) {
      case Biome.Ocean:
        return BlockType.Stone;
      case Biome.Beach:
        if (layerFromTop <= BIOMES.surfaceLayerDepth) return BlockType.Sand;
        return BlockType.Stone;
      case Biome.Forest:
      case Biome.Grassland:
        if (layerFromTop === 0) return BlockType.Grass;
        if (layerFromTop <= BIOMES.surfaceLayerDepth) return BlockType.Dirt;
        return BlockType.Stone;
      case Biome.Desert:
        if (layerFromTop <= BIOMES.surfaceLayerDepth) return BlockType.Sand;
        return BlockType.Stone;
      case Biome.Mountain:
        if (layerFromTop <= BIOMES.surfaceLayerDepth) return BlockType.Stone;
        if (layerFromTop >= BIOMES.deepBedrockLayer) return BlockType.Bedrock;
        return BlockType.Stone;
      case Biome.Snow:
        if (layerFromTop === 0) return BlockType.Snow;
        if (layerFromTop <= BIOMES.surfaceLayerDepth) return BlockType.Stone;
        if (layerFromTop >= BIOMES.deepBedrockLayer) return BlockType.Bedrock;
        return BlockType.Stone;
      default:
        return BlockType.Stone;
    }
  }

  getMoisture(spherePt: THREE.Vector3): number {
    const coarse = lowFreqNoise(spherePt, this.seed ^ 0xB015, BIOMES.moistureCoarseScale);
    const detail = lowFreqNoise(spherePt, this.seed ^ 0xD4E9, BIOMES.moistureDetailScale);
    return coarse * BIOMES.moistureCoarseWeight + detail * BIOMES.moistureDetailWeight;
  }

  getTreeDensity(_spherePt: THREE.Vector3, biome: Biome): number {
    if (biome === Biome.Forest)    return BIOMES.forestTreeDensityBase + this.getMoisture(_spherePt) * BIOMES.forestTreeDensityMoistureRange;
    if (biome === Biome.Grassland) return BIOMES.grasslandTreeDensity;
    if (biome === Biome.Mountain)  return BIOMES.mountainTreeDensity;
    return 0;
  }

  getGrassFactor(spherePt: THREE.Vector3, biome: Biome): number {
    switch (biome) {
      case Biome.Grassland: return 1.0;
      case Biome.Forest:    return BIOMES.forestGrassBase + this.getMoisture(spherePt) * BIOMES.forestGrassMoistureRange;
      case Biome.Beach:     return BIOMES.beachGrassFactor;
      default:              return 0;
    }
  }
}
