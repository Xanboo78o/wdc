// bakelandmarks.mjs — the things that make each real circuit instantly itself.
//
// Adam, 2026-09-28: "compare our tracks to their irl counterparts... all tracks
// should meet their irl counterpart almost perfect". The city, the woods and
// the ground are already surveyed (bakeenv.mjs). What they cannot carry is the
// handful of objects a viewer recognises a circuit BY: Monza's old banking
// crossing over the road, the Monaco tunnel and the yachts in Port Hercule,
// Suzuka's Ferris wheel, Baku's old city walls, the dunes of Zandvoort, the
// castle on the hill above the Nürburgring.
//
//   node tools/bakelandmarks.mjs [track|all] [--force]
//
// NOTHING HERE IS GUESSED. Every position comes from one of three places, and
// each item in data/landmarks/<key>.json says which in its `src`:
//   1. OpenStreetMap, by element id, from one Overpass query per circuit,
//      cached under data/env/raw/<key>-landmarks.json (re-running is free);
//   2. the circuit's own geometry — a tunnel is the stretch of lap that an
//      OSM tunnel way projects onto, never a pair of numbers typed in;
//   3. the env bake itself (sea, water, buildings) for things like where a
//      yacht can float.
// Dimensions that no survey carries (how tall a banking is, how big a Ferris
// wheel is) are real published figures, and the comment beside each says so.
//
// Same projection as bakeenv.mjs: the circuit's own lat0/lon0, metres east and
// north. js/landmarks.js reads the output.
import fs from 'fs';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const args = process.argv.slice(2);
for (const a of args) if (a.startsWith('--') && a !== '--force') { console.error(`unknown flag ${a}`); process.exit(2); }
const force = args.includes('--force');
const which = args.find(a => !a.startsWith('--')) || 'all';

async function overpass(query, cacheFile) {
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
      }
      console.log(`    ${res.status} from ${new URL(url).host}, backing off ${wait / 1000}s`);
    } catch (e) { console.log(`    ${e.message}, backing off ${wait / 1000}s`); }
    await sleep(wait);
    wait = Math.min(wait * 1.6, 60000);
  }
  throw new Error('Overpass would not answer');
}

// One query per circuit: everything the SPEC below picks from, by id.
const QUERY = {
  monza: `[out:json][timeout:120];(way["highway"="raceway"](45.60,9.26,45.65,9.31);way["building"="tower"](45.60,9.26,45.65,9.31);nwr["man_made"="tower"](45.61,9.27,45.64,9.30););out body geom;`,
  monaco: `[out:json][timeout:120];(way["tunnel"](43.726,7.412,43.748,7.438);nwr["man_made"~"pier|breakwater|quay"](43.726,7.412,43.748,7.438);nwr["leisure"~"marina|sports_centre"](43.726,7.412,43.748,7.438);nwr(around:90,43.73916,7.42802)["building"];nwr["name"~"Sainte-Dévote|Rascasse|Casino",i](43.728,7.415,43.745,7.435);way["building"](around:60,43.73745,7.42991););out body geom;`,
  suzuka: `[out:json][timeout:120];(nwr["attraction"](34.83,136.51,34.86,136.56);nwr["tourism"="theme_park"](34.83,136.51,34.86,136.56);way["bridge"]["highway"="raceway"](34.83,136.51,34.86,136.56);way["name"="ピットビル"](34.83,136.51,34.86,136.56););out body geom;`,
  zandvoort: `[out:json][timeout:120];(nwr["man_made"="tower"]["tower:type"="radar"](52.37,4.52,52.41,4.57);nwr["building"="grandstand"](52.37,4.52,52.41,4.57);way["name"~"Hugenholtzbocht|Arie Luyendykbocht|Tarzanbocht"](52.37,4.52,52.41,4.57););out body geom;`,
  baku: `[out:json][timeout:120];(way["place"="neighbourhood"]["material"="stone"](40.36,49.828,40.372,49.842);way["name"="Qız Qalası"](40.36,49.83,40.37,49.84);way["man_made"="tower"](40.36,49.83,40.37,49.84);way["landuse"]["name"="Flame Towers"](40.355,49.815,40.365,49.83);way["building"]["building:levels"](around:140,40.3595,49.8266);way["name"="Hökumət Evi"](40.37,49.84,40.38,49.86););out body geom;`,
  nurburgring: `[out:json][timeout:120];(way(around:200,50.3467,6.9535)["historic"];way(around:200,50.3467,6.9535)["man_made"="tower"];way(around:200,50.3467,6.9535)["building"];way["highway"="raceway"](50.31,6.91,50.35,6.97);way["building"="grandstand"](50.31,6.91,50.35,6.97););out body geom;`,
};

