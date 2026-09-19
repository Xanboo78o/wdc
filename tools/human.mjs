// human.mjs — drive the car the way a PERSON does, and find out where it spins.
//
// This exists because tools/drive.mjs lied to me. That harness runs the
// autopilot, which has a countersteer correction and a friction-circle pedal
// budget — two things a player on a keyboard does not have. It reported 0.0 s
// sideways across seven track/car combinations while the game was, in Adam's
// words, impossible to turn without spinning out. A gate that tests a driver
// the player isn't using is not a gate.
//
// So: no countersteer, no trail-braking budget, no lifting when the rear goes.
// Just the keyboard wind-on rates from input.js, a human-ish "aim at the line
// and brake for the corner" policy, and full throttle out of it.
//
//   node tools/human.mjs [track] [class] [--aids=0..1]
import { loadTrack, surfaceAt, fmt } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE, peakSlip } from '../js/physics.js';
import { steerLock, RATES } from '../js/input.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const flag = n => { const f = process.argv.find(x => x.startsWith(`--${n}=`)); return f ? +f.split('=')[1] : undefined; };
const { track, lines, spec } = loadTrack(a[0] || 'monza', a[1] || 'f1');
const line = lines.race;
const peak = peakSlip(spec);
const deg = r => r * 180 / Math.PI;

// keyboard rates, IMPORTED from input.js so they cannot drift apart (they did:
// this file kept driving at the old wind-on for a while after the game changed)
const { tUp, tDn, bUp, bDn } = RATES;
// --wind / --centre override the game's rates, which is how a change to the
// steering feel gets compared against the old one on the same lap
const WIND = flag('wind') ?? RATES.WIND, CENTRE = flag('centre') ?? RATES.CENTRE;

const car = makeCar({ cls: spec.key });
const i0 = track.idx(0);
const p0 = track.point(0, line.off[i0]);
car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 20;

let wheel = 0, thr = 0, brk = 0, hint = i0, t = 0;
let firstSpin = null, spinT = 0, offT = 0, maxSlip = 0;
const events = [];
const rows = [];        // rolling record, so the spin can be read back frame by frame

while (t < 240) {
  const proj = track.project(car.x, car.y, hint);
  hint = proj.i;

  // ---- what a person does -------------------------------------------------
  // Aim at the racing line. No countersteer term: a keyboard player cannot
  // react to a slip angle they cannot feel.
  const px = line.pts[proj.i * 2], py = line.pts[proj.i * 2 + 1];
  const h = line.hdg[proj.i];
  const cross = -Math.sin(h) * (car.x - px) + Math.cos(h) * (car.y - py);
  let hErr = h - car.hdg;
  while (hErr > Math.PI) hErr -= 2 * Math.PI;
  while (hErr < -Math.PI) hErr += 2 * Math.PI;
  // GAIN is how hard this fake driver yanks the wheel. It matters enormously:
  // a high gain pins the wheel at full lock and holds it there, which no real
  // player does — they feel the car stop turning and come off it. Sweep this
  // before trusting anything this harness says about the CAR.
  const G = flag('gain') ?? 2.2;
  const want = Math.max(-1, Math.min(1, (hErr * G + Math.atan2(-1.6 * cross, Math.max(car.speed, 8)) * G) / steerLock(car.speed)));

  // the wheel winds on at a finite rate, exactly like holding an arrow key
  if (want !== 0) {
    const rate = WIND * (want * wheel < 0 ? 1.8 : 1);
    wheel += Math.sign(want - wheel) * Math.min(rate * FIXED_DT, Math.abs(want - wheel));
  } else {
    wheel -= Math.sign(wheel) * Math.min(CENTRE * FIXED_DT, Math.abs(wheel));
  }

  // brake for the corner you can see, then full throttle. No modulation.
  const ahead = line.v[track.idx(proj.s + Math.min(70, car.speed * 0.9))];
  const wantBrake = car.speed > ahead * 1.02;
  thr += wantBrake ? -Math.min(tDn * FIXED_DT, thr) : Math.min(tUp * FIXED_DT, 1 - thr);
  brk += wantBrake ? Math.min(bUp * FIXED_DT, 1 - brk) : -Math.min(bDn * FIXED_DT, brk);

  car.delta = wheel * steerLock(car.speed);
  car.throttle = thr; car.brake = brk;

  const surface = surfaceAt(proj);
  step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv) });

  rows.push({ t, v: car.speed, wheel, delta: car.delta, eff: car.steerEff ?? car.delta,
              sf: car.slipF, sr: car.slipR, thr: car.throttle, brk: car.brake,
              tc: car.tcCut, abs: car.absCut, lat: proj.lat, w: proj.w,
              corner: track.cornerAt(proj.s)?.name || '' });
  maxSlip = Math.max(maxSlip, Math.abs(car.slipR));
  if (surface < SURFACE.track) offT += FIXED_DT;
  // Only count going sideways ON THE ROAD. Sliding around in the gravel after
  // you have already left is a consequence, not the fault, and folding the two
  // together made a gentler driver look WORSE — it drove off more and the
  // grass-sliding inflated the spin number.
  if (surface === SURFACE.track && Math.abs(car.slipR) > peak * 3 && car.speed > 12) {
    spinT += FIXED_DT;
    if (!firstSpin) {
      firstSpin = { t, s: proj.s, v: car.speed, sr: car.slipR, sf: car.slipF,
                    thr, brk, delta: car.delta, corner: track.cornerAt(proj.s)?.name || '(straight)' };
    }
  }
  if (events.length < 12 && Math.abs(car.slipR) > peak * 2 && car.speed > 12 &&
      (!events.length || t - events[events.length - 1].t > 1.5)) {
    events.push({ t, corner: track.cornerAt(proj.s)?.name || '(straight)', sr: deg(car.slipR), v: car.speed * 3.6 });
  }
  t += FIXED_DT;
}

