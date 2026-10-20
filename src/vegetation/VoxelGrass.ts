import * as THREE from 'three';
import { BlockAtlas, BlockType } from '../planet/BlockAtlas';
import type { SharedEnvUniforms } from '../planet/Environment';
import type { TerrainNoise } from '../planet/TerrainNoise';
import type { Biomes } from '../planet/Biomes';
import { Biome } from '../planet/Biomes';
import { PLANET, WIND, VEGETATION } from '../config';
import { VOXEL_HEIGHT } from '../planet/VoxelChunk';
import { SeededRandom } from '../utils/Random';
import { snapToVoxelColumn } from '../utils/MathUtils';
import { applyWindSway } from './WindSway';

/** Per-blade colour multiplier based on altitude and biome. */
function _grassTint(out: THREE.Color, h: number, biome: number): THREE.Color {
  // Biome-first: Beach/Desert → straw; Mountain/Snow → dark brown-grey
  if (biome === Biome.Beach)    return out.setRGB(1.00, 0.82, 0.48); // dry straw
  if (biome === Biome.Snow)     return out.setRGB(0.72, 0.70, 0.68); // cold grey
  if (biome === Biome.Mountain) {
    // Darken progressively with altitude
    const t = Math.min(1, Math.max(0, (h - VEGETATION.mountainGrassAltBase) / VEGETATION.mountainGrassAltRange)); // 0 at base, 1 at base+range
    return out.setRGB(0.78 - t * 0.18, 0.65 - t * 0.15, 0.50 - t * 0.10);
  }
  if (biome === Biome.Grassland) return out.setRGB(1.00, 1.00, 0.92); // slightly warm-bright
  if (biome === Biome.Forest)    return out.setRGB(0.82, 0.96, 0.78); // lush cool
  // Altitude fallback when biome unavailable
  if (h > 30) return out.setRGB(0.70, 0.62, 0.52);
  if (h > 18) return out.setRGB(0.85, 0.75, 0.60);
  return out.setRGB(1.00, 1.00, 0.92);
}

/**
 * 1-voxel-tall cross-hatch grass (two crossing quads, 0.5 m tall).
 * Instantiated per world; buildTile() returns InstancedMesh tiles per chunk.
 */
export class VoxelGrass {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly reedGeometry: THREE.BufferGeometry;
  private readonly reedMaterial: THREE.MeshLambertMaterial;

  private _dummy      = new THREE.Object3D();
  private _right      = new THREE.Vector3();
  private _forward    = new THREE.Vector3();
  private _worldPt    = new THREE.Vector3();
  private _scratchQ   = new THREE.Quaternion();
  private _localUp    = new THREE.Vector3(0, 1, 0);
  private _tint       = new THREE.Color();
  private _centerNorm = new THREE.Vector3();

  constructor(atlas: BlockAtlas, envUniforms: SharedEnvUniforms) {
    this.geometry = VoxelGrass._buildCrossGeo(atlas, BlockType.Grass, 1.0);
    this.material = new THREE.MeshLambertMaterial({
      map:       atlas.texture,
      alphaTest: 0.5,
      side:      THREE.DoubleSide,
    });
    applyWindSway(this.material, envUniforms, WIND.sway.grassAmplitude);

    this.reedGeometry = VoxelGrass._buildCrossGeo(atlas, BlockType.Reed, 1.4);
    this.reedMaterial = new THREE.MeshLambertMaterial({
      map:       atlas.texture,
      alphaTest: 0.5,
      side:      THREE.DoubleSide,
    });
    applyWindSway(this.reedMaterial, envUniforms, WIND.sway.grassAmplitude * WIND.sway.reedAmplitudeScale);
  }

