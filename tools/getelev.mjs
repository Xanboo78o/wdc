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
//
// ---------------------------------------------------------------------------
// 2026-09-28: SRTM IS A SURFACE MODEL, NOT A GROUND MODEL.
//
// Adam: "monza is randomly hilly". It was: 20.0 m of range and 55 reversals
// round a lap that is really 12.8 m (formula1.com, "Highs and lows"). SRTM is
// C-band radar, and radar bounces off the TOP of whatever is there — the
// canopy of the Parco di Monza, the apartment blocks of Monaco. A circuit
// through a royal park came out as a road rising and falling with the trees
// beside it. The fix is not smoothing (smoothing a canopy leaves a smooth
// canopy); it is a BARE-EARTH survey, a DTM, and the national mapping agencies
// publish exactly that for most of these circuits:
//
//   monza      Regione Lombardia DTM 5x5 (2015)     5 m, bare earth
//   suzuka     GSI Japan DEM5A                       5 m airborne laser
//   zandvoort  AHN (Actueel Hoogtebestand NL) DTM    0.5 m lidar
//   monaco     IGN RGE ALTI (Géoplateforme)          1-5 m, bare earth
//   others     SRTM 30 m, as before
//
// Each is asked one point (or one batch) at a time through its public
// query service; raw answers are cached in data/elev/raw so re-deriving the
// profile never re-queries anybody.
// ---------------------------------------------------------------------------
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const API = 'https://api.opentopodata.org/v1/srtm30m';
const BATCH = 100;               // locations per request, their limit
const GRID = 32;                 // grid resolution across the world box (SRTM)
const STEP = 20;                 // metres between centreline samples (SRTM)

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- the bare-earth surveys ---------------------------------------------------
// `one(lat, lon)` answers a single point in metres above sea level, or null
// where the survey has no data (a building footprint in a lidar DTM, a lake).
async function fetchText(url, tries = 9) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await sleep(1000 * 1.6 ** a);
  }
  throw new Error('no answer from ' + url.slice(0, 80));
}
const SOURCES = {
  lombardia: {
    name: 'Regione Lombardia DTM 5x5 (ed. 2015), bare earth',
    licence: 'Regione Lombardia open data (CC-BY 4.0)',
    step: 8, grid: 56, conc: 4,
    // An ArcGIS WMS: GetFeatureInfo on a 3x3 pixel box centred on the point.
    async one(lat, lon) {
      const d = 0.00002;
      const u = 'https://www.cartografia.servizirl.it/arcgis/services/wms/DTM5_RL_wms/MapServer/WmsServer' +
        '?service=wms&version=1.3.0&request=GetFeatureInfo&query_layers=0&layers=0&styles=&format=image/png' +
        `&info_format=text/xml&crs=EPSG:4326&bbox=${lat - d},${lon - d},${lat + d},${lon + d}&width=3&height=3&i=1&j=1`;
      const m = /PixelValue="([-0-9.eE]+)"/.exec(await fetchText(u));
      const v = m ? +m[1] : NaN;
      return Number.isFinite(v) && v > -100 && v < 9000 ? v : null;
    },
  },
  gsi: {
    name: 'GSI Japan DEM (5 m airborne laser where surveyed, else 10 m), bare earth',
    licence: 'GSI Japan, Geospatial Information Authority terms (attribution)',
    step: 8, grid: 56, conc: 2,
    async one(lat, lon) {
      const j = JSON.parse(await fetchText(`https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lon.toFixed(7)}&lat=${lat.toFixed(7)}&outtype=JSON`));
      return typeof j.elevation === 'number' ? j.elevation : null;
    },
  },
  ahn: {
    name: 'AHN (Actueel Hoogtebestand Nederland) DTM 0.5 m lidar, bare earth, via PDOK',
    licence: 'AHN, CC0 1.0',
    step: 8, grid: 56, conc: 4,
    async one(lat, lon) {
      const d = 0.000004;
      const u = 'https://service.pdok.nl/rws/ahn/wms/v1_0?service=WMS&version=1.3.0&request=GetFeatureInfo' +
        '&layers=dtm_05m&query_layers=dtm_05m&styles=&crs=EPSG:4326&width=3&height=3&i=1&j=1' +
        `&bbox=${lat - d},${lon - d},${lat + d},${lon + d}&info_format=application/json&format=image/png`;
      const j = JSON.parse(await fetchText(u));
      const v = j.features && j.features[0] ? parseFloat(j.features[0].properties.value_list) : NaN;
      return Number.isFinite(v) && v > -100 && v < 9000 ? v : null;
    },
  },
  ign: {
    name: 'IGN RGE ALTI via the Géoplateforme altimetry service, bare earth',
    licence: 'IGN, Licence Ouverte 2.0',
    step: 8, grid: 56, conc: 2, batch: 40,
    async many(pts) {
      const lon = pts.map(p => p[1].toFixed(7)).join('|'), lat = pts.map(p => p[0].toFixed(7)).join('|');
      const j = JSON.parse(await fetchText(`https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=${lon}&lat=${lat}&resource=ign_rge_alti_wld&zonly=true`));
      return (j.elevations || []).map(v => (typeof v === 'number' && v > -99 ? v : null));
    },
  },
};
// TUNNELS, as [from s, to s] in metres along the lap. A bare-earth survey
// measures the hill ABOVE a tunnel, not the road inside it: Monaco's tunnel
// under the Fairmont came out 14 m up the hillside (IGN: 21.8 m ASL at
// s=1600 against 7.7 m at the Portier portal and 8.3 m at the harbour one).
// Inside these spans the road runs straight between its two portals.
// The spans are read off the survey itself: where the ground rises above
// both portals and falls back.
const TUNNELS = { monaco: [[1440, 1860]] };

