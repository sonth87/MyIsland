import * as THREE from 'three';
import { lowpoly, q, type Rng } from '@g2/engine';
import type { Parts } from './japanese';
import { dormer, japaneseRoof } from './roofs';

const { paint } = lowpoly;

const WHITE = '#f4f2ec';
const TILE = '#5d6978';
const TRIM = '#f4f2ec';
const DARK = '#2e3238';
const STONES = ['#a39b8c', '#8f887b', '#b4ad9f', '#9a9385', '#7f786c'];
const GOLD = '#d9b44a';

const box = (w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), c);

/**
 * Ishigaki: a battered stone base whose walls curve in (gentle at the bottom, near vertical at
 * the top), built from rings with a random stone tint per facet.
 */
function stoneBase(rng: Rng, bw: number, bd: number, tw: number, td: number, h: number): THREE.BufferGeometry {
  // More, smaller stone facets at higher quality.
  const rows = q(5, 7, 12, 16);
  const per = q(4, 6, 10, 14);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const ringAt = (t: number) => {
    const k = (1 - t) ** 2;
    const hx = tw / 2 + (bw - tw) / 2 * k;
    const hz = td / 2 + (bd - td) / 2 * k;
    const pts: THREE.Vector3[] = [];
    const corners = [
      [hx, hz],
      [-hx, hz],
      [-hx, -hz],
      [hx, -hz],
    ];
    for (let e = 0; e < 4; e++) {
      const [x0, z0] = corners[e];
      const [x1, z1] = corners[(e + 1) % 4];
      for (let i = 0; i < per; i++) pts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / per, t * h, z0 + ((z1 - z0) * i) / per));
    }
    return pts;
  };
  const rings = Array.from({ length: rows + 1 }, (_, r) => ringAt(r / rows));
  const n = rings[0].length;
  const tri = (a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3) => {
    c.set(STONES[Math.floor(rng() * STONES.length)]);
    for (const p of [a, b, d]) {
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(rings[r][i], rings[r + 1][i], rings[r + 1][j]);
      tri(rings[r][i], rings[r + 1][j], rings[r][j]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Flat top (paved).
  const topCap = paint(new THREE.BoxGeometry(tw, 0.2, td).translate(0, h - 0.1, 0), '#b9b2a4');
  return lowpoly.merge([g, topCap]);
}

interface Tier {
  w: number;
  d: number;
  h: number;
}

/** A multi-storey keep: white walls with window rows, a curved roof on each storey, dormers. */
function keep(parts: Parts, tiers: Tier[], baseY: number, dormers: boolean): number {
  let y = baseY;
  tiers.forEach((t, i) => {
    parts.solid.push(box(t.w, t.h, t.d, WHITE, 0, y));
    parts.solid.push(box(t.w + 0.05, 0.25, t.d + 0.05, '#d9d4c8', 0, y));
    if (q(0, 0, 1, 1)) {
      // Nageshi bands and corner posts in light grey plaster.
      parts.solid.push(box(t.w + 0.06, 0.12, t.d + 0.06, '#d4d0c6', 0, y + t.h * 0.78));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.solid.push(box(0.18, t.h, 0.18, '#e2ddd2', (sx * t.w) / 2, y, (sz * t.d) / 2));
    }
    // Window rows on all four faces (dark by day, warm at night).
    const wy = y + t.h * 0.42;
    for (const [len, axis] of [
      [t.w, 'x'],
      [t.d, 'z'],
    ] as const) {
      const count = Math.max(2, Math.floor(len / 1.7));
      for (let k = 0; k < count; k++) {
        const o = (k - (count - 1) / 2) * (len / count);
        const g =
          axis === 'x'
            ? new THREE.BoxGeometry(0.6, 0.75, t.d + 0.08).translate(o, wy + 0.37, 0)
            : new THREE.BoxGeometry(t.w + 0.08, 0.75, 0.6).translate(0, wy + 0.37, o);
        parts.glow.push(paint(g, DARK));
        if (q(0, 0, 1, 1)) {
          // Window surround and a sill.
          const f =
            axis === 'x'
              ? new THREE.BoxGeometry(0.8, 0.95, t.d + 0.05).translate(o, wy + 0.37, 0)
              : new THREE.BoxGeometry(t.w + 0.05, 0.95, 0.8).translate(0, wy + 0.37, o);
          parts.solid.push(paint(f, '#cfcabf'));
          if (q(0, 0, 0, 1)) {
            // Lattice bars across the window.
            for (const bo of [-0.15, 0.15]) {
              const bar = axis === 'x' ? new THREE.BoxGeometry(0.05, 0.75, t.d + 0.12).translate(o + bo, wy + 0.37, 0) : new THREE.BoxGeometry(t.w + 0.12, 0.75, 0.05).translate(0, wy + 0.37, o + bo);
              parts.solid.push(paint(bar, '#3a3d42'));
            }
          }
        }
      }
    }
    y += t.h;
    const last = i === tiers.length - 1;
    const roofH = last ? 2.4 : 1.7;
    parts.solid.push(
      japaneseRoof({
        width: t.w,
        depth: t.d,
        height: roofH,
        overhang: last ? 1.5 : 1.7,
        color: TILE,
        trim: TRIM,
        under: '#d8d3c7',
        lift: 0.4,
        gable: last ? WHITE : undefined,
        y,
      }),
    );
    // Chidori-hafu dormers on alternating faces, a karahafu curve on the front of storey 2.
    if (dormers && !last) {
      const g = dormer(Math.min(4, t.w * 0.35), 1.2, 2.4, TILE, WHITE).translate(0, y + 0.25, t.d / 2 + 0.9);
      if (i % 2 === 1) g.rotateY(Math.PI / 2);
      parts.solid.push(g);
      const g2 = g.clone().rotateY(Math.PI);
      parts.solid.push(g2);
      if (i === 1) {
        const arc = paint(new THREE.TorusGeometry(1.3, 0.22, 4, 12, Math.PI).translate(0, y + 0.35, t.d / 2 + 1.5), TILE);
        parts.solid.push(arc);
      }
    }
    if (last) {
      // Shachihoko: golden fish on the ridge ends.
      const along = t.w >= t.d;
      const reach = Math.abs((t.w - t.d) / 2) + 0.4;
      for (const s of [-1, 1]) {
        const fish = new THREE.ConeGeometry(0.22, 0.7, 4).translate(0, 0.35, 0);
        parts.solid.push(paint(fish.translate(along ? s * reach : 0, y + roofH + 0.15, along ? 0 : s * reach), GOLD));
      }
    }
    y += last ? roofH : 0.55;
  });
  return y;
}

/** Walls along a polyline: white plaster under a little tiled cap. */
function wall(parts: Parts, pts: Array<[number, number]>, y: number, h = 2.2): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(z1 - z0, x1 - x0);
    const place = (g: THREE.BufferGeometry) => g.rotateY(-a).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    parts.solid.push(place(paint(new THREE.BoxGeometry(len, h, 0.7).translate(0, h / 2, 0), WHITE)));
    parts.solid.push(place(paint(new THREE.BoxGeometry(len + 0.2, 0.18, 1.3).translate(0, h + 0.05, 0), TILE)));
    parts.solid.push(place(paint(new THREE.BoxGeometry(len + 0.1, 0.16, 0.5).translate(0, h + 0.23, 0), TILE)));
  }
}

