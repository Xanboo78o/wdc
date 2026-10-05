// rulescheck.mjs — does the rulebook HOLD? (js/safetycar.js, 2026-09-30)
//
// A safety car that exists is not a safety car that works. This forces each
// situation the FIA rulebook covers — a car stopped on the circuit, a beached
// one, one on its roof, a lapped car in the queue, a pit stop under the safety
// car, a driver (you) who ignores all of it — and asserts what must follow.
// Each check prints ok / FAIL with the number it judged, and each has been
// watched to FAIL once by breaking the rule it guards (see --break).
//
//   node tools/rulescheck.mjs                    # every forced situation, Monza
//   node tools/rulescheck.mjs --only sc,red      # some of them
//   node tools/rulescheck.mjs --tracks suzuka
//   node tools/rulescheck.mjs --sweep --tracks monza,suzuka,baku,zandvoort --seeds 4
//        # natural races, rules ON vs OFF: neutralisations per race, and the
//        # counter-metrics (passes, contacts, retired), mean ± SE
//   node tools/rulescheck.mjs --break nofollow   # the gate must go red
//
// THE ASSERTIONS, and why each is the one that matters:
//   no pass under SC/VSC   the only rule a queue exists to enforce
//   queue gap bounded      ten car lengths, the regulation
//   restart order          the order at "SC IN THIS LAP" is the order at the line
//   pit under SC is cheap  the loss of a stop vs the car behind, SC vs green
//   red: all in pit lane   every live car parked in its box before the restart
//   standing restart       the lights go again, and the red-flag order is the grid
//   you: give it back      a stand-in that ignores the SC is told, then penalised
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['only', 'tracks', 'seeds', 'laps', 'grid', 'car', 'tier', 'sweep', 'break', 'seed0']);
const BOOL = new Set(['sweep']);
for (const a of args) {
  if (!a.startsWith('--')) continue;
  if (!KNOWN.has(a.slice(2))) { console.error(`rulescheck: unknown flag ${a}\n  known: ${[...KNOWN].map(k => '--' + k).join(' ')}`); process.exit(2); }
  if (args.indexOf(a) !== args.lastIndexOf(a)) { console.error(`rulescheck: ${a} given twice`); process.exit(2); }
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : BOOL.has(n) ? true : args[i + 1]; };
const ONLY = flag('only', 'sc,out,vsc,red,pitsc,unlap,blue,you,speeding').split(',');
const TRACKS = String(flag('tracks', 'monza')).split(',');
const SEEDS = +flag('seeds', 3);
const SEED0 = +flag('seed0', 0);
const LAPS = +flag('laps', 5);
const GRID = +flag('grid', 22);
const CLS = flag('car', 'f1');
const TIER = flag('tier', 'medium');
const SWEEP = !!flag('sweep', false);
const BREAK = flag('break', null);
const KNOWN_CASES = ['sc', 'out', 'vsc', 'red', 'pitsc', 'unlap', 'blue', 'you', 'speeding'];
for (const c of ONLY) if (!KNOWN_CASES.includes(c)) { console.error(`rulescheck: --only ${c}? ${KNOWN_CASES.join('|')}`); process.exit(2); }

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const se = a => sd(a) / Math.sqrt(Math.max(1, a.length));
const pm = (a, d = 2) => `${mean(a).toFixed(d)} ± ${se(a).toFixed(d)}`;

let fails = 0;
function check(name, ok, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
}

// ---- a race and a watcher ---------------------------------------------------
function makeRace(key, seed, opts = {}) {
  const { track, lines, spec } = loadTrack(key, CLS);
  const race = new Race({
    track, lines, spec, slots: gridSlots(track, GRID), laps: opts.laps ?? LAPS, grid: GRID,
    tier: TIER, seed, player: !!opts.player, playerGrid: opts.playerGrid ?? 12,
    pits: opts.pits ?? true, rules: opts.rules ?? true, standIn: !!opts.player,
  });
  if (BREAK === 'nofollow') race.rc.limit = (e, ctx) => ctx;           // the gate must catch this
  if (BREAK === 'nored') race.rc.redTick = () => {};
  if (BREAK === 'nogive') race.rc.youTick = () => {};
  if (BREAK === 'notruck') race.rc.jobTick = () => {};
  return { race, track, lines, spec };
}

