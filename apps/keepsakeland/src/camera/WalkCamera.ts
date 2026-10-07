import { MathUtils, Vector2, Vector3 } from 'three';
import { damp, dampFactor, type CameraPose, type SpatialHash } from '@g2/engine';
import type { PlanetCollider } from '../planet/scatter';
import type { Ground } from '../player/SpherePlayer';
import type { ViewMode } from '../settings/Settings';

const _focusTarget = new Vector3();
const _offset = new Vector3();
const _dir = new Vector3();
const _q = new Vector3();
const _d = new Vector3();
const _cu = new Vector3();

interface ModeDefaults {
  distance: number;
  pitch: number;
  minDistance: number;
  maxDistance: number;
}

const DEFAULTS: Record<Exclude<ViewMode, 'first'>, ModeDefaults> = {
  third: { distance: 6.5, pitch: 0.3, minDistance: 2.5, maxDistance: 14 },
  second: { distance: 3.4, pitch: 0.12, minDistance: 1.8, maxDistance: 8 },
};

/**
 * Character camera on a sphere, in three flavours:
 * - first: eyes of the character, drag to look around;
 * - second: in front of the character, looking back at their face;
 * - third: behind and above, orbit with drag, zoom with wheel.
 * Its heading is a tangent vector parallel-transported with the character, so "up" can be any direction.
 */
export class WalkCamera {
  mode: ViewMode = 'third';
  /** Horizontal view direction (third / first person), tangent to the surface. */
  readonly heading = new Vector3(0, 0, 1);
  readonly up = new Vector3(0, 1, 0);
  readonly right = new Vector3(1, 0, 0);
  pitch = 0.3;
  distance = 6.5;
  /** First-person look pitch (positive = up). */
  lookPitch = 0;
  private targetDistance = 6.5;
  private readonly focus = new Vector3();
  private readonly eye = new Vector3();
  private bob = 0;

  constructor(
    private readonly ground: Ground,
    private readonly colliders?: SpatialHash<PlanetCollider>,
  ) {}

