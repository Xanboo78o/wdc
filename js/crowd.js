// crowd.js — grandstands, and the people in them.
//
// The grandstands are not placed by hand and not scattered by a rule. They are
// the buildings OpenStreetMap tags `building=grandstand` at that circuit,
// standing exactly where they stand in real life: 44 of them at Monza, ringing
// the main straight and the Parabolica. Before this, they extruded as grey
// boxes along with the houses, which meant the single most recognisable thing
// about a circuit — a stand full of people facing you — was a warehouse.
//
// Everyone in this file is ONE instanced mesh. A person is 3 boxes and 36
// triangles, and 8,000 of them cost one draw call, which is what makes it
// affordable to fill the stands rather than sprinkle a token few.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';

const SEAT_PITCH = 0.62;     // metres between people along a row
const ROW_DEPTH = 0.92;      // metres between rows, front to back
const ROW_RISE = 0.42;       // how much each row is lifted above the last
const MAX_PEOPLE = 9000;

// Replica shirts, flags and sunburn. A real crowd photographs as noise with a
// few saturated dots in it, so the palette is mostly muted with a handful of
// loud entries that do the work at distance.
const SHIRTS = [
  0xd8352a, 0xe8eaee, 0x2a3138, 0x1b4fd8, 0xf5c518, 0x35d6a0, 0xb8452a,
  0x7c8591, 0xe0dcd2, 0x30363d, 0xff6b1a, 0x5a6470, 0xcfd3d8, 0x8b3a62,
];
const SKIN = [0xf0c8a0, 0xd9a273, 0xa9714b, 0x7a4b30, 0xf5d5b8, 0x5c3a24];

// ---------------------------------------------------------------------------
// A person: three boxes. At 40 m they are four pixels tall and at 400 m they
// are a coloured speck, so the budget goes into HOW MANY rather than how good.
// Exported because the pit crew are the same mesh with a different palette.
// ---------------------------------------------------------------------------
export function personGeometry() {
  const b = new Builder({ uv: false });
  b.box(0, 0.40, 0, 0.32, 0.80, 0.22, 0, 0xffffff, 1);   // legs
  b.box(0, 1.06, 0, 0.42, 0.56, 0.26, 0, 0xffffff, 1);   // torso
  const g = b.geometry();
  g.deleteAttribute('uv'); g.deleteAttribute('uv1');
  return g;
}

// The head is a SECOND instanced mesh rather than a third box on the first.
//
// An InstancedMesh has one colour per instance, so a person built as one mesh
// is one solid colour from shoe to scalp — a coloured pole. Two meshes sharing
// the same transforms cost one extra draw call for the entire crowd and are
// the difference between people and bollards.
export function headGeometry() {
  const b = new Builder({ uv: false });
  b.box(0, 1.45, 0, 0.21, 0.23, 0.20, 0, 0xffffff, 1);
  const g = b.geometry();
  g.deleteAttribute('uv'); g.deleteAttribute('uv1');
  return g;
}

