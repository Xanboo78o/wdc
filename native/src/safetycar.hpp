// safetycar.hpp — race control (js/safetycar.js): the safety car, the virtual
// one, the red flag, the restarts, the yellows and the blues. Decided in a room
// above the pit lane; nothing here knows what a renderer is.
//
// In the FIA's own order of severity: YELLOW / DOUBLE YELLOW per marshal
// sector; VSC (a minimum time, e.vd is the margin in metres); SAFETY CAR (a
// real car out of the pit exit, queue, unlap, "IN THIS LAP", the leader sets
// the restart); RED FLAG (everyone into the lane, then a standing restart).
// And for YOU only: overtaking under any of them, the delta, three blue flags,
// speeding at the pit entry, an unsafe release.
#pragma once
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "entry.hpp"

namespace xbr {

class Race;

constexpr double SC_F = 0.60, SC_CAP = 55;
constexpr double DELTA_F = 0.76, VSC_F = 0.70;

enum class RcMode { Green, Vsc, VscEnd, Sc, Red };
enum class RcPhase { None, Deploy, Lead, In, Restart };
const char *rcModeName(RcMode m);       // "green" "vsc" "vscEnd" "sc" "red"
const char *rcPhaseName(RcPhase p);     // "" "deploy" "lead" "in" "restart"

struct Incident { std::string kind; Entry *e = nullptr; double s = 0, t = 0, clearAt = 0; bool onTrack = false; };
// What the renderer draws besides the safety car: the recovery truck.
struct Truck { double x = 0, y = 0, hdg = 0; bool lights = true, towing = false; };
struct SafetyCar {
  Car car;                              // a GT body with a physics record: contact with it is real
  double s = 0, lat = 0, v = 0, prog = 0;
  int i = 0;
  bool out = false, lights = false, inLane = false;
};

class Director {
 public:
  void init(Race *race, bool on, Mulberry rng);

  Race *race = nullptr;
  bool on = false;
  Mulberry rng;
  RcMode mode = RcMode::Green;
  RcPhase phase = RcPhase::None, phase0 = RcPhase::None;
  double since = 0, phaseAt = 0;
  std::vector<std::shared_ptr<Incident>> incidents;
  struct Yellow { int lvl = 0; double until = 0; bool set = false; };
  std::vector<Yellow> yellow;           // per marshal sector
  struct Count { int sc = 0, vsc = 0, red = 0, restarts = 0, pens = 0, pitsUnder = 0; } count;
  int drsFrom = 0;                      // DRS closed until the leader starts this lap
  double greenAt = -99;
  struct Hist { RcMode mode; double t0, t1; int lap; };   // t1 NaN = still running
  std::vector<Hist> hist;
  int nSec = 4;
  double secLen = 0;
  bool hasPit = false;
  SafetyCar sc;
  int scHits = 0;
  std::vector<Truck> vehicles;          // the trucks on the circuit right now
  int scLaps = 1;
  double scFrom = 0;
  bool unlapCalled = false;
  double goD = 0;
  double parkedAt = NaN;

  // ---- what everyone else asks -----------------------------------------------
  bool neutral() const { return mode != RcMode::Green; }
  int sector(double s) const;
  int yellowAt(double s) const;
  double vLine(int i) const;
  double scSpeed(int i) const { return std::min(vLine(i) * SC_F, SC_CAP); }
  Entry *leader() const;
  std::string tag(const Entry &e) const;
  // The flag YOU are looking at: "chequered" "red" "sc" "vsc" "vscEnd"
  // "dyellow" "yellow" "blue" "green", or "" for none.
  const char *flagFor(const Entry *e) const;
  // The delta a car is showing, s: + legal, - too fast. NaN when no minimum time applies.
  double deltaFor(const Entry *e) const;
  double deltaF(const Entry &e) const;
  bool noAttack(const Entry &e) const;
  bool noDefend(const Entry &e) const { return on && (neutral() || e.blue != nullptr); }

  // ---- called by the race ----------------------------------------------------
  void incident(const char *kind, Entry *e);
  void flag(double s, int lvl, double secs);
  void debris(double s, bool wheel, bool first);    // a loose piece lying on the road at s (Race::setHazards): called, then kept shown
  double wantBias(Entry &e, double want, double lineOff, double lim);
  void limit(Entry &e, DriveCtx &ctx);
  void tick(double dt);
  void pitEntry(Entry &e);
  void released(Entry &e);
  void penalise(Entry *e, const char *kind);

 private:
  void rc(const std::string &text, const char *code, Entry *e = nullptr);
  void escalate(RcMode want);
  void begin(RcMode m);
  void startVSC();
  void startSC();
  void startRed();
  void goGreen(const char *why = "TRACK CLEAR");
  void graceAll();
  void opportunists(double p);
  bool clear() const;
  void scTick();
  void moveSC(double dt);
  void jobTick(double dt);
  void queueTick();
  void redTick();
  void restartStanding();
  void blueTick();
  void youTick();
  void rainTick();

  struct Job {
    Entry *e = nullptr; std::shared_ptr<Incident> inc; int st = 0;   // 0 wait, 1 out, 2 hook, 3 tow, 4 done
    double t = 0; bool hasTruck = false; Truck truck; double gateX = 0, gateY = 0, atX = 0, atY = 0;
  };
  std::vector<Job> jobs;
  struct RedRow { Entry *e; int lap; bool finished; };
  std::vector<RedRow> redOrder;
  struct Owed { Entry *o; double t; const char *rule; };
  std::vector<Owed> owed;
  long long sub = 0;
  double wet0 = NaN, rainT = 0, dt4 = 0;
  bool rainRed = false;
};

}  // namespace xbr
