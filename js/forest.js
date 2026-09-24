// forest.js — Adam's forest, one recipe for every circuit and the builder.
//
// His brief, 2026-09-23 (LOOK.md, the amendment at the bottom):
//
//   "3 rows of randomly resized and spun trees, between the 2nd and 3rd row a
//    Short banner (paper thin 2d just flat) of flora, then a taller one behind
//    the 3rd, then from then on 3 layers of cutout trees that slowly rotate to
//    face the player, a little taller than the others, then a big superdark
//    green background, remmber, as things get deeper, they get darker. the
//    green bg should be like BLACK and still blend in"
//
// Front to back, measured from the TREELINE (where the wood begins):
//
//   row 1, row 2      real trees — trunk, branches, foliage cards
//   SHORT BANNER      one flat strip of undergrowth, between rows 2 and 3
//   row 3             real trees
//   TALL BANNER       one flat strip of saplings and bushes, behind row 3
//   paper 1, 2, 3     single quads that yaw to face the camera, a little taller
//   BACKDROP          a near-black wall with a canopy lid behind it
//
// and every layer darker than the one in front, by a constant FRACTION
// (Beer-Lambert: light through a canopy loses a share per layer, not an
// amount), so the backdrop lands at about seven percent — black, but a green
// black, and in the same fog as everything else so it blends.
//
// HOW DEEP depends on the area (his answer): every sample of a treeline
// carries its own depth `d`, the distance from the treeline to the backdrop.
// Layers that do not fit in `d` are left out, so a thin strip of wood is three
// rows of trees and open land behind them, which is what a thin strip is.
//
// WHO USES IT. The builder (js/build/flora.js) hands in treelines worked out
// from data/build/scenery.js; the race game (js/env.js) hands in treelines
// worked out from the surveyed forest polygons. This file knows nothing about
// either: it takes lines in three's world space and plants them.
//
// The tree models, the impostor bake and the camera-facing paper came out of
// js/build/flora.js, where they were built and measured on 2026-09-19/21; the
// notes that explain them came with them.
import * as THREE from 'three';

// --- the stack, in metres from the treeline ---------------------------------
const ROW_GAP = 5.0;            // m between the three real rows, at depth 40
const ROW_SPACING = [5.2, 4.4, 3.8];   // m between trees ALONG each row: denser going back
const PAPER_SPACING = 2.6;      // m along a paper row; tight, so the rows close into a mass
const PAPER_GAP_MIN = 2.5;      // m: the tightest three paper rows are allowed to stand
const PAPER_TALLER = 1.15;      // "a little taller than the others"
const SHORT_H = 2.4;            // m, the short banner
const TALL_H = 6.2;             // m, the tall banner
const WALL_H = 9.0;             // m: under the paper tops, so the skyline is always trees
const LAYER_SHADE = 0.64;       // the fraction of light each layer lets through
// Where each thing sits in that sequence. Half-steps for the banners, because
// each one stands between two layers of trees.
const LAYER = { row: [0, 1, 2], short: 1.5, tall: 2.5, paper: [3, 4, 5], back: 6 };

// The backdrop fades in with distance ("the minecraft glass fade trick" — his
// note on the builder's first dark mass), so the fly camera can stand inside a
// wood without the screen going black. It was 14 m clear and solid by 60 m,
// and from the ROAD that meant a see-through wall: the treeline stands ~20 m
// off the racing line and the wall 30-50 m behind it, exactly inside the fade,
// so the canopy lid behind it showed through as a pale slab. Solid by 22 m is
// solid from every seat in a car and still clear when you fly into it.
const DARK_CLEAR = 4;
const DARK_SOLID = 22;

