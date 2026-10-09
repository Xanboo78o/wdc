// grid.cpp — js/grid.js, ported.
#include "grid.hpp"

namespace xbr {

std::vector<Slot> gridSlots(const Track &t, int count) {
  // corner.dir < 0 is a right-hander, so pole goes LEFT of the centreline.
  const double poleSide = !t.corners.empty() && t.corners[0].dir < 0 ? 1 : -1;
  const bool open = t.open;
  std::vector<Slot> slots;
  for (int k = 0; k < count; k++) {
    const double s = open ? 6 + (count - 1 - k) * 8 : -6 - k * 8;
    const int i = t.idx(s);
    Slot q;
    q.n = k + 1;
    q.s = t.wrap(s);
    q.lat = (k % 2 ? -poleSide : poleSide) * t.w[i] * 0.46;
    q.hdg = t.hdg[i];
    q.i = i;
    slots.push_back(q);
  }
  return slots;
}

}  // namespace xbr
