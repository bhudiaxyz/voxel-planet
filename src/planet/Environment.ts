import * as THREE from 'three';
import { ATMOSPHERE, SKY, WEATHER, WIND, HORIZON, PLANET, type QualitySettings } from '../config';
import { SeededRandom, combineSeed, generateRandomSeed } from '../utils/Random';
import { clamp, lerp, smoothstep } from '../utils/MathUtils';
import { Sky } from './Sky';

export interface SharedEnvUniforms {
  uTime:             { value: number };
  uWindDir:          { value: THREE.Vector2 };
  uWindStrength:     { value: number };
  uSunDir:           { value: THREE.Vector3 };
  uMoonDir:          { value: THREE.Vector3 };
  uSunColor:         { value: THREE.Color };
  uAmbientColor:     { value: THREE.Color };
  uGroundBounceColor:{ value: THREE.Color };
  uZenithColor:      { value: THREE.Color };
  uHorizonColor:     { value: THREE.Color };
  uHazeColor:        { value: THREE.Color };
  uNight:            { value: number };
  uDawn:             { value: number };
  uDusk:             { value: number };
  uCloudCover:       { value: number };
  uCloudDark:        { value: number };
  uWind:             { value: THREE.Vector2 };
  uStarAngle:        { value: number };
  uGalaxyStrength:   { value: number };
  uNebulaStrength:   { value: number };
}

interface WeatherState {
  cloudCover: number;
  cloudDark:  number;
  wind:       number;
  fogMult:    number;
  rain:       number;
  snow:       number;
}

const WEATHER_STATES: Record<string, WeatherState> = {
  clear:     { cloudCover: 0.07, cloudDark: 0.00, wind: 0.4,  fogMult: 1.0, rain: 0, snow: 0 },
  breezy:    { cloudCover: 0.30, cloudDark: 0.05, wind: 1.25, fogMult: 1.0, rain: 0, snow: 0 },
  cloudy:    { cloudCover: 0.55, cloudDark: 0.20, wind: 0.7,  fogMult: 1.5, rain: 0, snow: 0 },
  lowclouds: { cloudCover: 0.80, cloudDark: 0.35, wind: 0.5,  fogMult: 2.6, rain: 0, snow: 0 },
  overcast:  { cloudCover: 0.90, cloudDark: 0.55, wind: 0.8,  fogMult: 2.0, rain: 0, snow: 0 },
  rain:      { cloudCover: 0.96, cloudDark: 0.75, wind: 1.5,  fogMult: 3.2, rain: 1, snow: 0 },
  snow:      { cloudCover: 0.85, cloudDark: 0.40, wind: 0.35, fogMult: 2.2, rain: 0, snow: 1 },
  fog:       { cloudCover: 0.60, cloudDark: 0.25, wind: 0.15, fogMult: 6.0, rain: 0, snow: 0 },
};

export const WEATHER_OPTIONS: string[] = Object.keys(WEATHER_STATES);

const WEATHER_KEYS    = Object.keys(WEATHER_STATES);
const WEATHER_WEIGHTS = [0.28, 0.15, 0.18, 0.09, 0.09, 0.13, 0.05, 0.03];

// Painterly plein-air palette — four stops: day / dawn / dusk / night
// Dawn (sunrise): cool rose-lilac sky, soft coral horizon, pale gold sun
// Dusk (sunset):  warm amber-orange sky, deep peachy horizon, ember sun
const PAL = {
  day: {
    zenith:  new THREE.Color(0x2468b4),
    horizon: new THREE.Color(0x8ab8d0),
    haze:    new THREE.Color(0xaac4d8),
    sun:     new THREE.Color(0xffe8a8),
    fog:     new THREE.Color(0x9ebccc),
  },
  dawn: {
    zenith:  new THREE.Color(0x3a4878),  // indigo-blue just before sunrise
    horizon: new THREE.Color(0xf0b8c0),  // cool coral-rose
    haze:    new THREE.Color(0xd8b0c8),  // lilac-pink haze
    sun:     new THREE.Color(0xffd090),  // pale warm gold
    fog:     new THREE.Color(0xd0a8b8),  // rose-tinted fog
  },
  dusk: {
    zenith:  new THREE.Color(0x2e3e68),
    horizon: new THREE.Color(0xf09858),  // warm peachy-orange
    haze:    new THREE.Color(0xe0a870),
    sun:     new THREE.Color(0xff8030),  // deep amber
    fog:     new THREE.Color(0xc09870),
  },
  // Twilight: deep indigo band briefly after sunset / before sunrise
  twilight: {
    zenith:  new THREE.Color(0x0e1840),
    horizon: new THREE.Color(0x2a2848),
    haze:    new THREE.Color(0x201e38),
    sun:     new THREE.Color(0x8090c8),
    fog:     new THREE.Color(0x181828),
  },
  night: {
    zenith:  new THREE.Color(0x060c1a),
    horizon: new THREE.Color(0x141e2e),
    haze:    new THREE.Color(0x101824),
    sun:     new THREE.Color(0xbccbe8),
    fog:     new THREE.Color(0x0c1420),
  },
};

