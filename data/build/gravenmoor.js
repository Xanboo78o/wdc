// GRAVENMOOR — the layout, drawn by hand.
//
// Adam, 2026-10-08 (it is October, and he loves Halloween): "add a haunted
// track thatd be fun".
//
// So: a moor village that is only ever raced at night. One lap, clockwise,
// 5.1 km, tarmac, 10-11 m wide (7.5 on the bridge). Nothing in this file is generated — every
// point below was placed for the reason written next to it, and
// tools/bakegravenmoor.mjs only puts a spline through them.
//
// THE LAP, and why it is in this order (fast - slow - fast, three times):
//
//   LANTERN ROW        the start straight, between the houses. 830 m, so the
//                      tow works, and the church tower stands dead ahead at
//                      the end of it the whole way down.
//   THE LYCHGATE       OVERTAKE 1. Flat out to a tight right-left under the
//                      churchyard gate: the heaviest stop of the lap.
//   CHURCH HILL        out of the gate and up, 7 %, past the church on the right.
//   VICARAGE           a flat left kink, still climbing, that sets up
//   SEXTON'S           the crest: a very long 150-degree right that goes light over
//                      the top and turns you down into the graveyard.
//   GRAVEYARD ESSES    left, right, left, right between the headstones,
//                      slightly downhill — the rhythm section; one mistake
//                      costs all four.
//   GIBBET             the fourth Ess tightens into a right-hander that turns
//                      you back toward the middle of the lap, and straight into
//   GALLOWS            a long 120-degree left, slightly downhill: the lap's one
//                      true S, and the exit is everything, because it opens onto
//   HANGMAN'S RUN      320 m, falling away, to...
//   HANGMAN'S HAIRPIN  OVERTAKE 2. A 180 round one enormous dead tree. The
//                      slowest corner, and the exit matters more than any
//                      other because of what comes next:
//   DEAD MAN'S MILE    1.44 km (0.9 of a mile) across the open moor, bending
//                      fourteen degrees left the whole way, with one crest two
//                      thirds along where the car goes light and the village
//                      lights come up over the top. Nowhere to hide.
//   THE HOLLOW         OVERTAKE 3, for the brave. Off the Mile, downhill,
//                      into the trees: a long fast left that keeps going,
//                      then right at the bottom where the road stops falling
//                      and the car is pressed into it. The dark part.
//   WIDOW'S BRIDGE     7.5 m of stone over the stream. One car wide at speed.
//   THE CAULDRON       the signature: 205 degrees of constant-radius banked
//                      right-hander round a black pond, climbing out of the
//                      dip all the way, and back onto Lantern Row.
//
// WHY THE WEST END IS SHAPED LIKE THAT. A bowl that turns more than 180
// degrees has an approach that points back across its own exit: the line of
// Widow's Bridge, carried on, would cut Lantern Row 310 m from the bowl. So
// the road must come at the bridge from the south-east and bend to it, which
// is what the Hollow's long left IS — it is not decoration, it is the only way
// the Cauldron can be 205 degrees without a crossover. That is also why the
// Mile runs diagonally across the moor instead of parallel to the village.
//
// Units are metres, x east, y north. `z` is height above Lantern Row.
// Arcs are true arcs: the centre and radius are given, and the points on them
// were worked out on a calculator (one every 15-22 degrees of turn) and typed in.

// The lap's line: on Lantern Row, 270 m after the Cauldron lets go of you, so
// a 22-car grid (8 m a row, the back row 174 m behind the line) forms up on
// the straight and not on the banking; 560 m before the Lychgate.
export const LINE = [-200, 0];

