// lamps.js — the lights of a night race: every car's lamps, the circuit's
// floodlights, and the trails lights leave across your eye at speed.
//
// Adam: "bots need headlights, and everyone needs brake lights and taillights!!!
// and add lights to the course, and at speed make lights kinda streak at night
// and leave a trail when u go past".
//
// NONE OF THIS IS REAL LIGHTING except the player's two headlight spotlights
// (render.js). Twenty-one more spotlights, and a floodlight every 70 m, would
// cost more than the whole rest of the frame. So a lamp is a glowing face that
// is brighter than white (the bloom picks it up where the post chain runs), and
// the light it throws is a soft additive POOL drawn on the road: the look of
// light landing, for the price of one transparent quad.
//
// TRAILS are their own tiny pipeline so they work with the post chain OFF,
// which it is on this laptop's Intel GPU. Every lamp is also on LAMP_LAYER;
// each frame only that layer is drawn into a quarter-size target, fed back into
// itself with a fade, and added over the finished frame. A lamp that has moved
// across the screen leaves the faded copies of where it was: a long-exposure
// streak. The fade is short when slow and long at speed.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';

export const LAMP_LAYER = 5;

// A soft round glow, drawn once: the pool of light under a lamp.
let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  GLOW = new THREE.CanvasTexture(c);
  GLOW.colorSpace = THREE.SRGBColorSpace;
  return GLOW;
}

const onLampLayer = m => { m.layers.enable(LAMP_LAYER); return m; };

// Brighter than white: MeshBasic colour above 1 survives into the HDR target,
// which is what makes a lamp bloom instead of reading as a white sticker.
const HEAD = new THREE.Color(7, 6.6, 5.6);
const TAIL = new THREE.Color(2.2, 0.05, 0.03);     // on at night
const BRAKE = new THREE.Color(9, 0.25, 0.12);      // on the brakes, day or night

/**
 * Lamps on one car. `group` is what moves with the car (x forward, y up —
 * car.js's frame). `box` is the car's bounding box in that frame.
 * `heads` false skips the front faces (the player's own car has spotlights).
 */
export function carLamps(group, box, { heads = true, pool = true } = {}) {
  const nose = box.max.x - 0.05, tail = box.min.x + 0.05;
  const hy = Math.max(0.35, box.min.y + 0.42), ty = Math.max(0.45, box.min.y + 0.55);
  const half = Math.min(0.62, (box.max.z - box.min.z) / 2 - 0.2);
  const out = { heads: [], rear: [], pool: null };

  if (heads) {
    const hm = new THREE.MeshBasicMaterial({ color: HEAD, toneMapped: false });
    for (const s of [-1, 1]) {
      const m = onLampLayer(new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), hm));
      m.position.set(nose, hy, s * half); m.rotation.y = Math.PI / 2;
      m.visible = false; group.add(m); out.heads.push(m);
      registerTrail({ obj: m, col: HEAD_COL, size: 0.2, gain: 1.0 });
    }
  }
  // One material per CAR for the rear, so a braking car glows and the one
  // beside it does not.
  const rm = new THREE.MeshBasicMaterial({ color: TAIL.clone(), toneMapped: false });
  out.rearMat = rm;
  for (const s of [-1, 0, 1]) {
    // outer pair + the single centre light every single-seater carries
    const m = onLampLayer(new THREE.Mesh(new THREE.PlaneGeometry(s ? 0.22 : 0.12, s ? 0.07 : 0.12), rm));
    m.position.set(tail, s ? ty : ty + 0.15, s * half); m.rotation.y = -Math.PI / 2;
    m.visible = false; group.add(m); out.rear.push(m);
    if (s) registerTrail({ obj: m, col: TAIL_COL, size: 0.2, gain: 1.0 });
  }
  if (pool) {
    // The splash of the headlights on the road ahead, lying on the ground.
    const pm = new THREE.MeshBasicMaterial({
      map: glowTex(), color: 0xfff0d8, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 11), pm);
    m.rotation.x = -Math.PI / 2;
    m.position.set(nose + 14, box.min.y + 0.06, 0);
    m.renderOrder = 2; m.visible = false; group.add(m); out.pool = m;
  }

  out.update = (night, brake) => {
    for (const m of out.heads) m.visible = night;
    if (out.pool) out.pool.visible = night;
    const b = brake > 0.05;
    for (const m of out.rear) m.visible = night || b;
    rm.color.copy(b ? BRAKE : TAIL);
  };
  return out;
}

/**
 * Floodlights round the whole lap: a pole every SPACING metres, alternating
 * sides, behind the barrier, with its head leaning out over the road and a
 * pool of light on the tarmac under it. Four draw calls for the lot.
 */
