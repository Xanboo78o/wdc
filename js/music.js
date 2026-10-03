// music.js — the OST engine, brought over from CRUISE's radio. Every song is
// synthesised live in Web Audio: no samples, no mp3s. This file is the instruments (drums,
// basses, the rally-house stab, a Rhodes, brass, organ, Karplus-Strong guitars
// and harps, bells, and the Oo choir by formant synthesis), the mixer (channels,
// sends, sidechain, tape wobble, bit-crush, the master chain) and the sequencer
// (16th-note steps, swing, sections, intensity layers, the race-start cue).
// js/ost.js holds the compositions; ost.html is where they are auditioned.
// Added for CWDC: mando (tremolo mandolin), whistle, twang (the western guitar)
// and a tunable tom decay, which makes the timpani.

// ------------------------------------------------------------------ theory
const NOTE_IDX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const QUAL = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
  mb6: [0, 3, 7, 8], aug: [0, 4, 8], 5: [0, 7], '6/9': [0, 4, 7, 9, 14], 'maj7#11': [0, 4, 7, 11, 18], '7b9': [0, 4, 7, 10, 13],
  mmaj7: [0, 3, 7, 11], 'add11': [0, 4, 7, 17], 'm11': [0, 3, 7, 10, 17], '13': [0, 4, 10, 14, 21],
};
export function midi(name) {                       // 'Ab3' → 56, 'C4' → 60
  const m = /^([A-G][#b]?)(-?\d+)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return NOTE_IDX[m[1]] + 12 * (+m[2] + 1);
}
export function chord(sym, oct = 4) {              // 'Fm7' → [65, 68, 72, 75]; 'G/B' puts B in the bass
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m || !(m[2] in QUAL)) throw new Error('bad chord ' + sym);
  const root = NOTE_IDX[m[1]] + 12 * (oct + 1);
  const notes = QUAL[m[2]].map(i => root + i);
  if (m[3]) { let b = NOTE_IDX[m[3]] + 12 * (oct + 1); while (b >= root) b -= 12; notes.unshift(b); }
  return notes;
}
export const freq = m => 440 * Math.pow(2, (m - 69) / 12);
export const tr = (notes, semis) => notes.map(n => n + semis);

// ------------------------------------------------------------------ helpers
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const CURVES = {};
function shaperCurve(kind, k) {
  const key = kind + k;
  if (CURVES[key]) return CURVES[key];
  const n = 8192, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    if (kind === 'tanh') c[i] = Math.tanh(k * x) / Math.tanh(k);
    else if (kind === 'crush') { const lv = Math.pow(2, k); c[i] = Math.round(x * lv) / lv; }
    else if (kind === 'fold') { let y = x * k; while (y > 1 || y < -1) y = y > 1 ? 2 - y : -2 - y; c[i] = y; }
  }
  return CURVES[key] = c;
}

// Per-instrument mixer defaults: gain, pan, sends, whether the sidechain ducks
// it, whether it goes through the drum bus.
const DEFAULT_MIX = {
  kick:   { g: 0.9, drum: true }, snare: { g: 0.8, drum: true, send: { room: 0.25 } }, clap: { g: 0.72, drum: true, send: { room: 0.35 } },
  hat:    { g: 0.62, pan: 0.18, drum: true }, ohat: { g: 0.52, pan: 0.22, drum: true }, ride: { g: 0.36, pan: 0.3, drum: true, send: { room: 0.2 } },
  crash:  { g: 0.4, drum: true, send: { hall: 0.3 } }, rim: { g: 0.5, pan: -0.2, drum: true }, cowbell: { g: 0.35, pan: -0.25, drum: true, send: { room: 0.15 } },
  conga:  { g: 0.5, pan: -0.35, drum: true, send: { room: 0.2 } }, shaker: { g: 0.42, pan: 0.4, drum: true }, tom: { g: 0.6, drum: true, send: { room: 0.3 } },
  antilag:{ g: 0.7, drum: true, send: { room: 0.3 } }, flutter: { g: 0.5, pan: 0.3, drum: true, send: { room: 0.3 } },
  riser:  { g: 0.5, send: { hall: 0.4 } }, boom: { g: 0.9, drum: true, send: { hall: 0.3 } },
  sub:    { g: 0.45, duck: 1 }, bass808: { g: 0.5, duck: 1 }, hbass: { g: 0.55, duck: 1 }, slap: { g: 0.7, duck: 0.3 },
  stab:   { g: 0.55, duck: 1, send: { room: 0.3, delay: 0.15 }, crush: 11, lp: 9000 },
  pluck:  { g: 0.6, duck: 0.7, send: { room: 0.25, delay: 0.22 }, crush: 9, lp: 7500, chorus: true },
  m1:     { g: 0.6, duck: 0.7, send: { room: 0.28, delay: 0.18 }, crush: 10, lp: 8000, chorus: true },
  rhodes: { g: 0.5, duck: 0.3, send: { room: 0.3 } }, organ: { g: 0.35, pan: 0.25, send: { room: 0.25 } },
  brass:  { g: 0.5, send: { room: 0.3 } }, strings: { g: 0.35, send: { hall: 0.5 } }, pad: { g: 0.35, duck: 1, send: { hall: 0.5 } },
  lead:   { g: 0.45, duck: 0.6, send: { delay: 0.3, hall: 0.2 } }, bell: { g: 0.45, send: { hall: 0.6, delay: 0.2 } }, steel: { g: 0.45, pan: 0.3, send: { room: 0.35 } },
  guitar: { g: 0.55, pan: -0.15, duck: 0.4, send: { room: 0.35, hall: 0.15 }, lp: 5200 }, harp: { g: 0.5, pan: 0.2, duck: 0.4, send: { hall: 0.55 } },
  oo:     { g: 0.5, duck: 1, send: { hall: 0.45, delay: 0.2 } }, oochop: { g: 0.55, duck: 1, send: { room: 0.3, delay: 0.25 }, crush: 10 },
  mando:  { g: 0.5, pan: 0.25, send: { room: 0.3, hall: 0.25 }, lp: 6500 },
  twang:  { g: 0.55, pan: -0.2, send: { hall: 0.6, delay: 0.25 } },
  whistle:{ g: 0.42, send: { hall: 0.55, delay: 0.15 } },
  koto:   { g: 0.55, pan: -0.2, send: { hall: 0.45 } }, tar: { g: 0.5, pan: 0.2, send: { room: 0.35 }, lp: 7000 },
  shaku:  { g: 0.45, send: { hall: 0.6, delay: 0.12 } }, accordion: { g: 0.4, pan: 0.15, send: { room: 0.35 } },
  fiddle: { g: 0.42, pan: -0.1, send: { hall: 0.45 } }, sax: { g: 0.45, pan: 0.1, send: { room: 0.3, hall: 0.2 } },
  upright:{ g: 0.6, duck: 0.3, send: { room: 0.2 } }, brush: { g: 0.5, drum: true, send: { room: 0.25 } },
  dist:   { g: 0.42, pan: -0.25, duck: 0.4, send: { room: 0.2 } }, dist2: { g: 0.42, pan: 0.25, duck: 0.4, send: { room: 0.2 } },
  vinyl:  { g: 1.0 },
};
const DRUM_INSTS = new Set(['brush', 'kick', 'snare', 'clap', 'hat', 'ohat', 'ride', 'crash', 'rim', 'cowbell', 'conga', 'shaker', 'tom', 'antilag', 'flutter', 'boom']);

export class Music {
  constructor(songs, stations) {
    this.songs = songs; this.stations = stations;
    this.enabled = true; this.volume = 0.8;
    this.intensity = 1; this._iSmooth = 1;
    this.station = stations[0].id;
    this.onTrack = null; this.onEnd = null;
    this.flags = {};
    this.playing = null;
    this.lookahead = 0.32;
  }

