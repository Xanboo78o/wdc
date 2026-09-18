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
    bodyL: 4.60, bodyW: 1.75,   // real bodywork, for contact — not the wheelbase
    h: 0.28,                    // CG height — this is what makes trail-braking work
    ClA: 1.35, CdA: 0.92, rho: 1.225,
    aeroBal: 0.42,
    // ~180 hp from the 1.4 turbo. An F4 car is traction-limited out of slow
    // corners and drag-limited by ~215 km/h, and both of those facts are in
    // these three numbers rather than in a top-speed clamp.
    Pmax: 125e3, Fdrive: 6200,
    Fbrake: 24000, brakeBal: 0.62,
    rollRes: 180,
    // Pitch and roll inertia. A single-seater is long and narrow, so it
    // resists pitching about as much as it resists yawing, and barely resists
    // rolling at all. That ratio is why a launched car barrel-rolls rather
    // than somersaulting — it is the cheapest axis to spin it about.
    Iyy: 480, Ixx: 110,
    trackF: 1.45, trackR: 1.40,
    // The underbody as a wing, for when air gets UNDER the car. An F4 car has
    // a flat floor and no real diffuser and tops out around 215 km/h, so on
    // aerodynamics alone it should never fly at all — and with this number it
    // cannot. An F4 car that gets airborne has been launched by something.
    ClFloor: 3.0,
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
    bodyL: 5.63, bodyW: 2.00,   // real bodywork, for contact — not the wheelbase
    h: 0.30,
    ClA: 4.62, CdA: 1.28, rho: 1.225,
    aeroBal: 0.435,
    Pmax: 580e3, Fdrive: 13800,
    Fbrake: 46000, brakeBal: 0.60,
    rollRes: 260,
    Iyy: 900, Ixx: 165,
    trackF: 1.60, trackR: 1.40,
    // A modern F1 floor is the whole downforce story, and turned over it is the
    // whole lift story. This number sets the takeoff speed, and it was MEASURED
    // rather than picked: at 12.0 the car flew backwards from 203 km/h, and a
    // 22-car race at Monza then flipped FIVE CARS — because a spin at Monza
    // routinely leaves you going backwards above 200. Real single-seaters spin
    // backwards at those speeds most race weekends and stay on the ground; the
    // famous flips need a bump or another car as well. 7.0 puts the bare-aero
    // takeoff at about 265 km/h, which is where it belongs.
    ClFloor: 7.0,
    B: 12.5, C: 1.80, E: 0.70,
    mu: 1.91, wear: 1.0, Topt: 92, Twin: 33,
    drs: true, drsCl: 0.80, drsCd: 0.74,
  },
};

export const SURFACE = { track: 1.0, kerb: 0.93, runoff: 0.58, grass: 0.42 };

// Going off is not just less grip — it is DRAG. A gravel trap exists to stop a
// car, and it works by the wheels ploughing into it; grass is softer but still
// costs far more than tarmac. Modelling the surface only as a friction
// coefficient made a gravel trap a place you could drive across at 200 km/h,
// which is most of why leaving the road felt like nothing happened.
export const SURFACE_DRAG = { 1.0: 1, 0.93: 1.4, 0.58: 9, 0.42: 5 };
export const dragFor = surf => SURFACE_DRAG[surf] ?? 1;
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

// ---------------------------------------------------------------------------
// THE VERTICAL AXIS.
//
// Everything above this line is planar — x, y and heading. That is enough to
// drive a lap, and it is exactly why the car could never do the thing a crash
// is famous for. A car with no third axis cannot be launched over a kerb, ride
// up the back of another car, or land on its roof, so every shunt however hard
// ended with the car still flat on the road, sliding.
//
// THE RULE THAT KEEPS THE VALIDATED MODEL SAFE: while the wheels are down,
// none of this runs. z, pitch and roll are pinned at zero, vertical() returns
// on its third line, and the planar model is bit-for-bit what it was. Lap
// times cannot move, because on a clean lap nothing here executes. The vertical
// system only wakes when something gives the car vertical velocity, and it
// puts itself back to sleep when the car settles.
//
// `z` is height above THE ROAD, not above sea level. The circuits have real
// elevation now, but that belongs to the renderer: from the simulation's point
// of view the road under the car is always zero, which is why this file still
// imports nothing. (Known limit: a car launched off the top of a hill lands at
// the local road height, not at the height of the ground it flew over. At
// Monaco's 56 m of elevation change that is a metre or two on a long flight.)
// ---------------------------------------------------------------------------
const GRAV = 9.81;

