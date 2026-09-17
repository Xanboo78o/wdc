// autopilot.js — a reference driver.
//
// It exists for two reasons, in this order:
//   1. it is the regression gate. It drives the real physics in plain Node, so
//      a change that makes the car undrivable shows up as a number instead of
//      as a feeling three days later.
//   2. it becomes the AI opponents later.
//
// Pure: no renderer, no DOM. Shares the physics module with the game, which is
// the whole point — an autopilot that drives a SIMPLIFIED copy of the physics
// proves nothing at all.
//
// THE LESSON THIS FILE WAS BUILT OUT OF (do not undo it):
// The first version recomputed the steering angle every physics substep, at
// 400 Hz, and fed it a countersteer term with a gain of 1.5. The tracer caught
// the result at Monza's first chicane — the rack flipped -1.7 deg -> +3.9 ->
// -5.5 in two tenths of a second and the slip angles diverged 4 -> 6 -> 8 ->
// 11 -> 15 -> 22 -> 30. That is a tank-slapper, not a driving error. Three
// things prevent it, and all three are load-bearing:
//   * the controller runs at a fixed CONTROL rate and holds its output between
//     updates. A driver is not a 400 Hz servo.
//   * the rack has a finite slew rate. Snapping to any angle in 2.5 ms is a
//     teleport, not a steering input.
//   * the countersteer gain is small. It is a correction, not a lunge.
import { steerLock } from './input.js';

export function makeAutopilot(track, line, spec, peak, opt = {}) {
  const o = {
    hz: 120,            // control rate. The sim runs at 400; the driver does not.
    kCross: 1.6,        // Stanley cross-track gain
    kFF: 0.85,          // curvature feed-forward scale
    kCounter: 0.40,     // countersteer gain on EXCESS rear slip
    rackRate: 6.0,      // rad/s slew limit on the steering rack
    yawDamp: 0,         // optional: damp yaw rate instead of adding an angle
    kBrake: 1.5, kThr: 2.5,
    horizon: 260, stepM: 5,
    ...opt,
  };
  // undefined from an unset CLI flag must not wipe a default
  for (const k in o) if (o[k] === undefined) delete o[k];
  const cfg = { hz: 120, kCross: 1.6, kFF: 0.85, kCounter: 0.40, rackRate: 6.0, yawDamp: 0, kBrake: 1.5, kThr: 2.5, horizon: 260, stepM: 5, ...o };

  let acc = 1e9;                       // force an update on the first tick
  let want = 0;                        // the angle the driver is asking for
  let info = { need: 0, err: 0, cross: 0, hErr: 0, excess: 0 };

  return function drive(car, proj, dt) {
    acc += dt;
    if (acc >= 1 / cfg.hz) {
      acc = 0;

      // ---- speed --------------------------------------------------------
      // Walk the speed profile forward and find the lowest speed we must
      // ALREADY be braking for, using the grip the tyres actually have right
      // now. One averaged braking number is never good enough, because braking
      // capability falls with speed exactly as downforce does.
      // line.v is ALREADY a brake-limited speed profile — line.js solved it
      // with a proper backward pass, integrating 2 m at a time with the
      // downforce that exists at each speed. So the target is simply "what the
      // profile says here", read slightly ahead to cover the controller's own
      // reaction lag.
      //
      // Two earlier versions re-derived braking on top of it and both were
      // wrong. The first held today's downforce across a 260 m horizon, which
      // flattered the brakes and arrived at every apex 10-15% too fast. The
      // second evaluated the stop at the average of current and target speed —
      // which couples the target to the car's own speed, so slowing down
      // lowers the assumed braking, which demands more braking. That feedback
      // loop parked the car at 7 km/h in a chicane asking for 50.
      const look = Math.min(60, car.speed * 0.3);
      const need = line.v[track.idx(proj.s + look)];
      const err = need - car.speed;
      // Brake gains are deliberately stiff. The lazy first version used err/6,
      // so being 12 km/h over the limit asked for 57% brake — it never caught
      // up, and arrived at every apex too fast to steer.
      car.throttle = err > 0.4 ? Math.min(1, err / cfg.kThr) : 0;
      car.brake = err < -0.25 ? Math.min(1, -err / cfg.kBrake) : 0;
      // If the rear is already gone, lifting is the only thing that helps.
      // Holding it flat while sideways is what kept the old run spinning at
      // 66 degrees of slip with the throttle pinned at 1.0.
      if (Math.abs(car.slipR) > peak * 2) { car.throttle *= 0.15; }

      // ---- steering -----------------------------------------------------
      // Stanley: cross-track error pulls back to the line, heading error
      // aligns with it. Both are measured at the line point nearest where the
      // car IS — sampling the line AHEAD makes the controller cut every apex.
      const i = proj.i;
      const px = line.pts[i * 2], py = line.pts[i * 2 + 1];
      const h = line.hdg[i];
      const cross = -Math.sin(h) * (car.x - px) + Math.cos(h) * (car.y - py);
      let hErr = h - car.hdg;
      while (hErr > Math.PI) hErr -= 2 * Math.PI;
      while (hErr < -Math.PI) hErr += 2 * Math.PI;
      let d = hErr + Math.atan2(cfg.kCross * -cross, Math.max(car.speed, 8));
      d += line.cur[i] * spec.L * cfg.kFF;

      // ---- catching the car ---------------------------------------------
      // SIGN, because it costs an afternoon: positive delta steers LEFT, and
      // in a left-hand slide the rear slip angle goes NEGATIVE, so the catch
      // must ADD sign(slipR)*excess. Subtracting winds more lock INTO the
      // slide — textbook positive feedback, and it spins the car every corner.
      const excess = Math.abs(car.slipR) - Math.abs(car.slipF);
      if (cfg.yawDamp) {
        if (excess > 0.02) d -= car.r * cfg.yawDamp;
      } else if (excess > 0.02) {
        d += Math.sign(car.slipR) * (excess - 0.02) * cfg.kCounter;
      }

      // Past the tyre's peak, MORE lock means LESS grip. Ease off continuously
      // rather than halving the angle — a multiplicative step is its own little
      // discontinuity for the loop to ring on.
      const oversat = Math.abs(car.slipF) / peak;
      if (oversat > 1 && Math.sign(d) === Math.sign(-car.slipF)) {
        d *= Math.max(0.35, 1 - (oversat - 1) * 0.9);
      }

      const lock = steerLock(car.speed);
      want = Math.max(-lock, Math.min(lock, d));
      info = { need, err, cross, hErr, excess };
    }

    // The rack moves toward what the driver is asking for at a finite rate,
    // every substep. This is the part that has to run at full rate — it is the
    // mechanism, not the decision.
    const max = cfg.rackRate * dt;
    car.delta += Math.max(-max, Math.min(max, want - car.delta));
    return info;
  };
}
