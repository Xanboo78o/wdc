// foldlab.mjs — prove the mechanism on data with no survey in it.
//
//   node tools/foldlab.mjs [dz ...]      (default: 0 12 30)
//
// foldcheck (plane geometry over the baked track) and groundcheck (a raycast
// of the rendered scene) agree about which circuits break, which looked like
// independent confirmation and is not: they read the SAME data/tracks and the
// SAME data/elev. A systematic error in the survey would move both the same
// way and the agreement would look just as convincing.
//
// So this makes tracks that no survey ever touched. Each one is the same
// shape — a straight, a 180 degree hairpin tight enough that its two legs sit
// inside the ground model's 55 m blend radius, and a straight back — and they
// differ in ONE number: how much the hairpin climbs. If the ground model is
// breaking because it asks the nearest centreline sample which height to be,
// then the error it makes must scale with the height difference between the
// two legs, and be zero when there is none.
//
// That is a dose-response curve, and it is the difference between "these two
// numbers correlate" and "this is the cause".
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
const DZS = args.length ? args.map(Number) : [0, 12, 30];
for (const d of DZS) if (!Number.isFinite(d)) { console.error(`not a height: ${d}`); process.exit(2); }

const DS = 2, W = 6, RUN = 10, R = 22, LEG = 320;

function build(dz) {
  const x = [], y = [], z = [];
  // out along +x
  for (let s = 0; s < LEG; s += DS) { x.push(s); y.push(0); z.push(0); }
  // 180 degrees of hairpin, climbing dz, turning LEFT so the return leg sits
  // 2R = 44 m away — inside the 55 m the ground model blends over.
  const arc = Math.PI * R;
  for (let a = 0; a < arc; a += DS) {
    const th = a / R;
    x.push(LEG + Math.sin(th) * R);
    y.push(R - Math.cos(th) * R);
    z.push(dz * (a / arc));
  }
  // ...and back, at the new height
  for (let s = 0; s < LEG; s += DS) { x.push(LEG - s); y.push(2 * R); z.push(dz); }
  return { x, y, z };
}

const out = [];
for (const dz of DZS) {
  const key = `fold${dz}`;
  const { x, y, z } = build(dz);
  const n = x.length;
  const bb = { x0: Math.min(...x), y0: Math.min(...y), x1: Math.max(...x), y1: Math.max(...y) };
  const track = {
    key, name: `Fold lab ${dz} m`, full: `A hairpin whose legs differ by ${dz} m`,
    country: 'LAB', aiPace: 0.8, length: n * DS, ds: DS, wall: 'armco',
    crossover: false, open: true,
    bbox: { x0: Math.round(bb.x0), y0: Math.round(bb.y0), x1: Math.round(bb.x1), y1: Math.round(bb.y1) },
    x: x.map(v => +v.toFixed(2)), y: y.map(v => +v.toFixed(2)),
    w: new Array(n).fill(W), bank: new Array(n).fill(0),
    runL: new Array(n).fill(RUN), runR: new Array(n).fill(RUN),
    line: new Array(n).fill(0), corners: [], drs: [], pit: null, sponsors: ['LAB'],
  };
  let mean = 0; for (const v of z) mean += v; mean /= n;
  const s = z.map(v => +(v - mean).toFixed(2));
  // A grid fine enough that IT is not the error under test: 8 m cells.
  const pad = 120, N = 96;
  const gx0 = bb.x0 - pad, gy0 = bb.y0 - pad;
  const dx = (bb.x1 - bb.x0 + pad * 2) / (N - 1), dy = (bb.y1 - bb.y0 + pad * 2) / (N - 1);
  const h = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // The land is whatever the NEAREST piece of road says, minus a verge —
    // deliberately the same rule the renderer uses, so the grid cannot be
    // blamed for the result.
    const px = gx0 + i * dx, py = gy0 + j * dy;
    let bd = Infinity, bz = 0;
    for (let k = 0; k < n; k += 2) {
      const ex = x[k] - px, ey = y[k] - py;
      const d = ex * ex + ey * ey;
      if (d < bd) { bd = d; bz = z[k]; }
    }
    h.push(+(bz - mean - 0.4).toFixed(2));
  }
  fs.writeFileSync(`${ROOT}data/tracks/${key}.json`, JSON.stringify(track));
  fs.writeFileSync(`${ROOT}data/elev/${key}.json`, JSON.stringify({
    key, dataset: 'fold-lab', ds: DS, mean: +mean.toFixed(2),
    note: 'synthetic; no survey involved',
    range: [Math.min(...s), Math.max(...s)], s,
    grid: { x0: +gx0.toFixed(1), y0: +gy0.toFixed(1), dx: +dx.toFixed(3), dy: +dy.toFixed(3), n: N, h },
  }));
  out.push({ key, dz, n, legs: 2 * R });
}

console.log('built, all identical apart from the climb:\n');
for (const o of out) console.log(`  ${o.key.padEnd(8)} ${String(o.dz).padStart(3)} m climb, legs ${o.legs} m apart, ${o.n} samples`);
console.log(`\n  node tools/foldcheck.mjs ${out[0].key}`);
console.log(`  node tools/groundcheck.mjs --tracks ${out.map(o => o.key).join(',')}`);
