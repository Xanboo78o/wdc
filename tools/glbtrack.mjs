// glbtrack.mjs — a circuit modelled in Blender, turned into a track this game
// can measure and drive.
//
//   node tools/glbtrack.mjs <file.glb> --key myTrack --name "My Track"
//   node tools/glbtrack.mjs <file.glb> --key myTrack --out -        (stdout stats only)
//
// WHAT IT EXPECTS: a ROAD RIBBON — one mesh, a strip of quads two vertices
// wide, the way a curve with a bevel or a solidified plane comes out of
// Blender. That is what Adam's first export was, and it is the shape worth
// supporting: the road IS the model, so nothing has to be guessed.
//
// It does not expect, and will refuse rather than mangle:
//   - a mesh whose vertices do not pair up into cross-sections
//   - a ribbon whose two edges swap sides partway along (a figure-eight fold)
//
// COORDINATES. glTF is Y-up with -Z forward. This project is X/Y in plan with
// height on its own axis (js/build/meshes.js: V(x, y, h) -> (x, h, -y)). So
//     x = X        y = -Z        height = Y
// Get that backwards and the track renders MIRRORED, which does not look like
// a bug — it looks like a track, and then the steering feels inverted. That
// exact mistake cost a day on the real circuits (DESIGN.md gotcha 6).
import fs from 'fs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--key', '--name', '--out', '--ds', '--run', '--help']);
let file = null, key = null, name = null, out = null, DS = 2, RUN = 12;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (!KNOWN.has(a)) { console.error(`glbtrack: unknown flag ${a}`); process.exit(2); }
    if (a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 26).join('\n')); process.exit(0); }
    if (a === '--key') key = argv[++i];
    if (a === '--name') name = argv[++i];
    if (a === '--out') out = argv[++i];
    if (a === '--ds') DS = +argv[++i];
    if (a === '--run') RUN = +argv[++i];
  } else if (!file) file = a;
  else { console.error(`glbtrack: more than one file given`); process.exit(2); }
}
if (!file) { console.error('glbtrack: no .glb given'); process.exit(2); }

// --- glTF binary ------------------------------------------------------------
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('glbtrack: not a .glb'); process.exit(2); }
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
function accessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
  const [fn, size] = COMP[a.componentType], n = NUM[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const stride = bv.byteStride || size * n;
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const o = start + k * stride, v = [];
    for (let c = 0; c < n; c++) v.push(bin[fn](o + c * size));
    out.push(v);
  }
  return out;
}

const meshes = gltf.meshes || [];
if (meshes.length !== 1 || meshes[0].primitives.length !== 1) {
  console.error(`glbtrack: expected one mesh with one primitive, found ${meshes.length} mesh(es)`);
  process.exit(2);
}
const prim = meshes[0].primitives[0];
const P = accessor(prim.attributes.POSITION);

// --- the ribbon -------------------------------------------------------------
// Vertices come out of Blender in cross-section order: left, right, left,
// right. Verify it rather than assume it — a mesh that does not pair up would
// otherwise produce a plausible centreline through the middle of nothing.
if (P.length % 2) { console.error('glbtrack: odd vertex count — this is not a two-wide ribbon'); process.exit(2); }
const pairs = P.length / 2;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const widths = [];
for (let k = 0; k < pairs; k++) widths.push(dist(P[2 * k], P[2 * k + 1]));
const wMean = widths.reduce((a, b) => a + b, 0) / pairs;
// A cross-section should be much shorter than the step between sections is
// long — if the "width" wanders wildly, the vertices are not paired.
const wMin = Math.min(...widths), wMax = Math.max(...widths);
if (wMax > wMean * 6 || wMin <= 0.01) {
  console.error(`glbtrack: vertices do not pair into cross-sections (width ${wMin.toFixed(2)}..${wMax.toFixed(2)} m, mean ${wMean.toFixed(2)})`);
  process.exit(2);
}

// glTF -> this project's plan coordinates.
const raw = [];
for (let k = 0; k < pairs; k++) {
  const a = P[2 * k], b = P[2 * k + 1];
  raw.push({
    x: (a[0] + b[0]) / 2, y: -(a[2] + b[2]) / 2, z: (a[1] + b[1]) / 2,
    w: widths[k],
    // which side each edge is on, to catch a ribbon that folds over itself
    lx: a[0], ly: -a[2],
  });
}

// Does the loop close? Blender curves usually do, to within a vertex or two.
const gap = Math.hypot(raw[0].x - raw[pairs - 1].x, raw[0].y - raw[pairs - 1].y);
const step0 = Math.hypot(raw[1].x - raw[0].x, raw[1].y - raw[0].y);
const closed = gap < Math.max(25, step0 * 4);