// Watches every pair of cars for an order change while race control forbids
// one. Eligible = on the circuit, running, not being pushed, not unlapping,
// not within 12 s of leaving the pit lane (a car rejoining from the lane has
// not overtaken anybody), and before the control line on a restart.
function watcher(race) {
  const W = { passes: [], lastPit: new Map(), prev: null, gaps: [], scT: 0, vscT: 0, redT: 0,
              vdMax: [], modeAt: [], restartOrder: null, inOrder: null, parkedOk: null };
  const rc = race.rc;
  // Off the circuit, or peeling off for the pit entry, is fair game under the
  // rules: both "passes" the gate once flagged were exactly that (Lawson
  // damaged and into the entry 18 m out, Sainz 12 m off the road).
  const eligible = e => !e.retired && !e.finished && !e.inPit && !e.recover && !e.unlap
    && race.time - (W.lastPit.get(e) ?? -99) > 12 && e.car.speed > 5 && !e.rcCross
    && Math.abs(e.proj.lat) <= e.proj.w + 1 && e.pitPhase !== 'approach';
  W.sample = () => {
    for (const e of race.entries) if (e.inPit) W.lastPit.set(e, race.time);
    const neutral = rc.mode !== 'green' && !(rc.mode === 'sc' && rc.phase === 'restart' && false);
    const live = race.entries.filter(eligible);
    const rank = new Map(live.slice().sort((a, b) => race.progress(b) - race.progress(a)).map((e, k) => [e, k]));
    // Three seconds' grace from the call: a move already alongside when the
    // message goes out is completed, as it is in the real thing.
    if (neutral && W.prev && W.prevMode === rc.mode && race.time - rc.since > 3) {
      for (const a of live) for (const b of live) {
        if (a === b || !W.prev.has(a) || !W.prev.has(b)) continue;
        if (W.prev.get(a) < W.prev.get(b) && rank.get(a) > rank.get(b)) {
          W.passes.push({ t: race.time, mode: rc.mode, phase: rc.phase, who: b.name, on: a.name });
        }
      }
    }
    W.prev = neutral ? rank : null; W.prevMode = rc.mode;
    // Queue gaps, once the queue has had time to form (SC leading for 45 s+).
    if (rc.mode === 'sc' && rc.phase === 'lead' && race.time - rc.phaseAt > 45) {
      const q = race.entries.filter(e => e.queued && !e.inPit && !e.retired && race.time - (W.lastPit.get(e) ?? -99) > 25);
      // The car physically ahead in the SAME queue: the leader's `ahead` wraps
      // round to the tail half a lap up the road (it read 2.8 km), and a
      // lapped car being waved through is not part of the queue.
      for (const e of q) if (e.ahead && e.ahead.queued && !e.ahead.unlap && !e.unlap
        && race.progress(e.ahead) > race.progress(e)) W.gaps.push(race.track.gap(e.ahead.proj.s, e.proj.s));
    }
    if (rc.mode === 'vsc' || rc.mode === 'vscEnd') {
      for (const e of race.entries) if (!e.retired && !e.inPit && !e.finished && !e.isPlayer) W.vdMax.push(e.vd || 0);
    }
    // Order when the SC lights go out, and at the moment of green.
    if (rc.mode === 'sc' && rc.phase === 'in' && !W.inOrder) {
      W.inOrder = race.standings.filter(e => !e.retired && !e.inPit && !e.finished).map(e => e);
    }
  };
  return W;
}

// Run until `until(race)` or `secs` elapse, sampling at 10 Hz.
function run(race, W, secs, until = null, each = null) {
  const end = race.time + secs;
  let n = 0;
  while (race.time < end && race.state !== 'over') {
    if (each) each();
    race.tick(FIXED_DT, race.me ? race._you?.() : null);
    if (n++ % 40 === 0 && W) W.sample();
    if (until && until(race)) return true;
  }
  return false;
}

