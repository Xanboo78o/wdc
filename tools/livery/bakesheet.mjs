// bakesheet.mjs — put Adam's SPONSOR STICKER SHEET on the cars' sticker atlas.
//
//   node tools/livery/bakesheet.mjs            (after tools/livery/bakeatlas.mjs, if that was re-run)
//
// Adam, 2026-10-10, of the first 1,062 liveries: "the spsonsors dont look right
// ... use those sposors from the sponsor sticker sheet". The sheet is his
// printable one for the RC track, ~/Games/rc-sponsors: 53 real grand prix
// sponsors, 17 believable invented ones and 19 joke ones. This draws every
// one of them THE WAY THE SHEET DOES (its own stylesheet, its own fitting
// code, its own typefaces — a real browser lays them out, as on the sheet)
// three times over:
//
//   board:<id>   the logo on its own coloured board, as printed on the sheet
//   logo:<id>    the logo alone, the version meant for LIGHT paint
//   logod:<id>   the logo alone, the version meant for DARK paint
//
// and adds them UNDER the first sheet (numbers, panels, class badges and the
// studio's own games, tools/livery/bakeatlas.mjs): data/livery/atlas.png
// becomes 4096x4096, its top half untouched. Each new cell in atlas.json also
// says what colour its ink mostly is (`ink`) and how much of its box it fills
// (`fill`), so the livery baker can tell whether a logo will show on the paint
// under it and whether it can be cut from one colour of vinyl.
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { spawn, execFileSync } from 'child_process';

const ROOT = new URL('../../', import.meta.url).pathname;
const RC = process.env.RC_SPONSORS || path.join(os.homedir(), 'Games/rc-sponsors') + '/';
if (!fs.existsSync(RC + 'real/manifest.json')) { console.error(`bakesheet: no sponsor sheet at ${RC} (set RC_SPONSORS)`); process.exit(1); }
const { FAKE, MARKS } = await import(RC + 'fake/brands.mjs');
const REAL = JSON.parse(fs.readFileSync(RC + 'real/manifest.json', 'utf8'));

const W = 4096, H = 2048, RH = 92, PAD = 4;
const lum = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); const f = i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4); };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---- every sticker, as the sheet's own markup -------------------------------------------------
const cells = [];        // { name, w, html }
const realLogo = (b, v, bg) => {
  const filter = v.mode === 'white' ? 'brightness(0) invert(1)' : v.mode === 'black' ? 'brightness(0)' : 'none';
  return `<div class="bd${bg ? '' : ' bare'}" style="--bg:${bg || 'transparent'}"><div class="logo img" data-aspect="${v.aspect ?? b.aspect}"><img src="/rc/real/${esc(v.file ?? b.file)}" style="filter:${filter}"></div></div>`;
};
for (const b of REAL) {
  const byBg = [...b.boards].sort((x, y) => lum(y.bg) - lum(x.bg));       // lightest board first
  const light = byBg[0], dark = byBg[byBg.length - 1], a = Math.min(b.aspect, 5.2);
  const w = Math.round(Math.max(118, RH * (0.62 * a + 0.55)));
  cells.push({ name: 'board:' + b.slug, w, html: realLogo(b, b.boards[0], b.boards[0].bg), brand: b.name, kind: 'real', tier: b.tier, bg: b.boards[0].bg });
  cells.push({ name: 'logo:' + b.slug, w, html: realLogo(b, light, null), tight: true, guess: light.mode === 'white' ? 'ffffff' : light.mode === 'black' ? '000000' : null });
  cells.push({ name: 'logod:' + b.slug, w, html: realLogo(b, dark, null), tight: true, guess: dark.mode === 'white' ? 'ffffff' : dark.mode === 'black' ? '000000' : null });
}
const fakeLogo = (b, v, bg, onDark) => {
  const word = `font-family:'${b.font}';font-weight:${b.w};font-style:${b.it ? 'italic' : 'normal'};letter-spacing:${b.ls}`;
  return `<div class="bd notag${bg ? '' : ' bare'}${bg && v.style ? ' ' + v.style : ''}" style="--bg:${bg || (onDark ? '#15161a' : '#f6f5f0')};--fg:${v.fg};--ac:${v.ac}">`
    + `<div class="logo${b.sub ? ' hassub' : ''}">` + (b.mark ? `<svg class="mk" viewBox="0 0 100 100" fill="currentColor">${MARKS[b.mark]}</svg>` : '')
    + `<div class="wd"><div class="nm" style="${word}">${esc(b.name)}</div>` + (b.sub ? `<div class="sb">${esc(b.sub)}</div>` : '') + `</div></div></div>`;
};
for (const b of FAKE) {
  const byBg = [...b.boards].sort((x, y) => lum(y.bg) - lum(x.bg));
  const light = byBg[0], dark = byBg[byBg.length - 1], w = 330;
  cells.push({ name: 'board:' + b.id, w, html: fakeLogo(b, b.boards[0], b.boards[0].bg), brand: b.name + (b.sub ? ' ' + b.sub : ''), kind: b.joke ? 'joke' : 'fake', tier: 2, bg: b.boards[0].bg });
  // a logo for light paint is drawn in the colours it wears on its LIGHT board, and the other way about
  cells.push({ name: 'logo:' + b.id, w, html: fakeLogo(b, light, null, false), tight: true, guess: null, fg: light.fg });
  cells.push({ name: 'logod:' + b.id, w, html: fakeLogo(b, dark, null, true), tight: true, guess: null, fg: dark.fg });
}
// rows
let x = PAD, y = PAD;
for (const c of cells) {
  if (x + c.w + PAD > W) { x = PAD; y += RH + PAD; }
  c.x = x; c.y = y; x += c.w + PAD;
}
if (y + RH + PAD > H) { console.error(`bakesheet: the sheet needs ${y + RH + PAD}px of the ${H} it has — lower RH`); process.exit(1); }

