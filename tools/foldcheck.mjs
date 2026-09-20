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
//
// ON A CLOSED CIRCUIT THAT DISTANCE WRAPS, and leaving that out made this tool
// cry wolf on every real track: it reported Monza, Monaco, Baku and Zandvoort
// as folding at s=0, always at exactly ds, because s=0 and s=length are the
// same point on a loop and it was measuring the track against its own seam.
// Four different circuits reporting an identical headline is what gave it
// away — the same shape as the bridge bug, and caught the same way.
const APART = Math.round(120 / ds);
const OPEN = !!t.open;
const sep = (i, j) => {
  const d = Math.abs(i - j);
  return OPEN ? d : Math.min(d, n - d);
};

const hdg = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  hdg[i] = Math.atan2(t.y[b] - t.y[a], t.x[b] - t.x[a]);
}

// Nearest sample that is NOT part of this stretch of road.
function nearestElsewhere(x, y, i) {
  let bd = Infinity, bj = -1;
  for (let j = 0; j < n; j++) {
    if (sep(i, j) < APART) continue;
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
      if (sep(i, j) < APART) continue;
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
if (t.crossover) {
  console.log(`                   NOTE: this track is marked crossover — it legitimately crosses`);
  console.log(`                   itself, and data/elev is a survey ALONG THE LINE, so it samples`);
  console.log(`                   the deck and the road beneath it at nearly the same height. One`);
  console.log(`                   of the pairs below is that bridge, not a fold.`);
}
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

// The same thing as a continuous measure, with no threshold in it. A count of
// places over 6 m says nothing about Monaco, whose hairpin folds at 13 m with
// a height difference of a few metres — under the threshold, and still enough
// to put the ground in the wrong place. This is the number that should go to
// zero when the ground stops asking one sample and starts asking every nearby
// road: for each point, how far apart in HEIGHT are the pieces of road that
// are entitled to an opinion about it.
if (z) {
  // THE RADIUS HAS TO BE THE MODEL'S, NOT THE TRACK'S. Measured over the
  // run-off, Monaco reported 0.00 m and looked clean — but Monaco's run-off is
  // two metres of street, so nothing else was ever inside it. js/world.js
  // blends the track's own profile into the grid over NEAR = 55 m and draws
  // the ground in 26 m cells, so 55 m is the distance at which another piece
  // of road is entitled to an opinion about this one's ground.
  const NEAR = 55;
  const spread = [];
  for (let i = 0; i < n; i += 2) {
    const reach = Math.max(t.w[i] + Math.max(t.runL[i], t.runR[i]), NEAR);
    let hi = 0;
    for (let j = 0; j < n; j++) {
      if (sep(i, j) < APART) continue;
      const dx = t.x[j] - t.x[i], dy = t.y[j] - t.y[i];
      if (dx * dx + dy * dy > reach * reach) continue;
      hi = Math.max(hi, Math.abs(z[j] - z[i]));
    }
    spread.push(hi);
  }
  spread.sort((a, b) => a - b);
  const at = f => spread[Math.min(spread.length - 1, Math.floor(spread.length * f))].toFixed(2);
  const bad = spread.filter(v => v > 0.5).length;
  console.log(`\nHEIGHT DISAGREEMENT within the run-off (0 is a track the ground model can serve)`);
  console.log(`  p50 ${at(0.5)} m   p95 ${at(0.95)} m   worst ${at(1)} m   over 0.5 m at ${bad} of ${spread.length} points`);
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