const CLOUD_FOG_COLOR    = new THREE.Color(0x5a6472);  // slight blue in clouds
const NIGHT_GROUND_COLOR = new THREE.Color(0x1c2026);
const DUSK_GROUND_COLOR  = new THREE.Color(0x624030);

function pickWeatherKey(rng: SeededRandom): string {
  let r = rng.next();
  for (let i = 0; i < WEATHER_KEYS.length; i++) {
    r -= WEATHER_WEIGHTS[i];
    if (r <= 0) return WEATHER_KEYS[i];
  }
  return WEATHER_KEYS[0];
}

/**
 * Environment director for the voxel planet.
 * Sun direction is derived from timeOfDay rotated around a tilted axis so it
 * behaves as a world-space vector regardless of where on the sphere the player
 * stands — callers use it to light foliage, water, and the smooth sphere.
 */
export class Environment {
  readonly uniforms: SharedEnvUniforms;
  readonly sky: Sky;

  timeOfDay  = 0.5;
  weatherKey = 'clear';

  private sunLight:    THREE.DirectionalLight;
  private fillLight:   THREE.DirectionalLight;
  private hemiLight:   THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private torch:        THREE.PointLight;

  private fog: THREE.FogExp2;
  private weather:       WeatherState = { ...WEATHER_STATES.clear };
  private targetWeather: WeatherState = { ...WEATHER_STATES.clear };
  private weatherTimer   = 20;
  private weatherRng:    SeededRandom;
  private windAngle      = 0.6;
  private windVariation  = 1.0;
  private baseWindStrength = WIND.baseStrength;

  private rain:           THREE.Points;
  private rainMaterial:   THREE.ShaderMaterial;
  private snow:           THREE.Points;
  private snowMaterial:   THREE.ShaderMaterial;
  private drizzle:        THREE.Points;
  private drizzleMaterial:THREE.ShaderMaterial;

  // Aurora: per-night strength rolled at nightfall, blended in/out with night factor
  private auroraTarget  = 0.0;
  private auroraCurrent = 0.0;
  private _lastNight    = 0.0; // track night factor to detect nightfall transition

  // Scratch
  private sunDirRaw  = new THREE.Vector3();
  private moonDir    = new THREE.Vector3();
  private _playerUp  = new THREE.Vector3();
  private _playerEast = new THREE.Vector3();
  private _daySpeedMult = 1.0;
  private colA         = new THREE.Color();
  private colB         = new THREE.Color();
  private colC         = new THREE.Color();  // scratch — avoids per-frame allocation in update()
  private colD         = new THREE.Color();  // scratch
  private groundBounce = new THREE.Color();

