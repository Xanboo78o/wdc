// adshot.mjs — photographs of the two adverts, and a measurement of their sound.
//
//   node tools/adshot.mjs cinematic 2,9,17.5,33      frames at those seconds
//   node tools/adshot.mjs deadpan 0:70:5            every 5 s from 0 to 70
//   node tools/adshot.mjs cinematic --audio          render the score offline, print loudness, save a WAV
//   node tools/adshot.mjs deadpan 12 --q lo=1        pass ?lo=1 through (no woods: fast framing)
//   node tools/adshot.mjs cinematic 12 --eval "__adNow"
//   node tools/adshot.mjs deadpan --play 8 --q "t=20&lo=1"   click PRESS TO PLAY and watch the clock run
//
// One headless Chromium (SwiftShader — never the real GPU from here), one page
// load, then window.__adSeek(t) per frame. Console errors are printed, because
// a black frame and a broken frame look the same. PNGs land in --out
// (default /tmp/xbr-ads). Starts its own http.server on 8191 if none is up.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
const KNOWN = new Set(['--out', '--q', '--size', '--eval', '--audio', '--port', '--tag', '--play']);
for (const a of args) if (a.startsWith('--') && !KNOWN.has(a)) { console.error('unknown flag ' + a); process.exit(2); }
const flag = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--q', '--size', '--eval', '--port', '--tag', '--play'].includes(args[i - 1])));
const which = pos[0];
if (!['cinematic', 'deadpan'].includes(which)) { console.error('usage: adshot.mjs cinematic|deadpan [times] [--audio]'); process.exit(2); }
const AUDIO = args.includes('--audio');
const PLAY = flag('play') ? +flag('play') : 0;     // --play 8: click the card and let it run 8 s of wall time
let times = [];
for (const part of (pos[1] || '').split(',').filter(Boolean)) {
  if (part.includes(':')) { const [a, b, st] = part.split(':').map(Number); for (let t = a; t <= b + 1e-9; t += st || 1) times.push(+t.toFixed(3)); }
  else times.push(+part);
}
const OUT = flag('out', '/tmp/xbr-ads');
const PORT = +flag('port', 8191);
const [W, H] = flag('size', '1600x900').split('x').map(Number);
const TAG = flag('tag', '');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// refuse to load the machine while the owner's game is running
try { execFileSync('pgrep', ['-x', 'xbr'], { stdio: 'ignore' }); console.error('xbr is running — not starting a headless render. Try again later.'); process.exit(3); } catch { /* not running */ }

let server = null;
try { execFileSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${PORT}`], { stdio: 'ignore' }); }
catch { server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' }); await sleep(900); }

const q = new URLSearchParams(flag('q', '') || '');
if (!PLAY) q.set('frame', String(times[0] ?? 0));
const url = `http://127.0.0.1:${PORT}/ad-${which}.html?${q}`;
const CDP = 9500 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'adshot-'));
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--autoplay-policy=no-user-gesture-required',
  `--window-size=${W},${H}`, `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, url,
], { stdio: ['ignore', 'ignore', 'ignore'] });

const errors = [], logs = [];
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(method + ' timed out')); } }, 600000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let code = 0;
const T0 = Date.now(), el = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
try {
  for (let i = 0; i < 80 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }); }
    } catch { /* still starting */ }
    if (!ws) await sleep(250);
  }
  if (!ws) throw new Error('chromium never opened a page');
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); return; }
    if (d.method === 'Runtime.consoleAPICalled') {
      const txt = (d.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
      logs.push(d.params.type + ': ' + txt);
      if (d.params.type === 'error' || d.params.type === 'warning') errors.push(d.params.type + ': ' + txt);
    }
    if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; errors.push('EXCEPTION: ' + (x.exception?.description || x.text)); }
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push('LOG: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload');          // so the console is captured from the first line
  let ready = false;
  for (let i = 0; i < 1200; i++) {
    await sleep(500);
    try { ready = await ev('!!window.__adReady'); } catch { /* navigating */ }
    if (ready) break;
    if (errors.some(e => e.startsWith('EXCEPTION'))) break;
  }
  if (!ready) throw new Error('page never became ready');
  console.log(`[${el()}] ready: ${JSON.stringify(await ev('window.__adInfo'))}  gpu-errors:${JSON.stringify(await ev('window.__adErrors'))}`);
  if (flag('eval')) console.log('eval:', JSON.stringify(await ev(flag('eval')), null, 1));
  if (PLAY) {
    const before = await ev('JSON.stringify(window.__adNow)');
    await ev('document.getElementById("card").click()');
    const seen = [];
    for (let k = 0; k < PLAY; k++) { await sleep(1000); seen.push(await ev('JSON.stringify([window.__adNow.T, window.__adNow.shot])')); }
    console.log('before click:', before);
    console.log('playing:', seen.join('  '));
    console.log('perf:', JSON.stringify(await ev('window.__adPerf || null')), ' card gone:', await ev('document.getElementById("card").classList.contains("gone")'));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, `${which}-play.png`); fs.writeFileSync(f, Buffer.from(shot.data, 'base64')); console.log(f);
  } else if (AUDIO) {
    const r = await ev('window.__adAudioTest().then(r => r)');
    const { perSec, ...head } = r;
    console.log('audio:', JSON.stringify(head));
    console.log('loudness per second (dB RMS / peak):');
    console.log(perSec.map(p => `${String(p.s).padStart(2)}s ${String(p.rms).padStart(6)} ${p.peak.toFixed(2)} ${'#'.repeat(Math.max(0, Math.round((p.rms + 60) / 2)))}`).join('\n'));
    const w = await ev('import("./js/ads/synth.js").then(m => m.renderOffline(window.__adScore, window.__adInfo.duration + 2, { wav: true })).then(r => r.wav)');
    const f = path.join(OUT, `ad-${which}.wav`); fs.writeFileSync(f, Buffer.from(w, 'base64')); console.log('wav:', f);
  } else {
    for (const t of times) {
      const now = await ev(`window.__adSeek(${t})`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(OUT, `${which}${TAG ? '-' + TAG : ''}-${String(t).replace('.', '_').padStart(5, '0')}.png`);
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
      console.log(`[${el()}] ${f}  ${JSON.stringify(now)}`);
    }
  }
} catch (e) { console.error('FAILED:', e.message); code = 1; }
const uniq = [...new Set(errors)];
if (uniq.length) { console.log(`console (${uniq.length}):`); for (const e of uniq.slice(0, 30)) console.log('  ' + e.slice(0, 400)); } else console.log('console: clean');
try { ws && ws.close(); } catch { /* gone */ }
chrome.kill('SIGKILL');
if (server) server.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* fine */ }
process.exit(code);
