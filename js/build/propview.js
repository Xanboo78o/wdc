// propview.js — the loose objects, as things you can see.
//
// js/props.js is the simulation and knows nothing about three.js. This is the
// other half: what a cone is MADE of, where the track's cones are, and how a
// few hundred of them get on screen for seven draw calls.
//
// Everything here is instanced and only the props that MOVED are written back
// each frame. A tyre wall that nobody has hit yet costs one matrix upload at
// load and nothing afterwards, which is what makes it affordable to cover a
// five-kilometre track in objects.
import * as THREE from 'three';
import { PropWorld, KIND } from '../props.js';
import { pointAt, surfaceY } from './path.js';
import { V } from './meshes.js';
import { PROPS } from '../../data/build/scenery.js';

// Room for what a crash makes. A tyre stack becomes five tyres and a board
// becomes three panels, so the debris pool has to be bigger than the yard.
const SPARE = { tyre: 260, panel: 90, wing: 8, cone: 8, stack: 0, board: 0, barrier: 0 };

// ---------------------------------------------------------------------------
// Little modelled shapes. Merged into one geometry per kind with vertex
// colours, so a two-tone cone is one draw and not two.
// ---------------------------------------------------------------------------
function merge(parts) {
  const pos = [], nor = [], col = [], idx = [];
  for (const { geometry, colour, at = [0, 0, 0], rot = null } of parts) {
    const g = geometry.clone();
    if (rot) g.rotateX(rot[0] || 0), g.rotateY(rot[1] || 0), g.rotateZ(rot[2] || 0);
    g.translate(at[0], at[1], at[2]);
    const p = g.attributes.position, n = g.attributes.normal;
    const index = g.index ? [...g.index.array] : [...Array(p.count).keys()];
    const base = pos.length / 3;
    const c = new THREE.Color(colour);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
    }
    for (const i of index) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// A real traffic cone: a weighted square base, a tapered body, a white band.
// The band is what makes it read as a cone at fifty metres rather than as an
// orange smudge, and it costs twelve triangles.
function coneGeometry() {
  return merge([
    { geometry: new THREE.BoxGeometry(0.36, 0.05, 0.36), colour: 0x23252a, at: [0, 0.025, 0] },
    { geometry: new THREE.CylinderGeometry(0.035, 0.155, 0.36, 10, 1, true), colour: 0xe2571c, at: [0, 0.235, 0] },
    { geometry: new THREE.CylinderGeometry(0.093, 0.11, 0.1, 10, 1, true), colour: 0xf0f0ee, at: [0, 0.31, 0] },
    { geometry: new THREE.CylinderGeometry(0.02, 0.035, 0.09, 10, 1, true), colour: 0xe2571c, at: [0, 0.46, 0] },
  ]);
}

function tyreGeometry(y = 0) {
  const t = new THREE.TorusGeometry(0.28, 0.105, 5, 11);
  return merge([{ geometry: t, colour: 0x1b1b1d, rot: [Math.PI / 2, 0, 0], at: [0, y + 0.11, 0] }]);
}

// A stack: three tyres on a post, which is how a real tyre wall is built.
function stackGeometry() {
  const parts = [{ geometry: new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), colour: 0x3a3d42, at: [0, 0.65, 0] }];
  for (let i = 0; i < 3; i++) {
    parts.push({
      geometry: new THREE.TorusGeometry(0.31, 0.12, 5, 11), colour: i === 1 ? 0x222225 : 0x1b1b1d,
      rot: [Math.PI / 2, 0, 0], at: [0, 0.16 + i * 0.4, 0],
    });
  }
  return merge(parts);
}

function boardGeometry() {
  return merge([
    { geometry: new THREE.BoxGeometry(0.09, 1.1, 0.09), colour: 0x4a4e55, at: [0, 0.55, -0.62] },
    { geometry: new THREE.BoxGeometry(0.09, 1.1, 0.09), colour: 0x4a4e55, at: [0, 0.55, 0.62] },
    { geometry: new THREE.BoxGeometry(0.07, 0.72, 1.55), colour: 0xdfe3e8, at: [0, 1.42, 0] },
    { geometry: new THREE.BoxGeometry(0.08, 0.16, 1.55), colour: 0x35d6a0, at: [0, 1.14, 0] },
  ]);
}

function panelGeometry() {
  return merge([{ geometry: new THREE.BoxGeometry(0.06, 0.5, 0.7), colour: 0xdfe3e8, at: [0, 0.25, 0] }]);
}

