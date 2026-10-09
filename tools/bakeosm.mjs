// bakeosm.mjs — a real circuit that is NOT in data/f1-circuits.geojson, baked
// from OpenStreetMap alone.
//
//   node tools/bakeosm.mjs <key> [--force] [--ways]
//     --ways    list the OSM ways the query returned and stop (for writing a CIRCUITS row)
//     --force   re-ask Overpass instead of reading data/env/raw/<key>-raceway.json
//
// tools/bakereal.mjs takes its projection origin and direction from the F1
// GeoJSON, so it cannot make the Nordschleife, Laguna Seca or Mount Panorama.
// This is the same bake (same spline, 2 m samples, curvature window, corner
// finder, run-off clamp, DRS rule, racing line) with the centreline taken from
// OSM's own ways, chained into the lap — what `centreOsm` does for Spa.
//
// PROJECTION: the WGS84 series (tools/geodesy.mjs EXACT), round the mean of the
// lap's own OSM nodes. The origin is written into the track file as `geo` so
// every later bake (bakeenv, getdtm, getcover) uses the same one.
//
// Nothing is invented: a corner takes the name of the OSM way it lies on, or
// none; width is the OSM tag where it is believable, else the row's figure.
import fs from 'fs';
import path from 'path';
import { metresPerDegree, EXACT } from './geodesy.mjs';
import { Track } from '../js/track.js';
import { racingLine } from '../js/line.js';

const ROOT = new URL('../', import.meta.url).pathname;
const DS = 2.0;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

