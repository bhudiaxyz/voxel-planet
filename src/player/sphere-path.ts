/**
 * Column-grid A* on the sphere, for the dog.
 *
 * Nodes are surface columns (face, u, v); a step goes to one of the eight
 * neighbours, crossing cube seams through `crossFaceUV`. A step is allowed
 * when the rise is within `maxUp` layers (a terrace hop) and the drop within
 * `maxDown`. Sea and tree trunks are impassable, and diagonals may not cut
 * the corner of an impassable or too-tall neighbour.
 *
 * The search is incremental: `step(budget)` expands up to `budget` nodes and
 * returns, so a long route is spread over several frames instead of spiking
 * one. All working storage is preallocated typed arrays — no per-search garbage.
 */
import { SphereVoxelGrid, FACE_RES, crossFaceUV } from '../core/sphere-voxel';
import { BLOCK_BY_ID } from '../core/palette';

export interface Col {
    face: number;
    u: number;
    v: number;
}

export interface PathOptions {
    /** Max layers climbed in one step (terrain terraces are 2). */
    maxUp?: number;
    /** Max layers dropped in one step. */
    maxDown?: number;
    /** Columns at or below this layer are water. */
    seaLayer?: number;
    /** Hard cap on expanded nodes per search; the search gives up (unreachable) beyond it. */
    maxNodes?: number;
}

const N8: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];
const SQRT2 = Math.SQRT2;

