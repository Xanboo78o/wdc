// ost.js — CWDC's soundtrack. Every circuit gets two songs: one fun, one less
// fun (Adam, 2026-10-02), and each circuit sounds like its country — Monza all
// Italian, Suzuka all Japanese. Every song is a chart for js/music.js: a key, a
// tempo, chord changes and per-section parts. Nothing is generated at play
// time; what is written here is what plays. Audition them at ost.html.
//
// Note events are [step, note|notes, lengthInSteps, velocity, extraOpts] inside
// a pattern of L steps (16 per bar). Drum strings: x hit, o soft, - ghost, . rest.

import { chord, midi } from './music.js';

// ------------------------------------------------------------ authoring tools
const X = (i, p, o = {}) => ({ i, p, ...o });                               // drum part
const N = (i, ev, L, o = {}) => ({ i, n: ev, L, ...o });                    // note part
const trp = (parts, semis) => parts.map(p => p.n ? { ...p, tr: (p.tr || 0) + semis } : p);

// fold a chord's notes into one octave starting at `lo`, sorted
function voice(sym, lo, extra = 0) {
  const raw = chord(sym, 4);
  const out = raw.map(n => { while (n < lo) n += 12; while (n >= lo + 12) n -= 12; return n; }).sort((a, b) => a - b);
  const uniq = [...new Set(out)];
  for (let i = 0; i < extra; i++) uniq.push(uniq[i] + 12);
  return uniq;
}
const root = (sym, oct) => chord(sym, oct)[0];
function spread(sym, lo, span = 2) { const v = voice(sym, lo); const out = []; for (let o = 0; o < span; o++) for (const n of v) out.push(n + 12 * o); out.push(v[0] + 12 * span); return out; }
function rhythm(str) {                                   // 'x..x' → [{s, v}]
  const s = str.replace(/\|/g, ''); const out = [];
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '.' || c === ' ') continue; out.push({ s: i, v: c === 'x' ? 1 : c === 'X' ? 1.15 : c === 'o' ? 0.7 : 0.4 }); }
  for (let i = 0; i < out.length; i++) out[i].len = (i + 1 < out.length ? out[i + 1].s : s.length) - out[i].s;
  return out;
}
// chords comped to a rhythm, one chord per bar
function comp(inst, chords, rhy, lo, o = {}) {
  const ev = [], R = rhythm(rhy), extra = o.extra || 0;
  chords.forEach((sym, bar) => { const notes = voice(sym, lo, extra); for (const h of R) ev.push([bar * 16 + h.s, notes, o.len ?? Math.min(h.len, o.maxLen ?? 16), (o.vel ?? 0.8) * h.v, o.ev]); });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
// a bass line from chord roots: figure = [[step, interval, len, vel, extra]...] per bar
function bassline(inst, chords, figure, oct, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const r = root(sym, oct); for (const [s, iv, len, vel, ex] of figure) ev.push([bar * 16 + s, r + iv, len, vel ?? 0.85, ex]); });
  return N(inst, ev, 16 * chords.length, o);
}
// arpeggio: chord tones over `span` octaves, index pattern, one note per `stepLen`
function arp(inst, chords, lo, idx, stepLen, o = {}) {
  const ev = [];
  chords.forEach((sym, bar) => { const tones = spread(sym, lo, o.span ?? 2); for (let k = 0; k < idx.length; k++) { const s = k * stepLen; if (s >= 16) break; const n = tones[Math.min(idx[k], tones.length - 1)]; ev.push([bar * 16 + s, n, o.len ?? stepLen, (o.vel ?? 0.7) * (k % 4 === 0 ? 1 : 0.85)]); } });
  return N(inst, ev, 16 * chords.length, o.part || {});
}
const line = (inst, L, ev, o = {}) => N(inst, ev.map(([s, n, len, v, ex]) => [s, Array.isArray(n) ? n.map(midi) : midi(n), len, v ?? 0.85, ex]), L, o);

