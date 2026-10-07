import type { Vector3 } from 'three';

/**
 * The ground the environment effects live on — a spherical planet or a flat valley.
 * Particles (rain, snow, leaves) only need "which way is up" and "where is the ground below me".
 */
export interface Surface {
  /** Unit up vector at `p`. */
  up(p: Vector3, out: Vector3): Vector3;
  /** Point on the ground — or on the water surface, whichever is higher — straight below/above `p`. */
  ground(p: Vector3, out: Vector3): Vector3;
  /** True if the ground under `p` is water. */
  isWater(p: Vector3): boolean;
}

/** 'auto' or an intensity level 0 (off) … 4 (max). */
export type Level = 'auto' | 0 | 1 | 2 | 3 | 4;

/** What the player can force; everything left on 'auto' follows the automatic weather. */
export interface WeatherControls {
  wind: Level;
  windDirAuto: boolean;
  /** Direction the wind blows towards, degrees clockwise from north. */
  windDir: number;
  clouds: Level;
  rain: Level;
  snow: Level;
}
