# Voxel Planet

A first-person explorer on a procedurally generated **spherical** voxel planet, built with Three.js, TypeScript and Vite. Walk, fly a drone or soar across a real sphere — continents, rivers and lakes, deserts, forests, oceans and ancient landmarks — with a companion dog at your heel. The horizon curves away because the world truly is round.

Inspired by **Verdant** [https://github.com/xikhar/verdant] and **Petalfell** [https://github.com/xikhar/voxel-game-original], along with aspects of **Beyond Fable** [https://github.com/xikhar/beyond-fable]. Controls match its sibling project, **planet-explorer**.

## Highlights

- **A real round world** — terraced continents, beaches and highlands, generated from a seed. Share a planet with `?seed=word`.
- **Rivers, streams, lakes and ponds** — water traced downhill from the hills and carved into the land, never standing above its banks, with lily pads, reed beds and fireflies at dusk.
- **Living landscapes by altitude** — palms, mangroves and willows on the coast; oaks, acacias, baobabs and rainforest giants in the lowlands; birch, cypress and pine in the midlands; firs and spruces in the highlands; juniper and wind-bent pines at the treeline. Ground cover changes with height too.
- **Deserts** — dune bands near the equator with saguaros, barrel cacti, prickly pears and organ pipes; dead snags on higher ground.
- **Varied trees** — five kinds of bark (furrowed oak, papery birch, scaly pine, ringed palm, smooth willow), leaf litter underfoot and vines hanging from tropical canopies.
- **Soft, textured voxels** — gently lumpy turf, sand and stone with layered cliff faces, kept soft rather than noisy.
- **Meadows full of detail** — grass, flowers, ferns, reeds, mushrooms, boulders and fallen logs, all swaying in the wind.
- **Life in the air** — flocks of birds, soft billowy voxel clouds that cast shadows on land and water, butterflies over the flower drifts by day and fireflies at night.
- **Water that reads as water** — clear sandy shallows deepening to ocean blue, with caustics and a foam line along the coast.
- **Long views** — a wide detailed terrain radius with a low-detail shell beyond it, so distant land stays visible instead of disappearing into mist.
- **Day and night** — a full day cycle with sunrises, sunsets, stars, the Milky Way and aurora.
- **Twelve colour themes** — Spring, Autumn, Alpine, Desert and Alien, plus seven inspired by the Solar System. Switch live in Settings, or start with `?palette=Mars`.
- **A companion dog** — finds its way to you around obstacles, and sits when told.
- **Three ways to travel** — walk, drone or free flight.
- **Ancient landmarks** — 27 named ruins of eleven kinds (spires, obelisks, stone rings, tomb fields, biospheres, wells, arches, ziggurats, watchtowers, crystal groves and aqueducts), plus floating sky islands, each with a glowing gem that shows by night.
- **Locations panel** — one-tap teleports to every landmark and sky island (📍, top left).
- **A readable map** — colour-coded landmark badges with their names, a compass, and your position always on top.
- **Runs everywhere** — desktop, laptop, tablet and phone. Quality adapts to the device, and touch controls appear on touch screens.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5161/voxel-planet
```

Architecture and all technical detail are in [DESIGN.md](DESIGN.md).

## Controls

| Keyboard & mouse | Touch | Action |
| --- | --- | --- |
| WASD · Mouse | Left thumb · Right drag | Move · Look |
| Shift | ⚡ | Sprint |
| Space · C | ↑ · ↓ | Jump / ascend · Descend |
| F | 🚁 / ✈ / 🚶 | Cycle walk → drone → fly (icon shows the next mode) |
| L | 🛬 | Land |
| M | 🗺️ | Map |
| G | ☰ | Show / hide panels |
| X | 🐕 | Dog sit / stand |
| B | ⬡ | Block outlines |
| [ · ] | ◀ · ▶ | Time of day |
| Esc | ⏸ | Pause |
| ⚙ | ⚙ | Settings |

## License

Released under the [MIT License](LICENSE).
