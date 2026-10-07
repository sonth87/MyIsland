import { LEVEL_NAMES, SEASONS, SEASON_ICON, SEASON_LABEL, type Level } from '@g2/engine';
import { DETAIL } from '../settings/detail';
import type { DetailLevel, GameSettings, Settings, ViewMode } from '../settings/Settings';

type Option<T> = { value: T; label: string };

const levels = (names: string[]): Array<Option<Level>> => [
  { value: 'auto', label: 'Tự động' },
  ...names.map((label, i) => ({ value: i as Level, label })),
];

const TIME_PRESETS: Array<{ hour: number; label: string }> = [
  { hour: 6, label: '🌅 Bình minh' },
  { hour: 12, label: '☀️ Trưa' },
  { hour: 18, label: '🌇 Hoàng hôn' },
  { hour: 0, label: '🌙 Nửa đêm' },
];

const VIEWS: Array<Option<ViewMode>> = [
  { value: 'first', label: 'Thứ nhất' },
  { value: 'second', label: 'Thứ hai' },
  { value: 'third', label: 'Thứ ba' },
];

const DETAILS = (Object.keys(DETAIL) as DetailLevel[]).map((value) => ({ value, label: DETAIL[value].label }));

export interface SettingsPanelHooks {
  /** Current local hour at the focus point (for the slider and readout). */
  hour(): number;
  /** Jump the clock (auto mode) so the local hour becomes `hour`. */
  setHour(hour: number): void;
  status(): string;
}