// Levels of detail for the real trees. Measured on the Intel chip for the
// builder's wood: these are as far as they can be afforded.
const CELL = 220;
const LOD_FULL = 105;           // m: trunks and all, and they cast shadows
const LOD_CARDS = 280;          // m: foliage only
const LOD_FAR = 560;            // m: one baked cross-card, then nothing
const PIECE = 300;              // m of banner or backdrop per mesh, so the frustum can cull

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------
// A bent card, which is every leaf and every blade.
//
// `shade` is written into a vertex colour and darkens a card by how deep in
// the crown it sits: real foliage is a MASS, lit outside and shadowed inside.
//
// CROSS: the same spray twice, the second rolled onto its edge. Adam, on the
// first wood: "the leaves are paper thin, and from the side they look like
// they arent there." A card's area all points one way; the rolled copy gives
// the pair area from every horizontal direction.
// ---------------------------------------------------------------------------
export function card(rect, w, h, { rows = 2, bend = 0, tilt = 0, yaw = 0, at = [0, 0, 0], shade = 1, droop = 0, roll = 0, cross = false } = {}) {
  if (cross) {
    const a = card(rect, w, h, { rows, bend, tilt, yaw, at, shade, droop, roll });
    const b = card(rect, w, h, { rows, bend, tilt, yaw, at, shade: shade * 0.86, droop, roll: roll + Math.PI / 2 });
    const n = a.pos.length / 3;
    return {
      pos: a.pos.concat(b.pos), uv: a.uv.concat(b.uv), sway: a.sway.concat(b.sway),
      nor: a.nor.concat(b.nor), col: a.col.concat(b.col),
      idx: a.idx.concat(b.idx.map(i => i + n)),
    };
  }
  const pos = [], uv = [], sway = [], nor = [], col = [], idx = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const wx = Math.cos(roll), wy = -Math.sin(roll) * st, wz = Math.sin(roll) * ct;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const lean = bend * t * t;
    const y = h * t * ct - droop * t * t;
    const z0 = h * t * st + lean;
    // Lighter toward the tip, darker at the root.
    const k = shade * (0.74 + 0.26 * t);
    for (const s of [-0.5, 0.5]) {
      const x = s * w * (1 - 0.12 * t);
      const lx = x * wx, ly = y + x * wy, lz = z0 + x * wz;
      pos.push(lx * cy - lz * sy + at[0], ly + at[1], lx * sy + lz * cy + at[2]);
      uv.push(rect.x + (s + 0.5) * rect.w, rect.y + t * rect.h);
      sway.push(t);
      if (roll === 0) {
        // Pushed toward vertical, which stops a wood flickering black as the
        // sun crosses it.
        nor.push(-sy * 0.45, 0.89, cy * 0.45);
      } else {
        let nx = ct * wz - st * wy, ny = st * wx, nz = -ct * wx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        ny += 0.55;
        const L = Math.hypot(nx, ny, nz) || 1;
        nx /= L; ny /= L; nz /= L;
        nor.push(nx * cy - nz * sy, ny, nx * sy + nz * cy);
      }
      col.push(k, k, k);
    }
    if (r > 0) {
      const q = r * 2;
      idx.push(q - 2, q - 1, q, q - 1, q + 1, q);
    }
  }
  return { pos, uv, sway, nor, col, idx };
}

export function assemble(parts) {
  const pos = [], uv = [], sway = [], nor = [], col = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    for (let i = 0; i < p.pos.length; i++) pos.push(p.pos[i]);
    for (let i = 0; i < p.uv.length; i++) uv.push(p.uv[i]);
    for (let i = 0; i < p.sway.length; i++) sway.push(p.sway[i]);
    for (let i = 0; i < p.nor.length; i++) nor.push(p.nor[i]);
    for (let i = 0; i < p.col.length; i++) col.push(p.col[i]);
    for (const i of p.idx) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// The two species.
// ---------------------------------------------------------------------------
function trunkGeometry(rBase, rTop, h, { sides = 6, lean = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, sides, 1, false);
  g.translate(0, h / 2, 0);
  if (lean) g.rotateZ(lean);
  // UVs are metres, so the bark photograph is the size it was shot at.
  const uv = g.attributes.uv;
  const circ = 2 * Math.PI * (rBase + rTop) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  const n = g.attributes.position.count;
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  // A trunk in a wood stands in shadow. Flat-lit bark is most of why a
  // low-poly tree reads as a lamp post with a bush on top.
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.62), 3));
  return g;
}

// A fir: whorls of drooping sprigs down a cone, darker toward the bottom,
// tapering to a spire. The silhouette is the whole job.
function coniferFoliage(rects, { h = 15, spread = 3.0, whorls = 16, perWhorl = 2, seed = 3 } = {}) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < whorls; k++) {
    const t = 0.2 + 0.8 * (k / (whorls - 1));
    const reach = spread * Math.pow(1 - t, 0.72) + 0.4;
    const shade = 0.30 + 0.70 * t;
    for (let j = 0; j < perWhorl; j++) {
      const rect = rects[(k + j) % rects.length];
      const yaw = k * 2.3999 + j * (Math.PI * 2 / perWhorl) + r() * 0.4;
      parts.push(card(rect, reach * 2.3, reach * 1.45, {
        rows: 2, tilt: 1.28 + r() * 0.2, bend: -reach * 0.18, yaw, shade, cross: true,
        droop: reach * 0.22,
        at: [Math.cos(yaw) * reach * 0.18, h * t, Math.sin(yaw) * reach * 0.18],
      }));
    }
  }
  parts.push(card(rects[0], spread * 0.7, spread * 1.1, { rows: 2, yaw: 0.7, shade: 1, at: [0, h * 0.94, 0] }));
  return assemble(parts);
}

// A broadleaf gets real branches, and the clusters hang on the ends of them.
function broadBranches(h, crown, seed) {
  const r = rng(seed), out = [];
  for (let k = 0; k < 4; k++) {
    const g = trunkGeometry(0.17, 0.07, crown * (0.85 + r() * 0.5), { sides: 4, lean: 0.62 + r() * 0.25 });
    g.rotateY(k * 1.7 + r() * 0.5);
    g.translate(0, h * 0.62, 0);
    out.push(g);
  }
  return out;
}

