// bakereal.mjs — a REAL circuit, baked from survey data, the way the first five were.
//
//   node tools/bakereal.mjs <key> [--force]      (only: nurburgring)
//
// Monza, Zandvoort, Suzuka, Monaco and Baku were baked by DIRTY AIR's
// tools/bake.mjs, and data/tracks/monza.json is still byte-identical to what
// that tool writes. This is a port of the same bake, for circuits added after
// the fork, so the sixth circuit is made by the same rules as the first five
// rather than by a second opinion about them:
//
//   centreline   the F1-circuits GeoJSON, centripetal Catmull-Rom, 2 m samples
//   corners      curvature runs, NAMED from OpenStreetMap raceway ways
//   pit lane     the OSM pit-lane way(s), oriented entry -> exit
//   run-off      per side, clamped on the inside of tight corners
//   line         the minimum-curvature racing line, baked in
//
// The one difference is where the OSM ways come from. DIRTY AIR fetched one
// ways.json for its five circuits by hand; this asks Overpass for the ways
// around THIS circuit and caches the answer in data/env/raw/<key>-raceway.json,
// next to the environment bake's caches, so a re-run costs nothing.
//
// PROOF THE PORT IS FAITHFUL: `bakeCircuit` is exported, and fed DIRTY AIR's
// ways.json with Monza's SPEC it reproduces data/tracks/monza.json byte for
// byte (verified 2026-09-23, after the DRS wrap fix below as well).
//
// Nothing is invented. A corner OSM does not name stays unnamed ("Turn 3").
import fs from 'fs';
import path from 'path';
import { Track } from '../js/track.js';
import { racingLine } from '../js/line.js';

const ROOT = new URL('../', import.meta.url).pathname;
const GJ = ROOT + 'data/f1-circuits.geojson';
const DS = 2.0;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// NOT overpass.osm.ch, which tools/bakeenv.mjs also lists: it only holds
// SWITZERLAND. Asked about the Eifel it answers 200 with zero elements, which
// looks exactly like "OSM has no raceway here" and got cached as such on the
// first run. An empty answer is refused below for the same reason.

export const CIRCUITS = {
  nurburgring: { id: 'de-1927', name: 'Nürburgring', full: 'Nürburgring Grand-Prix-Strecke' },
};

// Per-circuit authored layer, same meaning as DIRTY AIR's SPEC. `w` is HALF
// width in metres, used only when OSM carries no width tag.
export const SPEC = {
  nurburgring: {
    aiPace: 0.74,
    // The GP circuit is a modern permanent track: wide, with big gravel and
    // asphalt run-offs. 12-15 m wide in reality; 6.5 m half-width.
    country: 'GERMANY', w: 6.5, runoff: 14, wall: 'gravel', startOff: 0,
    drs: 2, corner: [200, 14, 24, 40],
    // Raceway ways that run ALONG the circuit but are not corners. The whole
    // short layout is tagged "Nürburgring Sprintstrecke", and without this
    // every corner on it would be named after the circuit.
    notCorner: /Sprintstrecke|Sprint course|Boxengasse|Anbindung|connection to|Variante|Rallycross/i,
    // The pit lane is tagged raceway=pitlane / "Boxengasse". "Boxengasse an T13"
    // is the Nordschleife's tourist-drive lane on the other side of the
    // complex and must not be picked up.
    pitName: /^Boxengasse$/i,
  },
};

// ---- geometry (ported verbatim from dirtyair/tools/geo.mjs) -----------------
function loadRaw(id) {
  const gj = JSON.parse(fs.readFileSync(GJ, 'utf8'));
  const f = gj.features.find(f => f.properties.id === id);
  if (!f) throw new Error('no circuit ' + id);
  let c = f.geometry.coordinates.slice();
  if (c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]) c.pop();
  const lat0 = c.reduce((a, p) => a + p[1], 0) / c.length;
  const lon0 = c.reduce((a, p) => a + p[0], 0) / c.length;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  return {
    props: f.properties, lat0, lon0, coords: c,
    pts: c.map(([lo, la]) => ({ x: (lo - lon0) * mx, y: (la - lat0) * my })),
  };
}

function crSeg(p0, p1, p2, p3, t, alpha = 0.5) {
  const tj = (pa, pb, ti) => ti + Math.pow(Math.hypot(pb.x - pa.x, pb.y - pa.y), alpha);
  const t0 = 0, t1 = tj(p0, p1, t0), t2 = tj(p1, p2, t1), t3 = tj(p2, p3, t2);
  if (t1 === t0 || t2 === t1 || t3 === t2) return { x: p1.x, y: p1.y };
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => ({
    x: ((tb - tt) * a.x + (tt - ta) * b.x) / (tb - ta),
    y: ((tb - tt) * a.y + (tt - ta) * b.y) / (tb - ta),
  });
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

function spline(pts, sub = 24) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < sub; k++) out.push(crSeg(p0, p1, p2, p3, k / sub));
  }
  return out;
}

