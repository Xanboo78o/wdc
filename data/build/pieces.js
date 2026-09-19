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

  // "add nurburhing t4-9"
  // Lifted off the Nürburgring GP centreline with tools/steal.mjs (corners
  // counted from the start line, so the numbers can differ from the official
  // map by one or two): the stretch with the big left hairpin and the S after
  // it. Angles and the order are the real ones; each corner's radius is set so
  // the piece is as long as the real corner.
  // -10 m here on purpose: it drops the hairpin into a bowl so the esses exit
  // crosses OVER this section with 10 m to spare instead of through it (the
  // gate caught 3.1 m). That crossover is Suzuka's trick, and it is free here.
  { part: 'Nürburgring hairpins', kind: 'turn', dir: 'left', angle: 126, radius: 55, climb: -10, note: 'ring 1 — long left, diving into the hairpin bowl' },
  { kind: 'straight', length: 34 },
  { kind: 'turn', dir: 'left', angle: 7, radius: 224, note: 'ring 2 — kink' },
  { kind: 'straight', length: 6 },
  { kind: 'turn', dir: 'left', angle: 165, radius: 43, climb: 2, note: 'ring 3 — the hairpin (Dunlop), starts climbing back' },
  { kind: 'straight', length: 4 },
  { kind: 'turn', dir: 'right', angle: 97, radius: 35, climb: 3, note: 'ring 4 — tight right out of the hairpin' },
  { kind: 'straight', length: 188, climb: 6 },
  { kind: 'turn', dir: 'right', angle: 6, radius: 248, note: 'ring 5 — kink' },
  { kind: 'straight', length: 158, climb: 5 },
  { kind: 'turn', dir: 'left', angle: 82, radius: 60, climb: 3, note: 'ring 6 — long left onto the tunnel road' },

  // "into monaco tunnel"
  // Monaco's tunnel curve, off the surveyed Monaco centreline (s 1480-1880):
  // the long right-hander that runs under the hill out of Portier. Walls close
  // in (run 2 m), and `tunnel: true` puts the hill ON TOP of the road.
  { part: 'Monaco tunnel', kind: 'straight', length: 60, run: 2.5, climb: 1, note: 'portal — walls close in' },
  { kind: 'straight', length: 40, tunnel: true, note: 'into the dark' },
  { kind: 'turn', dir: 'right', angle: 27, radius: 199, climb: 2, note: 'tunnel 1 — the long right' },
  { kind: 'straight', length: 24 },
  { kind: 'turn', dir: 'right', angle: 20, radius: 147, climb: 1, note: 'tunnel 2 — it tightens' },
  { kind: 'straight', length: 62 },
  { kind: 'turn', dir: 'right', angle: 10, radius: 288, note: 'tunnel 3 — opening out' },
  { kind: 'straight', length: 80, note: 'out into the light' },
  { kind: 'straight', length: 60, tunnel: false, run: 12, climb: -1, note: 'portal — daylight' },

  // "into the cars 2 double loop that goes up"
  // Two full circles, climbing 15 m each, so the road crosses over itself
  // twice and comes out 30 m higher pointing the same way it went in.
  { part: 'The double loop', kind: 'straight', length: 90, note: 'run up to the loop' },
  { kind: 'turn', dir: 'left', angle: 720, radius: 38, climb: 30, bank: 8, note: 'the double loop — 2 full circles, +30 m, banked' },
  { kind: 'straight', length: 120, note: 'out of the top' },
];
