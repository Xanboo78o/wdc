// pitwall.cpp — see pitwall.hpp.
#include "pitwall.hpp"

#include <SDL3/SDL.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "json.hpp"

namespace xbr {

static const int VOICE_PORT = 8177, BRAIN_PORT = 11434;

static double nowS() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

// ------------------------------------------------------------------ a small HTTP client, for this machine only
// One request, one answer, the connection closed after it. status 0 = nobody is listening.
struct Reply { int status = 0; std::string body; };
static Reply http(int port, const char *method, const char *path, const std::string &type, const std::string &body, double timeoutS) {
  Reply r;
  const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return r;
  timeval tv{(time_t)timeoutS, (suseconds_t)((timeoutS - std::floor(timeoutS)) * 1e6)};
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
  sockaddr_in a{};
  a.sin_family = AF_INET; a.sin_port = htons((uint16_t)port); a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (::connect(fd, (sockaddr *)&a, sizeof a) < 0) { ::close(fd); return r; }
  std::string req = std::string(method) + " " + path + " HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n";
  if (!body.empty() || std::strcmp(method, "POST") == 0) req += "Content-Type: " + type + "\r\nContent-Length: " + std::to_string(body.size()) + "\r\n";
  req += "\r\n" + body;
  for (size_t off = 0; off < req.size();) {
    const ssize_t n = ::send(fd, req.data() + off, req.size() - off, MSG_NOSIGNAL);
    if (n <= 0) { ::close(fd); return r; }
    off += (size_t)n;
  }
  std::string all; char buf[16384];
  for (;;) { const ssize_t n = ::recv(fd, buf, sizeof buf, 0); if (n <= 0) break; all.append(buf, (size_t)n); }
  ::close(fd);
  const size_t h = all.find("\r\n\r\n");
  if (h == std::string::npos || all.size() < 12) return r;
  r.status = std::atoi(all.c_str() + 9);
  r.body = all.substr(h + 4);
  return r;
}
static std::string jstr(const std::string &s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    if (c == '"') o += "\\\""; else if (c == '\\') o += "\\\\"; else if (c == '\n') o += "\\n";
    else if (c < 0x20) o += ' '; else o += (char)c;
  }
  return o + "\"";
}

