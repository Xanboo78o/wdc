// story.mjs — does the game tell the race Adam narrated?
//
// Adam, 2026-10-05, turn by turn with me: a Malaysian Grand Prix. Twenty cars
// into turn one "braking at different times, some going in side by side but
// minimal and launching down the second straight getting more and more
// separate, attention to how theres been no contact or spins". Then Stroll
// spins on lap 4 and is out; yellow, the safety car "swerves out onto the
// course leading 3 laps while safety crews remove his car".
//
// Every beat of that is a number here, so the story is a gate and not a mood:
//
//   ACT 1  the start     contact / spins / offs on lap one (want none), where
//                        each car brakes for turn one against where it is in
//                        the pack, how long cars are alongside and whether it
//                        resolves, and the field stretching out.
//   ACT 2  the error     a car put in the gravel at turn eleven on lap four:
//                        is it out of the race, or pushed back?
//   ACT 3  the neutral   yellows, the safety car's laps in the lead (want ~3),
//                        the queue, stops under it, a truck for the wreck,
//                        contact under it, and the restart.
//
//   node tools/story.mjs [--track sepang] [--seeds 3] [--grid 20] [--tier medium]
//                        [--laps 22] [--you medium|0] [--seed0 0] [--v 1] [--act 1] [--opening 0]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['track', 'seeds', 'grid', 'tier', 'laps', 'you', 'seed0', 'v', 'act', 'opening']);
for (let k = 0; k < args.length; k += 2) {
  if (!args[k].startsWith('--') || !KNOWN.has(args[k].slice(2)) || args[k + 1] == null) { console.error(`story: bad flag ${args[k]}`); process.exit(2); }
  if (args.indexOf(args[k]) !== k) { console.error(`story: ${args[k]} given twice`); process.exit(2); }
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const KEY = flag('track', 'sepang'), SEEDS = +flag('seeds', 3), GRID = +flag('grid', 20), TIER = flag('tier', 'medium');
const LAPS = +flag('laps', 22), SEED0 = +flag('seed0', 0), V = flag('v', '0') !== '0';
const YOU = flag('you', 'medium') === '0' ? null : flag('you', 'medium');
const ACT = +flag('act', 0);            // --act 1: the start only, and stop at the end of lap two

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const pm = (a, d = 1) => {
  const m = mean(a), se = a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length) : NaN;
  return `${m.toFixed(d)} ± ${isNaN(se) ? '?' : se.toFixed(d)}`;
};
const R = { c1: [], spin1: [], off1: [], ret1: [], brakeSlope: [], sideS: [], sideLate: [], sp: {}, out: [], scLaps: [], scSecs: [],
            queue: [], queueN: [], shuffle: [], pitsU: [], truck: [], cSC: [], cRe: [], dnf: [], natSpin: [], natOut: [], yellowLag: [], goD: [] };

