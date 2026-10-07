import { Matrix4, Quaternion, Vector3 } from 'three';

export interface Ground {
  readonly waterLevel: number;
  heightAt(dir: Vector3): number;
}

export interface Obstacle {
  position: Vector3;
  radius: number;
}

export interface ObstacleQuery {
  query(p: Vector3, radius: number, fn: (o: Obstacle) => void): void;
}

/** Side-steps tried (radians, distance factor) when the direct move is blocked, so we slide along obstacles. */
const SLIDE_ATTEMPTS: Array<[number, number]> = [
  [0.6, 0.85],
  [-0.6, 0.85],
  [1.2, 0.5],
  [-1.2, 0.5],
];

const _up = new Vector3();
const _dir = new Vector3();
const _cand = new Vector3();
const _off = new Vector3();
const _right = new Vector3();
const _slide = new Vector3();
const _m = new Matrix4();

/**
 * Kinematic character controller on a spherical planet.
 * All movement happens in the tangent plane at the current position, then the
 * position is re-projected onto the ground and the facing is parallel-transported,
 * so there is no singularity at the poles.
 */
export class SpherePlayer {
  readonly position = new Vector3();
  readonly prevPosition = new Vector3();
  /** Facing direction, always tangent to the surface. */
  readonly forward = new Vector3(0, 0, 1);
  readonly prevForward = new Vector3(0, 0, 1);
  speed = 0;
  walkSpeed = 3.6;
  runSpeed = 7.5;
  radius = 0.35;
  /** Seconds the player has been pushing against something without moving. */
  stuckTime = 0;
  grounded = true;
  /** Radial (vertical) velocity while airborne. */
  vUp = 0;
  gravity = 15;
  /** Downward speed at the last landing; reset by whoever consumes it. */
  landImpact = 0;
  private readonly moveDir = new Vector3();

  constructor(
    private readonly ground: Ground,
    private readonly obstacles?: ObstacleQuery,
  ) {}

  spawn(dir: Vector3, forwardHint?: Vector3): void {
    _dir.copy(dir).normalize();
    this.position.copy(_dir).multiplyScalar(this.ground.heightAt(_dir));
    this.forward.copy(forwardHint ?? new Vector3(0, 1, 0));
    this.projectTangent(this.forward, _dir);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(1, 0, 0).cross(_dir);
    this.forward.normalize();
    this.moveDir.copy(this.forward);
    this.speed = 0;
    this.vUp = 0;
    this.grounded = true;
    this.prevPosition.copy(this.position);
    this.prevForward.copy(this.forward);
  }

  up(out = new Vector3()): Vector3 {
    return out.copy(this.position).normalize();
  }

  /** Starts a jump if standing on the ground. */
  jump(speed = 5.5): boolean {
    if (!this.grounded) return false;
    this.grounded = false;
    this.vUp = speed;
    return true;
  }

  /** Turns the facing towards a tangent direction without moving (e.g. to face someone). */
  face(target: Vector3, dt: number): void {
    const up = this.up(_up);
    _cand.copy(target);
    this.projectTangent(_cand, up);
    if (_cand.lengthSq() < 1e-8) return;
    this.turnTowards(_cand.normalize(), up, dt, 6);
  }

