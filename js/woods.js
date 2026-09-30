// woods.js — Adam's forest on the real circuits.
//
// js/forest.js knows how to plant a wood along a treeline; this file finds the
// treelines. They come from the survey, not from a formula: walk out from the
// edge of the run-off, square to the track, every few metres, and the first
// surveyed forest polygon you step into is where the wood begins. How far you
// can keep walking and still be inside it is how deep the wood is — which is
// the whole of Adam's "depends on the area". Suzuka's woods come out as strips
// about 14 m deep and Monza's park as 130 m, because that is what they are.
//
// Called from js/env.js in place of the old instanced cones and spheres. If
// the plant photographs in data/flora/ are missing it returns null and env.js
// plants the old trees instead, so a fresh clone still boots.
import * as THREE from 'three';
import { Z } from './geom.js';
import { BuildLook, loadFlora } from './build/look.js';
import { makeKit, Forest, rng } from './forest.js';
import { FOREST } from '../data/env/forest.js';

const STEP = 5;           // m along the track between treeline samples
const SEARCH = 150;       // m out from the run-off: further than this, a wood is scenery, not a treeline
const MARCH = 2;          // m per step of that walk
const JUMP = 8;           // m: a treeline that jumps further than this between samples is two woods
const BEHIND = 70;        // m of canopy lid behind the backdrop, at most
const CLEAR = 1.5;        // m: how close to the run-off a trunk may stand
const GRID = 40;          // m, the lookup grid for polygons and centreline
const FAR_CLEAR = 30;     // m from any run-off before a lone paper tree may stand
// m from the run-off at most. The fine terrain (ground.skirt) reaches 260 m
// from the centreline; past it the coarse plate's 26 m+ chords miss the
// surveyed hills, and tools/groundcheck.mjs measured trees placed out there
// floating 12 m (median) and up to 70 m at Monaco. Beyond this, the horizon's
// own tree masses are the woods.
const REACH = 215;
const HOLE = 12;          // m of open ground a wood may have in it and still be one wood
const OPEN_BAND = 45;     // m behind the run-off checked for buildings before a gap is planted
const BRIDGE_NEAR = 14;   // m: a planted gap's treeline stands no further than this off the run-off
const BRIDGE_DEEP = 45;   // m: and is no deeper than this
const FAR_GAP = 40;       // m: a wood further than this behind the run-off leaves the fence open

// ---------------------------------------------------------------------------
// Two spatial lookups, because both questions are asked a hundred thousand
// times: "am I inside a wood?" and "how far am I from the circuit?".
// ---------------------------------------------------------------------------
function polygonIndex(polys) {
  const cells = new Map();
  polys.forEach((a, k) => {
    const xs = a.p.map(q => q[0]), ys = a.p.map(q => q[1]);
    a.box = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let gx = Math.floor(a.box[0] / GRID); gx <= Math.floor(a.box[1] / GRID); gx++) {
      for (let gy = Math.floor(a.box[2] / GRID); gy <= Math.floor(a.box[3] / GRID); gy++) {
        const key = gx * 100003 + gy;
        let c = cells.get(key);
        if (!c) cells.set(key, c = []);
        c.push(k);
      }
    }
  });
  // Which polygon (x, y) is inside, or -1.
  return (x, y) => {
    const c = cells.get(Math.floor(x / GRID) * 100003 + Math.floor(y / GRID));
    if (!c) return -1;
    for (const k of c) {
      const a = polys[k], b = a.box;
      if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) continue;
      let inside = false;
      const p = a.p;
      for (let j = 0, i = p.length - 1; j < p.length; i = j++) {
        const pj = p[j], pi = p[i];
        if ((pj[1] > y) !== (pi[1] > y) && x < (pi[0] - pj[0]) * (y - pj[1]) / (pi[1] - pj[1]) + pj[0]) inside = !inside;
      }
      if (inside) return k;
    }
    return -1;
  };
}

