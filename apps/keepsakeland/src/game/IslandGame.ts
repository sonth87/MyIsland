import * as THREE from 'three';
import { MathUtils } from 'three';
import {
  applyPose,
  copyPose,
  createPose,
  damp,
  easeInOutCubic,
  ENV,
  formatHour,
  hourIcon,
  SEASON_ICON,
  SEASON_LABEL,
  PoseTransition,
  SpatialHash,
  type App,
  type CameraPose,
  type SoundScape,
  type StepSurface,
  type System,
} from '@g2/engine';
import { OverviewCamera } from '../camera/OverviewCamera';
import { WalkCamera } from '../camera/WalkCamera';
import type { Environment, FocusState } from '../env/Environment';
import type { PlanetShape } from '../planet/PlanetShape';
import type { PropLayout, TreeInstance } from '../planet/scatter';
import type { Bench } from '../planet/structures';
import type { Character } from '../player/Character';
import type { Settings, ViewMode } from '../settings/Settings';
import type { Hud, HudMode } from '../ui/Hud';
import type { SettingsPanel } from '../ui/SettingsPanel';

export interface IslandWorld {
  shape: PlanetShape;
  ground: THREE.Mesh;
  water: THREE.Mesh;
  layout: PropLayout;
  characters: Character[];
  env: Environment;
  hud: Hud;
  panel: SettingsPanel;
  settings: Settings;
  spawn: THREE.Vector3;
  marker: THREE.Mesh;
  sound: SoundScape;
}

type Interaction =
  | { kind: 'npc'; target: Character }
  | { kind: 'tree'; target: TreeInstance }
  | { kind: 'bench'; target: Bench };

