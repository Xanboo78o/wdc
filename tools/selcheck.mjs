// selcheck.mjs — the reverse gate.
//
// Reverse (Shift+R) touches js/physics.js, which is the file every validated
// number lives in. The whole design rests on one
// claim — that DRIVE is arithmetically untouched — and a claim like that is
// worthless unless something re-checks it after every future physics change.
//
// It also pins the two things reverse got wrong on the way in:
//   1. vx is CLAMPED to zero when it goes negative below ~120 km/h, because the
//      bicycle model's slip angles go wrong rolling backwards (measured: 17.7 s
//      and 90 m off at Zandvoort with the clamp removed). Reverse is exactly
//      that regime, so it has a bounded exception and must stay bounded.
//   2. Brake force always pointed backwards, so braking while rolling backwards
//      ACCELERATED the car. Brakes oppose motion, not the nose.
//
//   node tools/selcheck.mjs

import { makeCar, step, FIXED_DT } from '../js/physics.js';

const kmh = v => v * 3.6;
let bad = 0;
const ok = (name, pass, detail) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) bad++;
};

function run({ sel, thr = 1, brk = 0, n, vx0 = 0.001, delta = 0 }) {
  const car = makeCar({ cls: 'f1', aids: { tc: 0, abs: 0, sc: 0 } });
  car.vx = vx0;
  for (let i = 0; i < n; i++) {
    car.throttle = thr; car.brake = brk; car.delta = delta;
    if (sel !== undefined) car.selector = sel;
    step(car, FIXED_DT, { surface: 1 });
  }
  return car;
}

// The reference is DRIVE before the selector existed. If a future change moves
// this, it moved the car — which may be intended, but it must be deliberate.
const REF_VX = 33.927931653, REF_X = 48.570983563;

console.log('reverse — f1, aids off, 20 s at full throttle unless stated');

const d = run({ n: 1200 });                       // no selector set at all = D
const e = run({ sel: 1, n: 1200 });
ok('DRIVE unchanged (no selector)', Math.abs(d.vx - REF_VX) < 1e-6 && Math.abs(d.x - REF_X) < 1e-6,
   `vx ${d.vx.toFixed(9)} x ${d.x.toFixed(9)}`);
ok('DRIVE unchanged (selector = 1)', e.vx === d.vx && e.x === d.x);

const n0 = run({ sel: 0, n: 1200 });
ok('NEUTRAL does not accelerate', Math.abs(n0.vx) < 0.5, `${kmh(n0.vx).toFixed(3)} km/h`);

const r = run({ sel: -1, n: 3000 });              // 50 s, long enough to find the cap
ok('REVERSE goes backwards', r.vx < -1, `${kmh(r.vx).toFixed(2)} km/h`);
ok('REVERSE capped at a crawl', kmh(r.vx) > -30, `${kmh(r.vx).toFixed(2)} km/h (cap is 25)`);

const b = run({ sel: -1, n: 1500 });
const v0 = b.vx;
for (let i = 0; i < 400; i++) { b.throttle = 0; b.brake = 1; b.selector = -1; step(b, FIXED_DT, { surface: 1 }); }
ok('BRAKES slow a reversing car', Math.abs(b.vx) < Math.abs(v0),
   `${kmh(v0).toFixed(2)} -> ${kmh(b.vx).toFixed(2)} km/h`);

const w = run({ sel: -1, n: 900 });
ok('REVERSE runs straight', Math.abs(w.y) < 1, `${Math.abs(w.y).toFixed(3)} m sideways`);

// Shifting back to D while rolling backwards must simply stop the car, not
// leave it in the regime the clamp exists to prevent.
const s = run({ sel: -1, n: 1500 });
for (let i = 0; i < 20; i++) { s.throttle = 0; s.brake = 0; s.selector = 1; step(s, FIXED_DT, { surface: 1 }); }
ok('D while rolling backwards stops the car', Math.abs(s.vx) < 0.01, `${kmh(s.vx).toFixed(3)} km/h`);


console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
