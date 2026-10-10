// score-gt.js — everything you hear in the GT film. 60 BPM, so a beat IS a
// second and every number in here is a time on the film's own clock
// (js/ads/gt-plan.js cuts on the same numbers; gt-check.mjs holds them to it).
//
//   THE HOOK      0–12     silence, ROAR, silence, ROAR, silence. Outside is
//                          loud; inside the car the same engine is behind a
//                          200 Hz wall and thirty decibels down.
//   THE DEFENCE  12–45     a heartbeat joins and tightens (61 a minute to 106).
//                          From 34.5 the motif, alone on a far piano, one note
//                          every two seconds: D  A  Bb  A  F  G.
//   THE LOSS     45–60     the motif whole, in brass, three times, each bigger,
//                          over Bb–F–C–Dm: the relative major, the sound of a man
//                          who thinks he is going to hold on. It peaks at 55.5.
//                          55.6–56.6: FURY. A tritone and a semitone in clipped
//                          saws, a snare that will not stop. Then a hard cut
//                          to one soft open fifth, very far away. Then nothing.
//   THE PAIN     60–72     rain and one engine. At 61.2 it drops — he lifts —
//                          and half a second later it is back. No music at all.
import { QUESTION, RHYTHM, cell, phrase, spell, TONIC, stretch } from './motif.js';

// the cuts (seconds). Names match gt-plan.js SHOTS.
export const CUTS = { H1: 0, H2: 3.0, H3: 4.2, H4: 7.0, H5: 9.2, D1: 12.0, D2: 16.5, D3: 19.5, D4: 25.0, D5: 30.5, D6: 34.5, D7: 38.0, D8: 41.5, L1: 45.0, L2: 49.0, L3: 52.5, L4: 55.5, L5: 57.2, P1: 60.0, P2: 63.2, P3: 66.8, END: 69.8, OUT: 72 };
export const MARK = { swell: 45, peak: 55.5, fury: 55.6, furyEnd: 56.6, lift: 61.2, liftEnd: 61.7, motif: 34.5 };

const CH = {
  Dm: { root: 38, pad: [50, 53, 57], hi: [62, 65, 69], six: 8 },
  Bb: { root: 34, pad: [50, 53, 58], hi: [62, 65, 70], six: 9 },
  F: { root: 41, pad: [48, 53, 57], hi: [60, 65, 69], six: 9 },
  C: { root: 36, pad: [48, 52, 55], hi: [60, 64, 67], six: 9 },
};

