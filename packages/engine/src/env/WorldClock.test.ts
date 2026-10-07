import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { WorldClock } from './WorldClock';

const P = new Vector3(0.3, 0.2, 0.9).normalize();

describe('WorldClock', () => {
  it('setHour / hourAt round-trip at a point', () => {
    const c = new WorldClock();
    for (const h of [0, 5.5, 12, 18.25, 23.9]) {
      c.setHour(h, P);
      expect(c.hourAt(P)).toBeCloseTo(h, 6);
    }
  });

  it('sun is overhead-ish at noon and below the horizon at midnight', () => {
    const c = new WorldClock();
    c.setHour(12, P);
    const noon = c.sunDir.dot(P);
    c.setHour(0, P);
    const midnight = c.sunDir.dot(P);
    expect(noon).toBeGreaterThan(0.5);
    expect(midnight).toBeLessThan(-0.5);
  });

  it('auto mode advances the local hour at the configured day length', () => {
    const c = new WorldClock();
    c.dayLength = 240;
    c.setHour(6, P);
    for (let i = 0; i < 60; i++) c.update(1, P); // a quarter of a day
    expect(c.hourAt(P)).toBeCloseTo(12, 4);
  });

  it('the far side of the planet is at the opposite hour', () => {
    const c = new WorldClock();
    c.setHour(9, P);
    // Rotate P by 180° around the sun's orbit axis.
    const far = P.clone().applyAxisAngle(c.axis, Math.PI);
    expect(c.hourAt(far)).toBeCloseTo(21, 6);
  });
});
