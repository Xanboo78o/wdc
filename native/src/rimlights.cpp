// rimlights.cpp — see rimlights.hpp.
#include "rimlights.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

#include <fcntl.h>
#include <glob.h>
#include <termios.h>
#include <unistd.h>

namespace xbr {

RimLights::~RimLights() {
  if (fd >= 0) { off(); ::close(fd); }
}

bool RimLights::open() {
  if (const char *e = std::getenv("XBR_RIM")) if (std::string(e) == "0") return false;
  if (const char *e = std::getenv("XBR_RIM_DEV")) dev = std::atoi(e);
  std::string path;
  glob_t g{};
  if (glob("/dev/serial/by-id/usb-Gudsen_*", 0, nullptr, &g) == 0 && g.gl_pathc > 0) path = g.gl_pathv[0];
  globfree(&g);
  if (path.empty()) return false;
  fd = ::open(path.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
  if (fd < 0) return false;
  termios t{};
  if (tcgetattr(fd, &t) != 0) { ::close(fd); fd = -1; return false; }
  cfmakeraw(&t);
  cfsetispeed(&t, B115200); cfsetospeed(&t, B115200);
  t.c_cflag |= CLOCAL | CREAD;
  tcsetattr(fd, TCSANOW, &t);
  tcflush(fd, TCIOFLUSH);
  std::fprintf(stderr, "xbr: rim lights on %s (device %d)\n", path.c_str(), dev);
  return true;
}

void RimLights::send(uint32_t mask, double clock) {
  if (fd < 0) return;
  mask &= 0x3ffu;
  // only when it changes, and again every half second in case one was lost; never faster than 50 a second
  if (mask == last && clock - lastAt < 0.5) return;
  if (clock - lastAt < 0.02 && clock >= lastAt) return;
  unsigned char b[11] = {0x7E, 6, 65, (unsigned char)dev, 253, 222,
                         (unsigned char)(mask >> 24), (unsigned char)(mask >> 16), (unsigned char)(mask >> 8), (unsigned char)mask, 0};
  unsigned sum = 13;
  for (int i = 0; i < 10; i++) sum += b[i];
  b[10] = (unsigned char)(sum % 256);
  if (::write(fd, b, sizeof b) == (ssize_t)sizeof b) { last = mask; lastAt = clock; }
  // the base chatters a log down this line: throw it away so nothing backs up
  unsigned char junk[512];
  while (::read(fd, junk, sizeof junk) > 0) {}
}

void RimLights::off() {
  if (fd < 0) return;
  last = 0xffffffffu;
  send(0, lastAt + 1);
}

void RimLights::update(const RimIn &in) {
  if (fd < 0) return;
  const double t = in.clock;
  const auto phase = [&](double hz) { return std::fmod(t * hz, 1.0); };
  uint32_t m = 0;
  if (in.grid) {
    // five lights, one every 0.64 s, closing from the two ends of the row
    const int n = std::clamp(5 - (int)std::floor(in.lightsIn / 0.64), 0, 5);
    for (int q = 0; q < n; q++) m |= (1u << q) | (1u << (9 - q));
  } else if (in.pit) {
    m = phase(2.5) < 0.5 ? 0x01fu : 0x3e0u;
  } else if (in.neutral) {
    m = phase(1.0) < 0.5 ? 0x3ffu : 0;
  } else if (in.blue) {
    const int k = 9 - (int)(phase(1.6) * 10);          // right to left: it is coming past
    m = (1u << std::clamp(k, 0, 9)) | (1u << std::clamp(k - 1, 0, 9));
  } else {
    if (in.shift) m = phase(6.25) < 0.5 ? 0x3ffu : 0;
    else { const int lit = std::clamp((int)std::lround(in.revs * 10), 0, 10); m = (1u << lit) - 1; }
    // a car alongside: the two outside lights on that side flicker, whatever the revs are doing
    if (in.alongside != 0) {
      const uint32_t side = in.alongside > 0 ? 0x003u : 0x300u;
      m = phase(8) < 0.5 ? (m | side) : (m & ~side);
    }
  }
  send(m, t);
}

}  // namespace xbr