// ------------------------------------------------------------------ THE RADIO
namespace {
struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0;
  // RBJ cookbook. kind: 0 low-pass, 1 high-pass, 2 peaking (gain in dB)
  Biquad(int kind, double f, double q, double dB = 0, double rate = 48000) {
    const double w = 2 * M_PI * f / rate, c = std::cos(w), al = std::sin(w) / (2 * q), A = std::pow(10, dB / 40);
    double a0 = 1;
    if (kind == 0) { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (kind == 1) { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  }
  double run(double x) { const double y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; }
};
}  // namespace

std::vector<float> radioVoice(const std::vector<float> &speech, int rate, unsigned seed) {
  const int R = 48000;
  auto rnd = [&seed]() { seed = seed * 1664525u + 1013904223u; return (double)(seed >> 8) / 8388608.0 - 1.0; };
  // to 48 kHz
  std::vector<double> x((size_t)((double)speech.size() * R / std::max(1, rate)));
  for (size_t i = 0; i < x.size(); i++) {
    const double p = (double)i * rate / R; const size_t k = (size_t)p; const double f = p - (double)k;
    x[i] = k + 1 < speech.size() ? speech[k] * (1 - f) + speech[k + 1] * f : k < speech.size() ? speech[k] : 0;
  }
  if (x.empty()) return {};
  // a headset microphone and a narrow channel: nothing under 320 Hz, nothing over 3.3 kHz, and the 2 kHz that makes a
  // voice cut through an engine pushed forward
  Biquad hp1(1, 320, 0.71), hp2(1, 320, 0.71), lp1(0, 3300, 0.71), lp2(0, 3300, 0.9), pres(2, 2100, 1.0, 7);
  for (double &v : x) v = pres.run(lp2.run(lp1.run(hp2.run(hp1.run(v)))));
  // a fast, hard compressor: every syllable arrives at the same level, which is most of what "radio" sounds like —
  // and all of what LOUD is
  double env = 0, rms = 0;
  for (double v : x) rms += v * v;
  rms = std::sqrt(rms / (double)x.size()) + 1e-9;
  const double att = std::exp(-1.0 / (0.002 * R)), rel = std::exp(-1.0 / (0.070 * R)), thr = 0.35;
  for (double &v : x) {
    v *= 0.22 / rms;
    const double a = std::fabs(v);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    if (env > thr) v *= std::pow(env / thr, -0.8);            // 5:1 above the threshold
  }
  // the transmitter, overdriven until it bites; then the channel again, so the edge it grew is a radio's edge
  Biquad lp3(0, 3400, 0.71), lp4(0, 3400, 0.71), hp3(1, 300, 0.71);
  double hiss = 0, peak = 0;
  for (double &v : x) {
    v = std::tanh(3.4 * v) / std::tanh(3.4 * 0.6);
    hiss = 0.82 * hiss + 0.18 * rnd();
    v = hp3.run(lp4.run(lp3.run(v + 0.022 * hiss)));
    peak = std::max(peak, std::fabs(v));
  }
  // LOUD: set by how much voice there is, not by its one tallest peak (which left it 6 dB quieter than it could be),
  // and the peaks that then stick out are rounded off, as a transmitter's limiter rounds them
  double sq = 0; size_t nv = 0;
  for (double v : x) if (std::fabs(v) > 0.03 * peak) { sq += v * v; nv++; }
  const double g = 0.38 / std::max(std::sqrt(sq / (double)std::max<size_t>(nv, 1)), 1e-6);
  // key-up: 30 ms of open channel and a click. key-off: the squelch closing behind the last word.
  const size_t pre = (size_t)(0.045 * R), post = (size_t)(0.14 * R);
  std::vector<float> out;
  out.reserve(pre + x.size() + post);
  Biquad nb(0, 3000, 0.7), nh(1, 500, 0.7);
  for (size_t i = 0; i < pre; i++) {
    const double t = (double)i / (double)pre;
    out.push_back((float)(nh.run(nb.run(rnd())) * 0.20 * (0.4 + 0.6 * t) + (i < 90 ? 0.5 * std::sin((double)i * 0.35) * (1 - (double)i / 90) : 0)));
  }
  for (double v : x) out.push_back((float)(0.94 * std::tanh(v * g / 0.94)));
  for (size_t i = 0; i < post; i++) {
    const double t = (double)i / (double)post;
    out.push_back((float)(nh.run(nb.run(rnd())) * 0.34 * (t < 0.55 ? 1 : (1 - t) / 0.45)));
  }
  return out;
}

// ------------------------------------------------------------------ sound in, sound out
static void SDLCALL pitCb(void *ud, SDL_AudioStream *stream, int additional, int) {
  float buf[1024];
  int frames = additional / (int)sizeof(float);
  while (frames > 0) {
    const int n = std::min(frames, 1024);
    ((Pitwall *)ud)->render(buf, n);
    SDL_PutAudioStreamData(stream, buf, n * (int)sizeof(float));
    frames -= n;
  }
}
void Pitwall::render(float *o, int frames) {
  std::lock_guard<std::mutex> l(pm);
  const float v = vol.load();
  for (int i = 0; i < frames; i++) {
    if (playAt < play.size()) {
      while (!capAt.empty() && capAt.front().first <= playAt) { std::lock_guard<std::mutex> l2(m); captionQ.push_back(capAt.front().second); capAt.pop_front(); }
      o[i] = play[playAt++] * v;
    } else o[i] = 0;
  }
  const bool on = playAt < play.size();
  if (!on && !play.empty()) { play.clear(); playAt = 0; }
  playing = on;
}

bool Pitwall::start(const std::string &repoDir) {
  if (running) return true;
  if (!SDL_WasInit(SDL_INIT_AUDIO) && !SDL_InitSubSystem(SDL_INIT_AUDIO)) return false;
  const SDL_AudioSpec spec{SDL_AUDIO_F32, 1, 48000};
  out = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, &spec, pitCb, this);
  if (!out) return false;
  SDL_ResumeAudioStreamDevice(out);
  repo = repoDir;
  if (model.empty()) { const char *e = std::getenv("XBR_ENGINEER_MODEL"); model = e && *e ? e : "llama3.2:3b"; }
  quit = false; running = true;
  worker = std::thread([this] { run(); });
  return true;
}
void Pitwall::stop() {
  if (!running) return;
  { std::lock_guard<std::mutex> l(m); quit = true; }
  cv.notify_all();
  if (worker.joinable()) worker.join();
  if (out) { SDL_DestroyAudioStream(out); out = nullptr; }
  if (mic) { SDL_DestroyAudioStream(mic); mic = nullptr; }
  if (voicePid > 0) { kill(voicePid, SIGTERM); waitpid(voicePid, nullptr, WNOHANG); voicePid = -1; }
  running = false;
}
void Pitwall::push(Job j) {
  j.at = nowS();
  { std::lock_guard<std::mutex> l(m); jobs.push_back(std::move(j)); }
  cv.notify_all();
}
void Pitwall::say(const std::string &text, int pri) {
  if (!running || text.empty()) return;
  {
    std::lock_guard<std::mutex> l(m);
    // talk is for silence: never queued behind anything, never over you
    if (pri == 0 && (!jobs.empty() || playing || keyed || busy > 0)) return;
    // something urgent: whatever small talk was waiting is no longer worth the air
    if (pri == 2) jobs.erase(std::remove_if(jobs.begin(), jobs.end(), [](const Job &j) { return j.kind == 0 && j.pri == 0; }), jobs.end());
  }
  Job j; j.kind = 0; j.pri = pri; j.text = text;
  push(std::move(j));
}
void Pitwall::ask(const std::string &text, const std::string &facts, const std::string &driver) {
  if (!running) return;
  Job j; j.kind = 2; j.text = text; j.facts = facts; j.driver = driver;
  push(std::move(j));
}
bool Pitwall::heard(std::string &text) {
  std::lock_guard<std::mutex> l(m);
  if (heardQ.empty()) return false;
  text = heardQ.front(); heardQ.pop_front();
  return true;
}
bool Pitwall::caption(std::string &text) {
  std::lock_guard<std::mutex> l(m);
  if (captionQ.empty()) return false;
  text = captionQ.front(); captionQ.pop_front();
  return true;
}
void Pitwall::wait() {
  for (;;) {
    { std::lock_guard<std::mutex> l(m); std::lock_guard<std::mutex> l2(pm); if (jobs.empty() && busy == 0 && playAt >= play.size()) return; }
    SDL_Delay(30);
  }
}

