// gt-plan.js — the choreography of the GT film, as PURE MATHS.
//
// Where both cars are and where the camera is, for every second of the film,
// worked out from the clock and the surveyed Nordschleife — no renderer, no
// DOM. js/ads/gt.js draws what this says; js/ads/gt-check.mjs runs the SAME
// functions in Node and proves, without a single frame being rendered, that
// the tyre lands on the stripe, that the cars are in frame, and that the two
// of them never touch.
//
// `stage` is anything with at(s, lat, out) / v3(s, lat, up, out) — the real
// js/ads/stage.js Stage in the browser, a twelve-line stand-in in Node.
//
// Frames: s is metres round the lap, lat metres LEFT of the centreline. A
// car's own frame is x forward, y up, z right (the packs' frame).
import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const ease = k => { k = clamp(k); return k * k * (3 - 2 * k); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---- the two cars (numbers measured from data/cars/*/car.json and car.bin) ----
export const G4 = {
  key: 'g55', wb: 2.457, halfW: 0.953, front: 2.165, rear: -2.165, wheelX: 1.2285, wheelZ: 0.8145, wheelR: 0.3261,
  head: [1.9, 0.57, 0.63], tail: [-2.07, 0.6, 0.43],
};
export const G3 = {
  key: 'm720', wb: 2.548, halfW: 1.002, front: 2.369, rear: -2.13, wheelX: 1.2742, wheelZ: 0.79, wheelR: 0.33,
  head: [2.02, 0.52, 0.74], tail: [-1.97, 0.66, 0.6],
};

// ---- the kerb ------------------------------------------------------------------
// Galgenkopf, the right-hander at 17.3 km that leads onto the Döttinger Höhe.
// stage.js lays its inside kerb from 17284 to 17322 m on the right, 1.10 m
// wide, in one-metre blocks; the block from 17298 to 17299 m is a white one.
// THAT is the stripe. The hero's right-front tyre crosses its middle, 45 cm in
// from the edge of the road, every time he comes through.
export const KERB = {
  s: 17298.5,               // the middle of the stripe
  lat: -4.7,                // where on it the tyre runs (the road ends at -4.25, the kerb at -5.35)
  top: 0.055,               // how far the kerb stands above the road
  s0: 17298, s1: 17299, in: -4.25, out: -5.35,
};
KERB.sC = KERB.s - G4.wheelX;                 // where the car's MIDDLE is when the front tyre is on it
KERB.L = KERB.lat + G4.wheelZ;                // and how far left of centre the car's middle is then

// A lateral position as a function of distance: smooth between apexes.
export function path(keys) {
  return s => {
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 0; i + 1 < keys.length; i++) {
      const a = keys[i], b = keys[i + 1];
      if (s < b[0]) return a[1] + (b[1] - a[1]) * ease((s - a[0]) / (b[0] - a[0]));
    }
    return keys[keys.length - 1][1];
  };
}
// the hero's line through Galgenkopf — the same function in every kerb shot,
// which is what "the same stripe, to the centimetre" means
export const heroLine = path([[17205, 1.2], [17243, 2.5], [KERB.sC, KERB.L], [17349, 1.9], [17389, -2.4], [17440, 2.0], [17539, -2.9], [17650, 2.3], [17730, 0]]);
// the GT3's: tidy, a little wider, never on the kerb
const rivalLine = path([[17205, 0.8], [17243, 2.2], [17299, -2.55], [17349, 1.5], [17389, -2.1], [17440, 1.8], [17539, -2.7], [17650, 2.0], [17730, 0]]);
const exitLine = path([[16690, 2.9], [16768, -2.5], [16850, -0.8]]);       // out of the Schwalbenschwanz left-hander

/** A point in a posed car's own frame, in the world. */
export function local(pose, x, y, z, out = V()) {
  return out.set(x, y, z).applyQuaternion(pose.quat).add(pose.pos);
}

const _e = new THREE.Euler();
/**
 * Stand a car on the circuit. d = { s, L, dL (dL/ds), yaw, pitch, roll, up, brake, dist, spec }.
 * Heading comes from where the car is GOING (so it follows its own line), the
 * attitude from the road under it.
 */
export function pose(stage, d) {
  const { s, L, dL = 0, spec } = d;
  const p = stage.at(s, L, {}), a = stage.at(s - 1.6, L - 1.6 * dL, {}), b = stage.at(s + 1.6, L + 1.6 * dL, {});
  const hdg = Math.atan2(-(b.z - a.z), b.x - a.x);
  const slope = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
  const l = stage.at(s, L + 0.8, {}), r = stage.at(s, L - 0.8, {});
  const camber = Math.atan2(l.y - r.y, 1.6);
  // the right-hand wheels climbing the kerb: 5.5 cm, across a 1.63 m track
  let roll = d.roll || 0, up = d.up || 0;
  if (d.kerb) {
    const k = smooth(KERB.in + 0.1, KERB.in - 0.05, L - spec.wheelZ) * smooth(17282, 17285, s) * (1 - smooth(17321, 17324, s));
    roll -= Math.atan(KERB.top * k / (2 * spec.wheelZ)); up += KERB.top * k / 2;
  }
  // which way the road bends where the car is, for the front wheels
  const a2 = stage.at(s - 4, L - 4 * dL, {}), b2 = stage.at(s + 4, L + 4 * dL, {}), c2 = stage.at(s + 8, L + 8 * dL, {});
  let dh = Math.atan2(-(c2.z - b2.z), c2.x - b2.x) - Math.atan2(-(b2.z - a2.z), b2.x - a2.x);
  while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  const steer = clamp(Math.atan(spec.wb * dh / 6) * 1.1, -0.5, 0.5) + (d.steer || 0);
  const yaw = d.yaw || 0;
  _e.set(camber + roll, hdg + yaw, slope + (d.pitch || 0), 'YZX');
  const quat = new THREE.Quaternion().setFromEuler(_e);
  return {
    spec, s, L, pos: V(p.x, p.y + up, p.z), roadY: p.y, quat, fwd: V(1, 0, 0).applyQuaternion(quat),
    hdg: hdg + yaw, steer, brake: d.brake || 0, dist: d.dist ?? s, dive: d.dive || 0,
    v: d.v || 0,
  };
}
// a lateral line sampled at s, with its slope
const on = (line, s) => ({ L: line(s), dL: (line(s + 1) - line(s - 1)) / 2 });
// a lateral position that is a function of TIME, turned into a slope along the road
const onT = (f, t, v) => ({ L: f(t), dL: (f(t + 0.02) - f(t - 0.02)) / 0.04 / Math.max(1, v) });

// The locked camera on the kerb: just inside the corner, 1.9 m up, looking back
// up the road. Hook, defence and the last shot all use exactly this.
const camK = stage => ({ pos: stage.v3(17303.6, -5.95, 1.9), look: stage.v3(17288.5, -1.4, 0.45), fov: 50, near: 0.2 });

// what a steering wheel does on a long wet straight: almost nothing, all the time
const calm = T => 0.045 * Math.sin(T * 1.9) + 0.028 * Math.sin(T * 3.3 + 1.2) + 0.012 * Math.sin(T * 7.1);

// ---------------------------------------------------------------------------
// THE SHOTS. `at` is seconds into the film. fn(stage, t, T) -> what is where.
//   g4 / g3   car descriptors for pose() (absent = not in this shot)
//   cam       { pos, look, fov, near, shake } or { car: 'g4', at: [x,y,z], to: [x,y,z], ... } in a car's frame
//   x         everything else the picture needs (see gt.js)
// ---------------------------------------------------------------------------
export const SHOTS = [
  // ============================== THE HOOK ===================================
  {
    at: 0, name: 'H1 the kerb, rain', sound: 'quiet',
    fn: (st, t) => ({ cam: camK(st), x: { rain: 1, fade: smooth(0.0, 1.5, t), exposure: 2.3, moon: 1 } }),
  },
  {
    at: 3.0, name: 'H2 the tyre on the stripe', sound: 'loud',
    fn: (st, t) => {
      const v = 7, s = KERB.sC + v * (t - 0.5);
      return {
        g4: { s, ...on(heroLine, s), kerb: true, v },
        cam: { pos: st.v3(17300.75, -5.95, 0.22), look: st.v3(KERB.s - 0.3, KERB.lat + 0.1, 0.3), fov: 55, near: 0.1, shake: 0.25 },
        x: { rain: 1, exposure: 1.5, glare: 0.2, fill: [st.v3(17300.4, -6.0, 1.1), 3, [0.55, 0.65, 1.0]] },
      };
    },
  },
  {
    at: 4.2, name: 'H3 the hand, the tag', sound: 'cabin',
    fn: (st, t, T) => {
      const v = 50, s = 19300 + v * t;
      return {
        g4: { s, L: 0.3 * Math.sin(T * 0.5), dL: 0, v },
        cam: { car: 'g4', at: [-0.92 + 0.03 * t, 0.95, -0.09], to: [0.02, 0.85, -0.09], fov: 46, near: 0.05, shake: 0.12 },
        x: { cabin: 'hand', wheel: calm(T), drops: [1.0, 0.82, 0.6, 0.55], dash: 0.75 },
      };
    },
  },
  {
    at: 7.0, name: 'H4 light on the trees', sound: 'loud',
    fn: (st, t) => {
      const v = 38, s = 17906 + v * (t - 1.45);
      return {
        g4: { s, L: 0, dL: 0, v },
        cam: { pos: st.v3(17900, -6.3, 1.25), look: st.v3(17916, 9, 3.2), fov: 44, near: 0.2, shake: 0.06 + 0.5 * smooth(1.2, 1.5, t) * (1 - smooth(1.5, 2.1, t)) },
        x: { rain: 1, spray: 1, beam: 0.52, exposure: 1.35, trees: smooth(0.1, 1.25, t) * (1 - smooth(1.4, 1.75, t)) },
      };
    },
  },
  {
    at: 9.2, name: 'H5 the mirror', sound: 'cabin',
    fn: (st, t, T) => {
      const v = 52, s = 19500 + v * t;
      return {
        g4: { s, L: 0.2, dL: 0, v },
        cam: { car: 'g4', at: [-0.52, 0.935, -0.34], to: [0.42, 0.885, -1.03], fov: 24 - 1.2 * ease(t / 2.8), near: 0.05, shake: 0.08 },
        x: { cabin: 'mirror', wheel: calm(T), mirrorGap: lerp(95, 13, ease(clamp((t - 0.35) / 2.45))), mirrorOn: smooth(0.3, 0.9, t), drops: [0.7, 0.8, 1.0, 0.4], dash: 0.5 },
      };
    },
  },
  // ============================== THE DEFENCE ================================
  {
    at: 12.0, name: 'D1 warm ahead, cold behind', sound: 'loud',
    fn: (st, t) => {
      const v = 46, s = 16290 + v * t, gap = 15 - 1.2 * t;
      return {
        g4: { s, L: -0.3, dL: 0, v }, g3: { s: s - gap, L: 1.3, dL: 0, v },
        cam: { pos: st.v3(s + 27 - 0.9 * t, -0.6, 4.0), look: st.v3(s - 4, 0.2, 0.7), fov: 15, near: 1, shake: 0.05 },
        x: { rain: 1, spray: 1, camV: v, lamp: 0.07 },
      };
    },
  },
  {
    at: 16.5, name: 'D2 the same stripe', sound: 'loud',
    fn: (st, t) => {
      const v = 24, s = KERB.sC + v * (t - 1.55), s3 = s - 10.5;
      return {
        g4: { s, ...on(heroLine, s), kerb: true, v }, g3: { s: s3, ...on(rivalLine, s3), v },
        cam: camK(st), x: { rain: 1, spray: 1, exposure: 1.3, glare: 0.45 },
      };
    },
  },
  {
    at: 19.5, name: 'D3 one car\'s width', sound: 'loud',
    fn: (st, t) => {
      const v = 45, s = 16215 + v * t;
      const gap = 8.5 - 2.6 * smooth(1.2, 3.4, t) + 3 * smooth(4.0, 5.5, t), s3 = s - gap;
      // the road is 4.25 m to its edge; he sits so that exactly one GT3 (2.004 m) fits beside him
      const hold = -4.25 + 2 * G3.halfW + G4.halfW;
      const L4 = u => lerp(-0.5, hold, smooth(0.6, 1.8, u));
      const L3 = u => lerp(lerp(-0.5, -4.25 + G3.halfW + 0.004, smooth(1.0, 2.4, u)), hold, smooth(3.8, 5.0, u));
      return {
        g4: { s, ...onT(L4, t, v), v }, g3: { s: s3, ...onT(L3, t, v), v },
        cam: { pos: st.v3(s3 - 10, 0.55 * L3(t) - 0.75, 3.4), look: st.v3(s + 8, -1.9, 0.3), fov: 36, near: 0.5, shake: 0.1 },
        x: { rain: 1, spray: 1, camV: v, room: hold - G4.halfW + 4.25 },
      };
    },
  },
  {
    at: 25.0, name: 'D4 the disc', sound: 'loud',
    fn: (st, t) => {
      const s = 16255 + 6.5 * t - 0.325 * t * t, v = 6.5 - 0.65 * t, e = ease(t / 5.5), brake = smooth(0.4, 1.1, t);
      return {
        g4: { s, L: -0.4, dL: 0, brake, v, dive: brake },
        cam: { car: 'g4', at: [lerp(2.3, 1.72, e), 0.36, lerp(-4.4, -2.9, e)], to: [G4.wheelX, 0.33, -G4.wheelZ], fov: 30, near: 0.1, shake: 0.05 },
        x: { rain: 1, spray: 0.35, disc: smooth(0.9, 4.7, t), camV: v, exposure: 1.5, fillCar: [[1.6, 0.9, -3.4], 2.2, [0.5, 0.62, 1.0]] },
      };
    },
  },
  {
    at: 30.5, name: 'D5 the one flaw', sound: 'loud',
    fn: (st, t) => {
      const v = 13, s3 = 16712 + v * t, s = s3 + 10 + 0.8 * t;
      // the tail steps out, is caught, settles: four degrees, then one the other way
      const yaw = 0.075 * (smooth(1.45, 1.72, t) - smooth(1.8, 2.15, t)) - 0.022 * (smooth(2.1, 2.3, t) - smooth(2.3, 2.6, t));
      const g3 = { s: s3, L: exitLine(s3) - 0.3, dL: (exitLine(s3 + 1) - exitLine(s3 - 1)) / 2, yaw, steer: -yaw * 1.6, v };
      const cs = s3 - 8.5;
      return {
        g4: { s, ...on(exitLine, s), v }, g3,
        cam: { pos: st.v3(cs, exitLine(s3) + 0.1, 2.1), look: st.v3(s3 + 5, exitLine(s3 + 5) - 0.1, 0.5), fov: 36, near: 0.5, shake: 0.08 },
        x: { rain: 1, spray: 0.8, camV: v, twitch: yaw },
      };
    },
  },
  {
    at: 34.5, name: 'D6 he does not react', sound: 'cabin',
    fn: (st, t, T) => {
      const v = 50, s = 17690 + v * t;
      return {
        g4: { s, L: 0, dL: 0, v },
        cam: { car: 'g4', at: [-0.55, 0.98, 0.22 - 0.02 * t], to: [0.05, 0.8, -0.4], fov: 40, near: 0.05, shake: 0.1 },
        x: { cabin: 'hand', wheel: calm(T), mirrorGap: 9.5, mirrorOn: 1, drops: [0.7, 0.8, 1.0, 0.5], dash: 0.6, coldBehind: 1 },
      };
    },
  },
  {
    at: 38.0, name: 'D7 patient', sound: 'loud',
    fn: (st, t) => {
      const v = 52, s3 = 17700 + v * t, s = s3 + 12;
      return {
        g4: { s, L: 0, dL: 0, v }, g3: { s: s3, L: 0, dL: 0, v },
        cam: { pos: st.v3(s3 + 9.2 - 0.28 * t, lerp(-0.9, -0.5, t / 3.5), 0.62), look: st.v3(s3 + 1.6, 0, 0.55), fov: 34, near: 0.2, shake: 0.1 },
        x: { rain: 1, spray: 1, camV: v, tailOn: 'g4', lamp: 0.07 },
      };
    },
  },
  {
    at: 41.5, name: 'D8 onto the long straight', sound: 'loud',
    fn: (st, t) => {
      const v = 54, s = 17815 + v * t;
      return {
        g4: { s, L: 0.4, dL: 0, v }, g3: { s: s - 9, L: -0.6, dL: 0, v },
        cam: { pos: st.v3(17832, -1.0, 8.0), look: st.v3(17990, 0, 0.5), fov: 27 - 2 * ease(t / 3.5), near: 1, shake: 0.04 },
        x: { rain: 1, spray: 1 },
      };
    },
  },
  // ============================== THE LOSS ===================================
  {
    at: 45.0, name: 'L1 he covers', sound: 'loud',
    fn: (st, t) => {
      const v = 58, s = 18150 + v * t, s3 = s - 8;
      const L3 = u => 2.3 * (smooth(0.5, 1.5, u) - smooth(2.5, 3.5, u)), L4 = u => 2.0 * smooth(0.9, 1.9, u);
      return {
        g4: { s, ...onT(L4, t, v), v }, g3: { s: s3, ...onT(L3, t, v), v },
        cam: { pos: st.v3(s3 - 13, 0.5 * L3(t), 5.2), look: st.v3(s + 4, 0.5 * L4(t) + 0.25 * L3(t), 0.3), fov: 32, near: 1, shake: 0.08 },
        x: { rain: 1, spray: 1, camV: v },
      };
    },
  },
  {
    at: 49.0, name: 'L2 and again', sound: 'loud',
    fn: (st, t) => {
      const v = 58, s = 18400 + v * t, s3 = s - 7.5;
      const L4 = u => lerp(2.0, -1.7, smooth(0.9, 2.2, u));
      const L3 = u => lerp(lerp(0, -2.6, smooth(0.2, 1.0, u)), -1.7, smooth(1.6, 2.6, u));
      return {
        g4: { s, ...onT(L4, t, v), v }, g3: { s: s3, ...onT(L3, t, v), v },
        cam: { pos: st.v3(s + 62 - 2 * t, 0, 1.5), look: st.v3(s - 3, 0.45 * (L4(t) + L3(t)), 0.75), fov: 10, near: 2, shake: 0.03 },
        x: { rain: 1, spray: 1, camV: v, lamp: 0.07 },
      };
    },
  },
  {
    at: 52.5, name: 'L3 the feint', sound: 'loud',
    fn: (st, t) => {
      const v = 58, s = 18600 + v * t, gap = 7.5 - 3.3 * smooth(1.8, 3.0, t), s3 = s - gap;
      const L4 = u => lerp(-1.7, 1.3, smooth(0.8, 1.8, u));
      const L3 = u => lerp(lerp(-1.7, 1.0, smooth(0.3, 1.0, u)), -2.05, smooth(1.4, 2.2, u));
      return {
        g4: { s, ...onT(L4, t, v), v }, g3: { s: s3, ...onT(L3, t, v), v },
        cam: { pos: st.v3(s3 - 12, 0.4 * L3(t), 3.4), look: st.v3(s + 5, 0.35 * (L3(t) + L4(t)), 0.4), fov: 34, near: 0.5, shake: 0.12 },
        x: { rain: 1, spray: 1, camV: v },
      };
    },
  },
  {
    at: 55.5, name: 'L4 through, clean', sound: 'loud',
    fn: (st, t) => {
      const v = 58, s = 18780 + v * t, s3 = s - 4.2 + 12.5 * t;
      return {
        g4: { s, L: 1.3, dL: 0, v }, g3: { s: s3, L: -2.05, dL: 0, v: v + 12.5 },
        cam: { pos: st.v3(s + 12, -0.5, 0.75), look: st.v3(s, -0.2 + 0.9 * smooth(1.1, 1.6, t), 0.6), fov: 46 - 6 * smooth(1.1, 1.7, t), near: 0.2, shake: 0.12 + 0.9 * smooth(0.75, 1.0, t) * (1 - smooth(1.1, 1.45, t)) },
        x: { rain: 1, spray: 1, camV: v, lamp: 0.07, flash: 0.28 * smooth(0.85, 1.05, t) * (1 - smooth(1.05, 1.4, t)) },
      };
    },
  },
  {
    at: 57.2, name: 'L5 tail lamps, leaving', sound: 'after',
    fn: (st, t) => {
      const v = 57, s = 18900 + v * t, s3 = s + 14 + 11 * t;
      const L4 = lerp(1.3, 0.4, smooth(0.2, 2.6, t)), L3 = lerp(-2.05, -0.3, smooth(0.3, 2.0, t));
      return {
        g4: { s, L: L4, dL: 0, v }, g3: { s: s3, L: L3, dL: 0, v: v + 11 },
        cam: { pos: st.v3(s - 11, L4 * 0.8 + 0.2, 2.5), look: st.v3(s + 24, lerp(L4, L3, 0.5), 1.0), fov: 30, near: 0.5, shake: 0.06 },
        x: { rain: 1, spray: 1, camV: v },
      };
    },
  },
  // ============================== THE PAIN ===================================
  {
    at: 60.0, name: 'P1 alone', sound: 'pain',
    fn: (st, t) => {
      const v = 54, s = 19080 + v * t;
      // he lifts: half a second, the nose settles a few millimetres, then he is back on it
      const lift = smooth(1.2, 1.3, t) * (1 - smooth(1.62, 1.75, t));
      return {
        g4: { s, L: 0.2, dL: 0, v, pitch: -0.007 * lift, dive: 0.5 * lift },
        cam: { pos: st.v3(s + 11 + 1.6 * t, 2.5, 3.4 + 0.5 * t), look: st.v3(s, 0.2, 0.5), fov: 24, near: 0.5, shake: 0.04 },
        x: { rain: 1, spray: 1 - 0.4 * lift, camV: v, lift, lamp: 0.16 },
      };
    },
  },
  {
    at: 63.2, name: 'P2 wipers, the tag, red', sound: 'paincabin',
    fn: (st, t, T) => {
      const v = 55, s = 19300 + v * t, s3 = s + 40 + 12 * t;
      return {
        g4: { s, L: 0, dL: 0, v }, g3: { s: s3, L: 0, dL: 0, v: v + 12 },
        cam: { car: 'g4', at: [-0.74 + 0.02 * t, 0.86, 0.03], to: [0.3, 0.905, 0.03], fov: 28, near: 0.05, shake: 0.07 },
        x: { cabin: 'tag', wheel: calm(T) * 0.6, drops: [1.0, 0.16, 0.1, 0.95 - 0.12 * t], dash: 0.25, tagRed: 1 - 0.16 * t },
      };
    },
  },
  {
    at: 66.8, name: 'P3 the stripe, alone', sound: 'pain',
    fn: (st, t) => {
      const v = 23, s = KERB.sC + v * (t - 1.5);
      return { g4: { s, ...on(heroLine, s), kerb: true, v }, cam: camK(st), x: { rain: 1, spray: 1, exposure: 1.3, glare: 0.45, fade: 1 - smooth(2.45, 3.0, t) } };
    },
  },
  {
    at: 69.8, name: 'END black', sound: 'end',
    fn: st => ({ cam: camK(st), x: { rain: 0, fade: 0 } }),
  },
];
export const DURATION = 72;
SHOTS.forEach((s, i) => { s.end = i + 1 < SHOTS.length ? SHOTS[i + 1].at : DURATION; s.index = i; });

/** Everything about one moment of one shot: poses, the camera in the world. */
export function resolve(stage, shot, t) {
  const P = shot.fn(stage, t, shot.at + t);
  const out = { shot, t, T: shot.at + t, x: P.x || {}, g4: null, g3: null };
  if (P.g4) out.g4 = pose(stage, { ...P.g4, spec: G4 });
  if (P.g3) out.g3 = pose(stage, { ...P.g3, spec: G3 });
  const c = P.cam;
  if (c.car) { const p = out[c.car]; out.cam = { ...c, pos: local(p, ...c.at), look: local(p, ...c.to), inside: true }; }
  else out.cam = c;
  return out;
}
export function shotAt(T) { let s = SHOTS[0]; for (const k of SHOTS) if (k.at <= T + 1e-6) s = k; return s; }
