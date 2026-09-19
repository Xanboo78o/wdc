// balance.mjs — set the car's balance by MEASUREMENT, not by feel.
//
// The car got four corners and real lateral load transfer (js/physics.js,
// "FOUR CORNERS"), and that brought one genuine setup knob with it:
// `spec.rollDist`, the front's share of that transfer — the anti-roll bar.
// Higher rollDist spreads the front axle's load more unevenly, which costs it
// grip through LOAD_SENS, which is understeer. Lower it and the rear gives way
// first. There is no third option and no fudge factor: this is the knob.
//
// The trap this tool exists to avoid: you can always stop a car spinning by
// making it understeer, and you can always make it rotate by making it snap.
// So every row prints BOTH — the car has to turn AND stay pointing forwards —
// plus the pace, because a balance that does both by being slow is not a
// setup, it is a handbrake.
//
//   node tools/balance.mjs [class] [--dist=0.40,0.46,0.52,0.58]
//
// BALANCE is mean(|slipF| - |slipR|) in degrees while the car is cornering
// hard. Positive = the front is working harder = understeer. It is the number
// a driver would report over the radio, and it is what rollDist moves.
import { loadTrack, surfaceAt, runLaps, fmt } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE, peakSlip, CARS } from '../js/physics.js';
import { steerLock } from '../js/input.js';

// Keyboard rates, copied from js/input.js so they cannot drift apart — the
// same copy tools/human.mjs keeps, and for the same reason.
const WIND = 2.7, CENTRE = 5.2, tUp = 3.4, tDn = 7.5, bUp = 5.5, bDn = 9;
const deg = r => r * 180 / Math.PI;

const args = process.argv.slice(2).filter(x => !x.startsWith('--'));
const flag = n => { const f = process.argv.find(x => x.startsWith(`--${n}=`)); return f ? f.split('=')[1] : undefined; };
const cls = args[0] || 'f1';
const DISTS = (flag('dist') || '0.40,0.46,0.52,0.58,0.64').split(',').map(Number);
const SENS = (flag('sens') || '').split(',').filter(Boolean).map(Number);
const TRACKS = (flag('tracks') || 'monza,suzuka,baku,zandvoort').split(',');

// A PLAYER, not the autopilot. drive.mjs only ever tested the autopilot, which
// has countersteer and a pedal budget a person on a keyboard does not, and it
// reported 0.0 s sideways while the game was undrivable. Balance is a thing
// you feel through the steering, so it has to be measured through a driver who
// has the same hands you do.
function keyboardLap(track, lines, spec, T = 240) {
  const line = lines.race, peak = peakSlip(spec);
  const car = makeCar({ cls: spec.key });
  const i0 = track.idx(0), p0 = track.point(0, line.off[i0]);
  car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 20;
  let wheel = 0, thr = 0, brk = 0, hint = i0, t = 0;
  let spinT = 0, offT = 0, dist = 0, balSum = 0, balN = 0, pkG = 0;

  while (t < T) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const px = line.pts[proj.i * 2], py = line.pts[proj.i * 2 + 1];
    const h = line.hdg[proj.i];
    const cross = -Math.sin(h) * (car.x - px) + Math.cos(h) * (car.y - py);
    let hErr = h - car.hdg;
    while (hErr > Math.PI) hErr -= 2 * Math.PI;
    while (hErr < -Math.PI) hErr += 2 * Math.PI;
    const G = 2.2;
    const want = Math.max(-1, Math.min(1,
      (hErr * G + Math.atan2(-1.6 * cross, Math.max(car.speed, 8)) * G) / steerLock(car.speed)));
    if (want !== 0) {
      const rate = WIND * (want * wheel < 0 ? 1.8 : 1);
      wheel += Math.sign(want - wheel) * Math.min(rate * FIXED_DT, Math.abs(want - wheel));
    } else wheel -= Math.sign(wheel) * Math.min(CENTRE * FIXED_DT, Math.abs(wheel));

    const ahead = line.v[track.idx(proj.s + Math.min(70, car.speed * 0.9))];
    const wantBrake = car.speed > ahead * 1.02;
    thr += wantBrake ? -Math.min(tDn * FIXED_DT, thr) : Math.min(tUp * FIXED_DT, 1 - thr);
    brk += wantBrake ? Math.min(bUp * FIXED_DT, 1 - brk) : -Math.min(bDn * FIXED_DT, brk);

    car.delta = wheel * steerLock(car.speed);
    car.throttle = thr; car.brake = brk;
    const surface = surfaceAt(proj);
    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv) });

    dist += car.speed * FIXED_DT;
    if (surface === SURFACE.track) pkG = Math.max(pkG, Math.abs(car.gLat));
    if (surface < SURFACE.track) offT += FIXED_DT;
    // Only ON TRACK: sliding in the gravel after you have already left is a
    // consequence, not the fault, and counting it makes a gentler car look
    // worse because it goes off more.
    if (surface === SURFACE.track && Math.abs(car.slipR) > peak * 3 && car.speed > 12) spinT += FIXED_DT;
    // Balance is only meaningful while the car is actually loaded up. Sampling
    // it on the straights drowns the signal in a million rows of zero.
    if (Math.abs(car.gLat) > 1.2 && car.speed > 15) {
      balSum += deg(Math.abs(car.slipF) - Math.abs(car.slipR)); balN++;
    }
    t += FIXED_DT;
  }
  return { spinT, offT, avg: dist / T * 3.6, bal: balN ? balSum / balN : 0, pkG };
}

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const se = a => a.length < 2 ? 0
  : Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1) / a.length);

