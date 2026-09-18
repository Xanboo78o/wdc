// shot.mjs — my eyes on this project.
//
//   node tools/shot.mjs [track:car] [--photo s,lat,y,lead] [--out name] [--wait ms] [--lo]
//
//   node tools/shot.mjs monza:f1
//   node tools/shot.mjs monza:f1 --photo 5350,-14,3,40 --out pits
//   node tools/shot.mjs --quick --all          # does every circuit still load?
//   node tools/shot.mjs zandvoort:f4 --photo 430,0,9,60 --out tarzan
//
// I cannot look at a screen, so every claim about how this looks has to come
// back through a file I can actually read. Chromium's plain `--screenshot`
// flag is not enough: it fires on load, before a texture set and a sky have
// come off the network and before a single frame has been drawn, so it
// photographs an empty canvas and calls it done.
//
// This drives the browser over the DevTools protocol instead, which gets three
// things that matter:
//
//   1. It waits for the WORLD to exist — render.js publishes `window.__wdc`
//      once the circuit is built, and this polls for it. No arbitrary sleep.
//   2. It reports console errors and uncaught exceptions. A black screenshot
//      and a broken screenshot look identical; the exception list is what
//      tells them apart.
//   3. It can put the camera anywhere via `--photo`, so the pit lane and the
//      far side of the circuit can be inspected without driving there.
//
// Node 22+ has a built-in WebSocket, so this needs no dependencies, which is
// the same reason this project has no build step.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = path.join(os.tmpdir(), 'wdc-shots');
const PORT = 8175, CDP = 9222;

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
// Positional args are anything not starting with `--` and not sitting in the
// slot right after a flag that takes a value.
const VALUE_FLAGS = new Set(['photo', 'out', 'wait', 'q', 'probe', 'base']);
// --quick loads the page, waits for the world to exist, reports console errors
// and exits. No frame-rate probe, no screenshot, about six seconds instead of
// ninety.
//
// It exists because of a thing that happened twice in one afternoon, once to
// each session working on this repo: both of us destroyed code we had not read
// — one by slicing a file between two landmarks, one by `git checkout` over an
// uncommitted file — and NEITHER of us caught it by being careful. One
// surfaced as a ReferenceError on load, the other as a hunch-grep. The load
// check is the net, not the care. So it has to be cheap enough to run on every
// edit rather than once before a push.
const QUICK = args.includes('--quick');
const ALL = args.includes('--all');
const positional = args.filter((a, i) => !a.startsWith('--') &&
  !(i > 0 && args[i - 1].startsWith('--') && VALUE_FLAGS.has(args[i - 1].slice(2))));
