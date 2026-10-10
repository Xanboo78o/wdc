// bake.mjs — the liveries: eighty teams for every downloaded car.
//
//   node tools/livery/bake.mjs            (always every car: it takes no arguments)
//
// SECOND EDITION, 2026-10-10. Adam, of the first 1,062: "these liveries all
// looks similar, the decals are placed weird, and the spsonsors dont look
// right, look up 5 images of each car with sponsors and take inspiration then
// change the colors up and gimme some uique and bomb ones, neon green, full
// black likeee, also use real livery patterns, anddd use those sposors from
// the sponsor sticker sheet".
//
// So three things changed, each from photographs of real cars (a hundred or so,
// GT3, GT4, Le Mans prototypes and grand prix cars, read for what the paint
// does and where the stickers go):
//
//   PAINT     the patterns are real ones: the works tri-stripe, the diagonal
//             split, the dark lower third that rises to swallow the tail, tartan,
//             shards, the flank chevron, the beltline band, neon ribbons on a dark
//             car, a car that is ONE colour but for its wing, and the old ones.
//             Not every car has a dark sill and a stripe down the middle any more.
//   COLOUR    thirty more colourways, loud at both ends: acid green, fluorescent
//             yellow, hot pink, and black cars that are black all over.
//   STICKERS  off Adam's own sponsor sheet (tools/livery/bakesheet.mjs), and put
//             on the way a real team does: the number panel where that kind of car
//             carries it, ONE big title sponsor beside it and again on the bonnet,
//             one medium name on the rear quarter, and the small ones in a ROW of
//             one height along the sill and a stack on the front wing. A row is
//             all cut vinyl in one colour, or all on their own boards — never a
//             mixture — and nothing floats in the middle of a panel.
//
// WHO THE TEAMS ARE. A team is NAMED FOR ITS LIVERY: the sponsor across its
// doors, and what kind of outfit it is — Red Bull Racing, Voltra Endurance,
// Box Box Grand Prix. (Adam, 2026-10-10, of a paddock of invented surnames and
// place names: "no these team names suck ass, make them the names of their
// liveriessssss".) So no two cars of one model share a title sponsor. The seats
// that keep a written name: the ten pride teams in every paddock and the grand
// prix grid (tools/livery/teams.mjs), and the four liveries Adam picked out.
// tools/livery/roster.json holds every seat's number and which seats those are. The four liveries Adam picked out by name
// are kept exactly as they were (tools/livery/keep.json).
//
// A livery is still: a base colour, up to twelve layers of shape for
// data/livery/livery.glsl, and up to twenty-four stickers placed by MEASURING
// the car (tools/livery/carmask.mjs): a sticker goes only where it lands on paint.
// Deterministic: the same liveries every run. Writes data/livery/<car>.json.
import fs from 'fs';
import { SPONSORS } from './sponsors.mjs';
import { rasters, MW, MH } from './carmask.mjs';
import { PRIDE, REAL } from './teams.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const atlas = JSON.parse(fs.readFileSync(ROOT + 'data/livery/atlas.json', 'utf8'));
if (!atlas.brands) { console.error('bake: the sticker sheet has no sponsors on it yet — node tools/livery/bakesheet.mjs'); process.exit(1); }
const roster = JSON.parse(fs.readFileSync(ROOT + 'tools/livery/roster.json', 'utf8'));
const KEEPS = JSON.parse(fs.readFileSync(ROOT + 'tools/livery/keep.json', 'utf8'));
if (process.argv.length > 2) { console.error('bake: it takes no arguments — it always bakes every car'); process.exit(2); }

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

// 2026-10-10: louder
Object.assign(C, { neon: '39ff14', fluo: 'd7ff1e', hotpink: 'ff2d95', electric: '00e5ff', lava: 'ff3b1f', ice: 'd8f3ff', jet: '0b0b0d', graphite: '2b2d33', chalk: 'fafafa',
  gulf: '8fd3ea', gulfo: 'f36c21', british: '004225', bordeaux: '5c0f24', turq: '00d7b6', mclo: 'ff8000', peach: 'ffb38a', lavender: 'b9a4ff', denim: '3b5b92', titan: '8d9196' });
WAYS.push(['Acid', 'neon', 'jet', 'chalk', 'jet'], ['Blackout', 'jet', 'graphite', 'neon', 'jet', 1], ['Blackout Red', 'jet', 'graphite', 'lava', 'jet', 1], ['Blackout Gold', 'jet', 'graphite', 'gold', 'jet'],
  ['Blackout Pink', 'jet', 'graphite', 'hotpink', 'jet', 1], ['Blackout Ice', 'jet', 'graphite', 'electric', 'jet', 1], ['Fluoro', 'fluo', 'jet', 'hotpink', 'jet'], ['Hot Pink', 'hotpink', 'jet', 'chalk', 'jet'],
  ['Electric', 'electric', 'jet', 'hotpink', 'navy'], ['Safety Orange', 'lava', 'jet', 'chalk', 'jet'], ['Gulf', 'gulf', 'gulfo', 'navy', 'navy'], ['British', 'british', 'yellow', 'chalk', 'jet', 2],
  ['Bordeaux', 'bordeaux', 'gold', 'cream', 'jet', 2], ['Whiteout', 'chalk', 'silver', 'lava', 'graphite'], ['Whiteout Neon', 'chalk', 'neon', 'jet', 'jet'], ['Martini', 'chalk', 'navy', 'sky', 'red'],
  ['Tricolore', 'chalk', 'blue', 'red', 'navy'], ['M Sport', 'chalk', 'sky', 'navy', 'red'], ['Turquoise', 'jet', 'turq', 'silver', 'jet'], ['Papaya Sky', 'mclo', 'jet', 'cyan', 'jet'],
  ['Titanium', 'titan', 'jet', 'lava', 'jet', 2], ['Chrome Neon', 'silver', 'neon', 'jet', 'jet', 3], ['Lavender Haze', 'lavender', 'jet', 'chalk', 'navy', 4], ['Peach Fuzz', 'peach', 'navy', 'chalk', 'navy'],
  ['Denim', 'denim', 'chalk', 'orange', 'navy', 1], ['Neon Noir', 'jet', 'neon', 'hotpink', 'jet', 1], ['Vapor', 'lavender', 'electric', 'hotpink', 'navy', 4], ['Bumblebee', 'yellow', 'jet', 'chalk', 'jet'],
  ['Graphite Lime', 'graphite', 'neon', 'chalk', 'jet', 1], ['Ice', 'ice', 'navy', 'electric', 'navy', 4], ['Acid Pink', 'neon', 'hotpink', 'jet', 'jet'], ['Fluoro Navy', 'fluo', 'navy', 'chalk', 'navy'],
  ['Black Chrome', 'jet', 'silver', 'chalk', 'jet', 3], ['Lava Flow', 'jet', 'lava', 'amber', 'jet', 1]);