/** The ⚙ panel: time of day, weather, camera view and graphics detail. */
export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly hourInput: HTMLInputElement;
  private readonly hourLabel: HTMLElement;
  private draggingHour = false;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly hooks: SettingsPanelHooks,
  ) {
    this.el = document.createElement('aside');
    this.el.className = 'settings card';
    this.el.innerHTML = `
      <header>
        <h2>Cài đặt</h2>
        <button class="close" data-close aria-label="Đóng">✕</button>
      </header>
      <p class="status"></p>
      <section>
        <h3>Mùa</h3>
        <div class="row seasons" data-seg="season"></div>
        <p class="note">Mùa đổi cây cối, hoa lá, thời tiết, chim bướm và âm thanh.</p>
      </section>
      <section>
        <h3>Thời gian</h3>
        <div class="row" data-seg="timeMode"></div>
        <div class="row presets"></div>
        <label class="slider">
          <span>Giờ <b data-hour-label></b></span>
          <input type="range" min="0" max="24" step="0.05" data-hour />
        </label>
        <label class="slider" data-day-length>
          <span>Một ngày dài <b data-out="dayMinutes"></b></span>
          <input type="range" min="1" max="30" step="1" data-range="dayMinutes" />
        </label>
        <p class="note">Giữ <kbd>T</kbd> để tua nhanh thời gian.</p>
      </section>
      <section>
        <h3>Thời tiết <button class="link" data-all-auto>Tự động hết</button></h3>
        <p class="label">Gió</p><div class="row" data-seg="wind"></div>
        <label class="check"><input type="checkbox" data-check="windDirAuto" /> Hướng gió tự đổi</label>
        <label class="slider" data-wind-dir>
          <span>Hướng gió <b data-out="windDir"></b></span>
          <input type="range" min="0" max="359" step="1" data-range="windDir" />
        </label>
        <p class="label">Mây</p><div class="row" data-seg="clouds"></div>
        <p class="label">Mưa</p><div class="row" data-seg="rain"></div>
        <p class="label">Tuyết</p><div class="row" data-seg="snow"></div>
      </section>
      <section>
        <h3>Góc nhìn <span class="hint-key">V</span></h3>
        <div class="row" data-seg="view"></div>
      </section>
      <section>
        <h3>Âm thanh</h3>
        <label class="slider">
          <span>Âm lượng <b data-out="volume"></b></span>
          <input type="range" min="0" max="1" step="0.05" data-range="volume" />
        </label>
        <label class="check"><input type="checkbox" data-check="music" /> Nhạc nền (đàn koto ngẫu hứng)</label>
        <label class="check"><input type="checkbox" data-check="muted" /> Tắt tiếng</label>
      </section>
      <section>
        <h3>Đồ hoạ</h3>
        <p class="label">Độ chi tiết</p><div class="row" data-seg="detail"></div>
        <p class="note" data-detail-note></p>
        <label class="check"><input type="checkbox" data-check="outline" /> Viền mực</label>
        <label class="check"><input type="checkbox" data-check="vegetationOutline" /> Viền mực trên cây cỏ</label>
        <label class="check"><input type="checkbox" data-check="shadows" /> Bóng đổ</label>
        <label class="check"><input type="checkbox" data-check="adaptive" /> Tự giảm chất lượng khi máy chậm</label>
        <label class="check"><input type="checkbox" data-check="leaves" /> Lá rơi</label>
        <label class="check"><input type="checkbox" data-check="critters" /> Bướm, chuồn chuồn, chim én</label>
        <label class="check"><input type="checkbox" data-check="showFps" /> Hiện FPS</label>
      </section>
    `;
    parent.appendChild(this.el);
    this.status = this.el.querySelector('.status')!;
    this.hourInput = this.el.querySelector('[data-hour]')!;
    this.hourLabel = this.el.querySelector('[data-hour-label]')!;

    this.segment(
      'season',
      SEASONS.map((value) => ({ value, label: `${SEASON_ICON[value]} ${SEASON_LABEL[value]}` })),
    );
    this.segment('timeMode', [
      { value: 'auto', label: '▶ Chạy' },
      { value: 'fixed', label: '⏸ Cố định' },
    ]);
    this.segment('wind', levels(LEVEL_NAMES.wind));
    this.segment('clouds', levels(LEVEL_NAMES.clouds));
    this.segment('rain', levels(LEVEL_NAMES.rain));
    this.segment('snow', levels(LEVEL_NAMES.snow));
    this.segment('view', VIEWS);
    this.segment('detail', DETAILS);

    const presets = this.el.querySelector('.presets')!;
    for (const p of TIME_PRESETS) {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.addEventListener('click', () => this.setHour(p.hour));
      presets.appendChild(b);
    }

    this.hourInput.addEventListener('input', () => {
      this.draggingHour = true;
      this.setHour(Number(this.hourInput.value));
    });
    this.hourInput.addEventListener('change', () => (this.draggingHour = false));

    for (const input of this.el.querySelectorAll<HTMLInputElement>('[data-range]')) {
      const key = input.dataset.range as 'dayMinutes' | 'windDir' | 'volume';
      input.addEventListener('input', () => {
        const patch: Partial<GameSettings> = { [key]: Number(input.value) };
        if (key === 'windDir') patch.windDirAuto = false;
        settings.set(patch);
      });
    }
    for (const input of this.el.querySelectorAll<HTMLInputElement>('[data-check]')) {
      const key = input.dataset.check as 'outline' | 'vegetationOutline' | 'shadows' | 'adaptive' | 'leaves' | 'critters' | 'showFps' | 'windDirAuto' | 'music' | 'muted';
      input.addEventListener('change', () => settings.set({ [key]: input.checked }));
    }
    this.el.querySelector('[data-all-auto]')!.addEventListener('click', () =>
      settings.set({ wind: 'auto', clouds: 'auto', rain: 'auto', snow: 'auto', windDirAuto: true }),
    );
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(false));
    // Buttons and sliders must not keep keyboard focus, or arrow keys would move a slider
    // instead of the character.
    this.el.addEventListener('pointerup', () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && this.el.contains(el)) setTimeout(() => el.blur(), 0);
    });

    settings.subscribe((s) => this.render(s));
  }

  get open(): boolean {
    return this.el.classList.contains('open');
  }

  toggle(open = !this.open): void {
    this.el.classList.toggle('open', open);
  }

  /** Called every frame while open: live clock and weather readout. */
  tick(): void {
    if (!this.open) return;
    const h = this.hooks.hour();
    this.hourLabel.textContent = fmt(h);
    if (!this.draggingHour) this.hourInput.value = String(h);
    this.status.textContent = this.hooks.status();
  }

  private setHour(hour: number): void {
    if (this.settings.get().timeMode === 'fixed') this.settings.set({ fixedHour: hour });
    else this.hooks.setHour(hour);
  }

  private segment<K extends keyof GameSettings>(key: K, options: Array<Option<GameSettings[K]>>): void {
    const row = this.el.querySelector(`[data-seg="${key}"]`)!;
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.dataset.value = String(o.value);
      b.addEventListener('click', () => this.settings.set({ [key]: o.value } as Partial<GameSettings>));
      row.appendChild(b);
    }
  }

  private render(s: GameSettings): void {
    for (const row of this.el.querySelectorAll<HTMLElement>('[data-seg]')) {
      const v = String(s[row.dataset.seg as keyof GameSettings]);
      for (const b of row.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.value === v);
    }
    for (const input of this.el.querySelectorAll<HTMLInputElement>('[data-range]')) {
      input.value = String(s[input.dataset.range as 'dayMinutes' | 'windDir' | 'volume']);
    }
    for (const input of this.el.querySelectorAll<HTMLInputElement>('[data-check]')) {
      input.checked = Boolean(s[input.dataset.check as keyof GameSettings]);
    }
    this.el.querySelector('[data-out="dayMinutes"]')!.textContent = `${s.dayMinutes} phút`;
    this.el.querySelector('[data-out="volume"]')!.textContent = `${Math.round(s.volume * 100)}%`;
    this.el.querySelector('[data-out="windDir"]')!.textContent = `${s.windDir}° ${compass(s.windDir)}`;
    this.el.querySelector<HTMLElement>('[data-day-length]')!.style.display = s.timeMode === 'auto' ? '' : 'none';
    this.el.querySelector<HTMLElement>('[data-wind-dir]')!.classList.toggle('dim', s.windDirAuto);
    this.el.querySelector('[data-detail-note]')!.textContent = DETAIL[s.detail].description;
  }
}

function fmt(hour: number): string {
  const m = Math.floor(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function compass(deg: number): string {
  const names = ['Bắc', 'Đông Bắc', 'Đông', 'Đông Nam', 'Nam', 'Tây Nam', 'Tây', 'Tây Bắc'];
  return names[Math.round(deg / 45) % 8];
}
