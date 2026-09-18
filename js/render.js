// render.js — everything the simulation does NOT need to know about.
//
// The whole graphics layer lives behind this one class so that physics.js
// never imports three.js. That is what makes "browser now, native later"
// actually true rather than a nice intention.
//
// Axis convention, once, here: the sim works in flat (x, y) metres with a
// heading in radians. Three.js is Y-up. So sim x -> three x, sim y -> three -z
// (see geom.js for why the negation is not optional), and a sim heading of h
// becomes rotation.y = h on a mesh built pointing along +X. Nothing outside
// this file should ever have to know that.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { Look, sunRig, fogFor } from './tex.js';
import { buildEnv } from './env.js';
import { signAtlas, buildBarriers, buildTyreWalls, buildBoards, buildStartFinish, buildMarshalPosts } from './furniture.js';
import { buildGrandstands } from './crowd.js';
import { buildPitLane, pitCorridor } from './pit.js';

const KERB_W = 0.62;
const KERB_H = 0.055;
const ROAD_STRIPS = 11;      // lateral divisions of the racing surface

// ---------------------------------------------------------------------------
// The racing surface.
//
// Eleven strips across rather than two, for one reason: the RUBBER. A real
// circuit is not one shade of grey — there is a dark, polished band a couple
// of metres wide where every car has driven, and pale dusty tarmac either side
// of it that has not been cleaned by a tyre in a year. That band IS the racing
// line, and seeing it is how a driver reads a track they have never been to.
//
// It is drawn as vertex colour on the road itself, positioned from the solved
// minimum-curvature line, so it cannot drift out of agreement with the line
// the sim actually thinks is fastest. Vertex colour also means no second
// surface, no transparency and no sorting.
//
// UVs are metres (u across, v along), so the asphalt scan lands at true size
// whether the road is 7.6 m wide at Monaco or 11.5 m at Monza.
// ---------------------------------------------------------------------------
function roadSurface(track, line) {
  const t = track, n = t.n;
  const b = new Builder({ color: true });
  const c = new THREE.Color();

  // Returned as a float triple, NOT a hex: a hex quantises to 0-255 and caps
  // the value at 1.0, which is exactly the albedo as scanned. The clean tarmac
  // either side of the line has to be able to go ABOVE that, or the only thing
  // the racing line can do is make the road darker and the whole surface ends
  // up black.
  const colourAt = (i, lat) => {
    const d = Math.abs(lat - line.off[i]);
    // rubbered band, a transition, then pale tarmac nobody has cleaned
    let k = d < 1.5 ? 0.74 : d < 3.2 ? 0.74 + (d - 1.5) * 0.41 : 1.44;
    // slow variation along the lap: real asphalt is patched and re-laid in
    // sections, and a perfectly uniform road is the tell that it is not one.
    k *= 0.95 + 0.1 * Math.sin(i * t.ds * 0.0037) + 0.04 * Math.sin(i * t.ds * 0.031);
    return [k, k, k];
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const hi = t.hdg[i], hj = t.hdg[j];
    const pi = (lat) => [t.x[i] - Math.sin(hi) * lat, Z(t.y[i] + Math.cos(hi) * lat)];
    const pj = (lat) => [t.x[j] - Math.sin(hj) * lat, Z(t.y[j] + Math.cos(hj) * lat)];
    for (let s = 0; s < ROAD_STRIPS; s++) {
      const f0 = s / ROAD_STRIPS, f1 = (s + 1) / ROAD_STRIPS;
      const li0 = -t.w[i] + 2 * t.w[i] * f0, li1 = -t.w[i] + 2 * t.w[i] * f1;
      const lj0 = -t.w[j] + 2 * t.w[j] * f0, lj1 = -t.w[j] + 2 * t.w[j] * f1;
      const a = pi(li0), d = pi(li1), e = pj(lj0), g = pj(lj1);
      // Wound so the face normal comes out +Y after the reflection. Get this
      // backwards and, because the material is DoubleSide, three does not cull
      // it — it lights the tarmac from underneath and the whole road renders
      // near-black beside a run-off that looks perfect.
      const cols = [colourAt(i, li0), colourAt(i, li1), colourAt(j, lj1), colourAt(j, lj0)];
      b.quad([a[0], 0, a[1]], [d[0], 0, d[1]], [g[0], 0, g[1]], [e[0], 0, e[1]],
        [0, 1, 0],
        [[li0, i * t.ds], [li1, i * t.ds], [lj1, j * t.ds], [lj0, j * t.ds]],
        cols);
    }
  }
  return b;
}

