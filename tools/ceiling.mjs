// ceiling.mjs — how much grip can this controller actually USE on this circuit?
//
// Difficulty tiers are grip fractions, so the top tier has to sit at the
// controller's real ceiling. Guess it too low and HARD is boring; guess it too
// high and HARD overdrives every corner and comes out the SLOWEST tier — which
// has now happened twice, in two different ways, because the number was picked
// by hand instead of measured.
//
// Monza is not Zandvoort. This sweeps grip per circuit and prints the highest
// value that still drives cleanly, so the ladder can be built on numbers.
//
//   node tools/ceiling.mjs [track] [class]
//   node tools/ceiling.mjs all f1
import { loadTrack, runLaps, fmt } from './harness.mjs';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const TRACKS = a[0] === 'all' ? ['monza', 'zandvoort', 'suzuka', 'monaco', 'baku'] : [a[0] || 'monza'];
const cls = a[1] || 'f4';
const GRIPS = [0.72, 0.78, 0.84, 0.88, 0.92, 0.95, 0.98, 1.01];

// "Clean" is deliberately strict: a bot that puts a wheel off or spends real
// time sideways is not driving at that grip level, it is surviving it.
const isClean = r => r.offT < 1.0 && r.spinT < 1.5 && r.worstLat < 1.0;

for (const key of TRACKS) {
  const { track, lines, spec } = loadTrack(key, cls);
  console.log(`\n=== ${track.full} — ${spec.full} — ideal ${fmt(lines.race.lapTime)} ===`);
  console.log('grip   best lap   vs ideal   off    worst  sideways  clean');
  let ceiling = null;
  for (const g of GRIPS) {
    // quiet: no mistakes, no wobble — this measures the CONTROLLER, not a
    // personality. Mistakes are a separate axis and would blur the threshold.
    const r = runLaps({ track, lines, spec, laps: 2, tier: 'hard', grip: g, quiet: true });
    const clean = isClean(r);
    if (clean && r.best) ceiling = { g, best: r.best };
    console.log([
      g.toFixed(2),
      fmt(r.best).padStart(10),
      (r.best ? ((r.best / lines.race.lapTime - 1) * 100).toFixed(1) + '%' : '--').padStart(9),
      (r.offT.toFixed(1) + 's').padStart(6),
      (r.worstLat.toFixed(1) + 'm').padStart(7),
      (r.spinT.toFixed(1) + 's').padStart(9),
      clean ? '  yes' : '  NO',
    ].join(' '));
  }
  console.log(ceiling
    ? `-> clean ceiling ${ceiling.g.toFixed(2)}  (${fmt(ceiling.best)}, ${((ceiling.best / lines.race.lapTime - 1) * 100).toFixed(1)}% off ideal)`
    : '-> NO clean grip level found — the controller cannot drive this circuit');
}
