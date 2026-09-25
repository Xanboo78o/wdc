// importtrack.mjs — a circuit modelled outside this project, read in as a track
// this game can measure and drive.
//
//   node tools/importtrack.mjs <file.glb|file.obj> --key myTrack --name "My Track"
//   node tools/importtrack.mjs <file.obj> --group track --run 12
//   node tools/importtrack.mjs <file.obj> --list          what groups are in it
//   node tools/importtrack.mjs <file.glb> --out -         measure, write nothing
//   node tools/importtrack.mjs <file.obj> --scale 2 --width 22   plan x2, road 22 m wide
//
// WHAT IT EXPECTS: a ROAD RIBBON — a strip of quads two vertices wide, the way
// a bevelled curve, a solidified plane, or a track generator's road surface
// comes out. The road IS the model, so nothing has to be guessed.
//
// It verifies rather than assumes, and refuses rather than mangles:
//   - vertices must pair into cross-sections of a sane, consistent width
//   - an .obj group must use a contiguous block of vertices
//
// COORDINATES. Both formats here are Y-up with -Z forward; this project is X/Y
// in plan with height on its own axis (js/build/meshes.js: V(x,y,h) ->
// (x, h, -y)). So  x = X,  y = -Z,  height = Y. Get it backwards and the track
// renders MIRRORED — which does not look like a bug, it looks like a track,
// and then the steering feels inverted (DESIGN.md gotcha 6). `--mirror` flips
// it if a plan view ever comes out as somebody's reflection.
//
// WHAT IT TAKES FROM AN .OBJ BEYOND THE ROAD. A generated circuit carries more
// than a ribbon, and throwing it away would be the corner-cutting version:
//   - run-off groups give the real distance to the edge of the run-off, per
//     sample and per side. Where a track has none, it has a wall there, which
//     for a street circuit is most of the lap.
//   - corners are derived from curvature, because the game reads
//     `track.corners.length` to size a driver's mistake ladder and would
//     otherwise use a default of 24 for every imported circuit alike.
// It does NOT invent a pit lane. `pit: null` is honest and the game handles it.
import fs from 'fs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--key', '--name', '--out', '--ds', '--run', '--group', '--list', '--mirror', '--scale', '--width', '--help']);
let file = null, key = null, name = null, out = null, DS = 2, RUN = 12, group = null, list = false, mirror = false, SCALE = 1, WIDTH = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (!KNOWN.has(a)) { console.error(`importtrack: unknown flag ${a}`); process.exit(2); }
    if (a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 37).join('\n')); process.exit(0); }
    else if (a === '--key') key = argv[++i];
    else if (a === '--name') name = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a === '--ds') DS = +argv[++i];
    else if (a === '--run') RUN = +argv[++i];
    else if (a === '--group') group = argv[++i];
    else if (a === '--list') list = true;
    else if (a === '--mirror') mirror = true;
    else if (a === '--scale') SCALE = +argv[++i];
    else if (a === '--width') WIDTH = +argv[++i];
  } else if (!file) file = a;
  else { console.error('importtrack: more than one file given'); process.exit(2); }
}
if (!file) { console.error('importtrack: no model given'); process.exit(2); }
if (!(SCALE > 0) || (WIDTH !== null && !(WIDTH > 0))) { console.error('importtrack: --scale and --width need a positive number'); process.exit(2); }

// ---------------------------------------------------------------------------
// readers — each returns { verts: [[x,y,z]...], groups: Map(name -> [i0, i1]) }
// ---------------------------------------------------------------------------
function readGLB(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('importtrack: not a .glb'); process.exit(2); }
  let off = 12, gltf = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) gltf = JSON.parse(body.toString('utf8'));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  const COMP = { 5120: ['readInt8', 1], 5121: ['readUInt8', 1], 5122: ['readInt16LE', 2], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4] };
  const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const meshes = gltf.meshes || [];
  if (meshes.length !== 1 || meshes[0].primitives.length !== 1) {
    console.error(`importtrack: expected one mesh with one primitive, found ${meshes.length}`);
    process.exit(2);
  }
  const a = gltf.accessors[meshes[0].primitives[0].attributes.POSITION];
  const bv = gltf.bufferViews[a.bufferView];
  const [fn, size] = COMP[a.componentType], nc = NUM[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || size * nc;
  const verts = [];
  for (let k = 0; k < a.count; k++) {
    const o = start + k * stride;
    verts.push([bin[fn](o), bin[fn](o + size), bin[fn](o + 2 * size)]);
  }
  return { verts, groups: new Map([['mesh', [0, verts.length - 1]]]) };
}

