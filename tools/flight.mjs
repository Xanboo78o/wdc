// flight.mjs — the gate for the vertical axis.
//
// crash.mjs asks whether the bodywork can end up inside a barrier. This asks
// the question that one cannot: does the car ever LEAVE THE GROUND, does it
// leave it for the right reasons, and does it come back down and settle?
//
// The four ways a single-seater gets airborne, one section each:
//   1. spun backwards at speed  — the diffuser becomes a ramp and it flies
//   2. hard into a barrier      — the base of the wall levers it up
//   3. up another car's rear wheel — the tyre is a ramp
//   4. landing                  — does it settle, or pogo forever?
//
// Every one of these must also STOP. A car that never settles is worse than a
// car that never flies, because the race never ends.
//
//   node tools/flight.mjs [track] [class]
import { loadTrack, surfaceAt } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE, topSpeed } from '../js/physics.js';
import { resolveBarrier, resolveCars } from '../js/collide.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const { track, spec } = loadTrack(a[0] || 'monza', a[1] || 'f1');
const deg = r => r * 180 / Math.PI;
const HZ = 1 / FIXED_DT;

// Run a car until it settles or the clock runs out, watching the third axis.
// `setup` places the car; `barriers` says whether the walls are in play.
function fly(setup, { secs = 8, barriers = true } = {}) {
  const car = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const s0 = setup(car) ?? 300;
  let hint = track.idx(s0);
  const r = { peakZ: 0, airTime: 0, maxPitch: 0, maxRoll: 0, roof: false,
              flips: 0, landed: false, settleAt: null, dents: 0, lost: '' };
  let wasUp = false, lastRoll = 0, rollTurn = 0;

  for (let k = 0; k < HZ * secs; k++) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    car.throttle = 0; car.brake = 0; car.delta = 0;
    step(car, FIXED_DT, { surface: surfaceAt(proj) });
    if (barriers) resolveBarrier(car, track, hint);

    if (car.airborne) {
      r.airTime += FIXED_DT;
      if (car.z > r.peakZ) r.peakZ = car.z;
      r.maxPitch = Math.max(r.maxPitch, Math.abs(car.pitch));
      r.maxRoll = Math.max(r.maxRoll, Math.abs(car.roll));
      if (car.onRoof) r.roof = true;
      wasUp = true;
    } else if (wasUp && r.settleAt == null) {
      r.landed = true; r.settleAt = k / HZ;
    }
    // count barrel rolls by watching the roll angle wrap
    rollTurn += Math.abs(car.roll - lastRoll) > Math.PI ? 0 : Math.abs(car.roll - lastRoll);
    lastRoll = car.roll;
  }
  r.flips = rollTurn / (2 * Math.PI);
  r.dents = (car.dents || []).length;
  r.lost = car.lost ? Object.keys(car.lost).filter(k => car.lost[k]).join('+') : '';
  r.endSpeed = car.speed * 3.6;
  r.stillUp = car.airborne;
  r.damage = car.damage || 0;
  r.sig = `${car.x.toFixed(9)}|${car.z.toFixed(9)}|${car.pitch.toFixed(9)}|${car.roll.toFixed(9)}`;
  return r;
}

const row = (label, r) => [
  label.padEnd(22),
  (r.peakZ > 0.01 ? r.peakZ.toFixed(2) + ' m' : '—').padStart(9),
  (r.airTime > 0.01 ? r.airTime.toFixed(2) + ' s' : '—').padStart(9),
  (deg(r.maxPitch).toFixed(0) + '°').padStart(7),
  (deg(r.maxRoll).toFixed(0) + '°').padStart(7),
  (r.roof ? 'ROOF' : r.stillUp ? '..still up' : r.landed ? 'landed' : '—').padStart(11),
  (r.settleAt != null ? r.settleAt.toFixed(1) + ' s' : '—').padStart(8),
  r.endSpeed.toFixed(0).padStart(5),
].join(' ');

const head = t => {
  console.log(`\n${t}`);
  console.log('                          peak up   air time   pitch    roll     outcome   settled speed');
};

console.log(`${track.full} — ${spec.full} — barrier "${track.wall}"`);
console.log(`ClFloor ${spec.ClFloor}  Iyy ${spec.Iyy}  Ixx ${spec.Ixx}  top speed ${(topSpeed(spec) * 3.6).toFixed(0)} km/h`);

// ---------------------------------------------------------------------------
// 1. SPUN BACKWARDS. The car is pointing the wrong way at speed, so the
//    diffuser is the leading edge and it rakes upward. There should be a clean
//    threshold: nothing at all below it, flight above it.
// ---------------------------------------------------------------------------
head('1. SPUN BACKWARDS — the airflow gets under the floor');
for (const kmh of [120, 160, 200, 220, 260, 300]) {
  const r = fly(c => {
    const p = track.point(300, 0);
    c.x = p.x; c.y = p.y; c.hdg = p.hdg + Math.PI;   // facing back up the road
    c.vx = -kmh / 3.6; c.vy = 0; c.r = 0;            // ...still travelling forwards
    return 300;
  }, { barriers: false, secs: 6 });
  console.log(row(`  backwards @ ${kmh}`, r));
}

