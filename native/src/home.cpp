// home.cpp — home.html + js/home.js + the voice in js/menuui.js. See home.hpp.
// Sizes are the stylesheet's, in CSS pixels; `k` turns them into the screen's.
#include "home.hpp"
#include "multiclass.hpp"

#include <set>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <ctime>
#include <fstream>

#include "driver.hpp"
#include "homestyle.hpp"
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
// Circuits that may or may not be on this machine yet: each joins the list only
// when its data/tracks/<key>.json exists. A name left empty is read from that file.
static const char *OPTIONAL[][3] = {
  {"gravenmoor", "Gravenmoor", "THE MOOR - ONLY EVER AT NIGHT"}, {"nordschleife", "Nordschleife", "GERMANY - 20.8 KM"},
  {"bathurst", "Mount Panorama", "AUSTRALIA - THE MOUNTAIN"}, {"lagunaseca", "Laguna Seca", "USA - THE CORKSCREW"}, {"lemans", "", ""},
  {"brandshatch", "Brands Hatch", "UNITED KINGDOM"}, {"macau", "", ""},
};
static const char *LEAGUE_KEYS[3] = {"f1", "gt3", "f4"}, *LEAGUE_NAMES[3] = {"F1", "GT3", "F4"};
static const char *leagueName(const std::string &k) { for (int i = 0; i < 3; i++) if (k == LEAGUE_KEYS[i]) return LEAGUE_NAMES[i]; return "F1"; }

// ---- XINGUS (js/home.js) --------------------------------------------------------------
//   key, label, the line under it, car tune, rivals, derby, stakes, loose
static const XStyle XSTYLES[] = {
    {"hotlaps", "HOTLAPS", "ALONE - RALLY CAR", "rally", 0, false, false, false},
    {"rally", "RALLY", "ALONE - IT COUNTS", "rally", 0, false, true, false},
    {"rallycross", "RALLYCROSS", "SIX OF YOU - NO LINE, NO RULES", "rally", 5, false, false, true},
    {"rallygt", "RALLY GT", "GT CARS ON THE STAGES", "gt", 9, false, false, false},
    {"gt3", "GT3", "FAST SEDAN RACE", "gt", 17, false, false, false},
    {"gt3lonely", "GT3 LONELY", "ALONE - GT CAR", "gt", 0, false, false, false},
    {"derby", "DEMO DERBY", "NOBODY IS CAREFUL", "gt", 21, true, false, false},
};
const XStyle &xstyle(const std::string &key) { for (const XStyle &x : XSTYLES) if (key == x.key) return x; return XSTYLES[4]; }
// A Heiligen route key <-> the choice at each junction.
struct HeilChoice { bool rx; std::string town, mid, end; };
static const char *HEIL_BASE[6][3] = {{"alt", "pass", "grand"}, {"ring", "pass", "schnee"}, {"alt", "wald", "wald"},
                                      {"ring", "wald", "forst"}, {"alt", "tal", "stadt"}, {"ring", "tal", "sprint"}};
static std::string heilKey(const HeilChoice &c) {
  std::string base = "grand";
  for (auto &b : HEIL_BASE) if (c.town == b[0] && c.mid == b[1]) base = b[2];
  return std::string("heil") + (c.rx ? "rx" : base) + (c.end == "joker" ? "j" : "");
}
static HeilChoice heilChoice(std::string key) {
  HeilChoice c{false, "alt", "pass", "wall"};
  if (key.size() > 4 && key.back() == 'j') { c.end = "joker"; key.pop_back(); }
  const std::string base = key.size() > 4 ? key.substr(4) : "";
  if (base == "rx") { c.rx = true; c.town = "ring"; c.mid = "tal"; return c; }
  for (auto &b : HEIL_BASE) if (base == b[2]) { c.town = b[0]; c.mid = b[1]; }
  return c;
}