  constructor(scene: THREE.Scene, seed: number, quality: QualitySettings) {
    this.weatherRng = new SeededRandom(combineSeed(seed, 555));
    // Seed-based initial wind direction so each world starts differently
    this.windAngle = ((combineSeed(seed, 0x77d1) >>> 0) % 1000) / 1000 * Math.PI * 2;
    const sessionRng = new SeededRandom(generateRandomSeed());
    // Bias to daytime so terrain is visible on spawn; range [0.25, 0.75] = sunrise→sunset
    this.timeOfDay = 0.25 + sessionRng.next() * 0.5;

    const initialKey = pickWeatherKey(sessionRng);
    this.weather        = { ...WEATHER_STATES[initialKey] };
    this.targetWeather  = { ...WEATHER_STATES[initialKey] };
    this.weatherKey     = initialKey;
    this.windVariation  = sessionRng.range(0.7, 1.45);
    this.weatherTimer   = this.weatherRng.range(WEATHER.changeIntervalMin, WEATHER.changeIntervalMax);

    this.uniforms = {
      uTime:              { value: 0 },
      uWindDir:           { value: new THREE.Vector2(1, 0.3).normalize() },
      uWindStrength:      { value: 0.4 },
      uSunDir:            { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir:           { value: new THREE.Vector3(0, -1, 0) },
      uSunColor:          { value: new THREE.Color(0xffe8a8) },  // warm golden sun
      uAmbientColor:      { value: new THREE.Color(0x5878a0) },  // cooler cerulean ambient (sky light)
      uGroundBounceColor: { value: new THREE.Color(0x7a7050) },  // warm earthy ground bounce
      uZenithColor:       { value: new THREE.Color(0x2f6cb0) },
      uHorizonColor:      { value: new THREE.Color(0xa8c2d4) },
      uHazeColor:         { value: new THREE.Color(0xbcc9d2) },
      uNight:             { value: 0 },
      uDawn:              { value: 0 },
      uDusk:              { value: 0 },
      uCloudCover:        { value: 0.2 },
      uCloudDark:         { value: 0 },
      uWind:              { value: new THREE.Vector2(1, 0.3) },
      uStarAngle:         { value: 0 },
      uGalaxyStrength:    { value: SKY.night.galaxyStrength },
      uNebulaStrength:    { value: SKY.night.nebulaStrength },
    };

    this.sky = new Sky(scene);

    // Lights
    this.sunLight = new THREE.DirectionalLight(0xfff3d8, ATMOSPHERE.sunIntensity);
    this.sunLight.castShadow = quality.shadowsEnabled;
    if (quality.shadowsEnabled) {
      const cam = this.sunLight.shadow.camera as THREE.OrthographicCamera;
      const ext = 150;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 1; cam.far = 600;
      const mapSize = ((quality as unknown) as Record<string, unknown>)['shadowMapSize'] as number | undefined ?? 1024;
      this.sunLight.shadow.mapSize.set(mapSize, mapSize);
      this.sunLight.shadow.bias       = -0.0005;
      this.sunLight.shadow.normalBias = 0.6;
      this.sunLight.shadow.radius     = 6;
    }
    scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight(0x9db8d6, ATMOSPHERE.fillIntensity);
    scene.add(this.fillLight);
    scene.add(this.fillLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x9db8d6, 0x6e6750, ATMOSPHERE.hemiIntensity);
    scene.add(this.hemiLight);

    // Ambient floor for MeshLambertMaterial (vegetation, etc.) — mirrors uAmbientColor
    this.ambientLight = new THREE.AmbientLight(0x000000, 1);
    scene.add(this.ambientLight);

    this.torch = new THREE.PointLight(SKY.day.torchColor, 0, SKY.day.torchDistance, 1.7);
    scene.add(this.torch);

    this.fog = new THREE.FogExp2(0xb9c6cf, ATMOSPHERE.fogDensity * HORIZON.fogDensityMultiplier);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0xb9c6cf);

    const rainParticles = ((quality as unknown) as Record<string, unknown>)['rainParticles'] as number | undefined ?? 1200;
    const rainBuilt = this._buildRain(rainParticles);
    this.rain = rainBuilt.points;
    this.rainMaterial = rainBuilt.material;
    scene.add(this.rain);

    const snowBuilt = this._buildSnow(WEATHER.snow.particleCount);
    this.snow = snowBuilt.points;
    this.snowMaterial = snowBuilt.material;
    scene.add(this.snow);

    const drizzleBuilt = this._buildDrizzle(WEATHER.beachRain.particleCount);
    this.drizzle = drizzleBuilt.points;
    this.drizzleMaterial = drizzleBuilt.material;
    scene.add(this.drizzle);

    this.applyUrlOverrides();
  }

  get sceneFog(): THREE.FogExp2 { return this.fog; }

  setTimeOfDay(value: number): void {
    this.timeOfDay = clamp(value, 0, 0.9999);
  }

  setWeather(name: string): void {
    if (!WEATHER_STATES[name]) return;
    this.weatherKey    = name;
    this.weather       = { ...WEATHER_STATES[name] };
    this.targetWeather = { ...WEATHER_STATES[name] };
  }

  setWindStrength(v: number): void {
    this.baseWindStrength = clamp(v, 0, 3);
  }

