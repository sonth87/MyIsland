import * as THREE from 'three';
import { SpatialHash } from '../world/SpatialHash';
import type { Rng } from '../world/rng';
import { envMaterial } from './envShader';
import type { Season } from './Season';
import type { Surface } from './Surface';
import type { Weather } from './Weather';

export interface LeafSource {
  /** World position of the tree base. */
  position: THREE.Vector3;
  scale: number;
  /** Kind of tree ('sakura', 'broadleaf', …), so a style can pick which trees shed. */
  tag?: string;
}

/** What falls, from which trees, how often and how long it lies on the ground. */
export interface LeafStyle {
  colors: string[];
  size: [number, number];
  /** Leaves per second in calm air (0 = nothing falls). */
  rate: number;
  /** Extra leaves per second in strong wind (scaled by the gust squared). */
  windRate: number;
  /** Seconds a leaf lies on the ground before fading away. */
  groundLife: [number, number];
  /** Only these trees shed (all when omitted). */
  tags?: string[];
}

const enum State {
  Off,
  Falling,
  Landed,
  Floating,
}

const MAX_DEFAULT = 320;
const GRAVITY = 2.6;
const DRAG = 1.5;
const NEARBY_RADIUS = 32;
const LEAF_COLORS = ['#6cb84d', '#9cc95a', '#e2b84a', '#e08a3c', '#c8643a', '#8f6a3e'];

const DECIDUOUS = ['sakura', 'broadleaf', 'maple'];

/** What falls from the trees in each season: petals, a few green leaves, a rain of autumn leaves, nothing. */
export const SEASON_LEAF_STYLE: Record<Season, LeafStyle> = {
  spring: { colors: ['#f7c3d2', '#fbd9e3', '#f2a9bf', '#ffffff'], size: [0.09, 0.15], rate: 9, windRate: 14, groundLife: [10, 22], tags: ['sakura'] },
  summer: { colors: ['#5fae48', '#79c457', '#4a9a3c'], size: [0.12, 0.2], rate: 0.5, windRate: 6, groundLife: [8, 14], tags: DECIDUOUS },
  autumn: { colors: ['#e8c13c', '#e07b2e', '#c63a2a', '#b4863a', '#a8703a'], size: [0.2, 0.34], rate: 11, windRate: 26, groundLife: [50, 100], tags: DECIDUOUS },
  winter: { colors: ['#9a7a52', '#7d6446'], size: [0.14, 0.22], rate: 0, windRate: 0, groundLife: [8, 14], tags: [] },
};

export interface LeavesOptions {
  colors?: string[];
  /** Leaf size range (world units). */
  size?: [number, number];
  max?: number;
  /** Leaves per second in calm air (more with wind). */
  baseRate?: number;
  /** Seconds a leaf lies on the ground (default 7–15). */
  groundLife?: [number, number];
  /** Crown height range above the tree base, in tree-scale units. */
  crown?: [number, number];
}

const Y = new THREE.Vector3(0, 1, 0);
const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _gp = new THREE.Vector3();
const _w = new THREE.Vector3();
const _side = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qs = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Leaf {
  state: State;
  p: THREE.Vector3;
  v: THREE.Vector3;
  axis: THREE.Vector3;
  angle: number;
  spin: number;
  phase: number;
  freq: number;
  size: number;
  age: number;
  life: number;
  ground: number;
  groundAge: number;
  /** Matrix is final (a leaf resting on the ground needs no per-frame update). */
  settled: boolean;
}

