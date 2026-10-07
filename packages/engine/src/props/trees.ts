import * as THREE from 'three';
import type { Rng } from '../world/rng';
import { q } from '../render/quality';
import { merge, paint, SEASON_KIND, seasonKind, type SeasonKind } from './lowpoly';

export type TreeSpecies = 'sakura' | 'broadleaf' | 'maple' | 'pine' | 'bamboo';

export interface TreeColors {
  trunk: string;
  leaves: string[];
}

export const DEFAULT_TREE_COLORS: Record<TreeSpecies, TreeColors> = {
  sakura: { trunk: '#4e3632', leaves: ['#f3b3c6', '#f8c9d6', '#eea0b8', '#fbdbe4'] },
  broadleaf: { trunk: '#6b4a37', leaves: ['#4f9a3f', '#6cba4b', '#5aa845', '#7cc455'] },
  maple: { trunk: '#5e4234', leaves: ['#d4553a', '#e97d45', '#c9452f', '#eda04c'] },
  pine: { trunk: '#5e4234', leaves: ['#2f7448', '#3f8c55', '#2a6a42'] },
  bamboo: { trunk: '#7fae4f', leaves: ['#6ba84a', '#8cc45c'] },
};

/** One tree shape: a detailed mesh for close range and a cheap one for far away. */
export interface TreeVariant {
  high: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  /** Height of the top of the crown (unscaled), e.g. for birds to perch on. */
  crownTop: number;
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();

/** Tapered cylinder from `a` to `b`. */
function segment(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: string, sides = 6): THREE.BufferGeometry {
  _d.subVectors(b, a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1).translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, _d.normalize());
  g.applyQuaternion(_q).translate(a.x, a.y, a.z);
  return paint(g, color);
}

/**
 * A leaf / blossom puff, squashed and randomly turned. `kind` says how it reacts to the
 * seasons; the puff shrinks towards its own centre when the leaves are shed.
 */
function puff(
  c: THREE.Vector3,
  r: number,
  color: string,
  rng: Rng,
  detail = 1,
  squash = 0.8,
  kind: SeasonKind = SEASON_KIND.leaf,
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail)
    .scale(1 + (rng() - 0.5) * 0.25, squash + (rng() - 0.5) * 0.2, 1 + (rng() - 0.5) * 0.25)
    .rotateY(rng() * Math.PI)
    .translate(c.x, c.y, c.z);
  return seasonKind(paint(g, color), kind, c);
}

/** Thin bare twigs fanning out from `from`, visible once the leaves are gone. */
function twigs(rng: Rng, from: THREE.Vector3, reach: number, count: number, color: string): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const dir = outward(rng() * Math.PI * 2, 0.35 + rng() * 0.9);
    const mid = from.clone().addScaledVector(dir, reach * (0.5 + rng() * 0.3));
    const tip = mid.clone().addScaledVector(outward(rng() * Math.PI * 2, 0.5 + rng() * 0.8), reach * (0.35 + rng() * 0.3));
    out.push(segment(from, mid, 0.05, 0.03, color, 4), segment(mid, tip, 0.03, 0.012, color, 3));
  }
  return out;
}

const pick = <T>(rng: Rng, list: T[]) => list[Math.floor(rng() * list.length)];

/** Random direction leaning outwards from the trunk, `tilt` radians from vertical. */
function outward(azimuth: number, tilt: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(tilt) * Math.cos(azimuth), Math.cos(tilt), Math.sin(tilt) * Math.sin(azimuth));
}

/**
 * Sakura: a short, gnarled trunk that splits into a few spreading limbs; each limb ends in a
 * cloud of small blossom clusters in several pinks (lighter on top), like a real cherry tree.
 */
