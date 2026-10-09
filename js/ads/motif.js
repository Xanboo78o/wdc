// motif.js — the XBR motif, and every way the two adverts bend it.
//
//        D   A   Bb  A   F   G            (the QUESTION — it ends a step up, open)
//        D   A   Bb  A   E   D            (the ANSWER — same head, comes home)
//
//   in semitones above the tonic:   0  7  8  7  3  5      /     0  7  8  7  2  0
//   rhythm, in beats:               1  1  ½  ½  1  2      (six beats; with one beat of
//                                                          air it is exactly two bars of 7/8)
//
// A leap of a fifth, a semitone of ache above it, back, and then either a
// question or a full stop. Everything in both scores is one of these, turned:
//
//   major()      the same shape in the major scale (b6 -> 6, b3 -> 3): the puzzle-box version
//   invert()     upside down, about the first note            (things going wrong)
//   retro()      backwards                                    (aftermath; the night)
//   transpose()  somewhere else — up a semitone is "the wrong key"
//   head/tail    the first three notes / the last two
//   cell()       its intervals as an ostinato: root, fifth, sixth, fifth, octave, fifth, sixth, fifth
//   stretch()    the rhythm slower or faster (augmentation / diminution)
//
// Pure data and pure functions: this file runs in Node (tools/adscore.mjs).
export const TONIC = 62;                                    // D4
export const QUESTION = [0, 7, 8, 7, 3, 5];
export const ANSWER = [0, 7, 8, 7, 2, 0];
export const RHYTHM = [1, 1, 0.5, 0.5, 1, 2];

export const transpose = (iv, k) => iv.map(n => n + k);
export const invert = iv => iv.map(n => 2 * iv[0] - n);
export const retro = iv => iv.slice().reverse();
export const major = iv => iv.map(n => { const o = Math.floor(n / 12) * 12, d = n - o; return o + (d === 8 ? 9 : d === 3 ? 4 : d === 10 ? 11 : d); });
export const head = (iv, k = 3) => iv.slice(0, k);
export const tail = (iv, k = 2) => iv.slice(-k);
export const stretch = (rh, k) => rh.map(d => d * k);
// The sixth above each root that belongs to D minor, so the cell stays in key
// when it moves through the chords.
export const cell = sixth => [0, 7, sixth, 7, 12, 7, sixth, 7];

/**
 * Lay a line of intervals out as events.
 *   at     beat of the first note
 *   root   midi note of interval 0
 *   rhythm how long until the next note, per note
 *   len    how long each note SOUNDS, as a share of its slot (or a fixed number via `hold`)
 */
export function phrase(out, iv, { at, root = TONIC, inst, rhythm = RHYTHM, vel = 0.8, len = 0.95, hold = null, accent = null, tag = '', ...extra }) {
  let t = at;
  for (let k = 0; k < iv.length; k++) {
    const d = rhythm[k % rhythm.length];
    out.push({ t, d: hold ?? d * len, i: inst, n: root + iv[k], v: vel * (accent ? accent[k % accent.length] : 1), tag, ...extra });
    t += d;
  }
  return t;
}

export const NOTE = n => ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
export const spell = (iv, root = TONIC) => iv.map(n => NOTE(root + n)).join(' ');

/** A printable account of a score, for a human to check the structure against. */
export function describe(score) {
  const lines = [];
  const spb = 60 / score.bpm;
  lines.push(`${score.title} — ${score.bpm} BPM, ${score.beats} beats, ${(score.beats * spb).toFixed(1)} s, ${score.events.length} notes`);
  lines.push(`motif: question ${spell(QUESTION)}   answer ${spell(ANSWER)}   rhythm ${RHYTHM.join(' ')}`);
  for (const s of score.sections) {
    const ev = score.events.filter(e => e.t >= s.from - 1e-6 && e.t < s.to - 1e-6);
    const by = {};
    for (const e of ev) by[e.i] = (by[e.i] || 0) + 1;
    lines.push('');
    lines.push(`${s.name.padEnd(22)} beats ${String(s.from).padStart(5)}–${String(s.to).padEnd(5)} ${(s.from * spb).toFixed(1).padStart(5)}–${(s.to * spb).toFixed(1).padEnd(5)} s  ${s.meter || ''}`);
    lines.push(`   ${s.what}`);
    for (const m of s.motif || []) lines.push(`   · ${m}`);
    lines.push(`   notes: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || '(silence)'}`);
  }
  return lines.join('\n');
}
