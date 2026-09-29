// debrisaudio.mjs — measure the synthesised debris sounds without hearing them.
//
//   node tools/debrisaudio.mjs
//
// Opens tools/debrisaudio.html in headless chromium (no WebGL, so no GPU and
// no SwiftShader either), which renders each scene through the REAL
// js/debrisaudio.js into an OfflineAudioContext, and prints what it measured:
// peak, RMS, clipped samples, brightness (zero-crossing rate), tail length.
// It asserts only what numbers CAN say — every scene is audible, nothing
// clips, the shard spray is brighter than a wing landing, and a tear-off is
// the loudest thing. Whether it sounds GOOD is Adam's call, on the same page
// with buttons: http://localhost:8175/tools/debrisaudio.html
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = new URL('../', import.meta.url).pathname;
const PORT = 8300 + Math.floor(Math.random() * 200), CDP = 9600 + Math.floor(Math.random() * 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore', detached: true });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-da-'));
const ch = spawn('nice', ['-n', '19', 'chromium', '--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`, `http://127.0.0.1:${PORT}/tools/debrisaudio.html`], { stdio: 'ignore' });
let code = 0;
try {
  await sleep(1500);
  let tabs;
  for (let i = 0; i < 30 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); } catch { await sleep(300); } }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
  const ev = expr => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  let res = null;
  for (let i = 0; i < 60 && !res; i++) { res = (await ev('window.__result || null')).result.result.value; if (!res) await sleep(300); }
  if (!res) throw new Error('page never rendered (window.__result missing)');
  let fails = 0;
  const check = (ok, label) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  for (const [k, v] of Object.entries(res)) console.log(`  ${k.padEnd(28)} peak ${String(v.peak).padEnd(6)} rms ${String(v.rmsDb).padStart(6)} dB  clipped ${v.clipped}  bright ${v.brightHz} Hz  tail ${v.tailS}s`);
  const all = Object.values(res);
  check(all.every(v => v.peak > 0.02), 'every scene is audible');
  check(all.every(v => v.clipped === 0), 'nothing clips');
  check(res['shard spray'].brightHz > res['wing half lands and flops'].brightHz, 'shards are brighter than a wing landing');
  check(res['front wing torn off'].peak >= res['wing half lands and flops'].peak, 'a tear-off is louder than a landing');
  code = fails ? 1 : 0;
  ws.close();
} catch (e) { console.error('debrisaudio:', e.message); code = 2; }
finally { ch.kill('SIGKILL'); try { process.kill(-srv.pid); } catch { /* gone */ } fs.rmSync(prof, { recursive: true, force: true }); }
process.exit(code);
