# Voxel Planet — Design & Architecture

Developer reference for the current codebase. For user-facing documentation see [README.md](README.md).

Voxel Planet is a first-person explorer on a procedurally generated spherical voxel planet (Three.js r185, TypeScript, Vite). The world is a cube-sphere grid of voxels meshed in streamed chunks, rendered through a custom post-processing chain. Controls and several systems (sky, tiers, touch layout) mirror the sibling project planet-explorer.

All paths below are relative to `src/` unless noted. Palette colours are stored in Three's linear working space; hex inputs are sRGB and converted by `THREE.Color`.

---

## 1. Source layout

```
index.html                    Boot overlay (#boot) markup, fonts, entry script /src/main.ts
vite.config.ts                base '/voxel-planet/', manual 'three' chunk (server.port 5170 is overridden by npm scripts)
scripts/
  check-controls.ts           Movement-basis invariant (tangentBasis vs camera)
  check-tiers.ts              classifyGpu device table
  check-dog-path.ts           Pathfinder on a hand-built patch
  check-sky-frame.ts          JS mirror of the sky _toSky rotation
  ts-resolve.mjs              Node module hook: resolves extensionless './x' imports to './x.ts'
src/
  main.ts                     Startup, wiring, frame loop, key bindings, palette live-switch, window.__game
  styles.css                  Boot screen, shared CSS variables
  global.d.ts
  core/
    voxel.ts                  SphereVoxelGrid, crossFaceUV, chunk mesher, chunk streamer, voxel material/edge/glow shaders
    palette.ts                Block library, PATTERN ids, VoxelPalette themes, setVoxelPalette, NATURAL filter
    rng.ts                    Seed words, mulberry32 makeRng, hash/value-noise helpers
    noise3.ts                 Perlin Noise3 with fbm (terrain)
    geoutil.ts                basisFromCode, columnDir, dirToFaceUV
  world/
    world.ts                  buildSphereWorld: generation order, streamer, vegetation, water
    terrain.ts                Elevation, terracing, surface/rock, desert, trees, cacti, dead trunks, ground cover
    vegetation.ts             Lazy per-patch grass/flowers/plants/ground detail meshes
    water.ts                  Sea sphere shader
    shore-map.ts              Distance-to-land atlas bake + SHORE_GLSL
    landmarks.ts              Seven landmark structures + site picker
  player/
    controller.ts             Walking physics on the sphere (SphereController)
    drone.ts                  Auto-cruising terrain-following drone
    fly.ts                    Free-flight mode
    dog.ts                    Companion dog (model, heel/fallback logic, animation)
    path.ts                   Incremental column-grid A* with seam crossing
  render/
    renderer.ts               WebGLRenderer setup
    gpu-tier.ts               Tier detection and TIER_SETTINGS
    lighting.ts               Atmosphere class: fog patch, sky dome, sun/hemi/fill/ambient lights
    sky.ts                    Shared GLSL sky model (skyRadiance, night add-ons, aurora)
    day-night.ts              Time-of-day keyframes and light/sky animation
    postfx.ts                 EffectComposer chain and shaders (atmosphere, crepuscular, grade)
    fp-camera.ts              FPCamera, tangentBasis, input state
    map.ts                    Equirectangular planet map overlay
    planet.ts                 PLANET_RADIUS_DEFAULT only
  fx/
    particles.ts              Petals, motes, pollen (instanced, GPU-animated)
    birds.ts                  Flocks crossing the sky
    clouds.ts                 Instanced voxel clouds
    critters.ts               Butterflies (day) and fireflies (night)
  ui/
    hud.ts                    Time chip, altitude chip, shortcut hints, settings button
    pause.ts                  Esc pause menu with binding list
    settings.ts               Settings panel, persistence, palette select
    touch-controls.ts         nipplejs joystick, swipe-look, action buttons
```

---

## 2. Sphere grid (`core/voxel.ts`, `core/geoutil.ts`)

The planet is a cube projected onto a sphere ("cube-sphere"). Each of the six cube faces holds a `FACE_RES x FACE_RES` array of columns; each column holds `SHELL_DEPTH` radial layers.

| Constant | Value | Meaning |
| --- | --- | --- |
| `PLANET_RADIUS` | 350 | World radius of layer 0's inner surface |
| `FACE_RES` | 400 | Columns per face edge (960,000 columns total) |
| `SHELL_DEPTH` | 96 | Layers per column |
| `CHUNK` | 16 | Columns per chunk edge (25 x 25 chunks per face, 3,750 total) |

A voxel at `(face, u, v, layer)` occupies radius `PLANET_RADIUS + layer` to `+ layer + 1`. Layer 11 is the sea layer (`SEA_LAYER = 11`, redefined in terrain, world, water, shore-map, landmarks, vegetation, map, and main); the sea surface sphere is at radius `PLANET_RADIUS + 11 - 0.5`.

### Face codes and bases

Face codes: 0 = +X, 1 = -X, 2 = +Y, 3 = -Y, 4 = +Z, 5 = -Z. `basisFromCode(code, normal, tangentU, tangentV)` in `geoutil.ts` produces the face basis: normal is +/- the axis `code >> 1`; `tangentU` is (0,1,0) except for the Y faces where it is (1,0,0); `tangentV = normal x tangentU`. `voxel.ts` keeps a precomputed copy (`_FN`, `_FTU`, `_FTV`) of the same table; the two must agree (they also match the GLSL copy in `shore-map.ts`).

A column centre direction is `normalize(n + tu*(2(u+0.5)/FACE_RES - 1) + tv*(2(v+0.5)/FACE_RES - 1))` (`columnDir`). `dirToFaceUV(dir, faceRes)` inverts it: dominant axis picks the face, then `u, v` are `floor(((d.tu/d.n + 1) * faceRes) / 2)`, clamped to `[0, faceRes)`.

### `SphereVoxelGrid`

| Member | Description |
| --- | --- |
| `data: Uint8Array` | `6 * FACE_RES^2 * SHELL_DEPTH` block ids (about 92 MB). Index: `((face*FACE_RES + v)*FACE_RES + u)*SHELL_DEPTH + layer` |
| `surfaceLayer: Int16Array` | Highest non-air layer per column (-1 if empty). Index: `(face*FACE_RES + v)*FACE_RES + u`. Maintained by `set`: raised on any non-zero write, rescanned downward when the top voxel is cleared |
| `plants: Uint8Array` | Per-column ground-cover block id (0 = none). Plants are not voxels; the vegetation layer draws them as sprites. `setPlant` / `plantAt` |
| `get/set` | Bounds-checked; out-of-range reads return 0, out-of-range writes are ignored |
| `isSolid` | Non-air and not a water block |
| `isSolidGlobal` | Like `isSolid`, but out-of-range `u/v` is translated through `crossFaceUV` (used by the mesher for neighbour lookups and AO across seams) |
| `columnTop` | `surfaceLayer`, or -1 out of range. Includes trunks and leaves |
| `groundColumnTop` | Walks down from `surfaceLayer` skipping air, `sway` blocks (leaves) and `isTrunk` blocks. This is the walkable ground |
| `surfaceRadius` | `PLANET_RADIUS + groundColumnTop + 1` (just `PLANET_RADIUS` if the column is empty). Used by the player, dog, critters |

### `crossFaceUV(face, u, v)`

Converts an out-of-range `(u, v)` on `face` to the canonical `[face, u, v]`. It builds the unnormalised cube-space vector for the (possibly out-of-range) column centre, picks the dominant axis for the new face, and re-projects onto that face's basis, clamping to `[0, FACE_RES-1]`. Cube faces are not isometric across seams (columns shrink toward corners), so this is a nearest-column mapping, not a bijection; the mesher's AO and the pathfinder accept that.

---

## 3. World assembly (`world/world.ts`)

`buildSphereWorld(seed, scene, onProgress, opts)` is async and yields to the browser between steps (`setTimeout 0`) so the boot label paints. `opts` carries tier-derived `streamRadius`, `grassDensity`, `groundDetail`, `shoreFoam`, `tier`.

| Progress | Label | Work |
| --- | --- | --- |
| 0.01 -> 0.71 | sculpting the planet | `generateSphereTerrain` (progress reported per 40 rows of `v`) |
| 0.72 | placing landmarks | `buildSphereLandmarks(grid, makeRng(seed ^ 0x4c2e9a1f))` |
| 0.73 | building terrain meshes | `createSphereChunkStreamer(grid, { loadRadius: streamRadius })`; vegetation created with `makeRng` seed `seed ^ 0x3b1e7f`, wind amplitude 0.1, registered via `streaming.setListener`; `streaming.update(spawnDir, Infinity)` fills the whole view synchronously |
| 0.90 | adding ocean | `bakeShoreMap` (skipped on `very-low`) then `createSphereWater` |
| 1.0 | ready | |

The result (`SphereWorld`) is `{ grid, streaming, group, spawnDir, animated, sphereWater, landmarks }`. `animated` holds the vegetation object, whose `update(dt)` advances the wind clock (main.ts calls it every frame). `spawnDir` is the unit direction of the spawn column returned by terrain generation.

Seed handling (`main.ts`): `?seed=<word>` overrides the default `currentSeedWord`; `hashSeedWord` (31-multiplier hash, modulo 100000) gives the numeric `SEED`; `pushSeedUrl` writes the word back with `history.replaceState`. The settings panel's seed field and `genSeedWord` use `pushSeedUrl` then reload.

---

## 4. Terrain generation (`world/terrain.ts`)

`generateSphereTerrain(seed, onProgress)` returns `{ grid, spawn }`. Two `Noise3` (Perlin) instances are used: `noise = Noise3(seed)` and `noise2 = Noise3(seed + 101)`. Tree/plant scattering uses `makeRng(seed ^ 0x7ace31)`, consumed in face -> v -> u order, so layout is deterministic for a given seed.

### Elevation

`elevationAt(noise, noise2, x, y, z)` samples a unit-sphere direction:

1. Domain warp: `w = 0.25`, warp frequency `q = 1.6*0.8`; each axis is displaced by `noise2` sampled at offset lattice positions.
2. `base = noise.fbm(warped * 1.6, 5 octaves, lacunarity 2, gain 0.5) * 1.1`
3. `hills = noise.get(warped * 1.6*3.1 + 9) * 0.06`
4. A mountain mask `mm = smoothstep(-0.1, 0.35, noise2(warped * 1.6*0.6 + 7))` multiplies a ridged term `ridged^2` (`ridged = max(0, 1 - |2*noise2.fbm(warped*1.6*1.5)|)`).
5. `e = base + hills + 0.8*mm*ridged^2*0.8 - 0.05`; negative values are halved (`e < 0 ? e*0.5 : e`) so the sea floor is shallower than the land is high.

### Terracing

```
terraced = TERRACE_STEP * round(e * AMPLITUDE / TERRACE_STEP)
surfaceLayer = clamp(SEA_LAYER + terraced, 1, SHELL_DEPTH - 10)
```

with `TERRACE_STEP = 2`, `AMPLITUDE = 24`, `SEA_LAYER = 11`. Land is a column with `surfaceLayer > SEA_LAYER`. Terraces are two layers tall, which is why the player's `MAX_STEP` and the dog's `maxUp` are tuned to 2.

### Column fill

For every column, layers `0..surfaceLayer`:

