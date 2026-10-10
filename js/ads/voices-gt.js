// voices-gt.js — four more instruments for the GT film, added to the adverts'
// orchestra (js/ads/synth.js INST) when this module is imported. synth.js is
// not edited: these are extra entries in its exported table, present only on
// a page that imports this file.
//
//   engine   a car, for the length of one shot. HARD edges, because the film
//            cuts from a roar to a muffled cabin and back and the sound has to
//            cut with it. A pitch curve (gear changes, a lift, a pass-by) and
//            an amplitude curve; `lp` is the wall between you and it — 6 kHz
//            trackside, 200 Hz from the driver's seat.
//   wet      rain, with the same hard edges; `lp` turns it into rain on a roof.
//   heart    one beat: lub, dub.
//   rage     the one second of fury: saws through a hard clipper and a blast
//            of bright noise, dry, starting and stopping like a door.
import { INST } from './synth.js';

// straight lines through [[u, value], ...], u = 0..1 of the note
function curve(param, pts, t, dur, k = 1) {
  param.setValueAtTime(pts[0][1] * k, t);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * k, t + pts[i][0] * dur);
}
// an envelope that opens and shuts in `edge` seconds, following `amp` between
function gate(g, amp, t, dur, edge) {
  const e = Math.min(edge, dur / 3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp[0][1], t + e);
  for (let i = 1; i < amp.length; i++) g.gain.linearRampToValueAtTime(amp[i][1], t + Math.max(e, Math.min(dur - e, amp[i][0] * dur)));
  g.gain.setValueAtTime(amp[amp.length - 1][1], t + dur - e);
  g.gain.linearRampToValueAtTime(0, t + dur);
}
function shaper(R, drive, hard = false) {
  const sh = R.ctx.createWaveShaper(), cv = new Float32Array(1025);
  for (let i = 0; i < 1025; i++) { const x = (i / 512 - 1) * drive; cv[i] = hard ? Math.max(-1, Math.min(1, x)) * 0.9 : Math.tanh(x); }
  sh.curve = cv; return sh;
}
function panned(R, ev, t, dur, out) {
  if (!ev.pan || !R.ctx.createStereoPanner) return out;
  const p = R.ctx.createStereoPanner(); p.pan.setValueAtTime(ev.pan[0], t); p.pan.linearRampToValueAtTime(ev.pan[1], t + dur);
  p.connect(out); return p;
}

INST.engine = (R, ev, t, dur, f, v) => {
  const end = t + dur + 0.05, f0 = ev.f0 || 120, pitch = ev.curve || [[0, 1], [1, 1]], amp = ev.amp || [[0, 1], [1, 1]];
  const out = R.bus(0.62 * v, ev.send ?? 0.03, 0), dst = panned(R, ev, t, dur, out);
  const g = R.gain(0); gate(g, amp, t, dur, ev.edge ?? 0.012);
  const lp = R.filt('lowpass', ev.lp ?? 5600, 0.9), sh = shaper(R, 1.2 + 4.5 * (ev.grit ?? 0.5)), pre = R.gain(0.55);
  // the firing note, the half-order rumble under it, and two harmonics that give it its rasp
  for (const [m, type, a, det] of [[1, 'sawtooth', 0.6, -6], [1, 'sawtooth', 0.45, 7], [0.5, 'square', 0.5, 0], [2, 'sawtooth', 0.24, 4], [1.5, 'sawtooth', 0.16, -3], [0.25, 'triangle', 0.4, 0]]) {
    const o = R.osc(type, f0 * m, t, end, det), og = R.gain(a);
    curve(o.frequency, pitch, t, dur, f0 * m);
    o.connect(og); og.connect(pre);
  }
  // intake and exhaust: noise that opens with the revs
  const n = R.src(t, end), nb = R.filt('bandpass', ev.nf ?? 1500, 0.6), ng = R.gain(ev.noise ?? 0.3);
  curve(nb.frequency, pitch, t, dur, ev.nf ?? 1500);
  n.connect(nb); nb.connect(ng); ng.connect(pre);
  pre.connect(sh); sh.connect(lp); lp.connect(g); g.connect(dst);
};

INST.wet = (R, ev, t, dur, f, v) => {
  const end = t + dur + 0.05, out = R.bus(0.2 * v, ev.send ?? 0.08);
  const g = R.gain(0); gate(g, ev.amp || [[0, 1], [1, 1]], t, dur, ev.edge ?? 0.012);
  const n = R.src(t, end, 1.3), bp = R.filt('bandpass', 3400, 0.3), hp = R.filt('highpass', 700, 0.5);
  n.connect(bp); bp.connect(hp);
  if (ev.lp) {                       // heard through a roof: the hiss goes, a low patter stays
    const lp = R.filt('lowpass', ev.lp, 0.7), n2 = R.src(t, end, 0.45), b2 = R.filt('bandpass', 420, 0.8), g2 = R.gain(2.2);
    hp.connect(lp); n2.connect(b2); b2.connect(g2); g2.connect(lp); lp.connect(g);
  } else hp.connect(g);
  g.connect(out);
};

INST.heart = (R, ev, t, dur, f, v) => {
  const out = R.bus(0.95 * v, ev.send ?? 0.04);
  for (const [dt, a, hz] of [[0, 1, 62], [ev.gap ?? 0.24, 0.72, 54]]) {
    const at = t + dt, o = R.osc('sine', hz, at, at + 0.4), g = R.gain(0);
    o.frequency.setValueAtTime(hz * 1.9, at); o.frequency.exponentialRampToValueAtTime(hz * 0.72, at + 0.09);
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(a, at + 0.006); g.gain.setTargetAtTime(0.0001, at + 0.03, 0.045);
    const sh = shaper(R, 1.6); o.connect(sh); sh.connect(g); g.connect(out);
  }
};

INST.rage = (R, ev, t, dur, f, v) => {
  const end = t + dur + 0.02, out = R.bus(0.75 * v, ev.send ?? 0);
  const g = R.gain(0); gate(g, [[0, 1], [1, 1]], t, dur, 0.006);
  const sh = shaper(R, 9, true), hp = R.filt('highpass', 180, 0.7), pk = R.filt('peaking', 3100, 1.1); pk.gain.value = 9;
  for (const det of [-31, -9, 0, 13, 27]) { const o = R.osc('sawtooth', f, t, end, det), og = R.gain(0.4); o.connect(og); og.connect(sh); }
  const o2 = R.osc('square', f * 2.003, t, end), g2 = R.gain(0.25); o2.connect(g2); g2.connect(sh);
  const n = R.src(t, end, 1.7), nh = R.filt('highpass', 2600, 0.6), ng = R.gain(ev.noise ?? 0.5); n.connect(nh); nh.connect(ng); ng.connect(sh);
  // it shakes: a 23 Hz tremor on the whole thing
  const tr = R.osc('square', 23, t, end), tg = R.gain(0.22), bias = R.gain(1); tr.connect(tg); tg.connect(bias.gain);
  sh.connect(hp); hp.connect(pk); pk.connect(bias); bias.connect(g); g.connect(out);
};

export const GT_VOICES = ['engine', 'wet', 'heart', 'rage'];
