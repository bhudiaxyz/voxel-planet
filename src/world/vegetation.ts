/**
 * Grass tufts and small foliage clumps on the sphere surface.
 *
 * Built lazily, one 32×32-column patch at a time, as the terrain streamer
 * loads the chunks underneath — never for the whole planet up front. Every
 * patch shares one material (one shader program, one wind clock), and each
 * patch is its own seeded RNG stream so a patch looks identical every time it
 * is rebuilt.
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/voxel';
import { columnDir } from '../core/geoutil';
import { BLOCK_BY_ID, BLOCKS } from '../core/palette';
import { makeRng, makeNoise3D } from '../core/rng';
import { PLANT } from './terrain';

const SEA_LAYER = 11;
const TREE_P = 0.04;
const GRASS_P = 0.35;
/** Tall single blades poking out of the turf, at full density. */
const BLADE_P = 0.12;
/** Flowers only grow where the drift field exceeds this; probability ramps above it. */
const FLOWER_EDGE = 0.58;
const FLOWER_P = 0.55;
const PEBBLE_P = 0.008;
/** Noise frequencies are per world unit, sampled in 3D so patches cross cube seams. */
const MEADOW_FREQ = 0.026;
const FLOWER_FREQ = 0.055;
export const VEG_PATCH = 32;
const PATCHES_PER_EDGE = Math.ceil(FACE_RES / VEG_PATCH);

type Rng = ReturnType<typeof makeRng>;

/** Shared across every patch: one program, one uniform set, one wind clock. */
function makeVegMaterial(windAmp: number) {
    const uniforms = {
        uTime: { value: 0 },
        uWindAmp: { value: windAmp },
    };
    const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        dithering: true,
        // No depth write: thousands of overlapping blades writing depth fed the
        // ink-outline pass a scratchy edge on every lawn. They still depth-test.
        depthWrite: false,
    });
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        // Normals carry the surface up, not the blade facing. DoubleSide would
        // flip them on back faces — pointing into the ground and rendering the
        // blade black — so keep the same normal on both sides.
        shader.fragmentShader = shader.fragmentShader.replace(
            'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
            'float faceDirection = 1.0;',
        );
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                /* glsl */ `#include <common>
                attribute vec2 aDetail;
                uniform float uTime;
                uniform float uWindAmp;`,
            )
            .replace(
                '#include <begin_vertex>',
                /* glsl */ `#include <begin_vertex>
                {
                    // Blade tips sway along the surface, not along world X/Z,
                    // so grass on the planet's flank bends sideways rather
                    // than into the ground. Positions are world-space here.
                    float sway = aDetail.x, phase = aDetail.y;
                    vec3 up = normalize(transformed);
                    vec3 t1 = normalize(cross(up, abs(up.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
                    vec3 t2 = cross(up, t1);
                    float w = sin(uTime * 0.85 + dot(transformed, vec3(0.13, 0.07, 0.09)) + phase) * 0.72
                            + sin(uTime * 2.30 + dot(transformed, vec3(0.41, 0.0, 0.17)) + phase * 1.7) * 0.28;
                    float a = sway * sway * uWindAmp;
                    transformed += (t1 + t2 * 0.55) * (w * a) - up * (abs(w) * a * 0.18);
                }`,
            );
    };
    mat.customProgramCacheKey = () => 'VoxelWorld-sphereveg-v2';
    return { mat, uniforms };
}

