// props.js — the loose objects a track is covered in, and what happens when a
// car hits one at speed.
//
// This is the sandbox half of the game: cones, tyre stacks, marker boards,
// water barriers and the bits that break off them. They are REAL bodies — mass,
// momentum, a contact impulse at the point of contact, friction against the
// ground — not animations triggered by a trigger volume. Hit a stack of tyres
// on the inside of a hairpin and the stack goes where its momentum sends it,
// which is the whole reason it is worth simulating: nobody can predict the
// mess, which is what makes it worth doing twice.
//
// THE LAW APPLIES HERE TOO: this file imports nothing renderer-shaped. It runs
// in the browser and in plain Node, which is what lets tools/propcheck.mjs hit
// a tyre wall ten thousand times without opening a window.
//
// Frame: the sim's, the same one js/physics.js uses — x forward-ish, y LEFT,
// z UP. The car's `vx`/`vy` are BODY frame (along its nose, across it); every
// impulse that reaches a car is rotated into that frame in one place, `push()`.

const G = 9.81;

// ---------------------------------------------------------------------------
// What the objects are.
//
//   m        kg
//   r        m, collision radius — these are circles in plan, because the
//            difference between a circle and a hexagon at 200 km/h is nothing
//   tall     m, how high it stands: a car hits what is in front of its nose,
//            and drives OVER anything shorter than its floor
//   rest     restitution, 0 = a sandbag, 1 = a superball
//   mu       how hard the ground holds it once it lands
//   breakAt  N·s of impulse that destroys it, and what it leaves behind
//   absorb   how much of the contact impulse the object EATS by deforming
//            instead of handing back to the car
//
// That last one is the only place this file departs from conservation of
// momentum, and it does it on purpose. A rigid 420 kg barrier hit off-centre
// at 120 km/h spun the car at 3.3 rad/s — 190 degrees a second, from one
// object — because a rigid impulse has nowhere to put the energy. Real
// energy-absorbing barriers and real tyre stacks put it into deforming
// themselves, which is what they are FOR. The car still gets hurt, just not
// launched. Cones and boards absorb nothing: they are too light to matter.
// ---------------------------------------------------------------------------
export const KIND = {
  cone: {
    m: 3.2, r: 0.3, tall: 0.62, rest: 0.42, mu: 0.75, lift: 0.5,
    // A cone does not break, it gets run over and stays run over. `squashAt`
    // is the impulse that flattens it.
    squashAt: 260,
  },
  tyre: { m: 9.5, r: 0.37, tall: 0.62, rest: 0.34, mu: 0.95, lift: 0.22 },
  stack: {
    m: 42, r: 0.56, tall: 1.5, rest: 0.22, mu: 1.1, lift: 0.05, absorb: 0.35,
    // A tyre wall is stacked tyres bolted together, and it comes apart. This
    // is the most satisfying object in the game and it is four lines.
    breakAt: 780, debris: [['tyre', 4], ['tyre', 1]],
  },
  board: {
    m: 13, r: 0.85, tall: 1.9, rest: 0.18, mu: 0.8, lift: 0.35,
    breakAt: 430, debris: [['panel', 3]],
  },
  panel: { m: 3.4, r: 0.55, tall: 0.5, rest: 0.3, mu: 0.7, lift: 0.75 },
  barrier: {
    // A water-filled barrier. Heavy enough to stop a car, light enough to be
    // shoved — which is exactly what they are for. Most of the hit goes into
    // bursting and sliding it rather than into the car.
    m: 260, r: 0.62, tall: 1.0, rest: 0.06, mu: 1.4, lift: 0.02, absorb: 0.55,
  },
  wing: {
    // A shed front wing. Spawned by the damage model, not placed: lose one and
    // it is lying on the road for you and for everybody behind you.
    m: 8.5, r: 0.72, tall: 0.24, rest: 0.25, mu: 0.9, lift: 0.6,
  },
};

