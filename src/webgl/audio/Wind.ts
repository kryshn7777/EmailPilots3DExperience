/**
 * The wind: an optional sound bed that follows the flight's speed. WebAudio only, no files (0 KB).
 *
 * Two seconds of brown noise loop through a band-pass whose centre rises with speed (300 Hz at rest,
 * 1800 Hz flat out) and a gain that opens with it (0.02 -> 0.12). A sharp gain in speed adds a 250 ms
 * whoosh. Each stretch of the story colours it a little: a hiss of rain in the storm, a slow 0.1 Hz
 * swell at sea, a low hum over the city.
 *
 * The AudioContext is made on the first switch-on (a click on the toggle: browsers only allow audio
 * after a gesture). Off by default; page.ts remembers the choice; never under reduced motion (the
 * Engine does not make one). Suspended while the tab is hidden.
 */
export class Wind {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private band!: BiquadFilterNode;
  private bed!: GainNode;
  private rain!: GainNode;
  private hum!: GainNode;
  private swellDepth!: GainNode;
  private noise!: AudioBuffer;
  private on = false;
  private whooshAt = 0;
  private prevVp = 0;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (on && !this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (on) {
      void ctx.resume();
      this.master.gain.setTargetAtTime(1, ctx.currentTime, 0.25);
    } else {
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      window.setTimeout(() => {
        if (!this.on) void ctx.suspend();
      }, 600);
    }
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    // brown noise, 2 s, looped
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    // cross-fade the loop point so it does not click
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i]! * k + d[len - fade + i]! * (1 - k);
    }
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // the bed: noise -> band-pass -> gain (with the sea's swell on its gain)
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 300;
    this.band.Q.value = 0.7;
    this.bed = ctx.createGain();
    this.bed.gain.value = 0.02;
    src.connect(this.band).connect(this.bed).connect(this.master);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.1;
    this.swellDepth = ctx.createGain();
    this.swellDepth.gain.value = 0;
    lfo.connect(this.swellDepth).connect(this.bed.gain);
    lfo.start();

    // the storm's rain: the same noise, high-passed (it is brown, so this is a soft hiss)
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noise;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 3.1;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    rainSrc.connect(hp).connect(this.rain).connect(this.master);
    rainSrc.start();

    // the city's hum: two low sines
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    for (const f of [55, 110.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.hum);
      o.start();
    }
    this.hum.connect(this.master);
  }

  /**
   * Per frame: story-t, the speed 0..1 (Engine.feelSpeed), the perceived speed vp (1/s) and dt.
   */
  update(t: number, s: number, vp: number, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') {
      this.prevVp = vp;
      return;
    }
    const now = ctx.currentTime;
    this.band.frequency.setTargetAtTime(300 + 1500 * s, now, 0.15);
    this.bed.gain.setTargetAtTime(0.02 + 0.1 * s, now, 0.15);
    const k = (a: number, b: number, c: number, e: number): number => smooth(t, a, b) * (1 - smooth(t, c, e));
    this.rain.gain.setTargetAtTime(0.035 * k(0.36, 0.39, 0.46, 0.49), now, 0.4);
    this.swellDepth.gain.setTargetAtTime(0.018 * k(0.46, 0.49, 0.56, 0.6), now, 0.4);
    this.hum.gain.setTargetAtTime(0.012 * k(0.62, 0.67, 0.76, 0.8), now, 0.4);
    // a whoosh when the speed picks up sharply
    const acc = (vp - this.prevVp) / Math.max(dt, 1e-3);
    this.prevVp = vp;
    if (acc > 30 && now - this.whooshAt > 0.6) {
      this.whooshAt = now;
      this.whoosh(now);
    }
  }

  private whoosh(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 2;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(600, at);
    f.frequency.exponentialRampToValueAtTime(2200, at + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.08, at + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 1.5);
    src.stop(at + 0.26);
  }

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.visibilityState === 'hidden') void ctx.suspend();
    else if (this.on) void ctx.resume();
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ctx?.close();
  }
}

function smooth(x: number, a: number, b: number): number {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
}
