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

// KEY LADDER PEDALS (pedals.html). A spare keyboard under two cardboard
// flaps, with foam pieces of three heights over three keys per pedal, so a
// harder push reaches more keys. Each count of keys down is a step (see
// LADDER_STEPS), and the same rates below that ramp a keyboard throttle ramp
// between those steps, which is what makes it feel analogue.
// Three per pedal because a Bluetooth keyboard registers six keys at once:
// both pedals floored is exactly six, so a key is never dropped. The game
// only COUNTS keys, so which foam piece sits over which key does not matter.
export const LADDER = {
  throttle: ['Digit8', 'Digit9', 'Digit0'],
  brake: ['Digit1', 'Digit2', 'Digit3'],
};

// GEAR SELECTOR — Shift + number pad, and it is INCREMENTAL.
//
// One ladder, not three modes:
//
//     REVERSE  <--  NEUTRAL  -->  1st (DRIVE)  -->  2nd  -->  3rd ...
//
// You start in NEUTRAL: no drive at all, and the engine just revs. Shift UP
// once and you are in DRIVE. Crash, shift DOWN twice — through neutral — and
// you are in reverse. Back out, shift up twice, and you are driving again.
//
// Two up/down pairs because that is how the pad is laid out: 8 over 2 in the
// middle column, 7 over 1 on the left. Either works, they do the same thing.
//
// Shift is deliberate: Digit0/1/2/3/8/9 are ladder-pedal keys (above), and a
// foot on a cardboard flap never holds Shift, so they can share keys and never
// collide. Top-row digits are accepted as well as the pad because the MX Keys
// Mini has no number pad at all.
export const SHIFT_UP = ['Numpad8', 'Numpad7', 'Digit8', 'Digit7'];
export const SHIFT_DOWN = ['Numpad2', 'Numpad1', 'Digit2', 'Digit1'];
export const REVERSE = -1, NEUTRAL = 0;
// What to show for a selector position: -1 R, 0 N, 1.. the gear number.
export const selName = sel => sel < 0 ? 'R' : sel === 0 ? 'N' : String(sel);
const LADDER_KEYS = new Set([...LADDER.throttle, ...LADDER.brake]);

// What each step is worth, by how many keys are down (0, 1, 2, 3). The
// throttle is even. The brake is not: the car already stops at the tyres'
// limit on a full pedal (6.5 g from 300 km/h, tools/brakecheck.mjs — real F1
// is 5-6 g), so more brake force would only lock the wheels. What a stronger
// FEEL wants instead is a pedal where the top of the range takes a stamp: the
// first two steps are for squeezing and trail-braking, and all of it only
// arrives when you slam the pedal onto its stop.
export const LADDER_STEPS = {
  throttle: [0, 1 / 3, 2 / 3, 1],
  brake: [0, 0.2, 0.5, 1],
};

// Move toward a target, no faster than `up` going up or `dn` coming down.
const approach = (v, target, up, dn) =>
  target > v ? v + Math.min(up, target - v) : v - Math.min(dn, v - target);

const PAD_BUTTONS = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9 };

// The driver's hands, as rates. Exported so tools/human.mjs drives with the
// SAME numbers instead of a copy that silently drifts from the game.
//
// WIND was 2.7 (0.37 s from centre to full lock) and read as sluggish on a
// keyboard: "the car isn't as responsive as it should be". 4.6 is 0.22 s,
// about as fast as hands move on a real wheel, and the centring is quicker
// still so letting go still catches a slide faster than winding on caused it.
// WIND_SOFT / WIND_FULL: the wind-on is PROGRESSIVE now, not linear.
//
// Adam: "for keyboard, make steering inputs like the throttle, the longer you
// hold the greater the value."
//
// It always ramped — but at ONE rate, so a tap and a hold differed only in how
// long they lasted and there was no fine-angle region at all. You were either
// not turning enough yet or already past the tyres. Starting at 32% and
// reaching full after RAMP seconds gives a usable small-angle region for
// corrections and still reaches full lock when you commit to a corner.
//
// This may also be some of what he means by the car feeling "like theyre on
// rain": an input with no small region reads as a car that will not hold a
// line, which is what no grip feels like.
export const RATES = {
  WIND: 4.6, WIND_SOFT: 0.32, RAMP: 0.45,
  CENTRE: 8.2, tUp: 3.4, tDn: 7.5, bUp: 5.5, bDn: 9,
};

