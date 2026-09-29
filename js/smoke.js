// smoke.js — tyre smoke and dust, as volumes you can see the sun through.
//
// The first smoke was a PointsMaterial: flat grey dots of one size, the same
// brightness at noon and midnight, with the sun behind them or in front. What
// makes smoke read as smoke is how LIGHT goes through it, so each puff here is
// shaded as a soft sphere: the side facing the sun is bright, the far side
// takes the sky's colour, and looking toward a low sun through a cloud of it
// lights it up from behind (forward scattering) — the frame every onboard
// camera shows after a lock-up into the sun.
//
// Coloured by what made it: blue-white rubber smoke on tarmac, brown dust
// off gravel and grass. It grows and slows as it spreads, rises a little, and
// fades — thick for a second, gone in four.
//
// One InstancedMesh, one draw. The puffs are SORTED back to front on the CPU
// every frame (a few hundred numbers), because alpha smoke drawn in the wrong
// order shows hard dark edges where one puff cuts another.
import * as THREE from 'three';

const MAX = 720;

// A 2x2 atlas of puff shapes: fbm value noise inside a soft round falloff.
// Alpha = density; red = a height, so the shader can bump the lighting.
function puffAtlas() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S * 2;
  const g = c.getContext('2d');
  const img = g.createImageData(S * 2, S * 2);
  const hash = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const noise = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c2 = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
  for (let t = 0; t < 4; t++) {
    const ox = (t % 2) * S, oy = (t >> 1) * S;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S * 2 - 1, v = y / S * 2 - 1;
      const r = Math.hypot(u, v);
      let n = 0, amp = 0.5, f = 3;
      for (let o = 0; o < 5; o++) { n += amp * noise(u * f + 9 * t, v * f + 5 * t, t); amp *= 0.5; f *= 2.03; }
      // billows: the edge eaten by the noise
      const edge = 1 - Math.min(1, Math.max(0, (r - 0.25 - 0.55 * n) / 0.35));
      const dens = Math.max(0, edge) * (0.55 + 0.45 * n);
      const k = ((oy + y) * S * 2 + ox + x) * 4;
      img.data[k] = Math.min(255, n * 255);
      img.data[k + 1] = 255; img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, dens * dens * 255 * 1.3);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const VS = /* glsl */`
  attribute vec4 iPos;             // xyz = centre, w = the ground's height under it
  attribute vec4 iSRAT;            // size, rotation, alpha, tile
  attribute vec3 iCol;
  varying vec2 vUv;
  varying vec2 vC;
  varying vec3 vView;
  varying vec3 vCol;
  varying float vA;
  varying float vAbove;
  void main() {
    vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
    float s = iSRAT.x, r = iSRAT.y;
    // A puff that has swallowed the lens is a full-screen quad of nearly
    // clear air — the most expensive thing this file can draw, for nothing.
    // Shrink it as the camera gets inside it.
    s *= clamp(-mv.z / (s * 1.2), 0.15, 1.0);
    vec2 c = position.xy;
    vec2 rc = vec2(c.x * cos(r) - c.y * sin(r), c.x * sin(r) + c.y * cos(r));
    // The billboard's corner in WORLD space (camera right and up are the
    // first two rows of the view matrix), so the fragment knows how high
    // above the ground it is.
    vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 wp = iPos.xyz + (camR * rc.x + camU * rc.y) * s;
    vAbove = (wp.y - iPos.w) / max(0.15, s * 0.45);
    mv.xy += rc * s;
    vView = mv.xyz;
    vC = c;
    float t = iSRAT.w;
    vUv = (c * 0.5 + 0.5) * 0.5 + vec2(mod(t, 2.0), floor(t / 2.0)) * 0.5;
    vCol = iCol; vA = iSRAT.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FS = /* glsl */`
  uniform sampler2D map;
  uniform vec3 uSunV;              // toward the sun, view space
  uniform vec3 uSun;               // sun colour x intensity
  uniform vec3 uAmb;               // sky colour x intensity
  uniform vec3 fogColor;
  uniform float fogDensity;
  uniform sampler2D uDepth;
  uniform float uSoft;             // 1 when uDepth holds this frame's scene depth
  uniform vec2 uRes;
  uniform float uNear, uFar;
  varying vec2 vUv;
  varying vec2 vC;
  varying vec3 vView;
  varying vec3 vCol;
  varying float vA;
  varying float vAbove;
  void main() {
    vec4 t = texture2D(map, vUv);
    // THE GROUND. A flat billboard crossing the road is cut off in a hard
    // straight line — the tell of a sprite. Without a depth texture there
    // are no soft particles, but the ground is the plane smoke meets most,
    // and its height is known: thin the puff out as it reaches it.
    float dens = t.a * vA * smoothstep(0.0, 1.0, vAbove);
    // SOFT PARTICLES. Everything opaque between us and the puff: fade the
    // puff out over the last 0.7 m before it meets a hoarding, a barrier, a
    // car. Without it smoke is cut off in a hard line by every board.
    if (uSoft > 0.5) {
      float d = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
      float zs = (2.0 * uNear * uFar) / (uFar + uNear - (d * 2.0 - 1.0) * (uFar - uNear));
      dens *= clamp((zs - (-vView.z)) / 0.7, 0.0, 1.0);
    }
    if (dens < 0.004) discard;
    // a soft sphere's normal, roughened by the puff's own noise
    float r2 = dot(vC, vC);
    vec3 n = normalize(vec3(vC * 0.95 + (t.r - 0.5) * 0.6, sqrt(max(0.0, 1.0 - r2)) + 0.25));
    float wrap = dot(n, uSunV) * 0.5 + 0.5;
    vec3 toFrag = normalize(vView);
    float fwd = pow(max(0.0, dot(toFrag, uSunV)), 5.0);     // sun behind the smoke
    // thin edges let more light through than the thick middle
    float thin = 1.0 - clamp(dens * 1.4, 0.0, 1.0);
    // Self-shadowing, faked: the underside and the side away from the sun
    // sit in the puff's own shadow, and the thick core is darker than the
    // wisps. Without it a cloud of puffs is one flat-tinted blob.
    float shade = mix(0.55, 1.0, smoothstep(-0.4, 0.8, n.y));
    float sunLit = smoothstep(0.15, 0.95, wrap);
    vec3 light = uAmb * shade + uSun * (sunLit * 0.95 + fwd * (0.8 + 1.6 * thin));
    vec3 col = vCol * light * (0.85 + 0.3 * t.r) * mix(1.0, 0.72, clamp(dens * 1.2, 0.0, 1.0));
    // near the lens it thins out, rather than filling the screen with one texel
    dens *= smoothstep(0.35, 2.2, -vView.z);
    float d = length(vView);
    float f = 1.0 - exp(-fogDensity * fogDensity * d * d);
    col = mix(col, fogColor, f);
    gl_FragColor = vec4(col, dens);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Smoke {
  constructor(scene) {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.attributes.position = quad.attributes.position;
    this.aPos = new Float32Array(MAX * 4);
    this.aSRAT = new Float32Array(MAX * 4);
    this.aCol = new Float32Array(MAX * 3);
    const ia = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('iPos', this.bPos = ia(this.aPos, 4));
    g.setAttribute('iSRAT', this.bSRAT = ia(this.aSRAT, 4));
    g.setAttribute('iCol', this.bCol = ia(this.aCol, 3));
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: {
        map: { value: puffAtlas() },
        uSunV: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: new THREE.Color(1, 1, 1) },
        uAmb: { value: new THREE.Color(0.5, 0.55, 0.6) },
        fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 },
        uDepth: { value: null }, uSoft: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 1000 },
      },
      transparent: true, depthWrite: false, depthTest: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'fx.smoke';
    this.mesh.onBeforeRender = (r, sc, cam) => this._grabDepth(r, cam);
    this.soft = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('softfx') !== '0';
    scene.add(this.mesh);
    this.geo = g;
    this.p = [];
    for (let i = 0; i < MAX; i++) {
      this.p.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, grow: 1,
        a: 1, rot: 0, spin: 0, r: 1, g: 1, b: 1, tile: 0, rise: 0.5, key: 0, gy: 0 });
    }
    this.next = 0;
    this.live = [];
    this.n = 0;
    this._dir = new THREE.Vector3();
  }

  /**
   * One puff. Position and velocity in three space. `size` is its starting
   * radius in metres and `grow` how fast it spreads; `alpha` its thickness.
   */
  emit(x, y, z, vx, vy, vz, { size = 0.5, grow = 1.4, life = 3, alpha = 0.5, col = [0.86, 0.87, 0.9], rise = 0.45, gy = null } = {}) {
    let p = this.p[this.next];
    this.next = (this.next + 1) % MAX;
    if (!p.on) this.live.push(p);
    p.on = true;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.age = 0; p.life = life * (0.75 + Math.random() * 0.5);
    p.s0 = size * (0.8 + Math.random() * 0.4); p.grow = grow * (0.8 + Math.random() * 0.4);
    p.a = alpha; p.rot = Math.random() * 6.283; p.spin = (Math.random() - 0.5) * 0.6;
    const sh = 0.94 + Math.random() * 0.08;
    p.r = col[0] * sh; p.g = col[1] * sh; p.b = col[2] * sh;
    p.tile = (Math.random() * 4) | 0; p.rise = rise;
    p.gy = gy == null ? y - 0.3 : gy;
  }

  // THE SCENE'S DEPTH, for soft particles, without touching the post chain.
  // Called just before the smoke draws — the opaque scene is finished and the
  // scene target is bound — and it BLITS that target's depth buffer into a
  // depth texture of our own. Sampling the target's own depth while drawing
  // into it would be a feedback loop; a copy is not. Only the largest target
  // seen (the main view, not the car mirrors) gets it; smaller passes draw
  // hard-edged, which in a 320 px mirror nobody can see.
  _grabDepth(r, cam) {
    const u = this.mat.uniforms;
    u.uSoft.value = 0;
    if (!this.soft) return;                      // (r185 is WebGL2-only; there is no isWebGL2 flag to ask)
    const rt = r.getRenderTarget();
    this._why = !rt ? 'no target' : !rt.depthBuffer ? 'no depth' : 'ok';
    if (!rt || !rt.depthBuffer) return;
    const w = rt.width, h = rt.height;
    // the main view only: a target the size of the canvas. (The car mirrors
    // draw first each frame, at 320x120 with MSAA, and must not be it.)
    const db = r.getDrawingBufferSize(this._db || (this._db = new THREE.Vector2()));
    if (w !== db.x || h !== db.y) { this._why = 'not main ' + w + 'x' + h; return; }
    if (!this.depthRT || this.depthRT.width !== w || this.depthRT.height !== h) {
      if (this.depthRT) this.depthRT.dispose();
      const dt = new THREE.DepthTexture(w, h);
      dt.type = THREE.UnsignedIntType;
      this.depthRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, depthBuffer: true });
      r.initRenderTarget(this.depthRT);
    }
    const gl = r.getContext();
    const src = r.properties.get(rt).__webglFramebuffer;
    const dst = r.properties.get(this.depthRT).__webglFramebuffer;
    if (!dst) { this._why = 'no dst fb'; return; }
    // gl.getError is a synchronous round trip in Chrome (it stalls the whole
    // pipeline: 9 ms measured), so it is asked ONCE, on the first blit, and the
    // answer kept.
    const probe = !this._verified;
    if (probe) while (gl.getError() !== gl.NO_ERROR) { /* someone else's */ }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, src);
    if (probe) {
      const err = gl.getError();
      if (err !== gl.NO_ERROR) { this._why = 'gl error ' + err; this.soft = false; return; }
      this._verified = true;
    }   // formats refused: stay hard, never broken
    u.uDepth.value = this.depthRT.depthTexture;
    u.uRes.value.set(w, h);
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uSoft.value = 1;
  }

  /** Light and fog from the scene, once a frame. */
  light(camera, sunDir, sunCol, ambCol, fog) {
    const u = this.mat.uniforms;
    if (sunDir) u.uSunV.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    if (sunCol) u.uSun.value.copy(sunCol);
    if (ambCol) u.uAmb.value.copy(ambCol);
    if (fog && fog.isFogExp2) { u.fogColor.value.copy(fog.color); u.fogDensity.value = fog.density; }
    else u.fogDensity.value = 0;
  }

  update(dt, camera) {
    dt = Math.min(dt, 1 / 20);
    const L = this.live;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) { p.on = false; L[i] = L[L.length - 1]; L.pop(); continue; }
      // Smoke leaves the tyre at a fraction of the car's speed and the air
      // takes it off that quickly; then it drifts up and spreads.
      const k = Math.max(0, 1 - 2.2 * dt);
      p.vx *= k; p.vz *= k;
      p.vy = p.vy * Math.max(0, 1 - 1.5 * dt) + p.rise * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
    }
    const n = L.length;
    this.n = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    // back to front
    const cp = camera.position, d = camera.getWorldDirection(this._dir);
    for (const p of L) p.key = (p.x - cp.x) * d.x + (p.y - cp.y) * d.y + (p.z - cp.z) * d.z;
    L.sort((a, b) => b.key - a.key);
    for (let i = 0; i < n; i++) {
      const p = L[i], t = p.age / p.life;
      const size = p.s0 + p.grow * Math.pow(p.age, 0.65);
      // in fast, a long thinning tail; a big puff is thinner per unit area
      const a = p.a * Math.min(1, p.age / 0.08) * Math.pow(1 - t, 1.6);
      this.aPos[i * 4] = p.x; this.aPos[i * 4 + 1] = p.y; this.aPos[i * 4 + 2] = p.z; this.aPos[i * 4 + 3] = p.gy;
      this.aSRAT[i * 4] = size; this.aSRAT[i * 4 + 1] = p.rot; this.aSRAT[i * 4 + 2] = a; this.aSRAT[i * 4 + 3] = p.tile;
      this.aCol[i * 3] = p.r; this.aCol[i * 3 + 1] = p.g; this.aCol[i * 3 + 2] = p.b;
    }
    for (const a of [this.bPos, this.bSRAT, this.bCol]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true;
    }
  }

  get count() { return this.n; }
}
