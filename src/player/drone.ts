// src/player/drone.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { dirToFaceUV } from '../core/geoutil';

const DRONE_SPEED = 18; // m/s horizontal cruise
const DRONE_SPRINT_SPEED = 120; // m/s horizontal when shift held
const DRONE_VSPEED = 20; // m/s vertical (manual)
const MIN_CLEARANCE = 1.5; // m above surface
const ENTER_LIFT = 8; // m above ground on enter
const HOVER_HEIGHT = 14; // m above terrain when terrain-following
const TERRAIN_FOLLOW_GAIN = 3; // P-gain: m/s correction per metre of error (capped at DRONE_VSPEED/2)

export interface DroneInput {
    yaw: number; // radians from mouse
    yawKey: number; // -1..1 from A/D keys
    forward: number; // -1..1
    vertical: number; // -1..1
    land: boolean;
    sprint: boolean;
}

export interface SphereDroneMode {
    active: boolean;
    landing: boolean;
    altitude: number;
    dir: THREE.Vector3;
    heading: THREE.Vector3;
    enter(playerDir: THREE.Vector3, groundRadius: number): void;
    exit(): void;
    beginLanding(): void;
    update(dt: number, input: DroneInput, grid: SphereVoxelGrid, camera: THREE.Camera): void;
}

export function createSphereDroneMode(): SphereDroneMode {
    const dir = new THREE.Vector3(0, 1, 0); // radial outward (drone "up")
    const heading = new THREE.Vector3(0, 0, 1); // forward in tangent plane
    const _right = new THREE.Vector3();
    const _tmp = new THREE.Vector3();

    let altitude = ENTER_LIFT;
    let active = false;
    let landing = false;

    function surfaceRadius(grid: SphereVoxelGrid): number {
        const { face, u, v } = dirToFaceUV(dir, FACE_RES);
        const top = grid.columnTop(face, u, v);
        return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
    }

    /** Keep heading perpendicular to dir (renormalise after dir arcs). */
    function reorthogonalise(): void {
        heading.addScaledVector(dir, -heading.dot(dir)).normalize();
    }

    return {
        get active() {
            return active;
        },
        get landing() {
            return landing;
        },
        get altitude() {
            return altitude;
        },
        get dir() {
            return dir;
        },
        get heading() {
            return heading;
        },
        beginLanding() {
            landing = true;
        },

        enter(playerDir: THREE.Vector3, groundRadius: number) {
            dir.copy(playerDir).normalize();
            altitude = groundRadius - PLANET_RADIUS + ENTER_LIFT;
            // Pick an initial heading perpendicular to dir
            _tmp.set(0, 1, 0);
            if (Math.abs(dir.dot(_tmp)) > 0.9) _tmp.set(1, 0, 0);
            heading.crossVectors(dir, _tmp).normalize();
            active = true;
            landing = false;
        },

        exit() {
            active = false;
            landing = false;
        },

        update(dt: number, input: DroneInput, grid: SphereVoxelGrid, camera: THREE.Camera) {
            if (!active) return;

            // Yaw: mouse delta + A/D keys
            const totalYaw = input.yaw + input.yawKey * dt * 1.2;
            if (Math.abs(totalYaw) > 0.0001) {
                heading.applyAxisAngle(dir, -totalYaw);
                reorthogonalise();
            }

            // Always move forward (cinematic drone) — W/S adjusts speed multiplier
            {
                const baseSpeed = input.sprint ? DRONE_SPRINT_SPEED : DRONE_SPEED;
                const fwdScale =
                    input.forward < -0.001
                        ? 0.0 // S = stop
                        : input.forward > 0.001
                          ? 2.0 // W = double speed
                          : 1.0; // default cruise
                const stepAngle = (baseSpeed * fwdScale * dt) / (PLANET_RADIUS + altitude);
                const axis = new THREE.Vector3().crossVectors(dir, heading).normalize();
                dir.applyAxisAngle(axis, stepAngle).normalize();
                reorthogonalise();
            }

            // Vertical
            const surfR = surfaceRadius(grid);
            const maxAlt = PLANET_RADIUS + SHELL_DEPTH + 50;

            if (input.land || landing) {
                landing = true;
                altitude = THREE.MathUtils.lerp(altitude, surfR - PLANET_RADIUS + 0.5, dt * 3);
                if (altitude <= surfR - PLANET_RADIUS + 0.6) {
                    active = false;
                    landing = false;
                }
            } else {
                // Terrain-following: P-controller pulls toward HOVER_HEIGHT above surface.
                // Manual vertical input adds on top. Result: smooth automatic height
                // maintenance over hills/valleys, with manual override still available.
                const terrainAlt = surfR - PLANET_RADIUS;
                const altError = terrainAlt + HOVER_HEIGHT - altitude;
                const terrainVel = THREE.MathUtils.clamp(
                    altError * TERRAIN_FOLLOW_GAIN,
                    -DRONE_VSPEED * 0.5,
                    DRONE_VSPEED * 0.5,
                );
                altitude += (input.vertical * DRONE_VSPEED + terrainVel) * dt;
                altitude = Math.max(terrainAlt + MIN_CLEARANCE, Math.min(maxAlt - PLANET_RADIUS, altitude));
            }

            // Camera: position radially, look forward along heading, up = dir
            camera.up.copy(dir);
            camera.position.copy(dir).multiplyScalar(PLANET_RADIUS + altitude);
            camera.lookAt(camera.position.clone().add(heading));
        },
    };
}
