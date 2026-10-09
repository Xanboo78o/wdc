// carmesh.cpp — js/car.js's bodywork, in C++.
//
// HOW THIS IS BUILT. Every shape is generated in car.js's OWN coordinates and
// with car.js's own numbers (three.js: x forward, y up, z to the car's RIGHT,
// origin on the road midway between the axles), into a soup of polygons. Then:
//
//   1. the generic team livery (js/livery.js generic()) is CUT into the paint,
//      polygon by polygon, against the livery's boxes — a stripe has a clean
//      edge wherever the tessellation happens to fall;
//   2. the soup is WARPED onto the class's spec: the axles land on +spec.a and
//      -spec.b, the overhangs are scaled so the bodywork is spec.bodyL long,
//      and the width so it is spec.bodyW across (F1 comes out as a pure 0.18 m
//      shift — car.js IS the F1 car; F4 is the same body shrunk);
//   3. it is emitted through MeshB as flat triangles, (x, y, z)_three ->
//      (x, -z, y)_sim.
//
// What car.js draws with canvas textures (sponsor atlas, race numbers, carbon
// weave, tyre-wall lettering and compound band) is NOT here: it cannot be a
// vertex colour.
#include "carmesh.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace xbr {
namespace {

const double PI_ = 3.14159265358979323846;

struct V3 { double x, y, z; };
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, double k) { return {a.x * k, a.y * k, a.z * k}; }
inline double dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline double len(V3 a) { return std::sqrt(dot(a, a)); }
inline V3 norm(V3 a) { const double l = len(a); return l > 1e-12 ? a * (1 / l) : V3{0, 1, 0}; }

// A surface: colour, the shader's `kind`, and a tag for the passes that cut
// polygons afterwards (1 = team paint, takes the livery; 2 = a GT wheel arch).
struct Mat { float r, g, b, kind; int tag; };

const float K_MATT = 0, K_GLOSS = 6, K_GLOW = 8, K_PAINT = 12;
// car.js's `carbon` is clearcoated (roughness 0.32, clearcoat 0.9): it takes
// the specular kind. Its `carbonMatt` (the suspension) does not. Set this to
// K_MATT for a car with no shine on its carbon at all.
const float K_CARBON = K_GLOSS;

const Mat PAINT   = {0.78f, 0.78f, 0.78f, K_PAINT, 1};
// livery.js generic(): pri lerped 82% to #0a0a0a. On kind 12 the shader gives
// uPaint * (r / 0.78), so 18% of the team colour is r = 0.78 * 0.18.
const Mat PAINT_DK = {0.1404f, 0.1404f, 0.1404f, K_PAINT, 0};
// car.js paint2 — the team's SECOND colour (0xf2f2f2 with no livery): helmet,
// top front flap, T-cam, wheel-cover rings, and the livery's stripes.
const Mat PAINT2  = {0.92f, 0.92f, 0.90f, K_GLOSS, 0};
const Mat CARBON  = {0.055f, 0.055f, 0.065f, K_CARBON, 0};
const Mat CARBONM = {0.055f, 0.055f, 0.065f, K_MATT, 0};
const Mat BLACK   = {0.020f, 0.024f, 0.027f, K_MATT, 0};      // 0x050607
const Mat FABRIC  = {0.078f, 0.082f, 0.094f, K_MATT, 0};      // 0x141518
const Mat VISOR   = {0.07f, 0.09f, 0.12f, K_GLOSS, 0};
const Mat MIRROR  = {0.72f, 0.77f, 0.82f, K_GLOSS, 0};        // 0xb8c4d0
const Mat RAIN    = {0.90f, 0.05f, 0.05f, K_GLOW, 0};
const Mat LAMP    = {0.87f, 0.91f, 0.95f, K_GLOW, 0};         // 0xdfe8f2, emissive
const Mat RUBBER  = {0.045f, 0.045f, 0.05f, K_MATT, 0};
const Mat COVER   = {0.082f, 0.086f, 0.102f, K_GLOSS, 0};     // hubMat 0x15161a
const Mat NUT     = {0.79f, 0.80f, 0.82f, K_GLOSS, 0};        // 0xc9ccd1
const Mat SPOKE   = {0.50f, 0.51f, 0.54f, K_GLOSS, 0};
const Mat GT_GLASS = {0.07f, 0.09f, 0.12f, K_GLOSS, 0};       // 0x0c1116
const Mat GT_MATT = {0.045f, 0.048f, 0.055f, K_MATT, 0};      // carbon, tint 0x15171a
const Mat GT_RIM  = {0.455f, 0.47f, 0.494f, K_GLOSS, 0};      // 0x74787e
const Mat GT_HUB  = {0.165f, 0.176f, 0.20f, K_GLOSS, 0};      // 0x2a2d33
const Mat GT_ARCH = {0.78f, 0.78f, 0.78f, K_PAINT, 2};

// ---------------------------------------------------------------------------
// Geometry, as car.js makes it. A Geo is a triangle list, three vertices each.
// ---------------------------------------------------------------------------
typedef std::vector<V3> Geo;
inline void T3(Geo &g, V3 a, V3 b, V3 c) { g.push_back(a); g.push_back(b); g.push_back(c); }
inline void Q4(Geo &g, V3 a, V3 b, V3 c, V3 d) { T3(g, a, b, c); T3(g, a, c, d); }
Geo at(Geo g, double x, double y, double z) { for (V3 &p : g) p = p + V3{x, y, z}; return g; }
Geo rotZ(Geo g, double a) {
  const double c = std::cos(a), s = std::sin(a);
  for (V3 &p : g) p = {p.x * c - p.y * s, p.x * s + p.y * c, p.z};
  return g;
}
Geo rotY(Geo g, double a) {
  const double c = std::cos(a), s = std::sin(a);
  for (V3 &p : g) p = {p.x * c + p.z * s, p.y, -p.x * s + p.z * c};
  return g;
}
Geo scaled(Geo g, double x, double y, double z) { for (V3 &p : g) p = {p.x * x, p.y * y, p.z * z}; return g; }

typedef std::array<double, 2> P2;

// A superellipse: exponent 2 is an ellipse, 4 a rounded rectangle. [across, up].
std::vector<P2> ring(double w, double h, double n, int segs) {
  std::vector<P2> pts;
  const double p = 2 / n;
  for (int i = 0; i < segs; i++) {
    const double a = (double)i / segs * PI_ * 2, ca = std::cos(a), sa = std::sin(a);
    pts.push_back({(ca < 0 ? -1.0 : 1.0) * std::pow(std::fabs(ca), p) * w, (sa < 0 ? -1.0 : 1.0) * std::pow(std::fabs(sa), p) * h});
  }
  return pts;
}

struct St { double x, y, w, h, n, z = 0; };   // a loft station (car.js writes z third; here it is last)

