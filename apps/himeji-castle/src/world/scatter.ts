import * as THREE from 'three';
import {
  createNoise,
  createRng,
  envDepthMaterial,
  envMaterial,
  envNormalMaterial,
  LodInstances,
  lowpoly,
  randRange,
  SpatialHash,
  treeVariants,
  type LodItem,
  type PadSpot,
  type Rng,
  type TreeSpecies,
} from '@g2/engine';
import { PALETTE } from '../palette';
import { himeji } from './himeji';
import { footbridge, lantern, machiya, minka, pagoda, shrine, station, steppingStone, teaHouse, torii, type Parts } from './japanese';
import { GAUGE } from './railMesh';
import { CASTLE_TOP_RADIUS, gridValue, groveWeight, HALF, PADDY_RADIUS, VILLAGE_RADIUS, WATER_Y, type ValleyData } from './ValleyGen';

export interface TreeInstance {
  position: THREE.Vector3;
  scale: number;
  species: TreeSpecies;
  variant: number;
  /** World position of the top of the crown. */
  top: THREE.Vector3;
}

/** Everything placed in the valley; vegetation meshes are (re)built per detail level. */
export interface ValleyLayout {
  structures: THREE.Group;
  trees: TreeInstance[];
  treeMatrices: THREE.Matrix4[];
  lanterns: THREE.Vector3[];
  people: Array<{ position: THREE.Vector3; facing: number; area: number }>;
  /** Wander areas for villagers: a segment a→b widened by `width` (a point when a = b). */
  areas: Array<{ a: THREE.Vector3; b: THREE.Vector3; width: number; fixedY?: number }>;
  stationCenter: THREE.Vector3;
  pads: PadSpot[];
  ground: Array<{ kind: 'grass' | 'flower' | 'rice' | 'bush' | 'stone'; item: LodItem }>;
}

export interface VegetationDetail {
  /** Fractions of the maximum ground cover. */
  grass: number;
  /** Distance up to which trees use their detailed mesh (before the LOD scale). */
  treeNear: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Yaw that turns local +Z towards the horizontal direction (dx, dz). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

const VARIANTS = 3;
const TREE_KINDS: TreeSpecies[] = ['sakura', 'broadleaf', 'maple', 'pine', 'bamboo'];

export function layoutValley(v: ValleyData): ValleyLayout {
  const rng: Rng = createRng(`${v.seed}:props`);
  const noise = createNoise(createRng(`${v.seed}:forest`));
  const solidParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];
  const lanterns: THREE.Vector3[] = [];
  const people: ValleyLayout['people'] = [];
  const areas: ValleyLayout['areas'] = [];
  const occupied = new SpatialHash<number>(6);
  const stones: LodItem[] = [];

