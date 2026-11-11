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
        grass: 0x80ab52,
        grassLight: 0x98bf66,
        grassDeep: 0x68903f,
        soil: 0x8a6a48,
        sand: 0xe0d0a4,
        stone: 0xa6a098,
        stonePale: 0xbcb6ac,
        stoneWarm: 0xb0a294,
        // slots: blossom, pale, accent, cream, LEAF GREEN, deep accent
        foliage: [0xf4a6c0, 0xfbdde6, 0xd4b4e8, 0xf6f0dc, 0x7cbc52, 0xec8cae],
        water: { shoal: 0x7cc0bc, shallow: 0x3e88aa, deep: 0x1c4a6c },
        sky: { zenith: 0x5c90d0, horizon: 0xc4dcea, ground: 0x86a868, haze: 0xd2e2ee, sunTint: 0xfff4e4 },
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
        petals: [0xf8b8cc, 0xffe2ec, 0xf29cbc, 0xfff0f6, 0xf6cede, 0xea8cb4],
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
};

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
        blk.top.set(topHex);
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
    LIGHT.skyColor.set(p.light.skyColor);
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
    GRADE.saturation = p.grade.saturation;
    GRADE.contrast = p.grade.contrast;
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
