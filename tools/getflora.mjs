// getflora.mjs — fetch the CC0 photoscans the grass and the trees are made of.
//
//   node tools/getflora.mjs [name|all] [--force]
//
// Same rule as tools/gettex.mjs: real scans, never generated. The difference
// is that these are ATLASES — one image holding nine grass blades, or twelve
// leaves, each with a hole-punched opacity map. A blade of grass is not a
// tiling surface, it is a cut-out, and a cut-out has to be MEASURED before it
// can be used: where in the image is blade 4, exactly?
//
// So this tool does three things gettex.mjs does not:
//
//   1. It composites colour and opacity together and floods the transparent
//      area with the mean colour of the opaque area. Left alone, an atlas's
//      dark background bleeds into the leaf through the mip chain and every
//      tree in the distance grows a black halo. (The fringe is invisible at
//      full resolution and obvious at 200 m, which is exactly the distance a
//      forest is normally seen from.)
//
//   2. It finds the cut-outs by connected components on the opacity map and
//      writes their bounding boxes to data/flora/atlas.json as UV rectangles.
//      Nine blades measured, not nine ninths assumed — the blades in
//      Foliage001 are not evenly spaced and two of them lean into each other.
//
//   3. It keeps alpha as PNG. JPEG rings around a hard alpha edge, and an
//      alpha-tested leaf turns that ringing into a torn, sparkly silhouette.
//
// Everything here is CC0 1.0 from ambientCG (https://ambientcg.com), same as
// data/tex/. No attribution required, commercial use fine, safe on Pages.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'data/flora/';
const CACHE = path.join(os.tmpdir(), 'wdc-flora-cache');
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';

// `kind: 'atlas'` = cut-outs, measured and packed with an opacity map.
// `kind: 'surface'` = an ordinary tiling PBR material, packed like data/tex/.
const SETS = {
  grass: {
    id: 'Foliage001', kind: 'atlas', res: 512, thresh: 12,
    why: 'nine real grass blades — the near-field lawn',
  },
  seed: {
    id: 'Foliage002', kind: 'atlas', res: 512, thresh: 10,
    why: 'dried seed heads, so the verge is not one plant repeated',
  },
  needle: {
    id: 'LeafSet019', kind: 'atlas', res: 1024, thresh: 12,
    why: 'fir sprigs — the conifer canopy, a sprig per card',
  },
  leaf: {
    id: 'LeafSet024', kind: 'atlas', res: 1024, thresh: 12,
    why: 'broadleaf leaves, built into branch cards at load',
  },
  bark: {
    id: 'Bark012', kind: 'surface', res: 512,
    why: 'the trunks — deep vertical furrows, warm brown',
  },
  // The land's other two surfaces. data/tex/ has grass and gravel and sand,
  // and sand is Zandvoort's dunes: using it for a cut face turns every
  // embankment on the track into a beach, which is exactly what the first
  // build looked like.
  dirt: {
    id: 'Ground048', kind: 'surface', res: 512,
    why: 'bare earth on a cut face — dark, loose, not sand',
  },
  rock: {
    id: 'Rock030', kind: 'surface', res: 512,
    why: 'anything too steep to hold soil — layered, brown-grey',
  },
};

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const num = (file, expr) => parseFloat(sh('magick', [file, '-format', `%[fx:${expr}]`, 'info:']));

// ambientCG serves a deterministic download URL; the search API is a fuzzy
// text match and answers "Asphalt031" with four other asphalts (gettex.mjs
// learned that one the hard way).
const zipUrl = (id, fmt) => `https://ambientcg.com/get?file=${id}_1K-${fmt}.zip`;

async function fetchZip(id, fmt, force) {
  fs.mkdirSync(CACHE, { recursive: true });
  const zip = path.join(CACHE, `${id}_1K-${fmt}.zip`);
  if (!force && fs.existsSync(zip) && fs.statSync(zip).size > 100000) return zip;
  const res = await fetch(zipUrl(id, fmt), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} downloading ${id}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A wrong id answers 200 with an HTML error page, so check the zip magic
  // rather than the status line.
  if (buf.length < 50000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(`ambientCG did not return a zip for ${id} — check https://ambientcg.com/view?id=${id}`);
  }
  fs.writeFileSync(zip, buf);
  return zip;
}

