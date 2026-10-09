// driver.cpp — js/autopilot.js and the hands half of js/input.js, ported.
// The two lessons that file is built out of still hold here: a controller is
// not a 400 Hz servo, and brakes and steering spend the same grip.
#include "driver.hpp"

#include <algorithm>
#include <cmath>

namespace xbr {

double steerLock(double speed) {
  const double v = std::max(std::isfinite(speed) ? speed : 0.0, 12.0);
  return 0.40 * std::min(1.0, std::pow(14 / v, 0.80));
}

// ---- hands ---------------------------------------------------------------------
namespace RATES {
constexpr double WIND = 4.6, WIND_SOFT = 0.32, RAMP = 0.45, CENTRE = 8.2, tUp = 3.4, tDn = 7.5, bUp = 5.5, bDn = 9;
}
static double approach(double v, double target, double up, double dn) {
  return target > v ? v + std::min(up, target - v) : v - std::min(dn, v - target);
}

void Hands::update(double dt, const HandsIn &in) {
  if (in.analog) {
    usingPad = true;
    wheel = in.aSteer; throttle = in.aThrottle; brake = in.aBrake;
    return;
  }
  usingPad = false;
  const int wantI = (in.left ? 1 : 0) - (in.right ? 1 : 0);
  const double want = wantI;
  if (wantI != 0) {
    if (wantI != windWant) { windWant = wantI; windT = 0; }
    windT += dt;
    const double k = RATES::WIND_SOFT + (1 - RATES::WIND_SOFT) * std::min(1.0, windT / RATES::RAMP);
    const double rate = RATES::WIND * k * (want * wheel < 0 ? 1.8 : 1);
    wheel += sign(want - wheel) * std::min(rate * dt, std::fabs(want - wheel));
  } else {
    windWant = 0; windT = 0;
    const double d = std::min(RATES::CENTRE * dt, std::fabs(wheel));
    wheel -= sign(wheel) * d;
  }
  throttle = approach(throttle, in.throttle ? 1 : 0, RATES::tUp * dt, RATES::tDn * dt);
  brake = approach(brake, in.brake ? 1 : 0, RATES::bUp * dt, RATES::bDn * dt);
}

// ---- difficulty ------------------------------------------------------------------
// How much of the tyre this controller can actually USE, per circuit and per
// car, measured by tools/ceiling.mjs. Re-run it after any physics change and
// carry the numbers across.
static double ceilingFor(const Track &track, const Spec &spec) {
  // A RIVAL'S CAR (proSpec): the grip fraction with the fastest clean lap, swept natively
  // per circuit (scratch ceil.sh: XBR_GRIP 0.66..0.94 on xbr-drive, 2026-10-09). Re-sweep after any change to proSpec.
  if (spec.pro) {
    struct Pro { const char *key; double gt3, gt4, hyper; };
    static const Pro P[] = { {"adam1", 0.66, 0.66, 0.66}, {"baku", 0.86, 0.82, 0.94}, {"bathurst", 0.94, 0.90, 0.94}, {"brandshatch", 0.78, 0.66, 0.94}, {"gravenmoor", 0.86, 0.78, 0.94}, {"kate", 0.90, 0.90, 0.90}, {"kate2", 0.90, 0.86, 0.94}, {"lagunaseca", 0.94, 0.86, 0.94}, {"monaco", 0.94, 0.94, 0.94}, {"monza", 0.90, 0.86, 0.94}, {"nordschleife", 0.82, 0.74, 0.94}, {"nurburgring", 0.78, 0.70, 0.94}, {"sepang", 0.78, 0.86, 0.94}, {"spa", 0.86, 0.82, 0.94}, {"street", 0.86, 0.82, 0.94}, {"suzuka", 0.90, 0.94, 0.94}, {"zandvoort", 0.82, 0.78, 0.94} };
    for (const auto &r : P) if (track.key == r.key) return spec.key == "gt4" ? r.gt4 : spec.key == "hyper" ? r.hyper : r.gt3;
    return 0.78;
  }
  struct Row { const char *key; double f4, f1; };
  static const Row T[] = {
    {"monza", 0.88, 0.92}, {"zandvoort", 0.78, 0.95}, {"suzuka", 0.88, 1.01}, {"monaco", 0.98, 0.95},
    {"baku", 0.84, 1.01}, {"nurburgring", 0.78, 1.01}, {"sepang", 0.78, 1.01}, {"spa", 0.92, 0.95},
  };
  for (const auto &r : T)
    if (track.key == r.key) {
      if (spec.key == "f4") return r.f4;
      if (spec.key == "f1") return r.f1;
    }
  return 0.82;
}
static const double WINGLESS_GRIP = 0.78;

const std::vector<Tier> &allTiers() {
  static const std::vector<Tier> T = {
    {"supercasual", "SUPERCASUAL", "centre", 0.76, 0.035, 0.55, 0.20, 0.25, 2.2, 0.55},
    {"casual", "CASUAL", "race", 0.84, 0.030, 0.62, 0.38, 0.42, 1.5, 0.70},
    {"medium", "MEDIUM", "race", 0.93, 0.020, 0.78, 0.58, 0.62, 0.7, 0.86},
    {"hard", "HARD", "race", 1.00, 0.012, 0.92, 0.80, 0.85, 0.22, 0.97},
  };
  return T;
}
const Tier *tierFor(const std::string &key) {
  for (const auto &t : allTiers()) if (key == t.key) return &t;
  return &allTiers()[2];
}

double Mulberry::operator()() {
  uint32_t u = (uint32_t)a;
  u += 0x6D2B79F5u;
  a = (int32_t)u;
  uint32_t t = (u ^ (u >> 15)) * (1u | u);
  t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}

Driver makeDriver(double seed, const std::string &tierKey, int nCorners) {
  Driver d;
  d.T = tierFor(tierKey);
  d.tier = d.T->key;
  const Tier &T = *d.T;
  d.rng = Mulberry(seed * 7919 + 13);
  d.corner.resize(nCorners);
  for (int i = 0; i < nCorners; i++) d.corner[i] = (float)(1 + (d.rng() - 0.5) * (1 - T.consistency) * 0.10);
  d.gripFrac = std::max(0.4, T.gripFrac + (d.rng() - 0.5) * T.spread);
  d.aggression = std::min(1.0, T.aggression * (0.7 + d.rng() * 0.6));
  d.defence = std::min(1.0, T.defence * (0.7 + d.rng() * 0.6));
  d.consistency = T.consistency;
  d.place = T.place;
  d.tyreCare = 0.3 + d.rng() * 0.7;
  d.nextMistake = 6 + d.rng() * 40;
  {
    Mulberry r(seed * 4243 + 71);
    d.style.launch = 0.2 + r() * 0.8;
    const double a = r(), b = r();
    d.style.space = a * b * 0.8;
    d.style.side = 0.3 + r() * 0.7;
  }
  return d;
}

Autopilot::Autopilot(const Track &track_, Lines &lines_, const Spec &spec_, double peak_, Driver *driver)
    : track(track_), lines(lines_), spec(spec_), peak(peak_), d(driver) {
  d->ceiling = ceilingFor(track, spec);
  d->grip = !std::isnan(d->gripOverride) ? d->gripOverride : clampd(d->gripFrac * d->ceiling, 0.35, 1.05);
  lineKind_ = d->T->line;
  lineGrip_ = d->grip;
  line_ = &lineAt(lineKind_, lineGrip_);
}

const Line &Autopilot::lineAt(const std::string &kind, double g) {
  return track.stock ? lines.race : lines.at(kind, g);
}

DriveInfo Autopilot::drive(Car &car, const Proj &proj, double dt, const DriveCtx *ctx) {
  acc += dt;
  if (acc < 1 / hz) {
    const double max = rackRate * dt;
    car.delta += clampd(want - car.delta, -max, max);
    car.throttle = thr; car.brake = brk;
    return info;
  }
  acc = 0;
  const double v = car.speed;
  const int i = proj.i;
  auto idxAt = [&](double m) { return track.idx(proj.s + m); };

  const bool wingless = car.hasLost && car.lostFrontWing;
  {
    const std::string &kind = d->lineKind.empty() ? std::string(d->T->line) : d->lineKind;
    const bool banded = !std::isnan(d->gripNow);
    double g = banded ? d->gripNow : d->grip;
    if (wingless) g = std::max(0.35, g * WINGLESS_GRIP);
    const double wg = wetGrip();
    if (wg < 1) g *= wg;
    if (banded || wingless || wg < 1) g = jsRound(g * 400) / 400;
    if (kind != lineKind_ || g != lineGrip_) { lineKind_ = kind; lineGrip_ = g; line_ = &lineAt(kind, g); }
  }
  const Line &line = *line_;

  // ---- mistakes: scheduled, with consequences
  d->nextMistake -= (1 + 1.6 * (ctx ? ctx->pressure : 0) * (1.15 - d->consistency)) / hz;
  if (d->nextMistake <= 0 && !d->mistakeKind && v > 20) {
    const double r = d->rng();
    d->mistakeKind = r < 0.45 ? 1 : r < 0.8 ? 2 : 3;
    d->mistakeT = 0.35 + d->rng() * 0.5;
    const double es = std::isnan(d->errScale) ? 1 : d->errScale;
    d->nextMistake = (60 / std::max(0.05, d->T->mistakes * es)) * (0.5 + d->rng());
  }
  if (d->mistakeKind && (d->mistakeT -= 1 / hz) <= 0) d->mistakeKind = 0;

  // ---- where do I want to be, laterally?
  double wantOff = line.off[i] + (ctx ? ctx->offBias : 0);
  if (d->mistakeKind == 2) { const double c0 = line.cur[i]; wantOff += sign(c0 != 0 ? c0 : 1) * -1.6; }
  const double lim = std::max(0.3, track.w[i] - 1.0);
  wantOff = clampd(wantOff, -lim, lim);

  const bool lost = std::fabs(proj.lat) > proj.w && v < 22;

  // ---- steering
  const int prev = (int)jsRound(std::min(8.0, spec.a + 1 + v * 0.055) / track.ds);
  const int j = track.idx((i + prev) * track.ds);
  const double ff = std::atan(spec.L * line.cur[j]);
  double hErr = line.hdg[j] - car.hdg;
  while (hErr > PI) hErr -= 2 * PI;
  while (hErr < -PI) hErr += 2 * PI;
  const double cross = proj.lat - wantOff;
  const double K = lost ? 1.6 : kCross * (0.6 + 0.4 * d->place);
  double delta = ff + hErr + std::atan2(-K * cross, std::max(v, 7.0));
  delta -= kYaw * car.r;

  const double over = std::fabs(car.slipR) - std::fabs(car.slipF);
  if (over > 0.03) delta += sign(car.slipR) * std::min(0.30, (over - 0.03) * 1.8 * kCounter / 0.40);

  if (car.slipF < -peak) delta = std::min(delta, car.delta);
  else if (car.slipF > peak) delta = std::max(delta, car.delta);

  d->noiseT -= 1 / hz;
  if (d->noiseT <= 0) {
    d->noiseT = 0.25 + d->rng() * 0.5;
    d->noise = (d->rng() * 2 - 1) * (1 - d->consistency) * 0.045;
  }
  delta += d->noise;
  if (d->mistakeKind == 3) delta += sign(car.slipR != 0 ? car.slipR : 1) * 0.04;

  const double lock = steerLock(v);
  want = clampd(delta, -lock, lock);

  // ---- speed
  double mod = 1;
  const Corner *c = track.cornerAt(proj.s);
  const bool stock = track.stock;
  if (c && !stock && !d->corner.empty()) mod *= (double)d->corner[((c->n % (int)d->corner.size()) + (int)d->corner.size()) % (int)d->corner.size()];
  const double wear = std::max(car.tyre.wf, car.tyre.wr);
  if (!stock) mod *= 1 - 0.05 * wear * d->tyreCare;
  if (!stock) mod *= 1 - 0.17 * car.dirty;

  const double look = std::min(60.0, v * 0.30);
  double need = line.v[idxAt(look)] * mod;
  const double dragK = towDrag(car.tow) * (car.drsOpen && spec.drs ? spec.drsCd : 1);
  if (dragK < 0.999) {
    if (line.vTop == 0) { double m = 0; for (float f : line.v.d) m = std::max(m, (double)f); line.vTop = m; }
    const double vl = line.v[idxAt(look)];
    const double k = clampd((vl / line.vTop - 0.94) / 0.05, 0, 1);
    if (k > 0) need *= 1 + (std::pow(dragK, -1.0 / 3) - 1) * k;
  }
  if (lost) need = std::min(need, 13.0);
  if (ctx && ctx->lunge != 0) need *= 1 + ctx->lunge;
  if (ctx && !std::isnan(ctx->hold) && ctx->hold < 1) need *= ctx->hold;
  if (ctx && !std::isnan(ctx->speedCap)) need = std::min(need, ctx->speedCap);

  // ---- pedals: like a driver, not a thermostat
  const double BRAKE_ON = 1.6, BRAKE_AT = 0.85;
  const double err = need - v;
  const double Fres = 0.5 * spec.rho * spec.CdA * v * v + spec.rollRes;
  const double Fcap = std::min(spec.Pmax / std::max(v, 9.0), spec.Fdrive);
  const double cmuF = std::isnan(car.muF) ? spec.mu : car.muF, cmuR = std::isnan(car.muR) ? spec.mu : car.muR;
  const double gripMin = std::min(cmuF, cmuR);
  const double latUse = std::min(1.0, std::fabs(car.gLat * 9.81)
    / std::max(4.0, gripMin * (spec.m * 9.81 + 0.5 * spec.rho * v * v * spec.ClA) / spec.m));
  const double hold = std::min(stock ? 1.0 : 0.85, Fres / Fcap) * (stock ? 1 : std::max(0.0, 1 - latUse * latUse));
  const double qv = 0.5 * spec.rho * v * v;
  const double aBrk = (std::min(cmuF * (spec.m * 9.81 + qv * spec.ClA), spec.Fbrake) + qv * spec.CdA) / spec.m;
  double aReq = 0;
  const double reachM = std::min(220.0, 20 + v * 2.2);
  for (double dm = 6; dm < reachM; dm += 4) {
    const double vk = line.v[idxAt(dm)] * mod;
    if (vk < v) { const double a = (v * v - vk * vk) / (2 * dm); if (a > aReq) aReq = a; }
  }
  if (ctx && !std::isnan(ctx->obstV) && v > ctx->obstV) {
    const double a = (v * v - ctx->obstV * ctx->obstV) / (2 * std::max(1.5, ctx->obstDs));
    if (a > aReq) aReq = a;
  }
  const double bWant = aReq / std::max(1.0, aBrk);
  if (braking) { if (bWant < 0.12 && err > -0.3) braking = false; }
  else if (bWant > BRAKE_AT || err < -BRAKE_ON) braking = true;
  if (braking) {
    thr = 0;
    brk = std::min(1.0, bWant * 1.08 + std::max(0.0, -err) / 3);
  } else {
    brk = 0;
    thr = clampd(hold + err / 2.5, 0, 1);
  }

  // ---- the friction circle: brakes and steering spend the same grip
  const double g = 9.81;
  const double q = 0.5 * spec.rho * v * v;
  const double Fz = spec.m * g + q * spec.ClA;
  const double aMax = std::max(4.0, gripMin * Fz / spec.m);
  const double aLat = std::fabs(car.gLat * 9.81);
  const double ratio = aLat / aMax;
  const double budget = std::sqrt(std::max(0.0, 1 - std::min(1.0, ratio * ratio)));
  brk = std::min(brk, budget * (0.85 + 0.15 * d->place) + 0.10);
  thr = std::min(thr, budget * 0.55 + 0.45);

  if (over > 0.03) brk *= std::max(0.25, 1 - (over - 0.03) * 5);
  if (over > 0.07) thr *= std::max(0.0, 1 - (over - 0.07) * 5);
  if (d->mistakeKind == 1) brk = std::min(1.0, brk * 1.45 + 0.15);

  info = {need, err, cross, budget, d->mistakeKind};

  const double max = rackRate * dt;
  car.delta += clampd(want - car.delta, -max, max);
  car.throttle = thr; car.brake = brk;
  return info;
}

}  // namespace xbr
