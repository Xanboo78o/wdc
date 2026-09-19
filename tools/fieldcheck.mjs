// fieldcheck.mjs — does a grid of twenty-two RACE, or does it destroy itself?
//
// tools/race.mjs runs one race and prints it. That was the right tool for
// "does this work at all" and it is the wrong tool for "is this change better",
// because a race is chaotic: one contact at turn one changes every subsequent
// position, so two runs that differ by a single tuning constant are not two
// measurements of that constant. They are two samples of a coin.
//
// This is what proved that. Four single races said an opening-lap caution made
// retirements WORSE at three circuits out of four — which was neither true nor
// false, it was noise, and a tuning session was about to be built on it.
//
//   node tools/fieldcheck.mjs                    # 4 circuits, 4 seeds each
//   node tools/fieldcheck.mjs --seeds 8          # more samples, tighter numbers
//   node tools/fieldcheck.mjs --tracks monza     # one circuit
//
// The number that matters is RETIRED, and the second number that matters is
// PASSES — because a grid can always be made to stop crashing by making it stop
// racing, and the two have to move in opposite directions before a change is
// worth anything.
import { loadTrack, fmt } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

// REFUSE A FLAG THIS DOES NOT UNDERSTAND.
//
// `--track monza` instead of `--tracks monza` would otherwise run all four
// circuits and print a confident table, and nothing on screen would say the
// argument had been ignored. That is the worst shape a bug can take in a
// measurement tool: a silently dropped input produces a wrong number with a
// believable explanation already attached to it. It cost this repo an
// afternoon on 2026-09-18 in `tools/shot.mjs`, which took only the FIRST
// `--q` and quietly discarded the rest — every screenshot came back looking
// normal and photographing the wrong thing.
const KNOWN = new Set(['tracks', 'seeds', 'laps', 'grid', 'tier', 'car', 'pits']);
for (const a of args) {
  if (!a.startsWith('--')) continue;
  const name = a.slice(2);
  if (!KNOWN.has(name)) {
    console.error(`fieldcheck: unknown flag ${a}\n  known: ${[...KNOWN].map(k => '--' + k).join(' ')}`);
    process.exit(2);
  }
  if (args.indexOf(a) !== args.lastIndexOf(a)) {
    console.error(`fieldcheck: ${a} given more than once — only the first would be used`);
    process.exit(2);
  }
}

const TRACKS = String(flag('tracks', 'monza,suzuka,baku,zandvoort')).split(',');
const SEEDS = +flag('seeds', 4);
const LAPS = +flag('laps', 2);
const GRID = +flag('grid', 22);
const TIER = flag('tier', 'medium');
const CLS = flag('car', 'f1');
const PITS = flag('pits', '1') !== '0';

function one(track, lines, spec, seed) {
  const race = new Race({
    track, lines, spec, slots: gridSlots(track, GRID), laps: LAPS, grid: GRID,
    tier: TIER, seed, player: false, pits: PITS,
  });
  const maxT = LAPS * 260 + 90;
  let t = 0;
  while (race.state !== 'over' && t < maxT) { race.tick(FIXED_DT, null); t += FIXED_DT; }

  const retired = race.entries.filter(e => e.retired).length;
  // WHEN they go out is the whole diagnosis. Everything happening in the first
  // twenty seconds is turn one on lap one, which is a different problem from a
  // field that wears itself out over a race.
  let lap1 = 0;
  for (const ev of race.events) {
    if (ev.kind === 'crash' && /RETIRES|UPSIDE DOWN/.test(ev.text) && ev.t < 30) lap1++;
  }
  const contacts = race.entries.reduce((a, e) => a + e.contacts, 0);
  // The diagnosis DESIGN.md predicted, measured rather than assumed: a car that
  // has lost its front wing has lost 56% of its front downforce and does not
  // know it. If that is really what is emptying the grid, then retirements and
  // lost wings move together and most of the retired cars are missing one.
  const wings = race.entries.filter(e => e.car.lost && e.car.lost.frontWing).length;
  const stops = race.entries.reduce((a, e) => a + (e.pitStops || 0), 0);
  const retiredNoWing = race.entries.filter(e => e.retired && e.car.lost && e.car.lost.frontWing).length;
  const best = Math.min(...race.entries.map(e => e.bestLap || 1e9));
  return { retired, lap1, contacts, wings, retiredNoWing, stops,
           passes: race.passes || 0, best, ideal: lines.race.lapTime };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const t0 = Date.now();
const rows = [];

for (const key of TRACKS) {
  const { track, lines, spec } = loadTrack(key, CLS);
  const runs = [];
  for (let s = 0; s < SEEDS; s++) runs.push(one(track, lines, spec, 7 + s * 101));
  rows.push({
    key,
    retired: mean(runs.map(r => r.retired)),
    worst: Math.max(...runs.map(r => r.retired)),
    lap1: mean(runs.map(r => r.lap1)),
    wings: mean(runs.map(r => r.wings)),
    retiredNoWing: mean(runs.map(r => r.retiredNoWing)),
    stops: mean(runs.map(r => r.stops)),
    contacts: mean(runs.map(r => r.contacts)),
    passes: mean(runs.map(r => r.passes)),
    off: mean(runs.map(r => (r.best / r.ideal - 1) * 100)),
  });
}

console.log(`${GRID} cars · ${LAPS} laps · ${TIER} · ${CLS} · ${SEEDS} seeds each · pit stops ${PITS ? 'ON' : 'OFF'}\n`);
console.log('CIRCUIT      RETIRED  WORST  IN FIRST 30s  NO FRONT WING  ...OF THEM RETIRED  PIT STOPS  CONTACTS  PASSES  BEST vs IDEAL');
for (const r of rows) {
  console.log([
    r.key.padEnd(12),
    r.retired.toFixed(2).padStart(6),
    String(r.worst).padStart(6),
    r.lap1.toFixed(2).padStart(13),
    r.wings.toFixed(2).padStart(14),
    r.retiredNoWing.toFixed(2).padStart(18),
    r.stops.toFixed(2).padStart(10),
    r.contacts.toFixed(0).padStart(9),
    r.passes.toFixed(0).padStart(7),
    (r.off.toFixed(1) + '%').padStart(13),
  ].join(' '));
}

console.log(`\nacross all circuits:  ${mean(rows.map(r => r.retired)).toFixed(2)} retired of ${GRID}` +
  `  ·  ${mean(rows.map(r => r.passes)).toFixed(0)} passes` +
  `  ·  ${mean(rows.map(r => r.contacts)).toFixed(0)} contacts` +
  `  ·  ${mean(rows.map(r => r.wings)).toFixed(2)} cars lost a front wing` +
  `  ·  ${mean(rows.map(r => r.stops)).toFixed(2)} pit stops`);
console.log(`${TRACKS.length * SEEDS} races in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
