// weather.hpp — the pure half of js/weather.js: where the sun is (arithmetic
// from the date, the time and a latitude), what a reading means to the
// renderer and the physics, the phases of a day, and chosen/changing weather.
// NOT here: the Open-Meteo fetch and the timezone guess (browser, network).
#pragma once
#include <string>

namespace xbr {

struct Sun { double elevation = 0, azimuth = 0, declination = 0; };
// NOAA's abridged solar position. `unixMs` is a moment (Date.getTime()), UTC.
// Azimuth is degrees clockwise from north; elevation is NEGATIVE at night.
Sun solarPosition(double unixMs, double latDeg, double lonDeg);
// The sun as a direction: +x east, +y up, +z south.
void sunVector(double elevation, double azimuth, double out[3]);

// A raw reading (Open-Meteo shape). NaN = not given.
struct RawWeather { double cloud, rain, wind, temp; std::string kind; RawWeather(); };
struct WeatherRead { double wetness = 0, cloud = 0, haze = 0, punch = 1, wind = 6, temp = 18; std::string kind = "clear"; };
WeatherRead readWeather(const RawWeather &w);
// WEATHER YOU CAN DRIVE OUT OF: `dryness` 0 temperate .. 1 desert.
WeatherRead atBiome(const WeatherRead &read, double dryness = 0);

struct DayPhase { const char *name; double dark; bool rising; };
DayPhase dayPhase(double elevation, double azimuth);
// The moment today (in this machine's own clock) when the sun is at a phase:
// "night" "dawn" "sunrise" "morning" "day" "evening" "sunset" "dusk". Unix ms,
// or NaN for an unknown phase.
double timeFor(const std::string &phase, double nowMs, double lat, double lon);

// CHOSEN AND CHANGING WEATHER. THE ROAD IS NOT THE SKY: wetness follows the
// rain with a lag (soaks in over ~20 s, dries over ~2 minutes).
class WeatherDirector {
 public:
  // `mode` is "live", one of clear/cloudy/overcast/rain/storm, or "changing".
  explicit WeatherDirector(const std::string &mode = "live", double seed = 1);
  struct Sky { double cloud = 0, rain = 0; std::string kind; double road = 0; };
  // Advance dt seconds. `live` is the real reading, used in LIVE mode (may be null).
  Sky step(double dt, const RawWeather *live = nullptr);
  // The state it just changed to, once, for a toast ("" = none).
  std::string takeChange() { std::string c = changed; changed.clear(); return c; }

  std::string mode, state;
  double road = 0, blend = 1, dwell = 0;

 private:
  double rand();
  double r = 0;
  struct CR { double cloud, rain; };
  CR from{0, 0}, to{0, 0}, cur{0, 0};
  std::string changed;
};

}  // namespace xbr
