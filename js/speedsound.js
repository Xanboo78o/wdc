// speedsound.js — the sound of SPEED, which is not the sound of the engine.
//
// Adam, 2026-09-28: "make 350 kmh feel like 350 kmh". The engine note is revs
// and throttle; third gear at its limiter and seventh at its limiter are the
// same note. What tells your ears you are doing 350 and not 150 is
// everything AROUND the engine, and on a real onboard that is four things:
//
//   WIND    the air over the helmet. Aerodynamic noise climbs steeply with
//           speed — its pressure goes with v squared — and gets brighter as
//           it climbs. Buffeted, never steady.
//   HISS    the tyres on the tarmac: broadband, high, rising with speed,
//           brighter on a kerb, gone on grass (the surface loops own that).
//   WALLS   your own car's roar coming back off a barrier beside you. The
//           nearer the wall, the louder and brighter — the tunnel effect of
//           a street circuit. And every GUARD-RAIL POST (furniture.js puts one
//           every third 2 m sample, both sides) is a tiny reflector you pass:
//           a "fft" each, so the posts become a flutter whose RATE is your
//           speed — 16 a second at 350. Each one is scheduled at the exact
//           moment you pass it, sweeping down in pitch as it goes by.
//   RIVALS  a car passing close is a shove of air: a whoosh that rises as it
//           closes and drops in pitch as it goes away.
//
// Everything is SYNTHESISED from the sim (Adam, 2026-09-23: "GENUINELY
// emulate sounds") — one buffer of white noise made here, shaped by filters
// the car's speed, position and the circuit's geometry drive. No clips.
// The engine stays the loudest thing (tools/speedmix.mjs measures it).
//
// Knobs: ?speedsound=0 (all off), ?wind= ?hiss= ?walls= (level multipliers).

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const num = (k, d) => (Q.has(k) && Q.get(k) !== '' && Number.isFinite(+Q.get(k)) ? +Q.get(k) : d);
export const SPEEDSOUND = {
  on: Q.get('speedsound') !== '0',
  wind: 0.25 * num('wind', 1),
  hiss: 0.032 * num('hiss', 1),
  walls: 0.30 * num('walls', 1),
  posts: 0.55 * num('walls', 1),
  rivals: 0.8,
};
const VREF = 97.2;                 // 350 km/h, where every level below is set
const POST_EVERY = 3;              // furniture.js: a rail post every third sample

function noiseBuffer(ctx, seconds = 2.5) {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  // fade the loop seam so it cannot click
  const f = Math.min(2048, n >> 4);
  for (let i = 0; i < f; i++) { const k = i / f; d[i] *= k; d[n - 1 - i] *= k; }
  return b;
}

export class SpeedSound {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.track = null; this.hint = null;
    this.buf = noiseBuffer(ctx);
    this.t0 = ctx.currentTime;
    const src = (offset) => {
      const s = ctx.createBufferSource(); s.buffer = this.buf; s.loop = true;
      s.start(ctx.currentTime, offset % this.buf.duration); return s;
    };
    const biq = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const pan = (p) => { const n = ctx.createStereoPanner ? ctx.createStereoPanner() : null; if (n) n.pan.value = p; return n; };
    const chain = (...nodes) => { const ns = nodes.filter(Boolean); for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };

    // WIND: low, then opening up. Two bands so it has a body AND a rush.
    this.windLP = biq('lowpass', 400, 0.6);
    this.windBody = gain();
    chain(src(0.0), this.windLP, this.windBody, out);
    this.windBP = biq('bandpass', 1200, 0.5);
    this.windRush = gain();
    chain(src(0.7), this.windBP, this.windRush, out);

    // HISS: the tyres.
    this.hissHP = biq('highpass', 2500, 0.7);
    this.hissPk = biq('peaking', 5500, 0.9); this.hissPk.gain.value = 5;
    this.hiss = gain();
    chain(src(1.3), this.hissHP, this.hissPk, this.hiss, out);

