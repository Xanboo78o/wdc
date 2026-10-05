// safetycar.js — race control. The safety car, the virtual one, the red flag,
// the restarts, the yellows and the blues: the part of a Grand Prix that is
// decided in a room above the pit lane rather than on the circuit.
//
// Adam, 2026-09-30: "safety cars, pitting, restarts and all those rules".
//
// NOTHING IN THIS FILE MAY IMPORT A RENDERER. It runs inside js/race.js in
// plain Node (tools/rulescheck.mjs forces every situation below and asserts
// what the rulebook says must follow). js/scview.js draws the car.
//
// What it decides, in the FIA's own order of severity:
//
//   YELLOW / DOUBLE YELLOW  per marshal sector (one every ~300 m) around an
//                           incident: no overtaking there, slow down.
//   VSC                     every car must stay ABOVE a minimum time — a
//                           ghost running the racing line at VSC_F of its
//                           speed. The margin is the delta (e.vd, metres; the
//                           HUD shows it in seconds). "VSC ENDING", then green.
//   SAFETY CAR              a real car, out of the pit exit ahead of the
//                           leader. The field catches it under the SC delta,
//                           queues within ten car lengths, may pit (the cheap
//                           stop), lapped cars unlap on the call, "SAFETY CAR
//                           IN THIS LAP", the car peels into the pit entry and
//                           the LEADER sets the restart. No overtaking before
//                           the control line.
//   RED FLAG                everyone slowly into the pit lane, parked in the
//                           box, free tyres and repairs, then a standing
//                           restart on the grid in the red-flag order.
//
// And for YOU only, because only a human can break them: overtaking under any
// of the above (give it back or be penalised), the minimum delta, ignoring
// three blue flags, speeding at the pit entry, an unsafe release by your crew.
// Bots obey the rules by construction and are checked, not trusted:
// tools/rulescheck.mjs watches every pair of cars under the safety car.
import { makeCar, wetGrip } from './physics.js';
import { laneLat, laneProgress, PIT_SPEED } from './pitstop.js';

// ---- the numbers ------------------------------------------------------------
// The safety car laps at SC_F of the racing line's speed, never above SC_CAP
// (an AMG GT on slicks tops out near 200 km/h down Monza's straight when it
// is leading a queue). A car still catching the queue must stay above the SC
// delta, DELTA_F of the line; under the VSC it is VSC_F — about 40% slower
// than a racing lap.
export const SC_F = 0.60, SC_CAP = 55;
export const DELTA_F = 0.76, VSC_F = 0.70;
const SECTOR = 300;               // m between marshal posts
const PICKUP_MIN = 25;            // s the SC leads at least, once it has the leader
const QUEUE_GAP = 75;             // m: closer than this to the car ahead = in the queue
const QUEUE_WAIT = 75;            // s: after this the SC stops waiting for stragglers
const VSC_MIN = 16, VSC_END = 10; // s: the VSC's minimum, and the ENDING window
const RED_HOLD = 22, RED_WAIT = 240;
const CRANE = 38;                 // s to lift a retired car clear
// THE RECOVERY (Adam, 2026-10-05: the safety car "leading 3 laps while safety
// crews remove his car"). A truck comes through a gap in the barrier TRUCK_BACK
// m up the road from the wreck, drives to it, hooks it up and drags it back
// behind the barrier. The incident is not clear until it has.
const TRUCK_BACK = 55, TRUCK_V = 8, TOW_V = 5, HOOK_T = 10, TRUCK_AFTER = 6;
// How many laps a safety car period lasts, on the leader's lap count: three in
// a Grand Prix, fewer in a short race, where three laps would be most of it.
const RESTART_ZIP = 45;           // s after a safety-car restart that braking zones stay single file
const scLapsFor = laps => laps >= 20 ? 3 : laps >= 10 ? 2 : 1;
const RANK = { green: 0, vsc: 1, vscEnd: 1, sc: 2, red: 3 };
// How long you have to hand a place back before the stewards decide.
const GIVE_BACK = 12;
// Penalties, as the stewards hand them out in 2024-26.
const PEN = {
  sc: { dt: true, why: 'OVERTAKING UNDER SAFETY CAR' },
  vsc: { sec: 10, why: 'OVERTAKING UNDER VIRTUAL SAFETY CAR' },
  red: { sec: 10, why: 'OVERTAKING UNDER RED FLAG' },
  restart: { sec: 10, why: 'OVERTAKING BEFORE THE CONTROL LINE' },
  yellow: { sec: 5, why: 'OVERTAKING UNDER YELLOW FLAGS' },
  delta: { sec: 5, why: 'FAILING TO RESPECT THE MINIMUM TIME' },
  blue: { sec: 5, why: 'IGNORING BLUE FLAGS' },
  speeding: { sec: 5, why: 'SPEEDING IN THE PIT LANE' },
  unsafe: { sec: 5, why: 'UNSAFE RELEASE' },
};

export class Director {
  constructor(race, { on = true, rng = Math.random } = {}) {
    this.race = race; this.on = !!on; this.rng = rng;
    this.mode = 'green'; this.phase = null; this.since = 0; this.phaseAt = 0;
    this.incidents = [];
    this.yellow = new Map();           // marshal sector -> { lvl, until }
    this.count = { sc: 0, vsc: 0, red: 0, restarts: 0, pens: 0, pitsUnder: 0 };
    this.drsFrom = 0;                  // DRS closed until the leader starts this lap
    this.greenAt = -99;
    this.hist = [];                    // { mode, t0, t1 } — what the harness reads
    const t = race.track;
    this.nSec = Math.max(4, Math.round(t.length / SECTOR));
    this.secLen = t.length / this.nSec;
    const lane = race.lane;
    this.hasPit = !!(lane && lane.len > 60 && !t.open);
    // The safety car is a car: a GT body with a physics record, so contact
    // with it is real (race.js carContact) — but it is driven kinematically,
    // along the racing line, because it has one job and no tyres to manage.
    this.sc = { car: makeCar({ cls: 'gt3' }), s: 0, lat: 0, i: 0, v: 0, out: false,
                lights: false, inLane: false, prog: 0 };
    this.sub = 0;
    this.wet0 = null; this.rainRed = false;
    // What js/scview.js draws besides the safety car, and the jobs behind it.
    this.vehicles = []; this.jobs = [];
    this.scLaps = scLapsFor(race.laps); this.scFrom = 0;
  }

