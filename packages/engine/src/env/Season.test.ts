import { describe, expect, it } from 'vitest';
import { ACTIVITY, SeasonState } from './Season';

const sum = (s: SeasonState) => s.weights.x + s.weights.y + s.weights.z + s.weights.w;

describe('SeasonState', () => {
  it('starts in spring and weights always sum to 1', () => {
    const s = new SeasonState();
    expect(s.weights.x).toBe(1);
    s.set('autumn');
    for (let i = 0; i < 200; i++) {
      s.update(0.05);
      expect(sum(s)).toBeCloseTo(1, 6);
    }
  });

  it('glides to the chosen season and settles exactly on it', () => {
    const s = new SeasonState();
    s.set('summer');
    s.update(1);
    expect(s.weights.x).toBeGreaterThan(0);
    expect(s.weights.y).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) s.update(0.05);
    expect(s.weights.y).toBe(1);
    expect(s.changing).toBe(false);
  });

  it('takes the short way round: winter → spring does not pass through autumn', () => {
    const s = new SeasonState('winter');
    s.set('spring');
    let sawAutumn = false;
    for (let i = 0; i < 200; i++) {
      s.update(0.05);
      if (s.weights.z > 0.01) sawAutumn = true;
    }
    expect(sawAutumn).toBe(false);
    expect(s.weights.x).toBe(1);
  });

  it('blends per-season tables with the weights', () => {
    const s = new SeasonState('winter');
    expect(s.value(ACTIVITY.birds)).toBe(0);
    s.snap('spring');
    expect(s.value(ACTIVITY.birds)).toBe(1);
    // Halfway between spring and summer.
    s.pos = 0.5;
    s.update(0);
    expect(s.value([0, 1, 0, 0])).toBeCloseTo(0.5, 5);
  });

  it('no wildlife in winter, fireflies only in summer', () => {
    for (const k of ['birds', 'butterflies', 'dragonflies', 'swallows'] as const) expect(ACTIVITY[k][3]).toBe(0);
    expect(ACTIVITY.fireflies).toEqual([0, 1, 0, 0]);
  });
});
