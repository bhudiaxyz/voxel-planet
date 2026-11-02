import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';
import { BLOCK_BY_ID } from '../core/palette';

const MAP_W = 384;
const MAP_H = 192;

export interface SphereMap {
  el: HTMLCanvasElement;
  update(playerDir: THREE.Vector3): void;
  dispose(): void;
}

export function createSphereMap(grid: SphereVoxelGrid): SphereMap {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d')!;

  // Bake terrain once
  const baked = ctx.createImageData(MAP_W, MAP_H);
  const _dir = new THREE.Vector3();

  for (let py = 0; py < MAP_H; py++) {
    const lat = Math.PI / 2 - (py / MAP_H) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let px = 0; px < MAP_W; px++) {
      const lon = (px / MAP_W) * 2 * Math.PI - Math.PI;
      _dir.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
      const { face, u, v } = dirToFaceUV(_dir, FACE_RES);
      const top = grid.columnTop(face, u, v);
      const id = grid.get(face, u, v, Math.max(0, top));
      const block = BLOCK_BY_ID[id] as any;
      let r = 136, g = 136, b = 136;
      if (block) {
        const col: THREE.Color = block.mapColor ?? block.top ?? block.side;
        if (col) { r = Math.round(col.r * 255); g = Math.round(col.g * 255); b = Math.round(col.b * 255); }
      }
      const i = (py * MAP_W + px) * 4;
      baked.data[i] = r; baked.data[i+1] = g; baked.data[i+2] = b; baked.data[i+3] = 255;
    }
  }

  function update(playerDir: THREE.Vector3) {
    ctx.putImageData(baked, 0, 0);
    const lon = Math.atan2(playerDir.z, playerDir.x);
    const lat = Math.asin(Math.max(-1, Math.min(1, playerDir.y)));
    const px = ((lon + Math.PI) / (2 * Math.PI)) * MAP_W;
    const py = (Math.PI / 2 - lat) / Math.PI * MAP_H;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return {
    el: canvas,
    update,
    dispose() { /* canvas GC'd naturally */ },
  };
}
