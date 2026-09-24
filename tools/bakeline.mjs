// bakeline.mjs — re-solve ONLY the baked racing line of each closed circuit.
//
// The line used to be written by bakereal.mjs / baketrack.mjs along with
// everything else, and re-running those re-fetches surveys and rebuilds the
// whole file. When the solver changes, this rewrites the one field and leaves
// every other byte of data/tracks/<key>.json as it was.
//
//   node tools/bakeline.mjs            # every closed circuit
//   node tools/bakeline.mjs monza suzuka
import fs from 'fs';
import { Track } from '../js/track.js';
import { racingLine } from '../js/line.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
for (const a of args) if (a.startsWith('--')) { console.error(`bakeline: unknown flag ${a}`); process.exit(2); }
const keys = args.length ? args
  : fs.readdirSync(ROOT + 'data/tracks').filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
for (const key of keys) {
  const file = `${ROOT}data/tracks/${key}.json`;
  const text = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(text);
  if (json.open) { console.log(`${key.padEnd(12)} open circuit — skipped`); continue; }
  if (!Array.isArray(json.line)) { console.log(`${key.padEnd(12)} no baked line — skipped`); continue; }
  const off = Array.from(racingLine(new Track(json), 0.35), v => +v.toFixed(2));
  const m = text.match(/"line":\[[^\]]*\]/g);
  if (!m || m.length !== 1) { console.error(`${key}: cannot find exactly one "line" array`); process.exit(1); }
  fs.writeFileSync(file, text.replace(m[0], `"line":[${off.join(',')}]`));
  let moved = 0;
  for (let i = 0; i < off.length; i++) moved = Math.max(moved, Math.abs(off[i] - json.line[i]));
  console.log(`${key.padEnd(12)} ${off.length} samples, moved up to ${moved.toFixed(1)} m`);
}
