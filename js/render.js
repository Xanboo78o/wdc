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
import { Look, sunRig } from './tex.js';
import { Post } from './post.js';
import { bankTable, bankY, bankRoll } from './bank.js';
import { buildEnv } from './env.js';
import { signAtlas, buildBarriers, buildTyreWalls, buildBoards, buildStartFinish, buildMarshalPosts } from './furniture.js';
import { buildGrandstands } from './crowd.js';
import { buildPitLane, pitCorridor } from './pit.js';
import { buildHorizon, buildGround, buildSkirt } from './horizon.js';
import { buildCar, buildGT3 } from './car.js';
import { makeDeformer } from './dent.js';
import { loadChassis, chassisGeometry } from './mesh.js';
import { World, loadElev } from './world.js';
import { loadSurface, defaultSurface, KERB_SHAPE } from './surface.js';

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
function roadSurface(track, line, bank) {
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
      // Height comes from the banking model. It is zero everywhere except
      // Zandvoort's two banked corners, so this costs one array lookup a
      // vertex on every other circuit.
      const ya0 = bankY(bank, t, i, li0), ya1 = bankY(bank, t, i, li1);
      const yb0 = bankY(bank, t, j, lj0), yb1 = bankY(bank, t, j, lj1);
      // Wound so the face normal comes out +Y after the reflection. Get this
      // backwards and, because the material is DoubleSide, three does not cull
      // it — it lights the tarmac from underneath and the whole road renders
      // near-black beside a run-off that looks perfect.
      const cols = [colourAt(i, li0), colourAt(i, li1), colourAt(j, lj1), colourAt(j, lj0)];
      b.quad([a[0], ya0, a[1]], [d[0], ya1, d[1]], [g[0], yb1, g[1]], [e[0], yb0, e[1]],
        [0, 1, 0],
        [[li0, foldV(i * t.ds)], [li1, foldV(i * t.ds)], [lj1, foldV(j * t.ds)], [lj0, foldV(j * t.ds)]],
        cols);
    }
  }
  return b;
}

// A ribbon between two lateral offsets, UV'd in metres. Flat, except where the
// circuit is banked — `bank` may be null for anything that should stay level.
// UVs are metres along the track, and a lap is thousands of them: at Monza
// that is 1,931 repeats of a 3 m photograph, and a GPU sampler keeps only a
// few fractional bits of a texture coordinate, so past a few hundred repeats
// every pixel of a tile samples nearly the same texel and the surface smears
// into streaks. Measured on the builder's terrain with a high-contrast scan by
// the parallel look-pass session; NOT visible on this road today, because the
// game's asphalt map is nearly featureless (stddev 4/255 — DESIGN.md says so),
// and the photographs before and after this change are identical within noise.
//
// The fold is insurance for the day a road carries a texture with something in
// it. A TRIANGLE wave, not a saw-tooth: continuous across every quad, so there
// is no seam case, and it mirrors the texture at each fold, which on asphalt
// and on kerb blocks is invisible. FOLD must be an exact multiple of every
// material size that uses these UVs — 96 covers 2, 2.4, 3, 4, 6, 8, 12, 16,
// 24, 32 and 48.
const FOLD = 96;
const foldV = s => FOLD - Math.abs((s % (2 * FOLD)) - FOLD);

function ribbon(track, innerAt, outerAt, y, bank = null) {
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
    const yi0 = y + (bank ? bankY(bank, t, i, ai) : 0);
    const yi1 = y + (bank ? bankY(bank, t, i, bi) : 0);
    const yj0 = y + (bank ? bankY(bank, t, j, aj) : 0);
    const yj1 = y + (bank ? bankY(bank, t, j, bj) : 0);
    b.quad([p0[0], yi0, p0[1]], [p1[0], yi1, p1[1]], [q1[0], yj1, q1[1]], [q0[0], yj0, q0[1]],
      [0, 1, 0],
      [[ai, foldV(i * t.ds)], [bi, foldV(i * t.ds)], [bj, foldV(j * t.ds)], [aj, foldV(j * t.ds)]]);
  }
  return b;
}