// ---------------------------------------------------------------------------
function context(key) {
  const env = JSON.parse(fs.readFileSync(ROOT + `data/env/${key}.json`, 'utf8'));
  const t = JSON.parse(fs.readFileSync(ROOT + `data/tracks/${key}.json`, 'utf8'));
  const { lat0, lon0 } = env;
  const mx = 111320 * Math.cos(lat0 * Math.PI / 180), my = 110540;
  const r1 = v => Math.round(v * 10) / 10;
  const loc = (lat, lon) => [r1((lon - lon0) * mx), r1((lat - lat0) * my)];
  const n = t.x.length;
  // Nearest centreline sample, signed lateral offset (+ = left of travel).
  const near = (x, y) => {
    let b = Infinity, bi = 0;
    for (let i = 0; i < n; i++) { const d = (t.x[i] - x) ** 2 + (t.y[i] - y) ** 2; if (d < b) { b = d; bi = i; } }
    const j = (bi + 1) % n, hx = t.x[j] - t.x[bi], hy = t.y[j] - t.y[bi], hl = Math.hypot(hx, hy) || 1;
    return { i: bi, s: bi * t.ds, d: Math.sqrt(b), lat: (-hy * (x - t.x[bi]) + hx * (y - t.y[bi])) / hl };
  };
  // Inside the racing corridor: tarmac, run-off and `margin` for the barrier.
  const onCircuit = (x, y, margin = 4) => {
    const q = near(x, y);
    const run = q.lat > 0 ? t.runL[q.i] : t.runR[q.i];
    return Math.abs(q.lat) < t.w[q.i] + run + margin;
  };
  return { env, t, loc, near, onCircuit, r1 };
}

function elements(raw) {
  const byId = new Map();
  for (const e of raw.elements) {
    let geom = e.geometry || null;
    if (!geom && e.members) geom = e.members.filter(m => m.role !== 'inner').flatMap(m => m.geometry || []);
    byId.set(`${e.type[0]}${e.id}`, { ...e, geom });
  }
  return byId;
}

const inside = (p, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const centroid = ring => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];

// Chain OSM ways into one polyline by shared end nodes, in the order given by
// the first way. Returns [{x, y, tag}] with `tag` the source way's own tags.
function chain(ways, C) {
  const pieces = ways.map(w => ({ w, pts: w.geom.map(g => C.loc(g.lat, g.lon)), ids: w.nodes }));
  const out = [];
  const used = new Set();
  let cur = pieces[0];
  used.add(cur);
  let pts = cur.pts.map(p => ({ p, w: cur.w }));
  let tail = cur.ids[cur.ids.length - 1];
  for (;;) {
    const next = pieces.find(q => !used.has(q) && (q.ids[0] === tail || q.ids[q.ids.length - 1] === tail));
    if (!next) break;
    used.add(next);
    const fwd = next.ids[0] === tail;
    const np = fwd ? next.pts : next.pts.slice().reverse();
    pts = pts.concat(np.slice(1).map(p => ({ p, w: next.w })));
    tail = fwd ? next.ids[next.ids.length - 1] : next.ids[0];
  }
  for (const q of pieces) if (!used.has(q)) console.log(`    chain: way ${q.w.id} did not join`);
  out.push(...pts);
  return out;
}