// A water-filled barrier — the red and white plastic blocks.
function barrierGeometry() {
  return merge([
    { geometry: new THREE.BoxGeometry(0.62, 0.86, 1.15), colour: 0xc6362c, at: [0, 0.43, 0] },
    { geometry: new THREE.BoxGeometry(0.66, 0.16, 1.18), colour: 0xf0f0ee, at: [0, 0.74, 0] },
  ]);
}

// A shed front wing, lying on the road where it came off.
function wingGeometry() {
  return merge([
    { geometry: new THREE.BoxGeometry(0.55, 0.05, 1.5), colour: 0xd8352a, at: [0, 0.06, 0] },
    { geometry: new THREE.BoxGeometry(0.4, 0.28, 0.06), colour: 0xd8352a, at: [0.02, 0.16, 0.74] },
    { geometry: new THREE.BoxGeometry(0.4, 0.28, 0.06), colour: 0xd8352a, at: [0.02, 0.16, -0.74] },
  ]);
}

// Exported so gameshow.html can stand them up and have them marked out of ten.
export const SHAPES = {
  cone: { geo: coneGeometry, rough: 0.62, metal: 0, shadow: false },
  tyre: { geo: () => tyreGeometry(0), rough: 0.96, metal: 0, shadow: false },
  stack: { geo: stackGeometry, rough: 0.94, metal: 0 },
  board: { geo: boardGeometry, rough: 0.58, metal: 0.1 },
  panel: { geo: panelGeometry, rough: 0.58, metal: 0.1, shadow: false },
  barrier: { geo: barrierGeometry, rough: 0.48, metal: 0 },
  wing: { geo: wingGeometry, rough: 0.42, metal: 0.15, shadow: false },
};

