// envmap.mjs — draw the baked world as ASCII, so a projection or handedness
// mistake is visible in one look instead of hiding behind plausible numbers.
// Small distances alone cannot prove alignment: in a dense city a mirrored
// world still puts buildings near the track. A picture can.
//
//   node tools/envmap.mjs [track] [width]
import fs from 'fs';
const root = new URL('../', import.meta.url).pathname;
const key = process.argv[2] || 'monaco';
const W = +(process.argv[3] || 150);

const env = JSON.parse(fs.readFileSync(`${root}data/env/${key}.json`, 'utf8'));
const trk = JSON.parse(fs.readFileSync(`${root}data/tracks/${key}.json`, 'utf8'));
const b = env.bbox;
const H = Math.max(20, Math.round(W * ((b.y1 - b.y0) / (b.x1 - b.x0)) * 0.5));
const g = Array.from({ length: H }, () => new Array(W).fill(' '));
const px = x => Math.round((x - b.x0) / (b.x1 - b.x0) * (W - 1));
// y is flipped for display only: north should be up on a printed map.
const py = y => Math.round((b.y1 - y) / (b.y1 - b.y0) * (H - 1));
const put = (x, y, ch) => { const i = px(x), j = py(y); if (i >= 0 && i < W && j >= 0 && j < H) g[j][i] = ch; };

const GLYPH = { water: '~', forest: 'T', scrub: 'v', sand: ':', rock: '^', grass: ',', park: ',', farm: '-', pitch: '=', urban: '.', bare: '`' };
// fill polygons crudely by scanline — enough to read as a map
for (const a of env.areas) {
  const ch = GLYPH[a.k] || '.';
  const ys = a.p.map(p => p[1]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += (b.y1 - b.y0) / H / 2) {
    const xs = [];
    for (let i = 0; i < a.p.length; i++) {
      const p = a.p[i], q = a.p[(i + 1) % a.p.length];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + (y - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = xs[k]; x <= xs[k + 1]; x += (b.x1 - b.x0) / W / 2) put(x, y, ch);
  }
}
for (const bl of env.buildings) for (const p of bl.p) put(p[0], p[1], '#');
for (let i = 0; i < trk.x.length; i++) put(trk.x[i], trk.y[i], '@');

console.log(`${env.full}  —  ${(b.x1 - b.x0).toFixed(0)}m x ${(b.y1 - b.y0).toFixed(0)}m, north up`);
console.log(`@ track   # building   ~ water   T forest   v scrub   : sand   ^ rock   , grass/park   . urban`);
console.log(g.map(r => r.join('')).join('\n'));
