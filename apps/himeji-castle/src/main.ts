import './styles.css';
import * as THREE from 'three';
import {
  AdaptiveQuality,
  App,
  createDebug,
  createRng,
  createStylizedPipeline,
  detectDevice,
  Critters,
  DEBUG,
  formatHour,
  hourIcon,
  ACTIVITY,
  Pond,
  SEASON_ICON,
  SEASON_LABEL,
  setEnvWorld,
  setQuality,
  ENV,
  SoundScape,
  type CritterKind,
  type LodInstances,
  type Rung,
  type Surface,
  type System,
} from '@g2/engine';
import { Boat } from './boat/Boat';
import { CAM_MODES, CameraDirector } from './cameras/CameraDirector';
import { DETAIL, pixelRatioCap, QUALITY, shadowMapSize, VIEW, type DetailLevel } from './detail';
import { ValleyEnvironment } from './env/ValleyEnvironment';
import { Birds } from './life/Birds';
import { FlatClouds } from './life/Clouds';
import { LINES, People } from './life/People';
import { PALETTE } from './palette';
import { Settings } from './settings';
import { Train } from './train/Train';
import { Ui } from './ui/Ui';
import { buildRailway } from './world/railMesh';
import { buildPaddies } from './world/paddies';
import { buildVegetation, layoutValley } from './world/scatter';
import { buildTerrain } from './world/terrainMesh';
import { generateValley, gridValue, groveWeight, WATER_Y } from './world/ValleyGen';

// Flat world: "up" is +Y for every environment shader. Must run before any material exists.
setEnvWorld('flat');

const settings = new Settings();
const device = detectDevice();
/** Things the adaptive controller has switched off at run time (not saved as the player's choices). */
const perf = { shadowsOff: false, outlineOff: false, viewScale: 1, effectsOff: false };
const seed = new URLSearchParams(location.search).get('seed') || 'himeji-castle';
const detail0 = DETAIL[settings.get().detail];
// Builders read the global model quality: set it before anything is built.
setQuality(QUALITY[settings.get().detail]);
ENV.uWaterQuality.value = QUALITY[settings.get().detail] / 3;

const app = new App({ container: document.getElementById('app')!, fov: 50, near: 0.3, far: 900, maxPixelRatio: pixelRatioCap(detail0, device.touch) });
const pipeline = createStylizedPipeline(app, { outline: { color: PALETTE.outline } });

// --- world
const t0 = performance.now();
const valley = generateValley(seed);
const { ground, water } = buildTerrain(valley, detail0.terrainSegments);
const railway = buildRailway(valley);
const layout = layoutValley(valley);
const vegetation = new THREE.Group();
const softVegetation = new THREE.Group();
let lods: LodInstances[] = [];
/** Rice fields change with the season (flooded, green, golden, bare): rebuilt on their own. */
let paddies: ReturnType<typeof buildPaddies> | null = null;
let paddySeason = settings.get().season;
function rebuildPaddies(): void {
  if (paddies) {
    for (const l of paddies.lods) {
      lods.splice(lods.indexOf(l), 1);
      l.dispose();
    }
    paddies.group.removeFromParent();
    paddies.rice.removeFromParent();
    paddies.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  paddySeason = settings.get().season;
  paddies = buildPaddies(valley, DETAIL[settings.get().detail].grass, paddySeason);
  lods.push(...paddies.lods);
  vegetation.add(paddies.group);
  softVegetation.add(paddies.rice);
}
function rebuildVegetation(): void {
  for (const l of lods) l.dispose();
  lods = [];
  paddies = null;
  vegetation.clear();
  softVegetation.clear();
  const d = DETAIL[settings.get().detail];
  const built = buildVegetation(valley, layout, { grass: d.grass, treeNear: d.treeNear });
  lods = built.lods;
  vegetation.add(built.solid);
  softVegetation.add(built.soft);
  rebuildPaddies();
}
rebuildVegetation();
if (DEBUG) console.info(`valley "${seed}" built in ${Math.round(performance.now() - t0)} ms`);
app.scene.add(ground, water, railway.group, layout.structures, vegetation, softVegetation);
pipeline.outline.exclude(softVegetation);

const surface: Surface = {
  up: (_p, out) => out.set(0, 1, 0),
  ground: (p, out) => out.set(p.x, Math.max(valley.heightAt(p.x, p.z), WATER_Y), p.z),
  isWater: (p) => valley.heightAt(p.x, p.z) < WATER_Y,
};

// --- sound (unlocked by the first click / key press)
const sound = new SoundScape();
const unlockAudio = () => sound.unlock();
// iOS only lets audio start from a finished tap (touchend / click), not from the first touch down.
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlockAudio);
// Clicking the 3D view takes keyboard focus away from any panel control.
app.renderer.domElement.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur?.());