// =============================================================================
// MONZA · TEMPIO DELLA VELOCITÀ — the fun one. Italo disco: 1983, a Milan
// basement, a drum machine and a synth that only knows how to feel everything
// at once. Octave bass on the eighths, a sixteenth arpeggio that never stops,
// a gated snare, and a lead melody far too romantic for a car park. The last
// chorus goes up a whole tone, like the run down to the Parabolica.
// =============================================================================
const IV = ['Am', 'F', 'C', 'G'];                     // verse
const IC = ['F', 'G', 'Em', 'Am'];                    // chorus
const IB = ['Dm', 'Em', 'F', 'G'];                    // break
const ITALO_KICK = { f0: 170, f1: 48, sweep: 0.05, dec: 0.3, drive: 1.4, click: 0.55 };
const OCT = [[0, 0, 1, 0.95], [2, 12, 1, 0.75], [4, 0, 1, 0.9], [6, 12, 1, 0.75], [8, 0, 1, 0.95], [10, 12, 1, 0.75], [12, 0, 1, 0.9], [14, 12, 1, 0.75]];
const OCT_O = { cut: 1700, q: 3.5, fdec: 0.11 };
const ARP16 = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3];
// the verse hook: four bars, answered by itself
const IVM = [[0, 'E5', 3], [3, 'E5', 1], [4, 'D5', 2], [6, 'C5', 2], [8, 'D5', 4], [12, 'E5', 4],
  [16, 'C5', 3], [19, 'C5', 1], [20, 'A4', 2], [22, 'C5', 2], [24, 'F5', 4], [28, 'E5', 4],
  [32, 'E5', 3], [35, 'E5', 1], [36, 'G5', 2], [38, 'E5', 2], [40, 'C5', 4], [44, 'D5', 4],
  [48, 'B4', 3], [51, 'B4', 1], [52, 'D5', 2], [54, 'G5', 2], [56, 'D5', 4], [60, 'B4', 4]];
// the chorus: climbs a third every bar and lands home on the A
const ICM = [[0, 'A4', 2], [2, 'C5', 2], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 2], [12, 'D5', 4],
  [16, 'B4', 2], [18, 'D5', 2], [20, 'G5', 4], [24, 'F5', 2], [26, 'E5', 2], [28, 'D5', 4],
  [32, 'E5', 2], [34, 'G5', 2], [36, 'B5', 4], [40, 'A5', 2], [42, 'G5', 2], [44, 'E5', 4],
  [48, 'A5', 6], [54, 'G5', 2], [56, 'E5', 4], [60, 'C5', 2], [62, 'B4', 2]];
