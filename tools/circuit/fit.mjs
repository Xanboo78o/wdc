// fit.mjs — lay the surveyed lap (data/tracks/<key>.json, from OpenStreetMap) onto the modelled circuit's own road.
//
//   node tools/circuit/fit.mjs <key> <grid folder> [--write]
//
// The model (tools/circuit/grid.mjs has rasterised it) is in its author's frame; the survey is in a map
// projection. This finds the turn and the shift (and whether one is the mirror of the other) that puts the
// most of the lap on the model's tarmac, and says how well it fits. Track frame in the model: x = X, y = -Z.
import fs from 'fs';
const [key, dir, ...flags] = process.argv.slice(2);
if (!key || !dir || flags.some(f => f !== '--write')) { console.error('fit: node tools/circuit/fit.mjs <key> <grid folder> [--write]'); process.exit(2); }
const CELL = 0.5, X0 = -1100, Z0 = -1460, W = 4300, H = 5720;
const kind = fs.readFileSync(dir + '/silv-kind.bin');
const hb = fs.readFileSync(dir + '/silv-hgt.bin'), hgt = new Float32Array(hb.buffer, hb.byteOffset, W * H);
const gb = fs.readFileSync(dir + '/silv-gnd.bin'), gnd = new Float32Array(gb.buffer, gb.byteOffset, W * H);
const at = (x, y) => { const i = Math.floor((x - X0) / CELL), j = Math.floor((-y - Z0) / CELL); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
const kindAt = (x, y) => { const q = at(x, y); return q < 0 ? 0 : kind[q]; };
// the survey as it was baked is kept beside the grid the first time, and always read from there: fitting twice changes nothing
const keep = dir + '/osm-track.json';
if (!fs.existsSync(keep)) fs.copyFileSync(`data/tracks/${key}.json`, keep);
const T = JSON.parse(fs.readFileSync(keep, 'utf8'));
const n = T.x.length;
const xf = (p, x, y) => { const ym = y * p.m, c = Math.cos(p.a), s = Math.sin(p.a); return [c * x - s * ym + p.tx, s * x + c * ym + p.ty]; };
const score = (p, step) => { let k = 0; for (let i = 0; i < n; i += step) { const [x, y] = xf(p, T.x[i], T.y[i]); if (kindAt(x, y) === 1) k++; } return k; };
// where the model's road is, roughly: the middle of its tarmac
let sx = 0, sz = 0, sn = 0;
for (let j = 0; j < H; j += 8) for (let i = 0; i < W; i += 8) if (kind[j * W + i] === 1) { sx += X0 + i * CELL; sz += Z0 + j * CELL; sn++; }
const mx = sx / sn, my = -sz / sn;
let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += T.x[i]; cy += T.y[i]; } cx /= n; cy /= n;
let best = null;
for (const m of [1, -1]) for (let deg = 0; deg < 360; deg += 2) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const bx = mx - (c * cx - s * cy * m), by = my - (s * cx + c * cy * m);
  for (let dx = -300; dx <= 300; dx += 20) for (let dy = -300; dy <= 300; dy += 20) {
    const p = { m, a, tx: bx + dx, ty: by + dy }, k = score(p, 16);
    if (!best || k > best.k) best = { ...p, k };
  }
}
// a hill climb sticks on a count that moves in whole samples: sweep a box round the best instead, twice, finer each time
for (const [ra, sa, rt, stp, st] of [[3, 0.1, 16, 1, 8], [0.12, 0.01, 1.2, 0.2, 1]]) {
  const c0 = { ...best };
  for (let da = -ra; da <= ra + 1e-9; da += sa) for (let dx = -rt; dx <= rt + 1e-9; dx += stp) for (let dy = -rt; dy <= rt + 1e-9; dy += stp) {
    // (turning about the lap's own middle, so a change of angle is not also a shift)
    const a = c0.a + da * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cc = Math.cos(c0.a), ss = Math.sin(c0.a);
    const mid = [cc * cx - ss * cy * c0.m + c0.tx, ss * cx + cc * cy * c0.m + c0.ty];
    const p = { m: c0.m, a, tx: mid[0] - (c * cx - s * cy * c0.m) + dx, ty: mid[1] - (s * cx + c * cy * c0.m) + dy }, k = score(p, st);
    if (k > best.k || best.st !== st) best = { ...p, k, st };
  }
}
const on = score(best, 1);
console.log(`fit: ${best.m < 0 ? 'MIRRORED, ' : ''}turned ${(best.a * 180 / Math.PI).toFixed(2)} deg, shifted ${best.tx.toFixed(1)}, ${best.ty.toFixed(1)}: ${on} of ${n} samples on the model's tarmac (${(100 * on / n).toFixed(1)}%)`);
// how far the surveyed centre is from the middle of the model's road, where the road is a plain ribbon (both edges within 13 m)
const P = [], off = [], wid = [];
for (let i = 0; i < n; i++) P.push(xf(best, T.x[i], T.y[i]));
let ribbon = 0, sum2 = 0, worst = 0;
for (let i = 0; i < n; i++) {
  const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;      // left normal
  let L = null, R = null;
  if (kindAt(P[i][0], P[i][1]) === 1) {
    for (let d = 0; d <= 13; d += 0.25) if (kindAt(P[i][0] + nx * d, P[i][1] + ny * d) !== 1) { L = d; break; }
    for (let d = 0; d <= 13; d += 0.25) if (kindAt(P[i][0] - nx * d, P[i][1] - ny * d) !== 1) { R = d; break; }
  }
  if (L !== null && R !== null) { ribbon++; const o = (L - R) / 2; off.push(o); wid.push((L + R) / 2); sum2 += o * o; worst = Math.max(worst, Math.abs(o)); } else { off.push(null); wid.push(null); }
}
const ws = wid.filter(v => v !== null).sort((a, b) => a - b);
console.log(`fit: ${ribbon} samples where the road is a plain ribbon: centre off by ${Math.sqrt(sum2 / Math.max(1, ribbon)).toFixed(2)} m rms, ${worst.toFixed(2)} m at worst; half width median ${ws[ws.length >> 1]?.toFixed(2)} m (10th ${ws[Math.floor(ws.length * 0.1)]?.toFixed(2)}, 90th ${ws[Math.floor(ws.length * 0.9)]?.toFixed(2)})`);
fs.writeFileSync(dir + '/fit.json', JSON.stringify({ ...best, on, n, off, wid }));
// a picture: the model's road, and the fitted lap over it
{
  const S = 4, w2 = Math.floor(W / S), h2 = Math.floor(H / S), img = Buffer.alloc(w2 * h2 * 3, 16);
  for (let j = 0; j < h2; j++) for (let i = 0; i < w2; i++) { const k = kind[j * S * W + i * S]; const c = k === 1 ? [150, 150, 150] : k === 3 ? [200, 170, 0] : k === 2 ? [200, 60, 60] : k === 4 ? [30, 70, 30] : [16, 16, 16]; img.set(c, (j * w2 + i) * 3); }
  for (let i = 0; i < n; i++) { const px = Math.floor((P[i][0] - X0) / CELL / S), py = Math.floor((-P[i][1] - Z0) / CELL / S); if (px >= 0 && py >= 0 && px < w2 && py < h2) img.set(i < 40 ? [0, 255, 255] : [255, 0, 255], (py * w2 + px) * 3); }
  fs.writeFileSync(dir + '/fit.ppm', Buffer.concat([Buffer.from(`P6 ${w2} ${h2} 255\n`), img]));
}

