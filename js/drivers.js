// drivers.js — twenty-two people, not twenty-two copies of one.
//
// Adam, after being shoved into a wall: "norris isnt mean like that". And
// then: "performance is based on their personality and style, and their car,
// so the caddilac guys always in the back srry".
//
// Both halves of that were missing for the same reason. Every AI took its
// aggression and its grip from the DIFFICULTY TIER, so at MEDIUM all twenty-two
// were equally bold and equally fast, and the names above the cars were
// decoration. A grid where the only difference is a random seed is not a grid,
// it is one driver with twenty-two paint jobs.
//
// So one table drives three things:
//
//   THE CAR    `pace` scales the driver's grip. It is the biggest single
//              factor in where anyone finishes, exactly as in the real thing —
//              a great driver in a bad car finishes tenth.
//   THE DRIVER `agg` and `def` scale the tier's values rather than replacing
//              them, so HARD is still harder than CASUAL for everybody while
//              Verstappen is still bolder than Norris within it.
//   THE LIVERY `col` is the team's, so you can tell who is who at 300 m, which
//              is the entire job of a racing livery.
//
// TEAM NAMES ARE REAL (2026-09-24, Adam: "make them their real name"). They
// were invented until then, on the line js/brands.js still draws for
// SPONSORS: a colour is not a trademark, a name is. That trade-off was put to
// him and the call is his. Sponsors stay invented.

// The pace spread went from 3.8% to 5.6%. Measured, not guessed: at 3.8% the
// car finished behind the personality and the slowest team was not last.
//
// THE 2026 GRID (updated 2026-09-23, Adam: "gasly's in 20th, and liam lawson
// was in 4th... shouldnt happen", "remember the car speeds too", "jack doohan
// is no longer on the grid"). Eleven teams: Cadillac joined, Sauber became
// Audi, Tsunoda and Doohan are out, Lindblad, Perez and Bottas are in.
// The pace ORDER is the 2026 pecking order as of the first half of the season —
// the new-rules Mercedes at the front, Ferrari and McLaren next, Aston Martin
// struggling with its new power unit, Cadillac at the back as the new team.
// That is a judgement from the results, not a timing sheet, and it changes
// during a season: move a `pace` and the grid follows.
//
// `fg` is the livery's accent — the colour the stickers and the numbers are
// printed in — and `sp` its sponsors, title sponsor first. All of them are the
// invented brands in js/brands.js: team COLOURS are real, names never are.
export const TEAMS = {
  silver:   { name: 'MERCEDES',  col: '#27f4d2', pace: 1.000, fg: '#0b0d10',
              sp: ['HALDANE', 'NOVACORE', 'CHRONA', 'BITWAVE'] },   // Mercedes
  scarlet:  { name: 'FERRARI',   col: '#e8002d', pace: 0.993, fg: '#ffffff',
              sp: ['VELOCITA', 'RUSH', 'ARGENT', 'SKYLARK'] },   // Ferrari
  papaya:   { name: 'MCLAREN',   col: '#ff8000', pace: 0.990, fg: '#101014',
              sp: ['VROOM', 'GRIPMAX', 'NORTHWAY', 'CARGOLINE'] },   // McLaren
  navy:     { name: 'RED BULL',  col: '#1e41ff', pace: 0.984, fg: '#ffffff',
              sp: ['VOLTSURGE', 'KESTREL', 'ORBIX', 'ATLAS FREIGHT'] },   // Red Bull
  graphite: { name: 'HAAS',      col: '#b6babd', pace: 0.973, fg: '#b5121b',
              sp: ['MOLT', 'BRAKEWELL', 'SIGNALIS', 'CHRONA'] },   // Haas
  rose:     { name: 'ALPINE',    col: '#ff87bc', pace: 0.971, fg: '#1b4fd8',
              sp: ['NORTHFLOW', 'FOGLAST', 'HALCYON', 'GRIPMAX'] },   // Alpine
  cobalt:   { name: 'RACING BULLS',col: '#6692ff', pace: 0.968, fg: '#ffffff',
              sp: ['XANBOO78O', 'TERMINAL TYCOON', 'ZEST', 'RUSH'] },   // Racing Bulls
  titan:    { name: 'AUDI',      col: '#5c6166', pace: 0.963, fg: '#e8eaee',
              sp: ['MERIDIAN', 'DEEPWALK', 'EVERYDEATH', 'HALDANE'] },   // Audi
  azure:    { name: 'WILLIAMS',  col: '#00a0de', pace: 0.960, fg: '#ffffff',
              sp: ['PYRA', 'CRITTERS', 'NORTHWAY', 'BITWAVE'] },   // Williams
  emerald:  { name: 'ASTON MARTIN',col: '#229971', pace: 0.951, fg: '#cedc00',
              sp: ['KESTREL', 'ARGENT', 'SIGNALIS', 'SKYLARK'] },   // Aston Martin
  ivory:    { name: 'CADILLAC',  col: '#e9e9e9', pace: 0.944, fg: '#101014',
              sp: ['CRITTERS', 'ORBIX', 'CARGOLINE', 'NOVACORE'] },   // Cadillac, the new team

  // FANTASY F1 TEAMS — carmakers that never ran (or never ran like this) in
  // F1, in their own colours. Invented drivers, like everyone's sponsors.
  bugatti: { name: 'BUGATTI', col: '#1f5eff', pace: 0.985, fg: '#0a0f1f', era: 'fantasy',
             sp: ['HALCYON', 'ARGENT', 'CHRONA', 'NOVACORE'] },
  mazda:   { name: 'MAZDA',   col: '#00a651', pace: 0.966, fg: '#ff6f00', era: 'fantasy',
             sp: ['FOGLAST', 'CRITTERS', 'DEEPWALK', 'ZEST'] },   // the 787B's colours
  jeep:    { name: 'JEEP',    col: '#9aae3c', pace: 0.948, fg: '#1b1d12', era: 'fantasy',
             sp: ['DEEPWALK', 'ATLAS FREIGHT', 'NORTHFLOW', 'PYRA'] },
  subaru:  { name: 'SUBARU',  col: '#2b5bd7', pace: 0.958, fg: '#f5c400', era: 'fantasy',
             sp: ['KESTREL', 'TERMINAL TYCOON', 'BITWAVE', 'MERIDIAN'] },
  bmwm:    { name: 'BMW M',   col: '#6bb3e8', pace: 0.975, fg: '#e22718', era: 'fantasy',
             sp: ['CHRONA', 'SIGNALIS', 'XANBOO78O', 'HALDANE'] },
};