function sakura(rng: Rng, c: TreeColors): TreeVariant {
  const high: THREE.BufferGeometry[] = [];
  const low: THREE.BufferGeometry[] = [];
  const trunkTop = new THREE.Vector3((rng() - 0.5) * 0.4, 1.3 + rng() * 0.5, (rng() - 0.5) * 0.4);
  const mid = new THREE.Vector3(trunkTop.x * 0.3 + (rng() - 0.5) * 0.3, trunkTop.y * 0.5, trunkTop.z * 0.3 + (rng() - 0.5) * 0.3);
  high.push(segment(new THREE.Vector3(), mid, 0.3, 0.24, c.trunk, 7), segment(mid, trunkTop, 0.24, 0.18, c.trunk, 7));
  low.push(segment(new THREE.Vector3(), trunkTop, 0.28, 0.18, c.trunk, 5));
  const limbs = 3 + Math.floor(rng() * 2);
  let top = 0;
  const az0 = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const az = az0 + (i / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const dir = outward(az, 0.55 + rng() * 0.45);
    const len = 1.3 + rng() * 0.9;
    const elbow = trunkTop.clone().addScaledVector(dir, len * 0.55);
    const tip = elbow.clone().addScaledVector(outward(az + (rng() - 0.5) * 0.8, 0.4 + rng() * 0.4), len * 0.55);
    high.push(segment(trunkTop, elbow, 0.17, 0.11, c.trunk, 6), segment(elbow, tip, 0.11, 0.05, c.trunk, 5));
    // Blossom cloud around the end of the limb, plus a few along it.
    const n = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const p = tip
        .clone()
        .lerp(elbow, k < 2 ? 0.6 : 0)
        .add(new THREE.Vector3((rng() - 0.5) * 1.5, (rng() - 0.3) * 0.9, (rng() - 0.5) * 1.5));
      const r = 0.45 + rng() * 0.38;
      const shade = p.y > tip.y + 0.15 ? c.leaves[3] ?? c.leaves[1] : pick(rng, c.leaves.slice(0, 3));
      high.push(puff(p, r, shade, rng, q(0, 0, 0, 1), 0.72, SEASON_KIND.blossom));
      top = Math.max(top, p.y + r * 0.7);
    }
    // Bare twigs that show in winter (a few fine ones on the detailed mesh, three stout ones on the simple one).
    if (q(0, 0, 1, 1)) high.push(...twigs(rng, tip, 0.9, 3, c.trunk), ...twigs(rng, elbow, 0.8, 2, c.trunk));
    low.push(segment(trunkTop, elbow, 0.14, 0.08, c.trunk, 3), segment(elbow, tip, 0.08, 0.03, c.trunk, 3));
    low.push(puff(tip.clone().add(new THREE.Vector3(0, 0.2, 0)), 1.25, c.leaves[0], rng, 0, 0.7, SEASON_KIND.blossom));
  }
  return { high: merge(high), low: merge(low), crownTop: top };
}

