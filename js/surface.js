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
// Real sizes (2026-09-28, "make details smaller" — and wider, it turned out:
// the old kerbs were half the width and twice the stripe length of the real
// thing). A modern F1 kerb is 1.0-1.5 m across with stripes of about a metre;
// the stripe length must divide the 2 m sample spacing so it runs unbroken.
export const KERB_SHAPE = {
  1: { h: 0.030, w: 1.30, block: 1.0 },   // flat — a sweeper, two wheels on it every lap
  2: { h: 0.055, w: 1.10, block: 1.0 },   // standard
  3: { h: 0.085, w: 0.95, block: 1.0 },   // high — a hairpin, aggressive
};

// Paint, [stripe, ground] as linear-ready hex. Per circuit, because the kerb
// colours are part of how you know where you are: Monza and Suzuka are red
// and white, Monaco's are a deeper red, the Nürburgring GP loop is
// red-and-white on its newer kerbs, Zandvoort red-and-white. Adam's own
// circuits keep the classic pair until he says otherwise.
export const KERB_PAINT = {
  default: [0xc8262c, 0xeeeeea],
  monza: [0xc9232a, 0xefefeb],
  monaco: [0xb51e25, 0xecebe6],
  suzuka: [0xcc2a2c, 0xf0f0ec],
  zandvoort: [0xcb2b2b, 0xefefea],
  baku: [0xc4252b, 0xeeeeea],
  nurburgring: [0xc6272d, 0xeeeeea],
  sepang: [0xc8262c, 0xeeeeea],
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
