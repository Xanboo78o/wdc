// race.js — the session. Twenty-two cars, a rulebook, and no renderer.
//
// Renderer-free on purpose, same rule physics.js lives under: this runs whole
// races in plain Node in `tools/race.mjs`, which is the only way to find out
// whether a grid of twenty-two actually races rather than piling into turn one.
// Grid slots are injected rather than imported for exactly that reason.
import { driverAt, teamOf, applyProfile } from './drivers.js';
//
// What lives here and NOT in autopilot.js: anything that needs to know the
// running order. A driver knows how to drive; only the session knows who is
// ahead, who is being caught, and whose fault the contact was.
import { makeCar, step, FIXED_DT, SURFACE, peakSlip, dragFor } from './physics.js';
import { makeAutopilot, makeDriver, BATTLE } from './autopilot.js';
import { resolveBarrier, resolveCars } from './collide.js';
import { wakeAt, newWake } from './aero.js';
import { makeLane, shouldPit, updateStop } from './pitstop.js';

// Module-level scratch for the wake sample. neighbours() is single-threaded and
// reads the result immediately, so one object serves the whole grid rather than
// allocating 462 of them per pass.
const W = newWake();

// Names, numbers, teams, colours and personalities all live in
// js/drivers.js now — see its header for why one table drives all of it.

const PIT_LIMIT = 80 / 3.6;
const NEIGH_EVERY = 4;        // substeps between neighbour/racecraft updates
// Safety car. Deployed when marshals have to stand on a live circuit to push a
// beached car out, which is the only thing that deploys it — there is no
// scripted caution. An opening-lap one was built, measured over N circuits x N
// seeds and deleted: it changed nothing (7.25 -> 7.13 retired of 22) and cost a
// fifth of the overtaking (104 -> 85 passes). See the note further down.
const SAFETY_TIME = 30;       // s the car stays out once it is called
const SAFETY_SPEED = 80 / 3.6;
const PUSH_TIME = 8;          // s for a crew to heave a car back to the tarmac
const BAND_EVERY = 0.5;       // s between OVERTAKES band updates

export class Race {
  constructor({ track, lines, spec, slots, laps = 5, grid = 22, playerGrid = 10,
                tier = 'medium', seed = 1, player = true, pits = true, noDnf = false, order = null,
                battle = null }) {
    this.track = track; this.lines = lines; this.spec = spec;
    // NO DNF (Adam): YOUR car cannot retire. The bots still can.
    this.noDnf = noDnf;
    this.laps = laps; this.peak = peakSlip(spec);
    this.time = 0; this.state = 'grid'; this.lights = 3.2;
    this.safety = 0;            // s of safety car remaining, 0 = racing
    // The pit lane, made once per session: a path with an entry, an exit and a
    // box per car, not a lateral offset. js/pitstop.js owns all of it; the race
    // only decides WHEN, and then keeps its hands off a car whose `inPit` is set.
    this.lane = makeLane(track, Math.min(grid, slots.length));
    // Off for a sprint, and off for measuring what pit stops actually cost —
    // see tools/fieldcheck.mjs --pits 0.
    this.pits = pits;
    this.events = [];
    this.sub = 0;
    // SUPERCASUAL's OVERTAKES submode — see BATTLE in js/autopilot.js.
    this.battle = BATTLE[battle] || null;
    this.bandAt = 0;

    const n = Math.min(grid, slots.length);
    this.entries = [];
    for (let k = 0; k < n; k++) {
      const slot = slots[k];
      // QUALIFYING (js/quali.js) hands over `order`: grid slot -> driver index,
      // -1 for you. Without it the grid is the driver table in order, as ever.
      const isPlayer = order ? order[k] === -1 : player && k === Math.min(playerGrid, n) - 1;
      const who = order ? Math.max(0, order[k]) : k;
      const car = makeCar({ cls: spec.key });
      const p = track.point(slot.s, slot.lat);
      car.x = p.x; car.y = p.y; car.hdg = slot.hdg; car.vx = 0.001;
      // WHO this is, WHAT they drive, and HOW they drive it — one table.
      const prof = driverAt(who);
      const team = teamOf(prof);
      const driver = isPlayer ? null
        : applyProfile(makeDriver(seed * 131 + who, tier, track.corners.length || 24), prof, team);
      this.entries.push({
        car, driver, isPlayer, idx: k, box: k,
        name: isPlayer ? 'YOU' : prof.n,
        num: isPlayer ? 78 : prof.num,
        col: isPlayer ? '#ffffff' : team.col,
        team: isPlayer ? null : team,
        drive: isPlayer ? null : makeAutopilot(track, lines, spec, this.peak, { driver }),
        biasS: 0, atkSide: 0, atkAt: -99, atkOn: null,
        proj: track.project(p.x, p.y), hint: slot.i,
        lap: 0, gridPos: k + 1, pos: k + 1, crossed0: false, pastHalf: false,
        lapStart: 0, lastLap: null, bestLap: null,
        ahead: null, behind: null, aheadGapT: 99, behindGapT: 99,
        ctx: null, lastMove: 0, movedAt: -99,
        warnings: 0, penalty: 0, offNow: false, lastLimit: -99,
        contacts: 0, retired: false, finished: false, finishTime: null, bump: null,
        pitRequest: false, inPit: false, pitTimer: 0, pitStops: 0, stuck: 0,
        recover: null,
      });
    }
    if (this.battle) {
      const B = this.battle, rng = mulberry(seed * 977 + 5);
      for (const e of this.entries) {
        const d = e.driver;
        if (!d) continue;
        // Everyone knows the racing line now. What stays personal is how
        // bold they are, spread either side of the submode's number.
        d.lineKind = 'race';
        d.aggression = Math.min(1, B.aggression * (0.8 + rng() * 0.4));
        d.defence = Math.min(1, B.defence * (0.8 + rng() * 0.4));
        d.moveGap = B.moveGap;
        d.lungeMax = B.lunge;
        // A personal offset inside the band, so the pack is not twenty-one
        // copies of one car.
        d.bandOff = (rng() - 0.5) * 0.04;
      }
      this.band();
    }
    this.order();
  }

