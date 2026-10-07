import * as THREE from 'three';
import { MathUtils } from 'three';
import {
  ACTIVITY,
  createRng,
  ENV,
  Fireflies,
  Leaves,
  Precipitation,
  SEASON_LEAF_STYLE,
  SeasonState,
  Sky,
  SOUND,
  Weather,
  WorldClock,
  type App,
  type LeafSource,
  type Season,
  type SoundScape,
  type Surface,
} from '@g2/engine';
import type { Clouds } from '../life/Clouds';
import { planetSurface, type PlanetShape } from '../planet/PlanetShape';
import type { Lantern } from '../planet/structures';
import type { Settings } from '../settings/Settings';
import type { Sun } from '../game/Sun';

const haloVertex = /* glsl */ `
uniform vec3 uSunDir;
uniform float uScale;
varying float vGlow;
void main() {
  float sh = dot(normalize(position), uSunDir);
  vGlow = 1.0 - smoothstep(-0.05, 0.18, sh);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const haloFragment = /* glsl */ `
uniform vec3 uColor;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.2) * vGlow;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`;

export interface FocusState {
  /** Point on (or above) the ground we care about: the player while walking, the view center from orbit. */
  point: THREE.Vector3;
  /** 0 = on the ground (walking) … 1 = looking at the planet from orbit. */
  altitude: number;
  /** Shadow camera center and half-size. */
  shadowCenter: THREE.Vector3;
  shadowExtent: number;
}

const BASE_SKY_AMBIENT = ENV.uSkyAmbient.value.clone();
const BASE_GROUND_AMBIENT = ENV.uGroundAmbient.value.clone();

/** Day/night, seasons, weather and everything that visibly follows from them. */
export class Environment {
  readonly clock = new WorldClock();
  readonly weather: Weather;
  readonly sky: Sky;
  readonly precipitation: Precipitation;
  readonly leaves: Leaves;
  readonly fireflies: Fireflies;
  readonly season: SeasonState;
  /** Hold to fast-forward time. */
  fastForward = false;
  private readonly fog: THREE.Fog;
  private readonly halos: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly refUp = new THREE.Vector3(0, 1, 0);
  private time = 0;
  private readonly shape: PlanetShape;
  private lastFlash = 0;
  private waterNear = 0;
  private waterCheck = 0;
  private readonly probe = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private styledSeason: Season | null = null;

  constructor(
    private readonly app: App,
    shape: PlanetShape,
    private readonly settings: Settings,
    private readonly sun: Sun,
    private readonly clouds: Clouds,
    /** Deciduous trees (tagged 'sakura' / 'broadleaf' / 'maple'): what sheds petals and leaves. */
    trees: LeafSource[],
    lanterns: Lantern[],
    seed: string,
    private readonly sound: SoundScape,
  ) {
    this.shape = shape;
    const surface: Surface = planetSurface(shape);
    this.season = new SeasonState(settings.get().season);
    this.weather = new Weather(createRng(`${seed}:weather`), surface);
    this.weather.setSeason(settings.get().season);
    this.sky = new Sky(shape.radius);
    this.precipitation = new Precipitation(surface, createRng(`${seed}:rain`));
    this.leaves = new Leaves(surface, trees, createRng(`${seed}:leaves`), { max: 600 });
    this.fireflies = new Fireflies(surface, createRng(`${seed}:fireflies`), 90, 20);
    this.fog = new THREE.Fog('#c4e8dc', 1000, 2000);
    app.scene.fog = this.fog;
    app.scene.background = null;

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanterns.flatMap((l) => l.light.toArray()), 3));
    this.halos = new THREE.Points(
      haloGeo,
      new THREE.ShaderMaterial({
        uniforms: { uSunDir: ENV.uSunDir, uScale: { value: 300 }, uColor: { value: new THREE.Color('#ffbe6a') } },
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.halos.name = 'lantern-halos';

    app.scene.add(this.sky.group, this.precipitation.group, this.leaves.mesh, this.fireflies.points, this.halos);
  }

  /** Objects the outline pass must skip. */
  get noOutline(): THREE.Object3D[] {
    return [...this.sky.noOutline, this.precipitation.group, this.leaves.mesh, this.fireflies.points, this.halos];
  }

  update(dt: number, focus: FocusState): void {
    const s = this.settings.get();
    this.time += dt;
    this.refUp.copy(focus.point).normalize();

    this.clock.mode = s.timeMode;
    this.clock.fixedHour = s.fixedHour;
    this.clock.dayLength = s.dayMinutes * 60;
    this.clock.speed = this.fastForward ? 40 : 1;
    // Fast-forwarding also skips through weather.
    const weatherDt = dt * (this.fastForward ? 8 : 1);
    this.clock.update(dt, focus.point);

    // Seasons: weights glide towards the chosen season; weather, falling leaves and light follow.
    this.season.set(s.season);
    this.season.update(dt);
    this.weather.setSeason(s.season);
    if (this.styledSeason !== s.season) {
      this.styledSeason = s.season;
      this.leaves.setStyle(SEASON_LEAF_STYLE[s.season]);
    }
    const sw = this.season.weights;
    const mood = this.season.current();

    this.weather.update(weatherDt, focus.point, s);
    const w = this.weather;

    ENV.uSunDir.value.copy(this.clock.sunDir);
    ENV.uMoonDir.value.copy(this.clock.moonDir);
    ENV.uTime.value = this.time;
    ENV.uWindAxis.value.copy(w.windAxis);
    ENV.uWind.value = w.gust;
    ENV.uSeasonW.value.copy(sw);
    // Winter keeps a blanket of snow on the ground and a skin of ice on the water.
    ENV.uSnow.value = Math.max(w.snowCover, sw.w * 0.9);
    ENV.uIce.value = Math.max(MathUtils.smoothstep(w.snowCover, 0.35, 0.9) * 0.85, sw.w * 0.6);
    ENV.uSkyAmbient.value.copy(BASE_SKY_AMBIENT).multiply(mood.ambient);
    ENV.uGroundAmbient.value.copy(BASE_GROUND_AMBIENT).multiply(mood.ambient);
    ENV.uWet.value = w.wet;
    ENV.uOvercast.value = w.clouds * 0.75 + w.rain * 0.25;
    ENV.uFlash.value = w.flash * 0.6;

    const camera = this.app.camera;

    this.sun.update(this.clock.sunDir, focus.shadowCenter, focus.shadowExtent);
    this.sun.light.castShadow = s.shadows;
    this.sun.light.color.copy(mood.sun);
    this.sun.light.intensity = mood.sunIntensity;

    const st = this.sky.update({
      camera,
      refUp: this.refUp,
      sunDir: this.clock.sunDir,
      moonDir: this.clock.moonDir,
      overcast: ENV.uOvercast.value,
      altitude: focus.altitude,
      flash: w.flash,
      time: this.time,
      mood: { zenith: mood.zenith, horizon: mood.horizon, amount: mood.skyAmount * (1 - focus.altitude) },
    });

    // Distance fog in the sky's horizon color: thicker in rain and snow, gone from orbit.
    // The water reflects the sky.
    ENV.uSkyTint.value.copy(st.horizon).lerp(st.zenith, 0.35);
    const murk = Math.max(w.rain, w.snow * 1.1);
    const near = MathUtils.lerp(MathUtils.lerp(30, 6, murk), 900, focus.altitude);
    const far = MathUtils.lerp(MathUtils.lerp(150, 60, murk), 1800, focus.altitude);
    this.fog.near = near;
    this.fog.far = far / mood.fog;
    this.fog.color.copy(st.horizon);

    this.clouds.cover = w.clouds;
    this.clouds.wind = w.gust;
    this.clouds.rain = Math.max(w.rain, w.snow * 0.6);
    this.clouds.daylight = Math.max(st.day, st.twilight * 0.6);

    const grounded = focus.altitude < 0.5;
    this.precipitation.setQuality(this.particleQuality);
    this.precipitation.update(dt, focus.point, w, Math.max(st.day, st.twilight * 0.5), grounded);
    this.leaves.enabled = s.leaves;
    this.leaves.update(dt, focus.point, w, grounded);
    // Fireflies on warm summer nights, low over the ground near the player.
    const night = 1 - MathUtils.smoothstep(st.day, 0, 0.35);
    this.fireflies.update(
      dt,
      focus.point,
      night * this.season.value(ACTIVITY.fireflies) * (1 - w.rain) * (1 - w.snow) * (grounded ? 1 : 0),
      (this.app.renderer.getPixelRatio() * this.app.height) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
    );
    this.updateSound(dt, focus.altitude, st.day);
    // Point size so the halo spans ~2.4 world units at any distance.
    const cam = this.app.camera;
    this.halos.material.uniforms.uScale.value =
      (2.4 * this.app.renderer.getPixelRatio() * this.app.height) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  }

  private updateSound(dt: number, altitude: number, day: number): void {
    const w = this.weather;
    const ground = 1 - altitude;
    // How close is water? Probe a ring around the focus point twice a second.
    this.waterCheck -= dt;
    if (this.waterCheck <= 0) {
      this.waterCheck = 0.5;
      const up = this.refUp;
      this.tangent.set(0, 1, 0).cross(up);
      if (this.tangent.lengthSq() < 1e-4) this.tangent.set(1, 0, 0);
      this.tangent.normalize();
      let hits = 0;
      for (let k = 0; k < 8; k++) {
        for (const r of [3, 7]) {
          this.probe.copy(this.tangent).applyAxisAngle(up, (k / 8) * Math.PI * 2).multiplyScalar(r);
          this.probe.addScaledVector(up, this.shape.radius).normalize();
          if (this.shape.isWater(this.probe)) hits += r === 3 ? 2 : 1;
        }
      }
      this.waterNear = Math.min(1, hits / 8);
    }
    this.sound.setAmbience({
      wind: w.gust * (0.4 + 0.6 * ground) + altitude * 0.15,
      rain: Math.max(w.rain, w.snow * 0.15) * (0.3 + 0.7 * ground),
      water: this.waterNear * ground,
      birds: day * (1 - w.rain) * (1 - w.snow * 0.6) * ground * 0.8 * this.season.value(SOUND.birdsong),
      crickets: (1 - day) * (1 - w.rain) * (1 - w.snowCover) * ground * this.season.value(SOUND.crickets),
      cicadas: day * (1 - w.rain) * ground * this.season.value(SOUND.cicadas),
    });
    if (w.flash > 0.9 && this.lastFlash <= 0.9) this.sound.thunder(Math.random());
    this.lastFlash = w.flash;
    this.sound.update(dt);
  }

  /** Rain / snow budget (from the detail preset). */
  particleQuality = 1;

  /** Local hour at the focus point. */
  hour(): number {
    return this.clock.hourAt(this.refUp);
  }

  /** 0..1 daylight at the focus point. */
  get daylight(): number {
    return this.sky.state.day;
  }
}