const spec0 = CARS[cls];
const saved = spec0.rollDist;
const loaded = TRACKS.map(k => ({ k, ...loadTrack(k, cls) }));

console.log(`${spec0.full} — balance sweep over ${TRACKS.join(', ')}\n`);
const savedSens = spec0.loadSens;
const SENSLIST = SENS.length ? SENS : [savedSens];
console.log('dist  sens   BALANCE deg      off track s     sideways s    peak gLat   autopilot best');
console.log('             (+ = understeer)                 (ON TRACK)    (grip the car can use)');
for (const sv of SENSLIST) {
 spec0.loadSens = sv;
 for (const d of DISTS) {
  // CARS entries are shared references — every car in a race reads this same
  // object. Mutating it here is fine only because the sweep is single-threaded
  // and it is restored at the end. Same hazard as driver.T in harness.mjs.
  spec0.rollDist = d;
  const bal = [], off = [], spin = [], avg = [], lap = [], pk = [];
  for (const { track, lines, spec } of loaded) {
    const r = keyboardLap(track, lines, spec);
    bal.push(r.bal); off.push(r.offT); spin.push(r.spinT); avg.push(r.avg); pk.push(r.pkG);
    // Pace from the autopilot, quiet (no scripted mistakes), so the lap time
    // is about the CAR and not about a random error.
    const a = runLaps({ track, lines, spec, laps: 2, tier: 'hard', quiet: true });
    if (a.best != null) lap.push(a.best);
  }
  const mark = (d === saved && sv === savedSens) ? ' <-' : '';
  console.log(`${d.toFixed(2)}  ${sv.toFixed(2)}  ${mean(bal).toFixed(2).padStart(7)} +-${se(bal).toFixed(2).padEnd(5)} ` +
    `${mean(off).toFixed(1).padStart(6)} +-${se(off).toFixed(1).padEnd(4)} ` +
    `${mean(spin).toFixed(2).padStart(6)} +-${se(spin).toFixed(2).padEnd(4)} ` +
    `${mean(pk).toFixed(2).padStart(8)}   ${lap.length ? fmt(mean(lap)) : '   --   '}${mark}`);
 }
}
spec0.rollDist = saved; spec0.loadSens = savedSens;

console.log(`\n  n = ${TRACKS.length} circuits per row. +- is the standard error across them.`);
console.log('  A difference smaller than twice the SE is not a result. Circuits differ far');
console.log('  more than setups do, so read the TREND down a column, never one row.');
