// bakegravenmoor.mjs — Gravenmoor, from its drawing to a track.
//
//   node tools/bakegravenmoor.mjs [--plan out.png|out.svg] [--dry]
//
// data/build/gravenmoor.js is the drawing: the lap section by section, point
// by point, and the things that stand round it. This puts a spline through
// the points (the same centripetal Catmull-Rom tools/bakeheiligen.mjs uses)
// and writes
//
//   data/tracks/gravenmoor.json     the format every circuit here has
//   data/elev/gravenmoor.json       the road's height per sample, and the land on a grid
//   data/env/gravenmoor.json        village, church, graveyard, woods, moor, water
//   data/landmarks/gravenmoor.json  floodlights and pumpkins
//
// and prints the lap: length, where every named place is, the gradient, and
// the worst CREST — v²/R against gravity at 80 m/s and at each car's own
// racing speed — because a crest nobody measured is a jump.
//
// NOTHING IS GENERATED. Every bend is a point somebody typed. What this tool
// decides is only what follows from them: the spline, the corner list (from
// curvature, named from the drawing), the racing line, the blend where an
// 11 m road becomes a 7.5 m bridge, and the rounding of each change of grade.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { Track } from '../js/track.js';
import { racingLine, buildLines } from '../js/line.js';
import { CARS } from '../js/physics.js';
import { LINE, KINDS, SECTIONS, PLACE, ROUTE } from '../data/build/gravenmoor.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
let plan = null, dry = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plan') { plan = args[++i]; if (!plan) { console.error('bakegravenmoor: --plan needs a file'); process.exit(2); } }
  else if (args[i] === '--dry') dry = true;
  else { console.error(`bakegravenmoor: unknown argument ${args[i]}`); process.exit(2); }
}
const DS = 2, D2R = Math.PI / 180, G = 9.81;
// The racing line keeps this far inside the edge of the road. The Heiligen
// bake uses 0.35; here the reference driver, following a 0.35 line round the
// R20 hairpin, ran its centre 0.4 m inside the line for three seconds — over
// the edge (tools/drive.mjs: 3.0 s OFF in a GT3, 6.1 s in the F1 car).
const LINE_MARGIN = +(process.env.GRAVEN_MARGIN || 0.9);
// How far a change of grade is spread: every pass of the [1 2 1]/4 filter adds
// 2 m² of variance at 2 m samples, so 450 passes is a 30 m Gaussian, and a
// grade break of `dg` comes out as a vertical radius of 30 * 2.5 / dg. The
// Mile's crest is 6.8 %: about 1100 m.
const ZPASS = 450;

// Centripetal Catmull-Rom through a CLOSED ring of [x, y], `sub` per span.
function spline(P, sub = 24) {
  const n = P.length, out = [];
  const tj = (a, b, t) => t + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
    for (let k = 0; k < sub; k++) {
      const t = t1 + (t2 - t1) * k / sub;
      const L = (a, b, ta, tb) => [0, 1].map(d => ((tb - t) * a[d] + (t - ta) * b[d]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2);
      out.push({ x: C[0], y: C[1], span: i });
    }
  }
  return out;
}
const smooth = (a, passes) => {
  let v = Float64Array.from(a);
  const n = v.length;
  for (let p = 0; p < passes; p++) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = (v[(i - 1 + n) % n] + 2 * v[i] + v[(i + 1) % n]) / 4;
    v = w;
  }
  return v;
};

// ---- the ring of control points, each remembering its section ---------------------
const ring = [], own = [];
SECTIONS.forEach((sec, si) => {
  if (!KINDS[sec.kind]) throw new Error(`${sec.id}: no kind ${sec.kind}`);
  const next = SECTIONS[(si + 1) % SECTIONS.length].pts[0];
  const poly = [...sec.pts, next];
  let L = 0; const cum = [0];
  for (let k = 1; k < poly.length; k++) { L += Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]); cum.push(L); }
  sec.pts.forEach((p, k) => { ring.push(p); own.push({ sec, f0: cum[k] / L, f1: cum[k + 1] / L }); });
});

