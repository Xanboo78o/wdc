// foldcheck.mjs — where does the track run inside its own furniture?
//
//   node tools/foldcheck.mjs [track]        (default: test)
//
// Adam, on driving the test map: "barriers in ENTIRLY wrong places, the ground
// starts having panic attacks, the ground just juts up in the middle of the
// track except i can js drive through it".
//
// Those are three symptoms of ONE fact, and this measures it. Everything the
// game draws around a circuit — barriers, boards, tyre walls, the ground
// itself — is placed by LATERAL OFFSET from the centreline, and read back by
// asking which centreline sample is NEAREST. Both of those are only
// well-defined while the track is further from itself than the things standing
// beside it. A surveyed circuit always is. This one is not: the snail's coils
// are 27 m apart and its barriers stand 19 m out, so each coil's barrier is
// planted in its neighbour's road, and a point of ground between them belongs
// to whichever piece of road happens to be nearest — which can be seventeen
// metres higher.
//
// So the number that matters is not "is the ground wrong", it is HOW OFTEN THE
// TRACK IS NEARER TO ITSELF THAN ITS OWN FURNITURE IS WIDE. Fix that and all
// three symptoms go together; patch the symptoms and they come back with the
// next corner.
//
// Pure geometry, no renderer, no browser: it reads the baked track.
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
const KEY = args[0] || 'test';
if (args.length > 1) { console.error('usage: foldcheck.mjs [track]'); process.exit(2); }

