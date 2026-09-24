// enginesynth.js — the engine, EMULATED rather than played back.
//
// Adam, on the recorded loop: "a f1 car is high pitched wweeeoeoeommmmmm not
// brrbrbrbtbbrrtpoprbbrbrbrbpop and it js sounds WEAK". Earlier he chose
// "emulate everything, engine included". So the note is built from what the
// engine actually is:
//
//   FIRING FREQUENCY. A four-stroke fires each cylinder once every two turns,
//   so an engine with N cylinders fires N/2 times per revolution. The F1 V6
//   at 15,000 rpm: 250 rev/s x 3 = 750 Hz. That is the scream — and it is why
//   the recorded loop could never be it: it was a low, lumpy engine pitched
//   up, and its pops came along for the ride.
//
//   HARMONICS. A periodic wave with a hand-shaped spectrum of 32 harmonics of
//   that firing note. An F1 car is bright (strong 2nd-6th), a V8 GT3 is
//   rounder with a half-order under it — the cross-plane burble — and a
//   four-cylinder F4 is buzzier and lower.
//
//   LOAD. Throttle opens a lowpass from 3x to ~12x the firing note and raises
//   the level; lifting closes it but keeps an overrun hum (engine braking is
//   loud, not silence).
//
//   TURBO. F1 and F4 are turbocharged: a thin whistle that climbs with boost
//   (revs x throttle).
//
//   BITE. A gentle saturation, not the heavy distortion that made "brbrbr".
//
// Nothing here is a recording. The numbers are measured by
// tools/audiomix.mjs (spectrum + level), because nobody here can hear it.

const PARAMS = {
  f1: {
    fires: 3, level: 1.0,
    // amplitude of harmonic k of the firing note, k = 1..
    harm: [1, 0.72, 0.62, 0.58, 0.42, 0.38, 0.30, 0.24, 0.20, 0.17, 0.14, 0.12, 0.10, 0.085, 0.07, 0.06],
    half: 0.10,              // the order-1.5 component under it (V6 character)
    turbo: 0.02, lp: [2.4, 5.5], sat: 1.5,
    formants: [[1700, 1.4, 3], [3200, 2.0, 1.5]],
  },
  gt3: {
    fires: 4, level: 1.0,
    harm: [1, 0.55, 0.40, 0.34, 0.24, 0.20, 0.15, 0.12, 0.09, 0.07, 0.055, 0.045],
    half: 0.38,              // cross-plane V8 burble
    turbo: 0, lp: [2.2, 6], sat: 1.8,
    formants: [[700, 1.2, 4], [1600, 1.6, 3]],
  },
  f4: {
    fires: 2, level: 0.95,
    harm: [1, 0.80, 0.60, 0.55, 0.40, 0.33, 0.26, 0.20, 0.16, 0.12, 0.10, 0.08],
    half: 0.16,
    turbo: 0.018, lp: [2.4, 6.5], sat: 1.6,
    formants: [[1200, 1.4, 4], [2600, 1.8, 3]],
  },
};

function waveOf(ctx, amps) {
  const n = amps.length + 1;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = amps[k - 1];
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

export class SynthEngine {
  constructor(ctx, out, cls = 'f1') {
    const P = this.P = PARAMS[cls] || PARAMS.f1;
    this.ctx = ctx;
    const now = ctx.currentTime;

    this.osc = ctx.createOscillator(); this.osc.setPeriodicWave(waveOf(ctx, P.harm));
    this.half = ctx.createOscillator(); this.half.setPeriodicWave(waveOf(ctx, [1, 0.5, 0.25]));
    this.halfG = ctx.createGain(); this.halfG.gain.value = P.half;

    this.mix = ctx.createGain();
    this.osc.connect(this.mix);
    this.half.connect(this.halfG); this.halfG.connect(this.mix);

    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 0.8;
    this.mix.connect(this.lp);
    let node = this.lp;
    for (const [f, q, g] of P.formants) {
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking';
      pk.frequency.value = f; pk.Q.value = q; pk.gain.value = g;
      node.connect(pk); node = pk;
    }
    this.sat = ctx.createWaveShaper();
    {
      const N = 1024, c = new Float32Array(N), k = P.sat;
      for (let i = 0; i < N; i++) { const x = i / (N - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
      this.sat.curve = c; this.sat.oversample = '4x';
    }
    node.connect(this.sat);
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.sat.connect(this.out);

    if (P.turbo > 0) {
      this.turbo = ctx.createOscillator(); this.turbo.type = 'sine';
      this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
      this.turbo.connect(this.turboG); this.turboG.connect(this.out);
      this.turbo.start(now);
    }
    this.out.connect(out);
    this.osc.start(now); this.half.start(now);
    this.thr = 0;
  }

  /** `rpm` from the gearbox, `throttle` 0..1, `gain` the master level. */
  update(rpm, throttle, gain, dt = 1 / 60) {
    const P = this.P, t = this.ctx.currentTime;
    const f = Math.max(20, rpm / 60 * P.fires);
    this.osc.frequency.setTargetAtTime(f, t, 0.012);
    this.half.frequency.setTargetAtTime(f / 2, t, 0.012);
    // the pedal is a switch on a keyboard; the sound should not be
    this.thr += (Math.max(0, Math.min(1, throttle)) - this.thr) * Math.min(1, dt * 14);
    const th = this.thr;
    const cut = Math.min(19000, f * (P.lp[0] + (P.lp[1] - P.lp[0]) * Math.pow(th, 0.8)));
    this.lp.frequency.setTargetAtTime(cut, t, 0.02);
    const revs = Math.min(1, rpm / 12000);
    const level = P.level * (0.42 + 0.58 * th) * (0.55 + 0.45 * revs);
    this.out.gain.setTargetAtTime(gain * level, t, 0.02);
    if (this.turbo) {
      const boost = th * revs;
      this.turbo.frequency.setTargetAtTime(1800 + 3000 * boost, t, 0.08);
      this.turboG.gain.setTargetAtTime(gain * P.turbo * boost, t, 0.08);
    }
  }

  silence() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    if (this.turboG) this.turboG.gain.setTargetAtTime(0, t, 0.05);
  }
}
