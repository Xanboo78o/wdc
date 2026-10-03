// Sepang DLC — the paddock: the Pit Building, the South Paddock, the Medical
// Centre and the two Welcome Centres, each on its surveyed OSM footprint.
//
// What is known, and from where (sepangcircuit.com/architecture, read
// 2026-10-03, unless marked otherwise):
//   PIT BUILDING (OSM way 144362327, building:levels=3). "33 pits, race
//     control centre, time-keeping room, paddock clubs, and race management
//     offices". "Each of the fully air-conditioned pit boxes are 8 meters wide,
//     and 24 meters long". Paddock clubs on the first floor, the Perdana Suite
//     on the second, and "the upper third floor also fitted with a refurbished
//     rooftop that stretches along the whole pit building". "The angle and
//     cantilevered edges of the raised roof over the covered terraces aid in
//     providing adequate shading over the pit lane" (the circuit's own
//     description, quoted by several visitor guides). The survey puts its
//     front face 6.1-6.4 m from the pit lane's centreline and its back 33 m
//     from it, 346 m long, with a round end to the west.
//   SOUTH PADDOCK (OSM way 1105232836, building:levels=2). "double storey,
//     dual frontage ... modular structure utilising up to 80% recycled
//     structural steel", "three modules of six pit garages", a Hospitality
//     Club with covered terraces on either side.
//   MEDICAL CENTRE (144359492) and the WELCOME CENTRES (107364040,
//     1106756634): OSM footprints only. The Welcome Centre is "the gateway to
//     the grandstand" with offices, a restaurant, a shop and a museum.
// Storey heights, the roof's pitch and overhang, and the colours are
// ESTIMATED FROM PHOTOGRAPHS, not published figures: white concrete and
// dark glass, a white metal roof.
//
// The Pit Building is laid out in the pit lane's own frame, exactly as pit.js
// lays out its garages, so it wraps them: pit.js still builds its eleven open
// boxes with the crews and the tyres in them (races use those), and this
// builds the 346 m of building around and above them — closed 8 m boxes to
// either side, the clubs, the suite, the rooftop and the raised roof.
import { resampleLane as resample, BOX_PITCH, MAX_BOXES } from '../../pitstop.js';
import * as THREE from 'three';
import { Builder } from '../../geom.js';

// pit.js's own numbers, so the facade lands on its garages to the centimetre.
const LANE_BOX = 6.6, GARAGE_DEPTH = 13.0, GARAGE_H = 6.4;

// The buildings rebuilt here, by the centroid of their OSM footprint in the
// circuit's metres (bakeenv's projection). prepareEnv lifts them out of the
// env so the city does not draw a plain box over them, and keeps the rings.
const OWN = {
  pit:     { c: [-25, 15],   osm: 144362327 },
  medical: { c: [220, 37],   osm: 144359492 },
  south:   { c: [2, -174],   osm: 1105232836 },
  welcome1: { c: [-577, -129], osm: 107364040 },
  welcome2: { c: [-572, -172], osm: 1106756634 },
};
let rings = {};

export const replaces = [];

const centroid = p => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];

