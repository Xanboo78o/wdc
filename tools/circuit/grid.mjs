// The Silverstone model as a grid, 0.5 m a cell: what is at each cell (road / kerb / barrier / other ground) and how high the road is.
// Model space X right, Y up, Z; the grid's column is X, its row is Z.
import fs from 'fs';
const src = 'inbox/silverstone', S = process.argv[2];
const g = JSON.parse(fs.readFileSync(src + '/scene.gltf', 'utf8'));
const buf = fs.readFileSync(src + '/' + g.buffers[0].uri);
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const acc = i => { const a = g.accessors[i], bv = g.bufferViews[a.bufferView]; const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  if (a.componentType === 5126) { const st = bv.byteStride || n * 4; const o = new Float32Array(a.count * n); for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) o[k * n + c] = buf.readFloatLE(off + k * st + c * 4); return o; }
  if (a.componentType === 5125) { const o = new Uint32Array(a.count); for (let k = 0; k < a.count; k++) o[k] = buf.readUInt32LE(off + k * 4); return o; }
  if (a.componentType === 5123) { const o = new Uint32Array(a.count); for (let k = 0; k < a.count; k++) o[k] = buf.readUInt16LE(off + k * 2); return o; }
  throw new Error('type ' + a.componentType); };
export const CELL = 0.5, X0 = -1100, Z0 = -1460, W = 4300, H = 5720;
const wallY = new Float32Array(W * H).fill(1e9);
const kind = new Uint8Array(W * H), hgt = new Float32Array(W * H).fill(NaN), gnd = new Float32Array(W * H).fill(NaN);
// 1 road  2 kerb  3 barrier (a wall you hit)  4 other ground (grass, sand, run-off tarmac)
const KIND = [[/^asphalt|^groove|asph_pit/, 1], [/[Cc]urb/, 2], [/^barriers|^tyreswall|^jersey|^walls|^metals1|^fences1/, 3], [/^grass|^sand|^top2/, 4]];
function tri(k, a, b, c) {
  if (k === 3) {
    // a barrier is an upright sheet: from above it is its three edges. Walk them, a quarter of a metre at a time.
    // (Only what stands near the ground counts: a gantry or a bridge deck overhead is not a wall.)
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const len = Math.hypot(q[0] - p[0], q[2] - p[2]), st = Math.max(1, Math.ceil(len / 0.25));
      for (let s = 0; s <= st; s++) {
        const x = p[0] + (q[0] - p[0]) * s / st, z = p[2] + (q[2] - p[2]) * s / st;
        const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
        if (i >= 0 && j >= 0 && i < W && j < H) wallY[j * W + i] = Math.min(wallY[j * W + i], p[1] + (q[1] - p[1]) * s / st);
      }
    }
    return;
  }
  const minx = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - X0) / CELL)), maxx = Math.min(W - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - X0) / CELL));
  const minz = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - Z0) / CELL)), maxz = Math.min(H - 1, Math.ceil((Math.max(a[2], b[2], c[2]) - Z0) / CELL));
  const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  for (let j = minz; j <= maxz; j++) for (let i = minx; i <= maxx; i++) {
    const x = X0 + (i + 0.5) * CELL, z = Z0 + (j + 0.5) * CELL;
    let u, v, w;
    if (Math.abs(d) < 1e-9) { if (k !== 3) continue; u = v = w = 1 / 3; }
    else { u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d; v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d; w = 1 - u - v; }
    const e = k === 3 ? -0.6 : -0.02;                                 // a barrier is a thin upright thing: fatten it so no cell is missed
    if (u < e || v < e || w < e) continue;
    const y = u * a[1] + v * b[1] + w * c[1], q = j * W + i;
    if (k === 3) { kind[q] = 3; continue; }
    if (k === 1) { if (kind[q] !== 3) kind[q] = 1; if (!(hgt[q] >= y)) hgt[q] = y; }
    else if (kind[q] === 0 || (k === 2 && kind[q] === 4)) kind[q] = k;
    if (!(gnd[q] >= y)) gnd[q] = y;
  }
}
function walk(i, M) {
  const n = g.nodes[i], Wm = mul(M, n.matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (n.mesh !== undefined) for (const pr of g.meshes[n.mesh].primitives) {
    const k = (KIND.find(q => q[0].test(g.materials[pr.material].name)) || [])[1];
    if (!k) continue;
    const P = acc(pr.attributes.POSITION), I = acc(pr.indices);
    const at = v => [Wm[0] * P[v * 3] + Wm[4] * P[v * 3 + 1] + Wm[8] * P[v * 3 + 2] + Wm[12], Wm[1] * P[v * 3] + Wm[5] * P[v * 3 + 1] + Wm[9] * P[v * 3 + 2] + Wm[13], Wm[2] * P[v * 3] + Wm[6] * P[v * 3 + 1] + Wm[10] * P[v * 3 + 2] + Wm[14]];
    for (let t = 0; t + 2 < I.length; t += 3) tri(k, at(I[t]), at(I[t + 1]), at(I[t + 2]));
  }
  for (const c of n.children || []) walk(c, Wm);
}
for (const r of g.scenes[0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// a wall where a barrier's foot is within a metre and a half of the ground there (and not on the road itself)
for (let q = 0; q < W * H; q++) if (wallY[q] < 1e8 && kind[q] !== 1 && (!(gnd[q] === gnd[q]) || wallY[q] - gnd[q] < 1.5)) kind[q] = 3;
const n = [0, 0, 0, 0, 0]; for (let q = 0; q < W * H; q++) n[kind[q]]++;
console.log('cells: road', n[1], 'kerb', n[2], 'barrier', n[3], 'ground', n[4], ' road area m2', n[1] * CELL * CELL);
fs.writeFileSync(S + '/silv-kind.bin', kind); fs.writeFileSync(S + '/silv-hgt.bin', Buffer.from(hgt.buffer)); fs.writeFileSync(S + '/silv-gnd.bin', Buffer.from(gnd.buffer));
const img = Buffer.alloc(W * H * 3); const C = [[18, 18, 18], [210, 210, 210], [230, 60, 60], [255, 220, 0], [40, 95, 40]];
for (let q = 0; q < W * H; q++) { const c = C[kind[q]]; img[q * 3] = c[0]; img[q * 3 + 1] = c[1]; img[q * 3 + 2] = c[2]; }
fs.writeFileSync(S + '/silv-kind.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
