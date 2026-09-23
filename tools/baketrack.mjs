// baketrack.mjs — put the hand-built track into the GAME.
//
//   node tools/baketrack.mjs [key]        (default: test)
//
// Adam: "let me enter the test map??? in chasing wdc". The builder has been
// able to drive the megatrack since the day it existed, but only on build.html
// — the race game loads circuits from data/tracks/*.json, which are surveyed
// OSM circuits, and the built track was not one of them. This writes one.
//
// Everything the game needs is already in the path; the work is in the three
// things the survey gives a real circuit for free:
//
//   CORNERS. A real track file names them. This derives them from curvature
//   runs and names them from the PIECES — Adam's own `part:` names, which is
//   why the game's timing tower can say "Downhill esses" instead of "Turn 3".
//   The numbering is sequential because his series wants to say "turn 4".
//
//   DRS. Every straight over half a kilometre gets a zone, with detection
//   175 m before it, which is what the real ones do.
//
//   ELEVATION. The game keeps height in data/elev/<key>.json, separate from
//   the track, because for the real circuits it comes from a different survey.
//   The built track knows its own heights exactly, so they are written
//   straight out: per-sample along the line, and a 32x32 grid of the land
//   around it sampled from the same Ground the builder draws.
//
// The pit lane is null. The track has no pit lane yet, race.js already guards
// for that (`track.pit || {}`), and inventing one would put a fake building
// somewhere Adam did not put one.
import fs from 'fs';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
const KEY = args.find(a => !a.startsWith('--')) || 'test';
// --pieces=data/build/kate.js bakes a track other than the test map's.
let PIECE_FILE = 'data/build/pieces.js';
for (const a of args) {
  if (a.startsWith('--pieces=')) PIECE_FILE = a.slice(9);
  else if (a.startsWith('--')) { console.error(`unknown flag ${a}`); process.exit(2); }
}

const { buildPath } = await import(ROOT + 'js/build/path.js');
const { Ground } = await import(ROOT + 'js/build/ground.js');
const { TRACK, PIECES } = await import(ROOT + PIECE_FILE);

const p = buildPath(PIECES, { closed: !!TRACK.closed });
const ground = new Ground(p);
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

// --- which named section each sample belongs to -----------------------------
const partAt = new Array(p.n).fill('');
{
  let part = '';
  for (const piece of p.pieces) {
    if (piece.part) part = piece.part;
    const i0 = Math.floor(piece.s0 / p.ds), i1 = Math.min(p.n - 1, Math.ceil(piece.s1 / p.ds));
    for (let i = i0; i <= i1; i++) partAt[i] = part;
  }
}

// --- corners: runs of curvature, named by the section they are in -----------
//
// The threshold is the same one the builder uses to decide where to lay a
// kerb, so a corner in the timing tower is a corner with a kerb on it.
const TURN = 1 / 220;
const corners = [];
{
  let run = null;
  const close = () => {
    if (!run) return;
    const len = (run.i1 - run.i0 + 1) * p.ds;
    // A few metres of curvature is a kink, not a corner.
    if (len >= 18) {
      let turn = 0, kMax = 0, iMax = run.i0;
      for (let i = run.i0; i <= run.i1; i++) {
        turn += Math.abs(p.k[i]) * p.ds;
        if (Math.abs(p.k[i]) > kMax) { kMax = Math.abs(p.k[i]); iMax = i; }
      }
      corners.push({
        n: corners.length + 1, num: corners.length + 1,
        name: partAt[iMax] || TRACK.name || 'Corner',
        s0: run.i0 * p.ds, s1: run.i1 * p.ds, s: iMax * p.ds,
        R: Math.round(1 / kMax), dir: run.dir, turn: Math.round(turn * 180 / Math.PI),
      });
    }
    run = null;
  };
  for (let i = 0; i < p.n; i++) {
    const k = p.k[i];
    const dir = Math.sign(k);
    if (Math.abs(k) > TURN) {
      // A corner that changes direction is two corners, however smoothly the
      // esses run into each other.
      if (run && run.dir !== dir) close();
      if (!run) run = { i0: i, i1: i, dir };
      run.i1 = i;
    } else if (run && (i - run.i1) * p.ds > 25) close();
  }
  close();
}

