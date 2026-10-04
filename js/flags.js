// flags.js — the flags, on the HUD (Adam, 2026-10-03: "i dont think im
// getting flags").
//
// Race control (js/safetycar.js) has decided every flag since 2026-09-30 —
// yellow, double yellow, blue, VSC, SC, red, green, chequered — and the HUD
// showed none of it: one small "SC" light, and nothing at all when you were
// told to give a place back or handed a penalty. This is the marshalling
// light panel an F1 driver has on the dash, plus the one line of race
// control that is about YOU, plus the delta under a VSC or SC.
//
// It builds its own DOM with inline styles, so it touches neither the
// stylesheet nor the page markup (both belong to the menu work).
const FLAG = {
  yellow:   { bg: '#ffd400', fg: '#111', text: '' },
  dyellow:  { bg: '#ffd400', fg: '#111', text: '', flash: true },
  blue:     { bg: '#1f6bff', fg: '#fff', text: '', flash: true },
  green:    { bg: '#19c24a', fg: '#fff', text: '' },
  red:      { bg: '#e8112d', fg: '#fff', text: '' },
  sc:       { bg: '#ffd400', fg: '#111', text: 'SC' },
  vsc:      { bg: '#ffd400', fg: '#111', text: 'VSC' },
  vscEnd:   { bg: '#ffd400', fg: '#111', text: 'VSC ENDING', flash: true },
  chequered:{ bg: 'repeating-conic-gradient(#111 0 25%, #f4f4f4 0 50%) 0 0 / 18px 18px', fg: '#e8112d', text: '' },
};

// Race control's messages that are everybody's business...
const ALL = new Set(['sc', 'scIn', 'vsc', 'vscEnd', 'red', 'redPit', 'redResume', 'standing', 'green',
  'unlap', 'pitClosed', 'pitOpen']);
// ...and the ones that are only shown when they are about you.
const MINE = new Set(['giveBack', 'deltaWarn', 'blue', 'blue2', 'ten', 'speeding', 'pen5', 'pen10', 'dt', 'pen', 'incident']);
const SHOW_S = 6;

let ui = null;
function build() {
  const box = document.createElement('div');
  box.id = 'flagsHud';
  box.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:40;'
    + 'display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;'
    + 'font-family:inherit;font-weight:800;letter-spacing:0.06em;text-transform:uppercase';
  const panel = document.createElement('div');
  panel.style.cssText = 'min-width:132px;height:46px;padding:0 14px;border-radius:8px;display:none;'
    + 'align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 14px rgba(0,0,0,0.45);'
    + 'border:2px solid rgba(255,255,255,0.85)';
  const delta = document.createElement('div');
  delta.style.cssText = 'display:none;font-size:15px;padding:3px 10px;border-radius:6px;background:rgba(10,12,16,0.82)';
  const msg = document.createElement('div');
  msg.style.cssText = 'display:none;max-width:70vw;text-align:center;font-size:14px;padding:6px 12px;'
    + 'border-radius:6px;background:rgba(10,12,16,0.86);color:#fff;border-left:4px solid #ffd400';
  box.append(panel, delta, msg);
  document.body.appendChild(box);
  ui = { box, panel, delta, msg, last: null, shownAt: -99, seen: 0 };
}

export function updateFlags(race, me) {
  if (typeof document === 'undefined') return;
  if (!ui) build();
  if (ui.race !== race) { ui.race = race; ui.seen = -1; ui.last = null; }   // a new race starts its clock at 0
  const rc = race && race.rc;
  if (!rc || !me || document.body.classList.contains('attract')) { ui.box.style.display = 'none'; return; }
  ui.box.style.display = 'flex';

  // THE PANEL — the flag you are looking at right now.
  const kind = rc.flagFor(me);
  const f = kind && FLAG[kind];
  if (f) {
    const on = !f.flash || (race.time * 4 | 0) % 2 === 0;
    ui.panel.style.display = 'flex';
    ui.panel.style.background = on ? f.bg : 'rgba(20,20,22,0.9)';
    ui.panel.style.color = f.fg;
    ui.panel.textContent = f.text;
  } else ui.panel.style.display = 'none';

  // THE DELTA under a VSC or a safety car: + is legal, - is too fast.
  const d = rc.deltaFor(me);
  if (d != null) {
    ui.delta.style.display = '';
    ui.delta.style.color = d >= 0 ? '#3ee07a' : '#ff4d5e';
    ui.delta.textContent = `DELTA ${d >= 0 ? '+' : ''}${d.toFixed(1)}`;
  } else ui.delta.style.display = 'none';

  // THE MESSAGE — the newest race-control line that concerns you.
  const ev = race.events;
  for (let k = ev.length - 1; k >= 0; k--) {
    const x = ev[k];
    if (x.t <= ui.seen) break;
    const mine = x.car === me.idx;
    if ((x.kind === 'rc' || x.kind === 'penalty') && (ALL.has(x.code) || (mine && (MINE.has(x.code) || x.kind === 'penalty')))) {
      ui.last = x; ui.shownAt = race.time;
      break;
    }
  }
  if (ev.length) ui.seen = Math.max(ui.seen, ev[ev.length - 1].t);
  if (ui.last && race.time - ui.shownAt < SHOW_S) {
    ui.msg.style.display = '';
    ui.msg.style.borderLeftColor = ui.last.kind === 'penalty' ? '#e8112d'
      : /green|pitOpen/.test(ui.last.code) ? '#19c24a' : /red/.test(ui.last.code) ? '#e8112d' : '#ffd400';
    ui.msg.textContent = ui.last.text;
  } else ui.msg.style.display = 'none';
}