/** Growable typed buffers — avoids the boxed-number arrays the flat DetailField uses. */
class QuadBuffer {
    pos = new Float32Array(4096 * 3);
    nrm = new Float32Array(4096 * 3);
    col = new Float32Array(4096 * 3);
    det = new Float32Array(4096 * 2);
    n = 0;
    reset() {
        this.n = 0;
    }
    private grow() {
        const cap = this.pos.length / 3;
        for (const [k, w] of [
            ['pos', 3],
            ['nrm', 3],
            ['col', 3],
            ['det', 2],
        ] as const) {
            const next = new Float32Array(cap * 2 * w);
            next.set(this[k]);
            this[k] = next;
        }
    }
    vert(x: number, y: number, z: number, up: THREE.Vector3, c: THREE.Color, sway: number, phase: number) {
        if (this.n * 3 >= this.pos.length) this.grow();
        const i3 = this.n * 3,
            i2 = this.n * 2;
        this.pos[i3] = x;
        this.pos[i3 + 1] = y;
        this.pos[i3 + 2] = z;
        // Normals point along the surface up: blades lit like the ground they
        // grow from stay in the high-key band instead of turning to dark slivers.
        this.nrm[i3] = up.x;
        this.nrm[i3 + 1] = up.y;
        this.nrm[i3 + 2] = up.z;
        this.col[i3] = c.r;
        this.col[i3 + 1] = c.g;
        this.col[i3 + 2] = c.b;
        this.det[i2] = sway;
        this.det[i2 + 1] = phase;
        this.n++;
    }
}

const _up = new THREE.Vector3();
const _ta = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _base = new THREE.Vector3();
const _base2 = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _dark = new THREE.Color();
const _light = new THREE.Color();

/**
 * A crossed pair of blades rooted at `base`, standing along `up`.
 * `ox`/`oy` are tangent offsets for the root; `lean` tilts the tip.
 */
function tuft(
    buf: QuadBuffer,
    base: THREE.Vector3,
    up: THREE.Vector3,
    w: number,
    h: number,
    dark: THREE.Color,
    light: THREE.Color,
    rot: number,
    leanA: number,
    leanB: number,
    sway: number,
) {
    const hw = w * 0.5;
    const c = Math.cos(rot),
        s = Math.sin(rot);
    for (let k = 0; k < 2; k++) {
        // Blade direction in the tangent plane; the second blade is perpendicular.
        const bx = k === 0 ? c : -s,
            by = k === 0 ? s : c;
        const dx = (_ta.x * bx + _tb.x * by) * hw,
            dy = (_ta.y * bx + _tb.y * by) * hw,
            dz = (_ta.z * bx + _tb.z * by) * hw;
        const tx = base.x + up.x * h + _ta.x * leanA + _tb.x * leanB,
            ty = base.y + up.y * h + _ta.y * leanA + _tb.y * leanB,
            tz = base.z + up.z * h + _ta.z * leanA + _tb.z * leanB;
        buf.vert(base.x - dx, base.y - dy, base.z - dz, up, dark, 0, rot);
        buf.vert(base.x + dx, base.y + dy, base.z + dz, up, dark, 0, rot);
        buf.vert(tx + dx * 0.62, ty + dy * 0.62, tz + dz * 0.62, up, light, sway, rot);
        buf.vert(tx - dx * 0.62, ty - dy * 0.62, tz - dz * 0.62, up, light, sway, rot);
    }
}

/**
 * A small surface-aligned box: flower heads and pebbles. Faces are lit along
 * the surface frame like the voxel blocks (top 1.0, sides 0.85, bottom 0.7).
 */
const _boxC = new THREE.Color();
const _n = new THREE.Vector3();
function box(
    buf: QuadBuffer,
    base: THREE.Vector3,
    up: THREE.Vector3,
    w: number,
    h: number,
    color: THREE.Color,
    sway: number,
    phase: number,
) {
    const hw = w * 0.5;
    // corner = base + ta*sa*hw + tb*sb*hw + up*sh*h
    const P = (sa: number, sb: number, sh: number) => [
        base.x + (_ta.x * sa + _tb.x * sb) * hw + up.x * sh * h,
        base.y + (_ta.y * sa + _tb.y * sb) * hw + up.y * sh * h,
        base.z + (_ta.z * sa + _tb.z * sb) * hw + up.z * sh * h,
    ];
    const faces: Array<[number[][], THREE.Vector3, number, boolean]> = [
        [[P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1), P(1, -1, 1)], up, 1.0, true],
        [[P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)], _ta, 0.88, false],
        [[P(-1, 1, 0), P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1)], _ta, 0.88, false],
        [[P(1, 1, 0), P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1)], _tb, 0.82, false],
        [[P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)], _tb, 0.82, false],
    ];
    for (const [v, , shade, top] of faces) {
        _boxC.copy(color).multiplyScalar(shade);
        for (let i = 0; i < 4; i++) {
            // Tops sway entirely; side faces sway only along their upper edge.
            const sw = top || i >= 2 ? sway : 0;
            buf.vert(v[i][0], v[i][1], v[i][2], _n.copy(up), _boxC, sw, phase);
        }
    }
}

