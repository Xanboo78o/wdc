// xbr — the game, native. SDL3 for the window, the devices and the sound;
// OpenGL for the picture; the sim core for everything that is true.
//
// It opens on HOME, as the browser game does (home.html): a live race behind
// the cards, RACE one press away, SETUP / GARAGE / SETTINGS beside it.
//
//   xbr [track] [car]            go straight to that circuit (car: f1 | f4 | gt3), skipping HOME
//   --mode race|hotlap  --grid N  --laps N  --start N  --tier T  --seed N
//   --auto                       the reference driver takes your wheel (F1 toggles it)
//   --cam 0|1|2|3  --line  --time PHASE  --weather KIND
//   --windowed  --size WxH  --hidpi  --no-audio  --data DIR
//   --ffb PERCENT                wheel force for this run, through tools/ffb.py (0 = off, the default)
//   --shot FILE.ppm [--spool SECONDS] [--screen home|setup|garage|settings|pause|results]
//   --frames N [--hidden]        run the real loop for N frames, report, exit;
//                                --hidden shows no window and plays no sound
//
// The driving loop is js/main.js's, substep for substep: the solo branch for a
// hot lap, race.tick for a race.
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <SDL3/SDL.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#include <epoxy/gl.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <set>
#include <ctime>
#include <memory>
#include <string>
#include <vector>

#include "audio.hpp"
#include "bridge.hpp"
#include "collide.hpp"
#include "driver.hpp"
#include "drivers.hpp"
#include "grid.hpp"
#include "home.hpp"
#include "physics.hpp"
#include "race.hpp"
#include "render.hpp"
#include "track.hpp"
#include "ui.hpp"
#include "weather.hpp"
#include "world.hpp"

using namespace xbr;

// ---------------------------------------------------------------------------
// devices
// ---------------------------------------------------------------------------
struct AxisCal { int ax = -1; double a = 0, b = 0, c = 0; };   // steer: centre,left,right — pedal: rest,full
struct WheelProfile {
  bool ok = false;
  AxisCal steer, throttle, brake;
};

static WheelProfile loadWheelProfile(const std::string &dataDir) {
  WheelProfile p;
  const Json j = Json::loadOpt(dataDir + "/wheel.json");
  if (!j.isObj() || !j["steer"].isObj() || !j["throttle"].isObj() || !j["brake"].isObj()) return p;
  p.steer = {(int)j["steer"]["ax"].n(-1), j["steer"]["centre"].n(), j["steer"]["left"].n(), j["steer"]["right"].n()};
  p.throttle = {(int)j["throttle"]["ax"].n(-1), j["throttle"]["rest"].n(), j["throttle"]["full"].n(), 0};
  p.brake = {(int)j["brake"]["ax"].n(-1), j["brake"]["rest"].n(), j["brake"]["full"].n(), 0};
  p.ok = p.steer.ax >= 0 && p.throttle.ax >= 0 && p.brake.ax >= 0;
  return p;
}

struct Devices {
  SDL_Joystick *joy = nullptr;       // a wheel: anything with the axes the profile names
  SDL_Gamepad *pad = nullptr;        // or an ordinary pad
  std::string name;
  WheelProfile prof;
  bool padPrev[4] = {false, false, false, false};

  void close() {
    if (joy) { SDL_CloseJoystick(joy); joy = nullptr; }
    if (pad) { SDL_CloseGamepad(pad); pad = nullptr; }
    name.clear();
  }
  // MATCH ON SHAPE, NOT ON NAME (js/input.js): a device that has the axes the
  // profile refers to is a wheel, whatever it calls itself.
  void scan() {
    close();
    int count = 0;
    SDL_JoystickID *ids = SDL_GetJoysticks(&count);
    if (!ids) return;
    const int needs = prof.ok ? std::max({prof.steer.ax, prof.throttle.ax, prof.brake.ax}) : 1 << 30;
    for (int i = 0; i < count && !joy; i++) {
      SDL_Joystick *j = SDL_OpenJoystick(ids[i]);
      if (!j) continue;
      if (SDL_GetNumJoystickAxes(j) > needs) { joy = j; name = SDL_GetJoystickName(j) ? SDL_GetJoystickName(j) : "wheel"; }
      else SDL_CloseJoystick(j);
    }
    for (int i = 0; i < count && !joy && !pad; i++) {
      if (!SDL_IsGamepad(ids[i])) continue;
      pad = SDL_OpenGamepad(ids[i]);
      if (pad) name = SDL_GetGamepadName(pad) ? SDL_GetGamepadName(pad) : "gamepad";
    }
    SDL_free(ids);
  }
  static double axis(SDL_Joystick *j, int i) {
    return std::max(-1.0, SDL_GetJoystickAxis(j, i) / 32767.0);
  }
  // js/input.js _readWheel: map through the two ends that were actually
  // recorded, so an inverted axis inverts itself.
  bool read(HandsIn &in) {
    if (joy) {
      const double off = axis(joy, prof.steer.ax) - prof.steer.a;
      const double toLeft = prof.steer.b - prof.steer.a, toRight = prof.steer.c - prof.steer.a;
      double steer = 0;
      if (std::fabs(off) > 0.012) {
        if (toLeft != 0 && sign(off) == sign(toLeft)) steer = std::min(1.0, off / toLeft);
        else if (toRight != 0) steer = -std::min(1.0, off / toRight);
      }
      auto ped = [&](const AxisCal &d) {
        const double t = d.b - d.a;
        return t != 0 ? clampd((axis(joy, d.ax) - d.a) / t, 0, 1) : 0.0;
      };
      const double th = ped(prof.throttle), br = ped(prof.brake);
      if (std::fabs(steer) > 0.02 || th > 0.03 || br > 0.03) {
        in.analog = true; in.aSteer = steer; in.aThrottle = th; in.aBrake = br;
        return true;
      }
      return false;
    }
    if (pad) {
      const double ax = SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFTX) / 32767.0;
      const double rt = SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER) / 32767.0;
      const double lt = SDL_GetGamepadAxis(pad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER) / 32767.0;
      if (std::fabs(ax) > 0.08 || rt > 0.03 || lt > 0.03) {
        const double dz = 0.08;
        // the body frame calls +y "left": stick right is a NEGATIVE wheel
        in.analog = true;
        in.aSteer = std::fabs(ax) < dz ? 0 : -(ax - sign(ax) * dz) / (1 - dz);
        in.aThrottle = rt; in.aBrake = lt;
        return true;
      }
    }
    return false;
  }
  // edge-detected pad buttons: 0 A (DRS), 1 B (camera), 2 Y (reset), 3 start
  bool tapped(int which) {
    if (!pad) return false;
    static const SDL_GamepadButton B[4] = {SDL_GAMEPAD_BUTTON_SOUTH, SDL_GAMEPAD_BUTTON_EAST, SDL_GAMEPAD_BUTTON_NORTH, SDL_GAMEPAD_BUTTON_START};
    const bool now = SDL_GetGamepadButton(pad, B[which]);
    const bool edge = now && !padPrev[which];
    padPrev[which] = now;
    return edge;
  }
};

// ---------------------------------------------------------------------------
// a session: one circuit, one car, and — in a race — everyone else
// ---------------------------------------------------------------------------
struct RaceSetup {
  int grid = 22, laps = 3, slot = 12;
  std::string tier = "medium", battle, teamKey, field = "f1";
  bool noDnf = false, standIn = false;
  double seed = 1;
  // XINGUS: which tune, and the style's switches (js/home.js xingusUrl)
  bool xingus = false, xsolo = false, xderby = false, xstakes = false, xloose = false;
  std::string xcar = "gt";
};

struct Session {
  std::string key, cls;
  Track track;
  std::unique_ptr<World> world;
  std::unique_ptr<Terrain> terrain;
  Gnd gnd;
  Spec *spec = nullptr;
  std::unique_ptr<Lines> lines;
  Car own;
  Car *car = &own;                 // your car: `own` in a hot lap, the race's entry in a race
  Driver driver;
  std::unique_ptr<Autopilot> pilot;
  std::unique_ptr<Gearbox> box;
  Hands hands;
  std::unique_ptr<Race> race;
  int hint = 0;
  double sPrev = 0, lapT = 0, last = 0, best = 0, offT = 0, rolled = 0;
  bool hasLast = false, hasBest = false, invalid = false;
  int lap = 0;
  double lastHit = 0;              // closing speed of a contact the sound has not played yet
  double t = 0, passAt = -9;
  Proj proj;
  bool xingus = false, xmanual = false;   // Xingus mode; and the paddles ARE the gearbox
  bool hand = false;                      // handbrake held (X, or the rim's `handbrake`)
};

