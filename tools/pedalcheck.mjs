// pedalcheck.mjs — press the key-ladder pedal keys in the REAL track builder
// page (headless chromium over CDP) and read back what the car got.
//
//   node tools/pedalcheck.mjs [--page build.html]
//
// Node tests of js/input.js prove the arithmetic; they cannot prove the keys
// reach it in a browser (focus, listeners, a page that swallows them first).
// This does: real key events in, the HUD's own pedal bars out.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const argv = process.argv.slice(2);
let page = 'build.html';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--page') page = argv[++i];
  else { console.error(`unknown flag ${argv[i]}`); process.exit(2); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8176, CDP = 9300 + Math.floor(Math.random() * 600);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-pedal-'));
const url = `http://127.0.0.1:${PORT}/${page}?drive=1&lo=1&flat=1&noprops=1`;   // the cheap look: gates, not photographs
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1280,720', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, url,
], { stdio: 'ignore' });

let ws;
for (let i = 0; i < 80 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
    const p = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); }
  } catch { ws = null; }
  if (!ws) await sleep(250);
}
let id = 0; const pending = new Map(), errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise(r => { const k = ++id; pending.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
await send('Runtime.enable');

for (let i = 0; i < 200 && !(await ev('!!window.__build')); i++) await sleep(300);
// ...and then for the CAR: ?drive=1 starts asynchronously (aero maps, the
// look), and pressing pedals before it exists reads an empty HUD and shifts
// every later reading by one.
for (let i = 0; i < 200 && !(await ev('!!window.__car')); i++) await sleep(300);
await sleep(800);
const DIG = { Digit1: 49, Digit2: 50, Digit3: 51, Digit8: 56, Digit9: 57, Digit0: 48, KeyW: 87, KeyS: 83 };
const key = (type, code) => send('Input.dispatchKeyEvent', {
  type, code, key: code.replace(/^Digit|^Key/, '').toLowerCase(), windowsVirtualKeyCode: DIG[code], nativeVirtualKeyCode: DIG[code],
});
// Read the CAR, not the HUD. The bars are written once per frame, and with
// the look pass on, a headless frame can be seconds apart — reading the DOM
// caught stale widths and shifted every result by one test.
const bars = () => ev(`({ t: window.__car ? Math.round(window.__car.throttle * 100) + '%' : '',
  b: window.__car ? Math.round(window.__car.brake * 100) + '%' : '',
  speed: window.__car ? Math.round(window.__car.speed * 3.6) : 0,
  driving: document.body.classList.contains('driving'),
  down: window.__hands ? [...window.__hands.down].join('+') : '' })`);

async function hold(codes, label) {
  for (const c of codes) await key('keyDown', c);
  // Step the SIM, don't wait for frames: headless draws this page seconds
  // apart and the pedals ramp in sim time. Two seconds is ten times the ramp.
  await ev('window.__step(1)');
  await ev('window.__step(1)');
  const r = await bars();
  for (const c of codes) await key('keyUp', c);
  await sleep(2500);
  console.log(`${label.padEnd(26)} throttle ${String(r.t).padEnd(5)} brake ${String(r.b).padEnd(5)} speed ${String(r.speed).padEnd(4)} keys the page has down: ${r.down || '(none)'}`);
  return r;
}
console.log(`page ${url}`);
await hold(['KeyW'], 'W (keyboard throttle)');
await hold(['Digit8'], '8 (throttle step 1)');
await hold(['Digit8', 'Digit9', 'Digit0'], '8 9 0 (throttle floored)');
await hold(['Digit1'], '1 (brake step 1)');
await hold(['Digit1', 'Digit2', 'Digit3'], '1 2 3 (brake slam)');
for (const e of errors) console.log('  ! ' + String(e).slice(0, 200));
ws.close(); chrome.kill();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* chromium letting go */ }
