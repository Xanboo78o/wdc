// dashcam.js — the DASHCAM camera: 350 km/h filmed the way the internet has
// seen real speed filmed.
//
// Adam, 2026-09-29: "use all the tricks the game DASHCAM uses to make 350 feel
// like 350". Footage that reads as REAL speed is almost never a cinema camera —
// it is a cheap wide lens bolted to a car. Every trick here is one of that
// camera's faults, because the faults are what the brain has learned to trust:
//
//   1. ULTRA-WIDE, BARREL-DISTORTED LENS. The scene is rendered wide and bent
//      so the centre is magnified and the edges are crushed. Things ahead look
//      normal-sized and then smear outward across the frame as they pass — the
//      periphery moves several times faster than it would through a rectilinear
//      lens. This is the single biggest speed cue in dashcam footage.
//   2. A RIGID MOUNT. A suction cup has no neck and no damping: every road
//      frequency arrives in the picture (speedfx.js 'dashcam' mount).
//   3. ROLLING SHUTTER. A phone/dashcam sensor reads rows top to bottom, so a
//      vibrating camera wobbles like jelly and a yawing one leans verticals.
//   4. BITRATE STARVATION. The encoder has a fixed budget; when the whole frame
//      moves at speed it cannot keep up and the fast-moving edges break into
//      blocks. Viewers read that breakup as "this was going VERY fast".
//   5. EXPOSURE THAT HUNTS, blown highlights, oversharpening halos, colour
//      fringing at the edge of cheap glass, vignette, a little sensor noise.
//   6. THE BURNT-IN STAMP: date, time and GPS speed. A number in the corner
//      that says 350 is a surprisingly strong instruction to the eye.
//
// All of it is one full-screen pass over the finished frame (the same
// copy-the-canvas pattern as speedfx.js SpeedBlur), active only while the
// DASHCAM rig is selected. ?dash.lens= ?dash.blocks= ?dash.shutter= ?dash.grade=
// scale each fault (0 turns one off), ?dash=0 disables the pass entirely.
import * as THREE from 'three';
import { SPEEDSOUND } from './speedsound.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const knob = (k, d) => { const v = Q.get('dash.' + k); return v == null ? d : Math.max(0, parseFloat(v) || 0); };
export const DASH = {
  on: Q.get('dash') !== '0',
  lens: knob('lens', 1), blocks: knob('blocks', 1), shutter: knob('shutter', 1), grade: knob('grade', 1),
};

// The rendered field of view. Wide on purpose: the barrel pass crushes the
// edges back in, so what you see is ~118 degrees across on a 16:9 screen.
export const DASH_FOV = 84;

