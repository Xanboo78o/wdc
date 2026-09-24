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
// TEAM NAMES ARE INVENTED and the colours are not, which is the same line
// js/brands.js draws: a colour is not a trademark, a name is. Papaya orange
// says McLaren to anybody who watches, and nothing in this repo claims to be
// McLaren.

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
  silver:   { name: 'SILVER',    col: '#27f4d2', pace: 1.000, fg: '#0b0d10',
              sp: ['HALDANE', 'NOVACORE', 'CHRONA', 'BITWAVE'] },   // Mercedes
  scarlet:  { name: 'SCARLET',   col: '#e8002d', pace: 0.993, fg: '#ffffff',
              sp: ['VELOCITA', 'RUSH', 'ARGENT', 'SKYLARK'] },   // Ferrari
  papaya:   { name: 'PAPAYA',    col: '#ff8000', pace: 0.990, fg: '#101014',
              sp: ['VROOM', 'GRIPMAX', 'NORTHWAY', 'CARGOLINE'] },   // McLaren
  navy:     { name: 'NAVY',      col: '#1e41ff', pace: 0.984, fg: '#ffffff',
              sp: ['VOLTSURGE', 'KESTREL', 'ORBIX', 'ATLAS FREIGHT'] },   // Red Bull
  graphite: { name: 'GRAPHITE',  col: '#b6babd', pace: 0.973, fg: '#b5121b',
              sp: ['MOLT', 'BRAKEWELL', 'SIGNALIS', 'CHRONA'] },   // Haas
  rose:     { name: 'ROSE',      col: '#ff87bc', pace: 0.971, fg: '#1b4fd8',
              sp: ['NORTHFLOW', 'FOGLAST', 'HALCYON', 'GRIPMAX'] },   // Alpine
  cobalt:   { name: 'COBALT',    col: '#6692ff', pace: 0.968, fg: '#ffffff',
              sp: ['XANBOO78O', 'TERMINAL TYCOON', 'ZEST', 'RUSH'] },   // Racing Bulls
  titan:    { name: 'TITAN',     col: '#5c6166', pace: 0.963, fg: '#e8eaee',
              sp: ['MERIDIAN', 'DEEPWALK', 'EVERYDEATH', 'HALDANE'] },   // Audi
  azure:    { name: 'AZURE',     col: '#00a0de', pace: 0.960, fg: '#ffffff',
              sp: ['PYRA', 'CRITTERS', 'NORTHWAY', 'BITWAVE'] },   // Williams
  emerald:  { name: 'EMERALD',   col: '#229971', pace: 0.951, fg: '#cedc00',
              sp: ['KESTREL', 'ARGENT', 'SIGNALIS', 'SKYLARK'] },   // Aston Martin
  ivory:    { name: 'IVORY',     col: '#e9e9e9', pace: 0.944, fg: '#101014',
              sp: ['CRITTERS', 'ORBIX', 'CARGOLINE', 'NOVACORE'] },   // Cadillac, the new team

  // THE MARQUES (2026-09-24, Adam: "we're adding fantasy teams, bugatti,
  // mazda, ford etc ... also on the grid", then "like jeep!"). Same rule as
  // above: the colours are the maker's own, the NAMES are invented — each is
  // the town the car comes from or a name tied to it, never the badge.
  molsheim:  { name: 'MOLSHEIM',  col: '#1f5eff', pace: 0.989, fg: '#0a0f1f', marque: true,
               sp: ['HALCYON', 'ARGENT', 'CHRONA', 'NOVACORE'] },    // Bugatti
  weissach:  { name: 'WEISSACH',  col: '#d5001c', pace: 0.987, fg: '#f7c600', marque: true,
               sp: ['MERIDIAN', 'GRIPMAX', 'SKYLARK', 'KESTREL'] },  // Porsche
  santagata: { name: "SANT'AGATA", col: '#ffc000', pace: 0.982, fg: '#111111', marque: true,
               sp: ['VELOCITA', 'ZEST', 'BITWAVE', 'RUSH'] },        // Lamborghini
  angelholm: { name: 'ÄNGELHOLM', col: '#006aa7', pace: 0.985, fg: '#fecc02', marque: true,
               sp: ['NORTHWAY', 'SIGNALIS', 'PYRA', 'HALDANE'] },    // Koenigsegg
  dearborn:  { name: 'DEARBORN',  col: '#e21b23', pace: 0.972, fg: '#ffffff', marque: true,
               sp: ['ATLAS FREIGHT', 'CARGOLINE', 'BRAKEWELL', 'ORBIX'] },   // Ford
  hiroshima: { name: 'HIROSHIMA', col: '#00a651', pace: 0.966, fg: '#ff6f00', marque: true,
               sp: ['FOGLAST', 'CRITTERS', 'DEEPWALK', 'ZEST'] },    // Mazda, the 787B's colours
  koromo:    { name: 'KOROMO',    col: '#eb0a1e', pace: 0.978, fg: '#ffffff', marque: true,
               sp: ['VOLTSURGE', 'MOLT', 'NOVACORE', 'GRIPMAX'] },   // Toyota
  toledo:    { name: 'TOLEDO',    col: '#9aae3c', pace: 0.948, fg: '#1b1d12', marque: true,
               sp: ['DEEPWALK', 'ATLAS FREIGHT', 'NORTHFLOW', 'PYRA'] },   // Jeep
  portello:  { name: 'PORTELLO',  col: '#c8102e', pace: 0.962, fg: '#00843d', marque: true,
               sp: ['VELOCITA', 'HALCYON', 'EVERYDEATH', 'SKYLARK'] },   // Alfa Romeo
  pleiades:  { name: 'PLEIADES',  col: '#2b5bd7', pace: 0.958, fg: '#f5c400', marque: true,
               sp: ['KESTREL', 'TERMINAL TYCOON', 'BITWAVE', 'MERIDIAN'] },   // Subaru
  garching:  { name: 'GARCHING',  col: '#6bb3e8', pace: 0.975, fg: '#e22718', marque: true,
               sp: ['CHRONA', 'SIGNALIS', 'XANBOO78O', 'HALDANE'] },   // BMW M
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

