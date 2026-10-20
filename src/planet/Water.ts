import * as THREE from 'three';
import type { SharedEnvUniforms } from './Environment';
import { PLANET, OCEAN, SKY } from '../config';
const SKY_REFL = SKY.oceanReflection;

const WATER_VERTEX = /* glsl */ `
#include <fog_pars_vertex>

uniform float uTime;
uniform vec2  uWindDir;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveCrest; // 0..1, high = crest (foam)

void main() {
  vec3 pos = position;
  vec3 dir = normalize(pos);

  // Primary swell: large low-frequency wave along wind direction
  vec2 wn = normalize(uWindDir + vec2(0.0001));
  float swell = sin(uTime * 0.55 + dot(pos.xz, wn) * 0.018) * 0.18
              + sin(uTime * 0.38 + dot(pos.xz, wn * 0.7) * 0.013) * 0.12;

  // Cross-chop: smaller waves perpendicular to wind
  vec2 perp = vec2(-wn.y, wn.x);
  float chop = sin(uTime * 0.92 + dot(pos.xz, perp) * 0.026 + pos.y * 0.012) * 0.07
             + sin(uTime * 1.3  + dot(pos.xz, perp * 1.3) * 0.019) * 0.04;

  // Short capillary ripple
  float ripple = sin(uTime * 2.1 + pos.x * 0.055 - pos.z * 0.04) * 0.02
               + sin(uTime * 1.7 + pos.z * 0.06  + pos.y * 0.03) * 0.015;

  float totalWave = swell + chop + ripple;
  vWaveCrest = clamp((totalWave - 0.55) / 0.5, 0.0, 1.0); // positive peak → foam

  pos += dir * totalWave;

  vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
  vNormal = normalize((modelMatrix * vec4(dir, 0.0)).xyz);

  vec4 mvPosition = viewMatrix * vec4(vWorldPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>

uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uNight;
uniform float uDawn;
uniform float uDusk;
uniform vec2  uWindDir;

uniform vec3 uDayDeepColor;
uniform vec3 uDayShallowColor;
uniform vec3 uDawnDeepColor;
uniform vec3 uDawnShallowColor;
uniform vec3 uDuskDeepColor;
uniform vec3 uDuskShallowColor;
uniform vec3 uNightDeepColor;
uniform vec3 uNightShallowColor;
uniform vec3 uDaySkyNear;
uniform vec3 uDaySkyFar;
uniform vec3 uDawnSkyNear;
uniform vec3 uDawnSkyFar;
uniform vec3 uDuskSkyNear;
uniform vec3 uDuskSkyFar;
uniform vec3 uNightSkyNear;
uniform vec3 uNightSkyFar;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vWaveCrest;

// Value noise
float h2(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float wn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y);
}
float wfbm(vec2 p) {
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=a*wn(p); p=p*2.1+vec2(7.1,13.7); a*=0.5; }
  return v;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // --- Two-layer scrolling normals for ripple detail ---
  vec2 windN  = normalize(uWindDir + vec2(0.0001));
  vec2 windP  = vec2(-windN.y, windN.x); // perpendicular

  // Primary ripple layer scrolling along wind
  vec2 uv1 = vWorldPos.xz * 0.012 + windN * uTime * 0.018;
  // Secondary cross-ripple layer at different scale + speed
  vec2 uv2 = vWorldPos.xz * 0.022 + windP * uTime * 0.011 + vec2(3.7, 1.2);

  float eps = 0.06;
  // Normal perturbation from FBM height field derivatives
  float f1  = wfbm(uv1);
  float f1x = wfbm(uv1 + vec2(eps, 0.0)) - f1;
  float f1z = wfbm(uv1 + vec2(0.0, eps)) - f1;
  float f2  = wfbm(uv2);
  float f2x = wfbm(uv2 + vec2(eps, 0.0)) - f2;
  float f2z = wfbm(uv2 + vec2(0.0, eps)) - f2;

  vec3 perturbedN = normalize(N + vec3(f1x + f2x * 0.5, 0.0, f1z + f2z * 0.5) * 3.5);

  // --- Fresnel ---
  float NdotV   = max(dot(perturbedN, V), 0.0);
  float fresnel = pow(1.0 - NdotV, 4.0);

  // --- Water colour: four-stop blend day → dawn/dusk → night ---
  // day is the residual (1 - night - dawn - dusk), clamped to avoid overshoot
  float dayW = max(0.0, 1.0 - uNight - uDawn - uDusk);
  vec3 deepColor    = uDayDeepColor    * dayW
                    + uDawnDeepColor   * uDawn
                    + uDuskDeepColor   * uDusk
                    + uNightDeepColor  * uNight;
  vec3 shallowColor = uDayShallowColor    * dayW
                    + uDawnShallowColor   * uDawn
                    + uDuskShallowColor   * uDusk
                    + uNightShallowColor  * uNight;
  vec3 waterColor   = mix(deepColor, shallowColor, 0.28 + f1 * 0.28);

  // --- Multi-lobe specular (wide glow + needle glints) ---
  vec3  H     = normalize(uSunDir + V);
  float NdotH = max(dot(perturbedN, H), 0.0);
  float spec  = pow(NdotH, 320.0) * 2.0          // sharp sun glint
              + pow(NdotH,  40.0) * 0.20          // wide aureole
              + pow(NdotH,   8.0) * 0.04;         // broad diffuse halo
  vec3 sunHighlight = uSunColor * spec * (1.0 - uNight * 0.88) * 5.5;

  // --- Sky/horizon reflection via Fresnel — four-stop blend ---
  vec3 daySkyRefl   = mix(uDaySkyNear,   uDaySkyFar,   fresnel);
  vec3 dawnSkyRefl  = mix(uDawnSkyNear,  uDawnSkyFar,  fresnel);
  vec3 duskSkyRefl  = mix(uDuskSkyNear,  uDuskSkyFar,  fresnel);
  vec3 nightSkyRefl = mix(uNightSkyNear, uNightSkyFar, fresnel);
  vec3 skyRefl = daySkyRefl  * dayW
               + dawnSkyRefl  * uDawn
               + duskSkyRefl  * uDusk
               + nightSkyRefl * uNight;
  float reflStr = fresnel * (1.0 - uNight * 0.5) * 0.55;

  // --- Subsurface scatter suggestion: brightens shallow view angles ---
  float sss = pow(max(dot(V, uSunDir), 0.0), 4.0) * 0.18 * (1.0 - uNight);

  vec3 color = waterColor * (1.0 + sss) + sunHighlight;
  color = mix(color, skyRefl, reflStr);

  // --- Foam / whitecaps at wave crests ---
  float foam = vWaveCrest * (0.5 + 0.5 * wn(vWorldPos.xz * 0.12));
  color = mix(color, vec3(0.90, 0.95, 1.00), foam * 0.60);

  // --- Night: moonlit shimmer ---
  color += vec3(0.20, 0.26, 0.38) * f2 * uNight * 0.18;

  // Slightly reduce opacity at grazing angles (more transparent edge)
  float alpha = mix(0.82, 0.96, 1.0 - fresnel * 0.5);

  gl_FragColor = vec4(color, alpha);
  #include <fog_fragment>
}
`;

