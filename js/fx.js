// fx.js — the crash drama: debris, sparks and tyre smoke, for every car.
//
// Adam: "i wanna see my car crumble when i hit a wall... BeamNG level". The
// physics already knows everything that happens in an accident — which region
// was crushed and by how much, when a wing came off, when bodywork is on a
// wall, when a car is on its roof, when a tyre is locked or spinning. Almost
// none of that was being SHOWN. This file watches those facts and turns them
// into things you can see and hear, and it never writes one of them back:
// nothing here can change how a car drives.
//
// It OBSERVES rather than being called from the physics. Each car's state is
// diffed frame to frame (crush went up, `lost.frontWing` turned true, `onRoof`
// is set), so the validated simulation files need no new events and stay
// byte-identical under tools/drive.mjs.
//
// Budget (GTX 1060, 50 fps floor): each effect is ONE draw call however many
// particles it has — instanced, pooled, capped — and an effect with nothing
// alive is not drawn at all. `window.__wdc.fx` publishes the live counts and
// what this costs on the CPU per frame.
//
// Knobs:
//   ?fx=0                 all of it off
//   ?fxcam=yaw,pitch,dist[,lookX]   orbit the player's car, for screenshots:
//                         yaw 0 = in front of the nose, 90 = its right side
//   ?fxdemo=wing|spark|smoke|dust|scrape|all   stage an accident on the
//                         player's car at load, for screenshots (visual only —
//                         the physics car is untouched)
import * as THREE from 'three';
import { Z } from './geom.js';
import { bankY } from './bank.js';
import { Debris } from './debris.js';
import { Sparks } from './sparks.js';
import { Smoke } from './smoke.js';
import { DebrisAudio } from './debrisaudio.js';

const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

// what a tyre throws up, by surface (physics.js SURFACE values)
const RUBBER = [0.88, 0.89, 0.92];
const GRAVEL = [0.60, 0.52, 0.40];
const EARTH = [0.47, 0.42, 0.31];

const hash = n => { const s = Math.sin(n * 91.345 + 17.17) * 43758.5453; return s - Math.floor(s); };

const _M = new THREE.Matrix4(), _R = new THREE.Matrix4(), _E = new THREE.Euler(0, 0, 0, 'XYZ');
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

export class Fx {
  constructor(view, bundle) {
    this.view = view;
    this.bundle = bundle;
    this.on = q.get('fx') !== '0';
    const fc = q.get('fxcam');
    if (fc) {
      const [yaw, pitch, dist, lookX] = fc.split(',').map(Number);
      this.cam = { yaw: (yaw || 0) * Math.PI / 180, pitch: (pitch ?? 10) * Math.PI / 180, dist: dist || 5, lookX: lookX || 0 };
      this.orbit = this._orbit.bind(this);
    }
    this.demo = q.get('fxdemo');
    this.state = new WeakMap();
    this.entries = null;
    this.ms = 0;
    if (!this.on) return;
    this.audio = new DebrisAudio();
    this.debris = new Debris(view, bundle, (p, v) => {
      const h = p.half;
      this.audio.clatter(p.pos, v, Math.max(h.x, h.z) * 2);
    });
    this.sparks = new Sparks(view.scene);
    this.smoke = new Smoke(view.scene);
    this.myColour = bundle && bundle.paint ? bundle.paint.color.clone() : new THREE.Color(0xd8352a);
    this.cars = [];                    // for kicking debris, reused
  }

  /** main.js, once a frame: the field, and the audio engine to play into. */
  link(entries, engine) {
    this.entries = entries || null;
    if (this.audio) this.audio.attach(engine, this.view.camera);
  }

