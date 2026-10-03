// ost.js — CWDC's soundtrack. Every circuit gets two songs, one fun and one
// less fun (Adam, 2026-10-02), each in its country's style and shaped by how the
// track drives. One file per circuit in js/ost/, written with js/ostkit.js and
// played by js/music.js. Audition at ost.html. Calendar order.
import { CIRCUIT as c0 } from './ost/monza.js';
import { CIRCUIT as c1 } from './ost/suzuka.js';
import { CIRCUIT as c2 } from './ost/monaco.js';
import { CIRCUIT as c3 } from './ost/zandvoort.js';
import { CIRCUIT as c4 } from './ost/baku.js';
import { CIRCUIT as c5 } from './ost/nurburgring.js';
import { CIRCUIT as c9 } from './ost/sepang.js';
import { CIRCUIT as c6 } from './ost/kate.js';
import { CIRCUIT as c7 } from './ost/street.js';
import { CIRCUIT as c8 } from './ost/adam1.js';

// Adam, 2026-10-03: "swap em" — the fun songs trade circuits: WALLS plays at
// Kate Mascoi and DOWN THE INSIDE on the Street Circuit.
const swapFun = (a, b) => { const fa = a.songs[0]; a.songs = [b.songs[0], a.songs[1]]; b.songs = [fa, b.songs[1]]; };
swapFun(c6, c7);

const CIRCUITS = [c0, c1, c2, c3, c4, c5, c9, c6, c7, c8];
export const SONGS = {};
for (const c of CIRCUITS) for (const s of c.songs) {
  if (SONGS[s.id]) throw new Error('duplicate song id ' + s.id);
  SONGS[s.id] = { ...s, station: c.id };
}
// one "station" per circuit, so the engine's station logic works unchanged
export const STATIONS = CIRCUITS.map(c => ({ id: c.id, name: c.name, tag: c.tag, color: c.color, songs: c.songs.map(s => s.id) }));
