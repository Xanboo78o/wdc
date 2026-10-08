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
  explicit Gearbox(const std::string &cls);
  void update(double dt, double speedKmh, double throttle);
};

class EngineAudio {
 public:
  ~EngineAudio();
  bool open(const std::string &cls);      // false = no audio device; the game runs silent
  void setClass(const std::string &cls);
  void set(double rpm, double throttle, double gain, double speed);
  void close();
  bool ok() const { return stream != nullptr; }

  // called on the audio thread
  void render(float *out, int n);

 private:
  SDL_AudioStream *stream = nullptr;
  std::atomic<float> tRpm{4500}, tThr{0}, tGain{0}, tSpeed{0};
  std::atomic<int> pendingCls{-1};
  struct Core;
  Core *core = nullptr;
};

}  // namespace xbr