  /**
   * One fixed step. `wish` is a world-space direction (tangent, length 0..1) built from
   * camera-relative input. With `faceMove` false the body keeps its facing (strafing).
   */
  step(dt: number, wish: Vector3, running: boolean, faceMove = true): void {
    this.prevPosition.copy(this.position);
    this.prevForward.copy(this.forward);
    const up = this.up(_up);

    const amount = Math.min(wish.length(), 1);
    const targetSpeed = amount * (running ? this.runSpeed : this.walkSpeed);
    // Less control in the air.
    const accel = (targetSpeed > this.speed ? 10 : 8) * (this.grounded ? 1 : 0.35);
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-accel * dt));
    if (amount > 1e-3) {
      this.moveDir.copy(wish).normalize();
      if (faceMove) this.turnTowards(this.moveDir, up, dt);
    }
    if (this.speed < 0.01) {
      this.speed = 0;
      this.stuckTime = 0;
      this.integrateVertical(dt);
      return;
    }

    this.projectTangent(this.moveDir, up).normalize();
    const dist = this.speed * dt;
    let moved = this.tryMove(this.moveDir, dist, up);
    for (let i = 0; !moved && i < SLIDE_ATTEMPTS.length; i++) {
      const [angle, factor] = SLIDE_ATTEMPTS[i];
      moved = this.tryMove(_slide.copy(this.moveDir).applyAxisAngle(up, angle), dist * factor, up);
    }
    if (moved) {
      this.stuckTime = 0;
    } else {
      this.stuckTime += dt;
      this.speed *= 0.5;
    }

    this.integrateVertical(dt);
    // Parallel-transport the facing so it stays tangent at the new position.
    this.projectTangent(this.forward, this.up(_up)).normalize();
  }

  private integrateVertical(dt: number): void {
    if (this.grounded) return;
    this.vUp -= this.gravity * dt;
    const dir = _dir.copy(this.position).normalize();
    const ground = this.ground.heightAt(dir);
    let r = this.position.length() + this.vUp * dt;
    if (r <= ground) {
      r = ground;
      this.landImpact = -this.vUp;
      this.vUp = 0;
      this.grounded = true;
    }
    this.position.copy(dir).multiplyScalar(r);
  }

  /** Interpolated transform for rendering between fixed steps. */
  pose(alpha: number, outPos: Vector3, outQuat: Quaternion): void {
    outPos.lerpVectors(this.prevPosition, this.position, alpha);
    const up = _up.copy(outPos).normalize();
    const fwd = _dir.lerpVectors(this.prevForward, this.forward, alpha);
    this.projectTangent(fwd, up).normalize();
    _right.crossVectors(up, fwd).normalize();
    _m.makeBasis(_right, up, fwd);
    outQuat.setFromRotationMatrix(_m);
  }

  private turnTowards(target: Vector3, up: Vector3, dt: number, rate = 12): void {
    if (this.forward.dot(target) < -0.98) {
      // Nearly opposite: nudge sideways so the lerp doesn't pass through zero.
      this.forward.addScaledVector(_right.crossVectors(up, this.forward), 0.3);
    }
    this.forward.lerp(target, 1 - Math.exp(-rate * dt));
    this.projectTangent(this.forward, up).normalize();
  }

  private tryMove(dir: Vector3, dist: number, up: Vector3): boolean {
    const r = this.position.length();
    _cand.copy(this.position).addScaledVector(dir, dist);
    _cand.setLength(r);

    if (this.obstacles) {
      const candUp = _dir.copy(_cand).normalize();
      this.obstacles.query(_cand, this.radius + 2.5, (o) => {
        _off.subVectors(_cand, o.position);
        _off.addScaledVector(candUp, -_off.dot(candUp));
        const len = _off.length();
        const min = o.radius + this.radius;
        if (len < min && len > 1e-5) _cand.addScaledVector(_off, (min - len) / len);
      });
    }

    const newDir = _dir.copy(_cand).normalize();
    const h = this.ground.heightAt(newDir);
    if (h < this.ground.waterLevel + 0.12) return false;
    if (!this.grounded) {
      // In the air: keep the current altitude unless the ground rises into us.
      if (h > r - 0.05) return false;
      this.position.copy(newDir).multiplyScalar(r);
      return true;
    }
    const currentH = this.position.dot(up);
    const rise = h - currentH;
    if (rise > Math.max(0.2, dist * 1.25)) return false;
    this.position.copy(newDir).multiplyScalar(h);
    return true;
  }

  private projectTangent(v: Vector3, up: Vector3): Vector3 {
    return v.addScaledVector(up, -v.dot(up));
  }
}