// --- DRS: anything straight for more than half a kilometre ------------------
const drs = [];
{
  // A CLOSED lap has no beginning: the straight through the start line is one
  // straight, not the end of one and the start of another. So the scan starts
  // at the first corner and walks one full lap from there — otherwise the run
  // up to the line and the start straight are counted as two short pieces and
  // the most important DRS zone on the lap is cut in half (Kate Mascoi: 968 m
  // of a 1.4 km straight). An open track starts at 0 exactly as before.
  const n = p.n, wrap = !!TRACK.closed;
  let i0 = 0;
  if (wrap) while (i0 < n && Math.abs(p.k[i0]) <= TURN) i0++;
  if (i0 >= n) i0 = 0;
  let from = i0;
  const last = wrap ? i0 + n : n;
  for (let j = i0 + 1; j <= last; j++) {
    const i = j % n;
    const straight = j < last && Math.abs(p.k[i]) <= TURN;
    if (straight) continue;
    const len = (j - from) * p.ds;
    if (len > 500) {
      const start = ((from + 12) * p.ds) % p.length, end = ((j - 8) * p.ds) % p.length;
      drs.push({ from: Math.round(start), to: Math.round(end),
        detect: Math.round((start - 175 + p.length) % p.length), len: Math.round((j - 8 - from - 12) * p.ds) });
    }
    from = j + 1;
  }
}

// --- the track file ---------------------------------------------------------
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (let i = 0; i < p.n; i++) {
  x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]);
  y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]);
}
const arr = (a, n = 2) => Array.from(a, v => round(v, n));

const track = {
  key: KEY,
  name: TRACK.name && TRACK.name !== 'UNTITLED' ? TRACK.name : 'THE TEST MAP',
  full: TRACK.full || 'The hand-built megatrack',
  country: TRACK.country || 'XANBOO78O',
  aiPace: TRACK.aiPace || 0.8,
  length: round(p.length, 1),
  ds: p.ds,
  wall: 'armco',
  // It crosses itself — the loop, and the snail. Track.project searches around
  // a hint for exactly this reason, and saying so is what stops a lap counting
  // twice where the road passes over itself.
  crossover: true,
  // Not a loop yet. js/track.js and js/grid.js both read this: without it the
  // ends of the path get joined to each other and the grid is placed behind a
  // start line with nothing behind it.
  open: !TRACK.closed,
  bbox: { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) },
  x: arr(p.x), y: arr(p.y), w: arr(p.w), bank: arr(p.bank, 2),
  runL: arr(p.runL), runR: arr(p.runR),
  // The racing line is SOLVED at load by js/line.js, per car, so a baked one
  // would only be a stale copy of it.
  line: new Array(p.n).fill(0),
  corners, drs, pit: null,
  sponsors: ['XB STUDIOS', 'FOGLAST', 'CRITTERS', 'VROOM', 'XANCOIN', 'ORBIX', 'EVERYDEATH'],
};

// --- the elevation file -----------------------------------------------------
let mean = 0;
for (let i = 0; i < p.n; i++) mean += p.z[i];
mean /= p.n;
const s = Array.from(p.z, v => round(v - mean, 2));

// 32 was what the surveyed circuits use, and at this track's size that is 55 m
// cells — the same trap tools/groundcheck.mjs reports on the real circuits:
// the ground mesh between two grid points is a flat chord, and where the chord
// runs above the road the grass buries the car. It did, on the start line, in
// the first screenshot. The built track knows its own height everywhere, so
// there is no reason to be coarse: 160 cells is ~11 m here, ~0.4 s to sample
// and 400 KB on disk, and the chord error falls with the square of the cell.
const N = 160, pad = 220;
const gx0 = x0 - pad, gy0 = y0 - pad;
const dx = (x1 - x0 + pad * 2) / (N - 1), dy = (y1 - y0 + pad * 2) / (N - 1);
const h = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  h.push(round(ground.height(gx0 + i * dx, gy0 + j * dy) - mean, 2));
}