const it = {
  kick: X('kick', 'x...x...x...x...', { o: ITALO_KICK }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(4), { o: ITALO_KICK }),
  snare: X('snare', '....x.......x...', { vel: 0.85, o: { dec: 0.2, tone: 190, snap: 1.0, body: 0.6, gate: true } }),
  clap: X('clap', '....x.......x...', { vel: 0.6 }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.55, o: { dec: 0.04 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.7, o: { dec: 0.1 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.5 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  tomHi: X('tom', '................|................|................|........x.x.....', { vel: 0.75, o: { f: 190, dec: 0.3 } }),
  tomLo: X('tom', '................|................|................|............x.x.', { vel: 0.8, o: { f: 120, dec: 0.35 } }),
  roll: X('snare', 'x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { vel: 0.55, o: { dec: 0.1, tone: 200, snap: 1, body: 0.4 } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.4, o: { dur: 60 / 122 * 16 } }),
  bassV: bassline('hbass', IV, OCT, 2, { o: OCT_O }),
  bassC: bassline('hbass', IC, OCT, 2, { o: OCT_O }),
  bassB: bassline('hbass', IB, OCT, 2, { o: OCT_O }),
  bassHold: bassline('sub', ['Am', 'F', 'C', 'G'], [[0, 0, 16, 0.22]], 2),
  arpV: arp('pluck', IV, 57, ARP16, 1, { vel: 0.5, span: 2 }),
  arpC: arp('pluck', IC, 57, ARP16, 1, { vel: 0.5, span: 2 }),
  arpB: arp('pluck', IB, 57, ARP16, 1, { vel: 0.42, span: 2, part: { o: { cut: 3200, floor: 800 } } }),
  arpDark: arp('pluck', IV, 57, ARP16, 1, { vel: 0.42, span: 2, part: { o: { cut: 1800, floor: 500 } } }),
  padV: comp('strings', IV, 'x...............', 57, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  padSoft: comp('strings', IV, 'x...............', 57, { len: 16, vel: 0.25, part: { o: { pad: true } } }),
  padC: comp('strings', IC, 'x...............', 60, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
  padB: comp('strings', IB, 'x...............', 57, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
  hookV: N('pluck', IVM.map(([st, n, l]) => [st, [midi(n)], l, 0.75, { maxDur: 0.5 }]), 64),
  mel: N('lead', ICM.map(([st, n, l]) => [st, midi(n), l, 0.75]), 64),
  melOct: N('pluck', ICM.map(([st, n, l]) => [st, [midi(n) + 12], l, 0.4, { maxDur: 0.4 }]), 64, { lvl: 0.4 }),
  choir: comp('oo', IC, 'x...............', 57, { len: 16, vel: 0.5, part: { lvl: 0.4, o: { a: 0.25, voices: 3, vowel: 'ah' } } }),
  choirB: N('oo', ICM.filter((_, i) => i % 3 === 0).map(([st, n]) => [st, midi(n) - 12, 8, 0.55]), 64, { o: { a: 0.3, voices: 3, vowel: 'oo' } }),
  stabs: comp('stab', IC, '..x.......x..x..', 60, { len: 1, vel: 0.45, part: { lvl: 0.5 } }),
};
const tempio = {
  id: 'tempio', station: 'monza', mood: 'fun', name: 'TEMPIO DELLA VELOCITÀ', artist: 'Xanboo78o Studios', bpm: 122, key: 'Am', swing: 0, loop: true,
  duck: 0.35, duckRelease: 0.16, drumLevel: 0.8, drumDrive: 1.25,
  mix: { pluck: { g: 0.5 }, lead: { g: 0.5 }, hbass: { g: 0.62 }, oo: { g: 0.45 } },
  sections: [
    { name: 'intro', bars: 8, parts: [it.kickIn, it.hat, it.arpDark, it.padSoft, it.bassHold] },
    { name: 'verse', bars: 16, parts: [it.kick, it.snare, it.hat, it.ohat, it.bassV, it.arpV, it.padV, it.hookV, it.tomHi, it.tomLo] },
    { name: 'build', bars: 4, parts: [it.kick, it.roll, it.riser, it.hat, it.bassV, it.arpV, it.padV] },
    { name: 'chorus', bars: 16, drop: true, parts: [it.crash, it.kick, it.snare, it.clap, it.hat, it.ohat, it.shaker, it.bassC, it.arpC, it.padC, it.mel, it.melOct, it.choir, it.stabs, it.tomHi, it.tomLo] },
    { name: 'break', bars: 8, parts: [it.hat, it.arpB, it.padB, it.choirB, it.bassB] },
    { name: 'build2', bars: 4, parts: [it.kick, it.roll, it.riser, it.hat, it.bassV, it.arpV, it.padV, it.hookV] },
    { name: 'chorus2', bars: 16, drop: true, parts: [it.crash, it.kick, it.snare, it.clap, it.hat, it.ohat, it.shaker, it.tomHi, it.tomLo, ...trp([it.bassC, it.arpC, it.padC, it.mel, it.melOct, it.choir, it.stabs], 2)] },
    { name: 'outro', bars: 8, fade: true, parts: [it.kick, it.hat, it.bassV, it.arpDark, it.padSoft] },
  ],
};

// =============================================================================
// MONZA · LESMO AL TRAMONTO — the less fun one. Lesmo at sunset, the
// grandstands empty, a western in the style of Morricone: a twanging guitar
// alone in a huge room, a whistled melody over a tremolo mandolin, then the
// gallop arrives and a trumpet takes the tune somewhere it cannot come back
// from. D minor; the Andalusian cadence (Dm C B♭ A) is the whole landscape.
// =============================================================================
const WA = ['Dm', 'C', 'Bb', 'A', 'Dm', 'Gm', 'A', 'Dm'];
// the tune: a question (bars 1-4) and its answer (bars 5-8)
const WM = [[0, 'A4', 4], [4, 'D5', 8], [12, 'E5', 2], [14, 'F5', 2],
  [16, 'E5', 6], [22, 'D5', 2], [24, 'C5', 8],
  [32, 'D5', 4], [36, 'Bb4', 4], [40, 'F5', 8],
  [48, 'E5', 12], [60, 'C#5', 4],
  [64, 'F5', 4], [68, 'A5', 8], [76, 'G5', 2], [78, 'F5', 2],
  [80, 'G5', 6], [86, 'F5', 2], [88, 'D5', 8],
  [96, 'E5', 4], [100, 'C#5', 4], [104, 'E5', 8],
  [112, 'D5', 16]];
const wl = {
  twangLine: line('twang', 32, [[0, 'D3', 4, 0.9], [4, 'A3', 4, 0.8], [8, 'D4', 8, 0.95, { bend: 1 }], [16, 'C4', 4, 0.85], [20, 'Bb3', 4, 0.8], [24, 'A3', 8, 0.95, { bend: 2 }]]),
  twangHits: comp('twang', WA, 'x...............', 50, { len: 12, vel: 0.6, part: { o: { strum: 0.03 } } }),
  wind: X('riser', 'x...............|................|................|................', { vel: 0.22, o: { dur: 60 / 80 * 16 } }),
  mando: comp('mando', WA, 'x...............', 62, { len: 16, vel: 0.75, part: { o: { trem: 0.062 } } }),
  mandoHalf: comp('mando', WA, 'x.......x.......', 62, { len: 8, vel: 0.8, part: { o: { trem: 0.062 } } }),
  whistle: N('whistle', WM.map(([st, n, l]) => [st, midi(n), l, 0.85]), 128),
  trumpet: N('brass', WM.map(([st, n, l]) => [st, [midi(n)], l, 0.8]), 128),
  trumpetLow: N('brass', WM.map(([st, n, l]) => [st, [midi(n) - 12], l, 0.6]), 128, { lvl: 0.3 }),
  sub: bassline('sub', WA, [[0, 0, 8, 0.38], [8, 7, 8, 0.26]], 2),
  subSoft: bassline('sub', WA, [[0, 0, 16, 0.2]], 2),
  strings: comp('strings', WA, 'x...............', 55, { len: 16, vel: 0.5 }),
  choir: comp('oo', WA, 'x...............', 57, { len: 16, vel: 0.6, part: { o: { a: 0.5, voices: 4, vowel: 'ah' } } }),
  timp: X('tom', 'x...............|................', { vel: 0.9, o: { f: 73, dec: 1.4, bend: 1.15 } }),
  timpRoll: X('tom', '................|'.repeat(7) + 'x.x.x.x.xxxxxxxx', { vel: 0.55, o: { f: 73, dec: 0.5, bend: 1.1 } }),
  gallop: X('snare', 'x.xxx.xxx.xxx.xx', { vel: 0.32, o: { dec: 0.07, tone: 220, snap: 0.7, body: 0.3 } }),
  kick: X('kick', 'x.......x.......', { vel: 0.6, o: { f0: 110, f1: 45, dec: 0.5, drive: 1.1, click: 0.15, duck: 0 } }),
  crash: X('crash', 'x...............|................|................|................|................|................|................|................', { vel: 0.45 }),
};
const tramonto = {
  id: 'tramonto', station: 'monza', mood: 'less fun', name: 'LESMO AL TRAMONTO', artist: 'Xanboo78o Studios', bpm: 80, key: 'Dm', swing: 0, human: 0.008, loop: true,
  duck: 0, drumLevel: 0.75, drumDrive: 1.1, delay: 60 / 80 * 0.75,
  mix: { brass: { g: 0.42, send: { hall: 0.5 } }, strings: { g: 0.3 }, oo: { g: 0.45 }, sub: { g: 0.4 }, twang: { g: 0.85 } },
  sections: [
    { name: 'intro', bars: 4, parts: [wl.twangLine, wl.wind, wl.timp] },
    { name: 'whistle', bars: 8, parts: [wl.whistle, wl.mando, wl.subSoft, wl.twangHits, wl.timp] },
    { name: 'gallop', bars: 8, drop: true, parts: [wl.trumpet, wl.mandoHalf, wl.gallop, wl.kick, wl.sub, wl.strings, wl.choir, wl.timp, wl.timpRoll] },
    { name: 'sunset', bars: 8, drop: true, parts: [wl.crash, wl.whistle, wl.trumpetLow, wl.mandoHalf, wl.gallop, wl.kick, wl.sub, wl.strings, wl.choir, wl.twangHits, wl.timp] },
    { name: 'outro', bars: 4, fade: true, parts: [wl.twangLine, wl.wind, wl.timp] },
  ],
};

export const SONGS = { tempio, tramonto };
// One "station" per circuit, so the engine's station logic works unchanged.
export const STATIONS = [
  { id: 'monza', name: 'MONZA', tag: 'Italy · Italo disco / spaghetti western', color: '#d8352a', songs: ['tempio', 'tramonto'] },
];