const CELL = 6;                 // m, the bucket size for prop-to-prop contact
const WALL_CELL = 24;           // m, the bucket size for static walls
const SLEEP_V = 0.12;           // m/s under which a prop is allowed to stop
const SLEEP_T = 0.5;            // s it must stay that slow

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export class PropWorld {
  /**
   * `groundY(x, y)` is the height of the land under a point — the only thing
   * this file needs to know about the world. Pass one that returns 0 and the
   * whole sim still runs, which is what the Node gate does.
   */
  constructor({ groundY = () => 0, seed = 1 } = {}) {
    this.groundY = groundY;
    this.rand = rng(seed);
    this.props = [];
    this.walls = [];
    this.wallGrid = new Map();
    this.grid = new Map();
    this.awake = 0;
    this.events = [];           // { kind, impulse, x, y, broke } since the last step
  }

  // -------------------------------------------------------------------------
  // WALLS — the static half of the sandbox.
  //
  // "EVERYTHING, EVERYTHING, GETS PHYSICS." A wall in this world is not a
  // lateral offset from a centreline that the collision code re-derives every
  // frame; it is a THING, standing between two points, that a car hits. Where
  // it stands comes from a file (data/build/objects.js), so a wall in the
  // wrong place is a number somebody can edit rather than a formula somebody
  // has to re-derive.
  //
  // A wall is a SEGMENT, not a box, because that is what a run of barrier
  // actually is and because a segment has no inside to get stuck in. The car
  // is the same rectangle js/collide.js uses, and the four corners are what
  // touch things — the whole reason that file exists.
  // -------------------------------------------------------------------------
  addWall(x1, y1, x2, y2, { height = 1, bounce = 0.25, absorb = 0.4, id = null } = {}) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return null;
    const w = {
      x1, y1, x2, y2, ux: dx / len, uy: dy / len, len, height, bounce, absorb, id,
      i: this.walls.length,
    };
    this.walls.push(w);
    // bucket it along its own length, so a 60 m run is found from anywhere
    for (let t = 0; t <= len; t += WALL_CELL * 0.5) {
      const key = Math.floor((x1 + w.ux * t) / WALL_CELL) * 100003 + Math.floor((y1 + w.uy * t) / WALL_CELL);
      let b = this.wallGrid.get(key);
      if (!b) this.wallGrid.set(key, b = []);
      if (!b.includes(w)) b.push(w);
    }
    return w;
  }

  wallsNear(x, y) {
    const out = [];
    const cx = Math.floor(x / WALL_CELL), cy = Math.floor(y / WALL_CELL);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const b = this.wallGrid.get((cx + ox) * 100003 + cy + oy);
      if (b) for (const w of b) if (!out.includes(w)) out.push(w);
    }
    return out;
  }

  /** Closest point on a wall to (x, y), and how far away it is. */
  static onWall(w, x, y) {
    const t = Math.max(0, Math.min(w.len, (x - w.x1) * w.ux + (y - w.y1) * w.uy));
    const px = w.x1 + w.ux * t, py = w.y1 + w.uy * t;
    return { px, py, d: Math.hypot(x - px, y - py), t };
  }

  spawn(kind, x, y, opts = {}) {
    const K = KIND[kind];
    if (!K) throw new Error(`no prop kind "${kind}"`);
    const p = {
      kind, K, x, y, z: opts.z ?? 0,
      hdg: opts.hdg ?? this.rand() * Math.PI * 2,
      vx: opts.vx || 0, vy: opts.vy || 0, vz: opts.vz || 0,
      w: opts.w || 0,
      // Tumbling is visual only: a body this small spinning end over end
      // changes nothing about where it lands that anyone can see.
      spin: opts.spin || 0, spinAxis: opts.spinAxis ?? this.rand() * Math.PI,
      m: K.m, r: K.r, squash: 0, alive: true, still: SLEEP_T, moved: true,
      home: { x, y, z: opts.z ?? 0, hdg: opts.hdg ?? 0 },
      id: this.props.length,
    };
    this.props.push(p);
    return p;
  }

  /** Put everything back where it started. */
  reset() {
    for (const p of this.props) {
      if (!p.spawned) {
        Object.assign(p, p.home, { vx: 0, vy: 0, vz: 0, w: 0, spin: 0, squash: 0, alive: true, still: SLEEP_T, moved: true });
      } else {
        p.alive = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // One step. `cars` is anything with { x, y, hdg, vx, vy, r, spec }, which is
  // exactly what js/physics.js already carries around.
  // -------------------------------------------------------------------------
  step(dt, cars = []) {
    this.events.length = 0;
    for (const car of cars) this.hitWalls(car);
    for (const car of cars) this.hitCar(dt, car);
    this.hitEachOther();
    this.integrate(dt);
    return this.events;
  }

  integrate(dt) {
    this.awake = 0;
    this.grid.clear();
    for (const p of this.props) {
      if (!p.alive) continue;
      const floor = this.groundY(p.x, p.y);
      const moving = !(p.still >= SLEEP_T);
      if (moving) {
        p.vz -= G * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.hdg += p.w * dt;
        p.spin += p.w * dt * 0.3;
        if (p.z <= floor) {
          p.z = floor;
          if (p.vz < -0.4) {
            // Bounce, and lose most of the horizontal speed to the scrape.
            p.vz = -p.vz * p.K.rest;
            p.vx *= 0.82; p.vy *= 0.82;
          } else {
            p.vz = 0;
            // On the ground: Coulomb friction, which is a constant
            // deceleration and not a velocity multiplier. A drag term never
            // actually stops anything — it only ever halves it again — and a
            // cone that creeps for ever is a cone you can see creeping.
            const v = Math.hypot(p.vx, p.vy);
            if (v > 1e-4) {
              const drop = Math.min(v, p.K.mu * G * dt);
              p.vx -= (p.vx / v) * drop; p.vy -= (p.vy / v) * drop;
            }
            p.w *= Math.max(0, 1 - 3.2 * dt);
          }
        }
        const speed = Math.hypot(p.vx, p.vy, p.vz);
        if (speed < SLEEP_V && Math.abs(p.w) < 0.35 && p.z <= floor + 1e-3) p.still += dt;
        else p.still = 0;
        p.moved = true;
        this.awake++;
      } else if (p.z !== floor && Math.abs(p.z - floor) > 0.001) {
        p.z = floor;                       // the land moved under a sleeper
        p.moved = true;
      }
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      const key = cx * 100003 + cy;
      let b = this.grid.get(key);
      if (!b) this.grid.set(key, b = []);
      b.push(p);
    }
  }

  // -------------------------------------------------------------------------
  // CAR TO PROP.
  //
  // The car is the rectangle collide.js already treats it as, so the contact is
  // found the same way: the closest point on the bodywork to the prop's centre.
  // What matters is that the impulse is applied AT that point on both bodies —
  // clip a cone with a front wheel and the car yaws a little and the cone goes
  // sideways and spins, which is what actually happens.
  // -------------------------------------------------------------------------
  hitCar(dt, car) {
    const S = car.spec;
    if (!S) return;
    const hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
    const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
    // The car's world velocity, from its body-frame velocities.
    const cvx = car.vx * cs - car.vy * sn, cvy = car.vx * sn + car.vy * cs;
    const reach = Math.hypot(hl, hw) + 1.2;
    for (const p of this.props) {
      if (!p.alive) continue;
      const dx = p.x - car.x, dy = p.y - car.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      // The car's floor is 5 cm off the road; anything flatter than that goes
      // under it and is only scuffed. A shed front wing lying flat is exactly
      // that case, and it is why running one over does not launch your car.
      const standing = p.K.tall * (1 - p.squash);
      const overRun = standing < 0.14;
      // into the car's frame
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      const qx = Math.max(-hl, Math.min(hl, lx)), qy = Math.max(-hw, Math.min(hw, ly));
      let nx = lx - qx, ny = ly - qy;
      let d = Math.hypot(nx, ny);
      const reachR = p.r + (overRun ? 0.0 : 0.02);
      if (d > reachR) continue;
      if (d < 1e-6) {
        // Dead centre under the car: push it out sideways rather than dividing
        // by zero. (It happens constantly — a cone under the floor.)
        nx = 0; ny = ly >= 0 ? 1 : -1; d = 1e-6;
      } else { nx /= d; ny /= d; }
      // contact point and normal, back in the world
      const wnx = nx * cs - ny * sn, wny = nx * sn + ny * cs;
      const rcx = qx * cs - qy * sn, rcy = qx * sn + qy * cs;      // car centre -> contact
      const rpx = -wnx * p.r, rpy = -wny * p.r;                    // prop centre -> contact

      // velocity of each body AT the contact
      const vcx = cvx - car.r * rcy, vcy = cvy + car.r * rcx;
      const vpx = p.vx - p.w * rpy, vpy = p.vy + p.w * rpx;
      const rvx = vpx - vcx, rvy = vpy - vcy;
      const vn = rvx * wnx + rvy * wny;
      if (vn > 0) continue;                                        // already separating

      const invMc = 1 / S.m, invIc = 1 / S.Izz;
      const invMp = 1 / p.m, invIp = 1 / (0.5 * p.m * p.r * p.r);
      const rcN = rcx * wny - rcy * wnx, rpN = rpx * wny - rpy * wnx;
      const kn = invMc + invMp + rcN * rcN * invIc + rpN * rpN * invIp;
      const rest = overRun ? 0.02 : p.K.rest;
      let j = -(1 + rest) * vn / kn;
      if (j < 0) j = 0;

      // friction along the face, Coulomb-capped against the normal impulse
      const tx = -wny, ty = wnx;
      const vt = rvx * tx + rvy * ty;
      const rcT = rcx * ty - rcy * tx, rpT = rpx * ty - rpy * tx;
      const kt = invMc + invMp + rcT * rcT * invIc + rpT * rpT * invIp;
      let jt = -vt / kt;
      const cap = 0.55 * j;
      jt = Math.max(-cap, Math.min(cap, jt));

      // the prop takes the impulse
      p.vx += (j * wnx + jt * tx) * invMp;
      p.vy += (j * wny + jt * ty) * invMp;
      p.w += (rpx * (j * wny + jt * ty) - rpy * (j * wnx + jt * tx)) * invIp;
      // ...and some of it upward. A wing scoops; a barrier does not.
      p.vz += Math.min(9, (j * invMp) * p.K.lift);
      p.still = 0;
      p.spinAxis = Math.atan2(wny, wnx) + Math.PI / 2;

      // push it clear, so it cannot be hit twice by the same overlap
      const pen = reachR - d;
      if (pen > 0) { p.x += wnx * pen; p.y += wny * pen; }

      // the car takes the other half, less whatever the object ate
      const keep = 1 - (p.K.absorb || 0);
      this.push(car, (-j * wnx - jt * tx) * keep, (-j * wny - jt * ty) * keep, rcx, rcy);

      if (p.K.squashAt && j > p.K.squashAt) p.squash = 1;
      this.events.push({ kind: p.kind, impulse: j, x: p.x, y: p.y, prop: p, broke: false });
      if (p.K.breakAt && j > p.K.breakAt) this.destroy(p, j, wnx, wny);
    }
  }

  // -------------------------------------------------------------------------
  // CAR TO WALL. The car's four corners against the segments near it.
  //
  // Same shape as the prop contact and as js/collide.js's barrier: find the
  // deepest corner, push it out, then apply an impulse at that corner with the
  // lever arm from the centre of mass — which is what makes clipping a wall
  // with the front-left spin the car instead of just slowing it.
  //
  // A wall never moves, so there is no mass ratio: the car takes all of it.
  // -------------------------------------------------------------------------
  hitWalls(car) {
    const S = car.spec;
    if (!S || !this.walls.length) return;
    const hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
    const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
    const near = this.wallsNear(car.x, car.y);
    if (!near.length) return;
    // Half the wall's own thickness: a barrier is a solid object, not a line,
    // and a corner "touching" it at zero distance is already inside it.
    const REACH = 0.35;
    for (let pass = 0; pass < 2; pass++) {
      let worst = null;
      for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]]) {
        const px = car.x + lx * cs - ly * sn, py = car.y + lx * sn + ly * cs;
        for (const w of near) {
          const p = PropWorld.onWall(w, px, py);
          // The segment is a line; the car has to be pushed to whichever side
          // of it the corner is already on, or a glancing hit teleports the
          // car through the barrier.
          if (p.d > REACH) continue;
          // NAMED, not spread. The first version was `{ ...p, w, lx, ly, px,
          // py }` — and `p` already carries px/py for the point ON THE WALL,
          // so the corner's px/py overwrote them. The normal is corner minus
          // contact point, which was then exactly zero, so it took the
          // degenerate branch, computed a penetration of -0.65 and returned.
          // Walls existed, were found, were measured at 13 cm away, and did
          // nothing at all.
          if (!worst || p.d < worst.d) worst = { d: p.d, wx: p.px, wy: p.py, w, lx, ly };
        }
      }
      if (!worst) return;
      const { w } = worst;
      const cornerX = car.x + worst.lx * cs - worst.ly * sn;
      const cornerY = car.y + worst.lx * sn + worst.ly * cs;
      // The normal points from the wall to the corner — which side of the
      // segment the car is ALREADY on. Taking it from the wall's own geometry
      // instead would push a glancing hit straight through the barrier.
      let dx = cornerX - worst.wx, dy = cornerY - worst.wy;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = -w.uy; dy = w.ux; d = 1; }
      const nx = dx / d, ny = dy / d;
      const pen = REACH - d;
      if (pen <= 0) return;

      // push the whole car out by what the deepest corner owes
      car.x += nx * pen; car.y += ny * pen;

      // contact impulse at that corner
      const rcx = cornerX - car.x, rcy = cornerY - car.y;
      const cvx = car.vx * cs - car.vy * sn, cvy = car.vx * sn + car.vy * cs;
      const vcx = cvx - car.r * rcy, vcy = cvy + car.r * rcx;
      const vn = vcx * nx + vcy * ny;
      if (vn >= 0) return;
      const invM = 1 / S.m, invI = 1 / S.Izz;
      const rN = rcx * ny - rcy * nx;
      const j = -(1 + w.bounce) * vn / (invM + rN * rN * invI);
      // friction along the wall face, Coulomb-capped
      const tx = -ny, ty = nx;
      const vt = vcx * tx + vcy * ty;
      const rT = rcx * ty - rcy * tx;
      let jt = -vt / (invM + rT * rT * invI);
      const cap = 0.5 * j;
      jt = Math.max(-cap, Math.min(cap, jt));
      // Armco deforms. Same argument as the water barrier's absorb: a rigid
      // corner impulse at 180 km/h span the car at 7.8 rad/s, which is 445
      // degrees a second from one glancing hit — a cartoon, not a sim.
      const keep = 1 - (w.absorb || 0);
      this.push(car, (j * nx + jt * tx) * keep, (j * ny + jt * ty) * keep, rcx, rcy);
      this.events.push({ kind: 'wall', impulse: j, x: cornerX, y: cornerY, wall: w, broke: false });
    }
  }

  /**
   * An impulse into a car, applied at a point. The ONLY place a world-frame
   * force becomes the body-frame `vx`/`vy` physics.js integrates — get this
   * rotation wrong and cones push the car sideways in a direction that changes
   * with which way it happens to be pointing.
   */
  push(car, ix, iy, rx, ry) {
    const S = car.spec;
    const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
    const dvx = ix / S.m, dvy = iy / S.m;
    car.vx += dvx * cs + dvy * sn;
    car.vy += -dvx * sn + dvy * cs;
    car.r += (rx * iy - ry * ix) / S.Izz;
  }

  // -------------------------------------------------------------------------
  // PROP TO PROP. Circles, one pass, only for things that are awake — a tyre
  // wall at rest costs nothing and a tyre wall coming apart costs a few
  // hundred pair tests.
  // -------------------------------------------------------------------------
  hitEachOther() {
    for (const p of this.props) {
      if (!p.alive || p.still >= SLEEP_T) continue;
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const b = this.grid.get((cx + ox) * 100003 + cy + oy);
        if (!b) continue;
        for (const q of b) {
          if (q === p || !q.alive || q.id < p.id) continue;
          const dx = q.x - p.x, dy = q.y - p.y;
          const rr = p.r + q.r;
          const d2 = dx * dx + dy * dy;
          if (d2 > rr * rr || d2 < 1e-9) continue;
          // Two things at different heights miss each other. Without this a
          // tyre lying flat on the ground still shoves the barrier next to it.
          if (Math.abs(p.z - q.z) > Math.max(p.K.tall, q.K.tall)) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const vn = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          const pen = rr - d;
          const invA = 1 / p.m, invB = 1 / q.m;
          // positional correction first, split by mass
          const corr = pen / (invA + invB) * 0.8;
          p.x -= nx * corr * invA; p.y -= ny * corr * invA;
          q.x += nx * corr * invB; q.y += ny * corr * invB;
          if (vn > 0) continue;
          const rest = Math.min(p.K.rest, q.K.rest);
          const j = -(1 + rest) * vn / (invA + invB);
          p.vx -= j * nx * invA; p.vy -= j * ny * invA;
          q.vx += j * nx * invB; q.vy += j * ny * invB;
          p.still = 0; q.still = 0;
          if (q.K.breakAt && j > q.K.breakAt) this.destroy(q, j, nx, ny);
          if (p.K.breakAt && j > p.K.breakAt) this.destroy(p, j, -nx, -ny);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Destruction: the object stops existing and its pieces start. The pieces
  // inherit the parent's momentum plus a spread, so a tyre stack hit square
  // goes forward and a tyre stack clipped on the shoulder fans sideways.
  // -------------------------------------------------------------------------
  destroy(p, j, nx, ny) {
    p.alive = false;
    const speed = j / p.m;
    for (const [kind, count] of p.K.debris || []) {
      for (let i = 0; i < count; i++) {
        const spread = (this.rand() - 0.5) * 1.1;
        const dirx = nx * Math.cos(spread) - ny * Math.sin(spread);
        const diry = nx * Math.sin(spread) + ny * Math.cos(spread);
        const v = speed * (0.35 + this.rand() * 0.75);
        const child = this.spawn(kind, p.x + dirx * 0.45, p.y + diry * 0.45, {
          z: p.z + 0.2 + this.rand() * (p.K.tall * 0.8),
          vx: p.vx * 0.3 + dirx * v, vy: p.vy * 0.3 + diry * v,
          vz: 1.5 + this.rand() * speed * 0.35,
          w: (this.rand() - 0.5) * 9,
        });
        child.spawned = true;
        child.still = 0;
      }
    }
    this.events.push({ kind: p.kind, impulse: j, x: p.x, y: p.y, prop: p, broke: true });
  }

  stats() {
    let alive = 0, debris = 0;
    for (const p of this.props) {
      if (!p.alive) continue;
      alive++;
      if (p.spawned) debris++;
    }
    return { total: this.props.length, alive, debris, awake: this.awake };
  }
}
