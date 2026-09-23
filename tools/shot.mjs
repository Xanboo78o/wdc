// shot.mjs — my eyes on this project.
//
//   node tools/shot.mjs [track:car] [--photo s,lat,y,lead] [--out name] [--wait ms] [--lo] [--gpu]
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
const PORT = 8175;
// A UNIQUE debugging port per run.
//
// The port was fixed at 9222, which is fine alone and wrong the moment two
// runs overlap — and two sessions work in this repo at once, so they do. A
// second run cannot bind the port and attaches to the FIRST run's browser
// instead, reporting numbers about a page nobody asked for.
//
// (I first blamed this for a 0.87 s failure path that looked too fast to be
// real. It was not the cause: tracing showed both paths attach at 0.3 s and
// the 0.87 s was simply the early-bail below working. The port is still worth
// randomising for the concurrency reason, but that is the honest reason.)
const CDP = 9500 + Math.floor(Math.random() * 400);

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
// EVERY occurrence, not just the first.
//
// `--q a=1 --q b=2` silently used only `a=1` and threw `b=2` away. No error,
// no warning — the page just loaded without the parameter and the screenshot
// came back looking perfectly fine and completely wrong. It cost three
// confident wrong conclusions in a row, including "a flight cannot be
// photographed headless", which is false: the launch parameter was being
// dropped, and once it arrived the car was plainly in the air.
//
// A flag that is ignored in silence is worse than one that errors.
const flagAll = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}`) out.push(args[i + 1]);
  return out;
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
const TRACKS = ['monza', 'zandvoort', 'suzuka', 'baku', 'monaco', 'nurburgring'];
const targets = ALL ? TRACKS.map(t => `${t}:f1`) : [positional[0] || 'monza:f1'];
const target = targets[0];
const photo = flag('photo');
const outName = flag('out', target.replace(':', '-'));
const waitMs = +flag("wait", 1200);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const el = () => `${((Date.now() - T0) / 1000).toFixed(1)}s`;

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
  for (let i = 0; i < 80; i++) {
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
for (const chunk of flagAll('q')) {
  for (const [k, v] of new URLSearchParams(chunk || '')) q.set(k, v);
}
const url = `${base || `http://127.0.0.1:${PORT}`}/index.html?${q}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-chrome-'));
// --gpu SHOOTS ON THE CARD THE GAME IS PLAYED ON.
//
// The line above this one used to say "this machine has no GPU available to
// headless chromium". That was never true, it was only untried: this laptop
// has a GeForce GTX 1060 behind an Intel UHD 620, and chromium takes the
// Intel one unless DRI_PRIME says otherwise. Measured on Monza, vsync on:
// Intel 112 ms a frame, GeForce 16.6 ms.
//
// It matters for a SCREENSHOT and not just for frame rate. SwiftShader is a
// different implementation — anisotropic filtering, texture LOD and float
// precision are all its own — so a colour matched against a SwiftShader
// capture is a colour matched against a renderer nobody plays on. Anything
// judging how the game LOOKS wants --gpu; anything asking whether it still
// loads does not care and is faster without it.
// ANGLE's VULKAN backend, which finds the GeForce by itself and needs no
// DRI_PRIME. The obvious route — DRI_PRIME=1 with the GL backend — also gets
// the card, at 60 fps, and then dies on the way back: it reaches the GeForce
// through Mesa's zink (GL emulated on Vulkan), and zink loses the device on
// readback, so `Page.captureScreenshot` times out and you get a tool that
// renders perfectly and cannot hand you a picture. Vulkan direct does both.
const GPU = args.includes('--gpu');
const gl = GPU
  ? ['--use-angle=vulkan', '--use-gl=angle']
  : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  ...gl,
  '--hide-scrollbars', '--mute-audio', '--disable-extensions',
  '--window-size=1600,900', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, url,
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', d => { chromeErr += d.toString(); });

let code = 0;
try {
  const cdp = await connect(url);
  // WDC_TRACE=1 prints elapsed time at each stage. Worth knowing what the
  // numbers mean: attach is ~0.3 s, `build` is only `_world()`, and the ~14 s
  // between them on a clean run is asset loading, the racing-line solve and
  // SwiftShader compiling shaders — none of which a real browser pays.
  if (process.env.WDC_TRACE) console.log(`  [${el()}] attached`);
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  // Wait for the world, not for the clock. render.js sets window.__wdc when
  // the circuit has actually finished building.
  // A failed ES module import throws within about a second and the world then
  // never builds, so every failure used to pay the FULL ceiling — which at 300
  // iterations was two minutes per circuit, or ten for --all. That is long
  // enough that the next person assumes the tool has hung rather than that the
  // code is broken, which makes the check worse than useless.
  //
  // Two changes. The ceiling is 24 s, not 120: a clean build is 1.2 s and the
  // loop exits the moment __wdc appears, so the ceiling is paid ONLY by the
  // failure case. And a hard load error breaks out immediately, because once a
  // module has failed to import the world is never going to build and waiting
  // is pure cost.
  const FATAL = /does not provide an export|SyntaxError|ReferenceError|Failed to (fetch|resolve)|Cannot find module|Unexpected token|Importing a module script failed/i;
  let stats = null, fatal = null;
  for (let i = 0; i < 60; i++) {
    stats = await cdp.eval('window.__wdc ? JSON.parse(JSON.stringify(window.__wdc)) : null');
    if (stats) break;
    fatal = cdp.errors.find(e => FATAL.test(e));
    if (fatal) break;
    await sleep(400);
  }
  if (QUICK) {
    const errs = [...new Set(cdp.errors)].filter(e => !/favicon|PHONE_REGISTRATION|DEPRECATED_ENDPOINT/.test(e));
    const ms = await cdp.eval('window.__wdcBuildMs || 0');
    const label = `${target.padEnd(16)} build ${String(ms).padStart(5)} ms  (${el()} wall)`;
    if (!stats) {
      // PRINT THE ERRORS. The one case where you most want the message was the
      // one case that suppressed it: "world never built" told you nothing,
      // when what was sitting in the buffer was "does not provide an export
      // named 'crushParts'".
      console.log(`  FAIL ${label}  world never built`);
      for (const e of (errs.length ? errs : ['(no console error captured)']).slice(0, 6)) {
        console.log('       ! ' + e.slice(0, 220));
      }
      code = 1;
    } else if (errs.length) {
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

  const drewOn = await cdp.eval(`(() => { const c = document.createElement('canvas');
    const g = c.getContext('webgl2'); if (!g) return 'no webgl';
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`).catch(() => 'unknown');
  console.log('  drawn by: ' + String(drewOn).replace(/^ANGLE \(|\)$/g, ''));

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
