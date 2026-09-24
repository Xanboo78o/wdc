// qualiworker.js — the bots' qualifying runs, off the main thread.
//
// Started by main.js with { base, track, cls, tier, seed, drivers: [idx...] }.
// Posts { type: 'run', idx } as each car goes out, { type: 'time', idx, laps,
// best } when it comes back, and { type: 'done' } at the end. One car at a
// time, in the order given, which is the order they appear on the tower.
import { Track } from './track.js';
import { buildLines } from './line.js';
import { CARS, registerAero } from './physics.js';
import { makeAero } from './aero.js';
import { qualiDriver, qualiRun } from './quali.js';

self.onmessage = async ev => {
  const { base, track: key, cls, tier, seed, drivers } = ev.data;
  try {
    // The aero map MUST be registered here too, before the first car is made:
    // a worker is a separate world, and a bot on the fallback constants would
    // be qualifying a different car from the one it races.
    try {
      const r = await fetch(`${base}data/aero/${cls}.json`);
      if (r.ok) registerAero(cls, makeAero(await r.json()));
    } catch { /* constants, same as the page would */ }
    const track = new Track(await (await fetch(`${base}data/tracks/${key}.json`)).json());
    const spec = CARS[cls];
    const lines = buildLines(track, spec);
    for (const idx of drivers) {
      self.postMessage({ type: 'run', idx });
      const { driver } = qualiDriver(track, idx, tier, seed);
      const r = qualiRun({ track, lines, spec, driver });
      self.postMessage({ type: 'time', idx, laps: r.laps, best: r.best });
    }
    self.postMessage({ type: 'done' });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
