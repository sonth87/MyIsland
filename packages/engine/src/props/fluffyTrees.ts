import * as THREE from 'three';
import type { Rng } from '../world/rng';
import { aimSpray, ATLAS, leafCluster, shadeCard, solidUv, sprayCard, type AtlasRegion } from './foliage';
import { merge, paint, SEASON_KIND, seasonKind, type SeasonKind } from './lowpoly';
import type { TreeColors } from './trees';

/**
 * Detailed trees for the high detail levels: real branching wood and canopies of alpha-cut leaf
 * cards (see `foliage.ts`). Same size range and origin as the low-poly trees they replace, so
 * the far LOD still matches. Use with `foliageMaterials()`.
 */
export interface FluffyTree {
  geometry: THREE.BufferGeometry;
  crownTop: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();

/** Tapered branch from `a` to `b` (uvs in the solid atlas cell). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: string, sides = 6): THREE.BufferGeometry {
  _d.subVectors(b, a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true).translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, _d.normalize());
  g.applyQuaternion(_q).translate(a.x, a.y, a.z);
  return solidUv(paint(g, color, true));
}

function outward(azimuth: number, tilt: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));
}

interface Tip {
  p: THREE.Vector3;
  r: number;
}

interface CrownStyle {
  cell: AtlasRegion;
  kind: SeasonKind;
  /** First fork height range. */
  trunk: [number, number];
  /** Main limbs from the first fork, and how far they lean out (radians from vertical). */
  limbs: [number, number];
  tilt: [number, number];
  /** Length of the first limbs; each further level is ~0.75 of its parent. */
  reach: number;
  depth: number;
  /** Leaf cluster radius at the tips, cards per cluster, card size. */
  cluster: number;
  cards: number;
  card: number;
  squash: number;
  /** Lighter colour for the top of the crown. */
  top?: (c: TreeColors) => string | undefined;
  depthShade?: number;
}

const BROADLEAF: CrownStyle = {
  cell: ATLAS.leaf,
  kind: SEASON_KIND.leaf,
  trunk: [1.5, 2.1],
  limbs: [2, 3],
  tilt: [0.25, 0.6],
  reach: 1.05,
  depth: 3,
  cluster: 0.8,
  cards: 16,
  card: 0.95,
  squash: 0.85,
};

const MAPLE: CrownStyle = { ...BROADLEAF, cell: ATLAS.maple, kind: SEASON_KIND.maple, trunk: [1.3, 1.8], tilt: [0.35, 0.75], cluster: 0.82, card: 0.9 };

const SAKURA: CrownStyle = {
  cell: ATLAS.blossom,
  kind: SEASON_KIND.blossom,
  trunk: [1.1, 1.6],
  limbs: [3, 5],
  tilt: [0.75, 1.15],
  reach: 1.2,
  depth: 2,
  cluster: 0.95,
  cards: 20,
  card: 0.95,
  squash: 0.7,
  top: (c) => c.leaves[3] ?? c.leaves[1],
  depthShade: 0.35,
};

