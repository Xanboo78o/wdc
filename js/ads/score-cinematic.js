// score-cinematic.js — the trailer's music. 120 BPM, 4/4, 32 bars, 64 seconds.
//
// One tune (js/ads/motif.js), six rooms:
//
//   A  DAWN       bars  1-4    the motif alone on a far piano; question, then answer
//   B  LIGHT      bars  5-8    strings arrive under it; piano and bell an octave up
//   C  THE PACK   bars  9-16   an ostinato made of the motif's intervals, drums,
//                              the motif's head climbing in the horns, a riser, a hole
//   D  NIGHT      bars 17-20   a hit; the motif BACKWARDS on a bell, a heartbeat
//   E  STATEMENT  bars 21-28   the whole motif in brass, question and answer, twice
//   F  TITLE      bars 29-32   the floor drops; a quiet echo of the answer
//
// Beats are counted from 0; bar n (from 1) starts at beat 4(n-1). The picture
// (js/ads/cinematic.js) cuts on these same numbers.
import { QUESTION, ANSWER, RHYTHM, retro, head, cell, phrase, spell, TONIC, stretch } from './motif.js';

// i – VI – III – VII in D minor. `six` is the sixth above the root that is in key.
const CH = {
  Dm: { root: 38, pad: [50, 53, 57], hi: [62, 65, 69], six: 8 },
  Bb: { root: 34, pad: [50, 53, 58], hi: [62, 65, 70], six: 9 },
  F: { root: 41, pad: [48, 53, 57], hi: [60, 65, 69], six: 9 },
  C: { root: 36, pad: [48, 52, 55], hi: [60, 64, 67], six: 9 },
};
const PROG = ['Dm', 'Bb', 'F', 'C'];

