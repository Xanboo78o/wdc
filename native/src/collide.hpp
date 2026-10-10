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

// WHAT CAME OFF IS ON THE ROAD (the native game only; Adam 2026-10-10: "we shoudlve already had this"). A wheel or
// a wing that has left a car is a thing the others can hit. Whoever simulates the pieces (fx.cpp) lists them, once a
// frame; the race reads the list (its drivers go round what they can see, race control flags it and sends marshals)
// and the game runs every car against it. A harness has no pieces, and nothing here ever runs in one.
struct Hazard {
  int id = 0;
  double x = 0, y = 0, vx = 0, vy = 0;   // the sim's plane, m and m/s
  double r = 0.3, mass = 10;             // r <= 0: already struck this frame
  double lift = 0;                       // how far its lowest point is off the ground: a wheel in the air goes over you
  bool wheel = false, still = false;     // still: lying where it stopped
  double s = 0, lat = 0, w = 0;          // where that is on the lap (Race::setHazards fills these)
};
// What a car did to a piece: the speed it leaves at, and whether it survived. `blow` is the wall speed with the
// same energy (m/s), for the sound and the wheel in your hands; `harm` what it added to the car's damage.
struct Struck { int id = 0; double vx = 0, vy = 0, up = 0, blow = 0, harm = 0; bool shatter = false; };
// False = not touching. Otherwise the car has been slowed, dented and perhaps punctured, and `out` is for the piece.
bool resolveHazard(Car &car, const Hazard &h, Struck &out);

}  // namespace xbr
