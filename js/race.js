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
// Race control — safety car, VSC, red flag, restarts, flags (2026-09-30).
import { Director } from './safetycar.js';

// Module-level scratch for the wake sample. neighbours() is single-threaded and
// reads the result immediately, so one object serves the whole grid rather than
// allocating 462 of them per pass.
const W = newWake();

// Names, numbers, teams, colours and personalities all live in
// js/drivers.js now — see its header for why one table drives all of it.

const PIT_LIMIT = 80 / 3.6;
const NEIGH_EVERY = 4;        // substeps between neighbour/racecraft updates
// The safety car, the VSC and the red flag live in js/safetycar.js now, and
// only ever for a reason on the circuit — there is still no scripted caution.
// An opening-lap one was built, measured over N circuits x N seeds and
// deleted: it changed nothing (7.25 -> 7.13 retired of 22) and cost a fifth of
// the overtaking (104 -> 85 passes). See the note further down.
const PUSH_TIME = 8;          // s for a crew to heave a car back to the tarmac
const BAND_EVERY = 0.5;       // s between OVERTAKES band updates
// SUPERCASUAL's leash, in seconds at the circuit's mean racing-line speed: a
// rival further ahead of you than LEASH_FROM gives up LEASH_SLOPE of its target
// speed per extra second, never more than down to LEASH_MIN.
const LEASH_FROM = 2.5, LEASH_SLOPE = 0.15, LEASH_MIN = 0.62;
const MERGE_RATE = 0.55;      // m/s a car drifts from its grid box to the line

// ---- THE DUEL (Adam, 2026-09-28) -------------------------------------------
// "its more like flying at the same speed fighting for inches, building,
// building, then FINALLY overtaking and its a celebration ... but still they
// shouldnt fly away from u bc a missed brake point".
//
// The cars AROUND you drive at YOUR pace. Not a speed multiplier: a grip
// fraction, re-solved, exactly as difficulty always has been — so a car that
// stays with you is a car braking where you brake and carrying what you carry
// through the corner. Each of the DUEL_N cars either side of you keeps a gap
// to you in mind (DUEL_GAP for the next one, DUEL_STEP more per car after) and
// trims its grip toward holding it:
//   too far up the road  -> eases quickly (K_WAIT) — nobody escapes a mistake
//   you are closing       -> firms up slowly (K_FIRM) — you EARN the gap back
//   too far behind you    -> digs in (K_CHASE) — the mirrors fill up again
// and inside DUEL_FREEZE of you it stops adjusting altogether. Close up it is
// racecraft, the tow, DRS and nerve that decide it, never the band.
//
// MEASURED, tools/battlecheck.mjs --car f1 --battle medium --you casual,
// Monza/Suzuka/Zandvoort x 4 seeds, --duel 0 (before) vs 1 (after), ± SE:
//   places swapped with you / race   15.2 ± 1.8  ->  5.5 ± 1.3
//   car ahead within 1 s             72 ± 5 %    ->  85 ± 2 %
//   car behind within 1 s            50 ± 7 %    ->  77 ± 4 %
//   your contacts                     8.3 ± 1.8  ->  2.2 ± 0.9
//   held passes celebrated / race      —         ->  1.4 ± 0.4
// fieldcheck (22 cars, MEDIUM, nobody at the wheel): retired 3.6 ± 0.6 ->
// 2.0 ± 0.5, passes 100 -> 70, contacts 167 -> 96. `duel: false` reproduces
// the old race byte for byte.
const DUEL_N = 3, DUEL_GAP = 0.55, DUEL_STEP = 0.75, DUEL_FREEZE = 0.45;
const K_WAIT = 0.05, K_FIRM = 0.005, K_CHASE = 0.012;
// Outside SUPERCASUAL's OVERTAKES window the tiers keep their meaning: a
// neighbour may only trim its OWN grip, by this much down and this much up.
const DUEL_DOWN = 0.05, DUEL_UP = 0.025;
// ...for CASUAL/MEDIUM/HARD (no OVERTAKES window) the neighbours' own-grip
// window. Swept 2026-09-29, MEDIUM, 22 cars, you at MEDIUM from P12, 24 races
// a side: 0.05/0.025 -> 0.11/0.05 took "any rival within 1 s" 50 +- 3% ->
// 63 +- 4% (2.6 SE) and the car ahead within 1 s 39 -> 50%; swaps with you
// 3.9 -> 3.3, your contacts 2.5 -> 1.4, rivals out 0.8 -> 0.6 (all noise-level
// or better). Only the three cars either side move, and only within their
// own grip +-: the field's pace is still the tier's (rivals' median best lap
// 107.5 -> 108.8 s, +-2.6, not resolved).
const TIER_DOWN = 0.11, TIER_UP = 0.05;
// After YOUR mistake: a neighbour more than DUEL_SLACK s past the gap it
// wants may drop DUEL_DOWN_FAR below the window, and it is leashed from there.
// Swept 2026-09-29 (battlecheck --blunder 3, 24 races a side): K_WAIT 0.022
// -> 0.05, SLACK 1.0 -> 0.6, DOWN_FAR 0.12 -> 0.18 took "still > 2 s behind
// 20 s after a 3 s stop" from 32 +- 8% to 8 +- 5%; back within 1 s ~14 s.
const DUEL_SLACK = 0.6, DUEL_DOWN_FAR = 0.18;
// PUNISHMENT (Adam, 2026-10-03: "if im off track, the cars take ts, they
// should launch forward past me and punish me"). While all four of your wheels
// are off the road, and for PUNISH_T s after you rejoin, nobody waits for you:
// every rival drives at the top of its window, with no leash. The duel's usual
// patience comes back afterwards.
const PUNISH_T = 4;
// "Building, building": an attacker sits in the car ahead's tow, within
// 0.8 s, for BUILD_T * (1.5 - aggression) seconds before it commits — pulls
// out of the slipstream, goes for the inside, lunges. Until then it follows,
// on the line, in the tow, which is the building. A committed attempt that
// has not put it alongside within TRY_T is over: tuck back in, build again.
// Measured first (tools/_duelwhy.mjs classifies every swap): in a 12-car
// train everybody is always within 0.8 s, so a gate that only filled was
// always open. It has to EMPTY on an attempt.
const BUILD_T = 10, TRY_T = 9;
// How much of its own lunge a defender uses when braking late on the inside.
const DEF_LUNGE = 0.45;
// DRS: within DRS_GAP s of the car ahead at a zone's detection line opens the
// flap for that zone, from the start of lap DRS_FROM_LAP + 1, never behind the
// safety car. Only for a car whose spec has one (physics.js CARS.f1.drs).
const DRS_GAP = 1.0, DRS_FROM_LAP = 1;
// ...and only where the road is straight: a zone drawn through a corner
// shuts the flap wherever the centreline bends tighter than 1/DRS_CURV metres
// (280 m: Kate Mascoi's bank is ~200 m, the flat-out kinks after it 320 m+).
// Kate's zones themselves now sit where F1 puts them (data/tracks/kate.json):
// detection before a corner, activation on the straight after it, ending
// before the next braking zone — the 2.5 km zone through the bank is gone.
const DRS_CURV = 1 / 280;
// Celebrate the pass: YOUR overtake counts once the car is behind you for
// CHEER_HOLD s and you are clear of it by half a car.
const CHEER_HOLD = 2.0;