export function createSpherePathfinder(grid: SphereVoxelGrid, opts: PathOptions = {}) {
    const maxUp = opts.maxUp ?? 2;
    const maxDown = opts.maxDown ?? 4;
    const seaLayer = opts.seaLayer ?? 11;
    const maxNodes = opts.maxNodes ?? 20000;

    // Search state, keyed by a compact node id. Sized to maxNodes; ids are
    // assigned on first touch through a Map from column key.
    const idOf = new Map<number, number>();
    const colKey = new Int32Array(maxNodes * 8 + 8);
    const g = new Float32Array(maxNodes * 8 + 8);
    const parent = new Int32Array(maxNodes * 8 + 8);
    const closed = new Uint8Array(maxNodes * 8 + 8);
    // binary min-heap of (f, id)
    const heapF = new Float32Array(maxNodes * 8 + 8);
    const heapId = new Int32Array(maxNodes * 8 + 8);
    let heapN = 0;
    let nextId = 0;
    let expanded = 0;
    let goalKey = -1;
    let goalX = 0,
        goalY = 0,
        goalZ = 0;
    let state: 'idle' | 'searching' | 'found' | 'failed' = 'idle';
    let result: Col[] = [];

    const keyOf = (f: number, u: number, v: number) => (f * FACE_RES + v) * FACE_RES + u;
    const unkey = (k: number): Col => {
        const u = k % FACE_RES;
        const r = (k - u) / FACE_RES;
        const v = r % FACE_RES;
        return { face: (r - v) / FACE_RES, u, v };
    };

    /** Unit direction of a column centre, written into out[0..2]. */
    const _d = [0, 0, 0];
    const FN = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
    ];
    const FTU = [
        [0, 1, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 1, 0],
    ];
    const FTV = [
        [0, 0, 1],
        [0, 0, -1],
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0],
    ];
    function dirOf(f: number, u: number, v: number) {
        const pu = (2 * (u + 0.5)) / FACE_RES - 1,
            pv = (2 * (v + 0.5)) / FACE_RES - 1;
        const x = FN[f][0] + FTU[f][0] * pu + FTV[f][0] * pv;
        const y = FN[f][1] + FTU[f][1] * pu + FTV[f][1] * pv;
        const z = FN[f][2] + FTU[f][2] * pu + FTV[f][2] * pv;
        const l = Math.hypot(x, y, z);
        _d[0] = x / l;
        _d[1] = y / l;
        _d[2] = z / l;
        return _d;
    }
    /**
     * Heuristic. Same face: octile distance in (u, v), exact for this 8-way
     * grid with no obstacles. Across a seam: great-circle angle in columns,
     * using the narrowest column width (face edges) so it never overestimates.
     */
    const COLS_PER_RAD_MIN = FACE_RES / 2 / (Math.PI / 4) / 1.42;
    let goalFace = 0,
        goalU = 0,
        goalV = 0;
    function h(f: number, u: number, v: number) {
        if (f === goalFace) {
            const du = Math.abs(u - goalU),
                dv = Math.abs(v - goalV);
            return Math.max(du, dv) + (SQRT2 - 1) * Math.min(du, dv);
        }
        const d = dirOf(f, u, v);
        const c = Math.max(-1, Math.min(1, d[0] * goalX + d[1] * goalY + d[2] * goalZ));
        return Math.acos(c) * COLS_PER_RAD_MIN;
    }

    /** Walkable ground layer of a column, or -1 if it can't be stood on. */
    function groundOf(f: number, u: number, v: number): number {
        const top = grid.columnTop(f, u, v);
        if (top <= seaLayer) return -1; // sea (or empty)
        const b = BLOCK_BY_ID[grid.get(f, u, v, top)] as any;
        if (b?.isTrunk) return -1;
        // Canopy over the column: stand on the ground beneath it, unless a trunk is in the way.
        if (b?.sway) {
            const gl = grid.groundColumnTop(f, u, v);
            if (gl <= seaLayer) return -1;
            const above = BLOCK_BY_ID[grid.get(f, u, v, gl + 1)] as any;
            if (above?.isTrunk) return -1;
            return gl;
        }
        return top;
    }

    const _nb = [0, 0, 0];
    function neighbour(f: number, u: number, v: number, du: number, dv: number) {
        const nu = u + du,
            nv = v + dv;
        if (nu >= 0 && nu < FACE_RES && nv >= 0 && nv < FACE_RES) {
            _nb[0] = f;
            _nb[1] = nu;
            _nb[2] = nv;
        } else {
            const [f2, u2, v2] = crossFaceUV(f, nu, nv);
            _nb[0] = f2;
            _nb[1] = u2;
            _nb[2] = v2;
        }
        return _nb;
    }

    const canStep = (from: number, to: number) => to >= 0 && to - from <= maxUp && from - to <= maxDown;

    function push(f: number, id: number) {
        let i = heapN++;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heapF[p] <= f) break;
            heapF[i] = heapF[p];
            heapId[i] = heapId[p];
            i = p;
        }
        heapF[i] = f;
        heapId[i] = id;
    }
    function pop(): number {
        const top = heapId[0];
        const f = heapF[--heapN],
            id = heapId[heapN];
        let i = 0;
        for (;;) {
            let c = 2 * i + 1;
            if (c >= heapN) break;
            if (c + 1 < heapN && heapF[c + 1] < heapF[c]) c++;
            if (heapF[c] >= f) break;
            heapF[i] = heapF[c];
            heapId[i] = heapId[c];
            i = c;
        }
        heapF[i] = f;
        heapId[i] = id;
        return top;
    }

    function touch(k: number): number {
        let id = idOf.get(k);
        if (id === undefined) {
            if (nextId >= colKey.length) return -1;
            id = nextId++;
            idOf.set(k, id);
            colKey[id] = k;
            g[id] = Infinity;
            parent[id] = -1;
            closed[id] = 0;
        }
        return id;
    }

    return {
        get state() {
            return state;
        },
        /** The found route, start column first. Valid when state === 'found'. */
        get path() {
            return result;
        },
        /** Walkable ground layer at a column, or -1 (sea / trunk). */
        groundOf,

        /** Begin a new search; any search in progress is abandoned. */
        start(from: Col, to: Col) {
            idOf.clear();
            heapN = 0;
            nextId = 0;
            expanded = 0;
            result = [];
            goalKey = keyOf(to.face, to.u, to.v);
            goalFace = to.face;
            goalU = to.u;
            goalV = to.v;
            const gd = dirOf(to.face, to.u, to.v);
            goalX = gd[0];
            goalY = gd[1];
            goalZ = gd[2];
            if (groundOf(from.face, from.u, from.v) < 0 || groundOf(to.face, to.u, to.v) < 0) {
                state = 'failed';
                return;
            }
            const id = touch(keyOf(from.face, from.u, from.v));
            g[id] = 0;
            push(h(from.face, from.u, from.v), id);
            state = 'searching';
        },

        /** Expand up to `budget` nodes. Returns the state afterwards. */
        step(budget = 400) {
            if (state !== 'searching') return state;
            for (let n = 0; n < budget; n++) {
                if (heapN === 0 || expanded >= maxNodes) {
                    state = 'failed';
                    return state;
                }
                const id = pop();
                if (closed[id]) continue;
                closed[id] = 1;
                expanded++;
                const k = colKey[id];
                if (k === goalKey) {
                    const out: Col[] = [];
                    for (let c = id; c >= 0; c = parent[c]) out.push(unkey(colKey[c]));
                    result = out.reverse();
                    state = 'found';
                    return state;
                }
                const c = unkey(k);
                const here = groundOf(c.face, c.u, c.v);
                for (let i = 0; i < 8; i++) {
                    const [du, dv] = N8[i];
                    const nb = neighbour(c.face, c.u, c.v, du, dv);
                    const nf = nb[0],
                        nu = nb[1],
                        nv = nb[2];
                    const there = groundOf(nf, nu, nv);
                    if (!canStep(here, there)) continue;
                    if (du !== 0 && dv !== 0) {
                        // No corner cutting: both orthogonal neighbours must be passable too.
                        const a = neighbour(c.face, c.u, c.v, du, 0);
                        const ga = groundOf(a[0], a[1], a[2]);
                        if (!canStep(here, ga)) continue;
                        const b = neighbour(c.face, c.u, c.v, 0, dv);
                        const gb = groundOf(b[0], b[1], b[2]);
                        if (!canStep(here, gb)) continue;
                    }
                    const nid = touch(keyOf(nf, nu, nv));
                    if (nid < 0 || closed[nid]) continue;
                    // Climbing costs a little extra so it prefers level routes.
                    const cost = (du !== 0 && dv !== 0 ? SQRT2 : 1) + Math.max(0, there - here) * 0.35;
                    const ng = g[id] + cost;
                    if (ng < g[nid]) {
                        g[nid] = ng;
                        parent[nid] = id;
                        push(ng + h(nf, nu, nv), nid);
                    }
                }
            }
            return state;
        },
    };
}
