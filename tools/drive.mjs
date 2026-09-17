// drive.mjs — the gate. A real driver drives the REAL physics around a REAL
// circuit, in plain Node, with no browser and no graphics.
//
// Nobody can eyeball a tyre model. If a change makes the car slower, or
// undrivable, or quietly unable to reach the apex, this prints it as a number
// before anyone opens a browser.
//
//   node tools/drive.mjs [track] [laps] [class] [tier]
//   node tools/drive.mjs monza 2 f1 all     # sweep every difficulty
import { loadTrack, runLaps, fmt } from './harness.mjs';
import { topSpeed, peakSlip } from '../js/physics.js';
import { TIERS } from '../js/autopilot.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const key = a[0] || 'monza';
const laps = +(a[1] || 3);
const cls = a[2] || 'f4';
const tierArg = a[3] || 'hard';

const { track, lines, spec } = loadTrack(key, cls);
const peak = peakSlip(spec);
const tiers = tierArg === 'all' ? Object.keys(TIERS) : [tierArg];

console.log(`${track.full}  ${spec.full}  ${(track.length / 1000).toFixed(3)} km`);
console.log(`ideal race line ${fmt(lines.race.lapTime)}   centreline ${fmt(lines.centre.lapTime)}`);
console.log(`peak slip ${(peak * 180 / Math.PI).toFixed(1)} deg   drag-limited top speed ${(topSpeed(spec) * 3.6).toFixed(0)} km/h\n`);
console.log('TIER          BEST LAP    vs IDEAL   OFF    WORST  SIDEWAYS  ERRORS  TOP');

for (const tier of tiers) {
  const r = runLaps({ track, lines, spec, laps, tier });
  const pct = r.best ? ((r.best / lines.race.lapTime - 1) * 100).toFixed(1) + '%' : '--';
  console.log([
    TIERS[tier].name.padEnd(13),
    fmt(r.best).padStart(9),
    pct.padStart(9),
    (r.offT.toFixed(1) + 's').padStart(7),
    (r.worstLat.toFixed(1) + 'm').padStart(7),
    (r.spinT.toFixed(1) + 's').padStart(9),
    String(r.mistakes).padStart(7),
    ((r.vmax * 3.6).toFixed(0)).padStart(5),
  ].join(' '));
}
