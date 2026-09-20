// flora.js — the grass and the forest.
//
// Two jobs, and they are not the same job:
//
//   GRASS is a near-field thing. It exists so that the verge has a SURFACE at
//   two metres from the camera at 250 km/h, and it is worthless past about
//   ninety. So it is built in strips along the road, streamed in around the
//   camera, and thrown away behind it. It never needs a terrain query: inside
//   the level verge the ground IS the road edge's height (that is ground.js's
//   own rule), which makes a blade of grass about four floating-point
//   operations to place.
//
//   A FOREST is a far-field thing. It exists so the track sits in a place
//   rather than on a plane, and what matters is the shape of the treeline a
//   kilometre out. So it is built once at load, bucketed into cells, and drawn
//   at three levels of detail: the whole tree close up, foliage without trunks
//   in the middle distance, and a crossed pair of BAKED cards past that. The
//   bake is the method that makes a forest possible at all — a photographed
//   tree is a few hundred triangles, and ten thousand of those is not a thing
//   a browser will draw.
//
// WHERE the trees go is not computed. It is written down, section by section,
// in data/build/scenery.js, in the same words the track's own pieces are
// written in. Density inside a named section is random; the fact that the
// esses run through pine forest is a decision.
//
// The plants themselves are photoscans (data/flora/, CC0 from ambientCG), cut
// out by measurement — see tools/getflora.mjs.
import * as THREE from 'three';
import { pointAt, surfaceY } from './path.js';
import { V } from './meshes.js';
import { GROUND } from './ground.js';
import { SCENERY, KINDS, FOREST_DEPTH } from '../../data/build/scenery.js';

// --- near-field grass -------------------------------------------------------
const CHUNK = 30;          // path samples per grass strip (2 m each, so 60 m)
const GRASS_ON = 95;       // m from the camera a strip is built and shown
const GRASS_OFF = 130;     // m at which it is dropped again (hysteresis)
// Measured against a cone: the first build's grass stood taller than a traffic
// cone, which reads as a field nobody has mown since the war. Trackside grass
// is 5-10 cm and what sells it is DENSITY, not height.
const TUFTS_PER_M2 = 3.4;
const SEEDS_PER_M2 = 0.055;
const BUILD_BUDGET = 2;    // strips built per frame, so streaming never hitches

// --- the forest -------------------------------------------------------------
const CELL = 260;          // m, one forest bucket
const LOD_FULL = 190;      // m: trunks and all
const LOD_CARDS = 460;     // m: foliage only, no trunks
const LOD_FAR = 1250;      // m: baked cross-cards, then nothing

