// Spa DLC — the grandstands.
//
// WHAT IS REAL, AND WHERE IT CAME FROM
//   * Footprints: OpenStreetMap building=grandstand, as projected by
//     tools/bakeenv.mjs into data/env/spa.json — eight of them, all in the
//     "stadium" between the Bus Stop and the top of Raidillon. prepareEnv
//     lifts them out of the env and build() puts a stand on each.
//   * Which way each faces, its roof and where it sits against the road: read
//     off the Walloon government's aerial photograph (IMAGERIE/ORTHO_2023_ETE,
//     20-37 cm a pixel) with these footprints drawn over it, 2026-10-06:
//       START     left of the start straight, opposite the F1 pits: a long
//                 stand under a RED roof
//       DESCENT   two on the left of the run down from La Source: a low one
//                 under white-and-grey striped canopies, then a large one
//                 under a dark roof carrying solar panels
//       EAU ROUGE the big white-roofed stand set back on the hill, its seats
//                 open to the south-east, looking down on Eau Rouge
//       RAIDILLON the long covered stand on the left of the climb
//       LA SOURCE three small stands on the outside of the hairpin
// WHAT IS ESTIMATED (no published figure found, and nothing seen from the
// side): every height, the rake, the number of rows, the roof's pitch and its
// columns, the seat colour. The stands are drawn as one covered tier each —
// a plain steel cantilever, which is what Spa's are, not a showpiece.
// NOT DRAWN: the grass banks at Kemmel, Pouhon and Les Combes, where most of
// a Spa crowd actually stands. They have no surveyed footprint.
import * as THREE from 'three';
import { Z, Builder } from '../../geom.js';
import { peopleMesh } from '../../crowd.js';

// The shared flag row stands beside the start line, where the red-roofed
// stand's own row of Belgian tricolours flies from its parapet instead.
export const replaces = ['flagpoles'];

const ROW_D = 0.85, ROW_R = 0.45, SEAT = 0.62;
const CONC = [0.80, 0.80, 0.78], DARK = [0.5, 0.5, 0.5], STEEL = [0.62, 0.65, 0.68], SEAT_COL = [0.36, 0.4, 0.46];
const WHITE = [0.93, 0.93, 0.91], RED = [0.66, 0.2, 0.17], SOLAR = [0.17, 0.2, 0.27];

// Each stand by the centre of its footprint (circuit metres), within 30 m.
const STANDS = [
  { id: 'start', c: [-245, 974], roof: RED, people: 1500, flags: true },
  { id: 'descent-1', c: [-116, 1205], roof: WHITE, people: 500 },
  { id: 'descent-2', c: [-36, 1132], roof: SOLAR, people: 1300 },
  { id: 'eau-rouge', c: [156, 1113], roof: WHITE, people: 2200, rows: 30 },
  { id: 'raidillon', c: [296, 721], roof: WHITE, people: 1400 },
  { id: 'la-source-1', c: [-409, 1354], roof: STEEL, people: 250 },
  { id: 'la-source-2', c: [-352, 1348], roof: STEEL, people: 150 },
  { id: 'la-source-3', c: [-372, 1352], roof: STEEL, people: 80 },
];
let rings = [];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = v => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const mad = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];
const centroid = p => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];

export function prepareEnv(env) {
  rings = [];
  if (!env || !env.buildings) return;
  env.buildings = env.buildings.filter(b => {
    if (b.k !== 'grandstand') return true;
    const c = centroid(b.p);
    const spec = STANDS.find(s => Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) < 30);
    if (!spec) return true;              // one the survey added since: the shared stand draws it
    rings.push({ spec, ring: b.p });
    return false;
  });
}

// The footprint's own box: its long axis, and the long side that faces the road.
// Exported for tools/spasetcheck.mjs, which holds every stand to "faces the
// track, clear of the barrier" without a screen.
export function layout(ring, t) {
  const c = centroid(ring);
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of ring) { const d = sub(p, c); sxx += d[0] * d[0]; sxy += d[0] * d[1]; syy += d[1] * d[1]; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = [Math.cos(th), Math.sin(th)];
  let n = [-u[1], u[0]];
  let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const p of ring) { const d = sub(p, c), a = dot(d, u), b = dot(d, n); u0 = Math.min(u0, a); u1 = Math.max(u1, a); n0 = Math.min(n0, b); n1 = Math.max(n1, b); }
  // The road: the nearest sample of the centreline to the footprint's centre.
  let best = Infinity, road = null;
  for (let i = 0; i < t.n; i += 2) { const d = (t.x[i] - c[0]) ** 2 + (t.y[i] - c[1]) ** 2; if (d < best) { best = d; road = [t.x[i], t.y[i]]; } }
  // `n` is turned to point AWAY from the road, so depth 0 is the front row.
  if (dot(sub(road, c), n) > 0) { n = [-n[0], -n[1]]; [n0, n1] = [-n1, -n0]; }
  const a = mad(mad(c, u, u0), n, n0), L = u1 - u0;
  let D = n1 - n0;
  // The front row stands behind the barrier: step back by whatever the
  // surveyed front edge is short of it (never more than a third of the stand).
  let shift = 0;
  for (let k = 0; k <= 16; k++) {
    const p = mad(a, u, L * k / 16), q = t.project(p[0], p[1]);
    shift = Math.max(shift, q.w + q.run + 2.5 - Math.abs(q.lat));
  }
  shift = Math.max(0, Math.min(shift, D / 3));
  return { a: mad(a, n, shift), u, n, L, D: D - shift, road, shift };
}

