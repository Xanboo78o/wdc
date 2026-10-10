// homestyle.hpp — the menu's colours, for every file that draws a page of it
// (home.cpp, home_career.cpp). The names are the old ones (PAPER the page, CARD
// a panel, INK the line and the lettering, RED the loud one, YELL the chip) so
// every page follows at once. They are VARIABLES: applyStyle sets them.
//
//   PRO            Adam, 2026-10-09: "new vibe: pro ... professional, iracing, acc", and
//                  then the brief that settles it: "yk the ad we made, the cinema one,
//                  this game is its embodiment". So the menus are that film
//                  (ad-cinematic.html): the picture IS the page, between two black
//                  bars; lettering stands straight on it, big white Anton and small
//                  wide-spaced Rubik; one red (#ff2d46) and a thin red rule. No
//                  boxes where a line of type will do, nothing tilted, no props.
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
    PAPER = hex("#000000"); CARD = hex("#0d0e12", 0.90f); INK = hex("#ffffff"); SOFT = hex("#ffffff", 0.62f); RED = hex("#ff2d46");
    ONRED = hex("#ffffff"); YELL = hex("#ffffff"); PLUM = hex("#ff2d46");
  } else {
    PAPER = hex("#0f0b16"); CARD = hex("#1c1527"); INK = hex("#f2e9d8"); SOFT = hex("#a99dbb"); RED = hex("#ff7a18");
    ONRED = hex("#170b02"); YELL = hex("#b6ff3c"); PLUM = hex("#7b3cff");
  }
  return STYLE_PRO;
}

}  // namespace xbr
