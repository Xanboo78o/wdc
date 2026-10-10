// cabin.js — the inside of the GT4, built for three shots and no more.
//
// The downloaded car is a body shell; what the film needs from in here is a
// gloved hand on a wheel, a wooden tag on a string, a wing mirror, a wet
// windscreen and two wipers. So this is a SET, in the car's own frame (x
// forward, y up, z right; the driver sits on the left, z = -0.36), sized from
// the shell's measured profile: screen base at x 0.56 / y 0.78, header at
// x -0.04 / y 1.10. While the camera is in here the shell is hidden and this
// is drawn in its place, so nothing of the shell can poke through.
//
// RAIN STAYS OUTSIDE. The drops are a layer ON the glass (a shader: beads that
// come back after each pass of the blades, and runs climbing in the airflow);
// the streaks in the air are drawn by gt.js and never inside this box.
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

function box(parent, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); parent.add(m); return m;
}
// a tapered round bar from a to b
function bar(parent, mat, a, b, r0, r1 = r0, seg = 10) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  parent.add(m); return m;
}
function ball(parent, mat, p, r) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat); m.position.copy(p); parent.add(m); return m; }

// The tag: a slip of pale wood with 78 burned into it. Never explained.
function tagTexture() {
  const c = document.createElement('canvas'); c.width = 144; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a36c'; g.fillRect(0, 0, 144, 200);
  for (let i = 0; i < 46; i++) {                       // grain
    const x = (i * 37 % 144) + Math.sin(i) * 3;
    g.strokeStyle = `rgba(${90 + (i * 13) % 40},${60 + (i * 7) % 30},30,${0.07 + (i % 5) * 0.025})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, 60, x - 5, 130, x + 3, 200); g.stroke();
  }
  const e = g.createRadialGradient(72, 100, 40, 72, 100, 130);                 // handled edges
  e.addColorStop(0, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(40,22,8,0.55)');
  g.fillStyle = e; g.fillRect(0, 0, 144, 200);
  g.fillStyle = '#1c1008'; g.beginPath(); g.arc(72, 22, 8, 0, 7); g.fill();     // the hole the string goes through
  g.fillStyle = '#2e1a0c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '400 112px Anton, "Arial Narrow", Impact, sans-serif';
  g.fillText('78', 72, 118);
  g.globalAlpha = 0.35; g.strokeStyle = '#120a04'; g.lineWidth = 2; g.strokeText('78', 72, 118);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---- the water on the glass ---------------------------------------------------
// vP is metres on the pane from its middle. Each blade wipes a sector about its
// pivot; `since()` is how long ago the blade last passed a point, in closed
// form, so the beads come back behind it and the picture is the same whenever
// it is asked for.
const GLASS_VS = `varying vec2 vP; uniform vec2 uSize;
  void main() { vP = (uv - 0.5) * uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const GLASS_FS = `precision highp float;
  varying vec2 vP;
  uniform float uT, uP, uA0, uA1; uniform vec2 uPiv1, uPiv2, uR1, uR2; uniform vec4 uTint;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float since(vec2 p, vec2 piv, vec2 rr) {
    vec2 d = p - piv; float r = length(d);
    if (r < rr.x || r > rr.y) return 99.0;
    float k = (atan(-d.x, d.y) - uA0) / (uA1 - uA0);
    if (k < 0.0 || k > 1.0) return 99.0;
    float u = acos(clamp(1.0 - 2.0 * k, -1.0, 1.0)) / 6.2831853;
    float ph = fract(uT / uP);
    return min(fract(ph - u), fract(ph - (1.0 - u))) * uP;
  }
  void main() {
    float s = min(since(vP, uPiv1, uR1), since(vP, uPiv2, uR2));
    float wet = clamp(s / (uP * 0.8), 0.0, 1.0), swept = step(s, 50.0);
    float acc = 0.0;
    for (int L = 0; L < 3; L++) {                      // beads, three sizes
      float sc = L == 0 ? 52.0 : (L == 1 ? 92.0 : 150.0);
      vec2 g = vP * sc + float(L) * 7.3, id = floor(g), f = fract(g) - 0.5;
      vec2 c = (vec2(hash(id + 11.0), hash(id + 23.0)) - 0.5) * 0.5;
      float rad = 0.15 + 0.22 * hash(id + 37.0);
      float on = step(hash(id + 3.1) * 0.62 + 0.36, wet) * step(0.38 + 0.2 * swept, hash(id + 51.0));
      vec2 q = (f - c) / rad; float d = length(q);
      float body = smoothstep(1.0, 0.75, d);
      float edge = smoothstep(0.5, 1.0, d) * body;
      float spec = smoothstep(0.55, 0.0, length(q - vec2(-0.35, 0.4)));
      acc += on * (edge * 0.5 + spec * 1.4 + body * 0.08);
    }
    float col = floor(vP.x * 36.0);                    // runs, climbing the glass in the airflow
    if (hash(vec2(col, 7.0)) > 0.6) {
      float sp = 0.10 + 0.22 * hash(vec2(col, 9.0));
      float head = fract(hash(vec2(col, 13.0)) + uT * sp) * 1.1 - 0.5;
      float dy = head - vP.y;
      float cx = fract(vP.x * 36.0) - 0.5 + 0.22 * sin(vP.y * 42.0 + col);
      float trail = smoothstep(0.17, 0.0, dy) * step(0.0, dy) * smoothstep(0.2, 0.04, abs(cx));
      float drop = smoothstep(0.006, 0.0, length(vec2(cx / 36.0, dy)) - 0.004);
      acc += (trail * 0.3 + drop * 1.3) * smoothstep(0.15, 0.5, wet);
    }
    gl_FragColor = vec4(uTint.rgb * (uTint.a * acc + 0.012 * wet), 1.0);
  }`;
function glassMaterial(w, h, wiped) {
  return new THREE.ShaderMaterial({
    vertexShader: GLASS_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uSize: { value: new THREE.Vector2(w, h) }, uT: { value: 0 }, uP: { value: WIPE.period }, uA0: { value: WIPE.a0 }, uA1: { value: WIPE.a1 },
      uPiv1: { value: new THREE.Vector2(...WIPE.piv[0]) }, uPiv2: { value: new THREE.Vector2(...WIPE.piv[1]) },
      uR1: { value: new THREE.Vector2(wiped ? 0.05 : 9, wiped ? WIPE.len[0] : 9) }, uR2: { value: new THREE.Vector2(wiped ? 0.05 : 9, wiped ? WIPE.len[1] : 9) },
      uTint: { value: new THREE.Vector4(1, 1, 1, 0.5) },
    },
  });
}
// the wipers: two blades in tandem, parked pointing right, sweeping up to the left
export const WIPE = { period: 1.25, a0: -1.36, a1: 0.12, piv: [[-0.32, -0.335], [0.3, -0.335]], len: [0.56, 0.46] };
export const wipeAngle = T => WIPE.a0 + (WIPE.a1 - WIPE.a0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * T / WIPE.period));

// where things are, for gt.js and gt-plan.js to agree on
export const CAB = {
  wheel: [0.02, 0.76, -0.36], wheelR: 0.16, tilt: 20 * Math.PI / 180,
  tagPivot: [-0.03, 1.045, 0.03], mirror: [0.44, 0.885, -1.03],
  box: { x0: -1.7, x1: 0.66, z: 0.96, y: 1.22 },            // nothing that falls is ever drawn in here
};

export class Cabin {
  constructor() {
    const G = this.group = new THREE.Group(); G.name = 'cabin'; G.visible = false;
    const trim = std(0x0a0b0c, { roughness: 0.95 }), soft = std(0x131418), cage = std(0x3c3e42, { roughness: 0.55, metalness: 0.5 });
    const red = new THREE.MeshPhysicalMaterial({ color: 0xc8161a, roughness: 0.34, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });

    // ---- the shell, from inside -------------------------------------------------
    box(G, soft, 0.46, 0.33, 1.62, 0.35, 0.6, 0);                       // dashboard, top at 0.765
    box(G, trim, 0.11, 0.055, 0.3, 0.2, 0.79, -0.36);                   // the binnacle
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.34, 0.1), toneMapped: false }));
    disp.position.set(0.143, 0.79, -0.36); disp.rotation.y = -Math.PI / 2; G.add(disp); this.disp = disp;   // a strip of amber light, no figures
    for (const s of [-1, 1]) {
      bar(G, trim, V(0.58, 0.77, s * 0.76), V(-0.05, 1.115, s * 0.61), 0.045, 0.04, 8);                  // A-pillar
      bar(G, cage, V(0.42, 0.5, s * 0.7), V(-0.12, 1.085, s * 0.56), 0.02, 0.02, 8);                     // the cage's front leg
      box(G, trim, 1.9, 0.52, 0.07, -0.36, 0.545, s * 0.9);                                              // door, sill at 0.805
      box(G, trim, 1.5, 0.05, 0.1, -0.82, 1.12, s * 0.6);                                                // roof rail
    }
    bar(G, cage, V(-0.12, 1.085, -0.56), V(-0.12, 1.085, 0.56), 0.02, 0.02, 8);
    box(G, trim, 0.12, 0.045, 1.26, -0.08, 1.128, 0);                   // header
    box(G, trim, 1.5, 0.02, 1.3, -0.82, 1.15, 0);                       // roof: whole, from one side to the other
    box(G, trim, 0.03, 1.0, 1.8, -1.6, 0.65, 0);                        // the bulkhead behind
    box(G, trim, 2.3, 0.02, 1.8, -0.45, 0.28, 0);                       // floor
    box(G, soft, 0.9, 0.3, 0.22, -0.3, 0.43, 0);                        // tunnel
    // the bonnet, out through the glass: the hero's red, falling away to the nose
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.7, 1, 1), red);
    hood.geometry.rotateX(-Math.PI / 2); hood.position.set(1.3, 0.665, 0); hood.rotation.z = -0.135; G.add(hood);
    for (const s of [-1, 1]) box(G, red, 1.5, 0.3, 0.05, 1.3, 0.52, s * 0.86).rotation.z = -0.135;      // wing tops, seen past the mirror

    // ---- the wheel, and the hands on it -----------------------------------------
    // local frame of the wheel: X = car right, Z = along the column toward the driver, Y = up the wheel's face
    const col = new THREE.Group(), a = CAB.tilt;
    col.position.fromArray(CAB.wheel);
    col.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(Math.sin(a), Math.cos(a), 0), V(-Math.cos(a), Math.sin(a), 0)));
    G.add(col);
    bar(col, trim, V(0, 0, -0.02), V(0, 0, -0.34), 0.028);            // the column
    const spin = this.spin = new THREE.Group(); col.add(spin);
    const grip = std(0x34363b, { roughness: 0.9 }), R = CAB.wheelR;
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.0165, 10, 44), grip));
    box(spin, std(0xd8b21c, { roughness: 0.6 }), 0.02, 0.012, 0.036, 0, R, 0);          // the straight-ahead mark at twelve
    box(spin, trim, 2 * R - 0.02, 0.034, 0.012, 0, 0, -0.004); box(spin, trim, 0.034, R - 0.01, 0.012, 0, -R / 2, -0.004);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), trim); hub.rotation.x = Math.PI / 2; spin.add(hub);
    const glove = std(0xd9d5cc, { roughness: 0.8 }), pad = std(0x1d1e22, { roughness: 0.9 }), cuff = std(0xc2191c, { roughness: 0.7 }), suit = std(0x3a0d10, { roughness: 0.95 });
    for (const s of [1, -1]) {                                           // right hand at three, left at nine
      const H = new THREE.Group(); H.scale.x = s; spin.add(H);
      ball(H, glove, V(R + 0.03, 0, 0.024), 1).scale.set(0.024, 0.047, 0.044);         // the back of the hand, outside the rim
      ball(H, pad, V(R + 0.047, 0, 0.022), 1).scale.set(0.011, 0.032, 0.026);          // the knuckle guard
      for (const y of [-0.0325, -0.011, 0.0105, 0.032]) {
        bar(H, glove, V(R + 0.035, y, -0.004), V(R + 0.018, y, -0.03), 0.0115, 0.011);          // out over the rim
        bar(H, glove, V(R + 0.018, y, -0.03), V(R - 0.022, y, -0.028), 0.011, 0.0102);          // across the far side
        bar(H, glove, V(R - 0.022, y, -0.028), V(R - 0.03, y, -0.008), 0.0102, 0.0096);         // and curling home
        ball(H, glove, V(R + 0.018, y, -0.03), 0.0115); ball(H, glove, V(R - 0.022, y, -0.028), 0.0105); ball(H, glove, V(R - 0.03, y, -0.008), 0.0096);
        ball(H, pad, V(R + 0.036, y, -0.004), 0.0125);                                         // knuckles
      }
      bar(H, glove, V(R + 0.022, 0.05, 0.03), V(R - 0.012, 0.062, 0.016), 0.0135, 0.012);       // the thumb, hooked over the rim
      ball(H, glove, V(R - 0.012, 0.062, 0.016), 0.012);
      const wrist = V(R + 0.036, -0.012, 0.064), elbow = V(0.24, -0.26, 0.25);
      bar(H, glove, V(R + 0.03, -0.004, 0.04), wrist, 0.03, 0.029, 14);                         // the glove's own wrist
      bar(H, cuff, wrist, wrist.clone().lerp(elbow, 0.1), 0.031, 0.032, 14);                    // a red cuff
      bar(H, suit, wrist.clone().lerp(elbow, 0.1), elbow, 0.032, 0.046, 14);                    // the sleeve
    }

    // ---- the mirror, the string, the tag ----------------------------------------
    box(G, trim, 0.025, 0.05, 0.18, -0.02, 1.075, 0.02);
    const sw = this.swing = new THREE.Group(); sw.position.fromArray(CAB.tagPivot); G.add(sw);
    bar(sw, std(0xd8d2c4, { roughness: 1 }), V(0, 0, 0), V(0, -0.088, 0), 0.0013, 0.0013, 5);
    const wood = std(0xffffff, { map: tagTexture(), roughness: 0.75 }), end = std(0xa9834f, { roughness: 0.8 });
    const tag = this.tag = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.062, 0.0445), [wood, wood, end, end, end, end]);
    tag.position.set(0, -0.113, 0); sw.add(tag);

    // ---- the wing mirror (driver's side) ----------------------------------------
    const mc = this.mirrorCanvas = document.createElement('canvas'); mc.width = 256; mc.height = 176;
    this.mirrorTex = new THREE.CanvasTexture(mc); this.mirrorTex.colorSpace = THREE.SRGBColorSpace;
    const M = CAB.mirror;
    const house = new THREE.Group(); house.position.set(M[0], M[1], M[2]); house.rotation.y = -1.13; G.add(house);   // its face turned to the driver's eye
    box(house, trim, 0.2, 0.135, 0.06, 0, 0, -0.034);
    bar(G, trim, V(M[0] + 0.03, M[1] - 0.05, M[2] + 0.03), V(M[0] + 0.1, M[1] - 0.09, -0.9), 0.014);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.176, 0.118), new THREE.MeshBasicMaterial({ map: this.mirrorTex, toneMapped: false, color: new THREE.Color(2.4, 2.4, 2.4) }));
    face.position.z = 0.001; house.add(face);
    this.mirrorDrawn = -1;

    // ---- glass: the screen, its blades, and the driver's window -----------------
    const base = V(0.56, 0.775, 0), top = V(-0.04, 1.105, 0), u = top.clone().sub(base), H = u.length(); u.normalize();
    const pane = new THREE.Group();
    pane.position.copy(base).addScaledVector(u, H / 2);
    pane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), u, V(0, 0, 1).cross(u)));
    G.add(pane);
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1.44, H), glassMaterial(1.44, H, true)); this.screen.renderOrder = 8; pane.add(this.screen);
    const rubber = std(0x050506, { roughness: 0.7 });
    this.blades = WIPE.piv.map((p, i) => {
      const g = new THREE.Group(); g.position.set(p[0], p[1], -0.014); pane.add(g);
      box(g, rubber, 0.026, WIPE.len[i] - 0.06, 0.008, 0, WIPE.len[i] / 2 + 0.03, 0);
      box(g, rubber, 0.014, WIPE.len[i] * 0.62, 0.014, 0.016, WIPE.len[i] * 0.31, -0.01);
      return g;
    });
    this.side = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.3), glassMaterial(1.3 * 2.2, 0.3 * 2.2, false));   // finer beads: this pane is half a metre from the lens
    this.side.position.set(0.0, 0.955, -0.905); this.side.renderOrder = 8; G.add(this.side);
    const side2 = new THREE.Mesh(this.side.geometry, this.side.material); side2.position.set(0, 0.955, 0.905); side2.renderOrder = 8; G.add(side2);
  }

  /**
   * T seconds; wheel = radians of lock at the rim (left positive); drops = [r, g, b, gain] of the light
   * the water is catching; mirrorGap = metres to the lamps behind (null = the mirror is not in shot).
   */
  update({ T, wheel = 0, drops = [1, 1, 1, 0.5], mirrorGap = null, mirrorOn = 1 }) {
    this.spin.rotation.z = wheel;
    // a pendulum 11 cm long swings at 1.5 Hz; the car never lets it settle
    const th = 0.21 * Math.sin(2 * Math.PI * 1.5 * T) * (0.72 + 0.28 * Math.sin(T * 0.83 + 1)) + 0.05 * Math.sin(T * 4.1);
    this.swing.rotation.x = th; this.swing.rotation.z = 0.06 * Math.sin(2 * Math.PI * 1.5 * T + 1.3);
    this.tag.rotation.y = 0.22 * Math.sin(T * 2.3 + 0.5);
    const a = wipeAngle(T);
    for (const b of this.blades) b.rotation.z = a;
    for (const m of [this.screen, this.side]) { m.material.uniforms.uT.value = T; m.material.uniforms.uTint.value.set(drops[0], drops[1], drops[2], drops[3]); }
    this.side.material.uniforms.uTint.value.w = drops[3] * 0.3;
    if (mirrorGap != null) this.paintMirror(mirrorGap, mirrorOn, T);
  }

  // What the mirror shows: the wet road behind, the car's own flank, and two cold lamps.
  paintMirror(gap, on, T) {
    const c = this.mirrorCanvas, g = c.getContext('2d'), W = c.width, H = c.height, hy = 0.4 * H, vx = 0.4 * W;
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const sky = g.createLinearGradient(0, 0, 0, hy); sky.addColorStop(0, '#05080d'); sky.addColorStop(1, '#0d131d');
    g.fillStyle = sky; g.fillRect(0, 0, W, hy);
    g.fillStyle = '#020304';                               // the trees, closing on the vanishing point
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(vx, hy);
      for (let i = 0; i <= 14; i++) { const k = i / 14, x = vx + s * (6 + k * k * W * 0.9), y = hy - 3 - k * H * 0.5 - ((i * 7919) % 5) * (1 + k * 4); g.lineTo(x, y); }
      g.lineTo(vx + s * W, hy); g.closePath(); g.fill();
    }
    const road = g.createLinearGradient(0, hy, 0, H); road.addColorStop(0, '#0a0c10'); road.addColorStop(1, '#040507');
    g.fillStyle = road; g.fillRect(0, hy, W, H - hy);
    g.fillStyle = 'rgba(190,200,215,0.07)';                // the white line at the road's edge
    g.beginPath(); g.moveTo(vx - 5, hy); g.lineTo(vx - 4, hy); g.lineTo(-0.1 * W, H); g.lineTo(-0.16 * W, H); g.fill();
    // the lamps: bigger and further apart as they come
    const k = 13 / Math.max(6, gap), cx = vx + 3 + 10 * k, cy = hy + 4 + 0.1 * H * k, sep = 0.33 * W * k, rad = 1.1 + 0.034 * W * k;
    g.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) {
      const x = cx + s * sep / 2;
      const refl = g.createLinearGradient(0, cy, 0, cy + (0.2 + 0.5 * k) * H);     // each lamp again, drawn down the wet road
      refl.addColorStop(0, `rgba(150,190,255,${0.5 * on})`); refl.addColorStop(1, 'rgba(150,190,255,0)');
      g.fillStyle = refl; g.fillRect(x - rad * 0.8, cy, rad * 1.6, (0.2 + 0.5 * k) * H);
      const halo = g.createRadialGradient(x, cy, 0, x, cy, rad * 4.5);
      halo.addColorStop(0, `rgba(240,248,255,${on})`); halo.addColorStop(0.22, `rgba(190,215,255,${0.9 * on})`);
      halo.addColorStop(0.45, `rgba(120,165,255,${0.28 * on})`); halo.addColorStop(1, 'rgba(90,140,255,0)');
      g.fillStyle = halo; g.fillRect(x - rad * 4.5, cy - rad * 4.5, rad * 9, rad * 9);
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#1c0405';                               // his own flank down the inner edge
    g.beginPath(); g.moveTo(W, 0.24 * H); g.lineTo(0.84 * W, 0.42 * H); g.lineTo(0.76 * W, H); g.lineTo(W, H); g.fill();
    g.strokeStyle = `rgba(150,180,235,${0.22 * on * k})`; g.lineWidth = 2;        // the cold light finding its edge
    g.beginPath(); g.moveTo(W, 0.24 * H); g.lineTo(0.84 * W, 0.42 * H); g.lineTo(0.76 * W, H); g.stroke();
    for (let i = 0; i < 60; i++) {                         // water on the mirror glass
      const x = (i * 97 + 13) % W, y0 = (i * 57 + 29) % H, y = (y0 + ((i % 7) === 0 ? T * 14 : 0)) % H, r = 1 + (i % 4) * 0.6;
      g.fillStyle = `rgba(170,195,235,${0.1 + (i % 3) * 0.05})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    this.mirrorTex.needsUpdate = true;
  }
}
