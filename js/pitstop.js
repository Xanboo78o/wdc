// pitstop.js — the pit lane as a RULE SET, not as scenery.
//
// NOTHING IN THIS FILE MAY IMPORT A RENDERER. js/pit.js draws the garages and
// the crew and imports three; this decides what a car in the lane may do, and
// runs unchanged in a Node harness.
//
// The car is DRIVEN down the lane, not teleported along it. A controller aims
// at the lane centre and holds the limiter, using the same delta/throttle/brake
// the driver uses — so a car in the pits still has grip, can still be hit by
// another car in the pit lane, still has its damage, and can still get it
// wrong. A scripted corridor would have been fifty lines shorter and would
// have made the one place where a race is won or lost the one place the
// simulation stops.
//
// WHY THIS EXISTS AT ALL: the aero map made losing a front wing a real
// handling change — 56% of the front downforce, balance from 44% front to 22%
// — and the autopilot learned to drive around it. But nothing could ever FIX
// it, so a first-lap wing tap was a race-ending injury with no treatment. This
// is the treatment.

export const PIT_SPEED = 80 / 3.6;        // the F1 limiter, in m/s
// Deceleration for the approach. Deliberately well under what the car can do:
// braking at the limit into a pit entry is how you miss it.
// Measured across all five circuits: at 16 the car arrived legal at four of
// them and crossed Zandvoort's line at 98 km/h, because that entry follows a
// fast banked corner and leaves less room. Braking earlier costs nothing —
// the approach is already a lost lap — and it is what makes the number hold
// on every circuit rather than on most of them.
const ENTRY_DECEL = 10;                   // m/s^2

// What is actually being fixed decides how long you stand still. A nose change
// is the expensive one, and that asymmetry is the whole point: it is why you
// weigh limping to the end of the lap against losing eleven seconds now.
export const SERVICE = { tyres: 2.4, nose: 11.5, floor: 7.5 };

// ---------------------------------------------------------------------------
// The lane.
// ---------------------------------------------------------------------------
export function makeLane(track, boxes = 22) {
  const p = track.pit || {};
  const entryS = p.entryS ?? 0;
  const exitS = p.exitS ?? 0;
  // `pit.offset` is signed metres, derived from the geometry rather than read
  // out of the track file — which is the number you want, because `pit.side`
  // was wrong on three circuits out of five.
  const off = p.offset ?? 0;
  const len = track.gap ? Math.abs(track.gap(exitS, entryS)) : Math.abs(exitS - entryS);
  return {
    entryS, exitS, off, len,
    // Where each car stops. Boxes fill the middle of the lane, leaving room to
    // slow down at one end and get going again at the other.
    boxS(i) {
      const t = boxes > 1 ? i / (boxes - 1) : 0.5;
      const from = 0.22 * len, to = 0.78 * len;
      const d = from + (to - from) * t;
      return ((entryS + d) % track.length + track.length) % track.length;
    },
  };
}

// Where the lane centre is, as a lateral offset, at this point along it.
//
// A pit lane is a PATH that peels away from the circuit and rejoins it, not a
// constant offset. Treating it as a constant meant the car had to move 17.3 m
// sideways the instant it crossed the entry line, which it cannot do at speed
// — it slewed across the track and ended up 49.7 m off the centreline, out in
// the scenery. Ramping in and out over the first and last stretch is what the
// geometry actually does.
function laneLat(lane, prog) {
  const IN = 0.10, OUT = 0.88;
  const ease = t => t * t * (3 - 2 * t);
  if (prog < IN) return lane.off * ease(Math.max(0, prog) / IN);
  if (prog > OUT) return lane.off * ease(Math.max(0, (1 - prog) / (1 - OUT)));
  return lane.off;
}

// How far along the lane a car is, 0 at entry and 1 at exit. Wraps, because a
// pit lane can and does straddle the start/finish line.
function laneProgress(track, lane, s) {
  const L = track.length;
  const d = ((s - lane.entryS) % L + L) % L;
  return lane.len > 0 ? d / lane.len : 1;
}

