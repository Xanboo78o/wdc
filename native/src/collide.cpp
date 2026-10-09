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

// ---- CAR TO CAR ---------------------------------------------------------------
// Separating Axis Theorem on two rectangles: four axes, and the smallest
// overlap among them is the contact normal (js/collide.js sat / resolveCars).
namespace {
struct Obb { double cx, cy, ax[2], ay[2], hx, hy; };
struct Cnr { double x, y, lx, ly; };
struct Sat { bool hit = false; double depth = 0, nx = 0, ny = 0; };

Obb obb(const Car &car) {
  const Spec &S = *car.spec;
  const double c = std::cos(car.hdg), s = std::sin(car.hdg);
  return {car.x, car.y, {c, s}, {-s, c}, S.bodyL * 0.5, S.bodyW * 0.5};
}

Sat sat(const Obb &A, const Obb &B) {
  const double dx = B.cx - A.cx, dy = B.cy - A.cy;
  double best = std::numeric_limits<double>::infinity(), nx = 0, ny = 0;
  const double *axes[4] = {A.ax, A.ay, B.ax, B.ay};
  for (const double *ax : axes) {
    const auto reach = [&](const Obb &O) {
      return std::fabs(O.ax[0] * ax[0] + O.ax[1] * ax[1]) * O.hx + std::fabs(O.ay[0] * ax[0] + O.ay[1] * ax[1]) * O.hy;
    };
    const double d = dx * ax[0] + dy * ax[1];
    const double overlap = reach(A) + reach(B) - std::fabs(d);
    if (overlap <= 0) return {};
    if (overlap < best) {
      const double sgn = d < 0 ? -1 : 1;
      best = overlap; nx = ax[0] * sgn; ny = ax[1] * sgn;
    }
  }
  return {true, best, nx, ny};
}

void cornersOf(const Car &car, Cnr out[4]) {
  const Spec &S = *car.spec;
  const double hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
  const double cs = std::cos(car.hdg), sn = std::sin(car.hdg);
  const double local[4][2] = {{hl, hw}, {hl, -hw}, {-hl, -hw}, {-hl, hw}};
  for (int k = 0; k < 4; k++) {
    const double lx = local[k][0], ly = local[k][1];
    out[k] = {car.x + lx * cs - ly * sn, car.y + lx * sn + ly * cs, lx, ly};
  }
}

// The corner of `car` furthest along (dx, dy): the bit doing the hitting.
Cnr extremeCorner(const Car &car, double dx, double dy) {
  Cnr c[4];
  cornersOf(car, c);
  int best = 0;
  double bd = -std::numeric_limits<double>::infinity();
  for (int k = 0; k < 4; k++) {
    const double d = (c[k].x - car.x) * dx + (c[k].y - car.y) * dy;
    if (d > bd) { bd = d; best = k; }
  }
  return c[best];
}
}  // namespace

CarHit resolveCars(Car &a, Car &b, double restitution) {
  const Sat hit = sat(obb(a), obb(b));
  CarHit out;
  if (!hit.hit) return out;
  const double nx = hit.nx, ny = hit.ny, depth = hit.depth;
  const Spec &SA = *a.spec, &SB = *b.spec;

  // 1. Push apart, shared in inverse proportion to mass.
  const double invA = 1 / SA.m, invB = 1 / SB.m, invSum = invA + invB;
  a.x -= nx * depth * (invA / invSum); a.y -= ny * depth * (invA / invSum);
  b.x += nx * depth * (invB / invSum); b.y += ny * depth * (invB / invSum);

  // 2. Contact point: midway between the two corners actually doing the work.
  const Cnr ca = extremeCorner(a, nx, ny), cb = extremeCorner(b, -nx, -ny);
  const double px = (ca.x + cb.x) * 0.5, py = (ca.y + cb.y) * 0.5;
  const double rax = px - a.x, ray = py - a.y;
  const double rbx = px - b.x, rby = py - b.y;

  double avx, avy, bvx, bvy;
  {
    const double cs = std::cos(a.hdg), sn = std::sin(a.hdg);
    avx = a.vx * cs - a.vy * sn; avy = a.vx * sn + a.vy * cs;
  }
  {
    const double cs = std::cos(b.hdg), sn = std::sin(b.hdg);
    bvx = b.vx * cs - b.vy * sn; bvy = b.vx * sn + b.vy * cs;
  }
  double wa = a.r, wb = b.r;

  const double vax = avx - wa * ray, vay = avy + wa * rax;
  const double vbx = bvx - wb * rby, vby = bvy + wb * rbx;
  const double rvn = (vbx - vax) * nx + (vby - vay) * ny;

  out.hit = true; out.depth = depth; out.closing = -rvn; out.nx = nx; out.ny = ny;
  if (rvn < 0) {
    const double ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
    const double inv = invA + invB + (ran * ran) / SA.Izz + (rbn * rbn) / SB.Izz;
    const double j = -(1 + restitution) * rvn / inv;

    avx -= j * nx * invA; avy -= j * ny * invA;
    bvx += j * nx * invB; bvy += j * ny * invB;
    wa -= (rax * (j * ny) - ray * (j * nx)) / SA.Izz;
    wb += (rbx * (j * ny) - rby * (j * nx)) / SB.Izz;

    // rubbing along each other
    const double tx = -ny, ty = nx;
    const double rvt = (bvx - wb * rby - (avx - wa * ray)) * tx + (bvy + wb * rbx - (avy + wa * rax)) * ty;
    const double rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
    const double invT = invA + invB + (rat * rat) / SA.Izz + (rbt * rbt) / SB.Izz;
    double jt = -rvt / invT;
    const double cap = 0.42 * std::fabs(j);
    jt = std::max(-cap, std::min(cap, jt));
    avx -= jt * tx * invA; avy -= jt * ty * invA;
    bvx += jt * tx * invB; bvy += jt * ty * invB;
    wa -= (rax * (jt * ty) - ray * (jt * tx)) / SA.Izz;
    wb += (rbx * (jt * ty) - rby * (jt * tx)) / SB.Izz;

    out.j = j;
    // Damage on both, from the velocity each one actually lost. Blame is the
    // race layer's: collide does not know the running order.
    for (int k = 0; k < 2; k++) {
      Car &car = k == 0 ? a : b;
      const double invM = k == 0 ? invA : invB;
      const Cnr &c2 = k == 0 ? ca : cb;
      const double dv = std::fabs(j) * invM;
      if (dv > 2.5) {
        const double harm = std::min(0.6, std::pow((dv - 2.5) / 22, 1.6));
        car.damage = std::min(1.0, car.damage + harm);
        car.hasCrush = true;
        double *part = car.crushPart(region(c2.lx, c2.ly, *car.spec));
        *part = std::min(1.0, *part + harm * 1.6);
        const double sg = k == 0 ? -1 : 1;
        mark(car, c2.lx, c2.ly, nx * sg, ny * sg, harm);
      }
      // Wheel-to-wheel and wing-into-tyre: the tyre nearest the contact.
      if (dv > 1.2) {
        const double h = car.hdg;
        tyreHit(car, c2.lx, c2.ly, -nx * std::sin(h) + ny * std::cos(h), dv);
      }
    }
    out.harm = std::fabs(j) / std::min(SA.m, SB.m);

    // RIDING UP A REAR WHEEL: purely geometric, and only an open wheel is a ramp.
    const double dx = a.x - b.x, dy = a.y - b.y;
    const double offset = std::fabs(-dx * std::sin(b.hdg) + dy * std::cos(b.hdg));
    const bool nose = ca.lx > SA.bodyL * 0.30;
    const bool onWheel = cb.lx < -SB.bodyL * 0.30 && offset > SB.bodyW * 0.30;
    const bool closed = SA.gt || SB.gt;
    if (nose && onWheel && -rvn > 9.0 && !closed) {
      launch(a, std::fabs(j) * 0.50 * std::min(1.0, (-rvn - 9.0) / 7), SA.a, ca.ly * 0.5);
      out.launched = true;
    }
  }

  {
    const double cs = std::cos(a.hdg), sn = std::sin(a.hdg);
    a.vx = avx * cs + avy * sn; a.vy = -avx * sn + avy * cs; a.r = wa;
  }
  {
    const double cs = std::cos(b.hdg), sn = std::sin(b.hdg);
    b.vx = bvx * cs + bvy * sn; b.vy = -bvx * sn + bvy * cs; b.r = wb;
  }
  return out;
}