// The marques' drivers. Invented people, like the team names.
export const MARQUE_DRIVERS = [
  { n: 'DELACROIX',  t: 'molsheim',  num: 9,  agg: 0.70, def: 0.84, err: 0.85, sk: 1.004 },
  { n: 'FONTAINE',   t: 'molsheim',  num: 29, agg: 0.62, def: 0.70, err: 1.05, sk: 1.000 },
  { n: 'KELLER',     t: 'weissach',  num: 91, agg: 0.66, def: 0.90, err: 0.80, sk: 1.004 },
  { n: 'BRANDT',     t: 'weissach',  num: 19, agg: 0.74, def: 0.72, err: 1.00, sk: 1.001 },
  { n: 'ROSSETTI',   t: 'santagata', num: 64, agg: 0.92, def: 0.70, err: 1.30, sk: 1.003 },
  { n: 'BIANCHI',    t: 'santagata', num: 7,  agg: 0.80, def: 0.76, err: 1.10, sk: 1.000 },
  { n: 'LINDQVIST',  t: 'angelholm', num: 21, agg: 0.86, def: 0.78, err: 1.10, sk: 1.005 },
  { n: 'EKBERG',     t: 'angelholm', num: 2,  agg: 0.68, def: 0.74, err: 0.95, sk: 1.000 },
  { n: 'CALLAHAN',   t: 'dearborn',  num: 66, agg: 0.84, def: 0.88, err: 1.00, sk: 1.002 },
  { n: 'MERCER',     t: 'dearborn',  num: 50, agg: 0.64, def: 0.70, err: 1.05, sk: 0.999 },
  { n: 'TAKEDA',     t: 'hiroshima', num: 86,  agg: 0.72, def: 0.80, err: 0.85, sk: 1.004 },
  { n: 'MORIMOTO',   t: 'hiroshima', num: 17, agg: 0.60, def: 0.66, err: 1.00, sk: 0.999 },
  { n: 'HAYASHI',    t: 'koromo',    num: 8,  agg: 0.70, def: 0.86, err: 0.80, sk: 1.003 },
  { n: 'OGAWA',      t: 'koromo',    num: 37, agg: 0.76, def: 0.68, err: 1.15, sk: 1.000 },
  { n: 'DALTON',     t: 'toledo',    num: 4,  agg: 0.95, def: 0.90, err: 1.40, sk: 1.002 },
  { n: 'REYES',      t: 'toledo',    num: 99, agg: 0.82, def: 0.64, err: 1.25, sk: 0.998 },
  { n: 'CASTELLI',   t: 'portello',  num: 33, agg: 0.88, def: 0.72, err: 1.15, sk: 1.003 },
  { n: 'VALENTI',    t: 'portello',  num: 46, agg: 0.66, def: 0.78, err: 0.95, sk: 1.000 },
  { n: 'HALONEN',    t: 'pleiades',  num: 22, agg: 0.80, def: 0.70, err: 1.00, sk: 1.002 },
  { n: 'AALTO',      t: 'pleiades',  num: 28, agg: 0.74, def: 0.76, err: 1.05, sk: 1.000 },
  { n: 'VOGEL',      t: 'garching',  num: 13, agg: 0.72, def: 0.92, err: 0.85, sk: 1.003 },
  { n: 'HARTMANN',   t: 'garching',  num: 24, agg: 0.68, def: 0.74, err: 1.00, sk: 1.000 },
];