  // ---- what everyone else asks ----------------------------------------------
  get neutral() { return this.mode !== 'green'; }
  sector(s) { const t = this.race.track; return Math.floor(t.wrap(s) / this.secLen) % this.nSec; }
  yellowAt(s) {
    const y = this.yellow.get(this.sector(s));
    return y && y.until > this.race.time ? y.lvl : 0;
  }
  vLine(i) { return this.race.lines.race.v[i] || 30; }
  scSpeed(i) { return Math.min(this.vLine(i) * SC_F, SC_CAP); }
  leader() {
    for (const e of this.race.standings || this.race.entries) if (!e.retired && !e.finished) return e;
    return null;
  }
  tag(e) { return e.isPlayer ? `CAR ${e.num} (YOU)` : `CAR ${e.num} (${e.name.slice(0, 3)})`; }
  rc(text, code, e = null) { this.race.log('rc', text, e, code); }

  // The flag YOU are looking at, for the HUD and the dash.
  flagFor(e) {
    const r = this.race;
    if (!e) return null;
    if (r.state === 'finish' || r.state === 'over') return 'chequered';
    if (this.mode === 'red') return 'red';
    if (this.mode === 'sc') return 'sc';
    if (this.mode === 'vsc') return 'vsc';
    if (this.mode === 'vscEnd') return 'vscEnd';
    const y = this.yellowAt(e.proj.s) || this.yellowAt(e.proj.s + 150);
    if (y === 2) return 'dyellow';
    if (y === 1) return 'yellow';
    if (e.blue) return 'blue';
    if (r.time - this.greenAt < 6) return 'green';
    return null;
  }
  // The delta a car is showing, in seconds: + is legal (slower than the
  // minimum), - is too fast. null when no minimum time applies to it.
  deltaFor(e) {
    if (!e || e.inPit || e.retired) return null;
    const f = this.deltaF(e);
    if (!f) return null;
    return -(e.vd || 0) / Math.max(12, this.vLine(e.proj.i) * f);
  }
  deltaF(e) {
    if (this.mode === 'vsc' || this.mode === 'vscEnd') return VSC_F;
    if (this.mode === 'sc' && (this.phase === 'deploy' || this.phase === 'lead') && !e.queued) return DELTA_F;
    return 0;
  }
  // Racecraft asks: may this car attack / defend right now?
  noAttack(e) { return this.on && (this.neutral || this.yellowAt(e.proj.s) > 0 || this.yellowAt(e.proj.s + 150) > 0 || !!e.holdLine); }
  noDefend(e) { return this.on && (this.neutral || !!e.blue); }

  // ---- incidents --------------------------------------------------------------
  // Everything that can neutralise a race comes through here, from race.js.
  incident(kind, e) {
    const r = this.race;
    if (!this.on || r.state !== 'green' || !e || e.finished) return;
    const now = r.time, s = e.proj.s, lat = Math.abs(e.proj.lat), w = e.proj.w;
    const onTrack = lat <= w + 1.0;
    const inc = { kind, e, s, t: now, clearAt: now + 12, onTrack };
    this.incidents.push(inc);
    const where = r.track.cornerAt(s)?.name;
    let want = null, why = '';
    switch (kind) {
      case 'debris': {
        // A wing on the road is a yellow. Two within eight seconds and 500 m
        // of each other is a crash with the circuit covered in carbon.
        inc.clearAt = now + 14;
        this.flag(s, 1, 14);
        const near = this.incidents.filter(x => x.kind === 'debris' && now - x.t < 8
          && Math.abs(r.track.gap(x.s, s)) < 500).length;
        if (near >= 2) { want = 'sc'; why = 'DEBRIS'; }
        break;
      }
      case 'beached':
        // Marshals at the barrier to push it out: double yellow, and a VSC
        // while there are people on the wrong side of it.
        inc.clearAt = now + 10;
        this.flag(s, 2, 14);
        want = lat < w + 9 ? 'vsc' : null; why = 'CAR STOPPED';
        break;
      case 'stopped':
        inc.clearAt = now + 20;
        this.flag(s, 2, 25);
        want = 'sc'; why = 'CAR STOPPED ON TRACK';
        break;
      case 'retired': {
        // A car that is out has to be fetched, wherever it stopped: a truck on
        // the wrong side of the barrier is a safety car (a VSC where there is
        // no pit lane for one to come out of). It used to be nothing at all
        // for a car more than 7 m off the road, which then sat there for the
        // rest of the race. The incident clears when the truck has it away;
        // the time is only the fallback for a wreck that never comes to rest.
        inc.clearAt = now + CRANE * 5;
        this.flag(s, 2, CRANE + 5);
        want = 'sc';
        why = onTrack ? 'CAR STOPPED ON TRACK' : 'RECOVERY VEHICLE ON TRACK';
        this.jobs.push({ e, inc, st: 'wait', t: 0, truck: null });
        const out = this.incidents.filter(x => (x.kind === 'retired' || x.kind === 'roof') && now - x.t < 6).length;
        if (out >= 3) { want = 'red'; why = 'MULTIPLE CAR INCIDENT'; }
        else if (out >= 2 && RANK[want || 'green'] < RANK.sc) { want = 'sc'; why = 'MULTIPLE CAR INCIDENT'; }
        break;
      }
      case 'roof':
        inc.clearAt = now + CRANE * 1.5;
        this.flag(s, 2, CRANE * 1.5);
        want = onTrack ? 'red' : 'sc'; why = 'CAR UPSIDE DOWN';
        this.jobs.push({ e, inc, st: 'wait', t: 0, truck: null });
        break;
      case 'rain':
        inc.clearAt = now + 60;
        want = 'red'; why = 'TRACK CONDITIONS';
        break;
    }
    if (kind !== 'debris' && kind !== 'rain') {
      this.rc(`INCIDENT INVOLVING ${this.tag(e)}${where ? ' AT ' + where.toUpperCase() : ''} NOTED — ${why || 'STOPPED'}`, 'incident', e);
    }
    if (want) this.escalate(want);
  }