// A mid-field car on the circuit, on the racing line, well away from the pits.
function victim(race, k = 8) {
  const t = race.track, lane = race.lane;
  const st = race.standings.filter(e => !e.isPlayer && !e.retired && !e.inPit);
  for (let j = k; j < st.length; j++) {
    const e = st[j];
    if (Math.abs(e.proj.lat) < e.proj.w - 1.5 && Math.abs(t.gap(e.proj.s, lane.entryS)) > 600
        && Math.abs(t.gap(e.proj.s, lane.exitS)) > 600 && e.car.speed > 30) return e;
  }
  return null;
}

// ---- the cases ------------------------------------------------------------
function caseSC(key, seed) {
  console.log(`\n[sc] ${key} seed ${seed}: a car stops on the circuit`);
  const { race } = makeRace(key, seed);
  const W = watcher(race);
  run(race, W, 45);
  let v = null;
  run(race, W, 60, () => (v = victim(race)));
  if (!v) { check('found a victim', false, ''); return; }
  v.car.damage = 1;                      // retired, where it stands, on the racing line
  run(race, W, 3);
  check('safety car deployed', race.rc.count.sc >= 1, `mode=${race.rc.mode} count=${race.rc.count.sc}`);
  const deployedAt = race.time;
  let greenAt = null, restartOrderOk = null;
  run(race, W, 600, () => race.rc.mode === 'green' && race.rc.count.sc >= 1 && (greenAt = race.time));
  check('safety car came in, green again', greenAt != null, greenAt ? `${(greenAt - deployedAt).toFixed(0)} s under SC` : 'never');
  // Order at green vs at SC-in-this-lap (cars that did not pit in between).
  if (W.inOrder) {
    const now = race.standings.filter(e => W.inOrder.includes(e) && !e.retired && race.time - (W.lastPit.get(e) ?? -99) > 60);
    const was = W.inOrder.filter(e => now.includes(e));
    const same = now.every((e, k) => e === was[k]);
    restartOrderOk = same;
    check('restart order preserved', same, same ? `${now.length} cars in order` : `was ${was.slice(0, 6).map(e => e.name).join(',')} now ${now.slice(0, 6).map(e => e.name).join(',')}`);
  } else check('restart order preserved', false, 'never saw SC IN THIS LAP');
  const under = W.passes.filter(p => p.mode === 'sc');
  check('no overtaking under the SC', under.length === 0, under.length ? `${under.length}: ${under.slice(0, 3).map(p => `${p.who} on ${p.on} @${p.t.toFixed(0)} ${p.phase}`).join('; ')}` : '0 passes');
  const g = W.gaps.slice().sort((a, b) => a - b);
  const p95 = g.length ? g[Math.floor(g.length * 0.95)] : NaN, mx = g.length ? g[g.length - 1] : NaN;
  const L10 = race.spec.bodyL * 10;
  check('queue within ten car lengths', g.length > 0 && p95 <= L10, `p95 ${p95.toFixed(1)} m, max ${mx.toFixed(1)} m (limit ${L10.toFixed(0)} m, ${g.length} samples)`);
  const sch = race.rc.scHits || 0;
  check('nobody hits the safety car', sch === 0, `${sch} contacts`);
  // Nobody may race before the control line: holdLine clears on crossing.
  run(race, W, 30);
  const msgs = race.events.filter(e => e.kind === 'rc').map(e => e.code);
  const need = ['sc', 'scIn', 'green'];
  check('race control said it', need.every(c => msgs.includes(c)), need.map(c => `${c}:${msgs.includes(c) ? 'y' : 'n'}`).join(' '));
  void restartOrderOk;
}

