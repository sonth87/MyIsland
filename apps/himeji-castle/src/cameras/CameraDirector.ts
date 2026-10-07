import * as THREE from 'three';
import { MathUtils } from 'three';
import { applyPose, copyPose, createPose, dampFactor, easeInOutCubic, type CameraPose, type Input } from '@g2/engine';
import type { Boat } from '../boat/Boat';
import type { Train } from '../train/Train';
import type { Bridge } from '../world/railMesh';
import { HALF, WATER_Y } from '../world/ValleyGen';

export type CamMode = 'overview' | 'train' | 'driver' | 'passenger' | 'bridges' | 'boat' | 'boatDriver' | 'castle' | 'free';

export const CAM_MODES: Array<{ id: CamMode; label: string; key: string }> = [
  { id: 'overview', label: 'Toàn cảnh', key: '1' },
  { id: 'train', label: 'Tàu', key: '2' },
  { id: 'driver', label: 'Lái tàu', key: '3' },
  { id: 'passenger', label: 'Hành khách', key: '4' },
  { id: 'bridges', label: 'Cầu', key: '5' },
  { id: 'boat', label: 'Cano', key: '6' },
  { id: 'boatDriver', label: 'Lái cano', key: '7' },
  { id: 'castle', label: 'Lâu đài', key: '8' },
  { id: 'free', label: 'Bay tự do', key: '9' },
];

export interface DirectorContext {
  train: Train;
  boat: Boat;
  bridges: Bridge[];
  castle: THREE.Vector3;
  heightAt(x: number, z: number): number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _look2 = new THREE.Vector2();

function lerpPose(out: CameraPose, a: CameraPose, b: CameraPose, t: number): void {
  out.position.lerpVectors(a.position, b.position, t);
  out.focus.lerpVectors(a.focus, b.focus, t);
  out.up.lerpVectors(a.up, b.up, t).normalize();
}

/** All camera views, the input that steers them, and smooth transitions between them. */
export class CameraDirector {
  mode: CamMode = 'overview';
  readonly pose = createPose();
  /** Ground point the environment centres on. */
  readonly focusPoint = new THREE.Vector3();
  shadowExtent = 120;
  bridgeIndex = 0;
  private readonly target = createPose();
  private readonly from = createPose();
  private blend = 1;
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothFocus = new THREE.Vector3();
  private smoothReady = false;
  // overview
  private readonly ovTarget = new THREE.Vector3(0, 8, 0);
  private ovYaw = 0.6;
  private ovPitch = 0.75;
  private ovDist = 230;
  private ovDistTarget = 230;
  /** Smooth "fly to" destination for the overview (double-click, places). */
  private ovGoal: THREE.Vector3 | null = null;
  // free flight
  private readonly freePos = new THREE.Vector3();
  private freeYaw = 0;
  private freePitch = -0.2;
  private freeSpeed = 16;
  // chase orbit / first-person look offsets
  private orbitYaw = 0;
  private orbitPitch = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private castleAngle = 0;
  /** Seconds since the user last dragged or zoomed (the castle view resumes its slow turn after a while). */
  private idle = 99;
  /** Distance multiplier for the chase / orbit views (wheel), and its smoothed value. */
  private orbitZoom = 1;
  private orbitZoomS = 1;
  /** Lens field of view: wheel zooms the first-person views. */
  private fovTarget = 50;
  /** Pending wheel dolly in free flight (world units still to travel). */
  private freeDolly = 0;
  private time = 0;
  /** Which window the passenger looks out of (+1 right, -1 left); picks the open side. */
  private windowSide = 1;
  private windowCheck = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  setMode(mode: CamMode): void {
    if (mode === this.mode) return;
    copyPose(this.from, this.pose);
    this.blend = 0;
    this.mode = mode;
    this.orbitYaw = this.orbitPitch = this.lookYaw = this.lookPitch = 0;
    this.orbitZoom = this.orbitZoomS = 1;
    this.freeDolly = 0;
    this.fovTarget = 50;
    this.smoothReady = false;
    if (mode === 'free') {
      // Take off from wherever the camera is now, looking the same way.
      this.freePos.copy(this.pose.position);
      _v.subVectors(this.pose.focus, this.pose.position).normalize();
      this.freeYaw = Math.atan2(_v.x, _v.z);
      this.freePitch = MathUtils.clamp(Math.asin(_v.y), -1.2, 1.2);
    }
  }

