// brands.js — the sponsors of a paddock that does not exist.
//
// Adam: "just make full only fake sonsors tho, but like all the current
// sponsors are just the name in the same font, no logos, no typography, etc
// etc. i want all those".
//
// He is describing exactly why a wall of trackside boards read as a
// spreadsheet. Every board was the same word in the same weight of the same
// typeface in the same box, and no amount of adding names fixes that, because
// the thing that makes a paddock look like a paddock is that no two sponsors
// agree about anything. A tyre company is a heavy italic sans. A bank is a
// quiet serif with a lot of letter-spacing. An energy drink is shouting.
//
// So a brand here is FOUR things, not one:
//
//   a NAME         — invented, all of them. No real marks anywhere.
//   a PALETTE      — its own two colours, and it owns them
//   a TYPEFACE     — family, weight, italic, letter-spacing, case
//   a MARK         — a logo, drawn as geometry rather than as a glyph
//
// The marks are drawn with arcs and triangles on purpose. A real logo is a
// SHAPE you recognise before you can read the word, which is the whole point
// of one, and at 200 m down a straight the shape is all that survives.
//
// Nothing in here is a real company. That was Adam's call and it is the right
// one: it means this file can be copied, shipped and screenshotted by anyone,
// forever, with nobody's lawyer involved.

// --- the marks ---------------------------------------------------------------
// Each draws inside a box of side `s` centred on (x, y), in `col`.
const MARKS = {
  chevron(g, x, y, s, col) {
    g.strokeStyle = col; g.lineWidth = s * 0.17; g.lineCap = 'butt';
    for (let i = 0; i < 2; i++) {
      const o = -s * 0.18 + i * s * 0.34;
      g.beginPath();
      g.moveTo(x - s * 0.32, y + o + s * 0.16);
      g.lineTo(x, y + o - s * 0.16);
      g.lineTo(x + s * 0.32, y + o + s * 0.16);
      g.stroke();
    }
  },
  disc(g, x, y, s, col) {
    g.fillStyle = col;
    g.beginPath(); g.arc(x, y, s * 0.42, 0, 6.2832); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(x + s * 0.16, y - s * 0.1, s * 0.3, 0, 6.2832); g.fill();
    g.globalCompositeOperation = 'source-over';
  },
  bars(g, x, y, s, col) {
    g.fillStyle = col;
    const h = [0.5, 0.82, 0.34];
    for (let i = 0; i < 3; i++) {
      const bw = s * 0.17, bh = s * h[i];
      g.fillRect(x - s * 0.36 + i * s * 0.28, y + s * 0.42 - bh, bw, bh);
    }
  },
  ring(g, x, y, s, col) {
    g.strokeStyle = col; g.lineWidth = s * 0.13;
    g.beginPath(); g.arc(x, y, s * 0.38, 0, 6.2832); g.stroke();
    g.beginPath(); g.arc(x, y, s * 0.18, 0, 6.2832); g.stroke();
  },
  bolt(g, x, y, s, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x + s * 0.14, y - s * 0.46); g.lineTo(x - s * 0.32, y + s * 0.06);
    g.lineTo(x - s * 0.02, y + s * 0.06); g.lineTo(x - s * 0.14, y + s * 0.46);
    g.lineTo(x + s * 0.32, y - s * 0.08); g.lineTo(x + s * 0.02, y - s * 0.08);
    g.closePath(); g.fill();
  },
  wing(g, x, y, s, col) {
    g.fillStyle = col;
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.26;
      g.beginPath();
      g.moveTo(x - s * 0.42 * k, y - s * 0.3 + i * s * 0.26);
      g.lineTo(x + s * 0.44 * k, y - s * 0.3 + i * s * 0.26);
      g.lineTo(x + s * 0.28 * k, y - s * 0.16 + i * s * 0.26);
      g.lineTo(x - s * 0.42 * k, y - s * 0.16 + i * s * 0.26);
      g.closePath(); g.fill();
    }
  },
  hex(g, x, y, s, col) {
    g.strokeStyle = col; g.lineWidth = s * 0.14;
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      const px = x + Math.cos(a) * s * 0.4, py = y + Math.sin(a) * s * 0.4;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.stroke();
  },
  arc(g, x, y, s, col) {
    g.strokeStyle = col; g.lineWidth = s * 0.16; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y + s * 0.16, s * 0.4, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    g.beginPath(); g.arc(x, y + s * 0.16, s * 0.16, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    g.lineCap = 'butt';
  },
  tri(g, x, y, s, col) {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - s * 0.44); g.lineTo(x + s * 0.42, y + s * 0.3);
    g.lineTo(x - s * 0.42, y + s * 0.3); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(x, y - s * 0.02); g.lineTo(x + s * 0.2, y + s * 0.3);
    g.lineTo(x - s * 0.2, y + s * 0.3); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
  },
};

