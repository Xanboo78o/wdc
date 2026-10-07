// xingus.js — XINGUS MODE: sit back, relax, and go fast.
//
// Adam, 2026-10-06: "a mode where i can just mess around with way less wories
// of spinning ... id like to drift simple, and have grip otherwhere, like
// arcadey tbh ... i really just want to be able to sit back, relax, and go
// fast". A separate door from the serious game, with its own rules.
//
// WHAT THIS FILE IS: the handling, and only the handling. The real physics
// (js/physics.js) still moves the car — tyres, weight transfer, downforce,
// the road's camber and its jumps are all still true, which is why it still
// feels like a car. This runs AFTER each physics step, for your car only, and
// overrules it in three places:
//
//   GRIP      the car's slip angle is held small. Whatever the tyres were
//             about to do, the nose and the direction of travel stay within
//             GRIP_BETA of each other. That is the "grip otherwhere".
//   DRIFT     the handbrake with some lock on, or full lock held on the power,
//             and the car is IN A DRIFT: the slip angle is driven to a target
//             you set with the wheel (more lock = more angle and a tighter
//             line, less = shallower), for as long as you hold it. Unwind the
//             wheel and it gathers itself up.
//   NO SPIN   whatever else happens — a kerb, a tap, a landing — the slip
//             angle cannot pass SPIN_BETA. A car that cannot get past 48
//             degrees cannot come round on you.
//
// And it forgives: no damage, back on its wheels if it lands on its roof.
//
// NOTHING HERE MAY IMPORT A RENDERER. tools/xinguscheck.mjs drives it in Node
// with the worst inputs it can think of and asserts the three rules above.
const D2R = Math.PI / 180;
export const GRIP_BETA = 5 * D2R;       // the most the car slides when it is not drifting
export const SPIN_BETA = 48 * D2R;      // the most it can ever slide
const DRIFT_MIN = 14 * D2R, DRIFT_MAX = 40 * D2R;   // the drift's angle, shallowest to deepest
const T_GRIP = 0.12;                   // s: how fast grip pulls the slip angle back inside its limit
const RATE_IN = 75 * D2R, RATE_OUT = 55 * D2R;      // rad/s: how fast a drift's angle winds on, and off
const HOLD_ON = 1.6, HOLD_OFF = 7;      // m/s2 a drift may cost you: on the power, and off it
const V_MIN = 9, V_DRIFT = 15;          // m/s: below these nothing is governed / no drift starts
const G = 9.81;

// What the mode asks of the car's own systems: every aid up, a tune with more
// tyre than is real. A copy, so the serious game's GT3 is not touched.
// Two tunes of it. GT: the car as it is, with more tyre. RALLY: the same body
// set up for stages — four driven wheels' worth of traction, most of the wing
// taken off, a softer tyre that does not care what it is standing on (LOOSE is
// the least grip a gravel or snow ROAD gives it; the GT gets less).
const TUNES = {
  gt: { mu: 1.22, loose: 0.84, f: s => ({}) },
  rally: { mu: 1.16, loose: 0.97, f: s => ({ Fdrive: s.Fdrive * 1.3, ClA: s.ClA * 0.45, CdA: s.CdA * 0.85, h: (s.h || 0.45) + 0.07 }) },
};
const TUNED = new Map();
export function xingusSpec(spec, tune = 'gt') {
  const T = TUNES[tune] || TUNES.gt, k = spec.key + '|' + tune;
  if (!TUNED.has(k)) TUNED.set(k, { ...spec, ...T.f(spec), mu: spec.mu * T.mu, loadSens: (spec.loadSens || 0) * 0.5, xingus: tune });
  return TUNED.get(k);
}
export function xingusCar(car, tune = 'gt') {
  car.spec = xingusSpec(car.spec, tune);
  car.aids = { ...(car.aids || {}), tc: 0.9, abs: 0.9, sc: 0 };   // stability is this file's job now
  car.xg = { dir: 0, flick: 0, calm: 0, lock: 0.25, beta: 0, state: 'grip', vHold: 0, loose: (TUNES[tune] || TUNES.gt).loose };
  return car;
}

