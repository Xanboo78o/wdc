// gt.js — the GT film. Night, rain, the Nordschleife, 72 seconds, 9:16.
//
// A GT4 (the Ginetta pack, g55 — warm, red, it has raced) defends against a
// faster GT3 (the McLaren pack, m720 — dark, spotless, patient) and loses.
// No words until the name at the end.
//
//   js/ads/gt-plan.js   WHERE everything is, shot by shot — pure maths, and the
//                       one place to change the choreography. Node runs the
//                       same file to check it (js/ads/gt-check.mjs geo).
//   js/ads/packcar.js   the two downloaded cars
//   js/ads/cabin.js     the inside of the GT4: hand, wheel, tag, mirror, wet glass
//   js/ads/score-gt.js  everything you hear (+ voices-gt.js: engine, rain, heart, fury)
//   this file           the LIGHT and the WEATHER on top of the plan: the cars'
//                       own lamps are the lighting; the road is wet and shows
//                       them back; rain falls everywhere except inside the car.
import * as THREE from 'three';
import { runFilm } from './film.js';
import { rnd, plume } from './actors.js';
import { SHOTS, DURATION, resolve, pose, local, KERB, G4, G3, clamp } from './gt-plan.js';
import { loadPack, PackCar } from './packcar.js';
import { Cabin, CAB } from './cabin.js';
import './voices-gt.js';
import { score } from './score-gt.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V(), _c = V(), _d = V(), _q = new THREE.Quaternion();

const LOOK = new URLSearchParams(location.search).get('look');
// warm yellow-white for the GT4, cold blue-white for the GT3: kept well apart, because a lamp bright enough to bloom
// goes white in the middle and only its halo and its reflection still say which car it is
const WARM = [1.0, 0.64, 0.28], COLD = [0.46, 0.7, 1.0], RED = [1.0, 0.07, 0.03];
const NIGHT = { contrast: 1.14, sat: 1.06, lift: [-0.014, -0.004, 0.018], gain: [0.97, 1.0, 1.06], vignette: 0.56, grain: 0.045, fringe: 0.0012, bloom: 0.95, threshold: 1.0 };
const INSIDE = { contrast: 1.1, sat: 1.05, lift: [-0.008, -0.004, 0.012], gain: [1.02, 1.0, 1.0], vignette: 0.62, grain: 0.05, fringe: 0.001, bloom: 0.9, threshold: 1.0 };
// one sky for the whole film: no floodlights on the Nordschleife, a little moon behind cloud
const MOOD = { lamps: 0, az: 35, sun: [0.42, 0.5, 0.62, 1.0], hemi: [0.24, [0.2, 0.26, 0.48], [0.03, 0.03, 0.05]] };

