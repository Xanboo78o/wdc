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
//
// RE-LAYERED AGAIN 2026-09-23, and moved out: the wood itself is js/forest.js
// now, Adam's third forest recipe, shared with the race circuits. This file
// only works out WHERE the treelines run along the hand-built track and how
// deep each one is, and hands them over. The grass fringe stays here.
import * as THREE from 'three';
import { pointAt, surfaceY } from './path.js';
import { GROUND } from './ground.js';
import { SCENERY, KINDS } from '../../data/build/scenery.js';
import { makeKit, Forest, card, assemble, rng } from '../forest.js';

// --- where the wood stands ----------------------------------------------------
// m behind the barrier before anything is allowed to grow. `near` in
// scenery.js is measured from the CENTRELINE, and a standard section is 7 m of
// half-road plus 12 m of run-off — so `pine`'s near: 8 was planting trees
// ELEVEN METRES deep into the gravel. The wood now starts at w + run + this.
const TREE_CLEAR = 2;
const LINE_STEP = 5;            // m along the road between treeline samples
const DARK_DEPTH = 70;          // m of canopy lid behind the backdrop, at most

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

// ---------------------------------------------------------------------------
export class Flora {
  constructor(path, ground, look, quality = {}) {
    this.path = path; this.ground = ground; this.look = look;
    this.q = { trees: 1, fringe: true, shadows: true, ...quality };
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.forest = null;
    this.counts = { blades: 0 };
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

  // How deep the wood is here, treeline to backdrop: the kind's own depth,
  // unless the section says otherwise — `depth: 60`, or `depth: { left: 60 }`.
  depthFor(i, side, kind) {
    const o = this.kindAt[i].depth;
    const own = typeof o === 'number' ? o : o?.[side > 0 ? 'left' : 'right'];
    return own ?? kind.depth ?? 40;
  }

  // Where the wood may start on this side at this sample: whichever is further
  // out, the section's authored `near` or the far edge of the run-off. Nothing
  // grows on a surface a car is meant to be able to use.
  treeLine(i, side, kind) {
    const p = this.path;
    const edge = p.w[i] + (side > 0 ? p.runL[i] : p.runR[i]);
    return Math.max(kind.near, edge + TREE_CLEAR);
  }

  make(renderer) {
    this.mat = { fringe: this.look.cardMaterial('grass', { sway: 0.8, glow: 0.35, alphaTest: 0.4 }) };
    this.kit = makeKit(renderer, this.look);
    return !!this.kit;
  }

  // -------------------------------------------------------------------------
  // THE TREELINES. One sample every LINE_STEP metres down each side wherever
  // the section is wooded; a line ends wherever the wood stops, a tunnel
  // starts, or the ground is not ours to plant.
  // -------------------------------------------------------------------------
  woods() {
    const p = this.path, g = this.ground;
    const forest = new Forest(this.kit, {
      // the builder's (x, y) is three's (x, -z): see V() in meshes.js
      ground: (x, z) => g.height(x, -z),
      // EXACT clearance to the nearest road, not the chamfer grid. This is
      // what keeps a wood out from under a viaduct deck or inside the loop —
      // and, where the road folds back on itself, off the OTHER road.
      clear: (x, z) => g.roadSlack(x, -z) >= TREE_CLEAR,
      shadows: this.q.shadows,
    });
    const di = Math.max(1, Math.round(LINE_STEP / p.ds));
    for (const side of [1, -1]) {
      let line = [];
      const end = () => { if (line.length >= 2) forest.line(line); line = []; };
      for (let i = 0; i < p.n; i += di) {
        const kind = this.kindFor(i, side);
        if (!kind.trees || (p.tunIn && p.tunIn[i] > 0)) { end(); continue; }
        const base = this.treeLine(i, side, kind);
        if (!unfolded(p, i, side * base)) { end(); continue; }
        const a = pointAt(p, i, side * base);
        if (g.roadSlack(a.x, a.y) < TREE_CLEAR) { end(); continue; }
        // As deep as authored, cut short by the first fold or the first other
        // road on the way out — a hairpin's far leg is often inside 70 m.
        const want = this.depthFor(i, side, kind);
        let reach = 0;
        for (let f = 4; f <= want + DARK_DEPTH; f += 4) {
          if (!unfolded(p, i, side * (base + f))) break;
          const q = pointAt(p, i, side * (base + f));
          if (g.roadSlack(q.x, q.y) < 1) break;
          reach = f;
        }
        const d = Math.min(want, reach);
        const h = p.hdg[i];
        line.push({
          x: a.x, z: -a.y,
          nx: -Math.sin(h) * side, nz: -Math.cos(h) * side,
          d, far: Math.max(0, reach - d),
          conifer: kind.conifer,
          density: this.q.trees * kind.trees / KINDS.pine.trees,
        });
      }
      end();
    }
    forest.build();
    forest.sunLight = this.look.sun || null;
    forest.relight();
    this.forest = forest;
    this.group.add(forest.group);
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

  // -- per frame --------------------------------------------------------------
  update(camera) { this.forest?.update(camera); }

  // The paper layer carries its light in a uniform; forest.update() copies it
  // from the sun every frame, and this does it once, now.
  relight() { this.forest?.relight(); return this; }

  stats() { return { ...this.counts, ...(this.forest ? this.forest.stats() : {}) }; }
}

// ---------------------------------------------------------------------------
export async function buildFlora(renderer, path, ground, look, quality) {
  const f = new Flora(path, ground, look, quality);
  f.sections();
  if (!f.make(renderer)) return f;            // no data/flora: no plants, no crash
  f.woods();
  f.fringe();
  return f;
}
