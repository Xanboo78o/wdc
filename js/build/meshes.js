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
  rail: 0xb9bdc2, post: 0x8d9197, gantry: 0x2a2d33,
};

function geo(pos, nor, idx, col) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
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

// A strip running along the road between two lateral offsets, lifted `dz`
// above the surface. `latA` must be the LEFT (larger) offset so the winding
// faces up in three's frame.
function strip(path, from, to, latA, latB, dz = 0) {
  const pos = [], nor = [], idx = [];
  for (let i = from; i <= to; i++) {
    const la = typeof latA === 'function' ? latA(i) : latA, lb = typeof latB === 'function' ? latB(i) : latB;
    const a = pointAt(path, i, la), b = pointAt(path, i, lb);
    const n = roadNormal(path, i);
    pos.push(a.x, a.z + dz, -a.y, b.x, b.z + dz, -b.y);
    nor.push(n.x, n.y, n.z, n.x, n.y, n.z);
    if (i > from) {
      const k = (i - from) * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return { pos, nor, idx };
}

export function buildRoad(path) {
  const group = new THREE.Group();
  const last = path.n - 1;

  // tarmac
  const r = strip(path, 0, last, i => path.w[i], i => -path.w[i]);
  const road = new THREE.Mesh(geo(r.pos, r.nor, r.idx), new THREE.MeshStandardMaterial({
    color: COL.road, roughness: 0.92, metalness: 0,
  }));
  road.receiveShadow = true;
  group.add(road);

  // White edge lines, painted a hair above the tarmac. polygonOffset rather
  // than a bigger lift, so they never float when seen low along the road.
  const paint = new THREE.MeshStandardMaterial({
    color: COL.line, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const side of [1, -1]) {
    const lo = i => side * (path.w[i] - 0.2), hi = i => side * (path.w[i] - 0.45);
    const s = side > 0 ? strip(path, 0, last, lo, hi, 0.004) : strip(path, 0, last, hi, lo, 0.004);
    const m = new THREE.Mesh(geo(s.pos, s.nor, s.idx), paint);
    m.receiveShadow = true;
    group.add(m);
  }

  // Kerbs, wherever the road is actually turning: red and white blocks from
  // the edge out to 1.2 m, which is exactly the band the game's physics calls
  // "kerb". Raised 6 cm at the outside so they read as solid from the car.
  const kp = [], kn = [], kc = [], ki = [];
  const red = new THREE.Color(COL.kerbRed), white = new THREE.Color(COL.kerbWhite);
  let block = 0;
  for (let i = 0; i < last; i++) {
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
        for (const v of [a, b, c2, d]) { kp.push(v.x, v.y, v.z); kc.push(c.r, c.g, c.b); }
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
  if (kp.length) {
    const km = new THREE.Mesh(geo(kp, kn, ki, kc), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.6, side: THREE.DoubleSide,
    }));
    km.receiveShadow = true; km.castShadow = false;
    group.add(km);
  }

  // Start / finish: a chequered band across the road at s = 0.
  {
    const pos = [], col = [], idx = [];
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
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = geo(pos, null, idx, col);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// Steel barrier at w + run each side: a W-beam rail on posts every 4 m, both
// standing on the ACTUAL ground there — never on an assumed height.
export function buildBarriers(path, ground) {
  const group = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: COL.rail, roughness: 0.35, metalness: 0.75 });
  const postMat = new THREE.MeshStandardMaterial({ color: COL.post, roughness: 0.5, metalness: 0.6 });
  const posts = [];
  for (const side of [1, -1]) {
    const pos = [], idx = [];
    const lat = i => side * (path.w[i] + (side > 0 ? path.runL[i] : path.runR[i]));
    let k = 0, prevOk = false;
    for (let i = 0; i < path.n; i++) {
      // On the inside of a corner tighter than the barrier's offset, the
      // offset line folds back through itself. Don't draw a rail there.
      const inside = Math.sign(path.k[i]) === side;
      const ok = !inside || Math.abs(lat(i)) * Math.abs(path.k[i]) < 0.8;
      const p = pointAt(path, i, lat(i));
      const g = ground.height(p.x, p.y);
      const h = path.hdg[i], nx = -Math.sin(h) * side * 0.04, ny = Math.cos(h) * side * 0.04;
      // front face (toward the road) and back face, 0.32 m tall band
      for (const [dz, off] of [[0.42, -1], [0.74, -1], [0.42, 1], [0.74, 1]]) {
        pos.push(p.x + nx * off, g + dz, -(p.y + ny * off));
      }
      if (i > 0 && ok && prevOk) {
        const a = (k - 1) * 4, b = k * 4;
        if (side > 0) {
          idx.push(a, b, b + 1, a, b + 1, a + 1);          // road-facing
          idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
          idx.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3); // top
        } else {
          idx.push(a, a + 1, b + 1, a, b + 1, b);
          idx.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);
          idx.push(a + 1, a + 3, b + 3, a + 1, b + 3, b + 1);
        }
      }
      if (ok && i % 2 === 0) posts.push({ x: p.x, y: p.y, g, h });
      prevOk = ok;
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, railMat);
    m.material.side = THREE.DoubleSide;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  const pg = new THREE.BoxGeometry(0.12, 0.8, 0.12);
  pg.translate(0, 0.4, 0);
  const inst = new THREE.InstancedMesh(pg, postMat, posts.length);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1);
  posts.forEach((p, n) => {
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.h);
    M.compose(V(p.x, p.y, p.g - 0.1), Q, S);
    inst.setMatrixAt(n, M);
  });
  inst.castShadow = true; inst.receiveShadow = true;
  group.add(inst);
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

// The land, from ground.chunks(). Sim-frame arrays are swapped into three's
// frame here and nowhere else.
export function buildGround(chunks) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
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
