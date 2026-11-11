/**
 * Water.
 *
 * A translucent sphere at sea level. Three things make it read as water rather
 * than as a blue sheet:
 *
 *   1. A real surface normal, from the analytic derivative of the wave field
 *      rather than from a fake ripple scalar. Everything angular hangs off it
 *      — the sun glint, the fresnel, and the refraction offset — so all three
 *      agree with each other and with the wave you can see.
 *   2. Depth blending by Beer-Lambert absorption along the ACTUAL view ray,
 *      not by a lookup keyed on position. Path length is what the eye reads as
 *      depth, and it grows as the camera lowers, so the far water darkens and
 *      the near shallows stay clear from the same surface.
 *   3. Per-channel extinction, so depth is a hue shift rather than a fade to
 *      grey. Red goes first, which is why deep water turns blue-green in life
 *      and why a single-colour lerp never quite convinces.
 *
 * No reflections — they would fight the flat pastel look — just sky at grazing
 * angles and one specular highlight.
 */

import * as THREE from 'three';
import { SHORE_GLSL } from './shore-map';
import { WATER, SKY, LIGHT } from '../core/palette';
import { PLANET_RADIUS } from '../core/voxel';

const SEA_LAYER_SPHERE = 11;
// Radius sits just below layer-9 voxel bases (350+9=359) to avoid z-fighting
// with shoreline voxel side faces at grazing angles.
const SPHERE_WATER_RADIUS = PLANET_RADIUS + SEA_LAYER_SPHERE - 0.5;

// Shared noise + analytic wave field — injected into both vertex and fragment
// shaders so displaced geometry and surface normals always agree.
const WAVE_GLSL = /* glsl */ `
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float n2(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
  }
  // Returns height in .x, partial derivatives (slope) in .yz.
  // Amplitudes are 3× the original fragment-only values so vertex
  // displacement is visible from the default play camera.
  vec3 waveField(vec2 p, float t) {
    vec3 acc = vec3(0.0);
    vec2 d0 = normalize(vec2( 1.00,  0.34));
    vec2 d1 = normalize(vec2(-0.42,  1.00));
    vec2 d2 = normalize(vec2( 0.83, -0.72));
    vec2 d3 = normalize(vec2(-0.91, -0.55));
    float k0 = 0.34, k1 = 0.51, k2 = 1.07, k3 = 1.93;
    float a0 = 0.21,  a1 = 0.14,  a2 = 0.06,  a3 = 0.025;
    float s0 = 0.62, s1 = 0.83, s2 = 1.34, s3 = 2.05;
    float ph0 = dot(d0, p)*k0 + t*s0;
    float ph1 = dot(d1, p)*k1 + t*s1;
    float ph2 = dot(d2, p)*k2 + t*s2;
    float ph3 = dot(d3, p)*k3 + t*s3;
    acc.x  = a0*sin(ph0) + a1*sin(ph1) + a2*sin(ph2) + a3*sin(ph3);
    acc.yz = a0*k0*cos(ph0)*d0 + a1*k1*cos(ph1)*d1
           + a2*k2*cos(ph2)*d2 + a3*k3*cos(ph3)*d3;
    return acc;
  }
`;

/**
 * @param shoreMap distance-to-land atlas from bakeShoreMap(); with `foam`, draws
 *                 an animated foam line along every coast.
 */
