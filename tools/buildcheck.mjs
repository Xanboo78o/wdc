// buildcheck.mjs — the gate for the hand-built track (build.html).
//
//   node tools/buildcheck.mjs            report + checks, non-zero exit on a FAIL
//   node tools/buildcheck.mjs --break    same checks against deliberately broken
//                                        ground, to prove the gate can fail
//
// What it proves:
//   1. NO CLIPPING, AS DRAWN. It rebuilds the road triangles exactly as
//      meshes.js draws them, and the terrain triangles exactly as ground.js
//      emits them, and checks at points all over every road triangle (and the
//      kerb band beside it) that the terrain triangle underneath is lower.
//      Not "the height function is lower" — the triangles, because a triangle
//      straddling the road edge interpolates between its corners, and that
//      interpolation is exactly how terrain ends up poking through a road.
//   2. Samples are exactly DS apart (the game's Track assumes s = i * ds).
//   3. Where the road crosses itself there is room for a bridge, the road
//      UNDERNEATH is not walled in by the embankment carrying the one above,
//      and no support lands on another carriageway.
// And it prints the piece list with an F1 corner speed for each turn.
import { buildPath, pointAt, surfaceY } from '../js/build/path.js';
import { GROUND } from '../js/build/ground.js';
import { Ground } from '../js/build/ground.js';
import { CARS, corneringSpeed, limitMu, topSpeed } from '../js/physics.js';
import { PIER, pierSites, pierBox } from '../js/build/piers.js';

const args = process.argv.slice(2);
const known = new Set(['--break']);
// --pieces=data/build/kate.js checks a track other than the test map's.
let PIECE_FILE = 'data/build/pieces.js';
for (const a of args) {
  if (a.startsWith('--pieces=')) PIECE_FILE = a.slice(9);
  else if (!known.has(a)) { console.error(`unknown flag ${a}`); process.exit(2); }
}
const BREAK = args.includes('--break');

const { TRACK, PIECES } = await import(`../${PIECE_FILE}?t=${Date.now()}`);
const t0 = performance.now();
const path = buildPath(PIECES, { closed: !!TRACK.closed });
const ground = new Ground(path, BREAK ? { VERGE: -12, CUT: 4, NEAR: 6 } : {});
if (BREAK) {
  // a hill right against the road on both sides
  const nat = ground.natural.bind(ground);
  ground.natural = (x, y, ...r) => nat(x, y, ...r) + 25;
}
const tp = performance.now();
const chunks = ground.chunks();
const tc = performance.now();

let fails = 0;
const fail = m => { fails++; console.log('FAIL  ' + m); };
const ok = m => console.log('ok    ' + m);

// ---- the pieces ----------------------------------------------------------
const F1 = CARS.f1, MU = limitMu(F1), TOP = topSpeed(F1) * 3.6;
console.log(`\n${TRACK.name} — ${(path.length / 1000).toFixed(3)} km, ${PIECES.length} pieces, ${path.n} samples`);
for (const p of path.pieces) {
  const at = `${Math.round(p.s0)}-${Math.round(p.s1)} m`.padEnd(14);
  const climb = p.climb ? `  climb ${p.climb > 0 ? '+' : ''}${p.climb} m` : '';
  if (p.kind === 'straight') { console.log(`  ${String(p.n).padStart(2)}  ${at} STRAIGHT ${Math.round(p.len)} m${climb}`); continue; }
  const v = corneringSpeed(F1, p.radius, MU, p.bank) * 3.6;
  console.log(`  ${String(p.n).padStart(2)}  ${at} ${p.dir.toUpperCase()} ${p.angle}deg R${p.radius}${climb}${p.bank ? `  bank ${p.bank}` : ''}  -> F1 ${v >= TOP - 1 ? 'FLAT' : Math.round(v) + ' km/h'}`);
}
const zs = Array.from(path.z);
console.log(`  height range ${Math.min(...zs).toFixed(1)} .. ${Math.max(...zs).toFixed(1)} m`);
console.log(`  path ${(tp - t0).toFixed(0)} ms, terrain ${(tc - tp).toFixed(0)} ms, ${chunks.length} chunks, ` +
  `${Math.round(chunks.reduce((a, c) => a + c.index.length / 3, 0) / 1000)}k terrain tris\n`);

// ---- 2. spacing -----------------------------------------------------------
{
  let worst = 0;
  for (let i = 1; i < path.n; i++) worst = Math.max(worst, Math.abs(Math.hypot(path.x[i] - path.x[i - 1], path.y[i] - path.y[i - 1]) - path.ds));
  (worst < 1e-3 ? ok : fail)(`sample spacing exact to ${(worst * 1000).toFixed(3)} mm`);
}

