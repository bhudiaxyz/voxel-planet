// src/player/dog.ts
import * as THREE from 'three';
import { SphereVoxelGrid, PLANET_RADIUS, FACE_RES } from '../core/voxel';
import { dirToFaceUV, columnDir } from '../core/geoutil';
import { createSpherePathfinder, type Col } from './path';

/**
 * Deepest walkable layer. The sea surface sits at layer 11.5, so layer-11
 * shallows (sand just under the waterline) are wadeable, as they are for the
 * player; only layer 10 and below is deep water.
 */
const DEEP_WATER = 10;
const HEEL_DIST = 4.0 / PLANET_RADIUS; // radians — counts as "at heel" inside this…
const SAME_LEVEL = 0.6; // …but only if its ground is within this of the player's
/** Heel spot relative to the player, in world units: ahead and to their right, further ahead while walking. */
const HEEL_SIDE = 1.5;
const HEEL_AHEAD = 4.0;
const TELEPORT_DIST = 45 / PLANET_RADIUS; // beyond this (after fly/drone, or outrun) it reappears and runs in
const TROT_SPEED = 8; // m/s
const RUN_SPEED = 22; // m/s — faster than the player's sprint (20) so it can catch up
const RUN_COLS = 10; // more waypoints left than this → run
/** Where it appears at startup: ahead of the camera and a little to one side, so it's in view. */
const APPEAR_AHEAD = 4.5;
const APPEAR_SIDE = 1.6;
/** When it has to reappear: this far ahead, so the player sees it run in. */
const RUN_IN_AHEAD = 12;
/** Unreachable and further than this → it reappears; closer, it waits for a route. */
const STRANDED_DIST = 8 / PLANET_RADIUS;
/** Path search: nodes per frame; re-plan if the heel spot moves this many columns, or every N s. */
const SEARCH_BUDGET = 400;
const REPLAN_DRIFT = 2;
const REPLAN_EVERY = 1.5;
/** Terrace hop: a little slower than a stride and this high at its peak, so the climb reads. */
const HOP_SLOWDOWN = 0.65;
const HOP_HEIGHT = 0.7;
/** How fast the drawn height follows terrace steps (the terrain is 2-layer terraces). */
const STEP_EASE = 12;

export interface SphereDog {
    mesh: THREE.Object3D;
    sitting: boolean;
    toggleSit(): void;
    /** @param viewFwd camera forward in world space — used to reappear in view. */
    update(dt: number, playerDir: THREE.Vector3, viewFwd?: THREE.Vector3): void;
    dispose(): void;
}

/**
 * A small voxel dog. Built from a handful of boxes in a pale coat so it reads
 * as an animal against soil and grass — a single brown box read as a stray
 * terrain block. Origin is at the feet; +Z is the nose.
 */
function buildDogModel() {
    const coat = new THREE.MeshLambertMaterial({ color: 0xe8c9a0 });
    const patch = new THREE.MeshLambertMaterial({ color: 0x8a5a3c });
    const nose = new THREE.MeshLambertMaterial({ color: 0x2a1d18 });
    const root = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    const add = (
        w: number,
        h: number,
        d: number,
        x: number,
        y: number,
        z: number,
        m: THREE.Material,
        parent: THREE.Object3D = root,
    ) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        parent.add(mesh);
        parts.push(mesh);
        return mesh;
    };
    const body = add(0.5, 0.42, 1.0, 0, 0.62, 0, coat);
    add(0.52, 0.2, 0.42, 0, 0.78, -0.1, patch); // saddle patch
    const head = new THREE.Group();
    head.position.set(0, 0.92, 0.55);
    root.add(head);
    add(0.42, 0.38, 0.4, 0, 0.0, 0.0, coat, head);
    add(0.24, 0.2, 0.22, 0, -0.06, 0.28, coat, head); // muzzle
    add(0.1, 0.08, 0.06, 0, -0.01, 0.4, nose, head);
    add(0.1, 0.22, 0.08, -0.16, 0.24, -0.06, patch, head); // ears
    add(0.1, 0.22, 0.08, 0.16, 0.24, -0.06, patch, head);
    const legs: THREE.Mesh[] = [];
    for (const [x, z] of [
        [-0.16, 0.36],
        [0.16, 0.36],
        [-0.16, -0.36],
        [0.16, -0.36],
    ]) {
        const leg = add(0.14, 0.44, 0.14, x, 0.22, z, coat);
        legs.push(leg);
    }
    const tail = add(0.09, 0.09, 0.42, 0, 0.82, -0.62, coat);
    tail.rotation.x = -0.7;
    return { root, body, head, legs, tail, parts, materials: [coat, patch, nose] };
}

