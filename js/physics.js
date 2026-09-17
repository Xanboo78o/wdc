// physics.js — the simulation. NOTHING in this file may import a renderer.
//
// That is the one rule that keeps this portable: every number here is computed
// from forces, not from frames, so the same module runs in the browser, in a
// headless Node harness, and (later) inside a native shell without a rewrite.
//
// The model is a slip-angle bicycle model with load transfer, a friction circle
// per axle, aero that scales with v^2, and tyres that heat and wear. The tyre
// curve is the whole game: grip PEAKS at a few degrees of slip and falls away
// past it. That fall-off is the limit you learn to feel. A model without it
// (a flat "max grip" cap) gives you a car that can never be overdriven, which
// is exactly why it teaches you nothing.

// ---------------------------------------------------------------------------
// Car specs. The ladder: you start in F4 and you earn the F1 car.
// ---------------------------------------------------------------------------
export const CARS = {
  f4: {
    key: 'f4', name: 'F4', full: 'Formula 4',
    // 570 kg is the real F4 minimum weight INCLUDING the driver.
    m: 570, Izz: 520,
    // a = CG->front axle, b = CG->rear axle. b < a means REAR weight bias.
    // Getting this backwards makes the car push into a corner then snap on
    // exit, which reads as "broken" rather than "oversteery".
    L: 2.75, a: 1.51, b: 1.24,
    h: 0.28,                    // CG height — this is what makes trail-braking work
    ClA: 1.35, CdA: 0.92, rho: 1.225,
    aeroBal: 0.42,
    // ~180 hp from the 1.4 turbo. An F4 car is traction-limited out of slow
    // corners and drag-limited by ~215 km/h, and both of those facts are in
    // these three numbers rather than in a top-speed clamp.
    Pmax: 125e3, Fdrive: 6200,
    Fbrake: 24000, brakeBal: 0.62,
    rollRes: 180,
    // Control (non-carbon) slick: lower peak grip than an F1 tyre, and it
    // peaks LATER (~10 deg vs ~7.4). That late peak is why an F4 car is the
    // right thing to learn in — it tells you it is sliding before it goes.
    B: 10.0, C: 1.75, E: 0.72,
    mu: 1.55, wear: 1.0, Topt: 82, Twin: 34,
    drs: false,
  },
  f1: {
    key: 'f1', name: 'F1', full: 'Formula 1',
    // These numbers are the ones already validated in DIRTY AIR against real
    // F1 data: 321 km/h top speed, ~2000 kg of downforce at 300 km/h, Monaco
    // hairpin at 45 km/h. Do not "tidy" them without re-running tools/laptime.
    m: 798, Izz: 950,
    L: 3.60, a: 1.98, b: 1.62,
    h: 0.30,
    ClA: 4.62, CdA: 1.28, rho: 1.225,
    aeroBal: 0.435,
    Pmax: 580e3, Fdrive: 13800,
    Fbrake: 46000, brakeBal: 0.60,
    rollRes: 260,
    B: 12.5, C: 1.80, E: 0.70,
    mu: 1.91, wear: 1.0, Topt: 92, Twin: 33,
    drs: true, drsCl: 0.80, drsCd: 0.74,
  },
};

export const SURFACE = { track: 1.0, kerb: 0.93, runoff: 0.58, grass: 0.42 };
const AMBIENT = 30;

// ---------------------------------------------------------------------------
// Peak slip angle — solved from the tyre curve, never hardcoded.
//
// The simplified Pacejka form peaks where C*atan(...) hits pi/2. Solving for it
// means the HUD's "limit" marker and the smoke trigger always agree with the
// tyres, even after the curve is retuned. Hardcoding "7 degrees" somewhere else
// is how a HUD starts lying to you.
// ---------------------------------------------------------------------------
export function peakSlip(spec) {
  const target = Math.tan(Math.PI / (2 * spec.C));
  let lo = 0, hi = 1.0;
  for (let i = 0; i < 60; i++) {
    const x = (lo + hi) / 2, bx = spec.B * x;
    const f = bx - spec.E * (bx - Math.atan(bx));
    if (f < target) lo = x; else hi = x;
  }
  return (lo + hi) / 2;
}

