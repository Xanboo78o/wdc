// synth.js — the adverts' orchestra. Web Audio only, no files.
//
// A score is { bpm, beats, events, reverb } where an event is
//   { t: beat, d: beats, i: instrument, n: midi note, v: 0..1, ...extras }
// (js/ads/score-*.js write them; js/ads/motif.js is where the tune lives).
//
// `Player` plays one against the audio clock, scheduling a little ahead.
// `renderOffline` renders the whole thing to a buffer and MEASURES it, because
// the person who wrote this cannot hear: peak, loudness second by second, and
// whether anything clipped.
const mtof = n => 440 * Math.pow(2, (n - 69) / 12);

class Rack {
  constructor(ctx, { reverb = { seconds: 3.2, wet: 0.5, damp: 0.55 }, gain = 0.8, drive = 0.5 } = {}) {
    this.ctx = ctx;
    const c = ctx;
    this.dry = c.createGain();
    this.wetIn = c.createGain();
    // a hall: decaying noise, darker as it dies — built, not sampled
    const conv = c.createConvolver();
    conv.buffer = impulse(c, reverb.seconds, reverb.damp ?? 0.55);
    const wet = c.createGain(); wet.gain.value = reverb.wet;
    const pre = c.createDelay(0.2); pre.delayTime.value = reverb.pre ?? 0.018;
    this.wetIn.connect(pre); pre.connect(conv); conv.connect(wet);
    // a tempo echo for the instruments that ask for one
    this.echoIn = c.createGain();
    const dl = c.createDelay(2); dl.delayTime.value = reverb.echo ?? 0.375;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl);
    const eo = c.createGain(); eo.gain.value = 0.5; lp.connect(eo);
    // the master: rumble out, glue, a brick wall, and a soft clip that cannot exceed 1
    const sum = c.createGain(); sum.gain.value = drive;      // how hard the mix leans on the compressor
    this.dry.connect(sum); wet.connect(sum); eo.connect(sum); eo.connect(this.wetIn);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 26;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -17; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.24;
    const make = c.createGain(); make.gain.value = 1.25;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.09;
    const clip = c.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < 2049; i++) { const x = (i / 1024 - 1) * 1.3; curve[i] = Math.tanh(x) * 0.98; }
    clip.curve = curve; clip.oversample = '2x';
    this.out = c.createGain(); this.out.gain.value = gain;
    sum.connect(hp); hp.connect(comp); comp.connect(make); make.connect(lim); lim.connect(clip); clip.connect(this.out);
    this.out.connect(c.destination);
    this.noise = noiseBuffer(c);
  }

  // an output stage for one note: level, how much hall, where in the stereo field
  bus(level, send = 0.2, pan = 0, echo = 0) {
    const c = this.ctx, g = c.createGain(); g.gain.value = level;
    let o = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); o = p; }
    o.connect(this.dry);
    if (send > 0) { const s = c.createGain(); s.gain.value = send; o.connect(s); s.connect(this.wetIn); }
    if (echo > 0) { const s = c.createGain(); s.gain.value = echo; o.connect(s); s.connect(this.echoIn); }
    return g;
  }
  osc(type, f, t, end, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.start(t); o.stop(end); return o;
  }
  src(t, end, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    s.start(t, Math.random() * 1.5); s.stop(end); return s;
  }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  play(ev, t, spb) {
    const f = INST[ev.i];
    if (!f) return;
    const dur = Math.max(0.02, (ev.d || 1) * spb);
    f(this, ev, t, dur, ev.n != null ? mtof(ev.n) : 0, ev.v ?? 0.8, spb);
  }
}

function noiseBuffer(c) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  return b;
}
function impulse(c, seconds, damp) {
  const n = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let s = 1234 + ch * 9973, lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const x = s / 1073741823.5 - 1, k = i / n;
      // the tail loses its top end as it goes
      const a = 1 - damp * (0.35 + 0.65 * k);
      lp += (x - lp) * Math.max(0.04, a);
      const early = i < c.sampleRate * 0.06 ? 0.4 + 0.6 * (i / (c.sampleRate * 0.06)) : 1;
      d[i] = lp * Math.pow(1 - k, 2.4) * Math.exp(-3.2 * k) * early;
    }
  }
  // normalise the energy so a long hall is not simply a louder one
  let e = 0; for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) e += d[i] * d[i]; }
  const g = 1 / Math.sqrt(e / 2 + 1e-9);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= g; }
  return b;
}

