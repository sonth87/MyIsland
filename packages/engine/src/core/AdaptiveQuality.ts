import type { App, System } from './App';

/** A step the controller can take to lighten the load, in order of how little it hurts. */
export interface Rung {
  id: string;
  /** Short description for the "quality lowered" message. */
  label: string;
  apply(): void;
}

export interface AdaptiveOptions {
  /** Average fps below which quality is lowered. */
  lowFps?: number;
  /** Average fps above which resolution may be raised again. */
  highFps?: number;
  /** Seconds measured per decision. */
  window?: number;
  /** Seconds to wait after start-up (shader compilation, asset set-up) before judging. */
  warmup?: number;
  /** The lowest pixel-ratio scale the controller goes to. */
  minScale?: number;
  /** Called after every step; `rung` is null when only the resolution changed. */
  onChange?: (rung: Rung | null, scale: number) => void;
}

type Step = { kind: 'scale'; value: number } | { kind: 'rung'; rung: Rung };

/**
 * Keeps the frame rate up on weak GPUs. Every few seconds it looks at the average fps; while it
 * is too low it takes the next step of a ladder: first a slightly lower render resolution, then
 * the app's rungs one by one (shadows off, outlines off, lower detail…), and last the lowest
 * resolution. Resolution is raised again only after a long calm stretch (and only if nothing
 * else had to be switched off), and never again once the controller has been caught flip-flopping.
 */
export class AdaptiveQuality implements System {
  enabled = true;
  /** Rungs already taken. */
  readonly applied: Rung[] = [];
  private readonly opts: Required<Omit<AdaptiveOptions, 'onChange'>> & Pick<AdaptiveOptions, 'onChange'>;
  private readonly steps: Step[];
  private cursor = 0;
  private elapsed = 0;
  private windowTime = 0;
  private windowFrames = 0;
  private slowWindows = 0;
  private fastTime = 0;
  private sinceChange = 99;
  private raisedAt = -99;
  private frozen = false;

  constructor(
    private readonly app: Pick<App, 'pixelRatioScale' | 'setPixelRatioScale'>,
    rungs: Rung[],
    options: AdaptiveOptions = {},
  ) {
    this.opts = {
      lowFps: options.lowFps ?? 36,
      highFps: options.highFps ?? 57,
      window: options.window ?? 2,
      warmup: options.warmup ?? 5,
      minScale: options.minScale ?? 0.58,
      onChange: options.onChange,
    };
    this.steps = [
      { kind: 'scale', value: 0.85 },
      { kind: 'scale', value: 0.72 },
      ...rungs.map((rung): Step => ({ kind: 'rung', rung })),
      { kind: 'scale', value: this.opts.minScale },
    ];
  }

  update(dt: number): void {
    if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) return;
    this.elapsed += dt;
    this.sinceChange += dt;
    // Ignore the stutter of start-up and tab switches.
    if (this.elapsed < this.opts.warmup || dt > 0.25) {
      this.windowTime = 0;
      this.windowFrames = 0;
      return;
    }
    this.windowTime += dt;
    this.windowFrames++;
    if (this.windowTime < this.opts.window) return;
    const fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.decide(fps);
  }

  /** Forget the history (e.g. after the user changed the detail level themselves). */
  reset(): void {
    this.elapsed = 0;
    this.slowWindows = 0;
    this.fastTime = 0;
  }

  /** The decision for one measured window of `fps` (exposed for tests). */
  decide(fps: number): void {
    if (fps < this.opts.lowFps) {
      this.fastTime = 0;
      // Two slow windows in a row (not one hiccup) before acting.
      if (++this.slowWindows >= 2) {
        this.slowWindows = 0;
        this.lower();
      }
      return;
    }
    this.slowWindows = 0;
    const canRaise = this.applied.length === 0 && this.app.pixelRatioScale < 0.999 && !this.frozen;
    if (fps > this.opts.highFps && canRaise) {
      this.fastTime += this.opts.window;
      if (this.fastTime >= 14 && this.sinceChange > 25) {
        this.fastTime = 0;
        this.sinceChange = 0;
        this.raisedAt = this.elapsed;
        // Walk the ladder back one resolution step.
        this.cursor = Math.max(0, this.cursor - 1);
        this.app.setPixelRatioScale(Math.min(1, this.app.pixelRatioScale + 0.15));
        this.opts.onChange?.(null, this.app.pixelRatioScale);
      }
    } else {
      this.fastTime = 0;
    }
  }

  private lower(): void {
    // Slow again soon after raising the resolution: it can't take it, stop raising.
    if (this.elapsed - this.raisedAt < 30) this.frozen = true;
    this.sinceChange = 0;
    while (this.cursor < this.steps.length) {
      const step = this.steps[this.cursor++];
      if (step.kind === 'scale') {
        // Skip resolution steps that wouldn't lower anything.
        if (step.value >= this.app.pixelRatioScale - 0.01) continue;
        this.app.setPixelRatioScale(step.value);
        this.opts.onChange?.(null, step.value);
        return;
      }
      step.rung.apply();
      this.applied.push(step.rung);
      this.opts.onChange?.(step.rung, this.app.pixelRatioScale);
      return;
    }
  }
}