export function score() {
  const ev = [];
  const E = (t, d, i, n, v, x = {}) => ev.push({ t, d, i, n, v, ...x });
  const C = CUTS;
  // the two cars' voices. The GT4 is a V6 with a rasp to it; the GT3 sits higher and smoother.
  const g4 = (t, d, v, x = {}) => E(t, d, 'engine', null, v, { f0: 132, grit: 0.75, noise: 0.34, who: 'gt4', ...x });
  const g3 = (t, d, v, x = {}) => E(t, d, 'engine', null, v, { f0: 196, grit: 0.3, noise: 0.22, nf: 2300, who: 'gt3', ...x });
  const rain = (t, d, v, x = {}) => E(t, d, 'wet', null, v, x);
  // inside the car: everything is behind glass and a firewall
  const cabin = (t, d, { rival = 0, level = 0.07 } = {}) => {
    g4(t, d, level, { lp: 215, grit: 0.9, noise: 0.05, curve: [[0, 1], [0.5, 1.025], [1, 1.04]] });
    if (rival) g3(t, d, rival, { lp: 330, noise: 0.05, amp: [[0, 0.35], [1, 1]], curve: [[0, 0.98], [1, 1.04]] });
    rain(t, d, 0.13, { lp: 760 });
    // the wipers turn round every 0.625 s (js/ads/cabin.js WIPE.period / 2)
    for (let k = Math.ceil(t / 0.625); k * 0.625 < t + d - 0.05; k++) E(k * 0.625, 0.2, 'thud', null, 0.06, { send: 0.05, tag: 'wiper' });
  };

  // ============================ THE HOOK =======================================
  rain(C.H1, 3.0, 0.32, { amp: [[0, 0], [0.5, 1], [1, 1]], tag: 'rain only' });
  // ROAR: the tyre on the stripe
  g4(C.H2, 1.2, 1.0, { curve: [[0, 0.94], [0.4, 1.0], [1, 1.1]], amp: [[0, 0.9], [0.4, 1], [1, 0.85]], pan: [-0.5, 0.6] });
  rain(C.H2, 1.2, 0.7);
  E(C.H2 + 0.48, 0.3, 'thud', null, 0.7, { send: 0.1, tag: 'kerb' }); E(C.H2 + 0.84, 0.3, 'thud', null, 0.5, { send: 0.1, tag: 'kerb' });
  cabin(C.H3, 2.8);
  // ROAR: a straight; it comes, it is here, it is gone (the pitch falls as it passes)
  g4(C.H4, 2.2, 1.0, { f0: 150, curve: [[0, 1.07], [0.6, 1.07], [0.72, 0.84], [1, 0.82]], amp: [[0, 0.3], [0.5, 0.8], [0.66, 1], [0.8, 0.6], [1, 0.3]], pan: [-0.8, 0.8] });
  rain(C.H4, 2.2, 0.7);
  E(C.H4 + 1.25, 0.7, 'whoosh', null, 0.6, { send: 0.1 });
  cabin(C.H5, 2.8, { rival: 0.06 });

  // ============================ THE DEFENCE ====================================
  // the heart: one beat a second to begin with, nearly two by the time he loses
  const beats = [];
  for (let t = C.D1 + 0.3; t < MARK.peak - 0.3;) { const k = (t - C.D1) / (MARK.peak - C.D1); beats.push(t); t += 0.98 - 0.425 * Math.pow(k, 1.15); }
  beats.forEach((t, i) => { const k = i / beats.length, gap = (beats[i + 1] ?? t + 0.55) - t; E(t, 0.5, 'heart', null, 0.3 + 0.3 * k, { gap: Math.min(0.26, gap * 0.36), tag: 'heart' }); });

  g4(C.D1, 4.5, 0.72, { curve: [[0, 1], [0.48, 1.09], [0.5, 0.9], [1, 1.0]] }); g3(C.D1, 4.5, 0.5, { curve: [[0, 0.98], [1, 1.05]], amp: [[0, 0.6], [1, 1]] });
  rain(C.D1, 4.5, 0.6);
  // the locked kerb: he passes at 1.55 s, the GT3 0.44 s after
  g4(C.D2, 3.0, 0.9, { curve: [[0, 1.04], [0.48, 1.05], [0.58, 0.86], [1, 0.9]], amp: [[0, 0.15], [0.4, 0.7], [0.52, 1], [0.64, 0.4], [1, 0.08]], pan: [-0.6, 0.7] });
  g3(C.D2, 3.0, 0.7, { curve: [[0, 1.04], [0.62, 1.05], [0.72, 0.86], [1, 0.9]], amp: [[0, 0.1], [0.5, 0.5], [0.66, 1], [0.8, 0.35], [1, 0.08]], pan: [-0.6, 0.7] });
  rain(C.D2, 3.0, 0.65);
  E(C.D2 + 1.55, 0.3, 'thud', null, 0.55, { send: 0.1, tag: 'kerb' }); E(C.D2 + 1.65, 0.3, 'thud', null, 0.4, { send: 0.1, tag: 'kerb' });
  // one car's width: the GT3 comes up for a look (its note rises), thinks, backs out of it
  g4(C.D3, 5.5, 0.66, { curve: [[0, 1], [1, 1.07]] }); g3(C.D3, 5.5, 0.58, { curve: [[0, 1], [0.25, 1.0], [0.45, 1.1], [0.7, 1.1], [0.85, 0.95], [1, 0.98]] });
  rain(C.D3, 5.5, 0.6);
  // the disc: down through the gears
  g4(C.D4, 5.5, 0.6, { lp: 3000, curve: [[0, 1.0], [0.1, 0.86], [0.115, 1.02], [0.3, 0.84], [0.315, 0.98], [0.5, 0.8], [0.515, 0.93], [0.75, 0.74], [1, 0.7]], amp: [[0, 1], [1, 0.75]] });
  rain(C.D4, 5.5, 0.55);
  E(C.D4 + 0.5, 4.8, 'riser', 38, 0.28, { send: 0.3, tag: 'the disc heats' });
  // the flaw: the GT3's revs flare as its tail lets go
  g4(C.D5, 4.0, 0.6, { curve: [[0, 0.92], [1, 1.05]] });
  g3(C.D5, 4.0, 0.66, { curve: [[0, 0.94], [0.37, 1.0], [0.42, 1.2], [0.47, 0.93], [0.56, 1.0], [1, 1.06]] });
  rain(C.D5, 4.0, 0.6);
  cabin(C.D6, 3.5, { rival: 0.06 });
  g3(C.D7, 3.5, 0.74, { curve: [[0, 1], [1, 1.04]] }); g4(C.D7, 3.5, 0.5, { curve: [[0, 1], [1, 1.04]] });
  rain(C.D7, 3.5, 0.6);
  g4(C.D8, 3.5, 0.75, { curve: [[0, 1.05], [0.2, 1.05], [0.3, 0.9], [1, 0.97]], amp: [[0, 0.35], [0.2, 1], [0.4, 0.55], [1, 0.25]] });
  g3(C.D8, 3.5, 0.6, { curve: [[0, 1.05], [0.25, 1.05], [0.35, 0.9], [1, 0.97]], amp: [[0, 0.3], [0.25, 1], [0.45, 0.5], [1, 0.25]] });
  rain(C.D8, 3.5, 0.6);

  // the motif, one note at a time, under all of it: D . A . Bb . A . F . G
  phrase(ev, QUESTION, { at: MARK.motif, inst: 'piano', rhythm: [2, 2, 2, 2, 1.5, 1], hold: 3.2, vel: 0.62, accent: [0.8, 0.85, 0.92, 0.95, 1, 1.08], send: 0.85, tag: 'motif, one note at a time' });
  E(C.D6, 10.5, 'drone', 38, 0.34, { a: 4, r: 1.2 });
  E(43.0, 2.0, 'swell', null, 0.5); E(43.0, 2.0, 'riser', 50, 0.3);

  // ============================ THE LOSS =======================================
  // 120 to the minute now: a bar is two seconds. Bb | F | C | Dm | Bb | (C)
  const PROG = ['Bb', 'F', 'C', 'Dm', 'Bb'];
  PROG.forEach((name, b) => {
    const c = CH[name], t = MARK.swell + b * 2, build = b / 4;
    cell(c.six).forEach((iv, k) => E(t + k * 0.25, 0.21, 'cello', c.root + 12 + iv, (k % 2 ? 0.42 : 0.6) + build * 0.2, { tag: 'cell' }));
    if (b >= 2) for (let k = 0; k < 16; k++) E(t + k * 0.125, 0.1, 'cello', c.root + 36 + [0, 7, c.six, 12][k % 4], 0.24 + build * 0.2, { pan: 0.4, send: 0.35, tag: 'cell x2' });
    E(t, 1.8, 'sub', c.root, 0.3 + build * 0.22, { drop: 1.5, dropT: 0.06 });
    for (const n of c.pad) E(t, 2.02, 'pad', n, 0.26 + build * 0.12, { a: 0.25, r: 0.5, bright: 1500 + build * 1300 });
    if (b >= 1) for (const n of c.hi) E(t, 2.02, 'choir', n, 0.18 + build * 0.24, { a: 0.3, r: 0.5 });
    for (const [o, lo, v] of [[0, true, 0.9], [0.75, false, 0.5], [1.0, true, 0.7], [1.5, false, 0.55], [1.75, false, 0.45]]) E(t + o, 0.25, 'taiko', null, v * (0.5 + build * 0.5), { lo, pan: lo ? -0.2 : 0.25 });
    if (b >= 2) { E(t + 0.5, 0.2, 'snare', null, 0.4 + build * 0.3); E(t + 1.5, 0.2, 'snare', null, 0.45 + build * 0.3); for (let k = 0; k < 8; k++) E(t + k * 0.25, 0.1, 'hat', null, k % 2 ? 0.4 : 0.75); }
  });
  // the last half-bar: C, everything, held breath
  { const c = CH.C, t = 55.0; for (const n of [...c.pad, ...c.hi]) E(t, 0.5, 'choir', n, 0.6, { a: 0.1, r: 0.12 }); for (const n of c.pad) E(t, 0.5, 'pad', n, 0.42, { a: 0.1, r: 0.12, bright: 3200 }); E(t, 0.5, 'sub', c.root, 0.8, { drop: 1.5, dropT: 0.05 });
    for (let k = 0; k < 8; k++) { E(t + k * 0.0625, 0.06, 'snare', null, 0.45 + k * 0.06, { send: 0.2 }); if (k % 2 === 0) E(t + k * 0.0625, 0.1, 'taiko', null, 0.6 + k * 0.05, { lo: k % 4 === 0 }); } }
  const fast = stretch(RHYTHM, 0.5);                    // the motif at 120: three seconds, whole
  phrase(ev, QUESTION, { at: 45.0, root: TONIC - 12, inst: 'brass', rhythm: fast, vel: 0.85, tag: 'MOTIF (horns)' });
  for (const [oct, inst, v] of [[0, 'brass', 0.95], [-12, 'brass', 0.5], [12, 'bell', 0.34]]) phrase(ev, QUESTION, { at: 49.0, root: TONIC + oct, inst, rhythm: fast, vel: v, tag: 'MOTIF 8va' });
  for (const [oct, inst, v] of [[12, 'brass', 1.0], [0, 'brass', 0.8], [-12, 'brass', 0.55], [24, 'bell', 0.3], [12, 'bell', 0.42]]) phrase(ev, QUESTION, { at: 52.5, root: TONIC + oct, inst, rhythm: fast, vel: v, tag: 'MOTIF, all of it' });
  E(53.5, 2.0, 'riser', 62, 0.75, { send: 0.3 }); E(53.5, 2.0, 'swell', null, 0.7);
  // the cars are under the music here, not over it
  g4(C.L1, 4.0, 0.3, { curve: [[0, 1], [1, 1.05]] }); g3(C.L1, 4.0, 0.26, { curve: [[0, 1], [1, 1.05]] }); rain(C.L1, 4.0, 0.45);
  g4(C.L2, 3.5, 0.3, { curve: [[0, 1.02], [1, 1.07]] }); g3(C.L2, 3.5, 0.26, { curve: [[0, 1.02], [1, 1.08]] }); rain(C.L2, 3.5, 0.45);
  g4(C.L3, 3.0, 0.3, { curve: [[0, 1.04], [1, 1.09]] }); g3(C.L3, 3.0, 0.28, { curve: [[0, 1.04], [0.6, 1.08], [1, 1.16]] }); rain(C.L3, 3.0, 0.45);

  // The swell is big by what is IN it, not by its level: measured, the master's compressor holds everything near the
  // same ceiling, so the fury can only be the loudest second if the swell stops short of that ceiling. The tune stays
  // on top (brass at 0.8), everything under it comes down.
  for (const e of ev) if (e.t >= MARK.swell && e.t < MARK.fury && !['engine', 'wet', 'heart'].includes(e.i)) e.v *= e.i === 'brass' ? 0.8 : 0.44 + 0.22 * (e.t - MARK.swell) / (MARK.fury - MARK.swell);   // and it still grows to its last bar
  // ---- FURY: 55.6 to 56.6 -------------------------------------------------------
  // D, G# and Eb: a tritone with a semitone ground into it. Dry. It stops like a door.
  const F0 = MARK.fury, F1 = MARK.furyEnd;
  for (const [n, v] of [[38, 1], [44, 0.9], [51, 0.9], [56, 0.8], [63, 0.75]]) E(F0, F1 - F0, 'rage', n, v, { tag: 'fury' });
  for (let k = 0; k < 16; k++) E(F0 + k * 0.0625, 0.05, 'snare', null, 0.8 + (k % 4 === 0 ? 0.2 : 0), { send: 0, tag: 'fury' });
  for (let k = 0; k < 8; k++) E(F0 + k * 0.125, 0.1, 'taiko', null, 0.95, { lo: k % 2 === 0, send: 0, tag: 'fury' });
  for (let k = 0; k < 16; k++) E(F0 + k * 0.0625, 0.05, 'hat', null, 1, { open: true, send: 0, tag: 'fury' });
  g3(C.L4, F1 - C.L4, 0.85, { grit: 0.9, noise: 0.5, curve: [[0, 1.08], [0.7, 1.22], [1, 1.0]], amp: [[0, 0.5], [0.7, 1], [1, 0.7]], pan: [0.2, -0.9] });
  g4(C.L4, F1 - C.L4, 0.6, { curve: [[0, 1.1], [1, 1.12]] });
  rain(C.L4, F1 - C.L4, 0.5);
  // ---- and after it: almost nothing ---------------------------------------------
  E(F1 + 0.02, 2.3, 'pad', 74, 0.085, { a: 0.5, r: 0.7, bright: 800, send: 0.9, tag: 'after' }); E(F1 + 0.02, 2.3, 'pad', 81, 0.07, { a: 0.5, r: 0.7, bright: 800, send: 0.9, tag: 'after' });
  rain(F1, C.P1 - F1, 0.14, { lp: 1800, amp: [[0, 0.6], [1, 1]] });

  // ============================ THE PAIN =======================================
  // one engine. He lifts at 61.2 — the note falls away — and at 61.7 he is back on it.
  const u = t => (t - C.P1) / 3.2;
  g4(C.P1, 3.2, 0.3, { lp: 3600, curve: [[0, 1], [u(MARK.lift), 1.01], [u(MARK.lift + 0.12), 0.66], [u(MARK.liftEnd - 0.05), 0.62], [u(MARK.liftEnd + 0.15), 0.98], [1, 1.02]], amp: [[0, 1], [u(MARK.lift), 1], [u(MARK.lift + 0.1), 0.32], [u(MARK.liftEnd - 0.03), 0.3], [u(MARK.liftEnd + 0.12), 1], [1, 1]], tag: 'he lifts' });
  rain(C.P1, 3.2, 0.5);
  cabin(C.P2, 3.6, { level: 0.07 });
  g4(C.P3, 3.0, 0.34, { lp: 3600, curve: [[0, 1.03], [0.47, 1.04], [0.58, 0.86], [1, 0.88]], amp: [[0, 0.12], [0.38, 0.6], [0.5, 1], [0.62, 0.35], [0.85, 0.06], [1, 0]], pan: [-0.6, 0.7] });
  E(C.P3 + 1.5, 0.3, 'thud', null, 0.4, { send: 0.1, tag: 'kerb' });
  rain(C.P3, 3.0, 0.5, { amp: [[0, 1], [0.8, 1], [1, 0.55]] });
  rain(C.END, 0.6, 0.28, { amp: [[0, 1], [1, 0]], edge: 0.02, send: 0, tag: 'rain, going' });

  const sections = [
    { name: 'THE HOOK', from: 0, to: 12, meter: 'free', what: 'Rain. ROAR (the tyre on the stripe). Cabin: the same engine behind a 215 Hz low-pass, rain on the roof, wipers. ROAR (a pass-by, pitch falling). Cabin again, and a second, higher engine arriving behind.', motif: [] },
    { name: 'THE DEFENCE', from: 12, to: 45, meter: 'free', what: `Two engines; a heartbeat from 12.3 s that tightens (${beats.length} beats: ${(60 / (beats[1] - beats[0])).toFixed(0)} a minute to ${(60 / (beats[beats.length - 1] - beats[beats.length - 2])).toFixed(0)}). The GT3's revs flare once, at 32.2 s. From 34.5 the motif on a far piano, one note at a time.`,
      motif: [`motif  ${spell(QUESTION)}  piano, at 34.5, 36.5, 38.5, 40.5, 42.5, 44.0 s`] },
    { name: 'THE LOSS', from: 45, to: 60, meter: '4/4 at 120, bars of 2 s', what: 'Bb | F | C | Dm | Bb | C: cell ostinato, drums, strings, then voices; the motif whole in brass at 45, an octave up at 49, everything at 52.5 so its last note lands on 55.5. FURY 55.6–56.6 (D + G# + Eb in clipped saws, sixteenth-note snare, dry). Then one soft open fifth, far away, gone by 59.5.',
      motif: [`MOTIF (horns)  ${spell(QUESTION, TONIC - 12)}  45.0 s`, `MOTIF 8va  ${spell(QUESTION, TONIC)}  49.0 s`, `MOTIF, all of it  ${spell(QUESTION, TONIC + 12)}  52.5 s, last note 54.5–55.5`, 'cell: root 5th 6th 5th 8ve 5th 6th 5th'] },
    { name: 'THE PAIN', from: 60, to: 72, meter: 'free', what: 'Rain and one engine. 61.2–61.7 he lifts: the note falls a third and the level with it, then returns. Cabin: muffled engine, wipers. The kerb one more time. Rain, going. Silence under the name.', motif: [] },
  ];
  return { title: 'XBR — gt', bpm: 60, beats: 72, events: ev, sections, beatsOfHeart: beats, reverb: { seconds: 2.6, wet: 0.36, damp: 0.6, echo: 0.5 }, gain: 0.95, drive: 0.17 };      // a light hand on the compressor: this film lives on its loud/quiet contrast
}
void CH.Dm;