// inp: { throttle, brake, delta, wheel (-1..1, optional), hand (bool) }
export function xingusStep(car, inp, dt) {
  const x = car.xg;
  if (!x) return;
  // It forgives.
  car.damage = 0;
  if (car.onRoof && car.speed < 12) { car.onRoof = false; car.airborne = false; car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0; }
  if (car.airborne) return;                               // in the air it is the air's
  const vx = car.vx, v = Math.hypot(car.vx, car.vy);
  // How much lock is on, -1..1, + = left. The wheel's own fraction if the game
  // hands it over; otherwise the steer angle against the most seen so far.
  x.lock = Math.max(x.lock, Math.abs(inp.delta || 0));
  const steer = inp.wheel != null ? inp.wheel : (inp.delta || 0) / x.lock;
  const thr = inp.throttle || 0;
  if (v < V_MIN || vx < 2) { x.state = 'grip'; x.vHold = 0; x.beta = Math.atan2(car.vy, Math.max(0.01, Math.abs(vx))); return; }

  // ---- in or out of a drift -------------------------------------------------
  // Full lock held on the power for a quarter of a second is a drift too: the
  // flick. Lifting off the wheel, or off the throttle for half a second, ends it.
  x.flick = Math.abs(steer) > 0.85 && thr > 0.85 ? x.flick + dt : 0;
  if (x.state !== 'drift' && v > V_DRIFT && Math.abs(steer) > 0.2 && (inp.hand || x.flick > 0.25)) {
    x.state = 'drift'; x.dir = Math.sign(steer); x.calm = 0;
  }
  if (x.state === 'drift') {
    const into = steer * x.dir;                           // + = still steering into the turn
    x.calm = (into < 0.12 || (thr < 0.08 && !inp.hand)) ? x.calm + dt : 0;
    if (x.calm > (into < -0.3 ? 0.08 : 0.4) || v < V_MIN + 2) { x.state = 'out'; x.calm = 0; }
  } else if (x.state === 'out' && Math.abs(x.beta) < GRIP_BETA * 0.8) x.state = 'grip';

  // ---- the slip angle it is allowed -------------------------------------------
  // Turning LEFT the car's nose leads its path, so the path points to the
  // nose's RIGHT: vy < 0. beta = atan2(vy, vx), so a left drift is negative.
  let beta = Math.atan2(car.vy, vx), speed = v;
  if (x.state === 'drift' || x.state === 'out') {
    // The angle is COMMANDED, not coaxed: the tyres pull a sliding car straight
    // again every step, and a target merely leaned towards settled eight
    // degrees short of itself and wandered (tools/xinguscheck.mjs, first run).
    const into = Math.max(0, Math.min(1, steer * x.dir));
    const target = x.state === 'drift' ? -x.dir * (DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * into) : 0;
    const rate = (x.state === 'drift' ? RATE_IN : RATE_OUT) * dt;
    beta = x.beta + Math.max(-rate, Math.min(rate, target - x.beta));
    if (x.state === 'drift') {
      // The line: the wheel sets how hard the car is turning, not the tyres.
      // Half a g of lateral with a little lock on, a g and a half at full lock.
      const rWant = x.dir * (0.55 + 0.95 * into) * G / v;
      // Commanded as well, and for the same reason as the angle: left to the
      // tyres the car held a left-hand drift's attitude while turning RIGHT.
      x.r = (x.r ?? car.r) + Math.max(-3 * dt, Math.min(3 * dt, rWant - (x.r ?? car.r)));
      car.r = x.r;
      // And the speed: tyres at thirty degrees are brakes (162 -> 46 km/h in
      // six seconds, measured). A drift here costs HOLD_ON on the power and
      // HOLD_OFF off it, and never more; the brake pedal is still the brake.
      if ((inp.brake || 0) < 0.1) {
        x.vHold = Math.max(v, (x.vHold || v) - (HOLD_ON + (HOLD_OFF - HOLD_ON) * (1 - thr)) * dt);
        speed = x.vHold;
      } else x.vHold = v;
    }
  } else {
    const target = Math.max(-GRIP_BETA, Math.min(GRIP_BETA, beta));
    beta += (target - beta) * Math.min(1, dt / T_GRIP);
  }
  if (x.state !== 'drift') { x.vHold = 0; x.r = null; }
  beta = Math.max(-SPIN_BETA, Math.min(SPIN_BETA, beta));
  car.vx = speed * Math.cos(beta); car.vy = speed * Math.sin(beta);
  x.beta = beta;
  // Out of a drift, the yaw rate that was holding the angle is let go, or the
  // car goes on rotating after you have straightened the wheel.
  if (x.state !== 'drift') {
    const rMax = 1.9 * G / v;
    if (Math.abs(car.r) > rMax) car.r = Math.sign(car.r) * rMax;
    if (x.state === 'out') car.r *= 1 - Math.min(1, dt / 0.25) * (Math.abs(steer) < 0.2 ? 1 : 0.3);
  }
}

// Off the road is still somewhere you can drive: the grip never falls below
// this, and the gravel's drag is a third of what the serious game charges.
export const xingusSurface = mu => Math.max(mu, 0.82);
export const xingusDrag = drag => 1 + (drag - 1) * 0.3;
