// xbr — the game, native. SDL3 for the window, the devices and the sound;
// OpenGL for the picture; the sim core for everything that is true.
//
//   xbr [track] [car]            car: f1 | f4 | gt3      (default monza f1)
//   --auto                       the reference driver takes the wheel (F1 toggles it)
//   --tier hard|medium|casual|supercasual   who that driver is
//   --cam 0|1|2                  onboard | chase | high
//   --line                       show the racing line
//   --windowed  --size WxH  --hidpi  --no-audio  --data DIR
//   --shot FILE.ppm [--spool SECONDS]   render one frame offscreen and exit
//   --frames N [--hidden]        run the real loop for N frames, report, exit.
//                                --hidden shows no window and plays no sound:
//                                a smoke test that disturbs nobody.
//
// This is the hot-lap half of the browser game. The loop below is
// js/main.js's solo branch, substep for substep.
#include <SDL3/SDL.h>
#include <epoxy/gl.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

#include "audio.hpp"
#include "collide.hpp"
#include "driver.hpp"
#include "physics.hpp"
#include "render.hpp"
#include "track.hpp"

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
// a session: one circuit, one car
// ---------------------------------------------------------------------------
struct Session {
  Track track;
  Spec *spec = nullptr;
  std::unique_ptr<Lines> lines;
  Car car;
  Driver driver;
  std::unique_ptr<Autopilot> pilot;
  std::unique_ptr<Gearbox> box;
  Hands hands;
  int hint = 0;
  double sPrev = 0, lapT = 0, last = 0, best = 0, offT = 0, rolled = 0;
  bool hasLast = false, hasBest = false, invalid = false;
  int lap = 0;
  Proj proj;
};

static std::string fmtLap(double s) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%d:%06.3f", (int)std::floor(s / 60), std::fmod(s, 60));
  return buf;
}

static void resetCar(Session &S) {
  const Track &track = S.track;
  const Line &line = S.lines->race;
  const int i = track.idx(0);
  double px, py, ph;
  int pi;
  track.point(0, line.off[i], px, py, ph, pi);
  S.car = makeCar(S.spec->key);              // a reset car is a repaired car
  S.car.x = px; S.car.y = py; S.car.hdg = line.hdg[i];
  S.car.tyre.Tf = S.car.tyre.Tr = 70;
  S.hands = Hands{};
  S.hint = i; S.sPrev = 0; S.lapT = 0; S.lap = 0; S.invalid = false; S.offT = 0;
  S.proj = track.project(S.car.x, S.car.y, S.hint);
}

static bool loadSession(Session &S, Renderer &R, const std::string &dataDir, const std::string &key,
                        const std::string &cls, const std::string &tier) {
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
  S.lines = std::make_unique<Lines>(buildLines(S.track, *S.spec));
  S.lines->track = &S.track;
  S.driver = makeDriver(1, tier, S.track.corners.empty() ? 24 : (int)S.track.corners.size());
  S.pilot = std::make_unique<Autopilot>(S.track, *S.lines, *S.spec, peakSlip(*S.spec), &S.driver);
  S.box = std::make_unique<Gearbox>(cls);
  S.hasBest = S.hasLast = false;
  resetCar(S);
  R.buildWorld(S.track, Json::loadOpt(dataDir + "/surf/" + key + ".json"), Json::loadOpt(dataDir + "/env/" + key + ".json"),
               S.lines->race);
  R.buildCar(*S.spec);
  return true;
}

struct Toast { std::string msg; double t = 0; };