// Sweep a skin through cross-sections; fan caps on both ends.
Geo loft(const std::vector<St> &st, int segs = 24, bool close = true) {
  Geo g;
  std::vector<std::vector<V3>> R;
  for (const St &s : st) {
    std::vector<V3> r;
    for (const P2 &q : ring(s.w, s.h, s.n, segs)) r.push_back({s.x, s.y + q[1], s.z + q[0]});
    R.push_back(r);
  }
  for (size_t k = 0; k + 1 < st.size(); k++)
    for (int i = 0; i < segs; i++) {
      const int j = (i + 1) % segs;
      Q4(g, R[k][i], R[k + 1][i], R[k + 1][j], R[k][j]);
    }
  if (close)
    for (size_t k : {(size_t)0, st.size() - 1}) {
      const V3 c = {st[k].x, st[k].y, st[k].z};
      for (int i = 0; i < segs; i++) T3(g, c, R[k][i], R[k][(i + 1) % segs]);
    }
  return g;
}

// A wing element: a cambered aerofoil swept across the span, tips curled up.
Geo wing(double span, double chord, double thick, double camber, double twistTip, double rise, int segs = 18) {
  const int sec = 10;
  std::vector<std::vector<V3>> R;
  for (int i = 0; i <= segs; i++) {
    const double u = (double)i / segs * 2 - 1, z = u * span, k = std::fabs(u);
    const double c = chord * (1 - 0.22 * k * k), ang = twistTip * k * k, y = rise * k * k * k;
    std::vector<V3> r;
    for (int j = 0; j < sec; j++) {
      const double a = (double)j / sec * PI_ * 2;
      const double cx = std::cos(a) * c * 0.5;
      const double cy = std::sin(a) * thick * 0.5 - camber * (1 - std::cos(a) * std::cos(a));
      r.push_back({cx * std::cos(ang) - cy * std::sin(ang), y + cx * std::sin(ang) + cy * std::cos(ang), z});
    }
    R.push_back(r);
  }
  Geo g;
  for (int i = 0; i < segs; i++)
    for (int j = 0; j < sec; j++) {
      const int n = (j + 1) % sec;
      Q4(g, R[i][j], R[i + 1][j], R[i + 1][n], R[i][n]);
    }
  return g;
}

// A rod between two points: a flattened cylinder (a wishbone is an aerofoil).
Geo rod(V3 A, V3 B, double r = 0.018, double flat = 0.45, int segs = 8) {
  const double L = len(B - A);
  const V3 d = norm(B - A);
  // three.js Quaternion.setFromUnitVectors((0,1,0), d)
  double qw = 1 + d.y;
  V3 qv = {d.z, 0, -d.x};
  if (qw < 1e-9) { qw = 0; qv = {0, 0, 1}; }
  const double ql = std::sqrt(qw * qw + dot(qv, qv));
  qw /= ql; qv = qv * (1 / ql);
  const V3 mid = (A + B) * 0.5;
  auto X = [&](V3 v) { const V3 t = cross(qv, v) * 2; return v + t * qw + cross(qv, t) + mid; };
  Geo g;
  const V3 c0 = X({0, -L / 2, 0}), c1 = X({0, L / 2, 0});
  for (int i = 0; i < segs; i++) {
    const double a0 = 2 * PI_ * i / segs, a1 = 2 * PI_ * (i + 1) / segs;
    const V3 p0 = X({r * std::sin(a0), -L / 2, r * std::cos(a0) * flat}), p1 = X({r * std::sin(a1), -L / 2, r * std::cos(a1) * flat});
    const V3 q0 = X({r * std::sin(a0), L / 2, r * std::cos(a0) * flat}), q1 = X({r * std::sin(a1), L / 2, r * std::cos(a1) * flat});
    Q4(g, p0, p1, q1, q0);
    T3(g, c0, p0, p1);
    T3(g, c1, q0, q1);
  }
  return g;
}

// THREE.BoxGeometry(w, h, d): w along x, h up, d across.
Geo box(double w, double h, double d) {
  const double x = w / 2, y = h / 2, z = d / 2;
  const V3 v[8] = {{-x, -y, -z}, {x, -y, -z}, {x, y, -z}, {-x, y, -z}, {-x, -y, z}, {x, -y, z}, {x, y, z}, {-x, y, z}};
  Geo g;
  Q4(g, v[0], v[1], v[2], v[3]); Q4(g, v[4], v[5], v[6], v[7]);
  Q4(g, v[0], v[1], v[5], v[4]); Q4(g, v[3], v[2], v[6], v[7]);
  Q4(g, v[0], v[3], v[7], v[4]); Q4(g, v[1], v[2], v[6], v[5]);
  return g;
}

// Ear-clip a simple polygon (the plates are not all convex: the fin, the
// cockpit wall, the snapped pylon feet). Returns index triples.
std::vector<int> earclip(const std::vector<P2> &p) {
  const int n = (int)p.size();
  std::vector<int> idx(n), out;
  double area = 0;
  for (int i = 0; i < n; i++) { idx[i] = i; const P2 &a = p[i], &b = p[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) std::reverse(idx.begin(), idx.end());
  auto crs = [&](int a, int b, int c) { return (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]); };
  int guard = 0;
  while (idx.size() > 3 && guard++ < 10000) {
    bool cut = false;
    const int m = (int)idx.size();
    for (int i = 0; i < m && !cut; i++) {
      const int a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      if (crs(a, b, c) <= 1e-14) continue;
      bool inside = false;
      for (int q : idx) {
        if (q == a || q == b || q == c) continue;
        if (crs(a, b, q) > 1e-12 && crs(b, c, q) > 1e-12 && crs(c, a, q) > 1e-12) { inside = true; break; }
      }
      if (inside) continue;
      out.insert(out.end(), {a, b, c});
      idx.erase(idx.begin() + i);
      cut = true;
    }
    if (!cut) idx.erase(idx.begin());      // degenerate (collinear) corner: drop it
  }
  if (idx.size() == 3) out.insert(out.end(), idx.begin(), idx.end());
  return out;
}