  setWindDirection(angle: number): void {
    this.windAngle = angle;
  }

  setDaySpeed(multiplier: number): void {
    // ponytail: stored inline, no separate field — multiplied in update()
    this._daySpeedMult = clamp(multiplier, 0, 8);
  }

  applyUrlOverrides(): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tod = params.get('tod');
    if (tod !== null) {
      const v = parseFloat(tod);
      if (Number.isFinite(v)) this.timeOfDay = clamp(v, 0, 0.9999);
    }
    const wx = params.get('weather');
    if (wx && WEATHER_STATES[wx]) {
      this.weather       = { ...WEATHER_STATES[wx] };
      this.targetWeather = { ...WEATHER_STATES[wx] };
      this.weatherKey    = wx;
    }
  }

  private _buildRain(count: number): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const offsets = new Float32Array(count * 3);
    const speeds  = new Float32Array(count);
    const rng = new SeededRandom(8181);
    for (let i = 0; i < count; i++) {
      offsets[i * 3]     = rng.next();
      offsets[i * 3 + 1] = rng.next();
      offsets[i * 3 + 2] = rng.next();
      speeds[i] = rng.range(34, 50);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      uniforms: {
        uTime:        this.uniforms.uTime,
        uCamPos:      { value: new THREE.Vector3() },
        uOpacity:     { value: 0 },
        uSurfaceDir:  { value: new THREE.Vector3(0, -1, 0) }, // "down" on planet = toward center
        uWindDir:     this.uniforms.uWindDir,
        uWindStrength:this.uniforms.uWindStrength,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3  uCamPos;
        uniform vec3  uSurfaceDir;
        uniform vec2  uWindDir;
        uniform float uWindStrength;
        attribute float aSpeed;
        varying float vFade;
        const vec3 BOX = vec3(70.0, 42.0, 70.0);
        void main() {
          // Build a local frame where -Y = toward planet center
          vec3 down = normalize(uSurfaceDir);
          vec3 right = normalize(cross(down, vec3(0.0, 0.0, 1.0)));
          vec3 fwd   = cross(right, down);
          vec3 p = position * BOX;
          // Fall toward ground: increasing fallY → lower position along -down
          float fallY = mod(dot(p, -down) + uTime * aSpeed, BOX.y);
          p = right * (p.x - BOX.x*0.5) + fwd * (p.z - BOX.z*0.5) + (-down) * (fallY - BOX.y*0.5);
          p += (right * uWindDir.x + fwd * uWindDir.y) * uWindStrength * fallY * 0.35;
          vec3 world = uCamPos + p;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(110.0 / dist, 1.5, 7.0);
          vFade = smoothstep(70.0, 25.0, dist);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          // Elongated streak mask: narrow on X, tall on Y → raindrop shape
          float a = (1.0 - smoothstep(0.0, 0.06, abs(pc.x))) * (1.0 - smoothstep(0.1, 0.5, abs(pc.y)));
          gl_FragColor = vec4(vec3(0.72, 0.78, 0.88), a * uOpacity * vFade * 0.65);
        }
      `,
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return { points, material };
  }

  private _buildSnow(count: number): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const offsets = new Float32Array(count * 3);
    const speeds  = new Float32Array(count);
    const phases  = new Float32Array(count);
    const rng = new SeededRandom(9292);
    for (let i = 0; i < count; i++) {
      offsets[i * 3]     = rng.next();
      offsets[i * 3 + 1] = rng.next();
      offsets[i * 3 + 2] = rng.next();
      speeds[i] = rng.range(WEATHER.snow.speedMin, WEATHER.snow.speedMax);
      phases[i] = rng.next() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));

    const [bx, by, bz] = WEATHER.snow.boxSize;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      uniforms: {
        uTime:        this.uniforms.uTime,
        uCamPos:      { value: new THREE.Vector3() },
        uOpacity:     { value: 0 },
        uSurfaceDir:  { value: new THREE.Vector3(0, -1, 0) },
        uWindDir:     this.uniforms.uWindDir,
        uWindStrength:this.uniforms.uWindStrength,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3  uCamPos;
        uniform vec3  uSurfaceDir;
        uniform vec2  uWindDir;
        uniform float uWindStrength;
        attribute float aSpeed;
        attribute float aPhase;
        varying float vFade;
        const vec3 BOX = vec3(${bx.toFixed(1)}, ${by.toFixed(1)}, ${bz.toFixed(1)});
        const float DRIFT = ${WEATHER.snow.driftStrength.toFixed(3)};
        void main() {
          vec3 down  = normalize(uSurfaceDir);
          vec3 right = normalize(cross(down, vec3(0.0, 0.0, 1.0)));
          vec3 fwd   = cross(right, down);
          vec3 p = position * BOX;
          float t    = uTime * aSpeed + aPhase * BOX.y;
          float fallY = mod(dot(p, -down) + t, BOX.y);
          // Gentle pendulum drift in local horizontal plane
          float driftX = sin(uTime * 0.6 + aPhase) * DRIFT * 5.0;
          float driftZ = cos(uTime * 0.45 + aPhase * 1.3) * DRIFT * 3.5;
          p = right * (p.x - BOX.x*0.5 + driftX)
            + fwd   * (p.z - BOX.z*0.5 + driftZ)
            + (-down) * (fallY - BOX.y*0.5);
          // Wind carry (gentler than rain)
          p += (right * uWindDir.x + fwd * uWindDir.y) * uWindStrength * fallY * 0.12;
          vec3 world = uCamPos + p;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(180.0 / dist, ${WEATHER.snow.flakeSizeMin.toFixed(1)}, ${WEATHER.snow.flakeSizeMax.toFixed(1)});
          vFade = smoothstep(${bx.toFixed(1)}, 20.0, dist);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          // Soft circular flake (not a streak like rain)
          float r = length(pc);
          float a = 1.0 - smoothstep(0.25, 0.5, r);
          // Soft bright centre
          a *= 0.5 + 0.5 * (1.0 - smoothstep(0.0, 0.22, r));
          gl_FragColor = vec4(vec3(0.92, 0.95, 1.00), a * uOpacity * vFade * 0.8);
        }
      `,
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    points.visible = false;
    return { points, material };
  }

  private _buildDrizzle(count: number): { points: THREE.Points; material: THREE.ShaderMaterial } {
    const offsets = new Float32Array(count * 3);
    const speeds  = new Float32Array(count);
    const rng = new SeededRandom(7373);
    for (let i = 0; i < count; i++) {
      offsets[i * 3]     = rng.next();
      offsets[i * 3 + 1] = rng.next();
      offsets[i * 3 + 2] = rng.next();
      speeds[i] = rng.range(WEATHER.beachRain.speedMin, WEATHER.beachRain.speedMax);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(offsets, 3));
    geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1));

    const [bx, by, bz] = WEATHER.beachRain.boxSize;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      uniforms: {
        uTime:        this.uniforms.uTime,
        uCamPos:      { value: new THREE.Vector3() },
        uOpacity:     { value: 0 },
        uSurfaceDir:  { value: new THREE.Vector3(0, -1, 0) },
        uWindDir:     this.uniforms.uWindDir,
        uWindStrength:this.uniforms.uWindStrength,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3  uCamPos;
        uniform vec3  uSurfaceDir;
        uniform vec2  uWindDir;
        uniform float uWindStrength;
        attribute float aSpeed;
        varying float vFade;
        const vec3 BOX = vec3(${bx.toFixed(1)}, ${by.toFixed(1)}, ${bz.toFixed(1)});
        void main() {
          vec3 down  = normalize(uSurfaceDir);
          vec3 right = normalize(cross(down, vec3(0.0, 0.0, 1.0)));
          vec3 fwd   = cross(right, down);
          vec3 p = position * BOX;
          float fallY = mod(dot(p, -down) + uTime * aSpeed, BOX.y);
          p = right * (p.x - BOX.x*0.5) + fwd * (p.z - BOX.z*0.5) + (-down) * (fallY - BOX.y*0.5);
          p += (right * uWindDir.x + fwd * uWindDir.y) * uWindStrength * fallY * 0.28;
          vec3 world = uCamPos + p;
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp(80.0 / dist, 1.0, 5.0);
          vFade = smoothstep(${bx.toFixed(1)}, 18.0, dist);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vFade;
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          // Fine mist streak: very narrow
          float a = (1.0 - smoothstep(0.0, 0.05, abs(pc.x))) * (1.0 - smoothstep(0.08, 0.5, abs(pc.y)));
          gl_FragColor = vec4(vec3(0.78, 0.84, 0.92), a * uOpacity * vFade * 0.5);
        }
      `,
    });

    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    points.renderOrder = 5;
    points.visible = false;
    return { points, material };
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    const u = this.uniforms;
    u.uTime.value += dt;
    const elapsed = u.uTime.value;

    // Advance day
    this.timeOfDay = (this.timeOfDay + (dt * this._daySpeedMult) / SKY.day.dayLengthSeconds) % 1;
    // Sun sweeps the player's LOCAL sky: directly overhead at noon (tod=0.5) for any
    // position on the sphere. sinE = elevation; cosE = horizontal offset (east at sunrise).
    const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sinE  = Math.sin(angle); // +1 = overhead (noon), -1 = underfoot (midnight)
    const cosE  = Math.cos(angle); // +1 = east horizon (sunrise), -1 = west (sunset)
    this._playerUp.copy(playerPos).normalize();
    if (Math.abs(this._playerUp.y) < 0.9) {
      this._playerEast.set(0, 1, 0).cross(this._playerUp).normalize();
    } else {
      this._playerEast.set(1, 0, 0).cross(this._playerUp).normalize();
    }
    // sun = up*sin(elevation) + east*cos(elevation)  — already unit length
    this.sunDirRaw.copy(this._playerUp).multiplyScalar(sinE)
      .addScaledVector(this._playerEast, cosE);
    this.moonDir.copy(this.sunDirRaw).negate();
    const sunY = sinE; // elevation above local horizon

    const day   = smoothstep(0.02, 0.3, sunY);
    const night = smoothstep(-0.04, -0.26, sunY);
    // cosE > 0 → sun rising (dawn side); cosE < 0 → sun setting (dusk side)
    const dawnSide  = smoothstep(-0.1, 0.5, cosE);   // 1 at pure sunrise, 0 at pure sunset
    const transAmt  = (1 - day) * (1 - night);       // how much we're in transition at all
    const dawn      = transAmt * dawnSide;
    const dusk      = transAmt * (1 - dawnSide);
    // Twilight: deep indigo in the window just after day drops and before full night
    const twilight  = smoothstep(0.0, -0.12, sunY) * smoothstep(-0.35, -0.12, sunY) * (1 - night * 0.6);
    u.uNight.value = night;
    u.uDawn.value  = dawn;
    u.uDusk.value  = dusk;

    // Weather
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = this.weatherRng.range(WEATHER.changeIntervalMin, WEATHER.changeIntervalMax);
      this.weatherKey = pickWeatherKey(this.weatherRng);
      this.targetWeather = { ...WEATHER_STATES[this.weatherKey] };
    }
    const k = 1 - Math.exp(-WEATHER.blendRate * dt);
    const w = this.weather;
    w.cloudCover = lerp(w.cloudCover, this.targetWeather.cloudCover, k);
    w.cloudDark  = lerp(w.cloudDark,  this.targetWeather.cloudDark,  k);
    w.wind       = lerp(w.wind,       this.targetWeather.wind,       k);
    w.fogMult    = lerp(w.fogMult,    this.targetWeather.fogMult,    k);
    w.rain       = lerp(w.rain,       this.targetWeather.rain,       k);

    // Wind
    this.windAngle += dt * WIND.driftRate;
    const gust = 0.72 + 0.28 * Math.sin(elapsed * WIND.gustFreq1) * Math.sin(elapsed * WIND.gustFreq2 + 1.7)
                      + 0.18 * Math.sin(elapsed * WIND.gustFreq3 + 0.4);
    u.uWindDir.value.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    u.uWindStrength.value = w.wind * this.windVariation * gust * this.baseWindStrength;

    // Palette blending — five stops weighted to sum ≈ 1 at any time
    const mix3 = (out: THREE.Color, key: keyof typeof PAL.day): THREE.Color => {
      out.setRGB(0, 0, 0);
      this.colA.copy(PAL.day[key]).multiplyScalar(day);          out.add(this.colA);
      this.colA.copy(PAL.dawn[key]).multiplyScalar(dawn);        out.add(this.colA);
      this.colA.copy(PAL.dusk[key]).multiplyScalar(dusk);        out.add(this.colA);
      this.colA.copy(PAL.twilight[key]).multiplyScalar(twilight); out.add(this.colA);
      this.colA.copy(PAL.night[key]).multiplyScalar(night);      out.add(this.colA);
      return out;
    };

    mix3(u.uZenithColor.value,  'zenith');
    mix3(u.uHorizonColor.value, 'horizon');
    mix3(u.uSunColor.value,     'sun');
    mix3(u.uHazeColor.value,    'haze');

    const fogColor = mix3(this.colB, 'fog');
    fogColor.lerp(CLOUD_FOG_COLOR, w.cloudDark * 0.5 * (1 - night));
    this.fog.color.copy(fogColor);
    if (this.sky.dome.parent instanceof THREE.Scene) {
      (this.sky.dome.parent.background as THREE.Color | null)?.copy(fogColor);
    }
    this.fog.density = ATMOSPHERE.fogDensity * HORIZON.fogDensityMultiplier * w.fogMult * (1 + night * 0.8);

    u.uStarAngle.value  = this.timeOfDay * Math.PI * 2;
    u.uCloudCover.value = w.cloudCover;
    u.uCloudDark.value  = w.cloudDark;
    u.uWind.value.copy(u.uWindDir.value).multiplyScalar(2 + w.wind * 6);

    // Sky dome uniforms
    const sky = this.sky.material.uniforms;
    sky.uStarAngle.value   = u.uStarAngle.value;
    sky.uSunDir.value.copy(this.sunDirRaw);
    sky.uMoonDir.value.copy(this.moonDir);
    (sky.uZenithColor.value  as THREE.Color).copy(u.uZenithColor.value);
    (sky.uHorizonColor.value as THREE.Color).copy(u.uHorizonColor.value);
    (sky.uHazeColor.value    as THREE.Color).copy(u.uHazeColor.value);
    (sky.uSunColor.value     as THREE.Color).copy(u.uSunColor.value);
    sky.uNight.value      = night;
    sky.uCloudCover.value = w.cloudCover;
    sky.uCloudDark.value  = w.cloudDark;
    (sky.uWind.value as THREE.Vector2).copy(u.uWindDir.value).multiplyScalar(2 + w.wind * 6);

    const stars = this.sky.starMaterial.uniforms;
    stars.uStarAngle.value  = u.uStarAngle.value;
    stars.uNight.value      = night;
    stars.uCloudCover.value = w.cloudCover;

    // Aurora: roll a new target strength each nightfall (night crosses 0.5 rising)
    if (this._lastNight < 0.5 && night >= 0.5) {
      // ~40% chance of visible aurora; strength 0 or 0.4–1.2
      this.auroraTarget = this.weatherRng.next() < 0.4
        ? this.weatherRng.range(0.4, 1.2)
        : 0.0;
    }
    this._lastNight = night;
    // Blend current toward target slowly; multiply by night so it fades at dawn
    this.auroraCurrent += (this.auroraTarget - this.auroraCurrent) * Math.min(1, dt * 0.15);
    this.sky.material.uniforms.uAuroraStrength.value = this.auroraCurrent * night * (1 - w.cloudCover * 0.9);

    // Sun direction for lighting (moon by night)
    const moonUp = sunY < 0.02;
    u.uSunDir.value.copy(moonUp ? this.moonDir : this.sunDirRaw);
    u.uMoonDir.value.copy(this.moonDir);

    const cloudMute    = 1 - w.cloudDark * 0.55;
    const transAmt2    = dawn + dusk; // total transition strength for lighting
    const sunStrength  = ATMOSPHERE.sunIntensity * day * (1 - w.cloudCover * 0.62) + transAmt2 * 1.4 * (1 - w.cloudCover * 0.5);
    const moonStrength = 0.75 * night * (1 - w.cloudCover * 0.7);
    // Moon tinted warm amber near horizon (moonrise/set), cool blue overhead
    const moonHorizonWarm = smoothstep(0.25, -0.05, Math.abs(sunY)) * night;
    this.colA.setHex(0xbccbe8).lerp(this.colC.setHex(0xf0c090), moonHorizonWarm);
    this.sunLight.intensity = (moonUp ? moonStrength : sunStrength) * cloudMute;
    this.sunLight.color.copy(moonUp ? this.colA : u.uSunColor.value);
    this.sunLight.position.copy(u.uSunDir.value).multiplyScalar(300).add(playerPos);

    const hemiTrans = dawn * 0.45 + dusk * 0.55; // dusk slightly brighter than dawn
    this.hemiLight.intensity = Math.max(0.18, (ATMOSPHERE.hemiIntensity * day + hemiTrans + 0.32 * night) * (1 - w.cloudDark * 0.25));
    this.hemiLight.color.copy(u.uHorizonColor.value);
    this.hemiLight.groundColor.setHex(0x6e6750).lerp(NIGHT_GROUND_COLOR, night);

    // Ground bounce: dawn = cooler rose, dusk = warm amber
    this.groundBounce.setHex(0x7a7050)
      .lerp(this.colD.setHex(0x604848),  dawn * 0.5)
      .lerp(DUSK_GROUND_COLOR,  dusk * 0.55)
      .lerp(NIGHT_GROUND_COLOR, night * 0.8);
    u.uGroundBounceColor.value.copy(this.groundBounce);

    this.fillLight.intensity = ATMOSPHERE.fillIntensity * (0.35 + day * 0.65) * cloudMute + 0.12;
    this.fillLight.position.copy(playerPos).addScaledVector(u.uSunDir.value, -120);
    this.fillLight.target.position.copy(playerPos);

    // Ambient: horizon-tinted sky light; night is kept dim (moon-bounce floor) so world darkens like the sky
    const ambientScale = 0.06 + day * 0.39 + night * 0.04;
    u.uAmbientColor.value.copy(u.uHorizonColor.value).multiplyScalar(ambientScale);
    // Drive AmbientLight so MeshLambertMaterial (vegetation) matches the voxel shader floor
    this.ambientLight.color.copy(u.uAmbientColor.value);

    // Torch follows player, night only
    const flicker = 0.86 + 0.14 * Math.sin(elapsed * 11.0) * Math.sin(elapsed * 5.7 + 2.1);
    this.torch.intensity = SKY.day.torchIntensity * night * flicker;
    this.torch.position.copy(playerPos);

    // Altitude above nominal surface (PLANET.offset brings the heightfield base to ~0)
    const altOffset = playerPos.length() - PLANET.radius - PLANET.offset * PLANET.amplitude;

    // Rain: "down" = toward planet center from player
    this.rainMaterial.uniforms.uOpacity.value = w.rain;
    (this.rainMaterial.uniforms.uCamPos.value    as THREE.Vector3).copy(playerPos);
    (this.rainMaterial.uniforms.uSurfaceDir.value as THREE.Vector3).copy(playerPos).normalize();
    this.rain.visible = w.rain > 0.02;

    // Snow: altitude-gated at high elevation, OR forced on by snow weather state at all altitudes
    const snowAltFactor = clamp((altOffset - WEATHER.snow.altitudeThreshold) / WEATHER.snow.altitudeBlendRange, 0, 1);
    const snowOpacity = Math.max(snowAltFactor, w.snow) * WEATHER.snow.opacity;
    this.snowMaterial.uniforms.uOpacity.value = snowOpacity;
    (this.snowMaterial.uniforms.uCamPos.value    as THREE.Vector3).copy(playerPos);
    (this.snowMaterial.uniforms.uSurfaceDir.value as THREE.Vector3).copy(playerPos).normalize();
    this.snow.visible = snowOpacity > 0.02;

    // Beach drizzle: only during rain, fades in below WEATHER.beachRain.altitudeThreshold
    const drizzleFactor = w.rain > 0.02
      ? clamp((WEATHER.beachRain.altitudeThreshold - altOffset) / WEATHER.beachRain.altitudeBlendRange, 0, 1)
      : 0;
    const drizzleOpacity = drizzleFactor * WEATHER.beachRain.opacity;
    this.drizzleMaterial.uniforms.uOpacity.value = drizzleOpacity;
    (this.drizzleMaterial.uniforms.uCamPos.value    as THREE.Vector3).copy(playerPos);
    (this.drizzleMaterial.uniforms.uSurfaceDir.value as THREE.Vector3).copy(playerPos).normalize();
    this.drizzle.visible = drizzleOpacity > 0.02;

    this.sky.update(elapsed, playerPos);
  }

  dispose(): void {
    this.sky.dispose();
    this.sunLight.dispose();
    this.fillLight.dispose();
    this.hemiLight.dispose();
    this.torch.dispose();
    this.rain.geometry.dispose();
    this.rainMaterial.dispose();
    this.snow.geometry.dispose();
    this.snowMaterial.dispose();
    this.drizzle.geometry.dispose();
    this.drizzleMaterial.dispose();
  }
}