// --- the roster ---------------------------------------------------------------
// Categories on purpose: a real grid is tyres, fuel, a bank, an airline, a
// watch, a freight company and something fizzy, and they look nothing alike.
const S = 'Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = '"Courier New", monospace';
const COND = '"Arial Narrow", Impact, sans-serif';

export const BRANDS = [
  // tyres & parts — heavy, italic, aggressive
  { n: 'VELOCITA', bg: '#d8352a', fg: '#fff', fam: S, w: '900', it: 1, sp: -0.01, mark: 'chevron' },
  { n: 'GRIPMAX', bg: '#101014', fg: '#ffd400', fam: S, w: '900', it: 1, sp: 0, mark: 'tri' },
  { n: 'BRAKEWELL', bg: '#1b1f26', fg: '#ff6b1a', fam: COND, w: '700', it: 0, sp: 0.04, mark: 'disc' },
  // fuel & energy — loud
  { n: 'KESTREL', bg: '#0f6b4a', fg: '#fff', fam: S, w: '800', it: 0, sp: 0.02, mark: 'wing' },
  { n: 'NORTHFLOW', bg: '#1b4fd8', fg: '#fff', fam: S, w: '700', it: 0, sp: 0.03, mark: 'arc' },
  { n: 'PYRA', bg: '#ff8000', fg: '#101014', fam: S, w: '900', it: 0, sp: 0.06, mark: 'tri' },
  { n: 'VOLTSURGE', bg: '#101014', fg: '#35d6a0', fam: COND, w: '700', it: 1, sp: 0.02, mark: 'bolt' },
  // banks & insurance — quiet, serif, spaced
  { n: 'NORTHWAY', bg: '#0b2a4a', fg: '#e8eaee', fam: SERIF, w: '600', it: 0, sp: 0.16, mark: 'hex' },
  { n: 'MERIDIAN', bg: '#f2efe6', fg: '#0b2a4a', fam: SERIF, w: '600', it: 0, sp: 0.14, mark: 'ring' },
  { n: 'ARGENT', bg: '#2a2d34', fg: '#c8a97a', fam: SERIF, w: '600', it: 0, sp: 0.18, mark: 'disc' },
  // airlines & freight
  { n: 'SKYLARK', bg: '#00a0de', fg: '#fff', fam: S, w: '300', it: 0, sp: 0.2, mark: 'wing' },
  { n: 'ATLAS FREIGHT', bg: '#b5121b', fg: '#fff', fam: COND, w: '700', it: 0, sp: 0.05, mark: 'bars' },
  { n: 'CARGOLINE', bg: '#f5c518', fg: '#101014', fam: S, w: '800', it: 0, sp: 0.02, mark: 'bars' },
  // tech & telecoms
  { n: 'HALDANE', bg: '#101014', fg: '#e8eaee', fam: MONO, w: '700', it: 0, sp: 0.08, mark: 'hex' },
  { n: 'NOVACORE', bg: '#6b2fd8', fg: '#fff', fam: S, w: '700', it: 0, sp: 0.06, mark: 'ring' },
  { n: 'BITWAVE', bg: '#e8eaee', fg: '#101014', fam: MONO, w: '700', it: 0, sp: 0.1, mark: 'arc' },
  { n: 'SIGNALIS', bg: '#0f8f6b', fg: '#fff', fam: S, w: '600', it: 0, sp: 0.12, mark: 'arc' },
  // watches & fashion — restrained
  { n: 'CHRONA', bg: '#141821', fg: '#d9c48a', fam: SERIF, w: '500', it: 0, sp: 0.24, mark: 'ring' },
  { n: 'HALCYON', bg: '#f2efe6', fg: '#1b1f26', fam: SERIF, w: '500', it: 0, sp: 0.22, mark: 'disc' },
  // fizzy
  { n: 'RUSH', bg: '#e8002d', fg: '#fff', fam: S, w: '900', it: 1, sp: -0.02, mark: 'bolt' },
  { n: 'ZEST', bg: '#b9e400', fg: '#101014', fam: S, w: '900', it: 0, sp: 0, mark: 'disc' },
  // and the studio's own, which should be the ones you see most
  { n: 'XANBOO78O', bg: '#101014', fg: '#35d6a0', fam: S, w: '900', it: 0, sp: 0.06, mark: 'hex' },
  { n: 'FOGLAST', bg: '#2a3340', fg: '#9fd8ff', fam: COND, w: '700', it: 0, sp: 0.1, mark: 'arc' },
  { n: 'VROOM', bg: '#ff8000', fg: '#101014', fam: S, w: '900', it: 1, sp: -0.01, mark: 'chevron' },
  { n: 'CRITTERS', bg: '#0f8f6b', fg: '#eafff4', fam: S, w: '800', it: 0, sp: 0.04, mark: 'disc' },
  { n: 'TERMINAL TYCOON', bg: '#0b0d10', fg: '#35d6a0', fam: MONO, w: '700', it: 0, sp: 0.04, mark: 'bars' },
  { n: 'ORBIX', bg: '#1b4fd8', fg: '#fff', fam: S, w: '900', it: 0, sp: 0.08, mark: 'ring' },
  { n: 'MOLT', bg: '#d8352a', fg: '#ffe9c7', fam: SERIF, w: '700', it: 0, sp: 0.12, mark: 'tri' },
  { n: 'EVERYDEATH', bg: '#14161b', fg: '#d8352a', fam: COND, w: '700', it: 1, sp: 0.06, mark: 'bolt' },
  { n: 'DEEPWALK', bg: '#3a2f22', fg: '#e8d9b5', fam: SERIF, w: '600', it: 0, sp: 0.14, mark: 'hex' },
];

