import * as THREE from 'three';
import { envMaterial } from '../env/envShader';
import type { Surface } from '../env/Surface';
import { merge, paint } from '../props/lowpoly';
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

function fishGeometry(color: string): THREE.BufferGeometry {
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
    this.fish = new THREE.InstancedMesh(fishGeometry('#ffffff'), envMaterial({ vertexColors: true }, { snow: false, wet: false }), 3);
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
    this.group.add(padMesh, flowerMesh, this.fish, this.rings);
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
