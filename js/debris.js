// debris.js — the bits that come off, and where they end up.
//
// A lost front wing used to just vanish from the car. Now it LEAVES: the two
// halves of the wing, the nose tip, the endplates, the rear wing, a mirror,
// and a spray of carbon and painted shards, all as real rigid bodies with
// velocity, spin and corner contacts, so they tumble, bounce, skate and settle
// flat on the tarmac — and stay there, a record of where the accident was.
//
// THE PIECES ARE THE CAR'S OWN MESHES. Each big-piece kind is built once by
// merging the actual geometry car.js tagged (`userData.dmg.role`), in car
// space, then recentred on itself. A wing lying on the track is the wing that
// was on your car, not a stand-in.
//
// COST: one InstancedMesh per kind — the whole grid's worth of front-wing
// halves is one draw, all the shards another — and a kind with nothing alive
// is not drawn at all. Pieces are pooled and capped; when a pool is full the
// oldest piece is recycled.
//
// THE PHYSICS is a small rigid-body solver: a box of the piece's own size, its
// eight corners tested against the ground, a sequential impulse at each
// penetrating corner with restitution and Coulomb friction, torque from the
// lever arm. That is what makes a wing land on one end and flop over, rather
// than bounce like a ball. Sequential, not independent (DESIGN.md gotcha 24:
// per-contact impulses computed separately MULTIPLY).
//
// It reads the world and never writes it. A piece cannot touch a car's
// physics; a car driving through a resting piece only kicks the PIECE.
import * as THREE from 'three';
import { Z } from './geom.js';
import { bankY } from './bank.js';

const G = 9.81;
const LIFE = 150;            // s a piece stays on the circuit
const FADE = 1.5;            // s it takes to go
const SUB = 1 / 120;         // solver step
const BARRIER_H = 1.0;       // m — below this a piece bounces off the wall

// kind -> which tagged parts make it, and which side of the car
const KINDS = {
  fwL:  { roles: ['fw'], side: -1, cap: 12, shadow: true },
  fwR:  { roles: ['fw'], side: 1, cap: 12, shadow: true },
  fepL: { roles: ['fep'], side: -1, cap: 12, shadow: true },
  fepR: { roles: ['fep'], side: 1, cap: 12, shadow: true },
  tip:  { roles: ['tip'], cap: 12, shadow: true },
  rw:   { roles: ['rw'], cap: 10, shadow: true },
  repL: { roles: ['rep'], side: -1, cap: 10, shadow: true },
  repR: { roles: ['rep'], side: 1, cap: 10, shadow: true },
  mirL: { roles: ['mirror'], side: -1, cap: 10, shadow: false },
  mirR: { roles: ['mirror'], side: 1, cap: 10, shadow: false },
};

