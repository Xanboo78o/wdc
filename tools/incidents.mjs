// incidents.mjs — WHY do cars touch, and why do they leave the road?
//
// battlecheck and fieldcheck count contacts and retirements. This one tags
// each of them with what the cars were doing at the time, so a fix can aim at
// a cause instead of a count (2026-09-28: in 22-car battles 38 of 89 swaps
// with you were a car that had gone off or been damaged near you).
//
//   CONTACT   every collision the stewards logged (harm > 1.2): lap 1 or not,
//             nose-to-tail or side by side, and what the car BEHIND was doing
//             — braking zone, lunging, under the follow cap, over the line's
//             speed, mid-mistake, closing speed.
//   OFF       a car running more than 1.5 m past the white line (the runoff): was it hit in
//             the last 1.5 s, making a mistake, lunging, in dirty air, faster
//             than the line wanted, beside another car.
//
//   node tools/incidents.mjs [--tracks monza,suzuka] [--seeds 2] [--grid 22]
//        [--tier supercasual] [--battle medium|none] [--duel 0|1] [--car f1]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['tracks', 'seeds', 'grid', 'tier', 'battle', 'duel', 'car', 'laps', 'seed0']);
for (const a of args) if (a.startsWith('--') && !KNOWN.has(a.slice(2))) { console.error(`incidents: unknown flag ${a}`); process.exit(2); }
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const TRACKS = flag('tracks', 'monza,suzuka').split(','), SEEDS = +flag('seeds', 2), GRID = +flag('grid', 22);
const TIER = flag('tier', 'supercasual'), BATTLE = flag('battle', 'medium'), DUEL = flag('duel', '1') !== '0';
const CLS = flag('car', 'f1'), LAPS = +flag('laps', 3), SEED0 = +flag('seed0', 0);

const tally = {}, add = k => { tally[k] = (tally[k] || 0) + 1; };
let races = 0, retired = 0, passes = 0, contacts = 0, offs = 0, lap1c = 0, lap1o = 0;
const per = { contacts: [], offs: [], retired: [], passes: [], lap1: [] };
let c0 = 0, o0 = 0, l0 = 0;
for (const key of TRACKS) for (let s = 0; s < SEEDS; s++) {
  const seed = 7 + (s + SEED0) * 101;
  const { track, lines, spec } = loadTrack(key, CLS);
  const race = new Race({ track, lines, spec, slots: gridSlots(track, GRID), laps: LAPS, grid: GRID, tier: TIER,
    battle: BATTLE === 'none' ? null : BATTLE, seed, player: true, playerGrid: Math.ceil(GRID / 2) + 1, duel: DUEL });
  const me = race.me;
  me.driver = makeDriver(seed * 17 + 3, 'casual', track.corners.length || 24);
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: me.driver });
  const lastHit = new Map(), wasOff = new Map(), seenCont = new Map();
  const log = race.log.bind(race);
  race.log = (kind, text, e) => {
    log(kind, text, e);
    if (kind !== 'penalty' || !/COLLISION/.test(text) || !e) return;
    contacts++;
    const l1 = race.time < 30; if (l1) lap1c++;
    const how = /nose-to-tail/.test(text) ? 'nose-to-tail' : 'side-by-side';
    const cl = +(text.match(/closing ([\d.]+)/) || [0, 0])[1];
    const c = e.ctx || {}, i = e.proj.i;
    const tags = [l1 ? 'LAP1' : 'race', how, cl > 8 ? 'closing>8' : 'closing<8'];
    if (race.brakingZone(e.proj.s, 150)) tags.push('bz');
    if (c.lunge > 0) tags.push('lunge');
    if (c.speedCap != null) tags.push('capped');
    if (e.car.speed > lines.race.v[i] * 1.05) tags.push('over-line');
    if (e.driver?.mistake) tags.push('mistake:' + e.driver.mistake.kind);
    if (e.isPlayer) tags.push('YOU-behind');
    add('CONTACT ' + tags.join(' '));
  };
  let t = 0, n = 0;
  while (race.state !== 'over' && t < LAPS * 200 + 90) {
    if (!me.retired && !me.finished) {
      if (n % 4 === 0) race.racecraft(me);
      drive(me.car, me.proj, FIXED_DT, me.ctx);
      if (spec.drs) me.car.drsOpen = !!me.drsOk && me.car.brake < 0.05;
      if (race.safety > 0 && !me.inPit) {
        if (me.car.speed > 80 / 3.6) { me.car.throttle = 0; me.car.brake = Math.max(me.car.brake, Math.min(0.45, (me.car.speed - 80 / 3.6) * 0.10)); }
        else me.car.throttle = Math.min(me.car.throttle, 0.32);
      }
    }
    race.tick(FIXED_DT, { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
    t += FIXED_DT; n++;
    if (n % 40 || race.state !== 'green') continue;
    for (const e of race.entries) {
      if (e.retired || e.inPit || e.recover) continue;
      if (e.contacts !== seenCont.get(e)) { seenCont.set(e, e.contacts); lastHit.set(e, race.time); }
      const off = Math.abs(e.proj.lat) > e.proj.w + 1.5;
      if (off && !wasOff.get(e)) {
        offs++;
        const l1 = race.time < 30; if (l1) lap1o++;
        const c = e.ctx || {}, i = e.proj.i;
        const tags = [l1 ? 'LAP1' : 'race'];
        if (race.time - (lastHit.get(e) ?? -99) < 1.5) tags.push('HIT');
        if (e.driver?.mistake) tags.push('mistake:' + e.driver.mistake.kind);
        if (c.lunge > 0) tags.push('lunge');
        if ((e.car.dirty || 0) > 0.3) tags.push('dirty');
        if (e.car.speed > lines.race.v[i] * 1.05) tags.push('over-line');
        const beside = race.entries.some(o => o !== e && !o.retired && Math.abs(track.gap(o.proj.s, e.proj.s)) < spec.bodyL * 1.2 && Math.abs(o.proj.lat - e.proj.lat) < 4.5);
        if (beside) tags.push('beside');
        if (Math.abs(c.offBias || 0) > 3) tags.push('offbias>3');
        if (e.isPlayer) tags.push('YOU');
        add('OFF ' + tags.join(' '));
      }
      wasOff.set(e, off);
    }
  }
  races++; retired += race.entries.filter(e => e.retired).length; passes += race.passes || 0;
  per.contacts.push(contacts - c0); per.offs.push(offs - o0); per.lap1.push(lap1c - l0); c0 = contacts; o0 = offs; l0 = lap1c;
  per.retired.push(race.entries.filter(e => e.retired).length); per.passes.push(race.passes || 0);
}
console.log(`${races} races · ${GRID} cars · ${TIER}${BATTLE !== 'none' ? '/' + BATTLE : ''} · duel ${DUEL ? 1 : 0} · per race: contacts ${(contacts / races).toFixed(1)} (lap 1 ${(lap1c / races).toFixed(1)}) · offs ${(offs / races).toFixed(1)} (lap 1 ${(lap1o / races).toFixed(1)}) · retired ${(retired / races).toFixed(2)} · passes ${(passes / races).toFixed(0)}`);
const ms = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; const se = a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length) : 0; return `${m.toFixed(1)} ± ${se.toFixed(1)}`; };
console.log(`per race ± SE: contacts ${ms(per.contacts)} (lap 1 ${ms(per.lap1)}) · offs ${ms(per.offs)} · retired ${ms(per.retired)} · passes ${ms(per.passes)}`);
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));
