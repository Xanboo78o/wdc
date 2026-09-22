// trackmap.mjs — a circuit drawn in plan, at its real width, coloured by height.
//
//   node tools/trackmap.mjs street              -> tools/shots/street-map.png
//   node tools/trackmap.mjs street monza        several at once
//   node tools/trackmap.mjs street --out ~/Downloads
//
// Why this exists: a track file is twenty thousand numbers, and the only
// question anyone actually asks of a new one is "what shape is it". The
// character profiler says what a lap ASKS; this says what it LOOKS like, which
// is the half that catches a mirrored import, a corner that folds through
// itself, or a road drawn twice as wide as it should be.
//
// Drawn at REAL WIDTH rather than as a line, which is the point: a 19 m road
// and an 11 m road are the same picture as centrelines and obviously different
// as roads. Height is the colour, because a hand-modelled circuit's elevation
// is usually the reason it was modelled by hand and nothing else shows it.
//
// SVG out, rasterised with ImageMagick if it is there; the .svg is kept either
// way so it can be opened directly.
import fs from 'fs';
import { execFileSync } from 'child_process';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--out', '--help']);
const want = [];
let outDir = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (!KNOWN.has(a)) { console.error(`trackmap: unknown flag ${a}`); process.exit(2); }
    if (a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 20).join('\n')); process.exit(0); }
    if (a === '--out') outDir = argv[++i];
  } else want.push(a);
}
if (!want.length) { console.error('trackmap: name a track (see data/tracks/)'); process.exit(2); }

const root = new URL('../', import.meta.url).pathname;
const dest = outDir ? outDir.replace(/^~/, process.env.HOME) : `${root}tools/shots`;
fs.mkdirSync(dest, { recursive: true });

for (const key of want) {
  let d;
  try { d = JSON.parse(fs.readFileSync(`${root}data/tracks/${key}.json`, 'utf8')); }
  catch { console.error(`trackmap: no data/tracks/${key}.json`); process.exitCode = 1; continue; }

  const { x: X, y: Y, w: W, ds } = d, n = X.length;
  const Z = d.z || null;
  const x0 = Math.min(...X), x1 = Math.max(...X), y0 = Math.min(...Y), y1 = Math.max(...Y);
  // Scale so the long side is 900 px, and leave room for the widest road.
  const maxW = Math.max(...W);
  const SC = 900 / Math.max(x1 - x0, y1 - y0);
  const PAD = Math.max(40, maxW * SC * 1.2);
  const wpx = Math.round((x1 - x0) * SC + 2 * PAD), hpx = Math.round((y1 - y0) * SC + 2 * PAD);
  const px = i => [PAD + (X[i] - x0) * SC, PAD + (y1 - Y[i]) * SC];   // screen Y is down

  const zMin = Z ? Math.min(...Z) : 0, zMax = Z ? Math.max(...Z) : 0;
  const colour = i => {
    if (!Z || zMax - zMin < 0.5) return '#7d8a93';
    const t = (Z[i] - zMin) / (zMax - zMin);
    return `#${Math.round(40 + 200 * t).toString(16).padStart(2, '0')}${Math.round(90 + 110 * t).toString(16).padStart(2, '0')}${Math.round(130 - 90 * t).toString(16).padStart(2, '0')}`;
  };

  const seg = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay] = px(i), [bx, by] = px(j);
    // A closed lap's last segment wraps; an open one must not be joined.
    if (j === 0 && d.open) continue;
    seg.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${colour(i)}" stroke-width="${(W[i] * 2 * SC).toFixed(1)}" stroke-linecap="round"/>`);
  }
  const [sx, sy] = px(0);
  const marks = [`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${Math.max(9, maxW * SC * 0.8).toFixed(0)}" fill="none" stroke="#fff" stroke-width="3"/>`,
    `<text x="${(sx + 18).toFixed(1)}" y="${(sy + 6).toFixed(1)}" fill="#fff" font-family="monospace" font-size="17">START</text>`];
  // Number the corners, so a note about "turn 7" means the same thing to both
  // of us. Same corners the game and the profiler use.
  for (const c of d.corners || []) {
    const i = Math.round(c.s / ds) % n;
    const [mx, my] = px(i);
    marks.push(`<text x="${(mx + 9).toFixed(1)}" y="${(my - 7).toFixed(1)}" fill="#ffd24d" font-family="monospace" font-size="13">${c.n}</text>`);
  }

  const info = `${(d.full || key).toUpperCase()} — ${(n * ds / 1000).toFixed(3)} km · ${(d.corners || []).length} corners · ${(W[0] * 2).toFixed(0)} m wide`
    + (Z ? ` · ${(zMax - zMin).toFixed(1)} m elevation (colour = height)` : '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx}" viewBox="0 0 ${wpx} ${hpx}">
<rect width="100%" height="100%" fill="#12161a"/>
${seg.join('')}
${marks.join('')}
<text x="${PAD}" y="${hpx - 22}" fill="#9aa3ab" font-family="monospace" font-size="15">${info}</text>
</svg>`;

  const svgPath = `${dest}/${key}-map.svg`;
  fs.writeFileSync(svgPath, svg);
  let png = null;
  try {
    png = `${dest}/${key}-map.png`;
    execFileSync('magick', [svgPath, '-resize', '1100x', png], { stdio: 'ignore' });
  } catch { png = null; }
  console.log(`${(d.full || key).padEnd(28)} ${png || svgPath}`);
}
