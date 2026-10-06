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
import { printMat } from './furniture.js';

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

// Who comes to which race. A grandstand at Monza is a red sea of tifosi, at
// Zandvoort it is the orange army, at Suzuka it is every team's replica shirt
// at once. Weighted palettes: each entry is [colour, weight]. The flags are
// what they wave — national colours and team colours.
const FANS = {
  monza: { shirts: [[0xd21f26, 9], [0xc0171d, 4], [0xf5c518, 1], ...SHIRTS.map(c => [c, 0.5])],
    flags: [0xd21f26, 0xd21f26, 0xf5c518, 0x1d8f3c, 0xeeeeea] },
  zandvoort: { shirts: [[0xff6a13, 10], [0xf05a0a, 4], [0x1b3f8f, 1], ...SHIRTS.map(c => [c, 0.4])],
    flags: [0xff6a13, 0xff6a13, 0xae1c28, 0x21468b, 0xeeeeea] },
  suzuka: { shirts: SHIRTS.map(c => [c, 1]), flags: [0xeeeeea, 0xbc002d, 0xff6a13, 0x1b4fd8, 0xd21f26, 0x35d6a0] },
  monaco: { shirts: SHIRTS.map(c => [c, 1]), flags: [0xce1126, 0xeeeeea, 0xd21f26, 0x1b4fd8] },
  baku: { shirts: SHIRTS.map(c => [c, 1]), flags: [0x0092bc, 0xe4002b, 0x00af66, 0xd21f26] },
  nurburgring: { shirts: SHIRTS.map(c => [c, 1]), flags: [0x111111, 0xdd0000, 0xffce00, 0xeeeeea, 0x00a19c] },
  // Jalur Gemilang: red and white stripes, a blue canton, the yellow star.
  sepang: { shirts: SHIRTS.map(c => [c, 1]), flags: [0xcc0001, 0xeeeeea, 0x010066, 0xffcc00, 0xcc0001] },
  // Black, yellow and red — and a great deal of orange: the Dutch border is
  // an hour away and the Kemmel banks are Verstappen's second home crowd.
  spa: { shirts: [[0xff6a13, 6], [0xf05a0a, 2], ...SHIRTS.map(c => [c, 0.7])],
    flags: [0x111111, 0xfdda24, 0xef3340, 0xff6a13, 0xff6a13, 0xeeeeea] },
  default: { shirts: SHIRTS.map(c => [c, 1]), flags: [0xd21f26, 0xff6a13, 0x1b4fd8, 0xeeeeea, 0xf5c518] },
};
const pickW = (list) => {
  let t = 0; for (const [, w] of list) t += w;
  let r = Math.random() * t;
  for (const [c, w] of list) { r -= w; if (r <= 0) return c; }
  return list[0][0];
};

// ---------------------------------------------------------------------------
// A person. At 40 m they are a handful of pixels and at 400 m a speck, so the
// budget still goes into HOW MANY — but a person is no longer three boxes.
// Two legs with a gap, a torso that is wider at the shoulders than the waist,
// and two arms hanging off it: the silhouette is what the eye reads as a
// human at distance, and a solid block reads as a bollard. ~70 triangles.
// Exported because the pit crew are the same mesh with a different palette.
// ---------------------------------------------------------------------------
export function personGeometry() {
  const b = new Builder({ uv: false });
  b.box(-0.085, 0.42, 0, 0.13, 0.84, 0.17, 0, 0xffffff, 1);    // left leg
  b.box(0.085, 0.42, 0, 0.13, 0.84, 0.17, 0, 0xffffff, 1);     // right leg
  b.box(0, 0.87, 0, 0.34, 0.12, 0.21, 0, 0xffffff, 1);         // hips
  b.box(0, 1.12, 0, 0.40, 0.42, 0.23, 0, 0xffffff, 1);         // chest
  b.box(-0.245, 1.02, 0, 0.09, 0.58, 0.11, 0, 0xffffff, 1);    // left arm
  b.box(0.245, 1.02, 0, 0.09, 0.58, 0.11, 0, 0xffffff, 1);     // right arm
  const g = b.geometry();
  g.deleteAttribute('uv'); g.deleteAttribute('uv1');
  // taper the chest: pull the waist in so the shoulders read
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), x = P.getX(i);
    if (y > 0.9 && y < 0.92 && Math.abs(x) < 0.21) P.setX(i, x * 0.8);
  }
  g.computeVertexNormals();
  return g;
}

