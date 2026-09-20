// piers.js — where a viaduct's deck runs and where its supports stand.
//
// This lives apart from dressing.js for one reason: dressing.js imports three,
// and tools/buildcheck.mjs cannot. A pier that lands on the road underneath is
// exactly the defect a bridge exists to prevent, so the gate has to be able to
// see the sites — which means the siting cannot live in the renderer. Same law
// as physics.js: the thing that decides is pure, the thing that draws is not.
//
// Two kinds of deck:
//   AUTHORED    a piece marked `bridge: true` — a bridge somebody asked for.
//               Deeper structure, parapets, supports further apart.
//   INCIDENTAL  anywhere the land simply fell away under the road, which is
//               how the double loop got its supports without being asked.
import { pointAt } from './path.js';

export const PIER = {
  DROP: 1.0,        // m of air under the deck before it needs a skirt at all
  DECK: 0.9,        // m of structure under an incidental deck
  BIG: 2.4,         // m under an authored bridge — a real box girder
  PARAPET: 1.0,     // m of concrete along an authored deck's edge
  CLEAR: 4,         // m a pier's footing keeps clear of any other road
  MIN_H: 2.5,       // m — shorter than this and it is a plinth, not a pier
  SPAN_AUTH: 32,    // m between supports on an authored bridge
  SPAN_AUTO: 14,    // m between them under an incidental deck
};

export const onBridge = (path, i) => !!(path.briIn && path.briIn[i] > 0);

/** How far the deck is above the land at sample i, at its worse edge. */
export function gapAt(path, ground, i) {
  const l = pointAt(path, i, path.w[i]), r = pointAt(path, i, -path.w[i]);
  return Math.min(l.z - ground.height(l.x, l.y), r.z - ground.height(r.x, r.y));
}

/** Continuous stretches of road that stand on a structure. */
export function deckRuns(path, ground) {
  const runs = [];
  for (let i = 0; i < path.n; i++) {
    if (path.tunIn && path.tunIn[i] > 0) continue;
    const auth = onBridge(path, i);
    if (!auth && gapAt(path, ground, i) < PIER.DROP) continue;
    const last = runs[runs.length - 1];
    if (last && i - last.i1 <= 3) { last.i1 = i; last.auth = last.auth || auth; }
    else runs.push({ i0: i, i1: i, auth });
  }
  return runs.filter(r => r.i1 - r.i0 >= 2);
}

/**
 * Is a support at (x, y), standing from `gc` up to `top`, in the way of some
 * other road? Returns that road's sample index, or -1.
 *
 * A road only conflicts if it passes through the pier's OWN height range. The
 * carriageway thirty metres below the valley floor the pier stands on is not
 * in the way, and neither is the bridge's own deck directly overhead — which
 * is why this is a height range and not a plan-view distance.
 */
export function pierBlockedBy(path, x, y, gc, top) {
  for (let j = 0; j < path.n; j++) {
    const z = path.z[j];
    if (z < gc - 2 || z > top - 1.5) continue;
    const d = Math.hypot(path.x[j] - x, path.y[j] - y);
    if (d < path.w[j] + Math.max(path.runL[j], path.runR[j]) + PIER.CLEAR) return j;
  }
  return -1;
}

/**
 * Every support under the track, sited. Skipping one leaves a longer span,
 * which is what a real bridge does over the thing it is crossing.
 */
export function pierSites(path, ground) {
  const out = [];
  for (const r of deckRuns(path, ground)) {
    const deep = r.auth ? PIER.BIG : PIER.DECK;
    const every = Math.round((r.auth ? PIER.SPAN_AUTH : PIER.SPAN_AUTO) / path.ds);
    const i0 = Math.max(0, r.i0 - 2), i1 = Math.min(path.n - 1, r.i1 + 2);
    for (let i = i0; i <= i1; i++) {
      if (i % every !== 0) continue;
      const c = pointAt(path, i, 0), gc = ground.height(c.x, c.y);
      const top = c.z - deep, h = top - gc;
      if (h <= PIER.MIN_H) continue;
      const hit = pierBlockedBy(path, c.x, c.y, gc, top);
      if (hit >= 0) { out.push({ i, x: c.x, y: c.y, gc, h, top, hdg: path.hdg[i], wide: path.w[i], auth: r.auth, skipped: hit }); continue; }
      out.push({ i, x: c.x, y: c.y, gc, h, top, hdg: path.hdg[i], wide: path.w[i], auth: r.auth, skipped: -1 });
    }
  }
  return out;
}

/** The footprint of a pier, as a rotated box: half-extents along/across it. */
export function pierBox(p) {
  return { along: (p.auth ? 3.4 : 2.2) / 2, across: Math.min(p.auth ? 9 : 7, p.wide * (p.auth ? 0.8 : 0.55)) / 2 };
}
