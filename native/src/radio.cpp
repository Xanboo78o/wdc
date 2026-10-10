// radio.cpp — see radio.hpp.
#include "radio.hpp"

#include <SDL3/SDL.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace xbr {

static const char *SINK = "xbr_radio";
static const size_t RING = 48000 * 2 * 4;          // four seconds, stereo

static std::string sh(const std::string &cmd) {
  std::string out;
  FILE *p = popen(cmd.c_str(), "r");
  if (!p) return out;
  char b[256];
  while (std::fgets(b, sizeof b, p)) out += b;
  pclose(p);
  return out;
}

// Every stream a browser is playing, onto the radio. (New songs can be new streams: asked again every two seconds.)
static void moveBrowsers() {
  std::system("pactl list sink-inputs 2>/dev/null | awk '/^Sink Input #/{id=substr($3,2)} "
              "/application.name = \"(Chromium|Google Chrome|Chrome|Firefox|Brave|Zen|LibreWolf|Vivaldi|Microsoft Edge)/{print id}' "
              "| while read i; do pactl move-sink-input \"$i\" xbr_radio 2>/dev/null; done");
}

// THE ROOM: Schroeder's reverberator as Freeverb tunes it — eight comb filters side by side,
// each a delay that feeds itself through a damper, then four all-pass filters to smear what
// comes out. The right channel's delays are 23 samples longer, which is what makes it wide.
void Radio::buildRoom() {
  static const int COMB[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617}, PASS[4] = {556, 441, 341, 225};
  const double k = 48000.0 / 44100.0;
  for (int c = 0; c < 2; c++) {
    for (int i = 0; i < 8; i++) { comb[c][i].b.assign((size_t)((COMB[i] + c * 23) * k), 0); comb[c][i].i = 0; comb[c][i].store = 0; }
    for (int i = 0; i < 4; i++) { pass[c][i].b.assign((size_t)((PASS[i] + c * 23) * k), 0); pass[c][i].i = 0; }
    echo[c].assign(48000, 0);
  }
  echoI = 0;
}

static void SDLCALL radioCb(void *ud, SDL_AudioStream *stream, int additional, int) {
  float buf[2048];
  int frames = additional / (int)(2 * sizeof(float));
  while (frames > 0) {
    const int n = std::min(frames, 1024);
    ((Radio *)ud)->render(buf, n);
    SDL_PutAudioStreamData(stream, buf, n * 2 * (int)sizeof(float));
    frames -= n;
  }
}

void Radio::render(float *out, int frames) {
  // how big the room is: how long it rings, how dull it is, how much of it you hear, how loud the echo
  static const float ROOM[4] = {0, 0.80f, 0.90f, 0.955f}, DAMP[4] = {0, 0.35f, 0.28f, 0.20f}, WET[4] = {0, 0.26f, 0.38f, 0.52f}, ECHO[4] = {0, 0.10f, 0.16f, 0.22f};
  const int room = std::max(0, std::min(3, roomSet.load()));
  const float volT = volSet.load(), cabinT = cabinSet.load() ? 1.0f : 0.0f;
  const size_t echoLen = 48000 * 0.34;                  // the echo comes back a third of a second later
  float peak = 0;
  size_t r = rd.load(), w = wr.load();
  for (int f = 0; f < frames; f++) {
    float in[2] = {0, 0};
    if (r != w) { in[0] = ring[r]; in[1] = ring[(r + 1) % RING]; r = (r + 2) % RING; }
    wetNow += (WET[room] - wetNow) * 0.0004f; volNow += (volT - volNow) * 0.0008f; cabinNow += (cabinT - cabinNow) * 0.0006f;
    const float mono = (in[0] + in[1]) * 0.015f;        // Freeverb's input gain
    // the beat: what is under about 150 Hz, followed quickly up and slowly down, against its own average over a second.
    // A kick is the moment the quick one jumps clear of the slow one.
    {
      const float dry = (in[0] + in[1]) * 0.5f;
      bLP1 += (dry - bLP1) * 0.0196f; bLP2 += (bLP1 - bLP2) * 0.0196f;
      const float e = std::fabs(bLP2);
      envFast += (e - envFast) * (e > envFast ? 0.012f : 0.00045f);
      envSlow += (e - envSlow) * 0.00003f;
      sinceBeat += 1.0f / 48000;
      if (sinceBeat > 0.19f && envFast > 0.012f && envFast > envSlow * 1.55f + 0.004f && e >= envFast * 0.98f) { beatOut.fetch_add(1); sinceBeat = 0; }
    }
    for (int c = 0; c < 2; c++) {
      float acc = 0;
      for (Comb &q : comb[c]) {
        const float y = q.b[q.i];
        q.store = y * (1 - DAMP[room]) + q.store * DAMP[room];
        q.b[q.i] = mono + q.store * ROOM[room];
        q.i = (q.i + 1) % q.b.size();
        acc += y;
      }
      for (Pass &q : pass[c]) {
        const float bo = q.b[q.i], y = -acc + bo;
        q.b[q.i] = acc + bo * 0.5f;
        q.i = (q.i + 1) % q.b.size();
        acc = y;
      }
      // the echo: what was played a third of a second ago, quieter, and from the other side
      const size_t ei = (echoI + echo[c].size() - echoLen) % echo[c].size();
      const float ec = echo[1 - c][ei];
      echo[c][echoI] = in[c] + ec * 0.35f;
      float y = in[c] * (1 - wetNow * 0.45f) + acc * wetNow * 3.0f + ec * ECHO[room];
      // shut in a car, the top comes off it: it is in the cabin with you, not in your ears
      lp[c] += (y - lp[c]) * 0.22f;
      y = y + (lp[c] - y) * 0.55f * cabinNow;
      y *= volNow;
      y = std::tanh(y);                                 // never louder than loud
      out[f * 2 + c] = y;
      peak = std::max(peak, std::fabs(y));
    }
    echoI = (echoI + 1) % echo[0].size();
  }
  rd.store(r);
  levelOut.store(std::max(peak, levelOut.load() * 0.9f));
  bassOut.store(std::min(1.0f, envFast * 5.0f));
}

