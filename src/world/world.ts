/**
 * World assembly — runs the generators in order and turns the finished voxel
 * grid into renderable meshes.
 */

import * as THREE from 'three';
import { createSphereChunkStreamer, NEAR_FILL, CHUNK_ANGLE } from '../core/voxel';
import { makeRng } from '../core/rng';
import { SphereVoxelGrid, FACE_RES } from '../core/voxel';
import { generateSphereTerrain } from './terrain';
import { bakeWetMap } from './wet-map';
import { basisFromCode } from '../core/geoutil';
import { createSphereWater } from './water';
import { createSphereVegetation } from './vegetation';
import { bakeShoreMap } from './shore-map';

/** Sea surface layer on the sphere (matches sphere-terrain / sphere-landmarks). */
const SEA_LAYER = 11;
import { buildSphereLandmarks, LandmarkRecord } from './landmarks';

export interface SphereWorld {
    grid: SphereVoxelGrid;
    streaming: ReturnType<typeof createSphereChunkStreamer>;
    group: THREE.Group;
    spawnDir: THREE.Vector3;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    animated: any[];
    sphereWater: ReturnType<typeof createSphereWater>;
    landmarks: LandmarkRecord[];
    /** Distance to water per column (see wet-map.ts). */
    wet: Uint8Array;
    veg: ReturnType<typeof createSphereVegetation>;
}

export async function buildSphereWorld(
    seed: number,
    scene: THREE.Scene,
    onProgress: (p: number, s?: string) => void = () => {},
    opts: {
        /** Terrain stream radius in chunks. */
        streamRadius?: number;
        /** Grass coverage 0..1. */
        grassDensity?: number;
        /** Boulders/logs/mushrooms multiplier, 0 = none. */
        groundDetail?: number;
        /** Animated foam along coasts. */
        shoreFoam?: boolean;
        /** Build outline edges (tier edgeMask): skipped entirely where nothing draws them. */
        edges?: boolean;
        tier?: string;
    } = {},
): Promise<SphereWorld> {
    const { streamRadius = 10, grassDensity = 1, groundDetail = 1, shoreFoam = false, tier = 'high' } = opts;
    const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

    onProgress(0.01, 'sculpting the planet');
    await yieldFrame();
    const { grid, spawn } = await generateSphereTerrain(seed, (p, stage) => onProgress(0.01 + p * 0.7, stage));
    await yieldFrame();

    onProgress(0.72, 'placing landmarks');
    const landmarks = buildSphereLandmarks(grid, makeRng(seed ^ 0x4c2e9a1f));
    await yieldFrame();

    // Distance-to-water per column: wet ground, waterside plants, firefly habitat.
    const wet = bakeWetMap(grid, SEA_LAYER);

    onProgress(0.73, 'building terrain meshes');
    const streaming = createSphereChunkStreamer(grid, { loadRadius: streamRadius, edges: opts.edges ?? true });

    const spawnDir = new THREE.Vector3();
    const _n = new THREE.Vector3(),
        _tu = new THREE.Vector3(),
        _tv = new THREE.Vector3();
    basisFromCode(spawn.face, _n, _tu, _tv);
    spawnDir
        .copy(_n)
        .addScaledVector(_tu, (2 * (spawn.u + 0.5)) / FACE_RES - 1)
        .addScaledVector(_tv, (2 * (spawn.v + 0.5)) / FACE_RES - 1)
        .normalize();

    // Vegetation follows the streamer: a patch builds when terrain under it loads.
    // Hooked up before the first fill so the opening view has grass.
    const veg = createSphereVegetation(grid, seed ^ 0x3b1e7f, scene, grassDensity, 0.1, groundDetail, wet);
    streaming.setListener(veg);
    // Fill only the near view before the first frame (NEAR_FILL ~9 chunks), in
    // slices with a paint between them; everything beyond streams in on the
    // per-frame budget after entry, inside the fog. Filling the whole radius here
    // meant meshing 1,400-2,200 chunks before the player could see anything.
    streaming.update(spawnDir, 0); // scan → queue
    const nearDot = Math.cos(NEAR_FILL * CHUNK_ANGLE);
    const queued = () => streaming.pendingNear(nearDot);
    const total = Math.max(1, queued());
    while (queued() > 0) {
        streaming.fillNearSlice(nearDot, 24);
        onProgress(0.73 + 0.17 * (1 - queued() / total), 'building terrain meshes');
        await yieldFrame();
    }

    onProgress(0.9, 'adding ocean');
    await yieldFrame();
    // Shore distances give the sea real depth (clear shallows → deep blue) and the foam
    // line. Skipped only on very-low, which keeps the flat single-colour sea.
    const shoreMap = tier !== 'very-low' ? bakeShoreMap(grid, SEA_LAYER) : null;
    const sphereWater = createSphereWater(tier, shoreMap, shoreFoam);
    scene.add(sphereWater.mesh);

    const group = new THREE.Group();
    group.add(streaming.meshes.solid, streaming.meshes.glow, streaming.meshes.edges);
    scene.add(group);

    const animated = [veg];

    onProgress(1.0, 'ready');
    return { grid, streaming, group, spawnDir, animated, sphereWater, landmarks, wet, veg };
}
