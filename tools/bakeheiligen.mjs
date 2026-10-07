// bakeheiligen.mjs — the Heiligen Auto Circuit, from its drawing to twelve tracks.
//
//   node tools/bakeheiligen.mjs [--plan out.svg] [--dry]
//
// data/build/heiligen.js is the drawing: junctions, the roads between them
// point by point, and the twelve routes that are laps of it. This puts a
// spline through each route and writes, per route:
//
//   data/tracks/<key>.json   the same format every circuit here has, plus
//                            `road` (0 tarmac, 1 gravel, 2 snow, per sample)
//                            and `jumps` ([{ s, kick }]) which js/race.js reads
//   data/elev/<key>.json     the road's height per sample, and the land around
//                            it on a grid (one mountain, shared by all twelve)
//
// and prints every route's length, because two of them are promises: GRAND
// is 9.0 km and SPRINT is Kate Mascoi's 4.9 km. `--plan` draws the whole
// network as an SVG to look at; `--dry` writes nothing else.
//
// NOTHING IS GENERATED. Every bend is a point somebody typed. What this tool
// decides is only what follows from them: the spline, the corner list (from
// curvature, named from the drawing), the racing line, the blend where a
// 12 m road becomes a 9 m forest track.
import fs from 'fs';
import { Track } from '../js/track.js';
import { racingLine } from '../js/line.js';
import { SCALE, KINDS, NODES, SEGMENTS, ROUTES } from '../data/build/heiligen.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
let plan = null, dry = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--plan') plan = args[++i];
  else if (args[i] === '--dry') dry = true;
  else { console.error(`bakeheiligen: unknown argument ${args[i]}`); process.exit(2); }
}
const DS = 2, ROADCODE = { tarmac: 0, gravel: 1, snow: 2 };
const sc = p => [p[0] * SCALE, p[1] * SCALE, p[2]];

// ---- a segment as a polyline of control points, with what each carries ----------
function controls(name) {
  const g = SEGMENTS[name];
  if (!g) throw new Error('no segment ' + name);
  const K = { ...KINDS[g.kind], ...(g.w ? { w: g.w } : {}), ...(g.run ? { run: g.run } : {}) };
  return { g, K, pts: [NODES[g.from], ...g.pts, NODES[g.to]].map(sc) };
}

// Centripetal Catmull-Rom through a CLOSED ring of [x, y, z, tag], `sub` per span.
function spline(P, sub = 20) {
  const n = P.length, out = [];
  const tj = (a, b, t) => t + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
    for (let k = 0; k < sub; k++) {
      const t = t1 + (t2 - t1) * k / sub;
      const L = (a, b, ta, tb) => a.map((v, d) => d > 2 ? v : ((tb - t) * a[d] + (t - ta) * b[d]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3), C = L(B1, B2, t1, t2);
      out.push({ x: C[0], y: C[1], z: C[2], span: i, f: k / sub });
    }
  }
  return out;
}

const smooth = (a, passes, closed = true) => {
  let v = Float64Array.from(a);
  const n = v.length;
  for (let p = 0; p < passes; p++) {
    const w = Float64Array.from(v);
    for (let i = 0; i < n; i++) {
      const l = closed ? v[(i - 1 + n) % n] : v[Math.max(0, i - 1)], r = closed ? v[(i + 1) % n] : v[Math.min(n - 1, i + 1)];
      w[i] = (l + 2 * v[i] + r) / 4;
    }
    v = w;
  }
  return v;
};

