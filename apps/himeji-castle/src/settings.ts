import type { Level } from '@g2/engine';
import type { CamMode } from './cameras/CameraDirector';
import type { DetailLevel, ViewLevel } from './detail';
import type { ValleyEnvSettings } from './env/ValleyEnvironment';

export interface ValleySettings extends ValleyEnvSettings {
  camera: CamMode;
  /** Cruise speed of the automatic train, 0..1. */
  trainSpeed: number;
  volume: number;
  music: boolean;
  muted: boolean;
  outline: boolean;
  showFps: boolean;
  detail: DetailLevel;
  view: ViewLevel;
  critters: boolean;
}

export const DEFAULTS: ValleySettings = {
  camera: 'overview',
  timeMode: 'auto',
  fixedHour: 10,
  dayMinutes: 6,
  wind: 'auto',
  windDirAuto: true,
  windDir: 60,
  clouds: 'auto',
  rain: 'auto',
  snow: 'auto',
  petals: true,
  shadows: true,
  trainSpeed: 0.5,
  volume: 0.7,
  music: true,
  muted: false,
  outline: true,
  showFps: false,
  detail: 'high',
  view: 'far',
  critters: true,
};

const KEY = 'himeji-castle:settings:v1';
const LEVEL_KEYS = new Set(['wind', 'clouds', 'rain', 'snow']);

type Listener = (s: ValleySettings, changed: Array<keyof ValleySettings>) => void;

export class Settings {
  private value: ValleySettings;
  private readonly listeners: Listener[] = [];

  constructor() {
    this.value = { ...DEFAULTS, ...load() };
  }

  get(): Readonly<ValleySettings> {
    return this.value;
  }

  set(patch: Partial<ValleySettings>): void {
    const changed = (Object.keys(patch) as Array<keyof ValleySettings>).filter((k) => patch[k] !== this.value[k]);
    if (!changed.length) return;
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Storage unavailable: settings just won't persist.
    }
    for (const fn of this.listeners) fn(this.value, changed);
  }

  subscribe(fn: Listener): void {
    this.listeners.push(fn);
    fn(this.value, Object.keys(this.value) as Array<keyof ValleySettings>);
  }
}

function load(): Partial<ValleySettings> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULTS) as Array<keyof ValleySettings>) {
      if (!(k in parsed)) continue;
      const v = parsed[k];
      if (LEVEL_KEYS.has(k) ? v === 'auto' || [0, 1, 2, 3, 4].includes(v as number) : typeof v === typeof DEFAULTS[k]) out[k] = v;
    }
    return out as Partial<ValleySettings>;
  } catch {
    return {};
  }
}

/** One-click weather presets: which controls each one sets. */
export const WEATHER_PRESETS: Array<{ id: string; label: string; patch: Partial<Record<'wind' | 'clouds' | 'rain' | 'snow', Level>> }> = [
  { id: 'auto', label: 'Tự động', patch: { wind: 'auto', clouds: 'auto', rain: 'auto', snow: 'auto' } },
  { id: 'sun', label: '☀️ Nắng', patch: { clouds: 1, rain: 0, snow: 0 } },
  { id: 'cloud', label: '☁️ Nhiều mây', patch: { clouds: 3, rain: 0, snow: 0 } },
  { id: 'rain', label: '🌧 Mưa', patch: { clouds: 4, rain: 2, snow: 0 } },
  { id: 'storm', label: '⛈ Dông', patch: { clouds: 4, rain: 4, snow: 0, wind: 3 } },
  { id: 'snow', label: '❄️ Tuyết', patch: { clouds: 3, rain: 0, snow: 3 } },
];