// THE BUTTON. Down: the microphone opens (it is asked for the first time you press, never before). Up: what it
// heard goes to be understood. Half a second is not a transmission; twenty is where it stops listening.
void Pitwall::ptt(bool held) {
  if (!running) return;
  if (held && !wasHeld) {
    if (!mic && !micTried) {
      micTried = true;
      const SDL_AudioSpec spec{SDL_AUDIO_S16, 1, 16000};
      mic = SDL_OpenAudioDeviceStream(SDL_AUDIO_DEVICE_DEFAULT_RECORDING, &spec, nullptr, nullptr);
      if (!mic) { std::fprintf(stderr, "xbr: the radio has no microphone (%s)\n", SDL_GetError()); say("I cannot hear you. There is no microphone.", 2); }
    }
    if (mic) { SDL_ClearAudioStream(mic); SDL_ResumeAudioStreamDevice(mic); keyed = true; }
  } else if (!held && wasHeld && mic && keyed) {
    keyed = false;
    SDL_PauseAudioStreamDevice(mic);
    Job j; j.kind = 1;
    const int n = SDL_GetAudioStreamAvailable(mic);
    if (n > 0) { j.pcm.resize((size_t)n / 2); SDL_GetAudioStreamData(mic, j.pcm.data(), n); }
    if (j.pcm.size() > 16000 * 20) j.pcm.resize(16000 * 20);
    if (j.pcm.size() >= 16000 * 4 / 10) push(std::move(j));
  }
  wasHeld = held;
}
void Pitwall::update(double dt) {
  // the engine steps back while the radio is open, either way: quickly down, slowly back
  const double want = keyed ? 0.35 : playing ? 0.5 : 1.0;
  duckNow += (want - duckNow) * std::min(1.0, dt * (want < duckNow ? 14 : 3));
  duckOut = (float)duckNow;
}