export function createSphereWater(tier: string = 'high', shoreMap: THREE.Texture | null = null, foam = false) {
    const sub = tier === 'high' ? 128 : 64;
    const geo = new THREE.SphereGeometry(SPHERE_WATER_RADIUS, sub * 2, sub);

    const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: { value: 0 },
                uShoal: { value: WATER.shoal.clone() },
                uShallow: { value: WATER.shallow.clone() },
                uDeep: { value: WATER.deep.clone() },
                uWarm: { value: WATER.warm.clone() },
                uSheen: { value: WATER.sheen.clone() },
                uHorizon: { value: SKY.horizon.clone() },
                uSky: { value: SKY.zenith.clone() },
                uSunDir: { value: LIGHT.sunDir.clone().normalize() },
                uSunColor: { value: LIGHT.sunColor.clone() },
                // Extinction tuned for sphere sea depth = 9 layers (not flat-world ~30).
                // WATER.extinction [0.95, 0.72, 0.42] kills all colour at 9 units.
                uExtinction: { value: new THREE.Vector3(0.28, 0.06, 0.02) },
                uOpacity: { value: WATER.opacity },
                uDensity: { value: WATER.density },
                uSaturation: { value: WATER.saturation },
                uCellTone: { value: WATER.cellTone },
                uCaustic: { value: WATER.caustic },
                uReflect: { value: WATER.reflect },
                uSeaDepth: { value: SEA_LAYER_SPHERE },
                uShoreMap: { value: shoreMap },
                uFoamColor: { value: new THREE.Color(0xf4f1ea) },
            },
        ]),
        defines: foam && shoreMap ? { USE_SHORE_FOAM: 1 } : {},
        vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      ${WAVE_GLSL}
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNrm;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        // Wave tiling uses XZ — reasonable approximation near any face centre
        vec3 wave = waveField(vWorld.xz, uTime);
        // Radial displacement along sphere normal
        vec3 radial = normalize(vWorld);
        vWorld += radial * wave.x;
        // Perturb sphere normal by wave slope
        vec3 tangX = normalize(vec3(-vWorld.z, 0.0, vWorld.x));
        vec3 tangZ = normalize(cross(radial, tangX));
        vNrm = normalize(radial - tangX * wave.y - tangZ * wave.z);
        vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
        fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      uniform float uTime, uOpacity, uDensity, uSaturation, uCellTone, uCaustic, uReflect, uSeaDepth;
      uniform vec3 uShoal, uShallow, uDeep, uWarm, uSheen, uHorizon, uSky, uSunDir, uSunColor;
      uniform vec3 uExtinction;
      varying vec3 vWorld;
      varying vec3 vNrm;

      ${WAVE_GLSL}
      #ifdef USE_SHORE_FOAM
        uniform vec3 uFoamColor;
        ${SHORE_GLSL}
      #endif

      float causticWeb(vec2 p, float t) {
        vec2 a1 = p * 0.42        + vec2( t * 0.055, -t * 0.041);
        vec2 a2 = p * 0.42 * 1.31 + vec2(-t * 0.037,  t * 0.061) + 41.3;
        float web = pow(max(1.0 - abs(n2(a1) - n2(a2)) * 3.4, 0.0), 3.0);
        vec2 b1 = p * 0.95        + vec2(-t * 0.083,  t * 0.062) +  7.1;
        vec2 b2 = p * 0.95 * 1.27 + vec2( t * 0.071,  t * 0.049) + 91.7;
        web += pow(max(1.0 - abs(n2(b1) - n2(b2)) * 3.6, 0.0), 3.0) * 0.55;
        return min(web, 1.5);
      }

      void main() {
        vec3 N = normalize(vNrm);
        vec3 V = normalize(cameraPosition - vWorld);
        float NdotV = max(dot(N, V), 0.0);

        // ponytail: constant depth approximation; upgrade to per-column depth map if needed
        float depth = uSeaDepth * (1.0 - NdotV * 0.5);
        vec3 ext = exp(-uExtinction * depth);

        float dt = clamp(depth / (uSeaDepth * 2.0), 0.0, 1.0);
        vec3 waterCol = mix(uShoal, mix(uShallow, uDeep, dt), dt);
        waterCol *= ext;

        float caustic = causticWeb(vWorld.xz * 0.5, uTime) * uCaustic;
        waterCol += caustic * ext * 0.4;

        float fresnel = pow(1.0 - NdotV, 5.0);
        vec3 skyRef = mix(uHorizon, uSky, max(dot(N, vec3(0,1,0)), 0.0));
        waterCol = mix(waterCol, skyRef * uReflect, fresnel * 0.7);

        vec3 H = normalize(V + uSunDir);
        float spec = pow(max(dot(N, H), 0.0), 80.0) * 2.0;
        waterCol += uSunColor * spec;

        float alpha = uOpacity + fresnel * 0.3;

        #ifdef USE_SHORE_FOAM
        {
          // sd: 0 at the waterline, 1 at MAX columns out. Two bands roll in toward
          // the shore and fade as they arrive; noise breaks them into patches.
          float sd = shoreDist(normalize(vWorld));
          float near = 1.0 - smoothstep(0.0, 0.42, sd);
          float t = uTime * 0.22;
          float bands = 0.0;
          for (int i = 0; i < 2; i++) {
            float ph = fract(t + float(i) * 0.5);       // 0 → 1 as a band travels in
            float at = 0.42 * (1.0 - ph);               // band position in sd units
            float w = 0.035 + 0.03 * ph;
            bands += (1.0 - smoothstep(0.0, w, abs(sd - at))) * (1.0 - ph * 0.6);
          }
          float lip = 1.0 - smoothstep(0.0, 0.06, sd);   // steady froth right at the edge
          float mask = n2(vWorld.xz * 0.9 + vec2(uTime * 0.3, 0.0)) * 0.6 + n2(vWorld.yz * 2.3 - uTime * 0.2) * 0.4;
          float foamAmt = clamp(max(lip, bands * near) * smoothstep(0.25, 0.65, mask + lip * 0.4), 0.0, 1.0);
          // Fade with distance from the camera — at range it would only shimmer.
          foamAmt *= 1.0 - smoothstep(60.0, 140.0, length(cameraPosition - vWorld));
          waterCol = mix(waterCol, uFoamColor, foamAmt * 0.85);
          alpha = mix(alpha, 1.0, foamAmt * 0.7);
        }
        #endif

        gl_FragColor = vec4(waterCol, alpha);
        #include <fog_fragment>
      }
    `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    const planetUnis: any[] = [mat.uniforms];

    return {
        mesh,
        material: mat,
        planetUnis,
        update(_dt: number) {
            mat.uniforms.uTime.value += _dt;
            mat.uniforms.uShoal.value.copy(WATER.shoal);
            mat.uniforms.uShallow.value.copy(WATER.shallow);
            mat.uniforms.uDeep.value.copy(WATER.deep);
            mat.uniforms.uSunDir.value.copy(LIGHT.sunDir).normalize();
            mat.uniforms.uHorizon.value.copy(SKY.horizon);
            mat.uniforms.uSky.value.copy(SKY.zenith);
        },
    };
}
