// home_race.cpp — THE RACE PAGES (not in the JS).
//
// Adam, 2026-10-10: "a bunh of banners, that then lead to other pages, like trailmakers ... then u hit
// track and u get like a brotato character select style with the grid of tracks, then it shows the deeets
// at the top. and same for all the things, and the icons for the tracks is js scaled down tracks ... and
// make good icons for modes."
//
// RACE SETUP is five banners: TRACK, MODE, TIME + WEATHER, DIFFICULTY, DETAILS. Each opens a page of its
// own. A choice of one among several is a circle that fills ("like multiple choice questions"); a thing
// that is on or off is a switch; a number you may type is a box.
//
// A page is a list of CELLS (cells()), laid out where they are drawn. The d-pad walks them by where they
// ARE on the screen (move()), so no page has an order to learn.
#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <ctime>

#include "home.hpp"
#include "homestyle.hpp"
#include "audio.hpp"
#include "driver.hpp"
#include "json.hpp"
#include "multiclass.hpp"
#include "physics.hpp"
#include "ui.hpp"

namespace xbr {

// (same day: "for the car selector do it like the tracks, do anything with over 4 options like the tracks")
// A choice of five or more is a row of TILES, each with its own small picture; four or fewer stay circles.
static const int K_TILE = 20, K_STEP = 21;      // K_STEP: one line that LEFT / RIGHT walk through a long list
static std::string up(std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; }
static const char *TIMES[8] = {"dawn", "sunrise", "morning", "day", "evening", "sunset", "dusk", "night"};
// where the sun stands for each, in degrees round the orb (0 = the right-hand horizon, 90 = overhead)
// THE HOUR. The record's `time` is "live", one of the eight old names, or "h:13.5" — an hour of the day, which
// is what the orb turns (the names are kept so that old records and the events still say what they said).
static const float NAME_HOUR[8] = {5.5f, 6.5f, 9.0f, 12.5f, 16.5f, 18.5f, 19.5f, 23.0f};
static double hourOf(const std::string &t) {
  if (t.rfind("h:", 0) == 0) return std::fmod(std::fmod(std::atof(t.c_str() + 2), 24.0) + 24.0, 24.0);
  for (int i = 0; i < 8; i++) if (t == TIMES[i]) return NAME_HOUR[i];
  return 12.5;
}
static const char *phaseOf(double h) {
  return h < 5 ? "NIGHT" : h < 6.25 ? "DAWN" : h < 8 ? "SUNRISE" : h < 11 ? "MORNING" : h < 15.5 ? "DAY" : h < 17.75 ? "EVENING" : h < 19 ? "SUNSET" : h < 20.5 ? "DUSK" : "NIGHT";
}
static std::string clockOf(double h) { char b[16]; std::snprintf(b, sizeof b, "%02d:%02d", (int)h, (int)std::lround((h - std::floor(h)) * 60) % 60); return b; }
// ---- what a car is: its class's numbers (the physics every car of the class shares), and the engine that is its own
static const char *engineOf(const std::string &cls, const std::string &key) {
  static const char *E[][2] = {{"hura", "5.2 V10"}, {"m4", "3.0 TWIN-TURBO STRAIGHT SIX"}, {"m720", "4.0 TWIN-TURBO V8"}, {"nsx", "3.5 TWIN-TURBO V6"},
                               {"p992", "4.2 FLAT SIX"}, {"p992r", "4.2 FLAT SIX"}, {"p911", "4.0 FLAT SIX"}, {"a110", "1.8 TURBO FOUR"}, {"amg4", "4.0 TWIN-TURBO V8"},
                               {"g55", "3.7 V6"}, {"m4g4", "3.0 TWIN-TURBO STRAIGHT SIX"}, {"a480", "4.5 V8"}, {"f499", "3.0 TWIN-TURBO V6 HYBRID"},
                               {"p9x8", "2.6 TWIN-TURBO V6 HYBRID"}, {"f122", "1.6 TURBO V6 HYBRID"}};
  for (auto &e : E) if (key == e[0]) return e[1];
  return cls == "f1" ? "3.0 V10" : cls == "hyper" ? "V12" : cls == "f4" || cls == "rally" ? "TURBO FOUR" : "V8";
}
static const char *WX_KINDS[5][2] = {{"clear", "CLEAR"}, {"cloudy", "CLOUDY"}, {"overcast", "OVERCAST"}, {"rain", "RAIN"}, {"storm", "STORM"}};

// ---- what kind of race this is -----------------------------------------------------------------
std::string Home::modeNow() const {
  if (S.mode != "race") return "hotlap";
  if (S.car == "gt3") return S.endur ? "endurance" : "gt";
  return "f1";
}
void Home::syncLeagues() {
  S.leagues = (S.leagues & 7) | (1 << std::max(0, gtClassOf(S.gtClass)));      // your own league always races
  int n = 0;
  for (int q = 0; q < 3; q++) n += (S.leagues >> q) & 1;
  S.gtOn = n > 1;
}
void Home::setMode(const std::string &m) {
  S.xOn = false;
  if (m == "hotlap") { S.mode = "hotlap"; S.endur = false; S.gtOn = false; }
  else if (m == "f1") { S.mode = "race"; S.endur = false; S.gtOn = false; if (S.car != "f1" && S.car != "f4") set("carX", "f1"); }
  else { S.mode = "race"; S.endur = m == "endurance"; if (S.car != "gt3") set("carX", S.gtClass); syncLeagues(); }
  dirty = true;
}
// The record may come from the old page, or from a hand: make it one of the four modes.
void Home::tidy() {
  if (S.xOn || eventOn) return;
  if (S.mode == "race" && S.car == "rally") set("carX", "f1");      // the rally car runs alone, on a hot lap
  if (S.mode != "race" || S.car != "gt3") S.gtOn = false; else syncLeagues();
  if (S.car != "gt3") S.endur = false;
  S.laps = std::max(1, S.laps);
}
// "canon for the track": a grand prix is the first lap past 305 km (Monaco: 78); a GT sprint is about an hour, 160 km.
int Home::canonLaps() {
  const Outline &o = outline(S.track);
  if (!o.ok || o.len < 100) return 10;
  if (S.car == "gt3") return std::max(1, (int)std::ceil(160000.0 / o.len));
  if (S.track == "monaco") return 78;
  return std::max(1, (int)std::ceil(305000.0 / o.len));
}

// ---- the d-pad: go to what is nearest in that direction ------------------------------------------
void Home::move(Nav n) {
  editing = false;
  std::vector<const Cell *> F;
  for (const Cell &c : lastCells) if (c.focus) F.push_back(&c);
  if ((int)F.size() != (int)items.size() || at < 0 || at >= (int)F.size()) {      // never drawn yet: the plain order
    at = std::max(0, std::min((int)items.size() - 1, at + (n == Nav::Up || n == Nav::Left ? -1 : 1)));
    return;
  }
  const Cell &c = *F[(size_t)at];
  const bool horiz = n == Nav::Left || n == Nav::Right;
  const float sign = n == Nav::Left || n == Nav::Up ? -1.0f : 1.0f;
  int best = -1;
  float bestScore = 1e30f;
  for (int q = 0; q < (int)F.size(); q++) {
    if (q == at) continue;
    const Cell &o = *F[(size_t)q];
    // how far along the way you pressed, edge to edge; and how far off to the side (0 if they overlap)
    const float along = horiz ? (sign > 0 ? o.x - (c.x + c.w) : c.x - (o.x + o.w)) : (sign > 0 ? o.y - (c.y + c.h) : c.y - (o.y + o.h));
    if (along < -1) continue;
    const float a0 = horiz ? c.y : c.x, a1 = horiz ? c.y + c.h : c.x + c.w, b0 = horiz ? o.y : o.x, b1 = horiz ? o.y + o.h : o.x + o.w;
    const float side = b0 > a1 ? b0 - a1 : a0 > b1 ? a0 - b1 : 0;
    if (horiz && side > 0) continue;                       // LEFT / RIGHT stay on the line
    const float centre = std::fabs((horiz ? c.y + c.h / 2 - o.y - o.h / 2 : c.x + c.w / 2 - o.x - o.w / 2));
    const float score = along + 4 * side + 0.02f * centre;
    if (score < bestScore) { bestScore = score; best = q; }
  }
  if (best >= 0) at = best;
}

// ---- the weather map: a blob in your hands (Adam: "u can hit y/a to grow or small, and x/b to rotate then obvi dpad to position")
void Home::wxInput(Nav n) {
  if (wxAt < 0 || wxAt >= (int)S.zones.size()) { wxAt = -1; return; }
  MenuSave::WxZone &z = S.zones[(size_t)wxAt];
  const Outline &o = outline(S.track);
  const float size = o.ok ? std::max(o.x1 - o.x0, o.y1 - o.y0) : 1000, step = size * 0.03f;
  click = 3;
  switch (n) {
    case Nav::Left: z.x -= step; break;
    case Nav::Right: z.x += step; break;
    case Nav::Up: z.y += step; break;                 // (the map is north up; the track's own y runs the other way)
    case Nav::Down: z.y -= step; break;
    case Nav::Y: z.r = std::min(size * 0.6f, z.r * 1.12f); break;
    case Nav::Ok:
      z.r /= 1.12f;
      if (z.r < size * 0.035f) { S.zones.erase(S.zones.begin() + wxAt); wxAt = -1; click = 2; show("wx", 0); say("gone."); }
      break;
    case Nav::X: z.rot -= 0.2618f; break;
    case Nav::Back: z.rot += 0.2618f; break;
    case Nav::Go: { const int keep = 5 + wxAt; wxAt = -1; click = 1; show("wx", keep); break; }
  }
  if (o.ok && wxAt >= 0) { z.x = std::max(o.x0, std::min(o.x1, z.x)); z.y = std::max(-o.y1, std::min(-o.y0, z.y)); }
}

// ---- the cells of each page ------------------------------------------------------------------
std::vector<Home::Cell> Home::cells(float W, float H, const std::function<float(float, const std::string &)> &tw) {
  std::vector<Cell> C;
  const float X0 = 70, rowH = 52, VX = X0 + 230;
  const std::string m = modeNow();
  float y = 0, cx = VX;
  auto re = [this] { const int keep = at; const std::string pg = page; show(pg, keep); };
  auto line = [&](const std::string &label) {
    Cell c; c.kind = K_HEAD; c.x = X0; c.y = y; c.w = 200; c.h = rowH - 8; c.label = label; c.focus = false;
    C.push_back(c); cx = VX;
  };
  auto put = [&](int kind, const std::string &label, bool on, std::function<void()> ok) -> Cell & {
    const float w = kind == K_NUM ? 190 : (kind == K_TOGGLE ? 64 : 38) + tw(24, label) + 30;
    if (cx + w > W - X0 && cx > VX) { cx = VX; y += rowH; }
    Cell c; c.kind = kind; c.x = cx; c.y = y; c.w = w - 12; c.h = rowH - 8; c.label = label; c.on = on; c.ok = std::move(ok);
    cx += w; C.push_back(c);
    return C.back();
  };
  auto end = [&] { y += rowH + 18; };
  float tW = 150, tH = 96;
  auto tile = [&](const std::string &id, const std::string &label, const std::string &sub, bool on, std::function<void()> ok) {
    if (cx + tW > W - X0 + 1 && cx > VX) { cx = VX; y += tH + 10; }
    Cell c; c.kind = K_TILE; c.id = id; c.label = label; c.sub = sub; c.x = cx; c.y = y; c.w = tW; c.h = tH; c.on = on; c.ok = std::move(ok);
    cx += tW + 10; C.push_back(c);
  };
  auto endTiles = [&] { y += tH + 24; };
  auto radio = [&](const std::string &key, const std::string &v, const std::string &label) {
    put(K_RADIO, label, get(key) == v, [this, key, v, re] { set(key, v); re(); });
  };
  // a box you type a number into: digits any time it is lit; ENTER, then LEFT / RIGHT (UP / DOWN in tens)
  auto number = [&](const std::string &unit, bool on, std::function<int()> val, std::function<void(int)> setv) {
    Cell &c = put(K_NUM, "", on, [this] { editing = !editing; });
    c.sub = unit; c.val = val; c.setv = setv;
    c.left = [this, val, setv] { if (editing) setv(val() - 1); else move(Nav::Left); };
    c.right = [this, val, setv] { if (editing) setv(val() + 1); else move(Nav::Right); };
    c.up = [this, val, setv] { if (editing) setv(val() + 10); else move(Nav::Up); };
    c.down = [this, val, setv] { if (editing) setv(val() - 10); else move(Nav::Down); };
  };
  auto button = [&](const std::string &label, const std::string &id, std::function<void()> ok) {
    Cell c; c.kind = K_BTN; c.label = label; c.id = id; c.w = tw(13, label) * 1.9f + 80; c.h = 50; c.x = W - X0 - c.w; c.y = H - 78; c.ok = std::move(ok);
    C.push_back(c);
  };
  auto done = [&](int banner) { button("D O N E", "done", [this, banner] { show("setup", banner); }); };

  if (page == "setup") {
    // ---- five banners
    static const char *ID[5] = {"track", "mode", "sky", "level", "details"};
    static const char *NAME[5] = {"TRACK", "MODE", "TIME + WEATHER", "DIFFICULTY", "DETAILS"};
    const float gap = 16, bw = (W - 2 * X0 - 4 * gap) / 5, by = 130, bh = H - by - 150;
    for (int q = 0; q < 5; q++) {
      Cell c; c.kind = K_BANNER; c.id = ID[q]; c.label = NAME[q]; c.x = X0 + (float)q * (bw + gap); c.y = by; c.w = bw; c.h = bh;
      const std::string id = ID[q];
      if (id == "track") {
        const Outline &o = outline(S.track);
        char km[32]; std::snprintf(km, sizeof km, "%.3f KM", o.len / 1000);
        c.sub = up(circuitName(S.track)) + "\n" + (o.ok ? km : "");
        c.ok = [this] { const auto L = circuits(); int i = 0; for (size_t q2 = 0; q2 < L.size(); q2++) if (L[q2].id == S.track) i = (int)q2; show("track", i); };
      } else if (id == "mode") {
        std::string a = m == "gt" ? "GT" : m == "f1" ? "FORMULA 1" : m == "endurance" ? "ENDURANCE" : "HOT LAP", b;
        if (m == "hotlap") b = "ALONE AGAINST THE CLOCK";
        else if (m == "endurance") b = std::to_string(S.xMinutes) + " MINUTES  -  " + std::to_string(S.grid) + " CARS";
        else b = std::to_string(S.canon ? canonLaps() : S.laps) + (S.laps == 1 && !S.canon ? " LAP  -  " : " LAPS  -  ") + std::to_string(S.grid) + " CARS";
        c.sub = a + "\n" + b;
        c.ok = [this, m] { static const char *O[4] = {"gt", "f1", "endurance", "hotlap"}; int i = 0; for (int q2 = 0; q2 < 4; q2++) if (m == O[q2]) i = q2; show("mode", i); };
      } else if (id == "sky") {
        c.sub = (S.time == "live" ? std::string("THE REAL HOUR") : clockOf(hourOf(S.time)) + "  " + phaseOf(hourOf(S.time))) + "\n" + (S.wxAdv && S.zoneTrack == S.track && !S.zones.empty() ? std::to_string(S.zones.size()) + " AREAS OVER " : std::string()) + (S.weather == "live" ? std::string("THE REAL WEATHER") : up(S.weather));
        c.ok = [this] { show("sky", 0); };
      } else if (id == "level") {
        c.sub = m == "hotlap" ? (S.ghost ? "A GHOST\n" + up(tierFor(S.ghostTier)->name) + " PACE" : std::string("NOBODY TO BEAT\nBUT YOURSELF")) : up(tierFor(S.tier)->name) + "\nYOU START " + (S.start == "pole" ? "ON POLE" : S.start == "front" ? "AT THE FRONT" : S.start == "back" ? "LAST" : "MIDFIELD");
        c.ok = [this] { show("level", 0); };
      } else {
        c.sub = up(carSpec(seatCar()).full) + "\n" + (S.easy ? "EASY" : "REAL") + " HANDLING  -  " + (S.gears == "manual" ? "PADDLES" : "AUTOMATIC");
        c.ok = [this] { show("details", 0); };
      }
      C.push_back(c);
    }
    button(!noTeam() && S.teams[S.car].empty() ? "P I C K   A   T E A M" : "L I G H T S   O U T", "go", [this] { lightsOut(); });
    return C;
  }

  if (page == "track") {
    // ---- every circuit as a tile, its own outline scaled down
    const auto L = circuits();
    const int n = (int)L.size(), cols = n > 28 ? 9 : n > 21 ? 8 : 7, rows = std::max(1, (n + cols - 1) / cols);
    const float gap = 10, gy0 = 330, twd = (W - 2 * X0 - (float)(cols - 1) * gap) / (float)cols;
    const float th = std::min(140.0f, (H - 40 - gy0 - (float)(rows - 1) * gap) / (float)rows);
    for (int q = 0; q < n; q++) {
      Cell c; c.kind = K_TRACK; c.id = L[(size_t)q].id; c.label = L[(size_t)q].name; c.sub = L[(size_t)q].tag;
      c.x = X0 + (float)(q % cols) * (twd + gap); c.y = gy0 + (float)(q / cols) * (th + gap); c.w = twd; c.h = th; c.on = c.id == S.track;
      const std::string id = c.id;
      c.ok = [this, id] { S.track = id; dirty = true; show("setup", 0); };
      C.push_back(c);
    }
    return C;
  }

  if (page == "mode") {
    static const char *MODES[4][3] = {{"gt", "GT", "RACING. PICK THE LEAGUES."}, {"f1", "FORMULA 1", "OPEN WHEELS. LAPS."},
                                      {"endurance", "ENDURANCE", "GT CARS AGAINST THE CLOCK."}, {"hotlap", "HOT LAP", "ALONE. ONE CLEAN LAP."}};
    const float gap = 16, mw = (W - 2 * X0 - 3 * gap) / 4, my = 120, mh = 210;
    for (int q = 0; q < 4; q++) {
      Cell c; c.kind = K_MODE; c.id = MODES[q][0]; c.label = MODES[q][1]; c.sub = MODES[q][2];
      c.x = X0 + (float)q * (mw + gap); c.y = my; c.w = mw; c.h = mh; c.on = m == c.id;
      const std::string id = c.id;
      c.ok = [this, id, re] { setMode(id); re(); };
      C.push_back(c);
    }
    y = my + mh + 40;
    if (m == "gt" || m == "endurance") {
      line("LEAGUES ON THE ROAD");
      static const char *LG[3][2] = {{"hyper", "HYPERCAR"}, {"gt3", "GT3"}, {"gt4", "GT4"}};
      for (int q = 0; q < 3; q++) {
        const std::string key = LG[q][0];
        put(K_TOGGLE, LG[q][1], (S.leagues >> q) & 1, [this, q, key, re] {
          const int bit = 1 << q;
          click = (S.leagues & bit) ? 2 : 1;
          if (!(S.leagues & bit)) S.leagues |= bit;
          else if ((S.leagues & 7) == bit) { say("one league has to race."); return; }
          else {
            // switching your own league off moves you to the first one still racing
            if (S.gtClass == key) for (int o = 0; o < 3; o++) if (o != q && ((S.leagues >> o) & 1)) { set("carX", gtClass(o).key); break; }
            S.leagues &= ~bit;
          }
          syncLeagues(); dirty = true; re();
        });
      }
      end();
    }
    if (m == "gt" || m == "f1") {
      line("LAPS");
      tW = 104;
      static const int N[5] = {1, 3, 5, 10, 30};
      bool preset = false;
      for (int v : N) {
        const bool on = !S.canon && S.laps == v;
        preset = preset || on;
        tile("n:", std::to_string(v), v == 1 ? "LAP" : "LAPS", on, [this, v, re] { S.laps = v; S.canon = false; re(); });
      }
      tW = 150;
      tile("n:", std::to_string(canonLaps()), "CANON FOR HERE", S.canon, [this, re] { S.canon = true; S.laps = canonLaps(); re(); });
      number("YOUR OWN", !S.canon && !preset, [this] { return S.laps; }, [this](int v) { S.laps = std::max(1, std::min(999, v)); S.canon = false; });
      C.back().y += (tH - (rowH - 8)) / 2;
      endTiles();
    }
    if (m == "endurance") {
      line("LENGTH");
      tW = 124;
      static const int N[5] = {15, 30, 60, 120, 360};
      static const char *NM[5][2] = {{"15", "MINUTES"}, {"30", "MINUTES"}, {"1", "HOUR"}, {"2", "HOURS"}, {"6", "HOURS"}};
      bool preset = false;
      for (int q = 0; q < 5; q++) {
        const int v = N[q];
        preset = preset || S.xMinutes == v;
        tile("n:", NM[q][0], NM[q][1], S.xMinutes == v, [this, v, re] { S.xMinutes = v; re(); });
      }
      number("MINUTES, YOUR OWN", !preset, [this] { return S.xMinutes; }, [this](int v) { S.xMinutes = std::max(1, std::min(1440, v)); });
      C.back().y += (tH - (rowH - 8)) / 2;
      endTiles();
    }
    if (m == "hotlap") {
      line("A GHOST TO CHASE");
      put(K_TOGGLE, S.ghost ? "ON  -  IT LAPS WITH YOU, AND YOU CANNOT TOUCH IT" : "OFF", S.ghost, [this, re] { click = S.ghost ? 2 : 1; S.ghost = !S.ghost; re(); });
      end();
      if (S.ghost) {
        line("THE GHOST DRIVES");
        if (allTiers().size() > 4) {
          tW = 170; tH = 110;
          int q = 0;
          for (const Tier &t : allTiers()) { const std::string v = t.key; tile("t:" + std::to_string(q++) + "/" + std::to_string(allTiers().size()), up(t.name), "", S.ghostTier == v, [this, v, re] { S.ghostTier = v; re(); }); }
          endTiles();
        } else { for (const Tier &t : allTiers()) { const std::string v = t.key; put(K_RADIO, up(t.name), S.ghostTier == v, [this, v, re] { S.ghostTier = v; re(); }); } end(); }
      }
    }
    if (m != "hotlap") {
      line("CARS ON THE GRID");
      for (const char *v : {"6", "12", "16", "22"}) radio("grid", v, v);
      end();
    }
    if (m == "f1" && S.car == "f1") {
      line("WHO IS RACING");
      radio("field", "f1", "2026 GRID"); radio("field", "classic", "CLASSIC"); radio("field", "fantasy", "FANTASY"); radio("field", "all", "ALL ERAS");
      end();
    }
    done(1);
    return C;
  }

  if (page == "sky") {
    // ---- the sun goes round an orb; under it, the weather
    {
      Cell c; c.kind = K_SUN; c.id = "sun"; c.w = 560; c.h = 360; c.x = W / 2 - c.w / 2; c.y = 110;
      // half an hour a press, all the way round
      auto turn = [this](int d) {
        const double h = std::fmod(hourOf(S.time == "live" ? "day" : S.time) + 0.5 * d + 24.0, 24.0);
        char b[24]; std::snprintf(b, sizeof b, "h:%.1f", h);
        S.time = b;
      };
      c.left = [turn] { turn(-1); }; c.right = [turn] { turn(1); };
      c.ok = [turn] { turn(1); };
      C.push_back(c);
    }
    y = 500;
    line("THE HOUR");
    put(K_TOGGLE, "USE THE REAL HOUR, WHERE YOU ARE", S.time == "live", [this, re] { click = S.time == "live" ? 2 : 1; S.time = S.time == "live" ? "h:12.5" : "live"; re(); });
    end();
    line("WEATHER");
    tW = 150; tH = 110;
    static const char *WX[7][2] = {{"live", "THE REAL ONE"}, {"clear", "CLEAR"}, {"cloudy", "CLOUDY"}, {"overcast", "OVERCAST"}, {"rain", "RAIN"}, {"storm", "STORM"}, {"changing", "CHANGING"}};
    for (auto &wx : WX) { const std::string v = wx[0]; tile("w:" + v, wx[1], "", S.weather == v, [this, v, re] { S.weather = v; re(); }); }
    endTiles();
    line("BY AREA");
    const bool mine = S.zoneTrack == S.track;
    put(K_TOGGLE, "DIFFERENT WEATHER IN DIFFERENT PLACES", S.wxAdv, [this, re] { click = S.wxAdv ? 2 : 1; S.wxAdv = !S.wxAdv; re(); });
    if (S.wxAdv) put(K_RADIO, "OPEN THE MAP  -  " + std::to_string(mine ? S.zones.size() : 0) + " PLACED", false, [this] { show("wx", 0); });
    end();
    done(2);
    return C;
  }

  if (page == "wx") {
    // ---- the map on the left (drawn, not a cell); on the right what you can lay on it, and what is there
    const float cx0 = W - X0 - 330;
    Cell hd; hd.kind = K_HEAD; hd.x = cx0; hd.y = 104; hd.w = 330; hd.h = 30; hd.label = "LAY DOWN"; hd.focus = false;
    C.push_back(hd);
    for (int q = 0; q < 5; q++) {
      Cell c; c.kind = K_TILE; c.id = std::string("w:") + WX_KINDS[q][0]; c.label = WX_KINDS[q][1];
      c.x = cx0 + (float)(q % 3) * 112; c.y = 140 + (float)(q / 3) * 102; c.w = 104; c.h = 94;
      const std::string kind = WX_KINDS[q][0];
      c.ok = [this, kind] {
        if (S.zones.size() >= 8) { say("eight is plenty."); return; }
        const Outline &o = outline(S.track);
        MenuSave::WxZone z; z.kind = kind;
        z.x = o.ok ? (o.x0 + o.x1) / 2 : 0; z.y = o.ok ? -(o.y0 + o.y1) / 2 : 0; z.r = (o.ok ? std::max(o.x1 - o.x0, o.y1 - o.y0) : 1000) * 0.14f;
        S.zones.push_back(z); S.zoneTrack = S.track; wxAt = (int)S.zones.size() - 1; click = 1;
        build();
      };
      C.push_back(c);
    }
    Cell h2; h2.kind = K_HEAD; h2.x = cx0; h2.y = 352; h2.w = 330; h2.h = 30; h2.label = S.zones.empty() ? "NOTHING PLACED YET" : "PLACED  -  ENTER TO MOVE ONE"; h2.focus = false;
    C.push_back(h2);
    for (int q = 0; q < (int)S.zones.size(); q++) {
      Cell c; c.kind = K_RADIO; c.label = std::to_string(q + 1) + "   " + up(S.zones[(size_t)q].kind); c.on = wxAt == q;
      c.x = cx0 + (float)(q % 2) * 168; c.y = 388 + (float)(q / 2) * 46; c.w = 160; c.h = 40;
      c.ok = [this, q] { wxAt = q; click = 1; };
      C.push_back(c);
    }
    if (!S.zones.empty()) {
      Cell c; c.kind = K_RADIO; c.label = "TAKE THEM ALL OFF"; c.x = cx0; c.y = 388 + (float)(((int)S.zones.size() + 1) / 2) * 46 + 10; c.w = 300; c.h = 40;
      c.ok = [this] { S.zones.clear(); wxAt = -1; click = 2; show("wx", 0); };
      C.push_back(c);
    }
    button("D O N E", "done", [this] { wxAt = -1; show("sky", 0); });
    return C;
  }

  if (page == "level") {
    y = 150;
    if (m == "hotlap") {
      Cell c; c.kind = K_HEAD; c.x = X0; c.y = y; c.w = 900; c.h = rowH; c.label = "A HOT LAP HAS NOBODY IN IT BUT YOU. THESE ARE FOR A RACE."; c.focus = false;
      C.push_back(c);
      y += rowH + 18;
    }
    line("RIVALS");
    if (allTiers().size() > 4) {
      tW = 170; tH = 110;
      int q = 0;
      for (const Tier &t : allTiers()) { const std::string v = t.key; tile("t:" + std::to_string(q++) + "/" + std::to_string(allTiers().size()), up(t.name), "", S.tier == v, [this, v, re] { S.tier = v; re(); }); }
      endTiles();
    } else { for (const Tier &t : allTiers()) radio("tier", t.key, up(t.name)); end(); }
    if (S.tier == "supercasual") {
      line("THEY OVERTAKE");
      radio("battle", "easy", "RARELY"); radio("battle", "medium", "SOMETIMES"); radio("battle", "hard", "OFTEN");
      end();
    }
    line("YOU START");
    radio("start", "pole", "POLE"); radio("start", "front", "FRONT ROW"); radio("start", "mid", "MIDFIELD"); radio("start", "back", "LAST");
    end();
    done(3);
    return C;
  }

  // ---- details: the car (every one you may have, as tiles: the one you stand on is shown large above),
  // how it handles, who changes gear
  {
    struct Car { std::string cls, key, name; };
    std::vector<Car> L;
    auto klass = [&](const std::string &cls) {
      if (cls == "f4" || cls == "rally") { L.push_back({cls, "", up(carSpec(cls).full)}); return; }
      if (cls == "gt3" && !gt()) L.push_back({cls, "", "XBR GT3"});
      if (cls == "f1") L.push_back({cls, "", "XBR F1"});
      for (const Pack &p : packs) if (p.klass == cls) L.push_back({cls, p.key, up(p.title)});
    };
    if (m == "f1") { klass("f1"); klass("f4"); }
    else if (m == "hotlap") { klass("f1"); klass("f4"); klass("hyper"); klass("gt3"); klass("gt4"); klass("rally"); }
    else { klass("hyper"); klass("gt3"); klass("gt4"); }
    const int n = (int)L.size(), cols = n > 24 ? 8 : 6, rows = std::max(1, (n + cols - 1) / cols);
    const float gap = 10, gy0 = 300, cw = (W - 2 * X0 - (float)(cols - 1) * gap) / (float)cols;
    const float ch = std::min(92.0f, (H - 270 - gy0 - (float)(rows - 1) * gap) / (float)rows);
    for (int q = 0; q < n; q++) {
      const Car car = L[(size_t)q];
      const bool models = car.cls != "f4" && car.cls != "rally";
      Cell c; c.kind = K_TILE; c.id = "c:" + car.cls; c.label = car.name;
      c.sub = (car.cls == "hyper" ? std::string("HYPERCAR") : up(car.cls)) + "|" + car.key;
      c.x = X0 + (float)(q % cols) * (cw + gap); c.y = gy0 + (float)(q / cols) * (ch + gap); c.w = cw; c.h = ch;
      c.on = seatCar() == car.cls && (!models || pack() == car.key);
      c.ok = [this, car, models, re] {
        set("carX", car.cls);
        if (S.mode == "race" && S.car == "gt3") syncLeagues();
        if (models) set("model", car.key);
        re();
      };
      C.push_back(c);
    }
    y = gy0 + (float)rows * (ch + gap) + 16;
  }
  {
    // YOUR LIVERY on the car you have: the liveries baked for it (data/livery/<key>.json), or the team's paint
    const std::string key = pack();
    static std::map<std::string, std::vector<std::string>> NAMES;
    if (!key.empty() && !NAMES.count(key)) {
      std::vector<std::string> v;
      const Json j = Json::loadOpt(dataDir + "/livery/" + key + ".json");
      for (size_t q = 0; q < j.size(); q++) v.push_back(j[q]["name"].s(""));
      NAMES[key] = v;
    }
    const int n = key.empty() ? 0 : (int)NAMES[key].size();
    if (n > 0) {
      line("LIVERY");
      const auto it = S.liveryBy.find(key);
      const int cur = it == S.liveryBy.end() ? -1 : std::min(n - 1, it->second);
      Cell c; c.kind = K_STEP; c.x = VX; c.y = y; c.w = 760; c.h = rowH - 8;
      c.label = cur < 0 ? "THE TEAM'S OWN PAINT" : up(NAMES[key][(size_t)cur]);
      c.sub = cur < 0 ? "-- / " + std::to_string(n) : std::to_string(cur + 1) + " / " + std::to_string(n);
      auto stepBy = [this, key, cur, n](int d) { int v = cur + d; if (v < -1) v = n - 1; if (v >= n) v = -1; if (v < 0) S.liveryBy.erase(key); else S.liveryBy[key] = v; click = 3; };
      c.left = [stepBy] { stepBy(-1); }; c.right = [stepBy] { stepBy(1); }; c.ok = [stepBy] { stepBy(1); };
      C.push_back(c);
      end();
    }
  }
  line("HANDLING");
  radio("easy", "false", "REAL"); radio("easy", "true", "EASY");
  end();
  line("GEARS");
  radio("gears", "auto", "AUTOMATIC"); radio("gears", "manual", "MANUAL  -  PADDLES");
  end();
  done(4);
  return C;
}

// ---- the drawing ------------------------------------------------------------------------------
void Home::drawRace(Renderer &R, float k, double clock) {
  const float W = (float)R.W / k, H = (float)R.H / k, X0 = 70;
  mW = W; mH = H;
  const int A = Renderer::ANTON, RB = Renderer::RUBIK;
  auto text = [&](float x, float y, float size, const std::string &s, const Rgba &c, Align al = LEFT, int font = 1, float track = 0) {
    return R.textPx(x * k, y * k, size * k, s, c, al, font, track) / k;
  };
  auto width = [&](float size, const std::string &s, int font = 1, float track = 0) { return R.widthPx(size * k, s, font, track) / k; };
  auto hot = [&](float x, float y, float w, float h, int item, std::function<void()> fn = nullptr) { hots.push_back({x * k, y * k, w * k, h * k, item, std::move(fn)}); };
  auto seg = [&](float x0, float y0, float x1, float y1, float w, const Rgba &c) { const float p[4] = {x0 * k, y0 * k, x1 * k, y1 * k}; R.path(p, 2, w * k, c, false); };
  auto ring = [&](float cx, float cy, float r, float w, const Rgba &c) {
    float p[96];
    for (int q = 0; q < 48; q++) { const float a = (float)q / 48 * 6.2831853f; p[q * 2] = (cx + std::cos(a) * r) * k; p[q * 2 + 1] = (cy + std::sin(a) * r) * k; }
    R.path(p, 48, w * k, c, true);
  };
  auto box = [&](float x, float y, float w, float h, float bw, const Rgba &c) {      // a frame, nothing inside it
    R.rect(x * k, y * k, w * k, bw * k, c); R.rect(x * k, (y + h - bw) * k, w * k, bw * k, c);
    R.rect(x * k, y * k, bw * k, h * k, c); R.rect((x + w - bw) * k, y * k, bw * k, h * k, c);
  };
  auto mini = [&](float x, float y, float w, float h, const std::string &id, float stroke, const Rgba &c) {
    const Outline &o = outline(id);
    if (!o.ok) return;
    const float size = std::max(o.x1 - o.x0, o.y1 - o.y0), pad = size * 0.06f;
    const float vw = o.x1 - o.x0 + 2 * pad, vh = o.y1 - o.y0 + 2 * pad, sc = std::min(w / vw, h / vh);
    const float ox = x + (w - vw * sc) / 2 - (o.x0 - pad) * sc, oy = y + (h - vh * sc) / 2 - (o.y0 - pad) * sc;
    std::vector<float> p(o.xy.size());
    for (size_t i = 0; i < o.xy.size(); i += 2) { p[i] = (ox + o.xy[i] * sc) * k; p[i + 1] = (oy + o.xy[i + 1] * sc) * k; }
    R.path(p.data(), (int)p.size() / 2, stroke * k, c, true);
  };
  const Rgba PANEL = alpha_(CARD, 0.82f), DARK = hex("#0d0e12");
  // the photograph steps back: these pages are for reading. (DETAILS stands on the showroom: the car, top left, is left in the light)
  if (page == "details") { R.rect(0, 290 * k, (float)R.W, (float)R.H - 290 * k, hex("#08080b", 0.72f)); R.rect(540 * k, 0, (float)R.W - 540 * k, 290 * k, hex("#08080b", 0.55f)); }
  else R.rect(0, 0, (float)R.W, (float)R.H, hex("#08080b", 0.5f));

  // ---- the icons: a few plain shapes each, seen from above
  auto iconF1 = [&](float cx, float cy, float s, const Rgba &c) {
    R.rrect((cx - s * 0.07f) * k, (cy - s * 0.46f) * k, s * 0.14f * k, s * 0.92f * k, s * 0.06f * k, c);          // the tub and the nose
    R.rect((cx - s * 0.36f) * k, (cy - s * 0.50f) * k, s * 0.72f * k, s * 0.07f * k, c);                         // front wing
    R.rect((cx - s * 0.27f) * k, (cy + s * 0.41f) * k, s * 0.54f * k, s * 0.09f * k, c);                         // rear wing
    R.rrect((cx - s * 0.22f) * k, (cy - s * 0.08f) * k, s * 0.44f * k, s * 0.30f * k, s * 0.07f * k, c);          // sidepods
    for (int q = 0; q < 4; q++) {
      const float wx = (q & 1 ? 1.0f : -1.0f) * s * 0.33f, wy = q < 2 ? -s * 0.30f : s * 0.22f;
      R.rrect((cx + wx - s * 0.07f) * k, (cy + wy - s * 0.11f) * k, s * 0.14f * k, s * 0.22f * k, s * 0.04f * k, c);
    }
  };
  auto iconGT = [&](float cx, float cy, float s, const Rgba &c, const Rgba &hole) {
    for (int q = 0; q < 4; q++) {
      const float wx = (q & 1 ? 1.0f : -1.0f) * s * 0.26f, wy = q < 2 ? -s * 0.27f : s * 0.25f;
      R.rrect((cx + wx - s * 0.06f) * k, (cy + wy - s * 0.10f) * k, s * 0.12f * k, s * 0.20f * k, s * 0.03f * k, c);
    }
    R.rrect((cx - s * 0.26f) * k, (cy - s * 0.47f) * k, s * 0.52f * k, s * 0.92f * k, s * 0.13f * k, c);          // the body
    R.rrect((cx - s * 0.18f) * k, (cy - s * 0.12f) * k, s * 0.36f * k, s * 0.30f * k, s * 0.06f * k, hole);       // the glass
    R.rect((cx - s * 0.30f) * k, (cy + s * 0.42f) * k, s * 0.60f * k, s * 0.07f * k, c);                         // the wing
  };
  auto iconClock = [&](float cx, float cy, float s, const Rgba &c) {      // endurance: a clock, and it is late
    ring(cx, cy, s * 0.42f, s * 0.06f, c);
    for (int q = 0; q < 12; q++) { const float a = (float)q / 12 * 6.2831853f; seg(cx + std::cos(a) * s * 0.33f, cy + std::sin(a) * s * 0.33f, cx + std::cos(a) * s * 0.37f, cy + std::sin(a) * s * 0.37f, s * 0.025f, c); }
    seg(cx, cy, cx, cy - s * 0.28f, s * 0.05f, c);
    seg(cx, cy, cx + s * 0.17f, cy + s * 0.10f, s * 0.05f, c);
    R.circle(cx * k, cy * k, s * 0.045f * k, c);
  };
  auto iconWatch = [&](float cx, float cy, float s, const Rgba &c) {      // hot lap: a stopwatch
    const float yy = cy + s * 0.06f;
    ring(cx, yy, s * 0.36f, s * 0.06f, c);
    R.rect((cx - s * 0.06f) * k, (yy - s * 0.50f) * k, s * 0.12f * k, s * 0.10f * k, c);
    R.rect((cx - s * 0.12f) * k, (yy - s * 0.56f) * k, s * 0.24f * k, s * 0.07f * k, c);
    seg(cx + s * 0.29f, yy - s * 0.30f, cx + s * 0.36f, yy - s * 0.37f, s * 0.07f, c);
    seg(cx, yy, cx + s * 0.15f, yy - s * 0.20f, s * 0.05f, c);
    R.circle(cx * k, yy * k, s * 0.045f * k, c);
  };
  auto iconMode = [&](const std::string &id, float cx, float cy, float s, const Rgba &c) {
    if (id == "f1") iconF1(cx, cy, s, c);
    else if (id == "gt") iconGT(cx, cy, s, c, hex("#0d0e12"));
    else if (id == "endurance") iconClock(cx, cy, s, c);
    else iconWatch(cx, cy, s, c);
  };
  // the sun on its way round the orb
  auto orb = [&](float cx, float cy, float r, bool big) {
    const bool live = S.time == "live";
    double h = hourOf(S.time);
    if (live) { const std::time_t t = std::time(nullptr); const std::tm *lt = std::localtime(&t); h = lt->tm_hour + lt->tm_min / 60.0; }
    auto degOf = [](double hh) { return (float)(180.0 - (hh - 6.0) * 15.0); };      // 06:00 on the left horizon, noon overhead, midnight underneath
    const float orbit = r * 1.75f;
    ring(cx, cy, orbit, big ? 1.5f : 1.0f, alpha_(INK, 0.28f));
    R.circle(cx * k, cy * k, r * k, alpha_(INK, 0.16f));
    R.circle(cx * k, cy * k, (r - (big ? 2.5f : 1.5f)) * k, hex("#0d0e12"));
    R.rect((cx - orbit - r * 0.5f) * k, cy * k, (2 * orbit + r) * k, 1 * k, alpha_(INK, 0.35f));      // the horizon
    if (big) for (int q = 0; q < 8; q++) {
      const float a = degOf(NAME_HOUR[q]) * 0.0174533f, px = cx + std::cos(a) * orbit, py = cy - std::sin(a) * orbit;
      R.circle(px * k, py * k, 3.5f * k, alpha_(INK, 0.45f));
      const float lx = cx + std::cos(a) * (orbit + 26), ly = cy - std::sin(a) * (orbit + 26);
      text(lx, ly - 6, 10, up(TIMES[q]), up(TIMES[q]) == phaseOf(h) ? INK : alpha_(INK, 0.5f), std::cos(a) > 0.3f ? LEFT : std::cos(a) < -0.3f ? RIGHT : CENTRE, RB, 0.3f);
    }
    const float a = degOf(h) * 0.0174533f, px = cx + std::cos(a) * orbit, py = cy - std::sin(a) * orbit;
    const bool below = std::sin(a) < -0.05f;
    const Rgba sun = live ? mix(INK, hex("#0d0e12"), 0.6f) : below ? hex("#9fb4ff") : hex("#ffd23f");
    R.circle(px * k, py * k, r * 0.26f * k, alpha_(sun, 0.25f));
    R.circle(px * k, py * k, r * 0.17f * k, sun);
  };

  // ---- the top of every page: the mark, where you are, what you have chosen
  const std::string m = modeNow();
  static const char *SLUG[7][2] = {{"setup", "R A C E   S E T U P"}, {"track", "T R A C K"}, {"mode", "M O D E"}, {"sky", "T I M E   +   W E A T H E R"},
                                   {"level", "D I F F I C U L T Y"}, {"details", "D E T A I L S"}, {"wx", "W E A T H E R   B Y   A R E A"}};
  {
    const float w1 = text(X0, 26, 40, "XB", INK, LEFT, A, 0.02f);
    text(X0 + w1, 26, 40, "R", RED, LEFT, A, 0.02f);
    std::string slug;
    for (auto &sg : SLUG) if (page == sg[0]) slug = sg[1];
    text(X0 + w1 + 44, 42, 11, slug, SOFT, LEFT, RB, 0.4f);
    const std::string who = up(circuitName(S.track)) + "  -  " + (m == "gt" ? "GT" : m == "f1" ? "FORMULA 1" : m == "endurance" ? "ENDURANCE" : "HOT LAP") + "  -  " + up(carSpec(seatCar()).full);
    text(W - X0, 42, 11, who, SOFT, RIGHT, RB, 0.32f);
  }

  std::vector<Cell> C = cells(W, H, [&](float sz, const std::string &t) { return width(sz, t, A, 0.04f); });
  // the number box you are standing on takes digits from the keyboard
  {
    int idx = 0;
    const Cell *numAt = nullptr;
    for (const Cell &c : C) if (c.focus) { if (idx == at && c.kind == K_NUM) numAt = &c; idx++; }
    static bool was[10] = {false};
    const bool *keys = SDL_GetKeyboardState(nullptr);
    for (int d = 0; d < 10; d++) {
      const bool down = keys && (keys[d == 0 ? SDL_SCANCODE_0 : SDL_SCANCODE_1 + d - 1] || keys[d == 0 ? SDL_SCANCODE_KP_0 : SDL_SCANCODE_KP_1 + d - 1]);
      if (down && !was[d] && numAt) {
        if (typedAt != at || typed.size() >= 4) typed.clear();
        typedAt = at;
        typed += (char)('0' + d);
        numAt->setv(std::atoi(typed.c_str()));
      }
      was[d] = down;
    }
    if (!numAt) { typedAt = -1; editing = false; }
  }
  C = cells(W, H, [&](float sz, const std::string &t) { return width(sz, t, A, 0.04f); });      // (a typed number may have moved a circle)
  lastCells = C;

  // ---- TRACK: the one you are standing on, large, across the top
  if (page == "track") {
    int idx = 0;
    const Cell *f = nullptr;
    for (const Cell &c : C) if (c.focus) { if (idx == at) f = &c; idx++; }
    if (f) {
      drawMap(R, k, X0 - 8, 84, 330, 226, f->id, true, clock);
      const float tx = X0 + 360;
      const std::string name = up(f->label);
      float size = 96;
      while (size > 48 && width(size, name, A, 0.03f) > W - tx - X0) size -= 6;
      const float sw = text(tx, 100, 11, "C I R C U I T", RED, LEFT, RB, 0.4f);
      if (f->on) text(tx + sw + 18, 100, 11, "YOURS NOW", SOFT, LEFT, RB, 0.3f);
      const float nw = text(tx, 122, size, name, INK, LEFT, A, 0.03f);
      R.rect(tx * k, (122 + size + 8) * k, nw * k, 3 * k, RED);
      const Outline &o = outline(f->id);
      char km[32]; std::snprintf(km, sizeof km, "%.3f KM", o.len / 1000);
      text(tx, 122 + size + 26, 12, up(f->sub) + (o.ok ? std::string("  -  ") + km : ""), alpha_(INK, 0.85f), LEFT, RB, 0.32f);
    }
  }

  // weather, as small pictures
  auto cloud = [&](float cx, float cy, float s, const Rgba &c) {
    R.circle((cx - s * 0.22f) * k, (cy + s * 0.04f) * k, s * 0.17f * k, c); R.circle((cx + s * 0.02f) * k, (cy - s * 0.08f) * k, s * 0.23f * k, c);
    R.circle((cx + s * 0.25f) * k, (cy + s * 0.05f) * k, s * 0.15f * k, c);
    R.rrect((cx - s * 0.38f) * k, (cy + s * 0.02f) * k, s * 0.78f * k, s * 0.20f * k, s * 0.10f * k, c);
  };
  auto iconWx = [&](const std::string &w, float cx, float cy, float s, const Rgba &c) {
    const Rgba sun = hex("#ffd23f");
    if (w == "clear") { R.circle(cx * k, cy * k, s * 0.22f * k, sun); for (int q = 0; q < 8; q++) { const float a = (float)q / 8 * 6.2831853f; seg(cx + std::cos(a) * s * 0.30f, cy + std::sin(a) * s * 0.30f, cx + std::cos(a) * s * 0.40f, cy + std::sin(a) * s * 0.40f, s * 0.05f, sun); } }
    else if (w == "cloudy") { R.circle((cx + s * 0.18f) * k, (cy - s * 0.14f) * k, s * 0.18f * k, sun); cloud(cx - s * 0.04f, cy + s * 0.04f, s, c); }
    else if (w == "overcast") { cloud(cx + s * 0.12f, cy - s * 0.12f, s * 0.8f, mix(c, hex("#0d0e12"), 0.5f)); cloud(cx - s * 0.04f, cy + s * 0.06f, s, c); }
    else if (w == "rain") { cloud(cx, cy - s * 0.12f, s, c); for (int q = -1; q <= 1; q++) seg(cx + (float)q * s * 0.2f + s * 0.04f, cy + s * 0.18f, cx + (float)q * s * 0.2f - s * 0.04f, cy + s * 0.40f, s * 0.05f, hex("#7fb2ff")); }
    else if (w == "storm") {
      cloud(cx, cy - s * 0.12f, s, c);
      const float b[12] = {(cx + s * 0.06f) * k, (cy + s * 0.10f) * k, (cx - s * 0.10f) * k, (cy + s * 0.30f) * k, (cx + s * 0.00f) * k, (cy + s * 0.30f) * k,
                           (cx - s * 0.06f) * k, (cy + s * 0.50f) * k, (cx + s * 0.14f) * k, (cy + s * 0.24f) * k, (cx + s * 0.03f) * k, (cy + s * 0.24f) * k};
      R.path(b, 6, s * 0.05f * k, sun, true);
    }
    else if (w == "changing") { R.circle((cx - s * 0.20f) * k, (cy - s * 0.10f) * k, s * 0.16f * k, sun); cloud(cx + s * 0.12f, cy - s * 0.02f, s * 0.7f, c); seg(cx - s * 0.30f, cy + s * 0.34f, cx + s * 0.30f, cy + s * 0.34f, s * 0.04f, c); seg(cx + s * 0.30f, cy + s * 0.34f, cx + s * 0.20f, cy + s * 0.26f, s * 0.04f, c); seg(cx + s * 0.30f, cy + s * 0.34f, cx + s * 0.20f, cy + s * 0.42f, s * 0.04f, c); }
    else { ring(cx, cy, s * 0.28f, s * 0.04f, c); seg(cx - s * 0.28f, cy, cx + s * 0.28f, cy, s * 0.03f, c); seg(cx, cy - s * 0.28f, cx, cy + s * 0.28f, s * 0.03f, c); }      // the real one: a globe
  };
  auto iconCar = [&](const std::string &cls, float cx, float cy, float s, const Rgba &c) {
    if (cls == "f1" || cls == "f4") iconF1(cx, cy, cls == "f4" ? s * 0.82f : s, c); else iconGT(cx, cy, s, c, hex("#0d0e12"));
  };
  // ---- DETAILS: the car you are standing on (or the one that is yours), large, across the top
  if (page == "details") {
    int q = 0;
    const Cell *f = nullptr, *mine = nullptr;
    for (const Cell &c : C) if (c.focus) { if (c.kind == K_TILE && c.on) mine = &c; if (q == at && c.kind == K_TILE) f = &c; q++; }
    if (!f) f = mine;
    // the showroom draws THIS car, turning, in the top left corner (game_main.cpp, Renderer::turntable)
    showKey = f && f->sub.find('|') != std::string::npos ? f->sub.substr(f->sub.find('|') + 1) : pack();
    if (f) {
      const float tx = 560;
      float size = 88;
      while (size > 34 && width(size, f->label, A, 0.03f) > W - tx - X0 - 470) size -= 4;
      const float sw = text(tx, 100, 11, "C A R", RED, LEFT, RB, 0.4f);
      if (f->on) text(tx + sw + 18, 100, 11, "YOURS NOW", SOFT, LEFT, RB, 0.3f);
      const float nw = text(tx, 122, size, f->label, INK, LEFT, A, 0.03f);
      R.rect(tx * k, (122 + size + 8) * k, nw * k, 3 * k, RED);
      const std::string cls = f->id.substr(2), key = f->sub.find('|') == std::string::npos ? "" : f->sub.substr(f->sub.find('|') + 1);
      const Spec &sp = carSpec(cls);
      const BoxSpec &bx = boxFor(key.empty() ? cls : cls + ":" + key);
      char rev[48]; std::snprintf(rev, sizeof rev, "  -  %d RPM", (int)bx.limit);
      text(tx, 122 + size + 26, 12, up(sp.full) + "  -  " + engineOf(cls, key) + rev, alpha_(INK, 0.85f), LEFT, RB, 0.32f);
      // THE NUMBERS: the class's own (every car of a class is the same car to the physics; the engine note is its own)
      const double hp = sp.Pmax / 745.7, top = std::cbrt(2 * sp.Pmax / (sp.rho * sp.CdA)) * 3.6;
      const double grip = sp.mu * (1 + 0.5 * sp.rho * sp.ClA * 55.6 * 55.6 / (sp.m * 9.81));      // sideways g at 200 km/h
      struct Stat { const char *name; double v, lo, hi; const char *fmt; } ST[4] = {
          {"POWER", hp, 100, 1000, "%.0f HP"}, {"WEIGHT", sp.m, 500, 1500, "%.0f KG"}, {"TOP SPEED", top, 180, 380, "%.0f KM/H"}, {"CORNERING", grip, 1, 5, "%.1f G"}};
      const float sx = W - X0 - 430, bw = 190;
      for (int q2 = 0; q2 < 4; q2++) {
        const float sy = 104 + (float)q2 * 40;
        text(sx, sy + 4, 10, ST[q2].name, SOFT, LEFT, RB, 0.3f);
        R.rect((sx + 120) * k, (sy + 4) * k, bw * k, 10 * k, alpha_(INK, 0.16f));
        const float fr = (float)std::max(0.04, std::min(1.0, (ST[q2].v - ST[q2].lo) / (ST[q2].hi - ST[q2].lo)));
        R.rect((sx + 120) * k, (sy + 4) * k, bw * fr * k, 10 * k, q2 == 1 ? INK : RED);
        char v[32]; std::snprintf(v, sizeof v, ST[q2].fmt, ST[q2].v);
        text(sx + 120 + bw + 14, sy - 2, 18, v, INK, LEFT, A, 0.04f);
      }
    }
  }

  // ---- THE WEATHER MAP: the circuit, and the weather lying on it
  if (page == "wx") {
    const float mx = X0, my = 96, mw = W - 2 * X0 - 370, mh = H - my - 110;
    R.rect(mx * k, my * k, mw * k, mh * k, alpha_(CARD, 0.55f));
    box(mx, my, mw, mh, 1, alpha_(INK, 0.2f));
    const Outline &o = outline(S.track);
    if (o.ok) {
      const float size = std::max(o.x1 - o.x0, o.y1 - o.y0), pad = size * 0.12f;
      const float vw = o.x1 - o.x0 + 2 * pad, vh = o.y1 - o.y0 + 2 * pad, sc = std::min(mw / vw, mh / vh);
      const float ox = mx + (mw - vw * sc) / 2 - (o.x0 - pad) * sc, oy = my + (mh - vh * sc) / 2 - (o.y0 - pad) * sc;
      auto colOf = [&](const std::string &kd) { return kd == "clear" ? hex("#ffd23f") : kd == "cloudy" ? hex("#c9ced6") : kd == "overcast" ? hex("#8a909c") : kd == "rain" ? hex("#4f8dff") : hex("#9a5cff"); };
      for (int q = 0; q < (int)S.zones.size(); q++) {
        const MenuSave::WxZone &z = S.zones[(size_t)q];
        const float cx = ox + z.x * sc, cy = oy - z.y * sc, ra = z.r * z.stretch * sc, rb = z.r * sc, cr = std::cos(z.rot), sr = std::sin(z.rot);
        float pts[80];
        for (int e = 0; e < 40; e++) {
          const float a = (float)e / 40 * 6.2831853f, ux = std::cos(a) * ra, uy = std::sin(a) * rb;
          pts[e * 2] = (cx + ux * cr - uy * sr) * k; pts[e * 2 + 1] = (cy + ux * sr + uy * cr) * k;
        }
        const Rgba col = colOf(z.kind);
        R.poly(pts, 40, alpha_(col, q == wxAt ? 0.42f : 0.26f));
        R.path(pts, 40, (q == wxAt ? 3.0f : 1.5f) * k, q == wxAt ? RED : alpha_(col, 0.9f), true);
        text(cx, cy - 8, 16, std::to_string(q + 1), INK, CENTRE, A);
      }
      std::vector<float> p(o.xy.size());
      for (size_t i = 0; i < o.xy.size(); i += 2) { p[i] = (ox + o.xy[i] * sc) * k; p[i + 1] = (oy + o.xy[i + 1] * sc) * k; }
      R.path(p.data(), (int)p.size() / 2, 3.5f * k, INK, true);
    }
    if (wxAt >= 0) {
      text(mx + mw / 2, my + mh - 46, 11, "D-PAD MOVES IT  -  Y GROWS  -  A SHRINKS (TO NOTHING = GONE)  -  X / B TURN  -  START SETS IT DOWN", INK, CENTRE, RB, 0.22f);
      text(mx + mw / 2, my + mh - 26, 10, "KEYS:  ARROWS  -  = AND -  -  [ AND ]  -  ENTER", alpha_(INK, 0.6f), CENTRE, RB, 0.26f);
    } else text(mx + mw / 2, my + mh - 30, 10, S.zones.empty() ? "PICK A KIND OF WEATHER ON THE RIGHT: IT LANDS IN THE MIDDLE, IN YOUR HANDS" : "EVERYWHERE ELSE HAS THE WEATHER YOU CHOSE ON THE PAGE BEFORE", alpha_(INK, 0.6f), CENTRE, RB, 0.26f);
  }

  int idx = -1;
  for (const Cell &c : C) {
    if (c.focus) idx++;
    const bool on = c.focus && idx == at && !(page == "wx" && wxAt >= 0);
    if (c.focus) hot(c.x, c.y, c.w, c.h, idx);
    switch (c.kind) {
      case K_HEAD: text(c.x, c.y + 16, 11, c.label, SOFT, LEFT, RB, 0.34f); break;
      case K_BANNER: {
        R.rect(c.x * k, c.y * k, c.w * k, c.h * k, PANEL);
        box(c.x, c.y, c.w, c.h, on ? 3.0f : 1.0f, on ? RED : alpha_(INK, 0.3f));
        float size = 40;
        while (size > 24 && width(size, c.label, A, 0.03f) > c.w - 44) size -= 2;
        const float tw2 = text(c.x + 22, c.y + 22, size, c.label, INK, LEFT, A, 0.03f);
        R.rect((c.x + 22) * k, (c.y + 22 + size + 8) * k, (on ? tw2 : 44) * k, 3 * k, RED);
        const float cx = c.x + c.w / 2, cy = c.y + c.h * 0.47f, s = std::min(c.w * 0.62f, c.h * 0.36f);
        const Rgba ic = on ? INK : mix(INK, DARK, 0.78f);
        if (c.id == "track") mini(c.x + 24, cy - s * 0.62f, c.w - 48, s * 1.24f, S.track, 3.0f, ic);
        else if (c.id == "mode") iconMode(m, cx, cy, s, ic);
        else if (c.id == "sky") orb(cx, cy + s * 0.12f, s * 0.26f, false);
        else if (c.id == "level") {
          // bars, as many lit as the rivals are hard
          const auto &T = allTiers();
          int lvl = 0;
          for (size_t q = 0; q < T.size(); q++) if (S.tier == T[q].key) lvl = (int)q;
          const int nb = (int)T.size();
          const float bw = s * 0.9f / (float)nb;
          for (int q = 0; q < nb; q++) {
            const float bh = s * (0.25f + 0.75f * (float)(q + 1) / (float)nb);
            R.rect((cx - s * 0.45f + (float)q * bw) * k, (cy + s * 0.5f - bh) * k, (bw - 6) * k, bh * k, q <= lvl ? ic : alpha_(INK, 0.2f));
          }
        } else {
          // a steering wheel
          ring(cx, cy, s * 0.40f, s * 0.08f, ic);
          seg(cx - s * 0.38f, cy, cx + s * 0.38f, cy, s * 0.07f, ic);
          seg(cx, cy, cx, cy + s * 0.38f, s * 0.07f, ic);
          R.circle(cx * k, cy * k, s * 0.10f * k, ic);
        }
        const size_t nl = c.sub.find('\n');
        const std::string l1 = c.sub.substr(0, nl), l2 = nl == std::string::npos ? "" : c.sub.substr(nl + 1);
        float s1 = 28;
        while (s1 > 16 && width(s1, l1, A, 0.04f) > c.w - 44) s1 -= 2;
        text(c.x + 22, c.y + c.h - 86, s1, l1, INK, LEFT, A, 0.04f);
        float t2 = 0.26f;
        while (t2 > 0.02f && width(10, l2, RB, t2) > c.w - 44) t2 -= 0.04f;
        text(c.x + 22, c.y + c.h - 42, 10, l2, alpha_(INK, 0.7f), LEFT, RB, t2);
        break;
      }
      case K_TRACK: {
        R.rect(c.x * k, c.y * k, c.w * k, c.h * k, on ? alpha_(CARD, 0.95f) : alpha_(CARD, 0.66f));
        box(c.x, c.y, c.w, c.h, on ? 3.0f : c.on ? 2.0f : 1.0f, on ? RED : c.on ? INK : alpha_(INK, 0.22f));
        mini(c.x + 10, c.y + 8, c.w - 20, c.h - 38, c.id, on ? 2.6f : 2.0f, on || c.on ? INK : alpha_(INK, 0.7f));
        std::string nm = up(c.label);
        float tr = 0.2f;
        while (tr > 0.0f && width(10, nm, RB, tr) > c.w - 14) tr -= 0.05f;
        text(c.x + c.w / 2, c.y + c.h - 22, 10, nm, on || c.on ? INK : alpha_(INK, 0.62f), CENTRE, RB, std::max(0.0f, tr));
        if (c.on) R.rect((c.x + 8) * k, (c.y + 8) * k, 8 * k, 8 * k, RED);
        break;
      }
      case K_TILE: {
        R.rect(c.x * k, c.y * k, c.w * k, c.h * k, on || c.on ? alpha_(CARD, 0.95f) : alpha_(CARD, 0.66f));
        box(c.x, c.y, c.w, c.h, on ? 3.0f : c.on ? 2.0f : 1.0f, on ? RED : c.on ? INK : alpha_(INK, 0.22f));
        if (c.on) R.rect((c.x + 8) * k, (c.y + 8) * k, 8 * k, 8 * k, RED);
        const Rgba ic = on || c.on ? INK : mix(INK, DARK, 0.62f);
        auto fit = [&](const std::string &t, float x, float y, float room, Align al) {
          float tr = 0.2f;
          while (tr > 0.0f && width(10, t, RB, tr) > room) tr -= 0.05f;
          text(x, y, 10, t, ic, al, RB, std::max(0.0f, tr));
        };
        const std::string kind = c.id.substr(0, 2), rest = c.id.substr(2);
        if (kind == "n:") {
          text(c.x + c.w / 2, c.y + c.h / 2 - 34, 42, c.label, ic, CENTRE, A, 0.03f);
          fit(c.sub, c.x + c.w / 2, c.y + c.h - 24, c.w - 12, CENTRE);
        } else if (kind == "w:") {
          iconWx(rest, c.x + c.w / 2, c.y + c.h / 2 - 12, c.h * 0.62f, ic);
          fit(c.label, c.x + c.w / 2, c.y + c.h - 22, c.w - 12, CENTRE);
        } else if (kind == "t:") {
          int lvl = 0, nb = 1;
          std::sscanf(rest.c_str(), "%d/%d", &lvl, &nb);
          const float bw = 14, x0 = c.x + c.w / 2 - (float)nb * bw / 2, base = c.y + c.h - 40;
          for (int q = 0; q < nb; q++) { const float bh = 12 + 40 * (float)(q + 1) / (float)nb; R.rect((x0 + (float)q * bw) * k, (base - bh) * k, (bw - 4) * k, bh * k, q <= lvl ? ic : alpha_(INK, 0.18f)); }
          fit(c.label, c.x + c.w / 2, c.y + c.h - 22, c.w - 12, CENTRE);
        } else {
          iconCar(rest, c.x + 34, c.y + c.h / 2, std::min(64.0f, c.h * 0.8f), ic);
          const float tx = c.x + 68, room = c.x + c.w - tx - 8;
          float size = 20;
          while (size > 11 && width(size, c.label, A, 0.03f) > room) size -= 1;
          text(tx, c.y + c.h / 2 - size * 0.5f - 8, size, c.label, ic, LEFT, A, 0.03f);
          fit(c.sub.substr(0, c.sub.find('|')), tx, c.y + c.h / 2 + size * 0.5f, room, LEFT);
        }
        break;
      }
      case K_STEP: {
        const float cy = c.y + c.h / 2;
        text(c.x, cy - 12, 20, "<", on ? INK : alpha_(INK, 0.4f), LEFT, RB);
        const float nw = text(c.x + 34, cy - 15, 24, c.label, on ? INK : alpha_(INK, 0.8f), LEFT, A, 0.04f);
        text(c.x + 34 + nw + 18, cy - 12, 20, ">", on ? INK : alpha_(INK, 0.4f), LEFT, RB);
        text(c.x + 34 + nw + 56, cy - 5, 10, c.sub + (on ? "   LEFT / RIGHT: THE CAR ABOVE WEARS IT" : ""), alpha_(INK, 0.6f), LEFT, RB, 0.3f);
        if (on) R.rect((c.x + 34) * k, (cy + 18) * k, nw * k, 2 * k, RED);
        break;
      }
      case K_MODE: {
        R.rect(c.x * k, c.y * k, c.w * k, c.h * k, c.on ? alpha_(CARD, 0.95f) : PANEL);
        box(c.x, c.y, c.w, c.h, on ? 3.0f : c.on ? 2.0f : 1.0f, on ? RED : c.on ? INK : alpha_(INK, 0.25f));
        const Rgba ic = c.on || on ? INK : mix(INK, DARK, 0.55f);
        iconMode(c.id, c.x + 84, c.y + c.h / 2, 120, ic);
        const float tx = c.x + 168;
        float size = 38;
        while (size > 22 && width(size, c.label, A, 0.03f) > c.x + c.w - tx - 16) size -= 2;
        const float tw2 = text(tx, c.y + c.h / 2 - 40, size, c.label, ic, LEFT, A, 0.03f);
        if (c.on) R.rect(tx * k, (c.y + c.h / 2 - 40 + size + 6) * k, tw2 * k, 3 * k, RED);
        // the line under it, broken where it has to be
        std::string rest = c.sub;
        float ly = c.y + c.h / 2 + 18;
        while (!rest.empty()) {
          std::string ln = rest;
          while (width(10, ln, RB, 0.22f) > c.x + c.w - tx - 14 && ln.find(' ') != std::string::npos) ln = ln.substr(0, ln.rfind(' '));
          text(tx, ly, 10, ln, alpha_(INK, 0.65f), LEFT, RB, 0.22f);
          rest = rest.size() > ln.size() ? rest.substr(ln.size() + 1) : "";
          ly += 17;
        }
        break;
      }
      case K_RADIO: {
        const float cy = c.y + c.h / 2, cx = c.x + 13;
        ring(cx, cy, 11, 2.2f, c.on || on ? INK : alpha_(INK, 0.55f));
        if (c.on) R.circle(cx * k, cy * k, 6.5f * k, RED);
        const float tw2 = text(c.x + 36, cy - 15, 24, c.label, c.on ? INK : on ? alpha_(INK, 0.9f) : alpha_(INK, 0.55f), LEFT, A, 0.04f);
        if (on) R.rect((c.x + 36) * k, (cy + 18) * k, tw2 * k, 2 * k, RED);
        break;
      }
      case K_TOGGLE: {
        const float cy = c.y + c.h / 2;
        R.rrect(c.x * k, (cy - 13) * k, 50 * k, 26 * k, 13 * k, c.on ? RED : alpha_(INK, 0.25f));
        R.circle((c.x + (c.on ? 37 : 13)) * k, cy * k, 9.5f * k, INK);
        const float tw2 = text(c.x + 62, cy - 15, 24, c.label, c.on ? INK : on ? alpha_(INK, 0.9f) : alpha_(INK, 0.55f), LEFT, A, 0.04f);
        if (on) R.rect((c.x + 62) * k, (cy + 18) * k, tw2 * k, 2 * k, RED);
        break;
      }
      case K_NUM: {
        const float bw = 92, cy = c.y + c.h / 2;
        const bool edit = on && editing;
        R.rect(c.x * k, (cy - 19) * k, bw * k, 38 * k, edit ? RED : alpha_(CARD, 0.9f));
        box(c.x, cy - 19, bw, 38, on ? 2.5f : 1.0f, on ? RED : c.on ? INK : alpha_(INK, 0.4f));
        text(c.x + bw / 2, cy - 14, 24, c.on || on ? std::to_string(c.val ? c.val() : 0) : std::string("TYPE"), c.on || on ? INK : alpha_(INK, 0.5f), CENTRE, A, 0.04f);
        text(c.x + bw + 12, cy - 5, 10, c.sub, c.on ? INK : alpha_(INK, 0.5f), LEFT, RB, 0.3f);
        if (on) text(c.x, cy + 26, 10, edit ? "LEFT / RIGHT 1  -  UP / DOWN 10  -  ENTER WHEN DONE" : "TYPE IT  -  OR ENTER, THEN THE ARROWS", alpha_(INK, 0.6f), LEFT, RB, 0.26f);
        break;
      }
      case K_SUN: {
        box(c.x, c.y, c.w, c.h, on ? 2.5f : 1.0f, on ? RED : alpha_(INK, 0.18f));
        orb(c.x + c.w / 2, c.y + c.h / 2 + 10, 74, true);
        if (S.time == "live") text(c.x + c.w / 2, c.y + c.h / 2 - 8, 24, "THE REAL HOUR", INK, CENTRE, A, 0.05f);
        else {
          const double hh = hourOf(S.time);
          text(c.x + c.w / 2, c.y + c.h / 2 - 20, 34, clockOf(hh), INK, CENTRE, A, 0.05f);
          text(c.x + c.w / 2, c.y + c.h / 2 + 28, 10, phaseOf(hh), alpha_(INK, 0.7f), CENTRE, RB, 0.3f);
        }
        if (on) { text(c.x + 18, c.y + c.h / 2 - 2, 22, "<", INK, LEFT, RB); text(c.x + c.w - 18, c.y + c.h / 2 - 2, 22, ">", INK, RIGHT, RB); }
        if (on) text(c.x + c.w / 2, c.y + c.h + 10, 10, "LEFT / RIGHT  -  TURN THE SUN, HALF AN HOUR A PRESS", alpha_(INK, 0.6f), CENTRE, RB, 0.3f);
        break;
      }
      case K_BTN: {
        if (on) R.rect(c.x * k, c.y * k, c.w * k, c.h * k, RED);
        else { R.rect(c.x * k, c.y * k, c.w * k, c.h * k, alpha_(INK, 0.6f)); R.rect((c.x + 1.5f) * k, (c.y + 1.5f) * k, (c.w - 3) * k, (c.h - 3) * k, hex("#0b0b0e")); }
        text(c.x + c.w / 2, c.y + 18, 13, c.label, INK, CENTRE, RB, 0.3f);
        break;
      }
      default: break;
    }
  }
  // ---- back, and what the buttons do
  {
    const float y = H - 78;
    text(X0, y + 16, 12, "<   B A C K", alpha_(INK, 0.8f), LEFT, RB, 0.3f);
    hot(X0 - 10, y, 170, 50, -1, [this] { if (back) back(); });
    const char *hint = page == "setup" ? "ARROWS MOVE  -  ENTER OPENS  -  G = LIGHTS OUT" : page == "track" ? "ARROWS MOVE  -  ENTER TAKES IT" : "ARROWS MOVE  -  ENTER CHOOSES  -  BACK WHEN DONE";
    text(W / 2, y + 18, 10, hint, alpha_(INK, 0.45f), CENTRE, RB, 0.3f);
  }
}

}  // namespace xbr
