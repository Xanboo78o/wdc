// score-deadpan.js — the explainer's music. 108 BPM, mostly in 7/8.
//
// The SAME motif as the trailer (js/ads/motif.js), in the major, on things you
// pluck: a marimba, pizzicato strings, a music box, a clarinet from head
// office and a wooden clock. The motif is six beats long, so with one beat of
// air it is exactly two bars of 7/8 — the tune itself is why the bars limp.
//
// It behaves until the picture stops behaving:
//
//   stop-time     the clock alone, slowing, and the first two notes left hanging   ("...a bit")
//   silence       the cut to turn one has no music in it at all
//   sad trombone  notes 2-5 of the motif in the MINOR, sliding, drooping to the tonic instead of rising
//   inversion     upside down and a semitone too high, clock on the off-beats      (physics)
//   diminution    four times too fast, climbing a step each time                    (the small print)
//   the stars     its first five notes, one per star
//   retrograde    backwards, one note per car                                       (the AI)
//   the smug one  the answer in sixths, cadence — and the last note withheld, then delivered late
//
// CUE is the single timeline: the picture (js/ads/deadpan.js) cuts on these beats.
import { QUESTION, ANSWER, RHYTHM, major, invert, retro, head, phrase, spell, TONIC, stretch, transpose } from './motif.js';

export const CUE = {
  intro: 0, grid: 14, pros: 28, abit: 38.5, t1: 43.5, unskilled: 49.5,
  tyres: 55.5, physics: 69.5, cartwheel: 73, small: 83.5, review: 90.5,
  ai: 101, lemmings: 108, end: 115, black: 119, ding: 121, fin: 125,
};
// moments inside scenes that the picture and the sound both hang on
export const HIT = { pass: 45.35, thud: 47.9, stars: [91, 91.5, 92, 92.5, 93], cars: [108.5, 109.5, 110.5, 111.5, 112.5, 113.5] };

const BAR = 3.5;                         // 7/8
const MQ = major(QUESTION), MA = major(ANSWER);
const HI = TONIC + 12;                   // D5, where the marimba sings
// the motif as steps of the D major scale, so it can climb the scale and stay in key
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const MQ_DEG = [0, 4, 5, 4, 2, 3];
const dia = (degs, k) => degs.map(d => { const x = d + k; return SCALE[((x % 7) + 7) % 7] + 12 * Math.floor(x / 7); });

