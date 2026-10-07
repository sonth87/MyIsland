import type { Level, TimeMode } from '@g2/engine';

export type { Level };
export type ViewMode = 'first' | 'second' | 'third';
export type DetailLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface GameSettings {
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
  shadows: boolean;
  leaves: boolean;
  critters: boolean;
  showFps: boolean;
  volume: number;
  music: boolean;
  muted: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
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
  detail: 'medium',
  outline: true,
  shadows: true,
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
