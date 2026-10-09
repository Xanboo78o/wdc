// entry.hpp — one car in a race: everything js/race.js, js/pitstop.js and
// js/safetycar.js hang on a race entry. The JS attaches these ad hoc; here they
// are one struct, with the same names.
//
// How "not set" is kept (the JS's null / undefined), because racecraft tests it:
//   a number    NaN            (e.hold ?? 1, e.garageT == null, e.bestLap)
//   a pointer   nullptr        (e.ahead, e.blue, e.drsFor)
//   tri-state   -1             (o.aheadOfMe, o.youAhead: -1 unset, 0 false, 1 true)
// A field the JS reads as `x || d` is a plain number: 0 is "not set" there too.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "driver.hpp"
#include "drivers.hpp"
#include "physics.hpp"
#include "track.hpp"
#include "world.hpp"

namespace xbr {

struct Entry;

enum class PitPhase { Undef, None, Approach, Lane, Service, Exit };
const char *pitPhaseName(PitPhase p);

// SIDE BY SIDE: a locked pair (js/race.js sideBySide). `cap` NaN = null.
struct SideFight { bool on = false; Entry *o = nullptr; double lane = 0, until = 0; bool done = false; double cap = NaN; bool lose = false; };
// The player's own contacts, handed up for the rumble and the toast. The race
// never clears it: whoever shows it sets `has` back to false.
struct Bump { bool has = false; const char *what = ""; double closing = 0, harm = 0; const char *part = ""; Entry *by = nullptr; };
struct Recover { bool on = false; double t = 0, x0 = 0, y0 = 0, h0 = 0, toX = 0, toY = 0, toHdg = 0; };
struct OnDetour { bool on = false; int d = 0, i = 0, from = 0; };

struct Entry {
  Car car;
  bool hasDriver = false;            // false = the JS's `driver: null` (you, without a stand-in)
  Driver driver;
  std::unique_ptr<Autopilot> drive;  // null for YOUR car, stand-in or not
  bool isPlayer = false;
  bool ghost = false;                // drawing only: this car is drawn as a ghost (THE 78). The race never reads it.
  int idx = 0, box = 0, garage = -1;
  std::string name, col;
  int num = 0;
  const Team *team = nullptr;
  bool mate = false;                 // your teammate: the other car of your team
  double biasS = 0;
  bool merge = true;
  double atkSide = 0, atkAt = -99;
  Entry *atkOn = nullptr;
  Proj proj;
  int hint = 0;
  int lap = 0, gridPos = 0, pos = 0;
  bool crossed0 = false, pastHalf = false;
  double lapStart = 0, lastLap = NaN, bestLap = NaN;
  Entry *ahead = nullptr, *behind = nullptr;
  double aheadGapT = 99, behindGapT = 99;
  bool hasCtx = false;               // false until racecraft has run for this car
  DriveCtx ctx;                      // speedCap / obstDs / obstV NaN = null
  double lastMove = 0, movedAt = -99;
  int warnings = 0;
  double penalty = 0;
  bool offNow = false;
  double lastLimit = -99;
  int contacts = 0;
  bool retired = false, finished = false;
  double finishTime = NaN;
  Bump bump;
  bool pitRequest = false, inPit = false;
  double pitTimer = 0;
  int pitStops = 0;
  double stuck = 0;
  bool opening = true, zip = false;
  int jokers = 0;
  OnDetour det;
  double jokerLap = 0;
  Recover recover;
  double duelF = NaN, build = 0;
  int seg = 0, moveSeg = -1;
  bool inZone = false;
  const DrsZone *drsFor = nullptr;
  bool drsOk = false, drsIn = false;

  // ---- attached later by race.js -------------------------------------------------
  int rank = 0;
  double gapMe = 0;
  double hold = NaN, roadHold = NaN, stockHold = NaN;
  double lastPass = 0;
  int passes = 0;
  SideFight side;
  Entry *buildOn = nullptr;
  double tryT = 0;
  int openLap = 0;
  double zipUntil = 0;
  bool rejoin = false;
  double goRound = NaN, goRoundAt = 0;
  double lanePh = NaN, laneF = 0;
  double restT = 0;
  bool atRest = false, flying = false;
  int stockStops = -1;               // -1 = undefined: the first stock tick sets it
  double stintM = 0;
  int stockSaid = 0;
  bool jumped = false, onFork = false, wingWas = false;
  Entry *hitBy = nullptr;
  double hitAt = 0;
  int wrecks = 0;
  bool cool = false, parked = false;
  double garageT = NaN, garageS = 0, garageLat = 0, garageHdg = 0;
  double lastBlame = 0;
  double stopT = 0;
  bool stopCalled = false;
  int aheadOfMe = -1;
  double cheerAt = NaN;              // race._cand: when it went from ahead of you to behind
  Gnd gnd;                           // car.gnd: the plane under its four wheels
  // the formation (an oval's rolling start)
  int formK = 0, formR = 0;
  double formAlong = 0, formErr = NaN, formSeen = NaN, fs = NaN;

  // ---- js/pitstop.js --------------------------------------------------------------
  PitPhase pitPhase = PitPhase::Undef;
  std::vector<std::string> pitJobs;
  double entryV = NaN, penIn = NaN, penServed = 0, relRoll = NaN;
  bool redFixed = false, unsafe = false;
  int driveThru = 0;

  // ---- js/safetycar.js ------------------------------------------------------------
  bool queued = false, unlap = false, rcCross = false, holdLine = false, went = false;
  double vd = 0, deltaBad = 0;
  bool deltaWarned = false;
  const char *pitUnder = "";
  double pitUnderT = 0;
  double unlapSide = 0, unlapSc = 0, unlapAt = 0;
  int unlapped = 0;
  Entry *blue = nullptr;
  double blueGap = 0, blueSide = 0, blueAt = 0;
  double rcS = NaN;
  bool dtConverted = false, recovered = false;
  int youAhead = -1;
  Entry *blueFor = nullptr;
  int blueN = 0, blueSec = 0;
  double blueOff = 0, tenAt = 0;
  bool wasQueued = false;
};

}  // namespace xbr
