// path.js — the track as a list of pieces, turned into road.
//
// This is how you would lay a road in Blender, not how you would generate one:
// every piece is a decision somebody made ("a long right that climbs"), and the
// file that lists them (data/build/pieces.js) is the whole design. Nothing here
// invents a corner.
//
// A piece is one of:
//   { kind: 'straight', length: 700, climb: 0 }
//   { kind: 'turn', dir: 'right', angle: 90, radius: 60, climb: 0, bank: 0 }
// A turn may also give `radius2`, the radius it ENDS at: the corner then winds
// steadily tighter (or wider) all the way through. A snail is one piece:
//   { kind: 'turn', dir: 'left', angle: 900, radius: 110, radius2: 28 }
// and any piece may also set `width` (full road width, m), `run` / `runL` /
// `runR` (metres from the road edge to the barrier), `tunnel: true` (the
// road goes THROUGH the hill here, so the land is above it, not below), or
// `bridge: true` (the road is carried OVER the land on a structure, so the
// land is below it and holds nothing up — the mirror image of a tunnel).
// Those carry on into the pieces after it until something changes them.
//
// Pure: no renderer, no DOM. Runs the same in the browser and in Node, which
// is what lets tools/buildcheck.mjs gate exactly what the page draws.

export const DS = 2;                 // metres between samples — same as the real circuits
export const START = { width: 14, run: 12 };

// How a corner is eased in and out. A constant-radius arc bolted straight onto
// a straight is a step in curvature — the steering would have to jump from
// zero to full lock in one sample. Every real road (and every Blender bezier)
// ramps into the corner instead. The ramp is part of the corner, so `radius`
// is the tightest point, at the apex.
function easing(angle, radius) {
  return Math.min(angle * radius * 0.5, 0.5 * radius + 10);
}

// The curvature a piece asks for, `u` metres into it. + = left.
function shape(p) {
  if (p.kind === 'straight') return { len: p.length, k: () => 0, kMax: 0 };
  const A = p.angle * Math.PI / 180, R = p.radius;
  const sign = p.dir === 'left' ? 1 : -1;
  const k0 = 1 / R, k1 = 1 / (p.radius2 || R), kMax = Math.max(k0, k1);
  // Ease in, hold (winding from k0 to k1 if radius2 asks for it), ease out.
  // The angle is what was asked for, so the LENGTH follows from it.
  const T = easing(A, Math.min(R, p.radius2 || R));
  const hold = Math.max(0, (A - (k0 + k1) * T / 2) / ((k0 + k1) / 2));
  const len = hold + 2 * T;
  return {
    len, kMax,
    k: u => {
      if (u < T) return sign * k0 * (u / T);
      if (u > T + hold) return sign * k1 * Math.max(0, len - u) / T;
      return sign * (k0 + (k1 - k0) * (hold ? (u - T) / hold : 0));
    },
  };
}

// Gaussian smoothing of a sampled signal. Used on height (so a change of grade
// becomes a crest or a dip you can drive over, not a fold) and on width.
function smooth(src, sigmaM, closed) {
  const n = src.length, r = Math.ceil(3 * sigmaM / DS), out = new Float64Array(n);
  const wts = [];
  for (let j = -r; j <= r; j++) wts.push(Math.exp(-0.5 * (j * DS / sigmaM) ** 2));
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0;
    for (let j = -r; j <= r; j++) {
      let k = i + j;
      if (closed) k = ((k % n) + n) % n;
      else k = Math.max(0, Math.min(n - 1, k));   // an open end carries on level
      a += src[k] * wts[j + r]; b += wts[j + r];
    }
    out[i] = a / b;
  }
  return out;
}

