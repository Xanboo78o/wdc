// THE TRACK — one piece per line, in the order you drive them.
// Built with Adam one turn and one straight at a time, starting 2026-09-19.
// `note` is what he asked for, in his words, so the design keeps its reasons.
//
//   { kind: 'straight', length: 700, climb: 0 }
//   { kind: 'turn', dir: 'right', angle: 90, radius: 60, climb: 0, bank: 0 }
//
//   length  metres               climb   metres up (negative = down) over the piece
//   angle   degrees of turn      radius  metres at the tightest point (the apex)
//   bank    degrees, outside edge raised
// Optional on any piece, carrying on until changed:
//   width   full road width, m (starts at 14)
//   run     m from the road edge to the barrier each side (starts at 12)
//   runL / runR   the same, one side only
//   part    a name, on the first piece of a new section — Enter drives from there

export const TRACK = { name: 'UNTITLED' };

export const PIECES = [
  { kind: 'straight', length: 700, climb: 0, note: 'start / finish straight (placeholder, change it any time)' },

  // "suzuka downhill esses, remember, make the terrain go wit it"
  // Suzuka's real S Curves (T3-T7), measured off the surveyed centreline in
  // data/tracks/suzuka.json: same directions, same angles, same gaps, radii set
  // so each corner is as long as the real one. The real esses CLIMB about 32 m;
  // these fall 34.5 m instead.
  { part: 'Downhill esses', kind: 'turn', dir: 'left', angle: 55, radius: 72, climb: -4.5, note: 'esses 1 (Suzuka T3), over the brow and down' },
  { kind: 'straight', length: 6, climb: -0.5 },
  { kind: 'turn', dir: 'right', angle: 75, radius: 59, climb: -5, note: 'esses 2 (Suzuka T4)' },
  { kind: 'straight', length: 32, climb: -1.5 },
  { kind: 'turn', dir: 'left', angle: 75, radius: 74, climb: -6.5, note: 'esses 3 (Suzuka T5)' },
  { kind: 'straight', length: 10, climb: -0.5 },
  { kind: 'turn', dir: 'right', angle: 109, radius: 76, climb: -8.5, note: 'esses 4 (Suzuka T6, the reverse curve)' },
  { kind: 'straight', length: 34, climb: -1.5 },
  { kind: 'turn', dir: 'left', angle: 82, radius: 66, climb: -6, note: 'esses 5 (Suzuka T7, into Dunlop)' },
];
