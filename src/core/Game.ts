import * as THREE from 'three';
import { PLANET, QUALITY_PRESETS, FORCED_QUALITY } from '../config';
import type { QualitySettings } from '../config';
import { getGpuTier } from '../utils/GpuInfo';
import { Renderer } from './Renderer';
import { CameraController } from './CameraController';
import { Hud } from './Hud';
import { Planet } from '../planet/Planet';
import { WEATHER_OPTIONS } from '../planet/Environment';

export class Game {
  private scene: THREE.Scene;
  private renderer: Renderer;
  camera: CameraController;
  private hud: Hud;
  private planet: Planet;
  private clock = new THREE.Clock();
  private rafId = 0;
  private firstFrame = true;
  private smoothFps = 60;
  private readonly underwaterFog = new THREE.FogExp2(0x0a3a5a, 0.04);
  // Hoist closure so it isn't re-allocated on every frame
  private readonly _getVoxelHeight = (pt: THREE.Vector3) => this.planet.getVoxelColumnHeightAt(pt);

  constructor(seed: number) {
    this.scene = new THREE.Scene();

    // Quality
    const tier = FORCED_QUALITY ?? getGpuTier();
    const quality: QualitySettings = QUALITY_PRESETS[tier] ?? QUALITY_PRESETS['medium'];

    // Canvas
    const canvas = document.createElement('canvas');
    const app = document.getElementById('app');
    if (!app) throw new Error('#app element not found');
    app.appendChild(canvas);

    this.renderer = new Renderer(canvas, quality);

    this.planet = new Planet(this.scene, seed, quality);
    // Let Renderer track sun movement for shadow-map update gating
    this.renderer.sunDirRef = this.planet.environment.uniforms.uSunDir.value;
    this.hud = new Hud(seed);

    // Camera controller
    this.camera = new CameraController(canvas);

    // Position camera at spawn
    const spawn = this.planet.findSpawnPoint();
    this.camera.camera.position.copy(spawn);

    (window as any).__game = this;

    // Build settings panel
    this.hud.buildSettingsPanel(
      this.planet.environment,
      this.planet.terrainNoise,
      () => this.planet.onTerrainParamsChange(),
    );

    // Resize handler
    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._onKeyDown);

    // Start loop
    this.clock.start();
    this.rafId = requestAnimationFrame(this._tick);
  }

  private _tick = (): void => {
    this.rafId = requestAnimationFrame(this._tick);

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Update planet
    this.planet.update(dt, this.camera.camera.position, this.camera.camera);

    // Collect colliders
    this.camera.colliders = this.planet.chunkManagerRef.collectCollidersNear(
      this.camera.camera.position,
      20,
    );

    // Player update
    this.camera.update(dt, PLANET.radius, this._getVoxelHeight);

    // Underwater
    const underwater = this.planet.isUnderwater(this.camera.camera.position);
    this.camera.isUnderwater = underwater;

    // Underwater fog override; restore environment fog when surfacing
    if (underwater) {
      this.scene.fog = this.underwaterFog;
    } else {
      this.scene.fog = this.planet.environment.sceneFog;
    }

    // FPS
    this.smoothFps += (1 / Math.max(dt, 0.001) - this.smoothFps) * Math.min(1, dt * 2);

    // HUD
    this.hud.update(
      this.smoothFps,
      this.planet.environment.timeOfDay,
      this.planet.environment.weatherKey,
      underwater,
      this.camera.drone,
    );

    // Render
    this.renderer.render(this.scene, this.camera.camera, dt);

    if (this.firstFrame) {
      this.firstFrame = false;
      this.hud.hideLoading();
    }
  };

  // Time-of-day stops for T key (sunrise→morning→noon→afternoon→sunset→dusk→night)
  private static readonly TOD_STOPS = [0.25, 0.35, 0.5, 0.65, 0.72, 0.82, 0.95];

  private _onKeyDown = (e: KeyboardEvent): void => {
    // Tab — cycle weather state
    if (e.code === 'Tab') {
      e.preventDefault();
      const env = this.planet.environment;
      const idx = WEATHER_OPTIONS.indexOf(env.weatherKey);
      env.setWeather(WEATHER_OPTIONS[(idx + 1) % WEATHER_OPTIONS.length]);
    }
    // T — step through time-of-day stops
    if (e.code === 'KeyT') {
      const env = this.planet.environment;
      const tod = env.timeOfDay;
      const stops = Game.TOD_STOPS;
      const next = stops.find(s => s > tod + 0.01) ?? stops[0];
      env.setTimeOfDay(next);
    }
  };

  private _onResize = (): void => {
    this.renderer.resize();
    this.camera.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.camera.updateProjectionMatrix();
  };

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKeyDown);
    this.camera.dispose();
    this.planet.dispose();
    this.renderer.dispose();
  }
}
