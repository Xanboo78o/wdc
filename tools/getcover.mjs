// getcover.mjs — what actually grows round each circuit, from the satellite.
//
//   node tools/getcover.mjs <track|all> [--pad 700]
//
// Adam, 2026-09-28: Monza "doesnt feel NEARLY as forest as it should". It
// didn't, because OpenStreetMap's forest polygons were the only source of
// woods, and inside the Parco di Monza OSM maps one big wood in the north
// loop and a few strips. The rest of the park — the woods either side of the
// back straight, round Serraglio and Ascari — is simply unmapped, and an
// unmapped wood is drawn as a lawn.
//
// So the woods come from a MEASUREMENT of the ground cover instead: ESA
// WorldCover 2021 v200, a 10 m global land-cover map classified from
// Sentinel-1 and Sentinel-2 (CC-BY 4.0, © ESA WorldCover project 2021). It is
// published as Cloud-Optimised GeoTIFFs on a public bucket, so only the few
// 1024x1024 tiles under a circuit are fetched, by HTTP range, and inflated
// here — no GDAL, no key.
//
// Output: data/env/cover/<track>.json — a 10 m raster in the SAME sim
// coordinates as the circuit (same lat0/lon0 projection as bakeenv), classes
// run-length encoded. js/woods.js reads it as "is there a tree here".
//
// WorldCover classes: 10 tree cover, 20 shrubland, 30 grassland, 40 cropland,
// 50 built-up, 60 bare/sparse, 70 snow/ice, 80 water, 90 wetland,
// 95 mangroves, 100 moss/lichen.
import fs from 'fs';
import zlib from 'zlib';

const ROOT = new URL('../', import.meta.url).pathname;
const BUCKET = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const PAD = +flag('pad', 700);    // metres past the env box (trees at the horizon)
const CELL = 10;                   // the survey's own resolution

async function range(url, a, b) {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(60000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1000 * (t + 1)));
  }
  throw new Error(`range ${a}-${b} of ${url} failed`);
}

// Just enough TIFF to read a COG's full-resolution image: the first IFD,
// tile size, and the tile offset / byte-count arrays.
async function openCOG(url) {
  let head = await range(url, 0, 262143);
  const le = head.toString('latin1', 0, 2) === 'II';
  if (!le) throw new Error('big-endian TIFF not handled');
  const u16 = o => head.readUInt16LE(o), u32 = o => head.readUInt32LE(o);
  if (u16(2) !== 42) throw new Error('BigTIFF not handled');
  const off = u32(4), cnt = u16(off);
  const tags = {};
  for (let i = 0; i < cnt; i++) {
    const e = off + 2 + i * 12, tag = u16(e), typ = u16(e + 2), n = u32(e + 4);
    const sz = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 }[typ] || 1;
    tags[tag] = { typ, n, sz, at: n * sz <= 4 ? e + 8 : u32(e + 8) };
  }
  const read = async t => {
    const need = t.at + t.n * t.sz;
    const buf = need <= head.length ? head : await range(url, 0, need + 16);
    if (buf !== head) head = buf;
    const out = [];
    for (let k = 0; k < t.n; k++) {
      const o = t.at + k * t.sz;
      out.push(t.typ === 3 ? buf.readUInt16LE(o) : t.typ === 4 ? buf.readUInt32LE(o) : t.typ === 12 ? buf.readDoubleLE(o) : buf[o]);
    }
    return out;
  };
  const W = (await read(tags[256]))[0], H = (await read(tags[257]))[0];
  const tw = (await read(tags[322]))[0], th = (await read(tags[323]))[0];
  const comp = (await read(tags[259]))[0];
  const offs = await read(tags[324]), lens = await read(tags[325]);
  const scale = await read(tags[33550]), tie = await read(tags[33922]);
  if (comp !== 8 && comp !== 32946) throw new Error(`compression ${comp} not handled (deflate only)`);
  return { url, W, H, tw, th, offs, lens, lon0: tie[3], lat0: tie[4], px: scale[0], py: scale[1], tilesAcross: Math.ceil(W / tw), cache: new Map() };
}

async function tile(cog, tx, ty) {
  const k = ty * cog.tilesAcross + tx;
  if (cog.cache.has(k)) return cog.cache.get(k);
  const buf = await range(cog.url, cog.offs[k], cog.offs[k] + cog.lens[k] - 1);
  const px = zlib.inflateSync(buf);
  cog.cache.set(k, px);
  return px;
}

function tileName(lat, lon) {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3;
  return `ESA_WorldCover_10m_2021_v200_${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}` +
    `${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}_Map.tif`;
}

// Adam's street circuit is his own shape laid over Pembroke, NH, and the town
// was FITTED to it (tools/bakeenv.mjs FITTED: two pins, a similarity —
// scale 1.21 and a rotation). The cover has to be laid down the same way, or
// the woods land beside the houses they grow between. Same pins, same maths.
const FITTED = {
  street: [
    { lat: 43.1662829, lon: -71.4762809, s: 236 },
    { lat: 43.1585268, lon: -71.4688370, s: 6426 },
  ],
};

