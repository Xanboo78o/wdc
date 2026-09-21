// flora.js — the woods, and the suggestion of grass.
//
// REBUILT 2026-09-19 to Adam's brief, which was an art note and the
// performance fix at the same time, because they turned out to be one thing:
//
//   "the woods dont look like woods, woods tend to get a lot darker, so for
//    the forests, make it do like 5 rows of increasingly packed trees, then a
//    dark box that doesnt stick up from the top but still not visible and
//    looks like woods... at speed, just INSINUATE grass, not actually show it"
//
// THE WOOD IS A WALL AND A LID. A real wood seen from outside is a few rows of
// trunks with DARKNESS behind them — you never see the hundredth tree, you see
// that you cannot see it. So the trees stand in five rows that get denser
// going back, and behind the third row is a dark mass: a wall along the
// treeline and a canopy over it, both BELOW the height of the trees, so the
// skyline is always real branches and never a box edge. The inside of the wood
// is then two triangles deep instead of four hundred trees deep. That is why
// the first version drew 9,266 trees at one frame a second and this one does
// not.
//
// GRASS IS A FRINGE. A lawn of instanced blades is thousands of alpha-tested
// quads for something you pass at 250 km/h. What the eye checks is the EDGE —
// the line where the asphalt stops. So there is one strip of real photographed
// blades standing along that line and nothing anywhere else; the rest of the
// green is the ground texture doing its job.
//
// Where the wood goes is still written down, section by section, in
// data/build/scenery.js. Density inside a section is random; the fact that the
// esses run through pine is a decision.
import * as THREE from 'three';
import { pointAt, surfaceY } from './path.js';
import { V } from './meshes.js';
import { GROUND } from './ground.js';
import { SCENERY, KINDS, FOREST_DEPTH } from '../../data/build/scenery.js';

// --- the wood, in five layers -----------------------------------------------
// RE-LAYERED 2026-09-21 to Adam's cascade, which is an art note and a draw-call
// budget at the same time — as his forest notes keep turning out to be:
//
//   "2 layers of randomly placed, roated, and sized trees, then with flat
//    ribbon band of like ferns and such, then flat paper trees that rotate to
//    face the player, and after 4 tight layers of those, just a forest
//    backdrop that fills the gaps, and the brightness is taken wayyy down to
//    show it get darker wit more trees"
//
//   1. NEAR    two rows of real geometry — trunk, branches, foliage cards
//   2. FERNS   a low ribbon of bracken at their feet, hiding where trunk meets
//              ground, which is the join the eye actually checks
//   3. PAPER   four tight rows of single quads that yaw to face the camera
//   4. BACK    the backdrop, filling whatever the paper rows leave open
//   5. and every layer darker than the one in front of it
//
// The previous version was five rows of real trees. Two rows of geometry and
// four of paper is the same wall for a fraction of the triangles, and the
// paper never thins out at a grazing angle the way a fixed cross-card does,
// because it turns.
const NEAR_ROWS = 2;            // rows of real trees at the front
const NEAR_GAP = 6.0;           // m between them
// MEASURED, not chosen. At the first values this cascade planted 0.0178 trees
// per square metre and you could see the sky through a pine wood — the
// photograph was unambiguous. A 4 m canopy needs about 0.06 per square metre
// before the gaps close. These are that, and no more.
//
// The two numbers mean different things and it matters. NEAR_PACK plants
// STEMS, so it stays near the density authored in scenery.js. CARD_PACK is
// not stems at all: it is the inside of the wood drawn as paper, and its
// density is a visual quantity — how much foliage stands between you and the
// backdrop — not an ecological one. A wood is not 30 trees per stem; a wood
// is opaque, and this is what opaque costs in quads.
const NEAR_PACK = [1.4, 2.2];   // the second row denser than the first
const CARD_ROWS = 4;            // rows of camera-facing paper behind them
const CARD_GAP = 3.6;           // m: TIGHT, so the rows overlap into a mass
const CARD_PACK = [5.5, 6.5, 7.5, 8.5];
// Light through a canopy is Beer-Lambert — a constant FRACTION per layer, not
// a constant amount. At 0.68 the backdrop behind six layers of wood sits at
// ten percent of full sun, which is what "wayyy down" measures out to.
const LAYER_SHADE = 0.68;
const NEAR_DEPTH = NEAR_ROWS * NEAR_GAP;            // 12 m of real trees
const CARD_DEPTH = CARD_ROWS * CARD_GAP;            // 14.4 m of paper
const BACK_AT = NEAR_DEPTH + CARD_DEPTH;            // where the backdrop stands
const FERN_DEPTH = 7;           // m of bracken, from the treeline inward
const FERN_STEP = 1.5;          // m along the road between fern clumps
const FERN_H = 0.55;            // m: a frond stands about knee high
const DARK_H = 10.0;            // m: under the canopy, so it never breaks the skyline
// 7.2 m was set when the wood in front of it was five rows of real trees. From
// the road, 26 m back, a 7.2 m wall covers about 15 degrees of elevation and a
// 15 m tree covers 30 — so with any gap in the canopy you saw SKY over the top
// of the backdrop, which is the one thing it exists to prevent.
const DARK_DEPTH = 70;          // m of wood the dark mass covers, then it lands
const DARK_CLEAR = 14;          // m: nearer than this the mass is invisible
const DARK_SOLID = 75;          // m: by here it is the full darkness
const CELL = 220;               // m, one forest bucket
// m behind the barrier before anything is allowed to grow. `near` in
// scenery.js is measured from the CENTRELINE, and a standard section is 7 m of
// half-road plus 12 m of run-off — so `pine`'s near: 8 was planting trees
// ELEVEN METRES deep into the gravel. The fringe grass got this right
// (it starts at w + run); the wood never asked.
const TREE_CLEAR = 2;
// Measured on the Intel chip this runs on: the whole wood costs about 7 fps of
// a 20 fps frame, so these are as far out as they can be afforded rather than
// as far as they look good.
const LOD_FULL = 105;           // m: trunks and all
const LOD_CARDS = 280;          // m: foliage only, no trunks
const LOD_FAR = 520;            // m: one baked cross-card, then nothing

