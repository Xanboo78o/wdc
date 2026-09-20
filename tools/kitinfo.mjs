// kitinfo.mjs — what size is a thing in data/kit, really?
//
//   node tools/kitinfo.mjs [name ...]
//
// The kit is Kenney's Racing Kit and its models are in ITS units, not metres.
// A wall placed at the wrong scale is a wall in the wrong place, so this reads
// the answer out of the file rather than anybody eyeballing it: a .glb is a
// JSON chunk plus a binary one, and every POSITION accessor carries its own
// min and max. No loader, no browser, no guessing.
import fs from 'fs';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = path.join(ROOT, 'data/kit');
const want = process.argv.slice(2);

function bounds(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const a = gltf.accessors?.[prim.attributes?.POSITION];
      if (!a?.min || !a?.max) continue;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); }
    }
  }
  return { lo, hi, size: hi.map((v, k) => v - lo[k]), tris: (gltf.meshes || []).length };
}

const files = (want.length ? want.map(w => `${w}.glb`) : fs.readdirSync(DIR).filter(f => f.endsWith('.glb')));
const rows = [];
for (const f of files) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { console.error(`no such model: ${f}`); continue; }
  const b = bounds(p);
  rows.push({ name: f.replace('.glb', ''), ...b });
}
rows.sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2]);
console.log('name                         x      y      z     (kit units)   sits on y=');
for (const r of rows.slice(0, want.length ? rows.length : 24)) {
  console.log(`${r.name.padEnd(26)} ${r.size.map(v => v.toFixed(2).padStart(6)).join(' ')}   ${r.lo[1].toFixed(2)}`);
}
