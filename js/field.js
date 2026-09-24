// field.js — the other twenty-one cars, on screen.
//
// js/race.js has been able to run a full twenty-two car race since the day it
// was written, and the only place anyone could watch it was a table of numbers
// in a terminal. This is the file that puts it in front of the windscreen.
//
// It owns nothing about racing. It is handed the race's entries every frame and
// it draws them: where the car is, which way it points, how far the wheels have
// turned, which bodywork has folded and which wing has left. Every one of those
// is read off the same car object the physics writes, never interpolated,
// never smoothed, never invented. If a bot looks wrong on screen the sim is
// wrong, and that is the point — a renderer that quietly tidies up its inputs
// is a renderer that hides the bugs you most need to see.
//
// ---------------------------------------------------------------------------
// WHY THERE IS ONE REFERENCE CAR AND TWENTY-ONE CLONES
//
// `buildCar` does real work: it lofts the body, and it paints a 1024x1024
// sponsor atlas on a canvas and uploads it. That is entirely reasonable once.
// Twenty-two times it is twenty-two megabytes of identical decals sitting in
// video memory to say FOGLAST on twenty-two sets of sidepods.
//
// So the field is built ONCE and cloned. `Object3D.clone(true)` shares geometry
// and materials by reference and copies the transform hierarchy, which is
// exactly the split we want: the shapes and the stickers are common, and the
// per-car state — position, wheel angle, crumple — lives in the transforms,
// which are not shared.
//
// The one thing that must not be shared is the paint, because a grid in one
// colour is not a grid. Each car gets its own clone of the paint material.
// Finding which material that is has to survive someone reordering car.js, so
// it is found BY COLOUR: the reference car is built in a known colour and every
// material wearing it is a paint material. The livery atlas keeps the reference
// colour in the number roundel on every car — a 22 cm disc on the nose, and the
// price of not uploading twenty-two atlases.
import * as THREE from 'three';
import { Z } from './geom.js';
import { bankY, bankRoll } from './bank.js';
import { buildCar, buildGT3 } from './car.js';
import { carLamps } from './lamps.js';
import { crushParts, applyCrush } from './render.js';

// ---------------------------------------------------------------------------
// AND WHY THERE ARE TWO VERSIONS OF EVERY CAR
//
// Measured, before any of this existed: one car on track at Monza is 161 draw
// calls a frame. Twenty-two is 1425. The car is about fifty-seven separate
// meshes — every winglet, every sticker, every wheel face — and the shadow pass
// draws all of them a second time. Triangles were never the problem; the count
// of things handed to the GPU was, which is what the other session guessed and
// the measurement confirmed.
//
// So a car is built twice. The full one keeps its fifty-seven parts, because
// that is what lets it fold when it hits a wall. The distant one is the same
// geometry merged down to one mesh per material — about nine draws — and it
// cannot crumple, which is a fact nobody can see from sixty metres away. The
// merge happens ONCE, on the reference car, and every rival shares it; only the
// paint is per-car.
//
// The same logic decides shadows. A car casts one when it is close enough for
// you to see whether it does.
const REF_COLOUR = 0xd8352a;
const ACK = 0.13;            // Ackermann — the inside wheel takes more angle
const DRAW_RANGE = 900;      // metres from the camera before a car stops drawing
const DETAIL_RANGE = 90;     // ...before it drops to the merged version
const MAX_DETAIL = 4;        // ...and at most this many are the full model
const SHADOW_RANGE = 60;     // ...before it stops casting a shadow

/**
 * Flatten a car down to one geometry per material.
 *
 * Everything is baked into the car's own frame, so the result is a rigid model:
 * the wheels no longer turn and the bodywork no longer folds. That is the whole
 * trade. Non-indexed throughout, because concatenating two indexed geometries
 * means renumbering one of them and there is no reason to.
 */