function bakeRoute(route) {
  // The ring of control points, each remembering its segment and where in it.
  const ring = [], segOf = [];
  for (const name of route.segs) {
    const c = controls(name);
    const prev = route.segs[(route.segs.indexOf(name) - 1 + route.segs.length) % route.segs.length];
    if (SEGMENTS[prev].to !== c.g.from) throw new Error(`${route.key}: ${prev} ends at ${SEGMENTS[prev].to}, ${name} starts at ${c.g.from}`);
    let L = 0; const cum = [0];
    for (let k = 1; k < c.pts.length; k++) { L += Math.hypot(c.pts[k][0] - c.pts[k - 1][0], c.pts[k][1] - c.pts[k - 1][1]); cum.push(L); }
    for (let k = 0; k < c.pts.length - 1; k++) { ring.push(c.pts[k]); segOf.push({ name, c, f0: cum[k] / L, f1: cum[k + 1] / L }); }
  }
  // Spline, then even 2 m samples; each sample knows its segment and fraction.
  const dense = spline(ring);
  const cum = [0];
  for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y)); }
  const total = cum[dense.length], n = Math.round(total / DS), step = total / n;
  const S = [];
  for (let k = 0, j = 0; k < n; k++) {
    const target = k * step;
    while (j < dense.length - 1 && cum[j + 1] < target) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], f = (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    const so = segOf[a.span];
    S.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, seg: so.name, c: so.c,
      frac: so.f0 + (so.f1 - so.f0) * Math.min(1, a.f + f / 20) });
  }
  // The lap's line is where the Hauptstrasse's grid would be: 300 m from its head.
  const rot = Math.round(300 * SCALE / step);
  const T = S.slice(rot).concat(S.slice(0, rot));
  const length = n * step;

  // Width and run-off: the segment's, blended over ~40 m where they change.
  const w = Array.from(smooth(T.map(p => p.c.K.w), 60)), run = Array.from(smooth(T.map(p => p.c.K.run), 60));
  // Banking: full inside the banked span of a bowl, tapered at its ends.
  const bank = Array.from(smooth(T.map(p => (p.c.g.bank && p.frac >= p.c.g.banked[0] && p.frac <= p.c.g.banked[1] ? p.c.g.bank : 0)), 80));
  const road = T.map(p => ROADCODE[p.c.K.surf]);
  // Height: the drawing's, graded (a road is smooth even where the points are not).
  let z = smooth(T.map(p => p.z), 30);
  // Jumps: a kicker before the lip — the road rises to it over 28 m and is
  // back on its grade 18 m after, so the lip is where it drops away.
  const jumps = [];
  const seenJ = new Set();
  for (let i = 0; i < n; i++) {
    const p = T[i], q = T[(i + 1) % n];
    for (const [jf, kick] of p.c.g.jumps || []) {
      const id = p.seg + jf;
      if (seenJ.has(id) || p.seg !== q.seg || !(p.frac <= jf && q.frac > jf)) continue;
      seenJ.add(id);
      const H = kick * 28 / 1.9;                                  // the kicker's height for that lip slope
      for (let o = -14; o <= 9; o++) {
        const k = ((i + o) % n + n) % n, d = o * step;
        const u = d <= 0 ? (d + 28) / 28 : 1 - d / 18;
        z[k] += H * (d <= 0 ? u * u * (3 - 2 * u) * (0.35 + 0.65 * u) : Math.max(0, u) ** 2);
      }
      jumps.push({ s: +(i * step).toFixed(0), kick, name: p.c.g.name });
    }
  }
  z = smooth(z, 2);

  // Corners, from curvature; named from the drawing where it names them.
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
      const p = T[peak], names = p.c.g.corners || {};
      let name = p.c.g.name, bd = 0.09;
      for (const [f, nm] of Object.entries(names)) { const d = Math.abs(+f - p.frac); if (d < bd) { bd = d; name = nm; } }
      corners.push({ n: corners.length + 1, num: corners.length + 1, name, s0: +(i * step).toFixed(0), s1: +((j - 1) * step).toFixed(0),
        s: +(peak * step).toFixed(0), R: +(1 / Math.abs(curv[peak])).toFixed(0), dir: Math.sign(curv[peak]), turn: +deg.toFixed(0) });
    }
    i = j;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of T) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2);
  const json = {
    key: route.key, name: route.name, full: `Heiligen Auto Circuit — ${route.name.replace('Heiligen ', '')}`, country: 'VALCORSA',
    aiPace: 0.8, length: +length.toFixed(1), ds: +step.toFixed(4), wall: 'armco', crossover: false, open: false,
    bbox: { x0: r1(x0), y0: r1(y0), x1: r1(x1), y1: r1(y1) },
    x: T.map(p => r2(p.x)), y: T.map(p => r2(p.y)), w: w.map(r2), bank: bank.map(r1),
    runL: run.map(r1), runR: run.map(r1), line: new Array(n).fill(0),
    corners, drs: [], pit: null, sponsors: [],
    road, jumps,
  };
  json.line = Array.from(racingLine(new Track(json), 0.35), v => +v.toFixed(2));
  return { json, z: Array.from(z), T, step };
}