// ---------------------------------------------------------------------------
// THE WET ROAD. A lamp over wet tarmac shows twice: once where it is, and once
// as a streak drawn out along the road toward whoever is looking. These are
// those streaks: soft quads lying ON the road, rebuilt every frame, additive.
// (The surface itself is also wet — stage.js drops its roughness to 0.17 at
// night, so the headlamp spots throw real highlights on it. This is the part
// a spotlight cannot do: the lamp's own image.)
// ---------------------------------------------------------------------------
class Glints {
  constructor(scene, max = 24) {
    this.max = max; this.n = 0;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 12), 3); this.col = new THREE.BufferAttribute(new Float32Array(max * 12), 3);
    const uv = new Float32Array(max * 8), ix = [];
    for (let i = 0; i < max; i++) { uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8); ix.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3); }
    this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('color', this.col); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(ix);
    const c = document.createElement('canvas'); c.width = 32; c.height = 128;
    const x = c.getContext('2d'), id = x.createImageData(32, 128);
    for (let j = 0; j < 128; j++) for (let i = 0; i < 32; i++) {
      const a = Math.exp(-(((i - 15.5) / 6.5) ** 2)), v = j / 127, b = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.25)), 0.8) * (0.35 + 0.65 * (1 - v));
      id.data.set([255, 255, 255, 255 * a * b], (j * 32 + i) * 4);
    }
    x.putImageData(id, 0, 0);
    const map = new THREE.CanvasTexture(c); map.flipY = false;      // row 0 is the lamp's end of the streak
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.name = 'fx.glints';
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  /** A streak on the car's own ground plane from a lamp toward the camera. */
  lamp(p, lx, ly, lz, cam, col, k) {
    if (this.n >= this.max || k <= 0.01) return;
    // the camera, in the car's frame
    const c = _a.copy(cam).sub(p.pos).applyQuaternion(_q.copy(p.quat).invert());
    const dx = c.x - lx, dz = c.z - lz, D = Math.hypot(dx, dz), hc = Math.max(0.05, c.y);
    if (D < 1.2) return;
    const ux = dx / D, uz = dz / D, mid = D * ly / (ly + hc);        // where the mirror image of the lamp sits
    const a = 0.3, b = clamp(mid * 2.1, 1.6, Math.min(D * 0.5, 8)), w0 = 0.14, w1 = 0.18 + 0.03 * b;   // short: a 22 m streak toward a long lens was a white lake
    k *= 0.6 / (1 + b / 8);
    const P = this.pos.array, C = this.col.array, i = this.n++;
    const put = (j, along, side) => { local(p, lx + ux * along - uz * side, 0.03, lz + uz * along + ux * side, _b); P[(i * 4 + j) * 3] = _b.x; P[(i * 4 + j) * 3 + 1] = _b.y; P[(i * 4 + j) * 3 + 2] = _b.z; };
    put(0, a, -w0); put(1, a, w0); put(2, b, w1); put(3, b, -w1);
    for (let j = 0; j < 4; j++) { C[(i * 4 + j) * 3] = col[0] * k; C[(i * 4 + j) * 3 + 1] = col[1] * k; C[(i * 4 + j) * 3 + 2] = col[2] * k; }
  }
  end() { this.pos.needsUpdate = this.col.needsUpdate = true; this.geo.setDrawRange(0, this.n * 6); this.mesh.visible = this.n > 0; }
}

