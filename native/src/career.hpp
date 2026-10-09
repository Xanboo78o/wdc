// career.hpp — CHASING THE WDC: the career, its story and the event modes.
//
// Native only (there is no career in the browser game). Nothing here draws and
// nothing here drives: it reads data/career/*.json, keeps a save, says what an
// event IS (a circuit, a car, a field, a start slot, the light and the weather)
// and, when the race is over, what it MEANT. The rules an event adds — a car
// out every lap, a medal for a lap time — are applied from outside the race:
// race.cpp, the physics and the drivers are untouched.
#pragma once
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "drivers.hpp"
#include "json.hpp"

namespace xbr {

class Race;

struct Objective { std::string kind = "finish", who; int n = 0; double secs = 0; };
struct Rival { std::string key, name, full, col, line; int num = 0; double agg = 0.7, def = 0.7, err = 1, sk[3] = {1, 1, 1}; };
struct Paint { std::string key, name, col, line; };
// One event of a season, or one of the EVENTS page's modes (then `title` is its name and `lock` the career event that opens it).
struct EventDef {
  std::string key, kind, title, tier = "menu", time, weather, who, line, reward, lock;
  std::vector<std::pair<std::string, int>> tracks;      // in order of preference; the int is that circuit's own lap count (0 = `laps`)
  int laps = 3, grid = 0, start = 0, season = -1, index = 0, round = 0;
  bool noDnf = false;
  double fog = 0;
  Objective obj;
};
struct SeasonDef { std::string key, name, car, tag, team, blurb; int promote = 99; std::vector<EventDef> events; };
struct Card { std::string at, cond, who; std::vector<std::string> lines; };
struct Person { std::string col, tag, sub; };
struct EvState {
  int tries = 0, pos = 0, n = 0, medal = 0, pts = 0;
  bool done = false, met = false;
  double lap = 0;
  std::vector<std::pair<std::string, int>> table;        // a round: the points everybody took from your best run of it
};
struct TableRow { std::string name, col; int pts = 0, num = 0; bool you = false; };

// What the game layer needs to start an event.
struct Launch {
  bool on = false, career = false, custom = false, hot = false, xingus = false;
  const EventDef *ev = nullptr;
  std::string track, car, tier, time, weather, kind, model, xstyle, title, sub;
  int laps = 3, grid = 2, slot = 1, season = 0;
  bool noDnf = false, haunted = false;
  bool freePace = false;            // nobody is held near you: the race's own duel trim is off (THE 78 does not wait)
  double seed = 78;
  double medal[3] = {0, 0, 0};      // bronze, silver, gold (s); 0 = not known yet
  std::string ghost;                // the name of the entry to draw as a ghost ("" = nobody)
  int elimLap = 1;                  // ELIMINATION: the lap whose end sends the next car home
  int lastMedal = 0;
};
// What it meant.
struct Outcome {
  bool has = false, valid = false, met = false, career = false, firstDone = false;
  int pos = 0, n = 0, pts = 0, medal = 0, gained = 0, champPos = 0;
  double lap = 0;
  std::string key, kind, title, headline, objective, detail;
  double medalT[3] = {0, 0, 0};     // a hot lap: the bronze, silver and gold it was run against
  std::vector<std::string> unlocked;
};

class Career {
 public:
  void load(const std::string &dataDir);
  // The save. An empty path keeps everything in memory (unattended runs never write).
  void loadState(const std::string &path, bool writable);
  void saveState() const;

  std::vector<SeasonDef> seasons;
  std::vector<EventDef> modes;
  std::vector<Rival> cast;
  Rival ghost;
  std::vector<Paint> paints;
  std::vector<Card> cards;
  std::map<std::string, Person> people;
  std::vector<std::string> ticker;
  std::vector<int> points;
  std::string dataDir;

  // ---- progress
  const EvState &state(const std::string &key) const;
  bool seasonOpen(int s) const;
  bool seasonDone(int s) const;                          // every event run
  bool unlocked(const EventDef &e) const;
  bool modeOpen(const EventDef &m) const;
  const EventDef *next() const;                          // the event the career is waiting for (null = all done)
  const EventDef *find(const std::string &key) const;
  int currentSeason() const;
  std::vector<TableRow> table(int season) const;         // sorted, you included
  int place(int season) const;                           // your position in it (1 = top)
  std::string trackFor(const EventDef &e, int *laps = nullptr) const;   // the first of its circuits that is on this machine
  std::string trackName(const std::string &key) const;
  std::string objText(const EventDef &e, const Launch *L = nullptr) const;
  const Rival *rival(const std::string &key) const;
  std::string paint = "primer", model;                   // your car's colour; the downloaded body your GT3 seat has earned ("" = the built-in)
  std::vector<std::string> owned{"primer"};
  const Paint &paintNow() const;
  bool owns(const std::string &paintKey) const;
  std::vector<std::string> trophies;
  bool medalTimes(const std::string &track, const std::string &cls, double ideal, double out[3]) const;

  // ---- the story
  std::vector<int> pending(const std::string &at, bool met, bool champ) const;   // unseen cards for this moment
  void seen(int card);
  std::vector<int> soFar() const;                        // every card seen, in order
  bool introSeen() const;

  // ---- an event, start to finish
  Launch L;
  // `menuTrack` / `menuCar` / `menuTier`: what RACE SETUP is set to, for a mode that leaves those to you
  bool prepare(const EventDef &e, bool career, const std::string &menuTrack, const std::string &menuCar, const std::string &menuTier);
  void fieldUp() const;                                  // hand the grid its field (drivers.hpp setCustomField)
  void started(Race *race);                              // once the session exists: mark the ghost
  // every frame of a race: the rules an event adds from outside. Returns a line for the middle of the screen ("" = none).
  std::string tick(Race &race);
  std::string lapSet(double best, double ideal);         // a hot lap: your best just changed
  bool wantsEnd = false;                                 // the event has decided the session is over (you were sent home)
  // the race is over (or you left a hot lap): work out what it meant, keep it. `race` null = a hot lap.
  const Outcome &finish(Race *race, bool hasBest, double best, double ideal);
  Outcome out;
  void clear() { L = Launch{}; wantsEnd = false; }

 private:
  std::map<std::string, EvState> st;
  std::vector<int> seenCards;
  std::string savePath;
  Json laps;
  void reward(const std::string &r, std::vector<std::string> &said);
};

}  // namespace xbr
