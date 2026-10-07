import * as THREE from 'three';
import { envMaterial } from '../env/envShader';
import type { Surface } from '../env/Surface';
import { merge, paint } from '../props/lowpoly';
import { getQuality } from '../render/quality';
import type { Rng } from '../world/rng';

export interface PadSpot {
  position: THREE.Vector3;
  scale: number;
  flower: boolean;
}

/** Returns a point on the water surface near `center`, or null. */
export type WaterSpawner = (center: THREE.Vector3, radius: number, rng: Rng) => THREE.Vector3 | null;

interface Jump {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  up: THREE.Vector3;
  t: number;
  duration: number;
  height: number;
  length: number;
  fish: number;
  active: boolean;
}

const Y = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _look = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function padGeometry(): THREE.BufferGeometry {
  const pad = new THREE.CircleGeometry(0.62, 14, 0.35, Math.PI * 2 - 0.55).rotateX(-Math.PI / 2);
  const parts = [paint(pad, '#4f9a5a')];
  // A few darker veins radiating from the centre.
  for (let k = 0; k < 6; k++) {
    const a = 0.6 + (k / 6) * (Math.PI * 2 - 1.1);
    parts.push(paint(new THREE.BoxGeometry(0.55, 0.005, 0.025).translate(0.27, 0.004, 0).rotateY(-a), '#3d7f48'));
  }
  return merge(parts);
}

function flowerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const petal = new THREE.ConeGeometry(0.07, 0.3, 4).rotateZ(-1.1).translate(0.12, 0.06, 0).rotateY((k / 8) * Math.PI * 2);
    parts.push(paint(petal, k % 2 ? '#f6b4c6' : '#f9d2dd'));
  }
  parts.push(paint(new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.08, 0), '#f2c94c'));
  return merge(parts);
}

/** Piecewise-linear lookup of y at x on a polyline sorted by x. */
function along(pts: THREE.Vector3[], x: number): number {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
  }
  return pts[x < pts[0].x ? 0 : pts.length - 1].y;
}

const curve = (pts: number[][], n = 80) => new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0))).getSpacedPoints(n);

/**
 * A detailed fish (after the one in "Cozzy"): a smooth body lofted from back / belly / width
 * profiles with a darker back, saddle bands, a gill line and eyes, plus thin fins with ray
 * stripes. Profiles are in units of 1/10 body length, head at x = 0; the model points along +Z.
 */