/**
 * Draw one brand into a canvas rectangle: background, mark, wordmark.
 *
 * `letterSpacing` is a real canvas property in Chrome and the single biggest
 * lever on whether something reads as a bank or as an energy drink — so it is
 * set here rather than approximated by drawing letters one at a time.
 */
// `bare` draws only the mark and the wordmark, in `colour`, on a transparent
// cell — a sticker on paint, which is how most sponsors sit on a car.
export function drawBrand(g, w, h, b, { flat = false, bare = false, colour = null } = {}) {
  if (bare) { flat = true; b = { ...b, fg: colour || b.fg }; g.clearRect(0, 0, w, h); }
  else { g.fillStyle = b.bg; g.fillRect(0, 0, w, h); }

  // A thin rule in the text colour along the bottom. Real boards are printed
  // edge to edge, and it is what stops this reading as a flat rectangle when
  // it is 200 m away and four pixels tall.
  if (!flat) {
    g.fillStyle = b.fg; g.globalAlpha = 0.8;
    g.fillRect(0, h - Math.max(4, h * 0.07), w, Math.max(4, h * 0.07));
    g.globalAlpha = 1;
  }

  // The mark sits left, the wordmark takes the rest. At distance the mark is
  // the part that survives.
  const ms = h * 0.62;
  const mx = h * 0.52;
  if (MARKS[b.mark]) MARKS[b.mark](g, mx, h * 0.46, ms, b.fg);

  const tx0 = mx + ms * 0.62;
  const tw = w - tx0 - h * 0.18;
  const prev = g.letterSpacing;
  try { g.letterSpacing = `${(b.sp || 0).toFixed(3)}em`; } catch { /* older canvas */ }
  let size = h * 0.56;
  const font = s => `${b.it ? 'italic ' : ''}${b.w} ${s}px ${b.fam}`;
  for (; size > 7; size -= 1) { g.font = font(size); if (g.measureText(b.n).width <= tw) break; }
  g.fillStyle = b.fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(b.n, tx0, h * 0.44);
  try { g.letterSpacing = prev || '0px'; } catch { /* ignore */ }
}

/** A stable pick, so the same circuit always wears the same boards. */
export function brandNamed(n) { return BRANDS.find(b => b.n === n) || null; }

export function brandAt(i) { return BRANDS[((i % BRANDS.length) + BRANDS.length) % BRANDS.length]; }
