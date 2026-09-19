// pitcheck.mjs — what the race layer must STOP doing to a car in the pit lane.
//
// js/pit.js draws a pit lane and the entries carry `inPit`. The moment anything
// sets that flag, four things in race.js become wrong, because every one of
// them asks the same question — "how far is this car from the centreline?" —
// and for a car in the pit lane the answer is seventeen metres:
//
//   1. track limits warns it, and penalises it, for being in the lane
//   2. the barrier test shoves it back onto the racing line, mid-stop
//   3. car-to-car contact resolves a phantom shunt with a car on the straight
//      whose `s` happens to match
//   4. the beached rescue teleports it out of its own twelve-second nose change
//   5. it is picked as the car AHEAD of someone on the straight, who caps their
//      speed to its 80 km/h limit, pulls out to attack it, and sits in a tow
//      from a car that is stationary in its box
//
// (4) and (5) were not on the list when this was specified. They came out of
// reading the code rather than the spec.
//
// ---------------------------------------------------------------------------
// EVERY ASSERTION IS RUN TWICE, and the second run is the point
//
// Once with `inPit` set, where nothing bad may happen — and once with it false,
// where the bad thing MUST happen. A test that has never watched the failure it
// exists to catch is not a test, it is a green tick that would survive the
// guard being deleted.
//
// And that second run has to be honest about WHICH guards it exercised. The
// first version of this file ran one scenario, OR-ed the failures together and
// printed "the unguarded case reproduces the failure" — true, but it only ever
// reproduced two of the four. Track limits need speed above 14 m/s and the
// beached rescue needs speed below 3.2, so no single scenario can trigger both.
// Hence two: a car SERVING a stop, and a car DRIVING down the lane.
//
//   node tools/pitcheck.mjs [track] [class]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT, makeCar } from '../js/physics.js';
import { resolveCars } from '../js/collide.js';
import { wakeAt, newWake } from '../js/aero.js';

// race.js updates neighbours every 4th substep; a sampler that reads faster
// than the thing it samples measures the gap, not the thing.
const NEIGH_SLACK = 5;

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const KEY = a[0] || 'monza', CLS = a[1] || 'f1';
const { track, lines, spec } = loadTrack(KEY, CLS);
const LANE = track.pit && Number.isFinite(track.pit.offset) ? track.pit.offset : 17;

let failures = 0, blind = 0;

/**
 * Put car 0 in the pit lane beside a running field.
 *
 * `moving` picks which of the two real pit states this is: parked in the box
 * (stationary, which is what the beached rescue mistakes for being stranded in
 * a gravel trap), or travelling down the lane at the limiter (fast enough that
 * track limits will fire, and pinned alongside a car on the circuit so the
 * contact solver has a pair to get wrong).
 */