// bb: south,west,north,east.  lap(way): is this way part of the lap.
// start: [lat, lon] of the start/finish line.  cw: true = clockwise seen from above.
// w: HALF width (m) where OSM has no believable width.  real: the official lap (m).
export const CIRCUITS = {
  nordschleife: {
    name: 'Nordschleife', full: 'Nürburgring Nordschleife', country: 'GERMANY', real: 20832,
    bb: '50.325,6.915,50.385,7.015',
    // Everything raceway in the box that is not the Grand Prix circuit, its
    // links, its pit lanes or the rallycross track. What is left chains into
    // exactly one closed loop: the 20.832 km Nordschleife through T13.
    lap: w => w.tags.highway === 'raceway' && w.tags.raceway !== 'pitlane' && !/Sprintstrecke|Boxengasse|Anbindung|Variante|Müllenbach|Rallycross|Schumacher|Ford-Kurve|NGK/i.test(w.tags.name || '')
      && ![820330154, 820679445, 820330152, 820679447, 820679448, 1113008498, 1113009325, 1113009326, 1113009622, 1113009623, 1113009624].includes(w.id),
    // The Nordschleife-only start/finish is on the T13 straight.
    start: [50.33822, 6.95030], cw: true,
    // OSM tags width=5 on a third of the lap. The road is 8-9 m of tarmac
    // (Döttinger Höhe wider); 5 is not believed, so the tag is ignored below 7.
    w: 4.25, minTagW: 7, runoff: 3.5, wall: 'armco', aiPace: 0.8,
    drs: 1, corner: [330, 14, 13, 30],
    notCorner: /^Nürburgring Nordschleife$/i,
    // The lane beside the T13 straight, where the Nordschleife-only races pit.
    pitName: /^Boxengasse an T13$/i,
  },
  lagunaseca: {
    name: 'Laguna Seca', full: 'WeatherTech Raceway Laguna Seca', country: 'USA', real: 3602,
    bb: '36.578,-121.762,36.592,-121.745',
    lap: w => w.tags.highway === 'raceway' && w.tags.raceway !== 'pitlane' && !/pit/i.test(w.tags.name || ''),
    start: [36.58736, -121.75582], cw: false,
    w: 5.5, minTagW: 8, runoff: 14, wall: 'gravel', aiPace: 0.8,
    drs: 1, corner: [200, 14, 24, 40],
    notCorner: /Raceway Laguna Seca|Straight/i,
    pitName: /^Pit Lane$/i,
  },
  bathurst: {
    name: 'Bathurst', full: 'Mount Panorama Circuit', country: 'AUSTRALIA', real: 6213,
    bb: '-33.465,149.535,-33.432,149.568',
    query: bb => `[out:json][timeout:120];(way["highway"](${bb}););out tags geom;`,
    raw: 'roads',
    // A public road: no raceway tags. The lap is the named stretches of it.
    lap: w => /^(residential|tertiary|unclassified)$/.test(w.tags.highway) && /^(Pit Straight|Hell Corner|Mountain Straight|Griffins Bend|The Cutting|Reid Park|Sulman Park|McPhillamy Park|Brocks Skyline|The Esses|Forrest's Elbow|Conrod Straight|The Chase|Murrays Corner)$/.test(w.tags.name || ''),
    start: [-33.43960, 149.55930], cw: false,
    // Concrete both sides for most of the mountain; the gravel at Hell Corner,
    // The Chase and Murrays is not in OSM and is NOT modelled (one run-off figure).
    w: 5.5, minTagW: 8, runoff: 4, wall: 'wall', aiPace: 0.8,
    drs: 1, corner: [200, 14, 24, 40],
    notCorner: /Straight/i,
    pitName: /^Pit Lane$/i,
  },
  brandshatch: {
    name: 'Brands Hatch', full: 'Brands Hatch Grand Prix Circuit', country: 'UNITED KINGDOM', real: 3916,
    bb: '51.350,0.250,51.366,0.275',
    // The Grand Prix loop: every sealed one-way raceway way that is not the
    // Indy circuit's link (McLaren), a pit lane, the kart track or a rally stage.
    lap: w => w.tags.highway === 'raceway' && w.tags.surface === 'asphalt' && w.tags.oneway === 'yes' && !/McLaren|Pit|Kart|Rally/i.test(w.tags.name || ''),
    start: [51.35998, 0.25974], cw: true,
    w: 5.5, minTagW: 8, runoff: 12, wall: 'gravel', aiPace: 0.8,
    drs: 1, corner: [200, 14, 24, 40],
    notCorner: /Straight|Circuit/i,
    pitName: /^Pit Lane$/i,
  },
};
for (const k of Object.keys(CIRCUITS)) if (!EXACT.has(k)) throw new Error(`${k} must be listed in tools/geodesy.mjs EXACT`);

// ---- geometry: the same functions tools/bakereal.mjs ports from DIRTY AIR ----
function crSeg(p0, p1, p2, p3, t, alpha = 0.5) {
  const tj = (pa, pb, ti) => ti + Math.pow(Math.hypot(pb.x - pa.x, pb.y - pa.y), alpha);
  const t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
  if (t1 === t0 || t2 === t1 || t3 === t2) return { x: p1.x, y: p1.y };
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => ({ x: ((tb - tt) * a.x + (tt - ta) * b.x) / (tb - ta), y: ((tb - tt) * a.y + (tt - ta) * b.y) / (tb - ta) });
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
const SUB = 24;
function spline(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < SUB; k++) out.push(crSeg(p0, p1, p2, p3, k / SUB));
  }
  return out;
}
function resample(dense, ds) {
  const n = dense.length, seg = [], cum = [0];
  for (let i = 0; i < n; i++) { const a = dense[i], b = dense[(i + 1) % n], d = Math.hypot(b.x - a.x, b.y - a.y); seg.push(d); cum.push(cum[i] + d); }
  const total = cum[n], count = Math.round(total / ds), step = total / count, out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (j < n - 1 && cum[j + 1] < target) j++;
    const f = seg[j] > 1e-9 ? (target - cum[j]) / seg[j] : 0;
    const a = dense[j], b = dense[(j + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: target, node: a.node ?? Math.floor(j / SUB) });
  }
  return { pts: out, length: total };
}
// OSM nodes are hand-placed, a metre or so either side of the road's line: at
// Westfield Bend one node turns the road 17 degrees between a 4 m leg and a
// 13 m one, and a spline THROUGH the nodes makes that an R 17 m kink in a fast
// corner. A Gaussian of `sigma` metres along the lap takes the jitter out;
// no sample may move more than `tol` from where the survey put it, so a real
// hairpin stays a hairpin (R 15 moves 0.3 m).
function relax(pts, ds, sigma = 3, tol = 0.6) {
  const n = pts.length, r = Math.ceil(sigma * 3 / ds), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-((k * ds) ** 2) / (2 * sigma * sigma)));
  const ws = w.reduce((a, b) => a + b, 0);
  let moved = 0;
  const out = pts.map((p, i) => {
    let x = 0, y = 0;
    for (let k = -r; k <= r; k++) { const q = pts[((i + k) % n + n) % n]; x += q.x * w[k + r]; y += q.y * w[k + r]; }
    let dx = x / ws - p.x, dy = y / ws - p.y; const d = Math.hypot(dx, dy);
    if (d > tol) { dx *= tol / d; dy *= tol / d; }
    moved = Math.max(moved, Math.min(d, tol));
    return { ...p, x: p.x + dx, y: p.y + dy };
  });
  return { pts: out, moved };
}
function reflow(pts, smoothM = 9) {
  const n = pts.length;
  for (let i = 0; i < n; i++) { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; pts[i].hdg = Math.atan2(b.y - a.y, b.x - a.x); }
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dh = b.hdg - a.hdg;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    raw[i] = ds > 1e-6 ? dh / ds : 0;
  }
  const ds = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  const half = Math.max(1, Math.round(smoothM / ds / 2));
  for (let i = 0; i < n; i++) { let acc = 0; for (let k = -half; k <= half; k++) acc += raw[((i + k) % n + n) % n]; pts[i].curv = acc / (2 * half + 1); }
  return pts;
}
function findCorners(pts, minR, minLen, minTurnDeg) {
  const n = pts.length, ds = pts[1].s - pts[0].s;
  const hot = pts.map(p => Math.abs(p.curv) > 1 / minR), runs = [];
  let i = 0;
  while (i < n) {
    if (!hot[i]) { i++; continue; }
    let j = i;
    while (hot[(j + 1) % n] && j - i < n) j++;
    const len = (j - i + 1) * ds;
    let turn = 0, peak = i;
    for (let k = i; k <= j; k++) { const p = pts[k % n]; turn += p.curv * ds; if (Math.abs(p.curv) > Math.abs(pts[peak % n].curv)) peak = k; }
    if (len >= minLen && Math.abs(turn) * 180 / Math.PI >= minTurnDeg) {
      const pk = pts[peak % n];
      runs.push({ s0: pts[i % n].s, s1: pts[j % n].s, sPeak: pk.s, R: 1 / Math.abs(pk.curv), dir: Math.sign(pk.curv), len, turn: Math.abs(turn) * 180 / Math.PI, name: pk.name || null });
    }
    i = j + 1;
  }
  return runs;
}
function mergeCorners(runs, gap) {
  const out = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && prev.dir === r.dir && r.s0 - prev.s1 < gap) { prev.s1 = r.s1; if (r.R < prev.R) { prev.R = r.R; prev.sPeak = r.sPeak; prev.name = r.name; } }
    else out.push({ ...r });
  }
  return out;
}
function longestStraights(center, maxCurv, minLen) {
  const n = center.length;
  const flat = center.map(p => Math.abs(p.curv) < maxCurv), runs = [];
  let i = 0;
  while (i < n) {
    if (!flat[i]) { i++; continue; }
    let j = i;
    while (flat[(j + 1) % n] && j - i < n - 1) j++;
    const L = (j - i + 1) * DS;
    if (L >= minLen) runs.push({ s0: center[i % n].s, s1: center[j % n].s, len: L });
    i = j + 1;
  }
  const wrapped = runs.find(r => r.s1 < r.s0);
  if (wrapped && flat[0]) { const k = runs.findIndex(r => r !== wrapped && r.s0 === center[0].s); if (k >= 0) runs.splice(k, 1); }
  return runs.sort((a, b) => b.len - a.len);
}
const SPONSORS = [
  'FOGLAST', 'CRITTERS', 'VROOM', 'XANCOIN', 'TERMINAL TYCOON', 'ORBIX', 'MOLT', 'OMMOR', 'DEEPWALK', 'INKOGNITO', 'BACKROOMS', 'DOGGO BATTLES',
  'EVERYDEATH', 'CORN', 'RIG 13', 'POND', 'OVERHANG', 'ANT INC', 'SLIPSTREAM', 'CANON EVENT', 'CARDBOARD WARFARE', 'XANBOO78O STUDIOS',
];

