// tracks.js — the circuits on the menu: [id, name, tag]. Shared by the game's
// own menu (js/main.js) and the home page (js/home.js) so the two cannot drift.
export const TRACKS = [
  // The hand-built one, baked out of data/build/pieces.js by
  // tools/baketrack.mjs. It is first because it is the one being worked on,
  // and because reaching it through the MENU is the only way to see the phone
  // wheel's pairing code — ?auto=test:f1 skips the menu, which is why the
  // phone would not connect to it.
  ['test', 'The test map', 'HAND-BUILT'],
  ['kate', 'Kate Mascoi Circuit', 'WIDE · FAST · BATTLES'],
  // Adam's own, modelled outside this project and read in by
  // tools/importtrack.mjs. Both carry real elevation in `z`, which nothing on
  // this side reads yet — so they drive flat for now, and that is the next
  // thing they want.
  ['street', 'Street Circuit', "ADAM'S OWN"],
  ['adam1', "Adam's first track", "ADAM'S OWN"],
  ['monza', 'Monza', 'ITALY'],
  ['zandvoort', 'Zandvoort', 'NETHERLANDS'],
  ['suzuka', 'Suzuka', 'JAPAN'],
  ['baku', 'Baku', 'AZERBAIJAN'],
  ['monaco', 'Monaco', 'MONACO'],
  ['nurburgring', 'Nürburgring', 'GERMANY'],
  ['sepang', 'Sepang', 'MALAYSIA'],
];
