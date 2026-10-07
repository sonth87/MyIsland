import { MathUtils, Vector3 } from 'three';
import type { Rng } from '../world/rng';
import type { Season } from './Season';
import type { Level, Surface, WeatherControls } from './Surface';

interface Pattern {
  name: string;
  wind: number;
  clouds: number;
  rain: number;
  snow: number;
  weight: number;
}

const P = (name: string, wind: number, clouds: number, rain: number, snow: number, weight: number): Pattern => ({ name, wind, clouds, rain, snow, weight });

/** Weather states the automatic mode drifts between, for each season. */
const PATTERNS: Record<Season, Pattern[]> = {
  spring: [
    P('Nắng đẹp', 0.2, 0.15, 0, 0, 3),
    P('Gió nhẹ, mây trôi', 0.4, 0.4, 0, 0, 3),
    P('Nhiều mây', 0.3, 0.7, 0, 0, 1.5),
    P('Mưa xuân', 0.35, 0.85, 0.4, 0, 1.5),
    P('Mưa rào', 0.5, 0.9, 0.6, 0, 0.7),
  ],
  summer: [
    P('Nắng gắt', 0.12, 0.1, 0, 0, 4),
    P('Nắng, vài đám mây', 0.25, 0.35, 0, 0, 3),
    P('Nhiều mây', 0.25, 0.7, 0, 0, 1),
    P('Mưa rào mùa hạ', 0.5, 0.9, 0.65, 0, 1.2),
    P('Dông', 0.85, 1, 1, 0, 1.2),
  ],
  autumn: [
    P('Gió thu, mây trôi', 0.5, 0.4, 0, 0, 3),
    P('Nắng dịu', 0.25, 0.2, 0, 0, 2),
    P('Nhiều mây', 0.4, 0.75, 0, 0, 2.5),
    P('Mưa thu', 0.45, 0.85, 0.35, 0, 1.5),
    P('Gió lớn', 0.85, 0.5, 0, 0, 1.5),
  ],
  winter: [
    P('Tuyết rơi nhẹ', 0.25, 0.8, 0, 0.4, 3),
    P('Tuyết rơi', 0.35, 0.9, 0, 0.7, 2.5),
    P('Bão tuyết', 0.85, 1, 0, 1, 1),
    P('U ám', 0.3, 0.8, 0, 0, 2.5),
    P('Nắng lạnh', 0.2, 0.2, 0, 0, 1.5),
    P('Gió lạnh', 0.7, 0.4, 0, 0, 1),
  ],
};

/** World direction treated as "north" (projected onto the local ground plane). */
const NORTH = new Vector3(0, 1, 0);
const NORTH_FLAT = new Vector3(0, 0, -1);
const _n = new Vector3();
const _t = new Vector3();
const _axis = new Vector3();

export const LEVEL_NAMES = {
  wind: ['Lặng gió', 'Gió nhẹ', 'Gió vừa', 'Gió mạnh', 'Gió bão'],
  clouds: ['Trời quang', 'Ít mây', 'Mây vừa', 'Nhiều mây', 'U ám'],
  rain: ['Không mưa', 'Mưa phùn', 'Mưa vừa', 'Mưa to', 'Dông'],
  snow: ['Không tuyết', 'Tuyết nhẹ', 'Tuyết vừa', 'Tuyết dày', 'Bão tuyết'],
};

/** Level 0..4 for a 0..1 intensity (for display). */
export function levelOf(v: number): number {
  return Math.min(4, Math.round(v * 4));
}

/**
 * Wind, clouds, rain, snow and their slow consequences (wet ground, settled snow, lightning).
 * Every parameter is either fixed by the settings or follows the automatic weather pattern,
 * and always eases towards its target so changes look natural.
 */
export class Weather {
  wind = 0.3;
  clouds = 0.25;
  rain = 0;
  snow = 0;
  /** Wind incl. gusts — what foliage and particles react to. */
  gust = 0.3;
  snowCover = 0;
  wet = 0;
  flash = 0;
  /** Wind field axis: wind at p blows along cross(windAxis, normalize(p)). */
  readonly windAxis = new Vector3(0, 1, 0);
  pattern: Pattern;
  /** Season the automatic weather follows. */
  season: Season = 'spring';
  private patternTime: number;
  private heading = 1;
  private time = 0;
  private nextFlash = 6;
  private flashQueue = 0;
  private axisReady = false;

  constructor(
    private readonly rng: Rng,
    private readonly surface: Surface,
  ) {
    this.pattern = PATTERNS.spring[1];
    this.patternTime = 50;
  }