// A ribbon cut into one piece per surface material, so a lap can change from
// grass to gravel to asphalt where it really does. Returns { material: Builder }
// and only for the materials that actually occur.
function split(track, innerAt, outerAt, y, bank, matAt) {
  const t = track, out = {};
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    const m = matAt(i);
    (out[m] ||= new Builder());
    const b = out[m];
    const hi = t.hdg[i], hj = t.hdg[j];
    let ai = innerAt(i), bi = outerAt(i), aj = innerAt(j), bj = outerAt(j);
    if (ai === bi) continue;
    if (ai > bi) { const q = ai; ai = bi; bi = q; }
    if (aj > bj) { const q = aj; aj = bj; bj = q; }
    const P = (h, x, yy, lat) => [x - Math.sin(h) * lat, Z(yy + Math.cos(h) * lat)];
    const p0 = P(hi, t.x[i], t.y[i], ai), p1 = P(hi, t.x[i], t.y[i], bi);
    const q0 = P(hj, t.x[j], t.y[j], aj), q1 = P(hj, t.x[j], t.y[j], bj);
    const yi0 = y + (bank ? bankY(bank, t, i, ai) : 0);
    const yi1 = y + (bank ? bankY(bank, t, i, bi) : 0);
    const yj0 = y + (bank ? bankY(bank, t, j, aj) : 0);
    const yj1 = y + (bank ? bankY(bank, t, j, bj) : 0);
    b.quad([p0[0], yi0, p0[1]], [p1[0], yi1, p1[1]], [q1[0], yj1, q1[1]], [q0[0], yj0, q0[1]],
      [0, 1, 0],
      [[ai, foldV(i * t.ds)], [bi, foldV(i * t.ds)], [bj, foldV(j * t.ds)], [aj, foldV(j * t.ds)]]);
  }
  return out;
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
function kerbs(track, bank, surf) {
  const t = track;
  const b = new Builder({ color: true });
  const turfB = new Builder();
  const side = new Int8Array(t.n);
  for (const c of t.corners || []) {
    for (let s = c.s0 - 6; s <= c.s1 + 6; s += t.ds) side[t.idx(s)] = c.dir < 0 ? 1 : -1;
  }
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    const type = surf.kerb[i];
    if (!type || surf.kerb[j] !== type || !side[i] || side[i] !== side[j]) continue;
    // Shape comes from the TYPE, which comes from the corner's radius. A
    // hairpin kerb and a fast-corner kerb are not the same object: one is
    // there to punish you, one is there to be used every lap.
    const K = KERB_SHAPE[type] || KERB_SHAPE[2];
    const sg = side[i];
    const hi = t.hdg[i], hj = t.hdg[j];
    const P = (h, x, y, lat) => [x - Math.sin(h) * lat, Z(y + Math.cos(h) * lat)];
    const L = (lat) => [P(hi, t.x[i], t.y[i], sg * lat), P(hj, t.x[j], t.y[j], sg * lat)];
    const Y = (lat, k) => bankY(bank, t, k ? j : i, sg * lat);
    const col = (Math.floor(i * t.ds / K.block) % 2) ? 0xc7382c : 0xe4e4e0;
    const w0 = t.w[i] - 0.10, w1 = t.w[i], w2 = t.w[i] + K.w, w3 = t.w[i] + K.w + 0.14;
    const [i0, j0] = L(w0), [i1, j1] = L(w1), [i2, j2] = L(w2), [i3, j3] = L(w3);
    // inner chamfer, flat top, outer chamfer
    b.quadN([i0[0], Y(w0, 0), i0[1]], [j0[0], Y(w0, 1), j0[1]],
      [j1[0], Y(w1, 1) + K.h, j1[1]], [i1[0], Y(w1, 0) + K.h, i1[1]],
      [[0, 0], [t.ds, 0], [t.ds, 0.12], [0, 0.12]], col);
    b.quadN([i1[0], Y(w1, 0) + K.h, i1[1]], [j1[0], Y(w1, 1) + K.h, j1[1]],
      [j2[0], Y(w2, 1) + K.h, j2[1]], [i2[0], Y(w2, 0) + K.h, i2[1]],
      [[0, 0], [t.ds, 0], [t.ds, K.w], [0, K.w]], col);
    b.quadN([i2[0], Y(w2, 0) + K.h, i2[1]], [j2[0], Y(w2, 1) + K.h, j2[1]],
      [j3[0], Y(w3, 1), j3[1]], [i3[0], Y(w3, 0), i3[1]],
      [[0, 0], [t.ds, 0], [t.ds, 0.15], [0, 0.15]], col);

    // Astroturf outside the kerb on corner EXITS, which is where cars run
    // wide — and which is the strip that actually decides whether running wide
    // costs you anything.
    if (surf.turf[i] && surf.turf[j]) {
      const w4 = w3 + 1.25;
      const [i4, j4] = L(w4);
      turfB.quadN([i3[0], Y(w3, 0) + 0.012, i3[1]], [j3[0], Y(w3, 1) + 0.012, j3[1]],
        [j4[0], Y(w4, 1) + 0.012, j4[1]], [i4[0], Y(w4, 0) + 0.012, i4[1]],
        [[0, i * t.ds], [t.ds, i * t.ds], [t.ds, 1.25], [0, 1.25]]);
    }
  }
  return { kerb: b, turf: turfB };
}

export function crushParts(group, wheels) {
  const skip = new Set(Object.values(wheels || {}));
  const out = { front: [], rear: [], left: [], right: [] };
  group.traverse(m => {
    if (!m.isMesh || skip.has(m)) return;
    const p = m.position;
    let bin = null;
    if (p.x > 1.45) bin = 'front';
    else if (p.x < -1.45) bin = 'rear';
    else if (Math.abs(p.z) > 0.40 && Math.abs(p.x) < 1.25) bin = p.z > 0 ? 'left' : 'right';
    if (!bin) return;
    // A stable wobble per part, from its own position — so a given car always
    // folds the same way rather than re-rolling on every impact.
    const s = Math.sin(p.x * 37.13 + p.y * 71.7 + p.z * 13.9) * 43758.5453;
    out[bin].push({
      m, wob: (s - Math.floor(s)) * 2 - 1,
      home: { px: p.x, py: p.y, pz: p.z, rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z },
      endplate: Math.abs(p.z) > 0.70 && p.x > 1.45,
    });
  });
  return out;
}