// ---------------------------------------------------------------------------
// Should this car come in? Racecraft, not a rule — so it is a suggestion the
// driver is free to ignore, and the race layer never sets it.
// ---------------------------------------------------------------------------
export function shouldPit(car) {
  if (!car) return false;
  if (car.lost && (car.lost.frontWing || car.lost.rearWing)) return true;
  return (car.damage || 0) > 0.55;
}

// What a stop would actually do, and therefore how long it takes.
export function serviceFor(car) {
  const jobs = [];
  let t = SERVICE.tyres;
  if (car.lost && (car.lost.frontWing || car.lost.rearWing)) { jobs.push('nose'); t = Math.max(t, SERVICE.nose); }
  else if ((car.damage || 0) > 0.35) { jobs.push('floor'); t = Math.max(t, SERVICE.floor); }
  jobs.push('tyres');
  return { jobs, time: t };
}

// ---------------------------------------------------------------------------
// The controller. Aims at a lateral offset and a speed; returns nothing and
// writes the three driver inputs, because that is what the physics reads.
// ---------------------------------------------------------------------------
function drive(car, proj, targetLat, targetV, peak) {
  // Cross-track error and heading error, the two terms any lane-follower needs.
  const err = targetLat - proj.lat;
  const head = ((car.hdg - proj.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  // Clamped to the front tyre's usable slip: a pit lane is walking pace and
  // there is never a reason to ask the front for more than it has.
  const want = Math.max(-peak, Math.min(peak, err * 0.10 - head * 1.35));
  // The rack is not a servo. Same 6 rad/s slew the driver model uses, or the
  // car saws its way down the lane.
  const slew = 6 * (1 / 120);
  car.delta += Math.max(-slew, Math.min(slew, want - car.delta));

  const dv = targetV - car.vx;
  if (dv > 0.4) { car.throttle = Math.min(1, dv * 0.35); car.brake = 0; }
  else if (dv < -0.4) { car.throttle = 0; car.brake = Math.min(1, -dv * 0.30); }
  else { car.throttle = 0; car.brake = targetV < 0.2 ? 1 : 0; }

  // THE LIMITER. A real one is a device on the car: the engine will not let
  // you exceed the speed however hard you press, which is why nobody in F1
  // crosses the line at 92 km/h and hopes. Without it the approach braking had
  // to be perfect, and it was not — the car arrived 15% over every time.
  if (car.vx > PIT_SPEED) {
    car.throttle = 0;
    car.brake = Math.max(car.brake, Math.min(1, (car.vx - PIT_SPEED) * 0.50));
  }
}

// ---------------------------------------------------------------------------
// One car's stop. `e` is a race entry: it owns pitRequest / inPit / pitTimer /
// pitStops, which the race layer already carries and nothing else sets.
// ---------------------------------------------------------------------------
export function updateStop(e, track, lane, proj, dt, peak = 0.13) {
  const car = e.car;
  if (!e.pitPhase) e.pitPhase = 'none';
  const prog = laneProgress(track, lane, proj.s);

  switch (e.pitPhase) {
    case 'none': {
      if (!e.pitRequest) return false;
      // Only commit if the entry is genuinely ahead — asking to pit halfway
      // down the lane's length means you serve it NEXT lap, which is what
      // happens in life and stops a car turning across the track to get in.
      // Commit far enough out to be able to slow down gently: from 300 km/h at
      // ENTRY_DECEL that is about 290 m, so 620 leaves real margin.
      const to = track.wrap(lane.entryS - proj.s);
      if (to > 620) return false;
      e.pitPhase = 'approach';
      return false;
    }
    case 'approach': {
      // Brake BEFORE the entry line, the way the rules require and the way it
      // actually works: you must already be under the limit when you cross it.
      // Only the pedals are touched here — the autopilot keeps steering, so
      // the car stays on the racing line until it genuinely peels off.
      // A PHYSICAL braking curve, not a linear ramp. To arrive at the limit
      // after `to` metres you may currently be doing sqrt(v_limit^2 + 2*a*to).
      // The linear version asked for 80 km/h only in the last 25 m, which no
      // car can do from 180, and the entry was crossed at 130.
      const to = track.wrap(lane.entryS - proj.s);
      // Aim a little UNDER the limit, so the limiter has nothing to catch and
      // the car is already legal as it crosses rather than a moment after.
      const aim = PIT_SPEED * 0.94;
      const want = to > 500 ? Infinity : Math.sqrt(aim * aim + 2 * ENTRY_DECEL * to);
      if (car.vx > want) { car.brake = Math.min(1, (car.vx - want) * 0.35); car.throttle = 0; }
      if (to < 4 || (prog >= 0 && prog < 0.10)) { e.pitPhase = 'lane'; e.inPit = true; }
      return false;
    }
    case 'lane': {
      e.inPit = true;
      const boxAt = laneProgress(track, lane, lane.boxS(e.box ?? e.i ?? 0));
      void boxAt;
      // Ease onto the limiter, then to a stop on the box. Braking early enough
      // that the crew is not jumped is the driver's problem in life and this
      // controller's problem here.
      const toBox = (laneProgress(track, lane, lane.boxS(e.box ?? e.i ?? 0)) - prog) * lane.len;
      const v = toBox < 12 ? Math.max(0, PIT_SPEED * (toBox / 12)) : PIT_SPEED;
      drive(car, proj, laneLat(lane, prog), v, peak);
      if (toBox < 1.2 && car.speed < 0.6) {
        e.pitPhase = 'service';
        const svc = serviceFor(car);
        e.pitTimer = svc.time;
        e.pitJobs = svc.jobs;
      }
      return false;
    }
    case 'service': {
      e.inPit = true;
      car.throttle = 0; car.brake = 1; car.delta = 0;
      e.pitTimer -= dt;
      if (e.pitTimer > 0) return false;
      repair(car, e.pitJobs);
      e.pitStops = (e.pitStops || 0) + 1;
      e.pitRequest = false;
      e.pitPhase = 'exit';
      return true;                       // served, this frame
    }
    case 'exit': {
      e.inPit = true;
      drive(car, proj, laneLat(lane, prog), PIT_SPEED, peak);
      if (prog > 0.985 || prog < 0.05) {
        // Back on the road, and the race layer starts treating it as a racing
        // car again the moment this clears.
        e.inPit = false;
        e.pitPhase = 'none';
      }
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// What a stop actually fixes.
// ---------------------------------------------------------------------------
export function repair(car, jobs = []) {
  const did = new Set(jobs);
  if (did.has('nose')) {
    // The thing that matters most, and the reason the other session asked for
    // it: autopilot.js re-solves its speed profile at 0.78x grip the moment
    // car.lost.frontWing appears, and NOTHING ever took it away. A car that
    // pitted for a new nose and then drove the rest of the race at wingless
    // pace had paid for the damage twice.
    if (car.lost) { car.lost.frontWing = false; car.lost.rearWing = false; }
    car.crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
    car.crush.front = 0;
    // The dents in the nose go with the nose. The ones down the side do not:
    // a pit stop is a nose change and four tyres, not a rebuild.
    if (car.dents) car.dents = car.dents.filter(d => d.lx < car.spec.bodyL * 0.22);
    car.damage = Math.max(0, (car.damage || 0) - 0.55);
  }
  if (did.has('floor')) car.damage = Math.max(0, (car.damage || 0) - 0.25);
  if (did.has('tyres')) {
    const t = car.tyre;
    if (t) { t.wf = 0; t.wr = 0; t.age = 0; t.Tf = 80; t.Tr = 80; }
  }
  return car;
}