function caseVSC(key, seed) {
  console.log(`\n[vsc] ${key} seed ${seed}: a car beached beside the circuit`);
  const { race } = makeRace(key, seed);
  const W = watcher(race);
  run(race, W, 45);
  let v = null;
  run(race, W, 60, () => (v = victim(race)));
  if (!v) { check('found a victim', false, ''); return; }
  // Put it in the gravel, four metres past the edge, and hold it there.
  const t = race.track, lat = (v.proj.w + 4) * (Math.sign(v.proj.lat) || 1);
  const p = t.point(v.proj.s, lat);
  // A beached RIVAL is out of the race since 2026-10-05 (the [out] case), so
  // the marshals-are-pushing incident is raised here by hand: it is what YOU
  // get in the gravel, and the virtual safety car behind it is what is tested.
  let hold = 3;
  run(race, W, 3, null, () => {
    if (hold > 0) { v.car.x = p.x; v.car.y = p.y; v.car.vx = 0; v.car.vy = 0; v.car.r = 0; hold -= FIXED_DT; }
  });
  race.rc.incident('beached', v);
  // ...and they push for eight seconds and set it back on the road, as
  // race.js does for you (a rival left in the gravel would retire).
  const back = t.point(v.proj.s - 14, 0);
  let push = 8;
  run(race, W, 8, null, () => {
    if (push > 0) { v.car.x = p.x; v.car.y = p.y; v.car.vx = 0; v.car.vy = 0; v.car.r = 0; v.stuck = 0; push -= FIXED_DT; }
  });
  v.car.x = back.x; v.car.y = back.y; v.car.hdg = back.hdg; v.car.vx = 6; v.car.vy = 0; v.car.r = 0; v.stuck = 0;
  run(race, W, 6, () => race.rc.mode !== 'green');
  check('VSC deployed', race.rc.count.vsc >= 1 && race.rc.count.sc === 0, `vsc=${race.rc.count.vsc} sc=${race.rc.count.sc}`);
  const t0 = race.time;
  let ending = false;
  run(race, W, 200, () => { if (race.rc.mode === 'vscEnd') ending = true; return race.rc.mode === 'green'; });
  check('VSC ENDING, then green', ending && race.rc.mode === 'green', `${(race.time - t0).toFixed(0)} s under VSC`);
  const under = W.passes.filter(p => p.mode === 'vsc' || p.mode === 'vscEnd');
  check('no overtaking under the VSC', under.length === 0, under.length ? `${under.length}: ${under.slice(0, 3).map(p => `${p.who} on ${p.on}`).join('; ')}` : '0 passes');
  const vd = W.vdMax.slice().sort((a, b) => a - b);
  const p99 = vd[Math.floor(vd.length * 0.99)];
  check('bots respect the minimum time', p99 <= 3, `delta p99 ${p99.toFixed(1)} m ahead of the ghost (≤ 3 m), ${vd.length} samples`);
}

// Adam's story, 2026-10-05: "stroll does a stroll and has spun out and
// dnf'ed. yellow flag and safety car ... while safety crews remove his car".
function caseOut(key, seed) {
  console.log(`\n[out] ${key} seed ${seed}: a rival spins into the gravel and stays there`);
  const { race } = makeRace(key, seed);
  const W = watcher(race);
  run(race, W, 45);
  let v = null;
  run(race, W, 60, () => (v = victim(race)));
  if (!v) { check('found a victim', false, ''); return; }
  const t = race.track, side = Math.sign(v.proj.lat) || 1;
  const p = t.point(v.proj.s, (v.proj.w + 5) * side);
  v.car.x = p.x; v.car.y = p.y; v.car.hdg = p.hdg + Math.PI; v.car.vx = 0.001; v.car.vy = 0; v.car.r = 0; v.car.speed = 0;
  const t0 = race.time;
  run(race, W, 12, () => v.retired);
  check('it is out of the race', v.retired && !v.recover, `retired=${v.retired} after ${(race.time - t0).toFixed(1)} s`);
  run(race, W, 3);
  check('yellow, then the safety car', race.rc.yellowAt(v.proj.s) > 0 && race.rc.count.sc >= 1, `mode=${race.rc.mode} sc=${race.rc.count.sc}`);
  let truck = 0, towed = false, greenAt = null;
  run(race, W, 900, () => {
    const tr = race.rc.vehicles.find(x => x.kind === 'truck');
    if (tr) { truck++; if (tr.towing) towed = true; }
    return race.rc.mode === 'green' && (greenAt = race.time);
  });
  check('a truck came out and towed it', truck > 0 && towed, `${truck} ticks with a truck on the circuit`);
  const pr = t.project(v.car.x, v.car.y, v.hint, 8);
  check('the car is behind the barrier', !!v.recovered && Math.abs(pr.lat) > pr.w + (pr.run || 8), `recovered=${!!v.recovered} lat ${Math.abs(pr.lat).toFixed(1)} m (road ${pr.w.toFixed(1)} + runoff ${(pr.run || 8).toFixed(1)})`);
  check('no truck left on the circuit', race.rc.vehicles.length === 0, `${race.rc.vehicles.length} vehicles`);
  check('green again', greenAt != null, greenAt ? `${(greenAt - t0).toFixed(0)} s after the spin` : 'never');
  const under = W.passes.filter(p => p.mode === 'sc');
  check('no overtaking under the SC', under.length === 0, `${under.length} passes`);
}