// ---- the designs ---------------------------------------------------------------------------
const STRIPE = 1, SKIRT = 2, CUT = 3, SWEEP = 4, SLASH = 5, CAP = 6, ROOF = 7, HOOP = 8, FADE = 9, ARROW = 10, DOTS = 11, CAMO = 12, ROUNDEL = 13, CHECK = 14,
  ZEBRA = 15, TEETH = 16, WAVE = 17, BURST = 18, PIXEL = 19, DRIP = 20, BAND = 21, SASH = 22, VEE = 23, SHARDS = 24, PLAID = 25, BRUSH = 26, BOX = 27, SPEED = 28, PINS = 29;
const L = (t, c, q0 = 0, q1 = 0, q2 = 0, q3 = 0, s = 0) => ({ t, c, q: [q0, q1, q2, q3], s });
const ALL = c => L(CAP, c, -9, 1);                    // the whole car (used with a side: one flank only)
// the first edition's (a design is given body, graphic, accent, dark and returns its layers)
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
      case 22: m = step(Math.abs(p[0] * q[0] + p[1] * q[1] - q[2]), q[3]); break;
      case 23: { const d = (q[0] - p[0]) - Math.abs(p[1] - q[1]) * q[2]; m = step(0, d) * step(d, q[3]) * step(0.4, az); break; }
      case 24: { const gx = p[0] * q[0], gy = (p[1] + az * 0.6) * q[0] * 0.55; m = step(hash(Math.floor(gx) * 2 + step(1, fract(gx) + fract(gy)) + q[1], Math.floor(gy) * 2 + step(1, fract(gx) + fract(gy)) + q[1]), clamp((q[2] - p[0] * q[3]) * 0.8, 0, 1)); break; }
      case 25: { const a = step(fract(p[0] * q[0]), q[2]), b = step(fract((p[1] + az * 0.6) * q[1]), q[2]); m = q[3] > 0.5 ? a * b : Math.max(a, b); break; }
      case 26: m = step(Math.abs(p[1] - (q[0] + q[1] * p[0]) + (noise(p[0] * 5, q[3]) - 0.5) * q[2]), q[2] * (0.35 + 0.9 * noise(p[0] * 11, q[3] * 3.1))) * step(0.4, az); break;
      case 27: m = step(q[0], p[0] * q[2]) * step(q[1], p[1] * q[3]); break;
      case 28: m = step(fract(p[0] * q[0] + p[1] * q[1]), clamp((q[2] - p[0]) * q[3], 0, 1)) * step(p[0], q[2]); break;
      case 29: m = step(q[0], p[1]) * step(p[1], q[1]) * step(fract((p[1] - q[0]) / (q[1] - q[0]) * q[2]), q[3]) * step(0.4, az); break;
    }
    if (m) c = l.c;
  }
  return c;
}
const lum = h => { const f = i => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// the second edition's, each from a car in a photograph. A design may also return { base, fin, layers }
// when the pattern, not the colourway, decides what the body is (a black car with neon parts).
const K = '15161a', WHITE = 'f4f3ee';
const WING = c => L(BOX, c, 0.80, 0.70, -1, 1), LIP = c => L(BOX, c, 0.84, -0.20, 1, -1);      // the rear wing; the splitter
const brightest = (...cs) => cs.reduce((m, c) => (lum(c) > lum(m) ? c : m));
const loudest = (...cs) => cs.reduce((m, c) => (sat(c) > sat(m) ? c : m));
const sat = h => { const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return Math.max(...v) - Math.min(...v); };
const REALS = {
  // one colour all over, and the wing and splitter in another (Manthey's yellow-green 911; a works car before the stickers go on)
  'ONE COLOUR': (a, b) => [WING(b), LIP(b), L(SKIRT, K, 0.11, 0)],
  // black all over; only the wing, the splitter and one line along the sill are lit (Toyota's GR010; every "stealth" launch car)
  'STEALTH': (a, b, c) => ({ base: '0c0c0e', fin: 1, layers: [WING(loudest(a, b, c)), LIP(loudest(a, b, c)), L(SWEEP, loudest(a, b, c), 0.15, 0, 0.012, 0.4)] }),
  'STEALTH PINS': (a, b, c) => ({ base: '0c0c0e', fin: 1, layers: [L(PINS, loudest(a, b, c), 0.30, 0.52, 3, 0.10), L(STRIPE, loudest(a, b, c), 0.008, 0.22)] }),
  // the dark lower third that climbs to swallow the whole tail (Kenda's M4, JMF's AMG, Rowe)
  'RISER': (a, b, c, d, r) => { const h = 0.36 + r() * 0.08, k = -(0.18 + r() * 0.14); return [L(SKIRT, b, h, k), L(SWEEP, c, h + 0.035, k, 0.014, 0.4)]; },
  // nose one colour, tail another, cut on the slant with a pinstripe on the cut (Cameron's M4, Alfa's C43)
  'DIAGONAL': (a, b, c, d, r) => { const s = 0.7 + r() * 0.5, o = 0.05 + r() * 0.3; return [L(CUT, b, o, s, -1, 0), L(SASH, c, 1, -s, -o + 0.05, 0.018)]; },
  // three bands side by side up the door at a slant (BMW's works stripes)
  'TRI STRIPE': (a, b, c, d) => [L(SASH, b, 1, -0.85, -0.42, 0.055), L(SASH, c, 1, -0.85, -0.31, 0.055), L(SASH, d, 1, -0.85, -0.20, 0.055)],
  // tartan (Pfaff's plaid Porsche)
  'PLAID': (a, b, c, d) => [L(PLAID, b, 4.5, 3.0, 0.36, 0), L(PLAID, d, 4.5, 3.0, 0.36, 1), L(PLAID, c, 9, 6, 0.07, 0)],
  // triangles breaking away from a solid tail (the low-poly wraps of every GT4 paddock)
  'SHARDS': (a, b, c, d) => [L(CAP, b, 0.80, -1), L(SHARDS, b, 7, 1.3, 0.15, 1), L(SHARDS, c, 7, 5.1, -0.25, 1), L(SHARDS, d, 5, 9.7, -0.5, 1)],
  // long thin slivers all pointing forward (All County's green M4)
  'SLIVERS': (a, b, c) => [L(SPEED, b, 3, -9, 0.9, 0.7), L(SPEED, c, 3, -9, 0.3, 0.9)],
  // powder blue, an orange stripe over the top and an orange band along the bottom
  'GULF': (a, b, c) => [L(STRIPE, b, 0.10, 0), L(SKIRT, b, 0.24, 0), L(SWEEP, c, 0.262, 0, 0.012, 0.4)],
  // three thin lines along the waist and over the roof
  'MARTINI': (a, b, c, d) => [L(SWEEP, b, 0.52, -0.05, 0.028, 0.4), L(SWEEP, c, 0.465, -0.05, 0.028, 0.4), L(SWEEP, d, 0.41, -0.05, 0.028, 0.4), L(STRIPE, c, 0.035, 0), L(STRIPE, b, 0.03, 0.068)],
  // a dark car outlined in pinstripes
  'COACHLINE': (a, b) => [L(PINS, b, 0.18, 0.58, 2, 0.045), L(STRIPE, b, 0.008, 0.16), L(STRIPE, b, 0.008, 0.21), L(STRIPE, b, 0.008, 0.45)],
  // one colour above the waist and another below (Penske's 963, Haas)
  'TWO TONE': (a, b, c, d, r) => { const h = 0.46 + r() * 0.08; return [L(CUT, b, h, 1, -0.10, 0), L(SWEEP, c, h, 0.10, 0.012, 0.4)]; },
  // the front half one colour and the back half another, cut straight across (JOTA's gold and white 963, Alpine's blue and pink)
  'SPLIT': (a, b, c, d, r) => { const at = -0.1 + r() * 0.3; return [L(CAP, b, -at, -1), L(SASH, c, 1, 0, at + 0.03, 0.014)]; },
  // a chevron on the flank behind the door, and the wing to match (the 499P)
  'CHEVRON': (a, b, c) => [L(VEE, b, 0.30, 0.42, 1.5, 0.36), L(VEE, c, 0.39, 0.42, 1.5, 0.04), WING(b)],
  // the body dissolving into its dark tail through slanted bars (Alpine's A480)
  'SPEED FADE': (a, b) => [L(CAP, b, 0.40, -1), L(SPEED, b, 5, -3.2, 0.42, 1.5)],
  // two ragged brush strokes along the side
  'BRUSH': (a, b, c) => [L(BRUSH, b, 0.44, -0.04, 0.11, 3.1), L(BRUSH, c, 0.30, 0.02, 0.05, 8.7)],
  // a wide band along the waist that the title sponsor sits on, roof to match (Random Vandals' yellow M4)
  'BELT BAND': (a, b, c) => [L(SWEEP, b, 0.40, 0, 0.13, 0.4), L(SWEEP, c, 0.545, 0, 0.012, 0.4), L(ROOF, b, 0.86, 0.6)],
  // ribbons outlining the sill and the waist, a pinstripe beside each (the navy and pink Ginetta)
  'RIBBONS': (a, b, c) => [L(SWEEP, b, 0.16, 0, 0.035, 0.4), L(SWEEP, b, 0.62, 0.02, 0.03, 0.4), L(SWEEP, c, 0.215, 0, 0.008, 0.4), L(SWEEP, c, 0.665, 0.02, 0.008, 0.4)],
  // bonnet, roof and door tops in the loud colour over a dark side, the nose corners in a third (Ginetta #24)
  'TOP COAT': (a, b, c, d) => ({ base: d, layers: [L(CUT, a, 0.50, 1, 0, 0), L(CAP, c, 0.82, 1), L(SWEEP, c, 0.50, 0, 0.010, 0.4)] }),
  // claw marks torn through the tail, a lit line along the sill
  'CLAW': (a, b, c) => [L(SPEED, b, 6, -7, 0.10, 2.5), L(SWEEP, c, 0.14, 0, 0.012, 0.4)],
  // a ribbon that comes off the front wing, crosses the door and widens to fill the sill and the rear arch (NM Racing's AMG)
  'RIBBON WRAP': (a, b, c) => [L(SWEEP, b, 0.44, -0.22, 0.10, 0.4), L(SWEEP, c, 0.56, -0.22, 0.012, 0.4), L(SKIRT, b, 0.20, -0.25)],
  // a slanted flag bar at the B-pillar and the roof in the middle colour (Tuder's yellow Alpine)
  'FLAG BAR': (a, b, c, d) => [L(SASH, b, 1, -0.5, -0.42, 0.035), L(SASH, c, 1, -0.5, -0.35, 0.035), L(SASH, d, 1, -0.5, -0.28, 0.035), L(ROOF, c, 0.86, 0.6)],
  // three zones nose to tail (CMR's Alpine)
  'THREE ZONE': (a, b, c) => [L(CAP, c, 0.25, -1), L(CAP, b, 0.30, 1)],
  // three zones on the slant (the Isotta)
  'SLANT ZONES': (a, b, c) => [L(CUT, b, 0.15, -0.6, 1, 0), L(CUT, c, 0.45, 0.6, -1, 0)],
  // a dark car with only its nose and wing lit (Vanwall)
  'NOSE JOB': (a, b, c) => [L(CAP, c, 0.52, 1), L(SASH, b, 1, 0, 0.49, 0.015), WING(c)],
  // bare carbon, with the colour only as wedges: nose, shoulder, engine cover (McLaren since 2023)
  'WEDGES': (a, b, c) => ({ base: K, fin: 1, layers: [L(VEE, a, 0.62, 0.44, 1.1, 0.60), L(CAP, a, 0.74, 1), L(ROOF, a, 0.82, 0.5), WING(a), L(SWEEP, c, 0.14, 0, 0.010, 0.4)] }),
  // one bold band on the slant, a thin one beside it
  'SASH': (a, b, c, d, r) => { const at = -0.15 + r() * 0.3; return [L(SASH, b, 1, -1.1, at, 0.15), L(SASH, c, 1, -1.1, at + 0.19, 0.02)]; },
  // almost nothing: two fine lines at the waist (Aston Martin's green)
  'PINLINE': (a, b, c) => [L(SWEEP, b, 0.60, 0.02, 0.012, 0.4), L(SWEEP, c, 0.565, 0.02, 0.006, 0.4), L(SKIRT, K, 0.11, 0)],
  // one colour melting into another, nose to tail
  'GRADIENT': (a, b) => [L(FADE, b, -0.7, 0.7, 1)],
  // a white disc on each door for the number, a stripe over the top
  'ROUNDEL': (a, b, c) => [L(STRIPE, b, 0.06, 0), L(STRIPE, c, 0.012, 0.10), L(ROUNDEL, WHITE, -0.02, 0.44, 0.22, 1.8)],
  // the front three fifths black, the tail and the wing in the colour (United Autosports' 720S)
  'REAR BLOCK': (a, b, c) => ({ base: '0c0c0e', layers: [L(CUT, a, 0.22, 0.25, -1, 0), WING(a), L(SASH, c, 1, -0.25, -0.19, 0.012)] }),
  // a loud body, and everything above the waist black in a wedge that widens to the tail (SSR's lime Huracán)
  'GREENHOUSE': (a, b, c) => [L(CUT, K, 0.60, 1, -0.12, 0), L(SWEEP, c, 0.60, 0.12, 0.008, 0.4)],
  // a pale car with only its sill, its lip and its wing in a colour (Toksport's grey and pink 911)
  'CONTRAST SILL': (a, b, c) => [L(SKIRT, c, 0.17, 0), LIP(c), WING(c)],
  // carbon roof and bonnet centre, body in colour, lit sill and wing (half the GT4 grid)
  'CARBON TOP': (a, b, c) => [L(ROOF, K, 0.80, 2), L(STRIPE, K, 0.20, 0), L(SWEEP, c, 0.16, 0, 0.012, 0.4), WING(c)],
};
// the new ones are seen twice as often as the old
const DNAMES = [];
{ const olds = Object.keys(DESIGNS), news = Object.keys(REALS); Object.assign(DESIGNS, REALS);
  for (let i = 0; i < Math.max(olds.length, news.length * 2); i++) { DNAMES.push(news[i % news.length]); if (i % 2 === 0 && olds[i / 2]) DNAMES.push(olds[i / 2]); } }

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
  nsx: { door: [-0.36, 0.30, 0.20, 0.60], quarter: [-0.86, -0.42, 0.54, 0.76], fender: [0.36, 0.82, 0.48, 0.66], sill: [-0.36, 0.34, 0.10, 0.22], bonnet: [-0.50, 0.50, 0.55, 0.95], roof: [-0.38, 0.38, -0.10, 0.22], deck: [-0.6, 0.6, -0.96, -0.76] },
  p992r: { door: [-0.30, 0.30, 0.20, 0.60], quarter: [-0.82, -0.34, 0.55, 0.76], fender: [0.34, 0.86, 0.48, 0.64], sill: [-0.36, 0.36, 0.10, 0.24], bonnet: [-0.52, 0.52, 0.50, 0.90], roof: [-0.42, 0.42, -0.22, 0.16], deck: [-0.6, 0.6, -0.96, -0.74] },
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



// ---- who pays -------------------------------------------------------------------------------------
// A sponsor off Adam's sheet has three stickers (board, logo for light paint, logo for dark paint); the
// studio's own games keep the plate the first sheet drew for them.
const SHEET = atlas.brands.map(b => ({ ...b, sheet: true, board: 'board:' + b.id, inkL: atlas.cells['logo:' + b.id].ink, inkD: atlas.cells['logod:' + b.id].ink, fill: atlas.cells['logo:' + b.id].fill }));
const STUDIO = SPONSORS.filter(s => s.cat === 'studio' && atlas.cells['plate:' + s.n]).map(s => ({ id: s.n, name: s.n, sheet: false, board: 'plate:' + s.n, aspect: atlas.cells['plate:' + s.n].w / atlas.cells['plate:' + s.n].h }));
const sheet = id => { const b = SHEET.find(x => x.id === id); if (!b) throw new Error('bake: the sheet has no sponsor called ' + id); return b; };
const TYRE = sheet('pirelli');
// what kind of car it is decides where its number and its names go
const FORM = { p911: 'gt', m720: 'gt', g55: 'gt', a480: 'proto', m4: 'gt', p992: 'gt', hura: 'gt', f122: 'f1', m4g4: 'gt', amg4: 'gt', f499: 'proto', a110: 'gt', p9x8: 'proto', nsx: 'gt', p992r: 'gt' };
const KLASS = { p911: 'CUP', m720: 'GT3', g55: 'GT4', a480: 'HYPER', m4: 'GT3', p992: 'GT3', hura: 'GT3', m4g4: 'GT4', amg4: 'GT4', f499: 'HYPER', a110: 'GT4', p9x8: 'HYPER', nsx: 'GT3', p992r: 'GT3' };
const NUMBER_AFT = new Set(['g55', 'a110']);      // engine behind the driver: the number sits at the back of the door
// the actual grid's actual backers, as far as the sheet has them (teams.mjs REAL)
const BACKERS = {
  'McLaren': ['mastercard', 'google', 'okx', 'dell'], 'Scuderia Ferrari': ['hp', 'shell', 'unicredit', 'ibm', 'puma'], 'Red Bull Racing': ['oracle', 'red-bull', 'mobil1', 'tag-heuer', 'visa'],
  'Mercedes': ['petronas', 'snapdragon', 'adidas', 'microsoft'], 'Aston Martin': ['aramco', 'cognizant', 'valvoline', 'puma'], 'Alpine': ['bwt', 'microsoft'],
  'Williams': ['atlassian', 'santander', 'globant'], 'Racing Bulls': ['visa', 'cash-app', 'red-bull', 'hot-wheels'], 'Haas': ['moneygram', 'toyota-gazoo'],
  'Audi': ['audi', 'revolut', 'adidas'], 'Cadillac': ['cadillac', 'tommy-hilfiger'],
};

// what a team named for its sponsor is called, by the kind of racing it does
const OUTFIT = {
  CUP: ['Cup Team', 'Racing', 'Motorsport', 'Rennsport', 'Junior Team', 'Carrera Team'], GT3: ['Racing', 'Motorsport', 'GT Team', 'Racing Team', 'Squadra Corse', 'GT Racing', 'Performance', 'Autosport'],
  GT4: ['Racing', 'Motorsport', 'Junior Team', 'Racing Club', 'GT4 Team', 'Academy', 'Autosport'], HYPER: ['Endurance', 'Hypercar Team', 'Works', 'Factory Racing', 'Prototype Team', 'Racing'],
  F1: ['Grand Prix', 'F1 Team', 'Racing', 'Formula Team', 'GP'],
};
const cased = n => (/^[A-Z0-9]{1,3}$/.test(n) ? n : n.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' '));
const shortOf = s => (s.sheet ? s.short || s.name : cased(s.name));
const NOT_A_TITLE = new Set(['pirelli', 'f1', 'fia']);      // the tyre maker and the two governing bodies back everybody, and nobody in particular
const everyName = new Set(Object.values(roster).flat().filter(t => t.pride || t.real).map(t => t.name).concat(Object.values(KEEPS).map(k => k.name)));

