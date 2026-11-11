# Voxel Planet — Design & Architecture

Developer reference. For user-facing documentation see [README.md](README.md).

The active game mode is the **sphere world** (`buildSphereWorld`). The flat-world pipeline (`buildWorld`, `planner.ts`, `terrain.ts`, etc.) still exists in the codebase as a reference implementation but is not the entry point.

---

## Source layout

```text
src/
├── main.ts                      ← entry point: sphere world init, game loop, input wiring, drone/fly/dog/map
│
├── core/
│   ├── palette.ts               ← art bible: all colours, BLOCK_BY_ID, setVoxelPalette(), GRADE/SKY/LIGHT/WATER/FOG constants
│   ├── sphere-voxel.ts          ← SphereVoxelGrid (6-face cubemap), PLANET_RADIUS=350, FACE_RES=400, SHELL_DEPTH=96
│   │                               columnTop(), groundColumnTop(), surfaceRadius(), isSolid(), createSphereChunkStreamer()
│   ├── voxel.ts                 ← VoxelGrid (flat world, dense Uint8Array), greedy mesher, chunk streamer
│   ├── geoutil.ts               ← dirToFaceUV(), columnDir(), basisFromCode(), crossFaceUV()
│   └── rng.ts                   ← seeded PRNG, 2D/3D noise, FBM helpers
│
├── world/
│   ├── world.ts                 ← buildSphereWorld() (active), buildWorld() (flat world reference)
│   ├── sphere-terrain.ts        ← generateSphereTerrain(): FBM sculpt, voxel fill, tree/vegetation scatter
│   │                               plantSphereTree(), plantSphereBush(), plantSingle()
│   ├── sphere-landmarks.ts      ← buildSphereLandmarks() → LandmarkRecord[]; 7 landmark builders
│   ├── sphere-vegetation.ts     ← scatterSphereVegetation(): animated grass/foliage on sphere
│   ├── water.ts                 ← createSphereWater() (sphere water sphere), createWater() (flat world)
│   ├── planner.ts               ← (flat world) planWorld(): island layout, bridge chains, rivers
│   ├── terrain.ts               ← (flat world) generateTerrain(): contour-disc terracing, river carving
│   ├── vegetation.ts            ← (flat world) plantTree() (14 forms), BIOME_FLORA tables
│   ├── props.ts                 ← (flat world) bridges, rocks
│   └── stamps.ts                ← (flat world) scenic + landmark grammars
│
├── render/
│   ├── renderer.ts              ← WebGLRenderer setup, shadow map config per tier
│   ├── lighting.ts              ← Atmosphere: sun/hemi/fill lights, sky dome mesh
│   ├── sky.ts                   ← shared GLSL: SKY_UNIFORMS_GLSL, SKY_FN_GLSL (skyRadiance, nightSkyAddons, _aurora)
│   ├── day-night.ts             ← DayNight: keyframe palette animation, getNightFactor(), aurora uniforms
│   ├── postfx.ts                ← createPostFX(): SceneDepth → EdgeMask → Atmosphere → Bloom → Crepuscular → Grade → SMAA
│   ├── sphere-map.ts            ← createSphereMap(): equirectangular terrain bake, player arrow, landmark icons + tooltips
│   ├── planet.glsl.ts           ← PLANET_BEND_GLSL vertex snippet (flat world bend), updatePlanetUniforms()
│   ├── fp-camera.ts             ← FPCamera: pointer lock, key/mouse/joystick state, tangentBasis(), paused gate, drainDroneAltDelta()
│   └── gpu-tier.ts              ← detectGpuTier(), TIER_SETTINGS table (high/mobile-high/mid/low/very-low)
│
├── player/
│   ├── sphere-controller.ts     ← SphereController: sphere-surface physics, snapToDir(), forwardInPlane()
│   ├── sphere-drone.ts          ← createSphereDroneMode(): P-controller terrain-follow on sphere, landing state machine
│   ├── sphere-fly.ts            ← createSphereFlyMode(): sphere free-flight, columnTop-based terrain floor
│   └── sphere-dog.ts            ← createSphereDog(): dog heels to the player along the surface, reappears if left far behind
│
├── ui/
│   ├── touch-controls.ts        ← createTouchControls(): nippleJS joystick, swipe-to-look, button wiring
│   ├── hud.ts                   ← heads-up display overlays
│   ├── pause.ts                 ← pause menu + controls list
│   └── settings.ts              ← settings panel
│
└── fx/
    └── particles.ts             ← billboarded particle system (leaves, dust)
```

---

## Sphere world architecture

### SphereVoxelGrid (`src/core/sphere-voxel.ts`)

The planet surface is stored as a 6-face cubemap. Each face is a `FACE_RES × FACE_RES × SHELL_DEPTH` voxel volume:

| Constant | Value | Meaning |
| --- | --- | --- |
| `PLANET_RADIUS` | 350 | World-space units from centre to surface layer 0 |
| `FACE_RES` | 400 | Face resolution in voxels (each face is 400 × 400 columns) |
| `SHELL_DEPTH` | 96 | Radial voxel layers per column (layers 0–95 outward) |

**Addressing** — `grid.get(face, u, v, layer)` / `grid.set(...)`. Face 0–5 follow cube-face convention. `u` and `v` are column coordinates (0–399); `layer` is the radial depth (0 = deepest, SHELL_DEPTH−1 = highest possible).

**Key methods:**
- `columnTop(face, u, v)` — highest solid layer in the column (`surfaceLayer` cache, O(1)).
- `groundColumnTop(face, u, v)` — highest non-foliage, non-trunk layer (scans down from `columnTop`, skips blocks with `sway` or `isTrunk`). Used for player physics so the player walks on ground, not treetops.
- `surfaceRadius(face, u, v)` — world-space radius above planet centre: `PLANET_RADIUS + groundColumnTop + 1`. Used for player/drone height calculations.
- `isSolid(face, u, v, layer)` — respects cross-face seams via `crossFaceUV()`.

**Column direction** — `columnDir(face, u, v, FACE_RES, out)` in `geoutil.ts` converts a face UV to a world-space unit vector pointing outward from the planet centre. Used by the terrain scatter pass and landmark placement to record world-space `dir` vectors.

### Sphere terrain generation (`src/world/sphere-terrain.ts`)

`generateSphereTerrain(seed, onProgress)` runs once per seed:

1. **FBM height field** — for each face column, a multi-octave FBM sample of the world-space unit direction gives a `[0,1]` height value. This is multiplied by a continentality mask (based on `dir.y` and longitude noise) to separate land from ocean.
2. **Voxel fill** — columns below the height threshold are filled from layer 0 up to `heightLayer`, using biome-appropriate block IDs (grass, soil, stone, sand near coast). Ocean columns are left as air (the water sphere covers them).
3. **Scatter pass** — after fill, a second pass seeds trees, bushes, ferns, shrubs, reeds, and tall grass with biome-appropriate density. Thresholds (example): roll < 0.012 → tree, < 0.042 → bush, < 0.065 → fern/fern_red, < 0.080 → grass_tall/shrub_tall. Reeds are placed at waterline columns.

**Tree placement** — `plantSphereTree(grid, face, u, v, rng, scale)` builds a trunk column plus a canopy box fill via the `fill(ou, oy, ov, su, sy, sv, id)` helper (places a box offset from trunk top in face-local UV+layer coords). Four forms: `spire`, `palm`, `broad`, `weeping`. Trunk heights are 4–16 layers with ±1–2 random jitter so adjacent trees vary in height. Canopy fills use `sy ≥ 2` for volume.

### Sphere controller (`src/player/sphere-controller.ts`)

