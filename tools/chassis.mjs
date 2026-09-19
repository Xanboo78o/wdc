// chassis.mjs — turn a downloaded 3D-printing model into a car this game can
// actually drive.
//
//   node tools/chassis.mjs <file.stl|file.obj> [--name f1road] [--budget 9000]
//
// A model from Printables or Thingiverse is not a game asset and the gap is
// bigger than a file extension:
//
//   - it is in whatever units and whatever orientation its author used,
//   - it is a PRINT mesh, so 200k-700k triangles is normal (a browser scene
//     budget is a few thousand, and this game wants twenty-two cars),
//   - it has no UVs and no materials, so nothing can be painted on it,
//   - it is usually one solid lump, so the wheels cannot turn.
//
// This fixes the first two, which are the ones that make it unusable at all,
// and is honest about the other two: the loaded chassis is flat-shaded body
// only, and js/car.js keeps its own wheels, wings and livery so the car still
// steers, still spins its tyres and still has a number on it.
import fs from 'fs';
import path from 'path';
import { readSTL, readOBJ, bounds } from './aerolib.mjs';
import { CARS } from '../js/physics.js';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const src = args.find(a => !a.startsWith('--') && /\.(stl|obj)$/i.test(a));
if (!src) { console.error('usage: node tools/chassis.mjs <file.stl|file.obj> [--name X] [--budget N]'); process.exit(1); }
const name = flag('name') || path.basename(src).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
// Generous by default, and deliberately so. Vertex-clustering decimation snaps
// vertices to a grid, and on a car body that shows as visible stair-stepping —
// it is a real cost, not a subtle one. An imported chassis is the PLAYER's car
// only (the twenty-one rivals keep the procedural model, which clones), so one
// car at 45k triangles is nothing to a GPU and the quality is worth far more
// than the saving. Lower it with --budget if you want the field to use it too.
const BUDGET = +(flag('budget') || 45000);
const spec = CARS.f1;

const buf = fs.readFileSync(src);
let tris = src.toLowerCase().endsWith('.obj') ? readOBJ(buf.toString('utf8')) : readSTL(buf);
if (!tris.length) { console.error('no triangles read — is it really an STL or OBJ?'); process.exit(1); }
console.log(`${path.basename(src)}: ${tris.length.toLocaleString()} triangles`);

// ---------------------------------------------------------------------------
// ORIENT AND SCALE.
//
// A car is longer than it is wide, and wider than it is tall. That ordering is
// true of every car ever made and it is enough to recover the orientation from
// the bounding box alone, without asking anyone which way is up.
// ---------------------------------------------------------------------------
{
  const b = bounds(tris);
  const order = [0, 1, 2].sort((i, j) => b.size[j] - b.size[i]);   // long, mid, short
  const k = spec.bodyL / b.size[order[0]];
  const mid = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2);
  tris = tris.map(t => t.map(p => {
    const q = [0, 1, 2].map(i => (p[i] - mid[i]) * k);
    return [q[order[0]], q[order[1]], q[order[2]]];   // x = length, y = width, z = height
  }));
  const nb = bounds(tris);
  tris = tris.map(t => t.map(p => [p[0], p[1], p[2] - nb.lo[2]]));  // sit it on the road
  console.log(`oriented and scaled x${k.toFixed(5)} -> ${nb.size.map(v => v.toFixed(2)).join(' x ')} m` +
              `  (target length ${spec.bodyL} m)`);
}

// ---------------------------------------------------------------------------
// DECIMATE, by vertex clustering.
//
// Snap every vertex to a grid and drop the triangles that collapse. It is not
// the prettiest decimation there is — a proper quadric error metric keeps
// silhouettes better — but it is a hundred lines shorter, it is deterministic,
// and it cannot produce a non-manifold mess from an input that was already a
// print model of unknown quality. Which matters more here than elegance.
// ---------------------------------------------------------------------------
function decimate(tris, target) {
  let cell = Math.cbrt((bounds(tris).size.reduce((a, b) => a * b, 1)) / Math.max(target, 1)) * 0.55;
  let out = tris, pass = 0;
  while (out.length > target && pass < 24) {
    const snap = p => [Math.round(p[0] / cell), Math.round(p[1] / cell), Math.round(p[2] / cell)];
    const seen = new Map();
    const next = [];
    for (const t of out) {
      const k = t.map(snap);
      const key = k.map(a => a.join('_')).join('|');
      // a triangle whose corners land in one cell has no area left
      if (k[0].join() === k[1].join() || k[1].join() === k[2].join() || k[0].join() === k[2].join()) continue;
      if (seen.has(key)) continue;
      seen.set(key, 1);
      next.push(k.map(a => [a[0] * cell, a[1] * cell, a[2] * cell]));
    }
    if (!next.length) break;
    out = next; cell *= 1.25; pass++;
  }
  return out;
}

// Decimation is OPT-IN, and the reason is visible in a screenshot: vertex
// clustering snaps vertices to a grid, and on a car body that reads as obvious
// stair-stepping across every curved panel. It is a real cost, not a subtle
// one. An imported chassis is the PLAYER's car only — the twenty-one rivals
// keep the procedural model, which clones — so one car at 50k triangles costs
// a GPU nothing and the quality is worth far more than the saving.
//
// So: only decimate when asked with --budget, or when the model is so heavy
// that it would hurt no matter how it looks. Print models run to 700k.
const HARD_CAP = 120000;
const asked = flag('budget') != null;
if (asked || tris.length > HARD_CAP) {
  const target = asked ? BUDGET : HARD_CAP;
  const before = tris.length;
  tris = decimate(tris, target);
  console.log(`decimated ${before.toLocaleString()} -> ${tris.length.toLocaleString()} triangles (target ${target})`);
  if (!asked) console.log('  (over the hard cap — pass --budget N to control this, quality suffers)');
} else {
  console.log(`${tris.length.toLocaleString()} triangles, kept as-is (--budget N to decimate; grid snapping visibly facets curved panels)`);
}

// ---------------------------------------------------------------------------
// WRITE. A flat array of positions, which is what a BufferGeometry wants —
// no index, because a decimated print mesh shares almost no vertices anyway
// and an index would cost more than it saves.
// ---------------------------------------------------------------------------
const pos = new Array(tris.length * 9);
let i = 0;
for (const t of tris) for (const p of t) { pos[i++] = +p[0].toFixed(3); pos[i++] = +p[1].toFixed(3); pos[i++] = +p[2].toFixed(3); }
const b = bounds(tris);
const out = {
  name, source: path.basename(src), generated: new Date().toISOString().slice(0, 10),
  tris: tris.length, size: b.size.map(v => +v.toFixed(3)),
  note: 'body only, flat shaded, no UVs. car.js keeps its own wheels, wings and livery.',
  pos,
};
const dest = `data/chassis/${name}.json`;
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`\nwrote ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${tris.length} tris)`);
console.log(`use it with:  ?chassis=${name}`);
console.log(`and bake its aerodynamics with:  node tools/aerobake.mjs f1 --mesh ${src}`);
