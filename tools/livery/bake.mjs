// bake.mjs — the liveries: eighty teams for every downloaded car.
//
//   node tools/livery/bake.mjs [car ...]      (default: every car in data/cars/index.json)
//
// Adam, 2026-10-08: "we need 80 bomb liveries per car … cool liveries that
// some may like others may not, lotta sponsors and stickers and sick colors n
// patterns … their the rivals". So a livery here is a TEAM: a name, a number, a
// title sponsor and the others who pay, a paint scheme, and stickers put where
// a real car carries them.
//
// HOW ONE IS MADE
//   paint     a DESIGN (thirty-two of them below: stripes, sweeps, zebra, drips,
//             pixels, two-face …) in a COLOURWAY (seventy below), as layers of
//             shape for data/livery/livery.glsl — fitted to any car by where
//             its bodywork is, not painted for one model
//   stickers  from the sheet data/livery/atlas.png (tools/livery/bakeatlas.mjs),
//             each placed by MEASURING the car: tools/livery/carmask.mjs draws
//             its paintwork from the side and from above, and a sticker goes
//             only where at least nine tenths of it lands on paint
//   vinyl     a cut-vinyl logo takes whichever of white, black or the team's
//             own colours stands out most against the paint under it
//
// Every name is invented. Deterministic: the same teams every run.
// Writes data/livery/<car>.json.
import fs from 'fs';
import { SPONSORS } from './sponsors.mjs';
import { rasters, MW, MH } from './carmask.mjs';
import { NAMES, TAILS, KEEP, PRIDE, REAL } from './teams.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const atlas = JSON.parse(fs.readFileSync(ROOT + 'data/livery/atlas.json', 'utf8'));

// ---- colours ---------------------------------------------------------------------------
const C = {
  white: 'f4f3ee', bone: 'e6e0cf', cream: 'f3e6c0', silver: 'b9bec4', gun: '4a4e55', black: '0e0f12', carbon: '1b1c20',
  red: 'd6001c', crimson: '8a0f24', coral: 'ff6b5a', orange: 'ff5a1f', papaya: 'ff7a00', amber: 'ffb000', yellow: 'ffd400', volt: 'cfff1a',
  lime: '7ed321', green: '1f9d48', racing: '0b4d33', teal: '00b3a4', mint: '7fe3c4', cyan: '31c6f5', sky: '8fcbea',
  blue: '1a55d8', royal: '0c2f9c', navy: '0c1838', purple: '6a2fb0', violet: 'a26bff', lilac: 'cdb4ff', magenta: 'e0218a', pink: 'ff7ab8', blush: 'ffd1e0',
  gold: 'c9a13b', bronze: '8a5a2b', sand: 'd9c08a', brown: '5a3a22', olive: '6b6b2a', mustard: 'd4a017', rust: 'b4532a',
};
// name, body, graphic, accent, dark; finish: 0 gloss · 1 matte · 2 metallic · 3 chrome · 4 pearl
const WAYS = [
  ['Bone', 'bone', 'royal', 'red', 'carbon'], ['Midnight', 'navy', 'white', 'amber', 'black'], ['Papaya', 'papaya', 'black', 'white', 'carbon'],
  ['Mint Choc', 'mint', 'brown', 'white', 'carbon'], ['Gunmetal Volt', 'gun', 'volt', 'white', 'black', 2], ['Powder', 'sky', 'orange', 'navy', 'navy'],
  ['Scarlet', 'red', 'white', 'black', 'carbon'], ['Racing Green', 'racing', 'yellow', 'white', 'black'], ['Silver Arrow', 'silver', 'black', 'red', 'carbon', 3],
  ['Violet Hour', 'purple', 'white', 'volt', 'black', 4], ['Fire and Ice', 'white', 'red', 'cyan', 'carbon'], ['Reef', 'teal', 'navy', 'white', 'black'],
  ['Sunset', 'amber', 'magenta', 'white', 'black'], ['Stealth', 'carbon', 'gun', 'volt', 'black', 1], ['Bubblegum', 'pink', 'cyan', 'white', 'navy'],
  ['Blue and Gold', 'blue', 'gold', 'white', 'navy', 2], ['Tangerine', 'white', 'orange', 'navy', 'carbon'], ['Jade', 'racing', 'mint', 'gold', 'black', 2],
  ['Coral Reef', 'navy', 'coral', 'cyan', 'black'], ['Desert', 'sand', 'brown', 'orange', 'carbon', 1], ['Volt', 'black', 'volt', 'white', 'carbon', 1],
  ['Blood', 'white', 'red', 'black', 'black'], ['Ultraviolet', 'navy', 'violet', 'magenta', 'black', 4], ['Hornet', 'yellow', 'black', 'white', 'carbon'],
  ['Arctic', 'silver', 'cyan', 'white', 'gun', 2], ['Regatta', 'white', 'navy', 'red', 'black'], ['Lagoon', 'cyan', 'navy', 'white', 'black'],
  ['Ember', 'crimson', 'black', 'amber', 'black', 2], ['Pistachio', 'bone', 'green', 'gold', 'carbon'], ['Plum', 'purple', 'black', 'pink', 'black', 2],
  ['Dawn', 'amber', 'magenta', 'navy', 'navy'], ['Deep Sea', 'cyan', 'navy', 'volt', 'black'], ['Lava', 'yellow', 'red', 'black', 'black'],
  ['Aurora', 'mint', 'purple', 'white', 'navy', 4], ['Smoke', 'silver', 'black', 'red', 'black', 1], ['Signal', 'white', 'red', 'blue', 'carbon'],
  ['Wasp', 'black', 'yellow', 'white', 'carbon', 1], ['Glacier', 'sky', 'white', 'navy', 'navy'], ['Citrus', 'lime', 'navy', 'white', 'black'],
  ['Copper', 'carbon', 'bronze', 'gold', 'black', 2], ['Newsprint', 'white', 'black', 'red', 'carbon'], ['Pop', 'yellow', 'magenta', 'cyan', 'black'],
  ['Night Shift', 'navy', 'cyan', 'white', 'black'], ['Jungle', 'lime', 'racing', 'white', 'black'], ['Peach', 'bone', 'orange', 'navy', 'carbon'],
  ['Woodland', 'racing', 'brown', 'sand', 'black', 1], ['Urban', 'silver', 'gun', 'white', 'black', 1], ['Toxic', 'black', 'volt', 'purple', 'carbon', 1],
  ['Dune', 'sand', 'bronze', 'white', 'brown', 1], ['Clubman', 'racing', 'yellow', 'white', 'black'], ['Works', 'white', 'blue', 'red', 'carbon'],
  ['Gold Leaf', 'crimson', 'gold', 'white', 'black', 2], ['Seventies', 'orange', 'brown', 'cream', 'black'], ['Night Race', 'black', 'magenta', 'cyan', 'carbon', 1],
  ['Thunder', 'navy', 'yellow', 'white', 'black'], ['Neon', 'black', 'cyan', 'magenta', 'carbon', 1], ['Royal', 'royal', 'white', 'red', 'navy', 2],
  ['Diner', 'red', 'cream', 'black', 'black'], ['Arcade', 'purple', 'volt', 'white', 'black'], ['Honey', 'amber', 'black', 'white', 'carbon'],
  ['Candy', 'white', 'pink', 'red', 'crimson'], ['Rust', 'bone', 'rust', 'orange', 'brown', 1], ['Tropic', 'teal', 'yellow', 'magenta', 'navy'],
  ['Mojito', 'white', 'lime', 'racing', 'carbon'], ['Oranje', 'orange', 'white', 'blue', 'navy'], ['Samba', 'yellow', 'green', 'blue', 'racing'],
  ['Kiwi', 'black', 'silver', 'white', 'carbon', 2], ['Ice Cream', 'blush', 'mint', 'cream', 'brown'], ['Mustard Gas', 'mustard', 'purple', 'white', 'black'],
  ['Avocado', 'olive', 'cream', 'orange', 'brown', 1], ['Chrome Dome', 'silver', 'magenta', 'cyan', 'black', 3], ['Lilac Wine', 'lilac', 'crimson', 'white', 'navy', 4],
  ['Highlighter', 'volt', 'magenta', 'black', 'black'], ['Lifeguard', 'red', 'yellow', 'white', 'navy'], ['Swimming Pool', 'cyan', 'white', 'coral', 'royal'],
  ['Brown Sugar', 'brown', 'cream', 'amber', 'black', 2], ['Flamingo', 'pink', 'black', 'white', 'carbon'], ['Pearl', 'white', 'silver', 'gold', 'gun', 4],
];

