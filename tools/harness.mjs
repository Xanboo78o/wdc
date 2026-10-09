// harness.mjs — shared rig for the headless tools, so drive.mjs and trace.mjs
// can never drift apart and start reporting on two different simulations.
import fs from 'fs';
import { Track } from '../js/track.js';
import { buildLines } from '../js/line.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, peakSlip } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

export const fmt = s => s == null ? '--.---'
  : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

export function loadTrack(key, cls) {
  const track = new Track(JSON.parse(
    fs.readFileSync(new URL(`../data/tracks/${key}.json`, import.meta.url), 'utf8')));
  const spec = CARS[cls] || CARS.f4;
  return { track, lines: buildLines(track, spec), spec };
}

// Surface under the car, from its lateral offset. Same rule the game uses.
// WDC_SLOPE=1 drives on the surveyed gradient (data/elev/<key>.json), the way
// the game does; unset, every harness stays flat and byte-identical.
const _elev = new Map();
export function slopeFor(track, proj, car) {
  if (!process.env.WDC_SLOPE) return 0;
  const key = track.key;
  if (!_elev.has(key)) {
    let e = null;
    try { e = JSON.parse(fs.readFileSync(new URL(`../data/elev/${key}.json`, import.meta.url), 'utf8')); } catch { /* none */ }
    _elev.set(key, e);
  }
  const e = _elev.get(key);
  if (!e || !e.s) return 0;
  const n = e.s.length, ds = e.ds || track.ds;
  const at = s => { const f = ((s / ds) % n + n) % n, i = Math.floor(f), k = f - i; return e.s[i] * (1 - k) + e.s[(i + 1) % n] * k; };
  return (at(proj.s + 4) - at(proj.s - 4)) / 8 * Math.cos(car.hdg - track.hdg[proj.i]);
}

export function surfaceAt(proj) {
  const al = Math.abs(proj.lat);
  if (al > proj.w + proj.run) return SURFACE.grass;
  if (al > proj.w + 1.2) return SURFACE.runoff;
  if (al > proj.w) return SURFACE.kerb;
  return SURFACE.track;
}

// Drives `laps` laps and returns the numbers. `onTick` gets every substep so a
// tracer can watch without a second copy of the loop existing anywhere.
export function runLaps({ track, lines, spec, laps = 3, tier = 'hard', seed = 1, grip = null, quiet = false, opt = {}, onTick = null }) {
  const peak = peakSlip(spec);
  const driver = makeDriver(seed, tier, track.corners.length || 24);
  // Overrides for measurement runs. NOTE: driver.T is a shared reference into
  // TIERS — never write through it, or one sweep silently reconfigures every
  // other driver on the grid.
  if (grip != null) driver.gripOverride = grip;
  if (quiet) { driver.nextMistake = Infinity; driver.consistency = 1; }
  const drive = makeAutopilot(track, lines, spec, peak, { ...opt, driver });
  const line = lines.at(driver.T.line, driver.grip);
  const car = makeCar({ cls: spec.key });
  const i0 = track.idx(0);
  const p0 = track.point(0, line.off[i0]);
  car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 20;

  let hint = i0, sPrev = 0, lap = 0, lapT = 0, best = null, t = 0;
  let offT = 0, worstLat = 0, maxSlip = 0, spinT = 0, vmax = 0, mistakes = 0;
  let wasMistake = false;
  const times = [];
  // The Nordschleife is 20.8 km: an out-lap and one timed lap is 15 minutes,
  // and the cap stopped the clock at 8:40 with no lap set. Laps over 10 km get
  // time in proportion (25 m/s, out-lap included); every other circuit keeps
  // exactly the cap it had.
  const maxT = track.length > 10000 ? (laps + 1) * track.length / 25 : laps * 400 + 120;

  while (t < maxT && lap <= laps) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const surface = surfaceAt(proj);
    const info = drive(car, proj, FIXED_DT);
    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv),
                          slope: slopeFor(track, proj, car) });

    if (surface < SURFACE.track) offT += FIXED_DT;
    worstLat = Math.max(worstLat, Math.abs(proj.lat) - proj.w);
    maxSlip = Math.max(maxSlip, Math.abs(car.slipR));
    vmax = Math.max(vmax, car.speed);
    if (Math.abs(car.slipR) > peak * 3 && car.speed > 12) spinT += FIXED_DT;
    if (info.mistake && !wasMistake) mistakes++;
    wasMistake = !!info.mistake;

    if (onTick) onTick({ t, car, proj, surface, info, lap, lapT });

    if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
      if (lap > 0) { times.push(lapT); if (best == null || lapT < best) best = lapT; }
      lap++; lapT = 0;
    }
    sPrev = proj.s; lapT += FIXED_DT; t += FIXED_DT;
  }
  return { car, driver, line, times, best, offT, worstLat, maxSlip, spinT, vmax, t, peak, mistakes };
}
