// radio_test.cpp — is the radio's plumbing sound? Runs it for a few seconds with no window and says what came through.
//   build/xbr-radio-test [seconds] [room 0..3]
#include <SDL3/SDL.h>
#include <cstdio>
#include <cstdlib>
#include "radio.hpp"
int main(int argc, char **argv) {
  const double secs = argc > 1 ? std::atof(argv[1]) : 5;
  const int room = argc > 2 ? std::atoi(argv[2]) : 2;
  xbr::Radio r;
  if (!r.start()) { std::fprintf(stderr, "radio: could not start (no pactl/parec, or already running)\n"); return 1; }
  r.set(room, 1.0, false);
  float most = 0;
  for (int i = 0; i < (int)(secs * 10); i++) { SDL_Delay(100); most = r.level() > most ? r.level() : most; if (i % 10 == 9) std::fprintf(stderr, "radio: %.0f s, level %.3f\n", (i + 1) / 10.0, r.level()); }
  r.stop();
  std::fprintf(stderr, "radio: loudest %.3f — %s\n", most, most > 0.005f ? "music came through" : "SILENCE (nothing was playing, or nothing was moved onto the radio)");
  return 0;
}
