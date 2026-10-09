// deadpan.js — "XBR: an introduction". The Nürburgring, explained calmly.
//
// A corporate explainer whose narrator has not looked at the screen. The
// captions are true; the pictures are also true; they are not about the same
// thing. The comedy is the timing, so every cut is a beat number from the
// score's own cue sheet (js/ads/score-deadpan.js CUE / HIT): hold, cut,
// silence, caption.
//
//    0   FIG. 1  a circuit           "XBR is a racing simulator."
//   14   FIG. 2  a car               "It features real circuits, surveyed to the metre."
//   28   FIG. 3  drivers             "Our drivers are highly trained professionals."
//   38.5         the main straight   "and some drivers are a bit..."
//   43.5         TURN ONE            (no caption, no music)
//   49.5         turn one, still     "unskilled."
//   55.5 FIG. 4  tyre management     "Tyre management is a core pillar of race strategy."
//   69.5 FIG. 5  physics             "The physics are physically accurate."
//   83.5         the small print
//   90.5 FIG. 6  customer feedback   five stars
//  101   FIG. 7  artificial intelligence   "...hard, but fair." / "They are also very consistent."
//  115           XBR — RACING FOR ALL … black … "Including them."
import * as THREE from 'three';
import { runFilm } from './film.js';
import { Car, GRID, clamp, lerp, smooth, ease, easeOut, wobble, rnd, plume, stream, sparks } from './actors.js';
import { score, CUE, HIT } from './score-deadpan.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SPB = 60 / 108;
const _c = V(), _d = V();
const azOf = (from, to, plus = 0) => Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI + plus;
const hdgAz = (stage, s, plus = 0) => stage.at(s, 0).hdg * -180 / Math.PI + plus;

// one well-behaved car: where it started and how long ago
function drive(stage, car, s0, t, { lat = 0, lineK = 1, pace = 1 } = {}) {
  const s = stage.sAfter(s0, t, pace);
  car.drive(s, { lat, lineK, brake: clamp((stage.lineV(s) - stage.lineV(s + 18)) / 7) });
  return s;
}

// ---- TURN ONE -----------------------------------------------------------------
// The straight-on line from the braking point: `d` metres along it. The road
// ends at d = 38, the kerb is at 40 and the barrier at 57.
const T1 = { s: 592, launch: 40, wall: 57 };
function t1Frame(stage) {
  if (stage._t1) return stage._t1;
  const p = stage.at(T1.s, 0), F = V(Math.cos(p.hdg), 0, -Math.sin(p.hdg)), R = V(Math.sin(p.hdg), 0, Math.cos(p.hdg));
  const O = V(p.x, p.y, p.z);
  const at = (d, side = 0, up = 0, out = V()) => {
    out.copy(O).addScaledVector(F, d).addScaledVector(R, side);
    out.y = stage.groundAt(out.x, out.z) + up;
    return out;
  };
  return (stage._t1 = { O, F, R, hdg: p.hdg, at });
}
// the locked-off low camera on the inside of the corner
function t1Cam(c, kick = 0) {
  const { stage, kit } = c, f = t1Frame(stage);
  const cam = f.at(50, 34, 0.42), look = f.at(53, 0, 3.0, _c);
  kit.aim(cam, look, 50, { shake: 0.02 + kick, time: c.T * (kick ? 9 : 1), seed: 21, near: 0.1 });
}
const tLaunch = (HIT.pass - CUE.t1) * SPB;
function flight(c, car, t) {
  const f = t1Frame(c.stage), yaw = f.hdg, p = V();
  if (t < tLaunch) {
    const d = T1.launch + 76 * (t - tLaunch);
    f.at(d, 0, 0, p);
    car.free(p.x, p.y, p.z, yaw, 0, 0, { dist: d });
    return { d, y: 0, p };
  }
  const k = t - tLaunch, d = T1.launch + 34 * k, y = 13.5 * k - 4.9 * k * k + 0.3;
  f.at(d, 0, 0, p); p.y = f.at(T1.launch, 0, 0, _d).y + y;
  car.free(p.x, p.y, p.z, yaw + k * 0.5, k * 6.2, k * 3.1, { dist: T1.launch + k * 20 });
  return { d, y, p };
}

