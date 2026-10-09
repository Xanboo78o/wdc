// livery_main.cpp — a contact sheet of a car's liveries, to LOOK at them.
//
//   build/xbr-livery <car> <out.ppm> [--from N] [--count N] [--view front|rear|side|top] [--cols N] [--tile WxH]
//
// Draws liveries N, N+1, ... of data/livery/<car>.json on the baked car, one a
// tile, row by row, into a hidden target on the laptop's own GPU, and writes a
// PPM. No window, no sound, no wheel: nothing of the game runs but the car
// shader in dress.cpp, so what is on the sheet is what is on the grid.
#include <epoxy/gl.h>
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "dress.hpp"

using namespace xbr;

int main(int argc, char **argv) {
  if (argc < 3) { std::fprintf(stderr, "xbr-livery <car> <out.ppm> [--from N] [--count N] [--view front|rear|side|top] [--cols N] [--tile WxH]\n"); return 2; }
  const std::string key = argv[1], out = argv[2];
  int from = 0, count = 20, cols = 5, tw = 384, th = 216, stride = 1;
  std::string view = "front";
  float dress_sweep = 0;
  for (int i = 3; i < argc; i++) {
    const std::string a = argv[i];
    auto val = [&]() -> std::string { if (i + 1 >= argc) { std::fprintf(stderr, "xbr-livery: %s needs a value\n", a.c_str()); std::exit(2); } return argv[++i]; };
    if (a == "--from") from = std::atoi(val().c_str());
    else if (a == "--count") count = std::atoi(val().c_str());
    else if (a == "--cols") cols = std::atoi(val().c_str());
    else if (a == "--step") stride = std::max(1, std::atoi(val().c_str()));      // every Nth livery (--from 3 --step 8: the pride cars)
    else if (a == "--view") view = val();
    else if (a == "--sweep") dress_sweep = (float)std::atof(val().c_str());      // wheel blur, radians, to look at it
    else if (a == "--tile") { if (std::sscanf(val().c_str(), "%dx%d", &tw, &th) != 2) { std::fprintf(stderr, "xbr-livery: --tile WxH\n"); return 2; } }
    else { std::fprintf(stderr, "xbr-livery: unknown option %s\n", a.c_str()); return 2; }
  }
  SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "offscreen");
  if (!SDL_Init(SDL_INIT_VIDEO)) { SDL_ResetHint(SDL_HINT_VIDEO_DRIVER); if (!SDL_Init(SDL_INIT_VIDEO)) { std::fprintf(stderr, "xbr-livery: SDL: %s\n", SDL_GetError()); return 1; } }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_Window *win = SDL_CreateWindow("xbr-livery", 320, 200, SDL_WINDOW_OPENGL | SDL_WINDOW_HIDDEN);
  SDL_GLContext ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  if (!ctx) { std::fprintf(stderr, "xbr-livery: no OpenGL 3.3 context: %s\n", SDL_GetError()); return 1; }
  SDL_GL_MakeCurrent(win, ctx);
  const char *base = SDL_GetBasePath();
  const std::string root = std::string(base ? base : "./") + "../../";

  Dress dress;
  if (!dress.init(root + "data", std::string(base ? base : "./") + "tex")) return 1;
  const PackCar *pc = dress.pack(key);
  if (!pc) return 1;
  const int total = (int)dress.liveryCount(*pc);
  if (!total) { std::fprintf(stderr, "xbr-livery: %s has no liveries (node tools/livery/bake.mjs %s)\n", key.c_str(), key.c_str()); return 1; }
  count = std::max(1, std::min(count, (total - from + stride - 1) / stride));
  const int rows = (count + cols - 1) / cols, W = cols * tw, H = rows * th, SS = 2;      // drawn at twice the size and averaged down
  GLuint fbo, col, dep;
  glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glGenTextures(1, &col); glBindTexture(GL_TEXTURE_2D, col);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, W * SS, H * SS, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, col, 0);
  glGenRenderbuffers(1, &dep); glBindRenderbuffer(GL_RENDERBUFFER, dep);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, W * SS, H * SS);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, dep);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { std::fprintf(stderr, "xbr-livery: no target\n"); return 1; }
  glEnable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glEnable(GL_SCISSOR_TEST);

  // where the camera stands: yaw round the car (0 = dead ahead, 90 = its right), pitch above the road, metres away
  float yaw = 38, pitch = 16, dist = 5.6f;
  if (view == "rear") { yaw = 218; pitch = 18; }
  else if (view == "side") { yaw = 90; pitch = 3; dist = 5.9f; }
  else if (view == "top") { yaw = 90; pitch = 86; dist = 6.6f; }
  const float ya = yaw * 3.14159265f / 180, pa = pitch * 3.14159265f / 180;
  dist *= (float)(packInfo(*pc).wheelbase / 2.55 * 0.5 + 0.5);      // a longer car stands further off
  const float eye[3] = {std::cos(ya) * std::cos(pa) * dist, 0.55f + std::sin(pa) * dist, std::sin(ya) * std::cos(pa) * dist};
  const float at[3] = {0, 0.55f, 0}, up[3] = {view == "top" ? 1.0f : 0.0f, view == "top" ? 0.0f : 1.0f, 0};
  const Mat4 VP = Mat4::perspective(30.0f * 3.14159265f / 180, (float)tw / th, 0.1f, 100.0f) * Mat4::lookAt(eye, at, up);
  Look look;                                   // a bright ordinary day
  const bool none[4] = {false, false, false, false};
  for (int k = 0; k < count; k++) {
    const int x = (k % cols) * tw * SS, y = (rows - 1 - k / cols) * th * SS;
    glViewport(x, y, tw * SS, th * SS); glScissor(x, y, tw * SS, th * SS);
    glClearColor(0.50f, 0.52f, 0.56f, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    dress.frame(VP, eye, look, 0);
    dress.setLivery(from + k * stride);
    dress.setWheelSweep(dress_sweep);
    dress.drawPack(*pc, Mat4::identity(), 0.22, 0, nullptr, none, nullptr, false);
    dress.drawPack(*pc, Mat4::identity(), 0.22, 0, nullptr, none, nullptr, true);
  }
  glFinish();
  std::vector<unsigned char> px((size_t)W * SS * H * SS * 3), small((size_t)W * H * 3);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, W * SS, H * SS, GL_RGB, GL_UNSIGNED_BYTE, px.data());
  for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) for (int c = 0; c < 3; c++) {
    int s = 0;
    for (int j = 0; j < SS; j++) for (int i = 0; i < SS; i++) s += px[((size_t)((H - 1 - y) * SS + j) * W * SS + (size_t)x * SS + i) * 3 + c];
    small[((size_t)y * W + x) * 3 + c] = (unsigned char)(s / (SS * SS));
  }
  FILE *o = std::fopen(out.c_str(), "wb");
  if (!o) { std::fprintf(stderr, "xbr-livery: cannot write %s\n", out.c_str()); return 1; }
  std::fprintf(o, "P6\n%d %d\n255\n", W, H);
  std::fwrite(small.data(), 1, small.size(), o);
  std::fclose(o);
  std::printf("xbr-livery: %s liveries %d..%d of %d, %s -> %s (%dx%d)\n", key.c_str(), from, from + count - 1, total, view.c_str(), out.c_str(), W, H);
  return 0;
}