// The head is a SECOND instanced mesh rather than part of the first.
//
// An InstancedMesh has one colour per instance, so a person built as one mesh
// is one solid colour from shoe to scalp — a coloured pole. Two meshes sharing
// the same transforms cost one extra draw call for the entire crowd and are
// the difference between people and bollards. Round now (an icosahedron,
// 20 triangles): a box head is the most toy-like thing a figure can have.
export function headGeometry() {
  const g = new THREE.IcosahedronGeometry(0.115, 0);
  g.scale(0.95, 1.08, 1.0);
  g.translate(0, 1.47, 0);
  g.deleteAttribute('uv');
  return g;
}

// A flag on a short pole, held up above the head. The third instanced mesh,
// for the few percent of a crowd that brought one — which at Monza and
// Zandvoort is the whole look of the place.
function flagGeometry() {
  const b = new Builder({ uv: false });
  b.box(0.22, 1.95, 0, 0.025, 1.1, 0.025, 0, 0xffffff, 1);     // pole
  const g0 = b.geometry();
  const flag = new THREE.PlaneGeometry(0.95, 0.62, 3, 1);
  flag.translate(0.22 + 0.475, 2.2, 0);
  const pos = flag.attributes.position;
  // a little wave baked in, so a still flag is not a card
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) - 0.22) * 5.0) * 0.07);
  flag.deleteAttribute('uv');
  const idx = [];
  const all = new Float32Array(g0.attributes.position.count * 3 + pos.count * 3);
  all.set(g0.attributes.position.array, 0);
  all.set(pos.array, g0.attributes.position.count * 3);
  const base = g0.attributes.position.count;
  for (let i = 0; i < g0.index.count; i++) idx.push(g0.index.array[i]);
  for (let i = 0; i < flag.index.count; i++) idx.push(flag.index.array[i] + base);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(all, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A crowd that is ALIVE: every figure sways a few centimetres on its own
// slow clock (the instance index seeds the phase), and the flags wave. One
// uniform, advanced by onBeforeRender, costs nothing per figure on the CPU.
const CROWD_T = { value: 0 };
function sway(mat, amp, speed) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowdT = CROWD_T;
    sh.vertexShader = 'uniform float uCrowdT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    float ph = float(gl_InstanceID) * 1.618;
    float k = smoothstep(0.6, 2.6, transformed.y);
    transformed.x += sin(uCrowdT * ${speed.toFixed(2)} + ph) * ${amp.toFixed(3)} * k;
    transformed.z += cos(uCrowdT * ${(speed * 0.7).toFixed(2)} + ph * 1.3) * ${(amp * 0.5).toFixed(3)} * k;
  }`);
  };
  mat.customProgramCacheKey = () => `crowd-sway-${amp}-${speed}`;
  return mat;
}

// A crowd is a list of { x, z, y, ry, scale, seated }. This turns it into one
// mesh with a per-instance colour. `fans` (a key into FANS) picks the
// circuit's colours and turns flags on.
export function peopleMesh(spots, { palette = SHIRTS, fans = null, flags: flagCols = null, flagRate = 0.07 } = {}) {
  if (!spots.length) return null;
  const F = fans ? (FANS[fans] || FANS.default) : flagCols ? { flags: flagCols } : null;
  // flatShading keeps the figures crisp rather than soft blobs once there are
  // thousands of them overlapping.
  const bodyMat = sway(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true }), 0.035, 1.3);
  const headMat = sway(new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, flatShading: true }), 0.035, 1.3);
  const body = new THREE.InstancedMesh(personGeometry(), bodyMat, spots.length);
  const head = new THREE.InstancedMesh(headGeometry(), headMat, spots.length);
  const flagSpots = F ? spots.filter(() => Math.random() < flagRate) : [];
  const flags = flagSpots.length ? new THREE.InstancedMesh(flagGeometry(),
    sway(new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), 0.16, 2.6),
    flagSpots.length) : null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const place = (mesh, i, sp) => {
    q.setFromAxisAngle(up, sp.ry);
    const sc = sp._sc ?? (sp._sc = sp.scale ?? (0.9 + Math.random() * 0.2));
    // Sitting is modelled as being shorter, not as a second mesh. At the
    // distance you ever see a grandstand from, the difference between a seated
    // figure and a short one is nothing.
    s.set(sc, sc * (sp.seated ? 0.72 : 1), sc);
    v.set(sp.x, sp.y, sp.z);
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);
  };
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    place(body, i, sp); place(head, i, sp);
    c.setHex(F && F.shirts ? pickW(F.shirts) : palette[(Math.random() * palette.length) | 0]);
    // no two shirts in a crowd are quite the same colour after a day in the sun
    c.multiplyScalar(0.82 + Math.random() * 0.3);
    body.setColorAt(i, c);
    c.setHex(SKIN[(Math.random() * SKIN.length) | 0]);
    head.setColorAt(i, c);
  }
  for (let i = 0; i < flagSpots.length; i++) {
    const sp = flagSpots[i];
    place(flags, i, { ...sp, seated: false, _sc: sp._sc });
    c.setHex(F.flags[(Math.random() * F.flags.length) | 0]);
    flags.setColorAt(i, c);
  }
  const g = new THREE.Group();
  for (const mesh of [body, head, flags]) {
    if (!mesh) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;    // 9,000 shadow casters is not worth one frame
    mesh.receiveShadow = false;
    g.add(mesh);
  }
  body.onBeforeRender = () => { CROWD_T.value = performance.now() / 1000; };
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
function stand(box, deck, roofB, track, ring, height, y0 = 0, band = null, sign = null, pick = 0) {
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

  // A NAME ACROSS THE FACE. Adam: "like lenovo grandstands".
  //
  // A stand is the biggest flat thing beside a circuit and it carried nothing
  // at all, which is the single most obviously unbranded object in the world.
  // The band sits along the top of the seating, spanning the whole front, and
  // it is sized from the stand's own length rather than fixed — Monza's main
  // grandstand is 200 m long and Zandvoort has stands a fifth of that.
  if (band && sign && sign.cells.big && sign.cells.big.length) {
    const topY = y0 + 0.5 + rows * ROW_RISE;
    const fx = o.cx + perp[0] * front, fy = o.cy + perp[1] * front;
    const hx = o.ux * o.len / 2, hy = o.uy * o.len / 2;
    const A0 = [fx - hx, fy - hy], B0 = [fx + hx, fy + hy];
    const bh = Math.max(1.8, Math.min(5.5, o.len * 0.055));
    const uv = sign.atlas.uv(sign.cells.big[pick % sign.cells.big.length], false);
    band.quadN(
      [A0[0], topY, Z(A0[1])], [B0[0], topY, Z(B0[1])],
      [B0[0], topY + bh, Z(B0[1])], [A0[0], topY + bh, Z(A0[1])], uv);
  }
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
export function buildGrandstands(scene, track, env, look, world = null, sign = null) {
  const stands = (env?.buildings || []).filter(b => b.k === 'grandstand' && b.p.length >= 4);
  if (!stands.length) return { stands: 0, people: 0 };

  const deck = new Builder();        // the raked seating steps
  const box = new Builder();         // side and back walls
  const roofB = new Builder();       // roof and columns
  const band = new Builder();        // the name across the front
  let seats = [];
  let si = 0;                        // which big name this stand carries

  // Nearest first: if a circuit has more stands than the people budget allows,
  // fill the ones you actually drive past.
  stands.sort((a, b) => distToTrack(track, a.p[0]) - distToTrack(track, b.p[0]));
  for (const b of stands) {
    // ONE offset per stand, taken at its footprint, rather than lifting each
    // vertex where it happens to be. A grandstand is a rigid building: letting
    // its far end follow the terrain would shear it.
    const y0 = world ? world.groundY(b.p[0][0], Z(b.p[0][1])) : 0;
    seats = seats.concat(stand(box, deck, roofB, track, b.p, b.h, y0, band, sign, si++));
    if (seats.length > MAX_PEOPLE) break;
  }
  if (seats.length > MAX_PEOPLE) seats.length = MAX_PEOPLE;

  const add = (bld, mat) => { const m = bld.mesh(mat); if (m) scene.add(m); };
  add(deck, look.mat('concrete', { size: 3.0, tint: 0x9aa0a6, roughness: 0.95, side: THREE.DoubleSide }));
  add(box, look.mat('concrete', { size: 3.4, tint: 0xb4b8bd, roughness: 0.95, side: THREE.DoubleSide }));
  add(roofB, look.mat('metal', { size: 3.0, tint: 0xc8ccd2, roughness: 0.55, metalness: 0.6, side: THREE.DoubleSide }));
  // DoubleSide, because which way a stand faces is decided at run time by
  // asking the track, and a band that is backfacing is an invisible band.
  if (sign) {
    const bm = band.mesh(printMat(sign.texture, { roughness: 0.72 }), { shadow: false });
    if (bm) { bm.name = 'stand.band'; scene.add(bm); }
  }

  const pm = peopleMesh(seats, { fans: track.key });
  if (pm) scene.add(pm);
  return { stands: stands.length, people: seats.length };
}