// Ground effect dies with height. An F1 floor makes its downforce by sealing
// against the road; lift the car a few centimetres and the seal is gone. This
// single line is why a car that gets light keeps getting lighter instead of
// being pushed back down — the downforce holding it there is the first thing
// the accident takes away.
const groundEffect = z => (z <= 0 ? 1 : Math.exp(-z / 0.22));

// The diffuser rakes upward by design, so a car travelling backwards is a ramp
// facing the wind. This is the number behind every famous single-seater
// backflip, and it is why they all happened above 200 km/h and none below.
const DIFFUSER_RAKE = 0.26;                 // ~15 degrees

// A floor at a small angle is still a floor: it makes downforce. It only turns
// into a lifting plate once the air can get properly underneath it, which takes
// a few degrees. That threshold is not a detail — it is the entire difference
// between a car that can ride a kerb and a car that backflips off one. Without
// it the floor lifted at ANY nose-up angle, the lift pitched the nose up
// further, and a car dropped from half a metre ended upside down.
const FLOOR_STALL = 0.09;                   // ~5 degrees

// Suspension, per corner. Real F1 wheel rates — stiff, lightly damped, and
// almost no travel — which is why these cars land hard and do not wallow.
const SPRING = 160e3;       // N/m
const DAMP = 4500;          // N s/m
const TRAVEL = 0.055;       // m before the chassis is on the deck
const BUMPSTOP = 6e6;       // N/m once it is
const FMAX = 2.2e5;         // N — the most one corner can ever transmit
const RATE_MAX = 11;        // rad/s — a tumbling car, not a blender

const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Wheel contact patches in body-local metres: +x forward, +y left.
export function wheelPos(S) {
  const hf = S.trackF * 0.5, hr = S.trackR * 0.5;
  return [[S.a, hf], [S.a, -hf], [-S.b, hr], [-S.b, -hr]];
}

// Net vertical aero force, positive UP, and where along the floor it acts.
// Where it acts is not a detail: it is the whole difference between lift that
// settles the car and lift that flips it.
function aeroVertical(car, q, v) {
  const S = car.spec;
  const vh = Math.max(v, 0.001);
  const fwd = vh > 1 ? car.vx / vh : 1;     // cos of the angle between nose and travel
  // Wings and a sealed floor push DOWN, and only while the car is pointing
  // roughly where it is going. Sideways, they do almost nothing.
  const down = -q * S.ClA * Math.max(0, fwd) * groundEffect(car.z);

  // The underbody as a flat plate. The angle of attack is the floor's angle to
  // the air actually hitting it: the car's pitch, less the angle at which it
  // is climbing or falling.
  const climb = Math.atan2(car.vz, Math.max(vh, 1));
  let alpha = car.pitch - climb;
  // Backwards, the DIFFUSER is the leading edge and its own rake is the angle
  // of attack — so a perfectly level car going backwards is already sitting at
  // ten degrees before anything else happens.
  if (fwd < 0) alpha = DIFFUSER_RAKE * -fwd - alpha;
  alpha = Math.max(-0.9, Math.min(0.9, alpha));
  // sin(2a): no lift flat on, most at 45 degrees. The standard flat-plate
  // approximation, and the right SHAPE — the car does not fly until the floor
  // is angled into the air, and then it flies very suddenly.
  const excess = Math.abs(alpha) - FLOOR_STALL;
  // A car on its back has its floor facing the SKY, and a floor facing the sky
  // pushes down, not up. Folding the attitude in here is what brings a flipped
  // car back to earth — without it the lift kept pushing an inverted car
  // upward and it simply never landed.
  const upright = Math.cos(car.roll) * Math.cos(car.pitch);
  const lift = excess <= 0 ? 0
    : Math.sign(alpha) * q * S.ClFloor * Math.sin(2 * Math.min(0.9, excess)) * upright;

  // Lift acts at the LEADING edge of the floor, not at the centre of mass, so
  // it lifts whichever end met the air first. That raises the angle of attack,
  // which makes more lift, which raises it further. The runaway is the flip.
  // It is not scripted anywhere; it falls out of putting the force in the
  // right PLACE rather than at the centre of the car.
  const cop = fwd >= 0 ? S.a * 0.62 : -S.b * 0.72;

  // The wings are a long way from the centre of mass, and they are what keeps
  // a car pointing where it is going: nose-up, the rear wing bites harder and
  // the front wing unloads, and the pair push the nose back down. Modelling
  // only the DESTABILISING half of the aerodynamics is what made every small
  // hop turn into a somersault. A real car is pitch-stable right up until it
  // is not.
  const restore = -q * S.ClA * 2.6 * Math.sin(car.pitch) * Math.max(0, fwd);
  return { Fz: down + lift, cop, lift, restore };
}

