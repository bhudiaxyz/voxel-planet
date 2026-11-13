import * as THREE from 'three';

const SENSITIVITY = 0.0021;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const HEAD_BOB_AMP = 0.022; // metres of vertical oscillation
const HEAD_BOB_HZ = 2.2; // cycles per second at full sprint

const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _look = new THREE.Vector3();

/**
 * Camera forward/right on the tangent plane at `up`, rotated by `yaw`.
 * Single source of truth for both movement and the view, so W is always
 * "visually forward" and D is always screen-right. Returns shared scratch vectors.
 */
export function tangentBasis(up: THREE.Vector3, yaw: number): { fwd: THREE.Vector3; rgt: THREE.Vector3 } {
    // Reference tangent: world-up projected onto the plane; (1,0,0) near the poles.
    const ref = Math.abs(up.y) > 0.9 ? _X : _Y;
    _fwd.copy(ref).addScaledVector(up, -ref.dot(up)).normalize().applyAxisAngle(up, yaw);
    // Camera right = forward × up (three.js cameras look down -Z).
    _rgt.crossVectors(_fwd, up).normalize();
    return { fwd: _fwd, rgt: _rgt };
}

export class FPCamera {
    camera: THREE.PerspectiveCamera;
    yaw: number;
    pitch: number;
    isLocked: boolean;
    droneActive: boolean;
    _keys: Set<string>;
    /** True while a menu (pause/settings) is open: movement, jump and look are ignored. */
    get paused(): boolean {
        return this._paused;
    }
    set paused(on: boolean) {
        this._paused = on;
        if (on) {
            this._keys.clear();
            this._prevSpace = false;
            this.touchAltAxis = 0;
        }
    }
    private _paused = false;

    /** Set true on touch devices; bypasses pointer-lock requirement for movement. */
    touchActive: boolean;
    /** Set true while in fly mode; blocks controller-driven camera update, keeps direct yaw/pitch. */
    flyActive: boolean;
    /** Touch ascend (+1) / descend (-1) held state for drone/fly mode. */
    touchAltAxis: number;
    /** Set true while sprint button held on touch; injects ShiftLeft into _keys. */
    set touchSprint(on: boolean) {
        if (on) this._keys.add('ShiftLeft');
        else this._keys.delete('ShiftLeft');
    }
    private _dom: HTMLElement;
    private _jumpEdge: boolean;
    private _bobPhase: number;
    private _wishV: THREE.Vector3;
    /** Raw joystick axes set by setTouchMove — used by drone for its own yaw. */
    _joyX = 0;
    _joyY = 0;
    private _prevSpace: boolean;
    // Drone mouse/altitude accumulators — drained each frame by DroneMode (Task 9)
    private _droneMX: number;
    private _droneAltDelta: number;

    constructor(aspect: number, domElement: HTMLElement, cameraFar = 6000) {
        this.camera = new THREE.PerspectiveCamera(72, aspect, 0.02, cameraFar);
        this.camera.rotation.order = 'YXZ';

        this.yaw = 0;
        this.pitch = 0;
        this.isLocked = false;
        this.droneActive = false;
        this.flyActive = false;
        this.touchActive = false;
        this.touchAltAxis = 0;

        this._dom = domElement;
        this._keys = new Set<string>();
        this._jumpEdge = false;
        this._bobPhase = 0;
        this._wishV = new THREE.Vector3();
        this._prevSpace = false;
        this._droneMX = 0;
        this._droneAltDelta = 0;

        this._bindEvents();
    }

