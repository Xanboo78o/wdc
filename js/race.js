// race.js — the session. Twenty-two cars, a rulebook, and no renderer.
//
// Renderer-free on purpose, same rule physics.js lives under: this runs whole
// races in plain Node in `tools/race.mjs`, which is the only way to find out
// whether a grid of twenty-two actually races rather than piling into turn one.
// Grid slots are injected rather than imported for exactly that reason.
//
// What lives here and NOT in autopilot.js: anything that needs to know the
// running order. A driver knows how to drive; only the session knows who is
// ahead, who is being caught, and whose fault the contact was.
import { makeCar, step, FIXED_DT, SURFACE, peakSlip, dragFor } from './physics.js';
import { makeAutopilot, makeDriver } from './autopilot.js';
import { resolveBarrier, resolveCars } from './collide.js';

const NAMES = [
  'VERSTAPPEN', 'NORRIS', 'LECLERC', 'PIASTRI', 'SAINZ', 'RUSSELL', 'HAMILTON',
  'ALONSO', 'GASLY', 'HULKENBERG', 'TSUNODA', 'ALBON', 'STROLL', 'OCON',
  'BEARMAN', 'COLAPINTO', 'LAWSON', 'BORTOLETO', 'ANTONELLI', 'HADJAR',
  'DOOHAN', 'ARON',
];
const COLS = ['#1fd2be', '#ff8000', '#e8002d', '#ffd400', '#3671c6', '#27f4d2',
              '#00a0de', '#229971', '#b6babd', '#6692ff'];

const PIT_LIMIT = 80 / 3.6;
const NEIGH_EVERY = 4;        // substeps between neighbour/racecraft updates

export class Race {
  constructor({ track, lines, spec, slots, laps = 5, grid = 22, playerGrid = 10,
                tier = 'medium', seed = 1, player = true }) {
    this.track = track; this.lines = lines; this.spec = spec;
    this.laps = laps; this.peak = peakSlip(spec);
    this.time = 0; this.state = 'grid'; this.lights = 3.2;
    this.events = [];
    this.sub = 0;

    const n = Math.min(grid, slots.length);
    this.entries = [];
    for (let k = 0; k < n; k++) {
      const slot = slots[k];
      const isPlayer = player && k === Math.min(playerGrid, n) - 1;
      const car = makeCar({ cls: spec.key });
      const p = track.point(slot.s, slot.lat);
      car.x = p.x; car.y = p.y; car.hdg = slot.hdg; car.vx = 0.001;
      const driver = isPlayer ? null : makeDriver(seed * 131 + k, tier, track.corners.length || 24);
      this.entries.push({
        car, driver, isPlayer, idx: k,
        name: isPlayer ? 'YOU' : NAMES[k % NAMES.length],
        num: isPlayer ? 78 : k + 1,
        col: isPlayer ? '#ffffff' : COLS[k % COLS.length],
        drive: isPlayer ? null : makeAutopilot(track, lines, spec, this.peak, { driver }),
        proj: track.project(p.x, p.y), hint: slot.i,
        lap: 0, gridPos: k + 1, pos: k + 1, crossed0: false, pastHalf: false,
        lapStart: 0, lastLap: null, bestLap: null,
        ahead: null, behind: null, aheadGapT: 99, behindGapT: 99,
        ctx: null, lastMove: 0, movedAt: -99,
        warnings: 0, penalty: 0, offNow: false, lastLimit: -99,
        contacts: 0, retired: false, finished: false, finishTime: null,
        pitRequest: false, inPit: false, pitTimer: 0, pitStops: 0, stuck: 0,
      });
    }
    this.order();
  }

  log(kind, text, e = null) {
    this.events.push({ t: this.time, kind, text, car: e ? e.idx : null });
    if (this.events.length > 300) this.events.shift();
  }

  progress(e) {
    return (e.lap + (e.crossed0 ? 1 : 0)) * this.track.length + e.proj.s;
  }

