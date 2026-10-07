import * as THREE from 'three';
import { MathUtils } from 'three';
import {
  ACTIVITY,
  createRng,
  ENV,
  detectDevice,
  Fireflies,
  Leaves,
  SEASON_LEAF_STYLE,
  Precipitation,
  Sky,
  SOUND,
  SeasonState,
  Weather,
  WorldClock,
  type App,
  type LeafSource,
  type Season,
  type SoundScape,
  type Surface,
  type WeatherControls,
} from '@g2/engine';
import type { FlatClouds } from '../life/Clouds';
import { gridValue, WATER_Y, type ValleyData } from '../world/ValleyGen';

const haloVertex = /* glsl */ `
uniform vec3 uSunDir;
uniform float uScale;
varying float vGlow;
void main() {
  vGlow = 1.0 - smoothstep(-0.05, 0.18, uSunDir.y);
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

const BASE_SKY_AMBIENT = ENV.uSkyAmbient.value.clone();
const BASE_GROUND_AMBIENT = ENV.uGroundAmbient.value.clone();

export interface ValleyEnvSettings extends WeatherControls {
  season: Season;
  timeMode: 'auto' | 'fixed';
  fixedHour: number;
  dayMinutes: number;
  petals: boolean;
  shadows: boolean;
}

/** Sun, sky, weather, fog, rain / snow, sakura petals and ambience for the flat valley. */
export class ValleyEnvironment {
  /** Tilted so the noon sun stands high over a flat world. */
  readonly clock = new WorldClock(1.15);
  readonly weather: Weather;
  readonly sky = new Sky();
  readonly precipitation: Precipitation;
  readonly petals: Leaves;
  readonly fireflies: Fireflies;
  readonly season: SeasonState;
  readonly sun: THREE.DirectionalLight;
  fastForward = false;
  /** Lets the adaptive controller switch shadows off on slow devices. */
  shadowsAllowed = true;
  /** Draw distance: fog closes in before it. */
  viewDistance = 340;
  private readonly fog = new THREE.Fog('#c4e8dc', 60, 420);
  private readonly halos: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly wind = new THREE.Vector3();
  private time = 0;
  private lastFlash = 0;
  private shadowExtent = 0;
  private styledSeason: Season | null = null;

  constructor(
    private readonly app: App,
    private readonly valley: ValleyData,
    initialSeason: Season,
    /** Deciduous trees (tagged 'sakura' / 'broadleaf' / 'maple'): what sheds petals and leaves. */
    deciduous: LeafSource[],
    lanterns: THREE.Vector3[],
    private readonly clouds: FlatClouds,
    private readonly sound: SoundScape,
  ) {
    const surface: Surface = {
      up: (_p, out) => out.set(0, 1, 0),
      ground: (p, out) => out.set(p.x, Math.max(valley.heightAt(p.x, p.z), WATER_Y), p.z),
      isWater: (p) => valley.heightAt(p.x, p.z) < WATER_Y,
    };
    this.weather = new Weather(createRng(`${valley.seed}:weather`), surface);
    this.precipitation = new Precipitation(surface, createRng(`${valley.seed}:rain`));
    this.season = new SeasonState(initialSeason);
    this.weather.setSeason(initialSeason);
    const lite = detectDevice().mobile;
    this.petals = new Leaves(surface, deciduous, createRng(`${valley.seed}:petals`), {
      max: lite ? 420 : 900,
      crown: [1.7, 2.9],
    });
    this.fireflies = new Fireflies(surface, createRng(`${valley.seed}:fireflies`), lite ? 60 : 120, 26);
    this.sun = new THREE.DirectionalLight('#fff4e2', 2.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;

    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(lanterns.flatMap((l) => l.toArray()), 3));
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
    app.scene.fog = this.fog;
    app.scene.background = null;
    app.scene.add(this.sky.group, this.precipitation.group, this.petals.mesh, this.fireflies.points, this.halos, this.sun, this.sun.target);
  }

  /** Jumps to a season without the slow fade (used at start-up). */
  snapSeason(season: Season): void {
    this.season.snap(season);
    this.weather.setSeason(season);
    this.styledSeason = null;
  }

  get noOutline(): THREE.Object3D[] {
    return [...this.sky.noOutline, this.precipitation.group, this.petals.mesh, this.fireflies.points, this.halos];
  }

  hour(): number {
    return this.clock.hourAt(this.up);
  }

  setHour(h: number): void {
    this.clock.setHour(h, this.up);
  }

  get daylight(): number {
    return this.sky.state.day;
  }

  update(dt: number, s: Readonly<ValleyEnvSettings>, focus: THREE.Vector3, shadowExtent: number, listener: THREE.Vector3): void {
    this.time += dt;
    this.clock.mode = s.timeMode;
    this.clock.fixedHour = s.fixedHour;
    this.clock.dayLength = s.dayMinutes * 60;
    this.clock.speed = this.fastForward ? 40 : 1;
    this.clock.update(dt, this.up);

    // Seasons: weights glide towards the chosen season; the weather, falling leaves and light follow.
    this.season.set(s.season);
    this.season.update(dt);
    this.weather.setSeason(s.season);
    if (this.styledSeason !== s.season) {
      this.styledSeason = s.season;
      this.petals.setStyle(SEASON_LEAF_STYLE[s.season]);
    }
    const sw = this.season.weights;
    const mood = this.season.current();

    this.weather.update(dt * (this.fastForward ? 8 : 1), focus, s);
    const w = this.weather;
    this.weather.windAt(focus, this.wind);

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

    // Sun light + shadow box around the focus.
    const dist = 220;
    this.sun.position.copy(focus).addScaledVector(this.clock.sunDir, dist);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = s.shadows && this.shadowsAllowed;
    this.sun.color.copy(mood.sun);
    this.sun.intensity = mood.sunIntensity;
    if (Math.abs(shadowExtent - this.shadowExtent) > 2) {
      this.shadowExtent = shadowExtent;
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -shadowExtent;
      cam.right = cam.top = shadowExtent;
      cam.near = 10;
      cam.far = dist * 2;
      cam.updateProjectionMatrix();
    }

    const camera = this.app.camera;
    const st = this.sky.update({
      camera,
      refUp: this.up,
      sunDir: this.clock.sunDir,
      moonDir: this.clock.moonDir,
      overcast: ENV.uOvercast.value,
      altitude: 0,
      flash: w.flash,
      time: this.time,
      mood: { zenith: mood.zenith, horizon: mood.horizon, amount: mood.skyAmount },
    });
    // The water reflects the sky.
    ENV.uSkyTint.value.copy(st.horizon).lerp(st.zenith, 0.35);
    const murk = Math.max(w.rain, w.snow * 1.1);
    this.fog.far = MathUtils.lerp(this.viewDistance * 0.98, Math.min(170, this.viewDistance * 0.6), murk) / mood.fog;
    this.fog.near = this.fog.far * MathUtils.lerp(0.28, 0.12, murk);
    this.fog.color.copy(st.horizon);

    this.clouds.cover = w.clouds;
    this.clouds.rain = Math.max(w.rain, w.snow * 0.6);
    this.clouds.daylight = Math.max(st.day, st.twilight * 0.6);
    this.clouds.update(dt, this.wind);

    // Rain falls around the viewer up close, around the view target from high up.
    const high = MathUtils.smoothstep(listener.y - this.valley.heightAt(listener.x, listener.z), 30, 160);
    const rainCenter = high > 0.5 ? focus : camera.position.clone().setY(focus.y);
    this.precipitation.update(dt, rainCenter, w, Math.max(st.day, st.twilight * 0.5), true);
    this.petals.enabled = s.petals;
    this.petals.update(dt, focus, w, true);
    // Fireflies on warm summer nights, low over the ground near the viewer.
    const night = 1 - MathUtils.smoothstep(st.day, 0, 0.35);
    this.fireflies.update(
      dt,
      focus,
      night * this.season.value(ACTIVITY.fireflies) * (1 - w.rain) * (1 - w.snow),
      (this.app.renderer.getPixelRatio() * this.app.height) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)),
    );
    // Point size so the halo spans ~4.5 world units at any distance.
    const cam = this.app.camera;
    this.halos.material.uniforms.uScale.value =
      (4.5 * this.app.renderer.getPixelRatio() * this.app.height) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

    // Ambience: river when close to water, birds by day, crickets at night.
    const nearWater = 1 - MathUtils.smoothstep(gridValue(this.valley.riverDist, listener.x, listener.z), 10, 45);
    const ground = 1 - high;
    this.sound.setAmbience({
      wind: w.gust * (0.5 + 0.5 * ground) + high * 0.25,
      rain: Math.max(w.rain, w.snow * 0.15) * (0.4 + 0.6 * ground),
      water: nearWater * ground,
      birds: st.day * (1 - w.rain) * (1 - w.snow * 0.6) * (0.4 + 0.6 * ground) * this.season.value(SOUND.birdsong),
      crickets: (1 - st.day) * (1 - w.rain) * (1 - w.snowCover) * ground * this.season.value(SOUND.crickets),
      cicadas: st.day * (1 - w.rain) * ground * this.season.value(SOUND.cicadas),
    });
    if (w.flash > 0.9 && this.lastFlash <= 0.9) this.sound.thunder(Math.random());
    this.lastFlash = w.flash;
    this.sound.update(dt);
  }

  windVector(): THREE.Vector3 {
    return this.wind;
  }
}
