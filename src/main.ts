import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { setVoxelPalette, SKY, LIGHT, GRADE, VOXEL_PALETTES, activePaletteName, BLOCKS } from './core/palette';
import { Atmosphere } from './render/lighting';
import { FPCamera } from './render/fp-camera';
import { createPostFX } from './render/postfx';
import { buildSphereWorld } from './world/world';
import { DayNight } from './render/day-night';
import { SphereController } from './player/controller';
import { createPause } from './ui/pause';
import { createSettings, DEFAULTS as SETTINGS_DEFAULTS } from './ui/settings';
import { createHud } from './ui/hud';
import { makeRng, genSeedWord, hashSeedWord } from './core/rng';
import { detectGpuTier, TIER_SETTINGS } from './render/gpu-tier';
import { createTouchControls, isTouchDevice } from './ui/touch-controls';
import { createParticles } from './fx/particles';
import { createBirds } from './fx/birds';
import { createClouds } from './fx/clouds';
import { createCritters } from './fx/critters';
import { wetIdx, WET_MAX } from './world/wet-map';
import { dirToFaceUV } from './core/geoutil';
import { createSphereMap } from './render/map';
import { createSphereDroneMode } from './player/drone';
import { createFarField } from './core/voxel';
import { createSphereFlyMode } from './player/fly';
import { createSphereDog } from './player/dog';
import { PLANET_RADIUS, FACE_RES } from './core/voxel';

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
const _dogFwd = new THREE.Vector3();
const _cloudLit = new THREE.Color();
const _cloudShade = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
/** Moonlit cloud tops at midnight (linear): a dim cool blue-grey. */
const _cloudNight = new THREE.Color(0.035, 0.045, 0.07);
/** Sea surface layer on the sphere (matches sphere-terrain). */
const SEA_LAYER = 11;

const container = document.getElementById('app')!;
const bootEl = document.getElementById('boot')!;
const barEl = bootEl.querySelector('.ls-bar span')!;
const subEl = bootEl.querySelector('.ls-sub')!;
const ctrlEl = bootEl.querySelector('.ls-controls') as HTMLElement;

