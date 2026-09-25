// bank.js — the shape of a banked corner, for the renderer only.
//
// Zandvoort banks 18 degrees at Tarzanbocht and again at Arie Luyendyk. The
// physics has always used it; the renderer drew both flat, so the car went
// round a wall of camber it could feel and not see.
//
// It could not be drawn before because `track.bank` was baked as a hard
// 0 -> 18 -> 0 step with no transition, and drawing that directly puts a 3.6 m
// vertical cliff at each end of the banked section. It has a smoothstep taper
// now (biggest step between adjacent samples is 1.42 degrees, down from 18),
// which is what makes this file possible.
//
// ---------------------------------------------------------------------------
// TWO DECISIONS THAT MATTER
//
// 1. It pivots at the INSIDE EDGE of the road, not at the centreline.
//    Rotating about the centreline is the obvious thing and it is wrong: at
//    18 degrees over an 11 m half-width it drops the inside of the corner 3.6 m
//    BELOW the surrounding ground, so the banking digs a trench through the
//    dunes. Real banking is built UP. Pivoting at the inside edge keeps the
//    whole racing surface at or above grade.
//
// 2. The camber falls back to ZERO across the outer run-off.
//    Carrying the full angle all the way out to the barrier would raise the
//    outer edge 7 m and turn the corner into a bowl with a guard rail balanced
//    on its rim. Falling back to grade across the run-off is both what the
//    circuit actually does and what keeps every barrier, hoarding, tyre wall
//    and marshal post in furniture.js at ground level, unchanged.
//
// This is a VISUAL model. The simulation is 2D and has no elevation; it reads
// `track.bank[i]` as a force and nothing here feeds back into it. If the two
// ever disagree, this file is the one that is lying.
// ---------------------------------------------------------------------------

/**
 * Per-sample signed tangent of the bank angle: positive means the surface
 * rises toward the car's RIGHT.
 *
 * The direction comes from the sign of the curvature summed over each
 * contiguous banked RUN, not from the curvature at each sample. Per-sample
 * curvature is noisy, and near the ends of the taper — which is exactly where
 * the bank is shallowest and the geometry most visible — it can flip sign from
 * one 2 m sample to the next. That would put a fold down the middle of the
 * corner.
 */
export function bankTable(track) {
  const n = track.n;
  const t = new Float32Array(n);
  let i = 0;
  while (i < n) {
    if (!track.bank[i]) { i++; continue; }
    let j = i;
    let curvSum = 0;
    while (j < n && track.bank[j]) { curvSum += track.curv[j]; j++; }
    // A left-hander (curvature positive, headings increasing) is banked with
    // its outside — and therefore its high side — on the car's RIGHT.
    const s = curvSum >= 0 ? 1 : -1;
    for (let k = i; k < j; k++) t[k] = s * Math.tan(track.bank[k] * Math.PI / 180);
    i = j;
  }
  return t;
}

/**
 * Height of the racing surface at lateral offset `lat` on sample `i`.
 *
 * Zero at the inside road edge, rising at the true angle across the road, then
 * falling linearly back to zero across the outer run-off. Everything outside
 * that is at grade.
 */
export function bankY(table, track, i, lat) {
  const k = table[i];
  if (!k) return 0;
  const s = k > 0 ? 1 : -1;       // +1 when the high side is the car's right
  const w = track.w[i];
  // `u` measures toward the INSIDE of the corner, so the inside road edge is
  // always at +w whichever way the corner goes. For a left-hander (s = +1) the
  // inside is the car's left, which is +lat; for a right-hander both flip.
  const u = s * lat;
  if (u >= w) return 0;
  const rise = Math.abs(k);
  if (u >= -w) return (w - u) * rise;
  // Past the outer edge of the road, fall back to grade across the run-off on
  // THAT side — the right-hand run-off for a left-hander. Smoothstep rather
  // than linear: the top of this embankment is the bit you can see from the
  // road, and a linear ramp puts a hard crease along the outside of the corner
  // exactly where the eye is.
  //
  // The fall is at least an EMBANKMENT's length, not just the run-off's. At
  // Zandvoort's 18 degrees over 12 m the outer edge is 3.9 m up and its run-off
  // can take that. Adam's street circuit put 18 degrees on a 30 m road with a
  // metre of run-off: a 9.7 m cliff down to a wall left standing at grade, and
  // the whole corner read as terrain clipping. Real banking is built on a bank
  // of earth, so the ground falls away at a slope a bank can stand at, and
  // everything past the edge — run-off, barrier, grass — stands on that same
  // bank (World.groundY adds `bankGround` below).
  const runOut = (s > 0 ? track.runR[i] : track.runL[i]) || 1;
  const fall = Math.max(runOut, 2 * w * rise / EMBANK);
  const f = (u + w + fall) / fall;
  if (f <= 0) return 0;
  return 2 * w * rise * (f * f * (3 - 2 * f));
}

// The steepest an earth bank is allowed to fall, rise over run (about 17 deg;
// 0.4 measured 96% at the steepest point of the smoothstep).
const EMBANK = 0.3;

/**
 * How far the GROUND is raised by banking at this point: the embankment
 * beyond the barrier on the high side of a banked corner, nothing anywhere
 * else. (Following the camber under the road was tried and measured worse:
 * the grass grid's chords came up through the tarmac, 222 -> 657 points at
 * Zandvoort.)
 */
export function bankGround(table, track, i, lat) {
  const k = table[i];
  if (!k) return 0;
  // Only PAST THE BARRIER. Between the road edge and the barrier the run-off
  // mesh is the surface you see and the grass underneath is covered; raising
  // it there too let the grass grid's chords up through the road at
  // Zandvoort (222 -> 594 points). Past the barrier the grass IS the surface,
  // and it has to carry on down the embankment from where the run-off ends.
  const w = track.w[i], s = k > 0 ? 1 : -1, u = s * lat;
  const runOut = (s > 0 ? track.runR[i] : track.runL[i]) || 1;
  // Half a metre inside, because the barrier stands EXACTLY on that line and
  // rounding put some of it on the wrong side — a wall 9.9 m below the end of
  // the run-off it was meant to be standing on.
  return u <= -(w + runOut) + 0.5 ? bankY(table, track, i, lat) : 0;
}

/**
 * How far the car leans, in radians about its own longitudinal axis, standing
 * on the surface at that point. Positive tips the top of the car toward its
 * right, so a surface whose high side is the right leans the car LEFT.
 */
export function bankRoll(table, track, i, lat) {
  const k = table[i];
  if (!k) return 0;
  const w = track.w[i];
  const s = k > 0 ? 1 : -1;
  const u = s * lat;
  // Off the banked shelf — on the inside apron or out in the run-off — the car
  // is level. Only the road itself carries the full angle. Blended over the
  // last metre either side, because a car straddling the white line should not
  // snap 18 degrees the instant a wheel crosses it.
  const edge = Math.min(w - u, u + w);
  if (edge <= 0) return 0;
  const blend = Math.min(1, edge);
  return -s * Math.atan(Math.abs(k)) * blend;
}