BarrierWear &barrierWear() { static BarrierWear w; return w; }

Hit resolveBarrier(Car &car, const Track &track, int hint) {
  BarrierWear &wear = barrierWear();
  const bool gives = wear.on && (int)wear.bend[0].size() == track.n;
  int wI = 0;
  const Spec &S = *car.spec;
  const double hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
  const double cs0 = std::cos(car.hdg), sn0 = std::sin(car.hdg);
  const double local[4][2] = {{hl, hw}, {hl, -hw}, {-hl, -hw}, {-hl, hw}};

  bool any = false;
  double wDepth = 0, wSgn = 1, wHdg = 0, wLx = 0, wLy = 0;
  for (const auto &c : local) {
    const double cx = car.x + c[0] * cs0 - c[1] * sn0, cy = car.y + c[0] * sn0 + c[1] * cs0;
    const Proj p = hint < 0 ? track.project(cx, cy) : track.project(cx, cy, hint, 8);
    double depth = std::fabs(p.lat) - (p.w + p.run);
    if (gives) depth -= wear.bend[p.lat > 0 ? 0 : 1][(size_t)p.i];        // the wall is where the rail has been pushed to
    if (depth > 0 && (!any || depth > wDepth)) {
      any = true; wI = p.i;
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
    double e = bounceFor(track.wall);
    if (gives) {
      // THE BARRIER GIVES (Adam: "make them bend or break on collisions strong
      // enough, and bends do not give bounce bc the impact is absorbed in the
      // bend"). Hit hard enough and the rail is pushed back: the car keeps a
      // third of its speed INTO the barrier and rides it back to where the
      // steel stops, and there it is simply stopped. Nothing is thrown back.
      // A rail already bent has no spring left in it either.
      const bool concrete = track.wall == "wall";
      const double THR = concrete ? 8.0 : 4.5, CAP = concrete ? 0.45 : 0.90, PER = concrete ? 0.020 : 0.040, TEAR = concrete ? 1e9 : 19.0;
      const int side = wSgn > 0 ? 0 : 1, n = track.n;
      auto at = [&](int k) -> float & { return wear.bend[side][(size_t)(((wI + k) % n + n) % n)]; };
      const double closing = -vn, had = at(0);
      if (had > 0.02) e = concrete ? 0.08 : 0.0;
      if (closing > THR && had < CAP - 1e-3) {
        const double add = std::min(CAP - had, (closing - THR) * PER + 0.05);
        // a dent is a few metres wide: full where it was hit, less to either side
        const double share[5] = {0.25, 0.65, 1.0, 0.65, 0.25};
        for (int k = -2; k <= 2; k++) at(k) = (float)std::min(CAP, std::max((double)at(k), had * share[k + 2] + add * share[k + 2]));
        if (closing > TEAR) for (int k = -1; k <= 1; k++) wear.broke[side][(size_t)(((wI + k) % n + n) % n)] = 1;
        wear.version++;
        e = -0.35;                                             // 35% of the closing speed carries on into the bend
      }
    }
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