function mergeByMaterial(root) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mx = new THREE.Matrix4();
  const groups = new Map();

  root.traverse(m => {
    if (!m.isMesh || !m.geometry) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    mx.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(mx);
    let bin = groups.get(mat);
    if (!bin) { bin = { pos: [], nrm: [], uv: [], order: m.renderOrder }; groups.set(mat, bin); }
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count * 3; i++) bin.pos.push(p.array[i]);
    // A geometry with no normals would light as flat black rather than not
    // render, which is the kind of failure that gets blamed on the material.
    for (let i = 0; i < p.count * 3; i++) bin.nrm.push(n ? n.array[i] : 0);
    for (let i = 0; i < p.count * 2; i++) bin.uv.push(u ? u.array[i] : 0);
    g.dispose();
  });

  const out = [];
  for (const [mat, bin] of groups) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin.nrm), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin.uv), 2));
    g.computeBoundingSphere();
    out.push({ geo: g, mat, order: bin.order });
  }
  return out;
}

// Walk two identical trees together. `clone(true)` preserves child order, so
// this is a reliable way to say "the object that corresponds to that one" —
// which is how the wheels, the steering pivots and the DRS flap are found again
// on a clone without car.js having to name anything.
function zip(a, b, map) {
  map.set(a, b);
  const n = Math.min(a.children.length, b.children.length);
  for (let i = 0; i < n; i++) zip(a.children[i], b.children[i], map);
}

export class Field {
  /**
   * @param {View}  view    the renderer, for its scene, its lighting-aware
   *                        material cache, the surveyed ground and the banking
   * @param {Array} entries race.entries — the player's is skipped
   * @param {string} cls    the class being raced. A GT3 race was a grid of
   *                        GT3 physics wearing single-seater bodies.
   */
  constructor(view, entries, cls = 'f1') {
    this.view = view;
    this.track = view.track;
    this.rigs = [];

    const ref = cls === 'gt3' ? buildGT3(view.look, REF_COLOUR) : buildCar(view.look, REF_COLOUR);
    // Which materials are the paint? The ones wearing the reference colour.
    // Nothing else on the car is that red: the rims are grey, the hubs and the
    // visor near-black, the helmet off-white, and the carbon is a photograph.
    const paints = new Set();
    ref.group.traverse(m => {
      const mats = m.isMesh ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) if (mat && mat.color && mat.color.getHex() === REF_COLOUR) paints.add(mat);
    });
    this.ref = ref;
    this.refPaints = paints;
    // The distant version, merged once and shared by the whole grid.
    this.merged = mergeByMaterial(ref.group);
    // Where the lamps go: the reference car's own extent, shared by every clone.
    this.refBox = new THREE.Box3().setFromObject(ref.group);

