// bakestrips.mjs — the two flat banners of Adam's forest, laid out of PHOTOGRAPHS.
//
//   node tools/bakestrips.mjs            writes data/flora/strip-short.png and strip-tall.png
//
// Adam, 2026-10-08: "for the bush strips and foliage strips, use stock photos".
// The browser game renders its banners from the 3D tree kit; these are made of
// the plant photographs in data/flora (ambientCG, CC0 — see SOURCE.md there):
// each leaf and blade is a real cut-out, turned, sized and laid over the last,
// darker inside and at the foot, lighter at the top where the light gets in.
//
//   strip-short   undergrowth: grasses, seed heads, dandelion leaves, low ivy.
//                 2.4 m tall on the ground, so the picture is 9.6 m long.
//   strip-tall    bushes and saplings, ragged along the top. 6.2 m tall, 24.8 m long.
//
// Both tile end to end: a leaf that hangs over the right edge comes back in on
// the left. Deterministic: the same strips every run.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const FLORA = ROOT + 'data/flora/';
const atlas = JSON.parse(fs.readFileSync(FLORA + 'atlas.json', 'utf8'));
const W = 2048, H = 512;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strips-'));

let seed = 20261008;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];

// One RGBA picture per set, so a cut-out can be cropped straight out of it.
const sets = {};
for (const name of ['grass', 'seed', 'weed', 'ivy', 'leaf', 'needle']) {
  if (!atlas[name]) { console.error(`bakestrips: data/flora has no "${name}" — node tools/getflora.mjs ${name}`); process.exit(1); }
  const f = path.join(tmp, name + '.png');
  execFileSync('magick', [FLORA + name + '-c.jpg', FLORA + name + '-a.png', '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', f]);
  const [sw, sh] = atlas[name].size;
  const [iw, ih] = execFileSync('magick', ['identify', '-format', '%w %h', f]).toString().split(' ').map(Number);
  sets[name] = { file: f, items: atlas[name].items.map(i => ({ x: Math.round(i.x * iw), y: Math.round(i.y * ih), w: Math.round(i.w * iw), h: Math.round(i.h * ih) })), sw, sh };
}

// A placement: which cut-out, how long its longer side is on the strip (px),
// turned how far, how bright, and where its FOOT (bottom centre) stands.
function place(list, set, { size, turn = 0, bright = 100, x, foot }) {
  const it = pick(sets[set].items);
  list.push({ set, it, size, turn, bright, x, foot });
}

