// engineer.hpp — THE MAN ON YOUR PIT WALL. (Adam, 2026-10-10: "its like im a ferarri driver
// (shit strategy) like off the start 'OH THAT GUY IS 0.1 AHEAD HAMMER TIME PUSH IT TO THE MAX'
// sir, that is because we just started ... make him loud, confident, smart ... he needs to be
// able to answer anything ... coxswain talk n stuff, he needs to be ma frein".)
//
// This is his HEAD and nothing else: it reads the race and decides what is worth saying. It
// never makes a sound (pitwall.hpp is his mouth and his ears) and it never draws, so a
// headless race can run him and print every word (race_main --engineer).
//
// What was wrong with the browser's one (js/engineer.js), and is not carried over:
//   - "hammer time" was allowed whenever three laps or fewer remained, so a three-lap race
//     opened with it, at a gap that only existed because the grid is 8 m apart.
//   - "closing" was one frame's gap against the last one.
// Here nothing about pace is said until the field has SETTLED (most of a lap after the
// lights, no safety car, nobody in the pits), and "catching" is a rate measured over twenty
// seconds and spoken in tenths a lap.
//
// Everything with a number in it is answered here, from the race, exactly. hear() returns ""
// for whatever it cannot compute; that goes to the language model with facts() beside it.
#pragma once
#include <functional>
#include <map>
#include <string>
#include <vector>

#include "race.hpp"

namespace xbr {

class Engineer {
 public:
  // A line for the radio. pri: 2 = now (a flag, a penalty, box), 1 = a call, 0 = talk that
  // is dropped if he is already speaking or you are.
  std::function<void(const std::string &, int)> say;
  std::string driver = "Xander";

  void begin(Race *race);                      // a new race; null = no race
  void tick(double dt);                        // once a frame, with the frame's seconds of race
  std::string hear(const std::string &raw);    // what you said; "" = one for the model
  std::string facts() const;                   // what the model is told is true right now

 private:
  Race *r = nullptr;
  Entry *me = nullptr;
  std::vector<RaceEvent> inbox;
  struct Later { double at; std::function<void()> fn; };
  std::vector<Later> pending;
  std::map<std::string, double> cool;
  std::map<int, double> near;                  // car idx -> the last race time it was within 10 m of you
  // where every car was, once a second, for the last two minutes: (race time, metres run). A gap is read off it
  // the way timing reads it — how long ago the car ahead was where you are now — not guessed from your speed.
  std::map<int, std::vector<std::pair<double, double>>> trail;
  double whenAt(const Entry &e, double progress) const;       // the race time `e` was at `progress` (NaN = before the trail)
  // the gap ahead and behind, once a second, for the last half minute
  struct Trend { const Entry *who = nullptr; std::vector<double> g; void reset(const Entry *e) { who = e; g.clear(); } };
  Trend up, down;
  double sampleAt = 0, quietSince = 0, tailT = 0, fuel = 0, fuelLap = 0, lapWear = -1, wearPerLap = 0;
  const Entry *tailOn = nullptr, *hammered = nullptr;
  int lastLap = 0, startPos = 0, stoppedFor = -1, cheers = 0, talkN = 0, coxN = 0, tyreSaid = 0;
  double lastCheer = -99;
  std::vector<std::string> cheerQ;
  bool gridSaid = false, homeSaid = false, doneSaid = false, settledSaid = false;
  double calmUntil = 0;                        // nothing about pace before this (the start, a restart, a pit stop)

  void call(const std::string &text, int pri = 1);
  bool ready(const std::string &key, double gap);
  void after(double sec, std::function<void()> fn) { pending.push_back({r->time + sec, std::move(fn)}); }
  bool settled() const;
  int lapsLeft() const { return r->laps - me->lap; }
  double wear() const;
  double gapTo(const Entry &o) const;
  double lapGuess() const;
  double rate(const Trend &t) const;           // seconds a lap the gap is SHRINKING by (NaN = not known yet)
  Entry *ahead() const;
  Entry *behind() const;
  const Corner *nextCorner() const;
  double spareLaps() const;
  void sample(double dt);
  void lapTick();
  void strategy();
  void company(double dt);
  void event(const RaceEvent &ev);
  void cheerSay();
  Entry *driverIn(const std::string &text) const;
  std::string gapLine() const, tyreLine() const, fuelLine() const, paceLine() const, damageLine() const, boxAdvice() const;
};

}  // namespace xbr
