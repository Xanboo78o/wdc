// wallcheck.mjs — is a barrier standing where a car drives?
//
// Adam, 2026-10-06: "theres spots on spa where walls ar were they dhouldnt".
// A barrier is drawn at w + run from each sample's own centreline, and nothing
// checked where that lands. At La Source the pit-side run-off had been widened
// to 32 m on the INSIDE of an 11 m hairpin, so the rail was drawn across the
// other leg of the corner, 0.9 m from its centreline.
//
//   ON THE ROAD   a barrier point within the tarmac (+1.5 m) of any other
//                 part of the lap. Must be none. (A real crossover is exempt:
//                 the two centrelines themselves meet there.)
//   A STEP        the barrier moving sideways more than 3 m between two
//                 samples 2 m apart: a wall across the run-off.
//   THE PIT LANE  a barrier point within 3 m of the pit lane's own path,
//                 which the renderer hides but the physics does not.
//
//   node tools/wallcheck.mjs [track ...|all]
import fs from 'fs';
import { Track } from '../js/track.js';
const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
for (const a of args) if (a.startsWith('--')) { console.error('wallcheck: no flags'); process.exit(2); }
const all = fs.readdirSync(ROOT + 'data/tracks').filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const keys = !args.length || args[0] === 'all' ? all : args;
let bad = 0;
for (const key of keys) {
  const t = new Track(JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8')));
  if (!t.runL || !t.runR) { console.log(`${key.padEnd(12)} no run-off data`); continue; }
  const n = t.n, ds = t.ds;
  const L = (i, side) => t.w[i] + (side > 0 ? t.runL[i] : t.runR[i]);
  const wall = (i, side) => { const h = t.hdg[i], l = L(i, side); return [t.x[i] - Math.sin(h) * side * l, t.y[i] + Math.cos(h) * side * l]; };
  const runs = [], steps = [], pitHits = [];
  for (const side of [1, -1]) for (let i = 0; i < n; i++) {
    const [bx, by] = wall(i, side);
    let bd = Infinity, bj = -1;
    for (let j = 0; j < n; j++) {
      const al = Math.min(Math.abs(j - i), t.open ? Infinity : n - Math.abs(j - i));
      if (al < 12) continue;
      const d = (bx - t.x[j]) ** 2 + (by - t.y[j]) ** 2;
      if (d < bd) { bd = d; bj = j; }
    }
    bd = Math.sqrt(bd);
    const cross = Math.hypot(t.x[bj] - t.x[i], t.y[bj] - t.y[i]) < t.w[i] + t.w[bj] + 1;
    if (bj >= 0 && bd < t.w[bj] + 1.5 && !cross) {
      const r = runs[runs.length - 1];
      if (r && r.side === side && i - r.i1 <= 3) { r.i1 = i; r.min = Math.min(r.min, bd); }
      else runs.push({ side, i0: i, i1: i, min: bd, other: bj });
    }
    const j = (i + 1) % n;
    if ((!t.open || j) && Math.abs(L(j, side) - L(i, side)) > 3) steps.push(`${side > 0 ? 'L' : 'R'} s=${(i * ds).toFixed(0)} ${L(i, side).toFixed(1)}->${L(j, side).toFixed(1)}`);
    if (t.pit && t.pit.pts) for (const q of t.pit.pts) if ((q[0] - bx) ** 2 + (q[1] - by) ** 2 < 9) { pitHits.push(i); break; }
  }
  const ok = !runs.length && !steps.length;
  if (!ok) bad++;
  console.log(`${key.padEnd(12)} ${ok ? 'ok  ' : 'FAIL'}  on the road ${runs.length}   steps ${steps.length}   across the pit lane ${pitHits.length} samples`);
  for (const r of runs) console.log(`             ${r.side > 0 ? 'left ' : 'right'} wall of s=${(r.i0 * ds).toFixed(0)}-${(r.i1 * ds).toFixed(0)} is ${r.min.toFixed(1)} m from the centreline at s=${(r.other * ds).toFixed(0)}`);
  if (steps.length) console.log('             steps: ' + steps.slice(0, 8).join(' | ') + (steps.length > 8 ? ' …' : ''));
}
process.exit(keys.length === 1 && bad ? 1 : 0);