// Deterministic noise, so the same track always grows the same wood. Nothing
// here decides WHERE a forest is — only which blade of grass lands where
// inside one.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Geometry: a bent card, which is every plant in this file.
//
// `rect` is a measured cut-out from data/flora/atlas.json. `rows` is how many
// times the card is cut across, which is what lets the wind bend it rather
// than slide it. `aSway` runs 0 at the root to 1 at the tip and is what the
// sway shader in look.js weights its bend by.
// ---------------------------------------------------------------------------
function card(rect, w, h, { rows = 2, bend = 0, tilt = 0, yaw = 0, at = [0, 0, 0], flip = false } = {}) {
  const pos = [], uv = [], sway = [], idx = [], nor = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    // A card that leans as it rises reads as a plant; a flat rectangle reads
    // as a sticker. `bend` is metres of lean at the tip, `tilt` radians of
    // pitch for a branch that hangs rather than stands.
    const lean = bend * t * t;
    const y = h * t * Math.cos(tilt) + (flip ? 0 : 0);
    const z0 = h * t * Math.sin(tilt) + lean;
    for (const s of [-0.5, 0.5]) {
      const x = s * w * (1 - 0.12 * t);
      // yaw the card around its own root
      pos.push(x * cy - z0 * sy + at[0], y + at[1], x * sy + z0 * cy + at[2]);
      uv.push(rect.x + (s + 0.5) * rect.w, rect.y + t * rect.h);
      sway.push(t);
      // Normals point along the card's face. For a plant the truth is "this
      // leaf faces everywhere", so they are pushed toward vertical, which is
      // what stops a field of grass flickering black as the sun crosses it.
      nor.push(-sy * 0.45, 0.89, cy * 0.45);
    }
    if (r > 0) {
      const k = r * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return { pos, uv, sway, nor, idx };
}

function assemble(parts) {
  const pos = [], uv = [], sway = [], nor = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos); uv.push(...p.uv); sway.push(...p.sway); nor.push(...p.nor);
    for (const i of p.idx) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// A tuft: three blades from three different cut-outs, facing three ways. The
// variety between tufts comes from the instance (yaw, scale, tint); the
// variety WITHIN a tuft has to be in the geometry, or every tuft is the same
// blade repeated and the eye picks that up immediately.
function tuftGeometry(rects, { blades = 3, h = 0.52, w = 0.13, seed = 7 } = {}) {
  const r = rng(seed), parts = [];
  for (let i = 0; i < blades; i++) {
    const rect = rects[Math.floor(r() * rects.length)];
    // A cut-out's box is mostly empty for a thin blade; `fill` is how much of
    // it is actually plant, and a card sized by the box makes a sparse blade
    // look like a wide leaf. Narrow the card by what was measured.
    const aspect = (rect.w / rect.h) * Math.max(0.35, rect.fill ?? 1);
    const hh = h * (0.7 + r() * 0.6);
    parts.push(card(rect, Math.max(w, hh * aspect * 1.9), hh, {
      rows: 2, bend: (r() - 0.5) * hh * 0.5, yaw: (i / blades) * Math.PI + r() * 0.5,
      at: [(r() - 0.5) * 0.14, 0, (r() - 0.5) * 0.14],
    }));
  }
  return assemble(parts);
}

// ---------------------------------------------------------------------------
// Trees. A trunk is real geometry because you drive past it; the leaves are
// cards because there is no other way to afford a wood.
// ---------------------------------------------------------------------------
function trunkGeometry(rBase, rTop, h, lean = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, 7, 2, false);
  g.translate(0, h / 2, 0);
  if (lean) g.rotateZ(lean);
  // UVs are metres, like everything else in this project: the bark material
  // says its photograph is 1.2 m across and repeats 1/1.2, so the scale has to
  // arrive here in metres rather than in 0..1 of a cylinder.
  const uv = g.attributes.uv;
  const circ = 2 * Math.PI * (rBase + rTop) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

// A fir: sprigs in whorls down a cone, each one hanging slightly.
function coniferFoliage(rects, { h = 13, spread = 2.9, whorls = 15, seed = 3 } = {}) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < whorls; k++) {
    const t = 0.22 + 0.78 * (k / (whorls - 1));
    const rect = rects[k % rects.length];
    const reach = spread * Math.pow(1 - t, 0.75) + 0.35;
    const yaw = k * 2.3999 + r() * 0.6;
    parts.push(card(rect, reach * 2.2, reach * 1.5, {
      rows: 2, tilt: 1.32 + r() * 0.16, bend: -reach * 0.12, yaw,
      at: [0, h * t, 0],
    }));
  }
  // A spire, so the top is not a bald pole.
  parts.push(card(rects[0], spread * 0.8, spread * 0.9, { rows: 2, yaw: 0.7, at: [0, h * 0.97, 0] }));
  return assemble(parts);
}

// A broadleaf: clusters of leaves around a crown. The cluster is why this
// works — one leaf per card is a Christmas decoration, four leaves in one card
// with the gaps transparent is a branch.
function broadFoliage(rects, { h = 9, crown = 3.4, cards = 14, seed = 11 } = {}) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < cards; k++) {
    const rect = rects[k % rects.length];
    const t = k / cards;
    const yaw = k * 2.3999;
    // Up the crown and out from the middle, so the silhouette is a ball with a
    // flat-ish bottom rather than a sphere of leaves floating in the air.
    const up = 0.62 + 0.42 * Math.sin(t * Math.PI * 1.9 + r());
    const out = crown * (0.45 + r() * 0.62) * Math.sin(up * Math.PI * 0.9);
    const size = crown * (0.72 + r() * 0.5);
    parts.push(card(rect, size, size, {
      rows: 2, tilt: 0.7 + r() * 0.9, bend: (r() - 0.5) * size * 0.4, yaw,
      at: [Math.cos(yaw) * out, h * 0.62 + up * crown, Math.sin(yaw) * out],
    }));
  }
  return assemble(parts);
}