function scenario({ inPit, moving, secs = 7 }) {
  const race = new Race({
    track, lines, spec, slots: gridSlots(track, 8), laps: 3, grid: 8,
    tier: 'medium', seed: 3, player: false,
  });
  // Let the field race first, so the car we park is parked beside traffic
  // rather than beside a grid that has not moved.
  for (let n = 0; n < Math.round(12 / FIXED_DT); n++) race.tick(FIXED_DT, null);

  const p = race.entries[0];
  const other = race.entries[1];
  p.inPit = inPit;
  const parkedS = p.proj.s;

  // `cleanTow` is the honest version of "is anyone sitting in this car's wake".
  // Counting any tow near the pit car measures cars towing EACH OTHER, which is
  // legitimate, and which the first version of this file reported as a failure
  // of the guard for two runs. So: find the nearest car behind the pit car,
  // check that NOTHING else is within wake range in front of it, and only then
  // is its tow attributable to the car in the lane.
  const out = { rescued: false, contacts: 0, warnings: 0, pickedAsAhead: 0,
                cleanSamples: 0, cleanTow: 0, cleanDirty: 0 };
  let aloneFor = 0;
  const c0 = p.contacts, w0 = p.warnings;

  for (let n = 0; n < Math.round(secs / FIXED_DT); n++) {
    // Hold the car where a pit stop would hold it. A real stop is a car that is
    // not free to roll, and without this the physics slides it out of the lane.
    // Moving: pinned to the same `s` as a car on the circuit, which is the
    // worst case for anything that compares positions along the centreline.
    const s = moving ? other.proj.s : parkedS;
    const pt = track.point(s, LANE);
    p.car.x = pt.x; p.car.y = pt.y; p.car.hdg = pt.hdg;
    p.car.vx = moving ? 22 : 0; p.car.vy = 0; p.car.r = 0;
    p.car.throttle = 0; p.car.brake = moving ? 0 : 1;
    const before = { x: p.car.x, y: p.car.y };

    race.tick(FIXED_DT, null);

    // The beached rescue moves a car a long way in a single substep.
    if (!moving && Math.hypot(p.car.x - before.x, p.car.y - before.y) > 3) out.rescued = true;

    let follower = null, gap = 1e9;
    for (const o of race.entries) {
      if (o === p || o.retired) continue;
      if (o.ahead === p) out.pickedAsAhead++;
      const ds = track.gap(p.proj.s, o.proj.s);      // > 0 means p is ahead of o
      if (ds > 0 && ds < 90 && ds < gap) { gap = ds; follower = o; }
    }
    if (follower) {
      let alone = true;
      for (const o of race.entries) {
        if (o === p || o === follower || o.retired) continue;
        const d = track.gap(o.proj.s, follower.proj.s);
        if (d > 0 && d < 90) { alone = false; break; }
      }
      // `car.tow` is recomputed every NEIGH_EVERY substeps, not every substep,
      // so for up to three substeps after a car clears off the follower still
      // carries the tow it had when that car was there. Sampling the instant
      // `alone` turns true reads a STALE value and blames it on the pit car —
      // which is exactly what a FAIL at Baku turned out to be. Wait for the
      // value to have been recomputed under the condition being tested.
      alone = alone ? aloneFor + 1 : 0;
      aloneFor = alone;
      if (aloneFor > NEIGH_SLACK) {
        out.cleanSamples++;
        out.cleanTow = Math.max(out.cleanTow, follower.car.tow);
        out.cleanDirty = Math.max(out.cleanDirty, follower.car.dirty);
      }
    }
  }
  out.contacts = p.contacts - c0;
  out.warnings = p.warnings - w0;
  return out;
}

// One assertion, stated once, checked in both directions. `guardedOk` is what
// must be true when the flag is set; `bareBad` is the same measurement going
// wrong when it is not. If `bareBad` is false the scenario never reproduced the
// problem, and the passing half above proved nothing — so it is reported as
// BLIND rather than as a pass.
function check(what, guarded, bare, guardedOk, bareBad, detail, whyBlind) {
  const ok = guardedOk(guarded);
  const saw = bareBad(bare);
  if (!ok) failures++;
  if (ok && !saw) blind++;
  console.log(`  ${!ok ? 'FAIL' : saw ? 'ok  ' : 'BLIND'}  ${what.padEnd(52)} ${detail(guarded, bare)}`);
  // A BLIND line with no explanation is an invitation to re-derive the reason
  // from scratch in six months. Say what the scenario cannot reach, here.
  if (ok && !saw && whyBlind) console.log(`          ${whyBlind}`);
}

console.log(`${track.full} — a car in the pit lane beside a running field`);
console.log(`pit lane sits ${LANE.toFixed(1)} m off the centreline\n`);

