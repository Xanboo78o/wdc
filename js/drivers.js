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
export const TEAMS = {
  papaya:   { name: 'PAPAYA',    col: '#ff8000', pace: 1.000 },
  scarlet:  { name: 'SCARLET',   col: '#e8002d', pace: 0.992 },
  silver:   { name: 'SILVER',    col: '#27f4d2', pace: 0.987 },
  navy:     { name: 'NAVY',      col: '#1e41ff', pace: 0.984 },
  azure:    { name: 'AZURE',     col: '#00a0de', pace: 0.977 },
  emerald:  { name: 'EMERALD',   col: '#229971', pace: 0.972 },
  cobalt:   { name: 'COBALT',    col: '#6692ff', pace: 0.968 },
  graphite: { name: 'GRAPHITE',  col: '#b6babd', pace: 0.963 },
  rose:     { name: 'ROSE',      col: '#ff87bc', pace: 0.958 },
  lime:     { name: 'LIME',      col: '#52e252', pace: 0.952 },
  ivory:    { name: 'IVORY',     col: '#d9d2c5', pace: 0.944 },   // the new team
};

// agg  — how willing to commit to a move that might not be there
// def  — how hard they make it to be passed
// err  — mistake rate, scaled against the tier's own
//
// These are characterisations, not measurements. They are meant to make the
// grid feel like people, and the only test that matters is whether Adam
// recognises somebody from how they drive.
export const DRIVERS = [
  { n: 'VERSTAPPEN', t: 'navy',     num: 1,  agg: 0.97, def: 0.96, err: 0.75 },
  { n: 'NORRIS',     t: 'papaya',   num: 4,  agg: 0.58, def: 0.72, err: 1.00 },
  { n: 'PIASTRI',    t: 'papaya',   num: 81, agg: 0.72, def: 0.82, err: 0.80 },
  { n: 'LECLERC',    t: 'scarlet',  num: 16, agg: 0.88, def: 0.74, err: 1.05 },
  { n: 'HAMILTON',   t: 'scarlet',  num: 44, agg: 0.70, def: 0.94, err: 0.80 },
  { n: 'RUSSELL',    t: 'silver',   num: 63, agg: 0.76, def: 0.82, err: 0.85 },
  { n: 'ANTONELLI',  t: 'silver',   num: 12, agg: 0.74, def: 0.60, err: 1.35 },
  { n: 'TSUNODA',    t: 'navy',     num: 22, agg: 0.86, def: 0.66, err: 1.25 },
  { n: 'ALBON',      t: 'azure',    num: 23, agg: 0.64, def: 0.84, err: 0.90 },
  { n: 'SAINZ',      t: 'azure',    num: 55, agg: 0.78, def: 0.86, err: 0.85 },
  { n: 'ALONSO',     t: 'emerald',  num: 14, agg: 0.82, def: 0.99, err: 0.70 },
  { n: 'STROLL',     t: 'emerald',  num: 18, agg: 0.55, def: 0.70, err: 1.20 },
  { n: 'HADJAR',     t: 'cobalt',   num: 6,  agg: 0.72, def: 0.66, err: 1.15 },
  { n: 'LAWSON',     t: 'cobalt',   num: 30, agg: 0.80, def: 0.64, err: 1.20 },
  { n: 'OCON',       t: 'graphite', num: 31, agg: 0.74, def: 0.88, err: 1.00 },
  { n: 'BEARMAN',    t: 'graphite', num: 87, agg: 0.76, def: 0.62, err: 1.25 },
  { n: 'GASLY',      t: 'rose',     num: 10, agg: 0.79, def: 0.80, err: 1.00 },
  { n: 'COLAPINTO',  t: 'rose',     num: 43, agg: 0.84, def: 0.58, err: 1.40 },
  { n: 'HULKENBERG', t: 'lime',     num: 27, agg: 0.66, def: 0.86, err: 0.85 },
  { n: 'BORTOLETO',  t: 'lime',     num: 5,  agg: 0.70, def: 0.60, err: 1.30 },
  { n: 'DOOHAN',     t: 'ivory',    num: 7,  agg: 0.68, def: 0.62, err: 1.25 },
  { n: 'ARON',       t: 'ivory',    num: 51, agg: 0.66, def: 0.60, err: 1.30 },
];

export function driverAt(i) { return DRIVERS[((i % DRIVERS.length) + DRIVERS.length) % DRIVERS.length]; }
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
  driver.gripFrac = Math.max(0.4, driver.gripFrac * team.pace);
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
