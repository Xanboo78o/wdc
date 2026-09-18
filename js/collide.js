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
import { launch, wheelPos } from './physics.js';

const BOUNCE = { wall: 0.34, barrier: 0.24, gravel: 0.20 };
const WALL_MU = 0.55;          // scrub along the face

// How much of a hard impact comes back as a VERTICAL kick. A barrier is not a
// flat vertical plane: there is a kerb in front of it, a lip at its base, and
// in a tyre wall a stack of tyres that gives and then throws the car back. That
// is why cars climb barriers and end up on top of them rather than stopping
// dead at the paint. A tyre wall launches most; bare concrete least.
const LAUNCH = { wall: 0.035, barrier: 0.100, gravel: 0.070 };

// ---------------------------------------------------------------------------
// DENTS.
//
// The four region scalars in car.crush can only ever fold "the front" — every
// front impact makes the same shape, whether you kissed a barrier with the
// right-hand endplate or speared it dead centre. A dent records the impact
// itself, in the car's own coordinates: WHERE it was hit, which way the blow
// went, how deep, and how far the damage spread. Bodywork then deforms where
// it was actually hit.
//
// car.crush is still maintained exactly as before, so nothing that reads it
// has to change and the existing renderer keeps working untouched.
// ---------------------------------------------------------------------------
const MAX_DENTS = 14;

export function addDent(car, lx, ly, nlx, nly, depth, radius) {
  car.dents = car.dents || [];
  // Hitting the same corner twice makes one dent deeper, not two dents. Without
  // this a long scrape down a wall leaves a hundred entries and the bodywork
  // dissolves into noise.
  for (const d of car.dents) {
    if (Math.hypot(d.lx - lx, d.ly - ly) < 0.45) {
      d.depth = Math.min(0.85, d.depth + depth * 0.65);
      d.r = Math.max(d.r, radius);
      d.nx = d.nx * 0.6 + nlx * 0.4; d.ny = d.ny * 0.6 + nly * 0.4;
      return d;
    }
  }
  if (car.dents.length >= MAX_DENTS) {
    // Drop the shallowest, so the ones you can actually see survive.
    let k = 0;
    for (let i = 1; i < car.dents.length; i++) if (car.dents[i].depth < car.dents[k].depth) k = i;
    car.dents.splice(k, 1);
  }
  const d = { lx, ly, nx: nlx, ny: nly, depth: Math.min(0.85, depth), r: radius };
  car.dents.push(d);
  return d;
}

// Turn a world-space impact into a body-local dent, and check whether that was
// the hit that finally took a wing off.
function mark(car, wlx, wly, wnx, wny, harm) {
  const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  // the contact normal, rotated into the car's own frame
  addDent(car, wlx, wly, wnx * cs + wny * sn, -wnx * sn + wny * cs,
          harm * 0.9, 0.55 + harm * 1.1);
  shed(car);
}

// Parts leave the car. A front wing at three-quarters crushed is not a bent
// front wing, it is a front wing lying on the track — and physics.js reads
// car.lost, so losing it changes how the car DRIVES and not just how it looks.
// Losing the front wing is most of the front downforce: the car understeers
// straight on at the next corner, which is the correct punishment.
function shed(car) {
  const c = car.crush;
  if (!c) return;
  if (!car.lost) car.lost = { frontWing: false, rearWing: false };
  if (!car.lost.frontWing && c.front > 0.72) car.lost.frontWing = true;
  if (!car.lost.rearWing && c.rear > 0.72) car.lost.rearWing = true;
}

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