// ------------------------------------------------------------------ the worker
void Pitwall::run() {
  // Before the lights, not at the first call of the race: the voice server takes fifteen seconds to load, and the
  // language model twenty to reach the graphics card. (Measured: the first question otherwise waits 26 s.)
  ensureVoice();
  if (!quit) http(BRAIN_PORT, "POST", "/api/chat", "application/json", "{\"model\":" + jstr(model) + ",\"stream\":false,\"keep_alive\":\"30m\",\"messages\":[]}", 60);
  for (;;) {
    Job j;
    {
      std::unique_lock<std::mutex> l(m);
      cv.wait(l, [this] { return quit.load() || !jobs.empty(); });
      if (quit) return;
      // what you said, and what must be said now, before what could wait
      auto it = jobs.begin();
      for (auto k = jobs.begin(); k != jobs.end(); ++k) {
        const int rk = k->kind != 0 ? 3 : k->pri, ri = it->kind != 0 ? 3 : it->pri;
        if (rk > ri) it = k;
      }
      j = std::move(*it); jobs.erase(it);
      busy++;
    }
    const double age = nowS() - j.at;
    // A call about the race is only true for a few seconds. Late is worse than never.
    if (j.kind == 0 && ((j.pri == 0 && age > 3) || (j.pri == 1 && age > 7) || age > 12)) { busy--; continue; }
    // ...and it goes on air after everything already on its way there. Talk waits for nobody; a call waits three
    // seconds; even a flag is not news nine seconds on.
    if (j.kind == 0) {
      double backlog;
      { std::lock_guard<std::mutex> l(pm); backlog = playAt < play.size() ? (double)(play.size() - playAt) / 48000.0 : 0; }
      if ((j.pri == 0 && backlog > 0.3) || (j.pri == 1 && backlog > 3) || backlog > 9) { busy--; continue; }
    }
    if (j.kind == 0) speak(j);
    else if (j.kind == 1) transcribe(j);
    else answer(j);
    busy--;
  }
}

