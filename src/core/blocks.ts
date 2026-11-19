/**
 * The block library: what every voxel id IS — its colours, surface pattern and
 * behaviour flags. (How the world is COLOURED — sky, light, themes — lives in
 * palette.ts, which recolours the palette-driven blocks here on theme change.)
 *
 * Three ways a block comes into being:
 *   1. Built-ins in BLOCKS below (ids 1..59): ground, rock, wood, leaves, accents.
 *      Palette-driven ones start with zeroed colours (z()) and are filled by
 *      setVoxelPalette() in palette.ts.
 *   2. registerBlock() from a feature module (ids 60..250): bark and leaf
 *      species (world/trees.ts), shrubs and cacti (world/plants.ts), river water
 *      (world/rivers.ts), landmark stone (world/landmarks.ts). Each feature owns
 *      its blocks next to the code that places them.
 *   3. Nothing else: the grid stores the id, everything else is looked up in
 *      BLOCK_BY_ID at mesh time.
 *
 * How a block's fields reach the screen: the mesher (core/voxel.ts,
 * meshSphereFaceRegion) bakes them into per-vertex attributes —
 *   top/side/bottom -> vertex colour per face     tint -> pattern's second colour
 *   pattern/sway    -> aData.y bits               fringe/style flags -> aData.z
 * and the voxel fragment shader (FRAG_BODY) picks the surface function from
 * those. See "Shading flags" in DESIGN.md for the full encoding.
 *
 * Usage
 *   import { BLOCKS, BLOCK_BY_ID, PATTERN, GROUND_MAT, registerBlock } from '../core/blocks';
 *   grid.set(face, u, v, layer, BLOCKS.STONE.id);          // place a built-in
 *   const b = BLOCK_BY_ID[grid.get(face, u, v, layer)];    // look one up
 *   export const MOSS = registerBlock('MOSS', {             // define a new one (top level!)
 *       top: c(0x5a7a3a), side: c(0x4a6a30), bottom: c(0x3a5a28), tint: c(0x6a8a48),
 *       groundMat: GROUND_MAT.GRASS,
 *   });
 *
 * Rules
 *   - Ids are assigned in registration (module-load) order and are not stable
 *     across refactors: never persist them (saves, URLs).
 *   - Changing a block's colour at runtime needs the chunks rebuilt
 *     (streaming.rebuildAll) — colours are baked into vertices.
 *   - A new surface look = a new pat*() function in voxel.ts + a flag here
 *     (all 8 PATTERN ids are taken; use a fringe flag range like GROUND_MAT).
 *
 * See also: core/palette.ts (themes, setVoxelPalette), core/voxel.ts (mesher and
 * shader), DESIGN.md "11. Palette system" and "6. Voxel material shader".
 */

import * as THREE from 'three';

// Hex input is sRGB; current Three.js converts it to the linear working space.
const c = (hex: number) => new THREE.Color(hex);
/** Placeholder colour, filled by setVoxelPalette (palette-driven blocks). */
const z = () => new THREE.Color(0);

/**
 * Everything a block can declare. All optional except id/name/colours; the
 * mesher and shader treat a missing flag as false/0.
 */
export interface BlockDef {
    id: number;
    name: string;
    /** Face colours (linear). */
    top: THREE.Color;
    side: THREE.Color;
    bottom: THREE.Color;
    /** Second colour the surface pattern blends toward (veins, mortar, mottle). */
    tint: THREE.Color;
    /** Top-face override of `tint` (grass, snow). */
    topTint?: THREE.Color;
    /** Surface pattern (PATTERN); `topPattern` overrides it on top faces. */
    pattern: number;
    topPattern?: number;
    /** Lip draped down exposed side faces: fraction 0..1 of the face, in `fringeColor`. */
    fringe: number;
    fringeColor?: THREE.Color;
    /** Material texture for plain terrain (GROUND_MAT) — patGround in the shader. */
    groundMat?: number;
    /** Natural-stone style (ROCK) — patRock in the shader. */
    rockStyle?: number;
    /** Bark style 0 furrowed, 1 papery, 2 scaly, 3 ringed, 4 smooth — patBark* in the shader. */
    barkStyle?: number;
    /** Specular roughness hint (0 glossy .. 1 matte). */
    rough: number;
    /** Leaf-like: wind sway, canopy shading, drawn double-sided, walk-through unless `solid`. */
    sway?: boolean;
    /** With `sway`: an obstacle (bushes) rather than walk-through canopy. */
    solid?: boolean;
    /** Tree trunk: solid, the vegetation layer reads it (logs/mushrooms gather at the foot). */
    isTrunk?: boolean;
    /** Fresh water: non-solid, drawn with ripples, the player wades through. */
    isWater?: boolean;
    /** Self-lit (0..1): drawn by the glow material, feeds bloom. */
    emissive?: number;
    /** Grass top with a dirt body (the vegetation layer grows tufts on it). */
    grassCap?: boolean;
    /** Grass over a stone body rather than soil. */
    stoneSubstrate?: boolean;
    /** Outline this block's top edges in the light ink. */
    lightEdge?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [extra: string]: any;
}

