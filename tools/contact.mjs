// contact.mjs — the gate for car-to-car contact.
//
// Three assertions, in increasing order of how much they prove:
//
//   1. After resolving, the two cars do not overlap. (The barrier version of
//      this bug was reported as "I am half in half out of a wall".)
//   2. TOTAL LINEAR MOMENTUM IS CONSERVED. Restitution and friction change the
//      energy of a collision, but they are internal forces and can never change
//      the total momentum. If that holds to machine precision then the impulse
//      maths is right — it is much harder to fake than "looks about right".
//   3. It is deterministic. Same approach, same crash, to the last digit.
//
// The bodies are free here — no tyres, no aero, no engine — precisely so that
// assertion 2 is exact. With tyre forces in the loop momentum is not conserved
// (the road is an external force) and the test would prove nothing.
//
//   node tools/contact.mjs
import { makeCar } from '../js/physics.js';
import { resolveCars, corners } from '../js/collide.js';

const DT = 1 / 400;
const deg = r => r * 180 / Math.PI;

// world velocity of a car, from its body-frame components
const wv = c => {
  const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
  return [c.vx * cs - c.vy * sn, c.vx * sn + c.vy * cs];
};
const momentum = (a, b) => {
  const [ax, ay] = wv(a), [bx, by] = wv(b);
  return [a.spec.m * ax + b.spec.m * bx, a.spec.m * ay + b.spec.m * by];
};

// Do the two rectangles overlap at all? Independent of the solver's own test:
// every corner of each car checked against the other's local frame.
function overlapping(a, b) {
  const inside = (p, c) => {
    const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
    const dx = p.x - c.x, dy = p.y - c.y;
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    return Math.abs(lx) < c.spec.bodyL / 2 - 1e-6 && Math.abs(ly) < c.spec.bodyW / 2 - 1e-6;
  };
  for (const p of corners(a)) if (inside(p, b)) return true;
  for (const p of corners(b)) if (inside(p, a)) return true;
  return false;
}

function run(name, setup) {
  const { a, b } = setup();
  const p0 = momentum(a, b);
  let worstPen = 0, peakJ = 0, everOverlapped = false;
  for (let k = 0; k < 400 * 1.5; k++) {
    for (const c of [a, b]) {
      const [vx, vy] = wv(c);
      c.x += vx * DT; c.y += vy * DT;
      // vx/vy are BODY frame. Turning the car without rotating them leaves the
      // world velocity silently changing, which is free momentum and made this
      // harness accuse a correct solver of losing it.
      //
      // Rotated EXACTLY, not to first order. physics.js uses the linearised
      // Coriolis terms (`ax += vy*r`), which is right for a sim taking 400
      // steps a second under real forces — but here the whole point is that any
      // drift left over is the SOLVER's, so the integrator must contribute
      // none. Rotating the body vector by -dh exactly leaves the world vector
      // untouched to machine precision.
      const dh = c.r * DT, cs2 = Math.cos(dh), sn2 = Math.sin(dh);
      const nvx = c.vx * cs2 + c.vy * sn2;
      const nvy = -c.vx * sn2 + c.vy * cs2;
      c.vx = nvx; c.vy = nvy;
      c.hdg += dh;
    }
    const hit = resolveCars(a, b);
    if (hit && Math.abs(hit.j) > Math.abs(peakJ)) peakJ = hit.j;
    if (hit) worstPen = Math.max(worstPen, hit.depth);
    if (overlapping(a, b)) everOverlapped = true;
  }
  const p1 = momentum(a, b);
  const drift = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / Math.max(1, Math.hypot(p0[0], p0[1]));
  return {
    name, peakJ, worstPen, everOverlapped, drift,
    spinA: a.r, spinB: b.r, dmgA: a.damage || 0, dmgB: b.damage || 0,
    sig: [a.x, a.y, a.hdg, a.r, b.x, b.y, b.hdg, b.r].map(v => v.toFixed(9)).join('|'),
  };
}

const two = (cls, ax, ay, ah, av, bx, by, bh, bv) => () => {
  const a = makeCar({ cls }), b = makeCar({ cls });
  a.x = ax; a.y = ay; a.hdg = ah; a.vx = av;
  b.x = bx; b.y = by; b.hdg = bh; b.vx = bv;
  return { a, b };
};

const cases = [
  // nose-to-tail shunt: closing 12 m/s down a straight
  ['rear-end shunt', two('f1', 0, 0, 0, 62, 8.0, 0, 0, 50)],
  // side by side, drifting together
  ['side-by-side squeeze', two('f1', 0, 0, 0, 70, 0.6, 2.05, -0.035, 70)],
  // dive up the inside, clipping the other car's rear quarter
  ['inside dive, rear clip', two('f1', 0, -2.4, 0.16, 58, 5.4, 0.2, 0, 52)],
  // heavier car into a lighter one, to check the mass split
  ['F1 into F4', () => {
    const a = makeCar({ cls: 'f1' }), b = makeCar({ cls: 'f4' });
    a.x = 0; a.y = 0; a.hdg = 0; a.vx = 60;
    b.x = 8.0; b.y = 0; b.hdg = 0; b.vx = 46;
    return { a, b };
  }],
];

console.log('CAR-TO-CAR CONTACT\n');
console.log('case                      impulse    overlap   momentum drift   spin A    spin B   damage');
let noOverlap = true, conserved = true;
for (const [name, setup] of cases) {
  const r = run(name, setup);
  if (r.everOverlapped) noOverlap = false;
  if (r.drift > 1e-6) conserved = false;
  console.log([
    name.padEnd(24),
    ((r.peakJ / 1000).toFixed(1) + ' kNs').padStart(10),
    (r.everOverlapped ? 'YES' : 'none').padStart(8),
    r.drift.toExponential(1).padStart(16),
    (deg(r.spinA).toFixed(0) + '°/s').padStart(9),
    (deg(r.spinB).toFixed(0) + '°/s').padStart(9),
    (r.dmgA.toFixed(2) + '/' + r.dmgB.toFixed(2)).padStart(12),
  ].join(' '));
}
console.log(`\noverlap after resolution: ${noOverlap ? 'NONE — PASS' : 'FAIL'}`);
console.log(`momentum conserved:       ${conserved ? 'PASS (drift below 1e-6 of total)' : 'FAIL'}`);

const A = run('det', cases[2][1]), B = run('det', cases[2][1]);
console.log(`deterministic:            ${A.sig === B.sig ? 'PASS — identical to 9 decimal places' : 'FAIL'}`);
