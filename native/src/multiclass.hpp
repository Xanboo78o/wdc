// multiclass.hpp — GT MODE: three classes on one road (not in the JS).
//
// Hypercars at the front, GT3 behind them, GT4 at the back, and each of them in
// its own race. A class is a Spec plus the racing line solved for THAT car: a
// slower class is not a fast one with the speed turned down, it brakes earlier
// and carries less through every corner.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "race.hpp"

namespace xbr {

struct GtClass { const char *key, *label, *pack, *col; };
constexpr int GT_CLASSES = 3;
const GtClass &gtClass(int k);                 // 0 hyper, 1 gt3, 2 gt4 — front to back
int gtClassOf(const std::string &key);         // -1 = not one of them

struct GtField {
  Spec *spec[GT_CLASSES] = {};
  std::unique_ptr<Lines> lines[GT_CLASSES];
  int count[GT_CLASSES] = {};
  std::vector<RaceOptions::Seat> seats;        // one per grid slot
  int playerGrid = 1;                          // 1-based, inside your class's block
};
// `where` 0..1: how far back in your own class you start.
// single: the whole grid is your class. pro: the rivals drive proSpec cars on their own
// lines, and (hasPlayer) your own slot is left as an empty seat — the race's own spec and line.
GtField gtField(const Track &track, int grid, int playerClass, double where, bool single = false, bool pro = false, bool hasPlayer = true);

// Position within its class (1-based) of every entry, by race position.
int classPos(const Race &race, const Entry &e);

}  // namespace xbr