bool Radio::start() {
  if (running.load()) return true;
  if (std::system("command -v pactl >/dev/null 2>&1 && command -v parec >/dev/null 2>&1") != 0) return false;
  // one radio at a time: another game window already has it
  if (sh("pactl list short sinks 2>/dev/null").find(SINK) != std::string::npos) return false;
  const std::string id = sh("pactl load-module module-null-sink sink_name=xbr_radio sink_properties=device.description=XBR-Radio 2>/dev/null");
  module = std::atoi(id.c_str());
  if (module <= 0) { module = -1; return false; }
  // IF THE GAME DIES, the music must not be left playing into nothing: a small watcher
  // outlives us and takes the virtual output away, which sends every stream back.
  {
    char cmd[256];
    std::snprintf(cmd, sizeof cmd, "(while kill -0 %d 2>/dev/null; do sleep 1; done; pactl unload-module %d 2>/dev/null) >/dev/null 2>&1 &", (int)getpid(), module);
    std::system(cmd);
  }
  ring.assign(RING, 0);
  wr = 0; rd = 0;
  buildRoom();
  rec = popen("parec -d xbr_radio.monitor --format=float32le --rate=48000 --channels=2 --latency-msec=30 2>/dev/null", "r");
  if (!rec) { stop(); return false; }
  running = true;
  reader = std::thread([this] {
    float buf[960];
    while (running.load()) {
      const size_t n = std::fread(buf, sizeof(float), 960, rec);
      if (n == 0) { if (std::feof(rec) || std::ferror(rec)) break; continue; }
      size_t w = wr.load();
      const size_t r = rd.load();
      for (size_t i = 0; i + 1 < n; i += 2) {
        const size_t next = (w + 2) % RING;
        if (next == r) break;                           // the game is not listening fast enough: drop, do not wrap
        ring[w] = buf[i]; ring[w + 1] = buf[i + 1];
        w = next;
      }
      wr.store(w);
    }
  });
  mover = std::thread([this] {
    while (running.load()) {
      moveBrowsers();
      for (int i = 0; i < 20 && running.load(); i++) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  });
  SDL_InitSubSystem(SDL_INIT_AUDIO);
  const SDL_AudioSpec spec{SDL_AUDIO_F32, 2, 48000};
  stream = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, radioCb, this);
  if (!stream) { stop(); return false; }
  SDL_ResumeAudioStreamDevice(stream);
  return true;
}

void Radio::stop() {
  const bool was = running.exchange(false);
  if (stream) { SDL_DestroyAudioStream(stream); stream = nullptr; }
  if (module > 0) {
    // taking the output away sends the browser's streams back to the default one
    std::system(("pactl unload-module " + std::to_string(module) + " 2>/dev/null").c_str());
    module = -1;
  }
  if (mover.joinable()) mover.join();
  if (rec) { std::system("pkill -f 'parec -d xbr_radio.monitor' 2>/dev/null"); }
  if (reader.joinable()) reader.join();
  if (rec) { pclose(rec); rec = nullptr; }
  (void)was;
}

}  // namespace xbr
