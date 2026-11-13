/**
 * ART BIBLE — the single source of truth for the look of VoxelWorld.
 *
 * Every module reads colour from here. Do not hardcode a hex anywhere else;
 * if you need a new colour, add it here so the whole world stays cohesive.
 *
 * All environmental colours (sky, atmosphere, grass, foliage, stone, water,
 * petals, grade) live in VOXEL_PALETTES. setVoxelPalette() is called at
 * module initialisation to apply the default palette, and again whenever the
 * player switches palettes at runtime.
 *
 * Non-palette colours (wood, accent blocks, UI chrome) may remain hardcoded
 * here — they are intentional constants, not palette choices.
 *
 * Every block is drawn with a thin ink outline (see core/voxel.ts): a
 * darker stroke of its own face colour along every voxel edge.
 */

import * as THREE from 'three';

// Hex input is sRGB; current Three.js converts it to the linear working space.
const c = (hex: any) => new THREE.Color(hex);
const z = () => new THREE.Color(0); // placeholder — filled by setVoxelPalette

/* ------------------------------------------------------------------ *
 * Atmosphere  (initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const SKY = {
    zenith: z(),
    horizon: z(),
    ground: z(),
    haze: z(),
    sunTint: z(),
};

export const LIGHT = {
    sunColor: z(),
    sunIntensity: 0,
    sunDir: new THREE.Vector3(-0.55, 0.78, -0.32).normalize(),
    skyColor: z(),
    groundColor: z(),
    hemiIntensity: 0,
    ambient: 0,
    fillColor: z(),
    fillIntensity: 0,
};

export const FOG = {
    color: SKY.haze, // shared reference — always matches haze
    near: 74,
    far: 248,
    heightTop: 30,
    heightFalloff: 0.055,
    density: 0.92,
};

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

/* ------------------------------------------------------------------ *
 * Block library
 * ------------------------------------------------------------------ */
const B = (id: any, def: any) => ({ id, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, sway: false, ...def });