// ---------------------------------------------------------------------------
// 2. INTO A BARRIER.
// ---------------------------------------------------------------------------
head('2. INTO A BARRIER — the base of the wall levers the car up');
for (const [kmh, ang] of [[120, 20], [180, 35], [220, 35], [260, 55]]) {
  const r = fly(c => {
    const p = track.point(300, 0);
    c.x = p.x; c.y = p.y; c.hdg = p.hdg + ang * Math.PI / 180;
    c.vx = kmh / 3.6; c.vy = 0; c.r = 0;
    return 300;
  }, { secs: 8 });
  console.log(row(`  ${kmh} km/h at ${ang}°`, r) + `  dents ${r.dents}` +
    (r.lost ? `  LOST ${r.lost}` : '') + `  dmg ${r.damage.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// 3. UP A REAR WHEEL. Two cars, one diving up the inside of the other. The
//    same shunt dead centre must NOT fly — that is the whole test.
// ---------------------------------------------------------------------------
head('3. UP A REAR WHEEL — offset flies, dead centre does not');
// Closing speed is the variable that matters, so sweep it: a pack shuffle
// must not fly, a misjudged dive must.
for (const [lat, kmh, closing, label] of [[0.0, 200, 70, 'dead centre, big dive'],
                                          [0.95, 200, 15, 'offset, pack shuffle'],
                                          [0.95, 200, 40, 'offset, dive'],
                                          [0.95, 240, 70, 'offset, big dive']]) {
  const lead = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const chase = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const p = track.point(300, 0);
  const nx = -Math.sin(p.hdg), ny = Math.cos(p.hdg);
  lead.x = p.x; lead.y = p.y; lead.hdg = p.hdg; lead.vx = (kmh - closing) / 3.6;
  chase.x = p.x - Math.cos(p.hdg) * 5.9 + nx * lat;
  chase.y = p.y - Math.sin(p.hdg) * 5.9 + ny * lat;
  chase.hdg = p.hdg; chase.vx = kmh / 3.6;

  let hint = track.idx(300), peakZ = 0, air = 0, mp = 0, roof = false;
  for (let k = 0; k < HZ * 5; k++) {
    for (const c of [lead, chase]) {
      const pr = track.project(c.x, c.y, hint);
      c.throttle = 0; c.brake = 0; c.delta = 0;
      step(c, FIXED_DT, { surface: surfaceAt(pr) });
      resolveBarrier(c, track, pr.i);
    }
    resolveCars(chase, lead);
    if (chase.airborne) { air += FIXED_DT; peakZ = Math.max(peakZ, chase.z); mp = Math.max(mp, Math.abs(chase.pitch)); }
    if (chase.onRoof) roof = true;
  }
  console.log(row(`  ${label}`, { peakZ, airTime: air, maxPitch: mp, maxRoll: 0, roof,
    stillUp: chase.airborne, landed: air > 0, settleAt: null, endSpeed: chase.speed * 3.6 }));
}

// ---------------------------------------------------------------------------
// 4. LANDING. Dropped from height, does it settle — and how hard is too hard?
// ---------------------------------------------------------------------------
head('4. DROPPED — it has to come down AND stop');
// Slow first, so this tests the CONTACT SOLVER on its own with no aero in the
// way. Then fast, where the floor gets a say.
for (const [h, kmh, pitch] of [[0.5, 60, 0], [2, 60, 0], [5, 60, 0], [12, 60, 0],
                               [0.5, 180, 0.08], [2, 180, 0.08], [5, 250, 0.08]]) {
  const r = fly(c => {
    const p = track.point(300, 0);
    c.x = p.x; c.y = p.y; c.hdg = p.hdg;
    c.vx = kmh / 3.6; c.airborne = true; c.z = h; c.pitch = pitch;
    return 300;
  }, { secs: 10 });
  console.log(row(`  ${h} m @ ${kmh} km/h`, r) + `  dmg ${r.damage.toFixed(2)}`);
}

const A = fly(c => { const p = track.point(300, 0); c.x = p.x; c.y = p.y;
  c.hdg = p.hdg + 0.6; c.vx = 220 / 3.6; return 300; });
const B = fly(c => { const p = track.point(300, 0); c.x = p.x; c.y = p.y;
  c.hdg = p.hdg + 0.6; c.vx = 220 / 3.6; return 300; });
console.log(`\ndeterminism: ${A.sig === B.sig ? 'PASS — identical to 9 decimal places' : 'FAIL\n  ' + A.sig + '\n  ' + B.sig}`);
