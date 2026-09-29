// fxcheck.mjs — does the crash drama fire when, and only when, it should?
//
//   node tools/fxcheck.mjs [track] [class]
//
// A screenshot can show that sparks RENDER; it cannot show that a real wall
// strike makes them, because a headless page cannot drive a car into a wall.
// So this runs the REAL physics (physics.js + collide.js, as tools/crash.mjs
// does) and feeds each frame's car to the REAL js/fx.js, with the three effect
// pools swapped for counters. It asserts the things that matter:
//
//   - a clean flat-out straight throws NO debris and NO wall sparks
//     (plank sparks over bumps are allowed, and counted)
//   - a hard wall strike throws shards and sparks, and a wing if one is lost
//   - a glancing scrape along a wall keeps making sparks while it touches
//   - the debris solver itself: pieces thrown at 60 m/s come to rest, flat,
//     on the ground, with no NaN, within 15 s
//
// and it must FAIL when the wiring is broken: --break disconnects the crush
// observer, and the wall-strike check must then go red.
import { register } from 'node:module';
import { loadTrack } from './harness.mjs';
import { makeCar, step, FIXED_DT, SURFACE } from '../js/physics.js';
import { resolveBarrier } from '../js/collide.js';

// three.js is vendored for the browser; point the bare specifier at it.
const vendor = new URL('../js/vendor/three.module.min.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true };
    return next(s, c);
  }`));
// smoke.js paints its puff atlas on a canvas at construction
globalThis.document = { createElement: () => ({ getContext: () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }) }) };
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

const THREE = await import('three');
const { Fx } = await import('../js/fx.js');
const { Debris } = await import('../js/debris.js');

const argv = process.argv.slice(2);
const BREAK = argv.includes('--break');
const a = argv.filter(x => !x.startsWith('--'));
const { track, spec } = loadTrack(a[0] || 'monaco', a[1] || 'f1');

function rig() {
  const view = {
    scene: { add() {}, children: [] }, track, world: { trackYAt: () => 0, groundY: () => -0.3 }, bank: null,
    camera: new THREE.PerspectiveCamera(), renderer: { info: { programs: [] } }, wx: null,
  };
  const fx = new Fx(view, null);
  const n = { shards: 0, parts: [], sparks: 0, smoke: 0, snaps: 0, skids: 0 };
  fx.skids.lay = () => { n.skids++; };
  fx.skids.update = () => {};
  fx.debris.shards = (k) => { n.shards += k; };
  fx.debris.part = (k) => { n.parts.push(k); };
  fx.debris.update = () => {};
  fx.sparks.emit = (k) => { n.sparks += k; };
  fx.sparks.update = () => {};
  fx.smoke.emit = () => { n.smoke++; };
  fx.smoke.update = () => {};
  fx.audio.snap = () => { n.snaps++; };
  if (BREAK) fx._watch = function (car, mine, colour, sy, dt) { /* observer unplugged */ };
  return { fx, n };
}

// Drive `car` for `secs`, one frame at a time, the way main.js does.
function run(car, secs, { wall = true, sparksWhileTouching = null } = {}) {
  const { fx, n } = rig();
  let hint = null, touchFrames = 0, touchSparkFrames = 0;
  const F = 1 / 60, sub = Math.round(F / FIXED_DT);
  for (let f = 0; f < secs * 60; f++) {
    for (let k = 0; k < sub; k++) {
      const p = track.project(car.x, car.y, hint); hint = p.i;
      step(car, FIXED_DT, { surface: SURFACE.track });
      if (wall) resolveBarrier(car, track, hint);
    }
    const before = n.sparks;
    fx.update(car, F, 0);
    if (car.wallTouch && car.speed > 4) { touchFrames++; if (n.sparks > before) touchSparkFrames++; }
  }
  return { ...n, touchFrames, touchSparkFrames, car };
}

function fire(kmh, angleDeg, secs = 2.5, startS = 300) {
  const car = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const p = track.point(startS, 0);
  car.x = p.x; car.y = p.y;
  car.hdg = p.hdg + angleDeg * Math.PI / 180;
  car.vx = kmh / 3.6; car.vy = 0; car.r = 0;
  return run(car, secs);
}

let fails = 0;
const check = (ok, label, detail) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`); if (!ok) fails++; };

console.log(`${track.full} — ${spec.full}${BREAK ? '   (--break: crush observer unplugged)' : ''}\n`);