// envelope helpers -------------------------------------------------------------
const perc = (p, t, peak, decay, a = 0.003) => { p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a); p.setTargetAtTime(0.0001, t + a, decay / 4.6); };
const hold = (p, t, dur, peak, a = 0.05, r = 0.3, s = 1) => {
  p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(peak, t + a);
  if (s < 1) p.setTargetAtTime(peak * s, t + a, 0.25);
  p.setTargetAtTime(0.0001, t + Math.max(a, dur), r / 4);
};

// ------------------------------------------------------------------------------
// THE INSTRUMENTS. (R, event, start, seconds, hertz, velocity, secondsPerBeat)
// ------------------------------------------------------------------------------
export const INST = {
  // a felt piano, far away: the motif alone in the hall
  piano(R, ev, t, dur, f, v) {
    const len = Math.max(dur, 2.6), end = t + len + 0.4, out = R.bus(0.55 * v, ev.send ?? 0.75, ev.pan ?? 0, ev.echo ?? 0.12);
    const lp = R.filt('lowpass', 900 + 2600 * v, 0.5); lp.frequency.setTargetAtTime(700, t + 0.02, 0.9);
    const g = R.gain(); perc(g.gain, t, 1, len * 0.9, 0.004);
    for (const [m, a, det] of [[1, 0.6, -3], [1, 0.5, 4], [2, 0.22, 0], [3, 0.09, 2], [4.02, 0.04, 0]]) {
      const o = R.osc(m === 1 ? 'triangle' : 'sine', f * m, t, end, det), og = R.gain(a); o.connect(og); og.connect(g);
    }
    const th = R.src(t, t + 0.05), tg = R.gain(); perc(tg.gain, t, 0.12, 0.03, 0.001);   // the hammer
    const tf = R.filt('bandpass', f * 3, 1.2); th.connect(tf); tf.connect(tg); tg.connect(lp);
    g.connect(lp); lp.connect(out);
  },
  bell(R, ev, t, dur, f, v) {
    const len = Math.max(dur, 3.2), end = t + len + 0.3, out = R.bus(0.34 * v, ev.send ?? 0.8, ev.pan ?? 0, ev.echo ?? 0.25);
    const car = R.osc('sine', f, t, end), mod = R.osc('sine', f * 3.5, t, end), mg = R.gain();
    mg.gain.setValueAtTime(f * 2.4 * v, t); mg.gain.setTargetAtTime(f * 0.1, t, 0.35);
    mod.connect(mg); mg.connect(car.frequency);
    const g = R.gain(); perc(g.gain, t, 1, len, 0.002);
    const hi = R.osc('sine', f * 2.76, t, end), hg = R.gain(); perc(hg.gain, t, 0.25, 0.6, 0.002);
    car.connect(g); hi.connect(hg); hg.connect(g); g.connect(out);
  },
  // strings held: three saws a few cents apart behind a slow filter
  pad(R, ev, t, dur, f, v) {
    const a = ev.a ?? 0.7, r = ev.r ?? 1.2, end = t + dur + r * 2.5, out = R.bus(0.2 * v, ev.send ?? 0.55, ev.pan ?? 0);
    const lp = R.filt('lowpass', 500, 0.6);
    lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(ev.bright ?? 1700, t + Math.min(dur, a * 2.2));
    lp.frequency.setTargetAtTime(420, t + dur, r / 3);
    const g = R.gain(); hold(g.gain, t, dur, 1, a, r);
    for (const det of [-9, 0, 8]) { const o = R.osc('sawtooth', f, t, end, det); o.connect(lp); }
    const sub = R.osc('sine', f / 2, t, end), sg = R.gain(0.35); sub.connect(sg); sg.connect(g);
    lp.connect(g); g.connect(out);
  },
  // voices: saws through three formants
  choir(R, ev, t, dur, f, v) {
    const a = ev.a ?? 0.9, r = ev.r ?? 1.6, end = t + dur + r * 2.5, out = R.bus(0.2 * v, ev.send ?? 0.8, ev.pan ?? 0);
    const g = R.gain(); hold(g.gain, t, dur, 1, a, r);
    const mix = R.gain(1);
    for (const det of [-11, -3, 5, 12]) { const o = R.osc('sawtooth', f, t, end, det); o.connect(mix); }
    const vib = R.osc('sine', 5.1, t, end), vg = R.gain(f * 0.004); vib.connect(vg);
    for (const [ff, q, lv] of [[640, 5, 1], [1150, 7, 0.55], [2700, 8, 0.2]]) {
      const b = R.filt('bandpass', ff, q), bg = R.gain(lv); mix.connect(b); b.connect(bg); bg.connect(g);
    }
    g.connect(out);
  },
  // low strings played short: the engine of the ostinato
  cello(R, ev, t, dur, f, v) {
    const len = Math.min(Math.max(dur * 0.9, 0.09), 0.5), end = t + len + 0.35, out = R.bus(0.34 * v, ev.send ?? 0.3, ev.pan ?? -0.15);
    const lp = R.filt('lowpass', 500, 1.2);
    lp.frequency.setValueAtTime(500 + 2600 * v, t); lp.frequency.setTargetAtTime(520, t + 0.01, 0.07);
    const g = R.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.008); g.gain.setTargetAtTime(0.0001, t + len, 0.05);
    for (const det of [-6, 6]) { const o = R.osc('sawtooth', f, t, end, det); o.connect(lp); }
    const bow = R.src(t, t + 0.04), bg = R.gain(); perc(bg.gain, t, 0.2, 0.03, 0.001); bow.connect(bg); bg.connect(lp);
    lp.connect(g); g.connect(out);
  },
  // the full statement: stacked saws, a filter that opens like a breath
  brass(R, ev, t, dur, f, v) {
    const r = 0.28, end = t + dur + r * 3, out = R.bus(0.3 * v, ev.send ?? 0.45, ev.pan ?? 0.1);
    const lp = R.filt('lowpass', 400, 1.1);
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(900 + 3600 * v, t + 0.07);
    lp.frequency.setTargetAtTime(700 + 1400 * v, t + 0.09, 0.3); lp.frequency.setTargetAtTime(300, t + dur, r / 3);
    const g = R.gain(); hold(g.gain, t, dur, 1, 0.035, r, 0.8);
    for (const [m, det, a] of [[1, -7, 1], [1, 7, 1], [1, 0, 0.8], [0.5, 0, 0.7], [2, 3, 0.25]]) {
      const o = R.osc('sawtooth', f * m, t, end, det), og = R.gain(a); o.connect(og); og.connect(lp);
    }
    lp.connect(g); g.connect(out);
  },
  // the floor dropping away
  sub(R, ev, t, dur, f, v) {
    const len = Math.max(dur, 1.5), end = t + len + 0.6, out = R.bus(0.85 * v, ev.send ?? 0.05);
    const o = R.osc('sine', f, t, end);
    o.frequency.setValueAtTime(f * (ev.drop ?? 2.6), t); o.frequency.exponentialRampToValueAtTime(f, t + (ev.dropT ?? 0.22));
    const g = R.gain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.012); g.gain.setTargetAtTime(0.0001, t + 0.05, len / 3.4);
    const sh = R.ctx.createWaveShaper(), cv = new Float32Array(257);
    for (let i = 0; i < 257; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 2.2); } sh.curve = cv;
    o.connect(sh); sh.connect(g); g.connect(out);
  },
  drone(R, ev, t, dur, f, v) {
    const end = t + dur + 3, out = R.bus(0.3 * v, ev.send ?? 0.4);
    const g = R.gain(); hold(g.gain, t, dur, 1, ev.a ?? 2, ev.r ?? 2);
    const lp = R.filt('lowpass', 240, 0.5);
    for (const [m, det, a] of [[1, 0, 1], [2, 5, 0.4], [1.5, -4, 0.14]]) { const o = R.osc(m === 1 ? 'sine' : 'sawtooth', f * m, t, end, det), og = R.gain(a); o.connect(og); og.connect(lp); }
    lp.connect(g); g.connect(out);
  },
  // the trailer hit: a sub thump under a crack of noise, in the hall
  boom(R, ev, t, dur, f, v) {
    const out = R.bus(0.95 * v, ev.send ?? 0.6);
    const o = R.osc('sine', 46, t, t + 2.6); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    const g = R.gain(); perc(g.gain, t, 1, 1.9, 0.004);
    const n = R.src(t, t + 1.2), nf = R.filt('lowpass', 2400, 0.4), ng = R.gain(); nf.frequency.setTargetAtTime(160, t, 0.16); perc(ng.gain, t, 0.9, 0.7, 0.002);
    o.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); g.connect(out);
  },
  taiko(R, ev, t, dur, f, v) {
    const base = ev.lo ? 62 : 86, out = R.bus(0.7 * v, ev.send ?? 0.4, ev.pan ?? 0);
    const o = R.osc('sine', base, t, t + 0.9); o.frequency.setValueAtTime(base * 2.3, t); o.frequency.exponentialRampToValueAtTime(base, t + 0.07);
    const g = R.gain(); perc(g.gain, t, 1, 0.5, 0.002);
    const n = R.src(t, t + 0.12), nf = R.filt('bandpass', 900, 0.8), ng = R.gain(); perc(ng.gain, t, 0.5, 0.06, 0.001);
    o.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); g.connect(out);
  },
  snare(R, ev, t, dur, f, v) {
    const out = R.bus(0.4 * v, ev.send ?? 0.45, ev.pan ?? 0.1);
    const n = R.src(t, t + 0.3), nf = R.filt('bandpass', 2300, 0.6), g = R.gain(); perc(g.gain, t, 1, 0.16, 0.001);
    const o = R.osc('triangle', 190, t, t + 0.2), og = R.gain(); perc(og.gain, t, 0.5, 0.08, 0.001);
    n.connect(nf); nf.connect(g); o.connect(og); og.connect(g); g.connect(out);
  },
  hat(R, ev, t, dur, f, v) {
    const out = R.bus(0.14 * v, ev.send ?? 0.1, ev.pan ?? 0.3);
    const n = R.src(t, t + 0.12), nf = R.filt('highpass', 7200, 0.7), g = R.gain(); perc(g.gain, t, 1, ev.open ? 0.12 : 0.035, 0.001);
    n.connect(nf); nf.connect(g); g.connect(out);
  },
  // air being pulled into the cut
  riser(R, ev, t, dur, f, v) {
    const end = t + dur + 0.05, out = R.bus(0.34 * v, ev.send ?? 0.5);
    const n = R.src(t, end), bp = R.filt('bandpass', 300, 1.6), g = R.gain();
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur); g.gain.setTargetAtTime(0.0001, t + dur, 0.012);
    n.connect(bp); bp.connect(g);
    const o = R.osc('sawtooth', f || 73, t, end), og = R.gain(), ol = R.filt('lowpass', 1800, 0.7);
    o.frequency.exponentialRampToValueAtTime((f || 73) * 4, t + dur);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.22, t + dur); og.gain.setTargetAtTime(0.0001, t + dur, 0.012);
    o.connect(ol); ol.connect(og); og.connect(g); g.connect(out);
  },
  swell(R, ev, t, dur, f, v) {            // a cymbal played backwards
    const end = t + dur + 0.05, out = R.bus(0.26 * v, ev.send ?? 0.4);
    const n = R.src(t, end), hp = R.filt('highpass', 3200, 0.5), g = R.gain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur); g.gain.setTargetAtTime(0.0001, t + dur, 0.01);
    n.connect(hp); hp.connect(g); g.connect(out);
  },
  // rain on a roof somewhere: a bed of filtered noise
  rain(R, ev, t, dur, f, v) {
    const end = t + dur + 2, out = R.bus(0.11 * v, 0.2);
    const n = R.src(t, end, 1.3), bp = R.filt('bandpass', 3200, 0.35), hp = R.filt('highpass', 900, 0.5), g = R.gain();
    hold(g.gain, t, dur, 1, ev.a ?? 0.8, ev.r ?? 1.5);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
  },
  whoosh(R, ev, t, dur, f, v) {
    const end = t + dur + 0.3, out = R.bus(0.3 * v, ev.send ?? 0.35, ev.pan ?? 0);
    const n = R.src(t, end), bp = R.filt('bandpass', 500, 1.1), g = R.gain();
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(350, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(out);
  },
  // an engine going past: pitch falls as it does
  flyby(R, ev, t, dur, f, v) {
    const end = t + dur + 0.2, out = R.bus(0.3 * v, ev.send ?? 0.3, 0);
    const pk = ev.peak ?? 0.5, f0 = ev.f0 ?? 330, f1 = f0 * (ev.fall ?? 0.62);
    const lp = R.filt('lowpass', 2400, 1.4), g = R.gain();
    for (const [m, ty, a] of [[1, 'sawtooth', 1], [0.5, 'square', 0.5], [1.5, 'sawtooth', 0.3]]) {
      const o = R.osc(ty, f0 * m, t, end), og = R.gain(a);
      o.frequency.setValueAtTime(f0 * m, t); o.frequency.setValueAtTime(f0 * m, t + dur * pk * 0.8);
      o.frequency.exponentialRampToValueAtTime(f1 * m, t + dur * Math.min(0.98, pk * 1.25));
      o.connect(og); og.connect(lp);
    }
    const n = R.src(t, end), ng = R.gain(0.5), nb = R.filt('bandpass', 1500, 0.5); n.connect(nb); nb.connect(ng); ng.connect(lp);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur * pk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (R.ctx.createStereoPanner) {
      const p = R.ctx.createStereoPanner(); p.pan.setValueAtTime(ev.from ?? -0.8, t); p.pan.linearRampToValueAtTime(-(ev.from ?? -0.8), t + dur);
      lp.connect(g); g.connect(p); p.connect(out);
    } else { lp.connect(g); g.connect(out); }
  },

  // ---- the puzzle box ---------------------------------------------------------
  marimba(R, ev, t, dur, f, v) {
    const out = R.bus(0.5 * v, ev.send ?? 0.22, ev.pan ?? -0.1);
    const g = R.gain(); perc(g.gain, t, 1, 0.42 + 60 / f, 0.002);
    const o = R.osc('sine', f, t, t + 1.4), h = R.osc('sine', f * 4, t, t + 0.3), hg = R.gain(); perc(hg.gain, t, 0.3, 0.06, 0.001);
    const k = R.osc('sine', f * 9.2, t, t + 0.06), kg = R.gain(); perc(kg.gain, t, 0.1, 0.012, 0.0005);
    o.connect(g); h.connect(hg); hg.connect(g); k.connect(kg); kg.connect(g); g.connect(out);
  },
  pizz(R, ev, t, dur, f, v) {
    const out = R.bus(0.42 * v, ev.send ?? 0.25, ev.pan ?? 0.15);
    const lp = R.filt('lowpass', 500, 2); lp.frequency.setValueAtTime(600 + 3200 * v, t); lp.frequency.setTargetAtTime(380, t, 0.045);
    const g = R.gain(); perc(g.gain, t, 1, 0.3, 0.002);
    const o = R.osc('sawtooth', f, t, t + 0.9), o2 = R.osc('triangle', f, t, t + 0.9, 5);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
  },
  musicbox(R, ev, t, dur, f, v) {
    const out = R.bus(0.3 * v, ev.send ?? 0.35, ev.pan ?? 0.2, ev.echo ?? 0);
    const g = R.gain(); perc(g.gain, t, 1, 1.1, 0.001);
    for (const [m, a, d] of [[1, 1, 1.1], [2.0, 0.18, 0.5], [5.4, 0.22, 0.12], [8.9, 0.08, 0.05]]) {
      const o = R.osc('sine', f * m, t, t + 1.6), og = R.gain(); perc(og.gain, t, a, d, 0.001); o.connect(og); og.connect(g);
    }
    g.connect(out);
  },
  // a reed: the man from head office
  reed(R, ev, t, dur, f, v) {
    const r = 0.08, end = t + dur + 0.4, out = R.bus(0.2 * v, ev.send ?? 0.22, ev.pan ?? 0);
    const lp = R.filt('lowpass', 1500 + 1200 * v, 1.0), g = R.gain(); hold(g.gain, t, dur * 0.92, 1, 0.03, r);
    const o = R.osc('square', f, t, end), o2 = R.osc('triangle', f * 2, t, end), g2 = R.gain(0.25);
    const vib = R.osc('sine', 5.3, t, end), vg = R.gain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(dur, 0.4));
    vib.connect(vg); vg.connect(o.frequency);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
  },
  tuba(R, ev, t, dur, f, v) {
    const len = Math.min(dur * 0.85, 0.5), end = t + len + 0.3, out = R.bus(0.4 * v, ev.send ?? 0.15, ev.pan ?? 0);
    const lp = R.filt('lowpass', 420, 0.9), g = R.gain(); hold(g.gain, t, len, 1, 0.02, 0.08);
    const o = R.osc('sawtooth', f, t, end), s = R.osc('sine', f, t, end), sg = R.gain(0.8);
    o.connect(lp); s.connect(sg); sg.connect(g); lp.connect(g); g.connect(out);
  },
  // tick and tock: a wooden clock
  tick(R, ev, t, dur, f, v) {
    const hz = ev.tock ? 1180 : 1760, out = R.bus(0.3 * v, ev.send ?? 0.12, ev.pan ?? (ev.tock ? 0.25 : -0.25));
    const o = R.osc('sine', hz, t, t + 0.09), g = R.gain(); perc(g.gain, t, 1, 0.03, 0.0005);
    const o2 = R.osc('sine', hz * 2.71, t, t + 0.05), g2 = R.gain(); perc(g2.gain, t, 0.3, 0.012, 0.0005);
    const n = R.src(t, t + 0.02), nf = R.filt('bandpass', hz * 2, 2), ng = R.gain(); perc(ng.gain, t, 0.35, 0.006, 0.0005);
    o.connect(g); o2.connect(g2); g2.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g); g.connect(out);
  },
  shaker(R, ev, t, dur, f, v) {
    const out = R.bus(0.1 * v, 0.1, 0.35);
    const n = R.src(t, t + 0.09), nf = R.filt('bandpass', 5200, 1.2), g = R.gain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 0.012); g.gain.setTargetAtTime(0.0001, t + 0.014, 0.014);
    n.connect(nf); nf.connect(g); g.connect(out);
  },
  thump(R, ev, t, dur, f, v) {            // a polite kick
    const out = R.bus(0.6 * v, ev.send ?? 0.1);
    const o = R.osc('sine', 52, t, t + 0.4); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.06);
    const g = R.gain(); perc(g.gain, t, 1, 0.22, 0.002); o.connect(g); g.connect(out);
  },
  // the trombone that knows what happened: slides from ev.from to n
  trombone(R, ev, t, dur, f, v) {
    const end = t + dur + 0.5, out = R.bus(0.34 * v, ev.send ?? 0.3, ev.pan ?? -0.05);
    const f0 = ev.from != null ? mtof(ev.from) : f, gl = Math.min(dur * (ev.glide ?? 0.7), dur);
    const lp = R.filt('lowpass', 600, 2.2), g = R.gain(); hold(g.gain, t, dur * 0.95, 1, 0.05, 0.14, 0.85);
    lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(1500, t + 0.12); lp.frequency.setTargetAtTime(520, t + 0.15, dur * 0.4);
    const vib = R.osc('sine', 5.6, t, end), vg = R.gain(); vg.gain.setValueAtTime(0, t + gl * 0.6); vg.gain.linearRampToValueAtTime(f * 0.012, t + dur);
    for (const det of [-5, 5]) {
      const o = R.osc('sawtooth', f0, t, end, det);
      o.frequency.setValueAtTime(f0, t + (ev.wait ?? 0.04)); o.frequency.exponentialRampToValueAtTime(f, t + Math.max(0.05, gl));
      vib.connect(vg); vg.connect(o.frequency); o.connect(lp);
    }
    lp.connect(g); g.connect(out);
  },
  // something landing a long way off
  thud(R, ev, t, dur, f, v) {
    const out = R.bus(0.5 * v, ev.send ?? 0.7);
    const n = R.src(t, t + 0.5), nf = R.filt('lowpass', 520, 0.6), g = R.gain(); perc(g.gain, t, 1, 0.22, 0.003);
    const o = R.osc('sine', 70, t, t + 0.4); o.frequency.exponentialRampToValueAtTime(42, t + 0.2); const og = R.gain(); perc(og.gain, t, 0.9, 0.2, 0.003);
    n.connect(nf); nf.connect(g); o.connect(og); og.connect(g); g.connect(out);
  },
  // a hubcap settling
  clink(R, ev, t, dur, f, v) {
    const out = R.bus(0.14 * v, ev.send ?? 0.6, ev.pan ?? 0.3);
    for (const [hz, a, d] of [[2310, 1, 0.09], [3620, 0.6, 0.06], [5170, 0.3, 0.04]]) {
      const o = R.osc('sine', hz * (ev.k ?? 1), t, t + 0.3), g = R.gain(); perc(g.gain, t, a, d, 0.0005); o.connect(g); g.connect(out);
    }
  },
};
// instruments whose notes are worth starting late if playback begins mid-note
const SUSTAINED = new Set(['pad', 'choir', 'drone', 'riser', 'swell', 'brass', 'reed', 'rain']);

