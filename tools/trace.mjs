// trace.mjs — turns "the car went off" into "it arrived at T4 12 m/s too fast
// with the front already 3 degrees past peak".
//
// Prints a coarse timeline, then finds the FIRST real failure (off track, or
// the rear past three times peak slip) and dumps a dense window either side of
// it. Reading one of these beats ten runs of guess-and-retune.
//
//   node tools/trace.mjs [track] [class] [--rack=N] [--yaw=N]
import { loadTrack, runLaps, surfaceAt } from './harness.mjs';
import { peakSlip, SURFACE } from '../js/physics.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = n => {
  const f = process.argv.find(a => a.startsWith(`--${n}=`));
  return f ? +f.split('=')[1] : undefined;
};
const { track, line, spec } = loadTrack(args[0] || 'monza', args[1] || 'f4');
const peak = peakSlip(spec);
const deg = r => (r * 180 / Math.PI);

const rows = [];
runLaps({
  track, line, spec, laps: 1,
  opt: { rackRate: flag('rack'), yawDamp: flag('yaw') },
  onTick: ({ t, car, proj, surface, info }) => {
    rows.push({
      t, s: proj.s, v: car.speed, need: info.need,
      delta: car.delta, sf: car.slipF, sr: car.slipR,
      lat: proj.lat, w: proj.w, surface,
      thr: car.throttle, brk: car.brake,
      corner: track.cornerAt(proj.s)?.name || '',
    });
  },
});

const head = 't     s      v    tgt   steer  slipF  slipR   lat   thr brk  where';
const line1 = r => [
  r.t.toFixed(1).padStart(5),
  r.s.toFixed(0).padStart(5),
  (r.v * 3.6).toFixed(0).padStart(5),
  (r.need * 3.6).toFixed(0).padStart(5),
  deg(r.delta).toFixed(1).padStart(6),
  deg(r.sf).toFixed(1).padStart(6),
  deg(r.sr).toFixed(1).padStart(6),
  r.lat.toFixed(1).padStart(6),
  r.thr.toFixed(1).padStart(4),
  r.brk.toFixed(1).padStart(4),
  ' ' + (r.surface < SURFACE.track ? '[OFF] ' : '') + r.corner,
].join(' ');

console.log(`${track.full} — ${spec.full}   peak slip ${deg(peak).toFixed(1)} deg, lock falls with speed`);
console.log(`\n=== timeline (every 2 s) ===\n${head}`);
for (let i = 0; i < rows.length; i += 800) console.log(line1(rows[i]));

const firstOff = rows.findIndex(r => Math.abs(r.lat) > r.w);
const firstSpin = rows.findIndex(r => Math.abs(r.sr) > peak * 3 && r.v > 12);
const firstSat = rows.findIndex(r => Math.abs(r.sf) > peak * 1.5 && r.v > 20);

function window(idx, label) {
  if (idx < 0) { console.log(`\n=== ${label}: never happened ===`); return; }
  console.log(`\n=== ${label} at t=${rows[idx].t.toFixed(2)}s, s=${rows[idx].s.toFixed(0)}m ${rows[idx].corner ? '(' + rows[idx].corner + ')' : ''} ===`);
  console.log(head);
  for (let i = Math.max(0, idx - 1200); i < Math.min(rows.length, idx + 400); i += 40) {
    console.log(line1(rows[i]) + (i >= idx - 40 && i <= idx + 40 ? '   <<<' : ''));
  }
}
window(firstSat, 'FRONT SATURATED (understeer: past peak slip, still asking for more)');
window(firstSpin, 'REAR GONE (rear past 3x peak slip)');
window(firstOff, 'OFF TRACK');
