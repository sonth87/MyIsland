import { detectDevice, type Level, type Season, type TimeMode } from '@g2/engine';

export type { Level };
export type ViewMode = 'first' | 'second' | 'third';
export type DetailLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
  season: Season;
  timeMode: TimeMode;
  fixedHour: number;
  dayMinutes: number;
  wind: Level;
  windDirAuto: boolean;
  /** Direction the wind blows towards, degrees clockwise from local north. */
  windDir: number;
  clouds: Level;
  rain: Level;
  snow: Level;
  view: ViewMode;
  detail: DetailLevel;
  outline: boolean;
  /** Ink outlines on trees, bushes and foliage (off: only buildings and characters keep them). */
  vegetationOutline: boolean;
  shadows: boolean;
  /** Lower the quality automatically while the frame rate is poor. */
  adaptive: boolean;
  leaves: boolean;
  critters: boolean;
  showFps: boolean;
  volume: number;
  music: boolean;
  muted: boolean;
}

const device = detectDevice();

export const DEFAULT_SETTINGS: GameSettings = {
  season: 'spring',
  timeMode: 'auto',
  fixedHour: 9.5,
  dayMinutes: 5,
  wind: 'auto',
  windDirAuto: true,
  windDir: 60,
  clouds: 'auto',
  rain: 'auto',
  snow: 'auto',
  view: 'third',
  detail: device.tier === 'low' ? 'low' : 'medium',
  outline: true,
  vegetationOutline: false,
  shadows: device.tier !== 'low',
  adaptive: true,
  leaves: true,
  critters: true,
  showFps: false,
  volume: 0.7,
  music: true,
  muted: false,
};

const STORAGE_KEY = 'keepsakeland:settings:v1';

type Listener = (s: GameSettings, changed: Array<keyof GameSettings>) => void;

/** Observable settings, persisted to localStorage when available. */
export class Settings {
  private value: GameSettings;
  private readonly listeners: Listener[] = [];

  constructor() {
    this.value = { ...DEFAULT_SETTINGS, ...load() };
  }

  get(): Readonly<GameSettings> {
    return this.value;
  }

  set(patch: Partial<GameSettings>): void {
    const changed = (Object.keys(patch) as Array<keyof GameSettings>).filter((k) => patch[k] !== this.value[k]);
    if (!changed.length) return;
    this.value = { ...this.value, ...patch };
    save(this.value);
    for (const fn of this.listeners) fn(this.value, changed);
  }

  /** Subscribes and immediately calls `fn` with every key marked as changed. */
  subscribe(fn: Listener): void {
    this.listeners.push(fn);
    fn(this.value, Object.keys(this.value) as Array<keyof GameSettings>);
  }
}

function load(): Partial<GameSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    // Keep only known keys so stale versions can't inject garbage.
    const out: Partial<GameSettings> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof GameSettings>) {
      if (k === 'season') {
        if (['spring', 'summer', 'autumn', 'winter'].includes(parsed.season as string)) out.season = parsed.season;
        continue;
      }
      if (k in parsed && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = parsed[k];
      else if (k in parsed && (k === 'wind' || k === 'clouds' || k === 'rain' || k === 'snow')) {
        (out as Record<string, unknown>)[k] = parsed[k];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(s: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable (private mode): settings just won't persist.
  }
}
