// replay.js — instant replay, cut by a television director.
//
// Adam, 2026-09-28: "Replays / TV director — watch back your overtake from
// broadcast cameras."
//
// The recorder keeps the last REPLAY_S seconds of every car's POSE — never its
// full physics state — at a fixed 30 Hz of SIM time. Playing back therefore
// cannot disturb the race: the sim is paused, the recorded poses are written
// over the live ones for the frames that are drawn, and the live poses are put
// back, field for field, the moment the replay ends. Nothing downstream of the
// renderer can tell a replay frame from a live one, which is the point — the
// car, the field, the camera rigs and the 360-degree sound all simply work.
//
// The director is the part that makes it read as television. Real broadcast
// direction is a small set of rules, and these are the ones applied:
//   - hold a shot 3-7 s, never shorter than the eye needs to find the car;
//   - trackside cameras carry most of it, because they are what TV looks like;
//   - cut to an onboard or the T-cam for the moment of commitment — a braking
//     zone, a move, a contact — because that is where the viewer wants to be;
//   - drop to slow motion around contact, and come back to speed after.
// A human can take the cameras over at any time with the camera button.
//
// Pure data + one director. No DOM, no three.js: main.js wires the keys and
// the label, render.js is only ever driven through view.setMode().

export const REPLAY_S = 90;          // seconds kept
export const REPLAY_HZ = 30;         // recorded frames per SIM second
const FIELDS = ['x', 'y', 'hdg', 'z', 'pitch', 'roll', 'speed', 'vx', 'vy', 'r',
  'delta', 'brake', 'throttle', 'slipR', 'gLat', 'gLong'];
const NF = FIELDS.length;
const FLAGS = ['drsOpen', 'airborne'];

export class Replay {
  constructor(cars) {
    this.cars = cars;                          // array of physics car objects
    this.n = cars.length;
    this.cap = REPLAY_S * REPLAY_HZ;
    this.buf = new Float32Array(this.cap * this.n * NF);
    this.flag = new Uint8Array(this.cap * this.n);
    this.time = new Float64Array(this.cap);
    this.head = 0; this.count = 0;
    this.nextT = 0;
    // Damage changes rarely, so it is kept as a list of (frame, car, copy)
    // events rather than per frame — a lost wing must not appear before the
    // crash that took it off.
    this.dmg = [];
    this._last = cars.map(c => this._dmgKey(c));
    this._prev = cars.map(c => ({ lost: c.lost ? { ...c.lost } : null, crush: c.crush ? { ...c.crush } : null }));
    this.playing = false;
  }

  _dmgKey(c) {
    return JSON.stringify([c.lost || null, c.crush || null]);
  }

  /** Call once per rendered frame with the sim clock. */
  record(simT) {
    if (this.playing) return;
    if (simT < this.nextT) return;
    this.nextT = simT + 1 / REPLAY_HZ;
    const f = this.head, base = f * this.n * NF;
    for (let k = 0; k < this.n; k++) {
      const c = this.cars[k], o = base + k * NF;
      for (let j = 0; j < NF; j++) this.buf[o + j] = c[FIELDS[j]] || 0;
      this.flag[f * this.n + k] = (c.drsOpen ? 1 : 0) | (c.airborne ? 2 : 0);
      const key = this._dmgKey(c);
      if (key !== this._last[k]) {
        this._last[k] = key;
        this.dmg.push({ t: simT, k, lost: c.lost ? { ...c.lost } : null, crush: c.crush ? { ...c.crush } : null,
                        was: this._prev[k] });
        this._prev[k] = { lost: c.lost ? { ...c.lost } : null, crush: c.crush ? { ...c.crush } : null };
      }
    }
    this.time[f] = simT;
    this.head = (f + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    // forget damage events older than the buffer
    const oldest = this.time[this._slot(0)];
    while (this.dmg.length > 1 && this.dmg[0].t < oldest - 1 && this.dmg[1].t < oldest) this.dmg.shift();
  }

  /** Ring slot of the i-th oldest recorded frame. */
  _slot(i) { return (this.head - this.count + i + this.cap) % this.cap; }

  get span() { return this.count < 2 ? 0 : this.time[this._slot(this.count - 1)] - this.time[this._slot(0)]; }

  /**
   * Begin playback `back` seconds before the newest frame. Saves the live
   * pose of every car so stop() can hand the race back exactly as it was.
   */
  start(back = 20, marks = []) {
    if (this.count < REPLAY_HZ) return false;
    this.live = this.cars.map(c => {
      const o = {};
      for (const f of FIELDS) o[f] = c[f];
      for (const f of FLAGS) o[f] = c[f];
      o.lost = c.lost; o.crush = c.crush;
      return o;
    });
    this.t1 = this.time[this._slot(this.count - 1)];
    this.t0 = this.time[this._slot(0)];
    this.t = Math.max(this.t0, this.t1 - back);
    this.rate = 1; this.userRate = 1; this.paused = false;
    this.playing = true;
    this.director = new Director(this, marks);
    return true;
  }

