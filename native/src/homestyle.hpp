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
#include <cmath>
#include <string>

#include "ui.hpp"

namespace xbr {

inline Rgba PAPER = hex("#0f0b16"), CARD = hex("#1c1527"), INK = hex("#f2e9d8"), SOFT = hex("#a99dbb"), RED = hex("#ff7a18"),
            ONRED = hex("#170b02"), YELL = hex("#b6ff3c"), PLUM = hex("#7b3cff");
inline bool STYLE_PRO = false;
static inline Rgba alpha_(const Rgba &a, float t) { Rgba r = a; r.c[3] *= t; return r; }
// THE ONE COLOUR of the pro look is the player's to choose (SETTINGS - COLOUR; Adam, 2026-10-09:
// "lemme change the color and maybe gimme animated colors, like a super chill one for listening to
// my sapphic indie pop in a gt car at night chilling in the fall into the night"). A still colour is
// one hex; a moving one is a short ring of them that the accent drifts round, slowly — a full turn
// takes most of a minute, so it is never seen to change, only found to have changed.
struct StyleColour { const char *key, *label; int n; const char *ring[6]; float period; };
static const StyleColour STYLE_COLOURS[] = {
  {"film", "FILM RED", 1, {"#ff2d46"}, 0},
  {"ice", "ICE BLUE", 1, {"#39b8ff"}, 0},
  {"gold", "GOLD", 1, {"#ffc21a"}, 0},
  {"lime", "LIME", 1, {"#8dff3a"}, 0},
  {"rose", "ROSE", 1, {"#ff5fa8"}, 0},
  // into the night in autumn: ember, rose, plum, the blue hour, and back
  {"fall", "FALL NIGHT (MOVING)", 5, {"#ff8a3d", "#ff5e7a", "#b05cff", "#5a7dff", "#ff6aa2"}, 52},
  // a sunset in five bands: dark orange, light orange, white-pink, pink, dark rose
  {"sunset", "SAPPHIC SUNSET (MOVING)", 5, {"#e8501e", "#ff9a56", "#ffd3e2", "#d362a4", "#b3247a"}, 46},
  // the cold one: green into teal into violet
  {"aurora", "AURORA (MOVING)", 4, {"#3dffa0", "#2fd6e8", "#6f7bff", "#c45cff"}, 60},
};
inline bool STYLE_MOVING = false;
inline Rgba STYLE_GLOW = hex("#ff2d46");          // where the ring will be a quarter-turn on: for a wash of two colours
static inline Rgba styleRing(const StyleColour &c, double turn) {
  turn -= std::floor(turn);
  const double u = turn * c.n;
  const int i = (int)u % c.n, j = (i + 1) % c.n;
  float f = (float)(u - std::floor(u));
  f = f * f * (3 - 2 * f);                         // ease: it rests on each colour and slips to the next
  return mix(hex(c.ring[j]), hex(c.ring[i]), f);
}
// theme: "pro" (and "light", the old name of the default) or anything else for the night paddock
inline bool applyStyle(const std::string &theme, const std::string &colour = "film", double clock = 0) {
  STYLE_PRO = theme == "pro" || theme == "light" || theme.empty();
  STYLE_MOVING = false;
  if (STYLE_PRO) {
    PAPER = hex("#000000"); CARD = hex("#0d0e12", 0.90f); INK = hex("#ffffff"); SOFT = hex("#ffffff", 0.62f); RED = hex("#ff2d46");
    ONRED = hex("#ffffff"); YELL = hex("#ffffff"); PLUM = hex("#ff2d46");
    for (const StyleColour &c : STYLE_COLOURS) if (colour == c.key) {
      if (c.n == 1) RED = hex(c.ring[0]);
      else { STYLE_MOVING = true; RED = styleRing(c, clock / c.period); STYLE_GLOW = styleRing(c, clock / c.period + 0.27); }
      PLUM = RED;
      ONRED = inkOn(RED);
    }
  } else {
    PAPER = hex("#0f0b16"); CARD = hex("#1c1527"); INK = hex("#f2e9d8"); SOFT = hex("#a99dbb"); RED = hex("#ff7a18");
    ONRED = hex("#170b02"); YELL = hex("#b6ff3c"); PLUM = hex("#7b3cff");
  }
  return STYLE_PRO;
}

}  // namespace xbr
