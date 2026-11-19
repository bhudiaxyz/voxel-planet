/**
 * SphereController — on-foot walking, gravity and jumping on the spherical voxel planet.
 *
 * Purpose
 *   Moves the player's eye over the planet surface. Position is stored as a unit direction from
 *   the planet centre plus a radius, so "up" is always radial and there are no world axes.
 *
 * Operations
 *   - State: `dir` (unit vector from centre), `groundRadius` (eye distance from centre),
 *     `verticalVelocity`, `isGrounded`, `speed` (0..1 fraction of sprint speed, for camera bob).
 *   - update(): looks up the column under `dir` (dirToFaceUV + grid.surfaceRadius), grounded when
 *     the feet are within 0.05 of it; jump sets JUMP_VEL, otherwise GRAVITY pulls down. The eye
 *     is clamped to surface + EYE_HEIGHT.
 *   - Horizontal motion projects wishDir into the tangent plane and arcs `dir` by
 *     speed*dt/groundRadius (WALK_SPEED, or SPRINT_SPEED when sprinting).
 *   - Collision: the destination column and one extra step ahead (a standoff probe, so the near
 *     plane never clips a wall face) must not be higher than the feet + MAX_STEP; otherwise the
 *     move is reverted (`dir` restored, speed 0). Higher terrain is therefore only climbed in
 *     MAX_STEP-sized terraces.
 *   - Scratch vectors are module-level, so `pos` returns a shared vector: copy it if you keep it.
 *
 * Usage
 *   Created by src/main.ts with the spawn direction and the grid. Each frame main passes
 *   FPCamera's wish direction (getWish), the jump edge and sprint flag; `pos` feeds the camera,
 *   `speed` the head bob. `snapToDir(dir, grid)` teleports (landmarks, leaving fly/drone).
 *   Fly and drone modes (fly.ts, drone.ts) replace this controller while active.
 *
 *     controller.update(dt, fpCam.getWish(...), jumpEdge, world.grid, sprint);
 *
 * See also: fly.ts, drone.ts, src/render/fp-camera.ts; DESIGN.md "14. Player".
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/voxel';
import { dirToFaceUV } from '../core/geoutil';

const GRAVITY = 28;
const JUMP_VEL = 10.5;
const WALK_SPEED = 9;
const SPRINT_SPEED = 18;
const EYE_HEIGHT = 1.75;

const MAX_STEP = 1.1; // max terrain step-up in world units

const _scratchStep = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();
const _oldDir = new THREE.Vector3();

export class SphereController {
    dir = new THREE.Vector3(1, 0, 0); // unit direction from planet centre
    groundRadius: number; // current distance from centre
    verticalVelocity = 0;
    isGrounded = false;
    speed = 0; // 0..1 horizontal speed fraction for camera bob
    private _pos = new THREE.Vector3();

    constructor(spawnDir: THREE.Vector3, grid: SphereVoxelGrid) {
        this.dir.copy(spawnDir).normalize();
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        this.groundRadius = grid.surfaceRadius(face, u, v) + EYE_HEIGHT;
    }

    /** World-space position at player eye height. */
    get pos(): THREE.Vector3 {
        return this._pos.copy(this.dir).multiplyScalar(this.groundRadius);
    }

    update(
        dt: number,
        wishDir: THREE.Vector3, // unit vector in world space (from FPCamera.getWish)
        jumpEdge: boolean,
        grid: SphereVoxelGrid,
        sprint = false,
    ) {
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        const surfaceR = grid.surfaceRadius(face, u, v);
        const altitudeAboveSurface = this.groundRadius - EYE_HEIGHT - surfaceR;

        this.isGrounded = altitudeAboveSurface <= 0.05;

        if (this.isGrounded && jumpEdge) {
            this.verticalVelocity = JUMP_VEL;
            this.isGrounded = false;
        }

        if (!this.isGrounded) {
            this.verticalVelocity -= GRAVITY * dt;
        }

        this.groundRadius += this.verticalVelocity * dt;

        // Land on surface
        if (this.groundRadius - EYE_HEIGHT < surfaceR) {
            this.groundRadius = surfaceR + EYE_HEIGHT;
            this.verticalVelocity = Math.max(0, this.verticalVelocity);
        }

        // Horizontal movement: arc step on sphere surface with terrain collision
        if (wishDir.lengthSq() > 0.001) {
            _oldDir.copy(this.dir);
            _scratchStep.copy(wishDir).addScaledVector(this.dir, -wishDir.dot(this.dir)).normalize();
            const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
            _scratchStep.multiplyScalar((speed * dt) / this.groundRadius);
            this.dir.add(_scratchStep).normalize();

            // Destination column check
            const { face: nf, u: nu, v: nv } = dirToFaceUV(this.dir, FACE_RES);
            const newSurfR = grid.surfaceRadius(nf, nu, nv);
            // Standoff probe: one extra step forward — keeps the player a column-width
            // away from vertical wall faces, preventing near-plane clipping.
            const {
                face: af,
                u: au,
                v: av,
            } = dirToFaceUV(_scratchPos.copy(this.dir).add(_scratchStep).normalize(), FACE_RES);
            const aheadSurfR = grid.surfaceRadius(af, au, av);

            if (
                newSurfR > this.groundRadius - EYE_HEIGHT + MAX_STEP ||
                aheadSurfR > this.groundRadius - EYE_HEIGHT + MAX_STEP
            ) {
                this.dir.copy(_oldDir);
                this.speed = 0;
            } else {
                this.speed = speed / SPRINT_SPEED;
            }
        } else {
            this.speed = Math.max(0, this.speed - dt * 4);
        }
    }

    /** Teleport to a new direction, snapping groundRadius to the terrain surface. */
    snapToDir(newDir: THREE.Vector3, grid: SphereVoxelGrid): void {
        this.dir.copy(newDir).normalize();
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        this.groundRadius = grid.surfaceRadius(face, u, v) + EYE_HEIGHT;
        this.verticalVelocity = 0;
    }

    /** Forward direction in tangent plane at dir (for camera reference). */
    forwardInPlane(cameraForward: THREE.Vector3): THREE.Vector3 {
        return _scratchStep.copy(cameraForward).addScaledVector(this.dir, -cameraForward.dot(this.dir)).normalize();
    }
}