// ---------------------------------------------------------------------------
// The contact question, asked directly instead of inferred from a race.
//
// The pit contract asked for a guard skipping car-to-car contact between a car
// in the lane and a car on the circuit, on the grounds that a shared `s` says
// nothing about real proximity. It is a real-sounding hazard and the code
// already handles it: `resolveCars` is a SAT test on two oriented boxes in
// WORLD space and never looks at `s` at all.
//
// So there is no guard, and this asserts why — in both directions, because
// "no phantom contact" is worthless without "and real contact still works".
// The second half is the one that matters: at the PIT EXIT the lane converges
// with the track, and a guard there would switch collision off at the exact
// place pit-exit incidents happen.
{
  const at = (lat, s = 100) => {
    const c = makeCar({ cls: spec.key });
    const pt = track.point(s, lat);
    c.x = pt.x; c.y = pt.y; c.hdg = pt.hdg; c.vx = 30;
    return c;
  };
  const far = resolveCars(at(LANE), at(0));
  // 1.6 m apart with a 2.0 m wide car is 0.4 m of overlap. The first version of
  // this used 2.4 m and asserted that two cars with a 40 cm GAP between them
  // must collide, which failed at every circuit and was the test being wrong,
  // not the physics.
  const exit = resolveCars(at(0.8), at(-0.8));
  const ok1 = far === null, ok2 = exit !== null;
  if (!ok1 || !ok2) failures++;
  console.log('CONTACT, asked of the geometry rather than of a race');
  console.log(`  ${ok1 ? 'ok  ' : 'FAIL'}  a car in the lane and one on the line do not touch` +
    `      ${LANE.toFixed(1)} m apart -> ${far === null ? 'null' : 'CONTACT'}`);
  console.log(`  ${ok2 ? 'ok  ' : 'FAIL'}  two cars 1.6 m apart still do` +
    `                      pit-exit case -> ${exit ? 'contact' : 'NOTHING'}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// The same treatment for the wake, and it comes out differently: the guard is
// right, and no race at these five circuits can ever exercise it.
//
// A pit lane sits 7.5 to 17.3 m off the centreline, and at that lateral offset
// `wakeAt` already returns nothing — so the in-race half of this check below is
// BLIND, permanently, and saying so is worth more than a green tick. What the
// guard covers is a car in the BOX at a lateral offset near zero relative to
// someone on the straight. No circuit here puts a box there. One might.
{
  const W = newWake();
  const atLane = wakeAt(W, 20, Math.abs(LANE), spec), laneTow = W.tow;
  const atZero = wakeAt(W, 20, 0, spec), zeroTow = W.tow;
  const ok1 = !atLane || laneTow === 0, ok2 = atZero && zeroTow > 0;
  if (!ok1 || !ok2) failures++;
  console.log('THE WAKE, asked of the model rather than of a race');
  console.log(`  ${ok1 ? 'ok  ' : 'FAIL'}  at the real lane offset there is no wake` +
    `             ${Math.abs(LANE).toFixed(1)} m, 20 m back -> tow ${laneTow.toFixed(3)}`);
  console.log(`  ${ok2 ? 'ok  ' : 'FAIL'}  at zero offset there would be` +
    `                       0.0 m, 20 m back -> tow ${zeroTow.toFixed(3)}`);
  console.log('  ...so the guard is insurance for a lane geometry these five');
  console.log('     circuits do not have, and the in-race check below is BLIND');
  console.log('     for that reason rather than for want of trying.');
  console.log('');
}

for (const [label, moving] of [['SERVING A STOP (parked in the box)', false],
                               ['DRIVING DOWN THE LANE (at the limiter)', true]]) {
  const guarded = scenario({ inPit: true, moving });
  const bare = scenario({ inPit: false, moving });
  console.log(label);
  if (!moving) {
    check('not rescued onto the racing line mid-stop', guarded, bare,
      g => !g.rescued, b => b.rescued, (g, b) => `guarded=${g.rescued} bare=${b.rescued}`);
  }
  check('no track-limits warnings for being in the lane', guarded, bare,
    g => g.warnings === 0, b => b.warnings > 0, (g, b) => `guarded=${g.warnings} bare=${b.warnings}`,
    'a warning needs track.cornerAt(s) to name a corner, and a pit lane runs\n' +
    '          alongside a straight — so at this circuit the guard is redundant\n' +
    '          insurance for a lane whose exit runs into one, not live cover.');
  check('nobody picks it as the car ahead', guarded, bare,
    g => g.pickedAsAhead === 0, b => b.pickedAsAhead > 0,
    (g, b) => `guarded=${g.pickedAsAhead} bare=${b.pickedAsAhead} substeps`);
  check('the car behind it is in no wake from it', guarded, bare,
    g => g.cleanTow === 0 && g.cleanDirty === 0,
    b => b.cleanSamples > 0 && (b.cleanTow > 0 || b.cleanDirty > 0),
    (g, b) => `guarded tow=${g.cleanTow.toFixed(3)} | bare tow=${b.cleanTow.toFixed(3)} ` +
              `(${b.cleanSamples} clean samples)`,
    `at ${Math.abs(LANE).toFixed(1)} m the wake is already zero, so a race cannot\n` +
    '          produce this failure at any of the five circuits — see the direct\n' +
    '          wake test above for the geometry it does cover.');
  console.log('');
}

if (failures) console.log(`${failures} FAILED`);
else if (blind) console.log(`all guards hold, but ${blind} of them were never watched FAILING here.\n` +
  `A guard this scenario cannot break is a guard this file cannot vouch for.`);
else console.log('all clear, and every guard was watched failing without it — ' +
  'race.js is ready for pit.js to set the flag');
process.exit(failures ? 1 : 0);