  // Yellow in the incident's sector (double if lvl 2) and a single yellow in
  // the one before it, which is where the marshal post that warns you stands.
  flag(s, lvl, secs) {
    const now = this.race.time, k = this.sector(s), prev = (k - 1 + this.nSec) % this.nSec;
    const set = (sec, l) => {
      const y = this.yellow.get(sec);
      const was = y && y.until > now ? y.lvl : 0;
      this.yellow.set(sec, { lvl: Math.max(l, was), until: Math.max(now + secs, y && y.until > now ? y.until : 0) });
      if (l > was && this.mode === 'green') this.rc(`${l === 2 ? 'DOUBLE YELLOW' : 'YELLOW'} IN TRACK SECTOR ${sec + 1}`, l === 2 ? 'dyellow' : 'yellow');
    };
    set(k, lvl);
    set(prev, 1);
  }

  escalate(want) {
    if (!this.hasPit && (want === 'sc' || want === 'red')) want = 'vsc';
    const cur = this.mode;
    if (RANK[want] < RANK[cur]) return;
    if (RANK[want] === RANK[cur] && !(cur === 'vscEnd' && want === 'vsc')) return;
    if (want === 'vsc') this.startVSC();
    else if (want === 'sc') this.startSC();
    else if (want === 'red') this.startRed();
  }

  begin(mode) {
    const now = this.race.time;
    const last = this.hist[this.hist.length - 1];
    if (last && last.t1 == null) last.t1 = now;
    if (mode !== 'green') this.hist.push({ mode, t0: now, t1: null, lap: (this.leader()?.lap ?? 0) + 1 });
    this.mode = mode; this.since = now;
  }

  startVSC() {
    const was = this.mode;
    this.begin('vsc'); this.count.vsc++;
    if (was !== 'vscEnd') this.graceAll();
    this.rc('VIRTUAL SAFETY CAR DEPLOYED', 'vsc');
    this.opportunists(0.7);
  }

  startSC() {
    const r = this.race;
    this.begin('sc'); this.count.sc++;
    this.phase = 'deploy'; this.phaseAt = r.time;
    { const lead = this.leader(); this.scFrom = lead ? r.progress(lead) : 0; }
    this.sc.out = false; this.sc.lights = true; this.unlapCalled = false;
    this.graceAll();
    for (const e of r.entries) { e.queued = false; e.unlap = false; e.rcCross = false; }
    this.rc('SAFETY CAR DEPLOYED', 'sc');
    // An incident at the pit entry closes it until the SC has the leader.
    const lane = r.lane, inc = this.incidents[this.incidents.length - 1];
    if (inc && Math.abs(r.track.gap(inc.s, lane.entryS)) < 350) {
      lane.closed = true;
      this.rc('PIT ENTRY CLOSED', 'pitClosed');
    }
    this.opportunists(1.0);
  }

  startRed() {
    const r = this.race;
    this.begin('red'); this.count.red++;
    this.phase = 'in'; this.phaseAt = r.time; this.parkedAt = null;
    this.sc.out = false; this.sc.lights = false;
    r.lane.hold = true; r.lane.closed = false;
    // The classification is the order at the moment of the red flag.
    this.redOrder = (r.standings || r.entries).filter(e => !e.retired)
      .map(e => ({ e, lap: e.lap, finished: e.finished }));
    for (const e of r.entries) { e.queued = false; e.unlap = false; if (!e.retired && !e.finished) e.pitRequest = true; }
    this.rc('RED FLAG', 'red');
    this.rc('ALL CARS TO THE PIT LANE — PROCEED SLOWLY', 'redPit');
  }

  goGreen(why = 'TRACK CLEAR') {
    const r = this.race, was = this.mode;
    this.phase0 = this.phase;
    this.begin('green'); this.phase = null;
    this.sc.out = false; this.sc.lights = false; this.sc.inLane = false;
    if (r.lane) { r.lane.closed = false; r.lane.hold = false; }
    // NO OVERTAKING BEFORE THE CONTROL LINE: after a safety-car restart each
    // car races from the moment IT crosses the line, not when the leader does.
    const restart = was === 'sc' && this.phase0 === 'restart';
    for (const e of r.entries) {
      e.holdLine = restart && !e.rcCross && !e.retired && !e.finished;
      e.queued = false; e.unlap = false; e.rcCross = false; e.vd = 0;
      // ...and the first corners after it are taken as a start is (race.js, THE OPENING CORNERS).
      if (restart) e.zipUntil = r.time + RESTART_ZIP;
    }
    this.greenAt = r.time;
    if (was === 'sc') {
      const lead = this.leader();
      this.drsFrom = (lead ? lead.lap : 0) + 2;
      this.count.restarts++;
    }
    this.rc(why, 'green');
  }

  // Every car starts its minimum-time delta with a second in hand: nobody can
  // lose 200 km/h in the instant the message goes out.
  graceAll() {
    for (const e of this.race.entries) { e.vd = -Math.max(20, e.car.speed) * 1.0; e.deltaBad = 0; e.deltaWarned = false; }
  }

  // A safety car is the cheapest pit stop of the race: the field is doing
  // 60% of racing speed, the pit lane is still 80 km/h. The strategists know.
  opportunists(p) {
    const r = this.race;
    if (!r.pits) return;
    for (const e of r.entries) {
      if (e.isPlayer || e.retired || e.finished || e.pitRequest || e.inPit) continue;
      const left = r.laps - e.lap;
      if (left < 2) continue;
      const ty = e.car.tyre, wear = ty ? Math.max(ty.wf, ty.wr) : 0;
      const hurt = (e.car.damage || 0) > 0.25 || (e.car.lost && (e.car.lost.frontWing || e.car.lost.rearWing));
      const want = hurt ? 1 : wear > 0.45 ? 0.95 : wear > 0.2 ? 0.7 : wear > 0.08 && left >= 4 ? 0.35 : 0;
      if (this.rng() < want * p) {
        e.pitRequest = true; e.pitUnder = this.mode;
        r.log('flag', `${e.name} WILL PIT`, e);
      }
    }
  }