function resample(dense, ds = 2.0) {
  const n = dense.length;
  const seg = [], cum = [0];
  for (let i = 0; i < n; i++) {
    const a = dense[i], b = dense[(i + 1) % n];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(d); cum.push(cum[i] + d);
  }
  const total = cum[n];
  const count = Math.round(total / ds);
  const step = total / count;
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (j < n - 1 && cum[j + 1] < target) j++;
    const f = seg[j] > 1e-9 ? (target - cum[j]) / seg[j] : 0;
    const a = dense[j], b = dense[(j + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: target });
  }
  return { pts: out, length: total, ds: step };
}

function reflow(pts, smoothM = 9) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    pts[i].hdg = Math.atan2(b.y - a.y, b.x - a.x);
  }
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dh = b.hdg - a.hdg;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    raw[i] = ds > 1e-6 ? dh / ds : 0;
  }
  const ds = pts.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 1;
  const half = Math.max(1, Math.round(smoothM / ds / 2));
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += raw[((i + k) % n + n) % n];
    pts[i].curv = acc / (2 * half + 1);
  }
  return pts;
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function findCorners(pts, minR = 400, minLen = 18, minTurnDeg = 22) {
  const n = pts.length, ds = pts[1].s - pts[0].s;
  const hot = pts.map(p => Math.abs(p.curv) > 1 / minR);
  const runs = [];
  let i = 0;
  while (i < n) {
    if (!hot[i]) { i++; continue; }
    let j = i;
    while (hot[(j + 1) % n] && j - i < n) j++;
    const len = (j - i + 1) * ds;
    let turn = 0, peak = i;
    for (let k = i; k <= j; k++) {
      const p = pts[k % n];
      turn += p.curv * ds;
      if (Math.abs(p.curv) > Math.abs(pts[peak % n].curv)) peak = k;
    }
    if (len >= minLen && Math.abs(turn) * 180 / Math.PI >= minTurnDeg) {
      const pk = pts[peak % n];
      runs.push({ s0: pts[i % n].s, s1: pts[j % n].s, sPeak: pk.s, R: 1 / Math.abs(pk.curv),
                  dir: Math.sign(pk.curv), len, turn: Math.abs(turn) * 180 / Math.PI });
    }
    i = j + 1;
  }
  return runs;
}

// ---- bake helpers (ported verbatim from dirtyair/tools/bake.mjs) ------------
const latlon2m = (pts, lat0, lon0) => pts.map(p => ({
  x: (p.lon - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180),
  y: (p.lat - lat0) * 110540,
}));

function projector(center) {
  const n = center.length;
  return function project(x, y) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (center[i].x - x) ** 2 + (center[i].y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const p = center[best];
    const lat = -Math.sin(p.hdg) * (x - p.x) + Math.cos(p.hdg) * (y - p.y);
    return { i: best, s: p.s, d: Math.sqrt(bestD), lat };
  };
}

function applyOver(arr, center, over) {
  if (!over) return;
  for (const [a, b, v] of over) {
    for (const p of center) {
      const s = p.lapS;
      const inRange = a <= b ? (s >= a && s <= b) : (s >= a || s <= b);
      if (inRange) arr[p.idx] = v;
    }
  }
}

function mergeCorners(runs, gap = 40) {
  const out = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && prev.dir === r.dir && r.s0 - prev.s1 < gap) {
      prev.s1 = r.s1;
      if (r.R < prev.R) { prev.R = r.R; prev.sPeak = r.sPeak; }
    } else out.push({ ...r });
  }
  return out;
}

function longestStraights(center, maxCurv = 1 / 500, minLen = 240) {
  const n = center.length, ds = DS;
  const flat = center.map(p => Math.abs(p.curv) < maxCurv);
  const runs = [];
  let i = 0;
  while (i < n) {
    if (!flat[i]) { i++; continue; }
    let j = i;
    while (flat[(j + 1) % n] && j - i < n - 1) j++;
    const L = (j - i + 1) * ds;
    if (L >= minLen) runs.push({ s0: center[i % n].lapS, s1: center[j % n].lapS, len: L });
    i = j + 1;
  }
  // A straight that runs THROUGH s=0 is found twice: the scan wraps the run
  // that starts near the end of the lap round past zero (the `% n` above), and
  // then the scan ALSO began at sample 0, in the middle of that same straight.
  // DIRTY AIR kept both, and at the Nürburgring that put two OVERLAPPING DRS
  // zones on one pit straight (4951->405 and 45->405). Drop the run that began
  // at sample 0 when a wrapped run already covers it.
  const wrapped = runs.find(r => r.s1 < r.s0);
  if (wrapped && flat[0]) {
    const k = runs.findIndex(r => r !== wrapped && r.s0 === center[0].lapS);
    if (k >= 0) runs.splice(k, 1);
  }
  return runs.sort((a, b) => b.len - a.len);
}

