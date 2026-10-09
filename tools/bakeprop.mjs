// bakeprop.mjs — a downloaded trackside model, made ready for the native game.
//
//   node tools/bakeprop.mjs <key> <folder with scene.gltf>     bake one
//   node tools/bakeprop.mjs --list                             the recipes
//   node tools/bakeprop.mjs <key> <folder> --look              print what is in it, write nothing
//
// The cars have tools/bakecar.mjs; this is the same idea for the things that
// stand beside the road: armco, concrete barrier, catch fence. Out comes
//
//   data/props/<key>/prop.json   what it is, who made it, how big
//   data/props/<key>/prop.bin    float32 triangles: pos3 nrm3 uv2, no index, biggest first
//   data/props/<key>/base.jpg    its photograph (base.png when it has a cut-out)
//
// in the PROP'S FRAME: x along the run from 0 to its length, y up from the
// ground, z across (negative toward the road, positive away from it), metres.
// The game lays x along the edge of the circuit (native/src/props.cpp), so a
// piece that BENDS is sliced here every `slice` metres: a ten metre rail with
// no vertex between its ends would cut every corner as a ten metre chord.
//
// EACH MODEL IS A RECIPE below, because each came from a different person with
// a different idea of which way is up and how long a metre is.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;

const RECIPES = {
  // length: metres the piece is scaled to along its run (everything scales with it)
  // bend:   follows the curve of the road; false = stands rigid, one chord a piece
  // flip:   turn it round so its face looks at the road
  // scale:  the model's own units into metres, keeping ITS ground at y = 0
  // drop:   leave out triangles that lie wholly below this height (a slab of earth it stood on)
  armco:    { height: 0.90, bend: true, slice: 2.0, flip: false },   // race armco stands taller than a road's
  concrete: { height: 0.90, bend: false, flip: false },
  fence:    { scale: 0.01, drop: 0.03, bend: true, slice: 1.5, flip: false },   // modelled in centimetres, on a block of earth
};

const argv = process.argv.slice(2);
if (argv[0] === '--list') { for (const [k, r] of Object.entries(RECIPES)) console.log(k.padEnd(10), JSON.stringify(r)); process.exit(0); }
const known = new Set(['--look', '--flip']);
for (const a of argv.slice(2)) if (!known.has(a)) { console.error('bakeprop: unknown flag ' + a); process.exit(2); }
const [key, src] = argv;
const R = RECIPES[key];
if (!R || !src) { console.error('bakeprop: node tools/bakeprop.mjs <key> <folder>   (keys: ' + Object.keys(RECIPES).join(', ') + ')'); process.exit(2); }
const LOOK = argv.includes('--look');
const flip = R.flip !== argv.includes('--flip');

const g = JSON.parse(fs.readFileSync(path.join(src, 'scene.gltf'), 'utf8'));
const bufs = g.buffers.map(b => fs.readFileSync(path.join(src, b.uri)));

// ---- reading -----------------------------------------------------------------
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function accessor(ix) {
  const a = g.accessors[ix], bv = g.bufferViews[a.bufferView], buf = bufs[bv.buffer];
  const nc = NCOMP[a.type], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const stride = bv.byteStride || size * nc;
  const out = new Float64Array(a.count * nc);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < nc; c++) {
    const p = off + i * stride + c * size;
    let v;
    switch (a.componentType) {
      case 5126: v = buf.readFloatLE(p); break;
      case 5125: v = buf.readUInt32LE(p); break;
      case 5123: v = buf.readUInt16LE(p); if (a.normalized) v /= 65535; break;
      case 5121: v = buf.readUInt8(p); if (a.normalized) v /= 255; break;
      case 5122: v = buf.readInt16LE(p); if (a.normalized) v = Math.max(v / 32767, -1); break;
      case 5120: v = buf.readInt8(p); if (a.normalized) v = Math.max(v / 127, -1); break;
    }
    out[i * nc + c] = v;
  }
  return out;
}
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1];
}

