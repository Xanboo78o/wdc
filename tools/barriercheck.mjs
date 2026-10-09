// barriercheck.mjs — is the rail where the wall is?
//
//   node tools/barriercheck.mjs <key> [--at S] [--span M] [--png FILE]
//
// The physics has no barrier object. Its wall is a rule (js/collide.js): a
// corner of the car is in the wall when it is further from the nearest point
// of the centreline than that point's half-width plus its run-off. The native
// game then DRAWS a rail along the run-off's edge, sample by sample
// (native/src/render.cpp, props.cpp). Those are two descriptions of one thing
// and they can disagree: this prints where, and with --png draws it from above
// (open ground white, wall grey, rail red, centreline blue).
//
// Every rail point should sit ON the rule's boundary. Reported per point:
//   INSIDE  the rail stands on ground the rule calls open (you can drive through it)
//   BEHIND  the rail stands more than a metre inside the wall (you stop in thin air before it)
import fs from 'fs';
import { execFileSync } from 'child_process';
import { Track } from '../js/track.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
let key = null, at = null, span = 260, png = null;
for (let k = 0; k < args.length; k++) {
  if (args[k] === '--at') at = +args[++k];
  else if (args[k] === '--span') span = +args[++k];
  else if (args[k] === '--png') png = args[++k];
  else if (args[k].startsWith('--')) { console.error('barriercheck: unknown flag ' + args[k]); process.exit(2); }
  else if (key == null) key = args[k];
  else { console.error('barriercheck: stray argument ' + args[k]); process.exit(2); }
}
if (!key) { console.error('usage: node tools/barriercheck.mjs <key> [--at S] [--span M] [--png FILE]'); process.exit(2); }
const t = new Track(JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8')));
const n = t.n;

// the rule: how deep in the wall a point is (negative = open ground)
const depth = (x, y, hint) => { const p = hint == null ? t.project(x, y) : t.project(x, y, hint, 110); return Math.abs(p.lat) - (p.w + p.run); };

// the rail, as render.cpp lays it: collide.cpp wallFeet says which samples have a wall at all
const wallFeet = side => {
  const probe = (i, behind, wide) => {
    const lat = side * (t.w[i] + Math.max(0.05, side > 0 ? t.runL[i] : t.runR[i]) + behind), h = t.hdg[i];
    const x = t.x[i] - Math.sin(h) * lat, y = t.y[i] + Math.cos(h) * lat;
    const p = wide ? t.project(x, y) : t.project(x, y, i, 110);
    let d = Math.abs(p.i - i); d = Math.min(d, n - d);
    return { wall: Math.abs(p.lat) - (p.w + p.run) > 0, foreign: d > 80 };
  };
  const real = [], deep = [];
  for (let i = 0; i < n; i++) {
    real[i] = probe(i, 0.6, false).wall; deep[i] = false;
    if (real[i]) { const q = probe(i, 2.0, true); real[i] = q.wall || q.foreign; }
    if (real[i]) { const q = probe(i, 4.0, true); deep[i] = q.wall || q.foreign; }
  }
  for (let i = 0; i < n;) {
    if (!real[i]) { i++; continue; }
    let j = i, anyDeep = false;
    while (j < n && real[j]) { anyDeep = anyDeep || deep[j]; j++; }
    const wraps = !t.open && (i === 0 || j === n) && real[0] && real[n - 1];
    if ((j - i < 12 || (j - i < 60 && !anyDeep)) && !wraps) for (let k = i; k < j; k++) real[k] = false;
    i = j;
  }
  return real;
};
const rails = [], REAL = {};
for (const side of [1, -1]) {
  const real = REAL[side] = wallFeet(side), pts = [];
  const latOf = i => side * (t.w[i] + Math.max(0.05, side > 0 ? t.runL[i] : t.runR[i]));
  const at2 = (i, l) => ({ x: t.x[i] - Math.sin(t.hdg[i]) * l, y: t.y[i] + Math.cos(t.hdg[i]) * l });
  let last = -2;
  for (let i = 0; i < n; i++) {
    if (!real[i]) continue;
    const lat = latOf(i);
    if (last === i - 1 && Math.abs(lat - latOf(last)) > 6) {
      const lp = latOf(last), a0 = at2(last, lp), a1 = at2(i, lp), b0 = at2(last, lat), b1 = at2(i, lat);
      pts.push({ i: last, x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 });
      pts.push({ i, x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 });
    }
    pts.push({ i, ...at2(i, lat), gap: last >= 0 && last !== i - 1 });      // gap: the wall stopped before this foot; no rail joins them
    last = i;
  }
  if (pts.length && !real[n - 1]) pts[0].gap = true; else if (pts.length && !real[0]) pts[0].gap = true;
  rails.push({ side, pts });
}
// the game's wall: the rule, minus the samples wallFeet calls open
const gameDepth = (x, y, hint) => { const p = hint == null ? t.project(x, y) : t.project(x, y, hint, 110); return REAL[p.lat > 0 ? 1 : -1][p.i] ? Math.abs(p.lat) - (p.w + p.run) : -99; };

let inside = 0, behind = 0, checked = 0;
const worst = [];
for (const r of rails) for (let k = 0; k < r.pts.length; k++) {
  const a = r.pts[k], b = r.pts[(k + 1) % r.pts.length];
  // along the rail between two feet, every half metre
  const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len / 0.5));
  if (len > 400 || b.gap) continue;              // an open circuit's two ends; a stretch with no wall
  for (let q = 0; q < steps; q++) {
    const f = q / steps, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
    const d = gameDepth(x, y, a.i);
    checked++;
    if (d < -1.0) { inside++; worst.push({ d, s: a.i * t.ds, side: r.side, kind: 'INSIDE' }); }
    else if (d > 1.0) { behind++; worst.push({ d, s: a.i * t.ds, side: r.side, kind: 'BEHIND' }); }
  }
}
console.log(`${key}: ${checked} rail points; ${inside} stand on open ground (${(inside * 0.5).toFixed(0)} m), ${behind} stand >1 m inside the wall (${(behind * 0.5).toFixed(0)} m)`);
const groups = new Map();
for (const w of worst) { const g = `${w.kind} ${w.side > 0 ? 'left ' : 'right'} s≈${Math.round(w.s / 20) * 20}`; const o = groups.get(g) || { n: 0, d: 0 }; o.n++; if (Math.abs(w.d) > Math.abs(o.d)) o.d = w.d; groups.set(g, o); }
for (const [g, o] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 14)) console.log(`  ${g.padEnd(24)} ${(o.n * 0.5).toFixed(1).padStart(6)} m, worst ${o.d.toFixed(1)} m`);

