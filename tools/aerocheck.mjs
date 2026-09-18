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
import { CARS, topSpeed, makeCar, AERO_REF_RIDE } from '../js/physics.js';
import { makeAero, sampleWake, newWake, dirtyFront, dirtyRear, towDrag } from '../js/aero.js';
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
console.log('\n4. clean laps have not moved');
const on = await useAero();
console.log(`   (map registered for: ${on.join(', ')})`);
const REF_LAPS = { monza: 96.177, monaco: 92.830, suzuka: 106.837, baku: 113.040, zandvoort: 85.832 };
for (const [t, want] of Object.entries(REF_LAPS)) {
  const { track, lines, spec: sp } = loadTrack(t, 'f1');
  const r = runLaps({ track, lines, spec: sp, laps: 2, tier: 'hard', quiet: true });
  const d = r.best - want;
  const ok = Math.abs(d) < 0.5 && (r.off || 0) < 0.5;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${t.padEnd(10)} ${fmt(r.best)}  ${d >= 0 ? '+' : ''}${d.toFixed(3)}s vs constants` +
              `   off ${(r.off || 0).toFixed(1)}s`);
}

console.log(bad === 0 ? '\nPASS — solved aerodynamics, and the validated car is still the validated car'
                      : `\n${bad} FAILURE(S)`);
process.exit(bad ? 1 : 0);