// ---------------------------------------------------------------------------
// RAIN. Streaks in a box that follows the camera but is anchored to the world
// (js/ads/actors.js rain(), with three things added):
//   - a streak is drawn along the drop's motion RELATIVE TO THE CAMERA, so from
//     a car at 180 km/h the rain comes at the glass nearly flat;
//   - drops inside a headlamp beam are lit, in that lamp's colour;
//   - nothing is ever drawn inside the cabin of the car the camera is in.
// ---------------------------------------------------------------------------
function rainFx(streaks, T, camera, { vel = null, beams = [], inside = null, lit = 1, count = 3800, box = 30, height = 17, fall = 19, bright = 0.26 } = {}) {
  const c = camera.position, wind = [3.5, 0, 1.5];
  const wrap = (v, m) => ((v % m) + m) % m;
  const rx = wind[0] - (vel ? vel.x : 0), ry = -(vel ? vel.y : 0), rz = wind[2] - (vel ? vel.z : 0);
  const inv = inside ? _q.copy(inside.quat).invert() : null, B = CAB.box;
  const inCab = (x, y, z) => { _c.set(x, y, z).sub(inside.pos).applyQuaternion(inv); return _c.x > B.x0 && _c.x < B.x1 && Math.abs(_c.z) < B.z && _c.y < B.y && _c.y > -0.2; };
  for (let i = 0; i < count; i++) {
    const f = fall * (0.8 + rnd(i, 3) * 0.4);
    const x = c.x - box / 2 + wrap(rnd(i, 1) * box + wind[0] * T - c.x, box);
    const z = c.z - box / 2 + wrap(rnd(i, 2) * box + wind[2] * T - c.z, box);
    const y = c.y - height * 0.4 + wrap(rnd(i, 4) * height - f * T - c.y, height);
    const L = 0.012 + rnd(i, 5) * 0.01;
    const x1 = x + rx * L, y1 = y + (f + ry) * L, z1 = z + rz * L;
    if (inside) { let hit = false; for (let k = 0; k <= 4 && !hit; k++) hit = inCab(x + (x1 - x) * k / 4, y + (y1 - y) * k / 4, z + (z1 - z) * k / 4); if (hit) continue; }
    let r = 0.75, g = 0.82, b = 1.0, a = bright * (0.35 + 0.65 * rnd(i, 6));
    if (vel) {
      // A streak seen END-ON is a dot, and from a camera travelling with the cars every streak near the point it is
      // travelling away from is end-on: thousands of dots, added together, were a white ball on the road in front of the
      // hero in every head-on tracking shot. Fade each streak by how much of its length the lens can actually see.
      const sx = x1 - x, sy = y1 - y, sz = z1 - z, vx = x - c.x, vy = y - c.y, vz = z - c.z;
      const dot = (sx * vx + sy * vy + sz * vz) / Math.sqrt((sx * sx + sy * sy + sz * sz) * (vx * vx + vy * vy + vz * vz) + 1e-9);
      const across = Math.sqrt(Math.max(0, 1 - dot * dot));
      if (across < 0.12) continue;
      a *= Math.min(1, (across - 0.12) / 0.4);
    }
    for (const bm of beams) {
      // how far down the beam this drop is, and how far off its axis
      const px = x - bm.pos.x, py = y - bm.pos.y, pz = z - bm.pos.z, d = px * bm.dir.x + py * bm.dir.y + pz * bm.dir.z;
      if (d < 0.8 || d > 24) continue;
      const off = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - d * d)), cone = 0.32 * d + 0.7;
      if (off > cone) continue;
      // (at 7x this, seen head-on down a long lens, the lit rain in front of a car bloomed into one white ball)
      const k = (1 - off / cone) * Math.pow(1 - d / 24, 1.5) * bm.k * 0.7 * lit;
      r += bm.col[0] * k * 3; g += bm.col[1] * k * 3; b += bm.col[2] * k * 3; a = Math.min(1, a + 0.18 * k);
    }
    streaks.add(x, y, z, x1, y1, z1, r * a, g * a, b * a, 0.9, 0.1);
  }
}

// spray off the back of a car on a wet road (the cinematic's, with the plan as its memory)
function spray(kit, stage, shot, key, t, k) {
  const spec = key === 'g4' ? G4 : G3;
  plume(kit.puffs, t, {
    rate: 44, life: 1.4, seed: key === 'g4' ? 3 : 11, size: [0.8, 4.6 * k], col: [0.055, 0.066, 0.094], alpha: 0.26 * k, rise: 1.4, spread: 1.4, grow: 0.5, fade: 0.08,
    at: (tb, p) => { const d = shot.fn(stage, tb, shot.at + tb)[key]; local(pose(stage, { ...d, spec }), spec.rear - 0.25, 0.45, 0, p); },
  });
}