// ---- spline, then even 2 m samples ---------------------------------------------------
const dense = spline(ring);
const cum = [0];
for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
const total = cum[dense.length], n = Math.round(total / DS), step = total / n;
// where each span starts along the lap, so height can run evenly from one
// typed point to the next (a straight grade between them, rounded afterwards)
const spanS = ring.map((_, i) => cum[i * 24]); spanS.push(total);
const S = [];
for (let k = 0, j = 0; k < n; k++) {
  const target = k * step;
  while (j < dense.length - 1 && cum[j + 1] < target) j++;
  const a = dense[j], b = dense[(j + 1) % dense.length], f = (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
  const i = a.span, o = own[i], u = Math.min(1, Math.max(0, (target - spanS[i]) / (spanS[i + 1] - spanS[i])));
  S.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: ring[i][2] + (ring[(i + 1) % ring.length][2] - ring[i][2]) * u,
    sec: o.sec, K: KINDS[o.sec.kind], frac: o.f0 + (o.f1 - o.f0) * u });
}
// A typed arc is a true arc, and where it meets a straight the curvature
// steps from nothing to 1/R in one sample — which a spline through the points
// answers with a flick the wrong way just before and a tight spot just after
// (the Cauldron came out as R145 with R114 at each end). A road is not built
// like that: the curvature RAMPS. So the lap is turned into its curvature,
// that is smoothed (KPASS passes of [1 2 1]/4: an 8 m Gaussian, so a step
// becomes a ramp about 25 m long and a constant radius stays exactly
// constant), and the road is laid out again from it, starting from the
// middle of Lantern Row. What little the two ends then miss each other by is
// spread evenly round the lap, and printed.
const KPASS = 32;
{ const th = S.map((p, i) => { const q = S[(i + 1) % n]; return Math.atan2(q.y - p.y, q.x - p.x); });
  const kap = th.map((t, i) => { let d = t - th[(i - 1 + n) % n]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; });
  const ks = smooth(kap, KPASS);
  let i0 = 0, b = Infinity; S.forEach((p, i) => { const d = Math.hypot(p.x, p.y); if (d < b) { b = d; i0 = i; } });      // [0, 0] is on Lantern Row
  const X = new Float64Array(n + 1), Y = new Float64Array(n + 1);
  let t = th[i0]; X[0] = S[i0].x; Y[0] = S[i0].y;
  for (let k = 0; k < n; k++) { X[k + 1] = X[k] + Math.cos(t) * step; Y[k + 1] = Y[k] + Math.sin(t) * step; t += ks[(i0 + k + 1) % n]; }
  const ex = X[n] - X[0], ey = Y[n] - Y[0];
  // ...and then the slow drift between the new road and the typed one (every
  // corner hands its exit on a little to one side, and it adds up to metres
  // by the far end of the lap) is taken out: the difference, smoothed over
  // 100 m, is subtracted. What is left of the difference is local — the
  // ramps themselves — so the hanging tree is still in the middle of its hairpin.
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let k = 0; k < n; k++) { const p = S[(i0 + k) % n]; dx[k] = X[k] - ex * k / n - p.x; dy[k] = Y[k] - ey * k / n - p.y; }
  const lx = smooth(dx, 5000), ly = smooth(dy, 5000);
  let moved = 0;
  for (let k = 0; k < n; k++) { const p = S[(i0 + k) % n], mx = dx[k] - lx[k], my = dy[k] - ly[k]; moved = Math.max(moved, Math.hypot(mx, my)); p.x += mx; p.y += my; }
  console.log(`  laid out from its curvature: the ends met within ${Math.hypot(ex, ey).toFixed(2)} m; no part of the road is more than ${moved.toFixed(2)} m from the spline through the typed points`);
}
// The lap's line: the sample nearest LINE.
let rot = 0, rb = Infinity;
S.forEach((p, i) => { const d = Math.hypot(p.x - LINE[0], p.y - LINE[1]); if (d < rb) { rb = d; rot = i; } });
if (rb > 3) throw new Error(`LINE is ${rb.toFixed(1)} m from the road`);
const T = S.slice(rot).concat(S.slice(0, rot));
const length = n * step;

const w = Array.from(smooth(T.map(p => p.K.w), 40)), run = Array.from(smooth(T.map(p => p.K.run), 40));
const bank = Array.from(smooth(T.map(p => (p.sec.bank && p.frac >= p.sec.banked[0] && p.frac <= p.sec.banked[1] ? p.sec.bank : 0)), 80));
const z = Array.from(smooth(T.map(p => p.z), ZPASS));

// ---- corners, from curvature; named from the drawing ---------------------------------
const hdg = T.map((p, i) => { const a = T[(i - 1 + n) % n], b = T[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); });
let curv = T.map((_, i) => { let d = hdg[(i + 1) % n] - hdg[(i - 1 + n) % n]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d / (2 * step); });
curv = Array.from(smooth(curv, 4));
const corners = [];
for (let i = 0; i < n;) {
  if (Math.abs(curv[i]) < 1 / 260) { i++; continue; }
  let j = i, turn = 0, peak = i;
  while (j < n && Math.abs(curv[j]) >= 1 / 260 && Math.sign(curv[j]) === Math.sign(curv[i])) { turn += curv[j] * step; if (Math.abs(curv[j]) > Math.abs(curv[peak])) peak = j; j++; }
  const len = (j - i) * step, deg = Math.abs(turn) * 180 / Math.PI;
  if (len >= 14 && deg >= 16) {
    const p = T[peak], names = p.sec.corners || {};
    let name = p.sec.name, bd = 0.11;
    for (const [f, nm] of Object.entries(names)) { const d = Math.abs(+f - p.frac); if (d < bd) { bd = d; name = nm; } }
    corners.push({ n: corners.length + 1, num: corners.length + 1, name, s0: +(i * step).toFixed(0), s1: +((j - 1) * step).toFixed(0),
      s: +(peak * step).toFixed(0), R: +(1 / Math.abs(curv[peak])).toFixed(0), dir: Math.sign(curv[peak]), turn: +deg.toFixed(0) });
  }
  i = j;
}