// Resample a polyline to even spacing, carrying a per-point flag.
function resample(pts, step, flag) {
  const out = [];
  let acc = 0;
  out.push({ p: pts[0].p, f: flag(pts[0]) });
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1].p, b = pts[k].p, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = step - acc;
    while (d <= L) {
      const u = d / L;
      out.push({ p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], f: flag(pts[k]) });
      d += step;
    }
    acc = L - (d - step);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per circuit: which elements, and what each becomes.
// ---------------------------------------------------------------------------
const SPEC = {
  // MONZA. The 1955 high-speed oval: two banked curves (Sopraelevata Nord and
  // Sud) joined by a back straight, with its front straight shared with the
  // road course's pit straight. Its north banking crosses OVER the road course
  // between Lesmo and Ascari — the bridge every Monza onboard passes under.
  // Mapped in OSM as historic=ruins raceways; chained here in running order.
  monza(C, E) {
    const items = [];
    const oval = ['w1313097098', 'w19982933', 'w725687995', 'w725687994', 'w34404729', 'w34404730',
      'w231256008', 'w231256009', 'w34404638', 'w19983025', 'w1313098146', 'w1313098145'].map(id => E.get(id)).filter(Boolean);
    const line = chain(oval, C);
    const rs = resample(line, 4, q => ({ bridge: q.w.tags.bridge === 'yes', id: q.w.id }));
    // Where the banking passes over the road course: the one bridge way whose
    // points straddle the circuit. Its crossing s is measured, not typed.
    const cross = E.get('w34404729');
    const cp = cross.geom.map(g => C.loc(g.lat, g.lon));
    const mid = [(cp[0][0] + cp[1][0]) / 2, (cp[0][1] + cp[1][1]) / 2];
    const cq = C.near(mid[0], mid[1]);
    // Signed curvature over +-24 m, so the bank rises on the OUTSIDE.
    const P = rs.map(q => q.p);
    const kap = P.map((_, i) => {
      const a = P[Math.max(0, i - 6)], b = P[i], c = P[Math.min(P.length - 1, i + 6)];
      const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
      const cr = abx * bcy - aby * bcx;
      const la = Math.hypot(abx, aby), lb = Math.hypot(bcx, bcy), lc = Math.hypot(c[0] - a[0], c[1] - a[1]);
      return la && lb && lc ? 2 * cr / (la * lb * lc) : 0;
    });
    // Distance ALONG THE OVAL to the crossing, so the deck's ramps run
    // continuously through the approaches rather than per clipped piece.
    const dc = rs.map(() => Infinity);
    rs.forEach((q, i) => { if (q.f.id === 34404729) dc[i] = 0; });
    for (let i = 1; i < rs.length; i++) dc[i] = Math.min(dc[i], dc[i - 1] + 4);
    for (let i = rs.length - 2; i >= 0; i--) dc[i] = Math.min(dc[i], dc[i + 1] + 4);
    const seg = [];
    let curSeg = null;
    rs.forEach((q, i) => {
      const [x, y] = q.p;
      // Never on the road course's tarmac or run-off — except over it on
      // the bridge and its approaches, which are in the air.
      const keep = dc[i] <= 72 ? true : !C.onCircuit(x, y, 6);
      if (!keep) { curSeg = null; return; }
      if (!curSeg) { curSeg = { pts: [], k: [], b: [], c: [] }; seg.push(curSeg); }
      curSeg.pts.push([C.r1(x), C.r1(y)]);
      curSeg.k.push(Math.round(kap[i] * 1e5) / 1e5);
      curSeg.b.push(q.f.bridge ? 1 : 0);
      curSeg.c.push(dc[i] < 400 ? dc[i] : -1);
    });
    items.push({
      type: 'oval', name: 'Anello di alta velocità — Sopraelevata Nord and Sud',
      src: 'OSM raceways ' + oval.map(w => w.id).join(',') + ' (historic=ruins), chained by shared nodes, resampled to 4 m; clipped 6 m clear of the road course',
      // Published figures: 1955 oval, banked curves of ~320 m radius with a
      // slope reaching 80% at the rim; the concrete lip stands ~9 m above the
      // infield. Width of the concrete carriageway ~12 m.
      width: 12, rim: 8.5,
      crossS: cq.s, crossSrc: `OSM way 34404729 (bridge=yes) projected onto the lap: s=${cq.s}`,
      segs: seg.filter(s => s.pts.length > 3),
    });
    const pod = E.get('w219396377');
    if (pod) {
      const ring = pod.geom.map(g => C.loc(g.lat, g.lon));
      const c = centroid(ring), q = C.near(c[0], c[1]);
      items.push({ type: 'podium', name: 'Podio (the podium over the pit straight)', src: 'OSM way 219396377 (building=tower, bridge=yes)', ring, s: q.s, lat: C.r1(q.lat) });
    }
    return items;
  },

  // MONACO.
  monaco(C, E) {
    const items = [];
    // The tunnel: Boulevard Louis II's layer=-1 stretch, under the Fairmont.
    const tw = E.get('w4230891');
    const ss = tw.geom.map(g => { const [x, y] = C.loc(g.lat, g.lon); return C.near(x, y).s; });
    const s0 = Math.min(...ss), s1 = Math.max(...ss);
    items.push({ type: 'tunnel', name: 'The tunnel, under the Fairmont Monte Carlo', src: `OSM way 4230891 (Boulevard Louis II, layer=-1, lit=24/7) projected onto the lap: s ${s0}-${s1}`, s0, s1, height: 6.4 });
    // Everything the env bake put ON the racing surface inside that stretch is
    // standing over the tunnel (the Fairmont, the Auditorium Rainier III, the
    // flats beside it). They are rebuilt on its roof, at their surveyed size.
    const over = [];
    const tr = C.t;
    for (const b of C.env.buildings) {
      if (b.k === 'grandstand') continue;
      let hit = false;
      for (let i = Math.floor(s0 / tr.ds); i <= Math.ceil(s1 / tr.ds) && !hit; i++) {
        const j = (i + 1) % tr.x.length, hx = tr.x[j] - tr.x[i], hy = tr.y[j] - tr.y[i], hl = Math.hypot(hx, hy) || 1;
        for (const l of [0, tr.w[i], -tr.w[i]]) if (inside([tr.x[i] - hy / hl * l, tr.y[i] + hx / hl * l], b.p)) { hit = true; break; }
      }
      if (hit) over.push({ p: b.p, h: b.h, k: b.k || null });
    }
    items.push({ type: 'overTunnel', name: 'Buildings standing over the tunnel', src: 'data/env/monaco.json footprints that cover the racing surface between s0 and s1 of the tunnel', buildings: over });

    // Port Hercule and Fontvieille: every OSM pontoon and quay, and the yachts
    // moored stern-to along their edges. A berth is kept only if the whole
    // yacht floats — its centre and bow inside the surveyed sea or water.
    const water = [...(C.env.sea || []), ...(C.env.areas || []).filter(a => a.k === 'water').map(a => a.p || a)]
      .map(w => (Array.isArray(w[0]) ? w : w.p)).filter(Boolean);
    const wet = (x, y) => water.some(r => inside([x, y], r));
    const piers = [...E.values()].filter(e => e.geom && e.tags && /pier|quay/.test(e.tags.man_made || ''));
    const yachts = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pierRings = [];
    for (const pr of piers) {
      const ring = pr.geom.map(g => C.loc(g.lat, g.lon));
      pierRings.push({ ring, id: pr.id, kind: pr.tags.man_made, floating: pr.tags.floating === 'yes' });
      for (let k = 0; k + 1 < ring.length; k++) {
        const a = ring[k], b = ring[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 10) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (const side of [1, -1]) {
          const nx = -uy * side, ny = ux * side;
          let d = 3;
          while (d < L - 3) {
            // Real Port Hercule: 15-25 m motor yachts on the inner pontoons,
            // superyachts to 90 m on the outer quays.
            const len = 12 + Math.pow(rnd(), 2.2) * (L > 90 ? 60 : 22);
            const beam = len * 0.22;
            const cx = a[0] + ux * (d + beam / 2) + nx * (len / 2 + 1.2), cy = a[1] + uy * (d + beam / 2) + ny * (len / 2 + 1.2);
            const bx = a[0] + ux * (d + beam / 2) + nx * (len + 1.5), by = a[1] + uy * (d + beam / 2) + ny * (len + 1.5);
            const ok = wet(cx, cy) && wet(bx, by) && !pierRings.some(r => inside([cx, cy], r.ring)) && !C.onCircuit(cx, cy, 8);
            if (ok && rnd() > 0.12) {
              yachts.push([C.r1(cx), C.r1(cy), Math.round(Math.atan2(ny, nx) * 1000) / 1000, Math.round(len * 10) / 10, rnd() < 0.18 ? 1 : 0]);
            }
            d += beam + 1.2 + rnd() * 1.5;
          }
        }
      }
    }
    // A yacht moored off two pontoons at once overlaps itself; keep the first.
    const kept = [];
    for (const y of yachts) if (!kept.some(k => Math.hypot(k[0] - y[0], k[1] - y[1]) < (k[3] + y[3]) * 0.28)) kept.push(y);
    items.push({ type: 'piers', name: 'Pontoons and quays of Port Hercule and Fontvieille', src: 'OSM man_made=pier|quay (' + piers.length + ' elements)', rings: pierRings.map(r => ({ ring: r.ring, osm: r.id, floating: r.floating })) });
    items.push({ type: 'yachts', name: 'Yachts moored in Port Hercule', src: 'stern-to berths along every OSM pontoon edge, kept only where the hull floats inside the surveyed sea (data/env/monaco.json)', note: '[x, y, heading(rad, bow direction), length m, sail?]', list: kept });

    const pool = E.get('w197170037');
    if (pool) items.push({ type: 'pool', name: 'Stade Nautique Rainier III', src: 'OSM way 197170037 (leisure=sports_centre, sport=swimming)', ring: pool.geom.map(g => C.loc(g.lat, g.lon)), basin: [50, 21] });

    const casino = E.get('w161769674');
    if (casino) {
      const ring = casino.geom.map(g => C.loc(g.lat, g.lon));
      // The facade is the run of footprint vertices facing Casino Square — the
      // ones within 16 m of the lap between Massenet and Casino.
      const front = ring.filter(p => { const q = C.near(p[0], p[1]); return q.s > 740 && q.s < 820 && Math.abs(q.lat) < 16; });
      const byS = front.map(p => ({ p, s: C.near(p[0], p[1]).s })).sort((a, b) => a.s - b.s);
      items.push({ type: 'casino', name: 'Casino de Monte-Carlo', src: 'OSM way 161769674 (the casino block on Place du Casino; amenity=casino node 4416197079 stands at its facade); facade = its vertices within 16 m of the lap, s 740-820', a: byS[0].p, b: byS[byS.length - 1].p, ring });
    }
    const dev = E.get('w94399398');
    if (dev) items.push({ type: 'chapel', name: 'Chapelle Sainte-Dévote', src: 'OSM way 94399398 (building=church)', ring: dev.geom.map(g => C.loc(g.lat, g.lon)) });
    return items;
  },
};

