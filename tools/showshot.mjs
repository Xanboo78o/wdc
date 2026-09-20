// showshot.mjs — eyes for any page in this repo, gameshow.html especially.
// A sibling of tools/buildshot.mjs (which is hardwired to build.html and
// belongs to the other session); this one takes --page and waits for whichever
// global that page publishes.
//
// Headless chromium
// over CDP: loads the page, waits for window.__build, reports console errors,
// saves a screenshot.
//
//   node tools/buildshot.mjs [--q "cam=350,60,20,15"] [--q drive=1] [--out name] [--wait 1500]
//
// Every --q is merged (shot.mjs once dropped all but the first and nobody
// noticed for a day — see [[silently-ignored-input]]). Unknown flags are an
// error for the same reason.
//
// A screenshot proves a thing RENDERS, never that it HAPPENS: swiftshader runs
// this at a frame or two a second.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const argv = process.argv.slice(2);
const opts = { q: [], out: "show", wait: 1500, port: 8176, page: "gameshow.html", flag: "__show" };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--q') opts.q.push(argv[++i]);
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '--wait') opts.wait = +argv[++i];
  else if (a === '--port') opts.port = +argv[++i];
  else if (a === '--page') opts.page = argv[++i];
  else if (a === '--flag') opts.flag = argv[++i];
  // --gpu: drop the swiftshader flags and render on the real hardware, and
  // --nvidia: do that on the discrete card via PRIME offload. The point of
  // both is to find out what the machine can actually do, which no
  // swiftshader run can ever tell you.
  else if (a === '--size') opts.size = argv[++i];
  else if (a === '--gpu') opts.gpu = true;
  else if (a === '--nvidia') { opts.gpu = true; opts.nvidia = true; }
  else { console.error(`unknown flag ${a}`); process.exit(2); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = new URL('../', import.meta.url).pathname;
const OUT = path.join(root, 'tools', 'shots');
fs.mkdirSync(OUT, { recursive: true });

// start the no-cache server if nothing is listening
try { await fetch(`http://127.0.0.1:${opts.port}/${opts.page}`); }
catch {
  spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(opts.port)], { stdio: 'ignore', detached: true }).unref();
  await sleep(700);
}

// Gates run the cheap viewport by default: the look pass added a 9k-tree
// forest and 811 props, and headless swiftshader draws that at a fraction of
// a frame per second, which turns every check into a timeout. Pass
// No flat/noprops default here, unlike buildshot.mjs: this tool exists to
// photograph the LOOK of a thing, so it has to load the textures.
const qs = new URLSearchParams();
for (const chunk of opts.q) for (const [k, v] of new URLSearchParams(chunk)) qs.set(k, v);
const url = `http://127.0.0.1:${opts.port}/${opts.page}?${qs}`;
const CDP = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-build-'));
const env = { ...process.env };
if (opts.nvidia) {
  env.__NV_PRIME_RENDER_OFFLOAD = '1';
  env.__GLX_VENDOR_LIBRARY_NAME = 'nvidia';
  env.__EGL_VENDOR_LIBRARY_FILENAMES = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
}
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  ...(opts.gpu ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']),
  '--hide-scrollbars', '--mute-audio', `--window-size=${opts.size || '1600,900'}`,
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, url,
], { stdio: 'ignore', env });

let id = 0;
const pending = new Map(), errors = [];
let ws;
for (let i = 0; i < 80 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    }
  } catch { ws = null; }
  if (!ws) await sleep(250);
}
if (!ws) { console.error('chromium never opened a page'); chrome.kill(); process.exit(1); }
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise(r => { const k = ++id; pending.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
const evalJs = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

const t0 = Date.now();
let stats = null;
while (Date.now() - t0 < 60000) {
  stats = await evalJs(`window.${opts.flag} || null`);
  if (stats || errors.some(e => !/favicon/.test(e) && /SyntaxError|ReferenceError|TypeError|export named|Failed to/.test(e))) break;
  await sleep(300);
}
if (stats) await sleep(opts.wait);
// Read the flag AGAIN after the wait: a frame rate does not exist on frame
// two, and it is the one number a screenshot cannot carry.
const after = await evalJs(`window.__perf || window.${opts.flag} || null`);
if (after) console.log('after ' + JSON.stringify(after));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const file = path.join(OUT, `${opts.out}.png`);
fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
const errs = [...new Set(errors)].filter(e => !/favicon/.test(e));
console.log(stats ? `ok   ${JSON.stringify(stats)}` : 'FAIL page never finished building');
for (const e of errs.slice(0, 8)) console.log('  ! ' + String(e).slice(0, 300));
console.log(`     ${file}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
ws.close(); chrome.kill();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chromium still letting go */ }
process.exit(stats && !errs.length ? 0 : 1);