// agg  — how willing to commit to a move that might not be there
// def  — how hard they make it to be passed
// err  — mistake rate, scaled against the tier's own
// sk   — the DRIVER's share of pace, a small multiplier on the car's. Kept to
//        about +-1% so the car still decides the order and the person decides
//        who wins the team-mate battle (Adam: "performance is ... their car").
//
// These are characterisations, not measurements. They are meant to make the
// grid feel like people, and the only test that matters is whether Adam
// recognises somebody from how they drive.
//
// ORDER MATTERS: there is no qualifying yet, so this list IS the starting grid.
export const DRIVERS = [
  { n: 'RUSSELL',    t: 'silver',   num: 63, agg: 0.76, def: 0.82, err: 0.85, sk: 1.005 },
  { n: 'ANTONELLI',  t: 'silver',   num: 12, agg: 0.74, def: 0.60, err: 1.25, sk: 1.001 },
  { n: 'LECLERC',    t: 'scarlet',  num: 16, agg: 0.88, def: 0.74, err: 1.05, sk: 1.006 },
  { n: 'HAMILTON',   t: 'scarlet',  num: 44, agg: 0.70, def: 0.94, err: 0.80, sk: 1.002 },
  { n: 'NORRIS',     t: 'papaya',   num: 1,  agg: 0.58, def: 0.72, err: 1.00, sk: 1.006 },
  { n: 'PIASTRI',    t: 'papaya',   num: 81, agg: 0.72, def: 0.82, err: 0.80, sk: 1.004 },
  { n: 'VERSTAPPEN', t: 'navy',     num: 3,  agg: 0.97, def: 0.96, err: 0.75, sk: 1.010 },
  { n: 'HADJAR',     t: 'navy',     num: 6,  agg: 0.72, def: 0.66, err: 1.15, sk: 0.999 },
  { n: 'BEARMAN',    t: 'graphite', num: 87, agg: 0.76, def: 0.62, err: 1.20, sk: 1.000 },
  { n: 'OCON',       t: 'graphite', num: 31, agg: 0.74, def: 0.88, err: 1.00, sk: 0.999 },
  { n: 'GASLY',      t: 'rose',     num: 10, agg: 0.79, def: 0.80, err: 1.00, sk: 1.003 },
  { n: 'COLAPINTO',  t: 'rose',     num: 43, agg: 0.84, def: 0.58, err: 1.35, sk: 0.995 },
  { n: 'LAWSON',     t: 'cobalt',   num: 30, agg: 0.80, def: 0.64, err: 1.20, sk: 0.997 },
  { n: 'LINDBLAD',   t: 'cobalt',   num: 41, agg: 0.78, def: 0.58, err: 1.35, sk: 0.996 },
  { n: 'HULKENBERG', t: 'titan',    num: 27, agg: 0.66, def: 0.86, err: 0.85, sk: 1.001 },
  { n: 'BORTOLETO',  t: 'titan',    num: 5,  agg: 0.70, def: 0.60, err: 1.25, sk: 0.999 },
  { n: 'SAINZ',      t: 'azure',    num: 55, agg: 0.78, def: 0.86, err: 0.85, sk: 1.003 },
  { n: 'ALBON',      t: 'azure',    num: 23, agg: 0.64, def: 0.84, err: 0.90, sk: 1.001 },
  { n: 'ALONSO',     t: 'emerald',  num: 14, agg: 0.82, def: 0.99, err: 0.70, sk: 1.004 },
  { n: 'STROLL',     t: 'emerald',  num: 18, agg: 0.55, def: 0.70, err: 1.20, sk: 0.995 },
  { n: 'PEREZ',      t: 'ivory',    num: 11, agg: 0.72, def: 0.92, err: 1.00, sk: 0.999 },
  { n: 'BOTTAS',     t: 'ivory',    num: 77, agg: 0.62, def: 0.80, err: 0.90, sk: 0.999 },
];

