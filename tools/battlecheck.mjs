// battlecheck.mjs — do the rivals fight YOU, or do they drive round you?
//
// fieldcheck.mjs runs a grid with nobody in it, which is the right tool for
// "does twenty-two cars destroy itself" and blind to the complaint this exists
// for (Adam, 2026-09-23): "racing feels like im racing a bunch of ghost
// overlays". A ghost is a car that never takes a place off you, never covers,
// and never spends any time beside you.
//
// Then, 2026-09-28, the opposite correction, after the 2019 season and three
// rowing races: "its more like flying at the same speed fighting for inches,
// building, building, then FINALLY overtaking ... but still they shouldnt fly
// away from u bc a missed brake point". So the numbers that matter now are
// the ones that say the fight is CLOSE and LONG and the pass is RARE:
//
//   SWAPS       places changing hands with YOU per race (passed you + you passed)
//   FIELD       position changes across the whole field per race (race.passes)
//   AHEAD<1s    % of green time the car directly ahead of you is within 1.0 s
//   GAP p50     median gap to the car directly ahead, seconds
//   BEHIND<1s   % of green time the car directly behind you is within 1.0 s
//   BATTLE      % of green time with ANY rival within 1.0 s either side
//   ALONGSIDE   s per race with a rival overlapping you
//   HITS        contacts involving your car
//   OUT         rivals retired (the counter-metric) and you retired
//   LEAD / NEXT worst gap to the leader / to the car directly ahead
//   DRS         % of green time your DRS was open (F1 only)
//   CHEERS      your held overtakes that race.js celebrated (js/race.js `cheer`)
//
// --blunder N makes your stand-in make one mistake a lap for N seconds, and
// then measures what it COST 20 s later: places lost, and the gap to whoever
// is now directly ahead. --blunder-kind picks the mistake:
//   brake  stands on the brakes with no throttle (a missed brake point, the
//          2026-09-24 "miss a brake point and auto lose")
//   late   the real missed braking point: at the first braking zone after
//          --blunder-at, stays OFF the brake (and the throttle) for N s after
//          the moment it should have braked — overshoots, runs wide or off
//   wide   takes the OUTSIDE edge of the road with a lift to 75% throttle —
//          the longer, slower way round (the
//          2026-09-28 "flooring it on the outside of the giant banked turn of
//          Kate Mascoi")
// --blunder-at is where on the lap in metres; the default is the start of the
// circuit's steepest banked section if it has one, else 40% of the lap.
//
// Your seat is driven by a stand-in: the same autopilot at `--you` tier, with
// the same racecraft the rivals get, because a stand-in that never defends or
// attacks would make any rival look like it was fighting. It opens DRS
// whenever race.js says you may, as a human would.
//
// --duel 0 builds the race with js/race.js's pre-2026-09-28 racecraft (no
// pace-matching band around you, no DRS rule, the old defence), so an A/B runs
// against the same code in one sitting instead of against a stashed file.
//
//   node tools/battlecheck.mjs --tier supercasual --battle medium --you casual
//   node tools/battlecheck.mjs --tracks kate --car f1 --blunder 3 --blunder-kind wide
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['tracks', 'seeds', 'laps', 'grid', 'tier', 'battle', 'car', 'you', 'start',
  'blunder', 'blunder-kind', 'blunder-at', 'duel', 'seed0']);
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
const SEED0 = +flag('seed0', 0);
const LAPS = +flag('laps', 3);
const GRID = +flag('grid', 12);
const TIER = flag('tier', 'supercasual');
const BATTLE = flag('battle', 'none');
const CLS = flag('car', 'f4');
const YOU = flag('you', 'medium');
const START = +flag('start', 7);
const BLUNDER = +flag('blunder', 0);
const BKIND = flag('blunder-kind', 'brake');
const BAT = flag('blunder-at', null);
const DUEL = flag('duel', null);
const KIND_WIDE = BKIND === 'wide';
if (!['brake', 'wide', 'late'].includes(BKIND)) { console.error(`battlecheck: --blunder-kind ${BKIND}? brake|wide|late`); process.exit(2); }

