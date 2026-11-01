// src/player/sphere-dog.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV, columnDir } from '../core/geoutil';
import { createSpherePathNavigator, SpherePathNavigator } from './sphere-pathfinding';

const DOG_SPEED = 8; // m/s
const FOLLOW_DIST = 0.3; // radians (~17 degrees) before dog starts following

export interface SphereDog {
  mesh: THREE.Object3D;
  update(dt: number, playerDir: THREE.Vector3): void;
  dispose(): void;
}

export function createSphereDog(grid: SphereVoxelGrid, scene: THREE.Scene): SphereDog {
  // ponytail: placeholder box mesh; swap for GLTF when art is ready
  const geo = new THREE.BoxGeometry(0.6, 0.8, 1.0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  const startDir = new THREE.Vector3(1, 0, 0);
  const { face: sf, u: su, v: sv } = dirToFaceUV(startDir, FACE_RES);
  let face = sf, u = su, v = sv;
  const dir = new THREE.Vector3();
  columnDir(face, u, v, FACE_RES, dir);

  let pathNav: SpherePathNavigator = createSpherePathNavigator(grid, face, u, v);
  const _scratch = new THREE.Vector3();

  function update(dt: number, playerDir: THREE.Vector3) {
    const angDist = Math.acos(Math.max(-1, Math.min(1, dir.dot(playerDir))));
    if (angDist > FOLLOW_DIST) {
      const { face: pf, u: pu, v: pv } = dirToFaceUV(playerDir, FACE_RES);
      pathNav.setGoal(pf, pu, pv);
    }

    pathNav.step();

    const path = pathNav.path;
    if (path && path.length > 1) {
      const next = path[1];
      columnDir(next.face, next.u, next.v, FACE_RES, _scratch);
      const stepAngle = (DOG_SPEED * dt) / PLANET_RADIUS;
      const axis = new THREE.Vector3().crossVectors(dir, _scratch).normalize();
      if (axis.lengthSq() > 0.0001) {
        dir.applyAxisAngle(axis, Math.min(stepAngle, dir.angleTo(_scratch))).normalize();
      }
      if (dir.angleTo(_scratch) < 0.02) {
        face = next.face; u = next.u; v = next.v;
        if (path.length > 1) path.shift();
      }
    }

    const r = grid.surfaceRadius(face, u, v) + 0.3;
    mesh.position.copy(dir).multiplyScalar(r);
    mesh.up.copy(dir);
    if (path && path.length > 1) {
      columnDir(path[1].face, path[1].u, path[1].v, FACE_RES, _scratch);
      const lookTarget = _scratch.clone().multiplyScalar(r + 0.5).add(dir.clone().multiplyScalar(r));
      mesh.lookAt(lookTarget);
    }
  }

  return {
    mesh,
    update,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
