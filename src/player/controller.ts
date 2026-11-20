/**
 * SphereController — on-foot walking, gravity and jumping on the spherical voxel planet.
 *
 * Purpose
 *   Moves the player's eye over the planet surface. Position is stored as a unit direction from
 *   the planet centre plus a radius, so "up" is always radial and there are no world axes.
 *
 * Operations
 *   - State: `dir` (unit vector from centre), `groundRadius` (eye distance from centre),
 *     `verticalVelocity`, `isGrounded`, `speed` (0..1 fraction of sprint speed, for camera bob).
 *   - update(): looks up the surface under `dir` (standR: grid.standTop from the feet down, so
 *     floating islands are walkable and you fall off their edges), grounded when
 *     the feet are within 0.05 of it; jump sets JUMP_VEL, otherwise GRAVITY pulls down. The eye
 *     is clamped to surface + EYE_HEIGHT.
 *   - Horizontal motion projects wishDir into the tangent plane and arcs `dir` by
 *     speed*dt/groundRadius (WALK_SPEED, or SPRINT_SPEED when sprinting).
 *   - Collision: blocked() decides whether a column can be entered — terrain more than MAX_STEP
 *     above the feet, trunks / bushes / cacti at body height, ground-cover sprites with an
 *     obstacleH (tall shrub, yucca, scrub) and rocks/logs from the vegetation layer
 *     (obstacleAt hook, wired by main.ts). Only small plants and flowers are walk-through.
 *     A blocked destination reverts the move (`dir` restored, speed 0); higher terrain is only
 *     climbed in MAX_STEP-sized terraces, and a jump clears low obstacles. Then keepClear() holds the eye CLEARANCE (0.3) from every
 *     neighbouring wall face (sides and corners, across cube seams), whatever the approach angle
 *     or frame rate, so the camera's near plane never clips a cliff or a river bank and you can't
 *     see through it. snapToDir() applies it too (teleports, landing from drone/fly).
 *   - Scratch vectors are module-level, so `pos` returns a shared vector: copy it if you keep it.
 *
 * Usage
 *   Created by src/main.ts with the spawn direction and the grid. Each frame main passes
 *   FPCamera's wish direction (getWish), the jump edge and sprint flag; `pos` feeds the camera,
 *   `speed` the head bob. `snapToDir(dir, grid, fromRadius?)` places the walker: teleports omit
 *   fromRadius (planet ground); leaving drone/fly passes the flyer's radius, so landing over a
 *   floating island lands on it.
 *   Fly and drone modes (fly.ts, drone.ts) replace this controller while active.
 *
 *     controller.update(dt, fpCam.getWish(...), jumpEdge, world.grid, sprint);
 *
 * See also: fly.ts, drone.ts, src/render/fp-camera.ts; DESIGN.md "14. Player".
 */
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES, crossFaceUV } from '../core/voxel';
import { BLOCK_BY_ID, PATTERN } from '../core/blocks';
import { basisFromCode, dirToFaceUV } from '../core/geoutil';

const GRAVITY = 28;
const JUMP_VEL = 10.5;
const WALK_SPEED = 9;
const SPRINT_SPEED = 18;
const EYE_HEIGHT = 1.75;

const MAX_STEP = 1.1; // max terrain step-up in world units
/**
 * How close (world units) the eye may get to a wall face: any neighbouring column the feet
 * can't step onto. The camera's near plane is 0.02 and its frustum corners reach ~0.035 from
 * the eye; inside that a wall is clipped and you see through it. 0.3 leaves room for head
 * bob and wide fields of view. Enforced by keepClear(), whatever the approach angle or frame
 * rate (the old one-step-ahead probe let a 45° approach reach 0.001 at any frame rate).
 */
const CLEARANCE = 0.3;
/** How far above a bush/cactus top the feet must be to move over it (drop or jump), units. */
const STAND_CLEAR = 2.2;
const _cn = new THREE.Vector3(),
    _ctu = new THREE.Vector3(),
    _ctv = new THREE.Vector3(),
    _cA = new THREE.Vector3(),
    _cB = new THREE.Vector3();

const _scratchStep = new THREE.Vector3();
const _oldDir = new THREE.Vector3();

export class SphereController {
    dir = new THREE.Vector3(1, 0, 0); // unit direction from planet centre
    groundRadius: number; // current distance from centre
    verticalVelocity = 0;
    isGrounded = false;
    speed = 0; // 0..1 horizontal speed fraction for camera bob
    /**
     * Rocks and logs drawn by the vegetation layer (not in the voxel grid): height above the
     * ground at a column, 0 if clear. main.ts wires world.veg.obstacleAt here.
     */
    obstacleAt: ((face: number, u: number, v: number) => number) | null = null;
    private _pos = new THREE.Vector3();

    constructor(spawnDir: THREE.Vector3, grid: SphereVoxelGrid) {
        this.dir.copy(spawnDir).normalize();
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        this.groundRadius = grid.surfaceRadius(face, u, v) + EYE_HEIGHT;
    }