// ---- the land: one mountain for all twelve -------------------------------------------
// Height anywhere is the height of the roads near it (every road on the site,
// not just this lap's), weighted by closeness, so the ground meets every road
// and the hill between two of them is a hill.
const ALL = [];
for (const name of Object.keys(SEGMENTS)) { const c = controls(name); for (let k = 0; k + 1 < c.pts.length; k++) for (let f = 0; f < 1; f += 0.25) ALL.push([c.pts[k][0] + (c.pts[k + 1][0] - c.pts[k][0]) * f, c.pts[k][1] + (c.pts[k + 1][1] - c.pts[k][1]) * f, c.pts[k][2] + (c.pts[k + 1][2] - c.pts[k][2]) * f]); }
function landAt(x, y) {
  let sw = 0, sh = 0;
  for (const [px, py, pz] of ALL) { const d2 = (px - x) ** 2 + (py - y) ** 2 + 400, wgt = 1 / (d2 * d2); sw += wgt; sh += wgt * pz; }
  // Beyond the roads the mountain goes on up to the north and the valley stays low.
  return sh / sw + Math.max(0, (y / SCALE - 1500)) * 0.06;
}
const PAD = 500;
let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
for (const [x, y] of ALL) { gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x); gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); }
gx0 -= PAD; gy0 -= PAD; gx1 += PAD; gy1 += PAD;
const GN = 72, gdx = (gx1 - gx0) / (GN - 1), gdy = (gy1 - gy0) / (GN - 1), GH = [];
for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) GH.push(landAt(gx0 + i * gdx, gy0 + j * gdy));

// ---- bake ------------------------------------------------------------------------------
const baked = ROUTES.map(r => ({ r, ...bakeRoute(r) }));
console.log('HEILIGEN AUTO CIRCUIT — the twelve routes\n');
for (const { r, json, z } of baked) {
  const surf = [0, 1, 2].map(c => Math.round(100 * json.road.filter(v => v === c).length / json.road.length));
  let up = 0; for (let i = 1; i < z.length; i++) up = Math.max(up, Math.abs(z[i] - z[i - 1]) / json.ds);
  console.log(`  ${r.key.padEnd(12)} ${(json.length / 1000).toFixed(3)} km  ${String(json.corners.length).padStart(2)} corners  tarmac ${String(surf[0]).padStart(3)}%  gravel ${String(surf[1]).padStart(3)}%  snow ${String(surf[2]).padStart(3)}%  ` +
    `climbs ${(Math.max(...z) - Math.min(...z)).toFixed(0).padStart(3)} m  steepest ${(up * 100).toFixed(0).padStart(2)}%  banked ${Math.max(...json.bank).toFixed(0)}°  jumps ${json.jumps.length}  tightest R${Math.min(...json.corners.map(c => c.R))}  ${r.name}`);
}
if (!dry) {
  for (const { r, json, z } of baked) {
    fs.writeFileSync(`${ROOT}data/tracks/${r.key}.json`, JSON.stringify(json));
    const mean = z.reduce((a, b) => a + b, 0) / z.length;
    fs.writeFileSync(`${ROOT}data/elev/${r.key}.json`, JSON.stringify({
      key: r.key, dataset: 'hand-built', ds: json.ds,
      note: 'metres relative to the mean height of the lap; drawn in data/build/heiligen.js',
      mean: +mean.toFixed(1), range: [+(Math.min(...z) - mean).toFixed(2), +(Math.max(...z) - mean).toFixed(2)],
      s: z.map(v => +(v - mean).toFixed(2)),
      grid: { x0: +gx0.toFixed(1), y0: +gy0.toFixed(1), dx: +gdx.toFixed(3), dy: +gdy.toFixed(3), n: GN, h: GH.map(v => +(v - mean).toFixed(2)) },
    }));
  }
  // The map the menu draws and clicks on: every road once, and every route.
  const segs = {};
  for (const { T } of baked) {
    // A lap's line is part-way along the Hauptstrasse, so that road is the
    // lap's last run AND its first: the two are one road, joined end to start.
    const runs = new Map();
    let cur = null, run = [];
    const flush = () => { if (cur && run.length) runs.set(cur, runs.has(cur) ? [...run, ...runs.get(cur)] : run); run = []; };
    for (const p of T) { if (p.seg !== cur) { flush(); cur = p.seg; } run.push(p); }
    flush();
    for (const [name, r] of runs) {
      if (segs[name] && segs[name].n >= r.length) continue;
      const g = SEGMENTS[name];
      segs[name] = { from: g.from, to: g.to, surf: KINDS[g.kind].surf, label: g.name, n: r.length,
        pts: r.filter((_, k) => k % 4 === 0 || k === r.length - 1).map(p => [+p.x.toFixed(0), +p.y.toFixed(0)]) };
    }
  }
  fs.writeFileSync(`${ROOT}data/build/heiligen-map.json`, JSON.stringify({
    note: 'tools/bakeheiligen.mjs from data/build/heiligen.js',
    nodes: Object.fromEntries(Object.entries(NODES).map(([k, p]) => [k, sc(p).map(v => +v.toFixed(0))])),
    segs,
    routes: baked.map(({ r, json }) => ({ key: r.key, name: r.name, tag: r.tag, segs: r.segs, km: +(json.length / 1000).toFixed(3), jumps: json.jumps.length, corners: json.corners.length })),
  }));
  console.log(`\n  -> data/tracks/heil*.json and data/elev/heil*.json (${baked.length} each)`);
}

