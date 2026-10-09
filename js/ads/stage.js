// stage.js — a film set built from the game's own circuit data.
//
// The game's renderer (js/render.js View) is welded to the race loop, the live
// weather and the wall clock, and an advert has to be the same picture every
// time it is asked for second 12. So this builds a lean scene of its own from
// the SAME data and the SAME exported builders: the surveyed centreline and
// elevation (Track, World), the photographed surfaces and sky (Look, ProcSky),
// and — each one optional, each one allowed to fail — the game's barriers,
// boards, grandstands, woods, horizon and pit lane.
//
// Only the racing surface, its lines, kerbs and run-off are rebuilt here,
// because those builders are private to render.js. They follow its conventions
// exactly: world x = track x, world z = -track y, UVs in metres, lifted onto
// the survey by World.lift().
//
// Everything is READ-ONLY on the game: this file imports, it never edits.
import * as THREE from 'three';
import { Track } from '../track.js';
import { World, loadElev } from '../world.js';
import { Look } from '../tex.js';
import { Z, Builder } from '../geom.js';
import { bankTable, bankY } from '../bank.js';

const Q = new URLSearchParams(location.search);
const opt = p => import(p).catch(e => { console.warn('[ad] optional module missing:', p, String(e)); return null; });
const safe = (name, f) => { try { return f(); } catch (e) { console.warn('[ad] ' + name + ' failed:', e); return null; } };

const FOLD = 96;
const foldV = s => FOLD - Math.abs((s % (2 * FOLD)) - FOLD);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// LIGHT. One preset per time of day; a shot names one and may override bits.
// `az` is the compass the SUN sits at in world x/z (0 = +x, 90 = +z), `el` its
// height. `key` is what the directional light actually uses for elevation, so
// a sun on the horizon can still throw a usable shadow.
// ---------------------------------------------------------------------------
export const MOODS = {
  dawn: {
    el: 4.0, az: 0, keyEl: 9, turb: 3.4, cloud: 0.22,
    sun: [2.3, 1.0, 0.56, 0.30], hemi: [0.62, [0.50, 0.56, 0.80], [0.20, 0.16, 0.14]],
    fog: [[0.56, 0.42, 0.38], 0.0017], env: 0.55, bg: 1.0, far: [0.50, 0.38, 0.38], farTree: [0.2, 0.17, 0.2],
    exposure: 1.25, lamps: 0.9, wet: 0.25, shadows: true,
  },
  day: {
    el: 31, az: 0, keyEl: 31, turb: 2.2, cloud: 0.26,
    sun: [3.1, 1.0, 0.95, 0.86], hemi: [0.80, [0.62, 0.70, 0.86], [0.30, 0.27, 0.22]],
    fog: [[0.66, 0.74, 0.88], 0.00050], env: 0.6, bg: 0.85, far: [1, 1, 1], farTree: [0.42, 0.52, 0.40],
    exposure: 1.22, lamps: 0, wet: 0, shadows: true,
  },
  golden: {
    el: 11, az: 0, keyEl: 13, turb: 3.6, cloud: 0.30,
    sun: [3.0, 1.0, 0.74, 0.46], hemi: [0.60, [0.56, 0.60, 0.80], [0.28, 0.20, 0.14]],
    fog: [[0.78, 0.60, 0.44], 0.00062], env: 0.6, bg: 1.0, far: [0.9, 0.74, 0.62], farTree: [0.40, 0.36, 0.26],
    exposure: 1.55, lamps: 0, wet: 0, shadows: true,
  },
  flat: {     // the documentary: a plain, pleasant, slightly dull afternoon
    el: 38, az: 0, keyEl: 38, turb: 2.6, cloud: 0.42,
    sun: [2.6, 1.0, 0.97, 0.92], hemi: [0.95, [0.70, 0.74, 0.82], [0.32, 0.30, 0.26]],
    fog: [[0.74, 0.79, 0.86], 0.0006], env: 0.6, bg: 0.9, far: [1, 1, 1], farTree: [0.42, 0.52, 0.40],
    exposure: 1.25, lamps: 0, wet: 0, shadows: true,
  },
  night: {
    el: -22, az: 0, keyEl: 24, turb: 3, cloud: 0.9,
    sun: [0.55, 0.50, 0.62, 1.0], hemi: [0.30, [0.20, 0.26, 0.48], [0.03, 0.03, 0.05]],
    fog: [[0.020, 0.028, 0.050], 0.0055], env: 1.0, bg: 1.0, far: [0.035, 0.045, 0.08],
    exposure: 1.25, lamps: 1, wet: 1, shadows: false,
  },
};