| Condition | Block |
| --- | --- |
| Not land | Top layer `SAND`, below it `STONE` |
| Land, top layer | Desert: `SAND`. Otherwise `selectSurface` |
| Land, top 2 layers below surface | Desert: `SAND` ("dunes are sand to rock"); otherwise `SOIL` |
| Land, deeper | `selectRock`: 3D noise at `dir*12` offset by `layer*0.3`; `> 0.2` -> `STONE_PALE`, else `STONE` |

`selectSurface` uses a temperature proxy `temp = 1 - 1.1*dir.y^2 - 1.2*max(e, 0)` (colder near the poles and at altitude): `temp > 0.6` -> `GRASS`; `> 0.2` -> `GRASS_LIGHT`; else `STONE_PALE`.

### Desert band

`isDesert(noise, dir, e, surfaceLayer)`: same `temp` formula; false if `surfaceLayer > SEA_LAYER + DESERT_MAX_RISE`; otherwise `temp + noise(dir*9 + 40)*0.08 > DESERT_TEMP`. Constants: `DESERT_TEMP = 0.8`, `DESERT_MAX_RISE = 6`. The noise term roughens the boundary so dunes meet grass in tongues. Desert columns are computed only for land.

### Scatter pass

After the fill and `findSpawn`, a second pass visits every column and rolls `treeRng()` once. The top block of the column decides the branch (only above `SEA_LAYER + 1`):

| Top block | Roll thresholds (cumulative on the single roll) |
| --- | --- |
| Grass (`GRASS`, `GRASS_LIGHT`, `GRASS_DEEP`) | `< ZONE[zone].treeP` zone tree; `< 0.012 + DEAD_TRUNK_P` and rise `>= DEAD_TRUNK_MIN_RISE (3)` dead trunk; `< 0.042` bush (`plantSphereBush` with a block from `BUSH_PALETTE`); `< 0.065` fern (60% `FERN`, else `FERN_RED`, via `plantSingle`); `< 0.08` tall grass (`GRASS_TALL` if rise < 4, else `SHRUB_TALL`) |
| Stone (`STONE`, `STONE_PALE`) | `onRockP` = 0.01 in highland, 0.005 in treeline, else 0.0025: conifer tree (zone clamped to highland/treeline); next `DEAD_TRUNK_P*1.5` dead trunk; `< 0.018` scrub bush (`SCRUB` 70%, `BUSH_MAUVE`); `< 0.055` moss/lichen plant |
| Sand (desert) | `< CACTUS_P (0.006)` cactus; next 0.012 `SCRUB_DRY` plant |
| Waterline (`SEA_LAYER-1 <= top <= SEA_LAYER+2`) | `< 0.08` `REED`; `< 0.13` `FERN` plant |

The thresholds are cumulative on one roll, so each outcome is mutually exclusive with the others. For grass, the zone tree takes `[0, treeP)`; the dead-trunk band is `[0.012, 0.012 + DEAD_TRUNK_P)` and only fires where `roll < treeP` did not (note `treeP` for lowland is 0.016, which exceeds 0.012, so in lowland the dead-trunk band is empty and bushes start at 0.016).

Tree placement writes voxels via local `set()` helpers that refuse cells outside `[1, FACE_RES-2]` in `u/v`, above `SHELL_DEPTH`, or already occupied.

### Ground cover as `plants`

`plantSingle(grid, face, u, v, surfaceLayer, block)` records the block id in `grid.plants` if the cell above the surface is empty. It does not create a voxel: ferns, tall grass, reeds, moss, lichen, tall shrub and dry scrub are drawn later as blade/sprite geometry by `world/vegetation.ts`. They are non-solid, so they never block movement or pathing. The exported `PLANT` object (`FERN, FERN_RED, MOSS_THICK, LICHEN_PALE, SHRUB_TALL, GRASS_TALL, REED, SCRUB_DRY`) maps names to registered block ids; vegetation switches on those ids.

Ground-cover and shrub blocks are registered at module load with `registerBlock` (ids 60..250, auto-assigned). Bushes (`BUSH_ROSE/MAUVE/CREAM`, `SCRUB`) are real voxels: `plantSphereBush` fills a mound of half-width `w` (2 with p 0.3, else 1 with p 0.7 of the remainder, else 0), 1 to 3 high, and only on flat ground (column top within +/-1 of the surface layer).

### Cacti (`plantCactus`)

Block `CACTUS`: `PATTERN.CACTUS`, `isTrunk: true` (solid; the player and dog treat it as an obstacle). Kinds, picked from `['saguaro' x3, 'barrel', 'columns']`:

| Kind | Shape |
| --- | --- |
| saguaro | Column 4-9 high; if height >= 5, 0 to `min(3, height-3)` arms. Each arm steps out 1 (or 2 with p 0.3) at height 2..height-2, then climbs 1..(height-at-1). Arm directions come from a shuffled list |
| barrel | 1-2 high, 1x1 or (p 0.4) 2x2; skipped unless all cells' `columnTop` equals the surface layer |
| columns | 2-4 slim columns at offsets `(0,0),(1,0),(-1,0),(0,1),(0,-1),(1,1)`, heights 2-5 for the first, 2-4 for the rest; each only on level ground |

### Dead trunks (`plantDeadTrunk`)

Block `DEADWOOD` (`PATTERN.BARK`, `isTrunk`), weathered grey-brown. 20% are stumps (1-2 high, half of those with a fallen section 2-3 long lying beside them on same-height ground). Otherwise a 3-9 high column; 25% lean (the upper part steps one block sideways, with a joint block at the bend); 1-3 short branch stubs for height >= 5 (0-1 otherwise), 1 block long or 2 with p 0.35. Constants: `DEAD_TRUNK_P = 0.0012`, `DEAD_TRUNK_MIN_RISE = 3`.

### Altitude-zoned trees

`rise = surfaceLayer - SEA_LAYER`. `zoneOf(rise)`: `<=3` coast, `<=7` lowland, `<=11` midland, `<=15` highland, else treeline.

| Zone | rise | `treeP` | Species mix (weights) | Size range |
| --- | --- | --- | --- | --- |
| coast | 2-3 | 0.011 | palm 5, broadleaf 3 | 0.35-0.85 |
| lowland | 4-7 | 0.016 | broadleaf 6, emergent 2, palm 1 | 0.2-1.0 |
| midland | 8-11 | 0.013 | broadleaf 5, birch 3, fir 2 | 0.2-0.9 |
| highland | 12-15 | 0.012 | fir 5, spruce 4, birch 1 | 0.3-1.0 |
| treeline | 16+ | 0.006 | krummholz 6, spruce 1 | 0.15-0.5 |

`plantZoneTree` picks a species with `weightedPick` and a continuous `size` from the zone range, then builds:

| Species | Construction |
| --- | --- |
| broadleaf | Delegates to `plantSphereTree(..., leaves, size)`. 12% of trees add the `flowering` role to the pool. Form chosen by `pickTreeForm(size)`: size > 0.72 -> stack/round/broad/weeping/twin/palm; > 0.55 -> round/spire/twin/stack/broad; else round/spire/stack/nub. Each form has `large` (size >= 0.72), `unit == 2` (size >= 0.42) and small variants built from `fill` boxes; trunk is `TRUNK` (55%) or `TRUNK_PALE`; 62% are two-tone (leaf plus the next leaf block in the list) |
| palm | Slim `TRUNK_PALE` column `6 + size*7` high, bending one way every third layer above 45% height with joint blocks, topped by drooping fronds in eight directions, length `2 + size*3` |
| emergent | Rainforest giant: `TRUNK` `11 + size*9` high, 2x2 when size > 0.55, buttress blocks at the foot, three stacked leaf discs and a lower side tier at 60% height |
| birch | `BIRCH` block (pale bark, bark pattern) `5 + size*6` high, open crown of discs (radius 1, or 2 if size > 0.5) in the `birch` roles, from 55% height up |
| fir / spruce | `TRUNK` column; leaf discs shrinking to a point. Fir: `8 + size*10` high, narrower (max radius ~2), bare 2 layers at the base, alternate layers skipped below 85% height. Spruce: `6 + size*7`, wider (~3), denser |
| krummholz | 2 + size*3 high `TRUNK`, leaf column with a one-to-two-block "flag" swept downwind in one random direction |

`disc()` fills a clipped-corner diamond of Chebyshev radius `r` (cells with `|du|+|dv| > r + floor(r/2)` are skipped) with optional ragged-edge dropout.

### Leaf roles (`LEAF_ROLE`)

Foliage blocks `LEAF_PINK, LEAF_BLUSH, LEAF_LILAC, LEAF_CREAM, LEAF_MINT, LEAF_ROSE` are slot indices 0-5 of the active palette's `foliage` array (see section 10). Terrain picks by role, not by name, so every theme keeps the altitude logic in its own colours:

| Role | Slots |
| --- | --- |
| `broad` | 0, 1, 4, 4 (green weighted double) |
| `flowering` | 2 |
| `conifer` | 5, 4, 5 |
| `birch` | 1, 3 |

### Spawn

`findSpawn` scans face 0 starting at `(160, 160)` stepping 4 columns across 200 attempts for a column with `columnTop > SEA_LAYER + 2`, falling back to `(0, 200, 200)`.

---

## 5. Chunk streaming and meshing (`core/voxel.ts`)

### Mesher

`meshSphereFaceRegion(grid, face, u0, v0, u1, v1, solid, glow, edgeMap, uHalo)` emits one quad per visible voxel face (face-culled against `isSolidGlobal`, so cross-seam neighbours cull correctly). There is no greedy merging; per-vertex ambient occlusion makes merged quads impractical. The mesher scans a `uHalo = 1` column margin around the chunk (so edge outlines see neighbouring chunks) but only emits geometry for columns inside the chunk.

Per face it computes:

- Corner positions: cube-space point projected to the unit sphere then scaled to `PLANET_RADIUS + layerCorner`.
- Normals: top = radial direction of the column centre, bottom = its negation, sides = the cube face's constant tangents (+/-`tu`, +/-`tv`). Note the side normals are the *cube face* tangents, which diverge from the true sideways direction by up to ~35 degrees near a face's edges; the shader therefore reconstructs the geometric normal (below).
- AO per vertex: 3-neighbour test (`aoOf`): both edge neighbours solid -> 0, else `(3 - count)/3`. The quad diagonal is flipped so the AO gradient does not crease the wrong way.
- Attributes: `aData = (ao, patternPacked, fringe, localV)`, plus `aTint`, `aFringe`, `aUv` (integral world-space block units).
- `patternPacked = pattern | (block.sway ? 8 : 0)`; emissive blocks go to the `glow` buffer.
- Edge entries for the outline system (convex/concave masks from the 4 in-plane neighbours).

`MeshBuffer.toGeometry()` packs vertex streams to cut memory: `normal` Int8 normalized, `color/aTint/aFringe` Uint8 normalized, `aUv` Int16, `position` Float32, `aData` Float32, indices Uint16 when a chunk has <= 65535 vertices. Winding is reversed because the (u, layer, v) -> axes mapping has determinant -1.

### Streamer

`createSphereChunkStreamer(grid, { loadRadius })` returns `{ meshes, loadRadius, loadedCount, pendingCount, setListener, setLoadRadius, update, tick, rebuildAll, dispose }`.