function caseRed(key, seed) {
  console.log(`\n[red] ${key} seed ${seed}: a car on its roof on the circuit`);
  const { race } = makeRace(key, seed, { laps: Math.max(LAPS, 4) });
  const W = watcher(race);
  run(race, W, 45);
  let v = null;
  run(race, W, 60, () => (v = victim(race)));
  if (!v) { check('found a victim', false, ''); return; }
  v.car.onRoof = true; v.car.vx = 2;
  run(race, W, 2);
  check('red flag', race.rc.mode === 'red', `mode=${race.rc.mode}`);
  const order = race.rc.redOrder ? race.rc.redOrder.map(x => x.e) : [];
  let parked = false;
  run(race, W, 400, () => race.rc.parkedAt != null);
  const live = race.entries.filter(e => !e.retired && !e.finished);
  const inBox = live.filter(e => e.pitPhase === 'service').length;
  parked = inBox === live.length;
  check('every live car parked in the pit lane', parked, `${inBox}/${live.length} in their boxes after ${(race.time - race.rc.since).toFixed(0)} s`);
  // The work takes as long as the work takes (2.4 s for tyres, 11.5 for a
  // nose): asked the instant the last car stopped, its crew had not begun.
  run(race, W, 14);
  const notFixed = live.filter(e => (e.car.lost && e.car.lost.frontWing) || (e.car.tyre && e.car.tyre.wf > 0.001));
  check('free tyres and repairs', notFixed.length === 0, notFixed.length ? `not done: ${notFixed.map(e => e.name).join(',')}` : `${live.length} cars on new tyres, noses on`);
  let grid = false;
  run(race, W, 120, () => (grid = race.state === 'grid'));
  const gridOrder = race.entries.filter(e => !e.retired).sort((a, b) => race.progress(b) - race.progress(a));
  const want = order.filter(e => !e.retired);
  check('standing restart on the grid', grid, `state=${race.state}`);
  check('grid is the red-flag order', want.every((e, k) => gridOrder[k] === e), want.slice(0, 5).map(e => e.name).join(','));
  let green = false;
  run(race, W, 20, () => (green = race.state === 'green'));
  check('lights out again', green, '');
  run(race, W, 900);
  check('race finishes', race.state === 'over' || race.state === 'finish', `state=${race.state}, leader lap ${race.standings[0].lap}/${race.laps}`);
}

