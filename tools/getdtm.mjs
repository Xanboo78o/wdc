// getdtm.mjs — bare-earth heights for the circuits tools/bakeosm.mjs makes.
//
//   node tools/getdtm.mjs <key> [--force]
//
// The same job as tools/getelev.mjs (which is a table of the older circuits
// and needs data/env/<key>.json first), for circuits whose projection origin
// is in the track file itself (`geo`). Writes data/elev/<key>.json in exactly
// the schema getelev's bare-earth bake writes.
//
// WHY NOT SRTM: it is a surface model. Round the Nordschleife it would be
// reading the top of the Eifel spruce for 20 km.
//
//   nordschleife  LVermGeo Rheinland-Pfalz DGM1: 1 m lidar terrain model,
//                 open data (dl-de/by-2-0), published as 1 km GeoTIFF tiles
//                 in ETRS89 / UTM 32N. No point-query service answers the
//                 public (geo5.service24.rlp.de is 403), so the tiles under
//                 the lap are downloaded once to ~/.cache/wdc-dgm/rlp (150 MB,
//                 NOT into the repo) and read with ImageMagick.
//   lagunaseca    USGS 3DEP (1 m lidar DEM where surveyed), ImageServer getSamples
//   brandshatch,  Environment Agency LIDAR Composite DTM 1 m, by WCS (two rasters each:
//   silverstone   1 m under the lap, 5 m for the land)
//   bathurst      NSW Spatial Services 5 m DEM (photogrammetric ground model;
//                 the state's lidar is not behind a public point service)
//
// Every height that goes into the bake is cached per point in
// data/elev/raw/<key>-<source>.json, so a re-bake needs neither the tiles nor
// the network.
//
// THE ROAD'S PROFILE. A post under every 2 m sample, taken as the MEDIAN of
// five posts across the road (±3 m): the OSM centreline is good to a couple
// of metres, a 1 m lidar cell next to the armco is already down the bank, and
// one post can sit on a kerb. Then, as getelev: a running median of five
// along the road, bridges laid straight between their abutments, and a
// Gaussian of 10 m.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { metresPerDegree } from './geodesy.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TILEDIR = path.join(os.homedir(), '.cache/wdc-dgm');

async function fetchRetry(url, opt = {}, tries = 7) {
  let wait = 2000;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { ...opt, headers: { 'User-Agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 180000) });
      if (r.ok) return r;
      console.log(`\n    ${r.status} from ${new URL(url).host}, backing off ${wait / 1000}s`);
    } catch (e) { console.log(`\n    ${e.message}, backing off ${wait / 1000}s`); }
    await sleep(wait); wait = Math.min(wait * 1.8, 60000);
  }
  throw new Error('no answer from ' + url.slice(0, 90));
}

// ---- WGS84/ETRS89 -> UTM (Krueger series, good to a millimetre) ---------------
function utm(lat, lon, lon0) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const n = f / (2 - f), A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
  const ph = lat * Math.PI / 180, la = (lon - lon0) * Math.PI / 180;
  const e = Math.sqrt(f * (2 - f));
  const t = Math.sinh(Math.atanh(Math.sin(ph)) - e * Math.atanh(e * Math.sin(ph)));
  const xi = Math.atan2(t, Math.cos(la)), eta = Math.atanh(Math.sin(la) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) { E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return [500000 + k0 * A * E, k0 * A * N + (lat < 0 ? 10000000 : 0)];
}