// The fantasy teams' drivers. Invented people.
export const FANTASY_DRIVERS = [
  { n: 'DELACROIX',  t: 'bugatti', num: 9,  agg: 0.70, def: 0.84, err: 0.85, sk: 1.004 },
  { n: 'FONTAINE',   t: 'bugatti', num: 29, agg: 0.62, def: 0.70, err: 1.05, sk: 1.000 },
  { n: 'TAKEDA',     t: 'mazda',   num: 86, agg: 0.72, def: 0.80, err: 0.85, sk: 1.004 },
  { n: 'MORIMOTO',   t: 'mazda',   num: 17, agg: 0.60, def: 0.66, err: 1.00, sk: 0.999 },
  { n: 'DALTON',     t: 'jeep',    num: 4,  agg: 0.95, def: 0.90, err: 1.40, sk: 1.002 },
  { n: 'REYES',      t: 'jeep',    num: 99, agg: 0.82, def: 0.64, err: 1.25, sk: 0.998 },
  { n: 'HALONEN',    t: 'subaru',  num: 22, agg: 0.80, def: 0.70, err: 1.00, sk: 1.002 },
  { n: 'AALTO',      t: 'subaru',  num: 28, agg: 0.74, def: 0.76, err: 1.05, sk: 1.000 },
  { n: 'VOGEL',      t: 'bmwm',    num: 13, agg: 0.72, def: 0.92, err: 0.85, sk: 1.003 },
  { n: 'HARTMANN',   t: 'bmwm',    num: 24, agg: 0.68, def: 0.74, err: 1.00, sk: 1.000 },
];

