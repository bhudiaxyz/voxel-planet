/**
 * Main — application entry point: boots the renderer and world, wires input and UI, runs the loop.
 *
 * Purpose
 *   Composition root for the first-person explorer. It owns no gameplay rules itself; it builds
 *   every subsystem (world, atmosphere, post-processing, fx, player modes, UI), connects them,
 *   and drives them once per animation frame. Everything runs inside start() after the
 *   module-level seed and boot-screen setup.
 *
 * Operations
 *   Startup (start(), async; any throw ends in fail() with a hint to add ?tier=low):
 *   - Seed: ?seed=<word> else 'LusaliBenoruLezagi'; hashSeedWord -> SEED; pushSeedUrl() writes it
 *     back to the address bar. Boot progress is shown as "Step i of n" from BOOT_STEPS.
 *   - WebGL2 probe on a throwaway canvas (reports the browser's failure reason), then
 *     detectGpuTier() and createRenderer(). A webglcontextlost handler reloads the page once per
 *     session (sessionStorage flag, re-armed after 60 s of stable running), else shows an error.
 *   - buildSphereWorld(SEED, scene, setProgress, tier options from TIER_SETTINGS) generates and
 *     streams the planet. Then: FPCamera, Atmosphere, DayNight (themed from the active palette),
 *     optional far field (ts.farField) and FOLIAGE_DETAIL define (ts.foliageDetail), stored wind
 *     strength from localStorage, particles/birds/clouds/critters (seeded from SEED), map, the
 *     three movement modes (SphereController walking, drone, fly) and the dog. The walker gets
 *     the vegetation's rock/log map (controller.obstacleAt = veg.obstacleAt) so it can't walk
 *     through boulders, which aren't in the voxel grid.
 *   - Modes: cycleMode (F / touch) goes walk -> drone -> fly -> walk; the drone hands its in-air
 *     position to fly. Landing (L, or fly -> walk) snaps the walker down from the flyer's own
 *     height (snapToDir(dir, grid, fromRadius)), so you land on a floating island when over one.
 *     teleportTo() (Locations panel) steps a few columns off the landmark, faces it, keeps the
 *     current mode, snaps to the planet ground (no fromRadius) and calls streaming.fillNear().
 *   - Other keys: M map, G panels, X dog sit, B block outlines, [ ] step time of day (these
 *     last three need pointer lock or touch). Touch buttons call the same actions.
 *   - Palette live-switch: settings.onPaletteChange calls setVoxelPalette, then copies SKY/LIGHT/
 *     GRADE into sky uniforms, fog, hemisphere light, post grade and bloom, re-bakes the map and
 *     rebuilds terrain (streaming.rebuildAll) and the far field, since colours are baked.
 *   - Shaders are pre-compiled (renderer.compileAsync) before the first frame().
 *   Frame loop, frame(), in order:
 *   1. rAF re-arm; mobile tiers cap at ~60 fps by tracking when the next 60 Hz frame is due
 *      (frameDue), so 120 Hz phones don't do double work and 90/96/144 Hz screens still get 60
 *      (a "15.5 ms since last" rule gave them 45-48). Timer delta; dt clamped to 1/20 s; __fps updated every 0.75 s.
 *   2. Walking: controller.update and fpCam.updateSphere (skipped in drone/fly).
 *   3. streaming.update/tick around the active mode's direction; far-field band follows.
 *   4. atmo.followTarget, dayNight.update, sea water update plus night/sun uniforms.
 *   5. Wind uniforms (gust and slowly turning direction; skipped on 'very-low').
 *   6. Sun screen position for the post chain, atmo.update, particles, dog, birds, clouds
 *      (colours dimmed/cooled at night), cloud shadow pass (only with the sun up), critters.
 *   7. Sphere map redraw, only while visible.
 *   8. Roll and drone/fly update (drone landing hands control back to the walker).
 *   9. Animated world objects, touch, hud, settings; post.render(dt).
 *   10. govern(rawDt, cpuMs) once the boot screen is dismissed; first frame reveals the boot
 *       "enter" prompt.
 *   Dynamic resolution: govern() averages over 2 s windows. If fps < 48 while CPU time is under
 *   60% of the frame (so the GPU is the limit), render scale drops 10% per window to a floor of
 *   70%. It creeps back up 5% after govNeed consecutive windows at >= 54 fps; each failed step
 *   up doubles govNeed (max 48) to avoid oscillation. Hitches (rawDt > 0.25 s) and windows while
 *   terrain is streaming (> STREAM_BUSY queued chunks: slow frames there are mesh uploads, not
 *   fill-rate) are ignored; ?capture=1 disables it. A scale change reallocates the render targets
 *   (hence the damping) and is applied at the start of the next frame, before it draws: resizing
 *   after drawing left the cleared canvas on screen for a frame, a black flicker.
 *   Pause is input-only (ui/pause.ts): the loop and world keep updating by design.
 *
 * Usage
 *   Loaded as the module script by index.html; no other module imports it. Exports
 *   currentSeedWord and pushSeedUrl(word) (both also passed to the settings seed control). URL flags: ?seed=,
 *   ?palette=<theme>, ?tier=<tier>, ?capture=1. Debug hooks: window.__fps and window.__game.
 *
 * See also: world/world.ts, render/postfx.ts, render/gpu-tier.ts, player/*.ts, ui/*.ts;
 * DESIGN.md "3. World assembly", "11. Palette system", "12. GPU tiering", "14. Player".
 */
