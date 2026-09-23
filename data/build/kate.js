// KATE MASCOI CIRCUIT — hand-authored, piece by piece, 2026-09-23.
//
// Adam: "add a new super wide track where i can go crazy for clips, and make
// it super good for battles and speed, i really want speed feeling in ts,
// call it.... Kate Mascoi Circuit".
//
// So every piece has one of three jobs, and says which:
//   BATTLE  40 m of road (a normal circuit is 12-15). It was 26; Adam:
//           "wider, i wanna recreate that race where they ended 3 wide and
//           still had room to spare". Three cars side by side take ~9 m with
//           gaps; 40 m is three wide with a car's width of air either side.
//           Heavy braking at the end of long straights so there is always a
//           pass on, and corners with more than one line.
//   CLIPS   huge run-off where the big moments happen (35 m at the hairpin,
//           30 m at Last Chance): room to go in too deep, spin, and live.
//   SPEED   the walls pulled in to 2.5-5 m where it is fastest. Speed is felt
//           from how close things go past, not from the number — a wall three
//           metres away at 300 km/h is the feeling he asked for.
//
// The loop is closed by SOLVING the three straights marked "solved": the
// Top Straight sets north-south, the run onto the start straight and the
// straight after the hairpin together set east-west AND make the lap an exact
// 2450 x 2 m (closed to 0.1 mm). Everything else is chosen. Baked with
//   node tools/baketrack.mjs kate --pieces=data/build/kate.js
// Same format as data/build/pieces.js.

export const TRACK = {
  name: 'Kate Mascoi Circuit',
  full: 'Kate Mascoi Circuit',
  country: 'XANBOO78O',
  closed: true,
};

export const PIECES = [
  { part: 'Start', kind: 'straight', length: 1000, width: 40, run: 14,
    note: 'BATTLE/SPEED — 1 km, and the run out of Last Chance adds 419 m more: 1.4 km of slipstream' },

  { part: 'Mascoi Hairpin', kind: 'turn', dir: 'right', angle: 180, radius: 45, run: 35,
    note: 'BATTLE/CLIPS — the heaviest stop on the lap, 40 m wide so there is an inside, an outside and a switchback; 35 m of run-off for when you send it' },
  { kind: 'straight', length: 200.6974, run: 14,
    note: 'solved — sets where the lap lands on the 2 m sample grid' },

  { part: 'The Switchback', kind: 'turn', dir: 'left', angle: 90, radius: 100,
    note: 'BATTLE — whoever took the hairpin outside has the inside here' },
  { kind: 'straight', length: 60 },
  { kind: 'turn', dir: 'right', angle: 40, radius: 95 },

  { part: "Kate's Drop", kind: 'straight', length: 1000, climb: -18, run: 3,
    note: 'SPEED — a kilometre downhill between walls 3 m off the road' },

  { part: 'The Bowl', kind: 'turn', dir: 'right', angle: 140, radius: 230, bank: 14, run: 5,
    note: 'SPEED/BATTLE — banked 14 degrees, fast enough to take three wide' },
  { kind: 'straight', length: 200 },

  { part: 'The Whip', kind: 'turn', dir: 'left', angle: 15, radius: 450, run: 2.5,
    note: 'SPEED — flat-out flick with the walls 2.5 m away' },
  { kind: 'straight', length: 30 },
  { kind: 'turn', dir: 'right', angle: 15, radius: 450 },

  { part: 'Top Straight', kind: 'straight', length: 304.2872, climb: 18, run: 6,
    note: 'solved — climbs the 18 m back up' },

  { part: 'Last Chance', kind: 'turn', dir: 'right', angle: 90, radius: 70, run: 30,
    note: 'BATTLE/CLIPS — last braking zone before the line, 30 m of run-off' },
  { kind: 'straight', length: 419.1994, run: 14,
    note: 'solved — onto the start straight' },
];
