// sponsors.mjs — the hundred-odd companies that pay for a paddock that does not exist.
//
// Adam, 2026-10-08: "lotta sponsors and stickers". js/brands.js began this for
// the trackside boards (thirty brands, each a name, two colours, a typeface and
// a drawn mark). A car carries far more, and of more kinds, so this is the
// whole roster with a LAYOUT added: a tyre maker's slanted block, a bank's
// spaced serif, a snack's round badge, a brush-script energy drink.
//
// NOTHING HERE IS A REAL COMPANY. Every name is invented; the last block is
// Xanboo78o Studios' own games, which should be the ones you see most.
//
//   n     the name            bg, fg   its two colours, which it owns
//   f     typeface: S sans (Rubik) · A Anton · K Knewave (brush) · H Handlee (hand) · E serif · M mono
//   w     weight              it  italic          sp  letter-spacing in em
//   mark  a drawn mark (js/brands.js MARKS, plus the ones in atlas.html)
//   lay   mw mark+word · word · stack (two lines) · pill · slant · badge (round, square cell) · under (swoosh) · box (outline)
//   cat   what it sells — a team's sponsors are picked a few from each
const b = (n, bg, fg, f, w, it, sp, mark, lay, cat) => ({ n, bg, fg, f, w, it, sp, mark, lay, cat });
export const SPONSORS = [
  // tyres, brakes, parts — heavy, slanted, aggressive
  b('VELOCITA', '#d8352a', '#ffffff', 'S', 900, 1, -0.01, 'chevron', 'slant', 'parts'),
  b('GRIPMAX', '#101014', '#ffd400', 'S', 900, 1, 0, 'tri', 'mw', 'parts'),
  b('BRAKEWELL', '#1b1f26', '#ff6b1a', 'A', 400, 0, 0.04, 'disc', 'mw', 'parts'),
  b('TORQA', '#ffd400', '#101014', 'A', 400, 1, 0.02, 'bolt', 'slant', 'parts'),
  b('KERBSTONE', '#e8eaee', '#d6001c', 'S', 900, 0, 0.02, 'bars', 'box', 'parts'),
  b('APEXON', '#0c2f9c', '#ffffff', 'S', 800, 1, 0.04, 'chevron', 'under', 'parts'),
  b('HEXLOCK', '#15161a', '#35d6a0', 'M', 700, 0, 0.06, 'hex', 'mw', 'parts'),
  b('DUNMORE', '#0b4d33', '#f4f3ee', 'E', 700, 0, 0.12, 'ring', 'stack', 'parts'),
  b('RIVET & SONS', '#f4f3ee', '#1b1c20', 'E', 700, 0, 0.06, 'gear', 'stack', 'parts'),
  b('STAHLWERK', '#2a2d34', '#e8eaee', 'A', 400, 0, 0.08, 'gear', 'mw', 'parts'),
  // fuel and oil
  b('KESTREL', '#0f6b4a', '#ffffff', 'S', 800, 0, 0.02, 'wing', 'mw', 'fuel'),
  b('NORTHFLOW', '#1b4fd8', '#ffffff', 'S', 700, 0, 0.03, 'arc', 'mw', 'fuel'),
  b('PYRA', '#ff8000', '#101014', 'S', 900, 0, 0.06, 'tri', 'badge', 'fuel'),
  b('OKTAN', '#d6001c', '#ffd400', 'A', 400, 1, 0.02, 'drop', 'slant', 'fuel'),
  b('PETROVAR', '#101014', '#ff5a1f', 'S', 800, 0, 0.1, 'drop', 'mw', 'fuel'),
  b('LUMEN OIL', '#ffd400', '#0c1838', 'S', 900, 0, 0.02, 'sun', 'badge', 'fuel'),
  b('MOTA', '#00b3a4', '#ffffff', 'S', 900, 1, 0.04, 'drop', 'pill', 'fuel'),
  // energy drinks and fizz — shouting
  b('RUSH', '#e8002d', '#ffffff', 'S', 900, 1, -0.02, 'bolt', 'slant', 'drink'),
  b('ZEST', '#b9e400', '#101014', 'S', 900, 0, 0, 'disc', 'pill', 'drink'),
  b('VOLTSURGE', '#101014', '#35d6a0', 'A', 400, 1, 0.02, 'bolt', 'mw', 'drink'),
  b('FIZZBOMB', '#ff2d8a', '#ffe94a', 'K', 400, 0, 0, 'star', 'word', 'drink'),
  b('KAIJU COLA', '#3a0d6b', '#7dff5a', 'K', 400, 0, 0, 'claw', 'stack', 'drink'),
  b('GLACIA', '#dff4ff', '#0c6fb8', 'S', 300, 0, 0.3, 'peak', 'mw', 'drink'),
  b('YUZU!', '#ffe14a', '#1f9d48', 'K', 400, 0, 0, 'disc', 'badge', 'drink'),
  b('MAD GOAT', '#101014', '#ff5a1f', 'A', 400, 0, 0.03, 'horn', 'stack', 'drink'),
  b('BREWHAUS 0.0', '#f4e3b5', '#5a3a22', 'E', 700, 0, 0.04, 'ring', 'stack', 'drink'),
  // banks, insurance — quiet, serif, spaced
  b('NORTHWAY', '#0b2a4a', '#e8eaee', 'E', 600, 0, 0.16, 'hex', 'mw', 'money'),
  b('MERIDIAN', '#f2efe6', '#0b2a4a', 'E', 600, 0, 0.14, 'ring', 'mw', 'money'),
  b('ARGENT', '#2a2d34', '#c8a97a', 'E', 600, 0, 0.18, 'disc', 'word', 'money'),
  b('CASTELLAN', '#5a0f1c', '#e9d9a8', 'E', 600, 0, 0.14, 'tower', 'mw', 'money'),
  b('OAKHAVEN', '#1f3d2b', '#e8e2c8', 'E', 600, 0, 0.1, 'leaf', 'mw', 'money'),
  b('LEDGR', '#101014', '#7dffb0', 'M', 700, 0, 0.14, 'bars', 'box', 'money'),
  // airlines and freight
  b('SKYLARK', '#00a0de', '#ffffff', 'S', 300, 0, 0.2, 'wing', 'mw', 'travel'),
  b('ATLAS FREIGHT', '#b5121b', '#ffffff', 'A', 400, 0, 0.05, 'bars', 'stack', 'travel'),
  b('CARGOLINE', '#f5c518', '#101014', 'S', 800, 0, 0.02, 'bars', 'slant', 'travel'),
  b('AEROVIA', '#ffffff', '#d6001c', 'S', 700, 1, 0.08, 'wing', 'under', 'travel'),
  b('PELICAN EXPRESS', '#ff7a00', '#ffffff', 'S', 900, 1, 0, 'wing', 'stack', 'travel'),
  b('TRANSPOLAR', '#0c1838', '#8fcbea', 'S', 600, 0, 0.16, 'peak', 'mw', 'travel'),
  // tech and telecoms
  b('HALDANE', '#101014', '#e8eaee', 'M', 700, 0, 0.08, 'hex', 'mw', 'tech'),
  b('NOVACORE', '#6b2fd8', '#ffffff', 'S', 700, 0, 0.06, 'ring', 'mw', 'tech'),
  b('BITWAVE', '#e8eaee', '#101014', 'M', 700, 0, 0.1, 'arc', 'box', 'tech'),
  b('SIGNALIS', '#0f8f6b', '#ffffff', 'S', 600, 0, 0.12, 'arc', 'mw', 'tech'),
  b('QUBIT', '#00e0ff', '#0c1838', 'S', 900, 0, 0.1, 'hex', 'pill', 'tech'),
  b('PIXELFORGE', '#ff3b6b', '#ffffff', 'M', 700, 0, 0.02, 'pixel', 'mw', 'tech'),
  b('NIMBUS', '#f4f7ff', '#3a5bd8', 'S', 500, 0, 0.14, 'cloud', 'mw', 'tech'),
  b('ZEROPING', '#101014', '#cfff1a', 'A', 400, 1, 0.04, 'bolt', 'slant', 'tech'),
  // watches, fashion — restrained
  b('CHRONA', '#141821', '#d9c48a', 'E', 500, 0, 0.24, 'ring', 'word', 'style'),
  b('HALCYON', '#f2efe6', '#1b1f26', 'E', 500, 0, 0.22, 'disc', 'word', 'style'),
  b('MAISON VERO', '#101014', '#f4f3ee', 'E', 500, 1, 0.12, 'ring', 'stack', 'style'),
  b('ORLOV', '#3a0d1c', '#e9c98a', 'E', 600, 0, 0.3, 'star', 'word', 'style'),
  b('STUDIO NINE', '#ff5fa2', '#101014', 'S', 900, 0, 0.02, 'disc', 'badge', 'style'),
  // food — the ones somebody will hate
  b('CRUNCHO', '#ffcf1a', '#d6001c', 'K', 400, 0, 0, 'star', 'word', 'food'),
  b('NOODLE KING', '#d6001c', '#ffe94a', 'A', 400, 0, 0.03, 'crown', 'stack', 'food'),
  b('BIG DILL', '#2f8f3a', '#f4ffd0', 'K', 400, 0, 0, 'leaf', 'badge', 'food'),
  b('DONUT DISTRICT', '#ff8fc8', '#5a2a6b', 'K', 400, 0, 0, 'ring', 'stack', 'food'),
  b('HOT HONEY', '#ffb000', '#5a1a00', 'K', 400, 0, 0, 'drop', 'word', 'food'),
  b('MOO MILK', '#ffffff', '#1a55d8', 'H', 400, 0, 0.02, 'cloud', 'badge', 'food'),
  b('TACO TORNADO', '#ff5a1f', '#ffe94a', 'A', 400, 1, 0.02, 'tri', 'stack', 'food'),
  b('MOON CHEESE', '#0c1838', '#ffe27a', 'H', 400, 0, 0.04, 'disc', 'stack', 'food'),
  // tools, batteries, trades
  b('IRONBARK', '#3a2f22', '#ff9a3a', 'A', 400, 0, 0.06, 'leaf', 'mw', 'trade'),
  b('MAKO TOOLS', '#00b3a4', '#101014', 'S', 900, 1, 0, 'tri', 'slant', 'trade'),
  b('FORGE & FIRE', '#1b1c20', '#ff5a1f', 'E', 700, 0, 0.08, 'sun', 'stack', 'trade'),
  b('VOLTA', '#cfff1a', '#101014', 'S', 900, 0, 0.14, 'bolt', 'pill', 'trade'),
  b("GRANDMA'S GARAGE", '#f7d9e6', '#8a0f24', 'H', 400, 0, 0.02, 'gear', 'stack', 'trade'),
  b('OK COMPUTER REPAIR', '#e8eaee', '#1a55d8', 'M', 700, 0, 0, 'pixel', 'stack', 'trade'),
  // the odd ones
  b('SLEEPY BEAR', '#2f3f6b', '#ffe9c7', 'H', 400, 0, 0.04, 'cloud', 'stack', 'odd'),
  b('DR. WOBBLE', '#7dffb0', '#3a0d6b', 'K', 400, 0, 0, 'ring', 'word', 'odd'),
  b('CAT TAX', '#101014', '#ff9ad5', 'S', 900, 0, 0.1, 'claw', 'badge', 'odd'),
  b('SOCKS!', '#ff5a1f', '#ffffff', 'K', 400, 0, 0, 'star', 'word', 'odd'),
  b('LAVA LAMP CO', '#6a2fb0', '#ff8fc8', 'K', 400, 0, 0, 'drop', 'stack', 'odd'),
  b('PIGEON POST', '#bfc3c8', '#1b1c20', 'E', 700, 1, 0.04, 'wing', 'stack', 'odd'),
  b('NAP TIME', '#ffe9c7', '#6a2fb0', 'H', 400, 0, 0.06, 'cloud', 'word', 'odd'),
  // Xanboo78o Studios and its games
  b('XANBOO78O', '#101014', '#35d6a0', 'S', 900, 0, 0.06, 'hex', 'mw', 'studio'),
  b('XBR', '#d6001c', '#ffffff', 'A', 400, 1, 0.06, 'chevron', 'slant', 'studio'),
  b('XANCOIN', '#ffcf1a', '#101014', 'S', 900, 0, 0.04, 'ring', 'badge', 'studio'),
  b('FOGLAST', '#2a3340', '#9fd8ff', 'A', 400, 0, 0.1, 'arc', 'mw', 'studio'),
  b('VROOM', '#ff8000', '#101014', 'S', 900, 1, -0.01, 'chevron', 'slant', 'studio'),
  b('CRITTERS', '#0f8f6b', '#eafff4', 'S', 800, 0, 0.04, 'disc', 'pill', 'studio'),
  b('TERMINAL TYCOON', '#0b0d10', '#35d6a0', 'M', 700, 0, 0.04, 'bars', 'stack', 'studio'),
  b('ORBIX', '#1b4fd8', '#ffffff', 'S', 900, 0, 0.08, 'ring', 'mw', 'studio'),
  b('MOLT', '#d8352a', '#ffe9c7', 'E', 700, 0, 0.12, 'tri', 'word', 'studio'),
  b('EVERYDEATH', '#14161b', '#d8352a', 'A', 400, 1, 0.06, 'bolt', 'mw', 'studio'),
  b('DEEPWALK', '#3a2f22', '#e8d9b5', 'E', 600, 0, 0.14, 'hex', 'mw', 'studio'),
  b('CORELIGHT', '#0c1838', '#ffe27a', 'S', 600, 0, 0.18, 'sun', 'mw', 'studio'),
  b('CANON EVENT', '#f4f3ee', '#6a2fb0', 'E', 700, 1, 0.04, 'star', 'stack', 'studio'),
  b('APEX RACER', '#101014', '#ff3b6b', 'A', 400, 1, 0.04, 'chevron', 'stack', 'studio'),
  b('OVERHANG', '#ff5a1f', '#101014', 'A', 400, 0, 0.06, 'peak', 'mw', 'studio'),
  b('RIG 13', '#1b1c20', '#ffb000', 'M', 700, 0, 0.2, 'tower', 'box', 'studio'),
  b('POND', '#0c2f4a', '#8fe3c4', 'H', 400, 0, 0.2, 'drop', 'word', 'studio'),
  b('CORN', '#ffd400', '#2f8f3a', 'K', 400, 0, 0, 'leaf', 'badge', 'studio'),
  b('CARDBOARD WARFARE', '#b98a54', '#2a1a0c', 'A', 400, 0, 0.02, 'star', 'stack', 'studio'),
  b('BIG PROBLEM', '#d6001c', '#ffe94a', 'A', 400, 0, 0.02, 'tri', 'stack', 'studio'),
  b('INKOGNITO', '#f4f3ee', '#101014', 'H', 400, 0, 0.04, 'disc', 'under', 'studio'),
  b('OMMOR', '#1a0d3a', '#b98aff', 'S', 300, 0, 0.4, 'ring', 'word', 'studio'),
  b('DOGGO BATTLES', '#ffcf1a', '#1a55d8', 'K', 400, 0, 0, 'claw', 'stack', 'studio'),
  b('ANT INC', '#101014', '#ff5a1f', 'M', 700, 0, 0.16, 'hex', 'box', 'studio'),
  b('LITTLE WARS', '#2f8f3a', '#ffe9c7', 'A', 400, 0, 0.04, 'tower', 'stack', 'studio'),
  b('CRUISE', '#ff5fa2', '#0c1838', 'K', 400, 0, 0, 'sun', 'word', 'studio'),
  b('DIRTY AIR', '#4a4e55', '#f4f3ee', 'S', 900, 1, 0.02, 'cloud', 'slant', 'studio'),
  b('SLIPSTREAM', '#00e0ff', '#0c1838', 'S', 900, 1, 0, 'wing', 'under', 'studio'),
];
export const CLASS_BADGES = ['GT3', 'GT4', 'CUP', 'HYPER', 'PRO', 'PRO-AM', 'AM', 'ROOKIE'];
