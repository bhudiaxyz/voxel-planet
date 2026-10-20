import * as THREE from 'three';
import { PLANET } from '../config';

export const VOXEL_CHUNK_VERTEX = /* glsl */`
  #include <fog_pars_vertex>

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vAo;
  varying vec3 vWorldPos;
  varying float vViewDist;

  attribute float color; // AO [0..1]

  void main() {
    vUv = uv;
    vAo = color;

    vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos4.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);

    vec4 mvPosition = viewMatrix * worldPos4;
    vViewDist = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

export const VOXEL_CHUNK_FRAGMENT = /* glsl */`
  #include <fog_pars_fragment>

  uniform sampler2D tAtlas;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uAmbientColor;
  uniform vec3  uGroundBounceColor;
  uniform float uNight;
  uniform float uDitherNear;
  uniform float uDitherFar;
  uniform float uPlanetRadius;
  uniform float uWaterLevel;

  varying vec2  vUv;
  varying vec3  vNormal;
  varying float vAo;
  varying vec3  vWorldPos;
  varying float vViewDist;

  // 4x4 ordered (Bayer) dither threshold in [0,1)
  float bayer4(ivec2 p) {
    const int m[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
    return float(m[(p.y & 3) * 4 + (p.x & 3)]) / 16.0;
  }

  void main() {
    // Screen-door dither fade: fragments beyond uDitherFar are invisible;
    // between uDitherNear and uDitherFar they dither in as the camera approaches.
    if (uDitherFar > 0.0) {
      float fade = 1.0 - smoothstep(uDitherNear, uDitherFar, vViewDist);
      if (fade < bayer4(ivec2(gl_FragCoord.xy))) discard;
    }
    vec4 texColor = texture2D(tAtlas, vUv);
    if (texColor.a < 0.1) discard;

    vec3 albedo = texColor.rgb;

    // Underwater tint: tint toward water colour without losing face visibility.
    float altitude = length(vWorldPos) - uPlanetRadius;
    float underwaterDepth = 0.0;
    if (altitude < uWaterLevel) {
      underwaterDepth = clamp((uWaterLevel - altitude) / 25.0, 0.0, 1.0);
      // Bright water blue — keep faces clearly visible, just tinted
      albedo = mix(albedo, vec3(0.22, 0.58, 0.74), underwaterDepth * 0.30);
    }

    vec3 N = normalize(vNormal);

    // Directional AO bias: top faces bright, sides dimmer, undersides dim.
    // dot(N, outward) = +1 top, 0 side, -1 bottom.
    float faceBias = dot(N, normalize(vWorldPos));
    float faceAO   = mix(0.68, 1.0, clamp(faceBias * 0.5 + 0.5, 0.0, 1.0));

    float sunDot = max(0.0, dot(N, uSunDir));
    // Wrap lighting for side faces (faceBias≈0): without this, sunDot=0 when the
    // sun is overhead and hillsides go near-black. Half-Lambert wrap gives them
    // partial diffuse regardless of sun angle.
    float sideBlend   = 1.0 - abs(faceBias);
    float wrapDot     = max(0.0, 0.5 + 0.5 * dot(N, uSunDir));
    float effectiveDot = mix(sunDot, wrapDot, sideBlend * 0.6);
    float sunStrength  = mix(effectiveDot, 0.0, uNight);

    vec3 ambient = uAmbientColor;
    vec3 diffuse = (vec3(1.0) - ambient) * uSunColor * sunStrength;

    // Subtle ground bounce from planet interior
    float bounceDot = max(0.0, dot(N, -normalize(vWorldPos))) * 0.12;
    vec3 bounce = uGroundBounceColor * bounceDot * (1.0 - uNight * 0.7);

    float ao = 1.0 - vAo * 0.4;

    vec3 lit = albedo * (ambient + diffuse + bounce) * ao * faceAO;

    // Painterly warm-light / cool-shadow ink (inspired by plein-air watercolour):
    //   lit surfaces: shift toward warm golden, shadow surfaces: tint cool blue-teal.
    float inkNL     = smoothstep(0.05, 0.65, effectiveDot) * (1.0 - uNight * 0.85);
    vec3  warmTint  = mix(vec3(0.98, 1.01, 1.04), vec3(1.10, 1.04, 0.92), smoothstep(0.50, 0.95, inkNL));
    vec3  inkShadow = vec3(0.18, 0.28, 0.36) * (0.85 + albedo.g * 0.20);
    lit = mix(inkShadow * lit * 2.2, lit * warmTint, inkNL * 0.50 + 0.50);

    // Hard minimum brightness for underwater/waterline faces so water opacity
    // never makes them vanish: at least 20% of their base albedo must show.
    if (underwaterDepth > 0.0) {
      lit = max(lit, albedo * mix(0.20, 0.10, underwaterDepth));
    }

    gl_FragColor = vec4(lit, texColor.a);

    #include <fog_fragment>
  }
`;

// Factory — no biome uniforms; pure atlas textures give the Minecraft look
// ditherNear/ditherFar: world-unit camera distances for the screen-door fade.
// Set ditherFar to ~90% of the chunk view radius, ditherNear to ~60%.
export function createVoxelChunkMaterial(
  atlas: THREE.Texture,
  envUniforms: {
    uSunDir:           THREE.IUniform<THREE.Vector3>;
    uSunColor:         THREE.IUniform<THREE.Color>;
    uAmbientColor:     THREE.IUniform<THREE.Color>;
    uGroundBounceColor:THREE.IUniform<THREE.Color>;
    uNight:            THREE.IUniform<number>;
  },
  ditherNear = 0,
  ditherFar  = 0,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader:   VOXEL_CHUNK_VERTEX,
    fragmentShader: VOXEL_CHUNK_FRAGMENT,
    uniforms: {
      fogColor:   { value: new THREE.Color(0x9ebccc) },
      fogNear:    { value: 1 },
      fogFar:     { value: 2000 },
      fogDensity: { value: 0.0015 },
      tAtlas:            { value: atlas },
      uSunDir:           envUniforms.uSunDir,
      uSunColor:         envUniforms.uSunColor,
      uAmbientColor:     envUniforms.uAmbientColor,
      uGroundBounceColor:envUniforms.uGroundBounceColor,
      uNight:            envUniforms.uNight,
      uDitherNear:    { value: ditherNear },
      uDitherFar:     { value: ditherFar  },
      uPlanetRadius:  { value: PLANET.radius },
      uWaterLevel:    { value: PLANET.waterLevel },
    },
    fog:  true,
    side: THREE.FrontSide,
    // Push terrain polygons back in depth so coplanar vegetation always wins
    polygonOffset:       true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits:  2,
  });
}
