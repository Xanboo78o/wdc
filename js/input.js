// input.js — a keyboard is a switch and a steering wheel is not, so don't
// pretend. This models the DRIVER'S HANDS: the wheel takes real time to wind
// on, self-centres faster than it winds on, and the usable lock falls away with
// speed the way a real rack does.
//
// That last part is not a difficulty setting. It is what keeps a slip-angle
// tyre model drivable on a keyboard without faking the tyres — and faking the
// tyres is the thing we are specifically not doing.
//
// A gamepad, when one is connected, bypasses the wind-on entirely: an analogue
// stick already IS a wheel position, so shaping it again would double up.

export const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  drs: ['Space'], look: ['ShiftLeft', 'ShiftRight'],
};

const PAD_BUTTONS = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9 };

export class Hands {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.wheel = 0;            // -1..1, where the driver's hands actually are
    this.throttle = 0; this.brake = 0;
    this.usingPad = false; this.padName = '';
    this.pad = null;
    this._padPrev = {};
    this._kd = e => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (Object.values(KEYMAP).some(a => a.includes(e.code))) e.preventDefault();
    };
    this._ku = e => this.down.delete(e.code);
    this._blur = () => this.down.clear();
  }

  attach(el = window) {
    el.addEventListener('keydown', this._kd);
    el.addEventListener('keyup', this._ku);
    addEventListener('blur', this._blur);
    addEventListener('gamepadconnected', e => { this.padName = e.gamepad.id.slice(0, 28); });
  }
  held(action) { return KEYMAP[action].some(c => this.down.has(c)); }
  tapped(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }
  endFrame() { this.pressed.clear(); }

  // Xbox-style rumble, where the browser exposes it. Not every pad, not every
  // browser — hence the try/catch rather than a capability check.
  rumble(strong = 0.4, weak = 0.2, ms = 90) {
    const p = this.pad;
    const act = p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      else if (act.pulse) act.pulse(Math.max(strong, weak), ms);
    } catch { /* ignore */ }
  }

  _readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.pad = p;
      const ax = p.axes[0] || 0;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      const live = Math.abs(ax) > 0.08 || rt > 0.03 || lt > 0.03;
      // Edge-detect buttons so a press is one event, like a key tap.
      const now = {};
      for (const [name, idx] of Object.entries(PAD_BUTTONS)) now[name] = !!(p.buttons[idx] && p.buttons[idx].pressed);
      for (const name in now) if (now[name] && !this._padPrev[name]) this.pressed.add('pad:' + name);
      this._padPrev = now;
      if (!live) return null;
      const dz = 0.08;
      // Sign: the physics body frame calls +y "left", so pushing the stick
      // right must produce a NEGATIVE wheel value. Only this file knows about
      // screen directions; everything downstream is in sim terms.
      const steer = Math.abs(ax) < dz ? 0 : -(ax - Math.sign(ax) * dz) / (1 - dz);
      return { steer, throttle: rt, brake: lt };
    }
    return null;
  }

  // Rates are the whole feel. Wind-on is deliberately slower than the snap back
  // to centre — that asymmetry is what lets you catch a slide by just letting
  // go of the key, which is the single most important thing a keyboard driver
  // has to be able to do.
  update(dt) {
    const pad = this._readPad();
    if (pad) {
      this.usingPad = true;
      this.wheel = pad.steer; this.throttle = pad.throttle; this.brake = pad.brake;
      return { wheel: this.wheel, throttle: this.throttle, brake: this.brake };
    }
    this.usingPad = false;
    const want = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    const WIND = 2.7, CENTRE = 5.2;
    if (want !== 0) {
      const rate = WIND * (want * this.wheel < 0 ? 1.8 : 1);   // reversing lock is quicker
      this.wheel += Math.sign(want - this.wheel) * Math.min(rate * dt, Math.abs(want - this.wheel));
    } else {
      const d = Math.min(CENTRE * dt, Math.abs(this.wheel));
      this.wheel -= Math.sign(this.wheel) * d;
    }
    const tUp = 3.4, tDn = 7.5, bUp = 5.5, bDn = 9;
    this.throttle += this.held('throttle') ? Math.min(tUp * dt, 1 - this.throttle) : -Math.min(tDn * dt, this.throttle);
    this.brake += this.held('brake') ? Math.min(bUp * dt, 1 - this.brake) : -Math.min(bDn * dt, this.brake);
    return { wheel: this.wheel, throttle: this.throttle, brake: this.brake };
  }
}

// Usable steering lock falls off with speed. At 300 km/h a real driver moves
// the wheel a few degrees; letting full lock reach the rack there would spin
// the car every single time.
export function steerLock(speed) {
  const v = Math.max(Number.isFinite(speed) ? speed : 0, 12);
  return 0.40 * Math.min(1, Math.pow(14 / v, 0.80));
}