// ---- the designs ---------------------------------------------------------------------------
const STRIPE = 1, SKIRT = 2, CUT = 3, SWEEP = 4, SLASH = 5, CAP = 6, ROOF = 7, HOOP = 8, FADE = 9, ARROW = 10, DOTS = 11, CAMO = 12, ROUNDEL = 13, CHECK = 14,
  ZEBRA = 15, TEETH = 16, WAVE = 17, BURST = 18, PIXEL = 19, DRIP = 20, BAND = 21;
const L = (t, c, q0 = 0, q1 = 0, q2 = 0, q3 = 0, s = 0) => ({ t, c, q: [q0, q1, q2, q3], s });
const ALL = c => L(CAP, c, -9, 1);                    // the whole car (used with a side: one flank only)
const DESIGNS = {
  'TWIN STRIPE': (a, b, c, d) => [L(SKIRT, d, 0.20, 0), L(STRIPE, b, 0.085, 0.16), L(STRIPE, c, 0.012, 0.275)],
  'LE MANS': (a, b, c, d) => [L(STRIPE, b, 0.17, 0), L(STRIPE, c, 0.02, 0.23), L(SKIRT, d, 0.17, 0)],
  'HALF AND HALF': (a, b, c, d) => [L(CUT, b, -0.05, -0.75, -1, 0), L(CUT, c, -0.05, -0.75, 1, 0), L(CUT, a, 0.07, -0.75, 1, 0), L(SKIRT, d, 0.16, 0)],
  'SWEEP': (a, b, c, d) => [L(SWEEP, b, 0.46, -0.20, 0.13, 0.5), L(SWEEP, c, 0.63, -0.20, 0.022, 0.5), L(CAP, b, 0.72, -1), L(SKIRT, d, 0.15, 0)],
  'SLASHER': (a, b, c, d) => [L(SLASH, b, 2.6, -1.5, 0.34, 0.55), L(CAP, c, 0.74, 1), L(ROOF, d, 0.86, 0.6), L(SKIRT, d, 0.15, 0)],
  'LOWLINE': (a, b, c, d) => [L(SKIRT, b, 0.42, 0.10), L(SKIRT, c, 0.31, 0.10), L(SKIRT, d, 0.28, 0.10), L(ROOF, b, 0.88, 0.5)],
  'FADE': (a, b, c, d) => [L(FADE, b, -0.55, 0.65, -1), L(STRIPE, c, 0.02, 0.2), L(SKIRT, d, 0.15, 0)],
  'ARROW': (a, b, c, d) => [L(ARROW, b, 1.05, 0.62, 0.42), L(ARROW, a, 0.78, 0.62, 0.42), L(ARROW, c, 0.62, 0.62, 0.42), L(ARROW, a, 0.52, 0.62, 0.42), L(SKIRT, d, 0.19, 0.03)],
  'HALFTONE': (a, b, c, d) => [L(CAP, b, 0.30, -1), L(DOTS, b, 9, 0.62, -1), L(STRIPE, c, 0.014, 0.3), L(SKIRT, d, 0.14, 0)],
  'CAMO': (a, b, c, d) => [L(CAMO, b, 2.4, 0.50, 3.1), L(CAMO, c, 3.3, 0.36, 11.7), L(CAMO, d, 4.6, 0.22, 27.3)],
  'CLUBMAN': (a, b, c, d) => [L(SKIRT, b, 0.24, 0), L(SKIRT, c, 0.205, 0), L(SKIRT, d, 0.18, 0), L(STRIPE, b, 0.03, 0.09), L(CAP, b, 0.82, 1)],
  'BOLT': (a, b, c, d) => [L(CUT, b, 0.18, 1.5, 1, 0), L(CUT, a, 0.52, 1.5, 1, 0), L(CUT, c, 0.62, 1.5, 1, 0), L(CUT, a, 0.70, 1.5, 1, 0), L(CAP, d, 0.80, -1), L(SKIRT, d, 0.13, 0)],
  'CHEQUER': (a, b, c, d) => [L(CHECK, b, 5, 4.2, -0.38), L(HOOP, c, 0.5, 0.31, 0.02), L(STRIPE, c, 0.02, 0.0), L(SKIRT, d, 0.15, 0)],
  'HOOPS': (a, b, c, d) => [L(HOOP, b, 0.5, 0.78, 0.10), L(HOOP, c, 0.5, 0.86, 0.03), L(CAP, b, 0.80, 1), L(ROOF, d, 0.88, 0.55), L(SKIRT, d, 0.14, 0)],
  'DAZZLE': (a, b, c, d) => [L(SLASH, b, 1.3, 2.2, 0.5, 0.0), L(SLASH, c, 3.1, -1.1, 0.22, 0.45), L(CUT, d, 0.62, 0.9, -1, 0), L(SKIRT, d, 0.13, 0)],
  'TRICOLORE': (a, b, c, d) => [L(STRIPE, b, 0.07, 0.0), L(STRIPE, c, 0.035, 0.105), L(SWEEP, b, 0.36, 0.0, 0.05, 0.5), L(SWEEP, c, 0.27, 0.0, 0.035, 0.5), L(SKIRT, d, 0.15, 0)],
  'ZEBRA': (a, b, c, d) => [L(ZEBRA, b, 4.2, 6.5, 0.20, 0.46), L(CAP, c, 0.84, 1), L(SKIRT, d, 0.12, 0)],
  'TIGER': (a, b, c, d) => [L(ZEBRA, b, 6.5, 9, 0.16, 0.30), L(FADE, c, 0.2, 0.95, 1), L(ZEBRA, b, 6.5, 9, 0.16, 0.16), L(SKIRT, d, 0.12, 0)],
  'SHARK': (a, b, c, d) => [L(TEETH, b, 0.30, 0.16, 4.5), L(TEETH, c, 0.25, 0.16, 4.5), L(TEETH, d, 0.21, 0.16, 4.5), L(CAP, b, 0.86, 1)],
  'WAVE': (a, b, c, d) => [L(WAVE, b, 0.42, 0.10, 1.4, 0.11), L(WAVE, c, 0.60, 0.10, 1.4, 0.022), L(STRIPE, b, 0.05, 0.0), L(SKIRT, d, 0.14, 0)],
  'SUNBURST': (a, b, c, d) => [L(BURST, b, -0.72, 0.16, 15, 0.5), L(CAP, b, 0.60, -1), L(STRIPE, c, 0.03, 0.14), L(SKIRT, d, 0.13, 0)],
  'PIXEL': (a, b, c, d) => [L(PIXEL, b, 9, 0.25, 1), L(PIXEL, c, 15, -0.15, 1), L(CAP, b, 0.78, -1), L(SKIRT, d, 0.13, 0)],
  'DRIP': (a, b, c, d) => [L(DRIP, b, 0.80, 0.50, 13), L(DRIP, c, 0.92, 0.26, 21), L(SKIRT, d, 0.12, 0)],
  'TWO-FACE': (a, b, c, d) => [L(CAP, b, -9, 1, 0, 0, -1), L(STRIPE, c, 0.035, 0.0), L(SKIRT, d, 0.16, 0)],
  'HARLEQUIN': (a, b, c, d) => [L(CHECK, b, 2.2, 1.9, 9), L(STRIPE, c, 0.025, 0.0), L(SKIRT, d, 0.12, 0)],
  'PINSTRIPE': (a, b, c, d) => [L(STRIPE, b, 0.012, 0.08), L(STRIPE, b, 0.012, 0.13), L(STRIPE, c, 0.012, 0.18), L(SWEEP, b, 0.36, 0, 0.012, 0.5), L(SWEEP, b, 0.31, 0, 0.012, 0.5), L(SWEEP, c, 0.26, 0, 0.012, 0.5), L(SKIRT, d, 0.14, 0)],
  'BLOCK': (a, b, c, d) => [L(CAP, b, 0.34, 1), L(CAP, c, 0.46, -1), L(ROOF, d, 0.86, 0.6), L(SKIRT, d, 0.13, 0)],
  'SPEEDFORM': (a, b, c, d) => [L(CUT, b, -0.30, 1.9, 1, 0), L(CUT, a, 0.30, 1.9, 1, 0), L(CUT, c, 0.40, 1.9, 1, 0), L(CUT, a, 0.46, 1.9, 1, 0), L(SKIRT, d, 0.14, 0)],
  'GLITCH': (a, b, c, d) => [L(PIXEL, b, 22, 0.1, -1), L(HOOP, c, 0.5, 0.42, 0.012), L(HOOP, b, 0.5, 0.455, 0.03), L(SLASH, c, 7, 0, 0.06, 0.5), L(SKIRT, d, 0.13, 0)],
  'POLKA': (a, b, c, d) => [L(DOTS, b, 6, 0.34, 0), L(STRIPE, c, 0.03, 0.0), L(SKIRT, d, 0.14, 0)],
  'CONTOUR': (a, b, c, d) => [L(WAVE, b, 0.30, 0.07, 2.2, 0.012), L(WAVE, b, 0.40, 0.09, 2.2, 0.012), L(WAVE, c, 0.50, 0.11, 2.2, 0.012), L(WAVE, b, 0.60, 0.09, 2.2, 0.012), L(WAVE, b, 0.70, 0.07, 2.2, 0.012), L(CAP, b, 0.82, 1), L(SKIRT, d, 0.13, 0)],
  'OFFSET': (a, b, c, d) => [L(STRIPE, b, 0.11, 0.42, 0, 0, 1), L(STRIPE, c, 0.016, 0.26, 0, 0, 1), L(STRIPE, c, 0.016, 0.58, 0, 0, 1), L(SKIRT, d, 0.16, 0)],
};
const DNAMES = Object.keys(DESIGNS);
// A design's dots are a plain polka when q.z is 0; give that the shader's meaning.
for (const k of ['POLKA']) { const f = DESIGNS[k]; DESIGNS[k] = (...x) => f(...x).map(l => (l.t === DOTS ? { ...l, q: [l.q[0], l.q[1] * 2, 0, 9] } : l)); }

