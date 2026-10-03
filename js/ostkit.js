// ostkit.js — the authoring tools every OST chart is written with. One file
// per circuit lives in js/ost/; js/ost.js gathers them.
//
// Note events are [step, note|notes, lengthInSteps, velocity, extraOpts] inside
// a pattern of L steps (16 per bar). Drum strings: x hit, o soft, - ghost, . rest.
// Patterns loop by their own length, so a 12-step (or 24/48-step) pattern is how
// a waltz is written: give the section a step count that is a multiple of it.

import { chord, midi } from './music.js';
export { chord, midi };

// ------------------------------------------------------------ authoring tools
export const X = (i, p, o = {}) => ({ i, p, ...o });                               // drum part
export const N = (i, ev, L, o = {}) => ({ i, n: ev, L, ...o });                    // note part
export const trp = (parts, semis) => parts.map(p => p.n ? { ...p, tr: (p.tr || 0) + semis } : p);

// fold a chord's notes into one octave starting at `lo`, sorted
export function voice(sym, lo, extra = 0) {
  const raw = chord(sym, 4);
  const out = raw.map(n => { while (n < lo) n += 12; while (n >= lo + 12) n -= 12; return n; }).sort((a, b) => a - b);
  const uniq = [...new Set(out)];
  for (let i = 0; i < extra; i++) uniq.push(uniq[i] + 12);
  return uniq;
}
export const root = (sym, oct) => chord(sym, oct)[0];
export function spread(sym, lo, span = 2) { const v = voice(sym, lo); const out = []; for (let o = 0; o < span; o++) for (const n of v) out.push(n + 12 * o); out.push(v[0] + 12 * span); return out; }
export function rhythm(str) {                                   // 'x..x' → [{s, v}]
  const s = str.replace(/\|/g, ''); const out = [];
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '.' || c === ' ') continue; out.push({ s: i, v: c === 'x' ? 1 : c === 'X' ? 1.15 : c === 'o' ? 0.7 : 0.4 }); }
  for (let i = 0; i < out.length; i++) out[i].len = (i + 1 < out.length ? out[i + 1].s : s.length) - out[i].s;
  return out;
}
// chords comped to a rhythm, one chord per bar
export function comp(inst, chords, rhy, lo, o = {}) {
  const ev = [], R = rhythm(rhy), extra = o.extra || 0;
  chords.forEach((sym, bar) => { const notes = voice(sym, lo, extra); for (const h of R) ev.push([bar * 16 + h.s, notes, o.len ?? Math.min(h.len, o.maxLen ?? 16), (o.vel ?? 0.8) * h.v, o.ev]); });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
// a bass line from chord roots: figure = [[step, interval, len, vel, extra]...] per bar
export function bassline(inst, chords, figure, oct, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const r = root(sym, oct); for (const [s, iv, len, vel, ex] of figure) ev.push([bar * 16 + s, r + iv, len, vel ?? 0.85, ex]); });
  return N(inst, ev, 16 * chords.length, o);
}
// arpeggio: chord tones over `span` octaves, index pattern, one note per `stepLen`
export function arp(inst, chords, lo, idx, stepLen, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const tones = spread(sym, lo, o.span ?? 2); for (let k = 0; k < idx.length; k++) { const s = k * stepLen; if (s >= 16) break; const n = tones[Math.min(idx[k], tones.length - 1)]; ev.push([bar * 16 + s, n, o.len ?? stepLen, (o.vel ?? 0.7) * (k % 4 === 0 ? 1 : 0.85)]); } });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
export const line = (inst, L, ev, o = {}) => N(inst, ev.map(([s, n, len, v, ex]) => [s, Array.isArray(n) ? n.map(midi) : midi(n), len, v ?? 0.85, ex]), L, o);

// a melody from note NAMES: [[step, 'E5', len, vel?, extra?]...]; extra.glide may be a name too
export const mel = (inst, L, ev, o = {}) => N(inst, ev.map(([s, n, len, v, ex]) => [s, Array.isArray(n) ? n.map(midi) : midi(n), len, v ?? 0.85,
  ex && typeof ex.glide === 'string' ? { ...ex, glide: midi(ex.glide) } : ex]), L, o);
