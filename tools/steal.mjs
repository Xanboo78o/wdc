// steal.mjs — lift a stretch of a REAL circuit and print it as track pieces.
//
//   node tools/steal.mjs monaco --from 1420 --to 1980
//   node tools/steal.mjs nurburgring --corners 4-9
//   node tools/steal.mjs --list
//
// Sources, in order of preference:
//   data/tracks/<key>.json   already surveyed and resampled every 2 m
//   data/f1-circuits.geojson 40 more circuits, splined and resampled here the
//                            same way tools/bake.mjs in DIRTY AIR does it
//
// Corners come out as {kind:'turn'} pieces whose RADIUS is chosen so the piece
// is as long as the real corner (the piece's own eased entry and exit are part
// of its length), and whose ANGLE is how far the real corner actually turns.
// That keeps the rhythm and the sequence of a real section, which is what a
// corner is; it is not a claim that every metre matches the survey.
import fs from 'fs';

const DIR = new URL('../data/', import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (name, def = null) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
for (const a of args) if (a.startsWith('--') && !['--from', '--to', '--corners', '--list', '--ds'].includes(a)) {
  console.error(`unknown flag ${a}`); process.exit(2);
}
const DS = +flag('ds', 2);

const gj = JSON.parse(fs.readFileSync(DIR + 'f1-circuits.geojson', 'utf8'));
const geoName = f => f.properties.Name || f.properties.name || '';
const key = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

if (args.includes('--list') || !args[0]) {
  const baked = fs.readdirSync(DIR + 'tracks').filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  console.log('surveyed here:', baked.join(' '));
  console.log('\nfrom the geojson:');
  console.log(gj.features.map(f => `  ${key(geoName(f)).padEnd(22)} ${geoName(f)} (${f.properties.length} m)`).sort().join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// centreline, every DS metres
// ---------------------------------------------------------------------------
function fromBaked(k) {
  const d = JSON.parse(fs.readFileSync(`${DIR}tracks/${k}.json`, 'utf8'));
  return { x: d.x, y: d.y, ds: d.ds, name: d.full, corners: d.corners };
}
function fromGeo(k) {
  const f = gj.features.find(f => key(geoName(f)) === k);
  if (!f) return null;
  const c = f.geometry.coordinates;
  const lat0 = c.reduce((a, p) => a + p[1], 0) / c.length, lon0 = c.reduce((a, p) => a + p[0], 0) / c.length;
  const P = c.map(([lon, lat]) => [(lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320, (lat - lat0) * 110540]);
  if (P.length > 1 && Math.hypot(P[0][0] - P.at(-1)[0], P[0][1] - P.at(-1)[1]) < 30) P.pop();   // closed ring
  // Catmull-Rom through the survey points, then resample at DS — the same
  // treatment the five baked circuits had.
  const fine = [];
  const at = i => P[((i % P.length) + P.length) % P.length];
  for (let i = 0; i < P.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const steps = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      fine.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  const x = [], y = [];
  let carry = 0;
  for (let i = 0; i < fine.length; i++) {
    const a = fine[i], b = fine[(i + 1) % fine.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < seg) { x.push(a[0] + (b[0] - a[0]) * t / seg); y.push(a[1] + (b[1] - a[1]) * t / seg); t += DS; }
    carry = t - seg;
  }
  return { x, y, ds: DS, name: geoName(f), corners: null };
}

const k = key(args[0]);
const src = fs.existsSync(`${DIR}tracks/${k}.json`) ? fromBaked(k) : fromGeo(k);
if (!src) { console.error(`no circuit "${args[0]}" — try --list`); process.exit(2); }

// ---------------------------------------------------------------------------
// heading, curvature, and where the corners are
// ---------------------------------------------------------------------------
const n = src.x.length, ds = src.ds;
const hdg = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const a = (i - 1 + n) % n, b = (i + 1) % n;
  hdg[i] = Math.atan2(src.y[b] - src.y[a], src.x[b] - src.x[a]);
}
const un = new Float64Array(n);
un[0] = hdg[0];
for (let i = 1; i < n; i++) {
  let d = hdg[i] - hdg[i - 1];
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  un[i] = un[i - 1] + d;
}
const SIG = 12 / ds, R = Math.ceil(3 * SIG);
const sm = new Float64Array(n);
for (let i = 0; i < n; i++) {
  let a = 0, w = 0;
  for (let j = -R; j <= R; j++) {
    const q = (i + j + n * 9) % n, wt = Math.exp(-0.5 * (j / SIG) ** 2);
    // unwrapped heading wraps too: add the whole-lap turn when crossing the seam
    const laps = Math.floor((i + j) / n);
    a += (un[q] + laps * (un[n - 1] - un[0])) * wt; w += wt;
  }
  sm[i] = a / w;
}
const curv = new Float64Array(n);
for (let i = 0; i < n; i++) curv[i] = (sm[(i + 1) % n] - sm[(i - 1 + n) % n]) / (2 * ds);

const KMIN = 1 / 600;
const runs = [];
for (let i = 0; i < n; i++) {
  const sg = Math.abs(curv[i]) < KMIN ? 0 : Math.sign(curv[i]);
  const last = runs[runs.length - 1];
  if (last && last.sg === sg) last.i1 = i; else runs.push({ sg, i0: i, i1: i });
}
// number the corners the way a circuit map does: in lap order from the line
let num = 0;
for (const r of runs) if (r.sg) r.num = ++num;

// ---------------------------------------------------------------------------
// what to print
// ---------------------------------------------------------------------------
let from = +flag('from', NaN), to = +flag('to', NaN);
const cRange = flag('corners');
if (cRange) {
  const [a, b] = cRange.split('-').map(Number);
  const first = runs.find(r => r.num === a), last = runs.find(r => r.num === (b || a));
  if (!first || !last) { console.error(`this circuit has corners 1-${num}`); process.exit(2); }
  from = first.i0 * ds; to = last.i1 * ds;
}
console.log(`\n${src.name} — ${(n * ds / 1000).toFixed(3)} km, ${num} corners found` +
  (Number.isFinite(from) ? `, showing ${Math.round(from)}-${Math.round(to)} m` : ''));

// piece radius from the real corner's angle and length (see the header)
function piece(r) {
  const len = (r.i1 - r.i0 + 1) * ds;
  if (!r.sg) return { kind: 'straight', length: Math.round(len), len };
  let ang = sm[r.i1] - sm[r.i0];
  const A = Math.abs(ang), dir = ang > 0 ? 'left' : 'right';
  // len = A*R + easing, easing = min(A*R/2, R/2 + 10)
  let R1 = len / (A * 1.5);                                  // assume the A*R/2 branch
  if (A * R1 / 2 > R1 / 2 + 10) R1 = (len - 10) / (A + 0.5); // the other branch
  const kMax = Math.max(...Array.from({ length: r.i1 - r.i0 + 1 }, (_, q) => Math.abs(curv[r.i0 + q])));
  return { kind: 'turn', dir, angle: +(A * 180 / Math.PI).toFixed(0), radius: Math.max(8, Math.round(R1)), len,
    realR: kMax ? Math.round(1 / kMax) : 0, num: r.num };
}
const show = runs.filter(r => !Number.isFinite(from) || (r.i1 * ds >= from && r.i0 * ds <= to));
for (const r of show) {
  const p = piece(r);
  const at = `${Math.round(r.i0 * ds)}-${Math.round(r.i1 * ds)} m`.padEnd(15);
  if (p.kind === 'straight') console.log(`  ${''.padStart(4)}${at}{ kind: 'straight', length: ${p.length} },`);
  else console.log(`  T${String(p.num).padStart(2)} ${at}{ kind: 'turn', dir: '${p.dir}', angle: ${p.angle}, radius: ${p.radius} },` +
    `   // real: ${Math.round(p.len)} m long, tightest R${p.realR}`);
}
