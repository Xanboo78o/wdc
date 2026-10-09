// ref-race.mjs — the reference for `xbr-race`: the JS Race run the same way,
// printed in the same rows. native/check.sh diffs the two.
//
//   node native/check/ref-race.mjs [track] [class] [laps] [grid] [tier] [flags]
//
// The flags are xbr-race's, one for one (see native/src/race_main.cpp). Without
// --trace it prints tools/race.mjs's table; with it, one row per car every
// `every` seconds of race time with the position to a nanometre, which is how
// to tell a port bug (the tables part company abruptly, by metres) from
// floating-point drift (they part by 1e-9 and the gap grows smoothly).
//
// --probe CAR:FROM:TO (with --trace; CAR may be `all`) prints a car's whole state every substep
// in a window instead: the tool for finding WHICH field parted company first.
//
// Unknown flags are an error here, as they are there: a dropped flag returns
// a plausible wrong race with nothing to say it happened.
import fs from 'fs';
import { Track } from '../../js/track.js';
import { buildLines } from '../../js/line.js';
import { CARS, FIXED_DT, registerAero, setWetness, makeCar } from '../../js/physics.js';
import { resolveCars } from '../../js/collide.js';
import { makeAero } from '../../js/aero.js';
import { TIERS, BATTLE } from '../../js/autopilot.js';
import { Race } from '../../js/race.js';
import { gridSlots } from '../../js/grid.js';

const die = (m, c = 2) => { console.error('ref-race: ' + m); process.exit(c); };

//   node native/check/ref-race.mjs --collide N [seed]
// Not a race: N pairs of cars thrown at each other, one line a pair. The same
// pairs as `xbr-race --collide`: every number comes off one mulberry32 stream.
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// C's %.Ng
const g = (v, n) => {
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const e = Math.floor(Math.log10(Math.abs(Number(v.toPrecision(n)))));
  if (e < -4 || e >= n) { const [m, x] = v.toExponential(n - 1).split('e'); return (m.includes('.') ? m.replace(/\.?0+$/, '') : m) + 'e' + (x[0] === '-' ? '-' : '+') + x.slice(1).padStart(2, '0'); }
  const f = v.toFixed(Math.max(0, n - 1 - e));
  return f.includes('.') ? f.replace(/\.?0+$/, '') : f;
};
function collide(n, seed) {
  const rng = mulberry(seed), cls = ['f1', 'f4', 'gt3'];
  const u = (lo, hi) => lo + (hi - lo) * rng();
  const side = c => {
    let tyres = 0;
    for (let i = 0; i < 4; i++) tyres += c.tyres[i].dmg;
    const k = c.crush || { front: 0, rear: 0, left: 0, right: 0 }, L = c.lost;
    return `${g(c.x, 9)} ${g(c.y, 9)} ${g(c.vx, 9)} ${g(c.vy, 9)} ${g(c.r, 9)} dmg ${g(c.damage, 9)} crush ${g(k.front, 6)} ${g(k.rear, 6)} ${g(k.left, 6)} ${g(k.right, 6)} lost ${L && L.frontWing ? 1 : 0}${L && L.rearWing ? 1 : 0} dents ${(c.dents || []).length} tyres ${g(tyres, 6)} z ${g(c.z, 6)} vz ${g(c.vz, 6)} air ${c.airborne ? 1 : 0}`;
  };
  const out = [];
  for (let k = 0; k < n; k++) {
    const ca = cls[Math.floor(rng() * 3)], cb = cls[Math.floor(rng() * 3)];
    const a = makeCar({ cls: ca }), b = makeCar({ cls: cb });
    const ha = u(-Math.PI, Math.PI), d = u(1.2, 5.2), phi = u(-Math.PI, Math.PI);
    a.x = u(-500, 500); a.y = u(-500, 500); a.hdg = ha;
    b.x = a.x + d * Math.cos(phi); b.y = a.y + d * Math.sin(phi);
    b.hdg = rng() < 0.5 ? ha + u(-0.25, 0.25) : u(-Math.PI, Math.PI);
    a.vx = u(5, 85); a.vy = u(-4, 4); a.r = u(-1.2, 1.2);
    b.vx = u(5, 85); b.vy = u(-4, 4); b.r = u(-1.2, 1.2);
    const h = resolveCars(a, b);
    if (!h) { out.push(`${k} miss`); continue; }
    out.push(`${k} hit depth ${g(h.depth, 9)} closing ${g(h.closing, 9)} n ${g(h.nx, 9)} ${g(h.ny, 9)} j ${g(h.j, 9)} harm ${g(h.harm || 0, 9)} up ${h.launched ? 1 : 0} | ${side(a)} | ${side(b)}`);
  }
  console.log(out.join('\n'));
}
if (process.argv[2] === '--collide') {
  const n = parseInt(process.argv[3], 10);
  if (!(n >= 1) || process.argv.length > 5) die('--collide N [seed]');
  collide(n, process.argv[4] != null ? +process.argv[4] : 1);
  process.exit(0);
}

