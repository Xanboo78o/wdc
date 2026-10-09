// track.cpp — js/track.js and js/line.js, ported. See track.hpp for why some
// arrays are float and some double.
#include "track.hpp"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <unordered_map>

namespace xbr {

static int32_t toInt32(double d) { return (int32_t)(uint32_t)(int64_t)d; }

Track Track::fromJson(const Json &d) {
  Track t;
  t.key = d["key"].s(); t.name = d["name"].s(); t.full = d["full"].s(t.name);
  t.wall = d["wall"].s("barrier");
  t.length = d["length"].n(); t.ds = d["ds"].n(2);
  t.open = d["open"].truthy(); t.stock = d["stock"].truthy();
  t.x = d["x"].nums(); t.y = d["y"].nums();
  const int n = t.n = (int)t.x.size();
  auto arr = [&](const char *k, double dflt) {
    std::vector<double> v = d[k].nums();
    if ((int)v.size() != n) v.assign(n, dflt);
    return v;
  };
  t.w = arr("w", 6); t.bank = arr("bank", 0); t.runL = arr("runL", 10); t.runR = arr("runR", 10);
  if (d["line"].isArr() && (int)d["line"].size() == n) t.line = d["line"].nums();
  for (const auto &c : d["corners"].arr) {
    Corner k;
    k.n = (int)c["n"].n(); k.s0 = c["s0"].n(); k.s1 = c["s1"].n(); k.s = c["s"].n();
    k.R = c["R"].n(); k.dir = c["dir"].n(); k.name = c["name"].s();
    t.corners.push_back(k);
  }
  for (const auto &z : d["drs"].arr) t.drs.push_back({z["from"].n(), z["to"].n(), z["detect"].n()});
  for (const auto &p : d["pit"]["pts"].arr) t.pitPts.emplace_back(p[(size_t)0].n(), p[(size_t)1].n());

  t.hdg = F32(n); t.curv = F32(n);
  for (int i = 0; i < n; i++) {
    const int a = (i - 1 + n) % n, b = (i + 1) % n;
    t.hdg.set(i, std::atan2(t.y[b] - t.y[a], t.x[b] - t.x[a]));
  }
  for (int i = 0; i < n; i++) {
    const int a = (i - 1 + n) % n, b = (i + 1) % n;
    double d2 = t.hdg[b] - t.hdg[a];
    while (d2 > PI) d2 -= 2 * PI;
    while (d2 < -PI) d2 += 2 * PI;
    t.curv.set(i, d2 / (2 * t.ds));
  }
  if (t.open) {
    t.hdg.set(0, std::atan2(t.y[1] - t.y[0], t.x[1] - t.x[0]));
    t.hdg.set(n - 1, std::atan2(t.y[n - 1] - t.y[n - 2], t.x[n - 1] - t.x[n - 2]));
    t.curv.d[0] = t.curv.d[1];
    t.curv.d[n - 1] = t.curv.d[n - 2];
  }

  // ---- the race layer's share of the file (js/race.js reads these) -------------
  if (d["road"].isArr() && (int)d["road"].size() == n) {
    t.road.resize(n);
    for (int i = 0; i < n; i++) t.road[i] = (unsigned char)d["road"][(size_t)i].n();
  }
  for (const auto &f : d["detours"].arr) {
    Detour k;
    k.name = f["name"].s(); k.s0 = f["s0"].n(); k.s1 = f["s1"].n(); k.w = f["w"].n(); k.road = (int)f["road"].n();
    for (const auto &p : f["pts"].arr) k.pts.emplace_back(p[(size_t)0].n(), p[(size_t)1].n());
    if (k.pts.size() >= 2) t.detours.push_back(k);
  }
  // WHICH SIDE THE PIT LANE IS ON — measured, never read from the file: the
  // median lateral offset over the middle 40% of the lane's length.
  if (d["pit"].isObj() && t.pitPts.size() >= 2) {
    Pit &P = t.pit;
    P.has = true; P.pts = t.pitPts;
    P.entryS = d["pit"]["entryS"].n(0); P.exitS = d["pit"]["exitS"].n(0);
    const auto &pp = P.pts;
    for (size_t i = 1; i < pp.size(); i++) t.pitLen += std::hypot(pp[i].first - pp[i - 1].first, pp[i].second - pp[i - 1].second);
    const auto nearest = [&](double px, double py) {
      int b = 0;
      double bd = std::numeric_limits<double>::infinity();
      for (int i = 0; i < n; i++) {
        const double d2 = (t.x[i] - px) * (t.x[i] - px) + (t.y[i] - py) * (t.y[i] - py);
        if (d2 < bd) { bd = d2; b = i; }
      }
      return b;
    };
    const auto &mid = pp[pp.size() / 2];
    const int best = nearest(mid.first, mid.second);
    const double hm = t.hdg[best];
    double lat = -std::sin(hm) * (mid.first - t.x[best]) + std::cos(hm) * (mid.second - t.y[best]);
    {
      std::vector<double> cum{0};
      for (size_t i = 1; i < pp.size(); i++) cum.push_back(cum[i - 1] + std::hypot(pp[i].first - pp[i - 1].first, pp[i].second - pp[i - 1].second));
      std::vector<double> lats;
      for (double f = 0.30; f <= 0.701; f += 0.05) {
        const double dd = f * cum.back();
        size_t k = 1;
        while (k < pp.size() - 1 && cum[k] < dd) k++;
        const double u = (dd - cum[k - 1]) / std::max(1e-6, cum[k] - cum[k - 1]);
        const double px = pp[k - 1].first + (pp[k].first - pp[k - 1].first) * u, py = pp[k - 1].second + (pp[k].second - pp[k - 1].second) * u;
        const int b = nearest(px, py);
        lats.push_back(-std::sin(t.hdg[b]) * (px - t.x[b]) + std::cos(t.hdg[b]) * (py - t.y[b]));
      }
      std::stable_sort(lats.begin(), lats.end());
      if (!lats.empty()) lat = lats[lats.size() >> 1];
    }
    P.side = sign(lat) != 0 ? sign(lat) : 1;
    P.offset = lat;
  }

  // BANKING NEEDS A TRANSITION — no more than BANK_RATE degrees per metre.
  bool anyBank = false;
  for (double v : t.bank) if (v != 0) { anyBank = true; break; }
  if (anyBank) {
    const double BANK_RATE = 0.2, r = BANK_RATE * t.ds;
    std::vector<float> a(n);
    for (int i = 0; i < n; i++) a[i] = (float)std::fabs(t.bank[i]);
    auto sweep = [&](auto f) {
      for (int pass = 0; pass < 2; pass++) {
        for (int i = 0; i < n; i++) f(i, (i - 1 + n) % n);
        for (int i = n - 1; i >= 0; i--) f(i, (i + 1) % n);
      }
    };
    sweep([&](int i, int j) { if ((double)a[j] - 2 * r > (double)a[i]) a[i] = (float)((double)a[j] - 2 * r); });
    sweep([&](int i, int j) { if ((double)a[j] + r < (double)a[i]) a[i] = (float)((double)a[j] + r); });
    std::vector<float> v = a, w(n);
    for (int pass = 0; pass < 300; pass++) {
      for (int i = 0; i < n; i++)
        w[i] = (float)(((double)v[(i - 1 + n) % n] + 2 * (double)v[i] + (double)v[(i + 1) % n]) / 4);
      v.swap(w);
    }
    for (int i = 0; i < n; i++) t.bank[i] = (double)v[i] < 0.05 ? 0.0 : (double)v[i];
  }
  t.shareWalls();
  return t;
}

Track Track::load(const std::string &dataDir, const std::string &key) {
  return fromJson(Json::load(dataDir + "/tracks/" + key + ".json"));
}

// ONE WALL BETWEEN TWO STRETCHES OF ROAD.
void Track::shareWalls() {
  if (n < 40) return;
  const int far = (int)jsRound(120 / ds);
  const double CELL = 40;
  std::unordered_map<int32_t, std::vector<int>> grid;
  for (int j = 0; j < n; j += 2) {
    const int32_t k = toInt32(std::floor(x[j] / CELL) * 73856093.0) ^ toInt32(std::floor(y[j] / CELL) * 19349663.0);
    grid[k].push_back(j);
  }
  std::vector<float> capL(n), capR(n);
  for (int i = 0; i < n; i++) { capL[i] = (float)runL[i]; capR[i] = (float)runR[i]; }
  int moved = 0;
  for (int i = 0; i < n; i++) for (int side : {1, -1}) {
    const double run = side > 0 ? runL[i] : runR[i], L = w[i] + run;
    const double h = hdg[i], bx = x[i] - std::sin(h) * side * L, by = y[i] + std::cos(h) * side * L;
    int bj = -1;
    double bd = std::numeric_limits<double>::infinity();
    const double cx = std::floor(bx / CELL), cy = std::floor(by / CELL);
    for (double gx = cx - 1; gx <= cx + 1; gx++) for (double gy = cy - 1; gy <= cy + 1; gy++) {
      auto it = grid.find(toInt32(gx * 73856093.0) ^ toInt32(gy * 19349663.0));
      if (it == grid.end()) continue;
      for (int j : it->second) {
        const int along = std::abs(j - i);
        if (std::min(along, open ? along : n - along) < far) continue;
        const double d2 = (bx - x[j]) * (bx - x[j]) + (by - y[j]) * (by - y[j]);
        if (d2 < bd) { bd = d2; bj = j; }
      }
    }
    if (bj < 0) continue;
    const double hj = hdg[bj];
    const double lj = -std::sin(hj) * (bx - x[bj]) + std::cos(hj) * (by - y[bj]);
    const double limJ = w[bj] + (lj > 0 ? runL[bj] : runR[bj]);
    if (std::fabs(lj) >= limJ - 0.5) continue;
    const double D = std::hypot(x[bj] - x[i], y[bj] - y[i]);
    if (D < w[i] + w[bj] + 1) continue;
    const double shared = std::max(1.0, (D - w[i] - w[bj]) / 2 - 0.4);
    std::vector<float> &cap = side > 0 ? capL : capR;
    if (shared < (double)cap[i]) { cap[i] = (float)shared; moved++; }
  }
  if (!moved) return;
  const int E = (int)jsRound(16 / ds), B = (int)jsRound(8 / ds);
  for (int side : {1, -1}) {
    const std::vector<float> &c = side > 0 ? capL : capR;
    std::vector<double> &out = side > 0 ? runL : runR;
    std::vector<float> er(n);
    auto at = [&](int k) { return open ? std::max(0, std::min(n - 1, k)) : ((k % n) + n) % n; };
    for (int i = 0; i < n; i++) {
      float m = std::numeric_limits<float>::infinity();
      for (int o = -E; o <= E; o++) { const float cv = c[at(i + o)]; if (cv < m) m = cv; }
      er[i] = m;
    }
    for (int i = 0; i < n; i++) {
      double a = 0;
      for (int o = -B; o <= B; o++) a += (double)er[at(i + o)];
      out[i] = std::min(out[i], a / (2 * B + 1));
    }
  }
  sharedWalls = moved;
}

Proj Track::project(double px, double py, int hint, int win) const {
  int lo = 0, hi = n;
  if (hint >= 0) { lo = hint - win; hi = hint + win; }
  int best = 0;
  double bd = std::numeric_limits<double>::infinity();
  for (int k = lo; k < hi; k++) {
    const int i = ((k % n) + n) % n;
    const double d = (x[i] - px) * (x[i] - px) + (y[i] - py) * (y[i] - py);
    if (d < bd) { bd = d; best = i; }
  }
  const double h = hdg[best], dx = px - x[best], dy = py - y[best];
  Proj p;
  p.i = best;
  p.s = wrap(best * ds + (std::cos(h) * dx + std::sin(h) * dy));
  p.lat = -std::sin(h) * dx + std::cos(h) * dy;
  p.w = w[best]; p.runL = runL[best]; p.runR = runR[best];
  p.run = p.lat > 0 ? runL[best] : runR[best];
  p.bank = bank[best];
  p.curv = curv[best]; p.hdg = h;
  return p;
}

void Track::point(double s, double lat, double &ox, double &oy, double &oh, int &oi) const {
  const int i = idx(s);
  const double h = hdg[i];
  ox = x[i] - std::sin(h) * lat; oy = y[i] + std::cos(h) * lat; oh = h; oi = i;
}

const Corner *Track::cornerAt(double s) const {
  for (const auto &c : corners) {
    const double a = gap(s, c.s0), b = gap(c.s1, s);
    if (a > -40 && b > -40) return &c;
  }
  return nullptr;
}

const DrsZone *Track::drsZoneAt(double s) const {
  for (const auto &z : drs) {
    const bool inside = z.from <= z.to ? (s >= z.from && s <= z.to) : (s >= z.from || s <= z.to);
    if (inside) return &z;
  }
  return nullptr;
}

// ---------------------------------------------------------------------------
// js/line.js
// ---------------------------------------------------------------------------
static std::vector<double> minCurvature(const std::vector<double> &cx, const std::vector<double> &cy,
                                        const std::vector<double> &nx, const std::vector<double> &ny,
                                        const std::vector<double> &lim, const std::vector<double> &init,
                                        int iters, double step = 0.06) {
  const int n = (int)cx.size();
  std::vector<double> x = init, y = init, xPrev(n), px(n), py(n), dx(n), dy(n);
  double t = 1;
  for (int k = 0; k < iters; k++) {
    for (int i = 0; i < n; i++) { px[i] = cx[i] + nx[i] * y[i]; py[i] = cy[i] + ny[i] * y[i]; }
    for (int i = 0; i < n; i++) {
      const int a = (i - 1 + n) % n, b = (i + 1) % n;
      dx[i] = px[a] - 2 * px[i] + px[b];
      dy[i] = py[a] - 2 * py[i] + py[b];
    }
    xPrev = x;
    for (int i = 0; i < n; i++) {
      const int a = (i - 1 + n) % n, b = (i + 1) % n;
      const double g = nx[i] * (dx[a] - 2 * dx[i] + dx[b]) + ny[i] * (dy[a] - 2 * dy[i] + dy[b]);
      const double v = y[i] - step * g;
      x[i] = v > lim[i] ? lim[i] : v < -lim[i] ? -lim[i] : v;
    }
    const double t1 = (1 + std::sqrt(1 + 4 * t * t)) / 2, mom = (t - 1) / t1;
    for (int i = 0; i < n; i++) y[i] = x[i] + mom * (x[i] - xPrev[i]);
    t = t1;
    if (k % 500 == 499) { t = 1; y = x; }
  }
  return x;
}

F32 racingLine(const Track &track, double margin, int iters) {
  const int n = track.n;
  std::vector<double> off(n, 0.0);
  for (int k : {32, 8, 2, 1}) {
    if (k > 1 && (double)n / k < 24) continue;
    const int m = n / k;
    std::vector<double> cx(m), cy(m), nx(m), ny(m), lim(m), init(m);
    for (int j = 0; j < m; j++) {
      const int i = j * k;
      cx[j] = track.x[i]; cy[j] = track.y[i];
      nx[j] = -std::sin(track.hdg[i]); ny[j] = std::cos(track.hdg[i]);
      lim[j] = std::max(0.2, track.w[i] - margin);
      init[j] = off[i];
    }
    const std::vector<double> sol = minCurvature(cx, cy, nx, ny, lim, init, iters);
    for (int j = 0; j < m; j++) {
      const int i0 = j * k, i1 = j + 1 < m ? (j + 1) * k : n;
      const double a = sol[j], b = sol[(j + 1) % m];
      for (int i = i0; i < i1; i++) off[i] = a + (b - a) * (i - i0) / (double)(i1 - i0);
    }
  }
  F32 out(n);
  for (int i = 0; i < n; i++) out.set(i, off[i]);
  return out;
}

static void ptOf(const Track &t, const F32 &off, int i, double &px, double &py) {
  const double h = t.hdg[i];
  px = t.x[i] - std::sin(h) * off[i];
  py = t.y[i] + std::cos(h) * off[i];
}

F32 lineCurvature(const Track &track, const F32 &off) {
  const int n = track.n;
  F32 cur(n);
  auto P = [&](int i, double &px, double &py) { ptOf(track, off, ((i % n) + n) % n, px, py); };
  for (int i = 0; i < n; i++) {
    double ax0, ay0, bx0, by0, cx0, cy0;
    P(i - 2, ax0, ay0); P(i, bx0, by0); P(i + 2, cx0, cy0);
    const double ax = bx0 - ax0, ay = by0 - ay0, bx = cx0 - bx0, by = cy0 - by0;
    const double cross = ax * by - ay * bx;
    const double la = std::hypot(ax, ay), lb = std::hypot(bx, by), lc = std::hypot(cx0 - ax0, cy0 - ay0);
    cur.set(i, (la * lb * lc) > 1e-6 ? (2 * cross) / (la * lb * lc) : 0);
  }
  F32 out(n);
  for (int i = 0; i < n; i++) {
    double acc = 0;
    for (int k = -3; k <= 3; k++) acc += cur[((i + k) % n + n) % n];
    out.set(i, acc / 7);
  }
  return out;
}

F32 speedProfile(const Track &track, const F32 &cur, const Spec &spec, double mu) {
  const int n = track.n;
  const double ds = track.ds, vmax = topSpeed(spec);
  F32 v(n);
  for (int i = 0; i < n; i++) {
    const double R = std::fabs(cur[i]) > 1e-5 ? 1 / std::fabs(cur[i]) : 1e6;
    v.set(i, std::min(vmax, corneringSpeed(spec, R, mu, track.bank[i]) * 0.97));
  }
  auto q = [&](double s) { return 0.5 * spec.rho * s * s; };
  for (int pass = 0; pass < 3; pass++) {
    for (int k = n * 2; k >= 0; k--) {           // backward: braking
      const int i = k % n, j = (i + 1) % n;
      const double Fz = spec.m * 9.81 + q(v[j]) * spec.ClA;
      const double aBrake = (std::min(mu * Fz, spec.Fbrake) + q(v[j]) * spec.CdA) / spec.m;
      const double cap = std::sqrt(v[j] * v[j] + 2 * aBrake * ds);
      if (v[i] > cap) v.set(i, cap);
    }
    for (int k = 0; k <= n * 2; k++) {           // forward: traction/power
      const int i = k % n, j = (i - 1 + n) % n;
      const double Fz = spec.m * 9.81 + q(v[j]) * spec.ClA;
      const double Fdrive = std::min({spec.Pmax / std::max(v[j], 9.0), spec.Fdrive, mu * Fz * 0.62});
      const double aAcc = (Fdrive - q(v[j]) * spec.CdA - spec.rollRes) / spec.m;
      const double cap = std::sqrt(std::max(1.0, v[j] * v[j] + 2 * std::max(0.0, aAcc) * ds));
      if (v[i] > cap) v.set(i, cap);
    }
  }
  return v;
}

static double lapOf(const Track &track, const F32 &v) {
  double l = 0;
  for (int i = 0; i < track.n; i++) l += track.ds / std::max(v[i], 5.0);
  return l;
}

Line buildLine(const Track &track, const Spec &spec, double mu, double margin) {
  mu *= 0.93;
  const int n = track.n;
  Line L;
  if (!track.line.empty()) {
    L.off = F32(n);
    for (int i = 0; i < n; i++) L.off.set(i, track.line[i]);
  } else L.off = racingLine(track, margin);
  L.cur = lineCurvature(track, L.off);
  L.v = speedProfile(track, L.cur, spec, mu);
  L.pts = F32(n * 2);
  for (int i = 0; i < n; i++) {
    double px, py;
    ptOf(track, L.off, i, px, py);
    L.pts.set(i * 2, px); L.pts.set(i * 2 + 1, py);
  }
  L.hdg = F32(n);
  for (int i = 0; i < n; i++) {
    const int a = (i - 1 + n) % n, b = (i + 1) % n;
    L.hdg.set(i, std::atan2(L.pts[b * 2 + 1] - L.pts[a * 2 + 1], L.pts[b * 2] - L.pts[a * 2]));
  }
  if (track.open && n > 2) {
    L.hdg.set(0, std::atan2(L.pts[3] - L.pts[1], L.pts[2] - L.pts[0]));
    L.hdg.set(n - 1, std::atan2(L.pts[(n - 1) * 2 + 1] - L.pts[(n - 2) * 2 + 1],
                                L.pts[(n - 1) * 2] - L.pts[(n - 2) * 2]));
  }
  L.lapTime = lapOf(track, L.v);
  return L;
}

Lines buildLines(const Track &track, const Spec &spec) {
  const double mu = limitMu(spec);
  Lines Ls;
  Ls.track = &track; Ls.spec = &spec; Ls.mu = mu;
  const int n = track.n;
  F32 zero(n);
  Ls.race = buildLine(track, spec, mu);
  Line &c = Ls.centre;
  c.off = zero;
  c.cur = lineCurvature(track, zero);
  c.pts = F32(n * 2);
  for (int i = 0; i < n; i++) { c.pts.set(i * 2, track.x[i]); c.pts.set(i * 2 + 1, track.y[i]); }
  c.v = speedProfile(track, c.cur, spec, mu * 0.93);
  c.hdg = track.hdg;
  c.lapTime = lapOf(track, c.v);
  return Ls;
}

const Line &Lines::at(const std::string &which, double grip) {
  char buf[64];
  std::snprintf(buf, sizeof buf, "%s:%.3f", which.c_str(), grip);
  auto it = cache.find(buf);
  if (it != cache.end()) return it->second;
  const Line &base = which == "centre" ? centre : race;
  Line got = base;
  got.v = speedProfile(*track, base.cur, *spec, mu * 0.93 * grip);
  got.lapTime = lapOf(*track, got.v);
  got.vTop = 0;
  return cache.emplace(buf, std::move(got)).first->second;
}

}  // namespace xbr