/** Broad-leaved tree (also maple): crooked trunk, a couple of branches, an uneven crown of puffs. */
function broadleaf(rng: Rng, c: TreeColors, kind: SeasonKind = SEASON_KIND.leaf): TreeVariant {
  const high: THREE.BufferGeometry[] = [];
  const low: THREE.BufferGeometry[] = [];
  const h = 1.6 + rng() * 0.9;
  const lean = new THREE.Vector3((rng() - 0.5) * 0.5, h, (rng() - 0.5) * 0.5);
  high.push(segment(new THREE.Vector3(), lean, 0.2, 0.12, c.trunk, 6));
  low.push(segment(new THREE.Vector3(), lean, 0.2, 0.12, c.trunk, 4));
  const center = lean.clone().add(new THREE.Vector3(0, 0.6 + rng() * 0.4, 0));
  for (let b = 0; b < 2; b++) {
    const az = rng() * Math.PI * 2;
    const from = lean.clone().multiplyScalar(0.65);
    high.push(segment(from, from.clone().addScaledVector(outward(az, 0.9), 0.9), 0.08, 0.04, c.trunk, 5));
  }
  const n = 5 + Math.floor(rng() * 4);
  let top = 0;
  const radius = 0.9 + rng() * 0.5;
  for (let k = 0; k < n; k++) {
    const p = center.clone().add(new THREE.Vector3((rng() - 0.5) * 2 * radius, (rng() - 0.35) * 1.3, (rng() - 0.5) * 2 * radius));
    const r = 0.55 + rng() * 0.45;
    high.push(puff(p, r, p.y > center.y ? c.leaves[1] : pick(rng, c.leaves), rng, 0, 0.85, kind));
    top = Math.max(top, p.y + r * 0.8);
  }
  // The crown's bare skeleton: a few forks and twigs that show once the leaves have fallen.
  high.push(segment(lean, center.clone().add(new THREE.Vector3(0, radius * 0.5, 0)), 0.1, 0.04, c.trunk, 5));
  if (q(0, 0, 1, 1)) high.push(...twigs(rng, lean, radius * 1.1, 4, c.trunk), ...twigs(rng, center, radius * 0.9, 4, c.trunk));
  else high.push(...twigs(rng, center, radius * 0.9, 2, c.trunk));
  for (let b = 0; b < 3; b++) {
    const az = rng() * Math.PI * 2;
    low.push(segment(lean, lean.clone().addScaledVector(outward(az, 0.7), radius * 1.4), 0.09, 0.03, c.trunk, 3));
  }
  low.push(puff(center, radius + 0.6, c.leaves[0], rng, 0, 0.85, kind));
  return { high: merge(high), low: merge(low), crownTop: top };
}

function pine(rng: Rng, c: TreeColors): TreeVariant {
  const high: THREE.BufferGeometry[] = [];
  const low: THREE.BufferGeometry[] = [];
  
  const height = 4.0 + rng() * 2.5;
  const trunkH = 0.5 + rng() * 0.5;
  
  // Trunk
  high.push(segment(new THREE.Vector3(), new THREE.Vector3(0, height, 0), 0.25, 0.05, c.trunk, 6));
  low.push(segment(new THREE.Vector3(), new THREE.Vector3(0, trunkH, 0), 0.25, 0.17, c.trunk, 4));

  const numWhorls = 18 + Math.floor(rng() * 10);
  const startY = trunkH * 0.5;
  
  for (let w = 0; w <= numWhorls; w++) {
    const f = w / numWhorls;
    const y = startY + f * (height - startY);
    
    // Fewer branches at top, more at bottom
    const branches = Math.max(3, Math.floor((1 - f) * 5 + 3));
    const angleOffset = rng() * Math.PI * 2;
    
    for (let b = 0; b < branches; b++) {
      const angle = angleOffset + (b / branches) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      
      const branchLen = (1.0 - f * 0.8) * (1.0 + rng() * 0.4) * 1.8;
      
      // Lower branches droop down, top branches point slightly up
      const droop = (1 - f) * 0.8 - 0.2 + (rng() - 0.5) * 0.1;
      const dir = outward(angle, Math.PI / 2 + droop);
      
      // Main branch volume (flattened cone)
      const width = branchLen * 0.35;
      const g = new THREE.ConeGeometry(width, branchLen, 4, 1);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, branchLen / 2);
      g.scale(1, 0.25, 1); // very flat
      
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
      g.applyQuaternion(q).translate(0, y, 0);
      high.push(paint(g, pick(rng, c.leaves)));
      
      // Sub-branches for high LOD
      if (branchLen > 0.5) {
        const numSub = Math.floor(branchLen * 2.5);
        for (let i = 1; i <= numSub; i++) {
          const sf = i / (numSub + 1);
          const subLen = branchLen * (1 - sf) * 0.7;
          const subWidth = subLen * 0.35;
          
          for (let side = -1; side <= 1; side += 2) {
            const up = new THREE.Vector3(0, 1, 0);
            const right = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(side);
            
            const subDir = dir.clone().multiplyScalar(0.6).add(right).normalize();
            subDir.y -= 0.15; // droop sub-branches
            subDir.normalize();
            
            const sg = new THREE.ConeGeometry(subWidth, subLen, 4, 1);
            sg.rotateX(Math.PI / 2);
            sg.translate(0, 0, subLen / 2);
            sg.scale(1, 0.25, 1);
            
            const sq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), subDir);
            sg.applyQuaternion(sq);
            
            const pos = dir.clone().multiplyScalar(branchLen * sf).add(new THREE.Vector3(0, y, 0));
            sg.translate(pos.x, pos.y, pos.z);
            high.push(paint(sg, pick(rng, c.leaves)));
          }
        }
      }
    }
  }

  // Top cap
  high.push(puff(new THREE.Vector3(0, height, 0), 0.25, pick(rng, c.leaves), rng, 0, 1.0));

  // Low detail (layered cones)
  const tiers = 3 + Math.floor(rng() * 3);
  const bend = (rng() - 0.5) * 0.2;
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = (1.25 - f * 0.85) * (0.9 + rng() * 0.25);
    const h = ((height - trunkH) / tiers) * (1.6 - f * 0.3);
    const yCone = trunkH + f * (height - trunkH) * 0.92 + h / 2;
    const cg = new THREE.ConeGeometry(r, h, 5, 1).rotateY(rng() * Math.PI).translate(bend * f * 2, yCone, bend * f);
    low.push(paint(cg, i % 2 ? c.leaves[1] : c.leaves[0]));
  }
  low.push(paint(new THREE.ConeGeometry(1.15, height - trunkH * 0.6, 5).translate(0, trunkH * 0.6 + (height - trunkH * 0.6) / 2, 0), c.leaves[0]));

  return {
    high: seasonKind(merge(high), SEASON_KIND.evergreen),
    low: seasonKind(merge(low), SEASON_KIND.evergreen),
    crownTop: height,
  };
}

