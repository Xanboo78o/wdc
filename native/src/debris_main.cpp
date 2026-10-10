// debris_main.cpp — xbr-debris: a whole race, headless, with the crash effects' rigid bodies running beside it
// (fx.cpp simulates the loose wheels and wings without ever drawing them), wired to the race exactly as the game
// wires them (game_main.cpp fxTick). It prints every wheel and wing that leaves a car, every car that then hits
// one, what race control says, and what the marshals pick up.
//
//   xbr-debris [track] [class] [laps] [grid] [--seed N] [--time S] [--stage S] [--plant M[,wing]] [--shunt S] [--quiet]
//
// --stage S: S seconds after the lights the car in third place loses its left rear wheel and its front wing where
// it is, so there is something on the road whether or not anybody crashes. --plant M: once the race is twenty
// seconds old and the leader is 250 m short of it, a wheel (or a wing) is lying ON THE RACING LINE M metres round the lap, and stays until the marshals have
// it: the test of whether anybody goes round. (XBR_BLIND=1 is the same race with drivers who cannot see it.)
// --shunt S: S seconds after the lights the car in third place is turned 35 degrees towards the barrier and left to
// it: a real accident, with whatever that breaks, in front of everybody behind.
// --quiet prints the last line only.
//
//   xbr-debris --crash [track] [class]
//
// No race: one car on the main straight is pointed at the barrier at each of a table of speeds and angles and let
// go, and what was left of it is printed. The answer to "what does it take for a wheel to come off".
//
// It is how "do the others go round it, and what happens to the one who does not" is answered without a screen.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include "fx.hpp"
#include "race.hpp"

using namespace xbr;