// ---------------------------------------------------------------------------
// THE OTHER LEAGUES, and F1's old teams (Adam: "add OLD teams ... gt3 has all
// the gt3 teams and f4 has all the f4 teams").
//
// One line a team: [key, NAME, primary, secondary, pace, car numbers, sub].
// primary/secondary are the livery's two loudest colours and ALSO the UI's
// (see teamUI). These cars carry no invented people: a classic Lotus or a
// WRT BMW is labelled by team and number, because a made-up name in a real
// team's car would be worse than no name.
//
// COLOURS ARE FROM MEMORY of each team's best-known livery and should be
// checked against photographs; change them here and everything follows.
// ---------------------------------------------------------------------------
const OTHER = {
  // F1, the classic teams
  f1: [
    ['lotus',      'LOTUS',        '#d4af37', '#2f7d3a', 0.978, [11, 12], 'JPS BLACK & GOLD'],
    ['brabham',    'BRABHAM',      '#2a62d4', '#e10600', 0.972, [7, 8],   'CLASSIC'],
    ['tyrrell',    'TYRRELL',      '#2a5fcf', '#8fc8ff', 0.966, [3, 4],   'CLASSIC'],
    ['jordan',     'JORDAN',       '#f8d000', '#1bb04a', 0.968, [32, 33], 'CLASSIC'],
    ['benetton',   'BENETTON',     '#1fa3e0', '#3cb043', 0.980, [5, 6],   'CLASSIC'],
    ['minardi',    'MINARDI',      '#ffd100', '#1d5bd8', 0.946, [20, 21], 'CLASSIC'],
    ['brawn',      'BRAWN GP',     '#cfff1a', '#e8e8e8', 0.990, [22, 23], 'CLASSIC'],
    ['bar',        'BAR',          '#e3001b', '#f2f2f2', 0.970, [9, 10],  'CLASSIC'],
    ['jaguar',     'JAGUAR',       '#1a7a4c', '#d9d9d9', 0.955, [14, 15], 'CLASSIC'],
    ['toyota',     'TOYOTA',       '#eb0a1e', '#f2f2f2', 0.962, [16, 17], 'CLASSIC'],
    ['leyton',     'LEYTON HOUSE', '#19b4b4', '#f2f2f2', 0.952, [15, 16], 'CLASSIC'],
    ['ligier',     'LIGIER',       '#1f5eff', '#f2f2f2', 0.958, [25, 26], 'CLASSIC'],
  ],
  gt3: [
    ['wrt',        'TEAM WRT',      '#ffe600', '#1c69d4', 0.995, [46, 32], 'BMW M4 GT3'],
    ['manthey',    'MANTHEY',       '#1faa4b', '#ffd200', 0.996, [91, 911],'PORSCHE 911 GT3 R'],
    ['afcorse',    'AF CORSE',      '#d40000', '#ffd600', 0.993, [51, 71], 'FERRARI 296 GT3'],
    ['emilfrey',   'EMIL FREY',     '#f3c300', '#d40000', 0.990, [14, 69], 'FERRARI 296 GT3'],
    ['irondames',  'IRON DAMES',    '#ff4fa3', '#ffc2e0', 0.984, [83, 85], 'PORSCHE 911 GT3 R'],
    ['ironlynx',   'IRON LYNX',     '#d6152f', '#9aa0a6', 0.986, [60, 63], 'LAMBORGHINI HURACAN GT3'],
    ['garage59',   'GARAGE 59',     '#ff7a00', '#1f4fbf', 0.989, [58, 59], 'MCLAREN 720S GT3'],
    ['akkodis',    'AKKODIS ASP',   '#1d63ff', '#9ad1ff', 0.991, [87, 88], 'MERCEDES-AMG GT3'],
    ['getspeed',   'GETSPEED',      '#00b5e2', '#f2f2f2', 0.988, [2, 3],   'MERCEDES-AMG GT3'],
    ['mannfilter', 'MANN-FILTER',   '#009f3c', '#ffe100', 0.992, [48, 4],  'MERCEDES-AMG GT3'],
    ['boutsen',    'BOUTSEN VDS',   '#2e5bd6', '#e10600', 0.985, [9, 10],  'MERCEDES-AMG GT3'],
    ['attempto',   'TRESOR ATTEMPTO','#ff6b00', '#cfcfcf', 0.983, [99, 66], 'AUDI R8 LMS GT3'],
    ['comtoyou',   'COMTOYOU',      '#00665e', '#c8e600', 0.982, [7, 11],  'ASTON MARTIN VANTAGE GT3'],
    ['rowe',       'ROWE RACING',   '#2754c5', '#f5c400', 0.991, [98, 998],'BMW M4 GT3'],
    ['rutronik',   'RUTRONIK',      '#e2001a', '#cfcfcf', 0.987, [96, 97], 'PORSCHE 911 GT3 R'],
    ['grasser',    'GRT GRASSER',   '#95c11f', '#f2f2f2', 0.981, [19, 63], 'LAMBORGHINI HURACAN GT3'],
    ['corvette',   'CORVETTE RACING','#ffd100', '#c8c8c8', 0.990, [3, 4],  'CORVETTE Z06 GT3.R'],
    ['multimatic', 'FORD MULTIMATIC','#1f4fbf', '#e21b23', 0.986, [64, 65], 'FORD MUSTANG GT3'],
    ['vasser',     'VASSER SULLIVAN','#ff5a00', '#d0d0d0', 0.984, [12, 14], 'LEXUS RC F GT3'],
    ['proton',     'PROTON',        '#0b5fff', '#f2f2f2', 0.980, [77, 88], 'PORSCHE 911 GT3 R'],
  ],
  f4: [
    ['prema',      'PREMA',         '#e2001a', '#ffd1d6', 0.995, [2, 3, 4],   'ITALIAN F4'],
    ['var',        'VAN AMERSFOORT','#ff6a00', '#1d5bd8', 0.993, [5, 6, 7],   'ITALIAN F4'],
    ['usracing',   'US RACING',     '#1a3dff', '#e3001b', 0.992, [8, 9, 10],  'ITALIAN F4'],
    ['race',       'R-ACE GP',      '#1f63c9', '#ff3b3b', 0.990, [11, 12],    'ITALIAN F4'],
    ['mumbai',     'MUMBAI FALCONS','#f39200', '#1a4fa0', 0.988, [14, 15],    'ITALIAN F4'],
    ['jenzer',     'JENZER',        '#ffcc00', '#8a8f94', 0.984, [16, 17],    'ITALIAN F4'],
    ['hitech',     'HITECH',        '#e10600', '#cfcfcf', 0.991, [21, 22],    'BRITISH F4'],
    ['rodin',      'RODIN',         '#00c2a8', '#f2f2f2', 0.989, [23, 24],    'BRITISH F4'],
    ['carlin',     'CARLIN',        '#1c3faa', '#ff4d00', 0.987, [25, 26],    'BRITISH F4'],
    ['jhr',        'JHR',           '#2b56d6', '#f5c400', 0.985, [27, 28],    'BRITISH F4'],
    ['mp',         'MP MOTORSPORT', '#ff6200', '#6aa9ff', 0.990, [31, 32],    'SPANISH F4'],
    ['campos',     'CAMPOS',        '#e3001b', '#ffc400', 0.988, [33, 34],    'SPANISH F4'],
    ['motopark',   'MOTOPARK',      '#1f5fbf', '#f2f2f2', 0.986, [35, 36],    'SPANISH F4'],
    ['phm',        'PHM RACING',    '#d3ff00', '#9aa0a6', 0.983, [37, 38],    'SPANISH F4'],
  ],
};
// Sponsors for these, dealt from js/brands.js's invented pool so every car is
// still dressed. Deterministic per team, so a car looks the same every race.
const POOL = ['HALDANE', 'NOVACORE', 'CHRONA', 'BITWAVE', 'VELOCITA', 'RUSH', 'ARGENT', 'SKYLARK',
  'VROOM', 'GRIPMAX', 'NORTHWAY', 'CARGOLINE', 'VOLTSURGE', 'KESTREL', 'ORBIX', 'ATLAS FREIGHT',
  'MOLT', 'BRAKEWELL', 'SIGNALIS', 'NORTHFLOW', 'FOGLAST', 'HALCYON', 'ZEST', 'MERIDIAN', 'PYRA'];