/**
 * The dog follows a route found on the column grid (sphere-path.ts): around
 * walls, water and trunks, hopping up terraces. It heels beside the player on
 * their right — a step ahead while they walk, so it stays in view — and when
 * no route exists, or it's left far behind, it reappears ahead and runs in.
 */
export function createSphereDog(grid: SphereVoxelGrid, scene: THREE.Scene, spawnDir?: THREE.Vector3): SphereDog {
    const model = buildDogModel();
    const mesh = model.root;
    mesh.name = 'dog';
    scene.add(mesh);

    const router = createSpherePathfinder(grid, { maxUp: 2, maxDown: 4, seaLayer: DEEP_WATER });
    const dir = new THREE.Vector3();
    const _axis = new THREE.Vector3();
    const _look = new THREE.Vector3();
    const _fwd = new THREE.Vector3();
    const _side = new THREE.Vector3();
    const _p = new THREE.Vector3();
    const _wp = new THREE.Vector3();
    const _lastPlayer = new THREE.Vector3();
    let sitting = false;
    let drawnR = 0;
    let gait = 0; // walk-cycle phase
    let moving = 0; // 0..1 eased "is moving" for animation
    let placed = false;

    /** Route being followed (start column first) and the index of the next waypoint. */
    let route: Col[] = [];
    let wpIndex = 0;
    /** Goal of the route being followed or searched for. */
    let goal: Col | null = null;
    let searching = false;
    let replanIn = 0;
    /** True while searching toward the player's own column after the heel spot failed. */
    let fallback = false;
    /** Terrace hop in progress: 0 = none, else 0..1 progress from hopFrom to hopTo radius. */
    let hop = 0;
    let hopGap = 0;
    let hopFrom = 0,
        hopTo = 0;

    const colOf = (d: THREE.Vector3): Col => dirToFaceUV(d, FACE_RES);
    const sameCol = (a: Col, b: Col) => a.face === b.face && a.u === b.u && a.v === b.v;
    const colDist = (a: Col, b: Col) =>
        a.face === b.face ? Math.max(Math.abs(a.u - b.u), Math.abs(a.v - b.v)) : Infinity;
    /** Radius of the walkable ground at a column (feet height), or -1 for sea / trunk. */
    const groundR = (c: Col) => {
        const l = router.groundOf(c.face, c.u, c.v);
        return l < 0 ? -1 : PLANET_RADIUS + l + 1;
    };
    const surfaceAt = (d: THREE.Vector3) => {
        const { face, u, v } = dirToFaceUV(d, FACE_RES);
        return grid.surfaceRadius(face, u, v);
    };

    /** Tangent frame at the player: _fwd = view forward flattened, _side = camera right. */
    function frameAt(playerDir: THREE.Vector3, viewFwd?: THREE.Vector3) {
        if (viewFwd) _fwd.copy(viewFwd).addScaledVector(playerDir, -viewFwd.dot(playerDir));
        if (!viewFwd || _fwd.lengthSq() < 1e-6)
            _fwd.set(Math.abs(playerDir.y) > 0.9 ? 1 : 0, Math.abs(playerDir.y) > 0.9 ? 0 : 1, 0).addScaledVector(
                playerDir,
                -playerDir.y,
            );
        _fwd.normalize();
        _side.crossVectors(_fwd, playerDir).normalize();
    }

    /** The column `ahead` units forward and `side` units right of the player (frameAt first). */
    function spotNear(playerDir: THREE.Vector3, ahead: number, side: number): Col {
        _p.copy(playerDir)
            .multiplyScalar(surfaceAt(playerDir))
            .addScaledVector(_fwd, ahead)
            .addScaledVector(_side, side);
        return colOf(_p.normalize());
    }

    /**
     * Reappear on walkable ground near the player, ahead of the camera so the
     * arrival is seen. Tries a few spots so it never lands in the sea.
     */
    function appear(playerDir: THREE.Vector3, viewFwd: THREE.Vector3 | undefined, ahead: number) {
        frameAt(playerDir, viewFwd);
        const tries: Array<[number, number]> = [
            [ahead, APPEAR_SIDE],
            [ahead, -APPEAR_SIDE],
            [ahead * 0.6, 0],
            [APPEAR_AHEAD, APPEAR_SIDE],
            [0, 1.2],
        ];
        let c = colOf(playerDir);
        for (const [a, sd] of tries) {
            const t = spotNear(playerDir, a, sd);
            if (groundR(t) > 0) {
                c = t;
                break;
            }
        }
        columnDir(c.face, c.u, c.v, FACE_RES, dir);
        drawnR = surfaceAt(dir);
        route = [];
        goal = null;
        searching = false;
        hop = 0;
        placed = true;
    }

    // Placed on the first update, once the camera direction is known, so the
    // dog starts in view. Until then it sits at the spawn column.
    if (spawnDir) dir.copy(spawnDir).normalize();

    function plan(from: Col, to: Col) {
        goal = to;
        searching = true;
        router.start(from, to);
        replanIn = REPLAN_EVERY;
    }

    function update(dt: number, playerDir: THREE.Vector3, viewFwd?: THREE.Vector3) {
        if (!placed) {
            appear(playerDir, viewFwd, APPEAR_AHEAD);
            _lastPlayer.copy(playerDir);
        }
        const playerGround = surfaceAt(playerDir);
        let travelled = 0;

        if (!sitting) {
            if (dir.angleTo(playerDir) > TELEPORT_DIST) appear(playerDir, viewFwd, RUN_IN_AHEAD);

            // Heel spot: the player's right, a step ahead while they walk so the dog stays in view.
            const playerMoving = playerDir.angleTo(_lastPlayer) > (0.5 * dt) / PLANET_RADIUS;
            _lastPlayer.copy(playerDir);
            frameAt(playerDir, viewFwd);
            // Ahead at all times (~20° off-centre), so it sits in view rather than at the frame edge.
            const heel = spotNear(playerDir, playerMoving ? HEEL_AHEAD + 1.5 : HEEL_AHEAD, HEEL_SIDE);
            const me = colOf(dir);
            const atHeel = dir.angleTo(playerDir) < HEEL_DIST && Math.abs(surfaceAt(dir) - playerGround) <= SAME_LEVEL;

            // (Re)plan when the heel spot drifts, on a timer, or when idle away from heel.
            replanIn -= dt;
            if (!searching && !(atHeel && route.length === 0)) {
                const drifted = !goal || colDist(goal, heel) > REPLAN_DRIFT;
                if (drifted || replanIn <= 0 || (route.length === 0 && !sameCol(me, heel) && !fallback)) {
                    fallback = false;
                    plan(me, heel);
                }
            }

            // Advance the search a bounded amount each frame.
            if (searching) {
                const st = router.step(SEARCH_BUDGET);
                if (st === 'found') {
                    searching = false;
                    route = router.path.length > 1 ? router.path : [];
                    wpIndex = 1;
                    hop = 0;
                } else if (st === 'failed') {
                    searching = false;
                    // Heel spot unreachable (water, trunk, cliff): try the player's own column;
                    // if that fails too, reappear ahead of the player and run in.
                    if (!fallback) {
                        fallback = true;
                        plan(me, colOf(playerDir));
                    } else {
                        fallback = false;
                        // Only jump if it's genuinely stranded away from the player; close by, a
                        // failed search (player standing somewhere odd) just waits and re-plans.
                        if (dir.angleTo(playerDir) > STRANDED_DIST) appear(playerDir, viewFwd, RUN_IN_AHEAD);
                        else replanIn = REPLAN_EVERY;
                    }
                }
            }

            // Follow the route one waypoint (column) at a time.
            if (route.length > 0 && wpIndex < route.length) {
                const next = route[wpIndex];
                columnDir(next.face, next.u, next.v, FACE_RES, _wp);
                const gap = dir.angleTo(_wp);
                if (hop === 0) {
                    const here = groundR(colOf(dir)),
                        there = groundR(next);
                    if (here > 0 && there - here > 0.5) {
                        hop = 1e-6;
                        hopGap = Math.max(gap, 1e-9);
                        hopFrom = here;
                        hopTo = there;
                    }
                }
                const speed = route.length - wpIndex > RUN_COLS ? RUN_SPEED : TROT_SPEED;
                const stepAng = Math.min(((speed * dt) / PLANET_RADIUS) * (hop > 0 ? HOP_SLOWDOWN : 1), gap);
                _axis.crossVectors(dir, _wp);
                if (_axis.lengthSq() > 1e-14 && stepAng > 0) {
                    dir.applyAxisAngle(_axis.normalize(), stepAng).normalize();
                    travelled = stepAng * PLANET_RADIUS;
                }
                const left = dir.angleTo(_wp);
                if (hop > 0) hop = Math.min(1, 1 - left / hopGap);
                if (left < 0.12 / PLANET_RADIUS) {
                    wpIndex++;
                    hop = 0;
                    if (wpIndex >= route.length) route = [];
                }
            }
        }

        // Height: on a hop, a parabola from the lower to the upper terrace; otherwise
        // ease over small steps. Unloaded/empty columns borrow the player's ground.
        let r = surfaceAt(dir);
        if (r <= PLANET_RADIUS) r = playerGround;
        if (hop > 0) drawnR = hopFrom + (hopTo - hopFrom) * hop + Math.sin(Math.PI * hop) * HOP_HEIGHT;
        else drawnR = Math.abs(r - drawnR) > 4 ? r : drawnR + (r - drawnR) * (1 - Math.exp(-STEP_EASE * dt));
        mesh.position.copy(dir).multiplyScalar(drawnR);

        // Stand upright on the sphere. Face where it's going while moving, the player otherwise.
        mesh.up.copy(dir);
        const target = travelled > 0 ? _wp : playerDir;
        _look.copy(target).addScaledVector(dir, -target.dot(dir));
        if (_look.lengthSq() > 1e-10) mesh.lookAt(_look.normalize().add(mesh.position));

        // Animation: trot cycle while moving, tail wag always, sit pose when told.
        const speedNow = dt > 0 ? travelled / dt : 0;
        moving += ((speedNow > 0.5 ? 1 : 0) - moving) * (1 - Math.exp(-10 * dt));
        gait += dt * (6 + speedNow * 0.9);
        const swing = Math.sin(gait) * 0.6 * moving;
        model.legs[0].rotation.x = swing;
        model.legs[3].rotation.x = swing;
        model.legs[1].rotation.x = -swing;
        model.legs[2].rotation.x = -swing;
        model.tail.rotation.y = Math.sin(gait * 2.2) * 0.6;
        const sitT = sitting ? 1 : 0;
        model.body.rotation.x = -0.45 * sitT;
        model.body.position.y = 0.62 - 0.12 * sitT;
        model.legs[2].position.y = model.legs[3].position.y = 0.22 - 0.1 * sitT;
        model.head.position.y = 0.92 + Math.abs(Math.sin(gait)) * 0.04 * moving + 0.06 * sitT;

        // main.ts turns off scene-wide matrix auto-update, so moving objects must refresh their own.
        mesh.updateMatrixWorld(true);
    }

    return {
        mesh,
        get sitting() {
            return sitting;
        },
        toggleSit() {
            sitting = !sitting;
        },
        update,
        dispose() {
            scene.remove(mesh);
            for (const p of model.parts) p.geometry.dispose();
            for (const m of model.materials) m.dispose();
        },
    };
}