static void resetCar(Session &S) {
  const Track &track = S.track;
  const Line &line = S.lines->race;
  const int i = track.idx(0);
  double px, py, ph;
  int pi;
  track.point(0, line.off[i], px, py, ph, pi);
  S.own = makeCar(S.spec->key);              // a reset car is a repaired car
  S.own.x = px; S.own.y = py; S.own.hdg = line.hdg[i];
  S.own.tyre.Tf = S.own.tyre.Tr = 70;
  S.hands = Hands{};
  S.hint = i; S.sPrev = 0; S.lapT = 0; S.lap = 0; S.invalid = false; S.offT = 0;
  S.proj = track.project(S.own.x, S.own.y, S.hint);
}

// js/main.js rejoin(): beached, and the race is still going. Back on the line a
// little way behind where it stopped. It does NOT repair anything.
static void rejoin(Session &S) {
  Entry &me = *S.race->me;
  Car &car = me.car;
  const double s = me.proj.s - 12;
  double px, py, ph;
  int pi;
  S.track.point(s, S.lines->race.off[S.track.idx(s)], px, py, ph, pi);
  car.x = px; car.y = py; car.hdg = ph;
  car.vx = 10; car.vy = 0; car.r = 0;
  car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
  car.airborne = false; car.onRoof = false;
  me.stuck = 0;
}

static bool loadSession(Session &S, Renderer &R, const std::string &dataDir, const std::string &key, const std::string &cls,
                        const std::string &pilotTier, const RaceSetup *rs) {
  S.key = key; S.cls = cls;
  try { S.track = Track::load(dataDir, key); }
  catch (const std::exception &e) { std::fprintf(stderr, "xbr: %s\n", e.what()); return false; }
  if (S.track.n < 8) { std::fprintf(stderr, "xbr: %s has no usable centreline\n", key.c_str()); return false; }
  S.spec = &carSpec(cls);
  // The aero map, as the browser game loads it. Without one physics falls back
  // to the constants, and says nothing — so say it here.
  if (!getAero(cls)) {
    const Json j = Json::loadOpt(dataDir + "/aero/" + cls + ".json");
    if (j.isObj()) registerAero(cls, new AeroMap(AeroMap::fromJson(j)));
    else std::fprintf(stderr, "xbr: no aero map for %s — driving on the constants\n", cls.c_str());
  }
  S.world = std::make_unique<World>(S.track, Json::loadOpt(dataDir + "/elev/" + key + ".json"));
  S.terrain = std::make_unique<Terrain>(S.track, S.world.get());
  S.lines = std::make_unique<Lines>(buildLines(S.track, *S.spec));
  S.lines->track = &S.track;
  S.box = std::make_unique<Gearbox>(cls);
  S.hasBest = S.hasLast = false;
  resetCar(S);
  if (rs) {
    // You take a seat in your team, and its other car is your teammate.
    setField(cls == "f1" ? rs->field : cls);
    setPlayerTeam(rs->standIn ? "" : rs->teamKey, rs->grid);
    RaceOptions o;
    o.track = &S.track; o.lines = S.lines.get(); o.spec = S.spec;
    o.slots = gridSlots(S.track, rs->grid);
    o.laps = rs->laps; o.grid = rs->grid; o.playerGrid = rs->slot; o.tier = rs->tier; o.player = true;
    o.battle = rs->battle; o.noDnf = rs->noDnf; o.seed = rs->seed; o.standIn = rs->standIn;
    o.playerTeam = rs->standIn ? nullptr : teamByKey(rs->teamKey);
    o.xingus = rs->xingus; o.xopt.car = rs->xcar; o.xopt.solo = rs->xsolo; o.xopt.derby = rs->xderby;
    o.xopt.stakes = rs->xstakes; o.xopt.loose = rs->xloose;
    S.xingus = rs->xingus;
    S.race = std::make_unique<Race>(o);
    World *w = S.world.get();
    S.race->slopeAt = [w](double s) { return w->gradeAt(s); };
    if (!S.race->me) { std::fprintf(stderr, "xbr: the race has no car for you\n"); return false; }
    S.car = &S.race->me->car;
    S.proj = S.race->me->proj;
    if (S.race->me->hasDriver) S.pilot = std::make_unique<Autopilot>(S.track, *S.lines, *S.spec, peakSlip(*S.spec), &S.race->me->driver);
  }
  if (!S.pilot) {
    S.driver = makeDriver(1, pilotTier, S.track.corners.empty() ? 24 : (int)S.track.corners.size());
    S.pilot = std::make_unique<Autopilot>(S.track, *S.lines, *S.spec, peakSlip(*S.spec), &S.driver);
  }
  R.buildWorld(S.track, *S.world, Json::loadOpt(dataDir + "/surf/" + key + ".json"), Json::loadOpt(dataDir + "/env/" + key + ".json"),
               S.lines->race);
  R.buildCar(*S.spec);
  return true;
}

struct Toast { std::string msg; double t = 0; };

// One 400 Hz substep of a HOT LAP. js/main.js, the solo branch.
static void simStep(Session &S, const HandsIn &in, bool autoDrive, bool drsTap, Toast &toast) {
  Car &car = S.own;
  const Track &track = S.track;
  const Proj proj = track.project(car.x, car.y, S.hint);
  S.hint = proj.i;
  S.proj = proj;

  if (autoDrive) S.pilot->drive(car, proj, FIXED_DT);
  else {
    S.hands.update(FIXED_DT, in);
    car.throttle = S.hands.throttle;
    car.brake = S.hands.brake;
    car.selector = S.hands.selector;
    car.delta = S.hands.wheel * steerLock(car.speed);
  }

  const double al = std::fabs(proj.lat);
  double surface = SURFACE::track;
  if (al > proj.w + proj.run) surface = SURFACE::grass;
  else if (al > proj.w + 1.2) surface = SURFACE::runoff;
  else if (al > proj.w) surface = SURFACE::kerb;
  if (surface != SURFACE::track && al > proj.w + 0.9) {
    S.offT += FIXED_DT;
    if (S.offT > 0.35) S.invalid = true;
  }

  if (S.spec->drs && drsTap) car.drsOpen = !car.drsOpen;
  if (car.brake > 0.05) car.drsOpen = false;

  Env env;
  env.surface = surface; env.bank = proj.bank; env.bankDir = sign(proj.curv);
  env.rollMul = dragFor(surface);
  // gravity along the road: the surveyed gradient under the car's own heading
  env.slope = S.world->gradeAt(proj.s) * std::cos(car.hdg - track.hdg[(size_t)proj.i]);
  step(car, FIXED_DT, env);

  const Hit hit = resolveBarrier(car, track, S.hint);
  if (hit.hit && hit.closing > 3.5) {
    S.lastHit = std::max(S.lastHit, hit.closing);
    if (hit.harm > 0.12) {
      std::string p = hit.part;
      for (char &c : p) c = (char)std::toupper((unsigned char)c);
      toast = {"HEAVY CONTACT - " + p, 2.2};
    } else toast = {"CONTACT", 1.4};
  }

  // ---- lap timing
  const double s = proj.s;
  if (S.sPrev > track.length * 0.8 && s < track.length * 0.2) {
    if (S.lap > 0) {
      S.last = S.lapT; S.hasLast = true;
      if (!S.invalid && (!S.hasBest || S.lapT < S.best)) { S.best = S.lapT; S.hasBest = true; toast = {"PERSONAL BEST", 3}; }
      else if (S.invalid) toast = {"LAP DELETED - TRACK LIMITS", 3};
    }
    S.lap++; S.lapT = 0; S.invalid = false; S.offT = 0;
  }
  S.sPrev = s;
  S.lapT += FIXED_DT;
  S.rolled = std::fmod(S.rolled + car.vx * FIXED_DT, 1000.0);
}

