// enginecheck.mjs — my ears, such as they are.
//
// I cannot hear these files. What I CAN do is measure the two things that
// decide whether a loop is usable as an engine at all, neither of which is a
// matter of taste:
//
//   1. WHAT RPM IS IT? An engine loop's fundamental is its firing rate. That
//      number decides which sample covers which part of the rev range, and how
//      far each one has to be stretched. Guessing it is how you end up playing
//      a sample four octaves from where it was recorded, which is what made the
//      first two attempts at this sound like garbage.
//   2. DOES IT CLOSE? A loop whose last sample does not meet its first clicks
//      once per repetition, and at 300+ repetitions a second that click IS a
//      tone sitting at the engine's own pitch — so it hides inside the sound
//      and gets reported as "sounds a bit rough" rather than as a fault.
//
// Deliberately NOT here: any judgement about whether a loop sounds good. There
// is no number for that and I have no instrument for it. This says "defective
// or not", and Adam says "right one or not".
//
//   node tools/enginecheck.mjs [dir]
import fs from 'fs';
import path from 'path';

// Minimal RIFF/WAVE reader: 16/24/32-bit PCM and 32-bit float, any channels.
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('not a RIFF/WAVE file');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2),
              rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  const { channels, bits, format } = fmt;
  const bytes = bits >> 3;
  const n = Math.floor(data.length / bytes / channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = (i * channels + c) * bytes;
      let v;
      if (format === 3 && bits === 32) v = data.readFloatLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = ((data[o] | (data[o+1] << 8) | (data[o+2] << 16) << 8 >> 8)) / 8388608;
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (data[o] - 128) / 128;
      else throw new Error(`unsupported ${bits}-bit format ${format}`);
      acc += v;
    }
    out[i] = acc / channels;                   // mono sum: engines are not stereo events
  }
  return { ...fmt, samples: out, frames: n };
}

// Fundamental by autocorrelation. Robust on something as harmonically dense as
// an engine, where a peak-picking FFT will happily lock onto the 3rd harmonic.
function fundamental(a, rate, loHz = 25, hiHz = 1200) {
  const N = Math.min(a.length, rate);                 // at most a second
  const lagMin = Math.floor(rate / hiHz), lagMax = Math.floor(rate / loHz);
  if (lagMax >= N) return null;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += a[i];
  mean /= N;
  let energy = 0;
  for (let i = 0; i < N; i++) { const d = a[i] - mean; energy += d * d; }
  if (energy <= 0) return null;
  // Take the whole curve first. Picking the GLOBAL maximum is the classic
  // autocorrelation trap and it caught me here: on something as harmonically
  // dense as an engine, a short lag sitting on the 8th harmonic decorrelates
  // less than the true period does, so the maximum lands on a harmonic. It
  // reported 1225.0 Hz for five different recordings — identical to 0.1 Hz,
  // which is the giveaway, and 24,500 rpm for a V6, which is impossible.
  const r = new Float64Array(lagMax + 1);
  let best = -2, bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += (a[i] - mean) * (a[i + lag] - mean);
    // normalise by the overlap, or long lags are penalised for being long
    r[lag] = s / energy * (N / (N - lag));
    if (r[lag] > best) { best = r[lag]; bestLag = lag; }
  }
  // Sub-harmonic correction: walk out to the LONGEST period that still
  // correlates nearly as well. A true fundamental's multiples all correlate;
  // the lowest one that does is the fundamental.
  const TH = 0.86 * best;
  let lag = bestLag;
  for (let k = 2; k <= 16; k++) {
    const cand = bestLag * k;
    if (cand > lagMax) break;
    // allow a little jitter either side, since periods are not integers
    let localBest = -2, localLag = 0;
    for (let d = -2; d <= 2; d++) {
      const L = cand + d;
      if (L < lagMin || L > lagMax) continue;
      if (r[L] > localBest) { localBest = r[L]; localLag = L; }
    }
    if (localBest >= TH) lag = localLag;
  }
  return lag ? { hz: rate / lag, confidence: r[lag], harmonicOf: lag !== bestLag ? rate / bestLag : null } : null;
}