// Paint index per vertex: 0 carbon, 1 the car's colour, 2 its second colour.
// The shader below turns that plus the instance colour into the surface.
function paintMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.38, metalness: 0.15, envMapIntensity: 0.9, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;\nvarying float vPaint;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPaint = paint;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPaint;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // carbon is carbon on every car; the paint takes the team's colour
        vec3 carbonC = vec3(0.045, 0.047, 0.052);
        diffuseColor.rgb = vPaint < 0.5 ? carbonC : (vPaint < 1.5 ? vColor.rgb : vec3(0.82));`);
  };
  m.customProgramCacheKey = () => 'debris-paint';
  return m;
}

// Merge the tagged meshes of one car into a single geometry, in car space,
// keeping only triangles on the requested side. Returns null if nothing
// matched (a GT3 body has no nose tip).
function mergeParts(group, roles, side, bundle) {
  const pos = [], nor = [], pnt = [];
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const M = new THREE.Matrix4(), N = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  group.traverse(m => {
    const t = m.isMesh && m.userData.dmg;
    if (!t || !roles.includes(t.role)) return;
    // stickers stay with the car's own copy; merged in, they would be dark
    // rectangles floating a centimetre off the piece
    if (m.material === bundle.decalMat || m.material === bundle.numMat) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    if (!g.attributes.normal) g.computeVertexNormals();
    M.multiplyMatrices(inv, m.matrixWorld);
    N.getNormalMatrix(M);
    const P = g.attributes.position, NN = g.attributes.normal;
    const pv = m.material === bundle.paint ? 1 : m.material === bundle.paint2 ? 2 : 0;
    for (let i = 0; i + 2 < P.count; i += 3) {
      a.fromBufferAttribute(P, i).applyMatrix4(M);
      b.fromBufferAttribute(P, i + 1).applyMatrix4(M);
      c.fromBufferAttribute(P, i + 2).applyMatrix4(M);
      const cz = (a.z + b.z + c.z) / 3;
      if (side && Math.sign(cz || 1) !== side) continue;
      for (const [v, k] of [[a, i], [b, i + 1], [c, i + 2]]) {
        pos.push(v.x, v.y, v.z);
        n.fromBufferAttribute(NN, k).applyMatrix3(N).normalize();
        nor.push(n.x, n.y, n.z);
        pnt.push(pv);
      }
    }
  });
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('paint', new THREE.Float32BufferAttribute(pnt, 1));
  geo.computeBoundingBox();
  const c0 = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c0.x, -c0.y, -c0.z);
  geo.computeBoundingBox();
  const half = geo.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  return { geo, c0, half };
}

// A broken shard: an irregular flat polygon, painted on top and bare carbon
// underneath and round its torn edge. Unit-sized; each instance scales it.
function shardGeometry() {
  const pts = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.35 + 0.65 * Math.abs(Math.sin(i * 12.9898 + 1.7) * 0.9 + (i % 2 ? 0.1 : 0));
    pts.push([Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5]);
  }
  const pos = [], pnt = [];
  const T = 0.06;
  for (let i = 0; i < N; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % N];
    pos.push(0, T, 0, x2, T, z2, x1, T, z1); pnt.push(1, 1, 1);          // top: paint
    pos.push(0, -T, 0, x1, -T, z1, x2, -T, z2); pnt.push(0, 0, 0);       // underside: carbon
    pos.push(x1, T, z1, x2, T, z2, x2, -T, z2, x1, T, z1, x2, -T, z2, x1, -T, z1);
    pnt.push(0, 0, 0, 0, 0, 0);                                          // torn edge
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('paint', new THREE.Float32BufferAttribute(pnt, 1));
  g.computeVertexNormals();
  return { geo: g, half: new THREE.Vector3(0.5, T, 0.5) };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _s = new THREE.Vector3();
const _R = new THREE.Matrix3(), _t = new THREE.Vector3(), _t2 = new THREE.Vector3();
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push(new THREE.Vector3(x, y, z));

export class Debris {
  /**
   * @param view   the View (scene, track, world, bank)
   * @param bundle buildCar's return, for the reference geometry
   */
  constructor(view, bundle, onHit = null) {
    this.view = view;
    this.onHit = onHit;          // (piece, speed) — for debrisaudio.js
    this.kinds = {};
    this.all = [];
    const mat = paintMaterial();
    this.mat = mat;
    const group = bundle && bundle.group;
    if (group) {
      for (const [k, def] of Object.entries(KINDS)) {
        const src = mergeParts(group, def.roles, def.side || 0, bundle);
        if (src) this._kind(k, src, def.cap, def.shadow, def);
      }
    }
    const sh = shardGeometry();
    this._kind('shard', { geo: sh.geo, c0: new THREE.Vector3(), half: sh.half }, 360, false, { shard: true });
  }

  _kind(name, src, cap, shadow, def) {
    const mesh = new THREE.InstancedMesh(src.geo, this.mat, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;       // instances roam the whole circuit
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.name = 'debris.' + name;
    this.view.scene.add(mesh);
    const pool = [];
    for (let i = 0; i < cap; i++) pool.push(null);
    this.kinds[name] = { name, mesh, src, cap, pool, next: 0, def, dirty: true };
  }

  has(kind) { return !!this.kinds[kind]; }

  _alloc(kind) {
    const K = this.kinds[kind];
    // a free slot, or else the oldest piece
    let slot = K.pool.indexOf(null);
    if (slot < 0) {
      let oldest = 0;
      for (let i = 1; i < K.cap; i++) if (K.pool[i].born < K.pool[oldest].born) oldest = i;
      slot = oldest;
      const old = K.pool[slot];
      const j = this.all.indexOf(old); if (j >= 0) this.all.splice(j, 1);
    }
    const p = {
      kind: K, slot, born: performance.now() / 1000, age: 0,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
      prevPos: new THREE.Vector3(), prevQ: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1), half: new THREE.Vector3(), inv: new THREE.Vector3(),
      colour: new THREE.Color(1, 1, 1), sleep: 0, asleep: false, hint: null,
      gy: 0, gs: null, e: 0.25, mu: 0.55, drag: 0.4, flutter: 0,
    };
    K.pool[slot] = p;
    this.all.push(p);
    K.dirty = true;
    return p;
  }

  _shape(p, half) {
    // box inertia, unit mass: I = (b^2 + c^2)/3 for half-extents
    p.half.copy(half).multiply(p.scale).max(_v.set(0.008, 0.008, 0.008));
    const h = p.half;
    p.inv.set(3 / (h.y * h.y + h.z * h.z), 3 / (h.x * h.x + h.z * h.z), 3 / (h.x * h.x + h.y * h.y));
    // Flat things flutter and are slowed by the air; chunky things are not.
    const flat = Math.min(h.x, h.y, h.z) / Math.max(h.x, h.y, h.z);
    p.drag = 0.15 + 0.9 * (1 - flat) * Math.min(1, Math.max(h.x, h.z) * 2.5);
    p.flutter = (1 - flat) * 5;
  }

  /**
   * A big piece of the car leaves it. `carM` is the car's world matrix (the
   * pieces are in car space), `vel` its world velocity, `colour` its paint.
   */
  part(kind, carM, vel, colour, kick = 1) {
    const K = this.kinds[kind];
    if (!K) return null;
    const p = this._alloc(kind);
    p.pos.copy(K.src.c0).applyMatrix4(carM);
    carM.decompose(_v, p.q, _s);
    p.scale.set(1, 1, 1);
    this._shape(p, K.src.half);
    // Most of the car's speed, some of it lost in the breaking, a kick up
    // and outward, and a tumble.
    const side = K.def && K.def.side ? K.def.side : (Math.random() < 0.5 ? -1 : 1);
    _v.set(0, 0, side).applyQuaternion(p.q);
    p.vel.copy(vel).multiplyScalar(0.55 + Math.random() * 0.35)
      .addScaledVector(_v, (0.8 + Math.random() * 2.2) * kick);
    p.vel.y += (1.2 + Math.random() * 3.2) * kick;
    p.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 14).multiplyScalar(kick);
    p.colour.copy(colour);
    p.e = 0.22; p.mu = 0.5;
    return p;
  }

  /**
   * Shards from a point: `n` of them, `size` their typical width, `painted`
   * the share that wear the car's colour on one face.
   */
  shards(n, at, vel, colour, { size = 0.09, spread = 3, up = 2.5, painted = 0.45, kick = 1 } = {}) {
    const K = this.kinds.shard;
    for (let i = 0; i < n; i++) {
      const p = this._alloc('shard');
      p.pos.copy(at).add(_v.set((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4));
      p.q.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
      const s = size * (0.35 + Math.random() * Math.random() * 1.6);
      // splinters: long and narrow as often as not
      const long = Math.random() < 0.5 ? 1.5 + Math.random() * 2.5 : 1;
      p.scale.set(s * long, s * (0.25 + Math.random() * 0.4), s / Math.sqrt(long));
      this._shape(p, K.src.half);
      p.vel.copy(vel).multiplyScalar(0.5 + Math.random() * 0.5)
        .add(_v.set((Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread).multiplyScalar(kick));
      p.w.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
      if (Math.random() < painted) p.colour.copy(colour);
      else p.colour.setRGB(0.045, 0.047, 0.052);        // a carbon-only shard
      p.e = 0.3; p.mu = 0.45;
    }
  }

  // Ground under a piece, and the barrier. Real circuits: inside the barrier
  // the height is the ROAD's (what cars drive on); beyond it, the grass's
  // (World.groundY). See wdc-ground-surface.
  _ground(p, simY) {
    const v = this.view, t = v.track, w = v.world;
    const pr = t.project(p.pos.x, simY, p.hint);
    p.hint = pr.i;
    const lim = pr.w + pr.run;
    const out = Math.abs(pr.lat) - lim;
    let gy;
    if (out <= 0 || !w || !w.groundY) gy = (w ? w.trackYAt(pr.s) : 0) + (v.bank ? bankY(v.bank, t, pr.i, pr.lat) : 0);
    else gy = w.groundY(p.pos.x, p.pos.z);
    p.gy = gy;
    p.wall = null;
    if (out > -0.05) {
      // wall normal, back into the track, in three space
      const sgn = Math.sign(pr.lat) || 1;
      const nx = sgn * Math.sin(pr.hdg), ny = -sgn * Math.cos(pr.hdg);
      p.wall = { nx, nz: Z(ny), out, base: (w ? w.trackYAt(pr.s) : 0) };
    }
  }

  // Integrate one piece by dt: gravity, air, flutter, then contacts.
  _step(p, dt) {
    p.vel.y -= G * dt;
    const dr = Math.max(0, 1 - p.drag * dt);
    p.vel.multiplyScalar(dr);
    p.w.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
    if (p.flutter) {
      // a flat piece in the air catches it, and wobbles
      const sp = p.vel.length();
      if (sp > 4) p.w.x += (Math.random() - 0.5) * p.flutter * sp * dt, p.w.z += (Math.random() - 0.5) * p.flutter * sp * dt;
    }
    p.pos.addScaledVector(p.vel, dt);
    // orientation: q += 0.5 * w * q * dt
    _q2.set(p.w.x, p.w.y, p.w.z, 0).multiply(p.q);
    p.q.x += 0.5 * _q2.x * dt; p.q.y += 0.5 * _q2.y * dt; p.q.z += 0.5 * _q2.z * dt; p.q.w += 0.5 * _q2.w * dt;
    p.q.normalize();

    // the barrier: a piece low enough bounces off it
    if (p.wall && p.wall.out > 0 && p.pos.y < p.wall.base + BARRIER_H) {
      const nx = p.wall.nx, nz = p.wall.nz;
      p.pos.x += nx * p.wall.out; p.pos.z += nz * p.wall.out;
      const vn = p.vel.x * nx + p.vel.z * nz;
      if (vn < 0) {
        p.vel.x -= (1.35) * vn * nx; p.vel.z -= (1.35) * vn * nz;
        p.vel.multiplyScalar(0.7);
        p.w.multiplyScalar(0.6).add(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6));
        if (this.onHit && -vn > 2) this.onHit(p, -vn);
      }
      p.wall.out = 0;
    }

    // Corner contacts against the ground plane, sequential impulses.
    let hitV = 0, touching = 0;
    for (let pass = 0; pass < 4; pass++) {
      for (const c of CORNERS) {
        _r.set(c.x * p.half.x, c.y * p.half.y, c.z * p.half.z).applyQuaternion(p.q);
        const depth = p.gy - (p.pos.y + _r.y);
        if (depth <= 0) continue;
        touching++;
        if (pass === 0) p.pos.y += depth * 0.8;
        // velocity of that corner: v + w x r
        _v.crossVectors(p.w, _r).add(p.vel);
        const vn = _v.y;
        if (vn >= 0) continue;
        // effective mass along n = (0,1,0): 1/m + n.((I^-1 (r x n)) x r)
        const jn = this._impulse(p, _r, 0, 1, 0, -(1 + (vn < -1 ? p.e : 0)) * vn);
        if (-vn > hitV) hitV = -vn;
        // friction, along the corner's sliding direction
        _v.crossVectors(p.w, _r).add(p.vel);
        const tx = _v.x, tz = _v.z, tl = Math.hypot(tx, tz);
        if (tl > 1e-4) {
          this._impulse(p, _r, -tx / tl, 0, -tz / tl, tl, p.mu * jn);
        }
      }
    }
    if (hitV > 1.2 && this.onHit) this.onHit(p, hitV);
    // Rolling resistance and scrub: a piece lying on the road loses its spin.
    // Without it, the corner impulses of a flat plate at rest trade a few
    // mm/s of spin back and forth forever and nothing ever settles.
    if (touching) {
      p.w.multiplyScalar(Math.max(0, 1 - 6 * dt));
      // THE SETTLE. Sequential corner impulses on a flat plate at rest never
      // quite agree — it rocks by a few mm/s indefinitely, or balances on an
      // edge. Once a piece is slow and on the ground, ease it onto its
      // biggest face (thinnest axis up or down, whichever is nearer) the way
      // a real one flops over, and let it sleep.
      // "slow" by the speed of its RIM: a 4 cm splinter rolling at 5 rad/s
      // is barely moving, and it rolled between two near-equal faces forever
      const rr = Math.max(p.half.x, p.half.y, p.half.z);
      if (p.vel.lengthSq() < 0.6 && p.w.lengthSq() * rr * rr < 0.64) {
        const h = p.half;
        const ax = h.y <= h.x && h.y <= h.z ? _t.set(0, 1, 0) : h.x <= h.z ? _t.set(1, 0, 0) : _t.set(0, 0, 1);
        ax.applyQuaternion(p.q);
        if (ax.y < 0) ax.negate();
        _q2.setFromUnitVectors(ax, _t2.set(0, 1, 0)).multiply(p.q);
        p.q.slerp(_q2, Math.min(1, 5 * dt));
        p.w.multiplyScalar(Math.max(0, 1 - 10 * dt));
        p.vel.x *= Math.max(0, 1 - 3 * dt); p.vel.z *= Math.max(0, 1 - 3 * dt);
      }
    }
    return touching;
  }

  // An impulse along unit n at offset r (unit mass, box inertia in the
  // piece's own axes) that changes the velocity of that point along n by
  // `dv`, capped at `cap` if given. Returns the impulse applied.
  _impulse(p, r, nx, ny, nz, dv, cap = Infinity) {
    const n = _v2.set(nx, ny, nz);
    // I^-1 (r x n) in world = R diag(inv) R^T (r x n)
    _q.copy(p.q).invert();
    _t.crossVectors(r, n).applyQuaternion(_q).multiply(p.inv).applyQuaternion(p.q);
    // effective mass: 1/m + n . ((I^-1 (r x n)) x r)
    const k = 1 + n.dot(_t2.crossVectors(_t, r));
    const j = Math.min(cap, dv / Math.max(1e-6, k));
    p.vel.addScaledVector(n, j);
    p.w.addScaledVector(_t, j);
    return j;
  }

  update(dt, cars) {
    if (!this.all.length) return;
    dt = Math.min(dt, 1 / 20);
    const now = performance.now() / 1000;
    for (let i = this.all.length - 1; i >= 0; i--) {
      const p = this.all[i];
      p.age = now - p.born;
      if (p.age > LIFE) { p.kind.pool[p.slot] = null; p.kind.dirty = true; this.all.splice(i, 1); continue; }
      // Cars kick what they run over: a resting piece near a car's footprint
      // is woken and thrown along. Only the PIECE moves.
      if (cars && p.asleep) {
        for (const c of cars) {
          if (c.speed < 4) continue;
          const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
          if (dx * dx + dz * dz > 7) continue;
          // into the car's frame
          const lx = dx * c.cs - dz * c.sn, ly = dx * c.sn + dz * c.cs;
          if (Math.abs(lx) > 2.9 || Math.abs(ly) > 1.05) continue;
          p.asleep = false; p.sleep = 0;
          p.vel.set(c.vx * (0.5 + Math.random() * 0.5), 0.8 + Math.random() * 2.5 * Math.min(1, c.speed / 30), c.vz * (0.5 + Math.random() * 0.5));
          p.vel.x += (Math.random() - 0.5) * 3; p.vel.z += (Math.random() - 0.5) * 3;
          p.w.set((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25);
          if (this.onHit) this.onHit(p, Math.min(20, c.speed * 0.4));
          break;
        }
      }
      if (p.asleep) continue;
      this._ground(p, -p.pos.z);
      let touch = 0;
      for (let t = 0; t < dt - 1e-6; t += SUB) touch = this._step(p, Math.min(SUB, dt - t));
      // Settled? Slow, on the ground, for a while — then it sleeps until a
      // car wakes it. Gravity must be the thing holding it (DESIGN.md 23).
      // Measured by what it DID this frame, not by its velocity: a plate at
      // rest carries a residue of contact velocity that never reaches zero.
      const rim = Math.max(p.half.x, p.half.y, p.half.z);
      const moved = p.pos.distanceTo(p.prevPos) + rim * 2 * Math.acos(Math.min(1, Math.abs(p.q.dot(p.prevQ))));
      p.prevPos.copy(p.pos); p.prevQ.copy(p.q);
      if (touch && moved < 0.25 * dt) {
        p.sleep += dt;
        if (p.sleep > 0.4) { p.asleep = true; p.vel.set(0, 0, 0); p.w.set(0, 0, 0); }
      } else p.sleep = 0;
      if (p.pos.y < p.gy - 3) p.pos.y = p.gy;   // never lost under the world
      p.kind.dirty = true;
    }
    this._upload(now);
  }

  _upload(now) {
    for (const K of Object.values(this.kinds)) {
      if (!K.dirty) continue;
      K.dirty = false;
      let n = 0;
      for (const p of K.pool) {
        if (!p) continue;
        const f = Math.max(0, Math.min(1, (LIFE - p.age) / FADE));
        _s.copy(p.scale).multiplyScalar(f || 1e-4);
        _m.compose(p.pos, p.q, _s);
        K.mesh.setMatrixAt(n, _m);
        K.mesh.setColorAt(n, p.colour);
        n++;
      }
      K.mesh.count = n;
      K.mesh.visible = n > 0;
      K.mesh.instanceMatrix.needsUpdate = true;
      if (K.mesh.instanceColor) K.mesh.instanceColor.needsUpdate = true;
    }
  }

  get count() { return this.all.length; }
}