  // ---- racecraft hooks (bots) ------------------------------------------------
  // Where it wants to be across the road. Lapped cars waved past pull out of
  // the queue to overtake it; a car being lapped moves off the line.
  wantBias(e, want, lineOff, lim) {
    if (!this.on) return want;
    if (e.unlap) {
      if (!e.unlapSide || Math.abs(lineOff) > 1.5) e.unlapSide = lineOff > 0 ? -1 : 1;
      // Closing on the safety car: commit to the side AWAY from it, once. The
      // safety car follows the racing line, so "away from the line" put both
      // on the same side; the lapped car then dived back across and the
      // safety car drifted into it (19 contacts in rulescheck [unlap]).
      const sc = this.sc;
      if (sc.out && !sc.inLane && !e.unlapSc) {
        const g = this.race.track.gap(sc.s, e.proj.s);
        if (g > 0 && g < 160) e.unlapSc = -(Math.sign(sc.lat) || 1);
      }
      return (e.unlapSc || e.unlapSide) * lim - lineOff;
    }
    if (this.neutral) return 0;
    // BLUE: pick the side AWAY from the car lapping you, once, and hold it.
    // It used to be "away from the racing line", and the line crosses the
    // road, so the backmarker swapped sides in front of the leader at every
    // corner — the opposite of letting it by (tools/rulescheck.mjs [blue]).
    if (e.blue && e.blueSide) return e.blueSide * Math.min(3.2, lim) - lineOff;
    // ...and the car lapping it takes the other side.
    const b = e.ahead;
    if (b && b.blue === e && b.blueSide) return -b.blueSide * Math.min(3.2, lim) - lineOff;
    return want;
  }

  // The speed the rules allow this car right now, folded into its ctx.
  limit(e, ctx) {
    if (!this.on || e.inPit || e.finished) return ctx;
    const r = this.race, t = r.track, i = e.proj.i, vl = this.vLine(i), L = r.spec.bodyL;
    let pred = null, gap = Infinity, vPred = 0;
    if (e.ahead && !e.ahead.unlap) { pred = e.ahead; gap = t.gap(e.ahead.proj.s, e.proj.s); vPred = e.ahead.car.speed; }
    const sc = this.sc;
    if (sc.out && !sc.inLane) {
      const g = t.gap(sc.s, e.proj.s);
      if (g > 0 && g < gap) { pred = sc; gap = g; vPred = sc.v; }
    }
    let cap = Infinity, follow = false;
    const byDelta = f => vl * f + Math.max(-9, Math.min(4, -((e.vd || 0) + 10) * 0.3));
    // Tuck up behind the car ahead: a few car lengths, never ten. The gain
    // is firm because a queue concertinas out of every slow corner, and a
    // lazy follower is 90 m back by the next straight (measured, Monza).
    // THE FOLLOWING LAW is the Intelligent Driver Model (Treiber 2000): a
    // time headway, a stand-off, a comfortable deceleration — collision-free
    // and stable down a string of cars. Two simpler laws were measured first
    // and both concertinaed a 20-car queue out to 90-120 m: "the car ahead's
    // speed plus a bit" braked a car 136 m back to a crawl for a chicane, and
    // "brake-able from here" amplified down the queue until the tail did
    // 75 m/s behind a 51 m/s safety car. The answer comes out as a
    // speed a beat ahead, which is what the autopilot's pedals take.
    const A = 9, B = 9, T = 0.3, S0 = 6;
    const tail = (v0 = vl * 0.92) => {
      const v = e.car.speed, sg = Math.max(0.5, gap - L);
      const dv = v - vPred;
      const sStar = S0 + Math.max(0, v * T + v * dv / (2 * Math.sqrt(A * B)));
      const acc = A * (1 - Math.pow(v / Math.max(1, v0), 4) - (gap < 400 ? (sStar / sg) ** 2 : 0));
      follow = gap < 60;
      return Math.max(0, v + Math.max(-12, acc) * 0.6);
    };
    switch (this.mode) {
      case 'vsc': case 'vscEnd':
        cap = Math.min(byDelta(VSC_F), tail());
        break;
      case 'sc': {
        if (e.unlap) { cap = Math.min(vl * 0.80, 58); break; }
        const lead = this.leader();
        if (this.phase === 'restart') {
          if (e.rcCross) break;                                   // past the line: racing
          if (e === lead) { cap = e.went ? Infinity : this.scSpeed(i); if (gap < 80) cap = Math.min(cap, tail(vl)); break; }
          cap = tail(vl);
          break;
        }
        // Lights out: the safety car pulls away, the leader does not follow it.
        if (this.phase === 'in' && e === lead) { cap = this.scSpeed(i); break; }
        cap = e.queued ? tail() : Math.min(byDelta(DELTA_F), tail());
        break;
      }
      case 'red':
        cap = Math.min(vl * 0.55, 45, tail());
        break;
      default: {
        const y = Math.max(this.yellowAt(e.proj.s), this.yellowAt(e.proj.s + 120));
        if (y === 2) cap = vl * 0.80; else if (y === 1) cap = vl * 0.93;
        if ((y && gap < 60) || (e.holdLine && gap < 150)) cap = Math.min(cap, tail());
        if (e.blue && e.blueGap < 30) cap = Math.min(cap, vl * 0.92);
      }
    }
    if (cap < Infinity) ctx.speedCap = Math.min(ctx.speedCap ?? Infinity, cap);
    // Under a neutralisation the car ahead is the queue, and ITS speed is the
    // target: racecraft's "brake to the speed of the car in your lane within
    // 150 m" braked a follower to a stop behind a car that was itself only
    // slowing for the chicane, and the queue stretched to 90 m (measured).
    if (this.neutral) { ctx.obstDs = null; ctx.obstV = null; }
    if (follow && pred) {
      const d = gap - L * 1.15;
      if (ctx.obstDs == null || d < ctx.obstDs) { ctx.obstDs = d; ctx.obstV = vPred; }
    }
    if (this.neutral) { ctx.lunge = 0; ctx.pressure = 0; }
    return ctx;
  }