const inkFor = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#101014' : '#ffffff';
};
const LEAGUE_DRIVERS = { f1classic: [], gt3: [], f4: [] };
for (const [league, rows] of Object.entries(OTHER)) {
  rows.forEach(([key, name, pri, sec, pace, nums, sub], i) => {
    TEAMS[key] = {
      name, col: pri, fg: inkFor(pri), pace, sub, league, ui: [pri, sec],
      era: league === 'f1' ? 'classic' : undefined,
      sp: [0, 1, 2, 3].map(k => POOL[(i * 7 + k * 5 + league.length) % POOL.length]),
    };
    for (const num of nums) {
      (LEAGUE_DRIVERS[league === 'f1' ? 'f1classic' : league]).push(
        { n: `${name} #${num}`, t: key, num, agg: 0.72, def: 0.74, err: 1.0, sk: 1.0 });
    }
  });
}
// The UI colours of the 2026 grid and the fantasy teams, same [primary, secondary].
const F1_UI = {
  silver: ['#27f4d2', '#c0c6cc'], scarlet: ['#e8002d', '#ffd400'], papaya: ['#ff8000', '#47c7fc'],
  navy: ['#3a5bff', '#ff1e2d'], graphite: ['#d8dadc', '#e10600'], rose: ['#ff87bc', '#3a6cff'],
  cobalt: ['#6692ff', '#ff2d55'], titan: ['#c9ccd1', '#f50537'], azure: ['#00a0de', '#ffd000'],
  emerald: ['#229971', '#cedc00'], ivory: ['#ececec', '#c9a449'],
  bugatti: ['#1f5eff', '#8fb4ff'], mazda: ['#00a651', '#ff6f00'], jeep: ['#9aae3c', '#e0a84a'],
  subaru: ['#3a6bf0', '#f5c400'], bmwm: ['#6bb3e8', '#e22718'],
};
for (const [k, ui] of Object.entries(F1_UI)) {
  TEAMS[k].ui = ui; TEAMS[k].league = 'f1';
  if (!TEAMS[k].era) TEAMS[k].era = '2026';
}