// surf: what the road is. w: HALF width, m. run: run-off each side, m.
export const KINDS = {
  village: { surf: 'tarmac', w: 5.0,  run: 2.0 },   // 10 m between the houses: a wall each side
  gate:    { surf: 'tarmac', w: 5.0,  run: 3.5 },   // the Lychgate: a little room to get it wrong
  lane:    { surf: 'tarmac', w: 5.0,  run: 6.0 },   // Church Hill and the Esses: verge, then graves
  road:    { surf: 'tarmac', w: 5.25, run: 8.0 },
  hairpin: { surf: 'tarmac', w: 5.5,  run: 6.0 },   // wide so two cars fit; the tree's island is 8 m across
  moor:    { surf: 'tarmac', w: 5.5,  run: 10.0 },  // 11 m: the Mile is for side-by-side
  wood:    { surf: 'tarmac', w: 5.25, run: 5.0 },   // the Hollow: trees close
  bridge:  { surf: 'tarmac', w: 3.75, run: 0.4 },   // 7.5 m, parapet to parapet
  bowl:    { surf: 'tarmac', w: 5.5,  run: 2.5 },   // banked: the wall is at the top of the banking
};

// The lap, in order. Each section owns the road from its first point to the
// next section's first point. `corners`: names for the bends in it, by the
// fraction of the section they are at (a section's own name is the default).
// `bank`: degrees, over the fractions `banked` (tapered at both ends by the bake).
export const SECTIONS = [
  // ---- LANTERN ROW -------------------------------------------------------------
  // Dead straight, due east, level: a village street. It starts where the
  // Cauldron's arc ends (heading 0 at [-470, 0]) and the points are collinear
  // so the spline cannot bow it. (Every straight below has a point 12-15 m in
  // from each end for the same reason: so the bend next door stays next door.)
  { id: 'row', name: 'Lantern Row', kind: 'village',
    pts: [[-470, 0, 0], [-455, 0, 0], [-380, 0, 0], [-200, 0, 0], [0, 0, 0], [180, 0, 0], [300, 0, 0], [345, 0, 0]] },

  // ---- THE LYCHGATE --------------------------------------------------------------
  // Right 65 degrees on R30 (centre [360, -30]), ten metres straight under the
  // gate, left 85 degrees on R36 (centre [424, -11.2]). R30 after 830 m of
  // straight is a stop from top speed to about 75 km/h: the place to pass.
  // The left is the wider radius ON PURPOSE: whoever gave up the inside for
  // the right-hander has the inside for the left, so a move here can be
  // answered. It leaves heading 20 degrees north of east, up the hill.
  { id: 'lychgate', name: 'The Lychgate', kind: 'gate',
    pts: [[360, 0, 0], [371.1, -2.1, 0.1], [380.6, -8.2, 0.2], [387.2, -17.3, 0.3],
      [391.4, -26.4, 0.6],                       // under the gate
      [399.1, -37.2, 1.32], [410.3, -44.4, 2.05], [423.3, -47.2, 2.77]] },

  // ---- CHURCH HILL ---------------------------------------------------------------
  // 200 m straight up the hill at 7.3 %, the church close on the right at
  // 150 m. A climb straight after the slowest-but-one corner, so the exit of
  // the Lychgate is worth a tenth all the way to the top.
  { id: 'hill', name: 'Church Hill', kind: 'lane',
    pts: [[436.4, -45, 3.5], [447.6, -40.9, 4.4], [530.3, -10.8, 10.82], [613, 19.3, 17.25]] },

  // ---- VICARAGE --------------------------------------------------------------------
  // Left 30 degrees on R200 (centre [555.9, 211.3]) past the vicarage, still
  // climbing, then 60 m straight. Flat in everything — it is not there to slow
  // you. It is there because a hill that ran straight into Sexton's made
  // Sexton's a 120-degree corner you could see all of; swinging left first
  // makes it 150 degrees and hides its exit behind the brow, and it opens the
  // road for the fast way in (out wide to the left, then right over the top).
  { id: 'vicarage', name: 'Vicarage', kind: 'lane',
    pts: [[624.3, 23.4, 18.15], [655.9, 38.1, 20.42], [684.4, 58.1, 22.69], [709.1, 82.8, 24.95],
      [716.8, 92, 25.65], [740, 119.6, 27.63]] },

  // ---- SEXTON'S --------------------------------------------------------------------
  // The top of the circuit (34 m). Right 150 degrees on R110 (centre
  // [831.9, 58]), a point every 16.6 degrees: quick, very long (287 m), blind
  // over the brow, and it has to turn you from north-east right round to
  // south because the graveyard is DOWN the far side. The hill eases off all
  // the way round it (the heights below fall away from 4.6 % to level), so
  // the brow is spread over the whole corner and is not a lip in the middle.
  // It ends pointing 10 degrees west of south — straight at the first Ess.
  { id: 'sexton', name: "Sexton's", kind: 'road',
    pts: [[747.7, 128.7, 28.23], [771.4, 149.9, 29.44], [800.2, 163.4, 30.51], [831.6, 168, 31.44], [863.1, 163.5, 32.22],
      [891.9, 150.2, 32.86], [915.8, 129.2, 33.36], [932.6, 102.3, 33.72], [941.1, 71.7, 33.93]] },

  // ---- GRAVEYARD ESSES ---------------------------------------------------------------
  // Four direction changes down an axis heading 15 degrees east of south from
  // [940.4, 39.9]: apexes 110 m apart and 16 m either side of the axis, the
  // crossing points on the axis itself, the road crossing it at 25 degrees
  // each time. Left, right, left, right — about R55 each, third gear in a
  // GT3 — falling 7 m over the 440 m so the car is always a little light on
  // turn-in. Sexton's is a right, so the first Ess is already a change of
  // direction; the rhythm matters more than any one of them: get the first
  // wrong and you are late for all four.
  { id: 'esses', name: 'Graveyard Esses', kind: 'lane',
    pts: [[940.4, 39.9, 34],
      [939.2, -17.4, 33.14],    // 1: left, round the first plot
      [968.9, -66.4, 32.27],
      [998.6, -115.4, 31.41],   // 2: right
      [997.4, -172.6, 30.55],
      [996.1, -229.9, 29.69],   // 3: left
      [1025.8, -278.9, 28.82],
      [1055.5, -327.9, 27.96]], // 4: right
    corners: { 0.125: 'Graveyard Esses 1', 0.375: 'Graveyard Esses 2', 0.625: 'Graveyard Esses 3', 0.875: 'Graveyard Esses 4' } },

  // ---- GIBBET ------------------------------------------------------------------------
  // Right 60 degrees more on R50 (centre [1005, -376.9]): the fourth Ess does
  // not let go, it tightens into this. Then 100 m straight. It turns the road
  // back WEST, into the middle of the lap, for two reasons: the hairpin has
  // to send the Mile north-west, so the road must come at the hairpin from
  // the north-west; and a lap that ran straight from the Esses to the hairpin
  // was 1:36 in a GT3 — nothing between the church and the Mile to slow anyone.
  { id: 'gibbet', name: 'Gibbet', kind: 'road',
    pts: [[1054.3, -385.1, 27.1], [1050.4, -397.7, 26.73], [1043.4, -408.8, 26.35], [1033.8, -417.8, 25.98], [1022.1, -423.9, 25.6],
      [1010.8, -428, 25.4], [939.4, -454, 24.26]] },

  // ---- GALLOWS -------------------------------------------------------------------------
  // Left 124 degrees on R80 (centre [955.5, -533.2]), a point every 15
  // degrees. Long, constant, slightly downhill, opening onto the longest
  // braking zone but one — so it is an EXIT corner: slow in, and on the power
  // from half way. Right-left with Gibbet, it is the lap's one true S.
  { id: 'gallows', name: 'Gallows', kind: 'road',
    pts: [[928.1, -458.1, 24.06], [909, -468.1, 23.69], [893.3, -482.9, 23.31], [882.1, -501.3, 22.94], [876.3, -522.1, 22.56],
      [876.2, -543.7, 22.19], [881.8, -564.5, 21.81], [892.9, -583, 21.44]] },

  // ---- HANGMAN'S RUN -----------------------------------------------------------------------
  // 320 m dead straight, heading 36 degrees south of east, falling 1.3 %: the
  // run down to the tree, which you can see the whole way.
  { id: 'run', name: "Hangman's Run", kind: 'road',
    pts: [[908.5, -598, 21.06], [918.2, -605, 20.9], [1037.9, -692, 18.98], [1157.6, -779, 17.05]] },

  // ---- HANGMAN'S HAIRPIN ----------------------------------------------------------------
  // Right 180 degrees on R20, centre [1155.6, -802.2] — where the tree stands —
  // a point every 22.5 degrees. In heading south-east, out heading north-west.
  // The slowest corner of the lap, about 60 km/h, and OVERTAKE 2.
  { id: 'hangman', name: "Hangman's Hairpin", kind: 'hairpin',
    pts: [[1167.3, -786, 16.89], [1172.6, -791.8, 16.79], [1175.3, -799.1, 16.69], [1175, -806.9, 16.59], [1171.8, -814, 16.49],
      [1166, -819.3, 16.39], [1158.7, -822, 16.29], [1150.9, -821.7, 16.19], [1143.8, -818.4, 16.09]] },

  // ---- DEAD MAN'S MILE ----------------------------------------------------------------------
  // From the hairpin to the lip of the Hollow [-113.6, -110.1]: 1.44 km (0.9 of
  // a mile — the village rounds up), leaving at 144 degrees and arriving at
  // 158, so it bends fourteen degrees LEFT along the way, 43 m off the chord
  // at half distance: you cannot see the end from the start, and it bends
  // away from Hangman's Run, which it leaves 40 m beside. A point every sixth.
  //   HEIGHT: falls gently for the first third (16 -> 14), climbs 3.3 % for
  //   the next third to THE CREST at two thirds (29.4 m), then falls 3.5 % to
  //   the Hollow. 6.8 % of grade change, rounded by the bake to a vertical
  //   radius of about 1100 m: at 290 km/h the car weighs 40 % of itself and
  //   stays on the road.
  { id: 'mile', name: "Dead Man's Mile", kind: 'moor',
    pts: [[1134.1, -811.4, 15.99], [1111.5, -794.9, 15.79],   // 12 and 40 m out, on the exit line: the hairpin leaves straight
      [918.9, -660, 15.1],
      [721.7, -533.4, 14],          // the low point of the moor
      [519.8, -415.1, 21.72],
      [313.3, -305.1, 29.44],       // THE CREST, two thirds along
      [102.2, -203.4, 21.25]] },

  // ---- THE HOLLOW -------------------------------------------------------------------------------
  // Left 92 degrees on R130 (centre [-162.3, -230.6]) falling 7.8 %, a point
  // every 15 degrees; then right 45 degrees on R100 (centre [-378.5, -152])
  // where it bottoms out. The left is long because it has to be (see the note
  // at the top); the right is short and at the very bottom on purpose, so the
  // compression arrives with the change of direction.
  { id: 'hollow', name: 'The Hollow', kind: 'wood',
    pts: [[-113.6, -110.1, 13.06],
      [-147.3, -101.5, 10.35], [-181.9, -102.1, 7.64], [-215.2, -111.9, 4.93], [-244.7, -130.1, 2.22], [-268.4, -155.5, -0.49],
      [-284.5, -186.2, -3.2],      // the left ends, the right begins
      [-296.6, -209.3, -4.3], [-314.2, -228.6, -5.4]] },

  // ---- WIDOW'S BRIDGE ---------------------------------------------------------------------------
  // 80 m dead straight (heading 205) and level, the stream under the middle.
  // Straight so that nobody has to turn on the narrow part.
  { id: 'bridge', name: "Widow's Bridge", kind: 'bridge',
    pts: [[-336.2, -242.6, -6.5], [-347.1, -247.7, -6.5], [-372.5, -259.5, -6.5], [-397.8, -271.3, -6.5]] },

  // ---- THE CAULDRON -------------------------------------------------------------------------------
  // Right 205 degrees on a constant R145, centre [-470, -145] (the pond), a
  // point every 14.6 degrees. Banked 9 degrees. It climbs the 6.5 m back to
  // the village evenly round its 519 m, so the load never changes and you can
  // lean on it the whole way: ten seconds in a GT3 with the wheel still.
  { id: 'cauldron', name: 'The Cauldron', kind: 'bowl', bank: 9, banked: [0.05, 0.94],
    pts: [[-408.7, -276.4, -6.5], [-443.9, -287.6, -6.04], [-480.8, -289.6, -5.57], [-517, -282.2, -5.11], [-550.2, -265.8, -4.64],
      [-578.1, -241.6, -4.18], [-599, -211.2, -3.71], [-611.6, -176.4, -3.25], [-614.9, -139.6, -2.79], [-608.8, -103.1, -2.32],
      [-593.7, -69.4, -1.86], [-570.6, -40.6, -1.39], [-540.9, -18.5, -0.93], [-506.7, -4.7, -0.46]] },
];