function detailedFish(): THREE.BufferGeometry {
  const S = 0.05;
  const top = curve([[0, 0], [0.1, 0.15], [1, 0.75], [3.5, 1.5], [9, 0.5], [9.5, 0.45], [10, 0.55]]);
  const bot = curve([[0, 0], [0.1, -0.15], [0.5, -0.35], [4.5, -1], [8, -0.6], [9.5, -0.45], [10, -0.55]]);
  const wid = curve([[0, 0], [0.1, 0.125], [1, 0.375], [4, 0.6], [8, 0.25], [10, 0.05]]);
  const to3 = (x: number, y: number, lat: number) => new THREE.Vector3(lat * S, y * S, (5 - x) * S);

  // Body: rings of an ellipse-like cross-section.
  const rings = 34;
  const around = 18;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const x = 10 * Math.pow(i / rings, 1.35);
    const t = along(top, x);
    const b = along(bot, x);
    const w = along(wid, x);
    for (let j = 0; j <= around; j++) {
      const th = (j / around) * Math.PI * 2;
      const sn = Math.sin(th);
      const p = to3(x, (t + b) / 2 + ((t - b) / 2) * sn, w * Math.cos(th));
      pos.push(p.x, p.y, p.z);
      // Pale belly, dark back, saddle bands on the upper flanks, darker head and gill line.
      let v = 1.05 - 0.5 * THREE.MathUtils.smoothstep(sn, -0.3, 0.9);
      if (x > 2.5 && x < 9) v *= 1 - 0.3 * Math.pow(0.5 + 0.5 * Math.sin(x * 2.1), 2) * THREE.MathUtils.smoothstep(sn, -0.2, 0.5);
      if (x < 2) v *= 0.85;
      if (Math.abs(x - 2.3) < 0.18) v *= 0.7;
      col.push(v, v, v);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [body.toNonIndexed()];

  /** A thin fin between `base` points on the body and an `edge` outline, striped along its rays. */
  const fin = (base: THREE.Vector3[], edge: THREE.Vector3[]) => {
    const fp: number[] = [];
    const fc: number[] = [];
    for (let i = 0; i < base.length - 1; i++) {
      const tone = i % 2 ? 1 : 0.78;
      const quad = [base[i], base[i + 1], edge[i + 1], base[i], edge[i + 1], edge[i]];
      for (const q of quad) {
        fp.push(q.x, q.y, q.z);
        const outer = q === edge[i] || q === edge[i + 1];
        const v = tone * (outer ? 1.1 : 0.8);
        fc.push(v, v, v);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    g.computeVertexNormals();
    return g;
  };
  const n = 24;
  const sample = (pts: number[][]) => curve(pts, n);
  const lineX = (x0: number, x1: number, f: (x: number) => number, lat = 0) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / n;
      return to3(x, f(x), lat);
    });
  // Dorsal fin along the back.
  parts.push(fin(lineX(3, 7, (x) => along(top, x) - 0.05), sample([[3, 1.45], [3.25, 2.25], [3.75, 3], [6, 2], [7, 1]]).map((p) => to3(p.x, p.y, 0))));
  // Tail fin, from the narrow tail stem.
  parts.push(
    fin(
      Array.from({ length: n + 1 }, (_, i) => to3(10, -0.55 + (1.1 * i) / n, 0)),
      sample([[11, -1], [12.5, -1.5], [12, 0], [12.5, 1.5], [11, 1]]).map((p) => to3(p.x, p.y, 0)),
    ),
  );
  // Anal fin under the tail.
  parts.push(fin(lineX(6, 7.5, (x) => along(bot, x) + 0.05), sample([[6, -0.9], [7.25, -1.5], [7.5, -0.75]]).map((p) => to3(p.x, p.y, 0))));
  // Pelvic and pectoral fins in pairs, splayed out from the body.
  for (const side of [-1, 1]) {
    const pelvic = fin(lineX(2.25, 4, (x) => along(bot, x) + 0.1), sample([[2.25, -0.7], [3.75, -2], [4, -1]]).map((p) => to3(p.x, p.y, 0)));
    pelvic.rotateZ(side * 0.4);
    parts.push(pelvic);
    const pectoral = fin(
      Array.from({ length: n + 1 }, (_, i) => to3(2.6 + 0.4 * (i / n), -0.2 + 0.4 * (i / n), 0)),
      sample([[2.6, -0.2], [3.6, -0.9], [4.3, -0.5], [3.0, 0.2]]).map((p) => to3(p.x, p.y, 0)),
    );
    pectoral.rotateY(side * 0.5).translate(side * 0.5 * S, 0, 0);
    parts.push(pectoral);
  }
  // Eyes: a dark pupil in a golden ring.
  for (const side of [-1, 1]) {
    const x = 1.1;
    const y = (along(top, x) + along(bot, x)) / 2 + 0.15;
    const lat = along(wid, x) * 0.85;
    const p = to3(x, y, side * lat);
    parts.push(paint(new THREE.SphereGeometry(0.17 * S, 10, 8).scale(0.6, 1, 1).translate(p.x, p.y, p.z), '#e8c55a', true));
    parts.push(paint(new THREE.SphereGeometry(0.11 * S, 8, 6).scale(0.6, 1, 1).translate(p.x + side * 0.05 * S, p.y, p.z + 0.01 * S), '#101010', true));
  }
  for (const g of parts) g.deleteAttribute('uv');
  return merge(parts);
}

function fishGeometry(color: string): THREE.BufferGeometry {
  if (getQuality() >= 2) return detailedFish();
  return merge([
    paint(new THREE.SphereGeometry(0.16, 8, 6).scale(0.55, 0.75, 1.6), color),
    paint(new THREE.ConeGeometry(0.14, 0.24, 3).rotateX(Math.PI / 2).scale(0.3, 1, 1).translate(0, 0, -0.32), color),
    paint(new THREE.ConeGeometry(0.06, 0.14, 3).scale(0.3, 1, 1).translate(0, 0.14, 0.02), color),
  ]);
}

/**
 * Lily pads (some with lotus flowers) floating on the water, and fish that now and then leap
 * out in an arc near the viewer with a splash ring where they leave and re-enter the water.
 */
export class Pond {
  readonly group = new THREE.Group();
  private readonly fish: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly ringAge: number[] = [];
  private readonly ringPos: THREE.Vector3[] = [];
  private readonly ringUp: THREE.Vector3[] = [];
  private nextRing = 0;
  private readonly jumps: Jump[] = [];
  private nextJump = 2;
  private time = 0;
  private readonly padMesh: THREE.InstancedMesh;
  private readonly flowerMesh: THREE.InstancedMesh;

  constructor(
    private readonly surface: Surface,
    pads: PadSpot[],
    private readonly spawner: WaterSpawner,
    private readonly rng: Rng,
  ) {
    const mat = envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { wet: false });
    const padMesh = new THREE.InstancedMesh(padGeometry(), mat, Math.max(1, pads.length));
    const flowers = pads.filter((p) => p.flower);
    const flowerMesh = new THREE.InstancedMesh(flowerGeometry(), mat, Math.max(1, flowers.length));
    const up = new THREE.Vector3();
    pads.forEach((p, i) => {
      surface.up(p.position, up);
      _q.setFromUnitVectors(Y, up).multiply(new THREE.Quaternion().setFromAxisAngle(Y, rng() * Math.PI * 2));
      padMesh.setMatrixAt(i, _m.compose(p.position, _q, _s.setScalar(p.scale)));
    });
    flowers.forEach((p, i) => {
      surface.up(p.position, up);
      _q.setFromUnitVectors(Y, up);
      flowerMesh.setMatrixAt(i, _m.compose(_p.copy(p.position).addScaledVector(up, 0.02), _q, _s.setScalar(p.scale)));
    });
    padMesh.count = pads.length;
    flowerMesh.count = flowers.length;
    padMesh.receiveShadow = true;
    padMesh.computeBoundingSphere();
    flowerMesh.computeBoundingSphere();

    const fishColors = ['#e2622f', '#f0a040', '#c8cbd0'];
    this.fish = new THREE.InstancedMesh(
      fishGeometry('#ffffff'),
      envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { snow: false, wet: false, swim: true }),
      3,
    );
    this.fish.frustumCulled = false;
    for (let i = 0; i < 3; i++) {
      this.fish.setColorAt(i, new THREE.Color(fishColors[i]));
      this.fish.setMatrixAt(i, ZERO);
      this.jumps.push({ from: new THREE.Vector3(), dir: new THREE.Vector3(), up: new THREE.Vector3(), t: 0, duration: 1, height: 1, length: 1, fish: i, active: false });
    }
    const ringMax = 12;
    this.rings = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.2, 0.28, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f2fbfb', transparent: true, opacity: 0.7, depthWrite: false }),
      ringMax,
    );
    this.rings.frustumCulled = false;
    for (let i = 0; i < ringMax; i++) {
      this.ringAge.push(9);
      this.ringPos.push(new THREE.Vector3());
      this.ringUp.push(new THREE.Vector3(0, 1, 0));
      this.rings.setMatrixAt(i, ZERO);
    }
    this.padMesh = padMesh;
    this.flowerMesh = flowerMesh;
    this.group.add(padMesh, flowerMesh, this.fish, this.rings);
  }

  /** Lily pads grow back in spring and die off in winter; lotus flowers bloom in summer. */
  setSeason(w: { x: number; y: number; z: number; w: number }): void {
    this.padMesh.visible = w.w < 0.5;
    this.flowerMesh.visible = w.y > 0.3;
  }

  /** Swaps the fish model after the model quality changed (detailed fish from "high" up). */
  refreshModel(): void {
    this.fish.geometry.dispose();
    this.fish.geometry = fishGeometry('#ffffff');
  }

  /** Objects without ink outlines. */
  get noOutline(): THREE.Object3D[] {
    return [this.rings];
  }

  update(dt: number, focus: THREE.Vector3, active: number): void {
    this.time += dt;
    this.nextJump -= dt;
    if (this.nextJump <= 0 && active > 0.2) {
      this.nextJump = 2.5 + this.rng() * 5;
      const j = this.jumps.find((x) => !x.active);
      const p = j ? this.spawner(focus, 30, this.rng) : null;
      if (j && p) {
        j.active = true;
        j.from.copy(p);
        this.surface.up(p, j.up);
        j.dir.set(this.rng() - 0.5, 0, this.rng() - 0.5);
        j.dir.addScaledVector(j.up, -j.dir.dot(j.up)).normalize();
        j.t = 0;
        j.duration = 0.75 + this.rng() * 0.3;
        j.height = 0.7 + this.rng() * 0.6;
        j.length = 1.2 + this.rng() * 0.8;
        this.splash(p, j.up);
      }
    }
    for (const j of this.jumps) {
      if (!j.active) continue;
      j.t += dt / j.duration;
      if (j.t >= 1) {
        j.active = false;
        this.fish.setMatrixAt(j.fish, ZERO);
        this.splash(_p.copy(j.from).addScaledVector(j.dir, j.length), j.up);
        continue;
      }
      // Ballistic arc; the fish points along its path and wriggles.
      const h = 4 * j.height * j.t * (1 - j.t);
      _p.copy(j.from).addScaledVector(j.dir, j.length * j.t).addScaledVector(j.up, h - 0.1);
      _t.copy(j.dir).multiplyScalar(j.length).addScaledVector(j.up, 4 * j.height * (1 - 2 * j.t)).normalize();
      _look.lookAt(_s.set(0, 0, 0), _t.negate(), j.up);
      _q.setFromRotationMatrix(_look).multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.sin(this.time * 30) * 0.25));
      this.fish.setMatrixAt(j.fish, _m.compose(_p, _q, _s.setScalar(1.4)));
    }
    this.fish.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.ringAge.length; i++) {
      if (this.ringAge[i] > 1.2) continue;
      this.ringAge[i] += dt;
      const k = this.ringAge[i] / 1.2;
      _q.setFromUnitVectors(Y, this.ringUp[i]);
      const s = k >= 1 ? 0 : 1 + k * 5;
      this.rings.setMatrixAt(i, _m.compose(this.ringPos[i], _q, _s.set(s, 1, s)));
    }
    this.rings.instanceMatrix.needsUpdate = true;
  }

  private splash(p: THREE.Vector3, up: THREE.Vector3): void {
    const i = this.nextRing;
    this.nextRing = (this.nextRing + 1) % this.ringAge.length;
    this.ringAge[i] = 0;
    this.ringPos[i].copy(p).addScaledVector(up, 0.03);
    this.ringUp[i].copy(up);
  }
}
