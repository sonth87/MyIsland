import { MathUtils, Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import { damp, type CameraPose } from '@g2/engine';

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const _qa = new Quaternion();
const _m = new Matrix4();
const _origin = new Vector3();

/**
 * Trackball-style orbit around the planet center: drag rotates the camera freely
 * in any direction (no pole lock), with inertia, zoom and idle auto-rotation.
 */
export class OverviewCamera {
  readonly orientation = new Quaternion();
  distance: number;
  private targetDistance: number;
  private readonly velocity = new Vector2();
  private idle = 0;
  readonly minDistance: number;
  readonly maxDistance: number;

  constructor(private readonly radius: number) {
    this.distance = this.targetDistance = radius * 3.1;
    this.minDistance = radius * 1.6;
    this.maxDistance = radius * 5;
    this.orientation.setFromAxisAngle(X, -0.35);
  }

  /** Points the camera at `dir` (from outside the planet), keeping `upHint` as screen-up. */
  lookAtDir(dir: Vector3, upHint: Vector3): void {
    const eye = dir.clone().normalize().multiplyScalar(this.distance);
    _m.lookAt(eye, _origin, upHint);
    this.orientation.setFromRotationMatrix(_m);
    this.velocity.set(0, 0);
  }

  update(dt: number, look: Vector2, zoom: number, viewportHeight: number): void {
    // Radians per pixel: drag across the screen ≈ half a turn, slower when zoomed in.
    const k = (Math.PI / viewportHeight) * (this.distance / (this.radius * 3));
    if (look.lengthSq() > 0) {
      this.rotate(look.x * k, look.y * k);
      if (dt > 0) this.velocity.set((look.x * k) / dt, (look.y * k) / dt);
      this.idle = 0;
    } else {
      this.rotate(this.velocity.x * dt, this.velocity.y * dt);
      this.velocity.multiplyScalar(Math.exp(-4 * dt));
      this.idle += dt;
      if (this.idle > 4) this.rotate(-0.04 * dt * Math.min(1, this.idle - 4), 0);
    }

    if (zoom !== 0) {
      this.targetDistance = MathUtils.clamp(this.targetDistance * Math.exp(zoom), this.minDistance, this.maxDistance);
      this.idle = 0;
    }
    this.distance = damp(this.distance, this.targetDistance, 8, dt);
  }

  pose(out: CameraPose): CameraPose {
    out.position.set(0, 0, this.distance).applyQuaternion(this.orientation);
    out.focus.set(0, 0, 0);
    out.up.copy(Y).applyQuaternion(this.orientation);
    return out;
  }

  /** Drag right → camera orbits left so the surface follows the pointer. */
  private rotate(dx: number, dy: number): void {
    this.orientation.multiply(_qa.setFromAxisAngle(Y, -dx)).multiply(_qa.setFromAxisAngle(X, -dy));
    this.orientation.normalize();
  }
}
