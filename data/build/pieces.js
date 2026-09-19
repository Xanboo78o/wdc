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

export const TRACK = { name: 'UNTITLED' };

export const PIECES = [
  { kind: 'straight', length: 700, climb: 0, note: 'start / finish straight (placeholder, change it any time)' },
];
