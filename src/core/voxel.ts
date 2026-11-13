/**
 * The voxel core: a dense grid, a face-culling mesher with baked per-vertex
 * ambient occlusion, and the shader that gives every block its surface.
 *
 * Why baked AO matters: it is the single biggest reason the reference images
 * read as a handcrafted diorama rather than a pile of cubes. Contact shadows
 * in every crevice give the geometry weight and let us keep the key light
 * soft and the whole palette high-key without the forms going flat.
 *
 * Most materials are deliberately untextured. Only authored wood receives
 * parallel board seams or lengthwise grain from world-space UVs; terrain and
 * blossom planes remain uninterrupted flat colour.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { BLOCK_BY_ID, WATER, LIGHT } from './palette';
import { basisFromCode } from './geoutil';

/* ================================================================== *
 * Sphere voxel grid: six cube faces of FACE_RES² columns, SHELL_DEPTH layers.
 * ================================================================== */
export const PLANET_RADIUS = 350;
export const FACE_RES = 400;
export const SHELL_DEPTH = 96;

// Precomputed face bases matching basisFromCode:
//   face 0 +X: n=(1,0,0), tu=(0,1,0), tv=(0,0,1)
//   face 1 -X: n=(-1,0,0), tu=(0,1,0), tv=(0,0,-1)
//   face 2 +Y: n=(0,1,0), tu=(1,0,0), tv=(0,0,-1)
//   face 3 -Y: n=(0,-1,0), tu=(1,0,0), tv=(0,0,1)
//   face 4 +Z: n=(0,0,1), tu=(0,1,0), tv=(-1,0,0)
//   face 5 -Z: n=(0,0,-1), tu=(0,1,0), tv=(1,0,0)
const _FN = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];
const _FTU = [
    [0, 1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 1, 0],
];
const _FTV = [
    [0, 0, 1],
    [0, 0, -1],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 0, 0],
];

/** Convert (face, u, v) where u or v may be out of [0, FACE_RES) to the canonical face+UV. */
export function crossFaceUV(face: number, u: number, v: number): [number, number, number] {
    const n = _FN[face],
        tu = _FTU[face],
        tv = _FTV[face];
    // Column centre in cube space (unnormalised — dominant axis determines new face)
    const pu = (2 * (u + 0.5)) / FACE_RES - 1;
    const pv = (2 * (v + 0.5)) / FACE_RES - 1;
    const cx = n[0] + tu[0] * pu + tv[0] * pv;
    const cy = n[1] + tu[1] * pu + tv[1] * pv;
    const cz = n[2] + tu[2] * pu + tv[2] * pv;
    // Find dominant axis → new face
    const ax = Math.abs(cx),
        ay = Math.abs(cy),
        az = Math.abs(cz);
    let axis = 0;
    if (ay > ax) axis = 1;
    if (az > Math.max(ax, ay)) axis = 2;
    const comp = axis === 0 ? cx : axis === 1 ? cy : cz;
    const f2 = axis * 2 + (comp < 0 ? 1 : 0);
    // Project cube vector onto new face plane
    const n2 = _FN[f2],
        tu2 = _FTU[f2],
        tv2 = _FTV[f2];
    const dn = cx * n2[0] + cy * n2[1] + cz * n2[2];
    const du = cx * tu2[0] + cy * tu2[1] + cz * tu2[2];
    const dv = cx * tv2[0] + cy * tv2[1] + cz * tv2[2];
    const u2 = Math.max(0, Math.min(FACE_RES - 1, Math.floor(((du / dn + 1) * FACE_RES) / 2)));
    const v2 = Math.max(0, Math.min(FACE_RES - 1, Math.floor(((dv / dn + 1) * FACE_RES) / 2)));
    return [f2, u2, v2];
}

export class SphereVoxelGrid {
    readonly data: Uint8Array;
    // highest solid layer per column, -1 if empty
    readonly surfaceLayer: Int16Array;
    /**
     * Ground-cover plant per column (a block id, 0 = none) drawn as sprite
     * vegetation on top of the column instead of as a voxel cube.
     */
    readonly plants: Uint8Array;

    constructor() {
        // ponytail: 92 MB for the voxel data; acceptable on desktop
        this.data = new Uint8Array(6 * FACE_RES * FACE_RES * SHELL_DEPTH);
        this.surfaceLayer = new Int16Array(6 * FACE_RES * FACE_RES).fill(-1);
        this.plants = new Uint8Array(6 * FACE_RES * FACE_RES);
    }

    plantAt(face: number, u: number, v: number): number {
        if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return 0;
        return this.plants[this.colIdx(face, u, v)];
    }

    setPlant(face: number, u: number, v: number, id: number): void {
        this.plants[this.colIdx(face, u, v)] = id;
    }

    private idx(face: number, u: number, v: number, layer: number): number {
        return ((face * FACE_RES + v) * FACE_RES + u) * SHELL_DEPTH + layer;
    }

    private colIdx(face: number, u: number, v: number): number {
        return (face * FACE_RES + v) * FACE_RES + u;
    }

    get(face: number, u: number, v: number, layer: number): number {
        if (
            face < 0 ||
            face >= 6 ||
            u < 0 ||
            u >= FACE_RES ||
            v < 0 ||
            v >= FACE_RES ||
            layer < 0 ||
            layer >= SHELL_DEPTH
        )
            return 0;
        return this.data[this.idx(face, u, v, layer)];
    }

    set(face: number, u: number, v: number, layer: number, id: number): void {
        if (
            face < 0 ||
            face >= 6 ||
            u < 0 ||
            u >= FACE_RES ||
            v < 0 ||
            v >= FACE_RES ||
            layer < 0 ||
            layer >= SHELL_DEPTH
        )
            return;
        this.data[this.idx(face, u, v, layer)] = id;
        const col = this.colIdx(face, u, v);
        if (id !== 0) {
            if (layer > this.surfaceLayer[col]) this.surfaceLayer[col] = layer;
        } else if (this.surfaceLayer[col] === layer) {
            let l = layer - 1;
            while (l >= 0 && this.data[this.idx(face, u, v, l)] === 0) l--;
            this.surfaceLayer[col] = l;
        }
    }

    isSolid(face: number, u: number, v: number, layer: number): boolean {
        const id = this.get(face, u, v, layer);
        return id !== 0 && !(BLOCK_BY_ID[id] as any)?.isWater;
    }

    /** Like isSolid but crosses face boundaries when u/v are out of [0, FACE_RES). */
    isSolidGlobal(face: number, u: number, v: number, layer: number): boolean {
        if (u >= 0 && u < FACE_RES && v >= 0 && v < FACE_RES) return this.isSolid(face, u, v, layer);
        const [f2, u2, v2] = crossFaceUV(face, u, v);
        return this.isSolid(f2, u2, v2, layer);
    }

    /** Highest solid layer in the column, or -1 if empty. */
    columnTop(face: number, u: number, v: number): number {
        if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return -1;
        return this.surfaceLayer[this.colIdx(face, u, v)];
    }

    /**
     * Highest walkable layer of the ground connected to the planet — ignores
     * leaves, trunks, water and anything floating (sky islands, the biosphere).
     *
     * It walks UP from layer 0 to the first air gap rather than down from the
     * column top: from the top, a floating island's grass read as "ground", so
     * the player walking under one was snapped up onto it.
     */
    groundColumnTop(face: number, u: number, v: number): number {
        if (u < 0 || u >= FACE_RES || v < 0 || v >= FACE_RES) return -1;
        const surf = this.surfaceLayer[this.colIdx(face, u, v)];
        if (surf < 0) return -1;
        const base = this.idx(face, u, v, 0);
        let l = 0;
        // Contiguous solid-or-standing blocks from the bottom: terrain, then trees
        // and water resting on it. An air gap ends the connected column.
        while (l < surf && this.data[base + l + 1] !== 0) l++;
        while (l >= 0) {
            const id = this.data[this.idx(face, u, v, l)];
            if (id === 0) {
                l--;
                continue;
            }
            const b = BLOCK_BY_ID[id] as any;
            // River/lake water is walked through: the ground is the bed beneath it.
            if (!b?.sway && !b?.isTrunk && !b?.isWater) break;
            l--;
        }
        return l;
    }

    /** World-space radius of the surface (columnTop + 1 above planet centre), min PLANET_RADIUS. */
    surfaceRadius(face: number, u: number, v: number): number {
        const top = this.groundColumnTop(face, u, v);
        return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
    }
}

export const CHUNK = 16;

/**
 * Objects on this layer are drawn only by the edge-mask pass, never by the
 * scene camera. See prepareEdgeObject.
 */
export const EDGE_LAYER = 2;

/* ================================================================== *
 * VoxelGrid
 * ================================================================== */
const FACES = [
    {
        // +X
        n: [1, 0, 0],
        axis: 0,
        corners: [
            [1, 0, 0],
            [1, 1, 0],
            [1, 1, 1],
            [1, 0, 1],
        ],
        uAxis: 2,
        vAxis: 1,
    },
    {
        // -X
        n: [-1, 0, 0],
        axis: 0,
        corners: [
            [0, 0, 1],
            [0, 1, 1],
            [0, 1, 0],
            [0, 0, 0],
        ],
        uAxis: 2,
        vAxis: 1,
    },
    {
        // +Y
        n: [0, 1, 0],
        axis: 1,
        corners: [
            [0, 1, 0],
            [0, 1, 1],
            [1, 1, 1],
            [1, 1, 0],
        ],
        uAxis: 0,
        vAxis: 2,
    },
    {
        // -Y
        n: [0, -1, 0],
        axis: 1,
        corners: [
            [0, 0, 1],
            [0, 0, 0],
            [1, 0, 0],
            [1, 0, 1],
        ],
        uAxis: 0,
        vAxis: 2,
    },
    {
        // +Z
        n: [0, 0, 1],
        axis: 2,
        corners: [
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1],
            [0, 0, 1],
        ],
        uAxis: 0,
        vAxis: 1,
    },
    {
        // -Z
        n: [0, 0, -1],
        axis: 2,
        corners: [
            [0, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
            [1, 0, 0],
        ],
        uAxis: 0,
        vAxis: 1,
    },
];

const AXIS_VEC = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
];

/* ================================================================== *
 * Mesher
 * ================================================================== */

class MeshBuffer {
    pos: number[] = [];
    nrm: number[] = [];
    col: number[] = [];
    tint: number[] = [];
    fringeCol: number[] = [];
    uv: number[] = [];
    dat: number[] = [];
    idx: number[] = [];
    count = 0;

    get empty() {
        return this.count === 0;
    }

    quad(
        verts: any,
        n: any,
        base: any,
        tint: any,
        fringeCol: any,
        uvs: any,
        ao: any,
        pattern: any,
        fringe: any,
        localV: any,
    ) {
        const b = this.count;
        for (let i = 0; i < 4; i++) {
            this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
            this.nrm.push(n[0], n[1], n[2]);
            this.col.push(base.r, base.g, base.b);
            this.tint.push(tint.r, tint.g, tint.b);
            this.fringeCol.push(fringeCol.r, fringeCol.g, fringeCol.b);
            this.uv.push(uvs[i][0], uvs[i][1]);
            this.dat.push(ao[i], pattern, fringe, localV[i]);
        }
        // Flip the split so the AO gradient never creases along the wrong diagonal.
        if (ao[0] + ao[2] > ao[1] + ao[3]) {
            this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        } else {
            this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
        }
        this.count += 4;
    }

    /**
     * Pack the vertex streams down before handing them to the GPU.
     *
     * Every one of these attributes was a float3/float4 — 84 bytes per vertex,
     * which on a world this size is ~40 MB of buffers and a lot of wasted
     * bandwidth on a stream the vertex shader touches once. Almost none of it
     * needs float precision:
     *
     *   position  voxel corners are integers -> Int16
     *   normal    axis-aligned, always 0 or ±1 -> Int8 normalized
     *   colours   already in 0..1, and these are flat pastels where a 1/255
     *             step is invisible -> Uint8 normalized
     *   aUv       world-space and integral at every vertex -> Int16
     *   aData     carries fractional AO, pattern, fringe and local height, so
     *             this one genuinely stays float
     *
     * Normalized integer attributes are expanded back to 0..1 (or -1..1) by the
     * GPU for free, so no shader change is needed.
     */
    toGeometry() {
        const g = new THREE.BufferGeometry();
        const n = this.count;

        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) pos[i] = this.pos[i];

        const nrm = new Int8Array(n * 3);
        for (let i = 0; i < n * 3; i++) nrm[i] = Math.round(this.nrm[i] * 127);

        const packColor = (src: number[]) => {
            const a = new Uint8Array(n * 3);
            for (let i = 0; i < n * 3; i++) {
                const v = src[i];
                a[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
            }
            return a;
        };

        const uv = new Int16Array(n * 2);
        for (let i = 0; i < n * 2; i++) uv[i] = this.uv[i];

        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
        g.setAttribute('color', new THREE.BufferAttribute(packColor(this.col), 3, true));
        g.setAttribute('aTint', new THREE.BufferAttribute(packColor(this.tint), 3, true));
        g.setAttribute('aFringe', new THREE.BufferAttribute(packColor(this.fringeCol), 3, true));
        g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
        g.setAttribute('aData', new THREE.Float32BufferAttribute(this.dat, 4));
        // 16-bit indices wherever a chunk fits, which is the common case.
        g.setIndex(
            n <= 65535
                ? new THREE.BufferAttribute(new Uint16Array(this.idx), 1)
                : new THREE.BufferAttribute(new Uint32Array(this.idx), 1),
        );
        g.computeBoundingSphere();
        return g;
    }
}

function createMeshRoots() {
    const solidGroup = new THREE.Group();
    const glowGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    solidGroup.name = 'terrain';
    glowGroup.name = 'glow';
    edgeGroup.name = 'voxel-edges';

    const solidMat = makeVoxelMaterial();
    const glowMat = makeGlowMaterial();
    const edgeMat = makeEdgeMaterial();
    // Preserve the former single-edge-object access path for developer tools.
    (edgeGroup as any).material = edgeMat;

    return {
        solid: solidGroup,
        glow: glowGroup,
        edges: edgeGroup,
        material: solidMat,
        glowMaterial: glowMat,
        edgeMaterial: edgeMat,
    };
}

