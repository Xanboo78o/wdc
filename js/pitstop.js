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
// ---- THE GARAGES --------------------------------------------------------------
// One layout, used by BOTH the race (where a car stops) and the renderer (where
// js/pit.js draws the garages and the crews). They were two layouts: pit.js
// drew up to eleven garages in a block in the middle of the lane, and the race
// stopped 22 cars at 22 evenly spread points over the middle half of it — so
// a car stopped wherever its grid slot fell, rarely at its own garage, and
// YOU (no team) in front of nobody's. Now each team has a garage, its two cars
// stop at its two marks, and you have a garage of your own: the spare one.
export const BOX_PITCH = 14.4;      // metres of lane per garage
export const MAX_BOXES = 12;        // eleven teams (2026) and a spare for you
const MARK = 3.6;                   // a teammate's mark, either side of centre
export const BOX_SIDE = 3.3;               // metres from the fast lane's line to the box, garage side

// The lane polyline resampled to 2 m and lightly smoothed (pit.js draws on it).
export function resampleLane(pts, step = 2) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    for (let d = carry; d < len; d += step) {
      const f = d / len;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
  out.push(pts[pts.length - 1].slice());
  // three passes of a 1-2-1 kernel: enough to take the corners off the joins
  // without pulling the lane away from where it was surveyed.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < out.length - 1; i++) {
      out[i] = [
        (out[i - 1][0] + 2 * out[i][0] + out[i + 1][0]) / 4,
        (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4,
      ];
    }
  }
  return out;
}

// Garages sit in the middle of the lane: its ends are the entry and exit
// tapers and nothing is parked on them. `s[k]` is garage k's centre as
// distance along the lap, for the race.
export function garageLayout(track) {
  const pit = track.pit;
  if (!pit || !pit.pts || pit.pts.length < 3) return null;
  const P = resampleLane(pit.pts, 2);
  const usable = (P.length - 1) * 2;
  const n = Math.max(3, Math.min(MAX_BOXES, Math.floor((usable - 120) / BOX_PITCH)));
  const startM = Math.max(30, (usable - n * BOX_PITCH) / 2);
  const idxAt = m => Math.max(0, Math.min(P.length - 1, Math.round(m / 2)));
  const s = [];
  if (track.project) for (let k = 0; k < n; k++) {
    const q = P[idxAt(startM + (k + 0.5) * BOX_PITCH)];
    s.push(track.project(q[0], q[1]).s);
  }
  return { P, n, startM, idxAt, s };
}

