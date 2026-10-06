// home.js — the home page and the pages you pass through on the way to a race.
//
// Adam, 2026-10-03: Hill Climb Racing is the reference. Chunky, bright, one job
// per page, and home is "a place you wanna be": a live race runs behind it.
// "i definitely dont like my team and league being in the same page as track
// selection" — so:
//
//   HOME ──RACE──▶ index.html (the real game), one press, last settings
//     ├─ SETUP     circuit + every race setting on one page
//     ├─ GARAGE    league + team, your identity, nowhere near the track
//     └─ SETTINGS  theme + music
//
// Everything chosen here is saved into the same `wdc.menu` record the game's
// own menu reads, so this page decides nothing the game does not already
// understand; START is just index.html?auto=<circuit>:<car>&from=home.
//
// The live race is the real game in an iframe with ?attract=1 (js/main.js): a
// bot at the wheel, TV camera, ffb=0 and sound=0 — it never touches the wheel.
import { TRACKS } from './tracks.js';
import { CARS } from './physics.js';
import { TIERS, BATTLE } from './autopilot.js';
import { TIME_PHASES, WEATHER_KINDS } from './weather.js';
import { TEAMS, FIELDS, LEAGUES, teamsIn, driversOf } from './drivers.js';
import { Hands } from './input.js';
import { FFB } from './ffb.js';
import { SONGS, STATIONS } from './ost.js';
import { THEMES, hasTheme, MUSIC_LEVELS, hasLevel, menuMusic, sayFor, greeting, setLook } from './menuui.js';
import { isDLC, locked, previewLocked, packOf, priceOf, priceLabel } from './catalog.js';

const $ = s => document.querySelector(s);
// ?dlc=locked: see the page as someone who owns no packs (js/catalog.js).
if (new URLSearchParams(location.search).get('dlc') === 'locked') previewLocked(true);
// A pack's circuit wears a stamp; one you do not own wears the red one.
// The price is on it, and on its Grand Prix weekend the half price and why.
const dlcStamp = id => {
  if (!isDLC(id)) return '';
  if (!locked(id)) return '<span class="dlc">DLC</span>';
  const p = priceOf(packOf(id));
  return `<span class="dlc lock">DLC · ${priceLabel(packOf(id))}${p && p.sale ? ` · ${p.sale.pct}% OFF, ${p.sale.why} WEEKEND` : ''}</span>`;
};
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

