// physics.cpp — see physics.hpp. Ported from js/physics.js + js/aero.js; the
// comments that explain WHY each term is the way it is live in the JS file and
// are not repeated here. Section headings match so the two read side by side.
#include "physics.hpp"

#include <algorithm>
#include <cstring>
#include <map>

namespace xbr {

// ---------------------------------------------------------------------------
// Car specs
// ---------------------------------------------------------------------------
static std::map<std::string, Spec> &specs() {
  static std::map<std::string, Spec> M = [] {
    std::map<std::string, Spec> m;
    Spec f4;
    f4.key = "f4"; f4.name = "F4"; f4.full = "Formula 4";
    f4.m = 570; f4.Izz = 520;
    f4.L = 2.75; f4.a = 1.51; f4.b = 1.24;
    f4.bodyL = 4.60; f4.bodyW = 1.75;
    f4.h = 0.28;
    f4.ClA = 1.35; f4.CdA = 0.92; f4.rho = 1.225;
    f4.aeroBal = 0.42;
    f4.Pmax = 125e3; f4.Fdrive = 6200;
    f4.Fbrake = 24000; f4.brakeBal = 0.62;
    f4.rollRes = 180;
    f4.Iyy = 480; f4.Ixx = 110;
    f4.trackF = 1.45; f4.trackR = 1.40;
    f4.rollDist = 0.52;
    f4.ClFloor = 3.0;
    f4.B = 10.0; f4.C = 1.75; f4.E = 0.72;
    f4.mu = 1.55; f4.wear = 1.0; f4.Topt = 82; f4.Twin = 34;
    f4.loadSens = 0.18;
    f4.drs = false;
    m["f4"] = f4;

    Spec f1;
    f1.key = "f1"; f1.name = "F1"; f1.full = "Formula 1";
    f1.m = 798; f1.Izz = 950;
    f1.L = 3.60; f1.a = 1.98; f1.b = 1.62;
    f1.bodyL = 5.63; f1.bodyW = 2.00;
    f1.h = 0.30;
    f1.ClA = 4.62; f1.CdA = 1.28; f1.rho = 1.225;
    f1.aeroBal = 0.435;
    f1.Pmax = 580e3; f1.Fdrive = 13800;
    f1.Fbrake = 46000; f1.brakeBal = 0.60;
    f1.rollRes = 260;
    f1.Iyy = 900; f1.Ixx = 165;
    f1.trackF = 1.60; f1.trackR = 1.40;
    f1.rollDist = 0.52;
    f1.ClFloor = 7.0;
    f1.B = 12.5; f1.C = 1.80; f1.E = 0.70;
    f1.mu = 1.91; f1.wear = 1.0; f1.Topt = 92; f1.Twin = 33;
    f1.loadSens = 0.18;
    f1.drs = true; f1.drsCl = 0.80; f1.drsCd = 0.74;
    m["f1"] = f1;

    Spec gt;
    gt.key = "gt3"; gt.name = "GT3"; gt.full = "GT3";
    gt.gt = true;
    gt.m = 1300; gt.Izz = 1900;
    gt.L = 2.65; gt.a = 1.46; gt.b = 1.19;
    gt.bodyL = 4.60; gt.bodyW = 2.05;
    gt.h = 0.45;
    gt.ClA = 2.90; gt.CdA = 1.45; gt.rho = 1.225;
    gt.aeroBal = 0.40;
    gt.Pmax = 410e3; gt.Fdrive = 11000;
    gt.Fbrake = 26000; gt.brakeBal = 0.62;
    gt.rollRes = 320;
    gt.Iyy = 1900; gt.Ixx = 550;
    gt.trackF = 1.68; gt.trackR = 1.66;
    gt.rollDist = 0.52;
    gt.ClFloor = 2.2;
    gt.B = 11.0; gt.C = 1.68; gt.E = 0.76;
    gt.mu = 1.82; gt.wear = 1.0; gt.Topt = 85; gt.Twin = 32;
    gt.loadSens = 0.20;
    gt.drs = false;
    m["gt3"] = gt;

    // MULTICLASS (not in the JS): the two classes that share a road with the GT3.
    // Each is the GT3 with the handful of numbers that make its class what it is.
    // GT4: a road car with a cage. Heavier, a third less power, a wing for show.
    Spec g4 = gt;
    g4.key = "gt4"; g4.name = "GT4"; g4.full = "GT4";
    g4.m = 1420; g4.Izz = 2080; g4.Iyy = 2080; g4.Ixx = 600;
    g4.h = 0.48;
    g4.ClA = 1.25; g4.CdA = 1.22; g4.ClFloor = 0.9;
    g4.Pmax = 330e3; g4.Fdrive = 9500;
    g4.Fbrake = 23500;
    g4.mu = 1.76;
    g4.aeroBal = 0.34; g4.brakeBal = 0.65;      // what little wing it has is at the back: measured, it stops the slow drivers spinning
    m["gt4"] = g4;
    // HYPERCAR: a prototype. A quarter-tonne lighter, more power, and a floor
    // that does the work — it is in another race, on the same road.
    Spec hy = gt;
    hy.key = "hyper"; hy.name = "HYPER"; hy.full = "HYPERCAR";
    hy.m = 1060; hy.Izz = 1560; hy.Iyy = 1560; hy.Ixx = 430;
    hy.L = 3.00; hy.a = 1.62; hy.b = 1.38;
    hy.bodyL = 4.75; hy.bodyW = 2.00;
    hy.h = 0.36;
    hy.ClA = 4.30; hy.CdA = 1.14; hy.ClFloor = 3.4;
    hy.aeroBal = 0.44;
    hy.Pmax = 500e3; hy.Fdrive = 13000;
    hy.Fbrake = 30000; hy.brakeBal = 0.60;
    hy.mu = 1.88;
    m["hyper"] = hy;
    return m;
  }();
  return M;
}

bool hasCarSpec(const std::string &key) { return specs().count(key) > 0; }
Spec &carSpec(const std::string &key) {
  auto &M = specs();
  auto it = M.find(key);
  return it != M.end() ? it->second : M["f4"];
}

double dragFor(double surf) {
  if (surf == 1.0) return 1;
  if (surf == 0.93) return 1.4;
  if (surf == 0.58) return 9;
  if (surf == 0.42) return 5;
  return 1;
}

static double WETNESS = 0;
void setWetness(double w) { WETNESS = std::isnan(w) ? 0 : clampd(w, 0, 1); }
double wetGrip() { return 1 - 0.22 * WETNESS; }
static const double AMBIENT = 30;

double peakSlip(const Spec &spec) {
  const double target = std::tan(PI / (2 * spec.C));
  double lo = 0, hi = 1.0;
  for (int i = 0; i < 60; i++) {
    const double x = (lo + hi) / 2, bx = spec.B * x;
    const double f = bx - spec.E * (bx - std::atan(bx));
    if (f < target) lo = x; else hi = x;
  }
  return (lo + hi) / 2;
}

double topSpeed(const Spec &spec, bool drs) {
  const double cdA = spec.CdA * (drs && spec.drs ? spec.drsCd : 1);
  double lo = 10, hi = 160;
  for (int i = 0; i < 80; i++) {
    const double mid = (lo + hi) / 2;
    const double p = (0.5 * spec.rho * cdA * mid * mid + spec.rollRes) * mid;
    if (p > spec.Pmax) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

double limitMu(const Spec &spec) {
  const double bf = spec.b / spec.L, br = spec.a / spec.L;
  const double rd = spec.rollDist, ls = spec.loadSens;
  double n = spec.mu;
  for (int i = 0; i < 24; i++) {
    const double sF = std::min(1.0, 2 * rd * n * spec.h / (bf * spec.trackF));
    const double sR = std::min(1.0, 2 * (1 - rd) * n * spec.h / (br * spec.trackR));
    n = spec.mu * ((1 - ls * sF * sF) * bf + (1 - ls * sR * sR) * br);
  }
  return n;
}

double corneringSpeed(const Spec &spec, double R, double mu, double bank) {
  R = std::fabs(R);
  const double m = bank != 0 ? mu * (1 + 0.90 * std::sin(std::fabs(bank) * PI / 180)) : mu;
  const double k = spec.m / R - m * 0.5 * spec.rho * spec.ClA;
  const double vGrip = k <= 1e-3 ? std::numeric_limits<double>::infinity() : std::sqrt(m * spec.m * 9.81 / k);
  return std::min(vGrip, topSpeed(spec));
}

double tyreGrip(const Spec &spec, double T, double wear) {
  const double u = (T - spec.Topt) / spec.Twin;
  const double win = std::exp(-(u * u));
  const double temp = 0.82 + 0.18 * win;
  const double w = 1 - 0.24 * std::pow(wear, 1.25);
  return spec.mu * temp * w;
}

// ---------------------------------------------------------------------------
// THE MAP (js/aero.js makeAero)
// ---------------------------------------------------------------------------
static std::map<std::string, const AeroMap *> &aeroReg() {
  static std::map<std::string, const AeroMap *> M;
  return M;
}
void registerAero(const std::string &key, const AeroMap *map) { aeroReg()[key] = map; }
const AeroMap *getAero(const std::string &key) {
  auto it = aeroReg().find(key);
  return it == aeroReg().end() ? nullptr : it->second;
}

AeroMap AeroMap::fromJson(const Json &j) {
  AeroMap m;
  m.pitch = j["pitch"].nums();
  m.yaw = j["yaw"].nums();
  m.ride = j["ride"].nums();
  auto var = [&](const char *k) {
    Variant v;
    const Json &s = j["map"][k];
    if (s.isObj()) { v.cl = s["cl"].nums(); v.cd = s["cd"].nums(); v.cop = s["cop"].nums(); v.ok = !v.cl.empty(); }
    return v;
  };
  m.full = var("full");
  m.noFront = var("noFrontWing");
  m.noRear = var("noRearWing");
  return m;
}

static void lerpIdx(const std::vector<double> &axis, double v, int &i0, int &i1, double &f) {
  const int n = (int)axis.size();
  if (v <= axis[0]) { i0 = 0; i1 = 0; f = 0; return; }
  if (v >= axis[n - 1]) { i0 = n - 1; i1 = n - 1; f = 0; return; }
  int i = 0;
  while (i + 1 < n && axis[i + 1] < v) i++;
  const double span = axis[i + 1] - axis[i];
  i0 = i; i1 = i + 1; f = span > 0 ? (v - axis[i]) / span : 0;
}

double AeroMap::lookup(const std::vector<double> &arr, double p, double y, double r) const {
  const int NY = (int)yaw.size(), NR = (int)ride.size();
  auto at = [&](int pi, int yi, int ri) { return arr[(pi * NY + yi) * NR + ri]; };
  int p0, p1, y0, y1, r0, r1;
  double pf, yf, rf;
  lerpIdx(pitch, p, p0, p1, pf);
  lerpIdx(yaw, y, y0, y1, yf);
  lerpIdx(ride, r, r0, r1, rf);
  const double c00 = at(p0, y0, r0) + (at(p0, y0, r1) - at(p0, y0, r0)) * rf;
  const double c01 = at(p0, y1, r0) + (at(p0, y1, r1) - at(p0, y1, r0)) * rf;
  const double c10 = at(p1, y0, r0) + (at(p1, y0, r1) - at(p1, y0, r0)) * rf;
  const double c11 = at(p1, y1, r0) + (at(p1, y1, r1) - at(p1, y1, r0)) * rf;
  const double c0 = c00 + (c01 - c00) * yf;
  const double c1 = c10 + (c11 - c10) * yf;
  return c0 + (c1 - c0) * pf;
}

void AeroMap::coeffs(AeroOut &out, Car &car, double pitchDeg, double yawDeg, double rideH) const {
  const Variant *m = &full;
  if (car.hasLost && car.lostFrontWing && noFront.ok) m = &noFront;
  else if (car.hasLost && car.lostRearWing && !car.lostFrontWing && noRear.ok) m = &noRear;

  double clA = lookup(m->cl, pitchDeg, yawDeg, rideH);
  double cdA = lookup(m->cd, pitchDeg, yawDeg, rideH);
  const double cop = lookup(m->cop, pitchDeg, yawDeg, rideH);

  if (!car.dents.empty()) {
    double harm = 0;
    for (const auto &d : car.dents) harm += d.depth;
    harm = harm > 2.2 ? 2.2 : harm;
    clA *= 1 - 0.13 * harm;
    cdA *= 1 + 0.16 * harm;
  }
  // PER-COMPONENT LOSS (parts.cpp). A whole wing is the variant above and is
  // not counted twice. Undamaged: one null test, nothing multiplied.
  const Parts *P = car.hasCrush ? syncParts(car) : (car.parts.exists ? &car.parts : nullptr);
  const bool pd = P && P->dmg;
  if (pd) { clA *= P->cl; cdA *= P->cd; }

  out.clA = clA;
  out.cdA = cdA;
  const Spec &S = *car.spec;
  const double bal = (0.5 + cop / (S.a + S.b)) * (pd ? P->bal : 1);
  out.bal = bal < 0.12 ? 0.12 : bal > 0.88 ? 0.88 : bal;
}

// ---------------------------------------------------------------------------
// RIDE HEIGHT
// ---------------------------------------------------------------------------
static const double GRAV = 9.81;
static const double AERO_SQUAT = 0.025, RIDE_MIN = 0.004, RIDE_TAU = 0.05;

static void heaveOf(Spec &S) {
  if (S.heaveK != 0) return;
  const double vRef = topSpeed(S) * 0.93;
  const double dfRef = 0.5 * S.rho * vRef * vRef * S.ClA;
  S.heaveK = dfRef / AERO_SQUAT;
  S.rideFree = AERO_REF_RIDE + (S.m * GRAV + dfRef) / S.heaveK;
  S.vRef = vRef;
}

// ---------------------------------------------------------------------------
// THE VERTICAL AXIS
// ---------------------------------------------------------------------------
static double groundEffect(double z) { return z <= 0 ? 1 : std::exp(-z / 0.22); }
static const double WING_SHARE = 0.45;      // how much of a car's downforce its wings make, rather than its floor
static const double DIFFUSER_RAKE = 0.26, FLOOR_STALL = 0.09;
static const double SPRING = 160e3, DAMP = 4500, TRAVEL = 0.055, BUMPSTOP = 6e6, FMAX = 2.2e5, RATE_MAX = 11;
static const double SUSP_TAU = 0.055;
static const double SAG_FLAT = 0.045, SAG_LOST = 0.15;

static double wrapPi(double a) {
  while (a > PI) a -= 2 * PI;
  while (a < -PI) a += 2 * PI;
  return a;
}

void wheelPos(const Spec &S, double W[4][2]) {
  const double hf = S.trackF * 0.5, hr = S.trackR * 0.5;
  W[0][0] = S.a; W[0][1] = hf;
  W[1][0] = S.a; W[1][1] = -hf;
  W[2][0] = -S.b; W[2][1] = hr;
  W[3][0] = -S.b; W[3][1] = -hr;
}

double *Car::crushPart(const char *part) {
  if (!std::strcmp(part, "front")) return &crushFront;
  if (!std::strcmp(part, "rear")) return &crushRear;
  if (!std::strcmp(part, "left")) return &crushLeft;
  return &crushRight;
}

struct AirV { double Fz, cop, lift, restore; };

static AirV aeroVertical(const Car &car, double q, double v) {
  const Spec &S = *car.spec;
  const double vh = std::max(v, 0.001);
  const double fwd = vh > 1 ? car.vx / vh : 1;
  // in the air the wings still fly (js/physics.js aeroVertical)
  const double wings = WING_SHARE * std::max(0.0, std::cos(car.pitch) * std::cos(car.roll));
  const double down = -q * S.ClA * std::max(0.0, fwd) * (car.z <= 0 ? 1 : wings + (1 - WING_SHARE) * groundEffect(car.z));

  const double climb = std::atan2(car.vz, std::max(vh, 1.0));
  double alpha = car.pitch - climb;
  if (fwd < 0) alpha = DIFFUSER_RAKE * -fwd - alpha;
  alpha = clampd(alpha, -0.9, 0.9);
  const double excess = std::fabs(alpha) - FLOOR_STALL;
  const double upright = std::cos(car.roll) * std::cos(car.pitch);
  const double lift = excess <= 0 ? 0
    : sign(alpha) * q * S.ClFloor * std::sin(2 * std::min(0.9, excess)) * upright;
  const double cop = fwd >= 0 ? S.a * 0.62 : -S.b * 0.72;
  const double restore = -q * S.ClA * 2.6 * std::sin(car.pitch) * std::max(0.0, fwd);
  return {down + lift, cop, lift, restore};
}

static void vertical(Car &car, double dt, double q, double v) {
  const Spec &S = *car.spec;
  const AirV air = aeroVertical(car, q, v);

  if (!car.airborne) {
    car.gripF = car.gripR = 1;
    if (air.Fz <= S.m * GRAV || v < 8) return;
    car.airborne = true; car.airTime = 0; car.vz = 0;
  }

  car.airTime += dt;

  // ---- free body
  car.vz += (air.Fz / S.m - GRAV) * dt;
  car.z += car.vz * dt;
  car.pRate += ((air.lift * air.cop + air.restore - car.pRate * q * 0.30) / S.Iyy) * dt;
  car.rRate += ((-car.rRate * q * 0.05) / S.Ixx) * dt;
  car.pitch = wrapPi(car.pitch + car.pRate * dt);
  car.roll = wrapPi(car.roll + car.rRate * dt);

  // ---- what is touching the road?
  const bool inverted = std::fabs(car.roll) > PI / 2 || std::fabs(car.pitch) > PI / 2;
  if (inverted) {
    car.onRoof = true;
    car.gripF = car.gripR = 0;
    const double ride = S.h * 0.9;
    if (car.z < ride) {
      car.z = ride;
      if (car.vz < 0) car.vz *= -0.05;
      const double sp = std::hypot(car.vx, car.vy);
      if (sp > 0.05) {
        const double k = std::max(0.0, 1 - 0.62 * GRAV * dt / sp);
        car.vx *= k; car.vy *= k;
      }
      car.r *= 1 - std::min(0.9, 3 * dt);
      car.pRate *= 1 - std::min(0.9, 4 * dt);
      car.rRate *= 1 - std::min(0.9, 4 * dt);
    }
    return;
  }
  car.onRoof = false;

  double W[4][2];
  wheelPos(S, W);
  const double sp = std::sin(car.pitch), sr = std::sin(car.roll);
  int downF = 0, downR = 0, nDown = 0;
  for (int i = 0; i < 4; i++) {
    const double h = car.z + W[i][0] * sp + W[i][1] * sr + (car.wheelLost[i] ? SAG_LOST : 0);
    car.wheelZ[i] = h;
    if (h < 1e-3) {
      nDown++;
      if (i < 2) downF++; else downR++;
    }
  }

  if (!nDown) car.inContact = false;

  if (nDown) {
    // SPRINGS, NOT IMPULSES.
    double Fz = 0, Mp = 0, Mr = 0, peak = 0, deepest = 0;
    int hardIdx = 0;
    for (int i = 0; i < 4; i++) {
      const double h = car.wheelZ[i];
      if (h >= 0) continue;
      if (-h > deepest) deepest = -h;
      const double lx = W[i][0], ly = W[i][1];
      const double vp = car.vz + lx * car.pRate + ly * car.rRate;
      double f = -h * SPRING - vp * DAMP;
      if (-h > TRAVEL && vp < 0) f += (-h - TRAVEL) * BUMPSTOP;
      if (f <= 0) continue;
      f = std::min(f, FMAX);
      Fz += f; Mp += f * lx; Mr += f * ly;
      if (f > peak) { peak = f; hardIdx = i; }
    }

    Mp += S.m * GRAV * S.h * std::sin(car.pitch);
    Mr += S.m * GRAV * S.h * std::sin(car.roll);

    car.vz += (Fz / S.m) * dt;
    car.pRate += (Mp / S.Iyy) * dt;
    car.rRate += (Mr / S.Ixx) * dt;
    car.pRate = clampd(car.pRate, -RATE_MAX, RATE_MAX);
    car.rRate = clampd(car.rRate, -RATE_MAX, RATE_MAX);
    if (deepest > 0.30) car.z += deepest - 0.30;

    // LANDING DAMAGE, charged once per landing.
    if (!car.inContact) {
      car.inContact = true;
      double worst = 0;
      for (int i = 0; i < 4; i++) {
        if (car.wheelZ[i] >= 0) continue;
        const double vp = car.vz + W[i][0] * car.pRate + W[i][1] * car.rRate;
        if (vp < worst) worst = vp;
      }
      car.landV = -worst;
      if (car.landV > 5) {
        const double harm = std::min(1.0, std::pow((car.landV - 5) / 10, 1.5));
        car.damage = std::min(1.0, car.damage + harm);
        car.hasCrush = true;
        double *part = hardIdx < 2 ? &car.crushFront : &car.crushRear;
        *part = std::min(1.0, *part + harm * 1.2);
        car.landHarm = harm;
      }
    }

    // Back to sleep.
    const bool resting = air.Fz < S.m * GRAV;
    if (resting && nDown == 4 && car.z < 0.02
        && std::fabs(car.vz) < 0.30 && std::fabs(car.pRate) < 0.30 && std::fabs(car.rRate) < 0.30
        && std::fabs(car.pitch) < 0.03 && std::fabs(car.roll) < 0.03) {
      car.airborne = false; car.onRoof = false;
      car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
      car.wheelZ[0] = car.wheelZ[1] = car.wheelZ[2] = car.wheelZ[3] = 0;
      car.gripF = car.gripR = 1;
      return;
    }
  }

  car.gripF = downF / 2.0;
  car.gripR = downR / 2.0;
}

void launch(Car &car, double jz, double lx, double ly) {
  const Spec &S = *car.spec;
  car.airborne = true;
  car.vz += jz / S.m;
  car.pRate += (jz * lx) / S.Iyy;
  car.rRate += (jz * ly) / S.Ixx;
  if (car.z < 0.001) car.z = 0.001;
}

static const double REV_MAX = 7, REV_FORCE = 0.18;

// ---------------------------------------------------------------------------
// FOUR TYRES
// ---------------------------------------------------------------------------
static const double T_SET = 60, P_ATM = 1.013, HEALTHY = 0.88;

void makeTyres(Car &car, double T0) {
  const std::string &k = car.spec->key;
  double setF = 1.5, setR = 1.4;
  if (k == "f1") { setF = 1.62; setR = 1.45; }
  else if (k == "f4") { setF = 1.30; setR = 1.20; }
  else if (k == "gt3") { setF = 1.40; setR = 1.40; }
  for (int i = 0; i < 4; i++) {
    CornerTyre t;
    t.p0 = i < 2 ? setF : setR;
    t.air = t.p0; t.p = t.p0; t.Tc = T0; t.Ts = T0;
    car.tyres[i] = t;
  }
  car.hasTyres = true;
}

double hotPressure(const CornerTyre &ty) {
  return std::max(0.0, (ty.air + P_ATM) * (ty.Tc + 273.15) / (T_SET + 273.15) - P_ATM);
}

Car makeCar(const std::string &cls) {
  Car car;
  car.spec = &carSpec(cls);
  makeTyres(car);
  car.aero = getAero(car.spec->key);
  return car;
}

// True when a corner is hurt; fills car.cm* and car.sag.
static bool cornerMods(Car &car) {
  const bool *wl = car.wheelLost;
  bool hurt = wl[0] || wl[1] || wl[2] || wl[3];
  if (!hurt && car.hasTyres) {
    for (int i = 0; i < 4; i++)
      if (car.tyres[i].air < car.tyres[i].p0 * HEALTHY || car.tyres[i].dmg > 0.02) { hurt = true; break; }
  }
  if (!hurt) { car.hasSag = false; return false; }
  car.hasSag = true;
  for (int i = 0; i < 4; i++) {
    if (wl[i]) {
      car.cmKD[i] = 0; car.cmKB[i] = 0; car.cmDrag[i] = 0; car.cmOn[i] = 0; car.sag[i] = -SAG_LOST;
      continue;
    }
    double kD = 1, kB = 1, drag = 0, s = 0;
    if (car.hasTyres) {
      const CornerTyre &q = car.tyres[i];
      const double x = clampd((q.p0 * HEALTHY - q.air) / (q.p0 * HEALTHY), 0, 1);
      if (x > 0) {
        kB = 1 - 0.75 * x;
        kD = 1 - 0.70 * std::pow(x, 1.2);
        drag = 0.15 * x * x;
        s = -SAG_FLAT * x;
      }
      if (q.dmg > 0.02) { kD *= 1 - 0.18 * q.dmg; kB *= 1 - 0.35 * q.dmg; }
    }
    car.cmKD[i] = kD; car.cmKB[i] = kB; car.cmDrag[i] = drag; car.cmOn[i] = 1; car.sag[i] = s;
  }
  return true;
}

int tyreHit(Car &car, double lx, double ly, double nby, double dv) {
  const Spec &S = *car.spec;
  if (!car.hasTyres) makeTyres(car);
  double W[4][2];
  wheelPos(S, W);
  int wi = 0;
  double bd = std::numeric_limits<double>::infinity();
  for (int i = 0; i < 4; i++) {
    const double d = std::hypot(W[i][0] - lx, W[i][1] - ly);
    if (d < bd) { bd = d; wi = i; }
  }
  CornerTyre &q = car.tyres[wi];
  const double sv = dv * (0.35 + 0.65 * std::min(1.0, std::fabs(nby)));
  if (sv < 0.6) return -1;
  q.dmg = std::min(1.0, q.dmg + std::min(0.6, std::pow((sv - 0.6) / 7, 1.2)));
  const double now = car.tyre.age;
  const bool fresh = now - q.hitAt > 0.30;
  q.hitAt = now;
  if (fresh && !q.flat) {
    const double h = std::sin(car.x * 12.9898 + car.y * 78.233 + dv * 37.719 + wi * 3.1) * 43758.5453;
    const double u = h - std::floor(h);
    const double pFlat = clampd((sv - 2.0) / 8, 0, 0.6);
    const double pSlow = clampd((sv - 0.9) / 5, 0, 0.45);
    if (u < pFlat) q.leak = 4.0;
    else if (u < pFlat + pSlow)
      q.leak = std::max(q.leak, 0.004 + 0.012 * ((u - pFlat) / std::max(1e-6, pSlow)));
  }
  return wi;
}

static double pac(const Spec &spec, double alpha, double D, double B) {
  const double x = B * alpha;
  return -D * std::sin(spec.C * std::atan(x - spec.E * (x - std::atan(x))));
}

static bool clampCircle(double &fx, double &fy, double cap) {
  const double m = std::hypot(fx, fy);
  if (m <= cap || m < 1e-6) return false;
  const double k = cap / m;
  fx *= k; fy *= k;
  return true;
}

// ---------------------------------------------------------------------------
// One physics substep. Call it at FIXED_DT, never with a frame time.
// ---------------------------------------------------------------------------
void step(Car &car, double dt, const Env &env) {
  Spec &S = *car.spec;
  AxleTyre &t = car.tyre;
  const Aids &A = car.aids;
  const double v = std::hypot(car.vx, car.vy);
  const double vSafe = std::max(std::fabs(car.vx), 6.0);
  const double surfType = env.surface;
  car.surface = surfType;
  const double surf = surfType * wetGrip();

  // ---- aero
  const double q = 0.5 * S.rho * v * v;
  double clA, cdA, balF;
  if (car.aero) {
    const double beta = v > 2 ? std::fabs(std::atan2(car.vy, std::fabs(car.vx))) * 180 / PI : 0;
    const double rideH = car.ride + (car.z > 0 ? car.z : 0);
    car.aero->coeffs(car.aeroOut, car, car.pitch * 180 / PI, beta, rideH);
    clA = car.aeroOut.clA; cdA = car.aeroOut.cdA; balF = car.aeroOut.bal;
  } else {
    clA = S.ClA; cdA = S.CdA; balF = S.aeroBal;
    if (car.hasLost) {
      if (car.lostFrontWing) { clA *= 0.72; balF *= 0.44; cdA *= 0.93; }
      if (car.lostRearWing) { clA *= 0.60; balF = std::min(0.88, balF * 2.0); cdA *= 0.88; }
    }
    clA *= groundEffect(car.z);
  }
  if (car.drsOpen && S.drs) { clA *= S.drsCl; cdA *= S.drsCd; }
  const double dirty = !std::isnan(env.dirty) ? env.dirty : car.dirty;
  const double tow = !std::isnan(env.tow) ? env.tow : car.tow;
  const double DFf = q * clA * balF * dirtyFront(dirty);
  const double DFr = q * clA * (1 - balF) * dirtyRear(dirty);

  // ---- the aero squats the car on its own springs
  heaveOf(S);
  if (!car.airborne) {
    const double settle = S.rideFree - (S.m * GRAV + DFf + DFr) / S.heaveK;
    car.ride += (settle - car.ride) * std::min(1.0, dt / RIDE_TAU);
    if (car.ride < RIDE_MIN) car.ride = RIDE_MIN;
  }
  const double broadside = car.airborne
    ? std::fabs(std::sin(car.pitch)) + 0.4 * std::fabs(std::sin(car.roll)) : 0;
  const double drag = q * (cdA * towDrag(tow) + S.ClFloor * 0.55 * broadside)
                    + S.rollRes * env.rollMul;

  // ---- the vertical axis
  vertical(car, dt, q, v);

  // ---- vertical loads: FOUR CORNERS
  const double g = 9.81;
  const double statF = S.m * g * S.b / S.L, statR = S.m * g * S.a / S.L;
  const double trX = car.Fxp * S.h / S.L;
  const double Fyp = car.Fyp;
  const double rollDist = S.rollDist;
  const double trYf = rollDist * Fyp * S.h / S.trackF;
  const double trYr = (1 - rollDist) * Fyp * S.h / S.trackR;

  const double FzFL = std::max(0.0, statF / 2 + DFf / 2 - trX / 2 - trYf);
  const double FzFR = std::max(0.0, statF / 2 + DFf / 2 - trX / 2 + trYf);
  const double FzRL = std::max(0.0, statR / 2 + DFr / 2 + trX / 2 - trYr);
  const double FzRR = std::max(0.0, statR / 2 + DFr / 2 + trX / 2 + trYr);
  const double Fzf = std::max(200.0, FzFL + FzFR);
  const double Fzr = std::max(200.0, FzRL + FzRR);

  const double ls = S.loadSens;
  const double spreadF = (FzFR - FzFL) / Fzf;
  const double spreadR = (FzRR - FzRL) / Fzr;
  const double muF = tyreGrip(S, t.Tf, t.wf) * surf * (1 - ls * spreadF * spreadF);
  const double muR = tyreGrip(S, t.Tr, t.wr) * surf * (1 - ls * spreadR * spreadR);

  // ---- a hurt corner
  const bool cm = cornerMods(car);
  double capAxF = muF * Fzf, capAxR = muR * Fzr, BF = S.B, BR = S.B;
  if (cm) {
    const double nF = std::max(1.0, FzFL + FzFR), nR = std::max(1.0, FzRL + FzRR);
    capAxF *= (FzFL * car.cmKD[0] + FzFR * car.cmKD[1]) / nF;
    capAxR *= (FzRL * car.cmKD[2] + FzRR * car.cmKD[3]) / nR;
    BF = S.B * std::max(0.05, (FzFL * car.cmKB[0] + FzFR * car.cmKB[1]) / nF);
    BR = S.B * std::max(0.05, (FzRL * car.cmKB[2] + FzRR * car.cmKB[3]) / nR);
  }

  // ---- and now the suspension actually moves
  if (!car.airborne) {
    const double k = std::min(1.0, dt / SUSP_TAU);
    const double tgt[4] = {-FzFL / SPRING, -FzFR / SPRING, -FzRL / SPRING, -FzRR / SPRING};
    for (int i = 0; i < 4; i++) car.wheelZ[i] += (tgt[i] - car.wheelZ[i]) * k;
    const double fz = (car.wheelZ[0] + car.wheelZ[1]) / 2, rz = (car.wheelZ[2] + car.wheelZ[3]) / 2;
    const double lz = (car.wheelZ[0] + car.wheelZ[2]) / 2, rz2 = (car.wheelZ[1] + car.wheelZ[3]) / 2;
    car.pitch = (fz - rz) / S.L;
    car.roll = (lz - rz2) / S.trackF;
  }

  // ---- slip angles
  if (S.pk == 0) S.pk = peakSlip(S);
  const double pk = S.pk;
  double steer = car.delta;
  if (A.sc > 0) {
    const double ex = std::fabs(car.slipR) - std::fabs(car.slipF);
    if (ex > 0.03) steer += sign(car.slipR) * std::min(0.25, (ex - 0.03) * 1.6) * A.sc;
    const double base = std::atan((car.vy + S.a * car.r) / vSafe);
    const double lim = pk * (1.05 + 0.45 * (1 - A.sc));
    steer = std::max(base - lim, std::min(base + lim, steer));
  }
  car.steerEff = steer;

  const double af = std::atan((car.vy + S.a * car.r) / vSafe) - steer;
  const double ar = std::atan((car.vy - S.b * car.r) / vSafe);

  const double lowV = std::min(1.0, v / 3.0);
  double Fyf = pac(S, af, capAxF, BF) * lowV;
  double Fyr = pac(S, ar, capAxR, BR) * lowV;
  if (lowV < 1) {
    const double w = 1 - lowV;
    const double capF = capAxF, capR = capAxR;
    const double vLatF = car.vy + S.a * car.r, vLatR = car.vy - S.b * car.r;
    const double visc = 1 / 1.5;
    Fyf += -std::max(-capF, std::min(capF, vLatF * visc * capF)) * w;
    Fyr += -std::max(-capR, std::min(capR, vLatR * visc * capR)) * w;
  }

  // ---- longitudinal
  double thrCmd = car.throttle, brkCmd = car.brake;
  if (A.tc > 0) {
    const double capR = std::max(1.0, capAxR);
    const double latUse = std::min(1.0, std::fabs(Fyr) / capR);
    const double longRoom = std::sqrt(std::max(0.0, 1 - latUse * latUse)) * capR;
    const double full = std::min(S.Pmax / std::max(v, 9.0), S.Fdrive);
    const double room = longRoom * (1 + 0.6 * (1 - A.tc));
    const double want = full > 1 ? std::min(1.0, room / full) : 1;
    car.tcCut += (want - car.tcCut) * std::min(1.0, dt * (want < car.tcCut ? 90 : 9));
    thrCmd *= car.tcCut;
  } else car.tcCut = 1;
  if (A.abs > 0) {
    const double tgt = car.lock ? 0.5 : 1;
    car.absCut += (tgt - car.absCut) * std::min(1.0, dt * (car.lock ? 120 : 25));
    brkCmd *= 1 - (1 - car.absCut) * A.abs;
  } else car.absCut = 1;

  double FxR = 0, FxF = 0;
  const int sel = car.selector;
  if (thrCmd > 0 && sel != 0) {
    const double full = std::min(S.Pmax / std::max(v, 9.0), S.Fdrive) * thrCmd;
    if (sel > 0) FxR += full;
    else if (car.vx > -REV_MAX) FxR -= std::min(full, S.Fdrive * REV_FORCE);
  }
  if (brkCmd > 0) {
    const double dir = car.vx < -0.2 ? -1 : 1;
    FxF -= dir * S.Fbrake * S.brakeBal * brkCmd;
    FxR -= dir * S.Fbrake * (1 - S.brakeBal) * brkCmd;
  }
  if (cm) {
    FxF *= (car.cmOn[0] + car.cmOn[1]) * 0.5;
    FxR *= (car.cmOn[2] + car.cmOn[3]) * 0.5;
  }
  const bool lockF = clampCircle(FxF, Fyf, capAxF);
  const bool spinR = clampCircle(FxR, Fyr, capAxR);

  if (car.gripF < 1 || car.gripR < 1) {
    Fyf *= car.gripF; FxF *= car.gripF;
    Fyr *= car.gripR; FxR *= car.gripR;
  }

  // ---- banking
  double bankF = 0;
  if (env.bank != 0 && !car.airborne) {
    const double th = env.bank * PI / 180;
    bankF = (S.m * g + DFf + DFr) * std::sin(th) * env.bankDir;
  }

  // ---- gravity along the road
  double gradeF = 0;
  if (env.slope != 0 && !car.airborne) gradeF = -S.m * g * env.slope / std::sqrt(1 + env.slope * env.slope);

  // ---- a hurt corner pulls
  double xFx = 0, xFy = 0, xMz = 0;
  if (cm) {
    double W[4][2];
    wheelPos(S, W);
    const double Fz4[4] = {FzFL, FzFR, FzRL, FzRR};
    auto split = [&](int i, int j, double F) {
      const double gi = car.cmOn[i] * car.cmKD[i] * Fz4[i], gj = car.cmOn[j] * car.cmKD[j] * Fz4[j];
      const double sh = gi + gj > 1 ? gi / (gi + gj) : 0.5;
      return -W[i][1] * F * sh - W[j][1] * F * (1 - sh);
    };
    xMz += split(0, 1, FxF * std::cos(steer)) + split(2, 3, FxR);
    const double dir = sign(car.vx != 0 ? car.vx : 1), fade = std::min(1.0, v / 2);
    for (int i = 0; i < 4; i++) {
      if (car.cmDrag[i] > 0) {
        const double fd = -car.cmDrag[i] * Fz4[i] * dir * fade;
        xFx += fd; xMz += -W[i][1] * fd;
      }
      if (car.cmOn[i] == 0) {
        const double cvx = car.vx - car.r * W[i][1], cvy = car.vy + car.r * W[i][0];
        const double sp = std::hypot(cvx, cvy), k = -0.6 * Fz4[i] / std::max(1.0, sp);
        const double fx = k * cvx, fy = k * cvy;
        xFx += fx; xFy += fy; xMz += W[i][0] * fy - W[i][1] * fx;
      }
    }
  }

  // ---- equations of motion
  const double cd = std::cos(steer), sd = std::sin(steer);
  double Fx = FxR + FxF * cd - Fyf * sd - drag * sign(car.vx != 0 ? car.vx : 1) + gradeF;
  double Fy = Fyf * cd + Fyr + FxF * sd + bankF;
  double Mz = S.a * (Fyf * cd + FxF * sd) - S.b * Fyr;
  if (cm) { Fx += xFx; Fy += xFy; Mz += xMz; }

  car.ax = Fx / S.m + car.vy * car.r;
  car.ay = Fy / S.m - car.vx * car.r;
  car.vx += car.ax * dt;
  car.vy += car.ay * dt;
  car.r += (Mz / S.Izz) * dt;
  const double RMAX = 4.5;
  if (car.r > RMAX) car.r = RMAX; else if (car.r < -RMAX) car.r = -RMAX;
  if (v < 3 && !car.airborne) car.r *= 1 - std::min(0.9, 4 * dt);

  const bool reversing = car.selector == -1;
  if (car.vx < 0 && !car.airborne && !reversing && std::hypot(car.vx, car.vy) < 33) car.vx = 0;
  car.hdg += car.r * dt;
  car.x += (car.vx * std::cos(car.hdg) - car.vy * std::sin(car.hdg)) * dt;
  car.y += (car.vx * std::sin(car.hdg) + car.vy * std::cos(car.hdg)) * dt;

  // ---- tyre temperature and wear
  const double vh = std::max(v, 3.0);
  const double powF = std::fabs(af) * std::fabs(Fyf) * vh + (lockF ? std::fabs(FxF) * 0.05 * vh : 0);
  const double powR = std::fabs(ar) * std::fabs(Fyr) * vh + (spinR ? std::fabs(FxR) * 0.05 * vh : 0);
  const double HEAT = 6.2e-5, COOL = 0.010;
  const double air = 1 + 0.016 * v;
  t.Tf += (HEAT * powF - COOL * air * (t.Tf - AMBIENT)) * dt;
  t.Tr += (HEAT * powR - COOL * air * (t.Tr - AMBIENT)) * dt;
  const double wk = 2.0e-9 * S.wear;
  t.wf = std::min(1.6, t.wf + wk * powF * dt);
  t.wr = std::min(1.6, t.wr + wk * powR * dt * 1.12);
  // ---- ...and per corner, for the engineer
  if (!car.hasTyres || t.age < car.tyreAge) makeTyres(car, (t.Tf + t.Tr) / 2);
  {
    const double Fz4[4] = {FzFL, FzFR, FzRL, FzRR};
    const double nF = std::max(1.0, FzFL + FzFR), nR = std::max(1.0, FzRL + FzRR);
    for (int i = 0; i < 4; i++) {
      CornerTyre &c = car.tyres[i];
      const bool front = i < 2;
      const double pw = (front ? powF : powR) * 2 * Fz4[i] / (front ? nF : nR);
      c.Tc += (HEAT * pw - COOL * air * (c.Tc - AMBIENT)) * dt;
      const double tg = c.Tc + std::min(70.0, pw * 4.5e-4);
      c.Ts += (tg - c.Ts) * std::min(1.0, dt / 0.45);
      c.wear = std::min(1.6, c.wear + wk * pw * dt * (front ? 1 : 1.12));
      if (c.leak > 0) {
        c.air = std::max(0.0, c.air - c.leak * dt);
        if (c.air < 0.08) { c.air = 0; c.leak = 0; c.flat = true; }
      }
      c.p = hotPressure(c);
    }
  }
  t.age += dt;
  car.tyreAge = t.age;

  car.slipF = af; car.slipR = ar;
  car.lock = lockF; car.wheelspin = spinR;
  car.speed = std::hypot(car.vx, car.vy);
  car.gLat = Fy / (S.m * g); car.gLong = Fx / (S.m * g);
  car.Fxp = Fx; car.Fyp = Fy;
  car.muF = muF; car.muR = muR;
  car.Fyf = Fyf; car.Fzf = Fzf;
}

}  // namespace xbr
