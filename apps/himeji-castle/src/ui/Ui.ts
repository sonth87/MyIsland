import { detectDevice, LEVEL_NAMES, SEASONS, SEASON_ICON, SEASON_LABEL } from '@g2/engine';
import { CAM_MODES, type CamMode } from '../cameras/CameraDirector';
import { DETAIL, VIEW, type DetailLevel, type ViewLevel } from '../detail';
import { WEATHER_PRESETS, type Settings, type ValleySettings } from '../settings';

const isTouch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const HINTS: Record<CamMode, string> = {
  overview: isTouch
    ? '1 ngón kéo để di chuyển · 2 ngón xoay / thu phóng · Chạm đúp để bay tới · Chạm tàu / cano để theo'
    : 'Kéo chuột để di chuyển · Chuột phải / Shift+kéo hoặc Q, E để xoay · Cuộn thu phóng · Click đúp để bay tới · 9 bay tự do',
  train: 'Kéo để xoay quanh tàu · Cuộn để zoom · H kéo còi · 3 vào buồng lái',
  driver: 'W / ↑ tăng ga · S / ↓ giảm ga · Space phanh · H kéo còi · Kéo chuột nhìn quanh · Cuộn để zoom',
  passenger: 'Kéo chuột nhìn quanh · Cuộn để zoom · Ngắm cảnh qua cửa sổ',
  bridges: '← / → đổi cầu · Kéo để xoay · Cuộn để zoom',
  boat: 'W / S hoặc ↑ / ↓ ga · A / D hoặc ← / → bẻ lái · Kéo để xoay · Cuộn để zoom',
  boatDriver: 'W / S hoặc ↑ / ↓ ga · A / D hoặc ← / → bẻ lái · Kéo chuột nhìn quanh · Cuộn để zoom',
  castle: 'Kéo để đi vòng quanh lâu đài · Cuộn để lại gần / ra xa · Để yên thì tự xoay chậm',
  free: 'WASD / mũi tên bay · Cuộn để tiến / lùi · E / Space lên · Q / C xuống · Shift nhanh · [ ] đổi tốc độ · Kéo chuột nhìn quanh',
};

