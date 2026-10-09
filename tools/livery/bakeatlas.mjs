// bakeatlas.mjs — draw the sticker sheet.   node tools/livery/bakeatlas.mjs
//
// Writes data/livery/atlas.png (4096x2048, every sponsor as a die-cut plate and
// as cut vinyl, the race numbers, the panels, the scrutineering decals) and
// data/livery/atlas.json (where each one is). The drawing is done by a real
// browser canvas — tools/livery/atlas.html — because that is where the game's
// own typefaces and letter-spacing live; this file only serves the page to a
// headless chromium and reads the picture back.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, CDP = 9400 + Math.floor(Math.random() * 80);
const page = process.argv[2] || 'tools/livery/atlas.html', key = process.argv[3] || '__atlas';
const ch = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,700', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/claude-1000/atlas-${CDP}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 80 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { await sleep(250); } }
if (!tabs) { console.error('bakeatlas: chromium did not start'); ch.kill(); process.exit(1); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/${page}` });
let ok = false;
for (let i = 0; i < 240 && !ok && !errs.length; i++) { await sleep(250); ok = (await send('Runtime.evaluate', { expression: `!!window.${key}`, returnByValue: true })).result?.value; }
if (!ok) { console.error('bakeatlas: the page never finished\n  ' + errs.join('\n  ')); ch.kill(); server.close(); process.exit(1); }
const out = (await send('Runtime.evaluate', { expression: `JSON.stringify(window.${key})`, returnByValue: true })).result.value;
ch.kill(); server.close();
const A = JSON.parse(out);
if (key !== '__atlas') { process.stdout.write(out); process.exit(0); }
fs.mkdirSync(ROOT + 'data/livery', { recursive: true });
fs.writeFileSync(ROOT + 'data/livery/atlas.png', Buffer.from(A.png.split(',')[1], 'base64'));
fs.writeFileSync(ROOT + 'data/livery/atlas.json', JSON.stringify({ size: A.size, cells: A.cells }));
console.log(`data/livery/atlas.png  ${A.size.join('x')}  ${A.n} stickers  ${(fs.statSync(ROOT + 'data/livery/atlas.png').size / 1024).toFixed(0)} KB` + (errs.length ? '\n  page errors: ' + errs.join('; ') : ''));
process.exit(0);