// Two leaf cut-outs side by side make a cluster card. The atlas is a grid of
// single leaves; a rectangle spanning four of them shows four leaves with
// transparent gaps, which is a branch's worth of foliage in one quad.
function clusters(items, cols = 2, rows = 2) {
  if (items.length < 4) return items;
  const byCol = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  const out = [];
  for (let i = 0; i + cols * rows <= byCol.length; i += cols) {
    const grp = byCol.slice(i, i + cols * rows);
    const x0 = Math.min(...grp.map(g => g.x)), y0 = Math.min(...grp.map(g => g.y));
    const x1 = Math.max(...grp.map(g => g.x + g.w)), y1 = Math.max(...grp.map(g => g.y + g.h));
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: 0.55 });
  }
  return out.length ? out : items;
}

// ---------------------------------------------------------------------------
// The impostor bake. One orthographic render of a real tree into a texture,
// which then stands in for it past a quarter of a kilometre.
//
// Baked UNLIT and with tone mapping off: what goes into the texture has to be
// albedo, because the card is lit again when it is drawn. Bake a lit tree and
// every distant tree carries the sun angle it was baked at, which is wrong
// twice over — once for the light, once for the exposure.
// ---------------------------------------------------------------------------
function bakeImpostor(renderer, parts, size = 512) {
  const scene = new THREE.Scene();
  const box = new THREE.Box3();
  for (const { geometry, material } of parts) {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: material.map, alphaMap: material.alphaMap, alphaTest: material.alphaTest || 0.4,
      side: THREE.DoubleSide, toneMapped: false,
    }));
    scene.add(m);
    box.expandByObject(m);
  }
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.z, s.y) * 0.5;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, half * 6);
  cam.position.set(c.x, c.y, c.z + half * 3);
  cam.lookAt(c);
  const rt = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, colorSpace: THREE.SRGBColorSpace,
  });
  const wasTone = renderer.toneMapping, wasTarget = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(wasTarget);
  renderer.setClearColor(clear, clearA);
  renderer.toneMapping = wasTone;
  for (const m of scene.children) m.material.dispose();
  // The card is square because the bake is; the tree inside it is not, and the
  // caller needs the real size to plant it at the right height.
  return { texture: rt.texture, size: half * 2, base: c.y - box.min.y };
}

// A crossed pair of quads. Normals are pushed outward and up rather than left
// flat, so a distant wood shades like a mass of leaves instead of like two
// pieces of card.
function crossGeometry(w, h, base) {
  const parts = [];
  for (const yaw of [0, Math.PI / 2]) {
    const c = card({ x: 0, y: 0, w: 1, h: 1 }, w, h, { rows: 1, yaw, at: [0, -base, 0] });
    parts.push(c);
  }
  const g = assemble(parts);
  const n = g.attributes.normal, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(p.getX(i), 0, p.getZ(i)).normalize().multiplyScalar(0.6);
    n.setXYZ(i, v.x, 0.8, v.z);
  }
  return g;
}

// ---------------------------------------------------------------------------
export class Flora {
  constructor(path, ground, look) {
    this.path = path; this.ground = ground; this.look = look;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.grass = new THREE.Group();
    this.forest = new THREE.Group();
    this.group.add(this.grass, this.forest);
    this.strips = new Map();          // key -> { mesh[], built, lastSeen }
    this.cells = [];
    this.counts = { tufts: 0, seeds: 0, trees: 0, cells: 0 };
    this._tmp = new THREE.Vector3();
  }

