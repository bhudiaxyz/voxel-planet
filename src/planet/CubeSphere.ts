import * as THREE from "three";

export interface ChunkAddress {
  face: number;
  cx: number;
  cz: number;
}

// 6 faces: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
// Each face covers chunks in range [0 .. chunksPerFace-1]
// Face-local coords: a_norm, b_norm in [-1,1] → cube point normalized to sphere

export class CubeSphere {
  readonly radius: number;
  readonly chunkSize: number;
  readonly chunksPerFace: number; // = ceil(2*radius / chunkSize) — covers full face

  private _scratch1 = new THREE.Vector3();
  private _scratch2 = new THREE.Vector3();

  constructor(radius: number, chunkSize: number) {
    this.radius = radius;
    this.chunkSize = chunkSize;
    this.chunksPerFace = Math.ceil((2 * radius) / chunkSize);
  }

  // Map face+chunk+UV to a unit sphere point, then scale by radius
  chunkToSphere(
    face: number,
    cx: number,
    cz: number,
    u: number,
    v: number,
  ): THREE.Vector3 {
    // Face-local normalized coords in [-1, 1]
    // chunk index goes 0..(chunksPerFace-1), mapping full face from -radius to +radius
    const a = ((cx + u) * this.chunkSize - this.radius) / this.radius;
    const b = ((cz + v) * this.chunkSize - this.radius) / this.radius;

    let x: number, y: number, z: number;
    switch (face) {
      case 0:
        x = 1;
        y = b;
        z = a;
        break; // +X
      case 1:
        x = -1;
        y = b;
        z = -a;
        break; // -X
      case 2:
        x = a;
        y = 1;
        z = -b;
        break; // +Y
      case 3:
        x = a;
        y = -1;
        z = b;
        break; // -Y
      case 4:
        x = -a;
        y = b;
        z = 1;
        break; // +Z
      case 5:
        x = a;
        y = b;
        z = -1;
        break; // -Z
      default:
        x = 1;
        y = 0;
        z = 0;
    }

    const len = Math.sqrt(x * x + y * y + z * z);
    return new THREE.Vector3(
      (x / len) * this.radius,
      (y / len) * this.radius,
      (z / len) * this.radius,
    );
  }

  // Allocation-free variant: writes the normalized sphere point into `out`.
  chunkToSphereInto(
    face: number,
    cx: number,
    cz: number,
    u: number,
    v: number,
    out: THREE.Vector3,
  ): void {
    const a = ((cx + u) * this.chunkSize - this.radius) / this.radius;
    const b = ((cz + v) * this.chunkSize - this.radius) / this.radius;
    let x: number, y: number, z: number;
    switch (face) {
      case 0:  x = 1;  y = b;  z = a;  break;
      case 1:  x = -1; y = b;  z = -a; break;
      case 2:  x = a;  y = 1;  z = -b; break;
      case 3:  x = a;  y = -1; z = b;  break;
      case 4:  x = -a; y = b;  z = 1;  break;
      case 5:  x = a;  y = b;  z = -1; break;
      default: x = 1;  y = 0;  z = 0;
    }
    const len = Math.sqrt(x * x + y * y + z * z);
    out.set((x / len) * this.radius, (y / len) * this.radius, (z / len) * this.radius);
  }

  // Convert a world-space position to face+chunk address
  worldToChunk(pos: THREE.Vector3): ChunkAddress {
    const ax = Math.abs(pos.x),
      ay = Math.abs(pos.y),
      az = Math.abs(pos.z);
    let face: number;
    let a: number, b: number; // face-local normalized coords in [-1,1]

    if (ax >= ay && ax >= az) {
      face = pos.x > 0 ? 0 : 1;
      if (face === 0) {
        a = pos.z / pos.x;
        b = pos.y / pos.x;
      } else {
        a = -pos.z / -pos.x;
        b = pos.y / -pos.x;
      }
    } else if (ay >= ax && ay >= az) {
      face = pos.y > 0 ? 2 : 3;
      if (face === 2) {
        a = pos.x / pos.y;
        b = -pos.z / pos.y;
      } else {
        a = pos.x / -pos.y;
        b = pos.z / -pos.y;
      }
    } else {
      face = pos.z > 0 ? 4 : 5;
      if (face === 4) {
        a = -pos.x / pos.z;
        b = pos.y / pos.z;
      } else {
        a = pos.x / -pos.z;
        b = pos.y / -pos.z;
      }
    }

    // a, b in [-1,1] → chunk indices
    const cx = Math.floor((a + 1) * 0.5 * this.chunksPerFace);
    const cz = Math.floor((b + 1) * 0.5 * this.chunksPerFace);

    return {
      face,
      cx: Math.max(0, Math.min(this.chunksPerFace - 1, cx)),
      cz: Math.max(0, Math.min(this.chunksPerFace - 1, cz)),
    };
  }

  // World-space center of a chunk on the sphere surface
  chunkCenter(face: number, cx: number, cz: number): THREE.Vector3 {
    return this.chunkToSphere(face, cx, cz, 0.5, 0.5);
  }

  // Orientation matrix: local Y = sphere normal at chunk center
  chunkOrientation(face: number, cx: number, cz: number): THREE.Matrix4 {
    this.chunkToSphereInto(face, cx, cz, 0.5, 0.5, this._scratch1); // center
    this._scratch2.copy(this._scratch1).normalize(); // up = sphere normal
    const center = this._scratch1;
    const up = this._scratch2;

    // Pick a reference "forward" that isn't parallel to up
    const ref =
      Math.abs(up.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(ref, up).normalize();
    const forward = new THREE.Vector3().crossVectors(right, up).normalize();

    const m = new THREE.Matrix4();
    m.makeBasis(right, up, forward);
    m.setPosition(center);
    return m;
  }

  // All chunk addresses within radiusMeters of center (world-space point)
  chunksInRadius(center: THREE.Vector3, radiusMeters: number): ChunkAddress[] {
    const result: ChunkAddress[] = [];
    this._scratch1.copy(center).normalize();
    // Angular radius in radians
    const angularRadius = radiusMeters / this.radius;
    const cosThreshold = Math.cos(angularRadius);

    for (let face = 0; face < 6; face++) {
      // Rough bounding box on this face
      const chunksToCheck = Math.ceil(radiusMeters / this.chunkSize) + 2;
      const addr = this.worldToChunk(center);

      const cxCenter =
        face === addr.face ? addr.cx : Math.floor(this.chunksPerFace / 2);
      const czCenter =
        face === addr.face ? addr.cz : Math.floor(this.chunksPerFace / 2);

      for (let dcx = -chunksToCheck; dcx <= chunksToCheck; dcx++) {
        for (let dcz = -chunksToCheck; dcz <= chunksToCheck; dcz++) {
          const cx = cxCenter + dcx;
          const cz = czCenter + dcz;
          if (
            cx < 0 ||
            cx >= this.chunksPerFace ||
            cz < 0 ||
            cz >= this.chunksPerFace
          )
            continue;

          this.chunkToSphereInto(face, cx, cz, 0.5, 0.5, this._scratch2);
          this._scratch2.normalize();
          if (this._scratch2.dot(this._scratch1) >= cosThreshold) {
            result.push({ face, cx, cz });
          }
        }
      }
    }

    return result;
  }
}
