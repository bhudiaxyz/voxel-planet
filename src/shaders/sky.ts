// Ported from beyond-fable sky.ts — identical shader source, works for spherical planet.
// Sun direction is a world-space vector; sky dome follows player position.

export const NOISE_GLSL: string = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p) {
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(7.1,13.7); a*=0.5; }
  return v;
}
`;

export const SKY_VERTEX: string = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

export const SKY_FRAGMENT: string = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uHazeColor;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uNight;
uniform float uCloudCover;
uniform float uCloudDark;
uniform vec2 uWind;
uniform float uStarAngle;
uniform float uGalaxyStrength;
uniform float uNebulaStrength;
uniform float uAuroraStrength;
uniform vec3 uPlayerUp;

varying vec3 vDir;

${NOISE_GLSL}

vec3 rotateAroundAxis(vec3 p, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}

float fbm3(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += noise3(p) * amplitude;
    p = p * 2.03 + vec3(7.1, 13.7, 5.9);
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  vec3 dir = normalize(vDir);
  // Use player's surface normal as "up" so horizon stays at eye level on a spherical planet
  float h = clamp(dot(dir, uPlayerUp), -1.0, 1.0);

  float zenithMix = pow(clamp(h, 0.0, 1.0), 0.5);
  vec3 sky = mix(uHorizonColor, uZenithColor, zenithMix);
  float haze = pow(1.0 - clamp(h, 0.0, 1.0), 5.0);
  sky = mix(sky, uHazeColor, haze * 0.85);

  float sunUpDot  = dot(uSunDir, uPlayerUp);
  float sunDot    = clamp(dot(dir, uSunDir), 0.0, 1.0);
  float transAmt  = 1.0 - smoothstep(0.0, 0.28, abs(sunUpDot)); // peaks at exact horizon

  // Asymmetric dawn/dusk scatter colour: dawn (sunUpDot rising, negative→positive) = cool rose;
  // dusk (sunUpDot falling, positive→negative) is not distinguishable in the shader — we use
  // the horizontal sun dot against east axis as a proxy encoded via uSunDir.x sign from CPU.
  // Instead: use sun colour which CPU already differentiates per side (warm vs cool).
  vec3 scatterColor = mix(vec3(1.0, 0.55, 0.42), uSunColor * 1.3,
                          clamp(sunUpDot * 5.0 + 0.6, 0.0, 1.0));
  // Widen scatter band at the sun side of the horizon, fade away from it
  float sunAzimuth  = clamp(dot(dir - uPlayerUp * h, uSunDir - uPlayerUp * sunUpDot) * 2.0, 0.0, 1.0);
  float horizonBand = exp(-h * h * 28.0) * transAmt * (0.38 + sunAzimuth * 0.38);
  sky += scatterColor * horizonBand;

  // Twilight belt: deep indigo band above horizon just after sunset / before sunrise
  float twilightAmt = smoothstep(0.0, -0.12, sunUpDot) * smoothstep(-0.35, -0.12, sunUpDot);
  float twilightH   = smoothstep(0.0, 0.12, h) * smoothstep(0.45, 0.18, h);
  sky = mix(sky, vec3(0.04, 0.06, 0.16), twilightH * twilightAmt * 0.55);

  // Sun disc + halo
  float horizonBoost = 1.0 + (1.0 - clamp(sunUpDot * 3.0, 0.0, 1.0)) * 2.2;
  float halo = pow(sunDot, 24.0) * 0.3 * horizonBoost + pow(sunDot, 300.0) * 0.7;
  float disc = smoothstep(0.9995, 0.9999, sunDot);
  float sunVis = smoothstep(-0.12, 0.02, sunUpDot);
  sky += uSunColor * (halo + disc * 5.0) * sunVis;

  // Crepuscular rays: cheap radial streaks from sun position during transition
  if (transAmt > 0.02 && sunDot > 0.05) {
    vec3 sunPerp = normalize(dir - uSunDir * sunDot);
    float rayAngle = atan(sunPerp.y, dot(sunPerp, cross(uSunDir, uPlayerUp)));
    float rays = (sin(rayAngle * 6.0) * 0.5 + 0.5) * (sin(rayAngle * 11.0) * 0.3 + 0.7)
               * (sin(rayAngle * 17.5 + 0.4) * 0.2 + 0.8);
    float rayCore = pow(sunDot, 5.0) * transAmt * rays * 0.18;
    sky += uSunColor * rayCore * sunVis;
  }

  // Moon disc + glow — warm tinge near horizon
  float moonDot  = clamp(dot(dir, uMoonDir), 0.0, 1.0);
  float moonUpDt = dot(uMoonDir, uPlayerUp);
  float moonHorizonTint = 1.0 - smoothstep(-0.05, 0.25, abs(moonUpDt));
  vec3  moonColor = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.88, 0.68), moonHorizonTint * 0.55);
  float moonDisc = smoothstep(0.99995, 0.999985, moonDot);
  float moonGlow = pow(moonDot, 280.0) * 0.1;
  sky += moonColor * (moonDisc * 1.15 + moonGlow) * uNight;

  float clearNight = uNight * (1.0 - uCloudCover * 0.88);
  if (clearNight > 0.01 && h > -0.08) {
    vec3 axis = vec3(0.0, 1.0, 0.0);
    vec3 celestial = rotateAroundAxis(dir, axis, -uStarAngle);

    vec3 galaxyNormal = normalize(vec3(0.42, 0.32, 0.85));
    vec3 galaxyTangent = normalize(cross(galaxyNormal, vec3(0.0, 1.0, 0.0)));
    vec3 galaxyBitangent = cross(galaxyNormal, galaxyTangent);
    float latitude = dot(celestial, galaxyNormal);
    float longitude = atan(dot(celestial, galaxyBitangent), dot(celestial, galaxyTangent));

    float toCore = cos(longitude - 0.85) * 0.5 + 0.5;
    float bulge = toCore * toCore * toCore;
    float widthK = mix(1.45, 0.6, bulge);
    float broadBand = exp(-latitude * latitude * 4.0 * widthK);
    float mainBand = exp(-latitude * latitude * 12.5 * widthK);
    float coreBand = exp(-latitude * latitude * 36.0 * widthK);
    float bandGain = mix(0.55, 1.6, bulge);

    float macroCloud = fbm3(celestial * 2.2 + vec3(4.2, 8.7, 1.4));
    float smoke = fbm3(celestial * 5.0 + vec3(18.1, 2.4, 11.7));
    float fineSmoke = fbm3(celestial * 10.0 + vec3(2.7, 31.4, 8.3));

    float cloudy = smoothstep(0.16, 0.8, macroCloud) * 0.5
                 + smoothstep(0.3, 0.78, smoke) * 0.34
                 + smoothstep(0.42, 0.76, fineSmoke) * 0.16;

    float grain = noise3(celestial * 26.0) * 0.6 + noise3(celestial * 54.0) * 0.4;

    float galaxy = (broadBand * (0.025 + cloudy * 0.32)
                  + mainBand * (0.05 + cloudy * 0.52)
                  + coreBand * (0.11 + smoothstep(0.2, 0.8, macroCloud) * 0.26)) * bandGain;
    galaxy *= 0.8 + grain * 0.4;

    float laneShift = (fbm3(celestial * 1.7 + vec3(7.7, 19.2, 3.1)) - 0.5) * 0.24;
    float laneDelta = (latitude - laneShift) * 13.0;
    float rift = exp(-laneDelta * laneDelta);
    float riftBreaks = smoothstep(0.3, 0.62, fbm3(celestial * 3.4 + vec3(29.0, 5.5, 13.8)));
    galaxy *= 1.0 - rift * riftBreaks * mainBand * 0.92;

    vec3 coldSmoke = vec3(0.16, 0.32, 0.78);
    vec3 violetSmoke = vec3(0.5, 0.26, 0.68);
    vec3 warmCore = vec3(0.95, 0.66, 0.38);
    vec3 galaxyColor = mix(coldSmoke, violetSmoke, smoothstep(0.2, 0.85, smoke));
    galaxyColor = mix(galaxyColor, warmCore, coreBand * bulge * 0.85);

    float horizonFade = smoothstep(-0.06, 0.18, h);
    sky += galaxyColor * galaxy * uGalaxyStrength * clearNight * horizonFade;

    float nebRegion = smoothstep(0.6, 0.82, fbm3(celestial * 1.6 + vec3(23.1, 7.7, 15.3)));
    float nebDetail = fbm3(celestial * 6.0 + vec3(9.2, 27.3, 4.4));
    float filament = pow(smoothstep(0.5, 0.95, 1.0 - abs(2.0 * nebDetail - 1.0)), 1.7);
    float nebula = nebRegion * (smoothstep(0.35, 0.8, nebDetail) * 0.5 + filament * 0.9);
    nebula *= mix(0.3, 1.0, broadBand) * (1.0 - rift * riftBreaks * 0.6);
    vec3 nebColor = mix(vec3(0.85, 0.26, 0.4), vec3(0.2, 0.55, 0.62),
                        smoothstep(0.3, 0.7, fbm3(celestial * 2.4 + vec3(31.0, 3.0, 19.0))));
    sky += nebColor * nebula * uNebulaStrength * clearNight * horizonFade;
  }

  // Aurora borealis/australis: polar curtains, pole-aware.
  // Planet pole axis = world Y. playerLat: +1 = north pole, -1 = south pole, 0 = equator.
  float playerLat = dot(uPlayerUp, vec3(0.0, 1.0, 0.0));
  float absLat    = abs(playerLat);
  // Visible above ~18° latitude, full strength above ~40°.
  // polarVis already folds in uAuroraStrength and clearNight.
  float polarVis  = smoothstep(0.30, 0.65, absLat) * uAuroraStrength * clearNight;

  if (polarVis > 0.005) {
    // Nearest pole direction in world space
    vec3 poleDir  = vec3(0.0, sign(playerLat + 0.001), 0.0);
    // How much this sky direction points toward the pole (1=pole overhead, 0=equatorial horizon)
    float poleDot = dot(dir, poleDir);

    // Auroral oval: overhead when at the pole, just above poleward horizon at mid-latitudes.
    float bandCenter = mix(0.12, 0.78, absLat);
    float bandWidth  = mix(0.14, 0.30, absLat);
    float aVert = exp(-pow((poleDot - bandCenter) / bandWidth, 2.0));
    aVert *= smoothstep(-0.04, 0.12, h); // clip below local horizon

    // Curtain structure: noise along azimuth around the polar axis
    float az = atan(dir.x, dir.z);
    float t1 = uTime * 0.04;
    float t2 = uTime * 0.09;
    float band1 = noise3(vec3(az * 2.1 + t1, poleDot * 6.0 + t2, 0.3));
    float band2 = noise3(vec3(az * 4.8 - t1 * 0.7, poleDot * 10.0 + t1, 1.7));
    float curtain = smoothstep(0.36, 0.68, band1 * 0.55 + band2 * 0.45);

    // Vertical ray flicker inside curtains, strongest near the band center
    float ray  = pow(noise3(vec3(az * 9.0 + t2, 0.0, t1 * 0.5)), 2.2);
    float rays = ray * smoothstep(0.25, 0.0, abs(poleDot - bandCenter) / (bandWidth + 0.01));

    // Color: green base → purple/violet fringe at higher elevation, teal shimmer
    float hFrac = smoothstep(bandCenter - 0.10, bandCenter + 0.15, poleDot);
    vec3 auroraLow  = vec3(0.07, 0.92, 0.44);
    vec3 auroraHigh = vec3(0.62, 0.18, 0.82);
    vec3 auroraTeal = vec3(0.02, 0.80, 0.72);
    vec3 auroraCol  = mix(auroraLow, auroraHigh, hFrac * hFrac);
    auroraCol = mix(auroraCol, auroraTeal,
      noise3(vec3(az * 1.6, poleDot * 2.0, t1 * 0.3)) * 0.45);

    sky += auroraCol * curtain * (0.55 + rays * 0.45) * aVert * polarVis;
  }

  if (h > 0.015) {
    // Project onto the plane perpendicular to uPlayerUp for correct clouds on a spherical planet
    vec3 basisR = normalize(cross(uPlayerUp, vec3(0.0, 1.0, 0.01)));
    vec3 basisF = cross(uPlayerUp, basisR);
    vec2 cuv = vec2(dot(dir, basisR), dot(dir, basisF)) / (h + 0.12) * 1.5;
    cuv += uWind * uTime * 0.004;
    float c = fbm(cuv * 1.3 + fbm(cuv * 3.1) * 0.5);
    float lo = mix(0.66, 0.30, uCloudCover);
    float hi = mix(0.92, 0.52, uCloudCover);
    c = smoothstep(lo, hi, c);
    c *= smoothstep(0.015, 0.18, h);

    float dayLight = 1.0 - uNight * 0.82;
    vec3 cloudBright = mix(vec3(0.92, 0.92, 0.94), vec3(0.38, 0.4, 0.45), uCloudDark) * dayLight;
    vec3 cloudShade = mix(vec3(0.62, 0.64, 0.7), vec3(0.2, 0.21, 0.25), uCloudDark) * dayLight;
    vec3 cloudCol = mix(cloudBright, cloudShade, c * 0.85);
    cloudCol += uSunColor * pow(sunDot, 6.0) * 0.3 * (1.0 - uCloudDark) * sunVis;
    float cloudOpacity = mix(0.55 + uCloudCover * 0.4, 0.08 + uCloudCover * 0.55, uNight);
    sky = mix(sky, cloudCol, c * cloudOpacity);
  }

  sky = mix(sky, uHazeColor, smoothstep(0.0, -0.25, h));
  gl_FragColor = vec4(sky, 1.0);
}
`;

