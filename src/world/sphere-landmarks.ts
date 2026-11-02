// src/world/sphere-landmarks.ts
// Sphere-native landmark structures — ported geometry from voxel-world/stamps.ts,
// rewritten to use SphereVoxelGrid face-local (face, u, v, layer) coordinates.
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES, SHELL_DEPTH, PLANET_RADIUS } from '../core/sphere-voxel';
import { BLOCKS } from '../core/palette';
import { makeRng } from '../core/rng';
import { columnDir } from '../core/geoutil';

export interface LandmarkRecord {
  kind: 'spire' | 'obelisk' | 'ring' | 'tombs' | 'biosphere' | 'well' | 'arch';
  dir: THREE.Vector3; // world-space unit direction from planet centre
}

const _tmp = new THREE.Vector3();

const SEA_LAYER = 9;
const LANDMARKS_PER_FACE = 2; // ~12 total across the planet
const MIN_SEP = 20;           // minimum u/v distance between two landmarks on same face

// Safe block setter — clips to grid bounds, never overwrites non-air
function put(grid: SphereVoxelGrid, face: number, u: number, v: number, layer: number, id: number) {
  if (u < 1 || v < 1 || u >= FACE_RES - 1 || v >= FACE_RES - 1 || layer < 1 || layer >= SHELL_DEPTH) return;
  if (grid.get(face, u, v, layer) !== 0) return;
  grid.set(face, u, v, layer, id);
}

// Overwrite even if occupied (for base/footing blocks)
function overwrite(grid: SphereVoxelGrid, face: number, u: number, v: number, layer: number, id: number) {
  if (u < 1 || v < 1 || u >= FACE_RES - 1 || v >= FACE_RES - 1 || layer < 1 || layer >= SHELL_DEPTH) return;
  grid.set(face, u, v, layer, id);
}

function top(grid: SphereVoxelGrid, face: number, u: number, v: number): number {
  return grid.columnTop(face, u, v);
}

function isLand(grid: SphereVoxelGrid, face: number, u: number, v: number): boolean {
  return top(grid, face, u, v) > SEA_LAYER + 1;
}

// ── Landmark builders ────────────────────────────────────────────────────────

function twistedSpire(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const baseL = top(grid, face, cu, cv);

  // 3×3 STONE_WARM footing
  for (let dy = 1; dy <= 2; dy++)
    for (let dv = -1; dv <= 1; dv++)
      for (let du = -1; du <= 1; du++)
        overwrite(grid, face, cu + du, cv + dv, baseL + dy, BLOCKS.STONE_WARM.id);

  // Twisted shaft
  const totalH = 14 + rng.int(0, 8);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let ou = 0, ov = 0;
  for (let dy = 3; dy <= totalH; dy++) {
    put(grid, face, cu + ou, cv + ov, baseL + dy, BLOCKS.STONE_PALE.id);
    if (dy % 4 === 2) {
      const [ddu, ddv] = dirs[rng.int(0, 3)];
      ou = Math.max(-2, Math.min(2, ou + ddu));
      ov = Math.max(-2, Math.min(2, ov + ddv));
    }
  }
  put(grid, face, cu + ou, cv + ov, baseL + totalH + 1, BLOCKS.STONE_WARM.id);
}

function obelisk(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const baseL = top(grid, face, cu, cv);

  // 3×3 base
  for (let dy = 1; dy <= 2; dy++)
    for (let dv = -1; dv <= 1; dv++)
      for (let du = -1; du <= 1; du++)
        overwrite(grid, face, cu + du, cv + dv, baseL + dy, BLOCKS.STONE_WARM.id);

  // 1×1 shaft
  const shaftH = 8 + rng.int(0, 5);
  for (let dy = 3; dy <= shaftH; dy++)
    put(grid, face, cu, cv, baseL + dy, BLOCKS.STONE_PALE.id);
  put(grid, face, cu, cv, baseL + shaftH + 1, BLOCKS.STONE_WARM.id);

  // Lantern stones either side
  for (const du of [-3, 3]) {
    const lL = top(grid, face, cu + du, cv);
    put(grid, face, cu + du, cv, lL + 1, BLOCKS.STONE_PALE.id);
  }
}