  /** Switches the automatic weather to a season's patterns (a new one is picked at once). */
  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    this.nextPattern();
  }

  get storm(): boolean {
    return this.rain > 0.85 && this.target.storm;
  }

  private readonly target = { wind: 0, clouds: 0, rain: 0, snow: 0, storm: false };

  update(dt: number, focus: Vector3, s: Readonly<WeatherControls>): void {
    this.time += dt;
    this.patternTime -= dt;
    if (this.patternTime <= 0) this.nextPattern();

    const p = this.pattern;
    const pick = (level: Level, auto: number) => (level === 'auto' ? auto : level / 4);
    const t = this.target;
    t.wind = pick(s.wind, p.wind);
    t.clouds = pick(s.clouds, p.clouds);
    t.rain = pick(s.rain, p.rain);
    t.snow = pick(s.snow, p.snow);
    // Precipitation needs clouds (unless clouds were forced off).
    if (s.clouds === 'auto') t.clouds = Math.max(t.clouds, t.rain * 0.9, t.snow * 0.8);
    t.storm = s.rain === 4 || (s.rain === 'auto' && p.rain >= 0.95);

    this.wind = approach(this.wind, t.wind, 0.12 * dt);
    this.clouds = approach(this.clouds, t.clouds, 0.06 * dt);
    this.rain = approach(this.rain, t.rain, 0.1 * dt);
    this.snow = approach(this.snow, t.snow, 0.08 * dt);

    // Gusts: two incommensurate waves give an irregular rhythm.
    const g = 0.5 + 0.5 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.71 + 1.3);
    this.gust = this.wind * (0.7 + 0.6 * g);

    // Snow melts quickly out of winter (a spring thaw), slowly inside it.
    const melt = this.season === 'winter' ? 1 / 70 : 1 / 12;
    this.snowCover = MathUtils.clamp(
      this.snowCover + (this.snow > 0.05 ? (this.snow * dt) / 25 : -dt * melt) - (this.rain * dt) / 20,
      0,
      1,
    );
    this.wet = MathUtils.clamp(this.wet + (this.rain > 0.05 ? (this.rain * dt) / 8 : -dt / 35), 0, 1);

    this.updateWindAxis(dt, focus, s);
    this.updateLightning(dt);
  }

  /** Wind velocity direction (unit, tangent) at a world point, scaled by current gusting strength. */
  windAt(p: Vector3, out: Vector3): Vector3 {
    this.surface.up(p, _n);
    out.crossVectors(this.windAxis, _n);
    const len = out.length();
    return len > 1e-5 ? out.multiplyScalar(this.gust / len) : out.set(0, 0, 0);
  }

  describe(): string {
    if (this.storm) return 'Dông';
    if (this.snow > 0.08) return LEVEL_NAMES.snow[Math.max(1, levelOf(this.snow))];
    if (this.rain > 0.08) return LEVEL_NAMES.rain[Math.max(1, levelOf(this.rain))];
    if (this.clouds > 0.7) return 'Nhiều mây';
    if (this.clouds > 0.4) return 'Có mây';
    return 'Trời quang';
  }

  describeWind(): string {
    return LEVEL_NAMES.wind[levelOf(this.wind)];
  }

  private nextPattern(): void {
    const list = PATTERNS[this.season];
    const total = list.reduce((sum, p) => sum + p.weight, 0);
    let r = this.rng() * total;
    let next = list[0];
    for (const p of list) {
      r -= p.weight;
      if (r <= 0) {
        next = p;
        break;
      }
    }
    this.pattern = next;
    this.patternTime = 45 + this.rng() * 75;
  }

  private updateWindAxis(dt: number, focus: Vector3, s: Readonly<WeatherControls>): void {
    if (s.windDirAuto) this.heading += dt * 0.04 * Math.sin(this.time * 0.05 + 0.7);
    else this.heading = MathUtils.degToRad(s.windDir);

    // Local north at the focus point; wind blows towards `heading` (clockwise from north).
    this.surface.up(focus, _n);
    const north = Math.abs(_n.dot(NORTH)) > 0.999 ? NORTH_FLAT : NORTH;
    _t.copy(north).addScaledVector(_n, -north.dot(_n));
    if (_t.lengthSq() < 1e-4) _t.set(1, 0, 0).addScaledVector(_n, -_n.x);
    _t.normalize().applyAxisAngle(_n, -this.heading);
    // cross(axis, up) == wind tangent  ⇔  axis = cross(up, wind tangent)
    _axis.crossVectors(_n, _t).normalize();
    if (!this.axisReady) {
      this.windAxis.copy(_axis);
      this.axisReady = true;
    } else {
      this.windAxis.lerp(_axis, 1 - Math.exp(-0.8 * dt)).normalize();
    }
  }

  private updateLightning(dt: number): void {
    this.flash = Math.max(0, this.flash - dt * 5);
    if (!this.storm) return;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.flash = 1;
      this.flashQueue = 0.12 + this.rng() * 0.12;
      this.nextFlash = 4 + this.rng() * 9;
    }
    if (this.flashQueue > 0) {
      this.flashQueue -= dt;
      if (this.flashQueue <= 0) this.flash = 0.75;
    }
  }
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}