export function makeLane(track, boxes = 22) {
  const p = track.pit || {};
  const entryS = p.entryS ?? 0;
  const exitS = p.exitS ?? 0;
  // `pit.offset` is signed metres, derived from the geometry rather than read
  // out of the track file — which is the number you want, because `pit.side`
  // was wrong on three circuits out of five.
  const off = p.offset ?? 0;
  const len = track.gap ? Math.abs(track.gap(exitS, entryS)) : Math.abs(exitS - entryS);
  const G = garageLayout(track);
  return {
    entryS, exitS, off, len,
    garages: G && G.s.length ? G.n : 0,
    // Where each car stops: box = garage * 2 + mark (js/race.js assigns them).
    // A lane too short for the garage layout falls back to an even spread.
    boxS(i) {
      if (G && G.s.length) {
        const g = Math.floor(i / 2) % G.n, j = i % 2;
        return ((G.s[g] + (j - 0.5) * 2 * MARK) % track.length + track.length) % track.length;
      }
      return this.spreadS(i);
    },
    // The old even spread: boxes fill the middle of the lane, leaving room to
    // slow down at one end and get going again at the other.
    spreadS(i) {
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
export function laneLat(lane, prog) {
  const IN = 0.10, OUT = 0.88;
  const ease = t => t * t * (3 - 2 * t);
  if (prog < IN) return lane.off * ease(Math.max(0, prog) / IN);
  if (prog > OUT) return lane.off * ease(Math.max(0, (1 - prog) / (1 - OUT)));
  return lane.off;
}

// How far along the lane a car is, 0 at entry and 1 at exit. Wraps, because a
// pit lane can and does straddle the start/finish line.
export function laneProgress(track, lane, s) {
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
  // car.hdg is never wrapped: it winds up over the laps (-10.9 rad after a
  // few at Monza), and JavaScript's % keeps the sign of a negative number, so
  // the old ((x + 3pi) % 2pi) - pi read a 0.05 rad error as -6.2 and the car
  // went to full lock against it — the lane swerves of every stop since.
  const dh = car.hdg - proj.hdg;
  const head = Math.atan2(Math.sin(dh), Math.cos(dh));
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
export function updateStop(e, track, lane, proj, dt, peak = 0.13, others = null) {
  const car = e.car;
  if (!e.pitPhase) e.pitPhase = 'none';
  // A car a few metres BEFORE the entry line is at a small negative progress,
  // not at 5.7 lane-lengths: read as that, the box was "behind" it and the
  // lane controller stopped it dead on the entry line (Monaco, where the
  // approach is slow enough to be caught there).
  let prog = laneProgress(track, lane, proj.s);
  const lapP = track.length / Math.max(1, lane.len);
  if (prog > 1 + (lapP - 1) / 2) prog -= lapP;

  switch (e.pitPhase) {
    case 'none': {
      if (!e.pitRequest) return false;
      // PIT ENTRY CLOSED (js/safetycar.js, an incident at the entry while the
      // safety car is being deployed). A car already committed goes on in.
      if (lane.closed) return false;
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
      // YOUR braking for the entry is yours (the rules, 2026-09-30): the
      // limiter engages at the line, and a car that crosses it too fast is
      // reported for speeding in the pit lane (js/safetycar.js pitEntry).
      const aim = PIT_SPEED * 0.94;
      const want = to > 500 ? Infinity : Math.sqrt(aim * aim + 2 * ENTRY_DECEL * to);
      // It may only ADD braking. Replacing the driver's pedal with this gentle
      // curve took away the braking for Suzuka's final chicane, which sits
      // right before the entry, and the car spun into the wall there.
      if (!e.isPlayer && car.vx > want) { car.brake = Math.max(car.brake, Math.min(1, (car.vx - want) * 0.35)); car.throttle = 0; }
      // `penIn`: the penalties already given as it enters. One handed out on
      // the way in (speeding at the line) is the stewards' decision of a
      // minute later in life, and is served at the NEXT stop.
      if (to < 4 || (prog >= 0 && prog < 0.10)) { e.pitPhase = 'lane'; e.inPit = true; e.entryV = car.vx; e.penIn = e.penalty; }
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
      // A DRIVE-THROUGH is the lane at the limiter and out again, no stop.
      // It is not served under a red flag (the lane is a car park then).
      if (e.driveThru > 0 && !lane.hold) {
        drive(car, proj, laneLat(lane, prog), PIT_SPEED, peak);
        if (toBox < -8) {
          e.driveThru--; e.pitRequest = false; e.pitPhase = 'exit';
          e.pitJobs = ['DRIVE-THROUGH'];
          return true;
        }
        return false;
      }
      const v = toBox < 12 ? Math.max(0, PIT_SPEED * (toBox / 12)) : PIT_SPEED;
      // THE BOX IS BESIDE THE FAST LANE, NOT ON IT. Every car used to stop on
      // the lane's one driving line, which nobody noticed while a stop lasted
      // 2.4 s — and which blocked the lane solid the first time cars PARKED
      // (the cool-down lap: 3 of 8 home, the rest queued behind them). Over
      // the last 28 m the car pulls over to the garage side.
      const pull = Math.max(0, Math.min(1, (28 - toBox) / 20));
      drive(car, proj, laneLat(lane, prog) + BOX_SIDE * (Math.sign(lane.off) || 1) * pull, v, peak);
      if (toBox < 1.2 && car.speed < 0.6) {
        e.pitPhase = 'service';
        const svc = serviceFor(car);
        e.pitTimer = svc.time;
        e.pitJobs = svc.jobs;
        // A TIME PENALTY is served here: the car stands for it before anybody
        // may touch it. Never under a red flag.
        const serve = Math.min(e.penalty, e.penIn ?? e.penalty);
        if (serve > 0 && !lane.hold) {
          e.pitTimer += serve;
          e.pitJobs = [`${serve}s PENALTY`, ...svc.jobs];
          e.penServed = (e.penServed || 0) + serve;
          e.penalty -= serve;
        }
      }
      return false;
    }
    case 'service': {
      e.inPit = true;
      car.throttle = 0; car.brake = 1; car.delta = 0;
      e.pitTimer -= dt;
      if (e.pitTimer > 0) return false;
      // RED FLAG: the car waits in its box, and the work is free.
      if (lane.hold) {
        if (!e.redFixed) { repair(car, ['nose', 'floor', 'tyres']); e.redFixed = true; }
        e.pitTimer = 0;
        return false;
      }
      e.redFixed = false;
      // THE RELEASE. The lollipop waits for a car coming down the fast lane
      // within 25 m — except when it does not (1 time in 25), which is an
      // UNSAFE RELEASE and the stewards' business (js/safetycar.js).
      if (others) {
        const me = laneProgress(track, lane, proj.s) * lane.len;
        const near = others.some(o => o !== e && o.inPit && (o.pitPhase === 'lane' || o.pitPhase === 'exit')
          && o.car.speed > 4 && me - laneProgress(track, lane, o.proj.s) * lane.len > 0
          && me - laneProgress(track, lane, o.proj.s) * lane.len < 25);
        if (near) {
          const r = e.relRoll ?? (e.relRoll = (Math.sin(e.idx * 91.7 + (e.pitStops || 0) * 13.1) * 43758.5453) % 1);
          if (Math.abs(r) > 0.04) return false;         // held: the crew waits
          e.unsafe = true;
        }
      }
      e.relRoll = undefined;
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