const t = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${KEY}.json`, 'utf8'));
const n = t.x.length, ds = t.ds;
// HEIGHT MATTERS, and leaving it out makes this tool lie. The first run
// reported the road coming within 0.4 m of itself — which is the double loop
// crossing OVER itself on a viaduct, 14 m up. Two pieces of road on top of
// each other in plan are a bridge, and a bridge is correct. A fold is when
// they are close in plan AND at the same height.
let z = null;
try { z = JSON.parse(fs.readFileSync(`${ROOT}data/elev/${KEY}.json`, 'utf8')).s; } catch { /* flat */ }
const SAME_LEVEL = 6;          // m of height difference below which it is a fold
// Far enough along the track that being close is a FOLD and not just the road
// being continuous with itself.
const APART = Math.round(120 / ds);

const hdg = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  hdg[i] = Math.atan2(t.y[b] - t.y[a], t.x[b] - t.x[a]);
}

// Nearest sample that is NOT part of this stretch of road.
function nearestElsewhere(x, y, i) {
  let bd = Infinity, bj = -1;
  for (let j = 0; j < n; j++) {
    if (Math.abs(j - i) < APART) continue;
    if (z && Math.abs(z[j] - z[i]) > SAME_LEVEL) continue;    // a bridge, not a fold
    const dx = t.x[j] - x, dy = t.y[j] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; bj = j; }
  }
  return { d: Math.sqrt(bd), j: bj };
}

let onRoad = 0, tooClose = 0, worst = null;
const gap = [];
const hits = [];
for (let i = 0; i < n; i++) {
  const w = t.w[i], runL = t.runL[i], runR = t.runR[i];
  const c = Math.cos(hdg[i]), s = Math.sin(hdg[i]);
  for (const [side, run] of [[1, runL], [-1, runR]]) {
    // where the barrier stands, and where the run-off it protects ends
    const lat = side * (w + run);
    const bx = t.x[i] - s * lat, by = t.y[i] + c * lat;
    const near = nearestElsewhere(bx, by, i);
    if (near.j < 0) continue;
    gap.push(near.d);
    // Standing ON another piece of road is the unambiguous failure: a wall
    // across a road you have to drive down.
    if (near.d < t.w[near.j]) {
      onRoad++;
      hits.push({ s: i * ds, side: side > 0 ? 'L' : 'R', d: near.d, at: near.j * ds });
    } else if (near.d < t.w[near.j] + 6) tooClose++;
    if (!worst || near.d < worst.d) worst = { s: i * ds, side: side > 0 ? 'L' : 'R', d: near.d, at: near.j * ds };
  }
}

// How close the ROAD comes to itself, which is what decides whether "nearest
// centreline sample" can mean anything.
let closest = null;
for (let i = 0; i < n; i += 2) {
  const near = nearestElsewhere(t.x[i], t.y[i], i);
  if (near.j < 0) continue;
  if (!closest || near.d < closest.d) closest = { s: i * ds, d: near.d, at: near.j * ds };
}

// THE OTHER HALF, and the one that breaks the GROUND rather than the
// barriers: two pieces of road close in plan but at DIFFERENT heights. A
// bridge is fine for a car, because a car drives on the road — but the ground
// is drawn by asking which centreline sample is nearest, so a point beside a
// hairpin that dives thirty metres gets the height of whichever of the two
// passes is nearer, and steps by the difference between them. That is the
// "ground juts up in the middle of the track" and the flicker where the two
// are equidistant.
const steps = [];
if (z) {
  for (let i = 0; i < n; i += 2) {
    const reach = t.w[i] + Math.max(t.runL[i], t.runR[i]);
    for (let j = 0; j < n; j++) {
      if (Math.abs(j - i) < APART) continue;
      const dz = Math.abs(z[j] - z[i]);
      if (dz <= SAME_LEVEL) continue;
      const dx = t.x[j] - t.x[i], dy = t.y[j] - t.y[i];
      if (dx * dx + dy * dy > reach * reach) continue;
      steps.push({ s: i * ds, at: j * ds, plan: Math.sqrt(dx * dx + dy * dy), dz });
      break;
    }
  }
}

gap.sort((a, b) => a - b);
const pct = p => gap[Math.min(gap.length - 1, Math.floor(gap.length * p))].toFixed(1);

console.log(`\n${t.name || KEY} — ${(t.length / 1000).toFixed(2)} km, ${n} samples\n`);
console.log(`ROAD TO ITSELF     closest ${closest.d.toFixed(1)} m AT THE SAME HEIGHT, s=${closest.s} against s=${closest.at}`);
console.log(`                   (crossings more than ${SAME_LEVEL} m apart vertically are bridges and are ignored)`);
console.log(`BARRIER TO OTHER ROAD   p5 ${pct(0.05)} m   p50 ${pct(0.5)} m   worst ${worst.d.toFixed(1)} m (s=${worst.s}${worst.side} lands on s=${worst.at})`);
console.log(`\n${onRoad} barrier position(s) stand ON another piece of road`);
console.log(`${tooClose} more stand within 6 m of one`);
if (hits.length) {
  console.log('\nworst offenders:');
  for (const h of hits.sort((a, b) => a.d - b.d).slice(0, 10)) {
    console.log(`  s=${String(h.s).padStart(5)}${h.side}  ${h.d.toFixed(1)} m from the centreline of s=${h.at}`);
  }
}

if (steps.length) {
  steps.sort((a, b) => b.dz - a.dz);
  console.log(`\n${steps.length} place(s) where the ground is asked to be two heights at once:`);
  console.log(`another piece of road passes within the run-off but ${SAME_LEVEL}+ m above or below.`);
  for (const p2 of steps.slice(0, 6)) {
    console.log(`  s=${String(p2.s).padStart(5)}  ${p2.plan.toFixed(1)} m away in plan, ${p2.dz.toFixed(1)} m in height (s=${p2.at})`);
  }
  console.log(`worst height disagreement: ${steps[0].dz.toFixed(1)} m — which is what the ground steps by.`);
}

// The verdict is about the MODEL, not about this track.
const need = Math.max(...t.w) + Math.max(...t.runL, ...t.runR);
console.log(`\nFor "nearest centreline sample" to be meaningful the road must stay`);
console.log(`${need.toFixed(0)} m from itself (half-width ${Math.max(...t.w)} + run-off ${Math.max(...t.runL, ...t.runR)}).`);
console.log(closest.d >= need
  ? `It does (${closest.d.toFixed(1)} m). The circuit model fits this track.`
  : `IT DOES NOT — ${closest.d.toFixed(1)} m at s=${closest.s}. Barriers, boards and the ground\naround them are placed and read back by a rule this track breaks, and every\ntight corner added makes it worse. The fix is a model that asks EVERY nearby\nroad rather than the nearest sample — which js/build/ground.js already does.`);
process.exit(onRoad ? 1 : 0);
