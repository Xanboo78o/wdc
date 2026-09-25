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
import { bridgeButtons } from './bridgebtn.js';

export const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  drs: ['Space'],
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

// REVERSE. Shift. That is the whole binding.
//
// Shift was in KEYMAP as `look` and nothing anywhere read it — dead config —
// so taking it costs nothing. There is no gear selector and no neutral:
// gearbox.js is a sound model, not a drivetrain, so there was never a
// mechanical gear to choose. Tap to go into reverse, tap to come out, and
// physics.js caps it at a 25 km/h crawl.
export const REVERSE_KEYS = ['ShiftLeft', 'ShiftRight'];
export const selName = sel => sel < 0 ? 'R' : 'D';
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

// The rim's controls, named by what they DO.
//
// A wheel declares 128 buttons and has about a dozen, and nothing says which
// index is MENU. Worse, a D-PAD is usually not buttons at all — on the R3 it
// is a HAT: two axes resting at 0 that jump to ±1. So a control is either
// `{b: index}` or `{ax: index, dir: ±1}`, and pad.html records which.
//
// Everything downstream asks for 'w:pause', never for button 9. A different
// wheel needs no code change, only two minutes of pressing things.
function controlDown(p, c) {
  if (!c) return false;
  // An ARRAY means several candidates for one action. That is not sloppiness,
  // it is the only honest thing to ship without the wheel in front of me: the
  // R3 reports BTN_TRIGGER, BTN_THUMB, BTN_THUMB2 ... — generic joystick codes
  // carrying no meaning, so nothing in software can know which one is MENU.
  // Binding the two or three usual positions means the action works even where
  // the guess was wrong, at the cost of a spare button doing the same job.
  // One press into pad.html replaces the whole guess with the truth.
  if (Array.isArray(c)) return c.some(x => controlDown(p, x));
  // Or held according to tools/ffb.py, which reads the buttons Chrome cuts
  // off (it passes only the first 32; MENU is 37). See js/bridgebtn.js.
  if (c.b != null) return !!(p.buttons[c.b] && p.buttons[c.b].pressed) || bridgeButtons.has(c.b);
  if (c.ax != null) {
    const v = p.axes[c.ax];
    return v != null && Math.abs(v) > 0.5 && Math.sign(v) === c.dir;
  }
  return false;
}

