// passwhy.mjs — WHY do places change hands with you? Every swap, tagged.
//
// battlecheck.mjs counts swaps; this says what made each one: the start
// (lap1), a mistake by the car that lost the place (mistake:kind, passed-off,
// passed-slow), where it happened (bz = braking zone, straight), and what the
// passer had going for it (lunge, drs, tow, capped = still under the follow
// cap). Built 2026-09-28 because the first "build before you attack" gate
// changed nothing, and this showed why in one run: a 12-car train is always
// inside 0.8 s, so a gate that only filled was always open.
//
//   node tools/passwhy.mjs [tracks] [seeds] [duel 0|1] [tier] [battle|none] [grid]
import { loadTrack } from './harness.mjs';
import { Race } from '../js/race.js';
import { gridSlots } from '../js/grid.js';
import { FIXED_DT } from '../js/physics.js';
import { makeAutopilot, makeDriver } from '../js/autopilot.js';
const [tracks='monza,suzuka,zandvoort', seeds='3', duel='1', tier='supercasual', battle='medium', gridS='12'] = process.argv.slice(2);
const GRID = +gridS;
const tally = {};
for (const key of tracks.split(',')) for (let s = 0; s < +seeds; s++) {
  const seed = 7 + s * 101;
  const { track, lines, spec } = loadTrack(key, 'f1');
  const race = new Race({ track, lines, spec, slots: gridSlots(track, GRID), laps: 3, grid: GRID, tier, battle: battle === 'none' ? null : battle, seed, player: true, playerGrid: Math.ceil(GRID / 2) + 1, duel: duel !== '0' });
  const me = race.entries.find(e => e.isPlayer);
  me.driver = makeDriver(seed * 17 + 3, 'casual', track.corners.length || 24);
  const drive = makeAutopilot(track, lines, spec, race.peak, { driver: me.driver });
  let n = 0; const was = new Map(), last = new Map();
  while (race.state !== 'over' && !me.finished && !me.retired && race.time < 700) {
    if (n++ % 4 === 0) race.racecraft(me);
    drive(me.car, me.proj, FIXED_DT, me.ctx);
    if (spec.drs) me.car.drsOpen = !!me.drsOk && me.car.brake < 0.05;
    // A human follows the safety car too (race.js caps the bots after their
    // driver; the stand-in gets the same cap, or it laps the field under it).
    if (race.safety > 0 && !me.inPit) {
      if (me.car.speed > 80 / 3.6) { me.car.throttle = 0; me.car.brake = Math.max(me.car.brake, Math.min(0.45, (me.car.speed - 80 / 3.6) * 0.10)); }
      else me.car.throttle = Math.min(me.car.throttle, 0.32);
    }
    race.tick(FIXED_DT, { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
    if (race.state !== 'green') continue;
    const pMe = race.progress(me);
    for (const o of race.entries) {
      if (o === me || o.retired) continue;
      const d = race.progress(o) - pMe, ahead = d > 0, w = was.get(o);
      if (w !== undefined && w !== ahead && race.time > 6 && Math.abs(d) < 60 && race.time - (last.get(o) || -99) > 2) {
        last.set(o, race.time);
        const passer = ahead ? o : me, passed = ahead ? me : o;
        const tags = [];
        if (race.time < 25) tags.push('lap1');
        if (passed.driver?.mistake) tags.push('mistake:' + passed.driver.mistake.kind);
        if (Math.abs(passed.proj.lat) > passed.proj.w) tags.push('passed-off');
        if (passed.car.speed < passer.car.speed * 0.7) tags.push('passed-slow');
        if ((passed.hold ?? 1) < 0.97) tags.push('leashed');
        if (passed.car.speed < passer.car.speed * 0.7) {
          if (passed.ctx?.speedCap != null) tags.push('its-cap:' + (passed.ctx.speedCap * 3.6).toFixed(0));
          if (passed.car.lost?.frontWing) tags.push('wingless');
          if ((passed.car.damage || 0) > 0.3) tags.push('damaged');
          if (passed.pitPhase) tags.push('pit:' + passed.pitPhase);
          if (race.safety > 0) tags.push('SC');
          tags.push('v' + (passed.car.speed * 3.6).toFixed(0) + '/' + (passer.car.speed * 3.6).toFixed(0));
        }
        if (race.brakingZone(passer.proj.s, 150)) tags.push('bz'); else tags.push('straight');
        if (passer.ctx?.lunge > 0) tags.push('lunge');
        if (passer.car.drsOpen) tags.push('drs');
        if ((passer.car.tow || 0) > 0.1) tags.push('tow');
        if (passer.ctx?.speedCap != null) tags.push('capped');
        const k = (ahead ? 'THEY ' : 'YOU ') + tags.join(' ');
        tally[k] = (tally[k] || 0) + 1;
      }
      was.set(o, ahead);
    }
  }
}
Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));