/** Build one sphere chunk. ci/ck are chunk indices within the face. */
function buildSphereMeshChunk(
    grid: SphereVoxelGrid,
    face: number,
    ci: number,
    ck: number,
    meshes: ReturnType<typeof createMeshRoots>,
    /** Collect outline edges (costly: ~40% of build time). Only near chunks on tiers that draw outlines. */
    wantEdges = true,
) {
    const u0 = ci * CHUNK,
        v0 = ck * CHUNK;
    const u1 = Math.min(u0 + CHUNK, FACE_RES);
    const v1 = Math.min(v0 + CHUNK, FACE_RES);
    const solid = new MeshBuffer(),
        glow = new MeshBuffer(),
        edgeMap = wantEdges ? new Map() : null;
    meshSphereFaceRegion(grid, face, u0, v0, u1, v1, solid, glow, edgeMap, 1);
    const record: any = { solid: null, glow: null, edges: null };
    if (!solid.empty) {
        record.solid = new THREE.Mesh(solid.toGeometry(), meshes.material);
        record.solid.name = `terrain-${face}-${ci}-${ck}`;
        record.solid.castShadow = true;
        record.solid.receiveShadow = true;
        record.solid.matrixAutoUpdate = false;
        meshes.solid.add(record.solid);
    }
    if (!glow.empty) {
        record.glow = new THREE.Mesh(glow.toGeometry(), meshes.glowMaterial);
        record.glow.name = `glow-${face}-${ci}-${ck}`;
        record.glow.matrixAutoUpdate = false;
        // Gems cast too: spire/obelisk caps, and the crystal grove (almost all gem),
        // which otherwise threw no shadow at all. They are lit by their own glow, so
        // they don't receive.
        record.glow.castShadow = true;
        meshes.glow.add(record.glow);
    }
    if (edgeMap && edgeMap.size > 0) {
        record.edges = buildEdgeLines(edgeMap, meshes.edgeMaterial);
        record.edges.name = `voxel-edges-${face}-${ci}-${ck}`;
        meshes.edges.add(record.edges);
    }
    return record;
}

const CHUNKS_PER_FACE_EDGE = Math.ceil(FACE_RES / CHUNK);
/** Angle one chunk spans at a cube-face centre (columns shrink slightly toward the corners). */
export const CHUNK_ANGLE = (CHUNK * 2) / FACE_RES;
/**
 * Canopy sway by bark style (aFringe.r on leaf vertices, 0..1; the shader maps it
 * to 0.35..1.6x the wind): scaly conifers are stiff, papery birch and ringed palm
 * flutter, smooth willows/mangroves/cypress move most, furrowed oaks in between.
 */
const SWAY_BY_BARK: Record<number, number> = { 0: 0.5, 1: 0.8, 2: 0.18, 3: 0.75, 4: 0.9 };
const _swayCol = new THREE.Color();
/** Chunks filled synchronously around the viewer on boot/teleport/rebuild (~250 units). */
export const NEAR_FILL = 9;
/** Unload a little past the load edge so walking along the boundary doesn't thrash. */
const UNLOAD_MARGIN = 1.5;
/** Rescan the planet only after moving this far (radians) — about a third of a chunk. */
const RESCAN_ANGLE = CHUNK_ANGLE / 3;
/** Main-thread time allowed for chunk meshing per frame. At least one chunk always builds. */
const BUILD_BUDGET_MS = 4;
/** Outer fraction of the load radius that dither-fades out with distance. */
const FADE_BAND = 0.28;
/** Beyond this (chunks), outlines are hidden and chunks stop casting shadows. */
const DETAIL_RADIUS = 7;

/**
 * Streams terrain chunks within `loadRadius` chunks (great-circle) of the player.
 *
 * The radius is the tier's ceiling; `setLoadRadius` (the settings slider) can
 * lower it but never raise it past what the device was classed for. Beyond
 * ~10 chunks (~280 units) the aerial haze is opaque, so more would be invisible.
 */
export interface ChunkListener {
    chunkLoaded(face: number, u0: number, v0: number): void;
    chunkUnloaded(face: number, u0: number, v0: number): void;
}

export function createSphereChunkStreamer(grid: SphereVoxelGrid, opts: { loadRadius?: number; edges?: boolean } = {}) {
    const tierEdges = opts.edges ?? true;
    const meshes = createMeshRoots();
    const loaded = new Map<string, any>();
    const fadingMeshes = new Set<any>();
    let loadQueue: Array<{ face: number; ci: number; ck: number; dot: number }> = [];
    let disposed = false;
    const maxRadius = opts.loadRadius ?? 10;
    let radius = maxRadius;
    let loadCos = 1,
        unloadCos = 1;
    const fadeUniforms = meshes.material.userData.uniforms;
    let detailCos = 1;
    const setCos = () => {
        loadCos = Math.cos(radius * CHUNK_ANGLE);
        unloadCos = Math.cos((radius + UNLOAD_MARGIN) * CHUNK_ANGLE);
        detailCos = Math.cos(Math.min(DETAIL_RADIUS, radius) * CHUNK_ANGLE);
        // Fade band in world units along the ground (chord ≈ arc at these angles).
        // Measured from the camera, so it fades against what's on screen.
        const surf = PLANET_RADIUS + 14;
        fadeUniforms.uFadeFar.value = radius * CHUNK_ANGLE * surf;
        fadeUniforms.uFadeNear.value = radius * (1 - FADE_BAND) * CHUNK_ANGLE * surf;
    };
    let listener: ChunkListener | null = null;
    /** Chunks whose detail state (outlines/shadow) last applied; flipped as the player moves. */
    const detailed = new Map<string, boolean>();
    setCos();
    const lastScan = new THREE.Vector3();
    let forceScan = true;

    // Chunk centre directions never change — compute all 3,750 once.
    const chunkDirs = new Float32Array(6 * CHUNKS_PER_FACE_EDGE * CHUNKS_PER_FACE_EDGE * 3);
    {
        const n = new THREE.Vector3(),
            tu = new THREE.Vector3(),
            tv = new THREE.Vector3(),
            d = new THREE.Vector3();
        let o = 0;
        for (let face = 0; face < 6; face++) {
            basisFromCode(face, n, tu, tv);
            for (let ci = 0; ci < CHUNKS_PER_FACE_EDGE; ci++) {
                for (let ck = 0; ck < CHUNKS_PER_FACE_EDGE; ck++) {
                    const u = (ci + 0.5) * CHUNK,
                        v = (ck + 0.5) * CHUNK;
                    d.copy(n)
                        .addScaledVector(tu, (2 * u) / FACE_RES - 1)
                        .addScaledVector(tv, (2 * v) / FACE_RES - 1)
                        .normalize();
                    chunkDirs[o++] = d.x;
                    chunkDirs[o++] = d.y;
                    chunkDirs[o++] = d.z;
                }
            }
        }
    }

    const keyOf = (face: number, ci: number, ck: number) => `${face},${ci},${ck}`;

    const initFade = (record: any) => {
        const uniforms = meshes.material.userData.uniforms;
        for (const mesh of [record.solid, record.glow]) {
            if (!mesh) continue;
            mesh.userData.lodAlpha = 0.0;
            mesh.userData.lodFading = true;
            fadingMeshes.add(mesh);
            mesh.onBeforeRender = () => {
                uniforms.uLodAlpha.value = mesh.userData.lodAlpha;
            };
            mesh.onAfterRender = () => {
                uniforms.uLodAlpha.value = 1.0;
            };
        }
    };

    const setDetail = (record: any, on: boolean) => {
        if (record.edges) record.edges.visible = on;
        if (record.solid) record.solid.castShadow = on;
        if (record.glow) record.glow.castShadow = on;
    };

    const loadChunk = (face: number, ci: number, ck: number, dot: number, fade: boolean) => {
        const key = keyOf(face, ci, ck);
        if (loaded.has(key) || disposed) return;
        const near = dot >= detailCos;
        const record = buildSphereMeshChunk(grid, face, ci, ck, meshes, tierEdges && near);
        record.hasEdges = tierEdges && near;
        if (fade) initFade(record);
        setDetail(record, near);
        detailed.set(key, near);
        loaded.set(key, record);
        listener?.chunkLoaded(face, ci * CHUNK, ck * CHUNK);
    };

    const unloadChunk = (key: string) => {
        const record = loaded.get(key);
        if (!record) return;
        for (const mesh of [record.solid, record.glow, record.edges]) {
            if (!mesh) continue;
            fadingMeshes.delete(mesh);
        }
        removeMeshChunk(meshes, record);
        loaded.delete(key);
        detailed.delete(key);
        const [face, ci, ck] = key.split(',').map(Number);
        listener?.chunkUnloaded(face, ci * CHUNK, ck * CHUNK);
    };

    const scan = (playerDir: THREE.Vector3) => {
        lastScan.copy(playerDir);
        forceScan = false;
        loadQueue = [];
        const keep = new Set<string>();
        let o = 0;
        for (let face = 0; face < 6; face++) {
            for (let ci = 0; ci < CHUNKS_PER_FACE_EDGE; ci++) {
                for (let ck = 0; ck < CHUNKS_PER_FACE_EDGE; ck++, o += 3) {
                    const dot =
                        chunkDirs[o] * playerDir.x + chunkDirs[o + 1] * playerDir.y + chunkDirs[o + 2] * playerDir.z;
                    if (dot < unloadCos) continue;
                    const key = keyOf(face, ci, ck);
                    keep.add(key);
                    const record = loaded.get(key);
                    if (record) {
                        const near = dot >= detailCos;
                        if (near && tierEdges && !record.hasEdges) {
                            // Built far (no outlines) and now near: re-mesh it with
                            // edges through the normal budgeted queue.
                            unloadChunk(key);
                            loadQueue.push({ face, ci, ck, dot });
                            continue;
                        }
                        if (detailed.get(key) !== near) {
                            setDetail(record, near);
                            detailed.set(key, near);
                        }
                    } else if (dot >= loadCos) loadQueue.push({ face, ci, ck, dot });
                }
            }
        }
        // Closest first; popped from the end.
        loadQueue.sort((a, b) => a.dot - b.dot);
        for (const key of loaded.keys()) if (!keep.has(key)) unloadChunk(key);
    };

    return {
        meshes,
        get loadRadius() {
            return radius;
        },
        /** World-unit distances of the near terrain's dither-out band. */
        get fadeBand(): [number, number] {
            return [fadeUniforms.uFadeNear.value, fadeUniforms.uFadeFar.value];
        },
        get loadedCount() {
            return loaded.size;
        },
        get pendingCount() {
            return loadQueue.length;
        },
        /** Something that tracks chunk load/unload — the vegetation layer. */
        setListener(l: ChunkListener) {
            listener = l;
            for (const key of loaded.keys()) {
                const [face, ci, ck] = key.split(',').map(Number);
                l.chunkLoaded(face, ci * CHUNK, ck * CHUNK);
            }
        },
        setLoadRadius(r: number) {
            const next = Math.max(3, Math.min(maxRadius, Math.round(r)));
            if (next === radius) return;
            radius = next;
            setCos();
            forceScan = true;
        },

        /**
         * @param budgetMs main-thread meshing budget this call. Pass Infinity at
         *        startup to fill the view before the first frame (no fade-in then).
         */
        update(playerDir: THREE.Vector3, budgetMs = BUILD_BUDGET_MS) {
            if (forceScan || lastScan.angleTo(playerDir) > RESCAN_ANGLE) scan(playerDir);
            const fade = Number.isFinite(budgetMs);
            const t0 = performance.now();
            do {
                const next = loadQueue.pop();
                if (!next) break;
                loadChunk(next.face, next.ci, next.ck, next.dot, fade);
            } while (performance.now() - t0 < budgetMs);
        },

        /**
         * Build, synchronously and without fade, every queued chunk within
         * `radiusChunks` of `playerDir` (closest first); the rest stream in on the
         * normal per-frame budget. Used for the first view, teleports and palette
         * rebuilds — a full-radius synchronous fill was 1,400-2,200 chunks there.
         */
        fillNear(playerDir: THREE.Vector3, radiusChunks = NEAR_FILL) {
            if (forceScan || lastScan.angleTo(playerDir) > RESCAN_ANGLE) scan(playerDir);
            const minDot = Math.cos(radiusChunks * CHUNK_ANGLE);
            while (loadQueue.length && loadQueue[loadQueue.length - 1].dot >= minDot) {
                const next = loadQueue.pop()!;
                loadChunk(next.face, next.ci, next.ck, next.dot, false);
            }
        },

        /** Queued chunks with dot >= minDot (i.e. within a radius), for boot progress. */
        pendingNear(minDot: number) {
            let n = 0;
            for (let i = loadQueue.length - 1; i >= 0 && loadQueue[i].dot >= minDot; i--) n++;
            return n;
        },
        /** Build near chunks (dot >= minDot, closest first) for up to budgetMs, no fade. */
        fillNearSlice(minDot: number, budgetMs: number) {
            const t0 = performance.now();
            while (loadQueue.length && loadQueue[loadQueue.length - 1].dot >= minDot) {
                const next = loadQueue.pop()!;
                loadChunk(next.face, next.ci, next.ck, next.dot, false);
                if (performance.now() - t0 >= budgetMs) break;
            }
        },

        tick(dt: number) {
            for (const mesh of fadingMeshes) {
                mesh.userData.lodAlpha = Math.min(1, mesh.userData.lodAlpha + dt * 3);
                if (mesh.userData.lodAlpha >= 1) {
                    mesh.userData.lodFading = false;
                    fadingMeshes.delete(mesh);
                }
            }
        },

        /**
         * Drop every chunk and reload around `playerDir`. Block colours are baked into
         * the meshes, so a palette switch must rebuild them. Fills the view at once.
         */
        rebuildAll(playerDir: THREE.Vector3) {
            for (const key of [...loaded.keys()]) unloadChunk(key);
            forceScan = true;
            this.fillNear(playerDir);
        },

        dispose() {
            disposed = true;
            for (const key of loaded.keys()) unloadChunk(key);
        },
    };
}

function removeMeshChunk(meshes: any, record: any) {
    for (const [root, object] of [
        [meshes.solid, record.solid],
        [meshes.glow, record.glow],
        [meshes.edges, record.edges],
    ]) {
        if (!object) continue;
        root.remove(object);
        object.geometry.dispose();
    }
}

/**
 * Fills solid/glow MeshBuffers for a patch of a cube face.
 *
 * Coordinate mapping from the flat mesher: x→u (column U), y→layer (radial), z→v (column V).
 * FACES[f].n = [nu, nl, nv]; FACES[f].corners[i] = [du, dl, dv].
 */
