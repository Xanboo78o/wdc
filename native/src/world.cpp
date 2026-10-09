// world.cpp — js/world.js, js/bank.js and js/terrain.js, ported. The reasons
// for each blend and each sink are written at length in the JS and were paid
// for one screenshot at a time; they are not repeated here.
#include "world.hpp"

#include <algorithm>
#include <cmath>

namespace xbr {

// ---- bank ------------------------------------------------------------------------
static const double EMBANK = 0.3;

std::vector<float> bankTable(const Track &track) {
  const int n = track.n;
  std::vector<float> t((size_t)n, 0.f);
  int i = 0;
  while (i < n) {
    if (track.bank[(size_t)i] == 0) { i++; continue; }
    int j = i;
    double curvSum = 0;
    while (j < n && track.bank[(size_t)j] != 0) { curvSum += track.curv[(size_t)j]; j++; }
    const double sg = curvSum >= 0 ? 1 : -1;
    for (int k = i; k < j; k++) t[(size_t)k] = (float)(sg * std::tan(track.bank[(size_t)k] * PI / 180));
    i = j;
  }
  return t;
}

double bankY(const std::vector<float> &table, const Track &track, int i, double lat) {
  const double k = table[(size_t)i];
  if (k == 0) return 0;
  const double sg = k > 0 ? 1 : -1;
  const double w = track.w[(size_t)i];
  const double u = sg * lat;
  if (u >= w) return 0;
  const double rise = std::fabs(k);
  if (u >= -w) return (w - u) * rise;
  double runO = sg > 0 ? track.runR[(size_t)i] : track.runL[(size_t)i];
  if (runO == 0) runO = 1;
  if (track.stock) {
    const double top = (2 * w + runO) * rise;
    if (u >= -(w + runO)) return (w - u) * rise;
    const double fall = std::max(4.0, top / EMBANK), f = (u + w + runO + fall) / fall;
    return f <= 0 ? 0 : top * (f * f * (3 - 2 * f));
  }
  const double fall = std::max(runO, 2 * w * rise / EMBANK);
  const double f = (u + w + fall) / fall;
  if (f <= 0) return 0;
  return 2 * w * rise * (f * f * (3 - 2 * f));
}

double bankGround(const std::vector<float> &table, const Track &track, int i, double lat) {
  const double k = table[(size_t)i];
  if (k == 0) return 0;
  const double w = track.w[(size_t)i], sg = k > 0 ? 1 : -1, u = sg * lat;
  double runO = sg > 0 ? track.runR[(size_t)i] : track.runL[(size_t)i];
  if (runO == 0) runO = 1;
  return u <= -(w + runO) + 0.5 ? bankY(table, track, i, lat) : 0;
}

double bankRoll(const std::vector<float> &table, const Track &track, int i, double lat) {
  const double k = table[(size_t)i];
  if (k == 0) return 0;
  const double w = track.w[(size_t)i], sg = k > 0 ? 1 : -1, u = sg * lat;
  const double extra = track.stock ? (sg > 0 ? track.runR[(size_t)i] : track.runL[(size_t)i]) : 0;
  const double edge = std::min(w - u, u + w + extra);
  if (edge <= 0) return 0;
  return -sg * std::atan(std::fabs(k)) * std::min(1.0, edge);
}

// ---- world -----------------------------------------------------------------------
static const double NEAR_ = 55, RAMP = 20, FAR_ = 240, CELL = 45, SINK_MAX = 0.35;

World::World(const Track &track, const Json &elev) : t(track) {
  const int n = t.n;
  on = elev.isObj() && (int)elev["s"].size() == n && elev["grid"].isObj();
  double corridor = 0, x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
  bool anyBank = false;
  for (int i = 0; i < n; i++) {
    corridor = std::max(corridor, t.w[(size_t)i] + std::max(t.runL[(size_t)i], t.runR[(size_t)i]));
    x0 = std::min(x0, t.x[(size_t)i]); x1 = std::max(x1, t.x[(size_t)i]);
    y0 = std::min(y0, t.y[(size_t)i]); y1 = std::max(y1, t.y[(size_t)i]);
    if (t.bank[(size_t)i] != 0) anyBank = true;
  }
  sinkTo = corridor + 14;
  if (anyBank) bank = bankTable(t);

  bx0 = x0 - 400; by0 = y0 - 400;
  bnx = (int)std::ceil((x1 - x0 + 800) / CELL) + 1;
  bny = (int)std::ceil((y1 - y0 + 800) / CELL) + 1;
  buckets.assign((size_t)bnx * bny, {});
  for (int i = 0; i < n; i++) {
    const int cx = (int)std::floor((t.x[(size_t)i] - bx0) / CELL), cy = (int)std::floor((t.y[(size_t)i] - by0) / CELL);
    if (cx < 0 || cy < 0 || cx >= bnx || cy >= bny) continue;
    buckets[(size_t)cy * bnx + cx].push_back(i);
  }
  buckets4 = buckets; buckets8 = buckets;
  for (auto &b : buckets4) b.erase(std::remove_if(b.begin(), b.end(), [](int k) { return k % 4 != 0; }), b.end());
  for (auto &b : buckets8) b.erase(std::remove_if(b.begin(), b.end(), [](int k) { return k % 8 != 0; }), b.end());
  if (!on) return;

  s = elev["s"].nums();
  const Json &g = elev["grid"];
  gn = (int)g["n"].n(); gx0 = g["x0"].n(); gy0 = g["y0"].n(); gdx = g["dx"].n(1); gdy = g["dy"].n(1);
  gh = g["h"].nums();
  if (gn < 2 || (int)gh.size() < gn * gn) { on = false; return; }
  gridLo = *std::min_element(gh.begin(), gh.end()); gridHi = *std::max_element(gh.begin(), gh.end());
  hasSea = elev["sea"].isNum();
  seaY = hasSea ? elev["sea"].n() : gridLo;
  if (elev["outside"].s() == "plane" && elev["plane"].size() == 3) {
    hasPlane = true;
    for (size_t k = 0; k < 3; k++) plane[k] = elev["plane"][k].n();
  }
  for (const auto &b : elev["bridges"].arr) bridges.emplace_back(b["s0"].n(), b["s1"].n());
  const std::string ds = elev["dataset"].s();
  if (ds == "lombardia" || ds == "gsi" || ds == "ahn" || ds == "ign") {
    resid.resize((size_t)n);
    for (int k = 0; k < n; k++) resid[(size_t)k] = (float)(s[(size_t)k] - gridAt(t.x[(size_t)k], t.y[(size_t)k]));
  }
}

bool World::onBridge(int i) const {
  const double sd = i * t.ds;
  for (const auto &b : bridges) if (sd >= b.first - 15 && sd <= b.second + 15) return true;
  return false;
}

Near World::near(double x, double y) const { return nearestIn(x, y, (int)std::ceil((FAR_ + 30) / CELL) + 1); }

Near World::nearestIn(double x, double y, int maxRing) const {
  int best = -1;
  double bd = 1e300;
  const int cx = (int)std::floor((x - bx0) / CELL), cy = (int)std::floor((y - by0) / CELL);
  for (int ring = 0; ring <= maxRing; ring++) {
    for (int j = cy - ring; j <= cy + ring; j++) {
      if (j < 0 || j >= bny) continue;
      const bool edge = j == cy - ring || j == cy + ring;
      const int stepI = (edge || ring == 0) ? 1 : 2 * ring;
      for (int i = cx - ring; i <= cx + ring; i += stepI) {
        if (i < 0 || i >= bnx) continue;
        for (int k : buckets[(size_t)j * bnx + i]) {
          const double dx = t.x[(size_t)k] - x, dy = t.y[(size_t)k] - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    if (best >= 0 && std::sqrt(bd) <= ring * CELL) break;
  }
  if (best < 0 && maxRing < 12) return Near{};
  if (best < 0) {
    for (int k = 0; k < t.n; k += 8) {
      const double dx = t.x[(size_t)k] - x, dy = t.y[(size_t)k] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
  }
  return Near{best, std::sqrt(bd)};
}

bool World::otherLeg(double x, double y, int i, double reach, Near &out) const {
  const int n = t.n, gap = (int)std::ceil(80 / t.ds);
  const int cx = (int)std::floor((x - bx0) / CELL), cy = (int)std::floor((y - by0) / CELL), r = (int)std::ceil(reach / CELL);
  int best = -1;
  double bd = reach * reach;
  for (int j = cy - r; j <= cy + r; j++) {
    if (j < 0 || j >= bny) continue;
    for (int q = cx - r; q <= cx + r; q++) {
      if (q < 0 || q >= bnx) continue;
      for (int k : buckets[(size_t)j * bnx + q]) {
        const int dk = std::abs(k - i);
        if (std::min(dk, n - dk) <= gap) continue;
        const double dx = t.x[(size_t)k] - x, dy = t.y[(size_t)k] - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = k; }
      }
    }
  }
  if (best < 0) return false;
  out = Near{best, std::sqrt(bd)};
  return true;
}

Blend World::blendNear(double x, double y, double d, double R, bool both) const {
  const double reach = d + R;
  const int step = R > 30 ? 8 : R > 12 ? 4 : 1;
  const auto &B = step == 8 ? buckets8 : step == 4 ? buckets4 : buckets;
  const int cx = (int)std::floor((x - bx0) / CELL), cy = (int)std::floor((y - by0) / CELL), r = (int)std::ceil(reach / CELL);
  double sw = 0, sh = 0, sr = 0;
  const double r2 = reach * reach;
  for (int j = cy - r; j <= cy + r; j++) {
    if (j < 0 || j >= bny) continue;
    for (int q = cx - r; q <= cx + r; q++) {
      if (q < 0 || q >= bnx) continue;
      for (int k : B[(size_t)j * bnx + q]) {
        const double dx = t.x[(size_t)k] - x, dy = t.y[(size_t)k] - y, dd = dx * dx + dy * dy;
        if (dd > r2) continue;
        const double u = std::max(0.0, 1 - (std::sqrt(dd) - d) / R), w = u * u;
        sw += w; sh += w * s[(size_t)k];
        if (both) sr += w * (double)resid[(size_t)k];
      }
    }
  }
  Blend b;
  if (sw > 0) { b.h = sh / sw; b.r = sr / sw; b.ok = true; }
  return b;
}

double World::gridAt(double x, double y) const {
  const double fx = (x - gx0) / gdx, fy = (y - gy0) / gdy;
  const double out = std::max({0.0, -fx, fx - (gn - 1), -fy, fy - (gn - 1)});
  const int i0 = std::max(0, std::min(gn - 2, (int)std::floor(fx)));
  const int j0 = std::max(0, std::min(gn - 2, (int)std::floor(fy)));
  const double tx = clampd(fx - i0, 0, 1), ty = clampd(fy - j0, 0, 1);
  auto at = [&](int i, int j) { return gh[(size_t)std::max(0, std::min(gn - 1, j)) * gn + std::max(0, std::min(gn - 1, i))]; };
  auto cr = [](double p0, double p1, double p2, double p3, double u) {
    return p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
  };
  auto row = [&](int j) { return cr(at(i0 - 1, j), at(i0, j), at(i0 + 1, j), at(i0 + 2, j), tx); };
  const double v = cr(row(j0 - 1), row(j0), row(j0 + 1), row(j0 + 2), ty);
  if (out <= 0) return v;
  const double f = std::min(1.0, out / 15), ff = f * f * (3 - 2 * f);
  if (hasPlane) {
    const double p = clampd(plane[0] + plane[1] * x + plane[2] * y, gridLo - 15, gridHi + 15);
    return v + (p - v) * ff;
  }
  return v + (seaY - v) * ff;
}

double World::trackYAt(double sd) const {
  if (!on) return 0;
  const int n = t.n;
  const double f = std::fmod(std::fmod(sd / t.ds, n) + n, n);
  const int i = (int)std::floor(f) % n, j = (i + 1) % n;
  const double k = f - std::floor(f);
  return s[(size_t)i] * (1 - k) + s[(size_t)j] * k;
}

double World::heightAt(double x, double y, const Near *nr) const {
  if (!on) return 0;
  const Near nn = nr ? *nr : near(x, y);
  const int i = nn.i;
  const double d = nn.d;
  if (i < 0 || d >= FAR_) return gridAt(x, y);
  const int n = t.n;
  const double h = t.hdg[(size_t)i];
  const double frac = ((x - t.x[(size_t)i]) * std::cos(h) + (y - t.y[(size_t)i]) * std::sin(h)) / t.ds;
  const double k = clampd(frac, -1, 1);
  const int j = ((i + (k >= 0 ? 1 : -1)) % n + n) % n;
  double onTrack = s[(size_t)i] + (s[(size_t)j] - s[(size_t)i]) * std::fabs(k);
  const double corr = sinkTo - 12;
  if (d > corr) {
    const double R = std::min(70.0, d - corr);
    if (R > 0.5) {
      if (!resid.empty()) {
        const Blend b = blendNear(x, y, d, R, true);
        const double f = std::min(1.0, (d - corr) / RAMP), ff = f * f * (3 - 2 * f);
        const double g = clampd((d - NEAR_) / (FAR_ - NEAR_), 0, 1), gg = g * g * (3 - 2 * g);
        const double gz = gridAt(x, y);
        const double wet = hasSea ? clampd((gz - (seaY - 4)) / 4, 0, 1) : 1;
        const double surv = gz + b.r * (1 - gg) * wet;
        return b.h + (surv - b.h) * ff;
      }
      const Blend b = blendNear(x, y, d, R, false);
      if (b.ok) onTrack = b.h;
    }
  }
  if (d <= NEAR_) return onTrack;
  const double grid = gridAt(x, y);
  const double f = (d - NEAR_) / (FAR_ - NEAR_);
  return onTrack + (grid - onTrack) * (f * f * (3 - 2 * f));
}

double World::sinkAt(double d) const {
  if (d >= sinkTo) return 0;
  const double u = 1 - d / sinkTo;
  return SINK_MAX * u * u;
}

double World::groundY(double x, double y, const Near *nr, bool own) const {
  const Near nn = nr ? *nr : near(x, y);
  const int i = nn.i;
  double yy = (on ? heightAt(x, y, &nn) : 0) - sinkAt(nn.d);
  if (!bridges.empty() && !own && i >= 0 && onBridge(i)) {
    Near o;
    if (otherLeg(x, y, i, 40, o)) {
      const double room = t.w[(size_t)o.i] + std::max(t.runL[(size_t)o.i], t.runR[(size_t)o.i]) + 2;
      const double low = trackY(o.i) - sinkAt(o.d);
      if (o.d <= room && low < yy - 1) return low;
    }
  }
  if (!bank.empty() && i >= 0 && bank[(size_t)i] != 0) {
    const double h = t.hdg[(size_t)i];
    const double lat = -std::sin(h) * (x - t.x[(size_t)i]) + std::cos(h) * (y - t.y[(size_t)i]);
    yy += bankGround(bank, t, i, lat);
  }
  return yy;
}

// ---- terrain ---------------------------------------------------------------------
static const double AX = 1.35, AY = 0.80;

Terrain::Terrain(const Track &track, const World *world) : t(track), w(world) {
  bool any = false;
  for (double b : t.bank) if (b != 0) { any = true; break; }
  if (any) tab = bankTable(t);
}

double Terrain::h(double sd, double lat) const {
  double y = w && w->on ? w->trackYAt(sd) : 0;
  if (!tab.empty()) {
    const int n = t.n;
    const double f = std::fmod(std::fmod(sd / t.ds, n) + n, n);
    const int i = (int)std::floor(f) % n, j = (i + 1) % n;
    const double k = f - std::floor(f);
    y += bankY(tab, t, i, lat) * (1 - k) + bankY(tab, t, j, lat) * k;
  }
  return y;
}

void Terrain::under(const Car &car, const Proj &pr, Gnd &g) const {
  const double th = car.hdg - t.hdg[(size_t)pr.i], c = std::cos(th), sn = std::sin(th);
  auto H = [&](double fx, double fy) { return h(pr.s + fx * c - fy * sn, pr.lat + fx * sn + fy * c); };
  const double fl = H(AX, AY), fr = H(AX, -AY), rl = H(-AX, AY), rr = H(-AX, -AY);
  g.dPitch = -g.pitch; g.dRoll = -g.roll;
  g.gx = (fl + fr - rl - rr) / (4 * AX);
  g.gy = (fl + rl - fr - rr) / (4 * AY);
  g.pitch = std::atan(g.gx); g.roll = std::atan(g.gy);
  g.dPitch += g.pitch; g.dRoll += g.roll;
  g.bank = std::fabs(g.roll) * 180 / PI; g.dir = -sign(g.gy);
}

double Terrain::lift(const Car &car, const Proj &pr) const {
  const double v = std::hypot(car.vx, car.vy);
  if (v < 1) return 0;
  const double th = car.hdg + std::atan2(car.vy, car.vx) - t.hdg[(size_t)pr.i];
  const double d = std::max(3.0, v * 0.06), ds = std::cos(th) * d, dl = std::sin(th) * d;
  return -v * v * (h(pr.s + ds, pr.lat + dl) - 2 * h(pr.s, pr.lat) + h(pr.s - ds, pr.lat - dl)) / (d * d);
}

}  // namespace xbr