// A crowd is a list of { x, z, y, ry, scale, seated }. This turns it into one
// mesh with a per-instance colour.
export function peopleMesh(spots, { palette = SHIRTS } = {}) {
  if (!spots.length) return null;
  // flatShading keeps the boxes reading as boxes rather than as soft blobs
  // once there are thousands of them overlapping.
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, flatShading: true });
  const body = new THREE.InstancedMesh(personGeometry(), bodyMat, spots.length);
  const head = new THREE.InstancedMesh(headGeometry(), headMat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    q.setFromAxisAngle(up, sp.ry);
    const sc = sp.scale ?? (0.92 + Math.random() * 0.16);
    // Sitting is modelled as being shorter, not as a second mesh. At the
    // distance you ever see a grandstand from, the difference between a seated
    // figure and a short one is nothing.
    s.set(sc, sc * (sp.seated ? 0.72 : 1), sc);
    v.set(sp.x, sp.y, sp.z);
    m.compose(v, q, s);
    body.setMatrixAt(i, m);
    head.setMatrixAt(i, m);
    c.setHex(palette[(Math.random() * palette.length) | 0]);
    body.setColorAt(i, c);
    c.setHex(SKIN[(Math.random() * SKIN.length) | 0]);
    head.setColorAt(i, c);
  }
  const g = new THREE.Group();
  for (const mesh of [body, head]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;    // 9,000 shadow casters is not worth one frame
    mesh.receiveShadow = false;
    g.add(mesh);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The minimum-area rectangle around a footprint.
//
// A grandstand's footprint is a quadrilateral that is almost never axis
// aligned, and everything about building one — which way the rows run, which
// way the seats face, where the roof goes — depends on knowing its long axis.
// Rotating calipers, cheaply: the minimum-area rectangle around a convex
// outline always has one side flush with an edge, so testing every edge
// direction finds it.
// ---------------------------------------------------------------------------
function obb(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const m = Math.hypot(dx, dy);
    if (m < 0.5) continue;
    const ux = dx / m, uy = dy / m;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const u = p[0] * ux + p[1] * uy;
      const v = -p[0] * uy + p[1] * ux;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      best = {
        area, ux, uy, u0, u1, v0, v1,
        // centre, back in world coordinates
        cx: ((u0 + u1) / 2) * ux - ((v0 + v1) / 2) * uy,
        cy: ((u0 + u1) / 2) * uy + ((v0 + v1) / 2) * ux,
        len: u1 - u0, dep: v1 - v0,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Turn one `building=grandstand` footprint into a raked stand facing the
// track, and return where everybody sits.
// ---------------------------------------------------------------------------
function stand(box, deck, roofB, track, ring, height, y0 = 0) {
  const o = obb(ring);
  if (!o || o.len < 6 || o.dep < 3) return [];

  // Which of the two long sides faces the circuit? Take the midpoint of each
  // and ask the track. Guessing from the footprint alone gets Monza's inner
  // stands backwards, and a stand with its back to the race is the single most
  // obviously wrong thing you can put beside a track.
  const perp = [-o.uy, o.ux];
  const mid = k => [o.cx + perp[0] * k, o.cy + perp[1] * k];
  const half = o.dep / 2;
  const dA = distToTrack(track, mid(half)), dB = distToTrack(track, mid(-half));
  const front = dA < dB ? half : -half;
  const sgn = Math.sign(front) || 1;

  const rows = Math.max(3, Math.min(26, Math.floor(o.dep / ROW_DEPTH)));
  const seats = [];
  // Rows step up and back from the front edge, which is what a raked stand is.
  for (let r = 0; r < rows; r++) {
    const off = front - sgn * (r + 0.5) * ROW_DEPTH;
    const y = y0 + 0.5 + r * ROW_RISE;
    const ax = o.cx + perp[0] * off, ay = o.cy + perp[1] * off;

    // The step itself: a tread to sit on and a riser under it.
    const treadA = [ax - o.ux * o.len / 2, ay - o.uy * o.len / 2];
    const treadB = [ax + o.ux * o.len / 2, ay + o.uy * o.len / 2];
    const bk = [perp[0] * -sgn * ROW_DEPTH, perp[1] * -sgn * ROW_DEPTH];
    deck.quadUp([
      [treadA[0], Z(treadA[1])], [treadB[0], Z(treadB[1])],
      [treadB[0] + bk[0], Z(treadB[1] + bk[1])], [treadA[0] + bk[0], Z(treadA[1] + bk[1])],
    ], y);
    // The riser under the tread. Its normal is derived from the winding, not
    // asserted: which way this faces is the product of three sign choices
    // (which end of the footprint, which side the track is on, which way the
    // rows climb) and getting it wrong lights the whole stand from inside.
    deck.quadN(
      [treadA[0], y - ROW_RISE, Z(treadA[1])], [treadB[0], y - ROW_RISE, Z(treadB[1])],
      [treadB[0], y, Z(treadB[1])], [treadA[0], y, Z(treadA[1])],
      [[0, 0], [o.len, 0], [o.len, ROW_RISE], [0, ROW_RISE]]);

    const n = Math.floor(o.len / SEAT_PITCH);
    for (let k = 0; k < n; k++) {
      // Real stands are never full and never empty. Front rows fill first.
      if (Math.random() > 0.86 - r * 0.012) continue;
      const f = (k + 0.5) / n - 0.5;
      const sx = ax + o.ux * f * o.len, sy = ay + o.uy * f * o.len;
      seats.push({
        x: sx + (Math.random() - 0.5) * 0.14, z: Z(sy + (Math.random() - 0.5) * 0.14),
        y: y + 0.02,
        // Everyone faces the track. `ry` is a three.js rotation about Y, and
        // the person mesh faces +Z, so the angle is measured from that.
        ry: Math.atan2(perp[0] * sgn, -perp[1] * sgn) + (Math.random() - 0.5) * 0.5,
        seated: Math.random() > 0.3,
      });
    }
  }

  // The side walls, so the stand is a solid object and not a floating staircase.
  const cornerAt = (u, v) => [o.cx + o.ux * u - o.uy * v, o.cy + o.uy * u + o.ux * v];
  for (const end of [-o.len / 2, o.len / 2]) {
    const a = cornerAt(end, front), b = cornerAt(end, front - sgn * rows * ROW_DEPTH);
    box.quadN([a[0], 0, Z(a[1])], [b[0], 0, Z(b[1])],
      [b[0], 0.5 + rows * ROW_RISE, Z(b[1])], [a[0], 0.5 + rows * ROW_RISE, Z(a[1])],
      [[0, 0], [rows * ROW_DEPTH, 0], [rows * ROW_DEPTH, 0.5 + rows * ROW_RISE], [0, 0.5 + rows * ROW_RISE]]);
  }
  // the back wall
  {
    const back = front - sgn * rows * ROW_DEPTH;
    const a = cornerAt(-o.len / 2, back), b = cornerAt(o.len / 2, back);
    box.quadN([b[0], y0, Z(b[1])], [a[0], y0, Z(a[1])],
      [a[0], y0 + 0.5 + rows * ROW_RISE, Z(a[1])], [b[0], y0 + 0.5 + rows * ROW_RISE, Z(b[1])],
      [[0, 0], [o.len, 0], [o.len, 0.5 + rows * ROW_RISE], [0, 0.5 + rows * ROW_RISE]]);
  }

  // A roof, if the tagged height says there is one. Cantilevered from the
  // back, which is why the front of a grandstand is open to the sky.
  const roofY = y0 + Math.max(0.5 + rows * ROW_RISE + 3.2, height || 0);
  if (rows >= 6) {
    const a = cornerAt(-o.len / 2, front + sgn * 0.8);
    const b = cornerAt(o.len / 2, front + sgn * 0.8);
    const back = front - sgn * (rows * ROW_DEPTH + 0.6);
    const c = cornerAt(o.len / 2, back), d = cornerAt(-o.len / 2, back);
    roofB.quadUp([[a[0], Z(a[1])], [b[0], Z(b[1])], [c[0], Z(c[1])], [d[0], Z(d[1])]], roofY);
    // and its underside, or you see through the roof from inside the stand
    roofB.quadUp([[d[0], Z(d[1])], [c[0], Z(c[1])], [b[0], Z(b[1])], [a[0], Z(a[1])]], roofY - 0.25);
    // columns at the back
    const cols = Math.max(2, Math.round(o.len / 9));
    for (let k = 0; k <= cols; k++) {
      const u = -o.len / 2 + (o.len * k) / cols;
      const p = cornerAt(u, back + sgn * 0.4);
      roofB.box(p[0], (roofY + y0) / 2, Z(p[1]), 0.36, roofY - y0, 0.36, 0, 0xffffff, 1);
    }
  }
  return seats;
}

// Distance from a point (sim metres) to the nearest centreline sample. Coarse
// on purpose — this only has to say which SIDE of a building the track is on.
function distToTrack(track, p) {
  let best = Infinity;
  for (let i = 0; i < track.n; i += 8) {
    const d = (track.x[i] - p[0]) ** 2 + (track.y[i] - p[1]) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// ---------------------------------------------------------------------------
export function buildGrandstands(scene, track, env, look, world = null) {
  const stands = (env?.buildings || []).filter(b => b.k === 'grandstand' && b.p.length >= 4);
  if (!stands.length) return { stands: 0, people: 0 };

  const deck = new Builder();        // the raked seating steps
  const box = new Builder();         // side and back walls
  const roofB = new Builder();       // roof and columns
  let seats = [];

  // Nearest first: if a circuit has more stands than the people budget allows,
  // fill the ones you actually drive past.
  stands.sort((a, b) => distToTrack(track, a.p[0]) - distToTrack(track, b.p[0]));
  for (const b of stands) {
    // ONE offset per stand, taken at its footprint, rather than lifting each
    // vertex where it happens to be. A grandstand is a rigid building: letting
    // its far end follow the terrain would shear it.
    const y0 = world ? world.heightAt(b.p[0][0], Z(b.p[0][1])) : 0;
    seats = seats.concat(stand(box, deck, roofB, track, b.p, b.h, y0));
    if (seats.length > MAX_PEOPLE) break;
  }
  if (seats.length > MAX_PEOPLE) seats.length = MAX_PEOPLE;

  const add = (bld, mat) => { const m = bld.mesh(mat); if (m) scene.add(m); };
  add(deck, look.mat('concrete', { size: 3.0, tint: 0x9aa0a6, roughness: 0.95, side: THREE.DoubleSide }));
  add(box, look.mat('concrete', { size: 3.4, tint: 0xb4b8bd, roughness: 0.95, side: THREE.DoubleSide }));
  add(roofB, look.mat('metal', { size: 3.0, tint: 0xc8ccd2, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }));

  const pm = peopleMesh(seats);
  if (pm) scene.add(pm);
  return { stands: stands.length, people: seats.length };
}