function broadFoliage(rects, { h = 9.5, crown = 3.6, cards = 13, seed = 11 } = {}) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < cards; k++) {
    const rect = rects[k % rects.length];
    const t = k / cards;
    const yaw = k * 2.3999 + r() * 0.3;
    const up = 0.28 + 0.78 * Math.sin(t * Math.PI * 1.6 + r() * 0.5);
    const out = crown * (0.42 + r() * 0.72) * Math.max(0.35, Math.sin(up * Math.PI * 0.85));
    const size = crown * (0.78 + r() * 0.55);
    // The outside of a crown catches the sun; the middle and underside never do.
    const shade = 0.16 + 0.84 * Math.min(1, (out / crown) * 0.55 + up * 0.7);
    parts.push(card(rect, size, size * 0.92, {
      rows: 2, tilt: 0.55 + r() * 1.0, bend: (r() - 0.5) * size * 0.5, yaw, shade,
      droop: size * 0.18, cross: true,
      at: [Math.cos(yaw) * out, h * 0.6 + up * crown, Math.sin(yaw) * out],
    }));
  }
  return assemble(parts);
}

// Two by two leaves out of the atlas make a cluster card.
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

function mergeGeoms(list) {
  const pos = [], nor = [], uv = [], col = [], sway = [], idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const c = g.attributes.color, s = g.attributes.aSway;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
      sway.push(s ? s.getX(i) : 0);
    }
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// THE BAKE: an orthographic photograph of real geometry, used for the paper
// trees and for both banners.
//
// Baked UNLIT with tone mapping off, because what goes into the texture has to
// be albedo — it is lit again where it is drawn. Bake a lit tree and every
// distant tree carries the sun angle and exposure it was baked at.
// ---------------------------------------------------------------------------
function bake(renderer, parts, frame, width, height) {
  const scene = new THREE.Scene();
  const mats = [];
  for (const { geometry, material, matrix } of parts) {
    const mat = new THREE.MeshBasicMaterial({
      map: material.map, alphaMap: material.alphaMap || null, alphaTest: material.alphaTest || 0.4,
      // NOT the material's tint. The foliage materials are tinted down to a
      // third for the live trees; baking that in as well darkens the picture
      // twice, and the first banners came out black. The paper trees'
      // brightness (Forest.relight) was calibrated on an untinted bake.
      vertexColors: !!geometry.attributes.color, side: THREE.DoubleSide, toneMapped: false,
    });
    mats.push(mat);
    const m = new THREE.Mesh(geometry, mat);
    if (matrix) { m.matrixAutoUpdate = false; m.matrix.copy(matrix); }
    scene.add(m);
  }
  const cam = new THREE.OrthographicCamera(frame.left, frame.right, frame.top, frame.bottom, 0.1, frame.depth * 2 + 200);
  cam.position.set(0, 0, frame.depth + 100);
  cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: true, colorSpace: THREE.SRGBColorSpace,
  });
  const wasTone = renderer.toneMapping, wasTarget = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color()), clearA = renderer.getClearAlpha();
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  // Cleared to the wood's own dark green, not black, at zero alpha: mipmaps
  // average the colour of the transparent texels into every leaf edge, and a
  // black clear gives a distant wood a black outline.
  renderer.setClearColor(0x1f2a18, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(wasTarget);
  renderer.setClearColor(clear, clearA);
  renderer.toneMapping = wasTone;
  for (const m of mats) m.dispose();
  rt.texture.wrapS = THREE.RepeatWrapping;
  return rt.texture;
}

function bakeTree(renderer, parts) {
  const box = new THREE.Box3();
  for (const { geometry } of parts) { geometry.computeBoundingBox(); box.union(geometry.boundingBox); }
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const half = Math.max(s.x, s.z, s.y) * 0.5;
  const shift = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
  const texture = bake(renderer, parts.map(p => ({ ...p, matrix: shift })),
    { left: -half, right: half, top: half, bottom: -half, depth: half * 2 }, 512, 512);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  return { texture, size: half * 2, base: c.y - box.min.y };
}

// ---------------------------------------------------------------------------
// PAPER TREES — one quad each, turned to face the camera in the vertex shader.
//
// IT YAWS ONLY. A billboard that also pitches lies down as you climb above
// it, and the builder has a fly camera. Trees rotate about their trunks.
// ---------------------------------------------------------------------------
function paperGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  // Centred on the quad with the radius of its corners, so it holds the quad
  // at ANY yaw — which is what lets three cull each instance by it even
  // though the shader turns them.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), Math.SQRT1_2);
  return g;
}