    private _bindEvents(): void {
        const dom = this._dom;

        dom.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType === 'mouse' && e.button === 0 && !this.isLocked) dom.requestPointerLock();
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === dom;
            dom.style.cursor = this.isLocked ? 'none' : 'default';
        });

        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isLocked) return;
            if (this.droneActive) {
                this._droneMX += e.movementX;
                // Mouse Y is intentionally NOT wired to altitude — any tiny upward
                // mouse drift would cause continuous climb. Space/C/scroll handle it.
                return;
            }
            // fly mode shares direct yaw/pitch update (falls through here intentionally)
            this.yaw -= e.movementX * SENSITIVITY;
            this.pitch -= e.movementY * SENSITIVITY;
            this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
        });

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (this.paused) return;
            this._keys.add(e.code);
            if (e.code === 'Space') {
                e.preventDefault();
                if (!this._prevSpace) this._jumpEdge = true;
                this._prevSpace = true;
            }
        });
        document.addEventListener('keyup', (e: KeyboardEvent) => {
            this._keys.delete(e.code);
            if (e.code === 'Space') this._prevSpace = false;
        });
        window.addEventListener('blur', () => {
            this._keys.clear();
            this._prevSpace = false;
        });

        dom.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                if (this.droneActive) this._droneAltDelta -= e.deltaY * 0.02;
            },
            { passive: true },
        );
    }

    /**
     * Wish direction on the sphere tangent plane at playerDir.
     * Matches the forward basis used by updateSphere so W is always "visually forward".
     */
    getWishSphere(playerDir: THREE.Vector3): THREE.Vector3 {
        const w = this._wishV.set(0, 0, 0);
        if (this.droneActive || this.paused) return w;
        const touching = this.touchActive && (this._joyX !== 0 || this._joyY !== 0);
        if (!this.isLocked && !touching) return w;

        tangentBasis(playerDir, this.yaw);
        const fwd = _fwd,
            rgt = _rgt;

        if (touching) {
            // Joystick: y+ = forward, x+ = right. Keep analogue magnitude (≤1).
            w.addScaledVector(fwd, this._joyY).addScaledVector(rgt, this._joyX);
            if (w.lengthSq() > 1) w.normalize();
            return w;
        }
        if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) w.addScaledVector(fwd, 1);
        if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) w.addScaledVector(fwd, -1);
        if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) w.addScaledVector(rgt, 1);
        if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) w.addScaledVector(rgt, -1);
        if (w.lengthSq() > 0) w.normalize();
        return w;
    }

    /** Called by touch-controls each frame with joystick vector (-1..1 each axis). */
    setTouchMove(nx: number, ny: number): void {
        if (!this.touchActive) return;
        this._joyX = nx;
        this._joyY = ny;
    }

    /** Accumulate touch look delta (radians). */
    applyTouchLook(dyaw: number, dpitch: number): void {
        if (this.paused) return;
        this.yaw -= dyaw;
        this.pitch -= dpitch;
        this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    }

    triggerTouchJump(): void {
        if (!this._prevSpace) this._jumpEdge = true;
    }

    /** Returns true on the frame Space is first pressed, then resets. */
    getJumpEdge(): boolean {
        const v = this._jumpEdge && !this.paused;
        this._jumpEdge = false;
        return v;
    }

    isKeyDown(code: string): boolean {
        return !this.paused && this._keys.has(code);
    }

    /** Drain accumulated drone yaw input since last call. */
    drainDroneMX(): number {
        const v = this._droneMX;
        this._droneMX = 0;
        return v;
    }

    /**
     * Drain accumulated drone altitude delta since last call.
     * Returns a value in m/s so that the caller can do `hoverAltitude += result * dt`.
     *   Keys / touch: ±12 m/s rate.
     *   Scroll wheel:  direct-delta converted to rate by dividing by dt,
     *                  so `rate * dt` restores the original per-tick offset.
     */
    drainDroneAltDelta(dt = 0): number {
        const keyAxis = (this._keys.has('Space') ? 1 : 0) - (this._keys.has('KeyC') ? 1 : 0);
        // Scroll gives a direct position delta; convert to rate so dt cancels cleanly.
        const scrollRate = dt > 0 ? this._droneAltDelta / dt : 0;
        this._droneAltDelta = 0;
        return scrollRate + (keyAxis + this.touchAltAxis) * 12;
    }

    /**
     * Spherical surface camera. `up` = radial outward, yaw rotates around `up`,
     * pitch tilts the look direction from the tangent plane.
     */
    updateSphere(dt: number, playerDir: THREE.Vector3, groundRadius: number, speedFraction = 0, grounded = true): void {
        if (this.droneActive) return;

        if (grounded && speedFraction > 0.05) {
            this._bobPhase += dt * HEAD_BOB_HZ * Math.PI * 2;
        } else {
            this._bobPhase *= Math.max(0, 1 - dt * 8);
        }
        const bob = Math.sin(this._bobPhase) * HEAD_BOB_AMP * speedFraction;

        this.camera.up.copy(playerDir);
        this.camera.position.copy(playerDir).multiplyScalar(groundRadius + bob);

        tangentBasis(playerDir, this.yaw);
        _look
            .copy(_fwd)
            .multiplyScalar(Math.cos(this.pitch))
            .addScaledVector(playerDir, Math.sin(this.pitch))
            .normalize()
            .add(this.camera.position);
        this.camera.lookAt(_look);
    }

    resize(aspect: number): void {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }
}
