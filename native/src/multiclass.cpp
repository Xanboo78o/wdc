// multiclass.cpp — see multiclass.hpp.
#include "multiclass.hpp"

#include <algorithm>
#include <cmath>

namespace xbr {

static const GtClass CLASSES[GT_CLASSES] = {
  {"hyper", "HYPER", "a480", "#e10600"},
  {"gt3", "GT3", "m720", "#f2c200"},
  {"gt4", "GT4", "g55", "#2a8cff"},
};
const GtClass &gtClass(int k) { return CLASSES[std::max(0, std::min(GT_CLASSES - 1, k))]; }
int gtClassOf(const std::string &key) {
  for (int k = 0; k < GT_CLASSES; k++) if (key == CLASSES[k].key) return k;
  return -1;
}

GtField gtField(const Track &track, int grid, int playerClass, double where, bool single, bool pro, bool hasPlayer) {
  GtField F;
  const int n = std::max(1, grid);
  // roughly a quarter prototypes, a third GT4, and the GT3s are the crowd
  F.count[0] = n >= 3 ? std::max(1, (int)std::lround(n * 0.27)) : 0;
  F.count[2] = n >= 3 ? std::max(1, (int)std::lround(n * 0.32)) : 0;
  F.count[1] = n - F.count[0] - F.count[2];
  const int pc = std::max(0, std::min(GT_CLASSES - 1, playerClass));
  if (F.count[pc] == 0) { F.count[1] -= 1; F.count[pc] += 1; }      // a grid of one or two still has a seat for you
  // a league switched off hands its seats to the GT3s if they race, or to yours
  if (!single) for (int k = 0; k < GT_CLASSES; k++) if (k != pc && !((gtLeagues >> k) & 1)) {
    const int to = k != 1 && ((gtLeagues >> 1) & 1) ? 1 : pc;
    F.count[to] += F.count[k]; F.count[k] = 0;
  }
  if (single) { for (int k = 0; k < GT_CLASSES; k++) F.count[k] = 0; F.count[pc] = n; }
  for (int k = 0; k < GT_CLASSES; k++) {
    F.spec[k] = pro ? &proSpec(CLASSES[k].key) : &carSpec(CLASSES[k].key);
    if (F.count[k] > 0) { F.lines[k] = std::make_unique<Lines>(buildLines(track, *F.spec[k])); F.lines[k]->track = &track; }
  }
  int at = 0;
  for (int k = 0; k < GT_CLASSES; k++) {
    if (k == pc) F.playerGrid = at + 1 + (int)std::lround(std::max(0.0, std::min(1.0, where)) * (F.count[k] - 1));
    for (int q = 0; q < F.count[k]; q++) F.seats.push_back({F.spec[k], F.lines[k].get(), k});
    if (k == pc && pro && hasPlayer) { F.seats[(size_t)F.playerGrid - 1].spec = nullptr; F.seats[(size_t)F.playerGrid - 1].lines = nullptr; }
    at += F.count[k];
  }
  return F;
}

int classPos(const Race &race, const Entry &e) {
  int p = 1;
  for (const Entry &o : race.entries) if (&o != &e && o.klass == e.klass && o.pos < e.pos) p++;
  return p;
}

}  // namespace xbr