/**
 * Spherical water shell at waterLevel above the planet surface.
 * Double-sided so you see it from underwater too.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private readonly waterRadius: number;

  constructor(
    scene: THREE.Scene,
    radius: number,
    waterLevel: number,
    envUniforms: SharedEnvUniforms,
  ) {
    // Raise the sphere 0.1 m above the nominal waterLevel so terrain top faces at
    // exactly floor(waterLevel) don't Z-fight with the water surface.
    this.waterRadius = radius + waterLevel + 0.1;

    this.material = new THREE.ShaderMaterial({
      vertexShader:   WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      uniforms: {
        uTime:    envUniforms.uTime,
        uSunDir:  envUniforms.uSunDir,
        uSunColor:envUniforms.uSunColor,
        uNight:   envUniforms.uNight,
        uDawn:    envUniforms.uDawn,
        uDusk:    envUniforms.uDusk,
        uWindDir: envUniforms.uWindDir,
        uDayDeepColor:      { value: new THREE.Color(...OCEAN.dayDeepColor      as [number,number,number]) },
        uDayShallowColor:   { value: new THREE.Color(...OCEAN.dayShallowColor   as [number,number,number]) },
        uDawnDeepColor:     { value: new THREE.Color(...OCEAN.dawnDeepColor     as [number,number,number]) },
        uDawnShallowColor:  { value: new THREE.Color(...OCEAN.dawnShallowColor  as [number,number,number]) },
        uDuskDeepColor:     { value: new THREE.Color(...OCEAN.duskDeepColor     as [number,number,number]) },
        uDuskShallowColor:  { value: new THREE.Color(...OCEAN.duskShallowColor  as [number,number,number]) },
        uNightDeepColor:    { value: new THREE.Color(...OCEAN.nightDeepColor    as [number,number,number]) },
        uNightShallowColor: { value: new THREE.Color(...OCEAN.nightShallowColor as [number,number,number]) },
        uDaySkyNear:        { value: new THREE.Color(...SKY_REFL.daySkyNear   as [number,number,number]) },
        uDaySkyFar:         { value: new THREE.Color(...SKY_REFL.daySkyFar    as [number,number,number]) },
        uDawnSkyNear:       { value: new THREE.Color(...SKY_REFL.dawnSkyNear  as [number,number,number]) },
        uDawnSkyFar:        { value: new THREE.Color(...SKY_REFL.dawnSkyFar   as [number,number,number]) },
        uDuskSkyNear:       { value: new THREE.Color(...SKY_REFL.duskSkyNear  as [number,number,number]) },
        uDuskSkyFar:        { value: new THREE.Color(...SKY_REFL.duskSkyFar   as [number,number,number]) },
        uNightSkyNear:      { value: new THREE.Color(...SKY_REFL.nightSkyNear as [number,number,number]) },
        uNightSkyFar:       { value: new THREE.Color(...SKY_REFL.nightSkyFar  as [number,number,number]) },
        ...THREE.UniformsLib.fog,
      },
      transparent: true,
      depthWrite:  false,
      fog:         true,
      side:        THREE.DoubleSide,
    });

    const geo = new THREE.SphereGeometry(this.waterRadius, 64, 64);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1; // draw after opaque terrain so depth test is correct
    scene.add(this.mesh);
  }

  update(_dt: number, _playerPos: THREE.Vector3): void {
    // uniforms are shared by reference — nothing to do
  }

  isUnderwater(playerPos: THREE.Vector3): boolean {
    return playerPos.length() < this.waterRadius + PLANET.underwaterMarginM;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