export function meshSphereFaceRegion(
    grid: SphereVoxelGrid,
    face: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    solid: any,
    glow: any,
    edgeMap: any,
    uHalo = 0,
) {
    const _fn = new THREE.Vector3(),
        _ftu = new THREE.Vector3(),
        _ftv = new THREE.Vector3();
    basisFromCode(face, _fn, _ftu, _ftv);
    const fnx = _fn.x,
        fny = _fn.y,
        fnz = _fn.z;
    const ftux = _ftu.x,
        ftuy = _ftu.y,
        ftuz = _ftu.z;
    const ftvx = _ftv.x,
        ftvy = _ftv.y,
        ftvz = _ftv.z;

    function cornerPos(uc: number, vc: number, layerc: number): [number, number, number] {
        const cx = fnx + ftux * ((2 * uc) / FACE_RES - 1) + ftvx * ((2 * vc) / FACE_RES - 1);
        const cy = fny + ftuy * ((2 * uc) / FACE_RES - 1) + ftvy * ((2 * vc) / FACE_RES - 1);
        const cz = fnz + ftuz * ((2 * uc) / FACE_RES - 1) + ftvz * ((2 * vc) / FACE_RES - 1);
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
        const r = PLANET_RADIUS + layerc;
        return [(cx / len) * r, (cy / len) * r, (cz / len) * r];
    }

    function radialDir(u: number, v: number): [number, number, number] {
        const cx = fnx + ftux * ((2 * (u + 0.5)) / FACE_RES - 1) + ftvx * ((2 * (v + 0.5)) / FACE_RES - 1);
        const cy = fny + ftuy * ((2 * (u + 0.5)) / FACE_RES - 1) + ftvy * ((2 * (v + 0.5)) / FACE_RES - 1);
        const cz = fnz + ftuz * ((2 * (u + 0.5)) / FACE_RES - 1) + ftvz * ((2 * (v + 0.5)) / FACE_RES - 1);
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
        return [cx / len, cy / len, cz / len];
    }

    /** Sway multiplier 0..1 for a leaf block, from the nearest bark below it (≤ 12 layers). */
    const swayOfColumn = (g: SphereVoxelGrid, f: number, cu: number, cv: number, layer: number) => {
        for (let l = layer - 1; l >= Math.max(0, layer - 12); l--) {
            const b = BLOCK_BY_ID[g.get(f, cu, cv, l)] as any;
            if (b?.isTrunk) return SWAY_BY_BARK[b.barkStyle ?? 0] ?? 0.55;
            if (b && !b.sway) break; // reached ground with no trunk under this leaf
        }
        // A side branch of canopy with no trunk directly below: use the default.
        return 0.55;
    };

    const aoOf = (occ: boolean[]) => {
        if (occ[0] && occ[1]) return 0;
        return (3 - (+occ[0] + +occ[1] + +occ[2])) / 3;
    };

    const ao = new Array(4);
    const localV = new Array(4);
    const uvs: [number, number][] = [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
    ];
    const verts: [number, number, number][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ];

    const scanU0 = Math.max(0, u0 - uHalo);
    const scanV0 = Math.max(0, v0 - uHalo);
    const scanU1 = Math.min(FACE_RES, u1 + uHalo);
    const scanV1 = Math.min(FACE_RES, v1 + uHalo);

    for (let v = scanV0; v < scanV1; v++) {
        for (let u = scanU0; u < scanU1; u++) {
            const top = grid.columnTop(face, u, v);
            if (top < 0) continue;

            for (let layer = 0; layer <= top; layer++) {
                const id = grid.get(face, u, v, layer);
                if (id === 0) continue;
                const block = BLOCK_BY_ID[id];
                if (!block) continue;
                const target = (block as any).emissive ? glow : solid;
                const emitGeometry = u >= u0 && u < u1 && v >= v0 && v < v1;
                const isWaterBlk = !!(block as any).isWater;

                const [rdx, rdy, rdz] = radialDir(u, v);

                for (let f = 0; f < 6; f++) {
                    const F = FACES[f];
                    const nu = u + F.n[0],
                        nlayer = layer + F.n[1],
                        nv = v + F.n[2];
                    if (grid.isSolidGlobal(face, nu, nv, nlayer)) continue;
                    // Water draws every face that meets AIR — the surface, and the side
                    // faces where a river steps down a layer or ends — so it never reads
                    // as a floating sheet. Faces against other water (internal) and
                    // against solid ground (hidden by the bank) are skipped.
                    if (isWaterBlk) {
                        if (F.n[1] === -1) continue; // the bed is beneath, always
                        const nId =
                            nu >= 0 && nu < FACE_RES && nv >= 0 && nv < FACE_RES
                                ? grid.get(face, nu, nv, nlayer)
                                : grid.get(...crossFaceUV(face, nu, nv), nlayer);
                        if (nId === id) continue;
                    }

                    const isTop = F.n[1] === 1;
                    const isBottom = F.n[1] === -1;
                    const baseCol = isTop
                        ? (block as any).top
                        : isBottom
                          ? (block as any).bottom || (block as any).side
                          : (block as any).side;
                    const pattern = isTop
                        ? ((block as any).topPattern ?? (block as any).pattern)
                        : (block as any).pattern;
                    const tintCol =
                        (isTop ? (block as any).topTint || (block as any).tint : (block as any).tint) || baseCol;
                    // Leaves carry their tree's sway stiffness in aFringe.r (leaves have no
                    // grass fringe, so the channel is free): soft for willow/palm/birch,
                    // stiff for scaly conifers. Read from the bark under the canopy.
                    const fringeCol = (block as any).sway
                        ? _swayCol.setRGB(swayOfColumn(grid, face, u, v, layer), 0, 0)
                        : (block as any).fringeColor || (block as any).top || baseCol;

                    let nrm: [number, number, number];
                    if (isTop) nrm = [rdx, rdy, rdz];
                    else if (isBottom) nrm = [-rdx, -rdy, -rdz];
                    else if (F.n[0] !== 0) nrm = [F.n[0] * ftux, F.n[0] * ftuy, F.n[0] * ftuz];
                    else nrm = [F.n[2] * ftvx, F.n[2] * ftvy, F.n[2] * ftvz];

                    const uA = AXIS_VEC[F.uAxis],
                        vA = AXIS_VEC[F.vAxis];

                    let convexMask = 0,
                        concaveMask = 0;
                    if (edgeMap) {
                        const dirs: [number, number, number, number][] = [
                            [-uA[0], -uA[1], -uA[2], 1],
                            [uA[0], uA[1], uA[2], 2],
                            [-vA[0], -vA[1], -vA[2], 4],
                            [vA[0], vA[1], vA[2], 8],
                        ];
                        for (const [dx, dy, dz, bit] of dirs) {
                            const sdu = u + dx,
                                sdv = v + dz,
                                sdl = layer + dy;
                            if (!grid.isSolidGlobal(face, sdu, sdv, sdl)) {
                                convexMask |= bit;
                            } else if (grid.isSolidGlobal(face, sdu + F.n[0], sdv + F.n[2], sdl + F.n[1])) {
                                concaveMask |= bit;
                            }
                        }
                    }

                    const forceLightEdge = isTop && (block as any).lightEdge === true;
                    if (edgeMap)
                        _collectSphereFaceEdges(
                            edgeMap,
                            face,
                            u,
                            v,
                            layer,
                            F,
                            nrm,
                            convexMask,
                            baseCol,
                            false,
                            forceLightEdge,
                            cornerPos,
                        );
                    if (edgeMap)
                        _collectSphereFaceEdges(
                            edgeMap,
                            face,
                            u,
                            v,
                            layer,
                            F,
                            nrm,
                            concaveMask,
                            baseCol,
                            true,
                            forceLightEdge,
                            cornerPos,
                        );

                    if (!emitGeometry) continue;

                    for (let i = 0; i < 4; i++) {
                        const c = F.corners[i];
                        verts[i] = cornerPos(u + c[0], v + c[2], layer + c[1]);

                        const su = c[F.uAxis] === 1 ? 1 : -1;
                        const sv = c[F.vAxis] === 1 ? 1 : -1;
                        const s1 = grid.isSolidGlobal(face, nu + uA[0] * su, nv + uA[2] * su, nlayer + uA[1] * su);
                        const s2 = grid.isSolidGlobal(face, nu + vA[0] * sv, nv + vA[2] * sv, nlayer + vA[1] * sv);
                        const cn = grid.isSolidGlobal(
                            face,
                            nu + uA[0] * su + vA[0] * sv,
                            nv + uA[2] * su + vA[2] * sv,
                            nlayer + uA[1] * su + vA[1] * sv,
                        );
                        ao[i] = aoOf([s1, s2, cn]);

                        const ucorner = u + c[0],
                            vcorner = v + c[2],
                            lcorner = layer + c[1];
                        uvs[i][0] = F.uAxis === 0 ? ucorner : F.uAxis === 2 ? vcorner : lcorner;
                        uvs[i][1] = F.vAxis === 0 ? ucorner : F.vAxis === 2 ? vcorner : lcorner;

                        localV[i] = isTop ? 1 : isBottom ? 0 : c[1];
                    }

                    // Bit 3 = sway (leaves); 16 = fresh water (shader draws ripples, skips terrain detail).
                    const patternPacked = isWaterBlk ? 16 : (pattern || 0) | ((block as any).sway ? 8 : 0);
                    // Reverse winding: x→u, y→layer, z→v swaps two axes (det=-1), flipping face orientation
                    target.quad(
                        [verts[3], verts[2], verts[1], verts[0]],
                        nrm,
                        baseCol,
                        tintCol,
                        fringeCol,
                        [uvs[3], uvs[2], uvs[1], uvs[0]],
                        [ao[3], ao[2], ao[1], ao[0]],
                        patternPacked,
                        // Negative fringe values are flags (fringe is otherwise >= 0):
                        //   -(2 + s)    bark style s for patBarkDetail (0 furrowed .. 4 smooth)
                        //   -(10 + s)   natural stone style s for patRock (0 marble .. 6 quartzite)
                        (block as any).rockStyle !== undefined
                            ? -(10 + (block as any).rockStyle)
                            : (block as any).barkStyle !== undefined
                              ? -(2 + (block as any).barkStyle)
                              : (block as any).fringe || 0,
                        [localV[3], localV[2], localV[1], localV[0]],
                    );
                }
            }
        }
    }
}

/**
 * Collect edge entries for the sphere mesher.
 * ponytail: no cross-face seam dedup — add if seam artifacts become visible
 */
function _collectSphereFaceEdges(
    edgeMap: any,
    face: number,
    u: number,
    v: number,
    layer: number,
    F: any,
    nrm: [number, number, number],
    mask: number,
    col: any,
    isConcave: boolean,
    forceLight: boolean,
    cornerPos: (uc: number, vc: number, lc: number) => [number, number, number],
) {
    if (mask === 0) return;
    const uA = AXIS_VEC[F.uAxis],
        vA = AXIS_VEC[F.vAxis];
    const borders = [
        { bit: 1, cIdx: [0, 1] },
        { bit: 2, cIdx: [2, 3] },
        { bit: 4, cIdx: [0, 3] },
        { bit: 8, cIdx: [1, 2] },
    ];
    for (const { bit, cIdx } of borders) {
        if (!(mask & bit)) continue;
        const c0 = F.corners[cIdx[0]],
            c1 = F.corners[cIdx[1]];
        const p0 = cornerPos(u + c0[0], v + c0[2], layer + c0[1]);
        const p1 = cornerPos(u + c1[0], v + c1[2], layer + c1[1]);
        addEdgeFace(edgeMap, p0, p1, nrm, forceLight || isLightFace(col), isConcave, forceLight);
    }
}

/* ================================================================== *
 * Explicit voxel edges
 * ================================================================== */

/** Intrinsic sRGB luminance at which a face belongs to the pale palette. */
const LIGHT_FACE_LUMA = 0.61;
const faceLightCache = new WeakMap();

function isLightFace(color: any) {
    const cached = faceLightCache.get(color);
    if (cached !== undefined) return cached;
    const hex = color.getHex(THREE.SRGBColorSpace);
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const light = r * 0.2126 + g * 0.7152 + b * 0.0722 >= LIGHT_FACE_LUMA;
    faceLightCache.set(color, light);
    return light;
}

function pointOrder(a: any, b: any) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

/** Add one face's ownership of a unit edge, deduplicated across both faces. */
function addEdgeFace(edgeMap: any, p0: any, p1: any, normal: any, light: any, concave: any, forceLight: any) {
    let start = p0,
        end = p1;
    if (pointOrder(start, end) > 0) [start, end] = [end, start];
    const key = `${start.join(',')}|${end.join(',')}`;
    let edge = edgeMap.get(key);
    if (!edge) {
        edge = { start, end, faces: [], concave: false };
        edgeMap.set(key, edge);
    }
    // If either owning face identifies this as an inward fold, the shared edge
    // is concave. Concave edges always use the dark ink.
    edge.concave ||= concave;

    const normalKey = normal.join(',');
    const existing = edge.faces.find((face: any) => face.key === normalKey);
    if (existing) {
        // A material boundary can contribute the same plane twice. Be
        // conservative: both contributors must be pale for the face to be pale.
        existing.light = existing.light && light;
        existing.forceLight ||= forceLight;
    } else {
        edge.faces.push({ key: normalKey, normal: [...normal], light, forceLight });
    }
}

