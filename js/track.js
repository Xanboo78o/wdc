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
      let lat = -Math.sin(hm) * (mid[0] - this.x[best]) + Math.cos(hm) * (mid[1] - this.y[best]);
      // ...but ONE vertex is not the lane. At Sepang the middle vertex of the
      // surveyed way sits on the entry road: it read 53.6 m out, the garages
      // are drawn 13 m out, and the race drove every pit car through the
      // paddock, 40 m from its garage (found 2026-10-04). The offset is where
      // the GARAGES are: the median over the middle 40% of the lane's length.
      {
        const P = this.pit.pts, cum = [0];
        for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
        const lats = [];
        for (let f = 0.30; f <= 0.701; f += 0.05) {
          const d = f * cum[cum.length - 1];
          let k = 1; while (k < P.length - 1 && cum[k] < d) k++;
          const u = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
          const px = P[k - 1][0] + (P[k][0] - P[k - 1][0]) * u, py = P[k - 1][1] + (P[k][1] - P[k - 1][1]) * u;
          let b = 0, bd2 = Infinity;
          for (let i = 0; i < n; i++) { const d2 = (this.x[i] - px) ** 2 + (this.y[i] - py) ** 2; if (d2 < bd2) { bd2 = d2; b = i; } }
          lats.push(-Math.sin(this.hdg[b]) * (px - this.x[b]) + Math.cos(this.hdg[b]) * (py - this.y[b]));
        }
        lats.sort((a, b) => a - b);
        if (lats.length) lat = lats[lats.length >> 1];
      }
      this.pit.sideRaw = this.pit.side;
      this.pit.side = Math.sign(lat) || 1;      // +1 = left of travel
      this.pit.offset = lat;                    // how far out, in metres
    }

    // BANKING NEEDS A TRANSITION — A LONG ONE.
    //
    // The survey stores bank as a hard step (Zandvoort is 0 -> 18 -> 0), and
    // a step is a cliff across the road and the whole banking force landing
    // on the car in one substep. It used to be tapered over 38 m inside each
    // run of EQUAL values — which is what a surveyed step is, and not what a
    // hand-built corner is: Kate's Bowl and Heiligen's two walls are baked
    // with their own long ramps, every sample different, and that rule threw
    // those ramps away and put the 38 m one on what was left. Adam,
    // 2026-10-06: "in all the banked corners in the game they jump from no
    // banking to full banking, not like a subtle curve from flat".
    //
    // So: banking may change by no more than BANK_RATE degrees per metre,
    // anywhere, whatever the bake says. 27 degrees takes 135 m. The ramp is
    // centred on where the bake put the change — half of it on the approach,
    // half inside the corner — and its two ends are rounded off. A bake that
    // is already gentler than that is left exactly as it is.
    if (this.bank && this.bank.some(v => v !== 0)) {
      const BANK_RATE = 0.2, r = BANK_RATE * this.ds;
      const a = Float32Array.from(this.bank, Math.abs);
      const sweep = (f) => { for (let pass = 0; pass < 2; pass++) { for (let i = 0; i < n; i++) f(i, (i - 1 + n) % n); for (let i = n - 1; i >= 0; i--) f(i, (i + 1) % n); } };
      sweep((i, j) => { if (a[j] - 2 * r > a[i]) a[i] = a[j] - 2 * r; });   // out onto the approach, at twice the rate...
      sweep((i, j) => { if (a[j] + r < a[i]) a[i] = a[j] + r; });           // ...then up from there at the rate: centred
      let v = a;
      // The rounding is long (about 25 m either side) because the END of the
      // ramp is a crest for the outside of the road: 20 m up the banking, where
      // the ramp stopped in 15 m the surface dropped away at 31 m/s2 under a
      // car doing 260 km/h, and it flew into the wall.
      for (let pass = 0; pass < 300; pass++) {
        const w = new Float32Array(n);
        for (let i = 0; i < n; i++) w[i] = (v[(i - 1 + n) % n] + 2 * v[i] + v[(i + 1) % n]) / 4;
        v = w;
      }
      for (let i = 0; i < n; i++) if (v[i] < 0.05) v[i] = 0;
      this.bank = v;
    }
    this.shareWalls();
  }

  // ONE WALL BETWEEN TWO STRETCHES OF ROAD.
  //
  // Adam, 2026-10-04: "random barriers dont have collisions". Each sample's
  // barrier stands at w + run from ITS centreline, and a car is only ever
  // tested against the wall of the stretch it is on. Where two stretches run
  // close — a hairpin's two legs, a paddock loop — each one's run-off reached
  // past the other's wall, so a barrier was DRAWN in the middle of ground you
  // could drive across: 20% of the barrier on Adam's first track, 14 m inside
  // the run-off at Sepang's first two turns, 18 m at Kate Mascoi
  // (tools/ghostwall.mjs). Derived here at load, like pit.side and the bank
  // taper, so the renderer and the physics get the same answer from the same
  // arrays: the two stretches share one wall down the middle of the gap.
  // Where the roads themselves meet (a crossover, a bridge) nothing changes.
  shareWalls() {
    if (!this.runL || !this.runR || this.n < 40) return;
    const n = this.n, ds = this.ds, x = this.x, y = this.y, w = this.w;
    const far = Math.round(120 / ds), CELL = 40, grid = new Map();
    for (let j = 0; j < n; j += 2) {
      const k = Math.floor(x[j] / CELL) * 73856093 ^ Math.floor(y[j] / CELL) * 19349663;
      let g = grid.get(k); if (!g) grid.set(k, g = []); g.push(j);
    }
    const cap = { 1: Float32Array.from(this.runL), [-1]: Float32Array.from(this.runR) };
    let moved = 0;
    for (let i = 0; i < n; i++) for (const side of [1, -1]) {
      const run = side > 0 ? this.runL[i] : this.runR[i], L = w[i] + run;
      const h = this.hdg[i], bx = x[i] - Math.sin(h) * side * L, by = y[i] + Math.cos(h) * side * L;
      let bj = -1, bd = Infinity;
      const cx = Math.floor(bx / CELL), cy = Math.floor(by / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const g = grid.get(gx * 73856093 ^ gy * 19349663);
        if (!g) continue;
        for (const j of g) {
          const along = Math.abs(j - i);
          if (Math.min(along, this.open ? along : n - along) < far) continue;
          const d2 = (bx - x[j]) ** 2 + (by - y[j]) ** 2;
          if (d2 < bd) { bd = d2; bj = j; }
        }
      }
      if (bj < 0) continue;
      const hj = this.hdg[bj];
      const lj = -Math.sin(hj) * (bx - x[bj]) + Math.cos(hj) * (by - y[bj]);
      const limJ = w[bj] + (lj > 0 ? this.runL[bj] : this.runR[bj]);
      if (Math.abs(lj) >= limJ - 0.5) continue;               // not on the other stretch's ground
      const D = Math.hypot(x[bj] - x[i], y[bj] - y[i]);
      if (D < w[i] + w[bj] + 1) continue;                     // the roads meet: a crossing, a bridge
      const shared = Math.max(1.0, (D - w[i] - w[bj]) / 2 - 0.4);
      if (shared < cap[side][i]) { cap[side][i] = shared; moved++; }
    }
    if (!moved) return;
    // A wall does not step sideways between two samples: take the least run
    // within 16 m, then smooth it. (Eroding wider than the blur means the
    // smoothed wall is never further out than the shared one.)
    const E = Math.round(16 / ds), B = Math.round(8 / ds);
    for (const side of [1, -1]) {
      const c = cap[side], er = new Float32Array(n), out = side > 0 ? this.runL : this.runR;
      for (let i = 0; i < n; i++) { let m = Infinity; for (let o = -E; o <= E; o++) { const k = this.open ? Math.max(0, Math.min(n - 1, i + o)) : (i + o + n) % n; if (c[k] < m) m = c[k]; } er[i] = m; }
      for (let i = 0; i < n; i++) { let a = 0; for (let o = -B; o <= B; o++) a += er[this.open ? Math.max(0, Math.min(n - 1, i + o)) : (i + o + n) % n]; out[i] = Math.min(out[i], a / (2 * B + 1)); }
    }
    this.sharedWalls = moved;
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