// --- the fringe -------------------------------------------------------------
const FRINGE_H = 0.34;          // m of blade standing at the edge of the verge
const FRINGE_STEP = 1.6;        // m between tufts along it

// ---------------------------------------------------------------------------
// THE OFFSET BAND FOLDS THROUGH THE CENTRE OF A CORNER.
//
// `pointAt(path, i, lat)` steps lat metres to the left of sample i. The area
// element of that mapping is (1 - k*lat), where k is the curvature — so at
// lat = 1/k it is ZERO, and every sample along the road maps to the same
// point: the centre of the arc. Past it the band turns inside out.
//
// The megatrack runs a 720-degree loop at R38 and the snail winds to R34. On
// the INSIDE of those, wood planted 26 m out and bracken 7 m out is most of
// the way to the centre, and what it draws is a fan of cards radiating from a
// single point. It was invisible from the road and unmistakable in one
// photograph taken from above.
//
// `roadSlack` cannot catch this — the middle of a hairpin is not a road, it is
// grass, and the fold lands on legal ground. It is a defect of the
// COORDINATES, so it has to be tested in them.
const FOLD_MARGIN = 0.38;       // never place past 62% of the way to the centre
function unfolded(p, i, lat) {
  return 1 - (p.k?.[i] || 0) * lat > FOLD_MARGIN;
}

