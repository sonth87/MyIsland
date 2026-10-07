import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, type Rung } from './AdaptiveQuality';

function setup() {
  const app = {
    pixelRatioScale: 1,
    setPixelRatioScale(v: number) {
      this.pixelRatioScale = v;
    },
  };
  const log: string[] = [];
  const rung = (id: string): Rung => ({ id, label: id, apply: () => log.push(id) });
  const q = new AdaptiveQuality(app, [rung('shadows'), rung('outline')], { window: 2, warmup: 0 });
  /** Two slow windows = one step. */
  const slow = () => {
    q.decide(20);
    q.decide(20);
  };
  return { app, q, log, slow };
}

describe('AdaptiveQuality', () => {
  it('does nothing while the frame rate is fine', () => {
    const { app, log, q } = setup();
    for (let i = 0; i < 20; i++) q.decide(60);
    expect(app.pixelRatioScale).toBe(1);
    expect(log).toEqual([]);
  });

  it('ignores a single slow window', () => {
    const { app, q } = setup();
    q.decide(15);
    q.decide(60);
    q.decide(15);
    expect(app.pixelRatioScale).toBe(1);
  });

  it('walks the ladder: resolution first, then the rungs in order, then the lowest resolution', () => {
    const { app, log, slow } = setup();
    slow();
    expect(app.pixelRatioScale).toBeCloseTo(0.85);
    slow();
    expect(app.pixelRatioScale).toBeCloseTo(0.72);
    expect(log).toEqual([]);
    slow();
    expect(log).toEqual(['shadows']);
    slow();
    expect(log).toEqual(['shadows', 'outline']);
    slow();
    expect(app.pixelRatioScale).toBeCloseTo(0.58);
    // Nothing left: stays put.
    slow();
    expect(app.pixelRatioScale).toBeCloseTo(0.58);
  });

  it('raises the resolution after a long calm stretch, but only if no rung was needed', () => {
    const { app, q, slow } = setup();
    slow();
    expect(app.pixelRatioScale).toBeCloseTo(0.85);
    // Let the controller's clock run so the cool-down passes.
    for (let i = 0; i < 40; i++) q.update(1);
    for (let i = 0; i < 12; i++) q.decide(60);
    expect(app.pixelRatioScale).toBeCloseTo(1);

    const b = setup();
    b.slow();
    b.slow();
    b.slow(); // shadows off
    for (let i = 0; i < 40; i++) b.q.update(1);
    for (let i = 0; i < 12; i++) b.q.decide(60);
    expect(b.app.pixelRatioScale).toBeCloseTo(0.72);
  });

  it('stops raising once it has been caught flip-flopping', () => {
    const { app, q, slow } = setup();
    slow();
    for (let i = 0; i < 40; i++) q.update(1);
    for (let i = 0; i < 12; i++) q.decide(60);
    expect(app.pixelRatioScale).toBeCloseTo(1);
    slow(); // slow again right after raising
    const low = app.pixelRatioScale;
    expect(low).toBeLessThan(1);
    for (let i = 0; i < 40; i++) q.update(1);
    for (let i = 0; i < 20; i++) q.decide(60);
    expect(app.pixelRatioScale).toBe(low);
  });
});
