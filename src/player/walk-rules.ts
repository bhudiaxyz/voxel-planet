/**
 * Walk rules — what blocks someone walking on the ground, shared by the player and the dog.
 *
 * Purpose
 *   One definition of "obstacle" for every ground walker, so the player's controller and the
 *   dog's pathfinder can't drift apart (the dog used to trot through rocks, tall shrubs and
 *   yucca that the player bumped into).
 *
 * Operations
 *   - isBodyObstacle(block): voxel obstacles — tree and dead trunks (isTrunk, which includes
 *     cacti), bushes and shrubs (sway + solid), cacti (PATTERN.CACTUS). Leaves (sway, not solid),
 *     water and air are not.
 *   - clutterHeight(grid, face, u, v, obstacleAt): the height above the ground of non-voxel
 *     clutter at a column — a sprite plant's obstacleH (tall shrub, yucca, dry scrub; plants.ts)
 *     or a rock/log from the vegetation layer's map (obstacleAt = veg.obstacleAt). 0 = clear.
 *   Walk-through by omission: grass, flowers, ferns, moss, lichen, tall grass, reeds, mushrooms,
 *   pebbles, lily pads, and rocks/logs under 0.2 (never recorded).
 *
 * Usage
 *   player/controller.ts blocked(): body obstacles at body height, plus clutter unless the feet
 *   are above it (the player can jump over low clutter).
 *   player/path.ts groundOf(): a column whose ground block (or the block over canopy ground) is a
 *   body obstacle, or that has any clutter, is not walkable (the dog doesn't jump).
 *
 * See also: player/controller.ts, player/path.ts, world/plants.ts (obstacleH),
 * world/vegetation.ts (obstacleAt); DESIGN.md "14. Player" and "15. Dog".
 */
import { SphereVoxelGrid } from '../core/voxel';
import { BLOCK_BY_ID, PATTERN, type BlockDef } from '../core/blocks';

/** Height (world units) of rock/log clutter at a column, 0 if clear — the vegetation map. */
export type ObstacleMap = (face: number, u: number, v: number) => number;

/** A voxel no walker passes through: trunks (incl. cacti), bushes/shrubs, cacti. */
export function isBodyObstacle(b: BlockDef | undefined): boolean {
    return !!b && (!!b.isTrunk || (!!b.sway && !!b.solid) || b.pattern === PATTERN.CACTUS);
}

/** Height above the ground of blocking non-voxel clutter at a column (sprite plant or rock/log), 0 = clear. */
export function clutterHeight(
    grid: SphereVoxelGrid,
    face: number,
    u: number,
    v: number,
    obstacleAt: ObstacleMap | null,
): number {
    const id = grid.plantAt(face, u, v); // 0 = no plant (BLOCK_BY_ID[0] is the AIR record)
    const plant = id !== 0 ? BLOCK_BY_ID[id]?.obstacleH ?? 0 : 0;
    const rock = obstacleAt ? obstacleAt(face, u, v) : 0;
    return Math.max(plant, rock);
}
