// harness.mjs — shared rig for the headless tools, so drive.mjs and trace.mjs
// can never drift apart and start reporting on two different simulations.
import fs from 'fs';
import { Track } from '../js/track.js';
import { buildLine } from '../js/line.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, peakSlip } from '../js/physics.js';
import { makeAutopilot } from '../js/autopilot.js';

export const fmt = s => s == null ? '--.---'
  : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

export function loadTrack(key, cls) {
  const track = new Track(JSON.parse(
    fs.readFileSync(new URL(`../data/tracks/${key}.json`, import.meta.url), 'utf8')));
  const spec = CARS[cls] || CARS.f4;
  return { track, line: buildLine(track, spec), spec };
}

// Surface under the car, from its lateral offset. Same rule as the game uses.
export function surfaceAt(proj) {
  const al = Math.abs(proj.lat);
  if (al > proj.w + proj.run) return SURFACE.grass;
  if (al > proj.w + 1.2) return SURFACE.runoff;
  if (al > proj.w) return SURFACE.kerb;
  return SURFACE.track;
}

// Drives `laps` laps and returns the numbers. `onTick` gets every substep so a
// tracer can watch without a second copy of the loop existing anywhere.
export function runLaps({ track, line, spec, laps = 3, opt = {}, onTick = null }) {
  const peak = peakSlip(spec);
  const drive = makeAutopilot(track, line, spec, peak, opt);
  const car = makeCar({ cls: spec.key });
  const i0 = track.idx(0);
  const p0 = track.point(0, line.off[i0]);
  car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 20;

  let hint = i0, sPrev = 0, lap = 0, lapT = 0, best = null, t = 0;
  let offT = 0, worstLat = 0, maxSlip = 0, spinT = 0, vmax = 0;
  const times = [];
  const maxT = laps * 400 + 120;

  while (t < maxT && lap <= laps) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const surface = surfaceAt(proj);
    const info = drive(car, proj, FIXED_DT);
    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv) });

    if (surface < SURFACE.track) offT += FIXED_DT;
    worstLat = Math.max(worstLat, Math.abs(proj.lat) - proj.w);
    maxSlip = Math.max(maxSlip, Math.abs(car.slipR));
    vmax = Math.max(vmax, car.speed);
    if (Math.abs(car.slipR) > peak * 3 && car.speed > 12) spinT += FIXED_DT;

    if (onTick) onTick({ t, car, proj, surface, info, lap, lapT });

    if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
      if (lap > 0) { times.push(lapT); if (best == null || lapT < best) best = lapT; }
      lap++; lapT = 0;
    }
    sPrev = proj.s; lapT += FIXED_DT; t += FIXED_DT;
  }
  return { car, times, best, offT, worstLat, maxSlip, spinT, vmax, t, peak };
}
