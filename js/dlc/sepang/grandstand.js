// Sepang DLC — the grandstands.
//
// WHAT IS REAL, AND WHERE IT CAME FROM
//   * Footprints: OpenStreetMap, as projected by tools/bakeenv.mjs into
//     data/env/sepang.json — Main Grandstand way 144247993, K1 way 107364100,
//     F way 107364038. The coordinates below are copied from that bake (sim
//     metres, east/north of the circuit's own origin).
//   * The Main Grandstand seats about 32,000, is the only stand that sees both
//     straights, is split north/south by the Mall, is TIERED with the upper
//     tier above the catch fencing and the lower tier looking through it, and
//     holds 18 air-conditioned corporate suites (tracksideseats.com Sepang
//     grandstand guide; sepangtravel.com; malaysianreview.com seating guide).
//   * Its roof is the circuit's emblem: a row of white leaves, described as
//     "banana leaf" shades (Wikipedia: "its iconic umbrella shade").
//   * K1 wraps round Turns 1-2 and is covered; F is covered. Both carry
//     building:levels=2 in OSM; height 7.4 m is the env bake's figure.
// WHAT IS ESTIMATED FROM PHOTOGRAPHS (no published figure found)
//   * every height: tier rakes, the suite level, the leaf roots at ~21 m;
//   * the leaf count and pitch (one leaf per ~24.5 m bay, two per stair core);
//   * the seat colour, the K1 and F roof shape (drawn as the same leaf family);
//   * the round pavilion at the east end of the Main Grandstand footprint
//     (OSM draws a 32 m circle there; its two glazed floors are a guess).
// The C/K2 hillstands are open grass banks with no surveyed footprint and are
// not drawn here.
//
// Structure of the main stand, read off the survey: TWO straight slabs, each
// ~24 m deep and ~570 m long, 10.4° apart, back to back across the Mall, the
// south one facing the back straight and the north one the main straight. On
// the Mall side each has seven 20 x 8 m stair cores at a 49 m pitch.
import * as THREE from 'three';
import { Z, Builder } from '../../geom.js';
import { peopleMesh } from '../../crowd.js';

// The shared flag row (furniture.js) stands 2.6 m behind the barrier beside
// the start line, which at Sepang is inside the Main Grandstand. Its own row
// of Jalur Gemilang flies from the stand's front parapet instead.
export const replaces = ['flagpoles'];

const ROW_D = 0.85, ROW_R = 0.45, SEAT = 0.62;

const MAIN = {
  south: {
    front: [[-153, -151.2], [413, -47]], back: [[-157.5, -127.1], [408.3, -22.6]],
    cores: [
      [[-137, -123.3], [-138.6, -114.9], [-119, -111.4], [-117.4, -119.7]],
      [[-87.6, -114.2], [-89.2, -105.9], [-70, -102.4], [-68.5, -110.7]],
      [[-39.5, -105.4], [-41, -97.2], [-21.5, -93.6], [-19.9, -101.7]],
      [[9.4, -96.3], [7.9, -88.2], [27, -84.8], [28.5, -92.8]],
      [[57.2, -87.5], [55.7, -79.5], [76.4, -75.8], [77.9, -83.7]],
      [[106.2, -78.5], [104.7, -70.6], [125, -66.9], [126.4, -74.7]],
      [[156.1, -69.3], [154.6, -61.5], [174.3, -57.9], [175.8, -65.8]],
    ],
  },
  north: {
    flags: [5, 155],                      // along the start line, metres from the west end
    front: [[-169, -34.3], [405, 8.7]], back: [[-162.6, -58.4], [407, -15.8]],
    cores: [
      [[171, -33.5], [171.6, -41.3], [151.6, -42.9], [151, -35]],
      [[120.9, -37.2], [121.5, -45.2], [101, -46.8], [100.4, -38.8]],
      [[71.7, -40.9], [72.3, -49], [51.3, -50.6], [50.7, -42.5]],
      [[21.6, -44.7], [22.2, -52.8], [2.8, -54.3], [2.2, -46.1]],
      [[-27.6, -48.3], [-26.9, -56.6], [-46.8, -58.1], [-47.4, -49.8]],
      [[-76.8, -52], [-76.2, -60.4], [-95.6, -61.9], [-96.2, -53.5]],
      [[-126.4, -55.7], [-125.8, -64.2], [-145.7, -65.7], [-146.1, -59.8]],
    ],
  },
  rotunda: { c: [453, -14], r: 32 },
};
const K1 = {
  front: [[-492.8, 102.4], [-501.6, 72.9], [-513.6, 53.9], [-520.4, 46.4], [-530.7, 35.1], [-546.3, 19.6],
    [-556.6, -1.5], [-560.5, -22.9], [-559.5, -45.3], [-557.8, -69.4]],
  back: [[-524.2, 107.3], [-528.8, 87.6], [-538.6, 72.8], [-550.9, 60.1], [-572.6, 37.4], [-586.4, 8.8],
    [-591.7, -22.9], [-589.8, -47.4], [-588.1, -71.5]],
  h: 7.4, people: 1400,
};
const F = { front: [[606.9, 120.5], [697.9, -8]], back: [[633.9, 139.4], [724.9, 10.8]], h: 7.4, people: 600 };
// Where the surveyed stands sit, to take them out of the env (prepareEnv).
const CENTRES = [[177, -48], [-547, 22], [678, 42]];