export class Race {
  constructor({ track, lines, spec, slots, laps = 5, grid = 22, playerGrid = 10,
                tier = 'medium', seed = 1, player = true, pits = true, noDnf = false, order = null,
                battle = null, duel = true, drs = true, rules = true, standIn = false, sideLock = true, styles = true, playerTeam = null }) {
    this.track = track; this.lines = lines; this.spec = spec;
    // STAND-IN: a bot at YOUR wheel (a harness, the home page's backdrop).
    // Racecraft then runs for your car too, so `me.ctx` carries the traffic,
    // the pit approach and race control's limits; your pedals still come in
    // through tick()'s playerInput. Without it the stand-in drove blind and
    // rear-ended its way out on lap one (tools/rulescheck.mjs [speeding]).
    this.standIn = !!standIn;
    // `sideLock: false` is the race before SIDE BY SIDE, for an A/B (battleshape --side 0).
    this.sideLock = !!sideLock;
    // `styles: false` drives everyone as before STYLE existed (A/B).
    this.styles = !!styles;
    // The 2026-09-28 racecraft (see DUEL above). `duel: false` is the
    // previous behaviour exactly, kept for tools/battlecheck.mjs --duel 0.
    this.duel = !!duel;
    this.drsRule = !!drs && !!duel && !!spec.drs;
    this.cheers = [];
    // NO DNF (Adam): YOUR car cannot retire. The bots still can.
    this.noDnf = noDnf;
    this.laps = laps; this.peak = peakSlip(spec);
    this.time = 0; this.state = 'grid'; this.lights = 3.2;
    this.safety = 0;            // s of safety car remaining, 0 = racing
    // The pit lane, made once per session: a path with an entry, an exit and a
    // box per car, not a lateral offset. js/pitstop.js owns all of it; the race
    // only decides WHEN, and then keeps its hands off a car whose `inPit` is set.
    this.lane = makeLane(track, Math.min(grid, slots.length));
    this.slots = slots;          // the grid, again, for a standing restart
    // Off for a sprint, and off for measuring what pit stops actually cost —
    // see tools/fieldcheck.mjs --pits 0.
    this.pits = pits;
    this.events = [];
    this.sub = 0;
    // SUPERCASUAL's OVERTAKES submode — see BATTLE in js/autopilot.js.
    this.battle = BATTLE[battle] || null;
    this.bandAt = 0;
    this.vRef = lines.race.v.reduce((a, b) => a + b, 0) / lines.race.v.length;

    const n = Math.min(grid, slots.length);
    this.entries = [];
    for (let k = 0; k < n; k++) {
      const slot = slots[k];
      // QUALIFYING (js/quali.js) hands over `order`: grid slot -> driver index,
      // -1 for you. Without it the grid is the driver table in order, as ever.
      const isPlayer = order ? order[k] === -1 : player && k === Math.min(playerGrid, n) - 1;
      // The roster (js/drivers.js) is everyone BUT you, so the cars behind
      // your slot take the next driver along, not the one after: the driver
      // who gives up a seat is the one setPlayerTeam chose, not whoever
      // happened to be listed at your grid position.
      const pIdx = !order && player ? Math.min(playerGrid, n) - 1 : -1;
      const who = order ? Math.max(0, order[k]) : (pIdx >= 0 && k > pIdx ? k - 1 : k);
      const car = makeCar({ cls: spec.key });
      const p = track.point(slot.s, slot.lat);
      car.x = p.x; car.y = p.y; car.hdg = slot.hdg; car.vx = 0.001;
      // WHO this is, WHAT they drive, and HOW they drive it — one table.
      const prof = driverAt(who);
      const team = teamOf(prof);
      const driver = isPlayer ? (standIn ? makeDriver(seed * 17 + 3, tier, track.corners.length || 24) : null)
        : applyProfile(makeDriver(seed * 131 + who, tier, track.corners.length || 24), prof, team);
      this.entries.push({
        car, driver, isPlayer, idx: k, box: k,
        name: isPlayer ? 'YOU' : prof.n,
        num: isPlayer ? 78 : prof.num,
        col: isPlayer ? (playerTeam ? playerTeam.col : '#ffffff') : team.col,
        team: isPlayer ? playerTeam : team,
        // Your teammate: the other car of the team you drive for.
        mate: !isPlayer && !!playerTeam && team === playerTeam,
        drive: isPlayer ? null : makeAutopilot(track, lines, spec, this.peak, { driver }),
        // Where this car sits relative to the racing line on the grid. Adam:
        // "when the cars start thry IMMEDIATLY go for the line, make them slowly
        // veer over to it like HUMANS". So the lateral target STARTS at the grid
        // box and drifts to the line at MERGE_RATE after the lights.
        biasS: slot.lat - (lines.race.off[track.idx(slot.s)] || 0), merge: true,
        atkSide: 0, atkAt: -99, atkOn: null,
        proj: track.project(p.x, p.y), hint: slot.i,
        lap: 0, gridPos: k + 1, pos: k + 1, crossed0: false, pastHalf: false,
        lapStart: 0, lastLap: null, bestLap: null,
        ahead: null, behind: null, aheadGapT: 99, behindGapT: 99,
        ctx: null, lastMove: 0, movedAt: -99,
        warnings: 0, penalty: 0, offNow: false, lastLimit: -99,
        contacts: 0, retired: false, finished: false, finishTime: null, bump: null,
        pitRequest: false, inPit: false, pitTimer: 0, pitStops: 0, stuck: 0,
        recover: null,
        // the duel: grip trim, how long it has been building on the car
        // ahead, which straight it is on and on which it last moved, DRS
        duelF: null, build: 0, seg: 0, moveSeg: -1, inZone: false,
        drsFor: null, drsOk: false,
      });
    }
    // THE GARAGES (js/pitstop.js garageLayout). A team's two cars share its
    // garage, one mark each, in the order the teams first appear on the grid.
    // YOU are nobody's teammate: you get the spare garage at the end of the
    // row, or, on a lane too short for one, your car's old team's.
    if (this.lane.garages) {
      const G = this.lane.garages, garageOf = new Map(), used = new Map();
      for (const e of this.entries) {
        if (e.isPlayer && !e.team) continue;
        const key = e.team ? e.team.name : e.name;
        if (!garageOf.has(key)) garageOf.set(key, garageOf.size % G);
        const g = garageOf.get(key), j = used.get(g) || 0;
        used.set(g, j + 1);
        e.box = g * 2 + (j % 2);
        if (e.isPlayer) e.garage = g;
      }
      // With a team you share its garage with your teammate; without one...
      const me = this.entries.find(e => e.isPlayer && !e.team);
      if (me) {
        const spare = garageOf.size < G ? garageOf.size : G - 1;
        me.box = spare * 2 + (used.get(spare) ? 1 : 0);
        me.garage = spare;
      }
    }
    this.me = this.entries.find(e => e.isPlayer) || null;
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
        // Their mistake RATE and their wobble come from the submode, not from
        // SUPERCASUAL. errScale multiplies the tier's rate, so rescale it.
        const r = B.mistakes / d.T.mistakes;
        d.errScale = (d.errScale ?? 1) * r;
        d.nextMistake /= Math.max(0.2, r);
        d.consistency = B.consistency;
      }
      this.band();
    }
    // Pace matching around you happens in every tier when you are racing.
    this.duelOn = this.duel && !!this.me;
    this.order();
    // RACE CONTROL (js/safetycar.js). `rules: false` is the race before it:
    // no safety car, no VSC, no flags, no red — for an A/B, and ?sc=0.
    this.rc = new Director(this, { on: rules, rng: mulberry(seed * 7919 + 11) });
    this.sideRng = mulberry(seed * 313 + 5);
  }

  // ---- the OVERTAKES band --------------------------------------------------
  // Where in its grip window each rival drives, from how far it is from you:
  // `band` metres behind you it is at the top, the same distance ahead at the
  // bottom, level with you in the middle. Saturated, so the whole field is
  // drawn toward the fight rather than only the car nearest it.
  band() {
    const B = this.battle, me = this.me;
    const pMe = me && !me.retired ? this.progress(me) : null;
    // Who is next to you, counted outward: +1 is the car directly ahead, -1
    // the car directly behind. Only these get the duel trim.
    const duel = this.duelOn && pMe != null && this.state === 'green' && this.time > 8;
    if (duel) this.rankAroundMe(pMe);
    const punish = pMe != null && this.state === 'green' && this.time - (this.meOffAt ?? -1e9) < PUNISH_T;
    for (const e of this.entries) {
      const d = e.driver;
      if (!d || e.retired || d.ceiling == null) continue;
      if (!B) {
        // MEDIUM, HARD, CASUAL: only the neighbours are touched, and only
        // inside their own grip, so the tier still means what it says.
        if (punish && !e.inPit) {
          // Off the road is an open door: everybody goes for it, flat out.
          const own = d.grip / d.ceiling;
          e.duelF = Math.min(1.0, own + TIER_UP);
          d.gripNow = d.ceiling * e.duelF;
          e.hold = 1;
        } else if (duel && e.rank && Math.abs(e.rank) <= DUEL_N && !e.inPit) {
          const own = d.grip / d.ceiling;
          if (e.duelF == null) e.duelF = own;
          this.duelTrim(e, own - TIER_DOWN, Math.min(1.0, own + TIER_UP));
          d.gripNow = d.ceiling * e.duelF;
        } else if (d.gripNow != null) { d.gripNow = null; e.duelF = null; }
        continue;
      }
      const behindYou = pMe == null ? 0 : pMe - this.progress(e);
      const f = Math.max(0, Math.min(1, 0.5 + behindYou / (2 * B.band)));
      // The band sets WHERE in the window; the car and the driver still set
      // the order inside it. Without paceMul the band erased the teams.
      let frac = B.lo + (B.hi - B.lo) * f;
      // Near you the distance band hands over to the duel: the window is the
      // same, what picks the spot in it is the gap you are fighting over.
      if (duel && e.rank && Math.abs(e.rank) <= DUEL_N && !e.inPit) {
        if (e.duelF == null) e.duelF = frac;
        // A car that got away because YOU erred may go further down than
        // the window, until the gap is back (DUEL_SLACK past what it wants).
        const far = e.rank > 0 && e.gapMe > DUEL_GAP + DUEL_STEP * (e.rank - 1) + DUEL_SLACK;
        this.duelTrim(e, B.lo - (far ? DUEL_DOWN_FAR : DUEL_DOWN), B.hi);
        frac = e.duelF;
      } else e.duelF = null;
      if (punish && !e.inPit) { frac = B.hi; e.duelF = frac; }
      d.gripNow = d.ceiling * frac * (d.paceMul ?? 1);
      // THE LEASH (Adam, 2026-09-24: "you're never more than 5 secs behind
      // everyone ... it feels like missing a brake point and auto losing").
      // Grip alone cannot keep a field near you: it only acts in corners, and
      // a car 20 s up the road on a straight is drag-limited whatever its
      // tyres. So a rival more than LEASH_FROM seconds ahead of you drives to
      // a lower target speed everywhere — gently, in proportion to how far
      // out it is — until it is back inside. The front of the field waits,
      // the back of it keeps racing, and the whole thing closes into a train.
      // Measured before: worst gap to the leader after a 4 s blunder a lap
      // was 40 s (tools/battlecheck.mjs --blunder 4).
      const aheadT = pMe == null ? 0 : -behindYou / this.vRef;
      // THE DUEL'S LEASH is shorter: the car you were fighting waits from
      // DUEL_SLACK past its gap, not from 2.5 s, so a missed braking point
      // costs you the fight for a while, not the fight for good.
      const from = duel && e.rank > 0 && e.rank <= DUEL_N
        ? Math.min(LEASH_FROM, DUEL_GAP + DUEL_STEP * (e.rank - 1) + DUEL_SLACK) : LEASH_FROM;
      e.hold = punish ? 1 : aheadT > from ? Math.max(LEASH_MIN, 1 - (aheadT - from) * LEASH_SLOPE) : 1;
    }
  }

  // The nearest car ahead within `gate` metres laterally and 150 m along.
  laneAhead(e, gate) {
    let best = null, bd = 150;
    for (const o of this.entries) {
      if (o === e || o.retired || o.inPit) continue;
      const ds = this.track.gap(o.proj.s, e.proj.s);
      if (ds > 0 && ds < bd && Math.abs(o.proj.lat - e.proj.lat) < gate) { bd = ds; best = o; }
    }
    return best;
  }

  // Rank every live rival by where it is relative to you: e.rank = +1 for the
  // car directly ahead, -1 directly behind, 0 for nobody near enough to count
  // (pit lane, retired). e.gapMe is the signed gap in seconds at the circuit's
  // mean racing-line speed, + = up the road from you.
  rankAroundMe(pMe) {
    const up = [], down = [];
    for (const e of this.entries) {
      e.rank = 0;
      if (e.isPlayer || e.retired || e.inPit || e.finished) continue;
      e.gapMe = (this.progress(e) - pMe) / this.vRef;
      (e.gapMe > 0 ? up : down).push(e);
    }
    up.sort((a, b) => a.gapMe - b.gapMe).forEach((e, k) => { e.rank = k + 1; });
    down.sort((a, b) => b.gapMe - a.gapMe).forEach((e, k) => { e.rank = -(k + 1); });
  }

  // One step of the duel trim on e.duelF, kept inside [lo, hi]. See DUEL.
  duelTrim(e, lo, hi) {
    const k = e.rank, gap = e.gapMe;
    const want = Math.sign(k) * (DUEL_GAP + DUEL_STEP * (Math.abs(k) - 1));
    const err = Math.max(-2, Math.min(2, gap - want));   // + = further up the road than wanted
    if (Math.abs(gap) > DUEL_FREEZE) {
      const rate = k > 0 ? (err > 0 ? K_WAIT : K_FIRM) : (err < 0 ? K_CHASE : K_FIRM);
      e.duelF -= rate * err * BAND_EVERY;
    }
    e.duelF = Math.max(lo, Math.min(hi, e.duelF));
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

  log(kind, text, e = null, code = null) {
    this.events.push({ t: this.time, kind, text, car: e ? e.idx : null, code });
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

  // ---- A WRECK KEEPS GOING ----------------------------------------------------
  // Adam, 2026-10-04: "when i crash i keep rolling and hitting stuff untill im
  // stationary". A car used to stop being simulated the instant it was marked
  // retired — which is the instant of the impact, so it hung in the air at
  // whatever speed it had (ffb.log: airborne, 49 m/s, for twenty seconds, and
  // a dead wheel). Retired means nobody is driving it, not that physics has
  // finished with it: it slides, tumbles and hits the barriers until it has
  // really come to rest. Other cars do not collide with it (they cannot see a
  // wreck yet, and a field ploughing into one is a pile-up by construction).
  wreckStep(e, dt) {
    const t = this.track, car = e.car;
    car.throttle = 0; car.brake = 0.5;
    e.proj = t.project(car.x, car.y, e.hint, 8); e.hint = e.proj.i;
    const pr = e.proj, al = Math.abs(pr.lat);
    let surface = SURFACE.track;
    if (al > pr.w + pr.run) surface = SURFACE.grass;
    else if (al > pr.w + 1.2) surface = SURFACE.runoff;
    else if (al > pr.w) surface = SURFACE.kerb;
    step(car, dt, { surface, bank: pr.bank, bankDir: Math.sign(pr.curv), dirty: 0, tow: 0, rollMul: dragFor(surface),
                    slope: this.slopeAt ? this.slopeAt(pr.s) * Math.cos(car.hdg - t.hdg[pr.i]) : 0 });
    const hit = resolveBarrier(car, t, e.hint);
    if (hit && e.isPlayer && hit.closing > 3.5) e.bump = { what: 'barrier', closing: hit.closing, harm: hit.harm, part: hit.part };
    const still = car.speed < 0.6 && Math.abs(car.vz || 0) < 0.3 && Math.abs(car.pRate || 0) < 0.3 && Math.abs(car.rRate || 0) < 0.3;
    e.restT = still ? (e.restT || 0) + dt : 0;
    if (e.restT > 1.0) { e.atRest = true; car.vx = 0.0001; car.vy = 0; car.r = 0; car.vz = 0; car.pRate = 0; car.rRate = 0; }
  }

  // ---- SIDE BY SIDE (Adam, 2026-10-03) ---------------------------------------
  // "more battles where we're speeding side by side through corners ... lead
  // up 60%, battle 35%, overtake 5%". Measured before this existed
  // (tools/battleshape.mjs, Monza + Suzuka): 90 / 2 / 8 — cars followed for
  // ages and, once a nose was alongside, the move was over in a moment. So
  // alongside is a phase of its own now. The pair LOCKS: each holds its lane,
  // inside and outside; whichever edges ahead lifts to keep them level; and
  // they race like that for a few corners — longer between two drivers who
  // like it (STYLE.side). Then it is decided: the loser lifts and tucks in.
  sideBySide(e, blocked) {
    const t = this.track, L = this.spec.bodyL, now = this.time;
    let S = e.side;
    if (S) {
      const p = S.o;
      // A fight is at racing speed or it is not a fight: keeping level with a
      // car that has slowed right down parks the attacker beside it and the
      // field behind runs into both (tools/rearcheck.mjs, 0 -> 2 rear-ends).
      const vl = this.lines.race.v[e.proj.i];
      const slow = e.car.speed < vl * 0.7 || p.car.speed < this.lines.race.v[p.proj.i] * 0.7;
      const gone = !p || p.retired || p.inPit || p.finished || e.inPit || this.rc.neutral || slow
        || Math.abs(t.gap(p.proj.s, e.proj.s)) > L * 2.5
        // A real excursion, not a wheel on the kerb: at w + 1 the lock broke the
        // instant it formed, 701 times out of 708 at Monza.
        || Math.abs(e.proj.lat) > e.proj.w + 3.5 || Math.abs(p.proj.lat) > p.proj.w + 3.5
        || now > S.until + 4;
      if (gone) { this.unlock(e); return null; }
      if (now > S.until && !S.done) this.resolveSide(e);
      const rel = t.gap(e.proj.s, p.proj.s);              // + : I am ahead
      S.cap = null;
      if (S.done) {
        if (S.lose) S.cap = p.car.speed * 0.95;           // lift, and let them go
        if (Math.abs(rel) > L * 1.3) { this.unlock(e); return null; }
      } else {
        // Keep level: the one edging ahead eases off until they are door to door.
        if (rel > 1.2) S.cap = Math.max(p.car.speed - 6, p.car.speed - (rel - 1.2) * 1.2);
        // Neither car is on the racing line, so neither can carry its speed:
        // the inside lane is a tighter corner. Both give a little, as two cars
        // door to door do; at line speed the first lock tripled the crashes.
        const vl = this.lines.race.v[e.proj.i] * 0.93;
        S.cap = Math.min(S.cap ?? Infinity, vl);
      }
      return S;
    }
    if (blocked || !this.sideLock || !this.duel || this.state !== 'green' || this.time - (this.greenT || 0) < 25) return null;   // not in the lap-one scramble
    // YOU, alongside a bot from behind: racecraft never runs for your car, so
    // the bot you have drawn level with starts the fight — it races you door
    // to door rather than tucking in or squeezing.
    const me = this.me, Lm = this.spec.bodyL;
    const pace = x => x.car.speed >= this.lines.race.v[x.proj.i] * 0.8;
    if (!pace(e)) return null;
    if (me && me !== e && !me.side && !me.retired && !me.inPit && e.behind === me && pace(me)) {
      const dsm = t.gap(e.proj.s, me.proj.s), dlm = me.proj.lat - e.proj.lat;
      if (dsm > 0 && dsm < Lm * 1.2 && Math.abs(dlm) > 1.4 && Math.abs(me.proj.lat) <= me.proj.w + 1
          && Math.abs(e.proj.lat) <= e.proj.w + 1 && (e.driver?.style?.space ?? 0) <= 0.6) {
        const keen = Math.min(1, ((e.driver?.style?.side ?? 0.5) + 0.9) / 2 + 0.15);
        const dur = 2 + 9 * Math.min(1, keen) * (0.5 + this.sideRng());
        const lane = Math.sign(-dlm) || 1;
        e.side = { o: me, lane, until: now + dur, done: false, cap: null, lose: false };
        me.side = { o: e, lane: -lane, until: now + dur, done: false, cap: null, lose: false };
        this.sideFights = (this.sideFights || 0) + 1;
        return e.side;
      }
    }
    const o = e.ahead;
    if (!o || o.side || o.inPit || o.retired || o.recover || o.finished || !pace(o)) return null;
    const ds = t.gap(o.proj.s, e.proj.s), dl = o.proj.lat - e.proj.lat;
    // Nose at their gearbox and pulled out of line is enough to START the
    // fight; keeping level brings the pair door to door. Waiting for a full
    // overlap, it started 8 times in a 22-car race (Monza, 2 laps).
    if (!(ds > 0 && ds < L * 1.7 && Math.abs(dl) > 1.4)) return null;
    if (Math.abs(e.proj.lat) > e.proj.w + 1 || Math.abs(o.proj.lat) > o.proj.w + 1) return null;
    if (Math.abs(this.progress(e) - this.progress(o)) > t.length * 0.5) return null;   // lapping
    const se = e.driver?.style, so = o.driver?.style;
    // The cautious do not go wheel to wheel — as the attacker or the defender.
    if ((se?.space ?? 0) > 0.6 || (so?.space ?? 0) > 0.6) return null;
    const keen = ((se?.side ?? 0.5) + (so?.side ?? 0.6)) / 2;
    const dur = 1.5 + 9 * keen * (0.5 + this.sideRng());
    const lane = Math.sign(-dl) || 1;                     // my side of them, + = left
    e.side = { o, lane, until: now + dur, done: false, cap: null, lose: false };
    o.side = { o: e, lane: -lane, until: now + dur, done: false, cap: null, lose: false };
    this.sideFights = (this.sideFights || 0) + 1;
    return e.side;
  }

  // Who gives. Boldness, the inside of the next corner, being ahead already,
  // and luck. With you in the pair only the bot's half is decided here — your
  // half is your right foot.
  resolveSide(e) {
    const p = e.side.o, inside = this.insideAhead(e.proj.s, 200);
    const score = x => (x.driver?.aggression ?? 0.65) + (inside && x.side.lane === inside ? 0.35 : 0)
      + (this.track.gap(x.proj.s, x.side.o.proj.s) > 0 ? 0.25 : 0) + 0.6 * this.sideRng();
    const eWins = score(e) >= score(p);
    e.side.done = p.side.done = true;
    e.side.lose = !eWins; p.side.lose = eWins;
  }

  unlock(e) {
    const p = e.side && e.side.o;
    e.side = null;
    if (p && p.side && p.side.o === e) p.side = null;
  }

  // ---- racecraft: the part that needs to know the running order ------------
  racecraft(e) {
    const t = this.track, i = e.proj.i, d = e.driver;
    const lim = Math.max(0.3, t.w[i] - 1.0);
    let bias = 0, speedCap = null, obstDs = null, obstV = null;

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
    // Over to the pit side for the entry: three quarters of the way, eased in
    // over the last 350 m. It was 1.5x the half-width, at once — the clamp
    // then held the car on the very edge at 200 km/h, and at Suzuka it ran
    // onto the grass, spun across the road and pinned itself on the far wall.
    let pitBias = 0;
    if (pitting && this.lane) {
      const to = t.wrap(this.lane.entryS - e.proj.s);
      const ramp = Math.max(0, Math.min(1, (350 - to) / 250));
      pitBias = (Math.sign(this.lane.off) || 1) * lim * 0.75 * ramp;
      bias += pitBias;
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
    const dtR = NEIGH_EVERY * FIXED_DT;
    // Which straight this is: a new one begins every time a braking zone ends.
    // The defender's one move is counted per straight (see defence).
    const zoneNow = this.brakingZone(e.proj.s, 150);
    if (!zoneNow && e.inZone) e.seg++;
    e.inZone = zoneNow;
    // BUILDING. Time spent within striking distance of THIS car ahead fills
    // it; out of range drains it twice as fast; a new car ahead starts over.
    if (e.ahead !== e.buildOn) { e.buildOn = e.ahead; e.build = 0; e.tryT = 0; }
    if (e.ahead && e.aheadGapT < 0.8) e.build += dtR;
    else if (!e.ahead || e.aheadGapT > 1.5) e.build = Math.max(0, e.build - 2 * dtR);
    // Under a safety car, a VSC, a red flag, a yellow — or before the control
    // line on a restart — nobody attacks, and nobody defends against a car
    // that is not allowed to attack (js/safetycar.js).
    // ...and nobody races after the flag.
    const noAtk = this.rc.noAttack(e) || e.finished, noDef = this.rc.noDefend(e) || e.finished;
    if (!pitting && !noAtk && e.ahead && e.aheadGapT < reach && !e.inPit) {
      const o = e.ahead;
      const ds = t.gap(o.proj.s, e.proj.s);
      const braking = this.brakingZone(e.proj.s, 130);
      // Nose alongside already: it is a fight for the corner, not a dive.
      const alongside = ds < L * 1.2 && Math.abs(o.proj.lat - e.proj.lat) > 1.6;
      // Ready to commit a move into a braking zone: built up long enough, or
      // alongside already because the tow or DRS put it there. Until then an
      // attacker tucks back in behind for the corner and tries again.
      // A backmarker being lapped, or a car limping, is not a duel.
      const lapping = this.progress(e) - this.progress(o) > t.length * 0.5 || o.car.speed < e.car.speed * 0.7 || !!o.recover;
      let ready = !this.duel || alongside || lapping || e.build > BUILD_T * (1.5 - d.aggression);
      if (this.duel && ready && !alongside && (e.tryT = (e.tryT || 0) + dtR) > TRY_T) {
        e.build = 0; e.tryT = 0; ready = false;
      }
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
      const pull = !ready ? 0 : braking ? 0.75 + 0.5 * d.aggression
                 : ds < 30 ? 0.55 + 0.4 * d.aggression : 0.35;
      want += e.atkSide * pull * Math.max(0.8, t.w[i] - 2.2) * Math.min(1, (reach - e.aheadGapT) / 1.0);
      // The dive: brake later than the line says, once you are out of their
      // wake and nearly alongside. The tyres decide whether it sticks.
      // In the duel "nearly" means your front wing at their sidepod, not a
      // car and a bit back — a lunge from further out is a torpedo.
      if (braking && ready && ds < L * (this.duel ? 1.3 : 2.2) && Math.abs(o.proj.lat - e.proj.lat) > 1.2) {
        lunge = (d.lungeMax ?? 0.02) * d.aggression;
      }
      if (ds < 25) pressure = 0.6;
      // ...and he never dives at you: he will pass if he is quicker, cleanly.
      if (e.mate && o === this.me) lunge = 0;
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
    // YOUR TEAMMATE does not defend against you: no covering move, no late
    // braking to keep you behind. He holds his line and lets you race him.
    if (!pitting && !noDef && e.behind && e.behindGapT < defendT && !e.inPit && !(e.mate && e.behind === this.me)) {
      const o = e.behind;
      const ds = t.gap(e.proj.s, o.proj.s);          // + : they are behind me
      const dl = o.proj.lat - e.proj.lat;
      const braking = this.brakingZone(e.proj.s, 150);
      let move = 0;
      if (braking) move = this.insideAhead(e.proj.s, 220) || -Math.sign(lineOff) || 1;
      else if (d.defence > 0.5 && ds > L * 1.05 && ds < 28 && Math.abs(dl) > 0.9) move = Math.sign(dl);
      // THE DUEL'S DEFENCE: one move per straight, and the inside into every
      // braking zone. A defender that has already moved on this straight
      // holds that line, whatever the car behind does — the weave the short
      // OVERTAKES `moveGap` allowed is gone, and so is the reason an attacker
      // could never predict anything.
      const mayMove = this.duel
        ? (braking || e.moveSeg !== e.seg) && this.time - e.movedAt > 1.0
        : this.time - e.movedAt > moveGap;
      if (move && move !== e.lastMove && mayMove) {
        e.lastMove = move; e.movedAt = this.time; e.moveSeg = e.seg;
      }
      if (move || this.time - e.movedAt < 1.2) {
        want += e.lastMove * d.defence * Math.max(0.6, t.w[i] - 2.4) * 0.85;
      }
      // ...and brake a touch later on the inside when someone is right there,
      // which is how a defender makes a dive not quite work. A fraction of the
      // attacker's own lunge, so the better-placed car still wins it.
      if (this.duel && braking && ds < 22 && e.lastMove === move) {
        lunge = Math.max(lunge, DEF_LUNGE * (d.lungeMax ?? 0.02) * d.defence);
      }
      pressure = Math.max(pressure, Math.min(1, 1 - e.behindGapT / defendT));
    }
    // Smoothed: a car changes lane at a few metres a second. It used to teleport
    // its target, and the controller made that look like a twitch rather than a
    // move. (The pit peel-off above is added unsmoothed, as it always was.)
    // Off the grid, a car eases across to the line over the first few hundred
    // metres rather than snapping onto it; on the grid it holds its box.
    if (e.merge && (Math.abs(e.biasS) < 0.3 || this.time - (this.greenT || 0) > 40)) e.merge = false;
    // THE LAUNCH (js/drivers.js STYLE.launch): a darter is across to the line
    // at three times the old rate from the moment the lights go; a patient
    // one holds its grid lane for up to four seconds and then eases over.
    const st = (this.styles && d.style) || { launch: 0.27, space: 0, side: 0.5, none: true };
    const waited = st.none || this.time - (this.greenT || 0) > (1 - st.launch) * 4;
    const slew = e.merge
      ? (this.state === 'green' && waited ? MERGE_RATE * (st.none ? 1 : 0.35 + 2.4 * st.launch) * NEIGH_EVERY * FIXED_DT : 0)
      : (3.0 + 2.5 * d.aggression) * NEIGH_EVERY * FIXED_DT;
    // Race control's say on the lane: the racing line in a queue, out of the
    // queue to unlap, off the line for a blue flag.
    // SIDE BY SIDE: a locked pair holds its lanes, inside and outside.
    const sb = this.sideBySide(e, noAtk || pitting);
    if (sb) want = sb.lane * lim * 0.62 - lineOff;
    want = this.rc.wantBias(e, want, lineOff, lim);
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
    // A car is 2 m wide; 2.6 is that plus a door. A cautious driver (STYLE
    // .space) leaves up to a further 2.4 m — a car length of air beside it.
    const ROOM = 2.6 + 2.4 * st.space;
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
        // ...but only the car BEHIND brakes. Two cars level, each yielding to
        // 94% of the other, is a feedback loop: both slow together until the
        // pair is crawling, and the pack arrives into the back of them.
        // tools/incidents.mjs traced it to the start (a two-abreast grid is
        // exactly this) and to side-by-side pairs braking on a straight at
        // 250 km/h. In the duel, a car ahead of the other keeps its speed.
        if (!this.duel || t.gap(o.proj.s, e.proj.s) > -0.5) yieldTo = Math.min(yieldTo ?? Infinity, o.car.speed * 0.94);
      }
    }

    // Car-following: settle at a sensible headway and MATCH the car ahead once
    // there. Always targeting a fraction of their speed cascades down the field
    // until the whole train stops.
    // THE CAR AHEAD IN YOUR LANE, not the nearest car ahead (the duel). On a
    // two-abreast grid the nearest car ahead is always the one diagonally in
    // front, in the OTHER column, so the one directly in front was nobody's
    // problem: tools/incidents.mjs caught cars launching flat out into a car
    // 8 m ahead that was itself held back by the car in front of it, as the
    // merge to the racing line closed the columns — eight contacts in the
    // first two seconds of one Suzuka start.
    let A = this.duel ? (this.laneAhead(e, this.brakingZone(e.proj.s, 140) ? Math.max(4.5, t.w[i] * 1.1) : 3.4) || e.ahead) : e.ahead;
    // You, off the road, are not the car to follow — the guard below decides
    // whether you are in the way, and off the road you are not.
    if (A && A.isPlayer && Math.abs(A.proj.lat) > A.proj.w + 1.0) A = null;
    // ...and stopped or crawling you have a rule of your own below (NOBODY
    // REAR-ENDS YOU), with its own gate. This one, in a braking zone, calls
    // most of the road "your lane": at Suzuka, whose grid is in the braking
    // zone for the first turn, a car 4 m to your side still "followed" you
    // to a standstill and nine cars queued behind it.
    if (A && A.isPlayer && A.car.speed < 20) A = null;
    if (A && !e.inPit) {
      const ds = t.gap(A.proj.s, e.proj.s);
      const dl = Math.abs(A.proj.lat - e.proj.lat);
      const vA = A.car.speed || 0, v = e.car.speed;
      const closing = v - vA;
      const braking = this.brakingZone(e.proj.s, 140);
      const zone = braking ? 1.7 : 1.0;
      // ...and the same caution behind: up to a car length more headway.
      const headway = (6.5 + v * 0.28 + Math.max(0, closing) * 1.4) * zone + st.space * this.spec.bodyL;
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
      // BRAKE FOR THE CAR AHEAD, NOT JUST THE LINE (the duel). The follow cap
      // above only ever reacts to the speed the car ahead has NOW, and the
      // pedals plan their stop from the racing line's corner speeds — so a car
      // that brakes earlier than the line (slower, defending, lapped, off
      // line) is hit by the one behind before either rule notices. Measured,
      // tools/incidents.mjs: nose-to-tail in a braking zone was the biggest
      // single kind of contact, lap one and after. So the car ahead in your
      // lane is also a braking target: arrive no faster than you could shed
      // to its speed in the room there is.
      if (this.duel && !overlap && ds > 0 && ds < 150 && dl < latGate) { obstDs = ds - this.spec.bodyL * 1.15; obstV = vA; }
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

    // NOBODY REAR-ENDS YOU (Adam, 2026-10-03: "if im slow asf, the cars behind
    // me under no circumstances rear end me, they brake too, bc a car costs 82
    // gazillion dollars"). Every mode with rivals runs through here: race,
    // the race after quali, formation, safety car, lap one.
    //
    // The follow rule above treats you as one more rival: one car per lane,
    // a 3.4 m gate, a closing run allowed for a pass. None of that is safe
    // against a car that has stalled, spun or slowed to walking pace. So you
    // get a rule of your own that no racecraft can switch off: if you are
    // anywhere near this car's path, it plans to arrive no faster than your
    // speed along the road, a car length plus a margin that grows with its
    // own speed SHORT of your gearbox, and inside that it backs off below you.
    // Slow, sliding or sideways on the road, the gate widens to most of the
    // road, because a car in that state can end up anywhere across it.
    {
      const me = this.me;
      if (me && me !== e && !me.retired && me.proj) {
        const ds = t.gap(me.proj.s, e.proj.s);
        if (ds > 0 && ds < 300) {
          const mc = me.car, onRoad = Math.abs(me.proj.lat) <= me.proj.w + 1.0;
          const vP = Math.max(0, mc.speed * Math.cos(mc.hdg - t.hdg[me.proj.i]));
          // ERRATIC and SLOW are different things (Adam, 2026-10-04: "i completly
          // stopped at the start, but im just holing up everyoen behnind ...
          // everyone shhold pass me"). Sliding or sideways, you could end up
          // anywhere across the road, and the gate is most of it. Stopped or
          // crawling in a straight line you are a parked car: predictable, and
          // the field goes ROUND you, on the side with more road. The wide gate
          // for merely being slow is what queued twenty cars behind you.
          const erratic = onRoad && (Math.abs(mc.vy || 0) > 2 || Math.abs(Math.sin(mc.hdg - t.hdg[me.proj.i])) > 0.35);
          const slow = onRoad && !erratic && vP < Math.max(20, e.car.speed * 0.6);
          if (slow && ds < 220) {
            const lm = Math.max(0.3, me.proj.w - 1.0), PASS = 3.4;
            const roomL = lm - me.proj.lat, roomR = me.proj.lat + lm;
            // Already clear of you on one side: that is the side. Otherwise the
            // side with more road. Decided once, not re-thought every tick.
            const dlm = e.proj.lat - me.proj.lat;
            if (e.goRound == null || this.time - (e.goRoundAt || 0) > 6) e.goRound = Math.abs(dlm) > 2.5 ? Math.sign(dlm) : roomL >= roomR ? 1 : -1;
            e.goRoundAt = this.time;
            // It only ever pushes AWAY from you. As a target it pulled a car that
            // was 5 m clear in to 3.4 m, inside the gate, where it stopped dead.
            if ((e.goRound > 0 ? roomL : roomR) >= PASS - 0.4) {
              const tgt = me.proj.lat + e.goRound * PASS - this.lines.race.off[i];
              bias = e.goRound > 0 ? Math.max(bias, tgt) : Math.min(bias, tgt);
            }
          }
          const unsettled = erratic;
          // Round a parked car the gate is a car's width and a bit, and the
          // stand-off short: stopping 5 m back and needing 4 m sideways left
          // the car behind you no room to steer out, and its whole grid column
          // queued behind it (7 of 14 stuck at Monza from P8, 13 at Suzuka).
          const gate = Math.max(slow ? 2.5 : this.brakingZone(e.proj.s, 140) ? Math.max(4.5, t.w[i] * 1.1) : 3.0, unsettled ? Math.max(5.5, t.w[i] * 1.2) : 0);
          if (Math.abs(me.proj.lat - e.proj.lat) < gate) {
            const v = e.car.speed;
            const room = ds - this.spec.bodyL * 1.15 - (slow ? 1.5 : 4) - v * 0.3;
            if (obstDs == null || room < obstDs) { obstDs = Math.max(0, room); obstV = vP; }
            const cap = room > 0 ? vP + Math.sqrt(2 * 9 * room) : vP * 0.7;
            speedCap = Math.min(speedCap ?? Infinity, cap);
          }
        }
        // Passing you, it keeps a car's width of air between you: centres at
        // least 3.6 m apart while it is anywhere alongside. Measured first
        // (tools/rearcheck.mjs, Suzuka): with only the rule above, rivals went
        // by a crawling car 1.3 m clear and touched it as it drifted back to
        // the line.
        if (ds > -this.spec.bodyL * 1.6 && ds < this.spec.bodyL * 1.6) {
          const off = this.lines.race.off[i];
          // A metre of air past a parked you; a car's width past a moving one.
          const CLEAR = me.car.speed < 12 ? 3.0 : 3.6;
          if (e.proj.lat >= me.proj.lat) bias = Math.max(bias, me.proj.lat + CLEAR - off);
          else bias = Math.min(bias, me.proj.lat - CLEAR - off);
        }
      }
    }

    // The yield goes on last, so the car-following cap above cannot undo it.
    // Backing out of a move you have no room for is not optional.
    if (yieldTo != null) speedCap = Math.min(speedCap ?? Infinity, yieldTo);

    const off = this.lines.race.off[i];
    bias = Math.max(-lim - off, Math.min(lim - off, bias));
    // What the slew starts from next time is where the car was ALLOWED to go,
    // pit bias excluded (it is re-added fresh each pass).
    e.biasS = bias - pitBias;
    if (sb && sb.cap != null) speedCap = Math.min(speedCap ?? Infinity, sb.cap);
    // The cool-down lap is driven at two thirds of racing speed.
    if (e.finished) speedCap = Math.min(speedCap ?? Infinity, this.lines.race.v[i] * 0.66);
    e.ctx = this.rc.limit(e, { offBias: bias, speedCap, lunge: yieldTo != null ? 0 : lunge, pressure, hold: e.hold ?? 1, obstDs, obstV });
  }

  // ---- one substep --------------------------------------------------------
  tick(dt, playerInput) {
    const t = this.track;
    this.time += dt;
    if (this.state === 'grid') {
      this.lights -= dt;
      if (this.lights <= 0) {
        this.state = 'green';
        this.greenT = this.time;
        this.log('flag', 'LIGHTS OUT');
        for (const e of this.entries) e.lapStart = this.time;
      }
    }
    const racing = this.state === 'green' || this.state === 'finish';

    // Neighbours and racecraft change slowly compared with 400 Hz, and they are
    // the O(n^2) part. A quarter of the rate is invisible and four times cheaper.
    if ((this.battle || this.duelOn) && this.time - this.bandAt > BAND_EVERY) { this.bandAt = this.time; this.band(); }
    if (this.sub++ % NEIGH_EVERY === 0) {
      const me = this.me;
      if (me && !me.retired && !me.inPit && me.proj && Math.abs(me.proj.lat) > me.proj.w + 1.0) this.meOffAt = this.time;
      this.neighbours();
      for (const e of this.entries) if ((!e.isPlayer || this.standIn) && !e.retired) this.racecraft(e);
    }

    for (const e of this.entries) {
      if (e.retired) { if (!e.atRest) this.wreckStep(e, dt); continue; }
      const car = e.car;
      if (e.isPlayer) {
        const inp = playerInput || { wheel: 0, throttle: 0, brake: 0 };
        car.throttle = inp.throttle; car.brake = inp.brake;
        car.delta = inp.delta ?? car.delta;
        // DRS is a rule, not a button: the flap stays shut outside a zone you
        // earned at its detection line, however many times it is pressed.
        if (this.drsRule && !e.drsOk) car.drsOpen = false;
      } else if (e.drive) {
        e.drive(car, e.proj, dt, e.ctx);
        // A rival opens it the moment it is allowed and shuts it for the
        // brakes and for any real steering, as the driver's thumb would.
        if (this.drsRule) car.drsOpen = e.drsOk && car.brake < 0.05 && Math.abs(car.delta) < 0.06;
        // The old safety car was a flat 80 km/h cap written over the pedals
        // here. Race control now sets each car's speed through its ctx
        // (js/safetycar.js limit): the delta, the queue, the restart.
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
      if (racing && (!e.finished || e.cool) && this.pits) {
        // Their engineers call it on TYRES too, not only damage: past 0.8 wear
        // with two or more laps left to use a fresh set (Adam, 2026-09-25:
        // "bots also have a simulated radio engineer, like they strategize pits").
        const worn = car.tyre && Math.max(car.tyre.wf, car.tyre.wr) > 0.8 && this.laps - e.lap >= 2;
        if (!e.finished && !e.isPlayer && !e.pitRequest && e.pitPhase !== 'service' && (shouldPit(car) || worn)) {
          e.pitRequest = true;
          this.log('flag', `${e.name} WILL PIT`, e);
        }
        const wasIn = e.inPit;
        // Home after the flag: in its box, it is parked for good.
        if (e.cool && e.pitPhase === 'service') { e.pitTimer = 5; e.parked = true; }
        if (updateStop(e, t, this.lane, e.proj, dt, this.peak, this.entries)) {
          this.log('flag', `${e.name} SERVED — ${(e.pitJobs || []).join(' + ')}`, e);
          this.rc.released(e);
        }
        if (e.inPit && !wasIn) { this.log('flag', `${e.name} PITS`, e); this.rc.pitEntry(e); }
        // PUSHED BACK INTO THE GARAGE. A car that is staying — home after the
        // flag, or held under a red flag — cannot stay on its mark: the marks
        // are in the working lane, and the car for the next one along has to
        // pull over across it (two bots wrecked in the lane on the first
        // cool-down lap; under a red flag 5 of 14 never reached their boxes).
        // So the crew rolls it back, as crews do: 3.5 s, nine and a half
        // metres, nose still to the lane. It rolls out again for a restart.
        const stay = e.pitPhase === 'service' && (e.cool || this.lane.hold);
        if (stay && car.speed < 1) {
          if (e.garageT == null) { e.garageT = 0; e.garageS = e.proj.s; e.garageLat = e.proj.lat; e.garageHdg = car.hdg; }
          e.garageT = Math.min(3.5, e.garageT + dt);
        } else if (e.garageT != null && !stay) {
          e.garageT -= dt * 1.5;
          if (e.garageT <= 0) e.garageT = null;
        }
        if (e.garageT != null) {
          const k = e.garageT / 3.5, f = k * k * (3 - 2 * k);
          const gp = t.point(e.garageS, e.garageLat + (Math.sign(this.lane.off) || 1) * 9.5 * f);
          car.x = gp.x; car.y = gp.y; car.hdg = e.garageHdg;
          car.vx = 0.0001; car.vy = 0; car.r = 0; car.throttle = 0; car.brake = 1;
        }
      }

      if (!racing) { car.throttle = 0; car.brake = 1; car.delta = 0; }

      const pr = e.proj;
      const al = Math.abs(pr.lat);
      let surface = SURFACE.track;
      if (al > pr.w + pr.run) surface = SURFACE.grass;
      else if (al > pr.w + 1.2) surface = SURFACE.runoff;
      else if (al > pr.w) surface = SURFACE.kerb;

      step(car, dt, { surface, bank: pr.bank, bankDir: Math.sign(pr.curv),
                      dirty: car.dirty, tow: car.tow, rollMul: dragFor(surface),
                      // gravity on slopes: main.js hands the session the surveyed
                      // gradient; the harnesses do not, so they stay flat
                      slope: this.slopeAt ? this.slopeAt(pr.s) * Math.cos(car.hdg - t.hdg[pr.i]) : 0 });
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
      // Debris: a wing on the road (js/safetycar.js decides yellow or more).
      const wingNow = !!(car.lost && (car.lost.frontWing || car.lost.rearWing));
      if (wingNow && !e.wingWas) this.rc.incident('debris', e);
      e.wingWas = wingNow;
      if (car.damage >= 1 && !e.retired) { e.retired = true; this.log('crash', `${e.name} RETIRES`, e); this.rc.incident('retired', e); }
      // A car on its roof is not rejoining. Retire it once it has stopped
      // sliding, or it keeps being classified and crawls round for the rest of
      // the race: measured, an upside-down car dragged the field spread from
      // 12 s to 162 s because its "best lap" was still being counted.
      if (!e.retired && car.onRoof && car.speed < 8) {
        e.retired = true; this.log('crash', `${e.name} IS UPSIDE DOWN`, e);
        this.rc.incident('roof', e);
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
      if (this.drsRule) this.drsTick(e, prev, racing);

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
            // THE COOL-DOWN LAP (Adam, 2026-10-04: "when i finish i need to do 1
            // lap then return to pit"). Past the flag everybody eases off,
            // drives the lap round, and the pit lane takes them in to their
            // garage — where they stay. The entry is behind the line, so the
            // request made here is served a lap from now.
            if (this.pits && this.lane && this.lane.len > 60) { e.cool = true; e.pitRequest = true; }
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
          // People on a live circuit: race control decides what that needs.
          this.rc.incident('beached', e);
        }
        // STOPPED ON THE TRACK, on the tarmac, not being pushed and not in
        // its box: eight seconds of that and it is a safety car.
        // A car standing nose-to-tail behind another stopped car is TRAFFIC —
        // the lap-one jam at the first chicane, a safety-car queue bunching up
        // — not an incident. Called as one, it threw a dozen "CAR STOPPED ON
        // TRACK" at Monza's Rettifilo and Alboreto and a safety car for each.
        const inTraffic = e.ahead && !e.ahead.retired && e.ahead.car.speed < 6
          && t.gap(e.ahead.proj.s, e.proj.s) > 0 && t.gap(e.ahead.proj.s, e.proj.s) < 30;
        if (!e.recover && !e.inPit && !e.retired && e.car.speed < 2 && Math.abs(e.proj.lat) <= e.proj.w
            && !inTraffic && this.time - (this.greenT || 0) > 10) {
          e.stopT = (e.stopT || 0) + dt;
          if (e.stopT > 8 && !e.stopCalled) { e.stopCalled = true; this.rc.incident('stopped', e); }
        } else { e.stopT = 0; if (e.car.speed > 8) e.stopCalled = false; }
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

    this.rc.tick(dt);
    // `safety` is what the rest of the game has always read (the HUD's SC
    // light, the dash, DRS, the cheer): non-zero while the race is neutralised.
    this.safety = this.rc.neutral ? 1 : 0;

    this.order();
    if (this.duel && this.me && racing) this.cheerTick();
    // The race is over when everyone is home — and, if you took the flag, when
    // YOU are back in your garage (or four minutes have gone and you are not
    // coming). The results wait for you to park.
    const me = this.me;
    const coming = me && me.finished && me.cool && !me.parked && !me.retired && this.time - me.finishTime < 240;
    if (this.state === 'finish' && !coming && this.entries.every(e => e.finished || e.retired)) this.state = 'over';
    if (this.state === 'finish' && !coming && this.time - (this.finishAt || (this.finishAt = this.time)) > 30) this.state = 'over';
  }

  // ---- DRS: detection line, then the zone ----------------------------------
  // Within DRS_GAP of the car ahead as you cross a zone's detection line and
  // the flap is yours for that zone, and only that zone. Everyone, you
  // included, from lap DRS_FROM_LAP + 1, never under the safety car. The flap
  // itself is physics (physics.js: drsCl/drsCd on a spec with `drs`); this is
  // only who may use it where. e.drsFor = the zone earned, e.drsOk = in it now.
  drsTick(e, prev, racing) {
    const t = this.track, s = e.proj.s;
    if (!racing || this.safety > 0 || e.inPit || e.finished || e.retired) { e.drsFor = null; e.drsOk = false; return; }
    for (const z of t.drs || []) {
      const a = t.gap(z.detect, prev), b = t.gap(z.detect, s);
      if (a > 0 && b <= 0 && a < 50) {
        e.drsFor = e.lap >= DRS_FROM_LAP && e.lap >= this.rc.drsFrom && e.ahead && e.aheadGapT < DRS_GAP ? z : null;
      }
    }
    const inZone = e.drsFor && t.drsZoneAt(s) === e.drsFor;
    if (inZone) e.drsOk = Math.abs(t.curv[e.proj.i] || 0) < DRS_CURV;
    else { if (e.drsOk || e.drsIn) e.drsFor = null; e.drsOk = false; }
    e.drsIn = !!inZone;
  }

  // ---- celebrate the pass --------------------------------------------------
  // YOUR overtakes, and only the ones that stuck: a rival that went from ahead
  // of you to behind you and STAYED there CHEER_HOLD seconds, with daylight of
  // half a car. A car crawling to the pits or beached is a place, not a pass.
  // race.cheers is read by main.js (radio call, the tower, the crowd).
  cheerTick() {
    const me = this.me;
    if (me.retired || me.finished || me.inPit || this.time < 6) return;
    // No passing under the safety car: a place taken behind it is not a pass.
    if (this.safety > 0) { if (this._cand) this._cand.clear(); for (const o of this.entries) o.aheadOfMe = undefined; return; }
    const pMe = this.progress(me), half = this.track.length / 2, L = this.spec.bodyL;
    const cand = this._cand || (this._cand = new Map());
    for (const o of this.entries) {
      if (o === me) continue;
      const d = this.progress(o) - pMe;                    // + = they are ahead of you
      const was = o.aheadOfMe;
      o.aheadOfMe = d > 0;
      if (o.retired || o.inPit || o.recover || Math.abs(d) > half) { cand.delete(o); continue; }
      if (was === true && d <= 0) cand.set(o, this.time);
      else if (d > 0) cand.delete(o);
      const t0 = cand.get(o);
      if (t0 != null && this.time - t0 >= CHEER_HOLD && -d > L * 0.5) {
        cand.delete(o);
        if (o.car.speed < me.car.speed * 0.6) continue;
        this.cheers.push({ t: this.time, at: t0, idx: o.idx, name: o.name, pos: me.pos, lap: me.lap + 1 });
        this.log('pass', `YOU PASS ${o.name} FOR P${me.pos}`, me);
      }
    }
  }

  // Only test pairs that are actually near each other. Twenty-two cars is 231
  // pairs; sorting by distance along the track and testing a short window makes
  // it about twenty, and two cars 400 m apart cannot touch.
  carContact() {
    const t = this.track;
    const live = this.entries.filter(e => !e.retired && e.garageT == null);   // a car in its garage is out of the lane
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
          you.bump = { what: 'car', closing: hit.closing, harm: hit.harm, by: live[i].isPlayer ? live[j] : live[i] };
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
    // The safety car is solid. Driven, not stepped, so what the contact does
    // to it is overwritten next substep; what it does to YOU is not.
    const sc = this.rc.sc;
    if (sc.out && !sc.inLane) {
      for (const e of live) {
        if (Math.abs(t.gap(e.proj.s, sc.s)) > 8) continue;
        const hit = resolveCars(e.car, sc.car);
        if (hit) {
          this.rc.scHits = (this.rc.scHits || 0) + 1;
          if (e.isPlayer && hit.closing > 2) e.bump = { what: 'car', closing: hit.closing, harm: hit.harm };
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
