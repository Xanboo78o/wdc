// propcheck.mjs — the gate for js/props.js, the loose-object physics.
//
//   node tools/propcheck.mjs [--break]
//
// js/props.js imports nothing renderer-shaped, which is the whole reason this
// file can exist: it hits a tyre wall ten thousand times without opening a
// window. A screenshot proves a cone RENDERS; only this proves a cone gets hit.
//
// --break runs the same suite against a car that is treated as a POINT and
// stepped at frame rate — the naive version of this system, and the exact bug
// js/collide.js had to be rewritten to fix ("I am half in half out of a
// wall"). It MUST fail, and a gate nobody has watched fail is not a gate.
//
// The first --break only dropped the rate to 60 Hz and everything still
// passed, which was worth knowing: the car is 5.63 m long, so even a 1.5 m
// step cannot jump a cone. The rectangle is doing the work. Shrink it and the
// misses appear at once.
import { PropWorld, KIND } from '../js/props.js';

const argv = process.argv.slice(2);
const BREAK = argv.includes('--break');
for (const a of argv) if (a !== '--break') { console.error(`unknown flag ${a}`); process.exit(2); }

const DT = 1 / 400;                     // the sim's own substep, as app.js runs it
const FRAME = 1 / 60;                   // what --break pretends is good enough
let failed = 0, checks = 0;
const ok = (pass, label, detail = '') => {
  checks++;
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
};

// A car exactly as js/physics.js carries one: body-frame velocities, world
// heading, and the spec fields the contact solver reads.
function car(speed, { x = 0, y = 0, hdg = 0 } = {}) {
  return {
    x, y, hdg, vx: speed, vy: 0, r: 0,
    spec: BREAK
      ? { m: 798, Izz: 950, bodyL: 0.2, bodyW: 0.2 }   // the car as a point
      : { m: 798, Izz: 950, bodyL: 5.63, bodyW: 2.0 }, // real F1 bodywork
  };
}

// Drive a car in a straight line through a world, one substep at a time.
//
// `seconds` is a distance in disguise for most of these checks, and the first
// version of this helper used a fixed 2.2 s — which at 40 km/h is 24 m and put
// the car nowhere near a cone 60 m away. The gate reported "missed at 40 and
// 80 km/h" and it was the TEST that was wrong, not the sim. Drive far enough
// for the speed instead. (Same family as every other instrument-has-properties
// bug in this repo: the rig's limits read as the subject's.)
function drive(world, c, seconds, dt = DT) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
    c.x += (c.vx * cs - c.vy * sn) * dt;
    c.y += (c.vx * sn + c.vy * cs) * dt;
    c.hdg += c.r * dt;
    events.push(...world.step(dt, [c]).map(e => ({ ...e, t })));
  }
  return events;
}

const kmh = v => v * 3.6;

// ---------------------------------------------------------------------------
console.log('\nCONTACT');
{
  // A cone, hit square at 150 km/h. The cone must leave fast; the CAR must
  // barely notice, because 3.2 kg against 798 kg is 0.4% of the mass.
  const w = new PropWorld({ seed: 1 });
  const p = w.spawn('cone', 30, 0);
  const c = car(150 / 3.6);
  const ev = drive(w, c, 1.2, BREAK ? FRAME : DT);
  const hit = ev.find(e => e.kind === 'cone');
  ok(!!hit, 'a cone in the road is hit at 150 km/h',
    hit ? `impulse ${hit.impulse.toFixed(0)} N·s at t=${hit.t.toFixed(3)}s` : 'NEVER TOUCHED IT');
  const sent = Math.hypot(p.vx, p.vy, p.vz);
  ok(sent > 6, 'the cone is sent somewhere', `${kmh(sent).toFixed(0)} km/h`);
  // 3.2 kg against 798 kg: j = (1+e) x 3.2 x 41.7 = 189 N·s, so the car gives
  // up 189/798 = 0.24 m/s. That is the right answer, not a bug — a cone does
  // cost you a tenth of a length.
  const lost = 150 - kmh(c.vx);
  ok(lost < 1.5 && lost >= 0, 'the car hardly feels it', `lost ${lost.toFixed(3)} km/h`);
}
{
  // A tyre stack is 42 kg and bolted into a wall of them. It has to actually
  // hurt: this is the object that decides whether running wide is expensive.
  const w = new PropWorld({ seed: 2 });
  w.spawn('stack', 30, 0);
  const c = car(150 / 3.6);
  drive(w, c, 1.5, BREAK ? FRAME : DT);
  const lost = 150 - kmh(c.vx);
  ok(lost > 1.2, 'a tyre stack takes real speed off the car', `lost ${lost.toFixed(2)} km/h`);
}
{
  // Off-centre contact must YAW the car. A hit that only slows you down is a
  // wall, not an object.
  const w = new PropWorld({ seed: 3 });
  w.spawn('barrier', 30, 0.85);
  const c = car(120 / 3.6);
  drive(w, c, 1.4);
  ok(Math.abs(c.r) > 0.01, 'a clipped barrier yaws the car', `${c.r.toFixed(3)} rad/s`);
  // Toward the impact, not away from it: the contact is on the NOSE, left of
  // centre, so the force is backwards at the left front and the car pivots
  // around it — the nose swings left. (I asserted the opposite first, which is
  // what a side-swipe does, not a head-on clip.)
  ok(c.r > 0, 'and pivots around the corner that hit it', `hit left of the nose, r=${c.r.toFixed(3)}`);
  ok(Math.abs(c.r) < 1.6, 'without being spun like a top', `${c.r.toFixed(2)} rad/s`);
}

