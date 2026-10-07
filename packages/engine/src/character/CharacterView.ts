import * as THREE from 'three';
import { envMaterial } from '../env/envShader';
import { q } from '../render/quality';

export interface Outfit {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  hairStyle?: 'short' | 'bun' | 'ponytail' | 'bald';
  /** Long kimono / yukata robe over the legs (colour), with an obi sash. */
  robe?: { color: string; obi: string };
  hat?: { type: 'straw' | 'cap'; color: string };
  accessory?: 'camera' | 'bag' | 'basket' | 'rod';
  /** Overall scale (1 = adult ~1.7 units). */
  height?: number;
}

export type Action = 'wave' | 'photo' | 'shake' | 'talk' | 'sit' | 'drive';
type Idle = 'stretch' | 'scratch' | 'watch' | 'lean';

const ACTION_TIME: Record<Action, number> = { wave: 2.2, photo: 1.6, shake: 1.1, talk: 3.2, sit: Infinity, drive: Infinity };
const IDLE_TIME: Record<Idle, number> = { stretch: 2.6, scratch: 1.8, watch: 1.6, lean: 4 };
const TAU = Math.PI * 2;
const HIP_HEIGHT = 0.88;

/** Joint channels. Each one is driven by its own spring, so motion overshoots and settles. */
const KEYS = [
  'thighL', 'kneeL', 'ankleL', 'thighR', 'kneeR', 'ankleR',
  'shoulderLX', 'shoulderLZ', 'elbowL', 'shoulderRX', 'shoulderRZ', 'elbowR', 'forearmRZ',
  'hipY', 'hipYaw', 'hipRoll', 'spinePitch', 'spineYaw', 'spineRoll', 'headNod', 'headTilt', 'shrugL', 'shrugR',
] as const;
type Key = (typeof KEYS)[number];
type Pose = Record<Key, number>;

/** Spring stiffness and damping ratio per group: legs precise, arms loose, body in between. */
function springOf(k: Key): [number, number] {
  if (k.startsWith('thigh') || k.startsWith('knee') || k.startsWith('ankle') || k === 'hipY') return [520, 0.95];
  if (k.startsWith('shoulder') || k.startsWith('elbow') || k === 'forearmRZ' || k.startsWith('shrug')) return [150, 0.62];
  return [190, 0.75];
}

function rest(): Pose {
  const p = {} as Pose;
  for (const k of KEYS) p[k] = 0;
  p.hipY = HIP_HEIGHT;
  return p;
}

const _local = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Smooth-shaded mesh helper. */
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