// Where the stand-in errs: the start of the steepest banked run, or 40%.
function blunderPoint(track) {
  if (BAT != null) return +BAT;
  const b = track.bank;
  if (b && b.length) {
    let best = 0, at = -1;
    for (let i = 0; i < b.length; i++) if (Math.abs(b[i]) > best) { best = Math.abs(b[i]); at = i; }
    if (best > 5) {
      let i = at;
      while (Math.abs(b[(i - 1 + b.length) % b.length]) > 3 && i !== at + 1) i = (i - 1 + b.length) % b.length;
      return i * track.ds;
    }
  }
  return track.length * 0.4;
}

function pct(a, p) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function one(track, lines, spec, seed) {
  const opts = {
    track, lines, spec, slots: gridSlots(track, GRID), laps: LAPS, grid: GRID,
    tier: TIER, battle: BATTLE === 'none' ? null : BATTLE, seed, player: true, playerGrid: START,
  };
  if (DUEL != null) opts.duel = DUEL !== '0';
  const race = new Race(opts);
  // A flag the race does not read would print a confident, wrong table.
  if (DUEL != null && race.duel !== (DUEL !== '0')) { console.error('battlecheck: Race ignored --duel'); process.exit(2); }
  const me = race.entries.find(e => e.isPlayer);
  me.driver = makeDriver(seed * 17 + 3, YOU, track.corners.length || 24);
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: me.driver });
  const L = spec.bodyL;
  const at = blunderPoint(track);
  let wasAhead = new Map(), lastSwap = new Map();
  let passedYou = 0, youPassed = 0, close = 0, green = 0, along = 0;
  const maxT = LAPS * 200 + 90;
  let t = 0, n = 0;
  const vRef = lines.race.v.reduce((a, b) => a + b, 0) / lines.race.v.length;
  let armed = false, held = 0, leadGap = 0, nextGap = 0, blunderLap = -1, blunderT = -99, over5 = 0, timed = 0;
  let aheadClose = 0, behindClose = 0, drsT = 0;
  const gapSamples = [];
  const blunders = [];            // { t, pos } -> filled with pos20 / gap20
  while (race.state !== 'over' && t < maxT && !me.finished) {
    if (n++ % 4 === 0) race.racecraft(me);
    // The wide mistake is a LINE, not a crash: the outside edge of the road,
    // a lift, and the longer way round. That is what Adam described.
    // Eased in over 1.2 s and back to the line over RELEASE s, the way a driver drifts back
    // across rather than snapping 18 m sideways at 290 km/h (which crashed
    // the stand-in into the wall every time and measured nothing).
    const RELEASE = 3;
    const wideK = !KIND_WIDE ? 0 : blunderT > 0 ? Math.min(1, (BLUNDER - blunderT) / 1.2) : Math.max(0, 1 - (-blunderT) / RELEASE);
    if (KIND_WIDE && blunderT <= 0 && blunderT > -RELEASE) blunderT -= FIXED_DT;
    const ctxNow = wideK > 0 && me.ctx
      ? { ...me.ctx, offBias: wideK * (-Math.sign(me.proj.curv || 1) * (me.proj.w * 0.7) - lines.race.off[me.proj.i]) } : me.ctx;
    drive(me.car, me.proj, FIXED_DT, ctxNow);
    // A human presses the button when the light says so.
    if (spec.drs) me.car.drsOpen = !!me.drsOk && me.car.brake < 0.05;
    if (BLUNDER > 0 && race.state === 'green') {
      const d = track.gap(me.proj.s, at);
      if (me.lap !== blunderLap && d >= 0 && d < 60 && race.time > 10) {
        blunderLap = me.lap;
        if (BKIND === 'late') armed = true;
        else {
          blunderT = BLUNDER; held = me.car.delta;
          blunders.push({ t: race.time, pos: me.pos, pos20: null, gap20: null });
        }
      }
      if (armed && me.car.brake > 0.25) {
        armed = false; blunderT = BLUNDER;
        blunders.push({ t: race.time, pos: me.pos, pos20: null, gap20: null });
      }
      if (blunderT > 0) {
        blunderT -= FIXED_DT;
        if (BKIND === 'brake') { me.car.throttle = 0; me.car.brake = 1; me.car.drsOpen = false; }
        else if (BKIND === 'late') { me.car.throttle = 0; me.car.brake = 0; }
        else { me.car.throttle = Math.min(me.car.throttle, 0.75); }
      }
    }
    race.tick(FIXED_DT, { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
    t += FIXED_DT;
    if (race.state !== 'green' || me.retired) continue;
    green += FIXED_DT;
    if (me.car.drsOpen) drsT += FIXED_DT;
    let near = false;
    const pMe = race.progress(me);
    let dA = Infinity, dB = Infinity;
    for (const o of race.entries) {
      if (o === me || o.retired) continue;
      const d = race.progress(o) - pMe;           // + = they are ahead of you
      if (Math.abs(d) / Math.max(me.car.speed, 12) < 1.0) near = true;
      if (Math.abs(d) < L && Math.abs(o.proj.lat - me.proj.lat) < 4) along += FIXED_DT;
      if (d > 0 && d < dA) dA = d;
      if (d < 0 && -d < dB) dB = -d;
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
    for (const b of blunders) {
      if (b.pos20 == null && race.time - b.t >= 20) {
        b.pos20 = me.pos;
        b.gap20 = dA < Infinity ? dA / vRef : 0;
      }
    }
    if (race.time > 20) {
      timed += FIXED_DT;
      const spd = Math.max(me.car.speed, 12);
      if (dA < Infinity && dA / spd < 1.0) aheadClose += FIXED_DT;
      if (dB < Infinity && dB / spd < 1.0) behindClose += FIXED_DT;
      if (dA < Infinity && n % 40 === 0) gapSamples.push(dA / vRef);
      const ahead = race.entries.filter(o => o !== me && !o.retired).map(o => race.progress(o) - pMe).filter(d => d > 0);
      if (ahead.length) {
        leadGap = Math.max(leadGap, Math.max(...ahead) / vRef);
        if (Math.max(...ahead) / vRef > 5) over5 += FIXED_DT;
        nextGap = Math.max(nextGap, Math.min(...ahead) / vRef);
      }
    }
  }
  if (process.env.BC_DEBUG && me.retired) {
    console.error(`[${track.key} seed ${seed}] you retired:`, race.events.filter(e => e.car === me.idx).map(e => `${e.t.toFixed(1)} ${e.text}`).join(' | '),
      `blunders at`, blunders.map(b => b.t.toFixed(1)).join(','));
  }
  const done = blunders.filter(b => b.pos20 != null);
  return {
    passedYou, youPassed, swaps: passedYou + youPassed, field: race.passes || 0,
    close: green ? close / green * 100 : 0, along,
    aheadClose: timed ? aheadClose / timed * 100 : 0, behindClose: timed ? behindClose / timed * 100 : 0,
    gapP50: gapSamples.length ? pct(gapSamples, 0.5) : 0, gapP90: gapSamples.length ? pct(gapSamples, 0.9) : 0,
    hits: me.contacts, pos: me.pos, leadGap, nextGap, over5: timed ? over5 / timed * 100 : 0,
    retired: race.entries.filter(e => e.retired && !e.isPlayer).length,
    youOut: me.retired ? 1 : 0,
    drs: green ? drsT / green * 100 : 0,
    cheers: race.cheers ? race.cheers.length : 0,
    bLost: done.length ? done.reduce((a, b) => a + (b.pos20 - b.pos), 0) / done.length : NaN,
    bGap: done.length ? done.reduce((a, b) => a + b.gap20, 0) / done.length : NaN,
    bFar: done.length ? done.filter(b => b.gap20 > 2).length / done.length * 100 : NaN,
  };
}

const mean = a => { const b = a.filter(x => !Number.isNaN(x)); return b.length ? b.reduce((x, y) => x + y, 0) / b.length : NaN; };
const se = a0 => {
  const a = a0.filter(x => !Number.isNaN(x));
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length);
};
const all = [];
const t0 = Date.now();
console.log(`${GRID} cars · ${LAPS} laps · rivals ${TIER}${BATTLE !== 'none' ? ' / overtakes ' + BATTLE : ''} · you drive like ${YOU} from P${START}` +
  `${BLUNDER ? ` · ${BLUNDER}s ${BKIND} blunder a lap` : ''} · ${CLS} · ${SEEDS} seeds${DUEL != null ? ` · duel ${DUEL}` : ''}\n`);
console.log('CIRCUIT      SWAPS  (YOU/THEM)  FIELD  AHEAD<1s  GAP p50  p90  BEHIND<1s  BATTLE  ALONG s  HITS  FIN P  OUT  YOU OUT  LEAD   NEXT   DRS%  CHEERS' +
  (BLUNDER ? '  BL:LOST  GAP@20s  >2s%' : ''));
for (const key of TRACKS) {
  const { track, lines, spec } = loadTrack(key, CLS);
  const runs = [];
  for (let s = 0; s < SEEDS; s++) runs.push(one(track, lines, spec, 7 + (s + SEED0) * 101));
  all.push(...runs);
  const m = k => mean(runs.map(r => r[k]));
  console.log([key.padEnd(12), m('swaps').toFixed(2).padStart(5),
    (m('youPassed').toFixed(1) + '/' + m('passedYou').toFixed(1)).padStart(11),
    m('field').toFixed(0).padStart(6), m('aheadClose').toFixed(0).padStart(9),
    m('gapP50').toFixed(2).padStart(8), m('gapP90').toFixed(1).padStart(5),
    m('behindClose').toFixed(0).padStart(10), m('close').toFixed(0).padStart(7),
    m('along').toFixed(1).padStart(8), m('hits').toFixed(1).padStart(5),
    m('pos').toFixed(1).padStart(6), m('retired').toFixed(2).padStart(5), m('youOut').toFixed(2).padStart(8),
    (m('leadGap').toFixed(1) + 's').padStart(6), (m('nextGap').toFixed(1) + 's').padStart(6),
    m('drs').toFixed(0).padStart(5), m('cheers').toFixed(2).padStart(7),
    ...(BLUNDER ? [m('bLost').toFixed(2).padStart(8), (m('bGap').toFixed(2) + 's').padStart(8), m('bFar').toFixed(0).padStart(5)] : []),
  ].join(' '));
}
const k = n => `${mean(all.map(r => r[n])).toFixed(2)} ± ${se(all.map(r => r[n])).toFixed(2)}`;
console.log(`\nall: swaps with you ${k('swaps')} (you passed ${k('youPassed')}, passed you ${k('passedYou')}) · field passes ${k('field')}` +
  `\n     car ahead within 1 s ${k('aheadClose')}% · gap p50 ${k('gapP50')} s · car behind within 1 s ${k('behindClose')}% · any rival within 1 s ${k('close')}%` +
  `\n     alongside ${k('along')} s · your hits ${k('hits')} · rivals out ${k('retired')} · you out ${k('youOut')} · finish P ${k('pos')}` +
  `\n     worst gap to leader ${k('leadGap')} s · worst gap to next car ${k('nextGap')} s · leader >5 s away ${k('over5')}% · DRS open ${k('drs')}% · cheers ${k('cheers')}` +
  (BLUNDER ? `\n     per blunder: places lost after 20 s ${k('bLost')} · gap to car ahead after 20 s ${k('bGap')} s · still >2 s behind ${k('bFar')}%` : ''));
console.log(`${all.length} races in ${((Date.now() - t0) / 1000).toFixed(0)}s — ± is the standard error; under ~2x it is not a result.`);
