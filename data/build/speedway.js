// XINGUS SPEEDWAY — hand-authored, 2026-10-06.
//
// Adam: "in xingus mode add a nascar track tbh itd be fun, solely focused on
// overtakes and pitting ... make it an oval with banked ends ... and on
// straights keep it banked inward ~5 degrees too".
//
// Four pieces, and each has one job:
//   THE STRAIGHTS  700 m, 24 m of road: four cars wide with air between them.
//                  Banked 5 degrees to the inside (bankFloor, below). This is
//                  where the tow is, so this is where the passes start.
//   THE ENDS       180 degrees to the left at 215 m, banked 28. Flat out in
//                  the pack, on any lane — so a pass begun on the straight is
//                  finished side by side round the banking, low or high.
// The wall is 3 m off the top of the road all the way round. The inside is
// open: an apron, then the infield, which is where the pit lane is
// (tools/synthpit.mjs speedway --side L).
//
// Left turns only, so it runs anticlockwise, as they do. Baked with
//   node tools/baketrack.mjs speedway --pieces=data/build/speedway.js
export const TRACK = {
  name: 'Xingus Speedway',
  full: 'Xingus Speedway',
  country: 'XANBOO78O',
  closed: true,
  bankFloor: 5,          // degrees: nowhere on the lap is flatter than this
  lane: 3,               // the groove: 3 m inside the middle, all the way round. 15 m to the wall.
  stock: true,           // stock rules: tyres last a stint, so everybody pits (js/race.js)
};

export const PIECES = [
  { part: 'Front Stretch', kind: 'straight', length: 700.0600, width: 24, runL: 40, runR: 3,
    note: 'the line, the pits on the inside, and the tow' },
  { part: 'Turn One', kind: 'turn', dir: 'left', angle: 180, radius: 215, bank: 28,
    note: 'flat out, low or high' },
  { part: 'Back Stretch', kind: 'straight', length: 700.0600,
    note: 'the second tow of the lap' },
  { part: 'Turn Three', kind: 'turn', dir: 'left', angle: 180, radius: 215, bank: 28,
    note: 'the last place to be alongside before the line' },
];
