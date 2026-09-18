// gettex.mjs — fetch the real CC0 PBR material sets this sim paints with.
//
//   node tools/gettex.mjs [name|all] [--force]
//
// Every texture in data/tex/ is photoscanned CC0 from ambientCG. None of it is
// procedurally generated, for the same reason the sounds elsewhere aren't:
// synthesised surfaces measure clean and still read as fake, and real asphalt
// carries aggregate, patching and tyre rubber that noise approximates badly.
// ambientCG is CC0 1.0 — no attribution required, commercial-safe, which
// matters because this ships on public GitHub Pages.
//
// What lands on disk per material is THREE files, not six:
//
//   <name>-c.jpg    colour / albedo            (sRGB)
//   <name>-n.jpg    tangent-space normal, GL   (linear)
//   <name>-orm.jpg  AO in R, roughness in G, metalness in B  (linear)
//
// The ORM packing is the glTF convention and three.js reads it natively: point
// aoMap, roughnessMap and metalnessMap at the same texture and it takes R, G
// and B respectively. Three maps instead of five halves the bytes and, more to
// the point, halves the texture units a material burns.
//
// The 1K-JPG download is ~10 MB per material because it carries displacement
// and both normal conventions. None of that is shipped; it stays in the
// scratch directory and only the three maps above reach the repo.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'data/tex/';
const CACHE = path.join(os.tmpdir(), 'wdc-tex-cache');
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';

// Picked by what the surface actually IS, not by what looks nice in isolation.
// `res` is the colour map's resolution: the tarmac is 30 cm from the camera at
// 300 km/h and everything else is scenery, so only the tarmac earns 1024.
const SETS = {
  // Asphalt033 was the first choice and it was wrong: measured, its colour map
  // has a standard deviation of 4/255 — it is almost a flat grey, with all its
  // detail in the normal map. Under soft sky light that reads as painted
  // cardboard, and the whole point of texturing the road was to give the eye
  // something to measure speed against. Asphalt016 measures 15/255 at the same
  // brightness: real, visible aggregate.
  tarmac:   { id: 'Asphalt016',        res: 1024, why: 'the racing surface — dark asphalt with visible aggregate' },
  apron:    { id: 'Asphalt031',        res: 512,  why: 'lighter asphalt: modern run-off and the pit apron' },
  gravel:   { id: 'Gravel023',         res: 512,  why: 'Monza/Suzuka gravel traps — light pebbles, not dirt' },
  grass:    { id: 'Grass005',          res: 512,  why: 'mown trackside grass, not meadow' },
  sand:     { id: 'Ground093A',        res: 512,  why: 'Zandvoort dunes' },
  concrete: { id: 'Concrete048',       res: 512,  why: 'barriers, garage walls, pit apron' },
  brick:    { id: 'Bricks101',         res: 512,  why: 'north-European facades (Zandvoort, Monza town)' },
  plaster:  { id: 'PaintedPlaster017', res: 512,  why: 'painted render — Monaco, Baku; takes a tint well' },
  metal:    { id: 'MetalPlates014',    res: 512,  why: 'armco, garage doors, debris fence posts' },
  fence:    { id: 'Fence003',          res: 512,  why: 'the debris fence — wire mesh, with a real opacity map' },
};

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

async function jsonGet(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.json();
}

// ambientCG serves downloads from a deterministic URL, so ask for the file
// directly instead of going through the search API. The API's `q=` is a fuzzy
// text search sorted by popularity — querying it for the exact string
// "Asphalt031" came back with four other asphalts and not that one, which
// looked exactly like the asset not existing. It exists.
const zipUrlFor = assetId => `https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`;