// The defect itself, in the time domain. The spectral version of this test was
// tried and thrown away: a repeating discontinuity is a harmonic comb, not a
// spike, and when the loop is one firing cycle that comb lands exactly on the
// engine's own harmonics. Measured on-harmonic energy was identical for a
// clean loop and a hard-clicked one, so it detects nothing.
function closure(a) {
  let step = 0;
  for (let i = 1; i < a.length; i++) step += Math.abs(a[i] - a[i - 1]);
  step /= a.length - 1;
  let rms = 0;
  for (let i = 0; i < a.length; i++) rms += a[i] * a[i];
  rms = Math.sqrt(rms / a.length);
  const jump = Math.abs(a[0] - a[a.length - 1]);
  let dc = 0;
  for (let i = 0; i < a.length; i++) dc += a[i];
  dc /= a.length;
  return { jump, rms, step, ratio: step > 0 ? jump / step : 0, dc };
}

// Firing rate -> rpm, for a four-stroke: firings per rev = cylinders / 2.
const rpmFor = (hz, cyl) => hz * 60 / (cyl / 2);

const dir = process.argv[2] || new URL('../data/audio/', import.meta.url).pathname;
const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.wav')).sort();
if (!files.length) { console.log('no .wav files in', dir); process.exit(1); }

console.log(`engine loops in ${dir}\n`);
console.log('file            rate  chans  bits   length   fundamental  conf    as V6 rpm   as V8 rpm   loop closure');
const rows = [];
for (const f of files) {
  let w;
  try { w = readWav(fs.readFileSync(path.join(dir, f))); }
  catch (e) { console.log(`${f.padEnd(15)} UNREADABLE: ${e.message}`); continue; }
  const fund = fundamental(w.samples, w.rate);
  const c = closure(w.samples);
  const secs = w.frames / w.rate;
  const clean = c.ratio < 6;
  rows.push({ f, hz: fund?.hz, secs });
  console.log(
    `${f.padEnd(15)} ${String(w.rate).padStart(5)} ${String(w.channels).padStart(5)} ` +
    `${String(w.bits).padStart(5)} ${secs.toFixed(3).padStart(8)}s ` +
    `${(fund ? fund.hz.toFixed(1) + ' Hz' : '   --   ').padStart(11)} ` +
    `${(fund ? fund.confidence.toFixed(2) : ' -- ').padStart(6)} ` +
    `${(fund ? Math.round(rpmFor(fund.hz, 6)).toLocaleString() : '--').padStart(10)} ` +
    `${(fund ? Math.round(rpmFor(fund.hz, 8)).toLocaleString() : '--').padStart(11)}   ` +
    `${c.ratio.toFixed(2).padStart(6)}x step  ${clean ? 'closed' : 'CLICKS'}` +
    `${Math.abs(c.dc) > 0.02 ? `  DC offset ${c.dc.toFixed(3)}` : ''}`);
}

// How far does each sample have to stretch if they are used as a set? That is
// the number that decided the last two attempts, so it gets printed.
const known = rows.filter(r => r.hz).sort((a, b) => a.hz - b.hz);
if (known.length > 1) {
  console.log('\ncoverage if crossfaded as a set, nearest sample to each target:');
  for (const rpm of [4000, 7000, 10000, 13000, 15000]) {
    const want = rpm * 6 / 2 / 60;
    let best = known[0];
    for (const r of known) if (Math.abs(Math.log2(r.hz / want)) < Math.abs(Math.log2(best.hz / want))) best = r;
    const oct = Math.log2(want / best.hz);
    console.log(`  ${String(rpm).padStart(6)} rpm  ->  ${best.f.padEnd(15)} at ${(2 ** oct).toFixed(2)}x  ` +
      `(${oct >= 0 ? '+' : ''}${oct.toFixed(2)} octaves)${Math.abs(oct) > 1 ? '   <-- too far, will not sound like itself' : ''}`);
  }
}
console.log('\nThis says DEFECTIVE or not, and WHERE each sample sits. It does not say');
console.log('which one sounds right — there is no number for that.');