if (png) {
  const i0 = t.idx(at ?? 0), cx = t.x[i0], cy = t.y[i0], PX = 900, m = span / PX;
  const img = Buffer.alloc(PX * PX * 3, 255);
  const put = (x, y, c) => { const u = Math.round((x - cx) / m + PX / 2), v = Math.round(PX / 2 - (y - cy) / m); if (u >= 0 && v >= 0 && u < PX && v < PX) { img[(v * PX + u) * 3] = c[0]; img[(v * PX + u) * 3 + 1] = c[1]; img[(v * PX + u) * 3 + 2] = c[2]; } };
  for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) {
    const x = cx + (u - PX / 2) * m, y = cy - (v - PX / 2) * m, p = t.project(x, y);
    const d = REAL[p.lat > 0 ? 1 : -1][p.i] ? Math.abs(p.lat) - (p.w + p.run) : -99;
    const c = d > 0 ? [150, 150, 150] : Math.abs(p.lat) < p.w ? [235, 235, 235] : [255, 255, 255];
    img[(v * PX + u) * 3] = c[0]; img[(v * PX + u) * 3 + 1] = c[1]; img[(v * PX + u) * 3 + 2] = c[2];
  }
  for (let i = 0; i < n; i++) put(t.x[i], t.y[i], [40, 80, 220]);
  for (const r of rails) for (let k = 0; k < r.pts.length; k++) {
    const a = r.pts[k], b = r.pts[(k + 1) % r.pts.length], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 400 || b.gap) continue;
    for (let q = 0; q <= len / (m * 0.5); q++) { const f = q / Math.max(1, len / (m * 0.5)); for (const [ox, oy] of [[0, 0], [m, 0], [0, m]]) put(a.x + (b.x - a.x) * f + ox, a.y + (b.y - a.y) * f + oy, [220, 30, 30]); }
  }
  // the foam blocks of data/knock/<key>.json, in green: are they where you meant, and on open ground?
  let kd = null;
  try { kd = JSON.parse(fs.readFileSync(`${ROOT}data/knock/${key}.json`, 'utf8')); } catch { /* none */ }
  for (const grp of kd?.foam || []) {
    const i = t.idx(grp.s), h = grp.hdg != null ? grp.hdg * Math.PI / 180 : t.hdg[i];
    for (const row of grp.rows) for (const ac of row.across) {
      const bx = t.x[i] + Math.cos(h) * row.ahead - Math.sin(h) * ac, by = t.y[i] + Math.sin(h) * row.ahead + Math.cos(h) * ac;
      const pj = t.project(bx, by), on = Math.abs(pj.lat) < pj.w + 1.2, wall = gameDepth(bx, by) > 0;
      if (on || wall) console.log(`  FOAM at s=${grp.s} ahead ${row.ahead} across ${ac}: ${on ? 'ON THE ROAD' : 'IN THE WALL'}`);
      for (let q = -0.95; q <= 0.95; q += m * 0.5) for (let r = -0.25; r <= 0.25; r += m * 0.5)
        put(bx - Math.sin(h) * q + Math.cos(h) * r, by + Math.cos(h) * q + Math.sin(h) * r, wall || on ? [255, 0, 255] : [0, 150, 40]);
    }
  }
  const ppm = png.replace(/\.png$/, '.ppm');
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${PX} ${PX}\n255\n`), img]));
  execFileSync('magick', [ppm, png]); fs.rmSync(ppm);
  console.log(`  drew ${span} m round s=${at ?? 0} into ${png}`);
}