// tools/voice.py, in its own Python: running already (the browser game's, or ours), or started here.
bool Pitwall::ensureVoice() {
  if (voiceOk) return true;
  if (http(VOICE_PORT, "GET", "/health", "", "", 1.5).status == 200) return voiceOk = true;
  if (voicePid < 0) {
    const char *home = std::getenv("HOME");
    const std::string py = std::string(home ? home : "") + "/.local/share/wdc-voice/venv/bin/python", script = repo + "/tools/voice.py";
    if (access(py.c_str(), X_OK) != 0 || access(script.c_str(), R_OK) != 0) {
      if (!voiceTold) { voiceTold = true; std::fprintf(stderr, "xbr: no voice for the engineer (%s or %s is missing)\n", py.c_str(), script.c_str()); }
      return false;
    }
    const pid_t p = fork();
    if (p == 0) {
      prctl(PR_SET_PDEATHSIG, SIGTERM);        // the game goes, by any road: so does this
      const int fd = open("/tmp/xbr-voice.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
      if (fd >= 0) { dup2(fd, 1); dup2(fd, 2); }
      setpriority(PRIO_PROCESS, 0, 5);
      execl(py.c_str(), py.c_str(), script.c_str(), (char *)nullptr);
      _exit(127);
    }
    voicePid = p;
    std::fprintf(stderr, "xbr: started the engineer's voice (tools/voice.py), log in /tmp/xbr-voice.log\n");
  }
  // it loads two models before it answers: about fifteen seconds, once
  for (int i = 0; i < 90 && !quit; i++) {
    if (http(VOICE_PORT, "GET", "/health", "", "", 1.0).status == 200) return voiceOk = true;
    int st; if (voicePid > 0 && waitpid(voicePid, &st, WNOHANG) == voicePid) { voicePid = -2; break; }
    SDL_Delay(500);
  }
  if (!voiceTold) { voiceTold = true; std::fprintf(stderr, "xbr: the engineer's voice did not come up (see /tmp/xbr-voice.log)\n"); }
  return false;
}

void Pitwall::speak(const Job &j) {
  if (!ensureVoice()) return;
  // only what a mouth can say
  std::string text;
  for (unsigned char c : j.text) if (c >= 0x20 && c < 0x7f && c != '*' && c != '"' && c != '_' && c != '#') text += (char)c;
  if (text.empty()) return;
  std::string body = "{\"text\":" + jstr(text);
  if (!voice.empty()) body += ",\"voice\":" + jstr(voice);
  body += "}";
  const Reply r = http(VOICE_PORT, "POST", "/tts", "application/json", body, 25);
  if (r.status != 200 || r.body.size() < 48) { voiceOk = false; std::fprintf(stderr, "xbr: the engineer's voice failed (%d) on: %s\n", r.status, text.c_str()); return; }
  // a WAV: 16-bit mono; the rate at byte 24, the samples after "data"
  const std::string &w = r.body;
  int rate = 22050; std::memcpy(&rate, w.data() + 24, 4);
  size_t d = w.find("data");
  if (d == std::string::npos || rate < 8000 || rate > 96000) return;
  d += 8;
  std::vector<float> pcm((w.size() - d) / 2);
  for (size_t i = 0; i < pcm.size(); i++) { short s; std::memcpy(&s, w.data() + d + i * 2, 2); pcm[i] = (float)s / 32768.0f; }
  std::vector<float> tx = radioVoice(pcm, rate, (unsigned)(j.at * 1000));
  std::lock_guard<std::mutex> l(pm);
  if (playAt >= play.size()) { play.clear(); playAt = 0; }
  else play.insert(play.end(), (size_t)(0.18 * 48000), 0.0f);          // a breath between two transmissions
  capAt.push_back({play.size(), j.text});
  play.insert(play.end(), tx.begin(), tx.end());
  playing = true;
}

void Pitwall::transcribe(const Job &j) {
  if (!ensureVoice()) return;
  // a WAV round what the microphone gave
  const uint32_t n = (uint32_t)(j.pcm.size() * 2), rate = 16000;
  std::string w = "RIFF";
  auto u32 = [&w](uint32_t v) { w.append((const char *)&v, 4); };
  auto u16 = [&w](uint16_t v) { w.append((const char *)&v, 2); };
  u32(36 + n); w += "WAVEfmt "; u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16); w += "data"; u32(n);
  w.append((const char *)j.pcm.data(), n);
  const Reply r = http(VOICE_PORT, "POST", "/stt", "audio/wav", w, 30);
  if (r.status != 200) { voiceOk = false; std::fprintf(stderr, "xbr: could not understand the radio (%d)\n", r.status); return; }
  std::string text;
  try { text = Json::parse(r.body)["text"].s(); } catch (...) {}
  std::lock_guard<std::mutex> l(m);
  heardQ.push_back(text);                      // empty too: the game says "say again"
}

// WHO HE IS, for the model. The race's numbers never come from here: engineer.cpp answers those itself, exactly.
static const char *PERSONA =
    "You are %s's race engineer AND his best mate, on team radio in his ear while he drives a racing car flat out. "
    "You are LOUD, confident, quick and warm: a rowing coxswain's fire with a best friend's humour. You are also very smart and you know everything.\n"
    "RULES:\n"
    "- ALWAYS answer what he actually said, whatever it is: racing, maths, history, school, life, jokes, nonsense. Give the real answer, briefly.\n"
    "- One or two short spoken sentences, 25 words at most. Plain words only: no emoji, no asterisks, no quote marks, no lists.\n"
    "- If it was not about the race, answer it properly and then pull him back to the driving in a few words.\n"
    "- If he sings, jokes or messes about, play along for one beat, then: focus, focus.\n"
    "- If he is angry at another driver, be on HIS side, tell him you are getting the stewards to look at it, and calm him down.\n"
    "- If he is down on himself, lift him. You believe in him completely.\n"
    "- Numbers about the race (gaps, positions, laps, tyres) come ONLY from FACTS. If it is not in FACTS, say you do not have it on your screen. Never invent one.\n"
    "- Never refuse, never say you cannot help. You always have something to say.\n"
    "- Never say you are an AI, a model or an assistant. You are his engineer. Use his name now and then, not every time.";