/** Merge adjacent unit edges with identical topology into clean long runs. */
function mergeEdgeRuns(edgeMap: any) {
    const groups = new Map();

    for (const edge of edgeMap.values()) {
        const faces = [...edge.faces].sort((a, b) => a.key.localeCompare(b.key));
        const normalA = faces[0]?.normal || [0, 0, 0];
        const normalB = faces[1]?.normal || [0, 0, 0];
        // A grass top explicitly promotes its convex perimeter to the light ink;
        // otherwise both owning faces must belong to the pale palette. Concave
        // and non-manifold connections remain dark without exception.
        const light =
            faces.length === 2 &&
            !edge.concave &&
            ((faces[0].light && faces[1].light) || faces.some((face) => face.forceLight));
        const axis = edge.start.findIndex((value: any, i: any) => value !== edge.end[i]);
        const fixed = edge.start.filter((_: any, i: any) => i !== axis);
        const style = `${axis}|${fixed.join(',')}|${normalA.join(',')}|${normalB.join(',')}|${light ? 1 : 0}`;
        let group = groups.get(style);
        if (!group) {
            group = { axis, fixed, normalA, normalB, light, units: [] };
            groups.set(style, group);
        }
        group.units.push([edge.start[axis], edge.end[axis]]);
    }

    const runs: any[] = [];
    for (const group of groups.values()) {
        group.units.sort((a: any, b: any) => a[0] - b[0]);
        let start = group.units[0][0];
        let end = group.units[0][1];
        const push = () => {
            const p0 = [0, 0, 0],
                p1 = [0, 0, 0];
            let f = 0;
            for (let axis = 0; axis < 3; axis++) {
                if (axis === group.axis) {
                    p0[axis] = start;
                    p1[axis] = end;
                } else {
                    p0[axis] = p1[axis] = group.fixed[f++];
                }
            }
            runs.push({ ...group, start: p0, end: p1 });
        };

        for (let i = 1; i < group.units.length; i++) {
            const unit = group.units[i];
            if (unit[0] === end) {
                end = unit[1];
            } else {
                push();
                start = unit[0];
                end = unit[1];
            }
        }
        push();
    }

    // A round cap is normally what closes small cracks where several runs meet.
    // At a mixed-colour joint, however, a dark cap protrudes half a stroke past
    // the vertex and visibly bites into the pale run. Give the pale run ownership
    // of that joint and terminate every incident dark run at the vertex plane.
    const joints = new Map();
    const addJoint = (run: any, cap: any) => {
        const point = cap === 'roundStart' ? run.start : run.end;
        const key = point.join(',');
        let joint = joints.get(key);
        if (!joint) {
            joint = [];
            joints.set(key, joint);
        }
        joint.push({ run, cap });
    };
    for (const run of runs) {
        run.roundStart = true;
        run.roundEnd = true;
        addJoint(run, 'roundStart');
        addJoint(run, 'roundEnd');
    }
    for (const joint of joints.values()) {
        if (!joint.some(({ run }: any) => run.light)) continue;
        for (const { run, cap } of joint) {
            if (!run.light) run[cap] = false;
        }
    }
    return runs;
}

function makeEdgeMaterial() {
    const CORE_WIDTH = 0.7;
    const AA_PAD = 0.8;
    const material = new THREE.ShaderMaterial({
        uniforms: {
            resolution: { value: new THREE.Vector2(1, 1) },
            // The geometry extends past the visible stroke so the fragment shader
            // has a full pixel in which to resolve analytic coverage.
            linewidth: { value: CORE_WIDTH + AA_PAD * 2.0 },
            uCoreWidth: { value: CORE_WIDTH },
            uFogDensity: { value: 0.0 },
            uWaterLevel: { value: WATER.level },
            /** How much of a stroke survives below the waterline. */
            uSubmergedInk: { value: 0.0 },
            uMistBase: { value: 6.0 },
            uMistH: { value: 8.0 },
            uMistDens: { value: 0.022 },
            uMistMax: { value: 0.55 },
            tSceneDepth: { value: null },
            uLodAlpha: { value: 1.0 },
        },
        vertexShader: /* glsl */ `
      uniform vec2 resolution;
      uniform float linewidth;
      uniform float uFogDensity;
      uniform float uMistBase, uMistH, uMistDens, uMistMax;

      attribute vec3 instanceStart;
      attribute vec3 instanceEnd;
      attribute vec3 instanceNormalA;
      attribute vec3 instanceNormalB;
      attribute float instanceLightEligible;
      attribute vec2 instanceRoundCaps;

      // These are constant for every vertex of an edge instance. Measuring
      // against them in framebuffer pixels avoids all perspective-varying
      // interpolation, so camera distance cannot affect stroke width.
      varying vec2 vScreenStart;
      varying vec2 vScreenEnd;
      varying float vWindowDepthStart;
      varying float vWindowDepthEnd;
      varying float vLightEdge;
      varying float vFogVisibility;
      varying vec2 vRoundCaps;
      varying float vEdgeY;

      float trimSegmentAlpha(vec4 start, vec4 end) {
        float a = projectionMatrix[2][2];
        float b = projectionMatrix[3][2];
        float nearEstimate = a > 0.0 ? -b / (a + 1.0) : -0.5 * b / a;
        return (nearEstimate - start.z) / (end.z - start.z);
      }

      float heightAverage(float y0, float y1) {
        float a = clamp((y0 - uMistBase) / uMistH, -4.0, 20.0);
        float b = clamp((y1 - uMistBase) / uMistH, -4.0, 20.0);
        if (abs(b - a) < 0.02) return exp(-a);
        return (exp(-a) - exp(-b)) / (b - a);
      }

      void main() {
        vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
        vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);

        bool perspective = projectionMatrix[2][3] == -1.0;
        if (perspective) {
          if (start.z < 0.0 && end.z >= 0.0) {
            end.xyz = mix(start.xyz, end.xyz, trimSegmentAlpha(start, end));
          } else if (end.z < 0.0 && start.z >= 0.0) {
            start.xyz = mix(end.xyz, start.xyz, trimSegmentAlpha(end, start));
          }
        }

        vec4 clipStart = projectionMatrix * start;
        vec4 clipEnd = projectionMatrix * end;
        vec2 ndcStart = clipStart.xy / clipStart.w;
        vec2 ndcEnd = clipEnd.xy / clipEnd.w;
        vScreenStart = (ndcStart * 0.5 + 0.5) * resolution;
        vScreenEnd = (ndcEnd * 0.5 + 0.5) * resolution;
        vWindowDepthStart = clipStart.z / clipStart.w * 0.5 + 0.5;
        vWindowDepthEnd = clipEnd.z / clipEnd.w * 0.5 + 0.5;
        vRoundCaps = instanceRoundCaps;

        float aspect = resolution.x / resolution.y;
        vec2 dir = ndcEnd - ndcStart;
        dir.x *= aspect;
        dir = length(dir) > 1e-7 ? normalize(dir) : vec2(1.0, 0.0);

        vec2 offset = vec2(dir.y, -dir.x);
        dir.x /= aspect;
        offset.x /= aspect;
        if (position.x < 0.0) offset *= -1.0;
        if (position.y < 0.0) offset -= dir;
        else if (position.y > 1.0) offset += dir;

        offset *= linewidth / resolution.y;
        vec4 clip = position.y < 0.5 ? clipStart : clipEnd;
        clip.xy += offset * clip.w;
        gl_Position = clip;

        // A short transition at grazing angles prevents a one-frame colour
        // pop as the camera rotates across a face plane.
        float frontA = smoothstep(0.0, 0.08,
                                  (normalMatrix * instanceNormalA).z);
        float frontB = smoothstep(0.0, 0.08,
                                  (normalMatrix * instanceNormalB).z);
        vLightEdge = instanceLightEligible * frontA * frontB;

        float fogDepth = -(position.y < 0.5 ? start.z : end.z);
        float fogTerm = uFogDensity * max(fogDepth, 0.0);
        float aerialVisibility = exp(-fogTerm * fogTerm);
        // Through the model matrix, not raw: the world edge mesh sits at the
        // origin so the two agree there, but a character part's endpoints are
        // local to an animated node, and reading them as world coordinates put
        // the figure hundreds of units away and let the mist eat its outline.
        vec3 edgeWorld = (modelMatrix * vec4(
          position.y < 0.5 ? instanceStart : instanceEnd, 1.0)).xyz;
        vEdgeY = edgeWorld.y;
        float worldDistance = distance(cameraPosition, edgeWorld);
        float mist = 1.0 - exp(-uMistDens * worldDistance
                              * heightAverage(cameraPosition.y, edgeWorld.y));
        mist = clamp(mist, 0.0, 1.0) * uMistMax;
        vFogVisibility = aerialVisibility * (1.0 - mist);
      }
    `,
        fragmentShader: /* glsl */ `
      uniform sampler2D tSceneDepth;
      uniform vec2 resolution;
      uniform float uCoreWidth;
      uniform float uLodAlpha;

      varying vec2 vScreenStart;
      varying vec2 vScreenEnd;
      varying float vWindowDepthStart;
      varying float vWindowDepthEnd;
      varying float vLightEdge;
      varying float vFogVisibility;
      varying vec2 vRoundCaps;
      varying float vEdgeY;
      uniform float uWaterLevel, uSubmergedInk;

      void main() {
        // Exact framebuffer-pixel distance to the projected segment. Most
        // ends are round; dark runs use a butt cap where a pale run owns the
        // shared joint. The SDF contains no world-space or camera-distance
        // term, so both cap shape and stroke width remain stable at any zoom.
        vec2 segment = vScreenEnd - vScreenStart;
        float segmentLengthSq = max(dot(segment, segment), 1e-4);
        float segmentLength = sqrt(segmentLengthSq);
        float alongPx = dot(gl_FragCoord.xy - vScreenStart, segment)
                        / segmentLength;
        float along = clamp(alongPx / segmentLength, 0.0, 1.0);
        vec2 nearest = vScreenStart + segment * along;

        // Visibility belongs to the mathematical edge centerline, not to the
        // expanded coverage quad. A fixed-function depth test compares every
        // fragment of that quad against a sloping owner face; close to the
        // camera the face then clips away most of its own outline. Sample the
        // populated scene depth on both sides of the centerline instead. A
        // genuinely nearer object wins at all three samples, while either
        // owning face is enough to keep the full-width stroke visible.
        vec2 lineDirection = segment / segmentLength;
        vec2 lineNormal = vec2(-lineDirection.y, lineDirection.x);
        vec2 depthUv = nearest / resolution;
        vec2 depthStep = lineNormal * 0.75 / resolution;
        float sceneDepth = texture2D(tSceneDepth, depthUv).x;
        sceneDepth = max(sceneDepth,
                         texture2D(tSceneDepth, depthUv + depthStep).x);
        sceneDepth = max(sceneDepth,
                         texture2D(tSceneDepth, depthUv - depthStep).x);
        float edgeDepth = mix(vWindowDepthStart, vWindowDepthEnd, along);
        float alongDepthSlope = abs(vWindowDepthEnd - vWindowDepthStart)
                                / max(length(segment), 1.0);
        // Fixed bias covers near-edge precision; distance term scales with
        // edgeDepth² to compensate for the depth buffer's non-linear precision
        // loss at large view distances (near=0.1, far=6000 compresses most
        // precision into the first few units).
        float depthBias = 2e-5 + alongDepthSlope + edgeDepth * edgeDepth * 1e-5;
        if (edgeDepth > sceneDepth + depthBias) discard;

        float halfWidth = uCoreWidth * 0.5;
        float acrossPx = dot(gl_FragCoord.xy - vScreenStart, lineNormal);
        float signedDistance = abs(acrossPx) - halfWidth;
        if (alongPx < 0.0) {
          signedDistance = vRoundCaps.x > 0.5
            ? length(vec2(alongPx, acrossPx)) - halfWidth
            : max(signedDistance, -alongPx);
        } else if (alongPx > segmentLength) {
          float beyondEnd = alongPx - segmentLength;
          signedDistance = vRoundCaps.y > 0.5
            ? length(vec2(beyondEnd, acrossPx)) - halfWidth
            : max(signedDistance, beyondEnd);
        }
        float aa = max(fwidth(signedDistance) * 0.65, 0.50);
        float coverage = 1.0 - smoothstep(-aa, aa, signedDistance);
        coverage *= clamp(vFogVisibility, 0.0, 1.0);
        coverage *= uLodAlpha;
        /* A hard stop at the surface, not a ramp.
         *
         * Fading over a depth left every vertical edge trailing off into the
         * water, and a stroke that dims along its length reads as a smudge
         * rather than as a line that ends. Cutting it clean lets the water's
         * own dark waterline become the terminator instead.
         *
         * The only softness is one pixel of antialiasing, taken from the
         * screen-space rate of change of height so the cut stays a single
         * pixel at any distance rather than a fixed slab of world space. */
        float waterAa = max(fwidth(vEdgeY) * 0.5, 1e-5);
        float aboveWater = smoothstep(uWaterLevel - waterAa,
                                      uWaterLevel + waterAa, vEdgeY);
        coverage *= mix(uSubmergedInk, 1.0, aboveWater);
        if (coverage <= 0.001) discard;

        float light = clamp(vLightEdge, 0.0, 1.0);
        gl_FragColor = vec4(coverage * (1.0 - light),
                            coverage * light,
                            0.0,
                            coverage);
      }
    `,
        // Hidden-line removal is performed against the already-rendered scene
        // depth at the edge centerline. Fixed-function testing would let sloping
        // owner faces cut a zoom-dependent amount from the coverage quad.
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.MaxEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
        extensions: { derivatives: true } as any,
    });

    // Preserve the small public surface used by settings and LineSegments2,
    // while keeping the authored width separate from the invisible AA skirt.
    let coreWidth = CORE_WIDTH;
    let pixelRatio = 1.0;
    const syncPhysicalWidth = () => {
        const physicalWidth = coreWidth * pixelRatio;
        material.uniforms.uCoreWidth.value = physicalWidth;
        material.uniforms.linewidth.value = physicalWidth + AA_PAD * 2.0;
    };
    Object.defineProperties(material, {
        linewidth: {
            get: () => coreWidth,
            set: (value) => {
                coreWidth = Math.max(0.35, value);
                syncPhysicalWidth();
            },
        },
        resolution: {
            get: () => material.uniforms.resolution.value,
        },
    });
    (material as any).worldUnits = false;
    material.userData.setPixelRatio = (value: any) => {
        const next = Math.max(0.25, value || 1.0);
        if (next === pixelRatio) return;
        pixelRatio = next;
        syncPhysicalWidth();
    };
    return material;
}

function buildEdgeLines(edgeMap: any, material = makeEdgeMaterial(), chunkBounds: any = null) {
    const runs = mergeEdgeRuns(edgeMap);

    if (chunkBounds) {
        // Runs parallel to a chunk axis continue in the neighbouring chunk. A
        // flat endpoint lets the two analytic strokes meet at the exact vertex;
        // round caps would overlap there and create a dark bead at every seam.
        for (const run of runs) {
            if (run.axis === 0) {
                if (chunkBounds.x0 > 0 && run.start[0] === chunkBounds.x0) run.roundStart = false;
                if (chunkBounds.x1 < chunkBounds.sx && run.end[0] === chunkBounds.x1) run.roundEnd = false;
            } else if (run.axis === 2) {
                if (chunkBounds.z0 > 0 && run.start[2] === chunkBounds.z0) run.roundStart = false;
                if (chunkBounds.z1 < chunkBounds.sz && run.end[2] === chunkBounds.z1) run.roundEnd = false;
            }
        }
    }

    const positions = new Float32Array(runs.length * 6);
    const normalsA = new Int8Array(runs.length * 3);
    const normalsB = new Int8Array(runs.length * 3);
    const light = new Uint8Array(runs.length);
    const roundCaps = new Uint8Array(runs.length * 2);

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        positions.set([...run.start, ...run.end], i * 6);
        for (let axis = 0; axis < 3; axis++) {
            normalsA[i * 3 + axis] = run.normalA[axis] * 127;
            normalsB[i * 3 + axis] = run.normalB[axis] * 127;
        }
        light[i] = run.light ? 255 : 0;
        roundCaps[i * 2] = run.roundStart ? 255 : 0;
        roundCaps[i * 2 + 1] = run.roundEnd ? 255 : 0;
    }

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setAttribute('instanceNormalA', new THREE.InstancedBufferAttribute(normalsA, 3, true));
    geometry.setAttribute('instanceNormalB', new THREE.InstancedBufferAttribute(normalsB, 3, true));
    geometry.setAttribute('instanceLightEligible', new THREE.InstancedBufferAttribute(light, 1, true));
    geometry.setAttribute('instanceRoundCaps', new THREE.InstancedBufferAttribute(roundCaps, 2, true));

    const edges = new LineSegments2(geometry, material as any);
    edges.name = 'voxel-edges';
    edges.matrixAutoUpdate = false;
    prepareEdgeObject(edges);
    return edges;
}

