// aero.js — the aerodynamics, as one system.
//
// NOTHING IN THIS FILE MAY IMPORT A RENDERER. Same law as physics.js: it runs
// unchanged in the browser, in a Node harness, and later in a native shell.
// It does not even do its own I/O — the caller hands it a parsed map, so it is
// a pure function of numbers and can be tested without a filesystem.
//
// WHAT CHANGED AND WHY. Aero used to be four constants per car (ClA, CdA,
// aeroBal, plus a dirty-air scalar). Constants cannot know:
//
//   - that downforce collapses when the floor is lifted off the road,
//   - that a car at twenty degrees of sideslip has lost a third of its
//     downforce and gained sixty percent more drag,
//   - that losing a front wing moves the BALANCE rearward, which is what
//     actually ends your race, rather than just subtracting a number,
//   - that sitting a metre offset behind a car is measurably cleaner air than
//     sitting directly behind it.
//
// All four of those are geometry, and tools/aerobake.mjs solved them offline
// into data/aero/<car>.json. This file interpolates that map. Nothing solves
// at 400 Hz.

// ---------------------------------------------------------------------------
// THE WAKE.
//
// Dirty air and the tow are not two effects that happen to coexist. They are
// one thing seen from two sides: a car's drag IS momentum taken out of the air,
// and that air is left behind it moving slower than the freestream. A follower
// sitting in it finds less dynamic pressure, which costs it drag (the tow it
// wants) and costs it downforce (the dirty air it does not).
//
// The variable the old two-scalar version barely used is LATERAL OFFSET, and
// it is the one that decides races. Directly behind is the dirtiest air there
// is; a metre to one side is measurably cleaner. That is why a driver offsets
// going down a straight, and until now the simulation gave no reason to.
// ---------------------------------------------------------------------------
const SPREAD = 0.085;     // how fast the wake fans out behind the car
const REACH = 22.0;       // metres over which the deficit decays by half-ish
const TOW_MAX = 0.44;     // most of the drag a perfect tow can remove
const TURB_F = 0.52;      // front downforce lost in the worst air
const TURB_R = 0.16;      // the rear loses far less — that is the whole problem

/**
 * Sample the wake of `lead` at the position of `follow`, writing into `out`.
 * Allocation-free and called for every ordered pair in the field, so it stays
 * arithmetic — no objects, no closures, no Math.hypot chains that can be
 * avoided.
 *
 * Returns false and zeroes `out` when the follower is not in the wake at all,
 * which is the common case and the one worth being fast.
 */
export function sampleWake(out, lead, follow) {
  // Position of the follower in the LEAD car's frame. The lead car's wake
  // travels with the lead car's heading, not with the track.
  const dx = follow.x - lead.x, dy = follow.y - lead.y;
  const cs = Math.cos(lead.hdg), sn = Math.sin(lead.hdg);
  const ahead = -(dx * cs + dy * sn);          // metres BEHIND the lead car
  if (ahead <= 0.5 || ahead > 90) { out.dirty = 0; out.tow = 0; return false; }
  const side = Math.abs(-dx * sn + dy * cs);   // lateral offset, metres

  // The wake starts the width of the car and fans out behind it.
  const halfW = lead.spec.bodyW * 0.5 + ahead * SPREAD;
  if (side >= halfW) { out.dirty = 0; out.tow = 0; return false; }
  const t = side / halfW;
  const lat = 1 - t * t;                       // 1 on the centreline, 0 at the edge

  // Momentum deficit decays with distance. Scaled by the lead car's drag area,
  // because drag is literally what put the deficit there — a car with a bigger
  // hole punched in the air leaves a bigger one behind it.
  const strength = lead.spec.CdA / 1.28;
  const decay = 1 / (1 + ahead / REACH) ** 1.5;
  const core = decay * lat * strength;

  out.dirty = core > 1 ? 1 : core;
  out.tow = out.dirty;
  return true;
}

export const newWake = () => ({ dirty: 0, tow: 0 });

/**
 * The same wake, addressed in TRACK space: `gap` metres behind along the
 * centreline, `off` metres of lateral separation. The race layer already has
 * both from its projection, so this costs no trigonometry at all — which
 * matters, because it is called for every ordered pair of a 22-car field at
 * 100 Hz and that loop is already the O(n^2) part of the race.
 *
 * Track space is also the better approximation through a corner: a wake is
 * shed along the path the car actually drove, not along the heading it happens
 * to have at this instant.
 */
export function wakeAt(out, gap, off, leadSpec) {
  if (gap <= 0.5 || gap > 90) { out.dirty = 0; out.tow = 0; return false; }
  const halfW = leadSpec.bodyW * 0.5 + gap * SPREAD;
  const side = off < 0 ? -off : off;
  if (side >= halfW) { out.dirty = 0; out.tow = 0; return false; }
  const t = side / halfW;
  const lat = 1 - t * t;
  const decay = 1 / (1 + gap / REACH) ** 1.5;
  let core = decay * lat * (leadSpec.CdA / 1.28);
  if (core > 1) core = 1;
  out.dirty = core; out.tow = core;
  return true;
}

