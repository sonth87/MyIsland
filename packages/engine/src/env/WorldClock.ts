import { Vector3 } from 'three';

export type TimeMode = 'auto' | 'fixed';

const TAU = Math.PI * 2;
/** Default tilt of the sun's orbit (planet): the poles get long days / nights instead of a frozen terminator. */
const PLANET_TILT = 0.4;
/** The moon sits roughly opposite the sun, lifted towards the north so it is seen high at night. */
const MOON_LIFT = 0.45;

function wrap(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/**
 * Sun and moon orbiting the planet. The sun's angle on its orbit is the global clock;
 * the *local* hour depends on where you stand (half the planet is always at night).
 */
export class WorldClock {
  readonly axis: Vector3;
  readonly sunDir = new Vector3();
  readonly moonDir = new Vector3();
  mode: TimeMode = 'auto';
  /** Real seconds per in-game day (auto mode). */
  dayLength = 300;
  /** Local hour kept at the focus point in fixed mode. */
  fixedHour = 12;
  /** Time multiplier (fast-forward). */
  speed = 1;
  private readonly u: Vector3;
  private readonly v = new Vector3();
  private angle = 0;

  /**
   * `tilt` is the angle between the sun's orbit axis and +Y. On a planet keep it small; for a
   * flat world (up = +Y everywhere) use ~1.2 so the noon sun stands high in the sky.
   */
  constructor(tilt = PLANET_TILT) {
    this.axis = new Vector3(Math.sin(tilt), Math.cos(tilt), 0);
    this.u = new Vector3(Math.cos(tilt), -Math.sin(tilt), 0);
    this.v.crossVectors(this.u, this.axis).normalize();
    this.computeDirs();
  }

  update(dt: number, focus: Vector3): void {
    if (this.mode === 'auto') {
      this.angle = wrap(this.angle - (TAU * dt * this.speed) / this.dayLength);
    } else {
      // Glide to the requested hour (shortest way round) instead of jumping.
      const d = wrap(this.angleForHour(this.fixedHour, focus) - this.angle);
      this.angle = wrap(this.angle + d * (1 - Math.exp(-2.5 * dt)));
    }
    this.computeDirs();
  }

  /** Local solar hour (0..24) at a point on the planet. */
  hourAt(p: Vector3): number {
    const h = 12 + (wrap(this.longitude(p) - this.angle) / TAU) * 24;
    const r = ((h % 24) + 24) % 24;
    // Floating-point noise right before midnight would show as 23:59.
    return r > 24 - 1e-6 ? 0 : r;
  }

  /** Jumps the clock so the local hour at `focus` is `hour`. */
  setHour(hour: number, focus: Vector3): void {
    this.angle = this.angleForHour(hour, focus);
    this.computeDirs();
  }

  private angleForHour(hour: number, p: Vector3): number {
    return wrap(this.longitude(p) - ((hour - 12) / 24) * TAU);
  }

  private longitude(p: Vector3): number {
    return Math.atan2(p.dot(this.v), p.dot(this.u));
  }

  private computeDirs(): void {
    this.sunDir.copy(this.u).multiplyScalar(Math.cos(this.angle)).addScaledVector(this.v, Math.sin(this.angle));
    this.moonDir
      .copy(this.sunDir)
      .multiplyScalar(-Math.cos(MOON_LIFT))
      .addScaledVector(this.axis, Math.sin(MOON_LIFT))
      .normalize();
  }
}

export function formatHour(hour: number): string {
  const total = Math.floor(hour * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hourIcon(hour: number): string {
  if (hour >= 5 && hour < 7.5) return '🌅';
  if (hour >= 7.5 && hour < 17) return '☀️';
  if (hour >= 17 && hour < 19.5) return '🌇';
  return '🌙';
}
