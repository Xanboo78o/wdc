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
  std::string time = "live", weather = "live", battle = "medium", field = "f1", theme = "pro", colour = "film", music = "on";
  std::map<std::string, std::string> teams;      // league -> team key ("" = none yet)
  int ffb = 50, cam = 0, volume = 8;             // native only. ffb: percent of the bridge's ceiling (Adam: "starts at 50%")
  bool line = false;
  std::string look = "film";                     // native only: "film" = shadows, bloom, the film curve; "plain" = the picture as it was
  bool modelSeen = false;                        // false: no choice has ever been saved, so the best car on this machine is offered
  // (Adam: "wire up all cars".) Every class has its own choice now: model is the GT3 seat's, modelBy the others'
  // ("gt4", "hyper", "f1"); a class with no entry gets its first car.
  std::map<std::string, std::string> modelBy;
  std::string model;                             // native only: a downloaded car (data/cars/<key>) for the GT3 seat, "" = the built-in body
  // XINGUS (js/home.js `X`, the browser's own record `wdc.xingus`)
  bool xOn = false;
  // GT MODE (native only): hypercars, GT3 and GT4 on one grid; which of them you drive
  bool gtOn = false;
  std::string gears = "auto";                   // native only: "manual" = the paddles are the gearbox, in any car (Xingus keeps its own, xGears)
  std::string gtClass = "gt3";
  std::string xStyle = "gt3", xGears = "manual", xTrack, xHeil = "heilgrand", xField = "4fun";
  std::string tabFx = "hall";        // MUSIC ROOM: your browser's music through the game (radio.hpp): off, clean, room, hall, cathedral
  int tabVol = 100;                  // MUSIC VOLUME, percent
  // THE IPAD DASH (tools/dashfeed.mjs): the page xanboo78o.github.io/wdc/dash.html, paired by this code.
  // The code is made the first time the game runs and kept.
  bool dash = true;
  std::string dashCode;
  bool easy = false;                 // HANDLING - EASY: Xingus's forgiving handling on your car, in the ordinary game
  int xMinutes = 30;                 // Xingus ENDURANCE: how long the race is, 5 minutes to 6 hours
  int xBots = 0;                                 // 0 = the style's own number
  // THE RACE PAGES (2026-10-10): ENDURANCE is a GT race against the clock (xMinutes), in real handling;
  // leagues = which of hyper / gt3 / gt4 are on the road (bits 0..2); canon = the laps are the circuit's own number
  bool endur = false, canon = false;
  int leagues = -1;
  // A HOT LAP'S GHOST: a driver of a chosen standard, lapping with you, that you cannot touch
  bool ghost = false;
  std::string ghostTier = "medium";
  // WEATHER BY AREA: blobs laid on the map of ONE circuit (zoneTrack). Track metres; rot in radians as drawn (north up).
  struct WxZone { std::string kind; float x = 0, y = 0, r = 100, stretch = 1.6f, rot = 0; };
  bool wxAdv = false;
  std::string zoneTrack;
  std::vector<WxZone> zones;
  void load(const std::string &path);
  void save(const std::string &path) const;
};

// A Xingus STYLE is switches the race understands (js/home.js XSTYLES).
struct XStyle { const char *key, *label, *line, *tune; int rivals; bool derby, stakes, loose; };
const XStyle &xstyle(const std::string &key);

struct LiveRow { int p; std::string col, name, gap; bool you; };
struct LiveTower { bool up = false; std::string track; int lap = 0, laps = 0; std::vector<LiveRow> rows; };

enum class Nav { Up, Down, Left, Right, Ok, Back, Go, X, Y };      // X and Y: the pad's other two, for the weather map