static int crashTable(const std::string &dataDir, const std::string &key, const std::string &cls) {
  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-debris: %s\n", e.what()); return 1; }
  wheelsTear() = true;
  std::printf("%s %s into the barrier off the main straight: wheels off (FL FR RL RR), wings, damage\n       ", key.c_str(), cls.c_str());
  const double degs[] = {10, 20, 35, 50, 70, 90};
  for (double dg : degs) std::printf("   %2.0f deg        ", dg);
  std::printf("\n");
  for (double kmh = 60; kmh <= 300; kmh += 40) {
    std::printf("%3.0f km/h", kmh);
    for (double dg : degs) {
      Car car = makeCar(cls);
      const int i0 = track.idx(60);
      car.x = track.x[(size_t)i0]; car.y = track.y[(size_t)i0];
      car.hdg = track.hdg[(size_t)i0] - dg * 3.14159265 / 180;      // to the right
      car.vx = kmh / 3.6; car.throttle = 0; car.brake = 0; car.delta = 0;
      int hint = i0;
      for (int n = 0; n < 400 * 12 && (n < 400 || car.speed > 1); n++) {
        step(car, FIXED_DT);
        const Proj p = track.project(car.x, car.y, hint, 8);
        hint = p.i;
        resolveBarrier(car, track, hint);
      }
      syncParts(car);
      std::printf("  %c%c%c%c %c%c %.2f  ", car.wheelLost[0] ? 'X' : '.', car.wheelLost[1] ? 'X' : '.', car.wheelLost[2] ? 'X' : '.', car.wheelLost[3] ? 'X' : '.',
                  car.hasLost && car.lostFrontWing ? 'F' : '-', car.hasLost && car.lostRearWing ? 'R' : '-', car.damage);
    }
    std::printf("\n");
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1 && std::string(argv[1]) == "--crash") return crashTable("../data", argc > 2 ? argv[2] : "monza", argc > 3 ? argv[3] : "f1");
  std::string dataDir = "../data";
  std::vector<std::string> a;
  double seed = 1, maxT = 0, stage = -1, plant = -1, shunt = -1;
  bool quiet = false, plantWing = false, planted = false, plantGone = false;
  for (int i = 1; i < argc; i++) {
    const std::string s = argv[i];
    const auto val = [&]() -> const char * { if (i + 1 >= argc) { std::fprintf(stderr, "xbr-debris: %s needs a value\n", s.c_str()); std::exit(2); } return argv[++i]; };
    if (s == "--data") dataDir = val();
    else if (s == "--seed") seed = std::atof(val());
    else if (s == "--time") maxT = std::atof(val());
    else if (s == "--stage") stage = std::atof(val());
    else if (s == "--shunt") shunt = std::atof(val());
    else if (s == "--plant") { const std::string v = val(); plant = std::atof(v.c_str()); plantWing = v.find(",wing") != std::string::npos; }
    else if (s == "--quiet") quiet = true;
    else if (s.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr-debris: unknown flag %s\n", s.c_str()); return 2; }
    else a.push_back(s);
  }
  if (a.size() > 4) { std::fprintf(stderr, "xbr-debris: too many arguments\n"); return 2; }
  const std::string key = a.size() > 0 ? a[0] : "monza", cls = a.size() > 1 ? a[1] : "f1";
  const int laps = a.size() > 2 ? std::atoi(a[2].c_str()) : 3, grid = a.size() > 3 ? std::atoi(a[3].c_str()) : 22;
  if (!hasCarSpec(cls) || laps < 1 || grid < 2) { std::fprintf(stderr, "xbr-debris: bad class, laps or grid\n"); return 2; }

  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-debris: %s\n", e.what()); return 1; }
  Spec &spec = carSpec(cls);
  Lines lines = buildLines(track, spec);
  RaceOptions o;
  o.track = &track; o.lines = &lines; o.spec = &spec;
  o.slots = gridSlots(track, grid);
  o.laps = laps; o.grid = grid; o.seed = seed;
  o.player = true; o.playerGrid = std::min(grid, 10); o.standIn = true; o.real = true;
  Race race(o);
  if (!race.me) { std::fprintf(stderr, "xbr-debris: the race has no car for you\n"); return 1; }
  Terrain terrain(track, nullptr);
  Fx fx;
  wheelsTear() = std::getenv("XBR_NOTEAR") == nullptr;      // as the game has it (XBR_NOTEAR=1: the race as it was before, to compare)

  int rcLines = 0, vsc = 0, sc = 0;
  race.onEvent = [&](const RaceEvent &ev) {
    if (ev.kind != "rc") return;
    rcLines++;
    if (ev.code == "vsc") vsc++;
    if (ev.code == "sc") sc++;
    if (!quiet) std::printf("%7.1fs  RC   %s\n", race.time, ev.text.c_str());
  };

  struct Was { bool wl[4] = {false, false, false, false}, fw = false, rw = false; };
  std::vector<Was> was(race.entries.size());
  std::map<long long, double> side;             // (hazard id, car) -> the gap to it last frame
  int wheels = 0, wings = 0, strikes = 0, hurt = 0, shattered = 0, passed = 0, sweptN = 0;
  bool staged = false, shunted = false;

  Autopilot pilot(track, lines, spec, peakSlip(spec), &race.me->driver);
  PlayerInput pi;
  std::vector<Hazard> hz;
  double acc = 0;
  while (race.state != RaceState::Over && (maxT <= 0 || race.time < maxT) && race.time < 7200) {
    Entry &me = *race.me;
    pilot.drive(me.car, me.proj, FIXED_DT, me.hasCtx ? &me.ctx : nullptr);
    if (race.state == RaceState::Grid) { me.car.throttle = 0; me.car.brake = 1; }
    pi.throttle = me.car.throttle; pi.brake = me.car.brake; pi.delta = me.car.delta;
    race.tick(FIXED_DT, &pi);
    acc += FIXED_DT;
    if (acc < 1.0 / 60) continue;
    const double dt = acc;
    acc = 0;

    if (!staged && stage >= 0 && race.state == RaceState::Green && race.time - race.greenT >= stage && race.standings.size() > 2) {
      staged = true;
      Entry &v = *race.standings[2];
      v.car.wheelLost[2] = true; v.car.hasLost = true; v.car.lostFrontWing = true;
      if (!quiet) std::printf("%7.1fs  STAGED: %s (P3) at s=%.0f, %.0f km/h\n", race.time, v.name.c_str(), v.proj.s, v.car.speed * 3.6);
    }

    if (!shunted && shunt >= 0 && race.state == RaceState::Green && race.time - race.greenT >= shunt && race.standings.size() > 2) {
      shunted = true;
      Entry &v = *race.standings[2];
      v.car.hdg -= 0.61;
      if (!quiet) std::printf("%7.1fs  SHUNT: %s (P3) turned at the barrier at s=%.0f, %.0f km/h\n", race.time, v.name.c_str(), v.proj.s, v.car.speed * 3.6);
    }

    // ---- the game's fxTick, without the drawing
    fx.begin(&race, track, nullptr, &terrain, spec);
    const float pc[3] = {-1, 0, 0};
    for (Entry &e : race.entries) fx.car(e.car, e.proj, pc, e.isPlayer, dt);
    fx.end(dt);
    fx.hazards(hz);
    // (it appears as the leader comes to within 250 m of it, so the field arrives before the marshals do)
    const bool leaderNear = !race.standings.empty() && track.gap(std::fmod(plant, track.length), race.standings[0]->proj.s) > 0
                            && track.gap(std::fmod(plant, track.length), race.standings[0]->proj.s) < 250;
    if (plant >= 0 && !plantGone && race.state == RaceState::Green && race.time - race.greenT >= 20 && (planted || leaderNear)) {
      const int i = (int)(std::fmod(plant, track.length) / track.length * track.n) % track.n;
      const double lat = lines.race.off[(size_t)i], hd = track.hdg[(size_t)i];
      Hazard h;
      h.id = 9999; h.x = track.x[(size_t)i] - std::sin(hd) * lat; h.y = track.y[(size_t)i] + std::cos(hd) * lat;
      h.wheel = !plantWing; h.r = plantWing ? 0.6 : 0.33; h.mass = plantWing ? 9 : 11; h.still = true;
      hz.push_back(h);
      if (!planted && !quiet) std::printf("%7.1fs  PLANTED a %s on the racing line at s=%.0f (lat %.1f)\n", race.time, plantWing ? "wing" : "wheel", plant, lat);
      planted = true;
    }
    for (Entry &e : race.entries) {
      Was &w = was[(size_t)e.idx];
      for (int k = 0; k < 4; k++) if (e.car.wheelLost[k] && !w.wl[k]) {
        wheels++;
        if (!quiet) std::printf("%7.1fs  WHEEL OFF  %-22s corner %d  at s=%.0f  %.0f km/h\n", race.time, e.name.c_str(), k, e.proj.s, e.car.speed * 3.6);
      }
      for (int k = 0; k < 4; k++) w.wl[k] = e.car.wheelLost[k];
      const bool fw = e.car.hasLost && e.car.lostFrontWing, rw = e.car.hasLost && e.car.lostRearWing;
      if ((fw && !w.fw) || (rw && !w.rw)) {
        wings++;
        if (!quiet) std::printf("%7.1fs  WING OFF   %-22s %s  at s=%.0f\n", race.time, e.name.c_str(), fw && !w.fw ? "front" : "rear", e.proj.s);
      }
      w.fw = fw; w.rw = rw;
      if (e.retired || e.inPit || !std::isnan(e.garageT)) continue;
      for (Hazard &h : hz) {
        Struck k;
        const double before = e.car.damage;
        if (!resolveHazard(e.car, h, k)) continue;
        fx.struck(k);
        h.r = 0;
        if (h.id == 9999) plantGone = true;          // struck: it is not lying there any more
        if (k.blow <= 0.5) continue;
        strikes++;
        if (k.harm > 0) hurt++;
        if (k.shatter) shattered++;
        if (!quiet)
          std::printf("%7.1fs  HIT   %-22s a %s at %.0f km/h: a %.1f m/s blow, damage %.2f -> %.2f%s%s\n", race.time, e.name.c_str(), h.wheel ? "wheel" : "wing",
                      e.car.speed * 3.6, k.blow, before, e.car.damage, k.shatter ? ", the wing shattered" : "", e.isPlayer ? "  (YOUR SEAT)" : "");
      }
    }
    race.setHazards(hz, dt);
    // who went by a piece lying on the road
    for (const Hazard &h : race.hazards) {
      if (!h.still || std::fabs(h.lat) > h.w + 0.3) continue;
      for (Entry &e : race.entries) {
        if (e.retired || e.inPit) continue;
        const double ds = track.gap(h.s, e.proj.s);
        const long long kk = (long long)h.id * 1000 + e.idx;
        const auto it = side.find(kk);
        if (it != side.end() && it->second > 0 && it->second < 30 && ds <= 0 && ds > -30) {
          passed++;
          if (!quiet) std::printf("%7.1fs  BY    %-22s %.1f m to its %s at %.0f km/h\n", race.time, e.name.c_str(), std::fabs(e.proj.lat - h.lat), e.proj.lat > h.lat ? "left" : "right", e.car.speed * 3.6);
        }
        side[kk] = ds;
      }
    }
    for (int id : race.swept) {
      if (id == 9999) plantGone = true;
      fx.sweep(id);
      sweptN++;
      if (!quiet) std::printf("%7.1fs  MARSHALS  have piece %d\n", race.time, id);
    }
    race.swept.clear();
  }
  int running = 0, out = 0;
  for (const Entry &e : race.entries) { if (e.retired) out++; else running++; }
  std::printf("%s %s seed %g: %d wheels and %d wings came off; cars went by a piece on the road %d times and hit one %d times (%d hurt, %d wings shattered); "
              "marshals took %d; VSC %d, SC %d; %d running, %d out; %.0f s\n",
              track.key.c_str(), cls.c_str(), seed, wheels, wings, passed, strikes, hurt, shattered, sweptN, vsc, sc, running, out, race.time);
  return 0;
}
