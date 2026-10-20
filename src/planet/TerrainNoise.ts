import * as THREE from 'three';
import { PLANET } from '../config';

export const enum NoiseType { Simplex = 1, Fractal = 2, Ridged = 3 }

export interface TerrainParams {
  noiseType: NoiseType;
  amplitude: number;
  sharpness: number;
  offset: number;
  period: number;
  persistence: number;
  lacunarity: number;
  octaves: number;
  /** Planet radius in metres. Used to convert world-space period → unit-sphere frequency. */
  sphereRadius?: number;
}

export const DEFAULT_TERRAIN_PARAMS: TerrainParams = {
  noiseType: NoiseType.Fractal,
  amplitude: 220,
  sharpness: 2.0,
  offset: -0.02,
  period: 2000,
  persistence: 0.5,
  lacunarity: 2.0,
  octaves: 8,
};

// Standard Ian McEwan 3D simplex noise using permutation table
// Returns value in [-1, 1]
function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

const GRAD3: number[][] = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

export class TerrainNoise {
  private perm: Uint8Array;
  // Flat Int8Array: gradPFlat[i*3..i*3+2] = gradient components.
  // Avoids pointer-chasing through number[][] in the noise3 hot loop.
  private gradPFlat: Int8Array;
  readonly params: TerrainParams;

  constructor(seed: number, params: TerrainParams) {
    this.params = params;
    this.perm = new Uint8Array(512);
    this.gradPFlat = new Int8Array(512 * 3);

    // Build permutation table from seed
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;

    // Fisher-Yates shuffle using seed
    let s = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }

    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      const g = GRAD3[this.perm[i] % 12];
      this.gradPFlat[i * 3]     = g[0];
      this.gradPFlat[i * 3 + 1] = g[1];
      this.gradPFlat[i * 3 + 2] = g[2];
    }
  }

  private dot3f(i: number, x: number, y: number, z: number): number {
    const b = i * 3;
    return this.gradPFlat[b] * x + this.gradPFlat[b + 1] * y + this.gradPFlat[b + 2] * z;
  }

  // 3D Perlin noise in [-1, 1]
  protected noise3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = fade(x), v = fade(y), w = fade(z);

    const perm = this.perm;

    const A  = perm[X]     + Y;
    const AA = perm[A]     + Z;
    const AB = perm[A + 1] + Z;
    const B  = perm[X + 1] + Y;
    const BA = perm[B]     + Z;
    const BB = perm[B + 1] + Z;

    return lerp(
      lerp(
        lerp(this.dot3f(AA,   x,   y,   z), this.dot3f(BA,   x-1, y,   z), u),
        lerp(this.dot3f(AB,   x,   y-1, z), this.dot3f(BB,   x-1, y-1, z), u),
        v
      ),
      lerp(
        lerp(this.dot3f(AA+1, x,   y,   z-1), this.dot3f(BA+1, x-1, y,   z-1), u),
        lerp(this.dot3f(AB+1, x,   y-1, z-1), this.dot3f(BB+1, x-1, y-1, z-1), u),
        v
      ),
      w
    );
  }

  // Returns height offset in meters for a unit sphere point
  getHeight(pt: THREE.Vector3): number {
    const { noiseType, amplitude, sharpness, offset, period, persistence, lacunarity, octaves } = this.params;
    // pt is a unit sphere point; multiply by sphereRadius so that `period` metres
    // of arc maps to 1.0 in noise space (i.e., a full noise period = `period` metres).
    const scale = (this.params.sphereRadius ?? 1) / period;
    const x = pt.x * scale, y = pt.y * scale, z = pt.z * scale;

    let h: number;

    if (noiseType === NoiseType.Simplex) {
      h = this.noise3(x, y, z);
      h = Math.pow(Math.max(0, (h + 1) / 2), sharpness);
    } else if (noiseType === NoiseType.Fractal) {
      let value = 0, amp = 1, freq = 1, maxAmp = 0;
      for (let i = 0; i < octaves; i++) {
        value += this.noise3(x * freq, y * freq, z * freq) * amp;
        maxAmp += amp;
        amp *= persistence;
        freq *= lacunarity;
      }
      h = value / maxAmp; // [-1,1]
      h = Math.pow(Math.max(0, (h + 1) / 2), sharpness);
    } else { // Ridged
      let value = 0, amp = 1, freq = 1, maxAmp = 0;
      for (let i = 0; i < octaves; i++) {
        const n = this.noise3(x * freq, y * freq, z * freq);
        value += Math.pow(Math.max(0, 1 - Math.abs(n)), sharpness) * amp;
        maxAmp += amp;
        amp *= persistence;
        freq *= lacunarity;
      }
      h = value / maxAmp;
    }

    return amplitude * h + offset * amplitude;
  }

  // Cheaper 4-octave version for vegetation placement where precision is unimportant.
  getHeightFast(pt: THREE.Vector3): number {
    const { noiseType, amplitude, sharpness, offset, period, persistence, lacunarity } = this.params;
    const fastOctaves = Math.min(4, this.params.octaves);
    const scale = (this.params.sphereRadius ?? 1) / period;
    const x = pt.x * scale, y = pt.y * scale, z = pt.z * scale;
    let h: number;
    if (noiseType === NoiseType.Simplex) {
      h = this.noise3(x, y, z);
      h = Math.pow(Math.max(0, (h + 1) / 2), sharpness);
    } else if (noiseType === NoiseType.Fractal) {
      let value = 0, amp = 1, freq = 1, maxAmp = 0;
      for (let i = 0; i < fastOctaves; i++) {
        value += this.noise3(x * freq, y * freq, z * freq) * amp;
        maxAmp += amp; amp *= persistence; freq *= lacunarity;
      }
      h = Math.pow(Math.max(0, (value / maxAmp + 1) / 2), sharpness);
    } else {
      let value = 0, amp = 1, freq = 1, maxAmp = 0;
      for (let i = 0; i < fastOctaves; i++) {
        const n = this.noise3(x * freq, y * freq, z * freq);
        value += Math.pow(Math.max(0, 1 - Math.abs(n)), sharpness) * amp;
        maxAmp += amp; amp *= persistence; freq *= lacunarity;
      }
      h = value / maxAmp;
    }
    return amplitude * h + offset * amplitude;
  }

  private _worldPt = new THREE.Vector3();

  getHeightWorld(worldPos: THREE.Vector3): number {
    const len = worldPos.length();
    if (len < 1e-6) return 0;
    return this.getHeight(this._worldPt.copy(worldPos).divideScalar(len));
  }

  getCaveDensity(wx: number, wy: number, wz: number): number {
    const scale = 1 / PLANET.caveNoisePeriodM;
    const n1 = this.noise3(wx * scale,                          wy * scale,                          wz * scale);
    const n2 = this.noise3(wx * scale * PLANET.caveNoiseFreq2,  wy * scale * PLANET.caveNoiseFreq2,  wz * scale * PLANET.caveNoiseFreq2) * PLANET.caveNoiseWeight2;
    // Denominator = 1 + caveNoiseWeight2 + caveDensityBias so range stays [0,1]
    return (n1 + n2 + PLANET.caveDensityBias) / (1 + PLANET.caveNoiseWeight2 + PLANET.caveDensityBias);
  }
}
