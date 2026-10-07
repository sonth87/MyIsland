import type { IslandConfig } from '../data/types';
import type { ViewMode } from '../settings/Settings';

export type HudMode = 'intro' | 'overview' | 'flying' | 'walk';

export interface HudHandlers {
  onStart(): void;
  onOverview(): void;
  onSettings(): void;
  onSwitchCharacter(): void;
  onSound(): void;
  /** Holds / releases a keyboard key (on-screen buttons). */
  hold(code: string, down: boolean): void;
  /** Taps a keyboard key (on-screen buttons). */
  tap(code: string): void;
}

const ICON_PLANET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M3 14c4 2 14-1 18-4"/></svg>`;
const ICON_FULLSCREEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const ICON_SOUND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path class="wave" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/><path class="mute" d="M16 9l5 6M21 9l-5 6"/></svg>`;
const ICON_PEOPLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.8-4-5.6"/></svg>`;

const isTouch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const OVERVIEW_HINT = isTouch
  ? 'Kéo để xoay · Chụm để phóng to · Chạm một điểm để đáp xuống'
  : 'Kéo để xoay · Cuộn để phóng to · Click một điểm để đáp xuống';

const WALK_HINTS: Record<ViewMode, string> = {
  first: 'WASD đi · Kéo chuột nhìn quanh · Space nhảy · E tương tác · Q vẫy · C chụp ảnh · V đổi góc nhìn · Tab đổi nhân vật',
  second: 'W/S đi tới/lui · A/D xoay người · Space nhảy · E tương tác · Q vẫy · V đổi góc nhìn · Tab đổi nhân vật',
  third: 'WASD / click để đi · Shift chạy · Space nhảy · E tương tác · Q vẫy · C chụp ảnh · V đổi góc nhìn · Tab đổi nhân vật',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

interface Bubble {
  el: HTMLElement;
  until: number;
}

/** DOM overlay: intro card, badges, side buttons, hints, prompt, speech bubbles, toasts. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly whoEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly bubbles = new Map<string, Bubble>();
  private toastTimer = 0;
  private view: ViewMode = 'third';
  private mode: HudMode = 'intro';
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(root: HTMLElement, cfg: IslandConfig, handlers: HudHandlers) {
    this.root = root;
    const name = escapeHtml(cfg.name.vi);
    const ja = escapeHtml(cfg.name.ja);
    root.innerHTML = `
      <section class="intro card">
        <p class="eyebrow">Vùng đất kỷ vật</p>
        <p class="eyebrow-sub">思い出の国 · Keepsakeland</p>
        <h1>${name} <span class="ja">${ja}</span></h1>
        <p class="meta">${escapeHtml(cfg.region)}</p>
        <p class="desc">${escapeHtml(cfg.description)}</p>
        <button class="btn-primary" data-action="start">Bắt đầu khám phá</button>
        <p class="hint">${isTouch ? 'Kéo để xoay · Chụm để phóng to · Chạm để đáp xuống' : 'Kéo để xoay · Cuộn để phóng to · Click để đáp xuống'}</p>
      </section>
      <div class="topleft">
        <div class="badge card"><span class="ja">${ja}</span> <b>${name.toUpperCase()}</b></div>
        <div class="chip card clock"></div>
        <button class="chip card who" data-action="switch" title="Đổi nhân vật (Tab)"></button>
      </div>
      <div class="side">
        <button class="icon-btn card" data-action="settings" title="Cài đặt (O)">${ICON_GEAR}</button>
        <button class="icon-btn card" data-action="overview" title="Toàn cảnh (Esc)">${ICON_PLANET}</button>
        <button class="icon-btn card" data-action="switch" title="Đổi nhân vật (Tab)">${ICON_PEOPLE}</button>
        <button class="icon-btn card sound" data-action="sound" title="Âm thanh">${ICON_SOUND}</button>
        <button class="icon-btn card" data-action="fullscreen" title="Toàn màn hình">${ICON_FULLSCREEN}</button>
      </div>
      <div class="prompt card"></div>
      <div class="actions">
        <div class="act-row">
          <button class="act card" data-tap="KeyQ" aria-label="Vẫy tay">👋</button>
          <button class="act card" data-tap="KeyC" aria-label="Chụp ảnh">📷</button>
          <button class="act card" data-tap="KeyV" aria-label="Đổi góc nhìn">🎥</button>
          <button class="act card" data-toggle="ShiftLeft" aria-label="Chạy">🏃</button>
        </div>
        <div class="act-row">
          <button class="act act-big card" data-tap="KeyE" aria-label="Tương tác">✋</button>
          <button class="act act-big card" data-hold="Space" aria-label="Nhảy">⤒</button>
        </div>
      </div>
      <div class="bubbles"></div>
      <div class="hintbar"></div>
      <div class="toast card"></div>
      <div class="flash"></div>
      <div class="fps"></div>
    `;
    this.hint = root.querySelector('.hintbar')!;
    this.toastEl = root.querySelector('.toast')!;
    this.clockEl = root.querySelector('.clock')!;
    this.whoEl = root.querySelector('.who')!;
    this.promptEl = root.querySelector('.prompt')!;
    this.flashEl = root.querySelector('.flash')!;
    this.fpsEl = root.querySelector('.fps')!;

    root.classList.toggle('touch', isTouch);
    root.classList.toggle('no-fullscreen', !document.documentElement.requestFullscreen);
    // On-screen action buttons: a press is a key press (so the game needs no separate touch code).
    for (const b of root.querySelectorAll<HTMLElement>('.act')) {
      const hold = b.dataset.hold;
      const tap = b.dataset.tap;
      const toggle = b.dataset.toggle;
      if (hold) {
        const up = () => {
          handlers.hold(hold, false);
          b.classList.remove('held');
        };
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          b.setPointerCapture(e.pointerId);
          handlers.hold(hold, true);
          b.classList.add('held');
        });
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
      } else if (tap) {
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          handlers.tap(tap);
        });
      } else if (toggle) {
        let on = false;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          on = !on;
          handlers.hold(toggle, on);
          b.classList.toggle('held', on);
        });
      }
    }
    // The prompt is a button too: tapping it does what [E] does.
    this.promptEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handlers.tap('KeyE');
    });

    root.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'start') handlers.onStart();
      else if (action === 'overview') handlers.onOverview();
      else if (action === 'settings') handlers.onSettings();
      else if (action === 'switch') handlers.onSwitchCharacter();
      else if (action === 'sound') handlers.onSound();
      else if (action === 'fullscreen') this.toggleFullscreen();
    });
  }

  get container(): HTMLElement {
    return this.root;
  }

  setMode(mode: HudMode): void {
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.updateHint();
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.updateHint();
  }

  setMuted(muted: boolean): void {
    this.root.querySelector('.sound')!.classList.toggle('muted', muted);
  }

  setClock(text: string): void {
    if (this.clockEl.textContent !== text) this.clockEl.textContent = text;
  }

  setCharacter(name: string): void {
    this.whoEl.textContent = `👤 ${name}`;
  }

  /** Interaction prompt above a world point (screen px), or hidden when `text` is null. */
  prompt(text: string | null, x = 0, y = 0): void {
    if (!text) {
      this.promptEl.classList.remove('show');
      return;
    }
    if (this.promptEl.dataset.text !== text) {
      this.promptEl.dataset.text = text;
      this.promptEl.innerHTML = text.replace(/\[(\w+)\]/g, '<kbd>$1</kbd>');
    }
    this.promptEl.classList.add('show');
    this.promptEl.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  /** Shows (or refreshes) a speech bubble for `id`. Position it every frame with `placeBubble`. */
  say(id: string, text: string, seconds = 4): void {
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
    b.el.classList.add('show');
  }

  /** Positions the bubble of `id` (screen px); hides it when expired or off-screen. */
  placeBubble(id: string, x: number, y: number, visible: boolean): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    const alive = performance.now() < b.until;
    b.el.classList.toggle('show', alive && visible);
    if (alive && visible) b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  /** True while `id` has a speech bubble up. */
  isSpeaking(id: string): boolean {
    const b = this.bubbles.get(id);
    return !!b && performance.now() < b.until;
  }

  bubbleIds(): string[] {
    return [...this.bubbles.keys()];
  }

  flash(): void {
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  toast(message: string, ms = 2200): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  showFps(on: boolean): void {
    this.fpsEl.style.display = on ? 'block' : 'none';
  }

  tickFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private updateHint(): void {
    this.hint.textContent =
      this.mode === 'overview' ? OVERVIEW_HINT : this.mode === 'walk' ? (isTouch ? 'Cần điều khiển bên trái để đi · Kéo để xoay' : WALK_HINTS[this.view]) : '';
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }
}
