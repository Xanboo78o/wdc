// physics.hpp — the simulation, native. A line-for-line port of js/physics.js
// and the parts of js/aero.js it needs.
//
// THE LAW CAME ACROSS WITH IT: nothing in the sim core includes a renderer, a
// window or an audio device. tools `xbr-drive` links this and nothing else.
//
// The JS file is the reference. Where it reads oddly here (a one-substep lag,
// a clamp that only applies below 33 m/s) the reason is written there, at
// length, and has been paid for; do not tidy this file against it.
#pragma once
#include <cmath>
#include <limits>
#include <string>
#include <vector>

#include "json.hpp"

namespace xbr {

constexpr double PI = 3.141592653589793;
constexpr double FIXED_DT = 1.0 / 400;
constexpr double AERO_REF_RIDE = 0.030;
constexpr double NaN = std::numeric_limits<double>::quiet_NaN();

// JS semantics the port has to keep: Math.sign(0) is 0, and Math.round rounds
// halves UP (toward +infinity), not away from zero.
inline double sign(double v) { return v > 0 ? 1.0 : v < 0 ? -1.0 : 0.0; }
inline double jsRound(double v) { return std::floor(v + 0.5); }
inline double clampd(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

struct Spec {
  std::string key, name, full;
  bool gt = false;              // shape: 'gt' — a closed car
  bool pro = false;             // a rival's car (proSpec): not in the JS
  double m, Izz, L, a, b, bodyL, bodyW, h;
  double ClA, CdA, rho, aeroBal;
  double Pmax, Fdrive, Fbrake, brakeBal, rollRes;
  double Iyy, Ixx, trackF, trackR, rollDist, ClFloor;
  double B, C, E, mu, wear, Topt, Twin, loadSens;
  bool drs = false;
  double drsCl = 1, drsCd = 1;
  // derived once, cached on the spec exactly as the JS caches them
  double heaveK = 0, rideFree = 0, vRef = 0, pk = 0;
};

Spec &carSpec(const std::string &key);        // "f4" | "f1" | "gt3" (unknown -> f4)
bool hasCarSpec(const std::string &key);
// RACING REALISM (not in the JS). realTune(): once, the GT classes are brought to
// the lap times their real cars set (fitted on nine circuits; numbers in physics.cpp).
// proSpec(): the car a RIVAL drives in a real race — the same class with the tyre and
// the power its driving model needs to lap where a real professional does. The model
// leaves 7% of an ideal lap on the table; the car gives it back. Other classes: carSpec.
void realTune();
Spec &proSpec(const std::string &key);
// SOME CARS ARE BETTER THAN OTHERS (Adam: "by like a curve, not tooo too much but just enough
// where cornering is most of how u get past a faster car"). A rival's car comes in five levels,
// 0 the best, 2 the ordinary one (proSpec itself). What differs is the ENGINE — 4.5% more power
// at the top, 3% less at the bottom, about 4 km/h either way at the end of a straight — and
// nothing in the corners. So a better car is one you cannot out-drag, and can out-corner.
Spec &proSpecAt(const std::string &key, int level);
constexpr double CAR_POWER[5] = {1.045, 1.02, 1.0, 0.985, 0.97};

namespace SURFACE {
constexpr double track = 1.0, kerb = 0.93, runoff = 0.58, grass = 0.42;
}
double dragFor(double surf);

void setWetness(double w);
double wetGrip();

double peakSlip(const Spec &S);
double topSpeed(const Spec &S, bool drs = false);
double limitMu(const Spec &S);
double corneringSpeed(const Spec &S, double R, double mu, double bank = 0);
double tyreGrip(const Spec &S, double T, double wear);

// ---- the wake (js/aero.js) --------------------------------------------------
inline double dirtyFront(double d) { return 1 - 0.52 * d; }
inline double dirtyRear(double d) { return 1 - 0.16 * d; }
inline double towDrag(double t) { return 1 - 0.44 * t; }

struct Car;
struct AeroOut { double clA = 0, cdA = 0, bal = 0; };

// The solved aero map, data/aero/<car>.json: trilinear over pitch x yaw x ride.
struct AeroMap {
  std::vector<double> pitch, yaw, ride;
  struct Variant { std::vector<double> cl, cd, cop; bool ok = false; };
  Variant full, noFront, noRear;
  static AeroMap fromJson(const Json &j);
  void coeffs(AeroOut &out, Car &car, double pitchDeg, double yawDeg, double rideH) const;
  double lookup(const std::vector<double> &arr, double p, double y, double r) const;
};
void registerAero(const std::string &key, const AeroMap *map);
const AeroMap *getAero(const std::string &key);

struct AxleTyre { double Tf = 60, Tr = 60, wf = 0, wr = 0, age = 0; };
struct CornerTyre {
  double p0 = 0, air = 0, p = 0, Tc = 60, Ts = 60, wear = 0, dmg = 0, leak = 0;
  bool flat = false;
  double hitAt = -9;
};
struct Dent { double lx, ly, nx, ny, depth, r; double seen = 0; };   // seen: the depth parts.cpp has accounted for

// js/parts.js — the car as the components it is built from, each with its own
// health. Driven by car.crush and car.dents; read by the aero map.
constexpr int N_PARTS = 32;
struct Parts {
  bool exists = false;
  float h[N_PARTS], hx[N_PARTS], hz[N_PARTS];
  unsigned char gone[N_PARTS];
  double c[4] = {0, 0, 0, 0};
  bool lf = false, lr = false;
  int ver = 0;
  bool dmg = false, show = false, hanging = false;
  double cl = 1, bal = 1, cd = 1;
};
struct Aids { double tc = 0.60, abs = 0.60, sc = 0.35; };
// js/xingus.js car.xg — the arcade handling's own state. `on` false = the JS's
// `car.xg` undefined: the serious game, and nothing reads the rest.
struct Xg {
  bool on = false;
  double dir = 0, flick = 0, calm = 0, lock = 0.25, beta = 0;
  int state = 0;                           // 0 grip, 1 drift, 2 out
  double vHold = 0, loose = 0.84;
  bool stakes = false;
  double bank = 0;
  double vPrev = NaN, r = NaN;             // NaN = null
  double gCap = 0;                         // 0 = not set (an oval's stock rules set it)
};

struct Env {
  double surface = 1;
  double bank = 0, bankDir = 0;
  double slope = 0;
  double rollMul = 1;
  double dirty = NaN, tow = NaN;   // NaN = not given: fall back to the car's own
};

struct Car {
  Spec *spec = nullptr;
  double x = 0, y = 0, hdg = 0;
  double vx = 0.001, vy = 0, r = 0;       // body frame: vx forward, vy left, r yaw rate
  double ax = 0, ay = 0;
  double delta = 0, throttle = 0, brake = 0;
  int selector = 1;                        // 1 drive, 0 neutral, -1 reverse
  AxleTyre tyre;
  CornerTyre tyres[4];
  bool hasTyres = true;
  bool wheelLost[4] = {false, false, false, false};
  bool drsOpen = false;
  double dirty = 0, tow = 0;
  Aids aids;
  double tcCut = 1, absCut = 1;
  double surface = 1, damage = 0;
  const AeroMap *aero = nullptr;           // null = fall back to the constants
  AeroOut aeroOut;
  // ---- the vertical axis: all zero while the car is driving
  double z = 0, vz = 0;
  double ride = AERO_REF_RIDE;
  double pitch = 0, roll = 0, pRate = 0, rRate = 0;
  bool airborne = false, onRoof = false, inContact = false;
  double airTime = 0, landV = 0, landHarm = 0;
  double wheelZ[4] = {0, 0, 0, 0};
  double gripF = 1, gripR = 1;
  std::vector<Dent> dents;
  bool hasLost = false, lostFrontWing = false, lostRearWing = false;
  bool hasCrush = false;
  double crushFront = 0, crushRear = 0, crushLeft = 0, crushRight = 0;
  double speed = 0, slipF = 0, slipR = 0;
  bool lock = false, wheelspin = false;
  double gLat = 0, gLong = 0;
  double Fxp = 0, Fyp = 0;                 // last substep's real forces
  double steerEff = 0;
  double muF = NaN, muR = NaN;             // NaN until the first step, as `undefined` in JS
  double Fyf = 0, Fzf = 0;
  double tyreAge = 0;
  bool wallTouch = false;
  // a hurt corner (cornerMods)
  bool hasSag = false;
  double sag[4] = {0, 0, 0, 0};
  double cmKD[4] = {1, 1, 1, 1}, cmKB[4] = {1, 1, 1, 1}, cmDrag[4] = {0, 0, 0, 0}, cmOn[4] = {1, 1, 1, 1};
  Parts parts;
  Xg xg;

  double *crushPart(const char *part);
};

Car makeCar(const std::string &cls = "f4");
void makeTyres(Car &car, double T0 = 60);
double hotPressure(const CornerTyre &ty);
void wheelPos(const Spec &S, double W[4][2]);
void launch(Car &car, double jz, double lx = 0, double ly = 0);
// Returns the wheel index hit, or -1 when the blow was too light to matter.
int tyreHit(Car &car, double lx, double ly, double nby, double dv);
// A WHEEL TEARS OFF (the native game only; Adam 2026-10-10: "we shoudlve already had this"). The parts model
// (parts.cpp) can only take a wheel when the crush around it adds up to more than a crush can be, which measured
// as never: not at 300 km/h, square into the wall. So tyreHit, which already knows which wheel a blow reached and
// how much of it was sideways, also breaks the corner when that is enough: from 6 m/s (certain by 13) on an open
// wheel, 10 to 18 on one inside a wheel arch. OFF until the game turns it on: the harnesses still match the JS.
bool &wheelsTear();
// A pit stop fits four wheels, to whatever is left of the corners they go on.
void refitWheels(Car &car);
void step(Car &car, double dt, const Env &env = Env{});
// Bring car.parts up to date with the car's damage. Null for an untouched car.
Parts *syncParts(Car &car);
const char *partName(int i);

}  // namespace xbr