/* ------------------------------------------------------------------ *
 * Surface patterns — consumed by the voxel shader in core/voxel.ts
 * ------------------------------------------------------------------ */
export const PATTERN = {
    NONE: 0,
    BRICK: 1,
    STONE: 2,
    PLANK: 3,
    BARK: 4,
    GRASS: 5,
    TILE: 6,
    CACTUS: 7,
};

/**
 * Ground materials for the voxel shader's patGround (core/voxel.ts): texture
 * character per material, on top of the shared terrain detail. A block opts in
 * with `groundMat: GROUND_MAT.X`. Snow is matched by colour (it uses the fringe).
 */
export const GROUND_MAT = { GRASS: 0, SOIL: 1, SAND: 2, STONE: 3, STONE_PALE: 4, SNOW: 5, PATH: 6, DEADWOOD: 7 } as const;

/* ------------------------------------------------------------------ *
 * Block library
 * ------------------------------------------------------------------ */
const B = (id: number, def: any) => ({ id, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, sway: false, ...def });

export const BLOCKS = {
    AIR: { id: 0 },

    /* --- ground (palette-driven — colours zeroed, set by setVoxelPalette) --- */
    GRASS: B(1, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        lightEdge: true,
        rough: 0.5,
    }),
    GRASS_LIGHT: B(2, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        lightEdge: true,
        rough: 0.5,
    }),
    GRASS_DEEP: B(3, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        lightEdge: true,
        rough: 0.5,
    }),
    GRASS_STONE: B(6, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        stoneSubstrate: true,
        lightEdge: true,
        rough: 0.52,
    }),
    GRASS_LIGHT_STONE: B(7, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        stoneSubstrate: true,
        lightEdge: true,
        rough: 0.52,
    }),
    GRASS_DEEP_STONE: B(8, {
        groundMat: GROUND_MAT.GRASS,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        topTint: z(),
        fringeColor: z(),
        pattern: PATTERN.NONE,
        topPattern: PATTERN.NONE,
        fringe: 0,
        grassCap: true,
        stoneSubstrate: true,
        lightEdge: true,
        rough: 0.52,
    }),
    SOIL: B(4, {
        groundMat: GROUND_MAT.SOIL,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.55,
    }),
    SAND: B(5, {
        groundMat: GROUND_MAT.SAND,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.4,
    }),

    /* --- rock (palette-driven) ----------------------------------------- */
    STONE: B(10, {
        groundMat: GROUND_MAT.STONE,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.6,
    }),
    STONE_PALE: B(11, {
        groundMat: GROUND_MAT.STONE_PALE,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.5,
    }),
    STONE_WARM: B(12, {
        groundMat: GROUND_MAT.STONE,
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.55,
    }),

    /* --- path (neutral constant — not palette-driven) ------------------- */
    PATH: B(13, {
        groundMat: GROUND_MAT.PATH,
        top: c(0x8a8070),
        side: c(0x7e7464),
        bottom: c(0x6e6454),
        tint: c(0x847a68),
        pattern: PATTERN.NONE,
        rough: 0.45,
    }),

    /* --- wood (structural constants — not palette-driven) --------------- */
    PLANK: B(20, {
        top: c(0xb8824a),
        side: c(0xa87840),
        bottom: c(0x946830),
        tint: c(0xa07038),
        pattern: PATTERN.PLANK,
        rough: 0.5,
    }),
    PLANK_PALE: B(21, {
        top: c(0xc89060),
        side: c(0xb88450),
        bottom: c(0xa07040),
        tint: c(0xb07c48),
        pattern: PATTERN.PLANK,
        rough: 0.45,
    }),
    BEAM: B(22, {
        top: c(0x8a5a28),
        side: c(0x7a5020),
        bottom: c(0x6a4018),
        tint: c(0x724a18),
        pattern: PATTERN.BARK,
        rough: 0.5,
    }),
    TRUNK: B(23, {
        isTrunk: true,
        top: c(0x4a3020),
        side: c(0x3e2818),
        bottom: c(0x342010),
        tint: c(0x362212),
        pattern: PATTERN.BARK,
        rough: 0.65,
    }),
    TRUNK_PALE: B(24, {
        isTrunk: true,
        top: c(0x5a3828),
        side: c(0x4e3020),
        bottom: c(0x3e2818),
        tint: c(0x482a18),
        pattern: PATTERN.BARK,
        rough: 0.6,
    }),

    /* --- foliage (palette-driven) --------------------------------------- */
    LEAF_PINK: B(30, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
    LEAF_BLUSH: B(31, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.2, sway: true }),
    LEAF_LILAC: B(32, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
    LEAF_CREAM: B(33, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.2, sway: true }),
    LEAF_MINT: B(34, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),
    LEAF_ROSE: B(35, { top: z(), side: z(), bottom: z(), tint: z(), pattern: PATTERN.NONE, rough: 0.22, sway: true }),

    /* --- accents (intentional constants — not palette-driven) ----------- */
    LANTERN: B(40, {
        top: c(0xffb050),
        side: c(0xffa040),
        bottom: c(0xf09030),
        tint: c(0xffc060),
        pattern: PATTERN.NONE,
        rough: 0.1,
        emissive: 0.75,
    }),
    CRYSTAL: B(41, {
        top: c(0xdfd0f7),
        side: c(0xd2c0f1),
        bottom: c(0xc2aee5),
        tint: c(0xeee5fd),
        pattern: PATTERN.NONE,
        rough: 0.1,
        emissive: 0.42,
    }),
    CLOTH_PINK: B(42, {
        top: c(0xc87858),
        side: c(0xb86c4e),
        bottom: c(0xa05c40),
        tint: c(0xd08060),
        pattern: PATTERN.NONE,
        rough: 0.3,
    }),
    CLOTH_CREAM: B(43, {
        top: c(0xe8d8b0),
        side: c(0xdecaa0),
        bottom: c(0xcaba88),
        tint: c(0xf0e0b8),
        pattern: PATTERN.NONE,
        rough: 0.3,
    }),
    ROOF_ROSE: B(44, {
        top: c(0xb85a38),
        side: c(0xa84e30),
        bottom: c(0x944228),
        tint: c(0xa04828),
        pattern: PATTERN.PLANK,
        rough: 0.4,
    }),
    ROOF_LILAC: B(45, {
        top: c(0x887868),
        side: c(0x7a6c5c),
        bottom: c(0x6a5c4e),
        tint: c(0x806e5c),
        pattern: PATTERN.PLANK,
        rough: 0.4,
    }),
};