const argv = process.argv.slice(2), a = [];
let probe = null;
let rainAt = -1;
let seed = 7, every = 1, maxTime = -1, wet = 0, playerSlot = 0, battle = null, input = 'park', xcar = null;
let pits = true, rules = true, duel = true, drs = true, noDnf = false, standIn = false, trace = false, aero = false;
let xsolo = false, xderby = false, xloose = false, xstakes = false, rolling = true, joker = true;
const isNum = s => s !== '' && !isNaN(Number(s));
for (let i = 0; i < argv.length; i++) {
  const s = argv[i];
  const val = () => { if (i + 1 >= argv.length) die(`${s} needs a value`); return argv[++i]; };
  const flag01 = () => { const v = val(); if (v !== '0' && v !== '1') die(`${s} takes 0 or 1`); return v === '1'; };
  if (s === '--data') val();
  else if (s === '--seed') seed = +val();
  else if (s === '--pits') pits = flag01();
  else if (s === '--rules') rules = flag01();
  else if (s === '--duel') duel = flag01();
  else if (s === '--drs') drs = flag01();
  else if (s === '--rolling') rolling = flag01();
  else if (s === '--joker') joker = flag01();
  else if (s === '--battle') battle = val();
  else if (s === '--nodnf') noDnf = true;
  else if (s === '--player') playerSlot = parseInt(val(), 10) || 0;
  else if (s === '--standin') standIn = true;
  else if (s === '--input') input = val();
  else if (s === '--xingus') xcar = val();
  else if (s === '--xsolo') xsolo = true;
  else if (s === '--xderby') xderby = true;
  else if (s === '--xloose') xloose = true;
  else if (s === '--xstakes') xstakes = true;
  else if (s === '--aero') aero = true;
  else if (s === '--wet') wet = +val();
  else if (s === '--rainat') rainAt = +val();
  else if (s === '--time') maxTime = +val();
  else if (s === '--probe') {
    const p = val().split(':');
    probe = [p[0] === 'all' ? -1 : Number(p[0]), Number(p[1]), Number(p[2])];
    if (p.length !== 3 || probe.some(isNaN) || (p[0] !== 'all' && probe[0] < 0)) die('--probe is CAR:FROM:TO or all:FROM:TO');
  }
  else if (s === '--trace') { trace = true; if (i + 1 < argv.length && isNum(argv[i + 1])) every = +argv[++i]; }
  else if (s.startsWith('--')) die(`unknown flag ${s}`);
  else a.push(s);
}
if (a.length > 5) die('too many arguments');
const key = a[0] || 'monza', cls = a[1] || 'f1';
const laps = a[2] != null ? parseInt(a[2], 10) : 3, grid = a[3] != null ? parseInt(a[3], 10) : 22, tier = a[4] || 'medium';
if (!CARS[cls]) die(`no car class '${cls}' (f4, f1, gt3)`);
if (!TIERS[tier]) die(`no tier '${tier}'`);
if (battle != null && !BATTLE[battle]) die(`no battle '${battle}' (easy, medium, hard)`);
if (input !== 'park' && input !== 'floor' && input !== 'weave') die('--input is park, floor or weave');
if (xcar != null && xcar !== 'gt' && xcar !== 'rally') die('--xingus is gt or rally');
if (!(laps >= 1) || !(grid >= 1) || !(every > 0)) die('laps, grid and the trace interval must be positive');

const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
let track;
try { track = new Track(read(`../../data/tracks/${key}.json`)); } catch (e) { die(e.message, 1); }
const spec = CARS[cls];
if (aero) registerAero(cls, makeAero(read(`../../data/aero/${cls}.json`)));
setWetness(wet);
const lines = buildLines(track, spec);
const slots = gridSlots(track, grid);
const opt = { track, lines, spec, slots, laps, grid, tier, seed, player: playerSlot > 0, pits, rules, duel, drs, noDnf, standIn, battle,
  xingus: xcar != null, xopt: { solo: xsolo, derby: xderby, loose: xloose, stakes: xstakes, rolling, joker } };
