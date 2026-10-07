import * as THREE from 'three';
import { SpatialHash } from '../world/SpatialHash';
import type { Rng } from '../world/rng';
import { envMaterial } from './envShader';
import type { Surface } from './Surface';
import type { Weather } from './Weather';

export interface LeafSource {
  /** World position of the tree base. */
  position: THREE.Vector3;
  scale: number;
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

export interface LeavesOptions {
  colors?: string[];
  /** Leaf size range (world units). */
  size?: [number, number];
  max?: number;
  /** Leaves per second in calm air (more with wind). */
  baseRate?: number;
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
  private readonly size: [number, number];
  private readonly baseRate: number;
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
    this.crown = options.crown ?? [1.4, 2.4];
    const colors = (options.colors ?? LEAF_COLORS).map((c) => new THREE.Color(c));
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
      });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, colors[i % colors.length]);
    }
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
      this.sources.query(focus, NEARBY_RADIUS, (s) => this.nearby.push(s));
    }
    // Gentle trickle in calm air, many more when it's windy; none when snow covers everything.
    const rate = (this.baseRate + weather.gust * weather.gust * 14) * (1 - weather.snowCover * 0.8);
    this.spawnBudget += rate * dt;
    while (this.spawnBudget >= 1) {
      this.spawnBudget -= 1;
      if (this.nearby.length) this.spawn(this.nearby[Math.floor(this.rng() * this.nearby.length)], 0);
    }

    for (let i = 0; i < this.max; i++) this.step(i, dt, weather);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private spawn(tree: LeafSource, kick: number): void {
    const leaf = this.leaves.find((l) => l.state === State.Off) ?? this.oldestLanded();
    if (!leaf) return;
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
    leaf.life = 7 + r() * 8;
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
        leaf.angle = this.rng() * Math.PI * 2;
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
  }
}