// Metres between (x, y) and the outer edge of the run-off — negative on the
// circuit itself. Every centreline sample within reach is checked, so where
// the track passes itself (Suzuka's crossover) the NEARER road wins.
function slackIndex(track) {
  const cells = new Map();
  for (let i = 0; i < track.n; i++) {
    const key = Math.floor(track.x[i] / GRID) * 100003 + Math.floor(track.y[i] / GRID);
    let c = cells.get(key);
    if (!c) cells.set(key, c = []);
    c.push(i);
  }
  return (x, y) => {
    const gx = Math.floor(x / GRID), gy = Math.floor(y / GRID);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const c = cells.get((gx + dx) * 100003 + gy + dy);
      if (!c) continue;
      for (const i of c) {
        const d = Math.hypot(track.x[i] - x, track.y[i] - y)
          - (track.w[i] + Math.max(track.runL[i], track.runR[i]));
        if (d < best) best = d;
      }
    }
    return best;
  };
}

// The 10 m tree-cover raster, labelled into connected patches. Returns
// `at(x, y)` -> patch index (offset by `base`, after the OSM polygons) or -1,
// and `patches` shaped like polygons for the loops below ({box, cells}).
const MIN_PATCH = 2;      // cells (200 m²): one lone 10 m pixel is a hedge, not a wood
function coverIndex(c, base) {
  const { nx, ny, cell, x0, y0 } = c;
  const tree = new Uint8Array(nx * ny);
  let k = 0;
  for (const run of c.rle.split(';')) {
    const [v, n] = run.split(',');
    if (+v === 10) tree.fill(1, k, k + +n);
    k += +n;
  }
  const label = new Int32Array(nx * ny).fill(-1);
  const patches = [];
  const stack = [];
  for (let q = 0; q < tree.length; q++) {
    if (!tree[q] || label[q] >= 0) continue;
    const id = patches.length;
    let x0c = Infinity, x1c = -Infinity, y0c = Infinity, y1c = -Infinity, cells = 0;
    stack.push(q); label[q] = id;
    const members = [];
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      const i = p % nx, j = (p / nx) | 0;
      cells++;
      if (i < x0c) x0c = i; if (i > x1c) x1c = i; if (j < y0c) y0c = j; if (j > y1c) y1c = j;
      if (i > 0 && tree[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack.push(p - 1); }
      if (i < nx - 1 && tree[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack.push(p + 1); }
      if (j > 0 && tree[p - nx] && label[p - nx] < 0) { label[p - nx] = id; stack.push(p - nx); }
      if (j < ny - 1 && tree[p + nx] && label[p + nx] < 0) { label[p + nx] = id; stack.push(p + nx); }
    }
    if (cells < MIN_PATCH) for (const p of members) label[p] = -2;
    patches.push({
      k: 'cover', p: [], cells,
      box: [x0 + x0c * cell, x0 + (x1c + 1) * cell, y0 + y0c * cell, y0 + (y1c + 1) * cell],
    });
  }
  const raw = new Uint8Array(nx * ny);
  k = 0;
  for (const run of c.rle.split(';')) { const [v, n] = run.split(','); raw.fill(+v, k, k + +n); k += +n; }
  return {
    patches,
    // The raw class under (x, y): 10 tree, 30 grass, 50 built... (-1 outside).
    cls(x, y) {
      const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
      return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : raw[j * nx + i];
    },
    at(x, y) {
      const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
      const l = label[j * nx + i];
      return l >= 0 ? base + l : -1;
    },
  };
}

// ---------------------------------------------------------------------------
export async function plantWoods(scene, env, track, look, corridor = null, world = null) {
  const renderer = look?.renderer;
  if (!renderer || !env || !track) return null;
  // ?oldtrees: the cones and spheres from before, for a side-by-side.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('oldtrees')) return null;
  const flora = await loadFlora(renderer);
  if (!flora) return null;
  const plants = new BuildLook(renderer, look, flora, {});
  const spec = { ...FOREST._, ...(FOREST[env.key] || FOREST[track.key] || {}) };
  const kit = makeKit(renderer, plants, { conifer: spec.conifer, tall: spec.tall || 1 });
  if (!kit) return null;

  const slack = slackIndex(track);
  const r2 = corridor ? corridor.radius * corridor.radius : 0;
  const inPits = (x, y) => corridor && corridor.pts.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < r2);
  // The world's (x, y) is three's (x, -z).
  const ground = (x, z) => (world ? world.groundY(x, z) : 0);
  // Nothing grows on a cliff. Where two legs of a hillside circuit pass at
  // different heights (Monaco: Beau Rivage 20 m above the harbour front, 40 m
  // across) the ground between is a retaining wall in all but name, and a
  // tree planted on it hangs off it by metres.
  const steep = (x, z) => {
    if (!world) return false;
    const e = 3, gx = world.groundY(x + e, z) - world.groundY(x - e, z), gz = world.groundY(x, z + e) - world.groundY(x, z - e);
    return Math.hypot(gx, gz) / (2 * e) > 0.9;
  };
  // No tree stands inside a building. The treelines never asked, because the
  // satellite does not see trees on a roof; a closed gap or a deeper stack can
  // reach one, and a plane growing through a grandstand is not the park.
  const inBuilding = polygonIndex((env.buildings || []).filter(b => b.p && b.p.length >= 3)
    .map(b => ({ p: b.p })));
  const clear = (x, z) => { const k = slack(x, -z); return k >= CLEAR && k <= REACH && !inPits(x, -z) && !steep(x, z) && inBuilding(x, -z) < 0; };
  const forest = new Forest(kit, {
    ground, clear, shadows: renderer.shadowMap.enabled, name: 'env.woods', seed: 7,
    skip: (new URLSearchParams(location.search).get('woods') || '').split(',')
      .filter(w => w.startsWith('-')).map(w => w.slice(1)),
  });

  // --- the treelines ---------------------------------------------------------
  const woods = (env.areas || []).filter(a => spec.kinds.includes(a.k) && a.p.length >= 3);
  const inPoly = polygonIndex(woods);
  // THE SATELLITE'S WOODS, as well as the map's. OSM is only as complete as
  // its volunteers: in the Parco di Monza it maps the wood inside the north
  // loop and a few strips, and left the rest of the park — the woods along the
  // back straight, Serraglio, Ascari — as nothing, which drew as lawn. ESA
  // WorldCover (tools/getcover.mjs) is a 10 m measurement of tree cover. Each
  // connected patch of it is a wood with its own index after the polygons, so
  // everything below — the treeline walk, "reached", the paper fill — treats a
  // measured wood exactly like a mapped one. Measured on Monza: trees within
  // 40 m of the run-off on 34% of the lap's two sides from OSM, 79% from this.
  const cover = spec.cover && env.cover ? coverIndex(env.cover, woods.length) : null;
  const inWood = cover
    ? (x, y) => { const k = inPoly(x, y); return k >= 0 ? k : cover.at(x, y); }
    : inPoly;
  if (cover) woods.push(...cover.patches);
  const reached = new Set();
  const di = Math.max(1, Math.round(STEP / track.ds));
  // Where each treeline sample found its wood, metres beyond the run-off
  // (-1: none). tools/woodscheck.mjs reads this: coverage per side, and where
  // the gaps a driver can see through actually are.
  const edges = { di, ds: track.ds, L: [], R: [], bridged: 0, blockL: '', blockR: '' };
  for (const side of [1, -1]) {
    // Pass 1: walk out from the run-off at every sample.
    const samp = [];
    for (let i = 0; i < track.n; i += di) {
      const h = track.hdg[i];
      const lx = -Math.sin(h) * side, ly = Math.cos(h) * side;       // out of the circuit, this side
      const edge = track.w[i] + (side > 0 ? track.runL[i] : track.runR[i]) + CLEAR;
      let start = null, k = -1, deep = 0, miss = 0;
      for (let d = edge; d < edge + SEARCH + spec.depth + BEHIND; d += MARCH) {
        const x = track.x[i] + lx * d, y = track.y[i] + ly * d;
        const onRoad = slack(x, y) < CLEAR;
        const here = onRoad ? -1 : inWood(x, y);
        if (start == null) {
          if (d > edge + SEARCH) break;
          if (here >= 0) { start = d; k = here; }
        } else if (onRoad) {
          // A WOOD BETWEEN TWO ROADS. Walked to the far side, this stack put
          // its backdrop against the OTHER road's barrier, black back facing
          // the drivers there, with its canopy lid reaching over them. Each
          // road gets its own half: the other one plants the rest from its side.
          deep = Math.max(0, (d - start) / 2 - 3);
          break;
        } else if (d - start > spec.depth + BEHIND) break;
        else if (here < 0) {
          // A path or a clearing one pixel wide is still the same wood: the
          // 10 m raster reads every bridle path in the park as open ground,
          // and the stack used to stop dead at the first of them.
          miss += MARCH;
          if (miss > HOLE) break;
        } else { miss = 0; deep = d - start; }
      }
      // Is the ground just behind the run-off something that must stay open?
      // A surveyed building or grandstand ('B') is. The satellite's BUILT
      // class ('c') is recorded but does NOT hold a gap open: beside a
      // circuit it is paved run-off, service roads and gravel, and it was
      // holding Curva Grande and the back straight open as lawn.
      let blocked = false;
      for (let d = edge; d <= edge + OPEN_BAND && !blocked; d += 4) {
        const x = track.x[i] + lx * d, y = track.y[i] + ly * d;
        blocked = inBuilding(x, y) >= 0 ? 'B' : (cover && cover.cls(x, y) === 50) ? 'c' : false;
      }
      samp.push({ i, lx, ly, edge, start, k, deep, blocked: blocked === 'B', why: blocked || '.' });
    }
    // Pass 2: close the gaps. The Parco di Monza is a wood with lawns, paths
    // and gravel traps in it, and at 10 m the satellite reads a lawn beside
    // the fence as a hole in the treeline: from the car, that hole was a
    // window onto open grass and the town beyond, which is exactly the
    // "field with buildings" Adam saw. A gap no longer than `bridge` metres,
    // wooded at BOTH ends, and with nothing built behind the barrier, is
    // planted as the woods either side of it. Grandstands, the paddock and
    // every surveyed building are never planted over.
    const bridge = spec.bridge || 0;
    const stepM = di * track.ds;
    // A gap is no wood at all, or a wood so far back (past FAR_GAP) that the
    // ground by the fence reads as open lawn from the car.
    const gap = q => q.start == null || q.start - q.edge > FAR_GAP;
    for (let a = 0; a < samp.length;) {
      if (!gap(samp[a])) { a++; continue; }
      let b = a;
      while (b < samp.length && gap(samp[b])) b++;
      const L = samp[a - 1], R = samp[b];
      const len = (b - a + 1) * stepM;
      if (bridge && L && R && len <= bridge && !samp.slice(a, b).some(q => q.blocked)) {
        const oL = L.start - L.edge, oR = R.start - R.edge;
        for (let m = a; m < b; m++) {
          const t = (m - a + 1) / (b - a + 1), q = samp[m];
          // Stood close to the fence, where a park's edge trees stand.
          q.start = q.edge + Math.min(BRIDGE_NEAR, oL + (oR - oL) * t);
          q.deep = Math.min(BRIDGE_DEEP, Math.max(30, L.deep, R.deep));
          q.k = -1; q.bridged = true;
          edges.bridged++;
        }
      }
      a = b;
    }
    edges[side > 0 ? 'blockL' : 'blockR'] = samp.map(q => q.why).join('');
    // Pass 3: plant.
    let line = [], prev = null;
    const end = () => { if (line.length >= 2) forest.line(line); line = []; prev = null; };
    for (const q of samp) {
      const { i, lx, ly, edge, start, k, deep } = q;
      (side > 0 ? edges.L : edges.R).push(start == null ? -1 : Math.round(start - edge + CLEAR));
      if (start == null || (prev != null && Math.abs(start - prev) > JUMP && !q.bridged)) { end(); if (start == null) continue; }
      if (k >= 0) reached.add(k);
      prev = start;
      const d = Math.min(spec.depth, deep);
      line.push({
        x: track.x[i] + lx * start, z: Z(track.y[i] + ly * start),
        nx: lx, nz: Z(ly),
        d, far: Math.max(0, deep - d),
        conifer: spec.conifer, density: spec.density,
      });
    }
    end();
  }

  // --- the rest of the survey -------------------------------------------------
  const r = rng(31);
  let single = 0;
  // Loose surveyed trees, standing where they stand: Monza's avenue of planes.
  for (const t of env.trees || []) {
    if (single >= (spec.singles || 2100)) break;
    if (!clear(t[0], Z(t[1]))) continue;
    forest.tree(t[0], Z(t[1]), { conifer: 0, scale: 0.62 + r() * 0.24 });
    single++;
  }
  // Woods no treeline reached are too far from the circuit to walk past: fill
  // them with paper trees in the shade of a deep wood, which is all anyone
  // will ever see of them.
  let far = 0;
  woods.forEach((a, k) => {
    if (reached.has(k)) return;
    const b = a.box, area = (b[1] - b[0]) * (b[3] - b[2]);
    const want = Math.min(400, Math.round(area / 90));
    for (let n = 0; n < want && far < (spec.papers || 7000); n++) {
      const x = b[0] + r() * (b[1] - b[0]), y = b[2] + r() * (b[3] - b[2]);
      // Well away from every road: a paper tree is a 15 m card, and beside
      // the run-off it fills the screen. Measured: 1.5 m was enough to put
      // one across the whole sky at Suzuka.
      if (inWood(x, y) !== k || slack(x, y) < FAR_CLEAR || !clear(x, Z(y))) continue;
      forest.paper(x, Z(y), { conifer: spec.conifer, scale: 0.9 + r() * 0.4 });
      far++;
    }
  });
  // Scrub: a scatter of small real trees, and open ground between them.
  if (spec.scrub) {
    const scrub = (env.areas || []).filter(a => a.k === 'scrub' && a.p.length >= 3);
    const inScrub = polygonIndex(scrub);
    let n = 0;
    scrub.forEach((a, k) => {
      const b = a.box, area = (b[1] - b[0]) * (b[3] - b[2]);
      const want = Math.min(80, Math.round(area / 700));
      for (let m = 0; m < want && n < 1500; m++) {
        const x = b[0] + r() * (b[1] - b[0]), y = b[2] + r() * (b[3] - b[2]);
        if (inScrub(x, y) !== k || !clear(x, Z(y))) continue;
        forest.tree(x, Z(y), { conifer: spec.conifer, scale: 0.38 + r() * 0.26 });
        n++;
      }
    });
  }

  forest.build();
  // Per frame, without touching the render loop: an always-drawn, invisible
  // mesh runs the forest's levels of detail and the plants' wind clock just
  // before each render, with the camera that render is using.
  const tick = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  tick.frustumCulled = false;
  tick.name = 'env.woods.tick';
  tick.onBeforeRender = (_r, sc, camera) => {
    if (!forest.sunLight) sc.traverse(o => { if (o.isDirectionalLight && !forest.sunLight) forest.sunLight = o; });
    plants.tick(performance.now() / 1000);
    forest.update(camera);
  };
  forest.group.add(tick);
  scene.add(forest.group);
  const s = forest.stats();
  window.__wdcWoods = { ...s, single, far, edges };
  return s.trees + s.paper;
}
