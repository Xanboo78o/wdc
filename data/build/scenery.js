// THE LAND AROUND THE TRACK — what grows where, one section at a time.
//
// Same idea as pieces.js: nothing here is worked out from a formula, you say
// what a place IS and the builder plants it. A section's name is the `part:`
// you gave it in pieces.js, so a stretch of track and the country it runs
// through are named the same thing.
//
//   'pine'    dense conifer forest, close to the road — Suzuka, Spa, the Ring
//   'wood'    broadleaf woodland, looser, lets the light through
//   'mixed'   both, which is what most real European circuits actually have
//   'scrub'   a few scattered trees, tall grass, open sky
//   'meadow'  no trees at all: grass, seed heads, a long view
//   'bare'    nothing but the mown verge — city circuits, the inside of a loop
//
// Each side is named separately, because a track with forest on one side and
// open country on the other is worth a hundred metres of atmosphere and costs
// nothing. `left` and `right` are from the DRIVER's seat.
//
// THESE ARE MY PLACEHOLDERS, like the 700 m start straight was. Change any of
// them — the page reloads in a second and there is no bake step.
export const SCENERY = {
  // Anything not named below.
  default: { left: 'meadow', right: 'meadow' },

  // The start straight: open, so the grandstand and the gantry read against
  // sky rather than against trees.
  'START': { left: 'meadow', right: 'scrub' },

  // Suzuka's esses run through forest on both sides — it is the reason that
  // section feels fast and blind.
  'Downhill esses': { left: 'pine', right: 'mixed' },

  // The Nürburgring's hairpins sit in a bowl in the Eifel forest.
  'Nürburgring hairpins': { left: 'pine', right: 'pine' },

  // Monaco is a city. Nothing grows at the tunnel mouth.
  'Monaco tunnel': { left: 'bare', right: 'bare' },

  // The double loop is a piece of engineering standing in open country, so you
  // can see the whole shape of it from the approach.
  'The double loop': { left: 'meadow', right: 'scrub' },

  // The snail winds in on itself; woodland on the outside, nothing inside, so
  // the shell of it stays readable from the air.
  'The snail': { left: 'wood', right: 'bare' },
};

// What each of those words means in trees per hectare and which species.
// `conifer` and `broad` are the two tree species the builder knows; `grass` is
// how thick the near-field grass is, as a multiplier on the default.
export const KINDS = {
  pine:   { trees: 120, conifer: 0.88, near: 8,  grass: 0.8 },
  wood:   { trees: 70,  conifer: 0.18, near: 12, grass: 1.0 },
  mixed:  { trees: 88,  conifer: 0.5,  near: 10, grass: 1.0 },
  scrub:  { trees: 14,  conifer: 0.35, near: 16, grass: 1.15 },
  meadow: { trees: 0,   conifer: 0,    near: 20, grass: 1.3 },
  bare:   { trees: 0,   conifer: 0,    near: 20, grass: 0.25 },
};

// How far out the forest goes. Past this the land is textured and empty, which
// the fog and the horizon take care of.
//
// These two numbers are the whole cost of the forest and they were set by
// MEASURING it: 260 m at 260 trees a hectare planted 26,193 trees, which is
// four seconds of load and more wood than you can see. 200 m at 120 is about
// nine thousand, and the treeline looks the same from the road.
export const FOREST_DEPTH = 200;

// ---------------------------------------------------------------------------
// LOOSE OBJECTS — what is lying about for you to hit.
//
// These are real bodies (js/props.js): they have mass, they take a contact
// impulse at the point of contact, and a tyre stack comes apart into tyres
// that then hit each other. Nothing here is scripted, so what the mess looks
// like is not something anybody decided.
//
//   tyres   true = stacks of tyres on the outside of every corner, the way a
//           real circuit protects a barrier
//   cones   'edge'   a line of cones down both verges
//           'slalom' cones in the middle of the straight, side alternating
//           'gate'   water-filled barriers narrowing the road into a chicane
//           0        none
//   boards  advertising hoardings on the grass, which break into panels
// ---------------------------------------------------------------------------
export const PROPS = {
  default: { tyres: true, cones: 0, boards: true },

  'START': { tyres: false, cones: 'edge', boards: true },
  'Downhill esses': { tyres: true, cones: 0, boards: false },
  'Nürburgring hairpins': { tyres: true, cones: 0, boards: true },
  // A tunnel is walls: nothing loose in there to be fished out.
  'Monaco tunnel': { tyres: false, cones: 0, boards: false },
  'The double loop': { tyres: false, cones: 'gate', boards: false },
  // The snail is slow and tight, which is the one place a slalom is fair.
  'The snail': { tyres: true, cones: 'slalom', boards: false },
};
