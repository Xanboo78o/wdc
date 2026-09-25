// enginecore.js — an F1 V10, fired one combustion at a time.
//
// Adam, 2026-09-25: "make the sound better ... find out how acc and iracing
// make their f1 cars sound awesome, and listen to some real f1 cars". He chose
// the 2005 V10 scream. ACC and iRacing play RECORDINGS of the real car, cross-
// faded by rpm and load; this project emulates instead (his rule, 2026-09-23:
// the sound should BE the car's physics), so the recordings were MEASURED
// rather than played. Four CC BY-SA recordings from Wikimedia Commons (Edvvc:
// Red Bull RB1 2005 V10, Williams FW18 1996 V10, Brawn BGP001 2009 V8,
// Williams FW32 2010 V8), loud frames only:
//
//   harmonic share of the energy  21-35%   (RB1 21%) — MOST OF IT IS NOISE
//   periodicity (autocorrelation) 0.62-0.69       — no two firings alike
//   spectral slope, 250 Hz-8 kHz  -2.6..+1.3 dB/oct (RB1 +1.3) — bright
//   2-6 kHz noise pulsing at the firing rate  x2.4-3.3 over the floor
//
// The old synth was a periodic wave through filters: ~95% harmonic, perfectly
// repeating, falling off with frequency — an organ, not an engine. So this is
// a firing simulator. Every combustion is an event: a pressure pulse (the
// note) and a burst of noise (the rasp), each jittered in size and timing,
// each cylinder with its own small offsets (that is what gives a real V10 its
// texture under the note), rung through the exhaust's resonances, and
// saturated. Lifting weakens the pulses and lets the overrun crackle; the
// limiter cuts ignition in a stutter.
//
// Pure DSP, no Web Audio: the same class runs in js/engineworklet.js in the
// game and in tools/enginecheck2.mjs in Node, which is how it is measured
// against the numbers above.

// A small biquad (RBJ bandpass / lowpass / highpass), per sample.
class Biquad {
  constructor(type, f, q, sr) { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(type, f, q, sr); }
  set(type, f, q, sr) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === 'bp') { b0 = a; b1 = 0; b2 = -a; }
    else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export const V10 = {
  cyl: 10, idle: 4500, limit: 19000,
  // Exhaust resonances [Hz, Q, gain]: a primary-pipe body, the rasp band, and
  // the top end that makes it cut. Placed to flatten the spectrum the way the
  // recordings are flat (tuned in tools/enginecheck2.mjs).
  pipes: [[1100, 2.2, 1.0], [2600, 2.6, 1.1], [4800, 2.8, 0.75], [7600, 3.0, 0.3]],
  noise: 0.55,        // share of each firing that is a noise burst, on load
  jitterA: 0.34,      // cycle-to-cycle size variation
  jitterT: 0.012,     // cycle-to-cycle timing variation, fraction of a firing gap
  cylSpread: 0.24,    // how different the ten cylinders are from each other
  drive: 2.4,         // saturation
  whineTeeth: 29,
};

export class EngineCore {
  constructor(sr, P = V10, seed = 78) {
    this.sr = sr; this.P = P;
    let s = seed >>> 0;
    this.rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.cylA = Array.from({ length: P.cyl }, () => 1 + (this.rand() * 2 - 1) * P.cylSpread);
    this.cylT = Array.from({ length: P.cyl }, () => (this.rand() * 2 - 1) * P.cylSpread * 0.08);
    this.pipes = P.pipes.map(([f, q, g]) => ({ bq: new Biquad('bp', f, q, sr), g }));
    this.body = new Biquad('lp', 2400, 0.7, sr);
    this.dc = 0;
    this.hiss = new Biquad('hp', 3000, 0.7, sr);
    this.road = new Biquad('lp', 400, 0.6, sr);
    // state
    this.rpm = P.idle; this.thr = 0; this.gain = 0; this.speed = 0;
    this.target = { rpm: P.idle, throttle: 0, gain: 0, speed: 0 };
    this.phase = 0;            // crank phase within the 720-degree cycle, 0..1
    this.next = 0;             // index of the next firing slot
    this.nextAt = this.cylT[0];
    this.pulse = 0;            // current pressure pulse, decaying
    this.burst = 0;            // current noise burst envelope
    this.crackle = 0;          // overrun pops
    this.whineP = 0;
    this.cut = false;
  }