// One vertical substep. Sets car.gripF / car.gripR — the share of each axle
// actually touching the road, which is what the tyre forces get scaled by.
function vertical(car, dt, env, q, v) {
  const S = car.spec;
  const air = aeroVertical(car, q, v);

  if (!car.airborne) {
    car.gripF = car.gripR = 1;
    // The one test a grounded car pays for: is the air genuinely carrying the
    // car? Below about 200 km/h the answer is never yes, whatever the attitude.
    if (air.Fz <= S.m * GRAV || v < 8) return;
    car.airborne = true; car.airTime = 0; car.vz = 0;
  }

  car.airTime += dt;

  // ---- free body ----------------------------------------------------------
  car.vz += (air.Fz / S.m - GRAV) * dt;
  car.z += car.vz * dt;
  // In the air the only moments are aerodynamic: the floor's lift about its own
  // centre of pressure, and the damping of a body tumbling through air. There
  // is nothing else to hold the car straight, which is the point — once it is
  // off the ground the driver is a passenger.
  car.pRate += ((air.lift * air.cop + air.restore - car.pRate * q * 0.30) / S.Iyy) * dt;
  car.rRate += ((-car.rRate * q * 0.05) / S.Ixx) * dt;
  car.pitch = wrapPi(car.pitch + car.pRate * dt);
  car.roll = wrapPi(car.roll + car.rRate * dt);

  // ---- what is touching the road? -----------------------------------------
  // Normally the wheels. Past ninety degrees it is the rollhoop, and a car on
  // its rollhoop has one contact point, no grip and no way back.
  const inverted = Math.abs(car.roll) > Math.PI / 2 || Math.abs(car.pitch) > Math.PI / 2;
  if (inverted) {
    car.onRoof = true;
    car.gripF = car.gripR = 0;
    const ride = S.h * 0.9;                 // rollhoop height above the CG line
    if (car.z < ride) {
      car.z = ride;
      if (car.vz < 0) car.vz *= -0.05;      // a rollhoop does not bounce
      // Scraping along on carbon: a lot of friction, no steering, no drive.
      const sp = Math.hypot(car.vx, car.vy);
      if (sp > 0.05) {
        const k = Math.max(0, 1 - 0.62 * GRAV * dt / sp);
        car.vx *= k; car.vy *= k;
      }
      car.r *= 1 - Math.min(0.9, 3 * dt);
      car.pRate *= 1 - Math.min(0.9, 4 * dt);
      car.rRate *= 1 - Math.min(0.9, 4 * dt);
    }
    return;
  }
  car.onRoof = false;

  const W = wheelPos(S);
  const sp = Math.sin(car.pitch), sr = Math.sin(car.roll);
  let deepest = 0, downF = 0, downR = 0, nDown = 0;
  for (let i = 0; i < 4; i++) {
    const h = car.z + W[i][0] * sp + W[i][1] * sr;
    car.wheelZ[i] = h;
    if (h < 1e-3) {
      nDown++;
      if (i < 2) downF++; else downR++;
      if (-h > deepest) deepest = -h;
    }
  }

  if (!nDown) car.inContact = false;

  if (nDown) {
    // SPRINGS, NOT IMPULSES.
    //
    // The impulse version could not do the one thing a landing has to do:
    // settle. An impulse only fires while a wheel is PENETRATING, so a car
    // resting on two wheels at an angle had no force on it at all and stayed
    // leaning at 56 degrees forever. A suspension spring is the landing AND the
    // resting state in one, and the restoring moment that rolls a leaning car
    // back down onto four wheels falls straight out of the springs' lever arms
    // rather than having to be written down.
    let Fz = 0, Mp = 0, Mr = 0, peak = 0, hardIdx = 0, deepest = 0;
    for (let i = 0; i < 4; i++) {
      const h = car.wheelZ[i];
      if (h >= 0) continue;
      if (-h > deepest) deepest = -h;
      const lx = W[i][0], ly = W[i][1];
      const vp = car.vz + lx * car.pRate + ly * car.rRate;
      let f = -h * SPRING - vp * DAMP;
      // Suspension travel is only a few centimetres, and past it the floor is
      // on the road. That bump stop is what makes a big landing VIOLENT rather
      // than a soft bounce, and it is where the damage comes from.
      //
      // It only pushes while the car is still coming DOWN. A floor grounding
      // out on tarmac ABSORBS a landing; it does not hand the energy back.
      // Modelling it as a plain spring that pushed on the rebound too returned
      // about 80% of the impact, and a twelve-metre drop came back off the road
      // as a FIVE-HUNDRED-METRE launch.
      if (-h > TRAVEL && vp < 0) f += (-h - TRAVEL) * BUMPSTOP;
      if (f <= 0) continue;                  // a tyre pushes; it never pulls
      // Nothing a wheel can transmit is unbounded. This is the ceiling that
      // stops a deep penetration in one substep turning into a number the
      // integrator cannot survive.
      f = Math.min(f, FMAX);
      Fz += f; Mp += f * lx; Mr += f * ly;
      if (f > peak) { peak = f; hardIdx = i; }
    }

    // Gravity acts at the centre of mass, which sits ABOVE the contact patches.
    // So the further the car leans the more gravity helps it lean, and past the
    // angle where the centre of mass crosses outside the wheels it goes over.
    // These two terms and the springs above are the whole of "does it tip or
    // does it settle" — neither outcome is written down anywhere.
    Mp += S.m * GRAV * S.h * Math.sin(car.pitch);
    Mr += S.m * GRAV * S.h * Math.sin(car.roll);

    car.vz += (Fz / S.m) * dt;
    car.pRate += (Mp / S.Iyy) * dt;
    car.rRate += (Mr / S.Ixx) * dt;
    // Same reason the yaw rate is clamped: an explicit integrator at the limit
    // will happily invent a rotation speed no car has ever had.
    car.pRate = Math.max(-RATE_MAX, Math.min(RATE_MAX, car.pRate));
    car.rRate = Math.max(-RATE_MAX, Math.min(RATE_MAX, car.rRate));
    // Last-ditch: if a wheel is somehow buried, lift the car rather than let
    // the springs try to fix it with a force nothing could survive.
    if (deepest > 0.30) car.z += deepest - 0.30;

    // LANDING DAMAGE, from the speed of the impact and charged ONCE per
    // landing.
    //
    // The first version charged it every substep from the peak spring force,
    // and that was wrong twice over. Wrong once because the peak force is
    // dominated by how stiff I chose to make the bump stop — a modelling
    // decision — while the impact SPEED is a physical fact about the accident.
    // Wrong again because billing it every substep meant a landing that took
    // twenty substeps to absorb was charged twenty times: a two-metre drop, the
    // kind of thing a car does clearing a kerb, destroyed it outright and took
    // both wings off.
    if (!car.inContact) {
      car.inContact = true;
      let worst = 0;
      for (let i = 0; i < 4; i++) {
        if (car.wheelZ[i] >= 0) continue;
        const vp = car.vz + W[i][0] * car.pRate + W[i][1] * car.rRate;
        if (vp < worst) worst = vp;
      }
      car.landV = -worst;
      // Five metres a second is a hard landing off a kerb and costs nothing.
      // Fifteen is a twelve-metre drop and there is no car left.
      if (car.landV > 5) {
        const harm = Math.min(1, Math.pow((car.landV - 5) / 10, 1.5));
        car.damage = Math.min(1, (car.damage || 0) + harm);
        car.crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
        const part = hardIdx < 2 ? 'front' : 'rear';
        car.crush[part] = Math.min(1, car.crush[part] + harm * 1.2);
        car.landHarm = harm;
      }
    }

    // Back to sleep — and the planar model gets the car back in exactly the
    // state it would have had, which is what makes a clean lap unchanged.
    //
    // The `resting` test is not optional: without it the car could never take
    // off at all. On the first substep of a lift-off it has climbed a fraction
    // of a millimetre, all four wheels still read as down, and this test
    // grabbed it and zeroed the vertical velocity it had just earned. Every
    // substep, forever.
    const resting = air.Fz < S.m * GRAV;
    if (resting && nDown === 4 && car.z < 0.02
        && Math.abs(car.vz) < 0.30 && Math.abs(car.pRate) < 0.30 && Math.abs(car.rRate) < 0.30
        && Math.abs(car.pitch) < 0.03 && Math.abs(car.roll) < 0.03) {
      car.airborne = false; car.onRoof = false;
      car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
      car.wheelZ[0] = car.wheelZ[1] = car.wheelZ[2] = car.wheelZ[3] = 0;
      car.gripF = car.gripR = 1;
      return;
    }
  }

  car.gripF = downF / 2;
  car.gripR = downR / 2;
}