function leafGeometry(): THREE.BufferGeometry {
  // A small diamond, slightly folded along its midrib.
  const g = new THREE.BufferGeometry();
  const v = [0, 0, -0.5, 0.28, 0.05, 0, 0, 0, 0.5, 0, 0, -0.5, 0, 0, 0.5, -0.28, 0.05, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Falling leaves: spawned from nearby tree crowns (more in strong wind, a burst when a tree
 * is shaken), pulled by gravity towards the planet center, dragged by the wind, fluttering
 * side to side, then resting on the ground (or floating on water) before fading.
 */
export class Leaves {
  readonly mesh: THREE.InstancedMesh;
  enabled = true;
  private readonly leaves: Leaf[] = [];
  private readonly sources = new SpatialHash<LeafSource>(8);
  private nearby: LeafSource[] = [];
  private nearbyAge = 99;
  private spawnBudget = 0;
  private time = 0;
  private readonly max: number;
  private size: [number, number];
  private baseRate: number;
  private windRate = 14;
  private groundLife: [number, number];
  private tags: Set<string> | null = null;
  private colors: THREE.Color[];
  private colorsDirty = false;
  private readonly crown: [number, number];

  constructor(
    private readonly surface: Surface,
    sources: LeafSource[],
    private readonly rng: Rng,
    options: LeavesOptions = {},
  ) {
    for (const s of sources) this.sources.insert(s.position, s);
    this.max = options.max ?? MAX_DEFAULT;
    this.size = options.size ?? [0.16, 0.26];
    this.baseRate = options.baseRate ?? 0.6;
    this.groundLife = options.groundLife ?? [7, 15];
    this.crown = options.crown ?? [1.4, 2.4];
    const colors = (options.colors ?? LEAF_COLORS).map((c) => new THREE.Color(c));
    this.colors = colors;
    const MAX = this.max;
    this.mesh = new THREE.InstancedMesh(
      leafGeometry(),
      envMaterial({ side: THREE.DoubleSide }, { snow: false }),
      MAX,
    );
    this.mesh.name = 'leaves';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) {
      this.leaves.push({
        state: State.Off,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        axis: new THREE.Vector3(1, 0, 0),
        angle: 0,
        spin: 0,
        phase: 0,
        freq: 1,
        size: 0.2,
        age: 0,
        life: 10,
        ground: 0,
        groundAge: 0,
        settled: false,
      });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, colors[i % colors.length]);
    }
  }

  /** Changes what falls (e.g. pink petals in spring, red leaves in autumn). Leaves already falling keep their look. */
  setStyle(style: LeafStyle): void {
    this.colors = style.colors.map((c) => new THREE.Color(c));
    this.size = style.size;
    this.baseRate = style.rate;
    this.windRate = style.windRate;
    this.groundLife = style.groundLife;
    this.tags = style.tags ? new Set(style.tags) : null;
    this.nearbyAge = 99; // rebuild the list of shedding trees
  }

  /** Releases a handful of leaves from one tree (when it is shaken). */
  burst(tree: LeafSource, count: number): void {
    for (let i = 0; i < count; i++) this.spawn(tree, 1.5);
  }

  update(dt: number, focus: THREE.Vector3, weather: Weather, visible: boolean): void {
    this.time += dt;
    this.mesh.visible = visible && this.enabled;
    if (!this.mesh.visible) return;

    this.nearbyAge += dt;
    if (this.nearbyAge > 1) {
      this.nearbyAge = 0;
      this.nearby = [];
      this.sources.query(focus, NEARBY_RADIUS, (s) => {
        if (!this.tags || (s.tag && this.tags.has(s.tag))) this.nearby.push(s);
      });
    }
    // Gentle trickle in calm air, many more when it's windy; none when snow covers everything.
    const rate = this.baseRate > 0 ? (this.baseRate + weather.gust * weather.gust * this.windRate) * (1 - weather.snowCover * 0.8) : 0;
    this.spawnBudget += rate * dt;
    while (this.spawnBudget >= 1) {
      this.spawnBudget -= 1;
      if (this.nearby.length) this.spawn(this.nearby[Math.floor(this.rng() * this.nearby.length)], 0);
    }

    for (let i = 0; i < this.max; i++) this.step(i, dt, weather);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorsDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorsDirty = false;
    }
  }

  private spawn(tree: LeafSource, kick: number): void {
    let idx = this.leaves.findIndex((l) => l.state === State.Off);
    if (idx < 0) idx = this.leaves.indexOf(this.oldestLanded() as Leaf);
    if (idx < 0) return;
    const leaf = this.leaves[idx];
    this.mesh.setColorAt(idx, this.colors[Math.floor(this.rng() * this.colors.length)]);
    this.colorsDirty = true;
    leaf.settled = false;
    const r = this.rng;
    this.surface.up(tree.position, _up);
    _a.set(r() - 0.5, r() - 0.5, r() - 0.5);
    _a.addScaledVector(_up, -_a.dot(_up)).normalize().multiplyScalar((0.2 + r() * 0.7) * tree.scale);
    const [c0, c1] = this.crown;
    leaf.p.copy(tree.position).addScaledVector(_up, (c0 + r() * (c1 - c0)) * tree.scale).add(_a);
    leaf.v.copy(_a).multiplyScalar(kick).addScaledVector(_up, kick * 0.6);
    leaf.axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    leaf.angle = r() * Math.PI * 2;
    leaf.spin = (2 + r() * 5) * (r() < 0.5 ? -1 : 1);
    leaf.phase = r() * Math.PI * 2;
    leaf.freq = 1.6 + r() * 1.8;
    leaf.size = this.size[0] + r() * (this.size[1] - this.size[0]);
    leaf.age = 0;
    leaf.life = 25;
    leaf.groundAge = 99;
    leaf.state = State.Falling;
  }

  private oldestLanded(): Leaf | undefined {
    let best: Leaf | undefined;
    for (const l of this.leaves) if (l.state === State.Landed && (!best || l.age > best.age)) best = l;
    return best;
  }

  private step(i: number, dt: number, weather: Weather): void {
    const leaf = this.leaves[i];
    if (leaf.state === State.Off) return;
    leaf.age += dt;
    // A leaf lying on the ground costs almost nothing until a gust lifts it or it starts to fade.
    if (leaf.state === State.Landed && leaf.settled && leaf.age < leaf.life - 1.2 && weather.gust < 0.55) return;
    const up = this.surface.up(leaf.p, _up);
    weather.windAt(leaf.p, _w).multiplyScalar(4.5);

    if (leaf.state === State.Falling) {
      // Gravity + drag towards the wind velocity + side-to-side flutter with a little lift.
      const ph = this.time * leaf.freq + leaf.phase;
      _side.crossVectors(up, leaf.v);
      if (_side.lengthSq() < 1e-6) _side.copy(leaf.axis).addScaledVector(up, -leaf.axis.dot(up));
      _side.normalize();
      _a.copy(up).multiplyScalar(-GRAVITY + Math.cos(ph * 2) * 1.1);
      _a.addScaledVector(_side, Math.sin(ph) * 2.4);
      _a.x += (_w.x - leaf.v.x) * DRAG;
      _a.y += (_w.y - leaf.v.y) * DRAG;
      _a.z += (_w.z - leaf.v.z) * DRAG;
      leaf.v.addScaledVector(_a, dt);
      leaf.p.addScaledVector(leaf.v, dt);
      leaf.angle += leaf.spin * dt;

      // leaf.ground = height above the ground (refreshed often when close).
      leaf.groundAge += dt;
      if (leaf.groundAge > 0.25 || leaf.ground < 1.5) {
        this.surface.ground(leaf.p, _gp);
        leaf.ground = _a.subVectors(leaf.p, _gp).dot(up);
        leaf.groundAge = 0;
      } else {
        leaf.ground += leaf.v.dot(up) * dt;
      }
      if (leaf.ground <= 0.03) {
        this.surface.ground(leaf.p, _gp);
        leaf.state = this.surface.isWater(leaf.p) ? State.Floating : State.Landed;
        leaf.p.copy(_gp).addScaledVector(up, 0.03);
        leaf.v.set(0, 0, 0);
        leaf.age = 0;
        leaf.life = this.groundLife[0] + this.rng() * (this.groundLife[1] - this.groundLife[0]);
        leaf.angle = this.rng() * Math.PI * 2;
        leaf.settled = false;
      }
      if (leaf.age > 25) leaf.state = State.Off;
    } else if (leaf.state === State.Floating) {
      leaf.p.addScaledVector(_w, dt * 0.15);
      this.surface.ground(leaf.p, _gp);
      leaf.p.copy(_gp).addScaledVector(up, 0.03);
    } else if (leaf.state === State.Landed && weather.gust > 0.55 && this.rng() < dt * 0.25 * weather.gust) {
      // A strong gust picks a resting leaf back up.
      leaf.state = State.Falling;
      leaf.v.copy(up).multiplyScalar(1.8).addScaledVector(_w, 0.4);
      leaf.age = 0;
    }

    if (leaf.state !== State.Falling && leaf.age > leaf.life) leaf.state = State.Off;
    if (leaf.state === State.Off) {
      this.mesh.setMatrixAt(i, ZERO);
      return;
    }

    _q.setFromUnitVectors(Y, up);
    if (leaf.state === State.Falling) _q.multiply(_qs.setFromAxisAngle(leaf.axis, leaf.angle));
    else _q.multiply(_qs.setFromAxisAngle(Y, leaf.angle));
    const fade = leaf.state === State.Falling ? 1 : Math.min(1, (leaf.life - leaf.age) / 1.2);
    _m.compose(leaf.p, _q, _s.setScalar(leaf.size * fade));
    this.mesh.setMatrixAt(i, _m);
    if (leaf.state === State.Landed) leaf.settled = true;
  }
}