// One substep of a RACE. The race decides everything; this hands it your pedals.
static void raceStep(Session &S, const HandsIn &in, bool bot, bool drsTap, Toast &toast) {
  Race &race = *S.race;
  Entry &me = *race.me;
  Car &car = me.car;
  PlayerInput pi;
  if (bot && S.pilot) {
    // behind HOME a bot sits in your seat, with racecraft: the race hands it a ctx
    S.pilot->drive(car, me.proj, FIXED_DT, me.hasCtx ? &me.ctx : nullptr);
    if (race.state == RaceState::Grid) { car.throttle = 0; car.brake = 1; }     // it waits for the lights like everybody else
    pi.throttle = car.throttle; pi.brake = car.brake; pi.delta = car.delta;
  } else {
    S.hands.update(FIXED_DT, in);
    pi.throttle = S.hands.throttle; pi.brake = S.hands.brake;
    pi.delta = S.hands.wheel * steerLock(car.speed);
    pi.wheel = S.hands.wheel;
    car.selector = S.hands.selector;
    // Xingus reads these; the serious game ignores them. The gear you are in,
    // as the road speed it runs out of revs at.
    pi.hand = S.hand;
    if (S.xmanual && S.box->manual >= 0) {
      pi.gearTop = S.box->box->tops[(size_t)S.box->manual] / 3.6;
      pi.gearLow = S.box->manual > 0 ? S.box->box->tops[(size_t)S.box->manual - 1] / 3.6 : 0;
    }
  }
  if (S.spec->drs && drsTap) car.drsOpen = !car.drsOpen;
  race.tick(FIXED_DT, &pi);
  if (car.brake > 0.05) car.drsOpen = false;
  if (me.bump.has) {
    me.bump.has = false;
    S.lastHit = std::max(S.lastHit, me.bump.closing);
    if (std::string(me.bump.what) == "car") toast = {me.bump.harm > 1.2 ? "CONTACT - WHEEL TO WHEEL" : "RUBBING", 1.6};
    else if (me.bump.harm > 0.12) {
      std::string p = me.bump.part;
      for (char &c : p) c = (char)std::toupper((unsigned char)c);
      toast = {"HEAVY CONTACT - " + p, 2.2};
    } else toast = {"CONTACT", 1.4};
  }
  S.proj = me.proj;
  S.lap = me.lap + 1;
  S.lapT = race.state == RaceState::Grid ? 0 : std::max(0.0, race.time - me.lapStart);
  S.hasLast = me.lastLap == me.lastLap; S.last = me.lastLap;
  S.hasBest = me.bestLap == me.bestLap; S.best = me.bestLap;
  S.rolled = std::fmod(S.rolled + car.vx * FIXED_DT, 1000.0);
}

// js/menuui.js resultMood: the results screen has feelings
static void resultMood(int pos, int n, bool retired, std::string &title, std::string &line) {
  const int r = std::rand();
  if (retired) { if (r & 1) { title = "<span>...ow.</span>"; line = "the wall won. the wall always has home advantage."; } else { title = "RACE <span>OVER</span>"; line = "ok. sad for exactly ten seconds. then again."; } }
  else if (pos == 1) {
    const char *T[3][2] = {{"P1!!! <span>LET'S GOOO</span>", "you absolute menace. frame this one."}, {"WINNER <span>WINNER</span>", "nobody tell the others how easy that looked."},
                           {"WE ARE <span>SO BACK</span>", "top step. remember this feeling."}};
    title = T[r % 3][0]; line = T[r % 3][1];
  } else if (pos <= 3) { if (r & 1) { title = "PODIUM <span>BABY</span>"; line = "champagne is on you. (it is apple juice.)"; } else { title = "A <span>TROPHY</span>"; line = "small trophy. still a trophy."; } }
  else if (pos >= n && n > 3) { title = "LAST. <span>BUT FINISHED</span>"; line = "someone has to be. today it was us."; }
  else if (pos <= (n + 1) / 2) { if (r & 1) { title = "CHEQUERED <span>FLAG</span>"; line = "solid. not boring. SOLID."; } else { title = "POINTS <span>IN THE BAG</span>"; line = "we take those."; } }
  else { if (r & 1) { title = "WELL. <span>THAT HAPPENED</span>"; line = "we move. we always move."; } else { title = "CHEQUERED <span>FLAG</span>"; line = "the car came home. the pace did not."; } }
}

// The rim's controls by NAME (data/wheelbtn.json, measured on Adam's R3). A
// control is a button index or a hat direction ({ax: 8|9, dir}); nothing past
// this struct knows either. The indices are joydev's, which is the order SDL
// numbers a Linux joystick's buttons in too, so they are read straight off the
// wheel — and from the bridge as well, when it is running.
struct RimMap {
  struct C { std::string name; int b = -1, ax = -1, dir = 0; };
  std::vector<C> c;
  void load(const std::string &dataDir) {
    const Json j = Json::loadOpt(dataDir + "/wheelbtn.json");
    for (const auto &kv : j["map"].obj)
      for (const auto &e : kv.second.arr) {
        if (e["b"].isNum()) c.push_back({kv.first, (int)e["b"].n(), -1, 0});
        else if (e["ax"].isNum()) c.push_back({kv.first, -1, (int)e["ax"].n(), (int)e["dir"].n()});
      }
  }
  bool held(SDL_Joystick *joy, const std::set<int> &bridge, const char *name) const {
    for (const C &e : c) {
      if (e.name != name) continue;
      if (e.b >= 0) {
        if (bridge.count(e.b)) return true;
        if (joy && e.b < SDL_GetNumJoystickButtons(joy) && SDL_GetJoystickButton(joy, e.b)) return true;
      } else if (joy) {
        // the d-pad: joydev calls it axes 8 and 9, SDL calls it hat 0
        if (SDL_GetNumJoystickHats(joy) > 0 && (e.ax == 8 || e.ax == 9)) {
          const Uint8 h = SDL_GetJoystickHat(joy, 0);
          if (e.ax == 8 && ((e.dir < 0 && (h & SDL_HAT_LEFT)) || (e.dir > 0 && (h & SDL_HAT_RIGHT)))) return true;
          if (e.ax == 9 && ((e.dir < 0 && (h & SDL_HAT_UP)) || (e.dir > 0 && (h & SDL_HAT_DOWN)))) return true;
        } else if (e.ax < SDL_GetNumJoystickAxes(joy)) {
          const double v = SDL_GetJoystickAxis(joy, e.ax) / 32767.0;
          if (std::fabs(v) > 0.5 && (v > 0) == (e.dir > 0)) return true;
        }
      }
    }
    return false;
  }
};