// The loss of a pit stop = (pit car's time from entry line to exit line) minus
// (the car behind it's time over the same stretch). Green vs under the SC.
function stopLoss(race, cars) {
  const t = race.track, lane = race.lane;
  const out = [];
  const st = new Map(cars.map(c => [c, {}]));
  return {
    tick() {
      for (const [c, S] of st) {
        const ref = S.ref;
        for (const [who, K] of [[c, 'p'], [ref, 'r']]) {
          if (!who) continue;
          const s = who.proj.s, prev = S[K + 'prev'] ?? s;
          if (t.gap(lane.entryS, prev) > 0 && t.gap(lane.entryS, s) <= 0 && S[K + 'in'] == null && (K === 'r' || c.pitPhase !== 'none')) S[K + 'in'] = race.time;
          if (S[K + 'in'] != null && t.gap(lane.exitS, prev) > 0 && t.gap(lane.exitS, s) <= 0 && S[K + 'out'] == null && race.time - S[K + 'in'] > 3) S[K + 'out'] = race.time;
          S[K + 'prev'] = s;
        }
        if (!S.ref && c.pitPhase === 'approach') {
          const i = race.standings.indexOf(c);
          S.ref = race.standings.slice(i + 1).find(o => !o.pitRequest && !o.inPit && !o.retired) || null;
        }
      }
    },
    losses() {
      for (const [c, S] of st) if (S.pout != null && S.rout != null) out.push((S.pout - S.pin) - (S.rout - S.rin));
      return out;
    },
  };
}

function casePitSC(key, seeds) {
  console.log(`\n[pitsc] ${key}: is a stop under the safety car cheaper? (${seeds.length} seeds × 2)`);
  const res = { green: [], sc: [] };
  for (const seed of seeds) for (const kind of ['green', 'sc']) {
    const { race } = makeRace(key, seed, { laps: 6 });
    run(race, null, 80);
    // An SC first (or not), then five cars told to box at once.
    if (kind === 'sc') {
      let v = null;
      run(race, null, 60, () => (v = victim(race, 14)));
      if (v) v.car.damage = 1;
      run(race, null, 50, () => race.rc.mode === 'sc' && race.rc.phase === 'lead');
    } else run(race, null, 20);
    const boxers = race.standings.filter(e => !e.retired && !e.inPit && !e.pitRequest).slice(2, 12).filter((_, k) => k % 2 === 0);
    for (const e of boxers) { e.pitRequest = true; }
    const L = stopLoss(race, boxers);
    run(race, null, 200, null, () => L.tick());
    res[kind].push(...L.losses());
  }
  check('stop under SC loses less than under green', mean(res.sc) < mean(res.green) - 2 * Math.hypot(se(res.sc), se(res.green)),
    `green ${pm(res.green, 1)} s (n=${res.green.length})  SC ${pm(res.sc, 1)} s (n=${res.sc.length})`);
}

function caseUnlap(key, seed) {
  console.log(`\n[unlap] ${key} seed ${seed}: a lapped car in the queue`);
  const { race } = makeRace(key, seed);
  const W = watcher(race);
  run(race, W, 60);
  // Put a car a lap down (the bookkeeping, not the tarmac) near the front.
  const st = race.standings.filter(e => !e.retired && !e.inPit);
  const lapped = st[3];
  lapped.lap -= 1;
  let v = null;
  run(race, W, 60, () => (v = victim(race, 10)));
  if (v) v.car.damage = 1;
  let called = false;
  run(race, W, 400, () => { if (race.events.some(e => e.code === 'unlap')) called = true; return race.rc.mode === 'green' && race.rc.count.sc > 0; });
  check('LAPPED CARS MAY NOW OVERTAKE', called, `lapped car ${lapped.name}`);
  check('it passed the safety car', (lapped.unlapped || 0) >= 1, `unlapped=${lapped.unlapped || 0}`);
  const hits = race.rc.scHits || 0;
  check('nobody hits the safety car', hits === 0, `${hits}`);
}