export interface UiHooks {
  hour(): number;
  setHour(h: number): void;
  status(): string;
  whistle(): void;
  newSeed(seed: string | null): void;
  seed: string;
  /** On-screen buttons: hold / release a key, or press it once. */
  hold(code: string, down: boolean): void;
  tap(code: string): void;
  /** Switch to the next camera view. */
  cycleCamera(): void;
  /** Named spots the camera can jump to. */
  places: Array<{ label: string; go(): void }>;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** HUD (clock, gauges, frames, hints, bubbles) and the settings panel. */
export class Ui {
  private readonly root: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly gaugeValue: HTMLElement;
  private readonly gaugeBar: HTMLElement;
  private readonly gaugeLabel: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly bubbles = new Map<number, { el: HTMLElement; until: number }>();
  private toastTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private draggingHour = false;

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
    private readonly hooks: UiHooks,
  ) {
    this.root = root;
    const device = detectDevice();
    root.classList.toggle('touch', device.touch);
    root.classList.toggle('no-fullscreen', !device.fullscreen);
    root.innerHTML = `
      <div class="frame"></div>
      <div class="tunnel"></div>
      <div class="topleft">
        <div class="card title"><b>Himeji Castle</b> <span class="ja">姫路城</span></div>
        <div class="card chip clock"></div>
      </div>
      <button class="card chip sound-chip" data-sound>🔈 Chạm để bật âm thanh</button>
      <div class="card gauge">
        <span class="g-label"></span>
        <b class="g-value">0</b><small>km/h</small>
        <div class="g-bar"><i></i></div>
      </div>
      <div class="bubbles"></div>
      <button class="card cam-cycle" data-cycle aria-label="Đổi góc nhìn">🎥</button>
      <div class="pads">
        <div class="pad pad-driver">
          <button data-hold="KeyW"><b>＋</b><small>Ga</small></button>
          <button data-hold="KeyS"><b>－</b><small>Giảm ga</small></button>
          <button data-hold="Space" class="danger"><b>⛔</b><small>Phanh</small></button>
          <button data-tap="KeyH"><b>📯</b><small>Còi</small></button>
        </div>
        <div class="pad pad-fly">
          <button data-hold="KeyE"><b>▲</b><small>Lên</small></button>
          <button data-hold="KeyQ"><b>▼</b><small>Xuống</small></button>
        </div>
        <div class="pad pad-bridges">
          <button data-tap="ArrowLeft"><b>◀</b><small>Cầu trước</small></button>
          <button data-tap="ArrowRight"><b>▶</b><small>Cầu sau</small></button>
        </div>
      </div>
      <div class="hintbar"></div>
      <div class="toast card"></div>
      <div class="fps"></div>
      <div class="dock">
        <section class="panel card">
          <h3>Góc nhìn</h3>
          <div class="grid cams"></div>
          <h3>Điểm đến</h3>
          <div class="row" data-places></div>
          <h3>Mùa</h3>
          <div class="grid seasons" data-seg="season"></div>
          <h3>Thời gian</h3>
          <div class="row" data-time></div>
          <label class="slider"><span>Giờ <b data-hour-label></b></span><input type="range" min="0" max="24" step="0.05" data-hour /></label>
          <label class="slider" data-day-length><span>Một ngày dài <b data-out="dayMinutes"></b></span><input type="range" min="1" max="30" step="1" data-range="dayMinutes" /></label>
          <h3>Thời tiết</h3>
          <div class="row" data-weather></div>
          <p class="label">Gió</p><div class="row" data-seg="wind"></div>
          <h3>Tàu hoả</h3>
          <label class="slider"><span>Tốc độ chạy tự động <b data-out="trainSpeed"></b></span><input type="range" min="0.1" max="1" step="0.05" data-range="trainSpeed" /></label>
          <div class="row"><button data-whistle>📯 Kéo còi</button></div>
          <h3>Âm thanh</h3>
          <label class="slider"><span>Âm lượng <b data-out="volume"></b></span><input type="range" min="0" max="1" step="0.05" data-range="volume" /></label>
          <label class="check"><input type="checkbox" data-check="music" /> Nhạc nền (đàn koto ngẫu hứng)</label>
          <label class="check"><input type="checkbox" data-check="muted" /> Tắt tiếng</label>
          <h3>Bản đồ</h3>
          <div class="row seed"><input type="text" data-seed value="${esc(hooks.seed)}" spellcheck="false" /><button data-apply>Dựng lại</button><button data-random>🎲 Ngẫu nhiên</button></div>
          <h3>Đồ hoạ</h3>
          <p class="label">Độ chi tiết</p><div class="row" data-seg="detail"></div>
          <p class="note" data-detail-note></p>
          <p class="label">Tầm nhìn</p><div class="row" data-seg="view"></div>
          <p class="note">Càng xa càng nặng. Vật ở xa tự giảm chi tiết, sương mù che chỗ cắt.</p>
          <label class="check"><input type="checkbox" data-check="outline" /> Viền mực</label>
          <label class="check"><input type="checkbox" data-check="critters" /> Bướm, chuồn chuồn, chim én</label>
          <label class="check"><input type="checkbox" data-check="shadows" /> Bóng đổ</label>
          <label class="check"><input type="checkbox" data-check="adaptive" /> Tự giảm đồ hoạ khi máy chậm</label>
          <label class="check"><input type="checkbox" data-check="petals" /> Cánh hoa anh đào bay</label>
          <label class="check"><input type="checkbox" data-check="showFps" /> Hiện FPS</label>
          <p class="status"></p>
        </section>
        <button class="card toggle" data-toggle>Cài đặt <span class="caret">⌃</span></button>
      </div>
    `;
    this.clock = root.querySelector('.clock')!;
    this.hint = root.querySelector('.hintbar')!;
    this.gaugeValue = root.querySelector('.g-value')!;
    this.gaugeBar = root.querySelector('.g-bar i')!;
    this.gaugeLabel = root.querySelector('.g-label')!;
    this.toastEl = root.querySelector('.toast')!;
    this.fps = root.querySelector('.fps')!;

    const cams = root.querySelector('.cams')!;
    for (const c of CAM_MODES) {
      const b = document.createElement('button');
      b.dataset.cam = c.id;
      b.innerHTML = `${c.label} <small>${c.key}</small>`;
      b.addEventListener('click', () => settings.set({ camera: c.id }));
      cams.appendChild(b);
    }
    const places = root.querySelector('[data-places]')!;
    for (const p of hooks.places) {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.addEventListener('click', () => p.go());
      places.appendChild(b);
    }
    const time = root.querySelector('[data-time]')!;
    for (const [label, hour] of [
      ['🌅 Sáng', 7],
      ['☀️ Trưa', 12],
      ['🌇 Chiều', 17.6],
      ['🌙 Đêm', 22],
    ] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => this.setHour(hour));
      time.appendChild(b);
    }
    const run = document.createElement('button');
    run.dataset.run = '';
    run.addEventListener('click', () => settings.set({ timeMode: settings.get().timeMode === 'auto' ? 'fixed' : 'auto', fixedHour: hooks.hour() }));
    time.appendChild(run);

