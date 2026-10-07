import * as THREE from 'three';
import type { Rng } from '@g2/engine';

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Matrix placing a prop (origin at its base, +Y up) on the sphere surface. */
export function surfaceMatrix(
  dir: THREE.Vector3,
  height: number,
  yaw: number,
  scale: number | THREE.Vector3,
  out = new THREE.Matrix4(),
  sink = 0.08,
): THREE.Matrix4 {
  _q.setFromUnitVectors(UP, dir).multiply(_qy.setFromAxisAngle(UP, yaw));
  _p.copy(dir).multiplyScalar(height - sink);
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.copy(scale);
  return out.compose(_p, _q, _s);
}

/** Direction of a point offset (lx, lz) in the local frame of a surface placement. */
export function localSurfaceDir(
  dir: THREE.Vector3,
  radius: number,
  yaw: number,
  lx: number,
  lz: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  _q.setFromUnitVectors(UP, dir).multiply(_qy.setFromAxisAngle(UP, yaw));
  out.set(lx, 0, lz).applyQuaternion(_q);
  return out.addScaledVector(dir, radius).normalize();
}

export function randomDir(rng: Rng, out = new THREE.Vector3()): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const t = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(t), z, r * Math.sin(t));
}

const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Yaw for `surfaceMatrix` so that the prop's local +Z points along the world tangent `facing`. */
export function yawFacing(dir: THREE.Vector3, facing: THREE.Vector3): number {
  _q.setFromUnitVectors(UP, dir);
  _x.set(1, 0, 0).applyQuaternion(_q);
  _z.set(0, 0, 1).applyQuaternion(_q);
  return Math.atan2(facing.dot(_x), facing.dot(_z));
}