// ---- the plan ---------------------------------------------------------------------------
if (plan) {
  const COL = { tarmac: '#2b2b2f', gravel: '#b0844a', snow: '#7fb4e6' };
  const W = 1500, sx = W / (gx1 - gx0 - 2 * PAD + 300), X = x => (x - gx0 - PAD + 150) * sx, Y = y => (gy1 - PAD + 150 - y) * sx, H = (gy1 - gy0 - 2 * PAD + 300) * sx;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" font-family="Helvetica,Arial,sans-serif"><rect width="100%" height="100%" fill="#eef0e6"/>`;
  // every road once, from the dense spline of a route that uses it
  const drawn = new Map();
  for (const { json, T } of baked) {
    let run = [], cur = null;
    const flush = () => { if (run.length > 1 && (!drawn.has(cur) || drawn.get(cur) === json.key)) { const s = SEGMENTS[cur], K = KINDS[s.kind]; svg += `<polyline points="${run.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${COL[K.surf]}" stroke-width="${Math.max(3, (s.w || K.w) * 2 * sx * 1.6).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`; drawn.set(cur, json.key); } run = []; };
    for (const p of T) { if (p.seg !== cur) { flush(); cur = p.seg; } run.push(p); }
    flush(); void json;
  }
  const g = baked.find(b => b.r.key === 'heilgrand'), sp = baked.find(b => b.r.key === 'heilsprint'), rx = baked.find(b => b.r.key === 'heilrxj');
  for (const b of [g, sp, rx]) {
    for (const c of b.json.corners) { const i = Math.round(c.s / b.json.ds) % b.T.length, p = b.T[i]; svg += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3" fill="#d2222d"/><text x="${(X(p.x) + 7).toFixed(1)}" y="${(Y(p.y) + 4).toFixed(1)}" font-size="12" fill="#111">${c.name} R${c.R}</text>`; }
    for (const j of b.json.jumps) { const p = b.T[Math.round(j.s / b.json.ds) % b.T.length]; svg += `<path d="M${X(p.x) - 8} ${Y(p.y) + 7} L${X(p.x)} ${Y(p.y) - 9} L${X(p.x) + 8} ${Y(p.y) + 7}Z" fill="#ffd400" stroke="#111"/>`; }
  }
  for (const [name, p] of Object.entries(NODES)) { const q = sc(p); svg += `<circle cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="6" fill="#fff" stroke="#111" stroke-width="2"/><text x="${(X(q[0]) + 9).toFixed(1)}" y="${(Y(q[1]) - 8).toFixed(1)}" font-size="13" font-weight="700" fill="#0a4">${name} ${q[2]}m</text>`; }
  // s marks every 500 m on the Grand
  for (let s = 0; s < g.json.length; s += 500) { const p = g.T[Math.round(s / g.json.ds) % g.T.length]; svg += `<text x="${(X(p.x) - 14).toFixed(1)}" y="${(Y(p.y) - 8).toFixed(1)}" font-size="11" fill="#666">${s}</text>`; }
  svg += `<text x="20" y="30" font-size="22" font-weight="700">HEILIGEN AUTO CIRCUIT</text><text x="20" y="52" font-size="13">black tarmac · brown gravel · blue snow · yellow = jump · red = corner (Grand, Sprint, Rallycross)</text></svg>`;
  fs.writeFileSync(plan, svg);
  console.log(`  plan -> ${plan}`);
}