  const place = (parts: Parts, x: number, y: number, z: number, yaw: number, radius: number) => {
    const m = new THREE.Matrix4().compose(_s.set(x, y, z), _q.setFromAxisAngle(Y, yaw), new THREE.Vector3(1, 1, 1));
    for (const g of parts.solid) solidParts.push(g.applyMatrix4(m));
    for (const g of parts.glow) glowParts.push(g.applyMatrix4(m));
    occupied.insert(new THREE.Vector3(x, 0, z), radius);
  };
  const free = (x: number, z: number, r: number) => {
    let ok = true;
    occupied.query(new THREE.Vector3(x, 0, z), r + 26, (rad, p) => {
      if (Math.hypot(p.x - x, p.z - z) < r + rad) ok = false;
    });
    return ok;
  };
  const addLantern = (x: number, z: number) => {
    const y = v.heightAt(x, z);
    place(lantern(), x, y - 0.05, z, rng() * 3, 0.6);
    lanterns.push(new THREE.Vector3(x, y + 1.35, z));
  };
  /** Stepping stones along a polyline. */
  const path = (pts: THREE.Vector3[]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b);
      for (let s = 0; s < len; s += 1.15) {
        const p = a.clone().lerp(b, s / len);
        p.x += (rng() - 0.5) * 0.35;
        p.z += (rng() - 0.5) * 0.35;
        if (gridValue(v.riverDist, p.x, p.z) < 12) continue;
        p.y = v.heightAt(p.x, p.z);
        stones.push({ position: p, matrix: new THREE.Matrix4().compose(p, _q.setFromAxisAngle(Y, rng() * 6.28), _s.setScalar(1)) });
      }
    }
  };

  // ---- station
  const rail = v.rail;
  const si = v.station.index;
  const n = rail.count;
  const tx = rail.xs[(si + 2) % n] - rail.xs[(si - 2 + n) % n];
  const tz = rail.zs[(si + 2) % n] - rail.zs[(si - 2 + n) % n];
  const tl = Math.hypot(tx, tz);
  const t = new THREE.Vector3(tx / tl, 0, tz / tl);
  const side = new THREE.Vector3(-t.z, 0, t.x).multiplyScalar(v.station.side);
  const stationCenter = new THREE.Vector3(rail.xs[si], rail.ys[si], rail.zs[si]).addScaledVector(side, GAUGE / 2 + 2.45);
  place(station(v.station.length), stationCenter.x, rail.ys[si] + 0.25, stationCenter.z, yawTo(t.x, t.z) + (v.station.side > 0 ? Math.PI : 0), 14);
  // Stone stairs from the platform down (or up) to the land on the village side.
  {
    const top = rail.ys[si] + 0.6;
    const start = stationCenter.clone().addScaledVector(side, 2.1).addScaledVector(t, 6);
    const stepRun = 0.42;
    const stepRise = 0.24;
    let y = top;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < 80; k++) {
      const p = start.clone().addScaledVector(side, k * stepRun);
      const g = v.heightAt(p.x, p.z);
      if (Math.abs(g - y) < stepRise) break;
      y += g < y ? -stepRise : stepRise;
      pts.push(p.setY(y));
    }
    const yaw = yawTo(side.x, side.z);
    for (const p of pts) {
      const ground = Math.min(v.heightAt(p.x, p.z), p.y) - 0.3;
      const h = p.y - ground;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, ground, p.z), _q.setFromAxisAngle(Y, yaw), new THREE.Vector3(1, 1, 1));
      solidParts.push(lowpoly.paint(new THREE.BoxGeometry(2.2, h, stepRun + 0.02).translate(0, h / 2, 0), PALETTE.stone).applyMatrix4(m));
      for (const sx of [-1.2, 1.2]) solidParts.push(lowpoly.paint(new THREE.BoxGeometry(0.25, h + 0.5, stepRun + 0.02).translate(sx, (h + 0.5) / 2, 0), PALETTE.stoneDark).applyMatrix4(m));
    }
    if (pts.length) {
      const end = pts[pts.length - 1];
      addLantern(end.x + t.x * 2, end.z + t.z * 2);
      path([end.clone().addScaledVector(side, 1.5), v.village.clone()]);
    }
  }
  areas.push({
    a: stationCenter.clone().addScaledVector(t, -12),
    b: stationCenter.clone().addScaledVector(t, 12),
    width: 0.7,
    fixedY: rail.ys[si] + 0.6,
  });
  for (const k of [-8, -2, 5]) {
    people.push({
      position: stationCenter.clone().addScaledVector(t, k).addScaledVector(side, 0.4).setY(rail.ys[si] + 0.6),
      facing: yawTo(-side.x, -side.z),
      area: 0,
    });
  }

  // ---- village: machiya along the main street, tea houses and farmhouses around it
  const V = v.village;
  for (let a = -26; a <= 26; a += 8.5) {
    for (const s of [-1, 1]) {
      const x = V.x + t.x * a + side.x * s * 7.5;
      const z = V.z + t.z * a + side.z * s * 7.5;
      if (Math.hypot(x - V.x, z - V.z) > VILLAGE_RADIUS - 3) continue;
      if (gridValue(v.railDist, x, z) < 9 || gridValue(v.riverDist, x, z) < 16 || !free(x, z, 4)) continue;
      if (Math.hypot(x - v.paddy.x, z - v.paddy.z) < PADDY_RADIUS + 5) continue;
      place(machiya(rng), x, v.heightAt(x, z), z, yawTo(-side.x * s, -side.z * s), 4.2);
    }
  }
  for (let k = 0; k < 40; k++) {
    const ang = rng() * Math.PI * 2;
    const r = VILLAGE_RADIUS + 4 + rng() * 16;
    const x = V.x + Math.cos(ang) * r;
    const z = V.z + Math.sin(ang) * r;
    if (gridValue(v.railDist, x, z) < 10 || gridValue(v.riverDist, x, z) < 18 || v.slopeAt(x, z) > 0.35 || !free(x, z, 6)) continue;
    if (Math.hypot(x - v.paddy.x, z - v.paddy.z) < PADDY_RADIUS + 7) continue;
    const parts = rng() < 0.5 ? teaHouse(rng) : minka(rng);
    place(parts, x, v.heightAt(x, z), z, yawTo(V.x - x, V.z - z), 6);
  }
  const streetArea = areas.push({ a: V.clone().addScaledVector(t, -24), b: V.clone().addScaledVector(t, 24), width: 2.2 }) - 1;
  for (let a = -24; a <= 24; a += 12) {
    for (const s of [-1, 1]) addLantern(V.x + t.x * a + side.x * s * 3.4, V.z + t.z * a + side.z * s * 3.4);
  }
  for (let k = 0; k < 6; k++) {
    const a = randRange(rng, -22, 22);
    people.push({
      position: new THREE.Vector3(V.x + t.x * a + side.x * (rng() * 2 - 1), 0, V.z + t.z * a + side.z * (rng() * 2 - 1)),
      facing: rng() * Math.PI * 2,
      area: streetArea,
    });
  }
  // Pagoda and shrine behind the houses, torii in front of the shrine, bamboo behind it.
  const pg = V.clone().addScaledVector(t, -20).addScaledVector(side, 22);
  if (gridValue(v.riverDist, pg.x, pg.z) > 18 && free(pg.x, pg.z, 5)) place(pagoda(), pg.x, v.heightAt(pg.x, pg.z) - 0.2, pg.z, yawTo(-side.x, -side.z), 6);
  const sh = V.clone().addScaledVector(t, 16).addScaledVector(side, 24);
  const bambooSpots: THREE.Vector3[] = [];
  if (gridValue(v.riverDist, sh.x, sh.z) > 18) {
    place(shrine(), sh.x, v.heightAt(sh.x, sh.z) - 0.2, sh.z, yawTo(-side.x, -side.z), 7);
    const ti = sh.clone().addScaledVector(side, -10);
    place(torii(), ti.x, v.heightAt(ti.x, ti.z) - 0.1, ti.z, yawTo(-side.x, -side.z), 3);
    for (const s of [-1, 1]) addLantern(ti.x + t.x * s * 3.6, ti.z + t.z * s * 3.6);
    path([V.clone().addScaledVector(side, 4).addScaledVector(t, 16), ti, sh.clone().addScaledVector(side, -4)]);
    for (let k = 0; k < 14; k++) {
      const b = sh.clone().addScaledVector(side, 9 + rng() * 9).addScaledVector(t, (rng() - 0.5) * 22);
      if (gridValue(v.riverDist, b.x, b.z) > 14 && gridValue(v.railDist, b.x, b.z) > 7) bambooSpots.push(b);
    }
  }

  // ---- castle, facing the valley centre
  const C = v.castle;
  place(himeji(rng), C.x, C.y - 0.2, C.z, yawTo(-C.x, -C.z), CASTLE_TOP_RADIUS);
  const castleFront = new THREE.Vector3(-C.x, 0, -C.z).normalize();
  const cf = C.clone().addScaledVector(castleFront, 21);
  const castleArea = areas.push({ a: cf.clone(), b: cf.clone(), width: 4 }) - 1;
  people.push({ position: C.clone().addScaledVector(castleFront, 21), facing: yawTo(castleFront.x, castleFront.z), area: castleArea });
  for (const s of [-1, 1]) {
    const p = C.clone().addScaledVector(castleFront, 20).addScaledVector(new THREE.Vector3(-castleFront.z, 0, castleFront.x), s * 6);
    addLantern(p.x, p.z);
  }

  // ---- footbridge and the hanami park across the river
  const fb = v.footbridge;
  const ends = [-1, 1].map((s) => fb.center.clone().addScaledVector(fb.across, (s * fb.length) / 2));
  const fy = Math.max(...ends.map((e) => v.heightAt(e.x, e.z)), WATER_Y + 0.8) - 0.15;
  place(footbridge(fb.length, 2.4), fb.center.x, fy, fb.center.z, Math.atan2(-fb.across.z, fb.across.x), fb.length / 2);
  for (const e of ends) addLantern(e.x + fb.across.x * 2, e.z + fb.across.z * 2);
  const park = v.groves[1].center;
  const parkArea = areas.push({ a: park.clone(), b: park.clone(), width: 15 }) - 1;
  // A looping stone path through the park, joined to the bridge.
  const loop: THREE.Vector3[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    loop.push(park.clone().add(new THREE.Vector3(Math.cos(a) * 14, 0, Math.sin(a) * 11)));
  }
  path(loop);
  const nearEnd = ends.reduce((a, b) => (a.distanceTo(park) < b.distanceTo(park) ? a : b));
  path([nearEnd, park.clone().lerp(nearEnd, 0.55)]);
  for (let k = 0; k < 6; k++) addLantern(loop[k * 2].x * 0.92 + park.x * 0.08, loop[k * 2].z * 0.92 + park.z * 0.08);
  for (let k = 0; k < 5; k++) {
    const a = rng() * Math.PI * 2;
    people.push({ position: park.clone().add(new THREE.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 8)), facing: rng() * 6.28, area: parkArea });
  }
  for (const p of people) if (p.position.y === 0) p.position.y = v.heightAt(p.position.x, p.position.z);

  // ---- trees: dense sakura groves, mixed forest elsewhere; varied sizes and shapes
  const variants = new Map<TreeSpecies, number[]>();
  const vrng = createRng(`${v.seed}:tree-shapes`);
  for (const sp of TREE_KINDS) variants.set(sp, treeVariants(sp, vrng, VARIANTS).map((tv) => tv.crownTop));
  const trees: TreeInstance[] = [];
  const treeMatrices: THREE.Matrix4[] = [];
  const treeHash = new SpatialHash<number>(5);
  const addTree = (x: number, z: number, species: TreeSpecies, scale: number) => {
    const y = v.heightAt(x, z) - 0.1;
    const variant = Math.floor(rng() * VARIANTS);
    const sy = scale * randRange(rng, 0.88, 1.18);
    const position = new THREE.Vector3(x, y, z);
    // A slight lean and squash so no two trees are alike.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08));
    treeMatrices.push(new THREE.Matrix4().compose(position, q, new THREE.Vector3(scale, sy, scale * randRange(rng, 0.9, 1.1))));
    const top = position.clone().add(new THREE.Vector3(0, variants.get(species)![variant] * sy, 0));
    trees.push({ position, scale, species, variant, top });
    treeHash.insert(position, scale);
  };
  const okTree = (x: number, z: number, spacing: number) => {
    const y = v.heightAt(x, z);
    if (y < WATER_Y + 1.2 || Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) return false;
    if (gridValue(v.riverDist, x, z) < 13 || gridValue(v.railDist, x, z) < 6.5) return false;
    if (Math.hypot(x - V.x, z - V.z) < VILLAGE_RADIUS + 1 || Math.hypot(x - C.x, z - C.z) < CASTLE_TOP_RADIUS + 2) return false;
    if (v.isPaddy(x, z) || Math.hypot(x - stationCenter.x, z - stationCenter.z) < 22 || v.slopeAt(x, z) > 1.3) return false;
    if (!free(x, z, 1.5)) return false;
    let near = false;
    treeHash.query(new THREE.Vector3(x, 0, z), spacing + 2, (s, p) => {
      if (Math.hypot(p.x - x, p.z - z) < spacing * Math.max(0.8, s)) near = true;
    });
    return !near;
  };
  // Groves first: sakura close together.
  for (const g of v.groves) {
    const area = Math.PI * (g.outer * g.outer - g.inner * g.inner);
    for (let i = 0; i < area / 7; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(randRange(rng, (g.inner / g.outer) ** 2, 1)) * g.outer;
      const x = g.center.x + Math.cos(a) * r;
      const z = g.center.z + Math.sin(a) * r;
      if (!okTree(x, z, 5.2)) continue;
      // Keep the park paths open.
      if (g.inner === 0 && Math.abs(Math.hypot((x - g.center.x) / 14, (z - g.center.z) / 11) - 1) < 0.14) continue;
      addTree(x, z, rng() < 0.92 ? 'sakura' : 'maple', randRange(rng, 0.85, 1.35));
    }
  }
  for (const b of bambooSpots) if (okTree(b.x, b.z, 1.8)) addTree(b.x, b.z, 'bamboo', randRange(rng, 0.8, 1.2));
  // Forest everywhere else.
  const target = 2400;
  let forestCount = 0;
  for (let i = 0; i < target * 8 && forestCount < target; i++) {
    const x = randRange(rng, -HALF + 4, HALF - 4);
    const z = randRange(rng, -HALF + 4, HALF - 4);
    if (groveWeight(v, x, z) > 0.05) continue;
    const y = v.heightAt(x, z);
    const forest = noise.fbm(x * 0.015, 0, z * 0.015) + (y > 14 ? 0.3 : 0);
    if (forest < -0.05 && rng() > 0.15) continue;
    // Denser in the middle of a wood, smaller trees at its edges.
    const edge = THREE.MathUtils.smoothstep(forest, -0.05, 0.35);
    if (!okTree(x, z, 2.6 + (1 - edge) * 1.5)) continue;
    const slope = v.slopeAt(x, z);
    let sp: TreeSpecies;
    if (y > 18 || slope > 0.7) sp = rng() < 0.85 ? 'pine' : 'maple';
    else {
      const r = rng();
      sp = r < 0.62 ? 'broadleaf' : r < 0.84 ? 'pine' : 'maple';
    }
    const scale = (0.55 + rng() ** 0.7 * 0.95) * (0.7 + edge * 0.45) * (sp === 'pine' ? 1.15 : 1.1);
    addTree(x, z, sp, scale);
    forestCount++;
  }
  // A few cherry trees along the river near the footbridge.
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(rng() * v.river.xs.length);
    const along = new THREE.Vector3(v.river.xs[i], 0, v.river.zs[i]);
    if (along.distanceTo(fb.center) > 70) continue;
    const s = rng() < 0.5 ? -1 : 1;
    const x = along.x + fb.across.x * s * (v.river.hw[i] + 6);
    const z = along.z + fb.across.z * s * (v.river.hw[i] + 6);
    if (okTree(x, z, 4)) addTree(x, z, 'sakura', randRange(rng, 0.9, 1.3));
  }

  // ---- ground cover (generated at full density; detail takes a prefix)
  const ground: ValleyLayout['ground'] = [];
  const open = (x: number, z: number, y: number) =>
    y > WATER_Y + 1 &&
    gridValue(v.railDist, x, z) > 3.5 &&
    !v.isPaddy(x, z) &&
    Math.hypot(x - V.x, z - V.z) > VILLAGE_RADIUS - 6 &&
    Math.hypot(x - C.x, z - C.z) > CASTLE_TOP_RADIUS;
  const scatterSmall = (kind: ValleyLayout['ground'][number]['kind'], count: number, accept: (x: number, z: number, y: number) => boolean, scale: [number, number]) => {
    let made = 0;
    for (let i = 0; i < count * 6 && made < count; i++) {
      const x = randRange(rng, -HALF + 3, HALF - 3);
      const z = randRange(rng, -HALF + 3, HALF - 3);
      const y = v.heightAt(x, z);
      if (!accept(x, z, y)) continue;
      const p = new THREE.Vector3(x, y - 0.05, z);
      const s = randRange(rng, scale[0], scale[1]);
      ground.push({
        kind,
        item: { position: p, matrix: new THREE.Matrix4().compose(p, _q.setFromAxisAngle(Y, rng() * 6.28), _s.set(s, s * randRange(rng, 0.8, 1.25), s)), color: new THREE.Color().setScalar(randRange(rng, 0.82, 1.1)) },
      });
      made++;
    }
  };
  scatterSmall('bush', 500, (x, z, y) => open(x, z, y) && y < 26, [0.7, 1.7]);
  scatterSmall('grass', 14000, (x, z, y) => open(x, z, y) && y < 24, [0.8, 1.8]);
  scatterSmall('flower', 3200, (x, z, y) => open(x, z, y) && y < 20, [0.8, 1.4]);
  const flowerColors = ['#f4f1e8', '#efc94a', '#e889a8', '#d8382c', '#9fb4e8', '#f7c3d2'];
  let fc = 0;
  for (const g of ground) if (g.kind === 'flower') g.item.color = new THREE.Color(flowerColors[fc++ % flowerColors.length]);
  for (const s of stones) ground.push({ kind: 'stone', item: s });

  // ---- lily pads in the calm water near the banks
  const pads: PadSpot[] = [];
  for (let k = 0; k < 70; k++) {
    const i = 2 + Math.floor(rng() * (v.river.xs.length - 4));
    const tx2 = v.river.xs[i + 1] - v.river.xs[i - 1];
    const tz2 = v.river.zs[i + 1] - v.river.zs[i - 1];
    const tl2 = Math.hypot(tx2, tz2) || 1;
    const s = rng() < 0.5 ? -1 : 1;
    const off = v.river.hw[i] - 1.6 - rng() * 2;
    const cx = v.river.xs[i] + (-tz2 / tl2) * s * off;
    const cz = v.river.zs[i] + (tx2 / tl2) * s * off;
    if (Math.abs(cx) > HALF - 5 || Math.abs(cz) > HALF - 5) continue;
    const cluster = 2 + Math.floor(rng() * 5);
    for (let c = 0; c < cluster; c++) {
      const p = new THREE.Vector3(cx + (rng() - 0.5) * 3, WATER_Y + 0.02, cz + (rng() - 0.5) * 3);
      if (v.heightAt(p.x, p.z) > WATER_Y - 0.2) continue;
      pads.push({ position: p, scale: randRange(rng, 0.7, 1.4), flower: rng() < 0.22 });
    }
  }

  // ---- structures mesh
  const structures = new THREE.Group();
  structures.name = 'structures';
  const solid = new THREE.Mesh(lowpoly.merge(solidParts), envMaterial({ vertexColors: true }));
  solid.castShadow = true;
  solid.receiveShadow = true;
  const glow = new THREE.Mesh(lowpoly.merge(glowParts), envMaterial({ vertexColors: true }, { glow: true, snow: false, wet: false }));
  structures.add(solid, glow);

  return { structures, trees, treeMatrices, lanterns, people, areas, stationCenter, pads, ground };
}

