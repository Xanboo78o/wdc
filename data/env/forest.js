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
  monza:       { kinds: ['forest'], conifer: 0.12, depth: 60, density: 1, scrub: true, cover: true },
  // Suzuka's woods are Japanese cedar and pine on the hills.
  suzuka:      { kinds: ['forest'], conifer: 0.72, depth: 50, density: 1, scrub: true },
  // The Eifel: spruce right up to the fences.
  nurburgring: { kinds: ['forest'], conifer: 0.92, depth: 60, density: 1, scrub: true },
  // Dune pines behind the sand, low scrub everywhere else.
  zandvoort:   { kinds: ['forest'], conifer: 0.75, depth: 45, density: 0.85, scrub: true },
  // Aleppo pine and holm oak on the rock; the gardens are parks.
  monaco:      { kinds: ['forest', 'park'], conifer: 0.4, depth: 30, density: 0.8, scrub: true },
  // Seaside boulevard planting: broadleaf, and not deep.
  baku:        { kinds: ['forest', 'park'], conifer: 0.06, depth: 30, density: 0.8, scrub: false },
  // Pembroke, NH (Adam's street circuit): white pine, red oak and maple.
  // Adam: "add LOTS of forest" — deep, dense woods.
  street:      { kinds: ['forest'], conifer: 0.45, depth: 140, density: 1.3, scrub: true,
                 singles: 4000, papers: 12000 },
  // Anything not named above.
  _:           { kinds: ['forest'], conifer: 0.5, depth: 45, density: 1, scrub: true, cover: false },
};
