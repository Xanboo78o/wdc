// weather.cpp — js/weather.js, the parts that are arithmetic.
#include "weather.hpp"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <limits>

namespace xbr {

static const double kPI = 3.141592653589793;
static const double RAD = kPI / 180, DEG = 180 / kPI;
static const double kNaN = std::numeric_limits<double>::quiet_NaN();

Sun solarPosition(double unixMs, double latDeg, double lonDeg) {
  // Julian day, then centuries since J2000.
  const double jd = unixMs / 86400000 + 2440587.5;
  const double t = (jd - 2451545) / 36525;

  const double meanLong = std::fmod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const double meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const double ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const double centre = std::sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + std::sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t)
    + std::sin(3 * meanAnom * RAD) * 0.000289;
  const double trueLong = meanLong + centre;
  const double appLong = trueLong - 0.00569 - 0.00478 * std::sin((125.04 - 1934.136 * t) * RAD);

  const double obl = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
  const double oblCorr = obl + 0.00256 * std::cos((125.04 - 1934.136 * t) * RAD);

  const double decl = std::asin(std::sin(oblCorr * RAD) * std::sin(appLong * RAD)) * DEG;

  // The equation of time.
  const double ty = std::tan(oblCorr / 2 * RAD);
  const double y = ty * ty;
  const double eqTime = 4 * DEG * (
    y * std::sin(2 * meanLong * RAD)
    - 2 * ecc * std::sin(meanAnom * RAD)
    + 4 * ecc * y * std::sin(meanAnom * RAD) * std::cos(2 * meanLong * RAD)
    - 0.5 * y * y * std::sin(4 * meanLong * RAD)
    - 1.25 * ecc * ecc * std::sin(2 * meanAnom * RAD));

  // True solar time, in minutes, at this longitude. UTC in.
  const double secs = std::floor(unixMs / 1000);
  const double sod = std::fmod(std::fmod(secs, 86400) + 86400, 86400);
  const double hh = std::floor(sod / 3600), mm = std::floor(std::fmod(sod, 3600) / 60), ss = std::fmod(sod, 60);
  const double utcMin = hh * 60 + mm + ss / 60;
  const double solarMin = std::fmod(utcMin + eqTime + 4 * lonDeg + 1440, 1440);
  const double hourAngle = solarMin / 4 - 180;      // degrees, 0 at local solar noon

  const double lat = latDeg * RAD, d = decl * RAD, ha = hourAngle * RAD;
  const double cosZen = std::sin(lat) * std::sin(d) + std::cos(lat) * std::cos(d) * std::cos(ha);
  const double zenith = std::acos(std::max(-1.0, std::min(1.0, cosZen))) * DEG;
  double elevation = 90 - zenith;

  // Refraction, SAEMUNDSSON: well behaved all the way to the horizon.
  if (elevation > -2 && elevation < 20) {
    const double r = 1.02 / std::tan((elevation + 10.3 / (elevation + 5.11)) * RAD);  // arcminutes
    elevation += r / 60;
  }

  double azimuth = std::atan2(std::sin(ha), std::cos(ha) * std::sin(lat) - std::tan(d) * std::cos(lat)) * DEG + 180;
  azimuth = std::fmod(azimuth + 360, 360);
  return {elevation, azimuth, decl};
}

void sunVector(double elevation, double azimuth, double out[3]) {
  const double el = std::max(elevation, -6.0) * RAD, az = azimuth * RAD;
  const double c = std::cos(el);
  out[0] = std::sin(az) * c; out[1] = std::max(std::sin(el), 0.02); out[2] = -std::cos(az) * c;
}

RawWeather::RawWeather() : cloud(kNaN), rain(kNaN), wind(kNaN), temp(kNaN) {}

WeatherRead readWeather(const RawWeather &w) {
  const double rain = std::isnan(w.rain) ? 0 : w.rain;
  const double wet = std::min(1.0, rain / 2.5);           // 2.5 mm/h is properly wet
  const double kindWet = w.kind == "storm" ? 1 : w.kind == "rain" || w.kind == "showers" ? 0.7 : 0;
  WeatherRead r;
  r.wetness = std::max(wet, kindWet);
  // The nudge: cloud never reads as a flat lid.
  r.cloud = std::min(0.92, (std::isnan(w.cloud) ? 0.2 : w.cloud) * 0.88 + 0.04);
  r.haze = std::min(1.0, 0.12 + r.cloud * 0.5 + r.wetness * 0.45);
  r.punch = std::max(0.12, 1 - r.cloud * 0.85);
  r.wind = std::isnan(w.wind) ? 6 : w.wind;
  r.temp = std::isnan(w.temp) ? 18 : w.temp;
  r.kind = w.kind.empty() ? "clear" : w.kind;
  return r;
}

WeatherRead atBiome(const WeatherRead &read, double dryness) {
  const double d = std::max(0.0, std::min(1.0, dryness));
  WeatherRead r = read;
  r.wetness = read.wetness * (1 - d * 0.92);
  r.cloud = read.cloud * (1 - d * 0.55);
  r.haze = read.haze * (1 - d * 0.35) + d * 0.10;   // dry air is clear but dusty
  r.punch = std::min(1.0, read.punch * (1 + d * 0.35));
  return r;
}

