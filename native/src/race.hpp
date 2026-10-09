// race.hpp — the session (js/race.js). Twenty-two cars, a rulebook, and no
// renderer: `xbr-race` runs whole races headless, which is the only way to find
// out whether a grid of twenty-two actually races.
//
// What lives here and NOT in the autopilot: anything that needs to know the
// running order. A driver knows how to drive; only the session knows who is
// ahead, who is being caught, and whose fault the contact was.
//
// The field names are the JS's. js/race.js is the reference and carries the
// reasons, at length; this file carries pointers to them.
#pragma once
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "collide.hpp"
#include "entry.hpp"
#include "grid.hpp"
#include "pitstop.hpp"
#include "safetycar.hpp"
#include "xingus.hpp"

namespace xbr {

// THE CONSTANTS A THINKING DRIVER IS MADE OF (brain.cpp, race.cpp `close`). The values here
// are the ones the drivers LEARNED: tools/brainlearn.py races them against themselves, headless,
// and keeps what overtakes most without wrecking the field. XBR_BT="lane=2.9,riskW=4" overrides.
struct BrainTune {
  double lane = 2.7;        // m beside the car ahead: where a pass is driven
  double passW = 14;        // what finishing ahead of a car that was ahead is worth, in metres of road
  double defW = 14;         // what being passed costs
  double riskW = 3.0;       // metres a unit of imagined risk costs
  double switchC = 1.5;     // metres changing its mind costs
  double simPen = 0.07;     // imagined: speed lost off the line in a corner
  double capPen = 0.10;     // real: how much slower an off-line car arrives
  double hwBase = 4.0, hwK = 0.14;   // following distance, m and s
  double gate = 2.2;        // m: a car further across than this is not in my lane
  double closeAfter = 12;   // s after the lights before anybody follows closely
  double lateK = 1.5;       // how much speed a late brake is imagined to buy
  double confRisk = 2.0;    // risk of an imagined door-to-door moment
  double horizonK = 1.0;    // every driver's look-ahead, scaled
};
BrainTune &brainTune();

// SUPERCASUAL's three OVERTAKES submodes (js/autopilot.js BATTLE).
struct Battle { const char *key, *name; double lo, hi, aggression, defence, moveGap, lunge, band, mistakes, consistency; };
const Battle *battleFor(const std::string &key);     // "easy" | "medium" | "hard"; anything else = null

enum class RaceState { Grid, Formation, Green, Finish, Over };
const char *raceStateName(RaceState s);              // "grid" "formation" "green" "finish" "over"

// The race-control feed. `car` is an entry index, -1 for nobody; `code` may be empty.
struct RaceEvent { double t = 0; std::string kind, text; int car = -1; std::string code; };
struct Cheer { double t = 0, at = 0; int idx = 0; std::string name; int pos = 0, lap = 0; };

// The ground as a surface (js/terrain.js): the road's height at s plus the
// banking's own shape across it. `roadY` empty = a flat circuit.
class Ground {
 public:
  Ground(const Track &track, std::function<double(double)> roadY);
  double h(double s, double lat) const;
  void under(const Car &car, const Proj &pr, Gnd &g) const;
  double lift(const Car &car, const Proj &pr) const;   // m/s2, + = the ground is leaving

 private:
  const Track &t;
  std::function<double(double)> roadY;
  std::vector<float> table;
};
// A road's height from its gradient alone (only differences of it are used).
std::function<double(double)> heightFromSlope(const Track &track, const std::function<double(double)> &slopeAt);

struct RaceOptions {
  const Track *track = nullptr;
  Lines *lines = nullptr;
  Spec *spec = nullptr;
  std::vector<Slot> slots;
  int laps = 5, grid = 22, playerGrid = 10;
  std::string tier = "medium";
  double seed = 1;
  bool player = true, pits = true, noDnf = false;
  bool hasOrder = false;               // QUALIFYING hands over `order`: grid slot -> driver index, -1 for you
  std::vector<int> order;
  std::string battle;                  // "" = none
  bool duel = true, drs = true, rules = true, standIn = false, sideLock = true, styles = true;
  const Team *playerTeam = nullptr;
  bool opening = true;
  // MULTICLASS (not in the JS): one seat per grid slot, front to back. Empty =
  // one class, everybody in `spec` on `lines`, exactly as the JS runs it.
  struct Seat { Spec *spec = nullptr; Lines *lines = nullptr; int klass = 0; };
  std::vector<Seat> seats;
  // RACING REALISM (not in the JS; Adam 2026-10-09). The game turns it on; a
  // harness leaves it off unless asked, so the parity gate still compares like with like.
  bool real = false;
  // XINGUS. The JS reads these off the page's address when it has one; Node has
  // none, and these are the values Node gets.
  bool xingus = false;
  struct X {
    std::string car = "gt";            // "gt" | "rally"
    bool solo = false, derby = false, loose = false, stakes = false;
    bool joker = true;                 // false: a fork is an open road and nobody owes a lap of it
    bool rolling = true;               // false: an oval starts from the grid
  } xopt;
};

class Race {
 public:
  explicit Race(const RaceOptions &o);
  Race(const Race &) = delete;
  Race &operator=(const Race &) = delete;