// Lit by ONE number (uSun), copied every frame from the scene's own sun, so
// the paper wood changes with the weather and the hour exactly as the real
// trees in front of it do.
function paperMaterial(texture) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: null }, uSun: { value: new THREE.Color(1, 1, 1) } },
    ]),
    vertexShader: `
      attribute vec3 tint;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vTint = tint;
        vec3 origin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        // Face the camera in the HORIZONTAL plane.
        vec2 flat2 = cameraPosition.xz - origin.xz;
        float len = length(flat2);
        vec2 dir = len > 1e-4 ? flat2 / len : vec2(0.0, 1.0);
        vec3 right = vec3(dir.y, 0.0, -dir.x);
        vec3 world = origin + right * (position.x * sx) + vec3(0.0, position.y * sy, 0.0);
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uSun;
      varying vec2 vUv;
      varying vec3 vTint;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.38) discard;
        gl_FragColor = vec4(t.rgb * vTint * uSun, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
  mat.uniforms.uMap.value = texture;   // merge() clones, so re-point the map
  return mat;
}

function crossGeometry(w, h, base) {
  const parts = [];
  for (const yaw of [0, Math.PI / 2]) parts.push(card({ x: 0, y: 0, w: 1, h: 1 }, w, h, { rows: 1, yaw, at: [0, -base, 0] }));
  const g = assemble(parts);
  const n = g.attributes.normal, p = g.attributes.position;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(p.getX(i), 0, p.getZ(i)).normalize().multiplyScalar(0.6);
    n.setXYZ(i, v.x, 0.8, v.z);
  }
  return g;
}

// ---------------------------------------------------------------------------
// THE BANNERS — a strip of undergrowth photographed flat, then drawn as one
// paper-thin ribbon along the wood. "paper thin 2d just flat", his words.
//
// The photograph is baked from the same cut-outs the trees are made of, and it
// TILES: every plant near an edge is drawn a second time one width over, so
// the right edge of the picture continues into the left.
// ---------------------------------------------------------------------------
function bakeBanner(renderer, kit, { width, height, seed, tall }) {
  const r = rng(seed);
  const plants = [];   // { geometry, material, x }
  const needle = kit.rects.needle, leaf = kit.rects.leaf;
  const fern = (x, h, shade) => {
    const parts = [];
    const root = r() * Math.PI * 2;
    for (let f = 0; f < 4; f++) {
      parts.push(card(needle[Math.floor(r() * needle.length)], h * 2.2, h * 1.9, {
        rows: 2, yaw: root + f * 1.57 + (r() - 0.5) * 0.6, tilt: 0.45 + r() * 0.5,
        droop: h * (0.3 + r() * 0.3), bend: h * 0.25, shade,
      }));
    }
    plants.push({ geometry: assemble(parts), material: kit.mat.needle, x });
  };
  const bush = (x, h, shade) => {
    const parts = [];
    const n = 5 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const yaw = r() * Math.PI * 2, s = h * (0.5 + r() * 0.4);
      parts.push(card(leaf[Math.floor(r() * leaf.length)], s, s * 0.9, {
        rows: 2, tilt: 0.3 + r() * 0.9, yaw, shade: shade * (0.55 + r() * 0.45),
        at: [(r() - 0.5) * h * 0.6, h * (0.15 + r() * 0.55), (r() - 0.5) * h * 0.3],
      }));
    }
    plants.push({ geometry: assemble(parts), material: kit.mat.leaf, x });
  };
  const sapling = (x, h, shade) => {
    // A young fir: the tree model at a fraction of the size.
    const g = coniferFoliage(needle, { h, spread: h * 0.22, whorls: 9, perWhorl: 2, seed: Math.floor(r() * 1e6) });
    const col = g.attributes.color;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * shade, col.getY(i) * shade, col.getZ(i) * shade);
    plants.push({ geometry: g, material: kit.mat.needle, x });
  };
  if (tall) {
    // Saplings and bushes of very different heights, with gaps between the
    // tall ones, so the top edge is a skyline and not a hedge trimmed flat.
    // Packed evenly to the full height it read as a slab from the road.
    //
    // And in CLUMPS with open gaps between them. A texture seen from 40 m is
    // sampled from its smaller mipmaps, which average neighbouring plants
    // together; packed evenly, the whole strip averaged into one flat band of
    // green and read as a plank floating in the wood. A gap two metres wide
    // survives the averaging, so the strip stays a row of plants.
    for (let x = 0; x < width;) {
      const n = 1 + Math.floor(r() * 3), top = height * (0.35 + Math.pow(r(), 0.6) * 0.65);
      for (let k = 0; k < n; k++, x += 0.9 + r() * 1.1) {
        const h = top * (0.7 + r() * 0.3);
        if (r() < kit.conifer) sapling(x, h, 0.85 + r() * 0.15);
        else bush(x, h, 0.85 + r() * 0.15);
      }
      x += 1.8 + r() * 2.6;                       // the gap
    }
    for (let x = 0; x < width; x += 0.9 + r() * 0.8) fern(x, 0.8 + r() * 0.7, 0.7 + r() * 0.3);
  } else {
    // Bracken and low bushes: a ragged top edge, solid at the bottom.
    for (let x = 0; x < width; x += 2.2 + r() * 2.0) bush(x, height * (0.35 + r() * 0.65), 0.85 + r() * 0.15);
    for (let x = 0; x < width; x += 0.45 + r() * 0.5) fern(x, height * (0.32 + r() * 0.36), 0.75 + r() * 0.25);
  }
  const parts = [];
  for (const p of plants) {
    for (const wrap of [-width, 0, width]) {
      // Rooted a little BELOW the bottom of the picture: a plant is thin at
      // its root, and standing on the frame edge left a see-through strip
      // along the foot of the banner, which read as the banner hovering.
      parts.push({ geometry: p.geometry, material: p.material, matrix: new THREE.Matrix4().makeTranslation(p.x + wrap - width / 2, -height / 2 - height * 0.1, 0) });
    }
  }
  const px = 1024;
  const texture = bake(renderer, parts,
    { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2, depth: 12 },
    px, Math.max(64, Math.round(px * height / width)));
  for (const p of plants) p.geometry.dispose();
  return texture;
}

// ---------------------------------------------------------------------------
// THE KIT — species, bakes and materials, made once per page.
//
// `plants` is anything with the BuildLook interface: cardMaterial(name, opts),
// bark(), cutouts(name). The builder passes its own; the race game makes one
// from the game's Look (see js/env.js).
// ---------------------------------------------------------------------------
export function makeKit(renderer, plants, { conifer = 0.5 } = {}) {
  const needleRects = plants.cutouts('needle'), leafRects = clusters(plants.cutouts('leaf'));
  if (!needleRects.length || !leafRects.length) return null;
  const mat = {
    // Tinted DOWN from the scan: a leaf photographed on a light table is the
    // brightest that leaf will ever be, and a wood built of them glows.
    needle: plants.cardMaterial('needle', { sway: 0.3, glow: 0.45, alphaTest: 0.45, tint: 0x93a375 }),
    leaf: plants.cardMaterial('leaf', { sway: 0.45, glow: 0.5, alphaTest: 0.45, tint: 0x92a075 }),
    bark: plants.bark(),
  };
  if (!mat.needle || !mat.leaf) return null;
  for (const m of [mat.needle, mat.leaf, mat.bark]) m.vertexColors = true;
  const kit = { mat, rects: { needle: needleRects, leaf: leafRects }, conifer };

  const species = {
    conifer: {
      trunk: trunkGeometry(0.34, 0.1, 15),
      foliage: coniferFoliage(needleRects, { h: 15, spread: 3.0, whorls: 16, perWhorl: 2, seed: 3 }),
      mat: mat.needle,
    },
    broad: {
      trunk: mergeGeoms([trunkGeometry(0.42, 0.22, 9.5), ...broadBranches(9.5, 3.5, 12)]),
      foliage: broadFoliage(leafRects, { h: 9.5, crown: 3.6, cards: 20, seed: 11 }),
      mat: mat.leaf,
    },
  };
  for (const sp of Object.values(species)) {
    sp.card = bakeTree(renderer, [
      { geometry: sp.foliage, material: sp.mat },
      { geometry: sp.trunk, material: { map: mat.bark.map, alphaTest: 0 } },
    ]);
    sp.paper = paperMaterial(sp.card.texture);
    sp.cross = crossGeometry(sp.card.size, sp.card.size, sp.card.base);
    sp.crossMat = new THREE.MeshStandardMaterial({
      map: sp.card.texture, alphaTest: 0.35, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0, envMapIntensity: 0.7, vertexColors: false,
    });
  }
  kit.species = species;
  kit.paperGeom = paperGeometry();

  const banner = (spec) => {
    const map = bakeBanner(renderer, kit, spec);
    // LAMBERT, no specular at all. A standard material sees this ribbon
    // nearly edge-on from a car — grazing angle, where Fresnel turns even a
    // rough leaf into a mirror of the sky — and the first banners came out as
    // pale grey slabs. Measured: the bake's own colour is a dark green, 12/255
    // on the green channel. The grey was all reflection.
    const m = new THREE.MeshLambertMaterial({
      map, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true,
    });
    return { mat: m, width: spec.width, height: spec.height };
  };
  kit.short = banner({ width: 16, height: SHORT_H, seed: 71, tall: false });
  kit.tall = banner({ width: 24, height: TALL_H, seed: 97, tall: true });

  // Lambert for the same reason as the banners: no sheen of sky on the black.
  // Transparent only for the fade; it writes depth, because the wall and its
  // lid are one mesh and the wall has to hide the lid behind it.
  const back = new THREE.MeshLambertMaterial({
    color: 0x1b2816, side: THREE.DoubleSide,
    vertexColors: true, transparent: true, depthWrite: true,
  });
  back.onBeforeCompile = (sh) => {
    sh.uniforms.uClear = { value: DARK_CLEAR };
    sh.uniforms.uSolid = { value: DARK_SOLID };
    sh.vertexShader = 'varying float vFlatDist;\n' + sh.vertexShader.replace(
      '#include <project_vertex>', '#include <project_vertex>\n  vFlatDist = -mvPosition.z;');
    sh.fragmentShader = 'uniform float uClear;\nuniform float uSolid;\nvarying float vFlatDist;\n'
      + sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.a *= smoothstep(uClear, uSolid, vFlatDist);');
  };
  back.customProgramCacheKey = () => 'wdc-forest-back';
  kit.back = back;
  return kit;
}

// ---------------------------------------------------------------------------
// THE FOREST
//
// A LINE is an array of samples along a treeline, in three's world space:
//   { x, z,        where the wood begins
//     nx, nz,      unit vector pointing INTO the wood
//     d,           metres from here to the backdrop ("depends on the area")
//     far,         metres of wood behind the backdrop, for the canopy lid
//     conifer,     0..1, the share of firs (per circuit, per section)
//     density }    1 = the recipe's spacing; 0.5 = half as many trees
// Consecutive samples are one continuous wood. A caller ends a line wherever
// the wood stops or jumps.
//
// `ground(x, z)` is the height of the land, `clear(x, z)` is false wherever a
// tree must not stand (a road, a pit lane, a building).
// ---------------------------------------------------------------------------
export class Forest {
  // `skip`: layers to leave out — 'rows', 'short', 'tall', 'paper', 'back' —
  // for looking at one layer at a time (?woods=-back,-tall in the race game).
  constructor(kit, { ground = () => 0, clear = () => true, shadows = true, seed = 1234, name = 'forest', skip = [] } = {}) {
    this.kit = kit;
    this.skip = new Set(skip);
    this.ground = ground; this.clear = clear;
    this.shadows = shadows;
    this.r = rng(seed);
    this.group = new THREE.Group();
    this.group.name = name;
    this.buckets = new Map();
    this.cells = [];
    this.counts = { trees: 0, paper: 0, banner: 0, backdrop: 0, lines: 0 };
    this.depths = [];          // every sample's `d`, for stats(): how deep the woods came out
    this.sunLight = null;
  }

  // -- one item -------------------------------------------------------------
  put(t) {
    const key = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, b = { conifer: [], broad: [], paperConifer: [], paperBroad: [] });
    b[t.paper ? (t.sp === 'conifer' ? 'paperConifer' : 'paperBroad') : t.sp].push(t);
  }

  /** A single real tree, standing where the survey says it stands. */
  tree(x, z, { conifer = 0, scale = 1, shade = 1 } = {}) {
    const r = this.r;
    this.put({
      sp: r() < conifer ? 'conifer' : 'broad', paper: false,
      x, z, y: this.ground(x, z), yaw: r() * Math.PI * 2, scale, stretch: 0.9 + r() * 0.2,
      tint: shade * (0.85 + r() * 0.3),
    });
  }

  /** A cut-out tree somewhere nobody drives past closely: the deep of a wood. */
  paper(x, z, { conifer = 0, scale = 1, layer = LAYER.paper[2] } = {}) {
    const r = this.r;
    this.put({
      sp: r() < conifer ? 'conifer' : 'broad', paper: true,
      x, z, y: this.ground(x, z), scale, tint: Math.pow(LAYER_SHADE, layer) * (0.85 + r() * 0.3),
    });
  }

  // -- where each layer stands at a sample ----------------------------------
  // Everything scales a little with the depth of the wood, so a deep forest
  // is roomier and a thin one tighter, but trees never crowd closer than 3.5 m
  // or spread further than 6.5 m apart row to row.
  static layout(d) {
    const g = Math.min(6.5, Math.max(3.5, ROW_GAP * d / 40));
    const rows = [0.5 * g, 1.5 * g, 2.5 * g];
    const short = 2.0 * g;
    const tall = 3.1 * g;
    const p0 = tall + 1.5;
    const room = d - p0;
    const nPaper = Math.max(0, Math.min(3, Math.floor(room / PAPER_GAP_MIN)));
    const pg = nPaper ? Math.max(PAPER_GAP_MIN, room / 3) : 0;
    const paper = [];
    for (let k = 0; k < nPaper; k++) paper.push(p0 + (k + 0.5) * pg);
    return {
      g, rows, short, tall, paper,
      back: nPaper === 3 ? p0 + 3 * pg : null,
    };
  }

  // -- plant one line -------------------------------------------------------
  line(pts) {
    if (pts.length < 2) return this;
    this.counts.lines++;
    for (const p of pts) this.depths.push(p.d);
    const r = this.r;
    const at = (a, b, t, off) => {
      // Between two samples, `off` metres into the wood.
      let nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
      const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      return { x: a.x + (b.x - a.x) * t + nx * off, z: a.z + (b.z - a.z) * t + nz * off };
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const d = Math.min(a.d, b.d);
      const lay = Forest.layout(d);
      const dens = (a.density ?? 1);
      const conifer = a.conifer ?? 0.5;
      // Three rows of real trees, each randomly resized and spun.
      lay.rows.forEach((row, k) => {
        if (row > d + 1 || this.skip.has('rows')) return;
        const n = (seg / ROW_SPACING[k]) * dens;
        let m = Math.floor(n) + (r() < n - Math.floor(n) ? 1 : 0);
        while (m-- > 0) {
          const p = at(a, b, r(), row + (r() - 0.5) * lay.g * 0.8);
          if (!this.clear(p.x, p.z)) continue;
          this.put({
            sp: r() < conifer ? 'conifer' : 'broad', paper: false,
            x: p.x, z: p.z, y: this.ground(p.x, p.z),
            yaw: r() * Math.PI * 2, scale: 0.7 + r() * 0.6, stretch: 0.9 + r() * 0.2,
            tint: Math.pow(LAYER_SHADE, LAYER.row[k]) * (0.82 + r() * 0.36),
          });
        }
      });
      // Three rows of paper, a little taller, packed into a mass.
      lay.paper.forEach((row, k) => {
        if (this.skip.has('paper')) return;
        const n = (seg / PAPER_SPACING) * Math.max(0.6, dens);
        let m = Math.floor(n) + (r() < n - Math.floor(n) ? 1 : 0);
        while (m-- > 0) {
          const p = at(a, b, r(), row + (r() - 0.5) * PAPER_GAP_MIN);
          if (!this.clear(p.x, p.z)) continue;
          this.put({
            sp: r() < conifer ? 'conifer' : 'broad', paper: true,
            x: p.x, z: p.z, y: this.ground(p.x, p.z),
            scale: PAPER_TALLER * (0.8 + r() * 0.45),
            tint: Math.pow(LAYER_SHADE, LAYER.paper[k]) * (0.85 + r() * 0.3),
          });
        }
      });
    }
    if (!this.skip.has('short')) this.ribbon(pts, 'short', p => Forest.layout(p.d).short, LAYER.short);
    if (!this.skip.has('tall')) this.ribbon(pts, 'tall', p => {
      const lay = Forest.layout(p.d);
      return lay.tall <= p.d ? lay.tall : null;
    }, LAYER.tall);
    if (!this.skip.has('back')) this.backdrop(pts);
    return this;
  }

  // -- a banner: one flat strip, `offset` metres into the wood --------------
  ribbon(pts, which, offset, layer) {
    const spec = this.kit[which];
    // x1.7: the trees either side are lit by the sky as well as the sun
    // (standard materials, image-based light, light through the leaves) and
    // a Lambert banner is not, so at the bare layer shade it sat far darker
    // than the rows it stands between. Measured against them on the screen.
    const shade = Math.min(1, Math.pow(LAYER_SHADE, layer) * 1.7);
    let pos = [], nor = [], col = [], uv = [], idx = [], u = this.r() * 50, run = 0, prev = null;
    const flush = () => {
      if (idx.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, spec.mat);
        m.name = `forest.${which}`;
        m.castShadow = false; m.receiveShadow = this.shadows;
        this.group.add(m);
        this.counts.banner++;
      }
      pos = []; nor = []; col = []; uv = []; idx = []; run = 0;
    };
    for (const p of pts) {
      const off = offset(p);
      if (off == null) { prev = null; continue; }
      const x = p.x + p.nx * off, z = p.z + p.nz * off;
      if (!this.clear(x, z)) { prev = null; continue; }
      const y = this.ground(x, z);
      if (prev) {
        const step = Math.hypot(x - prev.x, z - prev.z);
        // On the inside of a tight bend the offset line folds back on itself;
        // a strip drawn backwards is a strip drawn twice. Skip that stretch.
        const along = (x - prev.x) * (p.x - prev.px) + (z - prev.z) * (p.z - prev.pz);
        if (step < 0.05 || along <= 0 || step > 25) { prev = null; continue; }
        u += step / spec.width;
        run += step;
      }
      const base = pos.length / 3;
      // Facing the road, leaned a little toward the sky so it takes light
      // like foliage rather than like a wall.
      nor.push(-p.nx * 0.8, 0.6, -p.nz * 0.8, -p.nx * 0.8, 0.6, -p.nz * 0.8);
      pos.push(x, y - 0.25, z, x, y + spec.height, z);
      uv.push(u, 0, u, 1);
      // A slow wander in brightness along the strip, so a hundred metres of
      // it is not one tone.
      const k = shade * (0.8 + 0.4 * (0.5 + 0.5 * Math.sin(u * 2.3 + Math.sin(u * 0.7) * 3)));
      col.push(k, k, k, k, k, k);
      if (prev && base >= 2) idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
      prev = { x, z, px: p.x, pz: p.z };
      if (run > PIECE) {
        // Start the next piece on this same pair of vertices, so the strip
        // carries on without a gap where one mesh hands over to the next.
        const pair = { p: pos.slice(-6), n: nor.slice(-6), c: col.slice(-6), u: uv.slice(-4) };
        flush();
        pos.push(...pair.p); nor.push(...pair.n); col.push(...pair.c); uv.push(...pair.u);
      }
    }
    flush();
  }

  // -- the backdrop: a near-black wall, and a canopy lid behind it ----------
  backdrop(pts) {
    let pos = [], nor = [], col = [], idx = [], run = 0, prev = null;
    const WALL = Math.pow(LAYER_SHADE, LAYER.back) / 0.07;   // ~1: the material colour IS the black-green
    const LID = 0.9;       // the canopy from above: dark, but not a hole in the world
    const flush = () => {
      if (idx.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, this.kit.back);
        m.name = 'forest.back';
        m.castShadow = false; m.receiveShadow = false;
        this.group.add(m);
        this.counts.backdrop++;
      }
      pos = []; nor = []; col = []; idx = []; run = 0;
    };
    const quad = (a, b, c, d, shade, n) => {
      const base = pos.length / 3;
      for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(shade, shade, shade); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const p of pts) {
      const lay = Forest.layout(p.d);
      if (lay.back == null) { prev = null; continue; }
      const ix = p.x + p.nx * lay.back, iz = p.z + p.nz * lay.back;
      if (!this.clear(ix, iz)) { prev = null; continue; }
      // The lid's far edge obeys the same `clear` as everything else, or the
      // canopy reaches over a road or off the edge of the fine terrain.
      let far = Math.max(4, p.far ?? 40);
      while (far > 4 && !this.clear(ix + p.nx * far, iz + p.nz * far)) far -= 4;
      const ox = ix + p.nx * far, oz = iz + p.nz * far;
      const hi = this.ground(ix, iz), ho = this.ground(ox, oz);
      const here = { in: [ix, hi - 0.5, iz], top: [ix, hi + WALL_H, iz], out: [ox, ho + 0.8, oz], x: ix, z: iz };
      if (prev) {
        const step = Math.hypot(ix - prev.x, iz - prev.z);
        if (step > 0.05 && step < 25) {
          quad(prev.in, here.in, here.top, prev.top, WALL, [-p.nx * 0.7, 0.7, -p.nz * 0.7]);
          quad(prev.top, here.top, here.out, prev.out, LID, [0, 1, 0]);
          run += step;
        }
      }
      prev = here;
      if (run > PIECE) { flush(); prev = here; }
    }
    flush();
  }

  // -- turn the buckets into instanced meshes -------------------------------
  build() {
    for (const [key, b] of this.buckets) this.cell(key, b);
    this.buckets.clear();
    return this;
  }

  cell(key, b) {
    const [cx, cz] = key.split(',').map(Number);
    const cell = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, lods: [], lod: undefined };
    const sp = this.kit.species;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();

    for (const name of ['paperConifer', 'paperBroad']) {
      const list = b[name];
      if (!list.length) continue;
      const s = sp[name === 'paperConifer' ? 'conifer' : 'broad'];
      const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      list.forEach((t, i) => {
        // NO rotation: the shader decides which way it faces, and reads the
        // scale out of the column lengths, which only holds for identity.
        pos.set(t.x, t.y, t.z);
        const w = s.card.size * t.scale;
        scl.set(w, w, w);
        m.compose(pos, q.identity(), scl);
        m.toArray(mat4.array, i * 16);
        tint.setXYZ(i, t.tint * 0.94, t.tint, t.tint * 0.84);
      });
      // Its own geometry sharing the quad's buffers: `tint` is per instance.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.kit.paperGeom.getAttribute('position'));
      geo.setAttribute('uv', this.kit.paperGeom.getAttribute('uv'));
      geo.setIndex(this.kit.paperGeom.getIndex());
      geo.setAttribute('tint', tint);
      geo.boundingSphere = this.kit.paperGeom.boundingSphere.clone();
      const im = new THREE.InstancedMesh(geo, s.paper, list.length);
      im.instanceMatrix = mat4;
      im.castShadow = false; im.receiveShadow = false;
      im.name = 'env.trees';   // tools/groundcheck.mjs walks these
      this.group.add(im);
      this.counts.paper += list.length;
    }

    for (const name of ['conifer', 'broad']) {
      const list = b[name];
      if (!list.length) continue;
      const s = sp[name];
      // ONE matrix array, three meshes: the LODs are the same trees further away.
      const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw);
        pos.set(t.x, t.y, t.z);
        scl.set(t.scale, t.scale * (t.stretch ?? 1), t.scale);
        m.compose(pos, q, scl);
        m.toArray(mat4.array, i * 16);
        tint.setXYZ(i, t.tint * 0.94, t.tint, t.tint * 0.84);
      });
      const mesh = (geo, material, shadow, label) => {
        const im = new THREE.InstancedMesh(geo, material, list.length);
        im.instanceMatrix = mat4;
        im.instanceColor = tint;
        // Only the nearest level casts: a shadow map is a second draw, and a
        // forest of alpha-tested cards is the costliest thing to draw twice.
        im.castShadow = shadow && this.shadows;
        im.receiveShadow = false;
        im.visible = false;
        if (label) im.name = label;
        this.group.add(im);
        return im;
      };
      cell.lods.push({
        full: [mesh(s.trunk, this.kit.mat.bark, true), mesh(s.foliage, s.mat, true, 'env.trees')],
        cards: [mesh(s.foliage, s.mat, false)],
        far: [mesh(s.cross, s.crossMat, false)],
      });
      this.counts.trees += list.length;
    }
    if (cell.lods.length) this.cells.push(cell);
  }

  // -- per frame ------------------------------------------------------------
  update(camera) {
    const cam = camera.position;
    for (const cell of this.cells) {
      const d = Math.hypot(cell.x - cam.x, cell.z - cam.z);
      const want = d < LOD_FULL ? 'full' : d < LOD_CARDS ? 'cards' : d < LOD_FAR ? 'far' : null;
      if (cell.lod === want) continue;
      cell.lod = want;
      for (const set of cell.lods) {
        for (const k of ['full', 'cards', 'far']) for (const mm of set[k]) mm.visible = (k === want);
      }
    }
    this.relight();
  }

  /** The paper layer's one number, from the scene's own sun. */
  relight(light = this.sunLight) {
    const c = this._sun || (this._sun = new THREE.Color());
    if (light) c.copy(light.color).multiplyScalar(Math.min(1.15, 0.42 + light.intensity * 0.22));
    else c.setRGB(1, 1, 1);
    for (const s of Object.values(this.kit.species)) s.paper.uniforms.uSun.value.copy(c);
  }

  stats() {
    const d = [...this.depths].sort((a, b) => a - b);
    const at = f => d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(f * d.length))]) : null;
    // `full` is the share of treeline deep enough for all three paper rows and
    // the backdrop; below that the wood is honestly thin, or cut short.
    const full = d.length ? d.filter(v => Forest.layout(v).back != null).length / d.length : 0;
    return { ...this.counts, cells: this.cells.length, depth: [at(0.1), at(0.5), at(0.9)], full: +full.toFixed(2) };
  }
}