class Home {
 public:
  Home(const std::string &dataDir, const std::string &savePath);
  MenuSave S;
  std::string page = "home";
  bool wantStart = false, wantQuit = false;       // read and clear
  int wxAt = -1;                                  // the weather blob in your hands on the map (-1 = none): the pad's buttons are its
  bool placing() const { return page == "wx" && wxAt >= 0; }
  int click = 0;                                  // read and clear: a switch went on (1), off (2), or a choice was made (3)
  bool dirty = false;                             // the circuit or the car changed: the backdrop should follow
  void input(Nav n);
  // the mouse, in device pixels: hovering lights a card, a click presses what is under it
  void mouse(float x, float y, bool click);
  void draw(Renderer &R, float k, double clock, const LiveTower &live);
  // sets the menu's colours from the THEME setting; true when it is the pro look (homestyle.hpp)
  bool style(double clock = -1) const;
  // what the radio hears, once a frame: turned into the look's pulse, eased (homestyle.hpp STYLE_PULSE / STYLE_BASS)
  void music(int beats, float bass, double clock);
  // Xingus ENDURANCE: seconds the race runs for, or 0 when it is run to a number of laps
  double timeLimit() const {
    if (S.xOn) return S.xStyle == "endurance" ? S.xMinutes * 60.0 : 0;
    return !eventOn && S.endur && S.mode == "race" && S.car == "gt3" ? S.xMinutes * 60.0 : 0;
  }
  // the pro menus stand on a photograph, not a live race (Renderer::photoShow): which one, and the band of the screen it fills
  int photoIndex(double clock, int count) const;
  bool hub() const { return page == "home"; }
  bool overWorld() const { return page == "home"; }   // only HOME has the race behind it
  void say(const std::string &t) { if (!t.empty()) { sayText = t; sayAt = now; } }
  void show(const std::string &name, int keep = 0);
  std::string teamKey() const;                    // the team of the league you are driving, or any you have
  int startSlot(int grid) const;
  std::string dataDir;
  // the downloaded car you chose, if this league has one ("" = the built-in body), and the kind of engine it has
  std::string pack() const;
  bool gt() const { return S.gtOn && S.car == "gt3" && !S.xOn && !eventOn; }   // GT MULTICLASS is what LIGHTS OUT will start
  // THE CAR YOU SIT IN. The setup page picks the car first, then the mode (Adam: "maybe just do car
  // type then mode"): F4, F1, GT3, GT4 or HYPERCAR, and any of them alone on a hot lap. The three GT
  // cars share the GT3 league (its teams, its garage); which of them is yours is S.gtClass.
  bool noTeam() const { return S.xOn || S.car == "gt3" || S.car == "rally"; }      // cars that race without a team picked
  std::string seatCar() const { return eventOn || S.xOn || S.car != "gt3" ? S.car : S.gtClass; }
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
 public:
  // the class your seat is in ("gt3", "gt4", "hyper", "f1", ...), and every downloaded car of a class
  std::string seatClass() const { return S.car == "gt3" ? S.gtClass : S.car; }
  std::vector<std::string> packsOf(const std::string &klass) const { std::vector<std::string> o; for (const Pack &p : packs) if (p.klass == klass) o.push_back(p.key); return o; }
  std::string klassOf(const std::string &key) const { for (const Pack &p : packs) if (p.key == key) return p.klass; return ""; }
 private:
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
  int musicBeats = 0;
  float musicTarget = 0;
  double musicAt = -1;
  std::map<std::string, std::vector<float>> lapTimes;      // circuit/car -> when the map's little car reaches each point of the outline
  const Outline &outline(const std::string &id);
  void drawMap(Renderer &R, float k, float x, float y, float w, float h, const std::string &id, bool car, double clock);
  void build();
  void lightsOut();
  struct Opt { std::string label, key; std::vector<std::pair<std::string, std::string>> opts; };
  std::vector<Opt> setupRows() const;
  static Opt colourRow();              // SETTINGS - COLOUR
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
  // ---- THE RACE PAGES: banners that lead to a page each (home_race.cpp)
  enum { K_HEAD, K_BANNER, K_TRACK, K_MODE, K_RADIO, K_TOGGLE, K_NUM, K_SUN, K_BTN };
  struct Cell {
    int kind = 0; float x = 0, y = 0, w = 0, h = 0;
    std::string label, sub, id; bool on = false, focus = true;
    std::function<void()> ok, left, right, up, down;
    std::function<int()> val; std::function<void(int)> setv;
  };
  std::vector<Cell> cells(float W, float H, const std::function<float(float, const std::string &)> &tw);
  std::vector<Cell> lastCells;                    // as last drawn: what the d-pad walks
  float mW = 1600, mH = 900;
  bool editing = false;                           // a number box: LEFT / RIGHT change it instead of leaving it
  std::string typed; int typedAt = -1;
  bool racePage() const { return page == "setup" || page == "track" || page == "mode" || page == "sky" || page == "level" || page == "details" || page == "wx"; }
  void wxInput(Nav n);
  void move(Nav n);
  std::string modeNow() const;
  void setMode(const std::string &m);
  void syncLeagues();
  void tidy();
  int canonLaps();
  void drawRace(Renderer &R, float k, double clock);
};

}  // namespace xbr