// ---- 1. clipping, triangle against triangle --------------------------------
// terrain triangles near the road, bucketed by 2D bounding box
const B = 8, tris = new Map();
let nTris = 0;
for (const c of chunks) {
  const P = c.position, I = c.index;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], bx = P[b], by = P[b + 1], cx = P[d], cy = P[d + 1];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-6) continue;                   // skirts are vertical
    if (ground.roadDist(ax, ay) > 140) continue;
    const tri = [ax, ay, P[a + 2], bx, by, P[b + 2], cx, cy, P[d + 2], area];
    nTris++;
    for (let gx = Math.floor(Math.min(ax, bx, cx) / B); gx <= Math.floor(Math.max(ax, bx, cx) / B); gx++)
      for (let gy = Math.floor(Math.min(ay, by, cy) / B); gy <= Math.floor(Math.max(ay, by, cy) / B); gy++) {
        const k = gx * 100003 + gy;
        let l = tris.get(k); if (!l) tris.set(k, l = []);
        l.push(tri);
      }
  }
}
function terrainAt(x, y) {
  const l = tris.get(Math.floor(x / B) * 100003 + Math.floor(y / B));
  if (!l) return null;
  let best = null;
  for (const t of l) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz, area] = t;
    const u = ((bx - x) * (cy - y) - (cx - x) * (by - y)) / area;
    const v = ((cx - x) * (ay - y) - (ax - x) * (cy - y)) / area;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const z = u * az + v * bz + w * cz;
    if (best === null || z > best) best = z;
  }
  return best;
}
{
  let worst = Infinity, where = null, checked = 0, missing = 0;
  const test = (x, y, roadZ, s, lat) => {
    const tz = terrainAt(x, y);
    if (tz === null) { missing++; return; }
    checked++;
    const m = roadZ - tz;
    if (m < worst) { worst = m; where = { s, lat, roadZ, tz }; }
  };
  const N = 6;
  for (let i = 0; i < path.n - 1; i++) {
    if (path.tunnel[i] || path.tunnel[i + 1]) continue;   // checked the other way round below
    // the road's two triangles between sample i and i+1, as meshes.js draws them
    const L0 = pointAt(path, i, path.w[i]), R0 = pointAt(path, i, -path.w[i]);
    const L1 = pointAt(path, i + 1, path.w[i + 1]), R1 = pointAt(path, i + 1, -path.w[i + 1]);
    for (const [A, Bv, C] of [[L0, R0, L1], [R0, R1, L1]]) {
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N - a; b++) {
        const u = a / N, v = b / N, w = 1 - u - v;
        test(A.x * u + Bv.x * v + C.x * w, A.y * u + Bv.y * v + C.y * w, A.z * u + Bv.z * v + C.z * w,
          i * path.ds, null);
      }
    }
    // The kerb band and the first metres of verge, held to the edge height:
    // the kerb is drawn ON this ground, and past it the ground must not rise
    // into a lip above the road. (The verge is designed 5 cm under the edge;
    // a sag in the road — a compression, or a slope levelling off — costs up
    // to ~1 cm of that where terrain triangles bridge the bend, which is why
    // this is held to the edge and not to the designed 5 cm.)
    for (const side of [1, -1]) for (const extra of [0, 0.4, 0.8, 1.2, 2.5, 4]) for (const f of [0, 0.5]) {
      const j = f ? i + 1 : i;
      const lat = side * (path.w[j] + extra);
      const p = pointAt(path, j, lat);
      test(p.x, p.y, surfaceY(path, j, side * path.w[j]), j * path.ds, lat);
    }
  }
  const msg = `terrain under the road everywhere: ${checked} points, worst margin ${(worst * 100).toFixed(1)} cm` +
    (where && worst < 0.01 ? ` (road ${where.roadZ.toFixed(2)} vs ground ${where.tz.toFixed(2)} at s=${where.s}${where.lat != null ? ` lat ${where.lat.toFixed(1)}` : ''})` : '');
  (worst >= 0.01 ? ok : fail)(msg);
  (missing === 0 ? ok : fail)(`every road point has terrain under it (${missing} without)`);

  // ---- and the tunnels, which are the same rule upside down ---------------
  // Only where the tunnel is properly inside the hill: at the mouth the rock
  // is thin on purpose (GROUND.PORTAL), and the tunnel mesh covers that.
  let tunPts = 0, thin = null;
  for (let i = 0; i < path.n; i++) {
    if (path.tunIn[i] < GROUND.PORTAL) continue;
    const p = pointAt(path, i, 0);
    const tz = terrainAt(p.x, p.y);
    if (tz === null) continue;
    tunPts++;
    const over = tz - p.z;
    if (!thin || over < thin.over) thin = { over, s: i * path.ds };
  }
  if (tunPts) (thin.over >= 3 ? ok : fail)(
    `hill over every tunnel: ${tunPts} points past the portals, thinnest ${thin.over.toFixed(1)} m of rock at s=${thin.s} (want >= 3, asked for ${GROUND.ROCK})`);
  console.log(`      ${nTris} terrain triangles within 140 m of the road`);
}

