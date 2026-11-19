/**
 * check-controls — the movement basis matches what the camera shows.
 *
 * Purpose
 *   Guards the invariant behind WASD and the touch joystick: tangentBasis(up, yaw) must give
 *   fwd = the camera view direction and rgt = screen-right.
 *
 * Operations
 *   For 500 random up vectors and yaws, sets a camera up exactly as FPCamera.updateSphere does
 *   (pitch 0), looks along fwd, and asserts fwd equals the camera world direction and rgt equals
 *   the screen-right axis (both within 1e-6).
 *
 * Usage
 *   Part of `npm run check`; alone: `node scripts/check-controls.ts`. A failure means movement
 *   keys or the stick no longer match the view (D moves left, W moves sideways, ...).
 *
 * See also: src/render/fp-camera.ts (tangentBasis); DESIGN.md "17. Checks and tooling".
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { tangentBasis } from '../src/render/fp-camera.ts';

const cam = new THREE.PerspectiveCamera();
const screenRight = new THREE.Vector3();
const viewDir = new THREE.Vector3();

for (let i = 0; i < 500; i++) {
    const up = new THREE.Vector3().randomDirection();
    const yaw = (Math.random() - 0.5) * 4 * Math.PI;
    const { fwd, rgt } = tangentBasis(up, yaw);

    // Same camera setup as FPCamera.updateSphere (pitch 0).
    cam.position.copy(up).multiplyScalar(500);
    cam.up.copy(up);
    cam.lookAt(cam.position.clone().add(fwd));
    cam.updateMatrixWorld();

    screenRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
    cam.getWorldDirection(viewDir);
    assert.ok(
        rgt.distanceTo(screenRight) < 1e-6,
        `D/stick-right must be screen-right (up=${up.toArray()}, yaw=${yaw})`,
    );
    assert.ok(fwd.distanceTo(viewDir) < 1e-6, `W/stick-up must be view-forward (up=${up.toArray()}, yaw=${yaw})`);
}
console.log('controls basis ok');