// A flat ribbon between two lateral offsets, UV'd in metres.
function ribbon(track, innerAt, outerAt, y) {
  const t = track, n = t.n;
  const b = new Builder();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const hi = t.hdg[i], hj = t.hdg[j];
    let ai = innerAt(i), bi = outerAt(i);
    let aj = innerAt(j), bj = outerAt(j);
    if (ai === bi) continue;
    if (ai > bi) { const s = ai; ai = bi; bi = s; }
    if (aj > bj) { const s = aj; aj = bj; bj = s; }
    const P = (h, x, yy, lat) => [x - Math.sin(h) * lat, Z(yy + Math.cos(h) * lat)];
    const p0 = P(hi, t.x[i], t.y[i], ai), p1 = P(hi, t.x[i], t.y[i], bi);
    const q0 = P(hj, t.x[j], t.y[j], aj), q1 = P(hj, t.x[j], t.y[j], bj);
    b.quad([p0[0], y, p0[1]], [p1[0], y, p1[1]], [q1[0], y, q1[1]], [q0[0], y, q0[1]],
      [0, 1, 0],
      [[ai, i * t.ds], [bi, i * t.ds], [bj, j * t.ds], [aj, j * t.ds]]);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Kerbs, with a PROFILE rather than a painted stripe on the floor.
//
// A real kerb stands 5 cm proud with a chamfer on each side, and that 5 cm is
// most of what you see: it catches the sun along its top edge and throws a
// shadow line down its face. Painted flat, a kerb is a red-and-white rug.
//
// Each block gets its own four vertices and one flat colour. Sharing vertices
// between segments — which is what a continuous ribbon does — makes the GPU
// interpolate red into white across every quad, and the alternating blocks
// come out as a smooth pink gradient. That was reported as a bug once already.
// ---------------------------------------------------------------------------
function kerbs(track) {
  const t = track;
  const b = new Builder({ color: true });
  const inCorner = new Uint8Array(t.n);
  const side = new Int8Array(t.n);
  for (const c of t.corners || []) {
    for (let s = c.s0 - 6; s <= c.s1 + 6; s += t.ds) {
      const i = t.idx(s);
      inCorner[i] = 1; side[i] = c.dir < 0 ? 1 : -1;
    }
  }
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    if (!inCorner[i] || !inCorner[j] || side[i] !== side[j]) continue;
    const sg = side[i];
    const hi = t.hdg[i], hj = t.hdg[j];
    const P = (h, x, y, lat) => [x - Math.sin(h) * lat, Z(y + Math.cos(h) * lat)];
    const L = (lat) => [P(hi, t.x[i], t.y[i], sg * lat), P(hj, t.x[j], t.y[j], sg * lat)];
    const col = (Math.floor(i * t.ds / 2.6) % 2) ? 0xc7382c : 0xe4e4e0;
    const [i0, j0] = L(t.w[i] - 0.10);
    const [i1, j1] = L(t.w[i]);
    const [i2, j2] = L(t.w[i] + KERB_W);
    const [i3, j3] = L(t.w[i] + KERB_W + 0.14);
    // inner chamfer, flat top, outer chamfer
    b.quadN([i0[0], 0, i0[1]], [j0[0], 0, j0[1]], [j1[0], KERB_H, j1[1]], [i1[0], KERB_H, i1[1]],
      [[0, 0], [t.ds, 0], [t.ds, 0.12], [0, 0.12]], col);
    b.quadN([i1[0], KERB_H, i1[1]], [j1[0], KERB_H, j1[1]], [j2[0], KERB_H, j2[1]], [i2[0], KERB_H, i2[1]],
      [[0, 0], [t.ds, 0], [t.ds, KERB_W], [0, KERB_W]], col);
    b.quadN([i2[0], KERB_H, i2[1]], [j2[0], KERB_H, j2[1]], [j3[0], 0, j3[1]], [i3[0], 0, i3[1]],
      [[0, 0], [t.ds, 0], [t.ds, 0.15], [0, 0.15]], col);
  }
  return b;
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

// ---------------------------------------------------------------------------
// The car. Still built from primitives — a clean silhouette reads better at
// speed than a detailed model you never actually see — but built to the real
// dimensions of a modern single-seater: 5.63 m long, 2.0 m wide, 3.6 m
// wheelbase. Using real numbers is free and it is why the thing sits on the
// road like a car rather than like a toy that happens to be car-shaped.
//
// Licensed game assets are not an option here and never were; this is CC0
// geometry or nothing.
// ---------------------------------------------------------------------------
function buildCar(look, colour) {
  const g = new THREE.Group();
  const env = 1.1;
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.22, metalness: 0.28, envMapIntensity: env });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.42, metalness: 0.35, envMapIntensity: env });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.28, metalness: 0.5, envMapIntensity: env });
  const rubber = look.mat('metal', { size: 0.6, tint: 0x141418, roughness: 0.95, metalness: 0.0, env: 0.4 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.28, metalness: 0.9, envMapIntensity: env });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.06, metalness: 0.6, envMapIntensity: 1.5 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.18, metalness: 0.1, envMapIntensity: env });

  const add = (geo, mat, x, y, z, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz;
    m.castShadow = true;
    g.add(m); return m;
  };
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);

  // body points along +X: nose at +X, engine at -X
  add(B(2.55, 0.24, 0.66), paint, 0.15, 0.34, 0);            // monocoque
  add(B(0.95, 0.20, 0.42), paint, 1.70, 0.30, 0);            // nose cone
  add(B(0.55, 0.12, 0.28), paint, 2.22, 0.24, 0);            // nose tip
  add(B(3.40, 0.05, 1.30), carbon, 0.10, 0.07, 0);           // floor
  for (const s of [1, -1]) {
    add(B(1.30, 0.44, 0.34), paint, -0.35, 0.36, s * 0.52);  // sidepod
    add(B(0.50, 0.26, 0.20), dark, 0.34, 0.40, s * 0.55);    // radiator inlet
    // suspension: two wishbones per corner, which is most of why an open-wheel
    // car looks like an open-wheel car from the cockpit camera
    add(B(0.70, 0.045, 0.045), carbon, 1.30, 0.26, s * 0.38, 0, 0.12);
    add(B(0.70, 0.045, 0.045), carbon, 1.22, 0.44, s * 0.38, 0, -0.10);
    add(B(0.70, 0.05, 0.05), carbon, -1.10, 0.28, s * 0.42, 0, 0.12);
    add(B(0.70, 0.05, 0.05), carbon, -1.18, 0.46, s * 0.42, 0, -0.10);
  }
  add(B(0.70, 0.46, 0.80), paint, -1.05, 0.46, 0);           // engine cover
  add(B(0.34, 0.40, 0.34), dark, -1.42, 0.52, 0);            // airbox
  add(B(0.10, 0.34, 0.06), paint, -1.62, 0.62, 0);           // shark fin

  // front wing: main plane, flap, endplates
  add(B(0.46, 0.04, 1.58), carbon, 2.32, 0.11, 0);
  add(B(0.26, 0.04, 1.50), carbon, 2.10, 0.20, 0);
  for (const s of [1, -1]) add(B(0.60, 0.26, 0.05), carbon, 2.24, 0.17, s * 0.80);

  // rear wing: main plane, a DRS flap that really opens, endplates
  add(B(0.36, 0.05, 1.02), carbon, -1.86, 0.70, 0);
  const drs = add(B(0.22, 0.04, 0.98), carbon, -1.98, 0.84, 0);
  for (const s of [1, -1]) add(B(0.55, 0.42, 0.05), carbon, -1.90, 0.72, s * 0.52);
  add(B(0.30, 0.04, 0.70), carbon, -1.70, 0.30, 0);          // beam wing

  // halo and the driver inside it
  add(B(0.10, 0.30, 0.10), carbon, 0.92, 0.62, 0);           // halo front pillar
  add(B(1.30, 0.08, 0.10), carbon, 0.30, 0.76, 0);           // halo spine
  for (const s of [1, -1]) add(B(0.90, 0.07, 0.07), carbon, 0.30, 0.68, s * 0.30, 0, 0.18);
  add(B(0.34, 0.34, 0.30), dark, -0.42, 0.56, 0);            // roll hoop
  const head = add(B(0.26, 0.28, 0.25), helmet, -0.10, 0.62, 0);
  add(B(0.06, 0.13, 0.23), visor, 0.04, 0.63, 0);            // visor
  void head;

  const tyre = (r, w) => {
    const t = new THREE.CylinderGeometry(r, r, w, 20);
    t.rotateX(Math.PI / 2);   // cylinder axis along Z = the car's lateral axis
    return t;
  };
  const hub = (r, w) => {
    const t = new THREE.CylinderGeometry(r, r, w, 16);
    t.rotateX(Math.PI / 2);
    return t;
  };
  const fw = tyre(0.33, 0.30), rw = tyre(0.36, 0.40);
  const fh = hub(0.19, 0.31), rh = hub(0.20, 0.41);
  const wheels = { fl: null, fr: null, rl: null, rr: null };
  const front = new THREE.Group();
  for (const [k, x, z, t2, h2] of [['fl', 1.55, 0.72, fw, fh], ['fr', 1.55, -0.72, fw, fh],
    ['rl', -1.30, 0.76, rw, rh], ['rr', -1.30, -0.76, rw, rh]]) {
    const w = new THREE.Mesh(t2, rubber);
    w.position.set(x, t2.parameters.radiusTop, z);
    w.castShadow = true;
    const r = new THREE.Mesh(h2, rim);
    w.add(r);
    wheels[k] = w;
    if (k[0] === 'f') front.add(w); else g.add(w);
  }
  g.add(front);

  return { group: g, wheels, front, drs };
}

