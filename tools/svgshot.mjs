// svgshot.mjs — look at a model without a browser.
//
//   node tools/svgshot.mjs <module.js> <exportedBuilder> out.svg [--view side|top|front|rear|q|eye] [--w 900]
//   node tools/svgshot.mjs js/xcar.js buildRally /tmp/torr.svg --view q
//
// Adam drives on this machine, and a headless browser while he drives makes
// his audio crackle, so for long stretches nothing could be photographed —
// and a car body built blind is a car body built wrong. This draws a THREE
// object in plain Node: every triangle, flat-shaded from its normal, sorted
// far to near and written as SVG polygons (rsvg-convert makes the PNG). It is
// a painter's algorithm, so interpenetrating parts can sort wrongly and there
// are no textures, shadows or reflections. It answers "is the roof on the
// right way up, is the wheel in the arch, what do I see from the seat" — and
// for those it is enough.
//
// `--view eye` is a 62 degree lens at the builder's own `eye`, looking
// forward: the ONBOARD camera.
import fs from 'fs';
import path from 'path';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: new URL('../js/vendor/three.module.min.js', ${JSON.stringify(import.meta.url)}).href, shortCircuit: true };
  return next(spec, ctx);
}`));
const argv = process.argv.slice(2);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
for (const a of argv) if (a.startsWith('--') && !['--view', '--w'].includes(a)) { console.error(`svgshot: unknown flag ${a}`); process.exit(2); }
if (pos.length !== 3) { console.error('usage: node tools/svgshot.mjs <module.js> <builder> out.svg [--view side|top|front|rear|q|eye] [--w 900]'); process.exit(2); }
const VIEW = flag('view', 'q'), W = +flag('w', 900);
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
const THREE = await import('three');
const mod = await import(path.resolve(pos[0]));
const look = { mat: (name, o = {}) => new THREE.MeshStandardMaterial({ color: o.tint ?? 0x888888 }) };
const built = mod[pos[1]](look);
const root = built.group || built;
root.updateMatrixWorld(true);

// camera: an eye, a target, an up; perspective unless `ortho` (a half-height in metres)
const eye = built.eye || [0, 1.1, -0.35];
const CAMS = {
  side: { e: [0, 0.75, -30], t: [0, 0.75, 0], ortho: 1.5 },
  top: { e: [0, 30, 0], t: [0, 0, 0], up: [1, 0, 0], ortho: 2.7 },
  front: { e: [30, 0.75, 0], t: [0, 0.75, 0], ortho: 1.3 },
  rear: { e: [-30, 0.75, 0], t: [0, 0.75, 0], ortho: 1.3 },
  q: { e: [6.2, 3.0, -5.2], t: [0, 0.6, 0], fov: 30 },
  eye: { e: eye, t: [eye[0] + 10, eye[1] - 0.9, eye[2]], fov: 62 },
};
const cam = CAMS[VIEW];
if (!cam) { console.error(`svgshot: --view is one of ${Object.keys(CAMS).join(' ')}`); process.exit(2); }
const E = new THREE.Vector3(...cam.e), T = new THREE.Vector3(...cam.t), UP = new THREE.Vector3(...(cam.up || [0, 1, 0]));
const fwd = T.clone().sub(E).normalize(), right = fwd.clone().cross(UP).normalize(), up = right.clone().cross(fwd);
const H = Math.round(W * (VIEW === 'side' ? 0.42 : VIEW === 'top' ? 0.5 : 0.62)), f = cam.fov ? (H / 2) / Math.tan(cam.fov * Math.PI / 360) : H / 2 / cam.ortho;
const NEAR = 0.08;
const proj = v => {
  const d = v.clone().sub(E), z = d.dot(fwd), x = d.dot(right), y = d.dot(up);
  if (cam.ortho) return [W / 2 + x * f, H / 2 - y * f, z];
  return z > NEAR ? [W / 2 + x * f / z, H / 2 - y * f / z, z] : null;
};
const LIGHT = new THREE.Vector3(0.35, 0.85, -0.4).normalize();
const tris = [];
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
root.traverse(o => {
  if (!o.isMesh) return;
  const geo = o.geometry, p = geo.attributes.position, idx = geo.index, m = o.material;
  const col = m.color ? m.color.clone() : new THREE.Color(0x888888), op = m.transparent ? m.opacity : 1;
  const cnt = idx ? idx.count : p.count;
  for (let i = 0; i < cnt; i += 3) {
    const g = k => (idx ? idx.getX(i + k) : i + k);
    a.fromBufferAttribute(p, g(0)).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, g(1)).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, g(2)).applyMatrix4(o.matrixWorld);
    const A = proj(a), B = proj(b), C = proj(c);
    if (!A || !B || !C) continue;
    n.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    const lit = 0.38 + 0.62 * Math.abs(n.dot(LIGHT));
    tris.push({ z: (A[2] + B[2] + C[2]) / 3, pts: [A, B, C], fill: `rgb(${[col.r, col.g, col.b].map(v => Math.round(255 * Math.min(1, Math.pow(v, 1 / 2.2) * lit))).join(',')})`, op });
  }
});
tris.sort((x, y) => y.z - x.z);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#b9c4cc"/>`;
if (VIEW === 'eye' || VIEW === 'q') svg += `<rect y="${H * (VIEW === 'eye' ? 0.5 : 0.62)}" width="100%" height="100%" fill="#7d7a70"/>`;
for (const t of tris) svg += `<polygon points="${t.pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="${t.fill}"${t.op < 1 ? ` fill-opacity="${t.op}"` : ` stroke="${t.fill}" stroke-width="0.6"`}/>`;
svg += `<text x="8" y="16" font-family="Helvetica" font-size="12" fill="#111">${pos[1]} — ${VIEW} — ${tris.length} triangles</text></svg>`;
fs.writeFileSync(pos[2], svg);
console.log(`${pos[2]}  ${tris.length} triangles  ${VIEW}`);
