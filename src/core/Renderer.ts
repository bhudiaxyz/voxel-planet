import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RENDERER as RENDERER_CONFIG } from "../config";
import type { QualitySettings } from "../config";

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  private pixelRatioScale = 1.0;
  private lowFpsTimer = 0;
  private highFpsTimer = 0;
  private smoothFps = 60;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private bloomPass: UnrealBloomPass;
  private fxaaPass: ShaderPass;
  private _lastSunY = 0;
  /** Set by World after Environment is ready so shadow updates track sun movement. */
  sunDirRef: THREE.Vector3 | null = null;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias ?? true,
      powerPreference: "high-performance",
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.exposure;
    this.renderer.shadowMap.enabled = quality.shadowsEnabled ?? true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    const dpr = Math.min(window.devicePixelRatio, quality.maxPixelRatio ?? 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.composer = new EffectComposer(this.renderer);

    // RenderPass added in render() when scene/camera are available
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      RENDERER_CONFIG.bloomStrength,
      RENDERER_CONFIG.bloomRadius,
      RENDERER_CONFIG.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);

    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / w, 1 / h);
    this.composer.addPass(this.fxaaPass);

    this.composer.addPass(new OutputPass());
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    // Lazy-init RenderPass (needs scene + camera)
    if (this.scene !== scene || this.camera !== camera) {
      // Remove old render pass at index 0 if present
      if (
        this.composer.passes.length > 0 &&
        this.composer.passes[0] instanceof RenderPass
      ) {
        this.composer.passes.shift();
      }
      const rp = new RenderPass(scene, camera);
      this.composer.passes.unshift(rp);
      this.scene = scene;
      this.camera = camera;
    }

    // Adaptive pixel ratio
    const fps = 1 / dt;
    this.smoothFps += (fps - this.smoothFps) * Math.min(1, dt * 3);

    const base = Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxDevicePixelRatio);
    if (this.smoothFps < RENDERER_CONFIG.adaptiveMinFps) {
      this.highFpsTimer = 0;
      this.lowFpsTimer += dt;
      if (this.lowFpsTimer >= RENDERER_CONFIG.adaptiveLowFpsSeconds) {
        this.lowFpsTimer = 0;
        const minScale = RENDERER_CONFIG.adaptiveMinPixelRatioScale;
        if (this.pixelRatioScale > minScale) {
          this.pixelRatioScale = Math.max(minScale, this.pixelRatioScale - RENDERER_CONFIG.adaptivePixelRatioStep);
          this.renderer.setPixelRatio(base * this.pixelRatioScale);
          this.composer.setSize(window.innerWidth, window.innerHeight);
        }
      }
    } else {
      this.lowFpsTimer = 0;
      // Gradually recover pixel ratio when FPS is stable and above threshold
      if (this.pixelRatioScale < 1.0) {
        this.highFpsTimer += dt;
        if (this.highFpsTimer >= RENDERER_CONFIG.adaptiveLowFpsSeconds * 3) {
          this.highFpsTimer = 0;
          this.pixelRatioScale = Math.min(1.0, this.pixelRatioScale + RENDERER_CONFIG.adaptivePixelRatioStep * 0.5);
          this.renderer.setPixelRatio(base * this.pixelRatioScale);
          this.composer.setSize(window.innerWidth, window.innerHeight);
        }
      } else {
        this.highFpsTimer = 0;
      }
    }

    // Update shadow map only when the sun has moved enough — eliminates flicker on fast rotation
    const sunY = this.sunDirRef?.y ?? 0;
    if (Math.abs(sunY - this._lastSunY) > RENDERER_CONFIG.shadowUpdateThreshold) {
      this._lastSunY = sunY;
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.composer.render();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / w, 1 / h);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