  get firstPerson(): boolean {
    return this.mode === 'driver' || this.mode === 'passenger' || this.mode === 'boatDriver';
  }

  nextBridge(dir: 1 | -1, count: number): void {
    if (count) this.bridgeIndex = (this.bridgeIndex + dir + count) % count;
  }

  /** Points the overview at a world position immediately. */
  lookAt(p: THREE.Vector3): void {
    this.ovTarget.copy(p);
    this.ovGoal = null;
  }

  /** Glides the overview to a world position and zooms in to `distance`. */
  flyTo(p: THREE.Vector3, distance = 70): void {
    this.ovGoal = p.clone();
    this.ovDistTarget = distance;
  }

  update(dt: number, input: Input, ctx: DirectorContext, viewportHeight: number): void {
    this.time += dt;
    const look = input.look;
    const touched = look.lengthSq() > 0 || input.altDrag.lengthSq() > 0 || input.zoom !== 0;
    this.idle = touched ? 0 : this.idle + dt;
    // Wheel / pinch: lens zoom in first person, distance in the orbiting views (overview and
    // free flight handle it themselves).
    if (input.zoom !== 0) {
      if (this.firstPerson) this.fovTarget = MathUtils.clamp(this.fovTarget * Math.exp(input.zoom), 18, 75);
      else if (this.mode !== 'overview' && this.mode !== 'free') this.orbitZoom = MathUtils.clamp(this.orbitZoom * Math.exp(input.zoom), 0.3, 3.2);
    }
    this.orbitZoomS = MathUtils.damp(this.orbitZoomS, this.orbitZoom, 8, dt);
    const fov = MathUtils.damp(this.camera.fov, this.firstPerson ? this.fovTarget : 50, 8, dt);
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const zoom = this.orbitZoomS;
    if (this.firstPerson) {
      this.lookYaw = MathUtils.clamp(this.lookYaw - look.x * 0.004, -2.2, 2.2);
      this.lookPitch = MathUtils.clamp(this.lookPitch - look.y * 0.003, -0.8, 0.7);
      if (look.lengthSq() === 0) {
        this.lookYaw *= Math.exp(-0.4 * dt);
        this.lookPitch *= Math.exp(-0.4 * dt);
      }
    } else if (this.mode !== 'overview' && this.mode !== 'free') {
      look.add(input.altDrag);
      this.orbitYaw -= look.x * 0.005;
      this.orbitPitch = MathUtils.clamp(this.orbitPitch + look.y * 0.003, -0.3, 0.9);
    }

    const t = this.target;
    t.up.copy(UP);
    let smooth = true;
    switch (this.mode) {
      case 'overview':
        this.updateOverview(dt, input, ctx, viewportHeight);
        smooth = false;
        break;
      case 'free':
        this.updateFree(dt, input, ctx);
        smooth = false;
        break;
      case 'train': {
        const loco = ctx.train.cars[0].group;
        _f.set(0, 0, 1).applyQuaternion(loco.quaternion).setY(0).normalize();
        // Behind and off to the side, high enough to see the whole train curve along.
        _v.copy(_f).multiplyScalar(-14).addScaledVector(_pos.set(-_f.z, 0, _f.x), 12).applyAxisAngle(UP, this.orbitYaw).multiplyScalar(zoom);
        t.position.copy(loco.position).add(_v).addScaledVector(UP, (9 + this.orbitPitch * 12) * zoom);
        t.focus.copy(loco.position).addScaledVector(_f, -6).addScaledVector(UP, 2);
        break;
      }
      case 'driver':
      case 'passenger': {
        const car = this.mode === 'driver' ? ctx.train.cars[0].group : ctx.train.cars[3].group;
        // Driver: standing in the open cab. Passenger: right at the window of the second coach.
        if (this.mode === 'passenger') this.pickWindow(dt, car, ctx);
        const ws = this.windowSide;
        const local = this.mode === 'driver' ? _pos.set(0.45, 3.3, -2.6) : _pos.set(1.42 * ws, 2.55, 0.3);
        const dir = this.mode === 'driver' ? _v.set(-0.03, -0.1, 1) : _v.set(ws, -0.02, 0.25);
        dir.applyAxisAngle(UP, this.lookYaw);
        dir.y += this.lookPitch;
        const shake = Math.min(1, ctx.train.speed / 15) * 0.012;
        t.position.copy(local).applyMatrix4(car.matrixWorld);
        t.position.y += Math.sin(this.time * 17) * shake;
        _q.setFromRotationMatrix(car.matrixWorld);
        t.focus.copy(dir.normalize()).applyQuaternion(_q).multiplyScalar(10).add(t.position);
        smooth = false;
        break;
      }
      case 'bridges': {
        const b = ctx.bridges[this.bridgeIndex % Math.max(1, ctx.bridges.length)];
        if (!b) break;
        _v.copy(b.side).setY(0).normalize();
        t.position.copy(b.center).addScaledVector(_v, 30 * zoom);
        t.position.sub(b.center).applyAxisAngle(UP, this.orbitYaw).add(b.center);
        t.position.y = Math.max(WATER_Y + 2.2, ctx.heightAt(t.position.x, t.position.z) + 1.8, b.center.y - 6 + this.orbitPitch * 12);
        const loco = ctx.train.cars[0].group.position;
        t.focus.copy(loco.distanceTo(b.center) < 70 ? loco : b.center);
        break;
      }
      case 'boat': {
        const boat = ctx.boat;
        _f.copy(boat.forward);
        _v.copy(_f).multiplyScalar(-9 * zoom).applyAxisAngle(UP, this.orbitYaw);
        t.position.copy(boat.position).add(_v).addScaledVector(UP, (3.4 + this.orbitPitch * 8) * zoom);
        t.focus.copy(boat.position).addScaledVector(_f, 5).addScaledVector(UP, 0.8);
        break;
      }
      case 'boatDriver': {
        const g = ctx.boat.group;
        t.position.set(0, 1.78, -0.32).applyMatrix4(g.matrixWorld);
        t.position.y += ctx.boat.bump * Math.sin(this.time * 40) * 0.08;
        _v.set(0, -0.08, 1).applyAxisAngle(UP, this.lookYaw);
        _v.y += this.lookPitch;
        _q.setFromRotationMatrix(g.matrixWorld);
        t.focus.copy(_v.normalize()).applyQuaternion(_q).multiplyScalar(10).add(t.position);
        smooth = false;
        break;
      }
      case 'castle': {
        // Drag to walk round it, wheel to come closer; it turns slowly by itself when left alone.
        if (this.idle > 5) this.castleAngle += dt * 0.05 * Math.min(1, (this.idle - 5) / 2);
        const c = ctx.castle;
        const ang = this.castleAngle - this.orbitYaw;
        const dist = 62 * zoom;
        t.position.set(c.x + Math.cos(ang) * dist, c.y + (6 + (this.orbitPitch + 0.35) * 26) * zoom, c.z + Math.sin(ang) * dist);
        t.position.y = Math.max(t.position.y, ctx.heightAt(t.position.x, t.position.z) + 4);
        t.focus.set(c.x, c.y + 10, c.z);
        break;
      }
    }

    // Chase cameras follow with a little lag; attached ones are exact.
    if (smooth) {
      if (!this.smoothReady) {
        this.smoothPos.copy(t.position);
        this.smoothFocus.copy(t.focus);
        this.smoothReady = true;
      }
      this.smoothPos.lerp(t.position, dampFactor(4, dt));
      this.smoothFocus.lerp(t.focus, dampFactor(8, dt));
      t.position.copy(this.smoothPos);
      t.focus.copy(this.smoothFocus);
    }
    // Never below the terrain.
    const minY = ctx.heightAt(t.position.x, t.position.z) + 0.8;
    if (!this.firstPerson && t.position.y < minY) t.position.y = minY;

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 1.1);
      lerpPose(this.pose, this.from, t, easeInOutCubic(this.blend));
    } else {
      copyPose(this.pose, t);
    }
    applyPose(this.camera, this.pose);

