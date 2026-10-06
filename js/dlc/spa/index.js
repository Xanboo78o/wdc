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
// WHAT IS NOT BUILT: the set. Sepang's pack (js/dlc/sepang/) is 1300 lines of
// grandstand, paddock and gantry made to the real footprints and checked on
// screen piece by piece. Spa's equivalents — the F1 pit building and the
// endurance pits, the La Source and Eau Rouge grandstands, the Raidillon
// bridge-less skyline, the chalets — are the next job, and they go here as
// PARTS, exactly as Sepang's do. Until then this pack replaces nothing, so
// Spa is dressed by the shared pipeline: it is the right road in borrowed
// clothes, and it says so rather than passing them off as its own.
const PARTS = {};

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
