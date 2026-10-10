// pitwall.hpp — THE ENGINEER'S MOUTH AND EARS. (Adam, 2026-10-10: "give him a frfr tts and a
// radio filter, and make him loud ... he needs to be able to answer anything".)
//
// engineer.hpp decides what is worth saying. This says it:
//
//   a line            -> tools/voice.py /tts (Kokoro, a real-sounding voice, on this laptop)
//                     -> THE RADIO: band-passed to a headset's 300-3400 Hz, squashed, driven
//                        until it bites, hiss under it, a key-up click and a squelch tail
//                     -> its own SDL audio stream, on top of the engine
//   hold the button   -> the microphone, while it is held
//   let go            -> tools/voice.py /stt (Whisper) -> heard(): the game asks the engineer
//   he has no answer  -> ask(): a language model on this laptop (Ollama), told the race's
//                        facts and who he is — so he answers ANYTHING, and stays himself
//
// One worker thread does every slow thing in order, so nothing here ever stalls a frame.
// The voice server is started if it is not running, and stopped again if this started it.
// Nothing leaves the machine.
#pragma once
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

struct SDL_AudioStream;

namespace xbr {

// THE RADIO, as a filter: speech at `rate` in, a team-radio transmission at 48 kHz out —
// peak near full scale, with the click in front and the squelch behind. Pure; pitwall_main
// writes it to a WAV so it can be measured.
std::vector<float> radioVoice(const std::vector<float> &speech, int rate, unsigned seed = 1);

class Pitwall {
 public:
  ~Pitwall() { stop(); }
  bool start(const std::string &repoDir);          // false = no audio device; nothing was started
  void stop();
  bool ok() const { return running.load(); }

  void say(const std::string &text, int pri = 1);  // pri as engineer.hpp: 2 now, 1 a call, 0 droppable talk
  void ptt(bool held);                             // every frame: is the radio button down?
  bool heard(std::string &text);                   // you said something (once per transmission)
  // One for the model. `facts` is what is true (Engineer::facts); the answer is spoken.
  void ask(const std::string &text, const std::string &facts, const std::string &driver);
  void setVolume(double v) { vol = (float)v; }
  bool caption(std::string &text);                 // a line has just started to play: show it
  bool talking() const { return playing.load(); }
  bool listening() const { return keyed.load(); }
  bool thinking() const { return busy.load() > 0; }
  float duck() const { return duckOut.load(); }    // what to multiply everything else by: 1, or less while the radio is open
  void update(double dt);                          // every frame
  void wait();                                     // (tools) until everything queued has been said

  std::string voice;                               // "" = the voice server's own choice (~/.local/share/wdc-voice/voice.txt)
  std::string model;                               // "" = $XBR_ENGINEER_MODEL, or llama3.2:3b
  void render(float *out, int frames);             // the audio thread: mono

 private:
  struct Job { int kind = 0, pri = 1; std::string text, facts, driver; std::vector<short> pcm; double at = 0; };
  std::atomic<bool> running{false}, playing{false}, keyed{false}, quit{false};
  std::atomic<int> busy{0};
  std::atomic<float> vol{1}, duckOut{1};
  std::string repo;
  std::thread worker;
  std::mutex m;
  std::condition_variable cv;
  std::deque<Job> jobs;
  std::deque<std::string> heardQ, captionQ;
  std::vector<std::pair<std::string, std::string>> history;      // you, him: the last few exchanges
  // what is on its way to the speakers
  std::mutex pm;
  std::vector<float> play;
  size_t playAt = 0;
  std::deque<std::pair<size_t, std::string>> capAt;              // sample index a line starts at -> its caption
  SDL_AudioStream *out = nullptr, *mic = nullptr;
  bool micTried = false, wasHeld = false, voiceOk = false, voiceTold = false, brainTold = false;
  int voicePid = -1;
  double clock = 0, duckNow = 1;

  void run();
  bool ensureVoice();
  void speak(const Job &j);
  void transcribe(const Job &j);
  void answer(const Job &j);
  void push(Job j);
};

}  // namespace xbr
