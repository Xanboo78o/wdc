// engineer_main.cpp — xbr-engineer: a whole race, headless, with the engineer on the pit
// wall and every word he says printed beside the moment he said it. A driver sits in YOUR
// seat (the race's stand-in), so this is what he would have said to somebody racing.
//
//   xbr-engineer [track] [class] [laps] [grid] [--player SLOT] [--seed N] [--ask "T:question" ...]
//
// It is how his timing is judged without anybody driving: what he says in the first
// minute, how often he talks, and whether a number he quotes is the race's.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "engineer.hpp"
#include "race.hpp"

using namespace xbr;

int main(int argc, char **argv) {
  std::string dataDir = "../data";
  std::vector<std::string> a;
  std::vector<std::pair<double, std::string>> asks;
  int playerSlot = 10; double seed = 1, maxT = 0;
  for (int i = 1; i < argc; i++) {
    const std::string s = argv[i];
    const auto val = [&]() -> const char * { if (i + 1 >= argc) { std::fprintf(stderr, "xbr-engineer: %s needs a value\n", s.c_str()); std::exit(2); } return argv[++i]; };
    if (s == "--data") dataDir = val();
    else if (s == "--player") playerSlot = std::atoi(val());
    else if (s == "--seed") seed = std::atof(val());
    else if (s == "--time") maxT = std::atof(val());
    else if (s == "--ask") { const std::string v = val(); const size_t c = v.find(':'); if (c == std::string::npos) { std::fprintf(stderr, "xbr-engineer: --ask is SECONDS:question\n"); return 2; } asks.push_back({std::atof(v.substr(0, c).c_str()), v.substr(c + 1)}); }
    else if (s.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr-engineer: unknown flag %s\n", s.c_str()); return 2; }
    else a.push_back(s);
  }
  if (a.size() > 4) { std::fprintf(stderr, "xbr-engineer: too many arguments\n"); return 2; }
  const std::string key = a.size() > 0 ? a[0] : "monza", cls = a.size() > 1 ? a[1] : "f1";
  const int laps = a.size() > 2 ? std::atoi(a[2].c_str()) : 3, grid = a.size() > 3 ? std::atoi(a[3].c_str()) : 22;
  if (!hasCarSpec(cls) || laps < 1 || grid < 2 || playerSlot < 1 || playerSlot > grid) { std::fprintf(stderr, "xbr-engineer: bad class, laps, grid or slot\n"); return 2; }

  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-engineer: %s\n", e.what()); return 1; }
  Spec &spec = carSpec(cls);
  Lines lines = buildLines(track, spec);
  RaceOptions o;
  o.track = &track; o.lines = &lines; o.spec = &spec;
  o.slots = gridSlots(track, grid);
  o.laps = laps; o.grid = grid; o.seed = seed;
  o.player = true; o.playerGrid = playerSlot; o.standIn = true;
  Race race(o);
  if (!race.me) { std::fprintf(stderr, "xbr-engineer: the race has no car for you\n"); return 1; }

  Engineer eng;
  int said = 0, firstMinute = 0;
  eng.say = [&](const std::string &text, int pri) {
    said++;
    if (race.state == RaceState::Green && race.time - race.greenT < 60) firstMinute++;
    std::printf("%7.1fs  lap %d  P%-2d  [%d] %s\n", race.time, race.me->lap + 1, race.me->pos, pri, text.c_str());
  };
  eng.begin(&race);
  // a driver in your seat, as the game's attract mode seats one (game_main.cpp raceStep)
  Autopilot pilot(track, lines, spec, peakSlip(spec), &race.me->driver);
  PlayerInput pi;
  std::printf("%s  %s  %d laps  %d cars  you start P%d\n", track.key.c_str(), cls.c_str(), laps, grid, playerSlot);
  double sec = 0;
  while (race.state != RaceState::Over && (maxT <= 0 || race.time < maxT) && race.time < 7200) {
    Entry &me = *race.me;
    pilot.drive(me.car, me.proj, FIXED_DT, me.hasCtx ? &me.ctx : nullptr);
    if (race.state == RaceState::Grid) { me.car.throttle = 0; me.car.brake = 1; }
    pi.throttle = me.car.throttle; pi.brake = me.car.brake; pi.delta = me.car.delta;
    race.tick(FIXED_DT, &pi);
    sec += FIXED_DT;
    if (sec >= 1.0 / 60) { eng.tick(sec); sec = 0; }
    for (auto &q : asks) if (q.first >= 0 && race.time >= q.first) {
      const std::string r = eng.hear(q.second);
      std::printf("%7.1fs  YOU: %s\n          HIM: %s\n", race.time, q.second.c_str(), r.empty() ? "(one for the model)" : r.c_str());
      if (r.empty()) std::printf("          FACTS: %s\n", eng.facts().c_str());
      q.first = -1;
    }
  }
  const double green = race.time - race.greenT;
  std::printf("-- %d lines in %.0f s of racing (one every %.0f s); %d in the first minute after the lights; finished P%d\n",
              said, green, said ? green / said : 0.0, firstMinute, race.me->pos);
  return 0;
}
