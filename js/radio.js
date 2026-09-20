// radio.js — game side of the race engineer radio.
//
// Push-to-talk lives HERE, on the PC, not on the phone: your hands are on the
// wheel, so a button you already hold opens the mic. The phone is only ears and
// a mouth. Nothing in this file ever sees the API key — tools/radio.mjs does
// the talking to Claude.
//
//   hold PTT  -> 'radio-open'  -> phone starts listening
//   release   -> 'radio-close' -> phone stops, recognises, sends 'radio-said'
//   'radio-said' -> POST /ask (with telemetry) -> 'radio-reply' -> phone speaks
//
// Wire it up with one line in the game, passing a function that returns
// whatever the engineer should know right now:
//
//   import { startRadio } from './radio.js';
//   startRadio({ getTelemetry: () => ({ lap: 12, position: 4, gapAhead: 1.2 }) });

import { phone } from './phonewheel.js';

const CFG = {
  url: 'https://wsjrcoibrigewmwospva.supabase.co',
  key: 'sb_publishable_n88dYo7wUYb_utwKiQT3uQ_HGOtXDZb',
  prefix: 'wdc:',
};

export const radio = { status: 'off', talking: false, said: '', reply: '', error: '' };
if (typeof window !== 'undefined') window.__radio = radio;
const listeners = new Set();
const notify = () => { for (const f of listeners) f(radio); };
export const onRadio = f => { listeners.add(f); f(radio); };

let ch = null, server = 'http://127.0.0.1:8178', getTelemetry = () => ({});
let ptt = { key: 'KeyR', pad: null }, down = false, started = false;

/** Rebind push-to-talk. `key` is a KeyboardEvent.code; `pad` a gamepad button index. */
export function setPTT({ key, pad } = {}) {
  if (key !== undefined) ptt.key = key;
  if (pad !== undefined) ptt.pad = pad;
}

export async function startRadio(opts = {}) {
  if (started) return;
  started = true;
  if (opts.getTelemetry) getTelemetry = opts.getTelemetry;
  if (opts.server) server = opts.server.replace(/\/$/, '');
  if (opts.ptt) setPTT(opts.ptt);

  // The engineer rides the same six-letter channel as the phone wheel, on its
  // own events, so it cannot disturb steering. (A shifter once hijacked a
  // 'hello' — never reuse another feature's event name.)
  const code = phone.code || (() => { try { return localStorage.getItem('wdc_wheel_code'); } catch { return null; } })();
  if (!code) { radio.status = 'no-code'; notify(); return; }

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient(CFG.url, CFG.key, { realtime: { params: { eventsPerSecond: 10 } } });
    ch = sb.channel(CFG.prefix + code + ':radio', { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'radio-said' }, ({ payload }) => handle(payload && payload.text))
      .on('broadcast', { event: 'radio-here' }, () => { radio.status = 'ready'; notify(); })
      .subscribe(st => {
        radio.status = st === 'SUBSCRIBED' ? 'waiting' : (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') ? 'offline' : radio.status;
        notify();
      });
  } catch (e) {
    radio.status = 'offline'; radio.error = String(e.message || e); notify();
    return;
  }

  addEventListener('keydown', e => { if (e.code === ptt.key && !e.repeat) open(); });
  addEventListener('keyup',   e => { if (e.code === ptt.key) close(); });
  if (ptt.pad !== null) pollPad();
}

function pollPad() {
  const tick = () => {
    if (ptt.pad !== null) {
      for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (!gp) continue;
        const b = gp.buttons[ptt.pad];
        if (b) { if (b.pressed && !down) open(); else if (!b.pressed && down) close(); }
        break;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function open() {
  if (down || !ch) return;
  down = true; radio.talking = true; radio.said = ''; notify();
  ch.send({ type: 'broadcast', event: 'radio-open', payload: {} });
}
function close() {
  if (!down || !ch) return;
  down = false; radio.talking = false; notify();
  ch.send({ type: 'broadcast', event: 'radio-close', payload: {} });
}

/** Send a line to the engineer directly, without the microphone. */
export async function handle(text) {
  text = String(text || '').trim();
  if (!text) return;
  radio.said = text; radio.error = ''; notify();
  let reply = 'Copy that.';
  try {
    const r = await fetch(server + '/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, telemetry: safeTelemetry() }),
    });
    const j = await r.json();
    reply = j.reply || reply;
    if (j.error) { radio.error = j.error; }
  } catch (e) {
    radio.error = 'radio.mjs is not running (node tools/radio.mjs)';
    reply = 'Radio is dead.';
  }
  radio.reply = reply; notify();
  if (ch) ch.send({ type: 'broadcast', event: 'radio-reply', payload: { text: reply } });
  return reply;
}

function safeTelemetry() {
  try {
    const t = getTelemetry() || {};
    const out = {};
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
      else if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch { return {}; }
}