// THE WHEEL'S FORCE. The bridge (tools/ffb.py) owns the motor; if it is not
// running when force is wanted, the game starts it — at the ceiling Adam chose
// on 2026-10-08 ("100% ceiling, but starts at 50%": the 50 is the game's own
// WHEEL FORCE setting). The bridge still ramps in over three seconds, limits
// how fast the torque may change, and zeroes the wheel if the game goes quiet.
static pid_t spawnBridge(const std::string &repo) {
  if (!std::filesystem::exists(repo + "/tools/ffb.py")) return -1;
  const pid_t p = fork();
  if (p == 0) {
    setsid();
    if (chdir(repo.c_str()) != 0) _exit(126);
    const int fd = open("/tmp/xbr-ffb-bridge.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) { dup2(fd, 1); dup2(fd, 2); }
    execlp("python3", "python3", "-u", "tools/ffb.py", "--max", "1.0", (char *)nullptr);
    _exit(127);
  }
  return p;
}

enum Act { A_UP, A_DOWN, A_LEFT, A_RIGHT, A_OK, A_BACK, A_PAUSE, A_CAM, A_DRS, A_RESET, A_GO, A_PIT, A_SHUP, A_SHDN, A_COUNT };

// ---------------------------------------------------------------------------
int main(int argc, char **argv) {
  std::vector<std::string> pos;
  std::string dataDir, shot, tierArg, screenArg, timeArg, weatherArg, modeArg, modelArg, lookArg, xingArg, xtrackArg, xheilArg;
  bool autoDrive = false, lineArg = false, windowed = false, hidpi = false, noAudio = false, hidden = false;
  int camArg = -1, ffbArg = -1, winW = 1600, winH = 900, gridArg = 0, lapsArg = 0, startArg = 0;
  long maxFrames = 0;
  double spool = 0, seedArg = 0;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    auto val = [&](const char *flag) -> std::string {
      if (i + 1 >= argc) { std::fprintf(stderr, "xbr: %s needs a value\n", flag); std::exit(2); }
      return argv[++i];
    };
    if (a == "--auto") autoDrive = true;
    else if (a == "--line") lineArg = true;
    else if (a == "--windowed") windowed = true;
    else if (a == "--fullscreen") windowed = false;
    else if (a == "--hidpi") hidpi = true;
    else if (a == "--no-audio") noAudio = true;
    else if (a == "--hidden") hidden = true;
    else if (a == "--frames") maxFrames = std::atol(val("--frames").c_str());
    else if (a == "--data") dataDir = val("--data");
    else if (a == "--tier") tierArg = val("--tier");
    else if (a == "--mode") modeArg = val("--mode");
    else if (a == "--grid") gridArg = std::atoi(val("--grid").c_str());
    else if (a == "--laps") lapsArg = std::atoi(val("--laps").c_str());
    else if (a == "--start") startArg = std::atoi(val("--start").c_str());
    else if (a == "--seed") seedArg = std::atof(val("--seed").c_str());
    else if (a == "--cam") camArg = std::atoi(val("--cam").c_str());
    else if (a == "--ffb") ffbArg = std::atoi(val("--ffb").c_str());
    else if (a == "--shot") shot = val("--shot");
    else if (a == "--screen") screenArg = val("--screen");
    else if (a == "--model") modelArg = val("--model");
    else if (a == "--look") lookArg = val("--look");           // film (the default) | plain
    else if (a == "--xingus") xingArg = val("--xingus");       // a Xingus STYLE (rally, rallycross, gt3, derby ...) for unattended checks
    else if (a == "--xtrack") xtrackArg = val("--xtrack");     // heiligen | speedway | a circuit; --xheil picks the Heiligen route
    else if (a == "--xheil") xheilArg = val("--xheil");
    else if (a == "--spool") spool = std::atof(val("--spool").c_str());
    else if (a == "--time") timeArg = val("--time");
    else if (a == "--weather") weatherArg = val("--weather");
    else if (a == "--size") { windowed = true; if (std::sscanf(val("--size").c_str(), "%dx%d", &winW, &winH) != 2) { std::fprintf(stderr, "xbr: --size wants WxH\n"); return 2; } }
    else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr: unknown flag %s\n", a.c_str()); return 2; }
    else pos.push_back(a);
  }
  if (pos.size() > 2) { std::fprintf(stderr, "xbr: too many arguments (track, car)\n"); return 2; }
  if (pos.size() > 1 && !hasCarSpec(pos[1])) { std::fprintf(stderr, "xbr: no car class '%s' (f1, f4, gt3)\n", pos[1].c_str()); return 2; }
  if (camArg > 3) { std::fprintf(stderr, "xbr: --cam is 0 onboard, 1 chase, 2 nose or 3 t-cam\n"); return 2; }
  if (!tierArg.empty() && std::string(tierFor(tierArg)->key) != tierArg) { std::fprintf(stderr, "xbr: no tier '%s'\n", tierArg.c_str()); return 2; }
  if (!modeArg.empty() && modeArg != "race" && modeArg != "hotlap") { std::fprintf(stderr, "xbr: --mode is race or hotlap\n"); return 2; }
  static const std::vector<std::string> TIMES = {"live", "night", "dawn", "sunrise", "morning", "day", "evening", "sunset", "dusk"},
                                        WEATHERS = {"live", "clear", "cloudy", "overcast", "rain", "storm", "changing"},
                                        SCREENS = {"home", "setup", "garage", "settings", "pause", "results", "heiligen"};
  auto oneOf = [](const std::vector<std::string> &v, const std::string &s) { return std::find(v.begin(), v.end(), s) != v.end(); };
  if (!timeArg.empty() && !oneOf(TIMES, timeArg)) { std::fprintf(stderr, "xbr: no --time '%s'\n", timeArg.c_str()); return 2; }
  if (!weatherArg.empty() && !oneOf(WEATHERS, weatherArg)) { std::fprintf(stderr, "xbr: no --weather '%s'\n", weatherArg.c_str()); return 2; }
  if (!screenArg.empty() && !oneOf(SCREENS, screenArg)) { std::fprintf(stderr, "xbr: no --screen '%s'\n", screenArg.c_str()); return 2; }
  const bool shotMode = !shot.empty();
  if (hidden && maxFrames <= 0) { std::fprintf(stderr, "xbr: --hidden needs --frames N, or it would run unseen for ever\n"); return 2; }
  std::srand((unsigned)std::time(nullptr));

  if (shotMode) SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "offscreen");
  SDL_SetAppMetadata("XBR", "native", "xbr");
  if (!SDL_Init(SDL_INIT_VIDEO)) {
    if (shotMode) { SDL_ResetHint(SDL_HINT_VIDEO_DRIVER); if (!SDL_Init(SDL_INIT_VIDEO)) { std::fprintf(stderr, "xbr: SDL: %s\n", SDL_GetError()); return 1; } }
    else { std::fprintf(stderr, "xbr: SDL: %s\n", SDL_GetError()); return 1; }
  }
  if (!shotMode) SDL_InitSubSystem(SDL_INIT_JOYSTICK | SDL_INIT_GAMEPAD);

  if (dataDir.empty()) {
    const char *base = SDL_GetBasePath();
    std::vector<std::string> tries = {"data", "../data"};
    if (base) { tries.push_back(std::string(base) + "../../data"); tries.push_back(std::string(base) + "../data"); tries.push_back(std::string(base) + "data"); }
    for (const auto &t : tries) if (std::filesystem::exists(t + "/tracks")) { dataDir = t; break; }
    if (dataDir.empty()) { std::fprintf(stderr, "xbr: cannot find the data directory (pass --data DIR)\n"); return 1; }
  }

  // the menu's record, kept between runs (the browser's `wdc.menu`)
  std::string savePath;
  const bool offscreen = shotMode || hidden;
  if (!offscreen) { char *pref = SDL_GetPrefPath("xanboo78o", "xbr"); if (pref) { savePath = std::string(pref) + "menu.txt"; SDL_free(pref); } }
  // ONE GAME AT A TIME. Two copies both read the one wheel and both command its
  // one motor, each for a different car: the rim is thrown about (it happened,
  // 2026-10-08). A second window says so and leaves. Unseen checks are exempt,
  // and never touch the motor at all.
  if (!offscreen) {
    const char *rt = std::getenv("XDG_RUNTIME_DIR");
    const std::string lk = std::string(rt && *rt ? rt : "/tmp") + "/xbr.lock";
    const int lfd = open(lk.c_str(), O_CREAT | O_RDWR | O_CLOEXEC, 0600);
    if (lfd >= 0 && flock(lfd, LOCK_EX | LOCK_NB) != 0) {
      std::fprintf(stderr, "xbr: the game is already running — one at a time (two would fight over the wheel)\n");
      return 1;
    }
  }
  Home home(dataDir, savePath);
  MenuSave &cfg = home.S;
  const bool direct = !pos.empty() || (!xingArg.empty() && screenArg.empty()) || maxFrames > 0 || autoDrive || (shotMode && (screenArg.empty() || screenArg == "pause" || screenArg == "results"));
  if (!modelArg.empty()) { cfg.model = modelArg; cfg.car = "gt3"; }      // a downloaded car takes the GT3 seat
  if (!xingArg.empty()) { cfg.xOn = true; cfg.xStyle = xstyle(xingArg).key; }
  if (!xtrackArg.empty()) cfg.xTrack = xtrackArg;
  if (!xheilArg.empty()) cfg.xHeil = xheilArg;
  if (pos.size() > 0) cfg.track = pos[0];
  if (pos.size() > 1) cfg.car = pos[1];
  if (!tierArg.empty()) cfg.tier = tierArg;
  if (!lookArg.empty()) cfg.look = lookArg == "plain" ? "plain" : "film";
  if (!modeArg.empty()) cfg.mode = modeArg;
  else if (direct && offscreen) cfg.mode = "hotlap";
  if (gridArg) cfg.grid = std::max(2, std::min(61, gridArg));
  if (lapsArg) cfg.laps = std::max(1, std::min(999, lapsArg));
  if (camArg >= 0) cfg.cam = camArg;
  if (ffbArg >= 0) cfg.ffb = std::min(100, ffbArg);
  if (lineArg) cfg.line = true;
  if (!timeArg.empty()) cfg.time = timeArg;
  if (!weatherArg.empty()) cfg.weather = weatherArg;
  if (!std::filesystem::exists(dataDir + "/tracks/" + cfg.track + ".json")) {
    if (!pos.empty()) { std::fprintf(stderr, "xbr: no circuit '%s' in %s/tracks\n", cfg.track.c_str(), dataDir.c_str()); return 1; }
    cfg.track = "monza";
  }

  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  if (!offscreen) { SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 1); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 4); }
  SDL_WindowFlags flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE;
  if (offscreen) flags |= SDL_WINDOW_HIDDEN;
  if (hidpi) flags |= SDL_WINDOW_HIGH_PIXEL_DENSITY;
  if (!windowed && !offscreen) flags |= SDL_WINDOW_FULLSCREEN;
  SDL_Window *win = SDL_CreateWindow("XBR", winW, winH, flags);
  SDL_GLContext ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  if (!ctx && !offscreen) {
    if (win) SDL_DestroyWindow(win);
    SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 0); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 0);
    win = SDL_CreateWindow("XBR", winW, winH, flags);
    ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  }
  if (!ctx) { std::fprintf(stderr, "xbr: no OpenGL 3.3 context: %s\n", SDL_GetError()); return 1; }
  SDL_GL_MakeCurrent(win, ctx);
  if (!offscreen) SDL_GL_SetSwapInterval(1);
  std::fprintf(stderr, "xbr: %s | %s | video driver %s\n", (const char *)glGetString(GL_RENDERER), (const char *)glGetString(GL_VERSION),
               SDL_GetCurrentVideoDriver());

  Renderer R;
  {
    const char *base = SDL_GetBasePath();
    if (!R.init(dataDir, std::string(base ? base : "native/build/") + "tex")) return 1;
  }
  float K = 1;                     // device pixels per CSS pixel
  if (offscreen) { if (!R.beginOffscreen(winW, winH)) { std::fprintf(stderr, "xbr: offscreen target incomplete\n"); return 1; } }
  else { int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); R.resize(w, h); glEnable(GL_MULTISAMPLE); K = std::max(1.0f, SDL_GetWindowPixelDensity(win)); }

  // The session lives on the heap and is never moved: the world, the terrain,
  // the lines, the race and the driver all hold references into it.
  std::unique_ptr<Session> SP;
