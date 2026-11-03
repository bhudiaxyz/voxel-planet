// src/player/sphere-dog.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV, columnDir } from '../core/geoutil';
import { createSpherePathNavigator, SpherePathNavigator } from './sphere-pathfinding';

const DOG_SPEED = 8; // m/s
const FOLLOW_DIST = 0.05; // radians (~3 degrees, ~17 units) before dog starts following

export interface SphereDog {
  mesh: THREE.Object3D;
  sitting: boolean;
  toggleSit(): void;
  update(dt: number, playerDir: THREE.Vector3): void;
  dispose(): void;
}

export function createSphereDog(grid: SphereVoxelGrid, scene: THREE.Scene, spawnDir?: THREE.Vector3): SphereDog {
  // ponytail: placeholder box mesh; swap for GLTF when art is ready
  const geo = new THREE.BoxGeometry(0.6, 0.8, 1.0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  const baseDir = spawnDir ? spawnDir.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const { face: sf, u: su, v: sv } = dirToFaceUV(baseDir, FACE_RES);
  // Offset 4 columns sideways so dog is visible beside the player at spawn
  let face = sf, u = Math.min(su + 4, FACE_RES - 1), v = sv;
  const dir = new THREE.Vector3();
  columnDir(face, u, v, FACE_RES, dir);

  let pathNav: SpherePathNavigator = createSpherePathNavigator(grid, face, u, v);
  const _scratch = new THREE.Vector3();
  const _lookTarget = new THREE.Vector3();
  let sitting = false;


  /** Orient mesh upright on sphere surface, facing lookFwd (a world-space direction). */
  function orientMesh(r: number, lookFwd: THREE.Vector3) {
    mesh.up.copy(dir);
    // Project lookFwd onto the tangent plane at dir
    _scratch.copy(lookFwd).addScaledVector(dir, -lookFwd.dot(dir)).normalize();
    if (_scratch.lengthSq() > 0.001) {
      _lookTarget.copy(mesh.position).add(_scratch);
      mesh.lookAt(_lookTarget);
    }
  }

  function update(dt: number, playerDir: THREE.Vector3) {
    // Use player surface as fallback if dog column is unloaded
    const { face: pf, u: pu, v: pv } = dirToFaceUV(playerDir, FACE_RES);
    const baseR = grid.surfaceRadius(face, u, v);
    const playerR = grid.surfaceRadius(pf, pu, pv);
    const r = (baseR > PLANET_RADIUS ? baseR : playerR) + 0.5;
    mesh.position.copy(dir).multiplyScalar(r);

    if (sitting) {
      // Face the player while sitting
      orientMesh(r, playerDir);
      return;
    }

    const angDist = Math.acos(Math.max(-1, Math.min(1, dir.dot(playerDir))));
    if (angDist > FOLLOW_DIST) {
      const { face: pf, u: pu, v: pv } = dirToFaceUV(playerDir, FACE_RES);
      pathNav.setStart(face, u, v);
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
        pathNav.setStart(face, u, v);
        if (path.length > 1) path.shift();
      }
      // Face movement direction
      orientMesh(r, _scratch);
    } else {
      // Idle — face the player
      orientMesh(r, playerDir);
    }
  }

  return {
    mesh,
    get sitting() { return sitting; },
    toggleSit() { sitting = !sitting; },
    update,
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
