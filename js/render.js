// render.js — everything the simulation does NOT need to know about.
//
// The whole graphics layer lives behind this one class so that physics.js
// never imports three.js. That is what makes "browser now, native later"
// actually true rather than a nice intention.
//
// Axis convention, once, here: the sim works in flat (x, y) metres with a
// heading in radians. Three.js is Y-up. So sim x -> three x, sim y -> three z,
// and a sim heading of h becomes rotation.y = -h on a mesh built pointing
// along +X. Nothing outside this file should ever have to know that.
import * as THREE from 'three';
import { buildEnv } from './env.js';

const KERB_W = 0.55;
const WALL_H = 1.25;

// HANDEDNESS. The simulation works in a right-handed 2D frame: +x forward at
// heading 0, +y to the car's LEFT, headings increasing anticlockwise. Three.js
// with Y up is the other handedness, so mapping sim y straight onto three z
// renders the entire world as its own MIRROR IMAGE — every circuit reflected,
// every right-hander a left-hander, and steering that reads as inverted because
// pressing left moves the car right on screen.
//
// One negation fixes all of it. Sim (x, y) -> three (x, 0, -y), and a sim
// heading maps to rotation.y directly instead of negated. Nothing outside this
// file should ever have to know.
const Z = y => -y;

function ribbon(track, innerAt, outerAt, colorAt) {
  const n = track.n;
  const pos = new Float32Array(n * 2 * 3);
  const col = colorAt ? new Float32Array(n * 2 * 3) : null;
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const h = track.hdg[i], nx = -Math.sin(h), ny = Math.cos(h);
    // Order the two edges consistently, because the triangle winding — and so
    // which way the surface faces — depends on it, and the ribbons disagree:
    // the road runs -w -> +w (crossing the centreline) while the right run-off
    // runs -w -> -(w+run). Get it wrong and the surface faces DOWN; because
    // these materials are DoubleSide three.js then negates the normal instead
    // of culling, so it renders lit-from-underneath — near-black — while the
    // ribbon beside it looks perfect. It reads as a shadow bug. It isn't.
    //
    // SMALLER offset first, because Z() mirrors the geometry: a reflection
    // flips the handedness and therefore the sign of every face normal. This
    // rule is the exact opposite of what it was before the mirror fix, and
    // flipping one without the other brings the black tarmac straight back.
    let a = innerAt(i), b = outerAt(i);
    if (a > b) { const s = a; a = b; b = s; }
    pos[i * 6 + 0] = track.x[i] + nx * a; pos[i * 6 + 1] = 0; pos[i * 6 + 2] = Z(track.y[i] + ny * a);
    pos[i * 6 + 3] = track.x[i] + nx * b; pos[i * 6 + 4] = 0; pos[i * 6 + 5] = Z(track.y[i] + ny * b);
    if (col) {
      c.set(colorAt(i));
      col[i * 6 + 0] = c.r; col[i * 6 + 1] = c.g; col[i * 6 + 2] = c.b;
      col[i * 6 + 3] = c.r; col[i * 6 + 4] = c.g; col[i * 6 + 5] = c.b;
    }
    const j = (i + 1) % n;
    // Winding chosen so the face normal comes out +Y. Get this backwards and
    // the whole track lights from underneath and renders black.
    idx.push(i * 2 + 1, i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  // Every one of these ribbons is a flat, horizontal surface, so the normal is
  // known: straight up. Do NOT use computeVertexNormals() here — which side of
  // the centreline `innerAt` lands on flips per ribbon (the road runs -w -> +w,
  // the left run-off runs +w -> +w+run), so the triangle winding flips with it
  // and half the surfaces come out facing DOWN. That is what made the tarmac
  // invisible while the run-off beside it rendered fine.
  const nrm = new Float32Array(n * 2 * 3);
  for (let k = 0; k < n * 2; k++) nrm[k * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// Kerbs need HARD colour edges, so each segment gets its own four vertices and
// one flat colour. Sharing vertices between segments — which is what the main
// ribbon() does, because it is built for continuous surfaces — makes the GPU
// interpolate red into white across every quad, and alternating blocks come
// out as a smooth gradient.
function stripes(track, innerAt, outerAt, colorAt) {
  const n = track.n, pos = [], col = [], idx = [];
  const c = new THREE.Color();
  let base = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let a = innerAt(i), b = outerAt(i);
    if (a === b) continue;                       // not a kerb here
    if (a > b) { const s = a; a = b; b = s; }
    let a2 = innerAt(j), b2 = outerAt(j);
    if (a2 === b2) continue;
    if (a2 > b2) { const s = a2; a2 = b2; b2 = s; }
    const h1 = track.hdg[i], h2 = track.hdg[j];
    const p = (x, y, h, lat) => [x - Math.sin(h) * lat, Z(y + Math.cos(h) * lat)];
    const q = [
      p(track.x[i], track.y[i], h1, a), p(track.x[i], track.y[i], h1, b),
      p(track.x[j], track.y[j], h2, a2), p(track.x[j], track.y[j], h2, b2),
    ];
    c.set(colorAt(i));
    for (const v of q) { pos.push(v[0], 0, v[1]); col.push(c.r, c.g, c.b); }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    base += 4;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const nrm = new Float32Array(pos.length);
  for (let k = 0; k < pos.length / 3; k++) nrm[k * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// A vertical wall standing on the outer edge of the run-off.
function wall(track, atFn, height) {
  const n = track.n;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const h = track.hdg[i], nx = -Math.sin(h), ny = Math.cos(h);
    const d = atFn(i);
    const x = track.x[i] + nx * d, z = Z(track.y[i] + ny * d);
    pos[i * 6 + 0] = x; pos[i * 6 + 1] = 0; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x; pos[i * 6 + 4] = height; pos[i * 6 + 5] = z;
    const j = (i + 1) % n;
    // Wound the other way round than it reads, for the same reason as ribbon():
    // Z() mirrors the world, which reverses every triangle.
    idx.push(j * 2, i * 2 + 1, i * 2, j * 2, j * 2 + 1, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rad.addColorStop(0, 'rgba(255,255,255,0.85)');
  rad.addColorStop(0.45, 'rgba(230,230,235,0.35)');
  rad.addColorStop(1, 'rgba(210,210,215,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A single-seater, built from primitives. Deliberately cheap: the budget goes
// into the simulation, and a clean silhouette reads better at speed than a
// detailed model you never see.
function buildCar(colour) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.75, metalness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x131316, roughness: 0.92, metalness: 0.0 });

  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true;
    g.add(m); return m;
  };
  // body points along +X: nose at +X, engine at -X
  add(new THREE.BoxGeometry(2.4, 0.26, 0.62), paint, 0.25, 0.32, 0);      // monocoque
  add(new THREE.BoxGeometry(1.15, 0.17, 0.34), paint, 1.55, 0.26, 0);     // nose
  add(new THREE.BoxGeometry(0.62, 0.40, 0.95), paint, -0.85, 0.40, 0);    // sidepod/engine
  add(new THREE.BoxGeometry(0.30, 0.34, 0.30), dark, -1.35, 0.44, 0);     // airbox
  add(new THREE.BoxGeometry(0.34, 0.05, 1.50), dark, 2.05, 0.13, 0);      // front wing
  add(new THREE.BoxGeometry(0.34, 0.05, 1.05), dark, -1.70, 0.62, 0);     // rear wing
  add(new THREE.BoxGeometry(0.05, 0.28, 1.02), dark, -1.72, 0.48, 0);     // rear wing endplate span
  add(new THREE.BoxGeometry(0.42, 0.24, 0.44), dark, -0.15, 0.50, 0);     // halo/roll hoop

  const tyre = (r, w) => {
    const t = new THREE.CylinderGeometry(r, r, w, 16);
    t.rotateX(Math.PI / 2);   // cylinder axis along Z = the car's lateral axis
    return t;
  };
  const fw = tyre(0.32, 0.26), rw = tyre(0.35, 0.34);
  const wheels = { fl: null, fr: null, rl: null, rr: null };
  const front = new THREE.Group();
  wheels.fl = new THREE.Mesh(fw, rubber); wheels.fl.position.set(1.25, 0.32, 0.62);
  wheels.fr = new THREE.Mesh(fw, rubber); wheels.fr.position.set(1.25, 0.32, -0.62);
  front.add(wheels.fl, wheels.fr);
  g.add(front);
  wheels.rl = new THREE.Mesh(rw, rubber); wheels.rl.position.set(-1.15, 0.35, 0.68);
  wheels.rr = new THREE.Mesh(rw, rubber); wheels.rr.position.set(-1.15, 0.35, -0.68);
  g.add(wheels.rl, wheels.rr);
  for (const k in wheels) wheels[k].castShadow = true;

  return { group: g, wheels, front };
}

export class View {
  constructor(canvas, track, line, opts = {}) {
    this.track = track; this.line = line;
    // Shadows off is both a real setting for a weak machine and the fastest
    // way to tell whether a lighting problem is the shadow map or the material.
    this.shadows = opts.shadows !== false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.shadows;
    // PCFSoftShadowMap is deprecated in this three build and silently falls
    // back to PCFShadowMap anyway — ask for what we actually get.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fa9c4);
    this.scene.fog = new THREE.Fog(0x8fa9c4, 260, 1100);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 3000);
    this.camPos = new THREE.Vector3();
    this.camAim = new THREE.Vector3();
    this.camH = 0;
    this.mode = 0;
    this.shake = 0;

    this._lights();
    this._world();
    // The real surroundings, if they have been baked. Without these the world
    // ends in a flat plane against the sky, which reads as a video game
    // instantly — and gives the eye nothing to measure speed against.
    this.envStats = buildEnv(this.scene, opts.env);
    const car = buildCar(0xd8352a);
    this.car = car.group; this.wheels = car.wheels; this.frontAxle = car.front;
    this.scene.add(this.car);
    this._smoke();

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xbcd2ea, 0x4a4a42, 1.05));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(180, 260, 120);
    sun.castShadow = this.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 45;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    // The light sits ~340 m from its target, so a 1..600 depth range spends
    // almost all of its precision on empty space. Bracket the useful slice.
    sun.shadow.camera.near = 180; sun.shadow.camera.far = 480;
    // A big unbroken flat surface is the worst case for shadow acne, and the
    // track is nothing but that. normalBias offsets along the surface normal,
    // which is what actually fixes acne on flat ground — a depth bias alone
    // left the whole road self-shadowing and rendering near-black.
    // At d=45 with a 2048 map a shadow texel is ~4.4 cm on the ground, so the
    // normal offset has to be measured in several texels to clear acne.
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.30;
    this.scene.add(sun);
    this.sun = sun;
    this.scene.add(sun.target);
  }

  _world() {
    const t = this.track;
    const S = this.scene;
    const bb = t.bbox, pad = 900;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry((bb.x1 - bb.x0) + pad * 2, (bb.y1 - bb.y0) + pad * 2),
      new THREE.MeshStandardMaterial({ color: 0x4e5f3a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bb.x0 + bb.x1) / 2, -0.06, Z((bb.y0 + bb.y1) / 2));
    ground.receiveShadow = true;
    S.add(ground);

    // run-off: gravel at Monza/Suzuka, tarmac elsewhere. Grip is handled in
    // main.js; this is only what it looks like.
    // DoubleSide throughout: the ribbons are flat ground, nothing is ever seen
    // from underneath, and it makes a winding mistake cosmetic instead of
    // making a whole surface disappear.
    const gravel = t.wall === 'gravel';
    const runMat = new THREE.MeshStandardMaterial({ color: gravel ? 0xa79271 : 0x55575c, roughness: 1, side: THREE.DoubleSide });
    const runL = ribbon(t, i => t.w[i], i => t.w[i] + t.runL[i], null);
    const runR = ribbon(t, i => -t.w[i], i => -(t.w[i] + t.runR[i]), null);
    for (const g of [runL, runR]) { const m = new THREE.Mesh(g, runMat); m.position.y = -0.03; m.receiveShadow = true; S.add(m); }

    const road = new THREE.Mesh(ribbon(t, i => -t.w[i], i => t.w[i], null),
      new THREE.MeshStandardMaterial({ color: 0x43464d, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    S.add(road);

    // white lines
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.8, side: THREE.DoubleSide });
    const wl = ribbon(t, i => t.w[i] - 0.14, i => t.w[i], null);
    const wr = ribbon(t, i => -(t.w[i] - 0.14), i => -t.w[i], null);
    for (const g of [wl, wr]) { const m = new THREE.Mesh(g, lineMat); m.position.y = 0.012; S.add(m); }

    // kerbs, only where there is actually a corner
    const inCorner = new Uint8Array(t.n);
    const side = new Int8Array(t.n);
    for (const c of t.corners) {
      for (let s = c.s0; s <= c.s1; s += t.ds) {
        const i = t.idx(s);
        inCorner[i] = 1; side[i] = c.dir < 0 ? 1 : -1;
      }
    }
    const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
    const kerbGeo = stripes(t,
      i => inCorner[i] ? side[i] * t.w[i] : 0,
      i => inCorner[i] ? side[i] * (t.w[i] + KERB_W) : 0,
      i => (Math.floor(i * t.ds / 2.4) % 2) ? 0xd23b2f : 0xe6e6e6);
    if (kerbGeo) {
      const kerb = new THREE.Mesh(kerbGeo, kerbMat);
      kerb.position.y = 0.022;
      S.add(kerb);
    }

    // barriers
    const barMat = new THREE.MeshStandardMaterial({ color: 0xbfc4cb, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    const bl = wall(t, i => t.w[i] + t.runL[i], WALL_H);
    const br = wall(t, i => -(t.w[i] + t.runR[i]), WALL_H);
    for (const g of [bl, br]) { const m = new THREE.Mesh(g, barMat); m.castShadow = true; S.add(m); }

    // start / finish
    const sf = ribbon(t, i => (i < 3 ? -t.w[i] : 0), i => (i < 3 ? t.w[i] : 0), null);
    const sfm = new THREE.Mesh(sf, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, side: THREE.DoubleSide }));
    sfm.position.y = 0.016;
    S.add(sfm);

    // the ideal line, toggled with L — a reference, not a rail
    const lg = ribbon(t, i => this.line.off[i] - 0.10, i => this.line.off[i] + 0.10, null);
    this.lineMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: 0x35d6a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    this.lineMesh.position.y = 0.02;
    this.lineMesh.visible = false;
    S.add(this.lineMesh);
  }

  _smoke() {
    this.smokeMax = 260;
    this.smoke = [];
    const pos = new Float32Array(this.smokeMax * 3);
    const size = new Float32Array(this.smokeMax);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.PointsMaterial({
      map: puffTexture(), size: 1.4, sizeAttenuation: true,
      transparent: true, depthWrite: false, opacity: 0.5,
    });
    this.smokePts = new THREE.Points(g, m);
    this.smokePts.frustumCulled = false;
    this.scene.add(this.smokePts);
    for (let i = 0; i < this.smokeMax; i++) this.smoke.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 });
    this.smokeI = 0;
  }

  puff(x, z, vx, vz, force) {
    const p = this.smoke[this.smokeI];
    this.smokeI = (this.smokeI + 1) % this.smokeMax;
    p.life = 1;
    p.x = x; p.y = 0.12; p.z = z;
    p.vx = -vx * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vz = -vz * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vy = 0.5 + Math.random() * 0.9 * force;
  }

  setMode(m) { this.mode = ((m % 4) + 4) % 4; }
  toggleLine() { this.lineMesh.visible = !this.lineMesh.visible; return this.lineMesh.visible; }

  // dt here is a REAL frame time — camera smoothing is allowed to be
  // frame-rate dependent, the simulation is not.
  frame(car, dt, hud = {}) {
    this.car.position.set(car.x, 0, Z(car.y));
    this.car.rotation.y = car.hdg;
    this.frontAxle.rotation.y = -car.delta;
    const roll = this.wheels.rl.rotation.z;
    const spin = car.speed * dt / 0.35;
    for (const k in this.wheels) this.wheels[k].rotation.z = roll - spin;
    // body roll and pitch, read straight off the accelerations. This is the
    // same weight transfer the tyres are already using — not a second, made-up
    // animation on top of it.
    this.car.rotation.z = -car.gLat * 0.030;
    this.car.rotation.x = -car.gLong * 0.022;

    // smoke, fired by REAL slip past the tyre's peak, never by "a key is held"
    const over = hud.slipOver || 0;
    if (over > 0 && car.speed > 6) {
      const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
      const vwx = car.vx * cs - car.vy * sn, vwy = car.vx * sn + car.vy * cs;
      for (const sd of [0.68, -0.68]) {
        // rear axle, then out to each rear tyre along the car's left vector
        const px = car.x - cs * 1.15 - sn * sd;
        const py = car.y - sn * 1.15 + cs * sd;
        if (Math.random() < Math.min(1, over * 2.2)) this.puff(px, Z(py), vwx, Z(vwy), Math.min(2, over * 3));
      }
    }
    const pa = this.smokePts.geometry.attributes.position;
    for (let i = 0; i < this.smokeMax; i++) {
      const p = this.smoke[i];
      if (p.life > 0) {
        p.life -= dt * 0.75;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy += 1.1 * dt; p.vx *= 1 - dt * 1.2; p.vz *= 1 - dt * 1.2;
        pa.setXYZ(i, p.x, p.life > 0 ? p.y : -999, p.z);
      } else pa.setXYZ(i, p.x, -999, p.z);
    }
    pa.needsUpdate = true;
    this.smokePts.material.opacity = 0.45;

    // ---- camera -----------------------------------------------------------
    // Aim between where the nose points and where the car is actually going,
    // so a slide reads on screen instead of the camera hiding it.
    const beta = Math.atan2(car.vy, Math.max(car.vx, 3));
    let want = car.hdg + beta * 0.5;
    let d = want - this.camH;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.camH += d * Math.min(1, dt * 7);

    // Speed is a MOTION CUE, not a number. A high, distant camera with a fixed
    // field of view makes 210 km/h feel like 60, because almost nothing moves
    // across the screen. Low, close, and a field of view that opens as you go
    // faster puts the ground and the barriers into the corners of your eye,
    // which is where the sensation actually comes from.
    const RIGS = [
      { dist: 6.0, height: 1.80, lead: 11, fov: 60, kick: 1 },   // CHASE
      { dist: 4.1, height: 1.50, lead: 10, fov: 64, kick: 1 },   // CLOSE
      { dist: 0.15, height: 1.10, lead: 16, fov: 72, kick: 1 },  // NOSE
      { dist: 15, height: 9.5, lead: 6, fov: 55, kick: 0.25 },   // TV
    ];
    const rig = RIGS[this.mode];
    const ch = Math.cos(this.camH), sh = Math.sin(this.camH);
    const tgt = new THREE.Vector3(car.x - ch * rig.dist, rig.height, Z(car.y - sh * rig.dist));
    // The nose cam is bolted on; the others lag, which is where the sense of
    // weight comes from.
    const k = this.mode === 2 ? 1 : Math.min(1, dt * 9);
    this.camPos.lerp(tgt, k);

    this.shake = Math.max(this.shake * (1 - dt * 5), (hud.rough || 0) * 0.5 + Math.max(0, Math.abs(car.gLat) - 1.6) * 0.06);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z + sx);

    this.camAim.lerp(new THREE.Vector3(car.x + ch * rig.lead, 0.75, Z(car.y + sh * rig.lead)), Math.min(1, dt * 10));
    this.camera.lookAt(this.camAim);
    // Speed pulls the field of view open. This is cheap and it is most of why
    // fast feels fast — at 300 km/h the frame widens by over 20 degrees, so the
    // barriers rush past the edges instead of sitting still.
    const fov = rig.fov + Math.min(24, car.speed * 0.26) * rig.kick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.sun.position.set(car.x + 180, 260, Z(car.y) + 120);
    this.sun.target.position.set(car.x, 0, Z(car.y));

    this.renderer.render(this.scene, this.camera);
  }
}
