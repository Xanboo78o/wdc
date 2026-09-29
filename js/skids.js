// skids.js — the marks an accident leaves on the circuit.
//
// A crash is read afterwards from the ground: two black lines from a locked
// pair of fronts running straight on into the barrier, the arcs of a spin,
// brown ruts torn across the grass where a car went off. The racing line's
// braking marks are baked into the road (render.js roadSurface); these are
// the ones YOU lay, every car on the grid, and they stay for the session.
//
// Each wheel lays a ribbon: a segment from where its contact patch was to
// where it is, whenever it is locked, spinning, sliding past the peak, or off
// the road. Segments live in one ring buffer and draw as ONE instanced call;
// the oldest are overwritten, so the cost never grows.
import * as THREE from 'three';

const MAX = 6000;
// Height above the surface they are laid on (fx.js _groundAt). ?skidlift= to
// tune; the polygon offset does the rest.
const LIFT = +(new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('skidlift') || 0.02);

const VS = /* glsl */`
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec4 iWAC;             // width, alpha, colour index (0 rubber, 1 earth), seed
  varying vec2 vQ;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vFogDepth;
  void main() {
    // position.x: 0 at A, 1 at B; position.y: -1..1 across
    vec3 d = iB - iA;
    vec3 side = normalize(vec3(-d.z, 0.0, d.x) + vec3(1e-5, 0.0, 0.0));
    vec3 p = mix(iA, iB, position.x) + side * position.y * iWAC.x * 0.5;
    vQ = vec2(position.x * length(d), position.y);
    vAlpha = iWAC.y; vKind = iWAC.z; vSeed = iWAC.w;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const FS = /* glsl */`
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying vec2 vQ;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vFogDepth;
  float h(float x) { return fract(sin(x * 91.7 + vSeed * 13.1) * 43758.5); }
  void main() {
    // a tyre lays rubber in streaks across its width (the tread blocks), and
    // the edges are soft
    float across = abs(vQ.y);
    float edge = 1.0 - smoothstep(0.55, 1.0, across);
    float streak = 0.65 + 0.35 * h(floor(vQ.y * 6.0 + 7.0));
    float grain = 0.8 + 0.2 * h(floor(vQ.x * 9.0));
    float a = vAlpha * edge * streak * grain;
    vec3 c = vKind < 0.5 ? vec3(0.012, 0.012, 0.013) : vec3(0.05, 0.035, 0.018);
    float f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    c = mix(c, fogColor, f);
    gl_FragColor = vec4(c, a * (1.0 - f));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Skids {
  constructor(scene) {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    quad.setIndex([0, 2, 1, 0, 3, 2]);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.attributes.position = quad.attributes.position;
    this.A = new Float32Array(MAX * 3);
    this.B = new Float32Array(MAX * 3);
    this.W = new Float32Array(MAX * 4);
    const ia = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('iA', this.aA = ia(this.A, 3));
    g.setAttribute('iB', this.aB = ia(this.B, 3));
    g.setAttribute('iWAC', this.aW = ia(this.W, 4));
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      // on the road, not in it: the marks sit a centimetre up and are pulled
      // forward in depth, so they never shimmer through the tarmac
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'fx.skids';
    scene.add(this.mesh);
    this.geo = g;
    this.next = 0;
    this.n = 0;
    this.lo = MAX; this.hi = -1;       // dirty range this frame
  }

  /** One segment from a to b (THREE.Vector3s), `width` m, `alpha`, kind 0 rubber / 1 earth. */
  lay(a, b, width, alpha, kind = 0) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    if (this.n < MAX) this.n++;
    this.A[i * 3] = a.x; this.A[i * 3 + 1] = a.y + LIFT; this.A[i * 3 + 2] = a.z;
    this.B[i * 3] = b.x; this.B[i * 3 + 1] = b.y + LIFT; this.B[i * 3 + 2] = b.z;
    this.W[i * 4] = width; this.W[i * 4 + 1] = alpha; this.W[i * 4 + 2] = kind; this.W[i * 4 + 3] = Math.random() * 100;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  update(fog) {
    if (fog && fog.isFogExp2) { this.mat.uniforms.fogColor.value.copy(fog.color); this.mat.uniforms.fogDensity.value = fog.density; }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.hi >= this.lo) {
      for (const a of [this.aA, this.aB, this.aW]) {
        a.clearUpdateRanges();
        a.addUpdateRange(this.lo * a.itemSize, (this.hi - this.lo + 1) * a.itemSize);
        a.needsUpdate = true;
      }
      this.lo = MAX; this.hi = -1;
    }
  }

  get count() { return this.n; }
}