const FRAG = `
precision highp float;
uniform sampler2D tFrame;
uniform sampler2D tDepth;
uniform float uHasDepth, uNear, uFar;
uniform vec2 uRes;
uniform float uTime, uSpeed, uLens, uBlocks, uShutter, uGrade, uGain, uYawRate, uFrame;
uniform vec2 uJit;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// output -> source: barrel. k>0 pulls the edges in from further out.
vec2 warp(vec2 uv, float k) {
  vec2 p = uv * 2.0 - 1.0;
  float asp = uRes.x / uRes.y;
  p.x *= asp;
  float r2 = dot(p, p);
  float rc2 = asp * asp + 1.0;                       // the corner, so corners stay corners
  p *= (1.0 + k * r2) / (1.0 + k * rc2);
  p.x /= asp;
  return p * 0.5 + 0.5;
}

vec3 grab(vec2 uv) { return texture2D(tFrame, clamp(uv, 0.0005, 0.9995)).rgb; }

void main() {
  vec2 uv = vUv;
  // ---- rolling shutter: rows read top to bottom while the camera moves
  float row = 1.0 - uv.y;
  uv.x += uShutter * (uJit.x * sin(row * 9.0 + uTime * 61.0) + uYawRate * (row - 0.5) * 0.012);
  uv.y += uShutter * uJit.y * sin(row * 5.0 + uTime * 47.0);

  // ---- bitrate starvation: at speed the fast-moving edges go to blocks
  vec2 px = uv * uRes;
  float B = 16.0;
  vec2 blk = floor(px / B);
  vec2 c = uv * 2.0 - 1.0;
  float motion = uSpeed * smoothstep(0.25, 1.1, length(c * vec2(1.0, 0.8)));
  float h = hash(blk + floor(uFrame * 0.5) * 7.13);
  float starve = uBlocks * step(h, motion * 0.3);
  // Your own car does not move relative to a camera bolted to it, so the
  // encoder never starves there: nothing nearer than 4 m breaks up.
  if (uHasDepth > 0.5) {
    float d = texture2D(tDepth, warp(uv, 0.34 * uLens)).x;
    float z = uNear * uFar / (uFar - d * (uFar - uNear));
    starve *= step(4.0, z);
  }
  vec2 bc = (blk + 0.5) * B / uRes;
  vec2 duv = uv;

  // ---- the lens: barrel + colour fringing at the edges of cheap glass
  float k = 0.34 * uLens;
  float r2 = dot(c, c);
  float ca = 0.0022 * uLens * r2;
  vec3 col;
  col.r = grab(warp(duv, k * (1.0 + ca * 18.0))).r;
  col.g = grab(warp(duv, k)).g;
  col.b = grab(warp(duv, k * (1.0 - ca * 18.0))).b;

  // ---- oversharpening: the camera's own "detail" setting, with halos
  vec2 wv = warp(duv, k);
  vec2 o = 1.25 / uRes;
  vec3 blur = (grab(wv + vec2(o.x, 0.0)) + grab(wv - vec2(o.x, 0.0)) + grab(wv + vec2(0.0, o.y)) + grab(wv - vec2(0.0, o.y))) * 0.25;
  col += (col - blur) * 0.55 * uGrade * (1.0 - starve);
  // starved blocks lose colour resolution too
  // A starved block is what the encoder could afford: its own average, a
  // flat tile smeared a little along its motion, colour resolution gone.
  if (starve > 0.0) {
    vec2 q = B * 0.25 / uRes, sm = (bc - 0.5) * 0.006 * uSpeed;
    vec3 avg = (grab(warp(bc + vec2(-q.x, -q.y) + sm, k)) + grab(warp(bc + vec2(q.x, -q.y) + sm, k))
              + grab(warp(bc + vec2(-q.x, q.y) + sm, k)) + grab(warp(bc + vec2(q.x, q.y) + sm, k))) * 0.25;
    col = mix(col, floor(avg * 20.0 + 0.5) / 20.0, starve * 0.85);
  }

  // ---- exposure that hunts, highlights that clip hard
  col *= mix(1.0, uGain, uGrade);
  col = mix(col, min(col * 1.06, vec3(1.0)), uGrade);
  // cheap-sensor grade: a touch cool, a touch flat in the mids, crushed blacks
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(l), col, 0.88) * vec3(0.97, 1.0, 1.04), uGrade);
  col = mix(col, max(col - 0.02, 0.0) * 1.02, uGrade);

  // ---- vignette and sensor noise (the noise lives in the shadows)
  float vig = 1.0 - 0.38 * uLens * smoothstep(0.35, 1.45, length(c * vec2(uRes.x / uRes.y * 0.62, 1.0)));
  col *= vig;
  float n = hash(px + fract(uTime * 13.7) * 311.0) - 0.5;
  col += n * 0.035 * uGrade * (1.0 - smoothstep(0.0, 0.5, l));

  gl_FragColor = vec4(col, 1.0);
}`;

