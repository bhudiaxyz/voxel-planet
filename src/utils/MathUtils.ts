export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Snap chunk-local (x, z) offsets to the nearest voxel column centre (voxelSize=1). */
export function snapToVoxelColumn(x: number, z: number, chunkSize: number): [number, number] {
  const half = chunkSize / 2;
  return [Math.floor(x + half) + 0.5 - half, Math.floor(z + half) + 0.5 - half];
}