// Deterministic, so the same track always grows the same wood.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------
// A bent card, which is every leaf and every blade in this file.
//
// `shade` is the addition that stopped the trees looking, in Adam's words,
// kindergarten-drawn. It is written into a vertex colour and darkens a card by
// how deep in the crown it sits: real foliage is a MASS, lit on the outside
// and shadowed inside, and a tree whose every leaf is the same bright green is
// a cartoon of a tree no matter how many leaves you give it.
// ---------------------------------------------------------------------------
// KEEP IN STEP WITH js/trees.js, which is the showroom's copy of this. The
// two were split apart on 2026-09-19 and every change since has had to be
// made twice; if they ever disagree, this one is the one the game draws.
function card(rect, w, h, { rows = 2, bend = 0, tilt = 0, yaw = 0, at = [0, 0, 0], shade = 1, droop = 0, roll = 0, cross = false } = {}) {
  // CROSS: the same spray twice, the second rolled onto its edge.
  //
  // Adam, on this wood: "the leaves are paper thin, and from the side they
  // look like they arent there. from above they look great."
  //
  // Those are one fact, not two. A card is a single ribbon whose width runs
  // horizontally, so all of its area points UP — which is why it reads from
  // above and is geometrically nothing from the side, a plane seen edge-on
  // being a line. No amount of leaf detail can fix that; there is nothing
  // there to light. The second copy, rolled 90 degrees about the spray's own
  // growth axis, gives the pair area from every horizontal direction.
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
  // Where the card's WIDTH points once rolled about the growth axis. At roll 0
  // this is (1,0,0) and every line below is what it has always been.
  const wx = Math.cos(roll), wy = -Math.sin(roll) * st, wz = Math.sin(roll) * ct;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const lean = bend * t * t;
    const y = h * t * ct - droop * t * t;
    const z0 = h * t * st + lean;
    // Lighter toward the tip, darker at the root: the inside of a branch is
    // the shaded part.
    const k = shade * (0.74 + 0.26 * t);
    for (const s of [-0.5, 0.5]) {
      const x = s * w * (1 - 0.12 * t);
      const lx = x * wx, ly = y + x * wy, lz = z0 + x * wz;
      pos.push(lx * cy - lz * sy + at[0], ly + at[1], lx * sy + lz * cy + at[2]);
      uv.push(rect.x + (s + 0.5) * rect.w, rect.y + t * rect.h);
      sway.push(t);
      if (roll === 0) {
        // Normals pushed toward vertical: the truth for a leaf is "this faces
        // everywhere", and it is what stops a wood flickering black as the sun
        // crosses it. Untouched, so any change on screen is the CROSS.
        nor.push(-sy * 0.45, 0.89, cy * 0.45);
      } else {
        // The rolled copy stands on edge, where "mostly up" would light it
        // like a floor. Real normal — growth crossed with width — leaned back
        // toward the sky for the same anti-flicker reason.
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

function assemble(parts) {
  const pos = [], uv = [], sway = [], nor = [], col = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos); uv.push(...p.uv); sway.push(...p.sway); nor.push(...p.nor); col.push(...p.col);
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
// Trees.
// ---------------------------------------------------------------------------
function trunkGeometry(rBase, rTop, h, { sides = 6, lean = 0 } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, sides, 1, false);
  g.translate(0, h / 2, 0);
  if (lean) g.rotateZ(lean);
  // UVs are metres here too, so the bark photograph is the size it was shot at.
  const uv = g.attributes.uv;
  const circ = 2 * Math.PI * (rBase + rTop) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  const n = g.attributes.position.count;
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  // A trunk in a wood stands in shadow. Flat-lit bark is most of why a
  // low-poly tree reads as a lamp post with a bush on top.
  const col = new Float32Array(n * 3).fill(0.62);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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

// A broadleaf gets real branches, and the clusters hang on the ENDS of them.
// Leaves floating in a ball around a pole is the other half of the
// kindergarten look: a crown has structure holding it up.
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

// 13 crossed sprays, not 20 flat ones. A cross is two ribbons, so this is 26
// pieces of foliage against the old 20 — a third more triangles for area from
// every direction instead of only from above.
function broadFoliage(rects, { h = 9.5, crown = 3.6, cards = 13, seed = 11 } = {}) {
  const r = rng(seed), parts = [];
  for (let k = 0; k < cards; k++) {
    const rect = rects[k % rects.length];
    const t = k / cards;
    const yaw = k * 2.3999 + r() * 0.3;
    // Up the crown and out from the middle: a ball with a flat-ish underside,
    // which is what a tree grown toward light actually is.
    const up = 0.28 + 0.78 * Math.sin(t * Math.PI * 1.6 + r() * 0.5);
    const out = crown * (0.42 + r() * 0.72) * Math.max(0.35, Math.sin(up * Math.PI * 0.85));
    const size = crown * (0.78 + r() * 0.55);
    // The outside of a crown catches the sun; the middle and the underside
    // never do. The floor used to be 0.44, which made the deepest leaf in the
    // crown a bit over half as bright as the sunlit rim — a tree lit like a
    // lampshade. A canopy is metres of leaves stacked on leaves and almost no
    // light reaches through; 0.16 is what "you cannot see into it" looks like.
    const shade = 0.16 + 0.84 * Math.min(1, (out / crown) * 0.55 + up * 0.7);
    parts.push(card(rect, size, size * 0.92, {
      rows: 2, tilt: 0.55 + r() * 1.0, bend: (r() - 0.5) * size * 0.5, yaw, shade,
      droop: size * 0.18, cross: true,
      at: [Math.cos(yaw) * out, h * 0.6 + up * crown, Math.sin(yaw) * out],
    }));
  }
  return assemble(parts);
}

// Two by two leaves out of the atlas make a cluster card: the atlas is a grid
// of single leaves, and a rectangle spanning four of them is a branch's worth
// of foliage, with transparent gaps, in one quad.
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

// Merge geometries that share this file's attribute set.
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
// The impostor bake: one orthographic render of a real tree, standing in for
// it past a quarter of a kilometre.
//
// Baked UNLIT with tone mapping off, because what goes into the texture has to
// be albedo — the card is lit again when it is drawn. Bake a lit tree and
// every distant tree in the world carries the sun angle and the exposure it
// was baked at.
// ---------------------------------------------------------------------------
function bakeImpostor(renderer, parts, size = 512) {
  const scene = new THREE.Scene();
  const box = new THREE.Box3();
  for (const { geometry, material } of parts) {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: material.map, alphaMap: material.alphaMap, alphaTest: material.alphaTest || 0.4,
      vertexColors: !!geometry.attributes.color, side: THREE.DoubleSide, toneMapped: false,
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
  return { texture: rt.texture, size: half * 2, base: c.y - box.min.y };
}

// ---------------------------------------------------------------------------
// PAPER TREES — one quad each, turned to face the camera every frame.
//
// Adam: "flat paper trees that rotate to face the player". The turning is the
// whole point and it is why this beats the fixed cross-card it sits in front
// of: a cross has area from every direction but always shows you its seam,
// and a single fixed card goes to a line at a grazing angle. A card that
// turns is always full width and never has a seam, for half the triangles.
//
// IT YAWS ONLY. A billboard that also pitches toward the camera lies down as
// you climb above it, and this builder has a fly camera, so that failure is
// not hypothetical — it would be the first thing seen from the air. Trees
// rotate about their trunks. The horizon is not one of the axes.
//
// Done in the vertex shader rather than by rewriting matrices on the CPU:
// twelve thousand instances is twelve thousand matrix composes a frame
// otherwise, for a wood that has not changed.
function paperGeometry() {
  // A unit quad standing ON its origin: y from 0 to 1, x from -0.5 to 0.5.
  // The instance matrix carries where and how big. Nothing here knows about
  // the impostor's own framing, which is what made the fixed card ambiguous.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

function paperMaterial(texture) {
  // The impostor is baked UNLIT, so it is albedo and it is lit here — by one
  // number. A wood two hundred metres deep does not need a normal; it needs
  // to be the right brightness and to sit in the same fog as everything else,
  // or it floats in front of the sky like a sticker.
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: texture }, uSun: { value: new THREE.Color(1, 1, 1) } },
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
        // The instance matrix is translation and scale only for these, so its
        // columns give both without a decompose.
        vec3 origin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        // Face the camera in the HORIZONTAL plane. Degenerate exactly
        // overhead, where a tree is a dot, so the fallback never shows.
        vec3 toCam = cameraPosition - origin;
        vec2 flat2 = toCam.xz;
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
export class Flora {
  constructor(path, ground, look, quality = {}) {
    this.path = path; this.ground = ground; this.look = look;
    this.q = { trees: 1, fringe: true, shadows: true, ...quality };
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.forest = new THREE.Group();
    this.group.add(this.forest);
    this.cells = [];
    this.counts = { trees: 0, paper: 0, cells: 0, blades: 0, ferns: 0, darkRuns: 0 };
  }

  // -- which section of scenery a sample belongs to --------------------------
  sections() {
    const p = this.path;
    this.kindAt = new Array(p.n);
    let current = SCENERY.START || SCENERY.default;
    for (const piece of p.pieces) {
      if (piece.part && SCENERY[piece.part]) current = SCENERY[piece.part];
      const i0 = Math.floor(piece.s0 / p.ds), i1 = Math.min(p.n - 1, Math.ceil(piece.s1 / p.ds));
      for (let i = i0; i <= i1; i++) this.kindAt[i] = current;
    }
    for (let i = 0; i < p.n; i++) this.kindAt[i] ||= SCENERY.default;
    return this;
  }

  kindFor(i, side) {
    const sec = this.kindAt[i];
    return KINDS[side > 0 ? sec.left : sec.right] || KINDS.meadow;
  }

  // -- the two species, built once -------------------------------------------
  makeSpecies(renderer) {
    const L = this.look;
    const needleRects = L.cutouts('needle'), leafRects = clusters(L.cutouts('leaf'));
    this.mat = {
      // Foliage is tinted DOWN from the scan: a leaf photographed on a light
      // table is the brightest that leaf will ever be, and a wood built out of
      // them glows like a salad.
      needle: L.cardMaterial('needle', { sway: 0.3, glow: 0.45, alphaTest: 0.45, tint: 0x93a375 }),
      leaf: L.cardMaterial('leaf', { sway: 0.45, glow: 0.5, alphaTest: 0.45, tint: 0x92a075 }),
      bark: L.bark(),
      fringe: L.cardMaterial('grass', { sway: 0.8, glow: 0.35, alphaTest: 0.4 }),
    };
    if (!this.mat.needle) return false;
    for (const m of [this.mat.needle, this.mat.leaf, this.mat.bark]) m.vertexColors = true;

    const conifer = {
      trunk: trunkGeometry(0.34, 0.1, 15),
      foliage: coniferFoliage(needleRects, { h: 15, spread: 3.0, whorls: 16, perWhorl: 2, seed: 3 }),
      mat: this.mat.needle,
    };
    const broad = {
      trunk: mergeGeoms([trunkGeometry(0.42, 0.22, 9.5), ...broadBranches(9.5, 3.5, 12)]),
      foliage: broadFoliage(leafRects, { h: 9.5, crown: 3.6, cards: 20, seed: 11 }),
      mat: this.mat.leaf,
    };
    for (const sp of [conifer, broad]) {
      sp.card = bakeImpostor(renderer, [
        { geometry: sp.foliage, material: sp.mat },
        { geometry: sp.trunk, material: { map: this.mat.bark.map, alphaTest: 0 } },
      ]);
      // The paper layer. One quad geometry shared by both species; only the
      // material differs, because only the baked texture differs.
      sp.paper = paperMaterial(sp.card.texture);
      sp.cross = crossGeometry(sp.card.size, sp.card.size, sp.card.base);
      sp.crossMat = new THREE.MeshStandardMaterial({
        map: sp.card.texture, alphaTest: 0.35, side: THREE.DoubleSide,
        roughness: 0.9, metalness: 0, envMapIntensity: 0.7,
      });
      sp.crossMat.shadowSide = THREE.DoubleSide;
    }
    this.species = { conifer, broad };
    this.paperGeom = paperGeometry();
    return true;
  }

  // The paper layer is lit by ONE number, so that number has to come from the
  // same measured sky as everything else or the far wood changes weather
  // independently of the near wood. 0.62 of the sun's own colour was chosen by
  // photographing the two side by side and matching the near foliage.
  paperLight() {
    const s = this.look?.sun;
    const c = new THREE.Color(0xffffff);
    if (s) c.copy(s.color).multiplyScalar(Math.min(1.15, 0.42 + s.intensity * 0.22));
    return c;
  }

  // -------------------------------------------------------------------------
  // PLANT. Five rows along the edge of the wood, each denser than the one in
  // front of it, and nothing at all behind them: the dark mass is the wood.
  // -------------------------------------------------------------------------
  // Where the wood may start on this side at this sample: whichever is further
  // out, the section's authored `near` or the far edge of the run-off. Nothing
  // grows on a surface a car is meant to be able to use.
  treeLine(i, side, kind) {
    const p = this.path;
    const edge = p.w[i] + (side > 0 ? p.runL[i] : p.runR[i]);
    return Math.max(kind.near, edge + TREE_CLEAR);
  }

  plant() {
    const p = this.path, g = this.ground;
    const r = rng(1234);
    const buckets = new Map();
    const push = (t) => {
      const key = `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { conifer: [], broad: [], paperConifer: [], paperBroad: [] });
      b[t.paper ? (t.sp === 'conifer' ? 'paperConifer' : 'paperBroad') : t.sp].push(t);
    };
    const step = 5;                                  // m along the road between attempts
    const di = Math.max(1, Math.round(step / p.ds));
    for (let i = 0; i < p.n; i += di) {
      if (p.tunIn && p.tunIn[i] > 0) continue;       // nothing grows inside a hill
      for (const side of [1, -1]) {
        const kind = this.kindFor(i, side);
        if (!kind.trees) continue;
        const base = this.treeLine(i, side, kind);
        // Layer 1 and layer 3 are planted by the same loop, because they are
        // the same wood — only the thing that draws a tree changes. `paper`
        // says which, and `layer` counts through all six for the shading, so
        // the darkness carries on across the join instead of restarting.
        const ROWS = NEAR_ROWS + CARD_ROWS;
        for (let row = 0; row < ROWS; row++) {
          const paper = row >= NEAR_ROWS;
          const gap = paper ? CARD_GAP : NEAR_GAP;
          const pack = paper ? CARD_PACK[row - NEAR_ROWS] : NEAR_PACK[row];
          const at = paper ? NEAR_DEPTH + (row - NEAR_ROWS) * CARD_GAP : row * NEAR_GAP;
          const n = (kind.trees / 10000) * (step * gap) * pack * this.q.trees;
          for (let k = 0; k < Math.ceil(n); k++) {
            if (k > n - 1 && r() > n - Math.floor(n)) continue;
            const lat = side * (base + at + r() * gap);
            const j = Math.min(p.n - 1, i + Math.round(((r() - 0.5) * step) / p.ds));
            if (!unfolded(p, j, lat)) continue;
            const pt = pointAt(p, j, lat);
            // EXACT clearance to the nearest road, not the chamfer grid. This
            // is what keeps a wood out from under a viaduct deck or inside the
            // loop — and, where the road folds back on itself, off the tarmac
            // of the OTHER road that happens to be 10 m away.
            if (g.roadSlack(pt.x, pt.y) < TREE_CLEAR) continue;
            push({
              sp: r() < kind.conifer ? 'conifer' : 'broad', paper,
              x: pt.x, y: pt.y, h: g.height(pt.x, pt.y),
              // A paper tree has no depth to hide behind, so it leans on
              // variety instead: a wider spread of sizes than the real rows
              // get, or four rows of identical cut-outs read as wallpaper.
              yaw: r() * Math.PI * 2, scale: (paper ? 0.62 : 0.74) + r() * (paper ? 0.85 : 0.6),
              tint: 0.78 + r() * 0.4, row,
            });
          }
        }
      }
    }
    for (const [key, b] of buckets) this.buildCell(key, b);
    this.counts.cells = this.cells.length;
    return this;
  }

  buildCell(key, b) {
    const [cx, cy] = key.split(',').map(Number);
    const cell = { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, lods: [], paper: [], n: 0 };

    // -- layer 3: the paper rows --------------------------------------------
    // These have no levels of detail. They ARE the level of detail, and they
    // are already one quad; there is nothing cheaper to fall back to except
    // the backdrop behind them, which is always drawn anyway.
    for (const name of ['paperConifer', 'paperBroad']) {
      const list = b[name];
      if (!list.length) continue;
      const sp = this.species[name === 'paperConifer' ? 'conifer' : 'broad'];
      const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      list.forEach((t, i) => {
        // NO rotation in the matrix: the shader decides which way this faces,
        // and a baked-in yaw would fight it. The shader reads scale out of the
        // column lengths, which only holds while the rotation is identity.
        pos.set(t.x, t.h, -t.y);
        // ITS OWN species' card size. A conifer bakes to a 15 m card and a
        // broadleaf to 9.5; one size for both would grow every paper oak into
        // a pine's silhouette standing behind real oaks half its height.
        const w = sp.card.size * t.scale;
        scl.set(w, w, w);
        m.compose(pos, q.identity(), scl);
        m.toArray(mat4.array, i * 16);
        const shade = t.tint * Math.pow(LAYER_SHADE, t.row);
        tint.setXYZ(i, shade * 0.94, shade, shade * 0.84);
      });
      // Its own geometry, sharing the quad's buffers. `tint` is per instance,
      // so it cannot live on the one shared quad — every cell would overwrite
      // the last, and the whole wood would take the colours of whichever cell
      // was built most recently.
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.paperGeom.getAttribute('position'));
      geo.setAttribute('uv', this.paperGeom.getAttribute('uv'));
      geo.setIndex(this.paperGeom.getIndex());
      geo.setAttribute('tint', tint);
      const im = new THREE.InstancedMesh(geo, sp.paper, list.length);
      im.instanceMatrix = mat4;
      im.castShadow = false; im.receiveShadow = false;
      // The shader moves every vertex, so three's computed bounds are wrong.
      // Culling is still wanted — one bounding sphere on the CELL, inflated by
      // the tallest tree it can hold, is both correct and cheap. Switching
      // culling off instead draws every wood on the track from inside a
      // tunnel, which is how a forest costs frames while invisible.
      const big = this.species.conifer.card.size * 1.5;
      geo.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(cell.x, 0, -cell.y), CELL * 0.75 + big);
      this.forest.add(im);
      cell.paper.push(im);
      cell.n += list.length;
      this.counts.paper += list.length;
    }

    for (const name of ['conifer', 'broad']) {
      const list = b[name];
      if (!list.length) continue;
      const sp = this.species[name];
      // ONE matrix array, three meshes: the LODs are the same trees further
      // away, so they must be the same matrices, and three is happy to share
      // an InstancedBufferAttribute between meshes.
      const mat4 = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const pos = new THREE.Vector3(), scl = new THREE.Vector3();
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.yaw);
        pos.copy(V(t.x, t.y, t.h));
        scl.set(t.scale, t.scale * (0.9 + (t.tint - 0.78) * 0.5), t.scale);
        m.compose(pos, q, scl);
        m.toArray(mat4.array, i * 16);
        // Real foliage is a spread of greens, never one, and a row further
        // back sits deeper in the shade of its own wood.
        //
        // This was linear at 6% a row, which put the FIFTH row — the one that
        // is supposed to be the far side of a wood — at 76% brightness. So
        // every tree in the depth of the forest was plainly a tree, and Adam's
        // note was exactly right: "trees block LOTS of light, and thats why
        // forests look like a few trees then darkness rather you being able to
        // see every single tree."
        //
        // Light through a canopy is Beer-Lambert: it falls off by a CONSTANT
        // FRACTION per layer, not a constant amount, so the fifth row is not
        // five steps darker, it is 0.66^4 — a fifth of the light. Which is
        // what the eye reads as a wall with a wood behind it.
        const shade = t.tint * Math.pow(LAYER_SHADE, t.row);
        tint.setXYZ(i, shade * 0.94, shade, shade * 0.84);
      });
      const mesh = (geo, material, shadow) => {
        const im = new THREE.InstancedMesh(geo, material, list.length);
        im.instanceMatrix = mat4;
        im.instanceColor = tint;
        // Only the nearest level of detail casts. A shadow map is a second
        // draw of everything in it, and a forest of alpha-tested cards is the
        // most expensive thing in the scene to draw twice.
        im.castShadow = shadow && this.q.shadows;
        im.receiveShadow = false;
        im.visible = false;
        this.forest.add(im);
        return im;
      };
      cell.lods.push({
        full: [mesh(sp.trunk, this.mat.bark, true), mesh(sp.foliage, sp.mat, true)],
        cards: [mesh(sp.foliage, sp.mat, false)],
        far: [mesh(sp.cross, sp.crossMat, false)],
      });
      cell.n += list.length;
      this.counts.trees += list.length;
    }
    this.cells.push(cell);
  }

  // -------------------------------------------------------------------------
  // THE DARK MASS — the inside of the wood.
  //
  // A wall along the treeline and a lid over it, both at DARK_H, which is
  // under the canopy: the skyline stays real branches and the box is never
  // seen as a box. From the air the lid reads as canopy with trees standing
  // through it; from the road it is the darkness between the trunks, which is
  // the thing that makes a wood a wood.
  //
  // One mesh for the whole track, so a circuit lined with forest costs a
  // single draw call instead of four hundred trees' worth.
  // -------------------------------------------------------------------------
  darkness() {
    const p = this.path, g = this.ground;
    const runs = [];
    for (const side of [1, -1]) {
      let run = null;
      for (let i = 0; i < p.n; i++) {
        const kind = this.kindFor(i, side);
        const wooded = kind.trees > 40 && !(p.tunIn && p.tunIn[i] > 0);
        if (wooded) {
          if (!run) run = { side, from: i, to: i, kind };
          run.to = i;
        } else if (run) { runs.push(run); run = null; }
      }
      if (run) runs.push(run);
    }
    // ONE MESH FOR THE WHOLE TRACK IS NEVER CULLED. Its bounding sphere
    // contains the camera wherever the camera is, so the renderer draws every
    // triangle of it every frame no matter which way you are looking. Broken
    // into 160 m pieces, the frustum throws away all but a handful.
    // 512 m was measured to be the right granularity on the road meshes (the
    // other session's tools/perfcheck.mjs): 256 m bought nothing and cost
    // twice the draw calls. These are lighter meshes, so 320 m.
    const PIECE = 320;
    this.darkParts = [];
    let pos = [], nor = [], col = [], idx = [];
    // "they need a opacity effect, lke they get more solid and dark the further
    //  they extend, like the minecraft glas air glass fade trick"
    //
    // It replaces a switch. The mass used to be hidden outright whenever the
    // camera was off the road and below the canopy, because flying into it
    // filled the screen with black — but that was ONE boolean for the whole
    // circuit, so stepping onto the grass made every wood on the track lose
    // its darkness at the same instant. That is the blocks disappearing.
    //
    // Faded by distance there is nothing to switch: right in front of you it
    // is clear, so you can be inside the wood, and by DARK_SOLID metres it is
    // the full dark mass, which is the only place it was ever doing work.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4c6338, roughness: 1, metalness: 0, side: THREE.DoubleSide,
      vertexColors: true, envMapIntensity: 0.4,
      transparent: true, depthWrite: false,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uClear = { value: DARK_CLEAR };
      sh.uniforms.uSolid = { value: DARK_SOLID };
      sh.vertexShader = 'varying float vFlatDist;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vFlatDist = -mvPosition.z;');
      sh.fragmentShader = 'uniform float uClear;\nuniform float uSolid;\nvarying float vFlatDist;\n'
        + sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.a *= smoothstep(uClear, uSolid, vFlatDist);');
    };
    const flush = () => {
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false; m.receiveShadow = false;
      this.group.add(m);
      this.darkParts.push(m);
      pos = []; nor = []; col = []; idx = [];
    };
    const quad = (a, b, c, d, shade, n) => {
      const base = pos.length / 3;
      for (const v of [a, b, c, d]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(shade, shade, shade); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const run of runs) {
      if (run.to - run.from < 3) continue;
      // per sample, because the run-off it has to clear is not constant
      // Not the full forest depth: the mass is a WEDGE that comes back down to
      // the ground, not a box 200 m deep. A box that deep is a box the fly
      // camera spends most of its time inside, and from inside it is a black
      // screen — which is exactly what the first photograph of it was.
      let prev = null;
      for (let i = run.from; i <= run.to; i += 2) {
        const base = this.treeLine(i, run.side, run.kind);
        // The mass reaches DARK_DEPTH sideways, which is 70 m, and where the
        // road folds back on itself that lands on the OTHER carriageway — it
        // was lying over a road corridor at 4% of its points, worst 19 m in,
        // which draws a dark sheet hovering a metre above the tarmac. Pull the
        // far edge in until it is clear; if even the near edge is on a road,
        // there is no wood to draw here at all.
        // outward from the near edge, stopping at the FIRST intrusion: a road
        // can cross the middle of a 70 m wedge while both its ends are clear.
        let depth = BACK_AT;
        for (let f = BACK_AT; f <= DARK_DEPTH; f += 4) {
          if (!unfolded(p, i, run.side * (base + f))) break;
          const q = pointAt(p, i, run.side * (base + f));
          if (g.roadSlack(q.x, q.y) < 1) break;
          depth = f;
        }
        if (depth <= BACK_AT || !unfolded(p, i, run.side * (base + BACK_AT))) { prev = null; continue; }
        const inner = pointAt(p, i, run.side * (base + BACK_AT));
        if (g.roadSlack(inner.x, inner.y) < 1) { prev = null; continue; }
        const outer = pointAt(p, i, run.side * (base + depth));
        const hi = g.height(inner.x, inner.y), ho = g.height(outer.x, outer.y);
        const here = {
          in: [inner.x, hi - 0.5, -inner.y], inTop: [inner.x, hi + DARK_H, -inner.y],
          // the far edge sits ON the ground, so the lid is a slope that lands
          out: [outer.x, ho + 0.8, -outer.y],
        };
        if (prev) {
          // the wall facing the track, and the lid over the wood behind it
          // The wall is the darkness between the trunks; the lid is CANOPY,
          // in full sun. Painting both the same near-black made the wood read
          // as a hole in the world from every angle except the road.
          quad(prev.in, here.in, here.inTop, prev.inTop, 0.34, [0, 0.25, 0.97]);
          quad(prev.inTop, here.inTop, here.out, prev.out, 1.0, [0, 1, 0]);
        }
        prev = here;
        if ((i - run.from) * p.ds > PIECE) { flush(); prev = here; run.from = i; }
      }
      flush();
      this.counts.darkRuns++;
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // THE FRINGE — grass, insinuated.
  //
  // One strip of real blades along the edge of the verge, both sides, whole
  // track, built once: two draw calls and no streaming. What sells grass at
  // 250 km/h is the EDGE of it, not a lawn nobody will ever look down at.
  // -------------------------------------------------------------------------
  fringe() {
    if (!this.q.fringe || !this.mat?.fringe) return this;
    const p = this.path;
    const rects = this.look.cutouts('grass');
    if (!rects.length) return this;
    const r = rng(77);
    const PIECE = 300;                              // m of verge per mesh
    this.fringeParts = [];
    for (const side of [1, -1]) {
      let parts = [], mark = 0;
      const flush = () => {
        if (!parts.length) return;
        const m = new THREE.Mesh(assemble(parts), this.mat.fringe);
        m.castShadow = false; m.receiveShadow = false;
        this.group.add(m);
        this.fringeParts.push(m);
        parts = [];
      };
      for (let s = 0; s < p.length; s += FRINGE_STEP) {
        if (s - mark > PIECE) { flush(); mark = s; }
        const i = Math.min(p.n - 1, Math.round(s / p.ds));
        if (p.tunIn && p.tunIn[i] > 0) continue;
        const run = side > 0 ? p.runL[i] : p.runR[i];
        if (run <= 1.4) continue;                    // a wall right at the kerb
        const lat = side * (p.w[i] + run + 0.15 + r() * 0.5);
        if (!unfolded(p, i, lat)) continue;
        const pt = pointAt(p, i, lat);
        const y = surfaceY(p, i, side * p.w[i]) - GROUND.EPS;
        const rect = rects[Math.floor(r() * rects.length)];
        const h = FRINGE_H * (0.75 + r() * 0.6);
        // Two crossed blades per point, which from a car is a tuft.
        for (const turn of [0, 1.1]) {
          parts.push(card(rect, h * 2.6, h, {
            rows: 1, yaw: p.hdg[i] + turn + r() * 0.5, bend: (r() - 0.5) * h * 0.4,
            shade: 0.8 + r() * 0.2, at: [pt.x, y, -pt.y],
          }));
        }
        this.counts.blades += 2;
      }
      flush();
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // LAYER 2 — THE FERN RIBBON.
  //
  // Adam: "a flat ribbon band of like ferns and such". It does a specific job
  // that the trees cannot: it hides the JOIN. A trunk is a cylinder ending on
  // a triangle, and that meeting is the one place a wood always gives itself
  // away, because in a real wood you never see the bottom of a tree — you see
  // bracken, and the trunk goes into it.
  //
  // THERE IS NO FERN ON ambientCG. Every Foliage set there is grass or seed
  // heads; I checked all eight by looking at them rather than by their names.
  // But LeafSet019 is fir sprigs, and a fir sprig and a bracken frond have the
  // same silhouette — a feathered blade tapering to a point. Tilted off
  // vertical and drooped at the tip, it is bracken. No new asset was needed,
  // which is the second time this atlas has paid for itself.
  // -------------------------------------------------------------------------
  undergrowth() {
    if (!this.q.fringe || !this.mat?.needle) return this;
    const p = this.path, g = this.ground;
    const rects = this.look.cutouts('needle');
    if (!rects.length) return this;
    const r = rng(4242);
    const PIECE = 260;
    this.fernParts = [];
    for (const side of [1, -1]) {
      let parts = [], mark = 0;
      const flush = () => {
        if (!parts.length) return;
        const m = new THREE.Mesh(assemble(parts), this.mat.needle);
        m.castShadow = false; m.receiveShadow = false;
        this.group.add(m);
        this.fernParts.push(m);
        parts = [];
      };
      for (let s = 0; s < p.length; s += FERN_STEP) {
        if (s - mark > PIECE) { flush(); mark = s; }
        const i = Math.min(p.n - 1, Math.round(s / p.ds));
        if (p.tunIn && p.tunIn[i] > 0) continue;
        const kind = this.kindFor(i, side);
        if (!kind.trees) continue;                  // bracken grows under trees
        const base = this.treeLine(i, side, kind);
        // Thicker where the wood is thicker. `pine` at 120 trees a hectare
        // gets a full band; `scrub` at 14 gets a few clumps and a lot of gaps,
        // which is what scrub means.
        const clumps = Math.max(1, Math.round(kind.trees / 45));
        for (let c = 0; c < clumps; c++) {
          const into = r() * FERN_DEPTH;
          const lat = side * (base - 0.4 + into);
          const j = Math.min(p.n - 1, i + Math.round(((r() - 0.5) * FERN_STEP) / p.ds));
          if (!unfolded(p, j, lat)) continue;
          const pt = pointAt(p, j, lat);
          if (g.roadSlack(pt.x, pt.y) < 1.2) continue;
          const y = g.height(pt.x, pt.y) - GROUND.EPS;
          // Darker the deeper in it sits — the same Beer-Lambert the trees
          // use, so the ribbon and the rows agree about where the light went.
          const shade = (0.72 + r() * 0.28) * Math.pow(LAYER_SHADE, into / NEAR_GAP);
          const h = FERN_H * (0.7 + r() * 0.8);
          // Three fronds from one root at different yaws. A frond is a plane,
          // so one of them is edge-on from somewhere; three never are.
          const root = r() * Math.PI * 2;
          for (let f = 0; f < 3; f++) {
            const rect = rects[Math.floor(r() * rects.length)];
            parts.push(card(rect, h * 2.2, h * 1.9, {
              rows: 2,
              yaw: root + f * 2.09 + (r() - 0.5) * 0.5,
              tilt: 0.55 + r() * 0.45,          // leaning out from the root
              droop: h * (0.3 + r() * 0.3),     // and arcing back down at the tip
              bend: h * 0.25,
              shade,
              at: [pt.x, y, -pt.y],
            }));
          }
          this.counts.ferns += 3;
        }
      }
      flush();
    }
    return this;
  }

  // -- per frame: one level of detail per cell -------------------------------
  update(camera) {
    const cam = camera.position;
    // The dark mass used to be switched off here when the camera was inside a
    // wood. It fades by distance in its own shader now (see darkness()), so
    // there is nothing per-frame to decide and nothing to pop.
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
  }

  // The paper layer carries its light in a uniform, so it has to be told when
  // the sky changes. Called once at build; call it again if the weather does.
  relight() {
    const c = this.paperLight();
    for (const name of ['conifer', 'broad']) {
      const m = this.species?.[name]?.paper;
      if (m) m.uniforms.uSun.value.copy(c);
    }
    return this;
  }

  stats() { return { ...this.counts }; }
}

// ---------------------------------------------------------------------------
export async function buildFlora(renderer, path, ground, look, quality) {
  const f = new Flora(path, ground, look, quality);
  f.sections();
  if (!f.makeSpecies(renderer)) return f;     // no data/flora: no plants, no crash
  f.plant();
  f.darkness();
  f.fringe();
  f.undergrowth();
  f.relight();
  return f;
}
