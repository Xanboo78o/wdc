// spasetcheck.mjs — Spa's trackside set, held to what can be held without eyes.
//
// The set (js/dlc/spa/) was built while Adam was driving, so nothing could be
// photographed. This builds it in plain Node — the real modules, the real
// footprints, a flat stand-in for the ground — and asserts the things a
// picture would have shown at a glance and that have been wrong before on
// other circuits (a stand facing away from the road, a front row inside the
// barrier, a building across the track):
//
//   every stand's front faces the road, and its back is further from it
//   every front row is clear of the barrier
//   no vertex is NaN, underground by more than a metre, or absurdly tall
//   the crowd is in the stands, not on the circuit
//   neither pit building touches the road
//
// It CANNOT see a roof at a silly height, a colour, or z-fighting. That needs
// a screenshot, and js/dlc/spa/index.js stays opt-in (?set=1) until one exists.
//
//   node tools/spasetcheck.mjs [--break flip]      (a break must FAIL)
import fs from 'fs';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('../js/vendor/three.module.min.js', ${JSON.stringify(import.meta.url)}).href, shortCircuit: true };
  return next(spec, ctx);
}`));
const BREAK = process.argv[2] === '--break' ? process.argv[3] : null;
if (process.argv.length > 2 && BREAK !== 'flip') { console.error('spasetcheck: only --break flip'); process.exit(2); }
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };

const ROOT = new URL('../', import.meta.url).pathname;
const { Track } = await import('../js/track.js');
const THREE = await import('three');
const stands = await import('../js/dlc/spa/stands.js');
const pits = await import('../js/dlc/spa/pits.js');
const t = new Track(JSON.parse(fs.readFileSync(ROOT + 'data/tracks/spa.json', 'utf8')));
const env = JSON.parse(fs.readFileSync(ROOT + 'data/env/spa.json', 'utf8'));
const before = env.buildings.length, nStands = env.buildings.filter(b => b.k === 'grandstand').length;
const rings = env.buildings.filter(b => b.k === 'grandstand').map(b => b.p);

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${detail}`); };
const dTrack = p => { let b = Infinity; for (let i = 0; i < t.n; i++) b = Math.min(b, (t.x[i] - p[0]) ** 2 + (t.y[i] - p[1]) ** 2); return Math.sqrt(b); };

console.log('[layout] each grandstand footprint');
let facing = 0, clear = 0, worstClear = Infinity; const bad = [];
for (const ring of rings) {
  const L = stands.layout(ring, t);
  if (BREAK === 'flip') { L.n = [-L.n[0], -L.n[1]]; }
  const mid = k => [L.a[0] + L.u[0] * L.L / 2 + L.n[0] * k, L.a[1] + L.u[1] * L.L / 2 + L.n[1] * k];
  const ok = dTrack(mid(L.D)) > dTrack(mid(0)) + 1;
  if (ok) facing++; else bad.push(mid(0).map(v => v.toFixed(0)).join(','));
  let c = Infinity;
  for (let k = 0; k <= 16; k++) { const p = [L.a[0] + L.u[0] * L.L * k / 16, L.a[1] + L.u[1] * L.L * k / 16], q = t.project(p[0], p[1]); c = Math.min(c, Math.abs(q.lat) - (q.w + q.run)); }
  worstClear = Math.min(worstClear, c);
  if (c >= 1.5) clear++;
  { const q = t.project(mid(0)[0], mid(0)[1]); console.log(`        s=${q.s.toFixed(0).padStart(4)} ${q.lat > 0 ? 'left ' : 'right'}  ${L.L.toFixed(0).padStart(3)} m long, ${L.D.toFixed(1).padStart(4)} m deep, front ${Math.abs(q.lat).toFixed(0)} m from the centreline${L.shift > 0.05 ? `, stepped back ${L.shift.toFixed(1)} m` : ''}`); }
}
check('faces the road', facing === rings.length, `${facing} of ${rings.length}${bad.length ? '  wrong: ' + bad.join(' ') : ''}`);
check('front row behind the barrier', clear === rings.length, `${clear} of ${rings.length}, tightest ${worstClear.toFixed(1)} m beyond the run-off (>= 1.5)`);

console.log('\n[build] the real modules, on flat ground');
const S = new THREE.Group();
const look = { mat: () => new THREE.MeshStandardMaterial() };
const ctx = { S, t, env, look, world: { groundY: () => 0 } };
stands.prepareEnv(env); pits.prepareEnv(env);
check('footprints lifted out of the env', before - env.buildings.length === nStands + 2, `${before - env.buildings.length} removed (${nStands} stands + 2 pit buildings)`);
const st = stands.build(null, ctx), pt = pits.build(null, ctx);
check('stands built', st && st.stands === nStands && st.people > 3000, JSON.stringify(st));
check('pit buildings built', pt && pt.buildings === 2 && pt.meshes === 3, JSON.stringify(pt));
let nan = 0, lowY = Infinity, hiY = -Infinity, verts = 0, onRoad = 0, tris = 0;
S.traverse(o => {
  if (!o.isMesh) return;
  const pos = o.geometry.attributes.position;
  tris += (o.geometry.index ? o.geometry.index.count : pos.count) / 3 * (o.count || 1);
  if (o.isInstancedMesh) {
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m); if (!Number.isFinite(v.x + v.y + v.z)) nan++; const q = t.project(v.x, -v.z); if (Math.abs(q.lat) < q.w + q.run) onRoad++; }
    return;
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    verts++;
    if (!Number.isFinite(x + y + z)) { nan++; continue; }
    lowY = Math.min(lowY, y); hiY = Math.max(hiY, y);
    if (i % 7 === 0) { const q = t.project(x, -z); if (Math.abs(q.lat) < q.w) onRoad++; }
  }
});
check('no NaN', nan === 0, `${nan} of ${verts} vertices`);
check('heights sane', lowY > -1.2 && hiY > 12 && hiY < 34, `${lowY.toFixed(1)} m to ${hiY.toFixed(1)} m above its ground`);
check('nothing on the road, nobody on the run-off', onRoad === 0, `${onRoad} vertices or people`);
console.log(`        ${S.children.length} groups, ${verts} vertices, ${Math.round(tris / 1000)}k triangles with the crowd`);
console.log(fails ? `\n${fails} FAILED${BREAK ? `  [--break ${BREAK}: this run SHOULD fail]` : ''}` : '\nall ok');
process.exit(fails && !BREAK ? 1 : 0);