function pick(dir, ...suffixes) {
  const files = fs.readdirSync(dir);
  for (const s of suffixes) {
    const hit = files.find(f => new RegExp(`[-_]${s}\\.(png|jpg)$`, 'i').test(f));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Where are the cut-outs? Connected components on the opacity map, 8-connected,
// with anything under a thousandth of the image thrown away as dust. Returned
// as UV rectangles (0..1, v measured from the BOTTOM, which is three.js's
// convention and the opposite of the image's).
// ---------------------------------------------------------------------------
function measure(alphaFile, thresh) {
  const W = num(alphaFile, 'w'), H = num(alphaFile, 'h');
  const txt = sh('magick', [alphaFile, '-threshold', `${thresh}%`,
    '-define', 'connected-components:verbose=true',
    '-define', `connected-components:area-threshold=${Math.round(W * H / 1000)}`,
    '-connected-components', '8', 'null:']);
  const items = [];
  for (const line of txt.split('\n')) {
    // "  3: 57x839+37+93 66.4,581.4 21499 gray(255)"
    const m = line.match(/^\s*\d+:\s+(\d+)x(\d+)\+(\d+)\+(\d+)\s+[\d.,]+\s+(\d+)\s+gray\((\d+)\)/);
    if (!m) continue;
    const [w, h, x, y, area, grey] = m.slice(1).map(Number);
    if (grey < 128) continue;                       // the black background component
    if (w >= W * 0.98 && h >= H * 0.98) continue;   // ...or a frame around it
    items.push({ x: x / W, y: 1 - (y + h) / H, w: w / W, h: h / H, fill: area / (w * h) });
  }
  // Left to right, so "blade 0" means the same thing on every re-fetch.
  items.sort((a, b) => a.x - b.x || b.y - a.y);
  return { size: [W, H], items };
}

// ---------------------------------------------------------------------------
function buildAtlas(name, spec) {
  const work = path.join(CACHE, spec.id);
  const color = pick(work, 'Color', 'Albedo');
  const opacity = pick(work, 'Opacity', 'Alpha');
  if (!color || !opacity) throw new Error(`${spec.id}: needs a colour AND an opacity map`);

  const rgba = path.join(work, 'rgba.miff');
  sh('magick', [color, opacity, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', rgba]);

  // The mean colour of the OPAQUE pixels: mean of (colour x alpha) over the
  // mean of alpha. `mean.r` on the RGBA image is NOT that — it averages the
  // colour channel over every pixel, transparent ones included, and those keep
  // whatever colour the photographer's backdrop was. Measured on Foliage001 it
  // reads 0.30 against a true 0.044, so dividing it by the 0.14 mean alpha
  // gave 2.1 and flooded the atlas WHITE. Compositing over black first is what
  // makes the numerator colour x alpha.
  const premul = path.join(work, 'premul.miff');
  sh('magick', [rgba, '-background', 'black', '-alpha', 'remove', '-alpha', 'off', premul]);
  const a = num(rgba, 'mean.a') || 1;
  const ch = c => Math.round(255 * Math.min(1, num(premul, `mean.${c}`) / a));
  const flood = `rgb(${ch('r')},${ch('g')},${ch('b')})`;

  const cOut = `${OUT}${name}-c.jpg`, aOut = `${OUT}${name}-a.png`;
  sh('magick', ['-size', `${num(rgba, 'w')}x${num(rgba, 'h')}`, `xc:${flood}`, rgba,
    '-compose', 'Over', '-composite', '-alpha', 'off',
    '-resize', `${spec.res}x${spec.res}`, '-quality', '88', '-strip', cOut]);
  // 4-bit grey: an opacity map is a stencil, not a photograph, and the file is
  // a third of the size for it.
  sh('magick', [opacity, '-resize', `${spec.res}x${spec.res}`, '-colorspace', 'Gray',
    '-depth', '4', '-strip', aOut]);

  const atlas = measure(opacity, spec.thresh);
  const kb = f => Math.round(fs.statSync(f).size / 1024);
  console.log(`  ${name.padEnd(7)} ${spec.id.padEnd(12)} ${String(atlas.items.length).padStart(2)} cut-outs   c ${String(kb(cOut)).padStart(3)}K  a ${String(kb(aOut)).padStart(3)}K   ${spec.why}`);
  return { atlas, kb: kb(cOut) + kb(aOut) };
}

// An ordinary tiling material, packed exactly like data/tex/ so the same
// loader reads both: colour, GL normal, and AO/roughness/metalness in one RGB.
function buildSurface(name, spec) {
  const work = path.join(CACHE, spec.id);
  const color = pick(work, 'Color', 'Albedo');
  const normal = pick(work, 'NormalGL', 'Normal');
  const rough = pick(work, 'Roughness');
  const ao = pick(work, 'AmbientOcclusion', 'AO');
  if (!color) throw new Error(`${spec.id}: no colour map in the zip`);
  const cOut = `${OUT}${name}-c.jpg`, nOut = `${OUT}${name}-n.jpg`, oOut = `${OUT}${name}-orm.jpg`;
  sh('magick', [color, '-resize', `${spec.res}x${spec.res}`, '-quality', '82',
    '-sampling-factor', '4:2:0', '-strip', cOut]);
  if (normal) sh('magick', [normal, '-resize', `${spec.res}x${spec.res}`, '-quality', '86',
    '-sampling-factor', '1:1:1', '-strip', nOut]);
  const tmp = path.join(work, 'orm'); fs.mkdirSync(tmp, { recursive: true });
  const chan = (src, fallback, file) => {
    const out = path.join(tmp, file);
    if (src) sh('magick', [src, '-resize', `${spec.res}x${spec.res}`, '-colorspace', 'Gray', out]);
    else sh('magick', ['-size', `${spec.res}x${spec.res}`, `xc:gray(${fallback})`, '-colorspace', 'Gray', out]);
    return out;
  };
  sh('magick', [chan(ao, 255, 'r.png'), chan(rough, 225, 'g.png'), chan(null, 0, 'b.png'),
    '-channel', 'RGB', '-combine', '-colorspace', 'sRGB', '-quality', '82', '-strip', oOut]);
  const kb = f => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) : 0;
  console.log(`  ${name.padEnd(7)} ${spec.id.padEnd(12)} tiling      c ${String(kb(cOut)).padStart(3)}K  n ${String(kb(nOut)).padStart(3)}K  orm ${String(kb(oOut)).padStart(3)}K   ${spec.why}`);
  return { kb: kb(cOut) + kb(nOut) + kb(oOut) };
}

// ---------------------------------------------------------------------------
const arg = process.argv.slice(2).filter(a => a !== '--force');
const force = process.argv.includes('--force');
for (const a of arg) if (a !== 'all' && !SETS[a]) {
  console.error(`no flora asset called ${a} — have: ${Object.keys(SETS).join(', ')}`);
  process.exit(1);
}
const want = (arg.length && arg[0] !== 'all') ? arg : Object.keys(SETS);

fs.mkdirSync(OUT, { recursive: true });
const atlasPath = OUT + 'atlas.json';
const atlases = fs.existsSync(atlasPath) ? JSON.parse(fs.readFileSync(atlasPath, 'utf8')) : {};
let total = 0;
for (const name of want) {
  const spec = SETS[name];
  process.stdout.write(`${name} (${spec.id})… `);
  const zip = await fetchZip(spec.id, spec.kind === 'atlas' ? 'PNG' : 'JPG', force);
  const work = path.join(CACHE, spec.id);
  fs.mkdirSync(work, { recursive: true });
  sh('unzip', ['-o', '-q', zip, '-d', work]);
  process.stdout.write('\r');
  const r = spec.kind === 'atlas' ? buildAtlas(name, spec) : buildSurface(name, spec);
  if (r.atlas) atlases[name] = r.atlas;
  total += r.kb;
}
fs.writeFileSync(atlasPath, JSON.stringify(atlases, null, 1));

fs.writeFileSync(OUT + 'SOURCE.md', `# Where the plants came from

Every image in this directory is **CC0 1.0 Universal** (public domain) from
**ambientCG** — https://ambientcg.com — like everything in \`data/tex/\`. They
are photoscans: real blades, real leaves, real bark. Nothing here is generated.

Refetch with \`node tools/getflora.mjs [name|all] [--force]\`.

| files | ambientCG asset | used for |
|---|---|---|
${Object.entries(SETS).map(([n, s]) => `| \`${n}-*\` | [${s.id}](https://ambientcg.com/view?id=${s.id}) | ${s.why} |`).join('\n')}

A cut-out set is two files and a measurement:

- \`<name>-c.jpg\` — colour, with the transparent area flooded with the mean
  colour of the plant so the mip chain cannot bleed a dark halo into it
- \`<name>-a.png\` — opacity; PNG and 4-bit, because JPEG rings around a hard
  alpha edge and an alpha-tested leaf turns that ringing into a torn silhouette
- \`atlas.json\` — the UV rectangle of every cut-out, found by connected
  components on the opacity map rather than assumed to be an even grid

A tiling material (\`bark\`) is the same three files as \`data/tex/\`: colour,
GL normal, and AO/roughness/metalness packed into one RGB image.
`);

console.log(`\n${want.length} assets, ${(total / 1024).toFixed(2)} MB in data/flora/`);
console.log(`(zips cached in ${CACHE} — not in the repo)`);