function monolithRing(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const count = 7 + rng.int(0, 1);
  const ringR = 8 + rng.int(0, 3);

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const su = Math.round(cu + Math.cos(a) * ringR);
    const sv = Math.round(cv + Math.sin(a) * ringR);
    if (!isLand(grid, face, su, sv)) continue;
    const sL = top(grid, face, su, sv);
    const sh = 5 + rng.int(0, 3);
    for (let dy = 1; dy <= sh; dy++)
      put(grid, face, su, sv, sL + dy, BLOCKS.STONE_PALE.id);

    // Lintel connecting every other pair
    if (i % 2 === 0) {
      const a2 = ((i + 1) / count) * Math.PI * 2;
      const eu = Math.round(cu + Math.cos(a2) * ringR);
      const ev = Math.round(cv + Math.sin(a2) * ringR);
      if (!isLand(grid, face, eu, ev)) continue;
      const lintelL = sL + sh + 1;
      const steps = Math.max(Math.abs(eu - su), Math.abs(ev - sv));
      if (steps > 0 && steps < 10) {
        for (let k = 0; k <= steps; k++) {
          const lu = Math.round(su + (eu - su) * k / steps);
          const lv = Math.round(sv + (ev - sv) * k / steps);
          put(grid, face, lu, lv, lintelL, BLOCKS.STONE_PALE.id);
        }
      }
    }
  }
}

function tombstoneField(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const count = 14 + rng.int(0, 8);
  const fieldR = 12;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(2, fieldR);
    const su = Math.round(cu + Math.cos(a) * d);
    const sv = Math.round(cv + Math.sin(a) * d);
    if (!isLand(grid, face, su, sv)) continue;
    const sL = top(grid, face, su, sv);
    const sh = 2 + rng.int(0, 2);
    for (let dy = 1; dy <= sh; dy++)
      put(grid, face, su, sv, sL + dy, rng.chance(0.55) ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id);
    // Random lean cap
    if (rng.chance(0.35)) {
      const leans = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      const [ldu, ldv] = leans[rng.int(0, 3)];
      put(grid, face, su + ldu, sv + ldv, sL + sh, BLOCKS.STONE.id);
    }
  }
}

function floatingBiosphere(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const baseL = top(grid, face, cu, cv);
  const floatL = baseL + 18 + rng.int(0, 10);
  const rx = 5 + rng.int(0, 2), rv = rx, ry = 3;

  for (let dy = -ry; dy <= ry; dy++) {
    for (let dv = -rv; dv <= rv; dv++) {
      for (let du = -rx; du <= rx; du++) {
        const q = (du / rx) ** 2 + (dy / ry) ** 2 + (dv / rv) ** 2;
        if (q > 1.0) continue;
        const qTop = (du / rx) ** 2 + ((dy + 1) / ry) ** 2 + (dv / rv) ** 2;
        const isTop = qTop > 1.0;
        let id: number;
        if (isTop && dy > 0) id = BLOCKS.LEAF_CREAM.id;
        else if (isTop)       id = BLOCKS.STONE_PALE.id;
        else if (dy > 0)      id = BLOCKS.SOIL.id;
        else                  id = BLOCKS.STONE_WARM.id;
        overwrite(grid, face, cu + du, cv + dv, floatL + dy, id);
      }
    }
  }

  // Stalactite drips
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1, rx - 1);
    const su = cu + Math.round(Math.cos(a) * d);
    const sv = cv + Math.round(Math.sin(a) * d);
    const len = rng.int(3, 8);
    for (let dy = 1; dy <= len; dy++) {
      const id = dy <= 2 ? BLOCKS.STONE_WARM.id : dy <= 5 ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id;
      put(grid, face, su, sv, floatL - ry - dy, id);
    }
  }

  // Small tree on top
  const topL = floatL + ry + 1;
  overwrite(grid, face, cu, cv, topL, BLOCKS.SOIL.id);
  const trunk = BLOCKS.TRUNK_PALE;
  const leaf  = rng.pick([BLOCKS.LEAF_CREAM, BLOCKS.LEAF_MINT, BLOCKS.LEAF_LILAC] as any[]) as any;
  for (let dy = 1; dy <= 3; dy++) put(grid, face, cu, cv, topL + dy, trunk.id);
  for (let dv = -2; dv <= 2; dv++)
    for (let du = -2; du <= 2; du++)
      if (Math.abs(du) + Math.abs(dv) <= 3)
        put(grid, face, cu + du, cv + dv, topL + 4, leaf.id);
  for (let dv = -1; dv <= 1; dv++)
    for (let du = -1; du <= 1; du++)
      put(grid, face, cu + du, cv + dv, topL + 5, leaf.id);
}

