// src/player/sphere-dog.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';

const HEEL_DIST = 3.5 / PLANET_RADIUS; // radians — stops this close to the player
const RUN_DIST = 10 / PLANET_RADIUS; // beyond this it runs rather than trots
const TELEPORT_DIST = 45 / PLANET_RADIUS; // beyond this (after fly/drone, or outrun) it reappears at heel
const TROT_SPEED = 8; // m/s
const RUN_SPEED = 22; // m/s — faster than the player's sprint (20) so it can catch up
const HALF_HEIGHT = 0.4; // half the box height, so the feet sit on the ground

export interface SphereDog {
    mesh: THREE.Object3D;
    sitting: boolean;
    toggleSit(): void;
    update(dt: number, playerDir: THREE.Vector3): void;
    dispose(): void;
}

/**
 * The dog walks the great circle straight to the player. The planet is a
 * heightmap shell where every column is passable, so pathfinding added nothing
 * but a search that never finished in time.
 */
export function createSphereDog(grid: SphereVoxelGrid, scene: THREE.Scene, spawnDir?: THREE.Vector3): SphereDog {
    // ponytail: placeholder box mesh; swap for GLTF when art is ready
    const geo = new THREE.BoxGeometry(0.6, 0.8, 1.0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);

    const dir = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _look = new THREE.Vector3();
    let sitting = false;

    const surfaceAt = (d: THREE.Vector3) => {
        const { face, u, v } = dirToFaceUV(d, FACE_RES);
        return grid.surfaceRadius(face, u, v);
    };

    /** Put the dog at heel: HEEL_DIST to one side of the player. */
    function placeBeside(playerDir: THREE.Vector3) {
        _axis.set(Math.abs(playerDir.y) > 0.9 ? 1 : 0, Math.abs(playerDir.y) > 0.9 ? 0 : 1, 0);
        _axis.cross(playerDir).normalize();
        dir.copy(playerDir).applyAxisAngle(_axis, HEEL_DIST).normalize();
    }

    placeBeside(spawnDir ? spawnDir.clone().normalize() : new THREE.Vector3(1, 0, 0));

    function update(dt: number, playerDir: THREE.Vector3) {
        const ang = dir.angleTo(playerDir);

        if (!sitting) {
            if (ang > TELEPORT_DIST) placeBeside(playerDir);
            else if (ang > HEEL_DIST) {
                const speed = ang > RUN_DIST ? RUN_SPEED : TROT_SPEED;
                _axis.crossVectors(dir, playerDir).normalize();
                dir.applyAxisAngle(_axis, Math.min((speed * dt) / PLANET_RADIUS, ang - HEEL_DIST)).normalize();
            }
        }

        // Unloaded/empty columns report the bare planet radius; borrow the player's ground then.
        let r = surfaceAt(dir);
        if (r <= PLANET_RADIUS) r = surfaceAt(playerDir);
        mesh.position.copy(dir).multiplyScalar(r + HALF_HEIGHT);

        // Stand upright on the sphere and face the player (both while following and sitting).
        mesh.up.copy(dir);
        _look.copy(playerDir).addScaledVector(dir, -playerDir.dot(dir));
        if (_look.lengthSq() > 1e-10) mesh.lookAt(_look.normalize().add(mesh.position));

        // main.ts turns off scene-wide matrix auto-update, so moving objects must refresh their own.
        mesh.updateMatrixWorld();
    }

    return {
        mesh,
        get sitting() {
            return sitting;
        },
        toggleSit() {
            sitting = !sitting;
        },
        update,
        dispose() {
            scene.remove(mesh);
            geo.dispose();
            mat.dispose();
        },
    };
}