export const BLOCKS = {
    AIR: { id: 0 },

    /* --- ground (palette-driven — colours zeroed, set by setVoxelPalette) --- */
    GRASS: B(1, {
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
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.55,
    }),
    SAND: B(5, {
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.4,
    }),

    /* --- rock (palette-driven) ----------------------------------------- */
    STONE: B(10, {
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.6,
    }),
    STONE_PALE: B(11, {
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.5,
    }),
    STONE_WARM: B(12, {
        top: z(),
        side: z(),
        bottom: z(),
        tint: z(),
        pattern: PATTERN.NONE,
        rough: 0.55,
    }),

    /* --- path (neutral constant — not palette-driven) ------------------- */
    PATH: B(13, {
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
    const t: any[] = [];
    for (const k of Object.keys(BLOCKS)) {
        const b = (BLOCKS as any)[k];
        b.name = k;
        t[b.id] = b;
    }
    return t;
})();

/**
 * Add a block at runtime.
 * Ids are Uint8 — 60..250 is the free range.
 */
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
export function registerBlock(name: any, def: any) {
    if ((BLOCKS as any)[name]) return (BLOCKS as any)[name];
    if (_nextBlockId > 250) throw new Error('block id space exhausted');
    const b = { id: _nextBlockId++, pattern: PATTERN.NONE, fringe: 0, rough: 0.35, ...def, name };
    (BLOCKS as any)[name] = b;
    BLOCK_BY_ID[b.id] = b;
    return b;
}

/* ------------------------------------------------------------------ *
 * Water  (colours initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const WATER = {
    shoal: z(),
    shallow: z(),
    deep: z(),
    warm: c(0xc8a878), // warm shallows — constant across palettes
    sheen: c(0x8aaa9a),
    edge: c(0x283a3a),
    level: 24.35,
    opacity: 0.88,
    extinction: [0.95, 0.72, 0.42],
    density: 0.23,
    saturation: 1.2,
    cellTone: 0.055,
    caustic: 0.6,
    reflect: 0.85,
};

/* ------------------------------------------------------------------ *
 * Petals & motes  (petals palette-driven; motes constant)
 * ------------------------------------------------------------------ */
export const PETAL_COLORS = [z(), z(), z(), z(), z(), z()];
export const MOTE_COLORS = [c(0xfff0c0), c(0xffd880), c(0xf0c840), c(0xffffff)];

/* ------------------------------------------------------------------ *
 * Grading — applied in postfx  (initialised to zero; filled by setVoxelPalette)
 * ------------------------------------------------------------------ */
export const GRADE = {
    exposure: 0,
    lift: new THREE.Vector3(),
    gamma: new THREE.Vector3(),
    gain: new THREE.Vector3(),
    saturation: 0,
    contrast: 0,
    vignette: 0,
    bloom: { strength: 0, radius: 0, threshold: 0 },
};

/* ------------------------------------------------------------------ *
 * Swappable colour palettes — single source of truth for all colours
 * ------------------------------------------------------------------ */

export interface VoxelPalette {
    label: string;
    // --- blocks ---
    grass: number;
    grassLight: number;
    grassDeep: number;
    soil: number;
    sand: number;
    stone: number;
    stonePale: number;
    stoneWarm: number;
    /**
     * Foliage blocks LEAF_PINK..LEAF_ROSE. Same ROLE per slot in every theme,
     * because flowers and butterflies borrow slots 0,1,2,3,5 (never 4):
     *   0 primary blossom   1 pale blossom   2 accent
     *   3 pale/cream        4 LEAF GREEN (the only green slot)   5 deep accent
     */
    foliage: [number, number, number, number, number, number];
    // --- water ---
    water: { shoal: number; shallow: number; deep: number };
    // --- atmosphere ---
    sky: { zenith: number; horizon: number; ground: number; haze: number; sunTint: number };
    light: {
        sunColor: number;
        sunIntensity: number;
        skyColor: number;
        groundColor: number;
        hemiIntensity: number;
        ambient: number;
        fillColor: number;
        fillIntensity: number;
    };
    // --- petals ---
    petals: [number, number, number, number, number, number];
    // --- grade ---
    grade: {
        exposure: number;
        lift: [number, number, number];
        gamma: [number, number, number];
        gain: [number, number, number];
        saturation: number;
        contrast: number;
        vignette: number;
        bloom: { strength: number; radius: number; threshold: number };
    };
}

/** The active palette name — read by map.ts and any future palette-aware systems. */
export let activePaletteName = 'Spring';

/*
 * Consistency rules across themes, so switching never jars:
 *   - grade saturation 1.0–1.18 and contrast 1.05–1.08 (the base colours carry
 *     the hue; the grade must not push them to neon), vignette 0.06–0.08;
 *   - ground stays the quietest thing on screen: grass/soil are desaturated
 *     relative to the foliage, so canopies read as the accent;
 *   - the sky is never near-black by day — haze sits within the theme's ground hues.
 */
export const VOXEL_PALETTES: Record<string, VoxelPalette> = {
    Autumn: {
        // Warm fall afternoon: golden-olive turf, amber/red/gold canopies, low warm sun, amber haze.
        label: 'Autumn Woodland',
        grass: 0x9a9a4e,
        grassLight: 0xb0a85e,
        grassDeep: 0x7e7c3e,
        soil: 0x8a5e36,
        sand: 0xc8aa7c,
        stone: 0x9c8e7e,
        stonePale: 0xb0a290,
        stoneWarm: 0xa88a72,
        // slots: blossom, pale, accent, cream, LEAF GREEN, deep accent
        foliage: [0xec8a32, 0xf4c85c, 0xd85a30, 0xf2dc98, 0x9a9440, 0xc4482a],
        water: { shoal: 0x6e8c80, shallow: 0x3e5e58, deep: 0x22383a },
        sky: { zenith: 0x7a84a8, horizon: 0xe2c08e, ground: 0x8a7458, haze: 0xd8b888, sunTint: 0xffc890 },
        light: {
            sunColor: 0xffc886,
            sunIntensity: 2.2,
            skyColor: 0xc8a888,
            groundColor: 0x8a6a48,
            hemiIntensity: 0.85,
            ambient: 0.2,
            fillColor: 0xe0b888,
            fillIntensity: 0.5,
        },
        petals: [0xe8902e, 0xd46a24, 0xc8501e, 0xe8b040, 0xf2c860, 0xb8401a],
        grade: {
            exposure: 1.1,
            lift: [0.012, 0.007, 0.002],
            gamma: [1.0, 1.005, 0.985],
            gain: [1.04, 1.02, 0.97],
            saturation: 1.14,
            contrast: 1.08,
            vignette: 0.08,
            bloom: { strength: 0.4, radius: 0.95, threshold: 0.7 },
        },
    },
    Spring: {
        // Fresh spring morning: new-leaf greens, pink/white/lilac blossom, soft clean light.
        label: 'Spring Blossom',
        grass: 0x6e9a48,
        grassLight: 0x86ac58,
        grassDeep: 0x58803a,
        soil: 0x7a5a3c,
        sand: 0xe0d0a4,
        stone: 0xa6a098,
        stonePale: 0xbcb6ac,
        stoneWarm: 0xb0a294,
        // slots: blossom, pale, accent, cream, LEAF GREEN, deep accent
        foliage: [0x3e6e34, 0x7aa850, 0xc87a8e, 0xb4c878, 0x4e8a3c, 0x2a5228],
        water: { shoal: 0x8cc4b0, shallow: 0x2e7a8c, deep: 0x123a5a },
        // Bluer, less white: the near-white horizon/haze washed the whole sky (and every
        // distant thing that fades into the haze) toward white.
        // haze 0xaecbea → 0x86a8cf: the far haze (fog colour and sky nadir) read as a
        // white wall below the horizon from altitude; a mid blue reads as distant land.
        sky: { zenith: 0x3f7fd6, horizon: 0x9cc4ec, ground: 0x86a868, haze: 0x86a8cf, sunTint: 0xfff4e4 },
        light: {
            sunColor: 0xfff0d6,
            sunIntensity: 2.1,
            skyColor: 0xb8cce0,
            groundColor: 0x8aa868,
            hemiIntensity: 0.8,
            ambient: 0.22,
            fillColor: 0xe8eef6,
            fillIntensity: 0.55,
        },
        petals: [0xd8a8b4, 0xe6d6c8, 0xc89aa8, 0xeee4d6, 0xdcc0b8, 0xb88894],
        grade: {
            exposure: 1.1,
            lift: [0.008, 0.008, 0.006],
            gamma: [1.0, 1.0, 0.995],
            gain: [1.02, 1.03, 1.01],
            saturation: 1.12,
            contrast: 1.06,
            vignette: 0.06,
            bloom: { strength: 0.38, radius: 0.9, threshold: 0.72 },
        },
    },
    Alpine: {
        // Snowy mountains: snowfield ground, grey granite, dark evergreens and frosted pines,
        // crisp blue-white light, bright high-altitude sky.
        label: 'Alpine Snow',
        grass: 0xeef2f6,
        grassLight: 0xf8fafc,
        grassDeep: 0xd2dce4,
        soil: 0x707680,
        sand: 0xe4e8ec,
        stone: 0x8e949c,
        stonePale: 0xaeb4bc,
        stoneWarm: 0x8a9098,
        // slots: evergreen, frosted pine, blue spruce, snow-laden, LEAF GREEN, dark fir
        foliage: [0x3e6250, 0xa8c0b8, 0x52707c, 0xe6eef0, 0x4a6e48, 0x2c4a3e],
        water: { shoal: 0x94c4d8, shallow: 0x4a86ac, deep: 0x1e3e64 },
        sky: { zenith: 0x4a84c8, horizon: 0xdce8f2, ground: 0xa8b4c0, haze: 0xe2ecf4, sunTint: 0xfffaf2 },
        light: {
            sunColor: 0xfff6ea,
            sunIntensity: 2.0,
            skyColor: 0xc4d4e6,
            groundColor: 0xc8d0d8,
            hemiIntensity: 0.9,
            ambient: 0.26,
            fillColor: 0xe6eef8,
            fillIntensity: 0.6,
        },
        petals: [0xf4f8fc, 0xffffff, 0xe0ecf6, 0xf8fbff, 0xeaf2fa, 0xd8e6f2],
        grade: {
            exposure: 1.06,
            lift: [0.01, 0.012, 0.016],
            gamma: [0.995, 1.0, 1.005],
            gain: [1.0, 1.01, 1.03],
            saturation: 1.02,
            contrast: 1.07,
            vignette: 0.06,
            bloom: { strength: 0.5, radius: 1.0, threshold: 0.66 },
        },
    },
    Desert: {
        // Dunes and heat: golden sand dominant, sun-bleached sparse scrub, ochre rock, hazy gold sky.
        label: 'Desert Dunes',
        grass: 0xc8b278,
        grassLight: 0xd8c690,
        grassDeep: 0xae9860,
        soil: 0xc08a52,
        sand: 0xecc888,
        stone: 0xc29a74,
        stonePale: 0xd8b892,
        stoneWarm: 0xb07e58,
        // slots: dry scrub, bleached, rust, pale straw, LEAF GREEN (sage), dark acacia
        foliage: [0xa08a54, 0xd2bc84, 0xb8683a, 0xe6d6a2, 0x8a9058, 0x6e6236],
        water: { shoal: 0x6aa8b0, shallow: 0x2e7488, deep: 0x16465a },
        sky: { zenith: 0x7e96c6, horizon: 0xf0d8a8, ground: 0xc0a070, haze: 0xeedcae, sunTint: 0xffe2a0 },
        light: {
            sunColor: 0xffdc94,
            sunIntensity: 2.5,
            skyColor: 0xd8c8a8,
            groundColor: 0xc0a070,
            hemiIntensity: 0.8,
            ambient: 0.2,
            fillColor: 0xf0d8a8,
            fillIntensity: 0.5,
        },
        petals: [0xe8d098, 0xd8b878, 0xf0dca8, 0xc8a468, 0xe0c488, 0xb89058],
        grade: {
            exposure: 1.1,
            lift: [0.014, 0.01, 0.004],
            gamma: [1.005, 1.0, 0.985],
            gain: [1.04, 1.02, 0.96],
            saturation: 1.08,
            contrast: 1.08,
            vignette: 0.08,
            bloom: { strength: 0.42, radius: 0.9, threshold: 0.74 },
        },
    },
    Alien: {
        label: 'Alien Biome',
        grass: 0x4aa080,
        grassLight: 0x60bc94,
        grassDeep: 0x388868,
        soil: 0x6a4a88,
        sand: 0xbcdcc0,
        stone: 0x506870,
        stonePale: 0x7090a0,
        stoneWarm: 0x407068,
        foliage: [0xa04cc8, 0xc86ad8, 0x4a86c0, 0xd87aa8, 0x3aa874, 0x8448b8],
        water: { shoal: 0x30c0a8, shallow: 0x18908c, deep: 0x0e4848 },
        sky: { zenith: 0x2a3a62, horizon: 0x4a6878, ground: 0x3a5048, haze: 0x4a6878, sunTint: 0xa0ffd0 },
        light: {
            sunColor: 0x80ffc0,
            sunIntensity: 1.8,
            skyColor: 0x406880,
            groundColor: 0x305848,
            hemiIntensity: 1.0,
            ambient: 0.15,
            fillColor: 0x60a8c0,
            fillIntensity: 0.45,
        },
        petals: [0xc040f0, 0xe060ff, 0x8040d0, 0xf080ff, 0xa030e0, 0x7020c0],
        grade: {
            exposure: 1.08,
            lift: [0.002, 0.008, 0.01],
            gamma: [0.99, 1.0, 1.01],
            gain: [0.95, 1.02, 1.05],
            saturation: 1.18,
            contrast: 1.08,
            vignette: 0.08,
            bloom: { strength: 0.5, radius: 1.0, threshold: 0.6 },
        },
    },
    Mercury: {
        // Airless, sun-blasted: grey regolith, charcoal sky, silvery scrub, harsh white sun.
        label: 'Mercury',
        grass: 0x8e8a84,
        grassLight: 0xa29e98,
        grassDeep: 0x76726c,
        soil: 0x6a6660,
        sand: 0xb4aea6,
        stone: 0x7c7872,
        stonePale: 0x9c9890,
        stoneWarm: 0x8a8078,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0xc8c2b8, 0xe2ded6, 0xa8988a, 0xf0ece4, 0x9a9c90, 0x8a8680],
        water: { shoal: 0x7a8a90, shallow: 0x485860, deep: 0x283438 },
        sky: { zenith: 0x3e4048, horizon: 0x9a9690, ground: 0x6e6a64, haze: 0xa8a49c, sunTint: 0xfffaf0 },
        light: {
            sunColor: 0xfffcf4,
            sunIntensity: 2.6,
            skyColor: 0x9a9896,
            groundColor: 0x7a7670,
            hemiIntensity: 0.7,
            ambient: 0.18,
            fillColor: 0xd8d4cc,
            fillIntensity: 0.4,
        },
        petals: [0xe0dcd4, 0xc8c4bc, 0xf0ece4, 0xb0aca4, 0xd4d0c8, 0xa8a49c],
        grade: {
            exposure: 1.06,
            lift: [0.008, 0.008, 0.009],
            gamma: [1.0, 1.0, 1.0],
            gain: [1.02, 1.01, 1.0],
            saturation: 0.9,
            contrast: 1.1,
            vignette: 0.08,
            bloom: { strength: 0.45, radius: 0.9, threshold: 0.7 },
        },
    },
    Venus: {
        // Under the cloud deck: sulphur-yellow haze, ochre rock, amber and burnt-orange growth.
        label: 'Venus',
        grass: 0xccb054,
        grassLight: 0xdcc46c,
        grassDeep: 0xb09440,
        soil: 0x8c5e30,
        sand: 0xd8ba78,
        stone: 0xa8805a,
        stonePale: 0xc09a70,
        stoneWarm: 0x9a6a44,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0xe8b23c, 0xf6dc78, 0xd08a30, 0xf8ecb0, 0xb8a044, 0xb06a24],
        water: { shoal: 0x9a8a50, shallow: 0x6a5a30, deep: 0x40361c },
        sky: { zenith: 0xd2b462, horizon: 0xeed890, ground: 0xb09050, haze: 0xeedc98, sunTint: 0xffe6a0 },
        light: {
            sunColor: 0xffd486,
            sunIntensity: 1.8,
            skyColor: 0xd8b870,
            groundColor: 0x9a7a48,
            hemiIntensity: 1.0,
            ambient: 0.24,
            fillColor: 0xe8c888,
            fillIntensity: 0.55,
        },
        petals: [0xf0c460, 0xe0a040, 0xf8d888, 0xd88a30, 0xecc070, 0xc87828],
        grade: {
            exposure: 1.08,
            lift: [0.016, 0.011, 0.002],
            gamma: [1.0, 1.0, 0.98],
            gain: [1.04, 1.02, 0.94],
            saturation: 1.06,
            contrast: 1.06,
            vignette: 0.08,
            bloom: { strength: 0.48, radius: 1.0, threshold: 0.68 },
        },
    },
    Mars: {
        // Rust-red dust and butterscotch sky; hardy ochre and red-brown scrub under a small, cool sun.
        label: 'Mars',
        grass: 0xb06a48,
        grassLight: 0xc47e56,
        grassDeep: 0x94563a,
        soil: 0x7e4028,
        sand: 0xc88a5e,
        stone: 0x9a5a40,
        stonePale: 0xb47458,
        stoneWarm: 0x8a4a32,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0xc8743c, 0xe0a466, 0x9a3e26, 0xeac498, 0x8e7c48, 0x6e3020],
        water: { shoal: 0x8a7a6a, shallow: 0x5a4a40, deep: 0x342a24 },
        sky: { zenith: 0xb4865e, horizon: 0xe0b48a, ground: 0x9a6448, haze: 0xd8a880, sunTint: 0xfff0e0 },
        light: {
            sunColor: 0xfff2e4,
            sunIntensity: 2.0,
            skyColor: 0xd0a080,
            groundColor: 0x8a5038,
            hemiIntensity: 0.85,
            ambient: 0.2,
            fillColor: 0xe0b090,
            fillIntensity: 0.5,
        },
        petals: [0xd8884a, 0xc0683a, 0xe8a870, 0xb05830, 0xe09a5c, 0x983e24],
        grade: {
            exposure: 1.08,
            lift: [0.014, 0.008, 0.004],
            gamma: [1.0, 1.0, 0.985],
            gain: [1.04, 1.01, 0.97],
            saturation: 1.06,
            contrast: 1.08,
            vignette: 0.08,
            bloom: { strength: 0.4, radius: 0.9, threshold: 0.72 },
        },
    },
    Jupiter: {
        // Banded cream, tan and rust like the cloud belts; the Great Red Spot red as the accent.
        label: 'Jupiter',
        grass: 0xd8c4a0,
        grassLight: 0xeadcbc,
        grassDeep: 0xc0a27c,
        soil: 0x9a6a46,
        sand: 0xf0e2c4,
        stone: 0xb08a6a,
        stonePale: 0xcaa888,
        stoneWarm: 0xa0705a,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0xe49a6e, 0xf6e2c4, 0xc4503a, 0xfaf0dc, 0xb8a078, 0xa8644a],
        water: { shoal: 0x9aa08a, shallow: 0x6a7058, deep: 0x3e4234 },
        sky: { zenith: 0xa8946e, horizon: 0xf0dcbc, ground: 0xb09070, haze: 0xeedcc0, sunTint: 0xffeedc },
        light: {
            sunColor: 0xffe6c6,
            sunIntensity: 2.0,
            skyColor: 0xd8bc98,
            groundColor: 0x9a7454,
            hemiIntensity: 0.85,
            ambient: 0.22,
            fillColor: 0xead2b0,
            fillIntensity: 0.55,
        },
        petals: [0xf0d2a8, 0xd88a5a, 0xf6ead0, 0xc87048, 0xe6c294, 0xb84a34],
        grade: {
            exposure: 1.08,
            lift: [0.012, 0.009, 0.005],
            gamma: [1.0, 1.0, 0.99],
            gain: [1.03, 1.02, 0.98],
            saturation: 1.06,
            contrast: 1.07,
            vignette: 0.07,
            bloom: { strength: 0.4, radius: 0.95, threshold: 0.72 },
        },
    },
    Saturn: {
        // Soft pale gold and butterscotch, cream canopies, a hazy honey sky — the gentlest theme.
        label: 'Saturn',
        grass: 0xd2bc84,
        grassLight: 0xe2d09c,
        grassDeep: 0xb8a06c,
        soil: 0xa6845a,
        sand: 0xeee0b8,
        stone: 0xbaa480,
        stonePale: 0xd2c09c,
        stoneWarm: 0xac9270,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0xe6c078, 0xf6e6be, 0xc8985a, 0xfaf2dc, 0xb0a46c, 0xa47c48],
        water: { shoal: 0x9ab0a0, shallow: 0x60786c, deep: 0x384a42 },
        sky: { zenith: 0xc8aa78, horizon: 0xf0e0bc, ground: 0xb09a74, haze: 0xece0c0, sunTint: 0xfff2d8 },
        light: {
            sunColor: 0xfff0d4,
            sunIntensity: 2.0,
            skyColor: 0xe2d2a8,
            groundColor: 0xa8946c,
            hemiIntensity: 0.85,
            ambient: 0.24,
            fillColor: 0xf0e2c0,
            fillIntensity: 0.55,
        },
        petals: [0xf6e6be, 0xe6c078, 0xfaf2dc, 0xd8b06a, 0xeedaa8, 0xc8985a],
        grade: {
            exposure: 1.08,
            lift: [0.012, 0.01, 0.006],
            gamma: [1.0, 1.0, 0.99],
            gain: [1.02, 1.02, 0.99],
            saturation: 1.04,
            contrast: 1.05,
            vignette: 0.06,
            bloom: { strength: 0.42, radius: 1.0, threshold: 0.72 },
        },
    },
    Uranus: {
        // Pale cyan-teal ice giant: soft aqua ground and sky, icy white and teal canopies, cool diffuse light.
        label: 'Uranus',
        grass: 0x9ec8c4,
        grassLight: 0xb4d8d4,
        grassDeep: 0x82b0ac,
        soil: 0x6a8e8e,
        sand: 0xd4ecea,
        stone: 0x8aa8aa,
        stonePale: 0xaac4c4,
        stoneWarm: 0x7e9c9e,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0x7ec4c4, 0xd2f0ee, 0x5a9eae, 0xeefaf8, 0x7aa8a0, 0x46808e],
        water: { shoal: 0xa8dcd8, shallow: 0x5aa4ac, deep: 0x2a5e6a },
        sky: { zenith: 0x7ebcc4, horizon: 0xc8e8e8, ground: 0x90b4b4, haze: 0xd0ecec, sunTint: 0xf4fffe },
        light: {
            sunColor: 0xf0fcfc,
            sunIntensity: 1.9,
            skyColor: 0xb8dcdc,
            groundColor: 0x80a4a4,
            hemiIntensity: 0.95,
            ambient: 0.26,
            fillColor: 0xd8f0f0,
            fillIntensity: 0.6,
        },
        petals: [0xd2f0ee, 0xeefaf8, 0xa8e0de, 0xf6fefe, 0xc0e8e6, 0x8ad0d0],
        grade: {
            exposure: 1.06,
            lift: [0.008, 0.012, 0.012],
            gamma: [1.0, 0.995, 0.995],
            gain: [0.99, 1.02, 1.03],
            saturation: 1.04,
            contrast: 1.05,
            vignette: 0.06,
            bloom: { strength: 0.48, radius: 1.0, threshold: 0.68 },
        },
    },
    Neptune: {
        // Deep blue ice world: cobalt sky, blue-white ice ground, blue-violet canopies, cold bright light.
        label: 'Neptune',
        grass: 0x7a9ac8,
        grassLight: 0x92b0d8,
        grassDeep: 0x6080b0,
        soil: 0x4a5e8a,
        sand: 0xc8d6f0,
        stone: 0x6a7ea4,
        stonePale: 0x8ea2c4,
        stoneWarm: 0x5e6a96,
        // slots: blossom, pale, accent, cream, LEAF GREEN (the plant base), deep accent
        foliage: [0x6a7ad8, 0xb4c4f4, 0x4a5ab8, 0xe2e8fc, 0x5a8090, 0x3a3e8e],
        water: { shoal: 0x7ea6e0, shallow: 0x3a62b0, deep: 0x1a2a6a },
        sky: { zenith: 0x3a5eb4, horizon: 0xa8c0e8, ground: 0x6a80a8, haze: 0xb4c8ec, sunTint: 0xf0f4ff },
        light: {
            sunColor: 0xeef2ff,
            sunIntensity: 2.0,
            skyColor: 0x9ab4e4,
            groundColor: 0x5a6c98,
            hemiIntensity: 0.9,
            ambient: 0.24,
            fillColor: 0xc8d6f4,
            fillIntensity: 0.55,
        },
        petals: [0xb4c4f4, 0xe2e8fc, 0x8a9ae8, 0xf2f4fe, 0xa0b2f0, 0x6a7ad8],
        grade: {
            exposure: 1.06,
            lift: [0.006, 0.008, 0.016],
            gamma: [1.0, 1.0, 1.005],
            gain: [0.98, 1.0, 1.04],
            saturation: 1.08,
            contrast: 1.07,
            vignette: 0.07,
            bloom: { strength: 0.5, radius: 1.0, threshold: 0.66 },
        },
    },
};

