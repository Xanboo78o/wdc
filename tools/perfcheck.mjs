// perfcheck.mjs — what does a change to the geometry actually COST?
//
//   node tools/perfcheck.mjs [--secs 8] [--q "cam=200,25,0,4"]
//
// Times frames in the real page, at several chunk sizes and from several
// cameras, and prints frame time next to draws and triangles. Triangle counts
// are not a verdict: a draw call is CPU work, and cutting a mesh into pieces
// trades triangles for draw calls. Which way that trade goes depends on the
// camera and on the machine, so it has to be measured rather than argued.
//
// THE RIG HAS PROPERTIES. Headless chromium here runs on SwiftShader — a
// SOFTWARE rasteriser. That makes it a fair stress test of CPU-side cost
// (draw calls, submission) and a poor model of a real GPU's fill rate. Numbers
// from this tool are a comparison between builds on the same rig, never a
// frame rate anybody will see.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const argv = process.argv.slice(2);
const opt = { secs: 8, q: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--secs') opt.secs = +argv[++i];
  else if (argv[i] === '--q') opt.q.push(argv[++i]);
  else { console.error(`unknown flag ${argv[i]}`); process.exit(2); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8176;

async function run(params) {
  const CDP = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-perf-'));
  const url = `http://127.0.0.1:${PORT}/build.html?${params}`;
  const chrome = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1280,720', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, url,
  ], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const p = l.find(t => t.type === 'page' && t.url.includes('build.html'));
      if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
    } catch { ws = null; }
    if (!ws) await sleep(250);
  }
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const ev = async expr => (await new Promise(r => { const k = ++id; pend.set(k, r); ws.send(JSON.stringify({ id: k, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); }))?.result?.result?.value;
  for (let i = 0; i < 300 && !(await ev('!!window.__build')); i++) await sleep(300);
  await sleep(1500);
  const r = await ev(`(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise(res => { const tick = () => { n++; performance.now() - t0 < ${opt.secs * 1000} ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
    const ms = (performance.now() - t0) / n;
    return JSON.stringify({ frames: n, ms: +ms.toFixed(0), draws: window.__build.draws, tris: window.__build.frameTris });
  })()`);
  ws.close(); chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* letting go */ }
  return JSON.parse(r);
}

// Two cameras: one looking down a straight (everything in view — chunking's
// worst case) and one on a single corner (chunking's best case).
const CAMS = {
  'down the straight': 'cam=200,25,0,4',
  'one corner, close': 'cam=4200,90,40,20',
};
const SIZES = process.env.PERF_SIZES
  ? Object.fromEntries(process.env.PERF_SIZES.split(',').map(x => { const [k, v] = x.split(':'); return [k, +v]; }))
  : { 'one mesh': 99999, '512 m': 256, '256 m': 128, '128 m': 64 };
console.log(`frame time in a SOFTWARE rasteriser — comparison between builds, not a frame rate\n`);
for (const [camName, cam] of Object.entries(CAMS)) {
  console.log(camName);
  for (const [label, chunk] of Object.entries(SIZES)) {
    const extra = opt.q.join('&');
    const r = await run(`flat=1&noprops=1&lo=1&${cam}&chunk=${chunk}${extra ? '&' + extra : ''}`);
    console.log(`  ${label.padEnd(9)} ${String(r.ms).padStart(5)} ms/frame   ${String(r.draws).padStart(4)} draws   ${(r.tris / 1000).toFixed(0).padStart(4)}k tris   (${r.frames} frames)`);
  }
}
