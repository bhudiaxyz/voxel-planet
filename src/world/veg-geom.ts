/**
 * Veg geometry — shared quad buffer and drawing primitives for the surface-detail meshes.
 *
 * Purpose
 *   Grass, flowers, plants, logs, mushrooms and rocks are all built as small quads appended to
 *   one buffer per patch. This module holds that buffer and the primitives, so vegetation.ts and
 *   rocks.ts draw the same way.
 *
 * Operations
 *   - QuadBuffer: growable typed arrays (pos, nrm, col, det = [sway, phase]) with `n` vertices;
 *     reset() rewinds it for reuse, vert() appends and grows. Avoids boxed-number arrays.
 *   - Module-level scratch vectors _up, _ta, _tb (the per-column tangent frame), _base, _base2,
 *     _boxC, _n. The CALLER sets _up (column direction) and the frame before drawing; the
 *     primitives read it. Shared mutable state, so drawing is not re-entrant.
 *   - box: small surface-aligned box, lit along the surface frame like voxel blocks (top 1.0,
 *     sides 0.85, bottom 0.7). root: position on the surface at tangent offset (a, b).
 *     boxYawed: a box rotated in the tangent plane (temporarily swaps the shared frame).
 *   - tuft: a crossed pair of blades rooted on the surface, root darkened by ROOT_SHADE (contact
 *     shadow) — the building block of grass, flowers, sprite plants, reeds, mushrooms, vines.
 *   - Normals point along the surface up, so blades stay in the lit band instead of going dark.
 *   - Rng: the seeded RNG type every drawer takes (core/rng makeRng).
 *
 * Usage
 *   Imported by vegetation.ts (which owns the buffer per build) and rocks.ts. Set _up/_ta/_tb
 *   (vegetation.ts's frame()) before calling box / boxYawed / root / tuft. Put a primitive here
 *   once a second file needs it; single-use helpers stay with their caller.
 *
 * See also: vegetation.ts, rocks.ts; DESIGN.md "7. Vegetation".
 */
import * as THREE from 'three';
import type { makeRng } from '../core/rng';

/** Growable typed buffers — avoids the boxed-number arrays the flat DetailField uses. */
export class QuadBuffer {
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

export const _up = new THREE.Vector3();
export const _ta = new THREE.Vector3();
export const _tb = new THREE.Vector3();
export const _base = new THREE.Vector3();
export const _base2 = new THREE.Vector3();

/**
 * A small surface-aligned box: flower heads and pebbles. Faces are lit along
 * the surface frame like the voxel blocks (top 1.0, sides 0.85, bottom 0.7).
 */
export const _boxC = new THREE.Color();
export const _n = new THREE.Vector3();

const _rot = new THREE.Vector3();
const _saveA = new THREE.Vector3();
const _saveB = new THREE.Vector3();

export function box(
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

/** Root position on the surface at tangent offset (a, b) from the column centre. */
export function root(centre: THREE.Vector3, a: number, b: number) {
    return _base.copy(centre).addScaledVector(_ta, a).addScaledVector(_tb, b);
}

/** A box rotated by `yaw` in the tangent plane. Temporarily swaps the shared frame. */
export function boxYawed(
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

/** Seeded RNG type shared by every detail drawer (core/rng makeRng). */
export type Rng = ReturnType<typeof makeRng>;

const _root = new THREE.Color();
/** Blade root brightness relative to its authored base colour (contact shadow). */
export const ROOT_SHADE = 0.72;

/**
 * A crossed pair of blades rooted at `base`, standing along `up`.
 * `ox`/`oy` are tangent offsets for the root; `lean` tilts the tip.
 */
export function tuft(
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
    /** Added to the phase attribute only (e.g. HANGING marks vines); not to the facing. */
    phaseTag = 0,
) {
    const hw = w * 0.5;
    const ph = rot + phaseTag;
    const c = Math.cos(rot),
        s = Math.sin(rot);
    // Contact shadow: the root sits in its own shade (the blades around it block
    // the sky), so it is darker than the tip — grass reads rooted, not pasted on.
    _root.copy(dark).multiplyScalar(ROOT_SHADE);
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
        buf.vert(base.x - dx, base.y - dy, base.z - dz, up, _root, 0, ph);
        buf.vert(base.x + dx, base.y + dy, base.z + dz, up, _root, 0, ph);
        buf.vert(tx + dx * 0.62, ty + dy * 0.62, tz + dz * 0.62, up, light, sway, ph);
        buf.vert(tx - dx * 0.62, ty - dy * 0.62, tz - dz * 0.62, up, light, sway, ph);
    }
}