// ---------------------------------------------------------------------------
export class View {
  /**
   * Building a circuit now needs textures and a sky off the network, so
   * construction is asynchronous. `View.create` loads them and hands a ready
   * View back; the constructor never does I/O.
   */
  static async create(canvas, track, line, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const look = await Look.load(renderer, track.key, { textures: opts.textures !== false });
    return new View(renderer, look, track, line, opts);
  }

  constructor(renderer, look, track, line, opts = {}) {
    this.track = track; this.line = line; this.look = look;
    // Shadows off is both a real setting for a weak machine and the fastest
    // way to tell whether a lighting problem is the shadow map or the material.
    this.shadows = opts.shadows !== false;
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.shadows;
    // PCFSoftShadowMap is deprecated in this three build and silently falls
    // back to PCFShadowMap anyway — ask for what we actually get.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const sky = look.install(this.scene);
    if (!sky) this.scene.background = new THREE.Color(0x8fa9c4);
    const bb = track.bbox;
    const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
    fogFor(this.scene, sky, span);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 4200);
    this.camPos = new THREE.Vector3();
    this.camAim = new THREE.Vector3();
    this.camH = 0;
    this.mode = 0;
    this.shake = 0;

    this.rig = sunRig(this.scene, sky, { shadows: this.shadows });
    this.stats = this._world(opts.env);
    // Publish what actually got built. `tools/shot.mjs` polls for this rather
    // than sleeping for a guessed number of seconds, and a screenshot of a
    // circuit with 0 buildings and 0 people in it is then obviously a failure
    // instead of a mystery.
    if (typeof window !== 'undefined') {
      // renderer.info is only populated after a render, so the draw-call and
      // triangle counts are filled in by the first frame rather than here.
      window.__wdc = { track: track.key, sky: sky ? sky.name : 'none', tex: look.on, ...this.stats };
      // A debug handle, so tools/shot.mjs can raycast through the scene and
      // say what a mystery object actually is. Cheaper than another screenshot
      // and a guess.
      window.__wdcView = this;
      // Raycast through a point on screen and name what is there. Every mesh
      // this project builds is given a name at creation, so the answer is
      // "pit.shell at 21 m" rather than "Mesh".
      window.__wdcProbe = (u = 0, v = 0) => {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(u, v), this.camera);
        return rc.intersectObjects(this.scene.children, true).slice(0, 5)
          .map(h => `${h.object.name || h.object.type} @ ${h.distance.toFixed(1)}m`);
      };
      this._published = true;
    }

    // Photo mode: park the camera at a point on the circuit and look down the
    // track from it. ?photo=s,lat,height,lead — purely a way to inspect the
    // far side of a world without driving there, so it lives in the renderer.
    const ph = new URLSearchParams(location.search).get('photo');
    if (ph) {
      const [s0, lat, y, lead, aimLat] = ph.split(',').map(Number);
      this.photo = {
        s: s0 || 0, lat: lat || 0, y: y || 3, lead: lead || 40,
        // The fifth number aims the camera SIDEWAYS, which is the only way to
        // look into a pit garage without driving a car into one.
        aimLat: Number.isFinite(aimLat) ? aimLat : 0,
      };
    }

    const car = buildCar(look, 0xd8352a);
    this.car = car.group; this.wheels = car.wheels; this.frontAxle = car.front; this.drs = car.drs;
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

  _world(env) {
    const t = this.track;
    const S = this.scene;
    const look = this.look;
    const stats = {};

    // The ground the whole circuit sits on. Big, textured, and the colour of
    // the region rather than a default green — it is what fills every gap the
    // survey does not cover.
    const bb = t.bbox, pad = 1400;
    const groundCol = t.wall === 'gravel' ? 0x63733f : t.key === 'zandvoort' ? 0xa9986f : 0x6d7048;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry((bb.x1 - bb.x0) + pad * 2, (bb.y1 - bb.y0) + pad * 2),
      look.mat(t.key === 'zandvoort' ? 'sand' : 'grass', { size: 5, tint: groundCol, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bb.x0 + bb.x1) / 2, -0.06, Z((bb.y0 + bb.y1) / 2));
    ground.receiveShadow = true;
    // UVs on a PlaneGeometry run 0..1, not metres, so this one surface has to
    // set its own repeat. Everything else in the project is metre-mapped.
    for (const m of [ground.material]) {
      for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap']) {
        if (m[k]) m[k].repeat.set((bb.x1 - bb.x0 + pad * 2) / 5, (bb.y1 - bb.y0 + pad * 2) / 5);
      }
    }
    S.add(ground);

    // Run-off: gravel at Monza and Suzuka, asphalt everywhere else. Grip is
    // handled in main.js; this is only what it looks like.
    const gravel = t.wall === 'gravel';
    const runMat = gravel
      ? look.mat('gravel', { size: 2.4, tint: 0xb6a487, roughness: 1, side: THREE.DoubleSide, normalScale: 1.5 })
      : look.mat('apron', { size: 3.2, tint: 0x83858a, roughness: 0.97, side: THREE.DoubleSide, normalScale: 1.4 });
    const runL = ribbon(t, i => t.w[i], i => t.w[i] + t.runL[i], -0.03);
    const runR = ribbon(t, i => -t.w[i], i => -(t.w[i] + t.runR[i]), -0.03);
    for (const b of [runL, runR]) { const m = b.mesh(runMat, { shadow: false }); if (m) S.add(m); }

    // 3 m of asphalt per tile: at 2 m the scan's directional streaking repeats
    // often enough along a straight to read as a pattern, and much beyond 3 the
    // aggregate stops being the right size to measure speed against.
    // normalScale stays near 1 — pushed to 1.8 the relief stopped looking like
    // asphalt and started looking like cracked dried mud.
    const road = roadSurface(t, this.line).mesh(look.mat('tarmac', {
      size: 3.0, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide,
      vertexColors: true, env: 0.8, normalScale: 1.05,
    }), { shadow: false });
    S.add(road);
    this.road = road;

    // The white lines that define the track limits. They sit a centimetre up
    // and are pulled forward in the depth buffer, because over a 2 km view
    // that centimetre is well inside the precision available.
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeea, roughness: 0.74, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    });
    for (const b of [ribbon(t, i => t.w[i] - 0.14, i => t.w[i], 0.006),
      ribbon(t, i => -(t.w[i] - 0.14), i => -t.w[i], 0.006)]) {
      const m = b.mesh(lineMat, { shadow: false });
      if (m) S.add(m);
    }

    const kb = kerbs(t).mesh(look.mat('concrete', {
      size: 1.4, roughness: 0.62, side: THREE.DoubleSide, vertexColors: true,
    }));
    if (kb) S.add(kb);

    // The real surroundings, if they have been baked. Without these the world
    // ends in a flat plane against the sky, which reads as a video game
    // instantly — and gives the eye nothing to measure speed against.
    // The pit complex is laid out BEFORE the city so the city can be told to
    // keep out of its way.
    const corridor = pitCorridor(t);
    stats.env = buildEnv(S, env, t, look, corridor);
    this.corridor = corridor;

    const sign = signAtlas(t);
    this.sign = sign;
    buildBarriers(S, t, look, sign, corridor);
    buildTyreWalls(S, t, look);
    buildBoards(S, t, this.line, look, sign);
    buildStartFinish(S, t, look, sign);
    buildMarshalPosts(S, t, look);
    stats.stands = buildGrandstands(S, t, env, look);
    stats.pit = buildPitLane(S, t, look, sign);

    // The ideal line, toggled with L — a reference, not a rail.
    const lg = ribbon(t, i => this.line.off[i] - 0.10, i => this.line.off[i] + 0.10, 0.02).geometry();
    this.lineMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
      color: 0x35d6a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.lineMesh.visible = false;
    S.add(this.lineMesh);

    return stats;
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
    const spin = car.speed * dt / 0.36;
    for (const k in this.wheels) this.wheels[k].rotation.z = roll - spin;
    // body roll and pitch, read straight off the accelerations. This is the
    // same weight transfer the tyres are already using — not a second, made-up
    // animation on top of it.
    this.car.rotation.z = -car.gLat * 0.030;
    this.car.rotation.x = -car.gLong * 0.022;
    // The DRS flap is a real flap: it opens when the wing is stalled, because
    // that is the only reason the car is faster on the straight.
    if (this.drs) this.drs.rotation.z = car.drsOpen ? -1.0 : 0;

    // smoke, fired by REAL slip past the tyre's peak, never by "a key is held"
    const over = hud.slipOver || 0;
    if (over > 0 && car.speed > 6) {
      const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
      const vwx = car.vx * cs - car.vy * sn, vwy = car.vx * sn + car.vy * cs;
      for (const sd of [0.76, -0.76]) {
        // rear axle, then out to each rear tyre along the car's left vector
        const px = car.x - cs * 1.30 - sn * sd;
        const py = car.y - sn * 1.30 + cs * sd;
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
    if (this.photo) {
      const t = this.track;
      const a = t.point(this.photo.s, this.photo.lat);
      const b = t.point(this.photo.s + this.photo.lead, this.photo.aimLat);
      this.camera.position.set(a.x, this.photo.y, Z(a.y));
      this.camera.lookAt(new THREE.Vector3(b.x, 0.9, Z(b.y)));
      if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
      this.rig.follow(a.x, Z(a.y));
      this.renderer.render(this.scene, this.camera);
      return;
    }

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

    // The sun's DIRECTION never changes — it is wherever it is in the sky
    // photograph. Only the origin follows the car, so the 110 m shadow box
    // always contains it.
    this.rig.follow(car.x, Z(car.y));

    this.renderer.render(this.scene, this.camera);

    // Publish the real cost of a frame once, after there is one to measure.
    // Guessing at triangle counts from source is how a scene quietly ends up
    // three times heavier than anybody intended.
    if (this._published && typeof window !== 'undefined') {
      this._published = false;
      const info = this.renderer.info.render;
      window.__wdc.draws = info.calls;
      window.__wdc.tris = info.triangles;
    }
  }
}
