// layout.mjs — write the world's objects into a file, once.
//
//   node tools/layout.mjs [--walls] [--clear]
//
// "NOTHING IS CREATED WITH MATH, ITS ASSETS AND FILES." The distinction that
// matters is WHEN. A formula evaluated every frame is something nobody can
// correct: when a wall is in the wrong place there is nothing to edit, only a
// rule to re-argue. A layout written ONCE into data/build/objects.js is a
// file — every wall is a line with a position in it, and a wall in the wrong
// place is a line you delete.
//
// So this is an exporter, not a renderer. It runs when the track changes, and
// what it produces is Adam's to edit afterwards. Nothing reads the track at
// run time.
import fs from 'fs';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
for (const a of args) if (!['--walls', '--clear'].includes(a)) { console.error(`unknown flag ${a}`); process.exit(2); }
const OUT = ROOT + 'data/build/objects.js';

// Measured out of the .glb files by tools/kitinfo.mjs, in kit units.
const UNIT = 3.09;
const SOLID = {
  barrierWall: { len: 1.0, tall: 0.13, bounce: 0.2 },
  barrierRed: { len: 1.0, tall: 0.13, bounce: 0.2 },
  barrierWhite: { len: 1.0, tall: 0.13, bounce: 0.2 },
  fenceStraight: { len: 1.0, tall: 0.5, bounce: 0.1 },
  rail: { len: 1.0, tall: 0.16, along: 90, bounce: 0.3 },
};

const out = [];
if (args.includes('--walls')) {
  const { buildPath } = await import(ROOT + 'js/build/path.js');
  const { TRACK, PIECES } = await import(ROOT + 'data/build/pieces.js');
  const { pointAt } = await import(ROOT + 'js/build/path.js');
  const p = buildPath(PIECES, { closed: !!TRACK.closed });
  const STEP = UNIT;                       // one model per model-length
  for (const side of [1, -1]) {
    let s = 0;
    while (s < p.length - STEP) {
      const i = Math.min(p.n - 1, Math.round(s / p.ds));
      const run = side > 0 ? p.runL[i] : p.runR[i];
      const lat = side * (p.w[i] + run);
      const a = pointAt(p, i, lat);
      const j = Math.min(p.n - 1, Math.round((s + STEP) / p.ds));
      const b = pointAt(p, j, side * (p.w[j] + (side > 0 ? p.runL[j] : p.runR[j])));
      const ry = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      out.push({
        model: 'barrierWall',
        at: [+((a.x + b.x) / 2).toFixed(2), +((a.y + b.y) / 2).toFixed(2)],
        z: +(((a.z + b.z) / 2)).toFixed(2),
        ry: +ry.toFixed(1),
      });
      s += STEP;
    }
  }
}

const body = out.map(o => `  { model: '${o.model}', at: [${o.at[0]}, ${o.at[1]}], z: ${o.z}, ry: ${o.ry} },`).join('\n');
fs.writeFileSync(OUT, `// THE THINGS IN THE WORLD — one line each, and every line is editable.
//
// Written by tools/layout.mjs, owned by whoever edits it next. A wall in the
// wrong place is a line to delete, not a formula to re-derive. Nothing here is
// worked out at run time: js/build/objects.js loads the model named in each
// entry from data/kit (Kenney Racing Kit, CC0) and stands it exactly here.
//
//   model   a file in data/kit, without the .glb
//   at      [x, y] in the sim's metres (y is LEFT)
//   z       height in metres; leave it out to stand on the ground
//   ry      yaw in degrees
//   scale   multiplies the model's own size; 1 is life-size at UNIT below
//
// UNIT is how many metres one kit unit is, measured off raceCarRed against a
// 4.6 m car by tools/kitinfo.mjs — not guessed.
// Which track these positions belong to. They are in the sim's metres, which
// the builder and the baked game track share, so the same file serves both —
// but only for that one track.
export const TRACK = 'test';

export const UNIT = ${UNIT};

// Which models are SOLID, how long they are along their own x in kit units,
// and how tall. Anything listed here hands js/props.js a wall to collide with,
// so it is a thing you hit rather than a thing you drive through.
export const SOLID = ${JSON.stringify(SOLID, null, 1).replace(/"/g, '')};

export const OBJECTS = [
${body}
];
`);

const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`${out.length} object(s) written to data/build/objects.js (${kb} KB)`);
if (out.length) {
  const models = [...new Set(out.map(o => o.model))];
  console.log(`models used: ${models.join(', ')}`);
  console.log(`solid: ${models.filter(m => SOLID[m]).join(', ') || 'none'}`);
}
console.log('\nEdit it. Delete a line and that wall is gone.');