runFilm({
  title: 'XBR — deadpan', track: 'nurburgring', bpm: 108, beats: CUE.fin, letterbox: false, grade: 'plain', car: 'f1',
  pressText: 'PRESS TO BEGIN', score,

  async build(kit) {
    const { stage } = kit;
    const cars = [];
    for (let i = 0; i < 6; i++) cars.push(new Car(stage, { kind: 'f1', team: GRID[[4, 1, 5, 2, 7, 6][i]], num: [14, 4, 23, 63, 30, 10][i] }));
    const hero = new Car(stage, { kind: 'f1', team: 'scarlet', num: 16 });
    kit.cars.push(...cars, hero);
    // a wheel with nobody attached to it
    const wheel = new THREE.Group(), tilt = new THREE.Group(), w = hero.b.wheels.rl.clone();
    w.position.set(0, 0, 0); tilt.add(w); wheel.add(tilt); wheel.visible = false; stage.scene.add(wheel);
    return { cars, hero, wheel, tilt, wmesh: w };
  },

  shots: [
    // ---- 1. a circuit --------------------------------------------------------
    {
      at: CUE.intro, name: '1 a circuit', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 560, 120) }),
      draw(c) {
        const { stage, kit, state } = c;
        state.cars.slice(0, 3).forEach((car, i) => drive(stage, car, 380 - i * 60, c.t));
        const cam = stage.v3(402, 21, 15), look = stage.v3(600, -4, 0, _c);
        kit.aim(cam, look, 40 - c.t * 0.25, { shake: 0.02, time: c.T });
      },
    },
    // ---- 2. a car --------------------------------------------------------------
    {
      at: CUE.grid, name: '2 a car', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 8, -60) }),
      draw(c) {
        const { stage, kit, state } = c;
        state.hero.drive(8, { lat: -2.2, lineK: 0, dist: 0 });
        const k = ease(c.u);
        const cam = state.hero.local(lerp(8.6, 7.2, k), lerp(1.45, 1.25, k), lerp(4.9, 4.1, k)), look = state.hero.local(0.2, 0.52, 0);
        kit.aim(cam, look, 30, { shake: 0.015, time: c.T });
      },
    },
    // ---- 3. drivers --------------------------------------------------------------
    {
      at: CUE.pros, name: '3 professionals', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 840, 100) }),
      draw(c) {
        const { stage, kit, state } = c;
        let lead = 0;
        state.cars.forEach((car, i) => { const s = drive(stage, car, 742 - i * 15, c.t); if (!i) lead = s; });
        const cam = stage.v3(848, 34, 13), look = stage.v3(lead - 34, 0, 0.5, _c);
        kit.aim(cam, look, 24, { shake: 0.03, time: c.T });
      },
    },
    // ---- 4. "...a bit" -------------------------------------------------------------
    {
      at: CUE.abit, name: '4 the main straight', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 560, 120) }),
      draw(c) {
        const { stage, kit, state } = c, f = t1Frame(stage);
        const d = T1.launch + 76 * (c.t - c.dur - tLaunch);          // arrives at the cut exactly where shot 5 picks it up
        const p = f.at(d, 0, 0);
        state.hero.free(p.x, p.y, p.z, f.hdg, 0, 0, { dist: d });
        const cam = stage.v3(300, -24, 17), look = p.clone(); look.y += 5;
        kit.aim(cam, look, 11, { shake: 0.05, time: c.T });
      },
    },
    // ---- 5. TURN ONE ------------------------------------------------------------------
    {
      at: CUE.t1, name: '5 TURN ONE', mood: 'flat', moodOver: k => ({ az: azOf(t1Frame(k.stage).at(50, 34), t1Frame(k.stage).at(53, 0), 205) }),
      draw(c) {
        const { stage, kit, state } = c, f = t1Frame(stage), t = c.t;
        const fl = flight(c, state.hero, t);
        state.hero.b.wheels.rl.visible = t < tLaunch + 0.02;
        const since = t - tLaunch;
        t1Cam(c, since > 0 ? 0.5 * Math.exp(-since * 5) : 0);
        // the kerb, and a little of the gravel, go with it
        plume(kit.puffs, t, { rate: 220, life: 1.6, t0: tLaunch - 0.02, t1: tLaunch + 0.12, at: (tb, p) => f.at(T1.launch + (tb - tLaunch) * 60, 0, 0.3, p),
          size: [0.6, 4.2], col: [0.62, 0.57, 0.48], alpha: 0.5, rise: 1.4, drift: [f.F.x * 5, 0, f.F.z * 5], spread: 1.6, seed: 5 });
        sparks(kit.streaks, t, { rate: 500, t0: tLaunch - 0.05, t1: tLaunch + 0.04, at: (tb, p) => f.at(T1.launch, 0, 0.1, p), vel: (tb, v) => v.copy(f.F).multiplyScalar(40), life: 0.5, spread: 9, up: 6 });
        void fl;
      },
    },
    // ---- 6. "unskilled." ----------------------------------------------------------------
    {
      at: CUE.unskilled, name: '6 unskilled.', mood: 'flat', moodOver: k => ({ az: azOf(t1Frame(k.stage).at(50, 34), t1Frame(k.stage).at(53, 0), 205) }),
      draw(c) {
        const { stage, kit, state } = c, f = t1Frame(stage), t = c.t;
        t1Cam(c);
        // dust still hanging from before the cut
        const before = t + c.shot.at * SPB - CUE.t1 * SPB;
        plume(kit.puffs, before, { rate: 220, life: 1.6, t0: tLaunch - 0.02, t1: tLaunch + 0.12, at: (tb, p) => f.at(T1.launch + (tb - tLaunch) * 60, 0, 0.3, p),
          size: [0.6, 4.2], col: [0.62, 0.57, 0.48], alpha: 0.5, rise: 1.4, drift: [f.F.x * 5, 0, f.F.z * 5], spread: 1.6, seed: 5 });
        // one wheel comes back. Down from above, three bounces, a wobble, and it lies down.
        const R = state.hero.R, g = 9.81;
        let y, tt = t - 0.35, rolling = false;
        const drop = [[14, -6], [0, 5.6], [0, 2.4], [0, 0.9]];       // [start height, start upward speed] of each hop
        let k = 0, T0 = 0;
        for (; k < drop.length; k++) {
          const [h, v] = drop[k], dur = (v + Math.sqrt(v * v + 2 * g * h)) / g;
          if (tt < T0 + dur || k === drop.length - 1) { const a = Math.min(tt - T0, dur); y = h + v * a - 0.5 * g * a * a; if (tt >= T0 + dur) rolling = true; break; }
          T0 += dur;
        }
        state.wheel.visible = tt > 0;
        if (tt > 0) {
          const along = 50 - tt * 1.3, side = 19 + tt * 1.4;
          const p = f.at(along, side, 0);
          const lie = smooth(3.0, 3.5, tt);
          state.wheel.position.set(p.x, p.y + Math.max(0, y) + lerp(R, 0.17, lie), p.z);
          state.wheel.rotation.set(0, f.hdg + 0.9 + Math.sin(tt * 7) * 0.12 * smooth(2.2, 3.0, tt), 0);
          state.tilt.rotation.x = lie * Math.PI / 2 + Math.sin(tt * 9) * 0.16 * smooth(2.0, 2.9, tt) * (1 - lie);
          state.wmesh.rotation.z = -tt * 7 * (1 - lie);
          void rolling;
        }
      },
    },
    // ---- 7. tyre management ------------------------------------------------------------------
    {
      at: CUE.tyres, name: '7 tyre management', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 3100, 60) }),
      draw(c) {
        const { stage, kit, state } = c, car = state.hero, t = c.t;
        state.wheel.visible = false; car.b.wheels.rl.visible = true;
        const s0 = 3030, v = 42, sAt = tb => s0 + v * tb;
        car.drive(sAt(t), { lat: 0.4, lineK: 0, dist: sAt(t) });
        const cam = car.local(1.4, 1.25, 12.5), look = car.local(-1.6, 0.9, 0);
        kit.aim(cam, look, 27, { shake: 0.06, time: c.T, seed: 3 });
        const src = (fx, fy) => (tb, p) => { const q = stage.at(sAt(tb) + fx, 0.4); return p.set(q.x, q.y + fy, q.z); };
        const fwd = (tb, o) => { const q = stage.at(sAt(tb), 0.4); return o.set(Math.cos(q.hdg), 0, -Math.sin(q.hdg)).multiplyScalar(v); };
        // the fire rides with the car; the smoke stays where it was left
        const flame = (f, kk) => { const h = 1 - f; return [3.4 * h + 0.5, 1.9 * h * h + 0.12, 0.5 * h * h * h]; };
        for (const [fx, fy, sz, rate] of [[-1.5, 0.75, 1.0, 110], [-2.2, 0.45, 0.8, 70], [1.7, 0.4, 0.55, 50]]) {
          plume(kit.glow, t, { rate, life: 0.42, at: src(fx, fy), vel: fwd, velK: 0.9, size: [0.35 * sz, 1.5 * sz], col: flame, alpha: 0.6, rise: 2.6, spread: 0.5, fade: 0.1, seed: fx * 10 });
        }
        plume(kit.puffs, t, { rate: 46, life: 3.4, at: src(-2.2, 1.3), vel: fwd, velK: 0.34, size: [0.9, 6.5], col: [0.07, 0.07, 0.075], alpha: 0.62, rise: 1.7, spread: 0.6, grow: 0.7, seed: 9 });
        const P = stage.points[0]; P.intensity = 90 + 30 * wobble(t * 9, 2); P.color.setRGB(1, 0.5, 0.15); P.distance = 22; P.position.copy(car.local(-1.5, 1.4, 0));
      },
    },
    // ---- 8. physics ------------------------------------------------------------------------------
    {
      at: CUE.physics, name: '8a physics (calm)', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 4250, -70) }),
      draw(c) {
        const { stage, kit, state } = c, car = state.cars[1];
        const s = 4190 + 58 * c.t;
        car.drive(s, { lat: -1.2, lineK: 0, dist: s });
        const cam = car.local(11, 1.0, -3.0), look = car.local(0, 0.55, 0);
        kit.aim(cam, look, 24, { shake: 0.05, time: c.T, seed: 6 });
      },
    },
    {
      at: CUE.cartwheel, name: '8b physics (accurate)', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 4330, -70) }),
      draw(c) {
        const { stage, kit, state } = c, car = state.cars[1], t = c.t;
        const w = stage.track.w[stage.track.idx(4330)];
        const dist = 38 / 0.35 * (1 - Math.exp(-0.35 * t)), s = 4296 + dist;
        const q = stage.at(s, -(w + 4.6));
        const gy = stage.groundAt(q.x, q.z);
        const up = smooth(3.0, 3.6, t);
        const rise = t > 3.0 ? 1.15 * Math.pow(t - 3.0, 1.75) : 0;
        const hop = Math.abs(Math.sin(Math.PI * 1.9 * t)) * 1.9 * Math.exp(-0.32 * t) * (1 - up * 0.8);
        const y = gy + 0.75 + hop + rise;
        const ang = -dist / 2.1 - Math.max(0, t - 3.0) * 1.1;         // it rolls like a wheel 2.1 m across, then keeps going
        car.free(q.x, y, q.z, q.hdg + 0.25 * Math.sin(t * 0.9) + Math.max(0, t - 3) * 0.5, ang, 0.15 * Math.sin(t * 3), { dist: 0 });
        const cam = stage.v3(4356, -(w + 12.2), 1.0);
        cam.y = stage.groundAt(cam.x, cam.z) + 0.95;
        const look = _c.set(q.x, Math.min(y, gy + 2.2 + Math.max(0, t - 3) * 1.5), q.z);
        kit.aim(cam, look, 42, { shake: 0.04, time: c.T, seed: 7 });
        // turf, every time it touches down
        for (let k = 0; k < 7; k++) {
          const tk = k / 1.9;
          if (tk > 3.1) break;
          const dk = 38 / 0.35 * (1 - Math.exp(-0.35 * tk)), pk = stage.at(4296 + dk, -(w + 4.6));
          plume(kit.puffs, t, { rate: 260, life: 1.5, t0: tk - 0.01, t1: tk + 0.07, at: (tb, p) => p.set(pk.x, stage.groundAt(pk.x, pk.z) + 0.3, pk.z),
            size: [0.5, 3.4], col: [0.36, 0.33, 0.24], alpha: 0.5, rise: 1.8, drift: [Math.cos(pk.hdg) * 4, 0, -Math.sin(pk.hdg) * 4], spread: 1.4, seed: 30 + k });
        }
      },
    },
    // ---- 9. the small print ------------------------------------------------------------------------------
    {
      at: CUE.small, name: '9 the small print', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 560, 120) }),
      draw(c) {
        const { stage, kit, state } = c;
        state.cars.forEach((car, i) => drive(stage, car, 560 - i * 22, c.t));
        const cam = stage.v3(690, 30, 9), look = stage.v3(628, -2, 0, _c);
        kit.aim(cam, look, 38 + c.t * 0.3, { shake: 0.02, time: c.T });
      },
    },
    // ---- 10. customer feedback -------------------------------------------------------------------------------
    {
      at: CUE.review, name: '10 customer feedback', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 3200, 140) }),
      draw(c) {
        const { stage, kit, state } = c, car = state.hero, t = c.t;
        const S = 3200, i = stage.track.idx(S), w = stage.track.w[i], run = stage.track.runL[i];
        const q = stage.at(S, w + run - 3.05);
        // nose in the wall, and still trying
        car.free(q.x, stage.groundAt(q.x, q.z) + 0.02, q.z, q.hdg + Math.PI / 2 - 0.12, -0.035, 0.02, { dist: 0 });
        car.b.wheels.rl.rotation.z = car.b.wheels.rr.rotation.z = -t * 38;
        car.b.wheels.rl.visible = true;
        const cam = stage.v3(S - 9.5, w + 3.5, 1.15), look = car.local(0.4, 0.75, 0);
        cam.y = stage.groundAt(cam.x, cam.z) + 1.1;
        kit.aim(cam, look, 33 - c.u * 1.5, { shake: 0.015, time: c.T });
        plume(kit.puffs, t + 8, { rate: 9, life: 4, at: (tb, p) => car.local(2.6, 0.5, 0, p), size: [0.3, 2.0], col: [0.78, 0.78, 0.8], alpha: 0.22, rise: 1.1, spread: 0.3, seed: 12 });
        // the rear tyres are doing their best with the gravel
        for (const z of [-0.78, 0.78]) plume(kit.puffs, t + 8, { rate: 26, life: 1.1, at: (tb, p) => car.local(-2.2, 0.2, z, p), size: [0.25, 1.3], col: [0.5, 0.46, 0.36], alpha: 0.3, rise: 0.8,
          drift: [-Math.cos(car.hdg) * 5, 0, Math.sin(car.hdg) * 5], spread: 0.3, seed: 14 + z });
      },
    },
    // ---- 11. artificial intelligence ------------------------------------------------------------------------------
    {
      at: CUE.ai, name: '11a hard, but fair', mood: 'flat', moodOver: k => ({ az: hdgAz(k.stage, 3800, 80) }),
      draw(c) {
        const { stage, kit, state } = c;
        state.cars.forEach((car, i) => { const s = 3722 + 52 * c.t - i * 7.2; car.drive(s, { lat: 0, lineK: 0, dist: s }); });
        const lead = state.cars[0], cam = lead.local(14, 3.2, -9), look = state.cars[2].local(0, 0.4, 0);
        kit.aim(cam, look, 30, { shake: 0.05, time: c.T, seed: 4 });
      },
    },
    {
      at: CUE.lemmings, name: '11b very consistent', mood: 'flat', moodOver: k => ({ az: azOf(t1Frame(k.stage).at(T1.wall + 7.5, 8.5), t1Frame(k.stage).at(T1.wall - 14, 0), 150) }),
      draw(c) {
        const { stage, kit, state } = c, f = t1Frame(stage), p = V();
        // from just over the wall, looking back down the queue as it forms
        kit.aim(f.at(T1.wall + 7.5, 8.5, 3.4), f.at(T1.wall - 14, 0, 0.6, _c), 40, { shake: 0.02, time: c.T, seed: 23 });
        // six cars, one per beat, each making the same decision and parking in the next bay along
        state.cars.forEach((car, k) => {
          // car k stops 5.9 m short of the one in front; the first one stops at the wall.
          // Each arrives ON its beat: it began slowing 0.95 s earlier.
          const stop = T1.wall - 3.6 - k * 5.9, run = 16.2, r = 44 / run, d0 = stop - run;
          const tk = (HIT.cars[k] - CUE.lemmings) * SPB - 0.95, a = c.t - tk;
          const d = a < 0 ? d0 + 44 * a : d0 + run * (1 - Math.exp(-a * r));
          f.at(d, 0, 0.02, p);
          car.free(p.x, p.y, p.z, f.hdg, a > 0 ? -0.02 * Math.exp(-a * 3) : 0, 0, { dist: d, brake: a > -0.1 ? 1 : 0 });
          if (d > T1.launch - 4) plume(kit.puffs, c.t, { rate: 50, life: 1.2, t0: tk, t1: tk + 0.9, seed: 40 + k,
            at: (tb, o) => f.at(Math.max(T1.launch, d0 + run * (1 - Math.exp(-(tb - tk) * r)) - 2), 0, 0.3, o),
            size: [0.5, 2.6], col: [0.62, 0.57, 0.48], alpha: 0.4, rise: 1.0, spread: 1.2 });
        });
      },
    },
    // ---- 12. the end card ---------------------------------------------------------------------------------------------
    { at: CUE.end, name: '12 end card', mood: 'flat', draw(c) { t1Cam(c); c.grade.fade = 0; } },
  ],

  captions: [
    { at: 0.5, to: 14, cls: 'tag', html: 'FIG. 1 — A CIRCUIT' },
    { at: 1.5, to: 13.2, cls: 'sub', html: 'XBR is a racing simulator.' },
    { at: 14, to: 28, cls: 'tag', html: 'FIG. 2 — A CAR' },
    { at: 15, to: 27.2, cls: 'sub', html: 'It features real circuits, surveyed to the metre.' },
    { at: 28, to: 38.5, cls: 'tag', html: 'FIG. 3 — DRIVERS' },
    { at: 29, to: 38, cls: 'sub', html: 'Our drivers are highly trained professionals.' },
    { at: CUE.abit, to: CUE.t1, cls: 'sub', html: 'and some drivers are a bit...' },
    { at: CUE.unskilled + 0.5, to: CUE.tyres, cls: 'sub', html: 'unskilled.' },
    { at: CUE.tyres, to: CUE.physics, cls: 'tag', html: 'FIG. 4 — TYRE MANAGEMENT' },
    { at: CUE.tyres + 1, to: CUE.physics - 0.4, cls: 'sub', html: 'Tyre management is a core pillar of race strategy.' },
    { at: CUE.tyres + 5, to: CUE.physics, cls: 'panel', html: '<table><tr><th colspan="2">TYRE TEMPERATURE</th></tr><tr><td>FRONT LEFT</td><td>98 °C</td></tr><tr><td>FRONT RIGHT</td><td>101 °C</td></tr><tr><td>REAR LEFT</td><td>847 °C</td></tr><tr><td>REAR RIGHT</td><td>912 °C</td></tr><tr class="ok"><td>STATUS</td><td>NOMINAL</td></tr></table>' },
    { at: CUE.physics, to: CUE.small, cls: 'tag', html: 'FIG. 5 — PHYSICS' },
    { at: CUE.physics + 0.5, to: 77.5, cls: 'sub', html: 'The physics are physically accurate.' },
    { at: 79.5, to: CUE.small, cls: 'sub', html: 'Gravity is included at no extra cost.' },
    { at: CUE.small, to: CUE.review, cls: 'legal', html: 'XBR is a simulation. XBR accepts no responsibility for walls, gravel, tyre barriers, other cars, your lap times, the weather, or turn one. Kerbs may be closer than they appear. Past performance into turn one is not a guarantee of future performance into turn one. Do not attempt turn one. Braking points are provided for guidance only and were, in testing, widely ignored. Side effects may include sudden confidence, loss of the rear wing, and a detailed knowledge of the gravel at the Nürburgring. Gravity not optional except where shown. Wheels sold together but may arrive separately. Your mileage may vary; ours ended at the first corner. Terms and conditions apply to turn one. Racing for all, including those for whom it is not going well.' },
    { at: CUE.review, to: CUE.ai, cls: 'tag', html: 'FIG. 6 — CUSTOMER FEEDBACK' },
    { at: CUE.review, to: CUE.ai, cls: 'review', html: '<div class="stars"><span>★</span><span>★</span><span>★</span><span>★</span><span>★</span></div>',
      live(el, t) { const sp = el.querySelectorAll('span'); HIT.stars.forEach((b, k) => sp[k].classList.toggle('on', t >= (b - CUE.review) * SPB)); } },
    { at: 94, to: CUE.ai, cls: 'quote', html: '“The wall was exactly where the game said it would be.”' },
    { at: 96.5, to: CUE.ai, cls: 'who', html: '— a driver, afterwards' },
    { at: CUE.ai, to: CUE.end, cls: 'tag', html: 'FIG. 7 — ARTIFICIAL INTELLIGENCE' },
    { at: CUE.ai + 0.5, to: CUE.lemmings - 0.4, cls: 'sub', html: 'The AI opponents race hard, but fair.' },
    { at: 112.2, to: CUE.end, cls: 'sub', html: 'They are also very consistent.' },
    { at: CUE.end, to: CUE.black, cls: 'paper', html: '' },
    { at: CUE.end, to: CUE.black, cls: 'end1', html: 'XB<i>R</i>' },
    { at: CUE.end + 1, to: CUE.black, cls: 'end2', html: 'RACING FOR ALL' },
    { at: CUE.ding, to: CUE.fin, cls: 'end3', html: 'Including them.' },
  ],
});
void GRID; void easeOut; void rnd; void stream;
