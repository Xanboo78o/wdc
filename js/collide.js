// collide.js — rigid-body contact. Deterministic: same approach, same crash.
//
// The version this replaces treated the car as a POINT. It projected the
// centre of the car onto the track and clamped that to the barrier line, so
// the instant the centre reached the wall half the bodywork was already inside
// it — you could sit literally half in and half out of a barrier. And a
// position clamp is not a collision: nothing conserved, no rotation, so it read
// as an animation rather than an impact.
//
// A car is a rectangle. Its CORNERS hit things. Resolving at the corner is what
// makes a front-left impact spin the car left, a rear clip snap the back round,
// and a glancing blow scrub along the wall instead of sticking to it. All of
// that falls out of one contact impulse; none of it is scripted.
//
// Pure: no renderer, no DOM.

// Restitution by barrier type. Concrete gives more back than a gravel-backed
// steel barrier, which is built to absorb.
const BOUNCE = { wall: 0.34, barrier: 0.24, gravel: 0.20 };
const WALL_MU = 0.55;          // scrub along the face

// The four corners of the bodywork, in world space.
export function corners(car) {
  const S = car.spec;
  const hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
  const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  const out = [];
  for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]) {
    out.push({ x: car.x + lx * cs - ly * sn, y: car.y + lx * sn + ly * cs, lx, ly });
  }
  return out;
}

// Which part of the car took the hit, so the damage lands where it should.
function region(lx, ly, S) {
  if (lx > S.bodyL * 0.25) return 'front';
  if (lx < -S.bodyL * 0.25) return 'rear';
  return ly > 0 ? 'left' : 'right';
}

// Resolve the car against the track barriers. Returns a contact report, or null
// if nothing touched. Call it every substep, AFTER the physics step.
export function resolveBarrier(car, track, hint = null) {
  const S = car.spec;

  // Find the deepest penetrating corner. Testing every corner is the whole
  // point: the deepest one is the one actually in the wall, and where it sits
  // on the body decides how the car rotates out of the impact.
  let worst = null;
  for (const c of corners(car)) {
    const p = track.project(c.x, c.y, hint);
    const limit = p.w + p.run;
    const depth = Math.abs(p.lat) - limit;
    if (depth > 0 && (!worst || depth > worst.depth)) {
      worst = { depth, sgn: Math.sign(p.lat) || 1, hdg: p.hdg, cx: c.x, cy: c.y, lx: c.lx, ly: c.ly };
    }
  }
  if (!worst) { car.wallTouch = false; return null; }

  // Contact normal points back INTO the track. The track's left-hand normal is
  // (-sin h, cos h), so the push-off direction is that, signed by which side
  // the car left from.
  const nx = worst.sgn * Math.sin(worst.hdg);
  const ny = -worst.sgn * Math.cos(worst.hdg);

  // 1. Positional correction — put the bodywork back outside the barrier.
  //    This is what stops you standing half inside a wall.
  car.x += nx * worst.depth;
  car.y += ny * worst.depth;

  // 2. Contact impulse. Lever arm from the centre of mass to the contact
  //    corner; this term is why the car rotates about the impact.
  const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  const rx = worst.lx * cs - worst.ly * sn;
  const ry = worst.lx * sn + worst.ly * cs;

  let vwx = car.vx * cs - car.vy * sn;
  let vwy = car.vx * sn + car.vy * cs;
  let w = car.r;

  // velocity of the contact point, not of the car: v + omega x r
  const vpx = vwx - w * ry, vpy = vwy + w * rx;
  const vn = vpx * nx + vpy * ny;

  const hit = { depth: worst.depth, closing: -vn, part: region(worst.lx, worst.ly, S), j: 0 };

  if (vn < 0) {                                   // only if actually closing
    const e = BOUNCE[track.wall] ?? BOUNCE.barrier;
    const rn = rx * ny - ry * nx;                 // r cross n, 2D scalar
    const inv = 1 / S.m + (rn * rn) / S.Izz;
    const j = -(1 + e) * vn / inv;

    vwx += (j / S.m) * nx;
    vwy += (j / S.m) * ny;
    w += (rx * (j * ny) - ry * (j * nx)) / S.Izz;

    // Coulomb friction along the barrier face — this is what turns a glancing
    // blow into a scrub down the wall instead of a bounce straight back out.
    const tx = -ny, ty = nx;
    const vt = (vwx - w * ry) * tx + (vwy + w * rx) * ty;
    const rt = rx * ty - ry * tx;
    const invT = 1 / S.m + (rt * rt) / S.Izz;
    let jt = -vt / invT;
    const cap = WALL_MU * Math.abs(j);
    jt = Math.max(-cap, Math.min(cap, jt));
    vwx += (jt / S.m) * tx;
    vwy += (jt / S.m) * ty;
    w += (rx * (jt * ty) - ry * (jt * tx)) / S.Izz;

    hit.j = j;

    // 3. Damage, from the normal impulse. A specific impulse (impulse per unit
    //    mass) is the honest measure — it is the velocity the impact actually
    //    took out of the car, so a heavy car is not automatically tougher.
    const dv = Math.abs(j) / S.m;
    if (dv > 1.2) {
      const harm = Math.min(0.6, (dv - 1.2) / 26);
      car.damage = Math.min(1, (car.damage || 0) + harm);
      car.crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
      car.crush[hit.part] = Math.min(1, car.crush[hit.part] + harm * 1.7);
      hit.harm = harm;
    }
  }

  car.vx = vwx * cs + vwy * sn;
  car.vy = -vwx * sn + vwy * cs;
  car.r = w;
  car.wallTouch = true;
  return hit;
}
