// xbr-drive — the gate, native. tools/drive.mjs in C++: a real driver drives
// the real physics around a real circuit, no window and no graphics.
//
//   xbr-drive [track] [laps] [class] [tier|all]
//   xbr-drive --game [track] [seconds] [class] [tier] [every]
//
// --game is the loop the GAME runs rather than the harness's: the solved aero
// map, the surface's rolling drag, and the barriers with their damage. Its
// reference is native/check/ref-game.mjs, which runs the same loop on the JS.
//
// Its table is laid out exactly like the Node tool's so the two can be diffed:
//   node tools/drive.mjs monza 2 f1 all  |  native/build/xbr-drive monza 2 f1 all
// native/check.sh does that for you.
#include <cstdio>
#include <string>
#include <vector>

#include "collide.hpp"
#include "driver.hpp"
#include "physics.hpp"
#include "track.hpp"

using namespace xbr;

static std::string fmt(double s, bool has) {
  if (!has) return "--.---";
  char buf[64];
  const int mins = (int)std::floor(s / 60);
  std::snprintf(buf, sizeof buf, "%d:%06.3f", mins, std::fmod(s, 60));
  return buf;
}

static double surfaceAt(const Proj &p) {
  const double al = std::fabs(p.lat);
  if (al > p.w + p.run) return SURFACE::grass;
  if (al > p.w + 1.2) return SURFACE::runoff;
  if (al > p.w) return SURFACE::kerb;
  return SURFACE::track;
}

struct Result {
  double best = 0;
  bool hasBest = false;
  double offT = 0, worstLat = 0, spinT = 0, vmax = 0;
  int mistakes = 0;
};

// tools/harness.mjs runLaps, line for line.
static Result runLaps(const Track &track, Lines &lines, Spec &spec, int laps, const std::string &tier, double seed = 1) {
  const double peak = peakSlip(spec);
  Driver driver = makeDriver(seed, tier, track.corners.empty() ? 24 : (int)track.corners.size());
  Autopilot drive(track, lines, spec, peak, &driver);
  const Line &line = lines.at(driver.T->line, driver.grip);
  Car car = makeCar(spec.key);
  const int i0 = track.idx(0);
  double px, py, ph;
  int pi;
  track.point(0, line.off[i0], px, py, ph, pi);
  car.x = px; car.y = py; car.hdg = line.hdg[i0]; car.vx = 20;

  int hint = i0, lap = 0;
  double sPrev = 0, lapT = 0, t = 0;
  bool wasMistake = false;
  Result r;
  const double maxT = laps * 400 + 120;

  while (t < maxT && lap <= laps) {
    const Proj proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const double surface = surfaceAt(proj);
    const DriveInfo info = drive.drive(car, proj, FIXED_DT);
    Env env;
    env.surface = surface; env.bank = proj.bank; env.bankDir = sign(proj.curv);
    step(car, FIXED_DT, env);

    if (surface < SURFACE::track) r.offT += FIXED_DT;
    r.worstLat = std::max(r.worstLat, std::fabs(proj.lat) - proj.w);
    r.vmax = std::max(r.vmax, car.speed);
    if (std::fabs(car.slipR) > peak * 3 && car.speed > 12) r.spinT += FIXED_DT;
    if (info.mistake && !wasMistake) r.mistakes++;
    wasMistake = info.mistake != 0;

    if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
      if (lap > 0) { if (!r.hasBest || lapT < r.best) { r.best = lapT; r.hasBest = true; } }
      lap++; lapT = 0;
    }
    sPrev = proj.s; lapT += FIXED_DT; t += FIXED_DT;
  }
  return r;
}