`SphereController` replaces AABB physics with sphere-surface physics:

- **State** — `dir: THREE.Vector3` (unit outward direction from planet centre) + `groundRadius: number` (distance from centre to eye).
- **Movement** — each frame, `getWishSphere()` projects camera forward/right onto the tangent plane at `dir`. The wish vector is converted to a rotation axis (`cross(dir, wish)`) and `dir` is rotated by `speed * dt / groundRadius` radians.
- **Ground adherence** — `groundRadius` is clamped each frame to `surfaceRadius(face,u,v) + EYE_HEIGHT` (1.75 m), keeping the player on the terrain surface.
- **`snapToDir(newDir, grid)`** — teleports to `newDir`, re-queries surface radius, zeroes vertical velocity. Called when exiting drone or fly mode to land the player at the correct terrain height without snapping to spawn.

### Drone mode (`src/player/sphere-drone.ts`)

`createSphereDroneMode()` operates in sphere coordinates:

- `dir` = current radial direction (outward unit vector from centre).
- `heading` = forward direction in the tangent plane at `dir`.
- **Terrain-follow** — each frame, `surfaceRadius(grid)` is fetched using `columnTop` (includes tree canopy). A P-controller (`TERRAIN_FOLLOW_GAIN = 3`) pulls altitude toward `HOVER_HEIGHT = 14` m above the full column top. Manual vertical input (`Space`/`C`) adds on top.
- **Landing** — `beginLanding()` starts a lerp toward `surfR − PLANET_RADIUS + 0.5`; when altitude reaches that level, `active` goes false. `main.ts` detects the `active → false` transition and calls `controller.snapToDir(drone.dir, grid)` to land the player.
- **Floor guard** — `MIN_CLEARANCE = 1.5` m above `columnTop` (not `groundColumnTop`) so the drone never clips through tree canopy.

### Fly mode (`src/player/sphere-fly.ts`)

`createSphereFlyMode()` — free flight on the sphere. `FLOOR_CLEARANCE = 1.75` m is applied against `columnTop` (full voxel stack including trees). Auto-climb probes LOOK_AHEAD = 6 arc-metres ahead and pushes the player up at `AUTO_CLIMB_RATE = 14` m/s if an obstacle is detected. Both the current column and the probe column use `columnTop`, not `surfaceRadius`, so the fly floor is always above tree canopy.

### Drone→Fly position handoff

When switching from drone to fly (`enterFly` in `main.ts`), `fly.enter(controller.dir, controller.groundRadius)` is called with the **current controller position** — which was last updated by `snapToDir` when drone landed, or by the continuous `controller.update` if on foot. This ensures the fly mode starts at the player's current on-surface position, not the drone's in-air position.

### Sphere landmarks (`src/world/sphere-landmarks.ts`)

`buildSphereLandmarks(grid, rng)` returns `LandmarkRecord[]` (`{ kind, dir: THREE.Vector3 }`):

- 2 landmarks per face (~12 total), minimum 20-column UV separation.
- Placed only on dry land (`columnTop > SEA_LAYER + 1`).
- Seven builders cycle round-robin per face (seeded with `rng()` so each face gets a different pair).
- Each builder uses face-local `(face, u, v, layer)` coordinates. `put()` never overwrites occupied blocks; `overwrite()` does (for base footings). Both clip to grid bounds.
- After placing, `columnDir(face, u, v, FACE_RES, _tmp)` converts the site UV to a world-space unit vector stored as `dir` in the record.

| Kind | Structure |
| --- | --- |
| `spire` | 3×3 STONE_WARM base, drifting STONE_PALE shaft 14–22 layers tall |
| `obelisk` | 3×3 base, straight 1×1 shaft 8–13 layers, flanking lanterns |
| `ring` | 7–8 standing stones at radius 8–11, every-other lintel |
| `tombs` | 14–22 scattered upright slabs 2–4 layers, random lean caps |
| `biosphere` | Ovoid body floating 18–28 layers above terrain, stalactite drips, small tree on top |
| `well` | Stone rim (3×3 ring hollow centre), crossbeam, scattered worn stones |
| `arch` | Two pillars 5–7 layers, partial lintel (1–2 blocks missing), rubble scatter |

### Sphere map (`src/render/sphere-map.ts`)

`createSphereMap(grid)` bakes a `1024 × 512` equirectangular terrain image once at world load:

```ts
lon = (px / MAP_W) * 2π − π
lat = π/2 − (py / MAP_H) * π
dir = (cos(lat)cos(lon), sin(lat), cos(lat)sin(lon))
```

Each pixel queries `dirToFaceUV(dir, FACE_RES)` then reads the block colour from `BLOCK_BY_ID`. The baked image is stored in a `ctx.ImageData` and `putImageData`'d every frame before drawing dynamic layers.

**Dynamic layers (drawn each frame):**
1. **Player arrow** — projects `forwardDir` onto the equirectangular tangent (east/north components) and draws a directional arrow at the player's `lon/lat` position.
2. **Landmark icons** — each `LandmarkRecord` is projected to `(lpx, lpy)` by the same lon/lat formula. A per-kind canvas icon is drawn at `ICON_R = 8` px radius. Seven distinct icons (triangle, trapezoid, double-circle, rectangles, filled circle, square+arc, pillar pair).
3. **Hover tooltip** — `mousemove` scans all cached landmark positions; on proximity < `ICON_R * 2`, a fixed `<div>` tooltip appears at cursor position with the full landmark name.

### Sphere water (`src/world/water.ts`)

`createSphereWater()` places a `THREE.SphereGeometry` at radius `PLANET_RADIUS + SEA_LAYER_SPHERE + 0.3` where `SEA_LAYER_SPHERE = 9`. This constant is deliberately 0.3 above layer 9 so it covers ocean columns (column top ≤ layer 9) but sits below terrain columns that break above the waterline (top ≥ layer 10). The water shader is the same wave/Beer-Lambert shader as the flat world; `uSunDir` is pushed each frame from `dayNight.sunDir`.

---

## Coordinate system & world constants

Three.js default axes apply throughout: **Y is up**, +X is east, +Z is south. All physics, voxel addressing, and noise sampling use this space directly — no axis remapping anywhere in the codebase.

| Constant | Value | Meaning |
| --- | --- | --- |
| `WORLD.size` | 512 | World XZ extent in voxels (configurable via `size` param) |
| `WORLD.height` | 96 | Maximum Y in voxels |
| `WORLD.step` | 3 | One terrace step height in voxels |
| `WATER.level` | 24.35 | Water plane Y (fractional keeps plane above the top shore face) |
| `SEA` | 24 | `Math.floor(WATER.level)` — integer sea level used for voxel comparisons |
| `CHUNK` | 16 | Chunk edge length in voxels; chunks are `16×96×16` |

**Voxel addressing** — flat array, row-major XZY: `index = x + sx * (z + sz * y)`. Column height cache uses `height[z * sx + x]` (ZX row-major) so a Z-outer loop over the heightfield is cache-friendly.

**Chunk coordinates** — `cx = Math.floor(x / CHUNK)`, clamped to grid. The chunk streamer works in chunk-coordinate space; world-space positions are converted on enqueue.

**Noise space** — all noise calls pass raw world-space `(x, z)` coordinates scaled by a frequency constant at the call site (e.g. `noise2(x * 0.003, z * 0.003)`), so the noise domain stays human-readable: 1 noise unit ≈ 333 world voxels at that frequency.

---

## Procedural generation pipeline

World generation runs once per seed, fully synchronous inside a web worker handoff. The pipeline is strictly ordered — each stage reads from the previous stage's output and writes its own:

```
hashSeedWord(word)
  └─► planWorld(seed, size)           → WorldPlan  (island centres, biome regions, river paths)
        └─► generateTerrain(plan)     → VoxelGrid + heightfield + rivD/rivHalf/rivFlow
              ├─► buildStructures()   → bridge voxels written into grid
              ├─► buildStamps()       → scenic + landmark voxels written into grid
              └─► scatterVegetation() → tree + detail voxels written into grid
                    └─► chunk streamer meshes chunks on demand as player moves
```

`WorldPlan` is the contract between planner and all downstream consumers. Terrain, props, stamps, vegetation, and the minimap all read from it — none re-derives island or river geometry independently. This is what makes a seed deterministic: fix the plan, everything downstream is fixed.

---

## Noise & procedural patterns

### Noise primitives (`src/core/rng.ts`)

All world generation uses a single seeded PRNG and two noise families:

- **`noise2(x, z)`** — value noise: hash two integer cell corners, bilinear interpolation. Fast; used for high-frequency variation (vegetation density, rock scatter, biome detail).
- **`noise3(x, y, z)`** — 3D value noise; used for cloud shadow, aurora structure, and any effect that needs to vary with height.
- **`fbm2(x, z, octaves)`** — fractional Brownian motion: sums `octaves` layers of `noise2` with halving amplitude and doubling frequency. The standard terrain macro-shape tool. Each extra octave adds fine detail without changing the large-scale shape.
- **`rng.range(lo, hi)`** — uniform float from the seeded PRNG; used wherever a non-spatial random number is needed (tree form selection, stamp placement jitter, bridge offset).

### Domain warping

Coastlines and disc boundaries are shaped by **domain-warped noise**: before sampling the island mask, the input coordinates are offset by another noise evaluation:

```ts
const wx = x + fbm2(x * 0.004, z * 0.004) * warpAmt;
const wz = z + fbm2(x * 0.004 + 5.2, z * 0.004 + 1.3) * warpAmt;
const onIsland = dist(wx, wz, centre) < islandRadius;
```

The two FBM calls use different offsets (the `+ 5.2`, `+ 1.3`) so they produce uncorrelated warp fields for X and Z. Without the offset they would return the same value and warp diagonally rather than in all directions.

### Contour disc terracing

Rather than smoothly interpolating a heightfield and stepping it post-hoc (which produces terraces of unequal width), each terrace level is baked in directly as a **contour disc**: a domain-warped circle that contributes exactly `WORLD.step = 3` blocks of elevation. The height at any point is:

```ts
height = SEA + discsBelow(x, z) * WORLD.step;
```

where `discsBelow` counts how many disc radii the point falls inside. Inside a disc the field is exactly constant — flatness is free, no smoothing needed. Cliffs form naturally at disc boundaries. The FBM warp of each disc radius is what makes the boundaries look organic rather than circular.

### Biome field

Biome assignment is a **threshold on a large-scale noise field** — not Voronoi, not a distance-to-centre function. A single `fbm2` sample at very low frequency (`0.002`) is compared against fixed thresholds to assign `MEADOW`, `ROCK`, `SAND`, or `SHORE`. This gives smooth biome boundaries that follow the terrain's natural ridges rather than cutting across them.

### River meander

River paths are computed by steepest-descent flow through the region graph, then **FBM-displaced laterally** to add meander:

```ts
const meander = fbm2(t * 8.0, seed) * meanderAmt;
px += perpX * meander;
pz += perpZ * meander;
```

`t` is normalised path position (0 = source, 1 = mouth). Meander amplitude grows with `t` so rivers are straighter in the mountains and wider/more sinuous near the coast — matching how real rivers behave.

### No-texture philosophy

Block colours are baked into vertex buffers at mesh-build time by the greedy mesher. The fragment shader reads only `vColor` — no texture lookups, no UV coordinates. This means:

- **Zero texture memory** — the entire world fits in vertex buffers.
- **Palette switching is instant** — `setVoxelPalette()` mutates `BLOCK_BY_ID` in place, then `invalidateAll()` rebuilds vertex buffers on next stream tick. No texture upload needed.
- **Greedy meshing is maximal** — adjacent faces of the same block always share vertex colour exactly, so they can always be merged. A texture atlas would break this (UVs prevent merging faces that span tile boundaries).

Per-vertex AO (4 corner taps per quad) is baked at the same time as colour, so ambient shadow is free at runtime.

---

## Rendering pipeline

Post-processing runs on Three.js `EffectComposer` with a HalfFloat HDR target. The chain is:

```
SceneDepthPass → EdgeMaskPass → Atmosphere → Bloom → Crepuscular → Grade/Output → SMAA
```

