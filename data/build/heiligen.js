// HEILIGEN AUTO CIRCUIT — the layout, drawn by hand.
//
// Adam, 2026-10-06: "Heilegen Auto Cicuit!!! 12 routes ... the longest (9 km)
// or the shortest (kate mascoi length) or that with a joker lap, or even rally
// cross" — and when I asked him to sketch it: "no u make the auto circuit, but
// imagine allllll the routes, city, forest, snow, etc. ... i rlly want some
// super banked corners, a spanish hairpin, a few jumps big and small, but i
// really want gritty rally vibes".
//
// So this is authored, point by point, and nothing in it is generated: one
// site in the Germanic north of Valcorsa, a town in a valley with a mountain
// behind it, and a road network on which twelve routes are laps.
//
//   THE VALLEY (tarmac)   Hauptstrasse, the start straight through the town;
//                         the Altstadt, right-angle streets between the houses;
//                         the OSTKURVE, a banked bowl at the east end; the
//                         Talstrasse back west along the valley floor; and the
//                         STEILWAND, the steep banked wall that slings you
//                         back onto the Hauptstrasse.
//   THE FOREST (gravel)   the Waldaufstieg climbing north from the valley
//                         through the spruce, and the Waldweg, a fire road
//                         across the hillside with three crests in it.
//   THE PASS (snow)       above the tree line: the Schneekehren hairpins, the
//                         summit at the Heiligenpass, and the HIMMELSSPRUNG —
//                         the big jump, on the way down.
//   THE WEST              the descent on old tarmac to the HORQUILLA DE
//                         GRANADA, a Spanish hairpin (a gift from the south:
//                         the saints are the same in both tongues), and home.
//   THE ARENA (gravel)    the rallycross infield inside the valley loop, and
//                         the JOKER, a gravel loop round the outside of the
//                         Steilwand.
//
// Units are metres, x east, y north, before SCALE. `z` is height above the
// town. Each segment is a run of points [x, y, z]; a Catmull-Rom spline is put
// through them by tools/bakeheiligen.mjs, which also prints every route's
// length — the two that are promised are GRAND = 9.0 km and SPRINT = Kate
// Mascoi's 4.9 km, and SCALE and the mountain are trimmed until they are.
export const SCALE = 1.1;

// surface: what the ROAD is. w: half width, m. run: run-off each side, m.
export const KINDS = {
  street:  { surf: 'tarmac', w: 5.0, run: 1.5 },   // between the houses: a wall each side
  road:    { surf: 'tarmac', w: 6.0, run: 9 },
  bowl:    { surf: 'tarmac', w: 7.5, run: 2.5 },   // banked: the wall is at the top of the banking
  gravel:  { surf: 'gravel', w: 4.6, run: 3 },     // trees to the edge
  snow:    { surf: 'snow',   w: 4.6, run: 3.5 },   // snowbanks
  arena:   { surf: 'gravel', w: 5.5, run: 6 },
};

// Junctions, by name. A segment starts and ends on one.
export const NODES = {
  START:  [-300, 0, 0],      // the head of the Hauptstrasse (the lap's line is 300 m along it)
  TOWN:   [520, 0, 0],       // Marktplatz: the Altstadt turns off, the Stadtring carries on
  OST:    [1120, 62, 2],     // the two meet again before the Ostkurve
  TAL:    [990, 428, 12],    // out of the Ostkurve: the mountain turns off north
  WALD:   [905, 1310, 92],   // half way up: the Waldweg turns off west
  ABSTIEG: [-385, 1245, 104], // the Waldweg and the pass road meet on the way down
  RX:     [-215, 452, 16],   // the rallycross infield joins the Talstrasse
  WEST:   [-425, 405, 15],   // foot of the descent: the Talstrasse arrives
  JOKER:  [-452, 322, 12],   // the joker turns off, outside the Steilwand
  ARENA:  [255, 0, 0],       // on the Hauptstrasse: the rallycross infield turns off
};

