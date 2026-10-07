import * as THREE from 'three';
import type { Rng } from '../world/rng';
import type { Surface } from './Surface';
import type { Weather } from './Weather';

const Y = new THREE.Vector3(0, 1, 0);
/** Horizontal radius of the particle volume around the focus point. */
const VOLUME = 22;
const RAIN_FALL = 15;
const SPLASH_LIFE = 0.32;

const _up = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _g = new THREE.Vector3();
const _gu = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO_SCALE = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * A pool of particles living in a cylinder above the focus point. Each particle remembers the
 * ground point and up vector under its spawn position, so the per-frame "hit the ground?" test
 * is a single dot product (no terrain lookups while falling).
 */
class ParticleField {
  readonly mesh: THREE.InstancedMesh;
  readonly pos: Float32Array;
  readonly ground: Float32Array;
  readonly up: Float32Array;
  readonly seed: Float32Array;
  readonly water: Uint8Array;
  active = 0;

  constructor(
    readonly max: number,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(max * 3);
    this.ground = new Float32Array(max * 3);
    this.up = new Float32Array(max * 3);
    this.seed = new Float32Array(max);
    this.water = new Uint8Array(max);
  }

  /** Height of `p` above this particle's ground point. */
  altitude(i: number, p: THREE.Vector3): number {
    _g.fromArray(this.ground, i * 3);
    _gu.fromArray(this.up, i * 3);
    return _d.subVectors(p, _g).dot(_gu);
  }
}

/** Rain streaks, ground / water splashes and snow flakes around the focus point. */
export class Precipitation {
  readonly group = new THREE.Group();
  private readonly rain: ParticleField;
  private readonly snow: ParticleField;
  private readonly splash: THREE.InstancedMesh;
  private readonly splashAge: Float32Array;
  private readonly splashPos: THREE.Vector3[];
  private readonly splashUp: THREE.Vector3[];
  private splashNext = 0;
  private readonly rainMat: THREE.MeshBasicMaterial;
  private readonly snowMat: THREE.MeshBasicMaterial;
  private readonly center = new THREE.Vector3();
  private quality = 1;
  private time = 0;

  constructor(
    private readonly surface: Surface,
    private readonly rng: Rng,
  ) {
    this.group.name = 'precipitation';
    this.rainMat = new THREE.MeshBasicMaterial({ color: '#dcebf2', transparent: true, opacity: 0.32, depthWrite: false });
    this.snowMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.rain = new ParticleField(2600, new THREE.BoxGeometry(0.012, 0.7, 0.012), this.rainMat);
    this.snow = new ParticleField(3000, new THREE.IcosahedronGeometry(0.04, 0), this.snowMat);

    const splashMax = 160;
    this.splash = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.06, 0.1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#e8f3f8', transparent: true, opacity: 0.55, depthWrite: false }),
      splashMax,
    );
    this.splash.frustumCulled = false;
    this.splash.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashAge = new Float32Array(splashMax).fill(SPLASH_LIFE);
    this.splashPos = Array.from({ length: splashMax }, () => new THREE.Vector3());
    this.splashUp = Array.from({ length: splashMax }, () => new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < splashMax; i++) this.splash.setMatrixAt(i, ZERO_SCALE);

