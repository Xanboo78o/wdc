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

const URL_ = 'ws://127.0.0.1:8179';
const MECH = 0.3;            // caster's share of the trail, relative to pneumatic
const SCALE = 0.9;           // front force / weight that reads as ~70% torque

export class FFB {
  constructor() {
    this.ws = null; this.live = false; this.wheel = null;
    this.jolt = 0;
    this._retry = 0;
    this.off = new URLSearchParams(location.search).get('ffb') === '0';
  }

  _connect(now) {
    if (this.off || this.ws || now < this._retry) return;
    this._retry = now + 3000;
    let ws;
    try { ws = new WebSocket(URL_); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.live = true; };
    ws.onmessage = e => { try { this.wheel = JSON.parse(e.data).wheel; } catch { } };
    ws.onclose = () => { this.ws = null; this.live = false; };
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
    let f = Math.tanh(sat / SCALE);
    if (car.airborne) f = 0;                   // nothing on the ground, nothing in the hands
    f *= Math.min(1, (car.speed || 0) / 5);   // nothing at all on the grid or parked

    this.jolt = Math.max(0, this.jolt - dt * 4);
    const r = Math.min(1, rough * 0.8 + this.jolt * 0.8);
    // A real rack has weight even unloaded, most of it at a crawl.
    const d = 0.1 + 0.2 * Math.max(0, 1 - (car.speed || 0) / 15);

    this.ws.send(JSON.stringify({ f: +f.toFixed(3), r: +r.toFixed(2), d: +d.toFixed(2) }));
  }
}
