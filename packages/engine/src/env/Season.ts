import { Color, MathUtils, Vector4 } from 'three';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Xuân',
  summer: 'Hạ',
  autumn: 'Thu',
  winter: 'Đông',
};

export const SEASON_ICON: Record<Season, string> = {
  spring: '🌸',
  summer: '☀️',
  autumn: '🍁',
  winter: '❄️',
};

/** One value per season (spring, summer, autumn, winter). */
export type PerSeason<T> = readonly [T, T, T, T];

/** How active each kind of wildlife is, 0..1, per season. */
export const ACTIVITY = {
  /** Flocks of birds and little birds hopping between trees. */
  birds: [1, 0.85, 0.55, 0],
  butterflies: [1, 0.85, 0.2, 0],
  dragonflies: [0.35, 1, 0.75, 0],
  swallows: [1, 0.7, 0.15, 0],
  /** Fish jumping and lotus flowers. */
  pond: [1, 1, 0.7, 0.05],
  /** Fireflies at night. */
  fireflies: [0, 1, 0, 0],
} satisfies Record<string, PerSeason<number>>;

/** Soundscape: how loud each seasonal sound is. */
export const SOUND = {
  birdsong: [1, 0.75, 0.4, 0],
  cicadas: [0, 1, 0.12, 0],
  crickets: [0.35, 0.8, 1, 0],
} satisfies Record<string, PerSeason<number>>;

/** Light and sky colour of each season, blended by the season weights. */
export interface SeasonMood {
  /** Direct sunlight colour and strength. */
  sun: Color;
  sunIntensity: number;
  /** Sky is pulled towards this colour by `skyAmount`. */
  zenith: Color;
  horizon: Color;
  skyAmount: number;
  /** Multiplies the ambient light (warm / cool). */
  ambient: Color;
  /** Fog thickness multiplier. */
  fog: number;
}

const MOODS: PerSeason<SeasonMood> = [
  // Spring: soft, clear, a touch rosy.
  { sun: new Color('#fff3e4'), sunIntensity: 2.7, zenith: new Color('#79c4dc'), horizon: new Color('#e9f0e0'), skyAmount: 0.3, ambient: new Color('#ffffff'), fog: 1 },
  // Summer: bright, high contrast, deep blue sky.
  { sun: new Color('#fff1d0'), sunIntensity: 3.0, zenith: new Color('#3d9ad8'), horizon: new Color('#cfe9f2'), skyAmount: 0.45, ambient: new Color('#f4fff4'), fog: 0.8 },
  // Autumn: low golden light, hazy peach horizon.
  { sun: new Color('#ffdba8'), sunIntensity: 2.6, zenith: new Color('#8fb4cf'), horizon: new Color('#f3d2a8'), skyAmount: 0.45, ambient: new Color('#ffe9d2'), fog: 1.15 },
  // Winter: pale, cold, bluish.
  { sun: new Color('#e6efff'), sunIntensity: 2.3, zenith: new Color('#8fa9c4'), horizon: new Color('#dfe8f0'), skyAmount: 0.5, ambient: new Color('#dfe9ff'), fog: 1.3 },
];

export function seasonIndex(s: Season): number {
  return SEASONS.indexOf(s);
}

/**
 * Where the world is on the yearly cycle. `pos` is continuous (0 = spring … 3 = winter, wrapping
 * to spring at 4), and always glides towards the chosen season by the shortest way round, so a
 * change of season fades colours and sheds / grows leaves instead of jumping.
 */
export class SeasonState {
  /** Weights of spring, summer, autumn, winter (they sum to 1). */
  readonly weights = new Vector4(1, 0, 0, 0);
  /** The season the player picked. */
  target: Season;
  pos: number;
  /** Seconds a one-season change takes. */
  transition = 3.5;
  private readonly mood: SeasonMood = {
    sun: new Color(),
    sunIntensity: 1,
    zenith: new Color(),
    horizon: new Color(),
    skyAmount: 0,
    ambient: new Color(),
    fog: 1,
  };

  constructor(initial: Season = 'spring') {
    this.target = initial;
    this.pos = seasonIndex(initial);
    this.computeWeights();
  }

  /** Jumps straight to a season (no transition). */
  snap(season: Season): void {
    this.target = season;
    this.pos = seasonIndex(season);
    this.computeWeights();
  }

  set(season: Season): void {
    this.target = season;
  }

  /** True while the weights are still gliding. */
  get changing(): boolean {
    return Math.abs(this.delta()) > 0.001;
  }

  /** The season the world is closest to right now. */
  get nearest(): Season {
    return SEASONS[Math.round(((this.pos % 4) + 4) % 4) % 4];
  }

  update(dt: number): void {
    const d = this.delta();
    if (Math.abs(d) > 0.001) {
      const step = dt / this.transition;
      this.pos += Math.sign(d) * Math.min(Math.abs(d), step);
      this.pos = ((this.pos % 4) + 4) % 4;
    } else {
      this.pos = seasonIndex(this.target);
    }
    this.computeWeights();
  }

  /** Blends a per-season table with the current weights. */
  value(table: PerSeason<number>): number {
    const w = this.weights;
    return table[0] * w.x + table[1] * w.y + table[2] * w.z + table[3] * w.w;
  }

  /** Light / sky colours for the current blend (valid until the next call). */
  current(): SeasonMood {
    const w = [this.weights.x, this.weights.y, this.weights.z, this.weights.w];
    const m = this.mood;
    m.sun.setRGB(0, 0, 0);
    m.zenith.setRGB(0, 0, 0);
    m.horizon.setRGB(0, 0, 0);
    m.ambient.setRGB(0, 0, 0);
    m.sunIntensity = 0;
    m.skyAmount = 0;
    m.fog = 0;
    MOODS.forEach((s, i) => {
      m.sun.r += s.sun.r * w[i];
      m.sun.g += s.sun.g * w[i];
      m.sun.b += s.sun.b * w[i];
      m.zenith.r += s.zenith.r * w[i];
      m.zenith.g += s.zenith.g * w[i];
      m.zenith.b += s.zenith.b * w[i];
      m.horizon.r += s.horizon.r * w[i];
      m.horizon.g += s.horizon.g * w[i];
      m.horizon.b += s.horizon.b * w[i];
      m.ambient.r += s.ambient.r * w[i];
      m.ambient.g += s.ambient.g * w[i];
      m.ambient.b += s.ambient.b * w[i];
      m.sunIntensity += s.sunIntensity * w[i];
      m.skyAmount += s.skyAmount * w[i];
      m.fog += s.fog * w[i];
    });
    return m;
  }

  /** Signed shortest distance (in seasons) from where we are to where we are going. */
  private delta(): number {
    const t = seasonIndex(this.target);
    let d = t - (((this.pos % 4) + 4) % 4);
    if (d > 2) d -= 4;
    if (d < -2) d += 4;
    return d;
  }

  private computeWeights(): void {
    const p = ((this.pos % 4) + 4) % 4;
    const w = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      let d = Math.abs(p - i);
      d = Math.min(d, 4 - d);
      w[i] = MathUtils.clamp(1 - d, 0, 1);
    }
    this.weights.set(w[0], w[1], w[2], w[3]);
  }
}