  stop() {
    if (!this.playing) return;
    this.cars.forEach((c, k) => {
      const o = this.live[k];
      for (const f of FIELDS) c[f] = o[f];
      for (const f of FLAGS) c[f] = o[f];
      c.lost = o.lost; c.crush = o.crush;
    });
    this.live = null;
    this.playing = false;
  }

  seek(dt) { this.t = Math.min(this.t1, Math.max(this.t0, this.t + dt)); }

  /**
   * Advance by a real-time frame and write the poses for time `this.t` into
   * the cars. Returns false when the tape has run out.
   */
  tick(frame) {
    if (!this.playing) return false;
    const slow = this.director ? this.director.slow(this.t) : 1;
    this.rate = this.userRate * slow;
    if (!this.paused) this.t += frame * this.rate;
    if (this.t >= this.t1) { this.t = this.t1; this.apply(); return false; }
    this.apply();
    return true;
  }

  apply() {
    // binary search the ring for the frame pair bracketing t
    let lo = 0, hi = this.count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.time[this._slot(mid)] <= this.t) lo = mid; else hi = mid;
    }
    const a = this._slot(lo), b = this._slot(hi);
    const ta = this.time[a], tb = this.time[b];
    const u = tb > ta ? Math.min(1, Math.max(0, (this.t - ta) / (tb - ta))) : 0;
    for (let k = 0; k < this.n; k++) {
      const c = this.cars[k], oa = (a * this.n + k) * NF, ob = (b * this.n + k) * NF;
      for (let j = 0; j < NF; j++) {
        let va = this.buf[oa + j], vb = this.buf[ob + j];
        if (FIELDS[j] === 'hdg') {          // unwrap the angle before blending
          let d = vb - va;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          vb = va + d;
        }
        c[FIELDS[j]] = va + (vb - va) * u;
      }
      const fl = this.flag[(u < 0.5 ? a : b) * this.n + k];
      c.drsOpen = !!(fl & 1); c.airborne = !!(fl & 2);
      // damage as it stood at time t
      let d = null, first = null;
      for (const e of this.dmg) {
        if (e.k !== k) continue;
        if (!first) first = e;
        if (e.t <= this.t) d = e; else break;
      }
      if (d) { c.lost = d.lost; c.crush = d.crush; }
      else if (first) { c.lost = first.was.lost; c.crush = first.was.crush; }
      else { c.lost = this.live[k].lost; c.crush = this.live[k].crush; }
    }
  }
}

// ---------------------------------------------------------------------------
// The director. Works in camera NAMES so it survives rigs being added.
// ---------------------------------------------------------------------------
export class Director {
  constructor(replay, marks) {
    this.r = replay;
    this.marks = marks;           // [{t, kind:'contact'|'pass'|'spin'}] sim times
    this.auto = true;
    this.shotT = 0; this.shot = null; this.n = 0;
  }

  /** Slow motion: 0.35x from 1.2 s before a contact to 1.5 s after it. */
  slow(t) {
    for (const m of this.marks) {
      if (m.kind !== 'contact' && m.kind !== 'spin') continue;
      const d = t - m.t;
      if (d > -1.2 && d < 1.5) return 0.35;
      if (d > -2 && d <= -1.2) return 0.35 + 0.65 * (-1.2 - d) / 0.8;
      if (d >= 1.5 && d < 2.3) return 0.35 + 0.65 * (d - 1.5) / 0.8;
    }
    return 1;
  }

  /**
   * Which camera now. `names` = the rigs the view has, in setMode order;
   * `car` = the car being followed. Returns an index, or -1 to leave it.
   */
  pick(frame, names, car) {
    if (!this.auto) return -1;
    this.shotT -= frame * (this.r.rate || 1);
    const t = this.r.t;
    const has = n => names.indexOf(n);
    // a moment of commitment coming up: be onboard for it
    const soon = this.marks.find(m => m.t - t > 0 && m.t - t < 1.6);
    if (soon && this.shot !== 'ONBOARD' && this.shot !== 'T-CAM' && this.shotT < 1.8) {
      const want = has('T-CAM') >= 0 && this.n % 2 ? 'T-CAM' : 'ONBOARD';
      return this._cut(want, 2.6 + 1.6 / Math.max(0.35, this.r.rate), names);
    }
    if (this.shotT > 0) return -1;
    // the rotation: mostly trackside, relieved by chase and onboard
    const plan = car.speed > 60 ? ['TV', 'T-CAM', 'TV', 'CHASE', 'TV', 'ONBOARD']
                                : ['TV', 'CHASE', 'TV', 'ONBOARD'];
    const want = plan[this.n % plan.length];
    return this._cut(want, want === 'TV' ? 5 + (this.n % 3) : 3.4, names);
  }

  _cut(name, hold, names) {
    let i = names.indexOf(name);
    if (i < 0) { name = 'TV'; i = names.indexOf('TV'); }
    this.n++;
    this.shot = name; this.shotT = hold;
    return i;
  }
}
