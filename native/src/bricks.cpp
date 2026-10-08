// bricks.cpp — see bricks.hpp.
#include "bricks.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>

#include "json.hpp"

namespace xbr::bricks {

static const double PI = 3.14159265358979323846;

// ---- the catalogue ------------------------------------------------------------
// The order here is the order of the tray. Sizes are length, height, width.
static const ShapeInfo SHAPES[N_SHAPES] = {
  {"block",   "BLOCK / PLATE",      {STUD, PLATE, STUD}, true, -1},
  {"wedge",   "WEDGE",              {STUD, CUBE, STUD}, true, -1},
  {"wcorner", "WEDGE CORNER",       {STUD, CUBE, STUD}, true, -1},
  {"winner",  "WEDGE INNER CORNER", {STUD, CUBE, STUD}, true, -1},
  {"curve",   "CURVE",              {2 * STUD, CUBE, STUD}, true, -1},
  {"curvein", "CURVE, HOLLOW",      {2 * STUD, CUBE, STUD}, true, -1},
  {"ccorner", "CURVE CORNER",       {2 * STUD, CUBE, 2 * STUD}, true, -1},
  {"round",   "ROUND",              {STUD, BRICK, STUD}, true, -1},
  {"cone",    "CONE",               {STUD, BRICK, STUD}, true, -1},
  {"arch",    "WHEEL ARCH",         {4 * STUD, BRICK, STUD}, true, -1},
  {"screen",  "WINDSHIELD",         {3 * STUD, 2 * BRICK - 4, 6 * STUD}, true, GLASS},
  {"wing",    "WING",               {2 * STUD, PLATE, 8 * STUD}, true, CARBON},
  {"wheel",   "WHEEL",              {28, 28, 12}, true, CHROME},
  {"seat",    "SEAT",               {20, 36, 20}, false, CARBON},
  {"lampr",   "HEADLIGHT, ROUND",   {4, 8, 8}, true, LIGHT},
  {"lamps",   "LIGHT, SQUARE",      {4, PLATE, STUD}, true, LIGHT},
};
const ShapeInfo &info(int shape) { return SHAPES[std::clamp(shape, 0, N_SHAPES - 1)]; }
int shapeById(const std::string &id) {
  for (int i = 0; i < N_SHAPES; i++) if (id == SHAPES[i].id) return i;
  return -1;
}
static const char *MATS[N_MATS] = {"paint", "matte", "glass", "chrome", "light", "carbon", "rubber", "line"};
const char *matName(int mat) { return MATS[std::clamp(mat, 0, N_MATS - 1)]; }

// Power and the mass of everything that is not bodywork. The footprint is a
// guide drawn on the plate. NOT YET CHECKED AGAINST THE SIM'S OWN CARS: these
// are round figures for each kind of car, here so the readout means something.
const Klass KLASSES[] = {
  {"gt3",    "GT3",       410e3,  950, 4.60, 2.00, 2.70},
  {"gt4",    "GT4",       320e3, 1050, 4.50, 1.95, 2.60},
  {"911",    "911",       375e3,  930, 4.55, 1.95, 2.45},
  {"hyper",  "HYPERCAR",  520e3,  780, 4.90, 2.00, 3.10},
  {"rally",  "RALLY",     280e3,  900, 4.20, 1.85, 2.55},
  {"f1",     "F1",        735e3,  560, 5.60, 2.00, 3.60},
  {"nascar", "NASCAR",    500e3, 1150, 4.95, 2.00, 2.80},
  {"baja",   "BAJA",      330e3, 1400, 5.40, 2.25, 3.20},
};
const int N_KLASSES = (int)(sizeof(KLASSES) / sizeof(KLASSES[0]));
int klassById(const std::string &id) {
  for (int i = 0; i < N_KLASSES; i++) if (id == KLASSES[i].id) return i;
  return -1;
}

// ---- turning --------------------------------------------------------------------
void Piece::dims(int d[3]) const {
  for (int i = 0; i < 3; i++) d[i] = std::abs(r[i * 3]) * s[0] + std::abs(r[i * 3 + 1]) * s[1] + std::abs(r[i * 3 + 2]) * s[2];
}
bool Piece::operator==(const Piece &o) const {
  if (shape != o.shape || flip != o.flip || col != o.col || mat != o.mat) return false;
  for (int i = 0; i < 3; i++) if (s[i] != o.s[i] || p[i] != o.p[i]) return false;
  for (int i = 0; i < 9; i++) if (r[i] != o.r[i]) return false;
  return true;
}
static void mul3(const int a[9], const int b[9], int out[9]) {
  int t[9];
  for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) t[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  for (int i = 0; i < 9; i++) out[i] = t[i];
}
void turn(Piece &p, int axis, int quarters) {
  static const int Q[3][9] = {
    {1, 0, 0, 0, 0, -1, 0, 1, 0},     // about x
    {0, 0, 1, 0, 1, 0, -1, 0, 0},     // about y
    {0, -1, 0, 1, 0, 0, 0, 0, 1},     // about z
  };
  quarters = ((quarters % 4) + 4) % 4;
  for (int k = 0; k < quarters; k++) mul3(Q[axis], p.r, p.r);
}
Piece mirrored(const Piece &p) {
  Piece m = p;
  // M R M, with M = diag(1, 1, -1): negate the z row and the z column.
  for (int i = 0; i < 3; i++) { m.r[6 + i] = -m.r[6 + i]; }
  for (int i = 0; i < 3; i++) { m.r[i * 3 + 2] = -m.r[i * 3 + 2]; }
  m.flip = !p.flip;
  int d[3];
  p.dims(d);
  m.p[2] = -(p.p[2] + d[2]);
  return m;
}

// ---- the shapes -------------------------------------------------------------------
struct V3 { double x, y, z; };
static V3 sub(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
static double dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V3 norm(V3 a) { const double l = std::sqrt(dot(a, a)); return l > 1e-12 ? V3{a.x / l, a.y / l, a.z / l} : V3{0, 1, 0}; }

// Shapes are written in the piece's own box, 0..L, 0..H, 0..W, and nobody has
// to think about which way a triangle winds: a flat face is turned to point
// away from `centre` (every part here is convex, or is told its normals), and
// a curved one is turned to agree with the normals it was given.
struct Emit {
  std::vector<float> *out;
  const Piece *pc;
  double T[3];
  V3 centre{0, 0, 0};
  float col[3] = {1, 1, 1};
  float mat = 0;
  void use(unsigned rgb, int m) {
    col[0] = ((rgb >> 16) & 255) / 255.0f; col[1] = ((rgb >> 8) & 255) / 255.0f; col[2] = (rgb & 255) / 255.0f;
    mat = (float)m;
  }
  void put(V3 v, V3 n) {
    const Piece &P = *pc;
    if (P.flip) { v.z = P.s[2] - v.z; n.z = -n.z; }
    const double w[3] = {
      (P.r[0] * v.x + P.r[1] * v.y + P.r[2] * v.z + T[0]) * UNIT,
      (P.r[3] * v.x + P.r[4] * v.y + P.r[5] * v.z + T[1]) * UNIT,
      (P.r[6] * v.x + P.r[7] * v.y + P.r[8] * v.z + T[2]) * UNIT};
    const double m[3] = {P.r[0] * n.x + P.r[1] * n.y + P.r[2] * n.z, P.r[3] * n.x + P.r[4] * n.y + P.r[5] * n.z, P.r[6] * n.x + P.r[7] * n.y + P.r[8] * n.z};
    for (double c : w) out->push_back((float)c);
    for (double c : m) out->push_back((float)c);
    out->push_back(col[0]); out->push_back(col[1]); out->push_back(col[2]); out->push_back(mat);
  }
  void tri(V3 a, V3 b, V3 c, const V3 *na = nullptr, const V3 *nb = nullptr, const V3 *nc = nullptr) {
    V3 g = cross(sub(b, a), sub(c, a));
    if (dot(g, g) < 1e-14) return;
    g = norm(g);
    bool swap;
    V3 A, B, C;
    if (na) {
      A = norm(*na); B = norm(*nb); C = norm(*nc);
      swap = dot(g, V3{A.x + B.x + C.x, A.y + B.y + C.y, A.z + B.z + C.z}) < 0;
    } else {
      const V3 mid{(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3};
      swap = dot(g, sub(mid, centre)) < 0;
      if (swap) g = V3{-g.x, -g.y, -g.z};
      A = B = C = g;
    }
    if (swap != pc->flip) { put(a, A); put(c, C); put(b, B); }
    else { put(a, A); put(b, B); put(c, C); }
  }
  void quad(V3 a, V3 b, V3 c, V3 d) { tri(a, b, c); tri(a, c, d); }
  void quadN(V3 a, V3 b, V3 c, V3 d, V3 na, V3 nb, V3 nc, V3 nd) { tri(a, b, c, &na, &nb, &nc); tri(a, c, d, &na, &nc, &nd); }
  void box(double x0, double x1, double y0, double y1, double z0, double z1) {
    centre = {(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2};
    quad({x0, y0, z0}, {x1, y0, z0}, {x1, y0, z1}, {x0, y0, z1});
    quad({x0, y1, z0}, {x1, y1, z0}, {x1, y1, z1}, {x0, y1, z1});
    quad({x0, y0, z0}, {x1, y0, z0}, {x1, y1, z0}, {x0, y1, z0});
    quad({x0, y0, z1}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1});
    quad({x0, y0, z0}, {x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0});
    quad({x1, y0, z0}, {x1, y0, z1}, {x1, y1, z1}, {x1, y1, z0});
  }
  // A side profile (x, y) pushed through the width, capped at both ends. The
  // profile must be star-shaped about (ox, oy). `smooth` gives the skin the
  // normals of a curve instead of one facet at a time.
  void extrude(const std::vector<V3> &prof, double z0, double z1, double ox, double oy, bool closed = true) {
    const size_t n = prof.size();
    for (size_t i = 0; i + (closed ? 0 : 1) < n; i++) {
      const V3 a = prof[i], b = prof[(i + 1) % n];
      quad({a.x, a.y, z0}, {b.x, b.y, z0}, {b.x, b.y, z1}, {a.x, a.y, z1});
    }
    for (size_t i = 0; i < n; i++) {
      const V3 a = prof[i], b = prof[(i + 1) % n];
      tri({ox, oy, z0}, {a.x, a.y, z0}, {b.x, b.y, z0});
      tri({ox, oy, z1}, {a.x, a.y, z1}, {b.x, b.y, z1});
    }
  }
};

static const unsigned RUBBER_RGB = 0x17181b, HOUSING_RGB = 0x1b1c1f, CHROME_RGB = 0xc9ccd1;

static void shape(const Piece &P, Emit &E) {
  const double L = P.s[0], H = P.s[1], W = P.s[2];
  E.centre = {L / 2, H / 2, W / 2};
  E.use(P.col, P.mat);
  const int SEG = 10;
  switch (P.shape) {
    case BLOCK: E.box(0, L, 0, H, 0, W); break;
    case WEDGE:           // tall at the back (x = 0), down to nothing at the front
      E.centre = {L / 3, H / 3, W / 2};
      E.quad({0, 0, 0}, {L, 0, 0}, {L, 0, W}, {0, 0, W});
      E.quad({0, 0, 0}, {0, 0, W}, {0, H, W}, {0, H, 0});
      E.quad({0, H, 0}, {0, H, W}, {L, 0, W}, {L, 0, 0});
      E.tri({0, 0, 0}, {L, 0, 0}, {0, H, 0});
      E.tri({0, 0, W}, {L, 0, W}, {0, H, W});
      break;
    case WEDGE_CORNER:    // the outside corner where two wedges meet: a peak at one corner
      E.centre = {L / 4, H / 4, W / 4};
      E.quad({0, 0, 0}, {L, 0, 0}, {L, 0, W}, {0, 0, W});
      E.tri({0, H, 0}, {0, 0, 0}, {L, 0, 0});
      E.tri({0, H, 0}, {0, 0, W}, {0, 0, 0});
      E.tri({0, H, 0}, {L, 0, 0}, {L, 0, W});
      E.tri({0, H, 0}, {L, 0, W}, {0, 0, W});
      break;
    case WEDGE_INNER:     // the inside corner: full height but for one corner, a valley between
      E.centre = {L * 0.4, H * 0.3, W * 0.4};
      E.quad({0, 0, 0}, {L, 0, 0}, {L, 0, W}, {0, 0, W});
      E.quad({0, 0, 0}, {L, 0, 0}, {L, H, 0}, {0, H, 0});
      E.quad({0, 0, 0}, {0, 0, W}, {0, H, W}, {0, H, 0});
      E.tri({L, 0, 0}, {L, 0, W}, {L, H, 0});
      E.tri({0, 0, W}, {L, 0, W}, {0, H, W});
      E.tri({0, H, 0}, {L, H, 0}, {L, 0, W});
      E.tri({0, H, 0}, {L, 0, W}, {0, H, W});
      break;
    case CURVE: case CURVE_IN: {
      // CURVE bulges (a bonnet's leading edge); CURVE_IN is hollowed (a fillet).
      const bool in = P.shape == CURVE_IN;
      E.centre = in ? V3{L * 0.2, H * 0.2, W / 2} : V3{L * 0.4, H * 0.4, W / 2};
      E.quad({0, 0, 0}, {L, 0, 0}, {L, 0, W}, {0, 0, W});
      E.quad({0, 0, 0}, {0, 0, W}, {0, H, W}, {0, H, 0});
      for (int i = 0; i < SEG; i++) {
        V3 a[2], n[2];
        for (int k = 0; k < 2; k++) {
          const double t = (i + k) * (PI / 2) / SEG, c = std::cos(t), s = std::sin(t);
          a[k] = in ? V3{L * (1 - c), H * (1 - s), 0} : V3{L * s, H * c, 0};
          n[k] = in ? V3{c / L, s / H, 0} : V3{s / L, c / H, 0};
        }
        E.quadN({a[0].x, a[0].y, 0}, {a[1].x, a[1].y, 0}, {a[1].x, a[1].y, W}, {a[0].x, a[0].y, W}, n[0], n[1], n[1], n[0]);
        E.tri({0, 0, 0}, {a[0].x, a[0].y, 0}, {a[1].x, a[1].y, 0});
        E.tri({0, 0, W}, {a[0].x, a[0].y, W}, {a[1].x, a[1].y, W});
      }
      break;
    }
    case CURVE_CORNER: {  // an eighth of a ball: the rounded outside corner
      E.centre = {L * 0.3, H * 0.3, W * 0.3};
      auto at = [&](int i, int j, V3 &n) {
        const double t = i * (PI / 2) / SEG, f = j * (PI / 2) / SEG;
        const V3 u{std::sin(t) * std::cos(f), std::cos(t), std::sin(t) * std::sin(f)};
        n = {u.x / L, u.y / H, u.z / W};
        return V3{L * u.x, H * u.y, W * u.z};
      };
      for (int i = 0; i < SEG; i++) for (int j = 0; j < SEG; j++) {
        V3 n0, n1, n2, n3;
        const V3 a = at(i, j, n0), b = at(i + 1, j, n1), c = at(i + 1, j + 1, n2), d = at(i, j + 1, n3);
        E.quadN(a, b, c, d, n0, n1, n2, n3);
      }
      for (int i = 0; i < SEG; i++) {
        V3 n;
        E.tri({0, 0, 0}, at(i, 0, n), at(i + 1, 0, n));           // the flat side on z = 0
        E.tri({0, 0, 0}, at(i, SEG, n), at(i + 1, SEG, n));       // and on x = 0
        E.tri({0, 0, 0}, at(SEG, i, n), at(SEG, i + 1, n));       // the base
      }
      break;
    }
    case ROUND: case CONE: {
      const int N = 20;
      const bool cone = P.shape == CONE;
      if (cone) E.centre = {L / 2, H / 4, W / 2};
      for (int i = 0; i < N; i++) {
        const double a0 = i * 2 * PI / N, a1 = (i + 1) * 2 * PI / N;
        const V3 n0{std::cos(a0) / L, cone ? 0.5 / H : 0, std::sin(a0) / W}, n1{std::cos(a1) / L, cone ? 0.5 / H : 0, std::sin(a1) / W};
        const V3 b0{L / 2 + L / 2 * std::cos(a0), 0, W / 2 + W / 2 * std::sin(a0)}, b1{L / 2 + L / 2 * std::cos(a1), 0, W / 2 + W / 2 * std::sin(a1)};
        E.tri({L / 2, 0, W / 2}, b0, b1);
        if (cone) E.tri({L / 2, H, W / 2}, b0, b1, &n0, &n0, &n1);
        else {
          E.quadN(b0, b1, {b1.x, H, b1.z}, {b0.x, H, b0.z}, n0, n1, n1, n0);
          E.tri({L / 2, H, W / 2}, {b0.x, H, b0.z}, {b1.x, H, b1.z});
        }
      }
      break;
    }
    case ARCH: {          // a block with a wheel's worth cut out from underneath
      const double a = L * 0.40, b = std::min(H * 0.78, H - 1.0), cx = L / 2;
      E.quad({0, H, 0}, {L, H, 0}, {L, H, W}, {0, H, W});
      E.quad({0, 0, 0}, {0, 0, W}, {0, H, W}, {0, H, 0});
      E.quad({L, 0, 0}, {L, 0, W}, {L, H, W}, {L, H, 0});
      E.quad({0, 0, 0}, {cx - a, 0, 0}, {cx - a, 0, W}, {0, 0, W});
      E.quad({cx + a, 0, 0}, {L, 0, 0}, {L, 0, W}, {cx + a, 0, W});
      for (double z : {0.0, W}) {
        E.quad({0, 0, z}, {cx - a, 0, z}, {cx - a, H, z}, {0, H, z});
        E.quad({cx + a, 0, z}, {L, 0, z}, {L, H, z}, {cx + a, H, z});
      }
      const int N = 16;
      for (int i = 0; i < N; i++) {
        const double t0 = i * PI / N, t1 = (i + 1) * PI / N;
        const V3 q0{cx + a * std::cos(t0), b * std::sin(t0), 0}, q1{cx + a * std::cos(t1), b * std::sin(t1), 0};
        const V3 n0{-std::cos(t0) / a, -std::sin(t0) / b, 0}, n1{-std::cos(t1) / a, -std::sin(t1) / b, 0};
        E.quadN({q0.x, q0.y, 0}, {q1.x, q1.y, 0}, {q1.x, q1.y, W}, {q0.x, q0.y, W}, n0, n1, n1, n0);
        for (double z : {0.0, W}) E.quad({q0.x, q0.y, z}, {q1.x, q1.y, z}, {q1.x, H, z}, {q0.x, H, z});
      }
      break;
    }
    case SCREEN: {        // a raked sheet: foot at the front, top edge at the back
      const double t = std::min(1.5, L * 0.3);
      E.extrude({{L, 0, 0}, {t, H, 0}, {0, H, 0}, {L - t, 0, 0}}, 0, W, L / 2, H / 2);
      break;
    }
    case WING: {          // an aerofoil across the width, leading edge forward
      std::vector<V3> up, lo;
      const int N = 12;
      for (int i = 0; i <= N; i++) {
        const double t = (double)i / N;
        const double half = 5 * H * (0.2969 * std::sqrt(t) - 0.1260 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
        up.push_back({L * (1 - t), H / 2 + half, 0});
        lo.push_back({L * (1 - t), H / 2 - half, 0});
      }
      std::vector<V3> prof(up.begin(), up.end());
      for (int i = N - 1; i > 0; i--) prof.push_back(lo[i]);
      E.extrude(prof, 0, W, L * 0.6, H / 2);
      break;
    }
    case WHEEL: {         // the axle runs across the width; the tyre is rubber, the rim is yours
      const double R = L / 2, cx = L / 2, cy = L / 2, rr = R * 0.64, inset = std::min(W * 0.22, 2.5);
      const int N = 28;
      auto ring = [&](double rad, double a) { return V3{cx + rad * std::cos(a), cy + rad * std::sin(a), 0}; };
      for (int i = 0; i < N; i++) {
        const double a0 = i * 2 * PI / N, a1 = (i + 1) * 2 * PI / N;
        const V3 n0{std::cos(a0), std::sin(a0), 0}, n1{std::cos(a1), std::sin(a1), 0};
        const V3 o0 = ring(R, a0), o1 = ring(R, a1), s0 = ring(R * 0.94, a0), s1 = ring(R * 0.94, a1), i0 = ring(rr, a0), i1 = ring(rr, a1);
        const double sh = std::min(1.2, W * 0.12);
        E.use(RUBBER_RGB, RUBBER);
        E.centre = {cx, cy, W / 2};
        E.quadN({o0.x, o0.y, sh}, {o1.x, o1.y, sh}, {o1.x, o1.y, W - sh}, {o0.x, o0.y, W - sh}, n0, n1, n1, n0);   // tread
        for (int k = 0; k < 2; k++) {
          const double z = k ? W : 0, zs = k ? W - sh : sh;
          E.quad({o0.x, o0.y, zs}, {o1.x, o1.y, zs}, {s1.x, s1.y, z}, {s0.x, s0.y, z});       // shoulder
          E.quad({s0.x, s0.y, z}, {s1.x, s1.y, z}, {i1.x, i1.y, z}, {i0.x, i0.y, z});         // sidewall
        }
        E.use(P.col, P.mat);
        for (int k = 0; k < 2; k++) {
          const double z = k ? W : 0, zi = k ? W - inset : inset;
          E.centre = {cx, cy, k ? W + 50 : -50};       // the barrel faces the axle, the dish faces out
          const V3 m0{-n0.x, -n0.y, 0}, m1{-n1.x, -n1.y, 0};
          E.quadN({i0.x, i0.y, z}, {i1.x, i1.y, z}, {i1.x, i1.y, zi}, {i0.x, i0.y, zi}, m0, m1, m1, m0);
          E.centre = {cx, cy, W / 2};
          const bool spoke = (i % 4) < 2;              // seven spokes, the gaps a shade darker
          if (!spoke) E.use(HOUSING_RGB, MATTE);
          E.tri({cx, cy, zi}, {i0.x, i0.y, zi}, {i1.x, i1.y, zi});
          if (!spoke) E.use(P.col, P.mat);
        }
      }
      break;
    }
    case SEAT: {          // facing forward
      const double bz = W * 0.14;
      E.box(L * 0.10, L, 0, H * 0.20, 0, W);                       // squab
      E.box(0, L * 0.26, 0, H * 0.82, 0, W);                       // back
      E.box(0, L * 0.22, H * 0.82, H, W * 0.24, W * 0.76);         // headrest
      E.box(L * 0.2, L * 0.9, H * 0.2, H * 0.36, 0, bz);           // bolsters
      E.box(L * 0.2, L * 0.9, H * 0.2, H * 0.36, W - bz, W);
      E.box(L * 0.2, L * 0.34, H * 0.36, H * 0.74, 0, bz);
      E.box(L * 0.2, L * 0.34, H * 0.36, H * 0.74, W - bz, W);
      break;
    }
    case LAMP_ROUND: {    // looks forward: a bright ring, the lens in your colour
      const int N = 20;
      const double cy = H / 2, cz = W / 2;
      for (int i = 0; i < N; i++) {
        const double a0 = i * 2 * PI / N, a1 = (i + 1) * 2 * PI / N;
        auto pt = [&](double k, double a, double x) { return V3{x, cy + k * H / 2 * std::cos(a), cz + k * W / 2 * std::sin(a)}; };
        const V3 n0{0, std::cos(a0) / H, std::sin(a0) / W}, n1{0, std::cos(a1) / H, std::sin(a1) / W};
        E.use(CHROME_RGB, CHROME);
        E.quadN(pt(1, a0, 0), pt(1, a1, 0), pt(1, a1, L), pt(1, a0, L), n0, n1, n1, n0);
        E.tri({0, cy, cz}, pt(1, a0, 0), pt(1, a1, 0));
        E.quad(pt(1, a0, L), pt(1, a1, L), pt(0.8, a1, L), pt(0.8, a0, L));
        E.use(P.col, P.mat);
        const V3 f{1, 0, 0}, g0{1, 0.5 * std::cos(a0), 0.5 * std::sin(a0)}, g1{1, 0.5 * std::cos(a1), 0.5 * std::sin(a1)};
        E.tri({L * 1.12, cy, cz}, pt(0.8, a0, L), pt(0.8, a1, L), &f, &g0, &g1);     // a domed lens
      }
      break;
    }
    case LAMP_SQUARE: {
      E.use(HOUSING_RGB, MATTE);
      E.box(0, L * 0.7, 0, H, 0, W);
      E.use(P.col, P.mat);
      E.box(L * 0.7, L, H * 0.08, H * 0.92, W * 0.04, W * 0.96);
      break;
    }
    default: E.box(0, L, 0, H, 0, W);
  }
}

void mesh(const Piece &P, std::vector<float> &out) {
  Emit E;
  E.out = &out;
  E.pc = &P;
  // Turned about its own corner, the box lands somewhere; slide it so its low
  // corner is where the piece says it is.
  for (int i = 0; i < 3; i++) {
    double lo = 0;
    for (int j = 0; j < 3; j++) lo += std::min(0, P.r[i * 3 + j] * P.s[j]);
    E.T[i] = P.p[i] - lo;
  }
  shape(P, E);
}

// ---- the file ---------------------------------------------------------------------
bool Car::save(const std::string &path) const {
  const std::string tmp = path + ".tmp";
  FILE *f = std::fopen(tmp.c_str(), "w");
  if (!f) return false;
  std::fprintf(f, "{\"v\":1,\"name\":\"%s\",\"class\":\"%s\",\"unit\":%.3f,\n\"pieces\":[\n", name.c_str(), KLASSES[klass].id, UNIT);
  for (size_t i = 0; i < pieces.size(); i++) {
    const Piece &p = pieces[i];
    std::fprintf(f, "{\"t\":\"%s\",\"s\":[%d,%d,%d],\"p\":[%d,%d,%d],\"r\":[%d,%d,%d,%d,%d,%d,%d,%d,%d],\"f\":%d,\"c\":\"%06x\",\"m\":\"%s\"}%s\n",
                 info(p.shape).id, p.s[0], p.s[1], p.s[2], p.p[0], p.p[1], p.p[2],
                 p.r[0], p.r[1], p.r[2], p.r[3], p.r[4], p.r[5], p.r[6], p.r[7], p.r[8],
                 p.flip ? 1 : 0, p.col & 0xffffff, matName(p.mat), i + 1 < pieces.size() ? "," : "");
  }
  std::fprintf(f, "]}\n");
  const bool ok = std::fclose(f) == 0;
  return ok && std::rename(tmp.c_str(), path.c_str()) == 0;   // never leave half a car on disk
}

bool Car::load(const std::string &path) {
  const Json j = Json::loadOpt(path);
  if (!j.isObj() || !j["pieces"].isArr()) return false;
  Car c;
  c.name = j["name"].s(name);
  c.klass = std::max(0, klassById(j["class"].s("gt3")));
  for (const Json &q : j["pieces"].arr) {
    Piece p;
    p.shape = shapeById(q["t"].s());
    if (p.shape < 0) continue;                 // a piece from a newer catalogue: leave it out, keep the rest
    for (int i = 0; i < 3; i++) { p.s[i] = std::max(1, (int)q["s"][(size_t)i].n(STUD)); p.p[i] = (int)q["p"][(size_t)i].n(); }
    if (q["r"].size() == 9) for (int i = 0; i < 9; i++) p.r[i] = (int)q["r"][(size_t)i].n();
    p.flip = q["f"].truthy();
    p.col = (unsigned)std::strtoul(q["c"].s("d8352a").c_str(), nullptr, 16) & 0xffffff;
    p.mat = PAINT;
    for (int m = 0; m < N_FINISH; m++) if (q["m"].s() == MATS[m]) p.mat = m;
    c.pieces.push_back(p);
  }
  *this = c;
  return true;
}

// ---- what it adds up to -------------------------------------------------------------
// How much of its box a shape fills.
static double fill(const Piece &p) {
  switch (p.shape) {
    case WEDGE: return 0.5;
    case WEDGE_CORNER: return 1.0 / 3;
    case WEDGE_INNER: return 2.0 / 3;
    case CURVE: return PI / 4;
    case CURVE_IN: return 1 - PI / 4;
    case CURVE_CORNER: return PI / 6;
    case ROUND: return PI / 4;
    case CONE: return PI / 12;
    case ARCH: return 0.55;
    case SCREEN: return 0.12;
    case WING: return 0.6;
    case SEAT: return 0.3;
    case LAMP_ROUND: case LAMP_SQUARE: return 0.5;
    default: return 1;
  }
}

Stats derive(const Car &car) {
  Stats S;
  S.pieces = (int)car.pieces.size();
  const Klass &K = KLASSES[std::clamp(car.klass, 0, N_KLASSES - 1)];
  if (car.pieces.empty()) { S.note = "nothing built yet"; return S; }

  // Bodywork is a shell, not a casting: 150 kg for each cubic metre a piece
  // fills. Glass is heavier, a wheel is weighed by its size.
  const double RHO = 150;
  double lo[3] = {1e9, 1e9, 1e9}, hi[3] = {-1e9, -1e9, -1e9};
  double m = 0, mx = 0, my = 0, mz = 0;
  struct Wh { double x, y, z, r; };
  std::vector<Wh> wheels;
  std::vector<float> tris;
  for (const Piece &p : car.pieces) {
    int d[3];
    p.dims(d);
    const double c[3] = {(p.p[0] + d[0] / 2.0) * UNIT, (p.p[1] + d[1] / 2.0) * UNIT, (p.p[2] + d[2] / 2.0) * UNIT};
    for (int i = 0; i < 3; i++) { lo[i] = std::min(lo[i], p.p[i] * UNIT); hi[i] = std::max(hi[i], (p.p[i] + d[i]) * UNIT); }
    double pm;
    if (p.shape == WHEEL) {
      const double r = p.s[0] / 2.0 * UNIT, w = p.s[2] * UNIT;
      pm = 260 * PI * r * r * w;                      // ~21 kg for a 0.34 m x 0.30 m GT wheel and tyre
      if (p.r[8] != 0) wheels.push_back({c[0], c[1], c[2], r});   // its axle lies across the car
    } else {
      pm = d[0] * d[1] * d[2] * UNIT * UNIT * UNIT * fill(p) * (p.mat == GLASS ? 3 * RHO : RHO);
    }
    m += pm; mx += pm * c[0]; my += pm * c[1]; mz += pm * c[2];
    mesh(p, tris);
    if (p.shape == WING && p.r[4] != 0) S.wingArea += p.s[0] * p.s[2] * UNIT * UNIT;   // only a wing lying flat is a wing
  }
  S.wheels = (int)wheels.size();
  S.len = hi[0] - lo[0]; S.wid = hi[2] - lo[2]; S.hgt = hi[1] - lo[1];

  // The engine, driveline, cage and driver, low and between the axles.
  double ax0 = (lo[0] + hi[0]) / 2, ax1 = ax0;
  if (wheels.size() >= 2) {
    ax0 = 1e9; ax1 = -1e9;
    for (const Wh &w : wheels) { ax0 = std::min(ax0, w.x); ax1 = std::max(ax1, w.x); }
  }
  const double bx = ax0 + (ax1 - ax0) * 0.45, by = lo[1] + 0.32;
  m += K.base; mx += K.base * bx; my += K.base * by;
  S.mass = m;
  S.cg[0] = mx / m; S.cg[1] = my / m - lo[1]; S.cg[2] = mz / m;

  // THE AIR. Look at the car from dead ahead on a 2.5 cm grid and keep, for
  // every square, the surface the air meets FIRST. The squares covered are the
  // frontal area. Each one's slope says how hard the air pushes on it: square
  // on, the full ram pressure; laid back, the square of the cosine of it
  // (Newton's own rule for a stream hitting a plate — crude, and exactly as
  // crude as the pieces are). The push has a vertical part too: a surface
  // that leans back is pressed DOWN, one that leans forward is lifted.
  const int GY = (int)std::ceil(S.hgt / UNIT) + 2, GZ = (int)std::ceil(S.wid / UNIT) + 2;
  std::vector<float> depth((size_t)GY * GZ, -1e9f), nx((size_t)GY * GZ, 0), ny((size_t)GY * GZ, 0);
  for (size_t t = 0; t + 29 < tris.size(); t += 30) {
    const float *a = &tris[t], *b = &tris[t + 10], *c = &tris[t + 20];
    const double y0 = (a[1] - lo[1]) / UNIT, z0 = (a[2] - lo[2]) / UNIT, y1 = (b[1] - lo[1]) / UNIT, z1 = (b[2] - lo[2]) / UNIT, y2 = (c[1] - lo[1]) / UNIT, z2 = (c[2] - lo[2]) / UNIT;
    const double den = (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0);
    if (std::fabs(den) < 1e-9) continue;
    const int iy0 = std::max(0, (int)std::floor(std::min({y0, y1, y2}))), iy1 = std::min(GY - 1, (int)std::ceil(std::max({y0, y1, y2})));
    const int iz0 = std::max(0, (int)std::floor(std::min({z0, z1, z2}))), iz1 = std::min(GZ - 1, (int)std::ceil(std::max({z0, z1, z2})));
    for (int iy = iy0; iy <= iy1; iy++) for (int iz = iz0; iz <= iz1; iz++) {
      const double py = iy + 0.5, pz = iz + 0.5;
      const double u = ((py - y0) * (z2 - z0) - (y2 - y0) * (pz - z0)) / den, v = ((y1 - y0) * (pz - z0) - (py - y0) * (z1 - z0)) / den;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const float x = (float)(a[0] + u * (b[0] - a[0]) + v * (c[0] - a[0]));
      const size_t k = (size_t)iy * GZ + iz;
      if (x > depth[k]) {
        depth[k] = x;
        nx[k] = (float)(a[3] + u * (b[3] - a[3]) + v * (c[3] - a[3]));
        ny[k] = (float)(a[4] + u * (b[4] - a[4]) + v * (c[4] - a[4]));
      }
    }
  }
  double cells = 0, press = 0, down = 0;
  for (size_t k = 0; k < depth.size(); k++) {
    if (depth[k] < -1e8f) continue;
    cells += 1;
    const double n = std::max(0.0f, nx[k]);
    press += n * n;
    down += n * ny[k];
  }
  const double cell = UNIT * UNIT;
  S.frontal = cells * cell;
  const double shapeCd = cells > 0 ? press / cells : 1;
  // 0.16 of every car's drag is its wake and its skin, however sharp the nose.
  S.cd = 0.16 + 0.84 * shapeCd;
  // A wing lying flat: 1.7 of lift for its area, and a tenth of that in drag.
  S.cdA = S.frontal * S.cd + S.wingArea * 0.17;
  S.clA = down * cell + S.wingArea * 1.7;

  // THE WHEELS: the front axle is the one further forward.
  if (wheels.size() < 4) S.note = wheels.empty() ? "no wheels yet" : "needs four wheels, axles across the car";
  else {
    const double midx = (ax0 + ax1) / 2;
    double fz0 = 1e9, fz1 = -1e9, rz0 = 1e9, rz1 = -1e9, rs = 0;
    for (const Wh &w : wheels) {
      rs += w.r;
      if (w.x > midx) { fz0 = std::min(fz0, w.z); fz1 = std::max(fz1, w.z); }
      else { rz0 = std::min(rz0, w.z); rz1 = std::max(rz1, w.z); }
    }
    S.wheelbase = ax1 - ax0;
    S.trackF = std::max(0.0, fz1 - fz0); S.trackR = std::max(0.0, rz1 - rz0);
    S.wheelR = rs / wheels.size();
    if (S.wheelbase > 0.2) S.frontWeight = std::clamp((S.cg[0] - ax0) / S.wheelbase, 0.0, 1.0);
    if (S.wheelbase < 1.0) S.note = "the axles are too close together";
    else if (S.trackF < 0.8 || S.trackR < 0.8) S.note = "each axle needs a wheel on both sides";
  }
  if (S.cdA > 1e-6) S.vmax = std::cbrt(2 * K.power * 0.86 / (1.225 * S.cdA));   // 14% lost between engine and road
  return S;
}

}  // namespace xbr::bricks