const fontCss = fs.readdirSync(RC + 'fonts').filter(f => f.endsWith('.woff2')).map(f => {
  const [, fam, w, st] = f.match(/^(.*)-latin-(\d+)-(normal|italic)\.woff2$/);
  return `@font-face{font-family:'${fam}';src:url(/rc/fonts/${f}) format('woff2');font-weight:${w};font-style:${st};font-display:block}`;
}).join('\n');
// the stylesheet and the fitting code are the sheet's (rc-sponsors/build.mjs), less the printing
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss}
*{box-sizing:border-box}
html,body{margin:0;background:transparent;font-family:'inter',system-ui,sans-serif}
.cell{position:absolute;height:${RH}px;display:flex}
.bd{position:relative;overflow:hidden;background:var(--bg);color:var(--fg);display:flex;align-items:center;justify-content:space-evenly;flex:1 1 0;border-radius:7px}
.bd.bare{border-radius:0;overflow:visible;background:transparent}
.bd.stripe::after{content:'';position:absolute;left:0;right:0;bottom:0;height:11%;background:var(--ac)}
.logo{display:flex;align-items:center;gap:.28em;line-height:1;white-space:nowrap;flex:none}
.logo.stack{flex-direction:column;gap:.12em}
.mk{width:1.08em;height:1.08em;flex:none;overflow:visible}
.logo.hassub .mk{width:1.32em;height:1.32em}
.logo.stack .mk{width:1.2em;height:1.2em}
.wd{display:flex;flex-direction:column;align-items:flex-start}
.logo.stack .wd{align-items:center}
.nm{font-size:1em;line-height:.92}
.sb{font:600 .27em/1 'inter',sans-serif;letter-spacing:.34em;margin-top:.3em;padding-left:.06em}
.tg{display:none}
.logo.img img{display:block;object-fit:contain}
</style></head><body>
${cells.map((c, i) => `<div class="cell" data-i="${i}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px">${c.html}</div>`).join('\n')}
<script>
function fitBoard(bd){
  const logo=bd.querySelector('.logo'); if(!logo) return;
  const W=bd.clientWidth,H=bd.clientHeight,bare=bd.classList.contains('bare');
  if(logo.classList.contains('img')){
    const a=+logo.dataset.aspect, img=logo.querySelector('img');
    const f=bare?.92:Math.min(.74,.9/Math.pow(a,.42));
    let h=f*H,w=h*a; const maxW=W*(bare?.96:.84); if(w>maxW){w=maxW;h=w/a}
    img.style.width=w+'px'; img.style.height=h+'px';
  }else{
    let fs=H*.4; logo.style.fontSize=fs+'px';
    const target=H*(bare?.84:.6);
    fs*=target/logo.offsetHeight; logo.style.fontSize=fs+'px';
    const maxW=W*(bare?.96:.86);
    if(logo.scrollWidth>maxW){fs*=maxW/logo.scrollWidth; logo.style.fontSize=fs+'px'}
  }
}
const imgs=[...document.images];
Promise.all([document.fonts.ready,...imgs.map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))]).then(()=>{
  document.querySelectorAll('.bd').forEach(fitBoard);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    window.__rects=[...document.querySelectorAll('.cell')].map(c=>{const r=c.querySelector('.logo').getBoundingClientRect();return [r.left,r.top,r.width,r.height]});
    window.__broken=imgs.filter(i=>!i.naturalWidth).map(i=>i.getAttribute('src'));
  }));
});
</script></body></html>`;

// ---- a browser draws it ---------------------------------------------------------------------
const TYPES = { '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  const f = u.startsWith('/rc/') ? path.join(RC, u.slice(4)) : null;
  if (!f || !f.startsWith(RC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port, CDP = 9500 + Math.floor(Math.random() * 80);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xbr-sheet-'));
const ch = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`, `--remote-debugging-port=${CDP}`, `--user-data-dir=${tmp}/profile`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = code => { ch.kill(); server.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); };
let tabs;
for (let i = 0; i < 80 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); } catch { await sleep(250); } }
if (!tabs) { console.error('bakesheet: chromium did not start'); done(1); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
let rects;
for (let i = 0; i < 240 && !rects; i++) { await sleep(250); const v = (await send('Runtime.evaluate', { expression: 'window.__rects ? JSON.stringify({ r: window.__rects, b: window.__broken }) : ""', returnByValue: true })).result?.value; if (v) rects = JSON.parse(v); }
if (!rects) { console.error('bakesheet: the page never finished'); done(1); }
if (rects.b.length) { console.error('bakesheet: these logos did not load: ' + rects.b.join(', ')); done(1); }
const shot = (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })).data;
fs.writeFileSync(tmp + '/sheet.png', Buffer.from(shot, 'base64'));