  /**
   * Build a grass tile for a chunk. Returns a list of InstancedMesh objects
   * (one tile) added to `group`.
   */
  buildTile(
    center: THREE.Vector3,
    orientation: THREE.Matrix4,
    seed: number,
    group: THREE.Group,
    densityFactor = 1.0,
    terrainNoise?: TerrainNoise,
    hCenter?: number,
    blockType?: BlockType,
    biomes?: Biomes,
  ): THREE.InstancedMesh[] {
    const rng = new SeededRandom(seed ^ 0xca77ee3);
    const isReed = blockType === BlockType.Reed;
    const count = Math.max(1, Math.floor((isReed ? VEGETATION.reedBladesPerTile : VEGETATION.grassBladesPerTile) * densityFactor));
    const mat = isReed ? this.reedMaterial : this.material;
    const geo = isReed ? this.reedGeometry : this.geometry;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = false;
    inst.receiveShadow = false;

    const dummy = this._dummy;
    // Use the same cube-face axes as the terrain mesh so height sampling and
    // blade placement are in the same frame — a worldUp-derived frame is rotated
    // relative to the cube face on non-Y faces and causes blades to float.
    const right   = this._right.setFromMatrixColumn(orientation, 0);
    const forward = this._forward.setFromMatrixColumn(orientation, 2);

    const worldPt  = this._worldPt;
    const scratchQ = this._scratchQ;
    const localUp  = this._localUp;
    const tint     = this._tint;
    this._centerNorm.copy(center).normalize();
    const centerLen = PLANET.radius + (terrainNoise ? terrainNoise.getHeightFast(this._centerNorm) : 0);

    let accepted = 0;
    for (let i = 0; i < count; i++) {
      const tx = (rng.next() - 0.5) * PLANET.chunkSize;
      const tz = (rng.next() - 0.5) * PLANET.chunkSize;

      // Snap to voxel column center so height matches the rendered terrain mesh
      const [snapX, snapZ] = snapToVoxelColumn(tx, tz, PLANET.chunkSize);
      worldPt.copy(center).addScaledVector(right, snapX).addScaledVector(forward, snapZ);
      worldPt.normalize();
      const rawH = terrainNoise ? terrainNoise.getHeight(worldPt) : (centerLen - PLANET.radius);
      if (rawH < PLANET.waterLevel) continue;

      // Per-blade biome density: skip if this blade's local biome has no grass
      let bladeBiome = -1;
      if (biomes) {
        bladeBiome = biomes.classify(worldPt, rawH);
        const bladeDensity = biomes.getGrassFactor(worldPt, bladeBiome);
        if (bladeDensity <= 0 || rng.next() >= bladeDensity) continue;
      }

      const hc = hCenter ?? rawH;
      // worldPt is the sphere-surface unit vector at this column (normalized at line 116).
      // Multiplying by (radius + altitude) lands exactly on the voxel top face, matching
      // the terrain mesh. The old up*scale+right*tx+forward*tz diverges by ~(snapX²/radius)*H
      // on small-radius planets — ~8m at the chunk edge — causing blades to float.
      const localY = (Math.floor((rawH - hc) / VOXEL_HEIGHT) + 1) * VOXEL_HEIGHT;
      const altitude = PLANET.radius + hc + localY;
      dummy.position.copy(worldPt).multiplyScalar(altitude);
      dummy.up.copy(worldPt);
      dummy.quaternion.setFromUnitVectors(localUp, worldPt);
      scratchQ.setFromAxisAngle(worldPt, rng.next() * Math.PI * 2);
      dummy.quaternion.premultiply(scratchQ);
      dummy.scale.setScalar(VEGETATION.grassScaleMin + rng.next() * VEGETATION.grassScaleRange);
      dummy.updateMatrix();
      inst.setMatrixAt(accepted, dummy.matrix);
      inst.setColorAt(accepted, _grassTint(tint, rawH, bladeBiome));
      accepted++;
    }
    inst.count = accepted;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    if (accepted === 0) { inst.dispose(); return []; }
    inst.computeBoundingSphere();
    group.add(inst);
    return [inst];
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.reedGeometry.dispose();
    this.reedMaterial.dispose();
  }

  private static _buildCrossGeo(atlas: BlockAtlas, type: BlockType, h: number): THREE.BufferGeometry {
    const TILE_SIZE = 16 / 512;
    const { u, v } = atlas.getTileUV(type, 0);
    const w = VEGETATION.grassBladeWidthM;

    const positions: number[] = [];
    const uvs:       number[] = [];
    const indices:   number[] = [];

    const addQuad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      base: number,
    ) => {
      positions.push(...p0, ...p1, ...p2, ...p3);
      uvs.push(
        u,             v + TILE_SIZE,
        u + TILE_SIZE, v + TILE_SIZE,
        u,             v,
        u + TILE_SIZE, v,
      );
      indices.push(base, base+1, base+2, base+1, base+3, base+2);
    };

    addQuad([-w/2, 0, 0], [w/2, 0, 0], [-w/2, h, 0], [w/2, h, 0], 0);
    addQuad([0, 0, -w/2], [0, 0, w/2], [0, h, -w/2], [0, h, w/2],  4);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
}
