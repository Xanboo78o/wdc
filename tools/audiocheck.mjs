// audiocheck.mjs — does the engine make a sound, and does it make the RIGHT
// one, without anybody having to hear it?
//
//   node tools/audiocheck.mjs
//   node tools/audiocheck.mjs --break     prove the gate can fail
//
// WHY THIS EXISTS. Three audio bugs shipped in one evening and not one of them
// was catchable by anything in this repo:
//
//   * `wob` was read nine lines before it was declared — a temporal dead zone
//     ReferenceError thrown on EVERY FRAME, which kills all audio outright.
//     Twice, in two different files, the same shape.
//   * main.js passed `volume: 0.5` unconditionally, which silently beat
//     MIX.master in audio.js, so raising the shipped volume did nothing.
//   * the engine's lowpass closed to 500 Hz at zero throttle, which was fine
//     until a low shelf went under it and turned idle into a shapeless rumble.
//
// tools/shot.mjs cannot see any of these, and the reason is structural rather
// than an oversight: an AudioContext only starts from a real user gesture, so
// in a headless load `update()` is NEVER CALLED. The page loads clean, reports
// no console errors, and the audio is dead. A gate that only loads the page is
// blind to the entire file by construction.
//
// So this does not load a page. js/audio.js imports nothing — not three, not
// the simulation, nothing — which is exactly what makes it testable here: stub
// an AudioContext, drive `update()` through the states a lap actually contains,
// and read the gains back as numbers.
//
// WHAT IT CANNOT DO, and it is the whole point of it: this proves the engine
// is AUDIBLE and that its numbers move the right way. It cannot tell you it
// sounds good. Nothing here replaces Adam on sound.html — see its header.
import { Engine, MIX } from '../js/audio.js';

const argv = process.argv.slice(2);
const BREAK = argv.includes('--break');
for (const a of argv) if (a !== '--break') { console.error(`unknown flag ${a}`); process.exit(2); }

// --- the smallest AudioContext that audio.js can be wired into --------------
const param = v => ({ value: v });
const node = (extra = {}) => ({
  connect() {}, disconnect() {},
  ...extra,
});
class FakeCtx {
  constructor() { this.currentTime = 0; this.destination = node(); }
  createGain() { return node({ gain: param(1) }); }
  createBiquadFilter() { return node({ type: '', frequency: param(350), Q: param(1), gain: param(0) }); }
  createDynamicsCompressor() {
    return node({ threshold: param(-24), ratio: param(12), knee: param(30), attack: param(0.003), release: param(0.25) });
  }
  createBufferSource() { return node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {} }); }
  createMediaStreamDestination() { return node({ stream: {} }); }
  decodeAudioData() { return Promise.resolve({ duration: 0.7 }); }
  close() {}
}
globalThis.window = { AudioContext: FakeCtx };
globalThis.AudioContext = FakeCtx;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

const eng = new Engine({});
if (BREAK) {
  // The exact bug that shipped twice: something in update()'s path throws.
  // A gate nobody has watched fail is not a gate.
  eng.mix = new Proxy(eng.mix, { get(t, k) { if (k === 'sub') throw new ReferenceError("Cannot access 'wob' before initialization"); return t[k]; } });
}
if (!await eng.start('./')) { console.log('FAIL  start() returned false: ' + (eng.err || 'no reason given')); process.exit(1); }

// --- the states a lap actually contains -------------------------------------
// rpm, throttle, and what the car is doing. peak is a typical F1 peakSlip.
const PEAK = 0.13;
const CASES = [
  ['stopped, idling', { rpm: 4000, thr: 0, speed: 0, slip: 0, off: 0 }],
  ['pulling away', { rpm: 6000, thr: 0.6, speed: 12, slip: 0.02, off: 0 }],
  ['flat out in 8th', { rpm: 14500, thr: 1, speed: 89, slip: 0.01, off: 0 }],
  ['COASTING at 12k', { rpm: 12000, thr: 0, speed: 72, slip: 0.02, off: 0 }],
  ['braking, sliding', { rpm: 9000, thr: 0, speed: 60, slip: 0.19, off: 0 }],
  ['off on the grass', { rpm: 8000, thr: 0.4, speed: 30, slip: 0.30, off: 1 }],
];

let fails = 0;
const fail = m => { fails++; console.log('FAIL  ' + m); };
const read = () => ({
  eng: eng.engine.gain.gain.value,
  rate: eng.engine.src.playbackRate.value,
  cut: eng.engine.filt.frequency.value,
  sub: eng.sub ? eng.sub.gain.gain.value : 0,
  shake: eng.shakeGain ? eng.shakeGain.gain.value : 0,
  tyre: eng.tyre ? eng.tyre.gain.gain.value : 0,
  road: eng.road ? eng.road.gain.gain.value : 0,
});

