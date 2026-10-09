// home.hpp — the home page and the pages on the way to a race: home.html and
// js/home.js, drawn natively. HOME (a live race behind it), RACE SETUP, THE
// GARAGE, SETTINGS. Paper, ink, one loud red; Anton for the capitals, a marker
// pen for the one thing that talks.
//
// The settings record is the browser game's `wdc.menu`, field for field.
#pragma once
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "render.hpp"

namespace xbr {

struct MenuSave {
  std::string track = "monza", car = "f1", mode = "race", tier = "medium", start = "mid";
  int grid = 22, laps = 3;
  bool noDnf = false;
  std::string time = "live", weather = "live", battle = "medium", field = "f1", theme = "light", music = "on";
  std::map<std::string, std::string> teams;      // league -> team key ("" = none yet)
  int ffb = 0, cam = 0, volume = 8;              // native only: the wheel's force is OFF until you raise it
  bool line = false;
  void load(const std::string &path);
  void save(const std::string &path) const;
};

struct LiveRow { int p; std::string col, name, gap; bool you; };
struct LiveTower { bool up = false; std::string track; int lap = 0, laps = 0; std::vector<LiveRow> rows; };

enum class Nav { Up, Down, Left, Right, Ok, Back, Go };

class Home {
 public:
  Home(const std::string &dataDir, const std::string &savePath);
  MenuSave S;
  std::string page = "home";
  bool wantStart = false, wantQuit = false;       // read and clear
  bool dirty = false;                             // the circuit or the car changed: the backdrop should follow
  void input(Nav n);
  void draw(Renderer &R, float k, double clock, const LiveTower &live);
  bool overWorld() const { return page == "home"; }   // only HOME has the race behind it
  void say(const std::string &t) { if (!t.empty()) { sayText = t; sayAt = now; } }
  void show(const std::string &name, int keep = 0);
  std::string teamKey() const;                    // the team of the league you are driving, or any you have
  int startSlot(int grid) const;
  std::string dataDir;

 private:
  struct Item { std::function<void()> ok, left, right; };
  std::vector<Item> items;
  int at = 0;
  std::function<void()> back;
  std::string savePath, sayText;
  double now = 0, sayAt = -9;
  int garageAt = -1;
  struct Outline { std::vector<float> xy; double len = 0; float x0 = 0, y0 = 0, x1 = 1, y1 = 1; bool ok = false; };
  std::map<std::string, Outline> outlines;
  const Outline &outline(const std::string &id);
  void drawMap(Renderer &R, float k, float x, float y, float w, float h, const std::string &id, bool car, double clock);
  void build();
  void lightsOut();
  struct Opt { std::string label, key; std::vector<std::pair<std::string, std::string>> opts; };
  std::vector<Opt> setupRows() const;
  std::string get(const std::string &key) const;
  void set(const std::string &key, const std::string &v);
};

}  // namespace xbr
