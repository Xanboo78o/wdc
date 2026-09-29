// sparks.js — titanium on tarmac.
//
// Where they come from (all decided in fx.js, from real car state): the plank
// and skid blocks bottoming over a bump at speed, a kerb struck flat out,
// bodywork grinding along a wall, a hard landing, a car on its roof, a broken
// nose dragging on the road. Each spark is a point with a velocity; it is DRAWN
// as a streak from where it was a thirtieth of a second ago to where it is now,
// which is what a spark looks like to a camera and to an eye — a line, not a
// dot. White-hot at birth, through yellow and orange to a dull red, brighter
// than anything else on screen so the bloom catches it.
//
// One InstancedMesh, one draw call, additive; a hard cap on the pool, and
// nothing drawn when nothing is alive.
import * as THREE from 'three';

const MAX = 1600;
const SHUTTER = 1 / 30;      // s — the streak length a camera would record

const VS = /* glsl */`
  attribute vec3 iHead;
  attribute vec3 iVel;
  attribute vec2 iHeat;          // x = heat 1..0, y = width scale
  varying float vU;
  varying float vV;
  varying float vHeat;
  uniform float uShutter;
  uniform float uWidth;
  void main() {
    // position.x = 0 tail .. 1 head, position.y = -1..1 across
    vec3 tail = iHead - iVel * uShutter;
    vec4 A = viewMatrix * vec4(tail, 1.0);
    vec4 B = viewMatrix * vec4(iHead, 1.0);
    vec2 d = B.xy / max(0.05, -B.z) - A.xy / max(0.05, -A.z);
    float L = length(d);
    d = L > 1e-5 ? d / L : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    vec4 P = mix(A, B, position.x);
    float w = uWidth * iHeat.y * (0.5 + 0.5 * iHeat.x);
    // widen across the streak, and round the ends off by the same amount so a
    // spark seen head-on is a hot point rather than nothing
    P.xy += n * position.y * w + d * (position.x * 2.0 - 1.0) * w;
    vU = position.x; vV = position.y; vHeat = iHeat.x;
    gl_Position = projectionMatrix * P;
  }`;

const FS = /* glsl */`
  varying float vU;
  varying float vV;
  varying float vHeat;
  uniform float uGain;
  void main() {
    float across = 1.0 - vV * vV;
    float along = mix(0.25, 1.0, vU);                 // the head burns brightest
    float a = across * across * along;
    // blackbody-ish: dull red -> orange -> yellow -> near white
    vec3 c = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.0, 0.45, vHeat));
    c = mix(c, vec3(1.0, 0.92, 0.7), smoothstep(0.55, 1.0, vHeat));
    float glow = uGain * (0.35 + 1.65 * vHeat * vHeat);
    gl_FragColor = vec4(c * glow * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sparks {
  constructor(scene) {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.attributes.position = quad.attributes.position;
    this.head = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.heat = new Float32Array(MAX * 2);
    const ia = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('iHead', this.aHead = ia(this.head, 3));
    g.setAttribute('iVel', this.aVel = ia(this.vel, 3));
    g.setAttribute('iHeat', this.aHeat = ia(this.heat, 2));
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uShutter: { value: SHUTTER }, uWidth: { value: 0.012 }, uGain: { value: 9 } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'fx.sparks';
    scene.add(this.mesh);
    this.geo = g;
    // the pool, struct-of-arrays
    this.px = new Float32Array(MAX); this.py = new Float32Array(MAX); this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX); this.vy = new Float32Array(MAX); this.vz = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.max = new Float32Array(MAX);
    this.gy = new Float32Array(MAX); this.w = new Float32Array(MAX);
    this.n = 0;
  }

  /**
   * `count` sparks at (x, y, z) in three space, riding velocity (vx, vy, vz)
   * plus `spread` of scatter and `up` of lift, over ground height `gy`.
   */
  emit(count, x, y, z, vx, vy, vz, gy, { spread = 2.5, up = 2, life = 0.55, width = 1 } = {}) {
    for (let k = 0; k < count; k++) {
      let i;
      if (this.n < MAX) i = this.n++;
      else { i = (Math.random() * MAX) | 0; }       // full: overwrite anything
      this.px[i] = x + (Math.random() - 0.5) * 0.12;
      this.py[i] = y + Math.random() * 0.03;
      this.pz[i] = z + (Math.random() - 0.5) * 0.12;
      // a spark leaves the contact at most of the rubbing speed, scattered in
      // a cone — the scatter grows with speed
      const s = 0.55 + Math.random() * 0.5;
      this.vx[i] = vx * s + (Math.random() - 0.5) * spread;
      this.vy[i] = vy * s + Math.random() * up;
      this.vz[i] = vz * s + (Math.random() - 0.5) * spread;
      const L = life * (0.35 + Math.random() * 0.9);
      this.life[i] = L; this.max[i] = L;
      this.gy[i] = gy;
      this.w[i] = width * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt) {
    if (!this.n) { this.mesh.visible = false; return; }
    dt = Math.min(dt, 1 / 20);
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      let L = this.life[i] - dt;
      if (L <= 0) continue;
      let vx = this.vx[i], vy = this.vy[i] - 9.81 * dt, vz = this.vz[i];
      const drag = Math.max(0, 1 - 1.1 * dt);
      vx *= drag; vy *= drag; vz *= drag;
      let x = this.px[i] + vx * dt, y = this.py[i] + vy * dt, z = this.pz[i] + vz * dt;
      if (y < this.gy[i] && vy < 0) {
        // a spark skips off the road, losing most of its bounce and some life
        y = this.gy[i];
        vy = -vy * (0.25 + Math.random() * 0.2);
        vx *= 0.7; vz *= 0.7;
        L *= 0.8;
      }
      // compact into slot j
      this.px[j] = x; this.py[j] = y; this.pz[j] = z;
      this.vx[j] = vx; this.vy[j] = vy; this.vz[j] = vz;
      this.life[j] = L; this.max[j] = this.max[i]; this.gy[j] = this.gy[i]; this.w[j] = this.w[i];
      const h = L / this.max[j];
      this.head[j * 3] = x; this.head[j * 3 + 1] = y; this.head[j * 3 + 2] = z;
      this.vel[j * 3] = vx; this.vel[j * 3 + 1] = vy; this.vel[j * 3 + 2] = vz;
      this.heat[j * 2] = h; this.heat[j * 2 + 1] = this.w[j];
      j++;
    }
    this.n = j;
    this.geo.instanceCount = j;
    this.mesh.visible = j > 0;
    if (j) {
      for (const a of [this.aHead, this.aVel, this.aHeat]) {
        a.clearUpdateRanges(); a.addUpdateRange(0, j * a.itemSize); a.needsUpdate = true;
      }
    }
  }

  get count() { return this.n; }
}
