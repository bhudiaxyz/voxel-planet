// src/player/sphere-dog.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';

const HEEL_DIST = 3.0 / PLANET_RADIUS; // radians — stops this close to the player…
const SAME_LEVEL = 0.6; // …but only if its ground is within this of the player's
const RUN_DIST = 10 / PLANET_RADIUS; // beyond this it runs rather than trots
const TELEPORT_DIST = 45 / PLANET_RADIUS; // beyond this (after fly/drone, or outrun) it reappears at heel
const TROT_SPEED = 8; // m/s
const RUN_SPEED = 22; // m/s — faster than the player's sprint (20) so it can catch up
/** Where it reappears: ahead of the camera and a little to one side, so it's in view. */
const APPEAR_AHEAD = 4.5;
const APPEAR_SIDE = 1.6;
/** How fast the drawn height follows terrace steps (the terrain is 2-layer terraces). */
const STEP_EASE = 12;

export interface SphereDog {
    mesh: THREE.Object3D;
    sitting: boolean;
    toggleSit(): void;
    /** @param viewFwd camera forward in world space — used to reappear in view. */
    update(dt: number, playerDir: THREE.Vector3, viewFwd?: THREE.Vector3): void;
    dispose(): void;
}

/**
 * A small voxel dog. Built from a handful of boxes in a pale coat so it reads
 * as an animal against soil and grass — a single brown box read as a stray
 * terrain block. Origin is at the feet; +Z is the nose.
 */
function buildDogModel() {
    const coat = new THREE.MeshLambertMaterial({ color: 0xe8c9a0 });
    const patch = new THREE.MeshLambertMaterial({ color: 0x8a5a3c });
    const nose = new THREE.MeshLambertMaterial({ color: 0x2a1d18 });
    const root = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = root) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        parent.add(mesh);
        parts.push(mesh);
        return mesh;
    };
    const body = add(0.5, 0.42, 1.0, 0, 0.62, 0, coat);
    add(0.52, 0.2, 0.42, 0, 0.78, -0.1, patch); // saddle patch
    const head = new THREE.Group();
    head.position.set(0, 0.92, 0.55);
    root.add(head);
    add(0.42, 0.38, 0.4, 0, 0.0, 0.0, coat, head);
    add(0.24, 0.2, 0.22, 0, -0.06, 0.28, coat, head); // muzzle
    add(0.1, 0.08, 0.06, 0, -0.01, 0.4, nose, head);
    add(0.1, 0.22, 0.08, -0.16, 0.24, -0.06, patch, head); // ears
    add(0.1, 0.22, 0.08, 0.16, 0.24, -0.06, patch, head);
    const legs: THREE.Mesh[] = [];
    for (const [x, z] of [[-0.16, 0.36], [0.16, 0.36], [-0.16, -0.36], [0.16, -0.36]]) {
        const leg = add(0.14, 0.44, 0.14, x, 0.22, z, coat);
        legs.push(leg);
    }
    const tail = add(0.09, 0.09, 0.42, 0, 0.82, -0.62, coat);
    tail.rotation.x = -0.7;
    return { root, body, head, legs, tail, parts, materials: [coat, patch, nose] };
}

/**
 * The dog walks the great circle straight to the player. The planet is a
 * heightmap shell where every column is passable, so pathfinding added nothing
 * but a search that never finished in time.
 */
