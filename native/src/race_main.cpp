// xbr-race — tools/race.mjs in C++: does a grid of twenty-two actually RACE?
// No window, no graphics: the sim core and the race layer, nothing else.
//
//   xbr-race [track] [class] [laps] [grid] [tier] [flags]
//
// With no flags it is tools/race.mjs: seed 7, nobody at the wheel, pits and
// rules on, and the same table. The flags reach the rest of the Race options:
//
//   --seed N            --pits 0|1         --rules 0|1        --duel 0|1
//   --drs 0|1           --battle easy|medium|hard             --nodnf
//   --player N          you, on grid slot N (nobody at the wheel unless --input)
//   --standin           a bot's racecraft at your wheel (still your pedals)
//   --input park|floor  your pedals: none at all, or flat out and dead straight
//   --xingus gt|rally   --xsolo  --xderby  --xloose  --xstakes
//   --rolling 0|1       --joker 0|1        --aero             --wet W (0..1)
//   --rainat T          a downpour arrives T s in (wetness -> 1): a red flag, 15 s later
//   --trace [every]     one row per car every `every` s of race time (default 1):
//                       T, car, x, y (to the nanometre), m/s, lap, pos, damage,
//                       R(etired) P(it); then every race-control event. Its
//                       reference is native/check/ref-race.mjs, and
//                       native/check.sh diffs the two.
//   --time T            stop after T s (trace default 60; table: laps*260+90)
//   --probe C:FROM:TO   with --trace: car C's whole state (C = all: every car's)
//                       EVERY substep between FROM and TO s, instead of the rows,
//                       each number in its shortest exact form. For bisecting which
//                       field parts company first when a trace fails.
//   --data DIR
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "race.hpp"

using namespace xbr;

static std::string fmt(double s) {
  if (std::isnan(s)) return "--.---";
  char buf[64];
  std::snprintf(buf, sizeof buf, "%d:%06.3f", (int)std::floor(s / 60), std::fmod(s, 60));
  return buf;
}
// String.padEnd / padStart count UTF-16 units; the names here are ASCII.
static std::string padEnd(std::string s, size_t n) { while (s.size() < n) s += ' '; return s; }

