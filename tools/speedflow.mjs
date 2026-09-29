// speedflow.mjs — how fast does 350 km/h LOOK, per camera, by measurement.
//
//   node tools/speedflow.mjs [track:car] [--kmh 350] [--s 300] [--cams 0,1,2,4] [--q a=1] [--shot]
//
// Adam: "make 350 kmh feel like 350 kmh not 40 mph". Feel is a perception, but
// the thing it is built from is geometry and can be measured: how many degrees
// per second the world streams past the eye, and how much of the SCREEN that
// is. This parks the car on a straight at a pinned speed (vx is forced every
// frame, so the rig is exactly what the game draws at that speed), then for
// each rig raycasts up the screen from the bottom edge until it finds the
// first thing that is not your own car — the nearest visible ground — and
// works out how fast that point, and the nearest trackside object at the
// left and right edges, crosses the screen.
//
//   flow      angular speed of that point as seen from the camera, deg/s
//   scr/s     how far it moves ON SCREEN, in screen heights per second
//   dist      how far away the first visible ground is
//
// GPU only (ANGLE on Vulkan, the GTX 1060) — never swiftshader, which starves
// Adam's audio thread if he is driving on the same machine.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ROOT = new URL('../', import.meta.url).pathname;
const PORT = 8175;
const CDP = 9500 + Math.floor(Math.random() * 400);
const args = process.argv.slice(2);
const KNOWN = new Set(['kmh', 's', 'cams', 'q', 'shot', 'wait', 'out', 'base']);
for (const a of args) if (a.startsWith('--') && !KNOWN.has(a.slice(2))) {
  console.error(`unknown flag ${a} (known: ${[...KNOWN].join(', ')})`); process.exit(2);
}
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? true) : d; };
const flagAll = n => args.flatMap((a, i) => a === `--${n}` ? [args[i + 1]] : []);
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--shot')) || 'monza:f1';
const KMH = +flag('kmh', 350), S0 = +flag('s', 300);
const CAMS = String(flag('cams', '0,1,2')).split(',').map(Number);
const SHOT = args.includes('--shot');
const OUTDIR = path.join(os.tmpdir(), 'wdc-shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ensureServer() {
  try { execFileSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${PORT}`], { stdio: 'ignore' }); return null; }
  catch { return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore', detached: true }); }
}
class CDPClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result); return;
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}
async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
        return new CDPClient(ws);
      }
    } catch { /* still starting */ }
    await sleep(250);
  }
  throw new Error('no page');
}

const server = flag('base') ? null : ensureServer();
if (server) await sleep(900);
fs.mkdirSync(OUTDIR, { recursive: true });

// The in-page measurement. Runs against the live View after a real frame.
const MEASURE = `(async () => {
  const T = await import('three');
  // How much the view SHAKES: frame-to-frame change of the view direction
  // in the CAR's frame (so the road curving is not counted), degrees RMS.
  const jit = await new Promise(r => { const a = []; const c0 = window.__wdcView.camera; let prev = null;
    const f = () => { const d = c0.getWorldDirection(new T.Vector3()).applyQuaternion(window.__wdcView.car.getWorldQuaternion(new T.Quaternion()).invert()); if (prev) a.push(Math.acos(Math.min(1, d.dot(prev))) * 180 / Math.PI); prev = d;
      a.length < 60 ? requestAnimationFrame(f) : r(Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)); }; requestAnimationFrame(f); });
  // What the edge blur costs: wall time of SpeedBlur.render with a gl.finish()
  // either side, so the GPU work is inside the number, median of 30 frames.
  let blurMs = null;
  const sb = window.__wdcView.speedBlur;
  if (sb) {
    const gl = window.__wdcView.renderer.getContext(), orig = sb.render.bind(sb), ts = [];
    sb.render = (...a) => { gl.finish(); const t0 = performance.now(); orig(...a); gl.finish(); ts.push(performance.now() - t0); };
    await new Promise(r => { const f = () => ts.length < 30 ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); });
    sb.render = orig; ts.sort((x, y) => x - y); blurMs = +ts[15].toFixed(2);
  }
  const fps = await new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1500 ? requestAnimationFrame(f) : r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); });
  const v = window.__wdcView, cam = v.camera, car = window.__wdc.car;
  const rc = new T.Raycaster(); rc.far = 400;
  const own = new Set(); v.car.traverse(o => own.add(o));
  const vel = new T.Vector3(Math.cos(car.hdg) * car.speed, 0, -Math.sin(car.hdg) * car.speed);
  // What the PIXEL shows: the first VISIBLE hit (an object inside a hidden
  // parent is not drawn, so it is not an occluder either). If that is your own
  // car, the pixel shows the car and the ground is further up the screen.
  const shown = o => { for (; o; o = o.parent) if (o.visible === false) return false; return true; };
  const first = () => rc.intersectObjects(v.scene.children, true)
    .find(h => shown(h.object) && !h.object.isPoints && !h.object.isSprite && !h.object.isLine);
  let carPix = 0, pix = 0;
  const hitFrom = (x, y0, y1 = 0.2, step = 0.01) => {
    for (let y = y0; y <= y1; y += step) {
      rc.setFromCamera(new T.Vector2(x, y), cam);
      const h = first();
      pix++;
      if (h && own.has(h.object)) { carPix++; continue; }
      if (h) return { y, h };
    }
    return null;
  };
  // screen velocity of a static world point P for a camera moving at vel
  const flow = (P) => {
    const dt = 1 / 240;
    const a = P.clone().project(cam);
    const c2 = cam.clone(); c2.position.addScaledVector(vel, dt); c2.updateMatrixWorld(true);
    const b = P.clone().project(c2);
    const r0 = P.clone().sub(cam.position).normalize(), r1 = P.clone().sub(c2.position).normalize();
    const ang = Math.acos(Math.min(1, r0.dot(r1))) / dt * 180 / Math.PI;
    // NDC spans 2 per screen height
    const scr = Math.hypot((b.x - a.x) * cam.aspect, b.y - a.y) / 2 / dt;
    return { ang: +ang.toFixed(0), scr: +scr.toFixed(2) };
  };
  const out = { fov: +cam.fov.toFixed(1), eyeY: null, kmh: +(car.speed * 3.6).toFixed(0), fps: +fps.toFixed(1), jit: +jit.toFixed(3), blurMs };
  // eye height above the ground straight below it
  rc.set(cam.position.clone(), new T.Vector3(0, -1, 0));
  const g = rc.intersectObjects(v.scene.children, true).find(h => !own.has(h.object));
  out.eyeY = g ? +g.distance.toFixed(2) : null;
  const dir = cam.getWorldDirection(new T.Vector3());
  out.pitch = +(Math.asin(dir.y) * 180 / Math.PI).toFixed(1);
  const cp = v.car.getWorldPosition(new T.Vector3());
  out.behind = +Math.hypot(cp.x - cam.position.x, cp.z - cam.position.z).toFixed(1);
  for (const [k, x] of [['bottom', 0], ['botL', -0.85], ['botR', 0.85]]) {
    const r = hitFrom(x, -0.999, 0.1, 0.01);
    if (!r) { out[k] = null; continue; }
    const f = flow(r.h.point);
    out[k] = { v: +r.y.toFixed(2), dist: +r.h.distance.toFixed(1), what: r.h.object.name || r.h.object.type, ...f };
  }
  // the nearest trackside thing at each screen edge, mid height
  for (const [k, x] of [['edgeL', -0.98], ['edgeR', 0.98]]) {
    let best = null;
    for (let y = -0.9; y <= 0.3; y += 0.1) {
      rc.setFromCamera(new T.Vector2(x, y), cam);
      const h = first();
      if (h && !own.has(h.object) && (!best || h.distance < best.h.distance)) best = { y, h };
    }
    if (best) out[k] = { v: +best.y.toFixed(1), dist: +best.h.distance.toFixed(1), what: best.h.object.name || best.h.object.type, ...flow(best.h.point) };
  }
  // How much of the lower half of the screen is your own car (a grid of rays).
  let own2 = 0, all2 = 0;
  for (let x = -0.95; x <= 0.95; x += 0.1) for (let y = -0.95; y <= 0; y += 0.1) {
    rc.setFromCamera(new T.Vector2(x, y), cam); const h = first(); all2++; if (h && own.has(h.object)) own2++;
  }
  out.carLowerHalf = Math.round(100 * own2 / all2) + '%';
  return out;
})()`;

const q = new URLSearchParams();
q.set('auto', target); q.set('sound', '0'); q.set('time', '14:00');
for (const chunk of flagAll('q')) for (const [k, val] of new URLSearchParams(chunk || '')) q.set(k, val);
const url = `${flag('base') || `http://127.0.0.1:${PORT}`}/index.html?${q}`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-chrome-'));
const chrome = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--use-angle=vulkan', '--use-gl=angle', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
  '--window-size=1600,900', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
let code = 0;
try {
  const cdp = await connect();
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  for (let i = 0; i < 200; i++) { if (await cdp.eval('!!(window.__wdc && window.__wdcView && window.__wdc.car)')) break; await sleep(400); }
  // Pin the car on the straight at S0, at speed, every frame.
  await cdp.eval(`(() => {
    const v = window.__wdcView, t = v.track, car = window.__wdc.car, V = ${KMH} / 3.6;
    // The car really MOVES at V (so a camera that lags, lags as it would in
    // the game), looping over the same 400 m so every rig sees the same spot.
    const t0 = performance.now();
    const pin = () => {
      const s = ${S0} + ((performance.now() - t0) / 1000 * V) % 400;
      const a = t.point(s, 0), b = t.point(s + 2, 0);
      car.x = a.x; car.y = a.y; car.hdg = Math.atan2(b.y - a.y, b.x - a.x);
      car.vx = V; car.vy = 0; car.r = 0; car.speed = V;
      requestAnimationFrame(pin);
    };
    pin();
  })()`);
  await sleep(+flag('wait', 1500));
  const rows = [];
  for (const m of CAMS) {
    await cdp.eval(`window.__wdcView.setMode(${m})`);
    await sleep(700);
    const r = await cdp.eval(MEASURE);
    const name = await cdp.eval(`(window.__wdcRigs || [])[${m}] || ${m}`);
    rows.push({ cam: name, ...r });
    if (SHOT) {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUTDIR, `${flag('out', 'flow')}-${m}.png`);
      fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
      console.log('  shot ' + f);
    }
  }
  const fmt = o => o ? `${String(o.ang).padStart(4)}°/s ${String(o.scr).padStart(5)} scr/s @${String(o.dist).padStart(5)}m v=${o.v} ${o.what}` : '—';
  console.log(`\n${target} at ${KMH} km/h, s=${S0}`);
  for (const r of rows) {
    console.log(`\n  ${String(r.cam).padEnd(8)} fov ${r.fov}°  eye ${r.eyeY} m  pitch ${r.pitch}°  ${r.behind} m from car  car fills ${r.carLowerHalf} of lower half  (${r.kmh} km/h, ${r.fps} fps, shake ${r.jit}°/frame, blur ${r.blurMs} ms)`);
    console.log(`    nearest ground, bottom centre : ${fmt(r.bottom)}`);
    console.log(`    nearest ground, bottom left   : ${fmt(r.botL)}`);
    console.log(`    nearest ground, bottom right  : ${fmt(r.botR)}`);
    console.log(`    left edge                     : ${fmt(r.edgeL)}`);
    console.log(`    right edge                    : ${fmt(r.edgeR)}`);
  }
  if (cdp.errors.length) { console.log('\n  errors:'); for (const e of cdp.errors.slice(0, 6)) console.log('   ! ' + String(e).slice(0, 200)); code = 1; }
} catch (e) { console.error('speedflow failed:', e.message); code = 2; }
finally {
  chrome.kill('SIGKILL');
  if (server) try { process.kill(-server.pid); } catch { /* gone */ }
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
