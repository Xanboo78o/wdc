// track.js — runtime model of a baked circuit.
export class Track {
  constructor(d) {
    Object.assign(this, d);
    this.n = this.x.length;
    this.hdg = new Float32Array(this.n);
    this.curv = new Float32Array(this.n);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      this.hdg[i] = Math.atan2(this.y[b] - this.y[a], this.x[b] - this.x[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      let d2 = this.hdg[b] - this.hdg[a];
      while (d2 > Math.PI) d2 -= 2 * Math.PI;
      while (d2 < -Math.PI) d2 += 2 * Math.PI;
      this.curv[i] = d2 / (2 * this.ds);
    }
    // An OPEN track — a point-to-point stage, which is what the hand-built
    // megatrack is until its two ends are joined — has no sample after the
    // last one. Both loops above wrap round and join the ends, so the FIRST
    // and LAST samples get a heading pointing across the map at each other.
    // The first sample is exactly where cars are placed, which is how a hot
    // lap started with the car facing into a field. Clamp the ends instead.
    // (js/build/app.js has always overwritten hdg/curv for the same reason.)
    if (this.open) {
      this.hdg[0] = Math.atan2(this.y[1] - this.y[0], this.x[1] - this.x[0]);
      this.hdg[n - 1] = Math.atan2(this.y[n - 1] - this.y[n - 2], this.x[n - 1] - this.x[n - 2]);
      this.curv[0] = this.curv[1];
      this.curv[n - 1] = this.curv[n - 2];
    }
    this.pitLen = 0;
    if (this.pit) {
      for (let i = 1; i < this.pit.pts.length; i++)
        this.pitLen += Math.hypot(this.pit.pts[i][0] - this.pit.pts[i - 1][0], this.pit.pts[i][1] - this.pit.pts[i - 1][1]);

      // WHICH SIDE THE PIT LANE IS ON — measured, never read from the file.
      //
      // The baked `pit.side` flag is wrong on three of the five circuits:
      // Monza says left and the surveyed lane is 17.3 m to the RIGHT, Suzuka
      // says left and is 14.0 m right, Baku says right and is 7.5 m left. Only
      // Monaco and Zandvoort happen to agree. Anything that trusts the flag
      // sends cars across the circuit to a pit entry that is not there.
      //
      // The lane's own geometry cannot be wrong, so derive it: project the
      // lane's midpoint onto the nearest centreline sample and read the sign.
      const mid = this.pit.pts[Math.floor(this.pit.pts.length / 2)];
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (this.x[i] - mid[0]) ** 2 + (this.y[i] - mid[1]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const hm = this.hdg[best];
      const lat = -Math.sin(hm) * (mid[0] - this.x[best]) + Math.cos(hm) * (mid[1] - this.y[best]);
      this.pit.sideRaw = this.pit.side;
      this.pit.side = Math.sign(lat) || 1;      // +1 = left of travel
      this.pit.offset = lat;                    // how far out, in metres
    }

    // BANKING NEEDS A TRANSITION.
    //
    // The bake stores bank as a hard step — Zandvoort is 0 -> 18 -> 0 with no
    // taper, twice a lap. Physically that lands the full banking force on the
    // car in a single 2.5 ms substep, which is a jolt no real camber change
    // makes; geometrically it is a 3.6 m vertical cliff at each end, so it
    // cannot be drawn at all. Real banking ramps in over tens of metres.
    //
    // Taper each banked run in and out with a smoothstep, eating into the run
    // rather than extending past it, so a banked corner never spills camber
    // onto the straight that approaches it.
    if (this.bank && this.bank.some(v => v !== 0)) {
      const src = Array.from(this.bank);
      const out = new Float32Array(n);
      const TAPER = 38;                          // metres of transition
      let i = 0;
      while (i < n) {
        if (src[i] === 0) { out[i] = 0; i++; continue; }
        let j = i;
        while (j + 1 < n && src[j + 1] === src[i]) j++;
        const runLen = (j - i + 1) * this.ds;
        const tap = Math.min(TAPER, runLen / 3);
        const steps = Math.max(1, Math.round(tap / this.ds));
        for (let k = i; k <= j; k++) {
          const inFrom = k - i, inTo = j - k;
          const f = Math.min(1, Math.min(inFrom, inTo) / steps);
          const s = f * f * (3 - 2 * f);         // smoothstep
          out[k] = src[k] * s;
        }
        i = j + 1;
      }
      this.bank = out;
    }
  }
  static async load(key) {
    const r = await fetch(`./data/tracks/${key}.json`);
    return new Track(await r.json());
  }
  idx(s) { return ((Math.round(s / this.ds) % this.n) + this.n) % this.n; }
  wrap(s) { return ((s % this.length) + this.length) % this.length; }
  // signed shortest distance from b to a (positive = a is ahead of b)
  gap(a, b) {
    let d = a - b;
    while (d > this.length / 2) d -= this.length;
    while (d < -this.length / 2) d += this.length;
    return d;
  }
  // nearest centreline sample, searched around a hint so Suzuka's crossover
  // can't snap a car onto the bridge underneath it
  // `win` is how far either side of the hint to search. The default 45 samples
  // is 90 m of track, which was fine for one car and is 792,000 distance tests
  // a second at 22 cars and 400 Hz. A car at 320 km/h covers 0.22 m per
  // substep — an eighth of one 2 m sample — so a window of a few samples is
  // enormously generous. Pass a small one when you have a fresh hint, and none
  // at all when you do not.
  project(x, y, hint = null, win = 45) {
    let lo = 0, hi = this.n, step = 1;
    if (hint != null) { lo = hint - win; hi = hint + win; }
    let best = 0, bd = Infinity;
    for (let k = lo; k < hi; k += step) {
      const i = ((k % this.n) + this.n) % this.n;
      const d = (this.x[i] - x) ** 2 + (this.y[i] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const h = this.hdg[best], dx = x - this.x[best], dy = y - this.y[best];
    return {
      i: best,
      s: this.wrap(best * this.ds + (Math.cos(h) * dx + Math.sin(h) * dy)),
      lat: -Math.sin(h) * dx + Math.cos(h) * dy,
      w: this.w[best], runL: this.runL[best], runR: this.runR[best],
      run: (-Math.sin(h) * dx + Math.cos(h) * dy) > 0 ? this.runL[best] : this.runR[best],
      bank: this.bank[best],
      curv: this.curv[best], hdg: h,
    };
  }
  point(s, lat = 0) {
    const i = this.idx(s), h = this.hdg[i];
    return { x: this.x[i] - Math.sin(h) * lat, y: this.y[i] + Math.cos(h) * lat, hdg: h, i };
  }
  widthAt(s) { return this.w[this.idx(s)]; }
  cornerAt(s) {
    for (const c of this.corners) {
      const a = this.gap(s, c.s0), b = this.gap(c.s1, s);
      if (a > -40 && b > -40) return c;
    }
    return null;
  }
  drsZoneAt(s) {
    for (const z of this.drs) {
      const inside = z.from <= z.to ? (s >= z.from && s <= z.to) : (s >= z.from || s <= z.to);
      if (inside) return z;
    }
    return null;
  }
}
