// collide.hpp — rigid-body contact against the barriers (js/collide.js). The
// car is a rectangle and its CORNERS hit things.
//
// NOT PORTED YET: resolveCars (car to car). It arrives with the grid.
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

}  // namespace xbr