export class Hands {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.wheel = 0;            // -1..1, where the driver's hands actually are
    this._windWant = 0; this._windT = 0;   // which way, and for how long
    this.throttle = 0; this.brake = 0;
    this.usingPad = false; this.padName = '';
    this.pad = null;
    this._padPrev = {};
    // An outside wheel: a function returning
    // -1..1 while it is live, or null. Kept as a hook so this file never
    // needs the network to run — the Node harnesses import it.
    this.wheelSource = null;
    // Start in NEUTRAL, like a real car you have just got into.
    this.selector = NEUTRAL;
    this.maxGear = 8;                // main.js sets this from the car's gearbox

    this._kd = e => {
      if (e.repeat) return;
      if (e.shiftKey) {
        const up = SHIFT_UP.includes(e.code), down = SHIFT_DOWN.includes(e.code);
        if (up || down) {
          // One step per press, clamped. You cannot skip neutral on the way to
          // reverse, which is the whole point of a sequential selector.
          this.selector = Math.max(REVERSE, Math.min(this.maxGear, this.selector + (up ? 1 : -1)));
          e.preventDefault();
          return;
        }
      }
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (LADDER_KEYS.has(e.code) || Object.values(KEYMAP).some(a => a.includes(e.code))) e.preventDefault();
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
  // how far down a ladder pedal is, 0..1
  ladder(action) {
    let n = 0;
    for (const c of LADDER[action]) if (this.down.has(c)) n++;
    return LADDER_STEPS[action][n];
  }
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
    const { WIND_SOFT, RAMP } = RATES;
    const pad = this._readPad();
    if (pad) {
      this.usingPad = true;
      this.wheel = pad.steer; this.throttle = pad.throttle; this.brake = pad.brake;
      return { wheel: this.wheel, throttle: this.throttle, brake: this.brake };
    }
    this.usingPad = false;
    const want = (this.held('left') ? 1 : 0) - (this.held('right') ? 1 : 0);
    const { WIND, CENTRE } = RATES;
    const ext = want === 0 && this.wheelSource ? this.wheelSource() : null;
    if (ext != null) {
      // The phone already IS a wheel position, so no wind-on — but it only
      // reports ~30 times a second, so slew toward it rather than stepping,
      // or the rack jumps every 33 ms. 9/s is centre to full lock in 0.11 s,
      // faster than any hands; it smooths the steps, not the driver.
      const PHONE_SLEW = 9;
      this.wheel += Math.max(-PHONE_SLEW * dt, Math.min(PHONE_SLEW * dt, ext - this.wheel));
    } else if (want !== 0) {
      // How long this direction has been held. Changing direction restarts it,
      // so a flick back the other way is as fine as the first one was — which
      // is the whole point when you are catching a slide.
      if (want !== this._windWant) { this._windWant = want; this._windT = 0; }
      this._windT += dt;
      const k = WIND_SOFT + (1 - WIND_SOFT) * Math.min(1, this._windT / RAMP);
      const rate = WIND * k * (want * this.wheel < 0 ? 1.8 : 1);  // reversing lock is quicker
      this.wheel += Math.sign(want - this.wheel) * Math.min(rate * dt, Math.abs(want - this.wheel));
    } else {
      this._windWant = 0; this._windT = 0;
      const d = Math.min(CENTRE * dt, Math.abs(this.wheel));
      this.wheel -= Math.sign(this.wheel) * d;
    }
    const { tUp, tDn, bUp, bDn } = RATES;
    // A held key asks for 1; a ladder pedal asks for its step; whichever is
    // further down wins. With no pedal this is exactly the old key ramp.
    const tWant = Math.max(this.held('throttle') ? 1 : 0, this.ladder('throttle'));
    const bWant = Math.max(this.held('brake') ? 1 : 0, this.ladder('brake'));
    this.throttle = approach(this.throttle, tWant, tUp * dt, tDn * dt);
    this.brake = approach(this.brake, bWant, bUp * dt, bDn * dt);
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