/**
 * Ground-cover plants recorded by the terrain step (grid.plants), each drawn
 * from its block's own colours so the palette stays authored in one place.
 * Bottom colour = block.side (shaded base), tip = block.topTint ?? block.top.
 */
const _pDark = new THREE.Color();
const _pLight = new THREE.Color();
function drawPlant(buf: QuadBuffer, centre: THREE.Vector3, rng: Rng, id: number) {
    const b = BLOCK_BY_ID[id] as any;
    _pLight.copy(b.topTint ?? b.top);
    // Base partway between the block's side and tip colour: the raw side colour
    // is authored for a shaded cube face and reads as a black stem on a blade.
    _pDark.copy(b.side).lerp(_pLight, 0.45);
    const blades = (
        n: number,
        spread: number,
        w0: number,
        w1: number,
        h0: number,
        h1: number,
        lean: number,
        sway: number,
    ) => {
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-spread, spread), rng.range(-spread, spread));
            tuft(
                buf,
                r,
                _up,
                rng.range(w0, w1),
                rng.range(h0, h1),
                _pDark,
                _pLight,
                rng() * 6.28,
                rng.range(-lean, lean),
                rng.range(-lean, lean),
                sway,
            );
        }
    };
    switch (id) {
        case PLANT.FERN.id:
        case PLANT.FERN_RED.id: {
            // Three-to-five arching fronds radiating from one root.
            const n = rng.int(3, 5);
            const rot0 = rng() * 6.28;
            for (let k = 0; k < n; k++) {
                const a = rot0 + (k / n) * 6.28;
                const lean = rng.range(0.32, 0.5);
                tuft(
                    buf,
                    root(centre, 0, 0),
                    _up,
                    rng.range(0.22, 0.3),
                    rng.range(0.5, 0.75),
                    _pDark,
                    _pLight,
                    a,
                    Math.cos(a) * lean,
                    Math.sin(a) * lean,
                    0.75,
                );
            }
            break;
        }
        case PLANT.GRASS_TALL.id:
            blades(rng.int(4, 6), 0.3, 0.12, 0.2, 0.7, 1.15, 0.2, 1.1);
            break;
        case PLANT.REED.id:
            // Reeds stand tall and nearly straight, with a darker seed head.
            blades(rng.int(3, 5), 0.25, 0.06, 0.1, 1.1, 1.7, 0.08, 0.7);
            break;
        case PLANT.SHRUB_TALL.id:
            // A dense, broad clump — the shrub without the cube.
            blades(rng.int(6, 9), 0.38, 0.3, 0.45, 0.6, 1.05, 0.18, 0.55);
            break;
        case PLANT.MOSS_THICK.id:
            // Low, flat cushion of very short tufts.
            blades(rng.int(6, 9), 0.42, 0.22, 0.34, 0.08, 0.16, 0.05, 0.15);
            break;
        case PLANT.LICHEN_PALE.id: {
            // A few pale, flat flecks hugging the stone.
            const n = rng.int(2, 4);
            for (let k = 0; k < n; k++) {
                const r = root(centre, rng.range(-0.35, 0.35), rng.range(-0.35, 0.35)).addScaledVector(_up, -0.04);
                box(buf, r, _up, rng.range(0.16, 0.3), 0.06, _pLight, 0, 0);
            }
            break;
        }
    }
}