// ---- 1 km GeoTIFF tiles on disk --------------------------------------------------
// `name(e, n)` -> file name for the tile whose south-west corner is (e, n) km.
function tileSource({ dir, zone, index, urlOf }) {
  const cache = new Map();
  let names = null;
  async function load(e, n) {
    const k = e + '_' + n;
    if (cache.has(k)) return cache.get(k);
    if (!names) names = await index();
    const file = names.get(k);
    let px = null;
    if (file) {
      const local = path.join(dir, file);
      if (!fs.existsSync(local) || fs.statSync(local).size < 1000) {
        fs.mkdirSync(dir, { recursive: true });
        const r = await fetchRetry(urlOf(file));
        fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
        process.stdout.write(`\r    tile ${file}            `);
        await sleep(400);           // one at a time, and not in a hurry
      }
      const raw = execFileSync('magick', [local, '-define', 'quantum:format=floating-point', '-depth', '32', 'gray:-'], { maxBuffer: 64 << 20 });
      if (raw.length !== 4e6) throw new Error(`${file}: expected 1000x1000 float32, got ${raw.length} bytes`);
      px = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    }
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    cache.set(k, px);
    return px;
  }
  // The raster is 1 m cells, cell (col,row) covering E0+col..+1, north down.
  const cell = async (ce, cn) => {
    const px = await load(Math.floor(ce / 1000), Math.floor(cn / 1000));
    if (!px) return null;
    const col = ce - Math.floor(ce / 1000) * 1000, row = 999 - (cn - Math.floor(cn / 1000) * 1000);
    const v = px[row * 1000 + col];
    return Number.isFinite(v) && v > -100 && v < 9000 ? v : null;
  };
  return {
    async many(pts) {
      const out = [];
      for (const [lat, lon] of pts) {
        const [E, N] = utm(lat, lon, zone);
        // bilinear between the four cell centres round the point
        const fe = E - 0.5, fn = N - 0.5, e0 = Math.floor(fe), n0 = Math.floor(fn), te = fe - e0, tn = fn - n0;
        const a = await cell(e0, n0), b = await cell(e0 + 1, n0), c = await cell(e0, n0 + 1), d = await cell(e0 + 1, n0 + 1);
        out.push(a == null || b == null || c == null || d == null ? (a ?? b ?? c ?? d) : (a * (1 - te) + b * te) * (1 - tn) + (c * (1 - te) + d * te) * tn);
      }
      return out;
    },
  };
}

// An ArcGIS ImageServer asked for a batch of points at once.
const imageServer = url => async function many(pts) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: pts.map(([la, lo]) => [lo, la]), spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json',
  });
  const j = await (await fetchRetry(url + '/getSamples', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).json();
  if (!j.samples) throw new Error(new URL(url).host + ': ' + JSON.stringify(j).slice(0, 200));
  const out = new Array(pts.length).fill(null);
  for (const s of j.samples) { const v = parseFloat(s.value); if (Number.isFinite(v) && v > -200 && v < 9000) out[s.locationId] = v; }
  return out;
};

// One float32 raster of the whole neighbourhood, exported once by an ArcGIS
// ImageServer in its own Web-Mercator grid (asking it for points instead took
// 28 s per 90: two hours for Mount Panorama). box = [x0, y0, x1, y1] in
// EPSG:3857, a multiple of `px` on each side.
function exportedRaster({ url, file, box, px }) {
  let img = null;
  const W = (box[2] - box[0]) / px, H = (box[3] - box[1]) / px;
  async function load() {
    if (img) return img;
    if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      console.log(`    exporting ${W}x${H} posts from ${new URL(url).host} (one request; it took 5 minutes)`);
      const r = await fetchRetry(`${url}/exportImage?bbox=${box.join(',')}&size=${W},${H}&bboxSR=3857&imageSR=3857&format=tiff&pixelType=F32&interpolation=RSP_NearestNeighbor&noData=-9999&f=image`, { timeout: 900000 }, 3);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    const raw = execFileSync('magick', [file, '-define', 'quantum:format=floating-point', '-depth', '32', 'gray:-'], { maxBuffer: 256 << 20 });
    if (raw.length !== W * H * 4) throw new Error(`${file}: expected ${W}x${H} float32, got ${raw.length} bytes`);
    return (img = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)));
  }
  return async function many(pts) {
    const a = await load(), R = 6378137;
    const at = (c, r) => { if (c < 0 || r < 0 || c >= W || r >= H) return null; const v = a[r * W + c]; return Number.isFinite(v) && v > -200 && v < 9000 ? v : null; };
    return pts.map(([lat, lon]) => {
      const fx = (lon * Math.PI / 180 * R - box[0]) / px - 0.5, fy = (box[3] - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R) / px - 0.5;
      const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r;
      const p = at(c, r), q = at(c + 1, r), u = at(c, r + 1), v = at(c + 1, r + 1);
      return p == null || q == null || u == null || v == null ? (p ?? q ?? u ?? v) : (p * (1 - tx) + q * tx) * (1 - ty) + (u * (1 - tx) + v * tx) * ty;
    });
  };
}

