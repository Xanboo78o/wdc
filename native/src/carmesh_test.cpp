// carmesh_test.cpp — checks carmesh.cpp without a GPU or a window.
// Needs only MeshB::vert / MeshB::tri from render.cpp (link build/render.o).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "carmesh.hpp"

using namespace xbr;

struct BB { double lo[3] = {1e9, 1e9, 1e9}, hi[3] = {-1e9, -1e9, -1e9}; };
// MeshB stores GL (x, z_sim, -y_sim); back to sim.
static void simv(const MeshB &m, size_t i, double p[3]) { p[0] = m.v[i * 10]; p[1] = -m.v[i * 10 + 2]; p[2] = m.v[i * 10 + 1]; }
static void grow(BB &b, const MeshB &m, double zBelow = 1e9) {
  for (size_t i = 0; i < m.count(); i++) {
    double p[3]; simv(m, i, p);
    if (p[2] > zBelow) continue;
    for (int k = 0; k < 3; k++) { b.lo[k] = std::min(b.lo[k], p[k]); b.hi[k] = std::max(b.hi[k], p[k]); }
  }
}

struct Grid {
  int W = 100, H = 30;
  double u0, v1, du, dv;
  std::vector<std::string> g;
  Grid(double u0_, double u1_, double v1_) : u0(u0_), v1(v1_) { du = (u1_ - u0_) / W; dv = du * 2.0; g.assign(H, std::string(W, ' ')); }
  void put(double u, double v, char c) {
    const int x = (int)std::floor((u - u0) / du), y = (int)std::floor((v1 - v) / dv);
    if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c;
  }
  // every triangle, sampled finely enough to fill its cells
  void mesh(const MeshB &m, int ax, int ay, char c, double ox = 0, double oy = 0, double oz = 0) {
    const double off[3] = {ox, oy, oz};
    for (size_t t = 0; t + 2 < m.count(); t += 3) {
      double a[3], b[3], d[3]; simv(m, t, a); simv(m, t + 1, b); simv(m, t + 2, d);
      double span = 0;
      for (int k = 0; k < 3; k++) span = std::max({span, std::fabs(b[k] - a[k]), std::fabs(d[k] - a[k])});
      const int n = std::max(1, (int)std::ceil(span / (du * 0.5)));
      for (int i = 0; i <= n; i++) for (int j = 0; i + j <= n; j++) {
        const double s = (double)i / n, r = (double)j / n, q = 1 - s - r;
        put(a[ax] * q + b[ax] * s + d[ax] * r + off[ax], a[ay] * q + b[ay] * s + d[ay] * r + off[ay], c);
      }
    }
  }
  void print() const {
    for (const std::string &r : g) { if (r.find_first_not_of(' ') == std::string::npos) continue; std::printf("|%s|\n", r.c_str()); }
  }
};

