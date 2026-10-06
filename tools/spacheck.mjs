// spacheck.mjs — is Eau Rouge the real one?
//
// Adam, 2026-10-05: "eau rougue has to be 1:1". Two things can be held to
// that without a screen, and this holds them:
//
//   THE PLAN   the lap's length against the official 7004 m. The lap is OSM's
//              own ways for the circuit on an exact projection; the picture
//              proof (centreline and edges laid over the Walloon 2023 aerial
//              photograph, on the tarmac to about a metre) is in DESIGN.md.
//   THE HILL   the baked road height against the 0.5 m lidar post under the
//              SAME sample, every 2 m from La Source to the top of Raidillon,
//              and round the whole lap. The bake medians and smooths; this is
//              what that cost.
//
// And it prints the hill, so the numbers people quote can be read off it.
//
//   node tools/spacheck.mjs [--break flat|squash|shift]   (a break must FAIL)
import fs from 'fs';
import { metresPerDegree } from './geodesy.mjs';

const args = process.argv.slice(2);
for (let k = 0; k < args.length; k += 2) if (args[k] !== '--break' || !['flat', 'squash', 'shift'].includes(args[k + 1])) { console.error(`spacheck: bad flag ${args[k]} ${args[k + 1] ?? ''}`); process.exit(2); }
const BREAK = args[1] || null;
const ROOT = new URL('../', import.meta.url).pathname;
const T = JSON.parse(fs.readFileSync(ROOT + 'data/tracks/spa.json', 'utf8'));
const E = JSON.parse(fs.readFileSync(ROOT + 'data/elev/spa.json', 'utf8'));
const env = JSON.parse(fs.readFileSync(ROOT + 'data/env/spa.json', 'utf8'));
const raw = JSON.parse(fs.readFileSync(ROOT + 'data/elev/raw/spa-wallonie.json', 'utf8'));
const { mx, my } = metresPerDegree('spa', env.lat0);
const n = T.x.length, ds = T.ds;
let prof = E.s.slice();
if (BREAK === 'flat') prof = prof.map(() => 0);
if (BREAK === 'squash') prof = prof.map(v => v * 0.9);
if (BREAK === 'shift') prof = prof.map((_, i) => E.s[(i + 10) % n]);          // the hill 20 m down the road

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ${detail}`); };
const at = s => Math.round(s / ds) % n;
const corner = name => T.corners.filter(c => c.name === name);

console.log(`Spa-Francorchamps — ${E.dataset || E.source || 'survey'}\n`);
console.log('[plan]');
check('lap length', Math.abs(T.length - 7004) / 7004 < 0.002, `${T.length.toFixed(0)} m against the official 7004 m (${((T.length - 7004) / 70.04).toFixed(2)}%)`);
check('Eau Rouge and Raidillon are corners', corner('Eau Rouge').length === 1 && corner('Raidillon').length === 2, `${corner('Eau Rouge').length} + ${corner('Raidillon').length} of ${T.corners.length}`);

// the survey post under each sample (the bake's own cache, by lat/lon key)
const post = i => { const la = env.lat0 + T.y[i] / my, lo = env.lon0 + T.x[i] / mx; const v = raw[`${la.toFixed(6)},${lo.toFixed(6)}`]; return v == null ? null : v - E.mean; };
const err = (i0, i1) => { let mxe = 0, sum = 0, k = 0, miss = 0; for (let i = i0; i !== i1; i = (i + 1) % n) { const p = post(i); if (p == null) { miss++; continue; } const d = Math.abs(prof[i] - p); mxe = Math.max(mxe, d); sum += d * d; k++; } return { max: mxe, rms: Math.sqrt(sum / Math.max(1, k)), k, miss }; };

const laSource = corner('La Source')[0], eau = corner('Eau Rouge')[0], raid = corner('Raidillon');
const i0 = at(laSource.s1), i1 = at(raid[1].s1 + 120);
console.log('\n[hill] La Source to the top of Raidillon');
const eh = err(i0, i1);
check('survey posts found under the road', eh.k > 300 && eh.miss === 0, `${eh.k} posts, ${eh.miss} missing`);
check('baked road against the lidar', eh.max < 0.35 && eh.rms < 0.12, `worst ${eh.max.toFixed(2)} m, rms ${eh.rms.toFixed(3)} m (limits 0.35 / 0.12)`);
let lo = i0, hi = i0;
for (let i = i0; i !== i1; i = (i + 1) % n) { if (prof[i] < prof[lo]) lo = i; }
for (let i = lo; i !== i1; i = (i + 1) % n) { if (prof[i] > prof[hi] || hi === i0) hi = i; }
const grade = (i, w = 5) => (prof[(i + w) % n] - prof[(i - w + n) % n]) / (2 * w * ds);
let gUp = 0, gUpAt = lo, gDn = 0, gDnAt = i0;
for (let i = i0; i !== i1; i = (i + 1) % n) { const g = grade(i); if (g > gUp) { gUp = g; gUpAt = i; } if (g < gDn) { gDn = g; gDnAt = i; } }
const drop = prof[i0] - prof[lo], rise = prof[hi] - prof[lo];
console.log(`        La Source exit ${(prof[i0] + E.mean).toFixed(1)} m  ->  the bottom ${(prof[lo] + E.mean).toFixed(1)} m at s=${(lo * ds).toFixed(0)}  ->  ${(prof[hi] + E.mean).toFixed(1)} m at s=${(hi * ds).toFixed(0)}`);
console.log(`        down ${drop.toFixed(1)} m (steepest ${(gDn * 100).toFixed(1)}% at s=${(gDnAt * ds).toFixed(0)}), up ${rise.toFixed(1)} m in ${((hi - lo + n) % n * ds).toFixed(0)} m (steepest ${(gUp * 100).toFixed(1)}% at s=${(gUpAt * ds).toFixed(0)})`);
// Judged against the SURVEY's own hill, measured the same way, not a number off a website.
const sp = []; for (let i = 0; i < n; i++) sp.push(post(i));
const sgrade = (i, w = 5) => { const a = sp[(i + w) % n], b = sp[(i - w + n) % n]; return a == null || b == null ? null : (a - b) / (2 * w * ds); };
let sUp = 0; for (let i = i0; i !== i1; i = (i + 1) % n) { const g = sgrade(i); if (g != null && g > sUp) sUp = g; }
check('the bottom is inside Eau Rouge', lo * ds > eau.s0 - 40 && lo * ds < eau.s1 + 40, `s=${(lo * ds).toFixed(0)}, the corner is s=${eau.s0}-${eau.s1}`);
check('steepest climb against the survey\'s', Math.abs(gUp - sUp) < 0.012, `${(gUp * 100).toFixed(1)}% baked, ${(sUp * 100).toFixed(1)}% on the lidar posts`);
check('the climb against the survey\'s', sp[hi] != null && sp[lo] != null && Math.abs(rise - (sp[hi] - sp[lo])) < 0.4, `${rise.toFixed(1)} m baked, ${(sp[hi] - sp[lo]).toFixed(1)} m lidar`);

console.log('\n[lap]');
const el = err(0, n - 1);
const range = Math.max(...prof) - Math.min(...prof);
check('whole lap against the lidar', el.max < 0.8 && el.rms < 0.15, `worst ${el.max.toFixed(2)} m, rms ${el.rms.toFixed(3)} m over ${el.k} posts`);
check('lowest to highest', Math.abs(range - 102.2) < 1.5, `${range.toFixed(1)} m (the figure quoted for the circuit is 102.2 m)`);
console.log(fails ? `\n${fails} FAILED${BREAK ? `  [--break ${BREAK}: this run SHOULD fail]` : ''}` : '\nall ok');
process.exit(fails && !BREAK ? 1 : 0);
