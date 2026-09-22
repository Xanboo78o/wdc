// padcheck.mjs — the wheel mapping, against every convention a wheel might use.
//
//   node tools/padcheck.mjs
//   node tools/padcheck.mjs --break     prove the gate can fail
//
// WHAT THIS CAN AND CANNOT PROVE. There is no wheel on this machine, so
// nothing here says the device feels right, that force feedback works, or that
// Chromium sees it at all. What it does prove is the half where the bugs
// actually live: the arithmetic that turns a manufacturer's raw axis into a
// steering angle and two pedals.
//
// That arithmetic has to survive conventions that genuinely differ between
// wheels and cannot be guessed from a device name:
//
//   - steering that runs POSITIVE left on one wheel and NEGATIVE left on the
//     next, with no way to tell which from the id string
//   - a wheel resting somewhere other than zero, because it has not been
//     re-centred since power-on — assume zero and the car pulls to one side
//     for the whole race
//   - pedals that rest at +1 and travel to -1, which most wheels do and which
//     is the exact opposite of what every pad-shaped code path expects. Read
//     one of those as though it rested at 0 and the car brakes fully while
//     stationary.
//
// Each case below is one of those, run through the SAME `Hands._readWheel` the
// game uses, not a copy of it.
import { Hands } from '../js/input.js';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--break', '--help']);
for (const a of argv) if (!KNOWN.has(a)) { console.error(`padcheck: unknown flag ${a}`); process.exit(2); }
if (argv.includes('--help')) { console.log('node tools/padcheck.mjs [--break]'); process.exit(0); }
const BREAK = argv.includes('--break');

const hands = new Hands();

// A stand-in gamepad: just enough of the shape that _readWheel reads.
const pad = (axes) => ({ id: 'test', connected: true, axes, buttons: [], mapping: '' });

// Under --break, centre is ignored and the pedals are read as though they
// rested at zero — the two mistakes this gate exists to catch.
function read(p, prof) {
  if (!BREAK) return hands._readWheel(p, prof);
  const s = prof.steer;
  const raw = p.axes[s.ax] || 0;
  const steer = Math.max(-1, Math.min(1, raw));
  const ped = d => Math.max(0, Math.min(1, p.axes[d.ax] || 0));
  const throttle = ped(prof.throttle), brake = ped(prof.brake);
  return { steer, throttle, brake, live: true };
}

const CASES = [
  {
    name: 'ordinary wheel, pedals rest at -1',
    prof: {
      steer: { ax: 0, centre: 0, left: 1, right: -1 },
      throttle: { ax: 2, rest: -1, full: 1 },
      brake: { ax: 3, rest: -1, full: 1 },
    },
    checks: [
      ['centre, feet off',       [0, 0, -1, -1],    { steer: 0, throttle: 0, brake: 0 }],
      ['full left',              [1, 0, -1, -1],    { steer: 1 }],
      ['full right',             [-1, 0, -1, -1],   { steer: -1 }],
      ['half left',              [0.5, 0, -1, -1],  { steer: 0.5 }],
      ['throttle half',          [0, 0, 0, -1],     { throttle: 0.5, brake: 0 }],
      ['brake full',             [0, 0, -1, 1],     { brake: 1, throttle: 0 }],
    ],
  },
  {
    name: 'INVERTED steering — full left reads negative',
    prof: {
      steer: { ax: 0, centre: 0, left: -1, right: 1 },
      throttle: { ax: 2, rest: -1, full: 1 },
      brake: { ax: 3, rest: -1, full: 1 },
    },
    checks: [
      ['full left is still +1',  [-1, 0, -1, -1],   { steer: 1 }],
      ['full right is still -1', [1, 0, -1, -1],    { steer: -1 }],
      ['half left',              [-0.5, 0, -1, -1], { steer: 0.5 }],
    ],
  },
  {
    name: 'wheel resting off centre at +0.20',
    prof: {
      steer: { ax: 0, centre: 0.2, left: 1, right: -1 },
      throttle: { ax: 2, rest: -1, full: 1 },
      brake: { ax: 3, rest: -1, full: 1 },
    },
    checks: [
      ['at rest the car goes straight', [0.2, 0, -1, -1], { steer: 0 }],
      ['full left',                     [1, 0, -1, -1],   { steer: 1 }],
      ['full right',                    [-1, 0, -1, -1],  { steer: -1 }],
    ],
  },
  {
    name: 'PEDALS REST AT +1 and travel to -1 (what most wheels do)',
    prof: {
      steer: { ax: 0, centre: 0, left: 1, right: -1 },
      throttle: { ax: 1, rest: 1, full: -1 },
      brake: { ax: 5, rest: 1, full: -1 },
    },
    checks: [
      ['feet off means NO brake', [0, 1, 0, 0, 0, 1], { throttle: 0, brake: 0 }],
      ['throttle full',           [0, -1, 0, 0, 0, 1], { throttle: 1, brake: 0 }],
      ['brake half',              [0, 1, 0, 0, 0, 0],  { brake: 0.5, throttle: 0 }],
    ],
  },
  {
    name: 'overtravel is clamped, not wrapped',
    prof: {
      steer: { ax: 0, centre: 0, left: 0.8, right: -0.8 },
      throttle: { ax: 2, rest: -0.9, full: 0.9 },
      brake: { ax: 3, rest: -0.9, full: 0.9 },
    },
    checks: [
      ['past full left',  [1, 0, -0.9, -0.9],  { steer: 1 }],
      ['past full right', [-1, 0, -0.9, -0.9], { steer: -1 }],
      ['pedal past full', [0, 0, 1, -0.9],     { throttle: 1 }],
    ],
  },
];

const EPS = 0.02;
let fails = 0, total = 0;
for (const c of CASES) {
  console.log(`\n\x1b[1m${c.name}\x1b[0m`);
  for (const [what, axes, want] of c.checks) {
    const got = read(pad(axes), c.prof);
    const bad = [];
    for (const k of Object.keys(want)) if (Math.abs(got[k] - want[k]) > EPS) bad.push(`${k} ${got[k].toFixed(3)} want ${want[k]}`);
    total++;
    if (bad.length) { fails++; console.log(`  \x1b[31mFAIL\x1b[0m ${what.padEnd(30)} ${bad.join('; ')}`); }
    else console.log(`  ok   ${what.padEnd(30)} steer ${got.steer.toFixed(2)}  thr ${got.throttle.toFixed(2)}  brk ${got.brake.toFixed(2)}`);
  }
}

console.log('');
if (BREAK) {
  if (fails) { console.log(`\x1b[32m--break worked: ${fails} of ${total} checks failed, so the gate can fail.\x1b[0m`); process.exit(0); }
  console.log('\x1b[31m--break FAILED TO BREAK ANYTHING. A gate you have never watched fail is not a gate.\x1b[0m');
  process.exit(1);
}
if (fails) { console.log(`\x1b[31m${fails} of ${total} checks failed\x1b[0m`); process.exit(1); }
console.log(`\x1b[32mall ${total} checks pass across ${CASES.length} wheel conventions\x1b[0m`);