export function score() {
  const ev = [];
  const E = (t, d, i, n, v, x = {}) => ev.push({ t, d, i, n, v, ...x });
  const bar = n => (n - 1) * 4;

  // ---- A: dawn (bars 1-4) ----------------------------------------------------
  phrase(ev, QUESTION, { at: bar(1), inst: 'piano', vel: 0.62, hold: 4, tag: 'question' });
  phrase(ev, ANSWER, { at: bar(3), inst: 'piano', vel: 0.58, hold: 4, tag: 'answer' });
  E(bar(2), 12, 'drone', 38, 0.5, { a: 4, r: 3 });
  E(bar(3), 6, 'pad', 50, 0.22, { a: 3, bright: 900 }); E(bar(3), 6, 'pad', 57, 0.18, { a: 3, bright: 900 });

  // ---- B: light (bars 5-8) ---------------------------------------------------
  PROG.forEach((c, k) => {
    const t = bar(5 + k);
    for (const n of CH[c].pad) E(t, 4.2, 'pad', n, 0.42, { a: 0.9, r: 1.2, bright: 1500 });
    E(t, 4.2, 'pad', CH[c].root, 0.4, { a: 0.9, bright: 600 });
  });
  phrase(ev, QUESTION, { at: bar(5), root: TONIC + 12, inst: 'piano', vel: 0.7, hold: 3, tag: 'question 8va' });
  phrase(ev, QUESTION, { at: bar(5), root: TONIC + 12, inst: 'bell', vel: 0.34, tag: 'question 8va' });
  phrase(ev, ANSWER, { at: bar(7), root: TONIC + 12, inst: 'piano', vel: 0.72, hold: 3, tag: 'answer 8va' });
  phrase(ev, ANSWER, { at: bar(7), root: TONIC + 12, inst: 'bell', vel: 0.36, tag: 'answer 8va' });
  // the pulse wakes up: low strings on the beat, the root and its fifth (the motif's first leap)
  for (let b = bar(7); b < bar(9); b++) E(b, 0.5, 'cello', CH[b < bar(8) ? 'F' : 'C'].root + 12 + (b % 2 ? 7 : 0), 0.5 + (b - bar(7)) * 0.04);
  E(bar(8), 4, 'swell', null, 0.8);
  E(bar(8) + 2, 0.5, 'taiko', null, 0.5, { lo: true }); E(bar(8) + 3, 0.5, 'taiko', null, 0.65); E(bar(8) + 3.5, 0.5, 'taiko', null, 0.8, { lo: true });

  // ---- C: the pack (bars 9-16) -----------------------------------------------
  for (let b = 9; b <= 16; b++) {
    const c = CH[PROG[(b - 9) % 4]], t = bar(b), build = (b - 9) / 7;
    // the ostinato: root, fifth, sixth, fifth, octave, fifth, sixth, fifth — the motif's intervals as an engine
    cell(c.six).forEach((iv, k) => E(t + k * 0.5, 0.42, 'cello', c.root + 12 + iv, (k % 2 ? 0.5 : 0.72) + build * 0.18, { tag: 'cell' }));
    E(t, 2.5, 'sub', c.root, 0.5 + build * 0.2, { drop: 1.5, dropT: 0.08 });
    for (const [o, lo, v] of [[0, true, 0.9], [1.5, false, 0.55], [2.5, true, 0.75], [3.5, false, 0.5]]) E(t + o, 0.5, 'taiko', null, v * (0.75 + build * 0.3), { lo, pan: lo ? -0.2 : 0.25 });
    for (const n of c.pad) E(t, 4.1, 'pad', n, 0.3, { a: 0.3, r: 0.8, bright: 1300 + build * 900 });
    if (b >= 13) {
      // the same cell twice as fast, two octaves up: the thing that makes it feel like it is accelerating
      for (let k = 0; k < 16; k++) E(t + k * 0.25, 0.2, 'cello', c.root + 36 + [0, 7, c.six, 12][k % 4], 0.3 + build * 0.2, { pan: 0.4, send: 0.4, tag: 'cell x2' });
      for (const n of c.hi) E(t, 4.1, 'choir', n, 0.34 + build * 0.2, { a: 0.6, r: 1 });
      E(t + 1, 0.4, 'snare', null, 0.55); E(t + 3, 0.4, 'snare', null, 0.62);
      for (let k = 0; k < 8; k++) E(t + k * 0.5, 0.2, 'hat', null, k % 2 ? 0.45 : 0.8);
    }
  }
  // horns: the question once, then its head climbing — D, F, A: the motif's own first chord
  phrase(ev, QUESTION, { at: bar(13), root: TONIC - 12, inst: 'brass', vel: 0.5, tag: 'question (horns)' });
  phrase(ev, head(QUESTION), { at: bar(15), root: TONIC - 12 + 3, inst: 'brass', vel: 0.58, rhythm: [1, 0.5, 0.5], tag: 'head +3' });
  phrase(ev, head(QUESTION), { at: bar(15) + 2, root: TONIC - 12 + 7, inst: 'brass', vel: 0.64, rhythm: [1, 0.5, 0.5], tag: 'head +7' });
  phrase(ev, head(QUESTION), { at: bar(16), root: TONIC, inst: 'brass', vel: 0.72, rhythm: [1, 0.5, 2], tag: 'head +12' });
  E(bar(15), 7.5, 'riser', 50, 0.9);
  for (let k = 0; k < 14; k++) E(bar(16) + k * 0.25, 0.2, 'snare', null, 0.25 + k * 0.05, { send: 0.3 });
  // …and a hole: nothing at all on the last half-beat of bar 16

  // ---- D: night (bars 17-20) ---------------------------------------------------
  E(bar(17), 4, 'boom', null, 1); E(bar(17), 8, 'sub', 38, 0.9, { drop: 3, dropT: 0.3 });
  E(bar(17), 15, 'drone', 38, 0.7, { a: 0.4, r: 2 });
  for (const n of CH.Dm.pad) E(bar(17), 8, 'pad', n, 0.3, { a: 2, r: 2, bright: 700 });
  for (const n of CH.Bb.pad) E(bar(19), 7.6, 'pad', n, 0.34, { a: 1.5, r: 1, bright: 900 });
  // the question backwards, two beats a note: G F A Bb A D — it walks home in the dark
  phrase(ev, retro(QUESTION), { at: bar(17) + 2, root: TONIC + 12, inst: 'bell', vel: 0.6, rhythm: [2], hold: 4, echo: 0.4, tag: 'retrograde' });
  phrase(ev, retro(QUESTION), { at: bar(17) + 2, root: TONIC, inst: 'piano', vel: 0.4, rhythm: [2], hold: 4, tag: 'retrograde' });
  for (let b = 17; b <= 20; b++) { E(bar(b), 0.5, 'taiko', null, 0.42, { lo: true, send: 0.6 }); E(bar(b) + 0.75, 0.5, 'taiko', null, 0.3, { lo: true, send: 0.6 }); }
  E(bar(20), 4, 'swell', null, 0.9); E(bar(20), 4, 'riser', 37, 0.8);
  for (const [o, v] of [[2, 0.5], [2.5, 0.6], [3, 0.72], [3.25, 0.8], [3.5, 0.9], [3.75, 1]]) E(bar(20) + o, 0.4, 'taiko', null, v, { lo: o * 4 % 2 === 0 });

  // ---- E: the statement (bars 21-28) -------------------------------------------
  for (let b = 21; b <= 28; b++) {
    const c = CH[PROG[(b - 21) % 4]], t = bar(b), second = b >= 25, last = b === 28;
    cell(c.six).forEach((iv, k) => E(t + k * 0.5, 0.42, 'cello', c.root + 12 + iv, k % 2 ? 0.62 : 0.85, { tag: 'cell' }));
    for (let k = 0; k < 16; k++) E(t + k * 0.25, 0.2, 'cello', c.root + 36 + [0, 7, c.six, 12][k % 4], second ? 0.5 : 0.4, { pan: 0.4, send: 0.4, tag: 'cell x2' });
    E(t, 3.6, 'sub', c.root, 0.8, { drop: 1.5, dropT: 0.08 });
    for (const n of c.pad) E(t, 4.1, 'pad', n, 0.34, { a: 0.2, r: 0.7, bright: 2400 });
    for (const n of c.hi) E(t, 4.1, 'choir', n, second ? 0.6 : 0.45, { a: 0.4, r: 0.9 });
    if (!last) {
      for (const [o, lo, v] of [[0, true, 1], [0.75, false, 0.6], [1.5, false, 0.7], [2, true, 0.9], [2.75, false, 0.6], [3.5, true, 0.75]]) E(t + o, 0.5, 'taiko', null, v, { lo, pan: lo ? -0.2 : 0.25 });
      E(t + 1, 0.4, 'snare', null, 0.75); E(t + 3, 0.4, 'snare', null, 0.8);
      for (let k = 0; k < (second ? 16 : 8); k++) E(t + k * (second ? 0.25 : 0.5), 0.15, 'hat', null, k % (second ? 4 : 2) ? 0.4 : 0.85);
    }
  }
  E(bar(21), 4, 'boom', null, 0.9); E(bar(25), 4, 'boom', null, 0.85);
  // the motif, whole, in brass: question (over Dm, Bb), answer (over F, C)…
  for (const [oct, v] of [[0, 0.95], [-12, 0.8]]) {
    phrase(ev, QUESTION, { at: bar(21), root: TONIC + oct, inst: 'brass', vel: v, tag: 'QUESTION' });
    phrase(ev, ANSWER, { at: bar(23), root: TONIC + oct, inst: 'brass', vel: v, tag: 'ANSWER' });
  }
  // …and again an octave higher with voices and a bell on top
  for (const [oct, inst, v] of [[12, 'brass', 0.9], [0, 'brass', 0.85], [12, 'bell', 0.5], [24, 'bell', 0.3]]) {
    phrase(ev, QUESTION, { at: bar(25), root: TONIC + oct, inst, vel: v, tag: 'QUESTION 8va' });
    // the last answer broadens: its two closing notes take a bar each
    phrase(ev, ANSWER, { at: bar(27), root: TONIC + oct, inst, vel: v, rhythm: [1, 1, 0.5, 0.5, 1, 3.5], tag: 'ANSWER 8va, broadened' });
  }
  // bar 28: the drums become the motif's rhythm, then stop dead half a beat early
  for (const [o, v] of [[0, 1], [1, 0.9], [2, 0.95], [2.5, 0.8], [3, 1]]) { E(bar(28) + o, 0.5, 'taiko', null, v, { lo: true }); E(bar(28) + o, 0.4, 'snare', null, v * 0.8); }
  E(bar(27), 7.5, 'riser', 55, 1);

  // ---- F: title (bars 29-32) -----------------------------------------------------
  E(bar(29), 4, 'boom', null, 1); E(bar(29), 12, 'sub', 38, 1, { drop: 4, dropT: 0.7 });
  E(bar(29), 14, 'drone', 38, 0.7, { a: 0.2, r: 3 });
  for (const n of [50, 57, 62, 65]) E(bar(29), 9, 'choir', n, 0.42, { a: 0.3, r: 3 });
  for (const n of [38, 50, 57]) E(bar(29), 10, 'pad', n, 0.3, { a: 0.3, r: 3, bright: 1100 });
  // the echo: the answer, quiet, alone, as it began
  phrase(ev, ANSWER, { at: bar(31), root: TONIC + 12, inst: 'piano', vel: 0.42, hold: 4, send: 0.95, tag: 'answer (echo)' });
  E(bar(32) + 2, 2, 'bell', TONIC + 24, 0.22, { echo: 0.5 });

  // ---- the cuts -------------------------------------------------------------------
  for (const b of [44, 48, 52, 56, 60, 92, 96, 104, 108]) E(b - 0.5, 0.75, 'whoosh', null, 0.5);
  for (const [b, from] of [[41, -0.8], [43.2, 0.8], [45.4, -0.6], [67.5, -0.9], [69.1, 0.9], [84.8, -0.7], [92.3, 0.7]]) E(b, 2.4, 'flyby', null, 0.42, { from, f0: 240 + (b % 5) * 22 });
  E(64, 15.5, 'rain', null, 0.9, { a: 0.3, r: 0.4 }); E(112, 15, 'rain', null, 0.5, { a: 1.5, r: 2 });

  const sections = [
    { name: 'A  DAWN', from: 0, to: 16, meter: '4/4, bars 1-4', what: 'The motif alone on a distant piano in the hall. A low D drone creeps in under the answer.',
      motif: [`question  ${spell(QUESTION)}  piano, beat 0`, `answer    ${spell(ANSWER)}  piano, beat 8`] },
    { name: 'B  LIGHT', from: 16, to: 32, meter: 'bars 5-8', what: 'Strings (Dm Bb F C) under the motif an octave up on piano + bell; low strings start a pulse on root and fifth; reversed cymbal and three drums into the cut.',
      motif: [`question 8va  ${spell(QUESTION, TONIC + 12)}  beat 16`, `answer 8va  ${spell(ANSWER, TONIC + 12)}  beat 24`, 'pulse = the motif\'s first leap (root, fifth)'] },
    { name: 'C  THE PACK', from: 32, to: 64, meter: 'bars 9-16', what: 'Ostinato in the low strings, taiko, sub on every bar. From bar 13 the cell doubles speed two octaves up, choir, snare and hats; horns state the question then climb its head; riser and snare roll; SILENCE on the last half-beat.',
      motif: ['cell (the intervals as an ostinato): root 5th 6th 5th 8ve 5th 6th 5th, eighths, through Dm Bb F C', `question in horns  ${spell(QUESTION, TONIC - 12)}  beat 48`, `head rising: ${spell(head(QUESTION), TONIC - 9)} | ${spell(head(QUESTION), TONIC - 5)} | ${spell(head(QUESTION), TONIC)}  beats 56, 58, 60`] },
    { name: 'D  NIGHT', from: 64, to: 80, meter: 'bars 17-20', what: 'Boom + sub drop on the cut. Dark strings, a heartbeat on low drum, and the motif BACKWARDS on a bell, two beats a note. Swell, riser and a drum pickup into the statement.',
      motif: [`retrograde  ${spell(retro(QUESTION), TONIC + 12)}  bell + piano, beats 66-76`] },
    { name: 'E  STATEMENT', from: 80, to: 112, meter: 'bars 21-28', what: 'Everything. The motif whole in stacked brass saws over the full ostinato, drums and choir; then again an octave higher with bells, the last answer broadened; bar 28 the drums play the motif\'s rhythm and stop half a beat early under a riser.',
      motif: [`QUESTION  brass  beat 80`, `ANSWER  brass  beat 88`, `QUESTION 8va  brass + bell  beat 96`, `ANSWER 8va, last two notes broadened  beat 104`, 'drums on the motif rhythm, beat 108'] },
    { name: 'F  TITLE', from: 112, to: 128, meter: 'bars 29-32', what: 'Sub drop (two octaves, 0.35 s) and a hit on the title; a held D chord in voices; then the answer once more, quiet, on the far piano.',
      motif: [`answer (echo)  ${spell(ANSWER, TONIC + 12)}  piano, beat 120`] },
  ];
  return { title: 'XBR — cinematic', bpm: 120, beats: 128, events: ev, sections, reverb: { seconds: 4.2, wet: 0.5, damp: 0.6, echo: 0.375 }, gain: 0.95, drive: 0.3 };
}
void RHYTHM; void stretch;
