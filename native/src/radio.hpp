// radio.hpp — YOUR MUSIC, THROUGH THE GAME. (Adam, 2026-10-09: reverb and echo on the music
// playing in his browser, "can u just do that through the game automatically? and make it
// sound like its coming from the game".)
//
// While the game runs, the browser's sound is taken off the speakers and brought here
// instead: a virtual output ("XBR Radio") is made, the browser's streams are moved onto it,
// the game listens to that output, puts the music in a room — reverb, an echo behind it —
// and plays it out with everything else. When the game stops, by any road, the virtual
// output is removed and the music goes back to where it was.
//
// Linux with PipeWire/PulseAudio only (pactl, parec). Anywhere else, or if either is
// missing, start() returns false and nothing changes.
#pragma once
#include <atomic>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

struct SDL_AudioStream;

namespace xbr {

class Radio {
 public:
  ~Radio() { stop(); }
  // room: 0 clean (only the volume is yours), 1 a room, 2 a hall, 3 a cathedral.
  bool start();
  void stop();
  bool ok() const { return running.load(); }
  void set(int room, double volume, bool cabin) { roomSet = room; volSet = (float)volume; cabinSet = cabin; }
  float level() const { return levelOut.load(); }          // what is coming through, 0..1: for a meter, and for checking it works
  // THE MUSIC, FOR THE EYE (Adam: "make the ui and colors bump and ease wit my music"):
  // beats() goes up by one at every kick of the bass; bass() is how much low end there is now, 0..1.
  int beats() const { return beatOut.load(); }
  float bass() const { return bassOut.load(); }

  void render(float *out, int frames);                    // the audio thread: stereo, interleaved

 private:
  std::atomic<bool> running{false};
  std::atomic<int> roomSet{1};
  std::atomic<float> volSet{1.0f}, levelOut{0}, bassOut{0};
  std::atomic<int> beatOut{0};
  float bLP1 = 0, bLP2 = 0, envFast = 0, envSlow = 0, sinceBeat = 1;
  std::atomic<bool> cabinSet{false};
  int module = -1;
  FILE *rec = nullptr;
  std::thread reader, mover;
  SDL_AudioStream *stream = nullptr;
  // what the browser has played and the game has not yet: a ring, stereo
  std::vector<float> ring;
  std::atomic<size_t> wr{0}, rd{0};
  // the room
  struct Comb { std::vector<float> b; size_t i = 0; float store = 0; };
  struct Pass { std::vector<float> b; size_t i = 0; };
  Comb comb[2][8];
  Pass pass[2][4];
  std::vector<float> echo[2];
  size_t echoI = 0;
  float wetNow = 0, volNow = 0, lp[2] = {0, 0}, cabinNow = 0;
  void buildRoom();
};

}  // namespace xbr