/**
 * Himeji-jō: main keep (5 storeys) on a tall curved stone base, three lesser keeps linked by
 * covered corridors, and white walls with a gate. Faces +Z. About 46 × 40 units.
 */
export function himeji(rng: Rng): Parts {
  const parts: Parts = { solid: [], glow: [] };
  const add = (g: THREE.BufferGeometry, x: number, z: number) => g.translate(x, 0, z);

  // Main keep.
  const main: Parts = { solid: [], glow: [] };
  main.solid.push(stoneBase(rng, 22, 19, 17, 14.5, 8));
  keep(
    main,
    [
      { w: 16.5, d: 14, h: 3.6 },
      { w: 15, d: 12.6, h: 3.1 },
      { w: 12.8, d: 10.6, h: 2.9 },
      { w: 10.4, d: 8.6, h: 2.7 },
      { w: 8.2, d: 6.8, h: 2.7 },
    ],
    8,
    true,
  );
  for (const g of main.solid) parts.solid.push(add(g, 0, 0));
  for (const g of main.glow) parts.glow.push(add(g, 0, 0));

  // Lesser keeps (west, north-west, east).
  const lesser: Array<[number, number, number, Tier[]]> = [
    [-16.5, 7, 6, [
      { w: 8.5, d: 7.5, h: 2.9 },
      { w: 7, d: 6, h: 2.5 },
      { w: 5.6, d: 4.8, h: 2.4 },
    ]],
    [-14, -10, 5.5, [
      { w: 7.5, d: 7, h: 2.7 },
      { w: 6, d: 5.4, h: 2.4 },
    ]],
    [15, 6, 5.5, [
      { w: 8, d: 7, h: 2.8 },
      { w: 6.2, d: 5.2, h: 2.4 },
    ]],
  ];
  for (const [x, z, h, tiers] of lesser) {
    const k: Parts = { solid: [stoneBase(rng, tiers[0].w + 4, tiers[0].d + 4, tiers[0].w + 0.6, tiers[0].d + 0.6, h)], glow: [] };
    keep(k, tiers, h, true);
    for (const g of k.solid) parts.solid.push(add(g, x, z));
    for (const g of k.glow) parts.glow.push(add(g, x, z));
  }

  // Watari-yagura: covered corridors between the keeps.
  for (const [x0, z0, x1, z1, y] of [
    [-8.5, 4, -12.5, 6, 6],
    [-8.5, -4, -11, -8, 5.5],
    [8.5, 4, 11.5, 5.5, 5.5],
  ]) {
    const len = Math.hypot(x1 - x0, z1 - z0) + 2;
    const a = Math.atan2(z1 - z0, x1 - x0);
    const corridor = lowpoly.merge([
      box(len, 2.4, 3.4, WHITE),
      japaneseRoof({ width: len, depth: 3.4, height: 1.1, overhang: 0.8, color: TILE, trim: TRIM, under: '#d8d3c7', lift: 0.2, y: 2.4 }),
    ]);
    parts.solid.push(corridor.rotateY(-a).translate((x0 + x1) / 2, y, (z0 + z1) / 2));
    parts.glow.push(paint(new THREE.BoxGeometry(len * 0.7, 0.6, 3.5).translate(0, 1.4, 0), DARK).rotateY(-a).translate((x0 + x1) / 2, y, (z0 + z1) / 2));
  }

  // Outer walls with a gate in front.
  wall(parts, [
    [-24, 13],
    [-24, -17],
    [24, -17],
    [24, 13],
    [6, 13],
  ], 0);
  wall(parts, [
    [-6, 13],
    [-24, 13],
  ], 0);
  // Gate: posts, beam and a small roof.
  for (const x of [-4.5, 4.5]) parts.solid.push(box(0.8, 3.8, 0.8, '#3d3430', x, 0, 13));
  parts.solid.push(box(10, 0.6, 1, '#3d3430', 0, 3.4, 13));
  parts.solid.push(japaneseRoof({ width: 10.5, depth: 2, height: 1.1, overhang: 0.8, color: TILE, trim: TRIM, lift: 0.25, y: 4 }).translate(0, 0, 13));
  return parts;
}
