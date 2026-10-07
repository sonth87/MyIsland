import './styles.css';
import * as THREE from 'three';
import { AdaptiveQuality, App, createDebug, detectDevice, createRng, createStylizedPipeline, DEBUG, ENV, setQuality, SoundScape, type Rung } from '@g2/engine';
import { CAST, type CharacterConfig } from './data/characters';
import { SADO } from './data/sado';
import { Environment } from './env/Environment';
import { IslandGame } from './game/IslandGame';
import { Sun } from './game/Sun';
import { Clouds } from './life/Clouds';
import { createWildlife } from './life/wildlife';
import { PALETTE } from './palette';
import { anyTangent, PlanetShape } from './planet/PlanetShape';
import { createPlanetMeshes } from './planet/planetMesh';
import { TerrainBuilder } from './planet/terrainBuilder';
import { buildPropMeshes, layoutProps, spawnDir, type PropMeshes } from './planet/scatter';
import { Character } from './player/Character';
import { DETAIL, pixelRatioCap, shadowMapSize } from './settings/detail';
import { Settings, type DetailLevel } from './settings/Settings';
import { Hud } from './ui/Hud';
import { SettingsPanel } from './ui/SettingsPanel';

const cfg = SADO;
const settings = new Settings();
const device = detectDevice();
/** What the adaptive controller has switched off (not the player's own choices). */
const perf = { shadowsOff: false, outlineOff: false, effectsOff: false };
const initialDetail = DETAIL[settings.get().detail];
const QUALITY = { low: 0, medium: 1, high: 2, ultra: 3 } as const;
setQuality(QUALITY[settings.get().detail]);
ENV.uWaterQuality.value = QUALITY[settings.get().detail] / 3;

const app = new App({
  container: document.getElementById('app')!,
  fov: 45,
  near: 0.1,
  far: 600,
  maxPixelRatio: pixelRatioCap(initialDetail, device.touch),
});
const pipeline = createStylizedPipeline(app, { outline: { color: PALETTE.outline } });

// --- world
const shape = new PlanetShape(cfg);
const { ground, water } = createPlanetMeshes(shape, initialDetail.terrainRes, initialDetail.smoothTerrain);
const layout = layoutProps(shape, cfg, createRng(`${cfg.seed}:props`));
const props: PropMeshes = { solid: new THREE.Group(), soft: new THREE.Group() };
props.solid.name = 'props';
props.soft.name = 'foliage';
buildPropMeshes(layout, initialDetail, props);
const clouds = new Clouds(shape.radius, createRng(`${cfg.seed}:clouds`));
app.scene.add(ground, water, props.solid, props.soft, clouds.mesh);
app.add(clouds);
pipeline.outline.exclude(props.soft);

// --- sun (moon and ambient light are computed in the shaders)
const sun = new Sun('#fff4e2', 2.7);
app.scene.add(sun.light, sun.light.target);

// --- people
function homeDir(c: CharacterConfig, s: PlanetShape, spawn: THREE.Vector3): THREE.Vector3 {
  let dir = spawn.clone();
  if (c.home.zone !== 'spawn') {
    const zones = s.zones.filter((z) => z.type === c.home.zone);
    const zone = zones[c.home.index ?? 0] ?? zones[0];
    if (zone) {
      dir = zone.dir.clone();
      // Lake people stand on the shore: next to the lake's bench if there is one.
      if (zone.type === 'lake') {
        const bench = layout.structures.benches.find((b) => b.dir.angleTo(zone.dir) < zone.radiusRad * 1.5);
        if (bench) dir = bench.dir.clone().multiplyScalar(s.radius).addScaledVector(bench.facing, -1.6).normalize();
      }
    }
  }
  const [ox, oz] = c.home.offset ?? [0, 0];
  const t1 = anyTangent(dir);
  const t2 = dir.clone().cross(t1);
  dir.multiplyScalar(s.radius).addScaledVector(t1, ox).addScaledVector(t2, oz).normalize();
  for (let i = 0; i < 60 && s.isWater(dir, 0.3); i++) dir.addScaledVector(t1, 0.03).normalize();
  return dir;
}

const spawn = spawnDir(shape, cfg);
const characters: Character[] = [];
const rng = createRng(`${cfg.seed}:people`);
for (const c of CAST) {
  const home = homeDir(c, shape, spawn);
  const ch = new Character(c, shape, layout.colliders, () => characters, home, rng);
  if (c.seated) {
    const bench = layout.structures.benches
      .slice()
      .sort((a, b) => a.dir.angleTo(home) - b.dir.angleTo(home))[0];
    if (bench) ch.sitOn(bench.position, bench.facing);
  }
  characters.push(ch);
  app.scene.add(ch.view.root);
}

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.28, 0.42, 28).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
);
app.scene.add(marker);
pipeline.outline.exclude(marker);

// --- sound: unlocked by the first click / key press (browser autoplay rules)
const sound = new SoundScape();
const unlockAudio = () => sound.unlock();
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// --- environment: clock, weather, sky, particles
const env = new Environment(
  app,
  shape,
  settings,
  sun,
  clouds,
  layout.trees.filter((t) => t.species !== 'pine').map((t) => ({ position: t.position, scale: t.scale, tag: t.species })),
  layout.structures.lanterns,
  cfg.seed,
  sound,
);
for (const o of env.noOutline) pipeline.outline.exclude(o);
const wildlife = createWildlife(app, shape, cfg.seed);
for (const o of wildlife.noOutline) pipeline.outline.exclude(o);
env.clock.setHour(settings.get().fixedHour, spawn);

