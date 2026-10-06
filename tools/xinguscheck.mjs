// xinguscheck.mjs — does Xingus mode keep its three promises?
//
// js/xingus.js says: the car GRIPS unless you ask it to slide, a DRIFT holds
// the angle you set for as long as you hold it and gathers up when you let
// go, and it CANNOT SPIN. Feel is Adam's to judge on the wheel; these are the
// parts that are true or false, on an open flat plain with the real physics:
//
//   abuse     a minute of the worst driving there is — full throttle, the
//             wheel thrown lock to lock, the handbrake at random. The slip
//             angle never passes SPIN_BETA and the car never points backwards.
//             THE SAME INPUTS WITHOUT THE MODE must spin, or this proves nothing.
//   grip      a hard steady corner with no handbrake: the slide stays small.
//   drift     handbrake and half lock at 160 km/h: within a second and a half
//             the car is at a steady angle between 14 and 40 degrees, it holds
//             it for five seconds without losing a third of its speed, more
//             lock is more angle, and a second after the wheel is straight
//             the car is too.
//
//   node tools/xinguscheck.mjs [--car gt3|f1|f4] [--break nogovern]
import { CARS, makeCar, step, FIXED_DT, SURFACE, dragFor } from '../js/physics.js';
import { xingusCar, xingusStep, SPIN_BETA, GRIP_BETA } from '../js/xingus.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['car', 'break']);
for (let k = 0; k < args.length; k += 2) if (!args[k].startsWith('--') || !KNOWN.has(args[k].slice(2)) || args[k + 1] == null) { console.error(`xinguscheck: bad flag ${args[k]}`); process.exit(2); }
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const CLS = flag('car', 'gt3'), BREAK = flag('break', null);
if (!CARS[CLS]) { console.error(`xinguscheck: no car ${CLS}`); process.exit(2); }
const DEG = 180 / Math.PI, LOCK = 0.3;
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(40)} ${detail}`); };
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// Drive `secs` of `script(t) -> { throttle, brake, wheel, hand }` from v0 m/s.
function drive(secs, v0, script, mode = true, watch = null, aids = null) {
  const car = makeCar({ cls: CLS });
  if (aids) car.aids = aids;
  car.vx = v0; car.speed = v0;
  if (mode) xingusCar(car);
  const out = { maxBeta: 0, backwards: 0, v: [], beta: [] };
  for (let t = 0, k = 0; t < secs; t += FIXED_DT, k++) {
    const u = script(t), inp = { throttle: u.throttle ?? 0, brake: u.brake ?? 0, delta: (u.wheel || 0) * LOCK, wheel: u.wheel || 0, hand: !!u.hand };
    car.throttle = inp.throttle; car.brake = inp.brake; car.delta = inp.delta;
    step(car, FIXED_DT, { surface: SURFACE.track, bank: 0, bankDir: 0, dirty: 0, tow: 0, rollMul: dragFor(SURFACE.track), slope: 0 });
    if (mode && BREAK !== 'nogovern') xingusStep(car, inp, FIXED_DT);
    const v = Math.hypot(car.vx, car.vy), beta = Math.atan2(car.vy, car.vx);
    if (v > 9) { out.maxBeta = Math.max(out.maxBeta, Math.abs(beta)); if (car.vx < 0) out.backwards += FIXED_DT; }
    if (k % 40 === 0) { out.v.push(v); out.beta.push(beta); if (watch) watch(t, car, beta, v); }
  }
  out.car = car;
  return out;
}

console.log(`XINGUS MODE — ${CARS[CLS].full}${BREAK ? `   [--break ${BREAK}]` : ''}\n`);
console.log('[abuse] sixty seconds of the worst driving there is, three times');
let worst = 0, back = 0, spunWithout = 0, realWorst = 0;
for (const seed of [3, 11, 29]) {
  const mk = () => { const r = mulberry(seed); let w = 1, h = false, nx = 0; return t => { if (t >= nx) { nx = t + 0.4 + r() * 1.6; w = r() < 0.5 ? -1 : 1; if (r() < 0.25) w *= 0.4; h = r() < 0.4; } return { throttle: 1, wheel: w, hand: h && (t % 1) < 0.4 }; }; };
  // the control: the real car with its aids off, which is what the mode stands in for
  const a = drive(60, 45, mk(), true), b = drive(60, 45, mk(), false, null, { tc: 0, abs: 0, sc: 0 });
  worst = Math.max(worst, a.maxBeta); back += a.backwards; realWorst = Math.max(realWorst, b.maxBeta);
  if (b.maxBeta > 75 / DEG || b.backwards > 0.5) spunWithout++;   // sideways at 75 degrees is a car you have lost
}
check('the slide never passes the limit', worst <= SPIN_BETA + 0.01, `worst ${(worst * DEG).toFixed(1)} deg (limit ${(SPIN_BETA * DEG).toFixed(0)})`);
check('never pointing backwards', back === 0, `${back.toFixed(2)} s`);
check('the same inputs spin the real car', spunWithout === 3, `${spunWithout} of 3 runs spun without the mode and its aids (worst ${(realWorst * DEG).toFixed(0)} deg)`);

console.log('\n[grip] a hard steady corner, no handbrake');
{
  const g = drive(8, 50, t => ({ throttle: 0.7, wheel: t < 0.5 ? 0 : 0.45 }));
  const tail = g.beta.slice(20).map(Math.abs);
  check('the slide stays small', Math.max(...tail) <= GRIP_BETA + 0.005, `at most ${(Math.max(...tail) * DEG).toFixed(1)} deg (limit ${(GRIP_BETA * DEG).toFixed(0)})`);
  check('and it is turning', Math.abs(g.car.r) > 0.1, `yaw rate ${g.car.r.toFixed(2)} rad/s at ${(g.v.at(-1) * 3.6).toFixed(0)} km/h`);
}

console.log('\n[drift] handbrake and half lock at 160 km/h, held, then let go');
{
  const run = lock => drive(9, 44.4, t => t < 0.5 ? { throttle: 1 } : t < 0.9 ? { throttle: 1, wheel: lock, hand: true } : t < 6.5 ? { throttle: 1, wheel: lock } : { throttle: 1, wheel: 0 });
  const d = run(0.5), deep = run(1.0);
  const at = (o, t0, t1) => o.beta.slice(Math.round(t0 * 10), Math.round(t1 * 10)).map(b => Math.abs(b) * DEG);
  const hold = at(d, 2.4, 6.4), mean = hold.reduce((a, b) => a + b, 0) / hold.length, wob = Math.max(...hold) - Math.min(...hold);
  check('in the drift within a second and a half', at(d, 2.0, 2.4).every(b => b > 13.5), `${at(d, 2.0, 2.4)[0].toFixed(1)} deg at 1.5 s after the handbrake`);
  check('holds a steady angle', mean > 13.5 && mean < 40.5 && wob < 3, `${mean.toFixed(1)} deg for four seconds, wandering ${wob.toFixed(1)}`);
  const v0 = d.v[9], v1 = d.v[64];
  check('without losing its speed', v1 > v0 * 0.67, `${(v0 * 3.6).toFixed(0)} -> ${(v1 * 3.6).toFixed(0)} km/h`);
  const dm = at(deep, 2.4, 6.4).reduce((a, b) => a + b, 0) / 40;
  check('more lock is more angle', dm > mean + 5, `${mean.toFixed(1)} deg at half lock, ${dm.toFixed(1)} at full`);
  const after = at(d, 7.5, 9.0);
  check('straight a second after the wheel is', Math.max(...after) < 6, `${Math.max(...after).toFixed(1)} deg from 1.0 s after letting go`);
  check('and it turned the way you steered', d.car.hdg > 0.9, `heading ${(d.car.hdg * DEG).toFixed(0)} deg (+ = left, the wheel was left)`);
}
console.log(fails ? `\n${fails} FAILED${BREAK ? '  [this run SHOULD fail]' : ''}` : '\nall ok');
process.exit(fails && !BREAK ? 1 : 0);