  // -- where the mown verge is, once, so no blade of grass ever asks ---------
  //
  // Two things stop grass: a tunnel (there is no sky in there) and a road that
  // has left the ground — a viaduct deck's verge is thin air, and grass placed
  // at the road's edge height would hang off the side of it. Both are measured
  // per sample here rather than per blade.
  survey() {
    const p = this.path, g = this.ground;
    this.band = new Float32Array(p.n * 2);            // [outer left, outer right]
    this.ok = new Uint8Array(p.n);
    for (let i = 0; i < p.n; i++) {
      if (p.tunIn && p.tunIn[i] > 0) continue;
      let good = 1;
      for (const side of [1, -1]) {
        const run = side > 0 ? p.runL[i] : p.runR[i];
        const outer = p.w[i] + run + GROUND.VERGE * 0.8;
        this.band[i * 2 + (side > 0 ? 0 : 1)] = outer;
        const e = pointAt(p, i, side * (p.w[i] + run * 0.5));
        // The ground under the verge should be the road edge's height. Where
        // it is not, the road is on a bridge or in a bore and there is nothing
        // out there to grow on.
        if (Math.abs(g.height(e.x, e.y) - e.z) > 1.6) good = 0;
      }
      this.ok[i] = good;
    }
    return this;
  }

  // -- which section of scenery a sample belongs to --------------------------
  sections() {
    const p = this.path;
    this.kindAt = new Array(p.n);
    let current = { left: SCENERY.default.left, right: SCENERY.default.right };
    for (const piece of p.pieces) {
      const named = piece.part && (SCENERY[piece.part] || (piece.n === 1 ? SCENERY.START : null));
      if (named) current = named;
      else if (piece.n === 1 && SCENERY.START) current = SCENERY.START;
      const i0 = Math.floor(piece.s0 / p.ds), i1 = Math.min(p.n - 1, Math.ceil(piece.s1 / p.ds));
      for (let i = i0; i <= i1; i++) this.kindAt[i] = current;
    }
    for (let i = 0; i < p.n; i++) this.kindAt[i] ||= SCENERY.default;
    return this;
  }

  // -- the plant materials and the two trees, built once ---------------------
  makeSpecies(renderer) {
    const L = this.look;
    const grassRects = L.cutouts('grass'), seedRects = L.cutouts('seed');
    const needleRects = L.cutouts('needle'), leafRects = clusters(L.cutouts('leaf'));
    this.mat = {
      grass: L.cardMaterial('grass', { sway: 1, glow: 0.35, alphaTest: 0.4 }),
      seed: L.cardMaterial('seed', { sway: 1.5, glow: 0.3, alphaTest: 0.35 }),
      needle: L.cardMaterial('needle', { sway: 0.35, glow: 0.55, alphaTest: 0.42 }),
      leaf: L.cardMaterial('leaf', { sway: 0.5, glow: 0.6, alphaTest: 0.42 }),
      bark: L.bark(),
    };
    if (!this.mat.grass) return false;              // no data/flora: no plants

    this.tuft = tuftGeometry(grassRects, { blades: 3, h: 0.3, seed: 5 });
    this.seedTuft = tuftGeometry(seedRects, { blades: 2, h: 0.72, w: 0.16, seed: 9 });

    const conifer = {
      trunk: trunkGeometry(0.42, 0.13, 13.5),
      foliage: coniferFoliage(needleRects, { h: 13.5, spread: 3.1, whorls: 16, seed: 3 }),
      mat: this.mat.needle,
    };
    const broad = {
      trunk: trunkGeometry(0.46, 0.2, 8.4),
      foliage: broadFoliage(leafRects, { h: 8.4, crown: 3.6, cards: 15, seed: 11 }),
      mat: this.mat.leaf,
    };
    for (const sp of [conifer, broad]) {
      sp.card = bakeImpostor(renderer, [{ geometry: sp.foliage, material: sp.mat },
        { geometry: sp.trunk, material: { map: this.mat.bark.map, alphaTest: 0 } }]);
      sp.cross = crossGeometry(sp.card.size, sp.card.size, sp.card.base);
      sp.crossMat = new THREE.MeshStandardMaterial({
        map: sp.card.texture, alphaTest: 0.3, side: THREE.DoubleSide,
        roughness: 0.85, metalness: 0, envMapIntensity: 0.8,
      });
      sp.crossMat.shadowSide = THREE.DoubleSide;
    }
    this.species = { conifer, broad };
    return true;
  }

