// character.mjs — what a circuit ASKS of a driver, measured.
//
// Adam, 2026-09-21: "I want AWESOME track design, all tracks have clear
// personality, like 'Fast paced' 'Tight and technical' 'Fun for multiplayer'."
//
// Those are adjectives, and an adjective cannot be designed to. You cannot lay
// a corner that is nineteen percent more "technical". So this tool turns each
// of them into a measured quantity, prints the numbers behind it, and only
// then says the word — so that when a track does not feel the way it was meant
// to, the disagreement is visible rather than a matter of taste.
//
//   node tools/character.mjs                 every circuit, and the megatrack
//   node tools/character.mjs monza suzuka    named ones
//   node tools/character.mjs --class f4      measured for a different car
//   node tools/character.mjs --trace         print the speed trace as well
//
// THE INSTRUMENT HAS PROPERTIES, so they are stated here rather than buried:
//
// 1. Everything is measured ON THE RACING LINE at FULL grip. A circuit's
//    character is what it asks of a driver who is trying, not the average of
//    everyone who drives it. `line.js` already solves that line and its
//    brake-limited speed profile, so this tool re-derives nothing.
//
// 2. A corner is A RUN OF CURVATURE, never the `corners` array in the track
//    file. The hand-built megatrack has no such array, and the baked circuits'
//    entries came from a different derivation on a different day. One
//    instrument, or the numbers cannot be compared — which is the whole point
//    of having them.
//
// 3. There is NO elevation in a baked circuit file (the real circuits carry
//    their height in the renderer's ground, not in the track model), so the
//    climb figure is printed only for the megatrack, which has real `z`.
//    A missing number is printed as missing; it is never quietly a zero.
import fs from 'fs';
import { Track } from '../js/track.js';
import { buildLines } from '../js/line.js';
import { CARS } from '../js/physics.js';
import { buildPath, trackData } from '../js/build/path.js';

// --- the vocabulary, in numbers ---------------------------------------------
// Every threshold that turns a measurement into a word lives here. Change one
// and the whole vocabulary shifts with it, which is the point: these are a
// design opinion, and a design opinion belongs somewhere you can find it.
const SLOW_KMH      = 130;   // at or below this a corner is SLOW
const FAST_KMH      = 210;   // at or above this it is FAST
const KINK_FRAC     = 0.97;  // above this share of top speed it is not a corner
const CORNER_R      = 400;   // m: tighter than this and the road is turning
const MERGE_GAP     = 30;    // m of straight that does not separate two corners
const STRAIGHT_MIN  = 350;   // m: long enough to matter for a tow
const BRAKE_DROP    = 60;    // km/h lost: a braking event
const BIG_DROP      = 110;   // km/h lost: a braking event worth diving into
const OVERTAKE_RUN  = 300;   // m of approach an overtaking spot needs

// Character tests. Each is a name, a predicate over the measured profile, and
// the sentence that says WHY it fired — because a label without its reason is
// exactly the adjective we were trying to get rid of.
const TESTS = [
  ['FAST PACED', p => p.vAvg >= 200,
    p => `averages ${p.vAvg.toFixed(0)} km/h over the lap`],
  // 2.2 corners a kilometre was the first bar and it was far too generous:
  // MONZA cleared it in an F4, purely because the slower car dragged the lap
  // average under 175. Monza is the least technical circuit in the world. The
  // density of corners is a fact about the ROAD and must carry the test on its
  // own; the speed clause only decides whether the road is also slow.
  ['TIGHT AND TECHNICAL', p => p.cornersPerKm >= 5.0 && p.vAvg < 175,
    p => `${p.cornersPerKm.toFixed(1)} corners a kilometre at ${p.vAvg.toFixed(0)} km/h average`],
  ['FLOWING', p => p.changesPerKm >= 2.0 && p.brakeFrac < 0.18,
    p => `${p.changesPerKm.toFixed(1)} changes of direction a kilometre, braking only ${(p.brakeFrac * 100).toFixed(0)}% of it`],
  ['STOP-START', p => p.brakeFrac >= 0.25,
    p => `on the brakes for ${(p.brakeFrac * 100).toFixed(0)}% of the lap`],
  ['HIGH COMMITMENT', p => p.corners && p.fast / p.corners >= 0.35,
    p => `${p.fast} of ${p.corners} corners are taken above ${FAST_KMH} km/h`],
  ['GREAT FOR RACING', p => p.overtaking >= 3,
    p => `${p.overtaking} heavy braking zones with a real run at them`],
  ['PROCESSIONAL', p => p.overtaking <= 1,
    p => `only ${p.overtaking} place on the lap to line somebody up`],
  ['PUNISHING', p => p.slow >= 5 && p.longest < 700,
    p => `${p.slow} slow corners and nothing longer than ${p.longest.toFixed(0)} m to recover on`],
];

// ---------------------------------------------------------------------------

function loadBaked(key) {
  const file = new URL(`../data/tracks/${key}.json`, import.meta.url);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The five surveyed circuits carry no height — theirs lives in the
  // renderer's ground. A circuit imported from a model does carry it, and
  // that is usually the most interesting thing about it, so read it if it
  // is there and say so honestly when it is not.
  return { track: new Track(d), z: d.z || null, name: d.full || d.name || key };
}