runFilm({
  title: 'XBR — gt', track: 'nordschleife', bpm: 60, beats: DURATION, aspect: 9 / 16, letterbox: false, grade: 'cold', car: 'gt3',
  score,

  async build(kit) {
    const { stage } = kit;
    // The course-light poles (js/lamps.js) stand every 70 m; the Nordschleife has none. Their lamps
    // are already off (MOOD.lamps 0); take the grey poles out of the picture too.
    for (const o of stage.scene.children) if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.color.getHex() === 0x8a9096 && o.material.metalness === 0.5) o.visible = false;
    // No words but the name: the sponsor boards, the barrier banners and the start gantry all print
    // from one sign atlas (js/furniture.js). Whatever wears it is not in this film.
    const signs = stage.sign && stage.sign.texture;
    if (signs) stage.scene.traverse(o => { if (o.isMesh && o.material && o.material.map === signs) o.visible = false; });
    const roofY = (x, z) => 1.14 - 0.75 * (x + 0.55) ** 2 - 0.14 * z * z;     // 2.5 cm or more under the measured roof skin everywhere
    const [p4, p3] = await Promise.all([
      loadPack('g55', { recolour: [222, 30, 24], headliner: { x0: -0.95, x1: -0.15, z: 0.58, y: roofY, colour: 0x9c1418 } }),
      loadPack('m720', { tint: 0xb4bdd0, gloss: 0.2 }),
    ]);
    const g4 = new PackCar(stage, p4, 'gt4', { tyre: 0.3 }), g3 = new PackCar(stage, p3, 'gt3', { tyre: 0.6 });
    const cabin = new Cabin(); g4.root.add(cabin.group);
    kit.cars.push(g4, g3);
    const glints = new Glints(stage.scene);
    // THE stripe carries what every lap leaves on it: a smear of rubber where the tyre goes.
    {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 64, 4, 32, 64, 60);
      gr.addColorStop(0, 'rgba(8,8,9,0.82)'); gr.addColorStop(0.5, 'rgba(8,8,9,0.5)'); gr.addColorStop(1, 'rgba(8,8,9,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
      const q = [[KERB.s0 + 0.02, KERB.lat - 0.2], [KERB.s0 + 0.02, KERB.lat + 0.2], [KERB.s1 - 0.02, KERB.lat + 0.2], [KERB.s1 - 0.02, KERB.lat - 0.2]].map(([s, l]) => stage.v3(s, l, KERB.top + 0.006));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(p => [p.x, p.y, p.z]), 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
      m.name = 'kerb.rubber'; m.renderOrder = 1; stage.scene.add(m);
    }
    return { g4, g3, cabin, glints };
  },

  shots: SHOTS.map(shot => ({ at: shot.at, name: shot.name, mood: 'night', moodOver: MOOD, draw: c => draw(c, shot) })),

  // the only word in the film
  captions: [{ at: 70.0, to: DURATION, cls: 'xbr', html: 'XB<i>R</i>', fin: 0.5 }],
});

