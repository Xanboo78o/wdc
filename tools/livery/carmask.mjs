// carmask.mjs — where is the PAINT on a car, seen from the side and from above?
//
//   node tools/livery/carmask.mjs <key> [--png out.png]
//
// A sticker belongs on paintwork, not across a window or a wheel arch, and
// every downloaded car keeps its paint somewhere else. This draws a baked car
// (data/cars/<key>) flat from the right side and from above, in the livery's
// own coordinates (data/livery.glsl: x -1 tail .. +1 nose, y 0 road .. 1 roof,
// z -1 left .. +1 right), and writes data/cars/<key>/mask.json: two small
// rasters the livery baker reads to test that a sticker sits on paint.
//
// With --png it also writes a picture with a grid, for choosing zones by eye:
// paint is light, everything else on the car is dark.
import fs from 'fs';
import { execFileSync } from 'child_process';

export const MW = 256, MH = 128;                     // side: x across, y up.  top: z across, x up
export function loadCar(key, root = new URL('../../', import.meta.url).pathname) {
  const dir = `${root}data/cars/${key}/`;
  const car = JSON.parse(fs.readFileSync(dir + 'car.json', 'utf8'));
  const buf = fs.readFileSync(dir + 'car.bin');
  const V = new Float32Array(buf.buffer, buf.byteOffset, car.verts * 8), I = new Uint32Array(buf.buffer, buf.byteOffset + car.indexAt, car.tris * 3);
  return { dir, car, V, I };
}
// the livery's frame for a car: the middle and half-size of its BODY
export function frame(car) {
  return { cx: (car.lo[0] + car.hi[0]) / 2, hl: (car.hi[0] - car.lo[0]) / 2, h: car.hi[1], hw: Math.max(car.hi[2], -car.lo[2]) };
}
export function rasters(key) {
  const { car, V, I } = loadCar(key);
  const F = frame(car);
  // 0 nothing, 1 not paint, 2 paint; with a depth so the nearest surface wins
  const mk = (w, h) => ({ w, h, v: new Uint8Array(w * h), d: new Float32Array(w * h).fill(-1e9) });
  const side = mk(MW, MH), top = mk(MH, MW);
  const fill = (R, a, b, c, val) => {
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(R.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(R.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(den) < 1e-9) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const u = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / den, v = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / den;
      if (u < -0.02 || v < -0.02 || u + v > 1.02) continue;
      const d = a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]);
      if (d > R.d[y * R.w + x]) { R.d[y * R.w + x] = d; R.v[y * R.w + x] = val; }
    }
  };
  for (const G of car.groups) {
    if (G.part !== 'body') continue;
    const m = car.materials[G.mat], val = m.role === 'paint' ? 2 : 1;
    for (let t = 0; t < G.in; t += 3) {
      const P = [0, 1, 2].map(k => { const o = (G.v0 + I[G.i0 + t + k]) * 8; return [(V[o] - F.cx) / F.hl, V[o + 1] / F.h, V[o + 2] / F.hw, V[o + 3], V[o + 4], V[o + 5]]; });
      const nz = (P[0][5] + P[1][5] + P[2][5]) / 3, ny = (P[0][4] + P[1][4] + P[2][4]) / 3;
      // from the right: nearest = greatest z.  Only what faces sideways is a flank.
      if (P.some(p => p[2] > 0)) fill(side, ...P.map(p => [(p[0] + 1) / 2 * MW, (1 - p[1]) * MH, p[2]]), Math.abs(nz) > 0.5 ? val : 1);
      // from above: nearest = greatest y.  Only what faces up takes a top sticker.
      fill(top, ...P.map(p => [(p[2] + 1) / 2 * MH, (1 - (p[0] + 1) / 2) * MW, p[1]]), ny > 0.55 ? val : 1);
    }
  }
  return { F, side, top };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.argv[2], pi = process.argv.indexOf('--png');
  if (!key) { console.error('carmask: node tools/livery/carmask.mjs <key> [--png out.png]'); process.exit(2); }
  const { F, side, top } = rasters(key);
  const pack = R => Buffer.from(R.v).toString('base64');
  const dir = new URL(`../../data/cars/${key}/`, import.meta.url).pathname;
  fs.writeFileSync(dir + 'mask.json', JSON.stringify({ frame: F, side: { w: side.w, h: side.h, v: pack(side) }, top: { w: top.w, h: top.h, v: pack(top) } }));
  const share = R => (R.v.reduce((s, x) => s + (x === 2), 0) / R.v.reduce((s, x) => s + (x > 0), 0) * 100).toFixed(0);
  console.log(`${key}: paint is ${share(side)}% of the flank, ${share(top)}% of the top  -> ${dir}mask.json`);
  if (pi > 0) {
    const out = process.argv[pi + 1], K = 4;
    const img = (R, name) => {
      const px = Buffer.alloc(R.w * R.h * 3);
      for (let i = 0; i < R.w * R.h; i++) { const c = R.v[i] === 2 ? [228, 228, 222] : R.v[i] === 1 ? [52, 54, 60] : [18, 24, 36]; px[i * 3] = c[0]; px[i * 3 + 1] = c[1]; px[i * 3 + 2] = c[2]; }
      const f = `${out}.${name}.ppm`;
      fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6\n${R.w} ${R.h}\n255\n`), px]));
      return f;
    };
    const grid = (w, h, nx, ny) => { const a = []; for (let i = 1; i < nx; i++) a.push(`line ${w * i / nx},0 ${w * i / nx},${h}`); for (let j = 1; j < ny; j++) a.push(`line 0,${h * j / ny} ${w},${h * j / ny}`); return a.join(' '); };
    const s = img(side, 'side'), t = img(top, 'top');
    execFileSync('magick', [s, '-filter', 'point', '-resize', `${MW * K}x${MH * K}`, '-stroke', '#ff3b3b80', '-strokewidth', '1', '-draw', grid(MW * K, MH * K, 8, 4), s + '.png']);
    execFileSync('magick', [t, '-filter', 'point', '-resize', `${MH * K}x${MW * K}`, '-stroke', '#ff3b3b80', '-strokewidth', '1', '-draw', grid(MH * K, MW * K, 4, 8), t + '.png']);
    execFileSync('magick', [s + '.png', t + '.png', '-background', '#101010', '-gravity', 'center', '+append', out]);
    for (const f of [s, t, s + '.png', t + '.png']) fs.rmSync(f);
  }
}