/** Branching tree: a gently bent trunk, limbs forking a few times, a leaf cluster at every tip. */
function branchingTree(rng: Rng, c: TreeColors, s: CrownStyle): FluffyTree {
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const tips: Tip[] = [];
  const h = s.trunk[0] + rng() * (s.trunk[1] - s.trunk[0]);
  const lean = new THREE.Vector3((rng() - 0.5) * 0.45, 0, (rng() - 0.5) * 0.45);
  const mid = new THREE.Vector3(lean.x * 0.3 + (rng() - 0.5) * 0.15, h * 0.5, lean.z * 0.3 + (rng() - 0.5) * 0.15);
  const fork = new THREE.Vector3(lean.x, h, lean.z);
  wood.push(limb(new THREE.Vector3(0, -0.15, 0), mid, 0.17, 0.13, c.trunk, 8), limb(mid, fork, 0.13, 0.1, c.trunk, 8));

  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const bendAt = from.clone().addScaledVector(dir, len * 0.5);
    const dir2 = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, 0.12, (rng() - 0.5) * 0.3)).normalize();
    const to = bendAt.clone().addScaledVector(dir2, len * 0.5);
    const sides = depth >= 2 ? 6 : 4;
    wood.push(limb(from, bendAt, r, r * 0.85, c.trunk, sides), limb(bendAt, to, r * 0.85, r * 0.68, c.trunk, sides));
    if (depth === 0) {
      tips.push({ p: to, r: s.cluster * (0.85 + rng() * 0.3) });
      return;
    }
    // Smaller clusters partway along older limbs fill the inside of the crown.
    if (depth === 1 || (depth === 2 && rng() < 0.5)) tips.push({ p: bendAt.clone(), r: s.cluster * 0.75 });
    // The leader carries on, side shoots fork off.
    const az0 = Math.atan2(dir2.z, dir2.x);
    grow(to, dir2.clone().lerp(UP, 0.15).normalize(), len * 0.76, r * 0.68, depth - 1);
    const n = depth >= 2 ? 1 + Math.floor(rng() * 2) : 1;
    for (let k = 0; k < n; k++) {
      const az = az0 + (k % 2 ? 1 : -1) * (0.9 + rng() * 1.2);
      const sideDir = outward(az, 0.5 + rng() * 0.45).lerp(dir2, 0.3).normalize();
      grow(to, sideDir, len * 0.68, r * 0.55, depth - 1);
    }
  };

  const limbs = s.limbs[0] + Math.floor(rng() * (s.limbs[1] - s.limbs[0] + 1));
  const az0 = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const az = az0 + (i / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    const tilt = s.tilt[0] + rng() * (s.tilt[1] - s.tilt[0]);
    // One limb stays upright as the leader in tall crowns.
    const dir = i === 0 && s.depth >= 3 ? outward(az, tilt * 0.3) : outward(az, tilt);
    grow(fork, dir, s.reach * (0.85 + rng() * 0.3), 0.085, s.depth - 1);
  }

  const box = new THREE.Box3();
  for (const t of tips) box.expandByPoint(t.p);
  const crown = { center: box.getCenter(new THREE.Vector3()), radius: 0 };
  for (const t of tips) crown.radius = Math.max(crown.radius, t.p.distanceTo(crown.center) + t.r);
  let top = 0;
  const topColor = s.top?.(c);
  for (const t of tips) {
    leafCluster(leaves, rng, {
      center: t.p,
      radius: t.r,
      cards: Math.round(s.cards * (t.r / s.cluster)),
      size: s.card,
      cell: s.cell,
      colors: c.leaves.slice(0, 3),
      crown,
      kind: s.kind,
      squash: s.squash,
      topColor,
      depthShade: s.depthShade,
    });
    top = Math.max(top, t.p.y + t.r);
  }
  return { geometry: merge([...wood, ...leaves]), crownTop: top };
}

/**
 * Conifer: a straight trunk with whorls of drooping needle sprays, long at the bottom and
 * short at the top. Every branch is a flat spray plus a crossed one (so it has body from the
 * side) and, on the longer ones, two side sprays.
 */