export function makeCar(opts = {}) {
  const spec = CARS[opts.cls || 'f4'];
  return {
    spec,
    x: 0, y: 0, hdg: 0,
    vx: 0.001, vy: 0, r: 0,       // body frame: vx forward, vy left, r yaw rate
    ax: 0, ay: 0,
    delta: 0, throttle: 0, brake: 0,
    tyre: { Tf: 60, Tr: 60, wf: 0, wr: 0, age: 0 },
    drsOpen: false, dirty: 0, tow: 0,
    // Driver aids, modelled as the real systems they are rather than as grip
    // bonuses. 0 = off. A keyboard throttle is binary — 0% or 100% — so without
    // TC the car spins on the exit of every slow corner, which it did.
    aids: { tc: 0.60, abs: 0.60, sc: 0.35, ...(opts.aids || {}) },
    tcCut: 1, absCut: 1,
    surface: 1, damage: 0,
    speed: 0, slipF: 0, slipR: 0, lock: false, wheelspin: false,
    gLat: 0, gLong: 0,
    ...opts,
  };
}

const pac = (spec, alpha, D) => {
  const x = spec.B * alpha;
  return -D * Math.sin(spec.C * Math.atan(x - spec.E * (x - Math.atan(x))));
};

// Grip as a fraction of the compound's peak, given temperature and wear.
export function tyreGrip(spec, T, wear) {
  const win = Math.exp(-(((T - spec.Topt) / spec.Twin) ** 2));   // 1.0 inside the window
  const temp = 0.82 + 0.18 * win;                                // cold or cooked = 82%
  const w = 1 - 0.24 * Math.pow(wear, 1.25);
  return spec.mu * temp * w;
}

function clampCircle(fx, fy, cap) {
  const m = Math.hypot(fx, fy);
  if (m <= cap || m < 1e-6) return [fx, fy, false];
  const k = cap / m;
  return [fx * k, fy * k, true];
}

// ---------------------------------------------------------------------------
// One physics substep. Call it at a FIXED dt (see FIXED_DT) — never with a
// frame time. A variable dt makes the car faster on a faster monitor, which is
// the single most common way a browser "sim" turns out not to be one.
// ---------------------------------------------------------------------------
export const FIXED_DT = 1 / 400;

