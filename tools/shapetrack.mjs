// shapetrack.mjs — bank corners and widen corners of a baked track, by number.
//
//   node tools/shapetrack.mjs street --bank 18:6,7,10 --width 30:20
//
// --bank DEG:N,N,...   bank those corners DEG degrees. The run is carried
//                      LEAD metres past each end, because js/track.js tapers
//                      banking by eating INTO the run — without the lead the
//                      apex would be the only place at full angle.
// --width M:N,N,...    those corners M metres wide (full width), blended in
//                      and out over BLEND metres with a smoothstep so the
//                      barrier never steps.
// --wall KIND          the barrier: armco | barrier | gravel | wall (wall =
//                      concrete blocks and a debris fence, the street look)
// Run tools/bakeline.mjs afterwards: the racing line depends on both.
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const LEAD = 30, BLEND = 40;
const argv = process.argv.slice(2);
let key = null, wall = null;
const WALLS = ['armco', 'barrier', 'gravel', 'wall'];
const banks = [], widths = [];
const spec = (flag, v) => {
  const m = /^([\d.]+):(\d+(?:,\d+)*)$/.exec(v || '');
  if (!m) { console.error(`shapetrack: ${flag} wants VALUE:N,N,... (got ${v})`); process.exit(2); }
  return { v: +m[1], nums: m[2].split(',').map(Number) };
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--bank') banks.push(spec(a, argv[++i]));
  else if (a === '--width') widths.push(spec(a, argv[++i]));
  else if (a === '--wall') {
    wall = argv[++i];
    if (!WALLS.includes(wall)) { console.error(`shapetrack: --wall is one of ${WALLS.join(' ')}`); process.exit(2); }
  }
  else if (a.startsWith('--')) { console.error(`shapetrack: unknown flag ${a}`); process.exit(2); }
  else if (!key) key = a;
  else { console.error('shapetrack: one track at a time'); process.exit(2); }
}
if (!key || (!banks.length && !widths.length && !wall)) { console.error('shapetrack: <key> --bank DEG:N,.. and/or --width M:N,..'); process.exit(2); }

const file = `${ROOT}data/tracks/${key}.json`;
const t = JSON.parse(fs.readFileSync(file, 'utf8'));
const n = t.x.length, ds = t.ds;
const corner = num => {
  const c = t.corners.find(c => c.num === num);
  if (!c) { console.error(`shapetrack: ${key} has no corner ${num} (1..${t.corners.length})`); process.exit(2); }
  return c;
};
const at = s => ((Math.round(s / ds) % n) + n) % n;

for (const { v, nums } of banks) for (const num of nums) {
  const c = corner(num);
  for (let s = c.s0 - LEAD; s <= c.s1 + LEAD; s += ds) t.bank[at(s)] = v;
  console.log(`  bank   T${num} ${v} deg  (s ${c.s0}..${c.s1}, R${c.R}, ${c.turn} deg of turn)`);
}
for (const { v, nums } of widths) for (const num of nums) {
  const c = corner(num), base = t.w.slice();
  for (let s = c.s0 - BLEND; s <= c.s1 + BLEND; s += ds) {
    const edge = Math.min(s - (c.s0 - BLEND), (c.s1 + BLEND) - s) / BLEND;
    const f = Math.min(1, edge), k = f * f * (3 - 2 * f);
    const i = at(s);
    t.w[i] = +Math.max(t.w[i], base[i] + (v / 2 - base[i]) * k).toFixed(3);
  }
  console.log(`  width  T${num} ${v} m  (s ${c.s0}..${c.s1}, blended over ${BLEND} m each end)`);
}
if (wall) { console.log(`  wall   ${t.wall} -> ${wall}`); t.wall = wall; }
fs.writeFileSync(file, JSON.stringify(t));
console.log(`  written ${file} — now run: node tools/bakeline.mjs ${key}`);
