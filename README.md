# Voxel Planet

A first-person explorer on a procedurally generated spherical voxel planet (Three.js + TypeScript + Vite). Walk, drone, or fly across a genuine sphere — continents, oceans, forests, and ancient landmarks all mapped onto a cubemap grid. The horizon curves away naturally; physics and rendering agree because the world truly is a sphere.

Inspired by **Verdant** [https://github.com/xikhar/verdant] and **Petalfell** [https://github.com/xikhar/voxel-game-original], along with aspects of **Beyond Fable** [https://github.com/xikhar/beyond-fable].

## Highlights

- **True sphere world** — `SphereVoxelGrid` maps the planet surface onto a 6-face cubemap (`FACE_RES = 400`, `PLANET_RADIUS = 350`). Physics, terrain, vegetation, and collision all work in sphere-native coordinates — no flat-world approximation.
- **Procedural terrain** — sculpted with domain-warped FBM noise into terraced continents, beaches, and highlands. Each seed produces a distinct world; share the URL (`?seed=word`) to share an exact planet.
- **Day/night cycle** — a 20-minute day with seven keyframed sky palettes. Watch the sun rise through orange haze, reach a pale noon, and set again.
- **Night sky** — procedural stars, a Milky Way with Great Rift dust lane, emission nebulae, and a moon disc.
- **Aurora** — animated curtain aurora at deep night: flickering vertical rays, sweeping pulse waves, and colour that shifts from green through cyan to magenta.
- **Volumetric-style atmosphere** — sunrise/sunset limb glow, crepuscular rays, animated cloud cover, aerial perspective, and exponential ground mist.
- **Fly and drone modes** — free-flight (F) or terrain-following drone (V) with P-controller altitude hold, auto-climb over obstacles, and smooth landing state machine. Both modes floor against the full voxel column height (including tree canopy).
- **Ink edge rendering** — toon-style dark and light strokes at block boundaries, composited in display space after tone mapping. Toggle with E.
- **Rich vegetation** — five tree forms (spire, palm, broad, weeping, round) with tall trunks and bushy canopies, plus ferns, red ferns, shrubs, reeds, tall grass, moss, and lichen. All placed in sphere-native face-local coordinates.
- **Sphere landmarks** — seven ancient structure types seeded across the planet (2 per face, ~12 total): twisted spires, obelisks, monolith rings, tombstone fields, floating biospheres, ancient wells, and ruined arches. Each appears on the map with a distinct icon; hover for a label.
- **Equirectangular map** — press M to open a full-planet map baked from terrain block colours. Your position is a directional arrow; landmarks show as colour-coded icons.
- **Companion dog** — follows you across the sphere surface; `Y` to sit or stand.
- **Touch controls** — full virtual joystick overlay with map button, auto-detected on load.
- **Seasonal palettes** — five world colour palettes (Autumn, Spring, Alpine, Desert, Alien) selectable from the pause menu. Switching re-colours sky, fog, lights, water, grade, and meshes live — no reload.
- **GPU tiering** — five quality tiers tuned at startup from device cores, memory, and texture unit size.
- **Wind sway** — leaves and shrubs sway in the breeze; adjustable wind strength in settings.

For architecture and implementation details, see [DESIGN.md](DESIGN.md).

## Run

Needs Node.js 18+.

```bash
npm install
npm run dev
```

Open [http://localhost:5180/voxel-planet](http://localhost:5180/voxel-planet). First load generates the world — give it a few seconds.

```bash
npm run build     # production bundle → dist/
npm run preview   # serve that bundle locally
npm run check     # controls sanity check (needs Node 23.6+ for .ts)
```

## Controls

### Keyboard & mouse

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| Space | Jump |
| Shift | Sprint |
| F | Toggle fly mode (free flight, terrain floor) |
| V | Toggle drone mode (terrain-following, A/D steer) |
| L | Land drone |
| Space / C | Ascend / descend (fly or drone) |
| Scroll | Ascend / descend (drone) |
| E | Toggle edge outlines |
| Y | Tell the dog to sit or stand |
| M | Toggle map |
| [ / ] | Step time of day back / forward by 3 hours |
| Esc | Pause / release pointer |

Click in the viewport to capture the pointer. Press Esc to release it.

### Touch (phone / tablet)

| Control | Action |
| --- | --- |
| Left joystick | Move / steer |
| Swipe right half | Look |
| ↑ | Jump / ascend |
| ↓ | Descend (drone or fly) |
| ⚡ | Sprint |
| ✈ | Toggle fly mode |
| 🚁 | Enter drone mode |
| 🛬 | Land drone |
| ⬡ | Toggle edge outlines |
| ◀ / ▶ | Step time of day back / forward |
| 🐕 | Tell the dog to sit or stand |
| 🗺 | Toggle map (tap the map to close it) |
| ⏸ | Pause / show controls |
| ⚙ | Settings |

## Settings

The settings panel (⚙, top right) exposes day speed, shadow resolution, bloom, wind strength, and the world seed, plus a **New world** button.

## Dependencies

`three`, `nipplejs`, and `vite` are the only runtime dependencies. No image or model assets — every block, character, and effect is built in code.

## Deploy

The project is configured for GitHub Pages. Push to `main` and the `deploy-pages` workflow builds and publishes automatically.

## License

Released under the [MIT License](LICENSE).
