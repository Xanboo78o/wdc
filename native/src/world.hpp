// world.hpp — how high the ground is, everywhere (js/world.js), the shape of a
// banked corner (js/bank.js), and the ground as a surface a car stands on
// (js/terrain.js). Pure numbers: no renderer, so the race layer may use it.
//
// Everything here is in SIM coordinates (x, y). The JS takes three.js z, which
// is -y; the conversion is folded in.
#pragma once
#include <string>
#include <vector>

#include "json.hpp"
#include "physics.hpp"
#include "track.hpp"

namespace xbr {

// ---- js/bank.js ----------------------------------------------------------------
std::vector<float> bankTable(const Track &track);
double bankY(const std::vector<float> &table, const Track &track, int i, double lat);
double bankGround(const std::vector<float> &table, const Track &track, int i, double lat);
double bankRoll(const std::vector<float> &table, const Track &track, int i, double lat);

struct Near { int i = -1; double d = 1e300; };
struct Blend { double h = 0, r = 0; bool ok = false; };

class World {
 public:
  World(const Track &track, const Json &elev);
  bool on = false;
  double sinkTo = 0, seaY = 0, gridLo = 0, gridHi = 0;
  bool hasSea = false;
  std::vector<float> bank;            // bankTable, empty when the circuit is flat across

  Near nearest(double x, double y) const { return nearestIn(x, y, 12); }
  Near near(double x, double y) const;
  double gridAt(double x, double y) const;
  double trackY(int i) const { return on ? s[(size_t)i] : 0; }
  double trackYAt(double sd) const;
  double heightAt(double x, double y, const Near *nr = nullptr) const;
  double sinkAt(double d) const;
  // Where the ground you can SEE is: the height field, sunk under the circuit,
  // with the embankment of a banked corner.
  double groundY(double x, double y, const Near *nr = nullptr, bool own = false) const;
  // The surveyed gradient at lap distance s, rise over run along +s.
  double gradeAt(double sd) const { return on ? (trackYAt(sd + 4) - trackYAt(sd - 4)) / 8 : 0; }

 private:
  const Track &t;
  std::vector<double> s;              // the racing line's height per sample
  int gn = 0;
  double gx0 = 0, gy0 = 0, gdx = 1, gdy = 1;
  std::vector<double> gh;
  bool hasPlane = false;
  double plane[3] = {0, 0, 0};
  std::vector<std::pair<double, double>> bridges;
  std::vector<float> resid;
  // bucket grid over the centreline
  double bx0 = 0, by0 = 0;
  int bnx = 0, bny = 0;
  std::vector<std::vector<int>> buckets, buckets4, buckets8;
  Near nearestIn(double x, double y, int maxRing) const;
  bool otherLeg(double x, double y, int i, double reach, Near &out) const;
  bool onBridge(int i) const;
  Blend blendNear(double x, double y, double d, double R, bool both) const;
};

// ---- js/terrain.js ---------------------------------------------------------------
struct Gnd { double pitch = 0, roll = 0, gx = 0, gy = 0, dPitch = 0, dRoll = 0, bank = 0, dir = 0; };
class Terrain {
 public:
  Terrain(const Track &track, const World *world);
  double h(double s, double lat) const;
  // the plane under the four wheels, in the car's own frame
  void under(const Car &car, const Proj &pr, Gnd &g) const;
  double lift(const Car &car, const Proj &pr) const;
  const std::vector<float> &table() const { return tab; }

 private:
  const Track &t;
  const World *w;
  std::vector<float> tab;
};

}  // namespace xbr