#define S (*SP)
  enum Screen { HOME, DRIVE, PAUSE, RESULTS };
  Screen screen = HOME;
  GameHud hud;
  HudTheme theme;
  Toast toast;
  double clock = 0, acc = 0;
  int pauseAt = 0;
  std::string pauseSay, resTitle, resLine;
  bool bgOn = false;               // the session on screen is HOME's backdrop
  std::string bgCar;
  WeatherDirector wd("clear", 1);
  std::string wdMode;

  auto showLoading = [&](const std::string &text) {
    glBindFramebuffer(GL_FRAMEBUFFER, offscreen ? R.offscreenFbo() : 0);
    glViewport(0, 0, R.W, R.H);
    R.hudBegin();
    hud.loading(R, K, theme, text);
    R.hudEnd();
    if (!offscreen) SDL_GL_SwapWindow(win);
  };
  // The downloaded car, if one is chosen for this seat: its body on every car of
  // the field, and its own kind of engine — the revs and the voice — in yours.
  auto usePack = [&]() {
    if (!R.setCarPack(home.pack())) R.setCarPack("");
    SP->box = std::make_unique<Gearbox>(home.voice());
  };
  // HOME's backdrop: two cars on one of the small circuits, a bot in your seat
  auto startBackdrop = [&]() {
    showLoading("WARMING THE TYRES. AND THE DRIVER.");
    static const char *SMALL[2] = {"adam1", "monaco"};
    RaceSetup rs;
    rs.grid = 2; rs.slot = 2; rs.laps = 30; rs.tier = "supercasual"; rs.battle = "hard"; rs.noDnf = true; rs.standIn = true;
    rs.seed = 1 + std::rand() % 9973;
    auto N = std::make_unique<Session>();
    const std::string bk = SMALL[std::rand() & 1];
    if (!loadSession(*N, R, dataDir, std::filesystem::exists(dataDir + "/tracks/" + bk + ".json") ? bk : "monza", cfg.car, "hard", &rs)) return false;
    SP = std::move(N);
    usePack();
    bgOn = true; bgCar = cfg.car + "/" + home.pack();
    R.snapCamera(); acc = 0;
    return true;
  };
  auto startSession = [&]() {
    theme = HudTheme::forTeam(home.teamKey());
    showLoading(cfg.mode == "race" ? "BUILDING A GRID OF " + std::to_string(cfg.grid) + "..." : "SOLVING THE RACING LINE... (IT IS THE FAST ONE)");
    RaceSetup rs;
    rs.grid = cfg.grid; rs.laps = cfg.laps; rs.tier = cfg.tier;
    rs.slot = std::max(1, std::min(cfg.grid, startArg > 0 ? startArg : home.startSlot(cfg.grid)));
    rs.battle = cfg.tier == "supercasual" ? cfg.battle : "";
    rs.noDnf = cfg.noDnf; rs.teamKey = cfg.teams[cfg.car]; rs.field = cfg.field;
    rs.seed = seedArg > 0 ? seedArg : 1 + std::rand() % 9973;
    std::string trk = cfg.track, car = cfg.car;
    bool racing = cfg.mode == "race";
    if (cfg.xOn) {
      // XINGUS (js/home.js xingusUrl): always a race, in the GT3 seat, the style's switches on
      const XStyle &x = xstyle(cfg.xStyle);
      trk = home.xTrackKey(); car = "gt3"; racing = true;
      const int rivals = x.rivals && cfg.xBots > 0 ? cfg.xBots : x.rivals;
      rs.grid = std::max(2, rivals + 1); rs.slot = rivals ? rs.grid : 1;
      rs.tier = x.derby ? "medium" : trk == "speedway" && cfg.xField == "skilled" ? "hard" : "casual";
      rs.battle = x.derby ? "hard" : ""; rs.noDnf = !x.stakes; rs.teamKey = ""; rs.standIn = false;
      rs.xingus = true; rs.xcar = x.tune; rs.xsolo = rivals == 0; rs.xderby = x.derby; rs.xstakes = x.stakes; rs.xloose = x.loose;
    }
    auto N = std::make_unique<Session>();
    if (!loadSession(*N, R, dataDir, trk, car, rs.tier, racing ? &rs : nullptr)) return false;
    SP = std::move(N);
    usePack();
    SP->xmanual = cfg.xOn && cfg.xGears != "auto" && !autoDrive;      // a bot at the wheel does not pull paddles
    if (SP->xmanual) SP->box->manual = 0;
    bgOn = false;
    hud.reset();
    toast = {};
    R.snapCamera(); acc = 0;
    screen = DRIVE;
    return true;
  };
  if (direct) { if (!startSession()) return 1; }
  else if (!startBackdrop()) return 1;
  if (shotMode && !screenArg.empty() && screenArg != "pause" && screenArg != "results") home.show(screenArg);

  // ---- the light and the air
  auto phaseNow = [&]() -> std::string {
    std::string t = cfg.time;
    if (bgOn) t = "day";
    if (t == "live") {
      // where the sun really is, here, now (New Hampshire, where this is driven)
      const Sun sun = solarPosition((double)std::time(nullptr) * 1000.0, 43.13, -71.46);
      t = dayPhase(sun.elevation, sun.azimuth).name;
    }
    if (t == "sunrise") return "dawn";
    if (t == "morning" || t == "evening") return "day";
    if (t == "sunset") return "dusk";
    return t;
  };
  double rainNow = 0;
  auto lookNow = [&](double dt) {
    const std::string mode = bgOn ? "clear" : cfg.weather == "live" ? "clear" : cfg.weather;
    if (mode != wdMode) { wdMode = mode; wd = WeatherDirector(mode, 1 + std::rand() % 997); }
    const WeatherDirector::Sky sky = wd.step(dt);
    setWetness(sky.road);
    rainNow = sky.rain;
    const std::string ch = wd.takeChange();
    if (!ch.empty() && screen == DRIVE) { std::string u = ch; for (char &c : u) c = (char)std::toupper((unsigned char)c); toast = {"WEATHER: " + u, 3}; }
    return makeLook(phaseNow(), sky.cloud, sky.road, sky.rain);
  };
  auto paintOf = [&](const std::string &col, float out[3]) { const Rgba c = hex(col.empty() ? "#ffffff" : col); out[0] = c.c[0]; out[1] = c.c[1]; out[2] = c.c[2]; };
  auto frameOf = [&](double dt) {
    FrameIn f;
    f.car = S.car; f.spec = S.spec; f.showLine = cfg.line && !bgOn; f.wheelAngle = S.rolled; f.dt = dt; f.time = clock;
    f.camMode = bgOn ? 1 : cfg.cam;
    S.terrain->under(*S.car, S.proj, S.gnd);
    f.groundH = S.terrain->h(S.proj.s, S.proj.lat); f.gPitch = S.gnd.pitch; f.gRoll = S.gnd.roll;
    f.look = lookNow(dt);
    if (S.race) paintOf(S.race->me->col, f.paint);
    else { const Team *t = teamByKey(home.teamKey()); if (t) paintOf(t->col, f.paint); }
    return f;
  };
  // everyone else on the circuit
  auto drawField = [&]() {
    if (!S.race) return;
    for (Entry &e : S.race->entries) {
      if (e.isPlayer) continue;
      float paint[3];
      paintOf(e.col, paint);
      Gnd g;
      S.terrain->under(e.car, e.proj, g);
      R.drawCar(e.car, *S.spec, S.terrain->h(e.proj.s, e.proj.lat), g.pitch, g.roll, paint, std::fmod(S.race->progress(e), 1000.0));
    }
    // the safety car, when it is out: the same body in silver, until its own is drawn
    const SafetyCar &sc = S.race->rc.sc;
    if (sc.out) {
      const float silver[3] = {0.78f, 0.80f, 0.82f};
      Proj p = S.track.project(sc.car.x, sc.car.y);
      Gnd g;
      S.terrain->under(sc.car, p, g);
      R.drawCar(sc.car, *S.spec, S.terrain->h(p.s, p.lat), g.pitch, g.roll, silver, std::fmod(sc.prog, 1000.0));
    }
  };
  auto hudIn = [&]() {
    HudIn h;
    h.car = S.car; h.spec = S.spec; h.box = S.box.get();
    h.trackName = S.track.name.empty() ? S.key : S.track.name; h.carName = S.spec->full;
    h.sessionT = S.t; h.lap = S.lap; h.lapT = S.lapT; h.last = S.last; h.best = S.best;
    h.hasLast = S.hasLast; h.hasBest = S.hasBest; h.invalid = S.invalid;
    h.usingPad = S.hands.usingPad; h.msg = toast.t > 0 ? toast.msg : "";
    h.race = S.race.get(); h.clock = clock;
    h.passFlash = S.race && S.race->time - S.passAt < 2.6;
    return h;
  };
  auto liveOf = [&]() {
    LiveTower L;
    if (!bgOn || !S.race || S.race->state == RaceState::Grid) return L;
    L.up = true; L.track = S.track.name; L.lap = std::min(S.race->laps, S.race->me->lap + 1); L.laps = S.race->laps;
    for (size_t i = 0; i < S.race->standings.size(); i++) {
      const Entry &e = *S.race->standings[i];
      char g[24] = "LEADER";
      if (i > 0) std::snprintf(g, sizeof g, "+%.1f", (S.race->progress(*S.race->standings[i - 1]) - S.race->progress(e)) / std::max(e.car.speed, 14.0));
      L.rows.push_back({(int)i + 1, e.col.empty() ? "#ffffff" : e.col, e.name, e.retired ? "DNF" : g, e.isPlayer});
    }
    return L;
  };
  auto pauseItems = [&]() {
    static const char *CAMS[4] = {"ONBOARD", "CHASE", "NOSE", "T-CAM"};
    return std::vector<std::string>{"RESUME", S.race ? "REJOIN" : "RESTART LAP", std::string("CAMERA - ") + CAMS[cfg.cam], "IDEAL LINE",
                                    "FORCE FEEDBACK - " + std::to_string(cfg.ffb) + "%", "QUIT TO MENU"};
  };
  auto drawAll = [&](FrameIn &f) {
    R.post = cfg.look != "plain" && R.postOk;
    R.drawWorld(f);
    drawField();
    R.endScene(f.time);
    R.hudBegin();
    R.drawRain(f);
    if (screen == HOME) home.draw(R, K, clock, liveOf());
    else if (screen == RESULTS && S.race) hud.results(R, K, theme, *S.race, resTitle, resLine);
    else {
      hud.draw(R, K, theme, hudIn());
      if (screen == PAUSE) hud.pause(R, K, theme, pauseItems(), pauseAt, pauseSay);
    }
    R.hudEnd();
  };

  if (shotMode) {
    HandsIn none;
    const long steps = (long)(spool / FIXED_DT);
    Look tmp = lookNow(0.016);
    (void)tmp;
    for (long i = 0; i < steps; i++) {
      if (S.race) raceStep(S, none, true, false, toast); else simStep(S, none, true, false, toast);
      if (i % 8 == 0) S.box->update(8 * FIXED_DT, S.car->speed * 3.6, S.car->throttle);
    }
    clock = spool; S.t = spool;
    if (screenArg == "pause") { screen = PAUSE; pauseSay = "breathe."; }
    if (screenArg == "results" && S.race) { screen = RESULTS; resultMood(S.race->me->pos, (int)S.race->entries.size(), S.race->me->retired, resTitle, resLine); }
    FrameIn f = frameOf(1.0 / 60);
    R.snapCamera();
    drawAll(f);
    glFinish();
    const bool ok = R.writePPM(shot);
    std::fprintf(stderr, "xbr: %s %s  (t=%.1fs, %.0f km/h, lap %d)\n", ok ? "wrote" : "FAILED to write", shot.c_str(), spool,
                 S.car->speed * 3.6, S.lap);
    return ok ? 0 : 1;
  }

  Devices dev;
  dev.prof = loadWheelProfile(dataDir);
  dev.scan();
  if (!dev.name.empty()) std::fprintf(stderr, "xbr: input device: %s (%s)\n", dev.name.c_str(), dev.joy ? "wheel profile" : "gamepad");
  RimMap rim;
  rim.load(dataDir);
  Bridge bridge;
  pid_t bridgePid = -1;
  double bridgeWait = 0;
  bool bridgeTried = false;

  EngineAudio audio;
  if (!noAudio && !audio.open(home.voice(), dataDir)) std::fprintf(stderr, "xbr: no audio device (%s) — running silent\n", SDL_GetError());

  bool running = true, showFps = false, fullscreen = !windowed && !offscreen;
  long frames = 0;
  double worstMs = 0, fps = 60;
  const Uint64 t0 = SDL_GetTicksNS();
  Uint64 prev = t0;
  bool drsTap = false;
  bool actPrev[A_COUNT] = {false};
  double repeatAt[A_COUNT] = {0};

  auto toHome = [&]() { bridge.release(); screen = HOME; home.show("home"); if (startBackdrop()) audio.setClass(home.voice()); prev = SDL_GetTicksNS(); };
  auto lightsOut = [&]() { bridge.release(); if (startSession()) { audio.setClass(home.voice()); autoDrive = false; } else { home.say("that one would not load."); startBackdrop(); } prev = SDL_GetTicksNS(); };

  while (running) {
    bool act[A_COUNT] = {false};
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      switch (e.type) {
        case SDL_EVENT_QUIT: running = false; break;
        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED: { if (hidden) break; int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); R.resize(w, h); K = std::max(1.0f, SDL_GetWindowPixelDensity(win)); break; }
        case SDL_EVENT_WINDOW_FOCUS_LOST: if (screen == DRIVE && !hidden && !autoDrive) { screen = PAUSE; pauseAt = 0; pauseSay = "it will still be here."; bridge.release(); } break;
        case SDL_EVENT_JOYSTICK_ADDED: case SDL_EVENT_JOYSTICK_REMOVED: dev.scan(); break;
        case SDL_EVENT_MOUSE_MOTION: case SDL_EVENT_MOUSE_BUTTON_DOWN: {
          // window coordinates -> the pixels everything is drawn in
          int ww = 1, wh = 1;
          SDL_GetWindowSize(win, &ww, &wh);
          const bool click = e.type == SDL_EVENT_MOUSE_BUTTON_DOWN && e.button.button == SDL_BUTTON_LEFT;
          if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN && !click) break;
          const float mx = (e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.x : e.button.x) * (float)R.W / (float)std::max(1, ww);
          const float my = (e.type == SDL_EVENT_MOUSE_MOTION ? e.motion.y : e.button.y) * (float)R.H / (float)std::max(1, wh);
          auto in = [&](const GameHud::Box &b) { return mx >= b.x && my >= b.y && mx <= b.x + b.w && my <= b.y + b.h; };
          if (screen == HOME) home.mouse(mx, my, click);
          else if (screen == PAUSE) { for (size_t i = 0; i < hud.pauseBoxes.size(); i++) if (in(hud.pauseBoxes[i])) { pauseAt = (int)i; if (click) act[A_OK] = true; } }
          else if (screen == RESULTS && click && in(hud.menuBox)) act[A_OK] = true;
          break;
        }
        case SDL_EVENT_KEY_DOWN: {
          if (e.key.repeat && screen == DRIVE) break;
          const bool menuish = screen != DRIVE;
          switch (e.key.scancode) {
            case SDL_SCANCODE_ESCAPE: act[screen == DRIVE || screen == PAUSE ? A_PAUSE : A_BACK] = true; break;
            case SDL_SCANCODE_BACKSPACE: act[menuish ? A_BACK : A_RESET] = true; break;
            case SDL_SCANCODE_UP: if (menuish) act[A_UP] = true; break;
            case SDL_SCANCODE_DOWN: if (menuish) act[A_DOWN] = true; break;
            case SDL_SCANCODE_LEFT: if (menuish) act[A_LEFT] = true; break;
            case SDL_SCANCODE_RIGHT: if (menuish) act[A_RIGHT] = true; break;
            case SDL_SCANCODE_RETURN: case SDL_SCANCODE_KP_ENTER: act[A_OK] = true; break;
            case SDL_SCANCODE_SPACE: act[menuish ? A_OK : A_DRS] = true; break;
            case SDL_SCANCODE_G: if (menuish) act[A_GO] = true; break;
            case SDL_SCANCODE_LSHIFT: case SDL_SCANCODE_RSHIFT: if (screen == DRIVE) S.hands.selector = S.hands.selector < 0 ? 1 : -1; break;
            case SDL_SCANCODE_R: if (!menuish) act[A_RESET] = true; break;
            case SDL_SCANCODE_C: if (!menuish) act[A_CAM] = true; break;
            case SDL_SCANCODE_P: if (!menuish) act[A_PIT] = true; break;
            case SDL_SCANCODE_E: if (!menuish) act[A_SHUP] = true; break;
            case SDL_SCANCODE_Q: if (!menuish) act[A_SHDN] = true; break;
            case SDL_SCANCODE_L: if (!menuish) cfg.line = !cfg.line; break;
            case SDL_SCANCODE_F: case SDL_SCANCODE_F11: if (e.key.scancode == SDL_SCANCODE_F11 || !menuish) { fullscreen = !fullscreen; SDL_SetWindowFullscreen(win, fullscreen); } break;
            case SDL_SCANCODE_F1: if (screen == DRIVE && !S.race) autoDrive = !autoDrive; break;
            case SDL_SCANCODE_F4: showFps = !showFps; break;
            default: break;
          }
          break;
        }
        default: break;
      }
    }
    const Uint64 now = SDL_GetTicksNS();
    double dt = (now - prev) / 1e9;
    prev = now;
    if (dt > 0) fps += (1.0 / dt - fps) * 0.05;
    dt = std::min(dt, 0.1);
    clock += dt;

    // pad and rim: held states, turned into presses (a held direction repeats, like a held key)
    {
      bool held[A_COUNT] = {false};
      const std::set<int> &rb = bridge.buttons;
      SDL_Joystick *jy = dev.joy;
      held[A_UP] = rim.held(jy, rb, "up"); held[A_DOWN] = rim.held(jy, rb, "down"); held[A_LEFT] = rim.held(jy, rb, "left"); held[A_RIGHT] = rim.held(jy, rb, "right");
      held[A_OK] = rim.held(jy, rb, "confirm"); held[A_BACK] = rim.held(jy, rb, "back");
      held[screen == HOME ? A_GO : A_PAUSE] = rim.held(jy, rb, "pause");
      held[A_CAM] = rim.held(jy, rb, "cam"); held[A_DRS] = rim.held(jy, rb, "drs");
      // on the wheel there is no Enter within reach: in the menus either paddle confirms too
      if (screen != DRIVE) held[A_OK] |= rim.held(jy, rb, "shiftUp");
      else { held[A_SHUP] = rim.held(jy, rb, "shiftUp"); held[A_SHDN] = rim.held(jy, rb, "shiftDn"); }
      S.hand = screen == DRIVE && (SDL_GetKeyboardState(nullptr)[SDL_SCANCODE_X] || rim.held(jy, rb, "handbrake"));
      if (dev.pad) {
        auto pb = [&](SDL_GamepadButton b) { return SDL_GetGamepadButton(dev.pad, b); };
        const double ax = SDL_GetGamepadAxis(dev.pad, SDL_GAMEPAD_AXIS_LEFTX) / 32767.0, ay = SDL_GetGamepadAxis(dev.pad, SDL_GAMEPAD_AXIS_LEFTY) / 32767.0;
        const bool menuish = screen != DRIVE;
        held[A_UP] |= pb(SDL_GAMEPAD_BUTTON_DPAD_UP) || (menuish && ay < -0.6); held[A_DOWN] |= pb(SDL_GAMEPAD_BUTTON_DPAD_DOWN) || (menuish && ay > 0.6);
        held[A_LEFT] |= pb(SDL_GAMEPAD_BUTTON_DPAD_LEFT) || (menuish && ax < -0.6); held[A_RIGHT] |= pb(SDL_GAMEPAD_BUTTON_DPAD_RIGHT) || (menuish && ax > 0.6);
        held[screen == HOME ? A_GO : A_PAUSE] |= pb(SDL_GAMEPAD_BUTTON_START);
        if (!menuish) { held[A_DRS] |= pb(SDL_GAMEPAD_BUTTON_SOUTH); held[A_RESET] |= pb(SDL_GAMEPAD_BUTTON_BACK); held[A_CAM] |= pb(SDL_GAMEPAD_BUTTON_NORTH); held[A_PIT] |= pb(SDL_GAMEPAD_BUTTON_WEST); }
        else { held[A_OK] |= pb(SDL_GAMEPAD_BUTTON_SOUTH); held[A_BACK] |= pb(SDL_GAMEPAD_BUTTON_EAST); }
      }
      for (int i = 0; i < A_COUNT; i++) {
        if (held[i] && !actPrev[i]) { act[i] = true; repeatAt[i] = clock + 0.38; }
        else if (held[i] && i <= A_RIGHT && clock >= repeatAt[i]) { act[i] = true; repeatAt[i] = clock + 0.12; }
        actPrev[i] = held[i];
      }
    }

    // ---- the screens
    if (screen == HOME) {
      if (act[A_UP]) home.input(Nav::Up);
      if (act[A_DOWN]) home.input(Nav::Down);
      if (act[A_LEFT]) home.input(Nav::Left);
      if (act[A_RIGHT]) home.input(Nav::Right);
      if (act[A_OK]) home.input(Nav::Ok);
      if (act[A_BACK]) home.input(Nav::Back);
      if (act[A_GO]) home.input(Nav::Go);
      if (home.wantQuit) running = false;
      if (home.wantStart) { home.wantStart = false; lightsOut(); }
      else if (home.dirty) { home.dirty = false; if (bgOn && bgCar != cfg.car + "/" + home.pack()) { startBackdrop(); audio.setClass(home.voice()); prev = SDL_GetTicksNS(); } }
    } else if (screen == PAUSE) {
      const int n = (int)pauseItems().size();
      if (act[A_UP]) pauseAt = (pauseAt + n - 1) % n;
      if (act[A_DOWN]) pauseAt = (pauseAt + 1) % n;
      if (act[A_PAUSE] || act[A_BACK]) screen = DRIVE;
      if (act[A_OK]) {
        switch (pauseAt) {
          case 0: screen = DRIVE; break;
          case 1: screen = DRIVE; if (S.race) rejoin(S); else resetCar(S); R.snapCamera(); break;
          case 2: cfg.cam = (cfg.cam + 1) % 4; R.snapCamera(); break;
          case 3: cfg.line = !cfg.line; break;
          case 4: { static const int STEPS[] = {0, 20, 35, 50, 65, 80, 100}; int q = 0; for (int i = 0; i < 7; i++) if (STEPS[i] == cfg.ffb) q = i; cfg.ffb = STEPS[(q + 6) % 7]; break; }   // steps DOWN, then back to the top, as the JS does
          default: toHome(); break;
        }
      }
      prev = SDL_GetTicksNS();
    } else if (screen == RESULTS) {
      if (act[A_OK] || act[A_BACK] || act[A_PAUSE]) toHome();
    } else {
      if (act[A_PAUSE]) {
        screen = PAUSE; pauseAt = 0; bridge.release();
        static const char *CALM[3] = {"breathe.", "shake your hands out.", "it will still be here."}, *HURT[3] = {"we do not talk about that one.", "the car has seen better days.", "...ow."};
        const Car &c = *S.car;
        const bool hurt = c.hasCrush && std::max({c.crushFront, c.crushRear, c.crushLeft, c.crushRight}) > 0.3;
        pauseSay = (hurt ? HURT : CALM)[std::rand() % 3];
      }
      if (act[A_CAM]) { cfg.cam = (cfg.cam + 1) % 4; R.snapCamera(); }
      if (act[A_RESET]) { if (S.race) rejoin(S); else resetCar(S); R.snapCamera(); }
      if (act[A_DRS]) drsTap = true;
      // THE PADDLES (js/main.js). In Xingus with manual gears they ARE the
      // gearbox: a downshift that would bury the needle is refused, down from
      // first at a standstill is reverse, up out of it is first again.
      // Otherwise they are the selector: drive and reverse.
      if (!autoDrive && (act[A_SHUP] || act[A_SHDN])) {
        Hands &hd = S.hands;
        const double v = S.car->speed;
        if (S.xmanual) {
          Gearbox &b = *S.box;
          if (b.manual < 0) b.manual = 0;
          if (act[A_SHUP]) { if (hd.selector < 0) { hd.selector = 1; b.manual = 0; } else b.shift(1, v * 3.6); }
          if (act[A_SHDN]) {
            if (b.manual == 0 && v < 3 && hd.selector > 0) { hd.selector = -1; toast = {"REVERSE", 2}; }
            else if (hd.selector > 0 && !b.shift(-1, v * 3.6)) toast = {"TOO FAST FOR THAT GEAR", 2};
          }
        } else {
          if (act[A_SHUP] && hd.selector < 0) { hd.selector = 1; toast = {"DRIVE", 2}; }
          if (act[A_SHDN] && hd.selector > 0) { if (v < 5) { hd.selector = -1; toast = {"REVERSE", 2}; } else toast = {"TOO FAST FOR REVERSE", 2}; }
        }
      }
      if (act[A_PIT] && S.race) { S.race->me->pitRequest = !S.race->me->pitRequest; toast = {S.race->me->pitRequest ? "BOX THIS LAP" : "STAY OUT", 2}; }
    }

    HandsIn in;
    if (screen == DRIVE) {
      const bool *ks = SDL_GetKeyboardState(nullptr);
      in.left = ks[SDL_SCANCODE_LEFT] || ks[SDL_SCANCODE_A];
      in.right = ks[SDL_SCANCODE_RIGHT] || ks[SDL_SCANCODE_D];
      in.throttle = ks[SDL_SCANCODE_UP] || ks[SDL_SCANCODE_W];
      in.brake = ks[SDL_SCANCODE_DOWN] || ks[SDL_SCANCODE_S];
      dev.read(in);
    }

    if (screen == HOME || screen == DRIVE || screen == RESULTS) {
      const bool bot = bgOn || autoDrive || screen == RESULTS;
      acc += dt;
      int steps = 0;
      while (acc >= FIXED_DT && steps < 60) {
        if (S.race) raceStep(S, in, bot, drsTap, toast); else simStep(S, in, bot, drsTap, toast);
        drsTap = false;
        acc -= FIXED_DT;
        steps++;
      }
      if (steps == 60) acc = 0;                       // never chase a stall
      S.t += dt;
      S.box->update(dt, S.car->speed * 3.6, S.car->throttle);
      if (toast.t > 0) toast.t -= dt;
      if (S.race) {
        // YOUR overtake that stuck: the tower row flashes
        if (!S.race->cheers.empty()) { S.passAt = S.race->time; S.race->cheers.clear(); }
        if (S.race->state == RaceState::Over) {
          if (bgOn) { startBackdrop(); prev = SDL_GetTicksNS(); }      // the backdrop race just runs again
          else if (screen == DRIVE) { screen = RESULTS; bridge.release(); resultMood(S.race->me->pos, (int)S.race->entries.size(), S.race->me->retired, resTitle, resLine); }
        }
      }
    }
    drsTap = false;
    {
      SoundIn si;
      const Car &c = *S.car;
      si.rpm = S.box->rpm; si.throttle = c.throttle; si.speed = c.speed;
      si.slip = c.slipR; si.peak = S.spec->pk; si.surf = c.surface; si.wall = c.wallTouch;
      si.rain = rainNow;
      si.dt = dt; si.paused = screen == PAUSE;
      // behind HOME the race is silent, as it is in the browser (sound=0)
      si.volume = (hidden || bgOn || screen == RESULTS) ? 0 : cfg.volume / 10.0;
      audio.update(si);
      if (S.lastHit > 0) { if (screen == DRIVE) { audio.hit(S.lastHit); bridge.hit(S.lastHit / 14); } S.lastHit = 0; }
    }
    // the wheel: only while YOU are driving, and only if you switched it on
    {
      const double sf = S.car->surface;
      const double rough = sf < 0.9 ? 0.45 : sf < 1 ? 0.22 : 0;
      // force only from the one game you are looking at: never unseen, never from a window without the keyboard
      const bool mine = !offscreen && (SDL_GetWindowFlags(win) & SDL_WINDOW_INPUT_FOCUS);
      if (!offscreen) bridge.update(*S.car, rough, dt, mine && screen == DRIVE && !autoDrive && !bgOn && cfg.ffb > 0, cfg.ffb / 100.0);
      // force is wanted and no bridge has answered for a few seconds: start it, once
      if (!hidden && cfg.ffb > 0 && dev.joy && !bridge.live() && !bridgeTried) {
        bridgeWait += dt;
        if (bridgeWait > 3.5) {
          bridgeTried = true;
          bridgePid = spawnBridge(dataDir + "/..");
          std::fprintf(stderr, bridgePid > 0 ? "xbr: started the wheel bridge (tools/ffb.py --max 1.0), log in /tmp/xbr-ffb-bridge.log\n"
                                               : "xbr: could not start tools/ffb.py — no force feedback\n");
        }
      }
      // the pointer belongs to the menus, not to the windscreen
      static bool cursorOn = true;
      const bool wantCursor = screen != DRIVE;
      if (wantCursor != cursorOn) { cursorOn = wantCursor; if (cursorOn) SDL_ShowCursor(); else SDL_HideCursor(); }
    }

    FrameIn f = frameOf(dt);
    drawAll(f);
    if (showFps) {
      char b[32];
      std::snprintf(b, sizeof b, "%d FPS", (int)std::round(fps));
      const float dim[4] = {1, 1, 1, 0.6f};
      R.hudBegin(); R.textPx((float)R.W - 24 * K, (float)R.H - 24 * K, 11 * K, b, dim, RIGHT, Renderer::HUD_B, 0.1f); R.hudEnd();
    }
    if (hidden) glFinish(); else SDL_GL_SwapWindow(win);
    frames++;
    if (frames > 5) worstMs = std::max(worstMs, dt * 1000);
    if (maxFrames > 0 && frames >= maxFrames) running = false;
  }
  bridge.release();
  if (bridgePid > 0) { SDL_Delay(120); kill(bridgePid, SIGTERM); waitpid(bridgePid, nullptr, 0); }   // the bridge we started goes with us; its last act is to zero the wheel
  if (!savePath.empty()) cfg.save(savePath);
  if (maxFrames > 0) {
    // What the rig contributed: with --hidden there is no vsync, no compositor
    // and no multisampling, so this is the cost of drawing, not a frame rate.
    const double wall = (SDL_GetTicksNS() - t0) / 1e9;
    std::fprintf(stderr, "xbr: %ld frames in %.2f s = %.2f ms a frame (worst %.1f ms)%s; car at %.0f km/h, %.0f m into the lap, audio %s, bridge %s\n",
                 frames, wall, wall / frames * 1000, worstMs, hidden ? " [hidden: no vsync, no MSAA]" : "",
                 S.car->speed * 3.6, S.proj.s, audio.ok() ? "open" : "off", bridge.live() ? "connected" : "not connected");
  }

  audio.close();
  dev.close();
  SP.reset();
  R.shutdown();
  SDL_GL_DestroyContext(ctx);
  SDL_DestroyWindow(win);
  SDL_Quit();
  return 0;
}