// WHO IS ON THE GRID. `DRIVERS` stays the F1 grid on its own (the tools
// measure it), and the menu's FIELD row picks which table driverAt() reads:
// the F1 grid, the marques, or both — MIXED takes a team from each in turn,
// so a 12-car race is still half and half rather than the first six rows.
function mixed() {
  const byTeam = list => { const m = new Map(); for (const d of list) { if (!m.has(d.t)) m.set(d.t, []); m.get(d.t).push(d); } return [...m.values()]; };
  const a = byTeam(DRIVERS), b = byTeam(MARQUE_DRIVERS), out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(...a[i]); if (b[i]) out.push(...b[i]); }
  return out;
}
export const FIELDS = { f1: 'F1 GRID', marques: 'MARQUES', mixed: 'MIXED' };
let ACTIVE = DRIVERS;
export function setField(kind) {
  ACTIVE = kind === 'marques' ? MARQUE_DRIVERS : kind === 'mixed' ? mixed() : DRIVERS;
}
export function driverAt(i) { return ACTIVE[((i % ACTIVE.length) + ACTIVE.length) % ACTIVE.length]; }

// The UI in a team's colours: [background, ink, primary, secondary]. The
// background is always a near-black tinted toward the team, because the HUD
// sits over a sunlit circuit and the menu over nothing — a pale page would
// fight both. Primary is what YOU are (focus, your row, lights out); the
// secondary is the car lapping the map and your best lap.
export const TEAM_UI = {
  silver:    ['#080b0c', '#e9eef0', '#27f4d2', '#c0c6cc'],
  scarlet:   ['#100607', '#f6ecea', '#e8002d', '#ffd400'],
  papaya:    ['#0d0a07', '#f7efe7', '#ff8000', '#47c7fc'],
  navy:      ['#060918', '#eef0fa', '#3a5bff', '#ff1e2d'],
  graphite:  ['#0c0c0d', '#eeeeee', '#d8dadc', '#e10600'],
  rose:      ['#070b18', '#f3f3fb', '#ff87bc', '#3a6cff'],
  cobalt:    ['#080b17', '#eef1ff', '#6692ff', '#ff2d55'],
  titan:     ['#0b0b0c', '#efefef', '#c9ccd1', '#f50537'],
  azure:     ['#050c16', '#eaf5fc', '#00a0de', '#ffd000'],
  emerald:   ['#06100c', '#eef5f1', '#229971', '#cedc00'],
  ivory:     ['#0a0a0a', '#f2f2f2', '#ececec', '#c9a449'],
  molsheim:  ['#050a18', '#eef2ff', '#1f5eff', '#8fb4ff'],
  weissach:  ['#0f0707', '#f5efe9', '#d5001c', '#f7c600'],
  santagata: ['#0d0c05', '#f6f3e6', '#ffc000', '#7bd400'],
  angelholm: ['#050b12', '#eef4f8', '#1a86d0', '#fecc02'],
  dearborn:  ['#0f0708', '#f4f1f1', '#e21b23', '#3d7bff'],
  hiroshima: ['#04100a', '#eef6f1', '#00a651', '#ff6f00'],
  koromo:    ['#0e0808', '#f3eeee', '#eb0a1e', '#c5c9cc'],
  toledo:    ['#0b0c07', '#f1efe4', '#9aae3c', '#e0a84a'],
  portello:  ['#10070a', '#f6eef0', '#d0142f', '#1fae5b'],
  pleiades:  ['#060a18', '#eef1fb', '#3a6bf0', '#f5c400'],
  garching:  ['#070a12', '#eef3f9', '#6bb3e8', '#e22718'],
};

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