for (let sd = 0; sd < SEEDS; sd++) {
  const seed = 7 + (sd + SEED0) * 101;
  const { track: t, lines, spec } = loadTrack(KEY, 'f1');
  const race = new Race({ track: t, lines, spec, slots: gridSlots(t, GRID), laps: LAPS, grid: GRID, tier: TIER, seed,
    player: !!YOU, playerGrid: 9, standIn: !!YOU, opening: flag('opening', '1') !== '0' });
  const me = race.me;
  const drive = YOU ? makeAutopilot(t, lines, spec, race.peak, { driver: makeDriver(seed * 17 + 3, YOU, t.corners.length || 24) }) : null;
  const L = spec.bodyL, c1 = t.corners[0], c4 = t.corners[3] || t.corners[t.corners.length - 1];
  // Where the field's spread is read: out of turn two, into turn four, and the line each lap.
  const marks = [['T2 exit', (t.corners[1] || c1).s1 + 20, 0], ['into T4', c4.s0 - 120, 0], ['lap 1', 0, 1], ['lap 2', 0, 2], ['lap 3', 0, 3]];
  const cross = marks.map(() => new Map());
  const brakeAt = new Map(), rankAtBrake = new Map();
  let spins = 0, offs = 0, sideS = 0, sideLate = 0, lap1Done = false, c1n = 0, ret1 = 0;
  const spun = new Set(), offd = new Set();
  let natSpin = 0, natOut = 0; const spinNow = new Map();
  // ACT 2/3 state
  let victim = null, forcedAt = null, yellowAt = null, scAt = null, leadLapAtSC = null, scEnd = null, leadLapAtEnd = null;
  let queueN = 0, shuffle = NaN, queueLen = null, truckSeen = 0, cAtSC = null, cAtEnd = null, cAfter = null, victimOut = null, goD = null;
  const totC = () => race.entries.reduce((a, e) => a + e.contacts, 0) / 1;
  let simT = 0, sub = 0;
  const maxT = Math.min(LAPS, 12) * 200 + 400;
  while (race.state !== 'over' && race.state !== 'finish' && simT < maxT) {
    let inp = null;
    if (YOU && me && !me.retired) {
      drive(me.car, me.proj, FIXED_DT, me.ctx);
      if (race.drsRule && me.drsOk) me.car.drsOpen = true;
      inp = { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta };
    }
    race.tick(FIXED_DT, inp);
    simT += FIXED_DT; sub++;
    if (V) for (; (race._ev = race._ev || 0) < race.events.length; race._ev++) { const x = race.events[race._ev]; if (x.kind === 'rc' || (x.kind === 'crash' && (race.rc.neutral || !/BARRIER/.test(x.text))) || x.kind === 'penalty' || /PIT|SERVED/.test(x.text)) { const ld = race.rc.leader(); console.log(`   t=${race.time.toFixed(0).padStart(4)} L${ld ? ld.lap + 1 : '?'} ${race.rc.mode}/${race.rc.phase || '-'}  ${x.text}`); } }
    if (sub % 10) continue;                                  // read at 40 Hz
    if (ACT === 1 && (cross[2].size >= race.entries.filter(e => !e.retired).length || race.time > 220)) break;
    const live = race.entries.filter(e => !e.retired);
    const lead = race.rc.leader();
    // ---- ACT 1 -------------------------------------------------------------
    if (!lap1Done) {
      for (const e of live) {
        const s = e.proj.s, car = e.car;
        if (e.lap === 0 && !brakeAt.has(e) && s > 60 && s < c1.s && car.brake > 0.4 && car.speed > 40) {
          brakeAt.set(e, c1.s - s); rankAtBrake.set(e, e.pos);
        }
        const yaw = Math.abs(Math.atan2(Math.sin(car.hdg - t.hdg[e.proj.i]), Math.cos(car.hdg - t.hdg[e.proj.i])));
        if (yaw > 1.2 && car.speed > 4 && !spun.has(e)) { spun.add(e); spins++; if (V) console.log(`   spin  ${e.name} lap1 s=${s.toFixed(0)}`); }
        if (Math.abs(e.proj.lat) > e.proj.w + 1.5 && !offd.has(e) && race.state === 'green') { offd.add(e); offs++; if (V) console.log(`   off   ${e.name} lap1 s=${s.toFixed(0)}`); }
      }
      // alongside: overlapping along the road, a car's width apart across it
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.lap !== 0 || b.lap !== 0 || a.car.speed < 15) continue;
        if (Math.abs(t.gap(a.proj.s, b.proj.s)) < L * 0.8 && Math.abs(a.proj.lat - b.proj.lat) > 1.4 && Math.abs(a.proj.lat - b.proj.lat) < 6) {
          sideS += 0.025;
          if (a.proj.s > c4.s1 + 60) sideLate += 0.025;       // still alongside after turn four
        }
      }
      if (live.every(e => e.lap >= 1)) { lap1Done = true; shuffle = mean(live.map(e => Math.abs(e.pos - e.gridPos))); c1n = totC() / 2; ret1 = race.entries.filter(e => e.retired).length; }
    }
    for (let m = 0; m < marks.length; m++) for (const e of live) {
      if (cross[m].has(e)) continue;
      const [, s, lap] = marks[m];
      if (lap ? e.lap >= lap : (e.lap === 0 && e.proj.s >= s && e.proj.s < s + 200)) cross[m].set(e, race.time);
    }
    // natural spins, whole race (before the forced one)
    if (!forcedAt) for (const e of live) {
      const yaw = Math.abs(Math.atan2(Math.sin(e.car.hdg - t.hdg[e.proj.i]), Math.cos(e.car.hdg - t.hdg[e.proj.i])));
      if (yaw > 1.2 && e.car.speed > 4 && e.lap >= 1 && !e.inPit) { if (!spinNow.get(e)) { spinNow.set(e, 1); natSpin++; } }
      else if (yaw < 0.3) spinNow.set(e, 0);
    }
    // ---- ACT 2: Stroll does a Stroll ----------------------------------------
    // P16, lap 4, on the exit of turn eleven: the car is set down in the gravel,
    // stopped and pointing the wrong way. What the game does next is the test.
    if (!forcedAt && lead && lead.lap >= 3 && race.rc.mode === 'green') {
      const c11 = t.corners[10] || t.corners[t.corners.length - 2];
      const cand = (race.standings || race.entries).filter(e => !e.retired && !e.isPlayer && !e.inPit);
      const v = cand[Math.min(cand.length - 1, 15)];
      if (v && v.lap >= 3 && v.proj.s > c11.s && v.proj.s < c11.s1 + 40) {
        victim = v; forcedAt = race.time;
        {
          const side = -Math.sign(c11.dir || 1) || 1;
          const p = t.point(v.proj.s + 30, side * (v.proj.w + 6));
          v.car.x = p.x; v.car.y = p.y; v.car.hdg = p.hdg + Math.PI; v.car.vx = 0.001; v.car.vy = 0; v.car.r = 0; v.car.speed = 0;
        }
        if (V) console.log(`   t=${race.time.toFixed(0)}  ${v.name} (P${v.pos}) spins at s=${v.proj.s.toFixed(0)}, leader on lap ${lead.lap + 1}`);
      }
    }
    // ---- ACT 3 ---------------------------------------------------------------
    if (forcedAt) {
      if (yellowAt == null && (race.rc.yellowAt(victim.proj.s) > 0 || race.rc.neutral)) yellowAt = race.time;
      if (scAt == null && race.rc.mode === 'sc') { scAt = race.time; leadLapAtSC = lead.lap + lead.proj.s / t.length; cAtSC = totC(); }
      if (victimOut == null && victim.retired) victimOut = race.time;
      if (scAt != null && scEnd == null) {
        const list = race.rc.vehicles;
        if (Array.isArray(list) && list.some(x => x.kind === 'truck')) truckSeen = 1;
        if (race.rc.mode === 'sc' && race.rc.phase === 'in' && queueLen == null) {
          // the queue as the lights go out: leader to the last car on the road
          const sc = race.rc.sc, q = live.filter(e => !e.inPit && e.queued);
          queueLen = Math.max(0, ...q.map(e => -t.gap(e.proj.s, sc.s)));
          queueN = q.length;
        }
        if (race.rc.phase === 'restart' && goD == null && lead.went) goD = t.wrap(0 - lead.proj.s);
        if (race.rc.mode === 'green') { scEnd = race.time; leadLapAtEnd = lead.lap + lead.proj.s / t.length; cAtEnd = totC(); }
      }
      if (scEnd != null && cAfter == null && race.time - scEnd > 25) cAfter = totC();
      if (cAfter != null) break;
      if (scAt == null && race.time - forcedAt > 90) break;       // no safety car came
    }
  }
  // ---- this seed ---------------------------------------------------------------
  if (!lap1Done) { c1n = totC() / 2; ret1 = race.entries.filter(e => e.retired).length; }
  const gaps = marks.map((m, k) => { const v = [...cross[k].values()]; return v.length > 2 ? Math.max(...v) - Math.min(...v) : NaN; });
  // brake distance against place in the pack: metres EARLIER per place back
  const pts = [...brakeAt.entries()].map(([e, d]) => [rankAtBrake.get(e), d]);
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / Math.max(1e-9, pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0));
  const ds = pts.map(p => p[1]);
  R.c1.push(c1n); R.spin1.push(spins); R.off1.push(offs); R.ret1.push(ret1); R.brakeSlope.push(slope);
  R.sideS.push(sideS); R.sideLate.push(sideLate); R.shuffle.push(shuffle);
  marks.forEach((m, k) => (R.sp[m[0]] = R.sp[m[0]] || []).push(gaps[k]));
  R.natSpin.push(natSpin);
  R.out.push(victim && victim.retired ? 1 : 0);
  R.yellowLag.push(yellowAt != null ? yellowAt - forcedAt : NaN);
  if (scAt != null && scEnd != null) {
    R.scLaps.push(leadLapAtEnd - leadLapAtSC); R.scSecs.push(scEnd - scAt); R.queue.push(queueLen ?? NaN); R.queueN.push(queueN);
    R.pitsU.push(race.rc.count.pitsUnder); R.truck.push(truckSeen); R.cSC.push((cAtEnd - cAtSC) / 2); R.cRe.push(((cAfter ?? cAtEnd) - cAtEnd) / 2);
    R.goD.push(goD ?? NaN);
  }
  console.log(`seed ${String(seed).padEnd(4)} START contacts ${c1n} spins ${spins} offs ${offs} out ${ret1} | T1 brake ${Math.min(...ds).toFixed(0)}-${Math.max(...ds).toFixed(0)} m, ${slope.toFixed(1)} m/place | moved ${shuffle.toFixed(1)} | alongside ${sideS.toFixed(1)} s (${sideLate.toFixed(1)} after T4) | spread ${gaps.map(g => g.toFixed(1)).join(' / ')} s`);
  console.log(`          ERROR ${victim ? victim.name : 'nobody'}: ${victim ? (victim.retired ? `OUT after ${(victimOut - forcedAt).toFixed(0)} s` : victim.recover || victim.car.speed > 10 ? 'pushed back / drove on' : 'still sat there') : '-'} | yellow after ${yellowAt != null ? (yellowAt - forcedAt).toFixed(1) : 'never'} s | SC ${scAt == null ? 'NEVER CAME' : `${(scEnd - scAt).toFixed(0)} s = ${(leadLapAtEnd - leadLapAtSC).toFixed(2)} laps, queue ${queueLen == null ? '?' : queueLen.toFixed(0)} m / ${queueN} cars, stops ${race.rc.count.pitsUnder}, truck ${truckSeen ? 'yes' : 'NO'}, contact under ${(cAtEnd - cAtSC) / 2}, after restart ${((cAfter ?? cAtEnd) - cAtEnd) / 2}, leader went ${goD == null ? '?' : goD.toFixed(0)} m out`}`);
}

