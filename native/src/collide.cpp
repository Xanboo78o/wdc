// collide.cpp — js/collide.js resolveBarrier, ported with its dents and shed
// wings. Deterministic: same approach, same crash.
#include "collide.hpp"

#include <algorithm>
#include <cmath>

namespace xbr {

static const double WALL_MU = 0.55;
static const size_t MAX_DENTS = 14;

static double bounceFor(const std::string &wall) {
  if (wall == "wall") return 0.34;
  if (wall == "gravel") return 0.20;
  return 0.24;
}
static double launchFor(const std::string &wall) {
  if (wall == "wall") return 0.035;
  if (wall == "gravel") return 0.070;
  return 0.100;
}

static void addDent(Car &car, double lx, double ly, double nlx, double nly, double depth, double radius) {
  for (auto &d : car.dents) {
    if (std::hypot(d.lx - lx, d.ly - ly) < 0.45) {
      d.depth = std::min(0.85, d.depth + depth * 0.65);
      d.r = std::max(d.r, radius);
      d.nx = d.nx * 0.6 + nlx * 0.4; d.ny = d.ny * 0.6 + nly * 0.4;
      return;
    }
  }
  if (car.dents.size() >= MAX_DENTS) {
    size_t k = 0;
    for (size_t i = 1; i < car.dents.size(); i++) if (car.dents[i].depth < car.dents[k].depth) k = i;
    car.dents.erase(car.dents.begin() + (long)k);
  }
  car.dents.push_back({lx, ly, nlx, nly, std::min(0.85, depth), radius});
}

static void shed(Car &car) {
  if (!car.hasCrush) return;
  car.hasLost = true;
  if (!car.lostFrontWing && car.crushFront > 0.72) car.lostFrontWing = true;
  if (!car.lostRearWing && car.crushRear > 0.72) car.lostRearWing = true;
}

static void mark(Car &car, double wlx, double wly, double wnx, double wny, double harm) {
  const double cs = std::cos(car.hdg), sn = std::sin(car.hdg);
  addDent(car, wlx, wly, wnx * cs + wny * sn, -wnx * sn + wny * cs, harm * 0.9, 0.55 + harm * 1.1);
  shed(car);
}

static const char *region(double lx, double ly, const Spec &S) {
  if (lx > S.bodyL * 0.25) return "front";
  if (lx < -S.bodyL * 0.25) return "rear";
  return ly > 0 ? "left" : "right";
}

Hit resolveBarrier(Car &car, const Track &track, int hint) {
  const Spec &S = *car.spec;
  const double hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
  const double cs0 = std::cos(car.hdg), sn0 = std::sin(car.hdg);
  const double local[4][2] = {{hl, hw}, {hl, -hw}, {-hl, -hw}, {-hl, hw}};

  bool any = false;
  double wDepth = 0, wSgn = 1, wHdg = 0, wLx = 0, wLy = 0;
  for (const auto &c : local) {
    const double cx = car.x + c[0] * cs0 - c[1] * sn0, cy = car.y + c[0] * sn0 + c[1] * cs0;
    const Proj p = hint < 0 ? track.project(cx, cy) : track.project(cx, cy, hint, 8);
    const double depth = std::fabs(p.lat) - (p.w + p.run);
    if (depth > 0 && (!any || depth > wDepth)) {
      any = true;
      wDepth = depth; wSgn = sign(p.lat) != 0 ? sign(p.lat) : 1; wHdg = p.hdg; wLx = c[0]; wLy = c[1];
    }
  }
  Hit hit;
  if (!any) { car.wallTouch = false; return hit; }

  // Contact normal points back INTO the track.
  const double nx = wSgn * std::sin(wHdg);
  const double ny = -wSgn * std::cos(wHdg);

  // 1. Positional correction.
  car.x += nx * wDepth;
  car.y += ny * wDepth;

  // 2. Contact impulse, with the lever arm from the centre of mass.
  const double cs = std::cos(car.hdg), sn = std::sin(car.hdg);
  const double rx = wLx * cs - wLy * sn;
  const double ry = wLx * sn + wLy * cs;

  double vwx = car.vx * cs - car.vy * sn;
  double vwy = car.vx * sn + car.vy * cs;
  double w = car.r;

  const double vpx = vwx - w * ry, vpy = vwy + w * rx;
  const double vn = vpx * nx + vpy * ny;

  hit.hit = true;
  hit.depth = wDepth; hit.closing = -vn; hit.part = region(wLx, wLy, S);

  if (vn < 0) {
    const double e = bounceFor(track.wall);
    const double rn = rx * ny - ry * nx;
    const double inv = 1 / S.m + (rn * rn) / S.Izz;
    const double j = -(1 + e) * vn / inv;

    vwx += (j / S.m) * nx;
    vwy += (j / S.m) * ny;
    w += (rx * (j * ny) - ry * (j * nx)) / S.Izz;

    // Coulomb friction along the barrier face.
    const double tx = -ny, ty = nx;
    const double vt = (vwx - w * ry) * tx + (vwy + w * rx) * ty;
    const double rt = rx * ty - ry * tx;
    const double invT = 1 / S.m + (rt * rt) / S.Izz;
    double jt = -vt / invT;
    const double cap = WALL_MU * std::fabs(j);
    jt = clampd(jt, -cap, cap);
    vwx += (jt / S.m) * tx;
    vwy += (jt / S.m) * ty;
    w += (rx * (jt * ty) - ry * (jt * tx)) / S.Izz;

    hit.j = j;

    // 3. Damage, from the specific impulse.
    const double dv = std::fabs(j) / S.m;
    if (dv > 0.8) {
      const double harm = std::min(0.8, std::pow((dv - 0.8) / 12, 1.3));
      car.damage = std::min(1.0, car.damage + harm);
      car.hasCrush = true;
      double *part = car.crushPart(hit.part);
      *part = std::min(1.0, *part + harm * 2.2);
      hit.harm = harm;
      mark(car, wLx, wLy, nx, ny, harm);
      tyreHit(car, wLx, wLy, -nx * sn + ny * cs, dv);
    }

    // THE VERTICAL KICK, through the wheel that climbed the barrier's base.
    if (dv > 6.5) {
      double W[4][2];
      wheelPos(S, W);
      int wi = 0;
      double bd = std::numeric_limits<double>::infinity();
      for (int i = 0; i < 4; i++) {
        const double d = std::hypot(W[i][0] - wLx, W[i][1] - wLy);
        if (d < bd) { bd = d; wi = i; }
      }
      const double ramp = std::min(1.0, (dv - 6.5) / 8);
      launch(car, std::fabs(j) * launchFor(track.wall) * ramp, W[wi][0], W[wi][1]);
      hit.launched = true;
    }
  }

  car.vx = vwx * cs + vwy * sn;
  car.vy = -vwx * sn + vwy * cs;
  car.r = w;
  car.wallTouch = true;
  return hit;
}

}  // namespace xbr