// The same sponsor list every other circuit carries.
const SPONSORS = [
  'FOGLAST', 'CRITTERS', 'VROOM', 'XANCOIN', 'TERMINAL TYCOON', 'ORBIX',
  'MOLT', 'OMMOR', 'DEEPWALK', 'INKOGNITO', 'BACKROOMS', 'DOGGO BATTLES',
  'EVERYDEATH', 'CORN', 'RIG 13', 'POND', 'OVERHANG', 'ANT INC',
  'SLIPSTREAM', 'CANON EVENT', 'CARDBOARD WARFARE', 'XANBOO78O STUDIOS',
];

// Stitch pit-lane ways that share end nodes into one polyline. OSM splits a
// lane wherever a tag changes (a bridge, a layer), so the lane is rarely one
// way; the longest CONNECTED chain is the lane.
function chainWays(ways) {
  const key = g => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
  const left = ways.map(w => w.geometry.slice());
  const chains = [];
  while (left.length) {
    let c = left.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        if (key(c[c.length - 1]) === key(w[0])) c = c.concat(w.slice(1));
        else if (key(w[w.length - 1]) === key(c[0])) c = w.concat(c.slice(1));
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    chains.push(c);
  }
  return chains;
}

/**
 * Bake one circuit. `osm` is an array of Overpass way elements WITH geometry.
 * `opt.pitWays` overrides the pit-way selection (DIRTY AIR used name ~ /pit/).
 * Returns the track object exactly as it is written to disk.
 */
