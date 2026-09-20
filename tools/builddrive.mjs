// builddrive.mjs — can the hand-built track actually be driven?
//
//   node tools/builddrive.mjs [--grip 0.9] [--car f1]
//
// A plain pursuit driver on the game's own physics, collision and surfaces:
// it aims at the centreline and takes each corner at the grip fraction given.
// It is NOT a fast lap and not a fun-ness measure. It answers the narrow
// question a new piece raises: does a car get through it at all, on the road,
// without hitting a wall — which is exactly what a 720-degree banked loop or a
// blind tunnel entry can quietly break.
//
// AND IT PRINTS THE SAME DRIVER ON A REAL CIRCUIT, every time. This driver is
// crude: it falls off Suzuka's esses at 0.85 grip. Without that control line,
// its failures read as "the new corner is impossible" when they mean "the test
// driver is not good enough" — which is what happened the first time it was
// pointed at the Nürburgring hairpins here.
import { buildPath, trackData } from '../js/build/path.js';
import { Track } from '../js/track.js';
import { CARS, makeCar, step, FIXED_DT, dragFor, corneringSpeed, limitMu, topSpeed, registerAero } from '../js/physics.js';
import { makeAero } from '../js/aero.js';
import { resolveBarrier } from '../js/collide.js';
import { surfaceAt } from './harness.mjs';
import fs from 'fs';

const argv = process.argv.slice(2);
const opt = { grip: null, car: 'f1', ref: 'suzuka' };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--grip') opt.grip = +argv[++i];
  else if (argv[i] === '--car') opt.car = argv[++i];
  else if (argv[i] === '--ref') opt.ref = argv[++i];
  else { console.error(`unknown flag ${argv[i]}`); process.exit(2); }
}
for (const k of ['f1', 'f4', 'gt3']) {
  try { registerAero(k, makeAero(JSON.parse(fs.readFileSync(new URL(`../data/aero/${k}.json`, import.meta.url))))); } catch { /* constants */ }
}
const { TRACK, PIECES } = await import(`../data/build/pieces.js?t=${Date.now()}`);
const path = buildPath(PIECES, { closed: !!TRACK.closed });
const track = new Track(trackData(path, TRACK.name));
track.hdg.set(path.hdg); track.curv.set(path.k);
track.bank = Float32Array.from(path.bank);

function run(cls, frac, T = null) {
  const laps = T ? 1 : 0;                       // a real circuit is a loop; ours is not
  const G = T || { n: path.n, ds: path.ds, x: path.x, y: path.y, hdg: path.hdg, curv: path.k, bank: path.bank, w: path.w };
  const spec = CARS[cls], car = makeCar({ cls }), mu = limitMu(spec), top = topSpeed(spec);
  const v = new Float64Array(G.n);
  for (let i = 0; i < G.n; i++) {
    v[i] = Math.abs(G.curv[i]) > 1e-4
      ? Math.min(top, corneringSpeed(spec, 1 / Math.abs(G.curv[i]), mu * frac, G.bank[i])) : top;
  }
  for (let pass = 0; pass <= laps * 2; pass++) {
    for (let i = G.n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * 20 * G.ds));
    if (laps) v[G.n - 1] = Math.min(v[G.n - 1], Math.sqrt(v[0] ** 2 + 2 * 20 * G.ds));
  }
  Object.assign(car, { x: G.x[2], y: G.y[2], hdg: G.hdg[2], vx: 12 });
  let hint = 2, hits = 0, maxLat = 0, worstOver = 0, sideways = 0, ctl = 0, delta = 0, t = 0, far = 0, worst = null, hitAt = null;
  const TR = T ? T : track;
  const limit = T ? 400 * 200 : 400 * 600;
  for (let n = 0; n < limit; n++) {
    const p = TR.project(car.x, car.y, hint);
    hint = p.i;
    far = Math.max(far, p.i);
    if (!T && p.i >= G.n - 4) break;
    if (++ctl >= 400 / 120) {
      ctl = 0;
      const look = T ? (p.i + Math.round(Math.max(6, car.vx * 0.35) / G.ds)) % G.n
        : Math.min(G.n - 1, p.i + Math.round(Math.max(6, car.vx * 0.35) / G.ds));
      let he = G.hdg[look] - car.hdg;
      while (he > Math.PI) he -= 2 * Math.PI;
      while (he < -Math.PI) he += 2 * Math.PI;
      const want = 1.1 * he - 0.03 * p.lat + 3.6 * G.curv[p.i];
      delta += Math.max(-6 / 120, Math.min(6 / 120, want - delta));
      const tv = v[T ? (p.i + 3) % G.n : Math.min(G.n - 1, p.i + 3)];
      car.throttle = car.vx < tv - 1 ? 1 : 0;
      car.brake = car.vx > tv + 2 ? 0.8 : 0;
    }
    car.delta = Math.max(-0.4, Math.min(0.4, delta));
    const surf = surfaceAt(p);
    step(car, FIXED_DT, { surface: surf, bank: p.bank, bankDir: Math.sign(p.curv), rollMul: dragFor(surf) });
    if (resolveBarrier(car, TR, hint)) { hits++; if (hitAt === null) hitAt = p.i * G.ds; }
    // measured against the width HERE: this track changes width, and judging
    // a 9 m-wide snail by the 7 m start straight called a car on the road off it
    const over = Math.abs(p.lat) / G.w[p.i];
    if (over > worstOver) { worstOver = over; maxLat = Math.abs(p.lat); worst = p.i * G.ds; }
    if (Math.abs(car.slipR) > 0.12) sideways += FIXED_DT;
    t = n * FIXED_DT;
  }
  return { done: T ? true : far >= G.n - 5, t, hits, maxLat, worstOver, sideways, worst, hitAt, far: far * G.ds };
}

let bad = 0;
const fracs = opt.grip ? [opt.grip] : [0.7, 0.85, 0.95];
const ref = new Track(JSON.parse(fs.readFileSync(new URL(`../data/tracks/${opt.ref}.json`, import.meta.url))));
console.log(`\n${TRACK.name} — ${(path.length / 1000).toFixed(2)} km, ${opt.car.toUpperCase()}   (control: ${opt.ref}, same driver)`);
for (const f of fracs) {
  const r = run(opt.car, f);
  const c = run(opt.car, f, ref);
  const off = r.worstOver > 1, cOff = c.worstOver > 1;
  const line = `grip x${f}: ${r.done ? 'got round' : `STOPPED at ${Math.round(r.far)} m`}, ` +
    `max ${r.maxLat.toFixed(1)} m off centre at s=${Math.round(r.worst ?? 0)}${off ? ' (OFF)' : ''}, ` +
    `${r.hits} barrier substeps${r.hitAt === null ? '' : ` from s=${Math.round(r.hitAt)}`}` +
    `  |  ${opt.ref}: ${c.maxLat.toFixed(1)} m${cOff ? ' (OFF)' : ''}, ${c.hits} substeps`;
  // Only the SLOW run is a gate — "can a car get through this at all". The
  // faster runs are information: above 0.7 this driver falls off Suzuka's
  // esses too, and it cannot reverse out of a wall it has wedged itself into,
  // so its failures there are about the driver, not the road.
  const gate = f <= 0.7;
  const ok = r.done && (!off || cOff) && (r.hits === 0 || c.hits > 0);
  console.log((gate ? (ok ? 'ok    ' : 'FAIL  ') : 'info  ') + line);
  if (gate && !ok) bad++;
}
process.exit(bad ? 1 : 0);