// --- moving things and life
const train = new Train(valley.rail, valley.station.index, sound);
const fbIndex = valley.river.index.nearest(valley.footbridge.center.x, valley.footbridge.center.z, 50).index;
const boat = new Boat(valley.river, Math.min(valley.river.xs.length - 10, Math.max(10, fbIndex + 14)), sound);
const rng = createRng(`${seed}:life`);
const perches = layout.trees
  .filter((t) => t.species !== 'pine' && t.species !== 'bamboo')
  .filter((t) => t.position.distanceTo(valley.village) < 140 || t.position.distanceTo(valley.castle) < 120)
  .map((t) => t.top.clone().setY(t.top.y - 0.25));
const birds = new Birds(valley.heightAt, perches, rng);
let people = new People(layout, valley.heightAt, rng);
const clouds = new FlatClouds(rng);
const critterRng = createRng(`${seed}:critters`);
const critters = new Critters(
  surface,
  (kind: CritterKind, center, radius, r) => {
    for (let i = 0; i < 12; i++) {
      const x = center.x + (r() - 0.5) * 2 * radius;
      const z = center.z + (r() - 0.5) * 2 * radius;
      const y = valley.heightAt(x, z);
      const nearWater = gridValue(valley.riverDist, x, z) < 22;
      if (kind === 'dragonfly' ? !(nearWater || valley.isPaddy(x, z)) : y < WATER_Y + 0.5 && kind !== 'swallow') continue;
      if (kind === 'butterfly' && gridValue(valley.railDist, x, z) < 4) continue;
      return new THREE.Vector3(x, Math.max(y, WATER_Y), z);
    }
    return null;
  },
  critterRng,
);
const pond = new Pond(
  surface,
  layout.pads,
  (center, radius, r) => {
    for (let i = 0; i < 20; i++) {
      const x = center.x + (r() - 0.5) * 2 * radius;
      const z = center.z + (r() - 0.5) * 2 * radius;
      if (valley.heightAt(x, z) < WATER_Y - 0.8) return new THREE.Vector3(x, WATER_Y, z);
    }
    return null;
  },
  createRng(`${seed}:fish`),
);
app.scene.add(train.group, boat.group, boat.wake, birds.group, people.group, clouds.mesh, critters.group, pond.group);
pipeline.outline.exclude(boat.wake);
pipeline.outline.exclude(critters.group);
for (const o of pond.noOutline) pipeline.outline.exclude(o);

// --- environment
const env = new ValleyEnvironment(
  app,
  valley,
  settings.get().season,
  layout.trees
    .filter((t) => t.species === 'sakura' || t.species === 'broadleaf' || t.species === 'maple')
    .map((t) => ({ position: t.position, scale: t.scale, tag: t.species })),
  layout.lanterns,
  clouds,
  sound,
);
for (const o of env.noOutline) pipeline.outline.exclude(o);
env.setHour(settings.get().fixedHour);

env.precipitation.setQuality(device.mobile ? 0.5 : 1);

const director = new CameraDirector(app.camera);
const CAM_ORDER = CAM_MODES.map((c) => c.id);
const ui = new Ui(document.getElementById('ui')!, settings, {
  hold: (code, down) => app.input.holdKey(code, down),
  tap: (code) => app.input.tapKey(code),
  cycleCamera: () => settings.set({ camera: CAM_ORDER[(CAM_ORDER.indexOf(settings.get().camera) + 1) % CAM_ORDER.length] }),
  hour: () => env.hour(),
  setHour: (h) => env.setHour(h),
  status: () =>
    `${env.weather.describe()} · ${env.weather.describeWind()} · tàu ${Math.round(train.kmh)} km/h · cano ${Math.round(boat.kmh)} km/h · ${app.renderer.info.render.calls} draw calls`,
  whistle: () => train.whistle(),
  newSeed: (s) => {
    const url = new URL(location.href);
    if (s) url.searchParams.set('seed', s);
    else url.searchParams.delete('seed');
    location.href = url.toString();
  },
  seed,
  places: [
    ['🏯 Lâu đài', () => valley.castle, 95],
    ['🌸 Công viên hoa', () => valley.groves[1].center, 70],
    ['🏘 Làng', () => valley.village, 80],
    ['🚉 Nhà ga', () => layout.stationCenter, 60],
    ['🌉 Cầu gỗ', () => valley.footbridge.center, 55],
    ['🌾 Ruộng lúa', () => valley.paddy, 70],
  ].map(([label, at, dist]) => ({
    label: label as string,
    go: () => {
      settings.set({ camera: 'overview' });
      director.flyTo((at as () => THREE.Vector3)(), dist as number);
    },
  })),
});

