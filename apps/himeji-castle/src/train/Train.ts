import * as THREE from 'three';
import { envMaterial, lowpoly, type SoundScape, type Weather } from '@g2/engine';
import { railPose, type RailData } from '../world/ValleyGen';
import { buildCoach, buildLoco, buildTender, type CarModel } from './trainModel';

interface Car extends CarModel {
  /** Distance from the car's front to the front of the train. */
  offset: number;
}

export type TrainState = 'run' | 'braking' | 'stopped';

const COACH_COLORS = ['#3e6b55', '#6e3a58', '#3e6b55', '#6e3a58'];
const GAP = 0.7;
const MAX_SPEED = 24;

/** Pooled smoke puffs: rise, drift with the wind, grow and shrink away. */
class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly age: number[] = [];
  private readonly life: number[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(max = 70) {
    this.mesh = new THREE.InstancedMesh(
      lowpoly.facet(new THREE.IcosahedronGeometry(1, 1)),
      envMaterial({ color: '#eceae4', emissive: '#eceae4', emissiveIntensity: 0.15 }, { snow: false, wet: false }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < max; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.age.push(99);
      this.life.push(1);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
  }

  emit(at: THREE.Vector3, vel: THREE.Vector3, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.pos.length;
    this.pos[i].copy(at);
    this.vel[i].copy(vel);
    this.age[i] = 0;
    this.life[i] = life;
  }

  update(dt: number, weather: Weather): void {
    for (let i = 0; i < this.pos.length; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      weather.windAt(this.pos[i], this.w);
      this.vel[i].multiplyScalar(Math.exp(-1.2 * dt));
      this.vel[i].y += 1.2 * dt;
      this.pos[i].addScaledVector(this.vel[i], dt).addScaledVector(this.w, dt * 4);
      const size = k >= 1 ? 0 : (0.45 + k * 2.2) * Math.min(1, (1 - k) * 3);
      this.q.setFromAxisAngle(this.s.set(0, 1, 0), i);
      this.m.compose(this.pos[i], this.q, this.s.setScalar(size));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _stack = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * A steam train running round the loop. Automatic mode cruises and stops at the station;
 * manual mode is driven with throttle and brake (it slows down uphill and speeds up downhill).
 */
export class Train {
  readonly group = new THREE.Group();
  readonly cars: Car[] = [];
  readonly smoke = new Smoke();
  /** Arc length of the front of the locomotive. */
  s: number;
  speed = 0;
  throttle = 0;
  brake = 0;
  manual = false;
  /** Cruise speed for automatic mode (0..1 of max). */
  cruise = 0.5;
  state: TrainState = 'run';
  private stopTimer = 0;
  private departed = true;
  private chuffPhase = 0;
  private readonly stopS: number;

  constructor(
    private readonly rail: RailData,
    stationIndex: number,
    private readonly sound: SoundScape,
  ) {
    this.buildCars();
    this.group.add(this.smoke.mesh);
    this.group.name = 'train';
    // Stop with the coaches along the platform.
    this.stopS = stationIndex + 24;
    this.s = stationIndex + 24;
    this.state = 'stopped';
    this.stopTimer = 4;
    this.departed = false;
    this.place();
  }

  private readonly mat = envMaterial({ vertexColors: true });
  private readonly glowMat = envMaterial({ vertexColors: true }, { glow: true, snow: false, wet: false });
  private wheelAngle = 0;

  /** (Re)creates the car models for the current quality setting, keeping the train's state. */
  buildCars(): void {
    for (const car of this.cars) {
      this.group.remove(car.group);
      car.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
    }
    this.cars.length = 0;
    const builds = [buildLoco(this.mat, this.glowMat), buildTender(this.mat), ...COACH_COLORS.map((c) => buildCoach(this.mat, this.glowMat, c))];
    let offset = 0;
    for (const b of builds) {
      this.cars.push({ ...b, offset });
      offset += b.length + GAP;
      this.group.add(b.group);
    }
    if (this.rail) this.place();
  }

  get length(): number {
    const last = this.cars[this.cars.length - 1];
    return last.offset + last.length;
  }

  /** Forward distance from the front of the train to the stop mark. */
  private distanceToStop(): number {
    const L = this.rail.length;
    return (((this.stopS - this.s) % L) + L) % L;
  }

  whistle(): void {
    this.sound.whistle();
  }

  update(dt: number, weather: Weather, listener: THREE.Vector3): void {
    if (this.manual) this.updateManual(dt);
    else this.updateAuto(dt);
    this.s = (this.s + this.speed * dt) % this.rail.length;
    this.place();

    // Wheels, smoke and the chuff rhythm (4 exhausts per driving-wheel turn).
    const loco = this.cars[0];
    this.wheelAngle += (this.speed * dt) / loco.wheelRadius;
    for (const car of this.cars) {
      for (const w of car.wheels) w.rotation.x += (this.speed * dt) / car.wheelRadius;
      car.onWheel?.(this.wheelAngle);
    }
    _stack.set(0, 4.2, 3.55).applyMatrix4(loco.group.matrixWorld);
    this.chuffPhase += (this.speed * dt) / (2 * Math.PI * loco.wheelRadius) * 4;
    const dist = listener.distanceTo(_stack);
    const loud = Math.max(0, 1 - dist / 90);
    if (this.chuffPhase >= 1 || (this.speed < 0.2 && Math.random() < dt * 0.6)) {
      this.chuffPhase %= 1;
      _v.set((Math.random() - 0.5) * 0.6, 2.5 + this.throttle * 2 + this.speed * 0.1, (Math.random() - 0.5) * 0.6);
      this.smoke.emit(_stack, _v, 2.2 + Math.random());
      if (loud > 0 && this.speed > 0.2) this.sound.chuff(loud * (0.5 + this.throttle * 0.5));
    }
    this.smoke.update(dt, weather);
  }

  private updateAuto(dt: number): void {
    const cruise = this.cruise * MAX_SPEED;
    const d = this.distanceToStop();
    if (this.state === 'stopped') {
      this.speed = 0;
      this.stopTimer -= dt;
      if (this.stopTimer <= 0) {
        this.state = 'run';
        this.departed = false;
        this.whistle();
      }
      return;
    }
    if (!this.departed && d > 60 && d < this.rail.length - 60) this.departed = true;
    const brakeDist = (this.speed * this.speed) / (2 * 1.1);
    if (this.departed && d < brakeDist + 6) this.state = 'braking';
    let target = cruise;
    if (this.state === 'braking') {
      target = Math.sqrt(Math.max(0, 2 * 1.1 * (d - 0.5)));
      if (d < 0.8 || (this.speed < 0.25 && d < 3)) {
        this.state = 'stopped';
        this.stopTimer = 8;
        this.speed = 0;
        return;
      }
    }
    const a = target > this.speed ? 1.6 : 2.2;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), a * dt);
    this.throttle = target > this.speed + 0.1 ? 1 : 0.3;
  }

  /** Throttle 0..1, brake 0..1 set by the driver; gravity along the slope matters. */
  private updateManual(dt: number): void {
    railPose(this.rail, this.s - 4, _p1, _t);
    const slope = _t.y;
    const drag = 0.0016 * this.speed * this.speed + 0.03 * this.speed;
    const accel = this.throttle * 2.2 - this.brake * 4 - slope * 9.8 * 0.6 - drag;
    this.speed = THREE.MathUtils.clamp(this.speed + accel * dt, 0, MAX_SPEED);
    this.state = this.speed > 0.05 ? 'run' : 'stopped';
  }

  /** Puts every car on the track using a front and a rear bogie point. */
  private place(): void {
    for (const car of this.cars) {
      const front = this.s - car.offset - 1.4;
      const rear = this.s - car.offset - car.length + 1.4;
      railPose(this.rail, front, _p1, _t);
      railPose(this.rail, rear, _p2, _t);
      car.group.position.addVectors(_p1, _p2).multiplyScalar(0.5);
      car.group.lookAt(_p1);
      car.group.updateMatrixWorld();
    }
  }

  /** km/h for the HUD. */
  get kmh(): number {
    return this.speed * 3.6;
  }
}