function readOBJ(path) {
  const verts = [], used = new Map();
  let cur = null;
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    if (raw.startsWith('v ')) {
      const p = raw.split(/\s+/);
      verts.push([+p[1], +p[2], +p[3]]);
    } else if (raw.startsWith('g ') || raw.startsWith('o ')) {
      cur = raw.slice(2).trim();
      if (!used.has(cur)) used.set(cur, [Infinity, -Infinity]);
    } else if (raw.startsWith('f ') && cur) {
      const r = used.get(cur);
      for (const tok of raw.trim().split(/\s+/).slice(1)) {
        let i = parseInt(tok.split('/')[0], 10);
        if (i < 0) i = verts.length + i; else i -= 1;
        if (i < r[0]) r[0] = i;
        if (i > r[1]) r[1] = i;
      }
    }
  }
  for (const [k, v] of [...used]) if (v[1] < v[0]) used.delete(k);
  return { verts, groups: used };
}

const model = /\.obj$/i.test(file) ? readOBJ(file) : readGLB(file);

if (list) {
  console.log(`${file} — ${model.verts.length} vertices, ${model.groups.size} group(s)`);
  for (const [g, [a, b]] of model.groups) console.log(`   ${g.padEnd(32)} vertices ${a}..${b}  (${b - a + 1})`);
  process.exit(0);
}

// Which group is the ROAD. `track` by name if it is there — every generator
// this has met calls it that — otherwise the one with the most vertices, which
// on a bare export is the only one.
let roadName = group;
if (!roadName) {
  if (model.groups.has('track')) roadName = 'track';
  else roadName = [...model.groups].sort((a, b) => (b[1][1] - b[1][0]) - (a[1][1] - a[1][0]))[0][0];
}
if (!model.groups.has(roadName)) {
  console.error(`importtrack: no group "${roadName}". Run with --list to see what is in the file.`);
  process.exit(2);
}
const [r0, r1] = model.groups.get(roadName);
const P = model.verts.slice(r0, r1 + 1);

// --- the ribbon -------------------------------------------------------------
if (P.length % 2) { console.error('importtrack: odd vertex count — this is not a two-wide ribbon'); process.exit(2); }
const pairs = P.length / 2;
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const widths = [];
for (let k = 0; k < pairs; k++) widths.push(d3(P[2 * k], P[2 * k + 1]));
const wMean = widths.reduce((a, b) => a + b, 0) / pairs;
const wMin = Math.min(...widths), wMax = Math.max(...widths);
if (wMax > wMean * 6 || wMin <= 0.01) {
  console.error(`importtrack: vertices do not pair into cross-sections (width ${wMin.toFixed(2)}..${wMax.toFixed(2)} m, mean ${wMean.toFixed(2)})`);
  process.exit(2);
}

const SIDE = mirror ? -1 : 1;
const raw = [];
for (let k = 0; k < pairs; k++) {
  const a = P[2 * k], b = P[2 * k + 1];
  // --scale multiplies the PLAN only: a bigger circuit on the same hills, so
  // the gradients ease rather than every climb doubling in height.
  raw.push({ x: SCALE * (a[0] + b[0]) / 2, y: SCALE * SIDE * -(a[2] + b[2]) / 2, z: (a[1] + b[1]) / 2, w: SCALE * widths[k] });
}

// A generator often repeats a cross-section at every segment join — this file
// does, every 31 — so coincident sections are normal and arc-length
// resampling absorbs them. A CLOSED loop may also repeat its first section as
// its last; drop that, or the closure test sees a gap of zero and bridges a
// section onto itself.
const eq = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
while (raw.length > 2 && eq(raw[0], raw[raw.length - 1])) raw.pop();

const gap = Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].y - raw[raw.length - 1].y);
let step0 = 0;
for (let i = 1; i < Math.min(raw.length, 40); i++) step0 = Math.max(step0, Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y));
const closed = gap < Math.max(25, step0 * 4);

// --- resample to this project's spacing -------------------------------------
const pts = closed ? [...raw, raw[0]] : raw;
const cum = [0];
for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
const total = cum[cum.length - 1];
const n = Math.max(8, Math.round(total / DS));
const X = [], Y = [], Z = [], W = [];
let seek = 1;
for (let i = 0; i < n; i++) {
  const s = i * (total / n);
  while (seek < cum.length - 1 && cum[seek] < s) seek++;
  const a = pts[seek - 1], b = pts[seek];
  const span = cum[seek] - cum[seek - 1];
  const t = span > 1e-9 ? (s - cum[seek - 1]) / span : 0;
  X.push(a.x + (b.x - a.x) * t);
  Y.push(a.y + (b.y - a.y) * t);
  Z.push(a.z + (b.z - a.z) * t);
  W.push(a.w + (b.w - a.w) * t);
}
// `w` in a track file is the HALF width — every consumer reads the road as
// running from -w to +w. Checked against the surveyed circuits rather than
// assumed: Monza 5.75, Monaco 4.60, Suzuka 6.00.
const half = W.map(w => w / 2);