// GeoTIFFs in latitude/longitude (a WCS asked to reproject for us, so no
// national-grid datum shift is done here), finest first: a point is answered
// by the first raster that has data under it.
function latLonRasters(list) {
  const open = async ({ file, url }) => {
    if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      console.log(`    fetching ${path.basename(file)} from ${new URL(url).host}`);
      fs.writeFileSync(file, Buffer.from(await (await fetchRetry(url, { timeout: 600000 }, 3)).arrayBuffer()));
      await sleep(2000);
    }
    // the two GeoTIFF tags that say where the raster is: ModelPixelScale, ModelTiepoint
    const b = fs.readFileSync(file), le = b.toString('latin1', 0, 2) === 'II';
    const u16 = o => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = o => (le ? b.readUInt32LE(o) : b.readUInt32BE(o)), f64 = o => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));
    const ifd = u32(4), tags = {};
    for (let k = 0; k < u16(ifd); k++) { const e = ifd + 2 + k * 12; tags[u16(e)] = { typ: u16(e + 2), n: u32(e + 4), at: e + 8 }; }
    const val = t => (t.typ === 3 ? u16(t.at) : u32(t.at));
    // (or the one that says both: ModelTransformation, which GeoServer writes)
    const W = val(tags[256]), H = val(tags[257]);
    let px, py, lon0, lat1;
    if (tags[34264]) { const m = u32(tags[34264].at); px = f64(m); py = -f64(m + 40); lon0 = f64(m + 24); lat1 = f64(m + 56); }
    else { const sc = u32(tags[33550].at), tp = u32(tags[33922].at); px = f64(sc); py = f64(sc + 8); lon0 = f64(tp + 24) - f64(tp) * px; lat1 = f64(tp + 32) + f64(tp + 8) * py; }
    const raw = execFileSync('magick', [file, '-define', 'quantum:format=floating-point', '-depth', '32', 'gray:-'], { maxBuffer: 512 << 20 });
    if (raw.length !== W * H * 4) throw new Error(`${file}: expected ${W}x${H} float32`);
    return { W, H, px, py, lon0, lat1, a: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length)) };
  };
  let rs = null;
  return async function many(pts) {
    if (!rs) { rs = []; for (const q of list) rs.push(await open(q)); }
    return pts.map(([lat, lon]) => {
      for (const r of rs) {
        const fx = (lon - r.lon0) / r.px - 0.5, fy = (r.lat1 - lat) / r.py - 0.5, c = Math.floor(fx), w = Math.floor(fy), tx = fx - c, ty = fy - w;
        if (c < 0 || w < 0 || c + 1 >= r.W || w + 1 >= r.H) continue;
        const v = [r.a[w * r.W + c], r.a[w * r.W + c + 1], r.a[(w + 1) * r.W + c], r.a[(w + 1) * r.W + c + 1]];
        if (v.some(q => !Number.isFinite(q) || q < -200 || q > 9000)) continue;
        return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
      }
      return null;
    });
  };
}
const eaWcs = (lat0, lat1, lon0, lon1, scale) => 'https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?service=WCS&version=2.0.1&request=GetCoverage' +
  '&coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m&format=image/tiff' +
  `&subset=${encodeURIComponent(`Lat(${lat0},${lat1})`)}&subset=${encodeURIComponent(`Long(${lon0},${lon1})`)}` +
  '&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&outputCrs=http://www.opengis.net/def/crs/EPSG/0/4326' + (scale ? `&scaleFactor=${scale}` : '');