/** Root position on the surface at tangent offset (a, b) from the column centre. */
function root(centre: THREE.Vector3, a: number, b: number) {
    return _base.copy(centre).addScaledVector(_ta, a).addScaledVector(_tb, b);
}

/** Per-patch palette snapshot — palette colours are only filled once the palette loads. */
interface DetailColours {
    flowers: THREE.Color[];
    pebbles: THREE.Color[];
    bark: THREE.Color[];
    caps: THREE.Color[];
    stem: THREE.Color;
    moss: THREE.Color;
}
const readColours = (): DetailColours => ({
    flowers: [BLOCKS.LEAF_PINK, BLOCKS.LEAF_BLUSH, BLOCKS.LEAF_LILAC, BLOCKS.LEAF_CREAM, BLOCKS.LEAF_ROSE].map(
        (b: any) => b.top,
    ),
    pebbles: [BLOCKS.STONE, BLOCKS.STONE_PALE, BLOCKS.STONE_WARM].map((b: any) => b.top),
    bark: [BLOCKS.TRUNK, BLOCKS.TRUNK_PALE].map((b: any) => b.side),
    // Same caps as the flat world's damp-grove mushrooms.
    caps: [BLOCKS.LEAF_ROSE.top, BLOCKS.LEAF_BLUSH.top, BLOCKS.LEAF_CREAM.top, BLOCKS.LEAF_LILAC.top] as THREE.Color[],
    stem: BLOCKS.STONE_PALE.top as THREE.Color,
    moss: BLOCKS.GRASS_DEEP.top as THREE.Color,
});

/* ---- ground details: boulders, fallen logs, mushrooms -------------------
 * Drawn from their own RNG stream so turning them on or off (tier setting)
 * never shifts where the grass and flowers land. */
const BOULDER_P = 0.0045; // per grass column; ×3 on bare stone
const LOG_P = 0.006; // per column next to a tree trunk
const MUSHROOM_P = 0.05; // per column next to a tree trunk; ×0.25 in open lush meadow

const _rot = new THREE.Vector3();
const _saveA = new THREE.Vector3();
const _saveB = new THREE.Vector3();
const NEIGHBOURS4: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];
const STONE_IDS = new Set([BLOCKS.STONE.id, BLOCKS.STONE_PALE.id, BLOCKS.STONE_WARM.id]);
/** A box rotated by `yaw` in the tangent plane. Temporarily swaps the shared frame. */
function boxYawed(
    buf: QuadBuffer,
    base: THREE.Vector3,
    up: THREE.Vector3,
    w: number,
    h: number,
    len: number,
    color: THREE.Color,
    yaw: number,
) {
    const sa = _saveA.copy(_ta),
        sb = _saveB.copy(_tb);
    const c = Math.cos(yaw),
        s = Math.sin(yaw);
    _rot.copy(sa).multiplyScalar(c).addScaledVector(sb, s);
    _tb.copy(sb).multiplyScalar(c).addScaledVector(sa, -s);
    _ta.copy(_rot);
    // box() is square in plan; stretch along _tb by scaling it for the log.
    _tb.multiplyScalar(len / w);
    box(buf, base, up, w, h, color, 0, 0);
    _ta.copy(sa);
    _tb.copy(sb);
}

