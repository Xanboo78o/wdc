// knock.cpp — see knock.hpp.
#include "knock.hpp"

#include <algorithm>
#include <cmath>

namespace xbr {

Knock &knock() { static Knock k; return k; }

int Knock::add(int kind, double x, double y, double z) {
  KnockObj o;
  o.kind = kind; o.x = o.x0 = x; o.y = o.y0 = y; o.z = o.z0 = z;
  if (kind == KnockObj::FOAM) { o.radius = 1.0; o.mass = 7; } else { o.radius = 0.8; o.mass = 14; }
  objs.push_back(o);
  return (int)objs.size() - 1;
}

// a cheap repeatable scatter: the same crash does not throw every block the same way
static double scatter(unsigned &seed) { seed = seed * 1664525u + 1013904223u; return ((seed >> 8) & 0xffff) / 65535.0; }

void Knock::step(double dt, const std::vector<Car *> &cars) {
  static unsigned seed = 78;
  const double G = 9.81, HALF_PI = 1.5707963267948966;
  for (KnockObj &o : objs) {
    if (o.quiet > 0) o.quiet -= dt;
    // ---- is a car driving through it?
    const bool hittable = o.quiet <= 0 && !(o.kind == KnockObj::BOARD && o.state == KnockObj::LYING && o.tipRate == 0 && false);
    if (hittable) for (Car *cp : cars) {
      Car &car = *cp;
      const Spec &S = *car.spec;
      const double dx = o.x - car.x, dy = o.y - car.y;
      if (std::fabs(dx) > 8 || std::fabs(dy) > 8) continue;
      const double cs = std::cos(car.hdg), sn = std::sin(car.hdg);
      const double lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      const double reach = o.state == KnockObj::LYING ? 0.25 : o.radius * 0.7;
      if (std::fabs(lx) > S.bodyL * 0.5 + reach || std::fabs(ly) > S.bodyW * 0.5 + reach) continue;
      if (car.z > 1.4 && o.state != KnockObj::FLYING) continue;            // the car is flying over it
      const double wvx = car.vx * cs - car.vy * sn, wvy = car.vx * sn + car.vy * cs;
      const double v = std::hypot(wvx, wvy);
      if (v < 0.8) continue;                                               // leaning on it
      const double ux = wvx / v, uy = wvy / v;
      // a board lying flat is driven over, not hit, unless you are really moving
      if (o.kind == KnockObj::BOARD && o.state == KnockObj::LYING && v < 22) continue;
      if (o.state == KnockObj::STANDING) moved++;
      const double side = ly >= 0 ? 1 : -1;                                // which side of the car's middle it was on
      const double px = -uy * side, py = ux * side;                        // thrown off to that side
      if (o.kind == KnockObj::BOARD && o.state == KnockObj::STANDING && v < 9) {
        // STAMPED DOWN: pushed over the way the car is going, and left there
        o.state = KnockObj::LYING; o.fallX = ux; o.fallY = uy; o.tip = HALF_PI; o.tipRate = 0; o.yawRate = 0;
        o.vx = o.vy = o.vz = 0;
        o.quiet = 0.4;
      } else {
        const double keep = o.kind == KnockObj::FOAM ? 0.85 + 0.35 * scatter(seed) : 0.70 + 0.2 * scatter(seed);
        const double off = (0.12 + 0.30 * scatter(seed)) * v;
        o.vx = wvx * keep + px * off; o.vy = wvy * keep + py * off;
        // UP: a foam block hops; a board snapped off at speed goes over the roof
        o.vz = o.kind == KnockObj::FOAM ? 2.2 + 0.05 * v + 1.5 * scatter(seed) : 4.5 + 0.09 * v + 1.5 * scatter(seed);
        o.fallX = ux; o.fallY = uy;
        o.tipRate = (o.kind == KnockObj::FOAM ? 3.0 : 5.0) + 0.25 * v * (0.6 + 0.8 * scatter(seed));
        o.yawRate = (scatter(seed) - 0.5) * (4 + 0.2 * v);
        o.state = KnockObj::FLYING;
        o.z += 0.05;
        o.quiet = 0.35;
      }
      // what it cost the car: its weight against the car's, and no more
      const double lose = std::min(0.04, 1.6 * o.mass / S.m);
      car.vx *= 1 - lose;
      break;
    }
    if (o.state != KnockObj::FLYING) continue;
    // ---- in the air, and on the ground
    o.vz -= G * dt;
    const double drag = o.kind == KnockObj::FOAM ? 0.9 : 0.25;            // foam is nearly all air
    const double k = std::exp(-drag * dt);
    o.vx *= k; o.vy *= k;
    o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
    o.tip += o.tipRate * dt; o.yaw += o.yawRate * dt;
    const double gz = ground ? ground(o.x, o.y) : o.z0;
    if (o.z <= gz) {
      o.z = gz;
      const double e = o.kind == KnockObj::FOAM ? 0.38 : 0.22;
      if (o.vz < -1.6) {
        o.vz = -o.vz * e; o.vx *= 0.62; o.vy *= 0.62; o.tipRate *= 0.6; o.yawRate *= 0.6;
      } else {
        // it lies down: whichever flat side is nearest
        o.vz = 0;
        const double slide = std::exp(-6.0 * dt);
        o.vx *= slide; o.vy *= slide;
        const double turns = std::floor(o.tip / (2 * HALF_PI));
        o.tip = turns * 2 * HALF_PI + HALF_PI;
        o.tipRate = 0; o.yawRate *= slide;
        if (std::hypot(o.vx, o.vy) < 0.3) { o.vx = o.vy = 0; o.yawRate = 0; o.state = KnockObj::LYING; }
      }
    }
  }
}

}  // namespace xbr