// BRIDGES: the stretch of a road carried over another, [s0, s1]. A bare-earth
// survey has the deck taken out, so the road reads as dipping to the road
// beneath (Suzuka's back straight: 49.6 m on both embankments, 43.3 m at the
// crossing — which is the Degner exit's own height). Across the span the road
// is laid straight between the two abutments, as for a tunnel, and the lap's
// crossover is NOT levelled there: the deck really is 6 m up.
const BRIDGES = { suzuka: [[4656, 4720]] };

// Circuits on SRTM through a city: the width (m) of the opening that takes
// the rooftops out of the road's profile. See the SRTM bake.
const OPEN = { baku: 60, sepang: 70 };
// Sepang on SRTM reads the oil-palm canopy and the grandstands beside the
// road: the first bake had the back straight climbing 10 m in 100 m and an
// 18% grade at Turn 1. Published: ~18-22 m of elevation change, steepest
// 3.7% up and 5.6% down, high ground at Turns 9-11. The opening takes the
// canopy out; a longer smoothing window takes the rest of the radar noise.
// Passes of a 1-2-1 filter on 2 m samples: 2400 is a Gaussian of ~70 m.
const SMOOTH = { sepang: 2400 };

// The water line, metres above mean sea level. The Caspian is 28 m below it.
const SEA_ASL = { baku: -28 };

// Which survey answers for which circuit. Anything not listed stays on SRTM.
const CIRCUIT_SOURCE = { monza: 'lombardia', suzuka: 'gsi', zandvoort: 'ahn', monaco: 'ign' };

// Ask a list of points of a survey, a few at a time, cached on disk by point.
async function survey(src, points, cacheFile, label) {
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const keyOf = ([la, lo]) => `${la.toFixed(6)},${lo.toFixed(6)}`;
  const todo = [...new Set(points.map(keyOf))].filter(k => !(k in cache));
  let done = 0, lastSave = Date.now();
  const save = () => fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const tick = () => process.stdout.write(`\r  ${label} ${points.length - todo.length + done}/${points.length}   `);
  if (src.many) {
    for (let i = 0; i < todo.length; i += src.batch) {
      const chunk = todo.slice(i, i + src.batch);
      const hs = await src.many(chunk.map(k => k.split(',').map(Number)));
      chunk.forEach((k, j) => { cache[k] = hs[j] ?? null; });
      done += chunk.length; tick();
      if (Date.now() - lastSave > 5000) { save(); lastSave = Date.now(); }
      await sleep(250);
    }
  } else {
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const k = todo[next++];
        const [la, lo] = k.split(',').map(Number);
        cache[k] = await src.one(la, lo);
        done++;
        if (done % 20 === 0) tick();
        if (Date.now() - lastSave > 5000) { save(); lastSave = Date.now(); }
      }
    };
    await Promise.all(Array.from({ length: src.conc }, worker));
  }
  save(); tick();
  return points.map(p => cache[keyOf(p)]);
}

