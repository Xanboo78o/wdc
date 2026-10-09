// xingus.cpp — js/xingus.js, ported line for line.
#include "xingus.hpp"

#include <algorithm>
#include <cmath>
#include <map>

namespace xbr {

static const double D2R = PI / 180;
static const double DRIFT_MIN = 14 * D2R, DRIFT_MAX = 40 * D2R;
static const double T_GRIP = 0.05;
static const double RATE_IN = 75 * D2R, RATE_OUT = 55 * D2R;
static const double HOLD_ON = 1.6, HOLD_OFF = 7;
static const double TURN_G = 4.3, TURN_G_FAST = 3.6;
static const double BANK_G = 1.6, BANK_MAX = 5;
static const double STEER_AT[6] = {0, 0.85, 0.62, 0.45, 0.33, 0.24};
static int steerLevel = 3;
static const double SCRUB_ON = 0.4, SCRUB_OFF = 3.5;
static const double V_MIN = 9, V_DRIFT = 15;
static const double G = 9.81;

int xingusSteer(int level) {
  if (level != 0) steerLevel = std::max(1, std::min(5, level));
  return steerLevel;
}

Spec &xingusSpec(Spec &spec, const std::string &tuneIn) {
  static std::map<std::string, Spec> TUNED;
  const std::string tune = tuneIn == "rally" ? "rally" : "gt";
  const std::string k = spec.key + "|" + tuneIn;
  auto it = TUNED.find(k);
  if (it == TUNED.end()) {
    // { ...spec, ...T.f(spec), mu, loadSens }: a COPY, caches and all, as the spread copies them.
    Spec s = spec;
    double mu = 1.22;
    if (tune == "rally") {
      mu = 1.16;
      s.Fdrive = spec.Fdrive * 1.3; s.ClA = spec.ClA * 0.45; s.CdA = spec.CdA * 0.85;
      s.h = (spec.h != 0 ? spec.h : 0.45) + 0.07;
    }
    s.mu = spec.mu * mu;
    s.loadSens = spec.loadSens * 0.5;
    it = TUNED.emplace(k, s).first;
  }
  return it->second;
}

void xingusCar(Car &car, const std::string &tune, bool stakes) {
  car.spec = &xingusSpec(*car.spec, tune);
  car.aids.tc = 0.9; car.aids.abs = 0.9; car.aids.sc = 0;      // stability is this file's job now
  car.xg = Xg{};
  car.xg.on = true;
  car.xg.loose = tune == "rally" ? 0.97 : 0.84;
  car.xg.stakes = stakes;
}

void xingusStep(Car &car, const PlayerInput &inp, double dt) {
  Xg &x = car.xg;
  if (!x.on) return;
  const double iDelta = std::isnan(inp.delta) ? 0 : inp.delta;
  const double iBrake = std::isnan(inp.brake) ? 0 : inp.brake;
  // It forgives — unless there are stakes.
  if (!x.stakes) car.damage = 0;
  if (!x.stakes && car.onRoof && car.speed < 12) {
    car.onRoof = false; car.airborne = false; car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
  }
  if (car.airborne) return;                               // in the air it is the air's
  const double vx = car.vx, v = std::hypot(car.vx, car.vy);
  x.lock = std::max(x.lock, std::fabs(iDelta));
  const double steer = !std::isnan(inp.wheel) ? inp.wheel : iDelta / x.lock;
  const double thr = std::isnan(inp.throttle) ? 0 : inp.throttle;
  if (v < V_MIN || vx < 2) { x.state = 0; x.vHold = 0; x.beta = std::atan2(car.vy, std::max(0.01, std::fabs(vx))); return; }

  // ---- in or out of a drift
  x.flick = std::fabs(steer) > 0.85 && thr > 0.85 ? x.flick + dt : 0;
  const bool trail = iBrake > 0.55 && std::fabs(steer) > 0.3;
  if (x.state != 1 && v > V_DRIFT && std::fabs(steer) > 0.2 && (inp.hand || x.flick > 0.25 || trail)) {
    x.state = 1; x.dir = sign(steer); x.calm = 0;
  }
  if (x.state == 1) {
    const double into = steer * x.dir;                    // + = still steering into the turn
    x.calm = (into < 0.12 || (thr < 0.08 && !inp.hand && iBrake < 0.25)) ? x.calm + dt : 0;
    if (x.calm > (into < -0.3 ? 0.08 : 0.4) || v < V_MIN + 2) { x.state = 2; x.calm = 0; }
  } else if (x.state == 2 && std::fabs(x.beta) < GRIP_BETA * 0.8) x.state = 0;

  // ---- the slip angle it is allowed
  double beta = std::atan2(car.vy, vx), speed = v;
  // ---- the gear you are in: the limiter, and lugging
  if (inp.gearTop != 0) {
    const double top = inp.gearTop, low = inp.gearLow;
    if (v > top) speed = std::max(top, v - 9 * dt);
    else if (!std::isnan(x.vPrev) && v > x.vPrev && thr > 0.05) {
      const double frac = v / top, lug = std::max(0.3, std::min(1.0, 0.3 + 1.6 * (frac - 0.25)));
      speed = x.vPrev + (v - x.vPrev) * (low != 0 && frac < 0.62 ? lug : 1);
    }
    x.vHold = x.vHold != 0 ? std::min(x.vHold, top) : 0;
  }
  if (x.state == 1 || x.state == 2) {
    // The angle is COMMANDED, not coaxed.
    const double into = std::max(0.0, std::min(1.0, steer * x.dir));
    const double target = x.state == 1 ? -x.dir * (DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * into) : 0;
    const double rate = (x.state == 1 ? RATE_IN : RATE_OUT) * dt;
    beta = x.beta + std::max(-rate, std::min(rate, target - x.beta));
    if (x.state == 1) {
      // The line: the wheel sets how hard the car is turning, not the tyres.
      const double rWant = x.dir * std::min(2.8, (1.25 + (TURN_G + std::min(BANK_MAX, std::fabs(x.bank) / 10 * BANK_G) - 1.25) * std::min(1.0, into * 2)) * G / v);
      const double r0 = std::isnan(x.r) ? car.r : x.r;
      x.r = r0 + std::max(-3 * dt, std::min(3 * dt, rWant - r0));
      car.r = x.r;
      // And the speed: a drift costs HOLD_ON on the power and HOLD_OFF off it.
      if (iBrake < 0.1) {
        x.vHold = std::max(v, (x.vHold != 0 ? x.vHold : v) - (HOLD_ON + (HOLD_OFF - HOLD_ON) * (1 - thr)) * dt);
        speed = inp.gearTop != 0 ? std::min(x.vHold, inp.gearTop) : x.vHold;
      } else x.vHold = v;
    }
  } else {
    const double target = std::max(-GRIP_BETA, std::min(GRIP_BETA, beta));
    beta += (target - beta) * std::min(1.0, dt / T_GRIP);
    if (x.state == 0) {
      beta = target;                     // in grip the limit is a limit, not a spring
      // THE WHEEL TURNS THE CAR: in grip the yaw rate is the wheel's.
      const double sEff = sign(steer) * std::min(1.0, std::pow(std::fabs(steer) / STEER_AT[steerLevel], 0.85));
      const double aMax = (TURN_G - (TURN_G - TURN_G_FAST) * std::max(0.0, std::min(1.0, (v - 30) / 45)) + std::min(BANK_MAX, std::fabs(x.bank) / 10 * BANK_G)) * G;
      // x.gCap (g): all the cornering the tyres have left. Only an oval's stock rules set it.
      const double rCmd = sEff * std::min((x.gCap != 0 ? std::min(aMax, x.gCap * G) : aMax) / v, 2.8);
      car.r += (rCmd - car.r) * std::min(1.0, dt / (0.10 - 0.012 * steerLevel));
      if (!std::isnan(x.vPrev) && iBrake < 0.1 && x.vPrev - speed < 1 && speed < x.vPrev)
        speed = std::max(speed, x.vPrev - (SCRUB_ON + (SCRUB_OFF - SCRUB_ON) * (1 - thr)) * dt);
    }
  }
  if (x.state != 1) { x.vHold = 0; x.r = NaN; }
  beta = std::max(-SPIN_BETA, std::min(SPIN_BETA, beta));
  car.vx = speed * std::cos(beta); car.vy = speed * std::sin(beta);
  x.beta = beta; x.vPrev = speed;
  // Out of a drift, the yaw rate that was holding the angle is let go.
  if (x.state == 2) car.r *= 1 - std::min(1.0, dt / 0.25) * (std::fabs(steer) < 0.2 ? 1 : 0.3);
}

}  // namespace xbr