/** Startup steps in order; the boot line reads "Step i of n: …". Add new stages here. */
const BOOT_STEPS = [
    'sculpting the planet',
    'carving rivers & lakes',
    'growing forests',
    'placing landmarks',
    'building terrain meshes',
    'adding ocean',
];
const setProgress = (p: number, s?: string): void => {
    (barEl as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    if (p >= 1) ctrlEl.textContent = '';
    else if (s) {
        const i = BOOT_STEPS.indexOf(s);
        ctrlEl.textContent = i >= 0 ? `Step ${i + 1} of ${BOOT_STEPS.length}: ${s}` : s;
    }
};

const fail = (msg: string) => {
    (subEl as HTMLElement).textContent = msg;
    (subEl as HTMLElement).classList.add('error');
    (barEl as HTMLElement).style.width = '0';
};

async function start(): Promise<void> {
    // three r163+ is WebGL2-only; say so plainly instead of throwing deep in the renderer.
    // The browser reports *why* creation failed (disabled, blocked after GPU
    // crashes, no hardware acceleration) only through this event.
    const probe = document.createElement('canvas');
    let reason = '';
    probe.addEventListener('webglcontextcreationerror', (e) => {
        reason = (e as WebGLContextEvent).statusMessage || '';
    });
    const gl2 = probe.getContext('webgl2');
    if (!gl2) {
        console.error('WebGL 2 context creation failed:', reason || '(no reason given)');
        fail(
            `WebGL 2 is unavailable${reason ? `: ${reason}` : ''}. ` +
                'Check hardware acceleration is on, then fully restart the browser.',
        );
        return;
    }
    gl2.getExtension('WEBGL_lose_context')?.loseContext();
    const tier = detectGpuTier();
    const renderer = createRenderer(container, tier);
    // Mobile GPUs drop the context when backgrounded or memory-starved. Streamed
    // chunks and render targets would all need rebuilding, so reload instead.
    // Reload at most once per session: repeated GPU resets make Chrome block
    // WebGL for the whole site, which then fails every load until a restart.
    const RELOAD_KEY = 'voxel-planet.gl-reloaded';
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        if (sessionStorage.getItem(RELOAD_KEY)) {
            fail('The graphics driver reset again. Try a lighter profile: add ?tier=low to the address.');
            return;
        }
        sessionStorage.setItem(RELOAD_KEY, '1');
        fail('Graphics reset — reloading…');
        setTimeout(() => location.reload(), 800);
    });
    // A minute of stable running re-arms the one automatic reload.
    setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 60_000);
    const scene = new THREE.Scene();

    const ts = TIER_SETTINGS[tier];
    const world = await buildSphereWorld(SEED, scene, setProgress, {
        streamRadius: ts.streamRadius,
        grassDensity: ts.grassDensity,
        groundDetail: ts.groundDetail,
        shoreFoam: ts.shoreFoam,
        tier,
    });

    const fpCam = new FPCamera(container.clientWidth / container.clientHeight, renderer.domElement, ts.cameraFar);
    const atmo = new Atmosphere(scene, 800, tier);
    const dayNight = new DayNight(atmo, renderer);
    {
        // The day cycle has its own sky keyframes; theme them with the starting
        // palette (?palette=…) too, not only when switched from the settings menu.
        const pd = VOXEL_PALETTES[activePaletteName];
        if (pd) dayNight.applyNoonSky(pd.sky, pd.light.sunColor);
    }
    dayNight.voxelUniforms = (world.streaming.meshes as any).material?.userData?.uniforms;

    const voxMat = (world.streaming.meshes as any).material;
    // Far field: the rest of the planet, low-res, fading in where the chunks fade out.
    const farField = ts.farField ? createFarField(world.grid, voxMat, SEA_LAYER) : null;
    if (farField) {
        const [near, far] = world.streaming.fadeBand;
        farField.setBand(near, far);
        scene.add(farField.mesh);
    }
    if (ts.foliageDetail && voxMat) {
        // Leaf-cluster shading on canopy blocks; a define, so tiers without it pay nothing.
        voxMat.defines = { ...(voxMat.defines || {}), FOLIAGE_DETAIL: 1 };
        voxMat.needsUpdate = true;
    }
    if (voxMat?.userData?.uniforms) {
        let storedWind = SETTINGS_DEFAULTS.windStrength;
        try {
            const raw = localStorage.getItem('VoxelWorld.settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                const n = Number(parsed.windStrength);
                if (Number.isFinite(n)) storedWind = n;
            }
        } catch {
            /* ignore */
        }
        voxMat.userData.uniforms._windBase = storedWind;
    }

    const rng = makeRng(SEED);
    // Petals/motes/pollen. 300 is the authored look (more reads as confetti — see
    // particles.ts); the tier budget only ever lowers it on weaker devices.
    const particles = createParticles(80, rng, Math.min(300, ts.particleCount));
    scene.add(particles.group);
    const birds = createBirds(scene, ts.birdFlock, SEED ^ 0xb1d5);
    const clouds = createClouds(scene, ts.clouds, SEED ^ 0xc10d);
    const critters = createCritters(
        scene,
        ts.critters,
        {
            groundAt: (d) => {
                const { face, u, v } = dirToFaceUV(d, FACE_RES);
                const top = world.grid.columnTop(face, u, v);
                return top <= SEA_LAYER ? -1 : world.grid.surfaceRadius(face, u, v);
            },
            // Butterflies follow the flower drifts.
            butterflyPref: (d) => world.veg.bloomAt(d),
            // Fireflies gather over damp, lush ground by the water.
            fireflyPref: (d) => {
                const { face, u, v } = dirToFaceUV(d, FACE_RES);
                const near = 1 - world.wet[wetIdx(face, u, v)] / WET_MAX;
                return near * 0.7 + world.veg.lushAt(d) * 0.3;
            },
        },
        SEED ^ 0xb077,
    );

    const sphereMap = createSphereMap(world.grid);
    const drone = createSphereDroneMode();
    const fly = createSphereFlyMode();
    const dog = createSphereDog(world.grid, scene, world.spawnDir);

    const controller = new SphereController(world.spawnDir, world.grid);

    const canAct = () => fpCam.isLocked || fpCam.touchActive;

    const enterDrone = () => {
        if (fly.active) fly.exit();
        drone.enter(controller.dir, controller.groundRadius);
        fpCam.droneActive = true;
    };
    const enterFly = () => {
        if (drone.active) {
            // Preserve drone's in-air position rather than snapping to surface first
            const fromDir = drone.dir.clone();
            const fromRadius = drone.altitude + PLANET_RADIUS;
            drone.exit();
            fpCam.droneActive = false;
            fly.enter(fromDir, fromRadius);
        } else {
            fly.enter(controller.dir, controller.groundRadius);
        }
        fpCam.flyActive = true;
    };
    const exitFly = () => {
        controller.snapToDir(fly.dir, world.grid);
        fly.exit();
        fpCam.flyActive = false;
        if (!fpCam.isLocked && !fpCam.touchActive) renderer.domElement.requestPointerLock();
    };

    // Actions shared by keyboard and touch buttons.
    /** F / ✈ — cycle walk → drone → fly → walk, as in planet-explorer. */
    const cycleMode = () => {
        if (fly.active) exitFly();
        else if (drone.active)
            enterFly(); // hands over at the drone's current position
        else enterDrone();
    };
    /** L / 🛬 — land from either air mode. */
    const land = () => {
        if (drone.active) drone.beginLanding();
        else if (fly.active) exitFly();
    };
    const toggleEdges = () => {
        const g = post.grade.uniforms;
        const on = g['uEdgeDarkOpacity'].value === 0;
        g['uEdgeDarkOpacity'].value = on ? 0.64 : 0;
        g['uEdgeLightOpacity'].value = on ? 0.3 : 0;
    };
    const stepTime = (dir: 1 | -1) => {
        dayNight.timeOfDay = (dayNight.timeOfDay + dir * 0.125 + 1) % 1;
    };

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.repeat) return;
        // Keys shared with planet-explorer: F cycle mode, L land, M map, G panels.
        // These work even without pointer lock.
        switch (e.code) {
            case 'KeyF':
                cycleMode();
                return;
            case 'KeyL':
                land();
                return;
            case 'KeyM':
                sphereMapToggle.toggle();
                return;
            case 'KeyG':
                hud.toggle();
                return;
            // voxel-planet extras, on keys planet-explorer leaves free:
            case 'KeyX': // dog sit / stand
                dog.toggleSit();
                return;
        }
        if (!canAct()) return;
        if (e.code === 'KeyB') toggleEdges(); // B for block outlines (E is roll in planet-explorer)
        if (e.code === 'BracketLeft') stepTime(-1);
        if (e.code === 'BracketRight') stepTime(1);
    });

    const touch = createTouchControls(fpCam, renderer.domElement);
    const post = createPostFX(renderer, scene, fpCam.camera, (world.streaming.meshes as any).edgeMaterial, tier);
    // Voxel-cloud shadows: bind the live cloud frame once (the vectors update in
    // place each frame); the coverage map is redrawn in the frame loop.
    if (clouds.shadow) {
        const hu = post.haze.uniforms;
        hu.tCloudMap.value = clouds.shadow.map;
        hu.uCloudCentre.value = clouds.shadow.centre;
        hu.uCloudE1.value = clouds.shadow.e1;
        hu.uCloudE2.value = clouds.shadow.e2;
        hu.uCloudUp.value = clouds.shadow.up;
        hu.uCloudRadius.value = clouds.shadow.radius;
        hu.uCloudLayerH.value = clouds.shadow.layerH;
    } else post.haze.uniforms.uCloudShadow.value = 0;

    const settings = createSettings({
        rig: { setZoomRange: () => {} },
        atmo,
        input: fpCam,
        world: { streaming: world.streaming } as any,
        dayNight,
        seed: { currentWord: () => currentSeedWord, push: pushSeedUrl, gen: genSeedWord },
    });
    const hud = createHud({ dayNight, drone });
    hud.onSettingsClick(() => {
        if (!settings.open) settings.toggle();
    });
    sphereMap.el.style.cssText = `display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${sphereMap.displayW}px;height:${sphereMap.displayH}px;max-width:90vw;max-height:90vh;border:2px solid rgba(255,255,255,0.3);border-radius:4px;z-index:20;`;
    document.body.appendChild(sphereMap.el);
    if (isTouchDevice)
        sphereMap.el.addEventListener('click', () => {
            sphereMap.el.style.display = 'none';
        });
    const sphereMapToggle = {
        toggle: () => {
            sphereMap.el.style.display = sphereMap.el.style.display === 'none' ? 'block' : 'none';
        },
    };
    const pause = createPause({ input: fpCam, map: sphereMapToggle });

    settings.onPaletteChange((name) => {
        setVoxelPalette(name);
        if (atmo.sky?.material?.uniforms) {
            const su = atmo.sky.material.uniforms;
            if (su.uSkyZenith) su.uSkyZenith.value.copy(SKY.zenith).lerp(SKY.haze, 0.3);
            if (su.uSkyHorizon) su.uSkyHorizon.value.copy(SKY.horizon).lerp(SKY.haze, 0.22);
            if (su.uSkyNadir) su.uSkyNadir.value.copy(SKY.ground).lerp(SKY.haze, 0.45).multiplyScalar(0.94);
            if (su.uSunGlow) su.uSunGlow.value.copy(SKY.sunTint).multiplyScalar(0.16);
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
            if (gu.uLift) gu.uLift.value.copy(GRADE.lift);
            if (gu.uGamma) gu.uGamma.value.copy(GRADE.gamma);
            if (gu.uGain) gu.uGain.value.copy(GRADE.gain);
            if (gu.uSat) gu.uSat.value = GRADE.saturation;
            if (gu.uContrast) gu.uContrast.value = GRADE.contrast;
            if (gu.uVignette) gu.uVignette.value = GRADE.vignette;
            if (gu.toneMappingExposure) gu.toneMappingExposure.value = GRADE.exposure;
        }
        if (post.bloom) {
            post.bloom.strength = GRADE.bloom.strength;
            post.bloom.radius = GRADE.bloom.radius;
            post.bloom.threshold = GRADE.bloom.threshold;
        }
        sphereMap.rebake();
        // Terrain and vegetation colours are baked into their meshes: rebuild them so
        // the new palette applies to the ground and trees, not just sky and light.
        world.streaming.rebuildAll(fly.active ? fly.dir : drone.active ? drone.dir : controller.dir);
        farField?.rebuild();
    });

    touch.onEdgeToggle(toggleEdges);
    touch.onTimeBack(() => stepTime(-1));
    touch.onTimeForward(() => stepTime(1));
    touch.onCycle(cycleMode);
    touch.onPanels(() => hud.toggle());
    touch.onLand(land);
    touch.onMap(sphereMapToggle.toggle);
    touch.onDog(() => dog.toggleSit());
    touch.onPause(pause.toggle);

    // Initial camera frame
    fpCam.updateSphere(1 / 60, controller.dir, controller.groundRadius, 0, true);
    world.streaming.update(controller.dir);
    const camPos = fpCam.camera.position;
    atmo.followTarget(camPos.x, camPos.z);

    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = false;

    addEventListener('resize', () => {
        const w = container.clientWidth,
            h = container.clientHeight;
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

        const wish = fpCam.getWishSphere(fly.active ? fly.dir : controller.dir);
        const jumpEdge = fpCam.getJumpEdge();
        const sprint = fpCam.isKeyDown('ShiftLeft') || fpCam.isKeyDown('ShiftRight');

        if (!drone.active && !fly.active) {
            controller.update(dt, wish, jumpEdge, world.grid, sprint);
            fpCam.updateSphere(dt, controller.dir, controller.groundRadius, controller.speed, controller.isGrounded);
        }

        const streamDir = drone.active ? drone.dir : fly.active ? fly.dir : controller.dir;
        world.streaming.update(streamDir);
        world.streaming.tick(dt);
        if (farField) {
            // Follow the settings slider: the far field always starts where the chunks end.
            const [near, far] = world.streaming.fadeBand;
            farField.setBand(near, far);
        }

        const camPos2 = fpCam.camera.position;
        atmo.followTarget(camPos2.x, camPos2.z);
        dayNight.update(dt);

        if (world.sphereWater) {
            world.sphereWater.update(dt, dayNight.getNightFactor());
            world.sphereWater.material.uniforms.uSunDir.value.copy(dayNight.sunDir);
        }

        if (tier !== 'very-low' && voxMat?.userData?.uniforms) {
            const wu = voxMat.userData.uniforms;
            if (wu._windBase > 0) {
                windTime += dt;
                windAngle += dt * 0.04 * (Math.sin(windTime * 0.11) * 0.5 + 0.5);
                windDir.set(Math.cos(windAngle), Math.sin(windAngle));
                const gust = 0.5 + Math.sin(windTime * 0.7) * 0.3 + Math.sin(windTime * 1.3) * 0.2;
                wu.uWindTime.value = windTime;
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
        fpCam.camera.getWorldDirection(_dogFwd);
        dog.update(dt, controller.dir, _dogFwd);
        {
            const night = dayNight.getNightFactor();
            const at = fpCam.camera.position;
            birds.update(dt, at, _dogFwd, night);
            clouds.update(dt, at, windDir);
            // Sunlit tops brighter than the sky (so they read against pale haze as well
            // as blue), cool shaded undersides; both dim and cool at night.
            // Clouds are unlit and write no depth (the haze pass skips them), so
            // their night colour must be authored dark here: a dim moonlit blue-grey
            // (~3% of the day value) over near-black undersides. The old ×0.25 floor
            // left them glowing light grey against the night sky.
            const moon = 1 - night;
            _cloudLit
                .copy(_white)
                .multiplyScalar(1.35)
                .lerp(SKY.horizon, 0.15)
                .multiplyScalar(0.03 + 0.97 * moon * moon)
                .lerp(_cloudNight, night * 0.6);
            _cloudShade
                .copy(SKY.zenith)
                .lerp(_white, 0.35)
                .multiplyScalar(0.78 * (0.02 + 0.98 * moon * moon));
            clouds.setColors(_cloudLit, _cloudShade, 0.95 - night * 0.35);
            if (post.haze.uniforms.uCloudShadow.value > 0.5) clouds.renderShadow(renderer);
            critters.update(dt, at, night, renderer.getPixelRatio());
        }
        const mapDir = drone.active ? drone.dir : fly.active ? fly.dir : controller.dir;
        const mapFwd = drone.active
            ? drone.heading
            : controller.forwardInPlane(fpCam.camera.getWorldDirection(new THREE.Vector3()));
        sphereMap.update(mapDir, mapFwd, world.landmarks);
        if (drone.active) {
            const droneInput = {
                yaw: fpCam.drainDroneMX() * 0.0015,
                yawKey: (fpCam.isKeyDown('KeyD') ? 1 : 0) - (fpCam.isKeyDown('KeyA') ? 1 : 0) + fpCam._joyX,
                forward: (fpCam.isKeyDown('KeyW') ? 1 : 0) - (fpCam.isKeyDown('KeyS') ? 1 : 0) + fpCam._joyY,
                vertical: fpCam.drainDroneAltDelta(dt),
                land: false,
                sprint,
            };
            drone.update(dt, droneInput, world.grid, fpCam.camera);
            // Landing completed inside drone.update — sync controller and re-lock
            if (!drone.active && fpCam.droneActive) {
                controller.snapToDir(drone.dir, world.grid);
                fpCam.droneActive = false;
                if (!fpCam.isLocked && !fpCam.touchActive) renderer.domElement.requestPointerLock();
            }
        } else if (fly.active) {
            fly.update(dt, wish, fpCam.drainDroneAltDelta(dt), sprint, world.grid, fpCam.camera);
            // Use normal sphere camera update (mouse yaw/pitch applies, up = fly.dir)
            fpCam.updateSphere(dt, fly.dir, fly.groundRadius, 0, false);
        }
        for (const d of world.animated) d.update(dt);
        touch.update(drone.active, (drone as any).landing ?? false, fly.active);
        hud.update();
        settings.update();

        post.render(dt);

        if (!started) {
            started = true;
            ctrlEl.textContent = isTouchDevice
                ? 'Left thumb · move   Right drag · look   ↑ · jump   ✈ · walk / drone / fly   ⏸ · controls'
                : 'WASD · move   Mouse · look   Space · jump   F · walk / drone / fly   L · land   M · map';
            if (isTouchDevice) bootEl.querySelector('.ls-enter')!.textContent = 'Tap to enter';
            bootEl.classList.add('ready');
            bootEl.addEventListener(
                'click',
                () => {
                    hud.showSettingsBtn();
                    bootEl.classList.add('dismissed');
                    bootEl.addEventListener('transitionend', () => bootEl.classList.add('gone'), { once: true });
                    if (!isTouchDevice) renderer.domElement.requestPointerLock();
                },
                { once: true },
            );
        }
    }

    frame();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__game = {
        scene,
        renderer,
        fpCam,
        world,
        controller,
        post,
        atmo,
        dayNight,
        tier,
        dog,
        blocks: BLOCKS,
    };
}

start().catch((err: unknown) => {
    console.error(err);
    fail('Unable to start');
});