export function bakeCircuit(key, meta, spec, osm, opt = {}) {
  const raw = loadRaw(meta.id);
  const { pts: center, length } = resample(spline(raw.pts), DS);
  reflow(center, spec.smooth || 9);
  center.forEach((p, i) => { p.idx = i; });
  const { lat0, lon0 } = raw;
  const project = projector(center);
  const log = [];

  let startOff = spec.startOff;
  if (startOff == null) startOff = 0;
  center.forEach(p => { p.lapS = ((p.s - startOff) % length + length) % length; });
  const byLapS = center.slice().sort((a, b) => a.lapS - b.lapS);

  // ---- corners ---------------------------------------------------------------
  const runs = mergeCorners(findCorners(byLapS.map(p => ({ ...p, s: p.lapS })), ...(spec.corner || [200, 14, 24]).slice(0, 3)), (spec.corner || [0, 0, 0, 40])[3]);
  const corners = runs.map((r, i) => ({ n: i + 1, ...r }));

  const namedWays = osm.filter(e => e.geometry && (e.tags || {}).highway === 'raceway' &&
    ((e.tags['name:en'] || e.tags.name) || e.tags['raceway:corner_number']));
  const tagHits = [];
  for (const w of namedWays) {
    const m = latlon2m(w.geometry, lat0, lon0);
    const ds = m.map(p => project(p.x, p.y));
    const med = ds.map(d => d.d).sort((a, b) => a - b)[Math.floor(ds.length / 2)];
    if (med > 18) continue;             // not this circuit
    const laps = ds.map(d => ((d.s - startOff) % length + length) % length);
    let name = w.tags['name:en'] || w.tags.name || null;
    if (name && spec.notCorner && spec.notCorner.test(name)) name = null;
    tagHits.push({
      name,
      num: w.tags['raceway:corner_number'] ? +w.tags['raceway:corner_number'] : null,
      width: w.tags.width ? +w.tags.width : null,
      bank: /(\d+)\s*graden/.exec(w.tags.description || '') ? +/(\d+)\s*graden/.exec(w.tags.description)[1] : 0,
      s0: Math.min(...laps), s1: Math.max(...laps), mid: laps[Math.floor(laps.length / 2)],
      osm: w.id,
    });
  }
  for (const co of corners) {
    const hit = tagHits.filter(h => h.mid >= co.s0 - 30 && h.mid <= co.s1 + 30 && (h.name || h.num))
      .sort((a, b) => Math.abs(a.mid - co.sPeak) - Math.abs(b.mid - co.sPeak))[0];
    if (hit) { co.name = hit.name; co.num = hit.num; }
  }
  if (spec.namesAt) {
    for (const co of corners) co.name = null;
    for (const [ns, nm] of spec.namesAt) {
      let best = null, bd = 110;
      for (const co of corners) {
        if (co.name) continue;
        let d = Math.abs(ns - co.sPeak); d = Math.min(d, length - d);
        if (d < bd) { bd = d; best = co; }
      }
      if (best) best.name = nm;
    }
  }
  log.push('   OSM raceway ways on this circuit: ' + tagHits.map(h =>
    `${h.name || '(unnamed)'} s${h.s0.toFixed(0)}-${h.s1.toFixed(0)}`).join(', '));

  // ---- per-sample width / banking / runoff -------------------------------------
  const osmW = tagHits.filter(h => h.width).length
    ? tagHits.filter(h => h.width).reduce((a, h) => a + h.width, 0) / tagHits.filter(h => h.width).length / 2
    : null;
  const baseW = osmW || spec.w;
  const W = new Array(center.length).fill(baseW);
  const BANK = new Array(center.length).fill(0);
  const RUN = new Array(center.length).fill(spec.runoff);
  for (const h of tagHits) if (h.bank) {
    for (const p of center) {
      const s = p.lapS;
      if (s >= h.s0 && s <= h.s1) BANK[p.idx] = h.bank;
    }
  }
  applyOver(W, center, spec.wOver);
  applyOver(RUN, center, spec.runoffOver);
  const RUNL = RUN.slice(), RUNR = RUN.slice();
  for (const p of center) {
    const R = 1 / Math.max(Math.abs(p.curv), 1e-6);
    const cap = Math.max(1.5, R * 0.8 - W[p.idx]);
    if (p.curv > 0) RUNL[p.idx] = Math.min(RUNL[p.idx], cap);
    else if (p.curv < 0) RUNR[p.idx] = Math.min(RUNR[p.idx], cap);
  }

  // ---- DRS ---------------------------------------------------------------------
  const sorted = center.slice().sort((a, b) => a.lapS - b.lapS);
  let straights = [];
  for (const minLen of [260, 220, 180, 150, 120, 95]) {
    straights = longestStraights(sorted, 1 / (spec.drsCurv || 500), minLen);
    if (straights.length >= spec.drs) break;
  }
  const drs = spec.drsManual ? spec.drsManual.map(z => ({ ...z, len: +(((z.to - z.from) % length + length) % length).toFixed(0) })) : straights.slice(0, spec.drs).map(st => ({
    from: +(st.s0 + 45).toFixed(0),
    to: +(st.s1 - 55).toFixed(0),
    detect: +(((st.s0 - 130) % length + length) % length).toFixed(0),
    len: +st.len.toFixed(0),
  }));

  // ---- pit lane ----------------------------------------------------------------
  let pit = null;
  const cand = opt.pitWays || osm.filter(e => e.geometry && spec.pitName.test((e.tags || {}).name || ''));
  const pitWays = chainWays(cand)
    .map(g => ({ m: latlon2m(g, lat0, lon0) }))
    .filter(o => project(o.m[0].x, o.m[0].y).d < 260 && project(o.m[o.m.length - 1].x, o.m[o.m.length - 1].y).d < 260);
  if (pitWays.length) {
    const w = pitWays.sort((a, b) => b.m.length - a.m.length)[0];
    let m = w.m;
    const pa = project(m[0].x, m[0].y), pb = project(m[m.length - 1].x, m[m.length - 1].y);
    let aS = ((pa.s - startOff) % length + length) % length;
    let bS = ((pb.s - startOff) % length + length) % length;
    let fwd = bS - aS; while (fwd < 0) fwd += length;
    if (fwd > length / 2) { m = m.slice().reverse(); const t = aS; aS = bS; bS = t; }
    pit = { entryS: +aS.toFixed(0), exitS: +bS.toFixed(0), side: Math.sign(pa.lat) || 1,
            synth: false, pts: m.map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]) };
  } else log.push('   NO pit lane found in OSM — pit: null');
  if (pit) {
    let need = 0;
    for (const [px, py] of pit.pts) need = Math.max(need, Math.abs(project(px, py).lat));
    need = Math.min(40, need + 4.5);
    for (const p of center) {
      const sp = p.lapS;
      const inRange = pit.entryS <= pit.exitS
        ? (sp >= pit.entryS && sp <= pit.exitS)
        : (sp >= pit.entryS || sp <= pit.exitS);
      if (inRange) { const v = Math.max(0, need - W[p.idx]); RUNL[p.idx] = Math.max(RUNL[p.idx], v); RUNR[p.idx] = Math.max(RUNR[p.idx], v); }
    }
  }

  const b = bbox(center);
  const out = {
    key, name: meta.name, full: meta.full, country: spec.country, aiPace: spec.aiPace ?? 0.85,
    length: +length.toFixed(1), ds: DS, wall: spec.wall, crossover: !!spec.crossover,
    bbox: { x0: +b.x0.toFixed(1), y0: +b.y0.toFixed(1), x1: +b.x1.toFixed(1), y1: +b.y1.toFixed(1) },
    x: byLapS.map(p => +p.x.toFixed(2)),
    y: byLapS.map(p => +p.y.toFixed(2)),
    w: byLapS.map(p => +W[p.idx].toFixed(2)),
    bank: byLapS.map(p => BANK[p.idx]),
    runL: byLapS.map(p => +RUNL[p.idx].toFixed(1)),
    runR: byLapS.map(p => +RUNR[p.idx].toFixed(1)),
    line: null,
    corners: corners.map(c => ({ n: c.n, num: c.num || null, name: c.name || null,
      s0: +c.s0.toFixed(0), s1: +c.s1.toFixed(0), s: +c.sPeak.toFixed(0),
      R: +c.R.toFixed(0), dir: c.dir, turn: +c.turn.toFixed(0) })),
    drs, pit,
    sponsors: SPONSORS,
  };
  const tk = new Track(JSON.parse(JSON.stringify(out)));
  const off = racingLine(tk, spec.lineMargin ?? 0.35);
  out.line = Array.from(off, v => +v.toFixed(2));

  log.unshift(`${meta.name.padEnd(12)} ${out.length.toFixed(0)}m (official ${raw.props.length}m)  ${corners.length} corners  ` +
    `w±${baseW.toFixed(1)}m  DRS ${drs.map(d => d.len + 'm').join('+') || 'none'}  pit ${pit ? `${pit.entryS}->${pit.exitS} (${pit.pts.length} pts)` : 'none'}`);
  log.splice(1, 0, '   ' + corners.map(c => `${c.num || c.n}${c.dir > 0 ? 'L' : 'R'}${c.name ? ':' + c.name : ''}`).join(' '));
  return { out, log };
}