/** id -> block record, built once. */
export const BLOCK_BY_ID = (() => {
    const t: BlockDef[] = [];
    for (const k of Object.keys(BLOCKS)) {
        const b = (BLOCKS as any)[k];
        b.name = k;
        t[b.id] = b;
    }
    return t;
})();

/**
 * Natural-stone styles for the voxel shader's shared `patRock` (see voxel.ts).
 * A block opts in with `rockStyle: ROCK.X`; any system can reuse them.
 */
export const ROCK = {
    MARBLE: 0,
    DARK_MARBLE: 1,
    SLATE: 2,
    SANDSTONE: 3,
    GRANITE: 4,
    BASALT: 5,
    QUARTZITE: 6,
} as const;

let _nextBlockId = 60;


/**
 * Add a block at runtime — how every feature module defines its own blocks
 * (trees.ts bark and leaves, plants.ts shrubs, rivers.ts water, landmarks.ts
 * stone). Idempotent by name: a second call returns the first block, so
 * module re-evaluation (tests, HMR) can't burn ids.
 *
 * Ids are a Uint8 in the voxel grid: 1..59 are the built-ins above, 60..250 are
 * handed out here in registration order. Registration order therefore decides
 * ids, so keep it deterministic (top-level module code, never inside generation).
 */
export function registerBlock(name: string, def: Partial<BlockDef>): BlockDef {
    if ((BLOCKS as any)[name]) return (BLOCKS as any)[name];
    if (_nextBlockId > 250) throw new Error('block id space exhausted');
    const b = { id: _nextBlockId++, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, ...def, name } as BlockDef;
    (BLOCKS as any)[name] = b;
    BLOCK_BY_ID[b.id] = b;
    return b;
}