    this.group.add(this.rain.mesh, this.snow.mesh, this.splash);
  }

  /** Particle budget multiplier from the detail setting. */
  setQuality(q: number): void {
    this.quality = q;
  }

  update(dt: number, focus: THREE.Vector3, weather: Weather, daylight: number, visible: boolean): void {
    this.time += dt;
    this.group.visible = visible;
    if (!visible) return;
    this.center.copy(focus);
    this.surface.up(focus, _up);
    _t1.set(0, 1, 0);
    if (Math.abs(_up.y) > 0.9) _t1.set(1, 0, 0);
    _t1.cross(_up).normalize();
    _t2.crossVectors(_up, _t1);

    // Rain and snow get darker at night so they don't glow.
    this.rainMat.color.setRGB(0.25, 0.3, 0.38).lerp(_c.set('#dcebf2'), daylight);
    this.snowMat.color.setRGB(0.42, 0.48, 0.62).lerp(_c.set('#ffffff'), daylight);

    this.updateRain(dt, weather);
    this.updateSnow(dt, weather);
    this.updateSplashes(dt);
  }

  private resize(f: ParticleField, target: number, spawn: (i: number) => void): void {
    const n = Math.min(f.max, Math.round(target));
    for (let i = f.active; i < n; i++) spawn(i);
    f.active = n;
    f.mesh.count = n;
  }

  /** Spawns at a random spot of the volume, `minAlt..maxAlt` above the ground. */
  private spawn(f: ParticleField, i: number, minAlt: number, maxAlt: number): void {
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * VOLUME;
    _p.copy(this.center).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r);
    this.surface.ground(_p, _g);
    this.surface.up(_g, _gu);
    _g.toArray(f.ground, i * 3);
    _gu.toArray(f.up, i * 3);
    f.water[i] = this.surface.isWater(_p) ? 1 : 0;
    f.seed[i] = this.rng();
    _p.copy(_g).addScaledVector(_gu, minAlt + this.rng() * (maxAlt - minAlt));
    _p.toArray(f.pos, i * 3);
  }

  private outside(p: THREE.Vector3): boolean {
    _d.subVectors(p, this.center);
    _d.addScaledVector(_up, -_d.dot(_up));
    return _d.lengthSq() > VOLUME * VOLUME * 1.3;
  }

  private updateRain(dt: number, weather: Weather): void {
    const f = this.rain;
    this.resize(f, weather.rain * f.max * this.quality, (i) => this.spawn(f, i, 0.5, 20));
    if (!f.active) return;
    for (let i = 0; i < f.active; i++) {
      const p = _p.fromArray(f.pos, i * 3);
      _gu.fromArray(f.up, i * 3);
      weather.windAt(p, _w);
      _v.copy(_gu).multiplyScalar(-RAIN_FALL * (0.85 + f.seed[i] * 0.3)).addScaledVector(_w, 9);
      p.addScaledVector(_v, dt);
      if (f.altitude(i, p) <= 0) {
        // Splashes: rings on water, fewer little ones on land.
        if (f.water[i] || f.seed[i] < 0.25) this.addSplash(_g, _gu);
        this.spawn(f, i, 16, 21);
        continue;
      }
      if (this.outside(p)) {
        this.spawn(f, i, 2, 20);
        continue;
      }
      p.toArray(f.pos, i * 3);
      _q.setFromUnitVectors(Y, _v.normalize());
      _m.compose(p, _q, _s.set(1, 1, 1));
      f.mesh.setMatrixAt(i, _m);
    }
    f.mesh.instanceMatrix.needsUpdate = true;
  }

  private updateSnow(dt: number, weather: Weather): void {
    const f = this.snow;
    this.resize(f, weather.snow * f.max * this.quality, (i) => this.spawn(f, i, 0.3, 16));
    if (!f.active) return;
    const t = this.time;
    for (let i = 0; i < f.active; i++) {
      const p = _p.fromArray(f.pos, i * 3);
      const s = f.seed[i];
      _gu.fromArray(f.up, i * 3);
      weather.windAt(p, _w);
      // Fall slowly, drift with the wind and wobble.
      _v.copy(_gu).multiplyScalar(-(1.1 + s * 0.9)).addScaledVector(_w, 3.2);
      _v.x += Math.sin(t * (1.3 + s) + s * 40) * 0.45;
      _v.z += Math.cos(t * (1.1 + s * 0.8) + s * 23) * 0.45;
      _v.y += Math.sin(t * 0.9 + s * 11) * 0.2;
      p.addScaledVector(_v, dt);
      const landed = f.altitude(i, p) <= 0.03;
      if (landed || this.outside(p)) {
        this.spawn(f, i, landed ? 13 : 1, 16);
        continue;
      }
      p.toArray(f.pos, i * 3);
      const scale = 0.7 + s * 0.8;
      _m.makeScale(scale, scale, scale).setPosition(p);
      f.mesh.setMatrixAt(i, _m);
    }
    f.mesh.instanceMatrix.needsUpdate = true;
  }

  private addSplash(p: THREE.Vector3, up: THREE.Vector3): void {
    const i = this.splashNext;
    this.splashNext = (this.splashNext + 1) % this.splashAge.length;
    this.splashAge[i] = 0;
    this.splashPos[i].copy(p).addScaledVector(up, 0.02);
    this.splashUp[i].copy(up);
  }

  private updateSplashes(dt: number): void {
    let any = false;
    for (let i = 0; i < this.splashAge.length; i++) {
      if (this.splashAge[i] >= SPLASH_LIFE) continue;
      any = true;
      this.splashAge[i] += dt;
      const k = this.splashAge[i] / SPLASH_LIFE;
      if (k >= 1) {
        this.splash.setMatrixAt(i, ZERO_SCALE);
        continue;
      }
      _q.setFromUnitVectors(Y, this.splashUp[i]);
      const s = 0.6 + k * 3.2;
      _m.compose(this.splashPos[i], _q, _s.set(s, 1, s * (1 - k * 0.3)));
      this.splash.setMatrixAt(i, _m);
    }
    if (any) this.splash.instanceMatrix.needsUpdate = true;
  }
}