// ---- the shapes again, in JS, to ask "what colour is the paint HERE?" ----------------------------
const fract = x => x - Math.floor(x), step = (e, x) => (x >= e ? 1 : 0), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const hash = (x, y) => { let px = fract(x * 123.34), py = fract(y * 456.21); const d = px * (px + 45.32) + py * (py + 45.32); px += d; py += d; return fract(px * py); };
const noise = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = (a, b, t) => a + (b - a) * t; return m(m(hash(ix, iy), hash(ix + 1, iy), fx), m(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy); };
function paintAt(liv, p) {
  let c = liv.base;
  const az = Math.abs(p[2]);
  for (const l of liv.layers) {
    const q = l.q; let m = 0;
    if (l.s * p[2] < -1e-4) continue;
    switch (l.t) {
      case 1: m = step(Math.abs(az - q[1]), q[0]); break;
      case 2: m = step(p[1], q[0] + q[1] * p[0]); break;
      case 3: m = step(q[0], p[0] * q[2] + p[1] * q[1] + az * q[3]); break;
      case 4: m = step(Math.abs(p[1] - (q[0] + q[1] * p[0])), q[2]) * step(q[3], az); break;
      case 5: m = step(fract(p[0] * q[0] + p[1] * q[1]), q[2]) * step(q[3], az); break;
      case 6: m = step(q[0], p[0] * q[1]); break;
      case 7: m = step(q[0], p[1]) * step(az, q[1]); break;
      case 8: m = step(fract(p[0] * q[0] + q[1]), q[2]); break;
      case 9: m = clamp((p[0] * q[2] - q[0]) / (q[1] - q[0]), 0, 1) > 0.5 ? 1 : 0; break;
      case 10: m = step(az, (q[0] - p[0]) * q[1]) * step(q[2], p[1]); break;
      case 11: { const gx = fract(p[0] * q[0]) - 0.5, gy = fract((p[1] + az * 0.5) * q[0] * 0.45) - 0.5; m = step(Math.hypot(gx, gy), q[1] * clamp((p[0] * q[2] + 1) * 0.5, 0, 1)); break; }
      case 12: m = step(1 - q[1], noise(p[0] * 2.2 * q[0] + q[2], (p[1] + az * 0.9) * q[0] + q[2]) * 0.6 + noise(p[0] * 2.2 * q[0] * 2.3 + q[2] * 1.7, (p[1] + az * 0.9) * q[0] * 2.3 + q[2] * 1.7) * 0.4); break;
      case 13: m = step(Math.hypot((p[0] - q[0]) * q[3], p[1] - q[1]), q[2]) * step(0.62, az); break;
      case 14: m = step(p[0], q[2]) * Math.abs(step(0.5, fract(p[0] * q[0])) - step(0.5, fract((p[1] + az * 0.6) * q[1]))); break;
      case 15: m = step(fract(p[0] * q[0] + Math.sin((p[1] + az * 0.7) * q[1]) * q[2]), q[3]); break;
      case 16: m = step(p[1], q[0] + q[1] * Math.abs(fract(p[0] * q[2]) - 0.5) * 2); break;
      case 17: m = step(Math.abs(p[1] - (q[0] + q[1] * Math.sin(p[0] * q[2] * Math.PI))), q[3]) * step(0.45, az); break;
      case 18: m = step(fract(Math.atan2(p[1] - q[1], (p[0] - q[0]) * 1.8) * q[2] / 6.28318), q[3]) * step(0.45, az); break;
      case 19: m = step(hash(Math.floor(p[0] * q[0] * 2.2), Math.floor((p[1] + az * 0.6) * q[0])), clamp((q[2] - p[0] * q[3]) * 0.9, 0, 1)); break;
      case 20: { const k = 0.5 + 0.5 * Math.sin(p[0] * q[2] + 1.7 * Math.sin(p[0] * q[2] * 0.37)); m = step(q[0] - q[1] * k * k * k, p[1]); break; }
      case 21: m = step(q[0], p[2]) * step(p[2], q[1]); break;
    }
    if (m) c = l.c;
  }
  return c;
}
const lum = h => { const f = i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ---- where things go on each car (in the livery's own coordinates; the mask has the last word)
// flank zones: [x0, x1, y0, y1].  top zones: [z0, z1, x0, x1].
const ZONES = {
  p911: { door: [-0.32, 0.30, 0.20, 0.60], quarter: [-0.80, -0.34, 0.54, 0.76], fender: [0.36, 0.84, 0.48, 0.66], sill: [-0.36, 0.36, 0.13, 0.27], bonnet: [-0.52, 0.52, 0.46, 0.88], roof: [-0.44, 0.44, -0.28, 0.13], deck: [-0.6, 0.6, -0.99, -0.78] },
  m720: { door: [-0.30, 0.36, 0.20, 0.62], quarter: [-0.88, -0.44, 0.56, 0.78], fender: [0.38, 0.82, 0.50, 0.68], sill: [-0.32, 0.38, 0.10, 0.25], bonnet: [-0.55, 0.55, 0.72, 0.98], roof: [-0.42, 0.42, -0.32, 0.11], deck: [-0.9, 0.9, -1.0, -0.88] },
  g55: { door: [-0.44, 0.08, 0.18, 0.64], quarter: [-0.94, -0.62, 0.28, 0.72], fender: [0.38, 0.88, 0.48, 0.66], sill: [-0.38, 0.38, 0.06, 0.2], bonnet: [-0.30, 0.30, 0.74, 0.97], roof: [-0.48, 0.48, -0.48, 0.02], deck: [-0.8, 0.8, -1.0, -0.88] },
  a480: { door: [-0.46, 0.40, 0.12, 0.44], quarter: [-0.98, -0.12, 0.48, 0.78], fender: [0.42, 0.92, 0.34, 0.52], sill: [-0.42, 0.32, 0.08, 0.2], bonnet: [-0.26, 0.26, 0.54, 0.96], roof: [-0.32, 0.32, -0.16, 0.22], deck: [-0.22, 0.22, -0.92, -0.32] },
  // 2026-10-10: three more GT3s and the grand prix car. On the single-seater the 'door' is the sidepod,
  // the 'quarter' the engine cover, the 'fender' the nose, the 'roof' the top of the engine cover and the 'deck' the rear wing.
  m4: { door: [-0.26, 0.30, 0.20, 0.60], quarter: [-0.86, -0.36, 0.50, 0.72], fender: [0.34, 0.86, 0.45, 0.65], sill: [-0.30, 0.36, 0.10, 0.22], bonnet: [-0.52, 0.52, 0.44, 0.90], roof: [-0.40, 0.40, -0.32, 0.06], deck: [-0.6, 0.6, -0.96, -0.74] },
  p992: { door: [-0.30, 0.30, 0.20, 0.60], quarter: [-0.82, -0.34, 0.55, 0.76], fender: [0.34, 0.86, 0.48, 0.64], sill: [-0.36, 0.36, 0.10, 0.24], bonnet: [-0.52, 0.52, 0.50, 0.90], roof: [-0.42, 0.42, -0.22, 0.16], deck: [-0.6, 0.6, -0.96, -0.74] },
  hura: { door: [-0.36, 0.30, 0.20, 0.60], quarter: [-0.86, -0.40, 0.54, 0.76], fender: [0.34, 0.82, 0.48, 0.66], sill: [-0.40, 0.36, 0.10, 0.22], bonnet: [-0.52, 0.52, 0.58, 0.96], roof: [-0.40, 0.40, -0.12, 0.26], deck: [-0.6, 0.6, -0.96, -0.74] },
  f122: { door: [-0.50, 0.22, 0.24, 0.60], quarter: [-0.90, -0.40, 0.45, 0.80], fender: [0.30, 0.92, 0.18, 0.46], sill: [-0.50, 0.22, 0.12, 0.30], bonnet: [-0.20, 0.20, 0.44, 0.96], roof: [-0.30, 0.30, -0.62, -0.08], deck: [-0.5, 0.5, -1.0, -0.84] },
  // later the same day: two more GT4s and a second hypercar
  m4g4: { door: [-0.30, 0.25, 0.20, 0.60], quarter: [-0.85, -0.40, 0.50, 0.72], fender: [0.35, 0.85, 0.45, 0.65], sill: [-0.30, 0.30, 0.10, 0.22], bonnet: [-0.50, 0.50, 0.45, 0.90], roof: [-0.40, 0.40, -0.35, 0.05], deck: [-0.6, 0.6, -0.95, -0.75] },
  amg4: { door: [-0.35, 0.15, 0.20, 0.60], quarter: [-0.90, -0.50, 0.50, 0.72], fender: [0.30, 0.85, 0.45, 0.65], sill: [-0.35, 0.30, 0.10, 0.22], bonnet: [-0.50, 0.50, 0.35, 0.90], roof: [-0.38, 0.38, -0.50, -0.20], deck: [-0.6, 0.6, -0.98, -0.80] },
  f499: { door: [-0.50, 0.30, 0.15, 0.45], quarter: [-0.95, -0.20, 0.45, 0.80], fender: [0.40, 0.90, 0.30, 0.50], sill: [-0.40, 0.30, 0.08, 0.20], bonnet: [-0.30, 0.30, 0.50, 0.95], roof: [-0.30, 0.30, -0.20, 0.20], deck: [-0.30, 0.30, -0.90, -0.40] },
  a110: { door: [-0.30, 0.25, 0.20, 0.60], quarter: [-0.85, -0.40, 0.50, 0.72], fender: [0.35, 0.85, 0.45, 0.62], sill: [-0.30, 0.30, 0.10, 0.22], bonnet: [-0.50, 0.50, 0.50, 0.90], roof: [-0.40, 0.40, -0.30, 0.20], deck: [-0.5, 0.5, -0.95, -0.78] },
  p9x8: { door: [-0.45, 0.30, 0.15, 0.50], quarter: [-0.90, -0.30, 0.50, 0.85], fender: [0.40, 0.90, 0.30, 0.50], sill: [-0.40, 0.30, 0.08, 0.22], bonnet: [-0.30, 0.30, 0.55, 0.95], roof: [-0.30, 0.30, -0.25, 0.15], deck: [-0.5, 0.5, -0.95, -0.60] },
};

// ---- who they are ----------------------------------------------------------------------------------
const PADDOCK = {
  p911: { klass: 'CUP', pre: ['Nordkurve', 'Eifel', 'Kessel', 'Adler', 'Rheingold', 'Sturmvogel', 'Kranich', 'Lindner', 'Zuffenwerk', 'Schwarzwald', 'Alpenblick', 'Hafen', 'Kaiser', 'Edelweiss', 'Donau', 'Steinadler', 'Blitz', 'Bergmann', 'Falkenhorst', 'Nordsee', 'Rotkäppchen', 'Tannhauser', 'Vogel', 'Wolff & Sohn', 'Zeppelin', 'Brandt', 'Himmel', 'Kugel', 'Morgenrot', 'Silberpfeil Club', 'Uhlenhorst', 'Elbe', 'Feuerbach', 'Grünwald', 'Isar', 'Jäger'],
          suf: ['Motorsport', 'Racing', 'Rennsport', 'Cup Team', 'Racing Team', 'Performance', 'Engineering', 'Competition'] },
  m720: { klass: 'GT3', pre: ['Vanta', 'Helix', 'Paragon', 'Monarch', 'Cobalt', 'Ignis', 'Vector', 'Strato', 'Zenith', 'Halberd', 'Solaris', 'Obsidian', 'Tempest', 'Aurum', 'Kinetic', 'Nova', 'Raptor', 'Citadel', 'Apex Union', 'Blackbird', 'Corsair', 'Delta Nine', 'Emissary', 'Foxhound', 'Gryphon', 'Hyperion', 'Icarus', 'Javelin', 'Kite', 'Lumen', 'Mantis', 'Northstar', 'Onyx', 'Phantom Ray', 'Quasar', 'Redline Syndicate'],
          suf: ['GT', 'Racing', 'Motorsport', 'Corse', 'Squadra', 'Endurance', 'Autosport', 'GT Team'] },
  g55: { klass: 'GT4', pre: ['Thistle', 'Pennine', 'Cotswold', 'Fenland', 'Mersey', 'Tyne', 'Severn', 'Wessex', 'Biscuit Tin', 'Dad & Lad', 'Shed Eleven', 'Two Brews', 'Rain Stopped Play', 'Gravel Trap', "Kev's Garage", 'Team Bodge', 'Flat Cap', 'Chip Shop', 'Soggy Bottom', 'Proper Job', 'Last Orders', 'Wellington Boot', 'Cheeky Nando', 'Sunday Roast', 'Mind The Gap', 'Jolly Good', 'Tea Break', 'Garden Shed', 'Brolly', 'Crumpet', 'Bank Holiday', 'Hedgerow', 'Pork Pie', 'Marmalade', 'Zebra Crossing', 'Double Decker'],
         suf: ['Racing', 'Motorsport', 'Racing Club', 'Heroes', 'Autosport', 'Racing Team', 'GT', 'Motor Club'] },
  a480: { klass: 'HYPER', pre: ['Aurore', 'Mistral', 'Tramontane', 'Kumo', 'Hayate', 'Raijin', 'Solstice', 'Borealis', 'Vostok', 'Titan', 'Helios', 'Écurie Lumière', 'Scuderia Volpe', 'Équipe Vingt-Quatre', 'Sirocco', 'Polaris', 'Meteor', 'Corona', 'Tsunami', 'Ventoux', 'Zephyr', 'Arcadia', 'Bifrost', 'Calypso', 'Daedalus', 'Elysium', 'Fenrir', 'Galatea', 'Horizon', 'Ionosphere', 'Juno', 'Krakatoa', 'Leviathan', 'Midnight Sun', 'Nebula', 'Orion'],
          suf: ['Hypercar', 'Endurance', 'Works', 'Factory', 'Prototype', 'Racing', 'Le Mans', 'Sport'] },
  // (the cars of 2026-10-10 never had generated names: these hats only feed the draw that is thrown away)
  m4: { klass: 'GT3', pre: Array.from({ length: 36 }, (_, k) => 'M' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  p992: { klass: 'GT3', pre: Array.from({ length: 36 }, (_, k) => 'P' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  hura: { klass: 'GT3', pre: Array.from({ length: 36 }, (_, k) => 'H' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  f122: { klass: 'PRO', pre: Array.from({ length: 36 }, (_, k) => 'F' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  m4g4: { klass: 'GT4', pre: Array.from({ length: 36 }, (_, k) => 'B' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  amg4: { klass: 'GT4', pre: Array.from({ length: 36 }, (_, k) => 'A' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  f499: { klass: 'HYPER', pre: Array.from({ length: 36 }, (_, k) => 'R' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  a110: { klass: 'GT4', pre: Array.from({ length: 36 }, (_, k) => 'L' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
  p9x8: { klass: 'HYPER', pre: Array.from({ length: 36 }, (_, k) => 'X' + k), suf: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
};

// ---- a pride flag, as paint -----------------------------------------------------------------
// Four ways to fly one, so ten pride cars in a paddock are not ten of the same car:
//   0 nose to tail   1 on the slant   2 flown along the flanks   3 a ribbon on a dark car, and laid across the top
function prideLivery(flag, variant) {
  const cs = flag.cols, n = cs.length, w = flag.w || cs.map(() => 1), tot = w.reduce((a, b) => a + b, 0);
  const F = [0]; for (const x of w) F.push(F[F.length - 1] + x / tot);             // where each stripe ends, 0..1
  if (flag.ring) {
    // one colour and a ring: on each door, and hoops in the ring's colour fore and aft
    return { base: cs[0], layers: [L(ROUNDEL, flag.ring, -0.02, 0.46, 0.25, 1.8), L(ROUNDEL, cs[0], -0.02, 0.46, 0.16, 1.8), L(HOOP, flag.ring, 0.5, 0.80 + variant * 0.03, 0.035), L(STRIPE, flag.ring, 0.02, 0.0), L(SKIRT, '0e0f12', 0.13, 0)] };
  }
  if (flag.chevron) {
    // the six stripes along the flanks, and the five chevrons driving in from the nose over the top
    const layers = [];
    for (let k = 1; k < n; k++) layers.push(L(SKIRT, cs[k], 0.92 - 0.80 * F[k], 0));
    flag.chevron.forEach((c, k) => layers.push(L(ARROW, c, 1.02 - k * 0.13, 0.75, 0.40)));
    return { base: cs[0], layers };
  }
  const layers = [];
  if (variant === 0) { for (let k = n - 2; k >= 0; k--) layers.push(L(CAP, cs[k], 1 - 2 * F[k + 1], 1)); return { base: cs[n - 1], layers }; }
  if (variant === 1) { for (let k = n - 2; k >= 0; k--) layers.push(L(CUT, cs[k], 1.0 - 2.9 * F[k + 1], -0.9, 1, 0)); return { base: cs[n - 1], layers }; }
  if (variant === 2) { for (let k = 1; k < n; k++) layers.push(L(SKIRT, cs[k], 0.92 - 0.80 * F[k], 0)); return { base: cs[0], layers }; }
  const m = Math.min(n, 6);
  for (let k = 0; k < m; k++) layers.push(L(SWEEP, cs[k], 0.60 - 0.34 * (F[k] + F[k + 1]) / 2 * (n / m), -0.10, 0.17 * (F[k + 1] - F[k]) * (n / m) + 0.002, 0.5));
  if (n <= 6) for (let k = 0; k < n; k++) layers.push(L(BAND, cs[k], -0.34 + 0.68 * F[k], -0.34 + 0.68 * F[k + 1]));
  return { base: '15161a', layers };
}
const prideCount = {}, sponsorTeams = new Set(['DONUT DISTRICT', 'MAISON VERO']), everyName = new Set();
let tailIx = 0;

function rngOf(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---- putting a sticker on paint --------------------------------------------------------------------
function placer(key) {
  const { F, side, top } = rasters(key);
  const taken = { side: [], top: [] };
  const cover = (view, cx, cy, hw, hh) => {
    const R = view === 'side' ? side : top;
    const X = v => (view === 'side' ? (v + 1) / 2 * MW : (v + 1) / 2 * MH), Y = v => (view === 'side' ? (1 - v) * MH : (1 - (v + 1) / 2) * MW);
    const x0 = Math.floor(X(cx - hw)), x1 = Math.ceil(X(cx + hw)), y0 = Math.floor(Y(cy + hh)), y1 = Math.ceil(Y(cy - hh));
    let n = 0, on = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (x >= 0 && y >= 0 && x < R.w && y < R.h && R.v[y * R.w + x] === 2) on++; }
    return n ? on / n : 0;
  };
  const depth = (view, cx, cy) => {
    const R = view === 'side' ? side : top;
    const x = Math.round(view === 'side' ? (cx + 1) / 2 * MW : (cx + 1) / 2 * MH), y = Math.round(view === 'side' ? (1 - cy) * MH : (1 - (cy + 1) / 2) * MW);
    const d = R.d[clamp(y, 0, R.h - 1) * R.w + clamp(x, 0, R.w - 1)];
    return d < -1e8 ? (view === 'side' ? 1 : 0.7) : d;
  };
  // metres -> the livery's units, on each plane
  const size = (view, wm, hm) => (view === 'side' ? [wm / 2 / F.hl, hm / 2 / F.h] : [wm / 2 / F.hw, hm / 2 / F.hl]);
  // the best place for a (wm x hm) sticker inside `zone`, nearest to where it would like to be
  function fit(view, zone, wm, hm, { want = null, over = false, min = 0.9 } = {}) {
    for (let shrink = 0; shrink < 5; shrink++) {
      const k = 0.86 ** shrink, [hw, hh] = size(view, wm * k, hm * k);
      const [a0, a1, b0, b1] = zone;
      if (a1 - a0 < 2 * hw || b1 - b0 < 2 * hh) continue;
      const wx = want ? want[0] : (a0 + a1) / 2, wy = want ? want[1] : (b0 + b1) / 2;
      let best = null;
      for (let cx = a0 + hw; cx <= a1 - hw + 1e-9; cx += 0.015) for (let cy = b0 + hh; cy <= b1 - hh + 1e-9; cy += 0.015) {
        if (!over && taken[view].some(t => Math.abs(t[0] - cx) < t[2] + hw && Math.abs(t[1] - cy) < t[3] + hh)) continue;
        if (cover(view, cx, cy, hw, hh) < min) continue;
        const dist = Math.hypot((cx - wx) * (view === 'side' ? 1 : 1), (cy - wy) * 1.6);
        if (!best || dist < best.dist) best = { cx, cy, hw, hh, dist };
      }
      if (best) { if (!over) taken[view].push([best.cx, best.cy, best.hw, best.hh]); return best; }
    }
    return null;
  }
  // the point of the car under a placed sticker, for asking what colour it is
  const under = (view, r) => (view === 'side' ? [r.cx, r.cy, Math.max(0.7, depth('side', r.cx, r.cy))] : [r.cy, depth('top', r.cx, r.cy), r.cx]);
  return { F, fit, size, under, taken };
}

const uv = name => { const c = atlas.cells[name]; if (!c) throw new Error('no sticker called ' + name); return [c.x / atlas.size[0], c.y / atlas.size[1], c.w / atlas.size[0], c.h / atlas.size[1]]; };
const isBadge = n => SPONSORS.find(s => s.n === n)?.lay === 'badge';

// low cars with little flank: two-digit numbers, a smaller number panel, a longer title
const SMALL = new Set(['a480', 'f122', 'f499', 'p9x8']);
function build(key, carIx) {
  const Z = ZONES[key], P = PADDOCK[key];
  if (!Z || !P) throw new Error(`bake: no zones or paddock for ${key} — add them at the top of tools/livery/bake.mjs`);
  const out = [], names = new Set(), numbers = new Set(), pairs = new Set();
  let written = 0;
  // eighty invented teams, and after them (written out first) any real ones this car has: teams.mjs REAL
  const reals = REAL[key] || [];
  for (let i = 0; i < 80 + reals.length; i++) {
    const real = i >= 80 ? reals[i - 80] : null;
    const r = rngOf(carIx * 7919 + i * 104729 + 17);
    const pick = a => a[Math.floor(r() * a.length)];
    // ---- paint: a design, and a colourway whose graphic can be seen on its body
    const design = DNAMES[(i + carIx * 8) % DNAMES.length];
    let w = (i * 37 + carIx * 19 + 5) % WAYS.length, guard = 0;
    while ((contrast(C[WAYS[w][1]], C[WAYS[w][2]]) < 1.7 || pairs.has(design + w)) && guard++ < WAYS.length) w = (w + 1) % WAYS.length;
    pairs.add(design + w);
    const [way, a, b, c, d, fin = 0] = WAYS[w];
    // every eighth car flies a pride flag
    const flag = !real && i % 8 === 3 ? PRIDE[((i - 3) / 8 + carIx * 3) % PRIDE.length] : null;
    const liv = real ? { base: real.cols[0], layers: DESIGNS[real.design](...real.cols) } : flag ? prideLivery(flag, ((i - 3) / 8 + carIx) % 4) : { base: C[a], layers: DESIGNS[design](C[a], C[b], C[c], C[d]) };
    const finish = real ? real.fin : flag ? 0 : design === 'CAMO' ? 1 : fin;
    const tints = real ? [real.cols[2], real.cols[1]] : flag ? [] : [C[c], C[b], C[a]];
    // ---- the team
    const title = pick(SPONSORS);
    let name;
    // (the two-hats draw is still made, and thrown away: it keeps every later
    // draw — the number, the sponsors, where the stickers went — as it was, so
    // a car he has already seen keeps its number and its look under its new name)
    let bySponsor = false;
    if (!real) do {
      bySponsor = r() < 0.3;
      name = bySponsor ? `${title.n} ${pick(P.suf)}` : `${pick(P.pre)} ${pick(P.suf)}`;
    } while (names.has(name));
    if (!real) names.add(name);
    const cased = title.n.replace(/\b([A-Z])([A-Z']*)/g, (m, x, y) => x + y.toLowerCase());
    if (real) name = real.name;
    else if (flag) { const k = prideCount[flag.key] = (prideCount[flag.key] || 0) + 1; name = flag.teams[(k - 1) % flag.teams.length]; }
    else if (KEEP[`${key}:${i}`]) name = KEEP[`${key}:${i}`];
    else if (bySponsor && !sponsorTeams.has(title.n)) { sponsorTeams.add(title.n); name = `${cased} ${TAILS[tailIx++ % TAILS.length]}`; }
    else {
      do { name = NAMES[key][written++]; } while (name && Object.values(KEEP).includes(name));
      if (!name) throw new Error(`bake: ${key} has run out of written names — add some to tools/livery/teams.mjs`);
    }
    if (everyName.has(name)) throw new Error(`bake: two teams are called ${name}`);
    everyName.add(name);
    let num = real ? real.num : 0;
    if (!real) do { num = 1 + Math.floor(r() * (SMALL.has(key) ? 99 : 199)); } while (numbers.has(num));
    numbers.add(num);
    const others = [];
    const cats = [...new Set(SPONSORS.map(s => s.cat))].sort(() => r() - 0.5);
    for (const cat of cats) { const pool = SPONSORS.filter(s => s.cat === cat && s !== title && !others.includes(s)); if (pool.length) others.push(pick(pool)); }
    while (others.length < 12) { const s = pick(SPONSORS); if (s !== title && !others.includes(s)) others.push(s); }
    // how loud: clean (vinyl only, few) · works (neat rows) · bomb (plates everywhere) · retro (roundels, three names)
    const style = real ? 'clean' : ['works', 'bomb', 'works', 'clean', 'bomb', 'retro', 'works', 'bomb'][Math.floor(r() * 8)];

    // ---- stickers
    const PL = placer(key), S = [];
    const vinyl = (view, rect) => {
      const under = paintAt(liv, PL.under(view, rect));
      const cands = ['f4f3ee', '0e0f12', ...tints];
      let best = cands[0];
      for (const k of cands) if (contrast(k, under) > contrast(best, under) * (k === cands[0] || k === cands[1] ? 1 : 1.25)) best = k;
      return best;
    };
    const put = (cell, view, zone, wm, hm, o = {}) => {
      if (S.length >= 24) return null;
      const rect = PL.fit(view, zone, wm, hm, o);
      if (!rect) return null;
      const plane = view === 'top' ? (zone === Z.bonnet ? 4 : 3) : (o.plane ?? 0);      // a bonnet is read from in front, a roof from behind
      S.push({ cell, plane, rect: [+rect.cx.toFixed(4), +rect.cy.toFixed(4), +rect.hw.toFixed(4), +rect.hh.toFixed(4)], tint: o.tint === undefined ? null : (o.tint === 'auto' ? vinyl(view, rect) : o.tint) });
      return rect;
    };
    const sponsor = (s, view, zone, wm, o = {}) => {
      if (real) return null;      // a real team wears its number and its colours, and nobody's name
      const plate = o.plate ?? (style === 'bomb' || (style === 'works' && r() < 0.35));
      const hm = isBadge(s.n) ? wm * 0.52 : wm / 2.08;
      return put((plate ? 'plate:' : 'bare:') + s.n, view, zone, isBadge(s.n) ? hm : wm, hm, { ...o, tint: plate ? undefined : 'auto' });
    };
    // the number: a panel and its digits, which go ON the panel
    const digits = String(num), hand = r() < 0.5 ? 'A' : 'B';
    const panel = style === 'retro' ? 'round' : pick(['square', 'round', 'slant', 'hex', 'none', 'square']);
    const number = (view, zone, sz, want) => {
      const tp = zone === Z.bonnet ? 4 : 3, flip = zone === Z.bonnet ? -1 : 1;
      const under0 = PL.fit(view, zone, sz, sz, { want, over: true, min: 0.92 });
      if (!under0) return;
      PL.taken[view].push([under0.cx, under0.cy, under0.hw, under0.hh]);
      const here = paintAt(liv, PL.under(view, under0));
      let ink = '0e0f12', plateCol = 'f4f3ee';
      if (panel !== 'none') {
        if (contrast(plateCol, here) < 1.6) plateCol = '0e0f12';
        if (plateCol === '0e0f12') ink = 'f4f3ee';
        S.push({ cell: 'panel:' + panel, plane: view === 'top' ? tp : 0, rect: [under0.cx, under0.cy, under0.hw, under0.hh].map(v => +v.toFixed(4)), tint: plateCol });
      } else ink = contrast('f4f3ee', here) > contrast('0e0f12', here) ? 'f4f3ee' : '0e0f12';
      const n = digits.length, dh = under0.hh * (panel === 'none' ? 0.95 : n > 2 ? 0.56 : 0.70), aspect = under0.hw / under0.hh;
      const dw = dh * aspect, adv = dw * (hand === 'A' ? 0.92 : 1.12);
      // A number is several stickers in a ROW, and a row does not mirror itself:
      // on the left flank the car's nose is to your left, so the digits go on
      // again there in the other order (the first sheet read 192 as 291).
      for (const [plane, dir] of view === 'top' ? [[tp, flip]] : n === 1 ? [[0, 1]] : [[1, 1], [2, -1]]) for (let k = 0; k < n; k++) {
        const cx = under0.cx + (k - (n - 1) / 2) * adv * dir;
        S.push({ cell: `digit${hand}:${digits[k]}`, plane, rect: [cx, under0.cy, dw, dh].map(v => +v.toFixed(4)), tint: ink });
      }
    };
    const doorMidX = (Z.door[0] + Z.door[1]) / 2;
    number('side', Z.door, SMALL.has(key) ? 0.40 : 0.50, [Z.door[0] + 0.12, (Z.door[2] + Z.door[3]) / 2]);
    number('top', Z.bonnet, 0.44, null);
    if (style !== 'clean') number('top', Z.roof, 0.46, null);
    // the title sponsor: big, on the door and the bonnet (and the quarter when there is room)
    sponsor(title, 'side', Z.door, SMALL.has(key) ? 1.25 : 1.05, { want: [doorMidX + 0.14, (Z.door[2] + Z.door[3]) / 2 + 0.03], plate: style === 'bomb' && r() < 0.5 });
    sponsor(title, 'top', Z.bonnet, 0.80, { plate: false });
    if (style !== 'clean') sponsor(title, 'side', Z.quarter, 0.62, { plate: false });
    // the others
    const n2 = style === 'clean' ? 2 : style === 'retro' ? 3 : style === 'works' ? 6 : 10;
    const spots = [['side', Z.fender, 0.40], ['side', Z.quarter, 0.42], ['side', Z.sill, 0.34], ['side', Z.sill, 0.34], ['top', Z.roof, 0.46], ['side', Z.sill, 0.34], ['top', Z.deck, 0.40],
      ['side', Z.door, 0.30], ['side', Z.fender, 0.26], ['side', Z.door, 0.28], ['side', Z.quarter, 0.28], ['top', Z.bonnet, 0.30], ['side', Z.door, 0.26]];
    for (let k = 0; k < n2 && k < others.length; k++) { const [view, zone, wm] = spots[k % spots.length]; sponsor(others[k], view, zone, wm, k >= 7 ? { plate: true } : {}); }
    if (!real) put('class:' + P.klass, 'side', [Z.door[0] - 0.1, Z.door[1] + 0.1, Z.sill[2], Z.door[3]], 0.30, 0.15, { want: [Z.door[1], Z.door[3]] });
    if (style !== 'clean') { put('safety:ext', 'side', [Z.door[0], Z.door[1] + 0.2, Z.door[2], Z.door[3] + 0.1], 0.11, 0.11, { want: [Z.door[1] + 0.1, Z.door[3]] }); put('safety:cut', 'side', [Z.door[0], Z.door[1] + 0.2, Z.door[2], Z.door[3] + 0.1], 0.11, 0.11, { want: [Z.door[1] + 0.1, Z.door[3] - 0.1] }); }

    // the wheels: as they came, or in black, white, gold, bronze or one of the team's own colours
    const rim = r() < 0.3 ? null : pick(['15161a', '15161a', 'f4f3ee', 'c9a13b', '8a5a2b', C[c], C[b], C[c]]);
    out.push({
      name, num, design: real ? real.design : flag ? 'PRIDE' : design, way: real ? real.team : flag ? flag.label : way, style, rim: real ? real.rim : flag ? pick([null, 'f4f3ee', '15161a']) : rim, title: real ? real.team : title.n, sponsors: real ? [] : others.slice(0, n2).map(s => s.n), finish,
      base: liv.base, chips: real ? real.cols.slice(0, 3) : flag ? [flag.cols[0], flag.cols[Math.floor(flag.cols.length / 2)] || flag.ring, flag.cols[flag.cols.length - 1] === flag.cols[0] ? (flag.ring || flag.cols[1]) : flag.cols[flag.cols.length - 1]] : [C[a], C[b], C[c]], layers: liv.layers.slice(0, 12),
      stickers: S.slice(0, 24).map(s => ({ uv: uv(s.cell).map(v => +v.toFixed(5)), plane: s.plane, rect: s.rect, tint: s.tint })),
    });
  }
  return [...out.slice(80), ...out.slice(0, 80)];
}

const index = JSON.parse(fs.readFileSync(ROOT + 'data/cars/index.json', 'utf8'));
const want = process.argv.slice(2);
const cars = want.length ? want : Object.keys(ZONES).filter(k => index.some(c => c.key === k));
for (const key of cars) {
  const liv = build(key, Object.keys(ZONES).indexOf(key));
  fs.writeFileSync(`${ROOT}data/livery/${key}.json`, JSON.stringify(liv));
  const stk = liv.reduce((s, l) => s + l.stickers.length, 0), styles = {};
  for (const l of liv) styles[l.style] = (styles[l.style] || 0) + 1;
  console.log(`${key}: ${liv.length} teams, ${(stk / liv.length).toFixed(1)} stickers a car (fewest ${Math.min(...liv.map(l => l.stickers.length))}), ${new Set(liv.map(l => l.design)).size} designs, ${JSON.stringify(styles)}  e.g. #${liv[0].num} ${liv[0].name} — ${liv[0].design} / ${liv[0].way}`);
}