if (flags.includes('--write')) {
  // ---- the lap, in the model's frame, on the model's road -----------------------------------------
  // Where the road is a plain 15 m ribbon the survey is pulled onto its middle (the correction smoothed over
  // 50 m, never more than 4 m); beside a tarmac run-off, where the model has no edge to measure, the nearest good
  // corrections carry across.
  const good = off.map((o, i) => o !== null && Math.abs(wid[i] - 7.5) < 1.3 ? Math.max(-4, Math.min(4, o)) : null);
  let corr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    let sw = 0, sv = 0;
    for (let d = -100; d <= 100; d++) { const v = good[(i + d + n) % n]; if (v === null) continue; const w = Math.exp(-d * d / (2 * 20 * 20)); sw += w; sv += w * v; }
    if (sw > 0.5) corr[i] = sv / sw;
  }
  // where nothing nearby could be measured, run straight from the last good correction to the next; then smooth the
  // whole of it once more, so the centreline never steps sideways (a step is a kink, and the gate fails a kink)
  for (let i = 0; i < n; i++) if (corr[i] === null) {
    let a = 1, b = 1; while (a < n && corr[(i - a + n) % n] === null) a++; while (b < n && corr[(i + b) % n] === null) b++;
    const va = corr[(i - a + n) % n] ?? 0, vb = corr[(i + b) % n] ?? 0; good[i] = va + (vb - va) * a / (a + b);
  } else good[i] = corr[i];
  corr = good.map((_, i) => { let sw = 0, sv = 0; for (let d = -40; d <= 40; d++) { const w = Math.exp(-d * d / (2 * 12 * 12)); sw += w; sv += w * good[(i + d + n) % n]; } return sv / sw; });
  const X = [], Y = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
    X.push(+(P[i][0] + nx * corr[i]).toFixed(2)); Y.push(+(P[i][1] + ny * corr[i]).toFixed(2));
  }
  // the walls: from the edge of the road outward along the normal to the first barrier the model has
  const runL = [], runR = [], hS = [];
  let noWall = 0;
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n, l = Math.hypot(X[b] - X[a], Y[b] - Y[a]), nx = -(Y[b] - Y[a]) / l, ny = (X[b] - X[a]) / l;
    const reach = sgn => { for (let d = T.w[i] + 0.5; d <= T.w[i] + 60; d += 0.25) if (kindAt(X[i] + sgn * nx * d, Y[i] + sgn * ny * d) === 3) return Math.max(1, d - T.w[i] - 0.4); noWall++; return 30; };
    runL.push(+reach(1).toFixed(1)); runR.push(+reach(-1).toFixed(1));
    const q = at(X[i], Y[i]); let h = q >= 0 ? hgt[q] : NaN; if (!(h === h) && q >= 0) h = gnd[q];
    hS.push(h === h ? h : null);
  }
  for (let i = 0; i < n; i++) if (hS[i] === null) { let k = 1; while (k < n && hS[(i + k) % n] === null) k++; hS[i] = hS[(i + k) % n] ?? 0; }
  // (a wall cannot jump: no sample's run-off more than 1.5 m wider than its neighbour's, as the survey bakes have it)
  for (const R of [runL, runR]) for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < n; i++) R[i] = Math.min(R[i], R[(i - 1 + n) % n] + 1.5); for (let i = n - 1; i >= 0; i--) R[i] = Math.min(R[i], R[(i + 1) % n] + 1.5); }
  const out = { ...T, x: X, y: Y, runL: runL.map(v => +v.toFixed(1)), runR: runR.map(v => +v.toFixed(1)) };
  out.geo = { ...T.geo, note: `moved into the frame of the modelled circuit (data/cars/${key}): turned ${(best.a * 180 / Math.PI).toFixed(2)} deg, shifted ${best.tx.toFixed(1)}, ${best.ty.toFixed(1)} m; the projection origin no longer applies` };
  out.bbox = { x0: Math.min(...X), y0: Math.min(...Y), x1: Math.max(...X), y1: Math.max(...Y) };
  if (T.pit && T.pit.pts) out.pit = { ...T.pit, pts: T.pit.pts.map(q => { const r = xf(best, q[0], q[1]); return [+r[0].toFixed(2), +r[1].toFixed(2), ...q.slice(2)]; }) };
  fs.writeFileSync(`data/tracks/${key}.json`, JSON.stringify(out));
  // ---- its heights: the model's own road under every sample, and the model's ground round it -----------
  const E = JSON.parse(fs.readFileSync(`data/elev/${key}.json`, 'utf8'));
  const N = 96, pad = 500, gx0 = out.bbox.x0 - pad, gy0 = out.bbox.y0 - pad, gdx = (out.bbox.x1 - out.bbox.x0 + 2 * pad) / (N - 1), gdy = (out.bbox.y1 - out.bbox.y0 + 2 * pad) / (N - 1);
  const mean = hS.reduce((a, b) => a + b, 0) / n, gh = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = at(gx0 + i * gdx, gy0 + j * gdy); const h = q >= 0 ? gnd[q] : NaN; gh.push(h === h ? +h.toFixed(2) : +mean.toFixed(2)); }
  const elev = { key, dataset: 'model', source: `the modelled circuit's own surfaces (data/cars/${key}), by tools/circuit/fit.mjs`, licence: 'see the model\'s LICENSE.txt',
    note: 'metres in the model\'s own frame (not relative to a mean): the model is drawn where its file put it', mean: 0, range: [+Math.min(...hS).toFixed(3), +Math.max(...hS).toFixed(3)], ds: E.ds,
    s: hS.map(v => +v.toFixed(3)), grid: { x0: +gx0.toFixed(2), y0: +gy0.toFixed(2), dx: +gdx.toFixed(3), dy: +gdy.toFixed(3), n: N, h: gh }, outside: 'plane', sea: null, bridges: [], plane: [+mean.toFixed(3), 0, 0] };
  fs.writeFileSync(`data/elev/${key}.json`, JSON.stringify(elev));
  // ---- nothing of the surveyed town is drawn: the model has its own
  const V = JSON.parse(fs.readFileSync(`data/env/${key}.json`, 'utf8'));
  fs.writeFileSync(`data/env/${key}.json`, JSON.stringify({ ...V, bbox: out.bbox, buildings: [], areas: [], sea: [], trees: [], note: 'emptied by tools/circuit/fit.mjs: the modelled circuit brings its own buildings and trees' }));
  const rs = [...runL, ...runR].sort((a, b) => a - b);
  console.log(`wrote data/tracks/${key}.json, data/elev/${key}.json, data/env/${key}.json`);
  console.log(`  centre moved by up to ${Math.max(...corr.map(Math.abs)).toFixed(2)} m; road height ${Math.min(...hS).toFixed(1)} to ${Math.max(...hS).toFixed(1)} m; run-off to the model's barriers ${rs[0]} to ${rs[rs.length - 1]} m (median ${rs[rs.length >> 1]}), ${noWall} sides with no barrier within 60 m (given 30 m)`);
}