export function score() {
  const ev = [];
  const E = (t, d, i, n, v, x = {}) => ev.push({ t, d, i, n, v, ...x });

  // one bar of the limping clock, on a chord (root as a midi note in octave 2)
  const groove = (t, root, { v = 1, bass = true, comp = true, shake = false, third = 4 } = {}) => {
    E(t, 0.2, 'tick', null, 0.8 * v); E(t + 1, 0.2, 'tick', null, 0.7 * v, { tock: true });
    E(t + 2, 0.2, 'tick', null, 0.75 * v); E(t + 3, 0.2, 'tick', null, 0.7 * v, { tock: true });
    if (bass) { E(t, 0.8, 'tuba', root, 0.8 * v); E(t + 2, 0.6, 'tuba', root + 7, 0.6 * v); E(t + 3, 0.4, 'tuba', root + 7, 0.5 * v); }
    if (comp) for (const o of [0.5, 1.5, 2.5]) { E(t + o, 0.3, 'pizz', root + 24 + third, 0.38 * v, { pan: 0.3 }); E(t + o, 0.3, 'pizz', root + 24 + 7, 0.38 * v, { pan: 0.3 }); }
    if (shake) for (let k = 0; k < 7; k++) E(t + k * 0.5, 0.1, 'shaker', null, k % 2 ? 0.5 : 0.9);
  };
  const D = 38, G = 43, A = 45;

  // ---- 1. intro (0-14): the tune, plainly --------------------------------------
  [D, D, G, A].forEach((r, k) => groove(CUE.intro + k * BAR, r, { bass: k >= 2, comp: k >= 1 }));
  phrase(ev, MQ, { at: CUE.intro, root: HI, inst: 'marimba', vel: 0.85, tag: 'question (major)' });
  phrase(ev, MA, { at: CUE.intro + 7, root: HI, inst: 'marimba', vel: 0.85, tag: 'answer (major)' });
  phrase(ev, MA, { at: CUE.intro + 7, root: TONIC, inst: 'pizz', vel: 0.5, tag: 'answer (major)' });

  // ---- 2. the grid (14-28): on the subdominant, with the man from head office ---
  [G, G, A, D].forEach((r, k) => groove(CUE.grid + k * BAR, r, { shake: true }));
  phrase(ev, MQ, { at: CUE.grid, root: HI + 5, inst: 'marimba', vel: 0.8, tag: 'question on IV' });
  phrase(ev, MQ, { at: CUE.grid, root: TONIC + 5, inst: 'reed', vel: 0.6, tag: 'question on IV' });
  phrase(ev, MA, { at: CUE.grid + 7, root: HI, inst: 'marimba', vel: 0.85, tag: 'answer' });
  phrase(ev, MA, { at: CUE.grid + 7, root: TONIC, inst: 'reed', vel: 0.62, tag: 'answer' });
  phrase(ev, MA, { at: CUE.grid + 7, root: HI + 12, inst: 'musicbox', vel: 0.4, tag: 'answer' });

  // ---- 3. professionals (28-38.5): the head, climbing, very pleased with itself --
  [0, 1, 2].forEach((step, k) => {
    const t = CUE.pros + k * BAR, up = SCALE[step];
    groove(t, D + up, { shake: true, third: step === 0 ? 4 : 3 });
    dia([0, 4, 5, 4, 7, 5, 4], step).forEach((iv, j) => {
      E(t + j * 0.5, 0.45, 'marimba', HI + iv, j % 2 ? 0.6 : 0.82, { tag: 'head, rising' });
      if (k === 2) E(t + j * 0.5, 0.4, 'musicbox', HI + 12 + iv, 0.36);
    });
  });

  // ---- 4. "...a bit" (38.5-43.5): stop-time ---------------------------------------
  E(38.5, 0.2, 'tick', null, 0.85); E(39.75, 0.2, 'tick', null, 0.7, { tock: true });
  E(41, 0.2, 'tick', null, 0.6); E(42.4, 0.2, 'tick', null, 0.5, { tock: true });
  E(38.5, 1, 'pizz', TONIC, 0.5, { tag: 'first two notes, left hanging' }); E(41, 1, 'pizz', TONIC + 7, 0.42, { tag: 'first two notes, left hanging' });

  // ---- 5. turn one (43.5-49.5): no music -------------------------------------------
  E(HIT.pass - 1.5, 2.9, 'flyby', null, 0.95, { peak: 0.52, f0: 300, fall: 0.55, from: 0.2 });
  E(HIT.thud, 1, 'thud', null, 0.75);
  E(HIT.thud + 0.7, 0.3, 'clink', null, 0.8); E(HIT.thud + 0.98, 0.3, 'clink', null, 0.55, { k: 1.22 }); E(HIT.thud + 1.16, 0.3, 'clink', null, 0.35, { k: 0.88 });

  // ---- 6. "unskilled." (49.5-55.5): the trombone ------------------------------------
  // notes 2-5 of the motif in the MINOR (A Bb A F) — and where the tune rises to G, this one sags to D
  E(50, 0.7, 'trombone', 57, 0.75, { from: 58, glide: 0.5, tag: 'sad' });
  E(50.75, 0.7, 'trombone', 58, 0.75, { from: 59, glide: 0.5, tag: 'sad' });
  E(51.5, 0.7, 'trombone', 57, 0.75, { from: 58, glide: 0.5, tag: 'sad' });
  E(52.25, 2.7, 'trombone', 50, 0.85, { from: 53, glide: 0.8, wait: 0.3, tag: 'sad' });
  E(55, 0.4, 'tuba', D, 0.6);

  // ---- 7. tyre management (55.5-69.5): as if nothing happened --------------------------
  [D, D, G, A].forEach((r, k) => groove(CUE.tyres + k * BAR, r, { shake: true }));
  phrase(ev, MQ, { at: CUE.tyres, root: HI, inst: 'marimba', vel: 0.85, tag: 'question' });
  phrase(ev, MQ, { at: CUE.tyres, root: TONIC, inst: 'reed', vel: 0.55, tag: 'question' });
  phrase(ev, MA, { at: CUE.tyres + 7, root: HI, inst: 'marimba', vel: 0.85, tag: 'answer' });
  phrase(ev, MA, { at: CUE.tyres + 7, root: TONIC, inst: 'reed', vel: 0.55, tag: 'answer' });
  phrase(ev, MA, { at: CUE.tyres + 7, root: HI + 12, inst: 'musicbox', vel: 0.32, tag: 'answer' });

  // ---- 8. physics (69.5-83.5) -----------------------------------------------------------
  groove(CUE.physics, D, { shake: true });
  phrase(ev, head(MQ, 4), { at: CUE.physics, root: HI, inst: 'marimba', vel: 0.85, rhythm: [1, 1, 0.5, 1], tag: 'head' });
  // the cut: upside down, a semitone too high, the clock on the wrong beats
  const INV = invert(QUESTION);
  for (let k = 0; k < 2; k++) {
    const t = CUE.cartwheel + k * BAR;
    for (const o of [0.5, 1.5, 2.5]) E(t + o, 0.2, 'tick', null, 0.7, { tock: o !== 1.5 });
    E(t, 0.7, 'tuba', 39, 0.7); E(t + 2, 0.6, 'tuba', 33, 0.6);
  }
  phrase(ev, INV, { at: CUE.cartwheel, root: HI + 1, inst: 'musicbox', vel: 0.7, tag: 'inversion, wrong key' });
  phrase(ev, INV, { at: CUE.cartwheel, root: HI + 1, inst: 'marimba', vel: 0.6, tag: 'inversion, wrong key' });
  phrase(ev, INV, { at: CUE.cartwheel, root: HI + 1 - 6, inst: 'pizz', vel: 0.34, tag: 'inversion, a tritone under itself' });
  // then backwards, as the car goes up
  phrase(ev, retro(INV).slice(0, 4), { at: 80, root: TONIC + 1, inst: 'reed', vel: 0.6, rhythm: [0.75, 0.75, 0.75, 1.25], len: 0.9, tag: 'retrograde inversion' });
  E(80.4, 3, 'trombone', 66, 0.5, { from: 51, glide: 1, wait: 0.1, tag: 'slide up' });

  // ---- 9. the small print (83.5-90.5): four times too fast -------------------------------
  const FAST = stretch(RHYTHM, 0.25);
  [0, 1, 2, 3].forEach((step, k) => {
    const t = CUE.small + k * 1.5, line = dia(MQ_DEG, step);
    phrase(ev, line, { at: t, root: HI, inst: 'marimba', vel: 0.8, rhythm: FAST, tag: 'diminution x4' });
    phrase(ev, line, { at: t, root: HI + 12, inst: 'musicbox', vel: 0.34, rhythm: FAST, tag: 'diminution x4' });
  });
  for (let k = 0; k < 26; k++) E(CUE.small + k * 0.25, 0.1, 'shaker', null, k % 2 ? 0.6 : 1);
  for (let k = 0; k < 13; k++) { E(CUE.small + k * 0.5, 0.2, 'tick', null, 0.6, { tock: k % 2 === 1 }); E(CUE.small + k * 0.5, 0.3, 'tuba', D + [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 4, 2][k], 0.6); }
  // a tumble down the scale and a rest on the last eighth
  [12, 11, 9, 7].forEach((iv, j) => E(CUE.small + 6 + j * 0.125, 0.12, 'marimba', HI + iv, 0.7));

  // ---- 10. the review (90.5-101): one note of the motif per star ---------------------------
  HIT.stars.forEach((t, k) => { E(t, 1.2, 'musicbox', HI + 12 + MQ[k], 0.75, { echo: 0.25, tag: 'a star' }); E(t, 0.2, 'tick', null, 0.4, { tock: k % 2 === 1 }); });
  phrase(ev, MA, { at: 94, root: TONIC, inst: 'reed', vel: 0.62, tag: 'answer, legato' });
  for (let b = 94; b < 100; b += 1) { E(b, 0.4, 'pizz', (b % 2 ? A : D) + 12, 0.42); E(b + 0.5, 0.3, 'pizz', TONIC + (b % 2 ? 7 : 4), 0.3, { pan: 0.3 }); }
  E(100, 0.3, 'tick', null, 0.5, { tock: true });

  // ---- 11. the AI (101-115) ---------------------------------------------------------------
  groove(CUE.ai, D, { shake: true }); groove(CUE.ai + BAR, A, { shake: true });
  phrase(ev, MQ, { at: CUE.ai, root: HI, inst: 'marimba', vel: 0.85, tag: 'question' });
  phrase(ev, MQ, { at: CUE.ai, root: TONIC, inst: 'reed', vel: 0.5, tag: 'question' });
  // backwards, one note per car
  const BACK = retro(MQ);
  HIT.cars.forEach((t, k) => {
    E(t, 0.4, 'marimba', HI + BACK[k], 0.85, { tag: 'retrograde, one per car' }); E(t, 0.4, 'pizz', TONIC + BACK[k], 0.6);
    E(t, 0.4, 'tuba', D, 0.55); E(t + 0.5, 0.2, 'tick', null, 0.45, { tock: true });
  });

  // ---- 12. the end card (115-125): smug --------------------------------------------------------
  groove(CUE.end, D, { shake: true });
  const SMUG = MA.slice(0, 5), UNDER = [-3, -3, -4, -3, -3];
  phrase(ev, SMUG, { at: CUE.end, root: HI, inst: 'marimba', vel: 0.9, rhythm: [1, 1, 0.5, 0.5, 1], tag: 'answer in sixths — last note withheld' });
  phrase(ev, SMUG, { at: CUE.end, root: TONIC, inst: 'reed', vel: 0.62, rhythm: [1, 1, 0.5, 0.5, 1], tag: 'answer' });
  phrase(ev, SMUG.map((n, k) => n + UNDER[k]), { at: CUE.end, root: HI, inst: 'musicbox', vel: 0.5, rhythm: [1, 1, 0.5, 0.5, 1], tag: 'a third under' });
  E(CUE.end + 3, 0.9, 'tuba', A, 0.8);
  // …nothing at 119, where the tonic belongs. Two beats later, alone:
  E(CUE.ding, 2.5, 'musicbox', HI + 12, 0.8, { echo: 0.2, tag: 'the withheld tonic' }); E(CUE.ding, 2, 'marimba', HI, 0.6);
  E(CUE.ding, 0.6, 'tuba', D, 0.7); E(CUE.ding, 0.2, 'tick', null, 0.6);

  const S = (a, b) => ({ from: CUE[a], to: CUE[b] });
  const sections = [
    { name: '1  intro', ...S('intro', 'grid'), meter: '4 bars of 7/8', what: 'Limping clock (tick tock tick tock, then the bar is an eighth short), tuba and pizzicato. The motif in D major on marimba.',
      motif: [`question (major)  ${spell(MQ, HI)}`, `answer (major)  ${spell(MA, HI)}`] },
    { name: '2  the grid', ...S('grid', 'pros'), meter: '4 bars of 7/8', what: 'Same, with a clarinet doubling and a music box on top.', motif: [`question on IV  ${spell(MQ, HI + 5)}`, 'answer back in D'] },
    { name: '3  professionals', ...S('pros', 'abit'), meter: '3 bars of 7/8', what: 'The head of the motif as a running figure, climbing D, E, F# — and never arriving.', motif: ['head (0 7 9) extended to a 7-eighth cell, sequenced up by step'] },
    { name: '4  "...a bit"', ...S('abit', 't1'), meter: '5 beats, stop-time', what: 'Everything stops. Four clock strokes, each later than it should be, and the first two notes of the motif (D, A) left hanging. Rest exactly on the cut.', motif: ['first two notes only'] },
    { name: '5  turn one', ...S('t1', 'unskilled'), meter: '6 beats', what: 'No music. A car goes past (Doppler), and a long way off something lands and a hubcap settles.', motif: ['(none — the joke is the silence)'] },
    { name: '6  "unskilled."', ...S('unskilled', 'tyres'), meter: '6 beats', what: 'Sad trombone: notes 2-5 of the motif in the minor, each slid into, the last sagging from F to D where the tune would rise to G. One tuba note of comment.', motif: ['A Bb A F→D  (minor, slides)'] },
    { name: '7  tyre management', ...S('tyres', 'physics'), meter: '4 bars of 7/8', what: 'The full tune again, question and answer, exactly as in the intro, as if nothing had happened.', motif: ['question, answer (major)'] },
    { name: '8  physics', ...S('physics', 'small'), meter: '1 bar 7/8, then 3', what: 'One normal bar; on the cut the motif turns upside down a semitone too high (Eb), with itself a tritone lower, the clock on the off-beats and the tuba swapping Eb and A. Last bar: that inversion backwards on clarinet while a trombone slides UP an octave and a bit.',
      motif: [`inversion in the wrong key  ${spell(INV, HI + 1)}`, `retrograde inversion  ${spell(retro(INV).slice(0, 4), TONIC + 1)}`] },
    { name: '9  the small print', ...S('small', 'review'), meter: '2 bars of 7/8', what: 'The motif four times too fast (sixteenths), four statements climbing D E F# G, tuba walking the scale in eighths, shaker in sixteenths; a tumble and a rest on the last eighth.', motif: ['diminution x4, sequenced'] },
    { name: '10 the review', ...S('review', 'ai'), meter: '3 bars of 7/8', what: 'Five music-box notes, one per star — they are the motif\'s first five. Then the answer, legato, on the clarinet over a polite pizzicato.', motif: [`stars: ${spell(MQ.slice(0, 5), HI + 12)}`, 'answer (major), legato'] },
    { name: '11 the AI', ...S('ai', 'end'), meter: '4 bars of 7/8', what: 'Two normal bars of the tune. Then the motif BACKWARDS, one note per car, each with a tuba bomp.', motif: [`retrograde  ${spell(BACK, HI)}  one note per car`] },
    { name: '12 end card', ...S('end', 'fin'), meter: '1 bar 7/8, silence, a ding', what: 'The answer harmonised in sixths, heading for its cadence — and cut off before the last note (picture cuts to black with it). Two beats of nothing. Then the missing tonic, alone, on the music box.', motif: [`answer in sixths, first five notes  ${spell(SMUG, HI)}`, 'the withheld tonic D, two beats late'] },
  ];
  return { title: 'XBR — deadpan', bpm: 108, beats: CUE.fin, events: ev, sections, reverb: { seconds: 1.5, wet: 0.3, damp: 0.5, echo: 0.2778, pre: 0.008 }, gain: 0.95, drive: 0.42 };
}
void transpose; void ANSWER;
