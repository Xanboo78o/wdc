// radio.js — team radio on the laptop: hold to talk, hear the pit wall.
//
// Adam, 2026-09-25, chose laptop mic + speakers over the iPad dash. So:
//
//   hold the rim's RADIO button (or T)  ->  the mic records
//   release                             ->  tools/voice.py  /stt   -> what you said
//   js/engineer.js answers what it can compute; anything else goes to
//   tools/radio.mjs /ask (the conversational engineer, Ollama on the GPU)
//   the reply                           ->  tools/voice.py  /tts   -> a voice,
//                                           band-limited like a real radio
//
// Every line also shows as a caption, bottom left, with who said it — the
// other drivers' radios are captions only, the way TV shows them. If the
// voice server is down the engineer still talks through the browser's own
// speech, and says so once instead of going quietly dead.
//
// The iPad dash's radio (dash.html) is untouched; this simply stops sending
// it anything.

const VOICE = 'http://127.0.0.1:8177';
const BRAIN = 'http://127.0.0.1:8178';

export const radio = { talking: false, said: '', reply: '', error: '' };
if (typeof window !== 'undefined') window.__radio = radio;

let engineer = null, ctx = null, stream = null, rec = null, chunks = [], down = false;
let queue = Promise.resolve(), cap = null, capTimer = 0, warned = false;

let started = false;
export function startRadio(opts) {
  engineer = opts.engineer;
  if (started) return;          // start() runs once per session; the listeners must not stack
  started = true;
  captionBox();
  // Ask for the microphone now, at the start of the session, so the browser's
  // permission prompt appears here — not the first time you press to talk
  // with both hands on the wheel at 280 km/h.
  if (!stream && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(s => { stream = s; })
      .catch(e => { radio.error = 'microphone: ' + e.message; });
  }
  addEventListener('keydown', e => { if (e.code === 'KeyT' && !e.repeat) ptt(true); });
  addEventListener('keyup', e => { if (e.code === 'KeyT') ptt(false); });
}

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Push-to-talk, called every frame by the game with the rim button's state. */
export function ptt(on) {
  if (on === down) return;
  down = on;
  radio.talking = on;
  if (on) {
    beep(1250, 0.06);
    if (!stream) { radio.error = 'no microphone'; return; }
    // Raw PCM through a ScriptProcessor: MediaRecorder hands back compressed
    // webm, and a 16-bit WAV is what the recogniser reads without ffmpeg.
    const c = audio();
    const src = c.createMediaStreamSource(stream);
    const proc = c.createScriptProcessor(4096, 1, 1);
    chunks = [];
    proc.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(c.destination);
    rec = { src, proc, rate: c.sampleRate };
  } else {
    beep(900, 0.05);
    if (!rec) return;
    const { src, proc, rate } = rec; rec = null;
    src.disconnect(); proc.disconnect();
    const pcm = merge(chunks); chunks = [];
    if (pcm.length < rate * 0.25) return;           // a tap, not a transmission
    transcribe(pcm, rate);
  }
}

async function transcribe(pcm, rate) {
  let text = '';
  try {
    const r = await fetch(VOICE + '/stt', { method: 'POST', body: wav(downsample(pcm, rate, 16000), 16000) });
    text = (await r.json()).text || '';
  } catch {
    return say('I can\'t hear you. The voice server is not running.', 'ENGINEER');
  }
  if (!text) return;
  caption(text, 'YOU');
  radio.said = text;
  let reply = engineer ? engineer.hear(text) : null;
  if (!reply) {
    try {
      const r = await fetch(BRAIN + '/ask', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, telemetry: engineer ? engineer.telemetry() : {} }),
      });
      reply = (await r.json()).reply || 'Copy that.';
    } catch { reply = 'Copy that.'; }
  }
  say(reply, 'ENGINEER');
}

/** A line on the radio: captioned, and voiced if it is your engineer. */
export function say(text, who = 'ENGINEER') {
  radio.reply = text;
  // Other drivers' radios are shown, not spoken: one voice in your ear.
  if (who !== 'ENGINEER') { caption(text, who); return; }
  queue = queue.then(() => speak(text)).catch(() => {});
}

async function speak(text) {
  caption(text, 'ENGINEER');
  try {
    const r = await fetch(VOICE + '/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error('tts ' + r.status);
    const c = audio();
    const buf = await c.decodeAudioData(await r.arrayBuffer());
    await playRadio(buf);
  } catch {
    // The browser's own voice, if it has one, rather than silence.
    if (!warned) { warned = true; console.warn('radio: tools/voice.py is not answering; using the browser voice'); }
    if (typeof speechSynthesis !== 'undefined') {
      await new Promise(res => { const u = new SpeechSynthesisUtterance(text); u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
    }
  }
}

// Team radio sound: a narrow band, a little grit, a click in and out.
function playRadio(buf) {
  const c = audio();
  return new Promise(res => {
    const s = c.createBufferSource(); s.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const sh = c.createWaveShaper(); const k = 2.2, n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    sh.curve = curve;
    const g = c.createGain(); g.gain.value = 1.1;
    s.connect(hp).connect(lp).connect(sh).connect(g).connect(c.destination);
    beep(1400, 0.05);
    s.onended = () => { beep(1000, 0.05); setTimeout(res, 120); };
    s.start(c.currentTime + 0.08);
  });
}

function beep(f, len) {
  try {
    const c = audio(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = f; g.gain.value = 0.06;
    o.connect(g).connect(c.destination);
    o.start(); o.stop(c.currentTime + len);
  } catch { /* no audio yet */ }
}

// ------------------------------------------------------------------ captions
function captionBox() {
  if (cap || typeof document === 'undefined') return;
  cap = document.createElement('div');
  cap.id = 'radioCap';
  cap.style.cssText = 'position:fixed;left:18px;bottom:96px;max-width:44vw;z-index:30;pointer-events:none;' +
    'font:600 15px/1.35 system-ui,sans-serif;color:#fff;display:flex;flex-direction:column;gap:6px;';
  document.body.appendChild(cap);
}
function caption(text, who) {
  captionBox();
  if (!cap) return;
  const row = document.createElement('div');
  const you = who === 'YOU', eng = who === 'ENGINEER';
  row.style.cssText = 'background:rgba(8,10,14,.78);border-left:4px solid ' +
    (you ? '#ffb000' : eng ? '#3ee0a0' : '#8aa4ff') + ';padding:6px 10px;border-radius:4px;opacity:1;transition:opacity .6s;';
  const w = document.createElement('div');
  w.textContent = you ? 'YOU' : eng ? 'ENGINEER' : 'RADIO · ' + who;
  w.style.cssText = 'font-size:10px;letter-spacing:.18em;opacity:.75';
  const t = document.createElement('div'); t.textContent = text;
  row.append(w, t);
  cap.appendChild(row);
  while (cap.children.length > 3) cap.firstChild.remove();
  setTimeout(() => { row.style.opacity = '0'; setTimeout(() => row.remove(), 700); }, 7000);
}

// ------------------------------------------------------------------ audio utils
function merge(list) {
  let n = 0; for (const a of list) n += a.length;
  const out = new Float32Array(n); let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}
function downsample(x, from, to) {
  if (from === to) return x;
  const r = from / to, n = Math.floor(x.length / r), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * r), b = Math.min(x.length, Math.floor((i + 1) * r));
    let s = 0; for (let k = a; k < b; k++) s += x[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}
function wav(x, rate) {
  const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
