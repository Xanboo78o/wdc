// pit.js — the pit lane, and eleven garages with the team's day in them.
//
// The centreline of the lane is not invented: it is the real
// `highway=raceway, service=pit_lane` way from OpenStreetMap, baked in the same
// projection as the circuit, so it enters and leaves the track exactly where it
// does in life. `track.pit.pts` is that survey.
//
// What is built on top of it is the stuff you can see from a car going past at
// 80 km/h with the limiter on: the fast lane and the working lane, eleven
// numbered boxes, a garage block with its doors up, and inside each one tyre
// stacks, trolleys, a bench, a wall of monitors, a spare front wing on a rack,
// a lit ceiling and a crew standing around waiting for a car that is still out
// on track. A garage with nothing in it is a car park with a roof.
//
// ---------------------------------------------------------------------------
// One thing that had to be measured rather than trusted: the BAKED
// `pit.side` flag does not say which side of the circuit the lane is on. It is
// wrong at Monza (says left, the surveyed lane is 17.3 m to the RIGHT), at
// Suzuka (says left, is 14.0 m right) and at Baku (says right, is 7.5 m left)
// — three of five. `js/track.js` now derives it from the lane's own geometry
// in the Track constructor and keeps the original as `pit.sideRaw`, so
// `pit.side` is safe to read and `pit.offset` gives the distance as well as
// the sign. The garages go on the far side of the lane from the track.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { peopleMesh } from './crowd.js';
import { printMat } from './furniture.js';
import { resampleLane as resample, BOX_PITCH, MAX_BOXES } from './pitstop.js';

const LANE_TRACK = 5.6;      // metres of lane on the track side of the centreline
const LANE_BOX = 6.6;        // metres on the garage side — the working lane
const FAST_LANE = 3.8;       // the bit you are allowed to drive down
const GARAGE_DEPTH = 13.0;
const GARAGE_H = 6.4;
const DOOR_W = 9.2, DOOR_H = 4.3;

const CREW = [0xd8352a, 0x1b4fd8, 0xf5c518, 0x35d6a0, 0xe8eaee, 0xff6b1a, 0x7b2fd8];

// ---------------------------------------------------------------------------
// Resample the surveyed pit way to an even step and smooth it. OSM traces a
// pit lane with nodes wherever the surveyor clicked — Monza's has 21 points
// over 737 m and Monaco's 146 over 562 — and geometry laid on that directly
// has visible kinks where a 40 m straight meets a 3 m one.
// ---------------------------------------------------------------------------
// The lane polyline and the garage numbers are js/pitstop.js's, so the garages
// drawn here are exactly where the race stops each car (garageLayout).
function headings(pts) {
  const h = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    h[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }
  return h;
}

// The pit corridor, in sim metres, for anything that needs to keep out of the
// way of it. Monza has 81 OSM buildings tagged `garage` right where the real
// pit block stands, and without this the synthetic garages are built straight
// through a brick wall — which is exactly how the first screenshot came out.
export function pitCorridor(track) {
  const pit = track.pit;
  if (!pit || !pit.pts || pit.pts.length < 3) return null;
  return {
    pts: resample(pit.pts, 6),
    radius: LANE_BOX + GARAGE_DEPTH + 4,   // how far out the buildings stop
    wallClear: LANE_TRACK + 3.5,           // how close a barrier may come
  };
}

