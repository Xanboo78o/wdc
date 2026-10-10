// geodesy.mjs — how many metres a degree is, for the survey bakes.
//
// Every bake projects latitude/longitude onto a flat plane round the
// circuit's own centre with two constants, inherited from DIRTY AIR:
//   111320 * cos(lat) m per degree of longitude, 110540 m per degree of latitude
// The second is the equator's figure. At Spa (50.4 N) a degree of latitude is
// 111229 m, so the plane was 0.62% short north-south — measured: the surveyed
// lap came out at 6970 m against 6995 m on the ellipsoid and an official 7004.
// Over Eau Rouge and Raidillon, which run north-south, that is two metres.
//
// The circuits baked before 2026-10-05 keep the old constants, because their
// tracks, cities, woods and heights were all baked through them and agree
// with each other; changing one tool would move the hill out from under the
// road. A circuit listed in EXACT is projected with the WGS84 series instead,
// by every tool, from its first bake.
// 2026-10-08: the circuits tools/bakeosm.mjs makes are exact from their first bake.
export const EXACT = new Set(['spa', 'nordschleife', 'lagunaseca', 'bathurst', 'brandshatch', 'silverstone']);

export function metresPerDegree(key, lat0) {
  const p = lat0 * Math.PI / 180;
  if (!EXACT.has(key)) return { mx: 111320 * Math.cos(p), my: 110540 };
  return {
    mx: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
    my: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
  };
}