async function loadMega() {
  const { PIECES, TRACK_NAME } = await import('../data/build/pieces.js');
  const path = buildPath(PIECES, { closed: false });
  const d = trackData(path, TRACK_NAME || 'The megatrack');
  d.open = true;                       // point-to-point until its ends are joined
  return { track: new Track(d), z: path.z, name: d.name };
}

// Runs of curvature. `k` is signed, so a sign change inside a run would be two
// corners pretending to be one; the sign is carried and a flip closes the run.
function cornerRuns(track, v, vMax) {
  const n = track.n, ds = track.ds, kMin = 1 / CORNER_R;
  const runs = [];
  let run = null;
  const closed = !track.open;
  for (let j = 0; j < n; j++) {
    const i = j % n;
    const k = track.curv[i];
    const turning = Math.abs(k) >= kMin;
    const dir = Math.sign(k);
    if (turning && run && run.dir === dir) { run.to = j; }
    else if (turning) { if (run) runs.push(run); run = { from: j, to: j, dir }; }
    else if (run && (j - run.to) * ds > MERGE_GAP) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);

  // A closed lap's first and last run may be the same corner cut by the start
  // line. Monza's Parabolica is exactly this. Join them, or the count is one
  // too high and the start/finish straight is reported twice as long as it is.
  if (closed && runs.length > 1) {
    const a = runs[0], b = runs[runs.length - 1];
    if (a.dir === b.dir && a.from === 0 && (n - 1 - b.to) * ds <= MERGE_GAP) {
      b.to = a.to + n; runs.shift();
    }
  }

  for (const r of runs) {
    let vmin = Infinity, turn = 0;
    for (let j = r.from; j <= r.to; j++) {
      const i = ((j % n) + n) % n;
      if (v[i] < vmin) vmin = v[i];
      turn += Math.abs(track.curv[i]) * ds;
    }
    r.vmin = vmin * 3.6;
    r.turn = turn * 180 / Math.PI;
    r.len = (r.to - r.from + 1) * ds;
    r.kink = r.vmin > vMax * 3.6 * KINK_FRAC;
  }
  return runs;
}

function profile(track, v, z) {
  const n = track.n, ds = track.ds;
  let vMax = 0, vMin = Infinity, lapT = 0;
  for (let i = 0; i < n; i++) {
    if (v[i] > vMax) vMax = v[i];
    if (v[i] < vMin) vMin = v[i];
    lapT += ds / Math.max(v[i], 5);
  }
  const length = n * ds;

  // On the brakes = the profile is falling. It is brake-limited by
  // construction (line.js solves it backwards from every corner), so a falling
  // profile IS a brake application; nothing needs re-deriving.
  let braking = 0;
  for (let i = 0; i < n; i++) {
    const nx = track.open ? Math.min(i + 1, n - 1) : (i + 1) % n;
    if (v[nx] < v[i] - 0.05) braking += ds;
  }

  const runs = cornerRuns(track, v, vMax);
  const real = runs.filter(r => !r.kink);
  const slow = real.filter(r => r.vmin <= SLOW_KMH).length;
  const fast = real.filter(r => r.vmin >= FAST_KMH).length;

  // Straights are the gaps between real corners, measured along the line.
  const straights = [];
  for (let a = 0; a < real.length; a++) {
    const b = (a + 1) % real.length;
    if (!track.open && real.length > 1) {
      let gap = (real[b].from - real[a].to) * ds;
      if (gap < 0) gap += length;
      straights.push(gap);
    } else if (b > a) straights.push((real[b].from - real[a].to) * ds);
  }
  const longest = straights.length ? Math.max(...straights) : length;

  // Changes of direction: a corner that turns the other way from the one
  // before it. This is rhythm, and it is what "technical" actually means.
  let changes = 0;
  for (let a = 1; a < real.length; a++) if (real[a].dir !== real[a - 1].dir) changes++;
  if (!track.open && real.length > 2 && real[0].dir !== real[real.length - 1].dir) changes++;

  // An overtaking spot is a big deceleration WITH a run at it. A heavy brake
  // at the end of a short link is not a passing place, it is a hazard.
  //
  // THE ENTRY SPEED IS THE FASTEST POINT ON THE APPROACH, not the previous
  // corner's minimum. Measured the other way first, and it understated every
  // braking zone that has a straight in front of it — which is every braking
  // zone worth having. Monza's first chicane came out as a smaller event than
  // a corner reached from a hairpin, and one case went NEGATIVE: the car is
  // quicker at the next apex than it was at the last one, so "speed lost"
  // read as speed gained. The number a driver feels is top-of-the-straight
  // minus apex, so that is the number.
  let events = 0, overtaking = 0;
  for (let a = 0; a < real.length; a++) {
    const prev = a === 0 ? (track.open ? null : real[real.length - 1]) : real[a - 1];
    let run = length, peak = vMax;
    if (prev) {
      run = (real[a].from - prev.to) * ds;
      if (run < 0) run += length;
      peak = 0;
      for (let j = prev.to; j <= prev.to + Math.round(run / ds); j++) {
        const i = ((j % n) + n) % n;
        if (v[i] > peak) peak = v[i];
      }
    }
    const drop = peak * 3.6 - real[a].vmin;
    if (drop >= BRAKE_DROP) events++;
    if (drop >= BIG_DROP && run >= OVERTAKE_RUN) overtaking++;
  }

  let climb = null;
  if (z) {
    let lo = Infinity, hi = -Infinity, up = 0;
    for (let i = 0; i < z.length; i++) { if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
    for (let i = 1; i < z.length; i++) if (z[i] > z[i - 1]) up += z[i] - z[i - 1];
    climb = { range: hi - lo, up };
  }

  return {
    length, lapT, vMax: vMax * 3.6, vMin: vMin * 3.6,
    vAvg: (length / lapT) * 3.6,
    brakeFrac: braking / length,
    corners: real.length, kinks: runs.length - real.length,
    slow, medium: real.length - slow - fast, fast,
    cornersPerKm: real.length / (length / 1000),
    changesPerKm: changes / (length / 1000),
    longest, events, overtaking, climb, runs: real, v,
  };
}

function trace(track, v, vMax, width = 72) {
  // The speed trace as a lap-shaped bar. A photograph of the profile: you can
  // see a long straight, a chicane and an unwinding sweep by their shape here
  // without reading a single number.
  const ramp = ' .:-=+*#%@';
  let out = '';
  for (let c = 0; c < width; c++) {
    const i = Math.floor(c * track.n / width);
    const f = v[i] / vMax;
    out += ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(f * (ramp.length - 1))))];
  }
  return out;
}

