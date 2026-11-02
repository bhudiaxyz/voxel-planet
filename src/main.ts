import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { setVoxelPalette, SKY, LIGHT, GRADE, VOXEL_PALETTES } from './core/palette';
import { Atmosphere } from './render/lighting';
import { FPCamera } from './render/fp-camera';
import { createPostFX } from './render/postfx';
import { buildSphereWorld } from './world/world';
import { DayNight } from './render/day-night';
import { SphereController } from './player/sphere-controller';
import { createPause } from './ui/pause';
import { createSettings, DEFAULTS as SETTINGS_DEFAULTS } from './ui/settings';
import { createHud } from './ui/hud';
import { makeRng, genSeedWord, hashSeedWord } from './core/rng';
import { detectGpuTier, TIER_SETTINGS } from './render/gpu-tier';
import { createTouchControls, isTouchDevice } from './ui/touch-controls';
import { Input } from './player/controller';
import { createParticles } from './fx/particles';
import { createSphereMap } from './render/sphere-map';
import { createSphereDroneMode } from './player/sphere-drone';
import { createSphereDog } from './player/sphere-dog';

export let currentSeedWord = 'LusaliBenoruLezagi';
const urlWord = new URLSearchParams(location.search).get('seed');
if (urlWord) currentSeedWord = urlWord;
const SEED = hashSeedWord(currentSeedWord);
export function pushSeedUrl(word: string) {
  const p = new URLSearchParams(location.search);
  p.set('seed', word);
  history.replaceState(null, '', '?' + p.toString());
}
pushSeedUrl(currentSeedWord);

const _sunWorld = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();

const container = document.getElementById('app')!;
const bootEl = document.getElementById('boot')!;
const barEl = bootEl.querySelector('.ls-bar span')!;
const subEl = bootEl.querySelector('.ls-sub')!;
const ctrlEl = bootEl.querySelector('.ls-controls') as HTMLElement;