// ---- Overpass, politely (same as tools/bakeenv.mjs) --------------------------
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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) {
        const txt = await res.text();
        if (txt.trim().startsWith('{') && JSON.parse(txt).elements?.length) {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, txt);
          return JSON.parse(txt);
        }
        console.log(`    non-JSON or EMPTY body from ${new URL(url).host}, retrying`);
      } else {
        console.log(`    ${res.status} from ${new URL(url).host}, backing off ${wait / 1000}s`);
      }
    } catch (e) {
      console.log(`    ${e.message}, backing off ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 1.6, 60000);
  }
  throw new Error('Overpass would not answer after 6 attempts');
}

// ---- main ----------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  for (const a of args) if (a.startsWith('--') && a !== '--force') { console.error(`unknown flag ${a}`); process.exit(2); }
  const keys = args.filter(a => !a.startsWith('--'));
  if (keys.length !== 1 || !CIRCUITS[keys[0]]) {
    console.error(`usage: node tools/bakereal.mjs <key> [--force]   keys: ${Object.keys(CIRCUITS).join(', ')}`);
    process.exit(2);
  }
  const key = keys[0], meta = CIRCUITS[key], spec = SPEC[key];
  const raw = loadRaw(meta.id);
  let la0 = Infinity, lo0 = Infinity, la1 = -Infinity, lo1 = -Infinity;
  for (const [lo, la] of raw.coords) { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); }
  const pad = 0.003;
  const bb = `${(la0 - pad).toFixed(5)},${(lo0 - pad).toFixed(5)},${(la1 + pad).toFixed(5)},${(lo1 + pad).toFixed(5)}`;
  const q = `[out:json][timeout:120];(way["highway"="raceway"](${bb});way["raceway"="pitlane"](${bb}););out tags geom;`;
  const res = await overpass(q, `${ROOT}data/env/raw/${key}-raceway.json`, args.includes('--force'));
  const { out, log } = bakeCircuit(key, meta, spec, res.elements.filter(e => e.type === 'way'));
  fs.writeFileSync(`${ROOT}data/tracks/${key}.json`, JSON.stringify(out));
  const kb = (fs.statSync(`${ROOT}data/tracks/${key}.json`).size / 1024).toFixed(0);
  console.log(log.join('\n') + `\n   -> data/tracks/${key}.json  ${kb} KB`);
}