async function bake(key) {
  const env = JSON.parse(fs.readFileSync(`${ROOT}data/env/${key}.json`, 'utf8'));
  const { lat0, lon0 } = env;
  // The SAME projection as bakeenv/getelev, or the woods land in the wrong place.
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  let back = ([X, Y]) => [X, Y];
  if (FITTED[key]) {
    const track = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8'));
    const local = (lat, lon) => [(lon - lon0) * mx, (lat - lat0) * my];
    const at = s => { const i = Math.round(s / track.ds) % track.x.length; return [track.x[i], track.y[i]]; };
    const [p, q] = FITTED[key].map(pn => local(pn.lat, pn.lon));
    const [P, Q] = FITTED[key].map(pn => at(pn.s));
    const u = [q[0] - p[0], q[1] - p[1]], v = [Q[0] - P[0], Q[1] - P[1]];
    const uu = u[0] * u[0] + u[1] * u[1];
    const a = (u[0] * v[0] + u[1] * v[1]) / uu, b = (u[0] * v[1] - u[1] * v[0]) / uu;
    const tx = P[0] - (a * p[0] - b * p[1]), ty = P[1] - (b * p[0] + a * p[1]), d = a * a + b * b;
    back = ([X, Y]) => { const x = X - tx, y = Y - ty; return [(a * x + b * y) / d, (-b * x + a * y) / d]; };
    console.log(`  fitted: scale ${Math.sqrt(d).toFixed(3)}, rotated ${(Math.atan2(b, a) * 180 / Math.PI).toFixed(1)} deg`);
  }
  const bb = env.bbox;
  const x0 = Math.floor((bb.x0 - PAD) / CELL) * CELL, y0 = Math.floor((bb.y0 - PAD) / CELL) * CELL;
  const nx = Math.ceil((bb.x1 + PAD - x0) / CELL), ny = Math.ceil((bb.y1 + PAD - y0) / CELL);
  const cogs = new Map();
  const cls = new Uint8Array(nx * ny);
  const counts = {};
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const [x, y] = back([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL]);
      const lat = lat0 + y / my, lon = lon0 + x / mx;
      const name = tileName(lat, lon);
      let cog = cogs.get(name);
      if (!cog) { cog = await openCOG(BUCKET + name); cogs.set(name, cog); console.log(`  ${name}  ${cog.W}x${cog.H}`); }
      const c = Math.floor((lon - cog.lon0) / cog.px), r = Math.floor((cog.lat0 - lat) / cog.py);
      const t = await tile(cog, Math.floor(c / cog.tw), Math.floor(r / cog.th));
      const v = t[(r % cog.th) * cog.tw + (c % cog.tw)];
      cls[j * nx + i] = v;
      counts[v] = (counts[v] || 0) + 1;
    }
  }
  // Run-length: "class,count;class,count;..." — woods and fields come in runs.
  const runs = [];
  for (let k = 0; k < cls.length;) {
    let e = k;
    while (e < cls.length && cls[e] === cls[k]) e++;
    runs.push(`${cls[k]},${e - k}`);
    k = e;
  }
  fs.mkdirSync(`${ROOT}data/env/cover`, { recursive: true });
  const out = `${ROOT}data/env/cover/${key}.json`;
  fs.writeFileSync(out, JSON.stringify({
    key, source: 'ESA WorldCover 10m 2021 v200', licence: 'CC-BY 4.0, © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)',
    x0, y0, cell: CELL, nx, ny, rle: runs.join(';'),
  }));
  const tot = cls.length;
  const pct = c => ((counts[c] || 0) / tot * 100).toFixed(1);
  console.log(`  ${key}: ${nx}x${ny} cells of ${CELL} m, trees ${pct(10)}%  shrub ${pct(20)}%  grass ${pct(30)}%  crop ${pct(40)}%  built ${pct(50)}%  water ${pct(80)}%  ` +
    `${cogs.size} file(s), ${[...cogs.values()].reduce((s, c) => s + c.cache.size, 0)} tiles, ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

const all = ['monza', 'suzuka', 'zandvoort', 'monaco', 'baku', 'nurburgring', 'sepang', 'street'];
const want = !args[0] || args[0] === 'all' ? all : [args[0]];
for (const k of want) { console.log(`=== ${k} ===`); await bake(k); }
fs.writeFileSync(`${ROOT}data/env/cover/SOURCE.md`, `# Ground cover

**ESA WorldCover 10 m 2021 v200** — © ESA WorldCover project 2021 / Contains
modified Copernicus Sentinel data (2021) processed by the ESA WorldCover
consortium. Licence: CC-BY 4.0. https://esa-worldcover.org

A 10 m land-cover classification from Sentinel-1 and Sentinel-2, read straight
from the public Cloud-Optimised GeoTIFFs (only the tiles under each circuit).
Re-fetch with \`node tools/getcover.mjs <track|all>\`.

Each file is a raster in the circuit's own sim coordinates (the same projection
as data/env and data/elev): \`x0,y0\` is the south-west corner, \`cell\` metres,
\`nx\` by \`ny\`, rows south to north, classes run-length encoded as
\`class,count;...\`. 10 = tree cover, 20 shrub, 30 grass, 40 crop, 50 built,
60 bare, 80 water, 90 wetland.
`);
