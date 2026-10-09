// drivers.cpp — js/drivers.js, ported. The tables below were generated from the
// JS file, not retyped; when a `pace` or a name moves there, regenerate them.
#include "drivers.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>

namespace xbr {

static const std::vector<DriverProfile> kDrivers = {
  {"RUSSELL", "silver", 63, 0.76, 0.82, 0.85, 1.005},
  {"ANTONELLI", "silver", 12, 0.74, 0.6, 1.25, 1.001},
  {"LECLERC", "scarlet", 16, 0.88, 0.74, 1.05, 1.006},
  {"HAMILTON", "scarlet", 44, 0.7, 0.94, 0.8, 1.002},
  {"NORRIS", "papaya", 1, 0.58, 0.72, 1.0, 1.006},
  {"PIASTRI", "papaya", 81, 0.72, 0.82, 0.8, 1.004},
  {"VERSTAPPEN", "navy", 3, 0.97, 0.96, 0.75, 1.01},
  {"HADJAR", "navy", 6, 0.72, 0.66, 1.15, 0.999},
  {"BEARMAN", "graphite", 87, 0.76, 0.62, 1.2, 1.0},
  {"OCON", "graphite", 31, 0.74, 0.88, 1.0, 0.999},
  {"GASLY", "rose", 10, 0.79, 0.8, 1.0, 1.003},
  {"COLAPINTO", "rose", 43, 0.84, 0.58, 1.35, 0.995},
  {"LAWSON", "cobalt", 30, 0.8, 0.64, 1.2, 0.997},
  {"LINDBLAD", "cobalt", 41, 0.78, 0.58, 1.35, 0.996},
  {"HULKENBERG", "titan", 27, 0.66, 0.86, 0.85, 1.001},
  {"BORTOLETO", "titan", 5, 0.7, 0.6, 1.25, 0.999},
  {"SAINZ", "azure", 55, 0.78, 0.86, 0.85, 1.003},
  {"ALBON", "azure", 23, 0.64, 0.84, 0.9, 1.001},
  {"ALONSO", "emerald", 14, 0.82, 0.99, 0.7, 1.004},
  {"STROLL", "emerald", 18, 0.55, 0.7, 1.2, 0.995},
  {"PEREZ", "ivory", 11, 0.72, 0.92, 1.0, 0.999},
  {"BOTTAS", "ivory", 77, 0.62, 0.8, 0.9, 0.999},
};
static const std::vector<DriverProfile> kFantasy = {
  {"DELACROIX", "bugatti", 9, 0.7, 0.84, 0.85, 1.004},
  {"FONTAINE", "bugatti", 29, 0.62, 0.7, 1.05, 1.0},
  {"TAKEDA", "mazda", 86, 0.72, 0.8, 0.85, 1.004},
  {"MORIMOTO", "mazda", 17, 0.6, 0.66, 1.0, 0.999},
  {"DALTON", "jeep", 4, 0.95, 0.9, 1.4, 1.002},
  {"REYES", "jeep", 99, 0.82, 0.64, 1.25, 0.998},
  {"HALONEN", "subaru", 22, 0.8, 0.7, 1.0, 1.002},
  {"AALTO", "subaru", 28, 0.74, 0.76, 1.05, 1.0},
  {"VOGEL", "bmwm", 13, 0.72, 0.92, 0.85, 1.003},
  {"HARTMANN", "bmwm", 24, 0.68, 0.74, 1.0, 1.0},
};
static const StyleRow kStyle[] = {
  {"VERSTAPPEN", 0.95, 0.0, 0.95},
  {"ALONSO", 0.9, 0.05, 1.0},
  {"HAMILTON", 0.55, 0.25, 0.85},
  {"LECLERC", 0.85, 0.15, 0.75},
  {"RUSSELL", 0.7, 0.3, 0.6},
  {"ANTONELLI", 0.9, 0.15, 0.55},
  {"NORRIS", 0.4, 0.55, 0.6},
  {"PIASTRI", 0.5, 0.35, 0.75},
  {"HADJAR", 0.85, 0.15, 0.5},
  {"BEARMAN", 0.75, 0.25, 0.55},
  {"OCON", 0.7, 0.05, 0.85},
  {"GASLY", 0.6, 0.3, 0.65},
  {"COLAPINTO", 0.95, 0.05, 0.45},
  {"LAWSON", 0.85, 0.05, 0.7},
  {"LINDBLAD", 0.9, 0.15, 0.4},
  {"HULKENBERG", 0.45, 0.5, 0.65},
  {"BORTOLETO", 0.6, 0.4, 0.5},
  {"SAINZ", 0.7, 0.25, 0.85},
  {"ALBON", 0.45, 0.5, 0.75},
  {"STROLL", 0.2, 0.9, 0.3},
  {"PEREZ", 0.65, 0.3, 0.8},
  {"BOTTAS", 0.3, 0.85, 0.4},
};
struct BaseTeam { const char *key, *name, *col; double pace; const char *fg, *era; const char *sp[4]; };
static const BaseTeam kBase[] = {
  {"silver", "MERCEDES", "#27f4d2", 1.000, "#0b0d10", "", {"HALDANE", "NOVACORE", "CHRONA", "BITWAVE"}},
  {"scarlet", "FERRARI", "#e8002d", 0.993, "#ffffff", "", {"VELOCITA", "RUSH", "ARGENT", "SKYLARK"}},
  {"papaya", "MCLAREN", "#ff8000", 0.990, "#101014", "", {"VROOM", "GRIPMAX", "NORTHWAY", "CARGOLINE"}},
  {"navy", "RED BULL", "#1e41ff", 0.984, "#ffffff", "", {"VOLTSURGE", "KESTREL", "ORBIX", "ATLAS FREIGHT"}},
  {"graphite", "HAAS", "#b6babd", 0.973, "#b5121b", "", {"MOLT", "BRAKEWELL", "SIGNALIS", "CHRONA"}},
  {"rose", "ALPINE", "#ff87bc", 0.971, "#1b4fd8", "", {"NORTHFLOW", "FOGLAST", "HALCYON", "GRIPMAX"}},
  {"cobalt", "RACING BULLS", "#6692ff", 0.968, "#ffffff", "", {"XANBOO78O", "TERMINAL TYCOON", "ZEST", "RUSH"}},
  {"titan", "AUDI", "#5c6166", 0.963, "#e8eaee", "", {"MERIDIAN", "DEEPWALK", "EVERYDEATH", "HALDANE"}},
  {"azure", "WILLIAMS", "#00a0de", 0.960, "#ffffff", "", {"PYRA", "CRITTERS", "NORTHWAY", "BITWAVE"}},
  {"emerald", "ASTON MARTIN", "#229971", 0.951, "#cedc00", "", {"KESTREL", "ARGENT", "SIGNALIS", "SKYLARK"}},
  {"ivory", "CADILLAC", "#e9e9e9", 0.944, "#101014", "", {"CRITTERS", "ORBIX", "CARGOLINE", "NOVACORE"}},
  {"bugatti", "BUGATTI", "#1f5eff", 0.985, "#0a0f1f", "fantasy", {"HALCYON", "ARGENT", "CHRONA", "NOVACORE"}},
  {"mazda", "MAZDA", "#00a651", 0.966, "#ff6f00", "fantasy", {"FOGLAST", "CRITTERS", "DEEPWALK", "ZEST"}},
  {"jeep", "JEEP", "#9aae3c", 0.948, "#1b1d12", "fantasy", {"DEEPWALK", "ATLAS FREIGHT", "NORTHFLOW", "PYRA"}},
  {"subaru", "SUBARU", "#2b5bd7", 0.958, "#f5c400", "fantasy", {"KESTREL", "TERMINAL TYCOON", "BITWAVE", "MERIDIAN"}},
  {"bmwm", "BMW M", "#6bb3e8", 0.975, "#e22718", "fantasy", {"CHRONA", "SIGNALIS", "XANBOO78O", "HALDANE"}},
};
struct OtherTeam { const char *league, *key, *name, *pri, *sec; double pace; std::vector<int> nums; const char *sub; };
static const std::vector<OtherTeam> kOther = {
  {"f1", "lotus", "LOTUS", "#d4af37", "#2f7d3a", 0.978, {11, 12}, "JPS BLACK & GOLD"},
  {"f1", "brabham", "BRABHAM", "#2a62d4", "#e10600", 0.972, {7, 8}, "CLASSIC"},
  {"f1", "tyrrell", "TYRRELL", "#2a5fcf", "#8fc8ff", 0.966, {3, 4}, "CLASSIC"},
  {"f1", "jordan", "JORDAN", "#f8d000", "#1bb04a", 0.968, {32, 33}, "CLASSIC"},
  {"f1", "benetton", "BENETTON", "#1fa3e0", "#3cb043", 0.980, {5, 6}, "CLASSIC"},
  {"f1", "minardi", "MINARDI", "#ffd100", "#1d5bd8", 0.946, {20, 21}, "CLASSIC"},
  {"f1", "brawn", "BRAWN GP", "#cfff1a", "#e8e8e8", 0.990, {22, 23}, "CLASSIC"},
  {"f1", "bar", "BAR", "#e3001b", "#f2f2f2", 0.970, {9, 10}, "CLASSIC"},
  {"f1", "jaguar", "JAGUAR", "#1a7a4c", "#d9d9d9", 0.955, {14, 15}, "CLASSIC"},
  {"f1", "toyota", "TOYOTA", "#eb0a1e", "#f2f2f2", 0.962, {16, 17}, "CLASSIC"},
  {"f1", "leyton", "LEYTON HOUSE", "#19b4b4", "#f2f2f2", 0.952, {15, 16}, "CLASSIC"},
  {"f1", "ligier", "LIGIER", "#1f5eff", "#f2f2f2", 0.958, {25, 26}, "CLASSIC"},
  {"gt3", "wrt", "TEAM WRT", "#ffe600", "#1c69d4", 0.995, {46, 32}, "BMW M4 GT3"},
  {"gt3", "manthey", "MANTHEY", "#1faa4b", "#ffd200", 0.996, {91, 911}, "PORSCHE 911 GT3 R"},
  {"gt3", "afcorse", "AF CORSE", "#d40000", "#ffd600", 0.993, {51, 71}, "FERRARI 296 GT3"},
  {"gt3", "emilfrey", "EMIL FREY", "#f3c300", "#d40000", 0.990, {14, 69}, "FERRARI 296 GT3"},
  {"gt3", "irondames", "IRON DAMES", "#ff4fa3", "#ffc2e0", 0.984, {83, 85}, "PORSCHE 911 GT3 R"},
  {"gt3", "ironlynx", "IRON LYNX", "#d6152f", "#9aa0a6", 0.986, {60, 63}, "LAMBORGHINI HURACAN GT3"},
  {"gt3", "garage59", "GARAGE 59", "#ff7a00", "#1f4fbf", 0.989, {58, 59}, "MCLAREN 720S GT3"},
  {"gt3", "akkodis", "AKKODIS ASP", "#1d63ff", "#9ad1ff", 0.991, {87, 88}, "MERCEDES-AMG GT3"},
  {"gt3", "getspeed", "GETSPEED", "#00b5e2", "#f2f2f2", 0.988, {2, 3}, "MERCEDES-AMG GT3"},
  {"gt3", "mannfilter", "MANN-FILTER", "#009f3c", "#ffe100", 0.992, {48, 4}, "MERCEDES-AMG GT3"},
  {"gt3", "boutsen", "BOUTSEN VDS", "#2e5bd6", "#e10600", 0.985, {9, 10}, "MERCEDES-AMG GT3"},
  {"gt3", "attempto", "TRESOR ATTEMPTO", "#ff6b00", "#cfcfcf", 0.983, {99, 66}, "AUDI R8 LMS GT3"},
  {"gt3", "comtoyou", "COMTOYOU", "#00665e", "#c8e600", 0.982, {7, 11}, "ASTON MARTIN VANTAGE GT3"},
  {"gt3", "rowe", "ROWE RACING", "#2754c5", "#f5c400", 0.991, {98, 998}, "BMW M4 GT3"},
  {"gt3", "rutronik", "RUTRONIK", "#e2001a", "#cfcfcf", 0.987, {96, 97}, "PORSCHE 911 GT3 R"},
  {"gt3", "grasser", "GRT GRASSER", "#95c11f", "#f2f2f2", 0.981, {19, 63}, "LAMBORGHINI HURACAN GT3"},
  {"gt3", "corvette", "CORVETTE RACING", "#ffd100", "#c8c8c8", 0.990, {3, 4}, "CORVETTE Z06 GT3.R"},
  {"gt3", "multimatic", "FORD MULTIMATIC", "#1f4fbf", "#e21b23", 0.986, {64, 65}, "FORD MUSTANG GT3"},
  {"gt3", "vasser", "VASSER SULLIVAN", "#ff5a00", "#d0d0d0", 0.984, {12, 14}, "LEXUS RC F GT3"},
  {"gt3", "proton", "PROTON", "#0b5fff", "#f2f2f2", 0.980, {77, 88}, "PORSCHE 911 GT3 R"},
  {"f4", "prema", "PREMA", "#e2001a", "#ffd1d6", 0.995, {2, 3, 4}, "ITALIAN F4"},
  {"f4", "var", "VAN AMERSFOORT", "#ff6a00", "#1d5bd8", 0.993, {5, 6, 7}, "ITALIAN F4"},
  {"f4", "usracing", "US RACING", "#1a3dff", "#e3001b", 0.992, {8, 9, 10}, "ITALIAN F4"},
  {"f4", "race", "R-ACE GP", "#1f63c9", "#ff3b3b", 0.990, {11, 12}, "ITALIAN F4"},
  {"f4", "mumbai", "MUMBAI FALCONS", "#f39200", "#1a4fa0", 0.988, {14, 15}, "ITALIAN F4"},
  {"f4", "jenzer", "JENZER", "#ffcc00", "#8a8f94", 0.984, {16, 17}, "ITALIAN F4"},
  {"f4", "hitech", "HITECH", "#e10600", "#cfcfcf", 0.991, {21, 22}, "BRITISH F4"},
  {"f4", "rodin", "RODIN", "#00c2a8", "#f2f2f2", 0.989, {23, 24}, "BRITISH F4"},
  {"f4", "carlin", "CARLIN", "#1c3faa", "#ff4d00", 0.987, {25, 26}, "BRITISH F4"},
  {"f4", "jhr", "JHR", "#2b56d6", "#f5c400", 0.985, {27, 28}, "BRITISH F4"},
  {"f4", "mp", "MP MOTORSPORT", "#ff6200", "#6aa9ff", 0.990, {31, 32}, "SPANISH F4"},
  {"f4", "campos", "CAMPOS", "#e3001b", "#ffc400", 0.988, {33, 34}, "SPANISH F4"},
  {"f4", "motopark", "MOTOPARK", "#1f5fbf", "#f2f2f2", 0.986, {35, 36}, "SPANISH F4"},
  {"f4", "phm", "PHM RACING", "#d3ff00", "#9aa0a6", 0.983, {37, 38}, "SPANISH F4"},
};
static const char *kPool[] = {"HALDANE", "NOVACORE", "CHRONA", "BITWAVE", "VELOCITA", "RUSH", "ARGENT", "SKYLARK", "VROOM", "GRIPMAX", "NORTHWAY", "CARGOLINE", "VOLTSURGE", "KESTREL", "ORBIX", "ATLAS FREIGHT", "MOLT", "BRAKEWELL", "SIGNALIS", "NORTHFLOW", "FOGLAST", "HALCYON", "ZEST", "MERIDIAN", "PYRA"};
struct UiRow { const char *key, *pri, *sec; };
static const UiRow kUi[] = {
  {"silver", "#27f4d2", "#c0c6cc"},
  {"scarlet", "#e8002d", "#ffd400"},
  {"papaya", "#ff8000", "#47c7fc"},
  {"navy", "#3a5bff", "#ff1e2d"},
  {"graphite", "#d8dadc", "#e10600"},
  {"rose", "#ff87bc", "#3a6cff"},
  {"cobalt", "#6692ff", "#ff2d55"},
  {"titan", "#c9ccd1", "#f50537"},
  {"azure", "#00a0de", "#ffd000"},
  {"emerald", "#229971", "#cedc00"},
  {"ivory", "#ececec", "#c9a449"},
  {"bugatti", "#1f5eff", "#8fb4ff"},
  {"mazda", "#00a651", "#ff6f00"},
  {"jeep", "#9aae3c", "#e0a84a"},
  {"subaru", "#3a6bf0", "#f5c400"},
  {"bmwm", "#6bb3e8", "#e22718"},
};

static int hex2(const std::string &hex, size_t i) { return (int)std::strtol(hex.substr(i, 2).c_str(), nullptr, 16); }
static std::string inkFor(const std::string &hex) {
  const int r = hex2(hex, 1), g = hex2(hex, 3), b = hex2(hex, 5);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#101014" : "#ffffff";
}

namespace {
struct Tables {
  std::vector<Team> teams;
  std::vector<DriverProfile> classic, gt3, f4;
  Tables() {
    teams.reserve(80);
    for (const auto &b : kBase) {
      Team t;
      t.key = b.key; t.name = b.name; t.col = b.col; t.fg = b.fg; t.pace = b.pace; t.era = b.era;
      for (const char *s : b.sp) t.sp.push_back(s);
      teams.push_back(t);
    }
    // THE OTHER LEAGUES, and F1's old teams: one line a team.
    std::map<std::string, int> row;
    for (const auto &o : kOther) {
      const std::string league = o.league;
      const int i = row[league]++;
      Team t;
      t.key = o.key; t.name = o.name; t.col = o.pri; t.fg = inkFor(o.pri); t.pace = o.pace; t.sub = o.sub;
      t.league = league; t.ui[0] = o.pri; t.ui[1] = o.sec;
      t.era = league == "f1" ? "classic" : "";
      for (int k = 0; k < 4; k++) t.sp.push_back(kPool[(i * 7 + k * 5 + (int)league.size()) % 25]);
      teams.push_back(t);
      std::vector<DriverProfile> &L = league == "f1" ? classic : league == "gt3" ? gt3 : f4;
      for (int num : o.nums) {
        DriverProfile d;
        d.n = t.name + " #" + std::to_string(num); d.t = t.key; d.num = num;
        d.agg = 0.72; d.def = 0.74; d.err = 1.0; d.sk = 1.0;
        L.push_back(d);
      }
    }
    for (const auto &u : kUi)
      for (auto &t : teams)
        if (t.key == u.key) {
          t.ui[0] = u.pri; t.ui[1] = u.sec; t.league = "f1";
          if (t.era.empty()) t.era = "2026";
        }
  }
};
const Tables &tables() { static const Tables T; return T; }

using List = std::vector<const DriverProfile *>;
List ptrs(const std::vector<DriverProfile> &v) { List o; for (const auto &d : v) o.push_back(&d); return o; }

// Mixed tables go a team at a time (a Map keyed by team, insertion order).
std::vector<List> byTeam(const List &list) {
  std::vector<std::string> keys;
  std::vector<List> groups;
  for (const DriverProfile *d : list) {
    size_t k = 0;
    while (k < keys.size() && keys[k] != d->t) k++;
    if (k == keys.size()) { keys.push_back(d->t); groups.emplace_back(); }
    groups[k].push_back(d);
  }
  return groups;
}
List interleave(const std::vector<List> &lists) {
  std::vector<std::vector<List>> groups;
  size_t most = 0;
  for (const auto &l : lists) { groups.push_back(byTeam(l)); most = std::max(most, groups.back().size()); }
  List out;
  for (size_t i = 0; i < most; i++)
    for (const auto &g : groups)
      if (i < g.size()) out.insert(out.end(), g[i].begin(), g[i].end());
  return out;
}
// One car per team first, then the second cars.
List roundRobin(const List &list) {
  const std::vector<List> groups = byTeam(list);
  size_t most = 0;
  for (const auto &g : groups) most = std::max(most, g.size());
  List out;
  for (size_t r = 0; r < most; r++)
    for (const auto &g : groups)
      if (r < g.size()) out.push_back(g[r]);
  return out;
}

struct Roster { List base, active; DriverProfile spare; };
Roster &roster() {
  static Roster R = [] { Roster r; r.base = r.active = ptrs(kDrivers); return r; }();
  return R;
}
}  // namespace

const std::vector<Team> &allTeams() { return tables().teams; }
// the career's own field (setCustomField): empty until the game hands one over
struct Custom { std::vector<DriverProfile> drivers; std::vector<Team> teams; };
static Custom &custom() { static Custom C; return C; }
const Team *teamByKey(const std::string &key) {
  for (const auto &t : tables().teams) if (t.key == key) return &t;
  for (const auto &t : custom().teams) if (t.key == key) return &t;
  return nullptr;
}
std::vector<std::string> teamsIn(const std::string &league) {
  std::vector<std::string> out;
  for (const auto &t : tables().teams) if (t.league == league) out.push_back(t.key);
  return out;
}
const std::vector<DriverProfile> &DRIVERS() { return kDrivers; }
const std::vector<DriverProfile> &FANTASY_DRIVERS() { return kFantasy; }
const std::vector<DriverProfile> &leagueDrivers(const std::string &league) {
  const Tables &T = tables();
  return league == "gt3" ? T.gt3 : league == "f4" ? T.f4 : T.classic;
}
const StyleRow *styleOf(const std::string &name) {
  for (const auto &s : kStyle) if (name == s.n) return &s;
  return nullptr;
}

void setField(const std::string &kind) {
  const Tables &T = tables();
  Roster &R = roster();
  R.base = R.active = kind == "classic" ? roundRobin(ptrs(T.classic))
    : kind == "fantasy" ? ptrs(kFantasy)
    : kind == "all" ? interleave({ptrs(kDrivers), roundRobin(ptrs(T.classic)), ptrs(kFantasy)})
    : kind == "gt3" ? roundRobin(ptrs(T.gt3))
    : kind == "f4" ? roundRobin(ptrs(T.f4))
    : ptrs(kDrivers);
}

void setCustomField(const std::vector<DriverProfile> &drivers, const std::vector<Team> &teams, bool fill) {
  Custom &C = custom();
  Roster &R = roster();
  C.drivers = drivers; C.teams = teams;
  List L = ptrs(C.drivers);
  if (fill) L.insert(L.end(), R.base.begin(), R.base.end());
  if (!L.empty()) R.active = L;        // base is left alone: the next setField / setPlayerTeam starts from it as always
}

std::vector<const DriverProfile *> driversOf(const std::string &key) {
  const Tables &T = tables();
  List out;
  for (const auto *src : {&kDrivers, &kFantasy, &T.classic, &T.gt3, &T.f4})
    for (const auto &d : *src) if (d.t == key) out.push_back(&d);
  return out;
}

// YOUR SEAT, AND YOUR TEAMMATE: your team's second driver stands down; if your
// team is not on this grid Alpine makes way and your team's lead driver comes in.
const DriverProfile *setPlayerTeam(const std::string &key, int n) {
  Roster &R = roster();
  R.active = R.base;
  if (key.empty() || !teamByKey(key)) return nullptr;
  List list = R.base;
  const DriverProfile *mate = nullptr;
  List mine;
  for (const auto *d : list) if (d->t == key) mine.push_back(d);
  if (!mine.empty()) {
    mate = mine[0];
    if (mine.size() > 1) {
      for (size_t k = list.size(); k-- > 0;)
        if (list[k] == mine.back()) { list.erase(list.begin() + (long)k); break; }
    }
  } else {
    const List of = driversOf(key);
    if (!of.empty()) mate = of[0];
    else {
      R.spare = DriverProfile{"TEAMMATE", key, 2, 0.70, 0.75, 1.0, 1.0};
      mate = &R.spare;
    }
    long at = -1;
    for (size_t k = 0; k < list.size(); k++) if (list[k]->t == "rose") { at = (long)k; break; }
    if (at >= 0) {
      list.erase(std::remove_if(list.begin(), list.end(), [](const DriverProfile *d) { return d->t == "rose"; }), list.end());
      list.insert(list.begin() + std::min(at, (long)list.size()), mate);
    } else list.insert(list.begin() + std::min((long)list.size(), std::max(0L, (long)n - 2)), mate);
  }
  // A short grid takes the first n-1 of the roster: the teammate is on it.
  long mi = -1;
  for (size_t k = 0; k < list.size(); k++) if (list[k] == mate) { mi = (long)k; break; }
  if (mi > n - 2) {
    list.erase(list.begin() + mi);
    list.insert(list.begin() + std::min((long)list.size(), std::max(0L, (long)n - 2)), mate);
  }
  R.active = list;
  return mate;
}

const DriverProfile &driverAt(int i) {
  const List &A = roster().active;
  const int n = (int)A.size();
  return *A[(size_t)(((i % n) + n) % n)];
}

const Team &teamOf(const DriverProfile &d) {
  const Team *t = teamByKey(d.t);
  return t ? *t : *teamByKey("ivory");
}

static std::string mix(const std::string &a, const std::string &b, double t) {
  std::string out = "#";
  for (size_t i : {1, 3, 5}) {
    char buf[8];
    std::snprintf(buf, sizeof buf, "%02x", (int)jsRound(hex2(a, i) * (1 - t) + hex2(b, i) * t));
    out += buf;
  }
  return out;
}
bool teamUI(const std::string &key, std::string out[4]) {
  const Team *t = teamByKey(key);
  if (!t || t->ui[0].empty()) return false;
  out[0] = mix("#070707", t->ui[0], 0.08); out[1] = mix("#f2f2f2", t->ui[0], 0.06);
  out[2] = t->ui[0]; out[3] = t->ui[1];
  return true;
}

Driver &applyProfile(Driver &driver, const DriverProfile &prof, const Team &team) {
  // 0.75 + 0.5p, not 0.5 + p: the car first, the person second.
  driver.aggression = std::min(1.0, driver.aggression * (0.75 + 0.5 * prof.agg));
  driver.defence = std::min(1.0, driver.defence * (0.75 + 0.5 * prof.def));
  // Grip is the car. Kept on the driver too: the OVERTAKES band re-sets grip
  // every half second and must carry it through.
  driver.paceMul = team.pace * prof.sk;
  driver.gripFrac = std::max(0.4, driver.gripFrac * driver.paceMul);
  // Mistakes are a SCHEDULE: scale the rate, and the first interval with it.
  driver.errScale = prof.err;
  if (const StyleRow *s = styleOf(prof.n)) { driver.style.launch = s->launch; driver.style.space = s->space; driver.style.side = s->side; }
  driver.nextMistake /= std::max(0.3, prof.err);
  driver.profile = &prof;
  driver.team = &team;
  return driver;
}

}  // namespace xbr