  // ---- every substep ----------------------------------------------------------
  tick(dt) {
    if (!this.on) return;
    const r = this.race, t = r.track, now = r.time;
    const delta = this.mode === 'vsc' || this.mode === 'vscEnd' || (this.mode === 'sc' && this.phase !== 'restart' && this.phase !== 'in');
    for (const e of r.entries) {
      if (e.retired) continue;
      const prev = e.rcS ?? e.proj.s; e.rcS = e.proj.s;
      if (delta && !e.inPit && !e.finished) {
        const f = this.deltaF(e);
        if (f) {
          const vr = this.vLine(e.proj.i) * f;
          e.vd = Math.max(-vr * 2.5, (e.vd || 0) + t.gap(e.proj.s, prev) - vr * dt);
        } else e.vd = Math.min(e.vd || 0, 0);
      }
      if (prev > t.length * 0.8 && e.proj.s < t.length * 0.2) {
        if (this.mode === 'sc' && this.phase === 'restart') e.rcCross = true;
        e.holdLine = false;
      }
      if (e.holdLine && now - this.greenAt > 60) e.holdLine = false;
      // Unserved drive-through at the flag: twenty seconds, as the rules say.
      if (e.finished && e.driveThru > 0 && !e.dtConverted) {
        e.dtConverted = true; e.penalty += 20 * e.driveThru;
        this.rc(`${this.tag(e)} — DRIVE THROUGH NOT SERVED, 20 SECONDS ADDED`, 'pen', e);
      }
    }

    // Incidents clear themselves: a car being pushed is still an incident.
    for (const inc of this.incidents) {
      const e = inc.e;
      if ((inc.kind === 'beached' || inc.kind === 'stopped') && (e.recover || e.stuck > 0 || (inc.kind === 'stopped' && !e.retired && e.car.speed < 3)))
        inc.clearAt = Math.max(inc.clearAt, now + 6);
    }
    if (this.incidents.length > 40) this.incidents = this.incidents.filter(x => x.clearAt > now - 30);

    if (r.state === 'finish' || r.state === 'over') {
      if (this.mode !== 'green') { this.begin('green'); this.phase = null; this.sc.out = false; if (r.lane) { r.lane.closed = false; r.lane.hold = false; } }
      return;
    }

    switch (this.mode) {
      case 'vsc':
        if (now - this.since > VSC_MIN && this.clear()) {
          const last = this.hist[this.hist.length - 1]; void last;
          this.mode = 'vscEnd'; this.since = now;
          this.rc('VIRTUAL SAFETY CAR ENDING', 'vscEnd');
        }
        break;
      case 'vscEnd':
        if (now - this.since > VSC_END) this.goGreen();
        break;
      case 'sc': this.scTick(dt); break;
      case 'red': this.redTick(dt); break;
    }
    this.moveSC(dt);
    this.jobTick(dt);

    this.dt4 = dt * 4;
    if (this.sub++ % 4 === 0) {
      this.queueTick();
      this.blueTick();
      if (r.me) this.youTick();
      this.rainTick();
    }
  }

  clear() { const now = this.race.time; return this.incidents.every(x => x.clearAt <= now); }

  // ---- the safety car's own lap ---------------------------------------------
  scTick() {
    const r = this.race, t = r.track, lane = r.lane, sc = this.sc, now = r.time;
    const lead = this.leader();
    if (!lead) return;
    switch (this.phase) {
      case 'deploy': {
        if (!sc.out) {
          // Out of the pit exit when the leader is coming — ahead of it.
          const ref = lead.inPit ? (r.standings.find(e => !e.retired && !e.inPit && !e.finished) || lead) : lead;
          const d = t.wrap(lane.exitS - ref.proj.s);
          if ((d > 420 && d < 1100) || now - this.phaseAt > 110) {
            sc.out = true; sc.inLane = true; sc.prog = 0.78; sc.v = 18; sc.lights = true;
            sc.s = t.wrap(lane.entryS + sc.prog * lane.len);
            sc.lat = laneLat(lane, sc.prog);
          }
        } else {
          const g = t.gap(sc.s, lead.proj.s);
          if (!sc.inLane && ((g > 0 && g < 130) || now - this.phaseAt > 160)) {
            this.phase = 'lead'; this.phaseAt = now;
            if (lane.closed) { lane.closed = false; this.rc('PIT ENTRY OPEN', 'pitOpen'); }
          }
        }
        break;
      }
      case 'lead': {
        const since = now - this.phaseAt;
        const live = r.entries.filter(e => !e.retired && !e.finished && !e.inPit);
        const formed = live.every(e => e.queued || e.unlap);
        // Lapped cars may now overtake — once the queue has formed.
        if (!this.unlapCalled && since > 12 && (formed || since > QUEUE_WAIT)) {
          // (lapped cars physically ahead of the safety car are not waved by)
          this.unlapCalled = true;
          // Only the ones IN the queue, behind the safety car: a lapped car
          // still catching the queue from behind joins it where it arrives.
          const P = r.progress(lead);
          const lapped = live.filter(e => P - r.progress(e) > t.length * 0.97 && t.gap(e.proj.s, sc.s) < 0);
          for (const e of lapped) { e.unlap = true; e.unlapAt = now; }
          if (lapped.length) this.rc('LAPPED CARS MAY NOW OVERTAKE', 'unlap');
        }
        for (const e of live) {
          if (!e.unlap) continue;
          // Done once it is clear past the safety car, or it has had a minute.
          if (t.gap(e.proj.s, sc.s) > 25 || now - e.unlapAt > 70) { e.unlap = false; e.unlapSc = 0; e.unlapped = (e.unlapped || 0) + 1; }
        }
        const busy = live.some(e => e.unlap);
        const lastLap = lead.lap >= r.laps - 1;
        // ...and the laps are done: counted on the LEADER from the moment the
        // safety car was called, and called in with the last of them still to
        // run, because it peels off at the pit entry at the end of that one.
        // (Counted on the safety car's own lead, the leader's lap in catching
        // it came on top: five laps neutralised, measured, for three led.)
        const led = r.progress(lead) - this.scFrom >= (this.scLaps - 1) * t.length;
        const ready = lastLap || (this.clear() && led && since > PICKUP_MIN && (formed || since > QUEUE_WAIT)
          && this.unlapCalled && !busy);
        if (ready && (lastLap || t.wrap(lane.entryS - sc.s) > 500)) {
          this.phase = 'in'; this.phaseAt = now; sc.lights = false;
          this.rc('SAFETY CAR IN THIS LAP', 'scIn');
        }
        break;
      }
      case 'in': {
        // Lights out: the safety car pulls away to the pit entry and the
        // leader backs the queue up. It is in the lane when it crosses the line.
        const d = t.wrap(lane.entryS - sc.s);
        if (!sc.inLane && (d < 3 || d > t.length - 30)) {
          sc.inLane = true; sc.prog = 0;
          this.phase = 'restart'; this.phaseAt = now;
          for (const e of r.entries) { e.rcCross = false; e.went = false; }
          this.goD = 150 + this.rng() * 320;
        }
        break;
      }
      case 'restart': {
        // The LEADER dictates. A bot leader picks its moment in the last
        // few hundred metres before the control line; you pick yours.
        if (!lead.isPlayer && !lead.went && t.wrap(0 - lead.proj.s) < this.goD) {
          lead.went = true;
        }
        if (lead.rcCross || now - this.phaseAt > 140) this.goGreen('TRACK CLEAR');
        break;
      }
    }
  }

