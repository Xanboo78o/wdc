// audio.hpp — the engine you hear. js/gearbox.js (gears and rpm, a sound model
// and not a drivetrain) and js/enginecore.js (an engine fired one combustion at
// a time), on an SDL audio stream.
//
// And js/spatial.js, the 360-degree sound: the nearest rivals each get an engine
// of their own, placed round your head (EngineAudio::field).
//
// NOT PORTED YET: the reverb of the place, the radio and the music.
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
  bool cabin = false;                        // you are shut inside a car with a roof: the rain is on its glass
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
  // THE FIELD, ALL ROUND YOU (js/spatial.js — Adam, 2026-09-25: "add 360 sound, i will play wit headphones";
  // 2026-10-10: "crank 360 sound through the roof"). Hand it the rivals nearest your head, each frame: where each
  // is (metres to your right, metres ahead — negative = left, behind), how fast it is closing on you, and what
  // its engine is doing. It gives each an engine of its own (the same model as yours, its own gearbox) and puts it
  // there: louder in the near ear, a fraction of a millisecond late and duller in the far one, duller again behind
  // you, pitched by Doppler. Up to FIELD_VOICES at once; the rest are silent.
  static const int FIELD_VOICES = 4;
  struct FieldCar { int id = -1; std::string cls; double throttle = 0, speed = 0, right = 0, ahead = 0, closing = 0; };
  void field(const FieldCar *cars, int n, double dt, double volume);
  void close();
  bool ok() const { return stream != nullptr; }
  void renderStereo(float *lr, int n);    // called on the audio thread: n frames, left and right interleaved

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
  // one rival's engine: what the game last said of it (atomics), and the audio thread's own state
  struct Voice {
    std::atomic<int> cls{-1};
    std::atomic<float> rpm{3000}, thr{0}, speed{0}, gainL{0}, gainR{0}, lagL{0}, lagR{0}, openL{1}, openR{1};
    Core *core = nullptr; int has = -1;
    float gl = 0, gr = 0, lpL = 0, lpR = 0, ring[64] = {}; int w = 0;
  };
  Voice voice[FIELD_VOICES];
  // (main thread) which rival each voice is, and that rival's gearbox
  int voiceId[FIELD_VOICES] = {-1, -1, -1, -1};
  Gearbox *voiceBox[FIELD_VOICES] = {nullptr, nullptr, nullptr, nullptr};
  std::string voiceCls[FIELD_VOICES];
  struct Mixer;
  Mixer *mix = nullptr;
  // main-thread state
  double t = 0, duck = 1, kerbDist = 1.9, lastStone = 0, lastCrash = -9;
  bool wasOff = false;
  double thunderAt = -1;
  int lastThunder = -1;
  unsigned rngS = 12345;
  double rnd();
  void once(int sample, double gain, double rate = 1);
};

}  // namespace xbr
