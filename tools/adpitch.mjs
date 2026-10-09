// adpitch.mjs — does the rendered audio actually play the motif?
//
//   node tools/adshot.mjs cinematic --audio      (writes /tmp/xbr-ads/ad-cinematic.wav)
//   node tools/adpitch.mjs cinematic
//
// Takes the WAV that adshot rendered through the real synth, and at the moment
// each note of a few exposed motif statements is supposed to start, measures
// which pitch is loudest (a Goertzel filter per semitone). It is a check that
// the notes written are the notes sounding — it says nothing about whether it
// sounds GOOD; only ears can.
import fs from 'fs';
import { NOTE } from '../js/ads/motif.js';
const which = process.argv[2] || 'cinematic';
const { score } = await import(`../js/ads/score-${which}.js`);
const s = score(), spb = 60 / s.bpm;
const buf = fs.readFileSync(process.argv[3] || `/tmp/xbr-ads/ad-${which}.wav`);
const sr = buf.readUInt32LE(24), pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
const power = (t0, len, f) => {
  const i0 = Math.floor(t0 * sr), n = Math.floor(len * sr), w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { const x = (pcm[i0 + i] || 0) / 32768 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); const y = x + c * a - b; b = a; a = y; }
  return a * a + b * b - c * a * b;
};
// exposed statements: pick, per tag, the events of one solo-ish instrument
const picks = which === 'cinematic'
  ? [['piano', 'question'], ['piano', 'answer'], ['bell', 'retrograde'], ['brass', 'QUESTION'], ['piano', 'answer (echo)']]
  : [['marimba', 'question (major)'], ['marimba', 'answer (major)'], ['trombone', 'sad'], ['musicbox', 'inversion, wrong key'], ['musicbox', 'a star'], ['marimba', 'retrograde, one per car']];
let ok = 0, total = 0;
for (const [inst, tag] of picks) {
  const ev = s.events.filter(e => e.i === inst && e.tag === tag).sort((a, b) => a.t - b.t);
  if (!ev.length) { console.log(`${inst} "${tag}": no events`); continue; }
  const top = ev.reduce((m, e) => Math.max(m, e.n), 0);
  const line = ev.filter(e => e.n >= top - 14).slice(0, 7);      // the upper voice if it is doubled in octaves
  const out = [];
  for (const e of line) {
    const t = 0.05 + e.t * spb + (inst === 'trombone' ? Math.min(e.d * spb * 0.8, 0.9) : 0.03);
    let best = -1, bp = 0;
    for (let n = e.n - 7; n <= e.n + 7; n++) { const p = power(t, 0.14, 440 * 2 ** ((n - 69) / 12)); if (p > bp) { bp = p; best = n; } }
    total++; if (best === e.n) ok++;
    out.push(`${NOTE(e.n)}${best === e.n ? '' : '≠' + NOTE(best)}`);
  }
  console.log(`${inst.padEnd(9)} ${('"' + tag + '"').padEnd(28)} @${(line[0].t * spb).toFixed(1).padStart(5)}s  ${out.join(' ')}`);
}
console.log(`${ok}/${total} notes measured at the written pitch (within ±7 semitones searched)`);
