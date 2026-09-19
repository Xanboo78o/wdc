// pitstop.mjs — the gate for the pit stop.
//
// Every assertion runs TWICE where it can: once where the thing must happen,
// and once where it must not. A test that only ever sees the good path cannot
// tell you whether it is testing anything — which is the lesson three
// instruments taught this project today, and the reason this file is shaped
// like the other session's pitcheck.mjs.
//
//   node tools/pitstop.mjs [track] [class]
import { loadTrack, surfaceAt } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE, peakSlip } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';
import { buildLines } from '../js/line.js';
import { makeLane, updateStop, shouldPit, serviceFor, repair, PIT_SPEED } from '../js/pitstop.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const key = a[0] || 'monza', cls = a[1] || 'f1';
const { track, lines, spec } = loadTrack(key, cls);
const peak = peakSlip(spec);

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? 'ok  ' : 'FAIL'} ${label}${extra ? '   ' + extra : ''}`);
};

// Drive a car to the pit entry, ask for a stop (or not), and watch.
function run({ request, damage = 0, lostWing = false, secs = 200 }) {
  const driver = makeDriver(1, 'hard', track.corners.length || 24);
  driver.nextMistake = Infinity; driver.consistency = 1;
  const drive = makeAutopilot(track, lines, spec, peak, { driver });
  const line = lines.at(driver.T.line, driver.grip);
  const car = makeCar({ cls: spec.key });
  const i0 = track.idx(0);
  const p0 = track.point(0, line.off[i0]);
  car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 40;
  car.damage = damage;
  if (lostWing) car.lost = { frontWing: true, rearWing: false };

  const lane = makeLane(track, 22);
  const e = { car, i: 0, box: 3, pitRequest: !!request, inPit: false, pitStops: 0 };

  let hint = i0, t = 0, served = false;
  const r = { maxVInPit: 0, timeInPit: 0, entered: false, exited: false, servedAt: null,
              stoppedInBox: false, wingBefore: !!lostWing, laneOffSeen: 0 };
  while (t < secs) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    // The autopilot steers FIRST and the pit logic overrides afterwards.
    // Reversed, the autopilot's pedals wiped out the braking for the pit entry
    // every substep and the car arrived at the lane at racing speed.
    if (!e.inPit) drive(car, proj, FIXED_DT);
    const gotServed = updateStop(e, track, lane, proj, FIXED_DT, peak);
    if (gotServed) { served = true; r.servedAt = t; }
    step(car, FIXED_DT, { surface: surfaceAt(proj), bank: proj.bank, bankDir: Math.sign(proj.curv) });

    if (e.inPit) {
      r.entered = true;
      r.timeInPit += FIXED_DT;
      r.maxVInPit = Math.max(r.maxVInPit, car.speed);
      r.laneOffSeen = Math.max(r.laneOffSeen, Math.abs(proj.lat));
      if (car.speed < 0.6) r.stoppedInBox = true;
    } else if (r.entered) r.exited = true;
    t += FIXED_DT;
  }
  r.served = served;
  r.wingAfter = !!(car.lost && car.lost.frontWing);
  r.damageAfter = car.damage || 0;
  r.stops = e.pitStops || 0;
  r.phase = e.pitPhase;
  r.sig = `${car.x.toFixed(6)}|${car.y.toFixed(6)}|${(car.damage || 0).toFixed(6)}`;
  return r;
}

console.log(`${track.full} — ${spec.full}`);
const lane = makeLane(track, 22);
console.log(`pit lane: entry s=${lane.entryS.toFixed(0)}  exit s=${lane.exitS.toFixed(0)}  ` +
            `length ${lane.len.toFixed(0)} m  offset ${lane.off.toFixed(1)} m  limit ${(PIT_SPEED * 3.6).toFixed(0)} km/h`);

console.log('\n1. a car that asks for a stop actually gets one');
const A = run({ request: true, lostWing: true, damage: 0.8 });
ok(A.entered, 'entered the pit lane');
ok(A.stoppedInBox, 'came to a stop in its box', `slowest ${(A.maxVInPit * 3.6).toFixed(0)} km/h peak`);
ok(A.served, 'was served', A.servedAt != null ? `at ${A.servedAt.toFixed(1)}s` : '');
ok(A.exited, 'rejoined the circuit');
ok(A.stops === 1, 'counted exactly one stop', `got ${A.stops}`);

console.log('\n2. the stop FIXES the thing it stopped for');
ok(A.wingBefore && !A.wingAfter, 'car.lost.frontWing cleared by a nose change',
   'autopilot re-solves at 0.78x grip while it is set, and nothing else ever clears it');
ok(A.damageAfter < 0.8, 'damage reduced', `0.80 -> ${A.damageAfter.toFixed(2)}`);

console.log('\n3. the limiter is obeyed');
ok(A.maxVInPit <= PIT_SPEED * 1.12, 'never meaningfully over the pit limit',
   `peak ${(A.maxVInPit * 3.6).toFixed(1)} km/h vs ${(PIT_SPEED * 3.6).toFixed(0)}`);
ok(A.laneOffSeen > Math.abs(lane.off) * 0.6, 'actually went down the lane, not the track',
   `reached ${A.laneOffSeen.toFixed(1)} m off the centreline`);

console.log('\n4. and none of it happens to a car that did not ask');
const B = run({ request: false, lostWing: true, damage: 0.8 });
ok(!B.entered, 'never entered the pit lane');
ok(!B.served, 'was not served');
ok(B.wingAfter, 'still has no front wing', 'the damage is NOT quietly repaired');
ok(B.stops === 0, 'counted no stops');

console.log('\n5. the decision to stop is racecraft, not a rule');
ok(shouldPit({ lost: { frontWing: true }, damage: 0.1 }), 'a lost wing asks for a stop');
ok(shouldPit({ lost: null, damage: 0.7 }), 'heavy damage asks for a stop');
ok(!shouldPit({ lost: null, damage: 0.2 }), 'a scrape does NOT');
const svcNose = serviceFor({ lost: { frontWing: true }, damage: 0.8 });
const svcTyre = serviceFor({ lost: null, damage: 0.05 });
ok(svcNose.time > svcTyre.time * 3, 'a nose change costs far more than tyres',
   `${svcNose.time.toFixed(1)}s vs ${svcTyre.time.toFixed(1)}s`);

console.log('\n6. repair() only fixes what was on the job card');
const c = makeCar({ cls: 'f1' });
c.lost = { frontWing: true, rearWing: false };
c.damage = 0.9;
c.dents = [{ lx: 2.4, ly: 0.3, nx: -1, ny: 0, depth: 0.5, r: 1 },
           { lx: -1.8, ly: 0.9, nx: 0, ny: -1, depth: 0.4, r: 1 }];
repair(c, ['nose', 'tyres']);
ok(!c.lost.frontWing, 'nose change cleared the wing');
ok(c.dents.length === 1, 'front dents went with the nose, side dents did not',
   `${c.dents.length} dent left, at lx ${c.dents[0].lx.toFixed(1)}`);
ok(c.damage < 0.9, 'damage reduced but not erased', `${c.damage.toFixed(2)} — a stop is not a rebuild`);

const D = run({ request: true, lostWing: true, damage: 0.8 });
ok(A.sig === D.sig, 'deterministic', A.sig === D.sig ? '' : `\n    ${A.sig}\n    ${D.sig}`);

console.log(bad === 0 ? '\nPASS — a car can be repaired, and only if it asks'
                      : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
