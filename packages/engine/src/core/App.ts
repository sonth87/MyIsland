import * as THREE from 'three';
import { Input } from '../input/Input';

/** A unit of game logic driven by the App loop. */
export interface System {
  /** Called at a fixed rate (default 60 Hz). Use for movement / simulation. */
  fixedUpdate?(dt: number): void;
  /**
   * Called once per rendered frame.
   * `alpha` ∈ [0,1) is how far we are between the last two fixed steps (for interpolation).
   */
  update?(dt: number, alpha: number): void;
}

export interface AppOptions {
  container: HTMLElement;
  fixedStep?: number;
  maxPixelRatio?: number;
  background?: THREE.ColorRepresentation;
  fov?: number;
  near?: number;
  far?: number;
  /** Hardware anti-aliasing of the default framebuffer. Off by default: the post-processing pipeline has its own. */
  antialias?: boolean;
}

/** Max frame delta; prevents huge jumps after the tab was hidden. */
const MAX_FRAME_DT = 0.1;

export class App {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly fixedStep: number;
  maxPixelRatio: number;
  /** 0..1 multiplier on the pixel ratio, lowered by the adaptive quality controller when frames are slow. */
  pixelRatioScale = 1;
  width = 1;
  height = 1;
  /** Seconds since start (frame time, clamped). */
  elapsed = 0;
  /** Replace to plug in a post-processing pipeline. */
  render: () => void;

  private readonly systems: System[] = [];
  private readonly resizeHandlers: Array<(w: number, h: number) => void> = [];
  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;

  constructor(options: AppOptions) {
    this.container = options.container;
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;

    this.renderer = new THREE.WebGLRenderer({ antialias: options.antialias ?? false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'app-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(options.fov ?? 50, 1, options.near ?? 0.1, options.far ?? 1000);
    if (options.background !== undefined) this.scene.background = new THREE.Color(options.background);

    this.input = new Input(this.renderer.domElement);
    this.render = () => this.renderer.render(this.scene, this.camera);

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();

    // Phones sometimes lose the GL context when memory runs short or the page sleeps: reload to recover.
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      this.contextLostHandler();
    });
  }

  /** What to do when the graphics context is lost (default: reload the page after a moment). */
  contextLostHandler: () => void = () => {
    setTimeout(() => location.reload(), 800);
  };

  /** Effective device pixel ratio (the device's, capped, then scaled). */
  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio, this.maxPixelRatio) * this.pixelRatioScale;
  }

  setPixelRatioScale(scale: number): void {
    this.pixelRatioScale = Math.max(0.3, Math.min(1, scale));
    this.resize();
  }

  add<T extends System>(system: T): T {
    this.systems.push(system);
    return system;
  }

  /** Registers a resize callback and calls it immediately with the current size. */
  onResize(fn: (width: number, height: number) => void): void {
    this.resizeHandlers.push(fn);
    fn(this.width, this.height);
  }

  resize(): void {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeHandlers) fn(this.width, this.height);
  }

  start(): void {
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      this.tick(now / 1000);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.lastTime = -1;
  }

  private tick(now: number): void {
    const dt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, MAX_FRAME_DT);
    this.lastTime = now;
    this.elapsed += dt;

    this.accumulator += dt;
    while (this.accumulator >= this.fixedStep) {
      for (const s of this.systems) s.fixedUpdate?.(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    const alpha = this.accumulator / this.fixedStep;
    for (const s of this.systems) s.update?.(dt, alpha);

    this.render();
    this.input.endFrame();
  }
}