// SUZUKA. The Ferris wheel of the Motopia amusement park beyond the main
// straight, the grandstand opposite the pits, and the figure-eight bridge.
SPEC.suzuka = (C, E) => {
  const items = [];
  const wheel = E.get('w184107083');
  if (wheel) {
    const ring = wheel.geom.map(g => C.loc(g.lat, g.lon));
    // The footprint is the A-frame's feet: its longest span is the wheel's
    // plane, and that span is its diameter (Suzuka's wheel is ~50 m tall).
    let best = 0, a = null, b = null;
    for (const p of ring) for (const q of ring) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; a = p; b = q; } }
    const c = centroid(ring.slice(0, -1));
    items.push({ type: 'wheel', name: 'Suzuka Circuit Wheel (Motopia)', src: 'OSM way 184107083 (attraction=big_wheel): centre = footprint centroid, plane and diameter = its longest span', c: [C.r1(c[0]), C.r1(c[1])], dir: Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) * 1000) / 1000, d: C.r1(best), cars: 32 });
  }
  const gs = E.get('w183394069');
  if (gs) items.push({ type: 'stands', name: 'Main grandstand, opposite the pits', src: 'OSM way 183394069 (building=yes, grandstand=yes) — built by crowd.js like every surveyed stand', list: [{ p: gs.geom.map(g => C.loc(g.lat, g.lon)).slice(0, -1), h: 16 }] });
  const br = E.get('w175231434');
  if (br) {
    const ss = br.geom.map(g => { const [x, y] = C.loc(g.lat, g.lon); return C.near(x, y).s; });
    items.push({ type: 'crossover', name: 'The figure-eight bridge (130R side over the Degner-hairpin leg)', src: `OSM way 175231434 (highway=raceway, bridge=yes) projected onto the lap: s ${Math.min(...ss)}-${Math.max(...ss)}`, s0: Math.min(...ss) - 14, s1: Math.max(...ss) + 14 });
  }
  return items;
};

