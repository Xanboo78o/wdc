// grid.hpp — where the cars stand before the lights go out (js/grid.js).
// Imports nothing but the track, so the renderer and the gate call the SAME
// function. Positions are SIM coordinates: metres along, metres LEFT, heading.
#pragma once
#include <vector>

#include "track.hpp"

namespace xbr {

struct Slot { int n = 0; double s = 0, lat = 0, hdg = 0; int i = 0; };

// The starting grid, pole first: pole on the side the first corner turns away
// from, 8 m apart from 6 m behind the line (forward of it on an OPEN track).
std::vector<Slot> gridSlots(const Track &track, int count = 22);

}  // namespace xbr
