import * as THREE from 'three';
import { CharacterView, envMaterial, type SoundScape } from '@g2/engine';
import { WATER_Y, type RiverData } from '../world/ValleyGen';
import { boatGeometry } from './boatModel';


const _f = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/**
 * A motorboat on the river. Throttle pushes along the heading, the rudder only turns while
 * moving, sideways slip is damped hard, the current carries it downstream and the banks bounce
 * it back. Without a driver it potters up and down the river on its own.
 */
export class Boat {
  readonly group = new THREE.Group();
  readonly wake: THREE.InstancedMesh;
  readonly driver: CharacterView;
  private readonly hullMesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  heading: number;
  speed = 0;
  readonly velocity = new THREE.Vector3();
  throttle = 0;
  rudder = 0;
  driven = false;
  /** Short impulse when hitting a bank (camera shake). */
  bump = 0;
  private yawRate = 0;
  private time = 0;
  private aiDir = 1;
  private wakeNext = 0;
  private wakeTimer = 0;
  private readonly wakePos: THREE.Vector3[] = [];
  private readonly wakeAge: number[] = [];
  private readonly q = { index: -1, dist: Infinity };

  constructor(
    private readonly river: RiverData,
    startIndex: number,
    private readonly sound: SoundScape,
  ) {
    this.hullMesh = new THREE.Mesh(boatGeometry(), envMaterial({ vertexColors: true, side: THREE.DoubleSide }, { snow: false }));
    this.hullMesh.castShadow = true;
    this.hullMesh.receiveShadow = true;
    this.group.add(this.hullMesh);
    // The driver sits at the port console, hands on the wheel.
    this.driver = new CharacterView({
      skin: '#e9c2a0',
      hair: '#2b211d',
      shirt: '#3f6e5a',
      pants: '#2c3653',
      shoes: '#2a2a2a',
      hat: { type: 'cap', color: '#2f4a6b' },
    });
    this.driver.root.position.set(-0.42, 0.04, -0.38);
    this.driver.play('drive');
    this.group.add(this.driver.root);
    this.group.name = 'boat';
    this.position.set(river.xs[startIndex], WATER_Y, river.zs[startIndex]);
    this.tangent(startIndex, _tan);
    this.heading = Math.atan2(_tan.x, _tan.z);

    const max = 90;
    this.wake = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.5, 8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f2f8fa', transparent: true, opacity: 0.55, depthWrite: false }),
      max,
    );
    this.wake.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.wakePos.push(new THREE.Vector3());
      this.wakeAge.push(99);
      this.wake.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
  }

  /** Rebuilds the boat model for the current quality setting. */
  rebuildModel(): void {
    this.hullMesh.geometry.dispose();
    this.hullMesh.geometry = boatGeometry();
  }

  get forward(): THREE.Vector3 {
    return _f.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get kmh(): number {
    return Math.abs(this.speed) * 3.6;
  }

  private tangent(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = Math.max(0, i - 2);
    const b = Math.min(this.river.xs.length - 1, i + 2);
    return out.set(this.river.xs[b] - this.river.xs[a], 0, this.river.zs[b] - this.river.zs[a]).normalize();
  }

  update(dt: number, listener: THREE.Vector3, soundLevel: number): void {
    this.time += dt;
    const r = this.river;
    r.index.nearest(this.position.x, this.position.z, 60, this.q);
    const i = Math.max(0, this.q.index);
    this.tangent(i, _tan);
    if (!this.driven) this.autopilot(i);

    // Engine + rudder.
    const push = this.throttle * (this.throttle > 0 ? 7 : 3.5);
    this.speed += (push - 0.12 * this.speed * Math.abs(this.speed) - 0.35 * this.speed) * dt;
    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 4, 0, 1) * Math.sign(this.speed || 1);
    this.yawRate = THREE.MathUtils.damp(this.yawRate, -this.rudder * 1.1 * grip, 4, dt);
    this.heading += this.yawRate * dt;

    // Velocity = thrust along heading, plus the current (downstream = increasing index).
    this.velocity.copy(this.forward).multiplyScalar(this.speed).addScaledVector(_tan, 0.7);
    this.position.addScaledVector(this.velocity, dt);

    // Banks: push back towards the centre line and cancel the outward motion.
    const limit = r.hw[i] - 1.7;
    _to.set(r.xs[i] - this.position.x, 0, r.zs[i] - this.position.z);
    const d = _to.length();
    if (d > limit && d > 1e-4) {
      _to.divideScalar(d);
      this.position.addScaledVector(_to, d - limit);
      const out = -this.velocity.dot(_to);
      if (out > 0.5) {
        this.bump = Math.min(1, out / 5);
        this.speed *= 0.6;
        if (soundLevel > 0) this.sound.splash(soundLevel * this.bump);
      }
    }
    // Ends of the river: turn around softly.
    if (this.q.index < 5 || this.q.index > r.xs.length - 6) this.heading += dt * 1.5;
    this.bump = Math.max(0, this.bump - dt * 3);

    // Pose: bobbing, nose up with speed, lean into turns.
    const bob = Math.sin(this.time * 2.1) * 0.06 + Math.sin(this.time * 3.3 + 1) * 0.03;
    this.group.position.set(this.position.x, WATER_Y + bob - 0.1, this.position.z);
    _e.set(-Math.min(0.12, Math.abs(this.speed) * 0.012) + Math.sin(this.time * 1.7) * 0.02, this.heading, -this.yawRate * 0.18 * Math.sign(this.speed || 1), 'YXZ');
    this.group.quaternion.setFromEuler(_e);
    this.group.updateMatrixWorld();

    this.driver.animate(dt, 0);
    this.updateWake(dt);
    const near = Math.max(0, 1 - listener.distanceTo(this.position) / 60);
    this.sound.setMotor(Math.max(near * 0.5, soundLevel), Math.min(1, Math.abs(this.throttle) * 0.7 + Math.abs(this.speed) / 14));
  }

  /** Cruise along the river, turning round near the ends. */
  private autopilot(i: number): void {
    const r = this.river;
    const ahead = THREE.MathUtils.clamp(i + this.aiDir * 14, 0, r.xs.length - 1);
    if (ahead <= 8 || ahead >= r.xs.length - 9) this.aiDir *= -1;
    _to.set(r.xs[ahead] - this.position.x, 0, r.zs[ahead] - this.position.z).normalize();
    const want = Math.atan2(_to.x, _to.z);
    const diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    this.rudder = THREE.MathUtils.clamp(-diff * 2, -1, 1);
    this.throttle = Math.abs(diff) > 1.2 ? 0.25 : 0.55;
  }

  private updateWake(dt: number): void {
    this.wakeTimer -= dt;
    if (Math.abs(this.speed) > 0.8 && this.wakeTimer <= 0) {
      this.wakeTimer = 0.09;
      for (const side of [-0.6, 0.6]) {
        const k = this.wakeNext;
        this.wakeNext = (this.wakeNext + 1) % this.wakePos.length;
        _p.set(side, 0, -2.2).applyQuaternion(this.group.quaternion).add(this.position);
        this.wakePos[k].set(_p.x, WATER_Y + 0.03, _p.z);
        this.wakeAge[k] = 0;
      }
    }
    for (let k = 0; k < this.wakePos.length; k++) {
      if (this.wakeAge[k] > 2.6) continue;
      this.wakeAge[k] += dt;
      const a = this.wakeAge[k] / 2.6;
      const s = a >= 1 ? 0 : (0.6 + a * 2.6) * (1 - a * 0.6);
      _m.compose(this.wakePos[k], _q.identity(), _s.set(s, 1, s));
      this.wake.setMatrixAt(k, _m);
    }
    this.wake.instanceMatrix.needsUpdate = true;
  }
}