// How the wake splits between the two axles. The front wing works in ground
// effect inches off the road and is the first thing the turbulence ruins; the
// rear wing is high, in cleaner air, and barely notices. That asymmetry IS the
// reason following is hard: you lose the front first, so you understeer, so
// you cannot stay close enough to use the tow you came for.
export const dirtyFront = d => 1 - TURB_F * d;
export const dirtyRear = d => 1 - TURB_R * d;
export const towDrag = t => 1 - TOW_MAX * t;

// ---------------------------------------------------------------------------
// THE MAP.
// ---------------------------------------------------------------------------
function lerpIdx(axis, v) {
  const n = axis.length;
  if (v <= axis[0]) return [0, 0, 0];
  if (v >= axis[n - 1]) return [n - 1, n - 1, 0];
  let i = 0;
  while (i + 1 < n && axis[i + 1] < v) i++;
  const span = axis[i + 1] - axis[i];
  return [i, i + 1, span > 0 ? (v - axis[i]) / span : 0];
}

export function makeAero(json) {
  const { pitch, yaw, ride, map, frontalArea, ref } = json;
  const NY = yaw.length, NR = ride.length;
  const at = (arr, pi, yi, ri) => arr[(pi * NY + yi) * NR + ri];

  // Trilinear over pitch x yaw x ride height. Eight reads and seven blends,
  // which is cheap enough to do every substep and exact at the grid points —
  // so a level car at reference ride height returns the validated numbers
  // bit-for-bit rather than something near them.
  function lookup(arr, p, y, r) {
    const [p0, p1, pf] = lerpIdx(pitch, p);
    const [y0, y1, yf] = lerpIdx(yaw, y);
    const [r0, r1, rf] = lerpIdx(ride, r);
    const c00 = at(arr, p0, y0, r0) + (at(arr, p0, y0, r1) - at(arr, p0, y0, r0)) * rf;
    const c01 = at(arr, p0, y1, r0) + (at(arr, p0, y1, r1) - at(arr, p0, y1, r0)) * rf;
    const c10 = at(arr, p1, y0, r0) + (at(arr, p1, y0, r1) - at(arr, p1, y0, r0)) * rf;
    const c11 = at(arr, p1, y1, r0) + (at(arr, p1, y1, r1) - at(arr, p1, y1, r0)) * rf;
    const c0 = c00 + (c01 - c00) * yf;
    const c1 = c10 + (c11 - c10) * yf;
    return c0 + (c1 - c0) * pf;
  }

  /**
   * Coefficients for a car in a given state, written into `out`.
   *   out.clA  downforce area        out.cdA  drag area
   *   out.bal  fraction of downforce carried by the FRONT axle
   * Allocation-free: called every substep for every car.
   */
  function coeffs(out, car, pitchDeg, yawDeg, rideH) {
    const L = car.lost;
    let v = 'full';
    // Which variant. Both wings gone is rare enough to approximate by the
    // worse of the two rather than baking a fourth solve nobody will hit.
    if (L && L.frontWing && L.rearWing) v = 'noFrontWing';
    else if (L && L.frontWing) v = 'noFrontWing';
    else if (L && L.rearWing) v = 'noRearWing';
    const m = map[v] || map.full;

    let clA = lookup(m.cl, pitchDeg, yawDeg, rideH);
    let cdA = lookup(m.cd, pitchDeg, yawDeg, rideH);
    const cop = lookup(m.cop, pitchDeg, yawDeg, rideH);

    // Crumpled bodywork is worse bodywork. A dented car has a wake where it
    // used to have a surface: it loses downforce and gains drag, which is the
    // honest reason a damaged car is slower even when nothing is broken off.
    const d = car.dents;
    if (d && d.length) {
      let harm = 0;
      for (let i = 0; i < d.length; i++) harm += d[i].depth;
      harm = harm > 2.2 ? 2.2 : harm;
      clA *= 1 - 0.13 * harm;
      cdA *= 1 + 0.16 * harm;
    }

    out.clA = clA;
    out.cdA = cdA;
    // Centre of pressure in metres ahead of the CG -> the fraction of the
    // downforce the FRONT axle carries. This is the number a driver calls
    // "balance", and it is what moves when a wing goes.
    const S = car.spec;
    const bal = 0.5 + cop / (S.a + S.b);
    out.bal = bal < 0.12 ? 0.12 : bal > 0.88 ? 0.88 : bal;
    return out;
  }

  return { coeffs, lookup, frontalArea, ref, newOut: () => ({ clA: 0, cdA: 0, bal: 0 }) };
}