// A flat plate cut to an outline in the car's side view (x, y), `thick` wide,
// centred on z. (car.js bevels the edge by 0.3 x thick — 3 to 5 mm — which is
// dropped: it is under a pixel and costs five times the triangles.)
Geo plate(const std::vector<P2> &pts, double thick, double z) {
  Geo g;
  const double z0 = z - thick / 2, z1 = z + thick / 2;
  const std::vector<int> tri = earclip(pts);
  for (size_t i = 0; i + 2 < tri.size(); i += 3)
    for (double zz : {z0, z1})
      T3(g, {pts[tri[i]][0], pts[tri[i]][1], zz}, {pts[tri[i + 1]][0], pts[tri[i + 1]][1], zz}, {pts[tri[i + 2]][0], pts[tri[i + 2]][1], zz});
  for (size_t i = 0; i < pts.size(); i++) {
    const P2 &a = pts[i], &b = pts[(i + 1) % pts.size()];
    Q4(g, {a[0], a[1], z0}, {b[0], b[1], z0}, {b[0], b[1], z1}, {a[0], a[1], z1});
  }
  return g;
}
// The same, lying down: an outline in plan (x, z), from y0 up to y1. The floor.
Geo slab(const std::vector<P2> &pts, double y0, double y1) {
  Geo g = plate(pts, y1 - y0, (y0 + y1) / 2);
  for (V3 &p : g) p = {p.x, p.z, p.y};
  return g;
}