// ---------------------------------------------------------------------------
// CAR TO CAR.
//
// Same solver, two moving bodies. Everything that makes wheel-to-wheel racing
// feel real falls out of resolving at the contact point rather than between two
// centres: a dive up the inside that clips a rear wheel spins the other car,
// two cars leaning on each other down a straight push apart and scrub, and
// being hit on the rear quarter snaps you round the way it should.
//
// Separating Axis Theorem on two rectangles. Four axes, and the smallest
// overlap among them is the contact normal — which is why a nose-to-tail shunt
// pushes along the cars' length and a side-by-side squeeze pushes sideways,
// with no special cases for either.
// ---------------------------------------------------------------------------
function obb(car) {
  const S = car.spec;
  const c = Math.cos(car.hdg), s = Math.sin(car.hdg);
  return { cx: car.x, cy: car.y, ax: [c, s], ay: [-s, c], hx: S.bodyL * 0.5, hy: S.bodyW * 0.5 };
}

function sat(A, B) {
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  let best = Infinity, nx = 0, ny = 0;
  for (const ax of [A.ax, A.ay, B.ax, B.ay]) {
    const reach = O => Math.abs(O.ax[0] * ax[0] + O.ax[1] * ax[1]) * O.hx
                     + Math.abs(O.ay[0] * ax[0] + O.ay[1] * ax[1]) * O.hy;
    const d = dx * ax[0] + dy * ax[1];
    const overlap = reach(A) + reach(B) - Math.abs(d);
    if (overlap <= 0) return null;          // a separating axis exists: no contact
    if (overlap < best) {
      const sgn = d < 0 ? -1 : 1;           // normal points A -> B
      best = overlap; nx = ax[0] * sgn; ny = ax[1] * sgn;
    }
  }
  return { depth: best, nx, ny };
}

