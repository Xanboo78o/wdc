// line.js — racing line + speed profile, derived from the track AND the car.
// Pure: no renderer, no DOM. The headless harness and the browser both use it.
import { corneringSpeed, topSpeed, limitMu } from './physics.js';

// Minimum-CURVATURE line, not minimum length. Pulling the line taut apexes too
// tight and is slower; what you want is the gentlest arc the corridor allows.
// Gradient descent on the sum of squared second differences, clamped to the
// track edges.
export function racingLine(track, margin = 0.35, iters = 6000, step = 0.12) {
  const n = track.n;
  const off = new Float32Array(n);
  const nx = new Float32Array(n), ny = new Float32Array(n);
  const lim = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    nx[i] = -Math.sin(track.hdg[i]); ny[i] = Math.cos(track.hdg[i]);
    lim[i] = Math.max(0.2, track.w[i] - margin);
  }
  const px = new Float32Array(n), py = new Float32Array(n);
  const dx = new Float32Array(n), dy = new Float32Array(n);
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) { px[i] = track.x[i] + nx[i] * off[i]; py[i] = track.y[i] + ny[i] * off[i]; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      dx[i] = px[a] - 2 * px[i] + px[b];
      dy[i] = py[a] - 2 * py[i] + py[b];
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const g = nx[i] * (dx[a] - 2 * dx[i] + dx[b]) + ny[i] * (dy[a] - 2 * dy[i] + dy[b]);
      const v = off[i] - step * g;
      off[i] = v > lim[i] ? lim[i] : v < -lim[i] ? -lim[i] : v;
    }
  }
  return off;
}

function ptOf(t, off, i) {
  const h = t.hdg[i];
  return { x: t.x[i] - Math.sin(h) * off[i], y: t.y[i] + Math.cos(h) * off[i] };
}

export function lineCurvature(track, off) {
  const n = track.n, cur = new Float32Array(n);
  const P = i => ptOf(track, off, ((i % n) + n) % n);
  for (let i = 0; i < n; i++) {
    const a = P(i - 2), b = P(i), c = P(i + 2);
    const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y;
    const cross = ax * by - ay * bx;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(c.x - a.x, c.y - a.y);
    cur[i] = (la * lb * lc) > 1e-6 ? (2 * cross) / (la * lb * lc) : 0;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -3; k <= 3; k++) acc += cur[((i + k) % n + n) % n];
    out[i] = acc / 7;
  }
  return out;
}

// Forward/backward passes give the fastest speed you can actually carry:
// corner-limited, then brake-limited into it, then power-limited out of it.
// Braking capability FALLS with speed because downforce does — which is why a
// single averaged braking number is never good enough.
export function speedProfile(track, off, cur, spec, mu) {
  const n = track.n, ds = track.ds, vmax = topSpeed(spec);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const R = Math.abs(cur[i]) > 1e-5 ? 1 / Math.abs(cur[i]) : 1e6;
    v[i] = Math.min(vmax, corneringSpeed(spec, R, mu, track.bank[i]) * 0.97);
  }
  const q = s => 0.5 * spec.rho * s * s;
  for (let pass = 0; pass < 3; pass++) {
    for (let k = n * 2; k >= 0; k--) {           // backward: braking
      const i = k % n, j = (i + 1) % n;
      const Fz = spec.m * 9.81 + q(v[j]) * spec.ClA;
      const aBrake = (Math.min(mu * Fz, spec.Fbrake) + q(v[j]) * spec.CdA) / spec.m;
      const cap = Math.sqrt(v[j] * v[j] + 2 * aBrake * ds);
      if (v[i] > cap) v[i] = cap;
    }
    for (let k = 0; k <= n * 2; k++) {           // forward: traction/power
      const i = k % n, j = (i - 1 + n) % n;
      const Fz = spec.m * 9.81 + q(v[j]) * spec.ClA;
      const Fdrive = Math.min(spec.Pmax / Math.max(v[j], 9), spec.Fdrive, mu * Fz * 0.62);
      const aAcc = (Fdrive - q(v[j]) * spec.CdA - spec.rollRes) / spec.m;
      const cap = Math.sqrt(Math.max(1, v[j] * v[j] + 2 * Math.max(0, aAcc) * ds));
      if (v[i] > cap) v[i] = cap;
    }
  }
  return v;
}