DayPhase dayPhase(double elevation, double azimuth) {
  const bool rising = azimuth < 180;          // east of south: before solar noon
  const double e = elevation;
  const char *name = e < -12 ? "NIGHT" : e < -1 ? (rising ? "DAWN" : "DUSK")
    : e < 8 ? (rising ? "SUNRISE" : "SUNSET") : e < 25 ? (rising ? "MORNING" : "EVENING") : "DAY";
  const double dark = std::max(0.0, std::min(1.0, (2 - e) / 10));
  return {name, dark, rising};
}

double timeFor(const std::string &phase, double nowMs, double lat, double lon) {
  struct Want { const char *k; bool mid, noon; double e; bool rise; };
  static const Want W[] = {
    {"night", true, false, 0, false}, {"dawn", false, false, -5, true}, {"sunrise", false, false, 2, true},
    {"morning", false, false, 15, true}, {"day", false, true, 0, false}, {"evening", false, false, 15, false},
    {"sunset", false, false, 2, false}, {"dusk", false, false, -5, false},
  };
  const Want *want = nullptr;
  for (const Want &w : W) if (phase == w.k) want = &w;
  if (!want) return kNaN;
  // midnight today, in this machine's own clock
  std::time_t now = (std::time_t)std::floor(nowMs / 1000);
  std::tm tmv;
  localtime_r(&now, &tmv);
  tmv.tm_hour = 0; tmv.tm_min = 0; tmv.tm_sec = 0;
  const double day0 = (double)std::mktime(&tmv) * 1000;
  double best = kNaN, score = std::numeric_limits<double>::infinity();
  for (int m = 0; m < 1440; m++) {
    const double d = day0 + m * 60000.0;
    const Sun s = solarPosition(d, lat, lon);
    double k;
    if (want->noon) k = -s.elevation;
    else if (want->mid) k = s.elevation;
    else {
      if ((s.azimuth < 180) != want->rise) continue;
      k = std::fabs(s.elevation - want->e);
    }
    if (k < score) { score = k; best = d; }
  }
  return best;
}

static const char *KINDS[5] = {"clear", "cloudy", "overcast", "rain", "storm"};
static bool preset(const std::string &k, double &cloud, double &rain) {
  static const double P[5][2] = {{0.10, 0}, {0.50, 0}, {0.88, 0}, {0.92, 2.4}, {1.00, 7.0}};
  for (int i = 0; i < 5; i++) if (k == KINDS[i]) { cloud = P[i][0]; rain = P[i][1]; return true; }
  cloud = P[0][0]; rain = P[0][1];
  return false;
}

double WeatherDirector::rand() { r = std::fmod(r * 9301 + 49297, 233280); return r / 233280; }

WeatherDirector::WeatherDirector(const std::string &mode_, double seed) : mode(mode_) {
  r = std::fmod(seed * 9301 + 49297, 233280);
  state = mode == "changing" ? (rand() < 0.5 ? "clear" : "cloudy") : mode;
  preset(state, from.cloud, from.rain);
  to = from; blend = 1;
  dwell = 40 + rand() * 60;
  road = from.rain > 0 ? 1 : 0;   // a wet race starts wet
  cur = from;
}

WeatherDirector::Sky WeatherDirector::step(double dt, const RawWeather *live) {
  Sky sky;
  if (mode == "live") {
    sky.cloud = live && !std::isnan(live->cloud) ? live->cloud : 0.2;
    sky.rain = live && !std::isnan(live->rain) ? live->rain : 0;
    sky.kind = live && !live->kind.empty() ? live->kind : "clear";
  } else {
    if (mode == "changing") {
      dwell -= dt;
      if (dwell <= 0 && blend >= 1) {
        int i = -1;
        for (int k = 0; k < 5; k++) if (state == KINDS[k]) i = k;
        // one step either way; storms don't last, clear skies can
        const int j = std::max(0, std::min(4, i + (state == "storm" ? -1 : state == "clear" ? 1 : rand() < 0.68 ? 1 : -1)));
        from = cur; preset(KINDS[j], to.cloud, to.rain);
        state = KINDS[j]; blend = 0;
        dwell = 45 + rand() * 75;
        changed = state;
      }
      blend = std::min(1.0, blend + dt / 30);
    } else { preset(mode, to.cloud, to.rain); blend = 1; from = to; }
    const double b = blend;
    cur = {from.cloud + (to.cloud - from.cloud) * b, from.rain + (to.rain - from.rain) * b};
    sky.cloud = cur.cloud; sky.rain = cur.rain;
    sky.kind = cur.rain > 3.5 ? "storm" : cur.rain > 0.2 ? "rain" : cur.cloud > 0.7 ? "overcast" : "clear";
  }
  const double target = std::min(1.0, sky.rain / 2.0);
  const double k = target > road ? dt / 20 : dt / 120;
  road += (target - road) * std::min(1.0, k * 3);
  sky.road = road;
  return sky;
}

}  // namespace xbr
