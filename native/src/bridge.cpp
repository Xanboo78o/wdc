// bridge.cpp — see bridge.hpp. The force itself is js/ffb.js update(), ported:
// self-aligning torque from the front axle's real lateral force, fading as the
// tyre saturates (the wheel goes light before the car lets go), a centring
// spring, and the road, kerbs and gravel as texture on top.
#include "bridge.hpp"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "driver.hpp"

namespace xbr {

static const double MECH = 0.3, SCALE = 0.45, CENTRE = 0.22, PARK = 0.5, ROAD = 0.09, KERB = 0.28, OFFR = 0.38;

static double hash1(double i) { const double h = std::sin(i * 127.1) * 43758.5453; return (h - std::floor(h)) * 2 - 1; }
static double vnoise(double x) {
  const double i = std::floor(x), t = x - i, u = t * t * (3 - 2 * t);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

Bridge::~Bridge() { release(); drop(); }

void Bridge::drop() {
  if (fd >= 0) ::close(fd);
  fd = -1; state = 0; inbuf.clear(); buttons.clear(); zeroed = true;
}

void Bridge::connect() {
  fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return;
  ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
  int one = 1;
  ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  sockaddr_in a{};
  a.sin_family = AF_INET; a.sin_port = htons(8179);
  ::inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
  if (::connect(fd, (sockaddr *)&a, sizeof a) < 0 && errno != EINPROGRESS) { drop(); return; }
  state = 1; reqSent = false;         // the request goes out from pump(), once the socket is writable
}

void Bridge::pump() {
  if (fd < 0) return;
  if (state == 1 && !reqSent) {
    static const char *REQ = "GET / HTTP/1.1\r\nHost: 127.0.0.1:8179\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                             "Sec-WebSocket-Key: eGJyLW5hdGl2ZS1lZGl0aW9uIQ==\r\nSec-WebSocket-Version: 13\r\n\r\n";
    const ssize_t n = ::send(fd, REQ, std::strlen(REQ), MSG_NOSIGNAL);
    if (n > 0) reqSent = true;
    else if (errno != EAGAIN && errno != ENOTCONN && errno != EINPROGRESS) { drop(); return; }
    else return;
  }
  char buf[2048];
  for (;;) {
    const ssize_t n = ::recv(fd, buf, sizeof buf, 0);
    if (n > 0) { inbuf.append(buf, (size_t)n); continue; }
    if (n == 0) { drop(); return; }
    if (errno == EAGAIN || errno == EWOULDBLOCK) break;
    drop(); return;
  }
  if (state == 1) {
    const size_t e = inbuf.find("\r\n\r\n");
    if (e == std::string::npos) return;
    if (inbuf.compare(0, 12, "HTTP/1.1 101") != 0) { drop(); return; }
    inbuf.erase(0, e + 4);
    state = 2;
  }
  // frames from the bridge: short unmasked text, {"b":n,"v":0|1} or {"wheel":x}
  while (inbuf.size() >= 2) {
    const unsigned char b0 = (unsigned char)inbuf[0], b1 = (unsigned char)inbuf[1];
    size_t len = b1 & 0x7f, off = 2;
    if (len == 126) { if (inbuf.size() < 4) return; len = ((unsigned char)inbuf[2] << 8) | (unsigned char)inbuf[3]; off = 4; }
    else if (len == 127) { drop(); return; }
    if (b1 & 0x80) off += 4;
    if (inbuf.size() < off + len) return;
    const std::string body = inbuf.substr(off, len);
    inbuf.erase(0, off + len);
    if ((b0 & 0x0f) == 0x8) { drop(); return; }
    if ((b0 & 0x0f) != 0x1) continue;
    int b = -1, v = 0;
    if (std::sscanf(body.c_str(), "{\"b\": %d, \"v\": %d", &b, &v) == 2 || std::sscanf(body.c_str(), "{\"b\":%d,\"v\":%d", &b, &v) == 2) {
      if (v) buttons.insert(b); else buttons.erase(b);
    }
  }
}

void Bridge::sendText(const std::string &s) {
  if (state != 2 || s.size() > 125) return;
  unsigned char f[6 + 125];
  const unsigned char mask[4] = {0x58, 0x42, 0x52, 0x21};
  f[0] = 0x81; f[1] = (unsigned char)(0x80 | s.size());
  std::memcpy(f + 2, mask, 4);
  for (size_t i = 0; i < s.size(); i++) f[6 + i] = (unsigned char)s[i] ^ mask[i % 4];
  if (::send(fd, f, 6 + s.size(), MSG_NOSIGNAL) < 0 && errno != EAGAIN) drop();
}

void Bridge::release() {
  if (state == 2 && !zeroed) sendText("{\"f\":0,\"r\":0,\"d\":0}");
  zeroed = true;
}

void Bridge::update(const Car &car, double rough, double dt, bool force, double gain) {
  if (fd < 0) {
    retryIn -= dt;
    if (retryIn <= 0) { retryIn = 3; connect(); }
    return;
  }
  pump();
  if (state != 2) return;
  if (!force || gain <= 0) { release(); return; }
  sinceSend += dt;
  if (sinceSend < 1.0 / 90) return;               // the browser sends once a frame; so do we, roughly
  const double step = sinceSend;
  sinceSend = 0;

  const Spec &spec = *car.spec;
  const double pk = spec.pk > 0 ? spec.pk : peakSlip(spec);
  const double tp = std::max(0.0, 1 - std::fabs(car.slipF) / (1.25 * pk));
  const double sat = -car.Fyf * (tp + MECH) / (1 + MECH) / (spec.m * 9.81);
  const double dn = car.delta / std::max(0.02, steerLock(car.speed));
  const double centre = -CENTRE * std::tanh(dn * 6) * std::min(1.0, car.speed / 10);
  const double low = 1 + 1.5 * std::max(0.0, 1 - car.speed / 30);
  double f = std::tanh(sat * low / SCALE + centre);
  if (car.airborne) f = 0;
  const double slow = std::min(1.0, car.speed / 5);
  f = f * slow - PARK * (1 - slow) * std::tanh(dn * 4) * (car.airborne ? 0 : 1);
  jolt = std::max(0.0, jolt - step * 4);
  const double v = car.speed;
  dist += v * step;
  if (!car.airborne) {
    const double x = dist, sp = std::min(1.0, v / 30);
    double tex = ROAD * sp * (0.6 * vnoise(x / 1.5) + 0.4 * vnoise(x / 0.35));
    if (rough >= 0.4) tex += OFFR * std::min(1.0, v / 8) * vnoise(x / 0.25);
    else if (rough > 0) tex += KERB * std::min(1.0, v / 8) * sign(std::sin(x * PI / 2.0));
    if (jolt > 0) { kick = -kick; tex += kick * jolt * 0.5; }
    f = clampd(f + tex, -1, 1);
  }
  const double r = std::min(1.0, rough * 0.8 + jolt * 0.8);
  const double d = 0.1 + 0.2 * std::max(0.0, 1 - car.speed / 15);
  f *= clampd(gain, 0, 1);
  char msg[120];
  std::snprintf(msg, sizeof msg, "{\"f\":%.3f,\"r\":%.2f,\"d\":%.2f,\"v\":%.1f,\"a\":%d}", f, r * clampd(gain, 0, 1), d, v, car.airborne ? 1 : 0);
  sendText(msg);
  zeroed = false;
}

}  // namespace xbr