// every triangle of the scene, in the scene's own space: [{mat, v:[p,n,uv]x3}]
const tris = [];
function walk(ni, M) {
  const n = g.nodes[ni], W = mul(M, local(n));
  if (n.mesh !== undefined) for (const pr of g.meshes[n.mesh].primitives) {
    if ((pr.mode ?? 4) !== 4) continue;
    const P = accessor(pr.attributes.POSITION);
    const N = pr.attributes.NORMAL !== undefined ? accessor(pr.attributes.NORMAL) : null;
    const U = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0) : null;
    const I = pr.indices !== undefined ? accessor(pr.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
    const vert = i => {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const p = [W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]];
      let nn = [0, 1, 0];
      if (N) { const a = N[i * 3], b = N[i * 3 + 1], c = N[i * 3 + 2]; nn = [W[0] * a + W[4] * b + W[8] * c, W[1] * a + W[5] * b + W[9] * c, W[2] * a + W[6] * b + W[10] * c]; }
      return { p, n: nn, uv: U ? [U[i * 2], U[i * 2 + 1]] : [0, 0] };
    };
    for (let t = 0; t + 2 < I.length; t += 3) tris.push({ mat: pr.material ?? -1, v: [vert(I[t]), vert(I[t + 1]), vert(I[t + 2])] });
  }
  for (const c of n.children || []) walk(c, W);
}
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const r of g.scenes[g.scene || 0].nodes) walk(r, I4);
if (!tris.length) { console.error('bakeprop: no triangles in ' + src); process.exit(1); }

const bounds = () => { const lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30]; for (const t of tris) for (const v of t.v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v.p[k]); hi[k] = Math.max(hi[k], v.p[k]); } return { lo, hi }; };
let B = bounds();
if (LOOK) {
  console.log(`${key}: ${tris.length} triangles, scene bounds`, B.lo.map(v => +v.toFixed(3)), B.hi.map(v => +v.toFixed(3)));
  (g.materials || []).forEach((m, i) => { const t = m.pbrMetallicRoughness?.baseColorTexture; console.log(`  material ${i} ${m.name} ${m.alphaMode || 'OPAQUE'} ${t ? g.images[g.textures[t.index].source].uri : '(no map)'} tris ${tris.filter(q => q.mat === i).length}`); });
  process.exit(0);
}

// ---- into the prop's frame ---------------------------------------------------
// glTF is y up. The run is whichever level axis is longer.
const turn = (f) => { for (const t of tris) for (const v of t.v) { v.p = f(v.p); v.n = f(v.n); } };
if (B.hi[2] - B.lo[2] > B.hi[0] - B.lo[0]) turn(([x, y, z]) => [z, y, -x]);
if (flip) turn(([x, y, z]) => [-x, y, -z]);
B = bounds();
const ext = [0, 1, 2].map(k => B.hi[k] - B.lo[k]);
const s = R.scale ? R.scale : R.length ? R.length / ext[0] : R.height / ext[1];
const zmid = (B.lo[2] + B.hi[2]) / 2, y0 = R.scale ? 0 : B.lo[1];
for (const t of tris) for (const v of t.v) {
  v.p = [(v.p[0] - B.lo[0]) * s, (v.p[1] - y0) * s, (v.p[2] - zmid) * s];
  const l = Math.hypot(...v.n) || 1; v.n = v.n.map(c => c / l);
}
if (R.drop !== undefined) { const keep = tris.filter(t => t.v.some(v => v.p[1] > R.drop)); tris.length = 0; tris.push(...keep); }
const length = ext[0] * s, height = (B.hi[1] - y0) * s, depth = ext[2] * s;