// name: { from, to, kind, pts: the points BETWEEN the two junctions, ... }
// bank: degrees, [fromFraction, toFraction] of the segment. jumps: [fraction, kick]
// where kick is how sharply the road drops away at the lip (a slope, 0.1 = small).
export const SEGMENTS = {
  // ---- the valley -------------------------------------------------------------
  hauptstrasse1: { from: 'START', to: 'ARENA', kind: 'road', name: 'Hauptstraße', pts: [[-100, 0, 0], [100, 0, 0]] },
  hauptstrasse2: { from: 'ARENA', to: 'TOWN', kind: 'road', name: 'Hauptstraße', pts: [[390, 0, 0]] },
  // The Stadtring: straight on, one fast kink past the church.
  stadtring: { from: 'TOWN', to: 'OST', kind: 'road', name: 'Stadtring', pts: [[700, 6, 0], [900, 30, 1]] },
  // The Altstadt: right into Kirchgasse, left along the Mühlbach, left up
  // Brunnengasse, right at the Rathaus. Four right angles between houses.
  altstadt: { from: 'TOWN', to: 'OST', kind: 'street', name: 'Altstadt',
    pts: [[566, -6, 0], [590, -22, 0], [600, -50, 0], [600, -292, -1], [611, -322, -1], [640, -336, -1], [896, -336, -1],
      [925, -324, -1], [936, -295, 0], [936, -40, 1], [946, -6, 1], [972, 16, 2], [1040, 44, 2]],
    corners: { 0.06: 'Kirchgasse', 0.36: 'Mühlbach', 0.64: 'Brunnengasse', 0.93: 'Rathaus' } },
  // The Ostkurve: a banked bowl, 180 degrees to the left.
  ostkurve: { from: 'OST', to: 'TAL', kind: 'bowl', name: 'Ostkurve', bank: 27, banked: [0.12, 0.9],
    pts: [[1245, 82, 3], [1338, 150, 5], [1368, 262, 7], [1318, 366, 9], [1210, 420, 11], [1090, 432, 12]] },
  // The Talstrasse: west along the valley floor, three long sweeps by the river.
  talstrasse1: { from: 'TAL', to: 'RX', kind: 'road', name: 'Talstraße',
    pts: [[870, 425, 12], [760, 505, 13], [640, 622, 13], [500, 648, 13], [384, 530, 14], [300, 400, 14], [170, 340, 14],
      [40, 390, 15], [-40, 470, 16], [-130, 485, 16]],
    corners: { 0.3: 'Flussbogen', 0.62: 'Mühle' } },
  talstrasse2: { from: 'RX', to: 'WEST', kind: 'road', name: 'Talstraße', pts: [[-300, 440, 16], [-380, 425, 15]] },
  // Down to the Steilwand: 31 degrees of banking, south to east.
  steilwand1: { from: 'WEST', to: 'JOKER', kind: 'road', name: 'Steilwand', pts: [[-445, 365, 13]] },
  steilwand2: { from: 'JOKER', to: 'START', kind: 'bowl', name: 'Steilwand', bank: 31, banked: [0.1, 0.88],
    pts: [[-462, 270, 9], [-470, 190, 6], [-448, 100, 3], [-400, 34, 1], [-340, 6, 0]] },

  // ---- the forest ---------------------------------------------------------------
  waldaufstieg: { from: 'TAL', to: 'WALD', kind: 'gravel', name: 'Waldaufstieg',
    pts: [[955, 500, 16], [985, 600, 24], [1050, 700, 34], [1040, 800, 44], [960, 880, 52], [935, 970, 60],
      [1010, 1050, 68], [1060, 1140, 76], [1010, 1230, 84], [940, 1270, 89]],
    jumps: [[0.55, 0.11]], corners: { 0.28: 'Holzweg', 0.5: 'Jägerkehre', 0.74: 'Fuchsbau' } },
  waldweg: { from: 'WALD', to: 'ABSTIEG', kind: 'gravel', name: 'Waldweg',
    pts: [[820, 1352, 94], [700, 1330, 95], [560, 1262, 96], [420, 1268, 99], [280, 1335, 100], [140, 1318, 99],
      [20, 1255, 100], [-110, 1262, 103], [-230, 1318, 105], [-320, 1296, 105]],
    jumps: [[0.2, 0.1], [0.47, 0.13], [0.7, 0.1]], corners: { 0.33: 'Köhlerhütte', 0.63: 'Drei Kuppen' } },

  // ---- the pass -------------------------------------------------------------------
  passstrasse: { from: 'WALD', to: 'ABSTIEG', kind: 'snow', name: 'Heiligenpass',
    pts: [[880, 1400, 100], [900, 1490, 110],
      // the Schneekehren: three hairpins up the headwall
      [985, 1560, 120], [1030, 1640, 130], [985, 1705, 137], [900, 1690, 143], [840, 1730, 150], [860, 1810, 158],
      [800, 1868, 166], [700, 1850, 174],
      // the summit, and west along the ridge
      [590, 1890, 184], [470, 1940, 192], [340, 1920, 196], [210, 1950, 198], [80, 1915, 196], [-40, 1930, 192],
      // off the ridge and down: the Himmelssprung is on the straight
      // (dead straight from the last bend to the junction: a car in the air cannot steer)
      [-170, 1890, 184], [-250, 1832, 176], [-300, 1760, 166], [-317, 1657, 154], [-338, 1528, 138], [-360, 1400, 122], [-375, 1307, 111]],
    jumps: [[0.2, 0.08], [0.83, 0.26]],
    corners: { 0.07: 'Schneeweg', 0.15: 'Schneekehre 1', 0.2: 'Schneekehre 2', 0.25: 'Schneekehre 3', 0.3: 'Schneekehre 4', 0.4: 'Heiligenpass', 0.5: 'Heiligenpass', 0.62: 'Gratkurve', 0.72: 'Gratkurve' } },

  // ---- the west ---------------------------------------------------------------------
  abstieg: { from: 'ABSTIEG', to: 'WEST', kind: 'road', name: 'Abstieg', w: 5.2, run: 5,
    pts: [[-398, 1140, 94], [-450, 1040, 84], [-520, 960, 76], [-520, 870, 68],
      // the Horquilla de Granada: in from the north-east, round to the left, out to the east
      [-560, 790, 61], [-610, 738, 56], [-656, 706, 52], [-700, 697, 49], [-719, 686, 48], [-722, 675, 47],
      [-719, 664, 46], [-700, 653, 45], [-650, 650, 42], [-560, 640, 37], [-480, 602, 31], [-435, 540, 25], [-420, 472, 19]],
    corners: { 0.2: 'Sennerei', 0.5: 'Horquilla de Granada', 0.55: 'Horquilla de Granada', 0.85: 'Letzte' } },

  // ---- the arena ----------------------------------------------------------------------
  // The rallycross infield: off the Hauptstrasse to the left, round the back of
  // the paddock on gravel, and up to the Talstrasse.
  infield: { from: 'ARENA', to: 'RX', kind: 'arena', name: 'Arena',
    pts: [[330, 22, 0], [372, 90, 2], [340, 170, 4], [250, 205, 6], [150, 180, 7], [60, 215, 9], [-30, 290, 11],
      [-60, 370, 13], [-120, 425, 15]],
    jumps: [[0.55, 0.12]], corners: { 0.14: 'Paddock', 0.5: 'Tabletop', 0.8: 'Hufeisen' } },
  // The joker: the long way round the outside of the Steilwand, on gravel.
  joker: { from: 'JOKER', to: 'START', kind: 'arena', name: 'Joker',
    pts: [[-520, 290, 11], [-600, 230, 9], [-640, 140, 6], [-610, 40, 3], [-530, -30, 1], [-430, -44, 0], [-350, -18, 0]],
    corners: { 0.4: 'Joker' } },
};