console.log(`\nTHE STORY, ${KEY}, ${GRID} cars, ${TIER}${YOU ? `, a ${YOU} stand-in in P9` : ''}, ${SEEDS} seeds   (± = standard error)`);
console.log(`ACT 1  lap one        contacts ${pm(R.c1)}   spins ${pm(R.spin1)}   offs ${pm(R.off1)}   retired ${pm(R.ret1)}      story: 0 / 0 / 0 / 0`);
console.log(`       turn one       each place back brakes ${pm(R.brakeSlope)} m earlier                         story: > 0, different for everyone`);
console.log(`       alongside      ${pm(R.sideS)} car-pair seconds, ${pm(R.sideLate)} of them after turn four     story: some, minimal, resolved`);
console.log(`       still a race   ${pm(R.shuffle)} places changed per car by the end of lap one                     (the counter-metric: 0 = a procession)`);
console.log(`       the spread     ${Object.entries(R.sp).map(([k, v]) => `${k} ${mean(v).toFixed(1)}`).join('  ->  ')} s   story: grows at every step`);
console.log(`ACT 2  unforced       ${pm(R.natSpin)} spins a race nobody asked for; the spun car is OUT in ${(100 * mean(R.out)).toFixed(0)}% of races   story: out`);
console.log(`ACT 3  yellow         ${pm(R.yellowLag)} s after the spin`);
console.log(`       safety car     came in ${R.scLaps.length}/${SEEDS}; led ${pm(R.scLaps, 2)} laps (${pm(R.scSecs, 0)} s)                    story: 3 laps`);
console.log(`       the queue      ${pm(R.queue, 0)} m from the safety car to the last car in it, ${pm(R.queueN)} cars, at lights-out`);
console.log(`       stops under    ${pm(R.pitsU)}      truck out ${(100 * mean(R.truck)).toFixed(0)}%      story: a few stop, a truck lifts the car`);
console.log(`       contact        under the safety car ${pm(R.cSC)}, in the 25 s after the restart ${pm(R.cRe)}        story: 0, 0`);
console.log(`       restart        leader goes ${pm(R.goD, 0)} m before the line`);
