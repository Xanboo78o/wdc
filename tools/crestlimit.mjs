#!/usr/bin/env node
// crestlimit.mjs — a road cannot crest more sharply than a road is built.
//
//   node tools/crestlimit.mjs <key> [--radius 500] [--dry]
//
// WHY: SRTM is a SURFACE model. It reads a grandstand, a bridge or a stand of
// trees beside the road as ground, and the profile baked from it carries them
// as humps. The Nürburgring's main straight had one 2.5 m high with a crest
// radius of 67 m: at 180 km/h that is 3.8 g of "the road falling away", and the
// race (js/race.js, lift > g + downforce) threw every car into the air on a
// straight that is flat. Adam, 2026-10-08: "the first jump in nurburgring
// launches cars too high and far".
//
// WHAT: limits the vertical curvature of data/elev/<key>.json `s` (the height
// along the lap, 2 m samples, a closed loop) to 1/radius, by relaxing only the
// samples that break it until none does. Everything gentler is left exactly as
// surveyed. Run it after tools/getelev.mjs for any circuit whose dataset is a
// surface model. Circuits with real crests from a bare-earth survey, and the
// hand-built ones, must NOT be run through it.
import fs from 'node:fs';

const args = process.argv.slice(2), key = args.find(a => !a.startsWith('--'));
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? +args[i + 1] : d; };
if (!key) { console.error('usage: node tools/crestlimit.mjs <key> [--radius 500] [--dry]'); process.exit(2); }
const file = `data/elev/${key}.json`, E = JSON.parse(fs.readFileSync(file, 'utf8'));
const R = flag('radius', 500), ds = E.ds, n = E.s.length, kmax = 1 / R;
const before = Float64Array.from(E.s), h = Float64Array.from(E.s);
const curv = (a, i) => (a[(i + 1) % n] - 2 * a[i] + a[(i - 1 + n) % n]) / (ds * ds);
const worst = a => { let w = 0, at = 0; for (let i = 0; i < n; i++) { const c = Math.abs(curv(a, i)); if (c > w) { w = c; at = i; } } return [w, at]; };
const [w0, at0] = worst(h);
let passes = 0;
for (; passes < 400000; passes++) {
  let moved = false;
  for (let i = 0; i < n; i++) {
    const c = curv(h, i);
    if (Math.abs(c) <= kmax) continue;
    // move this sample just far enough that its own curvature is at the limit
    h[i] += (c - Math.sign(c) * kmax * 0.98) * ds * ds / 2 * 0.9;
    moved = true;
  }
  if (!moved) break;
}
const [w1] = worst(h);
let shift = 0, changed = 0;
for (let i = 0; i < n; i++) { const d = Math.abs(h[i] - before[i]); if (d > shift) shift = d; if (d > 0.01) changed++; }
console.log(`${key}: sharpest was R = ${(1 / w0).toFixed(0)} m at s = ${(at0 * ds).toFixed(0)} m; now R >= ${(1 / w1).toFixed(0)} m after ${passes} passes`);
console.log(`  ${changed} of ${n} samples moved more than 1 cm, the most by ${shift.toFixed(2)} m`);
if (args.includes('--dry')) process.exit(0);
E.s = Array.from(h, v => +v.toFixed(3));
E.crestLimit = R;
fs.writeFileSync(file, JSON.stringify(E));
console.log(`  wrote ${file}`);