  /** The renderer's old puff() now lands here: rivals' rear-tyre smoke. */
  puff(x, z, vx, vz, force, baseY = 0) {
    if (!this.on) return;
    this.smoke.emit(x, baseY + 0.25, z, vx * 0.2 + (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.5,
      vz * 0.2 + (Math.random() - 0.5) * 1.5,
      { size: 0.35, grow: 1.5, life: 2.6, alpha: this._wet(0.16 + 0.1 * Math.min(2, force)), col: RUBBER });
  }

  _wet(a) { const w = (this.view.wx && this.view.wx.wetness) || 0; return a * (1 - 0.8 * w); }

  // The car's world matrix from its physics state: yaw on the parent, roll
  // and pitch on the child, exactly as render.js and field.js pose it.
  _matrix(car, sy) {
    _M.makeRotationY(car.hdg).setPosition(car.x, sy + (car.z || 0), Z(car.y));
    _E.set(car.roll || 0, 0, car.pitch || 0);
    _R.makeRotationFromEuler(_E);
    return _M.multiply(_R);
  }

  // Where the road is under a car (the same numbers render.js uses).
  _surface(car, st) {
    const v = this.view, t = v.track;
    const pr = t.project(car.x, car.y, st.hint);
    st.hint = pr.i;
    st.proj = pr;
    return (v.world ? v.world.trackYAt(pr.s) : 0) + (v.bank ? bankY(v.bank, t, pr.i, pr.lat) : 0);
  }

  update(car, dt, surfaceY) {
    if (!this.on) return;
    const t0 = performance.now();
    const v = this.view;
    // light the smoke with the scene's own sun and sky
    const rig = v.rig;
    if (rig && rig.sun) {
      const d = v.proc && rig.dir ? rig.dir : v.sunDir ? v.sunDir.toArray() : [0.5, 0.7, 0.4];
      _v.set(d[0], d[1], d[2]).normalize();
      const sc = rig.sun.color.clone().multiplyScalar(rig.sun.intensity);
      const ac = rig.hemi ? rig.hemi.color.clone().multiplyScalar(rig.hemi.intensity * 0.9) : sc.clone().multiplyScalar(0.3);
      this.smoke.light(v.camera, _v, sc, ac, v.scene.fog);
    }

    this.cars.length = 0;
    this._watch(car, true, this.myColour, surfaceY, dt);
    if (this.entries) {
      for (const e of this.entries) {
        if (e.isPlayer || e.car === car || !e.car) continue;
        if (e.retired && !e.car.speed) continue;
        this._watch(e.car, false, e.col != null ? e.col : this.myColour, null, dt);
      }
    }
    if (this.demo) this._demo(car, dt, surfaceY);

    this.debris.update(dt, this.cars);
    this.sparks.update(dt);
    this.smoke.update(dt, v.camera);
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
    if (typeof window !== 'undefined' && window.__wdc) {
      // `bad` = shader programs that failed to compile. A broken shader draws
      // NOTHING and three only logs it, which tools/shot.mjs does not catch:
      // the debris was invisible for exactly that reason and no error said so.
      window.__wdc.fx = { debris: this.debris.count, sparks: this.sparks.count, smoke: this.smoke.count, ms: +this.ms.toFixed(3),
        bad: (v.renderer.info.programs || []).filter(p => p.diagnostics && !p.diagnostics.runnable).length };
    }
  }

  _watch(car, mine, colour, sy, dt) {
    let st = this.state.get(car);
    const crush = car.crush || { front: 0, rear: 0, left: 0, right: 0 };
    const lost = car.lost || {};
    if (!st) {
      // First sight: whatever state the car is in is not news. A preset
      // (?crush=) or a car joining mid-accident must not explode at load.
      st = {
        hint: null, proj: null,
        crush: { ...crush }, lostF: !!lost.frontWing, lostR: !!lost.rearWing,
        air: !!car.airborne, bin: -1, acc: new Float32Array(8),
        colour: new THREE.Color(colour),
      };
      this.state.set(car, st);
    }
    if (sy == null) sy = this._surface(car, st);
    else if (!st.proj || car.wallTouch) this._surface(car, st);
    const M = this._matrix(car, sy);
    const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
    const vwx = car.vx * cs - car.vy * sn, vwy = car.vx * sn + car.vy * cs;
    const vel = _v.set(vwx, car.vz || 0, Z(vwy)).clone();
    const speed = car.speed || 0;
    const col = st.colour;
    this.cars.push({ x: car.x, z: Z(car.y), cs, sn, vx: vel.x, vz: vel.z, speed });
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);

    // ---- impacts: the crush went up somewhere ------------------------------
    for (const k of ['front', 'rear', 'left', 'right']) {
      const was = st.crush[k] || 0, now = crush[k] || 0;
      const d = now - was;
      if (d <= 0.012) { if (d < 0) st.crush[k] = now; continue; }     // repaired, or nothing
      st.crush[k] = now;
      const side = Math.random() < 0.5 ? -1 : 1;
      const p = k === 'front' ? at(2.45, 0.2, side * 0.5 * Math.random())
        : k === 'rear' ? at(-2.4, 0.45, side * 0.4 * Math.random())
        : at(Math.random() - 0.5, 0.35, k === 'left' ? -0.85 : 0.85);
      this.debris.shards(Math.min(36, Math.round(4 + d * 70)), p, vel, col,
        { size: 0.07 + d * 0.1, spread: 2 + d * 8, up: 1.5 + d * 5 });
      if (speed > 3 || d > 0.1) {
        const n = Math.min(160, Math.round(d * 320));
        this.sparks.emit(n, p.x, p.y, p.z, vel.x * 0.6, 0.5, vel.z * 0.6, sy, { spread: 4 + d * 12, up: 2 + d * 6, life: 0.6 });
      }
      if (d > 0.08) this.audio.snap(p, Math.min(1, d * 3));
      // things that leave at a threshold
      if (k === 'front' && was <= 0.55 && now > 0.55) {
        this.debris.part('fepL', M, vel, col, 0.8);
        this.debris.part('fepR', M, vel, col, 0.8);
      }
      if (k === 'rear' && was <= 0.55 && now > 0.55) {
        this.debris.part('repL', M, vel, col, 0.8);
        this.debris.part('repR', M, vel, col, 0.8);
      }
      if ((k === 'left' || k === 'right') && was <= 0.5 && now > 0.5) {
        this.debris.part(k === 'left' ? 'mirL' : 'mirR', M, vel, col, 1.2);
      }
    }

    // ---- whole wings --------------------------------------------------------
    if (lost.frontWing && !st.lostF) {
      st.lostF = true;
      this.debris.part('fwL', M, vel, col);
      this.debris.part('fwR', M, vel, col);
      this.debris.part('tip', M, vel, col, 0.7);
      const p = at(2.4, 0.15, 0);
      this.debris.shards(26, p, vel, col, { size: 0.1, spread: 5, up: 3 });
      this.sparks.emit(60, p.x, p.y, p.z, vel.x * 0.6, 0.5, vel.z * 0.6, sy, { spread: 6, up: 3 });
      this.audio.snap(p, 1);
    }
    if (!lost.frontWing) st.lostF = false;           // a new nose, at the pit stop
    if (lost.rearWing && !st.lostR) {
      st.lostR = true;
      this.debris.part('rw', M, vel, col, 1.1);
      const p = at(-2.45, 0.8, 0);
      this.debris.shards(18, p, vel, col, { size: 0.09, spread: 4, up: 3 });
      this.audio.snap(p, 0.9);
    }
    if (!lost.rearWing) st.lostR = false;

    // ---- sparks: bodywork on a wall ----------------------------------------
    if (car.wallTouch && speed > 4 && st.proj) {
      const pr = st.proj, sgn = Math.sign(pr.lat) || 1;
      const S = car.spec || {}, hl = (S.bodyL || 4.6) * 0.5, hw = (S.bodyW || 1.8) * 0.5;
      // which end of that side is in the wall: the one further out
      let best = null, bl = -1;
      for (const lx of [hl * 0.9, -hl * 0.9]) {
        const ly = sgn * hw;
        const x = car.x + lx * cs - ly * sn, y = car.y + lx * sn + ly * cs;
        const l = Math.abs(this.view.track.project(x, y, st.hint).lat);
        if (l > bl) { bl = l; best = [lx, ly]; }
      }
      const p = at(best[0], 0.25, -best[1]);
      const nx = -sgn * Math.sin(pr.hdg), ny = sgn * Math.cos(pr.hdg);   // off the wall, sim
      st.acc[0] += speed * 7 * dt;
      const n = Math.floor(st.acc[0]); st.acc[0] -= n;
      if (n) this.sparks.emit(n, p.x, p.y, p.z, vel.x * 0.75 + nx * 1.5, 0.6, vel.z * 0.75 + Z(ny) * 1.5, sy,
        { spread: 2.5, up: 2.2, life: 0.5 });
    }

    // ---- sparks: the plank and skid blocks ---------------------------------
    // Bumps are properties of PLACES, so the same patch sparks every lap: a
    // bin of track every 6 m is either a bump or not, fixed by a hash. At
    // speed, over a bump — or anywhere under heavy braking at the end of a
    // straight, where the nose dives — the titanium skids touch.
    if (!car.airborne && st.proj && speed > 42) {
      const bin = Math.floor(st.proj.s / 6);
      if (bin !== st.bin) {
        st.bin = bin;
        const h = hash(bin);
        const brake = (car.brake || 0) > 0.4 && speed > 55;
        const kerb = car.surface > 0.9 && car.surface < 0.95;
        if (h > 0.9 || (brake && h > 0.55) || (kerb && h > 0.3)) {
          const n = Math.round(6 + (speed - 40) * 0.35 + (kerb ? 8 : 0));
          for (const lx of [-1.5, -0.6, 0.3]) {
            if (Math.random() < 0.35) continue;
            const p = at(lx, 0.02, (Math.random() - 0.5) * 0.4);
            this.sparks.emit(Math.ceil(n / 3), p.x, sy + 0.02, p.z, vel.x * 0.72, 0.3, vel.z * 0.72, sy,
              { spread: 1.8, up: 1.1 + speed * 0.012, life: 0.45, width: 0.9 });
          }
        }
      }
    }
    // ---- sparks: a landing, a car on its roof, a broken nose on the road ---
    if (st.air && !car.airborne && speed > 3) {
      const p = at(-0.5, 0.02, 0);
      this.sparks.emit(50, p.x, sy + 0.02, p.z, vel.x * 0.7, 0.5, vel.z * 0.7, sy, { spread: 5, up: 3, life: 0.6 });
      this.debris.shards(6, p, vel, col, { size: 0.06, spread: 3, up: 2 });
    }
    st.air = !!car.airborne;
    if (car.onRoof && speed > 1.5) {
      const p = at(-0.2, 0.84, 0);
      st.acc[1] += speed * 12 * dt;
      const n = Math.floor(st.acc[1]); st.acc[1] -= n;
      if (n) this.sparks.emit(n, p.x, sy + 0.03, p.z, vel.x * 0.8, 0.5, vel.z * 0.8, sy, { spread: 3, up: 2.5, life: 0.55 });
    }
    if (lost.frontWing && (crush.front || 0) > 0.78 && speed > 12 && !car.airborne && Math.random() < 0.25) {
      const p = at(2.28, 0.05, 0);
      this.sparks.emit(2, p.x, sy + 0.02, p.z, vel.x * 0.8, 0.2, vel.z * 0.8, sy, { spread: 1.5, up: 1, life: 0.35 });
    }

    // ---- smoke --------------------------------------------------------------
    if (car.airborne) return;
    const pk = (car.spec && car.spec._pk) || 0.13;
    const surf = car.surface ?? 1;
    const off = surf < 0.9;
    const wheel = (lx, lz) => at(lx, 0.12, lz);
    const emit = (slot, rate, lx, lz, o) => {
      st.acc[slot] += rate * dt;
      let n = Math.floor(st.acc[slot]); st.acc[slot] -= n;
      while (n-- > 0) {
        const p = wheel(lx, lz);
        this.smoke.emit(p.x, sy + 0.18 + Math.random() * 0.1, p.z,
          vel.x * o.carry + (Math.random() - 0.5) * 1.6, 0.25 + Math.random() * 0.6,
          vel.z * o.carry + (Math.random() - 0.5) * 1.6, o);
      }
    };
    // rubber: sliding past the peak (the player's rears; field.js puffs
    // the rivals'), a locked front, a spinning rear
    const overR = Math.abs(car.slipR || 0) / pk - 1;
    const overF = Math.abs(car.slipF || 0) / pk - 1;
    if (!off) {
      if (mine && overR > 0 && speed > 6) {
        const r = Math.min(40, overR * 30);
        const o = { size: 0.35, grow: 1.5, life: 3, alpha: this._wet(0.12 + 0.2 * Math.min(1, overR)), col: RUBBER, carry: 0.12 };
        emit(2, r, -1.8, 0.8, o); emit(3, r, -1.8, -0.8, o);
      }
      if (car.lock && speed > 4) {
        const o = { size: 0.3, grow: 1.4, life: 2.6, alpha: this._wet(0.28), col: RUBBER, carry: 0.1 };
        emit(4, 26, 1.8, 0.85, o); emit(5, 26, 1.8, -0.85, o);
      } else if (mine && overF > 0.4 && speed > 8) {
        const o = { size: 0.3, grow: 1.3, life: 2.2, alpha: this._wet(0.1), col: RUBBER, carry: 0.12 };
        emit(4, overF * 12, 1.8, 0.85, o); emit(5, overF * 12, 1.8, -0.85, o);
      }
      if (mine && car.wheelspin && car.throttle > 0.3) {
        const o = { size: 0.4, grow: 1.7, life: 3.2, alpha: this._wet(0.32), col: RUBBER, carry: 0.05 };
        emit(2, 30, -1.8, 0.8, o); emit(3, 30, -1.8, -0.8, o);
      }
    } else if (speed > 5) {
      // dust off the gravel and the grass, from every wheel, more the faster
      const wet = (this.view.wx && this.view.wx.wetness) || 0;
      const gravel = surf > 0.5;
      const o = {
        size: gravel ? 0.45 : 0.35, grow: gravel ? 2.0 : 1.4, life: gravel ? 3.5 : 2.2,
        alpha: (gravel ? 0.26 : 0.13) * (1 - 0.85 * wet), col: gravel ? GRAVEL : EARTH, carry: 0.25, rise: 0.25,
      };
      const r = Math.min(26, speed * (gravel ? 0.6 : 0.3));
      emit(4, r, 1.8, 0.85, o); emit(5, r, 1.8, -0.85, o);
      emit(2, r, -1.8, 0.8, o); emit(3, r, -1.8, -0.8, o);
    }
  }

