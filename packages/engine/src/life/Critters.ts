import * as THREE from 'three';
import { envMaterial } from '../env/envShader';
import type { Surface } from '../env/Surface';
import { merge, paint } from '../props/lowpoly';
import type { Rng } from '../world/rng';

export type CritterKind = 'butterfly' | 'dragonfly' | 'swallow';

/** Where a critter may live: returns a ground point near `center`, or null if none was found. */
export type CritterSpawner = (kind: CritterKind, center: THREE.Vector3, radius: number, rng: Rng) => THREE.Vector3 | null;

interface Critter {
  kind: CritterKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  /** Ground point it hangs around. */
  home: THREE.Vector3;
  timer: number;
  resting: boolean;
  flap: number;
  scale: number;
  angle: number;
  /** Index within its kind (the first N are shown when only some are active). */
  index: number;
  /** Has a home yet (set on first spawn). */
  homed: boolean;
}

const COUNTS: Record<CritterKind, number> = { butterfly: 26, dragonfly: 12, swallow: 10 };
const RANGE: Record<CritterKind, number> = { butterfly: 28, dragonfly: 30, swallow: 45 };
const BUTTERFLY_COLORS = ['#f4f1e8', '#f2c94c', '#ef8a3c', '#8fb4ea', '#e889a8'];

const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _z = new THREE.Vector3();
const _x = new THREE.Vector3();