const SEAT_COL = [0.16, 0.26, 0.5], CONC = [0.86, 0.85, 0.82], DARK = [0.62, 0.62, 0.6];
const STEEL = [0.84, 0.86, 0.88];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = v => Math.hypot(v[0], v[1]);
const norm = v => { const l = len2(v) || 1; return [v[0] / l, v[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const mad = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];

function distToTrack(t, p) {
  let best = Infinity;
  for (let i = 0; i < t.n; i += 8) best = Math.min(best, (t.x[i] - p[0]) ** 2 + (t.y[i] - p[1]) ** 2);
  return Math.sqrt(best);
}

// A square steel member between two three-space points.
function rod(b, p, q, r, col = STEEL) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const L = Math.hypot(...d) || 1;
  const dn = d.map(v => v / L);
  let e1 = [dn[2], 0, -dn[0]];
  if (Math.hypot(...e1) < 1e-3) e1 = [1, 0, 0];
  const l1 = Math.hypot(...e1); e1 = e1.map(v => v / l1);
  const e2 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const off = (o, a, k1, k2) => [o[0] + (e1[0] * k1 + e2[0] * k2) * r, o[1] + (e1[1] * k1 + e2[1] * k2) * r, o[2] + (e1[2] * k1 + e2[2] * k2) * r];
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let k = 0; k < 4; k++) {
    const [a1, a2] = C[k], [b1, b2] = C[(k + 1) % 4];
    b.quadN(off(p, 0, a1, a2), off(p, 0, b1, b2), off(q, 0, b1, b2), off(q, 0, a1, a2),
      [[0, 0], [2 * r, 0], [2 * r, L], [0, L]], col);
  }
}

// ONE LEAF. Rooted at a mast behind the stand, it runs out over the seats
// along `dir` (sim, unit): narrow at the stalk, widest two fifths of the way
// out, a pointed tip; arched along its length, its edges curling down, a
// raised midrib, veins running out from it. `tilt` tips it about the midrib,
// alternating leaf to leaf, which is what scallops the roofline.
function leaf(mem, steel, o) {
  const { root, dir, g, hR, LL, W, rise = 3, tilt = 0, curl = 1.5, mast = true, mastTop = 6.5 } = o;
  const side = [-dir[1], dir[0]];
  const NT = 16, NS = 8;
  const hwOf = t => (W / 2) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.62))), 1.25);
  const at = (t, s, dy = 0) => {
    const hw = hwOf(t), k = hw / (W / 2);
    const p = mad(mad(root, dir, t * LL), side, s * hw);
    const h = g + hR + rise * Math.sin(Math.PI * t * 0.85) - 0.8 * t
      + tilt * s * k - curl * s * s * k + 0.32 * Math.pow(1 - Math.abs(s), 6) * k + dy;
    return [p[0], h, Z(p[1])];
  };
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j < NS; j++) {
      // The last row stops a hair short of the point: a quad whose far edge
      // is a single point has a zero normal from quadN, and lights pure black.
      const ta = i / NT, tb = Math.min((i + 1) / NT, 0.985), sa = -1 + 2 * j / NS, sb = -1 + 2 * (j + 1) / NS;
      const sm = Math.abs((sa + sb) / 2);
      // Midrib darker; veins as bands sweeping out from it toward the tip.
      const v = sm < 0.26 ? 0.84 : (Math.floor((ta + tb) * 11 + sm * 3) % 2 ? 0.97 : 0.91);
      mem.quadN(at(ta, sa), at(tb, sa), at(tb, sb), at(ta, sb),
        [[ta * LL, sa * W / 2], [tb * LL, sa * W / 2], [tb * LL, sb * W / 2], [ta * LL, sb * W / 2]], [v, v, v]);
    }
  }
  // The midrib beam under the membrane, and the mast with its two ties.
  const rib = [0.0, 0.2, 0.42, 0.64, 0.86].map(t => at(t, 0, -0.35));
  for (let k = 0; k + 1 < rib.length; k++) rod(steel, rib[k], rib[k + 1], 0.32 - k * 0.05);
  if (mast) {
    const foot = [root[0], g - 0.5, Z(root[1])], top = [root[0], g + hR + mastTop, Z(root[1])];
    rod(steel, foot, top, 0.42);
    rod(steel, top, rib[2], 0.07);
    rod(steel, top, rib[4], 0.07);
  }
}