  // ?fxdemo= — an accident staged for the camera. Visual only.
  _demo(car, dt, sy) {
    const d = this.demo;
    this._dt = (this._dt || 0) + dt;
    const M = this._matrix(car, sy);
    const fwd = new THREE.Vector3(Math.cos(car.hdg), 0, -Math.sin(car.hdg));
    const vel = fwd.clone().multiplyScalar(38);
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    if ((d === 'wing' || d === 'all') && !this._demoWing && this._dt > 0.05) {
      this._demoWing = true;
      for (const k of ['fwL', 'fwR', 'tip', 'fepL', 'fepR', 'rw', 'mirL']) this.debris.part(k, M, vel, this.myColour, 1);
      const p = at(2.4, 0.15, 0);
      this.debris.shards(40, p, vel, this.myColour, { size: 0.1, spread: 6, up: 3 });
      this.sparks.emit(120, p.x, p.y, p.z, vel.x * 0.6, 0.5, vel.z * 0.6, sy, { spread: 8, up: 4 });
    }
    if (d === 'spark' || d === 'all') {
      for (const lx of [-1.5, -0.6, 0.3]) {
        const p = at(lx, 0.02, 0);
        this.sparks.emit(6, p.x, sy + 0.02, p.z, -fwd.x * 30, 0.3, -fwd.z * 30, sy, { spread: 2, up: 1.6, life: 0.5 });
      }
    }
    if (d === 'scrape') {
      const p = at(2.2, 0.25, -0.9);
      this.sparks.emit(10, p.x, p.y, p.z, -fwd.x * 25, 0.6, -fwd.z * 25, sy, { spread: 2.5, up: 2.2, life: 0.5 });
    }
    if (d === 'smoke' || d === 'all' || d === 'dust') {
      const col = d === 'dust' ? GRAVEL : RUBBER;
      for (const [lx, lz] of [[-1.8, 0.8], [-1.8, -0.8], [1.8, 0.85], [1.8, -0.85]]) {
        if (Math.random() < 0.5) continue;
        const p = at(lx, 0.12, lz);
        this.smoke.emit(p.x - fwd.x * 2 * Math.random(), sy + 0.25, p.z - fwd.z * 2 * Math.random(),
          -fwd.x * 3 + (Math.random() - 0.5) * 2, 0.5, -fwd.z * 3 + (Math.random() - 0.5) * 2,
          { size: 0.4, grow: 1.6, life: 3, alpha: d === 'dust' ? 0.3 : 0.3, col });
      }
    }
  }

  // Debug camera round the player's car, in the car's own frame so it follows
  // yaw, pitch, roll and a flight.
  _orbit(camera, carObj, fov) {
    const c = this.cam;
    carObj.updateWorldMatrix(true, false);
    const t = new THREE.Vector3(c.lookX, 0.3, 0);
    const p = new THREE.Vector3(
      c.lookX + c.dist * Math.cos(c.yaw) * Math.cos(c.pitch),
      0.3 + c.dist * Math.sin(c.pitch),
      c.dist * Math.sin(c.yaw) * Math.cos(c.pitch));
    p.applyMatrix4(carObj.matrixWorld);
    t.applyMatrix4(carObj.matrixWorld);
    camera.up.set(0, 1, 0);
    camera.position.copy(p);
    camera.lookAt(t);
    return 40;
  }
}