export class Stage {
  static async create(canvas, trackKey, opts = {}) {
    const st = new Stage();
    await st._init(canvas, trackKey, opts);
    return st;
  }

  async _init(canvas, trackKey, opts) {
    const lo = Q.has('lo');                 // ?lo=1: no woods, no town — a fast look at framing
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer = renderer;
    let gpu = '';
    try {
      const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    } catch { /* unknown chip */ }
    this.gpu = gpu;
    this.soft = /swiftshader|software|llvmpipe/i.test(gpu);
    this.weak = this.soft || /intel|uhd|iris/i.test(gpu);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;       // the grade pass tone-maps (js/ads/grade.js)
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.15, 30000);

    const progress = opts.progress || (() => {});
    progress('circuit');
    const [track, look, elev, surfMod, lineMod, physMod] = await Promise.all([
      Track.load(trackKey),
      Look.load(renderer, trackKey),
      loadElev(trackKey),
      opt('../surface.js'), opt('../line.js'), opt('../physics.js'),
    ]);
    this.track = track; this.look = look;
    const sky = this.sky = look.install(scene);
    const world = this.world = new World(track, elev);
    const bank = this.bank = bankTable(track);

    // The racing line and how fast a car really is at every metre of it.
    this.line = null;
    if (lineMod && physMod) this.line = safe('racing line', () => lineMod.buildLines(track, physMod.CARS[opts.car || 'f1']).race);
    if (!this.line) {
      const off = track.line ? Float32Array.from(track.line) : new Float32Array(track.n);
      const v = new Float32Array(track.n);
      for (let i = 0; i < track.n; i++) v[i] = Math.max(18, Math.min(88, Math.sqrt(22 / Math.max(1e-4, Math.abs(track.curv[i])))));
      this.line = { off, v };
    }
    this._timeTable();

    progress('surface');
    const surf = this.surf = (surfMod && await surfMod.loadSurface(trackKey)) || (surfMod ? surfMod.defaultSurface(track) : null);
    this._road(surfMod);

    // ---- the game's own scenery, piece by piece ---------------------------
    progress('scenery');
    const [envMod, furn, lamps, crowd, pit, horizon, dlcMod] = await Promise.all([
      opt('../env.js'), opt('../furniture.js'), opt('../lamps.js'), opt('../crowd.js'),
      opt('../pit.js'), opt('../horizon.js'), opt('../dlc.js'),
    ]);
    const env = envMod && !Q.has('noenv') ? await envMod.loadEnv(trackKey) : null;
    this.env = env;
    this.farMats = [];
    if (horizon) {
      const before = new Set(scene.children);
      safe('horizon', () => horizon.buildHorizon(scene, track, env, sky, world));
      safe('ground', () => { const g = horizon.buildGround(track, look, sky, world); g.name = 'ground.plate'; scene.add(g);
        const sk = horizon.buildSkirt(track, look, sky, world, horizon.buildGround.hole || 260, horizon.buildGround.cell || 0);
        if (sk) { sk.name = 'ground.skirt'; scene.add(sk); } });
      // The far rings are unlit (MeshBasic) so they stay day-coloured at night
      // unless told otherwise; remember them and their colours.
      for (const o of scene.children) if (!before.has(o)) o.traverse(m => {
        if (m.isMesh && m.material && m.material.isMeshBasicMaterial) this.farMats.push({ m: m.material, c: m.material.color.clone(), tree: !!m.isInstancedMesh });
      });
    }
    if (!scene.fog) scene.fog = new THREE.FogExp2(0xa7aabb, 0.0005);
    const corridor = pit ? safe('pit corridor', () => pit.pitCorridor(track)) : null;
    const dlc = dlcMod ? safe('dlc', () => dlcMod.dlcFor(track.key)) : null;
    const skip = dlc ? dlc.replaces : new Set();
    if (dlc && env) safe('dlc.prepareEnv', () => dlc.prepareEnv(env, track));
    if (envMod && env && !lo) safe('env', () => envMod.buildEnv(scene, env, track, look, corridor, world));
    let sign = null;
    if (furn) {
      sign = this.sign = safe('signs', () => furn.signAtlas(track));
      if (!skip.has('barriers')) safe('barriers', () => furn.buildBarriers(scene, track, look, sign, corridor, world));
      if (!skip.has('tyreWalls')) safe('tyre walls', () => furn.buildTyreWalls(scene, track, look, world));
      if (!skip.has('boards')) safe('boards', () => furn.buildBoards(scene, track, this.line, look, sign, world));
      if (!skip.has('startFinish')) safe('start/finish', () => furn.buildStartFinish(scene, track, look, sign, world));
      if (!skip.has('marshals')) safe('marshal posts', () => furn.buildMarshalPosts(scene, track, look, world));
      if (!skip.has('flagpoles')) safe('flagpoles', () => furn.buildFlagpoles(scene, track, world));
    }
    if (lamps) this.courseLights = safe('course lights', () => lamps.buildCourseLights(scene, track, world));
    this.lampsMod = lamps;
    if (crowd && !lo) safe('grandstands', () => crowd.buildGrandstands(scene, track, env, look, world, sign));
    if (pit && !lo) safe('pit lane', () => pit.buildPitLane(scene, track, look, sign, world));
    if (dlc && !lo) safe('dlc.build', () => dlc.build(this, { S: scene, t: track, env, look, sign, world, corridor, line: this.line }));