const got = {};
console.log(`\nmaster ${eng.master}   ref ${eng.ref}\n`);
console.log('state                 engine    rate   cutoff      sub    shake     tyre');
for (const [name, c] of CASES) {
  let r;
  try {
    eng.ctx.currentTime += 0.016;
    eng.update(c.rpm, c.thr, { off: c.off, speed: c.speed, slip: c.slip, peak: PEAK });
    r = read();
  } catch (e) {
    fail(`${name}: update() THREW — ${e.message}`);
    continue;
  }
  got[name] = r;
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isFinite(v)) fail(`${name}: ${k} is ${v}`);
    if (v < 0) fail(`${name}: ${k} is negative (${v})`);
  }
  console.log(`  ${name.padEnd(20)} ${r.eng.toFixed(3).padStart(6)} ${r.rate.toFixed(3).padStart(7)} ` +
    `${Math.round(r.cut).toString().padStart(7)} ${r.sub.toFixed(3).padStart(8)} ${r.shake.toFixed(3).padStart(8)} ${r.tyre.toFixed(3).padStart(8)}`);
}

console.log('');
const G = n => got[n] || {};
// 1. THE ENGINE IS NEVER SILENT. The one sound this game cannot be played
//    without, and the failure mode is total rather than subtle.
for (const [name] of CASES) {
  const g = G(name);
  if (g.eng !== undefined && g.eng < 0.02) fail(`the engine is inaudible while ${name} (gain ${g.eng})`);
}
// 2. COASTING IS NOT IDLING. Adam: "and coasting remember". An engine on the
//    overrun at 12,000 rpm is one of the loudest things a race car does; when
//    the off-throttle floor was flat it was exactly as quiet as a stopped car.
if (G('COASTING at 12k').eng <= G('stopped, idling').eng * 1.4) {
  fail(`coasting at 12,000 rpm is no louder than idling (${G('COASTING at 12k').eng?.toFixed(3)} vs ${G('stopped, idling').eng?.toFixed(3)})`);
}
// 3. And it has an EDGE that an idle has not.
if (G('COASTING at 12k').cut <= G('stopped, idling').cut) {
  fail('coasting is no brighter than idling — the filter cannot tell revs from throttle');
}
// 4. Throttle still wins over revs.
if (G('flat out in 8th').eng <= G('COASTING at 12k').eng) {
  fail('full throttle is not louder than the overrun');
}
// 5. Idle keeps a NOTE rather than becoming a rumble under the bass shelf.
if (G('stopped, idling').cut < 900) {
  fail(`idle closes the filter to ${Math.round(G('stopped, idling').cut)} Hz — with a shelf under it that is a rumble, not an engine`);
}
// 6. Grass WOBBLES. A constant is not a wobble, so drive it over time and
//    require the rate to actually move.
// EVERY update() call goes through this. The first version wrapped only the
// table above, so --break threw out of the wobble loop and the tool CRASHED
// instead of reporting a failure — which is a worse gate than none, because a
// stack trace in CI reads as "the tool is broken" rather than "the code is".
const drive = (label, rpm, thr, opt) => {
  try { eng.ctx.currentTime += 0.016; eng.update(rpm, thr, opt); return true; }
  catch (e) { fail(`${label}: update() THREW — ${e.message}`); return false; }
};

const rates = [];
for (let i = 0; i < 40; i++) {
  if (!drive('on grass', 8000, 0.4, { off: 1, speed: 30, slip: 0.3, peak: PEAK })) break;
  rates.push(eng.engine.src.playbackRate.value);
}
if (rates.length) {
  const spread = Math.max(...rates) - Math.min(...rates);
  if (spread < 0.004) fail(`on grass the rate moves by ${spread.toFixed(5)} — that is not a wobble`);
  else console.log(`ok    grass wobbles the rate by ${(spread * 100).toFixed(1)}% of nominal`);
}

// 7. Tyres stay silent below the threshold and speak above it.
if (drive('under the threshold', 9000, 0, { speed: 60, slip: PEAK * 0.05, peak: PEAK })) {
  if (eng.tyre && eng.tyre.gain.gain.value > 0.001) fail('tyres are audible at 5% of the limit');
}
if (drive('over the threshold', 9000, 0, { speed: 60, slip: PEAK * 1.4, peak: PEAK })) {
  const loud = eng.tyre ? eng.tyre.gain.gain.value : 0;
  if (MIX.tyreLvl > 0 && loud < 0.01) fail('tyres are silent at 140% of the limit');
  console.log(`ok    tyres: silent under the threshold, ${loud.toFixed(3)} over it (MIX.tyreLvl ${MIX.tyreLvl})`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nthe engine is audible in every state a lap contains');
process.exit(fails ? 1 : 0);
