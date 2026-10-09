// ui.hpp — the game's own screens, drawn the way the browser draws them.
//
// Nothing here is designed in this file. The race screen is index.html +
// style.css + the hud()/raceHud() half of js/main.js + js/flags.js; every
// size, colour, slant and word below is read off those. `k` is device pixels
// per CSS pixel, so the numbers in this file ARE the stylesheet's numbers.
#pragma once
#include <string>
#include <vector>

#include "audio.hpp"
#include "physics.hpp"
#include "race.hpp"
#include "render.hpp"

namespace xbr {

struct Rgba { float c[4]; operator const float *() const { return c; } };
Rgba hex(const std::string &css, float a = 1);            // "#rrggbb"
Rgba mix(const Rgba &a, const Rgba &b, float t);          // color-mix(a t, b)
Rgba inkOn(const Rgba &bg);                               // black or white, whichever reads on it

// The team's colours on the HUD (js/main.js applyTheme): --bg --ink --pri --sec.
struct HudTheme {
  Rgba bg = hex("#0b0d10"), ink = hex("#e8eaee"), pri = hex("#ffb300"), sec = hex("#a35cff"), onpri = hex("#0a0a0a");
  static HudTheme forTeam(const std::string &teamKey);
};

struct HudIn {
  const Car *car = nullptr;
  const Spec *spec = nullptr;
  const Gearbox *box = nullptr;
  std::string trackName, carName;
  double sessionT = 0;              // seconds since the session began: the title card fades at 6
  int lap = 0;
  double lapT = 0, last = 0, best = 0;
  bool hasLast = false, hasBest = false, invalid = false;
  bool usingPad = false;
  std::string msg;                  // the one line in the middle of the screen ("" = none)
  Race *race = nullptr;             // null in a hot lap
  double clock = 0;                 // wall seconds, for anything that blinks
  bool passFlash = false;           // your tower row flashes green for the pass that stuck
};

class GameHud {
 public:
  void draw(Renderer &R, float k, const HudTheme &T, const HudIn &in);
  // PAUSED: the box in the middle. `items` are the labels, `at` the lit one.
  void pause(Renderer &R, float k, const HudTheme &T, const std::vector<std::string> &items, int at, const std::string &say);
  // CHEQUERED FLAG. `title` uses <span>…</span> for the coloured half, as the JS does.
  void results(Renderer &R, float k, const HudTheme &T, Race &race, const std::string &title, const std::string &line);
  void loading(Renderer &R, float k, const HudTheme &T, const std::string &text);
  // where the pause rows and the results' MENU button were last drawn (device pixels), for the mouse
  struct Box { float x, y, w, h; };
  std::vector<Box> pauseBoxes;
  Box menuBox{0, 0, 0, 0};
  void reset() { seen = -1; shownAt = -99; hasLast = false; towerAcc = 9; rows.clear(); }

 private:
  // flags.js: the newest race-control line that concerns you
  double seen = -1, shownAt = -99;
  bool hasLast = false;
  RaceEvent lastEv;
  // the tower is rebuilt eight times a second, not sixty
  double towerAcc = 9, towerT = 0;
  struct Row { int pos; Rgba chip; std::string name, gap, cls; bool me, out; bool klassOn = false; Rgba klass{}; };
  std::vector<Row> rows;
};

std::string fmtLapTime(double s, bool has);   // m:ss.mmm, or --:--.---

}  // namespace xbr