int main() {
  int bad = 0;
  for (const char *key : {"f1", "f4", "gt3"}) {
    const Spec S = carSpec(key);
    CarMeshes M = buildCarMeshes(S);
    std::printf("\n================ %s ================\n", key);
    std::printf("triangles: body %zu  frontWing %zu  rearWing %zu  helmet %zu  wheelF %zu  wheelR %zu\n", M.body.count() / 3,
                M.frontWing.count() / 3, M.rearWing.count() / 3, M.helmet.count() / 3, M.wheelF.count() / 3, M.wheelR.count() / 3);
    BB b; grow(b, M.body); grow(b, M.frontWing); grow(b, M.rearWing);
    BB lowb; grow(lowb, M.body, 0.80); grow(lowb, M.frontWing, 0.80); grow(lowb, M.rearWing, 0.80);
    const double L = b.hi[0] - b.lo[0], Wd = b.hi[1] - b.lo[1], Wlow = lowb.hi[1] - lowb.lo[1];
    std::printf("body+wings bbox (sim): x %.3f .. %.3f   y %.3f .. %.3f   z %.3f .. %.3f\n", b.lo[0], b.hi[0], b.lo[1], b.hi[1], b.lo[2], b.hi[2]);
    std::printf("  length %.3f (spec.bodyL %.2f)   width %.3f, below z=0.8 m %.3f (spec.bodyW %.2f)   lowest z %.3f\n", L, S.bodyL, Wd, Wlow, S.bodyW, b.lo[2]);
    if (std::fabs(L - S.bodyL) > 0.04) { std::printf("  FAIL length\n"); bad++; }
    if (std::fabs(Wlow - S.bodyW) > 0.04) { std::printf("  FAIL width\n"); bad++; }
    if (b.lo[2] < 0.02) { std::printf("  FAIL ground clearance\n"); bad++; }
    if (M.body.count() / 3 > 12000) { std::printf("  FAIL body triangle budget\n"); bad++; }
    int wi = 0;
    for (const MeshB *w : {&M.wheelF, &M.wheelR}) {
      BB wb; grow(wb, *w);
      double r = 0;
      for (size_t i = 0; i < w->count(); i++) { double p[3]; simv(*w, i, p); r = std::max(r, std::hypot(p[0], p[2])); }
      const double want = wi ? M.wheelRadR : M.wheelRadF;
      std::printf("wheel%c: mesh radius %.4f (wheelRad %.4f)  width %.4f  centre (%.4f, %.4f, %.4f)\n", wi ? 'R' : 'F', r, want,
                  wb.hi[1] - wb.lo[1], (wb.lo[0] + wb.hi[0]) / 2, (wb.lo[1] + wb.hi[1]) / 2, (wb.lo[2] + wb.hi[2]) / 2);
      if (std::fabs(r - want) > 1e-4 || w->count() / 3 > 600) { std::printf("  FAIL wheel\n"); bad++; }
      wi++;
    }
    double Wp[4][2];
    wheelPos(S, Wp);
    std::printf("contact patches (sim x, y, z=0):");
    for (int i = 0; i < 4; i++) std::printf("  (%.3f, %.3f)", Wp[i][0], Wp[i][1]);
    std::printf("\naxles: front x=%.3f (spec.a %.3f)  rear x=%.3f (-spec.b %.3f)\n", Wp[0][0], S.a, Wp[2][0], -S.b);
    std::printf("eye (GL-local x fwd, y up, z right): %.3f %.3f %.3f   cabin %s\n", M.eye[0], M.eye[1], M.eye[2], M.cabin ? "yes" : "no");
    // kinds used
    int kinds[16] = {0};
    for (const MeshB *m : {&M.body, &M.frontWing, &M.rearWing, &M.helmet, &M.wheelF, &M.wheelR})
      for (size_t i = 0; i < m->count(); i++) kinds[(int)(m->v[i * 10 + 9] + 0.5) & 15]++;
    std::printf("vertices by kind:");
    for (int k = 0; k < 16; k++) if (kinds[k]) std::printf("  %d:%d", k, kinds[k]);
    std::printf("\n");
    for (const MeshB *m : {&M.body, &M.frontWing, &M.rearWing, &M.helmet, &M.wheelF, &M.wheelR})
      for (float f : m->v) if (!std::isfinite(f)) { std::printf("  FAIL non-finite vertex\n"); bad++; break; }

    // the livery cut: areas by surface, and nothing left unpainted inside a livery box
    {
      double aPaint = 0, aDark = 0, aSecond = 0; int stray = 0, inHole = 0;
      for (const MeshB *m : {&M.body, &M.frontWing, &M.rearWing})
        for (size_t t = 0; t + 2 < m->count(); t += 3) {
          double a[3], b[3], d[3]; simv(*m, t, a); simv(*m, t + 1, b); simv(*m, t + 2, d);
          const double u[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]}, w[3] = {d[0] - a[0], d[1] - a[1], d[2] - a[2]};
          const double ar = 0.5 * std::sqrt(std::pow(u[1] * w[2] - u[2] * w[1], 2) + std::pow(u[2] * w[0] - u[0] * w[2], 2) + std::pow(u[0] * w[1] - u[1] * w[0], 2));
          const float r = m->v[t * 10 + 6], kind = m->v[t * 10 + 9];
          const double c[3] = {(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3};
          if (kind == 12 && r > 0.5) aPaint += ar; else if (kind == 12) aDark += ar; else if (kind == 6 && r > 0.9) aSecond += ar;
          // sim-space LOWER_PODS for f1 (car.js x + 0.18): full paint must not survive inside it
          if (!S.gt && S.key == "f1" && kind == 12 && r > 0.5 && c[0] > -1.50 && c[0] < 0.86 && c[2] < 0.355 && std::fabs(c[1]) > 0.385) stray++;
          if (S.gt && kind == 12 && std::fabs(c[1]) > 0.80 && (std::hypot(c[0] - S.a, c[2] - 0.34) < 0.36 || std::hypot(c[0] + S.b, c[2] - 0.34) < 0.36)) inHole++;
        }
      std::printf("surfaces: team paint %.2f m2, dark paint (livery lower pods) %.2f m2, second colour %.2f m2\n", aPaint, aDark, aSecond);
      if (!S.gt && S.key == "f1") { std::printf("  full-paint triangles left inside LOWER_PODS: %d\n", stray); if (stray || aDark < 0.3) { std::printf("  FAIL livery\n"); bad++; } }
      if (S.gt) { std::printf("  arch skin left inside the wheel openings: %d triangles\n", inHole); if (inHole) { std::printf("  FAIL openings\n"); bad++; } }
    }
    const double x0 = -S.b - (S.bodyL - S.L) * 0.5 - 0.15, x1 = x0 + 6.0;
    std::printf("\nSIDE VIEW (nose right; # body, F front wing, R rear wing, H helmet, O wheels; 6 cm x 12 cm cells)\n");
    {
      Grid G(x0, x1, 1.44);
      G.mesh(M.body, 0, 2, '#'); G.mesh(M.frontWing, 0, 2, 'F'); G.mesh(M.rearWing, 0, 2, 'R'); G.mesh(M.helmet, 0, 2, 'H');
      G.mesh(M.wheelF, 0, 2, 'O', Wp[0][0], 0, M.wheelRadF); G.mesh(M.wheelR, 0, 2, 'O', Wp[2][0], 0, M.wheelRadR);
      G.print();
    }
    if (S.gt) {
      std::printf("\nLEFT FLANK ONLY (body skin with y > 0.90 m: the wheel openings)\n");
      MeshB fl;
      for (size_t t = 0; t + 2 < M.body.count(); t += 3) {
        double a[3], b[3], d[3]; simv(M.body, t, a); simv(M.body, t + 1, b); simv(M.body, t + 2, d);
        if ((a[1] + b[1] + d[1]) / 3 > 0.90) fl.v.insert(fl.v.end(), M.body.v.begin() + t * 10, M.body.v.begin() + (t + 3) * 10);
      }
      Grid G(x0, x1, 1.44);
      G.mesh(fl, 0, 2, '#');
      G.print();
    }
    std::printf("\nTOP VIEW (nose right, car's LEFT up)\n");
    {
      Grid G(x0, x1, 1.32);
      G.mesh(M.wheelF, 0, 1, 'O', Wp[0][0], Wp[0][1]); G.mesh(M.wheelF, 0, 1, 'O', Wp[1][0], Wp[1][1]);
      G.mesh(M.wheelR, 0, 1, 'O', Wp[2][0], Wp[2][1]); G.mesh(M.wheelR, 0, 1, 'O', Wp[3][0], Wp[3][1]);
      G.mesh(M.body, 0, 1, '#'); G.mesh(M.frontWing, 0, 1, 'F'); G.mesh(M.rearWing, 0, 1, 'R'); G.mesh(M.helmet, 0, 1, 'H');
      G.print();
    }
  }
  std::printf("\n%s\n", bad ? "CHECKS FAILED" : "all checks passed");
  return bad ? 1 : 0;
}
