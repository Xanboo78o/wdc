// simcost.mjs — what does ONE SECOND of race cost to simulate, second by second?
//
// race.mjs gives one average for a whole race ("4.8x real time"). That hides
// the thing a player feels: a stretch where a step suddenly costs 20x more,
// the browser cannot keep up, and the game drops to a slideshow until it is
// reloaded (Adam, 2026-10-03). This prints the cost of every simulated second
// and flags the ones that would not fit in real time, with a slow player in
// the way — which is how a human who has crashed looks to the field.
//
//   node tools/simcost.mjs [track] [class] [grid] [tier] [seconds] [--speed=8] [--prof=from,to]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const flag = k => { const f = process.argv.find(x => x.startsWith(`--${k}=`)); return f ? f.split('=')[1] : null; };
const key = a[0] || 'monza', cls = a[1] || 'f1', grid = +(a[2] || 22), tier = a[3] || 'medium', secs = +(a[4] || 150);
const crawl = +(flag('speed') ?? 8);          // m/s the player holds: 8 = 29 km/h
const { track, lines, spec } = loadTrack(key, cls);
const race = new Race({ track, lines, spec, slots: gridSlots(track, grid), laps: 10, grid, tier, player: true, seed: 7 });
const me = race.entries.find(e => e.isPlayer);
const N = Math.round(1 / FIXED_DT);
let worst = 0, over = 0;
console.log(`${track.full} — ${grid} cars, ${tier}; the player crawls at ${(crawl * 3.6).toFixed(0)} km/h\n   t   ms/sim-second   x real time   state`);
for (let s = 1; s <= secs; s++) {
  const t0 = performance.now();
  for (let i = 0; i < N; i++) race.tick(FIXED_DT, { throttle: me.car.speed < crawl ? 0.5 : 0, brake: 0, delta: 0 });
  const ms = performance.now() - t0;
  worst = Math.max(worst, ms); if (ms > 500) over++;
  if (s % 10 === 0 || ms > 400) console.log(`${String(s).padStart(4)} ${ms.toFixed(0).padStart(10)} ${(1000 / ms).toFixed(1).padStart(12)}x   ${race.state}${race.safety > 0 ? ' SC' : ''}${ms > 1000 ? '   <-- SLOWER THAN REAL TIME' : ms > 400 ? '   <-- no room left for a renderer' : ''}`);
}
console.log(`\nworst second ${worst.toFixed(0)} ms; ${over} of ${secs} seconds cost more than half of real time`);
process.exit(over ? 1 : 0);
