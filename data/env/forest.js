// THE WOODS ON THE REAL CIRCUITS — what grows, circuit by circuit.
//
// The survey (data/env/<circuit>.json) says WHERE the woods are: every
// forest polygon OpenStreetMap has. This file says what they are made of and
// which kinds of polygon count as a wood. Change anything; there is no bake.
//
//   kinds     which surveyed polygons get Adam's full forest stack — three rows
//             of real trees, the two banners, three rows of turning paper
//             trees, the near-black backdrop
//   conifer   0..1, the share of firs; the rest are broadleaf
//   depth     the DEEPEST the stack is allowed to be, treeline to backdrop, in
//             metres. The survey decides the rest: a strip of wood 14 m deep
//             stays 14 m deep ("depends on the area")
//   density   1 = the recipe; 0.6 = sparser rows
//   scrub     true = scrub polygons get a scatter of small real trees
//   singles   most loose trees planted (default 2100); papers: most far paper
//             trees (default 7000)
//   tall      how tall the trees grow: 1 = a 9.5 m broadleaf and a 15 m fir,
//             2.3 = the 22 m planes of a royal park (see makeKit in forest.js)
//   bridge    metres: a gap in the treeline up to this long, wooded at both
//             ends and with nothing built behind the barrier, is planted closed
//             (the satellite reads a lawn by the fence as a hole in the wood)
//   cover     true = ALSO plant the woods ESA WorldCover measured from orbit
//             (data/env/cover, tools/getcover.mjs), not only OSM's polygons.
//             Switched on circuit by circuit as each is checked by eye.
//
// Loose `natural=tree` points in the survey (Monza's avenue of planes) are
// always planted as single real trees, standing where they stand.
export const FOREST = {
  // The Parco di Monza: oak, hornbeam and plane, a royal park's woodland.
  // OSM maps a third of it; the satellite sees trees within 40 m of the
  // run-off on 79% of the lap's two sides (OSM: 34%).
  // The park's planes, oaks and horse chestnuts are 20-30 m: tall 2.3 grows
  // the 9.5 m model to ~22 m, and the rows' own 0.7-1.3 spread makes 15-29 m.
  // Adam: "make SUPER thick forest around the track". Deeper, denser, and
  // lawn gaps up to 400 m beside the fence planted closed (never where
  // anything is built: see `bridge` in woods.js).
  monza:       { kinds: ['forest'], conifer: 0.12, depth: 90, density: 1.3, scrub: true, cover: true, tall: 2.3,
                 bridge: 400 },
  // Suzuka's woods are Japanese cedar and pine on the hills.
  // Satellite: trees within 40 m of the run-off on 44% of the lap's sides (OSM 22%).
  suzuka:      { kinds: ['forest'], conifer: 0.72, depth: 50, density: 1, scrub: true, cover: true },
  // The Eifel: spruce right up to the fences.
  // Satellite: trees within 40 m of the run-off on 13% of the lap's sides
  // (OSM 9%); within 100 m, 34% (OSM 22%). The GP loop is open, the Eifel isn't.
  nurburgring: { kinds: ['forest'], conifer: 0.92, depth: 60, density: 1, scrub: true, cover: true },
  // Sepang is cut out of oil-palm estate, with secondary rainforest on the
  // low hills and ornamental palms round the paddock. `palm` puts palms in
  // the firs' slot, so `conifer` here is the share of palms.
  sepang:      { kinds: ['forest', 'park'], conifer: 0.7, palm: true, depth: 90, density: 1.2, scrub: true, cover: true,
                 tall: 1.3, bridge: 200 },
  // Dune pines behind the sand, low scrub everywhere else.
  // Satellite: 15% within 40 m (OSM 2%) — the dune woods behind the scrub.
  zandvoort:   { kinds: ['forest'], conifer: 0.75, depth: 45, density: 0.85, scrub: true, cover: true },
  // Aleppo pine and holm oak on the rock; the gardens are parks.
  monaco:      { kinds: ['forest', 'park'], conifer: 0.4, depth: 30, density: 0.8, scrub: true },
  // Seaside boulevard planting: broadleaf, and not deep.
  baku:        { kinds: ['forest', 'park'], conifer: 0.06, depth: 30, density: 0.8, scrub: false },
  // Pembroke, NH (Adam's street circuit): white pine, red oak and maple.
  // Adam: "add LOTS of forest" — deep, dense woods.
  // Satellite (fitted to the town like bakeenv): trees within 40 m of the
  // run-off on 59% of the lap's sides (OSM 51%), within 100 m 69% (64%).
  street:      { kinds: ['forest'], conifer: 0.45, depth: 140, density: 1.3, scrub: true, cover: true,
                 singles: 4000, papers: 12000 },
  // Anything not named above.
  _:           { kinds: ['forest'], conifer: 0.5, depth: 45, density: 1, scrub: true, cover: false },
};
