// home.cpp — home.html + js/home.js + the voice in js/menuui.js. See home.hpp.
// Sizes are the stylesheet's, in CSS pixels; `k` turns them into the screen's.
#include "home.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <ctime>
#include <fstream>

#include "driver.hpp"
#include "drivers.hpp"
#include "json.hpp"
#include "physics.hpp"
#include "ui.hpp"

namespace xbr {

// js/tracks.js: [id, name, tag]
static const char *TRACKS[][3] = {
  {"test", "The test map", "HAND-BUILT"}, {"kate", "Kate Mascoi Circuit", "WIDE - FAST - BATTLES"},
  {"kate2", "Kate Mascoi Circuit 2", "ADAM'S OWN - 7.2 KM"}, {"street", "Street Circuit", "ADAM'S OWN"},
  {"adam1", "Adam's first track", "ADAM'S OWN"}, {"monza", "Monza", "ITALY"}, {"zandvoort", "Zandvoort", "NETHERLANDS"},
  {"suzuka", "Suzuka", "JAPAN"}, {"baku", "Baku", "AZERBAIJAN"}, {"monaco", "Monaco", "MONACO"},
  {"nurburgring", "Nurburgring", "GERMANY"}, {"sepang", "Sepang", "MALAYSIA"}, {"spa", "Spa-Francorchamps", "BELGIUM"},
};
static const int N_TRACKS = 13;
static int trackIdx(const std::string &id) { for (int i = 0; i < N_TRACKS; i++) if (id == TRACKS[i][0]) return i; return 5; }
static const char *LEAGUE_KEYS[3] = {"f1", "gt3", "f4"}, *LEAGUE_NAMES[3] = {"F1", "GT3", "F4"};
static const char *leagueName(const std::string &k) { for (int i = 0; i < 3; i++) if (k == LEAGUE_KEYS[i]) return LEAGUE_NAMES[i]; return "F1"; }

// ---- the voice (js/menuui.js SAY) ---------------------------------------------------
static std::string sayFor(const std::string &row, const std::string &v) {
  struct L { const char *row, *val, *line; };
  static const L T[] = {
    {"CIRCUIT", "test", "the test map. science time."}, {"CIRCUIT", "kate", "kate mascoi. wide, fast, and nowhere to hide."},
    {"CIRCUIT", "street", "pembroke. home race. no pressure."}, {"CIRCUIT", "adam1", "the first one. be nice to it."},
    {"CIRCUIT", "monza", "flat out. brake. pray. repeat."}, {"CIRCUIT", "zandvoort", "banking! in the dunes! who allowed this."},
    {"CIRCUIT", "suzuka", "hachi no ji. best track. no notes."}, {"CIRCUIT", "baku", "two kilometres of straight and then a castle. obviously."},
    {"CIRCUIT", "monaco", "the walls are closer than they look. then closer than that."}, {"CIRCUIT", "nurburgring", "germany. precise. cold. probably foggy."},
    {"CIRCUIT", "sepang", "it will rain. it always rains."}, {"CIRCUIT", "spa", "seven kilometres of forest and one hill everybody talks about."},
    {"CAR", "f4", "small car. big dreams."}, {"CAR", "gt3", "the one with a roof."}, {"CAR", "f1", "the big one. hands at ten and two."},
    {"MODE", "hotlap", "just you and the clock. the clock is mean."}, {"MODE", "race", "wheel to wheel. elbows out."},
    {"LAPS", "2", "a sprint. blink and it is over."}, {"LAPS", "10", "ten laps. hydrate."},
    {"GRID", "6", "six cars. cosy."}, {"GRID", "22", "twenty-one other people's problems."},
    {"RIVALS", "supercasual", "vibes only."}, {"RIVALS", "hard", "ok tough guy."}, {"RIVALS", "*", "they have been practising. have you?"},
    {"YOU START", "pole", "clean air. do not look back."}, {"YOU START", "back", "last to first. easy. (not easy.)"},
    {"RETIREMENT", "true", "immortal mode. bold."}, {"RETIREMENT", "false", "real consequences. gulp."},
    {"TIME", "night", "lights on. everything is faster in the dark."}, {"TIME", "*", "nice light for it."},
    {"WEATHER", "rain", "oh no. oh no no no. (yes.)"}, {"WEATHER", "storm", "who ordered this."},
    {"WEATHER", "changing", "could be anything. bring a coat."}, {"WEATHER", "*", "weather noted."},
    {"THEME", "light", "who turned the lights on."}, {"THEME", "dark", "ahh. better."}, {"THEME", "halloween", "boo. (sorry.)"},
    {"MUSIC", "off", "fine. silence. very dramatic."}, {"MUSIC", "low", "a little quieter. thinking music."}, {"MUSIC", "on", "there it is."},
    {"TEAM", "*", "good team. good people. probably."},
  };
  const char *star = nullptr;
  for (const auto &l : T)
    if (row == l.row) { if (v == l.val) return l.line; if (std::string(l.val) == "*") star = l.line; }
  return star ? star : "";
}
static std::string greeting() {
  const std::time_t t = std::time(nullptr);
  const int h = std::localtime(&t)->tm_hour, r = std::rand() & 1;
  if (h < 5) return r ? "it is very late. one more race. (it is never one more race.)" : "go to bed. after this one.";
  if (h < 12) return r ? "morning. lights out before breakfast?" : "early. keen. love that.";
  if (h < 18) return r ? "afternoon. the track is warm." : "ok. deep breath. pick a circuit.";
  return r ? "evening session. best kind." : "ok. deep breath. pick a circuit.";
}

// ---- the save ------------------------------------------------------------------------
void MenuSave::load(const std::string &path) {
  std::ifstream f(path);
  std::string k, v;
  while (f >> k && std::getline(f >> std::ws, v)) {
    if (k == "track") track = v; else if (k == "car") car = v; else if (k == "mode") mode = v; else if (k == "tier") tier = v;
    else if (k == "start") start = v; else if (k == "grid") grid = std::atoi(v.c_str()); else if (k == "laps") laps = std::atoi(v.c_str());
    else if (k == "noDnf") noDnf = v == "1"; else if (k == "time") time = v; else if (k == "weather") weather = v;
    else if (k == "battle") battle = v; else if (k == "field") field = v; else if (k == "theme") theme = v; else if (k == "music") music = v;
    else if (k == "team.f1") teams["f1"] = v; else if (k == "team.gt3") teams["gt3"] = v; else if (k == "team.f4") teams["f4"] = v;
    else if (k == "ffb") ffb = std::atoi(v.c_str()); else if (k == "cam") cam = std::atoi(v.c_str());
    else if (k == "volume") volume = std::atoi(v.c_str()); else if (k == "line") line = v == "1";
  }
  if (!hasCarSpec(car)) car = "f1";
  grid = std::max(2, std::min(61, grid)); laps = std::max(1, std::min(999, laps));
  cam = std::max(0, std::min(3, cam)); ffb = std::max(0, std::min(100, ffb)); volume = std::max(0, std::min(10, volume));
  for (const char *l : LEAGUE_KEYS) if (!teams[l].empty() && !teamByKey(teams[l])) teams[l].clear();
}
void MenuSave::save(const std::string &path) const {
  if (path.empty()) return;
  std::ofstream f(path);
  f << "track " << track << "\ncar " << car << "\nmode " << mode << "\ntier " << tier << "\nstart " << start << "\ngrid " << grid
    << "\nlaps " << laps << "\nnoDnf " << (noDnf ? 1 : 0) << "\ntime " << time << "\nweather " << weather << "\nbattle " << battle
    << "\nfield " << field << "\ntheme " << theme << "\nmusic " << music << "\nffb " << ffb << "\ncam " << cam << "\nvolume " << volume
    << "\nline " << (line ? 1 : 0) << "\n";
  for (const auto &kv : teams) if (!kv.second.empty()) f << "team." << kv.first << " " << kv.second << "\n";
}

Home::Home(const std::string &dataDir_, const std::string &savePath_) : dataDir(dataDir_), savePath(savePath_) {
  if (!savePath.empty()) S.load(savePath);
  sayText = greeting();
  build();
}

std::string Home::teamKey() const {
  auto it = S.teams.find(S.car);
  if (it != S.teams.end() && !it->second.empty()) return it->second;
  for (const char *l : LEAGUE_KEYS) { auto j = S.teams.find(l); if (j != S.teams.end() && !j->second.empty()) return j->second; }
  return "";
}
int Home::startSlot(int grid) const {
  if (S.start == "pole") return 1;
  if (S.start == "front") return std::min(grid, 3);
  if (S.start == "back") return grid;
  return std::max(1, (int)jsRound(grid * 0.55));
}

// ---- settings rows -------------------------------------------------------------------
std::string Home::get(const std::string &key) const {
  if (key == "mode") return S.mode;
  if (key == "laps") return std::to_string(S.laps);
  if (key == "grid") return std::to_string(S.grid);
  if (key == "tier") return S.tier;
  if (key == "battle") return S.battle;
  if (key == "start") return S.start;
  if (key == "noDnf") return S.noDnf ? "true" : "false";
  if (key == "field") return S.field;
  if (key == "time") return S.time;
  if (key == "weather") return S.weather;
  if (key == "theme") return S.theme;
  if (key == "music") return S.music;
  if (key == "ffb") return std::to_string(S.ffb);
  if (key == "cam") return std::to_string(S.cam);
  if (key == "volume") return std::to_string(S.volume);
  if (key == "line") return S.line ? "true" : "false";
  return "";
}
void Home::set(const std::string &key, const std::string &v) {
  if (key == "mode") S.mode = v; else if (key == "laps") S.laps = std::atoi(v.c_str()); else if (key == "grid") S.grid = std::atoi(v.c_str());
  else if (key == "tier") S.tier = v; else if (key == "battle") S.battle = v; else if (key == "start") S.start = v;
  else if (key == "noDnf") S.noDnf = v == "true"; else if (key == "field") S.field = v; else if (key == "time") S.time = v;
  else if (key == "weather") S.weather = v; else if (key == "theme") S.theme = v; else if (key == "music") S.music = v;
  else if (key == "ffb") S.ffb = std::atoi(v.c_str()); else if (key == "cam") S.cam = std::atoi(v.c_str());
  else if (key == "volume") S.volume = std::atoi(v.c_str()); else if (key == "line") S.line = v == "true";
}
std::vector<Home::Opt> Home::setupRows() const {
  std::vector<Opt> rows;
  rows.push_back({"MODE", "mode", {{"hotlap", "HOT LAP"}, {"race", "RACE"}}});
  if (S.mode == "race") {
    rows.push_back({"LAPS", "laps", {{"2", "2"}, {"3", "3"}, {"5", "5"}, {"10", "10"}, {"20", "20"}}});
    rows.push_back({"GRID", "grid", {{"6", "6"}, {"12", "12"}, {"16", "16"}, {"22", "22"}}});
    Opt riv{"RIVALS", "tier", {}};
    for (const auto &t : allTiers()) riv.opts.push_back({t.key, t.name});
    rows.push_back(riv);
    if (S.tier == "supercasual") rows.push_back({"OVERTAKES", "battle", {{"easy", "EASY"}, {"medium", "MEDIUM"}, {"hard", "HARD"}}});
    rows.push_back({"YOU START", "start", {{"pole", "POLE"}, {"front", "FRONT ROW"}, {"mid", "MIDFIELD"}, {"back", "LAST"}}});
    rows.push_back({"RETIREMENT", "noDnf", {{"false", "NORMAL"}, {"true", "NO DNF"}}});
    if (S.car == "f1") rows.push_back({"FIELD", "field", {{"f1", "2026 GRID"}, {"classic", "CLASSIC"}, {"fantasy", "FANTASY"}, {"all", "ALL ERAS"}}});
  }
  rows.push_back({"TIME", "time", {{"live", "LIVE"}, {"night", "NIGHT"}, {"dawn", "DAWN"}, {"sunrise", "SUNRISE"}, {"morning", "MORNING"},
                                    {"day", "DAY"}, {"evening", "EVENING"}, {"sunset", "SUNSET"}, {"dusk", "DUSK"}}});
  rows.push_back({"WEATHER", "weather", {{"live", "LIVE"}, {"clear", "CLEAR"}, {"cloudy", "CLOUDY"}, {"overcast", "OVERCAST"}, {"rain", "RAIN"},
                                          {"storm", "STORM"}, {"changing", "CHANGING"}}});
  return rows;
}

// ---- pages ---------------------------------------------------------------------------
void Home::show(const std::string &name, int keep) {
  page = name;
  build();
  at = std::max(0, std::min((int)items.size() - 1, keep));
  if (!savePath.empty()) S.save(savePath);
}

void Home::lightsOut() {
  if (S.teams[S.car].empty()) { show("garage"); say("pick a team first. then we race."); return; }
  if (!savePath.empty()) S.save(savePath);
  wantStart = true;
}

void Home::build() {
  items.clear();
  back = page == "home" ? std::function<void()>() : [this] { show("home"); };
  auto optItems = [this](const std::vector<Opt> &rows, const std::string &pg) {
    for (const Opt &o : rows) {
      const Opt row = o;
      auto step = [this, row, pg](int d) {
        const std::string cur = get(row.key);
        int i = 0;
        for (size_t q = 0; q < row.opts.size(); q++) if (row.opts[q].first == cur) i = (int)q;
        const int n = (int)row.opts.size();
        const std::string v = row.opts[(size_t)((i + d + n) % n)].first;
        set(row.key, v);
        const int keep = at;
        show(pg, keep);
        say(sayFor(row.label, v));
      };
      items.push_back({[this] { at = std::min((int)items.size() - 1, at + 1); }, [step] { step(-1); }, [step] { step(1); }});
    }
  };
  if (page == "home") {
    items.push_back({[this] { lightsOut(); }, nullptr, nullptr});                                        // RACE: what you came for
    items.push_back({[this] { show("setup"); }, nullptr, nullptr});                                      // NEXT UP
    items.push_back({[this] { show("setup"); }, nullptr, nullptr});                                      // SETUP
    items.push_back({[this] { show("garage"); }, nullptr, nullptr});                                     // GARAGE
    const char *notYet = "that room is not built in the native edition yet.";
    for (int i = 0; i < 5; i++) items.push_back({[this, notYet] { say(notYet); }, nullptr, nullptr});    // XINGUS SHOWROOM BUILDER JUKEBOX iPAD DASH
    items.push_back({[this] { show("settings"); }, nullptr, nullptr});                                   // SETTINGS
    items.push_back({[this] { show("garage"); }, nullptr, nullptr});                                     // the YOU DRIVE FOR card
  } else if (page == "setup") {
    auto step = [this](int d) {
      const int i = trackIdx(S.track);
      S.track = TRACKS[(i + d + N_TRACKS) % N_TRACKS][0];
      dirty = true;
      show("setup", 0);
      say(sayFor("CIRCUIT", S.track));
    };
    items.push_back({[this] { at = 1; }, [step] { step(-1); }, [step] { step(1); }});
    optItems(setupRows(), "setup");
    items.push_back({[this] { lightsOut(); }, nullptr, nullptr});
  } else if (page == "garage") {
    auto league = [this](int d) {
      int i = 0;
      for (int q = 0; q < 3; q++) if (S.car == LEAGUE_KEYS[q]) i = q;
      S.car = LEAGUE_KEYS[(i + d + 3) % 3];
      garageAt = -1; dirty = true;
      show("garage", 0);
      say(sayFor("CAR", S.car));
    };
    items.push_back({nullptr, [league] { league(-1); }, [league] { league(1); }});
    auto keysOf = [this] { return teamsIn(S.car); };
    auto cur = [this, keysOf] {
      const auto keys = keysOf();
      int i = 0;
      for (size_t q = 0; q < keys.size(); q++) if (keys[q] == S.teams[S.car]) i = (int)q;
      if (garageAt >= 0 && garageAt < (int)keys.size()) i = garageAt;
      return i;
    };
    auto go = [this, keysOf, cur](int d) { const int n = (int)keysOf().size(); if (n) garageAt = (cur() + d + n) % n; show("garage", 1); };
    auto join = [this, keysOf, cur] {
      const auto keys = keysOf();
      if (keys.empty()) return;
      const std::string k = keys[(size_t)cur()];
      S.teams[S.car] = k; garageAt = -1; dirty = true;
      show("garage", 1);
      const Team *t = teamByKey(k);
      say((t ? t->name : k) + ". " + sayFor("TEAM", k));
    };
    items.push_back({join, [go] { go(-1); }, [go] { go(1); }});
    items.push_back({[this, keysOf, cur, join] {
      const auto keys = keysOf();
      if (!keys.empty() && S.teams[S.car] == keys[(size_t)cur()]) show("home"); else join();
    }, nullptr, nullptr});
  } else if (page == "settings") {
    optItems({{"THEME", "theme", {{"light", "LIGHT"}, {"dark", "DARK"}, {"halloween", "HALLOWEEN"}}},
              {"MUSIC", "music", {{"on", "ON"}, {"low", "QUIET"}, {"off", "OFF"}}},
              {"VIEW", "cam", {{"0", "ONBOARD"}, {"1", "CHASE"}, {"2", "NOSE"}, {"3", "T-CAM"}}},
              {"IDEAL LINE", "line", {{"false", "HIDDEN"}, {"true", "SHOWN"}}},
              {"VOLUME", "volume", {{"0", "OFF"}, {"2", "20%"}, {"4", "40%"}, {"6", "60%"}, {"8", "80%"}, {"10", "100%"}}},
              {"WHEEL FORCE (THROUGH TOOLS/FFB.PY)", "ffb", {{"0", "OFF"}, {"20", "20%"}, {"35", "35%"}, {"50", "50%"}, {"65", "65%"}, {"80", "80%"}, {"100", "100%"}}}},
             "settings");
    items.push_back({[this] { show("home"); }, nullptr, nullptr});
  }
  at = std::max(0, std::min((int)items.size() - 1, at));
}

void Home::input(Nav n) {
  if (n == Nav::Back) { if (back) back(); else wantQuit = true; return; }
  if (n == Nav::Go) { if (page == "home" || page == "setup") lightsOut(); return; }
  if (items.empty()) return;
  const Item it = items[(size_t)at];
  if (n == Nav::Ok) { if (it.ok) it.ok(); return; }
  if (n == Nav::Left || n == Nav::Right) {
    const auto &f = n == Nav::Left ? it.left : it.right;
    if (f) f();
    else at = std::max(0, std::min((int)items.size() - 1, at + (n == Nav::Left ? -1 : 1)));
    return;
  }
  at = std::max(0, std::min((int)items.size() - 1, at + (n == Nav::Up ? -1 : 1)));
}

// ---- outlines: the circuit, from the surveyed centreline the car drives on ----------------
const Home::Outline &Home::outline(const std::string &id) {
  auto it = outlines.find(id);
  if (it != outlines.end()) return it->second;
  Outline o;
  const Json j = Json::loadOpt(dataDir + "/tracks/" + id + ".json");
  const size_t n = j["x"].size();
  if (j.isObj() && n > 8) {
    const size_t step = std::max<size_t>(1, n / 400);
    o.x0 = o.y0 = 1e30f; o.x1 = o.y1 = -1e30f;
    for (size_t k = 0; k < n; k += step) {
      const float x = (float)j["x"][k].n(), y = (float)-j["y"][k].n();      // north up
      o.xy.push_back(x); o.xy.push_back(y);
      o.x0 = std::min(o.x0, x); o.x1 = std::max(o.x1, x); o.y0 = std::min(o.y0, y); o.y1 = std::max(o.y1, y);
    }
    o.len = j["length"].n();
    o.ok = true;
  }
  return outlines.emplace(id, std::move(o)).first->second;
}

static Rgba alpha_(const Rgba &a, float t) { Rgba r = a; r.c[3] *= t; return r; }
static const Rgba PAPER = hex("#f3f0e8"), CARD = hex("#ffffff"), INK = hex("#121212"), SOFT = hex("#6d6a63"), RED = hex("#ff2d46"),
                  ONRED = hex("#ffffff"), YELL = hex("#ffe14d");

void Home::drawMap(Renderer &R, float k, float x, float y, float w, float h, const std::string &id, bool car, double clock) {
  // .frame: 7% ink on the card, the outline inside 8 px of padding, north up
  R.rrect(x * k, y * k, w * k, h * k, 8 * k, mix(INK, CARD, 0.07f));
  const Outline &o = outline(id);
  if (!o.ok) return;
  const float size = std::max(o.x1 - o.x0, o.y1 - o.y0), pad = size * 0.07f;
  const float vw = o.x1 - o.x0 + 2 * pad, vh = o.y1 - o.y0 + 2 * pad;
  const float iw = w - 16, ih = h - 16, sc = std::min(iw / vw, ih / vh);
  const float ox = x + 8 + (iw - vw * sc) / 2 - (o.x0 - pad) * sc, oy = y + 8 + (ih - vh * sc) / 2 - (o.y0 - pad) * sc;
  std::vector<float> p(o.xy.size());
  for (size_t i = 0; i < o.xy.size(); i += 2) { p[i] = (ox + o.xy[i] * sc) * k; p[i + 1] = (oy + o.xy[i + 1] * sc) * k; }
  const int n = (int)p.size() / 2;
  R.path(p.data(), n, 8 * k, INK, true);          // .casing
  R.path(p.data(), n, 2.5f * k, CARD, true);      // .tarmac
  if (car) {
    const double u = std::fmod(clock / 9.0, 1.0) * n;      // a lone car lapping the outline, forever
    const int i = (int)u % n, j = (i + 1) % n;
    const float f = (float)(u - std::floor(u));
    const float cx = p[(size_t)i * 2] + (p[(size_t)j * 2] - p[(size_t)i * 2]) * f, cy = p[(size_t)i * 2 + 1] + (p[(size_t)j * 2 + 1] - p[(size_t)i * 2 + 1]) * f;
    const float r = std::max(3.0f, size * 0.016f * sc) * k;
    R.circle(cx, cy, r * 1.3f, INK);
    R.circle(cx, cy, r, RED);
  }
}

// ---- drawing ---------------------------------------------------------------------------
void Home::draw(Renderer &R, float k, double clock, const LiveTower &live) {
  now = clock;
  const float W = (float)R.W / k, H = (float)R.H / k;
  const int A = Renderer::ANTON, RB = Renderer::RUBIK, MK = Renderer::MARKER;
  auto text = [&](float x, float y, float size, const std::string &s, const Rgba &c, Align al = LEFT, int font = 1, float track = 0) {
    return R.textPx(x * k, y * k, size * k, s, c, al, font, track) / k;
  };
  auto width = [&](float size, const std::string &s, int font = 1, float track = 0) { return R.widthPx(size * k, s, font, track) / k; };
  auto upper = [](std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; };
  // The one shape: a card. Rounded, an ink line, flat. Chosen = solid ink, a
  // hop of three pixels and a hard red lip under it.
  auto chunk = [&](float x, float &y, float w, float h, bool on, const Rgba &fill, float r = 12, float bw = 2.5f, const Rgba *lip = &RED, bool solid = true) {
    if (on) {
      y -= 3;
      if (lip) R.rrect(x * k, (y + 5) * k, w * k, h * k, r * k, *lip);
      R.card(x * k, y * k, w * k, h * k, r * k, bw * k, solid ? INK : fill, INK);
    } else R.card(x * k, y * k, w * k, h * k, r * k, bw * k, fill, INK);
  };
  auto pumpkin = [&](float cx, float cy, float s) {      // it is October
    const Rgba OR = hex("#ff7a14"), DK = hex("#a8440a"), GL = hex("#ffe14d"), ST = hex("#3d6b1f");
    R.rect((cx - s * 0.04f) * k, (cy - s * 0.48f) * k, s * 0.1f * k, s * 0.2f * k, ST);
    R.rrect((cx - s * 0.42f) * k, (cy - s * 0.30f) * k, s * 0.84f * k, s * 0.70f * k, s * 0.33f * k, DK);
    R.rrect((cx - s * 0.37f) * k, (cy - s * 0.25f) * k, s * 0.74f * k, s * 0.60f * k, s * 0.28f * k, OR);
    const float e1[6] = {(cx - s * 0.24f) * k, (cy - s * 0.02f) * k, (cx - s * 0.10f) * k, (cy - s * 0.13f) * k, (cx - s * 0.06f) * k, (cy + s * 0.02f) * k};
    const float e2[6] = {(cx + s * 0.24f) * k, (cy - s * 0.02f) * k, (cx + s * 0.10f) * k, (cy - s * 0.13f) * k, (cx + s * 0.06f) * k, (cy + s * 0.02f) * k};
    R.poly(e1, 3, GL); R.poly(e2, 3, GL);
    R.rrect((cx - s * 0.24f) * k, (cy + s * 0.12f) * k, s * 0.48f * k, s * 0.10f * k, s * 0.05f * k, GL);
  };
  auto flag = [&](float x, float y, float s, const Rgba &pole) {       // the flag from his GO! button
    R.rect((x + s * 0.24f) * k, (y + s * 0.12f) * k, s * 0.07f * k, s * 0.8f * k, pole);
    for (int cy = 0; cy < 3; cy++) for (int cx = 0; cx < 4; cx++)
      R.rect((x + s * 0.31f + cx * s * 0.14f) * k, (y + s * 0.14f + cy * s * 0.13f) * k, s * 0.14f * k, s * 0.13f * k, ((cx + cy) & 1) ? hex("#111111") : hex("#ffffff"));
  };
  const bool october = [] { const std::time_t t = std::time(nullptr); return std::localtime(&t)->tm_mon == 9; }();
  const bool boo = S.theme == "halloween" || october;
  const std::string tk = teamKey();
  const Team *team = tk.empty() ? nullptr : teamByKey(tk);
  auto cols = [&](const Team *t, Rgba &c1, Rgba &c2) {
    c1 = hex("#e8452c"); c2 = hex("#ffd23f");
    if (!t) return;
    if (!t->ui[0].empty()) { c1 = hex(t->ui[0]); c2 = hex(t->ui[1]); }
    else { c1 = hex(t->col); c2 = hex(t->fg.empty() ? "#ffffff" : t->fg); }
  };
  auto sayBox = [&](float x, float y) {
    const float w = std::min(520.0f, width(17, sayText, MK) + 30);
    R.hudRot((x + w / 2) * k, (y + 17) * k, -1.2f);
    R.card(x * k, y * k, w * k, 35 * k, 14 * k, 2.5f * k, CARD, INK);
    text(x + 15, y + 8, 17, sayText, INK, LEFT, MK);
    R.hudRot(0, 0, 0);
    return w;
  };
  auto title = [&](const std::string &t) {
    const float w = text(24, 20, 46, t, INK, LEFT, A, 0.02f);
    R.rect(24 * k, 68 * k, w * k, 7 * k, RED);
    if (boo) pumpkin(24 + w + 30, 44, 40);
    return w;
  };
  auto foot = [&](const std::string &next, const std::string &hint, bool on) {
    float y = H - 22 - 50;
    R.card(24 * k, y * k, (width(26, "< BACK", A, 0.04f) + 60) * k, 50 * k, 12 * k, 2.5f * k, CARD, INK);
    text(54, y + 13, 26, "< BACK", INK, LEFT, A, 0.04f);
    text(W / 2, y + 20, 10, hint, SOFT, CENTRE, RB, 0.14f);
    const std::string nl = next + " >";
    const float w = width(26, nl, A, 0.04f) + 60;
    float yy = y;
    if (on) { yy -= 3; R.rrect((W - 24 - w) * k, (yy + 6) * k, w * k, 50 * k, 12 * k, INK); }
    R.card((W - 24 - w) * k, yy * k, w * k, 50 * k, 12 * k, 2.5f * k, RED, INK);
    text(W - 24 - w + 30, yy + 13, 26, nl, ONRED, LEFT, A, 0.04f);
  };
  // a grid of chunky choices: one card a setting, its values as pills
  auto optGrid = [&](const std::vector<Opt> &rows, float y0, float y1, int first) {
    const float avail = W - 48 - 12;
    const int colsN = std::max(1, (int)((avail + 9) / (250 + 9)));
    const float cw = (avail - 9 * (float)(colsN - 1)) / (float)colsN;
    // measure each card's height (pills wrap)
    std::vector<float> hs;
    for (const Opt &o : rows) {
      float x = 0, lines = 1;
      for (const auto &p : o.opts) { const float pw = width(16, p.second, A, 0.04f) + 28; if (x + pw > cw - 24 && x > 0) { x = 0; lines++; } x += pw + 6; }
      hs.push_back(9 + 18 + lines * 31 - 6 + 11);
    }
    float total = 0;
    for (size_t i = 0; i < rows.size(); i += (size_t)colsN) { float m = 0; for (int c = 0; c < colsN && i + c < rows.size(); c++) m = std::max(m, hs[i + (size_t)c]); total += m + 9; }
    float y = std::max(y0 + 8, (y0 + y1) / 2 - total / 2);
    for (size_t i = 0; i < rows.size(); i += (size_t)colsN) {
      float m = 0;
      for (int c = 0; c < colsN && i + c < rows.size(); c++) m = std::max(m, hs[i + (size_t)c]);
      for (int c = 0; c < colsN && i + c < rows.size(); c++) {
        const Opt &o = rows[i + (size_t)c];
        const bool on = at == first + (int)i + c;
        const float x = 30 + c * (cw + 9);
        if (on) R.rrect(x * k, (y + 5) * k, cw * k, m * k, 12 * k, RED);
        R.card(x * k, y * k, cw * k, m * k, 12 * k, (on ? 3 : 2.5f) * k, CARD, INK);
        text(x + 12, y + 10, 10, o.label, on ? RED : SOFT, LEFT, RB, 0.18f);
        float px = x + 12, py = y + 9 + 18;
        const std::string cur = get(o.key);
        for (const auto &p : o.opts) {
          const float pw = width(16, p.second, A, 0.04f) + 28;
          if (px + pw > x + cw - 12 && px > x + 12) { px = x + 12; py += 31; }
          const bool sel = p.first == cur;
          R.card(px * k, py * k, pw * k, 25 * k, 9 * k, 2 * k, sel ? INK : CARD, INK);
          text(px + 14, py + 5, 16, p.second, sel ? PAPER : INK, LEFT, A, 0.04f);
          px += pw + 6;
        }
      }
      y += m + 9;
    }
  };

  if (page != "home") R.rect(0, 0, (float)R.W, (float)R.H, PAPER);       // #wash: only HOME has the race behind it

  if (page == "home") {
    const int ti = trackIdx(S.track);
    // ---- top bar
    {
      const float tw = width(30, "CHASING ", A, 0.03f) + width(30, "WDC", A, 0.03f), lw = 16 + 30 + 10 + tw + 16;
      R.rrect(24 * k, 20 * k, lw * k, 58 * k, 12 * k, INK);
      if (boo) pumpkin(24 + 16 + 15, 20 + 29, 34); else flag(24 + 12, 20 + 13, 34, PAPER);
      const float x = 24 + 16 + 40;
      const float w1 = text(x, 27, 30, "CHASING ", PAPER, LEFT, A, 0.03f);
      text(x + w1, 27, 30, "WDC", RED, LEFT, A, 0.03f);
      text(x, 60, 10, "RACING FOR ALL", alpha_(PAPER, 0.7f), LEFT, RB, 0.2f);
      float cx = 24 + lw + 12;
      auto chip = [&](const std::string &small, const std::string &big, const Rgba &bg, const Rgba &fg, bool jack = false) {
        const float w = std::max(width(9, small, RB, 0.16f), width(19, big, A, 0.03f)) + 26 + (jack ? 38 : 0);
        R.card(cx * k, 28 * k, w * k, 42 * k, 12 * k, 2.5f * k, bg, INK);
        if (jack) pumpkin(cx + 24, 49, 30);
        text(cx + 13 + (jack ? 38 : 0), 34, 9, small, alpha_(fg, 0.7f), LEFT, RB, 0.16f);
        text(cx + 13 + (jack ? 38 : 0), 45, 19, big, fg, LEFT, A, 0.03f);
        cx += w + 12;
      };
      // series: "Day N of chasing the WDC" began on 2026-10-03
      const std::time_t tt = std::time(nullptr);
      std::tm lt = *std::localtime(&tt);
      std::tm d0{}; d0.tm_year = 126; d0.tm_mon = 9; d0.tm_mday = 3;
      std::tm today = lt; today.tm_hour = today.tm_min = today.tm_sec = 0;
      const int day = (int)std::floor(std::difftime(std::mktime(&today), std::mktime(&d0)) / 86400.0 + 0.5) + 1;
      if (day >= 1) chip("CHASING THE WDC", "DAY " + std::to_string(day), YELL, hex("#121212"));
      if (S.theme == "halloween" && lt.tm_mon == 9) { const int left = 31 - lt.tm_mday; chip("HALLOWEEN", left == 0 ? "TONIGHT" : std::to_string(left) + " NIGHT" + (left == 1 ? "" : "S"), hex("#ff7a14"), hex("#1a1220"), true); }
      if (lt.tm_mon == 9) chip("RACETOBER", "DAY " + std::to_string(lt.tm_mday), INK, PAPER);
      // the radio (the soundtrack is not in the native edition yet, and it says so)
      const std::string np = "MUSIC OFF";
      const float w = std::max(width(9, "ON THE RADIO", RB, 0.16f), width(19, np, A, 0.03f)) + 26;
      R.card((W - 24 - w) * k, 28 * k, w * k, 42 * k, 12 * k, 2.5f * k, CARD, INK);
      text(W - 24 - w + 13, 34, 9, "ON THE RADIO", SOFT, LEFT, RB, 0.16f);
      text(W - 24 - w + 13, 45, 19, np, INK, LEFT, A, 0.03f);
    }
    sayBox(24, 92);
    // ---- mid: who you drive for, and the race going on behind all this
    {
      const bool on = at == 10;
      float y = 141;
      chunk(24, y, 250, 116, on, CARD);
      const Rgba fg = on ? PAPER : INK, sm = on ? alpha_(PAPER, 0.75f) : SOFT;
      std::string no = "?";
      if (team) { const auto dv = driversOf(tk); if (!dv.empty()) no = std::to_string(dv[0]->num); }
      R.circle((24 + 250 - 15 - 27) * k, (y + 13 + 27) * k, 27 * k, INK);
      R.circle((24 + 250 - 15 - 27) * k, (y + 13 + 27) * k, 24.5f * k, hex("#ffffff"));
      text(24 + 250 - 15 - 27, y + 13 + 15, 24, no, hex("#121212"), CENTRE, A);
      text(39, y + 14, 10, team ? std::string(leagueName(team->league)) + " - YOU DRIVE FOR" : "NO TEAM YET", sm, LEFT, RB, 0.16f);
      std::string tn = team ? upper(team->name) : "PICK A TEAM";
      while (tn.size() > 4 && width(30, tn, A, 0.02f) > 160) tn.pop_back();
      text(39, y + 30, 30, tn, fg, LEFT, A, 0.02f);
      Rgba c1, c2;
      cols(team, c1, c2);
      R.rrect(39 * k, (y + 70) * k, 220 * k, 12 * k, 6 * k, INK);
      R.rrect(39 * k, (y + 70) * k, 220 * 0.90f * k, 12 * k, 6 * k, c2);
      R.rrect(39 * k, (y + 70) * k, 220 * 0.66f * k, 12 * k, 6 * k, c1);
      text(39, y + 90, 12, team ? carSpec(S.car).full : "the garage is that way ->", sm);
      // the tower
      const float tx = W - 24 - 240, th = 11 + 19 + 21 * (float)std::max<size_t>(1, std::min<size_t>(7, live.rows.size())) + 8;
      R.card(tx * k, 141 * k, 240 * k, (live.up ? th : 40) * k, 12 * k, 2.5f * k, CARD, INK);
      if (!live.up) text(tx + 14, 153, 10, "LIVE - WARMING UP...", SOFT, LEFT, RB, 0.16f);
      else {
        R.circle((tx + 18) * k, 158 * k, 4 * k, RED);
        std::string tn = upper(live.track);
        const std::string tail = " - LAP " + std::to_string(live.lap) + "/" + std::to_string(live.laps);
        while (tn.size() > 3 && width(10, "LIVE - " + tn + tail, RB, 0.16f) > 198) tn.pop_back();
        text(tx + 28, 153, 10, "LIVE - " + tn + tail, SOFT, LEFT, RB, 0.16f);
        float ry = 141 + 11 + 19;
        for (size_t i = 0; i < live.rows.size() && i < 7; i++) {
          const LiveRow &r = live.rows[i];
          text(tx + 30, ry + 3, 13, std::to_string(r.p), INK, RIGHT, A);
          R.rrect((tx + 38) * k, (ry + 3) * k, 5 * k, 14 * k, 2 * k, hex(r.col));
          std::string nm = r.you ? "YOUR SEAT (BOT)" : r.name;
          while (nm.size() > 3 && width(13, nm, RB) > 120) nm.pop_back();
          text(tx + 51, ry + 3, 13, nm, INK, LEFT, RB);
          text(tx + 240 - 14, ry + 4, 11, r.gap, SOFT, RIGHT, RB);
          ry += 21;
        }
      }
    }
    // ---- the dock
    {
      const float bottom = H - 22;
      // NEXT UP
      {
        const bool on = at == 1;
        float y = bottom - 180;
        chunk(24, y, 250, 180, on, CARD);
        const Rgba fg = on ? PAPER : INK, sm = on ? alpha_(PAPER, 0.75f) : SOFT;
        text(37, y + 12, 10, "NEXT UP", sm, LEFT, RB, 0.16f);
        drawMap(R, k, 37, y + 29, 224, 96, S.track, true, clock);
        std::string nm = upper(TRACKS[ti][1]);
        while (nm.size() > 4 && width(26, nm, A, 0.02f) > 224) nm.pop_back();
        text(37, y + 131, 26, nm, fg, LEFT, A, 0.02f);
        const Outline &o = outline(S.track);
        char km[32];
        std::snprintf(km, sizeof km, " - %.3f KM", o.len / 1000);
        text(37, y + 160, 10, std::string(TRACKS[ti][2]) + (o.ok ? km : ""), sm, LEFT, RB, 0.16f);
      }
      // RACE
      {
        const bool on = at == 0;
        float y = bottom - 112;
        const float x = W - 24 - 236;
        if (on) { y -= 3; R.rrect(x * k, (y + 6) * k, 236 * k, 112 * k, 16 * k, INK); }
        R.card(x * k, y * k, 236 * k, 112 * k, 16 * k, 3 * k, RED, INK);
        text(x + 118, y + 18, 58, "RACE", ONRED, CENTRE, A, 0.04f);
        char sub[96];
        if (S.mode == "race") std::snprintf(sub, sizeof sub, "%d LAPS - %d CARS - %s", S.laps, S.grid, upper(TRACKS[ti][1]).c_str());
        else std::snprintf(sub, sizeof sub, "HOT LAP - %s", upper(TRACKS[ti][1]).c_str());
        std::string sb = sub;
        while (sb.size() > 6 && width(11, sb, RB, 0.14f) > 212) sb.pop_back();
        text(x + 118, y + 84, 11, sb, ONRED, CENTRE, RB, 0.14f);
      }
      // the tiles
      {
        static const char *LBL[8] = {"SETUP", "GARAGE", "XINGUS", "SHOWROOM", "BUILDER", "JUKEBOX", "iPAD DASH", "SETTINGS"};
        const float x0 = 24 + 250 + 14, x1 = W - 24 - 236 - 14, avail = x1 - x0;
        const int per = std::max(1, std::min(8, (int)((avail + 10) / 108)));
        const int rowsN = (8 + per - 1) / per;
        for (int i = 0; i < 8; i++) {
          const int row = i / per, inRow = std::min(per, 8 - row * per), col = i % per;
          const float rw = (float)inRow * 98 + (float)(inRow - 1) * 10;
          float x = x0 + (avail - rw) / 2 + (float)col * 108, y = bottom - 90 - (float)(rowsN - 1 - row) * 100;
          const bool on = at == 2 + i;
          chunk(x, y, 98, 90, on, CARD);
          const Rgba fg = on ? PAPER : INK, g1 = on ? hex("#d9d9d9") : hex("#5a5a5a"), g2 = on ? hex("#9a9a9a") : hex("#9c9c9c");
          const float cx = x + 49, cy = y + 34;
          // the icons: flat fills and fat strokes, grey as the page draws them
          switch (i) {
            case 0: flag(cx - 22, cy - 20, 40, g1); break;
            case 1: { const float rf[6] = {(cx - 22) * k, (cy - 2) * k, cx * k, (cy - 20) * k, (cx + 22) * k, (cy - 2) * k}; R.poly(rf, 3, g1);
                      R.rect((cx - 16) * k, (cy - 2) * k, 32 * k, 20 * k, g2); R.rect((cx - 6) * k, (cy + 6) * k, 12 * k, 12 * k, g1); break; }
            case 2: if (boo) pumpkin(cx, cy, 40); else { R.circle((cx - 10) * k, (cy + 10) * k, 7 * k, g1); R.circle((cx + 12) * k, (cy + 6) * k, 7 * k, g1);
                      R.rect((cx - 5) * k, (cy - 16) * k, 3 * k, 26 * k, g1); R.rect((cx + 17) * k, (cy - 20) * k, 3 * k, 26 * k, g1); R.rect((cx - 5) * k, (cy - 20) * k, 25 * k, 5 * k, g1); } break;
            case 3: R.rrect((cx - 24) * k, (cy - 2) * k, 48 * k, 12 * k, 4 * k, g2); R.rrect((cx - 12) * k, (cy - 12) * k, 22 * k, 12 * k, 4 * k, g2);
                    R.circle((cx - 13) * k, (cy + 10) * k, 7 * k, g1); R.circle((cx + 14) * k, (cy + 10) * k, 7 * k, g1); break;
            case 4: { const float hd[8] = {(cx - 8) * k, (cy - 20) * k, (cx + 20) * k, (cy - 8) * k, (cx + 14) * k, (cy + 2) * k, (cx - 14) * k, (cy - 10) * k}; R.poly(hd, 4, g2);
                      const float hn[4] = {(cx - 12) * k, (cy + 18) * k, (cx + 4) * k, (cy - 10) * k}; R.path(hn, 2, 6 * k, g1, false); break; }
            case 5: R.circle((cx - 10) * k, (cy + 10) * k, 7 * k, g1); R.circle((cx + 12) * k, (cy + 6) * k, 7 * k, g1);
                    R.rect((cx - 5) * k, (cy - 16) * k, 3 * k, 26 * k, g1); R.rect((cx + 17) * k, (cy - 20) * k, 3 * k, 26 * k, g1); R.rect((cx - 5) * k, (cy - 20) * k, 25 * k, 5 * k, g1); break;
            case 6: R.rrect((cx - 22) * k, (cy - 16) * k, 44 * k, 32 * k, 3 * k, g2); R.rect((cx - 14) * k, (cy + 2) * k, 6 * k, 8 * k, g1);
                    R.rect((cx - 3) * k, (cy - 5) * k, 6 * k, 15 * k, g1); R.rect((cx + 8) * k, (cy - 10) * k, 6 * k, 20 * k, g1); break;
            default: for (int q = 0; q < 3; q++) { R.rect((cx - 20) * k, (cy - 13 + q * 12) * k, 40 * k, 4 * k, g2); R.circle((cx - 8 + q * 9 * (q == 1 ? 1.4f : -0.2f)) * k, (cy - 11 + q * 12) * k, 6 * k, g1); } break;
          }
          text(cx, y + 63, 15, LBL[i], fg, CENTRE, A, 0.04f);
        }
      }
    }
    return;
  }

  if (page == "setup") {
    const int i = trackIdx(S.track);
    const float tw = title("RACE SETUP");
    {
      const std::string small = team ? upper(team->name) : "NO TEAM", big = upper(carSpec(S.car).full);
      const float x = 24 + tw + (boo ? 64 : 12), w = std::max(width(9, small, RB, 0.16f), width(19, big, A, 0.03f)) + 26;
      R.card(x * k, 28 * k, w * k, 42 * k, 12 * k, 2.5f * k, YELL, INK);
      text(x + 13, 34, 9, small, hex("#5b5540"), LEFT, RB, 0.16f);
      text(x + 13, 45, 19, big, hex("#121212"), LEFT, A, 0.03f);
    }
    sayBox(W - 24 - std::min(520.0f, width(17, sayText, MK) + 30), 30);
    // the circuit, as the first row
    {
      const bool on = at == 0;
      const float y = 92, h = 114, w = W - 48;
      if (on) R.rrect(24 * k, (y + 5) * k, w * k, h * k, 12 * k, RED);
      R.card(24 * k, y * k, w * k, h * k, 12 * k, (on ? 3 : 2.5f) * k, CARD, INK);
      auto arrow = [&](float x, const char *g) { R.circle((x + 25) * k, (y + 57) * k, 25 * k, INK); R.circle((x + 25) * k, (y + 57) * k, 22.5f * k, CARD); text(x + 25, y + 44, 24, g, INK, CENTRE, RB); };
      arrow(36, "<");
      R.hudRot((102 + 23) * k, (y + 57) * k, -7);
      R.circle((102 + 23) * k, (y + 57) * k, 23 * k, INK); R.circle((102 + 23) * k, (y + 57) * k, 20.5f * k, YELL);
      char no[8];
      std::snprintf(no, sizeof no, "%02d", i + 1);
      text(102 + 23, y + 46, 20, no, hex("#121212"), CENTRE, A);
      R.hudRot(0, 0, 0);
      drawMap(R, k, 164, y + 9, 170, 96, S.track, true, clock);
      const Outline &o = outline(S.track);
      char km[32];
      std::snprintf(km, sizeof km, " - %.3f KM", o.len / 1000);
      text(350, y + 22, 10, std::string(TRACKS[i][2]) + (o.ok ? km : ""), SOFT, LEFT, RB, 0.16f);
      text(350, y + 38, 44, upper(TRACKS[i][1]), INK, LEFT, A, 0.02f);
      const float dx = W - 24 - 12 - 50 - 16 - (float)N_TRACKS * 11;
      for (int q = 0; q < N_TRACKS; q++) R.circle((dx + q * 11 + 3.5f) * k, (y + 57) * k, (q == i ? 5.25f : 3.5f) * k, q == i ? RED : mix(INK, CARD, 0.22f));
      arrow(W - 24 - 12 - 50, ">");
    }
    const auto rows = setupRows();
    optGrid(rows, 92 + 114 + 14, H - 22 - 50 - 14, 1);
    foot(S.teams[S.car].empty() ? "PICK A TEAM" : "LIGHTS OUT", "UP / DOWN MOVE  -  LEFT / RIGHT CHANGE  -  G = LIGHTS OUT", at == 1 + (int)rows.size());
    return;
  }

  if (page == "garage") {
    title("THE GARAGE");
    sayBox(W - 24 - std::min(520.0f, width(17, sayText, MK) + 30), 30);
    // the league tabs
    {
      float tw3[3], total = 12;
      for (int q = 0; q < 3; q++) {
        const std::string tn = S.teams[LEAGUE_KEYS[q]].empty() ? "NO TEAM" : upper(teamByKey(S.teams[LEAGUE_KEYS[q]])->name);
        tw3[q] = std::max(width(22, LEAGUE_NAMES[q], A, 0.04f), width(9, tn, RB, 0.14f)) + 52;
        total += tw3[q] + 8;
      }
      float x = W / 2 - total / 2;
      const float y = 92;
      if (at == 0) R.rrect((x - 3) * k, (y - 3) * k, (total + 6 - 8) * k, 64 * k, 21 * k, RED);
      R.rrect(x * k, y * k, (total - 8) * k, 58 * k, 18 * k, PAPER);
      x += 6;
      for (int q = 0; q < 3; q++) {
        const bool sel = S.car == LEAGUE_KEYS[q];
        const std::string tn = S.teams[LEAGUE_KEYS[q]].empty() ? "NO TEAM" : upper(teamByKey(S.teams[LEAGUE_KEYS[q]])->name);
        R.card(x * k, (y + 6) * k, tw3[q] * k, 46 * k, 12 * k, 2.5f * k, sel ? INK : CARD, INK);
        text(x + tw3[q] / 2, y + 13, 22, LEAGUE_NAMES[q], sel ? PAPER : INK, CENTRE, A, 0.04f);
        text(x + tw3[q] / 2, y + 37, 9, tn, sel ? alpha_(PAPER, 0.7f) : SOFT, CENTRE, RB, 0.14f);
        x += tw3[q] + 8;
      }
    }
    const auto keys = teamsIn(S.car);
    if (!keys.empty()) {
      int i = 0;
      for (size_t q = 0; q < keys.size(); q++) if (keys[q] == S.teams[S.car]) i = (int)q;
      if (garageAt >= 0 && garageAt < (int)keys.size()) i = garageAt;
      const int n = (int)keys.size();
      const float top = 164, bot = H - 22 - 50 - 14, cy = (top + bot) / 2;
      const float mw = std::min(520.0f, W * 0.46f), mh = std::min(std::min(440.0f, H * 0.62f), bot - top - 8);
      auto livery = [&](float x, float y, float w, float h, const Team *t) {
        Rgba c1, c2;
        cols(t, c1, c2);
        R.rrect(x * k, y * k, w * k, h * k, 8 * k, c1);
        // a band of the second colour across it, six degrees off level
        const float by = y + h * 0.54f, bh = h * 0.20f, sl = w * 0.105f / 2;
        const float band[8] = {x * k, (by + sl) * k, (x + w) * k, (by - sl) * k, (x + w) * k, (by - sl + bh) * k, x * k, (by + sl + bh) * k};
        R.poly(band, 4, c2);
      };
      auto side = [&](const std::string &kk, float x) {
        const Team *t = teamByKey(kk);
        R.hudAlpha = 0.7f;
        const float w = 188, h = 226, y = cy - h / 2;
        R.card(x * k, y * k, w * k, h * k, 12 * k, 2.5f * k, CARD, INK);
        livery(x + 15, y + 13, w - 30, h - 13 - 15 - 34, t);
        std::string nm = t ? upper(t->name) : kk;
        while (nm.size() > 4 && width(24, nm, A, 0.02f) > w - 30) nm.pop_back();
        text(x + 15, y + h - 15 - 24, 24, nm, INK, LEFT, A, 0.02f);
        R.hudAlpha = 1;
      };
      const float gap = 22, total = 64 + 18 + 188 + gap + mw + gap + 188 + 18 + 64;
      float x = W / 2 - total / 2;
      auto arrow = [&](float ax, const char *g) { R.circle((ax + 32) * k, cy * k, 32 * k, INK); R.circle((ax + 32) * k, cy * k, 29.5f * k, CARD); text(ax + 32, cy - 16, 30, g, INK, CENTRE, RB); };
      arrow(x, "<"); x += 64 + 18;
      side(keys[(size_t)((i - 1 + n) % n)], x); x += 188 + gap;
      {
        const std::string kk = keys[(size_t)i];
        const Team *t = teamByKey(kk);
        const float y = cy - mh / 2;
        R.rrect(x * k, (y + 7) * k, mw * k, mh * k, 12 * k, RED);
        R.card(x * k, y * k, mw * k, mh * k, 12 * k, 3 * k, CARD, INK);
        const float ns = std::max(26.0f, std::min(48.0f, W * 0.036f));
        const float lh = mh - 13 - 15 - 10 - ns - 4 - 14 - 5 - 16;
        livery(x + 15, y + 13, mw - 30, lh, t);
        const auto dv = driversOf(kk);
        if (!dv.empty()) {
          R.circle((x + mw - 15 - 14 - 30) * k, (y + 13 + 12 + 30) * k, 30 * k, hex("#121212"));
          R.circle((x + mw - 15 - 14 - 30) * k, (y + 13 + 12 + 30) * k, 27.5f * k, hex("#ffffff"));
          text(x + mw - 15 - 14 - 30, y + 13 + 12 + 16, 27, std::to_string(dv[0]->num), hex("#121212"), CENTRE, A);
        }
        if (S.teams[S.car] == kk) {
          const float sw = width(15, "YOUR TEAM", A, 0.05f) + 22, sx = x + mw - 15 - 12 - sw, sy = y + 13 + lh - 12 - 24;
          R.hudRot((sx + sw / 2) * k, (sy + 12) * k, -3);
          R.rrect(sx * k, sy * k, sw * k, 24 * k, 7 * k, hex("#121212"));
          text(sx + 11, sy + 5, 15, "YOUR TEAM", hex("#ffffff"), LEFT, A, 0.05f);
          R.hudRot(0, 0, 0);
        }
        float ty = y + 13 + lh + 10;
        std::string nm = t ? upper(t->name) : kk;
        while (nm.size() > 4 && width(ns, nm, A, 0.02f) > mw - 30) nm.pop_back();
        text(x + 15, ty, ns, nm, INK, LEFT, A, 0.02f);
        ty += ns + 4;
        text(x + 15, ty, 11, std::string(leagueName(S.car)) + " - " + upper(carSpec(S.car).full), SOFT, LEFT, RB, 0.16f);
        ty += 14 + 5;
        std::string names;
        for (const auto *d : dv) {
          if (!names.empty()) names += " - ";
          names += (t && t->league == "f1" && t->era != "classic") ? d->n : "#" + std::to_string(d->num);
        }
        text(x + 15, ty, 12, names, INK, LEFT, RB);
        if (boo && at == 1) pumpkin(x + mw + 2, y - 2, 32);
        x += mw + gap;
      }
      side(keys[(size_t)((i + 1) % n)], x); x += 188 + 18;
      arrow(x, ">");
      foot(S.teams[S.car] == keys[(size_t)i] ? "DONE" : "JOIN", "UP LEAGUE  -  LEFT / RIGHT TEAM  -  ENTER JOIN", at == 2);
    }
    return;
  }

  if (page == "settings") {
    title("SETTINGS");
    sayBox(W - 24 - std::min(520.0f, width(17, sayText, MK) + 30), 30);
    const std::vector<Opt> rows = {
      {"THEME", "theme", {{"light", "LIGHT"}, {"dark", "DARK"}, {"halloween", "HALLOWEEN"}}},
      {"MUSIC", "music", {{"on", "ON"}, {"low", "QUIET"}, {"off", "OFF"}}},
      {"VIEW", "cam", {{"0", "ONBOARD"}, {"1", "CHASE"}, {"2", "NOSE"}, {"3", "T-CAM"}}},
      {"IDEAL LINE", "line", {{"false", "HIDDEN"}, {"true", "SHOWN"}}},
      {"VOLUME", "volume", {{"0", "OFF"}, {"2", "20%"}, {"4", "40%"}, {"6", "60%"}, {"8", "80%"}, {"10", "100%"}}},
      {"WHEEL FORCE (THROUGH TOOLS/FFB.PY)", "ffb", {{"0", "OFF"}, {"20", "20%"}, {"35", "35%"}, {"50", "50%"}, {"65", "65%"}, {"80", "80%"}, {"100", "100%"}}},
    };
    optGrid(rows, 92, H - 22 - 50 - 14, 0);
    foot("DONE", "UP / DOWN MOVE  -  LEFT / RIGHT CHANGE", at == (int)rows.size());
  }
}

}  // namespace xbr