  order() {
    const was = this.entries.map(e => e.pos);
    this.standings = this.entries.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return this.progress(b) - this.progress(a);
    });
    this.standings.forEach((e, i) => { e.pos = i + 1; });

    // Count passes. This is the metric that says whether they are RACING or
    // merely queueing: a grid that never touches and never changes order is
    // not a clean race, it is a procession, and the two look identical in
    // every other number. Debounced, because positions flicker substep to
    // substep when two cars are alongside.
    if (this.state === 'green' && this.time > 6) {
      for (let k = 0; k < this.entries.length; k++) {
        const e = this.entries[k];
        if (e.pos < was[k] && !e.retired && this.time - (e.lastPass || -99) > 2) {
          e.lastPass = this.time;
          e.passes = (e.passes || 0) + 1;
          this.passes = (this.passes || 0) + 1;
        }
      }
    }
  }

  // ---- who is near whom, and what that does to the air ---------------------
  neighbours() {
    const t = this.track;
    for (const e of this.entries) {
      e.ahead = null; e.behind = null; e.aheadGapT = 99; e.behindGapT = 99;
      let dirty = 0, tow = 0, bestA = 1e9, bestB = 1e9;
      for (const o of this.entries) {
        if (o === e || o.retired) continue;
        const ds = t.gap(o.proj.s, e.proj.s);
        const dl = Math.abs(o.proj.lat - e.proj.lat);
        if (ds > 0 && ds < 70) {
          // Following guts the FRONT wing first, which is why it understeers
          // rather than simply going slower. Alignment matters: you only get
          // the wake if you are actually behind them, not alongside.
          const align = Math.max(0, 1 - dl / 7.5);
          dirty = Math.max(dirty, align * Math.pow(Math.max(0, 1 - ds / 42), 1.5));
          if (dl < 4.5) tow = Math.max(tow, (1 - dl / 4.5) * Math.max(0, 1 - ds / 45));
        }
        if (ds > 0 && ds < bestA) { bestA = ds; e.ahead = o; e.aheadGapT = ds / Math.max(e.car.speed, 12); }
        if (ds < 0 && -ds < bestB) { bestB = -ds; e.behind = o; e.behindGapT = -ds / Math.max(o.car.speed, 12); }
      }
      e.car.dirty = dirty; e.car.tow = tow;
    }
  }

  // Is there a big braking zone within `look` metres? Attack and defence both
  // key off this: overtaking happens under braking, not in the middle of a
  // corner, and a defender who moves anywhere else is just weaving.
  brakingZone(s, look) {
    const v = this.lines.race.v, t = this.track;
    const i0 = t.idx(s);
    let vmin = Infinity;
    for (let k = 0; k < look / t.ds; k++) vmin = Math.min(vmin, v[(i0 + k) % t.n]);
    return vmin < v[i0] * 0.86;
  }

  // ---- racecraft: the part that needs to know the running order ------------
  racecraft(e) {
    const t = this.track, i = e.proj.i, d = e.driver;
    const lim = Math.max(0.3, t.w[i] - 1.0);
    let bias = 0, speedCap = null;

    if (e.ahead && e.aheadGapT < 1.4 && !e.inPit) {
      // get out of the wake and take the inside for the next braking zone
      const side = e.ahead.proj.lat > 0 ? -1 : 1;
      const pull = this.brakingZone(e.proj.s, 130) ? 0.75 + 0.5 * d.aggression : 0.35;
      bias += side * pull * Math.max(0.8, t.w[i] - 2.2) * Math.min(1, (1.4 - e.aheadGapT) / 1.0);
    }
    if (e.behind && e.behindGapT < 0.75 && !e.inPit && this.brakingZone(e.proj.s, 150)) {
      // ONE move. Pick a side, commit, and do not weave — that is the actual
      // rule, and a defender who keeps moving is both illegal and slower.
      if (this.time - e.movedAt > 3.5) {
        e.lastMove = -Math.sign(this.lines.race.off[i]) || 1;
        e.movedAt = this.time;
      }
      bias += e.lastMove * d.defence * Math.max(0.6, t.w[i] - 2.4) * 0.85;
    }

    // Do not drive into someone who is alongside. This overrides attack and
    // defence, because wanting the line does not entitle you to the space.
    for (const o of this.entries) {
      if (o === e || o.retired || o.inPit) continue;
      const ds = t.gap(o.proj.s, e.proj.s);
      if (Math.abs(ds) > 7) continue;
      const dl = o.proj.lat - e.proj.lat;
      if (Math.abs(dl) < 3.8) bias -= Math.sign(dl || 1) * (3.8 - Math.abs(dl)) * 0.7;
    }

    // Car-following: settle at a sensible headway and MATCH the car ahead once
    // there. Always targeting a fraction of their speed cascades down the field
    // until the whole train stops.
    if (e.ahead && !e.inPit) {
      const ds = t.gap(e.ahead.proj.s, e.proj.s);
      const dl = Math.abs(e.ahead.proj.lat - e.proj.lat);
      const vA = e.ahead.car.speed || 0, v = e.car.speed;
      const closing = v - vA;
      const braking = this.brakingZone(e.proj.s, 140);
      const zone = braking ? 1.7 : 1.0;
      const headway = (6.5 + v * 0.28 + Math.max(0, closing) * 1.4) * zone;
      // How far apart laterally before the car ahead stops being your problem.
      //
      // A fixed 3.4 m was wrong in the one place it mattered most. The grid
      // staggers cars ±2.6 m either side of the centreline, so a car NEVER saw
      // the one directly in front of it — they are 5.3 m apart across the road
      // — and only noticed once everybody funnelled into turn one and
      // converged, which is far too late to brake. Every collision in a 22-car
      // race was lap one at Rettifilo, nose to tail, closing at up to 24.5 m/s.
      //
      // Into a braking zone the road narrows onto one line, so anyone roughly
      // in front IS in front. Widen the gate to most of the road there.
      const latGate = braking ? Math.max(4.5, t.w[i] * 1.1) : 3.4;

      // A car that has PULLED OUT to pass is no longer following. Without this
      // the cap holds every attacker at the speed of the car ahead even at full
      // headway, so nobody can ever be quicker than the car in front and the
      // whole race is a queue by construction — measured: 0 of 22 cars finished
      // off their grid slot at three circuits, with almost no contact, which
      // looks like a clean race in every statistic except the only one that
      // matters.
      //
      // But "I have moved over" is NOT "I am past". Lifting the cap on intent
      // alone let a car thirty metres back pull out, lose every speed limit and
      // drive into the side of the car it was passing: 77 passes and 29 crashes
      // in one Monaco race. A procession and a demolition derby are the two
      // ways this goes wrong and they are one condition apart.
      //
      // You own the road when you have OVERLAP — your front axle alongside
      // their rear. And the way you EARN overlap is the slipstream: less drag
      // in the wake means you genuinely close on a straight without anyone
      // lifting a limit for you, which is how real overtaking is set up.
      // TWO SEPARATE CONCERNS, and conflating them is what made this oscillate
      // between a procession and a demolition derby for four attempts.
      //
      //   "how close do I want to run"  is racecraft, and lives in `bias`
      //   "do not arrive faster than you can stop" is PHYSICS
      //
      // The second one never switches off. Earlier versions exempted an
      // attacking car from the follow cap entirely, which removed its only
      // protection against rear-ending the car it was trying to pass: wanting
      // the place does not let you brake later than the tyres can.
      //
      // So instead of a cap that matches the car ahead — which makes passing
      // impossible by construction — the limit is the speed at which you could
      // still shed the difference before you reached them. Far back, that
      // allows an enormous run. Close up, it tightens to nothing. No exemption
      // needed, and the slipstream still does the real work of closing you up,
      // because less drag in the wake is a genuine speed advantage.
      // Allowed closing speed grows with the space you have and is BOUNDED.
      // Basing it on stopping distance was wrong — the car ahead is braking
      // too, so the gap shrinks underneath you — and it permitted closing 125
      // km/h faster from fifty metres back, which is how 16 of 22 retired at
      // Suzuka. A few m/s of run is a move; thirty is an accident.
      // `ds < headway * 1.3` is load-bearing and was dropped once by accident.
      // Beyond following distance you are not following anyone, and capping a
      // car 200 m back to the pace of the car ahead compresses the entire field
      // into one unbroken train with no gaps — after which the first braking
      // zone concertinas all 22 of them. That single missing bound took the
      // grid from 22 finishers to 4.
      const overlap = ds < this.spec.bodyL * 1.15 && dl > 1.9;
      if (!overlap && ds > 0 && ds < headway * 1.3 && dl < latGate) {
        // Both halves matter. With room, a bounded run — that is the overtake.
        // Without it, actively SLOWER than the car ahead, so the gap is
        // rebuilt. A cap that merely matches their speed when you are already
        // too close never recovers, and the first perturbation is contact.
        // The run is worth a few m/s, not fifteen — a slipstream down Monza's
        // main straight is about 15 km/h, and every value above that produced
        // a field that closed faster than it could ever slow down again.
        // Scaled by how bold this driver is, so an aggressive one goes for a
        // move a timid one would not, and the whole grid does not lunge at once.
        const room = ds - this.spec.bodyL * 1.3;
        const run = 1.5 + 4.0 * d.aggression;
        speedCap = room > 0
          ? vA + Math.min(run, room * 0.22)
          : vA * Math.max(0.55, 1 + room * 0.06);
      }
    }

    const off = this.lines.race.off[i];
    bias = Math.max(-lim - off, Math.min(lim - off, bias));
    e.ctx = { offBias: bias, speedCap };
  }

  // ---- one substep --------------------------------------------------------
  tick(dt, playerInput) {
    const t = this.track;
    this.time += dt;
    if (this.state === 'grid') {
      this.lights -= dt;
      if (this.lights <= 0) {
        this.state = 'green';
        this.log('flag', 'LIGHTS OUT');
        for (const e of this.entries) e.lapStart = this.time;
      }
    }
    const racing = this.state === 'green' || this.state === 'finish';

    // Neighbours and racecraft change slowly compared with 400 Hz, and they are
    // the O(n^2) part. A quarter of the rate is invisible and four times cheaper.
    if (this.sub++ % NEIGH_EVERY === 0) {
      this.neighbours();
      for (const e of this.entries) if (!e.isPlayer && !e.retired) this.racecraft(e);
    }

    for (const e of this.entries) {
      if (e.retired) continue;
      const car = e.car;
      if (e.isPlayer) {
        const inp = playerInput || { wheel: 0, throttle: 0, brake: 0 };
        car.throttle = inp.throttle; car.brake = inp.brake;
        car.delta = inp.delta ?? car.delta;
      } else if (e.drive) {
        e.drive(car, e.proj, dt, e.ctx);
      }
      if (!racing) { car.throttle = 0; car.brake = 1; car.delta = 0; }

      const pr = e.proj;
      const al = Math.abs(pr.lat);
      let surface = SURFACE.track;
      if (al > pr.w + pr.run) surface = SURFACE.grass;
      else if (al > pr.w + 1.2) surface = SURFACE.runoff;
      else if (al > pr.w) surface = SURFACE.kerb;

      step(car, dt, { surface, bank: pr.bank, bankDir: Math.sign(pr.curv),
                      dirty: car.dirty, tow: car.tow, rollMul: dragFor(surface) });
      const hit = resolveBarrier(car, t, e.hint);
      if (hit && hit.harm) { e.contacts++; this.log('crash', `${e.name} INTO THE BARRIER`, e); }
      if (car.damage >= 1 && !e.retired) { e.retired = true; this.log('crash', `${e.name} RETIRES`, e); }
    }

    this.carContact();

    // ---- projection, laps, rules ------------------------------------------
    for (const e of this.entries) {
      if (e.retired) continue;
      const prev = e.proj.s;
      // A tight window: at 320 km/h a car moves an eighth of one sample per
      // substep, so eight samples either side is already absurdly generous.
      e.proj = t.project(e.car.x, e.car.y, e.hint, 8);
      e.hint = e.proj.i;

      if (e.proj.s > t.length * 0.42 && e.proj.s < t.length * 0.62) e.pastHalf = true;
      const crossed = prev > t.length * 0.8 && e.proj.s < t.length * 0.2;
      if (crossed && racing && !e.finished) {
        if (!e.pastHalf && !e.crossed0) {
          // the grid sits behind the line, so the first crossing is the START
          e.crossed0 = true; e.lapStart = this.time;
        } else {
          e.lap++; e.pastHalf = false;
          const lt = this.time - e.lapStart;
          e.lapStart = this.time;
          e.lastLap = lt;
          if (!e.bestLap || lt < e.bestLap) e.bestLap = lt;
          if (e.lap >= this.laps) {
            e.finished = true; e.finishTime = this.time;
            this.log('flag', `${e.name} FINISHES P${e.pos}`, e);
            if (this.state !== 'finish') { this.state = 'finish'; this.log('flag', 'CHEQUERED FLAG'); }
          }
        }
      }

      // track limits: all four wheels the other side of the white line
      if (racing && !e.inPit) {
        const outBy = Math.abs(e.proj.lat) - e.proj.w - 0.9;
        if (outBy > 0 && !e.offNow) {
          e.offNow = true;
          const c = t.cornerAt(e.proj.s);
          if (c && this.time - e.lastLimit > 4 && e.car.speed > 14) {
            e.lastLimit = this.time; e.warnings++;
            this.log('limits', `${e.name} TRACK LIMITS (${e.warnings}/3)`, e);
            if (e.warnings % 3 === 0) {
              e.penalty += 5;
              this.log('penalty', `${e.name} +5s TRACK LIMITS`, e);
            }
          }
        } else if (outBy < -0.4) e.offNow = false;
      }

      // beached: hand it back rather than let the race wedge
      if (racing && !e.finished) {
        if (e.car.speed < 3.2 && Math.abs(e.proj.lat) > e.proj.w) e.stuck += dt; else e.stuck = 0;
        if (e.stuck > 4) {
          const lp = t.point(e.proj.s - 14, this.lines.race.off[t.idx(e.proj.s - 14)] || 0);
          e.car.x = lp.x; e.car.y = lp.y; e.car.hdg = lp.hdg;
          e.car.vx = 9; e.car.vy = 0; e.car.r = 0; e.stuck = 0;
          this.log('flag', `${e.name} REJOINS`, e);
        }
      }
    }

    this.order();
    if (this.state === 'finish' && this.entries.every(e => e.finished || e.retired)) this.state = 'over';
    if (this.state === 'finish' && this.time - (this.finishAt || (this.finishAt = this.time)) > 30) this.state = 'over';
  }

  // Only test pairs that are actually near each other. Twenty-two cars is 231
  // pairs; sorting by distance along the track and testing a short window makes
  // it about twenty, and two cars 400 m apart cannot touch.
  carContact() {
    const t = this.track;
    const live = this.entries.filter(e => !e.retired);
    live.sort((a, b) => a.proj.s - b.proj.s);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const ds = Math.abs(t.gap(live[j].proj.s, live[i].proj.s));
        if (ds > 12) break;                 // sorted, so nothing further can be closer
        const hit = resolveCars(live[i].car, live[j].car);
        if (hit && hit.harm > 1.2) {
          const a = live[i], b = live[j];
          a.contacts++; b.contacts++;
          // Blame sits here because only the session knows the running order:
          // whoever was behind going in carries it, as in the real thing.
          const behind = t.gap(a.proj.s, b.proj.s) < 0 ? a : b;
          if (this.time - (behind.lastBlame || -99) > 3) {
            behind.lastBlame = this.time;
            behind.penalty += 5;
            const where = t.cornerAt(behind.proj.s)?.name || 'a straight';
            const dl = Math.abs(a.proj.lat - b.proj.lat);
            this.log('penalty',
              `${behind.name} +5s CAUSING A COLLISION at ${where} ` +
              `(closing ${hit.closing.toFixed(1)} m/s, ${dl < 2.2 ? 'nose-to-tail' : 'side by side'}, lap ${behind.lap + 1})`,
              behind);
          }
        }
      }
    }
  }
}