// Both paths a bot might drive, solved once and shared across the whole grid.
//
// The centreline is not "the racing line, slower" — it is a genuinely different
// path with different curvature, so it needs its own speed profile. A bot that
// follows the centreline while carrying racing-line speeds does not drive like
// a novice, it drives like someone crashing. This is what makes SUPERCASUAL
// work: competent car control, correct braking, wrong path.
// The default grip is limitMu(spec), NOT spec.mu. spec.mu is what an evenly
// loaded axle makes, and a car at the cornering limit is leaning on its
// outside wheels — see limitMu() in physics.js. Solving the line at spec.mu
// asks every car on the grid for about 9% more grip than it has, and they all
// run wide in every corner.
export function buildLines(track, spec, mu = limitMu(spec)) {
  const zero = new Float32Array(track.n);
  const ccur = lineCurvature(track, zero);
  const cpts = new Float32Array(track.n * 2);
  for (let i = 0; i < track.n; i++) { cpts[i * 2] = track.x[i]; cpts[i * 2 + 1] = track.y[i]; }
  const lapOf = v => { let l = 0; for (let i = 0; i < track.n; i++) l += track.ds / Math.max(v[i], 5); return l; };

  const race = buildLine(track, spec, mu);
  const cv = speedProfile(track, zero, ccur, spec, mu * 0.93);
  const centre = { off: zero, cur: ccur, v: cv, pts: cpts, hdg: track.hdg, lapTime: lapOf(cv) };

  // `at(which, grip)` — a slower driver is NOT a fast driver with the speed
  // turned down. They use less of the tyre. Re-solving the profile at reduced
  // grip is the physically honest version: corner speeds fall (v ~ sqrt(mu))
  // while the straights are untouched, because top speed is drag-limited, not
  // grip-limited. Scaling the finished profile instead caps top speed too,
  // which had the whole grid trundling down the Monza straight 70 km/h below
  // what the car can actually do.
  const cache = new Map();
  const at = (which, grip = 1) => {
    const key = `${which}:${grip.toFixed(3)}`;
    let got = cache.get(key);
    if (got) return got;
    const base = which === 'centre' ? centre : race;
    const v = speedProfile(track, base.off, base.cur, spec, mu * 0.93 * grip);
    got = { ...base, v, lapTime: lapOf(v) };
    cache.set(key, got);
    return got;
  };
  return { race, centre, at };
}

export function buildLine(track, spec, mu = spec.mu, margin = 0.35) {
  // The profile is what the car can do at PEAK grip. A driver never sits
  // exactly on the optimum, so budget for that here instead of asking for 7%
  // more grip than the car has.
  mu *= 0.93;
  const off = track.line ? Float32Array.from(track.line) : racingLine(track, margin);
  const cur = lineCurvature(track, off);
  const v = speedProfile(track, off, cur, spec, mu);
  const pts = new Float32Array(track.n * 2);
  for (let i = 0; i < track.n; i++) {
    const p = ptOf(track, off, i);
    pts[i * 2] = p.x; pts[i * 2 + 1] = p.y;
  }
  // Heading of the racing LINE, not the centreline — a path tracker given the
  // centreline heading fights a constant offset through every corner.
  const hdg = new Float32Array(track.n);
  for (let i = 0; i < track.n; i++) {
    const a = ((i - 1) + track.n) % track.n, b = (i + 1) % track.n;
    hdg[i] = Math.atan2(pts[b * 2 + 1] - pts[a * 2 + 1], pts[b * 2] - pts[a * 2]);
  }
  // An OPEN track has no sample before the first or after the last, and the
  // wrap above points those two at each other across the map. A hot lap takes
  // the PLAYER's starting heading from this array, so on the hand-built track
  // that put the car on the start line facing 120 degrees into a field. Same
  // clamp as js/track.js; the two have to agree or the car and the line it is
  // being scored against disagree about which way the road goes.
  if (track.open && track.n > 2) {
    const n = track.n;
    hdg[0] = Math.atan2(pts[3] - pts[1], pts[2] - pts[0]);
    hdg[n - 1] = Math.atan2(pts[(n - 1) * 2 + 1] - pts[(n - 2) * 2 + 1],
      pts[(n - 1) * 2] - pts[(n - 2) * 2]);
  }
  let lap = 0;
  for (let i = 0; i < track.n; i++) lap += track.ds / Math.max(v[i], 5);
  return { off, cur, v, pts, hdg, lapTime: lap };
}
