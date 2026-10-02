// tools/ostcheck.mjs [songId|all] — render an OST song headlessly (chromium,
// OfflineAudioContext, via ost.html?check=) and print the numbers I use in place
// of ears: loudness per section, peak, clipping, band balance, tempo, silences.
// Also saves a mono WAV + spectrogram + LUFS into $OST_OUT (default /tmp).
// Runs at nice 19: Adam may be driving on the same 4 cores.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
for (const a of args) if (a.startsWith('--')) { console.error('unknown flag ' + a); process.exit(2); }
if (args.length > 1) { console.error('one song id (or all), nothing else'); process.exit(2); }
const { SONGS } = await import('../js/ost.js');
const which = args[0] || 'all';
if (which !== 'all' && !SONGS[which]) { console.error(`no song "${which}"; have: ${Object.keys(SONGS).join(', ')}`); process.exit(2); }
const ids = which === 'all' ? Object.keys(SONGS) : [which];
const base = process.env.OST_URL || 'http://localhost:3000';
const out = process.env.OST_OUT || '/tmp'; mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(id) {
  const port = 9700 + Math.floor(Math.random() * 200), dir = `${out}/chrome-${Date.now()}`;
  const ch = spawn('nice', ['-n', '19', '/usr/bin/chromium', '--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`, '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { await sleep(300); try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets?.length) break; } catch {} }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let mid = 0; const pending = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++mid; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `${base}/ost.html?check=${id}` });
  let rep = null;
  for (let i = 0; i < 1200; i++) { await sleep(500); const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__CHECK || null)', returnByValue: true }); const v = r.result?.result?.value; if (v && v !== 'null') { rep = JSON.parse(v); break; } }
  if (rep && !rep.error) { const w = await send('Runtime.evaluate', { expression: 'window.__WAV', returnByValue: true }); const b64 = w.result?.result?.value; if (b64) { writeFileSync(`${out}/${id}.wav`, Buffer.from(b64, 'base64')); rep.wav = `${out}/${id}.wav`; } }
  ch.kill('SIGKILL'); await sleep(200); try { execSync('rm -rf ' + dir); } catch {}
  for (const l of logs.slice(0, 5)) console.log('  ', l);
  return rep;
}

for (const id of ids) {
  const r = await run(id);
  if (!r) { console.log(`${id}: no result (timeout)`); continue; }
  if (r.error) { console.log(`${id}: ERROR ${r.error}`); continue; }
  const flags = [];
  if (r.rmsDb == null || r.sections.some(s => s.rms == null)) flags.push('NaN IN OUTPUT');
  if (r.clipSamples > 50) flags.push(`CLIPPING ${r.clipSamples} samples`);
  if (r.peakDb > -0.3) flags.push('peak at ceiling');
  if (r.gaps > 0) flags.push(`${r.gaps} silence gap(s)`);
  const loud = Math.max(...r.sections.map(s => s.rms)), quiet = Math.min(...r.sections.map(s => s.rms));
  if (loud - quiet < 3) flags.push(`flat dynamics: ${loud} vs ${quiet} dB`);
  console.log(`\n=== ${SONGS[id].name} (${id}) · ${r.bpm} bpm · ${r.duration}s · rendered in ${(r.renderMs / 1000).toFixed(1)}s ===`);
  console.log(`peak ${r.peakDb} dBFS · rms ${r.rmsDb} · clip ${r.clipSamples} · tempo est ${r.bpmEst} (alt ${r.bpmAlt.join('/')}, beat ${r.beatStrength}) · silences ${r.gaps}`);
  console.log('section     bars   rms    sub  low  mid  hi');
  const f2 = v => v == null ? ' NaN' : v.toFixed(2);
  for (const s of r.sections) console.log(`${s.name.padEnd(11)} ${String(s.bars).padStart(4)} ${String(s.rms).padStart(6)}   ${f2(s.sub)} ${f2(s.low)} ${f2(s.mid)} ${f2(s.hi)}`);
  console.log(flags.length ? 'FLAGS: ' + flags.join(' | ') : 'clean');
  if (r.wav) {
    const png = r.wav.replace(/\.wav$/, '.spec.png');
    try { execSync(`ffmpeg -y -loglevel error -i ${r.wav} -lavfi "showspectrumpic=s=1600x400:legend=0:scale=cbrt:fscale=log:color=magma" ${png}`); console.log('spectrogram', png); } catch (e) { console.log('ffmpeg failed', e.message); }
    try { console.log(execSync(`ffmpeg -i ${r.wav} -af ebur128=peak=true -f null - 2>&1 | grep -E "I:|LRA:" | tail -2`).toString().trim()); } catch {}
  }
}
