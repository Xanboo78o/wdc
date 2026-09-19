// brakecheck.mjs — how hard does the car stop? Straight line, full pedal,
// the game's own physics and aero map, default driver aids.
//
//   node tools/brakecheck.mjs            both cars
//   node tools/brakecheck.mjs --pedal 0.67   a part-pressed pedal instead of 1
//
// Prints deceleration (g) at speed, and the reference stop real F1 data is
// quoted for: Monza turn 1, ~340 -> ~80 km/h (Brembo: ~2.5 s, ~130 m,
// peaking between 5 and 6 g). Downforce is most of an F1 car's braking, so
// the g falls as the speed does — a flat number would be the tell of a
// brake that is not talking to the tyres.
import fs from 'fs';
import { CARS, makeCar, step, FIXED_DT, registerAero, topSpeed } from '../js/physics.js';
import { makeAero } from '../js/aero.js';

const args = process.argv.slice(2);
let pedal = 1;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pedal') pedal = Math.max(0, Math.min(1, parseFloat(args[++i])));
  else { console.error(`unknown flag ${args[i]}`); process.exit(2); }
}
for (const k of ['f1', 'f4']) {
  try { registerAero(k, makeAero(JSON.parse(fs.readFileSync(new URL(`../data/aero/${k}.json`, import.meta.url))))); }
  catch { console.log(`(no aero map for ${k}, constants)`); }
}

function stop(cls, from, to) {
  const car = makeCar({ cls });
  car.vx = from / 3.6;
  // settle the ride height at speed before braking, or the first metres run
  // on a car that has not squatted onto its downforce yet
  car.throttle = 0; car.brake = 0;
  for (let i = 0; i < 400; i++) { step(car, FIXED_DT, { surface: 1 }); car.vx = from / 3.6; car.vy = 0; car.r = 0; }
  let t = 0, x = 0, peak = 0;
  const marks = [];
  const bands = [300, 250, 200, 150, 100, 50].filter(b => b < from);
  car.brake = pedal;
  while (car.vx * 3.6 > to && t < 20) {
    const v0 = car.vx;
    step(car, FIXED_DT, { surface: 1 });
    t += FIXED_DT; x += car.vx * FIXED_DT;
    const g = (v0 - car.vx) / FIXED_DT / 9.81;
    peak = Math.max(peak, g);
    while (bands.length && car.vx * 3.6 <= bands[0]) marks.push([bands.shift(), g]);
  }
  return { t, x, peak, marks, locked: car.lock };
}

for (const cls of ['f1', 'f4']) {
  const S = CARS[cls], top = Math.round(topSpeed(S) * 3.6);
  const from = Math.min(top - 5, cls === 'f1' ? 340 : 210);
  const r = stop(cls, from, cls === 'f1' ? 80 : 60);
  console.log(`\n${S.full}  Fbrake ${S.Fbrake} N  pedal ${pedal}   ${from} -> ${cls === 'f1' ? 80 : 60} km/h: ${r.t.toFixed(2)} s, ${r.x.toFixed(0)} m, peak ${r.peak.toFixed(2)} g`);
  console.log('   ' + r.marks.map(([b, g]) => `${b} km/h ${g.toFixed(2)} g`).join('   '));
}
