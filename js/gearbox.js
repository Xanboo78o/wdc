// gearbox.js — gears, and the engine speed that comes with them.
//
// Imports nothing. Same law as physics.js: pure numbers, so a harness in Node
// and the browser both get the same answer.
//
// WHY THIS EXISTS: the car had no RPM at all. physics.js models the engine as
// `min(Pmax/v, Fdrive)` — a power curve with no ratios anywhere — which drives
// a car perfectly well and gives you nothing to listen to. Without gears an
// engine note just rises smoothly from a standstill to 321 km/h, one long
// swell, and the up-down-up-down of shifting is most of what a single-seater
// actually sounds like.
//
// WHAT THIS IS NOT, and it matters: it does NOT change how the car
// accelerates. The force model in physics.js is untouched and every validated
// number — 321 km/h, the Monaco hairpin at 45 km/h, every lap time — is
// bit-for-bit what it was. This reads the speed the car already has and says
// what the engine must be doing to produce it. A real torque curve, where the
// gear you are in changes the force you get, is a separate change that moves
// lap times and has to be measured on its own.
//
// The ratios are expressed as the speed at which each gear hits the limiter,
// because that is the number you can check against a real car and the number
// that has to agree with the validated top speed. Top gear's limiter speed IS
// the car's top speed, so the two cannot drift apart.

export const BOXES = {
  f1: {
    idle: 4000,
    limit: 15000,
    // Shift up a little before the limiter, the way a real seamless box does —
    // sitting on the limiter is slower and it sounds like a mistake.
    shiftUp: 14700,
    // Drop a gear when the lower one would still be under this. Hysteresis:
    // without a gap between the up-point and the down-point the box hunts
    // between two gears forever on a constant-speed corner.
    downAt: 0.74,
    // km/h at which each gear reaches `limit`. Eight gears, and 8th tops out at
    // 321 km/h, which is physics.js's drag-limited top speed.
    tops: [85, 115, 146, 176, 208, 240, 280, 321],
  },
  f4: {
    idle: 1800,
    limit: 6500,
    shiftUp: 6300,
    downAt: 0.72,
    // Six gears to about 215 km/h, where an F4 car is drag-limited.
    tops: [55, 80, 108, 138, 175, 215],
  },
  gt3: {
    // A big naturally-aspirated GT engine: it idles low, revs to 7800, and
    // pulls from far further down than a single-seater — which is why a GT3
    // sounds like it is working and an F1 car sounds like it is screaming.
    idle: 1250,
    limit: 7800,
    shiftUp: 7500,
    downAt: 0.70,
    // Six gears to the drag-limited 273 km/h.
    tops: [95, 130, 168, 205, 240, 273],
  },
};

export function boxFor(spec) {
  return BOXES[spec.key] || BOXES.f1;
}

// Engine speed in a given gear at a given road speed. Linear within a gear,
// which is what a fixed ratio is.
export function rpmAt(box, speedKmh, gear) {
  const top = box.tops[Math.max(0, Math.min(box.tops.length - 1, gear))];
  const r = box.limit * (speedKmh / top);
  return Math.max(box.idle, Math.min(box.limit, r));
}

// The gear an automatic box would be in at this speed. Used to pick a sensible
// starting gear and by anything that does not want to carry shift state.
export function gearAt(box, speedKmh) {
  for (let g = 0; g < box.tops.length; g++) {
    if (box.limit * (speedKmh / box.tops[g]) <= box.shiftUp) return g;
  }
  return box.tops.length - 1;
}

// A box with memory. Hysteresis and a shift cut live here, so the gear you are
// in depends on the gear you were in — which is what stops it hunting.
export function makeBox(spec) {
  const box = boxFor(spec);
  return {
    box,
    gear: 0,
    neutral: false,      // selector in N: engine revs, wheels get nothing
    reverse: false,
    rpm: box.idle,
    shiftT: 0,           // seconds left of the current shift
    shifted: 0,          // +1 up, -1 down, 0 none — one frame only, for a cue
    // `dt` and speed in km/h. Call it once a frame; it is not a physics step
    // and nothing downstream integrates it.
    // `sel` is the driver's SEQUENTIAL SELECTOR when he is holding it himself:
    // -1 reverse, 0 neutral, 1..n a gear. Leave it undefined and the box shifts
    // itself exactly as it always did — which is what every AI car and every
    // harness does, so none of them are affected by manual shifting existing.
    update(dt, speedKmh, throttle = 1, sel) {
      this.shifted = 0;
      if (this.shiftT > 0) this.shiftT = Math.max(0, this.shiftT - dt);
      const last = this.box.tops.length - 1;

      if (sel !== undefined) {
        const was = this.gear, wasN = this.neutral;
        this.neutral = sel === 0;
        this.reverse = sel < 0;
        // Reverse runs on first gear's ratio; there is only one of them.
        this.gear = Math.max(0, Math.min(last, (sel <= 0 ? 1 : sel) - 1));
        if (this.gear !== was || this.neutral !== wasN) { this.shiftT = 0.05; this.shifted = this.gear > was ? 1 : -1; }

        // NEUTRAL: nothing is connected to the wheels, so the engine answers
        // the pedal and nothing else. This is the wild revving — road speed is
        // not in it anywhere, which is exactly why it sounds wrong-and-right.
        const target = this.neutral
          ? this.box.idle + (this.box.limit - this.box.idle) * Math.min(1, throttle)
          : rpmAt(this.box, Math.abs(speedKmh), this.gear) * (0.93 + 0.07 * Math.min(1, throttle));
        // An unloaded engine picks up and drops far faster than a loaded one.
        const rate = this.neutral ? 6 : 26;
        this.rpm += (Math.max(this.box.idle, target * (this.shiftT > 0 ? 0.82 : 1)) - this.rpm) * Math.min(1, dt * rate);
        return this;
      }
      this.neutral = false; this.reverse = false;

      const raw = this.box.limit * (speedKmh / this.box.tops[this.gear]);
      if (this.shiftT === 0) {
        if (raw > this.box.shiftUp && this.gear < last) {
          this.gear++; this.shiftT = 0.05; this.shifted = 1;
        } else if (this.gear > 0) {
          // Would the gear below still be comfortably under the limiter?
          const below = this.box.limit * (speedKmh / this.box.tops[this.gear - 1]);
          if (below < this.box.limit * this.box.downAt) {
            this.gear--; this.shiftT = 0.05; this.shifted = -1;
          }
        }
      }
      const target = rpmAt(this.box, speedKmh, this.gear);
      // Off the throttle the engine does not hold revs the way it does on it;
      // and during a shift it drops. Both are what you hear, not what you feel.
      const cut = this.shiftT > 0 ? 0.82 : 1;
      const want = target * cut * (0.93 + 0.07 * Math.min(1, throttle));
      // A little inertia, or every gearchange is a step function.
      this.rpm += (Math.max(this.box.idle, want) - this.rpm) * Math.min(1, dt * 26);
      return this;
    },
  };
}
