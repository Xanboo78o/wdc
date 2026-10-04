// radiocheck.mjs — whose voice is on YOUR radio? (Adam, 2026-10-04: "other
// driver's radios are on mine ... 'HE just crashed into me!!' like bro")
//
// Feeds js/engineer.js the race log for three collisions — you at fault, them
// at fault for hitting you, two other cars — plus a rival pitting and a car
// you ran off the road, through the REAL Engineer.events()/proximity(), and
// prints every line that reaches the radio and who it is from. Fails if any
// line is not from your engineer, or if you are told somebody hit you when the
// penalty was yours.
//
//   node tools/radiocheck.mjs
import { Engineer, collisionLines, onMyRadio } from '../js/engineer.js';

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${detail}`); };

function scene() {
  const car = (x, y) => ({ x, y, speed: 60, throttle: 0.6, tyre: { wf: 0.1, wr: 0.1 }, damage: 0, lost: null });
  const mk = (idx, name, x, y, isPlayer = false) => ({ idx, name, isPlayer, car: car(x, y), pos: idx + 1, lap: 1,
    proj: { s: 100 + x, lat: 0 }, penalty: 0, retired: false, inPit: false, finished: false, pitStops: 0 });
  const entries = [mk(0, 'LECLERC', 20, 0), mk(1, 'YOU', 0, 0, true), mk(2, 'NORRIS', -5, 0), mk(3, 'SAINZ', 400, 0), mk(4, 'ALBON', 405, 0)];
  const race = { entries, standings: entries, events: [], time: 50, state: 'green', laps: 5, drsRule: false,
    track: { length: 5000, w: [6], idx: () => 0, cornerAt: () => ({ name: 'Turn 1' }) },
    progress: e => e.proj.s, log(kind, text, e) { this.events.push({ t: this.time, kind, text, car: e ? e.idx : null }); } };
  const heard = [];
  const eng = new Engineer({ say: (text, who) => heard.push({ who, text }) });
  eng.begin(race);
  return { race, eng, heard, me: entries[1], E: entries };
}
const show = h => h.map(x => `[${x.who}] ${x.text}`).join('  |  ') || '(silence)';

console.log('\n[1] YOU hit Norris — the penalty is against your car');
{ const { race, eng, heard, me } = scene();
  race.log('penalty', 'YOU +5s CAUSING A COLLISION at Turn 1 (closing 6.0 m/s, nose-to-tail, lap 2)', me);
  eng.events();
  console.log('     ' + show(heard));
  check('only your engineer speaks', heard.every(h => onMyRadio(h.who)), `${heard.length} line(s)`);
  check('nobody says he drove into me', !heard.some(h => /drove into me|crashed into me|into me/i.test(h.text)), '');
  check('you are told it was on you', heard.some(h => /on us|penalty for us/i.test(h.text)), ''); }

console.log('\n[2] Norris hits YOU — the penalty is against Norris');
{ const { race, eng, heard, E } = scene();
  eng.near.set(2, race.time);
  race.log('penalty', 'NORRIS +5s CAUSING A COLLISION at Turn 1 (closing 6.0 m/s, nose-to-tail, lap 2)', E[2]);
  eng.events();
  console.log('     ' + show(heard));
  check('only your engineer speaks', heard.every(h => onMyRadio(h.who)), `${heard.length} line(s)`);
  check('he is the one blamed', heard.some(h => /Norris has five seconds for hitting us/i.test(h.text)), ''); }

console.log('\n[3] Sainz hits Albon, 400 m up the road — not your incident');
{ const { race, eng, heard, E } = scene();
  race.log('penalty', 'SAINZ +5s CAUSING A COLLISION at Turn 9 (closing 5.0 m/s, side by side, lap 2)', E[3]);
  eng.events();
  console.log('     ' + show(heard));
  check('silence', heard.length === 0, `${heard.length} line(s)`); }

console.log('\n[4] Leclerc, the car ahead, is called in');
{ const { race, eng, heard, E } = scene();
  race.log('flag', 'LECLERC WILL PIT', E[0]);
  eng.events();
  console.log('     ' + show(heard));
  check('no "box box" from HIS engineer on your radio', !heard.some(h => /ENGINEER$/.test(h.who) && h.who !== 'ENGINEER'), '');
  check('your engineer gives you the undercut call', heard.some(h => h.who === 'ENGINEER' && /pitting/i.test(h.text)), ''); }

console.log('\n[5] Norris leaves the road beside you');
{ const { race, eng, heard, E } = scene();
  eng.proximity(race.time);                 // beside you, on the road: watched
  E[2].proj.lat = 9;                        // ...and now off it
  eng.proximity(race.time + 0.5);
  console.log('     ' + show(heard));
  check('his complaint is not on your radio', heard.every(h => onMyRadio(h.who)), `${heard.length} line(s)`);
  check('your engineer tells you the stewards are looking', heard.some(h => /stewards are looking/i.test(h.text)), ''); }

console.log('\n[pure] collisionLines');
console.log('     me   :', collisionLines({ fault: 'me', other: 'NORRIS' }));
console.log('     them :', collisionLines({ fault: 'them', other: 'NORRIS', hitUs: true }));
console.log('     3rd  :', collisionLines({ fault: 'them', other: 'SAINZ', hitUs: false }));

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
