// actors.js — the cars and the weather, as PURE FUNCTIONS OF TIME.
//
// Nothing in here integrates. A car's pose, a spark's arc and a raindrop's
// position are all computed from the clock, so asking for second 31.4 gives
// the same picture whether the film played up to it or jumped straight there
// (?frame=). That is also why the game's own particle systems (js/smoke.js,
// js/sparks.js, js/rain.js — all dt-stepped) are not used.
import * as THREE from 'three';
import { buildCar, buildGT3, liveryAtlas, numberTexture } from '../car.js';

const opt = p => import(p).catch(e => { console.warn('[ad] optional module missing:', p, String(e)); return null; });
const [drv, liv, lampsMod] = await Promise.all([opt('../drivers.js'), opt('../livery.js'), opt('../lamps.js')]);

// A repeatable random number from an integer and a salt.
export function rnd(n, salt = 0) {
  let h = (Math.imul(n | 0, 374761393) + Math.imul(salt | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const ease = k => { k = clamp(k); return k * k * (3 - 2 * k); };
export const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
export const easeIn = k => Math.pow(clamp(k), 3);
// smooth noise in -1..1, for a hand-held camera
export function wobble(t, seed = 0) {
  return (Math.sin(t * 1.7 + seed * 12.9) + Math.sin(t * 2.9 + seed * 7.3) * 0.6 + Math.sin(t * 5.3 + seed * 3.1) * 0.3 + Math.sin(t * 11.1 + seed) * 0.12) / 2.02;
}

// The grid's colours. Team KEYS are colour names in js/drivers.js; nothing on
// the cars carries a real name (their sponsors are the game's invented ones).
export const GRID = ['scarlet', 'papaya', 'silver', 'navy', 'emerald', 'azure', 'rose', 'cobalt', 'graphite', 'ivory', 'titan',
  'bugatti', 'mazda', 'subaru', 'bmwm', 'jeep'];

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _box = new THREE.Box3();

export class Car {
  /**
   * kind 'f1' | 'gt3'. `team` is a key from js/drivers.js TEAMS (colours and
   * invented sponsors); `colour` overrides for a plain car.
   */
  constructor(stage, { kind = 'f1', team = 'scarlet', colour = null, num = 7, heads = kind === 'gt3' } = {}) {
    this.stage = stage; this.kind = kind;
    const T = drv && drv.TEAMS[team] || null;
    const col = colour != null ? colour : T ? new THREE.Color(T.col).getHex() : 0xd8352a;
    let b;
    if (kind === 'gt3') b = buildGT3(stage.look, col);
    else {
      b = buildCar(stage.look, col, null, { livery: liv && T ? liv.liveryFor(team, T) : null });
      try {
        if (T && b.decalMat) b.decalMat.map = liveryAtlas(T.col, T, 0.5).texture;
        if (b.numMat) b.numMat.map = numberTexture(num, T ? T.col : '#d8352a', T ? T.fg : '#ffffff');
      } catch (e) { console.warn('[ad] livery:', e); }
    }
    this.b = b;
    this.R = b.R || 0.36;
    this.wheelbase = kind === 'gt3' ? 2.7 : 3.6;
    b.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.root = new THREE.Group();          // where it is, and its whole attitude
    this.body = new THREE.Group();          // dive and squat, on top of that
    this.body.add(b.group); this.root.add(this.body);
    this.root.name = 'car.' + team;
    stage.scene.add(this.root);
    this.lamps = null;
    if (lampsMod) {
      try {
        _box.setFromObject(b.group);
        this.lamps = lampsMod.carLamps(b.group, _box, { heads, pool: heads });
      } catch (e) { console.warn('[ad] lamps:', e); }
    }
    this.pos = this.root.position;
    this.s = 0; this.lat = 0; this.speed = 0;
    this.visible = true;
  }

  show(on) { this.root.visible = this.visible = !!on; return this; }

  /**
   * On the circuit at distance `s`, `lat` metres left of the RACING LINE
   * (lineK = 0 measures from the centreline instead). `dist` is how far the
   * wheels have rolled, `brake` 0..1 lights the rear and dips the nose.
   */
  drive(s, { lat = 0, lineK = 1, dist = s, brake = 0, yaw = 0, roll = 0, pitch = 0, up = 0, night = null, keepOn = true } = {}) {
    const st = this.stage;
    let L = lat + st.lineOff(s) * lineK;
    if (keepOn) { const w = st.track.w[st.track.idx(s)] - 1.05; L = Math.max(-w, Math.min(w, L)); lat = L - st.lineOff(s) * lineK; }
    const p = st.at(s, L, this._p || (this._p = {}));
    // heading from where the car is GOING, so it follows the line and not the centreline
    const a = st.at(s - 1.6, lat + st.lineOff(s - 1.6) * lineK, this._a || (this._a = {}));
    const b = st.at(s + 1.6, lat + st.lineOff(s + 1.6) * lineK, this._b || (this._b = {}));
    const hdg = Math.atan2(-(b.z - a.z), b.x - a.x);
    const slope = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    // camber: the difference in height across the car
    const l = st.at(s, L + 0.8, this._l || (this._l = {})), r = st.at(s, L - 0.8, this._r || (this._r = {}));
    const camber = Math.atan2(l.y - r.y, 1.6);   // +roll drops the right side
    this.root.visible = true;
    this.root.position.set(p.x, p.y + up, p.z);
    _e.set(camber + roll, hdg + yaw, slope + pitch, 'YZX');
    this.root.quaternion.setFromEuler(_e);
    this.body.rotation.z = -brake * 0.011;
    this.body.position.y = -brake * 0.012;
    this.s = s; this.lat = L; this.hdg = hdg + yaw;
    this._wheels(dist, Math.atan(this.wheelbase * st.curv(s + 4)) * 1.15);
    if (this.lamps) this.lamps.update(night ?? st.mood.lamps, brake);
    return this;
  }

  /** Anywhere, any way up. yaw/pitch/roll in radians, applied in that order. */
  free(x, y, z, yaw = 0, pitch = 0, roll = 0, { dist = 0, steer = 0, brake = 0, night = null } = {}) {
    this.root.visible = true;
    this.root.position.set(x, y, z);
    _e.set(roll, yaw, pitch, 'YZX');
    this.root.quaternion.setFromEuler(_e);
    this.body.rotation.z = 0; this.body.position.y = 0;
    this.hdg = yaw;
    this._wheels(dist, steer);
    if (this.lamps) this.lamps.update(night ?? this.stage.mood.lamps, brake);
    return this;
  }

  _wheels(dist, steer) {
    const b = this.b, a = -dist / this.R;
    for (const k in b.wheels) b.wheels[k].rotation.z = a;
    if (b.steer) { if (b.steer.fl) b.steer.fl.rotation.y = steer; if (b.steer.fr) b.steer.fr.rotation.y = steer; }
  }

  /** A point in the car's own frame (x forward, y up, z right), in the world. */
  local(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyQuaternion(this.root.quaternion).add(this.root.position);
  }
}

// ---------------------------------------------------------------------------
// SPRITES: soft camera-facing quads, rebuilt every frame from whatever the
// shot asks for. One draw call. Smoke, dust, spray, fire, glows.
// ---------------------------------------------------------------------------
function puffTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.62)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // break the circle up a little so a cloud of them is not a cloud of discs
  const id = g.getImageData(0, 0, 128, 128), d = id.data;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = 0.78 + 0.22 * Math.sin(x * 0.21 + Math.sin(y * 0.17) * 2.4) * Math.cos(y * 0.19 + Math.sin(x * 0.13) * 2.1);
    d[(y * 128 + x) * 4 + 3] *= n;
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export class Sprites {
  constructor(scene, { max = 1500, additive = false } = {}) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);   // xyz, size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);   // rgb, alpha
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);   // spin, stretch
    for (const a of [this.aPos, this.aCol, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aRot', this.aRot);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTex() }, fogCol: { value: new THREE.Color() }, fogDen: { value: 0 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 aPos; attribute vec4 aCol; attribute vec2 aRot;
        varying vec2 vUv; varying vec4 vCol; varying float vD;
        void main() {
          vUv = position.xy * 0.5 + 0.5; vCol = aCol;
          float c = cos(aRot.x), s = sin(aRot.x);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
          p.y *= aRot.y;
          vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
          mv.xy += p * aPos.w;
          vD = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogCol; uniform float fogDen;
        varying vec2 vUv; varying vec4 vCol; varying float vD;
        void main() {
          float a = texture2D(map, vUv).a * vCol.a;
          // fade out where the camera is inside the puff, or it pops as a wall
          a *= smoothstep(0.25, 1.6, vD);
          if (a < 0.003) discard;
          float f = 1.0 - exp(-fogDen * fogDen * vD * vD);
          gl_FragColor = vec4(mix(vCol.rgb, fogCol, f * ${additive ? '0.0' : '1.0'}), a * ${additive ? '(1.0 - f)' : '1.0'});
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    this.mesh.name = additive ? 'fx.glow' : 'fx.puffs';
    this.geo = g;
    this.items = [];
    scene.add(this.mesh);
  }
  begin() { this.items.length = 0; }
  add(x, y, z, size, r, g, b, a, rot = 0, stretch = 1) {
    if (this.items.length < this.max && a > 0.003) this.items.push([x, y, z, size, r, g, b, a, rot, stretch]);
  }
  end(camera, fog) {
    const it = this.items, cp = camera.position;
    if (this.mat.blending === THREE.NormalBlending)
      it.sort((p, q) => ((q[0] - cp.x) ** 2 + (q[1] - cp.y) ** 2 + (q[2] - cp.z) ** 2) - ((p[0] - cp.x) ** 2 + (p[1] - cp.y) ** 2 + (p[2] - cp.z) ** 2));
    const P = this.aPos.array, C = this.aCol.array, R = this.aRot.array;
    for (let i = 0; i < it.length; i++) {
      const p = it[i];
      P[i * 4] = p[0]; P[i * 4 + 1] = p[1]; P[i * 4 + 2] = p[2]; P[i * 4 + 3] = p[3];
      C[i * 4] = p[4]; C[i * 4 + 1] = p[5]; C[i * 4 + 2] = p[6]; C[i * 4 + 3] = p[7];
      R[i * 2] = p[8]; R[i * 2 + 1] = p[9];
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
    this.geo.instanceCount = it.length;
    this.mesh.visible = it.length > 0;
    if (fog) { this.mat.uniforms.fogCol.value.copy(fog.color); this.mat.uniforms.fogDen.value = fog.density; }
  }
}

/**
 * A stream of particles that have ALREADY happened: every particle born at
 * `rate` a second between t0 and t1 that is still alive at `t` is handed to
 * `each(n, age, life, tBorn)`. `n` is its serial number — use rnd(n, k).
 */
export function stream(t, { rate, life, t0 = -Infinity, t1 = Infinity, lifeVar = 0 }, each) {
  const first = Math.max(Math.ceil((t - life * (1 + lifeVar)) * rate), Math.ceil(t0 * rate));
  const last = Math.min(Math.floor(t * rate), Math.floor(t1 * rate));
  for (let n = first; n <= last; n++) {
    const tb = n / rate, lf = life * (1 + (rnd(n, 91) - 0.5) * 2 * lifeVar), age = t - tb;
    if (age < 0 || age > lf) continue;
    each(n, age, lf, tb);
  }
}

// ---------------------------------------------------------------------------
// STREAKS: bright line segments. Sparks under a car and rain through the air.
// ---------------------------------------------------------------------------
export class Streaks {
  constructor(scene, { max = 4000, additive = true } = {}) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 8), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('color', this.col);
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; this.mesh.name = 'fx.streaks';
    this.geo = g; this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(x0, y0, z0, x1, y1, z1, r, g, b, a0 = 1, a1 = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, P = this.pos.array, C = this.col.array;
    P[i * 6] = x0; P[i * 6 + 1] = y0; P[i * 6 + 2] = z0; P[i * 6 + 3] = x1; P[i * 6 + 4] = y1; P[i * 6 + 5] = z1;
    C[i * 8] = r; C[i * 8 + 1] = g; C[i * 8 + 2] = b; C[i * 8 + 3] = a0;
    C[i * 8 + 4] = r; C[i * 8 + 5] = g; C[i * 8 + 6] = b; C[i * 8 + 7] = a1;
  }
  end() {
    this.pos.needsUpdate = this.col.needsUpdate = true;
    this.geo.setDrawRange(0, this.n * 2);
    this.mesh.visible = this.n > 0;
  }
}

/** Sparks thrown back from a point moving at (vx, vy, vz). */
export function sparks(streaks, t, { rate = 500, t0, t1, at, vel, seed = 0, life = 0.45, spread = 5, up = 2.6, bright = 1 }) {
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  stream(t, { rate, life, t0, t1, lifeVar: 0.5 }, (n, age, lf, tb) => {
    at(tb, p); vel(tb, v);
    const k = n + seed * 7919;
    const vx = v.x * (0.15 + rnd(k, 1) * 0.5) + (rnd(k, 2) - 0.5) * spread;
    const vy = rnd(k, 3) * up + 0.3;
    const vz = v.z * (0.15 + rnd(k, 1) * 0.5) + (rnd(k, 4) - 0.5) * spread;
    const P = a => {
      // one bounce off the road
      let y = p.y + vy * a - 4.9 * a * a;
      if (y < p.y - 0.02) { const tb2 = vy / 4.9 + 0.01, a2 = a - tb2; y = p.y - 0.02 + Math.max(0, vy * 0.35 * a2 - 4.9 * a2 * a2); }
      return [p.x + vx * a, y, p.z + vz * a];
    };
    const a0 = P(age), a1 = P(Math.max(0, age - 0.028));
    const f = 1 - age / lf, heat = bright * (2.5 + 6 * f);
    streaks.add(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], heat, heat * (0.42 + 0.3 * f), heat * 0.12 * f, f, f * 0.2);
  });
}

/** Rain: streaks in a box that follows the camera, anchored to the world. */
export function rain(streaks, t, camera, { amount = 1, count = 4200, box = 34, height = 20, fall = 21, wind = [3.5, 0, 1.5], bright = 0.5 } = {}) {
  const c = camera.position, n = Math.floor(count * amount);
  const wrap = (v, m) => ((v % m) + m) % m;
  for (let i = 0; i < n; i++) {
    const f = fall * (0.8 + rnd(i, 3) * 0.4);
    const x = c.x - box / 2 + wrap(rnd(i, 1) * box + wind[0] * t - c.x, box);
    const z = c.z - box / 2 + wrap(rnd(i, 2) * box + wind[2] * t - c.z, box);
    const y = c.y - height * 0.4 + wrap(rnd(i, 4) * height - f * t - c.y, height);
    const L = 0.014 + rnd(i, 5) * 0.012;     // exposure time: a streak is that long in seconds
    const a = bright * (0.35 + 0.65 * rnd(i, 6));
    streaks.add(x, y, z, x + wind[0] * L, y + f * L, z + wind[2] * L, 0.75 * a, 0.82 * a, 1.0 * a, 0.9, 0.1);
  }
}

/** A plume of something soft trailing from a moving point. */
export function plume(sprites, t, o) {
  const { rate = 40, life = 2, t0, t1, at, seed = 0, size = [0.5, 3], col = [0.8, 0.8, 0.82], alpha = 0.4,
    rise = 0.6, drift = [0, 0, 0], spread = 0.6, vel = null, velK = 0, fade = 0.15, grow = 0.6 } = o;
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  stream(t, { rate, life, t0, t1, lifeVar: 0.3 }, (n, age, lf, tb) => {
    at(tb, p);
    const k = n + seed * 7919, f = age / lf;
    let x = p.x + (rnd(k, 1) - 0.5) * spread, y = p.y + (rnd(k, 2) - 0.5) * spread * 0.5, z = p.z + (rnd(k, 3) - 0.5) * spread;
    if (vel) { vel(tb, v); const d = (1 - Math.exp(-age * 2.2)) / 2.2 * velK; x += v.x * d; y += v.y * d; z += v.z * d; }
    x += (drift[0] + (rnd(k, 4) - 0.5) * 0.8) * age; z += (drift[2] + (rnd(k, 5) - 0.5) * 0.8) * age;
    y += (rise * (0.6 + rnd(k, 6) * 0.8) + drift[1]) * age;
    const s = size[0] + (size[1] - size[0]) * Math.pow(f, grow);
    const a = alpha * Math.min(1, f / fade) * (1 - f) * (1 - f) * (0.7 + 0.6 * rnd(k, 7));
    const c = typeof col === 'function' ? col(f, k) : col;
    sprites.add(x, y, z, s, c[0], c[1], c[2], a, rnd(k, 8) * 6.28 + age * (rnd(k, 9) - 0.5), 1);
  });
}