console.log('\nNOTHING IS MISSED');
{
  // The tunnelling sweep. At every speed a car can do, the object in front of
  // it has to be found. This is the test --break exists to fail.
  const misses = [];
  for (const kph of [40, 80, 120, 160, 200, 240, 280, 330]) {
    const w = new PropWorld({ seed: 10 });
    w.spawn('cone', 60, 0);
    const c = car(kph / 3.6);
    // 70 m of road at whatever speed this is, so the cone at 60 m is always
    // reached.
    const ev = drive(w, c, 70 / (kph / 3.6), BREAK ? FRAME : DT);
    if (!ev.some(e => e.kind === 'cone')) misses.push(kph);
  }
  ok(misses.length === 0, 'a cone is hit at every speed from 40 to 330 km/h',
    misses.length ? `MISSED at ${misses.join(', ')} km/h` : '8 speeds');
}
{
  // ...and a prop the car has already passed must NOT be hit.
  const w = new PropWorld({ seed: 11 });
  w.spawn('cone', -20, 0);
  const c = car(200 / 3.6);
  const ev = drive(w, c, 1.0);
  ok(ev.length === 0, 'a cone behind the car is left alone');
}

console.log('\nDESTRUCTION');
{
  const w = new PropWorld({ seed: 20 });
  w.spawn('stack', 30, 0);
  const c = car(200 / 3.6);
  const ev = drive(w, c, 2.5);
  const broke = ev.find(e => e.broke);
  ok(!!broke, 'a tyre stack hit at 200 km/h comes apart',
    broke ? `at ${broke.impulse.toFixed(0)} N·s (breaks past ${KIND.stack.breakAt})` : 'STAYED WHOLE');
  const s = w.stats();
  ok(s.debris === 5, 'and leaves five tyres', `${s.debris} pieces`);
}
{
  // The same stack brushed at walking pace must survive. A gate that only
  // proves things break proves nothing about when they should not.
  const w = new PropWorld({ seed: 21 });
  w.spawn('stack', 12, 0);
  const c = car(18 / 3.6);
  const ev = drive(w, c, 3.0);
  ok(!ev.some(e => e.broke), 'a stack nudged at 18 km/h stays whole');
}

console.log('\nIT SETTLES');
{
  const w = new PropWorld({ seed: 30 });
  for (let i = 0; i < 12; i++) w.spawn('cone', 30 + i * 1.6, ((i % 3) - 1) * 0.8);
  const c = car(220 / 3.6);
  drive(w, c, 2.0);
  const hitAny = w.props.some(p => Math.hypot(p.vx, p.vy) > 1);
  ok(hitAny, 'a line of twelve cones is scattered');
  // Coulomb friction is a constant deceleration, so everything must actually
  // STOP. A drag term only ever halves the speed again, and a cone that
  // creeps across the track for ever is a cone you can watch creeping.
  for (let t = 0; t < 30; t += DT) w.step(DT, []);
  ok(w.stats().awake === 0, 'and all of it is asleep 30 s later', `${w.stats().awake} still moving`);
  const off = w.props.filter(p => p.alive && Math.abs(p.z) > 0.001);
  ok(off.length === 0, 'and all of it is on the ground', `${off.length} floating`);
}

