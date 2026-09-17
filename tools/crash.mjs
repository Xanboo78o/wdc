// crash.mjs — the gate for contact. Two questions, both of which the old
// point-clamp collision failed:
//
//   1. Can any part of the bodywork end up INSIDE a barrier? (Adam: "currently
//      I am half in half out of a wall.") Every corner is checked every step,
//      not just the car's centre.
//   2. Is it deterministic? The same approach must produce the same crash,
//      down to the last digit, or it is an effect rather than physics.
//
//   node tools/crash.mjs [track] [class]
import { loadTrack } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE } from '../js/physics.js';
import { resolveBarrier, corners } from '../js/collide.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const { track, lines, spec } = loadTrack(a[0] || 'monaco', a[1] || 'f1');
const deg = r => r * 180 / Math.PI;

// Fire the car at the barrier at a given speed and angle to the track, then
// watch for two seconds. Returns everything worth asserting on.
function fire(kmh, angleDeg, startS = 300) {
  const car = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const i = track.idx(startS);
  const p = track.point(startS, 0);
  car.x = p.x; car.y = p.y;
  car.hdg = p.hdg + angleDeg * Math.PI / 180;
  car.vx = kmh / 3.6; car.vy = 0; car.r = 0;

  let hint = i, worstPen = 0, peakJ = 0, touched = false, part = '';
  for (let k = 0; k < 400 * 2.5; k++) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    car.throttle = 0; car.brake = 0; car.delta = 0;
    step(car, FIXED_DT, { surface: SURFACE.track });
    const hit = resolveBarrier(car, track, hint);
    if (hit) {
      touched = true;
      if (Math.abs(hit.j) > Math.abs(peakJ)) { peakJ = hit.j; part = hit.part; }
    }
    // the real assertion: AFTER resolving, is any corner still inside?
    for (const c of corners(car)) {
      const q = track.project(c.x, c.y, hint);
      const pen = Math.abs(q.lat) - (q.w + q.run);
      if (pen > worstPen) worstPen = pen;
    }
  }
  return { touched, worstPen, peakJ, part, damage: car.damage,
           crush: car.crush, spin: car.r, speed: car.speed,
           sig: `${car.x.toFixed(9)}|${car.y.toFixed(9)}|${car.hdg.toFixed(9)}|${car.r.toFixed(9)}` };
}

console.log(`${track.full} — ${spec.full} — barrier type "${track.wall}"`);
console.log(`bodywork ${spec.bodyL} x ${spec.bodyW} m\n`);
console.log('speed  angle   contact   deepest INSIDE   impulse   part    damage   spin out');
let worstAll = 0;
for (const kmh of [50, 120, 220]) {
  for (const ang of [12, 35, 70]) {
    const r = fire(kmh, ang);
    worstAll = Math.max(worstAll, r.worstPen);
    console.log([
      (kmh + '').padStart(5),
      (ang + '°').padStart(6),
      (r.touched ? 'yes' : 'no').padStart(9),
      (r.worstPen.toFixed(4) + ' m').padStart(16),
      (r.peakJ ? (r.peakJ / 1000).toFixed(1) + ' kNs' : '—').padStart(10),
      (r.part || '—').padStart(7),
      (r.damage || 0).toFixed(2).padStart(8),
      (deg(r.spin).toFixed(0) + '°/s').padStart(10),
    ].join(' '));
  }
}

console.log(`\nworst penetration anywhere: ${worstAll.toFixed(5)} m ` +
  (worstAll < 0.02 ? '— PASS (bodywork never inside a barrier)' : '— FAIL'));

const A = fire(160, 40), B = fire(160, 40);
console.log(`determinism: ${A.sig === B.sig ? 'PASS — identical to 9 decimal places' : 'FAIL\n  ' + A.sig + '\n  ' + B.sig}`);