/**
 * Shared setup for anything that draws into the edge mask.
 *
 * The layer is what keeps these strokes out of the beauty pass: the scene
 * camera only ever looks at layer 0, and the edge pass flips to EDGE_LAYER for
 * the one render that consumes them. Living in the main scene rather than in a
 * private one is what lets an edge object be parented to an animated node and
 * still arrive with a correct world matrix.
 */
function prepareEdgeObject(edges: any) {
    edges.castShadow = false;
    edges.receiveShadow = false;
    edges.renderOrder = 2;
    edges.layers.set(EDGE_LAYER);
    // LineSegments2's default callback reports the renderer's logical viewport,
    // not the active offscreen target. Use the physical target viewport so the
    // SDF and gl_FragCoord stay in the same pixel coordinate system at any DPR.
    const edgeViewport = new THREE.Vector4();
    edges.onBeforeRender = (renderer: any) => {
        renderer.getCurrentViewport(edgeViewport);
        edges.material.resolution.set(edgeViewport.z, edgeViewport.w);
    };
    return edges;
}

const COMMON_GLSL = /* glsl */ `
  float vxHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vxHash3(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vxHash(i), vxHash(i + vec2(1.0, 0.0)), f.x),
               mix(vxHash(i + vec2(0.0, 1.0)), vxHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const VERT_DECL = /* glsl */ `
  attribute vec3 aTint;
  attribute vec3 aFringe;
  attribute vec2 aUv;
  attribute vec4 aData;
  varying vec3 vTintV;
  varying vec3 vFringeV;
  varying vec2 vUvW;
  varying vec4 vDataV;
  varying vec3 vNrmW;
  varying vec3 vPosW;

  uniform float uWindTime;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
  uniform float uPlanetRadius;
`;

const VERT_BODY = /* glsl */ `
  vTintV = aTint;
  vFringeV = aFringe;
  vUvW = aUv;
  vDataV = aData;
  vNrmW  = normal;
  vPosW  = transformed;

  // Wind sway: bit 3 of aData.y flags swayable blocks (leaf blocks).
  // Phase offset from world XZ keeps adjacent trees out of sync.
  // Height factor (aData.w) keeps the base stationary.
  if (aData.y >= 8.0 && aData.y < 15.5 && uWindStrength > 0.0) {
    float phase = transformed.x * 0.31 + transformed.z * 0.27;
    // Per-tree stiffness (aFringe.r, set by the mesher from the trunk's bark):
    // 0 → 0.35x (stiff conifers) .. 1 → 1.6x (willows); flexible trees also sway a
    // touch faster so they flutter rather than just lean further.
    float flex = mix(0.35, 1.6, aFringe.r);
    float rate = mix(0.85, 1.25, aFringe.r);
    float sway  = (sin(uWindTime * 1.1 * rate + phase) * 0.6
                 + sin(uWindTime * 0.47 * rate + phase * 1.9) * 0.4)
                 * uWindStrength * flex;
    float heightT = clamp((length(transformed.xyz) - uPlanetRadius) / 28.0, 0.0, 1.0);
    // Project wind onto the sphere tangent plane so sway is always lateral.
    vec3 radial    = normalize(transformed.xyz);
    vec3 wind3d    = normalize(vec3(uWindDir.x, 0.0, uWindDir.y));
    vec3 windTang  = wind3d - dot(wind3d, radial) * radial;
    float wLen = length(windTang);
    if (wLen > 0.001) windTang /= wLen; else windTang = vec3(1.0, 0.0, 0.0);
    transformed.xyz += windTang * sway * heightT;
  }
