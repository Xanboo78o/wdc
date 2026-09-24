// quali.js — single-car qualifying.
//
// Adam: "add a quali option, and its just the f1 qualis, everyone goes out 1
// at a time, completes 2 laps and the fastest of the 2 is used for placement".
//
// So a bot's time is not invented: each one goes out ALONE on an empty track
// and actually drives its laps — the same physics, the same autopilot, and the
// same driver it will be in the race (makeDriver + applyProfile, exactly as
// js/race.js builds it). That costs real simulation, so it runs in a Web Worker
// (js/qualiworker.js) on another core while you drive your own run, and the
// timing tower fills in one car at a time as each finishes.
//
// The run, for everyone including you: rolling out of the last 350 m, across
// the line (that is the start of the first timed lap), two timed laps. A lap
// that leaves the track for more than 0.35 s is DELETED — track limits, as in
// hot-lap mode. The better valid lap is the time.
//
// Pure: no DOM, no renderer. Runs in the worker, in Node, anywhere.
import { makeCar, step, FIXED_DT, SURFACE, peakSlip } from './physics.js';
import { makeAutopilot, makeDriver } from './autopilot.js';
import { driverAt, teamOf, applyProfile } from './drivers.js';

export const QUALI_LAPS = 2;
export const RUN_UP = 350;          // m before the line where a run starts

// Same rule the game and the harness use.
function surfaceAt(proj) {
  const al = Math.abs(proj.lat);
  if (al > proj.w + proj.run) return SURFACE.grass;
  if (al > proj.w + 1.2) return SURFACE.runoff;
  if (al > proj.w) return SURFACE.kerb;
  return SURFACE.track;
}

/** The driver a given driverAt() index is, built the way race.js builds it. */
export function qualiDriver(track, idx, tier, seed) {
  const prof = driverAt(idx);
  return { prof, driver: applyProfile(makeDriver(seed * 131 + idx, tier, track.corners.length || 24), prof, teamOf(prof)) };
}

/**
 * One car's qualifying run. Returns { laps: [{t, valid}], best } — best null
 * if both laps were deleted (or it never finished: timed out at 3x a lap).
 */
export function qualiRun({ track, lines, spec, driver }) {
  const peak = peakSlip(spec);
  const drive = makeAutopilot(track, lines, spec, peak, { driver });
  const line = lines.at(driver.T.line, driver.grip);
  const car = makeCar({ cls: spec.key });
  const s0 = track.length - RUN_UP, i0 = track.idx(s0);
  const p0 = track.point(s0, line.off[i0]);
  car.x = p0.x; car.y = p0.y; car.hdg = line.hdg[i0]; car.vx = 0.001;

  let hint = i0, sPrev = s0, started = false, lapT = 0, offT = 0, valid = true, t = 0;
  const laps = [];
  const maxT = (lines.race.lapTime || 120) * (QUALI_LAPS + 1) * 3;
  while (laps.length < QUALI_LAPS && t < maxT) {
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const surface = surfaceAt(proj);
    drive(car, proj, FIXED_DT);
    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv) });
    if (Math.abs(proj.lat) > proj.w + 0.9) { offT += FIXED_DT; if (offT > 0.35) valid = false; }
    else offT = 0;
    if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
      if (started) laps.push({ t: lapT, valid });
      started = true; lapT = 0; valid = true; offT = 0;
    }
    sPrev = proj.s; lapT += FIXED_DT; t += FIXED_DT;
  }
  const ok = laps.filter(l => l.valid).map(l => l.t);
  return { laps, best: ok.length ? Math.min(...ok) : null };
}

/**
 * The grid from the results. `results` is [{ idx, best }] with idx -1 for the
 * player. Fastest first; no valid time goes to the back, in running order.
 * Returns the order race.js takes: grid slot k -> driver index (-1 = you).
 */
export function gridOrder(results) {
  const ranked = results.map((r, n) => ({ ...r, n }))
    .sort((a, b) => (a.best == null) - (b.best == null) || (a.best ?? 0) - (b.best ?? 0) || a.n - b.n);
  return ranked.map(r => r.idx);
}