const SOURCES = {
  ea: {
    dataset: 'ea-lidar-1m',
    name: 'Environment Agency LIDAR Composite DTM 1 m (bare earth), ODN',
    licence: '© Environment Agency copyright and/or database right. Open Government Licence v3.0',
    batch: 4000, pause: 0,
    many: latLonRasters([
      { file: path.join(TILEDIR, 'ea', 'brandshatch-road.tif'), url: eaWcs(51.3518, 51.3616, 0.2560, 0.2692) },          // 1 m, under the lap
      { file: path.join(TILEDIR, 'ea', 'brandshatch-land.tif'), url: eaWcs(51.3460, 51.3674, 0.2470, 0.2782, 0.2) },     // 5 m, the land round it
      { file: path.join(TILEDIR, 'ea', 'silverstone-road.tif'), url: eaWcs(52.0628, 52.0798, -1.0252, -1.0083) },        // 1 m, under the lap
      { file: path.join(TILEDIR, 'ea', 'silverstone-land.tif'), url: eaWcs(52.0572, 52.0852, -1.0342, -0.9994, 0.2) },   // 5 m, the land round it
    ]),
  },
  nsw5m: {
    dataset: 'nsw-5m',
    name: 'NSW Spatial Services 5 m DEM (Bathurst-DEM-AHD_55_5m: ground model derived from stereo aerial imagery, NOT lidar), AHD',
    licence: '© State of New South Wales (Spatial Services), CC-BY 4.0',
    batch: 4000, pause: 0,
    many: exportedRaster({
      url: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer',
      file: path.join(TILEDIR, 'nsw', 'bathurst_16645600_-3958390_16650950_-3952115.tif'),
      box: [16645600, -3958390, 16650950, -3952115], px: 5,
    }),
  },
  rlp: {
    dataset: 'rlp-dgm1',
    name: 'LVermGeo Rheinland-Pfalz DGM1, 1 m airborne-laser terrain model (bare earth), DHHN2016',
    licence: '©GeoBasis-DE / LVermGeoRP, dl-de/by-2-0, www.lvermgeo.rlp.de [data processed]',
    batch: 4000, pause: 0,
    ...tileSource({
      dir: path.join(TILEDIR, 'rlp'), zone: 9,
      urlOf: f => 'https://geobasis-rlp.de/data/dgm1/current/tif/' + f,
      async index() {
        const idx = path.join(TILEDIR, 'rlp', 'tiles.txt');
        if (!fs.existsSync(idx)) {
          fs.mkdirSync(path.dirname(idx), { recursive: true });
          console.log('    fetching the DGM1 tile index (12 MB, once)');
          const txt = await (await fetchRetry('https://geobasis-rlp.de/data/dgm1/current/meta4/dgm1_tif_07.meta4')).text();
          fs.writeFileSync(idx, [...new Set(txt.match(/dgm1_32_\d+_\d+_1_rp_\d+\.tif/g))].join('\n'));
        }
        const m = new Map();
        for (const f of fs.readFileSync(idx, 'utf8').split('\n')) { const q = /dgm1_32_(\d+)_(\d+)_/.exec(f); if (q) m.set(+q[1] + '_' + +q[2], f); }
        return m;
      },
    }),
  },
  threedep: {
    dataset: 'usgs-3dep',
    name: 'USGS 3DEP elevation (1 m lidar DEM where surveyed), bare earth, NAVD88',
    licence: 'U.S. Geological Survey, public domain',
    batch: 90, pause: 700,
    many: imageServer('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'),
  },
};

