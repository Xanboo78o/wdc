// pitstop.hpp — the pit lane as a RULE SET, not as scenery (js/pitstop.js).
// The car is DRIVEN down the lane with the same delta/throttle/brake the driver
// uses: it still has grip, can still be hit, and can still get it wrong.
#pragma once
#include <array>
#include <deque>
#include <string>
#include <vector>

#include "entry.hpp"

namespace xbr {

constexpr double PIT_SPEED = 80 / 3.6;     // the F1 limiter, m/s
constexpr double BOX_PITCH = 14.4;         // metres of lane per garage
constexpr int MAX_BOXES = 12;              // eleven teams and a spare for you
constexpr double BOX_SIDE = 3.3;           // metres from the fast lane's line to the box, garage side
namespace SERVICE { constexpr double tyres = 2.4, nose = 11.5, floor = 7.5; }

std::vector<std::array<double, 2>> resampleLane(const std::vector<std::pair<double, double>> &pts, double step = 2);

// One layout, used by BOTH the race (where a car stops) and the renderer.
struct GarageLayout {
  bool ok = false;
  std::vector<std::array<double, 2>> P;    // the lane resampled to 2 m, smoothed
  int n = 0;
  double startM = 0;
  std::vector<double> s;                   // garage k's centre, as distance along the lap
  int idxAt(double m) const;
};
GarageLayout garageLayout(const Track &track);

struct Lane {
  double entryS = 0, exitS = 0, off = 0, len = 0;
  int garages = 0;
  bool closed = false, hold = false;       // race control's: PIT ENTRY CLOSED, the red flag's car park
  GarageLayout G;
  int boxes = 22;
  double trackLen = 0;
  // Where each car stops: box = garage * 2 + mark (the race assigns them).
  double boxS(int i) const;
  double spreadS(int i) const;
};
Lane makeLane(const Track &track, int boxes = 22);
double laneLat(const Lane &lane, double prog);
double laneProgress(const Track &track, const Lane &lane, double s);

bool shouldPit(const Car &car);
struct Service { std::vector<std::string> jobs; double time = 0; };
Service serviceFor(const Car &car);
void repair(Car &car, const std::vector<std::string> &jobs);

// One car's stop. True on the substep the car is served (or its drive-through
// is done). `others` is the field, for the release.
bool updateStop(Entry &e, const Track &track, Lane &lane, const Proj &proj, double dt, double peak = 0.13,
                std::deque<Entry> *others = nullptr);

// A JS number as a template string prints it (5 -> "5", 2.5 -> "2.5").
std::string jsNum(double v);

}  // namespace xbr