import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { setVoxelPalette, SKY, LIGHT, GRADE, VOXEL_PALETTES, activePaletteName } from './core/palette';
import { BLOCKS } from './core/blocks';
import { Atmosphere } from './render/lighting';
import { FPCamera, tangentBasis } from './render/fp-camera';
import { createLocations } from './ui/locations';
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
import { wetIdx, WET_MAX } from './world/distance-maps';
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

pushSeedUrl(currentSeedWord);

const _sunWorld = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();
const _dogFwd = new THREE.Vector3();
const _cloudLit = new THREE.Color();
const _cloudShade = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _mapFwd = new THREE.Vector3();
const _upNow = new THREE.Vector3();
/** Moonlit cloud tops at midnight (linear): a dim cool blue-grey. */
const _cloudNight = new THREE.Color(0.035, 0.045, 0.07);
/** Sea surface layer on the sphere (matches sphere-terrain). */
const SEA_LAYER = 11;
/**
 * Butterfly habitat (see butterflyHabitat): full numbers up to BUTTERFLY_FULL_RISE layers
 * above the sea (the coast zone), thinning to none at BUTTERFLY_MAX_RISE (top of the midland
 * zone; zoneOf in world/trees.ts: coast <= 3, lowland <= 7, midland <= 14), and none colder
 * than BUTTERFLY_MIN_WARM on terrain.ts's warmth proxy (1 = warm equator lowland, 0.6 =
 * grassland edge, < 0 = pale upland rock).
 */
const BUTTERFLY_FULL_RISE = 3;
const BUTTERFLY_MAX_RISE = 14;
const BUTTERFLY_MIN_WARM = 0.35;

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
    'preparing shaders',
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