export function buildPath(pieces, { closed = false } = {}) {
  const X = [], Y = [], ZL = [], H = [], K = [], B = [], W = [], RL = [], RR = [], P = [], TU = [], BR = [];
  const info = [];
  let x = 0, y = 0, hdg = 0, z = 0, s = 0, next = 0;
  let width = START.width, runL = START.run, runR = START.run, tunnel = false, bridge = false;
  const SUB = 0.25;                 // integration step; samples are emitted every DS

  const emit = (k, bank, pi) => {
    X.push(x); Y.push(y); ZL.push(z); H.push(hdg); K.push(k); B.push(bank);
    W.push(width / 2); RL.push(runL); RR.push(runR); P.push(pi);
    TU.push(tunnel ? 1 : 0); BR.push(bridge ? 1 : 0);
  };

  pieces.forEach((p, pi) => {
    if (p.width) width = p.width;
    if (p.run != null) runL = runR = p.run;
    if (p.runL != null) runL = p.runL;
    if (p.runR != null) runR = p.runR;
    if (p.tunnel != null) tunnel = !!p.tunnel;
    if (p.bridge != null) bridge = !!p.bridge;
    const sh = shape(p);
    const s0 = s, z0 = z, climb = p.climb || 0, bank = p.bank || 0;
    for (let u = 0; u < sh.len - 1e-9;) {
      if (s >= next - 1e-9) {
        const k = sh.k(u);
        emit(k, sh.kMax ? bank * Math.abs(k) / sh.kMax : 0, pi);
        next += DS;
      }
      // land exactly on the next sample, so samples are exactly DS apart —
      // the game's Track assumes s = i * ds everywhere
      const du = Math.min(SUB, sh.len - u, next - s);
      const km = sh.k(u + du / 2);           // midpoint rule on the heading
      const hm = hdg + km * du / 2;
      x += Math.cos(hm) * du; y += Math.sin(hm) * du;
      hdg += km * du;
      u += du; s += du;
      z = z0 + climb * (u / sh.len);
    }
    info.push({
      n: pi + 1, kind: p.kind, s0, s1: s, len: sh.len,
      dir: p.dir, angle: p.angle, radius: p.radius, radius2: p.radius2 || null, climb, bank, tunnel, bridge,
      note: p.note || '', part: p.part || null,
    });
  });
  // The very end. On a CLOSED lap that point IS the start line, so emitting it
  // would put a duplicate sample one zero-length step from sample 0; the game's
  // closed circuits all end one DS short of their first sample.
  if (s >= next - 1e-9 && !closed) emit(0, 0, pieces.length - 1);
  // ...and rounding can land that same point a hair early, inside the loop.
  if (closed && X.length > 1 && Math.hypot(X[X.length - 1] - X[0], Y[Y.length - 1] - Y[0]) < DS / 2) {
    for (const A of [X, Y, ZL, H, K, B, W, RL, RR, P, TU, BR]) A.pop();
  }

  // Height: straight lines between the pieces' ends, then eased, so every
  // change of gradient is a vertical curve. sigma 22 m turns a 10% change of
  // grade into a crest with a ~600 m radius — sharp enough to feel, smooth
  // enough that nothing looks folded.
  const Z = smooth(ZL, 22, closed);
  const Wd = smooth(W, 8, closed);
  const RLs = smooth(RL, 8, closed), RRs = smooth(RR, 8, closed);

  return {
    ds: DS, n: X.length, length: (closed ? X.length : X.length - 1) * DS, closed,   // a lap includes the step from the last sample back to the first
    x: Float64Array.from(X), y: Float64Array.from(Y), z: Z,
    hdg: Float64Array.from(H), k: Float64Array.from(K), bank: Float64Array.from(B),
    w: Wd, runL: RLs, runR: RRs, piece: Int32Array.from(P),
    tunnel: Uint8Array.from(TU), bridge: Uint8Array.from(BR),
    // metres INSIDE the tunnel (0 anywhere else). The rock above a tunnel has
    // to thicken from nothing at the portal, or the hill stands as a cliff on
    // the road's doorstep and its triangles cut across the road outside.
    tunIn: spanDepth(TU),
    // metres ONTO the bridge, same idea and for the same reason: the ground
    // has to fall away from the abutment over a distance, or the deck ends in
    // a cliff face standing across whatever the bridge was built to clear.
    briIn: spanDepth(BR),
    pieces: info,
    end: { x, y, hdg, z },
  };
}

// How far inside a flagged run (a tunnel, a bridge) each sample is, in metres:
// the distance to the nearer end. 0 everywhere outside one.
function spanDepth(F) {
  const n = F.length, d = new Float64Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) { run = F[i] ? run + DS : 0; d[i] = run; }
  run = 0;
  for (let i = n - 1; i >= 0; i--) { run = F[i] ? run + DS : 0; d[i] = Math.min(d[i], run); }
  return d;
}

// ---------------------------------------------------------------------------
// The road surface. Banking is built UP from the inside edge, the way a real
// banked corner is (pivot at the centreline and the inside edge sinks into the
// ground). Beyond the edge the verge carries on level at edge height.
// `lat` is metres to the LEFT of the centreline.
// ---------------------------------------------------------------------------
export function surfaceY(path, i, lat) {
  const w = path.w[i], b = path.bank[i];
  if (!b) return path.z[i];
  const dir = Math.sign(path.k[i]) || 1;           // +1 left turn: inside is +lat
  const l = Math.max(-w, Math.min(w, lat));
  return path.z[i] + Math.tan(b * Math.PI / 180) * (w - dir * l);
}

// Same, at any distance along the road, interpolated between samples.
export function surfaceYAt(path, s, lat) {
  const f = s / path.ds;
  const i = Math.max(0, Math.min(path.n - 1, Math.floor(f)));
  const j = Math.min(path.n - 1, i + 1), t = Math.max(0, Math.min(1, f - i));
  return surfaceY(path, i, lat) * (1 - t) + surfaceY(path, j, lat) * t;
}

// A world point for (s, lat) on the road, with its height.
export function pointAt(path, i, lat) {
  const h = path.hdg[i];
  return {
    x: path.x[i] - Math.sin(h) * lat,
    y: path.y[i] + Math.cos(h) * lat,
    z: surfaceY(path, i, lat),
  };
}

// The shape the game's Track class wants. The game's circuits are closed
// loops; a track under construction is not, so the caller patches the heading,
// curvature and bank arrays after construction (see makeTrack in app.js) —
// Track would otherwise wrap the last sample's neighbours round to the first.
export function trackData(path, name = 'Untitled') {
  return {
    key: 'build', name, full: name, country: '', aiPace: 0.8,
    length: path.n * path.ds, ds: path.ds, wall: 'armco', crossover: false,
    x: Array.from(path.x), y: Array.from(path.y),
    w: Array.from(path.w), bank: new Array(path.n).fill(0),
    runL: Array.from(path.runL), runR: Array.from(path.runR),
    line: new Array(path.n).fill(0), corners: [], drs: [], pit: null, sponsors: [],
  };
}