// ---- 3. crossings -----------------------------------------------------------
{
  const segs = [];
  for (let i = 0; i < path.n - 1; i++) segs.push(i);
  const H = 20, grid = new Map();
  for (const i of segs) {
    const k = Math.floor(path.x[i] / H) * 100003 + Math.floor(path.y[i] / H);
    let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
  }
  const crossings = [];
  for (const i of segs) {
    const gx = Math.floor(path.x[i] / H), gy = Math.floor(path.y[i] / H);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const j of grid.get((gx + ox) * 100003 + gy + oy) || []) {
        if (j <= i + 30) continue;               // neighbours along the road
        const ax = path.x[i], ay = path.y[i], bx = path.x[i + 1], by = path.y[i + 1];
        const cx = path.x[j], cy = path.y[j], dx = path.x[j + 1], dy = path.y[j + 1];
        const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        if (d1 * d2 < 0 && d3 * d4 < 0) crossings.push({ s1: i * path.ds, s2: j * path.ds, dz: Math.abs(path.z[i] - path.z[j]) });
      }
    }
  }
  // one crossing of two roads shows up once per pair of samples that overlap;
  // report the PLACE, with its tightest clearance
  const spots = [];
  for (const c of crossings) {
    const near = spots.find(s => Math.abs(s.s1 - c.s1) < 60 && Math.abs(s.s2 - c.s2) < 60);
    if (near) { near.dz = Math.min(near.dz, c.dz); near.n++; }
    else spots.push({ ...c, n: 1 });
  }
  if (!spots.length) ok('the road never crosses itself');
  for (const c of spots) (c.dz >= 5.5 ? ok : fail)(
    `road crosses itself at s=${c.s1} and s=${c.s2}: ${c.dz.toFixed(1)} m apart vertically (bridge needs 5.5)`);

  // ---- the road underneath can actually exist ------------------------------
  // Vertical clearance was never the problem. The problem was sideways: the
  // land is made FROM the road, so the embankment carrying the upper road came
  // down to meet the lower one and stood across it as a cliff, leaving the
  // crossing a slot cut through a hillside. Clearance said 10.1 m and passed
  // while you could not drive the road underneath at all.
  //
  // So: within RANGE of a road that passes beneath another, the land may not
  // stand RISE metres above it. That is what `bridge: true` buys, and it is
  // the thing you can see out of the windscreen.
  // What a bridge is FOR, measured: how far the road underneath stays in the
  // open before the land stands WALL metres over it. Terrain here is made from
  // the road, so without a bridge the embankment carrying the road above comes
  // down beside the one below and that distance collapses.
  //
  // Measured at the esses/hairpins crossing, same map, flag on and off:
  //   without `bridge: true`   open for 40 m, then a 10 m cliff, on the LEFT
  //   with it                  open for 60 m, and the limit is now the RIGHT
  //                            side, which is the hairpin bowl's own cutting
  //                            and nothing to do with the bridge.
  // 55 sits between the two with room either way.
  //
  // Vertical clearance is NOT this. Clearance was 10.1 m and passed all along
  // while the road underneath was walled in — that is why this check exists.
  const WALL = 8, OPEN = 55;
  for (const c of spots) {
    const iu = Math.round(c.s1 / path.ds), jl = Math.round(c.s2 / path.ds);
    const [hi, lo] = path.z[iu] >= path.z[jl] ? [iu, jl] : [jl, iu];
    // Only a crossing we PROMISED to bridge is a failure. A stacked structure
    // like the double loop has coils close by on purpose; it is reported so it
    // can be judged, not failed for being what it is.
    const promised = !!(path.briIn && path.briIn[hi] > 0);
    let worst = 1e9, at = 0;
    for (let d = -24; d <= 24; d += 4) {
      const k = Math.max(0, Math.min(path.n - 1, lo + Math.round(d / path.ds)));
      let reach = 999;
      for (let lat = 0; lat <= 240; lat += 4) {
        const l = pointAt(path, k, lat), r = pointAt(path, k, -lat);
        const up = Math.max(ground.height(l.x, l.y), ground.height(r.x, r.y)) - path.z[k];
        if (up > WALL) { reach = lat; break; }
      }
      if (reach < worst) { worst = reach; at = d; }
    }
    const far = worst > 240 ? '>240' : String(worst);
    const msg = `under s=${c.s2} (crossed by s=${c.s1}): open for ${far} m each side before the land stands ${WALL} m over it`;
    if (!promised) console.log(`      ${msg} — not a declared bridge, not judged`);
    else (worst >= OPEN ? ok : fail)(`${msg} (a bridge promises >= ${OPEN})`);
  }
}

