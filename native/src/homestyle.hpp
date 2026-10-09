// homestyle.hpp — THE NIGHT PADDOCK: the menu's colours, for every file that
// draws a page of it (home.cpp, home_career.cpp). (Adam, 2026-10-08: "ui reskin
// as in new look and style not this setup no more, and halloweeny a lil bit".)
// The page is the dark; the race behind it shows through. Cards are aubergine,
// the ink is bone, the one loud colour is pumpkin and the second is slime. The
// names are the old ones (PAPER the page, CARD a panel, INK the line and the
// lettering, RED the loud one, YELL the chip) so every page follows at once.
#pragma once
#include "ui.hpp"

namespace xbr {

static const Rgba PAPER = hex("#0f0b16"), CARD = hex("#1c1527"), INK = hex("#f2e9d8"), SOFT = hex("#a99dbb"), RED = hex("#ff7a18"),
                  ONRED = hex("#170b02"), YELL = hex("#b6ff3c"), PLUM = hex("#7b3cff");
static inline Rgba alpha_(const Rgba &a, float t) { Rgba r = a; r.c[3] *= t; return r; }

}  // namespace xbr
