// SEPANG INTERNATIONAL CIRCUIT — the first DLC circuit.
//
// Every piece a viewer recognises Sepang by is made for Sepang alone, to the
// real dimensions, on the surveyed footprints:
//   grandstand.js  the double-sided Main Grandstand under its leaf roofs, and
//                  the other stands (K1, F, the hillstand)
//   paddock.js     the pit and paddock building, race control, the media
//                  centre
//   dressing.js    the start gantry, the flags, the boards and hoardings, the
//                  kerb and run-off paint
// Each part says which shared pieces it replaces; js/dlc.js explains the rest.
import * as grandstand from './grandstand.js';
import * as paddock from './paddock.js';
import * as dressing from './dressing.js';

const PARTS = { grandstand, paddock, dressing };

export const replaces = new Set(Object.values(PARTS).flatMap(p => p.replaces || []));

export function prepareEnv(env, track) {
  for (const [name, p] of Object.entries(PARTS)) {
    try { p.prepareEnv?.(env, track); } catch (e) { console.error(`sepang ${name}.prepareEnv:`, e); }
  }
}

export function build(view, ctx) {
  const stats = {};
  for (const [name, p] of Object.entries(PARTS)) {
    try { stats[name] = p.build?.(view, ctx) ?? null; } catch (e) { console.error(`sepang ${name}:`, e); stats[name] = 'error'; }
  }
  return stats;
}
