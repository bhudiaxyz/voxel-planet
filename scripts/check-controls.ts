/**
 * Invariant behind WASD + joystick: the movement basis must match what the
 * camera actually shows — fwd = view direction, rgt = screen-right.
 * Run: npm run check
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