    // WALLS, one voice per side: the steady reflection, and the post flutter.
    this.side = [1, -1].map((sd, k) => {
      const w = { sd };
      w.bp = biq('bandpass', 1500, 0.8);
      w.g = gain();
      w.pan = pan(sd > 0 ? -0.65 : 0.65);          // sim lat + is LEFT
      chain(src(0.4 + k * 0.9), w.bp, w.g, w.pan, out);
      w.pbp = biq('bandpass', 2500, 1.6);
      w.pg = gain();
      w.ppan = pan(sd > 0 ? -0.8 : 0.8);
      chain(src(1.9 + k * 0.5), w.pbp, w.pg, w.ppan, out);
      w.until = 0;          // audio time up to which posts are scheduled
      w.lastPost = -1;      // sample index of the last post scheduled
      return w;
    });

    // RIVALS: two air voices.
    this.air = [0, 1].map(k => {
      const a = { idx: -1 };
      a.bp = biq('bandpass', 1400, 1.1);
      a.g = gain();
      a.pan = pan(0);
      chain(src(0.2 + k * 1.1), a.bp, a.g, a.pan, out);
      return a;
    });
  }

  setTrack(t) { this.track = t; this.hint = null; for (const w of this.side) { w.lastPost = -1; w.until = 0; } }

  _to(p, v, tc = 0.04) { p.setTargetAtTime(v, this.ctx.currentTime, tc); }

  silence() {
    for (const g of [this.windBody, this.windRush, this.hiss]) this._to(g.gain, 0, 0.05);
    for (const w of this.side) {
      this._to(w.g.gain, 0, 0.05);
      w.pg.gain.cancelScheduledValues(this.ctx.currentTime);
      this._to(w.pg.gain, 0, 0.02);
      w.until = 0; w.lastPost = -1;
    }
    for (const a of this.air) this._to(a.g.gain, 0, 0.05);
  }

  /** Wind and hiss: speed and surface only. `master` is the game's volume. */
  update(speed, surf, master) {
    if (!SPEEDSOUND.on) { this.silence(); return; }
    const k = Math.min(1.2, Math.max(0, speed) / VREF);
    const t = this.ctx.currentTime - this.t0;
    // buffeting: three incommensurate waves, 3-11 Hz, deeper at speed
    const buf = 0.5 * Math.sin(t * 2 * Math.PI * 3.1) + 0.3 * Math.sin(t * 2 * Math.PI * 6.7 + 1.1) + 0.2 * Math.sin(t * 2 * Math.PI * 10.9 + 2.3);
    const b = 1 + 0.28 * k * buf;
    const w = SPEEDSOUND.wind * master * k * k * b;
    this._to(this.windBody.gain, w * 0.9, 0.03);
    this._to(this.windRush.gain, w * 0.55, 0.03);
    this.windLP.frequency.value = 220 + 900 * k;
    this.windBP.frequency.value = 700 + 2300 * k * (1 + 0.1 * buf);
    const kerb = surf > 0.9 && surf < 1, grass = surf < 0.9 && !kerb;
    const sf = kerb ? 1.5 : grass ? 0.25 : 1;
    this._to(this.hiss.gain, SPEEDSOUND.hiss * master * Math.pow(Math.min(1.2, k), 1.3) * sf, 0.05);
    this.hissHP.frequency.value = (kerb ? 1800 : 2400) + 1600 * Math.min(1, k);
  }

  /**
   * Walls, posts and rivals — needs to know WHERE the car is. `car` is your
   * car (sim coordinates), `race` the session or null. Once a frame.
   */
  place(car, race, master) {
    const t = this.track, ctx = this.ctx, now = ctx.currentTime;
    if (!SPEEDSOUND.on || !t || !car) return;
    const v = Math.max(0, car.speed || 0), k = Math.min(1.2, v / VREF);
    const p = t.project(car.x, car.y, this.hint, this.hint == null ? undefined : 12);
    this.hint = p.i;
    const street = t.wall === 'wall';
    for (const w of this.side) {
      // distance from you to that side's barrier (sim lat: + is left)
      const bl = w.sd > 0 ? p.w + p.runL : -(p.w + p.runR);
      const d = Math.max(0.6, Math.abs(bl - p.lat));
      const near = Math.min(1, 3.0 / d);            // 1 within 3 m, 0.1 at 30 m
      // the steady reflection: louder and brighter the nearer
      this._to(w.g.gain, SPEEDSOUND.walls * master * Math.pow(k, 1.5) * near * near * (street ? 1.3 : 0.8), 0.05);
      w.bp.frequency.value = 700 + 2600 * near * Math.min(1, k);

      // THE POSTS. Only rails have posts (a street circuit is concrete).
      if (street || v < 12) { w.until = 0; w.lastPost = -1; continue; }
      // Schedule every post we will pass in the next 120 ms, at the moment
      // we pass it. Automation must be in time order, so never before `until`.
      const ahead = 0.12, ds = t.ds;
      const sNow = p.s;
      let i0 = Math.ceil(sNow / ds / POST_EVERY) * POST_EVERY;
      const reach = v * ahead;
      for (let i = i0; i * ds <= sNow + reach; i += POST_EVERY) {
        const ii = ((i % t.n) + t.n) % t.n;
        if (ii === w.lastPost) continue;
        const tp = now + (i * ds - sNow) / v;
        // how long the post is "beside you": the time to cover +-d
        const dp = Math.max(0.6, Math.abs((w.sd > 0 ? t.w[ii] + t.runL[ii] : -(t.w[ii] + t.runR[ii])) - p.lat));
        // never longer than half the gap to the next post, or they overlap
        const tau = Math.min(0.45 * POST_EVERY * ds / v, 0.05, Math.max(0.008, 0.7 * dp / v));
        const a0 = tp - tau, a1 = tp + tau;
        if (a0 <= w.until || a0 <= now) { w.lastPost = ii; continue; }
        const nearP = Math.min(1, 2.5 / dp);
        const A = SPEEDSOUND.posts * master * Math.pow(k, 1.3) * nearP * nearP;
        const g = w.pg.gain, f = w.pbp.frequency;
        g.setValueAtTime(0, a0);
        g.linearRampToValueAtTime(A, tp);
        g.linearRampToValueAtTime(0, a1);
        // Doppler of the reflection: bright arriving, dull leaving
        const fc = 1200 + 4200 * nearP * Math.min(1, k);
        f.setValueAtTime(fc * 1.35, a0);
        f.exponentialRampToValueAtTime(fc * 0.7, a1);
        w.until = a1; w.lastPost = ii; this.posts = (this.posts || 0) + 1;
      }
    }

    // RIVALS: the two nearest within 18 m that are moving relative to you.
    if (!race || !race.entries) { for (const a of this.air) this._to(a.g.gain, 0, 0.08); return; }
    const near = [];
    for (const e of race.entries) {
      if (e.isPlayer || e.retired || !e.car) continue;
      const dx = e.car.x - car.x, dy = e.car.y - car.y, d = Math.hypot(dx, dy);
      if (d < 18) near.push([d, e]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const want = near.slice(0, 2).map(n => n[1]);
    for (const a of this.air) if (!want.some(e => e.idx === a.idx)) a.idx = -1;
    for (const e of want) if (!this.air.some(a => a.idx === e.idx)) { const f = this.air.find(a => a.idx < 0); if (f) f.idx = e.idx; }
    const h = car.hdg || 0, lvx = Math.cos(h) * v, lvy = Math.sin(h) * v;
    for (const a of this.air) {
      const e = a.idx >= 0 ? race.entries.find(x => x.idx === a.idx) : null;
      if (!e) { this._to(a.g.gain, 0, 0.08); continue; }
      const oc = e.car;
      const dx = oc.x - car.x, dy = oc.y - car.y, d = Math.hypot(dx, dy) || 1;
      const ovx = Math.cos(oc.hdg || 0) * oc.speed, ovy = Math.sin(oc.hdg || 0) * oc.speed;
      const rvx = ovx - lvx, rvy = ovy - lvy;
      const rel = Math.hypot(rvx, rvy);
      const radial = (rvx * dx + rvy * dy) / d;          // + moving apart
      // lateral in YOUR frame: + is to your left
      const lat = -Math.sin(h) * dx + Math.cos(h) * dy;
      const close = 1 / (1 + (d / 4) * (d / 4));
      // a car alongside at the same speed is not a whoosh; a car going past is
      const push = Math.min(1, rel / 25) * Math.min(1, (v + oc.speed) / 60);
      this._to(a.g.gain, SPEEDSOUND.rivals * master * close * push, 0.03);
      a.bp.frequency.value = Math.max(300, Math.min(5000, 1500 * Math.pow(2, -radial / 22)));
      if (a.pan) this._to(a.pan.pan, Math.max(-0.9, Math.min(0.9, -lat / Math.max(3, d))), 0.03);
    }
  }
}
