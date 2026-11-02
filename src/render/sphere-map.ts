import * as THREE from 'three';
import { SphereVoxelGrid, FACE_RES } from '../core/sphere-voxel';
import { dirToFaceUV } from '../core/geoutil';
import { BLOCK_BY_ID } from '../core/palette';

const MAP_W = 1024; // render resolution — keep high for quality
const MAP_H = 512;
const MAP_DISPLAY_W = 971; // CSS display size
const MAP_DISPLAY_H = 486;

export interface SphereMap {
  el: HTMLCanvasElement;
  displayW: number;
  displayH: number;
  update(playerDir: THREE.Vector3, forwardDir?: THREE.Vector3): void;
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

  function update(playerDir: THREE.Vector3, forwardDir?: THREE.Vector3) {
    ctx.putImageData(baked, 0, 0);

    const lon = Math.atan2(playerDir.z, playerDir.x);
    const lat = Math.asin(Math.max(-1, Math.min(1, playerDir.y)));
    const px = ((lon + Math.PI) / (2 * Math.PI)) * MAP_W;
    const py = (Math.PI / 2 - lat) / Math.PI * MAP_H;

    if (forwardDir && forwardDir.lengthSq() > 0.001) {
      // Project forward direction onto equirectangular map to get arrow angle
      // Tangent east (+lon) and north (-lat) axes at player position
      const cosLon = Math.cos(lon), sinLon = Math.sin(lon);
      const cosLat2 = Math.cos(lat), sinLat2 = Math.sin(lat);
      // East unit vector in world space: d(playerDir)/d(lon)
      const eastX = -sinLon * cosLat2, eastY = 0, eastZ = cosLon * cosLat2;
      // North unit vector in world space: -d(playerDir)/d(lat)
      const northX = -cosLon * sinLat2, northY = cosLat2, northZ = -sinLon * sinLat2;

      const fwdE = forwardDir.x * eastX + forwardDir.y * eastY + forwardDir.z * eastZ;
      const fwdN = forwardDir.x * northX + forwardDir.y * northY + forwardDir.z * northZ;
      // Map: +x = east (+px), +y = south (-N)
      const angle = Math.atan2(fwdE, fwdN); // angle from north, clockwise

      const R = 13, HEAD = 9.5;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -R);           // tip
      ctx.lineTo( HEAD * 0.5,  R * 0.3);
      ctx.lineTo(0,  R * 0.1);
      ctx.lineTo(-HEAD * 0.5,  R * 0.3);
      ctx.closePath();
      ctx.fillStyle = '#ff4444';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    } else {
      // Stationary — plain dot
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff4444';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  return {
    el: canvas,
    displayW: MAP_DISPLAY_W,
    displayH: MAP_DISPLAY_H,
    update,
    dispose() { /* canvas GC'd naturally */ },
  };
}
