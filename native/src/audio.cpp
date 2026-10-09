// audio.cpp — js/gearbox.js and js/enginecore.js, ported. See the top of
// js/enginecore.js for the four real recordings the model was measured against.
#include "audio.hpp"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>

namespace xbr {

static const double PI_ = 3.141592653589793;
static double clampd0(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---- gearbox ---------------------------------------------------------------------
const BoxSpec &boxFor(const std::string &cls) {
  static const BoxSpec f1{4500, 19000, 18600, 0.74, {85, 115, 146, 176, 208, 240, 280, 321}};
  static const BoxSpec f4{1800, 6500, 6300, 0.72, {55, 80, 108, 138, 175, 215}};
  static const BoxSpec gt3{1250, 7800, 7500, 0.70, {95, 130, 168, 205, 240, 273}};
  if (cls == "f4") return f4;
  if (cls == "gt3") return gt3;
  return f1;
}

Gearbox::Gearbox(const std::string &cls) : box(&boxFor(cls)) { rpm = box->idle; }

static double rpmAt(const BoxSpec &box, double speedKmh, int gear) {
  const double top = box.tops[(size_t)std::max(0, std::min((int)box.tops.size() - 1, gear))];
  const double r = box.limit * (speedKmh / top);
  return std::max(box.idle, std::min(box.limit, r));
}

void Gearbox::update(double dt, double speedKmh, double throttle) {
  shifted = 0;
  if (shiftT > 0) shiftT = std::max(0.0, shiftT - dt);
  const int last = (int)box->tops.size() - 1;
  const double raw = box->limit * (speedKmh / box->tops[(size_t)gear]);
  if (shiftT == 0) {
    if (raw > box->shiftUp && gear < last) {
      gear++; shiftT = 0.05; shifted = 1;
    } else if (gear > 0) {
      const double below = box->limit * (speedKmh / box->tops[(size_t)gear - 1]);
      if (below < box->limit * box->downAt) { gear--; shiftT = 0.05; shifted = -1; }
    }
  }
  const double target = rpmAt(*box, speedKmh, gear);
  const double cut = shiftT > 0 ? 0.82 : 1;
  const double want = target * cut * (0.93 + 0.07 * std::min(1.0, throttle));
  rpm += (std::max(box->idle, want) - rpm) * std::min(1.0, dt * 26);
}

// ---- the engine --------------------------------------------------------------------
namespace {
struct Biquad {
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  void set(char type, double f, double q, double sr) {
    const double w = 2 * PI_ * std::min(f, sr * 0.45) / sr, c = std::cos(w), s = std::sin(w), a = s / (2 * q);
    double B0, B1, B2;
    if (type == 'b') { B0 = a; B1 = 0; B2 = -a; }
    else if (type == 'l') { B0 = (1 - c) / 2; B1 = 1 - c; B2 = (1 - c) / 2; }
    else { B0 = (1 + c) / 2; B1 = -(1 + c); B2 = (1 + c) / 2; }
    const double a0 = 1 + a;
    b0 = B0 / a0; b1 = B1 / a0; b2 = B2 / a0; a1 = -2 * c / a0; a2 = (1 - a) / a0;
  }
  double run(double x) {
    const double y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  }
};

struct EngineP {
  int cyl;
  double idle, limit;
  double pipes[4][3];
  double noise, jitterA, jitterT, cylSpread, drive, whineTeeth;
};
// The V10 is the one Adam chose and the one that was measured (js/enginecore.js).
const EngineP V10{10, 4500, 19000,
                  {{1100, 2.2, 1.0}, {2600, 2.6, 1.1}, {4800, 2.8, 0.75}, {7600, 3.0, 0.3}},
                  0.55, 0.34, 0.012, 0.24, 2.4, 29};
// The browser game plays the V10 core for every class. These two are the same
// model with the cylinder count and rev range of the car, and pipes moved down
// to match: a first pass, NOT measured against recordings the way the V10 was.
const EngineP I4{4, 1800, 6500,
                 {{420, 2.0, 1.0}, {1100, 2.4, 1.0}, {2400, 2.6, 0.6}, {4200, 3.0, 0.25}},
                 0.50, 0.30, 0.014, 0.22, 2.2, 23};
const EngineP V8{8, 1250, 7800,
                 {{300, 1.8, 1.1}, {850, 2.2, 1.0}, {2100, 2.6, 0.6}, {4000, 3.0, 0.25}},
                 0.52, 0.34, 0.014, 0.26, 2.6, 21};
const EngineP &paramsFor(int cls) { return cls == 0 ? I4 : cls == 2 ? V8 : V10; }
int clsIndex(const std::string &c) { return c == "f4" ? 0 : c == "gt3" ? 2 : 1; }
}  // namespace

struct EngineAudio::Core {
  double sr;
  EngineP P;
  uint32_t s;
  double cylA[12], cylT[12];
  Biquad pipes[4], body, hiss, road;
  double dc = 0;
  double rpm, thr = 0, gain = 0, speed = 0;
  double phase = 0, nextAt = 0, pulse = 0, burst = 0, crackle = 0, whineP = 0;
  int next = 0;
  bool cut = false;

  double rand() { s = s * 1664525u + 1013904223u; return s / 4294967296.0; }

  Core(double sr_, const EngineP &P_, uint32_t seed = 78) : sr(sr_), P(P_), s(seed) {
    for (int i = 0; i < P.cyl; i++) cylA[i] = 1 + (rand() * 2 - 1) * P.cylSpread;
    for (int i = 0; i < P.cyl; i++) cylT[i] = (rand() * 2 - 1) * P.cylSpread * 0.08;
    for (int i = 0; i < 4; i++) pipes[i].set('b', P.pipes[i][0], P.pipes[i][1], sr);
    body.set('l', 2400, 0.7, sr);
    hiss.set('h', 3000, 0.7, sr);
    road.set('l', 400, 0.6, sr);
    rpm = P.idle;
    nextAt = cylT[0];
  }

  void render(float *out, int n, double Trpm, double Tthr, double Tgain, double Tspeed) {
    for (int i = 0; i < n; i++) {
      rpm += (Trpm - rpm) * 0.0009;
      thr += (Tthr - thr) * 0.0012;
      gain += (Tgain - gain) * 0.002;
      speed += (Tspeed - speed) * 0.0005;
      const double r = std::max(P.idle / 3, rpm), revs = std::min(1.0, r / P.limit);
      const double fire = r / 60 * P.cyl / 2;
      phase += r / 60 / 2 / sr;
      if (phase >= 1) { phase -= 1; next = 0; nextAt = cylT[0] / P.cyl; }
      cut = r > P.limit - 150;
      const double slot = (next + nextAt * P.cyl) / P.cyl;
      if (next < P.cyl && phase >= slot) {
        const int k = next;
        next++;
        const double jit = (rand() * 2 - 1) * P.jitterT;
        nextAt = cylT[next % P.cyl] + jit;
        const bool skip = cut && rand() < 0.55;
        if (!skip) {
          const double load = 0.32 + 0.68 * thr;
          const double a = cylA[k] * (1 + (rand() * 2 - 1) * P.jitterA) * load;
          pulse += a;
          burst = std::max(burst, a * (0.35 + 1.3 * rand()));
        } else {
          crackle = std::max(crackle, 0.6 + 0.4 * rand());
        }
        if (thr < 0.15 && revs > 0.45 && rand() < 0.012) crackle = std::max(crackle, 0.4 + 0.6 * rand());
      }
      const double decP = std::exp(-1 / (sr * 0.2 / fire));
      const double decB = std::exp(-1 / (sr * std::min(0.35, 0.16 + 0.19 * (1 - revs)) / fire));
      const double white = rand() * 2 - 1;
      const double pressure = pulse; pulse *= decP;
      const double rasp = white * burst * P.noise * (0.6 + 0.4 * thr); burst *= decB;
      const double pop = white * crackle * 1.1; crackle *= 0.994;
      double pp = 0;
      const double ex = pressure * 0.8 + rasp + pop;
      for (int p = 0; p < 4; p++) pp += pipes[p].run(ex) * P.pipes[p][2];
      double x = body.run(pressure) * 0.9 + pp * 1.6;
      dc += (x - dc) * 0.002; x -= dc;
      x += hiss.run(white) * 0.03 * revs * (0.4 + 0.6 * thr);
      x = std::tanh(P.drive * x) / std::tanh(P.drive);
      whineP += r / 60 * P.whineTeeth / 4 / sr;
      if (whineP > 1) whineP -= 1;
      const double moving = std::min(1.0, speed / 8);
      x += std::sin(2 * PI_ * whineP) * 0.035 * moving * revs * (1 - 0.6 * thr);
      x += road.run(white) * 0.25 * std::pow(std::min(1.0, speed / 85), 1.3);
      out[i] = (float)(x * gain * (0.55 + 0.45 * revs));
    }
  }
};

// ---- the mix -----------------------------------------------------------------------
namespace {
enum { S_TYRE, S_GRAVEL, S_GRASS, S_SCRAPE, S_DIRT1, S_DIRT2, S_DIRT3, S_DIRT4, S_BUMP1, S_BUMP2, S_HEAVY, S_CRASH1, S_COUNT = S_CRASH1 + 11 };
const int N_LOOPS = 4, N_SHOTS = 12;
}

struct EngineAudio::Mixer {
  std::vector<float> buf[S_COUNT];
  struct Loop {
    std::atomic<float> gain{0}, rate{1}, cut{8000};
    double pos = 0, g = 0, lp = 0;
  } loop[N_LOOPS];
  struct Shot { int s = -1; double pos = 0, gain = 0, rate = 1; } shot[N_SHOTS];
  std::atomic<float> wind{0}, rain{0}, volume{1};
  double windLP = 0, windLP2 = 0, rainHP = 0, windG = 0, rainG = 0;
  uint32_t ns = 99;
  double noise() { ns = ns * 1664525u + 1013904223u; return ns / 2147483648.0 - 1.0; }

  void load(int i, const std::string &path) {
    SDL_AudioSpec spec;
    Uint8 *data = nullptr;
    Uint32 len = 0;
    if (!SDL_LoadWAV(path.c_str(), &spec, &data, &len)) return;
    const SDL_AudioSpec want{SDL_AUDIO_F32, 1, 48000};
    Uint8 *out = nullptr;
    int outLen = 0;
    if (SDL_ConvertAudioSamples(&spec, data, (int)len, &want, &out, &outLen) && out) {
      buf[i].assign((float *)out, (float *)out + outLen / (int)sizeof(float));
      SDL_free(out);
    }
    SDL_free(data);
  }

  void render(float *out, int n) {
    for (int k = 0; k < N_LOOPS; k++) {
      Loop &L = loop[k];
      const std::vector<float> &b = buf[k];
      const double tg = L.gain.load();
      if (b.size() < 2 || (tg < 1e-4 && L.g < 1e-4)) { L.g = tg; continue; }
      const double rate = L.rate.load(), a = 1 - std::exp(-2 * PI_ * std::min(20000.0f, L.cut.load()) / 48000.0);
      for (int i = 0; i < n; i++) {
        L.g += (tg - L.g) * 0.0015;
        const size_t i0 = (size_t)L.pos, i1 = (i0 + 1) % b.size();
        const double fr = L.pos - (double)i0, smp = b[i0] + (b[i1] - b[i0]) * fr;
        L.lp += (smp - L.lp) * a;
        out[i] += (float)(L.lp * L.g);
        L.pos += rate;
        if (L.pos >= (double)b.size()) L.pos -= (double)b.size();
      }
    }
    for (auto &S : shot) {
      if (S.s < 0) continue;
      const std::vector<float> &b = buf[S.s];
      for (int i = 0; i < n; i++) {
        const size_t i0 = (size_t)S.pos;
        if (i0 + 1 >= b.size()) { S.s = -1; break; }
        const double fr = S.pos - (double)i0;
        out[i] += (float)((b[i0] + (b[i0 + 1] - b[i0]) * fr) * S.gain);
        S.pos += S.rate;
      }
    }
    // wind and rain: noise, shaped. The wind is a low roar that rises with
    // speed; the rain is the hiss of it on the car.
    const double wt = wind.load(), rt = rain.load();
    if (wt > 1e-4 || windG > 1e-4 || rt > 1e-4 || rainG > 1e-4) {
      for (int i = 0; i < n; i++) {
        windG += (wt - windG) * 0.0008; rainG += (rt - rainG) * 0.0008;
        const double w = noise();
        windLP += (w - windLP) * 0.035; windLP2 += (windLP - windLP2) * 0.035;
        rainHP += (w - rainHP) * 0.45;
        out[i] += (float)(windLP2 * windG * 3.0 + (w - rainHP) * rainG);
      }
    }
  }
};

double EngineAudio::rnd() { rngS = rngS * 1664525u + 1013904223u; return rngS / 4294967296.0; }

void EngineAudio::once(int sample, double gain, double rate) {
  if (!stream || !mix || mix->buf[sample].empty()) return;
  SDL_LockAudioStream(stream);
  for (auto &S : mix->shot)
    if (S.s < 0) { S.s = sample; S.pos = 0; S.gain = gain; S.rate = rate; break; }
  SDL_UnlockAudioStream(stream);
}

static void SDLCALL audioCb(void *ud, SDL_AudioStream *stream, int additional, int) {
  auto *self = (EngineAudio *)ud;
  float buf[1024];
  int frames = additional / (int)sizeof(float);
  while (frames > 0) {
    const int n = std::min(frames, 1024);
    self->render(buf, n);
    SDL_PutAudioStreamData(stream, buf, n * (int)sizeof(float));
    frames -= n;
  }
}

void EngineAudio::render(float *out, int n) {
  const int pc = pendingCls.exchange(-1);
  if (pc >= 0 || !core) { delete core; core = new Core(48000, paramsFor(pc >= 0 ? pc : 1)); }
  core->render(out, n, tRpm.load(), tThr.load(), tGain.load(), tSpeed.load());
  if (mix) {
    mix->render(out, n);
    // limiter -> trim -> a soft clip: it bends peaks and cannot exceed full scale
    const double vol = mix->volume.load();
    for (int i = 0; i < n; i++) out[i] = (float)(std::tanh(out[i] * 0.72) * 0.96 * vol);
  }
}

bool EngineAudio::open(const std::string &cls, const std::string &dataDir) {
  if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) return false;
  pendingCls = clsIndex(cls);
  mix = new Mixer();
  static const char *FILES[S_CRASH1] = {"tyre_squeal", "surf_gravel", "surf_grass", "scrape", "dirt_1", "dirt_2", "dirt_3", "dirt_4",
                                        "bump_1", "bump_2", "crash_heavy"};
  for (int i = 0; i < S_CRASH1; i++) mix->load(i, dataDir + "/audio/" + FILES[i] + ".wav");
  for (int i = 0; i < 11; i++) { char b[32]; std::snprintf(b, sizeof b, "/audio/crash_%02d.wav", i + 1); mix->load(S_CRASH1 + i, dataDir + b); }
  SDL_AudioSpec spec{SDL_AUDIO_F32, 1, 48000};
  stream = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, audioCb, this);
  if (!stream) return false;
  SDL_ResumeAudioStreamDevice(stream);
  return true;
}

