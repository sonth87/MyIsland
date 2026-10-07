import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import { createNoise, createRng, type NoiseSet } from '@g2/engine';

/** Half size of the square world (world units ≈ metres). */
export const HALF = 210;
/** Height samples per side. */
export const GRID = 211;
export const CELL = (2 * HALF) / (GRID - 1);
export const WATER_Y = 0;

const { smoothstep, lerp, clamp } = MathUtils;

/** Nearest-point queries on a 2D polyline (XZ) through a uniform bin grid. */
export class PolylineIndex {
  private readonly bins = new Map<number, number[]>();

  constructor(
    readonly xs: Float32Array,
    readonly zs: Float32Array,
    private readonly bin = 12,
  ) {
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(Math.floor(xs[i] / bin), Math.floor(zs[i] / bin));
      let b = this.bins.get(k);
      if (!b) this.bins.set(k, (b = []));
      b.push(i);
    }
  }

  private key(bx: number, bz: number): number {
    return (bx + 1000) * 4000 + (bz + 1000);
  }

  /** Index and distance of the closest point within `maxDist`, or index -1. */
  nearest(x: number, z: number, maxDist: number, out = { index: -1, dist: Infinity }): { index: number; dist: number } {
    out.index = -1;
    out.dist = Infinity;
    const r = Math.ceil(maxDist / this.bin);
    const bx = Math.floor(x / this.bin);
    const bz = Math.floor(z / this.bin);
    let best = maxDist * maxDist;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const b = this.bins.get(this.key(bx + i, bz + j));
        if (!b) continue;
        for (const k of b) {
          const dx = this.xs[k] - x;
          const dz = this.zs[k] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            out.index = k;
          }
        }
      }
    }
    if (out.index >= 0) out.dist = Math.sqrt(best);
    return out;
  }
}

export interface RiverData {
  xs: Float32Array;
  zs: Float32Array;
  /** Half width at each point. */
  hw: Float32Array;
  index: PolylineIndex;
}

export interface RailData {
  xs: Float32Array;
  zs: Float32Array;
  /** Height of the top of the rails. */
  ys: Float32Array;
  /** 1 where the track runs on a bridge. */
  bridge: Uint8Array;
  /** 1 where the track runs through a tunnel. */
  tunnel: Uint8Array;
  count: number;
  /** Track length; samples are ~1 unit apart and the loop is closed. */
  length: number;
  index: PolylineIndex;
}

export interface Grove {
  center: Vector3;
  inner: number;
  outer: number;
}

export interface ValleyData {
  seed: string;
  /** Sakura forests: a ring round the castle hill and a hanami park across the river. */
  groves: Grove[];
  heights: Float32Array;
  river: RiverData;
  rail: RailData;
  /** Distance to the river centre line / the track, per height sample. */
  riverDist: Float32Array;
  railDist: Float32Array;
  castle: Vector3;
  station: { index: number; side: 1 | -1; length: number };
  village: Vector3;
  paddy: Vector3;
  footbridge: { center: Vector3; across: Vector3; length: number };
  heightAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
  isPaddy(x: number, z: number): boolean;
}

export const VILLAGE_RADIUS = 34;
export const PADDY_RADIUS = 26;
export const CASTLE_TOP_RADIUS = 28;

