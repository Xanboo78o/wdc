// aerocheck.mjs — the gate for the aerodynamics.
//
// Four questions, and the first one is the one that matters most:
//
//   1. Does the solved map still reproduce the numbers DIRTY AIR validated
//      against real F1 data? If it does not, every lap time in the project and
//      the whole difficulty ladder are built on sand.
//   2. Does it move the way a real car moves — with sideslip, with ride
//      height, with a wing missing?
//   3. Is the WAKE a wake? Strongest directly behind, weaker offset, gone by
//      the time you are a few car lengths back.
//   4. Do clean laps still come out where they did?
//
//   node tools/aerocheck.mjs
import { useAero } from './aerolib.mjs';
import { loadTrack, runLaps, fmt } from './harness.mjs';
import { CARS, topSpeed, makeCar, AERO_REF_RIDE, registerAero, step as stepFn } from '../js/physics.js';
import { makeAero, sampleWake, newWake, dirtyFront, dirtyRear, towDrag,
         dynamicPressure, downforceN, selfTest, RHO } from '../js/aero.js';
import fs from 'fs';

let bad = 0;
const check = (label, got, want, tol, unit = '') => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(42)} ${got.toFixed(3)}${unit}` +
              `  (want ${want}${unit} +-${tol})`);
};

for (const key of ['f1', 'f4']) {
  const spec = CARS[key];
  const j = JSON.parse(fs.readFileSync(new URL(`../data/aero/${key}.json`, import.meta.url), 'utf8'));
  const A = makeAero(j);
  const car = makeCar({ cls: key });
  const o = A.newOut();

  console.log(`\n${spec.full} — ${j.tris} triangles, source: ${j.source}`);
  console.log('1. the validated numbers survive the rebuild');
  A.coeffs(o, car, 0, 0, AERO_REF_RIDE);
  check('ClA at reference', o.clA, spec.ClA, 0.005);
  check('CdA at reference', o.cdA, spec.CdA, 0.005);
  check('aero balance at reference', o.bal, spec.aeroBal, 0.005);
  const q300 = 0.5 * spec.rho * (300 / 3.6) ** 2;
  if (key === 'f1') {
    check('downforce at 300 km/h', q300 * o.clA / 9.81, 2003, 60, ' kg');
    check('drag-limited top speed', topSpeed(spec) * 3.6, 321, 2, ' km/h');
  }

  console.log('2. it moves like a car');
  A.coeffs(o, car, 0, 20, AERO_REF_RIDE);
  const yawCl = o.clA, yawCd = o.cdA;
  console.log(`  20 deg of sideslip: ClA ${yawCl.toFixed(2)} (${((yawCl / spec.ClA - 1) * 100).toFixed(0)}%)` +
              `  CdA ${yawCd.toFixed(2)} (+${((yawCd / spec.CdA - 1) * 100).toFixed(0)}%)`);
  if (yawCl >= spec.ClA * 0.95) { console.log('  FAIL sideslip must COST downforce'); bad++; }
  if (yawCd <= spec.CdA * 1.10) { console.log('  FAIL sideslip must ADD drag'); bad++; }

  A.coeffs(o, car, 0, 0, 0.12);
  console.log(`  120 mm ride height: ClA ${o.clA.toFixed(2)} — the floor has stopped sealing`);
  if (o.clA >= spec.ClA * 0.85) { console.log('  FAIL lifting the floor must cost downforce'); bad++; }

  const dmg = makeCar({ cls: key });
  dmg.lost = { frontWing: true, rearWing: false };
  A.coeffs(o, dmg, 0, 0, AERO_REF_RIDE);
  console.log(`  front wing gone:    ClA ${o.clA.toFixed(2)}  balance ${(o.bal * 100).toFixed(0)}% front` +
              ` (was ${(spec.aeroBal * 100).toFixed(0)}%) — understeer`);
  if (o.bal >= spec.aeroBal) { console.log('  FAIL losing the front wing must move balance REARWARD'); bad++; }
  dmg.lost = { frontWing: false, rearWing: true };
  A.coeffs(o, dmg, 0, 0, AERO_REF_RIDE);
  console.log(`  rear wing gone:     ClA ${o.clA.toFixed(2)}  balance ${(o.bal * 100).toFixed(0)}% front — oversteer`);
  if (o.bal <= spec.aeroBal) { console.log('  FAIL losing the rear wing must move balance FORWARD'); bad++; }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\n2b. the stated number, asserted');
{
  const q = dynamicPressure(50, RHO);
  const F = downforceN(q, CARS.f1.ClA);
  check('q at 50 m/s', q, 1531.25, 1e-6, ' Pa');
  check('F1 downforce at 50 m/s', F, 7074.375, 1e-6, ' N');
  check('...which is', F / 9.81, 721.14, 0.01, ' kgf');
  const fails = selfTest(CARS, () => {});
  if (fails.length) { bad++; console.log('  FAIL aero self test: ' + fails.join('; ')); }
  else console.log('  ok   aero self test clean (and it catches a wrong ClA — see tools/aerocheck)');
  console.log('  NOTE this is the AERO MODULE at the reference ride height. On track the');
  console.log('       car at 50 m/s rides higher and makes less — see the table below, which');
  console.log('       is the suspension loop doing its job, not a disagreement.');
}

console.log('\n3. the wake — dirty air and the tow are the same thing');
const spec = CARS.f1;
const lead = makeCar({ cls: 'f1' });
lead.x = 0; lead.y = 0; lead.hdg = 0;
const w = newWake();
const probe = (gap, off) => {
  const f = makeCar({ cls: 'f1' });
  f.x = -gap; f.y = off;
  sampleWake(w, lead, f);
  return w.dirty;
};
console.log('   gap     on the centreline      offset 1.0 m         offset 2.5 m');
for (const gap of [8, 15, 25, 40, 60]) {
  const a = probe(gap, 0), b = probe(gap, 1.0), c = probe(gap, 2.5);
  console.log(`  ${String(gap).padStart(3)} m   dirty ${a.toFixed(3)}  front -${((1 - dirtyFront(a)) * 100).toFixed(0)}%` +
              `      ${b.toFixed(3)}              ${c.toFixed(3)}`);
}
const near = probe(8, 0), far = probe(60, 0), side = probe(8, 2.5);
if (!(near > far)) { console.log('  FAIL the wake must weaken with distance'); bad++; }
if (!(near > side)) { console.log('  FAIL offsetting must find cleaner air'); bad++; }
if (!(dirtyFront(near) < dirtyRear(near))) { console.log('  FAIL dirty air must hurt the FRONT more'); bad++; }
console.log(`  worst case: front -${((1 - dirtyFront(1)) * 100).toFixed(0)}%, rear -${((1 - dirtyRear(1)) * 100).toFixed(0)}%,` +
            ` drag -${((1 - towDrag(1)) * 100).toFixed(0)}% — you lose the front first, which is why following is hard`);

// ---------------------------------------------------------------------------
console.log('\n3b. downforce squats the car, and the car squatting changes the downforce');
{
  const A2 = makeAero(JSON.parse(fs.readFileSync(new URL('../data/aero/f1.json', import.meta.url), 'utf8')));
  registerAero('f1', A2);
  console.log('   speed      ride      ClA    downforce');
  let last = 1e9, mono = true;
  for (const kmh of [50, 100, 180, 250, 300]) {
    const c = makeCar({ cls: 'f1' });
    for (let i = 0; i < 1200; i++) { c.vx = kmh / 3.6; stepFn(c, 1 / 400, { surface: 1 }); }
    const q = dynamicPressure(c.vx);
    const cl = c._aero.clA;
    console.log(`   ${String(kmh).padStart(4)} km/h ${(c.ride * 1000).toFixed(1).padStart(7)} mm` +
                ` ${cl.toFixed(2).padStart(7)}  ${(q * cl).toFixed(0).padStart(7)} N`);
    if (c.ride > last) mono = false;
    last = c.ride;
    if (kmh === 300) {
      check('downforce at 300 km/h, ON TRACK', q * cl / 9.81, 2003, 80, ' kgf');
      check('ride height at 300 km/h', c.ride * 1000, 30, 6, ' mm');
    }
  }
  if (!mono) { bad++; console.log('  FAIL ride height must fall monotonically with speed'); }
  else console.log('  ok   ride height falls monotonically with speed — no oscillation, no runaway');
}

console.log('\n4. clean laps');
const on = await useAero();
console.log(`   (map registered for: ${on.join(', ')})`);
// Baselines for the COUPLED car. The figure after each is what the same lap
// took with ride height pinned at the reference, i.e. the cost of closing the
// suspension loop — kept visible so nobody has to rediscover it.
const REF_LAPS = { monza: 97.142, monaco: 93.130, suzuka: 108.440, baku: 115.277, zandvoort: 86.320 };
const PINNED = { monza: 96.177, monaco: 92.830, suzuka: 106.837, baku: 113.040, zandvoort: 85.832 };
for (const [t, want] of Object.entries(REF_LAPS)) {
  const { track, lines, spec: sp } = loadTrack(t, 'f1');
  const r = runLaps({ track, lines, spec: sp, laps: 2, tier: 'hard', quiet: true });
  const d = r.best - want;
  const ok = Math.abs(d) < 0.5 && (r.off || 0) < 0.5;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${t.padEnd(10)} ${fmt(r.best)}  ${d >= 0 ? '+' : ''}${d.toFixed(3)}s` +
              `   off ${(r.off || 0).toFixed(1)}s` +
              `   (+${(want - PINNED[t]).toFixed(2)}s is the cost of the suspension loop)`);
}

console.log(bad === 0 ? '\nPASS — solved aerodynamics, and the validated car is still the validated car'
                      : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