const setProgress = (p: number, s?: string): void => {
  (barEl as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  if (s && p < 1) ctrlEl.textContent = s;
  if (p >= 1) ctrlEl.textContent = '';
};

async function start(): Promise<void> {
  const tier = detectGpuTier();
  const renderer = createRenderer(container, tier);
  const scene = new THREE.Scene();

  const ts = TIER_SETTINGS[tier];
  const world = await buildSphereWorld(SEED, scene, setProgress);

  const fpCam = new FPCamera(container.clientWidth / container.clientHeight, renderer.domElement, ts.cameraFar);
  const atmo = new Atmosphere(scene, 800, tier);
  const dayNight = new DayNight(atmo, renderer);
  dayNight.voxelUniforms = (world.streaming.meshes as any).material?.userData?.uniforms;

  const voxMat = (world.streaming.meshes as any).material;
  if (voxMat?.userData?.uniforms) {
    let storedWind = SETTINGS_DEFAULTS.windStrength;
    try {
      const raw = localStorage.getItem('VoxelWorld.settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const n = Number(parsed.windStrength);
        if (Number.isFinite(n)) storedWind = n;
      }
    } catch { /* ignore */ }
    voxMat.userData.uniforms._windBase = storedWind;
  }

  const rng = makeRng(SEED);
  const particles = createParticles(80, rng, 300);
  scene.add(particles.group);

  const sphereMap = createSphereMap(world.grid);
  const drone = createSphereDroneMode();
  const dog = createSphereDog(world.grid, scene);

  const controller = new SphereController(world.spawnDir, world.grid);
  const input = new Input(renderer.domElement);

  const canAct = () => fpCam.isLocked || fpCam.touchActive;

  const enterDrone = () => {
    drone.enter(controller.dir, controller.groundRadius);
    fpCam.droneActive = true;
  };
  const exitDrone = () => {
    drone.exit();
    fpCam.droneActive = false;
  };

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) return;
    // Drone/fly exit — works even without pointer lock
    if (e.code === 'KeyL' && drone.active) { exitDrone(); return; }
    if (e.code === 'KeyV') {
      if (drone.active) exitDrone(); else enterDrone();
      return;
    }
    // Map toggle — direct, no pause-menu required
    if (e.code === 'KeyM') { sphereMapToggle.toggle(); return; }
    if (!canAct()) return;
    if (e.code === 'KeyE') {
      const g = post.grade.uniforms;
      const on = g['uEdgeDarkOpacity'].value === 0;
      g['uEdgeDarkOpacity'].value = on ? 0.64 : 0;
      g['uEdgeLightOpacity'].value = on ? 0.3 : 0;
    }
    if (e.code === 'BracketLeft')  dayNight.timeOfDay = (dayNight.timeOfDay - 0.125 + 1) % 1;
    if (e.code === 'BracketRight') dayNight.timeOfDay = (dayNight.timeOfDay + 0.125) % 1;
  });

  const touch = createTouchControls(fpCam, renderer.domElement);
  const post = createPostFX(renderer, scene, fpCam.camera, (world.streaming.meshes as any).edgeMaterial, tier);

  const settings = createSettings({
    rig: { setZoomRange: () => {} },
    atmo,
    input,
    world: null as any,
    dayNight,
    seed: { currentWord: () => currentSeedWord, push: pushSeedUrl, gen: genSeedWord },
  });
  const hud = createHud({ dayNight, drone: drone as any, camera: fpCam.camera });
  hud.onSettingsClick(() => { if (!settings.open) settings.toggle(); });
  sphereMap.el.style.cssText = 'display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);max-width:90vw;border:2px solid rgba(255,255,255,0.3);border-radius:4px;z-index:20;';
  document.body.appendChild(sphereMap.el);
  const sphereMapToggle = { toggle: () => { sphereMap.el.style.display = sphereMap.el.style.display === 'none' ? 'block' : 'none'; } };
  const pause = createPause({ input, map: sphereMapToggle, onNewWorld: () => { pushSeedUrl(genSeedWord()); location.reload(); } });

  settings.onPaletteChange((name) => {
    setVoxelPalette(name);
    if (atmo.sky?.material?.uniforms) {
      const su = atmo.sky.material.uniforms;
      if (su.uSkyZenith)  su.uSkyZenith.value.copy(SKY.zenith).lerp(SKY.haze, 0.3);
      if (su.uSkyHorizon) su.uSkyHorizon.value.copy(SKY.horizon).lerp(SKY.haze, 0.22);
      if (su.uSkyNadir)   su.uSkyNadir.value.copy(SKY.ground).lerp(SKY.haze, 0.45).multiplyScalar(0.94);
      if (su.uSunGlow)    su.uSunGlow.value.copy(SKY.sunTint).multiplyScalar(0.16);
    }
    if (atmo.hazeColor) {
      atmo.hazeColor.copy(SKY.haze).lerp(SKY.horizon, 0.35);
      if (atmo.scene?.fog?.color) atmo.scene.fog.color.copy(atmo.hazeColor);
    }
    const pd = VOXEL_PALETTES[name];
    if (pd) dayNight.applyNoonSky(pd.sky, pd.light.sunColor);
    if (atmo.hemi) {
      atmo.hemi.color.copy(LIGHT.skyColor);
      atmo.hemi.groundColor.copy(LIGHT.groundColor);
    }
    if (post.grade?.uniforms) {
      const gu = post.grade.uniforms;
      if (gu.uLift)     gu.uLift.value.copy(GRADE.lift);
      if (gu.uGamma)    gu.uGamma.value.copy(GRADE.gamma);
      if (gu.uGain)     gu.uGain.value.copy(GRADE.gain);
      if (gu.uSat)      gu.uSat.value     = GRADE.saturation;
      if (gu.uContrast) gu.uContrast.value = GRADE.contrast;
      if (gu.uVignette) gu.uVignette.value = GRADE.vignette;
      if (gu.toneMappingExposure) gu.toneMappingExposure.value = GRADE.exposure;
    }
    if (post.bloom) {
      post.bloom.strength  = GRADE.bloom.strength;
      post.bloom.radius    = GRADE.bloom.radius;
      post.bloom.threshold = GRADE.bloom.threshold;
    }
  });

  touch.onEdgeToggle(() => {
    const g = post.grade.uniforms;
    const on = g['uEdgeDarkOpacity'].value === 0;
    g['uEdgeDarkOpacity'].value = on ? 0.64 : 0;
    g['uEdgeLightOpacity'].value = on ? 0.3 : 0;
  });
  touch.onTimeBack(    () => { dayNight.timeOfDay = (dayNight.timeOfDay - 0.125 + 1) % 1; });
  touch.onTimeForward( () => { dayNight.timeOfDay = (dayNight.timeOfDay + 0.125) % 1; });
  touch.onDrone(() => { if (!drone.active) enterDrone(); });
  touch.onLand(()  => { if (drone.active)  exitDrone(); });
  touch.onFly(()   => { if (drone.active) exitDrone(); else enterDrone(); });
  touch.onMap(() => pause.toggle());

  // Initial camera frame
  fpCam.updateSphere(1 / 60, controller.dir, controller.groundRadius, 0, true);
  world.streaming.update(controller.dir, undefined);
  const camPos = fpCam.camera.position;
  atmo.followTarget(camPos.x, camPos.z);

  scene.updateMatrixWorld(true);
  scene.matrixWorldAutoUpdate = false;

  addEventListener('resize', () => {
    const w = container.clientWidth, h = container.clientHeight;
    (renderer as any).resizeTo(w, h);
    fpCam.resize(w / h);
    post.setSize(w, h);
  });

  const clock = new THREE.Timer();
  let started = false;
  let perfTime = 0;
  let perfFrames = 0;

  let windTime = 0.0;
  const windDir = new THREE.Vector2(1.0, 0.3).normalize();
  let windAngle = Math.atan2(windDir.y, windDir.x);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__fps = 0;

  function frame(): void {
    requestAnimationFrame(frame);
    clock.update();
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 1 / 20);

    if (rawDt < 0.5) {
      perfTime += rawDt;
      perfFrames++;
      if (perfTime >= 0.75) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__fps = Math.round(perfFrames / perfTime);
        perfTime = 0;
        perfFrames = 0;
      }
    }

    const wish = fpCam.getWishSphere(controller.dir);
    const jumpEdge = fpCam.getJumpEdge();
    const sprint = fpCam.isKeyDown('ShiftLeft') || fpCam.isKeyDown('ShiftRight');

    controller.update(dt, wish, jumpEdge, world.grid, sprint);
    fpCam.updateSphere(dt, controller.dir, controller.groundRadius, controller.speed, controller.isGrounded);

    world.streaming.update(drone.active ? drone.dir : controller.dir, drone.active ? 0.0 : undefined);
    world.streaming.tick(dt);

    const camPos2 = fpCam.camera.position;
    atmo.followTarget(camPos2.x, camPos2.z);
    dayNight.update(dt);

    if (world.sphereWater) {
      world.sphereWater.update(dt);
      world.sphereWater.material.uniforms.uSunDir.value.copy(dayNight.sunDir);
    }

    if (tier !== 'very-low' && voxMat?.userData?.uniforms) {
      const wu = voxMat.userData.uniforms;
      if (wu._windBase > 0) {
        windTime += dt;
        windAngle += dt * 0.04 * (Math.sin(windTime * 0.11) * 0.5 + 0.5);
        windDir.set(Math.cos(windAngle), Math.sin(windAngle));
        const gust = 0.5 + Math.sin(windTime * 0.7) * 0.3 + Math.sin(windTime * 1.3) * 0.2;
        wu.uWindTime.value     = windTime;
        wu.uWindDir.value.copy(windDir);
        wu.uWindStrength.value = wu._windBase * gust;
      }
    }

    {
      const sunDir = dayNight.sunDir;
      _sunWorld.copy(sunDir).multiplyScalar(500).add(fpCam.camera.position);
      _sunNDC.copy(_sunWorld).project(fpCam.camera);
      const sunVisible =
        sunDir.y > -0.1 && Math.abs(_sunNDC.x) < 1.2 && Math.abs(_sunNDC.y) < 1.2
          ? Math.pow(Math.max(0, 0.25 - sunDir.y) / 0.35, 1.5)
          : 0;
      post.setSunScreenPos(_sunNDC.x * 0.5 + 0.5, -_sunNDC.y * 0.5 + 0.5, sunVisible);
    }

    atmo.update(dt, fpCam.camera);
    particles.update(dt, fpCam.camera);
    dog.update(dt, controller.dir);
    sphereMap.update(controller.dir);
    if (drone.active) {
      const droneInput = {
        yaw:      fpCam.drainDroneMX() * 0.0015,
        forward:  (fpCam.isKeyDown('KeyW') ? 1 : 0) - (fpCam.isKeyDown('KeyS') ? 1 : 0),
        strafe:   (fpCam.isKeyDown('KeyD') ? 1 : 0) - (fpCam.isKeyDown('KeyA') ? 1 : 0),
        vertical: fpCam.drainDroneAltDelta(dt),
        land:     false,
        sprint,
      };
      drone.update(dt, droneInput, world.grid, fpCam.camera);
    }
    for (const d of world.animated) d.update(dt);
    touch.update(drone.active, (drone as any).landing ?? false, false);
    hud.update();
    settings.update();

    post.render(dt);

    if (!started) {
      started = true;
      ctrlEl.textContent = isTouchDevice
        ? 'Left stick · move   Swipe right · look   ↑ · jump'
        : 'WASD · move   Mouse · look   Space · jump   E · edges';
      bootEl.classList.add('ready');
      bootEl.addEventListener(
        'click',
        () => {
          hud.showSettingsBtn();
          bootEl.classList.add('dismissed');
          bootEl.addEventListener('transitionend', () => bootEl.classList.add('gone'), { once: true });
          renderer.domElement.requestPointerLock();
        },
        { once: true },
      );
    }
  }

  frame();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__game = { scene, renderer, fpCam, world, controller, post, atmo, dayNight, tier };
}

start().catch((err: unknown) => {
  console.error(err);
  (subEl as HTMLElement).textContent = 'Unable to start';
  (subEl as HTMLElement).classList.add('error');
});
