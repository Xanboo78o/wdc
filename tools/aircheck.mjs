// aircheck.mjs — who leaves the ground on a lap, where, how high and how far.
//
//   node tools/aircheck.mjs <track> [class] [laps] [grid] [--elev FILE]
//
// A race with the road's real gradient under it (data/elev/<track>.json `s`),
// which tools/race.mjs does not give it. For every flight: the lap distance it
// began at, the speed, the highest the car got above the road and how far it
// went. Written to settle "the first jump in nurburgring launches cars too
// high and far" with numbers, before and after tools/crestlimit.mjs.
import fs from 'node:fs';
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';

const argv = process.argv.slice(2), a = argv.filter((x, i) => !x.startsWith('--') && argv[i - 1] !== '--elev');
const key = a[0] || 'nurburgring', cls = a[1] || 'f1', laps = +(a[2] || 2), grid = +(a[3] || 8);
const ef = argv.includes('--elev') ? argv[argv.indexOf('--elev') + 1] : `data/elev/${key}.json`;
const E = JSON.parse(fs.readFileSync(ef, 'utf8'));
const { track, lines, spec } = loadTrack(key, cls);
const race = new Race({ track, lines, spec, slots: gridSlots(track, grid), laps, grid, tier: 'hard', player: false, seed: 3 });
const n = E.s.length, ds = track.length / n;
race.slopeAt = s => { const f = ((s / ds) % n + n) % n, i = Math.floor(f), j = (i + 1) % n; return (E.s[j] - E.s[i]) / ds; };

const fl = new Map(), flights = [];
let t = 0;
while (race.state !== 'over' && t < laps * 400 + 60) {
  race.tick(FIXED_DT, null); t += FIXED_DT;
  for (const e of race.entries) {
    const c = e.car, f = fl.get(e);
    if (c.airborne && !f) fl.set(e, { s: e.proj.s, v: c.speed, zmax: 0, x: c.x, y: c.y, name: e.name });
    else if (c.airborne && f) f.zmax = Math.max(f.zmax, c.z);
    else if (!c.airborne && f) { f.dist = Math.hypot(c.x - f.x, c.y - f.y); flights.push(f); fl.delete(e); }
  }
}
console.log(`${key} ${cls}: ${grid} cars, ${laps} laps, elevation ${ef}`);
console.log(`  flights: ${flights.length}`);
const by = {};
for (const f of flights) { const k = Math.round(f.s / 50) * 50; (by[k] = by[k] || []).push(f); }
for (const k of Object.keys(by).sort((p, q) => p - q)) {
  const L = by[k], mx = L.reduce((p, q) => (q.zmax > p.zmax ? q : p));
  console.log(`  s~${String(k).padStart(5)} m  x${String(L.length).padStart(3)}  highest ${mx.zmax.toFixed(2)} m, ${mx.dist.toFixed(0)} m long, taken at ${(mx.v * 3.6).toFixed(0)} km/h`);
}
console.log(`  finished: ${race.entries.filter(e => !e.retired).length} of ${grid}`);
