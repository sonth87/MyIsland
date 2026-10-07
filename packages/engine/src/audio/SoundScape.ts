/**
 * Procedural ambience and sound effects with the Web Audio API — no audio files.
 * Continuous "beds" (wind, rain, water, motor) are noise or oscillators through filters whose
 * gains follow the game state; one-shots (birds, crickets, steps, thunder, train) are scheduled.
 * Browsers only allow audio after a user gesture: call `unlock()` from one.
 */

export type StepSurface = 'grass' | 'dirt' | 'wood' | 'snow' | 'stone';

/** In-scale (Japanese pentatonic) on D, two octaves, for the generative koto-like music. */
const IN_SCALE = [293.66, 311.13, 392.0, 440.0, 466.16, 587.33, 622.25, 783.99, 880.0];

interface Bed {
  gain: GainNode;
  filter: BiquadFilterNode;
  target: number;
}

export class SoundScape {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private readonly beds = new Map<string, Bed>();
  private motor: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private volume = 0.7;
  private musicVolume = 0.5;
  private muted = false;
  private time = 0;
  private nextBird = 2;
  private nextCricket = 1;
  private nextNote = 1;
  private birds = 0;
  private crickets = 0;
  private cicadas: { level: GainNode; target: number } | null = null;
  private music = true;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Creates / resumes the audio context. Must run inside a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.musicBus.connect(this.master);

