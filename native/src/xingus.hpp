// xingus.hpp — XINGUS MODE: arcade handling for YOUR car (js/xingus.js). The
// real physics still moves the car; this runs AFTER each physics step and
// overrules it in three places: GRIP (the slip angle is held small), DRIFT (a
// commanded angle, set with the wheel) and NO SPIN (never past SPIN_BETA).
#pragma once
#include <string>

#include "physics.hpp"

namespace xbr {

// What a driver's hands and feet hand the race each substep. `delta` and
// `wheel` NaN = not given (the JS's undefined): the race then leaves the rack
// where it is, and Xingus reads the steer angle against the most seen so far.
struct PlayerInput {
  double throttle = 0, brake = 0;
  double delta = NaN;                // steer angle at the road wheels, rad, + = left
  double wheel = NaN;                // the wheel's own fraction, -1..1, + = left
  bool hand = false;                 // handbrake
  double gearTop = 0, gearLow = 0;   // manual shifting: this gear's top speed and its low end, m/s; 0 = no gearbox
};

constexpr double GRIP_BETA = 5 * PI / 180;       // the most the car slides when it is not drifting
constexpr double SPIN_BETA = 48 * PI / 180;      // the most it can ever slide

// HOW QUICK THE WHEEL IS, 1 to 5. Pass 0 to read it. (The JS keeps it in
// localStorage; a native build starts at 3, as Node does.)
int xingusSteer(int level = 0);
// A tuned COPY of a spec ("gt" | "rally"), so the serious game's car is not touched.
Spec &xingusSpec(Spec &spec, const std::string &tune = "gt");
// `stakes`: the handling still looks after you, the consequences do not.
void xingusCar(Car &car, const std::string &tune = "gt", bool stakes = false);
void xingusStep(Car &car, const PlayerInput &inp, double dt);
// Off the road is still somewhere you can drive.
inline double xingusSurface(double mu) { return mu > 0.82 ? mu : 0.82; }
inline double xingusDrag(double drag) { return 1 + (drag - 1) * 0.3; }

}  // namespace xbr
