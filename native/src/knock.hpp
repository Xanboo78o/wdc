// knock.hpp — the things beside the road that a car can send flying: the foam
// blocks of an escape road and the numbered braking boards. The game only.
//
// Each is one light body: where it is, how it is turned, how fast it is going.
// A car that drives into one gives it the car's own speed and a kick upward;
// then it is the air's and the ground's until it lies still. A foam block can
// be kicked again. A board hit slowly is stamped flat and stays there; hit hard
// it snaps off its posts and goes over the roof.
//
// dress.cpp makes them (it knows where the boards stand and reads
// data/knock/<track>.json for the foam), and draws them where this says they are.
// game_main.cpp steps it once a frame with every car on the circuit.
#pragma once
#include <functional>
#include <vector>

#include "physics.hpp"

namespace xbr {

struct KnockObj {
  enum Kind { FOAM = 0, BOARD = 1 };
  enum State { STANDING = 0, FLYING = 1, LYING = 2 };
  int kind = FOAM, state = STANDING;
  // sim space: x, y on the plan, z the height of its foot above sea level
  double x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  double x0 = 0, y0 = 0, z0 = 0;        // where it was built
  double yaw = 0, yawRate = 0;          // turned about the vertical, from how it was built
  double tip = 0, tipRate = 0;          // tipped over about a level axis, radians (PI/2 = flat on the ground)
  double fallX = 1, fallY = 0;          // the level direction its top goes when it tips
  double radius = 0.8, mass = 6;
  double quiet = 0;                     // seconds before it can be hit again
};

class Knock {
 public:
  std::vector<KnockObj> objs;
  std::function<double(double, double)> ground;      // height of the ground at a point; unset = where the thing was built
  void clear() { objs.clear(); }
  int add(int kind, double x, double y, double z);
  // dt seconds, every car that could reach one. Cars are slowed by what they hit, by its weight.
  void step(double dt, const std::vector<Car *> &cars);
  int moved = 0;                                     // how many have ever been hit this session
};
Knock &knock();

}  // namespace xbr