// The routes: every lap the network allows (fourteen). A route is the segments
// of one lap, in order, from START. The menu's picker (home.html) turns a
// choice at each junction into one of these keys.
const VALLEY_IN = ['hauptstrasse1', 'hauptstrasse2'];
const HOME = ['steilwand1', 'steilwand2'], HOME_J = ['steilwand1', 'joker'];
const lay = (key, name, tag, segs) => [
  { key: 'heil' + key, name: `Heiligen ${name}`, tag, segs: [...VALLEY_IN, ...segs, ...HOME] },
  { key: 'heil' + key + 'j', name: `Heiligen ${name} Joker`, tag: tag + ' · JOKER', segs: [...VALLEY_IN, ...segs, ...HOME_J] },
];
export const ROUTES = [
  ...lay('grand', 'Grand', 'TOWN · FOREST · THE PASS', ['altstadt', 'ostkurve', 'waldaufstieg', 'passstrasse', 'abstieg']),
  ...lay('schnee', 'Schnee', 'THE PASS, NO TOWN', ['stadtring', 'ostkurve', 'waldaufstieg', 'passstrasse', 'abstieg']),
  ...lay('wald', 'Wald', 'TOWN AND FOREST', ['altstadt', 'ostkurve', 'waldaufstieg', 'waldweg', 'abstieg']),
  ...lay('forst', 'Forst', 'THE FOREST STAGE', ['stadtring', 'ostkurve', 'waldaufstieg', 'waldweg', 'abstieg']),
  ...lay('stadt', 'Stadt', 'TOWN AND VALLEY', ['altstadt', 'ostkurve', 'talstrasse1', 'talstrasse2']),
  ...lay('sprint', 'Sprint', 'THE VALLEY, ALL TARMAC', ['stadtring', 'ostkurve', 'talstrasse1', 'talstrasse2']),
  // Rallycross: half the Hauptstrasse, the gravel infield, the end of the
  // Talstrasse and the Steilwand — or the joker.
  { key: 'heilrx', name: 'Heiligen Rallycross', tag: 'TARMAC AND GRAVEL', segs: ['hauptstrasse1', 'infield', 'talstrasse2', ...HOME] },
  { key: 'heilrxj', name: 'Heiligen Rallycross Joker', tag: 'TARMAC AND GRAVEL · JOKER', segs: ['hauptstrasse1', 'infield', 'talstrasse2', ...HOME_J] },
];