function caseBlue(key, seed) {
  console.log(`\n[blue] ${key} seed ${seed}: a backmarker with the leaders behind it`);
  const { race } = makeRace(key, seed);
  run(race, null, 60);
  const st = race.standings.filter(e => !e.retired && !e.inPit);
  const back = st[4];
  back.lap -= 1;                       // a lap down, in the middle of a train
  // ...and SLOWER, as a lapped car is: on paper alone it ran at the train's
  // pace and nobody behind ever came inside the one second a blue needs.
  const d0 = back.drive;
  back.drive = (c, p, dt, ctx) => { d0(c, p, dt, ctx); c.throttle *= 0.6; };
  let blueSeen = 0, passedPhys = 0;
  const behind0 = new Set(st.slice(5, 9));
  const phys = new Map();
  run(race, null, 90, null, () => {
    if (back.blue) blueSeen++;
    for (const o of behind0) {
      const g = race.track.gap(o.proj.s, back.proj.s);
      const was = phys.get(o);
      if (was != null && was < 0 && g > 0 && !o.inPit && !back.inPit) passedPhys++;
      phys.set(o, g);
    }
  });
  check('blue flag shown', blueSeen > 0, `${(blueSeen * FIXED_DT).toFixed(1)} s`);
  check('the lappers got by', passedPhys >= 2, `${passedPhys} of 4 passed ${back.name}`);
}

// YOU: a stand-in that ignores race control entirely (no ctx) — it must be
// told to give places back, and then penalised.
function caseYou(key, seed) {
  console.log(`\n[you] ${key} seed ${seed}: a driver who ignores the safety car`);
  const { race, track, lines, spec } = makeRace(key, seed, { player: true, playerGrid: 18 });
  const me = race.me;
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: makeDriver(seed * 17 + 3, 'hard', track.corners.length || 24) });
  // It sees the traffic (me.ctx, so it does not drive into anybody) but
  // NOT race control: the speed cap and the queue are stripped off.
  race._you = () => { drive(me.car, me.proj, FIXED_DT, me.ctx && { ...me.ctx, speedCap: undefined }); return { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta }; };
  run(race, null, 50);
  let v = null;
  run(race, null, 60, () => (v = victim(race, 2)));
  if (v && v !== me) v.car.damage = 1;
  run(race, null, 90);
  const ev = race.events.filter(e => e.car === me.idx);
  const told = ev.some(e => e.code === 'giveBack');
  const pen = ev.filter(e => e.kind === 'penalty' && /OVERTAKING|MINIMUM TIME/.test(e.text));
  check('told to give the place back', told, `${ev.filter(e => e.code === 'giveBack').length} times`);
  check('penalised when it did not', pen.length > 0, pen.slice(0, 3).map(e => e.text.replace(/FIA STEWARDS: /, '')).join(' | ') || 'none');
}

function caseSpeeding(key, seed) {
  console.log(`\n[speeding] ${key} seed ${seed}: into the pit lane at racing speed`);
  const { race, track, lines, spec } = makeRace(key, seed, { player: true, playerGrid: 18 });
  const me = race.me;
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: makeDriver(seed * 17 + 3, 'medium', track.corners.length || 24) });
  race._you = () => { drive(me.car, me.proj, FIXED_DT, me.ctx); return { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta }; };
  run(race, null, 40);
  me.pitRequest = true;
  run(race, null, 150, () => me.pitStops >= 1);
  const pen = race.events.filter(e => e.car === me.idx && /SPEEDING/.test(e.text));
  check('pit entry speeding penalised', pen.length > 0 && me.entryV > 23, `crossed at ${((me.entryV || 0) * 3.6).toFixed(0)} km/h`);
  // ...and the penalty is served at the NEXT stop.
  me.pitRequest = true;
  const had = me.penalty, before = me.penServed || 0;
  run(race, null, 160, () => me.pitStops >= 2);
  // What was owed going in is what this stop served. (A stand-in that speeds
  // into the lane AGAIN is rightly given a new five, for the stop after.)
  const served = (me.penServed || 0) - before;
  check('served at the next stop', had > 0 && served >= had, `had ${had}s, served ${served}s at stop 2, ${me.penalty}s new, owed for stop 3`);
}