void EngineAudio::setClass(const std::string &cls) { pendingCls = clsIndex(cls); }

// js/audio.js Engine.update, for the emulated engine and the recorded ground.
void EngineAudio::update(const SoundIn &in) {
  if (!mix) return;
  const double master = 0.78;
  t += in.dt;
  const double kmh = in.speed * 3.6;
  const bool onGravel = in.surf > 0.5 && in.surf < 0.7, onGrass = in.surf < 0.5, onKerb = in.surf > 0.9 && in.surf < 1;
  const double off = (onGravel || onGrass) ? std::min(1.0, kmh / 30) : 0;
  // off the tarmac the engine bogs and catches: two waves that never line up
  double wob = 1, stut = 1;
  if (off > 0) {
    const double w = 0.62 * std::sin(t * 37.2) + 0.38 * std::sin(t * 23.7 + 1.7);
    wob = 1 + off * w * 0.045;
    stut = 1 - off * (0.18 + 0.34 * std::max(0.0, w));
  }
  duck = std::min(1.0, duck + in.dt * 0.45);
  const double live = in.paused ? 0 : 1;
  tRpm = (float)(in.rpm * wob); tThr = (float)clampd0(in.throttle); tSpeed = (float)in.speed;
  tGain = (float)(master * 1.7 * duck * stut * live * 0.55);
  mix->volume = (float)in.volume;

  // tyres: a fraction of THIS car's limit, silent below a threshold
  const double frac = in.peak > 0 ? std::min(1.6, std::fabs(in.slip) / in.peak) : 0;
  const double over = std::max(0.0, frac - 0.18) / 0.82;
  const double spT = std::min(1.0, kmh / 90);
  mix->loop[S_TYRE].gain = (float)(live * master * 0.22 * std::pow(over, 1.4) * spT);
  mix->loop[S_TYRE].rate = (float)(0.72 + 0.55 * std::min(1.0, over));
  mix->loop[S_TYRE].cut = (float)(700 + 9000 * std::pow(std::min(1.0, over), 0.8));

  const double sp = std::min(1.0, kmh / 140), moving = std::min(1.0, kmh / 15);
  mix->loop[S_GRAVEL].gain = (float)(onGravel ? live * master * 1.25 * moving * (0.45 + 0.55 * sp) : 0);
  mix->loop[S_GRAVEL].rate = (float)(0.75 + 0.55 * sp);
  mix->loop[S_GRAVEL].cut = (float)(2500 + 9000 * sp);
  mix->loop[S_GRASS].gain = (float)(onGrass ? live * master * 1.05 * moving * (0.4 + 0.6 * sp) : 0);
  mix->loop[S_GRASS].rate = (float)(0.8 + 0.4 * sp);
  mix->loop[S_GRASS].cut = (float)(1500 + 7000 * sp);
  mix->loop[S_SCRAPE].gain = (float)(in.wall && kmh > 15 ? live * master * 1.4 * std::min(1.0, kmh / 80) : 0);
  mix->loop[S_SCRAPE].rate = (float)(0.8 + 0.5 * sp);
  mix->loop[S_SCRAPE].cut = 9000;
  if (!in.paused) {
    const bool offNow = onGravel || onGrass;
    // dropping a wheel off the road at speed is a spray of dirt, once
    if (offNow && !wasOff && kmh > 40) once(S_DIRT1 + (int)(rnd() * 4), 0.8 * (0.6 + 0.6 * sp));
    wasOff = offNow;
    if (onGravel && kmh > 20 && t > lastStone) {
      once(S_DIRT1 + (int)(rnd() * 4), 0.8 * (0.25 + 0.5 * sp) * rnd(), 1.1);
      lastStone = t + 0.08 + rnd() * (0.5 - 0.35 * sp);
    }
    // a kerb is a row of thuds, one a stripe: distance, not time
    if (onKerb && kmh > 10) {
      kerbDist += in.speed * in.dt;
      if (kerbDist > 2.0) { kerbDist = 0; once(rnd() < 0.5 ? S_BUMP1 : S_BUMP2, 0.45 * (0.35 + 0.65 * sp), 0.8 + 0.3 * sp); }
    } else kerbDist = 1.9;
  }
  const double sn = std::min(1.0, kmh / 321);
  const double gust = 0.55 * std::sin(t * 0.43) + 0.30 * std::sin(t * 0.96 + 1.1) + 0.15 * std::sin(t * 2.05 + 2.7);
  mix->wind = (float)(live * 0.20 * std::pow(sn, 1.7) * std::max(0.0, 1 + 0.36 * gust));
  mix->rain = (float)(live * 0.10 * in.rain * (0.5 + 0.5 * sn));
}

// "Crashes? Traumatizing." — and then, twice, "too loud": the engine leads.
void EngineAudio::hit(double closing) {
  if (!mix || t - lastCrash < 0.6) return;        // a wall grind is one crash, not one a substep
  lastCrash = t;
  const double k = std::min(1.0, closing / 14);
  if (k > 0.75) once(S_HEAVY, 0.22 * 3.0 * k, 1.0);
  once(S_CRASH1 + (int)(rnd() * 11), 0.22 * 3.0 * (0.35 + 0.65 * k), 0.9 + 0.2 * rnd());
  duck = std::min(duck, 1 - 0.6 * k);
}

void EngineAudio::close() {
  if (stream) { SDL_DestroyAudioStream(stream); stream = nullptr; }
  delete core; core = nullptr;
  delete mix; mix = nullptr;
}

EngineAudio::~EngineAudio() { close(); }

}  // namespace xbr