const _head = new THREE.Vector3();
const _screen = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

/** Input → camera / train / boat, LOD, and the little bits of village life. */
class ValleyGame implements System {
  private time = 0;
  private nextLine = 4;
  private readonly axis = new THREE.Vector2();

  update(dt: number): void {
    this.time += dt;
    const input = app.input;
    const s = settings.get();
    const mode = director.mode;

    CAM_MODES.forEach((c) => {
      if (input.wasPressed(`Digit${c.key}`)) settings.set({ camera: c.id });
    });
    if (input.wasPressed('KeyO')) ui.togglePanel();
    if (input.wasPressed('Escape')) {
      if (ui.panelOpen) ui.togglePanel(false);
      else settings.set({ camera: 'overview' });
    }
    if (input.wasPressed('KeyH')) train.whistle();
    if (mode === 'bridges') {
      if (input.wasPressed('ArrowRight')) director.nextBridge(1, railway.bridges.length);
      if (input.wasPressed('ArrowLeft')) director.nextBridge(-1, railway.bridges.length);
    }
    env.fastForward = input.isDown('KeyT');

    // Driving the train (W/S or ↑/↓, Space brakes).
    train.manual = mode === 'driver';
    train.cruise = s.trainSpeed;
    if (train.manual) {
      if (input.isDown('KeyW') || input.isDown('ArrowUp')) train.throttle = Math.min(1, train.throttle + dt * 0.7);
      if (input.isDown('KeyS') || input.isDown('ArrowDown')) train.throttle = Math.max(0, train.throttle - dt * 0.9);
      train.brake = input.isDown('Space') ? 1 : 0;
    } else {
      train.brake = 0;
    }

    // Driving the boat (WASD or arrows).
    const inBoat = mode === 'boat' || mode === 'boatDriver';
    // On a touch screen the virtual stick steers the boat and flies the camera.
    input.joystickEnabled = device.touch && (inBoat || mode === 'free');
    boat.driven = inBoat;
    boat.driver.setFirstPerson(mode === 'boatDriver');
    if (inBoat) {
      input.axis(this.axis);
      boat.throttle = this.axis.y;
      boat.rudder = this.axis.x;
    }

    // Move the vehicles first, then the camera, so attached views never lag a frame behind.
    train.update(dt, env.weather, app.camera.position);
    boat.update(dt, app.camera.position, inBoat ? 1 : 0);
    director.update(dt, input, { train, boat, bridges: railway.bridges, castle: valley.castle, heightAt: valley.heightAt }, app.height);
    const cam = app.camera.position;
    ui.setTunnel(this.inTunnel(dt, cam));
    birds.update(dt, [train.cars[0].group.position, boat.position], env.windVector(), env.season.value(ACTIVITY.birds));
    people.update(dt, director.firstPerson ? cam : director.focusPoint);
    env.update(dt, s, director.focusPoint, director.shadowExtent, cam);
    // Wildlife by season: butterflies and swallows in spring, dragonflies in summer, none in winter.
    const active = env.daylight * (1 - env.weather.rain) * (1 - env.weather.snow);
    critters.group.visible = s.critters && !perf.effectsOff;
    const at = director.mode === 'overview' ? director.focusPoint : cam;
    if (s.critters && !perf.effectsOff) {
      critters.update(dt, at, {
        butterfly: active * env.season.value(ACTIVITY.butterflies),
        dragonfly: active * env.season.value(ACTIVITY.dragonflies),
        swallow: active * env.season.value(ACTIVITY.swallows),
      });
    }
    pond.setSeason(env.season.weights);
    pond.update(dt, at, env.season.value(ACTIVITY.pond) * (1 - env.weather.snowCover));

    // Level of detail: distances grow with height so the overview still shows the whole valley.
    const height = Math.max(0, cam.y - valley.heightAt(cam.x, cam.z));
    const view = (VIEW[s.view].distance + height * 1.1) * perf.viewScale;
    const lodScale = 1 + height / 220;
    for (const l of lods) l.update(cam, view, lodScale);
    env.viewDistance = view;

    this.updateBubbles(dt);
    const hour = env.hour();
    ui.setClock(`${SEASON_ICON[s.season]} ${SEASON_LABEL[s.season]} · ${hourIcon(hour)} ${formatHour(hour)} · ${env.weather.describe()} · ${env.weather.describeWind()}`);
    if (mode === 'driver') ui.setGauge(train.kmh, train.throttle);
    else if (inBoat) ui.setGauge(boat.kmh, Math.abs(boat.throttle));
    ui.soundReady(sound.ready);
    ui.tick(dt);
  }