    const weather = root.querySelector('[data-weather]')!;
    for (const p of WEATHER_PRESETS) {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.dataset.preset = p.id;
      b.addEventListener('click', () => settings.set(p.patch));
      weather.appendChild(b);
    }
    const wind = root.querySelector('[data-seg="wind"]')!;
    (['auto', 0, 1, 2, 3, 4] as const).forEach((lv) => {
      const b = document.createElement('button');
      b.textContent = lv === 'auto' ? 'Tự động' : LEVEL_NAMES.wind[lv];
      b.dataset.value = String(lv);
      b.addEventListener('click', () => settings.set({ wind: lv }));
      wind.appendChild(b);
    });

    for (const [key, opts] of [
      ['detail', (Object.keys(DETAIL) as DetailLevel[]).map((k) => [k, DETAIL[k].label])],
      ['view', (Object.keys(VIEW) as ViewLevel[]).map((k) => [k, VIEW[k].label])],
    ] as const) {
      const row = root.querySelector(`[data-seg="${key}"]`)!;
      for (const [value, label] of opts) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.value = value;
        b.addEventListener('click', () => settings.set({ [key]: value } as Partial<ValleySettings>));
        row.appendChild(b);
      }
    }
    const seasonRow = root.querySelector('[data-seg="season"]')!;
    for (const k of SEASONS) {
      const b = document.createElement('button');
      b.dataset.value = k;
      b.innerHTML = `${SEASON_ICON[k]} ${SEASON_LABEL[k]}`;
      b.addEventListener('click', () => settings.set({ season: k }));
      seasonRow.appendChild(b);
    }
    const hourInput = root.querySelector<HTMLInputElement>('[data-hour]')!;
    hourInput.addEventListener('input', () => {
      this.draggingHour = true;
      this.setHour(Number(hourInput.value));
    });
    hourInput.addEventListener('change', () => (this.draggingHour = false));
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-range]')) {
      input.addEventListener('input', () => settings.set({ [input.dataset.range!]: Number(input.value) } as Partial<ValleySettings>));
    }
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-check]')) {
      input.addEventListener('change', () => settings.set({ [input.dataset.check!]: input.checked } as Partial<ValleySettings>));
    }
    root.querySelector('[data-toggle]')!.addEventListener('click', () => this.togglePanel());
    root.querySelector('[data-cycle]')!.addEventListener('click', () => hooks.cycleCamera());
    // On-screen pedals / buttons: hold to keep a key down, tap to press it once.
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-hold], [data-tap]')) {
      const hold = b.dataset.hold;
      const tap = b.dataset.tap;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        if (hold) hooks.hold(hold, true);
        if (tap) hooks.tap(tap);
      });
      const up = () => {
        b.classList.remove('down');
        if (hold) hooks.hold(hold, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    }
    root.querySelector('[data-whistle]')!.addEventListener('click', () => hooks.whistle());
    const seedInput = root.querySelector<HTMLInputElement>('[data-seed]')!;
    root.querySelector('[data-apply]')!.addEventListener('click', () => hooks.newSeed(seedInput.value.trim() || null));
    root.querySelector('[data-random]')!.addEventListener('click', () => hooks.newSeed(Math.random().toString(36).slice(2, 8)));
    // Keys typed into the seed box stay there; everything else reaches the game.
    seedInput.addEventListener('keydown', (e) => e.stopPropagation());
    // Don't let buttons / sliders keep keyboard focus (arrows would move a slider, not the game).
    root.addEventListener('pointerup', () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== seedInput && root.contains(el)) setTimeout(() => el.blur(), 0);
    });
    settings.subscribe((s) => this.render(s));
  }

  get panelOpen(): boolean {
    return this.root.classList.contains('open');
  }

  togglePanel(open = !this.panelOpen): void {
    this.root.classList.toggle('open', open);
  }

  /** Hides the "tap for sound" chip once audio runs. */
  soundReady(ready: boolean): void {
    this.root.querySelector<HTMLElement>('.sound-chip')!.style.display = ready ? 'none' : '';
  }

  setMode(mode: CamMode): void {
    this.root.dataset.cam = mode;
    this.hint.textContent = `${HINTS[mode]} · Giữ T tua nhanh · O cài đặt`;
    this.gaugeLabel.textContent = mode === 'driver' ? '🚂 Tàu' : '🚤 Cano';
  }

  /** Darkness of the tunnel overlay (0 = none). */
  setTunnel(amount: number): void {
    const el = this.root.querySelector<HTMLElement>('.tunnel')!;
    const v = amount.toFixed(2);
    if (el.style.opacity !== v) el.style.opacity = v;
  }

  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  /** Speed (km/h) and a 0..1 bar (throttle). */
  setGauge(kmh: number, bar: number): void {
    this.gaugeValue.textContent = String(Math.round(kmh));
    this.gaugeBar.style.width = `${Math.round(Math.max(0, Math.min(1, bar)) * 100)}%`;
  }

  toast(message: string, ms = 2200): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  say(id: number, text: string, seconds = 4): void {
    let b = this.bubbles.get(id);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'bubble card';
      this.root.querySelector('.bubbles')!.appendChild(el);
      b = { el, until: 0 };
      this.bubbles.set(id, b);
    }
    b.el.textContent = text;
    b.until = performance.now() + seconds * 1000;
  }

  speaking(): number[] {
    const now = performance.now();
    return [...this.bubbles.entries()].filter(([, b]) => b.until > now).map(([id]) => id);
  }

  placeBubble(id: number, x: number, y: number, visible: boolean): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    const alive = performance.now() < b.until && visible;
    b.el.classList.toggle('show', alive);
    if (alive) b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  tick(dt: number): void {
    const s = this.settings.get();
    if (s.showFps) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime > 0.5) {
        this.fps.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
    if (!this.panelOpen) return;
    const h = this.hooks.hour();
    const m = Math.floor(h * 60) % 1440;
    this.root.querySelector('[data-hour-label]')!.textContent = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (!this.draggingHour) this.root.querySelector<HTMLInputElement>('[data-hour]')!.value = String(h);
    this.root.querySelector('.status')!.textContent = this.hooks.status();
  }

  private setHour(h: number): void {
    if (this.settings.get().timeMode === 'fixed') this.settings.set({ fixedHour: h });
    else this.hooks.setHour(h);
  }

  private render(s: ValleySettings): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-cam]')) {
      if (b.tagName === 'BUTTON') b.classList.toggle('on', b.dataset.cam === s.camera);
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-preset]')) {
      const p = WEATHER_PRESETS.find((x) => x.id === b.dataset.preset)!;
      const on = (Object.keys(p.patch) as Array<'wind' | 'clouds' | 'rain' | 'snow'>).every((k) => s[k] === p.patch[k]);
      b.classList.toggle('on', on && (p.id === 'auto' || s.rain !== 'auto'));
    }
    for (const key of ['wind', 'detail', 'view', 'season'] as const) {
      for (const b of this.root.querySelectorAll<HTMLElement>(`[data-seg="${key}"] button`)) b.classList.toggle('on', b.dataset.value === String(s[key]));
    }
    this.root.querySelector('[data-detail-note]')!.textContent = DETAIL[s.detail].description;
    const run = this.root.querySelector<HTMLElement>('[data-run]')!;
    run.textContent = s.timeMode === 'auto' ? '⏸ Dừng giờ' : '▶ Chạy giờ';
    run.classList.toggle('on', s.timeMode === 'fixed');
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-range]')) {
      input.value = String(s[input.dataset.range as keyof ValleySettings]);
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-check]')) {
      input.checked = Boolean(s[input.dataset.check as keyof ValleySettings]);
    }
    this.root.querySelector('[data-out="dayMinutes"]')!.textContent = `${s.dayMinutes} phút`;
    this.root.querySelector('[data-out="trainSpeed"]')!.textContent = `${Math.round(s.trainSpeed * 86)} km/h`;
    this.root.querySelector('[data-out="volume"]')!.textContent = `${Math.round(s.volume * 100)}%`;
    this.root.querySelector<HTMLElement>('[data-day-length]')!.style.display = s.timeMode === 'auto' ? '' : 'none';
    this.fps.style.display = s.showFps ? 'block' : 'none';
    this.setMode(s.camera);
  }
}