// ---- THE PLACE ROUND IT ---------------------------------------------------------------------
// What stands where. The bake turns these into data/env and data/landmarks.
// All of it is placed; the only things the bake works out are which way a
// row of houses faces the road, and that nothing stands ON the road.
export const PLACE = {
  // The church: beside Church Hill at 150 m, on the right going up, turned to
  // face the road (20 degrees). The tower is at the west end — the end
  // Lantern Row looks at — and at 46 m it is the one thing you can see from
  // everywhere on the lap: dead ahead down the Row, over your left shoulder
  // on the Mile.
  church: { nave: [587.7, -21.9], hdg: 20, len: 30, wid: 14, h: 16, tower: [569.8, -28.4], towerW: 8, towerH: 46 },
  // The lychgate itself: over the road on the ten-metre straight between the
  // right and the left. (No scenery format can put a roof over the road; this
  // is here so the renderer's owner knows where it goes.)
  lychgate: { at: [389.3, -21.9], hdg: -65, span: 17 },
  // The hanging tree: at the hairpin's centre.
  tree: { at: [1155.6, -802.2], h: 21 },
  // Village houses: both sides of Lantern Row from x0 to x1, one every `every`
  // metres. Lengths, depths and heights repeat in the order written (no dice).
  houses: { x0: -335, x1: 345, every: 16.5,
    len: [11, 13, 10, 12.5, 14, 10.5], dep: [9, 10.5, 8, 11, 9.5], h: [8, 10.5, 7.5, 12, 9, 13.5, 8.5] },
  // Two more on the left going up Church Hill, opposite the church: the vicarage and its barn.
  extra: [{ at: [541, 25], hdg: 20, len: 15, dep: 10, h: 11 }, { at: [600, 46], hdg: 20, len: 18, dep: 9, h: 7 }],
  // Graveyard plots: [centre x, y, heading, rows, columns]; stones 2.6 m apart
  // along a row, rows 3 m apart. One on the INSIDE of each of the four Esses,
  // 30 m inside its apex (so every apex has
  // headstones behind its kerb), and the churchyard proper from the church up
  // to the inside of Sexton's.
  graves: [
    [968.1, -9.7, -75, 4, 7]  ,     // inside of Esses 1 (a left: its inside is to the east)
    [969.6, -123.2, -75, 4, 7],     // inside of Esses 2 (a right: to the west)
    [1025.1, -222.2, -75, 4, 7],    // inside of Esses 3
    [1026.5, -335.7, -75, 4, 7],    // inside of Esses 4
    [645, -8, 20, 5, 12],           // the churchyard, east of the nave
    [738, 70, 45, 4, 10],           // on up the hill, right of the road past the Vicarage bend
    [866.2, 132.5, -25, 5, 9],      // inside Sexton's, 82 m from its centre
  ],
  // Woods, as outlines. The Hollow's wood wraps the dip on both sides, runs up
  // behind the village gardens and round the pond; Hangman's Wood stands
  // behind the hairpin so the tree is seen against black; the Cauldron has a
  // fringe round its outside; and there are yews below the churchyard.
  woods: [
    [[-20, -55], [-330, -55], [-380, -150], [-330, -330], [-150, -400], [60, -330], [120, -180], [60, -70]],
    [[1135, -705], [1295, -705], [1355, -875], [1235, -985], [1045, -945], [1055, -855]],
    [[-640, 60], [-760, -80], [-750, -260], [-640, -380], [-470, -400], [-470, -330], [-640, -280], [-680, -150], [-620, -20]],
    [[620, -70], [760, -40], [780, -130], [660, -150]],
  ],
  // The moor: heather and gorse (low scrub) either side of the Mile. Open
  // ground: nothing on it taller than a sheep.
  moor: [
    // inside the lap, between the Mile and the village / the Esses
    [[700, -470], [500, -355], [300, -250], [110, -160], [110, -70], [400, -80], [520, -70], [640, -170], [800, -150], [900, -60],
      [930, -120], [945, -230], [990, -330], [985, -390], [900, -420], [840, -470], [830, -560], [790, -520]],
    // outside it, south-west of the Mile
    [[980, -760], [780, -630], [560, -490], [330, -365], [100, -260], [40, -400], [150, -560], [600, -900], [950, -980]],
    // and east of the graveyard, out to nothing
    [[1010, 60], [1320, 0], [1400, -600], [1260, -700], [1140, -560], [1140, -330], [1085, -180], [1075, -40]],
  ],
  // The water. The pond the Cauldron goes round (an ellipse: centre, radii),
  // and the stream that runs out of it, under the middle of Widow's Bridge
  // [-354.4, -251] at right angles — it crosses the lap ONLY there — and away
  // south across the moor.
  pond: { at: [-478, -150], rx: 58, ry: 46 },
  stream: { w: 7, pts: [[-432, -178], [-395, -195], [-371.3, -214.7], [-354.4, -251], [-337.5, -287.3], [-325, -350], [-335, -450], [-290, -560], [-300, -700]] },
  // Floodlights (it is only raced at night): [x, y, height]. The start line,
  // the Row's far end, both sides of the Lychgate, the outside of the hairpin,
  // the bridge, and three round the outside of the Cauldron. None on the Mile:
  // the Mile is dark.
  lights: [[-200, 31, 30], [120, -31, 30], [352, 26, 30], [424, -60, 28],
    [1183.1, -822.2, 30], [-331.1, -253.5, 26], [-632, -145, 34], [-584.5, -259.5, 34], [-584.5, -30.5, 34]],
  // Pumpkins. Along Lantern Row, one every `every` metres, alternate sides,
  // in the 2.5 m between the wall and the house fronts; a ring of `ring` round
  // the hanging tree and `outer` more round the outside of the hairpin; a
  // pair at each end of the bridge; and one giant at the foot of the tower,
  // looking down the Row at you.
  pumpkins: { row: { x0: -330, x1: 340, every: 22, r: [0.55, 0.7, 0.45, 0.8] }, ring: 9, ringR: 5, outer: 7, outerArc: [54, -126],
    giant: { at: [552, -36], r: 2.4, face: 180 } },
};

// The one route there is.
export const ROUTE = { key: 'gravenmoor', name: 'Gravenmoor', full: 'Gravenmoor — the Moor Circuit', country: 'XANBOO78O',
  tag: 'THE MOOR · ONLY EVER AT NIGHT' };
