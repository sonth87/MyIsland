import * as THREE from 'three';
import { envMaterial, lowpoly, randRange, type Rng } from '@g2/engine';
import { HALF } from '../world/ValleyGen';

const { paint } = lowpoly;

interface Bird {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  flap: number;
  flapSpeed: number;
  scale: number;
  color: THREE.Color;
}

interface Flock {
  birds: Bird[];
  goal: THREE.Vector3;
  goalTimer: number;
  altitude: number;
}

type PerchState = 'perched' | 'flying';

interface Sparrow extends Bird {
  state: PerchState;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  duration: number;
  arc: number;
  timer: number;
  perch: number;
}

const _a = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3();

function birdParts() {
  const body = paint(new THREE.OctahedronGeometry(0.22, 0).scale(0.7, 0.6, 1.6), '#ffffff');
  const head = paint(new THREE.OctahedronGeometry(0.12, 0).translate(0, 0.08, 0.36), '#ffffff');
  const tail = paint(new THREE.ConeGeometry(0.1, 0.3, 3).rotateX(-Math.PI / 2).translate(0, 0, -0.42), '#ffffff');
  const wing = (dir: 1 | -1) => {
    const g = new THREE.BufferGeometry();
    // Triangle from the shoulder outwards, swept back.
    const v = [0, 0, 0.18, dir * 0.85, 0, -0.12, 0, 0, -0.22];
    g.setAttribute('position', new THREE.Float32BufferAttribute(dir > 0 ? v : [v[0], v[1], v[2], v[6], v[7], v[8], v[3], v[4], v[5]], 3));
    return paint(g, '#ffffff');
  };
  return { body: lowpoly.merge([body, head, tail]), left: wing(-1), right: wing(1) };
}

/**
 * Birds of the valley: flocks that wheel over the valley (boids), and little birds that hop
 * from tree to tree and scatter when the train or the boat comes by.
 */
