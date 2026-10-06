// CIRCUIT DE SPA-FRANCORCHAMPS — the second DLC circuit (Adam, 2026-10-05:
// "add spa ... Spa will be dlc, also eau rougue has to be 1:1").
//
// WHAT IS SPA'S OWN TODAY is underneath the scenery, in the data:
//   data/tracks/spa.json   the lap chained from OSM's own ways for the circuit
//                          (a node every 7-13 m through the corners), on an
//                          exact WGS84 projection (tools/geodesy.mjs): 7006 m
//                          against the official 7004
//   data/elev/spa.json     the road's height on EVERY 2 m sample, from the
//                          Walloon 0.5 m lidar terrain model of 2021-22
// tools/spacheck.mjs holds Eau Rouge and Raidillon to the survey.
//
// THE SET (2026-10-06), each piece on its surveyed footprint and laid out from
// the Walloon aerial photograph:
//   stands.js   the eight grandstands of the stadium section
//   pits.js     the F1 pit building with its tower, and the endurance pits
// Not built: Spa's own gantry and boards (the shared ones stand), the chalets
// and the grass banks. Heights everywhere are estimates; the headers say so.
//
// UNTIL IT HAS BEEN SEEN ON SCREEN the set is opt-in: `?set=1` on the game's
// address builds it, and without it Spa is dressed by the shared pipeline as
// before. tools/spasetcheck.mjs holds what can be held without eyes (every
// stand faces the road and clears the barrier, nothing is NaN); it cannot see
// a roof at the wrong height. Flip SEEN when someone has looked.
import * as stands from './stands.js';
import * as pits from './pits.js';

const SEEN = false;
const on = () => SEEN || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('set') === '1');
const PARTS = on() ? { stands, pits } : {};

// Asked for once, when the module loads: the address does not change under a race.
export const replaces = new Set(Object.values(PARTS).flatMap(p => p.replaces || []));

export function prepareEnv(env, track) {
  for (const [name, p] of Object.entries(PARTS)) {
    try { p.prepareEnv?.(env, track); } catch (e) { console.error(`spa ${name}.prepareEnv:`, e); }
  }
}

export function build(view, ctx) {
  const stats = {};
  for (const [name, p] of Object.entries(PARTS)) {
    try { stats[name] = p.build?.(view, ctx) ?? null; } catch (e) { console.error(`spa ${name}:`, e); stats[name] = 'error'; }
  }
  return stats;
}
