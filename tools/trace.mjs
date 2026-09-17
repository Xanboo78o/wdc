// trace.mjs — turns "the car went off" into "it arrived at T4 12 m/s too fast
// with the front already 3 degrees past peak and no grip left to brake with".
//
// Prints a coarse timeline, then finds the FIRST real failure and dumps a dense
// window either side of it. Reading one of these beats ten runs of retuning.
//
//   node tools/trace.mjs [track] [class] [tier]
import { loadTrack, runLaps } from './harness.mjs';
import { peakSlip, SURFACE } from '../js/physics.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const { track, lines, spec } = loadTrack(a[0] || 'monza', a[1] || 'f4');
const tier = a[2] || 'hard';
const peak = peakSlip(spec);
const deg = r => (r * 180 / Math.PI);

const rows = [];
runLaps({
  track, lines, spec, laps: 1, tier,
  onTick: ({ t, car, proj, surface, info }) => {
    rows.push({
      t, s: proj.s, v: car.speed, need: info.need,
      delta: car.delta, sf: car.slipF, sr: car.slipR,
      lat: proj.lat, w: proj.w, surface, budget: info.budget,
      thr: car.throttle, brk: car.brake, mistake: info.mistake,
      corner: track.cornerAt(proj.s)?.name || '',
    });
  },
});

const head = 't     s      v    tgt   steer  slipF  slipR   lat   thr brk  bud  where';
const row = r => [
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
  (r.budget ?? 0).toFixed(2).padStart(5),
  ' ' + (r.surface < SURFACE.track ? '[OFF] ' : '') + (r.mistake ? `{${r.mistake}} ` : '') + r.corner,
].join(' ');

console.log(`${track.full} — ${spec.full} — ${tier}   peak slip ${deg(peak).toFixed(1)} deg`);
console.log(`\n=== timeline (every 2 s) ===\n${head}`);
for (let i = 0; i < rows.length; i += 800) console.log(row(rows[i]));

const firstOff = rows.findIndex(r => Math.abs(r.lat) > r.w);
const firstSpin = rows.findIndex(r => Math.abs(r.sr) > peak * 3 && r.v > 12);
const firstSat = rows.findIndex(r => Math.abs(r.sf) > peak * 1.5 && r.v > 20);

function window(idx, label) {
  if (idx < 0) { console.log(`\n=== ${label}: never happened ===`); return; }
  console.log(`\n=== ${label} at t=${rows[idx].t.toFixed(2)}s, s=${rows[idx].s.toFixed(0)}m ${rows[idx].corner ? '(' + rows[idx].corner + ')' : ''} ===`);
  console.log(head);
  for (let i = Math.max(0, idx - 1200); i < Math.min(rows.length, idx + 400); i += 40) {
    console.log(row(rows[i]) + (i >= idx - 40 && i <= idx + 40 ? '   <<<' : ''));
  }
}
window(firstSat, 'FRONT SATURATED (understeer: past peak slip, still asking for more)');
window(firstSpin, 'REAR GONE (rear past 3x peak slip)');
window(firstOff, 'OFF TRACK');