  moveSC(dt) {
    const sc = this.sc, r = this.race, t = r.track, lane = r.lane;
    if (!sc.out) return;
    const lead = this.leader();
    let want;
    if (sc.inLane) {
      want = sc.prog > 0.72 && this.phase === 'deploy' ? 26 : PIT_SPEED;
      if (this.phase === 'restart' && sc.prog > 0.22) { sc.out = false; sc.inLane = false; return; }
    } else if (this.phase === 'in' || this.phase === 'restart') {
      want = Math.min(this.vLine(t.idx(sc.s)) * 0.82, 75);
    } else {
      want = this.scSpeed(t.idx(sc.s));
      // It waits for the leader: a queue is only a queue if it has a head.
      if (lead && !lead.inPit) {
        const g = t.gap(sc.s, lead.proj.s);
        if (g > 160) want *= 0.7;
      }
    }
    // BRAKING POINTS. The target is the line's speed where the car IS; with
    // only 12 m/s2 of braking it arrived at every chicane far too fast and ran
    // into the back of whoever was ahead. So it looks 200 m up the road and is
    // already slow enough to stop in time for what is coming.
    if (!sc.inLane) {
      const vAt = j => (this.phase === 'in' || this.phase === 'restart')
        ? Math.min(this.vLine(j) * 0.82, 75) : this.scSpeed(j);
      const i0 = t.idx(sc.s), n = Math.round(200 / t.ds);
      for (let k = 1; k <= n; k += 2) want = Math.min(want, Math.sqrt(vAt((i0 + k) % t.n) ** 2 + 2 * 9 * k * t.ds));
    }
    // It drives, it is not on rails: never into the back of a car on the road
    // ahead of it — the lapped car it has just waved by is exactly that, and
    // on its in-lap at 82% of racing speed it rear-ended one 52 times.
    if (!sc.inLane) {
      for (const e of r.entries) {
        if (e.retired || e.inPit || e.finished) continue;
        const g = t.gap(e.proj.s, sc.s);
        if (g > 0 && g < 60 && Math.abs(e.proj.lat - sc.lat) < 3.2) want = Math.min(want, e.car.speed * Math.min(1, (g - 8) / 30));
      }
    }
    const a = want > sc.v ? 7 : -12;
    sc.v = Math.max(0, a > 0 ? Math.min(want, sc.v + a * dt) : Math.max(want, sc.v + a * dt));
    const ox = sc.car.x, oy = sc.car.y;
    if (sc.inLane) {
      sc.prog += sc.v * dt / Math.max(1, lane.len);
      sc.s = t.wrap(lane.entryS + sc.prog * lane.len);
      sc.lat = laneLat(lane, sc.prog);
      if (sc.prog >= 0.995) { sc.inLane = false; }
    } else {
      sc.s = t.wrap(sc.s + sc.v * dt);
      // It holds its lane while a lapped car is coming past, rather than
      // following the racing line across in front of it.
      const passing = r.entries.some(e => e.unlap && !e.retired && t.gap(sc.s, e.proj.s) > -8 && t.gap(sc.s, e.proj.s) < 160);
      const w = t.w[t.idx(sc.s)] - 1.5;
      const tgt = passing ? Math.max(-w, Math.min(w, sc.lat)) : (r.lines.race.off[t.idx(sc.s)] || 0);
      sc.lat += Math.max(-2 * dt, Math.min(2 * dt, tgt - sc.lat));
    }
    const p = t.point(sc.s, sc.lat);
    sc.i = p.i;
    const c = sc.car;
    c.x = p.x; c.y = p.y;
    const dx = c.x - ox, dy = c.y - oy;
    c.hdg = Math.hypot(dx, dy) > 0.02 && Math.hypot(dx, dy) < 5 ? Math.atan2(dy, dx) : p.hdg;
    c.vx = sc.v; c.vy = 0; c.r = 0; c.speed = sc.v; c.z = 0;
  }

