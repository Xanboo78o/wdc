// speedfx.js — what 350 km/h does to a camera, and to a picture of it.
//
// Adam, 2026-09-28: "make 350 kmh feel like 350 kmh not 40 mph, make it feel
// FAST". The physics speed was already right. What was wrong was measured by
// tools/speedflow.mjs, and it is three things, none of them the speed:
//
//   1. NOTHING SHOOK. A camera that is perfectly still at 350 km/h is, to the
//      eye, a camera on a tripod watching a video wall. The old vibration was
//      a positional jitter of about a centimetre, which moves the halo and
//      leaves the world exactly where it was — a car's shake is ANGULAR, and
//      it is the angle that moves the whole frame.
//
//   2. THE NEAR GROUND WAS UNREADABLE. From the driver's eyes the nearest
//      visible tarmac streams past at ~27 screen heights a second — nearly
//      half the screen PER FRAME at 60 fps. Past about a tenth of a screen per
//      frame the eye stops tracking texture and sees noise; what a real camera
//      records there instead is motion blur, streaks along the direction of
//      travel, and it is the streaks the brain reads as speed. So: blur, but
//      only where the geometry says the flow is that fast, which is the edges.
//
//   3. (render.js) The chase camera fell ~6 m further behind at top speed
//      (measured 11.7 m from the car at 350 against its 5.6 m setting), so
//      the car shrank and the road under the lens moved away as you went
//      faster. The lens widening with speed was suspected too and CLEARED by
//      measurement: a wider frame's edges see nearer ground and stream
//      faster (chase 87 vs 55 screen heights/s), so it stays.
//
// Two classes, both driven by car.speed and a clock of their own, never by
// accumulated sim state — so an instant replay that sets the speed from a
// recording shakes and blurs exactly as the live lap did.
//
// Knobs: ?speedfx=0 (all of it off), ?blur=0|0.5|1.5 (strength), ?shake=0|2.
import * as THREE from 'three';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (k, d) => (Q.has(k) && Q.get(k) !== '' && Number.isFinite(+Q.get(k)) ? +Q.get(k) : d);
export const SFX = {
  on: Q.get('speedfx') !== '0',
  blur: num('blur', 1),
  shake: num('shake', 1),
  depth: Q.get('blurdepth') !== '0',       // ?blurdepth=0: the assumed-depth path, for A/B
};

// ---------------------------------------------------------------------------
// SHAKE
//
// Per mount, in DEGREES at 350 km/h on smooth tarmac. Three bands:
//   buzz   the engine and the tyres at 20-60 Hz. Far above the frame rate, so
//          it is drawn as a fresh random offset every frame — which is exactly
//          what a 50 fps broadcast camera records of it: judder.
//   road   the surface's own undulation, 2-9 Hz. Road bumps are fixed in
//          SPACE, so their frequency is distance, not time — they come faster
//          the faster you go, which is itself a speed cue.
//   kerb   the hit. car.surface on a kerb, or the renderer's `rough`.
// The T-cam is the loudest: it sits on a stalk on the airbox and its
// vertical judder at Monza is the most recognisable shot in the sport.
// The driver's head is damped by a neck, so less buzz, more road. The chase
// camera is not bolted to anything — a whisper of it, or it reads as fake.
const MOUNTS = {
  // dive/squat: degrees of pitch per g braking/accelerating; sink: metres of
  // heave per g of load (and per 4 g of braking, the head going forward).
  // latM / latR: the driver's HEAD in a corner — metres pushed toward the
  // outside, and degrees of tilt, per g of lateral load. Only a head has them.
  onboard: { buzzP: 0.075, buzzY: 0.035, buzzR: 0.03, roadP: 0.16, roadR: 0.10, heave: 0.004, kerb: 0.9, dive: 0.18, squat: 0.08, sink: 0.02, latM: 0.010, latR: 0.30 },
  tcam:    { buzzP: 0.16, buzzY: 0.045, buzzR: 0.05, roadP: 0.14, roadR: 0.12, heave: 0.005, kerb: 1.1, dive: 0.12, squat: 0.05, sink: 0.015 },
  nose:    { buzzP: 0.12, buzzY: 0.05, buzzR: 0.04, roadP: 0.20, roadR: 0.08, heave: 0.006, kerb: 1.2, sink: 0.006 },
  chase:   { buzzP: 0.025, buzzY: 0.015, buzzR: 0.0, roadP: 0.06, roadR: 0.03, heave: 0.012, kerb: 0.35, sink: 0.03 },
};
const D2R = Math.PI / 180;