// --- headings, needed by everything below -----------------------------------
const hdg = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const a = (i - 1 + n) % n, b = (i + 1) % n;
  hdg[i] = Math.atan2(Y[b] - Y[a], X[b] - X[a]);
}
const curv = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const a = (i - 1 + n) % n, b = (i + 1) % n;
  let d = hdg[b] - hdg[a];
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  curv[i] = d / (2 * DS);
}

// --- run-off, from the model where the model has it -------------------------
// Every vertex of every run-off group is projected onto the centreline and
// recorded as "at this sample, on this side, the ground reaches this far out".
// Nothing is interpolated ACROSS a gap: where a circuit has no run-off group
// it has a wall, which on a street circuit is most of the lap, and inventing
// twelve metres of gravel there would be inventing a different track.
const runL = new Array(n).fill(RUN), runR = new Array(n).fill(RUN);
let runFrom = 'the --run default';
const runGroups = [...model.groups].filter(([g]) => /runoff|run_off|gravel|verge|asphalt_runoff/i.test(g));
if (runGroups.length) {
  runL.fill(0); runR.fill(0);
  for (const [, [a, b]] of runGroups) {
    for (let v = a; v <= b; v++) {
      const p = model.verts[v];
      const px = SCALE * p[0], py = SCALE * SIDE * -p[2];
      // nearest sample, brute force: a few thousand points against a few
      // thousand samples is nothing next to being wrong about which corner
      // a piece of gravel belongs to.
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dd = (X[i] - px) ** 2 + (Y[i] - py) ** 2;
        if (dd < bd) { bd = dd; best = i; }
      }
      const h = hdg[best];
      const lat = -Math.sin(h) * (px - X[best]) + Math.cos(h) * (py - Y[best]);
      const reach = Math.abs(lat) - half[best];
      if (reach <= 0) continue;
      if (lat > 0) runL[best] = Math.max(runL[best], reach);
      else runR[best] = Math.max(runR[best], reach);
    }
  }
  // A run-off patch is sampled at its own resolution, not ours, so it leaves
  // holes between its vertices. Spread each reading over the gap to the next
  // one on the same side, then floor the whole lap at a metre of verge.
  for (const arr of [runL, runR]) {
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < n; i++) {
        const a = arr[(i - 1 + n) % n], b = arr[(i + 1) % n];
        if (arr[i] < Math.min(a, b)) arr[i] = Math.min(a, b);
      }
    for (let i = 0; i < n; i++) arr[i] = Math.max(1, +arr[i].toFixed(2));
  }
  runFrom = `${runGroups.length} run-off group(s) in the model`;
}

// --- --width: the road made wider than the model drew it ------------------
// Run-off above was measured from the MODEL's kerb and stays as a distance
// beyond the kerb, so it moves out with the new edge.
if (WIDTH) half.fill(WIDTH / 2);

// --- corners, derived ------------------------------------------------------
// The game reads track.corners.length to size a driver's mistake ladder, and
// falls back to 24 for anything without them — so every imported circuit would
// otherwise be treated as having the same number of places to go wrong.
// Same definition tools/character.mjs uses: a run of curvature tighter than
// 400 m, runs closer than 30 m apart joined.
const corners = [];
{
  const kMin = 1 / 400, MERGE = 30;
  let run = null;
  for (let i = 0; i < n; i++) {
    const k = curv[i], turning = Math.abs(k) >= kMin, dir = Math.sign(k);
    if (turning && run && run.dir === dir) run.to = i;
    else if (turning) { if (run) corners.push(run); run = { from: i, to: i, dir }; }
    else if (run && (i - run.to) * DS > MERGE) { corners.push(run); run = null; }
  }
  if (run) corners.push(run);
  for (let c = 0; c < corners.length; c++) {
    const r = corners[c];
    let turn = 0, kMax = 0;
    for (let i = r.from; i <= r.to; i++) { turn += Math.abs(curv[i]) * DS; kMax = Math.max(kMax, Math.abs(curv[i])); }
    corners[c] = {
      n: c + 1, num: c + 1, name: `Turn ${c + 1}`,
      s0: r.from * DS, s1: r.to * DS, s: Math.round((r.from + r.to) / 2) * DS,
      R: Math.round(1 / (kMax || 1e-6)), dir: r.dir, turn: Math.round(turn * 180 / Math.PI),
    };
  }
}