start().catch((err: unknown) => {
    console.error(err);
    // Say why: an out-of-memory RangeError, a shader error and a context failure
    // otherwise all looked identical.
    const why = err instanceof Error ? err.message : String(err);
    fail(`Unable to start: ${why}. Try a lighter profile: add ?tier=low to the address.`);
});

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
        // Storage can throw (blocked / private modes); then just reload once.
        const store = (fn: () => string | null | void) => {
            try {
                return fn();
            } catch {
                return null;
            }
        };
        if (store(() => sessionStorage.getItem(RELOAD_KEY))) {
            fail('The graphics driver reset again. Try a lighter profile: add ?tier=low to the address.');
            return;
        }
        store(() => sessionStorage.setItem(RELOAD_KEY, '1'));
        fail('Graphics reset — reloading…');
        setTimeout(() => location.reload(), 800);
    });
    // A minute of stable running re-arms the one automatic reload.
    setTimeout(() => {
        try {
            sessionStorage.removeItem(RELOAD_KEY);
        } catch {
            /* storage blocked */
        }
    }, 60_000);
    const scene = new THREE.Scene();

    const ts = TIER_SETTINGS[tier];
    const world = await buildSphereWorld(SEED, scene, setProgress, {
        // Phones/tablets classed `mid` (2019-21 Adreno 6xx / Mali-G7x, often 4-6 GB shared with
        // the GPU) stream no further than `mobile-high` does (16): radius 20 is ~500 MB of
        // geometry, and Android kills the GPU process before a laptop would notice.
        streamRadius: isTouchDevice ? Math.min(ts.streamRadius, TIER_SETTINGS['mobile-high'].streamRadius) : ts.streamRadius,
        grassDensity: ts.grassDensity,
        groundDetail: ts.groundDetail,
        shoreFoam: ts.shoreFoam,
        edges: ts.edgeMask,
        buildBudgetMs: ts.buildBudgetMs,
        tier,
    });

    const fpCam = new FPCamera(container.clientWidth / container.clientHeight, renderer.domElement, ts.cameraFar);
    const atmo = new Atmosphere(scene, 800, tier, renderer.capabilities.maxTextureSize);
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
        // Both terrain materials: the solid one and the double-sided leaf one.
        for (const m of (world.streaming.meshes as any).materials ?? [voxMat]) {
            m.defines = { ...(m.defines || {}), FOLIAGE_DETAIL: 1 };
            m.needsUpdate = true;
        }
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
        // Hanging vines (vegetation) ride the same canopy wind as the leaf blocks.
        world.veg.setCanopyWind(voxMat.userData.uniforms);
    }

    const rng = makeRng(SEED);
    // Petals/motes/pollen. 300 is the authored look (more reads as confetti — see
    // particles.ts); the tier budget only ever lowers it on weaker devices.
    // ×0.8: 20% fewer floating petals/motes/pollen than the authored 300, on every tier.
    const particles = createParticles(80, rng, Math.round(Math.min(300, ts.particleCount) * 0.8));
    scene.add(particles.group);
    const birds = createBirds(scene, ts.birdFlock, SEED ^ 0xb1d5);
    const clouds = createClouds(scene, ts.clouds, SEED ^ 0xc10d);
    /**
     * Butterfly habitat 0..1 at a unit direction: 1 on warm coast, falling with altitude
     * to 0 at BUTTERFLY_MAX_RISE, and to 0 as warmth drops to BUTTERFLY_MIN_WARM. Warmth is
     * terrain.ts's surface temperature proxy (latitude² and elevation, AMPLITUDE 24 layers).
     */
    const butterflyHabitat = (d: THREE.Vector3) => {
        const { face, u, v } = dirToFaceUV(d, FACE_RES);
        const rise = world.grid.groundColumnTop(face, u, v) - SEA_LAYER;
        const warm = 1 - 1.1 * d.y * d.y - (1.2 * Math.max(0, rise)) / 24;
        const byHeight = 1 - THREE.MathUtils.smoothstep(rise, BUTTERFLY_FULL_RISE, BUTTERFLY_MAX_RISE);
        const byWarmth = THREE.MathUtils.smoothstep(warm, BUTTERFLY_MIN_WARM, BUTTERFLY_MIN_WARM + 0.25);
        return byHeight * byWarmth;
    };
    const critters = createCritters(
        scene,
        Math.round(ts.critters * 0.8), // 20% fewer butterflies
        {
            groundAt: (d) => {
                const { face, u, v } = dirToFaceUV(d, FACE_RES);
                const top = world.grid.columnTop(face, u, v);
                return top <= SEA_LAYER ? -1 : world.grid.surfaceRadius(face, u, v);
            },
            // Butterflies keep to the lower, warmer land: excluded (-1) above the midland
            // zone and where it's cold; within that, they follow the flower drifts.
            butterflyPref: (d) => (butterflyHabitat(d) > 0 ? world.veg.bloomAt(d) : -1),
            // ...and grow scarcer as you climb: full on the coast, thinning through the
            // lowland and midland to none at the limit (and fewer on cold ground).
            butterflyDensity: (d) => butterflyHabitat(d),
            // Fireflies gather over damp, lush ground by the water.
            fireflyPref: (d) => {
                const { face, u, v } = dirToFaceUV(d, FACE_RES);
                const near = 1 - world.wet[wetIdx(face, u, v)] / WET_MAX;
                return near * 0.7 + world.veg.lushAt(d) * 0.3;
            },
        },
        SEED ^ 0xb077,
        ts.critters * 2, // fireflies unchanged
    );

    const sphereMap = createSphereMap(world.grid);
    const drone = createSphereDroneMode();
    const fly = createSphereFlyMode();
    // The dog obeys the player's walk rules (walk-rules.ts), rocks and logs included.
    const dog = createSphereDog(world.grid, scene, world.spawnDir, (f, u, v) => world.veg.obstacleAt(f, u, v));

    const controller = new SphereController(world.spawnDir, world.grid);
    // Rocks and logs live in the vegetation meshes, not the voxel grid: let the walker see them.
    controller.obstacleAt = (f, u, v) => world.veg.obstacleAt(f, u, v);

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
        // Land on whatever is below the flyer — a floating island included.
        controller.snapToDir(fly.dir, world.grid, fly.groundRadius);
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
    /**
     * Teleport to a landmark (planet-explorer's Locations panel): arrive a few
     * columns off the structure (not inside it), facing it, in whatever mode you
     * were in — walking stays walking, drone and fly re-enter at the new spot.
     * The dog reappears at heel on its own (it runs in when the player is beyond
     * its TELEPORT_DIST).
     */
    const _tpDir = new THREE.Vector3(),
        _tpSide = new THREE.Vector3(),
        _tpFwd = new THREE.Vector3();
    const teleportTo = (r: { dir: THREE.Vector3; sky?: boolean }) => {
        // A tangent step from the landmark: 6 columns for ground, 14 for islands.
        const cols = r.sky ? 14 : 6;
        _tpSide.set(0, 1, 0);
        if (Math.abs(r.dir.y) > 0.9) _tpSide.set(1, 0, 0);
        _tpSide.addScaledVector(r.dir, -_tpSide.dot(r.dir)).normalize();
        const step = (cols * 2) / FACE_RES; // ~one column per (2 / FACE_RES) on the unit cube
        _tpDir.copy(r.dir).addScaledVector(_tpSide, step).normalize();
        // Keep the current mode: leave it, move the walker (which finds the ground
        // radius there), then re-enter the same mode at the new spot.
        const mode = fly.active ? 'fly' : drone.active ? 'drone' : 'walk';
        if (fly.active) {
            fly.exit();
            fpCam.flyActive = false;
        }
        if (drone.active) {
            drone.exit();
            fpCam.droneActive = false;
        }
        controller.snapToDir(_tpDir, world.grid);
        // Face the landmark: yaw so the tangent toward it is 'forward'.
        _tpFwd.copy(r.dir).sub(_tpDir).addScaledVector(_tpDir, -r.dir.clone().sub(_tpDir).dot(_tpDir)).normalize();
        const { fwd, rgt } = tangentBasis(_tpDir, 0);
        fpCam.yaw = -Math.atan2(_tpFwd.dot(rgt), _tpFwd.dot(fwd));
        fpCam.pitch = r.sky ? 0.35 : 0; // look up toward a sky island
        if (mode === 'drone') enterDrone();
        else if (mode === 'fly') enterFly();
        const at = drone.active ? drone.dir : fly.active ? fly.dir : controller.dir;
        world.streaming.fillNear(at); // near view now; the rest streams in on budget
    };
    const locations = createLocations(world.landmarks, teleportTo);
    if (isTouchDevice) locations.hide(); // touch: opened from the ☰ panels button, as in planet-explorer
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
                locations.toggle();
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
    touch.onPanels(() => {
        hud.toggle();
        locations.toggle();
    });
    touch.onLand(land);
    touch.onMap(sphereMapToggle.toggle);
    touch.onDog(() => dog.toggleSit());
    touch.onPause(pause.toggle);

    // Initial camera frame
    fpCam.updateSphere(1 / 60, controller.dir, controller.groundRadius, 0, true);
    world.streaming.update(controller.dir);
    const camPos = fpCam.camera.position;
    atmo.followTarget(camPos);

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

    // Mobile tiers: hold ~60 fps. A 120 Hz phone (e.g. S22 Ultra) otherwise renders
    // everything — including a VSM update — twice as often, and heats and throttles.
    // The cap tracks when the next 60 Hz frame is DUE rather than "15.5 ms since the last
    // one": that rule halved 90 Hz screens to 45 fps (48 at 96 and 144 Hz, 55 at 165), since a
    // frame arriving just early was skipped and the next one was a full refresh late. Now any
    // refresh rate averages 60; 1.5 ms slack absorbs rAF jitter; `due` never lags more than one
    // frame, so a stall doesn't cause a catch-up burst.
    const capFrames = tier === 'mobile-high' || (isTouchDevice && tier !== 'high');
    const FRAME_MS = 1000 / 60;
    let frameDue = 0;

    /*
     * Dynamic resolution: if the GPU can't hold ~48 fps (slow frames while the
     * main thread is mostly idle, i.e. fill-rate bound — the post chain on an
     * older iGPU or phone), shrink the render scale 10% per 2 s window down to
     * 70%; creep back up after a run of good windows. Every failed step up
     * doubles the wait before the next try, so it settles instead of see-sawing
     * (each change reallocates the render targets). Off for ?capture=1.
     * ponytail: single fps heuristic; GPU timer queries if it misjudges a device.
     */
    const governed = new URLSearchParams(location.search).get('capture') !== '1';
    /** Queued chunks above which the governor ignores frame times (streaming, not GPU-bound). */
    const STREAM_BUSY = 24;
    let govScale = 1,
        govT = 0,
        govFrames = 0,
        govCpu = 0,
        govGood = 0,
        govNeed = 3,
        govLastUp = false;
    /**
     * Applied at the START of a frame (pendingScale), not where govern() decides: resizing the
     * canvas clears it, and doing that after the frame was drawn let the browser show the empty
     * near-black canvas for a frame (a black flicker, most often in fly/drone while streaming).
     */
    let pendingScale = 0;
    const setScale = (s: number) => {
        pendingScale = s;
    };
    const applyScale = (s: number) => {
        govScale = Math.round(s * 100) / 100;
        (renderer as any).setRenderScale(govScale);
        const w = container.clientWidth,
            h = container.clientHeight;
        (renderer as any).resizeTo(w, h);
        post.setSize(w, h);
    };
    const govern = (rawDt: number, cpuMs: number) => {
        if (!governed || rawDt > 0.25) return; // tab switch / hitch: not a GPU signal
        // While terrain is streaming in (a teleport, entering drone/fly, a palette
        // rebuild) the slow frames are mesh uploads, not fill-rate: shrinking the
        // resolution would not help and it stuck at the 70% floor afterwards. Discard
        // the window and judge only settled frames.
        if (world.streaming.pendingCount > STREAM_BUSY) {
            govT = govFrames = govCpu = 0;
            govGood = 0;
            return;
        }
        govT += rawDt;
        govFrames++;
        govCpu += cpuMs;
        if (govT < 2) return;
        const fps = govFrames / govT,
            cpu = govCpu / govFrames,
            frameMs = 1000 / fps;
        govT = govFrames = govCpu = 0;
        if (fps < 48 && cpu < frameMs * 0.6 && govScale > 0.7) {
            if (govLastUp) govNeed = Math.min(govNeed * 2, 48); // the last step up didn't hold
            govLastUp = false;
            govGood = 0;
            setScale(Math.max(0.7, govScale - 0.1));
        } else if (fps >= 54 && govScale < 1) {
            // 54, not 57: a vsync'd 60 Hz display rarely reports a clean 57+ average with
            // a few streaming frames mixed in, and the scale never climbed back.
            if (++govGood >= govNeed) {
                govGood = 0;
                govLastUp = true;
                setScale(Math.min(1, govScale + 0.05));
            }
        } else {
            govGood = 0;
            govLastUp = false;
        }
    };

    function frame(now = performance.now()): void {
        requestAnimationFrame(frame);
        if (capFrames) {
            if (now < frameDue - 1.5) return;
            frameDue = Math.max(frameDue + FRAME_MS, now - FRAME_MS);
        }
        const cpuStart = performance.now();
        if (pendingScale) {
            // Before this frame draws, so the resized (cleared) canvas is repainted in the same task.
            applyScale(pendingScale);
            pendingScale = 0;
        }
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
        atmo.followTarget(camPos2);
        dayNight.update(dt);

        if (world.sphereWater) {
            world.sphereWater.update(dt, dayNight.getNightFactor());
            post.grade.uniforms.uNight.value = dayNight.getNightFactor();
            world.sphereWater.material.uniforms.uSunDir.value.copy(dayNight.sunDir);
            // Live (time-of-day) sun colour, so the glint turns gold at sunset.
            world.sphereWater.material.uniforms.uSunColor.value.copy(atmo.sun.color);
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
            // The haze pass ignores cloud shadows when the sun is low (sunUp <= 0.05),
            // so skip the extra render-target pass then — costly on tile GPUs.
            if (post.haze.uniforms.uCloudShadow.value > 0.5 && dayNight.sunDir.dot(_upNow.copy(at).normalize()) > 0.05)
                clouds.renderShadow(renderer);
            critters.update(dt, at, night, renderer.getPixelRatio());
        }
        // The map redraw is a 2 MB putImageData plus labels — only while it's open.
        if (sphereMap.el.style.display !== 'none') {
            const mapDir = drone.active ? drone.dir : fly.active ? fly.dir : controller.dir;
            const mapFwd = drone.active
                ? drone.heading
                : controller.forwardInPlane(fpCam.camera.getWorldDirection(_mapFwd));
            sphereMap.update(mapDir, mapFwd, world.landmarks);
        }
        if (drone.active || fly.active) fpCam.updateRoll(dt);
        else fpCam.roll = 0;
        if (drone.active) {
            const droneInput = {
                yaw: fpCam.drainDroneMX(),
                pitch: fpCam.pitch,
                roll: fpCam.roll,
                yawKey: (fpCam.isKeyDown('KeyD') ? 1 : 0) - (fpCam.isKeyDown('KeyA') ? 1 : 0) + fpCam._joyX,
                forward: (fpCam.isKeyDown('KeyW') ? 1 : 0) - (fpCam.isKeyDown('KeyS') ? 1 : 0) + fpCam._joyY,
                vertical: fpCam.drainDroneAltDelta(dt),
                land: false,
                sprint,
            };
            drone.update(dt, droneInput, world.grid, fpCam.camera);
            // Landing completed inside drone.update — sync controller and re-lock
            if (!drone.active && fpCam.droneActive) {
                controller.snapToDir(drone.dir, world.grid, PLANET_RADIUS + drone.altitude + 1);
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
        // Only once the player is in: the boot screen's frames say nothing about play.
        if (bootEl.classList.contains('dismissed')) govern(rawDt, performance.now() - cpuStart);

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

    // Compile every program before the first frame. Otherwise the big voxel
    // shader and its shadow/depth/edge variants compiled synchronously on the
    // first render — seconds of frozen screen on Mali/Adreno after the bar read
    // 100%. With KHR_parallel_shader_compile this runs off the main thread; without
    // it compileAsync still front-loads the work behind the labelled step.
    setProgress(0.95, 'preparing shaders');
    try {
        await renderer.compileAsync(scene, fpCam.camera);
    } catch (err) {
        console.warn('shader pre-compile failed; compiling on first frame', err);
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

export function pushSeedUrl(word: string) {
    const p = new URLSearchParams(location.search);
    p.set('seed', word);
    history.replaceState(null, '', '?' + p.toString());
}
