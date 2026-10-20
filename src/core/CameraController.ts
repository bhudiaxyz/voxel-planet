import * as THREE from "three";
import { PLAYER, CAMERA } from "../config";
import { VOXEL_HEIGHT } from "../planet/VoxelChunk";
import { terrainFloorVt, eyeRadius } from "../utils/ViewTools";

export interface CylinderCollider {
  position: THREE.Vector3; // world-space center at base
  radius: number;
  height: number;
  // If set, player steps over instead of being pushed out (e.g. small rocks)
  stepOnly?: boolean;
}

const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _horizDelta = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _ref = new THREE.Vector3(1, 0, 0);
const _yawedRight = new THREE.Vector3();
const _yawedFwd = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _hFwd = new THREE.Vector3();
const _hRight = new THREE.Vector3();
const _hInput = new THREE.Vector3();
const _vUp = new THREE.Vector3();
const _vHoriz = new THREE.Vector3();
const _surfaceNorm = new THREE.Vector3();
const _preMovePos = new THREE.Vector3();
const _wallDir   = new THREE.Vector3();

// Max voxels the player can step up while walking (1 = one block)
const WALK_MAX_STEP = 1;

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  flying = false;
  drone = false;
  private droneAlt = 0;      // extra height above eyeHeight while in drone mode
  private _droneSmoothedR = 0; // smoothed world-radius tracked by drone mode

  colliders: CylinderCollider[] = [];

  private yaw = 0;
  private pitch = 0;
  private velocity = new THREE.Vector3();
  private grounded = false;
  private _underwater = false;

  private keys: Record<string, boolean> = {};
  private pointerLocked = false;
  private domElement: HTMLElement;

  constructor(domElement: HTMLElement) {
    this.domElement = domElement;
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fieldOfView,
      window.innerWidth / window.innerHeight,
      CAMERA.nearClip,
      CAMERA.farClip,
    );

    domElement.addEventListener("click", this._onCanvasClick);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("resize", this._onResize);
  }

  get isUnderwater(): boolean {
    return this._underwater;
  }
  set isUnderwater(v: boolean) {
    this._underwater = v;
  }

  setOrientation(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Activate drone mode, seeding the smoothed radius from current position. */
  enterDroneMode(): void {
    this.flying = false;
    this.drone = true;
    this._droneSmoothedR = this.camera.position.length();
  }

  /** Move camera radially (along surface normal) by offsetMetres, then return to walk/fly. */
  setAltitudeOffset(offsetMetres: number): void {
    const dir = this.camera.position.clone().normalize();
    const baseR = this.camera.position.length();
    this.camera.position.copy(dir.multiplyScalar(baseR + offsetMetres));
  }

  update(
    dt: number,
    planetRadius: number,
    getHeight: (pt: THREE.Vector3) => number,
  ): void {
    const pos = this.camera.position;

    // Surface normal = up
    _up.copy(pos).normalize();

    // Build reference frame on the surface
    // Pick a world-space reference axis that isn't collinear with _up
    const ref = Math.abs(_up.dot(_worldUp)) > 0.9 ? _ref : _worldUp;
    _right.crossVectors(_up, ref).normalize();
    _fwd.crossVectors(_right, _up).normalize();

    // Apply yaw around _up, pitch around _right
    _qYaw.setFromAxisAngle(_up, this.yaw);
    _yawedRight.copy(_right).applyQuaternion(_qYaw);
    _yawedFwd.copy(_fwd).applyQuaternion(_qYaw);

    _qPitch.setFromAxisAngle(_yawedRight, this.pitch);

    // Camera look direction
    _lookDir.copy(_yawedFwd).applyQuaternion(_qPitch);
    _camUp.copy(_up).applyQuaternion(_qPitch);

    // Build quaternion from matrix
    _mat.lookAt(pos, _lookTarget.copy(pos).add(_lookDir), _camUp);
    this.camera.quaternion.setFromRotationMatrix(_mat);

    // Movement
    const sprint = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
    const speed = this.flying || this.drone
      ? sprint
        ? PLAYER.flySprintSpeed
        : PLAYER.flySpeed
      : sprint
        ? PLAYER.sprintSpeed
        : PLAYER.walkSpeed;

    _moveDir.set(0, 0, 0);

    if (this.drone) {
      // Auto-forward over surface; Space/Z raise/lower altitude offset, A/D strafe
      _hFwd.copy(_yawedFwd).projectOnPlane(_up).normalize();
      _hRight.copy(_yawedRight).projectOnPlane(_up).normalize();
      _moveDir.add(_hFwd);
      if (this.keys["KeyA"] || this.keys["ArrowLeft"]) _moveDir.sub(_hRight);
      if (this.keys["KeyD"] || this.keys["ArrowRight"]) _moveDir.add(_hRight);
      if (this.keys["Space"]) this.droneAlt += speed * dt;
      if (this.keys["KeyZ"]) this.droneAlt = Math.max(0, this.droneAlt - speed * dt);
      if (_moveDir.lengthSq() > 0) _moveDir.normalize();
      this.velocity.copy(_moveDir).multiplyScalar(speed);
    } else if (this.flying) {
      if (this.keys["KeyW"] || this.keys["ArrowUp"]) _moveDir.add(_lookDir);
      if (this.keys["KeyS"] || this.keys["ArrowDown"]) _moveDir.sub(_lookDir);
      if (this.keys["KeyA"] || this.keys["ArrowLeft"]) _moveDir.sub(_yawedRight);
      if (this.keys["KeyD"] || this.keys["ArrowRight"]) _moveDir.add(_yawedRight);
      if (this.keys["Space"]) _moveDir.add(_up);
      if (this.keys["KeyZ"]) _moveDir.sub(_up);

      if (_moveDir.lengthSq() > 0) _moveDir.normalize();
      this.velocity.copy(_moveDir).multiplyScalar(speed);
    } else {
      // Horizontal input projected onto surface plane
      _hFwd.copy(_yawedFwd).projectOnPlane(_up).normalize();
      _hRight.copy(_yawedRight).projectOnPlane(_up).normalize();

      _hInput.set(0, 0, 0);
      if (this.keys["KeyW"] || this.keys["ArrowUp"]) _hInput.add(_hFwd);
      if (this.keys["KeyS"] || this.keys["ArrowDown"]) _hInput.sub(_hFwd);
      if (this.keys["KeyA"] || this.keys["ArrowLeft"]) _hInput.sub(_hRight);
      if (this.keys["KeyD"] || this.keys["ArrowRight"]) _hInput.add(_hRight);

      if (_hInput.lengthSq() > 0) _hInput.normalize();

      const accelFactor = this.grounded ? 1.0 : PLAYER.airControl;
      const targetHVel = _hInput.multiplyScalar(speed);

      // Decompose velocity into up and horizontal
      _vUp.copy(_up).multiplyScalar(this.velocity.dot(_up));
      _vHoriz.copy(this.velocity).sub(_vUp);

      // Accelerate horizontal
      _vHoriz.lerp(
        targetHVel,
        Math.min(1, PLAYER.acceleration * accelFactor * dt),
      );

      // Gravity only when airborne — grounded position is handled by terrain snap
      if (this.grounded) {
        _vUp.set(0, 0, 0);
        if (this.keys["Space"]) {
          _vUp.copy(_up).multiplyScalar(PLAYER.jumpSpeed);
          this.grounded = false;
        }
      } else {
        _vUp.addScaledVector(_up, -PLAYER.gravity * dt);
      }

      this.velocity.copy(_vHoriz).add(_vUp);
    }

    if (this.drone) {
      // --- Drone mode: terrain-following snap ---
      // Move horizontally, then snap to terrain + eyeHeight + droneAlt each frame.
      // Smooth the radial target to avoid 1-voxel jitter as quantised terrain height crosses boundaries.
      pos.addScaledVector(this.velocity, dt);
      _up.copy(pos).normalize();
      const h = getHeight(_up);
      const targetR = eyeRadius(h, planetRadius) + this.droneAlt;
      // Lerp toward target at 8 /s — fast enough to follow terrain, slow enough to kill snap-jitter
      this._droneSmoothedR += (targetR - this._droneSmoothedR) * Math.min(1, dt * 8);
      pos.normalize().multiplyScalar(this._droneSmoothedR);
    } else if (this.flying) {
      // --- Fly mode: terrain floor — player must never go below ground ---

      // 1. Pre-clamp: limit velocity so this frame's move cannot overshoot the surface.
      //    Without this, 80 m/s sprint causes ~1.28 m penetration before the post clamp fires.
      _surfaceNorm.copy(pos).normalize();
      const hNow = getHeight(_surfaceNorm);
      const gyNow = eyeRadius(hNow, planetRadius);
      const gapNow = pos.length() - gyNow; // positive = above terrain
      const velDown = -this.velocity.dot(_surfaceNorm); // positive when moving toward terrain
      if (velDown > 0 && velDown * dt > gapNow) {
        // Clamp so we exactly reach (not penetrate) the surface this frame
        const excess = velDown - Math.max(gapNow, 0) / dt;
        this.velocity.addScaledVector(_surfaceNorm, excess);
      }

      pos.addScaledVector(this.velocity, dt);
      _up.copy(pos).normalize(); // refresh before velocity cancellation

      // 2. Post-move safety clamp: handles lateral cliff entry and float errors.
      const dist = pos.length();
      const h = getHeight(_up);
      const gy = eyeRadius(h, planetRadius);
      if (dist < gy) {
        pos.normalize().multiplyScalar(gy);
        // Cancel any velocity directed into the terrain
        const velUp = this.velocity.dot(_up);
        if (velUp < 0) this.velocity.addScaledVector(_up, -velUp);
      }
    } else {
      // --- Walk mode: wall detection + terrain snap ---

      // Sample terrain height at current position before moving
      _surfaceNorm.copy(pos).normalize();
      const hBefore = getHeight(_surfaceNorm);
      const vtBefore = terrainFloorVt(hBefore);

      // Pre-clamp: cap downward velocity so this frame's move can't overshoot the surface.
      // Mirrors fly-mode logic; prevents tunnelling on large dt (lag spikes).
      {
        const gyNow = planetRadius + vtBefore + PLAYER.eyeHeight;
        const gapNow = pos.length() - gyNow;
        const velDown = -this.velocity.dot(_surfaceNorm);
        if (velDown > 0 && velDown * dt > gapNow) {
          const excess = velDown - Math.max(gapNow, 0) / dt;
          this.velocity.addScaledVector(_surfaceNorm, excess);
        }
      }

      _preMovePos.copy(pos);
      pos.addScaledVector(this.velocity, dt);
      // Refresh surface normal after movement so velocity cancellation below uses
      // the correct radial direction for the new position.
      _up.copy(pos).normalize();

      const dist = pos.length();
      _surfaceNorm.copy(pos).normalize();
      const h = getHeight(_surfaceNorm);
      const vt = terrainFloorVt(h);
      const gy = planetRadius + vt + PLAYER.eyeHeight;

      if (this.grounded) {
        if (vt > vtBefore + WALK_MAX_STEP) {
          // Terrain wall: compute into-wall direction before reverting pos.
          // _up is the cliff's radial normal; project it out to get purely horizontal wall direction.
          _wallDir.subVectors(pos, _preMovePos);
          const radComp = _wallDir.dot(_up);
          _wallDir.addScaledVector(_up, -radComp);
          // Revert position to pre-move terrain floor.
          pos.copy(_preMovePos).normalize()
            .multiplyScalar(planetRadius + vtBefore + PLAYER.eyeHeight);
          // Cancel velocity in the into-wall direction so the player slides along the wall.
          if (_wallDir.lengthSq() > 1e-10) {
            _wallDir.normalize();
            const velIntoWall = this.velocity.dot(_wallDir);
            if (velIntoWall > 0) this.velocity.addScaledVector(_wallDir, -velIntoWall);
          }
          // Also cancel any downward radial velocity.
          const velUp = this.velocity.dot(_up);
          if (velUp < 0) this.velocity.addScaledVector(_up, -velUp);
        } else if (dist < gy) {
          // Stepped up onto higher terrain: snap to surface, remove downward velocity
          pos.normalize().multiplyScalar(gy);
          const velUp = this.velocity.dot(_up);
          if (velUp < 0) this.velocity.addScaledVector(_up, -velUp);
        } else {
          // At or above terrain surface
          const gap = dist - gy;
          if (gap <= VOXEL_HEIGHT * (WALK_MAX_STEP + 2)) {
            // Small drop (≤ 1 voxel): snap down to terrain to follow slopes smoothly
            pos.normalize().multiplyScalar(gy);
            const velUp = this.velocity.dot(_up);
            this.velocity.addScaledVector(_up, -velUp); // project onto surface
          } else {
            // Large drop: genuinely airborne (walked off a ledge)
            this.grounded = false;
          }
        }
      } else {
        // Airborne: land when reaching terrain surface
        if (dist <= gy) {
          // If terrain at the new position is much higher than the player's current
          // altitude, this is a horizontal wall hit, not a landing from above.
          if (gy - dist > VOXEL_HEIGHT) {
            // Wall hit while airborne: revert horizontal movement, keep vertical.
            _wallDir.subVectors(pos, _preMovePos);
            const radComp = _wallDir.dot(_up);
            // Horizontal component only.
            _wallDir.addScaledVector(_up, -radComp);
            if (_wallDir.lengthSq() > 1e-10) {
              _wallDir.normalize();
              const velIntoWall = this.velocity.dot(_wallDir);
              if (velIntoWall > 0) this.velocity.addScaledVector(_wallDir, -velIntoWall);
            }
            // Keep the vertical progress; only revert horizontal displacement.
            pos.copy(_preMovePos).addScaledVector(_up, radComp);
          } else {
            // Normal landing.
            pos.normalize().multiplyScalar(gy);
            const velUp = this.velocity.dot(_up);
            if (velUp < 0) this.velocity.addScaledVector(_up, -velUp);
            this.grounded = true;
          }
        } else {
          this.grounded = dist <= gy + 0.5;
        }
      }
    }

    // Hard floor — guaranteed terrain-floor clamp regardless of which branch ran above.
    _up.copy(pos).normalize();
    const fh = getHeight(_up);
    const fgy = eyeRadius(fh, planetRadius);
    if (pos.length() < fgy) {
      pos.normalize().multiplyScalar(fgy);
      if (this.drone) {
        this._droneSmoothedR = fgy; // resync so next frame doesn't re-enter
      } else {
        const vup = this.velocity.dot(_up);
        if (vup < 0) this.velocity.addScaledVector(_up, -vup);
        this.grounded = true;
      }
    }

    // Refresh _up after terrain snaps may have moved pos
    _up.copy(pos).normalize();

    // Cylinder colliders push-out
    for (const col of this.colliders) {
      _horizDelta.copy(pos).sub(col.position);
      // Radial distance above collider base along sphere normal
      const upDot = _horizDelta.dot(_up);
      _horizDelta.addScaledVector(_up, -upDot);
      const horizDist = _horizDelta.length();
      const minDist = col.radius + PLAYER.collisionRadius;

      // Outside radius or above this collider's height: no interaction
      if (horizDist >= minDist || upDot < 0 || upDot > col.height) continue;
      if (horizDist <= 0.001) continue;

      // stepOnly colliders (small rocks/bumps): let terrain height handle it,
      // push-out only if the player is somehow embedded sideways
      if (col.stepOnly) continue;

      _horizDelta.normalize();
      pos.addScaledVector(_horizDelta, minDist - horizDist);
      const velInto = this.velocity.dot(_horizDelta);
      if (velInto < 0) this.velocity.addScaledVector(_horizDelta, -velInto);
    }

    // Toggle fly
    // (handled in keydown)
  }

  private _onCanvasClick = (): void => {
    if (!this.pointerLocked) {
      this.domElement.requestPointerLock();
    }
  };

  private _onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    const hint = document.getElementById("click-hint");
    if (hint && this.pointerLocked) hint.classList.add("hidden");
    else if (hint) hint.classList.remove("hidden");
  };

  private _onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.yaw -= e.movementX * PLAYER.mouseSensitivity;
    this.pitch -= e.movementY * PLAYER.mouseSensitivity;
    this.pitch = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, this.pitch),
    );
  };

  private _onKeyDown = (e: KeyboardEvent): void => {
    this.keys[e.code] = true;
    if (e.code === "KeyF") {
      this.flying = !this.flying;
      if (!this.flying) {
        // Keep only up component of velocity on fly→walk
        const vUp = _up.clone().multiplyScalar(this.velocity.dot(_up));
        this.velocity.copy(vUp);
      }
    }
    if (e.code === "KeyG") {
      this.drone = !this.drone;
      if (this.drone) {
        // Seed the smoothed radius from current position so there's no initial lurch
        this._droneSmoothedR = this.camera.position.length();
      } else {
        this.velocity.set(0, 0, 0);
        this.droneAlt = 0;
        // Treat exit as grounded so walk mode doesn't free-fall before the first terrain snap
        this.grounded = true;
      }
    }
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private _onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    this.domElement.removeEventListener("click", this._onCanvasClick);
    document.removeEventListener(
      "pointerlockchange",
      this._onPointerLockChange,
    );
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("resize", this._onResize);
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }
}