// ---- the voice (js/menuui.js SAY) ---------------------------------------------------
static std::string sayFor(const std::string &row, const std::string &v) {
  struct L { const char *row, *val, *line; };
  static const L T[] = {
    {"CIRCUIT", "test", "the test map. science time."}, {"CIRCUIT", "kate", "kate mascoi. wide, fast, and nowhere to hide."},
    {"CIRCUIT", "street", "pembroke. home race. no pressure."}, {"CIRCUIT", "adam1", "the first one. be nice to it."},
    {"CIRCUIT", "monza", "flat out. brake. pray. repeat."}, {"CIRCUIT", "zandvoort", "banking! in the dunes! who allowed this."},
    {"CIRCUIT", "suzuka", "hachi no ji. best track. no notes."}, {"CIRCUIT", "baku", "two kilometres of straight and then a castle. obviously."},
    {"CIRCUIT", "monaco", "the walls are closer than they look. then closer than that."}, {"CIRCUIT", "nurburgring", "germany. precise. cold. probably foggy."},
    {"CIRCUIT", "sepang", "it will rain. it always rains."}, {"CIRCUIT", "gravenmoor", "the church tower is the braking point. the tree is the other one."},
    {"CIRCUIT", "nordschleife", "20.8 kilometres. 75 corners. nobody learns it in a weekend. try anyway."},
    {"CIRCUIT", "bathurst", "up the mountain between concrete walls. then down conrod, flat."},
    {"CIRCUIT", "lagunaseca", "the corkscrew: five storeys down in two corners."},
    {"CIRCUIT", "brandshatch", "paddock hill bend drops away under you. the rest is in the woods."},
    {"CIRCUIT", "nordschleife", "twenty kilometres. nobody has finished counting the corners."}, {"CIRCUIT", "spa", "seven kilometres of forest and one hill everybody talks about."},
    {"CAR", "f4", "small car. big dreams."}, {"CAR", "gt3", "the one with a roof."}, {"CAR", "f1", "the big one. hands at ten and two."},
    {"MODE", "hotlap", "just you and the clock. the clock is mean."}, {"MODE", "race", "wheel to wheel. elbows out."}, {"MODE", "gt", "three classes, one road. mind your mirrors."},
    {"CAR", "hyper", "the prototype. everything else is traffic."}, {"CAR", "gt3", "the proper GT car. heavy, loud, honest."},
    {"CAR", "gt4", "a road car with a cage. slower. more fun than it should be."},
    {"CAR", "rally", "dirt. brake hard, turn right to go left."}, {"GEARS", "manual", "your gears now. mind the limiter."},
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
  int ffbSeen = -1, ffbVer = 0;
  while (f >> k && std::getline(f >> std::ws, v)) {
    if (k == "track") track = v; else if (k == "car") car = v; else if (k == "mode") mode = v; else if (k == "tier") tier = v;
    else if (k == "start") start = v; else if (k == "grid") grid = std::atoi(v.c_str()); else if (k == "laps") laps = std::atoi(v.c_str());
    else if (k == "noDnf") noDnf = v == "1"; else if (k == "time") time = v; else if (k == "weather") weather = v;
    else if (k == "battle") battle = v; else if (k == "field") field = v; else if (k == "theme") theme = v; else if (k == "music") music = v;
    else if (k == "team.f1") teams["f1"] = v; else if (k == "team.gt3") teams["gt3"] = v; else if (k == "team.f4") teams["f4"] = v;
    else if (k == "ffb") ffbSeen = std::atoi(v.c_str()); else if (k == "ffbv") ffbVer = std::atoi(v.c_str()); else if (k == "cam") cam = std::atoi(v.c_str());
    else if (k == "volume") volume = std::atoi(v.c_str()); else if (k == "line") line = v == "1";
    else if (k == "model") { model = v == "-" ? "" : v; modelSeen = true; } else if (k == "look") look = v == "plain" ? "plain" : "film";
    else if (k == "gears") gears = v == "manual" ? "manual" : "auto";
    else if (k == "gton") gtOn = v == "1"; else if (k == "gtclass") gtClass = gtClassOf(v) >= 0 ? v : "gt3";
    else if (k == "xon") xOn = v == "1"; else if (k == "xstyle") xStyle = v; else if (k == "xgears") xGears = v; else if (k == "xtrack") xTrack = v;
    else if (k == "xheil") xHeil = v; else if (k == "xfield") xField = v; else if (k == "xbots") xBots = std::atoi(v.c_str());
  }
  xStyle = xstyle(xStyle).key; xBots = std::max(0, std::min(60, xBots));
  // a record from before the wheel's force was set up said 0 because nothing else was possible
  if (ffbSeen >= 0 && ffbVer >= 2) ffb = ffbSeen;
  if (gtClassOf(car) >= 0 && car != "gt3") { gtClass = car; car = "gt3"; }      // a record that named a GT4 or a hypercar as the car
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
    << "\nfield " << field << "\ntheme " << theme << "\nmusic " << music << "\nffbv 2\nffb " << ffb << "\ncam " << cam << "\nvolume " << volume
    << "\nline " << (line ? 1 : 0) << "\n";
  if (modelSeen || !model.empty()) f << "model " << (model.empty() ? "-" : model) << "\n";
  f << "look " << look << "\n";
  f << "xon " << (xOn ? 1 : 0) << "\nxstyle " << xStyle << "\nxgears " << xGears << "\nxheil " << xHeil << "\nxfield " << xField << "\nxbots " << xBots << "\n";
  f << "gears " << gears << "\n";
  f << "gton " << (gtOn ? 1 : 0) << "\ngtclass " << gtClass << "\n";
  if (!xTrack.empty()) f << "xtrack " << xTrack << "\n";
  for (const auto &kv : teams) if (!kv.second.empty()) f << "team." << kv.first << " " << kv.second << "\n";
}

Home::Home(const std::string &dataDir_, const std::string &savePath_) : dataDir(dataDir_), savePath(savePath_) {
  if (!savePath.empty()) S.load(savePath);
  const Json idx = Json::loadOpt(dataDir + "/cars/index.json");
  if (idx.isArr()) for (size_t i = 0; i < idx.size(); i++) packs.push_back({idx[i]["key"].s(""), idx[i]["title"].s(""), idx[i]["klass"].s("gt3")});
  // nobody has chosen yet: the GT3 seat gets the real GT3 car if this machine has one, not the stand-in body
  if (!S.modelSeen) for (const Pack &p : packs) if (p.klass == "gt3") { S.model = p.key; break; }
  hmap = Json::loadOpt(dataDir + "/build/heiligen-map.json");
  career.load(dataDir);
  for (auto &o : OPTIONAL) {
    std::ifstream f(dataDir + "/tracks/" + o[0] + ".json");
    if (!f) continue;
    std::string tag = o[2];
    if (tag.empty()) { const Json j = Json::loadOpt(dataDir + "/tracks/" + o[0] + ".json"); tag = j["country"].s(""); }
    extra.push_back({o[0], *o[1] ? std::string(o[1]) : career.trackName(o[0]), tag});
  }
  // the career's save sits beside the menu's; an unattended run has no path and writes nothing
  if (savePath.size() > 8 && savePath.compare(savePath.size() - 8, 8, "menu.txt") == 0) career.loadState(savePath.substr(0, savePath.size() - 8) + "career.txt", true);
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
// Downloaded cars are all cars with a roof: they take the GT3 seat and its physics.
std::string Home::pack() const {
  // the rally car wears the 911, where this machine has it: short, rear-engined, made for this
  if (!eventOn && !S.xOn && S.car == "rally") { for (const Pack &p : packs) if (p.key == "p911") return "p911"; return ""; }
  // a GT4 or a hypercar wears its class's own car, as does every class in a multiclass race
  if (gt() || (!eventOn && !S.xOn && S.car == "gt3" && S.gtClass != "gt3")) {
    const std::string want = xbr::gtClass(gtClassOf(S.gtClass)).pack;
    for (const Pack &p : packs) if (p.key == want) return want;
    return "";
  }
  if (!S.xOn && S.car != "gt3") return "";
  for (const Pack &p : packs) if (p.key == S.model) return p.key;
  return "";
}
std::string Home::voice() const {
  if (seatCar() != S.car) return S.gtClass;
  const std::string k = pack();
  for (const Pack &p : packs) if (p.key == k) return p.klass;
  return S.xOn ? "gt3" : S.car;
}
// The circuit row. Heiligen is Xingus's own: one entry, its route chosen on a map. So is the oval.
std::vector<Home::Circuit> Home::circuits() const {
  std::vector<Circuit> L;
  if (S.xOn) { L.push_back({"heiligen", "Heiligen Auto Circuit", "VALCORSA - 14 ROUTES"}); L.push_back({"speedway", "Xingus Speedway", "OVAL - DRAFT - PIT (P)"}); }
  // THE DIRT. With the rally car chosen, the Heiligen stages come first: gravel through the forest,
  // the rallycross loop, and the one that climbs into the snow. (Hand-laid; about a third of each is still tarmac.)
  if (!S.xOn && S.car == "rally") {
    L.push_back({"heilforst", "Heiligen Forst", "DIRT STAGE - 7.1 KM - TWO THIRDS GRAVEL"});
    L.push_back({"heilrx", "Heiligen Rallycross", "DIRT AND TARMAC - 2.4 KM"});
    L.push_back({"heilschnee", "Heiligen Schnee", "GRAVEL, THEN SNOW - 8.3 KM"});
  }
  for (int i = 0; i < N_TRACKS; i++) L.push_back({TRACKS[i][0], TRACKS[i][1], TRACKS[i][2]});
  for (const Circuit &c : extra) L.push_back(c);
  return L;
}
std::string Home::circuitId() const {
  if (!S.xOn) return S.track;
  if (S.xTrack == "heiligen" || S.xTrack == "speedway") return S.xTrack;
  for (int i = 0; i < N_TRACKS; i++) if (S.xTrack == TRACKS[i][0]) return S.xTrack;
  for (const Circuit &c : extra) if (S.xTrack == c.id) return S.xTrack;
  return S.track;
}
std::string Home::circuitName(const std::string &key) {
  for (int i = 0; i < N_TRACKS; i++) if (key == TRACKS[i][0]) return TRACKS[i][1];
  for (const Circuit &c : extra) if (key == c.id) return c.name;
  return career.trackName(key);
}
std::string Home::xTrackKey() const { const std::string id = circuitId(); return id == "heiligen" ? S.xHeil : id; }
std::string Home::get(const std::string &key) const {
  if (key == "model") return pack();
  if (key == "look") return S.look;
  if (key == "modeX") return S.xOn ? "xingus" : S.gtOn && S.car == "gt3" ? "gt" : S.mode;
  if (key == "carX") return seatCar();
  if (key == "gears") return S.gears;
  if (key == "xStyle") return S.xStyle;
  if (key == "xGears") return S.xGears == "auto" ? "auto" : "manual";
  if (key == "xBots") return S.xBots > 0 ? std::to_string(S.xBots) : "style";
  if (key == "xField") return S.xField == "skilled" ? "skilled" : "4fun";
  if (key == "heil") return S.xHeil;
  if (key == "hTown") return heilChoice(S.xHeil).town;
  if (key == "hMid") return heilChoice(S.xHeil).mid;
  if (key == "hEnd") return heilChoice(S.xHeil).end;
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
  else if (key == "model") { S.model = v; S.modelSeen = true; dirty = true; }
  else if (key == "look") S.look = v;
  else if (key == "modeX") { S.xOn = v == "xingus"; S.gtOn = v == "gt"; if (!S.xOn) S.mode = v == "race" || v == "gt" ? "race" : "hotlap"; dirty = true; }
  else if (key == "carX") {
    if (gtClassOf(v) >= 0) { S.car = "gt3"; S.gtClass = v; } else { S.car = v == "f4" ? "f4" : v == "rally" ? "rally" : "f1"; }
    // a rally car belongs on a dirt stage: the first time, it is taken to one
    if (v == "rally" && S.track.rfind("heil", 0) != 0) S.track = "heilforst";
    if (v != "rally" && S.track.rfind("heil", 0) == 0) S.track = "monza";
    garageAt = -1; dirty = true;
  }
  else if (key == "gears") S.gears = v == "manual" ? "manual" : "auto";
  else if (key == "xStyle") S.xStyle = xstyle(v).key; else if (key == "xGears") S.xGears = v;
  else if (key == "xBots") S.xBots = v == "style" ? 0 : std::atoi(v.c_str()); else if (key == "xField") S.xField = v;
  else if (key == "heil") S.xHeil = v;
  else if (key == "hTown" || key == "hMid" || key == "hEnd") {
    HeilChoice c = heilChoice(S.xHeil);
    c.rx = key == "hEnd" ? c.rx : false;
    (key == "hTown" ? c.town : key == "hMid" ? c.mid : c.end) = v;
    S.xHeil = heilKey(c);
  }
}
// THE HEILIGEN PAGE: a route is a choice at each junction — town or ring road,
// valley or forest or the pass, the banking or the joker (js/home.js heiligen()).
std::vector<Home::Opt> Home::heilRows() const {
  std::vector<Opt> rows;
  rows.push_back({"PREMADE", "heil", {{"heilgrand", "GRAND 9.0"}, {"heilschnee", "SCHNEE"}, {"heilwald", "WALD"}, {"heilforst", "FORST"}, {"heilstadt", "STADT"},
                                      {"heilsprint", "SPRINT 4.9"}, {"heilrx", "RALLYCROSS"}, {"heilrxj", "RX - JOKER EVERY LAP"}}});
  if (!heilChoice(S.xHeil).rx) {
    rows.push_back({"THE TOWN", "hTown", {{"alt", "ALTSTADT"}, {"ring", "STADTRING"}}});
    rows.push_back({"THE MOUNTAIN", "hMid", {{"tal", "VALLEY"}, {"wald", "FOREST"}, {"pass", "THE PASS"}}});
  }
  rows.push_back({"THE LAST CORNER", "hEnd", {{"wall", "STEILWAND - ONE JOKER LAP OWED"}, {"joker", "JOKER ROAD EVERY LAP"}}});
  return rows;
}
std::vector<Home::Opt> Home::setupRows() const {
  std::vector<Opt> rows;
  // the car first, then what to do with it
  if (!S.xOn) rows.push_back({"CAR", "carX", {{"f4", "F4"}, {"f1", "F1"}, {"gt3", "GT3"}, {"gt4", "GT4"}, {"hyper", "HYPERCAR"}, {"rally", "RALLY"}}});
  {
    Opt m{"MODE", "modeX", {{"hotlap", "HOT LAP - ALONE"}, {"race", "RACE"}}};
    if (S.car == "gt3" || S.xOn) m.opts.push_back({"gt", "MULTICLASS"});      // three classes on one road: a GT car's own kind of race
    m.opts.push_back({"xingus", "XINGUS"});
    rows.push_back(m);
  }
  // the paddles as the gearbox, in any car (Xingus has its own row below)
  if (!S.xOn) rows.push_back({"GEARS", "gears", {{"auto", "AUTOMATIC"}, {"manual", "MANUAL - PADDLES (E / Q)"}}});
  if (S.xOn) {
    Opt st{"STYLE", "xStyle", {}};
    for (const XStyle &x : XSTYLES) st.opts.push_back({x.key, x.label});
    rows.push_back(st);
    rows.push_back({"GEARS", "xGears", {{"manual", "PADDLES (E / Q)"}, {"auto", "AUTOMATIC"}}});
    const XStyle &x = xstyle(S.xStyle);
    if (x.rivals) {
      rows.push_back({"LAPS", "laps", {{"2", "2"}, {"3", "3"}, {"5", "5"}, {"10", "10"}, {"20", "20"}}});
      rows.push_back({"BOTS", "xBots", {{"style", std::to_string(x.rivals)}, {"29", "29"}, {"49", "49"}}});
      if (circuitId() == "speedway") rows.push_back({"FIELD", "xField", {{"skilled", "SKILLED"}, {"4fun", "4FUN"}}});
    }
  }
  if ((S.xOn || seatCar() == "gt3") && !gt() && !packs.empty()) {
    Opt m{"MODEL", "model", {{"", "XBR GT3"}}};
    for (const Pack &p : packs) { std::string t = p.title; for (char &c : t) c = (char)std::toupper((unsigned char)c); m.opts.push_back({p.key, t}); }
    rows.push_back(m);
  }
  if (!S.xOn && S.mode == "race") {
    rows.push_back({"LAPS", "laps", {{"2", "2"}, {"3", "3"}, {"5", "5"}, {"10", "10"}, {"20", "20"}}});
    rows.push_back({"GRID", "grid", {{"6", "6"}, {"12", "12"}, {"16", "16"}, {"22", "22"}}});
    Opt riv{"RIVALS", "tier", {}};
    for (const auto &t : allTiers()) riv.opts.push_back({t.key, t.name});
    rows.push_back(riv);
    if (S.tier == "supercasual") rows.push_back({"OVERTAKES", "battle", {{"easy", "EASY"}, {"medium", "MEDIUM"}, {"hard", "HARD"}}});
    rows.push_back({"YOU START", "start", {{"pole", "POLE"}, {"front", "FRONT ROW"}, {"mid", "MIDFIELD"}, {"back", "LAST"}}});
    rows.push_back({"RETIREMENT", "noDnf", {{"false", "NORMAL"}, {"true", "NO DNF"}}});
    if (S.car == "f1" && !gt()) rows.push_back({"FIELD", "field", {{"f1", "2026 GRID"}, {"classic", "CLASSIC"}, {"fantasy", "FANTASY"}, {"all", "ALL ERAS"}}});
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
  if (name == "debrief") at = 1;                                       // CONTINUE
  if (name == "career" && keep == 0) { const EventDef *e = career.next(); if (e && e->season == viewSeason) at = e->index; }
  if (!savePath.empty() && !eventOn) S.save(savePath);
}

void Home::lightsOut() {
  if (!noTeam() && S.teams[S.car].empty()) { show("garage"); say("pick a team first. then we race."); return; }
  if (!savePath.empty() && !eventOn) S.save(savePath);
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
    // THE HUB: a stack down the left, tonight's poster on the right
    auto side = [this] { at = 6; };
    items.push_back({[this] { show("career"); }, nullptr, side});
    items.push_back({[this] { if (S.xOn) { S.xOn = false; dirty = true; } show("setup"); }, nullptr, side});
    items.push_back({[this] { show("events"); }, nullptr, side});
    items.push_back({[this] { S.xOn = true; dirty = true; show("setup"); say("xingus mode. grip, drift, no spins."); }, nullptr, side});
    items.push_back({[this] { show("garage"); }, nullptr, side});
    items.push_back({[this] { show("settings"); }, nullptr, side});
    items.push_back({[this] { const EventDef *e = career.next(); if (e && career.unlocked(*e)) launchCareer(*e); else show("career"); },
                     [this] { at = 0; }, nullptr, [this] {}, [this] {}});
  } else if (page == "career") {
    if (viewSeason < 0 || viewSeason >= (int)career.seasons.size()) viewSeason = career.currentSeason();
    auto turn = [this](int d) {
      const int n = (int)career.seasons.size();
      viewSeason = std::max(0, std::min(n - 1, viewSeason + d));
      show("career", 0);
      const SeasonDef &sd = career.seasons[(size_t)viewSeason];
      say(career.seasonOpen(viewSeason) ? sd.blurb : "locked. finish the season before it. top " + std::to_string(career.seasons[(size_t)viewSeason - 1].promote) + " of the table.");
    };
    if (!career.seasons.empty())
      for (const EventDef &e : career.seasons[(size_t)viewSeason].events) {
        const EventDef *ep = &e;
        items.push_back({[this, ep] { launchCareer(*ep); }, [turn] { turn(-1); }, [turn] { turn(1); }});
      }
    auto paint = [this](int d) {
      std::vector<const Paint *> own;
      for (const Paint &p : career.paints) if (career.owns(p.key)) own.push_back(&p);
      int i = 0;
      for (size_t q = 0; q < own.size(); q++) if (own[q]->key == career.paint) i = (int)q;
      const int n = (int)own.size();
      const Paint &p = *own[(size_t)((i + d + n) % n)];
      career.paint = p.key; career.saveState();
      say(n < 2 ? "one paint so far. the events have more." : p.line);
    };
    items.push_back({[paint] { paint(1); }, [paint] { paint(-1); }, [paint] { paint(1); }});
    items.push_back({[this] {
      const auto v = career.soFar();
      if (v.empty()) say("nothing has happened yet. go and make something happen.");
      else story(v, "THE STORY SO FAR", [this] { show("career", (int)items.size() - 2); }, true);
    }, nullptr, nullptr});
    items.push_back({[this] { const EventDef *e = career.next(); if (e) launchCareer(*e); else say("that is all of it. for now."); }, nullptr, nullptr});
  } else if (page == "events") {
    const int n = (int)career.modes.size();
    for (int i = 0; i < n; i++) {
      const EventDef *m = &career.modes[(size_t)i];
      items.push_back({[this, m] {
        if (!career.modeOpen(*m)) { const EventDef *l = career.find(m->lock); say("locked. the career opens it: " + (l ? l->title : std::string("keep going")) + "."); return; }
        if (!startEvent(*m, false)) say("that circuit is not on this machine yet.");
      }, nullptr, nullptr, [this, i] { if (i >= 4) at = i - 4; }, [this, i, n] { at = i + 4 < n ? i + 4 : n; }});
    }
    items.push_back({[this] { if (S.xOn) { S.xOn = false; dirty = true; } show("setup"); say("pick the circuit and the car. then come back."); }, nullptr, nullptr, [this, n] { at = std::max(0, n - 4); }, nullptr});
  } else if (page == "story") {
    back = [this] { storyStep(999); };
    items.push_back({[this] { storyStep(1); }, [this] { storyStep(-1); }, [this] { storyStep(1); }});
  } else if (page == "debrief") {
    back = [this] { afterDebrief(); };
    items.push_back({[this] {
      const EventDef *e = career.find(career.out.key);
      const bool inCareer = career.out.career;
      career.out = Outcome{};
      if (!e || !startEvent(*e, inCareer)) show(inCareer ? "career" : "events");
    }, nullptr, nullptr});
    items.push_back({[this] { afterDebrief(); }, nullptr, nullptr});
  } else if (page == "setup") {
    auto step = [this](int d) {
      const auto L = circuits();
      const std::string cur = circuitId();
      int i = 0;
      const int n = (int)L.size();
      for (int q = 0; q < n; q++) if (L[(size_t)q].id == cur) i = q;
      const std::string id = L[(size_t)((i + d + n) % n)].id;
      if (S.xOn) S.xTrack = id;
      if (id != "heiligen" && id != "speedway") S.track = id;
      if (id == "speedway" && !xstyle(S.xStyle).rivals) S.xStyle = "gt3";      // an oval is a pack: not a style that is alone
      dirty = true;
      show("setup", 0);
      say(id == "heiligen" ? "heiligen. fourteen ways round. pick one." : id == "speedway" ? "the oval. turn left. repeat." : sayFor("CIRCUIT", id));
    };
    items.push_back({[this] { if (circuitId() == "heiligen") show("heiligen"); else at = 1; }, [step] { step(-1); }, [step] { step(1); }});
    optItems(setupRows(), "setup");
    items.push_back({[this] { lightsOut(); }, nullptr, nullptr});
  } else if (page == "heiligen") {
    back = [this] { show("setup"); };
    optItems(heilRows(), "heiligen");
    items.push_back({[this] { show("setup"); }, nullptr, nullptr});
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
              {"LOOK", "look", {{"film", "FILM (SHADOWS, BLOOM)"}, {"plain", "PLAIN (FASTER)"}}},
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
  if (n == Nav::Go) { if (page == "setup") lightsOut(); else if (page == "home") { const EventDef *e = career.next(); if (e && career.unlocked(*e)) launchCareer(*e); else show("career"); } return; }
  if (items.empty()) return;
  const Item it = items[(size_t)at];
  if (n == Nav::Ok) { if (it.ok) it.ok(); return; }
  if (n == Nav::Left || n == Nav::Right) {
    const auto &f = n == Nav::Left ? it.left : it.right;
    if (f) f();
    else at = std::max(0, std::min((int)items.size() - 1, at + (n == Nav::Left ? -1 : 1)));
    return;
  }
  const auto &v = n == Nav::Up ? it.up : it.down;
  if (v) { v(); at = std::max(0, std::min((int)items.size() - 1, at)); return; }
  at = std::max(0, std::min((int)items.size() - 1, at + (n == Nav::Up ? -1 : 1)));
}

void Home::mouse(float x, float y, bool click) {
  // the last one drawn is on top: search from the back
  for (auto it = hots.rbegin(); it != hots.rend(); ++it) {
    if (x < it->x || y < it->y || x > it->x + it->w || y > it->y + it->h) continue;
    if (it->item >= 0 && it->item < (int)items.size()) at = it->item;
    if (click) {
      const std::function<void()> fn = it->fn;       // it may rebuild the page under us
      if (fn) fn();
      else if (it->item >= 0 && it->item < (int)items.size() && items[(size_t)it->item].ok) { const auto ok = items[(size_t)it->item].ok; ok(); }
    }
    return;
  }
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
  hots.clear();
  (void)live;      // the hub has no tower: tonight's poster stands where it was
  auto hot = [&](float x, float y, float w, float h, int item, std::function<void()> fn = nullptr) { hots.push_back({x * k, y * k, w * k, h * k, item, std::move(fn)}); };
  const float W = (float)R.W / k, H = (float)R.H / k;
  const int A = Renderer::ANTON, RB = Renderer::RUBIK, MK = Renderer::MARKER;
  auto text = [&](float x, float y, float size, const std::string &s, const Rgba &c, Align al = LEFT, int font = 1, float track = 0) {
    return R.textPx(x * k, y * k, size * k, s, c, al, font, track) / k;
  };
  auto width = [&](float size, const std::string &s, int font = 1, float track = 0) { return R.widthPx(size * k, s, font, track) / k; };
  auto upper = [](std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; };
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
    hot(24, y, width(26, "< BACK", A, 0.04f) + 60, 50, -1, [this] { if (back) back(); });
    hot(W - 24 - (width(26, next + " >", A, 0.04f) + 60), y, width(26, next + " >", A, 0.04f) + 60, 50, (int)items.size() - 1);
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
        hot(x, y, cw, m, first + (int)i + c, [] {});
        text(x + 12, y + 10, 10, o.label, on ? RED : SOFT, LEFT, RB, 0.18f);
        float px = x + 12, py = y + 9 + 18;
        const std::string cur = get(o.key);
        for (const auto &p : o.opts) {
          const float pw = width(16, p.second, A, 0.04f) + 28;
          if (px + pw > x + cw - 12 && px > x + 12) { px = x + 12; py += 31; }
          const bool sel = p.first == cur;
          R.card(px * k, py * k, pw * k, 25 * k, 9 * k, 2 * k, sel ? INK : CARD, INK);
          {
            const std::string key = o.key, val = p.first, label = o.label, pg = page;
            const int idx = first + (int)i + c;
            hot(px, py, pw, 25, idx, [this, key, val, label, pg, idx] { set(key, val); show(pg, idx); say(sayFor(label, val)); });
          }
          text(px + 14, py + 5, 16, p.second, sel ? PAPER : INK, LEFT, A, 0.04f);
          px += pw + 6;
        }
      }
      y += m + 9;
    }
  };

  if (page != "home") R.rect(0, 0, (float)R.W, (float)R.H, alpha_(PAPER, 0.88f));       // the wash: the race is still there, in the dark

  if (page == "home") { drawHub(R, k, clock); return; }
  if (page == "career") { drawCareer(R, k, clock); return; }
  if (page == "events") { drawEvents(R, k, clock); return; }
  if (page == "story") { drawStory(R, k, clock); return; }
  if (page == "debrief") { drawDebrief(R, k, clock); return; }

  if (page == "setup") {
    const auto L = circuits();
    const int nL = (int)L.size();
    const std::string cid = circuitId(), mapId = S.xOn ? xTrackKey() : S.track;
    int i = 0;
    for (int q = 0; q < nL; q++) if (L[(size_t)q].id == cid) i = q;
    const float tw = title("RACE SETUP");
    {
      const std::string small = S.xOn ? "XINGUS" : gt() ? "THREE CLASSES - ONE ROAD" : team ? upper(team->name) : "NO TEAM",
                        big = S.xOn ? xstyle(S.xStyle).line : upper(carSpec(seatCar()).full);
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
      hot(24, y, w, h, 0, [] {});
      hot(36, y + 32, 50, 50, 0, [this] { at = 0; input(Nav::Left); });
      hot(W - 24 - 12 - 50, y + 32, 50, 50, 0, [this] { at = 0; input(Nav::Right); });
      arrow(36, "<");
      R.hudRot((102 + 23) * k, (y + 57) * k, -7);
      R.circle((102 + 23) * k, (y + 57) * k, 23 * k, INK); R.circle((102 + 23) * k, (y + 57) * k, 20.5f * k, YELL);
      char no[8];
      std::snprintf(no, sizeof no, "%02d", i + 1);
      text(102 + 23, y + 46, 20, no, hex("#121212"), CENTRE, A);
      R.hudRot(0, 0, 0);
      drawMap(R, k, 164, y + 9, 170, 96, mapId, true, clock);
      if (cid == "heiligen") hot(164, y + 9, 170, 96, 0, [this] { show("heiligen"); });
      const Outline &o = outline(mapId);
      char km[32];
      std::snprintf(km, sizeof km, " - %.3f KM", o.len / 1000);
      text(350, y + 22, 10, L[(size_t)i].tag + (o.ok ? km : "") + (cid == "heiligen" ? "  -  ENTER: CHOOSE THE ROUTE" : ""), SOFT, LEFT, RB, 0.16f);
      text(350, y + 38, 44, upper(L[(size_t)i].name), INK, LEFT, A, 0.02f);
      const float dx = W - 24 - 12 - 50 - 16 - (float)nL * 11;
      for (int q = 0; q < nL; q++) R.circle((dx + q * 11 + 3.5f) * k, (y + 57) * k, (q == i ? 5.25f : 3.5f) * k, q == i ? RED : mix(INK, CARD, 0.22f));
      arrow(W - 24 - 12 - 50, ">");
    }
    const auto rows = setupRows();
    optGrid(rows, 92 + 114 + 14, H - 22 - 50 - 14, 1);
    foot(!noTeam() && S.teams[S.car].empty() ? "PICK A TEAM" : "LIGHTS OUT", "UP / DOWN MOVE  -  LEFT / RIGHT CHANGE  -  G = LIGHTS OUT", at == 1 + (int)rows.size());
    return;
  }

  if (page == "heiligen") {
    title("HEILIGEN AUTO CIRCUIT");
    sayBox(W - 24 - std::min(520.0f, width(17, sayText, MK) + 30), 30);
    const auto rows = heilRows();
    const float y0 = 92, yRows = H - 22 - 50 - 14 - 190, mh = yRows - y0 - 10, mw = W - 48 - 300;
    R.card(24 * k, y0 * k, mw * k, mh * k, 12 * k, 2.5f * k, CARD, INK);
    const Json &segs = hmap["segs"], &routes = hmap["routes"];
    const Json *route = nullptr;
    for (size_t q = 0; q < routes.size(); q++) if (routes[q]["key"].s("") == S.xHeil) route = &routes[q];
    if (!route && routes.size()) route = &routes[(size_t)0];
    if (segs.isObj() && route) {
      std::set<std::string> on;
      for (size_t q = 0; q < (*route)["segs"].size(); q++) on.insert((*route)["segs"][q].s(""));
      if (heilChoice(S.xHeil).end == "wall") on.insert("joker");
      float x0 = 1e30f, y0m = 1e30f, x1 = -1e30f, y1 = -1e30f;
      for (const auto &kv : segs.obj) for (size_t q = 0; q < kv.second["pts"].size(); q++) {
        const float x = (float)kv.second["pts"][q][(size_t)0].n(), y = (float)-kv.second["pts"][q][(size_t)1].n();
        x0 = std::min(x0, x); x1 = std::max(x1, x); y0m = std::min(y0m, y); y1 = std::max(y1, y);
      }
      const float pad = 230, vw = x1 - x0 + 2 * pad, vh = y1 - y0m + 2 * pad, sc = std::min((mw - 16) / vw, (mh - 16) / vh);
      const float ox = 24 + 8 + ((mw - 16) - vw * sc) / 2 - (x0 - pad) * sc, oy = y0 + 8 + ((mh - 16) - vh * sc) / 2 - (y0m - pad) * sc;
      // black tarmac, brown gravel, blue snow; the chosen route is the thick one
      for (int pass = 0; pass < 2; pass++) for (const auto &kv : segs.obj) {
        const bool sel = on.count(kv.first) > 0;
        if (sel != (pass == 1)) continue;
        const std::string surf = kv.second["surf"].s("tarmac");
        Rgba col = surf == "gravel" ? hex("#b0844a") : surf == "snow" ? hex("#6fa8dc") : INK;
        if (!sel) col = alpha_(col, 0.28f);
        std::vector<float> p;
        for (size_t q = 0; q < kv.second["pts"].size(); q++) { p.push_back((ox + (float)kv.second["pts"][q][(size_t)0].n() * sc) * k); p.push_back((oy + (float)-kv.second["pts"][q][(size_t)1].n() * sc) * k); }
        R.path(p.data(), (int)p.size() / 2, std::max(sel ? 5.0f : 1.5f, (sel ? 34 : 13) * sc) * k, col, false);
        if (sel && kv.first != "hauptstrasse2" && kv.first != "steilwand1" && kv.first != "talstrasse2" && p.size() >= 4) {
          const size_t m = (p.size() / 4) * 2;
          std::string lb = kv.second["label"].s("");
          for (size_t q = lb.find("\xC3\x9F"); q != std::string::npos; q = lb.find("\xC3\x9F")) lb.replace(q, 2, "ss");
          text(p[m] / k + 10, p[m + 1] / k - 18, 11, upper(lb), INK, LEFT, A, 0.06f);
        }
      }
      R.circle((ox) * k, (oy) * k, 7 * k, INK); R.circle(ox * k, oy * k, 5 * k, RED);
      text(ox - 16, oy + 12, 11, "START", RED, LEFT, A, 0.06f);
      // the route, said beside the map
      const float cx = 24 + mw + 12, cw2 = W - 24 - cx;
      R.card(cx * k, y0 * k, cw2 * k, mh * k, 12 * k, 2.5f * k, CARD, INK);
      text(cx + 14, y0 + 12, 10, "THE ROUTE", SOFT, LEFT, RB, 0.18f);
      std::string rn = (*route)["name"].s("");
      if (rn.rfind("Heiligen ", 0) == 0) rn = rn.substr(9);
      text(cx + 14, y0 + 28, 34, upper(rn), INK, LEFT, A, 0.02f);
      char ln[96];
      const int jumps = (int)(*route)["jumps"].n();
      std::snprintf(ln, sizeof ln, "%.2f KM - %d CORNERS - %d JUMP%s", (*route)["km"].n(), (int)(*route)["corners"].n(), jumps, jumps == 1 ? "" : "S");
      text(cx + 14, y0 + 72, 11, ln, INK, LEFT, RB, 0.12f);
      std::string tag;
      for (unsigned char ch : (*route)["tag"].s("")) tag += ch < 128 ? (char)ch : ch == 0xC2 ? '-' : '\0';
      tag.erase(std::remove(tag.begin(), tag.end(), '\0'), tag.end());
      text(cx + 14, y0 + 90, 11, tag, SOFT, LEFT, RB, 0.12f);
      text(cx + 14, y0 + 116, 10, "BLACK TARMAC - BROWN GRAVEL", SOFT, LEFT, RB, 0.12f);
      text(cx + 14, y0 + 131, 10, "BLUE SNOW", SOFT, LEFT, RB, 0.12f);
    } else text(40, y0 + 20, 17, "the map did not load.", INK, LEFT, MK);
    optGrid(rows, yRows, H - 22 - 50 - 14, 0);
    foot("DONE", "LEFT / RIGHT IN A BOX  -  ESC BACK", at == (int)rows.size());
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
        { const std::string lk = LEAGUE_KEYS[q]; hot(x, y + 6, tw3[q], 46, 0, [this, lk] { if (S.car != lk) { S.car = lk; garageAt = -1; dirty = true; show("garage", 0); say(sayFor("CAR", lk)); } }); }
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
      hot(x, cy - 32, 64, 64, 1, [this] { at = 1; input(Nav::Left); });
      arrow(x, "<"); x += 64 + 18;
      hot(x, cy - 113, 188, 226, 1, [this] { at = 1; input(Nav::Left); });
      side(keys[(size_t)((i - 1 + n) % n)], x); x += 188 + gap;
      {
        const std::string kk = keys[(size_t)i];
        const Team *t = teamByKey(kk);
        const float y = cy - mh / 2;
        R.rrect(x * k, (y + 7) * k, mw * k, mh * k, 12 * k, RED);
        R.card(x * k, y * k, mw * k, mh * k, 12 * k, 3 * k, CARD, INK);
        hot(x, y, mw, mh, 1);
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
      hot(x, cy - 113, 188, 226, 1, [this] { at = 1; input(Nav::Right); });
      side(keys[(size_t)((i + 1) % n)], x); x += 188 + 18;
      hot(x, cy - 32, 64, 64, 1, [this] { at = 1; input(Nav::Right); });
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