    /** World-space position at player eye height. */
    get pos(): THREE.Vector3 {
        return this._pos.copy(this.dir).multiplyScalar(this.groundRadius);
    }

    update(
        dt: number,
        wishDir: THREE.Vector3, // unit vector in world space (from FPCamera.getWish)
        jumpEdge: boolean,
        grid: SphereVoxelGrid,
        sprint = false,
    ) {
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        const surfaceR = this.standR(grid, face, u, v);
        const altitudeAboveSurface = this.groundRadius - EYE_HEIGHT - surfaceR;

        this.isGrounded = altitudeAboveSurface <= 0.05;

        if (this.isGrounded && jumpEdge) {
            this.verticalVelocity = JUMP_VEL;
            this.isGrounded = false;
        }

        if (!this.isGrounded) {
            this.verticalVelocity -= GRAVITY * dt;
        }

        this.groundRadius += this.verticalVelocity * dt;

        // Land on surface
        if (this.groundRadius - EYE_HEIGHT < surfaceR) {
            this.groundRadius = surfaceR + EYE_HEIGHT;
            this.verticalVelocity = Math.max(0, this.verticalVelocity);
        }

        // Horizontal movement: arc step on sphere surface with terrain collision
        if (wishDir.lengthSq() > 0.001) {
            _oldDir.copy(this.dir);
            _scratchStep.copy(wishDir).addScaledVector(this.dir, -wishDir.dot(this.dir)).normalize();
            const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
            _scratchStep.multiplyScalar((speed * dt) / this.groundRadius);
            this.dir.add(_scratchStep).normalize();

            // Destination column check: never enter a column the walker can't stand in.
            const { face: nf, u: nu, v: nv } = dirToFaceUV(this.dir, FACE_RES);
            if (this.blocked(grid, nf, nu, nv)) {
                this.dir.copy(_oldDir);
                this.speed = 0;
            } else {
                this.speed = speed / SPRINT_SPEED;
            }
        } else {
            this.speed = Math.max(0, this.speed - dt * 4);
        }
        // Then keep the eye CLEARANCE away from every wall face around it (any angle, any rate).
        this.keepClear(grid);
    }

    /**
     * Radius of the surface the walker stands on at a column: the highest standable block at
     * or below the feet + MAX_STEP (grid.standTop). So the ground under a floating island is
     * the terrain while you walk beneath it, and the island's top once you're on it — walking
     * off its edge drops you. (grid.surfaceRadius is the planet-connected ground only.)
     */
    private standR(grid: SphereVoxelGrid, f: number, u: number, v: number): number {
        const feet = this.groundRadius - EYE_HEIGHT;
        const top = grid.standTop(f, u, v, Math.floor(feet - PLANET_RADIUS + MAX_STEP));
        return PLANET_RADIUS + (top < 0 ? 0 : top + 1);
    }

    /**
     * Can't the walker stand in this column at its current height? One rule for moving
     * (the destination column) and for the camera clearance (keepClear):
     *   - terrain: the ground is more than MAX_STEP above the feet (a cliff, a terrace wall);
     *   - voxel obstacles at body height (the feet layer and the one above): tree and dead
     *     trunks, bushes and shrubs (solid sway blocks), cacti;
     *   - ground-cover sprites that declare obstacleH (tall shrub, yucca, dry scrub) and
     *     rocks/logs from the vegetation layer (obstacleAt), unless the feet are above them
     *     (jumping over a low rock or scrub works).
     * Grass, flowers, ferns, moss, tall grass, reeds and pebbles are always walk-through.
     */
    private blocked(grid: SphereVoxelGrid, f: number, u: number, v: number): boolean {
        const feet = this.groundRadius - EYE_HEIGHT;
        const ground = this.standR(grid, f, u, v);
        if (ground > feet + MAX_STEP) return true;
        // Voxel obstacles at body height (the feet layer and the one above) — where the feet
        // will be after stepping in: a step up lifts the body into whatever is over it.
        const fl = Math.floor(Math.max(feet, ground) - PLANET_RADIUS + 0.01);
        for (let l = fl; l <= fl + 1; l++) {
            const b = BLOCK_BY_ID[grid.get(f, u, v, l)];
            if (b && (b.isTrunk || (b.sway && b.solid) || b.pattern === PATTERN.CACTUS)) return true;
        }
        // Head height: a solid overhang (cliff lip, a floating island's underside) blocks too.
        const headId = grid.get(f, u, v, fl + 1); // (BLOCK_BY_ID[0] is the AIR record, so test the id)
        const head = headId !== 0 ? BLOCK_BY_ID[headId] : undefined;
        if (head && !head.isWater && !(head.sway && !head.solid)) return true;
        // A bush or cactus as the column's ground (groundColumnTop counts solid foliage as
        // ground): stepping out onto it — level with the feet or a terrace down — is walking
        // through it. Only clear when well above it (dropping from a ledge, mid-jump).
        const top = BLOCK_BY_ID[grid.get(f, u, v, Math.round(ground - PLANET_RADIUS) - 1)];
        if (top && ((top.sway && top.solid) || top.pattern === PATTERN.CACTUS) && feet - ground < STAND_CLEAR) return true;
        // Sprite plants and rocks stand on this column's ground: blocking unless cleared.
        const above = feet - ground;
        const plant = BLOCK_BY_ID[grid.plantAt(f, u, v)];
        if (plant?.obstacleH && above < plant.obstacleH) return true;
        const rock = this.obstacleAt ? this.obstacleAt(f, u, v) : 0;
        return rock > 0 && above < rock;
    }