// ------------------------------------------------------------------------------
export class Player {
  constructor(score, from = 0) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.rack = new Rack(this.ctx, score);
    this.spb = 60 / score.bpm;
    this.ev = score.events.slice().sort((a, b) => a.t - b.t);
    this.k = 0;
    this.t0 = this.ctx.currentTime + 0.15 - from;       // audio time at which the film's zero falls
    this.from = from;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this._pump = this._pump.bind(this);
    this.timer = setInterval(this._pump, 120);
    this._pump();
  }
  time() { return this.ctx.currentTime - this.t0; }
  _pump() {
    const horizon = this.time() + 0.6;
    while (this.k < this.ev.length && this.ev[this.k].t * this.spb < horizon) {
      const e = this.ev[this.k++], at = e.t * this.spb, end = at + (e.d || 1) * this.spb;
      if (at >= this.from - 0.02) this.rack.play(e, this.t0 + Math.max(at, this.time() + 0.01), this.spb);
      else if (SUSTAINED.has(e.i) && end > this.from + 0.3) {
        this.rack.play({ ...e, d: (end - this.from) / this.spb }, this.t0 + this.from + 0.02, this.spb);
      }
    }
  }
  stop() {
    clearInterval(this.timer);
    try { this.rack.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); } catch { /* closing anyway */ }
    const c = this.ctx; setTimeout(() => c.close().catch(() => {}), 200);
  }
}