int main(int argc, char **argv) {
  std::vector<std::string> a;
  std::string dataDir = "data", battle, input = "park", xcar;
  double seed = 7, every = 1, maxTime = -1, wet = 0, rainAt = -1;
  int playerSlot = 0, probeCar = -1;
  double probeFrom = 0, probeTo = 0;
  bool probeOn = false;
  bool pits = true, rules = true, duel = true, drs = true, noDnf = false, standIn = false, trace = false, aero = false;
  bool xsolo = false, xderby = false, xloose = false, xstakes = false, rolling = true, joker = true;
  const auto isNum = [](const char *s) { char *e; std::strtod(s, &e); return e != s && *e == 0; };
  for (int i = 1; i < argc; i++) {
    const std::string s = argv[i];
    const auto val = [&]() -> const char * {
      if (i + 1 >= argc) { std::fprintf(stderr, "xbr-race: %s needs a value\n", s.c_str()); std::exit(2); }
      return argv[++i];
    };
    const auto flag01 = [&]() { const std::string v = val(); if (v != "0" && v != "1") { std::fprintf(stderr, "xbr-race: %s takes 0 or 1\n", s.c_str()); std::exit(2); } return v == "1"; };
    if (s == "--data") dataDir = val();
    else if (s == "--seed") seed = std::atof(val());
    else if (s == "--pits") pits = flag01();
    else if (s == "--rules") rules = flag01();
    else if (s == "--duel") duel = flag01();
    else if (s == "--drs") drs = flag01();
    else if (s == "--rolling") rolling = flag01();
    else if (s == "--joker") joker = flag01();
    else if (s == "--battle") battle = val();
    else if (s == "--nodnf") noDnf = true;
    else if (s == "--player") playerSlot = std::atoi(val());
    else if (s == "--standin") standIn = true;
    else if (s == "--input") input = val();
    else if (s == "--xingus") xcar = val();
    else if (s == "--xsolo") xsolo = true;
    else if (s == "--xderby") xderby = true;
    else if (s == "--xloose") xloose = true;
    else if (s == "--xstakes") xstakes = true;
    else if (s == "--aero") aero = true;
    else if (s == "--wet") wet = std::atof(val());
    else if (s == "--rainat") rainAt = std::atof(val());
    else if (s == "--time") maxTime = std::atof(val());
    else if (s == "--probe") {
      const char *v = val();
      probeOn = true;
      if (!std::strncmp(v, "all:", 4)) { probeCar = -1; if (std::sscanf(v + 4, "%lf:%lf", &probeFrom, &probeTo) != 2) probeOn = false; }
      else if (std::sscanf(v, "%d:%lf:%lf", &probeCar, &probeFrom, &probeTo) != 3 || probeCar < 0) probeOn = false;
      if (!probeOn) { std::fprintf(stderr, "xbr-race: --probe is CAR:FROM:TO or all:FROM:TO\n"); return 2; }
    }
    else if (s == "--trace") { trace = true; if (i + 1 < argc && isNum(argv[i + 1])) every = std::atof(argv[++i]); }
    else if (s.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr-race: unknown flag %s\n", s.c_str()); return 2; }
    else a.push_back(s);
  }
  if (a.size() > 5) { std::fprintf(stderr, "xbr-race: too many arguments\n"); return 2; }
  const std::string key = a.size() > 0 ? a[0] : "monza", cls = a.size() > 1 ? a[1] : "f1";
  const int laps = a.size() > 2 ? std::atoi(a[2].c_str()) : 3, grid = a.size() > 3 ? std::atoi(a[3].c_str()) : 22;
  const std::string tier = a.size() > 4 ? a[4] : "medium";
  if (!hasCarSpec(cls)) { std::fprintf(stderr, "xbr-race: no car class '%s' (f4, f1, gt3)\n", cls.c_str()); return 2; }
  if (std::string(tierFor(tier)->key) != tier) { std::fprintf(stderr, "xbr-race: no tier '%s'\n", tier.c_str()); return 2; }
  if (!battle.empty() && !battleFor(battle)) { std::fprintf(stderr, "xbr-race: no battle '%s' (easy, medium, hard)\n", battle.c_str()); return 2; }
  if (input != "park" && input != "floor") { std::fprintf(stderr, "xbr-race: --input is park or floor\n"); return 2; }
  if (!xcar.empty() && xcar != "gt" && xcar != "rally") { std::fprintf(stderr, "xbr-race: --xingus is gt or rally\n"); return 2; }
  if (laps < 1 || grid < 1 || every <= 0) { std::fprintf(stderr, "xbr-race: laps, grid and the trace interval must be positive\n"); return 2; }

  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-race: %s\n", e.what()); return 1; }
  Spec &spec = carSpec(cls);
  static AeroMap map;
  if (aero) {
    const Json aj = Json::loadOpt(dataDir + "/aero/" + cls + ".json");
    if (!aj.isObj()) { std::fprintf(stderr, "xbr-race: no aero map for %s\n", cls.c_str()); return 1; }
    map = AeroMap::fromJson(aj);
    registerAero(cls, &map);
  }
  setWetness(wet);
  Lines lines = buildLines(track, spec);

  RaceOptions o;
  o.track = &track; o.lines = &lines; o.spec = &spec;
  o.slots = gridSlots(track, grid);
  o.laps = laps; o.grid = grid; o.tier = tier; o.seed = seed;
  o.player = playerSlot > 0; if (playerSlot > 0) o.playerGrid = playerSlot;
  o.pits = pits; o.rules = rules; o.duel = duel; o.drs = drs; o.noDnf = noDnf; o.standIn = standIn; o.battle = battle;
  o.xingus = !xcar.empty(); if (!xcar.empty()) o.xopt.car = xcar;
  o.xopt.solo = xsolo; o.xopt.derby = xderby; o.xopt.loose = xloose; o.xopt.stakes = xstakes;
  o.xopt.rolling = rolling; o.xopt.joker = joker;
  Race race(o);

  std::vector<RaceEvent> all;
  race.onEvent = [&](const RaceEvent &ev) { all.push_back(ev); };
  PlayerInput floorIt;
  floorIt.throttle = 1; floorIt.brake = 0; floorIt.delta = 0;
  const PlayerInput *in = input == "floor" ? &floorIt : nullptr;

  if (trace) {
    const double T = maxTime > 0 ? maxTime : 60;
    const long steps = (long)jsRound(T / FIXED_DT), ev = (long)jsRound(every / FIXED_DT);
    std::printf("%s  %s  %d laps  %d cars  %s  seed %s  race trace\n", track.key.c_str(), cls.c_str(), laps, (int)race.entries.size(), tier.c_str(), jsNum(seed).c_str());
    std::printf("       T CAR              X              Y      M/S LAP POS    DMG FL\n");
    for (long k = 1; k <= steps; k++) {
      if (rainAt >= 0 && k == (long)jsRound(rainAt / FIXED_DT)) setWetness(1);
      race.tick(FIXED_DT, in);
      if (probeOn) {
        const double tt = k * FIXED_DT;
        if (tt >= probeFrom && tt <= probeTo) {
          // every number in its shortest exact form, so two builds can be compared to the bit
          const auto nn = [](double v) { return std::isnan(v) ? std::string("null") : jsNum(v); };
          for (const Entry &e : race.entries) {
            if (probeCar >= 0 && e.idx != probeCar) continue;
            const Car &c = e.car;
            const bool x = e.hasCtx;
            std::printf("P %ld car %d x %s y %s hdg %s vx %s vy %s r %s delta %s thr %s brk %s z %s dmg %s Tf %s wf %s | s %s lat %s | bias %s cap %s lunge %s press %s hold %s oDs %s oV %s | tow %s dirty %s drs %d pit %s ahead %d behind %d\n",
                        k, e.idx, nn(c.x).c_str(), nn(c.y).c_str(), nn(c.hdg).c_str(), nn(c.vx).c_str(), nn(c.vy).c_str(), nn(c.r).c_str(), nn(c.delta).c_str(),
                        nn(c.throttle).c_str(), nn(c.brake).c_str(), nn(c.z).c_str(), nn(c.damage).c_str(), nn(c.tyre.Tf).c_str(), nn(c.tyre.wf).c_str(),
                        nn(e.proj.s).c_str(), nn(e.proj.lat).c_str(),
                        x ? nn(e.ctx.offBias).c_str() : "null", x ? nn(e.ctx.speedCap).c_str() : "null", x ? nn(e.ctx.lunge).c_str() : "null",
                        x ? nn(e.ctx.pressure).c_str() : "null", x ? nn(e.ctx.hold).c_str() : "null", x ? nn(e.ctx.obstDs).c_str() : "null", x ? nn(e.ctx.obstV).c_str() : "null",
                        nn(c.tow).c_str(), nn(c.dirty).c_str(), c.drsOpen ? 1 : 0, e.pitPhase == PitPhase::Undef ? "-" : pitPhaseName(e.pitPhase),
                        e.ahead ? e.ahead->idx : -1, e.behind ? e.behind->idx : -1);
          }
        }
        continue;
      }
      if (k % ev == 0 || k == steps)
        for (const Entry &e : race.entries)
          std::printf("%8.2f %3d %14.9f %14.9f %8.3f %3d %3d %6.3f %c%c\n", k * FIXED_DT, e.idx, e.car.x, e.car.y, e.car.speed,
                      e.lap, e.pos, e.car.damage, e.retired ? 'R' : '-', e.inPit ? 'P' : '-');
    }
    for (const RaceEvent &x : all)
      std::printf("E %.4f %s %s %d %s\n", x.t, x.kind.c_str(), x.code.empty() ? "-" : x.code.c_str(), x.car, x.text.c_str());
    // when two cars first touched: from there on a last-bit difference is millimetres
    if (std::isnan(race.firstHitAt)) std::printf("CONTACT -\n"); else std::printf("CONTACT %.4f\n", race.firstHitAt);
    const auto &c = race.rc.count;
    const SafetyCar &sc = race.rc.sc;
    std::printf("END state %s  rc %s %s  sc %d vsc %d red %d restarts %d pens %d  passes %d  sideFights %d  safety car %s s %.6f v %.6f hits %d\n",
                raceStateName(race.state), rcModeName(race.rc.mode), race.rc.phase == RcPhase::None ? "-" : rcPhaseName(race.rc.phase),
                c.sc, c.vsc, c.red, c.restarts, c.pens, race.passes, race.sideFights,
                !sc.out ? "in" : sc.inLane ? "lane" : "out", sc.s, sc.v, race.rc.scHits);
    return 0;
  }

  std::printf("%s — %s — %d cars, %d laps, %s\n\n", track.full.c_str(), spec.full.c_str(), grid, laps, tier.c_str());
  const auto t0 = std::chrono::steady_clock::now();
  double simT = 0;
  const double maxT = maxTime > 0 ? maxTime : laps * 260 + 90;
  while (race.state != RaceState::Over && simT < maxT) {
    if (rainAt >= 0 && simT < rainAt && simT + FIXED_DT >= rainAt) setWetness(1);
    race.tick(FIXED_DT, in);
    simT += FIXED_DT;
  }
  const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();

  std::printf("POS DRIVER          BEST LAP   LAPS  PEN  WARN  HITS  DMG\n");
  for (const Entry *e : race.standings)
    std::printf("%3d %s %10s %5d %4s %5d %5d %5.2f %s\n", e->pos, padEnd(e->name, 14).c_str(), fmt(e->bestLap).c_str(), e->lap,
                jsNum(e->penalty).c_str(), e->warnings, e->contacts, e->car.damage, e->retired ? " RETIRED" : "");

  int fin = 0, moved = 0;
  double best = 1e9;
  std::vector<double> spread;
  for (const Entry *e : race.standings) {
    if (!e->retired) { fin++; if (!std::isnan(e->bestLap) && e->bestLap != 0) spread.push_back(e->bestLap); }
  }
  for (const Entry &e : race.entries) {
    best = std::min(best, std::isnan(e.bestLap) || e.bestLap == 0 ? 1e9 : e.bestLap);
    if (e.pos != e.gridPos) moved++;
  }
  std::stable_sort(spread.begin(), spread.end());
  const double ideal = lines.race.lapTime;
  std::printf("\nideal line %s  |  best of the field %s (%.1f%% off)\n", fmt(ideal).c_str(), fmt(best).c_str(), (best / ideal - 1) * 100);
  if (spread.size() > 1) std::printf("field spread: %.2fs between fastest and slowest best lap\n", spread.back() - spread.front());
  const int n = (int)race.entries.size();
  std::printf("finished %d/%d   retired %d\n", fin, n, n - fin);
  // The metric that tells a clean RACE apart from a clean procession.
  std::printf("passes: %d   cars finishing off their grid slot: %d/%d\n", race.passes, moved, n);

  std::vector<std::pair<std::string, int>> kinds;
  for (const RaceEvent &ev : race.events) {
    size_t k = 0;
    while (k < kinds.size() && kinds[k].first != ev.kind) k++;
    if (k == kinds.size()) kinds.emplace_back(ev.kind, 0);
    kinds[k].second++;
  }
  std::printf("events: {");
  for (size_t k = 0; k < kinds.size(); k++) std::printf("%s\"%s\":%d", k ? "," : "", kinds[k].first.c_str(), kinds[k].second);
  std::printf("}\n");
  int shown = 0;
  for (const RaceEvent &ev : race.events) {
    if (ev.kind != "penalty" && ev.kind != "crash") continue;
    if (shown++ >= 6) break;
    std::printf("   %.1fs  %s\n", ev.t, ev.text.c_str());
  }

  // The number that decides whether this can run at all.
  std::printf("\nPERFORMANCE: %.0fs of racing in %.1fs wall = %.1fx real time\n", simT, wall, simT / wall);
  std::printf("  %.1fM car-substeps, %.2fM/s\n", grid * simT / FIXED_DT / 1e6, grid * simT / FIXED_DT / wall / 1e6);
  return 0;
}