// The corner of `car` furthest along direction (dx,dy) — the bit doing the
// hitting, and therefore where the impulse belongs.
function extremeCorner(car, dx, dy) {
  let best = null, bd = -Infinity;
  for (const c of corners(car)) {
    const d = (c.x - car.x) * dx + (c.y - car.y) * dy;
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

// Resolve contact between two cars. Returns a report, or null if they are not
// touching. Momentum is conserved: restitution and friction change the energy,
// never the total momentum, which is the strongest single check that this is a
// physical solver and not a shove.
export function resolveCars(a, b, restitution = 0.18) {
  const hit = sat(obb(a), obb(b));
  if (!hit) return null;
  const { nx, ny, depth } = hit;
  const SA = a.spec, SB = b.spec;

  // 1. Push apart, shared in inverse proportion to mass — the heavier car
  //    yields less, which is what stops a light car bulldozing a heavy one.
  const invA = 1 / SA.m, invB = 1 / SB.m, invSum = invA + invB;
  a.x -= nx * depth * (invA / invSum); a.y -= ny * depth * (invA / invSum);
  b.x += nx * depth * (invB / invSum); b.y += ny * depth * (invB / invSum);

  // 2. Contact point: midway between the two corners actually doing the work.
  const ca = extremeCorner(a, nx, ny), cb = extremeCorner(b, -nx, -ny);
  const px = (ca.x + cb.x) * 0.5, py = (ca.y + cb.y) * 0.5;
  const rax = px - a.x, ray = py - a.y;
  const rbx = px - b.x, rby = py - b.y;

  const wv = c => {
    const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
    return [c.vx * cs - c.vy * sn, c.vx * sn + c.vy * cs];
  };
  let [avx, avy] = wv(a), [bvx, bvy] = wv(b);
  let wa = a.r, wb = b.r;

  // relative velocity AT THE CONTACT POINT, including both cars' rotation
  const vax = avx - wa * ray, vay = avy + wa * rax;
  const vbx = bvx - wb * rby, vby = bvy + wb * rbx;
  const rvn = (vbx - vax) * nx + (vby - vay) * ny;

  const out = { depth, closing: -rvn, nx, ny, j: 0 };
  if (rvn < 0) {
    const ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
    const inv = invA + invB + (ran * ran) / SA.Izz + (rbn * rbn) / SB.Izz;
    const j = -(1 + restitution) * rvn / inv;

    avx -= j * nx * invA; avy -= j * ny * invA;
    bvx += j * nx * invB; bvy += j * ny * invB;
    wa -= (rax * (j * ny) - ray * (j * nx)) / SA.Izz;
    wb += (rbx * (j * ny) - rby * (j * nx)) / SB.Izz;

    // rubbing along each other — this is what makes two cars side by side
    // scrub and lose speed instead of pinging apart
    const tx = -ny, ty = nx;
    const rvt = (bvx - wb * rby - (avx - wa * ray)) * tx + (bvy + wb * rbx - (avy + wa * rax)) * ty;
    const rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
    const invT = invA + invB + (rat * rat) / SA.Izz + (rbt * rbt) / SB.Izz;
    let jt = -rvt / invT;
    const cap = 0.42 * Math.abs(j);
    jt = Math.max(-cap, Math.min(cap, jt));
    avx -= jt * tx * invA; avy -= jt * ty * invA;
    bvx += jt * tx * invB; bvy += jt * ty * invB;
    wa -= (rax * (jt * ty) - ray * (jt * tx)) / SA.Izz;
    wb += (rbx * (jt * ty) - rby * (jt * tx)) / SB.Izz;

    out.j = j;
    // Damage on both, from the velocity each one actually lost. Blame is NOT
    // decided here — collide.js does not know the running order. The race layer
    // knows who was behind, and that is what the rulebook cares about.
    for (const [car, inv] of [[a, invA], [b, invB]]) {
      const dv = Math.abs(j) * inv;
      // SUPERLINEAR, from a threshold that ignores rubbing. Carbon composite
      // does not wear out from contact — it survives a rub or it shatters —
      // and a linear curve from a low threshold made light contact lethal by
      // accumulation: cars retiring with fifteen taps and no single big one,
      // which is not how a race weekend looks.
      if (dv > 2.5) {
        const harm = Math.min(0.6, Math.pow((dv - 2.5) / 22, 1.6));
        car.damage = Math.min(1, (car.damage || 0) + harm);
        car.crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
        const c2 = car === a ? ca : cb;
        const part = region(c2.lx, c2.ly, car.spec);
        car.crush[part] = Math.min(1, car.crush[part] + harm * 1.6);
        // and a dent where it was actually hit. The blow pushes each car the
        // way the contact normal points for it, which is opposite for the two.
        const sg = car === a ? -1 : 1;
        mark(car, c2.lx, c2.ly, nx * sg, ny * sg, harm);
      }
    }
    out.harm = Math.abs(j) / Math.min(SA.m, SB.m);

    // RIDING UP A REAR WHEEL — the most recognisable single-seater launch
    // there is. A car dives up the inside, its front wing goes under the other
    // car's rear tyre, and the tyre is a ramp.
    //
    // Nothing here is scripted. The test is purely geometric: did the nose land
    // on the other car's REAR WHEEL, or on its diffuser? Dead centre behind is
    // a shunt and the cars just bang together; a few inches offset and one of
    // them flies. That is the real distinction, and it is why the same corner
    // produces both outcomes on different laps.
    // The offset has to be measured between the CARS, not from the contact
    // corner. A rectangle's corner always sits at the full half-width, so
    // testing the corner's lateral position said "on the wheel" for every
    // rear-end shunt including a dead-centre one — which flew, and which is
    // exactly the case that must not.
    const dx = a.x - b.x, dy = a.y - b.y;
    const offset = Math.abs(-dx * Math.sin(b.hdg) + dy * Math.cos(b.hdg));
    const nose = ca.lx > SA.bodyL * 0.30;
    const onWheel = cb.lx < -SB.bodyL * 0.30 && offset > SB.bodyW * 0.30;
    // NINE metres a second of closing, not three, and not six.
    //
    // Measured on a 22-car race: at 3 m/s cars merely settling against each
    // other in a pack were thrown into the air, and at 6 m/s a first-lap
    // chicane still flipped four cars that retired upside down with a damage
    // score of 0.06 — which is to say, without ever having had an accident.
    // Nine is a genuinely misjudged dive down the inside rather than the
    // ordinary shuffling of a pack.
    if (nose && onWheel && -rvn > 9.0) {
      // A rear tyre is a ramp about a metre across, so it turns a good share of
      // the closing speed into vertical — applied at the front axle, which is
      // what pitches the nose up and sends the car over.
      // Measured against the harness: 0.42 threw the car nine metres up, which
      // is a stunt rather than a racing accident, and 0.24 barely lifted a
      // wheel once the suspension was absorbing properly. Real launches off a
      // rear tyre clear two to four metres.
      // ...and a marginal one lifts a wheel rather than launching the car.
      launch(a, Math.abs(j) * 0.50 * Math.min(1, (-rvn - 9.0) / 7), SA.a, ca.ly * 0.5);
      out.launched = true;
    }
  }

  const back = (c, vx2, vy2, w) => {
    const cs = Math.cos(c.hdg), sn = Math.sin(c.hdg);
    c.vx = vx2 * cs + vy2 * sn;
    c.vy = -vx2 * sn + vy2 * cs;
    c.r = w;
  };
  back(a, avx, avy, wa);
  back(b, bvx, bvy, wb);
  return out;
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
    // A BARRIER IS NOT ANOTHER CAR, and giving both the same forgiving curve
    // was a regression reported as "theres no crash physics". Rubbing wheels
    // has to be survivable or a 22-car race grinds itself to death by
    // accumulation — but a wall does not yield, does not brake, and is not
    // trying to avoid you. Hitting one at 50 km/h scored 0.00 damage under the
    // shared curve, which from the driver's seat is no crash at all.
    //
    // Low threshold, so contact always shows; steep, so a real shunt ends it.
    // 50 km/h at 35 degrees marks the car, 220 km/h destroys it.
    if (dv > 0.8) {
      const harm = Math.min(0.8, Math.pow((dv - 0.8) / 12, 1.3));
      car.damage = Math.min(1, (car.damage || 0) + harm);
      car.crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
      // Bodywork shows it harder than the mechanicals feel it — a nose can be
      // visibly folded on a car that is still driveable, which is what makes
      // the damage legible from the cockpit.
      car.crush[hit.part] = Math.min(1, car.crush[hit.part] + harm * 2.2);
      hit.harm = harm;
      mark(car, worst.lx, worst.ly, nx, ny, harm);
    }

    // THE VERTICAL KICK. It comes through the WHEEL that climbed the barrier's
    // base, not through the corner of the bodywork — so the lever arm is the
    // wheel's, which is why a nose-first hit levers the car up about its front
    // axle and a rear clip lifts the back instead.
    // Only a genuinely hard hit launches, and a marginal one gives a marginal
    // hop. At dv > 3 m/s this fired on ordinary rubbing: a 22-car race produced
    // TWO HUNDRED AND NINE launches, cars spent the race in the air where they
    // cannot steer, and it cascaded — 7 of 22 retired against 1 before. A
    // vertical kick is what a big accident does, not what contact does.
    if (dv > 6.5) {
      const W = wheelPos(S);
      let wi = 0, bd = Infinity;
      for (let i = 0; i < 4; i++) {
        const d = Math.hypot(W[i][0] - worst.lx, W[i][1] - worst.ly);
        if (d < bd) { bd = d; wi = i; }
      }
      const ramp = Math.min(1, (dv - 6.5) / 8);
      launch(car, Math.abs(j) * (LAUNCH[track.wall] ?? LAUNCH.barrier) * ramp, W[wi][0], W[wi][1]);
      hit.launched = true;
    }
  }

  car.vx = vwx * cs + vwy * sn;
  car.vy = -vwx * sn + vwy * cs;
  car.r = w;
  car.wallTouch = true;
  return hit;
}