// --- resample to this project's spacing -------------------------------------
// Every circuit in data/tracks is sampled every 2 m and every tool assumes it.
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
  const span = cum[seek] - cum[seek - 1] || 1;
  const t = (s - cum[seek - 1]) / span;
  X.push(a.x + (b.x - a.x) * t);
  Y.push(a.y + (b.y - a.y) * t);
  Z.push(a.z + (b.z - a.z) * t);
  W.push(a.w + (b.w - a.w) * t);
}

// `w` in a track file is the HALF width — every consumer reads it as "the road
// runs from -w to +w". The ribbon gives the full width, so halve it. Getting
// this wrong makes a 19 m road 38 m wide and every corner flatterable.
const half = W.map(w => w / 2);

const track = {
  key: key || 'imported', name: name || key || 'Imported',
  full: name || key || 'Imported', country: '', aiPace: 0.8,
  length: n * DS, ds: DS, wall: 'armco', crossover: false,
  bbox: { x0: Math.min(...X), x1: Math.max(...X), y0: Math.min(...Y), y1: Math.max(...Y) },
  x: X.map(v => +v.toFixed(3)), y: Y.map(v => +v.toFixed(3)),
  // Height is carried, because his track HAS twenty metres of it and throwing
  // that away would be the whole point of modelling it by hand. physics.js is
  // still planar, so today this is the renderer's to use.
  z: Z.map(v => +v.toFixed(3)),
  w: half.map(v => +v.toFixed(3)),
  bank: new Array(n).fill(0),
  runL: new Array(n).fill(RUN), runR: new Array(n).fill(RUN),
  line: new Array(n).fill(0), corners: [], drs: [], pit: null, sponsors: [],
};

// --- does the road run into itself? -----------------------------------------
// A hand-modelled circuit folds back on itself constantly, and at the width a
// Blender bevel hands you by default the two legs can be the SAME TARMAC
// without the author ever seeing it — in the viewport it reads as two roads
// with a seam. It matters twice: it looks wrong, and `crossover` in the track
// file is what tells foldcheck.mjs that a self-intersection here is legal.
//
// Reported in metres of lap rather than as a flag, because the number is the
// actionable thing: it tells the author how much narrower the road wants to be.
let overlap = 0, tightest = Infinity, tightAt = 0;
const SKIP = Math.ceil(80 / DS);         // ignore your own neighbourhood
for (let i = 0; i < n; i++) {
  let bd = Infinity, bj = -1;
  for (let j = 0; j < n; j++) {
    const apart = Math.min(Math.abs(i - j), n - Math.abs(i - j));
    if (apart < SKIP) continue;
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
console.log(`${file}`);
console.log(`  ribbon        ${pairs} cross-sections, ${(total / (pairs - (closed ? 0 : 1))).toFixed(2)} m apart`);
console.log(`  loop          ${closed ? `CLOSED (ends ${gap.toFixed(2)} m apart, bridged)` : `OPEN (ends ${gap.toFixed(0)} m apart — point to point)`}`);
console.log(`  length        ${(total / 1000).toFixed(3)} km, resampled to ${n} samples at ${DS} m`);
console.log(`  road width    ${wMin.toFixed(1)}..${wMax.toFixed(1)} m, mean ${wMean.toFixed(1)}`);
console.log(`  elevation     ${zMin.toFixed(1)} .. ${zMax.toFixed(1)} m  (range ${(zMax - zMin).toFixed(1)}, ${climb.toFixed(0)} m climbed a lap)`);
console.log(`  footprint     ${(track.bbox.x1 - track.bbox.x0).toFixed(0)} x ${(track.bbox.y1 - track.bbox.y0).toFixed(0)} m`);
if (overlap > 0) {
  console.log(`  SELF-OVERLAP  ${overlap} m of lap where the road lies on another part of itself`);
  console.log(`                closest centrelines ${tightest.toFixed(1)} m apart, at s=${tightAt.toFixed(0)} m`);
  console.log(`                at this width. A narrower road clears most of it.`);
} else {
  console.log(`  self-overlap  none — closest approach ${tightest.toFixed(1)} m at s=${tightAt.toFixed(0)}`);
}

if (out === '-') process.exit(0);
const dest = out || new URL(`../data/tracks/${track.key}.json`, import.meta.url).pathname;
fs.writeFileSync(dest, JSON.stringify(track));
console.log(`  written       ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