console.log('\nIT IS THE SAME EVERY TIME');
{
  // A chaotic pile-up is exactly the thing that quietly stops being
  // reproducible, and a sim you cannot re-run is a sim you cannot debug.
  const run = () => {
    const w = new PropWorld({ seed: 40 });
    for (let i = 0; i < 6; i++) w.spawn('stack', 25 + i * 1.3, -0.6 + i * 0.25);
    const c = car(260 / 3.6);
    drive(w, c, 3.0);
    for (let t = 0; t < 6; t += DT) w.step(DT, []);
    return w.props.filter(p => p.alive).map(p => `${p.x.toFixed(9)},${p.y.toFixed(9)},${p.z.toFixed(9)}`).join('|');
  };
  const a = run(), b = run();
  ok(a === b, 'a six-stack pile-up replays identically', `${a.split('|').length} bodies`);
}

console.log('\nWALLS');
{
  // A wall across the road at 40 m. The car must be stopped by it at every
  // speed — a barrier a car can drive through at 300 km/h is scenery.
  const through = [];
  for (const kph of [60, 120, 200, 260, 320]) {
    const w = new PropWorld({ seed: 60 });
    w.addWall(40, -12, 40, 12);
    const c = car(kph / 3.6);
    drive(w, c, 60 / (kph / 3.6));
    if (c.x > 41) through.push(`${kph} (x=${c.x.toFixed(1)})`);
  }
  ok(through.length === 0, 'a wall stops the car at every speed from 60 to 320 km/h',
    through.length ? `THROUGH IT at ${through.join(', ')}` : '5 speeds');
}
{
  // Clipped on one corner, it should spin the car and scrub speed, not stop it.
  const w = new PropWorld({ seed: 61 });
  // 1.2 m out, against a car half a metre wider than that: the corner runs
  // 0.2 m inside the wall's 0.35 m reach. At 1.4 the corner clears it by 5 cm
  // and the test was asserting contact that should not happen.
  w.addWall(40, 1.2, 120, 1.2);
  const c = car(180 / 3.6, { y: 0 });
  drive(w, c, 1.6);
  ok(Math.abs(c.r) > 0.02, 'a wall clipped on one side yaws the car', `${c.r.toFixed(3)} rad/s`);
  ok(kmh(c.vx) > 90, 'and does not stop it dead', `${kmh(c.vx).toFixed(0)} km/h`);
  ok(c.y < 1.4, 'and the car stays on its own side of it', `y=${c.y.toFixed(2)}`);
}
{
  // Nothing near it: a wall must cost nothing to have.
  const w = new PropWorld({ seed: 62 });
  for (let i = 0; i < 400; i++) w.addWall(i * 8, 20, i * 8 + 8, 20);
  const c = car(300 / 3.6);
  const t0 = Date.now();
  drive(w, c, 4);
  ok(Date.now() - t0 < 2500, '400 walls cost nothing to drive past', `${Date.now() - t0} ms for 4 s of driving`);
}

console.log('\nTHE CAR IS NEVER TELEPORTED');
{
  // Every impulse into the car is applied through one function. If it ever
  // becomes a position fix instead, a cone will punt a car sideways — which is
  // what the FIRST version of every collision system in this repo did.
  const w = new PropWorld({ seed: 50 });
  for (let i = 0; i < 30; i++) w.spawn('cone', 20 + i * 2, ((i * 7) % 5 - 2) * 0.7);
  const c = car(300 / 3.6);
  let worst = 0;
  for (let t = 0; t < 3; t += DT) {
    const before = c.vx;
    const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
    c.x += (c.vx * cs - c.vy * sn) * DT;
    c.y += (c.vx * sn + c.vy * cs) * DT;
    c.hdg += c.r * DT;
    w.step(DT, [c]);
    worst = Math.max(worst, Math.abs(c.vx - before));
  }
  // 30 cones at 300 km/h: each one is allowed to take a few cm/s.
  ok(worst < 0.5, 'no single substep changes the car by more than 0.5 m/s',
    `worst ${worst.toFixed(4)} m/s`);
  ok(Math.abs(c.vy) < 2.5, 'and the car is not punted sideways', `vy ${c.vy.toFixed(3)} m/s`);
}

// ---------------------------------------------------------------------------
console.log(`\n${failed ? `${failed} of ${checks} FAILED` : `all ${checks} good`}${BREAK ? '   (--break: failing is the correct outcome)' : ''}`);
process.exit(failed ? 1 : 0);