    // Where the environment (shadows, rain) should centre.
    if (this.mode === 'free') {
      // Centre effects on the ground a little ahead of the camera.
      _v.subVectors(this.pose.focus, this.pose.position).setY(0).normalize();
      this.focusPoint.copy(this.freePos).addScaledVector(_v, 25);
      this.focusPoint.y = ctx.heightAt(this.focusPoint.x, this.focusPoint.z);
      this.shadowExtent = 70;
    } else if (this.mode === 'overview') {
      this.focusPoint.copy(this.ovTarget);
      this.shadowExtent = MathUtils.clamp(this.ovDist * 0.75, 50, 170);
    } else {
      this.focusPoint.copy(this.pose.focus).lerp(this.pose.position, 0.3);
      this.shadowExtent = 55;
    }
  }

  /** Every few seconds, look out of the side where the ground is lower (the better view). */
  private pickWindow(dt: number, car: THREE.Object3D, ctx: DirectorContext): void {
    this.windowCheck -= dt;
    if (this.windowCheck > 0) return;
    this.windowCheck = this.blend < 1 ? 0 : 6;
    const side = _f.set(1, 0, 0).applyQuaternion(car.quaternion).setY(0).normalize();
    const p = car.position;
    let left = 0;
    let right = 0;
    for (const d of [12, 25, 40]) {
      right += ctx.heightAt(p.x + side.x * d, p.z + side.z * d);
      left += ctx.heightAt(p.x - side.x * d, p.z - side.z * d);
    }
    const want = right <= left ? 1 : -1;
    if (want !== this.windowSide && Math.abs(right - left) > 6) this.windowSide = want;
  }

  /**
   * Map-like overview: left drag grabs the ground and moves the view, right drag / Shift+drag /
   * two fingers (or Q, E) turn it, the wheel zooms, WASD / arrows slide it.
   */
  private updateOverview(dt: number, input: Input, ctx: DirectorContext, viewportHeight: number): void {
    const cam = this.camera;
    // Turn.
    const k = Math.PI / viewportHeight;
    const turn = input.altDrag;
    let keyTurn = 0;
    if (input.isDown('KeyQ')) keyTurn += 1;
    if (input.isDown('KeyE')) keyTurn -= 1;
    this.ovYaw -= turn.x * k - keyTurn * dt * 1.2;
    this.ovPitch = MathUtils.clamp(this.ovPitch + turn.y * k * 0.8, 0.18, 1.4);
    if (input.zoom !== 0) {
      this.ovDistTarget = MathUtils.clamp(this.ovDistTarget * Math.exp(input.zoom), 18, 320);
    }
    this.ovDist = MathUtils.damp(this.ovDist, this.ovDistTarget, 8, dt);

    _f.set(-Math.sin(this.ovYaw), 0, -Math.cos(this.ovYaw));
    _v.set(-_f.z, 0, _f.x);
    // Grab-and-drag: the ground point under the cursor stays under the cursor.
    const drag = input.look;
    if (drag.lengthSq() > 0) {
      const perPx = (2 * this.ovDist * Math.tan(MathUtils.degToRad(cam.fov) / 2)) / viewportHeight;
      this.ovTarget.addScaledVector(_v, -drag.x * perPx);
      this.ovTarget.addScaledVector(_f, (drag.y * perPx) / Math.max(0.35, Math.sin(this.ovPitch)));
      this.ovGoal = null;
    }
    // WASD / arrows slide the view.
    const ax = input.axis(new THREE.Vector2());
    if (ax.lengthSq() > 0) {
      const speed = this.ovDist * 0.9 * dt;
      this.ovTarget.addScaledVector(_f, ax.y * speed).addScaledVector(_v, ax.x * speed);
      this.ovGoal = null;
    }
    if (this.ovGoal) {
      this.ovTarget.x = MathUtils.damp(this.ovTarget.x, this.ovGoal.x, 3, dt);
      this.ovTarget.z = MathUtils.damp(this.ovTarget.z, this.ovGoal.z, 3, dt);
      if (Math.hypot(this.ovTarget.x - this.ovGoal.x, this.ovTarget.z - this.ovGoal.z) < 0.3) this.ovGoal = null;
    }
    this.ovTarget.x = MathUtils.clamp(this.ovTarget.x, -HALF, HALF);
    this.ovTarget.z = MathUtils.clamp(this.ovTarget.z, -HALF, HALF);
    this.ovTarget.y = MathUtils.damp(this.ovTarget.y, Math.max(WATER_Y, ctx.heightAt(this.ovTarget.x, this.ovTarget.z)), 3, dt);
    const t = this.target;
    _focus.copy(this.ovTarget);
    t.position.set(
      _focus.x + Math.sin(this.ovYaw) * Math.cos(this.ovPitch) * this.ovDist,
      _focus.y + Math.sin(this.ovPitch) * this.ovDist,
      _focus.z + Math.cos(this.ovYaw) * Math.cos(this.ovPitch) * this.ovDist,
    );
    // Don't dip into hills when zoomed in low.
    t.position.y = Math.max(t.position.y, ctx.heightAt(t.position.x, t.position.z) + 3);
    t.focus.copy(_focus);
  }

  /**
   * Free flight: drag to look, WASD / arrows to fly, E / Space up, Q / C down, Shift faster,
   * wheel flies forward / back, [ and ] change speed. Stays above the ground and inside the valley.
   */
  private updateFree(dt: number, input: Input, ctx: DirectorContext): void {
    const look = _look2.copy(input.look).add(input.altDrag);
    this.freeYaw -= look.x * 0.0035;
    this.freePitch = MathUtils.clamp(this.freePitch - look.y * 0.003, -1.35, 1.35);
    if (input.wasPressed('BracketRight')) this.freeSpeed = Math.min(80, this.freeSpeed * 1.5);
    if (input.wasPressed('BracketLeft')) this.freeSpeed = Math.max(4, this.freeSpeed / 1.5);
    // Wheel: glide forward (wheel up) or back along the view, a few metres per notch.
    this.freeDolly -= input.zoom * Math.max(25, this.freePos.y - ctx.heightAt(this.freePos.x, this.freePos.z));
    const ax = input.axis(new THREE.Vector2());
    _f.set(Math.sin(this.freeYaw) * Math.cos(this.freePitch), Math.sin(this.freePitch), Math.cos(this.freeYaw) * Math.cos(this.freePitch));
    _v.set(-Math.cos(this.freeYaw), 0, Math.sin(this.freeYaw));
    let vert = 0;
    if (input.isDown('KeyE') || input.isDown('Space')) vert += 1;
    if (input.isDown('KeyQ') || input.isDown('KeyC')) vert -= 1;
    const fast = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 3 : 1;
    const step = this.freeSpeed * fast * dt;
    const dolly = this.freeDolly * (1 - Math.exp(-8 * dt));
    this.freeDolly -= dolly;
    this.freePos.addScaledVector(_f, ax.y * step + dolly).addScaledVector(_v, ax.x * step).addScaledVector(UP, vert * step);
    this.freePos.x = MathUtils.clamp(this.freePos.x, -HALF - 40, HALF + 40);
    this.freePos.z = MathUtils.clamp(this.freePos.z, -HALF - 40, HALF + 40);
    this.freePos.y = MathUtils.clamp(this.freePos.y, Math.max(WATER_Y + 0.8, ctx.heightAt(this.freePos.x, this.freePos.z) + 1.6), 260);
    const t = this.target;
    t.position.copy(this.freePos);
    t.focus.copy(this.freePos).add(_f);
  }
}