function draw(c, shot) {
  const { stage, kit, grade, camera } = c, { g4, g3, cabin, glints } = c.state;
  const R = resolve(stage, shot, c.t), x = R.x, inside = !!x.cabin;
  const cars = [['g4', g4, WARM], ['g3', g3, COLD]];
  glints.begin();

  for (const [k, car] of cars) {
    if (R[k]) car.place(R[k], { heat: k === 'g4' ? (x.disc || 0) : 0, bodyVisible: !(inside && k === 'g4') }); else car.hide();
  }
  cabin.group.visible = inside;
  if (inside) cabin.update({ T: c.T, wheel: x.wheel || 0, drops: x.drops, mirrorGap: x.mirrorGap ?? null, mirrorOn: x.mirrorOn ?? 1 });

  kit.aim(R.cam.pos, R.cam.look, R.cam.fov, { shake: R.cam.shake || 0, time: c.T, seed: shot.index + 1, near: R.cam.near || 0.3, far: 6000 });
  // ?look=roof / ?look=up: two inspection cameras on the GT4 (its roof from above-right; the cabin's ceiling
  // from the seat), lit, for checking the shell. Never part of the film.
  if (LOOK && R.g4) {
    if (LOOK === 'roof') kit.aim(local(R.g4, -2.3, 2.6, 2.4), local(R.g4, -0.45, 1.05, 0.1), 34, { near: 0.2 });
    else kit.aim(local(R.g4, -0.62, 0.72, -0.2), local(R.g4, -0.45, 1.2, 0.25), 70, { near: 0.03 });
  }
  const cam = camera.position;

  // Wet, but not a mirror: at stage.js's night roughness (0.17) a headlamp's highlight on the road burned a white hole
  // in every head-on shot (measured in frames at 14 s and 56.3 s). Rougher, the same light spreads into a long sheen.
  // Looking straight back INTO the lamps is the mirror direction of a wet road. Measured at 14 s: either car's spot
  // alone took the road in front of the hero to 233-255 of 255; both off, 33. Making the road duller only spread the
  // glare. So the head-on shots turn the spots themselves down (x.lamp) — the lamps on screen are sprites and their
  // reflections are the glint streaks, neither of which needs the spot.
  if (stage.road) stage.road.material.roughness = 0.36;
  // The woods are paper cut-outs lit by ONE number, the scene's sun (js/forest.js) — a spotlight cannot touch them. So
  // when a shot wants the trees to catch the headlamps, the 'moon' itself warms and brightens for that moment.
  { const k = x.trees || 0; stage.sun.intensity = MOOD.sun[0] * (1 + 7 * k); stage.sun.color.setRGB(MOOD.sun[1] + 0.5 * k, MOOD.sun[2] + 0.2 * k, MOOD.sun[3] - 0.45 * k); }
  // ---- the lamps ARE the lighting -------------------------------------------------
  const beams = [];
  cars.forEach(([k, car, col], i) => {
    const p = R[k], L = stage.spots[i];
    if (!p) return;
    const sp = p.spec, half = x.beam || 0.4;
    L.intensity = 1200 * (x.lamp ?? 1);      // measured in frames: at 1050 and above the road four metres ahead of each car is a white lake L.distance = 170; L.angle = half; L.penumbra = 0.75; L.color.setRGB(0.25 + 0.75 * col[0], 0.25 + 0.75 * col[1], 0.25 + 0.75 * col[2]);
    local(p, sp.head[0] + 0.1, sp.head[1] + 0.12, 0, L.position); local(p, sp.head[0] + 40, -0.4, 0, L.target.position); L.target.updateMatrixWorld();
    beams.push({ pos: local(p, sp.head[0], sp.head[1], 0), dir: p.fwd, col, k: 1 });
    // what a lens sees of them: a hot core, a halo, and each lamp again in the wet road
    const toCam = _d.copy(cam).sub(p.pos), dist = toCam.length(), f = toCam.normalize().dot(p.fwd);
    const far = Math.max(1, dist / 22);
    for (const s of [-1, 1]) {
      if (f > 0.04 && !(inside && k === 'g4')) {
        const h = local(p, sp.head[0], sp.head[1], s * sp.head[2], _b), w = Math.pow(f, 1.6);
        kit.glow.add(h.x, h.y, h.z, 0.1 * far, col[0] * 3.4, col[1] * 3.4, col[2] * 3.4, 0.25 + 0.75 * w);
        kit.glow.add(h.x, h.y, h.z, (0.45 + 0.5 * w) * far, col[0], col[1], col[2], 0.42 * w * (x.glare ?? 1));
        glints.lamp(p, sp.head[0], sp.head[1], s * sp.head[2], cam, col, 0.62 * w);
      }
      if (f < -0.04) {
        const tl = local(p, sp.tail[0], sp.tail[1], s * sp.tail[2], _b), w = Math.pow(-f, 1.2), b = 1 + 2.2 * p.brake;
        kit.glow.add(tl.x, tl.y, tl.z, 0.07 * far, RED[0] * 4 * b, RED[1] * 4 * b, RED[2] * 4 * b, 0.3 + 0.7 * w);
        kit.glow.add(tl.x, tl.y, tl.z, (0.17 + 0.17 * w) * far * (0.8 + 0.2 * b), RED[0], RED[1], RED[2], 0.4 * w * Math.min(1.6, b));
        glints.lamp(p, sp.tail[0], sp.tail[1], s * sp.tail[2], cam, RED, 0.9 * w * Math.min(1.8, b));
      }
    }
  });
  // the red of a tail lamp on the road and on whatever follows it
  {
    const P = stage.points[0], who = x.tailOn ? R[x.tailOn] : (R.g3 && R.g4 && R.g3.s > R.g4.s ? R.g3 : R.g4 || R.g3);
    if (inside && x.tagRed != null) { P.color.setRGB(1, 0.07, 0.03); P.intensity = 0.34 * x.tagRed; P.distance = 1.4; local(R.g4, -0.32, 0.88, 0.14, P.position); }
    else if (who && !inside) { P.color.setRGB(1, 0.08, 0.04); P.intensity = 16 + 46 * who.brake; P.distance = 24; local(who, who.spec.tail[0] - 0.5, 0.7, 0, P.position); }
  }
  // one more small lamp: the cockpit's own glow, or a touch of moon on a close-up
  {
    const P = stage.points[1];
    if (inside) { const cold = x.coldBehind ? 1 : 0; P.color.setRGB(1 - 0.4 * cold, 0.74 + 0.02 * cold, 0.5 + 0.5 * cold); P.intensity = 0.42 * (x.dash ?? 0.6); P.distance = 1.8; local(R.g4, -0.42, 0.86, 0.1, P.position); }
    if (LOOK && R.g4) { local(R.g4, -1.6, 2.4, 1.8, P.position); P.intensity = LOOK === 'roof' ? 40 : 1.2; P.color.setRGB(1, 1, 1); P.distance = 12; if (LOOK === 'up') local(R.g4, -0.6, 0.7, -0.2, P.position); }
    else if (inside) { /* set above */ }
    else if (x.fill) { P.position.copy(x.fill[0]); P.intensity = x.fill[1]; P.color.setRGB(...x.fill[2]); P.distance = 9; }
    else if (x.fillCar) { local(R.g4, ...x.fillCar[0], P.position); P.intensity = x.fillCar[1]; P.color.setRGB(...x.fillCar[2]); P.distance = 7; }
  }
  // the disc, glowing behind the spokes
  if (x.disc && R.g4) {
    const h = local(R.g4, G4.wheelX, G4.wheelR, -G4.wheelZ - 0.12, _b), d = x.disc * x.disc;
    kit.glow.add(h.x, h.y, h.z, 0.2, 1.0, 0.3, 0.05, 0.5 * d); kit.glow.add(h.x, h.y, h.z, 0.42, 1.0, 0.22, 0.03, 0.22 * d);
  }

  // ---- weather ---------------------------------------------------------------------
  if (x.spray) for (const [k] of cars) if (R[k] && !(inside && k === 'g4')) spray(kit, stage, shot, k, c.t, x.spray);
  if (inside && R.g3) spray(kit, stage, shot, 'g3', c.t, 1);
  if (x.rain !== 0) {
    // the camera's own speed: with the car it sits in, or tracking beside one
    const ref = R.g4 || R.g3, v = inside ? R.g4.v : (x.camV || 0);
    const vel = v && ref ? _a.copy(ref.fwd).multiplyScalar(v).clone() : null;
    rainFx(kit.streaks, c.T, camera, { vel, beams, inside: inside ? R.g4 : null, bright: inside ? 0.1 : 0.26, lit: inside ? 0.35 : 1 });
  }
  glints.end();
  // window.__gtOff = 'glow spray rain glints spot0 spot1 points': switch parts of the picture off, to find out which
  // of them a thing on screen is made of (see the white-ball hunt in the notes). Empty in the film.
  { const off = window.__gtOff || '';
    if (off) { if (off.includes('glow')) kit.glow.begin(); if (off.includes('spray')) kit.puffs.begin(); if (off.includes('rain')) kit.streaks.begin(); if (off.includes('glints')) { glints.begin(); glints.end(); }
      if (off.includes('spot0')) stage.spots[0].intensity = 0; if (off.includes('spot1')) stage.spots[1].intensity = 0; if (off.includes('points')) for (const q of stage.points) q.intensity = 0; } }

  // ---- the lab ---------------------------------------------------------------------
  grade.grade = inside ? INSIDE : NIGHT;
  grade.exposure = stage.exposure * (x.exposure || 1);
  grade.fade = x.fade ?? 1; grade.flash = x.flash || 0; grade.streak = inside ? 0.5 : 0.9;
  if (x.disc != null) { grade.dof = 0.7; grade.focus = cam.distanceTo(local(R.g4, G4.wheelX, 0.33, -G4.wheelZ, _b)); grade.focusRange = 1.6; }
  else if (x.cabin === 'mirror') { grade.dof = 0.6; grade.focus = cam.distanceTo(local(R.g4, ...CAB.mirror, _b)); grade.focusRange = 0.9; }
  else if (x.cabin === 'tag') { grade.dof = 0.5; grade.focus = cam.distanceTo(local(R.g4, ...CAB.tagPivot, _b)); grade.focusRange = 3; }
}
