/**
 * World assembly — runs the generators in order and turns the finished voxel
 * grid into renderable meshes.
 */

import * as THREE from 'three';
import { createSphereChunkStreamer } from '../core/voxel';
import { makeRng } from '../core/rng';
import { SphereVoxelGrid, FACE_RES } from '../core/voxel';
import { generateSphereTerrain } from './terrain';
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

    onProgress(0.73, 'building terrain meshes');
    const streaming = createSphereChunkStreamer(grid, { loadRadius: streamRadius });

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
    const veg = createSphereVegetation(grid, seed ^ 0x3b1e7f, scene, grassDensity, 0.1, groundDetail);
    streaming.setListener(veg);
    // Fill the whole view before the first frame; streaming after this is budgeted per frame.
    streaming.update(spawnDir, Infinity);

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
    return { grid, streaming, group, spawnDir, animated, sphereWater, landmarks };
}
