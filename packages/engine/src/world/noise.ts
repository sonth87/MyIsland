import { createNoise3D } from 'simplex-noise';
import type { Rng } from './rng';

export interface NoiseSet {
  /** Raw simplex noise in [-1, 1]. */
  noise(x: number, y: number, z: number): number;
  /** Fractal Brownian motion, roughly [-1, 1]. */
  fbm(x: number, y: number, z: number, octaves?: number): number;
  /** Ridged multifractal in [0, 1] (sharp crests, good for mountains). */
  ridged(x: number, y: number, z: number, octaves?: number): number;
}

export function createNoise(rng: Rng): NoiseSet {
  const n = createNoise3D(rng);
  return {
    noise: n,
    fbm(x, y, z, octaves = 4) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += n(x * freq, y * freq, z * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    },
    ridged(x, y, z, octaves = 4) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < octaves; i++) {
        const r = 1 - Math.abs(n(x * freq, y * freq, z * freq));
        sum += r * r * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      return sum / norm;
    },
  };
}