export const STAR_VERTEX: string = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uNight;
uniform float uCloudCover;
uniform float uStarBrightness;
uniform float uStarAngle;
uniform vec3  uPlayerUp;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Rotate around planet north pole (world Y) for horizontal drift at equatorial latitudes
  vec3 axis = vec3(0.0, 1.0, 0.0);
  float c = cos(uStarAngle);
  float s = sin(uStarAngle);
  vec3 rotated = position * c + cross(axis, position) * s + axis * dot(axis, position) * (1.0 - c);
  vec4 mv = modelViewMatrix * vec4(rotated, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.9 + sin(uTime * (0.35 + aPhase * 0.5) + aPhase * 41.0) * 0.1;
  gl_PointSize = aSize * twinkle;
  vColor = aColor;
  // Fade based on player's actual surface normal so horizon works anywhere on the sphere
  float horizonFade = smoothstep(-0.06, 0.14, dot(normalize(rotated), uPlayerUp));
  vAlpha = uNight * (1.0 - uCloudCover * 0.9) * uStarBrightness * horizonFade;
}
`;

export const STAR_FRAGMENT: string = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p);
  float core = 1.0 - smoothstep(0.05, 0.24, r);
  float glow = (1.0 - smoothstep(0.08, 0.5, r)) * 0.28;
  float alpha = (core + glow) * vAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor * (core * 1.35 + glow), alpha);
}
`;