function sampleGrid(heights: Float32Array, x: number, z: number): number {
  const gx = clamp((x + HALF) / CELL, 0, GRID - 1.001);
  const gz = clamp((z + HALF) / CELL, 0, GRID - 1.001);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const i = iz * GRID + ix;
  const a = heights[i];
  const b = heights[i + 1];
  const c = heights[i + GRID];
  const d = heights[i + GRID + 1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/** Circular moving average. */
function smoothLoop(v: Float32Array, radius: number): void {
  const n = v.length;
  const copy = Float32Array.from(v);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += copy[(i + k + n) % n];
    v[i] = sum / (2 * radius + 1);
  }
}

/**
 * Generates the whole valley from a seed: base relief, a meandering river, the castle hill,
 * a closed railway loop graded into the terrain (bridges where it must leave the ground),
 * the station, the village and the rice paddies. Deterministic for a given seed.
 */
export function generateValley(seed: string): ValleyData {
  const rng = createRng(seed);
  const n: NoiseSet = createNoise(rng);
  const heights = new Float32Array(GRID * GRID);
  const riverDist = new Float32Array(GRID * GRID);
  const railDist = new Float32Array(GRID * GRID).fill(999);
  const phase = rng() * 100;

  // ---- river: north → south, meandering
  const riverX = (z: number) => 48 * n.noise(z * 0.004, phase, 0) + 20 * Math.sin(z * 0.018 + phase);
  const rxs: number[] = [];
  const rzs: number[] = [];
  const rhw: number[] = [];
  for (let z = -HALF - 30; z <= HALF + 30; z += 1.5) {
    rxs.push(riverX(z));
    rzs.push(z);
    rhw.push(8 + 2.5 * n.noise(z * 0.02, phase + 3, 0));
  }
  const river: RiverData = {
    xs: Float32Array.from(rxs),
    zs: Float32Array.from(rzs),
    hw: Float32Array.from(rhw),
    index: null as unknown as PolylineIndex,
  };
  river.index = new PolylineIndex(river.xs, river.zs);

  // ---- castle hill on the opposite side of the river from the valley centre
  const castleZ = -45 + rng() * 20;
  const rxAtCastle = riverX(castleZ);
  const castleSide = rxAtCastle > 0 ? -1 : 1;
  const castle = new Vector3(clamp(rxAtCastle + castleSide * 88, -100, 100), 0, castleZ);

  const base = (x: number, z: number) => {
    const r = Math.hypot(x * 0.95, z) / HALF;
    const rim = smoothstep(r, 0.6, 1.02);
    const hills = (n.fbm(x * 0.011, 0.3, z * 0.011) * 0.5 + 0.5) * 9;
    const ridges = n.ridged(x * 0.018, 1.7, z * 0.018) * 16 * rim;
    return 3 + hills + rim * 30 + ridges;
  };

  const q = { index: -1, dist: Infinity };
  // River points are sorted by z (1.5 apart): only a z-window can be within `max` of a point.
  const z0 = river.zs[0];
  const riverNearest = (x: number, z: number, max: number) => {
    const lo = Math.max(0, Math.floor((z - max - z0) / 1.5));
    const hi = Math.min(river.zs.length - 1, Math.ceil((z + max - z0) / 1.5));
    let best = max * max;
    q.index = -1;
    for (let k = lo; k <= hi; k++) {
      const dx = river.xs[k] - x;
      const dz = river.zs[k] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        q.index = k;
      }
    }
    q.dist = q.index >= 0 ? Math.sqrt(best) : max;
    return q;
  };
  // Pass 1: relief + river + castle hill.
  const castleTop = base(castle.x, castle.z) * 0.5 + 16;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -HALF + i * CELL;
      const z = -HALF + j * CELL;
      let h = base(x, z);
      riverNearest(x, z, 90);
      const d = q.dist;
      const hw = q.index >= 0 ? river.hw[q.index] : 9;
      riverDist[j * GRID + i] = d;
      // Wide flat valley floor near the river, then the river bed itself.
      h = 2.2 + (h - 2.2) * smoothstep(d, hw + 4, hw + 75);
      if (d < hw + 7) {
        const bed = -2.4 + 1.8 * Math.min(1, (d / hw) ** 2);
        h = lerp(bed, h, smoothstep(d, hw - 2, hw + 7));
      }
      const cd = Math.hypot(x - castle.x, z - castle.z);
      h = lerp(h, castleTop, 1 - smoothstep(cd, CASTLE_TOP_RADIUS, 62));
      heights[j * GRID + i] = h;
    }
  }
  castle.y = castleTop;
  const ground = (x: number, z: number) => sampleGrid(heights, x, z);

  // ---- railway: an irregular closed route that wanders out to the mountains (and the snow)
  // Star-shaped around the valley centre (one point per angle), so it can't cross itself.
  const center = new Vector3(rng() * 10 - 5, 0, rng() * 10 - 5);
  const K = 30;
  // Two long excursions into the mountains (long enough to climb gradually) and a shorter one.
  const lobes = Array.from({ length: 3 }, (_, i) => ({
    angle: ((i + rng() * 0.5) / 3) * Math.PI * 2,
    reach: i < 2 ? 0.22 + rng() * 0.06 : 0.14 + rng() * 0.06,
    width: i < 2 ? 0.55 + rng() * 0.25 : 0.35,
  }));
  const ctrl: Vector3[] = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    // Wide sweep out near the rim of the valley, pushed further into the mountains by the lobes.
    let r = 0.66 + 0.08 * n.noise(Math.cos(a) * 1.7, Math.sin(a) * 1.7, phase + 9);
    for (const l of lobes) {
      const d = Math.atan2(Math.sin(a - l.angle), Math.cos(a - l.angle));
      r += l.reach * Math.exp(-((d / l.width) ** 2));
    }
    r = clamp(r, 0.58, 0.93) * HALF;
    const p = new Vector3(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r * 0.95);
    p.x = clamp(p.x, -HALF + 12, HALF - 12);
    p.z = clamp(p.z, -HALF + 12, HALF - 12);
    const away = new Vector3(p.x - castle.x, 0, p.z - castle.z);
    if (away.length() < 78) p.add(away.setLength(78 - away.length()));
    ctrl.push(p);
  }
  const curve = new CatmullRomCurve3(ctrl, true, 'centripetal');
  const count = Math.round(curve.getLength());
  const pts = curve.getSpacedPoints(count).slice(0, count);
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);
  const ys = new Float32Array(count);
  const groundAt = new Float32Array(count);
  const nearRiver = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = pts[i].x;
    zs[i] = pts[i].z;
    groundAt[i] = ground(xs[i], zs[i]);
    river.index.nearest(xs[i], zs[i], 30, q);
    nearRiver[i] = q.index >= 0 && q.dist < river.hw[q.index] + 12 ? 1 : 0;
    // Wanted height: on the ground, high enough over the river for boats.
    ys[i] = Math.max(groundAt[i] + 0.6, 2.6, nearRiver[i] ? 7 : 0);
  }
  // Grade: smooth, then limit the gradient (lower the peaks → tunnels, raise the dips →
  // viaducts), then round off the vertical curves.
  for (let pass = 0; pass < 2; pass++) smoothLoop(ys, 6);
  const GRADE = 0.06;
  for (let it = 0; it < 10; it++) {
    // River crossings must stay high: re-apply that each round so the approaches ramp up to it.
    for (let i = 0; i < count; i++) if (nearRiver[i]) ys[i] = Math.max(ys[i], 7);
    for (let i = 0; i < count * 2; i++) {
      const a = ys[(i - 1 + count) % count];
      const k = i % count;
      ys[k] = clamp(ys[k], a - GRADE, a + GRADE);
    }
    for (let i = count * 2; i > 0; i--) {
      const a = ys[(i + 1) % count];
      const k = i % count;
      ys[k] = clamp(ys[k], a - GRADE, a + GRADE);
    }
  }
  smoothLoop(ys, 8);

  // Tunnels where the track runs deep under the ground; drop very short ones (they become cuttings).
  const tunnel = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (groundAt[i] - ys[i] > 6.8 && !nearRiver[i]) tunnel[i] = 1;
  {
    let s0 = 0;
    while (s0 < count && tunnel[s0]) s0++;
    let start = -1;
    for (let k = 1; k <= count; k++) {
      const i = (s0 + k) % count;
      if (tunnel[i] && start < 0) start = i;
      if (!tunnel[i] && start >= 0) {
        const len = (i - start + count) % count;
        if (len < 12) for (let m = 0; m < len; m++) tunnel[(start + m) % count] = 0;
        start = -1;
      }
    }
  }
  // Bridges wherever the track would float more than ~2 m above the ground.
  const bridge = new Uint8Array(count);
  // (Lower embankments are just filled in.)
  for (let i = 0; i < count; i++) if (!tunnel[i] && (groundAt[i] < ys[i] - 3.5 || nearRiver[i])) bridge[i] = 1;
  const grown = Uint8Array.from(bridge);
  for (let i = 0; i < count; i++) {
    if (!bridge[i]) continue;
    for (let k = -4; k <= 4; k++) {
      const j = (i + k + count) % count;
      if (!tunnel[j]) grown[j] = 1;
    }
  }
  // Close short gaps between bridge spans.
  for (let i = 0; i < count; i++) {
    if (grown[i] || tunnel[i]) continue;
    let gap = 0;
    while (gap < 12 && !grown[(i + gap) % count] && !tunnel[(i + gap) % count]) gap++;
    if (gap < 12 && grown[(i + gap) % count] && grown[(i - 1 + count) % count]) for (let k = 0; k < gap; k++) grown[(i + k) % count] = 1;
  }
  const railIndex = new PolylineIndex(xs, zs, 10);
  const rail: RailData = { xs, zs, ys, bridge: grown, tunnel, count, length: count, index: railIndex };

  // Cut and fill the terrain into a track bed (only cut under bridges; leave mountains over tunnels).
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -HALF + i * CELL;
      const z = -HALF + j * CELL;
      railIndex.nearest(x, z, 16, q);
      if (q.index < 0 || tunnel[q.index]) continue;
      const k = j * GRID + i;
      railDist[k] = q.dist;
      const target = ys[q.index] - 0.55;
      const w = 1 - smoothstep(q.dist, 5, 16);
      const h = heights[k];
      if (grown[q.index]) {
        if (h > target - 1.5) heights[k] = lerp(h, Math.min(h, target - 1.5), w);
      } else {
        heights[k] = lerp(h, target, w);
      }
    }
  }

  // ---- station: a flat, straight-ish stretch away from the river and the castle, low in the
  // valley and level with the land beside it (so the village doesn't end up on a mound).
  /** Mean natural ground height in a disc. */
  const meanGround = (cx: number, cz: number, r: number) => {
    let sum = 0;
    let n2 = 0;
    for (let a = 0; a < 8; a++) {
      for (const f of [0, 0.5, 1]) {
        sum += ground(cx + Math.cos(a * 0.785) * r * f, cz + Math.sin(a * 0.785) * r * f);
        n2++;
      }
    }
    return sum / n2;
  };
  const villageSpot = (i: number, side: number) => {
    const tx0 = xs[(i + 1) % count] - xs[i];
    const tz0 = zs[(i + 1) % count] - zs[i];
    const tl0 = Math.hypot(tx0, tz0) || 1;
    return [xs[i] + (-tz0 / tl0) * side * 36, zs[i] + (tx0 / tl0) * side * 36] as const;
  };
  let bestI = 0;
  let bestScore = Infinity;
  for (let i = 0; i < count; i += 3) {
    let ok = true;
    for (let k = -24; k <= 24 && ok; k += 4) if (grown[(i + k + count) % count] || tunnel[(i + k + count) % count]) ok = false;
    if (!ok) continue;
    const dy = Math.abs(ys[(i + 20) % count] - ys[(i - 20 + count) % count]);
    river.index.nearest(xs[i], zs[i], 200, q);
    const dRiver = q.dist;
    const dCastle = Math.hypot(xs[i] - castle.x, zs[i] - castle.z);
    if (dRiver < 40 || dCastle < 95) continue;
    const a = Math.atan2(zs[(i + 10) % count] - zs[i], xs[(i + 10) % count] - xs[i]);
    const b = Math.atan2(zs[i] - zs[(i - 10 + count) % count], xs[i] - xs[(i - 10 + count) % count]);
    const bend = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    // Which side faces the valley centre, and how far the land there is from rail level.
    const sx = -(zs[(i + 1) % count] - zs[i]);
    const sz = xs[(i + 1) % count] - xs[i];
    const sd = sx * (center.x - xs[i]) + sz * (center.z - zs[i]) > 0 ? 1 : -1;
    const [vx, vz] = villageSpot(i, sd);
    const mismatch = Math.abs(meanGround(vx, vz, VILLAGE_RADIUS) - (ys[i] - 0.6));
    const score = dy * 3 + bend * 20 + Math.abs(dRiver - 70) * 0.05 + Math.max(0, ys[i] - 5) * 0.8 + mismatch * 6 + rng() * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestI = i;
    }
  }
  const si = bestI;
  const tx = xs[(si + 1) % count] - xs[si];
  const tz = zs[(si + 1) % count] - zs[si];
  const tl = Math.hypot(tx, tz) || 1;
  const nx = -tz / tl;
  const nz = tx / tl;
  // Village on the side facing the valley centre.
  const toCenterX = center.x - xs[si];
  const toCenterZ = center.z - zs[si];
  const side: 1 | -1 = nx * toCenterX + nz * toCenterZ > 0 ? 1 : -1;
  // The village and the paddies sit at the natural height of their land, between it and the
  // track level, rather than being raised to the rails.
  const village = new Vector3(xs[si] + nx * side * 36, 0, zs[si] + nz * side * 36);
  // Mostly at platform level so the station opens onto the street; the soft blend below
  // eases it into the surrounding land.
  village.y = lerp(meanGround(village.x, village.z, VILLAGE_RADIUS), ys[si] - 0.6, 0.8);
  const paddy = new Vector3(xs[si] + (tx / tl) * 62 + nx * side * 30, 0, zs[si] + (tz / tl) * 62 + nz * side * 30);
  paddy.y = meanGround(paddy.x, paddy.z, PADDY_RADIUS) - 0.3;

  // Flatten village and paddies (but never fill the river or the track bed).
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -HALF + i * CELL;
      const z = -HALF + j * CELL;
      const k = j * GRID + i;
      if (riverDist[k] < 14) continue;
      const dv = Math.hypot(x - village.x, z - village.z);
      const dp = Math.hypot(x - paddy.x, z - paddy.z);
      const keepRail = smoothstep(railDist[k], 4, 9);
      // Long, soft blends so the flattened areas melt into the hills instead of forming steps.
      const soft = (d: number, r: number, out: number) => {
        const t = 1 - smoothstep(d, r - 4, r + out);
        return t * t * (3 - 2 * t);
      };
      if (dv < VILLAGE_RADIUS + 36) heights[k] = lerp(heights[k], village.y, soft(dv, VILLAGE_RADIUS, 36) * keepRail);
      if (dp < PADDY_RADIUS + 26) heights[k] = lerp(heights[k], paddy.y, soft(dp, PADDY_RADIUS, 26) * keepRail);
    }
  }

  // ---- red footbridge over the river, near the village
  river.index.nearest(village.x, village.z, 400, q);
  const fi = clamp(q.index, 2, river.xs.length - 3);
  const ft = new Vector3(river.xs[fi + 2] - river.xs[fi - 2], 0, river.zs[fi + 2] - river.zs[fi - 2]).normalize();
  const across = new Vector3(-ft.z, 0, ft.x);
  const footbridge = {
    center: new Vector3(river.xs[fi], 0, river.zs[fi]),
    across,
    length: river.hw[fi] * 2 + 7,
  };

  const heightAt = (x: number, z: number) => sampleGrid(heights, x, z);
  // Hanami park on the far bank from the village, next to the footbridge.
  const awaySide = Math.sign(across.x * (village.x - footbridge.center.x) + across.z * (village.z - footbridge.center.z)) || 1;
  const park = footbridge.center.clone().addScaledVector(across, -awaySide * (river.hw[fi] + 26));
  const groves: Grove[] = [
    { center: castle.clone(), inner: CASTLE_TOP_RADIUS + 2, outer: CASTLE_TOP_RADIUS + 36 },
    { center: park, inner: 0, outer: 28 },
  ];
  return {
    seed,
    groves,
    heights,
    river,
    rail,
    riverDist,
    railDist,
    castle,
    station: { index: si, side, length: 34 },
    village,
    paddy,
    footbridge,
    heightAt,
    slopeAt: (x, z) => {
      const e = 1.5;
      return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    },
    isPaddy: (x, z) => {
      const d = Math.hypot(x - paddy.x, z - paddy.z);
      if (d > PADDY_RADIUS - 3) return false;
      const k = Math.round((z + HALF) / CELL) * GRID + Math.round((x + HALF) / CELL);
      // Only the level part: no paddies spilling onto the slopes around them.
      return (railDist[k] ?? 999) > 7 && (riverDist[k] ?? 0) > 14 && Math.abs(heightAt(x, z) - paddy.y) < 0.5;
    },
  };
}

