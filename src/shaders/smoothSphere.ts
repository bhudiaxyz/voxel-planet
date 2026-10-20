// Voxel-sphere far-field shader.
// Displacement and normals are CPU-baked once into vertex attributes.
// The vertex shader is a pure pass-through — no per-frame noise on GPU.

export const SMOOTH_SPHERE_VERTEX: string = /* glsl */ `
attribute float aVHeight;      // normalised [0,1] biome height (baked)
attribute float aVRawHeight;   // quantised metres (baked)
attribute vec3  aVSphereNormal; // original outward sphere normal (baked)

varying float vHeight;
varying float vRawHeight;
varying vec3  vNormal;
varying vec3  vWorldPos;
varying vec3  vSphereNormal;

#include <fog_pars_vertex>

void main() {
  vHeight       = aVHeight;
  vRawHeight    = aVRawHeight;
  vSphereNormal = aVSphereNormal;
  vNormal       = normalize(mat3(modelMatrix) * normal);

  vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos4.xyz;

  vec4 mvPosition = viewMatrix * worldPos4;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const SMOOTH_SPHERE_FRAGMENT: string = /* glsl */ `
uniform vec3  uOceanColor;
uniform vec3  uBeachColor;
uniform vec3  uGrasslandColor;
uniform vec3  uMountainColor;
uniform vec3  uSnowColor;
uniform float uBeachTransition;
uniform float uGrasslandTransition;
uniform float uMountainTransition;
uniform float uSnowTransition;
uniform float uOceanBeachBlend;
uniform float uBeachGrasslandBlend;
uniform float uGrasslandMountainBlend;
uniform float uMountainSnowBlend;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbientColor;
uniform vec3  uGroundBounceColor;
uniform float uNight;
uniform float uWaterLevel;   // normalised vHeight at waterLevel — ocean areas painted from palette
uniform vec3  uOceanDeep;    // from OCEAN.deepColor in defaults.json
uniform vec3  uOceanShallow; // from OCEAN.shallowColor in defaults.json

varying float vHeight;
varying float vRawHeight;
varying vec3  vNormal;
varying vec3  vWorldPos;
varying vec3  vSphereNormal;

#include <fog_pars_fragment>

// Hard-step biome colours — no smooth blending, sharp block-colour boundaries
vec3 biomeLayers(float h) {
  vec3 c = uOceanColor;
  c = mix(c, uBeachColor, step(uBeachTransition, h));
  c = mix(c, uGrasslandColor, step(uGrasslandTransition, h));
  c = mix(c, uMountainColor, step(uMountainTransition, h));
  c = mix(c, uSnowColor, step(uSnowTransition, h));
  return c;
}

void main() {
  vec3 N       = normalize(vNormal);
  vec3 sphereN = normalize(vSphereNormal);

  // How much this face points "up" (outward from sphere) vs sideways.
  // 1.0 = pure top face, 0.0 = pure cliff/side face.
  float topness = max(0.0, dot(N, sphereN));

  // Ocean areas: colors come from OCEAN.deepColor / shallowColor in defaults.json
  if (vHeight < uWaterLevel) {
    float depth = 1.0 - clamp(vHeight / max(uWaterLevel, 0.001), 0.0, 1.0);
    vec3 oceanCol = mix(uOceanShallow, uOceanDeep, depth * 0.85);
    float NdotL0 = max(dot(N, normalize(uSunDir)), 0.0);
    float sun0 = mix(NdotL0, 0.0, uNight);
    vec3 lit0 = oceanCol * (uAmbientColor + (vec3(1.0) - uAmbientColor) * uSunColor * sun0);
    gl_FragColor = vec4(lit0, 1.0);
    #include <fog_fragment>
    return;
  }

  // Top-face colour: hard biome step
  vec3 topColor  = biomeLayers(vHeight);

  // Side-face colour: warm earthy palette matching the painterly blockAtlas
  float stoneBlend = smoothstep(0.3, 0.7, vHeight);
  vec3  dirtColor  = vec3(0.608, 0.420, 0.220);  // #9B6B38 warm ochre earth
  vec3  stoneColor = vec3(0.659, 0.643, 0.549);  // #A8A48C warm buff-gray
  vec3  sideColor  = mix(dirtColor, stoneColor, stoneBlend) * 0.82;

  // Blend: faces tilted > ~50° from sphere normal become side faces
  float t      = smoothstep(0.3, 0.55, topness);
  vec3  albedo = mix(sideColor, topColor, t);

  // Voxel AO hint: darken pixels right at a step edge.
  float dh = abs(dFdx(vRawHeight)) + abs(dFdy(vRawHeight));
  float edgeAO = 1.0 - smoothstep(0.0, 0.5, dh) * 0.25;
  albedo *= edgeAO;

  // Lighting
  vec3 sunDir       = normalize(uSunDir);
  float NdotL       = max(dot(N, sunDir), 0.0);
  float sunStrength = mix(NdotL, 0.0, uNight);

  vec3 ambient  = uAmbientColor;
  vec3 diffuse  = (vec3(1.0) - ambient) * uSunColor * sunStrength;
  // Ground bounce: warm fill from planet interior direction (matches voxel chunks)
  float bounceDot = max(0.0, dot(N, -normalize(vWorldPos)));
  vec3 bounce     = uGroundBounceColor * bounceDot * 0.12 * (1.0 - uNight * 0.6);

  vec3 lit = albedo * (ambient + diffuse + bounce);

  // Painterly warm-light / cool-shadow inking on far terrain
  float inkNL     = smoothstep(0.05, 0.65, NdotL) * (1.0 - uNight * 0.85);
  vec3  warmTint  = mix(vec3(0.98, 1.01, 1.04), vec3(1.10, 1.04, 0.92), smoothstep(0.50, 0.95, inkNL));
  vec3  inkShadow = vec3(0.18, 0.28, 0.36) * (0.85 + albedo.g * 0.20);
  lit = mix(inkShadow * lit * 2.2, lit * warmTint, inkNL * 0.65 + 0.35);

  gl_FragColor = vec4(lit, 1.0);

  #include <fog_fragment>
}
`;
