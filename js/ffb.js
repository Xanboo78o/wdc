// ffb.js — what the steering wheel pushes back with.
//
// The browser cannot drive a force-feedback wheel (the Gamepad API only
// rumbles), so `tools/ffb.py` holds the wheel and this sends it one small
// message a frame over a WebSocket on localhost. No bridge running = nothing
// happens, silently; the game never waits on it.
//
// THE MODEL. A real rack goes heavy because the front tyres' sideways force
// acts a few centimetres behind the steering axis — the TRAIL — and twists the
// wheels back toward straight. Part of that trail is the tyre's own
// (pneumatic trail) and it SHRINKS as the slip angle climbs, reaching nothing
// just past the grip peak. That is the whole point of force feedback: the
// wheel goes LIGHT a moment before the front lets go, and a driver feels
// understeer in their hands before they see it. The caster (mechanical trail)
// never goes away, so the wheel never goes completely dead.
//
// Scale: front force over the car's weight. Measured over a lap by the
// autopilot — F1 at Monza p90 0.66, F4 p90 0.38 — so an F1 car with its
// downforce really is heavier than an F4, and tanh keeps the peaks inside the
// motor instead of clipping flat.

import { peakSlip } from './physics.js';
import { steerLock } from './input.js';
import { bridgeButtons } from './bridgebtn.js';

const URL_ = 'ws://127.0.0.1:8179';
const MECH = 0.3;            // caster's share of the trail, relative to pneumatic
// Adam, 2026-09-24: "it ONLY resist on crashes". Measured over a Monza lap,
// SCALE 0.9 sent an F4 a MEDIAN of 0.12 — 8% of the base at his 70% cap —
// and nothing at all on a straight, so the only thing that reached his hands
// was the 0.5 crash jolt. 0.45 plus the centring spring below: F4 median
// ~0.29, F1 ~0.5, and the tanh still lets it go light past the grip peak.
const SCALE = 0.45;          // front force / weight
// The centring spring: a real rack's caster and the tyres' own stiffness hold
// it on centre on a straight, where the aligning torque is almost zero. Fades
// in with speed so the car can still be turned at a crawl.
const CENTRE = 0.22;
// Weight in the rim while the car is stopped or crawling (see update()).
// 0.2 measured 2026-09-24: 7.8% of the base at his 50% cap, "nothing".
const PARK = 0.5;