void Pitwall::answer(const Job &j) {
  char sys[2400];
  std::snprintf(sys, sizeof sys, PERSONA, j.driver.c_str());
  std::string msgs = "{\"role\":\"system\",\"content\":" + jstr(sys) + "}";
  auto turn = [&msgs](const char *role, const std::string &s) { msgs += std::string(",{\"role\":\"") + role + "\",\"content\":" + jstr(s) + "}"; };
  // how he sounds, shown rather than told (a small model copies what it has seen itself say)
  turn("user", "FACTS: Position P6. Lap 4 of 10.\n" + j.driver + " says: la la laaa, we are the champions");
  turn("assistant", "Beautiful voice, " + j.driver + ". Truly. Now, focus, focus, eyes on the apex!");
  turn("user", "FACTS: Position P9. Lap 2 of 8.\n" + j.driver + " says: what's the capital of Australia");
  turn("assistant", "Canberra, mate, not Sydney. Now brake late and send it!");
  turn("user", "FACTS: Position P4. Lap 7 of 12.\n" + j.driver + " says: THAT IDIOT JUST RAN ME OFF THE ROAD THAT'S A PENALTY");
  turn("assistant", "I saw it, I saw it! It is with the stewards now. Deep breath, " + j.driver + ", we get him back on track!");
  turn("user", "FACTS: Position P11. Lap 3 of 6.\n" + j.driver + " says: what's the gap to the leader");
  turn("assistant", "I do not have the leader on my screen right now, " + j.driver + ". Eyes forward, I will come back to you.");
  turn("user", "FACTS: Position P14. Lap 5 of 9.\n" + j.driver + " says: i'm so bad at this");
  turn("assistant", "Rubbish! You are quicker than half this grid and you know it. Next corner, hit your marks, come on!");
  for (const auto &h : history) { turn("user", j.driver + " says: " + h.first); turn("assistant", h.second); }
  turn("user", "FACTS: " + j.facts + "\n" + j.driver + " says: " + j.text);
  const std::string body = "{\"model\":" + jstr(model) + ",\"stream\":false,\"keep_alive\":\"30m\",\"messages\":[" + msgs
                         + "],\"options\":{\"temperature\":0.7,\"num_predict\":56}}";
  const Reply r = http(BRAIN_PORT, "POST", "/api/chat", "application/json", body, 25);
  std::string text;
  if (r.status == 200) { try { text = Json::parse(r.body)["message"]["content"].s(); } catch (...) {} }
  if (text.empty()) {
    // never a plausible "copy that" from a brain that is not there
    if (!brainTold) { brainTold = true; std::fprintf(stderr, "xbr: the engineer's language model did not answer (Ollama on :%d, model %s, status %d). `systemctl --user start ollama`\n", BRAIN_PORT, model.c_str(), r.status); }
    Job s; s.kind = 0; s.pri = 2; s.at = nowS();
    s.text = "I heard you, " + j.driver + ", but I have lost the line to the factory. Race questions only, for now.";
    speak(s);
    return;
  }
  // one line, no stage directions, nothing a mouth cannot say
  if (const size_t nl = text.find('\n'); nl != std::string::npos) text.resize(nl);
  std::string clean;
  for (unsigned char c : text) if (c >= 0x20 && c < 0x7f && c != '*' && c != '"') clean += (char)c;
  while (!clean.empty() && clean.front() == ' ') clean.erase(clean.begin());
  // a radio call, not a lecture: three sentences at the very most, and never more than a breath
  { int ends = 0; for (size_t i = 0; i < clean.size(); i++) if ((clean[i] == '.' || clean[i] == '!' || clean[i] == '?') && (i + 1 == clean.size() || clean[i + 1] == ' ') && ++ends == 3) { clean.resize(i + 1); break; } }
  if (clean.size() > 200) { clean.resize(200); if (const size_t e = clean.find_last_of(".!?"); e != std::string::npos && e > 40) clean.resize(e + 1); }
  if (clean.empty()) clean = "Copy, " + j.driver + ".";
  history.push_back({j.text, clean});
  if (history.size() > 4) history.erase(history.begin());
  Job s; s.kind = 0; s.pri = 2; s.at = nowS(); s.text = clean;
  speak(s);
}

}  // namespace xbr