  // ---- the OVERTAKES band --------------------------------------------------
  // Where in its grip window each rival drives, from how far it is from you:
  // `band` metres behind you it is at the top, the same distance ahead at the
  // bottom, level with you in the middle. Saturated, so the whole field is
  // drawn toward the fight rather than only the car nearest it.
  band() {
    const B = this.battle, me = this.entries.find(e => e.isPlayer);
    const pMe = me && !me.retired ? this.progress(me) : null;
    for (const e of this.entries) {
      const d = e.driver;
      if (!d || e.retired || d.ceiling == null) continue;
      const behindYou = pMe == null ? 0 : pMe - this.progress(e);
      const f = Math.max(0, Math.min(1, 0.5 + behindYou / (2 * B.band)));
      d.gripNow = d.ceiling * (B.lo + (B.hi - B.lo) * f + (d.bandOff || 0));
    }
  }

  // Which way the next real corner turns within `look` metres: +1 left,
  // -1 right, 0 if nothing worth diving for. The inside of it is where an
  // attack goes and what a defender covers.
  insideAhead(s, look) {
    const cur = this.lines.race.cur, t = this.track;
    const i0 = t.idx(s);
    let turn = 0;
    for (let k = 0; k < look / t.ds; k++) turn += (cur[(i0 + k) % t.n] || 0) * t.ds;
    return Math.abs(turn) > 0.35 ? Math.sign(turn) : 0;
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
      // Penalties are applied at the flag, because there is no pit lane to
      // serve them in yet. Until this line they were decoration: a car could
      // collect twenty-five seconds of them and still be classified ahead of
      // the car it took out, which makes the whole rulebook a label.
      if (a.finished && b.finished) return (a.finishTime + a.penalty) - (b.finishTime + b.penalty);
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
      // A car in the pit lane is in a different corridor, and `ds`/`dl` are in
      // TRACK space — so it is not traffic and it is not air. Skipping it here
      // is one line that covers four things at once: nobody picks it as the car
      // ahead, nobody caps their speed to its 80 km/h limit, nobody pulls out
      // to attack it, and nobody sits in a tow from a car that is in its box.
      // That last one is the trap: at `dl` near zero, relative to a car on the
      // straight, a stationary car in a pit BOX would otherwise read as a tow.
      if (e.inPit) { e.car.dirty = 0; e.car.tow = 0; continue; }
      for (const o of this.entries) {
        if (o === e || o.retired || o.inPit) continue;
        const ds = t.gap(o.proj.s, e.proj.s);
        const dl = Math.abs(o.proj.lat - e.proj.lat);
        if (ds > 0 && ds < 90) {
          // One wake, not two effects. A car's drag IS momentum taken out of
          // the air, and dirty air and the tow are that same deficit seen from
          // two sides — so they come from one call and cannot drift apart.
          // The range gate is wakeAt's own, which is why this one is 90 rather
          // than the 70 it used to be: two places deciding how far a wake
          // reaches is exactly the kind of pair that drifts.
          if (wakeAt(W, ds, dl, o.car.spec)) {
            if (W.dirty > dirty) dirty = W.dirty;
            if (W.tow > tow) tow = W.tow;
          }
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

    // MEASURED AND REJECTED: an opening-lap caution.
    //
    // The obvious theory was that twenty-two cars arriving at turn one together
    // is what destroys a race, so rivals should run longer gaps and refuse half
    // a move for the first twenty seconds. Four single races appeared to show
    // it made things WORSE, which was not true either — a race is chaotic and
    // one contact at turn one rewrites everything after it, so a single race
    // cannot measure a tuning constant at all.
    //
    // `tools/fieldcheck.mjs` (4 circuits x 4 seeds, both ways) settled it:
    //   caution off   7.25 retired of 22   104 passes   255 contacts
    //   caution on    7.13 retired of 22    85 passes   208 contacts
    // No effect on retirements, and it cost a fifth of the overtaking. A grid
    // can always be made to stop crashing by making it stop racing, and this
    // one did not even stop crashing.
    //
    // The same table says why: only 0.5 to 4.25 of those retirements happen in
    // the first thirty seconds. MOST OF THEM ARE NOT TURN ONE. They are spread
    // through the race, which points at the thing DESIGN.md already names — a
    // car that has lost its front wing keeps driving as though it has one.

    // ---- peeling off for the pit entry --------------------------------------
    // CORRECTION, and it is mine: I wrote "MEASURED: pit stops made retirements
    // worse, 5.25 -> 6.25" into a commit message, and that difference is about
    // 1.6 standard errors on 16 races a side. It is not a result. At six laps
    // it was 5.42 -> 5.92, well inside the noise, and tools/fieldcheck.mjs now
    // prints the standard error next to the mean so the same mistake is harder
    // to make. I built the tool that says one race measures nothing and then
    // treated an unresolvable difference as causal evidence.
    //
    // What the same runs DO resolve, far outside the noise: cars finishing
    // with a missing front wing fell 4.17 -> 2.83 with pit stops on, and
    // overtaking went UP rather than down.
    //
    // This change stays regardless, because it is right on its own terms
    // rather than because a number moved. js/pitstop.js brakes for
    // the entry and deliberately leaves the steering to the driver — so a car
    // was shedding 220 km/h over the last 300 m of a straight WHILE STILL ON
    // THE RACING LINE, in traffic, at Monza. That is not a pit entry, it is a
    // brake test. That is wrong whatever the retirement count says.
    //
    // A real car moves to the pit side first, and that is a lateral bias,
    // which lives here. Off the line, the followers' lateral gate stops seeing
    // it as the car in front at all, which is the actual mechanism that keeps
    // the cars behind out of the back of it.
    const pitting = e.pitPhase === 'approach';
    if (pitting && this.lane) {
      bias += (Math.sign(this.lane.off) || 1) * lim * 1.5;
    }

    // ---- attack -------------------------------------------------------------
    // Adam, 2026-09-23: "racing feels like im racing a bunch of ghost overlays".
    // The old attack pulled to whichever side the car ahead was NOT on, every
    // tick, so it never chose anything — it drifted. A real attack is a plan:
    // pick the INSIDE of the next corner, commit to it, and if the defender has
    // already shut that door, go round the outside and set up the switchback.
    const lineOff = this.lines.race.off[i];
    const L = this.spec.bodyL;
    const moveGap = d.moveGap ?? 3.5;
    let want = 0, lunge = 0, pressure = 0;
    const reach = this.battle ? 1.8 : 1.4;
    if (!pitting && e.ahead && e.aheadGapT < reach && !e.inPit) {
      const o = e.ahead;
      const ds = t.gap(o.proj.s, e.proj.s);
      const braking = this.brakingZone(e.proj.s, 130);
      // Re-plan every 2.5 s, on a new target, or the moment the defender shuts
      // the door on the side already chosen — that last one is the switchback.
      const shut = e.atkOn === o && o.proj.lat * e.atkSide > 1.4 && Math.abs(o.proj.lat - e.proj.lat) < 1.6;
      if (e.atkOn !== o || this.time - e.atkAt > 2.5 || (shut && this.time - e.atkAt > 0.8)) {
        const inside = this.insideAhead(e.proj.s, 200);
        let side = inside || (o.proj.lat > e.proj.lat ? -1 : 1);
        // The door is shut: they are already sitting on the inside.
        if (inside && o.proj.lat * inside > 1.4) side = -inside;
        e.atkSide = side; e.atkAt = this.time; e.atkOn = o;
      }
      // Out of the slipstream late, not from a second back: sit in the tow
      // down the straight, then pull out once there is nothing left to gain.
      const pull = braking ? 0.75 + 0.5 * d.aggression
                 : ds < 30 ? 0.55 + 0.4 * d.aggression : 0.35;
      want += e.atkSide * pull * Math.max(0.8, t.w[i] - 2.2) * Math.min(1, (reach - e.aheadGapT) / 1.0);
      // The dive: brake later than the line says, once you are out of their
      // wake and nearly alongside. The tyres decide whether it sticks.
      if (braking && ds < L * 2.2 && Math.abs(o.proj.lat - e.proj.lat) > 1.2) {
        lunge = (d.lungeMax ?? 0.02) * d.aggression;
      }
      if (ds < 25) pressure = 0.6;
    }

    // ---- defence ------------------------------------------------------------
    // Two moves, and both are ONE decision at a time rather than a weave:
    //   into a braking zone, cover the inside;
    //   on a straight, when the car behind pulls out of your wake, go with it
    //   and shut the door before it has a nose alongside.
    // How often a defender may change its mind is `moveGap` — 3.5 s is the
    // gentlemanly default; the OVERTAKES submodes shorten it, and that is the
    // swerve. Nobody moves once a car is actually alongside: the ROOM clamp
    // below makes sure of that whatever this block asks for.
    // A car on its way to the pits does not defend. It has somewhere to be.
    const defendT = this.battle ? 1.0 : 0.75;
    if (!pitting && e.behind && e.behindGapT < defendT && !e.inPit) {
      const o = e.behind;
      const ds = t.gap(e.proj.s, o.proj.s);          // + : they are behind me
      const dl = o.proj.lat - e.proj.lat;
      const braking = this.brakingZone(e.proj.s, 150);
      let move = 0;
      if (braking) move = this.insideAhead(e.proj.s, 220) || -Math.sign(lineOff) || 1;
      else if (d.defence > 0.5 && ds > L * 1.05 && ds < 28 && Math.abs(dl) > 0.9) move = Math.sign(dl);
      if (move && move !== e.lastMove && this.time - e.movedAt > moveGap) {
        e.lastMove = move; e.movedAt = this.time;
      }
      if (move || this.time - e.movedAt < 1.2) {
        want += e.lastMove * d.defence * Math.max(0.6, t.w[i] - 2.4) * 0.85;
      }
      pressure = Math.max(pressure, Math.min(1, 1 - e.behindGapT / defendT));
    }
    // Smoothed: a car changes lane at a few metres a second. It used to teleport
    // its target, and the controller made that look like a twitch rather than a
    // move. (The pit peel-off above is added unsmoothed, as it always was.)
    const slew = (3.0 + 2.5 * d.aggression) * NEIGH_EVERY * FIXED_DT;
    bias += e.biasS + Math.max(-slew, Math.min(slew, want - e.biasS));

    // DO NOT DRIVE INTO SOMEONE WHO IS ALONGSIDE.
    //
    // This claimed to override attack and defence and it did not. It
    // SUBTRACTED at most 3.8 * 0.7 = 2.66 m from a bias the attack branch
    // above can push past four — so wanting the line outvoted leaving room,
    // every time, and nothing in it knew where the wall was. Adam: "he kept
    // like pushing and i tried to fight it but he just ran me into the wall
    // causing my death".
    //
    // A clamp cannot be outvoted. This car may put itself anywhere it likes
    // except inside ROOM of a car that is beside it.
    const ROOM = 2.6;                       // a car is 2 m wide; this is that, plus a door
    let yieldTo = null;
    for (const o of this.entries) {
      if (o === e || o.retired || o.inPit) continue;
      if (Math.abs(t.gap(o.proj.s, e.proj.s)) > 7) continue;
      const dl = o.proj.lat - e.proj.lat;   // + = they are on my left
      const keep = dl > 0 ? (o.proj.lat - ROOM) - lineOff
                          : (o.proj.lat + ROOM) - lineOff;
      const before = bias;
      bias = dl > 0 ? Math.min(bias, keep) : Math.max(bias, keep);
      // AND IF LEAVING ROOM MEANS LEAVING THE CIRCUIT, THERE IS NO ROOM.
      //
      // The answer to that is the brake, not the other car's door. Without
      // this the clamp just gets undone by the track limit below and the
      // squeeze happens anyway — which is the whole incident, because the
      // car being squeezed is the one with the wall on its far side.
      if (Math.abs(bias + lineOff) > lim) {
        bias = before;
        yieldTo = Math.min(yieldTo ?? Infinity, o.car.speed * 0.94);
      }
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

    // The yield goes on last, so the car-following cap above cannot undo it.
    // Backing out of a move you have no room for is not optional.
    if (yieldTo != null) speedCap = Math.min(speedCap ?? Infinity, yieldTo);

    const off = this.lines.race.off[i];
    bias = Math.max(-lim - off, Math.min(lim - off, bias));
    // What the slew starts from next time is where the car was ALLOWED to go,
    // pit bias excluded (it is re-added fresh each pass).
    e.biasS = bias - (pitting && this.lane ? (Math.sign(this.lane.off) || 1) * lim * 1.5 : 0);
    e.ctx = { offBias: bias, speedCap, lunge: yieldTo != null ? 0 : lunge, pressure };
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
    if (this.battle && this.time - this.bandAt > BAND_EVERY) { this.bandAt = this.time; this.band(); }
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
        // Safety car. Applied AFTER the driver for the same reason the pit
        // controller is: a driver that runs second simply writes its own
        // throttle back over the cap every substep.
        if (this.safety > 0 && !e.inPit) {
          if (car.speed > SAFETY_SPEED) {
            car.throttle = 0;
            car.brake = Math.max(car.brake, Math.min(0.45, (car.speed - SAFETY_SPEED) * 0.10));
          } else car.throttle = Math.min(car.throttle, 0.32);
        }
      }
      // A car being pushed is not driving, whoever is nominally at its wheel.
      if (e.recover) { car.throttle = 0; car.brake = 0; }

      // ---- the pit stop ---------------------------------------------------
      // AFTER the driver, never before. The pit controller overrides the
      // pedals on the approach and takes the car over completely in the lane,
      // and a driver that runs second simply writes its own throttle back over
      // the entry braking every substep.
      //
      // Asking to pit is the DRIVER's decision, not the rulebook's — this is
      // the one line of it the session owns, and it owns it only because
      // nothing else iterates the field.
      if (racing && !e.finished && this.pits) {
        if (!e.isPlayer && !e.pitRequest && e.pitPhase !== 'service' && shouldPit(car)) {
          e.pitRequest = true;
          this.log('flag', `${e.name} WILL PIT`, e);
        }
        const wasIn = e.inPit;
        if (updateStop(e, t, this.lane, e.proj, dt, this.peak)) {
          this.log('flag', `${e.name} SERVED — ${(e.pitJobs || []).join(' + ')}`, e);
        }
        if (e.inPit && !wasIn) this.log('flag', `${e.name} PITS`, e);
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
      // The barrier test asks how far this car is from the centreline, and for
      // a car in the pit lane the answer is seventeen metres — so running it
      // would shove the car back onto the racing line mid-stop.
      const hit = e.inPit ? null : resolveBarrier(car, t, e.hint);
      if (hit && hit.harm) { e.contacts++; this.log('crash', `${e.name} INTO THE BARRIER`, e); }
      // The player's own contacts, handed up for the rumble and the toast. The
      // screen must not test for a hit a second time: two places deciding what
      // counts as contact is how they come to disagree.
      if (hit && e.isPlayer && hit.closing > 3.5) {
        e.bump = { what: 'barrier', closing: hit.closing, harm: hit.harm, part: hit.part };
      }
      // NO DNF: the damage still counts — the wings still come off, the pit
      // stop still has work to do — it just never reaches the retirement line.
      // Upside down, the car is put back on its wheels where it lies.
      if (e.isPlayer && this.noDnf) {
        car.damage = Math.min(car.damage || 0, 0.95);
        if (car.onRoof && car.speed < 8) {
          car.onRoof = false; car.airborne = false;
          car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
          this.log('crash', `${e.name} BACK ON FOUR WHEELS`, e);
        }
      }
      if (car.damage >= 1 && !e.retired) { e.retired = true; this.log('crash', `${e.name} RETIRES`, e); }
      // A car on its roof is not rejoining. Retire it once it has stopped
      // sliding, or it keeps being classified and crawls round for the rest of
      // the race: measured, an upside-down car dragged the field spread from
      // 12 s to 162 s because its "best lap" was still being counted.
      if (!e.retired && car.onRoof && car.speed < 8) {
        e.retired = true; this.log('crash', `${e.name} IS UPSIDE DOWN`, e);
      }
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
        } else if (!e.pastHalf) {
          // Back over the line and forward again without having been anywhere:
          // a car shoved backwards in a start-line pile-up. Not a lap — that is
          // how Kate Mascoi's first 12-car race logged a 0:00.025 best lap.
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

      // Track limits used to live here: a counter, a message, and five seconds
      // added to your race by a line of text. Deleted on purpose. Running wide
      // already costs you — the runoff has nine times the rolling drag of
      // tarmac and 58% of the grip, both in physics.js — so the circuit
      // punishes it without anyone being told off. If a rule can only be felt
      // by reading about it, it is not part of the game.

      // Beached. Nobody teleports any more.
      //
      // The old version snapped the car back onto the racing line at 9 m/s the
      // instant it had been still for four seconds, which meant putting it in
      // a gravel trap cost you nothing and taught you nothing. Now the
      // marshals come and push, it takes PUSH_TIME to heave a car out, and
      // while there are people stood on a live circuit the safety car is out
      // for everybody. That is what really happens, and it is the only version
      // where being stuck is something you feel rather than something you read.
      //
      // A car serving a twelve-second nose change is also stationary and
      // seventeen metres off the centreline, which is exactly what beached
      // looks like — hence the inPit guard, or it gets "rescued" out of its
      // own pit stop three times.
      if (racing && !e.finished) {
        if (!e.recover && !e.inPit && e.car.speed < 3.2 && Math.abs(e.proj.lat) > e.proj.w) e.stuck += dt;
        else if (!e.recover) e.stuck = 0;
        if (e.stuck > 4 && !e.recover) {
          const s0 = e.proj.s - 14;
          const lp = t.point(s0, this.lines.race.off[t.idx(s0)] || 0);
          e.recover = { t: 0, x0: e.car.x, y0: e.car.y, h0: e.car.hdg, to: lp };
          e.stuck = 0;
          this.safety = Math.max(this.safety, SAFETY_TIME);
        }
        if (e.recover) {
          const R = e.recover;
          R.t += dt;
          const k = Math.min(1, R.t / PUSH_TIME);
          // Smoothstep: a crew heaves a car, it does not yank it.
          const f = k * k * (3 - 2 * k);
          e.car.x = R.x0 + (R.to.x - R.x0) * f;
          e.car.y = R.y0 + (R.to.y - R.y0) * f;
          let dh = R.to.hdg - R.h0;
          while (dh > Math.PI) dh -= 2 * Math.PI;
          while (dh < -Math.PI) dh += 2 * Math.PI;
          e.car.hdg = R.h0 + dh * f;
          // Held still while they push, so the tyre model is not fighting four
          // marshals for control of the car.
          e.car.vx = 0; e.car.vy = 0; e.car.r = 0;
          if (k >= 1) { e.recover = null; e.car.vx = 6; }
        }
      }
    }

    if (this.safety > 0) this.safety = Math.max(0, this.safety - dt);

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
        // NO inPit GUARD HERE, DELIBERATELY — and this is the one place the
        // pit-lane contract asked for one.
        //
        // The worry was a phantom shunt: a car in the lane and a car on the
        // straight can share an `s`, and matching `s` says nothing about how
        // close they are. But `resolveCars` is a SAT test on two oriented boxes
        // in WORLD space — it never looks at `s` — so seventeen metres of pit
        // lane separates them and it simply returns null. Only the broad phase
        // above uses `s`, and being handed a pair it rejects costs nothing.
        //
        // Skipping the pair would be worse than useless. At the PIT EXIT the
        // lane converges with the track, which is where a car in the lane and a
        // car on the circuit really are alongside — so a guard here would
        // switch collision off at the exact place pit-exit incidents happen.
        // Measured with tools/pitcheck.mjs: 0 contacts in seven seconds with a
        // car pinned to a racing car's `s` at the lane offset, guard or no
        // guard. The hazard is real-sounding and the code already handles it.
        const hit = resolveCars(live[i].car, live[j].car);
        if (hit && (live[i].isPlayer || live[j].isPlayer) && hit.closing > 2) {
          const you = live[i].isPlayer ? live[i] : live[j];
          you.bump = { what: 'car', closing: hit.closing, harm: hit.harm };
        }
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

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