// Each team knows its own key, so a livery can be looked up from the team a
// car carries (js/livery.js).
for (const k in TEAMS) TEAMS[k].key = k;

export const LEAGUES = { f1: 'F1', gt3: 'GT3', f4: 'F4' };
/** The teams of one league, in table order. */
export const teamsIn = league => Object.keys(TEAMS).filter(k => TEAMS[k].league === league);

// WHO IS ON THE GRID. `DRIVERS` stays the 2026 F1 grid on its own (the tools
// measure it). F1 has a FIELD choice; GT3 and F4 race their own league.
// Mixed tables go a team at a time, so a 12-car race is still a mixture
// rather than the first six rows of one list.
function byTeam(list) {
  const m = new Map();
  for (const d of list) { if (!m.has(d.t)) m.set(d.t, []); m.get(d.t).push(d); }
  return [...m.values()];
}
function interleave(...lists) {
  const groups = lists.map(byTeam), out = [];
  for (let i = 0; i < Math.max(...groups.map(g => g.length)); i++) for (const g of groups) if (g[i]) out.push(...g[i]);
  return out;
}
// One car per team first, then the second cars: a 22-car GT3 race is every
// team, not the first eleven twice.
function roundRobin(list) {
  const groups = byTeam(list), out = [];
  for (let r = 0; r < Math.max(...groups.map(g => g.length)); r++) for (const g of groups) if (g[r]) out.push(g[r]);
  return out;
}
export const FIELDS = { f1: '2026 GRID', classic: 'CLASSIC', fantasy: 'FANTASY', all: 'ALL ERAS' };
let ACTIVE = DRIVERS;
export function setField(kind) {
  ACTIVE = kind === 'classic' ? roundRobin(LEAGUE_DRIVERS.f1classic)
    : kind === 'fantasy' ? FANTASY_DRIVERS
    : kind === 'all' ? interleave(DRIVERS, roundRobin(LEAGUE_DRIVERS.f1classic), FANTASY_DRIVERS)
    : kind === 'gt3' ? roundRobin(LEAGUE_DRIVERS.gt3)
    : kind === 'f4' ? roundRobin(LEAGUE_DRIVERS.f4)
    : DRIVERS;
}
export function driverAt(i) { return ACTIVE[((i % ACTIVE.length) + ACTIVE.length) % ACTIVE.length]; }
/** Everyone who drives for a team, for the team screen. */
export const driversOf = key => [...DRIVERS, ...FANTASY_DRIVERS, ...LEAGUE_DRIVERS.f1classic, ...LEAGUE_DRIVERS.gt3, ...LEAGUE_DRIVERS.f4]
  .filter(d => d.t === key);