  private tunnelDark = 0;
  /** 0..1 darkness when the camera rides through a tunnel (fades in and out at the portals). */
  private inTunnel(dt: number, cam: THREE.Vector3): number {
    const q = valley.rail.index.nearest(cam.x, cam.z, 6);
    const inside = q.index >= 0 && valley.rail.tunnel[q.index] === 1 && cam.y < valley.heightAt(cam.x, cam.z) - 1;
    this.tunnelDark = THREE.MathUtils.damp(this.tunnelDark, inside ? 1 : 0, 5, dt);
    return this.tunnelDark;
  }

  /** Every few seconds a villager near the camera says something fitting. */
  private updateBubbles(dt: number): void {
    this.nextLine -= dt;
    const cam = app.camera.position;
    if (this.nextLine <= 0) {
      this.nextLine = 5 + Math.random() * 6;
      const near = people.villagers
        .map((v, i) => ({ i, d: v.pos.distanceTo(cam) }))
        .filter((p) => p.d < 70)
        .sort((a, b) => a.d - b.d);
      if (near.length) {
        const pick = near[Math.floor(Math.random() * Math.min(3, near.length))].i;
        const w = env.weather;
        const trainNear = train.cars[0].group.position.distanceTo(people.villagers[pick].pos) < 60;
        const inGrove = groveWeight(valley, people.villagers[pick].pos.x, people.villagers[pick].pos.z) > 0.3;
        const seasonal = LINES[settings.get().season];
        const pool =
          w.snow > 0.2
            ? LINES.snow
            : w.rain > 0.2
              ? LINES.rain
              : env.daylight < 0.3
                ? LINES.night
                : trainNear && Math.random() < 0.5
                  ? LINES.train
                  : Math.random() < 0.5
                    ? seasonal
                    : inGrove && settings.get().season === 'spring'
                      ? [LINES.day[0], LINES.day[6]]
                      : LINES.day;
        ui.say(pick, pool[Math.floor(Math.random() * pool.length)], 4);
        people.talk(pick);
      }
    }
    for (const id of ui.speaking()) {
      people.head(id, _head);
      _screen.copy(_head).project(app.camera);
      const visible = this.tunnelDark < 0.3 && _screen.z < 1 && Math.abs(_screen.x) < 1.05 && Math.abs(_screen.y) < 1.05 && _head.distanceTo(cam) < 90;
      ui.placeBubble(id, (_screen.x * 0.5 + 0.5) * app.width, (-_screen.y * 0.5 + 0.5) * app.height, visible);
    }
  }
}
app.add(new ValleyGame());

// In the overview: click the train or the boat to follow it, double-click the ground to fly there.
let lastClick = 0;
app.input.onClick((ndc) => {
  if (director.mode !== 'overview') return;
  raycaster.setFromCamera(ndc, app.camera);
  const now = performance.now();
  const double = now - lastClick < 350;
  lastClick = now;
  if (double) {
    const g = raycaster.intersectObjects([ground, water], false)[0];
    if (g) director.flyTo(g.point, 60);
    return;
  }
  const hit = raycaster.intersectObjects([train.group, boat.group], true)[0];
  if (!hit) return;
  let o: THREE.Object3D | null = hit.object;
  while (o && o !== train.group && o !== boat.group) o = o.parent;
  settings.set({ camera: o === boat.group ? 'boat' : 'train' });
});