/**
 * One shared "natural" filter every theme passes through, so none looks dyed:
 * a little saturation comes out of every block colour and it leans slightly
 * warm, while each theme keeps its own hue. Tune here, not per theme.
 */
const NATURAL = {
    /** 0 = untouched, 1 = grey. */
    desat: 0.1,
    /** Warm lean added to red, taken from blue (linear). */
    warm: 0.012,
    maxGradeSat: 1.04,
    /** Natural keeps its depth: calm colour, but not flat. */
    maxContrast: 1.12,
};
const _nat = new THREE.Color();
function naturalise(c: THREE.Color): THREE.Color {
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    c.r = c.r + (l - c.r) * NATURAL.desat + NATURAL.warm * l;
    c.g = c.g + (l - c.g) * NATURAL.desat;
    c.b = Math.max(0, c.b + (l - c.b) * NATURAL.desat - NATURAL.warm * l);
    return c;
}

/** Darken a Three.js Color by a factor (0..1 = darker) in linear space. */
function darken(src: THREE.Color, factor: number): THREE.Color {
    return new THREE.Color(src.r * factor, src.g * factor, src.b * factor);
}

/** Apply a VoxelPalette — mutates all palette-driven exports in place. */
export function setVoxelPalette(name: string): void {
    const p = VOXEL_PALETTES[name];
    if (!p) return;
    activePaletteName = name;

    // Blocks — derive side/bottom/tint from the top hex with darkening factors.
    const applyBlock = (id: number, topHex: number, sideFactor = 0.88, bottomFactor = 0.78) => {
        const blk = BLOCK_BY_ID[id];
        if (!blk) return;
        blk.top.copy(naturalise(_nat.set(topHex)));
        blk.side.copy(darken(blk.top, sideFactor));
        blk.bottom.copy(darken(blk.top, bottomFactor));
        if (blk.tint) blk.tint.copy(darken(blk.top, sideFactor));
        if (blk.topTint) blk.topTint.copy(darken(blk.top, sideFactor));
        if (blk.fringeColor) blk.fringeColor.copy(darken(blk.top, sideFactor));
    };

    applyBlock(BLOCKS.GRASS.id, p.grass);
    applyBlock(BLOCKS.GRASS_LIGHT.id, p.grassLight);
    applyBlock(BLOCKS.GRASS_DEEP.id, p.grassDeep);
    applyBlock(BLOCKS.GRASS_STONE.id, p.grass);
    applyBlock(BLOCKS.GRASS_LIGHT_STONE.id, p.grassLight);
    applyBlock(BLOCKS.GRASS_DEEP_STONE.id, p.grassDeep);
    applyBlock(BLOCKS.SOIL.id, p.soil, 0.9, 0.8);
    applyBlock(BLOCKS.SAND.id, p.sand, 0.9, 0.8);
    applyBlock(BLOCKS.STONE.id, p.stone, 0.9, 0.8);
    applyBlock(BLOCKS.STONE_PALE.id, p.stonePale, 0.9, 0.8);
    applyBlock(BLOCKS.STONE_WARM.id, p.stoneWarm, 0.9, 0.8);
    const leaves = [
        BLOCKS.LEAF_PINK,
        BLOCKS.LEAF_BLUSH,
        BLOCKS.LEAF_LILAC,
        BLOCKS.LEAF_CREAM,
        BLOCKS.LEAF_MINT,
        BLOCKS.LEAF_ROSE,
    ];
    for (let i = 0; i < leaves.length; i++) applyBlock(leaves[i].id, p.foliage[i], 0.88, 0.78);

    // Water
    WATER.shoal.set(p.water.shoal);
    WATER.shallow.set(p.water.shallow);
    WATER.deep.set(p.water.deep);

    // Sky & atmosphere
    SKY.zenith.set(p.sky.zenith);
    SKY.horizon.set(p.sky.horizon);
    SKY.ground.set(p.sky.ground);
    SKY.haze.set(p.sky.haze);
    SKY.sunTint.set(p.sky.sunTint);
    // FOG.color is the same object as SKY.haze — no copy needed.

    // Light
    LIGHT.sunColor.set(p.light.sunColor);
    LIGHT.sunIntensity = p.light.sunIntensity;
    // The hemisphere sky term is the single biggest cool cast on the scene;
    // pull it a third of the way to a warm neutral so shade reads natural.
    LIGHT.skyColor.set(p.light.skyColor).lerp(_nat.setRGB(0.72, 0.7, 0.66), 0.35);
    LIGHT.groundColor.set(p.light.groundColor);
    LIGHT.hemiIntensity = p.light.hemiIntensity;
    LIGHT.ambient = p.light.ambient;
    LIGHT.fillColor.set(p.light.fillColor);
    LIGHT.fillIntensity = p.light.fillIntensity;

    // Petals
    for (let i = 0; i < PETAL_COLORS.length; i++) PETAL_COLORS[i].set(p.petals[i]);

    // Grade
    GRADE.exposure = p.grade.exposure;
    GRADE.lift.set(...p.grade.lift);
    GRADE.gamma.set(...p.grade.gamma);
    GRADE.gain.set(...p.grade.gain);
    // Natural look: the grade may calm a theme but never push it toward neon.
    GRADE.saturation = Math.min(p.grade.saturation, NATURAL.maxGradeSat);
    GRADE.contrast = Math.min(Math.max(p.grade.contrast, 1.08), NATURAL.maxContrast);
    GRADE.vignette = p.grade.vignette;
    GRADE.bloom.strength = p.grade.bloom.strength;
    GRADE.bloom.radius = p.grade.bloom.radius;
    GRADE.bloom.threshold = p.grade.bloom.threshold;
}

// Initialise all palette-driven exports. `?palette=Desert` (any key above) picks
// the starting theme, before the world is generated, so it applies everywhere.
{
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('palette') : null;
    setVoxelPalette(fromUrl && VOXEL_PALETTES[fromUrl] ? fromUrl : 'Spring');
}