console.log(`${track.full} — ${spec.full} — driven like a KEYBOARD PLAYER (no countersteer, no pedal budget)\n`);
if (firstSpin) {
  console.log(`FIRST SPIN at ${firstSpin.t.toFixed(1)}s, ${firstSpin.corner}`);
  console.log(`  speed ${(firstSpin.v * 3.6).toFixed(0)} km/h | steer ${deg(firstSpin.delta).toFixed(1)}deg`);
  console.log(`  slip front ${deg(firstSpin.sf).toFixed(1)}deg  rear ${deg(firstSpin.sr).toFixed(1)}deg  (peak is ${deg(peak).toFixed(1)})`);
  console.log(`  throttle ${firstSpin.thr.toFixed(2)}  brake ${firstSpin.brk.toFixed(2)}`);
} else {
  console.log('never spun');
}
console.log(`\ntotal sideways ${spinT.toFixed(1)}s of ${t.toFixed(0)}s   off track ${offT.toFixed(1)}s   worst rear slip ${deg(maxSlip).toFixed(0)}deg`);

if (firstSpin) {
  const idx = rows.findIndex(r => r.t >= firstSpin.t);
  console.log('\n=== the two seconds into the first spin ===');
  console.log('t      v   wheel  steer   eff  slipF  slipR  thr   tc   brk  abs    lat  where');
  for (let i = Math.max(0, idx - 800); i <= idx + 80 && i < rows.length; i += 20) {
    const r = rows[i];
    console.log([
      r.t.toFixed(2).padStart(6),
      (r.v * 3.6).toFixed(0).padStart(4),
      r.wheel.toFixed(2).padStart(6),
      deg(r.delta).toFixed(1).padStart(6),
      deg(r.eff).toFixed(1).padStart(6),
      deg(r.sf).toFixed(1).padStart(6),
      deg(r.sr).toFixed(1).padStart(6),
      r.thr.toFixed(2).padStart(5),
      r.tc.toFixed(2).padStart(5),
      r.brk.toFixed(2).padStart(5),
      r.abs.toFixed(2).padStart(5),
      r.lat.toFixed(1).padStart(6),
      ' ' + r.corner,
    ].join(' '));
  }
}
if (events.length) {
  console.log('\nwhere it lets go:');
  for (const e of events) console.log(`  ${e.t.toFixed(1).padStart(6)}s  ${e.v.toFixed(0).padStart(4)} km/h  rear ${e.sr.toFixed(0).padStart(4)}deg  ${e.corner}`);
}