// --- settings → systems
let builtDetail = settings.get().detail;
// Created further down (needs the rungs); the first subscribe call runs before that.
let adaptive: AdaptiveQuality | undefined;
settings.subscribe((s, changed) => {
  if (changed.includes('camera')) {
    director.setMode(s.camera);
    if (changed.length === 1) ui.toast(CAM_MODES.find((c) => c.id === s.camera)!.label, 1200);
  }
  if (changed.includes('outline')) pipeline.outline.enabled = s.outline && !perf.outlineOff;
  if (changed.includes('vegetationOutline')) ENV.uVegetationInk.value = s.vegetationOutline ? 1 : 0;
  if (changed.includes('shadows')) app.renderer.shadowMap.enabled = s.shadows && !perf.shadowsOff;
  if (changed.includes('adaptive') && adaptive) adaptive.enabled = s.adaptive;
  if (changed.includes('volume')) sound.setVolume(s.volume);
  if (changed.includes('music')) sound.setMusic(s.music);
  if (changed.includes('muted')) sound.setMuted(s.muted);
  if (changed.includes('season') && paddies && s.season !== paddySeason) {
    rebuildPaddies();
    if (changed.length === 1) ui.toast(`${SEASON_ICON[s.season]} Mùa ${SEASON_LABEL[s.season].toLowerCase()}`, 1600);
  }
  if (changed.includes('view')) {
    app.camera.far = VIEW[s.view].distance * 1.6 + 150;
    app.camera.updateProjectionMatrix();
  }
  if (changed.includes('detail')) {
    const d = DETAIL[s.detail];
    app.maxPixelRatio = pixelRatioCap(d, device.touch);
    app.resize();
    adaptive?.reset();
    const sm = shadowMapSize(d, device.mobile);
    env.sun.shadow.mapSize.set(sm, sm);
    env.sun.shadow.map?.dispose();
    env.sun.shadow.map = null;
    if (s.detail !== builtDetail) {
      builtDetail = s.detail;
      ui.toast('Đang dựng lại…', 1500);
      setQuality(QUALITY[s.detail]);
      ENV.uWaterQuality.value = QUALITY[s.detail] / 3;
      setTimeout(() => {
        // Buildings, train, boat and people are rebuilt with more (or less) detail.
        const fresh = layoutValley(valley);
        app.scene.remove(layout.structures);
        layout.structures.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        layout.structures = fresh.structures;
        app.scene.add(layout.structures);
        train.buildCars();
        boat.rebuildModel();
        app.scene.remove(people.group);
        people = new People(layout, valley.heightAt, createRng(`${seed}:life`));
        app.scene.add(people.group);
        ground.geometry.dispose();
        const rebuilt = buildTerrain(valley, d.terrainSegments);
        rebuilt.water.geometry.dispose();
        ground.geometry = rebuilt.ground.geometry;
        rebuildVegetation();
        pond.refreshModel();
        clouds.refreshModel();
        ui.toast(`Độ chi tiết: ${d.label}`);
      }, 30);
    }
  }
});
director.lookAt(valley.village.clone().lerp(valley.castle, 0.35));

// --- automatic quality: shrink the resolution, then switch things off, while the frame rate is poor
const DETAIL_ORDER: DetailLevel[] = ['ultra', 'high', 'medium', 'low'];
const rungs: Rung[] = [
  {
    id: 'shadows',
    label: 'tắt bóng đổ',
    apply: () => {
      perf.shadowsOff = true;
      env.shadowsAllowed = false;
      app.renderer.shadowMap.enabled = false;
    },
  },
  {
    id: 'outline',
    label: 'tắt viền mực',
    apply: () => {
      perf.outlineOff = true;
      pipeline.outline.enabled = false;
    },
  },
  { id: 'view', label: 'giảm tầm nhìn', apply: () => (perf.viewScale = 0.65) },
  {
    id: 'detail',
    label: 'giảm độ chi tiết',
    apply: () => {
      const i = DETAIL_ORDER.indexOf(settings.get().detail);
      if (i < DETAIL_ORDER.length - 1) settings.set({ detail: DETAIL_ORDER[i + 1] });
    },
  },
  {
    id: 'effects',
    label: 'tắt hiệu ứng phụ',
    apply: () => {
      perf.effectsOff = true;
      pipeline.paper.enabled = false;
    },
  },
];
adaptive = app.add(
  new AdaptiveQuality(app, rungs, {
    onChange: (rung) => ui.toast(rung ? `Máy hơi chậm: đã ${rung.label} cho mượt hơn` : 'Máy hơi chậm: đã giảm độ phân giải cho mượt hơn', 3200),
  }),
);
adaptive.enabled = settings.get().adaptive;

// Phones: the first touch also unlocks audio; suggest landscape in portrait.
if (device.mobile && matchMedia('(orientation: portrait)').matches) {
  setTimeout(() => ui.toast('📱 Xoay ngang màn hình để xem rộng hơn', 4200), 2500);
}

const { gui } = createDebug(app);
if (gui) {
  gui.add(pipeline.outline.params, 'thickness', 0.5, 3, 0.25);
  gui.add(train, 'speed', 0, 24).listen();
}
if (DEBUG) Object.assign(window, { valley: { critters, app, settings, env, director, train, boat, birds, valley, railway, layout, people, pond } });

app.start();