/** Render the whole score and measure it. */
export async function renderOffline(score, seconds, { wav = false } = {}) {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const rack = new Rack(ctx, score), spb = 60 / score.bpm;
  let n = 0;
  for (const e of score.events) { rack.play(e, 0.05 + e.t * spb, spb); n++; }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
  let peak = 0, sum = 0, clipped = 0, dc = 0;
  const perSec = [];
  for (let s = 0; s < Math.floor(seconds); s++) {
    let e = 0, pk = 0;
    for (let i = s * sr; i < (s + 1) * sr; i++) {
      const a = L[i], b = Rr[i], m = Math.max(Math.abs(a), Math.abs(b));
      e += (a * a + b * b) / 2; if (m > pk) pk = m; if (m >= 0.999) clipped++; dc += a;
    }
    sum += e; if (pk > peak) peak = pk;
    perSec.push({ s, rms: +(10 * Math.log10(e / sr + 1e-12)).toFixed(1), peak: +pk.toFixed(3) });
  }
  const out = {
    events: n, seconds, peak: +peak.toFixed(3), peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1),
    rmsDb: +(10 * Math.log10(sum / (sr * Math.floor(seconds)) + 1e-12)).toFixed(1), clipped, dc: +(dc / L.length).toFixed(5), perSec,
  };
  if (wav) {
    // 22.05 kHz mono 16-bit, small enough to hand back as text
    const m = Math.floor(L.length / 2), pcm = new Int16Array(m);
    for (let i = 0; i < m; i++) pcm[i] = Math.max(-32767, Math.min(32767, Math.round((L[i * 2] + Rr[i * 2] + L[i * 2 + 1] + Rr[i * 2 + 1]) * 0.25 * 32767)));
    const head = new DataView(new ArrayBuffer(44)), W = (o, s) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); head.setUint32(4, 36 + m * 2, true); W(8, 'WAVEfmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
    head.setUint32(24, 22050, true); head.setUint32(28, 44100, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); W(36, 'data'); head.setUint32(40, m * 2, true);
    const bytes = new Uint8Array(44 + m * 2); bytes.set(new Uint8Array(head.buffer), 0); bytes.set(new Uint8Array(pcm.buffer), 44);
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    out.wav = btoa(bin);
  }
  return out;
}