// ---- natural races: how often, and is it still racing? -------------------
function sweep() {
  console.log(`\nSWEEP  ${GRID} cars · ${LAPS} laps · ${TIER} · ${CLS} · ${SEEDS} seeds · rules ON vs OFF`);
  const rows = [];
  for (const key of TRACKS) for (const rules of [true, false]) {
    const R = { sc: [], vsc: [], red: [], yel: [], passes: [], contacts: [], retired: [], neutralPct: [], pens: [], pitsUnder: [] };
    for (let k = 0; k < SEEDS; k++) {
      const seed = 7 + (SEED0 + k) * 101;
      const { race } = makeRace(key, seed, { rules });
      const maxT = LAPS * 260 + 200;
      let neutral = 0, green = 0;
      while (race.state !== 'over' && race.time < maxT) {
        race.tick(FIXED_DT, null);
        if (race.state === 'green') { green++; if (race.rc.neutral) neutral++; }
      }
      R.sc.push(race.rc.count.sc); R.vsc.push(race.rc.count.vsc); R.red.push(race.rc.count.red);
      R.yel.push(race.events.filter(e => e.code === 'yellow' || e.code === 'dyellow').length);
      R.passes.push(race.passes || 0);
      R.contacts.push(race.entries.reduce((a, e) => a + e.contacts, 0));
      R.retired.push(race.entries.filter(e => e.retired).length);
      R.neutralPct.push(100 * neutral / Math.max(1, green));
      R.pens.push(race.rc.count.pens); R.pitsUnder.push(race.rc.count.pitsUnder);
    }
    rows.push({ key, rules, R });
    const r = R;
    console.log(`${key.padEnd(10)} rules ${rules ? 'ON ' : 'OFF'}  SC ${pm(r.sc)}  VSC ${pm(r.vsc)}  RED ${pm(r.red)}  neutralised ${pm(r.neutralPct, 0)}%  yellows ${pm(r.yel, 1)}  | passes ${pm(r.passes, 0)}  contacts ${pm(r.contacts, 0)}  retired ${pm(r.retired, 1)}  stops-under ${pm(r.pitsUnder, 1)}`);
  }
  const on = rows.filter(r => r.rules), off = rows.filter(r => !r.rules);
  const all = (rs, k) => rs.flatMap(r => r.R[k]);
  console.log(`\nALL      rules ON   SC/race ${pm(all(on, 'sc'))}  VSC/race ${pm(all(on, 'vsc'))}  RED/race ${pm(all(on, 'red'))}  neutralised ${pm(all(on, 'neutralPct'), 0)}% of green time`);
  console.log(`         passes ON ${pm(all(on, 'passes'), 0)} vs OFF ${pm(all(off, 'passes'), 0)}   contacts ON ${pm(all(on, 'contacts'), 0)} vs OFF ${pm(all(off, 'contacts'), 0)}   retired ON ${pm(all(on, 'retired'), 1)} vs OFF ${pm(all(off, 'retired'), 1)}`);
  console.log('A difference is only a result past ~2 standard errors; one race measures nothing.');
}

const t0 = Date.now();
if (SWEEP) sweep();
else for (const key of TRACKS) {
  const seeds = Array.from({ length: SEEDS }, (_, k) => 7 + (SEED0 + k) * 101);
  if (ONLY.includes('sc')) caseSC(key, seeds[0]);
  if (ONLY.includes('out')) caseOut(key, seeds[0]);
  if (ONLY.includes('vsc')) caseVSC(key, seeds[0]);
  if (ONLY.includes('red')) caseRed(key, seeds[0]);
  if (ONLY.includes('pitsc')) casePitSC(key, seeds);
  if (ONLY.includes('unlap')) caseUnlap(key, seeds[0]);
  if (ONLY.includes('blue')) caseBlue(key, seeds[0]);
  if (ONLY.includes('you')) caseYou(key, seeds[0]);
  if (ONLY.includes('speeding')) caseSpeeding(key, seeds[0]);
}
console.log(`\n${fails ? fails + ' FAILED' : 'all ok'}  (${((Date.now() - t0) / 1000).toFixed(0)} s)${BREAK ? `  [--break ${BREAK}: this run SHOULD fail]` : ''}`);
process.exit(fails ? 1 : 0);
