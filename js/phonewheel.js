// phonewheel.js — your phone as the steering wheel.
//
// The Apex Racer design, which has already been driven: the phone reads its
// ROLL against gravity (absolute, so it never drifts, and "centre" is however
// you hold it when you connect) and broadcasts a steering value ~30 times a
// second over a Supabase Realtime channel named by a six-letter code. This side
// listens on that channel. Only steering crosses the wire — the feet stay on
// the key-ladder pedals.
//
// The phone page is wheel.html on GitHub Pages, not localhost: iOS only hands
// motion sensors to a secure (https) page, and a phone cannot reach this
// laptop's localhost anyway.
//
// Sign: +1 is full LEFT, the same as the sim and as Apex Racer.

const CFG = {
  url: 'https://wsjrcoibrigewmwospva.supabase.co',
  key: 'sb_publishable_n88dYo7wUYb_utwKiQT3uQ_HGOtXDZb',   // publishable: meant for browsers
  prefix: 'wdc:',
};
export const PHONE_PAGE = 'https://xanboo78o.github.io/wdc/wheel.html';
const STALE_MS = 400;          // no steering for this long = hands off the phone wheel
const GONE_MS = 2500;          // ...and for this long = disconnected

export const phone = { steer: 0, at: 0, connected: false, status: 'off', code: '' };
if (typeof window !== 'undefined') window.__phone = phone;   // for tools/wheelcheck.mjs
const listeners = new Set();
const notify = () => { for (const f of listeners) f(phone); };
export const onPhone = f => { listeners.add(f); f(phone); };

// true while the phone is actually steering right now
export const phoneLive = () => phone.connected && performance.now() - phone.at < STALE_MS;

function deviceCode() {
  try {
    const saved = localStorage.getItem('wdc_wheel_code');
    if (saved) return saved;
  } catch { /* private window */ }
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // nothing ambiguous
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  const c = Array.from(buf, n => abc[n % abc.length]).join('');
  try { localStorage.setItem('wdc_wheel_code', c); } catch { /* fine */ }
  return c;
}

let started = false;
export async function startPhoneWheel() {
  if (started) return;
  started = true;
  phone.code = deviceCode();
  phone.status = 'connecting'; notify();
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient(CFG.url, CFG.key, { realtime: { params: { eventsPerSecond: 40 } } });
    const ch = sb.channel(CFG.prefix + phone.code, {
      config: { broadcast: { self: false }, presence: { key: 'game' } },
    });
    ch.on('broadcast', { event: 'steer' }, ({ payload }) => {
      phone.steer = Math.max(-1, Math.min(1, +(payload && payload.v) || 0));
      phone.at = performance.now();
      if (!phone.connected) { phone.connected = true; phone.status = 'connected'; notify(); }
    })
      .on('broadcast', { event: 'hello' }, () => {
        ch.send({ type: 'broadcast', event: 'host-ack', payload: { name: 'CHASING WDC' } });
        phone.connected = true; phone.at = performance.now(); phone.status = 'connected'; notify();
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') {
          ch.track({ role: 'game' });
          if (!phone.connected) { phone.status = 'waiting'; notify(); }
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
          phone.status = 'offline'; notify();
        }
      });
    setInterval(() => {
      if (phone.connected && performance.now() - phone.at > GONE_MS) {
        phone.connected = false; phone.steer = 0; phone.status = 'waiting'; notify();
      }
    }, 500);
  } catch (e) {
    console.warn('phone wheel unavailable:', e);
    phone.status = 'offline'; notify();
  }
}

// ---------------------------------------------------------------------------
// A small pairing card: the code, a QR code to scan with the phone's camera,
// and whether it is connected. Drops into any container.
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

export function mountPhoneCard(parent, { compact = false } = {}) {
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
    <div class="row"><span class="dot"></span><span class="txt">PHONE WHEEL</span></div>
    <div class="qr"><div class="code"></div><small></small></div>`;
  parent.appendChild(el);
  const url = () => `${PHONE_PAGE}?code=${phone.code}`;
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
  onPhone(p => {
    el.querySelector('.dot').className = 'dot ' + p.status;
    el.querySelector('.txt').innerHTML = p.status === 'connected'
      ? 'PHONE WHEEL <b>CONNECTED</b>'
      : p.status === 'offline' ? 'PHONE WHEEL · no internet'
      : `PHONE WHEEL · code <b>${p.code || '……'}</b> · click for QR`;
  });
  return el;
}