if (playerSlot > 0) opt.playerGrid = playerSlot;
if (xcar != null) opt.xopt.car = xcar;
const race = new Race(opt);

// every event, not only the last 300 the race keeps
const all = [];
const log0 = race.log.bind(race);
race.log = (kind, text, e = null, code = null) => { all.push({ t: race.time, kind, text, car: e ? e.idx : null, code }); log0(kind, text, e, code); };
// When two cars first touched (the race does not keep it): a touch always
// moves both, so it shows as a car that carContact() moved.
let firstHitAt = null;
const contact0 = race.carContact.bind(race);
race.carContact = () => {
  if (firstHitAt != null) return contact0();
  const cars = race.entries.map(e => e.car).concat(race.rc.sc.car), was = cars.map(c => [c.x, c.y]);
  contact0();
  if (cars.some((c, i) => c.x !== was[i][0] || c.y !== was[i][1])) firstHitAt = race.time;
};
const weave = input === 'weave';
const inp = input === 'park' ? null : { throttle: 1, brake: 0, delta: 0 };
// the same hands for the same substep, in both builds
const weaveAt = k => {
  const ph = k * FIXED_DT;
  inp.throttle = 1; inp.brake = 0; inp.hand = false;
  inp.wheel = 0.04 * Math.sin(3 * ph);
  if (ph >= 9 && ph < 9.5) { inp.wheel = 0.3; inp.hand = true; }                         // a tug of the handbrake: a drift
  if (ph >= 14 && ph < 14.6) { inp.wheel = -0.35; inp.brake = 0.7; inp.throttle = 0; }   // on the brakes with lock on: another
  inp.delta = 0.25 * inp.wheel;
  inp.gearTop = 60; inp.gearLow = 20;
};
const fmt = s => s == null ? '--.---' : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

function runTrace() {
  const T = maxTime > 0 ? maxTime : 60;
  const steps = Math.round(T / FIXED_DT), ev = Math.round(every / FIXED_DT);
  console.log(`${track.key}  ${cls}  ${laps} laps  ${race.entries.length} cars  ${tier}  seed ${seed}  race trace`);
  console.log('       T CAR              X              Y      M/S LAP POS    DMG FL');
  const out = [];
  let drsOpen = 0;                    // car-substeps with the flap open: did this case use DRS at all?
  for (let k = 1; k <= steps; k++) {
    if (rainAt >= 0 && k === Math.round(rainAt / FIXED_DT)) setWetness(1);
    if (weave) weaveAt(k);
    race.tick(FIXED_DT, inp);
    for (const e of race.entries) if (e.car.drsOpen && !e.retired) drsOpen++;
    if (probe) {
      const tt = k * FIXED_DT;
      if (tt >= probe[1] && tt <= probe[2]) {
        const nn = v => v == null ? 'null' : String(v);
        for (const e of race.entries) {
          if (probe[0] >= 0 && e.idx !== probe[0]) continue;
          const c = e.car, x = e.ctx || {};
          console.log(`P ${k} car ${e.idx} x ${nn(c.x)} y ${nn(c.y)} hdg ${nn(c.hdg)} vx ${nn(c.vx)} vy ${nn(c.vy)} r ${nn(c.r)} delta ${nn(c.delta)} thr ${nn(c.throttle)} brk ${nn(c.brake)} z ${nn(c.z)} dmg ${nn(c.damage)} Tf ${nn(c.tyre.Tf)} wf ${nn(c.tyre.wf)} | s ${nn(e.proj.s)} lat ${nn(e.proj.lat)} | bias ${nn(x.offBias)} cap ${nn(x.speedCap)} lunge ${nn(x.lunge)} press ${nn(x.pressure)} hold ${nn(x.hold)} oDs ${nn(x.obstDs)} oV ${nn(x.obstV)} | tow ${nn(c.tow)} dirty ${nn(c.dirty)} drs ${c.drsOpen ? 1 : 0} pit ${e.pitPhase || '-'} ahead ${e.ahead ? e.ahead.idx : -1} behind ${e.behind ? e.behind.idx : -1}`);
        }
      }
      continue;
    }
    if (k % ev === 0 || k === steps) {
      for (const e of race.entries) {
        out.push([(k * FIXED_DT).toFixed(2).padStart(8), String(e.idx).padStart(3), e.car.x.toFixed(9).padStart(14), e.car.y.toFixed(9).padStart(14),
          e.car.speed.toFixed(3).padStart(8), String(e.lap).padStart(3), String(e.pos).padStart(3), (e.car.damage || 0).toFixed(3).padStart(6),
          (e.retired ? 'R' : '-') + (e.inPit ? 'P' : '-')].join(' '));
      }
      if (out.length > 2000) { console.log(out.join('\n')); out.length = 0; }
    }
  }
  if (out.length) console.log(out.join('\n'));
  for (const x of all) console.log(`E ${x.t.toFixed(4)} ${x.kind} ${x.code || '-'} ${x.car == null ? -1 : x.car} ${x.text}`);
  console.log(firstHitAt == null ? 'CONTACT -' : `CONTACT ${firstHitAt.toFixed(4)}`);
  const c = race.rc.count;
  const sc = race.rc.sc;
  console.log(`END state ${race.state}  rc ${race.rc.mode} ${race.rc.phase || '-'}  sc ${c.sc} vsc ${c.vsc} red ${c.red} restarts ${c.restarts} pens ${c.pens}  passes ${race.passes || 0}  sideFights ${race.sideFights || 0}  drs ${drsOpen}  safety car ${!sc.out ? 'in' : sc.inLane ? 'lane' : 'out'} s ${sc.s.toFixed(6)} v ${sc.v.toFixed(6)} hits ${race.rc.scHits || 0}`);
}


