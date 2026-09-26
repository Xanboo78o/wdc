// spatial.js — 360-degree sound, for headphones.
//
// Adam, 2026-09-25: "add 360 sound, i will play wit headphones". What iRacing
// does (and this copies): every sound has a PLACE, and the listener is the
// driver's head. Through headphones the browser's HRTF panner (a measured
// model of how a head and ears colour sound from each direction) makes a
// source behind you sound behind you, not just "in the left ear".
//
//   YOUR CAR   the engine is split into its two real mouths: the EXHAUST,
//              low and a couple of metres behind your head (the body of the
//              note), and the AIRBOX, just above and behind your helmet (the
//              bright, sucking intake). They move with the car and the camera.
//   THE FIELD  the nearest rivals each get a real engine — the same V10
//              simulator (js/enginecore.js), their own gearbox, their own
//              throttle — placed where the car is, fading with distance, and
//              pitched by DOPPLER as they close on you or drop away. A car
//              coming up on your left is heard on your left before you see it.
//   THE PLACE  a short, generated reverb: the walls and buildings of a street
//              circuit throwing the scream back at you.
//
// Voices are pooled (VOICES) and handed to whoever is nearest each frame, so
// twenty-two cars cost four engines.
import { makeBox } from './gearbox.js';

const VOICES = 4;
const REACH = 260;          // metres: further than this a rival is not voiced
const C = 343;              // speed of sound, m/s

function panner(ctx, ref = 4) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.rolloffFactor = 1.1;
  p.maxDistance = 2000;
  return p;
}
const setPos = (p, x, y, z, t) => {
  if (p.positionX) { p.positionX.setTargetAtTime(x, t, 0.015); p.positionY.setTargetAtTime(y, t, 0.015); p.positionZ.setTargetAtTime(z, t, 0.015); }
  else p.setPosition(x, y, z);
};

// A reverb tail made, not recorded: early reflections off near walls, then a
// decaying diffuse tail. Short, because a street circuit is walls and air.
function impulse(ctx, secs = 0.9) {
  const n = Math.round(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2) * 0.5;
    for (const ms of [11, 17, 23, 31, 43, 59]) {           // early reflections
      const k = Math.round(ctx.sampleRate * (ms + ch * 1.7) / 1000);
      if (k < n) d[k] += 0.55 * Math.exp(-ms / 40);
    }
  }
  return b;
}

