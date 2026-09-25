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

// A circuit that is not a survey but is BASED on real streets: Adam's street
// circuit is Pembroke, New Hampshire — the long top straight is Pembroke
// Street, and it turns into Whittemore Road. The track was modelled by hand,
// then doubled and widened (importtrack --scale 2 --width 22), so the town
// cannot be laid on it by projection. Two PINS do it instead: a real place and
// the distance along the lap that stands there. They fix the scale, rotation
// and offset of the whole town (a similarity, never a skew).
//
// Positions take that scale; footprints and road widths do NOT. The pins put
// the town at 1.21x its real spread, and a house 1.21x the size of a house
// looks wrong in a way a slightly longer street never does.
//
// A fitted track also gets its STREETS (`roads`), cut back wherever they would
// run onto the circuit — a street circuit closes its side roads at the wall.
const FITTED = {
  street: {
    lat0: 43.165, lon0: -71.4775,
    pins: [
      { lat: 43.1662829, lon: -71.4762809, s: 236, what: 'Pembroke St x Whittemore Rd = Turn 2' },
      { lat: 43.1585268, lon: -71.4688370, s: 6426, what: 'Pembroke St x Bow Lane = the top corner' },
    ],
  },
};
// What a street is, as a full width in metres. Footpaths, driveways and
// tracks are left out: at racing speed they are noise, and there are
// thousands of driveways.
const ROAD_W = {
  motorway: 14, trunk: 12, primary: 10, secondary: 9, tertiary: 8,
  unclassified: 6.5, residential: 6.5, living_street: 5.5,
  motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
// A stable pseudo-random in [0,1) from a position (the same idea as env.js's).
const seededN = (x, y, salt) => { const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 43.7585) * 43758.5453; return v - Math.floor(v); };

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
  const fit = FITTED[key];
  const track = JSON.parse(fs.readFileSync(ROOT + `data/tracks/${key}.json`, 'utf8'));
  const bb = track.bbox;
  let lat0, lon0;
  if (fit) ({ lat0, lon0 } = fit);
  else {
    const id = CIRCUITS[key];
    const gj = JSON.parse(fs.readFileSync(ROOT + 'data/f1-circuits.geojson', 'utf8'));
    const f = gj.features.find(x => x.properties.id === id);
    if (!f) throw new Error('no circuit ' + id);
    let ring = f.geometry.coordinates.slice();
    if (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  }
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  const local = (lat, lon) => [(lon - lon0) * mx, (lat - lat0) * my];

  // local metres -> track metres. Identity for a surveyed circuit; for a
  // fitted one, the similarity that carries each pin onto its point of the lap.
  let sim = { a: 1, b: 0, tx: 0, ty: 0 };
  if (fit) {
    const at = s => { const i = Math.round(s / track.ds) % track.x.length; return [track.x[i], track.y[i]]; };
    const [p, q] = fit.pins.map(pn => local(pn.lat, pn.lon));
    const [P, Q] = fit.pins.map(pn => at(pn.s));
    const u = [q[0] - p[0], q[1] - p[1]], v = [Q[0] - P[0], Q[1] - P[1]];
    const uu = u[0] * u[0] + u[1] * u[1];
    const a = (u[0] * v[0] + u[1] * v[1]) / uu, b = (u[0] * v[1] - u[1] * v[0]) / uu;
    sim = { a, b, tx: P[0] - (a * p[0] - b * p[1]), ty: P[1] - (b * p[0] + a * p[1]) };
    console.log(`  fitted by ${fit.pins.length} pins: scale ${Math.hypot(a, b).toFixed(3)}, rotated ${(Math.atan2(b, a) * 180 / Math.PI).toFixed(1)} deg`);
  }
  const scale = Math.hypot(sim.a, sim.b);
  const fwd = ([x, y]) => [sim.a * x - sim.b * y + sim.tx, sim.b * x + sim.a * y + sim.ty];
  const toXY = (lat, lon) => fwd(local(lat, lon));
  // A footprint moves with the town but keeps its real size: rotate it, and
  // scale only where it stands.
  const shapeXY = geom => {
    const pts = geom.map(g => local(g.lat, g.lon));
    const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length, cy = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    const [CX, CY] = fwd([cx, cy]);
    const ra = sim.a / scale, rb = sim.b / scale;
    return pts.map(([x, y]) => [CX + ra * (x - cx) - rb * (y - cy), CY + rb * (x - cx) + ra * (y - cy)]);
  };

  // The box to fetch: the track's bbox, padded, carried back to lat/lon.
  const back = ([X, Y]) => {
    const x = X - sim.tx, y = Y - sim.ty, d = scale * scale;
    return [(sim.a * x + sim.b * y) / d, (-sim.b * x + sim.a * y) / d];
  };
  const corners = [[bb.x0 - PAD, bb.y0 - PAD], [bb.x1 + PAD, bb.y0 - PAD], [bb.x0 - PAD, bb.y1 + PAD], [bb.x1 + PAD, bb.y1 + PAD]].map(back);
  const lx0 = Math.min(...corners.map(c => c[0])), lx1 = Math.max(...corners.map(c => c[0]));
  const ly0 = Math.min(...corners.map(c => c[1])), ly1 = Math.max(...corners.map(c => c[1]));
  const s = lat0 + ly0 / my, nn = lat0 + ly1 / my;
  const w = lon0 + lx0 / mx, e = lon0 + lx1 / mx;
  const box = `${s.toFixed(5)},${w.toFixed(5)},${nn.toFixed(5)},${e.toFixed(5)}`;
  console.log(`\n=== ${key} === bbox ${box}`);

  // On a fitted track the town was never surveyed around THIS road, so houses
  // and streets land on the circuit. Anything inside the circuit's corridor —
  // tarmac, run-off, and a few metres for the barrier — is not built.
  const n = track.x.length;
  const clearOf = (x, y, margin) => {
    for (let i = 0; i < n; i += 2) {
      const dx = x - track.x[i], dy = y - track.y[i];
      if (dx * dx + dy * dy > 2500) continue;          // > 50 m: cannot be inside
      const j = (i + 1) % n, hx = track.x[j] - track.x[i], hy = track.y[j] - track.y[i];
      const hl = Math.hypot(hx, hy) || 1;
      const lat = (-hy * dx + hx * dy) / hl, along = (hx * dx + hy * dy) / hl;
      if (Math.abs(along) > 3) continue;
      const run = lat > 0 ? track.runL[i] : track.runR[i];
      if (Math.abs(lat) < track.w[i] + run + margin) return false;
    }
    return true;
  };

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
      const pts = simplify(fit ? shapeXY(ring) : ring.map(g => toXY(g.lat, g.lon)));
      if (pts.length < 3 || area2(pts) < 18) continue;
      if (fit && !pts.every(p => clearOf(p[0], p[1], 4))) continue;
      buildings.push({ h: Math.round(heightOf(tg) * 10) / 10, p: pts, ...extra });
    }
  }

  const areas = [];
  const counts = {};
  for (const el of lJson.elements || []) {
    if (!el.geometry || el.geometry.length < 4) continue;
    let kind = classify(el.tags);
    if (!kind) continue;
    // A New England town's residential land is LAWN, not concrete: "urban"
    // painted Pembroke's golf-course neighbourhood as a car park.
    if (fit && kind === 'urban' && el.tags.landuse === 'residential') kind = 'park';
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
    if (fit && !clearOf(x, y, 3)) continue;
    trees.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  // Streets, for a fitted track only. Densified to 4 m so the cut at the
  // circuit is clean, then split into pieces wherever a point is not clear.
  const roads = [];
  if (fit) {
    await sleep(3000);
    console.log('  streets…');
    const rJson = await overpass(
      `[out:json][timeout:180];(way["highway"](${box}););out geom;`,
      raw + `${key}-roads.json`, force);
    for (const el of rJson.elements || []) {
      const rw = ROAD_W[el.tags && el.tags.highway];
      if (!rw || !el.geometry || el.geometry.length < 2) continue;
      const line = el.geometry.map(g => toXY(g.lat, g.lon));
      let piece = [];
      const flush = () => {
        if (piece.length > 1) roads.push({ w: rw, p: piece.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });
        piece = [];
      };
      for (let k = 0; k < line.length - 1; k++) {
        const [a, b] = [line[k], line[k + 1]];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
        for (let j = 0; j < steps + (k === line.length - 2 ? 1 : 0); j++) {
          const p = [a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps];
          if (clearOf(p[0], p[1], rw / 2 + 1)) piece.push(p); else flush();
        }
      }
      flush();
    }
    for (const r of roads) r.p = simplify(r.p, 3.5);

    // THE WOODS. Pembroke is New England: trees everywhere that is not a
    // yard, a field, the golf course or water — and OpenStreetMap has almost
    // none of them mapped (the tree query came back empty). Left out, the town
    // stood on bare grass and read as desolate. So the survey still decides
    // everything that IS mapped, and the woods fill what is left: every 30 m
    // cell whose centre is well clear of houses, streets, the circuit and any
    // mapped open land. Runs along a row are merged into one rectangle.
    const pip = (x, y, poly) => {
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a], [xb, yb] = poly[b];
        if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) inside = !inside;
      }
      return inside;
    };
    const open = areas.filter(a => a.k !== 'forest');
    const cent = buildings.map(b => [b.p.reduce((t, q) => t + q[0], 0) / b.p.length, b.p.reduce((t, q) => t + q[1], 0) / b.p.length]);
    const streetPts = [];
    for (const r of roads) for (let k = 0; k < r.p.length - 1; k++) {
      const [a, b] = [r.p[k], r.p[k + 1]], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let j = 0; j <= m; j++) streetPts.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]);
    }
    const far = (x, y, pts, r) => pts.every(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 > r * r);
    const C = 30, wx0 = bb.x0 - PAD, wy0 = bb.y0 - PAD;
    const nxC = Math.ceil((bb.x1 - bb.x0 + 2 * PAD) / C), nyC = Math.ceil((bb.y1 - bb.y0 + 2 * PAD) / C);
    let woodCells = 0;
    for (let j = 0; j < nyC; j++) {
      let run = -1;
      const flushRun = i => {
        if (run < 0) return;
        const xa = wx0 + run * C, xb = wx0 + i * C, ya = wy0 + j * C, yb = ya + C;
        areas.push({ k: 'forest', p: [[xa, ya], [xb, ya], [xb, yb], [xa, yb]] });
        run = -1;
      };
      for (let i = 0; i <= nxC; i++) {
        const x = wx0 + (i + 0.5) * C, y = wy0 + (j + 0.5) * C;
        const wood = i < nxC && clearOf(x, y, 25) && far(x, y, cent, 38) && far(x, y, streetPts, 22)
          && !open.some(a => pip(x, y, a.p));
        if (wood) { if (run < 0) run = i; woodCells++; } else flushRun(i);
      }
    }
    // Yard trees: a New England house stands among big old maples and pines.
    // Three per house, 11-20 m out, never on a street, the circuit or a
    // neighbour.
    let yard = 0;
    for (const [cx, cy] of cent) {
      for (let k = 0; k < 3; k++) {
        const a = seededN(cx, cy, k) * Math.PI * 2, d = 11 + seededN(cy, cx, k + 5) * 9;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (!clearOf(x, y, 4) || !far(x, y, streetPts, 7) || !far(x, y, cent, 9)) continue;
        trees.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
        yard++;
      }
    }
    console.log(`  woods: ${woodCells} cells of 30 m; ${yard} yard trees`);
  }

  const out = {
    key, full: track.full, lat0, lon0, pad: PAD,
    bbox: { x0: bb.x0 - PAD, y0: bb.y0 - PAD, x1: bb.x1 + PAD, y1: bb.y1 + PAD },
    buildings, areas, sea, trees, ...(fit ? { roads } : {}),
  };
  const file = ROOT + `data/env/${key}.json`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  const kinds = {};
  for (const b of buildings) if (b.k) kinds[b.k] = (kinds[b.k] || 0) + 1;
  const tagged = buildings.filter(b => b.c).length, roofed = buildings.filter(b => b.rc).length;
  console.log(`  -> ${buildings.length} buildings, ${areas.length} areas, ${sea.length} sea, ${trees.length} trees, ${roads.length} street pieces, ${kb}KB`);
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
