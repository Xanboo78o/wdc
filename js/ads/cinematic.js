// cinematic.js — the trailer. Spa-Francorchamps, dawn to dark, 64 seconds.
//
// Every cut is a BEAT number, and the score (js/ads/score-cinematic.js) is
// written on the same numbers: bar n starts at beat 4(n-1), 120 BPM, so a bar
// is two seconds and a beat is half of one.
//
//   A  dawn      bars  1-4    the valley held wide; headlights at kerb height
//   B  light     bars  5-8    a wheel at arm's length; the crest, going light
//   C  the pack  bars  9-16   a full grid into La Source, and what follows
//   D  night     bars 17-20   rain on the Kemmel straight
//   E  statement bars 21-28   golden hour: the crest, three wide, the held wide shot
//   F  title     bars 29-32   XBR — RACING FOR ALL
//
// Shots are pure functions of the clock (see js/ads/actors.js), so
// ?frame=SECONDS draws any moment exactly.
import * as THREE from 'three';
import { runFilm } from './film.js';
import { Car, GRID, clamp, lerp, smooth, ease, easeOut, wobble, rnd, sparks, rain, plume } from './actors.js';
import { score } from './score-cinematic.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const bar = n => (n - 1) * 4;
const azOf = (from, to, plus = 0) => Math.atan2(to.z - from.z, to.x - from.x) * 180 / Math.PI + plus;
const hdgAz = (stage, s, plus = 0) => stage.at(s, 0).hdg * -180 / Math.PI + plus;

// A car on the circuit as a function of time: where it started, how fast the
// film is running (pace < 1 is slow motion), how far off the line it sits.
class Run {
  constructor(stage, car, s0, { pace = 1, lat = 0, lineK = 1 } = {}) { Object.assign(this, { stage, car, s0, pace, lat, lineK }); }
  s(t) { return this.stage.sAfter(this.s0, t, this.pace); }
  brake(t) { const s = this.s(t), st = this.stage; return clamp((st.lineV(s) - st.lineV(s + 18) - 2.5) / 6); }
  place(t, extra = {}) { const s = this.s(t); this.car.drive(s, { lat: this.lat, lineK: this.lineK, brake: this.brake(t), ...extra }); return s; }
  /** A point on its path, `fwd` metres ahead of the car's middle, `up` above the road. */
  point(t, fwd = 0, up = 0.2, out = V(), side = 0) {
    const s = this.s(t) + fwd, st = this.stage;
    return st.v3(s, this.lat + st.lineOff(s) * this.lineK + side, up, out);
  }
  vel(t, out = V()) {
    const a = this.point(t, -1, 0, _a), b = this.point(t, 1, 0, _b), v = this.stage.lineV(this.s(t)) * this.pace;
    return out.copy(b).sub(a).normalize().multiplyScalar(v);
  }
}
const _a = V(), _b = V(), _c = V(), _d = V();

// spray off the back of a car on a wet road
function spray(c, run, t, { night = true, k = 1 } = {}) {
  const col = night ? [0.10, 0.12, 0.17] : [0.82, 0.84, 0.88];
  plume(c.kit.puffs, t, {
    rate: 46, life: 1.5, at: (tb, p) => run.point(tb, -2.4, 0.5, p), seed: run.car.root.id,
    size: [0.9, 5.0 * k], col, alpha: 0.26 * k, rise: 1.4, spread: 1.5, grow: 0.5, fade: 0.08,
  });
}
// titanium on tarmac
function floorSparks(c, run, t, t0, t1, bright = 1) {
  sparks(c.kit.streaks, t, { rate: 420, t0, t1, at: (tb, p) => run.point(tb, -1.2, 0.05, p), vel: (tb, v) => run.vel(tb, v), seed: run.car.root.id, bright, spread: 4, up: 2.2 });
}