function report(name, p, showTrace, track) {
  const bar = (n, ch) => ch.repeat(Math.max(0, Math.min(40, n)));
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  console.log(`  ${(p.length / 1000).toFixed(3)} km   ideal lap ${Math.floor(p.lapT / 60)}:${(p.lapT % 60).toFixed(3).padStart(6, '0')}`);
  console.log(`  speed        avg ${p.vAvg.toFixed(0)}   top ${p.vMax.toFixed(0)}   slowest ${p.vMin.toFixed(0)} km/h`);
  console.log(`  on the brakes ${(p.brakeFrac * 100).toFixed(0)}% of the lap`);
  console.log(`  corners      ${p.corners}  (${p.slow} slow  ${p.medium} medium  ${p.fast} fast)  + ${p.kinks} flat-out kinks`);
  console.log(`               ${p.cornersPerKm.toFixed(2)}/km, ${p.changesPerKm.toFixed(2)} changes of direction/km`);
  console.log(`  longest run  ${p.longest.toFixed(0)} m`);
  console.log(`  braking      ${p.events} events, ${p.overtaking} of them a passing place`);
  if (p.climb) console.log(`  elevation    ${p.climb.range.toFixed(1)} m range, ${p.climb.up.toFixed(0)} m climbed a lap`);
  else console.log(`  elevation    not in the track model (renderer holds it)`);
  if (showTrace) console.log(`  speed        |${trace(track, p.v, p.vMax / 3.6)}|`);

  const fired = TESTS.filter(([, test]) => test(p));
  console.log(`  \x1b[1mCHARACTER\x1b[0m    ${fired.length ? fired.map(f => f[0]).join(' · ') : '— no strong character —'}`);
  for (const [nm, , why] of fired) console.log(`               ${nm.toLowerCase()}: ${why(p)}`);
  if (!fired.length) console.log(`               nothing measured strongly enough to name. That is the finding.`);
}

// --- arguments, strictly ----------------------------------------------------
// A dropped flag returns a plausible wrong number with an explanation attached,
// so an unknown flag is an error here, never a shrug.
const argv = process.argv.slice(2);
const KNOWN = new Set(['--class', '--trace', '--help']);
let cls = 'f1', showTrace = false;
const want = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    if (!KNOWN.has(a)) { console.error(`character.mjs: unknown flag ${a}`); process.exit(2); }
    if (a === '--help') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 33).join('\n')); process.exit(0); }
    if (a === '--trace') showTrace = true;
    if (a === '--class') {
      cls = argv[++i];
      if (!CARS[cls]) { console.error(`character.mjs: no car class "${cls}" — have ${Object.keys(CARS).join(', ')}`); process.exit(2); }
    }
  } else want.push(a);
}

const dir = new URL('../data/tracks/', import.meta.url);
const baked = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
  .filter(k => !/^fold|^test$/.test(k));          // the fold rigs are not circuits
const list = want.length ? want : [...baked, 'mega'];

console.log(`\x1b[2mmeasured on the racing line, ${cls.toUpperCase()}, at full grip\x1b[0m`);
for (const key of list) {
  let loaded;
  try {
    loaded = key === 'mega' ? await loadMega() : loadBaked(key);
  } catch (e) {
    console.error(`\n${key}: could not load — ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  const { track, z, name } = loaded;
  const lines = buildLines(track, CARS[cls]);
  report(name, profile(track, lines.race.v, z), showTrace, track);
}
console.log('');
