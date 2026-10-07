// terrain.js — the ground as a SURFACE the car stands on, not a lap-distance lookup.
//
// Adam, 2026-10-06, after driving the Steilwand the wrong way round and
// watching his car lean out of it: "youve just been cutting corners with like
// if on the track in this section just tilt this degrees ... the car should
// fall untill it finds ground and rotate and rol and flip and jump with the
// ground". He was right. The tilt, the banking force and the slope were each
// read off "where on the lap is this car" and applied in the TRACK's
// direction, whichever way the car was pointing.
//
// This is the one surface: the surveyed height of the road at s, plus the
// banking's own shape across it (js/bank.js, the same function the road mesh
// is built from). Everything a car needs from the ground is taken from the
// heights under its four wheels, IN THE CAR'S FRAME:
//
//   pitch, roll   the plane those four heights make — what the car is drawn at
//   gx, gy        that plane's rise per metre forward and to the left — what
//                 gravity does to it (physics.js env.slope / env.bank)
//   lift()        how fast the ground is curving away along the car's ACTUAL
//                 path, sideways included. More than gravity and downforce can
//                 follow, and the car has left it.
//
// NOTHING HERE MAY IMPORT A RENDERER.
import { bankTable, bankY } from './bank.js';

const AX = 1.35, AY = 0.80;      // half the wheelbase and half the track, near enough for every car here

export class Terrain {
  // roadY(s): the height of the road's centreline at lap distance s (or null: a flat circuit)
  constructor(track, roadY = null) {
    this.t = track; this.roadY = roadY;
    this.table = track.bank && track.bank.some(v => v) ? bankTable(track) : null;
  }
  h(s, lat) {
    const t = this.t;
    let y = this.roadY ? this.roadY(s) : 0;
    if (this.table) {
      const f = ((s / t.ds) % t.n + t.n) % t.n, i = Math.floor(f), j = (i + 1) % t.n, k = f - i;
      y += bankY(this.table, t, i, lat) * (1 - k) + bankY(this.table, t, j, lat) * k;
    }
    return y;
  }
  // The plane under the four wheels, written to car.gnd and returned.
  under(car, pr) {
    const th = car.hdg - this.t.hdg[pr.i], c = Math.cos(th), s = Math.sin(th);
    // a point (fx ahead, fy left) of the car is (fx c - fy s) along the lap and (fx s + fy c) across it
    const H = (fx, fy) => this.h(pr.s + fx * c - fy * s, pr.lat + fx * s + fy * c);
    const fl = H(AX, AY), fr = H(AX, -AY), rl = H(-AX, AY), rr = H(-AX, -AY);
    const g = car.gnd || (car.gnd = { pitch: 0, roll: 0, gx: 0, gy: 0, bank: 0, dir: 0 });
    g.dPitch = -g.pitch; g.dRoll = -g.roll;
    g.gx = (fl + fr - rl - rr) / (4 * AX);            // rise per metre forward
    g.gy = (fl + rl - fr - rr) / (4 * AY);            // rise per metre to the left
    g.pitch = Math.atan(g.gx); g.roll = Math.atan(g.gy);
    g.dPitch += g.pitch; g.dRoll += g.roll;           // how far the ground turned under it this tick
    g.bank = Math.abs(g.roll) * 180 / Math.PI; g.dir = -Math.sign(g.gy);   // high side right pushes it left
    return g;
  }
  // m/s2, + = the ground is falling away from under the car along the path it is on.
  lift(car, pr) {
    const v = Math.hypot(car.vx, car.vy);
    if (v < 1) return 0;
    const th = car.hdg + Math.atan2(car.vy, car.vx) - this.t.hdg[pr.i];
    const d = Math.max(3, v * 0.06), ds = Math.cos(th) * d, dl = Math.sin(th) * d;
    return -v * v * (this.h(pr.s + ds, pr.lat + dl) - 2 * this.h(pr.s, pr.lat) + this.h(pr.s - ds, pr.lat - dl)) / (d * d);
  }
}

// A road's height from its gradient alone (js/main.js hands the race slopeAt
// and nothing else). Only differences of it are ever used, so where zero is
// does not matter.
export function heightFromSlope(track, slopeAt) {
  const n = track.n, ds = track.ds, H = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) H[i + 1] = H[i] + slopeAt((i + 0.5) * ds) * ds;
  const drift = H[n] / n;                             // a lap ends where it began
  for (let i = 0; i <= n; i++) H[i] -= drift * i;
  return s => { const f = ((s / ds) % n + n) % n, i = Math.floor(f); return H[i] + (H[i + 1] - H[i]) * (f - i); };
}
