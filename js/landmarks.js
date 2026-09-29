// landmarks.js — the objects a circuit is recognised BY.
//
// The surveyed city (env.js), the woods and the ground make a circuit look like
// a real place. They do not make it look like THAT place. What does is a short
// list every fan could draw from memory: Monza's old banking arching over the
// road, the Monaco tunnel and the yachts, Suzuka's Ferris wheel, Baku's walls,
// the Zandvoort dunes, the castle over the Nürburgring. This module builds
// those, and only those.
//
// Positions come from data/landmarks/<key>.json, baked by
// tools/bakelandmarks.mjs from OpenStreetMap (by element id), the circuit's
// own geometry and the env bake — every item there carries a `src` saying
// which. Nothing is placed by eye.
//
// Budget: each landmark is merged into one mesh per material, and anything
// repeated (yachts, towers, lamps) is instanced, so a circuit's whole set costs
// a handful of draw calls. It arrives a moment after the world, like the
// woods: the circuit is drivable before the last yacht is moored.
//
// SURFACES (see the ground note in DESIGN.md): a thing standing on the grass
// stands on World.groundY; anything built over the road is measured from the
// ROAD, World.trackYAt(s) — a tunnel roof hung from grass level would sit in
// the tarmac wherever the ground was sunk under the circuit.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { buildGrandstands } from './crowd.js';

// Stretches of lap that run UNDER something. Anything the env bake stood on
// the racing surface inside one of these is a building over a tunnel, and has
// to come out before env.js merges the city — it is rebuilt on the tunnel roof
// from data/landmarks/<key>.json. Measured by tools/bakelandmarks.mjs (OSM way
// 4230891, Boulevard Louis II, layer=-1, projected onto the lap); the loader
// warns if the baked file ever disagrees.
const COVERED = { monaco: [[1476, 1836]] };

// Env-bake buildings a landmark REPLACES rather than decorates: the flat-topped
// prisms env.js extrudes for the Flame Towers (OSM ways 253081850/253082095,
// centroids as baked in data/env/baku.json) poke out of the tapered flames.
// Matched by footprint centroid, within 8 m, and only if taller than 50 m.
const REPLACED = { baku: [[-1186, -1080], [-1272, -998]] };

const VER = new URL(import.meta.url).searchParams.get('v') || '';

function coversRoad(t, ring, s0, s1) {
  const inside = (px, py) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  for (let s = s0; s <= s1; s += t.ds) {
    const i = t.idx(s), h = t.hdg[i];
    for (const l of [0, t.w[i], -t.w[i]]) {
      if (inside(t.x[i] - Math.sin(h) * l, t.y[i] + Math.cos(h) * l)) return true;
    }
  }
  return false;
}

/**
 * Called by render.js BEFORE env.js builds the city. The synchronous part
 * clears the buildings that stand over a tunnel; the rest loads and builds in
 * the background. Returns a stats object that fills in as it goes.
 */
