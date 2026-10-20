import * as THREE from 'three';
import type { SharedEnvUniforms } from '../planet/Environment';

/**
 * Patch a MeshLambertMaterial with vertex-shader wind sway via onBeforeCompile.
 *
 * @param amplitude  Peak displacement in metres at the tip.
 * @param exponent   Height curve exponent. 1.0 = linear (grass/undergrowth).
 *                   Higher values (e.g. 2.5) keep the base rigid and concentrate
 *                   movement at the tip — use for trees.
 * @param heightRef  Normalisation height (metres). Vertices above this are clamped
 *                   to full sway. Default 1.0 (no normalisation) is fine for short
 *                   plants; set to ~tree height so exponent is meaningful.
 */
export function applyWindSway(
  mat: THREE.MeshLambertMaterial,
  env: SharedEnvUniforms,
  amplitude = 0.08,
  exponent  = 1.0,
  heightRef = 1.0,
): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime         = env.uTime;
    shader.uniforms.uWindDir      = env.uWindDir;
    shader.uniforms.uWindStrength = env.uWindStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec2  uWindDir;
uniform float uWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  float _swayPhase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
#else
  float _swayPhase = 0.0;
#endif
  // Normalised height [0,1], then raised to exponent: keeps base rigid, tip free
  float _hNorm = clamp(transformed.y / ${heightRef.toFixed(2)}, 0.0, 1.0);
  float _hCurve = pow(_hNorm, ${exponent.toFixed(2)});
  float _sway = (sin(uTime * 1.4 + _swayPhase) + sin(uTime * 0.55 + _swayPhase * 2.3) * 0.3)
                * uWindStrength * _hCurve * ${amplitude.toFixed(4)};
  transformed.x += uWindDir.x * _sway;
  transformed.z += uWindDir.y * _sway;`,
      );
  };
  mat.customProgramCacheKey = () => `wind-sway-${amplitude.toFixed(4)}-e${exponent.toFixed(2)}-h${heightRef.toFixed(1)}`;
}
