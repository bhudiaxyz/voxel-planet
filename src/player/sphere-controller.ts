// src/player/sphere-controller.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';

const GRAVITY = 28;
const JUMP_VEL = 10.5;
const WALK_SPEED = 9;
const SPRINT_SPEED = 20;
const EYE_HEIGHT = 1.75;

const _scratchStep = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();

export class SphereController {
  dir = new THREE.Vector3(1, 0, 0);  // unit direction from planet centre
  groundRadius: number;              // current distance from centre
  verticalVelocity = 0;
  isGrounded = false;
  speed = 0;  // 0..1 horizontal speed fraction for camera bob
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
    wishDir: THREE.Vector3,  // unit vector in world space (from FPCamera.getWish)
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

    // Horizontal movement: arc step on sphere surface
    if (wishDir.lengthSq() > 0.001) {
      // Project wishDir onto the tangent plane at this.dir
      _scratchStep.copy(wishDir).addScaledVector(this.dir, -wishDir.dot(this.dir)).normalize();
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
      _scratchStep.multiplyScalar(speed * dt / this.groundRadius);
      this.dir.add(_scratchStep).normalize();
      this.speed = speed / SPRINT_SPEED;
    } else {
      this.speed = Math.max(0, this.speed - dt * 4);
    }
  }

  /** Forward direction in tangent plane at dir (for camera reference). */
  forwardInPlane(cameraForward: THREE.Vector3): THREE.Vector3 {
    return _scratchStep.copy(cameraForward)
      .addScaledVector(this.dir, -cameraForward.dot(this.dir))
      .normalize();
  }
}
