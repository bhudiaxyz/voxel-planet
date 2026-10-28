// src/core/geoutil.ts
import * as THREE from 'three';

// Face codes: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
// Derived from planet-explorer/src/core/utilgeo.ts basisFromCode
export function basisFromCode(
  code: number,
  normal: THREE.Vector3,
  tangentU: THREE.Vector3,
  tangentV: THREE.Vector3,
) {
  const f = (code / 2) | 0;
  normal.set(0, 0, 0).setComponent(f, code % 2 === 0 ? 1 : -1);
  if (f === 1) tangentU.set(1, 0, 0);
  else tangentU.set(0, 1, 0);
  tangentV.crossVectors(normal, tangentU);
}

const _gn = new THREE.Vector3(), _gtu = new THREE.Vector3(), _gtv = new THREE.Vector3();

/** Unit direction of the centre of column (u, v) on cube face `code`. */
export function columnDir(
  code: number,
  u: number,
  v: number,
  faceRes: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  basisFromCode(code, _gn, _gtu, _gtv);
  return target
    .copy(_gn)
    .addScaledVector(_gtu, (2 * (u + 0.5)) / faceRes - 1)
    .addScaledVector(_gtv, (2 * (v + 0.5)) / faceRes - 1)
    .normalize();
}

/**
 * Maps a unit direction to the face whose dominant axis it points along,
 * returning integer column indices u, v ∈ [0, faceRes).
 */
export function dirToFaceUV(
  dir: THREE.Vector3,
  faceRes: number,
): { face: number; u: number; v: number } {
  const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
  let axis = 0;
  if (ay > ax) axis = 1;
  if (az > Math.max(ax, ay)) axis = 2;
  const comp = axis === 0 ? dir.x : axis === 1 ? dir.y : dir.z;
  const face = axis * 2 + (comp < 0 ? 1 : 0);
  basisFromCode(face, _gn, _gtu, _gtv);
  const dn = dir.dot(_gn);
  const u = Math.floor(((dir.dot(_gtu) / dn + 1) * faceRes) / 2);
  const v = Math.floor(((dir.dot(_gtv) / dn + 1) * faceRes) / 2);
  return {
    face,
    u: Math.max(0, Math.min(faceRes - 1, u)),
    v: Math.max(0, Math.min(faceRes - 1, v)),
  };
}