runFilm({
  title: 'XBR — cinematic', track: 'spa', bpm: 120, beats: 128, letterbox: true, grade: 'film', car: 'f1',
  score,

  async build(kit) {
    const { stage } = kit;
    const f1 = [], gt = [];
    const N = new URLSearchParams(location.search).has('lo') ? 8 : 14;
    for (let i = 0; i < N; i++) f1.push(new Car(stage, { kind: 'f1', team: GRID[i % GRID.length], num: [1, 16, 44, 4, 14, 23, 10, 22, 87, 77, 27, 9, 86, 22][i] }));
    for (const colour of [0x1657c9, 0xd8dade, 0xd99a12]) gt.push(new Car(stage, { kind: 'gt3', colour, heads: true }));
    kit.cars.push(...f1, ...gt);
    return { f1, gt };
  },

  shots: [
    // ======================= A: DAWN =========================================
    {
      at: bar(1), name: 'A1 Eau Rouge, held', mood: 'dawn',
      moodOver: k => ({ az: azOf(k.stage.v3(896, 10, 7), k.stage.v3(1010, 0, 0), 38) }),
      draw(c) {
        const { stage, kit, grade } = c, { gt } = c.state;
        const run = new Run(stage, gt[0], 872, { pace: 0.55 });
        run.place(c.t);
        kit.aim(stage.v3(896 + c.t * 0.5, 10, 7 - c.t * 0.12), stage.v3(1012, 0, 3.5, _c), 40, { shake: 0.04, time: c.T });
        const L = stage.spots[0], car = gt[0];
        L.intensity = 900; L.distance = 120; L.angle = 0.36; L.color.setRGB(1, 0.93, 0.82);
        L.position.copy(car.local(1.9, 0.75, 0)); L.target.position.copy(car.local(40, -0.6, 0)); L.target.updateMatrixWorld();
        grade.fade = smooth(0.1, 3.0, c.t);
        grade.streak = 0.4;
      },
    },
    {
      at: bar(3), name: 'A2 headlights over the crest', mood: 'dawn',
      moodOver: k => ({ az: azOf(k.stage.v3(1236, 2.4, 0.4), k.stage.v3(1150, 0, 0), -34), el: 5 }),
      draw(c) {
        const { stage, kit, grade } = c, { gt } = c.state;
        const run = new Run(stage, gt[0], 1112, { pace: 0.4 });
        const s = run.s(c.t);
        // over the top the springs let go: the body rises on its wheels and the nose lifts
        const light = Math.exp(-(((s - 1196) / 22) ** 2));
        run.place(c.t, { up: 0.09 * light, pitch: 0.035 * light });
        gt[0].body.position.y += 0.05 * light;
        const cam = stage.v3(1238, 2.4, 0.36), look = run.point(c.t, 0, 0.7, _c);
        kit.aim(cam, look, 15, { shake: 0.05, time: c.T, near: 0.4 });
        grade.dof = 0.8; grade.focus = cam.distanceTo(look); grade.focusRange = 22; grade.streak = 0.7;
      },
    },
    // ======================= B: LIGHT ========================================
    {
      at: bar(5), name: 'B1 the wheel', mood: 'dawn',
      moodOver: k => ({ az: hdgAz(k.stage, 1420, 118), el: 6, fog: [[0.56, 0.42, 0.38], 0.0012] }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const run = new Run(stage, f1[1], 1330, { pace: 0.5, lat: 0, lineK: 0 });
        run.place(c.t);
        new Run(stage, f1[0], 1298, { pace: 0.5, lat: 2.6, lineK: 0 }).place(c.t);
        const car = f1[1], push = ease(c.u);
        const cam = car.local(lerp(4.3, 3.3, push), 0.3, lerp(-4.2, -3.2, push)), look = car.local(1.55, 0.2, -0.7);
        cam.y = Math.max(cam.y, stage.groundAt(cam.x, cam.z) + 0.14);
        kit.aim(cam, look, 21, { shake: 0.2, time: c.T, seed: 3, near: 0.08 });
        grade.dof = 0.7; grade.focus = cam.distanceTo(look); grade.focusRange = 5; grade.streak = 0.4;
      },
    },
    {
      at: bar(7), name: 'B2 down the hill', mood: 'dawn',
      moodOver: k => ({ az: azOf(k.stage.v3(948, 2.6, 0.3), k.stage.v3(860, 0, 0), 150), el: 6.5, fog: [[0.56, 0.42, 0.38], 0.0013] }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const run = new Run(stage, f1[1], 792, { pace: 0.42 }), two = new Run(stage, f1[0], 770, { pace: 0.42, lat: -1.2 });
        run.place(c.t); two.place(c.t);
        const cam = stage.v3(951, 2.9, 0.24), look = run.point(c.t, 0, 0.6, _c);
        look.lerp(stage.v3(880, 0, 1.2, _d), 0.4);
        kit.aim(cam, look, 11, { shake: 0.04, time: c.T, near: 0.4 });
        grade.dof = 0.8; grade.focus = cam.distanceTo(run.car.pos); grade.focusRange = 28; grade.streak = 0.4;
        floorSparks(c, run, c.t, 2.9, 3.6, 1.2);
      },
    },
    // ======================= C: THE PACK =====================================
    {
      at: bar(9), name: 'C1 a full grid into La Source', mood: 'day',
      moodOver: k => ({ az: k.stage.at(180, 0).hdg * -180 / Math.PI + 140, el: 34 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        f1.forEach((car, i) => new Run(stage, car, 70 - Math.floor(i / 2) * 9 - (i % 2) * 4.4, { lat: [2.6, -2.4, 0.5, -0.4, 3.2, -3.1][i % 6], lineK: 0.6 }).place(c.t));
        // down the barrel of the straight, from beyond the corner, a very long lens
        const p = stage.at(238, 0), f = V(Math.cos(p.hdg), 0, -Math.sin(p.hdg));
        const cam = V(p.x, p.y + 9.5, p.z).addScaledVector(f, 96);
        const lead = stage.v3(stage.sAfter(70, c.t), 0, 0.6, _c);
        kit.aim(cam, lead.lerp(stage.v3(160, 0, 0.8, _d), 0.6), 6.6, { shake: 0.03, time: c.T, near: 2 });
        grade.dof = 0.5; grade.focus = cam.distanceTo(lead); grade.focusRange = 110;
      },
    },
    {
      at: bar(11), name: 'C2 the apex kerb', mood: 'day',
      moodOver: k => ({ az: k.stage.at(270, 0).hdg * -180 / Math.PI - 150, el: 30 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const runs = f1.map((car, i) => new Run(stage, car, 236 - i * 13.5 - (i % 2) * 2, { lat: i % 2 ? 1.6 : -0.2, lineK: 1 }));
        runs.forEach(r => r.place(c.t));
        const w = stage.track.w[stage.track.idx(276)];
        const cam = stage.v3(279, -(w + 0.7), 0.17), look = stage.v3(262, -1.2, 0.5, _c);
        kit.aim(cam, look, 34, { shake: 0.6 * smooth(0, 0.6, c.t), time: c.T * 3, seed: 2, near: 0.08 });
        for (const r of runs.slice(0, 5)) floorSparks(c, r, c.t, 0, 9, 0.8);
        grade.dof = 0.35; grade.focus = 9; grade.focusRange = 16;
      },
    },
    {
      at: bar(13), name: 'C3 through Eau Rouge', mood: 'day',
      moodOver: k => ({ az: k.stage.at(940, 0).hdg * -180 / Math.PI + 35, el: 28 }),
      draw(c) {
        const { stage, kit } = c, { f1 } = c.state;
        const a = new Run(stage, f1[0], 902), b = new Run(stage, f1[1], 920, { lat: 2.2 }), d = new Run(stage, f1[2], 936, { lat: -1.6 });
        a.place(c.t); b.place(c.t); d.place(c.t);
        const cam = f1[0].local(-5.4, 0.8, 0.7), look = f1[0].local(8, 0.9, -0.2);
        kit.aim(cam, look, 58, { shake: 0.8, time: c.T * 3.2, seed: 4, near: 0.15 });
        floorSparks(c, b, c.t, 0.25, 1.4, 1.2);
      },
    },
    {
      at: bar(14), name: 'C4 side by side on Kemmel', mood: 'day',
      moodOver: k => ({ az: hdgAz(k.stage, 1560, 100), el: 52, keyEl: 56 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const a = new Run(stage, f1[3], 1500, { lat: -2.1, lineK: 0 }), b = new Run(stage, f1[0], 1493 + c.t * 3.2, { lat: 2.0, lineK: 0 });
        a.place(c.t); b.place(c.t);
        new Run(stage, f1[5], 1462, { lat: -0.4, lineK: 0 }).place(c.t);
        const cam = f1[3].local(12 - c.t * 1.2, 1.0, 7.2), look = f1[3].local(-0.6, 0.55, -1.6);
        kit.aim(cam, look, 17, { shake: 0.3, time: c.T * 2, seed: 6, near: 0.3 });
        grade.dof = 0.5; grade.focus = cam.distanceTo(look); grade.focusRange = 12;
      },
    },
    {
      at: bar(15), name: 'C5 Les Combes from above', mood: 'day',
      moodOver: k => ({ az: hdgAz(k.stage, 2350, 70), el: 50, keyEl: 58 }),
      draw(c) {
        const { stage, kit } = c, { f1 } = c.state;
        f1.forEach((car, i) => new Run(stage, car, 2372 - i * 12.5, { lat: (i % 3 - 1) * 0.6 }).place(c.t));
        const cam = stage.v3(2290, 46, 74), look = stage.v3(2356 + c.t * 4, 0, 0, _c);
        kit.aim(cam, look, 30, { shake: 0.1, time: c.T, seed: 8, near: 2 });
      },
    },
    {
      at: bar(16), name: 'C6 flashes', mood: 'day',
      moodOver: k => ({ az: hdgAz(k.stage, 1660, 110), el: 46, keyEl: 52 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const run = new Run(stage, f1[1], 1620), other = new Run(stage, f1[4], 1604, { lat: 1.4 });
        const tt = c.t + Math.floor(c.b) * 0.7;
        run.place(tt); other.place(tt);
        const car = f1[1], k = Math.floor(c.b);
        if (k === 0) kit.aim(car.local(-3.1, 0.3, 1.5), car.local(-1.5, 0.36, 0.72), 30, { shake: 0.5, time: c.T * 4, near: 0.06 });
        else if (k === 1) { const cam = car.local(9, 0.24, 0.5); kit.aim(cam, car.local(0, 0.5, 0), 26, { shake: 0.5, time: c.T * 4, near: 0.1 }); }
        else if (k === 2) kit.aim(car.local(-0.5, 9, 0.01), car.local(1.2, 0, 0), 40, { roll: 0.2, shake: 0.4, time: c.T * 4 });
        else { kit.aim(car.local(-6, 0.25, -1.4), car.local(0, 0.3, 0), 30, { shake: 0.7, time: c.T * 4, near: 0.08 }); }
        if (k >= 1) floorSparks(c, run, tt, -1, 99, 1.4);
        grade.flash = Math.max(0, 0.5 - (c.b - k) * 3) * (k > 0 ? 1 : 0);
        if (c.b >= 3.5) grade.fade = 0;                 // the hole before the hit
      },
    },
    // ======================= D: NIGHT ========================================
    {
      at: bar(17), name: 'D1 rain on the Kemmel straight', mood: 'night', grade: 'cold',
      moodOver: k => ({ az: azOf(k.stage.v3(1760, -7.6, 0.5), k.stage.v3(1560, 0, 0), 12) }),
      draw(c) {
        const { stage, kit, grade } = c, { gt, f1 } = c.state;
        const runs = [new Run(stage, gt[0], 1560, { lat: -1.5, lineK: 0 }), new Run(stage, gt[1], 1492, { lat: 1.6, lineK: 0 }), new Run(stage, gt[2], 1404, { lat: -0.6, lineK: 0 })];
        runs.forEach(r => { r.place(c.t); spray(c, r, c.t); });
        const cam = stage.v3(1760, -7.4, 0.46), look = stage.v3(1640, -1, 1.5, _c);
        kit.aim(cam, look, 27, { shake: 0.07, time: c.T, near: 0.15 });
        runs.slice(0, 2).forEach((r, i) => {
          const L = stage.spots[i], car = r.car;
          L.intensity = 2600; L.distance = 150; L.angle = 0.36; L.color.setRGB(1, 0.95, 0.86);
          L.position.copy(car.local(1.9, 0.75, 0)); L.target.position.copy(car.local(40, -0.6, 0)); L.target.updateMatrixWorld();
        });
        rain(kit.streaks, c.T, kit.camera, { amount: 1, bright: 0.3 });
        grade.streak = 1.0; grade.flash = Math.max(0, 0.55 - c.t * 2.2);
        void f1;
      },
    },
    {
      at: bar(19), name: 'D2 in the spray', mood: 'night', grade: 'cold',
      moodOver: k => ({ az: k.stage.at(1900, 0).hdg * -180 / Math.PI + 20 }),
      draw(c) {
        const { stage, kit, grade } = c, { gt } = c.state;
        const lead = new Run(stage, gt[1], 1846, { pace: 0.5, lat: 1.2, lineK: 0 }), me = new Run(stage, gt[0], 1828, { pace: 0.5, lat: -1.6, lineK: 0 });
        lead.place(c.t, { brake: c.t > 2.4 ? 1 : 0 }); me.place(c.t);
        spray(c, lead, c.t, { k: 1.25 }); spray(c, me, c.t);
        const cam = gt[0].local(-7.5 + c.t * 0.5, 1.05, -1.9), look = gt[1].local(-1, 0.7, 0);
        cam.y = Math.max(cam.y, stage.groundAt(cam.x, cam.z) + 0.3);
        kit.aim(cam, look, 34, { shake: 0.45, time: c.T * 2, seed: 11, near: 0.15 });
        const L = stage.spots[0];
        L.intensity = 2400; L.distance = 140; L.angle = 0.4; L.color.setRGB(1, 0.95, 0.86);
        L.position.copy(gt[0].local(1.9, 0.75, 0)); L.target.position.copy(gt[0].local(40, -0.5, 0)); L.target.updateMatrixWorld();
        const P = stage.points[0]; P.intensity = c.t > 2.4 ? 60 : 14; P.color.setRGB(1, 0.08, 0.04); P.distance = 26; P.position.copy(gt[1].local(-2.7, 0.7, 0));
        rain(kit.streaks, c.T, kit.camera, { amount: 1, bright: 0.32, fall: 16, wind: [5, 0, 2] });
        grade.streak = 1.1;
      },
    },
    // ======================= E: THE STATEMENT ================================
    {
      at: bar(21), name: 'E1 over the crest', mood: 'golden',
      moodOver: k => ({ az: azOf(k.stage.v3(1228, 4.6, 0.3), k.stage.v3(1150, 0, 0), 42), el: 17, keyEl: 17 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const runs = [new Run(stage, f1[0], 1128, { pace: 0.5 }), new Run(stage, f1[1], 1108, { pace: 0.5, lat: -1.4 }), new Run(stage, f1[2], 1082, { pace: 0.5, lat: 0.8 })];
        runs.forEach((r, i) => {
          const s = r.s(c.t), light = Math.exp(-(((s - 1192) / 20) ** 2));
          r.place(c.t, { up: 0.07 * light, pitch: 0.03 * light });
          // it comes back down on its plank
          const tLand = stage._timeAt(1214) - stage._timeAt(r.s0);
          floorSparks(c, r, c.t, tLand / 0.5 - 0.05, tLand / 0.5 + 0.5, 1.5);
          void i;
        });
        const cam = stage.v3(1232, 4.6, 0.3), look = runs[0].point(Math.min(c.t, 2.4), 0, 0.6, _c);
        kit.aim(cam, look, 21, { shake: 0.1 + 0.5 * smooth(1.8, 2.8, c.t), time: c.T * 2, near: 0.12 });
        grade.dof = 0.55; grade.focus = cam.distanceTo(look); grade.focusRange = 20; grade.streak = 0.5;
        grade.flash = Math.max(0, 0.6 - c.t * 2.5);
      },
    },
    {
      at: bar(23), name: 'E2 three wide into Les Combes', mood: 'golden',
      moodOver: k => ({ az: hdgAz(k.stage, 2200, 48), el: 10 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const lats = [0, 3.1, -3.1, 1.4, -1.6, 0.2, 2.6, -2.4];
        f1.slice(0, 8).forEach((car, i) => new Run(stage, car, 2088 - (i < 3 ? i * 2.5 : 14 + i * 7), { lat: lats[i], lineK: 0.4 }).place(c.t));
        const p = stage.at(2262, 0), f = V(Math.cos(p.hdg), 0, -Math.sin(p.hdg));
        const cam = V(p.x, p.y + 8.5, p.z).addScaledVector(f, 96);
        const lead = stage.v3(stage.sAfter(2088, c.t), 0, 0.6, _c);
        kit.aim(cam, lead, 5.8, { shake: 0.04, time: c.T, near: 2 });
        grade.dof = 0.5; grade.focus = cam.distanceTo(lead); grade.focusRange = 90; grade.streak = 0.4;
      },
    },
    {
      at: bar(24), name: 'E3 on the kerb', mood: 'golden',
      moodOver: k => ({ az: hdgAz(k.stage, 2330, -118), el: 11 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const runs = f1.slice(0, 6).map((car, i) => new Run(stage, car, 2318 - i * 16, { lat: -0.75 + (i % 2) * 1.2 }));
        runs.forEach(r => r.place(c.t));
        const w = stage.track.w[stage.track.idx(2338)];
        const cam = stage.v3(2343, -(w + 1.0), 0.14), look = stage.v3(2322, -(w - 2.2), 0.4, _c);
        kit.aim(cam, look, 30, { shake: 0.9 * smooth(0, 0.5, c.t), time: c.T * 3, seed: 5, near: 0.06 });
        runs.slice(0, 3).forEach(r => floorSparks(c, r, c.t, 0, 9, 1.1));
        grade.dof = 0.3; grade.focus = 8; grade.focusRange = 14; grade.streak = 0.3;
      },
    },
    {
      at: bar(25), name: 'E4 the held wide shot', mood: 'golden',
      moodOver: k => ({ az: azOf(k.stage.v3(884, 8, 13), k.stage.v3(1020, 0, 0), 46), el: 14, keyEl: 14 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        f1.forEach((car, i) => new Run(stage, car, 960 - i * 17 - (i % 2) * 4, { lat: i % 2 ? 0.7 : -0.5 }).place(c.t));
        const cam = stage.v3(884, 8, 13), look = stage.v3(1020, 0, 5, _c);
        kit.aim(cam, look, 40 - c.t * 0.4, { shake: 0.03, time: c.T, near: 2 });
        grade.streak = 0.3; grade.flash = Math.max(0, 0.45 - c.t * 2.5);
      },
    },
    {
      at: bar(27), name: 'E5 with the leader', mood: 'golden',
      moodOver: k => ({ az: hdgAz(k.stage, 1500, -105), el: 20, keyEl: 20 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const run = new Run(stage, f1[0], 1420, { lat: 0, lineK: 0 }), chase = new Run(stage, f1[1], 1404 + c.t * 2.5, { lat: 2.4, lineK: 0 });
        run.place(c.t); chase.place(c.t);
        const car = f1[0], cam = car.local(7.4 - c.t * 0.9, 0.85, -3.6), look = car.local(0.2, 0.5, 0.3);
        kit.aim(cam, look, 27, { shake: 0.35, time: c.T * 2.4, seed: 13, near: 0.15 });
        grade.dof = 0.5; grade.focus = cam.distanceTo(look); grade.focusRange = 7; grade.streak = 0.4;
      },
    },
    {
      at: bar(28), name: 'E6 last flashes', mood: 'golden',
      moodOver: k => ({ az: hdgAz(k.stage, 1980, 75), el: 19, keyEl: 19 }),
      draw(c) {
        const { stage, kit, grade } = c, { f1 } = c.state;
        const k = c.b < 1 ? 0 : c.b < 2 ? 1 : c.b < 3 ? 2 : 3, tt = c.t + k * 0.9;
        const run = new Run(stage, f1[0], 1940), b = new Run(stage, f1[2], 1921, { lat: -1.8 }), d = new Run(stage, f1[4], 1960, { lat: 1.6 });
        run.place(tt); b.place(tt); d.place(tt);
        const car = f1[0];
        if (k === 0) kit.aim(car.local(-0.15, 0.98, 0), car.local(30, 0.7, 0), 62, { shake: 1.1, time: c.T * 5, near: 0.05 });          // over the halo
        else if (k === 1) kit.aim(car.local(2.4, 0.26, -1.6), car.local(1.5, 0.34, -0.74), 28, { shake: 0.6, time: c.T * 5, near: 0.05 });   // front wheel
        else if (k === 2) kit.aim(car.local(16, 0.5, 2.5), car.local(0, 0.5, 0), 14, { shake: 0.4, time: c.T * 5, near: 0.2 });          // head on
        else kit.aim(car.local(-9, 0.4, 0.8), car.local(0, 0.45, 0), 22, { shake: 0.8, time: c.T * 5, near: 0.1 });
        floorSparks(c, run, tt, -1, 99, 1.5);
        grade.streak = 0.4; grade.flash = Math.max(0, 0.5 - (c.b - Math.floor(c.b)) * 3);
        if (c.b >= 3.5) grade.fade = 0;
      },
    },
    // ======================= F: TITLE ========================================
    {
      at: bar(29), name: 'F title', mood: 'night', grade: 'cold',
      moodOver: k => ({ az: azOf(k.stage.v3(1700, 0, 0.4), k.stage.v3(1560, 0, 0), 0), fog: [[0.012, 0.016, 0.03], 0.0035] }),
      draw(c) {
        const { stage, kit, grade } = c, { gt } = c.state;
        // far down a wet straight, out of focus: one pair of headlights that never quite arrives
        const run = new Run(stage, gt[0], 1340, { pace: 0.2, lat: 0, lineK: 0 });
        run.place(c.t);
        const cam = stage.v3(1720, 0.6, 0.4), look = stage.v3(1560, 0, 1.3, _c);
        kit.aim(cam, look, 16, { shake: 0.03, time: c.T, near: 0.3 });
        const L = stage.spots[0];
        L.intensity = 3000; L.distance = 220; L.angle = 0.3; L.color.setRGB(1, 0.95, 0.86);
        L.position.copy(gt[0].local(1.9, 0.75, 0)); L.target.position.copy(gt[0].local(50, -0.5, 0)); L.target.updateMatrixWorld();
        rain(kit.streaks, c.T, kit.camera, { amount: 0.5, bright: 0.3 });
        grade.dof = 1; grade.focus = 3; grade.focusRange = 6; grade.streak = 2.2;
        grade.fade = 0.5 * smooth(0, 1.2, c.t) * (1 - smooth(6.6, 8, c.t) * 0.55);
        grade.flash = Math.max(0, 0.9 - c.t * 3);
      },
    },
  ],

  captions: [
    { at: 2, to: 13, cls: 'slug', html: '<b>SPA-FRANCORCHAMPS</b> &nbsp;·&nbsp; 06:14', fin: 0.8, fout: 0.8 },
    { at: 17, to: 23, cls: 'big low', html: 'REAL CIRCUITS.', fin: 0.12, fout: 0.3 },
    { at: 25, to: 31.5, cls: 'big low', html: 'MEASURED TO THE METRE.', fin: 0.12, fout: 0.3 },
    { at: 33, to: 39.5, cls: 'big low', html: 'A FULL GRID.', fin: 0.08, fout: 0.2 },
    { at: 66, to: 71.5, cls: 'big low', html: 'ANY HOUR.', fin: 0.25, fout: 0.3 },
    { at: 73, to: 79, cls: 'big low', html: 'ANY WEATHER.', fin: 0.12, fout: 0.3 },
    { at: 97, to: 103.5, cls: 'big low', html: 'EVERY CORNER, EARNED.', fin: 0.12, fout: 0.3 },
    { at: 112, to: 128, cls: 'title', html: 'XB<i>R</i>', fin: 0.05 },
    { at: 116, to: 128, cls: 'rule', html: '', fin: 0.6 },
    { at: 120, to: 128, cls: 'motto', html: 'RACING FOR ALL', fin: 0.9 },
    { at: 124, to: 128, cls: 'fine', html: 'real circuits · real physics · no shortcuts', fin: 1.0 },
  ],
});
void wobble; void rnd; void easeOut;
