// audio.hpp — the engine you hear. js/gearbox.js (gears and rpm, a sound model
// and not a drivetrain) and js/enginecore.js (an engine fired one combustion at
// a time), on an SDL audio stream.
//
// NOT PORTED YET: everything else in js/audio.js — tyres, wind, kerbs, gravel,
// impacts, the spatial layer, the radio and the music.
#pragma once
#include <atomic>
#include <string>
#include <vector>

struct SDL_AudioStream;

namespace xbr {

struct BoxSpec { double idle, limit, shiftUp, downAt; std::vector<double> tops; };
const BoxSpec &boxFor(const std::string &cls);

// A box with memory: hysteresis and a shift cut, so it does not hunt.
struct Gearbox {
  const BoxSpec *box = nullptr;
  int gear = 0;
  double rpm = 0, shiftT = 0;
  int shifted = 0;
  // MANUAL (Xingus; js/gearbox.js): set `manual` to a gear and the box stops
  // choosing. `limiter` is true on the stop. shift() is the paddle: it refuses
  // a downshift that would over-rev.
  int manual = -1;
  bool limiter = false;
  double clockMs = 0;
  bool shift(int dir, double speedKmh);
  explicit Gearbox(const std::string &cls);
  void update(double dt, double speedKmh, double throttle);
};

// Everything the car tells the mix, once a frame (js/audio.js Engine.update).
struct SoundIn {
  double rpm = 0, throttle = 0, speed = 0;   // speed in m/s
  double slip = 0, peak = 0;                 // rear slip angle and the tyre's peak
  double surf = 1;                           // car.surface: 1 tarmac, 0.93 kerb, 0.58 gravel, 0.42 grass
  bool wall = false;                         // bodywork along a barrier
  double rain = 0;                           // 0..1
  double dt = 1.0 / 60;
  bool paused = false;
  double volume = 1;
};

// The whole mix: the modelled engine, and the recordings the browser game uses
// (data/audio — tyre squeal, gravel and grass under the wheels, kerb thuds,
// stones, the scrape along a wall, the crashes), plus wind and rain made from
// noise. Levels are js/audio.js's FX table.
class EngineAudio {
 public:
  ~EngineAudio();
  bool open(const std::string &cls, const std::string &dataDir);   // false = no audio device; the game runs silent
  void setClass(const std::string &cls);
  void update(const SoundIn &in);
  void hit(double closing);               // an impact, m/s of closing speed
  // THE PASS-BY (Adam: "the vwooosh ... when a car passes u at a standstill"): the air a car
  // pushes aside, heard as it goes by. strength 0..1 (how close, how fast), seconds = how long it is abeam.
  void whoosh(double strength, double seconds);
  void close();
  bool ok() const { return stream != nullptr; }

  // called on the audio thread
  void render(float *out, int n);

  // one engine, off the device: for trimming every class to the same level
  struct Core;
  static Core *newCore(int cls);
  static void freeCore(Core *c);
  static double limitOf(int cls);
  static void renderCore(Core *c, float *out, int n, double rpm, double thr, double gain, double speed);

 private:
  SDL_AudioStream *stream = nullptr;
  std::atomic<float> tRpm{4500}, tThr{0}, tGain{0}, tSpeed{0};
  std::atomic<int> pendingCls{-1};
  Core *core = nullptr;
  std::atomic<double> makeupNext{1};
  struct Mixer;
  Mixer *mix = nullptr;
  // main-thread state
  double t = 0, duck = 1, kerbDist = 1.9, lastStone = 0, lastCrash = -9;
  bool wasOff = false;
  unsigned rngS = 12345;
  double rnd();
  void once(int sample, double gain, double rate = 1);
};

}  // namespace xbr
