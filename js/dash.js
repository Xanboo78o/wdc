// dash.js — the iPad is the dashboard.
//
// This replaces js/phonewheel.js. The phone used to BE the steering wheel;
// with a real wheel on the desk that job is gone, so the tablet's job inverted:
// it no longer sends steering to the game, the game sends telemetry to it.
// Everything the windscreen used to be cluttered with lives over there now.
//
// Same six-letter pairing as before (so the QR habit is unchanged), on a
// ':dash' channel of its own. Telemetry goes out at 15 Hz; the timing tower,
// which is far bigger and changes far slower, rides along at 2 Hz.

const CFG = {
  url: 'https://wsjrcoibrigewmwospva.supabase.co',
  key: 'sb_publishable_n88dYo7wUYb_utwKiQT3uQ_HGOtXDZb',   // publishable: meant for browsers
  prefix: 'wdc:',
};
export const DASH_PAGE = 'https://xanboo78o.github.io/wdc/dash.html';
const HZ = 15, TOWER_MS = 500;

export const dash = { code: '', status: 'off', connected: false, sent: 0 };
if (typeof window !== 'undefined') window.__dash = dash;
const listeners = new Set();
const notify = () => { for (const f of listeners) f(dash); };
export const onDash = f => { listeners.add(f); f(dash); };

export function dashCode() {
  if (dash.code) return dash.code;
  try {
    const saved = localStorage.getItem('wdc_wheel_code');     // same key as the old pairing
    if (saved) return (dash.code = saved);
  } catch { /* private window */ }
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';              // nothing ambiguous
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  const c = Array.from(buf, n => abc[n % abc.length]).join('');
  try { localStorage.setItem('wdc_wheel_code', c); } catch { /* fine */ }
  return (dash.code = c);
}

let ch = null, started = false, getTelemetry = () => null, lastTower = 0;

export async function startDash(opts = {}) {
  if (started) return;
  started = true;
  if (opts.getTelemetry) getTelemetry = opts.getTelemetry;
  dashCode();
  dash.status = 'connecting'; notify();

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient(CFG.url, CFG.key, { realtime: { params: { eventsPerSecond: 20 } } });
    ch = sb.channel(CFG.prefix + dash.code + ':dash', { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'dash-here' }, () => {
      dash.connected = true; dash.status = 'connected'; lastTower = 0; notify();
    }).subscribe(st => {
      if (st === 'SUBSCRIBED') { if (!dash.connected) { dash.status = 'waiting'; notify(); } }
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { dash.status = 'offline'; notify(); }
    });
  } catch (e) {
    dash.status = 'offline'; notify();
    console.warn('dash unavailable:', e);
    return;
  }

  setInterval(() => {
    if (!ch || !dash.connected) return;
    let t;
    try { t = getTelemetry(); } catch { return; }
    if (!t) return;
    // The tower is ~20 rows of strings; at 15 Hz it would be most of the
    // bandwidth and none of the information. Send it on its own slow clock.
    const now = performance.now();
    if (t.tower && now - lastTower < TOWER_MS) delete t.tower;
    else if (t.tower) lastTower = now;
    ch.send({ type: 'broadcast', event: 'tel', payload: t });
    dash.sent++;
  }, Math.round(1000 / HZ));
}

// ---------------------------------------------------------------------------
// Pairing card: the code, a QR to point the iPad's camera at, and whether it
// is connected. Same shape as the old phone-wheel card so the menu is unchanged.
// ---------------------------------------------------------------------------
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.appendChild(s);
  });
}

export function mountDashCard(parent, { compact = false } = {}) {
  if (!parent) return null;
  const el = document.createElement('div');
  el.className = 'phoneCard';
  el.innerHTML = `
    <style>
      .phoneCard { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11px; letter-spacing: 0.08em; color: #9aa3ab; }
      .phoneCard .row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .phoneCard .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
      .phoneCard .dot.waiting { background: #f0b429; } .phoneCard .dot.connected { background: #35d6a0; box-shadow: 0 0 8px #35d6a0; }
      .phoneCard .dot.offline { background: #e0483a; }
      .phoneCard b { color: #eef0f2; letter-spacing: 0.2em; }
      .phoneCard .qr { display: none; margin-top: 10px; text-align: center; }
      .phoneCard.open .qr { display: block; }
      .phoneCard .qr div { background: #fff; display: inline-block; padding: 8px; border-radius: 8px; line-height: 0; }
      .phoneCard .qr small { display: block; margin-top: 6px; color: #9aa3ab; word-break: break-all; letter-spacing: 0; }
    </style>
    <div class="row"><span class="dot"></span><span class="txt">DASH</span></div>
    <div class="qr"><div class="code"></div><small></small></div>`;
  parent.appendChild(el);
  const url = () => `${DASH_PAGE}?code=${dash.code}`;
  el.querySelector('.row').onclick = async () => {
    el.classList.toggle('open');
    if (!el.classList.contains('open')) return;
    try {
      const qrcode = await loadQR();
      const q = qrcode(0, 'M'); q.addData(url()); q.make();
      el.querySelector('.code').innerHTML = q.createSvgTag({ cellSize: compact ? 3 : 4, margin: 0 });
    } catch { el.querySelector('.code').textContent = '(QR needs internet)'; }
    el.querySelector('small').textContent = url();
  };
  onDash(d => {
    el.querySelector('.dot').className = 'dot ' + d.status;
    el.querySelector('.txt').innerHTML = d.status === 'connected'
      ? 'DASH <b>CONNECTED</b>'
      : d.status === 'offline' ? 'DASH · no internet'
      : `DASH · code <b>${d.code || '……'}</b> · click for QR`;
  });
  return el;
}