function fluffyPine(rng: Rng, c: TreeColors): FluffyTree {
  const wood: THREE.BufferGeometry[] = [];
  const sprays: THREE.BufferGeometry[] = [];
  const H = 4.6 + rng() * 2.2;
  wood.push(limb(new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, H * 0.35, 0), 0.26, 0.17, c.trunk, 8));
  wood.push(limb(new THREE.Vector3(0, H * 0.35, 0), new THREE.Vector3(0, H * 0.97, 0), 0.17, 0.03, c.trunk, 6));
  const whorls = 11 + Math.floor(rng() * 3);
  const y0 = H * 0.17;
  const maxL = 2.0 + rng() * 0.3;
  const spray = (at: THREE.Vector3, az: number, pitch: number, len: number, droop: number, roll: number, axisY: number) => {
    const g = aimSpray(sprayCard(ATLAS.fir, len, len * 0.6, 4, droop, roll), az, pitch, at);
    const color = c.leaves[Math.floor(rng() * c.leaves.length)];
    const tone = 0.88 + rng() * 0.24;
    shadeCard(
      g,
      color,
      // Outwards from the trunk and upwards: the upper side of each tier catches the light.
      (v, n) => {
        const d = Math.hypot(v.x, v.z) || 1;
        n.set((v.x / d) * 0.85, 0.75 + (v.y - axisY) * 0.4, (v.z / d) * 0.85);
      },
      (v) => tone * (0.52 + 0.55 * Math.min(1, Math.hypot(v.x, v.z) / (maxL * 0.8))),
    );
    sprays.push(seasonKind(g, SEASON_KIND.evergreen, new THREE.Vector3(0, axisY, 0)));
  };
  for (let w = 0; w < whorls; w++) {
    const f = w / (whorls - 1);
    const y = y0 + (H * 0.94 - y0) * Math.pow(f, 0.95) + (rng() - 0.5) * 0.12;
    const L = (0.3 + maxL * Math.pow(1 - f, 1.05)) * (0.88 + rng() * 0.24);
    const n = Math.round(5 + (1 - f) * 2);
    const az0 = rng() * Math.PI * 2;
    for (let b = 0; b < n; b++) {
      const az = az0 + (b / n) * Math.PI * 2 + (rng() - 0.5) * 0.4;
      const pitch = -0.12 + f * 0.45 + (rng() - 0.5) * 0.15;
      const droop = 0.18 + (1 - f) * 0.3;
      const at = new THREE.Vector3(Math.cos(az) * 0.06, y, Math.sin(az) * 0.06);
      spray(at, az, pitch, L, droop, (rng() - 0.5) * 0.5, y);
      spray(at, az + (rng() - 0.5) * 0.3, pitch + 0.08, L * 0.85, droop, (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 0.3), y);
      if (L > 0.9) {
        const mid = at.clone().add(new THREE.Vector3(Math.cos(az) * L * 0.35, -droop * 0.1 * L, Math.sin(az) * L * 0.35));
        for (const side of [-1, 1]) spray(mid, az + side * (0.55 + rng() * 0.2), pitch - 0.05, L * 0.5, droop * 0.8, (rng() - 0.5) * 0.4, y);
      }
      if (L > 1.1) {
        const end = at.clone().add(new THREE.Vector3(Math.cos(az) * L * 0.55, -droop * 0.25 * L + Math.sin(pitch) * L * 0.5, Math.sin(az) * L * 0.55));
        wood.push(limb(at, end, 0.05, 0.015, c.trunk, 4));
      }
    }
  }
  // Leader: a few short sprays pointing up.
  for (let k = 0; k < 4; k++) spray(new THREE.Vector3(0, H * 0.9, 0), (k / 4) * Math.PI * 2 + rng(), 1.15, 0.55, 0.05, (rng() - 0.5) * 0.6, H * 0.9);
  return { geometry: merge([...wood, ...sprays]), crownTop: H };
}

/** Bamboo clump: jointed culms with drooping sprays of long narrow leaves near the top. */
function fluffyBamboo(rng: Rng, c: TreeColors): FluffyTree {
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const n = 6 + Math.floor(rng() * 5);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const base = new THREE.Vector3((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2);
    const h = 4.5 + rng() * 3;
    const tip = base.clone().add(new THREE.Vector3((rng() - 0.5) * 0.9, h, (rng() - 0.5) * 0.9));
    wood.push(limb(base, tip, 0.065, 0.04, c.trunk, 6));
    for (let k = 1; k < 7; k++) {
      const p = base.clone().lerp(tip, k / 7);
      wood.push(solidUv(paint(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6).translate(p.x, p.y, p.z), '#5f8a3a')));
    }
    const crown = { center: base.clone().lerp(tip, 0.82), radius: h * 0.3 };
    for (let k = 0; k < 5; k++) {
      const p = base.clone().lerp(tip, 0.6 + k * 0.09);
      leafCluster(leaves, rng, {
        center: p.add(new THREE.Vector3((rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6)),
        radius: 0.45,
        cards: 6,
        size: 0.85,
        cell: ATLAS.bamboo,
        colors: c.leaves,
        crown,
        kind: SEASON_KIND.evergreen,
        squash: 0.6,
      });
    }
    top = Math.max(top, tip.y);
  }
  return { geometry: merge([...wood, ...leaves]), crownTop: top };
}

export const FLUFFY_TREES = {
  sakura: (rng: Rng, c: TreeColors) => branchingTree(rng, c, SAKURA),
  broadleaf: (rng: Rng, c: TreeColors) => branchingTree(rng, c, BROADLEAF),
  maple: (rng: Rng, c: TreeColors) => branchingTree(rng, c, MAPLE),
  pine: fluffyPine,
  bamboo: fluffyBamboo,
};