// ---------------------------------------------------------------------------
export function buildPitLane(scene, track, look, sign, world = null) {
  const pit = track.pit;
  if (!pit || !pit.pts || pit.pts.length < 3) return null;

  const P = resample(pit.pts, 2);
  const H = headings(P);
  // Which side of the circuit the lane is on. `Track` derives this in its
  // constructor now rather than reading the baked flag, which was wrong on
  // three of the five circuits — Monza says left and the surveyed lane is
  // 17.3 m to the right. `pit.offset` carries the distance too, if a future
  // pass wants the number rather than the sign.
  const away = pit.side || 1;

  // A point `lat` metres to the side of pit sample i, in three-space. Positive
  // lat is toward the garages, whichever side of the circuit that is.
  const at = (i, lat) => {
    const h = H[i], k = lat * away;
    return [P[i][0] - Math.sin(h) * k, Z(P[i][1] + Math.cos(h) * k)];
  };
  // Unit vector pointing from the lane toward the garages, in three-space.
  const inDir = i => {
    const h = H[i];
    return [-Math.sin(h) * away, 0, -Math.cos(h) * away];
  };
  const fwdDir = i => [Math.cos(H[i]), 0, -Math.sin(H[i])];

  const surface = new Builder();
  const paint = new Builder();
  const shell = new Builder();
  const floor = new Builder();
  // These two carry a colour PER OBJECT, so they are built with vertex colours
  // on. Without that the colour argument on every box is silently dropped and
  // a garage full of red tool trolleys comes out as grey stone blocks — which
  // is exactly what the first screenshot showed.
  const kit = new Builder({ color: true });   // benches, trolleys, racks
  const dark = new Builder({ color: true });  // monitors, rubber, shadowed panels
  const canopy = new Builder();     // the pit wall roof
  const glow = new Builder();       // ceiling strips
  const boards = new Builder();     // team names, over the doors
  const tyreSpots = [];
  const crewSpots = [];

  // --- the lane itself ------------------------------------------------------
  for (let i = 0; i < P.length - 1; i++) {
    surface.quadUp([
      at(i, -LANE_TRACK), at(i + 1, -LANE_TRACK), at(i + 1, LANE_BOX), at(i, LANE_BOX),
    ], -0.004);
  }
  // Fast-lane line, box-area edge line, and the outer edge. Painted lines are
  // what make a pit lane legible as a pit lane rather than a wide grey road.
  const stripe = (lat, width, y) => {
    for (let i = 0; i < P.length - 1; i++) {
      paint.quadUp([
        at(i, lat - width / 2), at(i + 1, lat - width / 2),
        at(i + 1, lat + width / 2), at(i, lat + width / 2),
      ], y);
    }
  };
  stripe(-LANE_TRACK + 0.12, 0.14, 0.008);
  stripe(-LANE_TRACK + FAST_LANE, 0.14, 0.008);
  stripe(LANE_BOX - 0.12, 0.14, 0.008);

  // --- the boxes ------------------------------------------------------------
  // Garages sit in the middle of the lane, because the ends of a pit lane are
  // the entry and exit tapers and nothing is parked on them.
  const lanePts = P.length;
  const usable = (lanePts - 1) * 2;                    // metres, step was 2 m
  const boxes = Math.max(3, Math.min(MAX_BOXES, Math.floor((usable - 120) / BOX_PITCH)));
  const span = boxes * BOX_PITCH;
  const startM = Math.max(30, (usable - span) / 2);
  const idxAt = m => Math.max(0, Math.min(lanePts - 1, Math.round(m / 2)));
  const teams = track.sponsors && track.sponsors.length ? track.sponsors : ['CHASING WDC'];

  // The garage block: one continuous building behind all the boxes, with a
  // door cut out of the front for each one.
  const iA = idxAt(startM), iB = idxAt(startM + span);
  for (let i = iA; i < iB; i++) {
    // floor of the working area and the garage
    floor.quadUp([
      at(i, LANE_BOX), at(i + 1, LANE_BOX),
      at(i + 1, LANE_BOX + GARAGE_DEPTH), at(i, LANE_BOX + GARAGE_DEPTH),
    ], 0.02);
    // ceiling, seen from inside through the open door
    shell.quadUp([
      at(i + 1, LANE_BOX), at(i, LANE_BOX),
      at(i, LANE_BOX + GARAGE_DEPTH), at(i + 1, LANE_BOX + GARAGE_DEPTH),
    ], DOOR_H + 0.5);
    // the back wall and the roof
    const a = at(i, LANE_BOX + GARAGE_DEPTH), b = at(i + 1, LANE_BOX + GARAGE_DEPTH);
    shell.quadN([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], GARAGE_H, b[1]], [a[0], GARAGE_H, a[1]],
      [[0, 0], [2, 0], [2, GARAGE_H], [0, GARAGE_H]]);
    shell.quadUp([
      at(i, LANE_BOX), at(i + 1, LANE_BOX),
      at(i + 1, LANE_BOX + GARAGE_DEPTH + 1.2), at(i, LANE_BOX + GARAGE_DEPTH + 1.2),
    ], GARAGE_H);
    // a parapet, so the roof has an edge instead of ending in nothing
    const c = at(i, LANE_BOX + GARAGE_DEPTH + 1.2), d = at(i + 1, LANE_BOX + GARAGE_DEPTH + 1.2);
    shell.quadN([c[0], GARAGE_H, c[1]], [d[0], GARAGE_H, d[1]],
      [d[0], GARAGE_H + 0.9, d[1]], [c[0], GARAGE_H + 0.9, c[1]],
      [[0, 0], [2, 0], [2, 0.9], [0, 0.9]]);
  }

  for (let k = 0; k < boxes; k++) {
    const m0 = startM + k * BOX_PITCH;
    const i0 = idxAt(m0), i1 = idxAt(m0 + BOX_PITCH);
    const iMid = idxAt(m0 + BOX_PITCH / 2);
    const F = fwdDir(iMid), G = inDir(iMid);
    const centre = at(iMid, LANE_BOX);
    const ry = H[iMid];          // Builder.box's ry IS rotation.y — see geom.js

    // --- the facade: a wall with a door-shaped hole in it -------------------
    // Built as four panels around the opening rather than as a wall with a
    // texture of a door on it, because you have to be able to SEE IN. That is
    // the entire point of the request.
    const pierW = (BOX_PITCH - DOOR_W) / 2;
    const face = (from, to, y0, y1) => {
      const a = at(idxAt(from), LANE_BOX), b = at(idxAt(to), LANE_BOX);
      shell.quadN([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]],
        [[0, y0], [Math.hypot(b[0] - a[0], b[1] - a[1]), y0], [Math.hypot(b[0] - a[0], b[1] - a[1]), y1], [0, y1]]);
    };
    face(m0, m0 + pierW, 0, GARAGE_H);                       // pier, left
    face(m0 + pierW + DOOR_W, m0 + BOX_PITCH, 0, GARAGE_H);  // pier, right
    face(m0 + pierW, m0 + pierW + DOOR_W, DOOR_H, GARAGE_H); // lintel over the door

    // The wall between this box and the next. Without partitions the whole
    // block is one 160 m tunnel, and looking into any door shows you every
    // other team's garage stretching off to the horizon.
    {
      const a = at(i0, LANE_BOX), b = at(i0, LANE_BOX + GARAGE_DEPTH);
      shell.quadN([a[0], 0, a[1]], [b[0], 0, b[1]],
        [b[0], DOOR_H + 0.5, b[1]], [a[0], DOOR_H + 0.5, a[1]],
        [[0, 0], [GARAGE_DEPTH, 0], [GARAGE_DEPTH, DOOR_H + 0.5], [0, DOOR_H + 0.5]]);
    }
    void i1;

    // The rolled-up door itself, a drum above the opening.
    const drum = at(idxAt(m0 + BOX_PITCH / 2), LANE_BOX + 0.35);
    kit.box(drum[0], DOOR_H + 0.28, drum[1], DOOR_W - 0.3, 0.5, 0.5, ry, 0xb9bec4, 1);

    // --- the team board over the door --------------------------------------
    if (sign) {
      const cell = sign.cells.sponsors[k % sign.cells.sponsors.length];
      const a = at(idxAt(m0 + pierW + 0.3), LANE_BOX - 0.06);
      const b = at(idxAt(m0 + pierW + DOOR_W - 0.3), LANE_BOX - 0.06);
      boards.quadN([a[0], DOOR_H + 0.75, a[1]], [b[0], DOOR_H + 0.75, b[1]],
        [b[0], DOOR_H + 1.85, b[1]], [a[0], DOOR_H + 1.85, a[1]],
        sign.atlas.uv(cell, true));
    }

    // --- the box marking on the lane ---------------------------------------
    const bx0 = at(idxAt(m0 + 1.4), -0.2), bx1 = at(idxAt(m0 + BOX_PITCH - 1.4), -0.2);
    const ex0 = at(idxAt(m0 + 1.4), LANE_BOX - 0.6), ex1 = at(idxAt(m0 + BOX_PITCH - 1.4), LANE_BOX - 0.6);
    for (const [p, q] of [[bx0, bx1], [ex0, ex1]]) {
      paint.quadUp([[p[0], p[1]], [q[0], q[1]],
        [q[0] + G[0] * 0.14, q[1] + G[2] * 0.14], [p[0] + G[0] * 0.14, p[1] + G[2] * 0.14]], 0.008);
    }

    // --- what is actually in the garage ------------------------------------
    // Everything is positioned in the box's own frame: `F` runs along the pit
    // lane, `G` runs back into the garage.
    const put = (alongM, depthM) => {
      const p = at(idxAt(m0 + alongM), LANE_BOX);
      return [p[0] + G[0] * depthM, p[1] + G[2] * depthM];
    };

    // The bench along the back wall, with a shelf over it.
    const bench = put(BOX_PITCH / 2, GARAGE_DEPTH - 0.6);
    kit.box(bench[0], 0.46, bench[1], BOX_PITCH - 2.6, 0.92, 0.7, ry, 0xb2b7bd, 1);
    kit.box(bench[0], 1.95, bench[1], BOX_PITCH - 3.4, 0.08, 0.55, ry, 0x9aa0a6, 1);

    // A wall of monitors above the bench — the thing every garage shot has in
    // the background.
    for (let s = -1; s <= 1; s++) {
      const p = put(BOX_PITCH / 2 + s * 2.3, GARAGE_DEPTH - 0.35);
      dark.box(p[0], 2.75, p[1], 1.9, 1.05, 0.12, ry, 0x14161a, 1);
    }

    // Tool trolleys, out on the floor where they get used.
    for (const [a, d] of [[3.0, 4.4], [BOX_PITCH - 3.0, 4.4], [2.6, 8.6]]) {
      const p = put(a, d);
      kit.box(p[0], 0.52, p[1], 0.66, 1.04, 1.05, ry + 0.12, 0xd8352a, 1);
      dark.box(p[0], 1.09, p[1], 0.70, 0.08, 1.09, ry + 0.12, 0x2a2e34, 1);
    }

    // A spare front wing on a low rack. Unmistakable silhouette, six boxes.
    const wing = put(BOX_PITCH - 3.2, 9.2);
    kit.box(wing[0], 0.30, wing[1], 0.14, 0.60, 1.6, ry, 0x8f959c, 1);
    dark.box(wing[0], 0.68, wing[1], 0.42, 0.06, 1.9, ry, 0x17181c, 1);
    dark.box(wing[0], 0.80, wing[1], 0.30, 0.05, 1.7, ry, 0x17181c, 1);

    // The ceiling light strips. Sunlight cannot reach 13 m into a garage, so
    // without these the inside of every box is a black rectangle and all of
    // this work is invisible from the lane.
    for (const d of [3.4, 7.2, 10.8]) {
      const p = put(BOX_PITCH / 2, d);
      glow.box(p[0], DOOR_H + 0.34, p[1], BOX_PITCH - 4.0, 0.12, 0.42, ry, 0xffffff, 1);
    }

    // Tyres: two stacks of four either side of the door, and a loose pair.
    for (const [a, d, n] of [[2.2, 2.0, 4], [BOX_PITCH - 2.2, 2.0, 4], [BOX_PITCH / 2 - 3.4, 6.4, 3]]) {
      const p = put(a, d);
      const gy = world ? world.heightAt(p[0], p[1]) : 0;
      for (let s = 0; s < n; s++) tyreSpots.push({ x: p[0], z: p[1], y: gy + 0.16 + s * 0.30, ry: ry + s * 0.5 });
    }

    // The crew. Standing, facing the lane, because the car is still out.
    for (const [a, d] of [[4.2, 2.2], [BOX_PITCH - 4.6, 2.6], [BOX_PITCH / 2, 5.6]]) {
      const p = put(a, d);
      crewSpots.push({
        x: p[0], z: p[1], y: (world ? world.heightAt(p[0], p[1]) : 0) + 0.02,
        ry: ry + Math.PI + (Math.random() - 0.5) * 0.8, seated: false, scale: 0.98,
      });
    }
  }

  // --- the pit wall, and the stand on it ------------------------------------
  // On the track side of the lane, which is where the engineers sit with the
  // race on a screen in front of them.
  for (let i = 0; i < P.length - 1; i++) {
    const a = at(i, -LANE_TRACK), b = at(i + 1, -LANE_TRACK);
    shell.quadN([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 1.05, b[1]], [a[0], 1.05, a[1]],
      [[0, 0], [2, 0], [2, 1.05], [0, 1.05]]);
  }
  // One stand PER TEAM, not one continuous 160 m awning. A single unbroken
  // canopy runs the length of the pit straight, sits just above eye height and
  // becomes the largest object on screen from inside the lane — and it is not
  // what a pit wall looks like anyway. Real stands are separate boxes with gaps
  // between them, which is also what lets you see the track through them.
  for (let k = 0; k < boxes; k++) {
    const m0 = startM + k * BOX_PITCH + 2.6;
    const mEnd = m0 + BOX_PITCH - 5.2;
    const i0 = idxAt(m0), i1 = idxAt(mEnd);
    for (let i = i0; i < i1; i++) {
      shell.quadUp([
        at(i, -LANE_TRACK), at(i + 1, -LANE_TRACK),
        at(i + 1, -LANE_TRACK + 2.2), at(i, -LANE_TRACK + 2.2),
      ], 1.05);
      canopy.quadUp([
        at(i + 1, -LANE_TRACK - 0.4), at(i, -LANE_TRACK - 0.4),
        at(i, -LANE_TRACK + 2.0), at(i + 1, -LANE_TRACK + 2.0),
      ], 3.05);
      // an underside and a fascia, so it is a roof and not a plane with no
      // thickness seen edge-on
      canopy.quadUp([
        at(i, -LANE_TRACK - 0.4), at(i + 1, -LANE_TRACK - 0.4),
        at(i + 1, -LANE_TRACK + 2.0), at(i, -LANE_TRACK + 2.0),
      ], 2.88);
      const a = at(i, -LANE_TRACK - 0.4), b = at(i + 1, -LANE_TRACK - 0.4);
      canopy.quadN([a[0], 2.88, a[1]], [b[0], 2.88, b[1]], [b[0], 3.05, b[1]], [a[0], 3.05, a[1]],
        [[0, 0], [2, 0], [2, 0.17], [0, 0.17]]);
    }
    // legs at both ends of this team's canopy
    for (const m of [m0 + 0.4, mEnd - 0.4]) {
      const p = at(idxAt(m), -LANE_TRACK + 1.9);
      kit.box(p[0], 2.0, p[1], 0.16, 1.95, 0.16, H[idxAt(m)], 0xc8ccd2, 1);
    }
    // four engineers with a monitor each, facing the track
    for (let e = 0; e < 4; e++) {
      const m = m0 + 1.1 + e * ((mEnd - m0 - 2.2) / 3);
      const i = idxAt(m);
      const ry = H[i];
      const d = at(i, -LANE_TRACK + 0.5);
      dark.box(d[0], 1.62, d[1], 0.58, 0.40, 0.10, ry, 0x14161a, 1);
      const q = at(i, -LANE_TRACK + 1.4);
      crewSpots.push({ x: q[0], z: q[1], y: (world ? world.heightAt(q[0], q[1]) : 0) + 1.07, ry: ry + Math.PI, seated: true, scale: 0.98 });
    }
  }

  // --- a PIT LANE sign at the entry ----------------------------------------
  if (sign) {
    const i = idxAt(6);
    const a = at(i, -LANE_TRACK - 0.1), b = at(idxAt(16), -LANE_TRACK - 0.1);
    boards.quadN([a[0], 1.15, a[1]], [b[0], 1.15, b[1]], [b[0], 2.05, b[1]], [a[0], 2.05, a[1]],
      sign.atlas.uv(sign.cells.pit, true));
  }

  // --- materials ------------------------------------------------------------
  const add = (b, mat, opts, name) => {
    const m = b.mesh(mat, opts);
    if (m) {
      // Onto the height field, NOT the sunk ground: the pit lane is a surface
      // cars drive on and they take their height from the same field the road
      // does. Sinking it with the grass would float every car in the lane.
      // The Monaco pit lane still climbs with the hill it is cut into.
      if (world) world.lift(m.geometry);
      m.name = 'pit.' + (name || 'part');
      scene.add(m);
    }
    return m;
  };

  add(surface, look.mat('apron', {
    size: 3.0, tint: 0x8b8e93, roughness: 0.95, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  }), { shadow: false }, 'surface');
  add(paint, new THREE.MeshStandardMaterial({
    color: 0xe6e6e2, roughness: 0.8, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
  }), { shadow: false }, 'paint');
  add(floor, look.mat('concrete', { size: 3.0, tint: 0xbdbfc2, roughness: 0.55, side: THREE.DoubleSide }), { shadow: false }, 'floor');
  add(shell, look.mat('concrete', { size: 3.4, tint: 0xd2d4d7, roughness: 0.92, side: THREE.DoubleSide }), undefined, 'shell');
  add(canopy, look.mat('metal', { size: 2.6, tint: 0x4a4f55, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }), undefined, 'canopy');
  add(kit, look.mat('metal', { size: 1.6, vertexColors: true, roughness: 0.55, metalness: 0.7 }), undefined, 'kit');
  add(dark, look.mat('metal', { size: 1.2, vertexColors: true, roughness: 0.4, metalness: 0.5 }), undefined, 'dark');
  // The ceiling strips are emissive rather than lit — they ARE the light in
  // there, and adding eleven real point lights to save a texture trick would
  // cost more than the rest of this module put together.
  add(glow, new THREE.MeshStandardMaterial({
    color: 0xfff6e6, emissive: 0xfff2dc, emissiveIntensity: 1.35, roughness: 0.4,
  }), { shadow: false }, 'glow');
  if (sign) {
    add(boards, printMat(sign.texture, { roughness: 0.65 }), { shadow: false }, 'boards');
  }

  // Tyres: one instanced mesh for every tyre in every garage.
  if (tyreSpots.length) {
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 12, 1, true);
    const mat = look.mat('metal', { size: 0.9, tint: 0x191a1e, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, tyreSpots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    tyreSpots.forEach((t, i) => {
      q.setFromAxisAngle(up, t.ry);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, s);
      mesh.setMatrixAt(i, m4);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }

  const crew = peopleMesh(crewSpots, { palette: CREW });
  if (crew) scene.add(crew);

  // ---- YOUR GARAGE ---------------------------------------------------------
  // Adam, 2026-10-04: "make my pitbox show no matter the team". The race gives
  // every team a garage and YOU the spare one (js/race.js `me.garage`), but the
  // boards over the doors are the circuit's sponsors, so nothing said which
  // door was yours. This is built before any race exists, so the marking is a
  // call the game makes once it knows who you are and where you stop:
  //
  //   pit.markPlayer(me.garage, team ? team.name : null, team ? team.col : null,
  //                  { fg: team && team.fg, mark: me.box % 2 })
  //
  // Your name board over the door (in front of the sponsor's), a light bar in
  // your colour above it, your stop box painted on the lane where the car
  // actually stops, and the lollipop at its nose. Call it again and the old
  // marking is replaced; markPlayer(null) takes it away.
  let mine = null;
  const markPlayer = (garage, teamName = null, teamColour = null, { fg = null, mark = 0 } = {}) => {
    if (mine) {
      scene.remove(mine);
      mine.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      mine = null;
    }
    if (garage == null || !(garage >= 0)) return null;
    const k = Math.min(boxes - 1, Math.floor(garage));
    const col = new THREE.Color(teamColour || '#f2c230');
    const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;      // linear
    const ink = fg || (lum > 0.35 ? '#0b0d10' : '#ffffff');
    const rgb = [col.r, col.g, col.b];
    const m0 = startM + k * BOX_PITCH, pierW = (BOX_PITCH - DOOR_W) / 2;
    const iMid = idxAt(m0 + BOX_PITCH / 2), G = inDir(iMid), F = fwdDir(iMid), ry = H[iMid];
    const group = new THREE.Group();
    group.name = 'pit.player';
    const finish = (b, mat, name) => {
      const m = b.mesh(mat, { shadow: false, receive: false });
      if (!m) return;
      if (world) world.lift(m.geometry);
      m.name = 'pit.player.' + name;
      group.add(m);
    };

    // -- the board: drawn once, the right way round from the lane --------------
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    const g2 = cv.getContext('2d');
    g2.fillStyle = '#' + col.getHexString(); g2.fillRect(0, 0, 1024, 128);
    g2.fillStyle = ink; g2.fillRect(0, 0, 1024, 8); g2.fillRect(0, 120, 1024, 8);
    const label = String(teamName || 'YOUR GARAGE').toUpperCase();
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    let px = 84;
    do { g2.font = `900 ${px}px system-ui, "Helvetica Neue", Arial, sans-serif`; px -= 4; } while (g2.measureText(label).width > 940 && px > 28);
    g2.fillText(label, 512, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    {
      const a = at(idxAt(m0 + pierW + 0.3), LANE_BOX - 0.20), b = at(idxAt(m0 + pierW + DOOR_W - 0.3), LANE_BOX - 0.20);
      // Seen from the lane, looking INTO the garage along G, your right hand
      // is (-G.z, G.x). The text must start at whichever end is on your left,
      // and which end that is depends on the side of the circuit the pits are.
      const aOnRight = (a[0] - b[0]) * -G[2] + (a[1] - b[1]) * G[0] > 0;
      const [l, r] = aOnRight ? [b, a] : [a, b];
      const y0 = DOOR_H + 0.75, y1 = DOOR_H + 1.85;
      const bd = new Builder();
      bd.quadN([l[0], y0, l[1]], [r[0], y0, r[1]], [r[0], y1, r[1]], [l[0], y1, l[1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      finish(bd, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }), 'board');
    }

    // -- the light bar, the stop box and the lollipop, in your colour ----------
    const bar = new Builder({ color: true });
    const mid = at(iMid, LANE_BOX - 0.32);
    bar.box(mid[0], DOOR_H + 2.06, mid[1], DOOR_W - 0.6, 0.22, 0.14, ry, rgb, 1);
    // Where the car STOPS: on the lane centre, at its mark (js/pitstop.js puts
    // a team's two cars 3.6 m either side of the garage centre).
    const stopM = m0 + BOX_PITCH / 2 + (mark ? 3.6 : -3.6);
    const c = at(idxAt(stopM), 0), HL = 3.1, HW = 1.35, T = 0.16;
    const corner = (u, v) => [c[0] + F[0] * u + G[0] * v, c[1] + F[2] * u + G[2] * v];
    const strip = (u0, v0, u1, v1) => bar.quadUp([corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)], 0.014, rgb);
    strip(-HL, -HW, HL, -HW + T); strip(-HL, HW - T, HL, HW);          // the two long sides
    strip(-HL, -HW, -HL + T, HW); strip(HL - T, -HW, HL, HW);          // the two ends
    strip(HL - 0.55, -HW, HL - 0.55 + T, HW);                          // the line your front axle stops on
    // The lollipop: a pole beside the nose with the board turned to face you.
    const lp = corner(HL + 0.5, HW + 0.55);
    bar.box(lp[0], 1.0, lp[1], 0.06, 2.0, 0.06, ry, [0.12, 0.12, 0.13], 1);
    bar.box(lp[0], 2.15, lp[1], 0.05, 0.62, 0.62, ry, rgb, 1);
    finish(bar, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4,
    }), 'marks');

    scene.add(group);
    mine = group;
    return { garage: k, label, mark, at: { x: c[0], z: c[1] } };
  };

  return { boxes, points: P.length, crew: crewSpots.length, tyres: tyreSpots.length, teams: teams.length, markPlayer };
}