/** A clump of bamboo: thin jointed culms with leaf tufts near the top. */
function bamboo(rng: Rng, c: TreeColors): TreeVariant {
  const high: THREE.BufferGeometry[] = [];
  const low: THREE.BufferGeometry[] = [];
  const n = 5 + Math.floor(rng() * 5);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const base = new THREE.Vector3((rng() - 0.5) * 1.2, 0, (rng() - 0.5) * 1.2);
    const h = 4.5 + rng() * 3;
    const tip = base.clone().add(new THREE.Vector3((rng() - 0.5) * 0.8, h, (rng() - 0.5) * 0.8));
    high.push(segment(base, tip, 0.06, 0.04, c.trunk, 5));
    for (let k = 1; k < 6; k++) {
      const p = base.clone().lerp(tip, k / 6);
      high.push(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 5).translate(p.x, p.y, p.z), '#5f8a3a'));
    }
    for (let k = 0; k < 3; k++) {
      const p = base.clone().lerp(tip, 0.75 + k * 0.1).add(new THREE.Vector3((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5));
      high.push(puff(p, 0.35, pick(rng, c.leaves), rng, 0, 0.5, SEASON_KIND.evergreen));
    }
    top = Math.max(top, tip.y);
  }
  low.push(seasonKind(paint(new THREE.CylinderGeometry(0.5, 0.6, top, 5).translate(0, top / 2, 0), c.leaves[0]), SEASON_KIND.evergreen));
  return { high: merge(high), low: merge(low), crownTop: top };
}

/** `count` different shapes of one species (deterministic for an `rng`). */
export function treeVariants(species: TreeSpecies, rng: Rng, count = 3, colors = DEFAULT_TREE_COLORS[species]): TreeVariant[] {
  const make = {
    sakura,
    broadleaf: (rng: Rng, c: TreeColors) => broadleaf(rng, c, SEASON_KIND.leaf),
    maple: (rng: Rng, c: TreeColors) => broadleaf(rng, c, SEASON_KIND.maple),
    pine,
    bamboo,
  }[species];
  return Array.from({ length: count }, () => make(rng, colors));
}