// ---------------------------------------------------------------- icons
// Drawn the way his own sprites are: flat fill, an outline in a darker shade
// of the same colour, fat round strokes. The flag is the one from his GO! button.
const svg = body => `<svg viewBox="0 0 64 64" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const FLAG = svg(`<path d="M14 58 L22 8" stroke="#111" stroke-width="5" fill="none"/>
  <path d="M22 9 L56 14 L52 38 L19 33 Z" fill="#fff" stroke="#111" stroke-width="3"/>
  <path d="M22 9 L33 10.6 L31.6 18.6 L20.7 17 Z M44.6 12.3 L56 14 L54.7 22 L43.3 20.3 Z M31.6 18.6 L43.3 20.3 L42 28.3 L30.3 26.6 Z M19.4 25 L30.3 26.6 L29 34.6 L19 33 Z M42 28.3 L53.3 30 L52 38 L40.6 36.3 Z" fill="#111"/>`);
const ICON = {
  circuit: FLAG,
  garage: svg(`<rect x="12" y="28" width="40" height="28" fill="#b98a4e" stroke="#7a4f1c" stroke-width="5"/><path d="M6 30 L32 10 L58 30" fill="none" stroke="#7a4f1c" stroke-width="7"/><rect x="24" y="38" width="16" height="18" fill="#8a5a22" stroke="#5c3a10" stroke-width="4"/>`),
  showroom: svg(`<path d="M4 40 L14 38 L24 28 L40 28 L46 38 L60 41 L60 46 L4 46 Z" fill="#ff5a4f" stroke="#b52a22" stroke-width="4"/><circle cx="17" cy="46" r="8" fill="#333" stroke="#111" stroke-width="3"/><circle cx="48" cy="46" r="8" fill="#333" stroke="#111" stroke-width="3"/><circle cx="17" cy="46" r="2.5" fill="#bbb"/><circle cx="48" cy="46" r="2.5" fill="#bbb"/>`),
  builder: svg(`<path d="M20 56 L38 24" stroke="#7a4f1c" stroke-width="8" fill="none"/><path d="M26 14 L52 28 L46 38 L20 24 Z" fill="#b5b5b5" stroke="#6e6e6e" stroke-width="4"/>`),
  jukebox: svg(`<path d="M24 46 L24 14 L50 9 L50 40" fill="none" stroke="#1b6fb5" stroke-width="6"/><ellipse cx="17" cy="47" rx="9" ry="7" fill="#66b8ff" stroke="#1b6fb5" stroke-width="4"/><ellipse cx="43" cy="41" rx="9" ry="7" fill="#66b8ff" stroke="#1b6fb5" stroke-width="4"/>`),
  dash: svg(`<rect x="8" y="14" width="48" height="36" fill="#e8e8e8" stroke="#8a8a8a" stroke-width="5"/><rect x="16" y="34" width="7" height="9" fill="#6fe38b" stroke="#3f9a58" stroke-width="2"/><rect x="28" y="26" width="7" height="17" fill="#f5d94a" stroke="#b8960f" stroke-width="2"/><rect x="40" y="20" width="7" height="23" fill="#ff5a4f" stroke="#b52a22" stroke-width="2"/>`),
  settings: svg(`<path d="M10 18 H54 M10 32 H54 M10 46 H54" stroke="#8a8a8a" stroke-width="6" fill="none"/><circle cx="24" cy="18" r="7" fill="#f5d94a" stroke="#b8960f" stroke-width="4"/><circle cx="42" cy="32" r="7" fill="#6fe38b" stroke="#3f9a58" stroke-width="4"/><circle cx="20" cy="46" r="7" fill="#66b8ff" stroke="#1b6fb5" stroke-width="4"/>`),
};

// ---------------------------------------------------------------- the save
const KEY = 'wdc.menu';
const S = {
  track: 'monza', car: 'f1', mode: 'race', grid: 22, tier: 'medium', laps: 3, start: 'mid',
  noDnf: false, quali: false, time: 'live', weather: 'live', battle: 'medium',
  teams: { f1: null, gt3: null, f4: null }, field: 'f1', theme: 'light', music: 'on',
};
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* a fresh start */ }
S.teams = Object.assign({ f1: null, gt3: null, f4: null }, S.teams);
if (!TRACKS.some(t => t[0] === S.track)) S.track = 'monza';
if (!CARS[S.car]) S.car = 'f1';
if (!hasTheme(S.theme) || S.theme === 'team') S.theme = 'light';   // home has no all-livery look
if (!hasLevel(S.music)) S.music = 'on';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private window */ } };

// a team's two livery colours
const cols = k => { const t = TEAMS[k]; return t ? (t.ui || [t.col, t.fg || '#ffffff']) : ['#e8452c', '#ffd23f']; };
const track = () => TRACKS.find(t => t[0] === S.track);
const teamKey = () => S.teams[S.car] || Object.values(S.teams).find(Boolean);
function paint() {
  document.documentElement.dataset.theme = S.theme;
  setLook();
  const r = document.documentElement.style;
  r.setProperty('--team', cols(teamKey())[0]);
  r.setProperty('--team2', cols(teamKey())[1]);
  menuMusic.setLevel(S.music);
  menuMusic.cue(S.track);
}

// ---------------------------------------------------------------- outlines
// The circuit, drawn from the surveyed centreline the car drives on.
const _outline = new Map();
async function outline(id) {
  if (_outline.has(id)) return _outline.get(id);
  let o = null;
  try {
    const j = await (await fetch(`./data/tracks/${id}.json`)).json();
    const n = j.x.length, step = Math.max(1, Math.floor(n / 400)), pts = [];
    for (let k = 0; k < n; k += step) pts.push([j.x[k], -j.y[k]]);     // north up
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const size = Math.max(x1 - x0, y1 - y0), pad = size * 0.07;
    o = { d: 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z', len: j.length, size,
      vb: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}` };
  } catch { /* no outline: the name still says where you are */ }
  _outline.set(id, o);
  return o;
}
async function drawMap(svg, id, car = true) {
  const o = await outline(id);
  if (!o || !svg.isConnected) return;
  svg.setAttribute('viewBox', o.vb);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const p = cls => `<path class="${cls}" d="${o.d}" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML = p('casing') + p('tarmac') + (car
    ? `<circle class="car" r="${(o.size * 0.016).toFixed(1)}" stroke-width="${(o.size * 0.005).toFixed(1)}"><animateMotion dur="9s" repeatCount="indefinite" path="${o.d}"/></circle>` : '');
  const km = svg.closest('.card,.next,.strip')?.querySelector('[data-km]');
  if (km && o.len) km.textContent = (o.len / 1000).toFixed(3) + ' KM';
}

// ---------------------------------------------------------------- the live race
const live = $('#live');
// Adam, 2026-10-03: the first backdrop (12 cars at the chosen circuit, TV
// camera) was "laggy asf", boring, and behind trees most of the time. So: TWO
// cars, on one of the SMALL circuits whatever is selected, seen from the chase
// camera behind the bot in your seat (who starts second, so the fight is in
// shot), shadows off, and drawn at 62% size and stretched (home.html #live).
// SUPERCASUAL + HARD overtakes is the mode that keeps a rival within reach.
const SMALL = ['adam1', 'monaco'];
let liveKey = null, liveTrack = null;
let _evAt = 0;
function startLive() {
  if (new URLSearchParams(location.search).has('nolive')) return;   // ?nolive=1: no race behind (a slow machine, or a screenshot)
  if (liveKey === S.car) return;
  liveKey = S.car;
  liveTrack = SMALL[Math.floor(Math.random() * SMALL.length)];
  live.classList.remove('up');
  live.src = `./index.html?auto=${liveTrack}:${S.car}&race=1&grid=2&start=2&laps=30&tier=supercasual&battle=hard&nodnf=1&attract=1&ffb=0&sound=0&lo=1&mirror=0&time=${['day', 'morning', 'evening', 'sunset'][Math.floor(Math.random() * 4)]}&seed=${Date.now() % 9973}`;
}
// the iframe fades in once the race is really running, and the tower reads it
setInterval(() => {
  let t = null;
  try { t = live.contentWindow.__attract && live.contentWindow.__attract(); } catch { /* still loading */ }
  live.classList.toggle('up', !!(t && t.tower));
  // something just happened out there: shout it (js/attract.js), then let the bubble go back to talking
  let ev = null;
  try { ev = live.contentWindow.__attractEvent; } catch { /* loading */ }
  if (ev && ev.at !== _evAt && current === 'home') {
    _evAt = ev.at;
    const el = $('.say');
    if (el) { el.textContent = ev.text; el.classList.remove('in', 'shout'); void el.offsetWidth; el.classList.add('shout'); setTimeout(() => { if ($('.say') === el) { el.classList.remove('shout'); el.textContent = _say; } }, 4200); }
  }
  const box = $('#tower');
  if (!box) return;
  if (!t || !t.tower) { box.innerHTML = `<small>LIVE · WARMING UP…</small>`; return; }
  box.innerHTML = `<small><u>●</u> LIVE · ${(TRACKS.find(t => t[0] === liveTrack) || ['', ''])[1].toUpperCase()} · LAP ${t.lap}/${t.laps}</small>`
    + t.tower.slice(0, 7).map(e => `<div class="trow"><b>${e.p}</b><i style="background:${e.col}"></i><span>${e.you ? 'YOUR SEAT (BOT)' : e.n}</span><em>${e.g}</em></div>`).join('');
}, 700);

// ---------------------------------------------------------------- pages
// A page is a list of ITEMS in focus order. An item is an element plus what
// ok / left / right do on it; up and down (and left/right, on an item that
// does not use them) walk the list. That is the whole input model, so a
// d-pad, the wheel's hat, the arrow keys and a mouse all do the same thing.
const page = $('#page');
let items = [], at = 0, back = null, current = 'home';
function focus(i) {
  at = Math.max(0, Math.min(items.length - 1, i));
  items.forEach((it, k) => it.el.classList.toggle('on', k === at));
  if (items[at]) items[at].el.scrollIntoView({ block: 'nearest' });
}
function item(el, o = {}) {
  const it = { el, ...o }, i = items.length;
  items.push(it);
  el.addEventListener('mouseenter', () => focus(i));
  if (o.ok) el.addEventListener('click', e => { e.stopPropagation(); focus(i); o.ok(); });
  return el;
}
function show(name, keep) {
  current = name;
  document.body.dataset.page = name;
  page.innerHTML = '';
  items = []; back = name === 'home' ? null : () => show('home');
  PAGES[name]();
  focus(keep ?? 0);
  paint(); save();
}
let _say = greeting();
function say(text) { if (!text) return; _say = text; const el = $('.say'); if (el) { el.textContent = text; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); } }
const sayBox = () => `<div class="chunk say in">${_say}</div>`;
function foot(nextLabel, next, hint = '') {
  const f = h(`<div class="foot"><button class="chunk grey" data-b>‹ BACK</button><span class="hint">${hint}</span><button class="chunk go" data-n>${nextLabel} ›</button></div>`);
  f.querySelector('[data-b]').onclick = () => back();
  page.append(f);
  item(f.querySelector('[data-n]'), { ok: next });
}

// series: "Day N of chasing the WDC" began on 2026-10-03
function dayChips() {
  const now = new Date(), d0 = new Date(2026, 9, 3);
  const day = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d0) / 864e5) + 1;
  let s = day >= 1 ? `<div class="chunk chip yell"><small>CHASING THE WDC</small>DAY ${day}</div>` : '';
  if (now.getMonth() === 9) s += `<div class="chunk chip dark"><small>RACETOBER</small>DAY ${now.getDate()}</div>`;
  return s;
}
const nowPlaying = () => { const n = menuMusic.title(); return n ? `<span class="eq"><i></i><i></i><i></i></span>${n}` : 'MUSIC OFF'; };

// Go racing, now, with what is saved. No team in this league yet = the garage first.
function lightsOut() {
  if (locked(S.track)) { if (current !== 'setup') show('setup'); say(`${track()[1]} is ${priceLabel(packOf(S.track))}. no racing it until it is yours.`); return; }
  if (!S.teams[S.car]) { show('garage'); say('pick a team first. then we race.'); return; }
  save(); menuMusic.fadeOut(0.4);
  setTimeout(() => { location.href = `./index.html?auto=${S.track}:${S.car}&from=home`; }, 420);
}

const PAGES = {
  // ------------------------------------------------------------ HOME
  home() {
    const t = track(), tk = teamKey(), team = TEAMS[tk], drv = tk ? driversOf(tk) : [];
    page.append(h(`<div class="top"><div class="chunk logo">${FLAG}<div>CHASING <span>WDC</span><small>Racing for all</small></div></div>${dayChips()}<div class="grow"></div>
      <div class="chunk chip" id="np"><small>ON THE RADIO</small><span>${nowPlaying()}</span></div></div>`));
    page.append(h(sayBox()));
    const mid = h(`<div class="mid">
      <div class="chunk me"><div class="no">${drv[0] ? drv[0].num ?? '' : '?'}</div><small>${team ? LEAGUES[team.league] + ' · YOU DRIVE FOR' : 'NO TEAM YET'}</small>
        <b>${team ? team.name : 'PICK A TEAM'}</b><div class="stripe"></div><i>${team ? CARS[S.car].full : 'the garage is that way →'}</i></div>
      <div class="chunk tower" id="tower"><small>LIVE · WARMING UP…</small></div></div>`);
    page.append(mid);
    const dock = h(`<div class="dock">
      <div class="chunk next"><small>NEXT UP</small><div class="frame"><svg></svg></div><b>${t[1]}</b><small>${t[2]} · <span data-km></span>${dlcStamp(t[0])}</small></div>
      <div class="tiles"></div>
      <button class="chunk go race">${FLAG}<div>RACE<small>${S.mode === 'race' ? `${S.laps} LAPS · ${S.grid} CARS` : 'HOT LAP'} · ${t[1].toUpperCase()}</small></div>${FLAG}</button></div>`);
    page.append(dock);
    drawMap(dock.querySelector('svg'), S.track);
    const tiles = dock.querySelector('.tiles');
    const tile = (cls, icon, label, ok) => { const b = h(`<button class="chunk tile ${cls}">${ICON[icon]}${label}</button>`); tiles.append(b); return [b, ok]; };
    const list = [
      tile('', 'circuit', 'SETUP', () => show('setup')),
      tile('', 'garage', 'GARAGE', () => show('garage')),
      tile('', 'showroom', 'SHOWROOM', () => { location.href = `./carview.html${tk ? '?team=' + tk : ''}`; }),
      tile('', 'builder', 'BUILDER', () => { location.href = './build.html'; }),
      tile('', 'jukebox', 'JUKEBOX', () => { location.href = './ost.html'; }),
      tile('', 'dash', 'iPAD DASH', () => { location.href = './dash.html'; }),
      tile('', 'settings', 'SETTINGS', () => show('settings')),
    ];
    // RACE is first in focus order: it is what you came for
    // RACE is ONE press: it goes racing with exactly what the cards say (Adam:
    // "takes too long to get to a race"). Changing anything is the SETUP page.
    item(dock.querySelector('.race'), { ok: lightsOut });
    item(dock.querySelector('.next'), { ok: () => show('setup') });
    for (const [b, ok] of list) item(b, { ok });
    item(mid.querySelector('.me'), { ok: () => show('garage') });
    startLive();
  },

  // ------------------------------------------------------------ SETUP
  // The circuit and every race setting on ONE page (it was two, and a NEXT
  // between them). The circuit is the first row: left/right steps it, like
  // every other row. START / G goes racing from anywhere on the page.
  setup() {
    const n = TRACKS.length, i = TRACKS.findIndex(t => t[0] === S.track), t = TRACKS[i];
    const step = d => { S.track = TRACKS[(i + d + n) % n][0]; show('setup', 0); say(sayFor('CIRCUIT', S.track)); };
    const st = STATIONS.find(x => x.id === S.track);
    const songs = st ? st.songs.map(id => SONGS[id].name).join(' · ') : '';
    page.append(h(`<div class="top"><div class="title">RACE SETUP</div><div class="chunk chip yell"><small>${TEAMS[S.teams[S.car]] ? TEAMS[S.teams[S.car]].name : 'NO TEAM'}</small>${CARS[S.car].full.toUpperCase()}</div><div class="grow"></div>${sayBox()}</div>`));
    const strip = h(`<div class="chunk strip${locked(t[0]) ? ' locked' : ''}"><button class="chunk arrow" data-l>‹</button>
      <div class="no">${String(i + 1).padStart(2, '0')}</div><div class="frame"><svg></svg></div>
      <div class="stext"><small>${t[2]} · <span data-km></span>${dlcStamp(t[0])}</small><b>${t[1]}</b>${songs ? `<i>♪ ${songs}</i>` : ''}</div>
      <div class="dots">${TRACKS.map((_, k) => `<u${k === i ? ' class="on"' : ''}></u>`).join('')}</div>
      <button class="chunk arrow" data-r>›</button></div>`);
    page.append(strip);
    drawMap(strip.querySelector('svg'), t[0]);
    strip.querySelector('[data-l]').onclick = e => { e.stopPropagation(); step(-1); };
    strip.querySelector('[data-r]').onclick = e => { e.stopPropagation(); step(1); };
    item(strip, { left: () => step(-1), right: () => step(1), ok: () => focus(at + 1) });

    const onoff = [[false, 'OFF'], [true, 'ON']], up = a => a.map(k => [k, String(k).toUpperCase()]);
    const rows = [['MODE', 'mode', [['hotlap', 'HOT LAP'], ['race', 'RACE']]]];
    if (S.mode === 'race') {
      rows.push(['LAPS', 'laps', [[2, '2'], [3, '3'], [5, '5'], [10, '10']]],
        ['GRID', 'grid', [[6, '6'], [12, '12'], [16, '16'], [22, '22']]],
        ['RIVALS', 'tier', Object.keys(TIERS).map(k => [k, TIERS[k].name])]);
      if (S.tier === 'supercasual') rows.push(['OVERTAKES', 'battle', Object.keys(BATTLE).map(k => [k, BATTLE[k].name])]);
      rows.push(['YOU START', 'start', [['pole', 'POLE'], ['front', 'FRONT ROW'], ['mid', 'MIDFIELD'], ['back', 'LAST']]],
        ['QUALIFYING', 'quali', onoff], ['RETIREMENT', 'noDnf', [[false, 'NORMAL'], [true, 'NO DNF']]]);
      if (S.car === 'f1') rows.push(['FIELD', 'field', Object.entries(FIELDS)]);
    }
    rows.push(['TIME', 'time', [['live', 'LIVE'], ...up(TIME_PHASES)]], ['WEATHER', 'weather', [['live', 'LIVE'], ...up(WEATHER_KINDS), ['changing', 'CHANGING']]]);
    optGrid(rows, 'setup');
    foot(locked(S.track) ? 'LOCKED' : S.teams[S.car] ? 'LIGHTS OUT' : 'PICK A TEAM', lightsOut, '↑ ↓ MOVE · ← → CHANGE · START / G = LIGHTS OUT');
  },

  // ------------------------------------------------------------ GARAGE
  garage() {
    const L = S.car, keys = teamsIn(L);
    let i = Math.max(0, keys.indexOf(S.teams[L]));
    if (PAGES.garage.at != null && keys[PAGES.garage.at]) i = PAGES.garage.at;
    PAGES.garage.at = null;
    const k = keys[i], t = TEAMS[k], n = keys.length;
    const go = d => { PAGES.garage.at = (i + d + n) % n; show('garage', 1); };
    const league = d => { const a = Object.keys(LEAGUES); S.car = a[(a.indexOf(L) + d + a.length) % a.length]; show('garage', 0); say(sayFor('CAR', S.car)); };
    page.append(h(`<div class="top"><div class="title">THE GARAGE</div><div class="grow"></div>${sayBox()}</div>`));
    const tabs = h(`<div class="tabs">${Object.entries(LEAGUES).map(([key, name]) =>
      `<button class="chunk grey${key === L ? ' sel' : ''}" data-l="${key}">${name}<small>${S.teams[key] ? TEAMS[S.teams[key]].name : 'NO TEAM'}</small></button>`).join('')}</div>`);
    page.append(tabs);
    for (const b of tabs.querySelectorAll('button')) b.onclick = () => { S.car = b.dataset.l; show('garage', 0); };
    item(tabs, { left: () => league(-1), right: () => league(1) });
    const drv = driversOf(k), names = drv.map(d => t.league === 'f1' && t.era !== 'classic' ? d.n : '#' + d.num).join(' · ');
    const mini = (kk, c) => `<div class="chunk card side ${c}"><div class="livery" style="background:${cols(kk)[0]};--c2:${cols(kk)[1]}"></div><b>${TEAMS[kk].name}</b></div>`;
    const body = h(`<div class="body"><button class="chunk grey arrow" data-l>‹</button><div class="cards">${mini(keys[(i - 1 + n) % n], 'l')}
      <div class="chunk card main in">
        <div class="livery" style="background:${cols(k)[0]};--c2:${cols(k)[1]}"><div class="num">${drv[0] ? drv[0].num ?? '' : ''}</div>${S.teams[L] === k ? '<div class="stamp">YOUR TEAM</div>' : ''}</div>
        <b>${t.name}</b><small>${LEAGUES[L]} · ${CARS[L].full}</small><i>${names}</i></div>${mini(keys[(i + 1) % n], 'r')}</div><button class="chunk grey arrow" data-r>›</button></div>`);
    page.append(body);
    const [l, m, r] = body.querySelectorAll('.card');
    l.onclick = body.querySelector('[data-l]').onclick = () => go(-1);
    r.onclick = body.querySelector('[data-r]').onclick = () => go(1);
    const join = () => { S.teams[L] = k; show('garage', 1); say(`${t.name}. ` + sayFor('TEAM', k)); };
    item(m, { ok: join, left: () => go(-1), right: () => go(1) });
    foot(S.teams[L] === k ? 'DONE' : 'JOIN', S.teams[L] === k ? () => show('home') : join, '↑ LEAGUE · ← → TEAM · ENTER / A JOIN');
  },

  // ------------------------------------------------------------ SETTINGS
  settings() {
    page.append(h(`<div class="top"><div class="title">SETTINGS</div><div class="grow"></div>${sayBox()}</div>`));
    optGrid([['THEME', 'theme', THEMES.filter(t => t[0] !== 'team').map(t => [t[0], t[1]])], ['MUSIC', 'music', MUSIC_LEVELS]], 'settings');
    foot('DONE', () => show('home'), '↑ ↓ MOVE · ← → CHANGE');
  },
};

// A grid of chunky choices: one card per setting, its values as pills.
function optGrid(rows, name) {
  const grid = h('<div class="grid"></div>');
  page.append(grid);
  for (const [label, key, opts] of rows) {
    const card = h(`<div class="chunk opt"><small>${label}</small><div class="pills">${opts.map(([v, n]) =>
      `<span class="pill${S[key] === v ? ' sel' : ''}">${n}</span>`).join('')}</div></div>`);
    grid.append(card);
    const set = v => { S[key] = v; const keep = at; show(name, keep); say(sayFor(label, v)); };
    const step = d => { const i = Math.max(0, opts.findIndex(o => o[0] === S[key])); set(opts[(i + d + opts.length) % opts.length][0]); };
    card.querySelectorAll('.pill').forEach((p, i) => { p.onclick = e => { e.stopPropagation(); focus(items.findIndex(it => it.el === card)); set(opts[i][0]); }; });
    item(card, { left: () => step(-1), right: () => step(1), ok: () => focus(at + 1) });
  }
}

// ---------------------------------------------------------------- input
function input(what) {
  menuMusic.wake();
  const it = items[at];
  if (what === 'back') { if (back) back(); return; }
  if (what === 'go') { if (current === 'home' || current === 'setup') lightsOut(); return; }
  if (!it) return;
  if (what === 'ok') { if (it.ok) it.ok(); return; }
  if (what === 'left' || what === 'right') {
    if (it[what]) it[what]();
    else focus(at + (what === 'left' ? -1 : 1));
    return;
  }
  focus(at + (what === 'up' ? -1 : 1));
}
addEventListener('keydown', e => {
  const m = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back', KeyG: 'go' }[e.code];
  if (!m) return;
  e.preventDefault();
  input(m);
});
addEventListener('pointerdown', () => { menuMusic.wake(); refreshRadio(); }, { capture: true });
function refreshRadio() { const el = $('#np span'); if (el) el.innerHTML = nowPlaying(); }
menuMusic.onTrack = refreshRadio;

// Pads and the wheel's rim are POLLED (the Gamepad API has no button events);
// a held direction repeats like a held key. Same reading as the game's menu.
const hands = new Hands();
new FFB();   // only for the rim buttons the bridge carries; nothing here ever sends a force
const held = new Map();
function poll() {
  requestAnimationFrame(poll);
  const down = new Set();
  hands._readPad();
  for (const n of ['up', 'down', 'left', 'right']) if (hands.wheelHeld(n)) down.add(n);
  if (hands.wheelHeld('confirm')) down.add('ok');
  if (hands.wheelHeld('pause')) down.add('go');
  for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) {
    if (!p || p.mapping !== 'standard') continue;
    const b = i => !!(p.buttons[i] && p.buttons[i].pressed), ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (b(12) || ay < -0.6) down.add('up');
    if (b(13) || ay > 0.6) down.add('down');
    if (b(14) || ax < -0.6) down.add('left');
    if (b(15) || ax > 0.6) down.add('right');
    if (b(0)) down.add('ok');
    if (b(1)) down.add('back');
    if (b(9)) down.add('go');
  }
  hands.endFrame();
  const now = performance.now();
  for (const n of down) {
    const t = held.get(n);
    if (t === undefined) { held.set(n, now + 380); input(n); }
    else if (now >= t && n !== 'ok' && n !== 'back' && n !== 'go') { held.set(n, now + 120); input(n); }
  }
  for (const n of [...held.keys()]) if (!down.has(n)) held.delete(n);
}
hands.loadProfile('./').then(() => hands.loadButtons('./')).finally(poll);

show('home');