export function createSphereDog(grid: SphereVoxelGrid, scene: THREE.Scene, spawnDir?: THREE.Vector3): SphereDog {
    const model = buildDogModel();
    const mesh = model.root;
    mesh.name = 'dog';
    scene.add(mesh);

    const dir = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _side = new THREE.Vector3();
    const _p = new THREE.Vector3();
    let sitting = false;
    let drawnR = 0;
    let gait = 0; // walk-cycle phase
    let moving = 0; // 0..1 eased "is moving" for animation
    let placed = false;

    const surfaceAt = (d: THREE.Vector3) => {
        const { face, u, v } = dirToFaceUV(d, FACE_RES);
        return grid.surfaceRadius(face, u, v);
    };

    /**
     * Put the dog in front of the player, slightly to one side. Falls back to a
     * fixed tangent when no view direction is known (very first frame).
     */
    function appear(playerDir: THREE.Vector3, viewFwd?: THREE.Vector3) {
        if (viewFwd) _fwd.copy(viewFwd).addScaledVector(playerDir, -viewFwd.dot(playerDir));
        if (!viewFwd || _fwd.lengthSq() < 1e-6) _fwd.set(Math.abs(playerDir.y) > 0.9 ? 1 : 0, Math.abs(playerDir.y) > 0.9 ? 0 : 1, 0).addScaledVector(playerDir, -playerDir.y);
        _fwd.normalize();
        _side.crossVectors(_fwd, playerDir).normalize(); // camera right
        const R = surfaceAt(playerDir);
        _p.copy(playerDir).multiplyScalar(R).addScaledVector(_fwd, APPEAR_AHEAD).addScaledVector(_side, APPEAR_SIDE);
        dir.copy(_p).normalize();
        drawnR = surfaceAt(dir);
        placed = true;
    }

    // Placed on the first update, once the camera direction is known, so the
    // dog starts in view. Until then it sits at the spawn column.
    if (spawnDir) dir.copy(spawnDir).normalize();

    function update(dt: number, playerDir: THREE.Vector3, viewFwd?: THREE.Vector3) {
        if (!placed) appear(playerDir, viewFwd);
        const ang = dir.angleTo(playerDir);
        const playerGround = surfaceAt(playerDir);
        let step = 0;

        if (!sitting) {
            if (ang > TELEPORT_DIST) appear(playerDir, viewFwd);
            else {
                // Heel only on the player's own level; a dog parked on the terrace
                // below a ledge is hidden by the wall from where the player stands.
                const level = Math.abs(surfaceAt(dir) - playerGround) <= SAME_LEVEL;
                const stopAt = level ? HEEL_DIST : 0.4 / PLANET_RADIUS;
                if (ang > stopAt) {
                    const speed = ang > RUN_DIST ? RUN_SPEED : TROT_SPEED;
                    _axis.crossVectors(dir, playerDir).normalize();
                    step = Math.min((speed * dt) / PLANET_RADIUS, ang - stopAt);
                    if (_axis.lengthSq() > 0.5) dir.applyAxisAngle(_axis, step).normalize();
                }
            }
        }

        // Unloaded/empty columns report the bare planet radius; borrow the player's ground then.
        let r = surfaceAt(dir);
        if (r <= PLANET_RADIUS) r = playerGround;
        // Ease the drawn height over terrace steps instead of popping a whole layer.
        drawnR = Math.abs(r - drawnR) > 4 ? r : drawnR + (r - drawnR) * (1 - Math.exp(-STEP_EASE * dt));
        mesh.position.copy(dir).multiplyScalar(drawnR);

        // Stand upright on the sphere and face the player (both while following and sitting).
        mesh.up.copy(dir);
        _look.copy(playerDir).addScaledVector(dir, -playerDir.dot(dir));
        if (_look.lengthSq() > 1e-10) mesh.lookAt(_look.normalize().add(mesh.position));

        // Animation: trot cycle while moving, tail wag always, sit pose when told.
        const speedNow = dt > 0 ? (step * PLANET_RADIUS) / dt : 0;
        moving += ((speedNow > 0.5 ? 1 : 0) - moving) * (1 - Math.exp(-10 * dt));
        gait += dt * (6 + speedNow * 0.9);
        const swing = Math.sin(gait) * 0.6 * moving;
        model.legs[0].rotation.x = swing;
        model.legs[3].rotation.x = swing;
        model.legs[1].rotation.x = -swing;
        model.legs[2].rotation.x = -swing;
        model.tail.rotation.y = Math.sin(gait * 2.2) * 0.6;
        const sitT = sitting ? 1 : 0;
        model.body.rotation.x = -0.45 * sitT;
        model.body.position.y = 0.62 - 0.12 * sitT;
        model.legs[2].position.y = model.legs[3].position.y = 0.22 - 0.1 * sitT;
        model.head.position.y = 0.92 + Math.abs(Math.sin(gait)) * 0.04 * moving + 0.06 * sitT;

        // main.ts turns off scene-wide matrix auto-update, so moving objects must refresh their own.
        mesh.updateMatrixWorld(true);
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
            for (const p of model.parts) p.geometry.dispose();
            for (const m of model.materials) m.dispose();
        },
    };
}