const track = {
  key: key || 'imported', name: name || key || 'Imported',
  full: name || key || 'Imported', country: '', aiPace: 0.8,
  length: n * DS, ds: DS, wall: 'armco', crossover: false,
  bbox: { x0: Math.min(...X), x1: Math.max(...X), y0: Math.min(...Y), y1: Math.max(...Y) },
  x: X.map(v => +v.toFixed(3)), y: Y.map(v => +v.toFixed(3)),
  // Height is carried because a hand-modelled circuit HAS it and dropping it
  // would throw away the reason for modelling one. physics.js is planar, so
  // today this is the renderer's to use — and the renderer does not yet.
  z: Z.map(v => +v.toFixed(3)),
  w: half.map(v => +v.toFixed(3)),
  bank: new Array(n).fill(0),
  runL, runR,
  line: new Array(n).fill(0), corners, drs: [], pit: null, sponsors: [],
};

// --- does the road run into itself? -----------------------------------------
// A circuit folds back on itself constantly, and at the width a default bevel
// hands you the two legs can be the SAME TARMAC without the author ever seeing
// it. Reported in metres of lap rather than as a flag, because the number is
// the actionable thing: it says how much narrower the road wants to be.
let overlap = 0, tightest = Infinity, tightAt = 0;
const SKIP = Math.ceil(80 / DS);
for (let i = 0; i < n; i++) {
  let bd = Infinity, bj = -1;
  for (let j = 0; j < n; j++) {
    if (Math.min(Math.abs(i - j), n - Math.abs(i - j)) < SKIP) continue;
    const dd = (X[i] - X[j]) ** 2 + (Y[i] - Y[j]) ** 2;
    if (dd < bd) { bd = dd; bj = j; }
  }
  bd = Math.sqrt(bd);
  if (bd < half[i] + half[bj]) overlap += DS;
  if (bd < tightest) { tightest = bd; tightAt = i * DS; }
}
track.crossover = overlap > 0;

// --- what it is -------------------------------------------------------------
const zMin = Math.min(...Z), zMax = Math.max(...Z);
let climb = 0;
for (let i = 1; i < n; i++) if (Z[i] > Z[i - 1]) climb += Z[i] - Z[i - 1];
const grades = [];
for (let i = 0; i < n; i++) grades.push(Math.abs(Z[(i + 1) % n] - Z[i]) / DS * 100);
grades.sort((a, b) => a - b);
const slow = corners.filter(c => c.R < 90).length;
console.log(`${file}`);
console.log(`  road group    "${roadName}"  —  ${pairs} cross-sections, ${(total / pairs).toFixed(2)} m apart`);
console.log(`  loop          ${closed ? `CLOSED (ends ${gap.toFixed(2)} m apart)` : `OPEN (ends ${gap.toFixed(0)} m apart — point to point)`}`);
console.log(`  length        ${(total / 1000).toFixed(3)} km, resampled to ${n} samples at ${DS} m`);
console.log(`  road width    ${wMin.toFixed(1)}..${wMax.toFixed(1)} m, mean ${wMean.toFixed(1)}   (Monza 11.5, Monaco 9.2)`);
console.log(`  run-off       ${runFrom}: ${Math.min(...runL, ...runR).toFixed(1)}..${Math.max(...runL, ...runR).toFixed(1)} m beyond the kerb`);
console.log(`  corners       ${corners.length} derived (${slow} tighter than R90)`);
console.log(`  elevation     ${zMin.toFixed(1)} .. ${zMax.toFixed(1)} m  (range ${(zMax - zMin).toFixed(1)}, ${climb.toFixed(0)} m climbed a lap)`);
console.log(`  gradient      median ${grades[n >> 1].toFixed(2)}%, steepest ${grades[n - 1].toFixed(1)}%   (Eau Rouge is 17%)`);
console.log(`  footprint     ${(track.bbox.x1 - track.bbox.x0).toFixed(0)} x ${(track.bbox.y1 - track.bbox.y0).toFixed(0)} m`);
if (overlap > 0) {
  console.log(`  SELF-OVERLAP  ${overlap} m of lap where the road lies on another part of itself`);
  console.log(`                closest centrelines ${tightest.toFixed(1)} m apart, at s=${tightAt.toFixed(0)} m`);
} else {
  console.log(`  self-overlap  none — closest approach ${tightest.toFixed(1)} m at s=${tightAt.toFixed(0)}`);
}