Everything before Grade is linear HDR. Grade performs ACES tone mapping and the sRGB transfer itself (so Three's `OutputPass` is not used — combining them saves one full-resolution copy per frame).

### SceneDepthPass

Renders the scene into a dedicated `sceneFBO` that owns a `DepthTexture`. That FBO is **never** part of the composer's ping-pong swap chain, which prevents WebGL feedback loops where a pass reads and writes the same depth buffer. After rendering, colour is blitted to the composer's read buffer.

### EdgeMaskPass

Renders a separate edge-coverage mask to `edgeMask` (an `UnsignedByteType` render target, no depth). The edge material (`world.meshes.edgeMaterial`) uses `EDGE_LAYER = 2` so the regular scene camera never draws it — only the edge pass does. The resulting texture is sampled by GradeShader to composite ink strokes in display space.

### Atmosphere (`haze` ShaderPass)

One fullscreen pass; does six things off a single depth fetch:

1. **Large-scale AO** — 8-tap depth rosette at wide radius, lavender-tinted. Catches canopy overhangs and cliff bases that per-vertex baked AO misses. Tap count is tier-scaled (`uAOTaps`: 8 / 4 / 4 / 0).
2. **Cloud shadow** — world-space reconstruction of drifting cloud noise. Very low amplitude; keeps large flat shelves from going dead.
3. **Distance desaturation** — chroma drops faster than value (matches the reference images). `mix(col, vec3(lum), fog * uDesat)`.
4. **Aerial perspective** — nudges each pixel toward `skyRadiance(wdir)` by fog amount. This is what erases the horizon line: the colour geometry fades toward is the exact sky colour in that direction (same GLSL function, no seam).
5. **Ground mist** — second exponential medium with height falloff, integrated analytically along the view ray so it pools in valleys.
6. **Sun in-scatter and 4-tap defocus** — driven by the already-computed fog amount, so near-free. DoF disabled on `low` and `very-low` tiers.

### UnrealBloomPass

Runs after Atmosphere so haze luminance feeds the bloom — gives the far field a soft luminous edge. Threshold raised to 1.25 (linear) so only genuine emitters and specular hits bloom, not the pastel palette.

### CrepuscularShader

8-tap radial march from the sun's screen position. Active only when the sun is near the horizon (`uSunVisible > 0`). `main.ts` projects the sun direction to NDC each frame and updates `uSunScreen`/`uSunVisible`.

### GradeShader

Composites the edge mask over the bloom output (display-space ink — never added before tone mapping, so pale strokes can't become emitters). Then: ACES + sRGB, lift/gamma/gain, saturation, vignette, film grain, chromatic aberration, a "milk" mix (flat lilac lightens the darkest values), and a highlight rolloff knee.

### SMAAPass

Final pass; writes directly to the screen. `needsSwap = false` — without this the composer would alternate the scene between rt1 and rt2 each frame, causing the depth texture to detach every other frame and producing a visible full-frame flash.

---

## Sky model

`src/render/sky.ts` exports two GLSL string chunks — `SKY_UNIFORMS_GLSL` and `SKY_FN_GLSL` — plus `skyUniformValues()`.

**Why shared:** both the sky dome mesh (`lighting.ts`) and the aerial-perspective pass (`postfx.ts`) need to evaluate the same sky colour. If they used separately tuned gradients, the colour distant geometry fades toward would never match the sky behind it — a subtle but persistent seam at the horizon. Sharing a single `skyRadiance(dir)` function makes the match exact.

### `skyRadiance(dir)`

Builds the daytime sky: zenith-to-horizon gradient, sun glow (two lobes), limb wash and disc. At the end: `col = mix(col, col * 0.04, uNight * 0.96)` dims the day sky, then adds `nightSkyAddons(dir)`.

### `nightSkyAddons(dir)`

Adds moon disc + glow, then (when `clearNight > 0.01`): Milky Way with Great Rift dust lane (4-octave FBM, longitude/latitude projection onto galaxy plane), emission nebulae (filament noise), and procedural stars. Finally calls `_aurora(dir)`.

### `_aurora(dir)`

Animated curtain aurora. Gated by `uNight * uAurora * smoothstep(0.04, 0.10, dir.y)`.

Layers:
- **Curtain band** — lower edge shaped by multi-frequency azimuthal ripple (slow drift + medium wave + fast flutter via `uAuroraTime * 4.0`); upper edge fades with `1.0 - smoothstep(0.38, 0.82, dir.y)` (edge0 < edge1; the original code had these inverted — that caused NaN on most drivers).
- **Vertical rays** — slow structural noise (`t * 0.5`) plus a 4× faster shimmer layer; the two beating together cause rays to appear to ignite and die.
- **Sweep pulse** — `sin(az * 1.7 + t * 0.5) * sin(az * 0.8 - t * 0.28)` — a brightness wave that travels across the azimuth.
- **Breathing** — two incommensurate frequencies (`sin(t*0.45) * sin(t*0.29 + 1.9)`) produce an irregular beating throb.
- **Ghostly white flare** — `pow(rays * coverage, 2.5)` is mixed toward `vec3(0.80, 1.00, 0.88)` at intensity peaks.

All noise in `_aurora` uses direct `_noise3()` calls (no `_fbm3` loop). The FBM loop triggers ANGLE warning X3595 ("gradient instruction used in a loop with varying iteration") on Windows via the HLSL translator. Two inline octaves are sufficient for aurora structure.

**Uniforms driven by `day-night.ts`:**
- `uNight` — `getNightFactor()` result
- `uAurora` — `max(0, (nightF - 0.5) / 0.5)` (fades in over second half of night)
- `uAuroraTime` — accumulates `+= dt * 0.3` (independent of star rotation speed)
- `uStarAngle` — increments `+= dt * 0.0001` (star rotation; also used as slow time in `nightSkyAddons`)

---

## Day/night cycle

`src/render/day-night.ts` — `DayNight` class.

`timeOfDay` is a `0–1` float: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk. Advances as `+= dt / dayLengthSeconds` (default 1200 s = 20 min).

### Keyframe system

```ts
const TIMES = [0.0, 0.2, 0.27, 0.5, 0.73, 0.8, 1.0];
// indices:  [midnight, predawn, sunrise, noon, sunset, dusk, midnight]
```

`keyframe(t)` returns `{ i, a }` — the segment index and interpolation alpha. All palette arrays (`zenith`, `horizon`, `sunColor`, `sunIntensity`, etc.) are lerped with `lerpColor` / `lerpScalar` against that `{ i, a }` pair.

Sun direction is `(−cos(2πt), sin(2πt)×1.1 − 0.1, 0.3).normalize()` — slight downward bias keeps the sun below the horizon at midnight without requiring a separate night branch.

### `getNightFactor()`

```ts
const d = Math.abs(this.timeOfDay - 0.5) * 2;  // 0 at noon, 1 at midnight
return Math.max(0, (d - 0.3) / 0.7);
```

Returns 0 during daytime (±30% of the cycle around noon), ramping to 1 at midnight. Used to gate stars, aurora visibility, and `uNight` in the sky shader.

### Voxel time-of-day tints

`DayNight.voxelUniforms` (set to `world.meshes.material.userData.uniforms` in `main.ts`) receives live per-frame pushes:

- `uSunDir` — live sun direction vector.
- `uSunAmbient` — `0.08 + elev * 0.18` (scales diffuse contribution with sun elevation).
- `uFillAmbient` — slightly higher at night (`0.04 + (1 - elev) * 0.04`) to simulate moon bounce and prevent total black.
- `uSunTint` — warm orange-gold at the horizon, neutral white at noon. Driven by `horizonWarm = pow(max(0, 1 - elev * 2.5), 2)` and the keyframed sun colour.
- `uAmbientTint` — cool blue at night (`r -0.08 * night, g -0.04 * night, b +0.12 * night`), neutral at day.

---

## GPU tiering

`src/render/gpu-tier.ts`

### Detection

Five tiers determined at startup from hardware signals. Signals used:

- `navigator.hardwareConcurrency` — logical CPU cores.
- `navigator.deviceMemory` — GB (absent in Firefox/Safari; falls back to a canvas timing probe: 20× `fillRect(512, 512)` — if it takes >15 ms the device is memory-bandwidth-constrained → 2 GB; otherwise 4 GB).
- `MAX_TEXTURE_SIZE` from WebGL2 — integrated Intel/AMD caps at 8192; discrete and all Apple Silicon report 16384+. Discriminates desktop discrete from integrated without needing a GPU database.
- UA mobile detection — `/Mobi|Android|iPad|iPhone|iPod/i` (iPad explicitly matched; it would otherwise route through the desktop path).
- WebGL2 availability — absence is a strong very-low signal on 7-year-old devices.

Detection order (first match wins):

```ts
// very-low: no WebGL2, or weak mobile
if (mobile && (!hasWebGL2 || cores <= 4 || estimatedMem <= 2)) return 'very-low';
// low: weak desktop
if (cores <= 4 || estimatedMem <= 2) return 'low';
// mobile-high: flagship phone/tablet (≥8 cores, ≥4 GB on mobile)
if (mobile && cores >= 8 && estimatedMem >= 4) return 'mobile-high';
// high: desktop discrete GPU (large texture units exclude integrated)
if (!mobile && cores >= 8 && estimatedMem >= 6 && maxTexSize >= 16384) return 'high';
// mid: everything else with ≥6 cores, ≥3 GB
if (cores >= 6 && estimatedMem >= 3) return 'mid';
return 'low';
```

Known device routing:

| Device | Tier |
| --- | --- |
| Samsung Galaxy S22 Ultra (8-core, 12 GB) | mobile-high |
| Apple iPad Pro M2 (8-core, Safari: probe→4 GB) | mobile-high |
| Apple iPad Air M2 (8-core, 4 GB) | mobile-high |
| Apple iPad Air A14 (6-core, 4 GB) | mid |
| MacBook Air M2 (8-core, 8 GB, maxTex=16384) | high |
| Intel UHD laptop (8-core, 16 GB, maxTex=8192) | mid |
| 2019 mid-range phone (6-core, 3 GB) | mid |
| Budget phone (4-core, 2 GB) | low (desktop) / very-low (mobile) |
| 7-year-old phone (no WebGL2) | very-low |

### Settings table

| Tier | DPR cap | Shadow (px) | Blur samples | Bloom | AO taps | DoF | Crep. taps | Edge mask | Stream radius |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high | 2× | 3072 | 12 | ✓ | 8 | ✓ | 8 | ✓ | 12 |
| mobile-high | 1.5× | 2048 | 8 | ✓ | 4 | ✓ | 4 | — | 11 |
| mid | 1.25× | 2048 | 8 | ✓ | 4 | ✓ | 4 | — | 11 |
| low | 1× | 1024 | 4 | — | 0 | — | 0 | — | 8 |
| very-low | 1× | 512 | 4 | — | 0 | — | 0 | — | 6 |

`EdgeMaskPass` is disabled on all mobile tiers — it doubles draw calls for little visual gain on smaller screens. `dprCap` is applied as `min(window.devicePixelRatio, cap)` so it can only reduce the native DPR, never raise it.

On `low` and `very-low`, `renderer.shadowMap.autoUpdate = false`. `DayNight.update()` sets `renderer.shadowMap.needsUpdate = true` once per animation frame — correct cadence without re-rendering the shadow map multiple times per frame, saving meaningful fill-rate on constrained hardware.

---

## Voxel Planet & chunking

### Grid

`VoxelGrid` is a dense `Uint8Array` of size `sx × sy × sz`. Block IDs are 8-bit; 0 = air. `height[x*sz + z]` caches the highest solid voxel per column for fast ground queries (used by drone terrain-follow, character physics, map bake).

### Greedy mesher

Runs per chunk in a worker. For each axis direction and each slice, merges adjacent faces of the same block type into quads. Block colours are read from `BLOCK_BY_ID` at mesh-build time and baked into vertex buffers — no texture lookups at runtime. Per-vertex AO (4 taps at each quad corner) is baked at the same time.

### Chunk streaming

`createWorldChunkStreamer()` in `voxel.ts`. Chunk size `CHUNK = 16`. Default stream radius 12 chunks (~192 blocks). Each frame, `streaming.update(playerPos, cameraPos)` enqueues new chunks within the radius and unloads those beyond `loadRadius + unloadPadding`.

### LOD fade

Freshly loaded chunks fade in over ~0.5 s via a `uLodAlpha` uniform and Bayer 4×4 ordered dither in the fragment shader. The update loop only iterates `fadingMeshes` (a `Set`) — O(fading), not O(all loaded chunks). Meshes remove themselves from the set when `lodAlpha` reaches 1.

---

## World planner

`src/world/planner.ts` — `planWorld(seed, size)` runs before terrain generation and returns a `WorldPlan` that terrain, props, and the map all read from.

### Island layout

3–5 main islands are scattered by dart throwing with minimum separation (`islandMinSep = islandRadius * 2.2`) and a margin from the world boundary. Between each pair of main islands, 1–2 stepping-stone islands are placed at interpolated positions with a perpendicular jitter, giving organic rather than straight chains.

```
islandRadius    = size * 0.21   (per-island radius)
steppingRadius  = islandRadius * 0.35
islandMinSep    = islandRadius * 2.2
```

`plan.islandCenters` and `plan.stoneIslands` are the authority on where land is — every downstream consumer (terrain mask, bridge placement, minimap) derives from them rather than hard-coding a coastline fraction.

### Bridge chains

`bridgeChains` is an array of waypoint lists: `[mainA, ...stones, mainB]`. `props.ts` walks each chain and places a wooden arch bridge between consecutive waypoints, landing on the nearest solid ground at each end.

---

## Terrain generation

`src/world/terrain.ts` — `generateTerrain(seed, size)`.

The heightfield is built as a stack of **contour discs**: each disc is a domain-warped circle (using FBM noise to make the boundary organic) worth exactly one terrace step (`WORLD.step = 3` blocks). Inside a disc the field is exactly constant — flatness is free, cliffs are the disc boundaries.

Post-processing passes:
1. **River carving** — after terracing, a river path is carved as a smooth channel (un-stepped) through the valley.
2. **Ledge pass** — splits the tallest cliffs with long horizontal shelves.
3. **Stair carving** — cuts walkable steps into cliff faces until the world is fully walk-connected.
4. **Biome field** — large-scale noise assigns surface material (meadow / rock / sand) as regions.

### River flow bake

At the end of `generateTerrain()`, `rivFlow` (`Uint8Array`, one byte per column) is computed from the river distance field (`rivD`) and half-width (`rivHalf`). It is packed into the **G channel** of the water depth map (R = signed depth). The water shader reads it as `rivProx` to multiply wave speed and add bank foam tint.

---

## River system

Rivers are planned in `planner.ts`, carved in `terrain.ts`, and rendered as voxel blocks above sea level.

### Planning (`planner.ts`)

`planWorld` builds `plan.rivers`: an array of `{ order: 0|1|2, points: [x,z][], source, tributary?, outflow? }`.

- **Trunks (order 0)** — traced from the highest-elevation region nodes downslope to the coast. One per main island, traced by steepest-descent with FBM meander jitter. Tail-trimmed to exclude ocean-side points (`elevationAt < SHORE_ELEV = 0.15`).
- **Tributaries (order 1)** — sourced from 50th-percentile elevation regions, up to `trunkCount × 5` total. Each joins the nearest existing channel within a snap radius of 18 region units.
- **Streams (order 2)** — fine branches from lower mid-elevation regions, up to `min(trunkCount × 4, 32)` total. Join nearest channel within `REGION_SPACING × 8`.

### Carving (`terrain.ts`)

For each river channel point, a half-width `rivHalf[i]` is computed. Width by tier:

- Trunk: `3.2 + t × 5.4` (t = 0 at source, 1 at mouth)
- Tributary: `2.2 + t × 2.6`
- Stream: `1.2 + t × 1.4`

The carved channel bed is set to `SEA - sinkFraction × channelLength` for the wet reach (below `SEA + 7`); above that it is a dry ravine. `SEA = Math.floor(WATER.level) = 24`.

### RIVER_WATER voxels (`terrain.ts`)

Above sea level, river channels are filled with `RIVER_WATER` voxels (3 blocks above the carved bed) so the river is visible as a teal-blue channel rather than a dry ravine:

```ts
export const RIVER_WATER = registerBlock('RIVER_WATER', {
  top: lin(0x4fa8bc), side: lin(0x3d97ae), bottom: lin(0x2e8899),
  rough: 0.05, isWater: true,
});
```

`isWater: true` is checked by `VoxelGrid.isSolid()` (returns false, keeping the block passable).

Below sea level the water plane already covers the carved channel — no voxels needed.

---

## Water shader

`src/world/water.ts`

### Depth map

`makeDepthMap(world)` bakes a `THREE.DataTexture` in `RGFormat`:
- **R** — signed water depth: `(WATER.level − (top+1) + DEPTH_RANGE) / (2 × DEPTH_RANGE)`, range ±34 world units. Signed rather than clamped so the shader has a real path length for Beer-Lambert integration, and the waterline dark edge is drawn at the zero-crossing (clamped fields have no gradient at the shore).
- **G** — river proximity 0–255 from `rivFlow`.

### Wave field

Surface normal is computed from the **analytic derivative** of a sum of sin waves (`waveField(uv, time)` returns `vec3(nx, 1, nz)`). All angular effects — sun glint, Fresnel, refraction offset — hang off this one normal so they all agree with the visible wave.

### Beer-Lambert absorption

```glsl
float depth = max(0.0, waterLevel - sceneY); // actual path length
vec3 absorb = exp(-depth * uExtinction);      // per-channel extinction
```

Red goes first (`uExtinction.r` highest), which is why deep water reads as blue-green. Path length grows as the camera lowers, so far water darkens and near shallows stay clear from the same surface — a lerp keyed on position cannot do this.

### River proximity

`rivProx` from the G channel drives two effects:
- Wave speed multiplier: `float riverSpeed = 1.0 + rivProx * 1.8`
- Bank foam: `smoothstep` band near the shore blended toward `vec3(0.90, 0.92, 0.96)`
- Subtle blue tint: `col * vec3(0.88, 0.95, 1.06) * rivProx * 0.28`

Water plane subdivision: 64×64 on `high`, 32×32 on `mobile-high`/`mid`/`low`, 4×4 on `very-low`.

---

## Planet bend

`src/render/planet.glsl.ts`

The vertex shader snippet `PLANET_BEND_GLSL` is pasted into every material that needs curvature (voxel mesh, water, vegetation, particles):

```glsl
void applyPlanetBend(inout vec3 worldPos, inout vec3 worldNormal) {
  vec2  d2   = worldPos.xz - uPlayerXZ;
  float r2   = dot(d2, d2);
  float drop = r2 / (2.0 * uPlanetRadius);   // parabolic approximation to sphere
  worldPos.y -= drop;
  float r   = sqrt(r2);
  float ang = r / uPlanetRadius;
  if (r > 0.001) {
    vec2 axis = d2 / r;
    worldNormal.xz -= axis * ang * worldNormal.y;
    worldNormal = normalize(worldNormal);
  }
}
```

`uPlanetRadius` defaults to 350. Physics stay flat — only the vertex positions and normals are bent. Normal correction (`worldNormal.xz -= axis * ang * worldNormal.y`) keeps lighting consistent on the curved surface.

`updatePlanetUniforms(unis, pos)` pushes the player's (x, z) to every registered material's `uPlayerXZ`. It is called in `main.ts` only when the player moves more than 0.1 units:

```ts
if (Math.abs(bendOrigin.x - _lastPlanetX) + Math.abs(bendOrigin.z - _lastPlanetZ) > 0.1) {
  for (const unis of world.allPlanetUnis) updatePlanetUniforms(unis, bendOrigin);
}
```

`world.allPlanetUnis` collects terrain, water, and particle uniform objects so a single loop hits everything.

---

## Player systems

Walk, drone and fly on the sphere are documented under *Sphere world architecture* above.

### Movement basis

`tangentBasis(up, yaw)` in `fp-camera.ts` is the single source of forward/right for both the view (`updateSphere`) and movement (`getWishSphere`). Right is `forward × up` — the three.js camera's +X. `npm run check` asserts this against a real camera at random positions and headings; it is what caught A/D being swapped when the two were computed separately.

### Pausing

`fpCam.paused` (set by the pause menu and settings panel) clears held keys and makes `getWishSphere`, `getJumpEdge`, `isKeyDown` and touch-look return nothing. All gameplay input reads through `FPCamera`, so this one flag covers keyboard, mouse and touch.

---

## Touch controls

`src/ui/touch-controls.ts` — only instantiated when `isTouchDevice` is true.

**Detection:** `('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches`. The `pointer: coarse` media query is the reliable discriminator — Windows laptops report `maxTouchPoints > 0` even without a touchscreen, but they use a fine (mouse) pointer.

**Joystick:** nippleJS dynamic joystick in a `#joy-zone` div covering the left half. On `move`, calls `fpCam.setTouchMove(v.x, v.y)` which stores the raw axes `_joyX`, `_joyY` (nipplejs: up = +y). `getWishSphere` maps them through `tangentBasis` exactly like WASD, keeping analogue magnitude; the drone reads them as steer/throttle. On `end`, zeros both.

**Swipe-to-look:** raw `touchstart`/`touchmove` on the right half (clientX ≥ innerWidth/2). Calls `fpCam.applyTouchLook(dyaw, dpitch)`.

**Button events** use the `held()` helper for Space/C (altitude) and Shift (sprint), and a `tap()` helper (`touchend`) for tap-only actions (pause, map, fly, drone, land, edges, time step, dog). Actions are shared functions in `main.ts`, so keyboard and touch can't drift. The button column wraps into two columns on short (landscape phone) screens and sits above the map so 🗺 can always close it; tapping the map also closes it.

**`touchActive = true`** bypasses the `isLocked` check in `canAct()` and `getWishSphere()`, so touch devices never need pointer lock.

### `drainDroneAltDelta(dt)` design

```ts
drainDroneAltDelta(dt = 0): number {
  const keyAxis = (this._keys.has('Space') ? 1 : 0) - (this._keys.has('KeyC') ? 1 : 0);
  const scrollRate = dt > 0 ? this._droneAltDelta / dt : 0;
  this._droneAltDelta = 0;
  return scrollRate + (keyAxis + this.touchAltAxis) * 12;
}
```

Returns **m/s rate** (not a delta). The drone/fly caller does `hoverAltitude += result * dt`. Scroll wheel accumulates a raw position delta (`_droneAltDelta -= e.deltaY * 0.02`); dividing by `dt` converts it back to a rate so `rate * dt` restores the original per-frame offset. Mouse Y movement is intentionally **not** wired to altitude — any upward mouse drift would cause continuous climb.

---

## Seed & URL

`src/core/rng.ts` — `genSeedWord()` generates a random human-readable word from a fixed word list. `hashSeedWord(word)` hashes it to a 32-bit integer for use as the noise seed.

On startup (`main.ts`):

1. `currentSeedWord` is generated randomly.
2. If `?seed=<word>` is present in the URL, it overrides the generated word.
3. `hashSeedWord(currentSeedWord)` → `SEED` (used for all world generation).
4. `pushSeedUrl(currentSeedWord)` writes `?seed=<word>` to the URL immediately so the seed is always visible, even on first load.

`pushSeedUrl(word)` uses `history.replaceState` (not `pushState`) so the browser back button is not cluttered.

### Startup progress sequence

`buildWorld` (`src/world/world.ts`) drives the loading bar via an `onProgress(fraction, label)` callback. Each step yields to the browser before the next synchronous block so the label is visible before the work starts. `generateTerrain` receives a sub-callback that maps its internal 0–1 range into the 0.06–0.24 window.

| Progress | Label | Source |
| --- | --- | --- |
| 0.02 | drawing the map | `planWorld` — continent layout, region graph, river routing |
| *(yield)* | | browser paints before synchronous terrain block |
| 0.06 | sculpting the terrain | `generateTerrain` — macro relief discs, contour field |
| 0.14 | carving the rivers | `generateTerrain` — river distance field + bank carving |
| 0.19 | shaping the banks | `generateTerrain` — walkability, stairs, boulders |
| 0.21 | filling the voxels | `generateTerrain` — voxel fill loop |
| 0.26 | building the crossings | `buildStructures` — bridges, stepping stones |
| 0.34 | placing scenes and landmarks | `buildStamps` — scenic stamps (groves, hot springs, overlooks…) + landmark structures (spires, wells, arches…) |
| 0.40 | growing the forests | `scatterVegetation` — trees, mushrooms, crystals |
| 0.50 | finding the path | `findSpawn` — locate a good player start position |
| 0.54 → 0.96 | meshing the world | chunk streaming preload (per-chunk sub-progress) |
| 1.0 | ready | loading overlay fades out |

The settings panel's seed input and the pause menu's **Generate new world** button both call `pushSeedUrl(newWord)` then `location.reload()`, which re-enters the startup path with the new seed in the URL.

---

## Palette system

`src/core/palette.ts`

`VOXEL_PALETTES` is the single source of truth for **all** environmental colours — block colours, sky, light, atmosphere, water, petals, and post-FX grade. There are no hardcoded palette-driven hex literals anywhere else in the codebase.

### `VoxelPalette` interface

```ts
interface VoxelPalette {
  blocks: { GRASS_TOP, GRASS_SIDE, SOIL, SAND, STONE, STONE_PALE, STONE_WARM,
            LEAF_ROUND, LEAF_SPIRE, LEAF_PALM, LEAF_BROAD, LEAF_WEEPING };
  sky:    { zenith: number; horizon: number; haze: number; ground: number;
            sunTint: number };
  light:  { sunColor: number; skyColor: number; groundColor: number };
  water:  { shoal: number; shallow: number; deep: number; extinction: THREE.Vector3 };
  petals: number[];   // array of hex colours for petal particles
  grade:  { lift: THREE.Color; gamma: THREE.Color; gain: THREE.Color;
            saturation: number; bloom: { strength: number; radius: number; threshold: number } };
}
```

Five palettes are defined: **Autumn** (default), **Spring**, **Alpine**, **Desert**, **Alien**.

### Initialisation pattern

Palette-driven module exports (`GRASS_TOP`, `SKY`, `LIGHT`, `WATER`, `PETAL_COLORS`, `GRADE`, etc.) are initialised to zero/empty with a helper `z = () => new THREE.Color(0)`. The module ends with `setVoxelPalette('Autumn')` which mutates every export in place, so imports always see valid colours — even in a module loaded before the call would be placed in main.ts.

Non-palette constants (PATH, PLANK, BEAM, TRUNK, CRYSTAL, CLOTH, ROOF, etc.) are hardcoded hex literals and are never modified by `setVoxelPalette`.

### `setVoxelPalette(name)`

Mutates in place:
1. **Block colours** — `BLOCK_BY_ID` entries for all palette-driven block IDs.
2. **`SKY`** — zenith, horizon, haze, ground, sunTint.
3. **`LIGHT`** — sunColor, skyColor, groundColor.
4. **`WATER`** — shoal, shallow, deep, extinction.
5. **`PETAL_COLORS`** — spliced to the new palette's petal array.
6. **`GRADE`** — lift/gamma/gain colours, saturation, bloom parameters.

After calling it, existing mesh buffers are stale — `world.streaming.invalidateAll()` triggers a remesh of all loaded chunks.

### Live palette switch propagation (`main.ts` `onPaletteChange`)

A palette change must propagate beyond block colours because many subsystems clone palette colours into their own uniforms or buffers at construction time:

```
setVoxelPalette(name)
  │
  ├─ water.planetUnis — uShoal, uShallow, uDeep, uExtinction (cloned at creation)
  ├─ atmo.sky material uniforms — uSkyZenith, uSkyHorizon, uSkyNadir, uSunGlow
  ├─ atmo.scene.fog.color + atmo.hazeColor (separate cloned objects)
  ├─ dayNight.applyNoonSky(sky, light.sunColor)  ← patches DayNight PALETTE[3] keyframes
  ├─ atmo.hemi.color / groundColor  ← hemisphere light (set at construction only)
  ├─ water.material uniforms — uHorizon, uSky (sky-reflection, cloned at creation)
  ├─ post.grade uniforms — uLift, uGamma, uGain, uSaturation
  ├─ post.bloom.strength / radius / threshold
  ├─ particles.recolorPetals()  ← re-randomises aColor vertex buffer
  ├─ world.streaming.invalidateAll()
  └─ map.invalidateTerrain()
```

### DayNight noon keyframes

`DayNight.update()` drives sky dome uniforms **every frame** from module-scoped `PALETTE` keyframe arrays (7 keyframes: midnight → predawn → sunrise → noon → sunset → dusk → midnight). Without patching the noon keyframe (index 3), any `onPaletteChange` sky update would be overwritten on the very next frame.

`applyNoonSky(sky, sunColorHex)` patches only the noon entry:

```ts
applyNoonSky(sky: { zenith: number; horizon: number; haze: number }, sunColorHex: number): void {
  PALETTE.zenith[3].set(sky.zenith);
  PALETTE.horizon[3].set(sky.horizon);
  PALETTE.haze[3].set(sky.haze);
  PALETTE.sunColor[3].set(sunColorHex);
}
```

### Petal recolouring

Petal layers use an `aColor` `InstancedBufferAttribute` baked at geometry creation time. `particles.recolorPetals()` iterates the two petal mesh layers, replaces every colour triple in the buffer with a random sample from `PETAL_COLORS`, and sets `attr.needsUpdate = true`. The two petal `Mesh` objects are tracked in a `petalMeshes: THREE.Mesh[]` array inside `createParticles()`.

---

## Wind sway

Leaf and shrub blocks sway in the breeze. The sway flag is packed into the `aData.y` vertex attribute alongside the block's pattern byte: `aData.y = pattern | (sway ? 8 : 0)`. The GLSL vertex shader checks bit 3 (`aData.y >= 8.0`) to detect swayable geometry.

### Vertex shader

```glsl
if (aData.y >= 8.0) {
  float heightT = clamp(transformed.y / 28.0, 0.0, 1.0);
  float wave = sin(uTime * 1.4 + transformed.x * 0.3 + transformed.z * 0.21) * 0.045
             + sin(uTime * 2.1 + transformed.z * 0.18)                        * 0.022;
  transformed.x += wave * heightT * uWindStrength;
  transformed.z += wave * 0.4 * heightT * uWindStrength;
}
```

`heightT = transformed.y / 28.0` uses world Y after planet bend is partially applied, so the sway amplitude correctly grows from base to crown regardless of tree height. The previous version used `aData.w` (a baked per-vertex scalar that had been repurposed), which produced flat sway with no height-based amplification.

### Controls

`uWindStrength` is a user-settable uniform on `material.userData.uniforms` (key `_windBase` tracks the raw slider value). Wind is skipped entirely on the `very-low` tier. The guard `if (wu._windBase > 0)` correctly checks the scalar — the previous `if (wu.uWindStrength)` tested the uniform object itself (always truthy) and never skipped.

---

## Boot screen

The loading overlay (`#boot` in `index.html`) shows a spinning CSS 3D voxel cube while the world generates.

### Cube structure

```html
<div class="ls-emblem">
  <div class="ls-cube">
    <div class="ls-face ls-face--top"></div>
    <div class="ls-face ls-face--bottom"></div>
    <div class="ls-face ls-face--front"></div>
    <div class="ls-face ls-face--back"></div>
    <div class="ls-face ls-face--left"></div>
    <div class="ls-face ls-face--right"></div>
  </div>
</div>
```

`.ls-cube` uses `transform-style: preserve-3d` with `perspective: 240px` on the parent. Each face is `translateZ(32px)` after the appropriate `rotateX/Y` so all six faces sit at ±32 px from centre. Face colours simulate ambient-occlusion shading: top (#d4922a brightest) → front/right (mid amber) → left/back (dark terracotta) → bottom (#4a1e02 darkest).

`@keyframes ls-voxel` rotates the cube around Y on a −20° X tilt (`rotateX(-20deg) rotateY(0deg → 360deg)`) over 3.2 s, giving an isometric-style spin that reads as a voxel block from all angles.

When the `.ready` class is added, `#boot.ready .ls-emblem { opacity: 0 }` fades the cube out over 0.5 s.

---

## Performance fixes

Applied across the codebase:

| # | File | Fix |
| --- | --- | --- |
| 1 | `gpu-tier.ts` | WebGL probe context released with `WEBGL_lose_context` after reading `MAX_TEXTURE_SIZE`, preventing the probe canvas from holding a GPU context indefinitely. |
| 2 | `main.ts` | Wind guard corrected: `wu._windBase > 0` (scalar) instead of `if (wu.uWindStrength)` (always-truthy uniform object). |
| 3 | `voxel.ts` | Wind sway height factor uses world Y (`transformed.y / 28.0`) instead of `aData.w`, giving correct crown-amplified sway. |
| 4 | `day-night.ts` | `shadowMap.needsUpdate` guarded behind a sun-elevation delta threshold (>0.009 in Y). Shadows only re-render when the sun moves visibly, halving shadow cost on static scenes. |
| 5 | `main.ts` | `atmo.followTarget()` skipped when the player is stationary — only called when `manualMovement`, `fly.active`, or `drone.active`. |
| 6 | `main.ts` | `clock.update()` restored before `clock.getDelta()`. `THREE.Timer.getDelta()` returns the cached `_delta` field; it does **not** call `update()` internally. Removing it caused `rawDt = 0` every frame, freezing all physics. |
| 7 | `gpu-tier.ts` | `very-low` water subdivision reduced from 8×8 to 4×4. |
| 8 | `main.ts` | Wind calculation skipped entirely on `very-low` tier — the uniform object is never fetched. |

---

## Scene stamps

`src/world/stamps.ts` — `buildStamps(world, rng)` runs after props (so stamps can see bridges) and before vegetation (so the scatter pass respects cleared areas).

### Scenic grammars

Each grammar re-validates the terrain before building. A site whose conditions are not met downgrades to the next grammar in the preference list rather than building on wrong terrain.

| Grammar | Requires | Generates |
| --- | --- | --- |
| `waterfallGarden` | 6+ block cliff with water at foot | Cascade, plunge pool, spray rocks, viewing deck, framing trees, lanterns, reeds |
| `stoneCrossing` | River node with dry banks | Stepping stones, plank jetty, framing trees, reeds |
| `lilyPond` | Level clearing near waterline | Excavated basin, sand rim, lily pads, leaning tree |
| `blossomGrove` | Level open ground | Torii gate, swept floor, great tree, secondary ring, lanterns |
| `cliffOverlook` | Level ground with 7+ block drop | Paved terrace, parapet, bench, lanterns, one tree |
| `hotSpring` | Dry inland mid-elevation ground | Oval RIVER_WATER pool on STONE_WARM floor, boulder rim, leaf-moss scatter |

Separation: `MIN_SEPARATION = 34` blocks between any two scene centres. Quotas (`QUOTA`) cap each kind per 256×256 area so one type does not dominate. `hotspring` quota: 2 per area.

### Landmark grammars

One pass per continent after scenic stamps. Seven kinds, 2–3 per continent slot, shuffled per seed. Each landmark reserves its footprint against the vegetation scatter pass. All seven kinds are registered in `map.ts` and appear on the minimap as landmark circles.

| Grammar | Generates |
| --- | --- |
| `twistedSpire` | 3×3 warm-stone base, 14–22 block drifting pale-stone shaft (shifts 1 block each 4 levels, max ±2), cap block |
| `obelisk` | 3×3 base, 8–13 block straight shaft, lanterns on either side |
| `monolithRing` | 7–8 standing stones at radius 10–13, every-other lintel, PATH floor |
| `tombstoneField` | 14–22 scattered upright slabs 2–4 blocks tall, random lean caps |
| `floatingBiosphere` | Ovoid voxel body floating 20–32 blocks above terrain (grass cap → soil → warm-stone core), 8 stalactite drips below, small tree on top |
| `ancientWell` | Stone rim (3×3 ring), STONE_PALE crossbeam, PATH clearing radius 5, scattered worn stones |
| `ruinedArch` | Two pillars 5–7 blocks tall, partial lintel (1–2 centre blocks missing), rubble scatter |

The floating biosphere uses `T.put()` at `floatY + dy` offsets, bypassing the heightfield entirely. Stalactite length tapers from `STONE_WARM` (tip) through `STONE_PALE` to `STONE` (base).

The ruined arch spans along the X axis; the gap is randomised per seed so no two arches look identical. `ancientWell` is the most common ancient-ruin type and appears in flat inland clearings.

---

## Vegetation detail

`src/world/vegetation.ts` — `plantTree()` supports fourteen silhouette forms:

| Form | Silhouette | Primary biomes |
| --- | --- | --- |
| `round` | Classic round crown | All |
| `stack` | Tiered stacking | All |
| `twin` | Two-lobed top | All |
| `bunch` | Tight cluster | All |
| `nub` | Small compact cap | All (small scale) |
| `spire` | Tall narrow cone | HIGHLAND, CONIFER |
| `umbrella` | Flat wide canopy | MEADOW, SHORE |
| `broad` | Low spreading crown | MEADOW, WETLAND |
| `tall` | Birch/poplar — very tall bare trunk, small airy crown | MEADOW |
| `layered` | Pagoda/cedar — 2–4 tiered horizontal discs with gaps | SAKURA |
| `weeping` | Weeping cherry — wide drooping skirt, lifted central crown | SAKURA |
| `palm` | Curved trunk, frond canopy with satellite clusters | SHORE (double-weighted) |
| `dead` | Bare skeletal stubs, optional lean caps | HIGHLAND (double-weighted), SHORE |
| `mangrove` | Aerial-root spread base, tiered canopy by scale | WETLAND (double-weighted) |

`pickForm(scale, rng)` selects a form based on tree scale: large trees (`scale > 0.72`) may be `palm`; medium (`scale > 0.46`) may be `mangrove`; small-medium (`scale > 0.26`) may be `dead`. `BIOME_FLORA` per-biome tables further bias toward biome-appropriate forms via weighted repetition in the `forms` array. Updated biomes:

- **SHORE** — adds `'palm'` (×2), `'dead'`; `scale` range widened to `[0.16, 0.7]`
- **WETLAND** — adds `'mangrove'` (×2) alongside `'broad'`, `'weeping'`, `'tall'`
- **HIGHLAND** — adds `'dead'` (×2) alongside `'spire'`, `'layered'`

### Ground detail: mushrooms and crystals

`buildGroundDetail()` scatters sub-voxel geometry using the `DetailField` (`F.tuft`, `F.box`, `F.petal`, `F.fern`) into a single animated mesh.

**Mushrooms** appear in forested, damp spots (`wetness > 0.08`, grove noise `> 0.05`). Each cluster is 1–3 mushrooms: a thin `F.tuft` stem + a flat `F.box` cap (4× wider than tall). Probability doubles within 1 block of a tree base (`occupied` array from the tree scatter pass).

**Crystals** appear near landmarks (within radius 14) and at elevated rocky ground (`top > sea + 8`). Each cluster is 1–4 narrow-tall `F.box` shards: width 0.07–0.12, height 0.32–0.68, with a 50 % chance of a smaller satellite shard offset by 0.16 blocks. Colors: lilac (amethyst), rose, mint (aquamarine), blush. The `world.stamps` array is read inside `buildGroundDetail` — it is populated by `buildStamps` which runs before vegetation.

---

## Water vertex displacement

`src/world/water.ts` shares a `WAVE_GLSL` constant between vertex and fragment shaders. This constant defines:

- `h21(p)` — cheap hash
- `n2(p)` — value noise
- `waveField(p, t) → vec3(height, dNx, dNz)` — sum of four directional sin waves

The vertex shader displaces `vWorld.y += wave.x` before applying planet bend, so the water mesh has true geometric crests (~0.4 blocks peak-to-trough at the default amplitudes). The fragment shader evaluates the same `waveField` for the analytic surface normal `(−dNx, 1, −dNz)`, guaranteeing the lighting normal matches the displaced geometry exactly. Sharing the constant is what enforces this — a separate definition would let amplitudes drift.