function compose(out, list) {
  const args = [];
  for (const name of new Set(list.map(p => p.set))) args.push(sets[name].file, '-write', 'mpr:' + name, '+delete');
  args.push('-size', `${W}x${H}`, 'xc:none');
  // back to front: the dark ones first
  list.sort((a, b) => a.bright - b.bright);
  for (const p of list) {
    const k = p.size / Math.max(p.it.w, p.it.h);
    const w = p.it.w * k, h = p.it.h * k, a = p.turn * Math.PI / 180;
    // the box the turned cut-out fills
    const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    const y = Math.round(p.foot - bh);
    for (const x of [p.x - bw / 2, p.x - bw / 2 - W, p.x - bw / 2 + W]) {
      if (x + bw < 0 || x > W) continue;
      args.push('(', 'mpr:' + p.set, '-crop', `${p.it.w}x${p.it.h}+${p.it.x}+${p.it.y}`, '+repage', '-resize', `${(k * 100).toFixed(2)}%`,
        '-background', 'none', '-rotate', p.turn.toFixed(1), '-modulate', `${p.bright.toFixed(0)},${(86 + rnd() * 26).toFixed(0)},${(97 + rnd() * 6).toFixed(0)}`, ')',
        '-geometry', `${Math.round(x) >= 0 ? '+' : '-'}${Math.abs(Math.round(x))}${y >= 0 ? '+' : '-'}${Math.abs(y)}`, '-compose', 'Over', '-composite');
    }
  }
  const raw = path.join(tmp, 'raw.png');
  try { execFileSync('magick', [...args, raw], { maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.error('bakestrips: magick failed: ' + String(e.stderr).slice(0, 600)); process.exit(1); }
  // Flood what is see-through with the mean colour of what is not, or the mip
  // chain bleeds a dark fringe into every edge (tools/getflora.mjs, note 1).
  const mean = execFileSync('magick', [raw, '-alpha', 'off', '-resize', '1x1!', '-format', '%[hex:p{0,0}]', 'info:']).toString().trim().slice(0, 6);
  execFileSync('magick', [raw, '(', '+clone', '-alpha', 'extract', '-write', 'mpr:a', '+delete', ')', '-background', '#' + mean, '-alpha', 'remove', '-alpha', 'off',
    'mpr:a', '-compose', 'CopyOpacity', '-composite', '-define', 'png:compression-level=9', out]);
  const cover = +execFileSync('magick', [out, '-alpha', 'extract', '-format', '%[fx:mean]', 'info:']).toString();
  console.log(`${path.relative(ROOT, out)}  ${list.length} cut-outs  ${(cover * 100).toFixed(0)}% covered  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// ---- the short banner: undergrowth ---------------------------------------------------
{
  const L = [];
  // a dark mat of ivy at the foot, so nothing shows through the grass
  for (let i = 0; i < 150; i++) place(L, 'ivy', { size: 70 + rnd() * 60, turn: rnd() * 360, bright: 38 + rnd() * 22, x: rnd() * W, foot: H + 30 - rnd() * 150 });
  for (let i = 0; i < 130; i++) place(L, 'weed', { size: 150 + rnd() * 150, turn: 90 + (rnd() - 0.5) * 80, bright: 52 + rnd() * 30, x: rnd() * W, foot: H + 20 - rnd() * 60 });
  for (let i = 0; i < 170; i++) place(L, 'grass', { size: 190 + rnd() * 250, turn: (rnd() - 0.5) * 36, bright: 66 + rnd() * 34, x: rnd() * W, foot: H + 12 });
  for (let i = 0; i < 46; i++) place(L, 'seed', { size: 260 + rnd() * 230, turn: (rnd() - 0.5) * 24, bright: 84 + rnd() * 22, x: rnd() * W, foot: H + 8 });
  for (let i = 0; i < 60; i++) place(L, 'weed', { size: 120 + rnd() * 110, turn: 90 + (rnd() - 0.5) * 110, bright: 82 + rnd() * 22, x: rnd() * W, foot: H + 10 - rnd() * 40 });
  compose(FLORA + 'strip-short.png', L);
}

// ---- the tall banner: bushes and saplings ---------------------------------------------
{
  const L = [];
  // a bush is a mound of leaves: dark in the middle and low down, bright on the outside and the top
  let x = 0;
  while (x < W) {
    const bw = 150 + rnd() * 210, bh = 230 + rnd() * 270, cx = x + bw / 2, set = 'ivy';
    const n = Math.round(bw * bh / 520);
    for (let i = 0; i < n; i++) {
      // a point in the mound, by rejection
      let u, v;
      do { u = rnd() * 2 - 1; v = rnd(); } while (u * u + v * v > 1);
      const rim = Math.sqrt(u * u + v * v);
      place(L, rnd() < 0.85 ? set : 'ivy', {
        size: 62 + rnd() * 62, turn: rnd() * 360,
        bright: 34 + 46 * rim + 26 * v + rnd() * 10,
        x: cx + u * bw * 0.62, foot: H + 26 - v * bh,
      });
    }
    x += bw * (0.55 + rnd() * 0.35);
  }
  // and a skirt of weeds along the foot
  for (let i = 0; i < 80; i++) place(L, 'weed', { size: 110 + rnd() * 90, turn: 90 + (rnd() - 0.5) * 90, bright: 60 + rnd() * 30, x: rnd() * W, foot: H + 14 });
  compose(FLORA + 'strip-tall.png', L);
}
fs.rmSync(tmp, { recursive: true, force: true });