    // ---- light ---------------------------------------------------------------
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    const sh = this.soft ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sh, sh);
    const d = 46;
    Object.assign(this.sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 120, far: 620 });
    this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.3;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0.5, 0.7, 0.4).normalize();
    // Two practical lamps a night shot may place (headlights, a floodlight).
    // Always in the scene so switching one on never recompiles a shader.
    this.spots = [0, 1].map(() => {
      const s = new THREE.SpotLight(0xfff0dc, 0, 160, 0.42, 0.7, 1.6);
      scene.add(s, s.target); return s;
    });
    this.points = [0, 1].map(() => { const p = new THREE.PointLight(0xffffff, 0, 80, 1.8); scene.add(p); return p; });

    const skyMod = await opt('../sky.js');
    this.proc = skyMod ? safe('sky', () => new skyMod.ProcSky(renderer, { size: this.soft ? 256 : 512 })) : null;
    this._moodKey = '';
    this.mood = null;
    this.setMood('day');
    return this;
  }

  // -------------------------------------------------------------------------
  // The racing surface. See render.js roadSurface/ribbon/kerbs for the
  // originals these follow.
  // -------------------------------------------------------------------------
  _P(i, lat) {
    const t = this.track, h = t.hdg[i];
    return [t.x[i] - Math.sin(h) * lat, bankY(this.bank, t, i, lat), Z(t.y[i] + Math.cos(h) * lat)];
  }

  _ribbon(innerAt, outerAt, y, matAt = null) {
    const t = this.track, out = {};
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      if (t.open && j === 0) continue;
      const m = matAt ? matAt(i) : 0;
      const b = (out[m] ||= new Builder());
      let ai = innerAt(i), bi = outerAt(i), aj = innerAt(j), bj = outerAt(j);
      if (ai === bi) continue;
      if (ai > bi) { const q = ai; ai = bi; bi = q; }
      if (aj > bj) { const q = aj; aj = bj; bj = q; }
      const p0 = this._P(i, ai), p1 = this._P(i, bi), q0 = this._P(j, aj), q1 = this._P(j, bj);
      p0[1] += y; p1[1] += y; q0[1] += y; q1[1] += y;
      b.setHint(i);
      b.quad(p0, p1, q1, q0, [0, 1, 0],
        [[ai, foldV(i * t.ds)], [bi, foldV(i * t.ds)], [bj, foldV(j * t.ds)], [aj, foldV(j * t.ds)]]);
    }
    return out;
  }

  _road(surfMod) {
    const t = this.track, look = this.look, S = this.scene, world = this.world, line = this.line;
    const add = (b, mat, name, shadow = false) => {
      const m = b && b.mesh(mat, { shadow });
      if (!m) return null;
      m.name = name; world.lift(m.geometry); S.add(m); return m;
    };

    // run-off, by material (data/surf)
    const RUNMAT = [
      look.mat('gravel', { size: 0.9, tint: 0xb9aa8e, roughness: 1, side: THREE.DoubleSide, normalScale: 1.5 }),
      look.mat('apron', { size: 1.6, tint: 0x8a8b8e, roughness: 0.97, side: THREE.DoubleSide, normalScale: 1.2 }),
      look.mat('grass', { size: 1.7, tint: 0x7c9450, roughness: 1, side: THREE.DoubleSide, normalScale: 1.2 }),
      look.mat('concrete', { size: 3.0, tint: 0xb8b6b0, roughness: 0.95, side: THREE.DoubleSide }),
    ];
    const surf = this.surf;
    for (const side of [1, -1]) {
      const tag = surf ? (side > 0 ? surf.runL : surf.runR) : null;
      const parts = this._ribbon(i => side * t.w[i], i => side * (t.w[i] + (side > 0 ? t.runL[i] : t.runR[i])), -0.03,
        i => tag ? tag[i] : (t.wall === 'gravel' ? 0 : 1));
      for (const m in parts) add(parts[m], RUNMAT[m] || RUNMAT[1], 'runoff.' + m);
    }

    // the road: eight strips across so the rubbered racing line can be drawn
    // as vertex colour, exactly where the solved line runs
    const STR = 8, b = new Builder({ color: true });
    const col = (i, lat) => {
      const d = Math.abs(lat - line.off[i]);
      let k = d < 1.1 ? 0.62 : d < 2.8 ? 0.62 + (d - 1.1) * 0.2 : 0.96;
      k *= 0.95 + 0.1 * Math.sin(i * t.ds * 0.0037) + 0.05 * Math.sin(i * t.ds * 0.031 + lat * 0.7);
      return [k, k, k];
    };
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      if (t.open && j === 0) continue;
      b.setHint(i);
      for (let s = 0; s < STR; s++) {
        const f0 = s / STR, f1 = (s + 1) / STR;
        const li0 = -t.w[i] + 2 * t.w[i] * f0, li1 = -t.w[i] + 2 * t.w[i] * f1;
        const lj0 = -t.w[j] + 2 * t.w[j] * f0, lj1 = -t.w[j] + 2 * t.w[j] * f1;
        b.quad(this._P(i, li0), this._P(i, li1), this._P(j, lj1), this._P(j, lj0), [0, 1, 0],
          [[li0, foldV(i * t.ds)], [li1, foldV(i * t.ds)], [lj1, foldV(j * t.ds)], [lj0, foldV(j * t.ds)]],
          [col(i, li0), col(i, li1), col(j, lj1), col(j, lj0)]);
      }
    }
    const roadMat = look.mat('tarmac', {
      size: 1.4, tint: 0xc8c4bd, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
      vertexColors: true, normalScale: 1.25,
    });
    this.road = add(b, roadMat, 'road');
    this.roadDry = { r: roadMat.roughness, c: roadMat.color.clone(), n: roadMat.normalScale ? roadMat.normalScale.x : 1 };

    // the white lines
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeea, roughness: 0.74, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    });
    add(this._ribbon(i => t.w[i] - 0.14, i => t.w[i], 0.006)[0], lineMat, 'line.L');
    add(this._ribbon(i => -(t.w[i] - 0.14), i => -t.w[i], 0.006)[0], lineMat, 'line.R');

    // kerbs: raised, chamfered, one flat colour a block
    const KS = (surfMod && surfMod.KERB_SHAPE) || { 1: { h: 0.03, w: 1.3, block: 1 }, 2: { h: 0.055, w: 1.1, block: 1 }, 3: { h: 0.085, w: 0.95, block: 1 } };
    const KP = (surfMod && surfMod.KERB_PAINT) || { default: [0xc8262c, 0xeeeeea] };
    const paint = KP[t.key] || KP.default;
    const kb = new Builder({ color: true });
    const side = new Int8Array(t.n), inside = new Int8Array(t.n), inType = new Uint8Array(t.n), outType = new Uint8Array(t.n);
    for (const c of t.corners || []) {
      const out = c.dir < 0 ? 1 : -1;
      const typ = c.R < 30 ? 3 : c.R < 90 ? 2 : 1;
      for (let s = c.s0 - 6; s <= c.s1 + 6; s += t.ds) { const k = t.idx(s); side[k] = out; outType[k] = (surf && surf.kerb[k]) || 2; }
      if ((c.turn || 0) < 12) continue;
      const len = c.s1 - c.s0;
      const a0 = Math.min(c.s, c.s0 + len * 0.25) - 8, a1 = Math.max(c.s, c.s1 - len * 0.2) + 6;
      for (let s = a0; s <= a1; s += t.ds) { const k = t.idx(s); inside[k] = -out; inType[k] = typ; }
    }
    const lay = (i, j, sg, K) => {
      const ws = [t.w[i] - 0.10, t.w[i], t.w[i] + K.w, t.w[i] + K.w + 0.14], up = [0, K.h, K.h, 0];
      const m = Math.max(1, Math.round(t.ds / K.block));
      for (let q = 0; q < m; q++) {
        const f0 = q / m, f1 = (q + 1) / m;
        const sAt = i * t.ds + (f0 + 0.5 / m) * t.ds;
        const c = (Math.floor(sAt / K.block) % 2) ? paint[0] : paint[1];
        const V = (k, f) => {
          const a = this._P(i, sg * ws[k]), d = this._P(j, sg * ws[k]);
          return [a[0] + (d[0] - a[0]) * f, a[1] + (d[1] - a[1]) * f + up[k], a[2] + (d[2] - a[2]) * f];
        };
        for (let k = 0; k < 3; k++)
          kb.quadN(V(k, f0), V(k, f1), V(k + 1, f1), V(k + 1, f0), [[0, 0], [1, 0], [1, 1], [0, 1]], c);
      }
    };
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      if (t.open && j === 0) continue;
      kb.setHint(i);
      if (side[i] && side[i] === side[j]) lay(i, j, side[i], KS[outType[i]] || KS[2]);
      if (inside[i] && inside[i] === inside[j] && inside[i] !== side[i]) lay(i, j, inside[i], KS[inType[i]] || KS[2]);
    }
    // quadN works out its own normal from the winding, which here can come out
    // pointing down; a kerb is only ever seen from above, so make it so.
    const kg = kb.geometry();
    if (kg) {
      const nr = kg.attributes.normal.array;
      for (let k = 0; k < nr.length; k += 3) if (nr[k + 1] < 0) { nr[k] = -nr[k]; nr[k + 1] = -nr[k + 1]; nr[k + 2] = -nr[k + 2]; }
      const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
      const km = new THREE.Mesh(kg, kerbMat);
      km.name = 'kerbs'; km.receiveShadow = true;
      world.lift(kg); S.add(km);
    }
  }

  // -------------------------------------------------------------------------
  // WHERE THINGS ARE. `s` is metres round the lap, `lat` metres left of the
  // centreline. Interpolated between the 2 m samples — snapping to the nearest
  // one is a judder you can see in any tracking shot.
  // -------------------------------------------------------------------------
  at(s, lat = 0, out = {}) {
    const t = this.track, n = t.n;
    const f = (((s / t.ds) % n) + n) % n;
    const i = Math.floor(f), j = (i + 1) % n, k = f - i;
    let dh = t.hdg[j] - t.hdg[i];
    while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const h = t.hdg[i] + dh * k;
    const cx = t.x[i] + (t.x[j] - t.x[i]) * k, cy = t.y[i] + (t.y[j] - t.y[i]) * k;
    out.x = cx - Math.sin(h) * lat;
    out.z = Z(cy + Math.cos(h) * lat);
    out.y = this.world.trackYAt(s) + bankY(this.bank, t, i, lat) * (1 - k) + bankY(this.bank, t, j, lat) * k;
    out.hdg = h; out.i = i; out.k = k;
    out.w = t.w[i] + (t.w[j] - t.w[i]) * k;
    return out;
  }
  /** A THREE.Vector3 at (s, lat), `up` metres above the road. */
  v3(s, lat = 0, up = 0, target = new THREE.Vector3()) {
    const p = this.at(s, lat, this._tmpAt || (this._tmpAt = {}));
    return target.set(p.x, p.y + up, p.z);
  }
  /** The racing line's offset at s, interpolated. */
  lineOff(s) {
    const t = this.track, n = t.n, f = (((s / t.ds) % n) + n) % n, i = Math.floor(f), j = (i + 1) % n, k = f - i;
    return this.line.off[i] * (1 - k) + this.line.off[j] * k;
  }
  lineV(s) {
    const t = this.track, n = t.n, f = (((s / t.ds) % n) + n) % n, i = Math.floor(f), j = (i + 1) % n, k = f - i;
    return this.line.v[i] * (1 - k) + this.line.v[j] * k;
  }
  curv(s) { const t = this.track; return t.curv[t.idx(s)]; }
  /** Gradient of the road at s (rise over run). */
  slope(s) { return (this.world.trackYAt(s + 3) - this.world.trackYAt(s - 3)) / 6; }
  /** Height of whatever is underfoot at a world point (road, run-off or field). */
  groundAt(x, z) { return this.world.on ? this.world.heightAt(x, z) : 0; }

  // How long the real car takes to get to each sample, so `sAfter(s0, t)` is
  // "where is a car that left s0, t seconds later" in closed form.
  _timeTable() {
    const t = this.track, n = t.n, T = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) T[i + 1] = T[i] + t.ds / Math.max(8, this.line.v[i]);
    this.T = T; this.lapTime = T[n];
  }
  _timeAt(s) {
    const t = this.track, n = t.n, L = n * t.ds;
    const laps = Math.floor(s / L), r = s - laps * L, f = r / t.ds, i = Math.min(n - 1, Math.floor(f));
    return laps * this.lapTime + this.T[i] + (this.T[i + 1] - this.T[i]) * (f - i);
  }
  /** Distance round the lap `dt` seconds after being at `s0`, at `pace` x the real speed. */
  sAfter(s0, dt, pace = 1) {
    const t = this.track, n = t.n, L = n * t.ds;
    const T0 = this._timeAt(s0) + dt * pace;
    const laps = Math.floor(T0 / this.lapTime), r = T0 - laps * this.lapTime;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.T[m] <= r) lo = m; else hi = m; }
    const k = (r - this.T[lo]) / Math.max(1e-9, this.T[lo + 1] - this.T[lo]);
    return laps * L + (lo + k) * t.ds;
  }

  // -------------------------------------------------------------------------
  setMood(name, over = null) {
    const base = typeof name === 'string' ? MOODS[name] : name;
    const m = over ? { ...base, ...over } : base;
    const key = JSON.stringify(m);
    if (key === this._moodKey) return;
    this._moodKey = key; this.mood = m;
    const S = this.scene;
    const az = m.az * DEG, el = m.el * DEG, kel = m.keyEl * DEG;
    const sv = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
    if (this.proc) {
      this.proc.update(S, sv, { turbidity: m.turb, cloud: m.cloud, elevation: m.el });
    }
    S.environmentIntensity = m.env; S.backgroundIntensity = m.bg;
    // at night the "sun" is the moon: same compass, up in the sky
    this.sunDir.set(Math.cos(kel) * Math.cos(az), Math.sin(kel), Math.cos(kel) * Math.sin(az)).normalize();
    this.sun.intensity = m.sun[0]; this.sun.color.setRGB(m.sun[1], m.sun[2], m.sun[3]);
    this.sun.castShadow = !!m.shadows && !Q.has('noshadow') && !this.noShadows;
    this.hemi.intensity = m.hemi[0]; this.hemi.color.setRGB(...m.hemi[1]); this.hemi.groundColor.setRGB(...m.hemi[2]);
    if (S.fog) { S.fog.color.setRGB(...m.fog[0]); S.fog.density = m.fog[1]; }
    for (const f of this.farMats) f.m.color.copy(f.c).multiply(_c.setRGB(...(f.tree && m.farTree ? m.farTree : m.far)));
    if (this.courseLights && this.courseLights.setNight) this.courseLights.setNight(m.lamps >= 1 ? 1 : 0);
    // a wet road: darker, smoother, a mirror for whatever light there is
    if (this.road) {
      const rm = this.road.material, d = this.roadDry, w = m.wet;
      rm.roughness = d.r * (1 - 0.82 * w);
      rm.color.copy(d.c).multiplyScalar(1 - 0.45 * w);
      if (rm.normalScale) rm.normalScale.setScalar(d.n * (1 - 0.6 * w));
    }
    this.exposure = m.exposure;
    for (const s of this.spots) s.intensity = 0;
    for (const p of this.points) p.intensity = 0;
  }

  /** Keep the sun's shadow box on whatever the shot is about. */
  focus(x, y, z) {
    const d = this.sunDir;
    this.sun.position.set(x + d.x * 340, y + d.y * 340, z + d.z * 340);
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
  }
}
const _c = new THREE.Color();