| Constant | Value | Role |
| --- | --- | --- |
| `CHUNK_ANGLE` | `CHUNK*2/FACE_RES` = 0.08 rad | Angle of one chunk at a face centre (~28 units at the surface) |
| load radius | `opts.loadRadius` (tier `streamRadius`); runtime value clamped to `[3, max]` by `setLoadRadius` | Great-circle radius in chunks |
| `UNLOAD_MARGIN` | 1.5 chunks | Hysteresis: unload only past `radius + 1.5` |
| `RESCAN_ANGLE` | `CHUNK_ANGLE / 3` | Rescan the 3,750 precomputed chunk directions only after the viewer has moved this far (or on `forceScan`) |
| `BUILD_BUDGET_MS` | 4 | Main-thread meshing budget per `update`; at least one chunk always builds (`do ... while`) |
| `FADE_BAND` | 0.28 | Outer fraction of the radius that dither-fades with distance |
| `DETAIL_RADIUS` | 7 chunks | Within this: outlines visible and chunk casts shadows. Beyond: both off (`setDetail`) |

`scan(playerDir)` classifies each chunk by `dot(chunkDir, playerDir)` against `loadCos`, `unloadCos`, `detailCos`, builds a load queue sorted closest-first (popped from the end), flips detail on already-loaded chunks as the viewer moves, and unloads chunks outside the unload cone. `update(playerDir, budgetMs)` rescans if needed, then builds queued chunks until the budget is spent. `budgetMs = Infinity` (startup, `rebuildAll`) fills the view synchronously and skips the fade-in.

Streaming centre is the walking `controller.dir`, or the drone/fly `dir` while airborne (`main.ts`).

`setCos` also sets the shader uniforms `uFadeFar = radius * CHUNK_ANGLE * (PLANET_RADIUS + 14)` and `uFadeNear = radius * (1 - FADE_BAND) * CHUNK_ANGLE * (PLANET_RADIUS + 14)` (arc length in world units, measured from the camera in the fragment shader).

New chunks fade in: `lodAlpha` goes 0 -> 1 at `dt * 3` per second (`tick`), applied per mesh in `onBeforeRender` through `uLodAlpha`.

### `ChunkListener`

```ts
interface ChunkListener {
  chunkLoaded(face, u0, v0): void;    // u0 = ci*CHUNK, v0 = ck*CHUNK
  chunkUnloaded(face, u0, v0): void;
}
```

Only the vegetation layer registers. `setListener` immediately replays `chunkLoaded` for chunks already loaded.

### `rebuildAll(playerDir)`

Unloads every chunk (firing `chunkUnloaded`, which frees vegetation patches), forces a rescan and refills synchronously. Needed after a palette switch because block colours are baked into vertex attributes.

---

## 6. Voxel material shader (`core/voxel.ts`)

`makeVoxelMaterial()` is a `MeshLambertMaterial` (vertex colours, no dithering) patched in `onBeforeCompile` (`customProgramCacheKey` `'VoxelWorld-voxel-v11'`, with `-fol` appended when `FOLIAGE_DETAIL` is defined). Uniforms live in `material.userData.uniforms` and are updated by `DayNight`, the streamer and main.

### Patterns

`PATTERN` ids (`core/palette.ts`): `NONE 0, BRICK 1, STONE 2, PLANK 3, BARK 4, GRASS 5, TILE 6, CACTUS 7`. The fragment shader takes `pat = mod(aData.y, 8.0)`; bit 3 (value 8) is the sway flag (leaf blocks). Per-pattern functions:

| Function | Used for |
| --- | --- |
| `patBrick`, `patStone`, `patPlank`, `patBark`, `patGrassTop`, `patTile` | Legacy block patterns (flat-colour variants for landmarks, roofs, bridges; bark is the cheap sinusoidal version) |
| `patCactus(uv, base, tint, side)` | `PATTERN.CACTUS` (always on): side faces get 5 vertical ribs per block (light crests, dark grooves via `tint*0.78`) with pale spine dots; tops a radiating-rib crown. Side UVs come from `_trunkUV()` |
| `patTerrain` | Only under `FOLIAGE_DETAIL`, for blocks with no pattern and no sway flag: per-block tone jitter, tops get mottling and speckle, sides get 2-per-block strata with a noise-broken seam, soft bevel toward face edges |
| `patFoliage(uv, base, tint, faceLight)` | Only under `FOLIAGE_DETAIL`, for sway-flagged blocks (canopy): domain-warped clump field (lit tops vs shadowed pockets), elongated leaf speckle, hue drift toward the tint, sun-catching highlights on lit faces. Underside UVs are scaled 1.8x. Colour lift after: tops 1.05, sides 1.28, undersides 1.15 |
| `patBarkDetail(uv, base, tint, heightT)` | Only under `FOLIAGE_DETAIL`, trunk (`pat == BARK`) side faces: furrows with a wandering offset, plates broken by cracks, worn ridges, moss at the base (`heightT` from radius above `uSeaLevelRadius` over 10 units). The authored bark colour is near black, so it is lifted with `max(base*3.6, (0.16, 0.10, 0.06))` |
| `patBarkEnd` | Same condition, trunk top/bottom faces: growth rings with a bark rim |

`FOLIAGE_DETAIL` is a `#define` set on the material by `main.ts` when the tier's `foliageDetail` is true (`voxMat.defines.FOLIAGE_DETAIL = 1`, `needsUpdate`); tiers without it pay nothing and render canopy and terrain as flat colour.

### Face classification from derivatives

The fragment shader computes `_geoN = normalize(cross(dFdx(vPosW), dFdy(vPosW)))`, flipped to agree in sign with `vNrmW`, and `_radial = dot(_geoN, normalize(vPosW))`. `isSide = |_radial| < 0.5`, `isTopFace = _radial > 0.5`. This is used instead of the vertex normal because the mesher writes side normals as the cube face's fixed tangents, which on a sphere tilt up to ~35 degrees from true sideways near a face's edge; classifying with them showed end-grain rings on trunk sides and treated cliff sides as tops.

`_trunkUV()` gives trunk-side texture coordinates independent of the mesher's per-face uv axes: x runs around the trunk (`dot(vPosW, normalize(cross(vNrmW, up)))`), y is `length(vPosW)`.

### Shading stack (order in `FRAG_BODY`)

1. Pattern colour (above).
2. Grass fringe: on side faces with `fringe > 0`, a noise-jagged green cap (`aData.z` fraction, `localV` height) mixes in `aFringe`.
3. Macro colour variation: blended 3-plane value noise (`xz`, `xy`, `yz`) at two scales, +/-5% luminance. Three planes are used because `xz` alone smeared into stripes on the planet's flanks.
4. Face shade: top 1.0, bottom 0.78, sides 0.96 / 0.90 depending on whether the face looks toward or away from the sun's bearing projected into the local tangent plane (world X/Z mean nothing on a sphere); plus a sky-facing lift `skyFacing*0.08`, plus `max(N.sun,0)*uSunAmbient` and `(1-max(N.sun,0))*uFillAmbient`.
5. Sun tint (`uSunTint`, mixed by lit fraction x 0.55) and ambient tint (`uAmbientTint`, x 0.18, the night blue shift).
6. Side faces darken slightly near the ground: `0.90 + hRamp*0.10`, `hRamp` over 36 units above `uPlanetRadius`.
7. Baked AO: `ao = mix(1 - uAoStrength, 1, aData.x)`, smoothstepped, then `col *= mix(uAoTint, 1, ao)`. Defaults `uAoStrength = 0.25`, `uAoTint = (0.6, 0.55, 0.5)` (warm-neutral: the earlier lilac pair made every theme look dyed).
8. Waterline ink on side faces (`uWaterMap`, `uWaterInk`, ...). See the note in section 18: `uWaterMap` is never assigned in the current code, so this stroke is inactive.
9. Distance dither (`BAYER_DITHER_GLSL`, run at the top of `main()`): Bayer 4x4 threshold vs `uLodAlpha * (1 - smoothstep(uFadeNear, uFadeFar, distance(vPosW, cameraPosition)))`; below threshold -> `discard`. No blending, so it works in the opaque pass.
10. After lighting, a shadow-hue mix: where the sun shadow map reports occlusion, `outgoingLight` is mixed 60% x `uShadowTintStrength (0.82)` toward `mix(lum, light, 0.7) * uShadowHue (0.98, 0.97, 1.03)`. This keeps 70% of the surface's own hue and only leans slightly cool, so shaded canopies do not all collapse to the same lilac.

### Wind sway (vertex)

Vertex shader (`VERT_BODY`): for vertices with `aData.y >= 8.0` and `uWindStrength > 0`:

```
phase = p.x*0.31 + p.z*0.27
sway  = (sin(uWindTime*1.1 + phase)*0.6 + sin(uWindTime*0.47 + phase*1.9)*0.4) * uWindStrength
heightT = clamp((length(p) - uPlanetRadius) / 28, 0, 1)
windTang = wind3d - radial*dot(wind3d, radial)   // wind projected on the tangent plane, fallback (1,0,0)
p += normalize(windTang) * sway * heightT
```

`wind3d = normalize(vec3(uWindDir.x, 0, uWindDir.y))`. `main.ts` drives `uWindTime`, `uWindDir` (slowly rotating, `windAngle += dt*0.04*(sin(windTime*0.11)*0.5+0.5)`) and `uWindStrength = _windBase * gust` where `gust = 0.5 + 0.3 sin(0.7t) + 0.2 sin(1.3t)`. `_windBase` is the stored slider value (default 0.4), read once at startup from `localStorage['VoxelWorld.settings'].windStrength`. Wind is skipped on the `very-low` tier and when `_windBase == 0`. The vegetation shader uses the same wind direction/time idea but its own uniforms (section 7).

### Outlines and glow

- Edge outlines: `LineSegments2` runs built from edge entries, merged into long runs (`mergeEdgeRuns`) with dark/light ink chosen by face luminance (`LIGHT_FACE_LUMA = 0.61`; grass tops force the light ink; concave edges are always dark). They live on `EDGE_LAYER = 2` and are drawn only by `EdgeMaskPass` (section 12), which composites them in the grade shader. On tiers with `edgeMask: false` the pass is not added and the grade opacities are zeroed.
- `makeGlowMaterial()`: unlit `MeshBasicMaterial` for emissive blocks (`LANTERN`, `CRYSTAL`), brightened by 1.5x with a crude `normal.y` face ramp.

---

## 7. Vegetation (`world/vegetation.ts`)

`createSphereVegetation(grid, seed, scene, density, windAmp, groundDetail)` returns `{ group, patchCount, chunkLoaded, chunkUnloaded, update, dispose }` and acts as the streamer's `ChunkListener`.

### Lazy patches

Vegetation is built per patch of `VEG_PATCH = 32` columns (a 13x13 patch grid per face). A patch is built when the first terrain chunk under it loads and freed when the last one unloads (`refs` reference count per patch key). A built patch with no content is stored as `null` so it is not rebuilt. A patch is therefore rebuilt identically each time: its RNG is seeded from `(seed ^ imul(patchKey+1, 0x9e3779b1))`.

Each patch is one `THREE.Mesh` (merged quads, `receiveShadow = true`, `castShadow = false`, `renderOrder = 2`, `matrixAutoUpdate = false`). All patches share one material (one program, one wind clock). Bounding spheres are inflated by `windAmp*2 + 0.25` so swaying tips stay inside the cull volume.

### Per-column content

For each column in the patch, using the column's tangent frame (`_up` = column direction, `_ta`/`_tb` tangents):