    for (const e of entries) {
      if (e.isPlayer) { this.rigs.push(null); continue; }
      this.rigs.push(this.make(e.col));
    }
  }

  // One car, in one team's colour, parked at the origin until it is posed.
  make(colour) {
    const src = this.ref;

    // Repaint. One new material per car, cloned from the reference so it keeps
    // the clearcoat settings, the environment intensity and the texture maps.
    // Both versions of the car share it, so a rival cannot be two colours.
    const repainted = new Map();
    const swap = mat => {
      if (!this.refPaints.has(mat)) return mat;
      let got = repainted.get(mat);
      if (!got) { got = mat.clone(); got.color = new THREE.Color(colour); repainted.set(mat, got); }
      return got;
    };

    const full = src.group.clone(true);
    const map = new Map();
    zip(src.group, full, map);
    full.traverse(m => {
      if (!m.isMesh || !m.material) return;
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });

    // The distant version: nine-ish meshes instead of fifty-seven, sharing the
    // merged geometry with every other car on the grid.
    const lod = new THREE.Group();
    for (const part of this.merged) {
      const m = new THREE.Mesh(part.geo, swap(part.mat));
      m.renderOrder = part.order;
      m.castShadow = true;
      m.name = 'rival.far';
      lod.add(m);
    }
    lod.visible = false;

    const wheels = {}, steer = {};
    for (const k in src.wheels) wheels[k] = map.get(src.wheels[k]);
    for (const k in src.steer) steer[k] = map.get(src.steer[k]);
    const wings = src.wings
      ? { front: src.wings.front.map(m => map.get(m)), rear: src.wings.rear.map(m => map.get(m)) }
      : null;

    // Yaw on the parent, roll and pitch on the child — the same split render.js
    // makes for the player's car, and for the same reason: with three's default
    // XYZ Euler order, one object cannot carry all three without roll coming
    // out as pitch everywhere except heading zero. The tilt group is what both
    // versions of the car hang from, so swapping between them changes the level
    // of detail and nothing else.
    const tilt = new THREE.Group();
    tilt.add(full, lod);
    const yaw = new THREE.Group();
    yaw.name = 'rival';
    yaw.add(tilt);
    this.view.scene.add(yaw);

    return {
      yaw, tilt, full, lod, wheels, steer, wings,
      // head, tail and brake lights, on the tilt group so both LODs carry them
      lamps: carLamps(tilt, this.refBox),
      drs: src.drs ? map.get(src.drs) : null,
      crush: crushParts(full, wheels),
      R: src.R, spin: 0, crushAt: null,
      wasVisible: true, detail: true, shadows: true,
    };
  }

  // Shadows cost as much as the car itself — every mesh is drawn a second time
  // into the shadow map. A car far enough away that you cannot tell whether it
  // has a shadow does not need one.
  static setShadows(rig, on) {
    rig.yaw.traverse(m => { if (m.isMesh) m.castShadow = on; });
    rig.shadows = on;
  }

  /**
   * Draw the field. `dt` is a real frame time — wheel spin is cosmetic, so it
   * is allowed to be frame-rate dependent in a way the simulation never is.
   */
  frame(entries, dt) {
    const view = this.view, t = this.track;
    const cam = view.camera.position;
    const R2 = DRAW_RANGE * DRAW_RANGE;
    let drawn = 0;

    // Rank by distance first, because a distance THRESHOLD does not bound
    // anything. At the lights the whole grid is inside eight metres a car, so
    // any threshold generous enough to look right in a battle puts fourteen
    // full-detail cars on screen at the one moment the frame rate matters most.
    // Ranking gives a hard ceiling instead: the four cars you are actually
    // racing are the full model, everything else is the merged one, and the
    // cost of a start is the same as the cost of a straight.
    const d2 = this._d2 || (this._d2 = new Float64Array(entries.length));
    for (let k = 0; k < entries.length; k++) {
      const rig = this.rigs[k];
      if (!rig) { d2[k] = Infinity; continue; }
      const dx = entries[k].car.x - cam.x, dz = Z(entries[k].car.y) - cam.z;
      d2[k] = dx * dx + dz * dz;
    }
    // The MAX_DETAIL nearest, by insertion into a tiny fixed list. No sort, no
    // allocation, and twenty-one candidates is small enough that the constant
    // factors are the only thing that matters.
    const rank = this._rank || (this._rank = new Int32Array(MAX_DETAIL));
    let ranked = 0;
    for (let k = 0; k < entries.length; k++) {
      if (!this.rigs[k] || d2[k] > DETAIL_RANGE * DETAIL_RANGE) continue;
      let at = ranked < MAX_DETAIL ? ranked++ : -1;
      if (at < 0) { if (d2[k] >= d2[rank[MAX_DETAIL - 1]]) continue; at = MAX_DETAIL - 1; }
      while (at > 0 && d2[k] < d2[rank[at - 1]]) { rank[at] = rank[at - 1]; at--; }
      rank[at] = k;
    }
    const detailed = this._set || (this._set = new Set());
    detailed.clear();
    for (let i = 0; i < ranked; i++) detailed.add(rank[i]);

    for (let k = 0; k < entries.length; k++) {
      const rig = this.rigs[k];
      if (!rig) continue;                       // that one is the player
      const e = entries[k], car = e.car, proj = e.proj;

      // Cheap first: is it anywhere near? A car on the far side of Monza is
      // two kilometres away and there is no sense posing it, let alone letting
      // three walk its sixty meshes to find out it is off screen.
      if (d2[k] > R2) {
        if (rig.wasVisible) { rig.yaw.visible = false; rig.wasVisible = false; }
        continue;
      }
      if (!rig.wasVisible) { rig.yaw.visible = true; rig.wasVisible = true; }
      drawn++;

      const near = detailed.has(k);
      if (near !== rig.detail) {
        rig.full.visible = near; rig.lod.visible = !near; rig.detail = near;
      }
      const wantShadow = d2[k] < SHADOW_RANGE * SHADOW_RANGE;
      if (wantShadow !== rig.shadows) Field.setShadows(rig, wantShadow);

      // Height. The surveyed ground under the racing line, plus the camber of
      // whatever corner it is in, plus how far off the ground the car is —
      // `car.z` is height above the LOCAL road surface, so the three compose
      // with nothing to reconcile.
      const surfaceY = view.world.trackYAt(proj.s) + bankY(view.bank, t, proj.i, proj.lat);
      rig.yaw.position.set(car.x, surfaceY + (car.z || 0), Z(car.y));
      rig.yaw.rotation.y = car.hdg;

      const latG = Math.max(-5, Math.min(5, (car.vx * car.r) / 9.81));
      const grounded = car.airborne ? 0 : 1;
      rig.tilt.rotation.x = (car.roll || 0) + latG * 0.030
        + bankRoll(view.bank, t, proj.i, proj.lat) * grounded;
      rig.tilt.rotation.z = (car.pitch || 0) + car.gLong * 0.022;

      // Everything below here is a moving part, and the merged car has none.
      // Skipping it is most of the point of having a merged car at all.
      if (!near) continue;

      const dl = car.delta * (car.delta > 0 ? 1 + ACK : 1 - ACK);
      const dr = car.delta * (car.delta > 0 ? 1 - ACK : 1 + ACK);
      if (rig.steer.fl) rig.steer.fl.rotation.y = dl;
      if (rig.steer.fr) rig.steer.fr.rotation.y = dr;

      rig.spin -= car.speed * dt / rig.R;
      if (rig.lamps) rig.lamps.update(view.nightOn(), car.brake || 0);
      for (const w in rig.wheels) rig.wheels[w].rotation.z = rig.spin;

      if (rig.wings) {
        const lost = car.lost || {};
        for (const m of rig.wings.front) m.visible = !lost.frontWing;
        for (const m of rig.wings.rear) m.visible = !lost.rearWing;
      }
      if (rig.drs) rig.drs.rotation.z = car.drsOpen ? -1.0 : 0;

      // Crumple. Forty-odd parts move when this runs, so it runs when the
      // damage has actually changed — which for most of the grid is never.
      const c = car.crush;
      if (c) {
        const key = (c.front * 1e3 | 0) * 1e9 + (c.rear * 1e3 | 0) * 1e6
                  + (c.left * 1e3 | 0) * 1e3 + (c.right * 1e3 | 0);
        if (key !== rig.crushAt) { applyCrush(rig.crush, c); rig.crushAt = key; }
      }
    }
    this.drawn = drawn;
  }

  // Tyre smoke for the whole field, not just the car you are sitting in. The
  // renderer owns the particle pool; this only says where a rival is lighting
  // its rears up, using the same test the player's car uses — real slip past
  // the tyre's peak, never "a bot is cornering hard".
  smoke(entries, peak) {
    const view = this.view;
    for (let k = 0; k < entries.length; k++) {
      const rig = this.rigs[k];
      if (!rig || !rig.wasVisible) continue;
      const car = entries[k].car;
      const over = (Math.abs(car.slipR) - peak) / peak;
      if (over <= 0.15 || car.speed < 6) continue;
      if (Math.random() > Math.min(0.6, over * 0.8)) continue;
      const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
      const vwx = car.vx * cs - car.vy * sn, vwy = car.vx * sn + car.vy * cs;
      const sd = Math.random() < 0.5 ? 0.76 : -0.76;
      view.puff(car.x - cs * 1.30 - sn * sd, Z(car.y - sn * 1.30 + cs * sd),
                vwx, Z(vwy), Math.min(2, over * 3), rig.yaw.position.y);
    }
  }

  // Count what this actually costs to draw, for tools/raceperf.mjs and for the
  // `__wdc` block the headless check reads. Meshes, not triangles: the peer
  // session's instinct was that draw calls bite before triangles do on a grid
  // of identical cars, and this is the number that says whether that is true.
  cost() {
    let meshes = 0;
    this.ref.group.traverse(m => { if (m.isMesh) meshes++; });
    return {
      cars: this.rigs.filter(Boolean).length,
      meshesPerCar: meshes,
      farMeshesPerCar: this.merged.length,
    };
  }
}
