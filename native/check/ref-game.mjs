// ref-game.mjs — the reference for `xbr-drive --game`: the GAME's loop (solved
// aero map, surface drag, barriers and their damage) run on the JS modules,
// printed in the same table. native/check.sh diffs the two.
//
//   node native/check/ref-game.mjs [track] [seconds] [class] [tier] [every]
//
// `every` (seconds, default 5) is how often a row is printed. Pass it and the
// positions print to a nanometre, which is how to tell a port bug (the tables
// part company abruptly) from floating-point drift (they part by 1e-12 and
// the gap grows).
import fs from 'fs';
import { Track } from '../../js/track.js';
import { buildLines } from '../../js/line.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, peakSlip, dragFor, registerAero } from '../../js/physics.js';
import { makeAero } from '../../js/aero.js';
import { makeAutopilot, makeDriver } from '../../js/autopilot.js';
import { resolveBarrier } from '../../js/collide.js';

const a = process.argv.slice(2);
const key = a[0] || 'monza', seconds = +(a[1] || 120), cls = a[2] || 'f4', tier = a[3] || 'hard';
const fine = a[4] != null, everyS = +(a[4] || 5), dp = fine ? 9 : 2;
const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const track = new Track(read(`../../data/tracks/${key}.json`));
const spec = CARS[cls];
registerAero(cls, makeAero(read(`../../data/aero/${cls}.json`)));
const lines = buildLines(track, spec);
const peak = peakSlip(spec);
const driver = makeDriver(1, tier, track.corners.length || 24);
const drive = makeAutopilot(track, lines, spec, peak, { driver });
const line = lines.race;
const car = makeCar({ cls });
const i0 = track.idx(0), p0 = track.point(0, line.off[i0]);
car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0];
car.tyre.Tf = car.tyre.Tr = 70;

const fmt = s => s == null ? '--.---' : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
const surfaceAt = p => {
  const al = Math.abs(p.lat);
  return al > p.w + p.run ? SURFACE.grass : al > p.w + 1.2 ? SURFACE.runoff : al > p.w ? SURFACE.kerb : SURFACE.track;
};
console.log(`${track.key}  ${cls}  ${tier}  game loop`);
console.log('     T        S    KM/H   DAMAGE  WINGS  HITS         X         Y');
let hint = i0, hits = 0, lap = 0, sPrev = 0, lapT = 0, best = null;
const steps = Math.round(seconds / FIXED_DT), every = Math.round(everyS / FIXED_DT);
for (let k = 1; k <= steps; k++) {
  const proj = track.project(car.x, car.y, hint);
  hint = proj.i;
  drive(car, proj, FIXED_DT);
  const surface = surfaceAt(proj);
  step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv), rollMul: dragFor(surface) });
  const hit = resolveBarrier(car, track, hint);
  if (hit && hit.closing > 3.5) hits++;
  if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
    if (lap > 0 && (best == null || lapT < best)) best = lapT;
    lap++; lapT = 0;
  }
  sPrev = proj.s; lapT += FIXED_DT;
  if (k % every === 0 || k === steps) {
    const L = car.lost;
    console.log([
      (k * FIXED_DT).toFixed(1).padStart(6), proj.s.toFixed(1).padStart(8), (car.speed * 3.6).toFixed(1).padStart(7),
      car.damage.toFixed(3).padStart(8), ' ' + (L && L.frontWing ? 'F' : '-') + (L && L.rearWing ? 'R' : '-'),
      String(hits).padStart(6), car.x.toFixed(dp).padStart(9), car.y.toFixed(dp).padStart(9),
    ].join(' '));
  }
}
const P = car.parts;
console.log(`best lap ${fmt(best)}   aero parts cl ${(P ? P.cl : 1).toFixed(4)} bal ${(P ? P.bal : 1).toFixed(4)} cd ${(P ? P.cd : 1).toFixed(4)}`);