// key -> source, grid size, and the road's bridges [s0, s1] (the road is ON a
// deck there and a terrain model has the deck taken out; found by this tool's
// own "dips" report and checked against OSM bridge=yes).
const CIRCUIT = {
  // Five decks, each a 6 m notch in the terrain model 30-40 m long: the tunnel
  // under the exit of T13, the bridge at Quiddelbacher Höhe, the Breidscheid
  // bridge over the B257 (the lowest point of the lap), the bridge on the
  // Döttinger Höhe, and the tunnel under the T13 straight.
  nordschleife: { src: 'rlp', grid: 128, bridges: [[102, 146], [1842, 1890], [7944, 7988], [17814, 17858], [20656, 20700]] },
  lagunaseca: { src: 'threedep', grid: 64, bridges: [] },
  brandshatch: { src: 'ea', grid: 64, bridges: [] },
  // An airfield: no deck anywhere on the Grand Prix lap (the vehicle tunnels pass UNDER the road).
  silverstone: { src: 'ea', grid: 64, bridges: [] },
  // 5 m posts off stereo imagery: a longer Gaussian than a lidar model needs
  bathurst: { src: 'nsw5m', grid: 64, bridges: [], sigma: 14 },
};

const USED = new Set();       // every post this bake read: the cache is cut back to these at the end
async function survey(src, points, cacheFile, label) {
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const keyOf = ([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`;
  for (const p of points) USED.add(keyOf(p));
  const todo = [...new Set(points.map(keyOf))].filter(k => !(k in cache));
  let last = Date.now();
  for (let i = 0; i < todo.length; i += src.batch) {
    const chunk = todo.slice(i, i + src.batch);
    const hs = await src.many(chunk.map(k => k.split(',').map(Number)));
    chunk.forEach((k, j) => { cache[k] = hs[j] == null ? null : +hs[j].toFixed(3); });
    process.stdout.write(`\r  ${label} ${Math.min(i + src.batch, todo.length)}/${todo.length}        `);
    if (Date.now() - last > 20000) { fs.writeFileSync(cacheFile, JSON.stringify(cache)); last = Date.now(); }
    if (src.pause) await sleep(src.pause);
  }
  if (todo.length) { fs.writeFileSync(cacheFile, JSON.stringify(cache)); console.log(''); }
  return points.map(p => cache[keyOf(p)]);
}

const median = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
function fillRun(a) {
  const out = a.slice(), n = a.length;
  for (let i = 0; i < n; i++) {
    if (out[i] != null) continue;
    let l = i, r = i;
    while (l >= 0 && a[l] == null) l--;
    while (r < n && a[r] == null) r++;
    const L = l >= 0 ? a[l] : null, R = r < n ? a[r] : null;
    out[i] = L == null ? R : R == null ? L : L + (R - L) * (i - l) / (r - l);
  }
  return out;
}
function gauss(a, sigma) {
  const n = a.length, r = Math.ceil(sigma * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let k = -r; k <= r; k++) { s += a[((i + k) % n + n) % n] * w[k + r]; ws += w[k + r]; } out[i] = s / ws; }
  return out;
}
function planeFit(xs, ys, hs) {
  let n = 0, sx = 0, sy = 0, sh = 0, sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0;
  for (let i = 0; i < hs.length; i++) { const x = xs[i], y = ys[i], h = hs[i]; n++; sx += x; sy += y; sh += h; sxx += x * x; syy += y * y; sxy += x * y; sxh += x * h; syh += y * h; }
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], B = [sh, sxh, syh];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A), col = c => A.map((row, i) => row.map((v, j) => (j === c ? B[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

const args = process.argv.slice(2);
for (const a of args) if (a.startsWith('--') && a !== '--force') { console.error(`getdtm: unknown flag ${a}`); process.exit(2); }
const key = args.find(a => !a.startsWith('--'));
if (!key || !CIRCUIT[key]) { console.error(`usage: node tools/getdtm.mjs <key> [--force]   keys: ${Object.keys(CIRCUIT).join(', ')}`); process.exit(2); }
const C = CIRCUIT[key], src = SOURCES[C.src];
const track = JSON.parse(fs.readFileSync(`${ROOT}data/tracks/${key}.json`, 'utf8'));
if (!track.geo) throw new Error(`${key}: the track file has no geo origin (bake it with tools/bakeosm.mjs)`);
const { lat0, lon0 } = track.geo, { mx, my } = metresPerDegree(key, lat0);
const toLL = (x, y) => [lat0 + y / my, lon0 + x / mx];
fs.mkdirSync(`${ROOT}data/elev/raw`, { recursive: true });
const cacheFile = `${ROOT}data/elev/raw/${key}-${C.src}.json`;
if (args.includes('--force') && fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
console.log(`=== ${key}: ${src.name}`);

// ---- the road ---------------------------------------------------------------------
const n = track.x.length, ds = track.ds;
const LAT = [-3, -1.5, 0, 1.5, 3];
const pts = [];
for (let i = 0; i < n; i++) {
  const a = (i - 1 + n) % n, b = (i + 1) % n, hx = track.x[b] - track.x[a], hy = track.y[b] - track.y[a], hl = Math.hypot(hx, hy) || 1;
  const k = Math.min(1, track.w[i] * 0.75 / 3);
  for (const o of LAT) pts.push(toLL(track.x[i] - hy / hl * o * k, track.y[i] + hx / hl * o * k));
}
const got = await survey(src, pts, cacheFile, 'road');
const post = [];
for (let i = 0; i < n; i++) post.push(median(got.slice(i * 5, i * 5 + 5)));
const holes = post.filter(v => v == null).length;
if (holes === n) throw new Error(`${src.name} has no data on this circuit`);
const centre = fillRun(post);
const clean = centre.map((_, k) => median([-2, -1, 0, 1, 2].map(o => centre[(k + o + n) % n])));
for (const [s0, s1] of C.bridges) {
  const k0 = Math.round(s0 / ds), k1 = Math.round(s1 / ds);
  for (let k = k0 + 1; k < k1; k++) clean[k] = clean[k0] + (clean[k1] - clean[k0]) * (k - k0) / (k1 - k0);
  console.log(`  bridge s=${s0}-${s1}: deck laid straight between its abutments, ${clean[k0].toFixed(1)} to ${clean[k1].toFixed(1)} m`);
}
const prof = gauss(clean, (C.sigma || 10) / ds);
// What a terrain model does where the road is carried on a deck: a notch.
// Reported, never mended silently — a real dip (the Fuchsröhre) is not a bridge.
{
  const wide = gauss(clean, 40 / ds), seen = [];
  for (let i = 0; i < n; i++) { const d = wide[i] - clean[i]; if (d > 1.5 && !seen.some(q => Math.abs(q - i) < 60)) { seen.push(i); console.log(`  dip? s=${(i * ds).toFixed(0)}: road post ${d.toFixed(1)} m under its 40 m surroundings`); } }
  // and the narrow kind: a post well under the line between the posts 12 m either side
  const onDeck = i => C.bridges.some(([s0, s1]) => i * ds >= s0 - 14 && i * ds <= s1 + 14), H = Math.round(12 / ds);
  for (let i = 0; i < n; i++) { const d = (centre[(i - H + n) % n] + centre[(i + H) % n]) / 2 - centre[i]; if (d > 0.6 && !onDeck(i) && !seen.some(q => Math.abs(q - i) < 60)) { seen.push(i); console.log(`  notch? s=${(i * ds).toFixed(0)}: road post ${d.toFixed(1)} m under the line between the posts 12 m either side`); } }
  let worst = 0, rms = 0;
  for (let i = 0; i < n; i++) { if (onDeck(i)) continue; const d = Math.abs(prof[i] - centre[i]); worst = Math.max(worst, d); rms += d * d; }
  console.log(`  smoothed road vs the raw posts (off the decks): worst ${worst.toFixed(2)} m, rms ${Math.sqrt(rms / n).toFixed(3)} m   (${holes} holes filled)`);
}

// ---- the land ---------------------------------------------------------------------
const PAD = 600, G = C.grid, tb = track.bbox;
// snapped to 10 m, so a centimetre's change to the lap does not move every post of the grid
const bb = { x0: Math.floor((tb.x0 - PAD) / 10) * 10, y0: Math.floor((tb.y0 - PAD) / 10) * 10, x1: Math.ceil((tb.x1 + PAD) / 10) * 10, y1: Math.ceil((tb.y1 + PAD) / 10) * 10 };
const dx = (bb.x1 - bb.x0) / (G - 1), dy = (bb.y1 - bb.y0) / (G - 1);
const gp = [], gx = [], gy = [];
// each post is the mean of five: a 1 m model sampled every 60 m aliases
const Q = [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  gx.push(bb.x0 + i * dx); gy.push(bb.y0 + j * dy);
  for (const [qx, qy] of Q) gp.push(toLL(bb.x0 + (i + qx) * dx, bb.y0 + (j + qy) * dy));
}
const gg = await survey(src, gp, cacheFile, 'grid');
let grid = [];
for (let q = 0; q < G * G; q++) { const v = gg.slice(q * 5, q * 5 + 5).filter(v => v != null); grid.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null); }
const gHoles = grid.filter(v => v == null).length;
for (let r = 1; r < G && grid.some(v => v == null); r++) {
  const prev = grid.slice();
  for (let q = 0; q < G * G; q++) {
    if (prev[q] != null) continue;
    const i = q % G, j = (q / G) | 0; let s = 0, c = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue; const v = prev[jj * G + ii]; if (v != null) { s += v; c++; } }
    if (c) grid[q] = s / c;
  }
}

let mean = 0;
for (let i = 0; i < n; i++) mean += prof[i];
mean /= n;
const profOut = Array.from(prof, v => +(v - mean).toFixed(3));
const gridOut = grid.map(g => +((g ?? mean) - mean).toFixed(2));
const lo = Math.min(...profOut), hi = Math.max(...profOut);
const out = `${ROOT}data/elev/${key}.json`;
fs.writeFileSync(out, JSON.stringify({
  key, dataset: src.dataset, source: src.name, licence: src.licence,
  note: 'metres relative to the mean height of the racing line; bare-earth survey, a post under every 2 m sample; RENDERING ONLY in the browser, physics is 2D',
  mean: +mean.toFixed(1), range: [lo, hi], ds, s: profOut,
  grid: { x0: +bb.x0.toFixed(1), y0: +bb.y0.toFixed(1), dx: +dx.toFixed(3), dy: +dy.toFixed(3), n: G, h: gridOut },
  outside: 'plane', sea: null,
  bridges: C.bridges.map(([s0, s1]) => ({ s0, s1 })),
  plane: planeFit(gx, gy, gridOut).map(v => +v.toPrecision(6)),
}));
{
  // posts from an earlier centreline are no use to anybody: keep what this bake read
  const all = JSON.parse(fs.readFileSync(cacheFile, 'utf8')), keep = {};
  for (const k of USED) if (k in all) keep[k] = all[k];
  if (Object.keys(keep).length < Object.keys(all).length) fs.writeFileSync(cacheFile, JSON.stringify(keep));
}
console.log(`  ${key}: mean ${mean.toFixed(1)} m, road ${lo.toFixed(1)} to ${hi.toFixed(1)} (${(hi - lo).toFixed(1)} m), lowest ${(mean + lo).toFixed(1)} m, highest ${(mean + hi).toFixed(1)} m ASL; grid ${G}x${G}, ${gHoles} holes; ${Math.round(fs.statSync(out).size / 1024)} KB -> data/elev/${key}.json`);