function wingGeometry(kind: CritterKind, side: 1 | -1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  let v: number[];
  if (kind === 'butterfly') {
    // Two rounded lobes per wing (fore + hind).
    v = [0, 0, 0.02, side * 0.2, 0, 0.16, side * 0.24, 0, 0.0, 0, 0, -0.01, side * 0.18, 0, -0.02, side * 0.12, 0, -0.15];
  } else if (kind === 'dragonfly') {
    v = [0, 0, 0.06, side * 0.36, 0, 0.1, side * 0.36, 0, 0.04, 0, 0, -0.02, side * 0.32, 0, -0.04, side * 0.32, 0, -0.1];
  } else {
    // Swallow: long swept wing.
    v = [0, 0, 0.08, side * 0.55, 0, -0.18, side * 0.2, 0, -0.06];
  }
  if (side < 0) for (let i = 0; i < v.length; i += 9) [v[i + 3], v[i + 4], v[i + 5], v[i + 6], v[i + 7], v[i + 8]] = [v[i + 6], v[i + 7], v[i + 8], v[i + 3], v[i + 4], v[i + 5]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return paint(g, '#ffffff');
}

function bodyGeometry(kind: CritterKind): THREE.BufferGeometry {
  if (kind === 'swallow') {
    return merge([
      paint(new THREE.OctahedronGeometry(0.1, 0).scale(0.8, 0.7, 2), '#2a3346'),
      paint(new THREE.ConeGeometry(0.06, 0.22, 3).rotateX(-Math.PI / 2).translate(0, 0, -0.28), '#2a3346'),
      paint(new THREE.OctahedronGeometry(0.06, 0).translate(0, -0.02, 0.12), '#c8503a'),
    ]);
  }
  const len = kind === 'dragonfly' ? 0.5 : 0.16;
  const color = kind === 'dragonfly' ? '#2f8a9a' : '#3a2f2a';
  return paint(new THREE.CylinderGeometry(0.02, 0.012, len, 4).rotateX(Math.PI / 2).translate(0, 0, kind === 'dragonfly' ? -0.12 : 0), color);
}

/**
 * Small flying life near the viewer: butterflies drift between flowers and sometimes land,
 * dragonflies dart and hover over water and paddies, swallows swoop in wide loops.
 * They hide at night and in the rain.
 */
export class Critters {
  readonly group = new THREE.Group();
  private readonly critters: Critter[] = [];
  private readonly meshes = new Map<CritterKind, { body: THREE.InstancedMesh; left: THREE.InstancedMesh; right: THREE.InstancedMesh }>();
  private time = 0;

  constructor(
    private readonly surface: Surface,
    private readonly spawner: CritterSpawner,
    private readonly rng: Rng,
  ) {
    const mat = envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { snow: false, wet: false });
    for (const kind of Object.keys(COUNTS) as CritterKind[]) {
      const n = COUNTS[kind];
      const make = (g: THREE.BufferGeometry) => {
        const m = new THREE.InstancedMesh(g, mat, n);
        m.frustumCulled = false;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
      };
      const set = { body: make(bodyGeometry(kind)), left: make(wingGeometry(kind, -1)), right: make(wingGeometry(kind, 1)) };
      this.meshes.set(kind, set);
      for (let i = 0; i < n; i++) {
        const color = new THREE.Color(
          kind === 'butterfly' ? BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length] : kind === 'dragonfly' ? '#cfe9f2' : '#2a3346',
        );
        set.left.setColorAt(i, color);
        set.right.setColorAt(i, color);
        set.body.setColorAt(i, new THREE.Color(1, 1, 1));
        this.critters.push({
          kind,
          pos: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          target: new THREE.Vector3(),
          home: new THREE.Vector3(),
          timer: -1,
          resting: false,
          flap: rng() * 6,
          scale: kind === 'butterfly' ? 0.9 + rng() * 0.6 : 1,
          angle: rng() * Math.PI * 2,
          index: i,
          homed: false,
        });
      }
    }
  }

  /** `active` 0..1: daylight and dry weather. */
  update(dt: number, focus: THREE.Vector3, active: number): void {
    this.time += dt;
    this.group.visible = active > 0.05;
    if (!this.group.visible) return;
    const counts = new Map<CritterKind, number>();
    for (const c of this.critters) {
      const range = RANGE[c.kind];
      // (Re)home critters that are uninitialised or left far behind.
      // Spawners may pick anywhere in a square of half-size `range`, so allow a generous margin
      // before re-homing (otherwise corner spawns get re-homed every frame and appear to dart).
      if (!c.homed || c.home.distanceTo(focus) > range * 2.2) {
        const p = this.spawner(c.kind, focus, range, this.rng);
        if (!p) continue;
        c.home.copy(p);
        this.surface.up(p, _up);
        c.pos.copy(p).addScaledVector(_up, c.kind === 'swallow' ? 8 : 1);
        c.target.copy(c.pos);
        c.timer = 0;
        c.resting = false;
        c.homed = true;
      }
      // Fewer of them in poor light / weather.
      if (c.index >= Math.round(COUNTS[c.kind] * active)) continue;
      this.step(c, dt);
      const i = counts.get(c.kind) ?? 0;
      counts.set(c.kind, i + 1);
      this.write(c, i, dt);
    }
    for (const [kind, set] of this.meshes) {
      const n = counts.get(kind) ?? 0;
      for (const m of [set.body, set.left, set.right]) {
        m.count = n;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  private step(c: Critter, dt: number): void {
    this.surface.up(c.pos, _up);
    c.timer -= dt;
    if (c.kind === 'butterfly') {
      if (c.resting) {
        c.vel.set(0, 0, 0);
        if (c.timer <= 0) {
          c.resting = false;
          c.timer = 2 + this.rng() * 4;
        }
        return;
      }
      if (c.timer <= 0 || c.pos.distanceTo(c.target) < 0.3) {
        // New flower nearby, or land for a moment.
        if (this.rng() < 0.25) {
          this.surface.ground(c.pos, c.target);
          c.target.addScaledVector(_up, 0.12);
          c.timer = 3;
        } else {
          this.pickTarget(c, 3.5, 0.4, 1.6);
          c.timer = 3 + this.rng() * 3;
        }
      }
      if (c.pos.distanceTo(c.target) < 0.2 && c.target.distanceTo(this.surface.ground(c.target, _a)) < 0.3) {
        c.resting = true;
        c.timer = 1.5 + this.rng() * 3;
      }
      // Erratic, bobbing flight.
      _a.subVectors(c.target, c.pos).setLength(1.1);
      _a.addScaledVector(_up, Math.sin(this.time * 4.5 + c.angle) * 0.7);
      _a.x += Math.sin(this.time * 1.9 + c.angle * 3) * 0.5;
      _a.z += Math.cos(this.time * 1.6 + c.angle * 5) * 0.5;
      c.vel.lerp(_a, 1 - Math.exp(-2.5 * dt));
    } else if (c.kind === 'dragonfly') {
      if (c.timer <= 0) {
        this.pickTarget(c, 2.5, 0.5, 1.4);
        c.timer = 1.5 + this.rng() * 2.5;
      }
      // Dart quickly, then hover with a tiny jitter.
      _a.subVectors(c.target, c.pos).multiplyScalar(2.2);
      if (_a.length() > 3.2) _a.setLength(3.2);
      _a.x += Math.sin(this.time * 9 + c.angle) * 0.08;
      _a.y += Math.sin(this.time * 7 + c.angle) * 0.05;
      c.vel.lerp(_a, 1 - Math.exp(-4 * dt));
    } else {
      // Swallow: wide loops around its home, swooping up and down.
      c.angle += dt * 0.38;
      const r = 9 + Math.sin(this.time * 0.3 + c.scale * 9) * 4;
      _x.set(1, 0, 0);
      if (Math.abs(_up.x) > 0.9) _x.set(0, 0, 1);
      _x.cross(_up).normalize();
      _z.crossVectors(_up, _x);
      c.target
        .copy(c.home)
        .addScaledVector(_x, Math.cos(c.angle) * r)
        .addScaledVector(_z, Math.sin(c.angle) * r)
        .addScaledVector(_up, 6 + Math.sin(c.angle * 2.3) * 3.5);
      _a.subVectors(c.target, c.pos).multiplyScalar(1.4);
      c.vel.lerp(_a, 1 - Math.exp(-2.5 * dt));
    }
    c.pos.addScaledVector(c.vel, dt);
    // Never under the ground.
    this.surface.ground(c.pos, _a);
    const above = _s.subVectors(c.pos, _a).dot(_up);
    if (above < 0.1) c.pos.addScaledVector(_up, 0.1 - above);
  }

  /** Target within `radius` of home, `lo..hi` above the ground. */
  private pickTarget(c: Critter, radius: number, lo: number, hi: number): void {
    this.surface.up(c.home, _up);
    _x.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5);
    _x.addScaledVector(_up, -_x.dot(_up)).setLength(this.rng() * radius);
    c.target.copy(c.home).add(_x);
    this.surface.ground(c.target, c.target);
    c.target.addScaledVector(_up, lo + this.rng() * (hi - lo));
  }

  private write(c: Critter, i: number, dt: number): void {
    const set = this.meshes.get(c.kind)!;
    const speed = c.flap;
    const rate = c.kind === 'butterfly' ? (c.resting ? 1.5 : 9) : c.kind === 'dragonfly' ? 38 : 7;
    c.flap = speed + rate * dt;
    const a =
      c.kind === 'butterfly'
        ? c.resting
          ? 1.1 + Math.sin(c.flap) * 0.25
          : Math.sin(c.flap) * 1.1
        : c.kind === 'dragonfly'
          ? Math.sin(c.flap) * 0.35
          : Math.sin(c.flap) * 0.7 * (Math.sin(this.time * 0.8 + c.scale * 7) > 0 ? 1 : 0.15);
    _z.copy(c.vel);
    this.surface.up(c.pos, _up);
    _z.addScaledVector(_up, -_z.dot(_up) * (c.kind === 'swallow' ? 0.4 : 0.9));
    if (_z.lengthSq() < 1e-4) _z.set(Math.sin(c.angle), 0, Math.cos(c.angle));
    _z.normalize();
    _look.lookAt(_s.set(0, 0, 0), _a.copy(_z).negate(), _up);
    _q.setFromRotationMatrix(_look);
    const scale = c.kind === 'swallow' ? 1.2 : c.scale;
    _m.compose(c.pos, _q, _s.setScalar(scale));
    set.body.setMatrixAt(i, _m);
    set.right.setMatrixAt(i, _w.makeRotationZ(a).premultiply(_m));
    set.left.setMatrixAt(i, _w.makeRotationZ(-a).premultiply(_m));
  }
}