function runTable() {
console.log(`${track.full} — ${spec.full} — ${grid} cars, ${laps} laps, ${tier}\n`);
const t0 = Date.now();
let simT = 0, kk = 0;
const maxT = maxTime > 0 ? maxTime : laps * 260 + 90;
while (race.state !== 'over' && simT < maxT) {
  if (rainAt >= 0 && simT < rainAt && simT + FIXED_DT >= rainAt) setWetness(1);
  if (weave) weaveAt(++kk);
  race.tick(FIXED_DT, inp); simT += FIXED_DT;
}
const wall = (Date.now() - t0) / 1000;

console.log('POS DRIVER          BEST LAP   LAPS  PEN  WARN  HITS  DMG');
for (const e of race.standings) {
  console.log([String(e.pos).padStart(3), e.name.padEnd(14), fmt(e.bestLap).padStart(10), String(e.lap).padStart(5), String(e.penalty).padStart(4),
    String(e.warnings).padStart(5), String(e.contacts).padStart(5), (e.car.damage || 0).toFixed(2).padStart(5), e.retired ? ' RETIRED' : ''].join(' '));
}
const fin = race.standings.filter(e => !e.retired);
const best = Math.min(...race.entries.map(e => e.bestLap || 1e9));
const ideal = lines.race.lapTime;
const spread = fin.filter(e => e.bestLap).map(e => e.bestLap).sort((x, y) => x - y);
console.log(`\nideal line ${fmt(ideal)}  |  best of the field ${fmt(best)} (${((best / ideal - 1) * 100).toFixed(1)}% off)`);
if (spread.length > 1) console.log(`field spread: ${(spread[spread.length - 1] - spread[0]).toFixed(2)}s between fastest and slowest best lap`);
console.log(`finished ${fin.length}/${race.entries.length}   retired ${race.entries.length - fin.length}`);
const moved = race.entries.filter(e => e.pos !== e.gridPos).length;
console.log(`passes: ${race.passes || 0}   cars finishing off their grid slot: ${moved}/${race.entries.length}`);
const kinds = {};
for (const ev of race.events) kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;
console.log('events:', JSON.stringify(kinds));
for (const ev of race.events.filter(e => e.kind === 'penalty' || e.kind === 'crash').slice(0, 6)) console.log(`   ${ev.t.toFixed(1)}s  ${ev.text}`);
console.log(`\nPERFORMANCE: ${simT.toFixed(0)}s of racing in ${wall.toFixed(1)}s wall = ${(simT / wall).toFixed(1)}x real time`);
console.log(`  ${(grid * simT / FIXED_DT / 1e6).toFixed(1)}M car-substeps, ${(grid * simT / FIXED_DT / wall / 1e6).toFixed(2)}M/s`);
}

// (no process.exit: it truncates a long trace written to a pipe)
if (trace) runTrace(); else runTable();
