# Voxel Planet

A First-person procedural voxel planet wilderness explorer built with Three.js. Every world is generated from a single seed — terrain, biomes, vegetation, weather, and sky are all deterministic and shareable via URL.

The entire landscape is generated at runtime. There is no backend, external game engine, downloaded asset pack, or prebuilt world map.

## Highlights

### World Generation

- **Cube-sphere mapping** — 6-face cube projected onto a sphere (radius 500m) for seamless polar geometry with no distortion seams
- **Procedural terrain** — seeded Perlin noise with three modes: Simplex (smooth), Fractal (fBm), Ridged (mountains); configurable octaves, amplitude, and period
- **7 biomes** — Ocean, Beach, Grassland, Forest, Desert, Mountain, Snow — classified by altitude + moisture noise
- **Cave system** — two-octave 3D density field carves caves through the terrain; frost pass converts Mountain/Snow cave walls to Snow blocks
- **18 block palettes** — procedural canvas texture atlas (1024×1024) with biome-themed and Solar System planet variants (Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto); selected by `seed % 18`

### Vegetation

- **12 tree species** — Spruce, Pine, Oak, Beech, Birch, Snag, Karst, Cherry, Willow, Palm, Fir, Krummholz; placed by altitude + moisture; snow-tinted variants at high elevation
- **9 undergrowth types** — Shrub, Fern, Flower, Mushroom, Moss, Rock (small/large), Ice Spike, Floating Island
- **Grass & reeds** — cross-hatch blade geometry with per-blade biome/altitude tint; wind sway via vertex shader injection
- **Wind sway** — all vegetation animates with configurable amplitude per species; gust frequencies and instance-phase variation prevent uniformity

### Atmosphere & Weather

- **Procedural sky** — gradient dome with sunrise/sunset scatter, crepuscular rays, sun disc + halo, moon disc + glow, galaxy/nebula layer, aurora borealis (40% nightly chance)
- **42,000 stars** — temperature-coloured, magnitude-varied, with twinkle and rotation around the planet's Y axis
- **8 weather states** — Clear, Breezy, Cloudy, Low Clouds, Overcast, Rain, Snow, Fog; transitions on a 50–110s random interval or via `Tab`
- **Dynamic precipitation** — rain (`THREE.Points` shader), soft circular snowflakes with pendulum drift, beach drizzle
- **Day/night cycle** — 600s full day; sun and moon directions derived per-frame from `timeOfDay` relative to the player's local up vector; adaptive torch light at night with flicker

### Rendering

- **Post-processing pipeline** — Bloom (Unreal) → FXAA → Output (ACESFilmic tone mapping)
- **Greedy mesher** — axis-aligned runs merged into quads, reducing draw calls significantly; AO computed per-corner on the mesh
- **LOD streaming** — three LOD rings (detail / mid / far); chunk set recomputed only when player moves > 0.5 chunks
- **Smooth sphere backdrop** — CPU-baked far-field sphere with hard biome step colours and edge AO for a painterly horizon before voxel chunks load
- **Animated water** — vertex swell + cross-chop + capillary ripple; FBM normal perturbation, Fresnel sky reflection, four time-of-day colour stops, foam at wave crests, moonlit shimmer
- **Adaptive pixel ratio** — scales down DPR when FPS drops below threshold; recovers when sustained above target
- **Shadow gating** — shadow map only updates when the sun direction changes beyond a threshold, avoiding per-frame shadow renders

### HUD & Settings

- **lil-gui panel** — live-tweak terrain noise params, time of day, weather, wind, render quality preset, vegetation density
- **Seed sharing** — seed written to `?seed=` URL param on load; paste the URL to share the exact world
- **New World button** — regenerates with a fresh random seed without a full page reload

## Controls

| Key | Action |
| --- | ------ |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Space` | Jump (walk) / Rise (fly/drone) |
| `Z` | Descend (fly/drone) |
| `F` | Toggle fly mode |
| `G` | Toggle drone mode |
| `Tab` | Cycle weather state |
| `T` | Step through time-of-day stops (sunrise → morning → noon → afternoon → sunset → dusk → night) |
| Mouse | Look (click canvas to lock pointer) |

## Getting Started

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Append `?seed=<number>` to load a specific world.

```bash
npm run build   # type-check + production bundle
npm run preview # serve the dist/ bundle locally
```

## Architecture

```text
src/
├── main.ts               # seed resolution, Game bootstrap
├── config.ts             # typed re-exports from settings/defaults.json
├── settings/defaults.json # all tunable constants
├── core/
│   ├── Game.ts           # rAF loop, input dispatch, underwater fog
│   ├── Renderer.ts       # WebGLRenderer + EffectComposer, adaptive DPR
│   ├── CameraController.ts # sphere-surface physics (walk/fly/drone), collisions
│   └── Hud.ts            # DOM HUD + lil-gui settings panel
├── planet/
│   ├── Planet.ts         # world orchestrator, spawn point, terrain queries
│   ├── CubeSphere.ts     # 6-face cube-sphere coordinate mapping
│   ├── TerrainNoise.ts   # seeded Perlin, fBm, ridged multifractal, cave density
│   ├── Biomes.ts         # height+moisture → biome, block type, density params
│   ├── BlockAtlas.ts     # canvas texture atlas baker, 18 palettes
│   ├── ChunkManager.ts   # LOD streaming, mesh build queue, vegetation placement
│   ├── VoxelChunk.ts     # greedy mesher, AO, cave/water fill, ghost-edge sampling
│   ├── Environment.ts    # lighting, weather, precipitation, aurora, shared uniforms
│   ├── Sky.ts            # sky dome, star field
│   ├── SmoothSphere.ts   # far-field backdrop sphere
│   └── Water.ts          # animated water sphere
├── shaders/              # GLSL strings for sky, smooth sphere, voxel chunks
├── vegetation/
│   ├── VoxelTree.ts      # 12 species, merged BoxGeometry
│   ├── VoxelUndergrowth.ts # 9 undergrowth types
│   ├── VoxelGrass.ts     # cross-hatch blade geometry
│   └── WindSway.ts       # onBeforeCompile wind injection
└── utils/                # GPU tier detection, seeded PRNG, math helpers
```

**Shared uniforms** — `Environment` holds a `SharedEnvUniforms` object (sun direction, time of day, wind, ambient colour, etc.) passed by reference into every shader material at construction. A single `environment.update()` call per frame drives all materials simultaneously with no per-material copy.

**Determinism** — `SeededRandom` (PCG-XSH-RR) and `combineSeed(seed, ...parts)` (LCG mix) give reproducible sub-streams for biome noise, palette selection, vegetation placement, and aurora chance — all rooted in the URL seed.

**GPU quality tier** — `getGpuTier()` reads `WEBGL_debug_renderer_info` to classify the GPU as `high`, `medium`, or `low`, selecting a matching preset for pixel ratio, antialiasing, shadows, and view/detail radii. Override with `forcedLevel` in `defaults.json`.

## Tech Stack

| | |
| --- | --- |
| Renderer | [Three.js](https://threejs.org/) r165 |
| Build | [Vite](https://vitejs.dev/) 5 + TypeScript 5 (strict) |
| Settings UI | [lil-gui](https://lil-gui.georgealways.com/) |