function scatterGroundDetail(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    detail: number,
    onStone: boolean,
    nearTrunk: boolean,
    lush: number,
    cols: DetailColours,
) {
    if (detail <= 0) return;
    // Boulders: two or three stacked, rotated blocks, half sunk into the ground.
    if (rng() < BOULDER_P * detail * (onStone ? 3 : 1)) {
        const n = rng.int(1, 3);
        const s0 = rng.range(0.55, 0.95);
        for (let k = 0; k < n; k++) {
            const sz = s0 * (1 - k * 0.3);
            const r = root(centre, rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)).addScaledVector(
                _up,
                -0.15 + k * s0 * 0.45,
            );
            boxYawed(
                buf,
                r,
                _up,
                sz,
                sz * rng.range(0.55, 0.8),
                sz,
                cols.pebbles[(rng() * cols.pebbles.length) | 0],
                rng() * 6.28,
            );
        }
    }
    if (nearTrunk) {
        // Fallen log: a long bark box with a moss strip along its top.
        if (rng() < LOG_P * detail) {
            const yaw = rng() * 6.28,
                len = rng.range(1.6, 2.6),
                th = rng.range(0.32, 0.42);
            const r = root(centre, rng.range(-0.2, 0.2), rng.range(-0.2, 0.2)).addScaledVector(_up, -0.06);
            boxYawed(buf, r, _up, th, th, len, cols.bark[(rng() * cols.bark.length) | 0], yaw);
            const top = _base2.copy(r).addScaledVector(_up, th);
            boxYawed(buf, top, _up, th * 0.7, 0.05, len * 0.8, cols.moss, yaw);
        }
    }
    // Mushrooms: damp ground at a tree's foot, occasionally out in lush meadow.
    if (rng() < MUSHROOM_P * detail * (nearTrunk ? 1 : lush > 0.7 ? 0.25 : 0)) {
        const cap = cols.caps[(rng() * cols.caps.length) | 0];
        const n = rng.int(2, 4);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
            const h = rng.range(0.14, 0.3),
                w = rng.range(0.22, 0.4);
            tuft(buf, r, _up, 0.06, h, cols.stem, cols.stem, rng() * 6.28, 0, 0, 0);
            box(buf, _base2.copy(r).addScaledVector(_up, h - 0.03), _up, w, w * 0.32, cap, 0.25, rng() * 6.28);
        }
    }
}

/**
 * @param lush   0..1 meadow field: lush shelves vs close-cropped ones
 * @param bloom  0..1 flower-drift field
 */
function scatterColumn(
    buf: QuadBuffer,
    centre: THREE.Vector3,
    rng: Rng,
    block: any,
    density: number,
    lush: number,
    bloom: number,
    cols: DetailColours,
) {
    const roll = rng();
    // Colours mirror the flat-world grass tufts: dark = topTint × 0.86, light = top × 1.08.
    _dark.copy(block.topTint ?? block.top).multiplyScalar(0.86);
    _light.copy(block.top).multiplyScalar(1.08);

    // Flowers gather in drifts rather than dusting evenly: a stem tuft and a
    // small coloured head that nods with the wind.
    if (bloom > FLOWER_EDGE && rng() < (bloom - FLOWER_EDGE) * FLOWER_P * density) {
        const col = cols.flowers[(rng() * cols.flowers.length) | 0];
        const n = rng.int(1, 3);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.3, 0.3), rng.range(-0.3, 0.3));
            const h = rng.range(0.24, 0.42);
            const head = _base2.copy(r).addScaledVector(_up, h - 0.04);
            tuft(buf, r, _up, 0.07, h, _dark, _dark, 0, 0, 0, 0.6);
            box(buf, head, _up, 0.2, 0.16, col, 0.9, rng() * 6.28);
        }
    }

    // Tall lone blades: thin, long, leaning — the stray strands above the turf.
    if (rng() < BLADE_P * density * (0.4 + lush)) {
        const r = root(centre, rng.range(-0.4, 0.4), rng.range(-0.4, 0.4));
        tuft(
            buf,
            r,
            _up,
            rng.range(0.05, 0.09),
            rng.range(0.6, 1.05),
            _dark,
            _light,
            rng() * 6.28,
            rng.range(-0.22, 0.22),
            rng.range(-0.22, 0.22),
            1.2,
        );
    }

    // Pebbles: never animated — the still notes among the moving grass.
    if (rng() < PEBBLE_P) {
        const r = root(centre, rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)).addScaledVector(_up, -0.05);
        box(
            buf,
            r,
            _up,
            rng.range(0.24, 0.42),
            rng.range(0.12, 0.24),
            cols.pebbles[(rng() * cols.pebbles.length) | 0],
            0,
            0,
        );
    }

    if (roll < TREE_P) {
        // Small foliage clump: a stump tuft plus a wider cross ~1 unit up.
        tuft(
            buf,
            root(centre, 0, 0),
            _up,
            rng.range(0.25, 0.35),
            rng.range(0.6, 0.9),
            _dark,
            _light,
            rng() * 6.28,
            0,
            0,
            0.15,
        );
        const lift = _base.copy(centre).addScaledVector(_up, 0.85).addScaledVector(_ta, rng.range(-0.1, 0.1));
        tuft(buf, lift, _up, rng.range(0.55, 0.75), rng.range(0.9, 1.4), _dark, _light, rng() * 6.28, 0, 0, 0.4);
    } else if (roll < TREE_P + GRASS_P * density * (0.45 + lush * 1.1)) {
        // Lush shelves get fuller clumps; cropped ones a single tuft.
        const n = rng.int(1, lush > 0.6 ? 4 : 2);
        for (let k = 0; k < n; k++) {
            const r = root(centre, rng.range(-0.32, 0.32), rng.range(-0.32, 0.32));
            tuft(
                buf,
                r,
                _up,
                rng.range(0.16, 0.3),
                rng.range(0.26, 0.52),
                _dark,
                _light,
                rng() * 6.28,
                rng.range(-0.14, 0.14),
                rng.range(-0.14, 0.14),
                1,
            );
        }
    }
}