// ---- the lap: chain ways end to end, turning one round where it has to -------
const nk = g => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
function chainLoop(ways) {
  const left = ways.map(w => ({ g: w.geometry.slice(), name: w.tags.name || null, width: w.tags.width ? parseFloat(w.tags.width) : null, id: w.id }));
  // start from the longest way
  left.sort((a, b) => b.g.length - a.g.length);
  const first = left.shift();
  let nodes = first.g.map(g => ({ ...g, name: first.name, width: first.width, way: first.id }));
  let grew = true;
  while (grew && left.length) {
    grew = false;
    const tail = nk(nodes[nodes.length - 1]);
    for (let i = 0; i < left.length; i++) {
      const w = left[i];
      let g = null;
      if (nk(w.g[0]) === tail) g = w.g; else if (nk(w.g[w.g.length - 1]) === tail) g = w.g.slice().reverse();
      if (!g) continue;
      nodes = nodes.concat(g.slice(1).map(q => ({ ...q, name: w.name, width: w.width, way: w.id })));
      left.splice(i, 1); grew = true; break;
    }
    if (grew || nk(nodes[0]) === nk(nodes[nodes.length - 1])) continue;
    // an OPEN chain (a pit lane) also grows at its head
    const head = nk(nodes[0]);
    for (let i = 0; i < left.length; i++) {
      const w = left[i];
      let g = null;
      if (nk(w.g[w.g.length - 1]) === head) g = w.g; else if (nk(w.g[0]) === head) g = w.g.slice().reverse();
      if (!g) continue;
      nodes = g.slice(0, -1).map(q => ({ ...q, name: w.name, width: w.width, way: w.id })).concat(nodes);
      left.splice(i, 1); grew = true; break;
    }
  }
  return { nodes, unused: left };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function overpass(query, cacheFile, force) {
  if (!force && fs.existsSync(cacheFile)) {
    const txt = fs.readFileSync(cacheFile, 'utf8');
    if (txt.trim().startsWith('{')) return JSON.parse(txt);
  }
  let wait = 8000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(200000) });
      if (res.ok) {
        const txt = await res.text();
        if (txt.trim().startsWith('{') && JSON.parse(txt).elements?.length) {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, txt);
          return JSON.parse(txt);
        }
        console.log(`    non-JSON or EMPTY body from ${new URL(url).host}, retrying`);
      } else console.log(`    ${res.status} from ${new URL(url).host}, backing off ${wait / 1000}s`);
    } catch (e) { console.log(`    ${e.message}, backing off ${wait / 1000}s`); }
    await sleep(wait);
    wait = Math.min(wait * 1.6, 60000);
  }
  throw new Error('Overpass would not answer after 6 attempts');
}