export function step(car, dt, env = {}) {
  const S = car.spec, t = car.tyre, A = car.aids || { tc: 0, abs: 0, sc: 0 };
  const v = Math.hypot(car.vx, car.vy);
  // Low-speed regularisation. With raw slip angles, vx -> 0 sends every slip
  // angle to 90 degrees, the friction circle then eats all the drive force,
  // and the car scrubs to a standstill at full throttle. Real tyre models damp
  // this the same way. The floor is mandatory, not a tuning knob.
  const vSafe = Math.max(Math.abs(car.vx), 6.0);
  const surf = env.surface ?? 1;

  // ---- aero ---------------------------------------------------------------
  const q = 0.5 * S.rho * v * v;
  let clA = S.ClA, cdA = S.CdA;
  if (car.drsOpen && S.drs) { clA *= S.drsCl; cdA *= S.drsCd; }
  const dirty = env.dirty ?? car.dirty ?? 0;
  const tow = env.tow ?? car.tow ?? 0;
  // Following another car guts your FRONT wing first -> understeer. That is
  // the real reason overtaking is hard, and it is why the effect is asymmetric.
  const DFf = q * clA * S.aeroBal * (1 - 0.40 * dirty);
  const DFr = q * clA * (1 - S.aeroBal) * (1 - 0.12 * dirty);
  const drag = q * cdA * (1 - 0.40 * tow) + S.rollRes;

  // ---- vertical loads (load transfer is what makes the car feel alive) -----
  const g = 9.81;
  const statF = S.m * g * S.b / S.L, statR = S.m * g * S.a / S.L;
  const tr = S.m * car.ax * S.h / S.L;
  const Fzf = Math.max(200, statF + DFf - tr);
  const Fzr = Math.max(200, statR + DFr + tr);

  const muF = tyreGrip(S, t.Tf, t.wf) * surf;
  const muR = tyreGrip(S, t.Tr, t.wr) * surf;

  // ---- slip angles --------------------------------------------------------
  // Stability control adds counter-lock when the car rotates faster than the
  // steering asks for. It must NOT be written back into car.delta: that field
  // is the DRIVER's rack position, and both the autopilot and the keyboard
  // model read it back as their own state. Writing to it made the assist and
  // the driver fight each other every substep and put the reference driver
  // 113 m off the road. Keep the correction local to the force calculation.
  const pk = S._pk || (S._pk = peakSlip(S));
  let steer = car.delta;
  if (A.sc > 0) {
    const ex = Math.abs(car.slipR) - Math.abs(car.slipF);
    if (ex > 0.03) steer += Math.sign(car.slipR) * Math.min(0.25, (ex - 0.03) * 1.6) * A.sc;

    // STEERING LIMITER — the fix for "I can't turn without spinning out".
    //
    // A keyboard winds to full lock in about a third of a second, and full lock
    // at 70 km/h asks the front tyre for ~12 degrees of slip when it peaks at
    // 7.4. Past peak, MORE steering gives LESS grip: the front washes out, the
    // car ploughs straight on, and only then does it let go. The trace showed
    // front slip above rear slip the whole way in — understeer, not oversteer,
    // which is why the traction control and the counter-lock above could not
    // touch it (both look for the REAR going first).
    //
    // So clamp the rack to the slip the front can actually use. This is not a
    // driving aid inventing grip — it is what a real steering rack's geometry
    // and a real driver's hands already do. Nobody steers to 37 degrees of slip.
    const base = Math.atan((car.vy + S.a * car.r) / vSafe);
    const lim = pk * (1.05 + 0.45 * (1 - A.sc));
    steer = Math.max(base - lim, Math.min(base + lim, steer));
  }
  car.steerEff = steer;

  const af = Math.atan((car.vy + S.a * car.r) / vSafe) - steer;
  const ar = Math.atan((car.vy - S.b * car.r) / vSafe);

  // LOW SPEED. A slip ANGLE is meaningless as the car stops — the 6 m/s floor
  // keeps it finite, but a parked car with lock applied still computes a
  // full-size angle and spins on the spot like a shopping trolley.
  //
  // The honest model is that a tyre near standstill resists by slip VELOCITY,
  // not slip angle: the contact patch scrubs, and the force opposes how fast
  // the tyre is being dragged sideways, capped by grip. Blending to that below
  // 3 m/s both kills the spinning-while-parked bug AND straightens a spun car
  // for a real reason. The previous version faked the second half with a
  // hand-written `vy -= vy*k; r -= r*k` fudge below 5 m/s — which is exactly
  // what made a spin feel like a canned animation instead of physics.
  const lowV = Math.min(1, v / 3.0);
  let Fyf = pac(S, af, muF * Fzf) * lowV;
  let Fyr = pac(S, ar, muR * Fzr) * lowV;
  if (lowV < 1) {
    const w = 1 - lowV;
    const capF = muF * Fzf, capR = muR * Fzr;
    const vLatF = car.vy + S.a * car.r, vLatR = car.vy - S.b * car.r;
    const visc = 1 / 1.5;                       // full grip by 1.5 m/s of scrub
    Fyf += -Math.max(-capF, Math.min(capF, vLatF * visc * capF)) * w;
    Fyr += -Math.max(-capR, Math.min(capR, vLatR * visc * capR)) * w;
  }

  // ---- longitudinal -------------------------------------------------------
  // Driver aids act on the PEDALS, never on the grip. TC cuts engine torque
  // when the rear is past its peak; ABS releases brake pressure when the front
  // locks. Both react to the previous substep's measured slip — 2.5 ms of
  // latency, which is about what a real system has. Neither invents grip: they
  // stop the driver asking for more than the tyre has.
  let thrCmd = car.throttle, brkCmd = car.brake;
  if (A.tc > 0) {
    // Limit drive torque to what the rear tyre can still take once cornering
    // has taken its share of the friction circle. This is what a real traction
    // control does, and it is PREDICTIVE — it never lets the demand exceed the
    // grip in the first place.
    //
    // The first version waited for the rear slip angle to pass peak before
    // cutting. In a slow corner that is far too late: the car is already gone
    // by the time the signal appears, which is why it still spun on every
    // chicane exit.
    const capR = Math.max(1, muR * Fzr);
    const latUse = Math.min(1, Math.abs(Fyr) / capR);
    const longRoom = Math.sqrt(Math.max(0, 1 - latUse * latUse)) * capR;
    const full = Math.min(S.Pmax / Math.max(v, 9), S.Fdrive);
    // The AID LEVEL sets how far past the circle the tyre is allowed to go,
    // not what fraction of the correct cut to apply. Applying 60% of the needed
    // cut at level 0.6 still overdrives and still spins — a mid setting should
    // permit more wheelspin, not permit a spin. Level 0 disables TC entirely
    // (the else branch below), which is the setting for doing it properly.
    const room = longRoom * (1 + 0.6 * (1 - A.tc));
    const want = full > 1 ? Math.min(1, room / full) : 1;
    // cut hard, restore gently — a TC that restores fast just oscillates
    car.tcCut += (want - car.tcCut) * Math.min(1, dt * (want < car.tcCut ? 90 : 9));
    thrCmd *= car.tcCut;
  } else car.tcCut = 1;
  if (A.abs > 0) {
    const tgt = car.lock ? 0.5 : 1;
    car.absCut += (tgt - car.absCut) * Math.min(1, dt * (car.lock ? 120 : 25));
    brkCmd *= 1 - (1 - car.absCut) * A.abs;
  } else car.absCut = 1;

  let FxR = 0, FxF = 0;
  if (thrCmd > 0) FxR += Math.min(S.Pmax / Math.max(v, 9), S.Fdrive) * thrCmd;
  if (brkCmd > 0) {
    FxF -= S.Fbrake * S.brakeBal * brkCmd;
    FxR -= S.Fbrake * (1 - S.brakeBal) * brkCmd;
  }
  // Friction circle: grip spent stopping is grip you do not have for turning.
  // This is the whole of trail-braking, and it falls out for free.
  let lockF = false, spinR = false;
  [FxF, Fyf, lockF] = clampCircle(FxF, Fyf, muF * Fzf);
  [FxR, Fyr, spinR] = clampCircle(FxR, Fyr, muR * Fzr);

  // ---- banking ------------------------------------------------------------
  let bankF = 0;
  if (env.bank) {
    const th = env.bank * Math.PI / 180;
    bankF = (S.m * g + DFf + DFr) * Math.sin(th) * (env.bankDir || 0);
  }

  // ---- equations of motion ------------------------------------------------
  const cd = Math.cos(steer), sd = Math.sin(steer);
  const Fx = FxR + FxF * cd - Fyf * sd - drag * Math.sign(car.vx || 1);
  const Fy = Fyf * cd + Fyr + FxF * sd + bankF;
  const Mz = S.a * (Fyf * cd + FxF * sd) - S.b * Fyr;

  car.ax = Fx / S.m + car.vy * car.r;
  car.ay = Fy / S.m - car.vx * car.r;
  car.vx += car.ax * dt;
  car.vy += car.ay * dt;
  car.r += (Mz / S.Izz) * dt;
  // A spinning single-seater tops out near 3 rad/s; the clamp stops an explicit
  // integrator inventing 20 rad/s nonsense at the limit.
  const RMAX = 4.5;
  if (car.r > RMAX) car.r = RMAX; else if (car.r < -RMAX) car.r = -RMAX;
  if (v < 3) car.r *= 1 - Math.min(0.9, 4 * dt);

  // A spun car still has ground speed. Clamp forward velocity at zero but do
  // NOT bleed the lateral component — doing that destroys all the car's energy
  // in about 0.05 s and reads as an instant stop from 120 km/h.
  if (car.vx < 0) car.vx = 0;
  // Nothing scripted here any more. A spun car is straightened by the viscous
  // scrub term above, which is a tyre force like any other, so the recovery is
  // something the simulation does rather than something played back at you.
  car.hdg += car.r * dt;
  car.x += (car.vx * Math.cos(car.hdg) - car.vy * Math.sin(car.hdg)) * dt;
  car.y += (car.vx * Math.sin(car.hdg) + car.vy * Math.cos(car.hdg)) * dt;

  // ---- tyre temperature and wear ------------------------------------------
  // Slip POWER: force x slip angle x speed.
  const vh = Math.max(v, 3);
  const powF = Math.abs(af) * Math.abs(Fyf) * vh + (lockF ? Math.abs(FxF) * 0.05 * vh : 0);
  const powR = Math.abs(ar) * Math.abs(Fyr) * vh + (spinR ? Math.abs(FxR) * 0.05 * vh : 0);
  // Tuned so sustained cornering settles in the working window and a long
  // straight sheds 15-20 C. A ~1 s cooling time constant pins every tyre at
  // ambient and silently costs 30% of the grip — it looks like broken physics.
  const HEAT = 6.2e-5, COOL = 0.010;
  const air = 1 + 0.016 * v;
  t.Tf += (HEAT * powF - COOL * air * (t.Tf - AMBIENT)) * dt;
  t.Tr += (HEAT * powR - COOL * air * (t.Tr - AMBIENT)) * dt;
  const wk = 2.0e-9 * S.wear;
  t.wf = Math.min(1.6, t.wf + wk * powF * dt);
  t.wr = Math.min(1.6, t.wr + wk * powR * dt * 1.12);
  t.age += dt;

  car.slipF = af; car.slipR = ar;
  car.lock = lockF; car.wheelspin = spinR;
  car.speed = Math.hypot(car.vx, car.vy);
  car.gLat = car.ay / g; car.gLong = car.ax / g;
  car.muF = muF; car.muR = muR;
  return car;
}

// Drag-limited top speed: power in, aero out. Bisection, because the iterative
// form runs away at high downforce.
export function topSpeed(spec, drs = false) {
  const cdA = spec.CdA * (drs && spec.drs ? spec.drsCd : 1);
  let lo = 10, hi = 160;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const p = (0.5 * spec.rho * cdA * mid * mid + spec.rollRes) * mid;
    if (p > spec.Pmax) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Steady-state cornering speed for a radius. Downforce rises with v^2, so past
// a certain radius grip is never the limit — top speed is.
export function corneringSpeed(spec, R, mu, bank = 0) {
  R = Math.abs(R);
  // The textbook banked-curve formula blows up at these grip levels; the real
  // gain at Zandvoort's 18 degrees is about 10-15 km/h, so scale it sanely.
  const m = bank ? mu * (1 + 0.90 * Math.sin(Math.abs(bank) * Math.PI / 180)) : mu;
  const k = spec.m / R - m * 0.5 * spec.rho * spec.ClA;
  const vGrip = k <= 1e-3 ? Infinity : Math.sqrt(m * spec.m * 9.81 / k);
  return Math.min(vGrip, topSpeed(spec));
}