/**
 * @param density 0..1+ scales grass coverage (tier setting). Trees are kept at
 *        every tier — they are landmarks, grass is texture.
 */
export function createSphereVegetation(
    grid: SphereVoxelGrid,
    seed: number,
    scene: THREE.Scene,
    density = 1,
    windAmp = 0.1,
    /** Ground clutter multiplier (boulders, logs, mushrooms), 0 = none. */
    groundDetail = 1,
) {
    const { mat, uniforms } = makeVegMaterial(windAmp);
    const meadowNoise = makeNoise3D(seed ^ 0x51ed);
    const flowerNoise = makeNoise3D(seed ^ 0xf10e);
    const field = (noise: (x: number, y: number, z: number) => number, p: THREE.Vector3, f: number) =>
        (noise(p.x * f, p.y * f, p.z * f) * 0.65 + noise(p.x * f * 2.1, p.y * f * 2.1, p.z * f * 2.1) * 0.35 + 1) * 0.5;
    const group = new THREE.Group();
    group.name = 'veg';
    group.matrixAutoUpdate = false;
    scene.add(group);

    const buf = new QuadBuffer();
    /** Built patches by key; null = built and empty (no grass there). */
    const patches = new Map<number, THREE.Mesh | null>();
    /** How many loaded terrain chunks sit under each patch — built at >0, freed at 0. */
    const refs = new Map<number, number>();

    const keyOf = (face: number, pu: number, pv: number) => (face * PATCHES_PER_EDGE + pv) * PATCHES_PER_EDGE + pu;

    function build(face: number, pu: number, pv: number): THREE.Mesh | null {
        buf.reset();
        const cols = readColours();
        const rng = makeRng((seed ^ Math.imul(keyOf(face, pu, pv) + 1, 0x9e3779b1)) >>> 0);
        const drng = makeRng((seed ^ 0x6d2b79f5 ^ Math.imul(keyOf(face, pu, pv) + 1, 0x85ebca6b)) >>> 0);
        /** A trunk stands on a neighbouring column (logs and mushrooms gather at tree feet). */
        const nearTrunk = (u: number, v: number, layer: number) => {
            for (const [du, dv] of NEIGHBOURS4) {
                const b = BLOCK_BY_ID[grid.get(face, u + du, v + dv, layer + 1)] as any;
                if (b?.isTrunk) return true;
            }
            return false;
        };
        const u1 = Math.min((pu + 1) * VEG_PATCH, FACE_RES),
            v1 = Math.min((pv + 1) * VEG_PATCH, FACE_RES);
        for (let v = pv * VEG_PATCH; v < v1; v++) {
            for (let u = pu * VEG_PATCH; u < u1; u++) {
                const layer = grid.columnTop(face, u, v);
                const plant = grid.plantAt(face, u, v);
                if (layer < 0 || (!plant && layer <= SEA_LAYER)) continue;
                const block = BLOCK_BY_ID[grid.get(face, u, v, layer)] as any;
                const onStone = !!block && STONE_IDS.has(block.id);
                if (!plant && !block?.grassCap && !onStone) continue;
                columnDir(face, u, v, FACE_RES, _up);
                _ta.crossVectors(
                    _up,
                    Math.abs(_up.y) < 0.95 ? THREE.Object3D.DEFAULT_UP : _tb.set(1, 0, 0),
                ).normalize();
                _tb.crossVectors(_up, _ta);
                const centre = _centre.copy(_up).multiplyScalar(PLANET_RADIUS + layer + 1);
                if (plant) {
                    // The plant replaces this column's grass so the two don't pile up.
                    drawPlant(buf, centre, rng, plant);
                    continue;
                }
                const lush = field(meadowNoise, centre, MEADOW_FREQ);
                if (groundDetail > 0)
                    scatterGroundDetail(buf, centre, drng, groundDetail, onStone, nearTrunk(u, v, layer), lush, cols);
                if (onStone) continue; // bare rock: boulders only, no grass
                const bloom = field(flowerNoise, centre, FLOWER_FREQ);
                scatterColumn(buf, centre, rng, block, density, lush, bloom, cols);
            }
        }
        if (buf.n === 0) return null;

        const quads = buf.n / 4;
        const idx = buf.n <= 65535 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
        for (let q = 0; q < quads; q++) {
            const v = q * 4,
                i = q * 6;
            idx[i] = v;
            idx[i + 1] = v + 1;
            idx[i + 2] = v + 2;
            idx[i + 3] = v;
            idx[i + 4] = v + 2;
            idx[i + 5] = v + 3;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(buf.pos.slice(0, buf.n * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(buf.nrm.slice(0, buf.n * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(buf.col.slice(0, buf.n * 3), 3));
        geo.setAttribute('aDetail', new THREE.BufferAttribute(buf.det.slice(0, buf.n * 2), 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.boundingSphere!.radius += windAmp * 2 + 0.25; // keep swaying tips inside the cull volume

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `veg-${face}-${pu}-${pv}`;
        // Blades are too fine to cast anything but shadow-map noise, but they
        // receive cliff shadows or they float off the ground.
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 2; // no depth write, so draw after terrain
        mesh.updateMatrixWorld();
        group.add(mesh);
        return mesh;
    }

    function release(key: number) {
        const mesh = patches.get(key);
        if (mesh) {
            group.remove(mesh);
            mesh.geometry.dispose();
        }
        patches.delete(key);
    }

    return {
        group,
        get patchCount() {
            return group.children.length;
        },
        /** Terrain chunk (face, ci, ck) of CHUNK columns has loaded. */
        chunkLoaded(face: number, u0: number, v0: number) {
            const pu = Math.floor(u0 / VEG_PATCH),
                pv = Math.floor(v0 / VEG_PATCH);
            const key = keyOf(face, pu, pv);
            const n = (refs.get(key) ?? 0) + 1;
            refs.set(key, n);
            if (n === 1 && !patches.has(key)) patches.set(key, build(face, pu, pv));
        },
        chunkUnloaded(face: number, u0: number, v0: number) {
            const key = keyOf(face, Math.floor(u0 / VEG_PATCH), Math.floor(v0 / VEG_PATCH));
            const n = (refs.get(key) ?? 1) - 1;
            if (n > 0) refs.set(key, n);
            else {
                refs.delete(key);
                release(key);
            }
        },
        update(dt: number) {
            uniforms.uTime.value += dt;
        },
        dispose() {
            for (const key of [...patches.keys()]) release(key);
            mat.dispose();
            scene.remove(group);
        },
    };
}