export function applyCrush(parts, crush) {
  if (!parts) return;
  for (const key of ['front', 'rear', 'left', 'right']) {
    const c = Math.min(1, (crush && crush[key]) || 0);
    for (const it of parts[key]) {
      const h = it.home, m = it.m;
      if (c < 0.001) {
        m.position.set(h.px, h.py, h.pz);
        m.rotation.set(h.rx, h.ry, h.rz);
        m.scale.set(1, 1, 1);
        m.visible = true;
        continue;
      }
      if (key === 'front' || key === 'rear') {
        // the end folds back toward the tub and drops
        m.position.x = h.px * (1 - 0.30 * c);
        m.position.y = h.py - 0.13 * c;
        m.position.z = h.pz + it.wob * 0.10 * c;
        m.rotation.z = h.rz + it.wob * 0.55 * c;
        m.rotation.y = h.ry + it.wob * 0.30 * c;
        m.scale.x = 1 - 0.45 * c;
        // wing endplates are the first thing to leave an F1 car
        m.visible = !(it.endplate && c > 0.55);
      } else {
        // a side impact pushes the pod in against the tub
        m.position.z = h.pz * (1 - 0.50 * c);
        m.position.y = h.py - 0.05 * c;
        m.rotation.x = h.rx + it.wob * 0.40 * c;
        m.scale.z = 1 - 0.55 * c;
        m.scale.y = 1 - 0.20 * c;
      }
    }
  }
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
export class View {
  /**
   * Building a circuit now needs textures and a sky off the network, so
   * construction is asynchronous. `View.create` loads them and hands a ready
   * View back; the constructor never does I/O.
   */
  static async create(canvas, track, line, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Textures, sky and terrain all come off the network; fetch them together.
    // ?chassis=<name> swaps the bodywork for a model imported by
    // tools/chassis.mjs. It loads here, with the rest of the network work,
    // because buildCar is synchronous and the geometry has to exist first.
    const want = new URLSearchParams(location.search).get('chassis');
    const [look, elev, surf, chassis] = await Promise.all([
      Look.load(renderer, track.key, { textures: opts.textures !== false }),
      opts.flat ? null : loadElev(track.key),
      loadSurface(track.key),
      want ? loadChassis(want) : null,
    ]);
    return new View(renderer, look, track, line, { ...opts, elev, surf, chassis });
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
    this.sky = sky;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 4200);
    this.camPos = new THREE.Vector3();
    this.camAim = new THREE.Vector3();
    this.camH = 0;
    this.mode = 0;
    this.shake = 0;

    // Real surveyed elevation, from NASA SRTM. Null on a fresh clone that has
    // not run tools/getelev.mjs, and the world is simply flat then.
    this.world = new World(track, opts.elev);
    // What every metre of the circuit is made of — baked by tools/baksurf.mjs.
    // The fallback reproduces exactly what the renderer did before there were
    // tags, so a fresh clone still draws a circuit.
    this.surf = opts.surf || defaultSurface(track);
    this.rig = sunRig(this.scene, sky, { shadows: this.shadows });
    // Where the sun IS, for the god rays. sky.sun is a direction; the rays
    // want a point, so push it five kilometres that way and keep it relative
    // to the camera, or a sun at the world origin sits behind you at Monza.
    this.sunDir = new THREE.Vector3(...(sky?.sun || [0.55, 0.74, 0.38])).normalize();

    // QUALITY IS DETECTED, NOT CHOSEN (LOOK.md). Ask the chip what it is.
    // SwiftShader draws Monza at a frame every seven seconds and the Intel
    // UHD 620 at 112 ms; neither gets a post chain. ?post= overrides.
    const pq = new URLSearchParams(location.search).get('post');
    let quality = pq || 'high';
    if (!pq) {
      try {
        const gl = this.renderer.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        if (/swiftshader|software|llvmpipe/i.test(name)) quality = 'off';
        else if (/intel|uhd|iris/i.test(name)) quality = 'off';
      } catch { /* no extension, assume it can cope */ }
    }
    this.post = new Post(this.renderer, { quality });
    // Tuning knobs, because every number in post.js is a judgement about
    // light and I cannot see the screen. ?key=0.12&bloom=0.85&rays=0.75
    const qp = new URLSearchParams(location.search);
    for (const [k, f] of [['key', 'exposureKey'], ['bloom', 'bloom'], ['rays', 'rays'], ['thresh', 'threshold']]) {
      if (qp.has(k) && this.post.on) this.post[f] = +qp.get(k);
    }
    if (typeof window !== 'undefined') window.__wdcPost = this.post;
    this._lastT = 0;
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    this.stats = this._world(opts.env);
    if (typeof window !== 'undefined') window.__wdcBuildMs = Math.round(performance.now() - t0);
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
    // ?cam=0..3 picks a rig at load, so the harness can photograph one
    // without a human pressing C.
    const camQ = new URLSearchParams(location.search).get('cam');
    if (camQ != null) this.mode = Math.max(0, Math.min(3, parseInt(camQ, 10) || 0));

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

    // A GT3 is a different car, not a repainted single-seater.
    const car = opts.cls === 'gt3'
      ? buildGT3(look, 0x2f6fe0)
      : buildCar(look, 0xd8352a, opts.chassis ? chassisGeometry(THREE, opts.chassis) : null);
    this.car = car.group; this.wheels = car.wheels; this.steer = car.steer;
    this.drs = car.drs; this.wheelR = car.R; this.spin = 0;
    // The car's attitude now comes from four real spring deflections in
    // physics.js instead of a multiplier on a g-number. Measured over a hot
    // lap that is +-1.4 deg of roll and +-0.18 deg of pitch — which is exactly
    // right for a car this stiff, and completely invisible on a screen.
    //
    // SOFTEN is the camera's one lie, and it is deliberately the ONLY one: it
    // scales the deflections, not the angles, so roll and pitch keep the ratio
    // the real car has (it rolls about eight times more than it pitches) and a
    // single wheel dropping off a kerb still tips the car the way it really
    // would. ?soften=1 shows the true attitude; 0 pins it flat.
    const sf = new URLSearchParams(location.search).get('soften');
    this.soften = sf == null ? 6 : Math.max(0, +sf || 0);
    this.leanK = this.soften;
    // Wheel pivots in physics.js's corner order: FL, FR, RL, RR. A chassis
    // model loaded with ?chassis= has no hubs, hence the guard.
    const hb = car.hubs || null;
    this.susp = hb ? [hb.fl, hb.fr, hb.rl, hb.rr] : null;
    this.suspY = this.susp ? this.susp.map(h => h ? h.position.y : 0) : null;
    this.suspZ0 = null;   // static deflection, captured on the first frame
    // An imported chassis carries its own wings in its geometry, so the
    // procedural ones must stay hidden. They cannot just be set invisible at
    // build time: the frame loop below sets `m.visible = !lost.frontWing`
    // every frame, which turned them straight back on and the car had two rear
    // wings, one inside the other. Same shape of bug as applyCrush re-showing
    // the bodywork — anything that writes `visible` every frame owns it.
    this.wingParts = opts.chassis ? null : car.wings;
    // An imported chassis gets NO region fold. applyCrush re-shows every mesh
    // it owns on any frame where that region is undamaged (`m.visible = true`
    // in its c < 0.001 branch), which silently undid hiding the procedural
    // bodywork — the old rear wing reappeared through the imported body and
    // the car had two. An imported body cannot fold by region anyway; its
    // damage comes from the deformer below.
    this.crushParts = opts.chassis ? null : crushParts(car.group, car.wheels);
    // Bodywork bent where it was actually hit, on top of the region fold.
    // PLAYER ONLY: this takes its own copy of every geometry it touches,
    // because the field clones one reference car twenty-two times and
    // clone(true) SHARES geometry — denting a shared buffer would put the
    // same dent on the whole grid. Rivals keep the region fold, which is
    // transform-only and safe to share.
    this.deformer = makeDeformer(car.group, car.wheels);

    // ?dents=lx:ly:depth:r,...  — preset impacts in the car's own metres, so
    // the crumple can be photographed without arranging a crash first. Sits
    // here rather than in main.js for the same reason ?cam and ?photo do: it
    // is a renderer debug hook and it needs nothing from the game loop.
    // The push direction defaults to INWARD, toward the car's centreline,
    // which is the direction a real impact moves bodywork.
    // NOTE the target: `car` in THIS scope is buildCar's mesh bundle
    // ({group, wheels, steer, drs, R, wings}), not the physics car. Writing
    // dents onto it put them somewhere nothing reads, and the first
    // screenshots came back clean with no error to say why.
    const dq = new URLSearchParams(location.search).get('dents');
    if (dq) {
      this.presetDents = dq.split(',').map(bit => {
        const [lx, ly, depth, r] = bit.split(':').map(Number);
        const m = Math.hypot(lx || 0, ly || 0) || 1;
        return {
          lx: lx || 0, ly: ly || 0,
          nx: -(lx || 0) / m, ny: -(ly || 0) / m,
          depth: Math.max(0, Math.min(0.85, depth || 0.4)),
          r: Math.max(0.2, r || 0.9),
        };
      });
    }
    // YAW ON THE PARENT, ROLL AND PITCH ON THE CHILD.
    //
    // All three used to live on one object, and with three's default XYZ Euler
    // order that is wrong: the Z rotation is applied to the UN-yawed car, so
    // what was labelled body roll came out as pitch and what was labelled
    // pitch came out as roll, and both were only correct at heading zero. At
    // 0.03 rad nobody would ever see it. At 18 degrees of banking they would.
    // Splitting the two puts roll and pitch in the car's own frame.
    //
    // The crush parts are captured off `car.group` and deform in their own
    // local space, so reparenting the group leaves them untouched.
    this.carYaw = new THREE.Group();
    this.carYaw.add(this.car);
    this.scene.add(this.carYaw);
    this.hint = 0;

    // Where a bolted camera sits, and what it looks at, both children of the
    // car so they inherit its yaw, pitch, roll and banked height for nothing.
    this.camMount = new THREE.Object3D();
    this.camTarget = new THREE.Object3D();
    this.car.add(this.camMount, this.camTarget);
    // Scratch, so a 400 Hz-adjacent loop allocates nothing.
    this._v0 = new THREE.Vector3(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0);
    this.tvI = 0;
    this._smoke();

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Every frame goes through here, so the post chain can never be skipped. */
  _draw() {
    // renderer.info RESETS on every render() call, and the post chain ends
    // with a full-screen quad — so main.js's telemetry started reporting
    // "draws: 1, tris: 2" for a circuit with two thousand buildings in it.
    // Held across the whole frame instead, so the numbers now include the
    // post passes, which is what a frame actually costs anyway.
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    const dt = this._lastT ? Math.min(0.1, now - this._lastT) : 0.016;
    this._lastT = now;
    if (this.post && this.post.on) {
      this.post.setSun(
        this.sunDir.clone().multiplyScalar(5000).add(this.camera.position),
        this.camera);
      this.post.render(this.scene, this.camera, dt);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  _world(env) {
    const t = this.track;
    const S = this.scene;
    const look = this.look;
    const stats = {};
    // The air, and what is in the distance. First, because everything else is
    // judged against it: without layered distance and real aerial perspective
    // a circuit reads as a diorama however good its surfaces are.
    stats.horizon = buildHorizon(S, t, env, this.sky, this.world);
    stats.elev = this.world.on
      ? { rise: +(Math.max(...this.world.elev.s) - Math.min(...this.world.elev.s)).toFixed(1), set: this.world.elev.dataset }
      : null;
    // Zandvoort banks 18 degrees at Tarzanbocht and Arie Luyendyk. Everywhere
    // else this table is all zeroes and costs one lookup per vertex.
    this.bank = bankTable(t);
    const bank = this.bank;

    // The ground the whole circuit sits on. Big, textured, and the colour of
    // the region rather than a default green — it is what fills every gap the
    // survey does not cover.
    const plate = buildGround(t, look, this.sky, this.world);
    // Named, like the pit meshes, so tools/groundcheck.mjs can raycast at the
    // GROUND and nothing else. Without a name it has to guess from a hit list,
    // and a tree standing on a hole in the world looks exactly like ground.
    plate.name = 'ground.plate';
    S.add(plate);
    // Fills the hole buildGround leaves around the circuit, at track
    // resolution, so the terrain can never close over the road.
    const skirt = buildSkirt(t, look, this.sky, this.world, buildGround.hole || 260, buildGround.cell || 0);
    if (skirt) { skirt.name = 'ground.skirt'; S.add(skirt); }

    // RUN-OFF, BY MATERIAL.
    //
    // It used to be one material for a whole circuit, which is wrong in a way
    // you notice without being able to name it: Monza does not have a gravel
    // trap running the length of the main straight, it has mown grass, and
    // gravel only where a car leaving the road would actually land. The tags
    // come from data/surf/, so the rules live in one readable place rather
    // than as conditionals in here.
    const RUNMAT = [
      look.mat('gravel', { size: 2.4, tint: 0xb6a487, roughness: 1, side: THREE.DoubleSide, normalScale: 1.5 }),
      look.mat('apron', { size: 3.2, tint: 0x83858a, roughness: 0.97, side: THREE.DoubleSide, normalScale: 1.4 }),
      look.mat('grass', { size: 3.4, tint: 0x6d7a45, roughness: 1, side: THREE.DoubleSide, normalScale: 1.2 }),
      look.mat('concrete', { size: 3.0, tint: 0xb8b6b0, roughness: 0.95, side: THREE.DoubleSide }),
    ];
    for (const [side, tag] of [[1, this.surf.runL], [-1, this.surf.runR]]) {
      const parts = split(t, i => side * t.w[i],
        i => side * (t.w[i] + (side > 0 ? t.runL[i] : t.runR[i])), -0.03, bank, i => tag[i]);
      for (const m in parts) {
        const mesh = parts[m].mesh(RUNMAT[m] || RUNMAT[1], { shadow: false });
        if (mesh) { this.world.lift(mesh.geometry); S.add(mesh); }
      }
    }

    const road = roadSurface(t, this.line, bank).mesh(look.mat('tarmac', {
      size: 3.0, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide,
      vertexColors: true, env: 0.8, normalScale: 1.05,
    }), { shadow: false });
    this.world.lift(road.geometry);
    S.add(road);
    this.road = road;

    // The white lines that define the track limits. They sit a centimetre up
    // and are pulled forward in the depth buffer, because over a 2 km view
    // that centimetre is well inside the precision available.
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeea, roughness: 0.74, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    });
    for (const b of [ribbon(t, i => t.w[i] - 0.14, i => t.w[i], 0.006, bank),
      ribbon(t, i => -(t.w[i] - 0.14), i => -t.w[i], 0.006, bank)]) {
      const m = b.mesh(lineMat, { shadow: false });
      if (m) { this.world.lift(m.geometry); S.add(m); }
    }

    const kp = kerbs(t, bank, this.surf);
    const kb = kp.kerb.mesh(look.mat('concrete', {
      size: 1.4, roughness: 0.62, side: THREE.DoubleSide, vertexColors: true,
    }));
    if (kb) { this.world.lift(kb.geometry); S.add(kb); }
    const tf = kp.turf.mesh(look.mat('grass', {
      size: 1.1, tint: 0x3f6b34, roughness: 1, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }), { shadow: false });
    if (tf) { this.world.lift(tf.geometry); S.add(tf); }

    // The real surroundings, if they have been baked. Without these the world
    // ends in a flat plane against the sky, which reads as a video game
    // instantly — and gives the eye nothing to measure speed against.
    // The pit complex is laid out BEFORE the city so the city can be told to
    // keep out of its way.
    const corridor = pitCorridor(t);
    stats.env = buildEnv(S, env, t, look, corridor, this.world);
    this.corridor = corridor;

    const sign = signAtlas(t);
    this.sign = sign;
    buildBarriers(S, t, look, sign, corridor, this.world);
    buildTyreWalls(S, t, look, this.world);
    buildBoards(S, t, this.line, look, sign, this.world);
    buildStartFinish(S, t, look, sign, this.world);
    buildMarshalPosts(S, t, look, this.world);
    stats.stands = buildGrandstands(S, t, env, look, this.world, sign);
    stats.pit = buildPitLane(S, t, look, sign, this.world);
    this.tvCams = this._tvCameras();
    stats.tvCams = this.tvCams.length;

    // The ideal line, toggled with L — a reference, not a rail.
    const lg = this.world.lift(
      ribbon(t, i => this.line.off[i] - 0.10, i => this.line.off[i] + 0.10, 0.02, bank).geometry());
    this.lineMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
      color: 0x35d6a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.lineMesh.visible = false;
    S.add(this.lineMesh);

    return stats;
  }

  // ---------------------------------------------------------------------------
  // Broadcast cameras: fixed positions beside the circuit that hand the car off
  // to each other as it comes past. Placed on whichever side has room for a
  // tower, which is the same rule a real outside broadcast follows.
  // ---------------------------------------------------------------------------
  _tvCameras() {
    const t = this.track;
    const cams = [];
    const corridor = this.corridor;
    // Nothing may stand in the pit complex. The first version put the camera
    // for the start line inside the pit lane, so the opening broadcast shot
    // was half pit wall.
    const inPit = (x, y) => {
      if (!corridor) return false;
      const r2 = (corridor.radius + 12) ** 2;
      for (const q of corridor.pts) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < r2) return true;
      return false;
    };
    for (let s = 0; s < t.length; s += 255) {
      const i = t.idx(s);
      let placed = null;
      // Prefer the side with more room, but take the other one rather than
      // stand in the pits.
      const order = t.runL[i] > t.runR[i] ? [1, -1] : [-1, 1];
      for (const side of order) {
        const run = side > 0 ? t.runL[i] : t.runR[i];
        const lat = side * (t.w[i] + run + Math.min(14, 4 + run * 0.5));
        const p = t.point(s, lat);
        if (inPit(p.x, p.y)) continue;
        // 6-8 m, not 12. A camera twelve metres up at thirty looks DOWN at
        // twenty degrees and the shot becomes mostly tarmac; real trackside
        // towers sit low enough to shoot nearly along the track surface.
        placed = { s, x: p.x, y: 6.2 + (run > 14 ? 1.6 : 0), z: Z(p.y) };
        break;
      }
      if (placed) cams.push(placed);
    }
    return cams;
  }

  // Hold a camera until the car is well past it, then take the next one. Real
  // directors cut late rather than early, and switching on nearest-distance
  // alone produces a shot that changes every two seconds.
  _pickTvCamera(carS) {
    const cams = this.tvCams;
    if (!cams || !cams.length) return null;
    const t = this.track;
    const cur = cams[this.tvI % cams.length];
    const gap = t.gap(cur.s, carS);       // positive = the camera is ahead
    if (gap < -170 || gap > 620) {
      let best = this.tvI, bestGap = Infinity;
      for (let k = 0; k < cams.length; k++) {
        const g = t.gap(cams[k].s, carS);
        if (g > 40 && g < bestGap) { bestGap = g; best = k; }
      }
      this.tvI = best;
    }
    return cams[this.tvI % cams.length];
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

  puff(x, z, vx, vz, force, baseY = 0) {
    const p = this.smoke[this.smokeI];
    this.smokeI = (this.smokeI + 1) % this.smokeMax;
    p.life = 1;
    p.x = x; p.y = baseY + 0.12; p.z = z;
    p.vx = -vx * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vz = -vz * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vy = 0.5 + Math.random() * 0.9 * force;
  }

  setMode(m) { this.mode = ((m % 4) + 4) % 4; }
  toggleLine() { this.lineMesh.visible = !this.lineMesh.visible; return this.lineMesh.visible; }

  // dt here is a REAL frame time — camera smoothing is allowed to be
  // frame-rate dependent, the simulation is not.
  frame(car, dt, hud = {}) {
    // Where the car is on the circuit, for the banked height and lean. The
    // renderer keeps its own hint so it needs nothing from main.js; searching
    // 90 samples once a FRAME is free next to doing it every physics substep.
    const proj = this.track.project(car.x, car.y, this.hint);
    this.hint = proj.i;
    // Where the ground is under the car: the surveyed profile along the racing
    // line, plus whatever camber the corner has. The same two numbers the road
    // geometry was built from, so the car cannot float or sink.
    const surfaceY = this.world.trackYAt(proj.s) + bankY(this.bank, this.track, proj.i, proj.lat);

    // car.z is height above the LOCAL road surface, so surfaceY already being
    // the real surveyed height of that road means the two compose with nothing
    // to reconcile.
    this.carYaw.position.set(car.x, surfaceY + (car.z || 0), Z(car.y));
    this.carYaw.rotation.y = car.hdg;
    // STEERING. Each front wheel pivots at its OWN hub — see js/car.js for
    // what happened when they shared one group at the car's centre.
    //
    // The sign is +delta, not -delta. A positive delta steers LEFT, and a mesh
    // built along +X needs rotation.y = +delta to point its nose that way once
    // the sim->three reflection is accounted for. It had been negated since
    // day one, so the front wheels pointed the wrong way in every corner —
    // invisible from a chase camera, and the first thing you see from onboard.
    //
    // Ackermann: the inside wheel takes more angle than the outside one,
    // because they are tracing circles of different radius about the same
    // centre. It is a few degrees and it is very visible at full lock.
    const ACK = 0.13;
    const dl = car.delta * (car.delta > 0 ? 1 + ACK : 1 - ACK);
    const dr = car.delta * (car.delta > 0 ? 1 - ACK : 1 + ACK);
    this.steer.fl.rotation.y = dl;
    this.steer.fr.rotation.y = dr;
    // Wheel rotation is ACCUMULATED, not read back off the mesh, so it cannot
    // drift when a wheel is reparented or reset.
    this.spin -= car.speed * dt / this.wheelR;
    for (const k in this.wheels) this.wheels[k].rotation.z = this.spin;

    // Body roll and pitch, in the car's own frame now.
    //
    // Roll is driven by the CENTRIPETAL acceleration, `vx * r`, not by
    // `car.gLat`. gLat is `Fy/m - vx*r`, which is the rate of change of
    // lateral velocity — and in a steady corner that is approximately zero,
    // however hard the car is cornering. Rolling the body off it meant the car
    // never visibly leaned in a long corner at all.
    const latG = Math.max(-5, Math.min(5, (car.vx * car.r) / 9.81));
    // car.roll and car.pitch are the REAL attitude out of physics.js and are
    // exactly zero unless the car has left the ground — so adding them keeps
    // the cosmetic cornering lean while driving and hands the whole attitude
    // over to the simulation the moment it flies.
    //
    // The camber term is gated on being airborne. Unlike latG, which falls to
    // nothing on its own once the tyres are unloaded, bankRoll is a function
    // of where the car is on the TRACK — so a car flying over Zandvoort's
    // banking would keep leaning eighteen degrees at it for no reason.
    const grounded = car.airborne ? 0 : 1;
    // Airborne, car.roll/car.pitch are the TRUE attitude — a car on its roof is
    // at pi — so the exaggeration has to go away, and it has to go away
    // smoothly or the car snaps upright the instant it takes off.
    this.leanK += ((car.airborne ? 1 : this.soften) - this.leanK) * Math.min(1, dt * 6);
    this.car.rotation.x = (car.roll || 0) * this.leanK
      + bankRoll(this.bank, this.track, proj.i, proj.lat) * grounded;
    this.car.rotation.z = (car.pitch || 0) * this.leanK;
    // The wheels move in their arches. 60 mm of travel is a lot of visible
    // movement at this scale, and it is the cue that reads as "this is a
    // machine with springs" from the chase camera and from onboard.
    if (car.wheelZ && this.susp) {
      // Show the CHANGE from the car's resting deflection, not the absolute
      // compression — otherwise every wheel starts 12 mm into its arch.
      if (!this.suspZ0) this.suspZ0 = car.wheelZ.slice();
      for (let i = 0; i < 4; i++) {
        const h = this.susp[i];
        if (h) h.position.y = this.suspY[i] - (car.wheelZ[i] - this.suspZ0[i]) * this.leanK;
      }
    }

    // Bodywork that is no longer attached should not be drawn. physics.js
    // already reads `car.lost` — losing the front wing costs 56% of front
    // downforce — so hiding it is honest rather than decorative.
    if (this.wingParts) {
      const lost = car.lost || {};
      for (const m of this.wingParts.front) m.visible = !lost.frontWing;
      for (const m of this.wingParts.rear) m.visible = !lost.rearWing;
    }
    // Bodywork damage, straight off the contact impulses in collide.js.
    applyCrush(this.crushParts, car.crush);
    // Cheap: returns immediately unless the dent set actually changed, which
    // only happens on contact.
    if (this.deformer) this.deformer.apply(this.presetDents || car.dents);
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
        if (Math.random() < Math.min(1, over * 2.2)) this.puff(px, Z(py), vwx, Z(vwy), Math.min(2, over * 3), surfaceY);
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

    // ---- camera -------------------------------------------------------------
    //
    // "ALL U GOT INTO MAKING THESE IRACING QUALITY (not textures and shaders)".
    //
    // Half of that is the air, which is js/horizon.js. The other half is this,
    // and it is the cheaper half: a sim looks like a sim because of where the
    // camera is and what it is bolted to, not because of what the surfaces are
    // made of. Four rigs, and the default is the one every real onboard is
    // shot from.
    //
    // ONBOARD is BOLTED TO THE CAR — above the airbox, looking down the nose.
    // It pitches when you brake and leans when you turn, because it is
    // attached to a thing that is pitching and leaning. That single fact does
    // more for how violent a braking zone feels than any amount of material
    // work, and it is why a chase camera can never feel like a car. The roll
    // is damped to 55% of the real thing, the way a broadcast onboard is
    // part-stabilised — full roll is accurate and makes people ill.
    //
    // TV is a real broadcast rig: fixed cameras standing beside the circuit,
    // handing the car off to each other as it comes past, ZOOMING to hold it
    // at a constant size in frame. The zoom is the tell — it is what makes
    // footage read as televised rather than as a game replay.
    const RIGS = [
      { name: 'ONBOARD', kind: 'bolted', at: [-0.34, 1.19, 0], aim: 24, fov: 56, kick: 0.55, roll: 0.55 },
      { name: 'CHASE', kind: 'chase', dist: 5.6, height: 1.66, lead: 13, fov: 55, kick: 1 },
      { name: 'NOSE', kind: 'bolted', at: [1.62, 0.46, 0], aim: 26, fov: 62, kick: 0.8, roll: 0.85 },
      { name: 'TV', kind: 'tv', fov: 40, kick: 0 },
    ];
    if (this.photo) {
      const t = this.track;
      const a = t.point(this.photo.s, this.photo.lat);
      const b = t.point(this.photo.s + this.photo.lead, this.photo.aimLat);
      // Heights are ABOVE THE TRACK, not above sea level. Taken as absolute,
      // a 1.3 m camera at Monaco ends up twenty metres underground and you
      // photograph the underside of the city.
      const ay = this.world.trackYAt(this.photo.s);
      const by = this.world.trackYAt(this.photo.s + this.photo.lead);
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(a.x, ay + this.photo.y, Z(a.y));
      this.camera.lookAt(new THREE.Vector3(b.x, by + 0.9, Z(b.y)));
      if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
      this.rig.follow(a.x, Z(a.y));
      this._draw();
      return;
    }
    const rig = RIGS[this.mode];

    // Vibration. A car at speed is never still, and a perfectly steady frame
    // is the other reason 210 km/h used to read as 60 — there was nothing
    // shaking. High frequency and TINY: this is felt rather than seen, and the
    // moment you can see it, it is a gimmick.
    const buzz = (0.0016 + car.speed * 0.00017) * (rig.kick || 0);
    this.shake = Math.max(this.shake * (1 - dt * 6),
      (hud.rough || 0) * 0.42 + Math.max(0, Math.abs(latG) - 1.8) * 0.045);
    const jx = (Math.random() - 0.5), jy = (Math.random() - 0.5), jz = (Math.random() - 0.5);
    const amp = this.shake + buzz;

    let fov = rig.fov;
    if (rig.kind === 'bolted') {
      // Read the camera's world placement off the car itself, so it inherits
      // yaw, pitch, roll and the banked height for free.
      this.camMount.position.set(rig.at[0], rig.at[1], rig.at[2]);
      this.camTarget.position.set(rig.at[0] + rig.aim, rig.at[1] - 0.22, 0);
      this.car.updateWorldMatrix(true, false);
      this.camMount.getWorldPosition(this._v0);
      this.camTarget.getWorldPosition(this._v1);
      // Part-stabilised roll: blend the car's own up vector back toward the
      // world's. At 1.0 the horizon tips with the chassis and it is unpleasant;
      // at 0 it is a chase camera that happens to be close.
      this._v2.set(0, 1, 0).applyQuaternion(this.car.getWorldQuaternion(this._q))
        .lerp(this._up, 1 - (rig.roll ?? 0.6)).normalize();
      this.camera.up.copy(this._v2);
      this.camera.position.copy(this._v0).addScaledVector(this._v2, 0);
      this.camera.position.x += jx * amp; this.camera.position.y += jy * amp; this.camera.position.z += jz * amp;
      this.camera.lookAt(this._v1);
      fov = rig.fov + Math.min(16, car.speed * 0.17) * rig.kick;
    } else if (rig.kind === 'tv') {
      const cam = this._pickTvCamera(proj.s);
      if (cam) {
        this.camera.up.copy(this._up);
        this.camera.position.set(cam.x, cam.y, cam.z);
        this._v1.set(car.x, 0.6, Z(car.y));
        this.camera.lookAt(this._v1);
        // Hold the car at a constant size in frame. A broadcast camera zooms;
        // a game camera does not, and that is most of the difference.
        const dist = this.camera.position.distanceTo(this._v1);
        // Hold the car at roughly a quarter of the frame. The first attempt
        // aimed for a twelfth, which is technically a constant size and reads
        // as a security camera.
        fov = Math.max(7, Math.min(38, 2 * Math.atan(9 / Math.max(18, dist)) * 180 / Math.PI));
      }
    } else {
      // Chase. Aim between where the nose points and where the car is actually
      // GOING, so a slide reads on screen instead of the camera hiding it.
      const beta = Math.atan2(car.vy, Math.max(car.vx, 3));
      let want = car.hdg + beta * 0.5;
      let d = want - this.camH;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.camH += d * Math.min(1, dt * 7);
      const ch = Math.cos(this.camH), sh = Math.sin(this.camH);
      this._v0.set(car.x - ch * rig.dist, surfaceY + rig.height, Z(car.y - sh * rig.dist));
      this.camPos.lerp(this._v0, Math.min(1, dt * 9));
      this.camera.up.copy(this._up);
      this.camera.position.set(this.camPos.x + jx * amp, this.camPos.y + jy * amp, this.camPos.z + jz * amp);
      this.camAim.lerp(this._v1.set(car.x + ch * rig.lead, surfaceY + 0.75, Z(car.y + sh * rig.lead)), Math.min(1, dt * 10));
      this.camera.lookAt(this.camAim);
      fov = rig.fov + Math.min(20, car.speed * 0.22) * rig.kick;
    }
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // The sun's DIRECTION never changes — it is wherever it is in the sky
    // photograph. Only the origin follows the car, so the 110 m shadow box
    // always contains it.
    this.rig.follow(car.x, Z(car.y));

    this._draw();

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