const uv = name => { const c = atlas.cells[name]; if (!c) throw new Error('no sticker called ' + name); return [c.x / atlas.size[0], c.y / atlas.size[1], c.w / atlas.size[0], c.h / atlas.size[1]]; };
const INK = 'f4f3ee', BLACK = '0e0f12';

function build(key, carIx) {
  const Z = ZONES[key], form = FORM[key], who = roster[key];
  if (!Z || !form || !who) throw new Error(`bake: ${key} has no zones, no form or no teams — ZONES/FORM in tools/livery/bake.mjs, and its names in tools/livery/roster.json`);
  const reals = REAL[key] || [], out = [], pairs = new Set();
  // the title sponsors of this paddock, dealt out one a team: no two cars of one model wear the same name
  const deal = [...SHEET.filter(s => !NOT_A_TITLE.has(s.id)), ...STUDIO], rd = rngOf(carIx * 31337 + 99);
  for (let k = deal.length - 1; k > 0; k--) { const j = Math.floor(rd() * (k + 1)); [deal[k], deal[j]] = [deal[j], deal[k]]; }
  let dealt = 0;
  who.forEach((team, i) => {
    if (KEEPS[`${key}:${i}`]) { out.push(KEEPS[`${key}:${i}`]); return; }
    const r = rngOf(carIx * 7919 + i * 104729 + 2026);
    const pick = a => a[Math.floor(r() * a.length)];
    const real = team.real ? reals.find(x => x.name === team.name) : null;
    const flag = team.pride ? PRIDE.find(f => f.label === team.pride) : null;
    if (team.real && !real) throw new Error(`bake: ${team.name} is not in teams.mjs REAL`);

    // ---- paint
    let design = DNAMES[(i * 7 + carIx * 11 + 3) % DNAMES.length], w = (i * 37 + carIx * 19 + 5 + Math.floor(r() * WAYS.length)) % WAYS.length, guard = 0;
    while ((contrast(C[WAYS[w][1]], C[WAYS[w][2]]) < 2.1 || pairs.has(design + w)) && guard++ < WAYS.length) w = (w + 1) % WAYS.length;
    pairs.add(design + w);
    const [way, a, b, c, d, fin = 0] = WAYS[w];
    let liv, finish = fin, cols = [C[a], C[b], C[c]];
    if (real) { design = real.design; liv = { base: real.cols[0], layers: DESIGNS[real.design](...real.cols, r) }; finish = real.fin; cols = real.cols.slice(0, 3); }
    else if (flag) {
      design = 'PRIDE'; liv = prideLivery(flag, (who.slice(0, i).filter(t => t.pride).length + carIx) % 4); finish = 0;
      cols = [flag.cols[0], flag.cols[Math.floor(flag.cols.length / 2)] || flag.ring, flag.cols[flag.cols.length - 1] === flag.cols[0] ? (flag.ring || flag.cols[1]) : flag.cols[flag.cols.length - 1]];
    } else {
      const made = DESIGNS[design](C[a], C[b], C[c], C[d], r);
      liv = Array.isArray(made) ? { base: C[a], layers: made } : { base: made.base, layers: made.layers };
      if (!Array.isArray(made) && made.fin !== undefined) finish = made.fin;
      if (design === 'CAMO') finish = 1;
      // an old design's dark sill is no longer on every car, and some cars get the wing or the roof as a contrast part
      const last = liv.layers[liv.layers.length - 1];
      if (!REALS[design] && last && last.t === SKIRT && r() < 0.55) liv.layers.pop();
      const has = t => liv.layers.some(l => l.t === t);
      if (!has(BOX) && liv.layers.length < 10 && r() < 0.30) liv.layers.push(WING(r() < 0.5 ? C[c] : C[b]));
      if (form === 'gt' && !has(ROOF) && liv.layers.length < 10 && r() < 0.22) liv.layers.push(L(ROOF, K, 0.84, 0.6));
    }
    liv.layers = liv.layers.slice(0, 12);

    // ---- who pays for it
    const pool = SHEET.filter(s => s !== TYRE);
    const draw = kinds => pick(pool.filter(s => kinds.includes(s.kind)));
    let title, others = [];
    if (real) { const ids = BACKERS[real.team]; title = sheet(ids[0]); others = ids.slice(1).map(sheet); }
    else {
      title = flag ? pick(deal) : deal[dealt++ % deal.length];
      while (others.length < 9) { const s = r() < 0.6 ? draw(['real']) : r() < 0.6 ? draw(['fake']) : draw(['joke']); if (s !== title && !others.includes(s)) others.push(s); }
    }
    // how it wears them: cut vinyl in one colour · the logos' own colours · every small one on its board
    const style = real || flag ? 'vinyl' : ['vinyl', 'vinyl', 'colour', 'colour', 'boards'][Math.floor(r() * 5)];
    const busy = real ? 2 : [3, 4, 4, 5][Math.floor(r() * 4)];                   // how many in the sill row besides the tyre maker
    const big = style === 'boards' ? 'colour' : style;                          // the title sponsor is never a small board

    // ---- stickers
    const PL = placer(key), S = [];
    const at = (view, cx, cy) => paintAt(liv, PL.under(view, { cx, cy }));
    const mono = under => (contrast(INK, under) >= contrast(BLACK, under) ? INK : BLACK);
    // which of a sponsor's stickers suits the paint at a spot, and in what colour
    const dress = (s, under, how) => {
      if (!s.sheet || how === 'boards') return { cell: s.board, asp: s.aspect, tint: null };
      if (how === 'vinyl' && s.fill < 0.6) return { cell: 'logo:' + s.id, asp: s.laspect, tint: mono(under) };
      const cl = contrast(s.inkL, under), cd = contrast(s.inkD, under);
      if (Math.max(cl, cd) >= 2.3) return { cell: (cd > cl ? 'logod:' : 'logo:') + s.id, asp: s.laspect, tint: null };
      return { cell: s.board, asp: s.aspect, tint: null };
    };
    // a bonnet is read from in front of the car, a roof and a tail from behind it
    const plane = (view, zone, o) => (view === 'top' ? (zone === Z.bonnet || o.nose ? 4 : 3) : (o.plane ?? 0));
    const stick = (cell, view, zone, rect, tint, o = {}) => S.push({ cell, plane: plane(view, zone, o), rect: [rect.cx, rect.cy, rect.hw, rect.hh].map(v => +v.toFixed(4)), tint });
    // one sponsor, as big as (maxW x maxH) metres allows, as near `want` as the paint allows
    const one = (s, view, zone, maxW, maxH, want, how = style, o = {}) => {
      if (S.length >= 24 || !s || zone[1] - zone[0] <= 0 || zone[3] - zone[2] <= 0) return null;
      const w0 = want || [(zone[0] + zone[1]) / 2, (zone[2] + zone[3]) / 2];
      const D = dress(s, at(view, w0[0], w0[1]), how), wm = Math.min(maxW, maxH * D.asp);
      const rect = PL.fit(view, o.home || zone, wm, wm / D.asp, { want: w0, min: o.min ?? 0.88 });
      if (!rect) return null;
      stick(D.cell, view, zone, rect, D.tint, o);
      return rect;
    };
    // a ROW of small ones, all one height and (if vinyl) all one colour, centred in the zone
    const row = (list, view, zone, hm, gapm, how = style) => {
      const yc = (zone[2] + zone[3]) / 2, xc = (zone[0] + zone[1]) / 2, under = at(view, xc, yc), tint = mono(under);
      const items = list.map(s => { const D = dress(s, under, how === 'colour' ? 'vinyl' : how); return { D: D.tint ? { ...D, tint } : D, wm: hm * D.asp }; });
      const units = m => PL.size(view, m, hm)[0] * 2, total = () => units(items.reduce((t, it) => t + it.wm, 0) + gapm * (items.length - 1));
      while (items.length && total() > zone[1] - zone[0]) items.pop();
      let x = xc - total() / 2;
      for (const it of items) {
        const wu = units(it.wm), [hw, hh] = PL.size(view, it.wm, hm);
        const rect = S.length < 24 ? PL.fit(view, [x - 0.01, x + wu + 0.01, yc - hh - 0.012, yc + hh + 0.012], it.wm, hm, { want: [x + wu / 2, yc], min: 0.82 }) : null;
        if (rect && Math.abs(rect.hw - hw) < 1e-6) stick(it.D.cell, view, zone, rect, it.D.tint);
        x += wu + units(gapm);
      }
    };
    // a STACK of small ones, one above the next (the front wing)
    const stack = (list, view, zone, hm, how = style) => {
      const xc = (zone[0] + zone[1]) / 2, [, hh] = PL.size(view, hm, hm), stepY = hh * 2 * 1.35;
      let y = (zone[2] + zone[3]) / 2 + stepY * (list.length - 1) / 2;
      const under = at(view, xc, (zone[2] + zone[3]) / 2), tint = mono(under);
      for (const s of list) {
        if (S.length >= 24) break;
        const D = dress(s, under, how === 'colour' ? 'vinyl' : how), wm = Math.min(hm * D.asp, 0.30);
        const rect = PL.fit(view, [zone[0], zone[1], y - hh - 0.01, y + hh + 0.01], wm, wm / D.asp, { want: [xc, y], min: 0.85 });
        if (rect) stick(D.cell, view, zone, rect, D.tint ? tint : null);
        y -= stepY;
      }
    };
    // the number: a panel and its digits, or bare digits
    const digits = String(team.num), hand = r() < 0.5 ? 'A' : 'B';
    const number = (view, zone, sz, want, panel) => {
      const tp = plane(view, zone, {}), flip = zone === Z.bonnet ? -1 : 1, n = digits.length;
      if (S.length + n * (view === 'top' || n === 1 ? 1 : 2) + (panel === 'none' ? 0 : 1) > 24) return null;
      const under0 = PL.fit(view, zone, sz, sz, { want, over: true, min: 0.90 });
      if (!under0) return null;
      PL.taken[view].push([under0.cx, under0.cy, under0.hw, under0.hh]);
      const here = paintAt(liv, PL.under(view, under0));
      let ink = BLACK, plateCol = INK;
      if (panel !== 'none') {
        if (contrast(plateCol, here) < 2.4) plateCol = BLACK;
        if (plateCol === BLACK) ink = INK;
        S.push({ cell: 'panel:' + panel, plane: tp, rect: [under0.cx, under0.cy, under0.hw, under0.hh].map(v => +v.toFixed(4)), tint: plateCol });
      } else ink = mono(here);
      const dh = under0.hh * (panel === 'none' ? 0.95 : n > 2 ? 0.56 : 0.70), dw = dh * under0.hw / under0.hh, adv = dw * (hand === 'A' ? 0.92 : 1.12);
      // a number is several stickers in a ROW and a row does not mirror itself: on the left flank the digits go on in the other order
      for (const [pl, dir] of view === 'top' ? [[tp, flip]] : n === 1 ? [[0, 1]] : [[1, 1], [2, -1]]) for (let k = 0; k < n; k++)
        S.push({ cell: `digit${hand}:${digits[k]}`, plane: pl, rect: [under0.cx + (k - (n - 1) / 2) * adv * dir, under0.cy, dw, dh].map(v => +v.toFixed(4)), tint: ink });
      return under0;
    };
    const mid = z => [(z[0] + z[1]) / 2, (z[2] + z[3]) / 2];
    const small = others.slice(2, 2 + busy);
    if (form === 'gt') {
      // door: the number panel hard up against the front arch (or the rear one, engine behind), the title sponsor filling the rest
      const panel = flag ? 'square' : pick(['square', 'square', 'square', 'slant', 'round', 'hex']);
      const aft = NUMBER_AFT.has(key), dy = Z.door[2] + (Z.door[3] - Z.door[2]) * 0.56;
      const num = number('side', Z.door, 0.46, [aft ? Z.door[0] + 0.10 : Z.door[1] - 0.10, dy], panel);
      const rest = num ? (aft ? [num.cx + num.hw + 0.03, Z.door[1] + 0.06, Z.door[2], Z.door[3]] : [Z.door[0] - 0.06, num.cx - num.hw - 0.03, Z.door[2], Z.door[3]]) : Z.door;
      one(title, 'side', rest, 1.05, 0.24, [mid(rest)[0], num ? num.cy : dy], big, { min: 0.96 }) || one(title, 'side', rest, 0.8, 0.2, [mid(rest)[0], num ? num.cy : dy], big);
      if (num && S.length < 24) { const r2 = PL.fit('side', [num.cx - num.hw - 0.02, num.cx + num.hw + 0.02, Z.sill[3], num.cy - num.hh], 0.30, 0.15, { want: [num.cx, num.cy - num.hh - 0.05], min: 0.8 }); if (r2) stick('class:' + KLASS[key], 'side', Z.door, r2, null); }
      // bonnet: the number toward the nose, the title sponsor across behind it
      const bn = number('top', Z.bonnet, 0.36, [0, Z.bonnet[2] + (Z.bonnet[3] - Z.bonnet[2]) * 0.72], panel);
      one(title, 'top', [Z.bonnet[0], Z.bonnet[1], Z.bonnet[2], bn ? bn.cy - bn.hh - 0.01 : Z.bonnet[3]], 0.95, 0.26, null, big, { nose: true });
      // the small ones: a row along the sill (the tyre maker first), one medium name on the rear quarter, a stack on the front wing
      row([TYRE, ...small], 'side', Z.sill, 0.075, 0.07);
      one(others[0], 'side', Z.quarter, 0.55, 0.15, null);
      stack(others.slice(7, 9), 'side', Z.fender, 0.062);
      // the roof: the number again, for the cameras overhead; the tail: the title sponsor once more
      if (!number('top', Z.roof, 0.42, null, panel)) one(others[1], 'top', Z.roof, 0.6, 0.18, null);
      one(title, 'top', Z.deck, 0.6, 0.14, null, 'vinyl');
    } else if (form === 'proto') {
      // the number square low behind the front wheel with the class box beside it; ONE big name on the flank ahead of the rear wheel
      const num = number('side', Z.door, 0.34, [Z.door[1] - 0.07, Z.door[2] + (Z.door[3] - Z.door[2]) * 0.40], 'square');
      if (num && S.length < 24) { const r2 = PL.fit('side', [Z.door[0], num.cx - num.hw - 0.005, num.cy - num.hh, num.cy + num.hh], 0.30, 0.15, { want: [num.cx - num.hw - 0.07, num.cy], min: 0.8 }); if (r2) stick('class:' + KLASS[key], 'side', Z.door, r2, null); }
      one(title, 'side', Z.quarter, 1.25, 0.26, null, big) || one(title, 'side', Z.door, 1.0, 0.2, null, big);
      one(others[0], 'side', [Z.door[0], num ? num.cx - num.hw - 0.18 : Z.door[1], Z.door[2], Z.door[3]], 0.7, 0.15, null);
      const bn = number('top', Z.bonnet, 0.30, [0, Z.bonnet[2] + (Z.bonnet[3] - Z.bonnet[2]) * 0.7], 'square');
      one(title, 'top', [Z.bonnet[0], Z.bonnet[1], Z.bonnet[2], bn ? bn.cy - bn.hh - 0.01 : Z.bonnet[3]], 0.55, 0.16, null, 'vinyl', { nose: true });
      row([TYRE, ...small.slice(0, 3)], 'side', Z.sill, 0.065, 0.07);
      stack(others.slice(7, 9), 'side', Z.fender, 0.055);
      one(others[1], 'top', Z.deck, 0.5, 0.16, null, 'vinyl');
      one(title, 'top', Z.roof, 0.5, 0.14, null, 'vinyl');
    } else {
      // a grand prix car: bare numbers, small, on the nose and the engine cover; the title sponsor along the sidepod and across the rear wing
      one(title, 'side', Z.door, 1.35, 0.24, null, big);
      const qn = number('side', Z.quarter, 0.26, [Z.quarter[1] - 0.10, Z.quarter[3] - 0.10], 'none');
      one(others[0], 'side', [Z.quarter[0], qn ? qn.cx - qn.hw - 0.02 : Z.quarter[1], Z.quarter[2], Z.quarter[3]], 0.9, 0.18, null);
      const nn = number('top', Z.bonnet, 0.22, [0, Z.bonnet[3] - 0.10], 'none');
      // the ladder of small names down the top of the nose
      let lx = (nn ? nn.cy - nn.hh : Z.bonnet[3]) - 0.07;
      for (const s of others.slice(1, 4)) { if (!one(s, 'top', [Z.bonnet[0], Z.bonnet[1], lx - 0.07, lx + 0.07], 0.26, 0.09, [0, lx], 'vinyl', { min: 0.8, nose: true })) break; lx -= 0.11; }
      one(title, 'top', Z.deck, 0.85, 0.16, null, 'vinyl');
      one(others[4] || others[1], 'top', Z.roof, 0.42, 0.13, null, 'vinyl');
      one(others[1], 'side', Z.fender, 0.5, 0.11, null);
      row((real ? others.slice(2, 4) : small.slice(0, 2)).concat(TYRE), 'side', Z.sill, 0.07, 0.08);
    }

    // ---- what it is called: its sponsor, and what kind of outfit it is
    let name = team.name;
    if (!real && !flag) {
      const base = shortOf(title), kinds = OUTFIT[KLASS[key] || 'F1'], k0 = Math.floor(r() * kinds.length);
      name = null;
      for (let k = 0; k < kinds.length && !name; k++) { const sfx = kinds[(k0 + k) % kinds.length], n = /Racing$/.test(base) && /^Racing/.test(sfx) ? base : `${base} ${sfx}`; if (!everyName.has(n)) name = n; }
      if (!name) name = `Team ${base} ${KLASS[key] || 'F1'}`;
      if (everyName.has(name)) throw new Error(`bake: two teams are called ${name}`);
      everyName.add(name);
    }
    const rim = real ? real.rim : flag ? pick([null, INK, '15161a']) : r() < 0.35 ? null : pick(['15161a', '15161a', '15161a', INK, 'c9a13b', '8a5a2b', cols[2], cols[1]]);
    out.push({
      name, num: team.num, design, way: real ? real.team : flag ? flag.label : way, style, rim, title: title.name, sponsors: others.slice(0, real ? others.length : 2 + busy).map(s => s.name), finish,
      base: liv.base, chips: cols, layers: liv.layers,
      stickers: S.slice(0, 24).map(st => ({ uv: uv(st.cell).map(v => +v.toFixed(5)), plane: st.plane, rect: st.rect, tint: st.tint })),
    });
  });
  return out;
}

const index = JSON.parse(fs.readFileSync(ROOT + 'data/cars/index.json', 'utf8'));
for (const key of Object.keys(ZONES).filter(k => index.some(c => c.key === k))) {
  const liv = build(key, Object.keys(ZONES).indexOf(key));
  fs.writeFileSync(`${ROOT}data/livery/${key}.json`, JSON.stringify(liv));
  const stk = liv.reduce((t, l) => t + l.stickers.length, 0), styles = {};
  for (const l of liv) styles[l.style] = (styles[l.style] || 0) + 1;
  console.log(`${key}: ${liv.length} teams, ${(stk / liv.length).toFixed(1)} stickers a car (fewest ${Math.min(...liv.map(l => l.stickers.length))}), ${new Set(liv.map(l => l.design)).size} designs, ${JSON.stringify(styles)}`);
}
