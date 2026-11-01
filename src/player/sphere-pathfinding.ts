// src/player/sphere-pathfinding.ts
import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV, columnDir } from '../core/geoutil';

const ITERS_PER_STEP = 16;

interface Node {
  face: number; u: number; v: number;
  g: number; f: number;
  parent: number | null; // key of parent
}

function nodeKey(face: number, u: number, v: number): number {
  return face * FACE_RES * FACE_RES + v * FACE_RES + u;
}

function columnDirVec(face: number, u: number, v: number): THREE.Vector3 {
  const d = new THREE.Vector3();
  columnDir(face, u, v, FACE_RES, d);
  return d;
}

export interface SpherePathNavigator {
  setGoal(face: number, u: number, v: number): void;
  step(): void;
  path: Array<{ face: number; u: number; v: number }> | null;
  done: boolean;
}

export function createSpherePathNavigator(
  grid: SphereVoxelGrid,
  startFace: number, startU: number, startV: number,
): SpherePathNavigator {
  let goalFace = startFace, goalU = startU, goalV = startV;
  let goalDir = columnDirVec(goalFace, goalU, goalV);
  let open = new Map<number, Node>();
  let closed = new Set<number>();
  let nodes = new Map<number, Node>();
  let path: Array<{ face: number; u: number; v: number }> | null = null;
  let done = false;

  function heuristic(face: number, u: number, v: number): number {
    const d = columnDirVec(face, u, v);
    return Math.acos(Math.max(-1, Math.min(1, d.dot(goalDir))));
  }

  const _d = new THREE.Vector3();
  function neighbors(face: number, u: number, v: number): Array<{ face: number; u: number; v: number }> {
    const result: Array<{ face: number; u: number; v: number }> = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [du, dv] of dirs) {
      const nu = u + du, nv = v + dv;
      if (nu >= 0 && nu < FACE_RES && nv >= 0 && nv < FACE_RES) {
        result.push({ face, u: nu, v: nv });
      } else {
        columnDir(face, nu, nv, FACE_RES, _d);
        const mapped = dirToFaceUV(_d, FACE_RES);
        result.push({ face: mapped.face, u: mapped.u, v: mapped.v });
      }
    }
    return result;
  }

  function reconstructPath(key: number): Array<{ face: number; u: number; v: number }> {
    const result: Array<{ face: number; u: number; v: number }> = [];
    let cur: number | null = key;
    while (cur !== null) {
      const n: Node = nodes.get(cur)!;
      result.unshift({ face: n.face, u: n.u, v: n.v });
      cur = n.parent;
    }
    return result;
  }

  function reset() {
    open = new Map();
    closed = new Set();
    nodes = new Map();
    path = null;
    done = false;
    const startKey = nodeKey(startFace, startU, startV);
    const h = heuristic(startFace, startU, startV);
    const start: Node = { face: startFace, u: startU, v: startV, g: 0, f: h, parent: null };
    open.set(startKey, start);
    nodes.set(startKey, start);
  }

  reset();

  return {
    get path() { return path; },
    get done() { return done; },

    setGoal(face: number, u: number, v: number) {
      goalFace = face; goalU = u; goalV = v;
      goalDir = columnDirVec(face, u, v);
      reset();
    },

    step() {
      if (done || open.size === 0) { done = true; return; }
      for (let i = 0; i < ITERS_PER_STEP; i++) {
        if (open.size === 0) { done = true; return; }
        // ponytail: O(n) open-set scan; use a binary heap if path lengths exceed ~1000 nodes
        let bestKey = -1, bestF = Infinity;
        for (const [k, n] of open) {
          if (n.f < bestF) { bestF = n.f; bestKey = k; }
        }
        const cur = open.get(bestKey)!;
        open.delete(bestKey);
        closed.add(bestKey);
        if (cur.face === goalFace && cur.u === goalU && cur.v === goalV) {
          path = reconstructPath(bestKey);
          done = true;
          return;
        }
        for (const nb of neighbors(cur.face, cur.u, cur.v)) {
          const nk = nodeKey(nb.face, nb.u, nb.v);
          if (closed.has(nk)) continue;
          const top = grid.columnTop(nb.face, nb.u, nb.v);
          if (top < 0) continue; // impassable
          const curTop = grid.columnTop(cur.face, cur.u, cur.v);
          const heightCost = Math.max(0, top - curTop) * 0.5;
          const g = cur.g + 1 + heightCost;
          const existing = open.get(nk);
          if (!existing || g < existing.g) {
            const h = heuristic(nb.face, nb.u, nb.v);
            const node: Node = { face: nb.face, u: nb.u, v: nb.v, g, f: g + h, parent: bestKey };
            open.set(nk, node);
            nodes.set(nk, node);
          }
        }
      }
    },
  };
}