export function bake(key, C, elements) {
  const log = [];
  const ways = elements.filter(e => e.type === 'way' && e.geometry && e.tags);
  const lapWays = ways.filter(C.lap);
  const { nodes, unused } = chainLoop(lapWays);
  if (nk(nodes[0]) !== nk(nodes[nodes.length - 1])) throw new Error(`${key}: the ways do not close into a lap (${lapWays.length} ways, chain of ${nodes.length} nodes, ${unused.length} unused: ${unused.map(u => u.id + ' ' + (u.name || '')).join(', ')})`);
  if (unused.length) throw new Error(`${key}: ${unused.length} lap ways are not on the loop: ${unused.map(u => u.id + ' ' + (u.name || '')).join(', ')}`);
  let ring = nodes.slice(0, -1);
  const lat0 = +(ring.reduce((a, p) => a + p.lat, 0) / ring.length).toFixed(6);
  const lon0 = +(ring.reduce((a, p) => a + p.lon, 0) / ring.length).toFixed(6);
  const { mx, my } = metresPerDegree(key, lat0);
  const toXY = g => ({ x: (g.lon - lon0) * mx, y: (g.lat - lat0) * my });
  let m = ring.map(g => ({ ...toXY(g), name: g.name, width: g.width }));
  // In a reversed ring, the stretch AFTER node i belongs to what was the way before it.
  const area = p => p.reduce((a, q, i) => a + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0);
  if ((area(m) < 0) !== !!C.cw) { m = m.reverse(); const nm = m.map((q, i) => ({ ...q, name: m[(i + 1) % m.length].name, width: m[(i + 1) % m.length].width })); m = nm; }

  const first = resample(spline(m), DS);
  const rel = relax(first.pts, first.length / first.pts.length, C.relax ?? 3);
  const { pts: c0, length } = resample(rel.pts, DS);
  log.push(`   node jitter relaxed: Gaussian ${C.relax ?? 3} m, no sample moved more than ${rel.moved.toFixed(2)} m; lap ${first.length.toFixed(1)} -> ${length.toFixed(1)} m`);
  // start/finish: rotate so sample 0 is the nearest to the line
  const S = toXY({ lat: C.start[0], lon: C.start[1] });
  let best = 0, bd = Infinity;
  c0.forEach((p, i) => { const d = Math.hypot(p.x - S.x, p.y - S.y); if (d < bd) { bd = d; best = i; } });
  if (bd > 40) throw new Error(`${key}: the start line is ${bd.toFixed(0)} m from the lap`);
  const step = length / c0.length;
  const center = c0.slice(best).concat(c0.slice(0, best)).map((p, i) => ({ ...p, s: i * step, idx: i, name: m[p.node].name, tagW: m[p.node].width }));
  reflow(center, C.smooth || 9);
  const N = center.length;

  // ---- corners, named by the way they lie on
  for (const p of center) if (p.name && C.notCorner && C.notCorner.test(p.name)) p.name = null;
  const cs = C.corner || [200, 14, 24, 40];
  const corners = mergeCorners(findCorners(center, cs[0], cs[1], cs[2]), cs[3]).map((r, i) => ({ n: i + 1, ...r }));

  // ---- width, run-off
  const W = center.map(p => (p.tagW && p.tagW >= (C.minTagW || 0) ? p.tagW / 2 : C.w));
  // a width does not step: 30 m of smoothing where two tagged ways meet
  const Ws = W.map((_, i) => { let a = 0; for (let k = -7; k <= 7; k++) a += W[((i + k) % N + N) % N]; return a / 15; });
  const RUNL = new Array(N).fill(C.runoff), RUNR = new Array(N).fill(C.runoff);
  for (const p of center) {
    const R = 1 / Math.max(Math.abs(p.curv), 1e-6), cap = Math.max(1.5, R * 0.8 - Ws[p.idx]);
    if (p.curv > 0) RUNL[p.idx] = Math.min(RUNL[p.idx], cap); else if (p.curv < 0) RUNR[p.idx] = Math.min(RUNR[p.idx], cap);
  }

  // ---- DRS
  let straights = [];
  for (const minLen of [260, 220, 180, 150, 120, 95]) { straights = longestStraights(center, 1 / 500, minLen); if (straights.length >= C.drs) break; }
  const drs = straights.slice(0, C.drs).map(st => ({ from: +(st.s0 + 45).toFixed(0), to: +(st.s1 - 55).toFixed(0),
    detect: +(((st.s0 - 130) % length + length) % length).toFixed(0), len: +st.len.toFixed(0) }));

  // ---- pit lane (only if OSM has one that starts and ends beside the lap)
  let pit = null;
  if (C.pitName) {
    const project = (x, y) => { let b = 0, d = Infinity; for (let i = 0; i < N; i++) { const q = (center[i].x - x) ** 2 + (center[i].y - y) ** 2; if (q < d) { d = q; b = i; } }
      const p = center[b]; return { s: p.s, d: Math.sqrt(d), lat: -Math.sin(p.hdg) * (x - p.x) + Math.cos(p.hdg) * (y - p.y) }; };
    const cand = ways.filter(w => C.pitName.test(w.tags.name || ''));
    if (cand.length) {
      const ch = chainLoop(cand).nodes.map(toXY);
      let mm = ch;
      const pa = project(mm[0].x, mm[0].y), pb = project(mm[mm.length - 1].x, mm[mm.length - 1].y);
      if (pa.d < 60 && pb.d < 60) {
        let aS = pa.s, bS = pb.s, fwd = bS - aS; while (fwd < 0) fwd += length;
        if (fwd > length / 2) { mm = mm.slice().reverse(); const t = aS; aS = bS; bS = t; }
        const midp = mm[mm.length >> 1], side = Math.sign(project(midp.x, midp.y).lat) || 1;
        pit = { entryS: +aS.toFixed(0), exitS: +bS.toFixed(0), side, synth: false, pts: mm.map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]) };
        // Room for the lane on its own side. The lane's own distance out at every
        // sample it passes (filled straight across the stretch where it cuts a
        // corner and projects onto nothing), never past the centre of a corner
        // on its inside, and never stepping sideways: a wall is continuous.
        const dense = [];
        for (let k = 0; k + 1 < mm.length; k++) { const a = mm[k], b = mm[k + 1], q = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5)); for (let o = 0; o < q; o++) dense.push([a.x + (b.x - a.x) * o / q, a.y + (b.y - a.y) * o / q]); }
        const RUNS = side > 0 ? RUNL : RUNR, need = new Map();
        for (const [px, py] of dense) {
          const q = project(px, py), k = Math.round(q.s / step) % N;
          if (Math.sign(q.lat) === side) need.set(k, Math.max(need.get(k) || 0, Math.min(40, Math.abs(q.lat) + 4.5)));
        }
        const k0 = Math.round(pit.entryS / step) % N, span = ((Math.round(pit.exitS / step) - k0) % N + N) % N;
        let lastK = null, lastV = 0;
        const want = new Array(span + 1).fill(0);
        for (let o = 0; o <= span; o++) {
          const v = need.get((k0 + o) % N);
          if (v == null) continue;
          if (lastK != null) for (let q = lastK + 1; q < o; q++) want[q] = lastV + (v - lastV) * (q - lastK) / (o - lastK);
          want[o] = v; lastK = o; lastV = v;
        }
        for (let o = 0; o <= span; o++) {
          const kk = (k0 + o) % N, p = center[kk], R = 1 / Math.max(Math.abs(p.curv), 1e-6);
          let v = Math.max(RUNS[kk], want[o] - Ws[kk]);
          if (Math.sign(p.curv) === side) v = Math.min(v, Math.max(RUNS[kk], R * 0.9 - Ws[kk]));
          RUNS[kk] = v;
        }
        for (let pass = 0; pass < 2; pass++) {
          for (let o = -40; o <= span + 40; o++) { const a = ((k0 + o) % N + N) % N, b = ((k0 + o + 1) % N + N) % N; RUNS[b] = Math.min(RUNS[b], RUNS[a] + 1.4); }
          for (let o = span + 40; o >= -40; o--) { const a = ((k0 + o) % N + N) % N, b = ((k0 + o - 1) % N + N) % N; RUNS[b] = Math.min(RUNS[b], RUNS[a] + 1.4); }
        }
        log.push(`   pit lane from OSM: ${pit.entryS} -> ${pit.exitS}, ${side > 0 ? 'left' : 'right'}, ${mm.length} pts`);
      } else log.push(`   OSM pit lane ends ${pa.d.toFixed(0)} / ${pb.d.toFixed(0)} m from the lap — not used`);
    }
  }
  if (!pit) log.push('   pit: null (tools/synthpit.mjs can add one)');

  // ---- the barrier stands in front of what is built (tools/bakereal.mjs `standsClear`)
  // Once tools/bakeenv.mjs has surveyed the surroundings, re-running this bake
  // brings the barrier 2 m in front of any footprint that stands inside the
  // run-off figure — a grandstand on the pit straight — except on the pit
  // lane's own side along the lane, where the lane needs the room.
  const envFile = `${ROOT}data/env/${key}.json`;
  if (fs.existsSync(envFile)) {
    const blds = JSON.parse(fs.readFileSync(envFile, 'utf8')).buildings;
    const hit = (px, py, dx, dy, a, c) => {
      const ex = c[0] - a[0], ey = c[1] - a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) return null;
      const t = ((a[0] - px) * ey - (a[1] - py) * ex) / den, u = ((a[0] - px) * dy - (a[1] - py) * dx) / den;
      return t > 0 && u >= 0 && u <= 1 ? t : null;
    };
    // only footprints near the lap, bucketed by a coarse grid
    const near = new Map(), CELL = 80, ck = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
    for (const bd of blds) { const seen = new Set(); for (const q of bd.p) { const k = ck(q[0], q[1]); if (!seen.has(k)) { seen.add(k); if (!near.has(k)) near.set(k, []); near.get(k).push(bd); } } }
    const inPit = i => { if (!pit) return false; const sp = center[i].s; return pit.entryS <= pit.exitS ? (sp >= pit.entryS - 30 && sp <= pit.exitS + 30) : (sp >= pit.entryS - 30 || sp <= pit.exitS + 30); };
    let moved = 0;
    for (let i = 0; i < N; i++) {
      const p = center[i], lx = -Math.sin(p.hdg), ly = Math.cos(p.hdg), cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      const cand = new Set();
      for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) for (const bd of near.get((cx + a) + ',' + (cy + b2)) || []) cand.add(bd);
      for (const [sd, RUNS] of [[1, RUNL], [-1, RUNR]]) {
        if (pit && sd === pit.side && inPit(i)) continue;
        let d = Infinity;
        for (const bd of cand) for (let j = 0; j < bd.p.length; j++) { const t = hit(p.x, p.y, lx * sd, ly * sd, bd.p[j], bd.p[(j + 1) % bd.p.length]); if (t != null && t < d) d = t; }
        const cap = Math.max(1.5, d - Ws[i] - 2);
        if (cap < RUNS[i]) { RUNS[i] = cap; moved++; }
      }
    }
    if (moved) {
      for (const RUNS of [RUNL, RUNR]) for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < N; i++) RUNS[(i + 1) % N] = Math.min(RUNS[(i + 1) % N], RUNS[i] + 1.4);
        for (let i = N - 1; i >= 0; i--) RUNS[(i - 1 + N) % N] = Math.min(RUNS[(i - 1 + N) % N], RUNS[i] + 1.4);
      }
    }
    log.push(`   barrier brought in front of surveyed buildings at ${moved} samples`);
  }

  // ---- the named stretches of the lap, as OSM names them (extra to the schema;
  // tools/trackcheck.mjs says where a crest is with it)
  const sections = [];
  for (const p of center) {
    const nm = m[p.node].name || null, last = sections[sections.length - 1];
    if (last && last.name === nm) last.s1 = +p.s.toFixed(0); else sections.push({ name: nm, s0: +p.s.toFixed(0), s1: +p.s.toFixed(0) });
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of center) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const out = {
    key, name: C.name, full: C.full, country: C.country, aiPace: C.aiPace ?? 0.8,
    length: +length.toFixed(1), ds: DS, wall: C.wall, crossover: false,
    // where it is: the projection origin every other bake of this circuit uses
    geo: { lat0, lon0, projection: 'wgs84-series (tools/geodesy.mjs EXACT)', source: 'OpenStreetMap contributors, ODbL' },
    bbox: { x0: +x0.toFixed(1), y0: +y0.toFixed(1), x1: +x1.toFixed(1), y1: +y1.toFixed(1) },
    x: center.map(p => +p.x.toFixed(2)), y: center.map(p => +p.y.toFixed(2)),
    w: Ws.map(v => +v.toFixed(2)), bank: new Array(N).fill(0),
    runL: RUNL.map(v => +v.toFixed(1)), runR: RUNR.map(v => +v.toFixed(1)),
    line: null,
    corners: corners.map(c => ({ n: c.n, num: null, name: c.name || null, s0: +c.s0.toFixed(0), s1: +c.s1.toFixed(0), s: +c.sPeak.toFixed(0),
      R: +c.R.toFixed(0), dir: c.dir, turn: +c.turn.toFixed(0) })),
    drs, pit, sections: sections.filter(q => q.name), sponsors: SPONSORS,
  };
  const tk = new Track(JSON.parse(JSON.stringify(out)));
  out.line = Array.from(racingLine(tk, 0.35), v => +v.toFixed(2));

  // ---- the checks that are cheap here
  let kMax = 0, iMax = 0;
  center.forEach((p, i) => { if (Math.abs(p.curv) > kMax) { kMax = Math.abs(p.curv); iMax = i; } });
  const a = center[N - 1], b = center[0], c = center[1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  let dh = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x); while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  log.unshift(`${C.full}: ${length.toFixed(1)} m (official ${C.real} m, ${((length / C.real - 1) * 100).toFixed(2)}%)  ${lapWays.length} ways, ${ring.length} nodes, ${N} samples, ${corners.length} corners`,
    `   origin ${lat0}, ${lon0}   closes: gap ${gap.toFixed(2)} m (step ${step.toFixed(2)}), heading change ${(dh * 180 / Math.PI).toFixed(2)} deg`,
    `   tightest: R ${(1 / kMax).toFixed(1)} m at s=${center[iMax].s.toFixed(0)} (${center[iMax].name || 'unnamed'})   width ${(2 * Math.min(...Ws)).toFixed(1)}-${(2 * Math.max(...Ws)).toFixed(1)} m`,
    `   DRS ${drs.map(d => `${d.from}->${d.to} (${d.len} m)`).join(', ') || 'none'}`);
  log.push('   ' + corners.map(c => `${c.n}${c.dir > 0 ? 'L' : 'R'}${c.name ? ':' + c.name : ''}`).join(' '));
  return { out, log };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  for (const a of args) if (a.startsWith('--') && !['--force', '--ways'].includes(a)) { console.error(`bakeosm: unknown flag ${a}`); process.exit(2); }
  const keys = args.filter(a => !a.startsWith('--'));
  if (keys.length !== 1 || !CIRCUITS[keys[0]]) { console.error(`usage: node tools/bakeosm.mjs <key> [--force] [--ways]   keys: ${Object.keys(CIRCUITS).join(', ')}`); process.exit(2); }
  const key = keys[0], C = CIRCUITS[key];
  const q = C.query ? C.query(C.bb) : `[out:json][timeout:120];(way["highway"="raceway"](${C.bb});way["raceway"="pitlane"](${C.bb}););out tags geom;`;
  const res = await overpass(q, `${ROOT}data/env/raw/${key}-${C.raw || 'raceway'}.json`, args.includes('--force'));
  if (args.includes('--ways')) {
    for (const w of res.elements) {
      if (w.type !== 'way' || !w.geometry) continue;
      const g = w.geometry, c = Math.cos(g[0].lat * Math.PI / 180); let L = 0;
      for (let i = 1; i < g.length; i++) L += Math.hypot((g[i].lat - g[i - 1].lat) * 111200, (g[i].lon - g[i - 1].lon) * 111320 * c);
      const t = w.tags || {};
      if (/footway|path|cycleway|steps|pedestrian/.test(t.highway || '') && !t.name) continue;
      console.log(w.id, String(g.length).padStart(3), L.toFixed(0).padStart(6), t.highway || '', t.raceway || '', '|', t.name || '', '|', t.width || '', t.oneway || '', t.surface || '',
        `${g[0].lat.toFixed(5)},${g[0].lon.toFixed(5)} ${g[g.length - 1].lat.toFixed(5)},${g[g.length - 1].lon.toFixed(5)}`);
    }
    process.exit(0);
  }
  const { out, log } = bake(key, C, res.elements);
  fs.writeFileSync(`${ROOT}data/tracks/${key}.json`, JSON.stringify(out));
  console.log(log.join('\n') + `\n   -> data/tracks/${key}.json  ${(fs.statSync(`${ROOT}data/tracks/${key}.json`).size / 1024).toFixed(0)} KB`);
}