    // Two seconds of white noise, shared by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.bed('wind', 'bandpass', 500, 0.6);
    this.bed('rain', 'highpass', 1400, 0.3);
    this.bed('rainLow', 'lowpass', 500, 0.7);
    this.bed('water', 'lowpass', 700, 0.8);
    this.makeCicadas();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean, volume = this.musicVolume): void {
    this.music = on;
    this.musicVolume = volume;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? volume * 0.5 : 0, this.ctx.currentTime, 0.3);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Continuous levels, 0..1. Call every frame. */
  setAmbience(a: { wind?: number; rain?: number; water?: number; birds?: number; crickets?: number; cicadas?: number }): void {
    if (a.cicadas !== undefined && this.cicadas) this.cicadas.target = a.cicadas * 0.1;
    if (a.wind !== undefined) this.setBed('wind', 0.02 + a.wind * a.wind * 0.35);
    if (a.rain !== undefined) {
      this.setBed('rain', a.rain * 0.22);
      this.setBed('rainLow', a.rain * 0.18);
    }
    if (a.water !== undefined) this.setBed('water', a.water * 0.12);
    if (a.birds !== undefined) this.birds = a.birds;
    if (a.crickets !== undefined) this.crickets = a.crickets;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    for (const b of this.beds.values()) b.gain.gain.setTargetAtTime(b.target, ctx.currentTime, 0.4);
    if (this.cicadas) {
      // Cicadas rise and fall in waves.
      const swell = 0.65 + 0.35 * Math.sin(this.time * 0.45) * Math.sin(this.time * 0.17 + 1);
      this.cicadas.level.gain.setTargetAtTime(this.cicadas.target * swell, ctx.currentTime, 0.5);
    }
    // The wind's pitch wanders so it whooshes instead of hissing.
    const wind = this.beds.get('wind');
    if (wind) wind.filter.frequency.setTargetAtTime(380 + Math.sin(this.time * 0.6) * 160 + Math.sin(this.time * 1.7) * 60, ctx.currentTime, 0.3);

    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      if (Math.random() < this.birds) this.birdSong();
      this.nextBird = 0.8 + Math.random() * 3.5;
    }
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      if (Math.random() < this.crickets) this.cricket();
      this.nextCricket = 0.35 + Math.random() * 0.9;
    }
    this.nextNote -= dt;
    if (this.nextNote <= 0) {
      if (this.music && Math.random() < 0.72) this.pluck(IN_SCALE[Math.floor(Math.random() * IN_SCALE.length)]);
      this.nextNote = [0.55, 0.55, 1.1, 1.1, 1.65, 2.2][Math.floor(Math.random() * 6)];
    }
  }

  // ---- one-shots ---------------------------------------------------------

  footstep(surface: StepSurface, loudness = 1): void {
    const f = { grass: 900, dirt: 600, wood: 380, snow: 1500, stone: 2200 }[surface];
    const q = surface === 'wood' ? 4 : 0.9;
    this.noiseBurst(f, q, 0.07 * loudness, 0.09, surface === 'snow' ? 'highpass' : 'bandpass');
  }

  shutter(): void {
    this.noiseBurst(3000, 1.5, 0.25, 0.03, 'bandpass');
    setTimeout(() => this.noiseBurst(2200, 1.5, 0.2, 0.05, 'bandpass'), 90);
  }

  thunder(distance = 0.5): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const delay = 0.2 + distance * 2.5;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * (1 - distance * 0.5), t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    src.connect(lp).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + 3.6);
  }

  /** Steam engine exhaust puff. */
  chuff(loudness = 1): void {
    this.noiseBurst(420, 0.8, 0.22 * loudness, 0.16, 'bandpass');
  }

  whistle(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.08);
    g.gain.setValueAtTime(0.12, t + 0.9);
    g.gain.linearRampToValueAtTime(0, t + 1.3);
    g.connect(this.sfx);
    for (const f of [587, 740, 880]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 1.35);
    }
  }

  splash(loudness = 1): void {
    this.noiseBurst(1200, 0.6, 0.18 * loudness, 0.25, 'lowpass');
  }

  /** Boat / engine drone; `level` 0 stops it. `rpm` 0..1. */
  setMotor(level: number, rpm: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.motor && level > 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfx);
      osc.start();
      this.motor = { osc, gain, filter };
    }
    if (!this.motor) return;
    const t = ctx.currentTime;
    this.motor.osc.frequency.setTargetAtTime(48 + rpm * 70, t, 0.15);
    this.motor.filter.frequency.setTargetAtTime(250 + rpm * 700, t, 0.15);
    this.motor.gain.gain.setTargetAtTime(level * 0.06, t, 0.2);
  }

  // ---- internals ------------------------------------------------------------

  private bed(name: string, type: BiquadFilterType, freq: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(0, Math.random() * 2);
    this.beds.set(name, { gain, filter, target: 0 });
  }

  /** Summer cicadas: a shrill band of noise chopped by a fast buzz. */
  private makeCicadas(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 1.3;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 5600;
    band.Q.value = 5;
    // Buzz: the gain swings between 0 and 1 about 30 times a second.
    const buzz = ctx.createGain();
    buzz.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 29;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(buzz.gain);
    const level = ctx.createGain();
    level.gain.value = 0;
    src.connect(band).connect(buzz).connect(level).connect(this.master);
    src.start();
    lfo.start();
    this.cicadas = { level, target: 0 };
  }

  private setBed(name: string, v: number): void {
    const b = this.beds.get(name);
    if (b) b.target = v;
  }

  private noiseBurst(freq: number, q: number, peak: number, length: number, type: BiquadFilterType): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.9 + Math.random() * 0.2);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + length + 0.02);
  }

  private birdSong(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.sfx);
    const base = 2400 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  private cricket(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;
    pan.connect(this.sfx);
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.045;
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.012, t + 0.005);
      g.gain.linearRampToValueAtTime(0, t + 0.03);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.04);
    }
  }

  /** Koto-like pluck: bright attack, quick decay, a touch of vibrato. */
  private pluck(freq: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 6, t);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.6);
    lp.connect(g).connect(this.musicBus);
    for (const [mult, type, level] of [
      [1, 'triangle', 1],
      [2, 'sine', 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5;
      const vibGain = ctx.createGain();
      vibGain.gain.value = freq * 0.004;
      vib.connect(vibGain).connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(lp);
      o.start(t);
      vib.start(t);
      o.stop(t + 2.3);
      vib.stop(t + 2.3);
    }
  }
}
