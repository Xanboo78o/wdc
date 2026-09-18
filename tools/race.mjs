// race.mjs — does a grid of twenty-two actually RACE, or does it pile into
// turn one?
//
// There is no way to answer that by looking at it. A race is twenty-two
// interacting controllers over several minutes; the interesting failures are
// statistical (everyone converges on the same line and trains up) or rare (one
// contact at turn one takes out six cars) and both hide from a screenshot.
//
// Also the performance gate. Twenty-two cars at 400 Hz is the first thing in
// this project that might not fit in a frame, and the honest measure is how
// much faster than real time this runs with no renderer attached.
//
//   node tools/race.mjs [track] [class] [laps] [grid] [tier]
import { loadTrack, fmt } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';

const a = process.argv.slice(2).filter(x => !x.startsWith('--'));
const key = a[0] || 'monza', cls = a[1] || 'f1';
const laps = +(a[2] || 3), grid = +(a[3] || 22), tier = a[4] || 'medium';

const { track, lines, spec } = loadTrack(key, cls);
const slots = gridSlots(track, grid);
const race = new Race({ track, lines, spec, slots, laps, grid, tier, player: false, seed: 7 });

console.log(`${track.full} — ${spec.full} — ${grid} cars, ${laps} laps, ${tier}\n`);

const t0 = Date.now();
let simT = 0;
const maxT = laps * 260 + 90;
while (race.state !== 'over' && simT < maxT) {
  race.tick(FIXED_DT, null);
  simT += FIXED_DT;
}
const wall = (Date.now() - t0) / 1000;

console.log('POS DRIVER          BEST LAP   LAPS  PEN  WARN  HITS  DMG');
for (const e of race.standings) {
  console.log([
    String(e.pos).padStart(3),
    e.name.padEnd(14),
    fmt(e.bestLap).padStart(10),
    String(e.lap).padStart(5),
    String(e.penalty).padStart(4),
    String(e.warnings).padStart(5),
    String(e.contacts).padStart(5),
    (e.car.damage || 0).toFixed(2).padStart(5),
    e.retired ? ' RETIRED' : '',
  ].join(' '));
}

const fin = race.standings.filter(e => !e.retired);
const best = Math.min(...race.entries.map(e => e.bestLap || 1e9));
const ideal = lines.race.lapTime;
const spread = fin.filter(e => e.bestLap).map(e => e.bestLap).sort((x, y) => x - y);
console.log(`\nideal line ${fmt(ideal)}  |  best of the field ${fmt(best)} (${((best / ideal - 1) * 100).toFixed(1)}% off)`);
if (spread.length > 1) {
  console.log(`field spread: ${(spread[spread.length - 1] - spread[0]).toFixed(2)}s between fastest and slowest best lap`);
}
console.log(`finished ${fin.length}/${race.entries.length}   retired ${race.entries.length - fin.length}`);
// The metric that tells a clean RACE apart from a clean procession.
const moved = race.entries.filter(e => e.pos !== e.gridPos).length;
console.log(`passes: ${race.passes || 0}   cars finishing off their grid slot: ${moved}/${race.entries.length}`);

const kinds = {};
for (const ev of race.events) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
console.log('events:', JSON.stringify(kinds));
for (const ev of race.events.filter(e => e.kind === 'penalty' || e.kind === 'crash').slice(0, 6)) {
  console.log(`   ${ev.t.toFixed(1)}s  ${ev.text}`);
}

// The number that decides whether this can run in a browser at all.
console.log(`\nPERFORMANCE: ${simT.toFixed(0)}s of racing in ${wall.toFixed(1)}s wall = ${(simT / wall).toFixed(1)}x real time`);
console.log(`  ${(grid * simT / FIXED_DT / 1e6).toFixed(1)}M car-substeps, ${(grid * simT / FIXED_DT / wall / 1e6).toFixed(2)}M/s`);
console.log(`  a browser needs 1.0x with a renderer on top; under ~4x here is a warning`);
