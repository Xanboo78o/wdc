// debrisaudio.js — what the pieces sound like, synthesised from what they do.
//
// Adam, 2026-09-23: "GENUINELY emulate sounds dont js USE random full clips".
// So there are no samples here. Every sound is built from the event that made
// it — which piece, how big, how fast it hit, how far from the camera:
//
//   snap     a part tearing off: a carbon CRACK (a sharp broadband burst, high-
//            passed), a crunch of micro-fractures after it, and a low thump
//            of the structure letting go
//   clatter  a piece landing or being kicked: a knock through a band-pass at
//            the piece's own pitch (small = high, a wing = low), ringing on a
//            few INHARMONIC modes, which is what makes a plate sound like a
//            plate and not like a bell
//   tinkle   a shard: a very short, very high ping
//
// It plays into the engine's own AudioContext, at the input of its master
// chain (`engine.cans`), so it shares the limiter and the concussion filter
// and needs nothing from audio.js but those two handles. Rate-limited and
// voice-capped: a 40-shard spray is a dozen voices, not forty.
const MAX_VOICES = 14;

export class DebrisAudio {
  constructor() {
    this.engine = null;
    this.voices = 0;
    this.lastAt = 0;
    this.cam = null;
  }

  attach(engine, camera) { this.engine = engine; this.cam = camera; }

  _ctx() {
    const e = this.engine;
    if (!e || !e.ctx || !e.cans || e.muted) return null;
    // tools/debrisaudio.html renders into an OfflineAudioContext, which is
    // not 'running' until it renders; `e.offline` lets it through.
    if (e.ctx.state !== 'running' && !e.offline) return null;
    if (!this.noise || this.noise.sampleRate !== e.ctx.sampleRate) {
      const n = e.ctx.sampleRate;             // one second of white noise
      const b = e.ctx.createBuffer(1, n, n), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    return e.ctx;
  }

  // Distance and side, from the camera.
  _place(x, y, z) {
    const c = this.cam;
    if (!c) return { g: 1, pan: 0 };
    const dx = x - c.position.x, dy = y - c.position.y, dz = z - c.position.z;
    const d = Math.hypot(dx, dy, dz);
    // camera right = column 0 of its world matrix
    const e = c.matrixWorld.elements;
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * e[0] + dy * e[1] + dz * e[2]) / d)) : 0;
    return { g: 1 / (1 + d / 10), pan, d };
  }

  _out(ctx, gain, pan, dur) {
    if (this.voices >= MAX_VOICES) return null;
    this.voices++;
    const g = ctx.createGain();
    g.gain.value = gain * (this.engine.master ?? 1);
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.8;
    g.connect(p).connect(this.engine.cans);
    setTimeout(() => { this.voices--; try { g.disconnect(); p.disconnect(); } catch { /* gone */ } }, (dur + 0.1) * 1000);
    return g;
  }

  _burst(ctx, dest, t, dur, type, f, Q, level) {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f1 = ctx.createBiquadFilter();
    f1.type = type; f1.frequency.value = f; f1.Q.value = Q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f1).connect(env).connect(dest);
    s.start(t, Math.random() * 0.8, dur + 0.02);
  }

  _mode(ctx, dest, t, f, dur, level) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.97, t + dur);   // it detunes as it dies
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    o.connect(env).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** A part tearing off the car. `strength` 0..1. */
  snap(pos, strength = 1) {
    const ctx = this._ctx(); if (!ctx) return;
    const { g, pan } = this._place(pos.x, pos.y, pos.z);
    const out = this._out(ctx, Math.min(0.55, 0.45 * g * (0.4 + strength)), pan, 0.5);
    if (!out) return;
    const t = ctx.currentTime + (this.at || 0) + 0.005;
    this._burst(ctx, out, t, 0.045, 'highpass', 1800, 0.7, 1.0);          // the crack
    for (let i = 0; i < 7; i++) {                                           // fibres going
      this._burst(ctx, out, t + 0.012 + Math.random() * 0.09, 0.012 + Math.random() * 0.02,
        'bandpass', 2500 + Math.random() * 4500, 2.5, 0.35 + Math.random() * 0.4);
    }
    this._mode(ctx, out, t, 70 + Math.random() * 30, 0.14, 0.9);          // the structure letting go
    this._burst(ctx, out, t, 0.09, 'lowpass', 420, 0.8, 0.8);
  }

  /** A piece landing, bouncing, skating, or kicked. `size` in metres. */
  clatter(pos, speed, size = 0.3) {
    const ctx = this._ctx(); if (!ctx) return;
    const now = ctx.currentTime;
    const at = now + (this.at || 0);
    if (at - this.lastAt < 0.018 && at >= this.lastAt) return;   // a burst of hits is one knock
    this.lastAt = at;
    const { g, pan, d } = this._place(pos.x, pos.y, pos.z);
    if (d > 160) return;
    const hard = Math.min(1, speed / 9);
    const lvl = hard * hard * g * (0.25 + Math.min(1, size * 1.8));
    if (lvl < 0.004) return;
    const small = size < 0.12;
    const dur = small ? 0.05 + 0.04 * Math.random() : 0.08 + size * 0.22;
    const out = this._out(ctx, Math.min(1, lvl), pan, dur + 0.05);
    if (!out) return;
    const t = now + (this.at || 0) + 0.004;
    // pitch from size: a front-wing half knocks low, a splinter ticks
    const f0 = small ? 3800 + Math.random() * 4200 : Math.max(380, 1400 / Math.max(0.25, size * 2)) * (0.85 + Math.random() * 0.3);
    this._burst(ctx, out, t, small ? 0.012 : 0.02, 'bandpass', f0 * 1.6, 1.2, 0.8);
    // plate modes, inharmonic
    for (const [k, a] of [[1, 0.5], [2.32, 0.3], [3.91, 0.2], [5.4, 0.12]]) {
      this._mode(ctx, out, t, f0 * k * (0.98 + Math.random() * 0.04), dur * (1.1 - k * 0.12), a * (small ? 0.7 : 1));
    }
  }
}
