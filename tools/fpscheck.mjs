// fpscheck.mjs — the 50 fps floor, measured on the card the game is played on.
//
// Adam, 2026-09-28: "Frame rate" (50 fps minimum on the wheel, from the
// 2026-09-23 graphics brief). This runs every circuit as a full-grid race on
// the GTX 1060 through tools/shot.mjs --gpu, onboard with the mirror on — the
// most expensive seat in the game — and prints fps, draw calls and triangles.
//
//   node tools/fpscheck.mjs                 # every circuit, 22 cars
//   node tools/fpscheck.mjs monza suzuka    # just these
//   node tools/fpscheck.mjs --grid 12 --cam 1
//
// THE INSTRUMENT: headless chromium is vsync-capped at 60, so 60 means "at
// least 60", and anything else sharing the GPU (another session's render) is
// in the number. Run it alone. Draw calls are deterministic and are the number
// to trust when two runs disagree on fps.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const known = new Set(['--grid', '--cam', '--floor']);
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (!known.has(args[i])) { console.error(`unknown flag ${args[i]}`); process.exit(2); }
    i++;
  }
}
const grid = +flag('grid', 22), cam = +flag('cam', 0), floor = +flag('floor', 50);
const named = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const tracks = named.length ? named : ['monza', 'monaco', 'suzuka', 'zandvoort', 'baku', 'nurburgring', 'sepang', 'street', 'kate'];

let bad = 0;
console.log(`  ${'circuit'.padEnd(12)} ${'fps'.padStart(6)} ${'draws'.padStart(6)} ${'tris'.padStart(9)}   (grid ${grid}, cam ${cam}, floor ${floor})`);
for (const t of tracks) {
  const r = spawnSync('nice', ['-n', '19', 'node', 'tools/shot.mjs', `${t}:f1`, '--gpu',
    '--q', 'race=1', '--q', `grid=${grid}`, '--q', 'spool=25', '--q', 'time=14:00',
    '--q', 'mirror=1', '--q', `cam=${cam}`, '--out', `fps_${t}`, '--wait', '5000'],
    { encoding: 'utf8', timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fps = +((out.match(/([\d.]+) fps \(GPU\)/) || [])[1] || NaN);
  // the FRAME's draws sit right before its "tris"; other stats (landmarks)
  // carry a "draws" key of their own, and the first match read those
  const draws = +((out.match(/"draws":(\d+),"tris"/) || [])[1] || NaN);
  const tris = +((out.match(/"tris":(\d+)/) || [])[1] || NaN);
  // network noise (the FFB bridge and radio servers not running) is not a fault
  const errs = (out.match(/^\s+! (?!network:|radio:).*/gm) || []);
  const ok = fps >= floor && !errs.length;
  if (!ok) bad++;
  console.log(`  ${t.padEnd(12)} ${String(fps).padStart(6)} ${String(draws).padStart(6)} ${String(tris).padStart(9)}   ${ok ? 'ok' : 'BELOW FLOOR / ERROR'}`);
  for (const e of errs.slice(0, 3)) console.log('      ' + e.trim());
}
console.log(bad ? `\n  ${bad} circuit(s) failed` : '\n  all circuits at or above the floor');
process.exit(bad ? 1 : 0);