  // ---- the recovery truck ------------------------------------------------------
  // Kinematic, like the safety car: it has one job. It waits for the wreck to
  // stop moving and for the field to be neutralised and gathered up — nobody
  // is sent onto a circuit at racing speed — then out, hook, and back.
  jobTick(dt) {
    if (!this.jobs.length) return;
    const r = this.race, t = r.track, now = r.time;
    const toward = (v, x, y, sp) => {
      const dx = x - v.x, dy = y - v.y, d = Math.hypot(dx, dy);
      if (d < sp * dt + 0.05) { v.x = x; v.y = y; return true; }
      v.hdg = Math.atan2(dy, dx); v.x += dx / d * sp * dt; v.y += dy / d * sp * dt;
      return false;
    };
    for (const j of this.jobs) {
      const c = j.e.car;
      j.t += dt;
      switch (j.st) {
        case 'wait': {
          const safe = this.mode === 'red' || this.mode === 'vsc'
            ? now - this.since > TRUCK_AFTER
            : this.mode === 'sc' && (this.phase === 'lead' || now - this.since > 45);
          if (!j.e.atRest || !safe) break;
          const pr = t.project(c.x, c.y, j.e.hint, 8);
          const side = Math.sign(pr.lat) || 1;
          // The gap in the barrier: up the road, the wreck's side.
          const g = t.point(pr.s - TRUCK_BACK, side * (pr.w + (pr.run || 8) + 4));
          j.gate = { x: g.x, y: g.y };
          j.truck = { kind: 'truck', x: g.x, y: g.y, hdg: g.hdg, lights: true, towing: false };
          // It stops a truck's length short of the car, on the line between them.
          const d = Math.hypot(c.x - g.x, c.y - g.y) || 1;
          j.at = { x: c.x - (c.x - g.x) / d * 7, y: c.y - (c.y - g.y) / d * 7 };
          j.st = 'out'; j.t = 0;
          this.rc('RECOVERY VEHICLE ON TRACK', 'truck', j.e);
          break;
        }
        case 'out':
          if (toward(j.truck, j.at.x, j.at.y, TRUCK_V)) { j.st = 'hook'; j.t = 0; }
          break;
        case 'hook':
          if (j.t > HOOK_T) { j.st = 'tow'; j.t = 0; j.truck.towing = true; }
          break;
        case 'tow': {
          const home = toward(j.truck, j.gate.x, j.gate.y, TOW_V);
          // The car comes backwards on the hook, 7 m behind the truck.
          c.x = j.truck.x - Math.cos(j.truck.hdg) * 7; c.y = j.truck.y - Math.sin(j.truck.hdg) * 7;
          c.hdg = j.truck.hdg + Math.PI; c.vx = 0.0001; c.vy = 0; c.r = 0; c.z = 0; c.pitch = 0; c.roll = 0;
          if (home) {
            j.st = 'done'; j.truck = null; j.e.recovered = true;
            j.inc.clearAt = Math.min(j.inc.clearAt, now);
            this.rc(`${this.tag(j.e)} RECOVERED`, 'recovered', j.e);
          }
          break;
        }
      }
    }
    this.jobs = this.jobs.filter(j => j.st !== 'done');
    this.vehicles = this.jobs.filter(j => j.truck).map(j => j.truck);
  }

  // Who is in the queue: close behind the car (or safety car) ahead.
  queueTick() {
    if (this.mode !== 'sc') return;
    const r = this.race, t = r.track, sc = this.sc;
    for (const e of r.entries) {
      if (e.retired || e.inPit || e.finished) { e.queued = false; continue; }
      let gap = e.ahead ? t.gap(e.ahead.proj.s, e.proj.s) : Infinity;
      if (sc.out && !sc.inLane) { const g = t.gap(sc.s, e.proj.s); if (g > 0 && g < gap) gap = g; }
      const q = gap < QUEUE_GAP && (this.phase !== 'deploy' || (sc.out && !sc.inLane));
      e.queued = e.queued ? gap < QUEUE_GAP * 1.6 : q;
      if (e.queued) e.vd = Math.min(e.vd || 0, 0);
    }
  }

  // ---- red flag ---------------------------------------------------------------
  redTick() {
    const r = this.race, now = r.time;
    const live = r.entries.filter(e => !e.retired && !e.finished);
    for (const e of live) if (!e.inPit && !e.pitRequest) e.pitRequest = true;
    const parked = live.every(e => e.pitPhase === 'service');
    if (this.parkedAt == null && (parked || now - this.since > RED_WAIT)) {
      this.parkedAt = now;
      this.rc('RACE WILL RESUME — STANDING START', 'redResume');
    }
    if (this.parkedAt != null && now - this.parkedAt > RED_HOLD) this.restartStanding();
  }

  // The grid again, in the red-flag order, with the laps that were complete.
  restartStanding() {
    const r = this.race, t = r.track;
    const order = this.redOrder.filter(x => !x.e.retired);
    let k = 0;
    for (const { e, lap } of order) {
      const slot = r.slots[k++];
      if (!slot) break;
      const car = e.car, p = t.point(slot.s, slot.lat);
      car.x = p.x; car.y = p.y; car.hdg = slot.hdg;
      car.vx = 0.001; car.vy = 0; car.r = 0; car.speed = 0;
      car.throttle = 0; car.brake = 1; car.delta = 0;
      car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
      car.onRoof = false; car.airborne = false;
      e.inPit = false; e.pitPhase = 'none'; e.pitRequest = false; e.pitTimer = 0;
      e.recover = null; e.stuck = 0; e.redFixed = false;
      e.proj = t.project(p.x, p.y); e.hint = e.proj.i; e.rcS = e.proj.s;
      e.lap = lap; e.crossed0 = false; e.pastHalf = false;
      e.biasS = slot.lat - (r.lines.race.off[t.idx(slot.s)] || 0); e.merge = true;
      e.opening = true; e.zip = false; e.openLap = lap;
      e.build = 0; e.tryT = 0; e.atkOn = null;
    }
    r.lane.hold = false;
    r.state = 'grid'; r.lights = 5.2; r.gridAt = r.time;
    this.begin('green'); this.phase = null; this.greenAt = r.time;
    this.count.restarts++;
    const lead = order[0] && order[0].e;
    this.drsFrom = (lead ? lead.lap : 0) + 2;
    this.rc('STANDING START PROCEDURE', 'standing');
  }

  // ---- blue flags ---------------------------------------------------------------
  // A car a lap (or more) down, with the car lapping it within a second: show
  // it the blue. Bots move off the line and lift; YOU get three.
  blueTick() {
    const r = this.race, L = r.track.length;
    for (const e of r.entries) {
      e.blue = null;
      if (!(this.neutral || e.retired || e.inPit || e.finished || r.state !== 'green')) {
        const o = e.behind;
        if (o && !o.inPit && !o.retired && e.behindGapT <= 1.0 && r.progress(o) - r.progress(e) > L * 0.5) {
          e.blue = o; e.blueGap = -r.track.gap(o.proj.s, e.proj.s);
          if (!e.blueSide) e.blueSide = Math.sign(e.proj.lat - o.proj.lat) || 1;
          e.blueAt = r.time;
        }
      }
      // The side is let go once the blues have been off for two seconds.
      if (!e.blue && e.blueSide && r.time - (e.blueAt || 0) > 2) e.blueSide = 0;
    }
  }

