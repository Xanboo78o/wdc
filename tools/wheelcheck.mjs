// wheelcheck.mjs — the phone wheel end to end, with no phone.
//
//   node tools/wheelcheck.mjs
//
// Opens the track builder (the game side) and the REAL phone page, wheel.html,
// in one headless chromium; taps CONNECT on the phone page and feeds it
// synthetic devicemotion events — gravity rotated by a known angle, which is
// exactly what tilting a phone produces — then reads what arrived in the game
// through Supabase. Proves the protocol, the channel naming and the sign
// maths together. What it cannot prove: iOS's motion-permission prompt, and
// how a real phone's sensor feels in the hand.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

if (process.argv.length > 2) { console.error(`unknown flag ${process.argv[2]}`); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-wheel-'));
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1280,720', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  'http://127.0.0.1:8176/build.html?lo=1',
], { stdio: 'ignore' });

async function attach(match) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.url.includes(match) && t.webSocketDebuggerUrl);
      if (p) {
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        let id = 0; const pending = new Map();
        ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
        const send = (method, params = {}) => new Promise(r => { const k = ++id; pending.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
        const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
        return { ws, send, ev };
      }
    } catch { /* coming up */ }
    await sleep(250);
  }
  throw new Error('no page matching ' + match);
}

let ok = true;
const check = (cond, msg) => { console.log((cond ? 'ok    ' : 'FAIL  ') + msg); if (!cond) ok = false; };
try {
  const game = await attach('build.html');
  let st = null;
  for (let i = 0; i < 120; i++) { st = await game.ev('window.__phone && JSON.parse(JSON.stringify(window.__phone))'); if (st && st.status === 'waiting') break; await sleep(500); }
  check(st && st.status === 'waiting', `game listening on its channel (status ${st && st.status}, code ${st && st.code})`);
  const code = st.code;

  await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:8176/wheel.html?code=${code}`)}`, { method: 'PUT' });
  const ph = await attach('wheel.html');
  for (let i = 0; i < 40 && !(await ph.ev('!!window.supabase')); i++) await sleep(250);
  // Tilt the phone by overriding the browser's accelerometer, so the page
  // gets TRUSTED sensor readings exactly as a phone delivers them. Dispatching
  // synthetic events instead is not enough on this laptop: a Surface Book 2
  // has a real accelerometer that chromium reads, and its upright-screen
  // gravity (0, 9.4) kept arriving between the fake ones and winning.
  const o = await ph.send('Emulation.setSensorOverrideEnabled', { enabled: true, type: 'accelerometer' });
  if (o === undefined) throw new Error('accelerometer override not available in this chromium');
  const tilt = async deg => {
    const a = (180 + deg) * Math.PI / 180;
    await ph.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: { xyz: { x: 9.81 * Math.sin(a), y: 9.81 * Math.cos(a), z: 0 } } });
    await sleep(700);                          // let the low-pass settle
    return ph.ev(`document.getElementById('deg').textContent`);
  };
  await tilt(0);                           // the reading the phone centres on
  await ph.ev(`document.getElementById('go').click()`);
  // sensor readings start arriving ~1 s after the page asks for them, so the
  // first one — which the page centres on — can be late. Wait for them to
  // flow, then press CENTRE HERE at 0, exactly as you would on the phone.
  for (let i = 0; i < 40 && !(await ph.ev('primed')); i++) await sleep(250);
  await sleep(500);
  await ph.ev(`document.getElementById('centre').click()`);
  await sleep(500);
  // record everything the phone page sends, to see what the game should get
  await ph.ev(`(() => { const s0 = channel.send.bind(channel); window.__sent = [];
    channel.send = m => { if (m.event === 'steer') window.__sent.push(m.payload.v); return s0(m); }; return true; })()`);
  for (let i = 0; i < 40; i++) { st = await game.ev('JSON.parse(JSON.stringify(window.__phone))'); if (st.connected) break; await sleep(250); }
  check(st.connected, 'phone page connected to the game');
  let status = '';
  for (let i = 0; i < 20 && !/Connected/.test(status); i++) { status = await ph.ev(`document.getElementById('status').textContent`); await sleep(250); }
  check(/Connected/.test(status), `phone page says: "${status}"`);

  for (const [deg, want] of [[14, 0.5], [-14, -0.5], [28, 1], [0, 0]]) {
    const label = await tilt(deg);
    const at0 = await ph.ev('JSON.stringify({fx, fy, zero, steer})');
    await sleep(900);
    const at1 = await ph.ev('JSON.stringify({fx, fy, zero, steer})');
    if (process.env.WHEEL_DEBUG) console.log('      right after:', at0, '\n      900 ms later:', at1);
    st = await game.ev('JSON.parse(JSON.stringify(window.__phone))');
    const sent = await ph.ev('window.__sent.splice(0)');
    console.log(`      phone sent ${sent.length}: ${sent.slice(0, 6).join(' ')} … ${sent.slice(-3).join(' ')}`);
    check(Math.abs(st.steer - want) < 0.05, `tilt ${String(deg).padStart(3)}° (sens 28) -> phone shows "${label}", game got ${st.steer.toFixed(3)} (want ${want})`);
  }
  const toast = await game.ev(`document.getElementById('msg').textContent`);
  check(/PHONE WHEEL CONNECTED/.test(toast), `builder toast: "${toast}"`);
  game.ws.close(); ph.ws.close();
} catch (e) { console.log('FAIL  ' + e.message); ok = false; }
chrome.kill();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* letting go */ }
console.log(ok ? '\nphone wheel works end to end' : '\nFAILED');
process.exit(ok ? 0 : 1);