// One 400 Hz substep. js/main.js, the solo branch.
static void simStep(Session &S, const HandsIn &in, bool autoDrive, bool drsTap, Toast &toast) {
  Car &car = S.car;
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
  // NOT PORTED YET: env.slope. The surveyed gradient belongs to the elevation
  // model, which the native renderer does not draw; the world is flat here.
  step(car, FIXED_DT, env);

  const Hit hit = resolveBarrier(car, track, S.hint);
  if (hit.hit && hit.closing > 3.5) {
    char buf[64];
    if (hit.harm > 0.12) {
      std::snprintf(buf, sizeof buf, "HEAVY CONTACT - %s", hit.part);
      for (char *c = buf; *c; c++) *c = (char)std::toupper((unsigned char)*c);
      toast = {buf, 2.2};
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

// ---------------------------------------------------------------------------
// HUD. Paper, ink and red.
// ---------------------------------------------------------------------------
static const float INK[4] = {0.06f, 0.06f, 0.07f, 0.80f}, PAPER[4] = {0.96f, 0.94f, 0.90f, 1}, DIM[4] = {0.96f, 0.94f, 0.90f, 0.55f};
static const float RED[4] = {0.88f, 0.14f, 0.16f, 1}, GREEN[4] = {0.22f, 0.80f, 0.38f, 1}, AMBER[4] = {0.96f, 0.70f, 0.12f, 1};

static void drawHud(Renderer &R, const Session &S, const Devices &dev, bool autoDrive, const Toast &toast, bool showFps,
                    double fps, bool showInput, double helpT, const std::string &tier) {
  const Car &car = S.car;
  const float W = (float)R.W, H = (float)R.H;
  const float u = std::max(1.0f, std::floor(H / 360.0f));       // one HUD pixel
  R.hudBegin();

  // ---- top left: where you are and how the lap is going
  R.rect(12 * u, 12 * u, 132 * u, 62 * u, INK);
  std::string title = S.track.name.empty() ? S.track.key : S.track.name;
  if (title.size() > 16) title.resize(16);
  R.text(18 * u, 17 * u, u, title, PAPER);
  R.text(138 * u, 17 * u, u, S.spec->name, RED, RIGHT);
  R.text(18 * u, 30 * u, 2 * u, S.lap > 0 ? fmtLap(S.lapT) : "OUT LAP", S.invalid ? RED : PAPER);
  R.text(18 * u, 50 * u, u, "LAST", DIM);
  R.text(48 * u, 50 * u, u, S.hasLast ? fmtLap(S.last) : "-:--.---", PAPER);
  R.text(18 * u, 61 * u, u, "BEST", DIM);
  R.text(48 * u, 61 * u, u, S.hasBest ? fmtLap(S.best) : "-:--.---", S.hasBest ? GREEN : PAPER);
  if (S.lap > 0) { char b[16]; std::snprintf(b, sizeof b, "LAP %d", S.lap); R.text(138 * u, 50 * u, u, b, DIM, RIGHT); }
  if (S.invalid) R.text(138 * u, 61 * u, u, "INVALID", RED, RIGHT);

  // ---- bottom centre: revs, gear, speed
  const float cx = W / 2, by = H - 16 * u;
  R.rect(cx - 92 * u, by - 54 * u, 184 * u, 54 * u, INK);
  const BoxSpec &bx = *S.box->box;
  const double rev = clampd((S.box->rpm - bx.idle) / (bx.limit - bx.idle), 0, 1);
  const int SEGS = 20;
  for (int i = 0; i < SEGS; i++) {
    const bool on = rev * SEGS > i;
    const float *c = i >= SEGS - 3 ? RED : i >= SEGS - 7 ? AMBER : GREEN;
    const float off[4] = {c[0], c[1], c[2], 0.18f};
    R.rect(cx - 86 * u + i * 8.6f * u, by - 49 * u, 7 * u, 6 * u, on ? c : off);
  }
  char b[32];
  std::snprintf(b, sizeof b, "%d", (int)std::round(car.speed * 3.6));
  R.text(cx + 84 * u, by - 36 * u, 4 * u, b, PAPER, RIGHT);
  R.text(cx + 84 * u, by - 8 * u, u, "KM/H", DIM, RIGHT);
  const std::string gear = car.selector < 0 ? "R" : std::to_string(S.box->gear + 1);
  R.text(cx - 84 * u, by - 36 * u, 4 * u, gear, RED);
  std::snprintf(b, sizeof b, "%d RPM", (int)(std::round(S.box->rpm / 100) * 100));
  R.text(cx - 84 * u, by - 8 * u, u, b, DIM);
  if (S.spec->drs) R.text(cx - 30 * u, by - 30 * u, 2 * u, "DRS", car.drsOpen ? GREEN : DIM, CENTRE);
  if (car.tcCut < 0.97 && car.throttle > 0.1) R.text(cx - 16 * u, by - 8 * u, u, "TC", AMBER, CENTRE);
  if (car.absCut < 0.97 && car.brake > 0.1) R.text(cx + 4 * u, by - 8 * u, u, "ABS", AMBER, CENTRE);

  // ---- bottom right: pedals and the wheel
  const float px = W - 46 * u;
  R.rect(px - 6 * u, by - 54 * u, 40 * u, 54 * u, INK);
  const float off[4] = {1, 1, 1, 0.10f};
  R.rect(px, by - 48 * u, 10 * u, 36 * u, off);
  R.rect(px + 14 * u, by - 48 * u, 10 * u, 36 * u, off);
  R.rect(px, by - 12 * u - 36 * u * (float)car.brake, 10 * u, 36 * u * (float)car.brake, RED);
  R.rect(px + 14 * u, by - 12 * u - 36 * u * (float)car.throttle, 10 * u, 36 * u * (float)car.throttle, GREEN);
  const float lock = (float)steerLock(car.speed);
  const float st = lock > 0 ? (float)clampd(car.delta / lock, -1, 1) : 0;
  R.rect(px - 2 * u, by - 8 * u, 28 * u, 3 * u, off);
  R.rect(px + 12 * u - st * 13 * u - 1.5f * u, by - 9 * u, 3 * u, 5 * u, PAPER);   // +delta is LEFT

  // ---- damage, when there is any
  if (car.damage > 0.01) {
    std::snprintf(b, sizeof b, "DAMAGE %d%%", (int)std::round(car.damage * 100));
    R.text(W - 14 * u, 17 * u, u, b, car.damage > 0.4 ? RED : AMBER, RIGHT);
    if (car.hasLost && car.lostFrontWing) R.text(W - 14 * u, 28 * u, u, "FRONT WING GONE", RED, RIGHT);
    if (car.hasLost && car.lostRearWing) R.text(W - 14 * u, 39 * u, u, "REAR WING GONE", RED, RIGHT);
  }

  if (autoDrive) { R.text(cx, 14 * u, u, "REFERENCE DRIVER - " + tier + " - F1 TO TAKE THE WHEEL", AMBER, CENTRE); }
  if (toast.t > 0) {
    const float w = R.textWidth(2 * u, toast.msg) + 16 * u;
    R.rect(cx - w / 2, 34 * u, w, 22 * u, INK);
    R.text(cx, 38 * u, 2 * u, toast.msg, PAPER, CENTRE);
  }
  if (showFps) { std::snprintf(b, sizeof b, "%d FPS", (int)std::round(fps)); R.text(W - 14 * u, H - 84 * u, u, b, DIM, RIGHT); }
  if (helpT > 0) {
    R.text(14 * u, H - 34 * u, u, "ARROWS OR WASD DRIVE   SPACE DRS   SHIFT REVERSE   R RESET   C CAMERA   L LINE", DIM);
    R.text(14 * u, H - 24 * u, u, "N NEXT TRACK   B PREVIOUS   TAB CAR   F1 REFERENCE DRIVER   F FULLSCREEN   F3 INPUT   F4 FPS   ESC QUIT", DIM);
  }
  if (showInput) {
    // Which device, and what it is saying. A dead pedal names itself here.
    float y = 84 * u;
    R.rect(12 * u, y - 4 * u, 250 * u, 52 * u, INK);
    R.text(18 * u, y, u, dev.joy ? "WHEEL: " + dev.name : dev.pad ? "PAD: " + dev.name : "KEYBOARD - NO WHEEL OR PAD FOUND", PAPER);
    y += 11 * u;
    if (dev.joy) {
      std::string ax = "AXES";
      const int na = std::min(10, SDL_GetNumJoystickAxes(dev.joy));
      for (int i = 0; i < na; i++) { std::snprintf(b, sizeof b, " %d:%+.2f", i, Devices::axis(dev.joy, i)); ax += b; }
      R.text(18 * u, y, u, ax, DIM); y += 11 * u;
      std::string bt = "BUTTONS";
      const int nb = SDL_GetNumJoystickButtons(dev.joy);
      for (int i = 0; i < nb; i++) if (SDL_GetJoystickButton(dev.joy, i)) { bt += " " + std::to_string(i); }
      R.text(18 * u, y, u, bt, DIM); y += 11 * u;
      std::snprintf(b, sizeof b, "PROFILE STEER %d THR %d BRK %d", dev.prof.steer.ax, dev.prof.throttle.ax, dev.prof.brake.ax);
      R.text(18 * u, y, u, b, DIM);
    } else if (!dev.prof.ok) R.text(18 * u, y, u, "DATA/WHEEL.JSON NOT FOUND - A WHEEL CANNOT BE RECOGNISED", AMBER);
    y += 11 * u;
  }
  R.hudEnd();
}

// ---------------------------------------------------------------------------
int main(int argc, char **argv) {
  std::vector<std::string> pos;
  std::string dataDir, shot, tier = "hard";
  bool autoDrive = false, showLine = false, windowed = true, hidpi = false, noAudio = false, hidden = false;
  long maxFrames = 0;
  int cam = 0, winW = 1600, winH = 900;
  double spool = 0;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    auto val = [&](const char *flag) -> std::string {
      if (i + 1 >= argc) { std::fprintf(stderr, "xbr: %s needs a value\n", flag); std::exit(2); }
      return argv[++i];
    };
    if (a == "--auto") autoDrive = true;
    else if (a == "--line") showLine = true;
    else if (a == "--windowed") windowed = true;
    else if (a == "--fullscreen") windowed = false;
    else if (a == "--hidpi") hidpi = true;
    else if (a == "--no-audio") noAudio = true;
    else if (a == "--hidden") hidden = true;
    else if (a == "--frames") maxFrames = std::atol(val("--frames").c_str());
    else if (a == "--data") dataDir = val("--data");
    else if (a == "--tier") tier = val("--tier");
    else if (a == "--cam") cam = std::atoi(val("--cam").c_str());
    else if (a == "--shot") shot = val("--shot");
    else if (a == "--spool") spool = std::atof(val("--spool").c_str());
    else if (a == "--size") { if (std::sscanf(val("--size").c_str(), "%dx%d", &winW, &winH) != 2) { std::fprintf(stderr, "xbr: --size wants WxH\n"); return 2; } }
    else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "xbr: unknown flag %s\n", a.c_str()); return 2; }
    else pos.push_back(a);
  }
  if (pos.size() > 2) { std::fprintf(stderr, "xbr: too many arguments (track, car)\n"); return 2; }
  std::string key = pos.size() > 0 ? pos[0] : "monza", cls = pos.size() > 1 ? pos[1] : "f1";
  if (!hasCarSpec(cls)) { std::fprintf(stderr, "xbr: no car class '%s' (f1, f4, gt3)\n", cls.c_str()); return 2; }
  if (cam < 0 || cam > 2) { std::fprintf(stderr, "xbr: --cam is 0, 1 or 2\n"); return 2; }
  if (std::string(tierFor(tier)->key) != tier) { std::fprintf(stderr, "xbr: no tier '%s'\n", tier.c_str()); return 2; }
  const bool shotMode = !shot.empty();
  if (hidden && maxFrames <= 0) { std::fprintf(stderr, "xbr: --hidden needs --frames N, or it would run unseen for ever\n"); return 2; }

  // The offscreen driver first when all that is wanted is a picture: it never
  // touches the compositor. A hidden window is the fallback.
  if (shotMode) SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "offscreen");
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

  // every circuit on disk, for N / B
  std::vector<std::string> tracks;
  for (const auto &e : std::filesystem::directory_iterator(dataDir + "/tracks")) {
    const std::string stem = e.path().stem().string();
    if (e.path().extension() == ".json" && stem.rfind("fold", 0) != 0 && stem != "test") tracks.push_back(stem);
  }
  std::sort(tracks.begin(), tracks.end());

  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  if (!shotMode && !hidden) { SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 1); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 4); }
  SDL_WindowFlags flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE;
  if (shotMode || hidden) flags |= SDL_WINDOW_HIDDEN;
  if (hidpi) flags |= SDL_WINDOW_HIGH_PIXEL_DENSITY;
  if (!windowed && !shotMode) flags |= SDL_WINDOW_FULLSCREEN;
  SDL_Window *win = SDL_CreateWindow("XBR", winW, winH, flags);
  SDL_GLContext ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  if (!ctx && !shotMode) {
    // no multisampling on this driver: ask again without it
    if (win) SDL_DestroyWindow(win);
    SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 0); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 0);
    win = SDL_CreateWindow("XBR", winW, winH, flags);
    ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  }
  if (!ctx) { std::fprintf(stderr, "xbr: no OpenGL 3.3 context: %s\n", SDL_GetError()); return 1; }
  SDL_GL_MakeCurrent(win, ctx);
  if (!shotMode && !hidden) SDL_GL_SetSwapInterval(1);
  std::fprintf(stderr, "xbr: %s | %s | video driver %s\n", (const char *)glGetString(GL_RENDERER), (const char *)glGetString(GL_VERSION),
               SDL_GetCurrentVideoDriver());

  Renderer R;
  if (!R.init()) return 1;
  if (shotMode || hidden) { if (!R.beginOffscreen(winW, winH)) { std::fprintf(stderr, "xbr: offscreen target incomplete\n"); return 1; } }
  else { int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); R.resize(w, h); glEnable(GL_MULTISAMPLE); }

  Session S;
  if (!loadSession(S, R, dataDir, key, cls, tier)) return 1;

  Toast toast;
  if (shotMode) {
    HandsIn none;
    const long steps = (long)(spool / FIXED_DT);
    for (long i = 0; i < steps; i++) {
      simStep(S, none, true, false, toast);
      if (i % 8 == 0) S.box->update(8 * FIXED_DT, S.car.speed * 3.6, S.car.throttle);
    }
    FrameIn f;
    f.car = &S.car; f.spec = S.spec; f.camMode = cam; f.showLine = showLine; f.wheelAngle = S.rolled;
    R.snapCamera();
    R.drawWorld(f);
    Devices none2;
    drawHud(R, S, none2, autoDrive, toast, false, 0, false, 0, tier);
    glFinish();
    const bool ok = R.writePPM(shot);
    std::fprintf(stderr, "xbr: %s %s  (t=%.1fs, %.0f km/h, lap %d)\n", ok ? "wrote" : "FAILED to write", shot.c_str(), spool,
                 S.car.speed * 3.6, S.lap);
    return ok ? 0 : 1;
  }

  Devices dev;
  dev.prof = loadWheelProfile(dataDir);
  dev.scan();
  if (!dev.name.empty()) std::fprintf(stderr, "xbr: input device: %s (%s)\n", dev.name.c_str(), dev.joy ? "wheel profile" : "gamepad");

  EngineAudio audio;
  if (!noAudio && !audio.open(cls)) std::fprintf(stderr, "xbr: no audio device (%s) — running silent\n", SDL_GetError());

  bool running = true, showFps = false, showInput = false, paused = false, fullscreen = !windowed;
  long frames = 0;
  double worstMs = 0;
  const Uint64 t0 = SDL_GetTicksNS();
  double acc = 0, helpT = 14, fps = 60;
  Uint64 prev = SDL_GetTicksNS();
  bool drsTap = false;

  auto reload = [&](const std::string &k, const std::string &c) {
    Session N;
    if (!loadSession(N, R, dataDir, k, c, tier)) {
      // the world meshes may be half replaced: put the old circuit back
      R.buildWorld(S.track, Json::loadOpt(dataDir + "/surf/" + key + ".json"), Json::loadOpt(dataDir + "/env/" + key + ".json"), S.lines->race);
      R.buildCar(*S.spec);
      toast = {"COULD NOT LOAD " + k, 3};
      return;
    }
    S = std::move(N);
    // the lines hold a pointer to the track they were solved for, and the
    // session has just moved: rebuild what points into it
    S.lines->track = &S.track;
    S.pilot = std::make_unique<Autopilot>(S.track, *S.lines, *S.spec, peakSlip(*S.spec), &S.driver);
    key = k; cls = c;
    audio.setClass(cls);
    toast = {(S.track.name.empty() ? key : S.track.name) + " - " + S.spec->name, 3};
    acc = 0; prev = SDL_GetTicksNS();
  };

  while (running) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      switch (e.type) {
        case SDL_EVENT_QUIT: running = false; break;
        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED: { if (hidden) break; int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); R.resize(w, h); break; }
        case SDL_EVENT_JOYSTICK_ADDED: case SDL_EVENT_JOYSTICK_REMOVED: dev.scan(); break;
        case SDL_EVENT_KEY_DOWN: {
          if (e.key.repeat) break;
          switch (e.key.scancode) {
            case SDL_SCANCODE_ESCAPE: running = false; break;
            case SDL_SCANCODE_SPACE: drsTap = true; break;
            case SDL_SCANCODE_LSHIFT: case SDL_SCANCODE_RSHIFT: S.hands.selector = S.hands.selector < 0 ? 1 : -1; break;
            case SDL_SCANCODE_R: case SDL_SCANCODE_BACKSPACE: resetCar(S); R.snapCamera(); break;
            case SDL_SCANCODE_C: cam = (cam + 1) % 3; R.snapCamera(); break;
            case SDL_SCANCODE_L: showLine = !showLine; break;
            case SDL_SCANCODE_F: fullscreen = !fullscreen; SDL_SetWindowFullscreen(win, fullscreen); break;
            case SDL_SCANCODE_F1: autoDrive = !autoDrive; break;
            case SDL_SCANCODE_F3: showInput = !showInput; break;
            case SDL_SCANCODE_F4: showFps = !showFps; break;
            case SDL_SCANCODE_RETURN: paused = !paused; break;
            case SDL_SCANCODE_TAB: reload(key, cls == "f1" ? "f4" : cls == "f4" ? "gt3" : "f1"); break;
            case SDL_SCANCODE_N: case SDL_SCANCODE_B: {
              if (tracks.empty()) break;
              auto it = std::find(tracks.begin(), tracks.end(), key);
              long i = it == tracks.end() ? 0 : it - tracks.begin();
              i = (i + (e.key.scancode == SDL_SCANCODE_N ? 1 : (long)tracks.size() - 1)) % (long)tracks.size();
              reload(tracks[(size_t)i], cls);
              break;
            }
            default: break;
          }
          break;
        }
        default: break;
      }
    }
    if (dev.tapped(0)) drsTap = true;
    if (dev.tapped(1)) { cam = (cam + 1) % 3; R.snapCamera(); }
    if (dev.tapped(2)) { resetCar(S); R.snapCamera(); }
    if (dev.tapped(3)) paused = !paused;

    const Uint64 now = SDL_GetTicksNS();
    double dt = (now - prev) / 1e9;
    prev = now;
    if (dt > 0) fps += (1.0 / dt - fps) * 0.05;
    dt = std::min(dt, 0.1);

    HandsIn in;
    const bool *ks = SDL_GetKeyboardState(nullptr);
    in.left = ks[SDL_SCANCODE_LEFT] || ks[SDL_SCANCODE_A];
    in.right = ks[SDL_SCANCODE_RIGHT] || ks[SDL_SCANCODE_D];
    in.throttle = ks[SDL_SCANCODE_UP] || ks[SDL_SCANCODE_W];
    in.brake = ks[SDL_SCANCODE_DOWN] || ks[SDL_SCANCODE_S];
    dev.read(in);

    if (!paused) {
      acc += dt;
      int steps = 0;
      while (acc >= FIXED_DT && steps < 60) {
        simStep(S, in, autoDrive, drsTap, toast);
        drsTap = false;
        acc -= FIXED_DT;
        steps++;
      }
      if (steps == 60) acc = 0;                       // never chase a stall
      S.box->update(dt, S.car.speed * 3.6, S.car.throttle);
      if (toast.t > 0) toast.t -= dt;
      if (helpT > 0) helpT -= dt;
    }
    drsTap = false;
    audio.set(S.box->rpm, S.car.throttle, (paused || hidden) ? 0.0 : 0.42, S.car.speed);

    FrameIn f;
    f.car = &S.car; f.spec = S.spec; f.camMode = cam; f.showLine = showLine; f.wheelAngle = S.rolled; f.dt = dt;
    R.drawWorld(f);
    Toast shown = toast;
    if (paused) shown = {"PAUSED - ENTER TO GO", 1};
    drawHud(R, S, dev, autoDrive, shown, showFps, fps, showInput, helpT, tierFor(tier)->name);
    if (hidden) glFinish(); else SDL_GL_SwapWindow(win);
    frames++;
    if (frames > 5) worstMs = std::max(worstMs, dt * 1000);
    if (maxFrames > 0 && frames >= maxFrames) running = false;
  }
  if (maxFrames > 0) {
    // What the rig contributed: with --hidden there is no vsync, no compositor
    // and no multisampling, so this is the cost of drawing, not a frame rate.
    const double wall = (SDL_GetTicksNS() - t0) / 1e9;
    std::fprintf(stderr, "xbr: %ld frames in %.2f s = %.2f ms a frame (worst %.1f ms)%s; car at %.0f km/h, %.0f m into the lap, audio %s\n",
                 frames, wall, wall / frames * 1000, worstMs, hidden ? " [hidden: no vsync, no MSAA]" : "",
                 S.car.speed * 3.6, S.proj.s, audio.ok() ? "open" : "off");
    if (dev.joy) {
      // the wheel at rest should read 0 / 0 / 0 through the profile; anything
      // else means SDL numbers this device's axes differently from the file
      std::string ax;
      char b[32];
      for (int i = 0; i < std::min(8, SDL_GetNumJoystickAxes(dev.joy)); i++) { std::snprintf(b, sizeof b, " %d:%+.3f", i, Devices::axis(dev.joy, i)); ax += b; }
      HandsIn probe;
      const bool live = dev.read(probe);
      std::fprintf(stderr, "xbr: wheel axes%s  ->  steer %+.3f throttle %.3f brake %.3f (%s), %d buttons\n", ax.c_str(), probe.aSteer,
                   probe.aThrottle, probe.aBrake, live ? "live" : "at rest", SDL_GetNumJoystickButtons(dev.joy));
    }
  }

  audio.close();
  dev.close();
  R.shutdown();
  SDL_GL_DestroyContext(ctx);
  SDL_DestroyWindow(win);
  SDL_Quit();
  return 0;
}