// ZANDVOORT. The dunes are already sand in the env bake; what they lack is
// the marram grass that holds them, and the 50 m Rijkswaterstaat radar tower
// that stands behind Tarzan and is in every start shot.
SPEC.zandvoort = (C, E) => {
  const items = [];
  const radar = [...E.values()].find(e => e.tags && e.tags['tower:type'] === 'radar');
  if (radar) {
    const [x, y] = C.loc(radar.lat, radar.lon);
    items.push({ type: 'lattice', name: 'Rijkswaterstaat radar tower', src: `OSM node ${radar.id} (man_made=tower, tower:type=radar, height=${radar.tags.height}, tower:construction=lattice)`, p: [x, y], h: +radar.tags.height || 50 });
  }
  // Marram: scattered over every sand and scrub polygon within 320 m of the
  // lap, never on the circuit. Seeded, so it grows back identically.
  const polys = (C.env.areas || []).filter(a => a.k === 'sand' || a.k === 'scrub');
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const tufts = [];
  const bb = C.env.bbox;
  for (let k = 0; k < 400000 && tufts.length < 7000; k++) {
    const x = bb.x0 + rnd() * (bb.x1 - bb.x0), y = bb.y0 + rnd() * (bb.y1 - bb.y0);
    const q = C.near(x, y);
    if (q.d > 220) continue;
    if (C.onCircuit(x, y, 5)) continue;
    const poly = polys.find(a => inside([x, y], a.p));
    if (!poly) continue;
    // Denser on open sand than in scrub, where the bushes take over.
    if (poly.k === 'scrub' && rnd() < 0.5) continue;
    tufts.push([C.r1(x), C.r1(y), Math.round((0.7 + rnd() * 0.8) * 100) / 100]);
  }
  items.push({ type: 'marram', name: 'Marram grass on the dunes', src: `scattered (seeded) over the env bake's sand and scrub polygons (OSM natural=sand/beach/scrub via bakeenv), within 220 m of the lap; ${tufts.length} tufts`, list: tufts });
  return items;
};

