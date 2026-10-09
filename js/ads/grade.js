// grade.js — the lens and the lab, for the adverts only.
//
// The game's own post chain (js/post.js) meters the frame and ADAPTS, which is
// right for a driver and wrong for a film: second 12 has to look the same
// whenever it is asked for. This one is a pure function of the frame:
//
//   scene (linear HDR, MSAA)  ->  half-res soft copy  ->  bloom pyramid
//   composite: depth of field from the soft copy, bloom, a touch of chromatic
//   fringing at the edges, exposure, ACES, a three-way grade, vignette, grain,
//   a fade and the 2.39:1 bars.
import * as THREE from 'three';

const QUAD = new THREE.PlaneGeometry(2, 2);
const FLAT = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

class Pass {
  constructor(frag, uniforms) {
    this.u = uniforms;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms, depthTest: false, depthWrite: false,
      vertexShader: `in vec3 position; in vec2 uv; out vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `precision highp float; precision highp sampler2D;
        in vec2 vUv; out vec4 o;\n` + frag,
    });
    this.scene = new THREE.Scene();
    const m = new THREE.Mesh(QUAD, this.mat); m.frustumCulled = false;
    this.scene.add(m);
  }
  to(r, target) { r.setRenderTarget(target || null); r.render(this.scene, FLAT); }
}

const rt = (w, h, o = {}) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...o,
});
const u = v => ({ value: v });

export const GRADES = {
  // teal in the shadows, amber on top, crushed a little: the trailer
  film: { contrast: 1.12, sat: 1.08, lift: [-0.012, -0.004, 0.012], gain: [1.05, 1.0, 0.94], vignette: 0.42, grain: 0.03, fringe: 0.0011, bloom: 0.62, threshold: 1.25 },
  cold: { contrast: 1.15, sat: 0.92, lift: [-0.016, -0.004, 0.02], gain: [0.94, 1.0, 1.08], vignette: 0.5, grain: 0.04, fringe: 0.0013, bloom: 0.95, threshold: 0.95 },
  // a television camera on a tripod: honest, a bit flat
  plain: { contrast: 1.0, sat: 1.0, lift: [0, 0, 0], gain: [1, 1, 1], vignette: 0.16, grain: 0.012, fringe: 0.0, bloom: 0.35, threshold: 1.3 },
};

export class Grade {
  constructor(renderer, { msaa = 4 } = {}) {
    this.r = renderer;
    this.msaa = msaa;
    this.sceneRT = rt(1, 1, { depthBuffer: true, samples: msaa });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.half = [rt(1, 1), rt(1, 1)];
    this.quarter = [rt(1, 1), rt(1, 1)];
    this.eighth = [rt(1, 1), rt(1, 1)];
    this.size = new THREE.Vector2(1, 1);

    this.down = new Pass(`uniform sampler2D t; uniform vec2 px;
      void main() {
        vec3 c = texture(t, vUv + px * vec2(-0.5, -0.5)).rgb + texture(t, vUv + px * vec2(0.5, -0.5)).rgb
               + texture(t, vUv + px * vec2(-0.5, 0.5)).rgb + texture(t, vUv + px * vec2(0.5, 0.5)).rgb;
        o = vec4(min(c * 0.25, vec3(64.0)), 1.0);
      }`, { t: u(null), px: u(new THREE.Vector2()) });
    this.bright = new Pass(`uniform sampler2D t; uniform float thr;
      void main() {
        vec3 c = texture(t, vUv).rgb;
        float l = max(c.r, max(c.g, c.b));
        float k = max(l - thr, 0.0) / max(l, 1e-4);
        o = vec4(min(c * k, vec3(24.0)), 1.0);
      }`, { t: u(null), thr: u(1) });
    this.blur = new Pass(`uniform sampler2D t; uniform vec2 d;
      void main() {
        vec3 c = texture(t, vUv).rgb * 0.227027;
        c += (texture(t, vUv + d * 1.3846).rgb + texture(t, vUv - d * 1.3846).rgb) * 0.316216;
        c += (texture(t, vUv + d * 3.2308).rgb + texture(t, vUv - d * 3.2308).rgb) * 0.070270;
        o = vec4(c, 1.0);
      }`, { t: u(null), d: u(new THREE.Vector2()) });

    this.comp = new Pass(`
      uniform sampler2D tScene, tSoft, tBloomA, tBloomB, tDepth;
      uniform vec2 uPx; uniform float uNear, uFar;
      uniform float uExposure, uBloom, uContrast, uSat, uVignette, uGrain, uFringe, uFade, uBars, uTime, uFlash;
      uniform float uFocus, uFocusRange, uDof, uAspect, uStreak;
      uniform vec3 uLift, uGain;
      float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      // ACES (Stephen Hill's fit) — the same curve three.js calls ACESFilmic
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        c = inM * (c / 0.6); c = RRTAndODTFit(c); c = outM * c; return clamp(c, 0.0, 1.0);
      }
      float viewZ(vec2 uv) { float d = texture(tDepth, uv).r; float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
      vec3 sharp(vec2 uv) { return texture(tScene, uv).rgb; }
      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
        vec2 fr = c * uFringe * (0.3 + r2 * 1.6);
        vec3 s = vec3(sharp(vUv + fr).r, sharp(vUv).g, sharp(vUv - fr).b);
        vec3 soft = texture(tSoft, vUv).rgb;
        // depth of field: how far this pixel is from the plane the lens is on
        float z = viewZ(vUv);
        float coc = clamp(abs(z - uFocus) / max(uFocusRange, 0.01) - 0.35, 0.0, 1.0) * uDof;
        // a near-blurred thing bleeds over what is behind it: take the soft copy's word a little
        vec3 col = mix(s, soft, smoothstep(0.0, 1.0, coc));
        vec3 bloom = texture(tBloomA, vUv).rgb * 0.62 + texture(tBloomB, vUv).rgb * 0.5;
        // a horizontal smear of the widest bloom: the anamorphic streak
        vec3 streak = vec3(0.0);
        if (uStreak > 0.0) {
          for (int i = -6; i <= 6; i++) streak += texture(tBloomB, vUv + vec2(float(i) * 0.022, 0.0)).rgb * (1.0 - abs(float(i)) / 7.0);
          streak *= vec3(0.55, 0.75, 1.25) * 0.11 * uStreak;
        }
        col += (bloom + streak) * uBloom;
        col *= uExposure;
        col = aces(col);
        col = pow(col, vec3(1.0 / 2.2));
        // the grade, in display space
        col = (col - 0.5) * uContrast + 0.5;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = col * uGain + uLift * (1.0 - l);
        col *= 1.0 - uVignette * smoothstep(0.12, 0.95, r2 * 1.5);
        col += (hash(gl_FragCoord.xy + fract(uTime * 7.31) * 913.0) - 0.5) * uGrain;
        col = mix(col, vec3(1.0), uFlash);
        col *= uFade;
        float bar = step(abs(c.y), 0.5 - uBars);
        o = vec4(clamp(col, 0.0, 1.0) * bar, 1.0);
      }`, {
      tScene: u(null), tSoft: u(null), tBloomA: u(null), tBloomB: u(null), tDepth: u(null),
      uPx: u(new THREE.Vector2()), uNear: u(0.3), uFar: u(12000),
      uExposure: u(1), uBloom: u(0.8), uContrast: u(1), uSat: u(1), uVignette: u(0.4), uGrain: u(0.03),
      uFringe: u(0.002), uFade: u(1), uBars: u(0), uTime: u(0), uFlash: u(0),
      uFocus: u(20), uFocusRange: u(20), uDof: u(0), uAspect: u(16 / 9), uStreak: u(0),
      uLift: u(new THREE.Vector3()), uGain: u(new THREE.Vector3(1, 1, 1)),
    });
    this.grade = GRADES.film;
    this.fade = 1; this.flash = 0; this.bars = 0; this.dof = 0; this.focus = 20; this.focusRange = 20; this.streak = 0;
    this.exposure = 1;
  }

  setSize(w, h) {
    this.size.set(w, h);
    this.sceneRT.setSize(w, h);
    const h2 = [Math.ceil(w / 2), Math.ceil(h / 2)], h4 = [Math.ceil(w / 4), Math.ceil(h / 4)], h8 = [Math.ceil(w / 8), Math.ceil(h / 8)];
    for (const t of this.half) t.setSize(...h2);
    for (const t of this.quarter) t.setSize(...h4);
    for (const t of this.eighth) t.setSize(...h8);
    this.comp.u.uAspect.value = w / h;
  }

  render(scene, camera, time = 0) {
    const r = this.r, g = this.grade, w = this.size.x, h = this.size.y;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    this.down.u.t.value = this.sceneRT.texture; this.down.u.px.value.set(1 / w, 1 / h);
    this.down.to(r, this.half[0]);
    const blur = (src, dst, dx, dy) => { this.blur.u.t.value = src.texture; this.blur.u.d.value.set(dx, dy); this.blur.to(r, dst); };
    blur(this.half[0], this.half[1], 2 / w, 0); blur(this.half[1], this.half[0], 0, 2 / h);

    this.bright.u.t.value = this.half[0].texture; this.bright.u.thr.value = g.threshold;
    this.bright.to(r, this.quarter[0]);
    blur(this.quarter[0], this.quarter[1], 4 / w, 0); blur(this.quarter[1], this.quarter[0], 0, 4 / h);
    this.down.u.t.value = this.quarter[0].texture; this.down.u.px.value.set(4 / w, 4 / h);
    this.down.to(r, this.eighth[0]);
    for (let k = 0; k < 2; k++) { blur(this.eighth[0], this.eighth[1], 8 / w, 0); blur(this.eighth[1], this.eighth[0], 0, 8 / h); }

    const c = this.comp.u;
    c.tScene.value = this.sceneRT.texture; c.tSoft.value = this.half[0].texture;
    c.tBloomA.value = this.quarter[0].texture; c.tBloomB.value = this.eighth[0].texture;
    c.tDepth.value = this.sceneRT.depthTexture;
    c.uNear.value = camera.near; c.uFar.value = camera.far;
    c.uExposure.value = this.exposure; c.uBloom.value = g.bloom;
    c.uContrast.value = g.contrast; c.uSat.value = g.sat; c.uVignette.value = g.vignette;
    c.uGrain.value = g.grain; c.uFringe.value = g.fringe;
    c.uLift.value.set(...g.lift); c.uGain.value.set(...g.gain);
    c.uFade.value = this.fade; c.uFlash.value = this.flash; c.uBars.value = this.bars; c.uTime.value = time;
    c.uFocus.value = this.focus; c.uFocusRange.value = this.focusRange; c.uDof.value = this.dof; c.uStreak.value = this.streak;
    this.comp.to(r, null);
  }
}
