// homestyle.hpp — the menu's colours, for every file that draws a page of it
// (home.cpp, home_career.cpp). The names are the old ones (PAPER the page, CARD
// a panel, INK the line and the lettering, RED the loud one, YELL the chip) so
// every page follows at once. They are VARIABLES: applyStyle sets them.
//
//   PRO            Adam, 2026-10-09: "new vibe: pro ... professional, iracing, acc",
//                  "not AS sleek, but not as dark but not grey". A racing blue you
//                  can see is blue, white lettering, one red. Square, level, quiet:
//                  nothing tilts, nothing is hand-drawn, nothing is a joke prop.
//   NIGHT PADDOCK  the look before it (2026-10-08: "halloweeny a lil bit"): the
//                  page is the dark, cards aubergine, ink bone, pumpkin and slime.
#pragma once
#include <string>

#include "ui.hpp"

namespace xbr {

inline Rgba PAPER = hex("#0f0b16"), CARD = hex("#1c1527"), INK = hex("#f2e9d8"), SOFT = hex("#a99dbb"), RED = hex("#ff7a18"),
            ONRED = hex("#170b02"), YELL = hex("#b6ff3c"), PLUM = hex("#7b3cff");
inline bool STYLE_PRO = false;
static inline Rgba alpha_(const Rgba &a, float t) { Rgba r = a; r.c[3] *= t; return r; }
// theme: "pro" (and "light", the old name of the default) or anything else for the night paddock
inline bool applyStyle(const std::string &theme) {
  STYLE_PRO = theme == "pro" || theme == "light" || theme.empty();
  if (STYLE_PRO) {
    PAPER = hex("#12336b"); CARD = hex("#1d4a94"); INK = hex("#ffffff"); SOFT = hex("#bcd0f2"); RED = hex("#f0332b");
    ONRED = hex("#ffffff"); YELL = hex("#ffd60a"); PLUM = hex("#49b2ff");
  } else {
    PAPER = hex("#0f0b16"); CARD = hex("#1c1527"); INK = hex("#f2e9d8"); SOFT = hex("#a99dbb"); RED = hex("#ff7a18");
    ONRED = hex("#170b02"); YELL = hex("#b6ff3c"); PLUM = hex("#7b3cff");
  }
  return STYLE_PRO;
}

}  // namespace xbr