function seatRow(list, a, b, h, face, frac) {
  const L = len2(sub(b, a)), n = Math.floor(L / SEAT), u = [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)];
  for (let k = 0; k < n; k++) list.push({ p: mad(a, u, (k + 0.5) * SEAT), h, face, w: 1.3 - 0.6 * frac });
}
function thin(list, budget) {
  const tot = list.reduce((s, c) => s + c.w, 0), k = Math.min(1, budget / Math.max(1, tot)), out = [];
  for (const c of list) {
    if (Math.random() > c.w * k) continue;
    out.push({ x: c.p[0] + (Math.random() - 0.5) * 0.14, z: Z(c.p[1] + (Math.random() - 0.5) * 0.14), y: c.h + 0.02,
      ry: Math.atan2(c.face[0], -c.face[1]) + (Math.random() - 0.5) * 0.5, seated: Math.random() > 0.25 });
  }
  return out;
}

// One covered tier on a footprint. The land under it is fitted with a straight
// line along its length: a stand is one rigid thing on graded ground, so it
// may ramp (and on the run down from La Source it does) but never ripple.
function stand(B, spec, ring, t, groundY) {
  const { a, u, n, L, D } = layout(ring, t);
  if (L < 8 || D < 6) return [];
  const S = [];
  for (let k = 0; k <= 8; k++) { const uu = L * k / 8; S.push([uu, groundY(mad(mad(a, u, uu), n, D / 2))]); }
  const mu = L / 2, mg = S.reduce((s, q) => s + q[1], 0) / S.length;
  const slope = S.reduce((s, q) => s + (q[0] - mu) * (q[1] - mg), 0) / S.reduce((s, q) => s + (q[0] - mu) ** 2, 0);
  const g = uu => mg + slope * (uu - mu);
  const P = (uu, dd, h) => { const p = mad(mad(a, u, uu), n, dd); return [p[0], g(uu) + h, Z(p[1])]; };
  const hq = (bld, d0, d1, h, col) => bld.quadN(P(0, d0, h), P(L, d0, h), P(L, d1, h), P(0, d1, h), [[0, d0], [L, d0], [L, d1], [0, d1]], col);
  const vq = (bld, dd, h0, h1, col) => bld.quadN(P(0, dd, h0), P(L, dd, h0), P(L, dd, h1), P(0, dd, h1), [[0, h0], [L, h0], [L, h1], [0, h1]], col);
  const face = [-n[0], -n[1]], seats = [], profile = [[0, 1, 1.2]];
  // The plinth and its front wall, then the rows.
  vq(B.deck, 0, -0.6, 1.2, DARK); hq(B.deck, 0, 1, 1.2, CONC);
  const R = Math.max(4, Math.min(spec.rows || 22, Math.floor((D - 3.2) / ROW_D)));
  let hTop = 1.6;
  for (let r = 0; r < R; r++) {
    const dd = 1 + r * ROW_D, h = 1.6 + r * ROW_R;
    hq(B.deck, dd, dd + ROW_D, h, CONC);
    vq(B.deck, dd, r ? h - ROW_R : 1.2, h, DARK);
    vq(B.paint, dd + ROW_D * 0.62, h, h + 0.38, SEAT_COL);
    profile.push([dd, dd + ROW_D, h]);
    seatRow(seats, mad(mad(a, n, dd + 0.4), u, 0.5), mad(mad(a, u, L), n, dd + 0.4), g(L / 2) + h, face, r / R);
    hTop = h;
  }
  // A footprint much deeper than its seats (the Eau Rouge stand's is 90 m: the
  // survey draws the stand and the hall behind it as one outline) is seats at
  // the front and a flat-roofed hall filling the rest.
  const dE = 1 + R * ROW_D, hall = D > dE + 6, dB = hall ? dE + 2.4 : Math.max(dE + 1.2, D);
  hq(B.deck, dE, dB, hTop, CONC);                       // the walkway behind the top row
  vq(B.wall, dB, -0.6, hTop + 2.6, CONC);               // the back wall
  profile.push([dE, dB, hTop + 2.6]);
  if (hall) {
    const hH = Math.min(hTop + 2.6, 9);
    hq(B.wall, dB, D, hH, CONC);
    vq(B.wall, D, -0.6, hH, CONC);
    profile.push([dB, D, hH]);
  }
  for (const uu of [0, L]) for (const [d0, d1, top] of profile)
    B.wall.quadN(P(uu, d0, -0.6), P(uu, d1, -0.6), P(uu, d1, top), P(uu, d0, top), [[d0, 0], [d1, 0], [d1, top], [d0, top]], CONC);
  // The roof: a sheet from above the back wall out over the seats, falling
  // toward the front, on a column and a raking beam every bay.
  const hB = hTop + 5.2, hF = hTop + 3.9 - Math.min(2, R * 0.05), dF = Math.max(-1.5, dE - Math.min(dE + 1.5, 19));
  const roofQ = (bld, col) => bld.quadN(P(0, dB + 0.8, hB), P(L, dB + 0.8, hB), P(L, dF, hF), P(0, dF, hF), [[0, 0], [L, 0], [L, dB - dF], [0, dB - dF]], col);
  roofQ(B.roof, spec.roof);
  const hd = Math.atan2(u[1], u[0]), bays = Math.max(1, Math.round(L / 8));
  for (let k = 0; k <= bays; k++) {
    const uu = Math.min(L - 0.3, Math.max(0.3, L * k / bays));
    const col = P(uu, dB - 0.3, (hB - 0.8) / 2);
    B.steel.box(col[0], col[1], col[2], 0.35, hB - 0.2 + 0.6, 0.35, hd, STEEL);
    // the beam under the sheet, as a run of short boxes following its fall
    const N = 6;
    for (let j = 0; j < N; j++) {
      const f = (j + 0.5) / N, dd = dB + 0.8 + (dF - dB - 0.8) * f, h = hB + (hF - hB) * f - 0.28;
      const p = P(uu, dd, h);
      B.steel.box(p[0], p[1], p[2], 0.3, 0.4, Math.abs(dF - dB - 0.8) / N + 0.05, hd, STEEL);
    }
  }
  if (spec.flags) for (let uu = 6; uu <= L - 6; uu += 12) B.flags.push({ base: P(uu, 0.4, 1.2), top: P(uu, 0.4, 9.5), u: [u[0], 0, -u[1]], n: [-n[0], 0, n[1]] });
  return thin(seats, spec.people);
}

