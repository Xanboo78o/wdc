// rearcheck.mjs — does anybody ever drive into the back of you?
//
//   node tools/rearcheck.mjs [--tracks monza,suzuka] [--seeds 2] [--grid 22] [--car f1]
//
// Adam, 2026-10-03: "if im slow asf, the cars behind me under no circumstances
// rear end me, they brake too, bc a car costs 82 gazillion dollars".
//
// So this drives YOU as badly as a person can, in a full race, and counts every
// time a rival behind you makes contact:
//   - you stall on the grid for 4 s after the lights go out
//   - you crawl at 25 km/h for 8 s, on the racing line, mid-lap
//   - you stop dead for 6 s
//   - you brake-test at full pedal on a straight, down to 60 km/h
// Contact is read off the session itself (`me.bump`, set by race.js on any
// player contact closing faster than 2 m/s); it counts as a rear-end when the
// other car was BEHIND you going in. The gate is zero, and it exits non-zero
// otherwise so it can sit in a check script.
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';

const args = process.argv.slice(2);
const KNOWN = new Set(['tracks', 'seeds', 'grid', 'car']);
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (!a.startsWith('--') || !KNOWN.has(a.slice(2))) { console.error(`rearcheck: unknown argument ${a}`); process.exit(2); }
  k++;
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const TRACKS = flag('tracks', 'monza,suzuka').split(','), SEEDS = +flag('seeds', 2), GRID = +flag('grid', 22), CLS = flag('car', 'f1');

// [start, end, kind] in seconds after the lights; `kind` is what you do.
const SCRIPT = [[0, 4, 'stall'], [45, 53, 'crawl'], [95, 101, 'stop'], [140, 144, 'braketest']];
let rearHits = 0, otherHits = 0, races = 0;
const log = [];
for (const key of TRACKS) for (let s = 0; s < SEEDS; s++) {
  const seed = 7 + s * 101;
  const { track, lines, spec } = loadTrack(key, CLS);
  const race = new Race({ track, lines, spec, slots: gridSlots(track, GRID), laps: 3, grid: GRID, tier: 'hard',
    battle: 'medium', seed, player: true, playerGrid: Math.ceil(GRID / 2), duel: true });
  const me = race.me;
  me.driver = makeDriver(seed * 17 + 3, 'casual', track.corners.length || 24);
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: me.driver });
  let t = 0, n = 0, lastBump = null;
  while (race.state !== 'over' && t < 260) {
    if (!me.retired && !me.finished) {
      if (n % 4 === 0) race.racecraft(me);
      drive(me.car, me.proj, FIXED_DT, me.ctx);
      const g = race.state === 'green' ? race.time - (race.greenT ?? 0) : -1;
      const w = SCRIPT.find(([a, b]) => g >= a && g < b);
      if (w) {
        const v = me.car.speed, want = { stall: 0, crawl: 25 / 3.6, stop: 0, braketest: 60 / 3.6 }[w[2]];
        me.car.throttle = v < want - 1 ? 0.25 : 0;
        me.car.brake = w[2] === 'braketest' ? (v > want ? 1 : 0) : (v > want + 0.5 ? Math.min(1, (v - want) * 0.3) : 0);
      }
    }
    race.tick(FIXED_DT, { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
    t += FIXED_DT; n++;
    if (me.bump && me.bump !== lastBump) {
      lastBump = me.bump;
      // Who touched you: race.js names the car (bump.by). The nearest centre
      // is only a fallback, and it lies — a car on your gearbox can be
      // further away, centre to centre, than one alongside.
      let o = me.bump.by || null, best = o ? -1 : 1e9;
      for (const e of race.entries) {
        if (best < 0 || e === me || e.retired) continue;
        const d = Math.hypot(e.car.x - me.car.x, e.car.y - me.car.y);
        if (d < best) { best = d; o = e; }
      }
      const behind = o && track.gap(o.proj.s, me.proj.s) < 0;
      const g = race.time - (race.greenT ?? 0);
      const w = SCRIPT.find(([a, b]) => g >= a && g < b + 3);
      const line = `${key} seed ${seed}  t+${g.toFixed(1)}s  ds ${o ? track.gap(o.proj.s, me.proj.s).toFixed(1) : "?"} lat you ${me.proj.lat.toFixed(1)} them ${o?.proj.lat.toFixed(1)} w ${me.proj.w.toFixed(1)} yaw you ${(Math.atan2(Math.sin(me.car.hdg - track.hdg[me.proj.i]), Math.cos(me.car.hdg - track.hdg[me.proj.i])) * 57.3).toFixed(0)} them ${o ? (Math.atan2(Math.sin(o.car.hdg - track.hdg[o.proj.i]), Math.cos(o.car.hdg - track.hdg[o.proj.i])) * 57.3).toFixed(0) : "?"} deg  ${behind ? 'REAR-END by' : 'contact with'} ${o?.name}  closing ${me.bump.closing.toFixed(1)} m/s  you ${(me.car.speed * 3.6).toFixed(0)} km/h${w ? '  during ' + w[2] : ''}`;
      log.push(line);
      if (behind) rearHits++; else otherHits++;
    }
  }
  races++;
}
for (const l of log) console.log(l);
console.log(`\n${races} races, ${GRID} cars, you stall/crawl/stop/brake-test: ${rearHits} rear-ends into you, ${otherHits} other contacts involving you`);
process.exit(rearHits ? 1 : 0);