// --- UI
const ui = document.getElementById('ui')!;
const hud = new Hud(ui, cfg, {
  onStart: () => game.start(),
  onOverview: () => game.showOverview(),
  onSettings: () => panel.toggle(),
  onSwitchCharacter: () => game.switchCharacter(),
  onSound: () => settings.set({ muted: !settings.get().muted }),
  hold: (code, down) => app.input.holdKey(code, down),
  tap: (code) => app.input.tapKey(code),
});
const panel = new SettingsPanel(ui, settings, {
  hour: () => env.hour(),
  setHour: (h) => env.clock.setHour(h, game.focusPoint),
  status: () => `${env.weather.describe()} · ${env.weather.describeWind()} · tuyết phủ ${Math.round(env.weather.snowCover * 100)}%`,
});

const game = app.add(
  new IslandGame(app, { shape, ground, water, layout, characters, env, hud, panel, settings, spawn, marker, sound }),
);

// --- settings → systems
let detail: DetailLevel = settings.get().detail;
const terrainBuilder = new TerrainBuilder(cfg);
// Created further down (needs the rungs); the first subscribe call runs before that.
let adaptive: AdaptiveQuality | undefined;
settings.subscribe((s, changed) => {
  if (changed.includes('view')) game.setView(s.view);
  if (changed.includes('outline')) pipeline.outline.enabled = s.outline && !perf.outlineOff;
  if (changed.includes('vegetationOutline')) ENV.uVegetationInk.value = s.vegetationOutline ? 1 : 0;
  if (changed.includes('adaptive') && adaptive) adaptive.enabled = s.adaptive;
  if (changed.includes('showFps')) hud.showFps(s.showFps);
  if (changed.includes('volume')) sound.setVolume(s.volume);
  if (changed.includes('music')) sound.setMusic(s.music);
  if (changed.includes('muted')) {
    sound.setMuted(s.muted);
    hud.setMuted(s.muted);
  }
  if (changed.includes('shadows')) app.renderer.shadowMap.enabled = s.shadows && !perf.shadowsOff;
  if (changed.includes('detail')) {
    const d = DETAIL[s.detail];
    sun.setShadowMapSize(shadowMapSize(d, device.mobile));
    setQuality(QUALITY[s.detail]);
    ENV.uWaterQuality.value = QUALITY[s.detail] / 3;
    env.particleQuality = d.particles * (device.mobile ? 0.7 : 1);
    app.maxPixelRatio = pixelRatioCap(d, device.touch);
    app.resize();
    adaptive?.reset();
    if (s.detail !== detail) {
      detail = s.detail;
      hud.toast('Đang dựng lại thế giới…', 4000);
      const t0 = performance.now();
      // Terrain is built in a worker; props are cheap and swapped in the same frame.
      void terrainBuilder.build(d.terrainRes, d.smoothTerrain).then((geo) => {
        if (!geo) return;
        ground.geometry.dispose();
        ground.geometry = geo;
        buildPropMeshes(layout, d, props);
        wildlife.refreshModels();
        hud.toast(`Độ chi tiết: ${d.label}`);
        if (DEBUG) console.info(`detail ${s.detail}: ${Math.round(performance.now() - t0)} ms (worker)`);
      });
    }
  }
});

// --- automatic quality: shrink the resolution, then switch things off, while the frame rate is poor
const DETAIL_ORDER: DetailLevel[] = ['ultra', 'high', 'medium', 'low'];
const rungs: Rung[] = [
  {
    id: 'shadows',
    label: 'tắt bóng đổ',
    apply: () => {
      perf.shadowsOff = true;
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
    onChange: (rung) => hud.toast(rung ? `Máy hơi chậm: đã ${rung.label} cho mượt hơn` : 'Máy hơi chậm: đã giảm độ phân giải cho mượt hơn', 3200),
  }),
);
adaptive.enabled = settings.get().adaptive;

// iOS only lets audio start from a finished tap, not from the first touch down.
for (const ev of ['pointerup', 'touchend', 'click']) window.addEventListener(ev, () => sound.unlock());
if (device.mobile && matchMedia('(orientation: portrait)').matches) {
  setTimeout(() => hud.toast('📱 Xoay ngang màn hình để chơi thoải mái hơn', 4200), 2500);
}

// --- debug (?debug)
const { gui } = createDebug(app);
if (gui) {
  const o = gui.addFolder('Outline');
  o.add(pipeline.outline.params, 'thickness', 0.5, 3, 0.25);
  o.add(pipeline.outline.params, 'depthThreshold', 0.005, 0.2);
  o.add(pipeline.outline.params, 'normalThreshold', 0.05, 2);
  o.add(pipeline.outline.params, 'strength', 0, 1);
  const l = gui.addFolder('Light');
  l.add(sun.light, 'intensity', 0, 6).name('sun');
  const p = gui.addFolder('Paper');
  p.add(pipeline.paper.uniforms.amount, 'value', 0, 0.15).name('grain');
  p.add(pipeline.paper.uniforms.vignette, 'value', 0, 1).name('vignette');
  gui.add(ENV.uWind, 'value', 0, 1.5).name('wind (live)').listen();
}

app.add({
  update: (dt: number) => wildlife.update(dt, game.focusPoint, env, settings.get().critters && !perf.effectsOff),
});

// Handle for automated checks / console tinkering (debug builds only).
if (DEBUG) Object.assign(window, { isles: { app, settings, env, game, characters } });

app.start();