// ---- what colour is each loose logo, mostly? ---------------------------------------------------
const raw = execFileSync('magick', [tmp + '/sheet.png', '-depth', '8', 'rgba:-'], { maxBuffer: W * H * 4 + 1024 });
const hex = v => Math.round(v).toString(16).padStart(2, '0');
const out = {};
cells.forEach((c, i) => {
  const rect = c.tight ? rects.r[i].map(Math.round) : [c.x, c.y, c.w, RH];
  const cell = { x: rect[0] - (c.tight ? 1 : 0), y: rect[1] - (c.tight ? 1 : 0) + H, w: rect[2] + (c.tight ? 2 : 0), h: rect[3] + (c.tight ? 2 : 0) };
  if (c.tight) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = rect[1]; yy < rect[1] + rect[3]; yy += 2) for (let xx = rect[0]; xx < rect[0] + rect[2]; xx += 2) { const o = (yy * W + xx) * 4, a = raw[o + 3] / 255; if (a > 0.5) { r += raw[o]; g += raw[o + 1]; b += raw[o + 2]; n++; } }
    if (!n) { console.error(`bakesheet: ${c.name} drew nothing`); done(1); }
    cell.fill = +(n * 4 / (rect[2] * rect[3])).toFixed(2);      // how much of its box a logo covers: a solid block makes poor cut vinyl
    cell.ink = c.guess || (c.fg ? c.fg.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3').toLowerCase() : hex(r / n) + hex(g / n) + hex(b / n));
  } else cell.bg = c.bg.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3').toLowerCase();
  out[c.name] = cell;
});

// ---- under the first sheet ---------------------------------------------------------------------
const first = ROOT + 'data/livery/atlas.png', meta = JSON.parse(fs.readFileSync(ROOT + 'data/livery/atlas.json', 'utf8'));
execFileSync('magick', [first, '-crop', `${W}x${H}+0+0`, '+repage', tmp + '/top.png']);
execFileSync('magick', [tmp + '/top.png', tmp + '/sheet.png', '-background', 'none', '-append', '-define', 'png:compression-level=9', first]);
const keep = Object.fromEntries(Object.entries(meta.cells).filter(([k, c]) => c.y < H && !/^(board|logo|logod):/.test(k)));
const brands = cells.filter(c => c.brand).map(c => ({ id: c.name.slice(6), name: c.brand, kind: c.kind, tier: c.tier, aspect: +(out[c.name].w / out[c.name].h).toFixed(2), laspect: +(out['logo:' + c.name.slice(6)].w / out['logo:' + c.name.slice(6)].h).toFixed(2) }));
fs.writeFileSync(ROOT + 'data/livery/atlas.json', JSON.stringify({ size: [W, H * 2], cells: { ...keep, ...out }, brands }));
console.log(`data/livery/atlas.png  ${W}x${H * 2}  +${cells.length} stickers of ${brands.length} sheet sponsors (${brands.filter(b => b.kind === 'real').length} real, ${brands.filter(b => b.kind === 'fake').length} invented, ${brands.filter(b => b.kind === 'joke').length} joke)  ${(fs.statSync(first).size / 1024).toFixed(0)} KB`);
done(0);
