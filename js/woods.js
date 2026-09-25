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
  const kit = makeKit(renderer, plants, { conifer: spec.conifer });
  if (!kit) return null;

  const slack = slackIndex(track);
  const r2 = corridor ? corridor.radius * corridor.radius : 0;
  const inPits = (x, y) => corridor && corridor.pts.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 < r2);
  // The world's (x, y) is three's (x, -z).
  const ground = (x, z) => (world ? world.groundY(x, z) : 0);
  const clear = (x, z) => { const k = slack(x, -z); return k >= CLEAR && k <= REACH && !inPits(x, -z); };
  const forest = new Forest(kit, {
    ground, clear, shadows: renderer.shadowMap.enabled, name: 'env.woods', seed: 7,
    skip: (new URLSearchParams(location.search).get('woods') || '').split(',')
      .filter(w => w.startsWith('-')).map(w => w.slice(1)),
  });

  // --- the treelines ---------------------------------------------------------
  const woods = (env.areas || []).filter(a => spec.kinds.includes(a.k) && a.p.length >= 3);
  const inWood = polygonIndex(woods);
  const reached = new Set();
  const di = Math.max(1, Math.round(STEP / track.ds));
  for (const side of [1, -1]) {
    let line = [], prev = null;
    const end = () => { if (line.length >= 2) forest.line(line); line = []; prev = null; };
    for (let i = 0; i < track.n; i += di) {
      const h = track.hdg[i];
      const lx = -Math.sin(h) * side, ly = Math.cos(h) * side;       // out of the circuit, this side
      const edge = track.w[i] + (side > 0 ? track.runL[i] : track.runR[i]) + CLEAR;
      let start = null, k = -1, deep = 0;
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
        } else if (here < 0 || d - start > spec.depth + BEHIND) break;
        else deep = d - start;
      }
      if (start == null || (prev != null && Math.abs(start - prev) > JUMP)) { end(); if (start == null) continue; }
      reached.add(k);
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
  window.__wdcWoods = { ...s, single, far };
  return s.trees + s.paper;
}
