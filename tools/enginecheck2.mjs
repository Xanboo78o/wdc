// enginecheck2.mjs — render js/enginecore.js in Node and write WAVs, so the
// engine can be MEASURED against real F1 recordings (nobody here can hear).
//
//   node tools/enginecheck2.mjs [outdir]
// writes steady-state clips (rpm x throttle) and a full-throttle sweep.
import fs from 'fs';
import { EngineCore } from '../js/enginecore.js';
const out = process.argv[2] || '/tmp';
const sr = 44100;
function wav(file, x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(x[i] / (peak || 1) * 0.9 * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
  return peak;
}
function run(states, secs) {
  const e = new EngineCore(sr);
  const x = new Float32Array(Math.round(sr * secs)), blk = 128;
  for (let i = 0; i < x.length; i += blk) {
    const t = i / sr; e.set(states(t));
    e.render(x.subarray(i, Math.min(x.length, i + blk)));
  }
  return x;
}
for (const [name, rpm, thr] of [['full18k', 18000, 1], ['full12k', 12000, 1], ['full8k', 8000, 1], ['lift15k', 15000, 0]]) {
  const x = run(() => ({ rpm, throttle: thr, gain: 1, speed: 60 }), 3.0);
  console.log(name, 'peak', wav(`${out}/${name}.wav`, x.subarray(sr)).toFixed(2));
}
const sw = run(t => ({ rpm: 6000 + Math.min(1, t / 5) * 13000, throttle: 1, gain: 1, speed: 60 }), 6);
wav(`${out}/sweep.wav`, sw);
console.log('sweep written');
