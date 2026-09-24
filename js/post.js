// post.js — the light, after the geometry.
//
// See LOOK.md. The one sentence is: YOU ARE A PERSON IN A HELMET. Everything
// here models an EYE, so pupil adaptation, dazzle and god rays are in, and
// lens flare, dirt and chromatic aberration are out — they happen inside a
// camera body and there is no camera.
//
// Written by hand because this project vendors three's core and not its
// addons, so there is no EffectComposer. That turns out to be a feature: the
// chain below is four passes and every one of them is here to be read.
//
//   1. the scene, into a FLOATING POINT target with no tone mapping
//   2. a luminance pyramid, halved to 1x1, then eased toward over time
//   3. a bright pass, blurred twice for bloom and radially for god rays
//   4. a composite that applies exposure, adds both, and tone maps
//
// WHY FLOATING POINT MATTERS. The sun is not 1.0. In an 8-bit buffer the sky
// clips to white and every bright thing is equally bright, so there is nothing
// for an eye to adapt TO and nothing for bloom to find. Half-float keeps the
// sun a thousand times brighter than the asphalt, which is what it is, and
// every effect below falls out of that one decision.
import * as THREE from 'three';

const LUM = 'vec3(0.2126, 0.7152, 0.0722)';

// A full-screen pass. One quad, one ortho camera, shared by everything.
const QUAD = new THREE.PlaneGeometry(2, 2);
const FLAT = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Pass {
  constructor(frag, uniforms) {
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: `
        in vec3 position; in vec2 uv; out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `precision highp float; precision highp sampler2D;
        in vec2 vUv; out vec4 fragColour;\n` + frag,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(QUAD, this.mat));
  }
  to(renderer, target) {
    renderer.setRenderTarget(target || null);
    renderer.render(this.scene, FLAT);
  }
}

const hdr = (w, h) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
});

export class Post {
  /**
   * `quality` is 'off' | 'low' | 'high'. Nothing here is optional in the sense
   * of being decoration — but the Intel chip in this laptop draws Monza at
   * 112 ms a frame before any of it, so it gets 'off' and the GeForce gets the
   * lot. See LOOK.md: quality is DETECTED, never chosen.
   */
  constructor(renderer, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.quality = quality;
    this.on = quality !== 'off';
    if (!this.on) return;

    // The grey the eye aims for. 0.22 was measured at Monza and it blew the
    // gravel to near-white and drained the grass: a scene that is mostly dark
    // green pulls the log-average DOWN, so the exposure goes up and the few
    // bright things clip. 0.12 puts the tarmac back where tarmac lives.
    this.exposureKey = 0.12;
    this.bloom = 0.85;
    this.rays = 0.75;
    this.threshold = 1.15;       // bloom starts ABOVE white, so only real light glows
    // HOW FAR THE EYE MAY ADAPT. The floor under the adapted luminance was
    // 1e-4, i.e. none: at night the exposure climbed until a dark scene read
    // as a grey foggy day — black tyres turned grey, the road went milky, and
    // Adam's dawn "looks like night" was really night looking like nothing.
    // A real eye and a real camera stop adapting; so does this.
    this.lumFloor = 0.05;
    this.adapt = { up: 0.40, down: 1.20 };   // see below — asymmetric on purpose
    this.sun = new THREE.Vector3(0, 1, 0);
    this.sunUp = 0;              // 0 when the sun is behind you or below the horizon

    const u = v => ({ value: v });
    this.uSize = u(new THREE.Vector2(1, 1));

    // ---- the scene, in HDR ---------------------------------------------
    this.sceneRT = hdr(1, 1);

    // ---- luminance pyramid ----------------------------------------------
    // Log-average, not mean: a few blinding pixels should not decide the
    // exposure of the whole frame, and the log makes the sun weigh what a
    // sun should rather than what its raw value is.
    this.lumSeed = new Pass(`
      uniform sampler2D tSrc;
      void main() {
        vec3 c = texture(tSrc, vUv).rgb;
        float l = dot(max(c, vec3(0.0)), ${LUM});
        fragColour = vec4(log(max(l, 1e-4)), 0.0, 0.0, 1.0);
      }`, { tSrc: u(null) });

    this.halve = new Pass(`
      uniform sampler2D tSrc; uniform vec2 uTexel;
      void main() {
        float a = texture(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).r;
        float b = texture(tSrc, vUv + uTexel * vec2( 0.5, -0.5)).r;
        float c = texture(tSrc, vUv + uTexel * vec2(-0.5,  0.5)).r;
        float d = texture(tSrc, vUv + uTexel * vec2( 0.5,  0.5)).r;
        fragColour = vec4((a + b + c + d) * 0.25, 0.0, 0.0, 1.0);
      }`, { tSrc: u(null), uTexel: u(new THREE.Vector2()) });

    // EYES ARE SLOWER INTO THE DARK THAN OUT OF IT. Adam picked ~1.2 s
    // bright→dark and ~0.4 s dark→bright, which is also the truth: light
    // adaptation is seconds and dark adaptation is minutes. In exposure terms
    // that means exposure FALLS fast when the world gets brighter and RISES
    // slowly when it gets darker — which is what makes a tunnel, or a corner
    // exit into a low sun, something you feel rather than read about.
    this.adaptPass = new Pass(`
      uniform sampler2D tLum, tPrev; uniform float uUp, uDown, uDt;
      void main() {
        float target = exp(texture(tLum, vec2(0.5)).r);
        float prev = texture(tPrev, vec2(0.5)).r;
        if (prev <= 0.0) prev = target;
        // brighter world -> exposure must drop -> the FAST direction
        float tau = target > prev ? uUp : uDown;
        float k = 1.0 - exp(-uDt / max(tau, 0.016));
        fragColour = vec4(mix(prev, target, k), 0.0, 0.0, 1.0);
      }`, { tLum: u(null), tPrev: u(null), uUp: u(0.4), uDown: u(1.2), uDt: u(0.016) });
    this.lumRT = [];
    this.adaptRT = [hdr(1, 1), hdr(1, 1)];
    this.adaptFlip = 0;

    // ---- bright pass ------------------------------------------------------
    // The threshold is in EXPOSED space, so it follows the eye. On a dark
    // night the bloom threshold comes down with the pupil and headlights
    // glow; at noon it rises and only the sun does. A fixed threshold makes
    // night either black or a smear.
    this.bright = new Pass(`
      uniform sampler2D tSrc, tAdapt; uniform float uKey, uThresh, uFloor;
      void main() {
        vec3 c = texture(tSrc, vUv).rgb;
        float ev = uKey / max(texture(tAdapt, vec2(0.5)).r, uFloor);
        c *= ev;
        float l = dot(c, ${LUM});
        float k = smoothstep(uThresh, uThresh * 2.0, l);
        fragColour = vec4(c * k, 1.0);
      }`, { tSrc: u(null), tAdapt: u(null), uKey: u(0.22), uThresh: u(1.15), uFloor: u(1e-4) });

    this.blur = new Pass(`
      uniform sampler2D tSrc; uniform vec2 uDir;
      void main() {
        // 9 taps, gaussian, separable. Weights are the binomial row; cheaper
        // than it looks because the bright pass runs at quarter resolution.
        float w[5] = float[](0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162);
        vec3 s = texture(tSrc, vUv).rgb * w[0];
        for (int i = 1; i < 5; i++) {
          vec2 o = uDir * float(i);
          s += texture(tSrc, vUv + o).rgb * w[i];
          s += texture(tSrc, vUv - o).rgb * w[i];
        }
        fragColour = vec4(s, 1.0);
      }`, { tSrc: u(null), uDir: u(new THREE.Vector2()) });

    // ---- god rays ---------------------------------------------------------
    // A radial blur of the BRIGHT PASS, marched from the sun's position on
    // screen. The occlusion is free and it is the whole trick: anything solid
    // is dark in the bright pass, so the shafts only appear where light
    // actually reaches the camera. Drive down the Monza tree avenue and the
    // rays strobe through the trunks without anything being told about trees.
    this.ray = new Pass(`
      uniform sampler2D tSrc; uniform vec2 uSun; uniform float uDensity, uDecay, uWeight;
      void main() {
        vec2 d = (vUv - uSun) * uDensity / 24.0;
        vec2 p = vUv;
        float fall = 1.0;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 24; i++) {
          p -= d;
          acc += texture(tSrc, p).rgb * fall;
          fall *= uDecay;
        }
        fragColour = vec4(acc * uWeight / 24.0, 1.0);
      }`, {
      tSrc: u(null), uSun: u(new THREE.Vector2(0.5, 0.5)),
      uDensity: u(1.0), uDecay: u(0.96), uWeight: u(1.0),
    });

    // ---- composite --------------------------------------------------------
    this.comp = new Pass(`
      uniform sampler2D tScene, tBloom, tRays, tAdapt;
      uniform float uKey, uBloom, uRays, uSunUp, uFloor;

      // ACES, the fitted curve. The renderer used to do this; it happens here
      // now because everything above has to run in LINEAR light and tone
      // mapping is the last thing that may ever happen.
      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      void main() {
        float ev = uKey / max(texture(tAdapt, vec2(0.5)).r, uFloor);
        vec3 c = texture(tScene, vUv).rgb * ev;
        c += texture(tBloom, vUv).rgb * uBloom;
        c += texture(tRays, vUv).rgb * uRays * uSunUp;
        c = aces(c);
        // linear -> sRGB by hand: a RawShaderMaterial gets no colour-space
        // conversion from three, so doing it here is the only way it happens.
        c = mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055,
                step(0.0031308, c));
        fragColour = vec4(c, 1.0);
      }`, {
      tScene: u(null), tBloom: u(null), tRays: u(null), tAdapt: u(null),
      uKey: u(0.22), uBloom: u(0.85), uRays: u(0.75), uSunUp: u(0.0), uFloor: u(1e-4),
    });

    // Bloom and rays run at a quarter of the width. Nobody has ever noticed a
    // soft thing being soft at half resolution, and it is four times cheaper.
    this.bloomRT = [hdr(1, 1), hdr(1, 1)];
    this.rayRT = hdr(1, 1);
  }

  setSize(w, h) {
    if (!this.on) return;
    const dpr = this.renderer.getPixelRatio();
    const W = Math.max(2, Math.floor(w * dpr)), H = Math.max(2, Math.floor(h * dpr));
    this.uSize.value.set(W, H);
    this.sceneRT.setSize(W, H);
    const bw = Math.max(2, W >> 2), bh = Math.max(2, H >> 2);
    this.bloomRT[0].setSize(bw, bh);
    this.bloomRT[1].setSize(bw, bh);
    this.rayRT.setSize(bw, bh);
    this.bw = bw; this.bh = bh;

    // The pyramid: halve until 1x1. Rebuilt on resize because its depth
    // depends on the size.
    for (const rt of this.lumRT) rt.dispose();
    this.lumRT = [];
    let s = 64;                       // seeding at 64 is plenty; the eye is not a light meter
    while (s >= 1) { this.lumRT.push(hdr(s, s)); s >>= 1; }
  }

  /** Where the sun is, in world space, and whether it is in front of us. */
  setSun(worldPos, camera) {
    if (!this.on) return;
    this.sun.copy(worldPos);
    const v = this.sun.clone().project(camera);
    this.sunScreen = new THREE.Vector2((v.x + 1) / 2, (v.y + 1) / 2);
    // Behind the camera, project() still returns a point — and it is a LIE,
    // mirrored through the origin. Rays from a sun that is behind you would
    // march the wrong way and streak the screen for no reason.
    const dir = this.sun.clone().sub(camera.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = dir.dot(fwd);
    this.sunUp = Math.max(0, Math.min(1, (facing - 0.1) / 0.5));
  }

  render(scene, camera, dt = 0.016) {
    const r = this.renderer;
    if (!this.on) { r.setRenderTarget(null); r.render(scene, camera); return; }

    // 1. the scene, linear, unclipped
    const hadTone = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // 2. luminance -> 1x1 -> eased
    this.lumSeed.mat.uniforms.tSrc.value = this.sceneRT.texture;
    this.lumSeed.to(r, this.lumRT[0]);
    for (let i = 1; i < this.lumRT.length; i++) {
      const src = this.lumRT[i - 1];
      this.halve.mat.uniforms.tSrc.value = src.texture;
      this.halve.mat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.halve.to(r, this.lumRT[i]);
    }
    const prev = this.adaptRT[this.adaptFlip], next = this.adaptRT[1 - this.adaptFlip];
    const a = this.adaptPass.mat.uniforms;
    a.tLum.value = this.lumRT[this.lumRT.length - 1].texture;
    a.tPrev.value = prev.texture;
    a.uUp.value = this.adapt.up; a.uDown.value = this.adapt.down;
    a.uDt.value = Math.min(0.1, dt);
    this.adaptPass.to(r, next);
    this.adaptFlip = 1 - this.adaptFlip;
    const adapt = next.texture;

    // 3. bright -> blur -> bloom, and bright -> radial -> rays
    const b = this.bright.mat.uniforms;
    b.tSrc.value = this.sceneRT.texture; b.tAdapt.value = adapt;
    b.uKey.value = this.exposureKey; b.uThresh.value = this.threshold; b.uFloor.value = this.lumFloor;
    this.bright.to(r, this.bloomRT[0]);

    if (this.sunUp > 0.001 && this.sunScreen) {
      const g = this.ray.mat.uniforms;
      g.tSrc.value = this.bloomRT[0].texture;
      g.uSun.value.copy(this.sunScreen);
      this.ray.to(r, this.rayRT);
    }

    const bl = this.blur.mat.uniforms;
    bl.tSrc.value = this.bloomRT[0].texture;
    bl.uDir.value.set(1 / this.bw, 0);
    this.blur.to(r, this.bloomRT[1]);
    bl.tSrc.value = this.bloomRT[1].texture;
    bl.uDir.value.set(0, 1 / this.bh);
    this.blur.to(r, this.bloomRT[0]);

    // 4. composite
    const c = this.comp.mat.uniforms;
    c.tScene.value = this.sceneRT.texture;
    c.tBloom.value = this.bloomRT[0].texture;
    c.tRays.value = this.rayRT.texture;
    c.tAdapt.value = adapt;
    c.uKey.value = this.exposureKey; c.uFloor.value = this.lumFloor;
    c.uBloom.value = this.bloom;
    c.uRays.value = this.rays;
    c.uSunUp.value = this.sunUp;
    this.comp.to(r, null);

    r.toneMapping = hadTone;
  }

  dispose() {
    if (!this.on) return;
    for (const rt of [this.sceneRT, ...this.lumRT, ...this.adaptRT, ...this.bloomRT, this.rayRT]) rt.dispose();
  }
}