// ---- supports stand clear of every other carriageway -----------------------
// The defect this exists for: a bridge's piers dropping straight through the
// road the bridge was built to cross. Checked as the drawn BOX against the
// road's drawn width, not by the centre-distance rule that sited them — a rule
// checking itself proves nothing.
{
  // --break sites them without the clearance rule, which is how this gate was
  // watched to fail rather than assumed to work.
  const sites = pierSites(path, ground).filter(p => BREAK || p.skipped < 0);
  let worst = null;
  for (const p of sites) {
    const b = pierBox(p);
    const reach = Math.hypot(b.along, b.across);
    for (let j = 0; j < path.n; j++) {
      const z = path.z[j];
      if (z < p.gc - 2 || z > p.top - 1.5) continue;
      const rx = path.x[j] - p.x, ry = path.y[j] - p.y;
      const along = Math.abs(rx * Math.cos(p.hdg) + ry * Math.sin(p.hdg));
      const across = Math.abs(-rx * Math.sin(p.hdg) + ry * Math.cos(p.hdg));
      // nearest point of the pier's footprint to this bit of road centreline
      const gap = Math.hypot(Math.max(0, along - b.along), Math.max(0, across - b.across)) - path.w[j];
      if (gap < 0 && (!worst || gap < worst.gap)) worst = { gap, s: j * path.ds, at: p.i * path.ds, reach };
    }
  }
  const skipped = pierSites(path, ground).filter(p => p.skipped >= 0);
  if (worst) fail(`a support at s=${worst.at} stands ${(-worst.gap).toFixed(1)} m INTO the road at s=${worst.s}`);
  else ok(`${sites.length} supports, none on another carriageway (${skipped.length} sited then dropped for one)`);
}

// ---- the world's objects still belong to this track ------------------------
// data/build/objects.js is WRITTEN ONCE by tools/layout.mjs and is nobody's
// job to keep in step, so it silently goes stale every time a piece moves.
// On 2026-09-20 it held 2,942 barriers baked against an older track: 430 of
// them floated, worst 31.3 m in the air, and 320 were buried up to 7.0 m
// under. Driving past that is "lots of terrain clipping".
//
// Heights are no longer baked (they stand on the ground now), so the thing
// that can still drift is WHERE they are. If this fails the fix is one line:
//   node tools/layout.mjs --walls
{
  const { OBJECTS } = await import('../data/build/objects.js');
  // --break pretends the track moved under the file, which is the only way
  // this ever goes wrong and so the only thing worth proving it can see.
  const SHIFT = BREAK ? 6 : 0;
  const line = [];
  for (let i = 0; i < path.n; i++) {
    if (path.tunIn && path.tunIn[i] > 0) continue;
    if (path.briIn && path.briIn[i] > 0) continue;
    for (const side of [1, -1]) {
      const off = path.w[i] + (side > 0 ? path.runL[i] : path.runR[i]) + SHIFT;
      const q = pointAt(path, i, side * off);
      line.push([q.x, q.y]);
    }
  }
  let adrift = 0, worst = 0, at = null;
  for (const o of OBJECTS) {
    const [x, y] = o.at;
    let bd = Infinity;
    for (const [lx, ly] of line) { const d = (lx - x) ** 2 + (ly - y) ** 2; if (d < bd) bd = d; }
    const d = Math.sqrt(bd);
    if (d > 3) { adrift++; if (d > worst) { worst = d; at = { x, y, d }; } }
  }
  const pct = (100 * adrift / OBJECTS.length).toFixed(1);
  (adrift <= OBJECTS.length * 0.02 ? ok : fail)(
    `${OBJECTS.length} world objects sit on the current barrier line` +
    (adrift ? ` — except ${adrift} (${pct}%), worst ${worst.toFixed(1)} m out${at ? ` at ${at.x.toFixed(0)},${at.y.toFixed(0)}` : ''}; re-run tools/layout.mjs --walls` : ''));

  // And they must not stand inside, or above, the terrain that is DRAWN.
  let bad = 0, wz = 0;
  for (const o of OBJECTS) {
    const [x, y] = o.at;
    const tz = terrainAt(x, y);
    if (tz === null) continue;
    const d = Math.abs((o.z ?? ground.height(x, y)) - tz);
    if (d > 1.5) { bad++; if (d > wz) wz = d; }
  }
  (bad === 0 ? ok : fail)(`world objects stand on the drawn ground` + (bad ? ` — ${bad} off by up to ${wz.toFixed(1)} m` : ''));
}

console.log(fails ? `\n${fails} FAILED${BREAK ? '  (expected: --break is meant to fail)' : ''}` : '\nall good');
process.exit(fails ? 1 : 0);