  // -- plant the forest, once ------------------------------------------------
  plant() {
    const p = this.path, g = this.ground;
    const r = rng(1234);
    const buckets = new Map();
    const push = (cx, cy, t) => {
      const key = `${cx},${cy}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { cx, cy, conifer: [], broad: [] });
      b[t.sp].push(t);
    };
    // Walk the road and throw trees sideways into the country beside it. The
    // road is the only thing we know the position of, which is also why this
    // cannot plant a wood that is not beside the track — and that is fine: a
    // wood you never come within 260 m of is fog.
    const step = 6;                                   // m along the road between attempts
    for (let i = 0; i < p.n; i += Math.round(step / p.ds)) {
      const sec = this.kindAt[i];
      for (const side of [1, -1]) {
        const kind = KINDS[side > 0 ? sec.left : sec.right] || KINDS.meadow;
        if (!kind.trees) continue;
        // trees per hectare over the strip of land this sample owns
        const area = step * FOREST_DEPTH;
        const n = (kind.trees / 10000) * area;
        for (let k = 0; k < Math.ceil(n); k++) {
          if (k > n - 1 && r() > n - Math.floor(n)) continue;
          const lat = side * (kind.near + r() * FOREST_DEPTH);
          const along = (r() - 0.5) * step;
          const pt = pointAt(p, Math.min(p.n - 1, i + Math.round(along / p.ds)), lat);
          // Never on the road — and roadDist knows about EVERY road, so this
          // is also what keeps a wood from growing under a viaduct deck or on
          // top of the piece of track the loop crosses over.
          if (g.roadDist(pt.x, pt.y) < kind.near) continue;
          const h = g.height(pt.x, pt.y);
          const sp = r() < kind.conifer ? 'conifer' : 'broad';
          push(Math.floor(pt.x / CELL), Math.floor(pt.y / CELL), {
            sp, x: pt.x, y: pt.y, h, yaw: r() * Math.PI * 2,
            scale: 0.72 + r() * 0.66, tint: 0.82 + r() * 0.36,
          });
        }
      }
    }
    for (const b of buckets.values()) this.buildCell(b);
    this.counts.cells = this.cells.length;
    return this;
  }

  buildCell(b) {
    const S = this.species;
    const cell = { x: (b.cx + 0.5) * CELL, y: (b.cy + 0.5) * CELL, lods: [], n: 0 };
    for (const name of ['conifer', 'broad']) {
      const list = b[name];
      if (!list.length) continue;
      const sp = S[name];
      // ONE matrix array, three meshes. The LODs are the same trees seen from
      // further away, so they must be the same matrices — and three is happy
      // to share an InstancedBufferAttribute between meshes.
      const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw);
        pos.copy(V(t.x, t.y, t.h));
        scl.set(t.scale, t.scale * (0.86 + (t.tint - 0.82) * 0.8), t.scale);
        m.compose(pos, q, scl);
        m.toArray(mat4.array, i * 16);
        // Real foliage is a spread of greens, never one. This is the
        // difference between "a forest" and "a texture applied to cones".
        tint.setXYZ(i, t.tint * 0.96, t.tint, t.tint * 0.86);
      });
      const mesh = (geo, material) => {
        const im = new THREE.InstancedMesh(geo, material, list.length);
        im.instanceMatrix = mat4;
        im.instanceColor = tint;
        im.castShadow = true; im.receiveShadow = true;
        im.frustumCulled = true;
        im.visible = false;
        this.forest.add(im);
        return im;
      };
      cell.lods.push({
        full: [mesh(sp.trunk, this.mat.bark), mesh(sp.foliage, sp.mat)],
        cards: [mesh(sp.foliage, sp.mat)],
        far: [mesh(sp.cross, sp.crossMat)],
      });
      cell.n += list.length;
      this.counts.trees += list.length;
    }
    this.cells.push(cell);
  }

  // -- near-field grass, streamed -------------------------------------------
  stripKey(c, side) { return c * 2 + (side > 0 ? 0 : 1); }

  buildStrip(c, side) {
    const p = this.path, i0 = c * CHUNK, i1 = Math.min(p.n - 1, i0 + CHUNK);
    const r = rng(c * 7919 + (side > 0 ? 13 : 71));
    const tufts = [], seeds = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = i0; i < i1; i++) {
      if (!this.ok[i]) continue;
      const sec = this.kindAt[i];
      const kind = KINDS[side > 0 ? sec.left : sec.right] || KINDS.meadow;
      // Grass starts where the RUN-OFF ends, not part way across it: that band
      // is asphalt, both to the physics and now to the eye.
      const inner = p.w[i] + (side > 0 ? p.runL[i] : p.runR[i]);
      const outer = this.band[i * 2 + (side > 0 ? 0 : 1)];
      if (outer <= inner) continue;
      const area = p.ds * (outer - inner);
      const n = area * TUFTS_PER_M2 * kind.grass;
      const ns = area * SEEDS_PER_M2 * kind.grass;
      for (const [list, count, big] of [[tufts, n, false], [seeds, ns, true]]) {
        for (let k = 0; k < count; k++) {
          if (k > count - 1 && r() > count - Math.floor(count)) continue;
          const lat = side * (inner + r() * (outer - inner));
          const pt = pointAt(p, i, lat);
          // Inside the level verge the ground IS the road edge, so this is the
          // exact height with no terrain query at all — that identity is what
          // makes streaming grass cheap enough to do at 60 fps.
          const y = surfaceY(p, i, lat) - GROUND.EPS;
          q.setFromAxisAngle(up, r() * Math.PI * 2);
          const s = big ? 0.75 + r() * 0.4 : 0.78 + r() * 0.42;
          pos.set(pt.x, y, -pt.y);
          scl.set(s, s * (0.8 + r() * 0.5), s);
          m.compose(pos, q, scl);
          list.push(...m.elements);
        }
      }
    }
    const meshes = [];
    const make = (geo, mat, arr) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(geo, mat, arr.length / 16);
      im.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(arr), 16);
      im.castShadow = false;          // a blade's shadow costs more than it shows
      im.receiveShadow = true;
      this.grass.add(im);
      meshes.push(im);
    };
    make(this.tuft, this.mat.grass, tufts);
    make(this.seedTuft, this.mat.seed, seeds);
    this.counts.tufts += tufts.length / 16;
    this.counts.seeds += seeds.length / 16;
    return meshes;
  }

  // -- per frame -------------------------------------------------------------
  update(camera) {
    const cam = camera.position;
    // forest: one level of detail per cell, by distance to the cell's middle
    for (const cell of this.cells) {
      const dx = cell.x - cam.x, dz = -cell.y - cam.z;
      const d = Math.hypot(dx, dz);
      const want = d < LOD_FULL ? 'full' : d < LOD_CARDS ? 'cards' : d < LOD_FAR ? 'far' : null;
      if (cell.lod === want) continue;
      cell.lod = want;
      for (const set of cell.lods) {
        for (const k of ['full', 'cards', 'far']) for (const m of set[k]) m.visible = (k === want);
      }
    }
    // grass: build what is close, drop what is not. The two radii differ so a
    // strip on the boundary is not built and thrown away every other frame.
    if (!this.mat?.grass) return;
    const p = this.path, chunks = Math.ceil(p.n / CHUNK);
    let budget = BUILD_BUDGET;
    for (let c = 0; c < chunks; c++) {
      const i = Math.min(p.n - 1, c * CHUNK + CHUNK / 2);
      const dx = p.x[i] - cam.x, dz = -p.y[i] - cam.z;
      const d = Math.hypot(dx, dz);
      for (const side of [1, -1]) {
        const key = this.stripKey(c, side);
        const have = this.strips.get(key);
        if (d < GRASS_ON) {
          if (have) continue;
          if (budget-- <= 0) continue;
          this.strips.set(key, { meshes: this.buildStrip(c, side) });
        } else if (d > GRASS_OFF && have) {
          for (const m of have.meshes) { this.grass.remove(m); m.dispose(); }
          this.strips.delete(key);
          this.counts.tufts = Math.max(0, this.counts.tufts);
        }
      }
    }
  }

  stats() {
    let live = 0;
    for (const s of this.strips.values()) live += s.meshes.length;
    return { ...this.counts, strips: this.strips.size, liveGrassDraws: live };
  }
}

// ---------------------------------------------------------------------------
export async function buildFlora(renderer, path, ground, look) {
  const f = new Flora(path, ground, look);
  f.sections();
  if (!f.makeSpecies(renderer)) return f;     // textures missing: no plants, no crash
  f.survey();
  f.plant();
  return f;
}
