/**
 * Water — the translucent sea sphere with a per-pixel wave normal shader.
 *
 * Purpose
 *   Draws the ocean as one sphere at sea level (SPHERE_WATER_RADIUS, just under the layer-11
 *   voxel tops to avoid z-fighting with shoreline faces). Fresh water (rivers, lakes) is voxels
 *   (rivers.ts), not this. Three things make it read as water rather than a blue sheet:
 *
 *   1. A real surface normal, per pixel, from the analytic gradient of a 3D plane-wave field
 *      (waveGrad: four waves, directions spread over 3D so none is seen edge-on). Everything
 *      angular hangs off it, the sun glint and the fresnel, so they agree. The field lives in
 *      3D and is sampled on the sphere, so it has no seams or stretching (the old XZ projection
 *      streaked into vertical lines along the equator). Waves are NOT displaced in the vertex
 *      shader: sphere vertices sit ~17 units apart, longer than the waves, so it only aliased.
 *   2. Depth blending by Beer-Lambert absorption along the ACTUAL view ray, not a lookup keyed
 *      on position. Path length is what the eye reads as depth and it grows toward the horizon,
 *      so far water darkens and near shallows stay clear from the same surface.
 *   3. Per-channel extinction (uExtinction), so depth is a hue shift, not a fade to grey. Red
 *      goes first, which is why deep water turns blue-green and a one-colour lerp never
 *      convinces.
 *
 * Operations
 *   - Fragment shader: wave gradient -> tilted normal N; depth from the shore map
 *     (shoreDist: shallows near land, up to 1.6x deep out at sea; without a map, flat uSeaDepth);
 *     colour shoal -> shallow -> deep by depth; caustics on a tangent plane, strongest in
 *     shallows; sky reflection by fresnel (no real reflections, they would fight the flat
 *     pastel look); sun specular from N; alpha clear in shallows, opaque offshore.
 *   - WATER_DETAIL (tiers other than low / very-low): fine ripples (rippleGrad, faded with
 *     distance), a broad sun path on the swell, and glitter cells near the mirror angle. A few
 *     ALU ops per pixel.
 *   - The sun glint is hidden once the sun is below the LOCAL horizon (sunUp from dot(up, sun)).
 *     Far waves are calmed by distance so sub-pixel waves don't sparkle.
 *   - USE_SHORE_FOAM (foam flag + shore map): two animated bands roll in toward the shore plus a
 *     steady lip, broken by noise and faded with camera distance.
 *   - Night: uNight dims the sea to blue-black with a faint sheen on crests (the shader is
 *     unlit; its colours are the daytime palette).
 *   - Geometry: SphereGeometry, 128 segments on 'high' else 64, FrontSide, depthWrite off,
 *     polygon offset against the terrain.
 *   - Draw order: in the OPAQUE list (transparent: false) with explicit CustomBlending, at
 *     renderOrder 1 — after the terrain (0), before the vegetation (2). Vegetation writes no
 *     depth, so as a transparent material the sea drew after it and painted over every reed or
 *     shrub standing in front of sea-level water (coasts, river mouths, sea-level ponds).
 *
 * Usage
 *   const w = createSphereWater(tier, shoreMap, foam); scene.add(w.mesh);  (world.ts, with the
 *   bakeShoreMap texture or null on 'very-low'.) Per frame, main.ts calls
 *   w.update(dt, nightFactor), which advances uTime, sets uNight and re-reads the WATER / SKY /
 *   LIGHT palette colours, then main.ts writes uSunDir and uSunColor live from the day/night
 *   cycle and atmosphere (w.material.uniforms). w.planetUnis exposes the uniforms.
 *
 * See also: distance-maps.ts (SHORE_GLSL, bakeShoreMap), world.ts, core/palette.ts (WATER, SKY,
 * LIGHT); DESIGN.md "8. Water".
 */

import * as THREE from 'three';
import { SHORE_GLSL } from './distance-maps';
import { WATER, SKY, LIGHT } from '../core/palette';
import { PLANET_RADIUS } from '../core/voxel';

const SEA_LAYER_SPHERE = 11;
// Radius sits just below layer-9 voxel bases (350+9=359) to avoid z-fighting
// with shoreline voxel side faces at grazing angles.
const SPHERE_WATER_RADIUS = PLANET_RADIUS + SEA_LAYER_SPHERE - 0.5;