export function placeLandmarks(view, env) {
  const t = view.track, key = t.key;
  const stats = { items: 0, draws: 0, removed: 0 };
  if (env && env.buildings && COVERED[key]) {
    const before = env.buildings.length;
    env.buildings = env.buildings.filter(b => b.k === 'grandstand'
      || !COVERED[key].some(([a, c]) => coversRoad(t, b.p, a, c)));
    stats.removed = before - env.buildings.length;
  }
  if (env && env.buildings && REPLACED[key]) {
    const before = env.buildings.length;
    env.buildings = env.buildings.filter(b => {
      if (!(b.h > 50)) return true;
      const cx = b.p.reduce((a, q) => a + q[0], 0) / b.p.length, cy = b.p.reduce((a, q) => a + q[1], 0) / b.p.length;
      return !REPLACED[key].some(([x, y]) => Math.hypot(cx - x, cy - y) < 8);
    });
    stats.removed += before - env.buildings.length;
  }
  if (new URLSearchParams(location.search).has('nolandmarks')) return stats;
  fetch(`./data/landmarks/${key}.json${VER ? '?v=' + VER : ''}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => { if (data) build(view, env, data, stats); })
    .catch(e => console.error('landmarks:', e));
  return stats;
}

function build(view, env, data, stats) {
  const G = new THREE.Group();
  G.name = 'landmarks';
  const ctx = { view, env, t: view.track, world: view.world, look: view.look, G, stats, data };
  for (const it of data.items) {
    const fn = BUILD[it.type];
    if (!fn) continue;
    try { fn(it, ctx); stats.items++; } catch (e) { console.error(`landmark ${it.type}:`, e); }
  }
  G.traverse(o => { if (o.isMesh) stats.draws++; });
  view.scene.add(G);
  view.landmarks = G;
  // ?lmnosea hides the env sea, to inspect what is under a mis-datumed one.
  if (new URLSearchParams(location.search).has('lmnosea')) view.scene.traverse(o => { if (o.isMesh && o.material && o.material.color && o.material.color.getHex() === 0x2b4a5e) o.visible = false; });
}

// ---------------------------------------------------------------------------
// Small kit.
// ---------------------------------------------------------------------------
const gY = (ctx, x, y) => (ctx.world ? ctx.world.groundY(x, Z(y)) : 0);
const rY = (ctx, s) => (ctx.world ? ctx.world.trackYAt(s) : 0);
const put = (ctx, b, mat, opts) => { const m = b.mesh(mat, opts); if (m) ctx.G.add(m); return m; };
const lowest = (ctx, ring) => Math.min(...ring.map(p => gY(ctx, p[0], p[1])));
const toXZ = ring => ring.map(p => [p[0], Z(p[1])]);

function mats(ctx) {
  if (ctx._m) return ctx._m;
  const L = ctx.look;
  ctx._m = {
    concrete: L.mat('concrete', { size: 3, tint: 0xd2cfc8, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, vertexColors: true }),
    pale: L.mat('concrete', { size: 3, tint: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, vertexColors: true }),
    plaster: L.mat('plaster', { size: 3, tint: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide, vertexColors: true }),
    metal: L.mat('metal', { size: 2, tint: 0xc8ccd2, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide, vertexColors: true }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 1.8, roughness: 0.4 }),
  };
  return ctx._m;
}

// A lateral point beside the lap, in three-space.
function side(t, s, lat) { const p = t.point(s, lat); return [p.x, Z(p.y)]; }

// ---------------------------------------------------------------------------
// Builders by type.
// ---------------------------------------------------------------------------
const BUILD = {};

// ---- MONACO: the tunnel --------------------------------------------------------
// A curved concrete tube 360 m long under the Fairmont, lit from the ceiling,
// that the whole field goes through flat out. Walls stand just outside the
// barriers; the roof slab is thick enough to carry the hotel above it.
BUILD.tunnel = (it, ctx) => {
  const { t } = ctx, M = mats(ctx);
  const [cs0, cs1] = (COVERED[t.key] || [[null, null]])[0];
  if (cs0 !== it.s0 || cs1 !== it.s1) console.warn(`landmarks: tunnel baked at ${it.s0}-${it.s1}, COVERED says ${cs0}-${cs1}`);
  const H = it.height || 6.4, SLAB = 1.6;
  const inner = new Builder({ color: true });     // walls + ceiling, inside
  const outer = new Builder({ color: true });     // outside faces, portals
  const lamps = [];
  const wallLat = i => [t.w[i] + t.runL[i] + 0.7, -(t.w[i] + t.runR[i] + 0.7)];
  const step = 2;
  const ceilCol = [0.78, 0.77, 0.74], wallCol = [0.86, 0.85, 0.82], dado = [0.30, 0.31, 0.33];
  let u = 0;
  for (let s = it.s0; s < it.s1; s += step) {
    const i = t.idx(s), j = t.idx(s + step);
    const y0 = rY(ctx, s), y1 = rY(ctx, s + step);
    const [la, ra] = wallLat(i), [lb, rb] = wallLat(j);
    const A = side(t, s, la), B = side(t, s + step, lb), C = side(t, s, ra), D = side(t, s + step, rb);
    const du = step;
    for (const [p, q] of [[A, B], [D, C]]) {
      // A dark 1.1 m band at the foot (tyre marks and grime), pale above.
      inner.quadN([p[0], y0 - 0.4, p[1]], [q[0], y1 - 0.4, q[1]], [q[0], y1 + 1.1, q[1]], [p[0], y0 + 1.1, p[1]],
        [[u, 0], [u + du, 0], [u + du, 1.5], [u, 1.5]], dado);
      inner.quadN([p[0], y0 + 1.1, p[1]], [q[0], y1 + 1.1, q[1]], [q[0], y1 + H, q[1]], [p[0], y0 + H, p[1]],
        [[u, 1.5], [u + du, 1.5], [u + du, H], [u, H]], wallCol);
    }
    inner.quadN([A[0], y0 + H, A[1]], [B[0], y1 + H, B[1]], [D[0], y1 + H, D[1]], [C[0], y0 + H, C[1]],
      [[0, u], [0, u + du], [12, u + du], [12, u]], ceilCol);
    // Outside: the roof slab's top, and the walls down to whatever ground
    // is outside them (the sea side drops away to the harbour).
    const top0 = y0 + H + SLAB, top1 = y1 + H + SLAB;
    outer.quadN([A[0], top0, A[1]], [B[0], top1, B[1]], [D[0], top1, D[1]], [C[0], top0, C[1]],
      [[0, u], [0, u + du], [12, u + du], [12, u]], [0.62, 0.61, 0.58]);
    for (const [p, q] of [[A, B], [D, C]]) {
      const g0 = Math.min(y0 - 0.5, gY(ctx, p[0], -p[1]) - 0.5), g1 = Math.min(y1 - 0.5, gY(ctx, q[0], -q[1]) - 0.5);
      outer.quadN([p[0], g0, p[1]], [q[0], g1, q[1]], [q[0], top1, q[1]], [p[0], top0, p[1]],
        [[u, g0], [u + du, g1], [u + du, top1], [u, top0]], [0.74, 0.72, 0.68]);
    }
    // Two rows of ceiling lamps, one every 4 m.
    if (Math.round((s - it.s0) / step) % 2 === 0) {
      for (const f of [0.3, -0.3]) {
        const p = side(t, s, (la + ra) / 2 + f * (la - ra) * 0.5);
        lamps.push([p[0], y0 + H - 0.08, p[1], t.hdg[i]]);
      }
    }
    u += du;
  }
  // Portals: the face of the slab and the building above, over each mouth.
  for (const s of [it.s0, it.s1]) {
    const i = t.idx(s), [la, ra] = wallLat(i), y = rY(ctx, s);
    const A = side(t, s, la + 6), C = side(t, s, ra - 6);
    outer.quadN([A[0], y + H, A[1]], [C[0], y + H, C[1]], [C[0], y + H + SLAB + 0.6, C[1]], [A[0], y + H + SLAB + 0.6, A[1]],
      [[0, 0], [20, 0], [20, 2], [0, 2]], [0.9, 0.89, 0.86]);
    // Side returns: the portal is set into a retaining face, not floating.
    for (const [lat0, lat1] of [[la, la + 6], [ra, ra - 6]]) {
      const p = side(t, s, lat0), q = side(t, s, lat1);
      const g = Math.min(y - 0.5, gY(ctx, q[0], -q[1]) - 0.5);
      outer.quadN([p[0], g, p[1]], [q[0], g, q[1]], [q[0], y + H + SLAB + 0.6, q[1]], [p[0], y + H + SLAB + 0.6, p[1]],
        [[0, 0], [6, 0], [6, 8], [0, 8]], [0.9, 0.89, 0.86]);
    }
  }
  const mi = put(ctx, inner, M.concrete, { shadow: true });
  if (mi) mi.name = 'landmark.tunnel';
  put(ctx, outer, M.plaster, { shadow: true });
  // Lamps: one instanced box each, emissive, so the bloom picks them up.
  const lg = new THREE.BoxGeometry(1.6, 0.12, 0.34);
  const im = new THREE.InstancedMesh(lg, M.lamp, lamps.length);
  const o = new THREE.Object3D();
  lamps.forEach((l, k) => { o.position.set(l[0], l[1], l[2]); o.rotation.set(0, l[3], 0); o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
  im.castShadow = false; im.receiveShadow = false;
  ctx.G.add(im);
  ctx.tunnel = it;
};

// ---- MONACO: the buildings on the tunnel roof ---------------------------------
// The Fairmont and its neighbours, rebuilt at their surveyed footprint and
// height. Any wall that stands over the tunnel starts on its roof; the rest go
// down to the ground, so from the harbour the hotel still meets the quay.
BUILD.overTunnel = (it, ctx) => {
  const { t } = ctx, M = mats(ctx);
  const tun = ctx.tunnel || ctx.data.items.find(x => x.type === 'tunnel');
  if (!tun) return;
  const H = (tun.height || 6.4) + 1.6;
  const s0 = tun.s0, s1 = tun.s1;
  // Is a point (sim metres) over the tunnel? Returns the roof height there.
  const hint = t.idx((s0 + s1) / 2), win = Math.ceil((s1 - s0) / t.ds / 2) + 60;
  const roofAt = (x, y) => {
    const q = t.project(x, y, hint, win);
    const s = q.s;
    if (s < s0 - 1 || s > s1 + 1) return null;
    const i = t.idx(s);
    const lat = q.lat;
    if (lat > t.w[i] + t.runL[i] + 1.5 || lat < -(t.w[i] + t.runR[i] + 1.5)) return null;
    return rY(ctx, s) + H;
  };
  const wall = new Builder({ color: true }), roof = new Builder({ color: true }), glass = new Builder();
  const cols = [[0.92, 0.88, 0.8], [0.86, 0.84, 0.8], [0.95, 0.93, 0.88]];
  it.buildings.forEach((b, bi) => {
    const ring = b.p;
    const roofMax = Math.max(...ring.map(p => roofAt(p[0], p[1]) ?? -1e9),
      ...Array.from({ length: 12 }, (_, k) => {
        const a = ring[k % ring.length], c = ring[(k * 5 + 3) % ring.length];
        return roofAt((a[0] + c[0]) / 2, (a[1] + c[1]) / 2) ?? -1e9;
      }));
    const base = Math.max(roofMax, lowest(ctx, ring));
    const top = base + (b.h || 10);
    const col = cols[bi % cols.length];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], c = ring[(k + 1) % ring.length];
      // Sample along the edge: over the tunnel, the wall stands on the roof.
      let over = false;
      for (let f = 0; f <= 1.0001; f += 0.1) if (roofAt(a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f) != null) { over = true; break; }
      const ga = over ? base : Math.min(base, gY(ctx, a[0], a[1]) - 0.3);
      const gc = over ? base : Math.min(base, gY(ctx, c[0], c[1]) - 0.3);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      wall.quadN([a[0], ga, Z(a[1])], [c[0], gc, Z(c[1])], [c[0], top, Z(c[1])], [a[0], top, Z(a[1])],
        [[0, ga], [L, gc], [L, top], [0, top]], col);
      // Windows: a band per storey, a pane every 3.6 m.
      const nx = -(Z(c[1]) - Z(a[1])) / (L || 1), nz = (c[0] - a[0]) / (L || 1);
      for (let y = base + 3.2; y < top - 1.2; y += 3.2) {
        for (let d = 1.4; d < L - 1.4; d += 3.6) {
          const x0 = a[0] + (c[0] - a[0]) * (d / L), z0 = Z(a[1]) + (Z(c[1]) - Z(a[1])) * (d / L);
          const x1 = a[0] + (c[0] - a[0]) * ((d + 1.8) / L), z1 = Z(a[1]) + (Z(c[1]) - Z(a[1])) * ((d + 1.8) / L);
          const o = 0.06;
          glass.quadN([x0 + nx * o, y, z0 + nz * o], [x1 + nx * o, y, z1 + nz * o], [x1 + nx * o, y + 1.7, z1 + nz * o], [x0 + nx * o, y + 1.7, z0 + nz * o],
            [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
      }
    }
    roof.fan(toXZ(ring), top, [0.55, 0.55, 0.53]);
    // The underside where the building bridges the road: seen from inside
    // the portals and from the harbour.
    roof.fan(toXZ(ring), base + 0.02, [0.5, 0.5, 0.48]);
  });
  put(ctx, wall, M.plaster);
  put(ctx, roof, M.concrete);
  put(ctx, glass, M.glass, { shadow: false });
};

// ---- MONACO: pontoons ----------------------------------------------------------
BUILD.piers = (it, ctx) => {
  const M = mats(ctx);
  const b = new Builder({ color: true });
  const water = waterLevel(ctx);
  for (const r of it.rings) {
    if (r.ring.length < 3) continue;
    const g = lowest(ctx, r.ring);
    // Floating pontoons ride 60 cm above the water; fixed quays stand on the
    // ground, which here is the harbour edge.
    const y = r.floating ? Math.max(water, -1e9) + 0.6 : Math.max(g, water + 1.2);
    const ring = toXZ(r.ring);
    b.fan(ring, y, [0.52, 0.5, 0.47]);
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], c = ring[(k + 1) % ring.length];
      b.quadN([a[0], y - 1.2, a[1]], [c[0], y - 1.2, c[1]], [c[0], y, c[1]], [a[0], y, a[1]],
        [[0, 0], [1, 0], [1, 1], [0, 1]], [0.42, 0.41, 0.39]);
    }
  }
  put(ctx, b, M.concrete, { shadow: false });
};

// The height of the water the yachts float on: the env bake's sea where there
// is one, else the ground (a harbour basin is surveyed as water AT ground).
function waterLevel(ctx) {
  if (ctx._water != null) return ctx._water;
  // world.seaY is the real water line (elevation data); use it when present.
  if (ctx.world && Number.isFinite(ctx.world.seaY)) { ctx._water = ctx.world.seaY; return ctx._water; }
  let y = null;
  ctx.view.scene.traverse(o => {
    if (y != null || !o.isMesh || !o.material || o.material.map) return;
    const c = o.material.color;
    if (c && c.getHex && c.getHex() === 0x2b4a5e && o.geometry) {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (bb.max.y - bb.min.y < 0.5 && bb.max.x - bb.min.x > 300) y = bb.max.y;
    }
  });
  // Never above the quays. A harbour's water is a metre or so under its
  // pontoon edge; if the sea mesh ever sits higher than that (a datum change
  // in the elevation data) the boats follow the harbour, not the bad sea.
  const piers = ctx.data.items.find(i => i.type === 'piers');
  let quay = Infinity;
  if (piers) for (const r of piers.rings) if (!r.floating) quay = Math.min(quay, lowest(ctx, r.ring));
  ctx._water = Math.min(y ?? 0, Number.isFinite(quay) ? quay - 0.5 : Infinity);
  return ctx._water;
}

// ---- MONACO: yachts --------------------------------------------------------------
// One hull, lofted once at unit length and instanced for every berth: white
// topsides, a dark boot stripe, teak deck, a stepped superstructure with a
// black glass band. Sailing yachts get a mast instead of the top two decks.
function yachtGeometry(sail) {
  const b = new Builder({ color: true, uv: true });
  const white = [0.93, 0.93, 0.92], boot = [0.10, 0.13, 0.18], teak = [0.55, 0.40, 0.25], glassC = [0.06, 0.08, 0.1];
  // Plan: x along the hull (-0.5 stern .. +0.5 bow), z across; beam 0.2.
  // Never exactly zero at the stem: a quad that collapses to a line has no
  // normal, the shader normalises (0,0,0) into NaN, and bloom spreads one NaN
  // pixel into a black square over every yacht.
  const half = x => (x < 0.18 ? 0.1 : 0.1 * Math.max(0.03, 1 - ((x - 0.18) / 0.32) ** 1.6));
  const N = 10, xs = [];
  for (let k = 0; k <= N; k++) xs.push(-0.5 + k / N);
  const yb = -0.02, yt = 0.075, yd = 0.078;
  for (let k = 0; k < N; k++) {
    const x0 = xs[k], x1 = xs[k + 1], h0 = half(x0), h1 = half(x1);
    for (const sgn of [1, -1]) {
      b.quadN([x0, yb, sgn * h0 * 0.8], [x1, yb, sgn * h1 * 0.8], [x1, 0.012, sgn * h1], [x0, 0.012, sgn * h0], [[0, 0], [1, 0], [1, 1], [0, 1]], boot);
      b.quadN([x0, 0.012, sgn * h0], [x1, 0.012, sgn * h1], [x1, yt + 0.02 * (x1 + 0.5), sgn * h1], [x0, yt + 0.02 * (x0 + 0.5), sgn * h0], [[0, 0], [1, 0], [1, 1], [0, 1]], white);
    }
    b.quadN([x0, yd + 0.02 * (x0 + 0.5), -h0], [x1, yd + 0.02 * (x1 + 0.5), -h1], [x1, yd + 0.02 * (x1 + 0.5), h1], [x0, yd + 0.02 * (x0 + 0.5), h0], [[0, 0], [1, 0], [1, 1], [0, 1]], teak);
  }
  // Transom.
  b.quadN([-0.5, yb, -0.08], [-0.5, yb, 0.08], [-0.5, yt, 0.1], [-0.5, yt, -0.1], [[0, 0], [1, 0], [1, 1], [0, 1]], white);
  if (!sail) {
    b.box(-0.02, yd + 0.045, 0, 0.5, 0.05, 0.17, 0, white);
    b.box(-0.02, yd + 0.045, 0, 0.44, 0.022, 0.172, 0, glassC);
    b.box(-0.06, yd + 0.095, 0, 0.34, 0.05, 0.15, 0, white);
    b.box(-0.06, yd + 0.095, 0, 0.3, 0.02, 0.152, 0, glassC);
    b.box(-0.08, yd + 0.14, 0, 0.18, 0.04, 0.12, 0, white);
    b.box(-0.06, yd + 0.175, 0, 0.02, 0.05, 0.02, 0, [0.8, 0.8, 0.8]);
  } else {
    b.box(-0.12, yd + 0.03, 0, 0.26, 0.035, 0.12, 0, white);
    b.box(-0.12, yd + 0.03, 0, 0.22, 0.014, 0.122, 0, glassC);
    b.box(0.08, yd + 0.6, 0, 0.012, 1.2, 0.012, 0, [0.85, 0.85, 0.86]);
    b.box(-0.08, yd + 0.12, 0, 0.32, 0.012, 0.01, 0, [0.85, 0.85, 0.86]);
  }
  return b.geometry();
}

BUILD.yachts = (it, ctx) => {
  const M = mats(ctx);
  const water = waterLevel(ctx);
  for (const sail of [0, 1]) {
    const list = it.list.filter(y => y[4] === sail);
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(yachtGeometry(sail), M.paint, list.length);
    const o = new THREE.Object3D();
    list.forEach((y, k) => {
      const [x, yy, hd, len] = y;
      o.position.set(x, water, Z(yy));
      // Sim heading -> three: the unit hull points +x; rotation.y = h.
      o.rotation.set(0, hd, 0);
      o.scale.setScalar(len);
      o.updateMatrix();
      im.setMatrixAt(k, o.matrix);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.name = sail ? 'landmark.yachts.sail' : 'landmark.yachts';
    ctx.G.add(im);
  }
};

// ---- MONACO: the swimming pool ---------------------------------------------------
BUILD.pool = (it, ctx) => {
  const M = mats(ctx);
  const ring = it.ring;
  const y = lowest(ctx, ring) + 0.05;
  const deck = new Builder({ color: true });
  deck.fan(toXZ(ring), y, [0.9, 0.89, 0.86]);
  put(ctx, deck, M.concrete, { shadow: false });
  // The basin: 50 x 21 m, laid along the footprint's long axis at its centre.
  let ux = 1, uy = 0, best = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], c = ring[(k + 1) % ring.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L > best) { best = L; ux = (c[0] - a[0]) / L; uy = (c[1] - a[1]) / L; }
  }
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const [BL, BW] = it.basin;
  const corner = (a, c) => [cx + ux * a - uy * c, Z(cy + uy * a + ux * c)];
  const q = [corner(-BL / 2, -BW / 2), corner(BL / 2, -BW / 2), corner(BL / 2, BW / 2), corner(-BL / 2, BW / 2)];
  const water = new THREE.MeshStandardMaterial({ color: 0x2aa7c9, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.4,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const wb = new Builder();
  wb.quadUp(q, y + 0.03);
  const wm = put(ctx, wb, water, { shadow: false });
  if (wm) wm.name = 'landmark.pool';
  // Lane ropes.
  const lanes = new Builder({ color: true });
  for (let k = 1; k < 8; k++) {
    const c = -BW / 2 + k * BW / 8;
    const a = corner(-BL / 2, c), bb = corner(BL / 2, c);
    const nx = -uy * 0.06, nz = -ux * 0.06;
    lanes.quad([a[0] - nx, y + 0.06, a[1] - nz], [bb[0] - nx, y + 0.06, bb[1] - nz], [bb[0] + nx, y + 0.06, bb[1] + nz], [a[0] + nx, y + 0.06, a[1] + nz],
      [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], k % 2 ? [0.9, 0.15, 0.1] : [0.95, 0.95, 0.95]);
  }
  put(ctx, lanes, M.paint, { shadow: false });
};

// ---- MONACO: Casino de Monte-Carlo -------------------------------------------------
// The env bake has the casino block as a two-storey box. What makes it THE
// casino from Casino Square is its facade: two corner towers with copper-green
// cupolas and the high central front between them.
BUILD.casino = (it, ctx) => {
  const M = mats(ctx);
  const [ax, ay] = it.a, [bx, by] = it.b;
  const g = Math.min(gY(ctx, ax, ay), gY(ctx, bx, by));
  const L = Math.hypot(bx - ax, by - ay), fx = (bx - ax) / L, fy = (by - ay) / L;
  // Inward: toward the footprint's centre.
  const c = it.ring.reduce((a, p) => [a[0] + p[0] / it.ring.length, a[1] + p[1] / it.ring.length], [0, 0]);
  let nx = -fy, ny = fx;
  if ((c[0] - ax) * nx + (c[1] - ay) * ny < 0) { nx = -nx; ny = -ny; }
  const b = new Builder({ color: true }), roof = new Builder({ color: true });
  const stone = [0.93, 0.87, 0.74], copper = [0.35, 0.58, 0.5];
  const P = (a, d) => [ax + fx * a + nx * d, ay + fy * a + ny * d];
  const hd = Math.atan2(Z(fy), fx);
  // Central front block: two tall storeys of arched bays, a cornice, and a
  // copper attic with the clock over the middle.
  const m = P(L / 2, 8);
  b.box(m[0], g + 7, Z(m[1]), L - 8, 14, 16, -hd, stone);
  const cor = P(L / 2, 7.6);
  b.box(cor[0], g + 14.3, Z(cor[1]), L - 7, 0.9, 17, -hd, [0.97, 0.93, 0.83]);
  b.box(cor[0], g + 7.2, Z(cor[1]), L - 7.5, 0.5, 16.6, -hd, [0.97, 0.93, 0.83]);
  // Bays: dark glass inside a pale frame, every 4.2 m along the facade.
  for (let a = 8; a < L - 8; a += 4.2) {
    for (const [y0, hgt] of [[1.2, 5.2], [8.2, 5.0]]) {
      const w = P(a, -0.12);
      b.box(w[0], g + y0 + hgt / 2, Z(w[1]), 2.8, hgt + 0.6, 0.25, -hd, [0.99, 0.96, 0.88]);
      const w2 = P(a, -0.2);
      b.box(w2[0], g + y0 + hgt / 2 - 0.2, Z(w2[1]), 2.0, hgt - 0.4, 0.2, -hd, [0.16, 0.14, 0.12]);
    }
  }
  // Towers at both ends of the facade, with copper domes and lanterns.
  const domes = [];
  for (const a of [3.5, L - 3.5]) {
    const p = P(a, 3.5);
    b.box(p[0], g + 11, Z(p[1]), 7.5, 22, 7.5, -hd, stone);
    b.box(p[0], g + 22.3, Z(p[1]), 8.3, 0.8, 8.3, -hd, [0.97, 0.93, 0.83]);
    const w = P(a, -0.3);
    b.box(w[0], g + 17.5, Z(w[1]), 2.4, 4.5, 0.2, -hd, [0.16, 0.14, 0.12]);
    domes.push([p[0], g + 22.7, Z(p[1])]);
    roof.box(p[0], g + 29.4, Z(p[1]), 1.2, 2.6, 1.2, -hd, [0.8, 0.7, 0.35]);
  }
  const pd = P(L / 2, 2.5);
  roof.box(pd[0], g + 16.5, Z(pd[1]), L * 0.3, 3.4, 4, -hd, copper);
  const clk = P(L / 2, 0.4);
  roof.box(clk[0], g + 16.6, Z(clk[1]), 2.2, 2.2, 0.2, -hd, [0.95, 0.92, 0.8]);
  const domeM = new THREE.MeshStandardMaterial({ color: 0x5f9c86, roughness: 0.5, metalness: 0.45 });
  for (const d of domes) {
    const dm = new THREE.Mesh(new THREE.SphereGeometry(3.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeM);
    dm.scale.y = 1.55;
    dm.position.set(d[0], d[1], d[2]);
    dm.castShadow = true;
    ctx.G.add(dm);
  }
  put(ctx, b, M.plaster);
  put(ctx, roof, M.metal);
};

// ---- MONACO: Chapelle Sainte-Dévote -------------------------------------------------
BUILD.chapel = (it, ctx) => {
  const M = mats(ctx);
  const ring = it.ring;
  const g = lowest(ctx, ring);
  const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
  // The longest edge sets the nave's axis; the bell tower stands at its end.
  let ux = 1, uy = 0, best = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], d = ring[(k + 1) % ring.length], L = Math.hypot(d[0] - a[0], d[1] - a[1]);
    if (L > best) { best = L; ux = (d[0] - a[0]) / L; uy = (d[1] - a[1]) / L; }
  }
  const hd = Math.atan2(Z(uy), ux);
  const b = new Builder({ color: true });
  const ochre = [0.93, 0.82, 0.62], tile = [0.62, 0.32, 0.22];
  // Pitched roof ridge over the nave.
  b.box(c[0], g + 8.6, Z(c[1]), best * 0.9, 1.2, 5.5, -hd, tile);
  const tp = [c[0] + ux * best * 0.45, c[1] + uy * best * 0.45];
  b.box(tp[0], g + 8, Z(tp[1]), 3.6, 16, 3.6, -hd, ochre);
  b.box(tp[0], g + 16.8, Z(tp[1]), 4.2, 1.6, 4.2, -hd, [0.96, 0.9, 0.78]);
  b.box(tp[0], g + 18.5, Z(tp[1]), 2.2, 2.2, 2.2, -hd, tile);
  put(ctx, b, M.plaster);
};

// ---- MONZA: the old banking ---------------------------------------------------------
// The 1955 oval's concrete curves, each a ribbon that rises from grass level on
// its inside edge to the rim on the outside, with a vertical outer face down to
// the ground and a guard rail on the lip. Where it crosses over the road course
// it is carried on a deck high enough to clear an F1 car by a comfortable
// margin, ramping back to grade either side.
BUILD.oval = (it, ctx) => {
  const { t } = ctx, M = mats(ctx);
  const W = it.width || 12, RIM = it.rim || 8.5;
  const deck = rY(ctx, it.crossS) + 6.2;          // underside clears the road by ~5 m
  const surf = new Builder({ color: true }), face = new Builder({ color: true }), rail = new Builder({ color: true });
  const posts = [];
  for (const sg of it.segs) {
    const P = sg.pts, n = P.length;
    // Base height: the ground, or the crossing's deck ramped in at 4% by the
    // baked distance along the oval (`c`, -1 = far from it).
    const base = P.map((p, k) => {
      const g = gY(ctx, p[0], p[1]);
      const d = sg.c ? sg.c[k] : -1;
      return d >= 0 ? Math.max(g, deck - d * 0.04) : g;
    });
    // Which points hang over the road course (tarmac + run-off + 1.5 m).
    const over = P.map(p => {
      const q = t.project(p[0], p[1]);
      return Math.abs(q.lat) < q.w + q.run + 1.5;
    });
    // Bank: rises with curvature (a 320 m radius curve is the full rim).
    const bank = sg.k.map(k => Math.min(1, Math.abs(k) * 320) * RIM);
    const sm = bank.map((_, k) => { let a = 0, c = 0; for (let d = -5; d <= 5; d++) { const q = bank[k + d]; if (q != null) { a += q; c++; } } return a / c; });
    const X = [], lastU = [];
    let u = 0;
    for (let k = 0; k < n; k++) {
      const p = P[k], q = P[Math.min(n - 1, k + 1)], o = P[Math.max(0, k - 1)];
      let dx = q[0] - o[0], dy = q[1] - o[1];
      const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
      const lx = -dy, ly = dx;                    // left of the oval's travel
      const out = (sg.k[k] >= 0 ? -1 : 1);        // outside of the curve
      // Cross-section: 6 stations from inside (grade) to rim.
      const row = [];
      for (let j = 0; j <= 6; j++) {
        const f = j / 6;
        const off = (f - 0.5) * W * out * -1;     // from inside edge (-out) to outside (+out)
        const x = p[0] - lx * off, y = p[1] - ly * off;
        const lift = sm[k] * Math.pow(f, 1.9);
        row.push([x, base[k] + lift + 0.05, Z(y)]);
      }
      X.push(row);
      if (k > 0) u += Math.hypot(p[0] - P[k - 1][0], p[1] - P[k - 1][1]);
      lastU.push(u);
    }
    // Weathered concrete, streaked darker along the lower third where the
    // water runs off it.
    for (let k = 0; k + 1 < n; k++) {
      for (let j = 0; j < 6; j++) {
        const a = X[k][j], b = X[k + 1][j], c = X[k + 1][j + 1], d = X[k][j + 1];
        const shade = 0.9 + 0.1 * (j / 6) + 0.06 * Math.sin(lastU[k] * 0.07 + j) - (j < 2 ? 0.08 : 0);
        surf.quadN(a, b, c, d, [[lastU[k], j * W / 6], [lastU[k + 1], j * W / 6], [lastU[k + 1], (j + 1) * W / 6], [lastU[k], (j + 1) * W / 6]],
          [shade, shade * 0.99, shade * 0.95]);
      }
      // Over the road course the deck is a slab with a soffit, never a wall
      // down to the "ground" — the ground there is the racing surface.
      if (over[k] || over[k + 1]) {
        for (const j of [0, 6]) {
          const a = X[k][j], b = X[k + 1][j];
          face.quadN([a[0], a[1] - 1.1, a[2]], [b[0], b[1] - 1.1, b[2]], [b[0], b[1] + (j ? 1 : 0), b[2]], [a[0], a[1] + (j ? 1 : 0), a[2]],
            [[0, 0], [4, 0], [4, 1], [0, 1]], [0.66, 0.65, 0.62]);
        }
        const a = X[k][0], b = X[k + 1][0], c = X[k + 1][6], d = X[k][6];
        const lo = Math.min(a[1], b[1]) - 1.1;
        face.quadN([a[0], lo, a[2]], [b[0], lo, b[2]], [c[0], lo, c[2]], [d[0], lo, d[2]],
          [[0, 0], [4, 0], [4, W], [0, W]], [0.45, 0.45, 0.44]);
      }
      // Outer face: from the rim down to the ground, and the inner kerb face.
      const r0 = X[k][6], r1 = X[k + 1][6];
      const g0 = gY(ctx, r0[0], -r0[2]) - 0.4, g1 = gY(ctx, r1[0], -r1[2]) - 0.4;
      if (!(over[k] || over[k + 1])) {
      face.quadN([r0[0], g0, r0[2]], [r1[0], g1, r1[2]], [r1[0], r1[1] + 1.0, r1[2]], [r0[0], r0[1] + 1.0, r0[2]],
        [[lastU[k], g0], [lastU[k + 1], g1], [lastU[k + 1], r1[1]], [lastU[k], r0[1]]], [0.66, 0.65, 0.62]);
      const i0 = X[k][0], i1 = X[k + 1][0];
      const h0 = gY(ctx, i0[0], -i0[2]) - 0.4, h1 = gY(ctx, i1[0], -i1[2]) - 0.4;
      if (i0[1] - h0 > 0.6 || i1[1] - h1 > 0.6) {
        face.quadN([i0[0], h0, i0[2]], [i1[0], h1, i1[2]], [i1[0], i1[1], i1[2]], [i0[0], i0[1], i0[2]],
          [[lastU[k], h0], [lastU[k + 1], h1], [lastU[k + 1], i1[1]], [lastU[k], i0[1]]], [0.6, 0.59, 0.56]);
      }
      }
      // The lip: a 1 m parapet, and a rail on posts above it.
      rail.quadN([r0[0], r0[1] + 1.35, r0[2]], [r1[0], r1[1] + 1.35, r1[2]], [r1[0], r1[1] + 1.65, r1[2]], [r0[0], r0[1] + 1.65, r0[2]],
        [[0, 0], [1, 0], [1, 1], [0, 1]], [0.55, 0.57, 0.6]);
      if (k % 2 === 0) posts.push([r0[0], r0[1] + 1.3, r0[2]]);
    }
    // Under a raised stretch, piers every 12 m so the deck reads as carried.
    for (let k = 0; k < n; k += 3) {
      const mid = X[k][3];
      const g = gY(ctx, mid[0], -mid[2]);
      if (X[k][0][1] - g > 2.5 && !over[k]) {
        const p = P[k], q = P[Math.min(n - 1, k + 1)];
        const hd = Math.atan2(Z(q[1] - p[1]), q[0] - p[0]);
        face.box(mid[0], (g + X[k][0][1]) / 2 - 0.3, mid[2], 1.2, X[k][0][1] - g, W * 0.9, -hd, [0.6, 0.59, 0.56]);
      }
    }
  }
  const m = put(ctx, surf, M.pale);
  if (m) m.name = 'landmark.oval';
  put(ctx, face, M.concrete);
  put(ctx, rail, M.metal, { shadow: false });
  if (posts.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), M.metal, posts.length);
    const o = new THREE.Object3D();
    posts.forEach((p, k) => { o.position.set(p[0], p[1], p[2]); o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
    ctx.G.add(im);
  }
  // Abutments either side of the road course where the deck lands.
  const s = it.crossS, i = t.idx(s);
  const y0 = rY(ctx, s);
  const ab = new Builder({ color: true });
  for (const sgn of [1, -1]) {
    const lat = sgn * (t.w[i] + (sgn > 0 ? t.runL[i] : t.runR[i]) + 2.5);
    const p = t.point(s, lat);
    ab.box(p.x, (y0 + deck) / 2 - 0.5, Z(p.y), W + 6, deck - y0 + 1, 2.2, p.hdg, [0.62, 0.61, 0.58]);
  }
  put(ctx, ab, M.concrete);
};

// ---- MONZA: the podium over the pit straight ----------------------------------------
BUILD.podium = (it, ctx) => {
  const { t } = ctx, M = mats(ctx);
  const y0 = rY(ctx, it.s);
  const ring = it.ring;
  const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
  const r = Math.max(...ring.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])));
  const deckY = y0 + 8.5;
  const b = new Builder({ color: true }), g = new Builder();
  // The round deck, a thick rim, and glass balustrade.
  const N = 24;
  const pt = (a, rr) => [c[0] + Math.cos(a) * rr, Z(c[1] + Math.sin(a) * rr)];
  const ringXZ = Array.from({ length: N }, (_, k) => pt(k / N * Math.PI * 2, r));
  b.fan(ringXZ, deckY, [0.92, 0.92, 0.94]);
  b.fan(ringXZ, deckY - 1.2, [0.3, 0.31, 0.34]);
  for (let k = 0; k < N; k++) {
    const a = ringXZ[k], d = ringXZ[(k + 1) % N];
    b.quadN([a[0], deckY - 1.2, a[1]], [d[0], deckY - 1.2, d[1]], [d[0], deckY, d[1]], [a[0], deckY, a[1]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.85, 0.12, 0.14]);
    g.quadN([a[0], deckY, a[1]], [d[0], deckY, d[1]], [d[0], deckY + 1.1, d[1]], [a[0], deckY + 1.1, a[1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // The three steps, P1 in the middle and highest.
  const hd = t.hdg[t.idx(it.s)];
  const fwd = [Math.cos(hd), Math.sin(hd)];
  for (const [off, h] of [[0, 1.0], [-2.2, 0.7], [2.2, 0.45]]) {
    const p = [c[0] + fwd[0] * off, c[1] + fwd[1] * off];
    b.box(p[0], deckY + h / 2, Z(p[1]), 2, h, 1.6, hd, [0.95, 0.95, 0.96]);
  }
  // The walkway back over the pit lane to the pit building (to the right).
  const pr = t.point(it.s, it.lat - 16);
  const cx = c[0], cz = Z(c[1]);
  const dx = pr.x - cx, dz = Z(pr.y) - cz, L = Math.hypot(dx, dz);
  b.box(cx + dx / 2, deckY - 0.4, cz + dz / 2, L, 0.8, 3.2, -Math.atan2(dz, dx), [0.8, 0.8, 0.82]);
  // A slender column under the far side.
  b.box(pr.x, (y0 + deckY) / 2, Z(pr.y), 1.2, deckY - y0, 1.2, 0, [0.7, 0.7, 0.72]);
  put(ctx, b, M.paint);
  const gm = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  put(ctx, g, gm, { shadow: false });
};

// ---- Extra grandstands, built by crowd.js exactly like the surveyed ones --------
BUILD.stands = (it, ctx) => {
  const r = buildGrandstands(ctx.G, ctx.t, { buildings: it.list.map(s => ({ k: 'grandstand', p: s.p, h: s.h })) },
    ctx.look, ctx.world, ctx.view.sign || null);
  ctx.stats.people = (ctx.stats.people || 0) + (r.people || 0);
};

// ---- SUZUKA: the Ferris wheel ----------------------------------------------------------
// Seen over the main grandstand from the start line, and from half the lap.
// A white rim on an A-frame, spokes, and gondolas in the park's candy colours.
// Built as a small group (rim, spokes+legs instanced, gondolas instanced): five
// draw calls for a landmark visible from half the circuit.
BUILD.wheel = (it, ctx) => {
  const R = it.d / 2, g = gY(ctx, it.c[0], it.c[1]);
  const hub = R + 4.5;
  const G = new THREE.Group();
  G.name = 'landmark.wheel';
  G.position.set(it.c[0], g + hub, Z(it.c[1]));
  G.rotation.y = it.dir;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45, metalness: 0.3 });
  for (const z of [-1.4, 1.4]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 6, 72), white);
    rim.position.z = z; rim.castShadow = true;
    G.add(rim);
  }
  const hubM = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4, 12), white);
  hubM.rotation.x = Math.PI / 2;
  G.add(hubM);
  // Spokes and legs: one instanced unit cylinder, stretched and aimed.
  const bars = [];
  const Y = new THREE.Vector3(0, 1, 0);
  const bar = (a, b, r) => bars.push({ a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), r });
  const NS = 24;
  for (let k = 0; k < NS; k++) {
    const an = k / NS * Math.PI * 2;
    for (const z of [-1.4, 1.4]) bar([0, 0, z * 0.6], [Math.cos(an) * R, Math.sin(an) * R, z], 0.12);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bar([0, 0, sz * 1.8], [sx * R * 0.5, -hub, sz * 6], 0.55);
  const bm = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), white, bars.length);
  const o = new THREE.Object3D();
  bars.forEach((b, k) => {
    const d = b.b.clone().sub(b.a), L = d.length();
    o.position.copy(b.a).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(Y, d.normalize());
    o.scale.set(b.r, L, b.r);
    o.updateMatrix(); bm.setMatrixAt(k, o.matrix);
  });
  bm.castShadow = true;
  G.add(bm);
  // Gondolas.
  const n = it.cars || 32;
  const gm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 2.4, 2.4), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }), n);
  const pal = [0xe8433a, 0xf5c02c, 0x2f8fdd, 0x39b36b, 0xf07ab8, 0xffffff];
  const col = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const an = k / n * Math.PI * 2;
    o.position.set(Math.cos(an) * R, Math.sin(an) * R - 1.9, 0);
    o.quaternion.identity(); o.scale.set(1, 1, 1);
    o.updateMatrix(); gm.setMatrixAt(k, o.matrix);
    gm.setColorAt(k, col.setHex(pal[k % pal.length]));
  }
  gm.castShadow = true;
  G.add(gm);
  // A concrete plinth under the frame.
  const base = new Builder({ color: true });
  base.box(0, -hub + 0.4, 0, R * 1.2, 1.2, 16, 0, [0.7, 0.7, 0.7]);
  const bmesh = base.mesh(mats(ctx).concrete);
  if (bmesh) G.add(bmesh);
  ctx.G.add(G);
};

// ---- SUZUKA: the figure-eight bridge ---------------------------------------------
// The road over the bridge is the circuit's own surface; what was missing is
// the BRIDGE — the deck's edge, its parapets, and the abutments either side of
// the leg that runs underneath. Everything hangs off the road's own height
// (trackYAt), so it follows the elevation data rather than asserting one.
BUILD.crossover = (it, ctx) => {
  const { t } = ctx, M = mats(ctx);
  const b = new Builder({ color: true });
  // Where the lower leg passes: the nearest lap sample to the bridge's middle
  // that is NOT on the bridge itself.
  const mid = t.point((it.s0 + it.s1) / 2, 0);
  let lo = null, bd = Infinity;
  for (let i = 0; i < t.n; i++) {
    const s = i * t.ds;
    if (Math.abs(t.gap(s, (it.s0 + it.s1) / 2)) < 200) continue;
    const d = (t.x[i] - mid.x) ** 2 + (t.y[i] - mid.y) ** 2;
    if (d < bd) { bd = d; lo = s; }
  }
  const yLow = rY(ctx, lo);
  let u = 0;
  for (let s = it.s0; s < it.s1; s += 2) {
    const i = t.idx(s);
    const y0 = rY(ctx, s), y1 = rY(ctx, s + 2);
    for (const sg of [1, -1]) {
      const lat0 = sg * (t.w[i] + (sg > 0 ? t.runL[i] : t.runR[i]) + 0.4);
      const p = t.point(s, lat0), q = t.point(s + 2, lat0);
      // Parapet: 1.1 m of concrete on the deck edge, and the deck's fascia.
      b.quadN([p.x, y0 - 1.3, Z(p.y)], [q.x, y1 - 1.3, Z(q.y)], [q.x, y1 + 1.1, Z(q.y)], [p.x, y0 + 1.1, Z(p.y)],
        [[u, 0], [u + 2, 0], [u + 2, 2.4], [u, 2.4]], [0.86, 0.85, 0.82]);
    }
    // Soffit, where there is anything to see under it.
    if (y0 - yLow > 3) {
      const a = t.point(s, t.w[i] + t.runL[i] + 0.4), c = t.point(s, -(t.w[i] + t.runR[i] + 0.4));
      const a2 = t.point(s + 2, t.w[i] + t.runL[i] + 0.4), c2 = t.point(s + 2, -(t.w[i] + t.runR[i] + 0.4));
      b.quadN([a.x, y0 - 1.3, Z(a.y)], [a2.x, y1 - 1.3, Z(a2.y)], [c2.x, y1 - 1.3, Z(c2.y)], [c.x, y0 - 1.3, Z(c.y)],
        [[0, u], [0, u + 2], [20, u + 2], [20, u]], [0.55, 0.55, 0.53]);
    }
    u += 2;
  }
  // Abutments beside the lower leg, up to the deck.
  const yUp = rY(ctx, (it.s0 + it.s1) / 2);
  if (yUp - yLow > 3) {
    const i = t.idx(lo);
    for (const sg of [1, -1]) {
      const p = t.point(lo, sg * (t.w[i] + (sg > 0 ? t.runL[i] : t.runR[i]) + 1.5));
      b.box(p.x, (yLow + yUp - 1.3) / 2 - 0.5, Z(p.y), 26, yUp - 1.3 - yLow + 1, 1.8, p.hdg, [0.8, 0.79, 0.76]);
    }
  }
  const m = put(ctx, b, M.concrete);
  if (m) m.name = 'landmark.crossover';
};

// ---- ZANDVOORT: the radar tower behind Tarzan ------------------------------------
// A 50 m square steel lattice with a radar house and dish on top. Legs and
// cross-bracing are one instanced bar, so the see-through lattice costs one
// draw call.
BUILD.lattice = (it, ctx) => {
  const [x, y] = it.p, g = gY(ctx, x, y), H = it.h;
  const bars = [];
  const V = (a, b2) => bars.push([a, b2]);
  const half = h => 3.2 - 2.0 * (h / H);          // tapers from 6.4 m to 2.4 m
  const corners = h => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [a * half(h), h, c * half(h)]);
  const levels = 10;
  for (let k = 0; k < levels; k++) {
    const h0 = k * H / levels, h1 = (k + 1) * H / levels;
    const A = corners(h0), B = corners(h1);
    for (let j = 0; j < 4; j++) {
      V(A[j], B[j]);                                // leg
      V(A[j], B[(j + 1) % 4]);                      // X bracing
      V(A[(j + 1) % 4], B[j]);
      V(B[j], B[(j + 1) % 4]);                      // ring
    }
  }
  const M = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.5, metalness: 0.6 });
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), M, bars.length);
  const o = new THREE.Object3D(), Y = new THREE.Vector3(0, 1, 0);
  bars.forEach(([a, b2], k) => {
    const A = new THREE.Vector3(x + a[0], g + a[1], Z(y) + a[2]), B = new THREE.Vector3(x + b2[0], g + b2[1], Z(y) + b2[2]);
    const d = B.clone().sub(A), L = d.length();
    o.position.copy(A).addScaledVector(d, 0.5);
    o.quaternion.setFromUnitVectors(Y, d.normalize());
    o.scale.set(0.12, L, 0.12);
    o.updateMatrix(); im.setMatrixAt(k, o.matrix);
  });
  im.castShadow = true;
  im.name = 'landmark.lattice';
  ctx.G.add(im);
  const b = new Builder({ color: true });
  b.box(x, g + H + 1.6, Z(y), 4, 3.2, 4, 0.3, [0.93, 0.93, 0.92]);
  b.box(x, g + H + 3.6, Z(y), 7.5, 0.8, 1.2, 0.3, [0.85, 0.2, 0.15]);   // the scanner bar
  put(ctx, b, mats(ctx).paint);
};

// ---- ZANDVOORT: marram grass --------------------------------------------------------
// Crossed cards with the flora set's grass photograph (data/flora, CC0), one
// instanced mesh. Tall, pale and straw-tipped: marram, not lawn.
BUILD.marram = (it, ctx) => {
  const loader = new THREE.TextureLoader();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9c49a, roughness: 1, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45 });
  loader.load(`./data/flora/grass-c.jpg`, tx => { tx.colorSpace = THREE.SRGBColorSpace; mat.map = tx; mat.needsUpdate = true; });
  loader.load(`./data/flora/grass-a.png`, tx => { mat.alphaMap = tx; mat.needsUpdate = true; });
  const b = new Builder({ uv: true });
  for (const a of [0, Math.PI / 3, 2 * Math.PI / 3]) {
    const cx = Math.cos(a) * 0.55, cz = Math.sin(a) * 0.55;
    b.quad([-cx, 0, -cz], [cx, 0, cz], [cx, 0.9, cz], [-cx, 0.9, -cz], [-cz, 0, cx], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const geo = b.geometry();
  const im = new THREE.InstancedMesh(geo, mat, it.list.length);
  const o = new THREE.Object3D();
  it.list.forEach(([x, y, s], k) => {
    o.position.set(x, gY(ctx, x, y) - 0.05, Z(y));
    o.rotation.set(0, (x * 12.9898 + y * 78.233) % 6.283, 0);
    o.scale.set(s * 1.3, s, s * 1.3);
    o.updateMatrix(); im.setMatrixAt(k, o.matrix);
  });
  im.castShadow = false; im.receiveShadow = true;
  im.name = 'landmark.marram';
  ctx.G.add(im);
};

// ---- BAKU: the walls of the Old City ---------------------------------------------------
// Sandstone curtain wall with a crenellated top and round bastions every
// ~42 m, as the castle section runs beside it. Towers are instanced.
BUILD.citywall = (it, ctx) => {
  const b = new Builder({ color: true });
  const towers = [];
  const H = it.h || 9, T = 2.2;
  const stone = [0.86, 0.74, 0.55], dark = [0.72, 0.6, 0.44];
  for (const run of it.runs) {
    let acc = 0;
    for (let k = 0; k + 1 < run.length; k++) {
      const a = run[k], c = run[k + 1];
      const ga = gY(ctx, a[0], a[1]), gc = gY(ctx, c[0], c[1]);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const nx = -(c[1] - a[1]) / L * T / 2, ny = (c[0] - a[0]) / L * T / 2;
      for (const sg of [1, -1]) {
        const A = [a[0] + nx * sg, Z(a[1] + ny * sg)], C = [c[0] + nx * sg, Z(c[1] + ny * sg)];
        b.quadN([A[0], ga - 1, A[1]], [C[0], gc - 1, C[1]], [C[0], gc + H, C[1]], [A[0], ga + H, A[1]],
          [[acc, 0], [acc + L, 0], [acc + L, H], [acc, H]], sg > 0 ? stone : dark);
      }
      b.quadN([a[0] + nx, ga + H, Z(a[1] + ny)], [c[0] + nx, gc + H, Z(c[1] + ny)], [c[0] - nx, gc + H, Z(c[1] - ny)], [a[0] - nx, ga + H, Z(a[1] - ny)],
        [[0, 0], [1, 0], [1, 1], [0, 1]], stone);
      // Merlons: one every 3 m sample, both faces' worth of a small box.
      b.box((a[0] + c[0]) / 2, (ga + gc) / 2 + H + 0.6, Z((a[1] + c[1]) / 2), 1.3, 1.2, T, Math.atan2(c[1] - a[1], c[0] - a[0]), stone);
      acc += L;
      if (acc > it.towerEvery) { acc = 0; towers.push([c[0], c[1], gc]); }
    }
  }
  const m = put(ctx, b, mats(ctx).plaster);
  if (m) m.name = 'landmark.citywall';
  if (towers.length) {
    const geo = new THREE.CylinderGeometry(4.2, 4.8, H + 2.5, 14);
    geo.translate(0, (H + 2.5) / 2 - 1, 0);
    const im = new THREE.InstancedMesh(geo, ctx.look.mat('plaster', { size: 3, tint: 0xdcc08e, roughness: 1, metalness: 0 }), towers.length);
    const o = new THREE.Object3D();
    towers.forEach(([x, y, g], k) => { o.position.set(x, g, Z(y)); o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
    im.castShadow = true; im.receiveShadow = true;
    ctx.G.add(im);
  }
};

// ---- BAKU: the Flame Towers ---------------------------------------------------------------
// Three glass flames on the hill above the boulevard. Each is its surveyed
// footprint, extruded and tapered to a tip leaning toward the sea; the env
// bake's flat-topped prisms stay inside it. Heights are the published ones
// (182, 161 and ~140 m), matched to the survey's storey counts.
BUILD.flames = (it, ctx) => {
  const glass = new THREE.MeshStandardMaterial({ color: 0x3f5c78, roughness: 0.08, metalness: 0.75, envMapIntensity: 1.8, side: THREE.DoubleSide });
  const byLv = it.towers.slice().sort((a, c) => (c.lv || c.h) - (a.lv || a.h));
  const HEIGHT = [182, 161, 140];
  const b = new Builder({ color: false });
  byLv.forEach((tw, n) => {
    const ring = tw.ring;
    const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
    const g = lowest(ctx, ring);
    const H = HEIGHT[n] || tw.h;
    const STEPS = 14;
    // Lean toward the bay (south-east, the Caspian) as it rises.
    const lean = [0.08, -0.1];
    const at = (p, f) => {
      const k = 1.012 * (1 - Math.pow(f, 2.4) * 0.97);
      return [c[0] + (p[0] - c[0]) * k + lean[0] * f * H * 0.25, g + f * H, Z(c[1] + (p[1] - c[1]) * k + lean[1] * f * H * 0.25)];
    };
    for (let s = 0; s < STEPS; s++) {
      const f0 = s / STEPS, f1 = (s + 1) / STEPS;
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length];
        b.quadN(at(p, f0), at(q, f0), at(q, f1), at(p, f1), [[0, f0 * H], [1, f0 * H], [1, f1 * H], [0, f1 * H]]);
      }
    }
  });
  const m = b.mesh(glass);
  if (m) { m.name = 'landmark.flames'; ctx.G.add(m); }
};

// ---- NÜRBURGRING: the castle -----------------------------------------------------------------
BUILD.castle = (it, ctx) => {
  const b = new Builder({ color: true });
  const stone = [0.62, 0.58, 0.52];
  const ring = it.wall;
  for (let k = 0; k + 1 < ring.length; k++) {
    const a = ring[k], c = ring[k + 1];
    const ga = gY(ctx, a[0], a[1]), gc = gY(ctx, c[0], c[1]);
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    b.quadN([a[0], ga - 2, Z(a[1])], [c[0], gc - 2, Z(c[1])], [c[0], gc + 7, Z(c[1])], [a[0], ga + 7, Z(a[1])],
      [[0, 0], [L, 0], [L, 9], [0, 9]], stone);
  }
  for (const tw of it.towers) {
    const g = lowest(ctx, tw.ring);
    b.prism(toXZ(tw.ring), g - 2, g + tw.h, tw.h > 15 ? [0.66, 0.62, 0.56] : stone, true);
    // Crenellated top on the keep.
    if (tw.h > 15) {
      const c = tw.ring.reduce((a, p) => [a[0] + p[0] / tw.ring.length, a[1] + p[1] / tw.ring.length], [0, 0]);
      tw.ring.forEach((p, k) => { if (k % 2 === 0) b.box(p[0] * 0.9 + c[0] * 0.1, g + tw.h + 0.6, Z(p[1] * 0.9 + c[1] * 0.1), 1.1, 1.2, 1.1, 0, stone); });
    }
  }
  const m = put(ctx, b, mats(ctx).plaster);
  if (m) m.name = 'landmark.castle';
};

// ---- NÜRBURGRING: the Nordschleife -------------------------------------------------------
// Grey tarmac ribbons along the surveyed Nordschleife where it passes the GP
// circuit, with its white edge lines and Armco both sides.
BUILD.ribbon = (it, ctx) => {
  const W = it.width || 9;
  const road = new Builder({ color: true }), rail = new Builder({ color: true });
  for (const run of it.runs) {
    const n = run.length;
    const P = run.map(p => [p[0], p[1], gY(ctx, p[0], p[1]) + 0.12]);
    let u = 0;
    for (let k = 0; k + 1 < n; k++) {
      const a = P[k], c = P[k + 1];
      const o = P[Math.max(0, k - 1)], d = P[Math.min(n - 1, k + 2)];
      const n0 = [-(c[1] - o[1]), c[0] - o[0]], n1 = [-(d[1] - a[1]), d[0] - a[0]];
      const l0 = Math.hypot(...n0) || 1, l1 = Math.hypot(...n1) || 1;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (const [f0, f1, col] of [[-1, -0.97, [2.4, 2.4, 2.3]], [-0.97, 0.97, [0.95, 0.95, 0.95]], [0.97, 1, [2.4, 2.4, 2.3]]]) {
        const pa0 = [a[0] + n0[0] / l0 * W / 2 * f0, a[1] + n0[1] / l0 * W / 2 * f0];
        const pa1 = [a[0] + n0[0] / l0 * W / 2 * f1, a[1] + n0[1] / l0 * W / 2 * f1];
        const pc0 = [c[0] + n1[0] / l1 * W / 2 * f0, c[1] + n1[1] / l1 * W / 2 * f0];
        const pc1 = [c[0] + n1[0] / l1 * W / 2 * f1, c[1] + n1[1] / l1 * W / 2 * f1];
        road.quad([pa0[0], a[2], Z(pa0[1])], [pc0[0], c[2], Z(pc0[1])], [pc1[0], c[2], Z(pc1[1])], [pa1[0], a[2], Z(pa1[1])],
          [0, 1, 0], [[f0 * W / 2, u], [f0 * W / 2, u + L], [f1 * W / 2, u + L], [f1 * W / 2, u]], col);
      }
      for (const sg of [1, -1]) {
        const pa = [a[0] + n0[0] / l0 * (W / 2 + 1.2) * sg, a[1] + n0[1] / l0 * (W / 2 + 1.2) * sg];
        const pc = [c[0] + n1[0] / l1 * (W / 2 + 1.2) * sg, c[1] + n1[1] / l1 * (W / 2 + 1.2) * sg];
        rail.quadN([pa[0], a[2] + 0.45, Z(pa[1])], [pc[0], c[2] + 0.45, Z(pc[1])], [pc[0], c[2] + 0.75, Z(pc[1])], [pa[0], a[2] + 0.75, Z(pa[1])],
          [[0, 0], [1, 0], [1, 1], [0, 1]], [0.8, 0.82, 0.84]);
      }
      u += L;
    }
  }
  const m = put(ctx, road, ctx.look.mat('tarmac', { size: 1.6, tint: 0xa9a7a2, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { shadow: false });
  if (m) m.name = 'landmark.nordschleife';
  put(ctx, rail, mats(ctx).metal, { shadow: false });
};

// ---- BAKU: Government House --------------------------------------------------------------
// The env bake has its ten storeys; what makes it Hökumət Evi from the start
// straight is the stepped central tower rising out of the horseshoe's base.
BUILD.govhouse = (it, ctx) => {
  const [ax, ay] = it.a, [bx, by] = it.b;
  const L = Math.hypot(bx - ax, by - ay), fx = (bx - ax) / L, fy = (by - ay) / L;
  const hd = Math.atan2(fy, fx);
  // Inward, toward the footprint's centre.
  const c = it.ring.reduce((a, p) => [a[0] + p[0] / it.ring.length, a[1] + p[1] / it.ring.length], [0, 0]);
  let nx = -fy, ny = fx;
  const m = [(ax + bx) / 2, (ay + by) / 2];
  if ((c[0] - m[0]) * nx + (c[1] - m[1]) * ny < 0) { nx = -nx; ny = -ny; }
  const p = [m[0] + nx * 8, m[1] + ny * 8];
  const g = lowest(ctx, it.ring), H = it.h;
  const b = new Builder({ color: true });
  const sand = [0.9, 0.8, 0.62], trim = [0.95, 0.88, 0.72];
  b.box(p[0], g + H + 5, Z(p[1]), 26, 10, 14, hd, sand);
  b.box(p[0], g + H + 10.4, Z(p[1]), 27, 0.8, 15, hd, trim);
  b.box(p[0], g + H + 14.5, Z(p[1]), 17, 8, 10, hd, sand);
  b.box(p[0], g + H + 18.9, Z(p[1]), 18, 0.8, 11, hd, trim);
  b.box(p[0], g + H + 22, Z(p[1]), 9, 6, 7, hd, sand);
  b.box(p[0], g + H + 27, Z(p[1]), 1.2, 6, 1.2, hd, [0.85, 0.75, 0.4]);
  // Dark window bays up the tower's faces.
  for (const [w, y0, y1] of [[22, H + 1.5, H + 9], [13, H + 11.5, H + 18]]) {
    for (const s of [1, -1]) {
      const q = [p[0] + nx * s * (w === 22 ? 7.05 : 5.05), p[1] + ny * s * (w === 22 ? 7.05 : 5.05)];
      b.box(q[0], g + (y0 + y1) / 2, Z(q[1]), w, y1 - y0, 0.1, hd, [0.18, 0.2, 0.24]);
    }
  }
  const mm = put(ctx, b, mats(ctx).plaster);
  if (mm) mm.name = 'landmark.govhouse';
};