  // One substep. `in` null = nobody at your wheel (pedals up, rack left alone).
  void tick(double dt, const PlayerInput *in = nullptr);

  const Track *track;
  Lines *lines;
  Spec *spec;
  bool standIn, sideLock, styles, openOn;
  bool xingus, xsolo, derby, loose, xstakes;
  std::string xcar;
  struct Fork { const Detour *d; std::vector<std::array<double, 2>> P; double len = 0; std::vector<double> cum; };
  std::vector<Fork> detours;
  bool jokerRule = false;
  bool stock = false;
  bool real = false;                   // RaceOptions.real
  std::map<const Spec *, std::unique_ptr<Lines>> carLines;      // a better or a worse car (proSpecAt) has a racing line solved for it
  // THE THINKING DRIVER (brain.cpp). cast(): who is who, once. think(): several times a
  // second a driver imagines the next few seconds for each thing it could do, with the
  // cars it can SEE, and picks. aware(): does `e` know `o` is there?
  struct Thought { double want = 0, lunge = 0, pressure = 0, cap = NaN; };      // cap: the speed its chosen future needs in the next second (NaN = none)
  void cast();
  Thought think(Entry &e, int i, double lim, double lineOff, bool noAtk, bool noDef);
  bool aware(Entry &e, const Entry &o);
  const char *brainTag(const Entry &e) const;      // "SMART - ZEN", or "" for an ordinary racer
  bool multi = false;                  // MULTICLASS: the grid was handed seats (RaceOptions.seats)
  int stockStint = 0;                  // laps a set of tyres is good for (this.stock.stint)
  double openEnd = 600;
  bool duel, drsRule;
  std::vector<Cheer> cheers;           // YOUR overtakes that stuck: read and clear as you like
  bool noDnf;
  int laps;
  double peak;
  double time = 0;
  RaceState state = RaceState::Grid;
  double lights = 3.2;                 // s until they go out
  int safety = 0;                      // non-zero while the race is neutralised
  Lane lane;
  std::vector<Slot> slots;
  bool pits;
  std::deque<RaceEvent> events;        // the last 300
  std::function<void(const RaceEvent &)> onEvent;   // every one, as it is logged
  long long sub = 0;
  const Battle *battle = nullptr;
  double bandAt = 0, vRef = 0;
  std::deque<Entry> entries;           // never resized after the constructor: pointers into it are stable
  Entry *me = nullptr;
  std::vector<Entry *> standings;
  bool rolling = false;
  Entry *formLead = nullptr;
  bool duelOn = false;
  Director rc;
  Mulberry sideRng;
  int passes = 0, sideFights = 0;
  // Not in the JS: every car-to-car (or car-to-safety-car) touch, and when the
  // first one was (NaN = none yet). A touch is where two builds of this sim
  // stop agreeing to the nanometre, so the trace gate needs to know.
  int carHits = 0;
  double firstHitAt = NaN;
  double greenT = 0, meOffAt = NaN, formOutAt = NaN, finishAt = 0, gridAt = 0;
  double seed;

  // The road's gradient at lap distance s (rise over run along +s). The game
  // hands it over once; a harness never does, and gets the banking on a flat
  // road. Use setSlopeAt to CHANGE it after the first tick.
  std::function<double(double)> slopeAt;
  void setSlopeAt(std::function<double(double)> f) { slopeAt = std::move(f); gnd_.reset(); crestOk_ = false; }
  const Ground &ground();

  double progress(const Entry &e) const { return (e.lap + (e.crossed0 ? 1 : 0)) * track->length + e.proj.s; }
  void log(const char *kind, const std::string &text, const Entry *e = nullptr, const char *code = nullptr);
  void order();
  bool brakingZone(double s, double look) const;
  double insideAhead(double s, double look) const;

 private:
  void band();
  Entry *laneAhead(Entry &e, double gate);
  void rankAroundMe(double pMe);
  void duelTrim(Entry &e, double lo, double hi);
  void neighbours();
  const std::vector<float> *crests();
  void wreckStep(Entry &e, double dt);
  SideFight *sideBySide(Entry &e, bool blocked);
  void resolveSide(Entry &e);
  void unlock(Entry &e);
  void racecraft(Entry &e);
  void drsTick(Entry &e, double prev, bool racing);
  void cheerTick();
  void carContact();

  std::unique_ptr<Ground> gnd_;
  bool gndSlope_ = false;
  bool crestOk_ = false, crestAny_ = false;
  std::vector<float> crest_;
  bool formSaid_ = false;
};

}  // namespace xbr
