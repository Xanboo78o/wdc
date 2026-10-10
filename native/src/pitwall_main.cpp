// pitwall_main.cpp — xbr-pitwall: the engineer's voice, radio and language model on their own, with no game.
//
//   xbr-pitwall --say "Box, box."            speak a line through the radio
//   xbr-pitwall --ask "what is 7 times 8"    one for the model, spoken
//   xbr-pitwall --mic 4                      listen for 4 seconds, print what was heard, answer it
//   xbr-pitwall --voices                     every voice the server has says its own name
//     --voice NAME     which voice (default: the server's own choice)
//     --wav FILE       --say only: write the transmission to FILE and do not play it
//     --mute           do everything but make no sound (for measuring latency)
#include <SDL3/SDL.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "pitwall.hpp"

using namespace xbr;

int main(int argc, char **argv) {
  std::string sayText, askText, voice, wav;
  double micS = 0; bool voices = false, mute = false;
  for (int i = 1; i < argc; i++) {
    const std::string s = argv[i];
    const auto val = [&]() -> const char * { if (i + 1 >= argc) { std::fprintf(stderr, "xbr-pitwall: %s needs a value\n", s.c_str()); std::exit(2); } return argv[++i]; };
    if (s == "--filter") {
      // --filter IN.wav OUT.wav: the radio alone, on a 16-bit mono WAV, written as one (for measuring it)
      const char *in = val(), *outp = val();
      std::FILE *f = std::fopen(in, "rb"); if (!f) { std::fprintf(stderr, "xbr-pitwall: cannot read %s\n", in); return 1; }
      std::string w; char b[65536]; size_t n; while ((n = std::fread(b, 1, sizeof b, f)) > 0) w.append(b, n); std::fclose(f);
      int rate = 0; std::memcpy(&rate, w.data() + 24, 4);
      const size_t d = w.find("data") + 8;
      std::vector<float> pcm((w.size() - d) / 2);
      for (size_t k = 0; k < pcm.size(); k++) { short v; std::memcpy(&v, w.data() + d + k * 2, 2); pcm[k] = v / 32768.0f; }
      const std::vector<float> tx = radioVoice(pcm, rate);
      std::FILE *o = std::fopen(outp, "wb"); if (!o) return 1;
      const uint32_t bytes = (uint32_t)tx.size() * 2, r48 = 48000, br = 96000, riff = 36 + bytes, sixteen = 16; const uint16_t one = 1, two = 2, bits = 16;
      std::fwrite("RIFF", 1, 4, o); std::fwrite(&riff, 4, 1, o); std::fwrite("WAVEfmt ", 1, 8, o); std::fwrite(&sixteen, 4, 1, o); std::fwrite(&one, 2, 1, o); std::fwrite(&one, 2, 1, o);
      std::fwrite(&r48, 4, 1, o); std::fwrite(&br, 4, 1, o); std::fwrite(&two, 2, 1, o); std::fwrite(&bits, 2, 1, o); std::fwrite("data", 1, 4, o); std::fwrite(&bytes, 4, 1, o);
      for (float v : tx) { const short q = (short)(std::max(-1.0f, std::min(1.0f, v)) * 32767); std::fwrite(&q, 2, 1, o); }
      std::fclose(o);
      return 0;
    }
    else if (s == "--say") sayText = val();
    else if (s == "--ask") askText = val();
    else if (s == "--mic") micS = std::atof(val());
    else if (s == "--voice") voice = val();
    else if (s == "--wav") wav = val();
    else if (s == "--voices") voices = true;
    else if (s == "--mute") mute = true;
    else { std::fprintf(stderr, "xbr-pitwall: unknown argument %s\n", s.c_str()); return 2; }
  }
  if (sayText.empty() && askText.empty() && micS <= 0 && !voices) { std::fprintf(stderr, "xbr-pitwall: --say, --ask, --mic or --voices\n"); return 2; }
  if (!wav.empty() || mute) SDL_SetHint(SDL_HINT_AUDIO_DRIVER, "dummy");
  if (!SDL_Init(SDL_INIT_AUDIO)) { std::fprintf(stderr, "xbr-pitwall: %s\n", SDL_GetError()); return 1; }
  const char *base = SDL_GetBasePath();                // native/build/
  const std::string repo = std::string(base ? base : "./") + "../..";
  Pitwall pw;
  pw.voice = voice;
  if (!pw.start(repo)) { std::fprintf(stderr, "xbr-pitwall: no audio device (%s)\n", SDL_GetError()); return 1; }
  const auto t0 = std::chrono::steady_clock::now();
  auto since = [&] { return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(); };
  auto drain = [&] { std::string c; while (pw.caption(c)) std::printf("%6.2fs  HIM: %s\n", since(), c.c_str()); };
  auto finish = [&] { for (;;) { drain(); if (!pw.thinking() && !pw.talking()) { SDL_Delay(120); drain(); if (!pw.thinking() && !pw.talking()) break; } SDL_Delay(30); } };
  if (voices) {
    // the quick ones (piper). The Kokoro voices (bm_george, am_fenrir, ...) answer to --voice, but take seconds on this CPU.
    const char *V[] = {"piper", "ryan", "alan", "joe"};
    for (const char *v : V) {
      pw.voice = v;
      pw.say(std::string("This is ") + (std::strcmp(v, "piper") ? v : "the first one") + ". Box, box! Hammer time, Xander, everything you have got!", 2);
      finish();
      SDL_Delay(500);
    }
  }
  if (!sayText.empty()) { pw.say(sayText, 2); finish(); }
  if (!askText.empty()) { pw.ask(askText, "Not in a race. The driver is in the garage.", "Xander"); finish(); }
  if (micS > 0) {
    std::printf("listening for %.0f s...\n", micS); std::fflush(stdout);
    pw.ptt(true); SDL_Delay((Uint32)(micS * 1000)); pw.ptt(false);
    std::string h;
    for (int i = 0; i < 600 && !pw.heard(h); i++) SDL_Delay(50);
    std::printf("%6.2fs  YOU: %s\n", since(), h.empty() ? "(nothing heard)" : h.c_str());
    if (!h.empty()) { pw.ask(h, "Not in a race. The driver is in the garage.", "Xander"); finish(); }
  }
  pw.stop();
  SDL_Quit();
  return 0;
}
