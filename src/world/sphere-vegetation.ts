import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { columnDir } from '../core/geoutil';
import { BLOCK_BY_ID } from '../core/palette';
import { DetailField, createDetailChunk } from './veg-detail';
import { makeRng } from '../core/rng';

const SEA_LAYER = 11;
const TREE_P = 0.04;
const GRASS_P = 0.35;
const VEG_CHUNK = 32;

const _dir = new THREE.Vector3();

export function scatterSphereVegetation(
    grid: SphereVoxelGrid,
    rng: ReturnType<typeof makeRng>,
    scene: THREE.Scene,
): { animated: { update: (dt: number) => void }[] } {
    const animated: { update: (dt: number) => void }[] = [];

    for (let face = 0; face < 6; face++) {
        for (let cv = 0; cv < FACE_RES; cv += VEG_CHUNK) {
            for (let cu = 0; cu < FACE_RES; cu += VEG_CHUNK) {
                const field = new DetailField();

                for (let v = cv; v < Math.min(cv + VEG_CHUNK, FACE_RES); v++) {
                    for (let u = cu; u < Math.min(cu + VEG_CHUNK, FACE_RES); u++) {
                        const layer = grid.columnTop(face, u, v);
                        if (layer <= SEA_LAYER) continue;

                        const id = grid.get(face, u, v, layer);
                        const block = BLOCK_BY_ID[id] as any;
                        if (!block?.grassCap) continue;

                        columnDir(face, u, v, FACE_RES, _dir);
                        const r = PLANET_RADIUS + layer + 1;
                        const pos: [number, number, number] = [_dir.x * r, _dir.y * r, _dir.z * r];
                        const up: [number, number, number] = [_dir.x, _dir.y, _dir.z];

                        field.setFrame(up);

                        const roll = rng();
                        if (roll < TREE_P) addSphereTree(field, pos, rng, block);
                        else if (roll < TREE_P + GRASS_P) addSphereGrass(field, pos, rng, block);
                    }
                }

                if (field.empty) continue;

                // Chunk origin: centre column of this sub-grid
                const cu2 = Math.min(cu + Math.floor(VEG_CHUNK / 2), FACE_RES - 1);
                const cv2 = Math.min(cv + Math.floor(VEG_CHUNK / 2), FACE_RES - 1);
                columnDir(face, cu2, cv2, FACE_RES, _dir);
                const sl = Math.max(0, grid.columnTop(face, cu2, cv2));
                const cr = PLANET_RADIUS + sl + 1;
                const origin = new THREE.Vector3(_dir.x * cr, _dir.y * cr, _dir.z * cr);

                // Positions are already in world-space XYZ; pass zero origin to avoid double-offset
                const chunk = createDetailChunk(field, new THREE.Vector3(), { sphereMode: true });
                scene.add(chunk.object3d);
                animated.push(chunk);
            }
        }
    }

    return { animated };
}

// Colours mirror the grass-tuft section of voxel-world/vegetation.ts
// (buildGroundDetail): dark = topTint * 0.86, lite = top * 1.08
function addSphereGrass(
    field: DetailField,
    pos: [number, number, number],
    rng: ReturnType<typeof makeRng>,
    block: any,
) {
    const base = (block.topTint ?? block.top) as THREE.Color;
    const lite = block.top as THREE.Color;
    const dark = base.clone().multiplyScalar(0.86);
    const light = lite.clone().multiplyScalar(1.08);

    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
        field.tuft(
            pos[0] + rng.range(-0.32, 0.32),
            pos[1],
            pos[2] + rng.range(-0.32, 0.32),
            rng.range(0.16, 0.3),
            rng.range(0.26, 0.52),
            dark,
            light,
            rng() * 6.28,
            rng.range(-0.14, 0.14),
            rng.range(-0.14, 0.14),
        );
    }
}

// Simple cross-quad foliage clump — taller, wider tufts to suggest a small tree
function addSphereTree(field: DetailField, pos: [number, number, number], rng: ReturnType<typeof makeRng>, block: any) {
    const base = (block.topTint ?? block.top) as THREE.Color;
    const dark = base.clone().multiplyScalar(0.86);
    const light = (block.top as THREE.Color).clone().multiplyScalar(1.08);

    // Short stump tufts at ground level
    field.tuft(
        pos[0],
        pos[1],
        pos[2],
        rng.range(0.25, 0.35),
        rng.range(0.6, 0.9),
        dark,
        light,
        rng() * 6.28,
        0,
        0,
        0.15,
    );
    // Wider foliage cross offset upward by ~1 unit
    const h = rng.range(0.9, 1.4);
    field.tuft(
        pos[0] + rng.range(-0.1, 0.1),
        pos[1] + 0.85,
        pos[2] + rng.range(-0.1, 0.1),
        rng.range(0.55, 0.75),
        h,
        dark,
        light,
        rng() * 6.28,
        0,
        0,
        0.4,
    );
}