    /**
     * Clamp the eye's position inside its column so it stays CLEARANCE from the faces of
     * neighbouring wall columns (ground higher than feet + MAX_STEP) — the 4 sides, then the
     * 4 corners. Works in the face's continuous column coordinates (fu, fv), so it is exact on
     * the gnomonic grid, and looks neighbours up across cube seams with crossFaceUV.
     */
    private keepClear(grid: SphereVoxelGrid) {
        const { face } = dirToFaceUV(this.dir, FACE_RES);
        basisFromCode(face, _cn, _ctu, _ctv);
        const dn = this.dir.dot(_cn);
        let fu = ((this.dir.dot(_ctu) / dn + 1) * FACE_RES) / 2,
            fv = ((this.dir.dot(_ctv) / dn + 1) * FACE_RES) / 2;
        const cu = Math.min(FACE_RES - 1, Math.max(0, Math.floor(fu))),
            cv = Math.min(FACE_RES - 1, Math.max(0, Math.floor(fv)));
        // Column width here, in world units (columns shrink toward a face's corners).
        const at = (a: number, b: number, out: THREE.Vector3) =>
            out
                .copy(_cn)
                .addScaledVector(_ctu, (2 * a) / FACE_RES - 1)
                .addScaledVector(_ctv, (2 * b) / FACE_RES - 1)
                .normalize();
        const colW = at(cu + 1, cv + 0.5, _cA).distanceTo(at(cu, cv + 0.5, _cB)) * this.groundRadius;
        const c = Math.min(0.45, CLEARANCE / colW); // as a fraction of the column
        const wall = (du: number, dv: number) => {
            let f = face,
                u = cu + du,
                v = cv + dv;
            if (u < 0 || v < 0 || u >= FACE_RES || v >= FACE_RES) [f, u, v] = crossFaceUV(face, u, v);
            return this.blocked(grid, f, u, v);
        };
        let x = fu - cu,
            y = fv - cv;
        const ox = x,
            oy = y;
        const wE = wall(1, 0),
            wW = wall(-1, 0),
            wN = wall(0, 1),
            wS = wall(0, -1);
        if (wE && x > 1 - c) x = 1 - c;
        if (wW && x < c) x = c;
        if (wN && y > 1 - c) y = 1 - c;
        if (wS && y < c) y = c;
        // Corners: a wall only diagonally — push out along the shallower axis.
        for (const [du, dv] of [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
        ]) {
            const px = du > 0 ? x - (1 - c) : c - x; // > 0 = inside the corner's clearance on x
            const py = dv > 0 ? y - (1 - c) : c - y;
            if (px > 0 && py > 0 && wall(du, dv)) {
                if (px < py) x = du > 0 ? 1 - c : c;
                else y = dv > 0 ? 1 - c : c;
            }
        }
        if (x === ox && y === oy) return;
        fu = cu + x;
        fv = cv + y;
        at(fu, fv, this.dir);
    }

    /**
     * Teleport to a new direction and stand on the ground there.
     * @param fromRadius look for ground at or below this radius (e.g. the drone's or flyer's
     *   current height), so landing over a floating island lands ON it. Omitted (teleports):
     *   the planet-connected ground (groundColumnTop), never an island overhead.
     */
    snapToDir(newDir: THREE.Vector3, grid: SphereVoxelGrid, fromRadius?: number): void {
        this.dir.copy(newDir).normalize();
        const { face, u, v } = dirToFaceUV(this.dir, FACE_RES);
        const top = fromRadius === undefined ? -2 : grid.standTop(face, u, v, Math.floor(fromRadius - PLANET_RADIUS));
        this.groundRadius =
            (top >= 0 ? PLANET_RADIUS + top + 1 : grid.surfaceRadius(face, u, v)) + EYE_HEIGHT;
        this.verticalVelocity = 0;
        this.keepClear(grid);
    }

    /** Forward direction in tangent plane at dir (for camera reference). */
    forwardInPlane(cameraForward: THREE.Vector3): THREE.Vector3 {
        return _scratchStep.copy(cameraForward).addScaledVector(this.dir, -cameraForward.dot(this.dir)).normalize();
    }
}