export class SpeedShake {
  constructor() {
    this.dist = 0;              // metres travelled, for the road band
    this.kick = 0;              // decaying kerb/bump energy
    this.out = { p: 0, y: 0, r: 0, h: 0 };
    this._hf = { p: 0, y: 0, r: 0 };
  }
  /**
   * dt real seconds; speed m/s; mount key; f = {
   *   rough  0..0.45 (render.js hud: kerb 0.22, grass 0.45)
   *   kerb   0 none, 1 flat, 2 standard, 3 high (surface.js KERB), when a
   *          wheel is on one
   *   gLong  longitudinal g, + accelerating (render.js derives it from the
   *          speed alone, so a replay dives exactly as the lap did)
   *   gVert  extra vertical load in g, e.g. a banked corner pressing you down
   * }. Returns radians (p pitch, y yaw, r roll) and metres (h heave).
   */
  step(dt, speed, mount, f = {}) {
    const o = this.out;
    const M = MOUNTS[mount];
    if (!SFX.on || !M || SFX.shake <= 0) { o.p = o.y = o.r = o.h = o.x = 0; return o; }
    const { rough = 0, kerb = 0, gLong = 0, gVert = 0, gLat = 0 } = f;
    dt = Math.min(0.1, Math.max(0, dt));
    const v = Math.max(0, speed);
    const k = v / 97.2;                                 // 1.0 at 350 km/h
    this.dist += v * dt;
    const rnd = () => Math.random() * 2 - 1;
    // KERBS, by type. The HIT is on the way onto the kerb — a high kerb is
    // one big blow, a standard one a firm knock — and then, while you are on
    // it, the ridges: a buzz that is all frequency (a flat kerb, two wheels
    // on it every lap) or a hammering (a high one).
    const kerbK = [0, 0.35, 0.7, 1.25][kerb] || 0, rideK = [0, 1.0, 0.55, 0.9][kerb] || 0;
    if (kerb && !this._kerbWas && v > 8) this.kick = Math.max(this.kick, kerbK * (0.6 + 0.4 * Math.min(1, k)));
    this._kerbWas = kerb;
    this.kick = Math.max(this.kick, Math.min(1, rough * (kerb ? 0.5 : 1.6)));
    this.kick *= Math.exp(-dt * 7);
    // buzz: rises faster than speed (aero load and tyre frequency both climb)
    const b = Math.pow(k, 1.6) * SFX.shake;
    // Lightly low-passed so it is judder rather than static at 144 Hz.
    const a = Math.min(1, dt * 55);
    this._hf.p += (rnd() - this._hf.p) * a;
    this._hf.y += (rnd() - this._hf.y) * a;
    this._hf.r += (rnd() - this._hf.r) * a;
    // on the kerb: the ridges, as extra high-frequency amplitude
    const ride = kerb && v > 8 ? rideK * Math.min(1, 0.4 + k) * M.kerb * 0.35 * SFX.shake : 0;
    // road: three incommensurate spatial wavelengths (m)
    const d = this.dist;
    const w1 = Math.sin(d / 9.1 * 6.283), w2 = Math.sin(d / 3.7 * 6.283 + 1.3), w3 = Math.sin(d / 14.3 * 6.283 + 2.1);
    const road = (0.5 * w2 + 0.3 * w1 + 0.2 * w3) * Math.min(1, k) * SFX.shake;
    const roll = (0.6 * Math.sin(d / 5.3 * 6.283 + 0.4) + 0.4 * w3) * Math.min(1, k) * SFX.shake;
    const kk = this.kick * M.kerb * SFX.shake;
    // the hits' noise, smoothed: a fresh random every frame read as teleporting
    this._kn = (this._kn || 0) + (rnd() - (this._kn || 0)) * Math.min(1, dt * 18);
    const kn = this._kn;

    // THE DIVE. Braking at 5-6 g an F1 car's nose goes down and so does your
    // head, and a stiff car does it with a bounce as the brakes come off.
    // A spring (w 13 rad/s, damping 0.45) chasing the longitudinal g, so the
    // release overshoots a touch the way a chassis does. Throttle squats the
    // other way, more gently. Only mounts with a `dive` feel it.
    const tgt = Math.max(-6.5, Math.min(2.5, gLong));
    const w = 13, z = 0.45;
    this._dv = (this._dv || 0) + (w * w * (tgt - (this._dx || 0)) - 2 * z * w * (this._dv || 0)) * dt;
    this._dx = (this._dx || 0) + this._dv * dt;
    const g = this._dx;
    const dive = (g < 0 ? g * (M.dive || 0) : g * (M.squat || 0)) * SFX.shake;
    // LOAD: a banked corner or a compression presses you into the seat.
    this._gv = (this._gv || 0) + (Math.max(0, Math.min(3, gVert)) - (this._gv || 0)) * Math.min(1, dt * 5);

    // THE HEAD IN A CORNER (Adam: "realism as though you're the driver").
    // At 5 g the neck loses a few centimetres to the outside and the helmet
    // tips with it; a spring (w 9, damping 0.6) so it lags into the corner
    // and settles back out of it the way a neck does, not the way a camera does.
    const lt = Math.max(-6, Math.min(6, gLat));
    this._lv = (this._lv || 0) + (81 * (lt - (this._lx || 0)) - 2 * 0.6 * 9 * (this._lv || 0)) * dt;
    this._lx = (this._lx || 0) + this._lv * dt;
    o.x = (M.latM || 0) * this._lx * SFX.shake;
    const headRoll = -(M.latR || 0) * this._lx;

    o.p = (M.buzzP * (b + ride * 2.2) * this._hf.p + M.roadP * road + kk * kn * 0.9 + dive - 0.25 * this._gv) * D2R;
    o.y = (M.buzzY * (b + ride) * this._hf.y + kk * kn * 0.25) * D2R;
    o.r = (M.buzzR * (b + ride * 2.5) * this._hf.r + M.roadR * roll + kk * kn * 0.5 + headRoll * SFX.shake) * D2R;
    o.h = M.heave * (road + 0.5 * (b + ride) * this._hf.p) + 0.01 * kk * kn
      - (M.sink || 0) * (this._gv + Math.max(0, -g) * 0.25);
    return o;
  }
}