if (out === '-') process.exit(0);
const dest = out || new URL(`../data/tracks/${track.key}.json`, import.meta.url).pathname;
fs.writeFileSync(dest, JSON.stringify(track));
console.log(`  written       ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);

// ---------------------------------------------------------------------------
// THE ELEVATION FILE — which is what actually makes the hills exist.
//
// The game has carried height since data/elev/<key>.json existed, and nothing
// in it needed changing for this: js/world.js already blends a per-sample
// profile along the racing line (`s`) with a grid of the land around it
// (`grid`), and `lift()` displaces any finished geometry by the field under
// it. A modelled circuit already HAS the per-sample profile — that is what z
// is — so the whole job is writing the file the game is already looking for.
//
// WHAT THE LAND DOES, when the only survey is the road itself.
// There is no DEM for a circuit somebody invented. But the road is a
// measurement of its own landscape: where the road is high, the land is high.
// So each grid node takes an inverse-distance-weighted average of the track's
// heights near it. On the road it equals the road; a few hundred metres out it
// relaxes toward the mean; in between it slopes the way the circuit does.
// Nothing else could be honest here — anything more detailed would be invented
// terrain, and flat ground would put a 23 m hilltop on a plinth.
//
// N IS NOT 32. tools/baketrack.mjs paid for this one: at 32 the cells are tens
// of metres, the ground between two nodes is a flat CHORD, and wherever that
// chord runs above the road the grass wins the depth test and buries the car —
// which it did, on the start line, in the first screenshot. Cells here are
// about ten metres and the chord error falls with the square of the cell.
if (!out) {
  const span = Math.max(track.bbox.x1 - track.bbox.x0, track.bbox.y1 - track.bbox.y0);
  const pad = 220;
  const N = Math.max(48, Math.min(200, Math.round((span + 2 * pad) / 10)));
  const gx0 = track.bbox.x0 - pad, gy0 = track.bbox.y0 - pad;
  const dx = (track.bbox.x1 - track.bbox.x0 + 2 * pad) / (N - 1);
  const dy = (track.bbox.y1 - track.bbox.y0 + 2 * pad) / (N - 1);

  let mean = 0;
  for (let i = 0; i < n; i++) mean += Z[i];
  mean /= n;
  const s = Z.map(v => +(v - mean).toFixed(2));

  // Inverse distance, softened by a 60 m core so a node sitting exactly on a
  // sample does not take that one sample's height alone and pock the land.
  // Weight dies off past ~300 m, which is beyond world.js's FAR of 240 — so by
  // the time the grid is the only thing being read, it is already the mean.
  const CORE2 = 60 * 60, REACH2 = 330 * 330;
  const stride = Math.max(1, Math.round(n / 900));   // ~900 samples is plenty
  const h = [];
  for (let j = 0; j < N; j++) {
    const gy = gy0 + j * dy;
    for (let i = 0; i < N; i++) {
      const gx = gx0 + i * dx;
      let wsum = 0, hsum = 0;
      for (let k = 0; k < n; k += stride) {
        const d2 = (X[k] - gx) ** 2 + (Y[k] - gy) ** 2;
        if (d2 > REACH2) continue;
        const w = 1 / (d2 + CORE2);
        wsum += w; hsum += w * (Z[k] - mean);
      }
      h.push(wsum ? +(hsum / wsum).toFixed(2) : 0);
    }
  }

  const elev = {
    key: track.key, dataset: 'modelled', ds: DS,
    note: 'metres relative to the mean height of the modelled road; RENDERING ONLY, physics is 2D',
    mean: +mean.toFixed(1), range: [Math.min(...s), Math.max(...s)],
    s, grid: { x0: +gx0.toFixed(0), y0: +gy0.toFixed(0), dx: +dx.toFixed(3), dy: +dy.toFixed(3), n: N, h },
  };
  const ed = new URL(`../data/elev/${track.key}.json`, import.meta.url).pathname;
  fs.writeFileSync(ed, JSON.stringify(elev));
  console.log(`  elevation     ${ed}  (${(fs.statSync(ed).size / 1024).toFixed(0)} KB, ${N}x${N} grid at ${dx.toFixed(1)} m)`);
  console.log(`                road ${elev.range[0].toFixed(1)} to ${elev.range[1].toFixed(1)} m about its own mean`);
}