// A calibration saved by pad.html, if this origin has one.
function readStored() {
  try {
    const raw = localStorage.getItem('wdc.wheel');
    if (!raw) return null;
    const p = JSON.parse(raw);
    return (p && p.steer && p.throttle && p.brake) ? p : null;
  } catch { return null; }          // blocked storage: keyboard still works
}

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
    // Which named rim controls are held right now, and the map that names
    // them. `wheelDown` exists for hold-to-talk radio; taps come through
    // `pressed` as 'w:<name>' like any key.
    this.wheelDown = new Set();
    this._btnMap = null;
    this._wheelPrev = {};
    this.selector = 1;               // 1 drive, -1 reverse. Shift+R toggles.

    this._kd = e => {
      if (e.repeat) return;
      if (REVERSE_KEYS.includes(e.code)) {
        // Not while typing: Shift is also how you make a capital letter, and
        // silently dropping into reverse from the menu would be baffling.
        const t = e.target && e.target.tagName;
        if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT') {
          this.selector = this.selector < 0 ? 1 : -1;
          e.preventDefault();
        }
        return;
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
    // NEVER on a wheel. Chrome sends the rumble to the wheel base itself, and
    // on the R3 that knocked out tools/ffb.py's steering force: Adam,
    // 2026-09-24, "only on crashes i get feedback" — the crash rumble got
    // through, and the steering weight went dead after it. The bridge already
    // plays the crash jolt.
    if (this.onWheel) return;
    const p = this.pad;
    const act = p && (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]));
    if (!act) return;
    try {
      if (act.playEffect) act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      else if (act.pulse) act.pulse(Math.max(strong, weak), ms);
    } catch { /* ignore */ }
  }

  /**
   * A calibrated wheel, if pad.html has saved one.
   *
   * A wheel is not a pad. The "standard" mapping puts steering on axes[0] and
   * the pedals on the two TRIGGERS; a wheel reports no mapping at all and puts
   * its pedals on AXES, at indices that differ per manufacturer and usually
   * resting at +1 and travelling to -1. None of that is guessable, so it is
   * measured once in pad.html and stored — and everything below works off the
   * measurement rather than off a table of device names that would need a new
   * entry for every wheel ever made.
   */
  _profile() {
    if (this._prof !== undefined) return this._prof;
    this._prof = readStored();
    return this._prof;
  }

  /**
   * Load a wheel profile, from storage or from the repo.
   *
   * WHY THERE IS A FILE. localStorage is per ORIGIN, and this game is reachable
   * at 127.0.0.1:8176, at localhost:8176 and at xanboo78o.github.io — three
   * separate stores. Calibrate in one, drive in another, and the profile is
   * simply not there. The code then falls down the Xbox path, where steering
   * works off axes[0] by luck and the pedals are hunted for on TRIGGERS a
   * wheel does not have. Symptom: the steering works and the pedals are dead,
   * with nothing anywhere saying why. That cost an evening.
   *
   * So a calibration also ships as data/wheel.json, which is served from
   * whatever origin the game is on and cannot go missing. Storage still wins
   * when it has something — a calibration you just did on the machine in front
   * of you should beat a file committed last week.
   */
  async loadProfile(base = './') {
    const stored = readStored();
    if (stored) { this._prof = stored; return stored; }
    try {
      const r = await fetch(`${base}data/wheel.json`);
      if (r.ok) {
        const p = await r.json();
        if (p && p.steer && p.throttle && p.brake) { this._prof = p; return p; }
      }
    } catch { /* no file: keyboard and pads still work exactly as before */ }
    this._prof = null;
    return null;
  }

  /**
   * The rim's button map: whichever of storage and the shipped file is NEWER.
   * It was "storage first", which meant a map saved once from the old guess
   * kept the rim dead forever, however right the file became. A saved map
   * with no date is the oldest thing there is.
   */
  async loadButtons(base = './') {
    let saved = null, file = null;
    try {
      const raw = localStorage.getItem('wdc.wheelbtn');
      if (raw) { const m = JSON.parse(raw); if (m && m.map) saved = m; }
    } catch { /* blocked storage */ }
    try {
      const r = await fetch(`${base}data/wheelbtn.json`);
      if (r.ok) { const m = await r.json(); if (m && m.map) file = m; }
    } catch { /* none: the wheel still steers, the keys still work */ }
    const pick = saved && (!file || String(saved.saved || '') > String(file.saved || '')) ? saved : file;
    this._btnMap = pick ? pick.map : null;
    this._btnFrom = pick === saved ? 'storage' : pick ? 'file' : null;
    return this._btnMap;
  }

  /** Is a named rim control held down right now? */
  wheelHeld(name) { return this.wheelDown.has(name); }

  _readWheel(p, prof) {
    // Map through the two ends that were actually recorded, so an inverted
    // axis needs no flag — it inverts itself. `centre` is the RESTING value
    // and is not assumed to be zero: a wheel that has not been re-centred
    // since power-on can rest anywhere, and assuming 0 leaves a permanent
    // input in the rack that reads as the car pulling to one side.
    const s = prof.steer, raw = p.axes[s.ax] || 0;
    const off = raw - s.centre;
    const toLeft = s.left - s.centre;     // signed travel from rest to full left
    const toRight = s.right - s.centre;   // ... and to full right
    // A few thousandths of play at centre. NOT the pad's 8% — a wheel has real
    // resolution there and a fat deadzone throws away its whole advantage.
    const DZ = 0.012;
    let steer = 0;
    if (Math.abs(off) > DZ) {
      // Whichever end the wheel has moved toward decides the sign, and the
      // ratio to that end's own travel decides the amount. An axis that runs
      // backwards inverts itself here with no flag anywhere: if full left was
      // recorded as -0.9 then toLeft is negative, off is negative, and the
      // quotient comes out positive — which is LEFT in sim terms.
      if (toLeft && Math.sign(off) === Math.sign(toLeft)) steer = Math.min(1, off / toLeft);
      else if (toRight) steer = -Math.min(1, off / toRight);
    }
    const ped = (d) => {
      const t = d.full - d.rest;
      return t ? Math.max(0, Math.min(1, ((p.axes[d.ax] || 0) - d.rest) / t)) : 0;
    };
    const throttle = ped(prof.throttle), brake = ped(prof.brake);
    return { steer, throttle, brake, live: Math.abs(steer) > 0.02 || throttle > 0.03 || brake > 0.03 };
  }

  _readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.pad = p;
      const prof = this._profile();
      // MATCH ON SHAPE, NOT ON NAME. Requiring p.id === prof.id meant any
      // difference in the device string — a different browser build, a
      // profile that travelled from another machine, a wheel reconnected
      // under a slightly different name — silently dropped a perfectly good
      // calibration and fell through to the Xbox mapping. What actually
      // matters is whether this device HAS the axes the profile refers to: an
      // Xbox pad has four, so a profile needing axis 5 correctly declines it,
      // and a wheel that has them is a wheel whatever it calls itself.
      const needs = Math.max(prof ? prof.steer.ax : 0, prof ? prof.throttle.ax : 0, prof ? prof.brake.ax : 0);
      this.onWheel = !!(prof && p.axes.length > needs);
      if (this.onWheel) {
        const now = {};
        for (const [name, idx] of Object.entries(PAD_BUTTONS)) now[name] = !!(p.buttons[idx] && p.buttons[idx].pressed);
        for (const name in now) if (now[name] && !this._padPrev[name]) this.pressed.add('pad:' + name);
        this._padPrev = now;
        // Named rim controls, edge-detected into `pressed` exactly like keys,
        // so main.js binds 'w:pause' and never learns a button index.
        if (this._btnMap) {
          this.wheelDown.clear();
          for (const name in this._btnMap) {
            const down = controlDown(p, this._btnMap[name]);
            if (down) this.wheelDown.add(name);
            if (down && !this._wheelPrev[name]) this.pressed.add('w:' + name);
            this._wheelPrev[name] = down;
          }
        }
        const w = this._readWheel(p, prof);
        this.usingWheel = w.live;
        // NOTE the buttons above are read before this returns null. A rim
        // sitting still is not live for STEERING, but MENU must still open the
        // pause menu — the first version bailed out here and the buttons only
        // worked while the car was already being driven.
        return w.live ? { steer: w.steer, throttle: w.throttle, brake: w.brake } : null;
      }
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
