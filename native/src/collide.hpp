// collide.hpp — rigid-body contact against the barriers (js/collide.js). The
// car is a rectangle and its CORNERS hit things.
//
// resolveCars is the same solver with two moving bodies: SAT on two rectangles.
#pragma once
#include "physics.hpp"
#include "track.hpp"

namespace xbr {

struct Hit {
  bool hit = false;
  double depth = 0, closing = 0, j = 0, harm = 0;
  const char *part = "";
  bool launched = false;
};

// Call every substep, AFTER the physics step. `hint` is the car's own sample.
Hit resolveBarrier(Car &car, const Track &track, int hint = -1);

// Car to car. `hit` false = the JS's null: not touching. `harm` is 0 unless
// the two were closing (the JS leaves it undefined, and every test of it is >).
struct CarHit {
  bool hit = false;
  double depth = 0, closing = 0, nx = 0, ny = 0, j = 0, harm = 0;
  bool launched = false;
};
CarHit resolveCars(Car &a, Car &b, double restitution = 0.18);

}  // namespace xbr
