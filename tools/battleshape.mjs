// battleshape.mjs — what SHAPE are the fights? (Adam, 2026-10-03)
//
// "more battles where we're speeding side by side through corners ... like
// leadup, battle, overtake, like lead up 60%, battle 35%, overtake 5%".
//
// Every pair of cars that are close is in one of three states, sampled at
// 10 Hz across the whole field (bots only, green running):
//   LEAD-UP   the car behind is within 1.0 s and NOT overlapping
//   BATTLE    the two overlap — side by side (|ds| < a car length, apart
//             laterally)
//   OVERTAKE  the 2 s either side of the moment their order flips (wins over
//             the other two)
// and the shape is each one's share of all close-pair time. Counter-metrics
// beside it, because a field can always be made to look closer by making it
// crash: contacts and retirements per race. Mean ± SE over seeds — one race
// measures nothing.
//
//   node tools/battleshape.mjs [--tracks monza,suzuka] [--seeds 3] [--laps 3] [--tier medium] [--car f1] [--side 0] [--you medium]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['tracks', 'seeds', 'laps', 'tier', 'car', 'grid', 'side', 'you']);
for (let k = 0; k < args.length; k += 2) {
  const n = args[k].replace(/^--/, '');
  if (!args[k].startsWith('--') || !KNOWN.has(n) || args[k + 1] == null) { console.error(`battleshape: bad argument ${args[k]} (know --${[...KNOWN].join(' --')})`); process.exit(2); }
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const TRACKS = String(flag('tracks', 'monza,suzuka')).split(',');
const SEEDS = +flag('seeds', 3), LAPS = +flag('laps', 3), TIER = flag('tier', 'medium'), CLS = flag('car', 'f1'), GRID = +flag('grid', 22), SIDE = flag('side', '1') !== '0', YOU = flag('you', null);

const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const se = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length); };
const pm = (a, d = 1) => `${mean(a).toFixed(d)} ± ${se(a).toFixed(d)}`;

const R = { lead: [], battle: [], pass: [], pairS: [], contacts: [], retired: [], passes: [] };
for (const key of TRACKS) for (let k = 0; k < SEEDS; k++) {
  const seed = 7 + k * 101;
  const { track, lines, spec } = loadTrack(key, CLS);
  const race = new Race({ track, lines, spec, slots: gridSlots(track, GRID), laps: LAPS, grid: GRID, tier: TIER, seed, sideLock: SIDE,
    // --you <tier>: a stand-in in your seat (same autopilot + racecraft), and
    // ONLY the pairs with your car in them are counted — Adam's 60/35/5 is
    // about his fights.
    player: !!YOU, playerGrid: 11, standIn: !!YOU });
  const me = race.me;
  const drive = YOU ? makeAutopilot(track, lines, spec, race.peak, { driver: makeDriver(seed * 17 + 3, YOU, track.corners.length || 24) }) : null;
  const you = () => { drive(me.car, me.proj, FIXED_DT, me.ctx); if (race.drsRule && me.drsOk) me.car.drsOpen = true; return { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta }; };
  const L = spec.bodyL, t = track;
  const order = new Map();            // "a|b" -> sign of (a ahead of b), last sample
  const flips = [];                    // { a, b, t }
  const pend = new Map();              // a swap, waiting to see if it holds
  const samples = [];                  // { a, b, t, kind }
  let n = 0;
  const maxT = LAPS * 200 + 120;
  while (race.state !== 'over' && race.time < maxT) {
    race.tick(FIXED_DT, YOU ? you() : null);
    if (n++ % 40 || race.state !== 'green' || race.rc.neutral || race.time < 8) continue;
    const live = race.entries.filter(e => !e.retired && !e.finished && !e.inPit);
    for (const e of live) {
      const o = e.ahead;
      if (YOU && e !== me && o !== me) continue;
      if (!o || o.inPit || o.retired) continue;
      const ds = t.gap(o.proj.s, e.proj.s), dl = Math.abs(o.proj.lat - e.proj.lat);
      if (Math.abs(race.progress(o) - race.progress(e)) > t.length / 2) continue;     // lapping, not racing
      const key2 = e.idx < o.idx ? `${e.idx}|${o.idx}` : `${o.idx}|${e.idx}`;
      const ahead = race.progress(e.idx < o.idx ? e : o) > race.progress(e.idx < o.idx ? o : e) ? 1 : -1;
      const was = order.get(key2);
      // An overtake is an order change that STICKS: door to door, the noses
      // swap back and forth, and every swap counted as a pass at first.
      if (was != null && was !== ahead) pend.set(key2, { t: race.time, to: ahead });
      const pd = pend.get(key2);
      if (pd && pd.to !== ahead) pend.delete(key2);
      else if (pd && race.time - pd.t >= 3) { flips.push({ key: key2, t: pd.t }); pend.delete(key2); }
      order.set(key2, ahead);
      if (ds < L && dl > 1.2) samples.push({ key: key2, t: race.time, kind: 'battle' });
      else if (e.aheadGapT < 1.0) samples.push({ key: key2, t: race.time, kind: 'lead' });
    }
  }
  // Overtake time wins: any close sample within 2 s of a flip of that pair.
  const byPair = new Map();
  for (const f of flips) (byPair.get(f.key) || byPair.set(f.key, []).get(f.key)).push(f.t);
  let lead = 0, battle = 0, pass = 0;
  for (const s of samples) {
    const fs = byPair.get(s.key);
    if (fs && fs.some(ft => Math.abs(ft - s.t) <= 2)) pass++;
    else if (s.kind === 'battle') battle++; else lead++;
  }
  const tot = Math.max(1, lead + battle + pass);
  R.lead.push(100 * lead / tot); R.battle.push(100 * battle / tot); R.pass.push(100 * pass / tot);
  R.pairS.push(tot * 0.1 / Math.max(1, race.time / 60));       // close-pair seconds per race minute
  R.contacts.push(race.entries.reduce((a, e) => a + e.contacts, 0));
  R.retired.push(race.entries.filter(e => e.retired).length);
  R.passes.push(race.passes || 0);
  console.log(`${key.padEnd(10)} seed ${seed}  lead-up ${(100 * lead / tot).toFixed(0)}%  battle ${(100 * battle / tot).toFixed(0)}%  overtake ${(100 * pass / tot).toFixed(0)}%   close-pair ${(tot * 0.1).toFixed(0)} s  passes ${race.passes || 0}  contacts ${R.contacts.at(-1)}  retired ${R.retired.at(-1)}`);
}
console.log(`\nSHAPE   lead-up ${pm(R.lead)}%   battle ${pm(R.battle)}%   overtake ${pm(R.pass)}%     (Adam's target 60 / 35 / 5)`);
console.log(`AMOUNT  close-pair seconds per race-minute ${pm(R.pairS)}   passes ${pm(R.passes, 0)}`);
console.log(`COST    contacts ${pm(R.contacts, 0)}   retired ${pm(R.retired)} of ${GRID}`);
console.log('± is the standard error of the mean: a difference under ~2 of them is not a result.');
