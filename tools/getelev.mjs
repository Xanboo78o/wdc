// getelev.mjs — how high the ground is, from the same kind of survey the
// circuits themselves came from.
//
//   node tools/getelev.mjs [track|all] [--force]
//
// Every circuit in this sim has been flat since day one, because OpenStreetMap
// ways carry no elevation. Monza barely cares — it is on a plain. Monaco is a
// hillside, Suzuka runs through hill country, and Zandvoort is literally built
// in sand dunes. Drawing all three on a sheet of glass is the single biggest
// remaining lie in the world.
//
// The data is NASA SRTM at 30 m, read through opentopodata.org — free, no key,
// and it reports which dataset answered so the provenance travels with the
// numbers. Two things are sampled:
//
//   the CENTRELINE, every 20 m, which is what the track itself rides on
//   a GRID over the whole world box, which is what everything else sits on
//
// Both, because they answer different questions. A 30 m DEM sampled on a grid
// is far too coarse to carry a racing line over a crest — you need the profile
// along the road. And a profile along the road says nothing about where to put
// a building two hundred metres away.
//
// ---------------------------------------------------------------------------
// THIS IS A RENDERING INPUT ONLY.
//
// js/physics.js is two-dimensional. It has no elevation and no gravity
// component along a slope, so a downhill braking zone is not modelled as one.
// Nothing here feeds back into the simulation, exactly as with banking. If the
// picture and the physics ever disagree, the picture is the one that is lying.
// ---------------------------------------------------------------------------
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const API = 'https://api.opentopodata.org/v1/srtm30m';
const BATCH = 100;               // locations per request, their limit
const GRID = 32;                 // grid resolution across the world box
const STEP = 20;                 // metres between centreline samples

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One request. Retries on the rate limiter rather than giving up, because a
// 429 here is a "wait a second", not a failure.
async function lookup(points) {
  const locs = points.map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}?locations=${locs}`, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const j = await res.json();
      if (j.status === 'OK') return j.results.map(r => ({ h: r.elevation, set: r.dataset }));
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error('opentopodata would not answer');
}

async function lookupAll(points, label) {
  const out = [];
  for (let i = 0; i < points.length; i += BATCH) {
    process.stdout.write(`\r  ${label} ${Math.min(i + BATCH, points.length)}/${points.length}   `);
    out.push(...await lookup(points.slice(i, i + BATCH)));
    await sleep(1100);           // their published rate limit is one a second
  }
  return out;
}

// A 1-2-1 smoother, run a few times. SRTM is quantised to whole metres and
// noisy at 30 m posts; a racing line running over raw samples has a 1 m step
// in it every twenty metres, which reads as corrugation rather than as a hill.
function smooth(a, passes) {
  let v = Float64Array.from(a);
  for (let p = 0; p < passes; p++) {
    const w = Float64Array.from(v);
    for (let i = 0; i < v.length; i++) {
      const l = v[(i - 1 + v.length) % v.length], r = v[(i + 1) % v.length];
      w[i] = (l + 2 * v[i] + r) / 4;
    }
    v = w;
  }
  return v;
}

async function bake(key, force) {
  const out = `${ROOT}data/elev/${key}.json`;
  if (!force && fs.existsSync(out)) { console.log(`  ${key}: already baked`); return; }

  const track = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8'));
  const env = JSON.parse(fs.readFileSync(`${ROOT}data/env/${key}.json`, 'utf8'));
  // The SAME projection the circuit and its surroundings were baked with. Get
  // this wrong and the hill is in the wrong place, which is much worse than no
  // hill at all.
  const { lat0, lon0 } = env;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  const toLL = (x, y) => [lat0 + y / my, lon0 + x / mx];

  console.log(`\n=== ${key} ===`);

  // --- the centreline ------------------------------------------------------
  const n = track.x.length, ds = track.ds;
  const every = Math.max(1, Math.round(STEP / ds));
  const idx = [];
  for (let i = 0; i < n; i += every) idx.push(i);
  const centre = await lookupAll(idx.map(i => toLL(track.x[i], track.y[i])), 'centreline');

  // Spread back over every sample, then smooth.
  const raw = new Float64Array(n);
  for (let k = 0; k < idx.length; k++) {
    const i0 = idx[k], i1 = idx[(k + 1) % idx.length];
    const h0 = centre[k].h, h1 = centre[(k + 1) % idx.length].h;
    const span = (i1 - i0 + n) % n || n;
    for (let d = 0; d < span; d++) {
      const t = d / span;
      raw[(i0 + d) % n] = h0 + (h1 - h0) * (t * t * (3 - 2 * t));
    }
  }
  const prof = smooth(raw, 24);

  // --- the world grid ------------------------------------------------------
  const bb = env.bbox;
  const x0 = bb.x0, y0 = bb.y0;
  const dx = (bb.x1 - bb.x0) / (GRID - 1), dy = (bb.y1 - bb.y0) / (GRID - 1);
  const pts = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) pts.push(toLL(x0 + i * dx, y0 + j * dy));
  }
  const grid = await lookupAll(pts, 'grid      ');

  // --- normalise -----------------------------------------------------------
  // Everything is expressed RELATIVE to the mean height of the racing line, so
  // the circuit sits around y = 0 and none of the existing geometry, camera or
  // shadow bracketing has to move.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += prof[i];
  mean /= n;

  const profOut = Array.from(prof, v => +(v - mean).toFixed(2));
  const gridOut = grid.map(g => +(g.h - mean).toFixed(2));
  const lo = Math.min(...profOut), hi = Math.max(...profOut);

  fs.mkdirSync(`${ROOT}data/elev`, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    key,
    dataset: centre[0].set,
    note: 'metres relative to the mean height of the racing line; RENDERING ONLY, physics is 2D',
    mean: +mean.toFixed(1),
    range: [lo, hi],
    ds,
    s: profOut,
    grid: { x0, y0, dx: +dx.toFixed(3), dy: +dy.toFixed(3), n: GRID, h: gridOut },
  }));

  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`\r  ${key.padEnd(10)} ${centre[0].set}  mean ${mean.toFixed(0)} m  ` +
    `track rises ${(hi - lo).toFixed(1)} m (${lo.toFixed(1)} to ${hi.toFixed(1)})  ${kb} KB`);
}

const want = (process.argv[2] && process.argv[2] !== 'all')
  ? [process.argv[2]] : ['monza', 'zandvoort', 'suzuka', 'baku', 'monaco'];
const force = process.argv.includes('--force');
for (const key of want) await bake(key, force);

fs.writeFileSync(`${ROOT}data/elev/SOURCE.md`, `# Where the heights came from

**NASA SRTM at 30 m**, read through [opentopodata.org](https://www.opentopodata.org/)
— free, no key required, and it reports which dataset answered each point so
the provenance stays with the numbers. SRTM is public domain.

Refetch with \`node tools/getelev.mjs [track|all] [--force]\`.

Each file holds two things, because they answer different questions:

- \`s\` — the height of the racing line at every centreline sample, taken every
  20 m and smoothed. A 30 m grid is far too coarse to carry a car over a crest;
  you need the profile ALONG the road.
- \`grid\` — a 32x32 grid over the whole world box, which is what the ground,
  the buildings and the trees sit on. A profile along the road says nothing
  about where to put a building two hundred metres away.

Both are **metres relative to the mean height of the racing line**, so every
circuit sits around y = 0 and nothing else in the renderer had to move.

## This is a rendering input only

\`js/physics.js\` is two-dimensional. It has no elevation and no gravity
component along a slope, so a downhill braking zone is not simulated as one.
Nothing here feeds back into the simulation, exactly as with banking. If the
picture and the physics disagree, the picture is the one that is lying.
`);
console.log('\ndone — data/elev/');