  set(t) { Object.assign(this.target, t); }

  render(out) {
    const P = this.P, sr = this.sr, T = this.target, n = out.length;
    for (let i = 0; i < n; i++) {
      // Smooth the controls per sample: the game updates them per frame.
      this.rpm += (T.rpm - this.rpm) * 0.0009;
      this.thr += (T.throttle - this.thr) * 0.0012;
      this.gain += (T.gain - this.gain) * 0.002;
      this.speed += (T.speed - this.speed) * 0.0005;
      const rpm = Math.max(1500, this.rpm), revs = Math.min(1, rpm / P.limit);
      const fire = rpm / 60 * P.cyl / 2;                     // firings per second
      // one 720-degree cycle = two revolutions
      this.phase += rpm / 60 / 2 / sr;
      if (this.phase >= 1) { this.phase -= 1; this.next = 0; this.nextAt = this.cylT[0] / P.cyl; }
      // LIMITER: ignition cut, roughly every other firing, while at the limit
      this.cut = rpm > P.limit - 150;
      // --- a firing? ------------------------------------------------------
      const slot = (this.next + this.nextAt * P.cyl) / P.cyl;
      if (this.next < P.cyl && this.phase >= slot) {
        const k = this.next;
        this.next++;
        const jit = (this.rand() * 2 - 1) * P.jitterT;
        this.nextAt = this.cylT[this.next % P.cyl] + jit;
        const skip = this.cut && this.rand() < 0.55;
        if (!skip) {
          const load = 0.32 + 0.68 * this.thr;               // overrun still fires, weakly
          const a = this.cylA[k] * (1 + (this.rand() * 2 - 1) * P.jitterA) * load;
          this.pulse += a;
          this.burst = Math.max(this.burst, a * (0.35 + 1.3 * this.rand()));
        } else {
          // a cut cylinder dumps fuel into a hot exhaust: a crack
          this.crackle = Math.max(this.crackle, 0.6 + 0.4 * this.rand());
        }
        // Lifting at high revs: unburnt fuel pops in the pipes, now and then.
        if (this.thr < 0.15 && revs > 0.45 && this.rand() < 0.012) this.crackle = Math.max(this.crackle, 0.4 + 0.6 * this.rand());
      }
      // --- the two halves of a firing ---------------------------------------
      // pressure pulse: decays over about a fifth of a firing gap
      const decP = Math.exp(-1 / (sr * 0.2 / fire));
      const decB = Math.exp(-1 / (sr * Math.min(0.35, 0.16 + 0.19 * (1 - revs)) / fire));   // sharper at high revs: each firing stays its own burst
      const white = this.rand() * 2 - 1;
      const pressure = this.pulse; this.pulse *= decP;
      const rasp = white * this.burst * P.noise * (0.6 + 0.4 * this.thr); this.burst *= decB;
      const pop = white * this.crackle * 1.1; this.crackle *= 0.994;
      // exhaust: the pulse gives the note (body), everything rings the pipes
      let pipes = 0;
      const ex = pressure * 0.8 + rasp + pop;
      for (const p of this.pipes) pipes += p.bq.run(ex) * p.g;
      let x = this.body.run(pressure) * 0.9 + pipes * 1.6;
      // remove DC from the one-sided pulse train
      this.dc += (x - this.dc) * 0.002; x -= this.dc;
      // intake / mechanical hiss, climbing with revs and load
      x += this.hiss.run(white) * 0.03 * revs * (0.4 + 0.6 * this.thr);
      // grit
      x = Math.tanh(P.drive * x) / Math.tanh(P.drive);
      // gear whine: straight-cut gears, loudest off the throttle
      this.whineP += rpm / 60 * P.whineTeeth / 4 / sr;
      if (this.whineP > 1) this.whineP -= 1;
      const moving = Math.min(1, this.speed / 8);
      x += Math.sin(2 * Math.PI * this.whineP) * 0.035 * moving * revs * (1 - 0.6 * this.thr);
      // road: tyres and axles, speed only
      x += this.road.run(white) * 0.25 * Math.pow(Math.min(1, this.speed / 85), 1.3);
      out[i] = x * this.gain * (0.55 + 0.45 * revs);
    }
  }
}