  setMode(mode: ViewMode, characterForward: Vector3): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'first') {
      this.heading.copy(characterForward);
      this.lookPitch = -0.1;
    } else {
      const d = DEFAULTS[mode];
      this.distance = this.targetDistance = d.distance;
      this.pitch = d.pitch;
      if (mode === 'second') this.heading.copy(characterForward).negate();
      else this.heading.copy(characterForward);
    }
    this.transport();
  }

  reset(characterPos: Vector3, forward: Vector3, height = 1): void {
    this.up.copy(characterPos).normalize();
    this.heading.copy(forward);
    if (this.mode === 'second') this.heading.negate();
    this.transport();
    this.focus.copy(characterPos).addScaledVector(this.up, 1.35 * height);
    this.eye.copy(characterPos).addScaledVector(this.up, 1.55 * height);
    if (this.mode !== 'first') {
      const d = DEFAULTS[this.mode];
      this.distance = this.targetDistance = d.distance;
      this.pitch = d.pitch;
    }
    this.lookPitch = -0.1;
  }

  /**
   * `characterForward` is the body facing; `walkPhase` drives first-person head bob.
   * `height` scales the eye / focus height for small characters.
   */
  update(
    dt: number,
    characterPos: Vector3,
    characterForward: Vector3,
    look: Vector2,
    zoom: number,
    moving: number,
    height = 1,
  ): void {
    this.up.copy(characterPos).normalize();
    this.transport();

    if (this.mode === 'first') {
      this.heading.applyAxisAngle(this.up, -look.x * 0.004).normalize();
      this.right.crossVectors(this.heading, this.up).normalize();
      this.lookPitch = MathUtils.clamp(this.lookPitch - look.y * 0.0035, -1.3, 1.3);
      this.bob += dt * (6 + moving * 5) * Math.min(1, moving);
      _focusTarget.copy(characterPos).addScaledVector(this.up, (1.55 + Math.sin(this.bob * 2) * 0.03 * moving) * height);
      _focusTarget.addScaledVector(this.heading, 0.12);
      this.eye.lerp(_focusTarget, dampFactor(30, dt));
      return;
    }

    const d = DEFAULTS[this.mode];
    if (this.mode === 'second') {
      // Stay in front of the character; dragging orbits temporarily.
      _d.copy(characterForward).negate();
      this.heading.lerp(_d, dampFactor(look.lengthSq() > 0 ? 0 : 2.5, dt)).normalize();
    }
    this.heading.applyAxisAngle(this.up, -look.x * 0.005).normalize();
    this.right.crossVectors(this.heading, this.up).normalize();
    this.pitch = MathUtils.clamp(this.pitch + look.y * 0.004, -0.12, 1.25);

    if (zoom !== 0) this.targetDistance = MathUtils.clamp(this.targetDistance * Math.exp(zoom), d.minDistance, d.maxDistance);
    _focusTarget.copy(characterPos).addScaledVector(this.up, (this.mode === 'second' ? 1.45 : 1.35) * height);
    this.focus.lerp(_focusTarget, dampFactor(14, dt));

    // Pull in quickly when something blocks the view, ease back out slowly.
    const want = Math.min(this.targetDistance, this.freeDistance(this.targetDistance));
    this.distance = damp(this.distance, want, want < this.distance ? 18 : 3, dt);
  }

  /** Camera-relative movement: input (x = right, y = forward) → world tangent direction. */
  wishDirection(input: Vector2, out: Vector3): Vector3 {
    return out.copy(this.heading).multiplyScalar(input.y).addScaledVector(this.right, input.x);
  }

  pose(out: CameraPose): CameraPose {
    if (this.mode === 'first') {
      out.position.copy(this.eye);
      out.focus
        .copy(this.eye)
        .addScaledVector(this.heading, Math.cos(this.lookPitch))
        .addScaledVector(this.up, Math.sin(this.lookPitch));
      out.up.copy(this.up);
      return out;
    }
    this.offset(this.distance, _offset);
    out.position.copy(this.focus).add(_offset);

    // Keep the eye above the terrain.
    const r = out.position.length();
    const minR = this.ground.heightAt(_dir.copy(out.position).normalize()) + 0.6;
    if (r < minR) out.position.setLength(minR);

    out.focus.copy(this.focus);
    out.up.copy(this.up);
    return out;
  }

  private offset(distance: number, out: Vector3): Vector3 {
    return out
      .copy(this.heading)
      .multiplyScalar(-Math.cos(this.pitch) * distance)
      .addScaledVector(this.up, Math.sin(this.pitch) * distance);
  }

  /** Largest distance (≤ wanted) whose line from the focus doesn't pass through a tree crown or a house. */
  private freeDistance(wanted: number): number {
    if (!this.colliders) return wanted;
    const steps = 8;
    for (let i = 2; i <= steps; i++) {
      const t = (i / steps) * wanted;
      _q.copy(this.focus).add(this.offset(t, _offset));
      let blocked = false;
      this.colliders.query(_q, 3.5, (c) => {
        if (blocked) return;
        _cu.copy(c.position).normalize();
        _d.subVectors(_q, c.position);
        const along = _d.dot(_cu);
        if (along < 0 || along > c.height) return;
        _d.addScaledVector(_cu, -along);
        if (_d.length() < c.cameraRadius) blocked = true;
      });
      if (blocked) return Math.max(2.2, ((i - 1) / steps) * wanted);
    }
    return wanted;
  }

  /** Re-projects the heading onto the current tangent plane (parallel transport). */
  private transport(): void {
    this.heading.addScaledVector(this.up, -this.heading.dot(this.up));
    if (this.heading.lengthSq() < 1e-8) this.heading.set(1, 0, 0).cross(this.up);
    this.heading.normalize();
    this.right.crossVectors(this.heading, this.up).normalize();
  }
}