`;

const FRAG_DECL = /* glsl */ `
  varying vec3 vTintV;
  varying vec3 vFringeV;
  varying vec2 vUvW;
  varying vec4 vDataV;
  varying vec3 vNrmW;
  varying vec3 vPosW;
  uniform float uLodAlpha;
  uniform float uFadeNear, uFadeFar;
  uniform float uAoStrength;
  uniform float uPlanetRadius;
  uniform float uSeaLevelRadius;
  uniform vec3  uAoTint;
  uniform float uShadowTintStrength;
  uniform float uShadowDeepen;
  uniform vec3  uShadowHue;
  uniform sampler2D uWaterMap;
  uniform float uWaterLevel, uWaterRange, uWorldSize;
  uniform float uWaterInkWidth, uWaterInkStrength;
  uniform vec3  uWaterInk;
  uniform vec3  uSunDir;
  uniform float uSunAmbient;   // diffuse boost from sun on lit faces
  uniform float uFillAmbient;  // flat ambient lift for all faces
  uniform vec3  uSunTint;      // warm tint on sun-facing surfaces
  uniform vec3  uAmbientTint;  // cool tint on all surfaces (night blue shift)
  uniform float uWindTime;     // shared clock: drives river ripples


  /**
   * Brick courses for the soil cliffs. Three courses per block in a running
   * bond. The mortar is only a step darker than the face — in the reference
   * these read as a texture you notice on second look, not as a graphic
   * pattern, so the contrast here is deliberately low.
   */
  vec3 patBrick(vec2 uv, vec3 base, vec3 mortar) {
    const float ch = 0.3333;
    float row  = floor(uv.y / ch);
    float offs = mod(row, 2.0) * 0.5;
    vec2 p = vec2((uv.x + offs) / 0.8, uv.y / ch);
    vec2 f = fract(p);
    float m = min(
      smoothstep(0.0, 0.07, f.x) * smoothstep(0.0, 0.07, 1.0 - f.x),
      smoothstep(0.0, 0.13, f.y) * smoothstep(0.0, 0.13, 1.0 - f.y));
    float h = vxHash(floor(p) + 3.7);
    vec3 face = base * (0.965 + h * 0.07);
    face = mix(face, face * 1.06, step(0.88, h));   // occasional weathered brick
    return mix(mortar, face, m);
  }

  /**
   * Shared natural-stone library. One function, styles built from the same
   * layers in different strengths — all smooth noise, so there are no courses,
   * rows or grids anywhere (brick textures read as masonry, not rock):
   *   grain    fine, uneven mineral grain over everything
   *   veins    thin wandering ridges of domain-warped noise, at two scales
   *   bedding  soft wavy layers (sandstone) / tight cleavage planes (slate)
   *   speckle  crystal flecks, light and dark (granite) or glints (quartzite)
   *   pits     vesicles and weathering pocks (basalt, sandstone)
   *   foot     a darker weathered base on side faces
   * Vein colour follows the tint: a tint darker than the base draws dark veins,
   * a paler tint draws pale veins (dark marble, slate).
   * style: 0 marble, 1 dark marble, 2 slate, 3 sandstone, 4 granite, 5 basalt, 6 quartzite.
   * Reads vPosW (weathered foot), so only valid inside main().
   */
  vec3 patRock(vec2 uv, vec3 base, vec3 tint, bool top, float style) {
    // Per-style strengths.
    float veinK   = style < 1.5 ? 0.7 : style < 2.5 ? 0.35 : style < 3.5 ? 0.12 : style < 4.5 ? 0.18 : style < 5.5 ? 0.1 : 0.45;
    float bedK    = style > 1.5 && style < 2.5 ? 0.6 : style > 2.5 && style < 3.5 ? 0.45 : 0.0;
    float specK   = style > 3.5 && style < 4.5 ? 0.55 : style > 5.5 ? 0.4 : 0.06;
    float pitK    = style > 4.5 && style < 5.5 ? 0.35 : style > 2.5 && style < 3.5 ? 0.15 : 0.08;
    float grainK  = style > 2.5 && style < 3.5 ? 0.22 : style > 4.5 && style < 5.5 ? 0.2 : 0.14;
    float cloudK  = style < 1.5 ? 0.16 : style > 5.5 ? 0.2 : 0.1;

    vec2 p = uv * 0.9;
    vec2 w = vec2(vxNoise(p * 1.3 + 4.1), vxNoise(p * 1.3 - 2.7));
    // Cloudy body variation.
    float cloud = vxNoise(p * 1.1 + w * 1.5) * 0.6 + vxNoise(p * 2.7 + 9.0) * 0.4;
    vec3 col = base * (1.0 - cloudK + 2.0 * cloudK * smoothstep(0.2, 0.85, cloud));

    // Bedding / cleavage: along the layer axis on side faces (uv.y here), wavy.
    if (bedK > 0.0 && !top) {
      float freq = style < 2.5 ? 7.0 : 2.4;                    // slate tight, sandstone broad
      float b = sin((uv.y + (vxNoise(vec2(uv.x * 0.8, uv.y * 0.3)) - 0.5) * (style < 2.5 ? 0.25 : 0.8)) * freq * 6.2832);
      col *= 1.0 - bedK * 0.18 * (0.5 + 0.5 * b);
      // Thin darker partings between beds.
      col *= 1.0 - bedK * 0.25 * (1.0 - smoothstep(0.0, 0.12, abs(b - 0.96)));
    }

    // Veins.
    bool paleVeins = dot(tint, vec3(0.333)) > dot(base, vec3(0.333));
    vec3 vein = paleVeins ? tint : tint * 0.55;
    float v1 = 1.0 - smoothstep(0.0, 0.035, abs(vxNoise(p * 1.6 + w * 2.2) - 0.5));
    float v2 = 1.0 - smoothstep(0.0, 0.022, abs(vxNoise(p * 4.2 + w * 1.4 + 13.0) - 0.5));
    col = mix(col, vein, clamp(veinK * (v1 * 0.95 + v2 * 0.5), 0.0, 0.85));

    // Crystal speckle: light and dark flecks; quartzite glints a little.
    float sp = vxNoise(uv * 23.0 + 3.3), sp2 = vxNoise(uv * 31.0 - 7.1);
    col = mix(col, base * 1.35 + vec3(0.03, 0.02, 0.02), specK * smoothstep(0.78, 0.9, sp));
    col = mix(col, base * 0.45, specK * smoothstep(0.8, 0.92, sp2));

    // Grain: fine and uneven, two octaves so it reads as mineral, not noise.
    float g = vxNoise(uv * 14.0) * 0.6 + vxNoise(uv * 37.0 + 5.0) * 0.4;
    col *= 1.0 - grainK * 0.5 + grainK * g;

    // Pits / vesicles.
    col *= 1.0 - pitK * smoothstep(0.82, 0.93, vxNoise(uv * 7.5 + 21.0));

    // Weathered foot on side faces.
    if (!top) col *= 0.82 + 0.18 * smoothstep(-2.0, 6.0, length(vPosW) - uSeaLevelRadius);
    return col;
  }

  vec3 patStone(vec2 uv, vec3 base, vec3 tint) {
    float n = vxNoise(uv * 1.6) * 0.6 + vxNoise(uv * 4.3) * 0.3 + vxNoise(uv * 11.0) * 0.1;
    vec3 col = mix(base, tint, smoothstep(0.42, 0.78, n));
    col *= 0.98 + vxNoise(uv * 23.0) * 0.04;
    return col;
  }

  /**
   * Canopy shading on leaf blocks. Soft, irregular light and shadow — clumps of
   * leaves catching light over shadowed pockets — with a fine leaf texture on
   * top. Built from layered smooth noise, never cells, so there are no outlines
   * and nothing reads as paving. uv is in block units and continuous across
   * neighbouring blocks, so the canopy shades as one mass, not per cube.
   */
  /**
   * Shade variety across canopies, on top of patFoliage's within-tree clumps:
   *  - per tree: a low-frequency world-space field shifts brightness, warmth and
   *    saturation, so neighbouring trees of one leaf colour still differ (one tree
   *    stays consistent — the field is ~6 blocks across);
   *  - up the crown: lower canopy darker and cooler, the top sunlit and warmer;
   *  - new growth: pale, bright young-leaf tips scattered over top faces.
   * Reads vPosW, so only valid inside main().
   */
  vec3 canopyVariety(vec3 col, vec3 tint, bool top, vec2 uv) {
    vec3 wp = vPosW * 0.16;
    float tree = vxNoise(wp.xz + wp.y * 0.3) * 0.5 + vxNoise(wp.xy * 1.3 + 7.0) * 0.5;   // 0..1, per crown
    float warm = vxNoise(wp.yz * 0.9 - 3.0);
    // Brightness: about ±14% between trees.
    col *= 0.86 + 0.28 * tree;
    // Warmth: some crowns lean yellow-green, others blue-green.
    col *= mix(vec3(0.94, 0.98, 1.06), vec3(1.07, 1.02, 0.9), warm);
    // Saturation: drier crowns slightly greyer.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, 0.82 + 0.3 * tree);
    // Height: a smooth darker-below, sunlit-above gradient over the first ~20
    // layers above the sea. (A cyclic fract() of height drew hard seams.)
    float hh = smoothstep(2.0, 22.0, length(vPosW) - uSeaLevelRadius);
    col *= mix(vec3(0.92, 0.94, 0.98), vec3(1.04, 1.03, 0.98), hh);
    // Young-leaf tips: small pale bright flecks on top faces only.
    if (top) {
      float tip = smoothstep(0.78, 0.9, vxNoise(uv * 3.3 + vec2(wp.x, wp.z) * 2.0));
      col = mix(col, tint * 1.25 + vec3(0.04, 0.05, 0.0), tip * 0.35);
    }
    return col;
  }

  vec3 patFoliage(vec2 uv, vec3 base, vec3 tint, float faceLight) {
    // Clump field: large soft blobs of varying size (two octaves, domain-warped
    // so the blobs are lumpy rather than round).
    vec2 w = uv + vec2(vxNoise(uv * 0.9 + 3.1), vxNoise(uv * 0.9 - 7.4)) * 0.55;
    float clump = vxNoise(w * 1.3) * 0.62 + vxNoise(w * 2.9 + 11.0) * 0.38;
    // Leaf texture: many small, slightly elongated leaves at an angle.
    vec2 lp = mat2(0.86, -0.5, 0.5, 0.86) * uv * vec2(10.0, 6.0);
    float leaves = vxNoise(lp) * 0.6 + vxNoise(lp * 2.1 + 4.0) * 0.4;
    // Light: lit clump tops vs shadowed pockets, eased so the gradient is soft.
    float lit = smoothstep(0.30, 0.78, clump);
    vec3 col = mix(base * 0.62, base * 1.06, lit);
    // Hue drift between clumps, toward the authored tint.
    col = mix(col, tint * mix(0.7, 1.05, lit), vxNoise(w * 0.7 + 19.0) * 0.45);
    // Leaf speckle, stronger where lit (individual leaves catch the light).
    col *= 0.9 + 0.2 * leaves * (0.4 + 0.6 * lit);
    // Sun-catching highlights on the brightest clumps, on lit faces only.
    col += base * 0.18 * smoothstep(0.72, 0.92, clump) * smoothstep(0.55, 0.9, leaves) * faceLight;
    return col;
  }

  /**
   * Jittered cellular noise: distance to the nearest and second-nearest random
   * feature point. Cells are irregular polygons of varied size — organic plates
   * and scales with no rows or grid, unlike the brick/tile patterns.
   * Returns (F1, F2, cell id hash).
   */
  vec3 _cells(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 o = vec2(vxHash(i + g), vxHash(i + g + 17.3));
        float d = length(g + o - f);
        if (d < d1) { d2 = d1; d1 = d; id = vxHash(i + g + 5.1); }
        else if (d < d2) d2 = d;
      }
    return vec3(d1, d2, id);
  }

  /**
   * Bark on trunk side faces: vertical furrows wandering a little as they
   * climb, raised plates between them broken by short horizontal cracks, and a
   * lighter worn edge on the plates. uv.x runs around the trunk, uv.y up it.
   * 'heightT' 0..1 up the tree adds moss at the foot.
   */
  vec3 patBarkDetail(vec2 uv, vec3 base, vec3 tint, float heightT) {
    float wob = vxNoise(vec2(uv.x * 2.0, uv.y * 0.6)) * 0.35;
    float u = uv.x * 4.5 + wob;                       // ~4–5 furrows per block width
    float f = abs(fract(u) - 0.5) * 2.0;              // 0 at a furrow, 1 mid-plate
    float furrow = 1.0 - smoothstep(0.0, 0.32, f);
    // Plates break up the trunk along wavy, irregular cracks drawn from noise —
    // never straight lines at a fixed spacing, which stacked into brick courses.
    float plateId = floor(u);
    float cn = vxNoise(vec2(uv.x * 2.6 + plateId * 3.7, uv.y * 1.1 + wob * 2.0));
    float crack = (1.0 - smoothstep(0.0, 0.045, abs(cn - 0.5))) * step(0.4, vxNoise(vec2(plateId * 1.9, uv.y * 0.7)));
    // Plate tone drifts smoothly along each plate instead of in blocky steps.
    float plateTone = 0.92 + 0.16 * vxNoise(vec2(plateId * 3.1 + 0.5, uv.y * 0.9));
    float grain = vxNoise(vec2(uv.x * 14.0, uv.y * 2.5)) * 0.5 + vxNoise(vec2(uv.x * 30.0, uv.y * 5.0)) * 0.5;
    // The authored bark is ~0.05 linear — pure black on screen once shaded and
    // occluded. Lift it to a readable mid-brown so the relief can show, then carve.
    vec3 bark = max(base * 3.6, vec3(0.16, 0.10, 0.06));
    vec3 col = bark * plateTone * (0.9 + 0.18 * grain);
    col += bark * 0.22 * smoothstep(0.7, 1.0, f);     // worn plate ridges catch light
    col = mix(col, bark * 0.38, furrow * 0.85);        // deep furrows
    col *= 1.0 - crack * 0.45 * (1.0 - furrow);
    // Moss creeping up from the base, mostly in the furrows.
    float moss = (1.0 - smoothstep(0.0, 0.35, heightT)) * (0.35 + 0.65 * furrow)
               * smoothstep(0.35, 0.65, vxNoise(uv * 3.0 + 8.0));
    col = mix(col, vec3(0.27, 0.36, 0.17), moss * 0.6);
    return col;
  }

  /**
   * Birch: pale smooth bark with short horizontal dark lenticel dashes, darker
   * rough patches near the base, and the odd peeling curl catching the light.
   */
  vec3 patBarkPapery(vec2 uv, vec3 base, vec3 tint) {
    vec3 bark = max(base, vec3(0.55, 0.52, 0.46));
    vec3 col = bark * (0.94 + 0.08 * vxNoise(uv * vec2(3.0, 1.2)));
    // Lenticels: thin dashes across the trunk, a few per block, staggered.
    float row = floor(uv.y * 5.0);
    float dash = (1.0 - smoothstep(0.0, 0.09, abs(fract(uv.y * 5.0) - 0.5) - 0.38))
               * step(0.45, vxNoise(vec2(uv.x * 3.0 + row * 7.1, row)));
    col = mix(col, tint * 0.6, dash * 0.8);
    // Dark rough blotches.
    float blot = smoothstep(0.62, 0.78, vxNoise(uv * vec2(2.2, 0.9) + 5.0));
    col = mix(col, tint * 0.55, blot * 0.7);
    // Peeling curls: small bright slivers.
    float peel = smoothstep(0.82, 0.9, vxNoise(uv * vec2(6.0, 2.0) + 11.0));
    col = mix(col, vec3(0.86, 0.8, 0.72), peel * 0.5);
    return col;
  }

  /**
   * Conifer: irregular overlapping scales (pine/fir) — jittered cells of varied
   * size, a little taller than wide, separated by dark crevices, each with its
   * own tone and a warm reddish cast. No rows or grid (that read as brickwork).
   */
  vec3 patBarkScaly(vec2 uv, vec3 base, vec3 tint, float heightT) {
    vec3 bark = max(base * 3.4, vec3(0.2, 0.11, 0.07));
    // Domain-warp so cell edges curve; stretch vertically so scales are elongated.
    vec2 p = uv * vec2(3.4, 2.0);
    p += vec2(vxNoise(uv * 1.7), vxNoise(uv * 1.7 + 9.0)) * 0.6;
    vec3 c = _cells(p);
    float edge = c.y - c.x;                              // ~0 on a crevice
    float crevice = 1.0 - smoothstep(0.02, 0.16, edge);
    float tone = 0.84 + 0.3 * c.z;
    vec3 col = bark * tone * (0.92 + 0.12 * vxNoise(uv * 9.0));
    // Each scale domes: brighter at its centre, falling off toward its rim.
    col *= 0.86 + 0.24 * (1.0 - smoothstep(0.0, 0.7, c.x));
    col = mix(col, bark * 0.28, crevice * 0.85);
    // Slight orange flush on mature trunks.
    col = mix(col, col * vec3(1.18, 0.95, 0.82), 0.35 * smoothstep(0.2, 0.8, heightT));
    return col;
  }

  /** Palm: horizontal leaf-scar rings stacked up the trunk, fibrous between them. */
  vec3 patBarkRinged(vec2 uv, vec3 base, vec3 tint) {
    vec3 bark = max(base * 1.4, vec3(0.32, 0.26, 0.18));
    float y = uv.y * 3.0 + vxNoise(vec2(uv.x * 2.0, uv.y)) * 0.25;
    float f = fract(y);
    float ring = 1.0 - smoothstep(0.0, 0.14, min(f, 1.0 - f));
    float fiber = vxNoise(vec2(uv.x * 26.0, uv.y * 3.0));
    vec3 col = bark * (0.9 + 0.16 * fiber);
    // Each band bulges a little: lighter in the middle.
    col *= 0.92 + 0.12 * sin(f * 3.14159);
    col = mix(col, tint * 0.5, ring * 0.75);
    return col;
  }

  /**
   * Smooth grey-green bark (cypress, mangrove, willow, acacia): faint vertical
   * streaks, soft mottling and pale lichen, moss low down.
   */
  vec3 patBarkSmooth(vec2 uv, vec3 base, vec3 tint, float heightT) {
    vec3 bark = max(base * 2.4, vec3(0.2, 0.19, 0.15));
    float streak = vxNoise(vec2(uv.x * 7.0, uv.y * 0.5));
    float mott = vxNoise(uv * 1.8) * 0.6 + vxNoise(uv * 4.4 + 3.0) * 0.4;
    vec3 col = bark * (0.88 + 0.14 * streak) * (0.93 + 0.12 * mott);
    float lichen = smoothstep(0.7, 0.82, vxNoise(uv * vec2(3.5, 2.5) + 17.0));
    col = mix(col, vec3(0.62, 0.66, 0.52), lichen * 0.45);
    float moss = (1.0 - smoothstep(0.0, 0.3, heightT)) * smoothstep(0.4, 0.65, vxNoise(uv * 2.6 + 8.0));
    col = mix(col, vec3(0.27, 0.36, 0.17), moss * 0.55);
    return col;
  }

  /**
   * Trunk-side coordinates in block units, independent of the mesher's uv axes:
   * x runs around the trunk (along the face's horizontal tangent), y runs up it
   * (radially). The sphere mesher's per-face uv layout does not guarantee uv.y is
   * the layer axis, which tiled end-grain rings across trunk sides.
   * Takes the face's geometric normal; reads vPosW, so only valid inside main().
   */
  vec2 _trunkUV(vec3 faceN) {
    // The mesher's uv on a side face holds (across-face, layer) in some order. The
    // layer component matches the fragment's height above the planet, so whichever
    // component is NOT the height runs around the trunk. Robust on every face.
    float h = length(vPosW) - uPlanetRadius;
    float acrossIsX = step(abs(vUvW.y - h), abs(vUvW.x - h));   // 1 if uv.y is the height
    float around = mix(vUvW.y, vUvW.x, acrossIsX);
    return vec2(around, h);
  }

  /** End grain on trunk tops/bottoms: rings around the block centre. */
  vec3 patBarkEnd(vec2 uv, vec3 base, vec3 tint) {
    vec2 c = fract(uv) - 0.5;
    float r = length(c) * 7.0 + vxNoise(uv * 3.0) * 0.8;
    float ring = 0.5 + 0.5 * sin(r * 3.14159);
    vec3 wood = max(base * 4.2, vec3(0.2, 0.13, 0.08));
    vec3 col = mix(wood, wood * 0.72, ring * 0.6);
    // Bark rim around the cut face.
    float rim = smoothstep(0.38, 0.5, max(abs(c.x), abs(c.y)));
    return mix(col, max(base * 3.6, vec3(0.16, 0.10, 0.06)) * 0.6, rim);
  }

  /**
   * Surface detail for plain terrain blocks (grass, soil, sand, stone), so a
   * block face is not one flat colour. uv is in block units (continuous across
   * neighbours); fract(uv) is the position inside this block's face.
   *   - per-block tone: each voxel a touch lighter/darker/warmer than its neighbour
   *   - bevel: faces darken softly toward their edges, so every cube reads as a form
   *   - tops: mottled patches plus fine speckle (turf, sand grain, gravel)
   *   - sides: horizontal strata along the layer axis, with grain inside each band
   */
  /** Two-octave height field for the soft relief below. */
  float _tH(vec2 p) { return vxNoise(p) * 0.65 + vxNoise(p * 2.3 + 5.1) * 0.35; }

  vec3 patTerrain(vec2 uv, vec3 base, vec3 tint, bool top, bool bottom) {
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    // Fine-detail fade: ~1 near, 0 once a block covers only a few pixels, so the
    // texture melts into soft colour with distance instead of shimmering.
    float px = length(fwidth(uv));
    float near = 1.0 - smoothstep(0.08, 0.35, px);

    float id = vxHash(cell + 0.37);
    vec3 col = base * (0.95 + 0.1 * id);
    col = mix(col, tint, 0.18 * vxHash(cell + 7.1));

    if (top) {
      // Clumpy mottle: domain-warped so patches are lumpy, never round or cellular.
      vec2 w = uv + vec2(vxNoise(uv * 0.8 + 2.3), vxNoise(uv * 0.8 - 6.1)) * 0.6;
      float mott = vxNoise(w * 1.5) * 0.6 + vxNoise(w * 3.7 + 3.0) * 0.4;
      col = mix(col * 0.9, col * 1.05, smoothstep(0.25, 0.8, mott));
      // Patches drift toward the tint, so a field is not one hue.
      col = mix(col, tint, 0.22 * smoothstep(0.45, 0.85, vxNoise(w * 0.6 + 13.0)));
      // Soft relief: height difference along a fixed light-ish direction reads as
      // gentle lumps (turf clods, sand ripples, gravel) with no edges at all.
      vec2 rp = uv * 4.5;
      float relief = _tH(rp) - _tH(rp + vec2(0.18, 0.12));
      col *= 1.0 + relief * 0.8 * near;
      // Fine grain, kept small and faded with distance.
      col *= 1.0 + (vxNoise(uv * 15.0) - 0.5) * 0.09 * near;
    } else if (!bottom) {
      // Side faces: uv.y runs along the layer axis on every side face.
      // Strata wander a little across the face so bands are layers, not rulings.
      float sy = uv.y * 2.0 + (vxNoise(vec2(uv.x * 1.3, uv.y * 0.4)) - 0.5) * 0.55;
      float band = floor(sy);
      float strata = vxHash(vec2(band, cell.x * 0.13 + 1.9));
      // Blend across each band edge so the change of tone is soft.
      float bf = fract(sy);
      float nextStrata = vxHash(vec2(band + 1.0, cell.x * 0.13 + 1.9));
      strata = mix(strata, nextStrata, smoothstep(0.82, 1.0, bf) * 0.5);
      col *= 0.9 + 0.14 * strata;
      // Grain stretched along the strata, plus soft relief for a weathered face.
      col *= 0.95 + 0.1 * vxNoise(vec2(uv.x * 5.0, sy * 7.0));
      vec2 rp = vec2(uv.x * 3.5, sy * 2.2);
      float relief = _tH(rp) - _tH(rp + vec2(0.0, 0.2));
      col *= 1.0 + relief * 0.75 * near;
      // Shallow soft groove between strata, only in places.
      float seam = 1.0 - smoothstep(0.0, 0.12, min(bf, 1.0 - bf));
      col *= 1.0 - 0.08 * seam * smoothstep(0.4, 0.6, vxNoise(uv * vec2(2.0, 0.5))) * near;
    }
    // Rounded edges: darken softly toward the face border over a wider band, with a
    // faint lift just inside, so each cube reads like a slightly pillowed form.
    vec2 e = min(f, 1.0 - f);
    float d = min(e.x, e.y);
    col *= 1.0 - 0.09 * (1.0 - smoothstep(0.0, 0.2, d));
    col *= 1.0 + 0.025 * smoothstep(0.12, 0.3, d) * (1.0 - smoothstep(0.3, 0.5, d));
    return col;
  }

  /**
   * Cactus: vertical ribs (light crests, dark grooves) running up the stem,
   * with tiny pale spine dots along the crests. uv.y runs up side faces.
   */
  vec3 patCactus(vec2 uv, vec3 base, vec3 tint, bool side) {
    if (!side) {
      // Top: a pale crown of radiating ribs.
      vec2 c = fract(uv) - 0.5;
      float a = atan(c.y, c.x) * 4.0;
      float rib = 0.5 + 0.5 * cos(a * 2.0);
      return mix(base * 0.9, base * 1.12, rib) * (0.92 + 0.16 * (1.0 - length(c) * 2.0));
    }
    float x = uv.x * 5.0;                              // 5 ribs per block
    float rib = 0.5 + 0.5 * cos(fract(x) * 6.28318);    // 1 on a crest, 0 in a groove
    vec3 col = mix(tint * 0.78, base * 1.1, rib);
    float spineY = fract(uv.y * 6.0 + floor(x) * 0.5);
    float spine = (1.0 - smoothstep(0.0, 0.12, abs(fract(x) - 0.5) * 2.0 - 0.0)) * (1.0 - smoothstep(0.0, 0.1, abs(spineY - 0.5)));
    col = mix(col, vec3(0.92, 0.9, 0.78), spine * 0.7);
    return col;
  }

  vec3 patGrassTop(vec2 uv, vec3 base, vec3 tint) {
    float n = vxNoise(uv * 5.5) * 0.55 + vxNoise(uv * 14.0) * 0.45;
    vec3 col = mix(base, tint, smoothstep(0.40, 0.80, n));
    col *= 0.985 + vxHash(floor(uv * 6.0)) * 0.03;
    return col;
  }

  vec3 patTile(vec2 uv, vec3 base, vec3 seam) {
    vec2 f = fract(uv);
    float m = min(smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, 1.0 - f.x),
                  smoothstep(0.0, 0.06, f.y) * smoothstep(0.0, 0.06, 1.0 - f.y));
    float h = vxHash(floor(uv) + 8.1);
    vec3 col = base * (0.96 + h * 0.08);
    col = mix(col, seam * 0.97, step(0.9, h) * 0.5);
    return mix(seam, col, m);
  }

  vec3 patPlank(vec2 uv, vec3 base, vec3 tint) {
    // Parallel board joints along world X, plus very low-amplitude grain.
    // This is material-specific illustration, never a generic voxel grid.
    float f = fract(uv.x);
    float seam = 1.0 - smoothstep(0.018, 0.145, min(f, 1.0 - f));
    // Each deck board spans across the bridge, so its fine grain follows the
    // other UV axis while the stronger joint repeats down the bridge length.
    float grain = sin(uv.y * 15.0 + sin(uv.x * 1.8) * 1.4) * 0.5 + 0.5;
    vec3 col = base * (0.972 + grain * 0.040);
    return mix(col, tint * 0.78, seam * 0.66);
  }

  vec3 patBark(vec2 uv, vec3 base, vec3 tint) {
    float grain = sin(uv.x * 13.0 + sin(uv.y * 2.2) * 1.8) * 0.5 + 0.5;
    float fine = sin(uv.x * 31.0 + uv.y * 0.7) * 0.5 + 0.5;
    return mix(base, tint, (grain * 0.16 + fine * 0.06));
  }
