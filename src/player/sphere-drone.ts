// src/player/sphere-drone.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';

const DRONE_SPEED = 40;       // m/s horizontal
const DRONE_VSPEED = 20;      // m/s vertical
const MIN_CLEARANCE = 1.5;    // m above surface
const ENTER_LIFT = 8;         // m above ground on enter

export interface DroneInput {
  yaw: number;      // radians/s
  forward: number;  // -1..1
  strafe: number;   // -1..1
  vertical: number; // -1..1
  land: boolean;
}

export interface SphereDroneMode {
  active: boolean;
  landing: boolean;
  altitude: number;
  dir: THREE.Vector3;
  enter(playerDir: THREE.Vector3, groundRadius: number): void;
  exit(): void;
  update(dt: number, input: DroneInput, grid: SphereVoxelGrid, camera: THREE.Camera): void;
}

export function createSphereDroneMode(): SphereDroneMode {
  const dir     = new THREE.Vector3(0, 1, 0); // radial outward (drone "up")
  const heading = new THREE.Vector3(0, 0, 1); // forward in tangent plane
  const _right  = new THREE.Vector3();
  const _tmp    = new THREE.Vector3();

  let altitude = ENTER_LIFT;
  let active   = false;
  let landing  = false;

  function surfaceRadius(grid: SphereVoxelGrid): number {
    const { face, u, v } = dirToFaceUV(dir, FACE_RES);
    return grid.surfaceRadius(face, u, v);
  }

  /** Keep heading perpendicular to dir (renormalise after dir arcs). */
  function reorthogonalise(): void {
    heading.addScaledVector(dir, -heading.dot(dir)).normalize();
  }

  return {
    get active()   { return active; },
    get landing()  { return landing; },
    get altitude() { return altitude; },
    get dir()      { return dir; },

    enter(playerDir: THREE.Vector3, groundRadius: number) {
      dir.copy(playerDir).normalize();
      altitude = groundRadius - PLANET_RADIUS + ENTER_LIFT;
      // Pick an initial heading perpendicular to dir
      _tmp.set(0, 1, 0);
      if (Math.abs(dir.dot(_tmp)) > 0.9) _tmp.set(1, 0, 0);
      heading.crossVectors(dir, _tmp).normalize();
      active  = true;
      landing = false;
    },

    exit() {
      active  = false;
      landing = false;
    },

    update(dt: number, input: DroneInput, grid: SphereVoxelGrid, camera: THREE.Camera) {
      if (!active) return;

      // Mouse yaw: rotate heading around dir (no dt — mouse delta is per-frame)
      if (Math.abs(input.yaw) > 0.0001) {
        heading.applyAxisAngle(dir, -input.yaw);
        reorthogonalise();
      }

      // Horizontal movement: arc over sphere in heading / right directions
      _right.crossVectors(dir, heading).normalize();
      if (Math.abs(input.forward) > 0.001 || Math.abs(input.strafe) > 0.001) {
        _tmp.set(0, 0, 0)
          .addScaledVector(heading, input.forward)
          .addScaledVector(_right,  input.strafe);
        const len = _tmp.length();
        if (len > 0.001) {
          _tmp.divideScalar(len);
          const stepAngle = (DRONE_SPEED * dt) / (PLANET_RADIUS + altitude);
          const axis = new THREE.Vector3().crossVectors(dir, _tmp).normalize();
          dir.applyAxisAngle(axis, stepAngle).normalize();
          reorthogonalise();
        }
      }

      // Vertical
      const surfR   = surfaceRadius(grid);
      const maxAlt  = PLANET_RADIUS + SHELL_DEPTH + 50;

      if (input.land || landing) {
        landing  = true;
        altitude = THREE.MathUtils.lerp(altitude, surfR - PLANET_RADIUS + 0.5, dt * 3);
        if (altitude <= surfR - PLANET_RADIUS + 0.6) { active = false; landing = false; }
      } else {
        altitude += input.vertical * DRONE_VSPEED * dt;
        altitude  = Math.max(surfR - PLANET_RADIUS + MIN_CLEARANCE,
                             Math.min(maxAlt - PLANET_RADIUS, altitude));
      }

      // Camera: position radially, look forward along heading, up = dir
      camera.up.copy(dir);
      camera.position.copy(dir).multiplyScalar(PLANET_RADIUS + altitude);
      camera.lookAt(camera.position.clone().add(heading));
    },
  };
}