// The UI in a team's colours: [background, ink, primary, secondary]. Only the
// two livery colours are stored; the background is a near-black leaning
// toward the primary and the ink a white leaning toward it, because the HUD
// sits over a sunlit circuit and a pale page would fight it.
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t)
  + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
export function teamUI(key) {
  const t = TEAMS[key];
  if (!t || !t.ui) return null;
  const [pri, sec] = t.ui;
  return [mix('#070707', pri, 0.08), mix('#f2f2f2', pri, 0.06), pri, sec];
}

export function teamOf(d) { return TEAMS[d.t] || TEAMS.ivory; }

/**
 * Apply a person and a car to a driver the tier already built.
 *
 * MULTIPLY, do not replace. The tier decides how hard the whole field is and
 * that has to keep working — SUPERCASUAL must stay gentle even for the bold
 * ones — so a profile shifts a driver WITHIN its tier rather than overriding
 * it. A `agg` of 0.5 is exactly the tier's own value.
 */
export function applyProfile(driver, prof, team) {
  if (!driver) return driver;
  // 0.75 + 0.5p, not 0.5 + p.
  //
  // The wider range was measured and it was wrong: tools/gridcheck.mjs put
  // EMERALD last on the grid instead of IVORY, because Alonso's def of 0.99
  // became a near-maximum defence multiplier and defending means moving off
  // the racing line every time anybody closes. Personality was swinging lap
  // time harder than the car was, which is backwards — Adam's rule is that
  // performance is the car FIRST and the person second. Halving the range
  // leaves personality deciding battles and the car deciding the order.
  driver.aggression = Math.min(1, driver.aggression * (0.75 + 0.5 * prof.agg));
  driver.defence = Math.min(1, driver.defence * (0.75 + 0.5 * prof.def));
  // Grip is the car. This is deliberately the biggest lever in here: a great
  // driver in a slow car finishes where the car does, and a grid that ignores
  // that has no reason to have teams in it at all.
  // The whole pace multiplier is kept on the driver as well, because the
  // OVERTAKES band re-sets grip every half second and must carry it through —
  // it did not, and that is how a Racing Bull ran 4th and an Alpine 20th.
  driver.paceMul = team.pace * (prof.sk ?? 1);
  driver.gripFrac = Math.max(0.4, driver.gripFrac * driver.paceMul);
  // Mistakes are a SCHEDULE, not a field: autopilot.js re-rolls an interval
  // from the tier's rate after every error. So the profile scales that rate,
  // and the first interval with it, or a sloppy rookie would drive his opening
  // stint as cleanly as Alonso.
  driver.errScale = prof.err;
  driver.nextMistake /= Math.max(0.3, prof.err);
  driver.profile = prof;
  driver.team = team;
  return driver;
}