`;

const BAYER_DITHER_GLSL = /* glsl */ `
  {
    // Bayer 4×4 ordered dither — screen-door fade, no blending cost.
    const float bayer[16] = float[16](
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0
    );
    int bx = int(gl_FragCoord.x) & 3;
    int by = int(gl_FragCoord.y) & 3;
    float threshold = (bayer[by * 4 + bx] + 0.5) / 16.0;
    // Chunk fade-in on load, times the distance fade at the edge of the stream
    // radius: far terrain screen-doors out instead of ending in a hard rim.
    float distFade = 1.0 - smoothstep(uFadeNear, uFadeFar, distance(vPosW, cameraPosition));
    #ifdef FAR_FIELD
      // The far-field shell is the complement: it dithers IN across the same band
      // where the streamed chunks dither out, so the hand-over has no seam.
      distFade = 1.0 - distFade;
    #endif
    if (uLodAlpha * distFade < threshold) discard;
  }
`;

const FRAG_BODY = /* glsl */ `
  {
    vec3 col = diffuseColor.rgb;
    float pat = mod(vDataV.y, 8.0);
    bool isFresh = vDataV.y > 15.5;   // river / lake water surface
    float fringe = vDataV.z;
    float localV = vDataV.w;
    // Classify the face from its true geometric normal. The mesher writes side
    // normals as the cube face's constant tangents, which tilt up to ~35° from the
    // real sideways direction toward a face's edges — enough to misread trunk and
    // cliff sides as tops (end-grain rings on trunk sides). Derivatives give the
    // actual plane of the face anywhere on the sphere.
    vec3 _geoN = normalize(cross(dFdx(vPosW), dFdy(vPosW)));
    if (dot(_geoN, vNrmW) < 0.0) _geoN = -_geoN;
    float _radial = dot(_geoN, normalize(vPosW));
    bool isSide = abs(_radial) < 0.5;
    bool isTopFace = _radial > 0.5;

    if (fringe < -9.5)               col = patRock(vUvW, col, vTintV, isTopFace, -fringe - 10.0);
    else if (pat > 0.5 && pat < 1.5) col = patBrick(vUvW, col, vTintV);
    else if (pat > 1.5 && pat < 2.5) col = patStone(vUvW, col, vTintV);
    else if (pat > 2.5 && pat < 3.5) col = patPlank(vUvW, col, vTintV);
    else if (pat > 3.5 && pat < 4.5) col = patBark(vUvW, col, vTintV);
    else if (pat > 4.5 && pat < 5.5) col = patGrassTop(vUvW, col, vTintV);
    else if (pat > 5.5 && pat < 6.5) col = patTile(vUvW, col, vTintV);
    else if (pat > 6.5 && pat < 7.5) col = patCactus(isSide ? _trunkUV(_geoN) : vUvW, col, vTintV, isSide);
    #if defined(FOLIAGE_DETAIL) && !defined(FAR_FIELD)
    // Plain terrain blocks (no pattern, not foliage): surface detail.
    if (pat < 0.5 && vDataV.y < 7.5 && !isFresh) col = patTerrain(vUvW, col, vTintV, isTopFace, !isTopFace && !isSide);
    // Trunks (the only bark-pattern blocks): furrowed bark on the sides, rings on the ends.
    if (pat > 3.5 && pat < 4.5) {
      if (isSide) {
        float heightT = clamp((length(vPosW) - uSeaLevelRadius) / 10.0, 0.0, 1.0);
        // Bark style from the fringe flag (see the mesher): -2 furrowed, -3 papery,
        // -4 scaly, -5 ringed, -6 smooth. Unflagged trunks are furrowed.
        float barkStyle = fringe < -1.5 && fringe > -9.5 ? -fringe - 2.0 : 0.0;
        vec2 tuv = _trunkUV(_geoN);
        if (barkStyle > 3.5)      col = patBarkSmooth(tuv, diffuseColor.rgb, vTintV, heightT);
        else if (barkStyle > 2.5) col = patBarkRinged(tuv, diffuseColor.rgb, vTintV);
        else if (barkStyle > 1.5) col = patBarkScaly(tuv, diffuseColor.rgb, vTintV, heightT);
        else if (barkStyle > 0.5) col = patBarkPapery(tuv, diffuseColor.rgb, vTintV);
        else                      col = patBarkDetail(tuv, diffuseColor.rgb, vTintV, heightT);
      } else {
        col = patBarkEnd(vUvW, diffuseColor.rgb, vTintV);
      }
    }
    // Leaf blocks (sway flag, bit 3) get canopy shading instead of a flat face.
    if (vDataV.y >= 7.5 && !isFresh) {
      // Tops catch the most light, sides some, undersides sit in the canopy's shade.
      float faceLight = isTopFace ? 1.0 : isSide ? 0.6 : 0.0;
      // Undersides: a finer scale reads as leaves seen from beneath rather than smears.
      col = patFoliage(isTopFace || isSide ? vUvW : vUvW * 1.8, col, vTintV, faceLight);
      col = canopyVariety(col, vTintV, isTopFace, vUvW);
      // Leaves transmit and scatter light, so a canopy's shaded faces stay far
      // brighter than rock in the same shade; lift them so the palette hue reads.
      col *= isTopFace ? 1.05 : isSide ? 1.28 : 1.15;
    }
    #endif

    // --- fresh water: soft drifting ripples and a sheen toward the tint ---
    // World-space (3 planes) so ripples are continuous across blocks and faces.
    if (isFresh) {
      vec3 wp = vPosW * 0.9;
      float t = uWindTime * 0.6;
      float rip = (vxNoise(wp.xz + vec2(t, t * 0.7)) + vxNoise(wp.xy * 1.3 - vec2(t * 0.8, 0.0))
                 + vxNoise(wp.yz * 1.1 + vec2(0.0, t))) / 3.0;
      float fine = vxNoise(vPosW.xz * 3.1 + t * 1.7) * 0.5 + vxNoise(vPosW.yz * 2.7 - t * 1.3) * 0.5;
      col = mix(diffuseColor.rgb * 0.88, vTintV, smoothstep(0.45, 0.85, rip) * 0.55);
      col += vTintV * 0.12 * smoothstep(0.7, 0.95, fine);
      // Night: water has no sky to reflect, so it goes darker than the land
      // around it (uAmbientTint's blue shift tracks night: b - 1 ≈ 0.12 × night).
      float wNight = clamp((uAmbientTint.b - 1.0) / 0.12, 0.0, 1.0);
      col *= mix(1.0, 0.35, wNight);
    }

    // --- grass spilling over the lip of the block --------------------
    // Keep the green cap at the authored fraction (25% for turf). A restrained
    // world-space wobble avoids a ruler-straight stripe without allowing the
    // cap to consume a third or more of the dirt/stone face.
    if (fringe > 0.001 && isSide) {
      float jag = vxNoise(vec2(vUvW.x * 5.0, 0.5)) * 0.55
                + vxNoise(vec2(vUvW.x * 13.0, 2.5)) * 0.45;
      float e = 1.0 - fringe + (jag - 0.5) * 0.12;
      float t = smoothstep(e - 0.032, e + 0.032, localV);
      col = mix(col, mix(vFringeV * 0.88, vFringeV, smoothstep(e, 1.0, localV)), t);
    }

    // --- world-space macro colour variation -------------------------
    // Two-octave noise over the XZ plane breaks up uniform regions into
    // natural-looking patches — lighter dry spots, darker damp patches.
    // Scale 1: ~80 m patch (0.0125 × 80 ≈ 1 period); Scale 2: ~26 m detail.
    // Sampled on two planes and blended so it stays continuous over the sphere —
    // XZ alone smeared into stripes on the planet's flanks.
    vec3 mp = vPosW;
    float macro = (vxNoise(mp.xz * 0.0125) + vxNoise(mp.xy * 0.0125 + 31.0) + vxNoise(mp.yz * 0.0125 - 17.0)) * (0.65 / 3.0)
                + (vxNoise(mp.xz * 0.038) + vxNoise(mp.xy * 0.038 + 9.0) + vxNoise(mp.yz * 0.038 - 5.0)) * (0.35 / 3.0);
    col *= 0.95 + macro * 0.10;   // ±5 % luminance variation

    // --- face-direction shading -------------------------------------
    // A constant per-axis ramp keeps voxel forms readable from any angle
    // independent of the sun direction. Side values raised from 0.88/0.94 so
    // the unlit face reads as shaded surface rather than silhouette.
    float faceShade = 1.0;
    if (_radial > 0.5)                       faceShade = 1.0;   // radially outward = top
    else if (_radial < -0.5)                 faceShade = 0.78;  // radially inward = bottom
    // Side faces: world X vs Z means nothing on a sphere, so split by whether the
    // face looks toward or away from the sun's bearing in the local tangent plane.
    else {
      vec3 sunT = uSunDir - normalize(vPosW) * dot(uSunDir, normalize(vPosW));
      faceShade = dot(vNrmW, normalize(sunT + 1e-5)) > 0.0 ? 0.96 : 0.9;
    }
    // Hemisphere sky-ground blend: adds a small sky-tinted lift to faces that
    // point upward and a ground-bounce lift to those that point down, matching
    // the scene HemisphereLight behaviour and lifting the darkest side faces.
    float skyFacing = clamp(_radial * 0.5 + 0.5, 0.0, 1.0);   // local up on the sphere
    faceShade += skyFacing * 0.08;
    // Directional sun contribution: faces angled toward the sun receive a
    // diffuse boost, faces away get a smaller fill (no face is fully unlit).
    float sunDot = dot(vNrmW, uSunDir);
    faceShade += max(sunDot, 0.0) * uSunAmbient;
    faceShade += (1.0 - max(sunDot, 0.0)) * uFillAmbient;
    col *= faceShade;
    // Sun tint on lit faces, ambient tint on all (night blue shift)
    float sunWt = max(sunDot, 0.0) * uSunAmbient;
    col *= mix(vec3(1.0), uSunTint, sunWt * 0.55);
    col *= mix(vec3(1.0), uAmbientTint, 0.18);

    // --- height-based tint on side faces ----------------------------
    // Walls darken slightly near ground level — simulates moisture
    // absorption, soil staining, and reduced sky exposure.
    if (isSide) {
      float hRamp = clamp((length(vPosW) - uPlanetRadius) / 36.0, 0.0, 1.0);
      col *= 0.90 + hRamp * 0.10;
    }

    // --- baked ambient occlusion ------------------------------------
    float ao = mix(1.0 - uAoStrength, 1.0, vDataV.x);
    ao = ao * ao * (3.0 - 2.0 * ao);          // soften the ramp
    col *= mix(uAoTint, vec3(1.0), ao);

    /* --- waterline -----------------------------------------------------
     * The dark stroke where the water surface cuts across the terrain.
     *
     * Drawn by the BANK rather than by the water plane, and that is the
     * whole trick. The two meet exactly where the plane vanishes behind the
     * bank, so a contour drawn on the water is occluded by the very wall it
     * is meant to outline — it survives on a gentle beach and disappears on
     * every steep edge, which is most of this shoreline. On the wall it is
     * always visible, and it follows the voxel grid exactly.
     *
     * Side faces only: the surface cuts across those. A top face is either
     * wholly under or wholly over, and banding one would paint a stripe
     * across a whole shelf.
     *
     * Applied last, after shading and occlusion, so it stays a flat graphic
     * line of constant value rather than something the lighting can dim.
     */
    float _seaDist = length(vPosW) - uSeaLevelRadius;
    bool _underwater = _seaDist < 0.0;
    if (isSide) {
      // Half a block along the face normal lands exactly on the centre of
      // the neighbouring column, which is the one holding the water.
      vec2 probe = (vPosW.xz + vNrmW.xz * 0.5) / uWorldSize;
      float neighbour = (texture2D(uWaterMap, probe).r * 2.0 - 1.0) * uWaterRange;
      // Width in pixels, not world units, so the stroke matches the block
      // outlines at every distance instead of thinning across the basin.
      float w = max(fwidth(length(vPosW)) * uWaterInkWidth, 0.012);
      float line = (1.0 - smoothstep(0.0, w, abs(_seaDist)))
                 * smoothstep(0.02, 0.30, neighbour);
      col = mix(col, uWaterInk, line * uWaterInkStrength);
    }

    diffuseColor.rgb = col;
  }