const TRACKS = ['monza', 'zandvoort', 'suzuka', 'baku', 'monaco'];
const targets = ALL ? TRACKS.map(t => `${t}:f1`) : [positional[0] || 'monza:f1'];
const target = targets[0];
const photo = flag('photo');
const outName = flag('out', target.replace(':', '-'));
const waitMs = +flag("wait", 1200);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- the page server, started only if nothing is already listening ---------
function ensureServer() {
  try {
    execFileSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${PORT}`], { stdio: 'ignore' });
    return null;
  } catch {
    const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
      { cwd: ROOT, stdio: 'ignore', detached: true });
    return p;
  }
}

// --- a minimal DevTools protocol client ------------------------------------
class CDPClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.console = []; this.errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        const txt = (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
        this.console.push(`${m.params.type}: ${txt}`);
        if (m.params.type === 'error' || m.params.type === 'warning') this.errors.push(txt);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push(`${d.text} ${d.exception?.description || ''}`.trim());
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push(`${m.params.entry.source}: ${m.params.entry.text}`);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); }
      }, 60000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

async function connect(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDPClient(ws);
      }
    } catch { /* chromium is still coming up */ }
    await sleep(250);
  }
  throw new Error('chromium never opened a debuggable page');
}

// ---------------------------------------------------------------------------
// --base https://xanboo78o.github.io/wdc  shoots the LIVE site instead of the
// working copy. Worth doing after a push: a path that works off the local
// filesystem and 404s on Pages is a real class of bug, and so is an old module
// served from cache.
// --all runs the same check once per circuit, each in its own browser, because
// a module that breaks only at Monaco is exactly the kind of thing a single
// Monza check misses.
if (ALL) {
  const { spawnSync } = await import('child_process');
  let bad = 0;
  console.log(`load check, ${TRACKS.length} circuits:`);
  for (const t of targets) {
    const r = spawnSync(process.execPath,
      [new URL(import.meta.url).pathname, t, ...args.filter(a => a !== '--all')],
      { stdio: 'inherit' });
    if (r.status) bad++;
  }
  console.log(bad ? `\n${bad} circuit(s) FAILED` : '\nall circuits load clean');
  process.exit(bad ? 1 : 0);
}

const base = flag('base');
const server = base ? null : ensureServer();
if (server) await sleep(900);

fs.mkdirSync(OUT, { recursive: true });
const q = new URLSearchParams();
q.set('auto', target);
if (flag('lo')) q.set('lo', '1');
if (photo) q.set('photo', photo);
// --q a=1&b=2 passes anything else straight through to the page, which is how
// a system gets switched off for one shot to find out what it was responsible
// for.
for (const [k, v] of new URLSearchParams(flag('q', '') || '')) q.set(k, v);
const url = `${base || `http://127.0.0.1:${PORT}`}/index.html?${q}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-chrome-'));
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  // SwiftShader, because this machine has no GPU available to headless
  // chromium. It is slow but it is a real GL implementation, so what it draws
  // is what a real browser draws.
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--hide-scrollbars', '--mute-audio', '--disable-extensions',
  '--window-size=1600,900', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, url,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', d => { chromeErr += d.toString(); });

let code = 0;
try {
  const cdp = await connect(url);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  // Wait for the world, not for the clock. render.js sets window.__wdc when
  // the circuit has actually finished building.
  let stats = null;
  for (let i = 0; i < 300; i++) {
    stats = await cdp.eval('window.__wdc ? JSON.parse(JSON.stringify(window.__wdc)) : null');
    if (stats) break;
    await sleep(400);
  }
  if (QUICK) {
    const errs = [...new Set(cdp.errors)].filter(e => !/favicon|PHONE_REGISTRATION|DEPRECATED_ENDPOINT/.test(e));
    const ms = await cdp.eval('window.__wdcBuildMs || 0');
    const label = `${target.padEnd(16)} build ${String(ms).padStart(5)} ms`;
    if (!stats) { console.log(`  FAIL ${label}  world never built`); code = 1; }
    else if (errs.length) {
      console.log(`  FAIL ${label}  ${errs.length} console error(s)`);
      for (const e of errs.slice(0, 6)) console.log('       ! ' + e.slice(0, 200));
      code = 1;
    } else {
      console.log(`  ok   ${label}  ${stats.draws || '?'} draws`);
    }
    throw { quick: true };
  }

  // Then let it draw a few frames, so nothing is caught mid-upload — and read
  // the stats again afterwards, because the draw-call and triangle counts only
  // exist once there has been a frame to count.
  await sleep(waitMs);
  stats = await cdp.eval('window.__wdc ? JSON.parse(JSON.stringify(window.__wdc)) : null') || stats;

  const fps = await cdp.eval(`(async () => {
    let n = 0; const t0 = performance.now();
    await new Promise(r => { const tick = () => { n++; performance.now() - t0 < 1500 ? requestAnimationFrame(tick) : r(); }; requestAnimationFrame(tick); });
    return +(n / ((performance.now() - t0) / 1000)).toFixed(1);
  })()`).catch(() => null);

  // --probe u,v raycasts through a point on the screen (0,0 = centre, 1,1 =
  // top right) and says what is actually there. A screenshot shows you a black
  // rectangle; this tells you which mesh it is and how far away.
  const probe = flag('probe');
  if (probe) {
    const [u, v] = String(probe).split(',').map(Number);
    const hits = await cdp.eval(`window.__wdcProbe ? JSON.stringify(window.__wdcProbe(${u || 0}, ${v || 0})) : '"no probe hook"'`)
      .catch(e => '"probe failed: ' + e.message + '"');
    console.log('  probe ' + (probe) + ': ' + hits);
  }

  // Report what we know BEFORE the screenshot. A capture that times out used
  // to tell you nothing at all; the build stats and the frame time say whether
  // the world failed to build or is simply taking a minute to draw.
  if (stats) console.log('  world: ' + JSON.stringify(stats));
  console.log(`  build ${await cdp.eval('window.__wdcBuildMs || 0')} ms` +
    (fps != null ? `, ${fps} fps` : ', frame rate unmeasurable'));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${outName}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

  console.log(`\n${file}`);
  console.log(`  ${target}${photo ? `  photo ${photo}` : ''}   ${fps != null ? fps + ' fps (swiftshader, not a real GPU)' : ''}`);
  if (stats) console.log('  world: ' + JSON.stringify(stats));
  else console.log('  WORLD NEVER BUILT — window.__wdc is still undefined');

  const errs = [...new Set(cdp.errors)].filter(e => !/favicon|PHONE_REGISTRATION|DEPRECATED_ENDPOINT/.test(e));
  if (errs.length) {
    console.log(`\n  ${errs.length} console error(s):`);
    for (const e of errs.slice(0, 14)) console.log('   ! ' + e.slice(0, 220));
    code = 1;
  } else {
    console.log('  no console errors');
  }
} catch (e) {
  // The quick path finishes by throwing a sentinel to skip the screenshot; it
  // has already decided its own exit code and must not be reported as a crash.
  if (e && e.quick) { /* handled above */ }
  else {
    console.error('shot failed:', e.message);
    if (chromeErr) console.error(chromeErr.split('\n').filter(l => /ERROR/.test(l)).slice(0, 6).join('\n'));
    code = 2;
  }
} finally {
  chrome.kill('SIGKILL');
  if (server) try { process.kill(-server.pid); } catch { /* already gone */ }
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