1. Skip empty columns and water (`layer <= SEA_LAYER` without a plant).
2. Skip unless the column has a plant, a `grassCap` top block, or a stone top.
3. If a plant is recorded in `grid.plants`: `drawPlant` and continue (the plant replaces the column's grass).
4. Otherwise: ground detail (if `groundDetail > 0`), then, if not bare stone, grass/flowers/blades/pebbles via `scatterColumn`.

Two noise fields (`makeNoise3D` seeded `seed ^ 0x51ed` and `seed ^ 0xf10e`, sampled in 3D at `MEADOW_FREQ = 0.026` and `FLOWER_FREQ = 0.055` per world unit so patches are continuous across cube seams) give `lush` (meadow density) and `bloom` (flower drifts).

| Constant | Value | Use |
| --- | --- | --- |
| `GRASS_P` | 0.35 | Base tuft probability, x density x `(0.45 + lush*1.1)` |
| `TREE_P` | 0.04 | Small foliage clump (stump tuft plus wider cross) |
| `BLADE_P` | 0.12 | Tall lone blades, x density x `(0.4 + lush)` |
| `FLOWER_EDGE` / `FLOWER_P` | 0.58 / 0.55 | Flowers only where `bloom > 0.58`; probability ramps above |
| `PEBBLE_P` | 0.008 | Pebbles, never animated |

Flower colours are drawn from `PETAL_COLORS` (the theme's petal colours), not leaves: canopies are mostly green and green flowers would vanish. Grass blade colours derive from the column's block: dark = `topTint x 0.86`, light = `top x 1.08`. Pebbles use `STONE/STONE_PALE/STONE_WARM` tops. Flowers are a stem tuft plus a small coloured box head that nods with the wind.

### Plant sprites (`drawPlant`)

Colour: tip = block `topTint ?? top`; base = `side` lerped 45% toward the tip (the raw side colour is authored for a shaded cube face and would read as a black stem). Shapes by id:

| Plant | Shape |
| --- | --- |
| `FERN`, `FERN_RED` | 3-5 arching fronds radiating from one root |
| `GRASS_TALL` | 4-6 blades, height 0.7-1.15 |
| `REED` | 3-5 tall nearly straight blades, height 1.1-1.7 |
| `SHRUB_TALL` | 6-9 wide blades, a dense clump |
| `MOSS_THICK` | 6-9 very short tufts, a low cushion |
| `LICHEN_PALE` | 2-4 flat pale boxes hugging the stone |
| `SCRUB_DRY` | Registered and recorded, but `drawPlant` has no `case` for it (draws nothing). See section 18 |

### Ground detail

`scatterGroundDetail` uses a *separate* RNG stream (`drng`, seeded `seed ^ 0x6d2b79f5 ^ ...`) so toggling the tier's `groundDetail` never moves where grass and flowers land.

| Item | Probability | Notes |
| --- | --- | --- |
| Boulders (`BOULDER_P`) | 0.0045 x detail, x3 on bare stone | 1-3 stacked yawed boxes, half sunk, stone colours |
| Fallen logs (`LOG_P`) | 0.006 x detail, only `nearTrunk` | Long bark box (`TRUNK`/`TRUNK_PALE` side colour) with a moss strip |
| Mushrooms (`MUSHROOM_P`) | 0.05 x detail; x1 `nearTrunk`, x0.25 in open lush meadow (`lush > 0.7`), else 0 | 2-4 stems with caps from `PETAL_COLORS[0,2,3]` and `STONE_WARM` |

`nearTrunk` checks the four neighbours at `layer+1` for a block with `isTrunk` *and* `pattern == PATTERN.BARK`, so living and dead wood qualify but cacti (solid trunks with `PATTERN.CACTUS`) do not.

### Material and wind

`makeVegMaterial`: `MeshLambertMaterial`, vertex colours, `DoubleSide`, `depthWrite: false` (thousands of overlapping blades writing depth gave the outline pass a scratchy edge; they still depth-test). Normals are the surface up vector, not the blade facing, so blades are lit like the ground they grow from. Because `DoubleSide` flips normals on back faces, which would point blades into the ground and render them black, the fragment shader replaces `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;` with `1.0`. Per-vertex `aDetail = (sway, phase)`; vertex shader displaces tips along the local tangent frame: two sine waves, amplitude `sway^2 * uWindAmp` along `t1 + 0.55*t2`, with a slight downward bow `-up*|w|*a*0.18`. Program cache key `'VoxelWorld-sphereveg-v2'`.

---

## 8. Water (`world/water.ts`, `world/shore-map.ts`)

### Shore-distance atlas (`bakeShoreMap`)

For every column of every face: 0 if land (`columnTop > seaLayer`), else the 8-way chamfer distance (weights 1 and sqrt 2) to the nearest land column, capped at `MAX = 8` columns. Two passes (forward, backward) per face. Packed into one `R8` `DataTexture` of `3*FACE_RES x 2*FACE_RES` (a 3x2 atlas of the six faces, tile `(face % 3, face / 3)`), value `d / MAX * 255`, linear filtering, no mipmaps. Distances do not cross cube seams, so a foam band can stop short at a seam (hidden by haze at that range).

Why it exists: the water shader needs depth and a shore line without reading scene depth (the depth pass renders the water too, which would be a feedback loop).

`SHORE_GLSL` provides `shoreDist(vec3 dir)`: picks the face from the dominant axis, builds `uv = (dot(d,tu), dot(d,tv)) / dot(d,n) * 0.5 + 0.5`, clamps half a texel inside the tile, and samples the atlas. Its face table mirrors `voxel.ts` and `dirToFaceUV`.

### Sea sphere (`createSphereWater(tier, shoreMap, foam)`)

A `SphereGeometry` at radius `PLANET_RADIUS + 11 - 0.5` (just under layer-11 voxel tops, to avoid z-fighting with shoreline voxel sides), subdivision `sub*2 x sub` with `sub = 128` on `high` and 64 otherwise (the tier field `waterSubdivision` is not used by this function). Transparent, `depthWrite: false`, polygon offset (1, 1), `renderOrder 1`, fog on.

- Waves: `waveField(p, t)` sums four directional sines (amplitudes 0.21/0.14/0.06/0.025, wave numbers 0.34/0.51/1.07/1.93) and returns height plus analytic slope. The vertex shader samples it at `vWorld.xz` ("reasonable approximation near any face centre") and displaces along the radial; the normal is the radial tilted by the slope. The fragment shader re-evaluates the same function so geometry and normals agree.
- Depth (with `USE_SHORE_MAP`): `shore = shoreDist(up)` (0 at coast, 1 far out). `depth = uSeaDepth(11) * mix(0.12, 1.6, smoothstep(0, 0.9, shore))`, then `*= 1 + (1 - N.V)*0.8` so grazing views see more water. Without a shore map (`very-low`): `shore = 1`, `depth = uSeaDepth`, a flat single-depth sea.
- Colour: Beer-Lambert extinction `exp(-uExtinction * depth)` with `uExtinction = (0.28, 0.06, 0.02)` (tuned for the 11-layer sea; `WATER.extinction` would kill all colour at this depth and is not used). Colour ramps `shoal -> shallow` (smoothstep 0..0.35 of `depth/(uSeaDepth*1.6)`) `-> deep` (0.3..1.0), then multiplied by the extinction at 60%.
- Caustics: a two-layer noise web evaluated in a tangent-plane frame built from the local up (`cT = normalize(cross(up, +Y or +X near the poles))`), not world XZ, scaled by `uCaustic` and faded out with shore distance (`1 - smoothstep(0.05, 0.6, shore)`).
- Reflection: fresnel `pow(1 - N.V, 5)`; the sky term is `mix(uHorizon, uSky, max(dot(N, up), 0))` keyed on the local up (not world Y), mixed at `fresnel*0.6`; sun specular `pow(N.H, 80)*2`.
- Alpha: `mix(opacity*0.55, opacity, smoothstep(0, 0.5, shore)) + fresnel*0.3` (clear shallows, opaque offshore).
- Shore foam (`USE_SHORE_FOAM`, defined only if `foam && shoreMap`, i.e. tier `shoreFoam`): two bands roll toward the coast (phase `fract(0.22t + i/2)`, position `0.42*(1 - phase)` in `shoreDist` units), a steady lip at `sd < 0.06`, noise-masked into patches, faded out between 60 and 140 units from the camera, mixed at 0.85 into colour and 0.7 into alpha.

`update(dt)` advances `uTime` and re-copies the palette colours (`WATER.shoal/shallow/deep`, `SKY.horizon/zenith`) and the sun direction each frame, so palette switches and the day cycle apply without rebuilding. `main.ts` also pushes `dayNight.sunDir` into `uSunDir`.

---

## 9. Sky and lighting

### Shared sky model (`render/sky.ts`)

`SKY_UNIFORMS_GLSL` and `SKY_FN_GLSL` define `skyRadiance(dirW)`, used by both the sky dome (`lighting.ts`) and the aerial-perspective pass (`postfx.ts`). Sharing one function guarantees the colour that distant geometry fades toward is bit-for-bit the sky colour in that direction, so the horizon line disappears. Everything is linear; tone mapping happens once in the grade pass.

Contents: zenith-to-horizon gradient (smoothstep on height, nadir below); a two-lobe forward-scatter halo (`pow(s, 6)`, `pow(s, 1.5)` with a wider lobe near the horizon); sun limb glow, disc and sunset limb wash; night darkening (`mix(col, col*0.04, uNight*0.96)`); `nightSkyAddons` (moon disc and glow, Milky Way with a rift, nebulae, stars rotated by `uStarAngle` about a fixed axis; the full galaxy/nebula path only runs when `uNightSkyFull > 0.5`); and `_aurora(dir)` (curtain aurora with ripple, rays, pulse and breathing, active when `uNight * uAurora > 0`).

### Sphere orientation: `uSkyUp` and `_toSky`

The sky model is authored with +Y up. On a sphere the viewer's up is the planet-radial direction, so every lookup is rotated by `_toSky(v)`: shortest-arc (Rodrigues) rotation taking `uSkyUp` to +Y, with `axis = normalize(vec3(-up.z, 0, up.x))`; identity when `up.y > 0.99999`; a 180 degree rotation about X when `up.y < -0.99999`. Without this the gradient, sun height, sunsets and stars were keyed on world Y, so away from the planet's north pole the horizon and zenith were sideways. `skyRadiance` rotates both the view direction and `uSunDirWorld`; stars use the world direction for the celestial rotation but the local direction for horizon fades. `uSkyUp` is set to `normalize(camera.position)` in both `Atmosphere.update` (dome) and `PostFX.render` (haze pass). `scripts/check-sky-frame.ts` mirrors the GLSL and asserts the mapping (and also asserts the axis expression is still in `sky.ts`).

### `Atmosphere` (`render/lighting.ts`)

- Fog: `THREE.FogExp2(hazeColor, 1/AERIAL_D)`, `AERIAL_D = 90`. The shared `THREE.ShaderChunk.fog_fragment` is patched once at module load to subtract `FOG_NEAR = 96` from the fog depth before squaring (clear air near the camera; without it, FogExp2 bites from distance zero and washes the whole frame). If the chunk text changes shape the patch warns and is skipped. `setAerialD` and `setFogEnabled` (settings) keep `scene.fog.aerialD`, which postfx reads each frame. `hazeColor = SKY.haze.lerp(SKY.horizon, 0.35)`.
- Sky dome: sphere radius `worldSize*2.6` (worldSize = 800), `BackSide`, `depthWrite: false`, `renderOrder -1000`, positioned on the camera each frame. Fragment adds a very faint banded cloud (+3.5% max) on top of `skyRadiance`.
- Lights: shadow-casting `DirectionalLight` sun (intensity `RIG.sun = 1.85`), `HemisphereLight` (`RIG.hemi = 1.08`), a camera-side lavender `DirectionalLight` fill (`RIG.fill = 0.22`), `AmbientLight` in haze colour (`RIG.amb = 0.12`). Intensities are overwritten each frame by `DayNight`.
- Shadows: VSM; map size, blur samples and frustum half-extent from the tier (`min(worldSize*0.42, tier.shadowExtent)`); resolution capped by `MAX_TEXTURE_SIZE`; `bias -0.00018`, `normalBias 0.1`, radius 2.25, intensity 0.48; `setShadowResolution` rounds to 1024-multiples within 1024..4096 (0 disables).
- Hemisphere light axis: `HemisphereLight` takes its sky axis from its position (it looks at the origin). Left at the default +Y it lit the planet by world up, so on the flanks every face got the full blue sky term and the scene read cold. `Atmosphere.update` sets `hemi.position = normalize(camera.position)` each frame so its sky axis is the viewer's local up.

### Day/night (`render/day-night.ts`)

`timeOfDay` in [0,1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. Starts at 0.5; `dayLengthSeconds = 1200` (settings "Day speed" divides this). `getNightFactor() = max(0, (|t - 0.5|*2 - 0.3)/0.7)`.

Keyframes at `TIMES = [0, 0.2, 0.27, 0.5, 0.73, 0.8, 1]` (midnight, predawn, sunrise, noon, sunset, dusk, midnight), linearly interpolated per segment:

| Channel | Values |
| --- | --- |
| zenith | `0x080c18, 0x0e1630, 0x2a3a6a, 0x4878a8, 0x1e2a5a, 0x0e1228, 0x080c18` |
| horizon | `0x0c0a08, 0x2a1808, 0xe87840, 0xa0b0b8, 0xd85830, 0x281808, 0x0c0a08` |
| haze | `0x080c10, 0x1e1408, 0xe09050, 0xb0c0c8, 0xe09050, 0x1e1408, 0x080c10` |
| sunColor | `0xa0b8c0, 0xff8830, 0xff6820, 0xffe8b8, 0xff6820, 0xff8830, 0xa0b8c0` |
| sunIntensity | `0.02, 0.25, 0.75, 1.85, 0.75, 0.25, 0.02` |
| hemiIntensity | `0.1, 0.25, 0.55, 1.08, 0.55, 0.25, 0.1` |
| fillIntensity | `0.01, 0.05, 0.12, 0.22, 0.12, 0.05, 0.01` |

Sun direction: `a = t*2pi`; `sunDir = normalize(-cos a, sin a*1.1 - 0.1, 0.3)` (a fixed world-space arc; the sun is not tied to a latitude). Moon is the opposite. Each frame `update` sets: sun position (relative to the shadow target), light intensities/colours (fill colour = sun colour lerped 60% toward `0x8090c0`), sky dome uniforms (`uSkyZenith`, `uSkyHorizon`, `uSkyNadir` <- haze keyframe, `uSunDirWorld`, `uSunGlow` scaled by `max(0, sunDir.y)*intensity*0.087`, `uSunColor` scaled by `max(0, sunDir.y + 0.15)`), night uniforms (`uNight`, `uAurora = max(0, (night-0.5)/0.5)`, `uAuroraTime += dt*0.3`, `uMoonDir`, `uStarAngle += dt*0.0001`), fog colour and renderer clear colour <- haze keyframe, and, when `shadowMap.autoUpdate` is off (`low`, `very-low`), a manual shadow refresh whenever `sunDir.y` has moved more than 0.009.

Voxel material tints pushed each frame via `voxelUniforms`: `uSunDir`; `uSunAmbient = 0.08 + elev*0.18`; `uFillAmbient = 0.04 + (1 - elev)*0.04` (`elev = max(0, sunDir.y)`); `uSunTint` = sun colour pulled toward neutral by `horizonWarm = max(0, 1 - 2.5 elev)^2 * 0.6`; `uAmbientTint = (1 - 0.08n, 1 - 0.04n, 1 + 0.12n)` with `n` the night factor.

`applyNoonSky(sky, sunColorHex)` themes the cycle with the active palette: noon (index 3) zenith/horizon/haze and sun colour take the palette values outright; sunrise and sunset (indices 2 and 4) restart from untouched copies of the authored twilight (`TWILIGHT`) and lean toward the palette: zenith 45%, horizon and haze 35%. Night keyframes are never changed. Resetting from `TWILIGHT` each call means repeated palette switches never drift. Called at startup with the starting palette and on every live switch.

---

## 10. Post-processing (`render/postfx.ts`)

`createPostFX(renderer, scene, camera, edgeMaterial, tier)` builds an `EffectComposer` on a HalfFloat render target (no MSAA):

```
SceneDepthPass -> [EdgeMaskPass] -> Atmosphere(haze) -> [UnrealBloom] -> Crepuscular -> Grade -> [SMAA | FXAA]
```

Bracketed passes depend on tier flags. Everything before Grade is linear HDR.

- `SceneDepthPass`: renders the scene into a dedicated FBO that owns the `DepthTexture`, and blits colour to the composer's read buffer. The depth texture is never a composer ping-pong target, so no pass samples depth while writing to it (WebGL feedback loop).
- `EdgeMaskPass` (`edgeMask` tier flag, `high` only): re-renders the `EDGE_LAYER` outline geometry to a two-channel coverage mask using MAX blending (overlapping round-capped segments become a union), depth-tested against the scene depth, with fog/mist applied in the edge shader.
- Atmosphere pass (`haze`): one fullscreen shader off a single depth fetch: large-scale AO (rosette taps, `uAOTaps` from tier, radius 2.4, strength 0.24), cloud shadow (tier), distance desaturation (`uDesat 0.32`), per-pixel pull toward the true directional sky colour (`uSkyBlend 0.5`, uses `skyRadiance` with `uSkyUp`), analytic exponential height-fog ground mist (`uMistBase 8`, `uMistH 9`, `uMistDens 0.012`, `uMistMax 0.2`), sun in-scatter (0.28), four-tap defocus (`uDof` 1.2 px at full haze, 0 when tier `dof` is false). `uAerialD` mirrors the scene fog; `uFogNear = FOG_NEAR`.
- Bloom: runs after the atmosphere on purpose (haze acts as a light source). Overridden at construction to `threshold 1.25, strength 0.22, radius 0.9` because the palette's bloom numbers are display-space intuitions and the pass sees linear HDR. Added only if tier `bloom`. (The palette's `GRADE.bloom` is still copied onto the pass by `onPaletteChange`, which overrides these constants after the first palette switch. See section 18.)
- Crepuscular rays: 8-tap radial blur toward the sun's screen position, `uTaps` from tier (0/4/8), active only when `uSunVisible > 0.01`. `main.ts` computes the sun NDC position and visibility each frame.
- Grade (`GradeShader`): ACES tone mapping and sRGB conversion performed inside the shader (`material.toneMapped = false`; replaces a separate OutputPass), then lift/gamma/gain, saturation, contrast, vignette, grain (0.006), chromatic aberration (0.0008), a faint "milk" lilac lift (0.01), a highlight knee (0.8), and the edge ink composite (`tEdges` mask, `uEdgeDark (0.39, 0.32, 0.43)`, `uEdgeLight (0.94, 0.91, 0.93)`, opacities mixed in display space after tone mapping so pale ink cannot become an emitter). Grade values come from `GRADE` (palette). `B` toggles the opacities between 0 and (0.64 dark, 0.30 light).
- AA: SMAA (`high`, `mobile-high`, `mid`), FXAA (`low`), none (`very-low`). `needsSwap = false` on these passes avoids the composer ping-pong that caused a depth-texture mismatch and a full-screen flash.

`render(dt)` per frame updates times, inverse projection/view, camera position, `uSkyUp`, fog sync (`uAerialD`, `uMistMax` zeroed when fog is disabled) and calls `composer.render`. `setSize` resizes all targets; `setSunScreenPos` feeds the crepuscular pass.

`renderer.ts`: `antialias: false`, `powerPreference: 'high-performance'`, `ACESFilmicToneMapping`, `VSMShadowMap`, pixel ratio capped at the tier's `dprCap`, clear colour `0x07070a`, `preserveDrawingBuffer` only with `?capture=1`, `shadowMap.autoUpdate = tier is not low/very-low`.

---

## 11. Palette system (`core/palette.ts`)

### Structure

Atmosphere and block colours are exported as mutable objects that are zero-initialised and filled by `setVoxelPalette`: `SKY` (`zenith, horizon, ground, haze, sunTint`), `LIGHT` (sun/sky/ground/fill colours and intensities, `sunDir`), `FOG` (`color` is the same object as `SKY.haze`; `near 74, far 248, heightTop 30, heightFalloff 0.055, density 0.92`; only some fields are consumed), `WATER` (`shoal/shallow/deep` palette-driven; `warm, sheen, edge` constant; `level 24.35`, `opacity 0.88`, `extinction`, `density 0.23`, `saturation 1.2`, `cellTone`, `caustic 0.6`, `reflect 0.85`), `PETAL_COLORS` (6 slots), `MOTE_COLORS` (4 constant), `GRADE`. Systems read these objects every frame or at build time; they must not copy values at import time.

`BLOCKS` is the block library (ids: AIR 0; `GRASS 1, GRASS_LIGHT 2, GRASS_DEEP 3, SOIL 4, SAND 5, GRASS_STONE 6, GRASS_LIGHT_STONE 7, GRASS_DEEP_STONE 8, STONE 10, STONE_PALE 11, STONE_WARM 12, PATH 13, PLANK 20, PLANK_PALE 21, BEAM 22, TRUNK 23, TRUNK_PALE 24, LEAF_PINK..LEAF_ROSE 30-35, LANTERN 40, CRYSTAL 41, CLOTH_PINK 42, CLOTH_CREAM 43, ROOF_ROSE 44, ROOF_LILAC 45`). Dynamic blocks are added with `registerBlock(name, def)` (ids 60..250, `Uint8`). `BLOCK_BY_ID` is the id lookup. Block flags the code relies on: `sway` (leaves; the sway bit), `isTrunk` (solid obstacle for player/dog), `emissive` (glow buffer), `grassCap`, `lightEdge`, `fringe`/`fringeColor`, `topPattern`, `topTint`, `mapColor`.

### `VoxelPalette`

```ts
interface VoxelPalette {
  label: string;
  grass, grassLight, grassDeep, soil, sand, stone, stonePale, stoneWarm: number; // sRGB hex
  foliage: [6 hex];   // LEAF_PINK..LEAF_ROSE
  water: { shoal, shallow, deep };
  sky: { zenith, horizon, ground, haze, sunTint };
  light: { sunColor, sunIntensity, skyColor, groundColor, hemiIntensity, ambient, fillColor, fillIntensity };
  petals: [6 hex];
  grade: { exposure, lift[3], gamma[3], gain[3], saturation, contrast, vignette, bloom{strength,radius,threshold} };
}
```

### Foliage slot-role convention

The six `foliage` slots have the same *role* in every theme, because other systems borrow slots by index:

| Slot | Role |
| --- | --- |
| 0 | primary blossom |
| 1 | pale blossom |
| 2 | accent |
| 3 | pale / cream |
| 4 | leaf green (the only green slot; flowers and butterflies never use it) |
| 5 | deep accent |

Terrain's `LEAF_ROLE` (section 4) composes tree colours from these slots; flowers, mushroom caps and butterflies use `PETAL_COLORS` (and caps use `petals[0,2,3]`).

### Themes

`VOXEL_PALETTES` keys (twelve): seasonal `Spring` (default, "Spring Blossom"), `Autumn` ("Autumn Woodland"), `Alpine` ("Alpine Snow"), `Desert` ("Desert Dunes"), `Alien` ("Alien Biome"); Solar System `Mercury`, `Venus`, `Mars`, `Jupiter`, `Saturn`, `Uranus`, `Neptune`. Consistency conventions in the file: grade saturation roughly 1.0-1.18 and contrast 1.05-1.08, ground quieter than foliage, daytime sky never near-black.

### `NATURAL` filter

Every theme passes through one shared filter so none looks dyed:

| Field | Value | Effect |
| --- | --- | --- |
| `desat` | 0.1 | Fraction of each block colour pulled toward its luminance |
| `warm` | 0.012 | Adds `warm*lum` to red, subtracts from blue (linear) |
| `maxGradeSat` | 1.04 | Cap on `GRADE.saturation` |
| `maxContrast` | 1.12 | Cap on `GRADE.contrast` (floor is 1.08) |

`naturalise()` is applied to every block `top` colour. In addition `LIGHT.skyColor` is lerped 35% toward `(0.72, 0.70, 0.66)` (the hemisphere sky term is the largest cool cast on the scene).

### `setVoxelPalette(name)`

Unknown names are ignored. Otherwise: sets `activePaletteName`; for each palette-driven block copies the naturalised `top` and derives `side = top*sideFactor`, `bottom = top*bottomFactor`, and `tint/topTint/fringeColor = top*sideFactor` (factors 0.88/0.78 for grass and leaves, 0.9/0.8 for soil/sand/stone; `GRASS_*_STONE` use the grass colours); copies water, sky, light, petal and grade values into the shared objects in place.

### Startup and URL

At module load, a block runs `setVoxelPalette(?palette=<key> if it is a valid key, else 'Spring')` before any world code, so the world is built with the right colours. `main.ts` then calls `dayNight.applyNoonSky` for the starting palette.

### Live switch (`main.ts` `settings.onPaletteChange`)

1. `setVoxelPalette(name)`.
2. Sky dome uniforms (`uSkyZenith/Horizon/Nadir/uSunGlow`) from the new `SKY` with the same lerps used at construction.
3. `atmo.hazeColor`, scene fog colour.
4. `dayNight.applyNoonSky`.
5. Hemisphere light colours.
6. Grade uniforms (`uLift/uGamma/uGain/uSat/uContrast/uVignette/toneMappingExposure`) and bloom strength/radius/threshold from `GRADE`.
7. `sphereMap.rebake()`.
8. `world.streaming.rebuildAll(...)` at the current airborne or walking direction (colours are baked into mesh vertex attributes; vegetation patches rebuild through the listener since they read block colours at build time).

Water re-reads `WATER`/`SKY` every frame and needs no step. Petal particle colours are baked into instance buffers; `particles.recolorPetals()` exists but is not called from the switch path (see section 18).

---

## 12. GPU tiering (`render/gpu-tier.ts`)

Tiers: `high`, `mobile-high`, `mid`, `low`, `very-low`.

### Detection

`probeGpu()` returns `{ renderer, webgl2, mobile, cores, memGB }`: creates a throwaway WebGL2 context, reads the renderer string (`WEBGL_debug_renderer_info` unmasked renderer when available, else `RENDERER`), then releases it with `WEBGL_lose_context`. `mobile` is true for `Mobi|Android|iPad|iPhone|iPod` UAs or for iPadOS 13+ (a `Macintosh` UA with `maxTouchPoints > 1`, since no Mac has a touchscreen). `memGB` is `navigator.deviceMemory` (undefined on Safari/Firefox; used only to push a device *down*).

`classifyGpu(probe)` is pure (checked by `scripts/check-tiers.ts`):

- No WebGL2 -> `very-low`. Software renderers (`swiftshader|llvmpipe|software|microsoft basic render`) -> `very-low` on mobile, `low` otherwise.
- Mobile: `memGB <= 2` or `cores <= 4` -> `very-low`; any "Apple" GPU -> `mobile-high`; Adreno 7xx -> `mobile-high`, 61x-6xx -> `mid`, older -> `very-low`; Xclipse/Immortalis -> `mobile-high`; Mali-G (G710+, G78, G77, G76) -> `mid`, older -> `very-low`; unknown: `cores >= 8` -> `mid` else `very-low`.
- Desktop: `memGB <= 2` or `cores <= 2` -> `low`; discrete/Apple Silicon (`nvidia|geforce|quadro|rtx|radeon (rx|pro)|rx NNN|apple mN|apple gpu`, excluding Vega/Radeon(TM) Graphics iGPUs) -> `high` if `cores >= 4` else `mid`; Intel Arc A-series -> `high`; Arc iGPU / Iris Xe / Radeon 6xx-8xxM / generic Radeon Graphics -> `mid`; other Intel -> `low`; unknown: `cores >= 8` -> `mid` else `low`.

`detectGpuTier()`: `?tier=<high|mobile-high|mid|low|very-low>` overrides detection (testing a phone profile or rescuing a misclassified device).

### `TIER_SETTINGS` fields

| Field | high | mobile-high | mid | low | very-low | Meaning |
| --- | --- | --- | --- | --- | --- | --- |
| `dprCap` | 2 | 1.5 | 1.25 | 1 | 1 | Max device pixel ratio |
| `shadowRes` | 3072 | 2048 | 2048 | 1024 | 512 | VSM map size |
| `shadowBlurSamples` | 12 | 8 | 8 | 4 | 4 | VSM blur taps |
| `shadowExtent` | 120 | 110 | 120 | 100 | 80 | Shadow frustum half-extent |
| `cameraFar` | 6000 | 3000 | 3000 | 1500 | 1200 | Camera far plane |
| `bloom` | yes | yes | yes | no | no | Bloom pass |
| `aoTaps` | 8 | 4 | 4 | 0 | 0 | Large-scale AO taps |
| `dof` | yes | yes | yes | no | no | Defocus in haze pass |
| `crepuscularTaps` | 8 | 4 | 4 | 0 | 0 | God-ray taps |
| `edgeMask` | yes | no | no | no | no | EdgeMaskPass (doubles scene draw calls) |
| `cloudShadow` | yes | yes | yes | no | no | Cloud shadow noise in haze pass |
| `nightSkyFull` | yes | yes | yes | no | no | Milky Way/nebula path |
| `aaQuality` | smaa | smaa | smaa | fxaa | none | AA pass |
| `streamRadius` | 16 | 12 | 13 | 9 | 7 | Terrain stream radius (chunks, ~28 units each) |
| `waterSubdivision` | 64 | 32 | 32 | 16 | 4 | Declared; the sea sphere does not read it |
| `particleCount` | 1200 | 700 | 600 | 200 | 0 | Declared; capped at 300 by main.ts |
| `grassDensity` | 1 | 0.7 | 0.8 | 0.45 | 0.25 | Grass tuft coverage |
| `birdFlock` | 14 | 10 | 9 | 0 | 0 | Max birds per flock |
| `clouds` | 26 | 18 | 18 | 10 | 0 | Cloud count |
| `critters` | 28 | 18 | 18 | 0 | 0 | Butterflies (fireflies = 2x) |
| `groundDetail` | 1 | 0.7 | 0.8 | 0.45 | 0.25 | Boulder/log/mushroom multiplier |
| `shoreFoam` | yes | yes | yes | no | no | Animated foam line |
| `foliageDetail` | yes | yes | yes | yes | no | `FOLIAGE_DETAIL` define |

Trees are kept at every tier; only grass and ground clutter scale.

### Startup checks (`main.ts`)

- WebGL2 probe: a throwaway canvas requests `webgl2`, listening for `webglcontextcreationerror` to capture the browser's reason; failure shows the reason on the boot screen and aborts. The probe context is released with `WEBGL_lose_context`.
- Context loss: `webglcontextlost` is prevented and, once per session (`sessionStorage['voxel-planet.gl-reloaded']`), the page reloads after 800 ms (streamed chunks and render targets would otherwise all need rebuilding). A second loss shows a message suggesting `?tier=low`. After 60 s of stable running the flag is cleared, re-arming one reload (repeated GPU resets cause Chrome to block WebGL for the whole site).

---

## 13. FX (`fx/`)

### Particles (`particles.ts`)

`createParticles(worldSize, rng, maxCount)` builds four instanced layers (hero petals 90, mid petals 140, glowing motes 300, near-camera pollen 130, a base total of 660) each scaled by `maxCount/1110`. `main.ts` passes `Math.min(300, tier.particleCount)`: 300 is the authored look (more reads as confetti), and tiers only ever lower it (so `very-low` with 0 draws none). Everything is GPU-animated in the vertex shader (tumble, fall with sway, wrap into a box around the camera, fade at the loop ends). Petal colours are baked from `PETAL_COLORS` at creation; motes use `MOTE_COLORS`.

Caveat: the particle field wraps in `xz` around `uOrigin` and falls along world Y, i.e. it is the flat-world implementation; `uPlanetRadius` is declared but unused in the vertex shader. Away from the planet's top the "fall" direction is not radial.

### Birds (`birds.ts`)

One instanced draw (3 triangles per bird). Every 20-60 s (first flock after 4-12 s) and only when `night < 0.6`, a flock of `max(3, round(maxBirds * U(0.45, 1)))` crosses the sky: a straight line left-to-right or right-to-left relative to the camera, 30-48 units above the player and 28-55 ahead, span 160-220 units at 9-14 units/s, 55% V formation else a loose cluster. Wing flap and bob are in the vertex shader (`uFlap = 9`, `uScale = 3`); alpha fades over the first/last 1/8 of the pass. The flight frame is built from the radial up at launch.

### Clouds (`clouds.ts`)

Instanced voxel-box clusters on a disc of radius 180 in the tangent plane above the player, at heights 70-110, wrapped (torus wrap of the containing square) and faded near the rim; the disc follows the player and is oriented by the local up. Drift accumulates `windDir * dt * 2.2`. One merged geometry per shape variant, shaded top 1.0 / side 0.88 / underside 0.74. `setColors(lit, shade, opacity)` is called each frame from main.ts to tint by time of day (lit = white x1.35 lerped toward the horizon colour, dimmed by night; shade = zenith lerped toward white).

### Critters (`critters.ts`)

`createCritters(scene, count, sampler, seed)`: `count` butterflies (day) and `2*count` fireflies (night), each with a ground *anchor*. Anchors are placed within `SPREAD = 14` units (minimum radius 3) of the player on walkable ground using `GroundSampler.groundAt(dir)` (main supplies: `-1` where `columnTop <= SEA_LAYER`, else `grid.surfaceRadius`; up to 4 retries per anchor), and re-sampled on the CPU in a rolling slice so the whole set turns over every `RESAMPLE = 1.1` s. Around its anchor each critter follows a Lissajous wander in the vertex shader (butterflies 1.9-3.1 above ground, bursts of flapping with glides, banked into turns). Butterflies are a body plus forewing/hindwing panels hinged at the body, coloured from `PETAL_COLORS` (assigned at anchor time, so they follow palette switches as anchors refresh); fireflies are additive blinking points that the bloom pass catches. Butterfly alpha is `1 - smoothstep(night, 0.35, 0.6)`; fireflies `smoothstep(night, 0.45, 0.75)`.

---

## 14. Player

### Camera input (`render/fp-camera.ts`)

- `tangentBasis(up, yaw)`: the single source of truth for movement and view. Reference tangent is world +Y projected onto the plane at `up` (world +X when `|up.y| > 0.9`), rotated by `yaw` about `up`; `rgt = fwd x up`. Returns shared scratch vectors. `scripts/check-controls.ts` verifies W is view-forward and D is screen-right over 500 random orientations.
- `FPCamera`: FOV 72, near 0.02, far from tier. Mouse look via pointer lock (`SENSITIVITY 0.0021`, pitch clamp +/-(pi/2 - 0.05)). Mouse X while in drone mode accumulates into `_droneMX` instead of yaw; mouse Y is deliberately not wired to altitude (drift would cause continuous climb).
- `paused` (setter clears held keys, jump edge and `touchAltAxis`): while true, `keydown` is ignored, `getWishSphere` returns zero, `getJumpEdge` returns false, `isKeyDown` returns false, and touch look is dropped. Pausing is *input-only*: the world, day cycle, drone auto-cruise, dog and effects keep updating by design.
- `getWishSphere(playerDir)`: zero when drone-active, paused, or neither pointer-locked nor touching. Keyboard (WASD/arrows) or joystick (analogue, magnitude <= 1) combined on `tangentBasis(playerDir, yaw)`.
- `updateSphere(dt, dir, groundRadius, speedFraction, grounded)`: skipped while `droneActive`. Head bob `sin(phase)*0.022*speedFraction` at 2.2 Hz when grounded and moving; `camera.up = dir` (so roll is correct anywhere on the sphere); looks along `fwd*cos(pitch) + dir*sin(pitch)`.
- Altitude input for drone/fly: `drainDroneAltDelta(dt)` returns m/s: Space/C (+/-) and touch axis x 12 m/s, plus scroll delta converted to a rate (`delta/dt`) so the caller's `altitude += rate*dt` restores the exact scroll offset.

### Walking (`player/controller.ts`, `SphereController`)

State: `dir` (unit direction from centre), `groundRadius` (eye radius), `verticalVelocity`, `isGrounded`, `speed` (0..1 for bob).

| Constant | Value |
| --- | --- |
| `GRAVITY` | 28 |
| `JUMP_VEL` | 10.5 |
| `WALK_SPEED` / `SPRINT_SPEED` | 9 / 20 |
| `EYE_HEIGHT` | 1.75 |
| `MAX_STEP` | 1.1 |

Per update: look up the column under `dir`; `surfaceR = grid.surfaceRadius` (ground, ignoring leaves and trunks' tops); grounded when altitude above surface <= 0.05; jump sets vertical velocity; gravity applies when airborne; the radius is clamped to the surface. Horizontal: `wishDir` is projected onto the tangent plane, advanced as an arc step `speed*dt/groundRadius`, then two probes are checked: the destination column and one further step ahead (a standoff that keeps the camera a column away from walls to avoid near-plane clipping). If either surface exceeds `eye - EYE_HEIGHT + MAX_STEP`, the move is reverted and `speed` set to 0. Trunks and leaves are not in `surfaceRadius`, so the player walks through leaves; trunks are solid only for the dog's pathfinder (there is no trunk collision for the player controller itself beyond `groundColumnTop` ignoring them). `snapToDir` teleports to a direction and snaps to the surface.

### Drone (`player/drone.ts`)

`createSphereDroneMode()` returns an object with `enter, exit, beginLanding, update` plus `active, landing, altitude, dir, heading`. Always cruises forward (a cinematic drone): base `DRONE_SPEED = 18` m/s (`DRONE_SPRINT_SPEED = 120` with Shift); W doubles it, S stops it. Yaw = mouse X plus A/D x 1.2 rad/s about `dir`; position advances as an arc about `dir x heading`. Vertical: a P-controller (`TERRAIN_FOLLOW_GAIN = 3`, clamped to +/-`DRONE_VSPEED/2`) pulls toward `terrainAlt + HOVER_HEIGHT (14)`; manual vertical input (`DRONE_VSPEED = 20` m/s) adds on top; floor is terrain + `MIN_CLEARANCE (1.5)`, ceiling `PLANET_RADIUS + SHELL_DEPTH + 50`. Landing (`L` or `beginLanding`) lerps altitude toward the surface at rate 3 and deactivates within 0.6 of it. `enter` lifts `ENTER_LIFT = 8` above the current eye radius and picks an initial heading perpendicular to `dir`. Camera: position radial, `up = dir`, look along `heading`. Note the drone uses `columnTop` for its floor, so it rides over tree canopy.

### Fly (`player/fly.ts`)

`createSphereFlyMode()`: free flight; `wishDir` arcs on the sphere at `FLY_SPEED = 24` (`FLY_SPRINT = 70`) m/s; vertical from `drainDroneAltDelta`. Terrain floor `columnTop + 1 + FLOOR_CLEARANCE (1.75)` with descent smoothed (`FLOOR_DROP_RATE = 8` m/s) so cliffs do not snap; auto-climb probes `LOOK_AHEAD = 6` arc-metres ahead and raises altitude by up to `AUTO_CLIMB_RATE = 14` m/s if terrain ahead is higher. The camera orientation is then set by `fpCam.updateSphere` (mouse yaw/pitch apply, up = `fly.dir`).

### Mode cycling and handoff (`main.ts`)

`cycleMode()` (F / touch cycle button): fly -> walk (`exitFly`), drone -> fly, walk -> drone. `land()` (L / touch land): drone -> `beginLanding` (completes inside `drone.update`, then the controller snaps to `drone.dir` and pointer lock is re-requested); fly -> `exitFly` (immediate: `controller.snapToDir(fly.dir)`). Drone -> fly preserves the in-air position (`fly.enter(drone.dir, drone.altitude + PLANET_RADIUS)`) rather than snapping to the ground first. While airborne the streamer, map and critters follow the active mode's `dir`.

---

## 15. Dog (`player/path.ts`, `player/dog.ts`)

### Pathfinder (`createSpherePathfinder(grid, opts)`)

Column-grid A*. Nodes are surface columns `(face, u, v)`; neighbours are the 8 surrounding columns, crossing cube seams through `crossFaceUV`. Options: `maxUp = 2`, `maxDown = 4`, `seaLayer = 11` (the dog passes `DEEP_WATER = 10`), `maxNodes = 20000`.

- Walkability (`groundOf`): the column's top must be above `seaLayer`; a trunk top (`isTrunk`) is impassable; a leaf (`sway`) top means canopy, so the ground below (`groundColumnTop`) is used unless a trunk stands on it. This makes cacti and dead trunks obstacles and lets the dog walk under canopies.
- Step rule: `canStep(from, to)`: `to >= 0`, `to - from <= maxUp`, `from - to <= maxDown`. Diagonal moves additionally require both orthogonal neighbours to be steppable (no corner cutting).
- Cost: 1 (orthogonal) or sqrt 2 (diagonal), plus `0.35` per layer climbed (prefers level routes).
- Heuristic: same face -> octile distance `max(du,dv) + (sqrt2 - 1)*min(du,dv)` (exact on an obstacle-free 8-way grid); different face -> great-circle angle x `COLS_PER_RAD_MIN` (columns per radian at the narrowest, face-edge, column width, so it never overestimates and stays admissible).
- Incremental: `start(from, to)` resets state (fails immediately if either end is not walkable), `step(budget = 400)` expands up to `budget` nodes and returns `'searching' | 'found' | 'failed'`. All storage is preallocated typed arrays sized `maxNodes*8 + 8` (binary min-heap on f, `closed`, `g`, `parent`, `colKey`), plus a `Map` for column key -> node id, so a search creates no per-node garbage. `failed` when the heap empties or `maxNodes` expansions are reached.
- `path` (start column first) is valid when `state === 'found'`.

`scripts/check-dog-path.ts` asserts routing around a wall, avoidance of water and a trunk, climbing a 2-layer terrace, failure on a 6-layer cliff (rise and drop), and that long routes need more than one 400-node step.

### Behaviour (`createSphereDog(grid, scene, spawnDir)`)

| Constant | Value | Role |
| --- | --- | --- |
| `DEEP_WATER` | 10 | Layers <= 10 are unwadeable (the sea surface is at 11.5, so layer-11 shallows are wadeable, as for the player) |
| `HEEL_DIST` | 4 / PLANET_RADIUS rad | "At heel" if within this angle... |
| `SAME_LEVEL` | 0.6 | ...and its ground height is within this of the player's |
| `HEEL_SIDE` / `HEEL_AHEAD` | 1.5 / 4.0 | Heel spot: player's right, ahead (+1.5 while the player is walking) |
| `TELEPORT_DIST` | 45 / PLANET_RADIUS rad | Beyond this it reappears and runs in |
| `STRANDED_DIST` | 8 / PLANET_RADIUS rad | Unreachable and farther than this -> reappear; closer -> wait and re-plan |
| `TROT_SPEED` / `RUN_SPEED` | 8 / 22 m/s | Run (faster than sprint 20) when more than `RUN_COLS = 10` waypoints remain |
| `SEARCH_BUDGET` | 400 | A* nodes per frame |
| `REPLAN_DRIFT` / `REPLAN_EVERY` | 2 columns / 1.5 s | Re-plan when the heel spot drifts or on a timer |
| `HOP_SLOWDOWN` / `HOP_HEIGHT` / `STEP_EASE` | 0.65 / 0.7 / 12 | Terrace hop speed factor, arc height, vertical easing |
| `APPEAR_AHEAD` / `APPEAR_SIDE` / `RUN_IN_AHEAD` | 4.5 / 1.6 / 12 | Where it appears (in view of the camera) |

Logic per frame (when not sitting): if farther than `TELEPORT_DIST` from the player, `appear(...)` ahead of the camera (several candidate spots tried so it never lands in the sea) and run in. Compute the heel spot in the player's tangent frame (`frameAt`, using the camera's forward flattened). Re-plan from its column to the heel spot when the goal has drifted more than 2 columns, every 1.5 s, or if idle away from heel. A search runs `SEARCH_BUDGET` nodes per frame. On `failed`: first fallback is to plan toward the player's own column; if that fails too, it reappears (only if farther than `STRANDED_DIST`) or waits. Movement follows waypoints one column at a time with an arc step; when the next column is more than 0.5 higher it starts a hop (slower, parabolic height `sin(pi*hop)*HOP_HEIGHT` between the two terrace radii). Height otherwise eases to `surfaceRadius`; columns with no ground (unloaded/empty) borrow the player's ground radius. Sitting freezes movement (`toggleSit`, key X).

Model: a handful of `BoxGeometry` meshes (coat `0xe8c9a0`, patch `0x8a5a3c`, nose `0x2a1d18`): body, saddle patch, head group (muzzle, nose, ears), four legs, tail. Origin at the feet, +Z is the nose. Orientation: `mesh.up = dir`, looks toward the next waypoint while moving, else toward the player. Animation: leg swing `sin(gait)*0.6*moving` on diagonal pairs, tail wag `sin(2.2 gait)*0.6`, head bob, and a sit pose (body pitched -0.45 rad, hind legs lowered). `mesh.updateMatrixWorld(true)` is called manually because main.ts disables scene matrix auto-update (`scene.matrixWorldAutoUpdate = false`).

---

## 16. Controls, UI and map

### Bindings (as implemented in `main.ts`, `fp-camera.ts`, `pause.ts`, `touch-controls.ts`)

| Keyboard | Touch | Action |
| --- | --- | --- |
| WASD / arrows, mouse | Left joystick, right-half drag | Move, look |
| Shift | sprint button | Sprint (also drone/fly boost) |
| Space | jump button | Jump; ascend in drone/fly |
| C | descend button | Descend in drone/fly |
| F | cycle button | Cycle walk -> drone -> fly -> walk (icon shows the *next* mode) |
| L | land button (visible only airborne) | Land |
| M | map button | Toggle map (works without pointer lock) |
| G | panels button | Toggle all HUD panels |
| X | dog button | Dog sit / stand |
| B | outlines button | Toggle block outlines (needs pointer lock or touch) |
| [ and ] | time back / forward buttons | Step time of day by 0.125 (3 h); needs pointer lock or touch |
| Esc | pause button | Pause menu (input pause) |
| (gear button) | (gear button) | Settings panel |

F, L, M, G, X work without pointer lock; B and [ ] require `canAct()` (locked or touch). The settings file's header mentions tilde/backquote, but no such handler exists; the panel opens via the gear button (and Escape closes it).

### Touch controls (`ui/touch-controls.ts`)

Active only when `isTouchDevice` (`ontouchstart`/`maxTouchPoints` *and* `(pointer: coarse)`; plain `maxTouchPoints > 0` is true on many touchscreen-less Windows laptops). Otherwise a stub with no-op callbacks is returned. Components: nipplejs dynamic joystick in a left-half zone (size 110) feeding `fpCam.setTouchMove`; swipe-look from touches starting on the right half of the canvas (`LOOK_SENSITIVITY = 0.004` rad/px, per-touch id tracking); a column of 12 circular buttons (60 px, 46 px at height <= 560 px). Hold buttons (jump/ascend, descend, sprint) set `touchAltAxis` / `touchSprint`; tap buttons use `touchend`. `update(droneActive, landing, flyActive)` shows the land button when airborne and sets the cycle button's icon (walk 🚶 / fly ✈ / drone 🚁). Pause and map overlays sit at z-index 45 and 20 respectively; the button column is at 21 so the map can be closed.

### Pause (`ui/pause.ts`)

Esc toggles; shows Resume and Map buttons and an adaptive binding list (keyboard or touch tables). Opening sets `fpCam.paused = true` (remembering the previous value); closing restores it. Clicking the backdrop or Esc closes; M while open closes and toggles the map.

### Settings (`ui/settings.ts`)

Stored under `localStorage['VoxelWorld.settings']` with `_version = 3`. Defaults: `inkWidth 0.0925` (shown as 1.85 px = value/0.05), `zoomMin 50`, `zoomMax 120`, `fogEnabled true`, `fogStart 420`, `loadRadius 16`, `shadowResolution 3072`, `planetRadius 350`, `daySpeed 1`, `windStrength 0.4`. Values are clamped on load (`clampAll`) and save. Migration: values stored at the former defaults (`loadRadius` 5 or 12, `shadowResolution` 4096, or the previous ink default) are carried to the new default when `_version < 3`.

Wiring that works at runtime: seed field (reload with new seed), palette select (`onPaletteChange`), fog toggle and distance (`atmo.setFogEnabled`, `atmo.setAerialD`), shadow resolution (`atmo.setShadowResolution`), day speed (`dayNight.dayLengthSeconds = 1200 / speed`), and load radius (`streaming.setLoadRadius`). The slider range is 3..16, but the streamer clamps to the tier's `streamRadius` as its ceiling (`setLoadRadius` takes `max(3, min(maxRadius, round(r)))`), so the displayed status ("N chunks, M loaded, K queued") shows the effective value. Opening the panel sets `fpCam.paused` (restored on close). See section 18 for sliders whose targets are not wired in the current `main.ts`.

### Map (`render/map.ts`)

`createSphereMap(grid)` bakes a 1024x512 equirectangular image (longitude `atan2(z, x)`, latitude `asin(y)`) by sampling the grid per pixel: ocean (`columnTop <= SEA_LAYER`) coloured `shoal`/`shallow`/`deep` by depth below sea level (<2, <6, else), land by the top block's `mapColor ?? top ?? side`. `rebake()` is called after palette switches. Each frame it draws the player arrow (forward direction projected onto the local east/north axes) and landmark icons (one drawing function per kind) with hover tooltips (`LANDMARK_LABELS`). Displayed at 971x486 CSS px, max 90vw/90vh; on touch the map closes on tap.

### HUD (`ui/hud.ts`)

Title that fades after ~3.2 s, a time-of-day chip (`HH:MM`, sun/moon icon switching at 06:00 and 20:00), an altitude chip (`up N m`, shown only in drone mode via `drone.altitude`), keyboard shortcut hints for X, M and Esc (hidden on narrow or coarse-pointer screens), and a settings button (made visible after the boot overlay is dismissed). `toggle()` (G) hides or shows the whole HUD root. `announce(name)` exists but is not called.

### Boot screen (`index.html`, `styles.css`)

`#boot` overlays the page until dismissed. A CSS 3D cube (`.ls-cube`, `preserve-3d`, parent `perspective: 240px`, faces `translateZ(32px)` after the appropriate `rotateX/Y`) spins via `@keyframes ls-voxel`. A progress bar (`.ls-bar span` width = progress) and the label (`.ls-controls`, set from `onProgress` labels) are driven by `setProgress` in main.ts. On first frame the label is replaced by the control hints, `.ready` is added, and a click handler dismisses the overlay (`.dismissed` then `.gone` on `transitionend`), shows the settings button and requests pointer lock. Failures (`fail(msg)`) write to `.ls-sub` with the `error` class and reset the bar.

### Landmarks (`world/landmarks.ts`)

`buildSphereLandmarks(grid, rng)` runs after terrain: for each of the 6 faces it picks up to `LANDMARKS_PER_FACE = 2` random land columns (margin 10 from face edges; land = `columnTop > SEA_LAYER + 1`; at least `MIN_SEP = 20` apart in both `u` and `v`; up to 400 attempts per face), and builds the next structure from a rotating list: twisted spire, obelisk, monolith ring, tombstone field, floating biosphere, ancient well, ruined arch. Builders write blocks with a non-overwriting `put` (footings use `overwrite`) in face-local coordinates. Returns `LandmarkRecord[]` (`kind` and unit `dir`) for the map. Landmark structures are placed after terrain/trees but are not given a clearing, so overlaps with trees resolve by first-writer (`put` skips occupied cells).

---

## 17. Checks and tooling

`package.json` (ESM, Node >= 23.6 for native TypeScript stripping):

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `vite --port 5161 --strictPort` | Dev server at `http://localhost:5161/voxel-planet` (base path `/voxel-planet/`). `vite.config.ts` lists port 5170 but the script flag wins |
| `build` | `tsc --noEmit && vite build` | Typecheck then production bundle (`target es2020`, `three` split into its own chunk) |
| `typecheck` | `tsc --noEmit` | |
| `preview` | `vite preview --port 5161` | |
| `check` | four node scripts (below) | Sanity checks |
| `format` | `prettier --write "src/**/*.{ts,css}" "scripts/**/*.ts" vite.config.ts index.html` | Prettier config: 4-space tabs, single quotes, trailing commas, 120 columns |

`npm run check` runs, in order:

1. `node scripts/check-controls.ts`: for 500 random up vectors and yaws, `tangentBasis`'s `fwd`/`rgt` match a real `PerspectiveCamera.lookAt` frame (W = view-forward, D = screen-right).
2. `node scripts/check-tiers.ts`: `classifyGpu` over a table of ~25 real renderer strings (desktop discrete/iGPU/Arc, SwiftShader, Adreno/Mali/Xclipse/Apple mobile, low-memory phones, no WebGL2).
3. `node --import ./scripts/ts-resolve.mjs scripts/check-dog-path.ts`: pathfinder scenarios on a hand-built patch (wall, water, trunk, terrace, cliff, incremental search).
4. `node scripts/check-sky-frame.ts`: JS replica of `_toSky` maps `up` to +Y and keeps horizontal directions on the horizon; also greps `sky.ts` for the exact axis line so a shader change forces an update here.

`scripts/ts-resolve.mjs` registers a `node:module` resolve hook that retries extensionless relative specifiers (`'./palette'`, as Vite allows) with `.ts`. Only `check-dog-path.ts` needs it because it imports `src/core/voxel.ts` and `src/player/path.ts`, which import siblings without extensions; the other checks import files whose own imports are fully resolvable (or only external modules). Deployment: `.github/workflows/deploy-pages.yml` builds with Node 20 and publishes to GitHub Pages on push to `main`.

---

## 18. Debug hooks and known gaps

### `window.__game` and `window.__fps`

`window.__game = { scene, renderer, fpCam, world, controller, post, atmo, dayNight, tier, dog, blocks: BLOCKS }`. `window.__fps` is a rolling average updated every 0.75 s (shown in the settings panel). Query parameters: `?seed=`, `?palette=`, `?tier=`, `?capture=1` (enables `preserveDrawingBuffer`), `?shadow=<px>` (diagnostic override of the default shadow resolution constant in `lighting.ts`).

### Behaviours worth knowing (verified in code, not necessarily intended)

- Settings sliders for outline width, camera near/far (`rig.setZoomRange` is a stub) and planet radius are persisted but have no effect: `main.ts` passes `world: { streaming }` only, so `world.meshes`, `world.allPlanetUnis` are absent. Wind strength is read once at startup from storage; moving the slider afterwards does not change `_windBase` for the same reason.
- `uWaterMap` is never assigned (`setVoxelWaterline` referenced in a comment does not exist), so the voxel shader's waterline ink stroke samples an unbound sampler and draws nothing. The `uWaterLevel`/`uWorldSize` constants are flat-world leftovers.
- `Atmosphere.followTarget(x, z)` (called each frame with the camera x/z) translates the sun and its shadow target in world X/Z only, which is a flat-world holdover; the shadow target is therefore not moved radially to follow the player on the sphere (unverified at runtime). `DayNight` repositions the sun relative to `sun.target.position`.
- `SCRUB_DRY` plants are placed in deserts but `drawPlant` has no case for them, so nothing is rendered.
- `particles.recolorPetals()` is not called on palette switch, so petal particles keep their original colours until reload. Butterfly colours do refresh.
- The bloom pass is constructed with hard-coded `0.22 / 0.9 / 1.25` but `onPaletteChange` overwrites them with `GRADE.bloom` values after any palette switch.
- Tier fields `waterSubdivision` and (above 300) `particleCount` are declared but do not drive geometry: the sea sphere uses 128/64 segments by tier name, and particles are capped at 300 in `main.ts`.
- `WATER.level` (24.35) and `FOG.near/far/...` are legacy constants from the flat world; the sea level used everywhere is layer 11.
- The default `LIGHT.sunDir` in `palette.ts` is only an initial value; `DayNight` overwrites it through uniforms each frame.