/**
 * Builds the LOD-managed vegetation for a detail level: every tree species × shape with a
 * detailed and a simple mesh, plus distance-limited bushes, grass, flowers, rice and stones.
 */
export function buildVegetation(v: ValleyData, layout: ValleyLayout, detail: VegetationDetail): { lods: LodInstances[]; solid: THREE.Group; soft: THREE.Group } {
  const solid = new THREE.Group();
  const soft = new THREE.Group();
  const lods: LodInstances[] = [];
  const vrng = createRng(`${v.seed}:tree-shapes`);
  const treeMat = envMaterial({ vertexColors: true }, { sway: 'tree' });
  const depth = envDepthMaterial({ sway: 'tree' });
  const outline = envNormalMaterial({ sway: 'tree' });
  for (const sp of TREE_KINDS) {
    const shapes = treeVariants(sp, vrng, VARIANTS);
    shapes.forEach((shape, vi) => {
      const items: LodItem[] = [];
      layout.trees.forEach((tr, i) => {
        if (tr.species === sp && tr.variant === vi) {
          items.push({ position: tr.position, matrix: layout.treeMatrices[i], color: new THREE.Color().setScalar(0.9 + ((i * 7919) % 100) / 500) });
        }
      });
      if (!items.length) return;
      const lod = new LodInstances(
        [
          { geometry: shape.high, maxDistance: detail.treeNear },
          { geometry: shape.low, maxDistance: 1e5 },
        ],
        treeMat,
        items,
        { castShadow: true, receiveShadow: true, customDepthMaterial: depth, outlineMaterial: outline },
      );
      lods.push(lod);
      solid.add(lod.group);
    });
  }
  const take = (kind: string, frac: number) => {
    const all = layout.ground.filter((g) => g.kind === kind).map((g) => g.item);
    return all.slice(0, Math.round(all.length * frac));
  };
  const wind = envMaterial({ vertexColors: true }, { sway: 'grass' });
  const groundLod = (geo: THREE.BufferGeometry, mat: THREE.Material, items: LodItem[], dist: number, parent: THREE.Group, shadow = false) => {
    const lod = new LodInstances([{ geometry: geo, maxDistance: dist }], mat, items, { castShadow: shadow });
    lods.push(lod);
    parent.add(lod.group);
  };
  groundLod(lowpoly.bush(PALETTE.bush, 1), envMaterial({ vertexColors: true }, { sway: 'grass', swayScale: 0.12 }), take('bush', 1), 150, solid, true);
  groundLod(lowpoly.grassTuft(PALETTE.leafLight), wind, take('grass', detail.grass), 60, soft);
  groundLod(lowpoly.flower('#ffffff', '#ffffff'), wind, take('flower', detail.grass), 65, soft);
  groundLod(steppingStone(createRng('stone')), envMaterial({ vertexColors: true }), take('stone', 1), 110, solid);
  return { lods, solid, soft };
}