  // ---------------------------------------------------------------- engine
  start(ctx) {
    if (this.ctx) return this.ctx;
    const AC = ctx || (window.AudioContext || window.webkitAudioContext);
    this.ctx = ctx || new AC({ latencyHint: 'playback' });
    const c = this.ctx;
    this.offline = !!ctx;
    // master: bus → (intensity filter) → tape → comp → soft clip → limiter → out
    this.master = c.createGain(); this.master.gain.value = this.volume;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.clip = c.createWaveShaper(); this.clip.curve = shaperCurve('tanh', 1.15); this.clip.oversample = '2x';
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -8; this.comp.knee.value = 10; this.comp.ratio.value = 2; this.comp.attack.value = 0.006; this.comp.release.value = 0.2;
    this.dcBlock = c.createBiquadFilter(); this.dcBlock.type = 'highpass'; this.dcBlock.frequency.value = 22; this.dcBlock.Q.value = 0.5;
    this.busFilter = c.createBiquadFilter(); this.busFilter.type = 'lowpass'; this.busFilter.frequency.value = 20000; this.busFilter.Q.value = 0.2;
    this.busGain = c.createGain();
    // tape wobble: a short modulated delay
    this.tape = c.createDelay(0.05); this.tape.delayTime.value = 0.006;
    this.tapeLfo = c.createOscillator(); this.tapeLfo.frequency.value = 0.55; this.tapeLfo2 = c.createOscillator(); this.tapeLfo2.frequency.value = 6.3;
    this.tapeDepth = c.createGain(); this.tapeDepth.gain.value = 0; this.tapeDepth2 = c.createGain(); this.tapeDepth2.gain.value = 0;
    this.tapeLfo.connect(this.tapeDepth).connect(this.tape.delayTime); this.tapeLfo2.connect(this.tapeDepth2).connect(this.tape.delayTime);
    this.tapeLfo.start(); this.tapeLfo2.start();
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.8;
    this.busGain.connect(this.busFilter).connect(this.tape).connect(this.dcBlock).connect(this.comp).connect(this.clip).connect(this.limiter).connect(this.master).connect(this.analyser).connect(c.destination);
    // busses
    this.dry = c.createGain(); this.dry.connect(this.busGain);
    this.duck = c.createGain(); this.duck.connect(this.busGain);
    this.drumBus = c.createGain(); this.drumSat = c.createWaveShaper(); this.drumSat.curve = shaperCurve('tanh', 1.5); this.drumSat.oversample = '2x';
    this.drumOut = c.createGain(); this.drumOut.gain.value = 0.7;
    this.drumBus.connect(this.drumSat).connect(this.drumOut).connect(this.busGain);
    // fx returns
    this.fx = {};
    this.fx.room = this.makeReverb(0.55, 0.9); this.fx.hall = this.makeReverb(2.4, 0.35);
    this.fx.delay = this.makeDelay();
    for (const k in this.fx) this.fx[k].out.connect(this.duck);
    // shared buffers
    this.noise = this.makeNoise(2.5);
    this.vinylBuf = this.makeVinyl(4);
    this.ksCache = new Map();
    this.channels = {};
    this.rng = mulberry(1);
    if (!this.offline) { this._timer = setInterval(() => this.tick(), 45); }
    return c;
  }