export class Dashcam {
  constructor(renderer) {
    this.r = renderer;
    this.tex = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tFrame: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 }, uSpeed: { value: 0 }, uLens: { value: DASH.lens }, uBlocks: { value: DASH.blocks },
        uShutter: { value: DASH.shutter }, uGrade: { value: DASH.grade }, uGain: { value: 1 },
        uYawRate: { value: 0 }, uFrame: { value: 0 }, uJit: { value: new THREE.Vector2() },
        tDepth: { value: null }, uHasDepth: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.gain = 1; this.gainT = 1; this.hunt = 0; this.frame = 0; this.t = 0;
    this.stamp = null;
  }

  /**
   * After the frame is on the canvas. car = physics car, dt real seconds,
   * shake = speedfx SpeedShake output (radians) for the jelly, geo = the
   * circuit survey's {lat0, lon0} (null on a fictional circuit: no GPS).
   */
  render(car, dt, shake, geo, depth = null, camera = null) {
    if (!DASH.on) return;
    const r = this.r;
    const size = r.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2()));
    const W = size.x | 0, H = size.y | 0;
    if (!this.tex || this.tex.image.width !== W || this.tex.image.height !== H) {
      if (this.tex) this.tex.dispose();
      this.tex = new THREE.FramebufferTexture(W, H);
    }
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.tex, null);

    this.t += dt; this.frame++;
    const kmh = car.speed * 3.6;
    // exposure hunting: a lagged random walk, lurching harder at speed and
    // after a big change in pitch (sky <-> road), clamped to a real camera's
    // half a stop either way.
    this.hunt -= dt;
    if (this.hunt <= 0) { this.gainT = 1 + (Math.random() - 0.5) * 0.22; this.hunt = 0.6 + Math.random() * 1.6; }
    this.gain += (this.gainT - this.gain) * Math.min(1, dt * 2.2);

    const u = this.mat.uniforms;
    u.tFrame.value = this.tex;
    u.uRes.value.set(W, H);
    u.uTime.value = this.t;
    u.uFrame.value = this.frame;
    u.uSpeed.value = Math.min(1.2, Math.max(0, (kmh - 60) / 290));
    u.uGain.value = this.gain;
    u.tDepth.value = depth; u.uHasDepth.value = depth && camera ? 1 : 0;
    if (camera) { u.uNear.value = camera.near; u.uFar.value = camera.far; }
    u.uYawRate.value = Math.max(-2, Math.min(2, car.r || 0)) * 6;
    // the jelly: the mount's own high-frequency shake, magnified by row skew
    const s = shake || { p: 0, y: 0 };
    u.uJit.value.set(Math.min(0.004, Math.abs(s.y) * 0.9 + kmh * 0.000006), Math.min(0.003, Math.abs(s.p) * 0.6));

    const auto = r.autoClear; r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = auto;
    // bakeenv.mjs's projection: x metres east, y metres north of the origin
    const at = geo ? { lat: geo.lat0 + car.y / 110540,
                       lon: geo.lon0 + car.x / (111320 * Math.cos(geo.lat0 * Math.PI / 180)) } : null;
    this._stamp(true, kmh, at);
  }

  /** The burnt-in overlay. Hidden whenever the DASHCAM rig is not in use. */
  _stamp(on, kmh = 0, at = null) {
    if (typeof document === 'undefined') return;
    if (!this.stamp) {
      const el = document.createElement('div');
      el.id = 'dashStamp';
      el.style.cssText = 'position:fixed;left:18px;bottom:14px;z-index:30;pointer-events:none;'
        + 'font:600 17px/1.25 "DejaVu Sans Mono",Menlo,Consolas,monospace;color:#f4f4f0;letter-spacing:.04em;'
        + 'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;white-space:pre';
      document.body.appendChild(el);
      this.stamp = el;
    }
    this.stamp.style.display = on ? '' : 'none';
    // a cheap action-camera mic: at speed the wind is most of what it hears
    SPEEDSOUND.mic = on && DASH.on ? 2.4 : 1;
    if (typeof document !== 'undefined') document.body.classList.toggle('dashcam', !!on);
    if (!on) return;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const gps = at ? `  ${at.lat >= 0 ? 'N' : 'S'}${Math.abs(at.lat).toFixed(5)} ${at.lon >= 0 ? 'E' : 'W'}${Math.abs(at.lon).toFixed(5)}` : '';
    this.stamp.textContent = `${ts}  ${String(Math.round(kmh)).padStart(3, ' ')} KM/H${gps}\nXBR-CAM 01  1080P  ●REC`;
  }

  hide() { this._stamp(false); }
}