// ---------------------------------------------------------------------------
export class PropYard {
  constructor(path, ground, look, brand) {
    this.path = path; this.ground = ground; this.look = look; this.brand = brand;
    this.group = new THREE.Group();
    this.group.name = 'props';
    // The sim's only window onto the world. Inside the mown verge the ground
    // IS the road edge's height, and past it the terrain answers — the same
    // identity flora.js leans on.
    this.world = new PropWorld({ seed: 4242, groundY: (x, y) => this.heightAt(x, y) });
    this.meshes = {};
    this.lastWing = false;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  heightAt(x, y) {
    return this.ground.height(x, y);
  }

  // -- where the objects are -------------------------------------------------
  //
  // Tyre stacks go where a real circuit puts them: the outside of a corner,
  // against the barrier. Cones are laid out per section in scenery.js, because
  // a slalom down the back straight is a decision about the GAME and not a
  // property of the geometry.
  populate() {
    const p = this.path;
    const place = (kind, i, lat, opts = {}) => {
      const pt = pointAt(p, i, lat);
      const onVerge = Math.abs(lat) <= p.w[i] + (lat > 0 ? p.runL[i] : p.runR[i]);
      const z = onVerge ? surfaceY(p, i, lat) : this.heightAt(pt.x, pt.y);
      return this.world.spawn(kind, pt.x, pt.y, { z, hdg: p.hdg[i] + (opts.turn || 0), ...opts });
    };
    // `part:` is written on the FIRST piece of a section and carries on until
    // the next one, exactly as it does in the piece list — so the name has to
    // be carried forward per sample rather than looked up per piece.
    const partAt = new Array(p.n);
    let part = 'START';
    for (const piece of p.pieces) {
      if (piece.part) part = piece.part;
      const i0 = Math.floor(piece.s0 / p.ds), i1 = Math.min(p.n - 1, Math.ceil(piece.s1 / p.ds));
      for (let i = i0; i <= i1; i++) partAt[i] = part;
    }
    const kindFor = (i) => PROPS[partAt[i]] || PROPS.default;

    let lastStack = -1e9, lastCone = -1e9, lastBoard = -1e9;
    for (let i = 2; i < p.n - 2; i++) {
      const s = i * p.ds;
      const want = kindFor(i);
      if (p.tunIn && p.tunIn[i] > 0) continue;      // nothing loose inside a bore
      const k = p.k[i];
      const turning = Math.abs(k) > 1 / 200;

      // TYRE STACKS — outside of a corner, in a run along the barrier.
      if (want.tyres && turning && s - lastStack > 26) {
        const side = k > 0 ? -1 : 1;                // outside of the bend
        const run = side > 0 ? p.runL[i] : p.runR[i];
        const lat = side * (p.w[i] + run - 0.75);
        const n = 5 + Math.round(Math.min(5, Math.abs(k) * 420));
        for (let j = 0; j < n; j++) {
          const jj = Math.min(p.n - 2, i + Math.round((j * 1.35) / p.ds));
          place('stack', jj, lat);
        }
        lastStack = s;
      }

      // CONES.
      if (want.cones === 'slalom' && !turning && s - lastCone > 18) {
        // A cone in the middle of the road, side alternating: the cheapest
        // corner in the world and the reason a straight is worth driving.
        const side = Math.round(s / 18) % 2 ? 1 : -1;
        place('cone', i, side * p.w[i] * 0.42);
        place('cone', i, side * p.w[i] * 0.42 + side * 0.9);
        lastCone = s;
      } else if (want.cones === 'edge' && s - lastCone > 9) {
        for (const side of [1, -1]) place('cone', i, side * (p.w[i] + 0.6));
        lastCone = s;
      } else if (want.cones === 'gate' && !turning && s - lastCone > 60) {
        for (const side of [1, -1]) {
          place('barrier', i, side * (p.w[i] * 0.55), { turn: Math.PI / 2 });
        }
        lastCone = s;
      }

      // ADVERT BOARDS on the grass, which are there to be destroyed.
      if (want.boards && s - lastBoard > 210) {
        const side = (Math.round(s / 210) % 2) ? 1 : -1;
        const run = side > 0 ? p.runL[i] : p.runR[i];
        place('board', i, side * (p.w[i] + run + 3.5), { turn: Math.PI / 2 });
        lastBoard = s;
      }
    }
    this.build();
    return this;
  }

  build() {
    const counts = {};
    for (const p of this.world.props) counts[p.kind] = (counts[p.kind] || 0) + 1;
    for (const kind of Object.keys(SHAPES)) {
      const max = (counts[kind] || 0) + (SPARE[kind] || 0);
      if (!max) continue;
      const S = SHAPES[kind];
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: S.rough, metalness: S.metal,
        envMapIntensity: 0.9,
      });
      const im = new THREE.InstancedMesh(S.geo(), mat, max);
      // Only the things big enough for their shadow to mean anything cast one.
      // A shadow map is a second draw of everything in it, and a cone's
      // shadow is 30 cm of grey nobody will ever look at.
      im.castShadow = S.shadow !== false;
      im.receiveShadow = true;
      im.count = 0;
      im.frustumCulled = false;     // they move; a stale bounding sphere pops
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      this.meshes[kind] = { mesh: im, max, n: 0 };
    }
    this.sync(true);
  }

  // -- per step --------------------------------------------------------------
  step(dt, car) {
    // A front wing that has come off is not a decal: it is a wing lying on the
    // road, in the way, for you and for everyone behind you. This is the one
    // prop the GAME spawns rather than the track.
    if (car?.lost?.frontWing && !this.lastWing) {
      const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
      const w = this.world.spawn('wing', car.x + cs * 2.4, car.y + sn * 2.4, {
        z: this.heightAt(car.x, car.y) + 0.3, hdg: car.hdg,
        vx: car.vx * cs * 0.4, vy: car.vx * sn * 0.4, vz: 1.4, w: 2.5,
      });
      w.spawned = true;
    }
    this.lastWing = !!car?.lost?.frontWing;
    return this.world.step(dt, car ? [car] : []);
  }

  /** Let what is already moving come to rest while nobody is driving. */
  settle(dt) {
    if (this.world.awake > 0) this.world.step(Math.min(dt, 0.05), []);
  }

  // -- matrices --------------------------------------------------------------
  sync(all = false) {
    for (const kind in this.meshes) this.meshes[kind].n = 0;
    for (const p of this.world.props) {
      if (!p.alive) continue;
      const slot = this.meshes[p.kind];
      if (!slot || slot.n >= slot.max) continue;
      const i = slot.n++;
      if (!all && !p.moved && p.slot === i) continue;
      p.slot = i;
      p.moved = false;
      // Tumbling is drawn, not simulated: `spin` about an axis in the ground
      // plane, which is enough to sell a cone cartwheeling down the road.
      this._e.set(Math.cos(p.spinAxis) * p.spin, p.hdg, Math.sin(p.spinAxis) * p.spin, 'YXZ');
      this._q.setFromEuler(this._e);
      this._p.copy(V(p.x, p.y, p.z));
      const sq = 1 - p.squash * 0.72;
      this._s.set(1 + p.squash * 0.35, sq, 1 + p.squash * 0.35);
      this._m.compose(this._p, this._q, this._s);
      slot.mesh.setMatrixAt(i, this._m);
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const kind in this.meshes) {
      const slot = this.meshes[kind];
      if (slot.mesh.count !== slot.n) slot.mesh.count = slot.n;
    }
  }

  stats() {
    const s = this.world.stats();
    return { ...s, kinds: Object.keys(this.meshes).length };
  }
}

export { KIND };