// 1. a clean straight, no walls, flat out
{
  const car = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const p = track.point(300, 0);
  car.x = p.x; car.y = p.y; car.hdg = p.hdg; car.vx = 80; car.throttle = 0;
  const r = run(car, 1.5, { wall: false });
  check(r.shards === 0 && r.parts.length === 0 && r.skids === 0, 'clean straight: no debris, no marks', `shards ${r.shards}, parts ${r.parts.length}, marks ${r.skids}`);
  check(true, 'clean straight: plank sparks over bumps', `${r.sparks} sparks (info)`);
}
// 1b. a locked-wheel stop (ABS off) lays rubber and smokes
{
  const car = makeCar({ cls: spec.key, aids: { tc: 0, abs: 0, sc: 0 } });
  const p = track.point(300, 0);
  car.x = p.x; car.y = p.y; car.hdg = p.hdg; car.vx = 60;
  const orig = step;
  const r = (() => { const { fx, n } = rig(); let hint = null, locked = 0;
    const F = 1 / 60, sub = Math.round(F / FIXED_DT);
    for (let f = 0; f < 60 * 1.2; f++) {
      car.brake = 1; car.throttle = 0; car.delta = 0;
      for (let k = 0; k < sub; k++) { const q = track.project(car.x, car.y, hint); hint = q.i; orig(car, FIXED_DT, { surface: SURFACE.track }); }
      if (car.lock) locked++;
      fx.update(car, F, 0);
    }
    return { ...n, locked }; })();
  check(r.locked === 0 || (r.skids > 10 && r.smoke > 10), 'locked brakes from 216 km/h: rubber marks + smoke',
    `${r.locked} locked frames, ${r.skids} mark segments, ${r.smoke} puffs`);
}
// 2. a hard wall strike
{
  const r = fire(220, 35);
  const c = r.car.crush;
  check(r.shards > 10 && r.sparks > 40, 'hard strike 220 km/h @35: shards + sparks',
    `shards ${r.shards}, sparks ${r.sparks}, snaps ${r.snaps}, crush f${c.front.toFixed(2)} l${c.left.toFixed(2)} r${c.right.toFixed(2)}`);
  const lostF = r.car.lost && r.car.lost.frontWing;
  check(!lostF || (r.parts.includes('fwL') && r.parts.includes('fwR')), 'a lost front wing leaves the car',
    `lost ${JSON.stringify(r.car.lost)}, parts [${r.parts.join(',')}]`);
}
// 3. a glancing scrape
{
  const r = fire(160, 8, 2.5);
  check(r.touchFrames === 0 || r.touchSparkFrames / r.touchFrames > 0.6, 'glancing 160 km/h @8: sparks while touching',
    `${r.touchSparkFrames}/${r.touchFrames} touching frames made sparks`);
}
// 4. the debris solver on its own
{
  const view = { scene: { add() {} }, track: { project: (x, y) => ({ i: 0, s: 0, lat: -y, w: 6, run: 8, hdg: 0 }) },
    world: { trackYAt: () => 0, groundY: () => -0.3 }, bank: null };
  let T = 0; const now = performance.now; performance.now = () => T * 1000;
  const d = new Debris(view, null, null);
  d._kind('plate', { geo: new THREE.BoxGeometry(0.45, 0.03, 1.0), c0: new THREE.Vector3(), half: new THREE.Vector3(0.225, 0.015, 0.5) }, 12, false, {});
  const M = new THREE.Matrix4().makeTranslation(0, 0.3, 0);
  for (let k = 0; k < 6; k++) d.part('plate', M, new THREE.Vector3(60, 0, 0), new THREE.Color(1, 0, 0));
  d.shards(40, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(60, 0, 0), new THREE.Color(1, 0, 0));
  for (let f = 0; f < 60 * 15; f++) { T += 1 / 60; d.update(1 / 60, []); }
  performance.now = now;
  let nan = 0, awake = 0, low = 9, high = -9, tiltMax = 0;
  for (const p of d.all) {
    if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.q.w)) nan++;
    if (!p.asleep) awake++;
    const bottom = p.pos.y - p.half.y;
    low = Math.min(low, bottom); high = Math.max(high, bottom);
    if (p.kind.name === 'plate') {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.q);
      tiltMax = Math.max(tiltMax, Math.acos(Math.min(1, Math.abs(up.y))) * 57.3);
    }
  }
  for (const p of d.all) if (!p.asleep) console.log('      moving:', p.kind.name, p.half.toArray().map(v => v.toFixed(3)).join(' '), 'v', p.vel.length().toFixed(3), 'w', p.w.length().toFixed(2));
  check(nan === 0 && awake <= 4 && low > -0.03 && high < 0.03 && tiltMax < 8, 'debris: 46 pieces at 216 km/h come to rest, flat',
    `nan ${nan}, still moving ${awake}, resting heights ${low.toFixed(3)}..${high.toFixed(3)} m, worst plate tilt ${tiltMax.toFixed(1)} deg`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