const elev = {
  key: KEY, dataset: 'hand-built', ds: p.ds,
  note: 'metres relative to the mean height of the built path; RENDERING ONLY, physics is 2D',
  mean: round(mean, 1), range: [round(Math.min(...s), 2), round(Math.max(...s), 2)],
  s, grid: { x0: round(gx0), y0: round(gy0), dx: round(dx, 3), dy: round(dy, 3), n: N, h },
};

// THE RACING LINE. The game solves one only when the file has none, and this
// file always had one — all zeros — so on a hand-built lap every car drove the
// dead centre of the road: widening Kate Mascoi from 26 to 40 m changed the lap
// time by exactly 0.000 s. A closed lap gets the same minimum-curvature line
// the surveyed circuits ship with. (An open stage keeps zeros: the solver wraps
// the ends together.)
if (TRACK.closed) {
  const { Track } = await import(ROOT + 'js/track.js');
  const { racingLine } = await import(ROOT + 'js/line.js');
  // 6000 iterations (the survey bake's default) barely moves off the centre on
  // a 40 m road: this smoother converges like the 4th power of a corner's
  // length in SAMPLES, so 150,000 iterations still only reached -3.9..+1.8 m.
  // So solve COARSE first — every 5th sample, 5^4 = 625x faster to converge —
  // then spread that back to every sample and let the fine solve finish it.
  const tk = new Track(track), C = 5, m = Math.floor(tk.n / C);
  const coarse = { n: m, x: [], y: [], hdg: [], w: [] };
  for (let q = 0; q < m; q++) {
    const i = q * C;
    coarse.x.push(tk.x[i]); coarse.y.push(tk.y[i]); coarse.hdg.push(tk.hdg[i]); coarse.w.push(tk.w[i]);
  }
  const oc = racingLine(coarse, 0.35, 60000);
  const seed = new Float32Array(tk.n);
  for (let i = 0; i < tk.n; i++) {
    const f = i / C, q = Math.floor(f) % m, r = (q + 1) % m, t = f - Math.floor(f);
    seed[i] = oc[q] * (1 - t) + oc[r] * t;
  }
  track.line = Array.from(racingLine(tk, 0.35, 6000, 0.12, seed), v => round(v, 2));
}
fs.writeFileSync(path.join(ROOT, `data/tracks/${KEY}.json`), JSON.stringify(track));
fs.writeFileSync(path.join(ROOT, `data/elev/${KEY}.json`), JSON.stringify(elev));

const kb = f => Math.round(fs.statSync(path.join(ROOT, f)).size / 1024);
console.log(`${track.name}  (${KEY})`);
console.log(`  ${(track.length / 1000).toFixed(2)} km, ${p.n} samples, ${PIECES.length} pieces`);
console.log(`  ${corners.length} corners: ${corners.slice(0, 6).map(c => `${c.num} ${c.name} R${c.R}`).join(', ')}${corners.length > 6 ? ' …' : ''}`);
console.log(`  ${drs.length} DRS zone${drs.length === 1 ? '' : 's'}: ${drs.map(z => `${z.len} m`).join(', ') || 'none'}`);
console.log(`  climbs ${elev.range[0]} to ${elev.range[1]} m about the mean`);
console.log(`  data/tracks/${KEY}.json ${kb(`data/tracks/${KEY}.json`)}K + data/elev/${KEY}.json ${kb(`data/elev/${KEY}.json`)}K`);
console.log(`\n  drive it:  index.html?auto=${KEY}:f1        race it:  ?auto=${KEY}:f1&race=1&grid=12`);