export function prepareEnv(env) {
  rings = {};
  if (!env || !env.buildings) return;
  env.buildings = env.buildings.filter(b => {
    if (b.k === 'grandstand') return true;
    const c = centroid(b.p);
    for (const [name, o] of Object.entries(OWN)) {
      if (!rings[name] && Math.hypot(c[0] - o.c[0], c[1] - o.c[1]) < 12) { rings[name] = b.p; return false; }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// pit.js's own lane resample and garage numbers (js/pitstop.js), so the open
// garages here are exactly where the race stops each car.

// One atlas of words, four rows: the building names. Drawn, because text is
// the one thing that cannot be a photograph (same rule as furniture.js).
const SIGNS = [
  { text: 'SEPANG INTERNATIONAL CIRCUIT', bg: '#24282e', fg: '#f4f4f0', stripe: '#d0202a' },
  { text: 'MEDICAL CENTRE', bg: '#1d6f45', fg: '#ffffff' },
  { text: 'SOUTH PADDOCK', bg: '#24282e', fg: '#f4f4f0', stripe: '#f2c230' },
  { text: 'WELCOME CENTRE', bg: '#24282e', fg: '#f4f4f0', stripe: '#d0202a' },
];
function signTexture() {
  const W = 2048, RH = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = RH * SIGNS.length;
  const g = cv.getContext('2d');
  SIGNS.forEach((s, r) => {
    const y = r * RH;
    g.fillStyle = s.bg; g.fillRect(0, y, W, RH);
    if (s.stripe) { g.fillStyle = s.stripe; g.fillRect(0, y + RH - 14, W, 8); }
    g.fillStyle = s.fg;
    g.font = 'bold 84px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // letter-spaced by hand: canvas letterSpacing is not everywhere yet
    const chars = [...s.text], sp = 10;
    const w = chars.reduce((a, c) => a + g.measureText(c).width + sp, -sp);
    let x = (W - w) / 2;
    g.textAlign = 'left';
    for (const c of chars) { g.fillText(c, x, y + RH / 2 - 4); x += g.measureText(c).width + sp; }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, rows: SIGNS.length, aspect: W / RH };
}

// ---------------------------------------------------------------------------
export function build(view, ctx) {
  const { S, t, look, world } = ctx;
  const T = (p, y) => [p[0], y, -p[1]];                 // sim (x, y) + height -> three
  const hAt = p => (world ? world.heightAt(p[0], -p[1]) : 0);
  const gAt = p => (world ? world.groundY(p[0], -p[1]) : 0);

  const B = {
    white: new Builder({ color: true }),   // concrete: slabs, piers, walls
    glass: new Builder(),                  // dark curtain walls
    clear: new Builder(),                  // balustrades
    roof: new Builder({ color: true }),    // white metal roofs
    doors: new Builder({ color: true }),   // roller shutters
    steel: new Builder({ color: true }),   // the South Paddock's cladding
    sign: new Builder(),
  };
  const sign = signTexture();

  // A vertical quad from sim points a->b, y0..y1 at each end. Normal derived.
  const wall = (b, a, c, ya0, ya1, yc0 = ya0, yc1 = ya1, col) => {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    b.quadN(T(a, ya0), T(c, yc0), T(c, yc1), T(a, ya1), [[0, ya0], [L, yc0], [L, yc1], [0, ya1]], col);
  };
  // A sign panel on the segment a->b at heights y0..y1, readable from the side
  // `n` (three-space, horizontal) points to. Left/right is decided from the
  // viewer's side so the words are never mirrored.
  const signPanel = (a, c, y0, y1, row, n) => {
    let A = T(a, 0), C = T(c, 0);
    const rx = n[2], rz = -n[0];                       // the viewer's right
    if ((C[0] - A[0]) * rx + (C[2] - A[2]) * rz < 0) [A, C] = [C, A];
    const v0 = 1 - (row + 1) / sign.rows, v1 = 1 - row / sign.rows;
    B.sign.quad([A[0], y0, A[2]], [C[0], y0, C[2]], [C[0], y1, C[2]], [A[0], y1, A[2]], n,
      [[0, v0], [1, v0], [1, v1], [0, v1]]);
  };

  const stats = {};

  // =========================================================================
  // THE PIT BUILDING
  // =========================================================================
  const pit = t.pit, ring = rings.pit;
  if (pit && pit.pts && pit.pts.length > 2 && ring) {
    const P = resample(pit.pts, 2);
    const away = pit.side || 1;
    const H = P.map((_, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      return Math.atan2(b[1] - a[1], b[0] - a[0]);
    });
    // lane metre m, lateral metres toward the garages -> sim point
    const at = (m, lat) => {
      const f = Math.max(0, Math.min(P.length - 1.001, m / 2)), i = Math.floor(f), k = f - i;
      const x = P[i][0] + (P[i + 1][0] - P[i][0]) * k, y = P[i][1] + (P[i + 1][1] - P[i][1]) * k;
      const h = H[i] + (H[i + 1] - H[i]) * k, q = lat * away;
      return [x - Math.sin(h) * q, y + Math.cos(h) * q];
    };
    // Which way the front faces, in three-space (toward the lane).
    const front = m => { const a = at(m, 0), b = at(m, 1); return [a[0] - b[0], 0, -(a[1] - b[1])]; };
    // The footprint in lane coordinates.
    const proj = (x, y) => {
      let best = Infinity, bm = 0, bl = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        const f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
        const px = a[0] + dx * f, py = a[1] + dy * f, d = (x - px) ** 2 + (y - py) ** 2;
        if (d < best) { best = d; bm = (i + f) * 2; bl = ((x - px) * -Math.sin(H[i]) + (y - py) * Math.cos(H[i])) * away; }
      }
      return [bm, bl];
    };
    const lr = ring.map(p => proj(p[0], p[1]));
    // The round west end is drawn as its own drum, so the block stops short of it.
    // Its centre and radius are FITTED to the surveyed arc (least squares,
    // Kåsa): the points within 10 m of the footprint's westmost point.
    const W0 = ring.reduce((a, p) => (p[0] < a[0] ? p : a));
    const arc = ring.filter(p => Math.hypot(p[0] - W0[0], p[1] - W0[1]) < 10);
    const fit = (() => {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
      for (const [x, y] of arc) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
      const n = arc.length, M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], v = [sxz, syz, sz];
      const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(M), col = k => M.map((r, i) => r.map((e, j) => (j === k ? v[i] : e)));
      const A = det(col(0)) / D, Bq = det(col(1)) / D, C = det(col(2)) / D;
      const cx = A / 2, cy = Bq / 2;
      return { c: [cx, cy], r: Math.sqrt(C + cx * cx + cy * cy) };
    })();
    const drumC = fit.c, drumR = Math.max(5, Math.min(10, fit.r));
    const drumM = proj(drumC[0], drumC[1])[0];
    let mA = Math.min(...lr.map(q => q[0])), mB = Math.max(...lr.map(q => q[0]));
    if (Math.abs(drumM - mA) < Math.abs(drumM - mB)) mA = drumM; else mB = drumM;
    const BACK = Math.min(36, Math.max(26, ...lr.filter(q => q[1] > 10).map(q => q[1])));
    const F0 = LANE_BOX - 0.15;                         // the slab fascias' face

    // pit.js's garage block, by its own formula.
    const usable = (P.length - 1) * 2;
    const boxes = Math.max(3, Math.min(MAX_BOXES, Math.floor((usable - 120) / BOX_PITCH)));
    const gA = Math.max(30, (usable - boxes * BOX_PITCH) / 2), gB = gA + boxes * BOX_PITCH;

    // floor levels (estimated from photographs): garages, paddock club,
    // Perdana Suite, rooftop; then the raised roof over it all.
    const L1 = 7.6, L2 = 12.0, L3 = 16.0;
    const base = m => hAt(at(m, LANE_BOX));
    const STEP = 8;                                    // one real pit box
    const n = Math.max(1, Math.round((mB - mA) / STEP)), dm = (mB - mA) / n;
    const W = [1, 1, 1], SOFFIT = [0.62, 0.63, 0.66], MULL = [0.86, 0.87, 0.88];

    for (let k = 0; k < n; k++) {
      const m0 = mA + k * dm, m1 = m0 + dm, y0 = base(m0), y1 = base(m1);
      const inGarages = m1 > gA + 0.01 && m0 < gB - 0.01;

      // --- ground floor: closed 8 m boxes, except where pit.js's are open ---
      if (!inGarages) {
        const pier = 0.9;
        const pa = at(m0, LANE_BOX), pb = at(m0 + pier, LANE_BOX);
        wall(B.white, pa, pb, y0 - 0.3, y0 + GARAGE_H, y0 - 0.3, y0 + GARAGE_H, W);
        const da = at(m0 + pier, LANE_BOX + 0.18), db = at(m1, LANE_BOX + 0.18);
        wall(B.doors, da, db, y0, y0 + 4.9, y1, y1 + 4.9, [0.82, 0.84, 0.87]);
        // the shutter's horizontal slats, picked out as darker lines
        for (let s = 0.6; s < 4.9; s += 0.6) {
          const sa = at(m0 + pier, LANE_BOX + 0.16), sb = at(m1, LANE_BOX + 0.16);
          wall(B.doors, sa, sb, y0 + s, y0 + s + 0.05, y1 + s, y1 + s + 0.05, [0.55, 0.57, 0.6]);
        }
        const la = at(m0 + pier, LANE_BOX), lb = at(m1, LANE_BOX);
        wall(B.white, la, lb, y0 + 4.9, y0 + GARAGE_H, y1 + 4.9, y1 + GARAGE_H, W);
      }

      // --- level 1 slab, the paddock club's terrace and its glass ---------
      const fa = at(m0, F0), fb = at(m1, F0);
      wall(B.white, fa, fb, y0 + GARAGE_H - 0.25, y0 + L1, y1 + GARAGE_H - 0.25, y1 + L1, W);
      B.white.quadUp([[fa[0], -fa[1]], [fb[0], -fb[1]], [at(m1, 10.2)[0], -at(m1, 10.2)[1]], [at(m0, 10.2)[0], -at(m0, 10.2)[1]]], (y0 + y1) / 2 + L1, [0.9, 0.9, 0.88]);
      wall(B.clear, at(m0, F0 + 0.1), at(m1, F0 + 0.1), y0 + L1, y0 + L1 + 1.1, y1 + L1, y1 + L1 + 1.1);
      wall(B.glass, at(m0, 10.2), at(m1, 10.2), y0 + L1, y0 + L2 - 0.8, y1 + L1, y1 + L2 - 0.8);
      for (let s = 0; s < 3; s++) {
        const mm = m0 + (s / 3) * dm;
        const a = at(mm, 10.1), b = at(mm + 0.18, 10.1);
        wall(B.white, a, b, y0 + L1, y0 + L2 - 0.8, y0 + L1, y0 + L2 - 0.8, MULL);
      }
      // the Perdana Suite level overhangs the terrace: its soffit, then its
      // slab edge, then glass with white fins every 4 m
      {
        const a0 = at(m0, F0), a1 = at(m1, F0), b0 = at(m0, 10.2), b1 = at(m1, 10.2), ys = (y0 + y1) / 2 + L2 - 0.8;
        B.white.quad(T(a0, ys), T(a1, ys), T(b1, ys), T(b0, ys), [0, -1, 0],
          [[0, 0], [dm, 0], [dm, 3.6], [0, 3.6]], SOFFIT);
      }
      wall(B.white, fa, fb, y0 + L2 - 0.8, y0 + L2, y1 + L2 - 0.8, y1 + L2, W);
      wall(B.glass, at(m0, F0 + 0.45), at(m1, F0 + 0.45), y0 + L2, y0 + L3 - 0.8, y1 + L2, y1 + L3 - 0.8);
      for (let s = 0; s < 2; s++) {
        const mm = m0 + (s / 2) * dm;
        const p = at(mm, F0 + 0.1), q = at(mm, F0 + 0.75), ym = y0 + (y1 - y0) * (s / 2);
        wall(B.white, p, q, ym + L2, ym + L3 - 0.8, ym + L2, ym + L3 - 0.8, MULL);
      }
      // rooftop slab edge, its glass rail
      wall(B.white, fa, fb, y0 + L3 - 0.8, y0 + L3, y1 + L3 - 0.8, y1 + L3, W);
      wall(B.clear, at(m0, F0 + 0.1), at(m1, F0 + 0.1), y0 + L3, y0 + L3 + 1.1, y1 + L3, y1 + L3 + 1.1);
      // the deck, and the rooftop lounge's glass set back under the roof
      {
        const ra = at(m0, F0), rb = at(m1, F0), rc = at(m1, BACK), rd = at(m0, BACK);
        B.white.quadUp([[ra[0], -ra[1]], [rb[0], -rb[1]], [rc[0], -rc[1]], [rd[0], -rd[1]]], (y0 + y1) / 2 + L3, [0.78, 0.78, 0.77]);
      }
      wall(B.glass, at(m0, 15), at(m1, 15), y0 + L3, y0 + L3 + 3.4, y1 + L3, y1 + L3 + 3.4);

      // --- the back: concrete with two bands of window --------------------
      const ka = at(m0, BACK), kb = at(m1, BACK);
      wall(B.white, ka, kb, Math.min(y0, gAt(ka)) - 0.6, y0 + L3, Math.min(y1, gAt(kb)) - 0.6, y1 + L3, [0.93, 0.93, 0.91]);
      for (const [lo, hi] of [[L1 + 0.9, L2 - 1.2], [L2 + 0.6, L3 - 1.4]]) {
        wall(B.glass, at(m0 + 0.6, BACK + 0.06), at(m1 - 0.6, BACK + 0.06), y0 + lo, y0 + hi, y1 + lo, y1 + hi);
      }
    }

    // where pit.js's open block meets the closed boxes: a party wall each end,
    // so looking along the lane into an open door never shows a void
    for (const m of [gA, gB]) {
      const y = base(m);
      wall(B.white, at(m, LANE_BOX), at(m, LANE_BOX + GARAGE_DEPTH), y - 0.3, y + GARAGE_H, y - 0.3, y + GARAGE_H, W);
    }
    // the east end wall
    for (const m of [mA, mB]) {
      if (Math.abs(m - drumM) < 1) continue;
      const y = base(m);
      wall(B.white, at(m, LANE_BOX), at(m, BACK), y - 0.6, y + L3, y - 0.6, y + L3, W);
      wall(B.glass, at(m, 12), at(m, BACK - 4), y + L1 + 0.8, y + L3 - 1.2, y + L1 + 0.8, y + L3 - 1.2);
    }

    // --- the raised roof: on two rows of columns, tilted UP toward the lane,
    // cantilevered 9 m out over the working lane to shade it -------------
    const RF = -2.6, RB = BACK + 1.2;                  // its front and back edges, lane lat
    const yF = 22.0, yB = 20.0;                         // ...and their heights over the lane
    const ry = lat => yB + (yF - yB) * (RB - lat) / (RB - RF);
    const nr = Math.max(1, Math.round((mB - mA) / 16)), dr = (mB - mA) / nr;
    for (let k = 0; k < nr; k++) {
      const m0 = mA + k * dr, m1 = m0 + dr, y0 = base(m0), y1 = base(m1);
      const a = at(m0, RF), b = at(m1, RF), c = at(m1, RB), d = at(m0, RB);
      B.roof.quadN(T(a, y0 + yF), T(b, y1 + yF), T(c, y1 + yB), T(d, y0 + yB),
        [[0, 0], [dr, 0], [dr, RB - RF], [0, RB - RF]], [1, 1, 1]);
      B.roof.quadN(T(d, y0 + yB - 0.45), T(c, y1 + yB - 0.45), T(b, y1 + yF - 0.45), T(a, y0 + yF - 0.45),
        [[0, 0], [dr, 0], [dr, RB - RF], [0, RB - RF]], [1, 1, 1]);
      // the fascia to the lane: deep, white, and the circuit's name on the
      // middle bays
      wall(B.roof, a, b, y0 + yF - 1.9, y0 + yF, y1 + yF - 1.9, y1 + yF, [0.96, 0.96, 0.96]);
      wall(B.roof, d, c, y0 + yB - 0.45, y0 + yB, y1 + yB - 0.45, y1 + yB, [0.9, 0.9, 0.9]);
      // columns: one row through the terrace, one at the back
      for (const lat of [9.2, BACK - 0.5]) {
        const p = at(m0 + (k === 0 ? 1 : 0), lat), top = y0 + ry(lat) - 0.45;
        B.white.box(p[0], (y0 + L3 + top) / 2, -p[1], 0.7, top - (y0 + L3), 0.7, 0, [0.95, 0.95, 0.95]);
      }
    }
    // end fascias of the roof
    for (const m of [mA, mB]) {
      const y = base(m), a = at(m, RF), b = at(m, RB);
      B.roof.quadN(T(a, y + yF - 1.9), T(b, y + yB - 0.45), T(b, y + yB), T(a, y + yF),
        [[0, 0], [RB - RF, 0], [RB - RF, 1], [0, 1]], [0.93, 0.93, 0.93]);
    }
    // The name: one 72 m panel centred on the roof's lane fascia, set just
    // proud of it.
    {
      const mc = (mA + mB) / 2, half = 36, y = base(mc);
      const a = at(mc - half, RF - 0.06), b = at(mc + half, RF - 0.06);
      signPanel(a, b, y + yF - 1.75, y + yF - 0.15, 0, front(mc));
    }

    // --- the round west end: a glass drum, taller than the block --------
    {
      const r = drumR, segs = 28, c = drumC, y = hAt(c);
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
        const p = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], q = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
        wall(B.white, p, q, y - 0.6, y + L1, y - 0.6, y + L1, W);
        wall(B.glass, p, q, y + L1, y + 22.5, y + L1, y + 22.5);
        for (const h of [L2 - 0.4, L3 - 0.4, 20.0]) wall(B.white, p, q, h + y, h + y + 0.5, h + y, h + y + 0.5, W);
        // the cap overhangs the drum
        const P2 = [c[0] + Math.cos(a0) * (r + 1.4), c[1] + Math.sin(a0) * (r + 1.4)], Q2 = [c[0] + Math.cos(a1) * (r + 1.4), c[1] + Math.sin(a1) * (r + 1.4)];
        B.roof.quadUp([[c[0], -c[1]], [P2[0], -P2[1]], [Q2[0], -Q2[1]]], y + 23.4, [1, 1, 1]);
        wall(B.roof, P2, Q2, y + 22.5, y + 23.4, y + 22.5, y + 23.4, [0.95, 0.95, 0.95]);
      }
    }
    stats.pit = { length: Math.round(mB - mA), bays: n, openBoxes: boxes, back: +BACK.toFixed(1) };
  }

  // =========================================================================
  // The others are laid out in their own oriented box.
  // =========================================================================
  const obb = ring => {
    const [cx, cy] = centroid(ring);
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of ring) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of ring) {
      const u = (x - cx) * ux + (y - cy) * uy, v = -(x - cx) * uy + (y - cy) * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const ox = cx + ux * (u0 + u1) / 2 - uy * (v0 + v1) / 2, oy = cy + uy * (u0 + u1) / 2 + ux * (v0 + v1) / 2;
    const F = (a, b) => [ox + ux * a - uy * b, oy + uy * a + ux * b];
    const base = Math.min(...ring.map(gAt));
    // the long side nearer the track gets the signs
    const near = s => { const p = F(0, s * (v1 - v0) / 2); let d = Infinity; for (let i = 0; i < t.x.length; i += 4) d = Math.min(d, (t.x[i] - p[0]) ** 2 + (t.y[i] - p[1]) ** 2); return d; };
    return { F, len: u1 - u0, dep: v1 - v0, base, face: near(1) < near(-1) ? 1 : -1 };
  };
  // outward horizontal normal (three-space) of the long side s (+1 / -1)
  const sideN = (o, s) => { const a = o.F(0, 0), b = o.F(0, s); const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, 0, -(b[1] - a[1]) / l]; };
  // a closed box in the obb frame, walls to the ground and a flat top
  const block = (b, o, a0, a1, b0, b1, y0, y1, col, top = true) => {
    const c = [o.F(a0, b0), o.F(a1, b0), o.F(a1, b1), o.F(a0, b1)];
    for (let i = 0; i < 4; i++) wall(b, c[i], c[(i + 1) % 4], y0, y1, y0, y1, col);
    if (top) b.quadUp(c.map(p => [p[0], -p[1]]), y1, col);
  };

  // --- SOUTH PADDOCK: steel, two storeys, garages on both frontages --------
  if (rings.south) {
    const o = obb(rings.south), y = o.base, hl = o.len / 2, hd = o.dep / 2;
    const G1 = 5.0, G2 = 9.6, STEEL = [0.56, 0.6, 0.64];
    block(B.steel, o, -hl, hl, -hd, hd, y - 0.5, y + G1, STEEL, false);
    block(B.steel, o, -hl + 0.4, hl - 0.4, -hd + 2.6, hd - 2.6, y + G1, y + G2, STEEL);
    // three modules of six: three doors a side per module
    const per = 9, pitch = o.len / per;
    for (const s of [1, -1]) {
      for (let k = 0; k < per; k++) {
        const a = -hl + k * pitch + 0.7, c = -hl + (k + 1) * pitch - 0.7;
        wall(B.doors, o.F(a, s * (hd + 0.08)), o.F(c, s * (hd + 0.08)), y, y + 4.2, y, y + 4.2, (k % 3 === 1) ? [0.92, 0.93, 0.95] : [0.8, 0.82, 0.85]);
      }
      // the hospitality club's glass, its covered terrace and the roof
      wall(B.glass, o.F(-hl + 1, s * (hd - 2.5)), o.F(hl - 1, s * (hd - 2.5)), y + G1 + 0.4, y + G2 - 0.7, y + G1 + 0.4, y + G2 - 0.7);
      wall(B.clear, o.F(-hl, s * (hd + 0.1)), o.F(hl, s * (hd + 0.1)), y + G1, y + G1 + 1.1, y + G1, y + G1 + 1.1);
    }
    // the deck over the garages (the terraces) and a roof that overhangs them
    B.steel.quadUp([o.F(-hl, -hd), o.F(hl, -hd), o.F(hl, hd), o.F(-hl, hd)].map(p => [p[0], -p[1]]), y + G1, [0.72, 0.72, 0.7]);
    const roofR = [o.F(-hl - 1.5, -hd - 3.2), o.F(hl + 1.5, -hd - 3.2), o.F(hl + 1.5, hd + 3.2), o.F(-hl - 1.5, hd + 3.2)];
    B.roof.quadUp(roofR.map(p => [p[0], -p[1]]), y + G2 + 0.6, [1, 1, 1]);
    for (let i = 0; i < 4; i++) wall(B.roof, roofR[i], roofR[(i + 1) % 4], y + G2, y + G2 + 0.6, y + G2, y + G2 + 0.6, [0.94, 0.94, 0.94]);
    for (let k = 0; k <= 12; k++) for (const s of [1, -1]) {
      const p = o.F(-hl + (k / 12) * o.len, s * (hd + 2.8));
      B.steel.box(p[0], y + G1 + (G2 - G1) / 2, -p[1], 0.3, G2 - G1, 0.3, 0, [0.4, 0.43, 0.47]);
    }
    const s = o.face, sn = sideN(o, s);
    signPanel(o.F(-14, s * (hd + 3.26)), o.F(14, s * (hd + 3.26)), y + G2 - 0.05, y + G2 + 1.25, 2, sn);
    stats.south = { len: Math.round(o.len), dep: Math.round(o.dep) };
  }

  // --- MEDICAL CENTRE: two storeys of white render, a green sign -----------
  if (rings.medical) {
    const o = obb(rings.medical), y = o.base, hl = o.len / 2, hd = o.dep / 2, H8 = 8.4;
    block(B.white, o, -hl, hl, -hd, hd, y - 0.5, y + H8, W3());
    for (const s of [1, -1]) for (const [lo, hi] of [[1.0, 3.0], [4.8, 7.0]]) {
      wall(B.glass, o.F(-hl + 1.5, s * (hd + 0.05)), o.F(hl - 1.5, s * (hd + 0.05)), y + lo, y + hi, y + lo, y + hi);
    }
    block(B.white, o, -hl - 0.2, hl + 0.2, -hd - 0.2, hd + 0.2, y + H8, y + H8 + 0.8, [0.96, 0.96, 0.95]);
    const s = o.face;
    signPanel(o.F(-7, s * (hd + 0.28)), o.F(7, s * (hd + 0.28)), y + H8 - 0.05, y + H8 + 0.75, 1, sideN(o, s));
    stats.medical = true;
  }

  // --- WELCOME CENTRES: glass pavilions under a floating white roof --------
  for (const key of ['welcome1', 'welcome2']) {
    if (!rings[key]) continue;
    const o = obb(rings[key]), y = o.base, hl = o.len / 2, hd = o.dep / 2, HW = 7.4;
    block(B.glass, o, -hl, hl, -hd, hd, y - 0.4, y + HW, null, false);
    B.white.quadUp([o.F(-hl, -hd), o.F(hl, -hd), o.F(hl, hd), o.F(-hl, hd)].map(p => [p[0], -p[1]]), y + HW, [0.85, 0.85, 0.85]);
    // white columns in front of the glass, every 6 m
    for (const s of [1, -1]) for (let a = -hl; a <= hl + 0.01; a += o.len / Math.round(o.len / 6)) {
      const p = o.F(a, s * (hd + 1.6));
      B.white.box(p[0], y + HW / 2, -p[1], 0.5, HW, 0.5, 0, [0.97, 0.97, 0.96]);
    }
    const roofR = [o.F(-hl - 3, -hd - 3), o.F(hl + 3, -hd - 3), o.F(hl + 3, hd + 3), o.F(-hl - 3, hd + 3)];
    B.roof.quadUp(roofR.map(p => [p[0], -p[1]]), y + HW + 0.9, [1, 1, 1]);
    B.roof.quad(...roofR.map(p => T(p, y + HW)), [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.7, 0.71, 0.73]);
    for (let i = 0; i < 4; i++) wall(B.roof, roofR[i], roofR[(i + 1) % 4], y + HW, y + HW + 0.9, y + HW, y + HW + 0.9, [0.95, 0.95, 0.95]);
    for (const s of [1, -1]) signPanel(o.F(-9, s * (hd + 3.06)), o.F(9, s * (hd + 3.06)), y + HW + 0.02, y + HW + 0.88, 3, sideN(o, s));
    stats[key] = true;
  }

  // =========================================================================
  // One mesh per material.
  // =========================================================================
  const D = THREE.DoubleSide;
  const mats = {
    white: look.mat('concrete', { size: 3, tint: 0xf1f0eb, roughness: 0.85, metalness: 0, side: D, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d2830, roughness: 0.06, metalness: 0.7, envMapIntensity: 1.7, side: D }),
    clear: new THREE.MeshStandardMaterial({ color: 0xa9bec8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false, side: D }),
    // matt and barely metallic: from below, a shinier white mirrored the
    // blue sky and the underside read navy
    roof: look.mat('metal', { size: 2, tint: 0xf4f5f6, roughness: 0.85, metalness: 0.05, side: D, vertexColors: true }),
    doors: look.mat('metal', { size: 1.5, tint: 0xd5d9de, roughness: 0.5, metalness: 0.55, side: D, vertexColors: true }),
    steel: look.mat('metal', { size: 2, tint: 0xffffff, roughness: 0.55, metalness: 0.6, side: D, vertexColors: true }),
    sign: new THREE.MeshStandardMaterial({ map: sign.tex, roughness: 0.6, metalness: 0, side: D }),
  };
  const G = new THREE.Group();
  G.name = 'dlc.sepang.paddock';
  let meshes = 0;
  for (const [k, b] of Object.entries(B)) {
    const m = b.mesh(mats[k], { shadow: k !== 'clear' && k !== 'sign', receive: k !== 'clear' });
    if (!m) continue;
    m.name = 'sepang.paddock.' + k;
    G.add(m); meshes++;
  }
  S.add(G);
  stats.meshes = meshes;
  return stats;

  function W3() { return [0.98, 0.98, 0.97]; }
}
