/**
 * SphereDroneMode — cinematic, always-forward drone flight with terrain-following altitude.
 *
 * Purpose
 *   An aerial camera mode: the drone cruises on its own, the player steers and sets hover height.
 *   It drives the camera directly while active.
 *
 * Operations
 *   - State: `dir` (radial up), `heading` (tangent forward, re-orthogonalised after every arc),
 *     `altitude` above PLANET_RADIUS, `hoverHeight`, `active`, `landing`.
 *   - enter(): starts ENTER_LIFT above the player's ground with a heading perpendicular to dir.
 *   - Steering: yaw from mouse/touch plus A/D (yawKey); pitch and roll only affect the view
 *     (flight stays level). Forward is automatic: speed DRONE_SPEED, DRONE_SPRINT_SPEED with
 *     shift, x2 on W, stopped on S.
 *   - Altitude: a P-controller (TERRAIN_FOLLOW_GAIN, capped at DRONE_VSPEED/2) pulls toward the
 *     terrain top + hoverHeight; input.vertical (Space/C/scroll, m/s) raises or lowers
 *     hoverHeight (floor MIN_CLEARANCE). Altitude is clamped above terrain + MIN_CLEARANCE and
 *     below the shell ceiling.
 *   - Landing (L or beginLanding): altitude lerps to the surface; at touchdown the drone
 *     deactivates itself and main.ts hands control back to the walker.
 *   - update() positions camera.up/position/lookAt (heading tilted by pitch, then roll).
 *
 * Usage
 *   Created by src/main.ts (createSphereDroneMode); F cycles walk -> drone -> fly. main calls
 *   enter/exit/beginLanding and update(dt, DroneInput, grid, camera) each frame; HUD shows
 *   `altitude`. Pause is input-only by design: the paused FPCamera yields zero input, but the
 *   drone keeps cruising and updating.
 *
 * See also: fly.ts, controller.ts, src/ui/hud.ts; DESIGN.md "14. Player".
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, SHELL_DEPTH } from '../core/voxel';
import { dirToFaceUV } from '../core/geoutil';

const DRONE_SPEED = 18; // m/s horizontal cruise
const DRONE_SPRINT_SPEED = 45; // m/s horizontal when shift held
const DRONE_VSPEED = 20; // m/s vertical (manual)
const MIN_CLEARANCE = 1.5; // m above surface
const ENTER_LIFT = 8; // m above ground on enter
const HOVER_HEIGHT = 14; // m above terrain when terrain-following
const TERRAIN_FOLLOW_GAIN = 3; // P-gain: m/s correction per metre of error (capped at DRONE_VSPEED/2)

export interface DroneInput {
    yaw: number; // radians from mouse / touch look (steers heading)
    pitch: number; // radians, view only — flight stays level
    roll: number; // radians, view only (Q/E)
    yawKey: number; // -1..1 from A/D keys
    forward: number; // -1..1
    vertical: number; // m/s hover-height change (drainDroneAltDelta)
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
    let hoverHeight = HOVER_HEIGHT;
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
            hoverHeight = HOVER_HEIGHT;
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
                // Space/C/scroll raise/lower the hover target (input.vertical is m/s), as in planet-explorer.
                hoverHeight = Math.max(MIN_CLEARANCE, hoverHeight + input.vertical * dt);
                const altError = terrainAlt + hoverHeight - altitude;
                const terrainVel = THREE.MathUtils.clamp(
                    altError * TERRAIN_FOLLOW_GAIN,
                    -DRONE_VSPEED * 0.5,
                    DRONE_VSPEED * 0.5,
                );
                altitude += terrainVel * dt;
                altitude = Math.max(terrainAlt + MIN_CLEARANCE, Math.min(maxAlt - PLANET_RADIUS, altitude));
            }

            // Camera: position radially, look along heading tilted by pitch, up = dir, then roll
            camera.up.copy(dir);
            camera.position.copy(dir).multiplyScalar(PLANET_RADIUS + altitude);
            _tmp.copy(heading)
                .multiplyScalar(Math.cos(input.pitch))
                .addScaledVector(dir, Math.sin(input.pitch))
                .add(camera.position);
            camera.lookAt(_tmp);
            if (input.roll) camera.rotateZ(input.roll);
        },
    };
}
