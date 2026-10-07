import { describe, expect, it } from 'vitest';
import { findBridges } from './railMesh';
import { generateValley, gridValue, WATER_Y } from './ValleyGen';

describe('generateValley', () => {
  const seeds = ['himeji-castle', 'sakura', 'himeji', 'a', 'b'];

  it('is deterministic for a seed', () => {
    const a = generateValley('det');
    const b = generateValley('det');
    expect(a.heights).toEqual(b.heights);
    expect(a.rail.ys).toEqual(b.rail.ys);
  });

  for (const seed of seeds) {
    it(`builds a sane valley (${seed})`, () => {
      const t0 = performance.now();
      const v = generateValley(seed);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(3000);

      const r = v.rail;
      // Closed loop with ~1 unit spacing.
      for (let i = 0; i < r.count; i++) {
        const j = (i + 1) % r.count;
        expect(Math.hypot(r.xs[j] - r.xs[i], r.zs[j] - r.zs[i])).toBeLessThan(1.6);
        // Never under water, and never buried in the ground.
        expect(r.ys[i]).toBeGreaterThan(WATER_Y + 2);
        let nearTunnel = false;
        for (let k = -4; k <= 4; k++) if (r.tunnel[(i + k + r.count) % r.count] || r.bridge[(i + k + r.count) % r.count]) nearTunnel = true;
        // (Next to a tunnel the ground rises over the portal, under a bridge end it is dug out, on purpose.)
        if (!r.bridge[i] && !nearTunnel) expect(Math.abs(v.heightAt(r.xs[i], r.zs[i]) - (r.ys[i] - 0.55))).toBeLessThan(1.6);
        // Gentle enough for a steam train.
        const j2 = (i + 10) % r.count;
        expect(Math.abs(r.ys[j2] - r.ys[i]) / 10).toBeLessThan(0.065);
      }
      // The track crosses the river on bridges.
      for (let i = 0; i < r.count; i++) {
        if (gridValue(v.riverDist, r.xs[i], r.zs[i]) < 6) expect(r.bridge[i]).toBe(1);
      }
      expect(findBridges(r).length).toBeGreaterThanOrEqual(1);
      // The route climbs into the hills.
      expect(Math.max(...r.ys)).toBeGreaterThan(18);
      // The station sits on solid ground.
      for (let k = -17; k <= 17; k++) expect(r.bridge[(v.station.index + k + r.count) % r.count]).toBe(0);
      // Castle on its hill, village on land.
      expect(v.castle.y).toBeGreaterThan(10);
      expect(v.heightAt(v.village.x, v.village.z)).toBeGreaterThan(WATER_Y + 1);
    });
  }
});
