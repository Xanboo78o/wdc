// speedmix.mjs — MEASURE the sound of speed (js/speedsound.js) against the engine.
//
//   node tools/speedmix.mjs            all three renders: engine only, speed only, both
//   node tools/speedmix.mjs all|engine|speed
//
// Renders tools/speedmix.html (an OfflineAudioContext run down Monza's main
// straight at 150/250/350 km/h, then a rival passing) in headless chromium
// and prints loudness, high-band energy, the rail-post pulse rate, the L/R
// balance of the pass and clipped samples. Needs :8175 serving the repo.
// Audio only (no WebGL) and niced, but still: not while Adam is driving.
import { spawn } from 'child_process';
import os from 'os';
const TRACK = (process.argv.find(a => a.startsWith('--track=')) || '--track=monza').slice(8);
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--track='));
for (const a of ARGS) if (!['all', 'engine', 'speed', 'speed:wind', 'speed:hiss', 'speed:walls', 'speed:rivals', 'speed:kerb', 'speed:bumps'].includes(a)) { console.error('unknown mode ' + a + ' (all|engine|speed)'); process.exit(2); }
const modes = ARGS.length ? ARGS : ['engine', 'speed', 'all'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 150);
for (const mode of modes) {
  const U = os.tmpdir() + '/wdc-speedmix-' + process.pid + mode;
  const ch = spawn('nice', ['-n', '19', 'chromium', '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${U}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = l.find(x => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(300); }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; const logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400)); };
  const call = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await call('Runtime.enable'); await call('Page.enable');
  await call('Page.navigate', { url: `http://localhost:8175/tools/speedmix.html?track=${TRACK}#${mode}` });
  let txt = '';
  for (let i = 0; i < 300; i++) { await sleep(500); const r = await call('Runtime.evaluate', { expression: "document.title==='done'?document.body.innerText:''" }); txt = r.result?.result?.value || ''; if (txt) break; }
  console.log((txt || 'TIMEOUT ' + mode) + '\n'); for (const l of logs) console.log(l);
  ch.kill();
  await sleep(300);
}
process.exit(0);