  // ---- the rules only YOU can break ---------------------------------------------
  youTick() {
    const r = this.race, me = r.me, now = r.time;
    if (!me || me.retired || me.finished) return;
    const P = r.progress(me);

    // OVERTAKING. A place taken from a live car while a rule forbids it must be
    // handed back within GIVE_BACK s. Progress-based, so lapping a backmarker or
    // being unlapped is not a pass.
    const rule = this.mode === 'sc' ? (this.phase === 'restart' ? (me.rcCross ? null : 'restart') : 'sc')
      : this.mode === 'vsc' || this.mode === 'vscEnd' ? 'vsc'
      : this.mode === 'red' ? 'red'
      : me.holdLine ? 'restart'
      : this.yellowAt(me.proj.s) ? 'yellow' : null;
    this.owed = this.owed || [];
    for (const o of r.entries) {
      if (o === me) continue;
      const ahead = r.progress(o) > P;
      const was = o.youAhead;
      o.youAhead = ahead;
      if (was == null || me.inPit) continue;
      // Fair: a car that has left the track, or is peeling off into the pits.
      const fair = o.retired || o.inPit || o.recover || o.unlap || o.car.speed < 8 || o.finished
        || Math.abs(o.proj.lat) > o.proj.w + 1 || o.pitPhase === 'approach';
      if (was && !ahead && rule && !fair && now - this.since > 3 && !this.owed.some(x => x.o === o)) {
        this.owed.push({ o, t: now, rule });
        this.rc(`${this.tag(me)} — GIVE THE POSITION BACK TO ${this.tag(o)}`, 'giveBack', me);
      }
    }
    for (const x of this.owed.splice(0)) {
      if (x.o.retired || x.o.inPit || r.progress(x.o) > P) continue;          // handed back, or moot
      if (now - x.t > GIVE_BACK) this.penalise(me, x.rule);
      else this.owed.push(x);
    }

    // THE MINIMUM TIME. Faster than the delta for a while: a warning, then five.
    const d = this.deltaFor(me);
    if (d != null && d < 0) {
      me.deltaBad = (me.deltaBad || 0) + this.dt4;
      if (me.deltaBad > 1.5 && !me.deltaWarned) {
        me.deltaWarned = true;
        this.rc(`${this.tag(me)} — BELOW THE MINIMUM TIME: WARNING`, 'deltaWarn', me);
      }
      if (me.deltaBad > 5) { me.deltaBad = 0; this.penalise(me, 'delta'); }
    }

    // BLUE FLAGS, one per marshal post you pass with them showing.
    if (me.blue) {
      const k = this.sector(me.proj.s);
      if (me.blueFor !== me.blue) { me.blueFor = me.blue; me.blueN = 1; me.blueSec = k;
        this.rc(`BLUE FLAG FOR ${this.tag(me)}`, 'blue', me); }
      else if (k !== me.blueSec) {
        me.blueSec = k; me.blueN++;
        if (me.blueN === 2) this.rc(`BLUE FLAG FOR ${this.tag(me)} — SECOND`, 'blue2', me);
        if (me.blueN === 3) { this.penalise(me, 'blue'); }
      }
      me.blueOff = now;
    } else if (me.blueFor && now - (me.blueOff || 0) > 3) { me.blueFor = null; me.blueN = 0; }

    // Ten car lengths behind the car in front, in the queue.
    if (this.mode === 'sc' && this.phase === 'lead' && me.ahead && !me.inPit) {
      const g = r.track.gap(me.ahead.proj.s, me.proj.s);
      if (g > r.spec.bodyL * 10 && g < 400 && me.wasQueued && now - (me.tenAt || -99) > 25) {
        me.tenAt = now;
        this.rc(`${this.tag(me)} — MORE THAN TEN CAR LENGTHS BEHIND THE CAR AHEAD`, 'ten', me);
      }
      if (me.queued) me.wasQueued = true;
    } else me.wasQueued = false;
  }

  // Race.js calls this on every entry to the pit lane.
  pitEntry(e) {
    if (!this.on) return;
    if (e.entryV != null && e.entryV > PIT_SPEED + 0.8 && !e.driveThru) {
      this.rc(`${this.tag(e)} CROSSED THE PIT ENTRY LINE AT ${Math.round(e.entryV * 3.6)} KM/H`, 'speeding', e);
      this.penalise(e, 'speeding');
    }
    if (this.neutral && this.mode !== 'red') { this.count.pitsUnder++; e.pitUnderT = this.race.time; }
  }
  // ...and on every release from a box.
  released(e) {
    if (!this.on) return;
    if (e.unsafe) { e.unsafe = false; this.penalise(e, 'unsafe'); }
  }

  penalise(e, kind) {
    const p = PEN[kind];
    if (!p || !e) return;
    this.count.pens++;
    if (p.dt) {
      e.driveThru = (e.driveThru || 0) + 1;
      if (!e.isPlayer) e.pitRequest = true;
      this.race.log('penalty', `FIA STEWARDS: DRIVE THROUGH PENALTY FOR ${this.tag(e)} — ${p.why}`, e, 'dt');
    } else {
      e.penalty += p.sec;
      this.race.log('penalty', `FIA STEWARDS: ${p.sec} SECOND TIME PENALTY FOR ${this.tag(e)} — ${p.why}`, e, 'pen' + p.sec);
    }
  }

  // ---- rain -------------------------------------------------------------------
  // A downpour that ARRIVES mid-race is a red flag, once. A race started in a
  // storm was chosen as a storm race, and is left to be one.
  rainTick() {
    const r = this.race;
    const wet = (1 - wetGrip()) / 0.22;
    if (this.wet0 == null) { if (r.state === 'green') this.wet0 = wet; return; }
    if (!this.rainRed && this.wet0 < 0.8 && wet > 0.95 && this.mode !== 'red') {
      this.rainT = (this.rainT || 0) + this.dt4;
      if (this.rainT > 15) {
        this.rainRed = true;
        const lead = this.leader();
        if (lead) this.incident('rain', lead);
      }
    } else this.rainT = 0;
  }
}