const ZERO = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const ARRIVE_DISTANCE = 0.35;
const WALK_SHADOW_EXTENT = 24;
const VIEW_ORDER: ViewMode[] = ['third', 'first', 'second'];
const VIEW_NAMES: Record<ViewMode, string> = {
  first: 'Góc nhìn thứ nhất',
  second: 'Góc nhìn thứ hai',
  third: 'Góc nhìn thứ ba',
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _screen = new THREE.Vector3();

/**
 * Game flow (intro → fly in → walk ⇄ overview), character control in three camera views,
 * switching between characters, and interactions with people, trees and benches.
 */
export class IslandGame implements System {
  private mode: HudMode = 'intro';
  private afterTransition: HudMode = 'walk';
  private readonly overview: OverviewCamera;
  private readonly walk: WalkCamera;
  private readonly transition = new PoseTransition();
  private readonly pose = createPose();
  private readonly walkPose = createPose();
  private readonly blendFrom = createPose();
  private blendT = 1;
  private readonly axis = new THREE.Vector2();
  private readonly wish = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly trees = new SpatialHash<TreeInstance>(4);
  private clickTarget: THREE.Vector3 | null = null;
  private markerTime = 0;
  private viewOffset = 0;
  private viewOffsetActive = false;
  private player: Character;
  private interaction: Interaction | null = null;
  private photoTimer = -1;
  private readonly focus: FocusState = {
    point: new THREE.Vector3(),
    altitude: 1,
    shadowCenter: new THREE.Vector3(),
    shadowExtent: 50,
  };

  constructor(
    private readonly app: App,
    private readonly w: IslandWorld,
  ) {
    this.player = w.characters[0];
    this.player.possessed = true;
    w.hud.setCharacter(this.player.name);
    for (const t of w.layout.trees) this.trees.insert(t.position, t);
    for (const c of w.characters) c.view.onStep = () => this.onStep(c);

    this.overview = new OverviewCamera(w.shape.radius);
    this.walk = new WalkCamera(w.shape, w.layout.colliders);
    this.overview.lookAtDir(w.spawn.clone().add(new THREE.Vector3(0, 0.5, 0)).normalize(), Y);
    this.overview.pose(this.pose);
    applyPose(app.camera, this.pose);
    w.marker.visible = false;
    app.input.onClick((ndc) => this.onClick(ndc));
    this.setMode('intro');
  }

  /** Ground point the environment is centred on (player, or view center from orbit). */
  get focusPoint(): THREE.Vector3 {
    return this.focus.point;
  }

  /** "Bắt đầu khám phá": fly down to the spawn point. */
  start(): void {
    this.flyTo(this.w.spawn);
  }

  /** Fly back out to the planet view. */
  showOverview(): void {
    if (this.mode !== 'walk') return;
    this.player.view.setFirstPerson(false);
    const up = this.player.controller.up(_up);
    this.overview.lookAtDir(up, this.walk.heading);
    this.transition.start(this.pose, this.overview.pose(createPose()), 1.8);
    this.afterTransition = 'overview';
    this.clickTarget = null;
    this.setMode('flying');
  }

  setView(view: ViewMode): void {
    if (view === this.walk.mode) return;
    copyPose(this.blendFrom, this.pose);
    this.blendT = this.mode === 'walk' ? 0 : 1;
    this.walk.setMode(view, this.player.controller.forward);
    this.w.hud.setView(view);
    this.player.view.setFirstPerson(view === 'first' && this.mode === 'walk');
  }

  /** Take control of another character (the nearest one by default). */
  switchCharacter(target?: Character): void {
    const others = this.w.characters.filter((c) => c !== this.player);
    if (!others.length || this.mode === 'flying' || this.mode === 'intro') return;
    const p = this.player.controller.position;
    const next = target ?? others.sort((a, b) => a.controller.position.distanceTo(p) - b.controller.position.distanceTo(p))[0];
    if (next === this.player) return;

    const prev = this.player;
    prev.possessed = false;
    prev.view.setFirstPerson(false);
    prev.settle();
    next.possessed = true;
    this.player = next;
    this.clickTarget = null;
    this.w.hud.setCharacter(next.name);
    this.w.hud.toast(`Đang điều khiển: ${next.name}`);

    if (this.mode === 'walk') {
      this.walk.reset(next.controller.position, next.controller.forward, next.view.height);
      this.transition.start(this.pose, this.walk.pose(createPose()), 1.3, this.w.shape.radius * 0.15);
      this.afterTransition = 'walk';
      this.setMode('flying');
    }
  }

  fixedUpdate(dt: number): void {
    for (const c of this.w.characters) if (!c.possessed) c.think(dt, this.mode === 'walk' ? this.player : null);

    const player = this.player;
    const c = player.controller;
    if (this.mode !== 'walk') {
      c.step(dt, ZERO, false);
      return;
    }
    const input = this.app.input;
    input.axis(this.axis);
    const moving = this.axis.lengthSq() > 0;
    if (player.seated) {
      if (moving) player.standUp();
      else {
        c.step(dt, ZERO, false);
        return;
      }
    }

    let faceMove = true;
    if (moving) {
      this.clickTarget = null;
      if (this.walk.mode === 'second') {
        // Tank controls facing the camera: A/D turn, W/S walk forwards / backwards.
        const up = c.up(_up);
        c.forward.applyAxisAngle(up, -this.axis.x * 2.6 * dt);
        this.wish.copy(c.forward).multiplyScalar(this.axis.y < 0 ? this.axis.y * 0.6 : this.axis.y);
        faceMove = this.axis.y >= 0;
      } else {
        this.walk.wishDirection(this.axis, this.wish);
        faceMove = this.walk.mode !== 'first';
      }
    } else if (this.clickTarget) {
      const up = c.up(_up);
      const dist = up.angleTo(this.clickTarget) * c.position.length();
      if (dist < ARRIVE_DISTANCE) {
        this.clickTarget = null;
        this.wish.set(0, 0, 0);
      } else {
        this.wish.copy(this.clickTarget).addScaledVector(up, -this.clickTarget.dot(up)).normalize();
        this.wish.multiplyScalar(Math.min(1, dist / 1.2));
      }
    } else {
      this.wish.set(0, 0, 0);
    }

    // In first person the body turns with the view.
    if (this.walk.mode === 'first') c.face(this.walk.heading, dt);
    c.step(dt, this.wish, input.isDown('ShiftLeft') || input.isDown('ShiftRight'), faceMove);
    if (this.clickTarget && c.stuckTime > 0.6) this.clickTarget = null;
  }

  update(dt: number, alpha: number): void {
    const { app, w } = this;
    const input = app.input;
    // Keepsakeland has no separate pan: any drag (incl. right button / two fingers) looks around.
    input.look.add(input.altDrag);
    this.handleKeys();

    // Characters: transforms, animation, where they look.
    for (const c of w.characters) {
      const look = c === this.player ? this.playerLookTarget() : c.interestFor(this.mode === 'walk' ? this.player : null);
      c.sync(dt, alpha, look);
    }

    switch (this.mode) {
      case 'intro':
      case 'overview':
        this.overview.update(dt, input.look, input.zoom, app.height);
        this.overview.pose(this.pose);
        break;
      case 'walk': {
        const c = this.player.controller;
        this.walk.update(dt, this.player.renderPos, c.forward, input.look, input.zoom, Math.min(1, c.speed / 3.6), this.player.view.height);
        this.walk.pose(this.walkPose);
        if (this.blendT < 1) {
          this.blendT = Math.min(1, this.blendT + dt / 0.5);
          lerpPose(this.pose, this.blendFrom, this.walkPose, easeInOutCubic(this.blendT));
        } else {
          copyPose(this.pose, this.walkPose);
        }
        break;
      }
      case 'flying':
        if (this.transition.update(dt, this.pose)) this.setMode(this.afterTransition);
        break;
    }
    applyPose(app.camera, this.pose);

    this.updateViewOffset(dt);
    this.updateEnvironment(dt);
    this.updateInteraction();
    this.updateBubbles();
    this.updatePushers();
    this.updateMarker(dt);
    this.updatePhoto(dt);

    const env = w.env;
    const hour = env.hour();
    const season = w.settings.get().season;
    w.hud.setClock(`${SEASON_ICON[season]} ${SEASON_LABEL[season]} · ${hourIcon(hour)} ${formatHour(hour)} · ${env.weather.describe()} · ${env.weather.describeWind()}`);
    w.panel.tick();
    if (w.settings.get().showFps) w.hud.tickFps(dt);
  }

  private handleKeys(): void {
    const input = this.app.input;
    const { w } = this;
    w.env.fastForward = input.isDown('KeyT');
    if (input.wasPressed('KeyO')) w.panel.toggle();

    if (this.mode !== 'walk') return;
    if (input.wasPressed('Escape') || input.wasPressed('KeyM')) {
      if (w.panel.open) w.panel.toggle(false);
      else this.showOverview();
      return;
    }
    if (input.wasPressed('KeyV')) {
      const next = VIEW_ORDER[(VIEW_ORDER.indexOf(this.walk.mode) + 1) % VIEW_ORDER.length];
      w.settings.set({ view: next });
      w.hud.toast(VIEW_NAMES[next], 1200);
    }
    if (input.wasPressed('Digit1')) w.settings.set({ view: 'first' });
    if (input.wasPressed('Digit2')) w.settings.set({ view: 'second' });
    if (input.wasPressed('Digit3')) w.settings.set({ view: 'third' });
    if (input.wasPressed('Tab')) this.switchCharacter();

    const p = this.player;
    if (input.wasPressed('Space')) {
      if (p.seated) p.standUp();
      else p.controller.jump();
    }
    if (input.wasPressed('KeyQ') && !p.seated) p.view.play('wave');
    if (input.wasPressed('KeyC') && !p.seated) {
      p.view.play('photo');
      this.photoTimer = 0.75;
    }
    if (input.wasPressed('KeyE')) this.interact();
  }

  private interact(): void {
    const it = this.interaction;
    const p = this.player;
    if (!it) return;
    if (it.kind === 'npc') {
      const npc = it.target;
      const line = npc.config.lines[Math.floor(Math.random() * npc.config.lines.length)];
      this.w.hud.say(npc.config.id, line, 4.5);
      npc.view.play('talk');
      p.view.play('talk');
      p.controller.face(_v.subVectors(npc.controller.position, p.controller.position), 1);
    } else if (it.kind === 'tree') {
      const t = it.target;
      ENV.uImpulse.value.set(t.position.x, t.position.y, t.position.z, ENV.uTime.value);
      if (!t.pine) this.w.env.leaves.burst(t, 22);
      p.view.play('shake');
      p.controller.face(_v.subVectors(t.position, p.controller.position), 1);
    } else {
      p.sitOn(it.target.position, it.target.facing);
      this.clickTarget = null;
      this.w.hud.toast('Giữ T để tua nhanh thời gian · Space để đứng dậy', 3200);
    }
  }

  /** Finds the closest thing the controlled character can interact with. */
  private updateInteraction(): void {
    const { hud } = this.w;
    this.interaction = null;
    if (this.mode !== 'walk' || this.player.seated) {
      hud.prompt(null);
      return;
    }
    const pos = this.player.controller.position;
    let best = Infinity;
    let found = null as Interaction | null;
    let anchor = null as THREE.Vector3 | null;
    let text = '';

    for (const c of this.w.characters) {
      if (c === this.player) continue;
      const d = c.controller.position.distanceTo(pos);
      if (d < 2.6 && d < best) {
        best = d;
        found = { kind: 'npc', target: c };
        anchor = c.headPosition(_v).addScaledVector(_up.copy(c.renderPos).normalize(), 0.45);
        text = `Trò chuyện với ${c.name} [E]`;
      }
    }
    if (!found) {
      for (const b of this.w.layout.structures.benches) {
        const d = b.position.distanceTo(pos);
        const taken = this.w.characters.some((c) => c.seated && c.controller.position.distanceTo(b.position) < 0.6);
        if (d < 2.2 && d < best && !taken) {
          best = d;
          found = { kind: 'bench', target: b };
          anchor = _v.copy(b.position).addScaledVector(b.dir, 1.3);
          text = 'Ngồi nghỉ [E]';
        }
      }
    }
    if (!found) {
      this.trees.query(pos, 2.2, (t) => {
        const d = t.position.distanceTo(pos) - 0.32 * t.scale;
        if (d < 1.4 && d < best) {
          best = d;
          found = { kind: 'tree', target: t };
          anchor = _v.copy(t.position).addScaledVector(_up.copy(t.position).normalize(), 1.7 * t.scale);
          text = 'Rung cây [E]';
        }
      });
    }
    this.interaction = found;
    // Don't cover a speech bubble with the prompt.
    if (!found || !anchor || (found.kind === 'npc' && hud.isSpeaking(found.target.config.id))) {
      hud.prompt(null);
      return;
    }
    const s = this.toScreen(anchor);
    hud.prompt(s ? text : null, s?.x, s?.y);
  }

  private playerLookTarget(): THREE.Vector3 | null {
    const it = this.interaction;
    if (it?.kind === 'npc') return it.target.headPosition(new THREE.Vector3());
    if (this.walk.mode === 'third' && this.mode === 'walk' && this.player.controller.speed < 0.2) {
      // Idle: glance where the camera is looking.
      return _v.copy(this.pose.focus).addScaledVector(_v2.subVectors(this.pose.focus, this.pose.position), 3).clone();
    }
    return null;
  }

  private updateBubbles(): void {
    const { hud } = this.w;
    for (const id of hud.bubbleIds()) {
      const c = this.w.characters.find((ch) => ch.config.id === id);
      if (!c) continue;
      const s = this.toScreen(c.headPosition(_v).addScaledVector(_up.copy(c.renderPos).normalize(), 0.35));
      hud.placeBubble(id, s?.x ?? 0, s?.y ?? 0, !!s && this.mode === 'walk');
    }
    // NPCs greet the player when they first come close.
    for (const c of this.w.characters) {
      if (c.greeted) {
        c.greeted = false;
        hud.say(c.config.id, 'Xin chào! 👋', 2.5);
      }
    }
  }

  /** Grass bends around the characters nearest to the camera. */
  private updatePushers(): void {
    const camPos = this.app.camera.position;
    const sorted = [...this.w.characters].sort(
      (a, b) => a.renderPos.distanceToSquared(camPos) - b.renderPos.distanceToSquared(camPos),
    );
    ENV.uPushers.value.forEach((v, i) => {
      const c = sorted[i];
      if (c) v.set(c.renderPos.x, c.renderPos.y, c.renderPos.z, 0.95 * c.view.height);
      else v.set(0, 0, 0, 0);
    });
  }

  /** Footstep sound for whoever stepped, by distance to the player and ground type. */
  private onStep(c: Character): void {
    if (this.mode !== 'walk') return;
    const d = c === this.player ? 0 : c.renderPos.distanceTo(this.player.renderPos);
    if (d > 10) return;
    this.w.sound.footstep(this.stepSurface(c), (1 - d / 10) * (c === this.player ? 1 : 0.6));
  }

  private stepSurface(c: Character): StepSurface {
    if (this.w.env.weather.snowCover > 0.35) return 'snow';
    const dir = _v.copy(c.controller.position).normalize();
    const s = this.w.shape.sample(dir);
    if (s.weights.mountain > 0.3 && s.height - this.w.shape.radius > 6.5) return 'stone';
    if (s.weights.village > 0.6 || s.weights.rice > 0.6) return 'dirt';
    return 'grass';
  }

  private updatePhoto(dt: number): void {
    if (this.photoTimer < 0) return;
    this.photoTimer -= dt;
    if (this.photoTimer < 0) {
      this.w.sound.shutter();
      this.w.hud.flash();
      this.w.hud.toast('📸 Tách! Một khoảnh khắc đã được lưu lại.');
    }
  }

  private updateEnvironment(dt: number): void {
    const { w } = this;
    const R = w.shape.radius;
    const camPos = this.app.camera.position;
    const altitude = MathUtils.smoothstep(camPos.length(), R * 1.3, R * 2.1);
    const walking = this.mode === 'walk' || (this.mode === 'flying' && this.afterTransition === 'walk');
    // Ground point of interest: the player when close, the view center from orbit.
    _v.copy(camPos).normalize().multiplyScalar(R);
    this.focus.point.copy(this.player.renderPos).lerp(_v, altitude);
    this.focus.altitude = altitude;
    if (walking && altitude < 0.6) {
      this.focus.shadowCenter.copy(this.player.renderPos);
      this.focus.shadowExtent = WALK_SHADOW_EXTENT;
    } else {
      this.focus.shadowCenter.set(0, 0, 0);
      this.focus.shadowExtent = R * 1.3;
    }
    w.env.update(dt, this.focus);
  }

  private setMode(mode: HudMode): void {
    this.mode = mode;
    this.w.hud.setMode(mode);
    this.app.input.joystickEnabled = mode === 'walk';
    this.player.view.setFirstPerson(mode === 'walk' && this.walk.mode === 'first');
    if (mode === 'walk') this.blendT = 1;
  }

  private flyTo(dir: THREE.Vector3): void {
    const { shape, hud } = this.w;
    const c = this.player.controller;
    if (shape.isWater(dir, 0.15)) {
      hud.toast('Không thể đáp xuống mặt nước');
      return;
    }
    this.player.standUp();
    // Face "screen up" so the view direction carries over from the overview.
    c.spawn(dir, this.pose.up);
    this.player.settle();
    this.walk.reset(c.position, c.forward, this.player.view.height);
    this.transition.start(this.pose, this.walk.pose(createPose()), 2.2, shape.radius * 0.3);
    this.afterTransition = 'walk';
    this.clickTarget = null;
    this.setMode('flying');
  }

  private onClick(ndc: THREE.Vector2): void {
    if (this.mode === 'flying') return;
    const { ground, water, shape, hud, characters } = this.w;
    this.raycaster.setFromCamera(ndc, this.app.camera);

    if (this.mode === 'walk') {
      // Clicking someone takes control of them.
      const hitChar = this.raycaster.intersectObjects(
        characters.filter((c) => c !== this.player).map((c) => c.view.root),
        true,
      )[0];
      if (hitChar) {
        let o: THREE.Object3D | null = hitChar.object;
        while (o && !o.userData.character) o = o.parent;
        if (o) this.switchCharacter(o.userData.character as Character);
        return;
      }
    }

    const hit = this.raycaster.intersectObjects([ground, water], false)[0];
    if (!hit) return;
    const dir = hit.point.clone().normalize();

    if (this.mode === 'walk') {
      if (hit.object === water || this.player.seated) return;
      this.clickTarget = dir;
      this.markerTime = 0;
      this.w.marker.position.copy(dir).multiplyScalar(shape.heightAt(dir) + 0.06);
      this.w.marker.quaternion.setFromUnitVectors(Y, dir);
      this.w.marker.visible = true;
      return;
    }
    if (hit.object === water) hud.toast('Không thể đáp xuống mặt nước');
    else this.flyTo(dir);
  }

  /** Projects a world point to CSS pixels; null if behind the camera or off-screen. */
  private toScreen(p: THREE.Vector3): { x: number; y: number } | null {
    _screen.copy(p).project(this.app.camera);
    if (_screen.z > 1 || Math.abs(_screen.x) > 1.1 || Math.abs(_screen.y) > 1.1) return null;
    return { x: (_screen.x * 0.5 + 0.5) * this.app.width, y: (-_screen.y * 0.5 + 0.5) * this.app.height };
  }

  /** Shifts the planet right while the intro card covers the left side (desktop only). */
  private updateViewOffset(dt: number): void {
    const { app } = this;
    const target = this.mode === 'intro' && app.width > 820 ? -app.width * 0.14 : 0;
    this.viewOffset = damp(this.viewOffset, target, 4, dt);
    if (Math.abs(this.viewOffset) > 0.5) {
      app.camera.setViewOffset(app.width, app.height, this.viewOffset, 0, app.width, app.height);
      this.viewOffsetActive = true;
    } else if (this.viewOffsetActive) {
      app.camera.clearViewOffset();
      this.viewOffsetActive = false;
    }
  }

  private updateMarker(dt: number): void {
    const m = this.w.marker;
    if (!this.clickTarget) {
      m.visible = false;
      return;
    }
    this.markerTime += dt;
    m.scale.setScalar(1 + Math.sin(this.markerTime * 6) * 0.12);
  }
}

function lerpPose(out: CameraPose, a: CameraPose, b: CameraPose, t: number): void {
  out.position.lerpVectors(a.position, b.position, t);
  out.focus.lerpVectors(a.focus, b.focus, t);
  out.up.lerpVectors(a.up, b.up, t).normalize();
}
