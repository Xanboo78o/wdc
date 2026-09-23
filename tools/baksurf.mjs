// baksurf.mjs — what every metre of the circuit is MADE of.
//
//   node tools/baksurf.mjs [track|all]
//
// Adam: *"add height, banking, and material tags to the track"*.
//
// Until now the renderer had one asphalt for the road, ONE run-off material
// for the entire circuit, and a kerb wherever the survey said there was a
// corner. That is wrong in a way you notice without being able to name: Monza
// does not have gravel down the side of the main straight, it has mown grass,
// and gravel only where a car leaving the road would actually land. And a
// hairpin kerb and a fast-corner kerb are not the same object.
//
// This writes a per-sample tag file the renderer paints from, so the rules are
// in ONE place, in data, where they can be read and argued with — rather than
// buried as conditionals inside three different geometry builders.
//
// ---------------------------------------------------------------------------
// WHAT IS DERIVED, AND FROM WHAT
//
// Everything here comes from geometry the survey already knows: the corner
// list, each corner's radius, the run-off width at each sample, and whether
// the circuit is walled or open. Nothing is invented and nothing needs a new
// network call.
//
// What is NOT here, deliberately: asphalt age and resurfacing patches. Real
// circuits are relaid in sections and it changes how they look, but the
// survey does not know where those seams are and I am not going to make them
// up and then have them treated as fact later.
// ---------------------------------------------------------------------------
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;

const LEGEND = {
  run: {
    0: 'gravel — a trap, where a car leaving the road would actually land',
    1: 'asphalt — paved run-off, and everything on a street circuit',
    2: 'grass — a mown verge, which is what lines most straights',
    3: 'concrete — an apron, usually beside a wall',
  },
  kerb: {
    0: 'none',
    1: 'flat — a fast corner, barely raised, meant to be used',
    2: 'standard — the normal red-and-white block',
    3: 'high — a slow corner, aggressive, meant to hurt',
  },
  turf: { 0: 'none', 1: 'astroturf strip outside the kerb' },
};

function bake(key) {
  const t = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8'));
  const n = t.x.length, ds = t.ds;
  const street = t.wall === 'wall';
  const gravelCircuit = t.wall === 'gravel';

  // Which corner, if any, each sample belongs to — and how far through it.
  const corner = new Int16Array(n).fill(-1);
  const through = new Float32Array(n);
  const near = new Uint8Array(n);       // within reach of a corner's run-off
  t.corners.forEach((c, ci) => {
    const len = ((c.s1 - c.s0) + t.length) % t.length || 1;
    for (let s = c.s0; s <= c.s1; s += ds) {
      const i = ((Math.round(s / ds) % n) + n) % n;
      corner[i] = ci;
      through[i] = (((s - c.s0) + t.length) % t.length) / len;
    }
    // A car runs off at the corner, and for a good way past it.
    for (let s = c.s0 - 70; s <= c.s1 + 110; s += ds) {
      near[((Math.round(s / ds) % n) + n) % n] = 1;
    }
  });

  const runL = new Uint8Array(n), runR = new Uint8Array(n);
  const kerb = new Uint8Array(n), turf = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    for (const [arr, w] of [[runL, t.runL[i]], [runR, t.runR[i]]]) {
      if (street) {
        // A city has no gravel traps. Narrow slivers beside a wall are
        // concrete apron; anything wider is paved.
        arr[i] = w < 2.5 ? 3 : 1;
      } else if (w < 4.5) {
        // Too narrow to stop anything — it is a verge, and a verge is grass.
        arr[i] = 2;
      } else if (near[i]) {
        arr[i] = gravelCircuit ? 0 : 1;
      } else {
        // Down a straight, run-off exists but nobody lands on it: mown grass
        // with a paved strip nearest the track.
        arr[i] = w > 11 ? 2 : 1;
      }
    }

    const ci = corner[i];
    if (ci >= 0) {
      const R = t.corners[ci].R || 40;
      // Radius decides the kerb. A hairpin gets something aggressive because
      // the penalty for using it should be real; a fast sweeper gets a flat
      // one because a car is going to put two wheels on it every lap.
      kerb[i] = R < 22 ? 3 : R < 55 ? 2 : 1;
      // Astroturf goes on the EXIT half, which is where cars run wide.
      turf[i] = through[i] > 0.45 ? 1 : 0;
    }
  }

  const count = (a, v) => { let c = 0; for (const x of a) if (x === v) c++; return c; };
  const pct = c => `${(100 * c / (2 * n)).toFixed(0)}%`;   // both sides

  fs.mkdirSync(`${ROOT}data/surf`, { recursive: true });
  fs.writeFileSync(`${ROOT}data/surf/${key}.json`, JSON.stringify({
    key, ds, n,
    note: 'derived from corner geometry and run-off width by tools/baksurf.mjs; rendering only',
    legend: LEGEND,
    runL: Array.from(runL), runR: Array.from(runR),
    kerb: Array.from(kerb), turf: Array.from(turf),
  }));

  const kb = Math.round(fs.statSync(`${ROOT}data/surf/${key}.json`).size / 1024);
  console.log(`  ${key.padEnd(10)} run-off  gravel ${pct(count(runL, 0) + count(runR, 0)) .padStart(4)}` +
    `  asphalt ${pct(count(runL, 1) + count(runR, 1)).padStart(4)}` +
    `  grass ${pct(count(runL, 2) + count(runR, 2)).padStart(4)}` +
    `  concrete ${pct(count(runL, 3) + count(runR, 3)).padStart(4)}` +
    `   kerbs ${pct(n - count(kerb, 0)).padStart(4)} (high ${count(kerb, 3)}, std ${count(kerb, 2)}, flat ${count(kerb, 1)})` +
    `   ${kb} KB`);
}

const want = (process.argv[2] && process.argv[2] !== 'all')
  ? [process.argv[2]] : ['monza', 'zandvoort', 'suzuka', 'baku', 'monaco', 'nurburgring'];
console.log('surface tags:');
for (const k of want) bake(k);
console.log('\ndata/surf/ — re-run after any change to the circuits or their corner lists');