// Shared noise + analytic wave field (fragment shader).
const WAVE_GLSL = /* glsl */ `
  float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
  float n2(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
  }
  // World-space gradient of the wave height: plane waves in 3D, sampled on the
  // sphere. Directions are spread over 3D so no region sees them edge-on.
  vec3 waveGrad(vec3 p, float t) {
    vec3 d0 = normalize(vec3( 1.00,  0.34,  0.62));
    vec3 d1 = normalize(vec3(-0.42,  1.00, -0.70));
    vec3 d2 = normalize(vec3( 0.83, -0.72,  0.95));
    vec3 d3 = normalize(vec3(-0.91, -0.55, -0.38));
    float k0 = 0.34, k1 = 0.51, k2 = 1.07, k3 = 1.93;
    float a0 = 0.21,  a1 = 0.14,  a2 = 0.06,  a3 = 0.025;
    float s0 = 0.62, s1 = 0.83, s2 = 1.34, s3 = 2.05;
    return a0*k0*cos(dot(d0, p)*k0 + t*s0)*d0 + a1*k1*cos(dot(d1, p)*k1 + t*s1)*d1
         + a2*k2*cos(dot(d2, p)*k2 + t*s2)*d2 + a3*k3*cos(dot(d3, p)*k3 + t*s3)*d3;
  }
  // Fine wind ripples (WATER_DETAIL tiers), faded out with distance before they alias.
  vec3 rippleGrad(vec3 p, float t) {
    vec3 e0 = normalize(vec3( 0.3,  0.9, -0.5));
    vec3 e1 = normalize(vec3(-0.8,  0.2,  0.6));
    vec3 e2 = normalize(vec3( 0.5, -0.6, -0.7));
    return 0.012*3.7*cos(dot(e0, p)*3.7 + t*2.6)*e0 + 0.008*6.1*cos(dot(e1, p)*6.1 - t*3.4)*e1
         + 0.004*9.4*cos(dot(e2, p)*9.4 + t*4.1)*e2;
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
        // Drawn in the OPAQUE list (transparent: false) with explicit alpha blending, so it
        // renders right after the terrain (renderOrder 0) and BEFORE the vegetation
        // (renderOrder 2). Vegetation writes no depth; as a transparent material the sea drew
        // after it and painted over every reed, grass tuft or shrub standing in front of
        // sea-level water (coasts, river mouths, ponds carved to sea level). CustomBlending is
        // used because three forces NoBlending for NormalBlending on non-transparent materials.
        transparent: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
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
                // Extinction tuned for sphere sea depth = 11 layers (SEA_LAYER_SPHERE) (not flat-world ~30).
                // WATER.extinction [0.95, 0.72, 0.42] kills all colour at this depth.
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
                /** 0 day .. 1 midnight (DayNight.getNightFactor). */
                uNight: { value: 0 },
            },
        ]),
        defines: {
            ...(shoreMap ? { USE_SHORE_MAP: 1 } : {}),
            ...(foam && shoreMap ? { USE_SHORE_FOAM: 1 } : {}),
            // Ripples, sun path and glitter: a few ALU ops per sea pixel.
            ...(tier !== 'low' && tier !== 'very-low' ? { WATER_DETAIL: 1 } : {}),
        },
        vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
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
      uniform float uNight;
      uniform vec3 uExtinction;
      varying vec3 vWorld;

      ${WAVE_GLSL}
      #ifdef USE_SHORE_MAP
        ${SHORE_GLSL}
      #endif
      #ifdef USE_SHORE_FOAM
        uniform vec3 uFoamColor;
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
        vec3 up = normalize(vWorld);
        float dist = length(cameraPosition - vWorld);
        vec3 g = waveGrad(vWorld, uTime);
        #ifdef WATER_DETAIL
          g += rippleGrad(vWorld, uTime) * (1.0 - smoothstep(30.0, 120.0, dist));
        #endif
        // Calm the far sea: sub-pixel waves there only sparkle.
        g *= 1.0 - 0.6 * smoothstep(250.0, 900.0, dist);
        vec3 N = normalize(up - (g - up * dot(g, up)));
        vec3 V = normalize(cameraPosition - vWorld);
        float NdotV = max(dot(N, V), 0.0);

        // Depth from the shore-distance map: 0 at the waterline, rising offshore.
        // Grazing views see through more water, so the path lengthens toward the horizon.
        #ifdef USE_SHORE_MAP
          float shore = shoreDist(up);                    // 0 at the coast .. 1 far out
          float depth = uSeaDepth * mix(0.12, 1.6, smoothstep(0.0, 0.9, shore));
        #else
          float shore = 1.0;
          float depth = uSeaDepth;
        #endif
        depth *= 1.0 + (1.0 - NdotV) * 0.8;
        vec3 ext = exp(-uExtinction * depth);

        // Shoal (sandy, clear) -> shallow (teal) -> deep (ocean blue), by real depth.
        float dt = clamp(depth / (uSeaDepth * 1.6), 0.0, 1.0);
        vec3 waterCol = mix(uShoal, uShallow, smoothstep(0.0, 0.35, dt));
        waterCol = mix(waterCol, uDeep, smoothstep(0.3, 1.0, dt));
        waterCol *= mix(vec3(1.0), ext, 0.6);

        // Caustics on a sphere-safe plane (the tangent frame), strongest in the shallows.
        vec3 cT = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec2 cUV = vec2(dot(vWorld, cT), dot(vWorld, cross(up, cT)));
        float caustic = causticWeb(cUV * 0.5, uTime) * uCaustic * (1.0 - smoothstep(0.05, 0.6, shore));
        waterCol += caustic * 0.35;

        // Sky reflection keyed on the LOCAL up, not world Y.
        float fresnel = pow(1.0 - NdotV, 5.0);
        vec3 skyRef = mix(uHorizon, uSky, max(dot(N, up), 0.0));
        waterCol = mix(waterCol, skyRef * uReflect, fresnel * 0.6);

        vec3 H = normalize(V + uSunDir);
        float NdotH = max(dot(N, H), 0.0);
        // No glint once the sun is below the LOCAL horizon.
        float sunUp = smoothstep(-0.05, 0.12, dot(up, uSunDir));
        float spec = pow(NdotH, 80.0) * 2.0;
        #ifdef WATER_DETAIL
          // Broad sun path on the swell, and glitter: cells that flash only
          // where the surface is close to the mirror angle.
          spec += pow(NdotH, 14.0) * 0.12;
          float cell = h21(floor(cUV * 2.5) + floor(uTime * 4.0) * 17.0);
          spec += step(0.92, cell) * smoothstep(0.96, 0.995, NdotH) * 1.5 * (1.0 - smoothstep(40.0, 150.0, dist));
        #endif
        spec *= sunUp;
        waterCol += uSunColor * spec;

        // Clear in the shallows (the seabed shows through), opaque out at sea.
        float alpha = mix(uOpacity * 0.55, uOpacity, smoothstep(0.0, 0.5, shore)) + fresnel * 0.3;

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

        // Night: the sea is unlit (its colours are the palette's daytime ones), so
        // dim it with the sky — deep blue-black, a cool tint, and a faint sheen
        // left on the brightest wave crests so it still reads as water.
        {
          float nightDim = mix(1.0, 0.07, uNight);
          float sheen = smoothstep(0.55, 1.0, fresnel + spec * 0.5) * 0.06 * uNight;
          waterCol = waterCol * nightDim * mix(vec3(1.0), vec3(0.75, 0.85, 1.15), uNight) + vec3(0.55, 0.65, 0.85) * sheen;
        }
        gl_FragColor = vec4(waterCol, alpha);
        #include <fog_fragment>
      }
    `,
    });

    const mesh = new THREE.Mesh(geo, mat);
    // After terrain (0), before vegetation (2): see the material comment above.
    mesh.renderOrder = 1;
    const planetUnis: any[] = [mat.uniforms];

    return {
        mesh,
        material: mat,
        planetUnis,
        update(_dt: number, night = 0) {
            mat.uniforms.uTime.value += _dt;
            mat.uniforms.uNight.value = night;
            mat.uniforms.uShoal.value.copy(WATER.shoal);
            mat.uniforms.uShallow.value.copy(WATER.shallow);
            mat.uniforms.uDeep.value.copy(WATER.deep);
            mat.uniforms.uSunDir.value.copy(LIGHT.sunDir).normalize();
            mat.uniforms.uHorizon.value.copy(SKY.horizon);
            mat.uniforms.uSky.value.copy(SKY.zenith);
        },
    };
}