// BAKU. The walls of İçərişəhər, which the castle section runs along; the
// third Flame Tower and the flame crowns the env bake's flat-topped prisms
// lack.
SPEC.baku = (C, E) => {
  const items = [];
  const wall = [...E.values()].find(e => e.tags && e.tags.material === 'stone' && e.tags.place === 'neighbourhood');
  if (wall) {
    const ring = wall.geom.map(g => C.loc(g.lat, g.lon));
    // Split into runs that stay clear of the circuit's run-off.
    const runs = [];
    let cur = null;
    for (const p of resample(ring.map(p => ({ p })), 3, () => 0)) {
      if (C.onCircuit(p.p[0], p.p[1], 2.5)) { cur = null; continue; }
      if (!cur) { cur = []; runs.push(cur); }
      cur.push([C.r1(p.p[0]), C.r1(p.p[1])]);
    }
    items.push({ type: 'citywall', name: 'Walls of İçərişəhər (the Old City)', src: `OSM way ${wall.id} (İçəri Şəhər, place=neighbourhood, material=stone: the walled city's outline), resampled to 3 m, clipped 2.5 m clear of the run-off`, runs: runs.filter(r => r.length > 2), h: 9, towerEvery: 42 });
  }
  const flames = [...E.values()].filter(e => e.tags && e.tags.building && (+e.tags.height > 100 || +e.tags['building:levels'] >= 28));
  const fz = [...E.values()].find(e => e.tags && e.tags.name === 'Flame Towers');
  items.push({ type: 'flames', name: 'Flame Towers', src: `OSM buildings with height>100 inside the Flame Towers site (way ${fz ? fz.id : '?'}): ` + flames.map(f => `${f.id} h=${f.tags.height || '-'} levels=${f.tags['building:levels'] || '-'}`).join(', '),
    towers: flames.map(f => ({ ring: f.geom.map(g => C.loc(g.lat, g.lon)).slice(0, -1), h: +f.tags.height || 3.2 * +f.tags['building:levels'], lv: +f.tags['building:levels'] || null })),
    site: fz ? fz.geom.map(g => C.loc(g.lat, g.lon)) : null });
  return items;
};