// ROAD TEXTURE, in the steering torque itself — not the base's own vibration
// effect, which stays off since the 2026-09-23 shutdown (one effect on the
// base, not three). Keyed to DISTANCE travelled, not time, so a bump is a
// place: the same ripple comes back at the same spot, and it comes faster the
// faster you go, which is how a real road feels.
const hash = i => { const x = Math.sin(i * 127.1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
const vnoise = x => { const i = Math.floor(x), t = x - i, u = t * t * (3 - 2 * t); return hash(i) * (1 - u) + hash(i + 1) * u; };
const ROAD = 0.07;           // tarmac ripple at speed
const KERB = 0.28;           // the rumble strip: a hard square wave, stripe by stripe
const OFF = 0.38;            // grass and gravel: big, random, jerky

export class FFB {
  constructor() {
    this.ws = null; this.live = false; this.wheel = null;
    this.jolt = 0; this.dist = 0; this.kick = 1;
    this._retry = 0;
    this.off = new URLSearchParams(location.search).get('ffb') === '0';
    // Connect from the moment the page loads, not from the first frame of
    // driving: the bridge also carries the rim buttons (js/bridgebtn.js), and
    // MENU and confirm are needed on the menu and the pause screen, where no
    // driving frame runs — so they went nowhere (2026-09-25).
    this._connect(performance.now());
    this._keep = setInterval(() => this._connect(performance.now()), 3000);
  }

  _connect(now) {
    if (this.off || this.ws || now < this._retry) return;
    this._retry = now + 3000;
    let ws;
    try { ws = new WebSocket(URL_); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.live = true; };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      // A rim button, read by the bridge past Chrome's 32-button limit.
      if (m.b != null) { if (m.v) bridgeButtons.add(m.b); else bridgeButtons.delete(m.b); return; }
      if ('wheel' in m) this.wheel = m.wheel;
    };
    ws.onclose = () => { this.ws = null; this.live = false; bridgeButtons.clear(); };
    ws.onerror = () => { };
  }

  // A hit: a short burst of road texture, sized by how hard.
  hit(k) { this.jolt = Math.max(this.jolt, Math.min(1, k)); }

  // Once a frame, after the physics. `rough` is the kerb/grass shake the camera
  // already uses (0, 0.22 kerb, 0.45 off).
  update(car, rough, dt) {
    this._connect(performance.now());
    if (!this.live || this.ws.readyState !== 1) return;
    const spec = car.spec;
    const pk = spec._pk || (spec._pk = peakSlip(spec));

    const tp = Math.max(0, 1 - Math.abs(car.slipF || 0) / (1.25 * pk));
    // +Fyf pushes the front LEFT; the aligning torque turns the wheel back the
    // other way, and + means LEFT to the bridge. Hence the minus.
    const sat = -(car.Fyf || 0) * (tp + MECH) / (1 + MECH) / (spec.m * 9.81);
    const dn = (car.delta || 0) / Math.max(0.02, steerLock(car.speed || 0));
    const centre = -CENTRE * Math.tanh(dn * 6) * Math.min(1, (car.speed || 0) / 10);
    // Adam, 2026-09-24, after a crash at 36-50 km/h: "limp". The aligning
    // torque grows with speed squared, so at 40 km/h it was half what he had at
    // 110 (log: 0.30 vs 0.55-0.75). Games keep a slow car's wheel alive; this
    // lifts it up to 2.5x at a crawl, fading to nothing by 108 km/h.
    const low = 1 + 1.5 * Math.max(0, 1 - (car.speed || 0) / 30);
    let f = Math.tanh(sat * low / SCALE + centre);
    if (car.airborne) f = 0;                   // nothing on the ground, nothing in the hands
    // Adam, 2026-09-24: stuck against a wall after a crash, the wheel went
    // limp — this line used to fade EVERYTHING to zero below 5 m/s. A parked
    // car's rack is not weightless: the tyres scrub, and turning the wheel is
    // work. So as the road forces fade out, a gentle pull back toward centre
    // fades in. Zero with the wheel straight, so nothing moves on the grid.
    const slow = Math.min(1, (car.speed || 0) / 5);
    f = f * slow - PARK * (1 - slow) * Math.tanh(dn * 4) * (car.airborne ? 0 : 1);

    this.jolt = Math.max(0, this.jolt - dt * 4);

    // Bumps, only with the wheels on the ground.
    const v = car.speed || 0;
    this.dist += v * dt;
    if (!car.airborne) {
      const x = this.dist, sp = Math.min(1, v / 30);
      let tex = ROAD * sp * (0.6 * vnoise(x / 1.5) + 0.4 * vnoise(x / 0.35));
      if (rough >= 0.4) tex += OFF * Math.min(1, v / 8) * vnoise(x / 0.25);
      else if (rough > 0) tex += KERB * Math.min(1, v / 8) * Math.sign(Math.sin(x * Math.PI / 2.0));
      // A hit is a jerk: a hard shove that flips side each frame while it lasts.
      if (this.jolt > 0) { this.kick = -this.kick; tex += this.kick * this.jolt * 0.5; }
      f = Math.max(-1, Math.min(1, f + tex));
    }
    const r = Math.min(1, rough * 0.8 + this.jolt * 0.8);
    // A real rack has weight even unloaded, most of it at a crawl.
    const d = 0.1 + 0.2 * Math.max(0, 1 - (car.speed || 0) / 15);

    // The inputs as well as the answer, so tools/ffb.log can say WHY a force
    // was zero (the bridge ignores keys it does not use).
    this.ws.send(JSON.stringify({ f: +f.toFixed(3), r: +r.toFixed(2), d: +d.toFixed(2),
      v: +v.toFixed(1), y: +sat.toFixed(3), c: +centre.toFixed(3), a: car.airborne ? 1 : 0, j: +this.jolt.toFixed(2) }));
  }
}