async function fetchZip(assetId, force) {
  fs.mkdirSync(CACHE, { recursive: true });
  const zip = path.join(CACHE, `${assetId}_1K-JPG.zip`);
  if (!force && fs.existsSync(zip) && fs.statSync(zip).size > 100000) return zip;
  const res = await fetch(zipUrlFor(assetId), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} downloading ${assetId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A wrong asset id answers 200 with an HTML error page, not a 404, so check
  // for the zip magic rather than trusting the status line.
  if (buf.length < 100000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(`ambientCG did not return a zip for ${assetId} — check the asset id at https://ambientcg.com/view?id=${assetId}`);
  }
  fs.writeFileSync(zip, buf);
  return zip;
}

// The zip's member names vary a little between assets (some carry Metalness,
// some do not; a few name the colour map "Color" and a few "Albedo"), so match
// on the suffix rather than assuming a filename.
function pick(dir, ...suffixes) {
  const files = fs.readdirSync(dir);
  for (const s of suffixes) {
    const hit = files.find(f => f.toLowerCase().endsWith(`-${s.toLowerCase()}.jpg`) ||
                                f.toLowerCase().endsWith(`_${s.toLowerCase()}.jpg`));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

function build(name, spec, force) {
  const work = path.join(CACHE, spec.id);
  const color = pick(work, 'Color', 'Albedo');
  // NormalGL, never NormalDX: three.js reads green-up tangent normals, and the
  // DX convention has green inverted. Using the wrong one does not fail, it
  // just lights every bump from the wrong side, which is nearly invisible on a
  // still frame and obvious the moment the sun moves.
  const normal = pick(work, 'NormalGL', 'Normal');
  const rough = pick(work, 'Roughness');
  const ao = pick(work, 'AmbientOcclusion', 'AO');
  const metal = pick(work, 'Metalness', 'Metallic');
  // A mesh material carries its holes in an opacity map. Without it a debris
  // fence is a solid grey slab across the view, which is worse than no fence.
  const opacity = pick(work, 'Opacity', 'Alpha');
  if (!color) throw new Error(`${spec.id}: no colour map in the zip`);

  fs.mkdirSync(OUT, { recursive: true });
  const cOut = `${OUT}${name}-c.jpg`, nOut = `${OUT}${name}-n.jpg`, oOut = `${OUT}${name}-orm.jpg`;
  const aOut = `${OUT}${name}-a.jpg`;

  sh('magick', [color, '-resize', `${spec.res}x${spec.res}`, '-quality', '80',
    '-sampling-factor', '4:2:0', '-strip', cOut]);

  if (normal) {
    // A normal map is not a picture: chroma subsampling on it produces visible
    // banding in the lighting, so this one keeps full chroma even though the
    // file is bigger for it.
    sh('magick', [normal, '-resize', '512x512', '-quality', '86',
      '-sampling-factor', '1:1:1', '-strip', nOut]);
  }

  // ORM: R = ambient occlusion, G = roughness, B = metalness. Missing channels
  // get a constant — a fully rough, non-metal, unoccluded surface — so every
  // material ends up with the same three files whatever the source had.
  const tmp = path.join(CACHE, `${name}-orm-src`);
  fs.mkdirSync(tmp, { recursive: true });
  const chan = (src, fallback, file) => {
    const out = path.join(tmp, file);
    if (src) sh('magick', [src, '-resize', '512x512', '-colorspace', 'Gray', out]);
    else sh('magick', ['-size', '512x512', `xc:gray(${fallback})`, '-colorspace', 'Gray', out]);
    return out;
  };
  const r = chan(ao, 255, 'r.png');
  const g = chan(rough, 220, 'g.png');
  const b = chan(metal, 0, 'b.png');
  sh('magick', [r, g, b, '-channel', 'RGB', '-combine', '-colorspace', 'sRGB',
    '-quality', '82', '-strip', oOut]);

  if (opacity) sh('magick', [opacity, '-resize', '512x512', '-colorspace', 'Gray',
    '-quality', '88', '-strip', aOut]);

  const kb = f => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) : 0;
  const alpha = kb(aOut) ? `  a ${kb(aOut)}K` : '';
  console.log(`  ${name.padEnd(9)} ${spec.id.padEnd(18)} c ${String(kb(cOut)).padStart(4)}K  n ${String(kb(nOut)).padStart(4)}K  orm ${String(kb(oOut)).padStart(4)}K${alpha}   ${spec.why}`);
  return kb(cOut) + kb(nOut) + kb(oOut) + kb(aOut);
}

// ---------------------------------------------------------------------------
const want = (process.argv[2] && process.argv[2] !== 'all') ? [process.argv[2]] : Object.keys(SETS);
const force = process.argv.includes('--force');

let total = 0;
for (const name of want) {
  const spec = SETS[name];
  if (!spec) { console.error(`no material called ${name} — have: ${Object.keys(SETS).join(', ')}`); process.exit(1); }
  process.stdout.write(`${name} (${spec.id})… `);
  const zip = await fetchZip(spec.id, force);
  const work = path.join(CACHE, spec.id);
  fs.mkdirSync(work, { recursive: true });
  sh('unzip', ['-o', '-q', zip, '-d', work]);
  process.stdout.write('\r');
  total += build(name, spec, force);
}

// The licence travels with the files, because a repo that ships textures with
// no provenance is a repo that cannot be published.
fs.writeFileSync(OUT + 'SOURCE.md', `# Where these textures came from

Every map in this directory is **CC0 1.0 Universal** (public domain) from
**ambientCG** — https://ambientcg.com. No attribution is required and
commercial use is permitted, which is what makes them safe to ship on public
GitHub Pages. They are photoscanned, not generated.

Refetch or change any of them with \`node tools/gettex.mjs [name|all] [--force]\`.

| file | ambientCG asset | used for |
|---|---|---|
${Object.entries(SETS).map(([n, s]) => `| \`${n}-*.jpg\` | [${s.id}](https://ambientcg.com/view?id=${s.id}) | ${s.why} |`).join('\n')}

Each material is three files, not six:

- \`-c.jpg\` — colour / albedo, sRGB
- \`-n.jpg\` — tangent-space normal, **GL convention** (green up)
- \`-orm.jpg\` — AO in red, roughness in green, metalness in blue, linear
- \`-a.jpg\` — opacity, where the material has holes in it (the debris fence)

That last one is the glTF ORM packing. three.js reads it natively: point
\`aoMap\`, \`roughnessMap\` and \`metalnessMap\` at the same texture and each
takes its own channel.
`);

console.log(`\n${want.length} materials, ${(total / 1024).toFixed(1)} MB shipped in data/tex/`);
console.log(`(downloads cached in ${CACHE} — not in the repo)`);
