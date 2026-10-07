import type { Vector3 } from 'three';

/** Frame-rate independent smoothing factor for exponential damping. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * dampFactor(lambda, dt);
}

export function dampVector(current: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
  return current.lerp(target, dampFactor(lambda, dt));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
