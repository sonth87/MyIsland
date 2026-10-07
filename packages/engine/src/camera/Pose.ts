import { Matrix4, Quaternion, Vector3, type Camera } from 'three';
import { easeInOutCubic } from './damp';

/** A camera pose expressed as eye / look-at point / up vector (works with any "up"). */
export interface CameraPose {
  position: Vector3;
  focus: Vector3;
  up: Vector3;
}

export function createPose(): CameraPose {
  return { position: new Vector3(), focus: new Vector3(), up: new Vector3(0, 1, 0) };
}

export function copyPose(out: CameraPose, src: CameraPose): CameraPose {
  out.position.copy(src.position);
  out.focus.copy(src.focus);
  out.up.copy(src.up);
  return out;
}

const _m = new Matrix4();

export function applyPose(camera: Camera, pose: CameraPose): void {
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  _m.lookAt(pose.position, pose.focus, pose.up);
  camera.quaternion.setFromRotationMatrix(_m);
}

const _d0 = new Vector3();
const _d1 = new Vector3();
const _q = new Quaternion();
const _qe = new Quaternion();

/**
 * Animated move between two poses. The eye travels along an arc around the origin
 * (so it never cuts through a planet centered there), with an optional outward bump.
 */
export class PoseTransition {
  readonly from = createPose();
  readonly to = createPose();
  active = false;
  private t = 0;
  private duration = 1;
  private bump = 0;

  start(from: CameraPose, to: CameraPose, duration: number, bump = 0): void {
    copyPose(this.from, from);
    copyPose(this.to, to);
    this.duration = Math.max(0.01, duration);
    this.bump = bump;
    this.t = 0;
    this.active = true;
  }

  /** Writes the current pose into `out`. Returns true when finished. */
  update(dt: number, out: CameraPose): boolean {
    this.t = Math.min(1, this.t + dt / this.duration);
    const e = easeInOutCubic(this.t);

    const r0 = this.from.position.length();
    const r1 = this.to.position.length();
    _d0.copy(this.from.position).normalize();
    _d1.copy(this.to.position).normalize();
    _q.setFromUnitVectors(_d0, _d1);
    _qe.identity().slerp(_q, e);
    const arc = _d0.angleTo(_d1) / Math.PI;
    const r = r0 + (r1 - r0) * e + Math.sin(Math.PI * e) * this.bump * arc;
    out.position.copy(_d0).applyQuaternion(_qe).multiplyScalar(r);

    out.focus.lerpVectors(this.from.focus, this.to.focus, e);
    out.up.lerpVectors(this.from.up, this.to.up, e);
    if (out.up.lengthSq() < 1e-6) out.up.copy(this.to.up);
    out.up.normalize();

    if (this.t >= 1) this.active = false;
    return !this.active;
  }
}