// Give the car a vertical kick. The one entry point collide.js uses to launch
// a car, so that every launch in the game goes through the same impulse and
// there is no second, sneakier way to make a car fly.
export function launch(car, jz, lx = 0, ly = 0) {
  const S = car.spec;
  car.airborne = true;
  car.vz += jz / S.m;
  car.pRate += (jz * lx) / S.Iyy;
  car.rRate += (jz * ly) / S.Ixx;
  if (car.z < 0.001) car.z = 0.001;
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
    // ---- the vertical axis. All zero while the car is driving, which is what
    // keeps the planar model below bit-for-bit what it was.
    z: 0, vz: 0,                  // height above the road, and its rate
    pitch: 0, roll: 0,            // real attitude now, not a render flourish
    pRate: 0, rRate: 0,
    airborne: false, airTime: 0, onRoof: false,
    inContact: false, landV: 0,   // impact speed of the landing in progress
    wheelZ: [0, 0, 0, 0],         // per-wheel height; negative = compressed
    gripF: 1, gripR: 1,           // share of each axle actually on the road
    dents: [], lost: null,
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
  let clA = S.ClA, cdA = S.CdA, balF = S.aeroBal;
  if (car.drsOpen && S.drs) { clA *= S.drsCl; cdA *= S.drsCd; }
  // Bodywork that has left the car does not make downforce. The front wing is
  // about a third of the total and ALL of it is on the front axle, so losing it
  // is not a scratch — the car understeers off the road at the next corner.
  // Losing the rear wing does the opposite and spins it. This is what makes a
  // first-lap clash cost you the race rather than cost you some paint.
  if (car.lost) {
    if (car.lost.frontWing) { clA *= 0.72; balF *= 0.44; cdA *= 0.93; }
    if (car.lost.rearWing) { clA *= 0.60; balF = Math.min(0.88, balF * 2.0); cdA *= 0.88; }
  }
  const dirty = env.dirty ?? car.dirty ?? 0;
  const tow = env.tow ?? car.tow ?? 0;
  // The floor only makes downforce while it is sealed against the road. On the
  // ground groundEffect() is exactly 1 and nothing below changes.
  const ge = groundEffect(car.z);
  // Following another car guts your FRONT wing first -> understeer. That is
  // the real reason overtaking is hard, and it is why the effect is asymmetric.
  const DFf = q * clA * balF * (1 - 0.40 * dirty) * ge;
  const DFr = q * clA * (1 - balF) * (1 - 0.12 * dirty) * ge;
  // Rolling resistance scales with what the wheels are ploughing through.
  // A car at seventy degrees nose-up is a barn door, and its drag is nothing
  // like its drag in a straight line. Without this the floor's lift held a
  // launched car in the air for FIVE SECONDS like a kite, and lowering the
  // launch impulse made it fly higher rather than lower — the giveaway that
  // the flight was being sustained by aerodynamics rather than by the launch.
  // The same angle that makes the lift has to make the drag.
  const broadside = car.airborne
    ? Math.abs(Math.sin(car.pitch)) + 0.4 * Math.abs(Math.sin(car.roll)) : 0;
  const drag = q * (cdA * (1 - 0.40 * tow) + S.ClFloor * 0.55 * broadside)
             + S.rollRes * (env.rollMul ?? 1);

  // ---- the vertical axis --------------------------------------------------
  // Sets car.gripF / car.gripR. While the wheels are down this returns almost
  // immediately and leaves both at 1, so everything below is untouched.
  vertical(car, dt, env, q, v);

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

  // A wheel in the air carries no load, so it makes no force: no grip, no
  // brakes, no drive and no steering. Scaling per AXLE rather than for the
  // whole car is what makes a nose-up launch take your steering away while you
  // still have drive, and a nose-down one the other way round.
  if (car.gripF < 1 || car.gripR < 1) {
    Fyf *= car.gripF; FxF *= car.gripF;
    Fyr *= car.gripR; FxR *= car.gripR;
  }

  // ---- banking ------------------------------------------------------------
  let bankF = 0;
  if (env.bank && !car.airborne) {
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
  if (v < 3 && !car.airborne) car.r *= 1 - Math.min(0.9, 4 * dt);

  // A spun car still has ground speed. Clamp forward velocity at zero but do
  // NOT bleed the lateral component — doing that destroys all the car's energy
  // in about 0.05 s and reads as an instant stop from 120 km/h.
  // ...but a car that is FLYING may absolutely be going backwards, and clamping
  // that was the difference between a spin and a backflip.
  // A spun car still has ground speed. Clamp forward velocity at zero but do
  // NOT bleed the lateral component — doing that destroys all the car's energy
  // in about 0.05 s and reads as an instant stop from 120 km/h.
  //
  // ...but ONLY at low speed. The bicycle model's slip angles need vx >= 0 to
  // stay sane: a slow car rolling backwards produces tyre forces that point the
  // wrong way and wander it off the road (measured, with the clamp removed
  // outright: 17.7 s and 90 m off at Zandvoort). Above ~120 km/h that regime is
  // nowhere near — and a car that has been spun round at speed genuinely IS
  // travelling backwards, which is the entire mechanism behind a backflip. The
  // clamp must not be the thing that makes flying impossible, so it stops
  // applying exactly where it stops being needed.
  if (car.vx < 0 && !car.airborne && Math.hypot(car.vx, car.vy) < 33) car.vx = 0;
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
  // WHAT AN ACCELEROMETER READS, not the integration term.
  //
  // car.ax/car.ay are body-frame derivatives — `Fy/m - vx*r` — which is the
  // rate of change of lateral velocity. In a steady corner that is ~ZERO no
  // matter how hard the car is going round, because the centripetal term has
  // already been subtracted out. Printing it as G LAT meant the readout sat
  // near zero exactly when the car was loaded hardest and spiked on
  // transitions: measured over a clean Monza lap it averaged 0.11 g while the
  // car was really pulling 0.72 g, peaking at 3.2.
  //
  // The force over the mass is the honest number, and it is what a driver
  // feels. Do NOT redefine car.ax/car.ay to match — those are integrated into
  // the velocities and are correct as they are.
  car.gLat = Fy / (S.m * g); car.gLong = Fx / (S.m * g);
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