// ---- slicing: no triangle may span more than one `slice` of the run -----------
let out = tris;
if (R.bend) {
  const lerp = (a, b, f) => ({ p: a.p.map((c, k) => c + (b.p[k] - c) * f), n: a.n.map((c, k) => c + (b.n[k] - c) * f), uv: a.uv.map((c, k) => c + (b.uv[k] - c) * f) });
  for (let cut = R.slice; cut < length - 1e-6; cut += R.slice) {
    const next = [];
    for (const t of out) {
      const side = t.v.map(v => v.p[0] - cut);
      if (side.every(d => d <= 1e-9) || side.every(d => d >= -1e-9)) { next.push(t); continue; }
      // clip the triangle by the plane into a near polygon and a far one
      const A = [], Z = [];
      for (let i = 0; i < 3; i++) {
        const a = t.v[i], b = t.v[(i + 1) % 3], da = side[i], db = side[(i + 1) % 3];
        (da <= 0 ? A : Z).push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const m = lerp(a, b, da / (da - db)); A.push(m); Z.push(m); }
      }
      for (const poly of [A, Z]) for (let i = 1; i + 1 < poly.length; i++) next.push({ mat: t.mat, v: [poly[0], poly[i], poly[i + 1]] });
    }
    out = next;
  }
}

// ---- the photograph -----------------------------------------------------------
const dir = ROOT + 'data/props/' + key + '/';
fs.mkdirSync(dir, { recursive: true });
const used = [...new Set(out.map(t => t.mat))].filter(i => i >= 0);
const mapped = used.map(i => ({ i, m: g.materials[i], t: g.materials[i].pbrMetallicRoughness?.baseColorTexture })).filter(q => q.t);
if (mapped.length !== 1) { console.error(`bakeprop: ${key} has ${mapped.length} textured materials; this tool bakes models with exactly one`); process.exit(1); }
const img = path.join(src, g.images[g.textures[mapped[0].t.index].source].uri);
const alphaMode = mapped[0].m.alphaMode || 'OPAQUE';
const opaque = execFileSync('magick', [img, '-format', '%[opaque]', 'info:']).toString().trim().toLowerCase() === 'true';
const cutout = alphaMode !== 'OPAQUE' && !opaque;
for (const f of ['base.jpg', 'base.png']) fs.rmSync(dir + f, { force: true });
const tex = cutout ? 'base.png' : 'base.jpg';
execFileSync('magick', cutout ? [img, '-resize', '1024x1024>', dir + tex] : [img, '-alpha', 'off', '-resize', '1024x1024>', '-quality', '90', dir + tex]);

// ---- biggest first: the head of the file is the piece from far away ---------
// A rail's face is a few large triangles and its bolts are hundreds of small
// ones. Sorted by area, "the first N vertices" is a ready-made distant version:
// the game draws only as far down the file as the distance deserves.
const areaOf = t => { const [a, b, c] = t.v.map(v => v.p); const u = b.map((q, k) => q - a[k]), w = c.map((q, k) => q - a[k]); return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; };
for (const t of out) t.area = areaOf(t);
out.sort((a, b) => b.area - a.area);
const whole = out.reduce((q, t) => q + t.area, 0);
let far = 0;
for (let acc = 0; far < out.length && acc < whole * 0.88; far++) acc += out[far].area;

// ---- out ----------------------------------------------------------------------
const f32 = new Float32Array(out.length * 3 * 8);
let o = 0;
for (const t of out) for (const v of t.v) { f32.set([...v.p, ...v.n, v.uv[0], v.uv[1]], o); o += 8; }
fs.writeFileSync(dir + 'prop.bin', Buffer.from(f32.buffer));
const ex = g.asset?.extras || {};
const meta = {
  key, title: ex.title || key, author: ex.author || '', license: ex.license || '', source: ex.source || '',
  length: +length.toFixed(4), height: +height.toFixed(4), depth: +depth.toFixed(4),
  bend: !!R.bend, cutout, tex, verts: out.length * 3, farVerts: far * 3,
};
fs.writeFileSync(dir + 'prop.json', JSON.stringify(meta, null, 1) + '\n');
console.log(`${key}: ${out.length} triangles (${tris.length} before slicing), ${meta.length} m long, ${meta.height} m high, ${meta.depth} m deep, ${tex}${cutout ? ' with a cut-out' : ''}; from far away ${far} triangles`);
