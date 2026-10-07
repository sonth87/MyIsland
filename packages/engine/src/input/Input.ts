import { Vector2 } from 'three';

type PointerRole = 'look' | 'joystick';

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  role: PointerRole;
  /** Right / middle mouse button, or Shift held at press: an "alternate" drag. */
  alt: boolean;
}

/** Movement (px) under which a press still counts as a click rather than a drag. */
const CLICK_MOVE_TOLERANCE = 6;
const CLICK_MAX_MS = 400;
const JOYSTICK_RADIUS = 48;
/** Touches starting in the left part of the screen drive the virtual joystick. */
const JOYSTICK_ZONE = 0.45;

export type ClickHandler = (ndc: Vector2) => void;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/**
 * Keyboard, mouse and touch input.
 * - `look`: pixels dragged this frame (left-mouse drag or one-finger touch drag).
 * - `altDrag`: pixels dragged with the right / middle button, Shift + drag, or by the
 *   midpoint of a two-finger touch.
 * - `zoom`: wheel / pinch delta this frame (positive = zoom out).
 * - `axis()`: WASD / arrows / virtual joystick as a 2D vector (y = forward).
 * Per-frame values are reset by `endFrame()` (called by App).
 */
export class Input {
  readonly look = new Vector2();
  readonly altDrag = new Vector2();
  zoom = 0;
  joystickEnabled = false;

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly pointers = new Map<number, PointerState>();
  private readonly joystick = new Vector2();
  private readonly clickHandlers: ClickHandler[] = [];
  private pinchDistance = 0;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;

  constructor(private readonly el: HTMLElement) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    this.joyBase = document.createElement('div');
    this.joyKnob = document.createElement('div');
    Object.assign(this.joyBase.style, {
      position: 'fixed',
      width: `${JOYSTICK_RADIUS * 2}px`,
      height: `${JOYSTICK_RADIUS * 2}px`,
      marginLeft: `${-JOYSTICK_RADIUS}px`,
      marginTop: `${-JOYSTICK_RADIUS}px`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.25)',
      border: '2px solid rgba(255,255,255,0.6)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '20',
    });
    Object.assign(this.joyKnob.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '44px',
      height: '44px',
      margin: '-22px 0 0 -22px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.85)',
    });
    this.joyBase.appendChild(this.joyKnob);
    document.body.appendChild(this.joyBase);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Presses or releases a key from outside (on-screen buttons). */
  holdKey(code: string, down: boolean): void {
    if (down) {
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** A one-frame press from outside (on-screen buttons). */
  tapKey(code: string): void {
    this.pressed.add(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  axis(out = new Vector2()): Vector2 {
    const k = this.keys;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const up = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const down = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    out.set(right - left, up - down).add(this.joystick);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  /** Registers a handler for clicks/taps (not drags). Receives normalized device coords. */
  onClick(fn: ClickHandler): void {
    this.clickHandlers.push(fn);
  }

  endFrame(): void {
    this.look.set(0, 0);
    this.altDrag.set(0, 0);
    this.zoom = 0;
    this.pressed.clear();
  }

  private lookPointers(): PointerState[] {
    return [...this.pointers.values()].filter((p) => p.role === 'look');
  }

  private onPointerDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    const hasJoystick = [...this.pointers.values()].some((p) => p.role === 'joystick');
    const role: PointerRole =
      this.joystickEnabled && e.pointerType === 'touch' && !hasJoystick && e.clientX < window.innerWidth * JOYSTICK_ZONE
        ? 'joystick'
        : 'look';
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      moved: false,
      role,
      alt: e.pointerType === 'mouse' && (e.button !== 0 || e.shiftKey),
    });
    if (role === 'joystick') {
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyBase.style.display = 'block';
      this.joyKnob.style.transform = '';
    }
    const lookers = this.lookPointers();
    if (lookers.length === 2) {
      this.pinchDistance = Math.hypot(lookers[0].x - lookers[1].x, lookers[0].y - lookers[1].y);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > CLICK_MOVE_TOLERANCE) p.moved = true;

    if (p.role === 'joystick') {
      const v = new Vector2(p.x - p.startX, p.y - p.startY);
      if (v.length() > JOYSTICK_RADIUS) v.setLength(JOYSTICK_RADIUS);
      this.joystick.set(v.x / JOYSTICK_RADIUS, -v.y / JOYSTICK_RADIUS);
      this.joyKnob.style.transform = `translate(${v.x}px, ${v.y}px)`;
      return;
    }

    const lookers = this.lookPointers();
    if (lookers.length === 1) {
      const target = p.alt ? this.altDrag : this.look;
      target.x += dx;
      target.y += dy;
    } else if (lookers.length === 2) {
      const d = Math.hypot(lookers[0].x - lookers[1].x, lookers[0].y - lookers[1].y);
      this.zoom += (this.pinchDistance - d) * 0.006;
      this.pinchDistance = d;
      // Each finger contributes half of the midpoint's motion.
      this.altDrag.x += dx / 2;
      this.altDrag.y += dy / 2;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'joystick') {
      this.joystick.set(0, 0);
      this.joyBase.style.display = 'none';
      return;
    }
    const isClick =
      e.type === 'pointerup' && !p.moved && performance.now() - p.startTime < CLICK_MAX_MS && this.lookPointers().length === 0;
    if (isClick) {
      const rect = this.el.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      for (const fn of this.clickHandlers) fn(ndc);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0015;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    // Game keys that the browser would otherwise use (focus cycling, page scroll).
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.joystick.set(0, 0);
  };
}