export function buildCourseLights(scene, track, world = null, { spacing = 70 } = {}) {
  const t = track;
  const poles = new Builder(), heads = new Builder();
  const pool = [], flood = [];
  let side = 1, n = 0;
  for (let s = 20; s < t.length - 10; s += spacing, side = -side) {
    const i = t.idx(s), h = t.hdg[i];
    const w = t.w[i], run = side > 0 ? t.runL[i] : t.runR[i];
    const lat = side * (w + Math.min(run, 20) + 2.5);
    const px = t.x[i] - Math.sin(h) * lat, py = t.y[i] + Math.cos(h) * lat;
    const H = 13;
    poles.box(px, H / 2, Z(py), 0.35, H, 0.35, 0, 0x8a9096, 1);
    // the arm reaches back over the barrier toward the road
    const reach = 3.2, ax = px + Math.sin(h) * side * reach, ay = py - Math.cos(h) * side * reach;
    const mx = (px + ax) / 2, my = (py + ay) / 2;
    // ry = heading, the same as furniture.js's marshal huts: local x runs
    // along the track, so the arm is long in z (across it)
    poles.box(mx, H, Z(my), 0.2, 0.2, reach, h, 0x8a9096, 1);
    heads.box(ax, H - 0.25, Z(ay), 1.4, 0.3, 0.8, h, 0xffffff, 1);
    flood.push([ax, H - 0.4, Z(ay)]);
    // where the light lands: centred a little inside the road edge
    const pl = side * Math.max(0, w - 6);
    pool.push([t.x[i] - Math.sin(h) * pl, t.y[i] + Math.cos(h) * pl, h]);
    n++;
  }
  if (!n) return null;
  const out = {};
  const pm = poles.mesh(new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, metalness: 0.5 }), { shadow: false });
  if (pm) { if (world) world.liftGround(pm.geometry); scene.add(pm); }
  const headMat = new THREE.MeshBasicMaterial({ color: 0x9aa0a6, toneMapped: false });
  const hm = heads.mesh(headMat, { shadow: false });
  if (hm) { if (world) world.liftGround(hm.geometry); onLampLayer(hm); scene.add(hm); }

  // Pools: one merged geometry of ground quads, lifted onto the ROAD surface.
  const R = 21, pos = [], uv = [], idx = [];
  for (const [x, y, h] of pool) {
    const c = Math.cos(h), s = Math.sin(h), k = pos.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const wx = x + (c * u - s * v) * R, wy = y + (s * u + c * v) * R;
      pos.push(wx, 0.07, Z(wy)); uv.push((u + 1) / 2, (v + 1) / 2);
    }
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (world) world.lift(g);
  const poolMat = new THREE.MeshBasicMaterial({
    map: glowTex(), color: 0xfff3e0, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const poolMesh = new THREE.Mesh(g, poolMat);
  poolMesh.renderOrder = 2; poolMesh.visible = false; poolMesh.frustumCulled = false;
  scene.add(poolMesh);

  // Each head leaves a trail too: fixed points, lifted onto the same ground.
  for (const [x, y, z] of flood) {
    const gy = world ? world.groundY(x, z) : 0;
    const e = registerTrail({ pos: new THREE.Vector3(x, y + gy, z), col: FLOOD_COL, size: 1.2, gain: 0 });
    (out.emitters || (out.emitters = [])).push(e);
  }
  out.count = n;
  out.setNight = on => {
    headMat.color.setRGB(on ? 8 : 0.6, on ? 7.6 : 0.62, on ? 6.8 : 0.64);
    poolMesh.visible = on;
    for (const e of out.emitters || []) e.gain = on ? 0.8 : 0;
  };
  return out;
}

// ---------------------------------------------------------------------------
// Light trails.
//
// VERSION TWO. The first version fed each frame's lamps back into a fading
// buffer, which draws a COPY of every lamp per frame — Adam, spinning: "the
// trailing gets super far apart, i want smooth lines that arent just it
// cloned". At 20 fps a spin moves a lamp 150 px between frames, so the copies
// were beads on a string with nothing between them.
//
// So a trail is now a LINE. Every lamp remembers where it has been ON SCREEN
// (a long exposure is the path a light draws across the sensor, which is why
// a spinning camera streaks lights it is not even moving past), and each frame
// that path is drawn as one ribbon through those points: Catmull-Rom between
// them, so it curves rather than zig-zagging, thick and bright at the lamp,
// thin and faded at the tail. Continuous by construction, at any frame rate.
// ---------------------------------------------------------------------------

// Everything that leaves a trail registers itself here: car lamp meshes (read
// their world position each frame) and the floodlight heads (fixed points).
const EMITTERS = new Set();       // { obj?, pos?, col: [r,g,b], size }
const HEAD_COL = [1.0, 0.93, 0.78], TAIL_COL = [1.0, 0.08, 0.04], FLOOD_COL = [1.0, 0.96, 0.88];

export function registerTrail(e) { EMITTERS.add(e); return e; }

const MAXV = 120000;              // vertices of ribbon, all emitters together

export class LightTrails {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pos = new Float32Array(MAXV * 3);
    this.col = new Float32Array(MAXV * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    m.frustumCulled = false;
    this.scene.add(m);
    this.hist = new Map();        // emitter -> [{x, y, t}] screen points, newest last
    this.t = 0;
    this._v = new THREE.Vector3();
  }

  // `boost` (main.js's adrenaline): 0.4 normally, 1 in a crash, a spin or
  // wheel-to-wheel, +0.15 on the last lap. It scales how long and how bright.
  render(scene, camera, { speed = 0, night = 0, dt = 1 / 60, boost = 1 } = {}) {
    if (night <= 0.01) return;
    const r = this.r;
    this.t += Math.min(0.1, dt);
    const sf = Math.max(0, Math.min(1, (speed - 10) / 60));
    const life = (0.06 + 0.34 * sf) * boost;          // seconds of trail
    const bright = Math.min(1.15, 0.5 + 0.5 * boost);
    const sz = r.getDrawingBufferSize(new THREE.Vector2());
    const aspect = sz.x / Math.max(1, sz.y), px = 2 / Math.max(1, sz.y);   // one pixel, in NDC y
    const cp = camera.position, v = this._v;
    let nv = 0;
    const P = this.pos, C = this.col;

    const quad = (ax, ay, bx, by, wa, wb, ca, cb) => {
      if (nv + 6 > MAXV) return;
      let dx = (bx - ax) * aspect, dy = by - ay;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      dx /= L; dy /= L;
      const nxa = -dy * wa / aspect, nya = dx * wa, nxb = -dy * wb / aspect, nyb = dx * wb;
      const pts = [[ax - nxa, ay - nya, ca], [ax + nxa, ay + nya, ca], [bx + nxb, by + nyb, cb],
                   [ax - nxa, ay - nya, ca], [bx + nxb, by + nyb, cb], [bx - nxb, by - nyb, cb]];
      for (const [x, y, c] of pts) {
        P[nv * 3] = x; P[nv * 3 + 1] = y; P[nv * 3 + 2] = 0;
        C[nv * 3] = c[0]; C[nv * 3 + 1] = c[1]; C[nv * 3 + 2] = c[2];
        nv++;
      }
    };

    for (const e of EMITTERS) {
      if (e.obj) {
        if (!e.obj.parent) { EMITTERS.delete(e); this.hist.delete(e); continue; }
        // only while the lamp is actually lit
        let lit = e.obj.visible;
        for (let o = e.obj.parent; lit && o; o = o.parent) lit = o.visible !== false;
        if (!lit) { this.hist.delete(e); continue; }
        e.obj.getWorldPosition(v);
      } else v.copy(e.pos);
      const dist = v.distanceTo(cp);
      let h = this.hist.get(e);
      if (dist > 450) { if (h) this.hist.delete(e); continue; }
      v.project(camera);
      const behind = v.z > 1 || v.z < -1;
      if (!h) { h = []; this.hist.set(e, h); }
      if (behind) { h.length = 0; continue; }
      h.push({ x: v.x, y: v.y, t: this.t });
      while (h.length && this.t - h[0].t > life) h.shift();
      if (h.length < 2) continue;

      // width from how big the lamp looks, never thinner than a line you can see
      const w0 = Math.max(1.3, Math.min(7, e.size * 900 / Math.max(1, dist))) * px;
      const age = p => Math.max(0, 1 - (this.t - p.t) / life);
      const colour = (p, k) => { const a = age(p) * age(p) * k * bright; return [e.col[0] * a, e.col[1] * a, e.col[2] * a]; };
      // Catmull-Rom through the points, 8 steps per span
      const pt = (i) => h[Math.max(0, Math.min(h.length - 1, i))];
      let prev = null;
      for (let i = 0; i < h.length - 1; i++) {
        const p0 = pt(i - 1), p1 = pt(i), p2 = pt(i + 1), p3 = pt(i + 2);
        for (let k = 0; k <= 8; k++) {
          if (i > 0 && k === 0) continue;
          const u = k / 8, u2 = u * u, u3 = u2 * u;
          const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
          const q = { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), t: p1.t + (p2.t - p1.t) * u };
          if (prev) {
            const aw = w0 * (0.35 + 0.65 * age(prev)), bw = w0 * (0.35 + 0.65 * age(q));
            quad(prev.x, prev.y, q.x, q.y, aw, bw, colour(prev, e.gain), colour(q, e.gain));
          }
          prev = q;
        }
      }
    }
    this.geo.setDrawRange(0, nv);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    if (!nv) return;
    const ac = r.autoClear;
    r.setRenderTarget(null);
    r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = ac;
  }
}

export const TRAIL_COLOURS = { HEAD_COL, TAIL_COL, FLOOD_COL };
