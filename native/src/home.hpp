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

#include "career.hpp"
#include "render.hpp"

namespace xbr {

struct HudTheme;
class Race;

struct MenuSave {
  std::string track = "monza", car = "f1", mode = "race", tier = "medium", start = "mid";
  int grid = 22, laps = 3;
  bool noDnf = false;
  std::string time = "live", weather = "live", battle = "medium", field = "f1", theme = "light", music = "on";
  std::map<std::string, std::string> teams;      // league -> team key ("" = none yet)
  int ffb = 50, cam = 0, volume = 8;             // native only. ffb: percent of the bridge's ceiling (Adam: "starts at 50%")
  bool line = false;
  std::string look = "film";                     // native only: "film" = shadows, bloom, the film curve; "plain" = the picture as it was
  bool modelSeen = false;                        // false: no choice has ever been saved, so the best car on this machine is offered
  std::string model;                             // native only: a downloaded car (data/cars/<key>) for the GT3 seat, "" = the built-in body
  // XINGUS (js/home.js `X`, the browser's own record `wdc.xingus`)
  bool xOn = false;
  std::string xStyle = "gt3", xGears = "manual", xTrack, xHeil = "heilgrand", xField = "4fun";
  int xBots = 0;                                 // 0 = the style's own number
  void load(const std::string &path);
  void save(const std::string &path) const;
};

// A Xingus STYLE is switches the race understands (js/home.js XSTYLES).
struct XStyle { const char *key, *label, *line, *tune; int rivals; bool derby, stakes, loose; };
const XStyle &xstyle(const std::string &key);

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
  // the mouse, in device pixels: hovering lights a card, a click presses what is under it
  void mouse(float x, float y, bool click);
  void draw(Renderer &R, float k, double clock, const LiveTower &live);
  bool overWorld() const { return page == "home"; }   // only HOME has the race behind it
  void say(const std::string &t) { if (!t.empty()) { sayText = t; sayAt = now; } }
  void show(const std::string &name, int keep = 0);
  std::string teamKey() const;                    // the team of the league you are driving, or any you have
  int startSlot(int grid) const;
  std::string dataDir;
  // the downloaded car you chose, if this league has one ("" = the built-in body), and the kind of engine it has
  std::string pack() const;
  std::string voice() const;
  std::string xTrackKey() const;                  // the circuit a Xingus session loads (a Heiligen route, the oval, or the usual one)

  // ---- THE CAREER AND THE EVENTS (career.hpp; the pages are in home_career.cpp)
  Career career;
  // An event is started by putting what it needs into S for as long as it runs
  // (the game reads S for everything), and the menu's own record is put back
  // when it is over. `event()` is what S cannot say: the field, the slot, the ghost.
  const Launch *event() const { return eventOn ? &career.L : nullptr; }
  bool startEvent(const EventDef &e, bool inCareer);          // true: wantStart is set
  bool startKey(const std::string &key);                      // --event KEY, for unattended runs
  bool haunted() const { return eventOn && career.L.haunted; }
  std::string eventBrief() const;                             // the line for the middle of the screen as it starts
  HudTheme eventTheme() const;
  void eventResult(Race *race, bool hasBest, double best, double ideal);   // the race is over: what did it mean
  // leaving the session for the menu, by any door: settle a hot lap, put the menu's record back
  void leaveEvent(Race *race, bool hasBest, double best, double ideal);
  void cancelEvent() { if (eventOn) { S = S0; eventOn = false; career.clear(); } }   // it never started, or the game is closing
  std::string landing();                                      // the page to come back to (read once)
  void drawOutcome(Renderer &R, float k);                     // the strip over the RESULTS screen
  int shotCard = -1;                                          // --card N: the story card `--screen story` shows

 private:
  struct Pack { std::string key, title, klass; };
  std::vector<Pack> packs;      // data/cars/index.json: what tools/bakecar.mjs has baked on this machine
  struct Item { std::function<void()> ok, left, right, up = nullptr, down = nullptr; };
  struct Hot { float x, y, w, h; int item; std::function<void()> fn; };
  std::vector<Hot> hots;        // rebuilt by every draw
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
  std::vector<Opt> heilRows() const;
  struct Circuit { std::string id, name, tag; };
  std::vector<Circuit> extra;                     // optional circuits found on this machine (home.cpp OPTIONAL)
  std::vector<Circuit> circuits() const;          // the circuit row: in Xingus, Heiligen and the oval come first
  std::string circuitId() const;
  Json hmap;                                      // data/build/heiligen-map.json
  std::string get(const std::string &key) const;
  // ---- the career's pages
  bool eventOn = false;
  MenuSave S0;                                    // the menu's own record while an event has S
  std::string landPage;
  int viewSeason = -1;
  std::vector<int> storyQ;                        // the cards being shown
  int storyAt = 0;
  bool storyReplay = false;
  std::string storyHead;
  std::function<void()> storyThen;
  void story(const std::vector<int> &cards, const std::string &head, std::function<void()> then, bool replay = false);
  void storyStep(int d);
  void launchCareer(const EventDef &e);
  void afterDebrief();
  std::string circuitName(const std::string &key);
  void drawHub(Renderer &R, float k, double clock);
  void drawCareer(Renderer &R, float k, double clock);
  void drawEvents(Renderer &R, float k, double clock);
  void drawStory(Renderer &R, float k, double clock);
  void drawDebrief(Renderer &R, float k, double clock);
  void set(const std::string &key, const std::string &v);
};

}  // namespace xbr
