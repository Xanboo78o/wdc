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

// A BARRIER THAT GIVES (the native game only). Armco bends and concrete units
// shift when they are hit hard enough: how far each two-metre sample of each
// side has been pushed back, in metres, and whether the rail there is torn off
// its posts. resolveBarrier reads it (the wall is where the rail now is) and
// writes it; props.cpp draws it. OFF until reset(): the headless gates never
// turn it on, so xbr-drive and xbr-race still match the JS to the nanometre.
struct BarrierWear {
  bool on = false;
  std::vector<float> bend[2];        // [0] left of the road, [1] right
  std::vector<char> broke[2];
  // NO WALL HERE: this sample's run-off edge is not a wall at all (wallFeet below).
  // The rail is not drawn there and, in the game, nothing is hit there.
  std::vector<char> open[2];
  unsigned version = 0;              // goes up every time anything above changes
  void reset(const Track &track);
};
// WHERE THE WALL REALLY IS. The rule (resolveBarrier) calls a point wall when
// it is further from the nearest centreline sample than that sample's width
// plus run-off. Inside a corner tighter than its own run-off that rule leaves
// almost nothing: every point is nearer some other part of the road, except a
// sliver a metre or two across at the centre of the bend — an island of
// invisible wall in the middle of open ground, with the sample-by-sample edge
// running out to it as a spike (Monza's Rettifilo had both). So, per sample of
// one side (side +1 left, -1 right): 1 where the edge is a real wall — the
// ground behind it is wall too, and it is part of a run of wall, not an island.
std::vector<char> wallFeet(const Track &track, int side);
BarrierWear &barrierWear();

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