export class Spatial {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.verb = ctx.createConvolver(); this.verb.buffer = impulse(ctx);
    this.verbG = ctx.createGain(); this.verbG.gain.value = 0.22;
    this.verb.connect(this.verbG).connect(out);
    this.ready = false; this.voices = []; this.boxes = new Map();
    this.own = null;
    // Nobody calling update() — paused, results, left the circuit — means
    // the rivals go quiet, not drone on at their last level.
    this.last = 0;
    this.watch = setInterval(() => { if (performance.now() - this.last > 250) this.silence(); }, 200);
    ctx.audioWorklet.addModule(new URL('./engineworklet.js', import.meta.url)).then(() => {
      for (let v = 0; v < VOICES; v++) {
        const node = new AudioWorkletNode(ctx, 'wdc-engine', { numberOfOutputs: 1, outputChannelCount: [1] });
        const g = ctx.createGain(); g.gain.value = 0;
        const p = panner(ctx, 5);
        node.connect(g).connect(p).connect(out);
        p.connect(this.verb);
        this.voices.push({ node, g, p, idx: -1 });
      }
      this.ready = true;
    }).catch(e => console.error('spatial:', e));
  }

  /**
   * Take over your own engine's output: split it into exhaust and airbox,
   * each with its own place. `src` is the engine's AudioNode, currently
   * connected straight to the output.
   */
  adoptOwn(src) {
    const ctx = this.ctx;
    try { src.disconnect(); } catch { /* not connected yet */ }
    const ex = ctx.createBiquadFilter(); ex.type = 'lowshelf'; ex.frequency.value = 900; ex.gain.value = 4;
    const exP = panner(ctx, 3);
    const air = ctx.createBiquadFilter(); air.type = 'highpass'; air.frequency.value = 1400;
    const airG = ctx.createGain(); airG.gain.value = 0.55;
    const airP = panner(ctx, 1.5);
    src.connect(ex).connect(exP).connect(this.out);
    src.connect(air).connect(airG).connect(airP).connect(this.out);
    exP.connect(this.verb);
    this.own = { exP, airP };
  }

  /**
   * Once a frame. `camera` is the three.js camera (the driver's head),
   * `car` your car, `race` the session (null in practice), `gain` the master.
   */
  update(camera, car, race, gain, dt) {
    const ctx = this.ctx, t = ctx.currentTime, L = ctx.listener;
    if (!camera || !car) return;
    this.last = performance.now();
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const lx = m[12], ly = m[13], lz = m[14];
    const fx = -m[8], fy = -m[9], fz = -m[10], ux = m[4], uy = m[5], uz = m[6];
    if (L.positionX) {
      L.positionX.setTargetAtTime(lx, t, 0.01); L.positionY.setTargetAtTime(ly, t, 0.01); L.positionZ.setTargetAtTime(lz, t, 0.01);
      L.forwardX.setTargetAtTime(fx, t, 0.01); L.forwardY.setTargetAtTime(fy, t, 0.01); L.forwardZ.setTargetAtTime(fz, t, 0.01);
      L.upX.setTargetAtTime(ux, t, 0.01); L.upY.setTargetAtTime(uy, t, 0.01); L.upZ.setTargetAtTime(uz, t, 0.01);
    } else { L.setPosition(lx, ly, lz); L.setOrientation(fx, fy, fz, ux, uy, uz); }

    // sim (x, y) -> three (x, h, -y); heading h -> forward (cos h, 0, -sin h)
    const cx = car.x, cz = -car.y, h = car.hdg || 0, hx = Math.cos(h), hz = -Math.sin(h);
    const base = ly - 1.0;                                  // roughly the road under the head
    if (this.own) {
      setPos(this.own.exP, cx - hx * 2.4, base + 0.45, cz - hz * 2.4, t);   // exhaust, behind
      setPos(this.own.airP, cx - hx * 0.5, base + 1.35, cz - hz * 0.5, t);  // airbox, above/behind the helmet
    }

    if (!this.ready || !race) { for (const v of this.voices) v.g.gain.setTargetAtTime(0, t, 0.05); return; }

    // Who is near enough to hear, nearest first.
    const near = [];
    for (const e of race.entries) {
      if (e.isPlayer || e.retired || !e.car) continue;
      const d = Math.hypot(e.car.x - car.x, e.car.y - car.y);
      if (d < REACH) near.push([d, e]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const want = near.slice(0, VOICES).map(n => n[1]);
    // Keep a voice on its car if that car is still wanted (no swaps mid-pass).
    const free = [];
    for (const v of this.voices) {
      if (want.some(e => e.idx === v.idx)) continue;
      v.idx = -1; free.push(v);
    }
    for (const e of want) if (!this.voices.some(v => v.idx === e.idx) && free.length) free.shift().idx = e.idx;

    const lvx = Math.cos(h) * car.speed, lvy = Math.sin(h) * car.speed;
    for (const v of this.voices) {
      const e = v.idx >= 0 ? race.entries[v.idx] : null;
      if (!e) { v.g.gain.setTargetAtTime(0, t, 0.08); v.node.port.postMessage({ gain: 0 }); continue; }
      const oc = e.car;
      // their gearbox, their revs
      let box = this.boxes.get(e.idx);
      if (!box) { box = makeBox(oc.spec || { key: 'f1' }); this.boxes.set(e.idx, box); }
      box.update(dt, oc.speed * 3.6, oc.throttle || 0);
      // Doppler: closing speed along the line between you
      const dx = oc.x - car.x, dy = oc.y - car.y, dd = Math.hypot(dx, dy) || 1;
      const ovx = Math.cos(oc.hdg || 0) * oc.speed, ovy = Math.sin(oc.hdg || 0) * oc.speed;
      const srcToward = -(ovx * dx + ovy * dy) / dd;      // + when the rival moves toward you
      const lisToward = (lvx * dx + lvy * dy) / dd;       // + when you move toward it
      const dop = Math.max(0.6, Math.min(1.6, (C + lisToward) / (C - srcToward)));
      v.node.port.postMessage({ rpm: box.rpm * dop, throttle: oc.throttle || 0, gain: 1, speed: oc.speed });
      v.g.gain.setTargetAtTime(gain * 0.9, t, 0.08);
      setPos(v.p, oc.x, base + 0.5, -oc.y, t);
    }
  }

  silence() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.g.gain.setTargetAtTime(0, t, 0.05);
  }
}
