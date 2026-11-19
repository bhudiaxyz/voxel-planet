/**
 * SphereFlyMode — free flight over the sphere: the player controls movement and direction.
 *
 * Purpose
 *   A manual flying mode (the third stop in the F cycle) where the camera goes wherever the
 *   player looks, while the terrain floor stops it clipping into the ground.
 *
 * Operations
 *   - State: `dir` (unit direction from centre), `altitude` above PLANET_RADIUS, `smoothFloor`.
 *   - Horizontal: wishDir is projected into the tangent plane and `dir` arcs by
 *     speed*dt/(PLANET_RADIUS+altitude); FLY_SPEED, FLY_SPRINT with shift.
 *   - Vertical: altitude += vertDelta*dt (m/s, from the Space/C/scroll drain).
 *   - Floor: terrain top + FLOOR_CLEARANCE, but it may only fall at FLOOR_DROP_RATE so cliffs
 *     do not snap the camera down.
 *   - Auto-climb: probes LOOK_AHEAD metres along wishDir; if the terrain there is higher, pushes
 *     the altitude up at up to AUTO_CLIMB_RATE so it rises over obstacles before reaching them.
 *   - update() sets camera.up and camera.position only; orientation (look, roll) is left to
 *     FPCamera.
 *
 * Usage
 *   Created by src/main.ts (createSphereFlyMode). main calls enter(dir, radius) / exit() and
 *   update(dt, wishDir, vertDelta, sprint, grid, camera) each frame while active; `dir` and
 *   `groundRadius` (PLANET_RADIUS + altitude) are read back for the dog and landing. Pause is
 *   input-only: wish and vertical input go to zero, the mode still updates.
 *
 * See also: drone.ts, controller.ts, src/render/fp-camera.ts; DESIGN.md "14. Player".
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/voxel';
import { dirToFaceUV } from '../core/geoutil';

const FLY_SPEED = 24; // m/s
const FLY_SPRINT = 63; // m/s with Shift
const FLOOR_CLEARANCE = 1.75; // m above terrain
const FLOOR_DROP_RATE = 8.0; // max m/s floor can descend (cliff smoothing)
const AUTO_CLIMB_RATE = 14; // m/s upward push when obstacle is ahead
const LOOK_AHEAD = 6; // arc-metres to probe for obstacles

export interface SphereFlyMode {
    readonly active: boolean;
    enter(playerDir: THREE.Vector3, groundRadius: number): void;
    exit(): void;
    update(
        dt: number,
        wishDir: THREE.Vector3, // from FPCamera.getWishSphere
        vertDelta: number, // scaled m/s from drainDroneAltDelta
        sprint: boolean,
        grid: SphereVoxelGrid,
        camera: THREE.Camera,
    ): void;
    readonly dir: THREE.Vector3;
    readonly groundRadius: number;
}

export function createSphereFlyMode(): SphereFlyMode {
    const dir = new THREE.Vector3(0, 1, 0);
    const _step = new THREE.Vector3();
    const _axis = new THREE.Vector3();

    let active = false;
    let altitude = 0; // above PLANET_RADIUS
    let smoothFloor = 0;

    function surfR(grid: SphereVoxelGrid): number {
        const { face, u, v } = dirToFaceUV(dir, FACE_RES);
        const top = grid.columnTop(face, u, v);
        return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
    }

    return {
        get active() {
            return active;
        },
        get dir() {
            return dir;
        },
        get groundRadius() {
            return PLANET_RADIUS + altitude;
        },

        enter(playerDir, groundRadius) {
            dir.copy(playerDir).normalize();
            altitude = groundRadius - PLANET_RADIUS;
            smoothFloor = altitude; // will be corrected on first update
            active = true;
        },

        exit() {
            active = false;
        },

        update(dt, wishDir, vertDelta, sprint, grid, camera) {
            if (!active) return;

            const speed = sprint ? FLY_SPRINT : FLY_SPEED;

            // Horizontal movement: arc on sphere surface in wishDir direction
            if (wishDir.lengthSq() > 0.001) {
                _step.copy(wishDir).addScaledVector(dir, -wishDir.dot(dir)).normalize();
                const stepAngle = (speed * dt) / (PLANET_RADIUS + altitude);
                _axis.crossVectors(dir, _step).normalize();
                dir.applyAxisAngle(_axis, stepAngle).normalize();
            }

            // Vertical
            altitude += vertDelta * dt;

            // Terrain floor with smoothed descent
            const rawFloor = surfR(grid) - PLANET_RADIUS + FLOOR_CLEARANCE;
            const maxDrop = FLOOR_DROP_RATE * dt;
            smoothFloor = Math.max(rawFloor, smoothFloor - maxDrop);
            if (altitude < smoothFloor) altitude = smoothFloor;

            // Auto-climb: look ahead in wishDir, push up if terrain is higher
            if (wishDir.lengthSq() > 0.001) {
                _step.copy(wishDir).addScaledVector(dir, -wishDir.dot(dir)).normalize();
                const probeAngle = LOOK_AHEAD / (PLANET_RADIUS + altitude);
                _axis.crossVectors(dir, _step).normalize();
                const probeDir = dir.clone().applyAxisAngle(_axis, probeAngle).normalize();
                const { face: pf, u: pu, v: pv } = dirToFaceUV(probeDir, FACE_RES);
                const pTop = grid.columnTop(pf, pu, pv);
                const aheadFloor = (pTop < 0 ? 0 : pTop + 1) + FLOOR_CLEARANCE;
                const needed = aheadFloor - altitude;
                if (needed > 0) altitude += Math.min(needed, AUTO_CLIMB_RATE * dt);
            }

            // Position camera
            camera.up.copy(dir);
            camera.position.copy(dir).multiplyScalar(PLANET_RADIUS + altitude);
        },
    };
}