export class Birds {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly wingL: THREE.InstancedMesh;
  private readonly wingR: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly sparrows: Sparrow[] = [];
  private readonly all: Bird[] = [];
  private readonly perFlock = 16;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    /** Perch points: tops of tree crowns. */
    private readonly perches: THREE.Vector3[],
    private readonly rng: Rng,
  ) {
    const parts = birdParts();
    const mat = envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { snow: false, wet: false });
    const flockCount = 3;
    const perFlock = this.perFlock;
    const sparrowCount = Math.min(28, perches.length);
    const total = flockCount * perFlock + sparrowCount;
    this.body = new THREE.InstancedMesh(parts.body, mat, total);
    this.wingL = new THREE.InstancedMesh(parts.left, mat, total);
    this.wingR = new THREE.InstancedMesh(parts.right, mat, total);
    for (const m of [this.body, this.wingL, this.wingR]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }

    const flockColors = ['#f4f2ec', '#3a3f4a', '#e8e2d6'];
    for (let f = 0; f < flockCount; f++) {
      const goal = new THREE.Vector3(randRange(rng, -120, 120), 0, randRange(rng, -120, 120));
      const flock: Flock = { birds: [], goal, goalTimer: 0, altitude: randRange(rng, 24, 40) };
      for (let i = 0; i < perFlock; i++) {
        const b: Bird = {
          pos: goal.clone().add(new THREE.Vector3(randRange(rng, -8, 8), 30 + randRange(rng, -3, 3), randRange(rng, -8, 8))),
          vel: new THREE.Vector3(randRange(rng, -1, 1), 0, randRange(rng, -1, 1)).setLength(5),
          flap: rng() * 6,
          flapSpeed: randRange(rng, 5.5, 7.5),
          scale: f === 1 ? 0.8 : 1.3,
          color: new THREE.Color(flockColors[f]),
        };
        flock.birds.push(b);
        this.all.push(b);
      }
      this.flocks.push(flock);
    }

    const sparrowColors = ['#8a5a3c', '#6b4a36', '#a7774f', '#55606e'];
    for (let i = 0; i < sparrowCount; i++) {
      const perch = Math.floor(rng() * perches.length);
      const s: Sparrow = {
        pos: perches[perch].clone(),
        vel: new THREE.Vector3(0, 0, 1),
        flap: rng() * 6,
        flapSpeed: 15,
        scale: 0.42,
        color: new THREE.Color(sparrowColors[i % sparrowColors.length]),
        state: 'perched',
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        t: 0,
        duration: 1,
        arc: 1,
        timer: rng() * 6,
        perch,
      };
      this.sparrows.push(s);
      this.all.push(s);
    }
    this.all.forEach((b, i) => {
      this.body.setColorAt(i, b.color);
      this.wingL.setColorAt(i, b.color);
      this.wingR.setColorAt(i, b.color);
    });
  }

  /** `threats`: moving things that scare perched birds away (train, boat). */
  update(dt: number, threats: THREE.Vector3[], wind: THREE.Vector3, activity = 1): void {
    this.group.visible = activity > 0.02;
    if (!this.group.visible) return;
    for (const f of this.flocks) this.updateFlock(f, dt, wind);
    for (const s of this.sparrows) this.updateSparrow(s, dt, threats);
    // Fewer birds in autumn, none in winter: the extra ones are folded away to nothing.
    const flockBirds = this.flocks.length * this.perFlock;
    const perFlockShown = Math.round(this.perFlock * activity);
    const sparrowsShown = Math.round(this.sparrows.length * activity);
    this.all.forEach((b, i) => {
      const hide = i < flockBirds ? i % this.perFlock >= perFlockShown : i - flockBirds >= sparrowsShown;
      if (hide) {
        for (const m of [this.body, this.wingL, this.wingR]) m.setMatrixAt(i, this.hidden);
      } else {
        this.write(b, i, dt);
      }
    });
    for (const m of [this.body, this.wingL, this.wingR]) m.instanceMatrix.needsUpdate = true;
  }

  private updateFlock(f: Flock, dt: number, wind: THREE.Vector3): void {
    f.goalTimer -= dt;
    if (f.goalTimer <= 0) {
      f.goalTimer = randRange(this.rng, 16, 30);
      f.goal.set(randRange(this.rng, -HALF * 0.7, HALF * 0.7), 0, randRange(this.rng, -HALF * 0.7, HALF * 0.7));
    }
    const birds = f.birds;
    for (const b of birds) {
      _sep.set(0, 0, 0);
      _ali.set(0, 0, 0);
      _coh.set(0, 0, 0);
      let n = 0;
      for (const o of birds) {
        if (o === b) continue;
        const d = b.pos.distanceTo(o.pos);
        if (d < 2.5) _sep.add(_a.subVectors(b.pos, o.pos).divideScalar(Math.max(0.2, d * d)));
        if (d < 12) {
          _ali.add(o.vel);
          _coh.add(o.pos);
          n++;
        }
      }
      _a.set(0, 0, 0).addScaledVector(_sep, 6);
      if (n) {
        _a.addScaledVector(_ali.divideScalar(n).sub(b.vel), 0.6);
        _a.addScaledVector(_coh.divideScalar(n).sub(b.pos), 0.35);
      }
      // Head for the wandering goal and hold altitude above the terrain.
      const ground = this.heightAt(b.pos.x, b.pos.z);
      const wantY = Math.max(ground + 14, f.altitude + Math.max(0, ground - 5));
      _a.x += (f.goal.x - b.pos.x) * 0.008;
      _a.z += (f.goal.z - b.pos.z) * 0.008;
      _a.y += (wantY - b.pos.y) * 0.4;
      b.vel.addScaledVector(_a, dt).addScaledVector(wind, dt * 0.3);
      const speed = b.vel.length();
      b.vel.setLength(THREE.MathUtils.clamp(speed, 4, 6.5));
      b.pos.addScaledVector(b.vel, dt);
    }
  }

  private updateSparrow(s: Sparrow, dt: number, threats: THREE.Vector3[]): void {
    if (s.state === 'perched') {
      s.timer -= dt;
      const scared = threats.some((t) => t.distanceToSquared(s.pos) < 14 * 14);
      // Little hops while perched.
      s.pos.copy(this.perches[s.perch]);
      s.pos.y += Math.abs(Math.sin(s.timer * 5)) * (Math.sin(s.timer * 0.7) > 0.6 ? 0.18 : 0);
      if (s.timer <= 0 || scared) this.takeOff(s, scared);
      return;
    }
    s.t += dt / s.duration;
    if (s.t >= 1) {
      s.state = 'perched';
      s.timer = randRange(this.rng, 2, 9);
      s.pos.copy(s.to);
      s.vel.y = 0;
      return;
    }
    const prev = _a.copy(s.pos);
    s.pos.lerpVectors(s.from, s.to, s.t);
    s.pos.y += Math.sin(Math.PI * s.t) * s.arc;
    s.vel.subVectors(s.pos, prev).divideScalar(Math.max(dt, 1e-4));
  }

  private takeOff(s: Sparrow, far: boolean): void {
    const here = this.perches[s.perch];
    const [min, max] = far ? [22, 45] : [5, 24];
    let best = -1;
    for (let tries = 0; tries < 30; tries++) {
      const k = Math.floor(this.rng() * this.perches.length);
      const d = this.perches[k].distanceTo(here);
      if (d >= min && d <= max) {
        best = k;
        break;
      }
    }
    if (best < 0) {
      s.timer = 2;
      return;
    }
    s.state = 'flying';
    s.from.copy(s.pos);
    s.perch = best;
    s.to.copy(this.perches[best]);
    const d = s.from.distanceTo(s.to);
    s.duration = d / (far ? 6 : 3.5);
    s.arc = 1.5 + d * 0.15;
    s.t = 0;
  }

  /** Body and wing matrices for bird `i`: faces its velocity and flaps (folded when perched). */
  private write(b: Bird, i: number, dt: number): void {
    const flying = !('state' in b) || (b as Sparrow).state === 'flying';
    b.flap += dt * b.flapSpeed * (flying ? 1 : 0.15);
    // Flocks glide now and then: flap only on part of a slow cycle.
    const glide = !('state' in b) && Math.sin(b.flap * 0.11) > 0.55;
    const flapAngle = flying ? (glide ? 0.12 : Math.sin(b.flap) * 0.85) : -1.25;
    _z.copy(b.vel);
    if (!flying || _z.lengthSq() < 1e-4) _z.set(Math.sin(i), 0, Math.cos(i));
    if (!flying) _z.y = 0;
    _z.normalize();
    // Matrix4.lookAt points +Z away from the target, so look at -direction.
    _look.lookAt(_s.set(0, 0, 0), _z.clone().negate(), _up);
    _q.setFromRotationMatrix(_look);
    _m.compose(b.pos, _q, _s.setScalar(b.scale));
    this.body.setMatrixAt(i, _m);
    _w.makeRotationZ(flapAngle);
    this.wingR.setMatrixAt(i, _w.premultiply(_m).clone());
    _w.makeRotationZ(-flapAngle);
    this.wingL.setMatrixAt(i, _w.premultiply(_m).clone());
  }
}
