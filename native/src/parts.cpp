// parts.cpp — js/parts.js, the half the simulation reads: which components a
// blow reached, what has come off, and what that costs in downforce, balance
// and drag. The renderer's half (bent meshes, parts flying off) is not ported.
//
// COORDINATES: the JS mesh frame — x forward, y up, z to the car's RIGHT.
// collide's `ly` is positive to the LEFT, so a dent at ly lands at z = -ly.
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "physics.hpp"

namespace xbr {

namespace {
enum Flag { NONE, SUS, WHEEL, NODETACH };
enum Group { G_NONE, G_FRONT, G_REAR };
struct Def {
  const char *id, *parent;
  double anchor[3];
  double frag, hang;
  double aero[3];
  Group group;
  Flag flag;
};
// id, parent, anchor, fragility, hang, aero at full loss [ClA, balance, CdA],
// group, flag. Same order as the JS table: indices are shared with it.
const Def DEF[N_PARTS] = {
  {"nose",   nullptr, {2.50, 0.18, 0},       1.00, 0,    {0, 0, 0},             G_FRONT, NONE},
  {"fwL",    "nose",  {2.45, 0.14, -0.55},   1.30, 0.35, {-0.12, -0.25, -0.03}, G_FRONT, NONE},
  {"fwR",    "nose",  {2.45, 0.14, 0.55},    1.30, 0.35, {-0.12, -0.25, -0.03}, G_FRONT, NONE},
  {"fepL",   "fwL",   {2.50, 0.25, -0.985},  2.60, 0.50, {-0.02, -0.04, 0},     G_FRONT, NONE},
  {"fepR",   "fwR",   {2.50, 0.25, 0.985},   2.60, 0.50, {-0.02, -0.04, 0},     G_FRONT, NONE},
  {"susFL",  nullptr, {1.80, 0.30, -0.50},   1.10, 0.30, {0, 0, 0},             G_NONE, SUS},
  {"susFR",  nullptr, {1.80, 0.30, 0.50},    1.10, 0.30, {0, 0, 0},             G_NONE, SUS},
  {"susRL",  nullptr, {-1.80, 0.30, -0.45},  1.00, 0.30, {0, 0, 0},             G_NONE, SUS},
  {"susRR",  nullptr, {-1.80, 0.30, 0.45},   1.00, 0.30, {0, 0, 0},             G_NONE, SUS},
  {"whlFL",  "susFL", {1.80, 0.36, -0.85},   0.70, 0,    {0, 0, 0},             G_NONE, WHEEL},
  {"whlFR",  "susFR", {1.80, 0.36, 0.85},    0.70, 0,    {0, 0, 0},             G_NONE, WHEEL},
  {"whlRL",  "susRL", {-1.80, 0.36, -0.80},  0.70, 0,    {0, 0, 0},             G_NONE, WHEEL},
  {"whlRR",  "susRR", {-1.80, 0.36, 0.80},   0.70, 0,    {0, 0, 0},             G_NONE, WHEEL},
  {"mirL",   nullptr, {0.37, 0.63, -0.44},   2.20, 0.55, {0, 0, 0},             G_NONE, NONE},
  {"mirR",   nullptr, {0.37, 0.63, 0.44},    2.20, 0.55, {0, 0, 0},             G_NONE, NONE},
  {"podL",   nullptr, {-0.10, 0.40, -0.66},  0.75, 0.30, {-0.02, 0, 0.03},      G_NONE, NONE},
  {"podR",   nullptr, {-0.10, 0.40, 0.66},   0.75, 0.30, {-0.02, 0, 0.03},      G_NONE, NONE},
  {"inletL", "podL",  {0.64, 0.455, -0.585}, 1.60, 0.40, {0, 0, 0.01},          G_NONE, NONE},
  {"inletR", "podR",  {0.64, 0.455, 0.585},  1.60, 0.40, {0, 0, 0.01},          G_NONE, NONE},
  {"edgeL",  nullptr, {-0.30, 0.10, -0.85},  1.40, 0.40, {-0.04, 0.01, 0},      G_NONE, NONE},
  {"edgeR",  nullptr, {-0.30, 0.10, 0.85},   1.40, 0.40, {-0.04, 0.01, 0},      G_NONE, NONE},
  {"bargeL", nullptr, {1.15, 0.15, -0.48},   1.80, 0.45, {-0.025, -0.02, 0},    G_NONE, NONE},
  {"bargeR", nullptr, {1.15, 0.15, 0.48},    1.80, 0.45, {-0.025, -0.02, 0},    G_NONE, NONE},
  {"cover",  nullptr, {-1.40, 0.55, 0},      0.50, 0,    {-0.02, 0, 0.03},      G_NONE, NODETACH},
  {"tcam",   nullptr, {-0.62, 0.795, 0},     1.20, 0.40, {0, 0, 0},             G_NONE, NONE},
  {"rw",     nullptr, {-2.47, 0.87, 0},      0.90, 0.30, {-0.20, 0.20, -0.06},  G_REAR, NONE},
  {"drs",    "rw",    {-2.60, 0.95, 0},      1.30, 0.45, {-0.10, 0.12, -0.05},  G_REAR, NONE},
  {"repL",   "rw",    {-2.52, 0.80, -0.53},  2.00, 0.50, {-0.03, 0.03, -0.01},  G_REAR, NONE},
  {"repR",   "rw",    {-2.52, 0.80, 0.53},   2.00, 0.50, {-0.03, 0.03, -0.01},  G_REAR, NONE},
  {"beam",   nullptr, {-2.36, 0.41, 0},      1.00, 0.40, {-0.05, 0.03, -0.02},  G_REAR, NONE},
  {"diff",   nullptr, {-2.00, 0.12, 0},      0.80, 0.35, {-0.15, 0.08, 0},      G_REAR, NONE},
  {"rain",   nullptr, {-2.335, 0.33, 0},     1.20, 0.50, {0, 0, 0},             G_REAR, NONE},
};
const bool wheelsDetach = true;       // js PARTS.wheelsDetach: on since 2026-10-08 ("crumble ... and fly"): physics reads car.wheelLost now

struct Tree {
  int parent[N_PARTS];
  std::vector<int> children[N_PARTS];
  int nose, fwL, fwR, rw;
  Tree() {
    auto idx = [](const char *id) { for (int i = 0; i < N_PARTS; i++) if (std::string(DEF[i].id) == id) return i; return -1; };
    for (int i = 0; i < N_PARTS; i++) parent[i] = DEF[i].parent ? idx(DEF[i].parent) : -1;
    for (int i = 0; i < N_PARTS; i++) if (parent[i] >= 0) children[parent[i]].push_back(i);
    nose = idx("nose"); fwL = idx("fwL"); fwR = idx("fwR"); rw = idx("rw");
  }
};
const Tree &tree() { static const Tree T; return T; }

void fresh(Parts &P) {
  P = Parts{};
  P.exists = true;
  for (int i = 0; i < N_PARTS; i++) { P.h[i] = 1; P.hx[i] = 0; P.hz[i] = 0; P.gone[i] = 0; }
}
double falloff(double t) { const double u = 1 - t * t; return u * u; }

void detach(Parts &P, int i) {
  P.gone[i] = 1; P.h[i] = 0;
  for (int k : tree().children[i]) detach(P, k);
}
void restore(Parts &P, Group group) {
  for (int i = 0; i < N_PARTS; i++) {
    if (DEF[i].group != group) continue;
    P.gone[i] = 0; P.h[i] = 1; P.hx[i] = 0; P.hz[i] = 0;
  }
  P.ver++;
}
void blow(Parts &P, double x, double z, double nx, double nz, double E) {
  const double reach = 1.0 + 1.4 * std::min(1.0, E);
  for (int i = 0; i < N_PARTS; i++) {
    if (P.gone[i]) continue;
    const double *a = DEF[i].anchor;
    const double dx = a[0] - x, dy = (a[1] - 0.25) * 0.5, dz = a[2] - z;
    const double t = std::sqrt(dx * dx + dy * dy + dz * dz) / reach;
    if (t >= 1) continue;
    const double d = E * falloff(t) * DEF[i].frag;
    if (d < 1e-4) continue;
    P.h[i] = (float)std::max(0.0, (double)P.h[i] - d);
    const double wgt = std::min(1.0, d * 3);
    P.hx[i] = (float)((double)P.hx[i] * (1 - wgt) + nx * wgt);
    P.hz[i] = (float)((double)P.hz[i] * (1 - wgt) + nz * wgt);
  }
}
void summarise(Parts &P) {
  bool dmg = false, show = false, hanging = false;
  double cl = 1, bal = 1, cd = 1;
  const Tree &T = tree();
  for (int i = 0; i < N_PARTS; i++) {
    const double h = P.h[i];
    const bool g = P.gone[i] != 0;
    if (g || h < 0.999) dmg = true;
    if (g || h < 0.8) show = true;
    if (!g && DEF[i].hang != 0 && h < DEF[i].hang) hanging = true;
    if (P.lf && DEF[i].group == G_FRONT) continue;
    if (P.lr && (i == T.rw || T.parent[i] == T.rw)) continue;
    const double *a = DEF[i].aero;
    if (a[0] == 0 && a[1] == 0 && a[2] == 0) continue;
    const double loss = g ? 1 : h < 0.7 ? 0.5 * (0.7 - h) / 0.7 : 0;
    if (loss == 0) continue;
    cl *= 1 + a[0] * loss; bal *= 1 + a[1] * loss; cd *= 1 + a[2] * loss;
  }
  P.dmg = dmg; P.show = show; P.hanging = hanging;
  P.cl = cl; P.bal = bal; P.cd = cd;
}
}  // namespace

const char *partName(int i) { return i >= 0 && i < N_PARTS ? DEF[i].id : ""; }

Parts *syncParts(Car &car) {
  Parts &P = car.parts;
  Parts *have = P.exists ? &P : nullptr;
  // a single-seater only: the GT3 body is a coupe with its own few parts
  if (!car.hasCrush || car.spec->gt || car.spec->key == "gt3") return have;
  const bool lf = car.hasLost && car.lostFrontWing, lr = car.hasLost && car.lostRearWing;
  const double cf = car.crushFront, cr = car.crushRear, cl = car.crushLeft, crr = car.crushRight;
  if (!P.exists) {
    if (cf + cr + cl + crr == 0 && !lf && !lr) return nullptr;
    fresh(P);
  } else if (cf == P.c[0] && cr == P.c[1] && cl == P.c[2] && crr == P.c[3] && lf == P.lf && lr == P.lr) {
    return &P;
  }
  const Spec &S = *car.spec;
  const double hl = S.bodyL * 0.5, hw = S.bodyW * 0.5;
  const double now[4] = {cf, cr, cl, crr};

  // ---- repairs
  if (cf + cr + cl + crr == 0 && car.dents.empty() && !lf && !lr) {
    const int ver = P.ver;
    fresh(P);
    P.ver = ver + 1;
    for (bool &w : car.wheelLost) w = false;
    return &P;
  }
  if ((P.lf && !lf) || now[0] < P.c[0] - 1e-6) restore(P, G_FRONT);
  if ((P.lr && !lr) || now[1] < P.c[1] - 1e-6) restore(P, G_REAR);

  // ---- where it was hit
  struct HitPt { int reg; double x, z, nx, nz, w; };
  std::vector<HitPt> hits;
  for (auto &d : car.dents) {
    const double dd = d.depth - d.seen;
    if (dd > 1e-4) {
      d.seen = d.depth;
      const int reg = d.lx > hl * 0.5 ? 0 : d.lx < -hl * 0.5 ? 1 : d.ly > 0 ? 2 : 3;
      hits.push_back({reg, d.lx, -d.ly, d.nx, -d.ny, dd});
    }
  }
  const double DEF_PT[4][4] = {{hl, 0, -1, 0}, {-hl, 0, 1, 0}, {0, -hw, 0, 1}, {0, hw, 0, -1}};
  for (int r = 0; r < 4; r++) {
    const double E = now[r] - P.c[r];
    if (E <= 0.002) continue;
    std::vector<HitPt> mine;
    for (const auto &h : hits) if (h.reg == r) mine.push_back(h);
    if (mine.empty()) mine.push_back({r, DEF_PT[r][0], DEF_PT[r][1], DEF_PT[r][2], DEF_PT[r][3], 1});
    double tw = 0;
    for (const auto &h : mine) tw += h.w;
    for (const auto &h : mine) blow(P, h.x, h.z, h.nx, h.nz, E * h.w / tw);
  }
  for (int k = 0; k < 4; k++) P.c[k] = now[k];
  P.lf = lf; P.lr = lr;

  // ---- what comes off
  const Tree &T = tree();
  for (int i = 0; i < N_PARTS; i++) {
    if (P.gone[i] || P.h[i] > 0) continue;
    if (DEF[i].flag == NODETACH || (DEF[i].flag == WHEEL && !wheelsDetach)) { P.h[i] = 0.02f; continue; }
    if (DEF[i].flag == SUS && !wheelsDetach) { P.h[i] = 0.02f; continue; }
    detach(P, i);
  }
  if (!P.gone[T.nose] && P.gone[T.fwL] && P.gone[T.fwR]) detach(P, T.nose);
  if (lf && !P.gone[T.nose]) detach(P, T.nose);
  if (lr && !P.gone[T.rw]) detach(P, T.rw);
  if (P.gone[T.nose] || P.gone[T.rw]) {
    car.hasLost = true;
    if (P.gone[T.nose]) car.lostFrontWing = true;
    if (P.gone[T.rw]) car.lostRearWing = true;
    P.lf = car.lostFrontWing; P.lr = car.lostRearWing;
  }
  // (This was left out of the port, so until 2026-10-10 no wheel ever came off a car here: fx.cpp's flying wheel,
  // physics.cpp's three-wheeled car and the renderer's empty corner were all waiting for a flag nobody set.)
  if (wheelsDetach) {
    static const int WH[4] = {9, 10, 11, 12};        // whlFL whlFR whlRL whlRR, wheelPos's order
    for (int k = 0; k < 4; k++) car.wheelLost[k] = car.wheelLost[k] || P.gone[WH[k]] != 0;      // (or tyreHit tore it off: wheelsTear)
  }
  summarise(P);
  P.ver++;
  return &P;
}

void refitWheels(Car &car) {
  for (bool &w : car.wheelLost) w = false;
  Parts &P = car.parts;
  if (!P.exists) return;
  bool any = false;
  for (int i = 0; i < N_PARTS; i++) {
    if ((DEF[i].flag != WHEEL && DEF[i].flag != SUS) || !P.gone[i]) continue;
    P.gone[i] = 0; P.h[i] = 0.5f; any = true;
  }
  if (any) { summarise(P); P.ver++; }
}

}  // namespace xbr
