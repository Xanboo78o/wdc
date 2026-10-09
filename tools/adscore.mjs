// adscore.mjs — print the two adverts' scores so a human can check them.
//
//   node tools/adscore.mjs            both
//   node tools/adscore.mjs deadpan    one
//
// Structure (sections, bars, which transformation of the motif plays where),
// note counts per instrument, and sanity checks: every event has a known
// instrument, a finite time inside the piece, and a sane pitch.
import { describe } from '../js/ads/motif.js';
const which = process.argv[2];
const INSTR = new Set((await import('fs')).readFileSync(new URL('../js/ads/synth.js', import.meta.url), 'utf8')
  .split('export const INST = {')[1].split('\n};')[0].match(/^  (\w+)\(R, ev/gm).map(s => s.trim().split('(')[0]));
let bad = 0;
for (const name of ['cinematic', 'deadpan']) {
  if (which && which !== name) continue;
  const { score } = await import(`../js/ads/score-${name}.js`);
  const s = score();
  console.log('='.repeat(100)); console.log(describe(s));
  const by = {}; let maxPoly = 0;
  for (const e of s.events) {
    by[e.i] = (by[e.i] || 0) + 1;
    const problems = [];
    if (!INSTR.has(e.i)) problems.push('unknown instrument');
    if (!Number.isFinite(e.t) || e.t < 0 || e.t >= s.beats) problems.push('time out of range');
    if (!(e.d > 0)) problems.push('no length');
    if (e.n != null && (!Number.isFinite(e.n) || e.n < 21 || e.n > 108)) problems.push('pitch out of range');
    if (!(e.v > 0 && e.v <= 1.2)) problems.push('velocity');
    if (problems.length) { bad++; console.log('  BAD EVENT', JSON.stringify(e), problems.join(', ')); }
  }
  const spb = 60 / s.bpm;
  for (let t = 0; t < s.beats; t += 0.25) { const p = s.events.filter(e => e.t <= t && e.t + e.d > t).length; if (p > maxPoly) maxPoly = p; }
  console.log(`\nTOTAL ${s.events.length} notes; per instrument: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`most notes sounding at once (by written length): ${maxPoly}; last note ends at ${(Math.max(...s.events.map(e => e.t + e.d)) * spb).toFixed(1)} s of ${(s.beats * spb).toFixed(1)} s`);
  // the gaps: stretches with no note STARTING, which is where the stop-time and the silences should be
  const starts = [...new Set(s.events.map(e => e.t))].sort((a, b) => a - b); const gaps = [];
  for (let k = 1; k < starts.length; k++) if (starts[k] - starts[k - 1] >= 1.24) gaps.push(`${starts[k - 1]}→${starts[k]}`);
  console.log(`gaps of a beat and a quarter or more between note starts: ${gaps.join('  ') || 'none'}`);
}
console.log(bad ? `\n${bad} BAD EVENTS` : '\nall events valid');
process.exit(bad ? 1 : 0);