// ---- where the named places are ----------------------------------------------------------
const places = [];
{ let cur = null; T.forEach((p, i) => { if (p.sec !== cur) { cur = p.sec; places.push({ id: p.sec.id, name: p.sec.name, s0: i * step, i0: i }); } }); }
// Lantern Row is the lap's last run AND its first: one place, from the Cauldron's exit round to the Lychgate.
if (places.length > 1 && places[0].id === places[places.length - 1].id) { places[0].s0 = places.pop().s0; places[0].wraps = true; }
places.forEach((p, k) => { p.s1 = places[(k + 1) % places.length].s0; });
const placeOf = id => places.find(p => p.id === id);
const sAt = (x, y) => { let b = Infinity, bi = 0; T.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < b) { b = d; bi = i; } }); return { i: bi, s: bi * step, d: Math.sqrt(b) }; };

// DRS (the format the surveyed circuits have): the Mile, from 120 m out of
// the hairpin to 140 m before the Hollow; and Lantern Row, from 60 m after
// the Cauldron to 120 m before the Lychgate. Detection 175 m before each.
const wrap = s => ((s % length) + length) % length;
const zone = (a, b) => ({ from: Math.round(wrap(a)), to: Math.round(wrap(b)), detect: Math.round(wrap(a - 175)), len: Math.round(wrap(b - a)) });
const drs = [zone(placeOf('mile').s0 + 120, placeOf('hollow').s0 - 140), zone(placeOf('row').s0 + 60, placeOf('lychgate').s0 - 120)];

