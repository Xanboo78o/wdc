// drive.mjs — the gate. A reference driver drives the REAL physics module
// around a REAL circuit, in plain Node, with no browser and no graphics.
//
// Nobody can eyeball a tyre model. If a change to physics.js makes the car
// slower, or undrivable, or quietly unable to reach the apex, this prints it
// as a number before anyone opens a browser.
//
//   node tools/drive.mjs [track] [laps] [class] [--rack=N] [--yaw=N]
import { loadTrack, runLaps, fmt } from './harness.mjs';
import { CARS, topSpeed, peakSlip } from '../js/physics.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = n => {
  const f = process.argv.find(a => a.startsWith(`--${n}=`));
  return f ? +f.split('=')[1] : undefined;
};
const key = args[0] || 'monza';
const laps = +(args[1] || 3);
const cls = args[2] || 'f4';

const { track, line, spec } = loadTrack(key, cls);
const peak = peakSlip(spec);
const r = runLaps({ track, line, spec, laps, opt: { rackRate: flag('rack'), yawDamp: flag('yaw') } });

console.log(`${track.full}  ${spec.full}  ${(track.length / 1000).toFixed(3)} km`);
console.log(`ideal line   ${fmt(line.lapTime)}`);
console.log(`best driven  ${fmt(r.best)}   ${r.best ? `(+${(r.best - line.lapTime).toFixed(2)}s, ${((r.best / line.lapTime - 1) * 100).toFixed(1)}% off ideal)` : ''}`);
console.log(`laps         ${r.times.map(fmt).join('  ')}`);
console.log(`top speed    ${(r.vmax * 3.6).toFixed(1)} km/h  (drag limit ${(topSpeed(spec) * 3.6).toFixed(1)})`);
console.log(`peak slip    ${(peak * 180 / Math.PI).toFixed(1)} deg   max rear slip seen ${(r.maxSlip * 180 / Math.PI).toFixed(1)} deg`);
console.log(`off track    ${r.offT.toFixed(1)}s   worst excursion ${r.worstLat.toFixed(2)} m past the white line`);
console.log(`sideways     ${r.spinT.toFixed(1)}s above ${(peak * 3 * 180 / Math.PI).toFixed(0)} deg of rear slip`);