// Seats for the crowd, collected per stand and thinned to a budget, front
// rows fuller than the back.
function seatRow(list, a, b, h, face, frac) {
  const L = len2(sub(b, a)), n = Math.floor(L / SEAT);
  const u = norm(sub(b, a));
  for (let k = 0; k < n; k++) {
    const p = mad(a, u, (k + 0.5) * SEAT);
    list.push({ p, h, face, w: 1.3 - 0.6 * frac });
  }
}
function thin(list, budget) {
  const tot = list.reduce((s, c) => s + c.w, 0);
  const k = Math.min(1, budget / Math.max(1, tot));
  const out = [];
  for (const c of list) {
    if (Math.random() > c.w * k) continue;
    out.push({
      x: c.p[0] + (Math.random() - 0.5) * 0.14, z: Z(c.p[1] + (Math.random() - 0.5) * 0.14), y: c.h + 0.02,
      ry: Math.atan2(c.face[0], -c.face[1]) + (Math.random() - 0.5) * 0.5, seated: Math.random() > 0.25,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// One half of the Main Grandstand: a straight slab, two tiers with the suite
// level between, a solid back wall and stair cores to the Mall, under its own
// row of leaves.
// ---------------------------------------------------------------------------
function slab(B, band, t, groundY) {
  let [a, b] = band.front, [c] = band.back;
  const u = norm(sub(b, a)), L = len2(sub(b, a));
  let n = [-u[1], u[0]];
  if (dot(sub(c, a), n) < 0) n = [-n[0], -n[1]];
  // The front row starts behind the barrier and its catch fence. The surveyed
  // front comes to 8.5 m of the centreline on the main straight, which is the
  // edge of the asphalt; the barrier (tools/bakereal.mjs standsClear) is
  // further out than that, so the slab steps back to clear it.
  let shift = 0;
  for (let k = 0; k <= 24; k++) {
    const p = mad(a, u, L * k / 24), q = t.project(p[0], p[1]);
    // Only the straight the slab faces: past its ends the nearest track is
    // the T15 hairpin, which would shove the whole slab back through itself.
    if (Math.abs(Math.cos(q.hdg) * u[0] + Math.sin(q.hdg) * u[1]) < 0.97) continue;
    shift = Math.max(shift, q.w + q.run + 2.5 - Math.abs(q.lat));
  }
  shift = Math.min(shift, 6);
  if (shift > 0) { a = mad(a, n, shift); b = mad(b, n, shift); }
  const D = (dot(sub(band.back[0], a), n) + dot(sub(band.back[1], a), n)) / 2;
  if (distToTrack(t, mad(mad(a, u, L / 2), n, D)) < distToTrack(t, mad(a, u, L / 2)))
    console.warn('sepang grandstand: a band faces away from the track');
  // The land under a 570 m building, fitted with a straight line: it is one
  // rigid structure on graded ground, so it may ramp but never kink.
  const S = [];
  for (let k = 0; k <= 8; k++) { const uu = L * k / 8; const p = mad(mad(a, u, uu), n, D / 2); S.push([uu, groundY(p)]); }
  const mu = S.reduce((s, q) => s + q[0], 0) / S.length, mg = S.reduce((s, q) => s + q[1], 0) / S.length;
  const slope = S.reduce((s, q) => s + (q[0] - mu) * (q[1] - mg), 0) / S.reduce((s, q) => s + (q[0] - mu) ** 2, 0);
  const g = uu => mg + slope * (uu - mu);
  const P = (uu, dd, h) => { const p = mad(mad(a, u, uu), n, dd); return [p[0], g(uu) + h, Z(p[1])]; };
  const hq = (bld, dd0, dd1, h, col) =>         // horizontal, full length
    bld.quadN(P(0, dd0, h), P(L, dd0, h), P(L, dd1, h), P(0, dd1, h), [[0, dd0], [L, dd0], [L, dd1], [0, dd1]], col);
  const vq = (bld, dd, h0, h1, col) =>          // vertical, full length
    bld.quadN(P(0, dd, h0), P(L, dd, h0), P(L, dd, h1), P(0, dd, h1), [[0, h0], [L, h0], [L, h1], [0, h1]], col);
  const face = [-n[0], -n[1]];
  const seats = [], profile = [];               // profile: [dd0, dd1, top] for the end walls

  // Lower tier: looks through the catch fence.
  const R1 = 12;
  for (let r = 0; r < R1; r++) {
    const dd = 1 + r * ROW_D, h = 1.6 + r * ROW_R;
    hq(B.deck, dd, dd + ROW_D, h, CONC);
    vq(B.deck, dd, r ? h - ROW_R : 0, h, DARK);
    vq(B.paint, dd + ROW_D * 0.62, h, h + 0.38, SEAT_COL);
    profile.push([dd, dd + ROW_D, h]);
    seatRow(seats, mad(mad(a, n, dd + 0.4), u, 0.5), mad(mad(b, n, dd + 0.4), u, -0.5), g(L / 2) + h, face, r / R1);
  }
  profile.unshift([0, 1, 1.0]);
  vq(B.deck, 0, 0, 1.0, DARK);
  hq(B.deck, 0, 1, 1.0, CONC);
  // The suite level: glazed boxes under the overhang of the upper tier.
  const hS = 1.6 + (R1 - 1) * ROW_R, dS = 1 + R1 * ROW_D + 0.3, hG = 3.4;
  hq(B.deck, 1 + R1 * ROW_D, dS + 1.0, hS, CONC);
  vq(B.glass, dS + 1.0, hS, hS + hG);
  hq(B.box, dS, dS + 1.0, hS + hG, CONC);                         // soffit
  const hU0 = hS + hG + 0.6;
  vq(B.box, dS, hS + hG, hU0 + 1.05, CONC);                       // balustrade
  profile.push([1 + R1 * ROW_D, dS + 1.0, hU0]);
  const hd = Math.atan2(u[1], u[0]);
  for (let uu = 1.5; uu < L; uu += 3) {                           // mullions
    const p = P(uu, dS + 1.05, hS + hG / 2);
    B.steel.box(p[0], p[1], p[2], 0.12, hG, 0.18, hd, STEEL);
  }
  // 18 suites in all (the venue guide); split nine to a side here, and only
  // the partitions show through the glass.
  for (let k = 1; k < 10; k++) {
    const p = P(L * k / 10, dS + 2.2, hS + hG / 2);
    B.box.box(p[0], p[1], p[2], 0.3, hG, 2.2, hd, CONC);
  }
  // Upper tier: above the fence.
  let hTop = hU0, r2 = 0;
  for (let dd = dS; dd + ROW_D <= D - 1.2; dd += ROW_D, r2++) {
    const h = hU0 + r2 * ROW_R;
    hq(B.deck, dd, dd + ROW_D, h, CONC);
    vq(B.deck, dd, r2 ? h - ROW_R : hU0 - 0.1, h, DARK);
    vq(B.paint, dd + ROW_D * 0.62, h, h + 0.38, SEAT_COL);
    profile.push([dd, dd + ROW_D, h]);
    seatRow(seats, mad(mad(a, n, dd + 0.4), u, 0.5), mad(mad(b, n, dd + 0.4), u, -0.5), g(L / 2) + h, face, 0.4 + 0.6 * r2 / 14);
    hTop = h;
  }
  const dEnd = dS + r2 * ROW_D;
  hq(B.deck, dEnd, D, hTop, CONC);                                // the back walkway
  vq(B.box, D, 0, hTop + 1.4, CONC);                              // back wall to the Mall
  profile.push([dEnd, D, hTop + 1.4]);
  // End walls: the stepped profile, standing on the ground.
  for (const uu of [0, L]) {
    for (const [d0, d1, top] of profile) {
      B.box.quadN(P(uu, d0, 0), P(uu, d1, 0), P(uu, d1, top), P(uu, d0, top), [[d0, 0], [d1, 0], [d1, top], [d0, top]], CONC);
    }
  }
  // Fins down the Mall face.
  for (let uu = 3; uu < L - 1; uu += 6) {
    const p = P(uu, D + 0.45, (hTop + 1.4) / 2);
    B.box.box(p[0], p[1], p[2], 0.45, hTop + 1.4, 0.9, hd, DARK);
  }
  // Stair cores.
  for (const ring of band.cores) {
    const gc = Math.min(...ring.map(p => groundY(p)));
    B.box.prism(ring.map(p => [p[0], Z(p[1])]), gc - 0.5, gc + hTop + 3.5, CONC, true);
  }
  if (band.flags) {
    for (let uu = band.flags[0]; uu <= band.flags[1]; uu += 10) {
      const base = P(uu, 0.4, 1.0), top = P(uu, 0.4, 11);
      B.flags.push({ base, top, u: [u[0], 0, -u[1]], n: [-n[0], 0, n[1]] });
    }
  }
  // The leaves: one per ~24.5 m bay, rooted on masts over the Mall.
  const N = Math.max(3, Math.round(L / 24.5)), pitch = L / N;
  const hR = hTop + 5;
  for (let k = 0; k < N; k++) {
    const uu = (k + 0.5) * pitch;
    leaf(B.mem, B.steel, {
      root: mad(mad(a, u, uu), n, D + 2.5), dir: face, g: g(uu), hR, LL: D + 8.5, W: pitch * 0.8,
      rise: 2.8, tilt: k % 2 ? 1.1 : -1.1, curl: 1.6,
    });
  }
  return seats;
}

// ---------------------------------------------------------------------------
// K1 and F: one covered tier with a concourse hall behind, following a curved
// footprint. Front and back edges are resampled to matching stations.
// ---------------------------------------------------------------------------
function resample(line, N) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + len2(sub(line[i], line[i - 1])));
  const T = cum[cum.length - 1], out = [];
  for (let k = 0; k <= N; k++) {
    const s = T * k / N;
    let i = 1;
    while (i < line.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    out.push([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f]);
  }
  return out;
}
const lineLen = l => l.slice(1).reduce((s, p, i) => s + len2(sub(p, l[i])), 0);

function curved(B, spec, t, groundY) {
  let front = spec.front, back = spec.back;
  const mid = l => l[Math.floor(l.length / 2)];
  if (distToTrack(t, mid(back)) < distToTrack(t, mid(front))) [front, back] = [back, front];
  const N = Math.max(2, Math.ceil(lineLen(front) / 4));
  const Fp = resample(front, N), Bp = resample(back, N);
  const dir = Fp.map((p, i) => norm(sub(Bp[i], p)));
  const dep = Fp.map((p, i) => len2(sub(Bp[i], p)));
  let gs = Fp.map((p, i) => groundY(mad(p, dir[i], dep[i] / 2)));
  // Smoothed: a stand may follow the land, it must not ripple with it.
  for (let pass = 0; pass < 3; pass++) gs = gs.map((v, i) => (gs[Math.max(0, i - 2)] + gs[Math.max(0, i - 1)] + v + gs[Math.min(N, i + 1)] + gs[Math.min(N, i + 2)]) / 5);
  const P = (i, dd, h) => { const p = mad(Fp[i], dir[i], dd); return [p[0], gs[i] + h, Z(p[1])]; };
  const R = Math.max(4, Math.min(Math.floor((spec.h - 1.4) / ROW_R) + 1, Math.floor((Math.min(...dep) - 7) / ROW_D)));
  const seats = [];
  const hTop = 1.4 + (R - 1) * ROW_R, dE = 1 + R * ROW_D, hH = hTop + 3.6;
  for (let i = 0; i < N; i++) {
    const j = i + 1, Ls = len2(sub(Fp[j], Fp[i])), u0 = i * Ls, u1 = j * Ls;
    const H = (bld, d0, d1, h, col) => bld.quadN(P(i, d0, h), P(j, d0, h), P(j, d1, h), P(i, d1, h), [[u0, d0], [u1, d0], [u1, d1], [u0, d1]], col);
    const V = (bld, d, h0, h1, col) => bld.quadN(P(i, d, h0), P(j, d, h0), P(j, d, h1), P(i, d, h1), [[u0, h0], [u1, h0], [u1, h1], [u0, h1]], col);
    V(B.deck, 0, 0, 1.0, DARK); H(B.deck, 0, 1, 1.0, CONC);
    for (let r = 0; r < R; r++) {
      const dd = 1 + r * ROW_D, h = 1.4 + r * ROW_R;
      H(B.deck, dd, dd + ROW_D, h, CONC);
      V(B.deck, dd, r ? h - ROW_R : 0, h, DARK);
      V(B.paint, dd + ROW_D * 0.62, h, h + 0.38, SEAT_COL);
      const face = [-(dir[i][0] + dir[j][0]) / 2, -(dir[i][1] + dir[j][1]) / 2];
      const pa = mad(Fp[i], dir[i], dd + 0.4), pb = mad(Fp[j], dir[j], dd + 0.4);
      seatRow(seats, pa, pb, (gs[i] + gs[j]) / 2 + h, face, r / R);
    }
    // The concourse hall behind the seats.
    const dB = Math.min(dep[i], dep[j]);
    V(B.glass, dE, hTop, hH);
    H(B.box, dE, dB, hH, CONC);
    V(B.box, dB, 0, hH, CONC);
  }
  for (const i of [0, N]) {
    const prof = [[0, 1, 1.0]];
    for (let r = 0; r < R; r++) prof.push([1 + r * ROW_D, 1 + (r + 1) * ROW_D, 1.4 + r * ROW_R]);
    prof.push([dE, dep[i], hH]);
    for (const [d0, d1, top] of prof) B.box.quadN(P(i, d0, 0), P(i, d1, 0), P(i, d1, top), P(i, d0, top), [[d0, 0], [d1, 0], [d1, top], [d0, top]], CONC);
  }
  // Leaves along the arc, ~14 m apart, rooted behind the hall.
  const stride = Math.max(1, Math.round(14 / (lineLen(front) / N)));
  let k = 0;
  for (let i = Math.floor(stride / 2); i <= N; i += stride, k++) {
    const dB = dep[i];
    leaf(B.mem, B.steel, {
      root: mad(Fp[i], dir[i], dB + 1.5), dir: [-dir[i][0], -dir[i][1]], g: gs[i], hR: hH + 2.5,
      LL: dB + 6, W: 14.5, rise: 1.8, tilt: k % 2 ? 0.7 : -0.7, curl: 1.1, mastTop: 4,
    });
  }
  return seats;
}

// The round east end of the Main Grandstand's footprint: two glazed floors
// under an umbrella of leaves from a central mast. Estimated.
// Jalur Gemilang: fourteen red and white stripes, the blue canton with the
// yellow crescent and fourteen-point star.
function malaysiaFlag() {
  const cv = document.createElement('canvas'); cv.width = 168; cv.height = 84;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, c = h / 14;
  for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#cc0001'; g.fillRect(0, i * c, w, c + 1); }
  g.fillStyle = '#010066'; g.fillRect(0, 0, w * 0.5, c * 8);
  const cy = c * 4;
  g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(w * 0.17, cy, h * 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#010066'; g.beginPath(); g.arc(w * 0.195, cy, h * 0.17, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffcc00'; g.beginPath();
  for (let k = 0; k < 28; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 14, d = k % 2 ? 0.08 * h : 0.19 * h;
    g.lineTo(w * 0.33 + Math.cos(a) * d, cy + Math.sin(a) * d);
  }
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// Poles on the parapet, cloths streaming along the straight with a ripple.
function flagRow(B, list) {
  const cloth = new Builder();
  const FW = 2.7, FH = 1.35, SEG = 6;
  list.forEach((f, k) => {
    rod(B.steel, f.base, f.top, 0.07);
    const ph = k * 1.7;
    for (let i = 0; i < SEG; i++) {
      const at = (j, v) => {
        const x = j / SEG * FW, wave = Math.sin(j / SEG * 5 + ph) * 0.18 * (j / SEG);
        return [f.top[0] + f.u[0] * x + f.n[0] * wave, f.top[1] - v * FH, f.top[2] + f.u[2] * x + f.n[2] * wave];
      };
      cloth.quadN(at(i, 0), at(i + 1, 0), at(i + 1, 1), at(i, 1), [[i / SEG, 1], [(i + 1) / SEG, 1], [(i + 1) / SEG, 0], [i / SEG, 0]]);
    }
  });
  return cloth;
}

function rotunda(B, R, groundY) {
  const { c, r } = R, g = groundY(c);
  const ring = (rad, n = 40) => [...Array(n)].map((_, k) => [c[0] + Math.cos(k / n * Math.PI * 2) * rad, Z(c[1] + Math.sin(k / n * Math.PI * 2) * rad)]);
  B.box.prism(ring(r), g - 0.5, g + 1.2, CONC, true);
  B.glass.prism(ring(r - 3), g + 1.2, g + 5.2, 0xffffff, false);
  B.box.prism(ring(r - 1), g + 5.2, g + 5.8, CONC, true);
  B.glass.prism(ring(r - 3), g + 5.8, g + 9.8, 0xffffff, false);
  B.box.prism(ring(r), g + 9.8, g + 10.6, CONC, true);
  rod(B.steel, [c[0], g, Z(c[1])], [c[0], g + 25, Z(c[1])], 0.7);
  const n = 10;
  for (let k = 0; k < n; k++) {
    const an = (k + 0.5) / n * Math.PI * 2, d = [Math.cos(an), Math.sin(an)];
    leaf(B.mem, B.steel, { root: mad(c, d, 1.5), dir: d, g, hR: 18, LL: r + 6, W: 17, rise: 2.2, tilt: k % 2 ? 0.8 : -0.8, curl: 1.4, mast: false });
  }
}

export function prepareEnv(env) {
  if (!env || !env.buildings) return;
  env.buildings = env.buildings.filter(b => {
    if (b.k !== 'grandstand') return true;
    const cx = b.p.reduce((s, p) => s + p[0], 0) / b.p.length, cy = b.p.reduce((s, p) => s + p[1], 0) / b.p.length;
    return !CENTRES.some(([x, y]) => Math.hypot(cx - x, cy - y) < 40);
  });
}

export function build(view, ctx) {
  const { S, t, look, world } = ctx;
  // ?nostands: leave the Sepang stands out, to look past them or time without them.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nostands')) return null;
  const groundY = p => (world ? world.groundY(p[0], Z(p[1])) : 0);
  const B = {
    deck: new Builder({ color: true }), box: new Builder({ color: true }), paint: new Builder({ color: true }),
    glass: new Builder(), steel: new Builder({ color: true }), mem: new Builder({ color: true }), flags: [],
  };
  const main = thin([...slab(B, MAIN.south, t, groundY), ...slab(B, MAIN.north, t, groundY)], 7000);
  rotunda(B, MAIN.rotunda, groundY);
  const k1 = thin(curved(B, K1, t, groundY), K1.people);
  const f = thin(curved(B, F, t, groundY), F.people);

  const cloth = flagRow(B, B.flags);
  const G = new THREE.Group();
  G.name = 'sepang.grandstands';
  const add = (bld, mat, opts) => { const m = bld.mesh(mat, opts); if (m) G.add(m); return m; };
  const DS = THREE.DoubleSide;
  add(B.deck, look.mat('concrete', { size: 3, tint: 0xc9c6c0, roughness: 0.95, metalness: 0, side: DS, vertexColors: true }));
  add(B.box, look.mat('concrete', { size: 3.4, tint: 0xe2dfd8, roughness: 0.95, metalness: 0, side: DS, vertexColors: true }));
  add(B.paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: DS }), { shadow: false });
  add(B.glass, new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6, side: DS }), { shadow: false });
  add(B.steel, look.mat('metal', { size: 2, tint: 0xd0d4d8, roughness: 0.45, metalness: 0.7, side: DS, vertexColors: true }));
  // The membrane: white PTFE, a little translucent — the sun through it
  // lifts its underside, which is what the faint emissive stands in for.
  const mem = add(B.mem, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0, side: DS, emissive: 0x262624 }));
  if (mem) mem.name = 'sepang.leaves';
  add(cloth, new THREE.MeshStandardMaterial({ map: malaysiaFlag(), roughness: 0.85, metalness: 0, side: DS }), { shadow: false });
  const pm = peopleMesh([...main, ...k1, ...f], { fans: 'sepang' });
  if (pm) G.add(pm);
  S.add(G);
  let meshes = 0;
  G.traverse(o => { if (o.isMesh) meshes++; });
  return { stands: 4, people: main.length + k1.length + f.length, meshes };
}