function ancientWell(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const baseL = top(grid, face, cu, cv);

  // Stone rim — 3×3 ring, hollow centre
  for (let dv = -1; dv <= 1; dv++)
    for (let du = -1; du <= 1; du++) {
      if (du === 0 && dv === 0) continue;
      overwrite(grid, face, cu + du, cv + dv, baseL + 1, BLOCKS.STONE.id);
      overwrite(grid, face, cu + du, cv + dv, baseL + 2, BLOCKS.STONE_PALE.id);
    }

  // Crossbeam
  const beamId = rng.chance(0.6) ? BLOCKS.STONE_WARM.id : BLOCKS.STONE_PALE.id;
  for (let du = -1; du <= 1; du++)
    put(grid, face, cu + du, cv, baseL + 3, beamId);

  // Scattered worn stones nearby
  for (let i = 0; i < 4 + rng.int(0, 3); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(3, 6);
    const su = Math.round(cu + Math.cos(a) * d);
    const sv = Math.round(cv + Math.sin(a) * d);
    if (isLand(grid, face, su, sv))
      put(grid, face, su, sv, top(grid, face, su, sv) + 1, BLOCKS.STONE_PALE.id);
  }
}

function ruinedArch(grid: SphereVoxelGrid, face: number, cu: number, cv: number, rng: ReturnType<typeof makeRng>) {
  const baseL = top(grid, face, cu, cv);
  const span    = 3 + rng.int(0, 2);
  const pillarH = 5 + rng.int(0, 2);

  // Two pillars along U axis
  for (const du of [-span, span]) {
    const pL = top(grid, face, cu + du, cv);
    for (let dy = 1; dy <= pillarH; dy++)
      put(grid, face, cu + du, cv, pL + dy, dy % 3 === 0 ? BLOCKS.STONE_PALE.id : BLOCKS.STONE.id);
  }

  // Partial lintel
  const lintelL = baseL + pillarH + 1;
  const missing = new Set<number>();
  const missCt = 1 + rng.int(0, 1);
  for (let m = 0; m < missCt; m++) missing.add(rng.int(1, span * 2 - 1));
  for (let i = 0; i <= span * 2; i++) {
    if (missing.has(i)) continue;
    put(grid, face, cu - span + i, cv, lintelL, BLOCKS.STONE_PALE.id);
  }

  // Rubble scatter
  for (let i = 0; i < 6 + rng.int(0, 4); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(1, span + 3);
    const ru = Math.round(cu + Math.cos(a) * d);
    const rv = Math.round(cv + Math.sin(a) * d);
    if (isLand(grid, face, ru, rv))
      put(grid, face, ru, rv, top(grid, face, ru, rv) + 1,
        rng.chance(0.5) ? BLOCKS.STONE.id : BLOCKS.STONE_PALE.id);
  }
}

// ── Site picker & entry point ────────────────────────────────────────────────

const BUILDERS = [twistedSpire, obelisk, monolithRing, tombstoneField,
                  floatingBiosphere, ancientWell, ruinedArch];

const KINDS: LandmarkRecord['kind'][] = ['spire', 'obelisk', 'ring', 'tombs', 'biosphere', 'well', 'arch'];

export function buildSphereLandmarks(
  grid: SphereVoxelGrid,
  rng: ReturnType<typeof makeRng>,
): LandmarkRecord[] {
  const records: LandmarkRecord[] = [];

  for (let face = 0; face < 6; face++) {
    const placed: [number, number][] = [];
    let attempts = 0;
    let landmarkIdx = Math.floor(rng() * BUILDERS.length);

    while (placed.length < LANDMARKS_PER_FACE && attempts < 400) {
      attempts++;
      const u = 10 + Math.floor(rng() * (FACE_RES - 20));
      const v = 10 + Math.floor(rng() * (FACE_RES - 20));

      if (!isLand(grid, face, u, v)) continue;

      const tooClose = placed.some(([pu, pv]) =>
        Math.abs(u - pu) < MIN_SEP && Math.abs(v - pv) < MIN_SEP,
      );
      if (tooClose) continue;

      const kind = KINDS[landmarkIdx % KINDS.length];
      const builder = BUILDERS[landmarkIdx % BUILDERS.length];
      builder(grid, face, u, v, makeRng(rng() * 0xffffffff | 0));
      placed.push([u, v]);
      landmarkIdx++;

      columnDir(face, u, v, FACE_RES, _tmp);
      records.push({ kind, dir: _tmp.clone() });
    }
  }

  return records;
}
