// bakeenv.mjs — the world around the circuit, from the same survey data the
// circuit itself came from.
//
// The complaint this exists to fix: "off track isnt always dirt, the wilderness
// is not always like that, make it so it actually looks like the area" and
// "NEVER let me see the baseplate horizon". A flat green plane meeting the sky
// reads as a video game instantly. Monza is inside a royal park full of trees;
// Zandvoort is in sand dunes; Monaco is a city with the sea on one side. None
// of that has to be invented — it is all in OpenStreetMap, surveyed, and it
// lines up with the track because it uses the SAME projection.
//
//   node tools/bakeenv.mjs [track|all] [--force]
//
// Raw Overpass responses are cached under data/env/raw/ so re-running is free
// and does not hammer a volunteer-run public service. --force refetches.
import fs from 'fs';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  // NOT overpass.osm.ch: it only holds Switzerland, and for anywhere else it
  // answers 200 with ZERO elements — which gets cached as "there are no
  // buildings here". Found adding the Nürburgring (tools/bakereal.mjs).
];
// Same ids geo.mjs uses, so the centroid — and therefore the metre grid — is
// identical to the one the track was baked on. Get this wrong and every
// building sits 40 m from where it belongs.
const CIRCUITS = {
  suzuka: 'jp-1962', zandvoort: 'nl-1948', monaco: 'mc-1929',
  monza: 'it-1922', baku: 'az-2016', nurburgring: 'de-1927',
};
const PAD = 600;        // metres of world to fetch beyond the track's bounding box

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Overpass, politely. A bare 406 means no User-Agent; 429/504 means slow down.
// ---------------------------------------------------------------------------
async function overpass(query, cacheFile, force) {
  if (!force && fs.existsSync(cacheFile)) {
    const txt = fs.readFileSync(cacheFile, 'utf8');
    if (txt.trim().startsWith('{')) return JSON.parse(txt);
  }
  let wait = 8000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) {
        const txt = await res.text();
        if (txt.trim().startsWith('{')) {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, txt);
          return JSON.parse(txt);
        }
        console.log(`    non-JSON body from ${new URL(url).host}, retrying`);
      } else {
        console.log(`    ${res.status} from ${new URL(url).host}, backing off ${wait / 1000}s`);
      }
    } catch (e) {
      console.log(`    ${e.message}, backing off ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 1.6, 60000);
  }
  throw new Error('Overpass would not answer after 6 attempts');
}

// ---------------------------------------------------------------------------
// Tags -> what the thing IS. Anything unmapped is dropped rather than guessed:
// a wrong surface is worse than no surface.
// ---------------------------------------------------------------------------
function classify(t) {
  if (!t) return null;
  const n = t.natural, l = t.landuse, w = t.waterway, le = t.leisure;
  if (n === 'water' || w === 'riverbank' || w === 'dock' || l === 'reservoir' || l === 'basin') return 'water';
  if (n === 'wood' || l === 'forest') return 'forest';
  if (n === 'scrub' || n === 'heath') return 'scrub';
  if (n === 'sand' || n === 'beach' || n === 'dune') return 'sand';
  if (n === 'bare_rock' || n === 'rock' || n === 'cliff') return 'rock';
  if (n === 'grassland' || l === 'grass' || l === 'meadow' || l === 'village_green') return 'grass';
  if (le === 'park' || le === 'golf_course' || le === 'garden') return 'park';
  if (le === 'pitch' || le === 'track' || le === 'sports_centre') return 'pitch';
  if (l === 'farmland' || l === 'orchard' || l === 'vineyard' || l === 'allotments') return 'farm';
  if (l === 'residential' || l === 'commercial' || l === 'retail' || l === 'industrial') return 'urban';
  if (l === 'railway' || l === 'quarry' || l === 'construction') return 'bare';
  return null;
}

// Storey heights, for the 79% of buildings with no height tag. A wrong height
// is still far better than no building: the point is to fill the horizon and
// occlude the sky, and Monaco's skyline being a few metres off is invisible at
// 250 km/h. Explicit tags always win.
const DEFAULT_H = {
  apartments: 16, residential: 12, house: 6.5, detached: 6.5, terrace: 9,
  hotel: 22, commercial: 14, office: 18, retail: 8, supermarket: 8,
  industrial: 11, warehouse: 10, church: 20, cathedral: 30, chapel: 10,
  grandstand: 14, stadium: 20, hangar: 12, garage: 3.2, garages: 3.2,
  shed: 3, hut: 3, roof: 4.5, carport: 3, service: 4, kiosk: 3,
};
// Building kind, normalised to a small set the renderer can switch on. Left
// OUT entirely for a plain `building=yes`, which is most of them — omitting the
// field is what keeps these files at a few hundred KB.
const KIND = {
  grandstand: 'grandstand', tribune: 'grandstand',
  stadium: 'stadium',
  garage: 'garage', garages: 'garage', carport: 'garage',
  industrial: 'industrial', warehouse: 'industrial', hangar: 'industrial', service: 'industrial',
  house: 'house', detached: 'house', bungalow: 'house', terrace: 'house', semidetached_house: 'house',
  apartments: 'apartments', residential: 'apartments', dormitory: 'apartments',
  retail: 'retail', supermarket: 'retail', kiosk: 'retail', commercial: 'retail',
  office: 'office',
  hotel: 'hotel',
  church: 'church', cathedral: 'church', chapel: 'church', mosque: 'church', temple: 'church',
  roof: 'roof',
  shed: 'shed', hut: 'shed',
};
// Only the unambiguous ones. A guessed roof colour is worse than none, because
// the renderer can pick something sane but cannot un-pick a wrong survey.
const ROOF_MAT = {
  roof_tiles: '#9d5b3f', tile: '#9d5b3f', tiles: '#9d5b3f',
  metal: '#8a8f94', concrete: '#9a9a94',
};

// Surveyed facade detail, emitted ONLY where OSM actually has it — a real
// tagged colour is exactly the accuracy that stops a city looking like grey
// boxes, and a made-up one is just noise.
function buildingExtras(t) {
  const out = {};
  const k = KIND[t.building];
  if (k) out.k = k;
  const c = t['building:colour'] || t['building:color'] || t.colour || t.color;
  if (c) out.c = String(c).slice(0, 24);
  const rc = t['roof:colour'] || t['roof:color'] || ROOF_MAT[t['roof:material']];
  if (rc) out.rc = String(rc).slice(0, 24);
  const lv = parseInt(t['building:levels'], 10);
  if (Number.isFinite(lv) && lv >= 1 && lv < 200) out.lv = lv;
  return out;
}

function heightOf(t) {
  const h = parseFloat(t.height);
  if (Number.isFinite(h) && h > 1 && h < 400) return h;
  const lv = parseFloat(t['building:levels']);
  if (Number.isFinite(lv) && lv >= 1 && lv < 120) return lv * 3.2 + 1.0;
  return DEFAULT_H[t.building] ?? 8.5;
}

// Drop nodes that add nothing at driving distances, and round to 10 cm. An OSM
// footprint averages 9 nodes; most of them are centimetre-level detail.
function simplify(pts, minStep = 1.8) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minStep) out.push(p);
  }
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < minStep) out.pop();
  }
  return out.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
}
function area2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// ---------------------------------------------------------------------------
async function bake(key, force) {
  const id = CIRCUITS[key];
  const gj = JSON.parse(fs.readFileSync(ROOT + 'data/f1-circuits.geojson', 'utf8'));
  const f = gj.features.find(x => x.properties.id === id);
  if (!f) throw new Error('no circuit ' + id);
  let ring = f.geometry.coordinates.slice();
  if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  const toXY = (lat, lon) => [(lon - lon0) * mx, (lat - lat0) * my];

  const track = JSON.parse(fs.readFileSync(ROOT + `data/tracks/${key}.json`, 'utf8'));
  const bb = track.bbox;
  const s = lat0 + (bb.y0 - PAD) / my, nn = lat0 + (bb.y1 + PAD) / my;
  const w = lon0 + (bb.x0 - PAD) / mx, e = lon0 + (bb.x1 + PAD) / mx;
  const box = `${s.toFixed(5)},${w.toFixed(5)},${nn.toFixed(5)},${e.toFixed(5)}`;
  console.log(`\n=== ${key} === bbox ${box}`);

  const raw = ROOT + 'data/env/raw/';
  console.log('  buildings…');
  // Relations as well as ways. Only ~1% of buildings are multipolygon
  // relations, but they are the LANDMARKS — querying ways alone silently drops
  // the Casino at Monaco, which is the one building anybody would recognise.
  const bJson = await overpass(
    `[out:json][timeout:180];(way["building"](${box});relation["building"](${box}););out geom;`,
    raw + `${key}-buildings.json`, force);
  await sleep(3000);          // be a good citizen between queries
  console.log('  landcover…');
  const lJson = await overpass(
    `[out:json][timeout:180];(way["natural"](${box});way["landuse"](${box});way["leisure"](${box});way["waterway"~"riverbank|dock"](${box}););out geom;`,
    raw + `${key}-land.json`, force);
  await sleep(3000);
  console.log('  coastline…');
  // The sea is not tagged as an area — it is an open `natural=coastline` way
  // with, by OSM convention, LAND ON THE LEFT of the direction of travel. So
  // three of these circuits sit on water that does not exist in the bake at
  // all: Monaco has no Mediterranean, Zandvoort no North Sea.
  const cJson = await overpass(
    `[out:json][timeout:180];(way["natural"="coastline"](${box}););out geom;`,
    raw + `${key}-coast.json`, force).catch(() => ({ elements: [] }));
  await sleep(3000);
  console.log('  individual trees…');
  // Surveyed tree NODES. Scattering randomly inside a forest polygon is fine
  // for a wood, but wrong for the avenue of planes down Monza's main straight —
  // and that avenue is in the survey data, so it may as well be in the game.
  const tJson = await overpass(
    `[out:json][timeout:180];(node["natural"="tree"](${box}););out;`,
    raw + `${key}-trees.json`, force).catch(() => ({ elements: [] }));

  const buildings = [];
  for (const el of bJson.elements || []) {
    // A way carries `geometry`; a relation carries `members`, each with its
    // own geometry. Take the outer rings and ignore holes — a courtyard you
    // cannot see into is not worth the triangles.
    const rings = el.type === 'relation'
      ? (el.members || []).filter(m => m.role !== 'inner' && m.geometry).map(m => m.geometry)
      : (el.geometry ? [el.geometry] : []);
    const tg = el.tags || {};
    const extra = buildingExtras(tg);
    for (const ring of rings) {
      if (ring.length < 4) continue;
      const pts = simplify(ring.map(g => toXY(g.lat, g.lon)));
      if (pts.length < 3 || area2(pts) < 18) continue;
      buildings.push({ h: Math.round(heightOf(tg) * 10) / 10, p: pts, ...extra });
    }
  }

  const areas = [];
  const counts = {};
  for (const el of lJson.elements || []) {
    if (!el.geometry || el.geometry.length < 4) continue;
    const kind = classify(el.tags);
    if (!kind) continue;
    const pts = simplify(el.geometry.map(g => toXY(g.lat, g.lon)), 3.0);
    if (pts.length < 3 || area2(pts) < 150) continue;
    areas.push({ k: kind, p: pts });
    counts[kind] = (counts[kind] || 0) + 1;
  }
  // Big first: a forest drawn over a lake looks wrong, a lake over a forest
  // does not. Painter's order is decided here, once, not in the renderer.
  areas.sort((a, b) => area2(b.p) - area2(a.p));

  // Coastline -> sea. Rather than clipping against the bounding box and
  // stitching corners (fiddly, and it fails badly when a chain leaves and
  // re-enters), extrude the shoreline 4 km to SEAWARD and close it. OSM points
  // coastline ways with land on the left, so seaward is simply the right-hand
  // normal. The result is a ribbon that runs past the horizon, which is all
  // the sea has to be.
  const sea = [];
  for (const el of cJson.elements || []) {
    if (!el.geometry || el.geometry.length < 2) continue;
    // Clamp BOTH edges to the world box. Clamping only the seaward side was not
    // enough: Overpass returns a whole way if any part of it touches the box,
    // and a national coastline is tens of kilometres long, so the shoreline
    // itself still spanned 14.6 km around a 2 km circuit. Clamp, then simplify
    // again to collapse the long degenerate run that forms along the edge.
    const M = 400;
    const cx0 = bb.x0 - PAD - M, cx1 = bb.x1 + PAD + M;
    const cy0 = bb.y0 - PAD - M, cy1 = bb.y1 + PAD + M;
    const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
    const reach = Math.max(cx1 - cx0, cy1 - cy0);

    const rawLine = simplify(el.geometry.map(g => toXY(g.lat, g.lon)), 12);
    if (rawLine.length < 2) continue;
    // direction is taken from the UNCLAMPED shoreline, so squashing points onto
    // the box edge cannot flip which side the sea is on
    const dirs = rawLine.map((_, i) => {
      const a = rawLine[Math.max(0, i - 1)], b = rawLine[Math.min(rawLine.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const m = Math.hypot(dx, dy) || 1;
      return [dx / m, dy / m];
    });
    const line = [], far = [];
    for (let i = 0; i < rawLine.length; i++) {
      line.push([clamp(rawLine[i][0], cx0, cx1), clamp(rawLine[i][1], cy0, cy1)]);
    }
    for (let i = rawLine.length - 1; i >= 0; i--) {
      const [ux, uy] = dirs[i];
      far.push([
        clamp(rawLine[i][0] + uy * reach, cx0, cx1),
        clamp(rawLine[i][1] - ux * reach, cy0, cy1),
      ]);
    }
    sea.push({ p: line.concat(far).map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });
  }

  const trees = [];
  for (const el of tJson.elements || []) {
    if (el.lat == null) continue;
    const [x, y] = toXY(el.lat, el.lon);
    trees.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  const out = {
    key, full: track.full, lat0, lon0, pad: PAD,
    bbox: { x0: bb.x0 - PAD, y0: bb.y0 - PAD, x1: bb.x1 + PAD, y1: bb.y1 + PAD },
    buildings, areas, sea, trees,
  };
  const file = ROOT + `data/env/${key}.json`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  const kinds = {};
  for (const b of buildings) if (b.k) kinds[b.k] = (kinds[b.k] || 0) + 1;
  const tagged = buildings.filter(b => b.c).length, roofed = buildings.filter(b => b.rc).length;
  console.log(`  -> ${buildings.length} buildings, ${areas.length} areas, ${sea.length} sea, ${trees.length} trees, ${kb}KB`);
  console.log(`     kinds: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ') || '(none tagged)'}`);
  console.log(`     surveyed colours: ${tagged} facade, ${roofed} roof`);
  console.log('     ' + Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`).join('  '));
  return out;
}

const arg = process.argv[2] || 'all';
const force = process.argv.includes('--force');
const keys = arg === 'all' ? Object.keys(CIRCUITS) : [arg];
for (const k of keys) {
  try { await bake(k, force); }
  catch (e) { console.log(`  !! ${k}: ${e.message}`); }
  await sleep(4000);
}