// Fill the survey's holes (null) from the nearest good neighbours along a list.
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
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }

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
  const srcKey = !process.argv.includes('--srtm') && CIRCUIT_SOURCE[key];
  if (srcKey) return bakeDTM(key, SOURCES[srcKey], srcKey, track, env, toLL, out);

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
  // AN OPENING for a city circuit on SRTM (no bare-earth survey answers for
  // Baku): radar reads rooftops, so the road rose and fell with the blocks
  // beside it — 37.5 m of range against the 26.8 m formula1.com gives. A
  // morphological opening (the lowest post within ±W, then the highest of
  // those within ±W) removes every bump narrower than 2W and keeps the
  // hillside the old city stands on.
  if (OPEN[key]) {
    const W = Math.round(OPEN[key] / ds), L = raw.length;
    const lo = raw.map((_, i) => { let m = Infinity; for (let o = -W; o <= W; o++) m = Math.min(m, raw[(i + o + L) % L]); return m; });
    for (let i = 0; i < L; i++) { let m = -Infinity; for (let o = -W; o <= W; o++) m = Math.max(m, lo[(i + o + L) % L]); raw[i] = m; }
    console.log(`\n  opening of ±${OPEN[key]} m applied (rooftops out of the profile)`);
  }
  const prof = smooth(raw, SMOOTH[key] || 24);

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