let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const p of T) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2);
const json = {
  key: ROUTE.key, name: ROUTE.name, full: ROUTE.full, country: ROUTE.country,
  aiPace: 0.8, length: +length.toFixed(1), ds: +step.toFixed(4), wall: 'armco', crossover: false, open: false,
  bbox: { x0: r1(x0), y0: r1(y0), x1: r1(x1), y1: r1(y1) },
  x: T.map(p => r2(p.x)), y: T.map(p => r2(p.y)), w: w.map(r2), bank: bank.map(r1),
  runL: run.map(r1), runR: run.map(r1), line: new Array(n).fill(0),
  corners, drs, pit: null, sponsors: [],
  road: new Array(n).fill(0), jumps: [], lineMargin: LINE_MARGIN,
  // not read by the game yet: where each named place is, for whoever wants to
  // put its name on the screen (or a ghost on the road)
  places: places.map(p => ({ id: p.id, name: p.name, s0: Math.round(p.s0), s1: Math.round(p.s1) })),
};
// The line is the slow part. A change that moves no road keeps the line on disk.
let old = null;
try { old = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${ROUTE.key}.json`, 'utf8')); } catch { /* first bake */ }
const same = old && old.lineMargin === LINE_MARGIN && old.x.length === json.x.length && old.x.every((v, k) => v === json.x[k]) && old.y.every((v, k) => v === json.y[k]) && old.w.every((v, k) => v === json.w[k]);
json.line = same ? old.line : Array.from(racingLine(new Track(json), LINE_MARGIN), v => +v.toFixed(2));

// ---- the report --------------------------------------------------------------------------
const fmtS = s => String(Math.round(s)).padStart(5);
console.log(`GRAVENMOOR  ${(length / 1000).toFixed(3)} km  ${n} samples at ${step.toFixed(4)} m  ${corners.length} corners`);
console.log('\n  THE LAP (s = metres from the line)');
for (const p of places) console.log(`   ${fmtS(p.s0)} -> ${fmtS(p.s1)}  ${p.name.padEnd(20)} ${String(Math.round(wrap(p.s1 - p.s0))).padStart(5)} m   ${(KINDS[SECTIONS.find(q => q.id === p.id).kind].w * 2).toFixed(1)} m wide`);
console.log('\n  CORNERS');
for (const c of corners) console.log(`   T${String(c.n).padEnd(2)} ${c.name.padEnd(20)} s ${fmtS(c.s0)}-${fmtS(c.s1)}  apex ${fmtS(c.s)}  R${String(c.R).padStart(4)}  ${c.dir > 0 ? 'left ' : 'right'} ${String(c.turn).padStart(3)}°`);
// gradient and crests
const grade = z.map((_, i) => (z[(i + 1) % n] - z[(i - 1 + n) % n]) / (2 * step));
const zpp = z.map((_, i) => (z[(i + 1) % n] - 2 * z[i] + z[(i - 1 + n) % n]) / (step * step));
let gi = 0; grade.forEach((g, i) => { if (Math.abs(g) > Math.abs(grade[gi])) gi = i; });
const nameAt = i => T[i].sec.name;
const zlo = Math.min(...z), zhi = Math.max(...z);
console.log(`\n  HEIGHT  ${zlo.toFixed(1)} m (${nameAt(z.indexOf(zlo))}) to ${zhi.toFixed(1)} m (${nameAt(z.indexOf(zhi))}): ${(zhi - zlo).toFixed(1)} m of range`);
console.log(`          steepest ${(grade[gi] * 100).toFixed(1)} % at s ${Math.round(gi * step)} (${nameAt(gi)})`);
const worst = (vAt, label) => {
  let b = 0, bi = 0;
  for (let i = 0; i < n; i++) { const v = vAt(i), lift = v * v * Math.max(0, -zpp[i]) / G; if (lift > b) { b = lift; bi = i; } }
  console.log(`          worst crest ${label.padEnd(22)} ${b.toFixed(2)} g of lift at s ${Math.round(bi * step)} (${nameAt(bi)}), vertical radius ${(1 / Math.max(1e-9, -zpp[bi])).toFixed(0)} m, ${(vAt(bi) * 3.6).toFixed(0)} km/h`);
  return b;
};
const lift80 = worst(() => 80, 'at 80 m/s everywhere:');
const trackObj = new Track(JSON.parse(JSON.stringify(json)));
for (const cls of ['gt3', 'f1']) { if (!CARS[cls]) continue; const L = buildLines(trackObj, CARS[cls]); worst(i => L.race.v[i], `${cls} at racing speed:`); console.log(`          ${cls} ideal lap ${Math.floor(L.race.lapTime / 60)}:${(L.race.lapTime % 60).toFixed(2).padStart(5, '0')}`); }
if (lift80 > 0.9) console.log('  !! a crest is over 0.9 g at 80 m/s');
if (Math.abs(grade[gi]) > 0.12) console.log('  !! a gradient is over 12 %');
// does the lap cross itself? (two samples far apart along the lap but closer on the ground than their two roads are wide)
{ let hits = 0, first = null;
  for (let i = 0; i < n; i += 2) for (let j = i + 40; j < n; j += 2) {
    if (n - j + i < 40) continue;
    const d = Math.hypot(T[i].x - T[j].x, T[i].y - T[j].y);
    if (d < w[i] + w[j] + 1) { hits++; first = first || [i, j, d]; }
  }
  console.log(hits ? `  !! the lap touches itself: s ${Math.round(first[0] * step)} and s ${Math.round(first[1] * step)} are ${first[2].toFixed(1)} m apart` : '  the lap does not cross or touch itself');
  let b = Infinity, bi = 0, bj = 0;
  for (let i = 0; i < n; i += 2) for (let j = i + 100; j < n; j += 2) { if (n - j + i < 100) continue; const d = Math.hypot(T[i].x - T[j].x, T[i].y - T[j].y) - w[i] - w[j] - run[i] - run[j]; if (d < b) { b = d; bi = i; bj = j; } }
  console.log(`  closest two pieces of road come: ${b.toFixed(1)} m between their run-offs, s ${Math.round(bi * step)} (${nameAt(bi)}) and s ${Math.round(bj * step)} (${nameAt(bj)})`);
}
console.log(`  grid: the back row of 22 is ${(22 * 8 - 2)} m behind the line; the Cauldron ends ${Math.round(wrap(-placeOf('row').s0))} m behind it; the Lychgate begins ${Math.round(placeOf('lychgate').s0)} m ahead`);

// ---- the land ------------------------------------------------------------------------------
// Height anywhere is the height of the road near it, weighted by closeness, so
// the ground meets the road everywhere and the hill between two pieces of it
// is a hill.
const ALL = []; for (let i = 0; i < n; i += 4) ALL.push([T[i].x, T[i].y, z[i]]);
function landAt(x, y) {
  let sw = 0, sh = 0;
  for (const [px, py, pz] of ALL) { const d2 = (px - x) ** 2 + (py - y) ** 2 + 400, wgt = 1 / (d2 * d2); sw += wgt; sh += wgt * pz; }
  return sh / sw;
}
const PAD = 500;
const gx0 = x0 - PAD, gy0 = y0 - PAD, gx1 = x1 + PAD, gy1 = y1 + PAD;
const GN = 96, gdx = (gx1 - gx0) / (GN - 1), gdy = (gy1 - gy0) / (GN - 1);

// ---- the place round it ------------------------------------------------------------------------
const near = (x, y) => { let b = Infinity, bi = 0; for (let i = 0; i < n; i += 2) { const d = (T[i].x - x) ** 2 + (T[i].y - y) ** 2; if (d < b) { b = d; bi = i; } } return { d: Math.sqrt(b), i: bi }; };
const offRoad = (x, y, extra = 0.6) => { const q = near(x, y); return q.d - (w[q.i] + run[q.i] + extra); };   // > 0: clear of the run-off
const rect = (cx, cy, h, L, Dp) => { const c = Math.cos(h), sn = Math.sin(h); return [[-L / 2, -Dp / 2], [L / 2, -Dp / 2], [L / 2, Dp / 2], [-L / 2, Dp / 2]].map(([u, v]) => [+(cx + u * c - v * sn).toFixed(2), +(cy + u * sn + v * c).toFixed(2)]); };
const inPoly = (P, x, y) => { let inside = false; for (let j = 0, k = P.length - 1; j < P.length; k = j++) { const a = P[j], b = P[k]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
const buildings = [], areas = [], dropped = [];
const put = (b, what) => { if (b.p.some(q => offRoad(q[0], q[1]) < 0)) dropped.push(what); else buildings.push(b); };
const STONE = '#8b8a84', SLATE = '#3d3f44';
{ // the village: both sides of Lantern Row
  const H = PLACE.houses, K = KINDS.village, edge = K.w + K.run + 2.5;
  for (let x = H.x0, k = 0; x <= H.x1; x += H.every, k++) for (const side of [1, -1]) {
    const q = k * 2 + (side > 0 ? 0 : 1), L = H.len[q % H.len.length], Dp = H.dep[q % H.dep.length], h = H.h[q % H.h.length];
    put({ k: 'house', h, p: rect(x, side * (edge + Dp / 2), 0, L, Dp) }, `house at ${x}`);
  }
  for (const e of PLACE.extra) put({ k: 'house', h: e.h, p: rect(e.at[0], e.at[1], e.hdg * D2R, e.len, e.dep) }, 'vicarage');
  const C = PLACE.church;
  put({ k: 'church', h: C.h, c: STONE, rc: SLATE, p: rect(C.nave[0], C.nave[1], C.hdg * D2R, C.len, C.wid) }, 'church');
  put({ k: 'tower', h: C.towerH, c: STONE, rc: SLATE, p: rect(C.tower[0], C.tower[1], C.hdg * D2R, C.towerW, C.towerW) }, 'tower');
  // the lychgate's two posts, either side of the road (the roof between them is the renderer's)
  { const g = PLACE.lychgate, h = g.hdg * D2R, half = g.span / 2 + 3.2; for (const sd of [1, -1]) put({ k: 'gatepost', h: 5.5, c: STONE, rc: SLATE, p: rect(g.at[0] - Math.sin(h) * sd * half, g.at[1] + Math.cos(h) * sd * half, h, 1.8, 1.8) }, 'gatepost'); }
  // the hanging tree's trunk (a renderer that knows `deadtree` can do better; one that does not draws a black column)
  put({ k: 'deadtree', h: PLACE.tree.h, c: '#1c1917', rc: '#1c1917', p: rect(PLACE.tree.at[0], PLACE.tree.at[1], 0.4, 2.4, 2.4) }, 'tree');
  // headstones: 0.9 x 0.35 m slabs facing down their row; every seventh is a cross (taller, thinner), and each plot has one table tomb
  const HS = [1.2, 1.0, 1.35, 1.1, 0.9, 1.25, 2.2];
  PLACE.graves.forEach(([cx, cy, hd, rows, cols], gi2) => {
    const h = hd * D2R, c = Math.cos(h), sn = Math.sin(h);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const u = (q - (cols - 1) / 2) * 2.6, v = (r - (rows - 1) / 2) * 3, k = r * cols + q + gi2 * 3;
      const x = cx + u * c - v * sn, y = cy + u * sn + v * c, cross = k % 7 === 6, tomb = r === 1 && q === 2;
      put({ k: 'grave', h: tomb ? 1.1 : HS[k % 7], c: STONE, rc: STONE, p: tomb ? rect(x, y, h, 2.2, 1.1) : rect(x, y, h + Math.PI / 2, cross ? 0.5 : 0.9, cross ? 0.3 : 0.35) }, 'headstone');
    }
  });
}
areas.push({ k: 'urban', p: [[PLACE.houses.x0 - 12, -24], [PLACE.houses.x1 + 12, -24], [PLACE.houses.x1 + 12, 24], [PLACE.houses.x0 - 12, 24]] });
// the moor first, the woods over it, the water last
for (const P of PLACE.moor) areas.push({ k: 'scrub', p: P });
{ // woods: 24 m blocks inside each outline, left out where the road and its run-off are
  const CELL = 24; let nW = 0;
  for (const P of PLACE.woods) {
    const xs = P.map(q => q[0]), ys = P.map(q => q[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y += CELL) for (let x = Math.min(...xs); x < Math.max(...xs); x += CELL) {
      const cx = x + CELL / 2, cy = y + CELL / 2;
      if (!inPoly(P, cx, cy) || offRoad(cx, cy, CELL * 0.71 + 3) < 0) continue;
      if (Math.abs(cy) < 30 && cx > PLACE.houses.x0 - 20 && cx < PLACE.houses.x1 + 20) continue;       // not in the village
      const e = PLACE.pond; if (((cx - e.at[0]) / (e.rx + 14)) ** 2 + ((cy - e.at[1]) / (e.ry + 14)) ** 2 < 1) continue;   // not in the pond
      areas.push({ k: 'forest', p: [[x, y], [x + CELL, y], [x + CELL, y + CELL], [x, y + CELL]] }); nW++;
    }
  }
  areas.nWoods = nW;
}
{ // the pond (an ellipse, as 24 points) and the stream (a ribbon `w` wide down its points)
  const e = PLACE.pond, P = [];
  for (let k = 0; k < 24; k++) P.push([+(e.at[0] + Math.cos(k / 24 * 2 * Math.PI) * e.rx).toFixed(1), +(e.at[1] + Math.sin(k / 24 * 2 * Math.PI) * e.ry).toFixed(1)]);
  areas.push({ k: 'water', p: P });
  const s = PLACE.stream, Lft = [], Rgt = [];
  s.pts.forEach((p, k) => { const a = s.pts[Math.max(0, k - 1)], b = s.pts[Math.min(s.pts.length - 1, k + 1)], h = Math.atan2(b[1] - a[1], b[0] - a[0]); Lft.push([+(p[0] - Math.sin(h) * s.w / 2).toFixed(1), +(p[1] + Math.cos(h) * s.w / 2).toFixed(1)]); Rgt.push([+(p[0] + Math.sin(h) * s.w / 2).toFixed(1), +(p[1] - Math.cos(h) * s.w / 2).toFixed(1)]); });
  areas.push({ k: 'water', p: [...Lft, ...Rgt.reverse()] });
}
const nWoods = areas.nWoods; delete areas.nWoods;
// floodlights: [x, y, the lap's heading there, height]
const lights = PLACE.lights.filter(([x, y]) => offRoad(x, y, 1.5) > 0).map(([x, y, H]) => [x, y, +hdg[near(x, y).i].toFixed(3), H]);
// pumpkins: [x, y, radius, the way its face looks]
const pumpkins = [];
{ const R = PLACE.pumpkins, K = KINDS.village, lat = K.w + K.run + 1.1;
  for (let x = R.row.x0, k = 0; x <= R.row.x1; x += R.row.every, k++) { const side = k % 2 ? -1 : 1; pumpkins.push([x, side * lat, R.row.r[k % R.row.r.length], +(-side * Math.PI / 2).toFixed(3)]); }
  const [tx, ty] = PLACE.tree.at;
  for (let k = 0; k < R.ring; k++) { const a = k / R.ring * 2 * Math.PI; pumpkins.push([+(tx + Math.cos(a) * R.ringR).toFixed(1), +(ty + Math.sin(a) * R.ringR).toFixed(1), k % 3 ? 0.6 : 0.95, +a.toFixed(3)]); }
  // round the outside of the hairpin, from where you come in to where you leave (`outerArc`, bearings from the tree): faces look at the tree
  const Ro = 20 + KINDS.hairpin.w + KINDS.hairpin.run + 4;
  for (let k = 0; k < R.outer; k++) { const a = (R.outerArc[0] + (R.outerArc[1] - R.outerArc[0]) * k / (R.outer - 1)) * D2R; pumpkins.push([+(tx + Math.cos(a) * Ro).toFixed(1), +(ty + Math.sin(a) * Ro).toFixed(1), k % 2 ? 0.9 : 1.3, +(a + Math.PI).toFixed(3)]); }
  // a pair at each end of the bridge, just off its corners
  { const b = placeOf('bridge'), c = placeOf('cauldron');
    for (const i of [Math.round(b.s0 / step) - 3, Math.round(c.s0 / step) + 3]) for (const sd of [1, -1]) { const p = T[(i + n) % n], h = hdg[(i + n) % n], o = w[(i + n) % n] + run[(i + n) % n] + 1.4; pumpkins.push([+(p.x - Math.sin(h) * sd * o).toFixed(1), +(p.y + Math.cos(h) * sd * o).toFixed(1), 0.7, +(h - sd * Math.PI / 2).toFixed(3)]); } }
  pumpkins.push([R.giant.at[0], R.giant.at[1], R.giant.r, +(R.giant.face * D2R).toFixed(3)]);
}
const badPs = pumpkins.filter(p => offRoad(p[0], p[1], p[2] * 0.6) < 0), badP = badPs.length;
console.log(`\n  the place: ${buildings.length} buildings (${buildings.filter(b => b.k === 'house').length} houses, ${buildings.filter(b => b.k === 'grave').length} headstones), ${nWoods} blocks of wood, ${lights.length} floodlights, ${pumpkins.length} pumpkins`);
if (dropped.length) console.log(`  !! left out because they stood on the road or its run-off: ${[...new Set(dropped)].join(', ')} (${dropped.length})`);
if (badP) console.log(`  !! ${badP} pumpkins are on the run-off: ${badPs.map(p => `[${p[0]}, ${p[1]}] r${p[2]}`).join(' ')}`);

// ---- write ---------------------------------------------------------------------------------
if (!dry) {
  const GH = [];
  for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) GH.push(landAt(gx0 + i * gdx, gy0 + j * gdy));
  const mean = z.reduce((a, b) => a + b, 0) / n;
  fs.writeFileSync(`${ROOT}data/tracks/${ROUTE.key}.json`, JSON.stringify(json));
  fs.writeFileSync(`${ROOT}data/elev/${ROUTE.key}.json`, JSON.stringify({
    key: ROUTE.key, dataset: 'hand-built', ds: json.ds,
    note: 'metres relative to the mean height of the lap; drawn in data/build/gravenmoor.js',
    mean: +mean.toFixed(1), range: [+(zlo - mean).toFixed(2), +(zhi - mean).toFixed(2)],
    s: z.map(v => +(v - mean).toFixed(3)),
    grid: { x0: +gx0.toFixed(1), y0: +gy0.toFixed(1), dx: +gdx.toFixed(3), dy: +gdy.toFixed(3), n: GN, h: GH.map(v => +(v - mean).toFixed(2)) },
  }));
  fs.writeFileSync(`${ROOT}data/env/${ROUTE.key}.json`, JSON.stringify({
    key: ROUTE.key, full: ROUTE.full, lat0: 54.42, lon0: -0.89, pad: PAD, made: 'tools/bakegravenmoor.mjs from data/build/gravenmoor.js — dressed, not surveyed',
    bbox: { x0: Math.floor(gx0), y0: Math.floor(gy0), x1: Math.ceil(gx1), y1: Math.ceil(gy1) },
    buildings, areas, sea: [], trees: [PLACE.tree.at], roads: [],
  }));
  fs.writeFileSync(`${ROOT}data/landmarks/${ROUTE.key}.json`, JSON.stringify({
    key: ROUTE.key, note: 'tools/bakegravenmoor.mjs: the floodlights and the pumpkins',
    items: [{ type: 'floodtowers', src: 'bakegravenmoor', list: lights }, { type: 'pumpkins', src: 'bakegravenmoor', list: pumpkins }],
  }));
  console.log(`  -> data/{tracks,elev,env,landmarks}/${ROUTE.key}.json`);
}

// ---- the plan --------------------------------------------------------------------------------
if (plan) {
  const M = 130, PW = 2000, sx = PW / (x1 - x0 + 2 * M), PH = (y1 - y0 + 2 * M) * sx, PROF = 230;
  const X = x => (x - x0 + M) * sx, Y = y => (y1 + M - y) * sx, f1 = v => v.toFixed(1);
  const poly = (P, fill, extra = '') => `<polygon points="${P.map(q => `${f1(X(q[0]))},${f1(Y(q[1]))}`).join(' ')}" fill="${fill}" ${extra}/>`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${(PH + PROF).toFixed(0)}" font-family="Helvetica,Arial,sans-serif"><rect width="100%" height="100%" fill="#e9e7dc"/>`;
  for (const a of areas) svg += poly(a.p, { scrub: '#d5cfae', forest: '#6f8a5c', water: '#4f86b8', urban: '#d8d4cc' }[a.k] || '#ccc');
  for (const b of buildings) svg += poly(b.p, b.k === 'grave' ? '#555' : b.k === 'house' ? '#a0522d' : '#222');
  // run-off, then the road, coloured by how fast... no: by what it is
  const edge = (side, off) => T.map((p, i) => { const o = side * (w[i] + (off ? run[i] : 0)); return [p.x - Math.sin(hdg[i]) * o, p.y + Math.cos(hdg[i]) * o]; });
  svg += poly([...edge(1, true), edge(1, true)[0], edge(-1, true)[0], ...edge(-1, true).reverse()], '#b9c79a', 'fill-rule="evenodd"');
  svg += poly([...edge(1, false), edge(1, false)[0], edge(-1, false)[0], ...edge(-1, false).reverse()], '#2b2b2f', 'fill-rule="evenodd"');
  // banking, as an orange centre stripe; DRS as a green one
  const stripe = (test, col, wd) => { let run2 = []; const flush = () => { if (run2.length > 1) svg += `<polyline points="${run2.map(p => `${f1(X(p.x))},${f1(Y(p.y))}`).join(' ')}" fill="none" stroke="${col}" stroke-width="${wd}"/>`; run2 = []; }; for (let i = 0; i <= n; i++) { if (test(i % n)) run2.push(T[i % n]); else flush(); } flush(); };
  stripe(i => bank[i] > 1, '#ff8a00', 2.5);
  stripe(i => drs.some(d => { const s = i * step; return d.from < d.to ? s >= d.from && s <= d.to : s >= d.from || s <= d.to; }), '#35d06b', 1.5);
  for (const [x, y] of lights) svg += `<circle cx="${f1(X(x))}" cy="${f1(Y(y))}" r="5" fill="#fff36b" stroke="#111"/>`;
  for (const [x, y, r] of pumpkins) svg += `<circle cx="${f1(X(x))}" cy="${f1(Y(y))}" r="${Math.max(1.6, r * sx * 1.5).toFixed(1)}" fill="#ff7a00"/>`;
  { const [tx, ty] = PLACE.tree.at; svg += `<circle cx="${f1(X(tx))}" cy="${f1(Y(ty))}" r="6" fill="#111"/>`; }
  // the line and the grid
  { const p = T[0], h = hdg[0], o = w[0] + 3; svg += `<line x1="${f1(X(p.x - Math.sin(h) * o))}" y1="${f1(Y(p.y + Math.cos(h) * o))}" x2="${f1(X(p.x + Math.sin(h) * o))}" y2="${f1(Y(p.y - Math.cos(h) * o))}" stroke="#fff" stroke-width="3"/>`;
    for (let k = 0; k < 22; k++) { const i = (n - Math.round((6 + k * 8) / step)) % n, q = T[i], lat = (k % 2 ? -1 : 1) * w[i] * 0.46; svg += `<circle cx="${f1(X(q.x - Math.sin(hdg[i]) * lat))}" cy="${f1(Y(q.y + Math.cos(hdg[i]) * lat))}" r="1.8" fill="#ffd400"/>`; } }
  for (const c of corners) { const p = T[Math.round(c.s / step) % n]; svg += `<circle cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" r="3" fill="#d2222d"/><text x="${f1(X(p.x) + 8)}" y="${f1(Y(p.y) + 14)}" font-size="11" fill="#7a0f16">T${c.n} R${c.R} ${c.turn}°</text>`; }
  for (const pl of places) { const i = Math.round(wrap(pl.s0 + wrap(pl.s1 - pl.s0) / 2) / step) % n, p = T[i], o = w[i] + run[i] + 26, sd = pl.id === 'row' || pl.id === 'mile' ? -1 : 1;
    svg += `<text x="${f1(X(p.x - Math.sin(hdg[i]) * o * sd))}" y="${f1(Y(p.y + Math.cos(hdg[i]) * o * sd))}" font-size="17" font-weight="700" fill="#111" text-anchor="middle">${pl.name.toUpperCase().replace(/&/g, '&amp;')}</text>`; }
  for (let s = 0; s < length; s += 250) { const i = Math.round(s / step) % n, p = T[i], o = w[i] + 9; svg += `<text x="${f1(X(p.x + Math.sin(hdg[i]) * o))}" y="${f1(Y(p.y - Math.cos(hdg[i]) * o) + 4)}" font-size="10" fill="#555" text-anchor="middle">${s}</text>`; }
  svg += `<text x="24" y="38" font-size="28" font-weight="700">GRAVENMOOR</text><text x="24" y="60" font-size="14">${(length / 1000).toFixed(3)} km · clockwise · orange stripe = banked · green = DRS · yellow dots = grid and floodlights · grey specks = headstones · numbers = metres from the line · 100 m = ${(100 * sx).toFixed(0)} px</text>`;
  svg += `<line x1="24" y1="76" x2="${24 + 100 * sx}" y2="76" stroke="#111" stroke-width="3"/>`;
  // the height of the road round the lap
  { const py0 = PH + 20, ph = PROF - 60, px = s => 60 + s / length * (PW - 120), pz = v => py0 + ph - (v - zlo) / (zhi - zlo) * ph;
    svg += `<rect x="0" y="${PH}" width="${PW}" height="${PROF}" fill="#f6f5ee"/><polyline points="${z.map((v, i) => `${f1(px(i * step))},${f1(pz(v))}`).join(' ')}" fill="none" stroke="#111" stroke-width="2"/>`;
    let lab = 0;
    for (const pl of places) { if (pl.wraps) continue; svg += `<line x1="${f1(px(pl.s0))}" y1="${py0}" x2="${f1(px(pl.s0))}" y2="${py0 + ph}" stroke="#999" stroke-dasharray="3 3"/><text x="${f1(px(pl.s0) + 3)}" y="${py0 + ph + 14 + (lab++ % 2) * 13}" font-size="11" fill="#333">${pl.name}</text>`; }
    svg += `<text x="6" y="${f1(pz(zhi) + 4)}" font-size="11">${zhi.toFixed(0)} m</text><text x="6" y="${f1(pz(zlo) + 4)}" font-size="11">${zlo.toFixed(0)} m</text><text x="60" y="${py0 - 4}" font-size="12" font-weight="700">HEIGHT ROUND THE LAP (${(zhi - zlo).toFixed(0)} m of range, steepest ${(Math.abs(grade[gi]) * 100).toFixed(1)} %)</text>`; }
  svg += '</svg>';
  if (plan.endsWith('.png')) {
    const tmp = plan.replace(/\.png$/, '.svg');
    fs.writeFileSync(tmp, svg);
    execFileSync('rsvg-convert', ['-o', plan, tmp]);
    fs.unlinkSync(tmp);
  } else fs.writeFileSync(plan, svg);
  console.log(`  plan -> ${plan}`);
}
