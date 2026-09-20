// meshes.js — the track builder's scene: road, lines, kerbs, barriers, land
// and sky. Plain colours, no textures (yet): this is the Blender solid
// viewport of the track, and what it has to get right is SHAPE.
//
// Frames: the simulation is x forward, y LEFT, height up. three.js is x, y up,
// z toward the camera — so sim (x, y, h) is three (x, h, -y). That one minus
// sign is DESIGN.md gotcha 6; everything here goes through V() so there is
// exactly one place it can be wrong.
import * as THREE from 'three';
import { surfaceY, pointAt } from './path.js';

export const V = (x, y, h) => new THREE.Vector3(x, h, -y);

const COL = {
  road: 0x44474c, line: 0xeeeeea, kerbRed: 0xc23a2e, kerbWhite: 0xeeeeea,
  gantry: 0x2a2d33,
};

function geo(pos, nor, idx, col, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // UVs ARE METRES here, like everywhere else in this project: u across the
  // road, v along it. A material then only says how big its photograph is and
  // sets repeat = 1/size, and the aggregate on a 14 m road is the same size as
  // the aggregate on a 24 m one without a tiling constant anywhere.
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (!nor) g.computeVertexNormals();
  return g;
}

// Surface normal of the road at sample i, in three coords. From the actual
// neighbouring cross-sections, so grade and banking both tilt it.
function roadNormal(path, i) {
  const a = Math.max(0, i - 1), b = Math.min(path.n - 1, i + 1);
  const pa = pointAt(path, a, 0), pb = pointAt(path, b, 0);
  const l = pointAt(path, i, path.w[i]), r = pointAt(path, i, -path.w[i]);
  const T = V(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
  const L = V(l.x - r.x, l.y - r.y, l.z - r.z);
  const n = new THREE.Vector3().crossVectors(L, T).normalize();
  return n.y < 0 ? n.negate() : n;
}

// How far along the road a UV is allowed to get before it folds back.
//
// A texture coordinate is metres here, and this track is 4,872 m long: at a 3 m
// photograph that is 1,624 repeats, and a GPU sampler keeps only a handful of
// fractional bits. Past a few hundred repeats every pixel of a tile samples
// almost the same texel and the surface smears into streaks — measured
// side-by-side on the terrain, where turning the fold off turned real dirt
// into vertical smears.
//
// The fold is a TRIANGLE wave, not a saw-tooth: v runs 0 -> 96 -> 0 -> 96, so
// it is continuous across every quad and needs no special case at the seam.
// The texture is mirrored at each fold, which on asphalt is invisible, and 96
// is an exact multiple of every surface size in js/build/look.js so the tiling
// itself never breaks stride.
const FOLD = 96;
const foldV = s => FOLD - Math.abs((s % (2 * FOLD)) - FOLD);

// A strip running along the road between two lateral offsets, lifted `dz`
// above the surface. `latA` must be the LEFT (larger) offset so the winding
// faces up in three's frame.
function strip(path, from, to, latA, latB, dz = 0) {
  const pos = [], nor = [], idx = [], uv = [];
  for (let i = from; i <= to; i++) {
    const la = typeof latA === 'function' ? latA(i) : latA, lb = typeof latB === 'function' ? latB(i) : latB;
    const a = pointAt(path, i, la), b = pointAt(path, i, lb);
    const n = roadNormal(path, i);
    pos.push(a.x, a.z + dz, -a.y, b.x, b.z + dz, -b.y);
    nor.push(n.x, n.y, n.z, n.x, n.y, n.z);
    const v = foldV(i * path.ds);
    uv.push(la, v, lb, v);
    if (i > from) {
      const k = (i - from) * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return { pos, nor, idx, uv };
}

// `mats` is the hook for photographed surfaces (js/build/look.js): pass
// { road, paint, kerb, grid } and the ribbon is painted with those instead of
// with flat colours. Without it this is still the Blender solid viewport it
// started as, which is what ?flat turns back on.
export function buildRoad(path, mats = null) {
  const group = new THREE.Group();
  const last = path.n - 1;

  // CHUNKED, 256 m at a time. A mesh that spans the whole track can never be
  // frustum-culled — its bounding sphere contains the camera everywhere you
  // stand — so one 4.6 km ribbon is drawn in full, twice (the shadow pass is
  // a second draw), whichever way you are looking. Chunks cost a few more
  // draw calls and save most of the triangles.
  const CHUNK = 128;                       // samples, 2 m each
  const roadMat = mats?.road || new THREE.MeshStandardMaterial({
    color: COL.road, roughness: 0.92, metalness: 0,
  });
  for (let c0 = 0; c0 < last; c0 += CHUNK) {
    const c1 = Math.min(last, c0 + CHUNK);
    const r = strip(path, c0, c1, i => path.w[i], i => -path.w[i]);
    const road = new THREE.Mesh(geo(r.pos, r.nor, r.idx, null, r.uv), roadMat);
    road.receiveShadow = true;
    group.add(road);
  }

  // White edge lines, painted a hair above the tarmac. polygonOffset rather
  // than a bigger lift, so they never float when seen low along the road.
  const paint = mats?.paint || new THREE.MeshStandardMaterial({
    color: COL.line, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const side of [1, -1]) {
    const lo = i => side * (path.w[i] - 0.2), hi = i => side * (path.w[i] - 0.45);
    for (let c0 = 0; c0 < last; c0 += CHUNK) {
      const c1 = Math.min(last, c0 + CHUNK);
      const s = side > 0 ? strip(path, c0, c1, lo, hi, 0.004) : strip(path, c0, c1, hi, lo, 0.004);
      const m = new THREE.Mesh(geo(s.pos, s.nor, s.idx, null, s.uv), paint);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // Kerbs, wherever the road is actually turning: red and white blocks from
  // the edge out to 1.2 m, which is exactly the band the game's physics calls
  // "kerb". Raised 6 cm at the outside so they read as solid from the car.
  let kp = [], kn = [], kc = [], ki = [], ku = [];
  const red = new THREE.Color(COL.kerbRed), white = new THREE.Color(COL.kerbWhite);
  const kerbMat = mats?.kerb || new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.6, side: THREE.DoubleSide,
  });
  const flushKerb = () => {
    if (!kp.length) return;
    const km = new THREE.Mesh(geo(kp, kn, ki, kc, ku), kerbMat);
    km.receiveShadow = true; km.castShadow = false;
    group.add(km);
    kp = []; kn = []; kc = []; ki = []; ku = [];
  };
  let block = 0;
  for (let i = 0; i < last; i++) {
    if (i % CHUNK === 0) flushKerb();        // same 256 m chunks as the tarmac
    const turning = Math.abs(path.k[i]) > 1 / 450 && Math.abs(path.k[i + 1]) > 1 / 450;
    if (!turning) continue;
    const c = (block++ % 2) ? red : white;
    for (const side of [1, -1]) {
      const ends = [i, i + 1].map(j => {
        const w = path.w[j];
        const inner = pointAt(path, j, side * w), outer = pointAt(path, j, side * (w + 1.2));
        const zEdge = surfaceY(path, j, side * w);
        return { inner: V(inner.x, inner.y, zEdge + 0.005), outer: V(outer.x, outer.y, zEdge + 0.06),
                 foot: V(outer.x, outer.y, zEdge - 0.12) };
      });
      const quad = (a, b, c2, d) => {
        const base = kp.length / 3;
        // Planar metres for the concrete under the paint. A kerb is 1.2 m
        // wide and a metre long a block, so which way the photograph runs on
        // it is not something the eye can see.
        for (const v of [a, b, c2, d]) { kp.push(v.x, v.y, v.z); kc.push(c.r, c.g, c.b); ku.push(v.x, v.z); }
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
        if (n.y < 0 && Math.abs(n.y) > 0.3) n.negate();
        for (let q = 0; q < 4; q++) kn.push(n.x, n.y, n.z);
        ki.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const [p, q] = ends;
      if (side > 0) {           // left side: outer is further left
        quad(p.outer, p.inner, q.inner, q.outer);
        quad(p.foot, p.outer, q.outer, q.foot);
      } else {
        quad(p.inner, p.outer, q.outer, q.inner);
        quad(p.outer, p.foot, q.foot, q.outer);
      }
    }
  }
  flushKerb();

  // Start / finish: a chequered band across the road at s = 0.
  {
    const pos = [], col = [], idx = [], uvs = [];
    const rows = 2, cols = 16, depth = 1.6;
    for (let rI = 0; rI < rows; rI++) for (let cI = 0; cI < cols; cI++) {
      const c = (rI + cI) % 2 ? new THREE.Color(0x151515) : new THREE.Color(0xf2f2f2);
      const w = path.w[0];
      const l0 = w - (2 * w * cI) / cols, l1 = w - (2 * w * (cI + 1)) / cols;
      const s0 = rI * depth / rows, s1 = (rI + 1) * depth / rows;
      const base = pos.length / 3;
      for (const [s, l] of [[s0, l0], [s0, l1], [s1, l1], [s1, l0]]) {
        const h = path.hdg[0];
        const x = path.x[0] + Math.cos(h) * s - Math.sin(h) * l;
        const y = path.y[0] + Math.sin(h) * s + Math.cos(h) * l;
        pos.push(x, surfaceY(path, 0, l) + 0.006, -y);
        col.push(c.r, c.g, c.b);
        uvs.push(l, s);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = geo(pos, null, idx, col, uvs);
    const m = new THREE.Mesh(g, mats?.grid || new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// A start gantry over the line, and a board where the track currently ends.
export function buildLandmarks(path, ground) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: COL.gantry, roughness: 0.55, metalness: 0.4 });
  const box = (sx, sy, sz, x, y, h, hdg, m = mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.copy(V(x, y, h));
    mesh.rotation.y = hdg;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // gantry: two legs just outside the barriers, a beam over the road
  {
    const i = 0, h = path.hdg[i];
    const off = path.w[i] + Math.min(path.runL[i], path.runR[i]) + 1.2;
    const L = pointAt(path, i, off), R = pointAt(path, i, -off);
    const gL = ground.height(L.x, L.y), gR = ground.height(R.x, R.y);
    const top = Math.max(gL, gR) + 7.5;
    box(0.6, top - gL, 0.6, L.x, L.y, gL + (top - gL) / 2, h);
    box(0.6, top - gR, 0.6, R.x, R.y, gR + (top - gR) / 2, h);
    const c = pointAt(path, i, 0);
    box(0.9, 1.4, 2 * off + 0.6, c.x, c.y, top - 0.2, h);
    group.userData.beam = { x: c.x, y: top - 0.2, z: -c.y, span: 2 * off + 0.6, hdg: h };
    // five red start lights facing the grid
    const lamp = new THREE.MeshStandardMaterial({ color: 0x300808, emissive: 0xd01010, emissiveIntensity: 0.25 });
    for (let k = -2; k <= 2; k++) {
      const p = pointAt(path, i, k * 1.1);
      const b = box(0.2, 0.5, 0.5, p.x - Math.cos(h) * 0.55, p.y - Math.sin(h) * 0.55, top - 0.25, h, lamp);
      b.castShadow = false;
    }
  }
  // end of the track so far: a striped board across the road
  if (!path.closed) {
    const i = path.n - 1, h = path.hdg[i];
    const w = path.w[i] + 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 64;
    const c = canvas.getContext('2d');
    for (let x = -64; x < 512; x += 64) {
      c.fillStyle = '#f07a1a'; c.beginPath();
      c.moveTo(x, 64); c.lineTo(x + 32, 0); c.lineTo(x + 64, 0); c.lineTo(x + 32, 64); c.fill();
    }
    c.fillStyle = '#ffffff';
    c.fillRect(160, 14, 192, 36);
    c.fillStyle = '#1a1a1a'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TO BE BUILT', 256, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2 * w, 2 * w / 8),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 }));
    const c0 = pointAt(path, i, 0);
    board.position.copy(V(c0.x, c0.y, c0.z + 1.1));
    board.rotation.y = h - Math.PI / 2;
    board.castShadow = true;
    group.add(board);
  }
  return group;
}

// RUN-OFF. Additive: without a material there is nothing here and the track
// looks exactly as it did.
//
// This is not decoration, it is the land agreeing with the physics. app.js
// already calls everything from the road edge out to the barrier `runoff` —
// asphalt grip, not grass grip — and it was DRAWN as grass, so a driver
// running wide saw lawn under the wheels and kept the grip of a car park. A
// modern circuit's run-off is pale asphalt, and now it looks like it.
//
// The height is the road EDGE's height less ground.js's EPS, which is exactly
// where ground.js puts the level verge, plus 2 cm. That is why it cannot
// z-fight: it is not guessing where the ground is, it is using the same rule
// the ground was built from.
export function buildRunoff(path, material, eps = 0.12) {
  if (!material) return new THREE.Group();
  const group = new THREE.Group();
  const last = path.n - 1;
  for (const side of [1, -1]) {
    const pos = [], nor = [], idx = [], uv = [];
    let run0 = false;                                 // was the sample before this one drawn?
    for (let i = 0; i <= last; i++) {
      const w = path.w[i], run = side > 0 ? path.runL[i] : path.runR[i];
      // Walls right at the kerb (the tunnel, the loop): no run-off to draw.
      // Skipping a sample also breaks the ribbon, so the next quad must not
      // be stitched across the gap — that is what `run0` is for. Without it
      // the tunnel section grows a 60 m triangle across the infield.
      if (run <= 1.4) { run0 = false; continue; }
      const h = surfaceY(path, i, side * w) - eps + 0.02;
      const inner = pointAt(path, i, side * (w + 1.2));
      const outer = pointAt(path, i, side * (w + run));
      // Left side first when the left edge is the larger offset, so the
      // winding faces the sky in three's frame — a reversed one renders lit
      // from below, which looks like a texture bug and is not one.
      const a = side > 0 ? outer : inner, b = side > 0 ? inner : outer;
      const la = side > 0 ? w + run : -(w + 1.2), lb = side > 0 ? w + 1.2 : -(w + run);
      pos.push(a.x, h, -a.y, b.x, h, -b.y);
      nor.push(0, 1, 0, 0, 1, 0);
      const v = foldV(i * path.ds);
      uv.push(la, v, lb, v);
      const k = pos.length / 3;
      if (run0 && k >= 4) idx.push(k - 4, k - 3, k - 2, k - 3, k - 1, k - 2);
      run0 = true;
    }
    if (!pos.length) continue;
    const m = new THREE.Mesh(geo(pos, nor, idx, null, uv), material);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// The land, from ground.chunks(). Sim-frame arrays are swapped into three's
// frame here and nowhere else.
export function buildGround(chunks, material = null) {
  const group = new THREE.Group();
  // `material` is the hook for a textured/PBR terrain: pass one in and these
  // meshes use it instead. Geometry carries position, normal, vertex colour
  // and a UV in METRES (see ground.js), so a material can tile by real size.
  const mat = material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  for (const c of chunks) {
    const n = c.position.length / 3;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      pos[k * 3] = c.position[k * 3]; pos[k * 3 + 1] = c.position[k * 3 + 2]; pos[k * 3 + 2] = -c.position[k * 3 + 1];
      nor[k * 3] = c.normal[k * 3]; nor[k * 3 + 1] = c.normal[k * 3 + 2]; nor[k * 3 + 2] = -c.normal[k * 3 + 1];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c.color, 3));
    if (c.uv) g.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
    g.setIndex(new THREE.BufferAttribute(c.index, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// Sky: a gradient dome with a soft sun, also used to light everything (it is
// rendered once into an environment map, so the car's paint reflects it).
export function buildSky(sunDir) {
  const g = new THREE.SphereGeometry(9000, 48, 24);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x4a78b8) }, horizon: { value: new THREE.Color(0xc6d2dc) },
      below: { value: new THREE.Color(0xb7bdb2) }, sun: { value: sunDir.clone().normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 zenith, horizon, below, sun; varying vec3 vDir;
      void main(){
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.55)) : mix(horizon, below, clamp(-y * 6.0, 0.0, 1.0));
        float s = max(dot(normalize(vDir), sun), 0.0);
        c += vec3(1.0, 0.93, 0.8) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