// A real Gaussian along a closed (or open) profile. sigma in samples.
function gauss(a, sigma, closed = true) {
  const n = a.length, r = Math.ceil(sigma * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      let j = i + k;
      if (closed) j = (j % n + n) % n; else if (j < 0 || j >= n) continue;
      s += a[j] * w[k + r]; ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

// Least-squares plane through the grid, h = a + b x + c y — what the land does
// past the edge of the survey on a circuit with no sea to fall to.
function planeFit(xs, ys, hs) {
  let n = 0, sx = 0, sy = 0, sh = 0, sxx = 0, syy = 0, sxy = 0, sxh = 0, syh = 0;
  for (let i = 0; i < hs.length; i++) {
    const x = xs[i], y = ys[i], h = hs[i];
    n++; sx += x; sy += y; sh += h; sxx += x * x; syy += y * y; sxy += x * y; sxh += x * h; syh += y * h;
  }
  // Solve the 3x3 normal equations by Cramer's rule.
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], B = [sh, sxh, syh];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const col = c => A.map((row, i) => row.map((v, j) => (j === c ? B[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}

async function bakeDTM(key, src, srcKey, track, env, toLL, out) {
  const key0 = key;
  fs.mkdirSync(`${ROOT}data/elev/raw`, { recursive: true });
  const cache = `${ROOT}data/elev/raw/${key}-${srcKey}.json`;
  const n = track.x.length, ds = track.ds;
  const every = Math.max(1, Math.round(src.step / ds));
  const idx = [];
  for (let i = 0; i < n; i += every) idx.push(i);
  const centre = fillRun(await survey(src, idx.map(i => toLL(track.x[i], track.y[i])), cache, 'centreline'));
  const holes = centre.filter(v => v == null).length;
  if (holes === centre.length) throw new Error(`${src.name} has no data on this circuit`);
  // One bad post (a bridge deck left in, a wall edge) is a spike, not a hill:
  // a running median of five posts (40 m) removes it and leaves a crest alone.
  const m = idx.length;
  const clean = centre.map((_, k) => median([-2, -1, 0, 1, 2].map(o => centre[(k + o + m) % m])));
  for (const [s0, s1] of [...(TUNNELS[key] || []), ...(BRIDGES[key] || [])]) {
    const k0 = idx.findIndex(i => i * ds >= s0), k1 = idx.findIndex(i => i * ds >= s1);
    if (k0 < 0 || k1 <= k0) continue;
    for (let k = k0 + 1; k < k1; k++) clean[k] = clean[k0] + (clean[k1] - clean[k0]) * (k - k0) / (k1 - k0);
    console.log(`\n  span s=${s0}-${s1}: road laid straight between its ends, ${clean[k0].toFixed(1)} to ${clean[k1].toFixed(1)} m`);
  }
  // Spread LINEARLY over every 2 m sample (smoothstep between posts makes a
  // flat step at every post), then a true Gaussian of 10 m: a road is graded,
  // and a 5 m lidar cell still carries kerb and verge texture.
  const raw = new Float64Array(n);
  for (let k = 0; k < m; k++) {
    const i0 = idx[k], i1 = idx[(k + 1) % m];
    const span = (i1 - i0 + n) % n || n;
    for (let d = 0; d < span; d++) raw[(i0 + d) % n] = clean[k] + (clean[(k + 1) % m] - clean[k]) * d / span;
  }
  const prof = gauss(raw, 10 / ds);

  // A CROSSOVER (Suzuka's figure of eight) is two legs at one point. In the
  // real world one is on a bridge; a bare-earth survey has the bridge taken
  // OUT, and this renderer has no bridge to put back — the road, run-off and
  // ground near a point all take the height of the NEAREST leg. So two legs
  // at different heights there would tear every mesh across the crossing.
  // Until there is a bridge, the legs are brought to their shared mean over a
  // Gaussian of ±60 m each side (the old SRTM data happened to put them within
  // 0.1 m of each other, so this keeps what the game already drew).
  const crossings = [];
  const far = Math.round(400 / ds);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + far; j < n; j += 2) {
      if (n - (j - i) < far) continue;
      if (Math.hypot(track.x[i] - track.x[j], track.y[i] - track.y[j]) < 4) crossings.push([i, j]);
    }
  }
  const seen = new Set();
  for (const [i, j] of crossings) {
    const key = Math.round(i / 40) + ':' + Math.round(j / 40);
    if (seen.has(key)) continue;
    const onBridge = k => (BRIDGES[key0] || []).some(([s0, s1]) => k * ds >= s0 - 20 && k * ds <= s1 + 20);
    if (onBridge(i) || onBridge(j)) { seen.add(key); console.log(`\n  crossover at s=${i * ds} / s=${j * ds}: a bridge, legs ${Math.abs(prof[i] - prof[j]).toFixed(1)} m apart`); continue; }
    seen.add(key);
    const avg = (prof[i] + prof[j]) / 2, di = avg - prof[i], dj = avg - prof[j];
    const sig = 60 / ds, R = Math.ceil(sig * 3);
    for (let k = -R; k <= R; k++) {
      const w = Math.exp(-(k * k) / (2 * sig * sig));
      prof[((i + k) % n + n) % n] += di * w;
      prof[((j + k) % n + n) % n] += dj * w;
    }
    console.log(`\n  crossover at s=${i * ds} / s=${j * ds}: legs ${(-di * 2).toFixed(1)} m apart in the survey, levelled to the mean`);
  }

  // --- the world grid ------------------------------------------------------
  const G = src.grid, bb = env.bbox;
  const dx = (bb.x1 - bb.x0) / (G - 1), dy = (bb.y1 - bb.y0) / (G - 1);
  const pts = [], gx = [], gy = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    gx.push(bb.x0 + i * dx); gy.push(bb.y0 + j * dy);
    pts.push(toLL(bb.x0 + i * dx, bb.y0 + j * dy));
  }
  let grid = await survey(src, pts, cache, 'grid      ');
  // THE SEA IS NOT A HOLE TO FILL. A lidar or IGN survey has no answer over
  // water, and filling that from the neighbours built a shelf of coastal land
  // out into Monaco's harbour, above the water it should be under. A post
  // inside a surveyed sea polygon is sea bed: 4 m under the water line
  // (SEA_ASL). Only holes on land (a building in a lidar DTM) are filled.
  const seaPolys = (env.sea || []).map(q => q.p || q);
  const inSea = (x, y) => seaPolys.some(p => {
    let ins = false;
    for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
      if ((p[a][1] > y) !== (p[b][1] > y) && x < (p[b][0] - p[a][0]) * (y - p[a][1]) / (p[b][1] - p[a][1]) + p[a][0]) ins = !ins;
    }
    return ins;
  });
  // The water line: what the survey itself reads on the water (IGN reads
  // Monaco's harbour at ~1.2 m), but never above a point 1.5 m under the
  // lowest road — a quay is above its water. And every post in the sea is sea
  // BED, whatever the survey says: a DTM's reading on water is the surface.
  const wet = grid.filter((v, q) => v != null && inSea(gx[q], gy[q])).sort((a, b) => a - b);
  let seaASL = SEA_ASL[key] ?? (wet.length ? wet[wet.length >> 1] : 0);
  seaASL = Math.min(seaASL, Math.min(...prof) - 1.5);
  grid = grid.map((v, q) => inSea(gx[q], gy[q]) ? seaASL - 4 : v);
  const filled = grid.slice();
  for (let r = 1; r < G && filled.some(v => v == null); r++) {
    const prev = filled.slice();
    for (let q = 0; q < G * G; q++) {
      if (prev[q] != null) continue;
      const i = q % G, j = (q / G) | 0;
      let s = 0, c = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
        const v = prev[jj * G + ii];
        if (v != null) { s += v; c++; }
      }
      if (c) filled[q] = s / c;
    }
  }
  grid = filled.map(v => v ?? 0);

  let mean = 0;
  for (let i = 0; i < n; i++) mean += prof[i];
  mean /= n;
  const profOut = Array.from(prof, v => +(v - mean).toFixed(2));
  const gridOut = grid.map(g => +(g - mean).toFixed(2));
  const lo = Math.min(...profOut), hi = Math.max(...profOut);
  const coastal = (env.sea || []).length > 0;
  const plane = planeFit(gx, gy, gridOut).map(v => +v.toPrecision(6));
  fs.writeFileSync(out, JSON.stringify({
    key,
    dataset: srcKey,
    source: src.name,
    licence: src.licence,
    note: 'metres relative to the mean height of the racing line; bare-earth survey; RENDERING ONLY, physics is 2D',
    mean: +mean.toFixed(1),
    range: [lo, hi],
    ds,
    s: profOut,
    grid: { x0: bb.x0, y0: bb.y0, dx: +dx.toFixed(3), dy: +dy.toFixed(3), n: G, h: gridOut },
    // Past the edge of the survey: fall to the sea where there is one, else
    // carry on along the land's own tilt (see World.gridAt).
    outside: coastal ? 'sea' : 'plane',
    // Where the water is, on the same datum as everything else: the sea's
    // height above sea level (0, or the Caspian's -28) less the mean.
    sea: coastal ? +(seaASL - mean).toFixed(2) : null,
    // Decks the ground must NOT follow where another road passes under.
    bridges: (BRIDGES[key] || []).map(([s0, s1]) => ({ s0, s1 })),
    plane,
  }));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`\r  ${key.padEnd(10)} ${srcKey}  mean ${mean.toFixed(1)} m  ${holes} holes filled  ` +
    `track rises ${(hi - lo).toFixed(1)} m (${lo.toFixed(1)} to ${hi.toFixed(1)})  ${kb} KB`);
}

