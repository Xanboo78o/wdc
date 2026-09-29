// cheermix.mjs — MEASURE the crowd roar (js/cheer.js) against the engine.
//
//   node tools/cheermix.mjs        a pass
//   node tools/cheermix.mjs big    taking the lead
//
// Renders tools/cheermix.html in headless chromium: an OfflineAudioContext,
// audio only, no WebGL — a few seconds of CPU, niced. Needs the game served
// on :8175. Same driver as tools/audiomix.mjs, on its own debugging port.
import { spawn } from 'child_process';
const mode = process.argv[2] || '';
for (const a of process.argv.slice(2)) if (!['', 'big'].includes(a)) { console.error('unknown mode ' + a); process.exit(2); }
const url = 'http://localhost:8175/tools/cheermix.html' + (mode ? '#' + mode : '');
const U = (await import('os')).tmpdir() + '/wdc-cheermix-' + process.pid;
const ch = spawn('nice', ['-n', '19', 'chromium', '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${U}`, '--remote-debugging-port=9334', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const l = await (await fetch('http://127.0.0.1:9334/json')).json(); const p = l.find(x => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(300); }
await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}; const logs = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400)); if (d.method === 'Runtime.consoleAPICalled') logs.push('LOG ' + d.params.args.map(a => a.value).join(' ')); };
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await call('Runtime.enable'); await call('Page.enable');
await call('Page.navigate', { url });
let txt = '';
for (let i = 0; i < 240; i++) { await sleep(500); const r = await call('Runtime.evaluate', { expression: "document.title==='done'?document.body.innerText:''" }); txt = r.result?.result?.value || ''; if (txt) break; }
console.log(txt || 'TIMEOUT'); for (const l of logs) console.log(l);
ch.kill(); process.exit(0);