`;

/**
 * Far-field planet shell: the whole planet at 1/FAR_CELL resolution, one mesh.
 *
 * Each cell is FAR_CELL×FAR_CELL columns: a flat top at the highest walkable
 * ground under it, coloured by its most common surface block (live palette), plus
 * a wall toward any lower neighbour so terraces still read as steps. It is drawn
 * with a clone of the voxel material whose distance dither is inverted (FAR_FIELD),
 * so it appears exactly where the streamed chunks fade out — beyond the load
 * radius you see the rest of the world, not an edge. Rebuilt on palette change.
 */
const FAR_CELL = 4;
const FAR_WALL_MIN = 4;
export function createFarField(grid: SphereVoxelGrid, nearMaterial: THREE.MeshLambertMaterial, seaLayer: number) {
    const mat = makeVoxelMaterial();
    // Share every uniform object with the near material (sun, tints, wind…), so the
    // two stay in lockstep; only the fade band differs.
    const nearU = nearMaterial.userData.uniforms;
    const farU = mat.userData.uniforms;
    for (const k of Object.keys(nearU)) if (k !== 'uFadeNear' && k !== 'uFadeFar') farU[k] = nearU[k];
    mat.defines = { ...(mat.defines || {}), FAR_FIELD: 1 };

    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.name = 'far-field';
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = -1;

    const N = Math.floor(FACE_RES / FAR_CELL);
    const cellTop = new Int16Array(6 * N * N);
    const cellBlock = new Uint8Array(6 * N * N);

    function sample() {
        const counts = new Map<number, number>();
        for (let f = 0; f < 6; f++)
            for (let cv = 0; cv < N; cv++)
                for (let cu = 0; cu < N; cu++) {
                    let top = -1;
                    counts.clear();
                    for (let dv = 0; dv < FAR_CELL; dv++)
                        for (let du = 0; du < FAR_CELL; du++) {
                            const u = cu * FAR_CELL + du,
                                v = cv * FAR_CELL + dv;
                            const g = grid.columnTop(f, u, v);
                            if (g > top) top = g;
                            const id = grid.get(f, u, v, Math.max(0, grid.groundColumnTop(f, u, v)));
                            counts.set(id, (counts.get(id) || 0) + 1);
                        }
                    let best = 0,
                        bn = -1;
                    for (const [id, n] of counts) if (n > bn) ((bn = n), (best = id));
                    const i = (f * N + cv) * N + cu;
                    cellTop[i] = Math.max(top, seaLayer - 2); // under the sea: a low floor the water covers
                    cellBlock[i] = best;
                }
    }

    const FN = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
    ];
    const FU = [
        [0, 1, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 1, 0],
    ];
    const FV = [
        [0, 0, 1],
        [0, 0, -1],
        [0, 0, -1],
        [0, 0, 1],
        [-1, 0, 0],
        [1, 0, 0],
    ];
    const corner = (f: number, u: number, v: number, r: number): [number, number, number] => {
        const pu = (2 * u) / FACE_RES - 1,
            pv = (2 * v) / FACE_RES - 1;
        const x = FN[f][0] + FU[f][0] * pu + FV[f][0] * pv,
            y = FN[f][1] + FU[f][1] * pu + FV[f][1] * pv,
            z = FN[f][2] + FU[f][2] * pu + FV[f][2] * pv;
        const l = Math.hypot(x, y, z);
        return [(x / l) * r, (y / l) * r, (z / l) * r];
    };

    function build() {
        sample();
        const buf = new MeshBuffer();
        const white = new THREE.Color(1, 1, 1);
        const ao4 = [1, 1, 1, 1],
            lv4 = [1, 1, 1, 1];
        const uv0: [number, number][] = [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ];
        const at = (f: number, cu: number, cv: number) => {
            if (cu < 0 || cv < 0 || cu >= N || cv >= N) return -1; // across a cube seam: no wall
            return cellTop[(f * N + cv) * N + cu];
        };
        for (let f = 0; f < 6; f++)
            for (let cv = 0; cv < N; cv++)
                for (let cu = 0; cu < N; cu++) {
                    const i = (f * N + cv) * N + cu;
                    const top = cellTop[i];
                    const blk = BLOCK_BY_ID[cellBlock[i]] as any;
                    if (!blk) continue;
                    const r = PLANET_RADIUS + top + 1;
                    const u0 = cu * FAR_CELL,
                        v0 = cv * FAR_CELL,
                        u1 = u0 + FAR_CELL,
                        v1 = v0 + FAR_CELL;
                    const c00 = corner(f, u0, v0, r),
                        c10 = corner(f, u1, v0, r),
                        c11 = corner(f, u1, v1, r),
                        c01 = corner(f, u0, v1, r);
                    const mid = corner(f, (u0 + u1) / 2, (v0 + v1) / 2, 1);
                    const up = [mid[0], mid[1], mid[2]];
                    const pattern = blk.sway ? 8 : 0;
                    buf.quad([c00, c10, c11, c01], up, blk.top, blk.tint || blk.top, white, uv0, ao4, pattern, 0, lv4);
                    // Walls down to lower neighbours (same face only; seams are rare and hidden by haze).
                    const sides: Array<[number, number, [number, number, number], [number, number, number]]> = [
                        [cu + 1, cv, c10, c11],
                        [cu - 1, cv, c01, c00],
                        [cu, cv + 1, c11, c01],
                        [cu, cv - 1, c00, c10],
                    ];
                    for (const [nu, nv, a, b] of sides) {
                        const nt = at(f, nu, nv);
                        // Only steps of FAR_WALL_MIN+ layers get a wall: a lone 2-layer
                        // terrace lip is sub-pixel at far-field range and doubled the mesh.
                        if (nt < 0 || top - nt < FAR_WALL_MIN) continue;
                        const s = (PLANET_RADIUS + nt + 1) / r;
                        const a2: [number, number, number] = [a[0] * s, a[1] * s, a[2] * s],
                            b2: [number, number, number] = [b[0] * s, b[1] * s, b[2] * s];
                        const ex = (a[0] + b[0]) / 2 - mid[0] * r,
                            ey = (a[1] + b[1]) / 2 - mid[1] * r,
                            ez = (a[2] + b[2]) / 2 - mid[2] * r;
                        const el = Math.hypot(ex, ey, ez) || 1;
                        const side = blk.side || blk.top;
                        buf.quad(
                            [a2, b2, b, a],
                            [ex / el, ey / el, ez / el],
                            side,
                            blk.tint || side,
                            white,
                            uv0,
                            ao4,
                            pattern,
                            0,
                            lv4,
                        );
                    }
                }
        mesh.geometry.dispose();
        mesh.geometry = buf.toGeometry();
        mesh.geometry.computeBoundingSphere();
        mesh.updateMatrixWorld();
    }

    build();
    return {
        mesh,
        /** Sit the far field's fade-in on the near terrain's fade-out band. */
        setBand(near: number, far: number) {
            farU.uFadeNear.value = near;
            farU.uFadeFar.value = far;
        },
        rebuild: build,
        dispose() {
            mesh.geometry.dispose();
            mat.dispose();
        },
    };
}

export function makeVoxelMaterial() {
    const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        dithering: false,
    });
    mat.userData.uniforms = {
        uLodAlpha: { value: 1.0 },
        /* Distance dither: fully drawn inside uFadeNear, gone at uFadeFar (world units from camera). */
        uFadeNear: { value: 1e9 },
        uFadeFar: { value: 2e9 },
        uAoStrength: { value: 0.25 },
        // Warm, earthy occlusion and shadow — natural light leaves a brown-grey in
        // crevices, not lilac. (The lilac/violet pair made every theme look dyed.)
        uAoTint: { value: new THREE.Color(0.6, 0.55, 0.5) },
        uShadowHue: { value: new THREE.Vector3(0.98, 0.97, 1.03) },
        uShadowTintStrength: { value: 0.82 },
        /** Extra darkening inside cast shadows (0 = hue shift only). */
        uShadowDeepen: { value: 0.22 },
        uSunDir: { value: LIGHT.sunDir.clone() },
        uSunAmbient: { value: 0.14 }, // diffuse lift on sun-facing sides
        uFillAmbient: { value: 0.06 }, // flat lift on shadow sides
        uSunTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uAmbientTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },

        /* --- waterline ---------------------------------------------------- */
        /** Signed depth field, handed over by setVoxelWaterline once the world exists. */
        uWaterMap: { value: null },
        uWaterLevel: { value: WATER.level },
        uWaterRange: { value: 20.0 },
        uWorldSize: { value: 192.0 },
        uWaterInk: { value: WATER.edge.clone() },
        /** Stroke width in pixels. */
        uWaterInkWidth: { value: 1.5 },
        uWaterInkStrength: { value: 0.85 },

        /* --- wind sway ---------------------------------------------------- */
        uWindTime: { value: 0.0 },
        uWindDir: { value: new THREE.Vector2(1.0, 0.3).normalize() },
        uWindStrength: { value: 0.0 },

        /* --- sphere radius ------------------------------------------------ */
        uPlanetRadius: { value: 350.0 },
        uSeaLevelRadius: { value: 361.5 }, // PLANET_RADIUS(350) + SEA_LAYER(11) + 0.5
    };
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, mat.userData.uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${COMMON_GLSL}\n${FRAG_DECL}`)
            .replace('void main() {', `void main() {\n${BAYER_DITHER_GLSL}`)
            .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
            .replace(
                'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
                `vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow petalShadow = directionalLightShadows[0];
          float petalVisibility = getShadow(
            directionalShadowMap[0], petalShadow.shadowMapSize,
            petalShadow.shadowIntensity, petalShadow.shadowBias,
            petalShadow.shadowRadius, vDirectionalShadowCoord[0]);
          float petalShade = (1.0 - petalVisibility) * uShadowTintStrength;
          float petalLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          // Shadows keep most of the surface's own hue and only lean cool. Replacing
          // the colour with a violet grey (as this did at 82%) drained every shaded
          // canopy and cliff to the same lilac, so all palettes looked alike in shade.
          vec3 petalCool = mix(vec3(petalLum), outgoingLight, 0.7) * uShadowHue;
          outgoingLight = mix(outgoingLight, petalCool, petalShade * 0.6);
          // Deepen what's in shadow, not just recolour it: cast shadows (tree
          // canopies above all — thin casters that a soft VSM washes out) read
          // stronger and darker on the terrain and objects beneath them.
          outgoingLight *= 1.0 - uShadowDeepen * (1.0 - petalVisibility);
        #endif`,
            );
        mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () =>
        'VoxelWorld-voxel-v24' + (mat.defines?.FOLIAGE_DETAIL ? '-fol' : '') + (mat.defines?.FAR_FIELD ? '-far' : '');
    return mat;
}

/** Emissive blocks (lanterns, crystals) — unlit, bright, bloom bait. */
export function makeGlowMaterial() {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    const GLOW_VERT_DECL = /* glsl */ `
      attribute vec2 aUv;
      attribute vec3 aTint;
      varying vec3 vNrmW;
      varying vec3 vPosG;
      varying vec2 vUvG;
      varying vec3 vTintG;`;
    const GLOW_FRAG_DECL = /* glsl */ `
      varying vec3 vNrmW;
      varying vec3 vPosG;
      varying vec2 vUvG;
      varying vec3 vTintG;`;
    mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${GLOW_VERT_DECL}`)
            .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>\n  vNrmW = normal; vPosG = transformed; vUvG = aUv; vTintG = aTint;`,
            );
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\n${GLOW_FRAG_DECL}`)
            .replace(
                '#include <color_fragment>',
                `#include <color_fragment>
        {
          // Faces shaded by the LOCAL up (radial), not world Y: on the planet's
          // flanks world-Y shading made gem sides read as tops.
          float r = dot(normalize(vNrmW), normalize(vPosG));
          float faceShade = r > 0.5 ? 1.06 : (r < -0.5 ? 0.8 : 0.94);
          // Radial sunburst: a bright core with soft rays fanning out from the face
          // centre (like sunlight through a crystal), fading toward the rim. Rays
          // vary in width and length by angle, so there is no regular X or grid.
          vec2 f = fract(vUvG) - 0.5;
          float r = length(f);
          float a = atan(f.y, f.x);
          float core = 1.0 - smoothstep(0.0, 0.55, r);
          float rays = pow(0.5 + 0.5 * cos(a * 7.0 + sin(a * 3.0) * 1.3), 3.0)
                     * (0.6 + 0.4 * (0.5 + 0.5 * cos(a * 4.0 + 1.7)));
          rays *= smoothstep(0.5, 0.06, r);      // strongest near the centre
          float rim = smoothstep(0.38, 0.5, max(abs(f.x), abs(f.y)));
          vec3 c = mix(diffuseColor.rgb, vTintG, core * 0.5);
          c *= 0.8 + 0.34 * core;
          c += vTintG * rays * 0.32;
          c *= 1.0 - rim * 0.2;
          diffuseColor.rgb = c * faceShade * 1.5;
        }`,
            );
    };
    mat.userData.uniforms = {
        uAoStrength: { value: 0 },
        uAoTint: { value: new THREE.Color(1, 1, 1) },
    };
    mat.customProgramCacheKey = () => 'VoxelWorld-glow-v6';
    return mat;
}