// THREE.CatmullRomCurve3(points, false, 'centripetal') sampled at n+1 points
// evenly spaced by arc length (what TubeGeometry's getPointAt does).
std::vector<V3> spline(const std::vector<V3> &P, int n) {
  const int m = (int)P.size();
  std::vector<V3> dense;
  const int K = 48;
  auto comp = [](double x0, double x1, double x2, double x3, double d0, double d1, double d2, double t) {
    double t1 = (x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1;
    double t2 = (x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2;
    t1 *= d1; t2 *= d1;
    const double c0 = x1, c1 = t1, c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
    return c0 + c1 * t + c2 * t * t + c3 * t * t * t;
  };
  for (int s = 0; s + 1 < m; s++) {
    const V3 p1 = P[s], p2 = P[s + 1];
    const V3 p0 = s > 0 ? P[s - 1] : P[0] - P[1] + P[0];
    const V3 p3 = s + 2 < m ? P[s + 2] : P[m - 1] - P[m - 2] + P[m - 1];
    double d0 = std::pow(dot(p0 - p1, p0 - p1), 0.25), d1 = std::pow(dot(p1 - p2, p1 - p2), 0.25), d2 = std::pow(dot(p2 - p3, p2 - p3), 0.25);
    if (d1 < 1e-4) d1 = 1.0;
    if (d0 < 1e-4) d0 = d1;
    if (d2 < 1e-4) d2 = d1;
    for (int j = (s ? 1 : 0); j <= K; j++) {
      const double t = (double)j / K;
      dense.push_back({comp(p0.x, p1.x, p2.x, p3.x, d0, d1, d2, t), comp(p0.y, p1.y, p2.y, p3.y, d0, d1, d2, t), comp(p0.z, p1.z, p2.z, p3.z, d0, d1, d2, t)});
    }
  }
  std::vector<double> acc(dense.size(), 0);
  for (size_t i = 1; i < dense.size(); i++) acc[i] = acc[i - 1] + len(dense[i] - dense[i - 1]);
  std::vector<V3> out;
  size_t k = 0;
  for (int i = 0; i <= n; i++) {
    const double want = acc.back() * i / n;
    while (k + 2 < dense.size() && acc[k + 1] < want) k++;
    const double span = acc[k + 1] - acc[k], f = span > 1e-12 ? (want - acc[k]) / span : 0;
    out.push_back(dense[k] + (dense[k + 1] - dense[k]) * std::min(1.0, std::max(0.0, f)));
  }
  return out;
}

// A tube through points (the halo): THREE.TubeGeometry, open ends.
Geo tube(const std::vector<V3> &pts, double r, int tubular = 64, int radial = 10) {
  const std::vector<V3> C = spline(pts, tubular);
  const int n = (int)C.size();
  std::vector<std::vector<V3>> R(n);
  V3 N = {0, 0, 0};
  for (int i = 0; i < n; i++) {
    const V3 T = norm(C[std::min(i + 1, n - 1)] - C[std::max(i - 1, 0)]);
    if (i == 0) {
      const double ax = std::fabs(T.x), ay = std::fabs(T.y), az = std::fabs(T.z);
      const V3 ref = ax <= ay && ax <= az ? V3{1, 0, 0} : (ay <= az ? V3{0, 1, 0} : V3{0, 0, 1});
      N = norm(cross(T, ref));
    } else {
      N = norm(N - T * dot(N, T));          // carry the frame along: no twist
    }
    const V3 B = cross(T, N);
    for (int j = 0; j < radial; j++) {
      const double a = 2 * PI_ * j / radial;
      R[i].push_back(C[i] + N * (r * std::cos(a)) + B * (r * std::sin(a)));
    }
  }
  Geo g;
  for (int i = 0; i + 1 < n; i++)
    for (int j = 0; j < radial; j++) {
      const int k = (j + 1) % radial;
      Q4(g, R[i][j], R[i + 1][j], R[i + 1][k], R[i][k]);
    }
  return g;
}

// A sphere patch: phi sweeps round the vertical axis from straight AHEAD (+x),
// theta comes down from the top.
Geo sphere(double r, int ws, int hs, double ps = 0, double pl = 2 * PI_, double ts = 0, double tl = PI_) {
  auto P = [&](int ix, int iy) {
    const double phi = ps + pl * ix / ws, th = ts + tl * iy / hs;
    return V3{r * std::cos(phi) * std::sin(th), r * std::cos(th), r * std::sin(phi) * std::sin(th)};
  };
  Geo g;
  for (int iy = 0; iy < hs; iy++)
    for (int ix = 0; ix < ws; ix++) {
      const V3 a = P(ix, iy), b = P(ix + 1, iy), c = P(ix + 1, iy + 1), d = P(ix, iy + 1);
      if (len(a - b) > 1e-9) T3(g, a, b, c);
      if (len(c - d) > 1e-9) T3(g, a, c, d);
    }
  return g;
}

// A disc facing along the car (the airbox intake): radii ry up, rz across.
Geo discX(double ry, double rz, int segs = 20) {
  Geo g;
  for (int i = 0; i < segs; i++) {
    const double a0 = 2 * PI_ * i / segs, a1 = 2 * PI_ * (i + 1) / segs;
    T3(g, {0, 0, 0}, {0, std::sin(a0) * ry, std::cos(a0) * rz}, {0, std::sin(a1) * ry, std::cos(a1) * rz});
  }
  return g;
}

// ---------------------------------------------------------------------------
// The soup, and the passes over it.
// ---------------------------------------------------------------------------
struct Poly { std::vector<V3> p; Mat m; bool measure; };
typedef std::vector<Poly> Soup;

// `measure`: does this piece count toward the bodywork's length and width?
// (A door mirror does not: the regulations' 2.05 m is measured without them.)
void add(Soup &s, const Geo &g, const Mat &m, bool measure = true) {
  for (size_t i = 0; i + 2 < g.size(); i += 3) s.push_back({{g[i], g[i + 1], g[i + 2]}, m, measure});
}

struct Plane { double nx, ny, nz, d; };          // inside: n . p <= d

// Split a convex polygon by a plane.
void split(const std::vector<V3> &poly, const Plane &pl, std::vector<V3> &in, std::vector<V3> &out) {
  in.clear(); out.clear();
  const size_t n = poly.size();
  std::vector<double> s(n);
  bool anyIn = false, anyOut = false;
  for (size_t i = 0; i < n; i++) {
    s[i] = pl.nx * poly[i].x + pl.ny * poly[i].y + pl.nz * poly[i].z - pl.d;
    if (s[i] < -1e-9) anyIn = true;
    if (s[i] > 1e-9) anyOut = true;
  }
  if (!anyOut) { in = poly; return; }
  if (!anyIn) { out = poly; return; }
  for (size_t i = 0; i < n; i++) {
    const size_t j = (i + 1) % n;
    const V3 &a = poly[i], &b = poly[j];
    if (s[i] <= 0) in.push_back(a);
    if (s[i] >= 0) out.push_back(a);
    if ((s[i] < 0 && s[j] > 0) || (s[i] > 0 && s[j] < 0)) {
      const V3 c = a + (b - a) * (s[i] / (s[i] - s[j]));
      in.push_back(c); out.push_back(c);
    }
  }
  if (in.size() < 3) in.clear();
  if (out.size() < 3) out.clear();
}

// Everything tagged `tag` that lies inside the convex region is repainted
// `to` — or removed, when `to` is null. What lies outside is left as it was.
void carve(Soup &s, const std::vector<Plane> &region, int tag, const Mat *to) {
  Soup res;
  res.reserve(s.size() + 64);
  std::vector<V3> in, out;
  for (Poly &q : s) {
    if (q.m.tag != tag) { res.push_back(std::move(q)); continue; }
    std::vector<V3> cur = q.p;
    for (const Plane &pl : region) {
      split(cur, pl, in, out);
      if (!out.empty()) res.push_back({out, q.m, q.measure});
      cur = in;
      if (cur.empty()) break;
    }
    if (!cur.empty() && to) { Mat m = *to; m.tag = q.m.tag; res.push_back({cur, m, q.measure}); }
  }
  s.swap(res);
}

// One livery.js rule: [colour, x0, x1, y0, y1, z0, z1, slant], matched on |z|.
void liveryRule(Soup &s, const Mat &col, double x0, double x1, double y0, double y1, double z0, double z1, double slant = 0) {
  for (double sg : {1.0, -1.0}) {
    if (sg < 0 && z0 <= 0) break;               // a box that starts at the centreline is one box
    const double zl = sg < 0 ? z0 : (z0 <= 0 ? -z1 : z0);
    carve(s, {{-1, -slant, 0, -x0}, {1, slant, 0, x1}, {0, -1, 0, -y0}, {0, 1, 0, y1}, {0, 0, -sg, -zl}, {0, 0, sg, z1}}, 1, &col);
  }
}

// The class's spec, as a map from car.js's space. AF/AR: where car.js has its
// axles. Piecewise in x so both axles AND both ends land where the spec says.
struct Warp {
  double AF, AR, a, b, kMid, kOver, sl, sv;
  double fx(double x) const {
    if (x > AF) return a + (x - AF) * kOver;
    if (x < AR) return -b + (x - AR) * kOver;
    return -b + (x - AR) * kMid;
  }
  V3 operator()(V3 p) const { return {fx(p.x), p.y * sv, p.z * sl}; }
};

struct Ext { double x0 = 1e9, x1 = -1e9, zmax = 0; };
void measure(const Soup &s, Ext &e) {
  for (const Poly &q : s) {
    if (!q.measure) continue;
    for (const V3 &p : q.p) { e.x0 = std::min(e.x0, p.x); e.x1 = std::max(e.x1, p.x); e.zmax = std::max(e.zmax, std::fabs(p.z)); }
  }
}

// three.js (x, y up, z right) -> sim (x, y left, z up), as flat triangles.
void emit(MeshB &m, const Soup &s) {
  for (const Poly &q : s) {
    const float col[3] = {q.m.r, q.m.g, q.m.b};
    for (size_t i = 1; i + 1 < q.p.size(); i++) {
      const V3 &A = q.p[0], &B = q.p[i], &C = q.p[i + 1];
      if (len(cross(B - A, C - A)) < 1e-10) continue;
      const double a[3] = {A.x, -A.z, A.y}, b[3] = {B.x, -B.z, B.y}, c[3] = {C.x, -C.z, C.y};
      m.tri(a, b, c, col, q.m.kind);
    }
  }
}

// ---------------------------------------------------------------------------
// Wheels. car.js tyre(): a real cross-section turned on a lathe — tread,
// shoulder, sidewall bulge, bead. Built with the axle on three's z.
// ---------------------------------------------------------------------------
void tyre(Soup &s, double radius, double width, double rimK, int segs) {
  const double r = radius, hw = width / 2, rim = radius * rimK;
  // car.js has an eleventh point at the tread's centre; it is collinear.
  const double prof[10][2] = {
    {rim, hw * 0.55}, {r * 0.80, hw * 0.92}, {r * 0.93, hw * 1.0}, {r * 0.995, hw * 0.93}, {r, hw * 0.58},
    {r, -hw * 0.58}, {r * 0.995, -hw * 0.93}, {r * 0.93, -hw * 1.0}, {r * 0.80, -hw * 0.92}, {rim, -hw * 0.55}};
  Geo g;
  for (int i = 0; i < segs; i++) {
    const double a0 = 2 * PI_ * i / segs, a1 = 2 * PI_ * (i + 1) / segs;
    for (int k = 0; k < 9; k++) {
      const double r0 = prof[k][0], z0 = prof[k][1], r1 = prof[k + 1][0], z1 = prof[k + 1][1];
      Q4(g, {r0 * std::cos(a0), r0 * std::sin(a0), z0}, {r0 * std::cos(a1), r0 * std::sin(a1), z0},
            {r1 * std::cos(a1), r1 * std::sin(a1), z1}, {r1 * std::cos(a0), r1 * std::sin(a0), z1});
    }
  }
  add(s, g, RUBBER);
}
Geo annulus(double r0, double r1, double z, int segs) {
  Geo g;
  for (int i = 0; i < segs; i++) {
    const double a0 = 2 * PI_ * i / segs, a1 = 2 * PI_ * (i + 1) / segs;
    const V3 o0 = {r1 * std::cos(a0), r1 * std::sin(a0), z}, o1 = {r1 * std::cos(a1), r1 * std::sin(a1), z};
    if (r0 <= 0) T3(g, {0, 0, z}, o0, o1);
    else Q4(g, {r0 * std::cos(a0), r0 * std::sin(a0), z}, o0, o1, {r0 * std::cos(a1), r0 * std::sin(a1), z});
  }
  return g;
}
// Five spokes on the wheel's face. car.js's wheel is rotationally symmetric
// and shows it turning only through the lettering on the tyre wall, which is
// a texture; these are what turns here.
Geo spokes(double r0, double r1, double halfW, double z) {
  Geo g;
  for (int k = 0; k < 5; k++) {
    const double a = 2 * PI_ * k / 5, c = std::cos(a), sn = std::sin(a);
    auto P = [&](double rr, double t) { return V3{rr * c - t * sn, rr * sn + t * c, z}; };
    Q4(g, P(r0, -halfW), P(r1, -halfW * 0.7), P(r1, halfW * 0.7), P(r0, halfW));
  }
  return g;
}

// The single-seater's wheel: 18-inch rim behind a cover, a ring of the second
// colour on it, and the wheel nut.
void wheelSS(MeshB &out, double R, double width, double k) {
  const int SEG = 22;
  const double RIMK = 0.64, BORE = R * (RIMK + 0.005);
  Soup s;
  tyre(s, R, width, RIMK, SEG);
  for (double sd : {1.0, -1.0}) {
    const double zf = sd * width * 0.275;
    add(s, annulus(0, BORE, zf, SEG), COVER);
    add(s, annulus(BORE * 0.70, BORE * 0.80, zf + sd * 0.004, SEG), PAINT2);
    add(s, spokes(0.045, BORE * 0.66, 0.020, zf + sd * 0.004), SPOKE);
    // the nut: a hexagon, 0.04 at its seat and 0.035 at its face
    Geo nut;
    const double z0 = zf, z1 = zf + sd * 0.027;
    for (int i = 0; i < 6; i++) {
      const double a0 = 2 * PI_ * i / 6, a1 = 2 * PI_ * (i + 1) / 6;
      const V3 b0 = {0.04 * std::cos(a0), 0.04 * std::sin(a0), z0}, b1 = {0.04 * std::cos(a1), 0.04 * std::sin(a1), z0};
      const V3 t0 = {0.035 * std::cos(a0), 0.035 * std::sin(a0), z1}, t1 = {0.035 * std::cos(a1), 0.035 * std::sin(a1), z1};
      Q4(nut, b0, b1, t1, t0);
      T3(nut, {0, 0, z1}, t0, t1);
    }
    add(s, nut, NUT);
  }
  for (Poly &q : s) for (V3 &p : q.p) p = p * k;
  emit(out, s);
}
// The GT3's: a deeper tyre wall (rim at 0.58 R), an alloy lip and spokes.
void wheelGT(MeshB &out, double R, double width) {
  const int SEG = 22;
  const double BORE = R * 0.62;
  Soup s;
  tyre(s, R, width, 0.58, SEG);
  for (double sd : {1.0, -1.0}) {
    const double zf = sd * width * 0.275;
    add(s, annulus(0, BORE, zf, SEG), GT_HUB);
    add(s, annulus(BORE * 0.86, BORE, zf + sd * 0.004, SEG), GT_RIM);
    add(s, spokes(0.03, BORE * 0.88, 0.026, zf + sd * 0.004), GT_RIM);
  }
  emit(out, s);
}

// ---------------------------------------------------------------------------
// THE BROKEN NOSE (car.js brokenNose): what is left when the wing and the tip
// have gone — the paint skin split back in a ragged line, the laminate under
// it in splinters round a dark hollow, two pylons with their feet snapped. It
// is built INSIDE the intact tip, so it needs no switch: it is in `body`, and
// it shows the moment `frontWing` (which carries the tip) is not drawn.
// ---------------------------------------------------------------------------
void brokenNose(Soup &body, const St &tipPoint, const St &tipRoot) {
  const St a = tipRoot, b = tipPoint;
  auto at_ = [&](double x) {
    const double t = std::max(0.0, std::min(1.0, (x - a.x) / (b.x - a.x)));
    return St{x, a.y + (b.y - a.y) * t, a.w + (b.w - a.w) * t, a.h + (b.h - a.h) * t, a.n + (b.n - a.n) * t};
  };
  const int SEG = 28;
  auto rnd = [](double i) { const double s = std::sin(i * 12.9898 + 4.1414) * 43758.5453; return s - std::floor(s); };
  auto shell = [&](double k, double reach, int seed) {
    std::vector<double> rows[3], bend(SEG);
    for (int i = 0; i < SEG; i++) {
      const double r = rnd(i + seed), r2 = rnd(i * 7 + seed);
      const double l = i % 2 ? 0.004 + 0.018 * r : 0.02 + reach * (r2 > 0.55 ? r : r * r * 0.4);
      rows[0].push_back(a.x - 0.10); rows[1].push_back(a.x); rows[2].push_back(a.x + l);
      bend[i] = 1 - std::min(0.35, l * 1.6);
    }
    std::vector<V3> P[3];
    for (int ri = 0; ri < 3; ri++)
      for (int i = 0; i < SEG; i++) {
        const St s = at_(rows[ri][i]);
        const double kk = ri == 2 ? k * bend[i] : k;
        const P2 q = ring(s.w * kk, s.h * kk, s.n, SEG)[i];
        P[ri].push_back({rows[ri][i], s.y + q[1], q[0]});
      }
    Geo g;
    for (int r = 0; r < 2; r++)
      for (int i = 0; i < SEG; i++) { const int j = (i + 1) % SEG; Q4(g, P[r][i], P[r + 1][i], P[r + 1][j], P[r][j]); }
    return g;
  };
  add(body, shell(0.93, 0.10, 3), PAINT);
  add(body, shell(0.85, 0.22, 17), CARBON);
  const St s0 = at_(a.x);
  const std::vector<P2> pts = ring(s0.w * 0.82, s0.h * 0.82, s0.n, SEG);
  Geo cap;
  for (int i = 0; i < SEG; i++) {
    const P2 &p1 = pts[i], &p2 = pts[(i + 1) % SEG];
    T3(cap, {a.x - 0.03, s0.y, 0}, {a.x - 0.03, s0.y + p1[1], p1[0]}, {a.x - 0.03, s0.y + p2[1], p2[0]});
  }
  add(body, cap, BLACK);
  for (double side : {1.0, -1.0})
    add(body, plate({{2.31, 0.150}, {2.45, 0.140}, {2.455, 0.112}, {2.43, 0.101}, {2.415, 0.114},
                     {2.39, 0.096}, {2.365, 0.110}, {2.34, 0.099}, {2.315, 0.118}}, 0.010, side * 0.048), CARBON);
}

// ---------------------------------------------------------------------------
// THE SINGLE-SEATER (car.js buildCar): F1, and F4 on the same body.
// ---------------------------------------------------------------------------
void buildSingleSeater(const Spec &S, CarMeshes &M) {
  Soup body, fw, rw, helm;

  // --- the body: nose tip (leaves with the wing), tub, engine cover --------
  const St TIP0 = {2.66, 0.165, 0.090, 0.048, 2.6}, TIP1 = {2.30, 0.190, 0.118, 0.068, 2.8};
  add(fw, loft({TIP0, TIP1}, 32), PAINT);
  brokenNose(body, TIP0, TIP1);
  add(body, loft({
    {2.30, 0.190, 0.118, 0.068, 2.8},
    {1.90, 0.215, 0.145, 0.098, 3.0},
    {1.45, 0.250, 0.185, 0.140, 3.3},
    {0.90, 0.295, 0.250, 0.190, 3.5},
    {0.42, 0.320, 0.300, 0.220, 3.7},      // the cockpit dip: the skin drops so you look down INTO it
    {0.22, 0.270, 0.310, 0.170, 3.8},
    {-0.60, 0.270, 0.330, 0.170, 3.8},
    {-0.80, 0.378, 0.320, 0.290, 3.4},
  }, 32), PAINT);
  add(body, loft({
    {-0.80, 0.378, 0.322, 0.292, 3.4},
    {-1.30, 0.370, 0.270, 0.262, 3.2},
    {-1.85, 0.345, 0.170, 0.180, 3.0},
    {-2.30, 0.325, 0.080, 0.085, 2.5},
  }, 32), PAINT);
  // airbox, its intake a black hole, the shark fin, the T-cam
  add(body, loft({
    {-0.50, 0.62, 0.140, 0.120, 2.8},
    {-0.78, 0.65, 0.170, 0.145, 3.0},
    {-1.12, 0.60, 0.145, 0.115, 2.9},
    {-1.60, 0.50, 0.070, 0.060, 2.6},
  }, 24), PAINT);
  add(body, at(discX(0.095, 0.105), -0.495, 0.625, 0), BLACK);
  add(body, plate({{-0.95, 0.66}, {-1.20, 0.80}, {-1.95, 0.78}, {-2.20, 0.52}, {-1.60, 0.46}}, 0.012, 0), CARBON);
  add(body, at(box(0.10, 0.05, 0.075), -0.62, 0.795, 0), PAINT2);

  // --- sidepods: letterbox inlet, flat top ramping down, the undercut -----
  for (double side : {1.0, -1.0}) {
    add(body, loft({
      {0.64, 0.455, 0.150, 0.090, 5.0, side * 0.585},
      {0.35, 0.420, 0.225, 0.140, 4.6, side * 0.660},
      {-0.15, 0.405, 0.235, 0.155, 4.2, side * 0.680},
      {-0.65, 0.360, 0.205, 0.140, 3.8, side * 0.610},
      {-1.15, 0.300, 0.125, 0.105, 3.2, side * 0.470},
      {-1.62, 0.255, 0.050, 0.060, 2.6, side * 0.335},
    }, 28), PAINT);
    add(body, at(box(0.012, 0.15, 0.27), 0.640, 0.455, side * 0.585), BLACK);
    // mirrors: stalk, housing, and the glass turned in toward the driver
    add(body, rod({0.46, 0.55, side * 0.28}, {0.36, 0.625, side * 0.41}, 0.010, 0.6), CARBON);
    add(body, at(box(0.06, 0.065, 0.15), 0.37, 0.635, side * 0.44), PAINT);
    Geo glass;
    Q4(glass, {-0.065, -0.025, 0}, {0.065, -0.025, 0}, {0.065, 0.025, 0}, {-0.065, 0.025, 0});
    add(body, at(rotY(glass, -PI_ / 2 - side * 0.28), 0.338, 0.635, side * 0.44), MIRROR);
  }

  // --- floor, edge wings, fences, diffuser ---------------------------------
  add(body, slab({{1.55, 0.30}, {0.55, 0.80}, {-1.10, 0.88}, {-1.95, 0.64}, {-2.10, 0.0},
                  {-1.95, -0.64}, {-1.10, -0.88}, {0.55, -0.80}, {1.55, -0.30}}, 0.05, 0.08), CARBON);
  for (double side : {1.0, -1.0}) {
    add(body, rod({0.40, 0.10, side * 0.80}, {-1.05, 0.10, side * 0.88}, 0.022, 0.35), CARBON);
    const std::vector<P2> vane = {{1.56, 0.05}, {0.95, 0.05}, {0.95, 0.17}, {1.12, 0.245}, {1.40, 0.20}, {1.56, 0.12}};
    std::vector<P2> vane2;
    for (const P2 &p : vane) vane2.push_back({p[0] - 0.08, p[1] * 0.9});
    add(body, plate(vane, 0.010, side * 0.33), CARBON);
    add(body, plate(vane2, 0.010, side * 0.42), CARBON);
  }
  add(body, at(rotZ(box(0.72, 0.012, 1.06), -0.35), -1.90, 0.195, 0), CARBON);
  for (double z : {-0.53, -0.18, 0.18, 0.53})
    add(body, plate({{-1.56, 0.05}, {-2.24, 0.30}, {-2.24, 0.06}, {-1.90, 0.05}}, 0.012, z), CARBON);

  // --- front wing: four elements sweeping up into shaped endplates ---------
  add(fw, at(wing(0.99, 0.46, 0.034, 0.030, -0.10, 0.030), 2.53, 0.085, 0), CARBON);
  add(fw, at(wing(0.97, 0.26, 0.030, 0.030, -0.30, 0.100), 2.40, 0.140, 0), PAINT);
  add(fw, at(wing(0.95, 0.20, 0.026, 0.025, -0.40, 0.150), 2.31, 0.185, 0), CARBON);
  add(fw, at(wing(0.92, 0.15, 0.022, 0.020, -0.50, 0.185), 2.23, 0.225, 0), PAINT2);
  for (double side : {1.0, -1.0})
    add(fw, plate({{2.82, 0.05}, {2.22, 0.05}, {2.16, 0.16}, {2.24, 0.40}, {2.44, 0.44}, {2.64, 0.31}, {2.80, 0.18}}, 0.014, side * 0.985), PAINT);

  // --- rear wing: main plane, DRS flap, endplates; necks, beam wing and
  //     rain light stay with the car (car.js: they are not in wings.rear) ----
  add(rw, at(wing(0.50, 0.19, 0.028, 0.045, 0, 0), -2.60, 0.945, 0), CARBON);
  add(rw, at(wing(0.52, 0.30, 0.036, 0.05, 0, 0), -2.44, 0.845, 0), PAINT);
  for (double side : {1.0, -1.0}) {
    add(rw, plate({{-2.22, 0.58}, {-2.25, 0.92}, {-2.34, 1.01}, {-2.62, 1.03}, {-2.77, 0.97}, {-2.81, 0.70}, {-2.70, 0.56}}, 0.018, side * 0.53), PAINT);
    add(body, rod({-2.10, 0.40, side * 0.07}, {-2.40, 0.80, side * 0.07}, 0.016, 0.5), CARBON);
  }
  add(body, at(wing(0.42, 0.18, 0.028, 0.035, 0, 0.02), -2.30, 0.380, 0), CARBON);
  add(body, at(wing(0.40, 0.13, 0.022, 0.030, 0, 0.02), -2.42, 0.445, 0), CARBON);
  add(body, at(box(0.03, 0.05, 0.12), -2.335, 0.33, 0), RAIN);

  // --- the halo: SOLID. The loop clears the eyes and frames the top of the
  //     view; the centre pillar splits the windscreen. ----------------------
  add(body, tube({{-0.58, 0.58, 0.26}, {-0.40, 0.77, 0.30}, {-0.05, 0.815, 0.26}, {0.20, 0.82, 0.10},
                  {0.23, 0.82, 0}, {0.20, 0.82, -0.10}, {-0.05, 0.815, -0.26}, {-0.40, 0.77, -0.30}, {-0.58, 0.58, -0.26}}, 0.026, 64, 10), CARBON);
  add(body, tube({{0.23, 0.82, 0}, {0.33, 0.67, 0}, {0.43, 0.52, 0}}, 0.028, 12, 10), CARBON);

  // --- the tub, inside: carbon walls with painted outer skins, floor, dash,
  //     rear bulkhead, and a seat -------------------------------------------
  for (double side : {1.0, -1.0}) {
    const std::vector<P2> wall = {{0.24, 0.40}, {0.24, 0.58}, {-0.10, 0.60}, {-0.62, 0.62}, {-0.62, 0.40}};
    add(body, plate(wall, 0.012, side * 0.305), PAINT);
    add(body, plate(wall, 0.012, side * 0.285), CARBON);
  }
  add(body, at(box(0.86, 0.012, 0.58), -0.19, 0.445, 0), CARBON);
  add(body, at(box(0.03, 0.15, 0.58), 0.225, 0.515, 0), CARBON);
  add(body, at(box(0.03, 0.22, 0.58), -0.625, 0.51, 0), CARBON);
  add(body, at(box(0.30, 0.05, 0.44), -0.42, 0.475, 0), FABRIC);
  add(body, at(rotZ(box(0.06, 0.24, 0.44), -0.25), -0.56, 0.60, 0), FABRIC);

  // --- the driver's helmet, in the second colour, and the visor ------------
  add(helm, at(scaled(sphere(0.135, 20, 14), 1.12, 1, 0.94), -0.30, 0.56, 0), PAINT2);
  // (car.js turns this patch with rotateY(+90 deg), which leaves the visor on
  // the helmet's RIGHT cheek. It is meant to face the road, and here it does.)
  add(helm, at(scaled(sphere(0.137, 16, 10, -0.6, 1.2, 0.9, 0.7), 1.12, 1, 0.94), -0.30, 0.56, 0), VISOR);

  // --- where the spec puts it ---------------------------------------------
  Ext e;
  measure(body, e); measure(fw, e); measure(rw, e);
  Warp W;
  W.AF = 1.80; W.AR = -1.80; W.a = S.a; W.b = S.b;
  W.kMid = S.L / (W.AF - W.AR);
  W.kOver = (S.bodyL - S.L) / ((e.x1 - W.AF) + (W.AR - e.x0));
  W.sl = (S.bodyW * 0.5) / e.zmax;
  // F1 is car.js at its own height. A smaller car is smaller in every direction.
  W.sv = S.bodyW < 1.95 ? W.sl : 1.0;

  // --- suspension: wishbones from two chassis pick-ups to the upright, and a
  //     pushrod. The uprights are where THIS class's wheels are (spec track),
  //     not car.js's 1.70 / 1.60 m. ----------------------------------------
  const double R = 0.36;
  for (double side : {1.0, -1.0}) {
    const double cfg[2][4] = {{1.80, S.trackF * 0.5 / W.sl - 0.13, 0.16, 0.20}, {-1.80, S.trackR * 0.5 / W.sl - 0.16, 0.26, 0.20}};
    for (const double *c : {cfg[0], cfg[1]}) {
      const double ax = c[0], hz = side * c[1], chZ = c[2], chY0 = c[3], sg = ax > 0 ? 1 : -1;
      add(body, rod({ax + 0.24, chY0, side * chZ}, {ax, R - 0.10, hz}), CARBONM);
      add(body, rod({ax - 0.24, chY0, side * chZ}, {ax, R - 0.10, hz}), CARBONM);
      add(body, rod({ax + 0.20, chY0 + 0.15, side * (chZ + 0.02)}, {ax - 0.02, R + 0.10, hz}), CARBONM);
      add(body, rod({ax - 0.22, chY0 + 0.15, side * (chZ + 0.02)}, {ax - 0.02, R + 0.10, hz}), CARBONM);
      add(body, rod({ax - 0.05, R - 0.08, hz}, {ax - 0.40 * sg, chY0 + 0.26, side * (chZ - 0.04)}, 0.014, 0.9), CARBONM);
    }
  }

  // --- the livery (livery.js generic(): what every team without a
  //     hand-written one wears). Boxes in car.js's space; later rules win.
  //     Dark lower pods, the second colour as a line down the pods and on
  //     the wing ends. -------------------------------------------------------
  const double ALL = 9;
  for (Soup *s : {&body, &fw, &rw}) {
    liveryRule(*s, PAINT_DK, -1.7, 0.7, 0, 0.36, 0.38, ALL);           // LOWER_PODS
    liveryRule(*s, PAINT2, -1.62, 0.68, 0.40, 0.44, 0.38, ALL);        // POD_STRIPE(0.40, 0.44)
    liveryRule(*s, PAINT2, -3.2, -2.18, 0.96, 1.2, 0.5, ALL);          // RW_TOP
    liveryRule(*s, PAINT2, 2.1, 3.2, 0, 0.5, 0.96, ALL);               // FW_ENDS
  }

  for (Soup *s : {&body, &fw, &rw, &helm}) for (Poly &q : *s) for (V3 &p : q.p) p = W(p);
  emit(M.body, body); emit(M.frontWing, fw); emit(M.rearWing, rw); emit(M.helmet, helm);

  wheelSS(M.wheelF, R, 0.305, W.sv);
  wheelSS(M.wheelR, R, 0.405, W.sv);
  M.wheelRadF = M.wheelRadR = R * W.sv;
  // car.js eye: low and far back, behind the halo, 14 cm under its loop
  const V3 eye = W({-0.22, 0.68, 0});
  M.eye[0] = (float)eye.x; M.eye[1] = (float)eye.y; M.eye[2] = (float)eye.z;
  M.cabin = true;
}

// ---------------------------------------------------------------------------
// A GT3 CAR (car.js buildGT3): closed cockpit, wheels inside arches, a wing
// on swan necks.
// ---------------------------------------------------------------------------
// car.js's arches are closed pods that swallow the wheel whole (22 cm of tyre
// shows under them). Squeezed to the regulation 2.05 m the tyre wall would
// break the skin by a centimetre, so the wheel OPENING is cut out of each
// arch's outer face, the way an arch is. Set false for car.js's closed pods.
const bool GT_WHEEL_OPENINGS = true;

void buildCoupe(const Spec &S, CarMeshes &M) {
  Soup body, fw, rw, helm;
  const double R = 0.34;

  // the tub: the body between the arches
  add(body, loft({
    {2.30, 0.38, 0.62, 0.20, 3.0},      // nose
    {1.70, 0.44, 0.76, 0.30, 3.2},
    {0.95, 0.50, 0.80, 0.39, 3.4},      // scuttle
    {0.10, 0.54, 0.82, 0.44, 3.5},
    {-0.85, 0.54, 0.82, 0.44, 3.5},
    {-1.65, 0.50, 0.80, 0.38, 3.4},
    {-2.20, 0.46, 0.70, 0.30, 3.2},     // tail
    {-2.30, 0.44, 0.60, 0.24, 3.0},
  }), PAINT);
  // greenhouse: screen, roof, rear screen — and the roof panel is painted
  add(body, loft({
    {1.05, 0.74, 0.66, 0.16, 3.6},
    {0.45, 0.94, 0.62, 0.30, 4.0},
    {-0.35, 1.02, 0.60, 0.30, 4.4},
    {-1.00, 0.96, 0.60, 0.28, 4.0},
    {-1.55, 0.74, 0.62, 0.16, 3.6},
  }), GT_GLASS);
  add(body, at(box(1.5, 0.05, 1.12), -0.25, 1.30, 0), PAINT);
  // four arches
  const double arches[4][3] = {{1.50, 0.86, 0}, {1.50, -0.86, 0}, {-1.45, 0.88, 1}, {-1.45, -0.88, 1}};
  for (const double *A : arches) {
    const double ax = A[0], zo = A[1], w = A[2] > 0 ? 0.26 : 0.24;
    add(body, loft({
      {ax + 0.72, 0.42, w, 0.22, 3.2, zo},
      {ax + 0.20, 0.60, w + 0.02, 0.42, 3.4, zo},
      {ax - 0.25, 0.60, w + 0.02, 0.42, 3.4, zo},
      {ax - 0.78, 0.44, w, 0.24, 3.2, zo},
    }), GT_ARCH);
  }
  // splitter (it can be torn off: the coupe's `frontWing`), bumper, diffuser
  add(fw, at(box(0.62, 0.035, 1.98), 2.06, 0.075, 0), CARBON);
  add(body, at(box(0.30, 0.16, 1.90), 2.33, 0.30, 0), CARBON);
  add(body, at(box(1.05, 0.05, 1.70), -1.90, 0.20, 0), CARBON);
  for (double side : {1.0, -1.0}) {
    add(body, at(box(2.2, 0.10, 0.18), 0, 0.22, side * 1.00), CARBON);                    // sill
    add(body, at(box(0.34, 0.16, 0.06), 1.05, 0.92, side * 0.98), GT_MATT, false);        // mirror stalk
    add(body, at(box(0.10, 0.16, 0.28), 1.22, 0.95, side * 1.08), GT_MATT, false);        // mirror
    add(body, at(box(0.10, 0.16, 0.42), 2.24, 0.52, side * 0.52), LAMP);                  // headlamp
  }
  // the wing, on swan necks
  add(rw, at(wing(0.98, 0.34, 0.035, 0.10, -0.18, 0.0), -2.12, 1.26, 0), CARBON);
  for (double side : {1.0, -1.0}) {
    add(rw, at(box(0.34, 0.30, 0.04), -2.02, 1.10, side * 0.62), CARBON);
    add(rw, at(box(0.40, 0.30, 0.03), -2.12, 1.30, side * 0.98), CARBON);
  }

  Ext e;
  measure(body, e); measure(fw, e); measure(rw, e);
  Warp W;
  W.AF = 1.50; W.AR = -1.45; W.a = S.a; W.b = S.b;
  W.kMid = S.L / (W.AF - W.AR);
  W.kOver = (S.bodyL - S.L) / ((e.x1 - W.AF) + (W.AR - e.x0));
  W.sl = (S.bodyW * 0.5) / e.zmax;
  W.sv = 1.0;
  for (Soup *s : {&body, &fw, &rw}) for (Poly &q : *s) for (V3 &p : q.p) p = W(p);

  if (GT_WHEEL_OPENINGS) {
    const double rad = R + 0.05;
    const int N = 20;
    for (const double *A : arches) {
      const double cx = W.fx(A[0]), zc = A[1] * W.sl, sg = zc > 0 ? 1 : -1;
      std::vector<Plane> region = {{0, 0, -sg, -sg * zc}};                 // the outer half only
      region.push_back({A[0] > 0 ? -1.0 : 1.0, 0, 0, (A[0] > 0 ? -1.0 : 1.0) * cx + 1.0});   // this arch, not the other end's
      for (int k = 0; k < N; k++) {
        const double a = 2 * PI_ * k / N;
        region.push_back({std::cos(a), std::sin(a), 0, cx * std::cos(a) + R * std::sin(a) + rad});
      }
      carve(body, region, 2, nullptr);
    }
  }

  emit(M.body, body); emit(M.frontWing, fw); emit(M.rearWing, rw); emit(M.helmet, helm);
  wheelGT(M.wheelF, R, 0.30);
  wheelGT(M.wheelR, R, 0.33);
  M.wheelRadF = M.wheelRadR = R;
  // car.js: "a GT3 driver sits further forward, higher, and on the left" —
  // but its body is a shell with no interior (the tub loft is solid through
  // the cabin and the greenhouse is an opaque closed skin), and js/render.js
  // keeps the roof camera for it. Two-sided faces here make that stricter:
  // this point is INSIDE the tub. Not a cabin.
  const V3 eye = W({0.28, 0.88, -0.34});
  M.eye[0] = (float)eye.x; M.eye[1] = (float)eye.y; M.eye[2] = (float)eye.z;
  M.cabin = false;
}

}  // namespace

CarMeshes buildCarMeshes(const Spec &spec) {
  CarMeshes M;
  if (spec.gt) buildCoupe(spec, M);
  else buildSingleSeater(spec, M);
  return M;
}

}  // namespace xbr
