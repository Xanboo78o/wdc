// line.js — racing line + speed profile, derived from the track AND the car.
// Pure: no renderer, no DOM. The headless harness and the browser both use it.
import { corneringSpeed, topSpeed, limitMu } from './physics.js';

// Minimum-CURVATURE line, not minimum length. Pulling the line taut apexes too
// tight and is slower; what you want is the gentlest arc the corridor allows.
// Projected gradient descent on the sum of squared second differences, clamped
// to the track edges.
//
// IT WAS NEVER SOLVED, and that was the line Adam called inaccurate (2026-09-23:
// "we need ACCURATE lines that have correct entries and exits"). The penalty is
// a fourth-difference operator, and plain gradient descent on one spreads a
// correction about (step x iterations)^(1/4) samples — 6000 steps of 0.12 reach
// FIVE samples, ten metres. A corner is two hundred. So the old line was the
// centreline smoothed locally: it never swung out for the entry, never reached
// the apex, never ran out to the exit kerb. Measured, it was still getting
// faster at 150,000 iterations (Monza 90.52 -> 88.11 s, Suzuka 102.4 -> 98.2).
//
// Now: coarse to fine (every 32nd sample, then 8th, 2nd, every one), each level
// started from the one above and solved with accelerated projected gradient
// (FISTA). Converged — 6000 and 20000 iterations agree to 0.02 s — and the
// AUTOPILOT, not just the profile, confirms it (HARD, F1, clean, 0.0 s off):
//   Monza 98.67 -> 94.34 s   Suzuka 111.11 -> 102.99 s   Monaco 97.43 -> 93.38 s
//
// MEASURED AND REJECTED: a lap-time polish on top (nudge the line in smooth
// bumps, keep what the speed profile says is quicker). It "found" another 4-6 s
// that the physics would not honour — HARD spun at Suzuka for 6-16 s a lap and
// Monaco came out no faster. It was optimising the model's blind spots.
//
// FISTA's step must stay under 1/L = 1/16 for this operator; 0.12 (plain
// gradient descent's old step) diverges into a 160-second line.
export function racingLine(track, margin = 0.35, iters = 6000) {
  const n = track.n;
  const off = new Float64Array(n);
  for (const k of [32, 8, 2, 1]) {
    if (k > 1 && n / k < 24) continue;
    const m = Math.floor(n / k);
    const cx = new Float64Array(m), cy = new Float64Array(m);
    const nx = new Float64Array(m), ny = new Float64Array(m);
    const lim = new Float64Array(m), init = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const i = j * k;
      cx[j] = track.x[i]; cy[j] = track.y[i];
      nx[j] = -Math.sin(track.hdg[i]); ny[j] = Math.cos(track.hdg[i]);
      lim[j] = Math.max(0.2, track.w[i] - margin);
      init[j] = off[i];
    }
    const sol = minCurvature(cx, cy, nx, ny, lim, init, iters);
    for (let j = 0; j < m; j++) {
      const i0 = j * k, i1 = j + 1 < m ? (j + 1) * k : n, a = sol[j], b = sol[(j + 1) % m];
      for (let i = i0; i < i1; i++) off[i] = a + (b - a) * (i - i0) / (i1 - i0);
    }
  }
  return Float32Array.from(off);
}

function minCurvature(cx, cy, nx, ny, lim, init, iters, step = 0.06) {
  const n = cx.length;
  const x = Float64Array.from(init), y = Float64Array.from(init), xPrev = new Float64Array(n);
  const px = new Float64Array(n), py = new Float64Array(n);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  let t = 1;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) { px[i] = cx[i] + nx[i] * y[i]; py[i] = cy[i] + ny[i] * y[i]; }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      dx[i] = px[a] - 2 * px[i] + px[b];
      dy[i] = py[a] - 2 * py[i] + py[b];
    }
    xPrev.set(x);
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      const g = nx[i] * (dx[a] - 2 * dx[i] + dx[b]) + ny[i] * (dy[a] - 2 * dy[i] + dy[b]);
      const v = y[i] - step * g;
      x[i] = v > lim[i] ? lim[i] : v < -lim[i] ? -lim[i] : v;
    }
    const t1 = (1 + Math.sqrt(1 + 4 * t * t)) / 2, mom = (t - 1) / t1;
    for (let i = 0; i < n; i++) y[i] = x[i] + mom * (x[i] - xPrev[i]);
    t = t1;
    // Restart the momentum now and then, or it overshoots the edge clamps.
    if (k % 500 === 499) { t = 1; y.set(x); }
  }
  return x;
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