  makeNoise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    const r = mulberry(7); for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    return b;
  }
  makeVinyl(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate), r = mulberry(11);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { lp += ((r() * 2 - 1) - lp) * 0.08; d[i] = lp * 0.5; if (r() < 0.00045) { const a = (r() * 0.6 + 0.2) * (r() < 0.5 ? 1 : -1); for (let k = 0; k < 40 && i + k < n; k++) d[i + k] += a * Math.exp(-k / 6) * Math.cos(k * 0.9); } }
    }
    return b;
  }
  makeReverb(sec, damp) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate), r = mulberry(23);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n; const e = Math.exp(-t * (3 + damp * 6)) * (1 - Math.exp(-i / 200)); lp += ((r() * 2 - 1) - lp) * (0.35 + 0.5 * (1 - damp)); d[i] = lp * e; }
    }
    const inp = c.createGain(), conv = c.createConvolver(), out = c.createGain();
    conv.normalize = true; conv.buffer = b; out.gain.value = 1.0;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    inp.connect(hp).connect(conv).connect(out);
    return { inp, out };
  }
  makeDelay() {
    const c = this.ctx, inp = c.createGain(), out = c.createGain();
    const l = c.createDelay(2), r = c.createDelay(2), fb = c.createGain(), lp = c.createBiquadFilter();
    fb.gain.value = 0.42; lp.type = 'lowpass'; lp.frequency.value = 3200;
    const pl = c.createStereoPanner(), pr = c.createStereoPanner(); pl.pan.value = -0.6; pr.pan.value = 0.6;
    inp.connect(l); l.connect(pl).connect(out); l.connect(r); r.connect(pr).connect(out); r.connect(lp).connect(fb).connect(l);
    out.gain.value = 0.8;
    return { inp, out, l, r, setTime: t => { l.delayTime.value = t; r.delayTime.value = t; } };
  }

  // a mixer channel per instrument, built from the song's mix over the defaults
  channel(name, song) {
    if (this.channels[name]) return this.channels[name];
    const c = this.ctx, m = { ...(DEFAULT_MIX[name] || { g: 0.5 }), ...((song && song.mix && song.mix[name]) || {}) };
    const inp = c.createGain(); inp.gain.value = m.g;
    let node = inp;
    if (m.crush) { const ws = c.createWaveShaper(); ws.curve = shaperCurve('crush', m.crush); node.connect(ws); node = ws; }
    if (m.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = m.lp; f.Q.value = 0.5; node.connect(f); node = f; }
    if (m.hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = m.hp; node.connect(f); node = f; }
    if (m.chorus) {                                  // a detuned pair either side: the 90s widener
      const sum = c.createGain(), dl = c.createDelay(0.05), dr = c.createDelay(0.05), lfo = c.createOscillator(), lg = c.createGain();
      dl.delayTime.value = 0.011; dr.delayTime.value = 0.017; lfo.frequency.value = 0.9; lg.gain.value = 0.0014; lfo.connect(lg); lg.connect(dl.delayTime); lg.connect(dr.delayTime); lfo.start();
      const pl = c.createStereoPanner(), pr = c.createStereoPanner(); pl.pan.value = -0.6; pr.pan.value = 0.6; const wl = c.createGain(), wr = c.createGain(); wl.gain.value = 0.5; wr.gain.value = 0.5;
      node.connect(sum); node.connect(dl).connect(pl).connect(wl).connect(sum); node.connect(dr).connect(pr).connect(wr).connect(sum); node = sum;
    }
    const pan = c.createStereoPanner(); pan.pan.value = m.pan || 0; node.connect(pan);
    let dest;
    if (m.drum || DRUM_INSTS.has(name)) dest = this.drumBus;
    else if (m.duck) { if (m.duck >= 1) dest = this.duck; else { dest = c.createGain(); const a = c.createGain(), b = c.createGain(); a.gain.value = m.duck; b.gain.value = 1 - m.duck; dest.connect(a).connect(this.duck); dest.connect(b).connect(this.dry); } }
    else dest = this.dry;
    pan.connect(dest);
    const sends = {};
    for (const k in (m.send || {})) { if (!this.fx[k]) continue; const g = c.createGain(); g.gain.value = m.send[k]; pan.connect(g).connect(this.fx[k].inp); sends[k] = g; }
    return this.channels[name] = { inp, pan, sends, m };
  }

  // sidechain: every kick pulls the ducked bus down and lets it back up
  pump(t, depth, release) {
    if (!depth) return;
    const g = this.duck.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value ?? 1, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.012);
    g.linearRampToValueAtTime(1, t + 0.012 + release);
  }

  // ---------------------------------------------------------------- voices
  // helpers: an oscillator that starts and stops itself; an ADSR on a gain
  osc(type, f, t0, t1, detune = 0) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune; o.start(t0); o.stop(t1); return o; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  adsr(g, t, a, d, s, r, dur, peak = 1) {
    const p = g.gain; p.cancelScheduledValues(t); p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
    if (d > 0) p.setTargetAtTime(peak * s, t + a, d / 3);
    const off = t + Math.max(a + 0.005, dur);
    p.setTargetAtTime(0.0001, off, Math.max(0.005, r) / 3);
    return off + r * 1.5 + 0.05;
  }
  noiseSrc(t0, t1) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = 0; s.loopEnd = this.noise.duration; s.start(t0, (t0 * 7.31) % 2); s.stop(t1); return s; }
  bp(f, q) { const b = this.ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; return b; }
  lpf(f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = q; return b; }
  hpf(f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = f; b.Q.value = q; return b; }

  // --- drums ---
  kick(t, v, o = {}) {
    const ch = this.channel('kick', this.song).inp;
    const f0 = o.f0 ?? 190, f1 = o.f1 ?? 46, dec = o.dec ?? 0.42, drive = o.drive ?? 1.6;
    const osc = this.osc('sine', f0, t, t + dec + 0.1);
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + (o.sweep ?? 0.055));
    const g = this.gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    const ws = this.ctx.createWaveShaper(); ws.curve = shaperCurve('tanh', drive);
    if (o.lp) { const lp = this.lpf(o.lp, 0.8); osc.connect(g).connect(ws).connect(lp).connect(ch); }
    else osc.connect(g).connect(ws).connect(ch);
    if (o.click !== 0) { const n = this.noiseSrc(t, t + 0.02), ng = this.gain(0), hp = this.hpf(1800); ng.gain.setValueAtTime(v * (o.click ?? 0.5), t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012); n.connect(hp).connect(ng).connect(ch); }
    if (this.song) this.pump(t, (o.duck ?? this.song.duck ?? 0.4) * v, this.song.duckRelease ?? Math.min(0.3, this.stepDur * 3.2));
  }
  snare(t, v, o = {}) {
    const ch = this.channel('snare', this.song).inp, dec = o.dec ?? 0.2, tone = o.tone ?? 185;
    const n = this.noiseSrc(t, t + dec + 0.1), f = this.bp(o.bpf ?? 1700, 0.7), hp = this.hpf(500), g = this.gain(0);
    g.gain.setValueAtTime(v * (o.snap ?? 0.9), t); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(hp).connect(f).connect(g).connect(ch);
    const osc = this.osc('triangle', tone, t, t + 0.2), og = this.gain(0);
    osc.frequency.setValueAtTime(tone * 1.6, t); osc.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
    og.gain.setValueAtTime(v * (o.body ?? 0.6), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(og).connect(ch);
    if (o.gate) { const n2 = this.noiseSrc(t, t + 0.35), f2 = this.bp(1200, 0.5), g2 = this.gain(0); g2.gain.setValueAtTime(v * 0.35, t + 0.02); g2.gain.setValueAtTime(v * 0.35, t + 0.22); g2.gain.linearRampToValueAtTime(0.0001, t + 0.26); n2.connect(f2).connect(g2).connect(ch); }
  }
  clap(t, v) {
    const ch = this.channel('clap', this.song).inp;
    for (let i = 0; i < 4; i++) { const t0 = t + i * 0.011, n = this.noiseSrc(t0, t0 + 0.03), f = this.bp(1300, 1.2), g = this.gain(0); g.gain.setValueAtTime(v * 0.7, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.012); n.connect(f).connect(g).connect(ch); }
    const n = this.noiseSrc(t + 0.03, t + 0.3), f = this.bp(1500, 0.9), g = this.gain(0); g.gain.setValueAtTime(v * 0.6, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); n.connect(f).connect(g).connect(ch);
  }
  hat(t, v, o = {}) {
    const open = !!o.open, ch = this.channel(open ? 'ohat' : 'hat', this.song).inp, dec = o.dec ?? (open ? 0.3 : 0.045);
    const n = this.noiseSrc(t, t + dec + 0.05), hp = this.hpf(o.hp ?? 7000), f = this.bp(o.f ?? 9500 + (this.rng() - 0.5) * 600, 1.1), g = this.gain(0);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(hp).connect(f).connect(g).connect(ch);
  }
  ride(t, v) { const ch = this.channel('ride', this.song).inp, n = this.noiseSrc(t, t + 0.8), hp = this.hpf(3000), f = this.bp(5600, 2.5), g = this.gain(0); g.gain.setValueAtTime(v * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); n.connect(hp).connect(f).connect(g).connect(ch); const o = this.osc('square', 3450, t, t + 0.15), og = this.gain(0); og.gain.setValueAtTime(v * 0.08, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og).connect(ch); }
  crash(t, v) { const ch = this.channel('crash', this.song).inp, n = this.noiseSrc(t, t + 1.8), hp = this.hpf(2500), f = this.bp(4200, 0.6), g = this.gain(0); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5); n.connect(hp).connect(f).connect(g).connect(ch); }
  rim(t, v) { const ch = this.channel('rim', this.song).inp, o = this.osc('square', 1150, t, t + 0.03), g = this.gain(0); g.gain.setValueAtTime(v * 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); o.connect(g).connect(ch); const n = this.noiseSrc(t, t + 0.02), f = this.bp(2600, 2), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015); n.connect(f).connect(ng).connect(ch); }
  cowbell(t, v, o = {}) { const ch = this.channel('cowbell', this.song).inp, f = this.bp(o.f ?? 1000, 1.6), g = this.gain(0); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (o.dec ?? 0.25)); f.connect(g).connect(ch); for (const fr of [587, 845]) this.osc('square', fr * (o.f ? o.f / 1000 : 1), t, t + 0.35).connect(f); }
  conga(t, v, o = {}) { const ch = this.channel('conga', this.song).inp, f0 = o.hi ? 235 : 172, osc = this.osc('sine', f0, t, t + 0.3), g = this.gain(0); osc.frequency.setValueAtTime(f0 * 1.5, t); osc.frequency.exponentialRampToValueAtTime(f0, t + 0.02); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + (o.hi ? 0.14 : 0.22)); osc.connect(g).connect(ch); const n = this.noiseSrc(t, t + 0.02), nf = this.bp(2200, 1), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012); n.connect(nf).connect(ng).connect(ch); }
  shaker(t, v) { const ch = this.channel('shaker', this.song).inp, n = this.noiseSrc(t, t + 0.12), hp = this.hpf(8500), g = this.gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); n.connect(hp).connect(g).connect(ch); }
  tom(t, v, o = {}) { const ch = this.channel('tom', this.song).inp, f0 = o.f ?? 120, dec = o.dec ?? 0.35, osc = this.osc('sine', f0, t, t + dec + 0.15), g = this.gain(0); osc.frequency.setValueAtTime(f0 * (o.bend ?? 1.8), t); osc.frequency.exponentialRampToValueAtTime(f0, t + 0.06); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dec); osc.connect(g).connect(ch); }
  boom(t, v) { const ch = this.channel('boom', this.song).inp, osc = this.osc('sine', 55, t, t + 1.6), g = this.gain(0); osc.frequency.setValueAtTime(120, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3); osc.connect(g).connect(ch); const n = this.noiseSrc(t, t + 0.4), f = this.lpf(900), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3); n.connect(f).connect(ng).connect(ch); }
  // the rally pair: anti-lag bangs as a fill, turbo flutter as a riser
  antilag(t, v, o = {}) {
    const ch = this.channel('antilag', this.song).inp, n = o.n ?? 4; let tt = t;
    for (let i = 0; i < n; i++) {
      const s = this.noiseSrc(tt, tt + 0.05), f = this.bp(260 + this.rng() * 120, 0.8), g = this.gain(0); g.gain.setValueAtTime(v * (0.8 + this.rng() * 0.4), tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.035); s.connect(f).connect(g).connect(ch);
      const osc = this.osc('sine', 95, tt, tt + 0.1), og = this.gain(0); og.gain.setValueAtTime(v * 0.9, tt); og.gain.exponentialRampToValueAtTime(0.001, tt + 0.07); osc.connect(og).connect(ch);
      tt += 0.05 + this.rng() * 0.06;
    }
  }
  flutter(t, v, o = {}) {
    const ch = this.channel('flutter', this.song).inp, dur = o.dur ?? this.stepDur * 4; let tt = t, gap = 0.032; const f = this.bp(2600, 3);
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(700, t + dur);
    f.connect(ch);
    while (tt < t + dur) { const s = this.noiseSrc(tt, tt + 0.03), g = this.gain(0); g.gain.setValueAtTime(v, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.025); s.connect(g).connect(f); gap *= 1.07; tt += gap; }
  }
  riser(t, v, o = {}) {
    const ch = this.channel('riser', this.song).inp, dur = o.dur ?? this.stepDur * 32, n = this.noiseSrc(t, t + dur + 0.02), f = this.bp(300, 1.2), g = this.gain(0);
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    n.connect(f).connect(g).connect(ch);
  }

  // --- bass ---
  sub(t, v, o) {
    const ch = this.channel('sub', this.song).inp, f = freq(o.note), dur = o.dur;
    const a = this.osc('sine', f, t, t + dur + 0.2), b = this.osc('triangle', f, t, t + dur + 0.2), bg = this.gain(0.25), g = this.gain(0);
    if (o.glide != null) { a.frequency.setValueAtTime(freq(o.glide), t); a.frequency.exponentialRampToValueAtTime(f, t + 0.07); b.frequency.setValueAtTime(freq(o.glide), t); b.frequency.exponentialRampToValueAtTime(f, t + 0.07); }
    this.adsr(g, t, 0.006, 0, 1, 0.06, dur, v);
    a.connect(g); b.connect(bg).connect(g); g.connect(ch);
  }
  bass808(t, v, o) {
    const ch = this.channel('bass808', this.song).inp, f = freq(o.note), dur = o.dur;
    const a = this.osc('sine', f, t, t + dur + 0.3), ws = this.ctx.createWaveShaper(), lp = this.lpf(2200), g = this.gain(0);
    ws.curve = shaperCurve('tanh', o.drive ?? 3.5);
    a.frequency.setValueAtTime(f * 2.2, t); a.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.setTargetAtTime(v * 0.6, t + 0.05, 0.25); g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    a.connect(ws).connect(lp).connect(g).connect(ch);
  }
  hbass(t, v, o) {                                    // rolling house bass: saw + sub-square through a squelchy filter
    const ch = this.channel('hbass', this.song).inp, f = freq(o.note), dur = o.dur;
    const a = this.osc('sawtooth', f, t, t + dur + 0.1), b = this.osc('square', f / 2, t, t + dur + 0.1), bg = this.gain(0.18), flt = this.lpf(300, o.q ?? 5), g = this.gain(0);
    flt.frequency.setValueAtTime(o.cut ?? 2200, t); flt.frequency.exponentialRampToValueAtTime(240, t + (o.fdec ?? 0.13));
    this.adsr(g, t, 0.003, 0, 1, 0.03, dur, v * 0.8);
    a.connect(flt); b.connect(bg).connect(flt);
    if (o.drive) { const ws = this.ctx.createWaveShaper(); ws.curve = shaperCurve('tanh', o.drive); const lp = this.lpf(o.dlp ?? 3200); flt.connect(ws).connect(lp).connect(g).connect(ch); }
    else flt.connect(g).connect(ch);
  }
  slap(t, v, o) {
    const ch = this.channel('slap', this.song).inp, f = freq(o.note), dur = Math.min(o.dur, 0.45), pop = !!o.pop;
    const a = this.osc('sawtooth', f, t, t + dur + 0.15), b = this.osc('square', f, t, t + dur + 0.15), bg = this.gain(0.4), flt = this.lpf(500, pop ? 3 : 1.8), g = this.gain(0);
    flt.frequency.setValueAtTime(pop ? 5200 : 3200, t); flt.frequency.exponentialRampToValueAtTime(pop ? 900 : 420, t + 0.09);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.setTargetAtTime(v * 0.35, t + 0.02, 0.12); g.gain.setTargetAtTime(0.0001, t + dur, 0.025);
    a.connect(flt); b.connect(bg).connect(flt); flt.connect(g).connect(ch);
    const n = this.noiseSrc(t, t + 0.015), nf = this.hpf(pop ? 2500 : 1500), ng = this.gain(0); ng.gain.setValueAtTime(v * (pop ? 0.5 : 0.22), t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.01); n.connect(nf).connect(ng).connect(ch);
  }

  // --- chords / keys ---
  stab(t, v, o) {                                     // THE rally-house stab: bright, short, a little crushed
    const ch = this.channel('stab', this.song).inp, notes = o.notes || [o.note], dur = o.dur, flt = this.lpf(700, 1.4), g = this.gain(0);
    flt.frequency.setValueAtTime(o.cut ?? 7500, t); flt.frequency.exponentialRampToValueAtTime(o.floor ?? 1000, t + 0.2);
    const end = this.adsr(g, t, 0.002, 0.28, 0.18, 0.07, dur, v / Math.sqrt(notes.length));
    flt.connect(g).connect(ch);
    for (const n of notes) {
      const f = freq(n);
      this.osc('sawtooth', f, t, end, -9).connect(flt); this.osc('sawtooth', f, t, end, 9).connect(flt);
      const sq = this.osc('square', f / 2, t, end), sg = this.gain(0.22); sq.connect(sg).connect(flt);
      const ping = this.osc('sine', f * 2, t, t + 0.08), pg = this.gain(0); pg.gain.setValueAtTime(0.25, t); pg.gain.exponentialRampToValueAtTime(0.001, t + 0.05); ping.connect(pg).connect(g);
    }
  }
  pluck(t, v, o) {                                    // the PSX pluck: two saws, a square an octave up, a fast bright filter
    const ch = this.channel('pluck', this.song).inp, notes = o.notes || [o.note], dur = o.dur, flt = this.lpf(1200, 1.8), g = this.gain(0);
    flt.frequency.setValueAtTime(o.cut ?? 9000, t); flt.frequency.exponentialRampToValueAtTime(o.floor ?? 1400, t + (o.fdec ?? 0.11));
    const end = this.adsr(g, t, 0.002, 0.22, 0.12, 0.06, Math.min(dur, o.maxDur ?? 0.35), v / Math.sqrt(notes.length));
    flt.connect(g).connect(ch);
    for (const n of notes) {
      const f = freq(n);
      this.osc('sawtooth', f, t, end, -7).connect(flt); this.osc('sawtooth', f, t, end, 7).connect(flt);
      const sq = this.osc('square', f * 2, t, end), sg = this.gain(0.18); sq.connect(sg).connect(flt);
    }
  }
  m1(t, v, o) {                                       // the house organ (M1 'Organ 2'): drawbar partials, a percussive 2nd, a click
    const ch = this.channel('m1', this.song).inp, notes = o.notes || [o.note], dur = Math.min(o.dur, o.maxDur ?? 0.3), g = this.gain(0);
    let tgt = g; if (o.cut) { const f = this.lpf(o.cut, 1); f.connect(g); tgt = f; }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.55 / Math.sqrt(notes.length), t + 0.004);
    g.gain.setValueAtTime(v * 0.55 / Math.sqrt(notes.length), t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    g.connect(ch);
    const end = t + dur + 0.06;
    for (const n of notes) {
      const f = freq(n);
      for (const [r, a] of [[1, 1], [2, 0.75], [3, 0.55], [4, 0.4], [6, 0.22], [8, 0.14]]) { const os = this.osc('sine', f * r, t, end), og = this.gain(a); os.connect(og).connect(tgt); }
      const perc = this.osc('sine', f * 3, t, t + 0.25), pg = this.gain(0); pg.gain.setValueAtTime(0.9, t); pg.gain.exponentialRampToValueAtTime(0.001, t + 0.18); perc.connect(pg).connect(tgt);
    }
    const n = this.noiseSrc(t, t + 0.01), nf = this.bp(2600, 1.2), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.2, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.006); n.connect(nf).connect(ng).connect(ch);
  }
  rhodes(t, v, o) {                                   // DX-style electric piano: FM bark + a tine
    const ch = this.channel('rhodes', this.song).inp, notes = o.notes || [o.note], dur = o.dur;
    for (const n of notes) {
      const f = freq(n), p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-0.5, Math.min(0.5, (n - 60) / 30));
      const car = this.osc('sine', f, t, t + dur + 1.2), mod = this.osc('sine', f, t, t + dur + 1.2), mg = this.gain(0), g = this.gain(0);
      mg.gain.setValueAtTime(f * (1.2 + 2.2 * v), t); mg.gain.setTargetAtTime(f * 0.25, t, 0.18);
      mod.connect(mg).connect(car.frequency);
      const tine = this.osc('sine', f * 7, t, t + 0.2), tg = this.gain(0); tg.gain.setValueAtTime(v * 0.12, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.7, t + 0.004); g.gain.setTargetAtTime(v * 0.12, t + 0.01, 0.5); g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
      car.connect(g); tine.connect(tg).connect(g); g.connect(p).connect(ch);
    }
  }
  organ(t, v, o) {                                    // drawbars + key click; the reggae skank lives here
    const ch = this.channel('organ', this.song).inp, notes = o.notes || [o.note], dur = o.dur;
    const g = this.gain(0); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5 / Math.sqrt(notes.length), t + 0.006); g.gain.setValueAtTime(v * 0.5 / Math.sqrt(notes.length), t + dur - 0.01); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.012);
    g.connect(ch);
    const lfo = this.osc('sine', 6.2, t, t + dur + 0.1), lg = this.gain(4); lfo.connect(lg);
    for (const n of notes) { const f = freq(n); for (const [r, a] of [[1, 1], [2, 0.55], [3, 0.3], [4, 0.2], [0.5, 0.4]]) { const os = this.osc('sine', f * r, t, t + dur + 0.05), og = this.gain(a); lg.connect(os.detune); os.connect(og).connect(g); } }
    const n = this.noiseSrc(t, t + 0.01), nf = this.bp(3000, 1), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.15, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.006); n.connect(nf).connect(ng).connect(ch);
  }
  brass(t, v, o) {
    const ch = this.channel('brass', this.song).inp, notes = o.notes || [o.note], dur = o.dur, short = dur < 0.3;
    const flt = this.lpf(400, 1.1), g = this.gain(0);
    flt.frequency.setValueAtTime(350, t); flt.frequency.linearRampToValueAtTime(1800 + 2600 * v, t + (short ? 0.03 : 0.07)); flt.frequency.setTargetAtTime(1500 + 1200 * v, t + 0.12, 0.25);
    const end = this.adsr(g, t, short ? 0.012 : 0.05, 0, 1, short ? 0.05 : 0.12, dur, v * 0.55 / Math.sqrt(notes.length));
    flt.connect(g).connect(ch);
    const lfo = this.osc('sine', 5.4, t, end), lg = this.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(short ? 0 : 14, t + 0.35); lfo.connect(lg);
    for (const n of notes) { const f = freq(n); for (const d of [-11, 0, 12]) { const os = this.osc('sawtooth', f, t, end, d); lg.connect(os.detune); os.connect(flt); } }
  }
  strings(t, v, o) {
    const ch = this.channel(o.pad ? 'pad' : 'strings', this.song).inp, notes = o.notes || [o.note], dur = o.dur;
    const flt = this.lpf(o.pad ? 1300 : 2800, 0.6), g = this.gain(0);
    if (o.pad) { flt.frequency.setValueAtTime(600, t); flt.frequency.linearRampToValueAtTime(1800, t + Math.min(dur, 2.5)); }
    const end = this.adsr(g, t, o.a ?? 0.35, 0, 1, o.r ?? 0.6, dur, v * 0.3 / Math.sqrt(notes.length));
    const lfo = this.osc('sine', 0.7, t, end), lg = this.gain(0.0016); lfo.connect(lg);
    const dl = this.ctx.createDelay(0.05), dr = this.ctx.createDelay(0.05); dl.delayTime.value = 0.012; dr.delayTime.value = 0.019; lg.connect(dl.delayTime); lg.connect(dr.delayTime);
    const pl = this.ctx.createStereoPanner(), pr = this.ctx.createStereoPanner(); pl.pan.value = -0.55; pr.pan.value = 0.55;
    flt.connect(g); g.connect(dl).connect(pl).connect(ch); g.connect(dr).connect(pr).connect(ch); g.connect(ch);
    for (const n of notes) { const f = freq(n); this.osc('sawtooth', f, t, end, -13).connect(flt); this.osc('sawtooth', f, t, end, 12).connect(flt); }
  }
  lead(t, v, o) {
    const ch = this.channel('lead', this.song).inp, f = freq(o.note), dur = o.dur, flt = this.lpf(2000, 2), g = this.gain(0);
    flt.frequency.setValueAtTime(o.cut ?? 6500, t); flt.frequency.exponentialRampToValueAtTime(1900, t + 0.18);
    const end = this.adsr(g, t, 0.008, 0, 1, 0.1, dur, v * 0.4);
    flt.connect(g).connect(ch);
    for (const d of [-16, 0, 16]) { const os = this.osc('sawtooth', f, t, end, d); if (o.glide != null) { os.frequency.setValueAtTime(freq(o.glide), t); os.frequency.exponentialRampToValueAtTime(f, t + 0.06); } os.connect(flt); }
    const sq = this.osc('square', f / 2, t, end), sg = this.gain(0.3); sq.connect(sg).connect(flt);
  }
  bell(t, v, o) {
    const ch = this.channel('bell', this.song).inp, notes = o.notes || [o.note];
    for (const n of notes) {
      const f = freq(n), car = this.osc('sine', f, t, t + 2.4), mod = this.osc('sine', f * 3.5, t, t + 2.4), mg = this.gain(0), g = this.gain(0);
      mg.gain.setValueAtTime(f * 1.8, t); mg.gain.setTargetAtTime(f * 0.1, t, 0.25); mod.connect(mg).connect(car.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.45, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      car.connect(g).connect(ch);
      const hi = this.osc('sine', f * 2.76, t, t + 0.6), hg = this.gain(0); hg.gain.setValueAtTime(v * 0.12, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.5); hi.connect(hg).connect(ch);
    }
  }
  steel(t, v, o) {
    const ch = this.channel('steel', this.song).inp, notes = o.notes || [o.note];
    for (const n of notes) {
      const f = freq(n), g = this.gain(0); g.connect(ch);
      for (const [r, a, d] of [[1, 1, 1.1], [2, 0.5, 0.45], [3.01, 0.25, 0.22], [4.2, 0.12, 0.12]]) { const os = this.osc('sine', f * r, t, t + d + 0.1), og = this.gain(0); og.gain.setValueAtTime(v * 0.5 * a, t); og.gain.exponentialRampToValueAtTime(0.001, t + d); os.connect(og).connect(g); }
      const car = this.osc('sine', f, t, t + 0.3), mod = this.osc('sine', f * 2, t, t + 0.3), mg = this.gain(0), cg = this.gain(0); mg.gain.setValueAtTime(f * 2.5, t); mg.gain.exponentialRampToValueAtTime(1, t + 0.12); mod.connect(mg).connect(car.frequency); cg.gain.setValueAtTime(v * 0.3, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.15); car.connect(cg).connect(g);
      g.gain.value = 1;
    }
  }

  // --- plucked strings: Karplus-Strong rendered into cached buffers ---
  pluckBuffer(kind, m) {
    const key = kind + ':' + m; if (this.ksCache.has(key)) return this.ksCache.get(key);
    const sr = this.ctx.sampleRate, f = freq(m), N = Math.max(2, Math.round(sr / f));
    const T = { harp: 2.6, guitar: 1.5, twang: 2.4, mando: 0.7, koto: 2.2, tar: 1.0 }[kind] ?? 0.9, len = Math.floor(sr * T), b = this.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const rho = Math.pow(0.015, 1 / (T * f)), r = mulberry(m * 131 + (kind === 'harp' ? 7 : 3));
    const blend = kind === 'harp' ? 0.5 : kind === 'guitar' ? 0.5 : 0.5;    // averaging = the string's own lowpass
    let lp = 0; const bright = { harp: 0.9, guitar: 0.55, twang: 0.8, mando: 0.95, koto: 0.85, tar: 0.97 }[kind] ?? 0.3;
    for (let i = 0; i < N; i++) { const w = r() * 2 - 1; lp += (w - lp) * bright; d[i] = lp; }
    for (let i = N; i < len; i++) d[i] = rho * (blend * d[i - N] + (1 - blend) * (i - N - 1 >= 0 ? d[i - N - 1] : 0));
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i])); if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
    this.ksCache.set(key, b); return b;
  }
  ks(kind, t, v, o) {
    const ch = this.channel(kind, this.song).inp, notes = o.notes || [o.note], strum = o.strum ?? (kind === 'guitar' ? 0.014 : 0.03);
    notes.forEach((n, i) => {
      const t0 = t + i * strum, s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer(kind, n);
      const g = this.gain(0); g.gain.setValueAtTime(v * (kind === 'harp' ? 0.5 : 0.6), t0); if (o.dur) g.gain.setTargetAtTime(0.0001, t0 + o.dur, 0.05);
      s.connect(g).connect(ch); s.start(t0); s.stop(t0 + s.buffer.duration);
    });
  }
  guitar(t, v, o) { this.ks('guitar', t, v, o); }
  harp(t, v, o) { this.ks('harp', t, v, o); }
  // the western guitar: a bright string through a slow surf tremolo, a little bend into the note
  twang(t, v, o) {
    const ch = this.channel('twang', this.song).inp, notes = o.notes || [o.note];
    const trem = this.gain(1), lfo = this.osc('sine', o.trem ?? 5.5, t, t + 2.6), lg = this.gain(o.tremDepth ?? 0.35);
    lfo.connect(lg).connect(trem.gain); trem.connect(ch);
    notes.forEach((n, i) => {
      const t0 = t + i * (o.strum ?? 0.02), s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer('twang', n);
      s.playbackRate.setValueAtTime(o.bend ? Math.pow(2, -o.bend / 12) : 1, t0); if (o.bend) s.playbackRate.linearRampToValueAtTime(1, t0 + 0.09);
      const g = this.gain(0); g.gain.setValueAtTime(v * 0.6, t0); if (o.dur) g.gain.setTargetAtTime(0.0001, t0 + o.dur, 0.12);
      s.connect(g).connect(trem); s.start(t0); s.stop(t0 + s.buffer.duration);
    });
  }
  // the mandolin: re-picked as a tremolo for as long as the note lasts (o.trem = seconds per pick, 0 = one pick)
  mando(t, v, o) {
    const ch = this.channel('mando', this.song).inp, notes = o.notes || [o.note], dur = o.dur, per = o.trem ?? 0;
    const picks = per > 0 ? Math.max(1, Math.floor(dur / per)) : 1;
    for (let k = 0; k < picks; k++) {
      const tk = t + k * per, vk = v * (k % 2 ? 0.72 : 0.9) * (0.9 + this.rng() * 0.2) * (k === 0 ? 1.15 : 1);
      notes.forEach((n, i) => {
        const s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer('mando', n);
        const t0 = tk + i * 0.006, g = this.gain(0); g.gain.setValueAtTime(vk * 0.5 / Math.sqrt(notes.length), t0);
        g.gain.setTargetAtTime(0.0001, t0 + (per > 0 ? per * 1.6 : dur), 0.04);
        s.connect(g).connect(ch); s.start(t0); s.stop(t0 + s.buffer.duration);
      });
    }
  }
  // the koto: a bright silk string; o.bend = semitones pressed up behind the bridge and released
  koto(t, v, o) {
    const ch = this.channel('koto', this.song).inp, notes = o.notes || [o.note];
    notes.forEach((n, i) => {
      const t0 = t + i * (o.strum ?? 0.03), s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer('koto', n);
      if (o.bend) { s.playbackRate.setValueAtTime(1, t0 + 0.08); s.playbackRate.linearRampToValueAtTime(Math.pow(2, o.bend / 12), t0 + 0.22); }
      const g = this.gain(0); g.gain.setValueAtTime(v * 0.6, t0); if (o.dur) g.gain.setTargetAtTime(0.0001, t0 + o.dur + 0.3, 0.15);
      s.connect(g).connect(ch); s.start(t0); s.stop(t0 + s.buffer.duration);
    });
  }
  // the tar (Azerbaijan): mando's bright cousin, picked fast; o.trem like mando
  tar(t, v, o) {
    const ch = this.channel('tar', this.song).inp, notes = o.notes || [o.note], dur = o.dur, per = o.trem ?? 0;
    const picks = per > 0 ? Math.max(1, Math.floor(dur / per)) : 1;
    for (let k = 0; k < picks; k++) {
      const tk = t + k * per, vk = v * (k % 2 ? 0.75 : 0.95) * (0.9 + this.rng() * 0.2);
      for (const n of notes) {
        const s = this.ctx.createBufferSource(); s.buffer = this.pluckBuffer('tar', n);
        if (o.glide != null && k === 0) { s.playbackRate.setValueAtTime(Math.pow(2, (o.glide - n) / 12), tk); s.playbackRate.linearRampToValueAtTime(1, tk + 0.07); }
        const g = this.gain(0); g.gain.setValueAtTime(vk * 0.55 / Math.sqrt(notes.length), tk); g.gain.setTargetAtTime(0.0001, tk + (per > 0 ? per * 1.5 : dur), 0.05);
        s.connect(g).connect(ch); s.start(tk); s.stop(tk + s.buffer.duration);
      }
    }
  }
  // a blown or bowed voice: a source through a body filter, vibrato blooming, breath on top.
  // kind: 'shaku' (shakuhachi: breathy, airy, scoops), 'fiddle' (kamancha: bowed, nasal), 'sax' (reedy, growls a little)
  blown(kind, t, v, o) {
    const ch = this.channel(kind, this.song).inp, f = freq(o.note), dur = o.dur, g = this.gain(0);
    const atk = kind === 'fiddle' ? 0.09 : kind === 'shaku' ? 0.06 : 0.03;
    const end = this.adsr(g, t, atk, 0, 1, kind === 'shaku' ? 0.2 : 0.12, dur, v * 0.45);
    const src = this.osc(kind === 'shaku' ? 'triangle' : 'sawtooth', f, t, end);
    const from = o.glide != null ? freq(o.glide) : f * Math.pow(2, (kind === 'shaku' ? -1 : -0.4) / 12);
    src.frequency.setValueAtTime(from, t); src.frequency.exponentialRampToValueAtTime(f, t + (o.glide != null ? 0.12 : 0.07));
    const lfo = this.osc('sine', kind === 'fiddle' ? 6.2 : 5, t, end), lg = this.gain(0);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.35 ? (kind === 'fiddle' ? 28 : 18) : 4, t + Math.min(0.5, dur)); lfo.connect(lg).connect(src.detune);
    const body = kind === 'shaku' ? this.lpf(f * 3, 0.7) : kind === 'fiddle' ? this.bp(Math.min(2400, f * 2.2), 1.2) : this.bp(Math.min(1800, f * 1.8), 0.9);
    src.connect(body).connect(g);
    if (kind === 'sax') { const ws = this.ctx.createWaveShaper(); ws.curve = shaperCurve('tanh', 2.2); const lp = this.lpf(3500); src.connect(ws).connect(lp).connect(this.gain(0.25)).connect(g); }
    if (kind === 'fiddle') { const b2 = this.bp(f * 4, 2); src.connect(b2).connect(this.gain(0.35)).connect(g); }
    const br = this.noiseSrc(t, end), bf = this.bp(kind === 'shaku' ? f * 1.5 : 2500, kind === 'shaku' ? 1.5 : 1), bg = this.gain(kind === 'shaku' ? 0.5 : 0.06);
    if (kind === 'shaku') { bg.gain.setValueAtTime(0.9, t); bg.gain.setTargetAtTime(0.35, t + 0.08, 0.1); }
    br.connect(bf).connect(bg).connect(g);
    g.connect(ch);
  }
  shaku(t, v, o) { this.blown('shaku', t, v, o); }
  fiddle(t, v, o) { this.blown('fiddle', t, v, o); }
  sax(t, v, o) { this.blown('sax', t, v, o); }
  // the accordion: three reeds (one in tune, two a few cents either side — the musette wobble) and the bellows
  accordion(t, v, o) {
    const ch = this.channel('accordion', this.song).inp, notes = o.notes || [o.note], dur = o.dur, g = this.gain(0);
    const end = this.adsr(g, t, 0.04, 0, 1, 0.08, dur, v * 0.4 / Math.sqrt(notes.length));
    const flt = this.lpf(2600, 0.8), trem = this.gain(1); flt.connect(trem).connect(g); g.connect(ch);
    for (const n of notes) { const f = freq(n); for (const [d, w] of [[0, 'square'], [-o.musette || -12, 'sawtooth'], [o.musette || 12, 'sawtooth']]) { const os = this.osc(w, f, t, end, d), og = this.gain(w === 'square' ? 0.35 : 0.3); os.connect(og).connect(flt); } }
    const lfo = this.osc('sine', o.bellows ?? 4.5, t, end), lg = this.gain(0.12); lfo.connect(lg).connect(trem.gain);
  }
  // the upright bass: a thump and a woody body that dies away
  upright(t, v, o) {
    const ch = this.channel('upright', this.song).inp, f = freq(o.note), dur = Math.min(o.dur, 1.2);
    const a = this.osc('sine', f, t, t + dur + 0.3), b = this.osc('triangle', f * 2, t, t + dur + 0.3), bg = this.gain(0.18), g = this.gain(0), lp = this.lpf(900);
    if (o.glide != null) { a.frequency.setValueAtTime(freq(o.glide), t); a.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.setTargetAtTime(v * 0.45, t + 0.02, 0.15); g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
    a.connect(g); b.connect(bg).connect(g); g.connect(lp).connect(ch);
    const n = this.noiseSrc(t, t + 0.03), nf = this.bp(700, 1.5), ng = this.gain(0); ng.gain.setValueAtTime(v * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.025); n.connect(nf).connect(ng).connect(ch);
  }
  // jazz brushes: a swish (o.sweep seconds) or a tap
  brush(t, v, o = {}) {
    const ch = this.channel('brush', this.song).inp, len = o.sweep ?? 0.12, n = this.noiseSrc(t, t + len + 0.1), f = this.bp(o.f ?? 3500, 0.8), g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.5, t + Math.min(0.03, len * 0.4)); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f).connect(g).connect(ch);
  }
  // pop-punk guitar: a driven power chord (root, fifth, octave) through a cab; o.mute = palm-muted chug
  dist(t, v, o) { this.guitarDist(o.side === 2 ? 'dist2' : 'dist', t, v, o); }
  dist2(t, v, o) { this.guitarDist('dist2', t, v, o); }
  guitarDist(name, t, v, o) {
    const ch = this.channel(name, this.song).inp, notes = o.notes || [o.note, o.note + 7, o.note + 12], mute = !!o.mute;
    const dur = mute ? Math.min(o.dur, 0.14) : o.dur, g = this.gain(0), pre = this.gain(1), ws = this.ctx.createWaveShaper(), cab = this.lpf(mute ? 1600 : 3800, 0.9), hp = this.hpf(90);
    ws.curve = shaperCurve('tanh', o.drive ?? 6); ws.oversample = '2x';
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.32, t + 0.004); g.gain.setTargetAtTime(v * (mute ? 0.05 : 0.22), t + 0.01, mute ? 0.04 : 0.4); g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    const end = t + dur + 0.2;
    for (const n of notes) { const f = freq(n); for (const d of [-7, 6]) this.osc('sawtooth', f, t, end, d).connect(pre); }
    pre.connect(ws).connect(hp).connect(cab).connect(g).connect(ch);
  }
  // the whistle: a near-sine with breath, scooping up into each note, vibrato blooming on long ones
  whistle(t, v, o) {
    const ch = this.channel('whistle', this.song).inp, f = freq(o.note), dur = o.dur, g = this.gain(0), end = this.adsr(g, t, 0.035, 0, 1, 0.12, dur, v * 0.5);
    const a = this.osc('sine', f, t, end), h = this.osc('sine', f * 2, t, end), hg = this.gain(0.06);
    const from = o.glide != null ? freq(o.glide) : f * Math.pow(2, -0.6 / 12);
    for (const os of [a]) { os.frequency.setValueAtTime(from, t); os.frequency.exponentialRampToValueAtTime(f, t + (o.glide != null ? 0.09 : 0.05)); }
    h.frequency.setValueAtTime(from * 2, t); h.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05);
    const lfo = this.osc('sine', 5.6, t, end), lg = this.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(dur > 0.4 ? 22 : 6, t + Math.min(0.6, dur)); lfo.connect(lg); lg.connect(a.detune); lg.connect(h.detune);
    a.connect(g); h.connect(hg).connect(g);
    const br = this.noiseSrc(t, end), bf = this.bp(f, 6), bg = this.gain(0.09); br.connect(bf).connect(bg).connect(g);
    g.connect(ch);
  }

  // --- the Oo: formant synthesis. Three bandpass filters shape a buzz into a vowel. ---
  oo(t, v, o) {
    const chop = !!o.chop, ch = this.channel(chop ? 'oochop' : 'oo', this.song).inp, notes = o.notes || [o.note], dur = o.dur;
    const F = { oo: [[325, 8, 1], [700, 10, 0.5], [2530, 12, 0.1]], oh: [[500, 8, 1], [1000, 10, 0.5], [2500, 12, 0.15]], ah: [[720, 8, 1], [1240, 10, 0.55], [2500, 12, 0.2]], ee: [[290, 8, 1], [2300, 12, 0.25], [3000, 14, 0.1]] };
    const shape = F[o.vowel || 'oo'];
    for (const n of notes) {
      const f = freq(n), g = this.gain(0), end = this.adsr(g, t, chop ? 0.006 : (o.a ?? 0.12), 0, 1, chop ? 0.05 : 0.25, dur, v * 0.9 / Math.sqrt(notes.length));
      g.connect(ch);
      const lfo = this.osc('sine', 5.2, t, end), lg = this.gain(0); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(chop ? 4 : 9, t + 0.3); lfo.connect(lg);
      const voices = chop ? 1 : (o.voices ?? 3);
      const sum = this.gain(1 / voices);
      for (let vi = 0; vi < voices; vi++) {
        const det = voices === 1 ? 0 : (vi - (voices - 1) / 2) * 9;
        const src = this.osc('sawtooth', f, t, end, det); lg.connect(src.detune);
        if (chop && o.glide != null) { src.frequency.setValueAtTime(freq(o.glide), t); src.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
        for (const [ff, q, a] of shape) { const b = this.bp(ff, q), bg = this.gain(a); if (chop) { b.frequency.setValueAtTime(ff * 1.5, t); b.frequency.exponentialRampToValueAtTime(ff, t + 0.06); } src.connect(b).connect(bg).connect(sum); }
      }
      const breath = this.noiseSrc(t, end), bf = this.bp(shape[1][0], 2), bg = this.gain(0.035); breath.connect(bf).connect(bg).connect(sum);
      sum.connect(this.lpf(4200)).connect(g);
    }
  }

  vinyl(t, v, o = {}) {
    const ch = this.channel('vinyl', this.song).inp, s = this.ctx.createBufferSource(); s.buffer = this.vinylBuf; s.loop = true;
    const g = this.gain(v * 0.5), lp = this.lpf(o.lp ?? 5000); s.connect(lp).connect(g).connect(ch); s.start(t); s.stop(t + (o.dur ?? 1)); this.live.push(s);
  }

  // ---------------------------------------------------------------- sequencer
  get stepDur() { return 60 / (this.song ? this.song.bpm : 120) / 4; }

  // lay a song out: absolute step ranges per section
  layout(song) {
    let s = 0; const secs = [];
    for (const sec of song.sections) { secs.push({ ...sec, start: s, steps: sec.bars * 16 }); s += sec.bars * 16; }
    return { secs, total: s };
  }

  play(id, opts = {}) {
    const song = this.songs[id]; if (!song) return;
    if (!this.ctx) this.start();
    this.stopSong();
    this.song = song; this.playing = id; this.flags = {}; this.holdCount = 0;
    this.lay = this.layout(song);
    this.rng = mulberry(hash(id));
    this.live = [];
    this.channels = {};
    this.fx.delay.setTime(song.delay ?? this.stepDur * 6);          // dotted eighth by default
    this.tapeDepth.gain.value = (song.tape ?? 0) * 0.0009; this.tapeDepth2.gain.value = (song.tape ?? 0) * 0.00012;
    this.drumOut.gain.value = song.drumLevel ?? 0.7;
    this.drumSat.curve = shaperCurve('tanh', song.drumDrive ?? 1.5);
    const now = this.ctx.currentTime;
    this.pos = opts.startStep ?? 0;
    this.nextTime = (opts.at ?? now + 0.08);
    if (this.pos < 0) { this.nextTime += -this.pos * this.stepDur; this.pos = 0; }
    this.songStart = this.nextTime - this.pos * this.stepDur;
    if (song.vinyl) this.vinylOn(this.nextTime, song.vinyl);
    this.ended = false;
    if (this.onTrack) this.onTrack(song, this.stations.find(s => s.id === song.station));
  }
  vinylOn(t, v) { const s = this.ctx.createBufferSource(); s.buffer = this.vinylBuf; s.loop = true; const ch = this.channel('vinyl', this.song).inp, g = this.gain(v * 0.5), lp = this.lpf(5000); s.connect(lp).connect(g).connect(ch); s.start(t); this.live.push(s); }
  stopSong() {
    if (!this.song) return;
    for (const s of this.live || []) { try { s.stop(); } catch {} }
    // every channel belongs to the song: unplug them and whatever is already
    // scheduled plays into nothing. Reverb tails ring out on their own.
    for (const name in this.channels) { const ch = this.channels[name]; try { ch.pan.disconnect(); } catch {} for (const k in ch.sends) { try { ch.sends[k].disconnect(); } catch {} } }
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t); this.duck.gain.setValueAtTime(1, t);
    this.song = null; this.playing = null; this.channels = {};
  }
  stop() { this.stopSong(); }

  next() { const list = this.stations.find(s => s.id === this.station).songs; const i = list.indexOf(this.playing); this.play(list[(i + 1) % list.length]); }
  setStation(id, andPlay = true) { this.station = id; const st = this.stations.find(s => s.id === id); if (andPlay) this.play(st.songs[0]); }
  nextStation() { const i = this.stations.findIndex(s => s.id === this.station); this.setStation(this.stations[(i + 1) % this.stations.length].id); }
  trigger(flag) { this.flags[flag] = true; }
  toggle() { this.enabled = !this.enabled; if (this.master) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05); return this.enabled; }
  setVolume(v) { this.volume = v; if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  // Restart the current song so its first drop lands exactly `secs` from now.
  cueDrop(secs) {
    if (!this.song) return;
    const d = this.lay.secs.find(s => s.drop) || this.lay.secs[Math.min(2, this.lay.secs.length - 1)];
    const startStep = d.start - Math.round(secs / this.stepDur);
    const at = this.ctx.currentTime + 0.05 + (secs - (d.start - startStep) * this.stepDur);
    this.play(this.playing, { startStep, at });
  }

  // called every frame by the game: smooth the intensity into the bus filter
  update(dt) {
    if (!this.ctx || this.offline) return;
    const k = 1 - Math.exp(-dt / 0.45);
    this._iSmooth += (this.intensity - this._iSmooth) * k;
    const i = this._iSmooth, t = this.ctx.currentTime;
    const f = 700 * Math.pow(20000 / 700, Math.min(1, i / 0.55));
    this.busFilter.frequency.setTargetAtTime(f, t, 0.1);
    this.busGain.gain.setTargetAtTime(0.55 + 0.45 * Math.min(1, i / 0.7), t, 0.1);
  }

  tick() { if (this.ctx) this.tickTo(this.ctx.currentTime + this.lookahead, 64); }

  // schedule every step whose time falls before `horizon`
  tickTo(horizon, cap = 100000) {
    if (!this.song || this.ended) return;
    const offline = this.offline;
    let n = 0;
    while (this.nextTime < horizon && n++ < cap) {
      if (this.pos >= this.lay.total) {
        if (this.song.loop && !offline) { this.pos = 0; this.songStart = this.nextTime; }
        else { this.ended = true; this.endTime = this.nextTime; if (!offline && this.onEnd) setTimeout(() => this.onEnd(), 1800); return; }
      }
      this.scheduleStep(this.pos, this.nextTime);
      this.pos++;
      this.nextTime += this.stepDur;
      // section holds: loop the section until the game says go
      const prev = this.sectionAt(this.pos - 1);
      if (prev && prev.hold && !offline && this.pos === prev.start + prev.steps && !this.flags[prev.hold] && this.holdCount < (prev.holdMax ?? 2)) { this.pos = prev.start; this.holdCount++; }
    }
  }
  sectionAt(pos) { for (const s of this.lay.secs) if (pos >= s.start && pos < s.start + s.steps) return s; return null; }

  scheduleStep(pos, t0) {
    const sec = this.sectionAt(pos); if (!sec) return;
    const local = pos - sec.start, song = this.song, sd = this.stepDur;
    const swing = song.swing || 0;
    const t = t0 + (local % 2 === 1 ? swing * sd : 0) + (song.human ? (this.rng() - 0.5) * song.human : 0);
    const inten = this.offline ? 1 : this._iSmooth;
    const fade = sec.fade ? Math.max(0.05, 1 - local / sec.steps) : 1;
    if (sec.choke && local === 0) this.choke(sec, t0);
    for (const part of sec.parts) {
      if ((part.lvl || 0) > inten + 1e-6) continue;
      const inst = part.i;
      if (part.p) {                                     // drum pattern string
        const pat = part._pat || (part._pat = part.p.replace(/\|/g, ''));
        const ch = pat[local % pat.length];
        if (ch === '.' || ch === ' ' || ch === undefined) continue;
        const vel = (ch === 'x' ? 1 : ch === 'o' ? 0.62 : ch === '-' ? 0.32 : ch === 'X' ? 1.15 : 0.5) * (part.vel ?? 1) * fade * (song.human ? 1 + (this.rng() - 0.5) * 0.12 : 1);
        const o = { ...(part.o || {}) }, div = o.div || 1;
        for (let k = 0; k < div; k++) {
          const tk = t + k * sd / div, vk = k ? vel * 0.85 : vel;
          if (inst === 'ohat') { o.open = true; this.hat(tk, vk, o); }
          else if (this[inst]) this[inst](tk, vk, o);
        }
      } else if (part.n) {                              // note events [step, note|notes, lenSteps, vel, extra]
        const L = part.L || 16, at = local % L;
        for (const ev of part.n) {
          if (ev[0] !== at) continue;
          if (part.every && Math.floor(local / L) % part.every !== (part.phase || 0)) continue;
          const notes = Array.isArray(ev[1]) ? ev[1] : null, note = notes ? null : ev[1];
          const o = { ...(part.o || {}), ...(ev[4] || {}), dur: Math.max(sd * 0.5, ev[2] * sd - 0.01), notes: notes ? notes.map(n => n + (part.tr || 0)) : undefined, note: note != null ? note + (part.tr || 0) : undefined };
          const vel = (ev[3] ?? 0.8) * (part.vel ?? 1) * fade;
          if (this[inst]) this[inst](t, vel, o);
        }
      }
    }
  }

  // A brake point (section.choke): a moment after the downbeat every channel the
  // section does not play — and every reverb/delay tail — is cut, so the bar is
  // the hit, near-silence and only its own parts; all of it returns on the next
  // section's downbeat. section.choke may be a number: seconds before the cut.
  choke(sec, t) {
    const names = new Set(sec.parts.map(p => p.i === 'ohat' ? 'ohat' : p.i === 'strings' && p.o && p.o.pad ? 'pad' : p.i === 'oo' && p.o && p.o.chop ? 'oochop' : p.i));
    const cut = t + (typeof sec.choke === 'number' ? sec.choke : 0.12), back = t + sec.steps * this.stepDur;
    const duck = (param, to) => { param.cancelScheduledValues(cut); param.setTargetAtTime(0, cut, 0.03); param.setTargetAtTime(to, back - 0.005, 0.004); };
    for (const name in this.channels) if (!names.has(name)) duck(this.channels[name].inp.gain, this.channels[name].m.g);
    for (const k in this.fx) duck(this.fx[k].out.gain, k === 'delay' ? 0.8 : 1.0);
  }

  // ---------------------------------------------------------------- offline
  // Render a whole song to an AudioBuffer (for the radio page's export and the
  // headless checker). A fresh engine on an OfflineAudioContext, intensity 1.
  // Rendered in windows: everything scheduled at once makes a graph the size of
  // the song and the render goes quadratic. suspend() at each window edge,
  // schedule the next two seconds, resume — the live graph stays small.
  static async render(songs, stations, id, sampleRate = 44100, onProgress) {
    const song = songs[id]; const eng = new Music(songs, stations); const lay = eng.layout(song);
    const secs = lay.total * (60 / song.bpm / 4) + 3;
    const ctx = new OfflineAudioContext(2, Math.ceil(secs * sampleRate), sampleRate);
    eng.start(ctx); eng.play(id, { at: 0.1 });
    const win = 1.0, ahead = 1.6, total = ctx.length / sampleRate;
    eng.tickTo(win + ahead);
    let at = win, rendering = null;
    while (at < total - 0.5 && !eng.ended) {
      const p = ctx.suspend(at);
      if (!rendering) rendering = ctx.startRendering(); else ctx.resume();
      await p;
      eng.tickTo(at + win + ahead);
      at += win;
      if (onProgress) onProgress(at / total);
    }
    if (!rendering) rendering = ctx.startRendering(); else ctx.resume();
    const buf = await rendering;
    return { buf, lay, song };
  }

  // Numbers instead of ears: loudness per section, peaks, clipping, spectral
  // balance, tempo by onset autocorrelation, silence.
  static analyze(buf, lay, song) {
    const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, n = L.length, sd = 60 / song.bpm / 4;
    let peak = 0, clip = 0, sumSq = 0, dc = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > peak) peak = a; if (b > peak) peak = b; if (a > 0.985 || b > 0.985) clip++; sumSq += L[i] * L[i]; dc += L[i]; }
    const db = x => 20 * Math.log10(Math.max(1e-9, x));
    const secOut = lay.secs.map(s => {
      const a = Math.floor((0.1 + s.start * sd) * sr), b = Math.min(n, Math.floor((0.1 + (s.start + s.steps) * sd) * sr));
      let ss = 0, sub = 0, low = 0, mid = 0, hi = 0, cnt = 0;
      // crude band split with one-pole filters
      let l1 = 0, l2 = 0, l3 = 0;
      for (let i = a; i < b; i++) { const x = L[i]; l1 += (x - l1) * 0.012; l2 += (x - l2) * 0.05; l3 += (x - l3) * 0.32; ss += x * x; sub += l1 * l1; low += (l2 - l1) ** 2; mid += (l3 - l2) ** 2; hi += (x - l3) ** 2; cnt++; }
      const tot = sub + low + mid + hi || 1;
      return { name: s.name, bars: s.bars, rms: +db(Math.sqrt(ss / Math.max(1, cnt))).toFixed(1), sub: +(sub / tot).toFixed(2), low: +(low / tot).toFixed(2), mid: +(mid / tot).toFixed(2), hi: +(hi / tot).toFixed(2) };
    });
    // onset envelope at 200 Hz → autocorrelation → bpm
    const hop = Math.floor(sr / 200), env = [];
    for (let i = 0; i + hop <= n; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += L[j] * L[j]; env.push(Math.sqrt(e / hop)); }
    const on = env.map((e, i) => Math.max(0, e - (env[i - 1] || 0)));
    let bestLag = 0, best = -1; const ac = {};
    const acAt = lag => { if (ac[lag] != null) return ac[lag]; let s = 0; for (let i = 0; i + lag < on.length; i++) s += on[i] * on[i + lag]; return ac[lag] = s / (on.length - lag); };
    for (let lag = Math.floor(200 * 60 / 200); lag <= Math.floor(200 * 60 / 60); lag++) { const s = acAt(lag); if (s > best) { best = s; bestLag = lag; } }
    const bpmEst = 60 * 200 / bestLag;
    // how strongly the song's own beat shows up: autocorrelation at the beat lag (best of ±1) over the global maximum
    const beatLag = Math.round(200 * 60 / song.bpm);
    const beat = Math.max(acAt(beatLag - 1), acAt(beatLag), acAt(beatLag + 1)), barLag = beatLag * 4;
    const beatStrength = +(beat / (best || 1)).toFixed(2);
    // silence gaps (> 0.7 s below -50 dB) inside the song body
    let gaps = 0, run = 0, maxRun = 0;
    for (let i = 0; i < env.length; i++) { if (env[i] < 0.003) { run++; if (run > maxRun) maxRun = run; } else { if (run > 140) gaps++; run = 0; } }
    const secondsPlayed = 0.1 + lay.total * sd;
    return { duration: +secondsPlayed.toFixed(1), peakDb: +db(peak).toFixed(1), clipSamples: clip, rmsDb: +db(Math.sqrt(sumSq / n)).toFixed(1), dc: +(dc / n).toFixed(4), bpmEst: +bpmEst.toFixed(1), bpmAlt: [+(bpmEst / 2).toFixed(1), +(bpmEst * 2).toFixed(1)], beatStrength, gaps, longestSilenceS: +(maxRun / 200).toFixed(1), sections: secOut };
  }

  static wav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
    let o = 44; const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); out.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
    return new Blob([out], { type: 'audio/wav' });
  }
}
