// track.hpp — runtime model of a baked circuit (js/track.js), plus the racing
// line and speed profile solved from it (js/line.js).
//
// The browser keeps some of these arrays as Float32Array and some as plain
// doubles. The port keeps the SAME widths, array by array: a speed profile
// stored in doubles is a slightly different profile, and a chaotic sim turns
// "slightly different" into a different lap. F32 below is that — float storage,
// double arithmetic.
#pragma once
#include <map>
#include <string>
#include <vector>

#include "json.hpp"
#include "physics.hpp"

namespace xbr {

struct F32 {
  std::vector<float> d;
  F32() = default;
  explicit F32(size_t n) : d(n, 0.f) {}
  size_t size() const { return d.size(); }
  double operator[](size_t i) const { return (double)d[i]; }
  void set(size_t i, double v) { d[i] = (float)v; }
};

struct Corner { int n = 0; double s0 = 0, s1 = 0, s = 0, R = 0, dir = 0; std::string name; };
struct DrsZone { double from = 0, to = 0, detect = 0; };

struct Proj {
  int i = 0;
  double s = 0, lat = 0, w = 0, runL = 0, runR = 0, run = 0, bank = 0, curv = 0, hdg = 0;
};

struct Track {
  std::string key, name, full, wall;
  double length = 0, ds = 2;
  bool open = false, stock = false;
  int n = 0;
  std::vector<double> x, y, w, runL, runR, bank;
  F32 hdg, curv;
  std::vector<double> line;          // the baked racing-line offset, when present
  std::vector<Corner> corners;
  std::vector<DrsZone> drs;
  std::vector<std::pair<double, double>> pitPts;
  int sharedWalls = 0;

  static Track fromJson(const Json &d);
  static Track load(const std::string &dataDir, const std::string &key);

  int idx(double s) const {
    const long long r = (long long)jsRound(s / ds);
    return (int)(((r % n) + n) % n);
  }
  double wrap(double s) const { double m = std::fmod(s, length); return std::fmod(m + length, length); }
  double gap(double a, double b) const {
    double d = a - b;
    while (d > length / 2) d -= length;
    while (d < -length / 2) d += length;
    return d;
  }
  // `hint` < 0 means no hint: search the whole lap.
  Proj project(double px, double py, int hint = -1, int win = 45) const;
  void point(double s, double lat, double &ox, double &oy, double &oh, int &oi) const;
  const Corner *cornerAt(double s) const;
  const DrsZone *drsZoneAt(double s) const;

 private:
  void shareWalls();
};

// ---- js/line.js -------------------------------------------------------------
struct Line {
  F32 off, cur, v, pts, hdg;
  double lapTime = 0;
  mutable double vTop = 0;           // cached max of v, filled on first use
};

struct Lines {
  Line race, centre;
  // A slower driver is not a fast driver with the speed turned down: the
  // profile is re-solved at their grip. Cached per (line, grip to 3 places).
  const Line &at(const std::string &which, double grip);

  const Track *track = nullptr;
  const Spec *spec = nullptr;
  double mu = 0;
  std::map<std::string, Line> cache;
};

F32 racingLine(const Track &track, double margin = 0.35, int iters = 6000);
F32 lineCurvature(const Track &track, const F32 &off);
F32 speedProfile(const Track &track, const F32 &cur, const Spec &spec, double mu);
Line buildLine(const Track &track, const Spec &spec, double mu, double margin = 0.35);
Lines buildLines(const Track &track, const Spec &spec);

}  // namespace xbr
