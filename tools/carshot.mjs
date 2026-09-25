// carshot.mjs — photograph the car in carview.html from set angles.
//
//   node tools/carshot.mjs [--q "car=f1&team=ferrari"] [--out name] [--angles front,side,rear,top,hero]
//
// One headless chromium, one page per angle, waits for window.__carview rather
// than sleeping. Writes tools/shots/<out>-<angle>.png. Serves nothing: it
// expects the game's server on :8175 (python3 -m http.server 8175).
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const opt = { q: '', out: 'car', angles: 'hero,side,front,rear,top', port: 8175 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--') || !(a.slice(2) in opt)) { console.error(`carshot: unknown ${a}`); process.exit(2); }
  opt[a.slice(2)] = argv[++i];
}
// yaw, pitch, dist for each named angle. 0 yaw = in front of the nose.
const ANGLES = {
  hero: [38, 11, 6.8], side: [90, 4, 7.2], front: [0, 8, 6.0], rear: [180, 12, 6.2],
  top: [60, 48, 7.5], wheel: [70, 6, 2.6], low: [20, 2.5, 5.5],
};
const CDP = 9340 + Math.floor(Math.random() * 40);
const ch = spawn('nice', ['-n', '19', 'chromium', '--headless=new', '--no-sandbox', '--hide-scrollbars',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1400,800', `--remote-debugging-port=${CDP}`, `--user-data-dir=/tmp/claude-1000/carshot-${CDP}`, 'about:blank'],
  { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 60 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { await sleep(250); } }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
const outDir = path.join(new URL('.', import.meta.url).pathname, 'shots');
fs.mkdirSync(outDir, { recursive: true });
for (const name of opt.angles.split(',')) {
  const [y, p, d] = ANGLES[name] || ANGLES.hero;
  const url = `http://localhost:${opt.port}/carview.html?yaw=${y}&pitch=${p}&dist=${d}${opt.q ? '&' + opt.q : ''}`;
  await send('Page.navigate', { url });
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    await sleep(500);
    ok = (await send('Runtime.evaluate', { expression: '!!window.__carview', returnByValue: true })).result?.value;
  }
  await sleep(1500);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(outDir, `${opt.out}-${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log(ok ? f : `${f}  (never drew)`);
}
if (errs.length) console.log('errors:\n  ' + [...new Set(errs)].join('\n  '));
ch.kill();
process.exit(0);
