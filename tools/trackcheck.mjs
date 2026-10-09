// trackcheck.mjs — is a baked circuit a sane road? Numbers, not a picture.
//
//   node tools/trackcheck.mjs <key> [--real <metres>]
//
// PLAN: does the lap close (position and heading), does it cross itself, where
// is the tightest corner, is there a kink (a heading step between two 2 m
// samples that no road has).
// PROFILE (data/elev/<key>.json): range, the steepest gradient, and the
// sharpest crests and dips with their vertical radius — and the speed at which
// a car goes light over each (v = sqrt(g R)), which is what makes a crest a jump.
import fs from 'fs';
import { Track } from '../js/track.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
let key = null, real = null;
for (let k = 0; k < args.length; k++) {
  if (args[k] === '--real' && args[k + 1] != null) real = +args[++k];
  else if (args[k].startsWith('--')) { console.error(`trackcheck: unknown flag ${args[k]}`); process.exit(2); }
  else if (key == null) key = args[k];
  else { console.error(`trackcheck: stray argument ${args[k]}`); process.exit(2); }
}
if (!key) { console.error('usage: node tools/trackcheck.mjs <key> [--real metres]'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8'));
const t = new Track(JSON.parse(JSON.stringify(raw)));
const n = raw.x.length, ds = raw.ds, X = raw.x, Y = raw.y;
const where = s => {
  const sec = (raw.sections || []).find(q => s >= q.s0 && s <= q.s1);
  if (sec) return sec.name;
  let best = null, bd = 150;
  for (const c of raw.corners || []) { const d = Math.abs(c.s - s); if (d < bd && c.name) { bd = d; best = c.name; } }
  return best ? `near ${best}` : '';
};
let fail = 0;
const bad = m => { fail++; console.log('  FAIL ' + m); };

console.log(`${raw.full}  (${key})`);
let L = 0;
for (let i = 0; i < n; i++) L += Math.hypot(X[(i + 1) % n] - X[i], Y[(i + 1) % n] - Y[i]);
console.log(`  length   ${L.toFixed(1)} m summed over ${n} samples (file says ${raw.length})` + (real ? `; official ${real} m, error ${(L - real).toFixed(0)} m (${((L / real - 1) * 100).toFixed(2)}%)` : ''));
if (real && Math.abs(L / real - 1) > 0.01) bad('lap length is more than 1% from the official figure');

// ---- closure
const hd = i => Math.atan2(Y[(i + 1) % n] - Y[i], X[(i + 1) % n] - X[i]);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const gap = Math.hypot(X[0] - X[n - 1], Y[0] - Y[n - 1]);
const seam = wrap(hd(0) - hd(n - 2)) * 180 / Math.PI;
console.log(`  closes   last->first ${gap.toFixed(2)} m (sample step ${ds}), heading across the seam turns ${seam.toFixed(2)} deg over two steps`);
if (Math.abs(gap - ds) > 0.2 || Math.abs(seam) > 6) bad('the lap does not close cleanly');

// ---- kinks and the tightest corner
let kink = 0, kinkAt = 0;
for (let i = 0; i < n; i++) { const d = Math.abs(wrap(hd(i) - hd((i - 1 + n) % n))); if (d > kink) { kink = d; kinkAt = i; } }
console.log(`  kink     largest heading step between two samples ${(kink * 180 / Math.PI).toFixed(2)} deg at s=${kinkAt * ds} ${where(kinkAt * ds)}  (= R ${(ds / kink).toFixed(1)} m if it were an arc)`);
let kMax = 0, kAt = 0;
for (let i = 0; i < n; i++) if (Math.abs(t.curv[i]) > kMax) { kMax = Math.abs(t.curv[i]); kAt = i; }
console.log(`  tightest max curvature ${kMax.toFixed(4)} 1/m = R ${(1 / kMax).toFixed(1)} m at s=${kAt * ds} ${where(kAt * ds)}`);
if (1 / kMax < 7) bad('a corner tighter than 7 m radius: a glitch in the centreline, not a corner');
const tight = (raw.corners || []).slice().sort((a, b) => a.R - b.R).slice(0, 5);
console.log('           five tightest corners: ' + tight.map(c => `${c.name || 'T' + c.n} R${c.R} s=${c.s}`).join(', '));

// ---- self-crossing, and stretches closer than their own width
{
  const CELL = 40, grid = new Map(), cross = [], close = [];
  const keyOf = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
  for (let i = 0; i < n; i++) { const k = keyOf(X[i], Y[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  const seg = (a, b, c, d) => { const o = (p, q, r) => (X[q] - X[p]) * (Y[r] - Y[p]) - (Y[q] - Y[p]) * (X[r] - X[p]); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(X[i] / CELL), cy = Math.floor(Y[i] / CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get((cx + a) + ',' + (cy + b)) || []) {
      const al = Math.min(Math.abs(j - i), n - Math.abs(j - i));
      if (j <= i || al * ds < 60) continue;
      if (seg(i, (i + 1) % n, j, (j + 1) % n)) cross.push([i, j]);
      const d = Math.hypot(X[i] - X[j], Y[i] - Y[j]);
      if (d < raw.w[i] + raw.w[j] && !close.some(q => Math.abs(q[0] - i) < 50)) close.push([i, j, d]);
    }
  }
  console.log(`  crossing ${cross.length ? cross.map(([i, j]) => `s=${i * ds} x s=${j * ds}`).join(', ') : 'none'}; tarmac overlapping tarmac: ${close.length ? close.map(([i, j, d]) => `s=${i * ds}/s=${j * ds} (${d.toFixed(1)} m)`).join(', ') : 'none'}`);
  if (cross.length && !raw.crossover) bad('the lap crosses itself and the file does not say crossover');
  if (close.length && !raw.crossover) bad('two stretches of road overlap');
}
console.log(`  width    ${(2 * Math.min(...raw.w)).toFixed(1)}-${(2 * Math.max(...raw.w)).toFixed(1)} m; run-off ${Math.min(...raw.runL, ...raw.runR)}-${Math.max(...raw.runL, ...raw.runR)} m; ${raw.corners.length} corners; pit ${raw.pit ? `${raw.pit.entryS}->${raw.pit.exitS}${raw.pit.synth ? ' (synthetic)' : ''}` : 'none'}`);

// ---- the profile
const ef = `${ROOT}data/elev/${key}.json`;
if (fs.existsSync(ef)) {
  const e = JSON.parse(fs.readFileSync(ef, 'utf8')), z = e.s;
  if (z.length !== n) bad(`elevation has ${z.length} samples, the track ${n}`);
  const at = i => z[((i % n) + n) % n];
  let lo = Infinity, hi = -Infinity, iLo = 0, iHi = 0;
  z.forEach((v, i) => { if (v < lo) { lo = v; iLo = i; } if (v > hi) { hi = v; iHi = i; } });
  let climb = 0;
  for (let i = 0; i < n; i++) climb += Math.max(0, at(i + 1) - at(i));
  console.log(`  heights  ${e.dataset}: ${(hi - lo).toFixed(1)} m lowest to highest; low ${(e.mean + lo).toFixed(1)} m ASL at s=${iLo * ds} ${where(iLo * ds)}, high ${(e.mean + hi).toFixed(1)} m at s=${iHi * ds} ${where(iHi * ds)}; ${climb.toFixed(0)} m climbed per lap; seam step ${(at(0) - at(-1)).toFixed(2)} m`);
  // gradient over a 20 m baseline (a car's own length and a bit: what the driver feels)
  const B = Math.round(10 / ds);
  let gUp = 0, gDn = 0, iUp = 0, iDn = 0;
  for (let i = 0; i < n; i++) { const g = (at(i + B) - at(i - B)) / (2 * B * ds); if (g > gUp) { gUp = g; iUp = i; } if (g < gDn) { gDn = g; iDn = i; } }
  console.log(`  gradient steepest climb ${(gUp * 100).toFixed(1)}% at s=${iUp * ds} ${where(iUp * ds)}; steepest descent ${(gDn * 100).toFixed(1)}% at s=${iDn * ds} ${where(iDn * ds)}   (20 m baseline)`);
  // vertical curvature over a 12 m baseline
  const H = Math.round(6 / ds), k2 = new Float64Array(n);
  for (let i = 0; i < n; i++) k2[i] = (at(i + H) - 2 * at(i) + at(i - H)) / ((H * ds) ** 2);
  const peaks = sign => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = k2[i] * sign;
      if (v <= 0) continue;
      let top = true;
      for (let o = -15; o <= 15 && top; o++) { const w = k2[((i + o) % n + n) % n] * sign; if (w > v || (o < 0 && w === v)) top = false; }
      if (top) out.push([i, 1 / v]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, 8);
  };
  const g = i => (at(i + B) - at(i - B)) / (2 * B * ds) * 100;
  console.log('  crests   (sharpest first: radius, where, the speed a car goes weightless at, gradient 30 m before -> 30 m after)');
  for (const [i, R] of peaks(-1)) console.log(`           R ${R.toFixed(0).padStart(5)} m  s=${String(i * ds).padStart(5)} ${(where(i * ds) || '').padEnd(22)} light at ${(Math.sqrt(9.81 * R) * 3.6).toFixed(0).padStart(3)} km/h   ${g(i - 15).toFixed(1)}% -> ${g(i + 15).toFixed(1)}%`);
  console.log('  dips     (sharpest first)');
  for (const [i, R] of peaks(1).slice(0, 5)) console.log(`           R ${R.toFixed(0).padStart(5)} m  s=${String(i * ds).padStart(5)} ${(where(i * ds) || '').padEnd(22)} ${g(i - 15).toFixed(1)}% -> ${g(i + 15).toFixed(1)}%`);
} else console.log('  heights  no data/elev file: the circuit is flat');
console.log(fail ? `  ${fail} FAILED` : '  ok');
process.exit(fail ? 1 : 0);