/**
 * Character (faces +Z) animated entirely in code. Every joint is a damped spring chasing a
 * target pose, which gives follow-through and settle instead of robotic snapping. The walk
 * cycle has heel-strike / toe-off, lagging elbows, counter-rotating hips and shoulders and a
 * stabilised head; the body leans into turns and accelerations; hair, ponytail and robe swing
 * behind; idle characters breathe, shift their weight and do small random gestures.
 */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly height: number;
  /** Called on every footfall (for footstep sounds). */
  onStep: (() => void) | null = null;
  private readonly hips = new THREE.Group();
  private readonly spine = new THREE.Group();
  private readonly neck = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly hipL = new THREE.Group();
  private readonly hipR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly ankleL = new THREE.Group();
  private readonly ankleR = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly tail: THREE.Group | null = null;
  private readonly robe: THREE.Object3D | null = null;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly prop: THREE.Object3D | null = null;
  private readonly propRest = new THREE.Vector3();

  private phase = Math.random() * TAU;
  private time = Math.random() * 10;
  private blinkTimer = 2 + Math.random() * 3;
  private readonly pose = rest();
  private readonly vel = rest();
  private readonly target = rest();
  private action: Action | null = null;
  private actionTime = 0;
  private actionWeight = 0;
  private lastAction: Action = 'wave';
  private idle: Idle | null = null;
  private idleTime = 0;
  private idleTimer = 4 + Math.random() * 6;
  private idleWeight = 0;
  private airborne = false;
  private landing = 0;
  private headYaw = 0;
  private headPitch = 0;
  private lookTarget: THREE.Vector3 | null = null;
  private readonly idleLook = new THREE.Vector2();
  private idleLookTimer = 0;
  private lastSpeed = 0;
  private accel = 0;
  private turn = 0;
  private readonly lastFwd = new THREE.Vector3(0, 0, 1);
  private tailX = 0.4;
  private tailZ = 0;
  private tailVX = 0;
  private tailVZ = 0;
  private walkAmount = 0;

  constructor(outfit: Outfit) {
    this.height = outfit.height ?? 1;
    this.root.add(this.hips);
    this.hips.scale.setScalar(this.height);
    this.hips.position.y = HIP_HEIGHT * this.height;

    // Rounder body parts at higher quality.
    const S = q(0.65, 1, 1.35, 1.8);
    const seg = (n: number) => Math.max(4, Math.round(n * S));
    const mats = new Map<string, THREE.Material>();
    const mat = (c: string) => {
      let m = mats.get(c);
      if (!m) mats.set(c, (m = envMaterial({ color: c })));
      return m;
    };
    const add = (geo: THREE.BufferGeometry, c: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = mesh(geo, mat(c));
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    // Rounded limb segment hanging down from its pivot.
    const limb = (r0: number, r1: number, len: number, c: string, parent: THREE.Object3D) => {
      const g = new THREE.CylinderGeometry(r0, r1, len, seg(9), 1).translate(0, -len / 2, 0);
      add(g, c, parent);
      add(new THREE.SphereGeometry(r0, seg(9), seg(6)), c, parent);
    };
    const legColor = outfit.pants;

    // Legs: hip → thigh → knee → shin → ankle → foot.
    for (const [hip, knee, ankle, x] of [
      [this.hipL, this.kneeL, this.ankleL, -0.11],
      [this.hipR, this.kneeR, this.ankleR, 0.11],
    ] as const) {
      hip.position.set(x, 0, 0);
      this.hips.add(hip);
      limb(0.1, 0.085, 0.44, legColor, hip);
      knee.position.y = -0.42;
      hip.add(knee);
      limb(0.083, 0.065, 0.4, legColor, knee);
      ankle.position.y = -0.4;
      knee.add(ankle);
      const shoe = add(new THREE.SphereGeometry(0.09, seg(9), seg(6)), outfit.shoes, ankle, 0, -0.03, 0.05);
      shoe.scale.set(0.95, 0.6, 1.55);
    }
    add(new THREE.SphereGeometry(0.21, seg(10), seg(6)).scale(1, 0.75, 0.68), outfit.pants, this.hips, 0, 0.02, 0);

    // Torso: rounded, tapered, slightly flattened front to back.
    this.spine.position.y = 0.06;
    this.hips.add(this.spine);
    add(new THREE.CylinderGeometry(0.24, 0.19, 0.46, seg(10)).scale(1, 1, 0.66), outfit.shirt, this.spine, 0, 0.25);
    add(new THREE.SphereGeometry(0.245, seg(10), seg(6), 0, TAU, 0, Math.PI / 2).scale(1, 0.4, 0.66), outfit.shirt, this.spine, 0, 0.48);
    add(new THREE.CylinderGeometry(0.065, 0.075, 0.12, seg(8)), outfit.skin, this.spine, 0, 0.56);

    if (outfit.robe) {
      // Kimono: a flared skirt that sways with the legs, and an obi sash.
      const robe = add(new THREE.CylinderGeometry(0.22, 0.34, 0.78, seg(12), 1, true).translate(0, -0.39, 0).scale(1, 1, 0.8), outfit.robe.color, this.hips, 0, 0.06);
      (robe.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
      this.robe = robe;
      add(new THREE.CylinderGeometry(0.235, 0.235, 0.14, seg(12)).scale(1, 1, 0.7), outfit.robe.obi, this.spine, 0, 0.08);
      add(new THREE.CylinderGeometry(0.243, 0.2, 0.46, seg(10)).scale(1, 1, 0.68), outfit.robe.color, this.spine, 0, 0.25);
    }

    // Arms: shoulder → upper arm → elbow → forearm + hand.
    const sleeve = outfit.robe ? outfit.robe.color : outfit.shirt;
    for (const [shoulder, elbow, x] of [
      [this.shoulderL, this.elbowL, -0.27],
      [this.shoulderR, this.elbowR, 0.27],
    ] as const) {
      shoulder.position.set(x, 0.45, 0);
      this.spine.add(shoulder);
      limb(0.072, 0.062, 0.3, sleeve, shoulder);
      elbow.position.y = -0.29;
      shoulder.add(elbow);
      limb(0.06, 0.05, 0.25, outfit.robe ? sleeve : outfit.skin, elbow);
      add(new THREE.SphereGeometry(0.058, seg(8), seg(6)).scale(0.85, 1.1, 0.7), outfit.skin, elbow, 0, -0.29, 0);
    }

    // Head: round, with eyes, a little nose and hair.
    this.neck.position.y = 0.56;
    this.spine.add(this.neck);
    this.neck.add(this.head);
    add(new THREE.SphereGeometry(0.235, seg(14), seg(10)).scale(1, 1.04, 1), outfit.skin, this.head, 0, 0.22);
    add(new THREE.SphereGeometry(0.03, seg(6), seg(4)), outfit.skin, this.head, 0, 0.19, 0.235);
    for (const x of [-0.24, 0.24]) add(new THREE.SphereGeometry(0.045, seg(6), seg(4)).scale(0.5, 1, 0.8), outfit.skin, this.head, x, 0.21, 0);
    for (const x of [-0.08, 0.08]) {
      const eye = add(new THREE.SphereGeometry(0.03, seg(8), seg(6)).scale(0.85, 1.25, 0.5), '#24262d', this.head, x, 0.235, 0.215);
      eye.castShadow = false;
      this.eyes.push(eye);
    }
    const style = outfit.hairStyle ?? 'short';
    if (style !== 'bald') {
      add(new THREE.SphereGeometry(0.25, seg(14), seg(8), 0, TAU, 0, Math.PI * 0.55).scale(1.02, 0.95, 1.04), outfit.hair, this.head, 0, 0.24, -0.015);
      add(new THREE.SphereGeometry(0.2, seg(10), seg(6)).scale(1.15, 0.9, 0.8), outfit.hair, this.head, 0, 0.27, -0.09);
    }
    if (style === 'bun') add(new THREE.SphereGeometry(0.1, seg(10), seg(8)), outfit.hair, this.head, 0, 0.47, -0.13);
    if (style === 'ponytail') {
      const tail = new THREE.Group();
      tail.position.set(0, 0.36, -0.2);
      this.head.add(tail);
      add(new THREE.SphereGeometry(0.06, seg(8), seg(6)), outfit.hair, tail);
      add(new THREE.CylinderGeometry(0.06, 0.02, 0.32, seg(8)).translate(0, -0.16, 0), outfit.hair, tail);
      this.tail = tail;
    }
    if (outfit.hat?.type === 'straw') {
      add(new THREE.ConeGeometry(0.5, 0.24, seg(16)), outfit.hat.color, this.head, 0, 0.47);
    } else if (outfit.hat?.type === 'cap') {
      add(new THREE.SphereGeometry(0.255, seg(12), seg(6), 0, TAU, 0, Math.PI / 2), outfit.hat.color, this.head, 0, 0.3);
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.02, seg(12), 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.3), outfit.hat.color, this.head, 0, 0.31, 0.2);
    }

    // Accessories.
    if (outfit.accessory === 'camera') {
      const cam = new THREE.Group();
      add(new THREE.BoxGeometry(0.2, 0.13, 0.09), '#2a2f38', cam);
      add(new THREE.CylinderGeometry(0.04, 0.045, 0.06, seg(10)).rotateX(Math.PI / 2), '#4b5563', cam, 0, 0, 0.07);
      cam.position.set(0, 0.18, 0.17);
      this.spine.add(cam);
      this.prop = cam;
      this.propRest.copy(cam.position);
    } else if (outfit.accessory === 'bag') {
      add(new THREE.BoxGeometry(0.12, 0.28, 0.3), '#8a5a3c', this.spine, 0.28, 0.05, 0);
    } else if (outfit.accessory === 'basket') {
      add(new THREE.CylinderGeometry(0.2, 0.15, 0.32, seg(10)), '#b48a52', this.spine, 0, 0.3, -0.24);
    } else if (outfit.accessory === 'rod') {
      const rod = add(new THREE.CylinderGeometry(0.012, 0.018, 2.2, seg(5)), '#5b4636', this.elbowR, 0, -0.2, 0.9);
      rod.rotation.x = 1.1;
    }
  }

  /** Hides the head (first-person view) so the camera isn't inside it. */
  setFirstPerson(on: boolean): void {
    this.head.visible = !on;
  }

  /** Point (world space) the head should turn to, or null to look around idly. */
  lookAt(target: THREE.Vector3 | null): void {
    this.lookTarget = target;
  }

  play(action: Action): void {
    this.action = action;
    this.lastAction = action;
    this.actionTime = 0;
    this.idle = null;
  }

  stop(): void {
    this.action = null;
  }

  get currentAction(): Action | null {
    return this.action;
  }

  setAirborne(airborne: boolean, impact = 0): void {
    if (this.airborne && !airborne) {
      this.landing = Math.min(1, impact / 8);
      this.onStep?.();
    }
    this.airborne = airborne;
  }

  /** `speed` in world units / second. Root transform must already be up to date. */
  animate(dt: number, speed: number): void {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const t = this.time;
    const p = this.target;
    this.measureMotion(dt, speed);
    const walk = Math.min(speed / 3.6, 1);
    this.walkAmount = walk;
    const run = THREE.MathUtils.clamp((speed - 4.2) / 3, 0, 1);

    // --- locomotion: stride grows with speed, two steps per cycle
    const stride = THREE.MathUtils.lerp(1.25, 2.3, run) * this.height;
    if (speed > 0.05) {
      const before = Math.floor(this.phase / Math.PI);
      this.phase = (this.phase + (TAU * speed * dt) / stride) % TAU;
      if (Math.floor(this.phase / Math.PI) !== before && speed > 0.4 && !this.airborne) this.onStep?.();
    }
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const thighAmp = THREE.MathUtils.lerp(0.48, 0.9, run) * walk;
    const kneeAmp = THREE.MathUtils.lerp(0.9, 1.6, run) * walk;
    p.thighL = s * thighAmp;
    p.thighR = -s * thighAmp;
    p.kneeL = Math.max(0, c) * kneeAmp + 0.08 * walk;
    p.kneeR = Math.max(0, -c) * kneeAmp + 0.08 * walk;
    // Heel strike (toes up) as the leg lands in front, toe-off (toes down) as it leaves behind.
    p.ankleL = (-Math.max(0, s) * 0.35 + Math.max(0, -s) * Math.max(0, -c) * 0.6) * walk;
    p.ankleR = (-Math.max(0, -s) * 0.35 + Math.max(0, s) * Math.max(0, c) * 0.6) * walk;
    // Arms swing opposite to the legs; elbows trail behind the shoulders.
    const armAmp = THREE.MathUtils.lerp(0.45, 0.9, run) * walk;
    const lag = Math.sin(this.phase - 0.5);
    p.shoulderLX = s * armAmp;
    p.shoulderRX = -s * armAmp;
    p.shoulderLZ = -0.1 - 0.05 * walk;
    p.shoulderRZ = 0.1 + 0.05 * walk;
    p.elbowL = 0.2 + (0.15 + 1.0 * run) * walk + Math.max(0, -lag) * 0.45 * walk;
    p.elbowR = 0.2 + (0.15 + 1.0 * run) * walk + Math.max(0, lag) * 0.45 * walk;
    p.forearmRZ = 0;
    p.shrugL = Math.max(0, -s) * 0.04 * walk;
    p.shrugR = Math.max(0, s) * 0.04 * walk;
    // Body: bob, sway, counter-twist; lean into turns and accelerations.
    p.hipY = HIP_HEIGHT + (0.5 + 0.5 * Math.cos(2 * this.phase)) * (0.04 + 0.05 * run) * walk - 0.025 * walk;
    p.hipYaw = s * 0.14 * walk;
    p.hipRoll = s * 0.05 * walk;
    p.spineYaw = -s * 0.22 * walk;
    p.spinePitch = 0.05 * walk + 0.22 * run + THREE.MathUtils.clamp(this.accel * 0.04, -0.15, 0.2);
    p.spineRoll = THREE.MathUtils.clamp(-this.turn * speed * 0.035, -0.3, 0.3);
    // The head stays level: undo some of the body bob and roll.
    p.headNod = -Math.cos(2 * this.phase) * 0.03 * walk;
    p.headTilt = -p.spineRoll * 0.6 - p.hipRoll * 0.5;

    // --- idle: breathing, weight on one leg, and now and then a gesture
    const idle = 1 - walk;
    const breathe = Math.sin(t * 1.6);
    p.spinePitch += breathe * 0.02 * idle;
    p.shrugL += (breathe * 0.02 + 0.01) * idle;
    p.shrugR += (breathe * 0.02 + 0.01) * idle;
    const shift = Math.sin(t * 0.35);
    p.hipRoll += shift * 0.04 * idle;
    p.hipY -= Math.abs(shift) * 0.015 * idle;
    p.kneeL += Math.max(0, shift) * 0.18 * idle;
    p.kneeR += Math.max(0, -shift) * 0.18 * idle;
    p.thighL += Math.max(0, shift) * 0.06 * idle;
    p.thighR += Math.max(0, -shift) * 0.06 * idle;
    p.elbowL += 0.12 * idle;
    p.elbowR += 0.12 * idle;

    if (this.airborne) {
      p.thighL = 0.8;
      p.kneeL = 1.25;
      p.thighR = 0.25;
      p.kneeR = 0.65;
      p.ankleL = p.ankleR = 0.4;
      p.shoulderLX = p.shoulderRX = -0.7;
      p.shoulderLZ = -0.6;
      p.shoulderRZ = 0.6;
      p.elbowL = p.elbowR = 0.7;
    }
    if (this.landing > 0) {
      p.hipY -= 0.16 * this.landing;
      p.kneeL += 0.8 * this.landing;
      p.kneeR += 0.8 * this.landing;
      p.thighL += 0.4 * this.landing;
      p.thighR += 0.4 * this.landing;
      p.spinePitch += 0.25 * this.landing;
      this.landing = Math.max(0, this.landing - dt * 3.2);
    }

    this.applyIdleGesture(dt, idle);
    this.applyAction(dt);
    this.integrate(dt);
    this.applyPose();
    this.updateHead(dt);
    this.updateSecondary(dt);
    this.updateBlink(dt);
  }

  /** Acceleration and turn rate from the root transform (for leaning). */
  private measureMotion(dt: number, speed: number): void {
    const a = (speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = speed;
    this.accel = THREE.MathUtils.damp(this.accel, THREE.MathUtils.clamp(a, -12, 12), 6, dt);
    _fwd.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    _up.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    const cross = _local.crossVectors(this.lastFwd, _fwd).dot(_up);
    const rate = Math.asin(THREE.MathUtils.clamp(cross, -1, 1)) / Math.max(dt, 1e-3);
    this.turn = THREE.MathUtils.damp(this.turn, THREE.MathUtils.clamp(rate, -6, 6), 8, dt);
    this.lastFwd.copy(_fwd);
  }

  /** Small random things people do while standing still. */
  private applyIdleGesture(dt: number, idle: number): void {
    if (idle < 0.9 || this.action) {
      this.idle = null;
      this.idleTimer = Math.max(this.idleTimer, 3);
    } else if (!this.idle) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        const all: Idle[] = ['stretch', 'scratch', 'watch', 'lean'];
        this.idle = all[Math.floor(Math.random() * all.length)];
        this.idleTime = 0;
        this.idleTimer = 6 + Math.random() * 8;
      }
    }
    if (this.idle) {
      this.idleTime += dt;
      if (this.idleTime > IDLE_TIME[this.idle]) this.idle = null;
    }
    this.idleWeight = THREE.MathUtils.damp(this.idleWeight, this.idle ? 1 : 0, 5, dt);
    if (this.idleWeight < 0.01 || !this.idle) return;
    const w = this.idleWeight;
    const p = this.target;
    const t = this.idleTime;
    const mix = (k: Key, v: number) => (p[k] += (v - p[k]) * w);
    switch (this.idle) {
      case 'stretch':
        mix('shoulderLX', -2.6);
        mix('shoulderRX', -2.6);
        mix('shoulderLZ', 0.25);
        mix('shoulderRZ', -0.25);
        mix('elbowL', 0.3);
        mix('elbowR', 0.3);
        mix('spinePitch', -0.18);
        mix('headNod', -0.25);
        break;
      case 'scratch':
        mix('shoulderRX', -1.4);
        mix('shoulderRZ', 1.0);
        mix('elbowR', 2.1 + Math.sin(t * 14) * 0.15);
        mix('headTilt', 0.15);
        mix('headNod', 0.1);
        break;
      case 'watch':
        mix('shoulderLX', -0.9);
        mix('shoulderLZ', 0.5);
        mix('elbowL', 1.7);
        mix('headNod', 0.35);
        break;
      case 'lean':
        mix('hipRoll', 0.09);
        mix('kneeR', 0.35);
        mix('thighR', 0.12);
        mix('spineRoll', -0.06);
        break;
    }
  }

  private applyAction(dt: number): void {
    if (this.action) {
      this.actionTime += dt;
      if (this.actionTime > ACTION_TIME[this.action]) this.action = null;
    }
    this.actionWeight = THREE.MathUtils.damp(this.actionWeight, this.action ? 1 : 0, 8, dt);
    if (this.actionWeight < 0.001) {
      if (this.prop) this.prop.position.copy(this.propRest);
      return;
    }
    const a = this.action ?? this.lastAction;
    const t = this.actionTime;
    const w = this.actionWeight;
    const p = this.target;
    const mix = (k: Key, v: number) => (p[k] += (v - p[k]) * w);
    switch (a) {
      case 'wave':
        mix('shoulderRX', -0.2);
        mix('shoulderRZ', 2.5);
        mix('elbowR', 0.4);
        mix('forearmRZ', Math.sin(t * 11) * 0.5);
        mix('headTilt', 0.12);
        mix('spineRoll', 0.06);
        break;
      case 'photo':
        mix('shoulderLX', -1.25);
        mix('shoulderRX', -1.25);
        mix('shoulderLZ', 0.35);
        mix('shoulderRZ', -0.35);
        mix('elbowL', 1.75);
        mix('elbowR', 1.75);
        mix('headNod', -0.05);
        break;
      case 'shake': {
        const push = Math.sin(t * 15) * 0.2;
        mix('shoulderLX', -1.45 + push);
        mix('shoulderRX', -1.45 + push);
        mix('shoulderLZ', 0.15);
        mix('shoulderRZ', -0.15);
        mix('elbowL', 0.25 - push);
        mix('elbowR', 0.25 - push);
        mix('spinePitch', 0.2);
        mix('thighL', -0.25);
        mix('kneeL', 0.3);
        mix('thighR', 0.3);
        mix('kneeR', 0.15);
        break;
      }
      case 'talk':
        mix('shoulderRX', -0.55 + Math.sin(t * 3.1) * 0.18);
        mix('shoulderRZ', 0.2);
        mix('elbowR', 1.1 + Math.sin(t * 4.3) * 0.3);
        mix('shoulderLX', -0.2 + Math.sin(t * 2.3 + 1) * 0.1);
        mix('headNod', Math.sin(t * 2.6) * 0.08);
        mix('headTilt', Math.sin(t * 1.3) * 0.06);
        break;
      case 'sit':
      case 'drive':
        mix('hipY', 0.47);
        mix('thighL', 1.5);
        mix('thighR', 1.5);
        mix('kneeL', 1.5);
        mix('kneeR', 1.5);
        mix('ankleL', -0.1);
        mix('ankleR', -0.1);
        mix('hipYaw', 0);
        mix('hipRoll', 0);
        mix('spineYaw', 0);
        if (a === 'drive') {
          mix('shoulderLX', -1.05);
          mix('shoulderRX', -1.05);
          mix('shoulderLZ', 0.2);
          mix('shoulderRZ', -0.2);
          mix('elbowL', 0.75);
          mix('elbowR', 0.75);
          mix('spinePitch', 0.08);
        } else {
          mix('shoulderLX', -0.35);
          mix('shoulderRX', -0.35);
          mix('elbowL', 0.7);
          mix('elbowR', 0.7);
          mix('spinePitch', -0.05);
        }
        break;
    }
    if (this.prop) {
      const lift = a === 'photo' ? w : 0;
      this.prop.position.set(0, this.propRest.y + lift * 0.42, this.propRest.z + lift * 0.12);
    }
  }

  /** Every joint chases its target with a damped spring (semi-implicit Euler, 2 substeps). */
  private integrate(dt: number): void {
    const h = dt / 2;
    for (let step = 0; step < 2; step++) {
      for (const k of KEYS) {
        const [stiff, zeta] = springOf(k);
        const damping = 2 * zeta * Math.sqrt(stiff);
        const a = stiff * (this.target[k] - this.pose[k]) - damping * this.vel[k];
        this.vel[k] += a * h;
        this.pose[k] += this.vel[k] * h;
      }
    }
  }

  private applyPose(): void {
    const p = this.pose;
    this.hips.position.y = p.hipY * this.height;
    this.hips.rotation.set(0, p.hipYaw, p.hipRoll);
    this.spine.rotation.set(p.spinePitch, p.spineYaw - p.hipYaw * 0.5, p.spineRoll - p.hipRoll * 0.6);
    this.hipL.rotation.x = -p.thighL;
    this.hipR.rotation.x = -p.thighR;
    this.kneeL.rotation.x = p.kneeL;
    this.kneeR.rotation.x = p.kneeR;
    this.ankleL.rotation.x = p.ankleL;
    this.ankleR.rotation.x = p.ankleR;
    this.shoulderL.rotation.set(p.shoulderLX, 0, p.shoulderLZ);
    this.shoulderR.rotation.set(p.shoulderRX, 0, p.shoulderRZ);
    this.shoulderL.position.y = 0.45 + p.shrugL;
    this.shoulderR.position.y = 0.45 + p.shrugR;
    this.elbowL.rotation.set(-p.elbowL, 0, 0);
    this.elbowR.rotation.set(-p.elbowR, 0, p.forearmRZ);
    if (this.robe) {
      // The robe follows the average leg swing a little and flares when running.
      this.robe.rotation.x = -(p.thighL + p.thighR) * 0.25;
      this.robe.scale.set(1 + this.walkAmount * 0.08, 1, 1 + Math.abs(p.thighL - p.thighR) * 0.25);
    }
  }

  private updateHead(dt: number): void {
    let yaw = 0;
    let pitch = 0;
    if (this.lookTarget) {
      this.root.updateMatrixWorld();
      _local.copy(this.lookTarget);
      this.root.worldToLocal(_local);
      _local.y -= 1.5 * this.height;
      yaw = Math.atan2(_local.x, _local.z);
      pitch = Math.atan2(_local.y, Math.hypot(_local.x, _local.z));
      if (Math.abs(yaw) > 1.9) yaw = pitch = 0; // behind us: don't break the neck
    } else {
      this.idleLookTimer -= dt;
      if (this.idleLookTimer <= 0) {
        this.idleLookTimer = 2.5 + Math.random() * 4;
        this.idleLook.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.4) * 0.4);
      }
      yaw = this.idleLook.x * (1 - Math.min(1, this.actionWeight + this.idleWeight)) * (1 - this.walkAmount * 0.6);
      pitch = this.idleLook.y * (1 - this.walkAmount * 0.6);
    }
    yaw = THREE.MathUtils.clamp(yaw - this.pose.spineYaw, -1.1, 1.1);
    pitch = THREE.MathUtils.clamp(pitch, -0.5, 0.6);
    this.headYaw = THREE.MathUtils.damp(this.headYaw, yaw, 5, dt);
    this.headPitch = THREE.MathUtils.damp(this.headPitch, pitch, 5, dt);
    this.neck.rotation.set(-this.headPitch + this.pose.headNod - this.pose.spinePitch * 0.5, this.headYaw, this.pose.headTilt);
  }

  /** Ponytail: a bouncy spring pushed by the body's bob, sway and acceleration. */
  private updateSecondary(dt: number): void {
    if (!this.tail) return;
    const targetX = 0.35 + this.vel.hipY * 2 + this.accel * 0.05 + this.walkAmount * 0.25;
    const targetZ = -this.vel.hipRoll * 0.8 - this.turn * 0.12;
    const k = 70;
    const c = 2 * 0.25 * Math.sqrt(k);
    this.tailVX += (k * (targetX - this.tailX) - c * this.tailVX) * dt;
    this.tailVZ += (k * (targetZ - this.tailZ) - c * this.tailVZ) * dt;
    this.tailX += this.tailVX * dt;
    this.tailZ += this.tailVZ * dt;
    this.tail.rotation.set(this.tailX, 0, this.tailZ);
  }

  private updateBlink(dt: number): void {
    this.blinkTimer -= dt;
    const closed = this.blinkTimer < 0.12;
    if (this.blinkTimer < 0) this.blinkTimer = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1;
  }
}