/** Value of a per-sample grid at a world position (nearest sample). */
export function gridValue(grid: Float32Array, x: number, z: number): number {
  const i = clamp(Math.round((x + HALF) / CELL), 0, GRID - 1);
  const j = clamp(Math.round((z + HALF) / CELL), 0, GRID - 1);
  return grid[j * GRID + i];
}

/** Position, tangent and height on the track at arc length `s` (wraps around the loop). */
export function railPose(rail: RailData, s: number, outPos: Vector3, outTan: Vector3): void {
  const L = rail.length;
  const t = ((s % L) + L) % L;
  const i = Math.floor(t);
  const f = t - i;
  const a = i % rail.count;
  const b = (i + 1) % rail.count;
  outPos.set(
    lerp(rail.xs[a], rail.xs[b], f),
    lerp(rail.ys[a], rail.ys[b], f),
    lerp(rail.zs[a], rail.zs[b], f),
  );
  outTan.set(rail.xs[b] - rail.xs[a], rail.ys[b] - rail.ys[a], rail.zs[b] - rail.zs[a]).normalize();
}

/** 0..1: how deep inside a sakura grove a point is. */
export function groveWeight(v: ValleyData, x: number, z: number): number {
  let w = 0;
  for (const g of v.groves) {
    const d = Math.hypot(x - g.center.x, z - g.center.z);
    if (d < g.inner - 2 || d > g.outer + 4) continue;
    w = Math.max(w, Math.min(smoothstep(d, g.inner - 2, g.inner + 3), 1 - smoothstep(d, g.outer - 4, g.outer + 4)));
  }
  return w;
}