// ---------------------------------------------------------------------------
// BLUR
//
// Camera motion blur with the camera's motion KNOWN rather than guessed.
// Depth is READ where there is one: post.js's scene target carries a depth
// texture, so every pixel's real distance — a wall a metre away, a board, a
// tree — is reprojected exactly. Without the post chain (Intel, SwiftShader)
// depth is ASSUMED: the ground plane below the horizon, which on a race track
// is very nearly exact, and above it a corridor of barriers ~11 m either side. Reproject that point with the camera moved on by
// one shutter interval and you have the pixel's streak: zero at the point you
// are driving towards, longest in the lower corners, following the real
// perspective of the road instead of a generic zoom.
//
// Your own car is masked out (it moves WITH the camera, so a real lens does
// not smear it), by drawing just the car, white, into a quarter-size target.
// Taps that land on the car are dropped, so red paint never bleeds into the
// tarmac beside the sidepod. RIVALS are masked the same way for the same
// reason — a car beside you at your speed is sharp in a real lens — but not
// by drawing them (57 meshes each): the nearest four get a screen RECTANGLE
// from their bounding box, and with depth only the pixels inside it at the
// car's own distance count, which is its silhouette for free. A mirror strip, when there is one, is left alone.
// And a radial mask keeps the centre of the frame — where you are looking —
// sharp whatever the numbers say.
const MASK_LAYER = 7;
const TAPS = 12;

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D tCol; uniform sampler2D tMask;
uniform mat4 uProj; uniform mat4 uInvProj; uniform mat3 uRot;
uniform vec3 uVel; uniform float uH; uniform float uShutter; uniform float uAspect;
uniform float uMax; uniform float uAmt; uniform vec4 uHole; uniform vec2 uRes;
uniform sampler2D tDepth; uniform float uHasDepth;
uniform vec4 uCar[4]; uniform vec2 uCarZ[4]; uniform float uCarN;
varying vec2 vUv;
// view-space position of the pixel: from the depth buffer, or assumed
vec3 where(vec2 uv) {
  if (uHasDepth > 0.5) {
    float d = texture2D(tDepth, uv).r;
    vec4 c = uInvProj * vec4(uv * 2.0 - 1.0, min(d, 0.99999) * 2.0 - 1.0, 1.0);
    vec3 P = c.xyz / c.w;
    return d >= 0.99999 ? normalize(P) * 2000.0 : P;   // sky: far away
  }
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 ray = normalize(v.xyz / v.w);            // view space
  vec3 rw = uRot * ray;                          // world space direction
  float t;
  if (rw.y < -0.004) t = min(400.0, uH / -rw.y);
  else {
    vec3 vd = normalize(uVel + vec3(1e-5));
    vec3 perp = ray - dot(ray, vd) * vd;
    t = min(400.0, 11.0 / max(0.03, length(perp)));
  }
  return ray * t;
}
bool rival(vec2 uv, float dist) {
  for (int i = 0; i < 4; i++) {
    vec4 r = uCar[i];
    if (uv.x > r.x && uv.x < r.z && uv.y > r.y && uv.y < r.w && dist > uCarZ[i].x && dist < uCarZ[i].y) return true;
  }
  return false;
}
bool inRect(vec2 uv) {
  for (int i = 0; i < 4; i++) { vec4 r = uCar[i]; if (uv.x > r.x && uv.x < r.z && uv.y > r.y && uv.y < r.w) return true; }
  return false;
}
vec2 streak(vec2 uv, vec3 P0) {
  vec3 P = P0 - uVel * uShutter;                 // the camera moved on
  vec4 c = uProj * vec4(P, 1.0);
  if (c.w <= 0.05) return vec2(0.0);
  vec2 uv2 = c.xy / c.w * 0.5 + 0.5;
  vec2 d = uv2 - uv;
  float L = length(d * vec2(uAspect, 1.0));
  return L > uMax ? d * (uMax / L) : d;
}
void main() {
  vec4 base = texture2D(tCol, vUv);
  vec2 px = vUv * uRes;
  bool hole = px.x > uHole.x && px.x < uHole.z && px.y > uHole.y && px.y < uHole.w;
  float me = texture2D(tMask, vUv).r;
  // never the centre: 0 inside ~a third of the way out, full by the corners
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(q) / length(vec2(uAspect, 1.0) * 0.5);
  float edge = smoothstep(0.22, 0.78, r) * uAmt;
  if (hole || me > 0.5 || edge < 0.01) { gl_FragColor = base; return; }
  vec3 P0 = where(vUv);
  float dist = length(P0);
  if (uCarN > 0.5 && rival(vUv, dist)) { gl_FragColor = base; return; }
  vec2 d = streak(vUv, P0) * edge;
  if (length(d * uRes) < 1.2) { gl_FragColor = base; return; }
  vec3 acc = base.rgb; float wsum = 1.0;
  for (int i = 0; i < ${TAPS}; i++) {
    float f = (float(i) + 0.5) / float(${TAPS}) - 0.5;
    vec2 u = vUv + d * f;
    if (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) continue;
    if (texture2D(tMask, u).r > 0.5) continue;   // do not smear the car in
    if (uCarN > 0.5 && inRect(u)) continue;   // rect only: cheap, and errs toward not smearing
    acc += texture2D(tCol, u).rgb; wsum += 1.0;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;

export class SpeedBlur {
  constructor(renderer) {
    this.r = renderer;
    this.size = new THREE.Vector2();
    this.tex = null;
    this.mask = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, stencilBuffer: false });
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
      uniforms: {
        tCol: { value: null }, tMask: { value: this.mask.texture },
        uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uRot: { value: new THREE.Matrix3() }, uVel: { value: new THREE.Vector3() },
        uH: { value: 1 }, uShutter: { value: 1 / 100 }, uAspect: { value: 1 },
        uMax: { value: 0.07 }, uAmt: { value: 1 }, uHole: { value: new THREE.Vector4(-1, -1, -1, -1) },
        uRes: { value: new THREE.Vector2(1, 1) },
        tDepth: { value: null }, uHasDepth: { value: 0 },
        uCar: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(2, 2, 2, 2)) },
        uCarZ: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(0, 0)) }, uCarN: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.flat = new THREE.Scene(); this.flat.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._tagged = 0; this._frame = 0;
    this._m4 = new THREE.Matrix4(); this._v = new THREE.Vector3();
    this._rivals = []; this._p = new THREE.Vector3(); this._c = new THREE.Vector3();
  }

  // The nearest four rivals as screen rectangles (uv) plus the distance band
  // they occupy. A box around the car in its own frame, projected.
  _rivalRects(scene, camera, withDepth) {
    const u = this.mat.uniforms;
    if ((this._frame % 120) === 1 || !this._rivals.length) this._rivals = scene.children.filter(o => o.name === 'rival');
    const cp = camera.position, near = [];
    for (const g of this._rivals) {
      if (!g.visible) continue;
      const d = g.position.distanceTo(cp);
      if (d < 45) near.push([d, g]);
    }
    near.sort((a, b) => a[0] - b[0]);
    u.uCarN.value = 0;
    for (let i = 0; i < 4; i++) {
      const R = u.uCar.value[i], Zb = u.uCarZ.value[i];
      R.set(2, 2, 2, 2); Zb.set(0, 0);
      const g = near[i] && near[i][1];
      if (!g) continue;
      g.updateMatrixWorld();
      let x0 = 9, y0 = 9, x1 = -9, y1 = -9, z0 = 1e9, z1 = 0, behind = false;
      for (let k = 0; k < 8; k++) {
        this._p.set(k & 1 ? 3.1 : -2.9, k & 2 ? 1.25 : -0.05, k & 4 ? 1.1 : -1.1).applyMatrix4(g.matrixWorld);
        const dd = this._p.distanceTo(cp);
        z0 = Math.min(z0, dd); z1 = Math.max(z1, dd);
        this._c.copy(this._p).applyMatrix4(camera.matrixWorldInverse);
        if (this._c.z > -0.2) { behind = true; continue; }
        this._p.project(camera);
        x0 = Math.min(x0, this._p.x); x1 = Math.max(x1, this._p.x); y0 = Math.min(y0, this._p.y); y1 = Math.max(y1, this._p.y);
      }
      // partly behind the lens: it is beside you, so take the whole side it is on
      if (behind) { if (x1 < -9 + 1) continue; if (x0 < 0) x0 = -1.2; else x1 = 1.2; y0 = -1.2; }
      R.set(x0 * 0.5 + 0.5, y0 * 0.5 + 0.5, x1 * 0.5 + 0.5, y1 * 0.5 + 0.5);
      u.uCarN.value++;
      if (withDepth) Zb.set(Math.max(0, z0 - 0.8), z1 + 0.8); else Zb.set(0, 1e9);
    }
  }

  _tag(car) {
    let n = 0;
    car.traverse(o => { if (o.isMesh || o.isInstancedMesh) { o.layers.enable(MASK_LAYER); n++; } });
    this._tagged = n;
  }

  /**
   * After the frame is on the canvas.
   *   car      your car's Object3D (masked out)
   *   vel      camera velocity, world, m/s (THREE.Vector3)
   *   height   camera height above the road, m
   *   hole     [x0, y0, x1, y1] drawing-buffer pixels to leave alone, or null
   *   amt      0..1 strength multiplier (render.js ramps it in with speed)
   */
  render(scene, camera, car, vel, height, hole = null, amt = 1, depth = null) {
    if (!SFX.on || SFX.blur <= 0 || amt <= 0.01) return;
    const r = this.r;
    r.getDrawingBufferSize(this.size);
    const W = this.size.x, H = this.size.y;
    if (!this.tex || this.tex.image.width !== W || this.tex.image.height !== H) {
      if (this.tex) this.tex.dispose();
      this.tex = new THREE.FramebufferTexture(W, H);
      this.mat.uniforms.tCol.value = this.tex;
      this.mask.setSize(Math.max(2, W >> 2), Math.max(2, H >> 2));
    }
    // Re-tag now and then: a dented or rebuilt car gets new meshes.
    if ((this._frame++ % 120) === 0) this._tag(car);

    // 1. the car, white, into the mask
    const layers = camera.layers.mask, bg = scene.background, ov = scene.overrideMaterial;
    const sm = r.shadowMap.autoUpdate, ac = r.autoClear, tm = r.toneMapping;
    const cc = r.getClearColor(this._cc || (this._cc = new THREE.Color())).getHex(), ca = r.getClearAlpha();
    camera.layers.set(MASK_LAYER);
    scene.background = null; scene.overrideMaterial = this.white;
    r.shadowMap.autoUpdate = false; r.autoClear = true; r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(this.mask);
    r.render(scene, camera);
    camera.layers.mask = layers; scene.background = bg; scene.overrideMaterial = ov;
    r.shadowMap.autoUpdate = sm; r.setClearColor(cc, ca);

    // 2. what is on the canvas now, into a texture
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.tex, null);

    // 3. streak it
    const u = this.mat.uniforms;
    u.uProj.value.copy(camera.projectionMatrix);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uRot.value.setFromMatrix4(camera.matrixWorld);
    // velocity into VIEW space: the inverse of the camera's rotation
    this._v.copy(vel).transformDirection(this._m4.copy(camera.matrixWorld).invert()).multiplyScalar(vel.length());
    u.uVel.value.copy(this._v);
    u.uH.value = Math.max(0.2, height);
    u.uAspect.value = W / H;
    u.uRes.value.set(W, H);
    u.uAmt.value = Math.min(1.5, amt * SFX.blur);
    u.uMax.value = 0.07 * Math.min(1.5, SFX.blur);
    if (hole) u.uHole.value.set(hole[0], hole[1], hole[2], hole[3]); else u.uHole.value.set(-1, -1, -1, -1);
    // real depth only when it is the same size as the frame it describes
    const dOk = !!(depth && depth.image && depth.image.width === W && depth.image.height === H) && SFX.depth;
    u.tDepth.value = dOk ? depth : null; u.uHasDepth.value = dOk ? 1 : 0;
    this._rivalRects(scene, camera, dOk);
    r.autoClear = false;
    r.render(this.flat, this.cam);
    r.autoClear = ac; r.toneMapping = tm;
  }
}
