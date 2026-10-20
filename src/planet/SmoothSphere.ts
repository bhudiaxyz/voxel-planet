import * as THREE from 'three';
import { PLANET, BIOMES, OCEAN } from '../config';
import type { TerrainNoise } from './TerrainNoise';
import type { SharedEnvUniforms } from './Environment';
import { SMOOTH_SPHERE_VERTEX, SMOOTH_SPHERE_FRAGMENT } from '../shaders/smoothSphere';

// Height is quantised to the same steps as the GPU shader had, so the
// far-field mesh matches the voxel staircase visible on close chunks.

export class SmoothSphere {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private noise: TerrainNoise;

  constructor(
    scene: THREE.Scene,
    noise: TerrainNoise,
    envUniforms: SharedEnvUniforms,
    colorLayerUniforms: Record<string, { value: unknown }>,
  ) {
    this.noise = noise;

    this.material = new THREE.ShaderMaterial({
      vertexShader:   SMOOTH_SPHERE_VERTEX,
      fragmentShader: SMOOTH_SPHERE_FRAGMENT,
      uniforms: {
        // Env (shared by reference)
        uSunDir:            envUniforms.uSunDir,
        uSunColor:          envUniforms.uSunColor,
        uNight:             envUniforms.uNight,
        uAmbientColor:      envUniforms.uAmbientColor,
        uGroundBounceColor: envUniforms.uGroundBounceColor,

        // Color layers — shared by reference with HUD sliders
        uOceanColor:      colorLayerUniforms.uOceanColor      ?? { value: new THREE.Color(...(BIOMES.oceanColor as [number, number, number])) },
        uBeachColor:      colorLayerUniforms.uBeachColor      ?? { value: new THREE.Color(...(BIOMES.beachColor as [number, number, number])) },
        uGrasslandColor:      colorLayerUniforms.uGrasslandColor      ?? { value: new THREE.Color(...(BIOMES.grasslandColor as [number, number, number])) },
        uMountainColor:      colorLayerUniforms.uMountainColor      ?? { value: new THREE.Color(...(BIOMES.mountainColor as [number, number, number])) },
        uSnowColor:      colorLayerUniforms.uSnowColor      ?? { value: new THREE.Color(...(BIOMES.snowColor as [number, number, number])) },
        uBeachTransition: colorLayerUniforms.uBeachTransition ?? { value: BIOMES.beachTransition },
        uGrasslandTransition: colorLayerUniforms.uGrasslandTransition ?? { value: BIOMES.grasslandTransition },
        uMountainTransition: colorLayerUniforms.uMountainTransition ?? { value: BIOMES.mountainTransition },
        uSnowTransition: colorLayerUniforms.uSnowTransition ?? { value: BIOMES.snowTransition },
        uOceanBeachBlend:     colorLayerUniforms.uOceanBeachBlend     ?? { value: BIOMES.oceanBeachBlend },
        uBeachGrasslandBlend:     colorLayerUniforms.uBeachGrasslandBlend     ?? { value: BIOMES.beachGrasslandBlend },
        uGrasslandMountainBlend:     colorLayerUniforms.uGrasslandMountainBlend     ?? { value: BIOMES.grasslandMountainBlend },
        uMountainSnowBlend:     colorLayerUniforms.uMountainSnowBlend     ?? { value: BIOMES.mountainSnowBlend },

        // Water level (normalised same way as aVHeight) — ocean areas override biome color
        uWaterLevel:   { value: (PLANET.waterLevel - PLANET.offset * PLANET.amplitude) / PLANET.amplitude },
        uOceanDeep:    { value: new THREE.Color(...(OCEAN.oceanDeepColor    as [number, number, number])) },
        uOceanShallow: { value: new THREE.Color(...(OCEAN.oceanShallowColor as [number, number, number])) },

        ...THREE.UniformsLib.fog,
      },
      fog: true,
    });

    // 64×64 is enough for a far-field background; fewer vertices = faster bake
    const geo = new THREE.SphereGeometry(PLANET.radius - PLANET.smoothSphereInsetM, 64, 64);
    this._bake(geo);

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Re-bake when terrain params change (e.g. HUD sliders). */
  rebuild(): void {
    this._bake(this.mesh.geometry as THREE.SphereGeometry);
  }

  /** Alias kept for API compatibility. */
  markDirty(): void { this.rebuild(); }

  update(_dt: number): boolean { return true; }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private _bake(geo: THREE.SphereGeometry): void {
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const nrmAttr = geo.attributes.normal   as THREE.BufferAttribute;
    const count   = posAttr.count;
    const p       = this.noise.params;
    const baseR   = PLANET.radius - PLANET.smoothSphereInsetM;

    const aVHeight       = new Float32Array(count);
    const aVRawHeight    = new Float32Array(count);
    const aVSphereNormal = new Float32Array(count * 3);
    const v = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      // SphereGeometry normals are outward unit vectors — use as sample direction
      v.fromBufferAttribute(nrmAttr, i);
      aVSphereNormal[i * 3]     = v.x;
      aVSphereNormal[i * 3 + 1] = v.y;
      aVSphereNormal[i * 3 + 2] = v.z;

      const hRaw = this.noise.getHeight(v);
      const hQ   = Math.floor(hRaw / PLANET.smoothSphereVoxelStepM) * PLANET.smoothSphereVoxelStepM;

      posAttr.setXYZ(i, v.x * (baseR + hQ), v.y * (baseR + hQ), v.z * (baseR + hQ));
      aVRawHeight[i] = hQ;
      aVHeight[i]    = Math.max(0, Math.min(1, (hQ - p.offset * p.amplitude) / p.amplitude));
    }

    posAttr.needsUpdate = true;
    geo.setAttribute('aVHeight',       new THREE.Float32BufferAttribute(aVHeight, 1));
    geo.setAttribute('aVRawHeight',    new THREE.Float32BufferAttribute(aVRawHeight, 1));
    geo.setAttribute('aVSphereNormal', new THREE.Float32BufferAttribute(aVSphereNormal, 3));
    geo.computeVertexNormals(); // must run after position displacement
  }
}