// NÜRBURGRING. The ruined castle on its hill above the village (keep 20 m,
// curtain wall, towers) and the Nordschleife where it meets the GP circuit.
SPEC.nurburgring = (C, E) => {
  const items = [];
  const vals = [...E.values()].filter(e => e.geom);
  const curtain = vals.find(e => e.tags && e.tags.barrier === 'city_wall' && e.tags.historic === 'castle');
  const towers = vals.filter(e => e.tags && e.tags['castle:tower'] === 'yes');
  if (curtain) items.push({ type: 'castle', name: 'Nürburg (castle ruin)', src: `OSM way ${curtain.id} (barrier=city_wall, historic=castle) + towers ${towers.map(t => t.id).join(',')}`,
    wall: curtain.geom.map(g => C.loc(g.lat, g.lon)), towers: towers.map(t => ({ ring: t.geom.map(g => C.loc(g.lat, g.lon)).slice(0, -1), h: +t.tags.height || (t.tags.defensive === 'Bergfried' ? 20 : 11) })) });
  const nords = vals.filter(e => e.tags && e.tags.highway === 'raceway' && /Hatzenbach|Hocheichen|Hohenrain|Sabine|Hatzenbogen|^T13$|Anbindung zur Nordschleife/.test(e.tags.name || ''));
  const runs = [];
  for (const w of nords) {
    let cur = null;
    for (const p of resample(w.geom.map(g => ({ p: C.loc(g.lat, g.lon) })), 4, () => 0)) {
      if (C.onCircuit(p.p[0], p.p[1], 3)) { cur = null; continue; }
      if (!cur) { cur = []; runs.push(cur); }
      cur.push([C.r1(p.p[0]), C.r1(p.p[1])]);
    }
  }
  items.push({ type: 'ribbon', name: 'Nordschleife (Hatzenbach, Hocheichen, Hohenrain, Sabine-Schmitz-Kurve, T13)', src: 'OSM raceways ' + nords.map(w => `${w.id} ${w.tags.name}`).join('; ') + ' — resampled to 4 m, clipped 3 m clear of the GP circuit', width: 9, runs: runs.filter(r => r.length > 2) });
  return items;
};

async function bake(key) {
  if (!QUERY[key] || !SPEC[key]) { console.log(`  ${key}: no landmark spec yet`); return; }
  const C = context(key);
  const raw = await overpass(QUERY[key], ROOT + `data/env/raw/${key}-landmarks.json`);
  const E = elements(raw);
  const items = SPEC[key](C, E);
  const out = { key, made: new Date().toISOString().slice(0, 10), projection: { lat0: C.env.lat0, lon0: C.env.lon0 }, items };
  fs.mkdirSync(ROOT + 'data/landmarks', { recursive: true });
  const file = ROOT + `data/landmarks/${key}.json`;
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`  ${key}: ${items.map(i => i.type).join(', ')}  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

const keys = which === 'all' ? Object.keys(SPEC) : [which];
for (const k of keys) await bake(k);
