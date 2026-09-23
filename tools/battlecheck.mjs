// battlecheck.mjs — do the rivals fight YOU, or do they drive round you?
//
// fieldcheck.mjs runs a grid with nobody in it, which is the right tool for
// "does twenty-two cars destroy itself" and blind to the complaint this exists
// for (Adam, 2026-09-23): "racing feels like im racing a bunch of ghost
// overlays". A ghost is a car that never takes a place off you, never covers,
// and never spends any time beside you. So those are the numbers:
//
//   PASSED YOU   a rival went from behind you to ahead of you (debounced 2 s)
//   YOU PASSED   the other way
//   CLOSE        % of green-flag time with a rival within 1.0 s either side
//   ALONGSIDE    s per race with a rival overlapping you (nose past your rear axle)
//   YOUR HITS    contacts involving your car
//   RETIRED      the counter-metric: a field that fights by crashing is no good
//
// Your seat is driven by a stand-in: the same autopilot at `--you` tier, with
// the same racecraft the rivals get, because a stand-in that never defends or
// attacks would make any rival look like it was fighting.
//
//   node tools/battlecheck.mjs --tier supercasual --battle medium
//   node tools/battlecheck.mjs --tier supercasual --battle hard --you hard --seeds 6
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['tracks', 'seeds', 'laps', 'grid', 'tier', 'battle', 'car', 'you', 'start']);
for (const a of args) {
  if (!a.startsWith('--')) continue;
  if (!KNOWN.has(a.slice(2))) {
    console.error(`battlecheck: unknown flag ${a}\n  known: ${[...KNOWN].map(k => '--' + k).join(' ')}`);
    process.exit(2);
  }
  if (args.indexOf(a) !== args.lastIndexOf(a)) { console.error(`battlecheck: ${a} given twice`); process.exit(2); }
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const TRACKS = String(flag('tracks', 'monza,suzuka,zandvoort')).split(',');
const SEEDS = +flag('seeds', 4);
const LAPS = +flag('laps', 3);
const GRID = +flag('grid', 12);
const TIER = flag('tier', 'supercasual');
const BATTLE = flag('battle', 'none');
const CLS = flag('car', 'f4');
const YOU = flag('you', 'medium');
const START = +flag('start', 7);

function one(track, lines, spec, seed) {
  const race = new Race({
    track, lines, spec, slots: gridSlots(track, GRID), laps: LAPS, grid: GRID,
    tier: TIER, battle: BATTLE === 'none' ? null : BATTLE, seed, player: true, playerGrid: START,
  });
  const me = race.entries.find(e => e.isPlayer);
  me.driver = makeDriver(seed * 17 + 3, YOU, track.corners.length || 24);
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: me.driver });
  const L = spec.bodyL;
  let wasAhead = new Map(), lastSwap = new Map();
  let passedYou = 0, youPassed = 0, close = 0, green = 0, along = 0;
  const maxT = LAPS * 200 + 90;
  let t = 0, n = 0;
  while (race.state !== 'over' && t < maxT && !me.finished) {
    if (n++ % 4 === 0) race.racecraft(me);
    drive(me.car, me.proj, FIXED_DT, me.ctx);
    race.tick(FIXED_DT, { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
    t += FIXED_DT;
    if (race.state !== 'green' || me.retired) continue;
    green += FIXED_DT;
    let near = false;
    const pMe = race.progress(me);
    for (const o of race.entries) {
      if (o === me || o.retired) continue;
      const d = race.progress(o) - pMe;           // + = they are ahead of you
      if (Math.abs(d) / Math.max(me.car.speed, 12) < 1.0) near = true;
      if (Math.abs(d) < L && Math.abs(o.proj.lat - me.proj.lat) < 4) along += FIXED_DT;
      const ahead = d > 0;
      const was = wasAhead.get(o);
      if (was !== undefined && was !== ahead && race.time > 6 && Math.abs(d) < 60
          && race.time - (lastSwap.get(o) || -99) > 2) {
        lastSwap.set(o, race.time);
        if (ahead) passedYou++; else youPassed++;
      }
      wasAhead.set(o, ahead);
    }
    if (near) close += FIXED_DT;
  }
  return {
    passedYou, youPassed, close: green ? close / green * 100 : 0, along,
    hits: me.contacts, pos: me.pos,
    retired: race.entries.filter(e => e.retired && !e.isPlayer).length,
    youOut: me.retired ? 1 : 0,
  };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const se = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length);
};
const all = [];
const t0 = Date.now();
console.log(`${GRID} cars · ${LAPS} laps · rivals ${TIER}${BATTLE !== 'none' ? ' / overtakes ' + BATTLE : ''} · you drive like ${YOU} from P${START} · ${CLS} · ${SEEDS} seeds\n`);
console.log('CIRCUIT      PASSED YOU  YOU PASSED  CLOSE %  ALONGSIDE s  YOUR HITS  FINISH P  RIVALS OUT  YOU OUT');
for (const key of TRACKS) {
  const { track, lines, spec } = loadTrack(key, CLS);
  const runs = [];
  for (let s = 0; s < SEEDS; s++) runs.push(one(track, lines, spec, 7 + s * 101));
  all.push(...runs);
  const m = k => mean(runs.map(r => r[k]));
  console.log([key.padEnd(12), m('passedYou').toFixed(2).padStart(10), m('youPassed').toFixed(2).padStart(11),
    m('close').toFixed(0).padStart(8), m('along').toFixed(1).padStart(12), m('hits').toFixed(2).padStart(10),
    m('pos').toFixed(1).padStart(9), m('retired').toFixed(2).padStart(11), m('youOut').toFixed(2).padStart(8)].join(' '));
}
const k = n => `${mean(all.map(r => r[n])).toFixed(2)} ± ${se(all.map(r => r[n])).toFixed(2)}`;
console.log(`\nall: passed you ${k('passedYou')} · you passed ${k('youPassed')} · close ${k('close')}% · alongside ${k('along')} s` +
  ` · your hits ${k('hits')} · rivals out ${k('retired')} · you out ${k('youOut')}`);
console.log(`${all.length} races in ${((Date.now() - t0) / 1000).toFixed(0)}s — ± is the standard error; under ~2x it is not a result.`);
