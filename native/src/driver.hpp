// driver.hpp — the people at the wheel. The autopilot (js/autopilot.js) and
// the driver's-hands input model (js/input.js), without the devices: whoever
// owns a keyboard or a wheel fills HandsIn and calls Hands::update.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "physics.hpp"
#include "track.hpp"

namespace xbr {

// Usable steering lock falls off with speed (js/input.js steerLock).
double steerLock(double speed);

// ---- js/input.js: RATES and the keyboard hands --------------------------------
struct HandsIn {
  bool left = false, right = false, throttle = false, brake = false;
  // An analogue device, when one is live: it IS a wheel position, so the
  // wind-on below is bypassed entirely.
  bool analog = false;
  double aSteer = 0, aThrottle = 0, aBrake = 0;
};
struct Hands {
  double wheel = 0, throttle = 0, brake = 0;
  int windWant = 0;
  double windT = 0;
  int selector = 1;
  bool usingPad = false;
  void update(double dt, const HandsIn &in);
};

// ---- js/autopilot.js -----------------------------------------------------------
struct Tier {
  const char *key, *name, *line;
  double gripFrac, spread, consistency, aggression, defence, mistakes, place;
};
const Tier *tierFor(const std::string &key);          // unknown -> medium
const std::vector<Tier> &allTiers();

struct Mulberry {
  int32_t a;
  explicit Mulberry(double seed = 0) : a((int32_t)(uint32_t)(int64_t)seed) {}
  double operator()();
};

struct Driver {
  std::string tier;
  const Tier *T = nullptr;
  double gripFrac = 0, aggression = 0, defence = 0, consistency = 0, place = 0, tyreCare = 0;
  std::vector<float> corner;
  Mulberry rng;
  double noise = 0, noiseT = 0;
  int mistakeKind = 0;                    // 0 none, 1 lock, 2 wide, 3 snap
  double mistakeT = 0, nextMistake = 0;
  double ceiling = 0, grip = 0;
  double gripOverride = NaN, gripNow = NaN, errScale = NaN;
  std::string lineKind;                   // empty = the tier's own line
  // How they drive in traffic (js/drivers.js STYLE); random unless the driver
  // table names this person. Its own stream, so it moves no other draw.
  struct Style { double launch = 0.27, space = 0, side = 0.5; } style;
  // set by the race layer / the driver table; NaN = not set
  double moveGap = NaN, lungeMax = NaN, paceMul = NaN;
  const struct DriverProfile *profile = nullptr;
  const struct Team *team = nullptr;
};
Driver makeDriver(double seed, const std::string &tierKey = "medium", int nCorners = 24);

// Racecraft, decided by whoever knows the running order. All optional.
struct DriveCtx {
  double offBias = 0, pressure = 0, lunge = 0;
  double hold = NaN, speedCap = NaN, obstV = NaN, obstDs = 0;
};
struct DriveInfo { double need = 0, err = 0, cross = 0, budget = 1; int mistake = 0; };

class Autopilot {
 public:
  Autopilot(const Track &track, Lines &lines, const Spec &spec, double peak, Driver *driver);
  DriveInfo drive(Car &car, const Proj &proj, double dt, const DriveCtx *ctx = nullptr);
  const Line &line() const { return *line_; }
  Driver &driver() { return *d; }

 private:
  const Line &lineAt(const std::string &kind, double g);
  const Track &track;
  Lines &lines;
  const Spec &spec;
  double peak;
  Driver *d;
  const Line *line_ = nullptr;
  std::string lineKind_;
  double lineGrip_ = 0;
  double acc = 1e9, want = 0, thr = 0, brk = 0;
  bool braking = false;
  DriveInfo info;
  // cfg
  double hz = 120, kCross = 3.2, kYaw = 0.030, kCounter = 0.40, rackRate = 6.0;
};

}  // namespace xbr