// The game's loop with the reference driver at the wheel. Prints the state
// every five seconds, so a divergence shows WHEN it began and not only that
// the two ended up in different places.
static int runGame(const std::string &dataDir, const std::string &key, double seconds, const std::string &cls,
                   const std::string &tier, double everyS, bool fine) {
  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-drive: %s\n", e.what()); return 1; }
  Spec &spec = carSpec(cls);
  const Json aj = Json::loadOpt(dataDir + "/aero/" + cls + ".json");
  if (!aj.isObj()) { std::fprintf(stderr, "xbr-drive: no aero map for %s\n", cls.c_str()); return 1; }
  static AeroMap map;
  map = AeroMap::fromJson(aj);
  registerAero(cls, &map);
  Lines lines = buildLines(track, spec);
  const double peak = peakSlip(spec);
  Driver driver = makeDriver(1, tier, track.corners.empty() ? 24 : (int)track.corners.size());
  Autopilot drive(track, lines, spec, peak, &driver);
  const Line &line = lines.race;
  Car car = makeCar(cls);
  const int i0 = track.idx(0);
  double px, py, ph;
  int pi;
  track.point(0, line.off[i0], px, py, ph, pi);
  car.x = px; car.y = py; car.hdg = line.hdg[i0];
  car.tyre.Tf = car.tyre.Tr = 70;

  std::printf("%s  %s  %s  game loop\n", track.key.c_str(), cls.c_str(), tier.c_str());
  std::printf("     T        S    KM/H   DAMAGE  WINGS  HITS         X         Y\n");
  int hint = i0, hits = 0, lap = 0;
  double sPrev = 0, lapT = 0, best = 0;
  bool hasBest = false;
  const long steps = (long)std::llround(seconds / FIXED_DT), every = (long)std::llround(everyS / FIXED_DT);
  for (long k = 1; k <= steps; k++) {
    const Proj proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    drive.drive(car, proj, FIXED_DT);
    const double surface = surfaceAt(proj);
    Env env;
    env.surface = surface; env.bank = proj.bank; env.bankDir = sign(proj.curv); env.rollMul = dragFor(surface);
    step(car, FIXED_DT, env);
    const Hit hit = resolveBarrier(car, track, hint);
    if (hit.hit && hit.closing > 3.5) hits++;
    if (sPrev > track.length * 0.8 && proj.s < track.length * 0.2) {
      if (lap > 0 && (!hasBest || lapT < best)) { best = lapT; hasBest = true; }
      lap++; lapT = 0;
    }
    sPrev = proj.s; lapT += FIXED_DT;
    if (k % every == 0 || k == steps)
      std::printf("%6.1f %8.1f %7.1f %8.3f  %c%c %6d %9.*f %9.*f\n", k * FIXED_DT, proj.s, car.speed * 3.6, car.damage,
                  car.hasLost && car.lostFrontWing ? 'F' : '-', car.hasLost && car.lostRearWing ? 'R' : '-', hits,
                  fine ? 9 : 2, car.x, fine ? 9 : 2, car.y);
  }
  std::printf("best lap %s   aero parts cl %.4f bal %.4f cd %.4f\n", fmt(best, hasBest).c_str(),
              car.parts.exists ? car.parts.cl : 1.0, car.parts.exists ? car.parts.bal : 1.0, car.parts.exists ? car.parts.cd : 1.0);
  return 0;
}

int main(int argc, char **argv) {
  std::vector<std::string> a;
  std::string dataDir = "data";
  bool game = false;
  for (int i = 1; i < argc; i++) {
    std::string s = argv[i];
    if (s == "--data" && i + 1 < argc) { dataDir = argv[++i]; continue; }
    if (s == "--game") { game = true; continue; }
    if (s.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr-drive: unknown flag %s\n", s.c_str()); return 2; }
    a.push_back(s);
  }
  if (a.size() > (game ? 5u : 4u)) { std::fprintf(stderr, "xbr-drive: too many arguments\n"); return 2; }
  const std::string key = a.size() > 0 ? a[0] : "monza";
  const int laps = a.size() > 1 ? std::atoi(a[1].c_str()) : 3;
  const std::string cls = a.size() > 2 ? a[2] : "f4";
  const std::string tierArg = a.size() > 3 ? a[3] : "hard";
  if (!hasCarSpec(cls)) { std::fprintf(stderr, "xbr-drive: no car class '%s' (f4, f1, gt3)\n", cls.c_str()); return 2; }
  if (tierArg != "all" && std::string(tierFor(tierArg)->key) != tierArg) { std::fprintf(stderr, "xbr-drive: no tier '%s'\n", tierArg.c_str()); return 2; }
  if (game) return runGame(dataDir, key, a.size() > 1 ? std::atof(a[1].c_str()) : 120, cls, tierArg == "all" ? "hard" : tierArg,
                          a.size() > 4 ? std::atof(a[4].c_str()) : 5, a.size() > 4);

  Track track;
  try { track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr-drive: %s\n", e.what()); return 1; }
  Spec &spec = carSpec(cls);
  Lines lines = buildLines(track, spec);
  const double peak = peakSlip(spec);

  std::printf("%s  %s  %.3f km\n", track.full.c_str(), spec.full.c_str(), track.length / 1000);
  std::printf("ideal race line %s   centreline %s\n", fmt(lines.race.lapTime, true).c_str(), fmt(lines.centre.lapTime, true).c_str());
  std::printf("peak slip %.1f deg   drag-limited top speed %.0f km/h\n\n", peak * 180 / PI, topSpeed(spec) * 3.6);
  std::printf("TIER          BEST LAP    vs IDEAL   OFF    WORST  SIDEWAYS  ERRORS  TOP\n");

  std::vector<std::string> tiers;
  if (tierArg == "all") for (const auto &t : allTiers()) tiers.push_back(t.key);
  else tiers.push_back(tierArg);

  for (const auto &tier : tiers) {
    const Result r = runLaps(track, lines, spec, laps, tier);
    char pct[32] = "--";
    if (r.hasBest) std::snprintf(pct, sizeof pct, "%.1f%%", (r.best / lines.race.lapTime - 1) * 100);
    char off[32], worst[32], spin[32], top[32];
    std::snprintf(off, sizeof off, "%.1fs", r.offT);
    std::snprintf(worst, sizeof worst, "%.1fm", r.worstLat);
    std::snprintf(spin, sizeof spin, "%.1fs", r.spinT);
    std::snprintf(top, sizeof top, "%.0f", r.vmax * 3.6);
    std::printf("%-13s %9s %9s %7s %7s %9s %7d %5s\n", tierFor(tier)->name, fmt(r.best, r.hasBest).c_str(),
                pct, off, worst, spin, r.mistakes, top);
  }
  return 0;
}
