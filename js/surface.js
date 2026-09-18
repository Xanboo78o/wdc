// surface.js — what the circuit is made of, per metre.
//
// Baked by tools/baksurf.mjs from corner geometry and run-off width; this is
// just the accessor. See that file for the rules and for what is deliberately
// NOT in it.
//
// The point of having it as data rather than as conditionals inside the
// geometry builders is that the rules end up in one readable place. Before
// this, the renderer had ONE run-off material for a whole circuit — so Monza
// had a gravel trap running the full length of the main straight, where in
// life there is mown grass and the gravel only appears where a car leaving the
// road would actually land.
export const RUN = { GRAVEL: 0, ASPHALT: 1, GRASS: 2, CONCRETE: 3 };
export const KERB = { NONE: 0, FLAT: 1, STANDARD: 2, HIGH: 3 };

// Kerb geometry by type. A hairpin kerb and a fast-corner kerb are not the
// same object: one is there to punish you and one is there to be used.
export const KERB_SHAPE = {
  1: { h: 0.030, w: 0.78, block: 3.1 },   // flat — a sweeper, two wheels on it every lap
  2: { h: 0.058, w: 0.62, block: 2.6 },   // standard
  3: { h: 0.095, w: 0.52, block: 2.0 },   // high — a hairpin, aggressive
};

export async function loadSurface(key) {
  try {
    const r = await fetch(`./data/surf/${key}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * A fallback that matches what the renderer used to do, so a fresh clone that
 * has not run tools/baksurf.mjs still draws a circuit.
 */
export function defaultSurface(track) {
  const n = track.n;
  const run = track.wall === 'gravel' ? RUN.GRAVEL : RUN.ASPHALT;
  const fill = v => { const a = new Uint8Array(n); a.fill(v); return a; };
  const kerb = new Uint8Array(n);
  for (const c of track.corners || []) {
    for (let s = c.s0; s <= c.s1; s += track.ds) kerb[track.idx(s)] = KERB.STANDARD;
  }
  return { runL: fill(run), runR: fill(run), kerb, turf: new Uint8Array(n) };
}