const want = (process.argv[2] && process.argv[2] !== 'all')
  ? [process.argv[2]] : ['monza', 'zandvoort', 'suzuka', 'baku', 'monaco', 'nurburgring', 'sepang'];
const force = process.argv.includes('--force');
for (const key of want) await bake(key, force);

fs.writeFileSync(`${ROOT}data/elev/SOURCE.md`, `# Where the heights came from

A **bare-earth survey (DTM)** from the national mapping agency wherever one
answers a public query, because SRTM is radar and reads the TOP of trees and
buildings — Monza came out 20 m "hilly" off the canopy of its park against a
real 12.8 m. Each file's \`dataset\`/\`source\`/\`licence\` fields say which:

| circuit | survey | licence |
|---|---|---|
| monza | Regione Lombardia DTM 5x5 (ed. 2015), bare earth | CC-BY 4.0 |
| suzuka | GSI Japan DEM5A/10B, airborne laser | GSI terms, attribution |
| zandvoort | AHN DTM 0.5 m lidar via PDOK | CC0 |
| monaco | IGN RGE ALTI via Géoplateforme | Licence Ouverte 2.0 |
| others | **NASA SRTM at 30 m**, via [opentopodata.org](https://www.opentopodata.org/) | public domain |

Raw answers are cached per point in \`raw/\`, so a re-bake queries nobody.

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