// Black, yellow, red, in three upright bands.
function belgianFlag() {
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 64;
  const g = cv.getContext('2d');
  ['#111111', '#fdda24', '#ef3340'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 32, 0, 32, 64); });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function flagRow(B, list) {
  const cloth = new Builder();
  const FW = 2.7, FH = 1.6, SEG = 6;
  list.forEach((f, k) => {
    const b = f.base, tp = f.top;
    B.steel.box((b[0] + tp[0]) / 2, (b[1] + tp[1]) / 2, (b[2] + tp[2]) / 2, 0.12, tp[1] - b[1], 0.12, 0, STEEL);
    const ph = k * 1.7;
    for (let i = 0; i < SEG; i++) {
      const at = (j, v) => { const x = j / SEG * FW, wave = Math.sin(j / SEG * 5 + ph) * 0.18 * (j / SEG);
        return [tp[0] + f.u[0] * x + f.n[0] * wave, tp[1] - v * FH, tp[2] + f.u[2] * x + f.n[2] * wave]; };
      cloth.quadN(at(i, 0), at(i + 1, 0), at(i + 1, 1), at(i, 1), [[i / SEG, 1], [(i + 1) / SEG, 1], [(i + 1) / SEG, 0], [i / SEG, 0]]);
    }
  });
  return cloth;
}

export function build(view, ctx) {
  const { S, t, look, world } = ctx;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nostands')) return null;
  const groundY = p => (world ? world.groundY(p[0], Z(p[1])) : 0);
  const B = { deck: new Builder({ color: true }), wall: new Builder({ color: true }), paint: new Builder({ color: true }),
    steel: new Builder({ color: true }), roof: new Builder({ color: true }), flags: [] };
  const people = [];
  for (const { spec, ring } of rings) people.push(...stand(B, spec, ring, t, groundY));
  const cloth = flagRow(B, B.flags);
  const G = new THREE.Group();
  G.name = 'spa.grandstands';
  const add = (bld, mat, opts) => { const m = bld.mesh(mat, opts); if (m) G.add(m); return m; };
  const DS = THREE.DoubleSide;
  add(B.deck, look.mat('concrete', { size: 3, tint: 0xc4c2bd, roughness: 0.95, metalness: 0, side: DS, vertexColors: true }));
  add(B.wall, look.mat('concrete', { size: 3.4, tint: 0xd8d6d0, roughness: 0.95, metalness: 0, side: DS, vertexColors: true }));
  add(B.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: DS }), { shadow: false });
  add(B.steel, look.mat('metal', { size: 2, tint: 0xc4c8cc, roughness: 0.5, metalness: 0.6, side: DS, vertexColors: true }));
  add(B.roof, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: DS }));
  if (B.flags.length) add(cloth, new THREE.MeshStandardMaterial({ map: belgianFlag(), roughness: 0.85, metalness: 0, side: DS }), { shadow: false });
  const pm = peopleMesh(people, { fans: 'spa' });
  if (pm) G.add(pm);
  S.add(G);
  let meshes = 0;
  G.traverse(o => { if (o.isMesh) meshes++; });
  return { stands: rings.length, people: people.length, meshes };
}
