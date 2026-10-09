// career.cpp — see career.hpp. The data is data/career/*.json; this file is the
// rules: what is open, what an event needs, and what a result was worth.
#include "career.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "race.hpp"

namespace xbr {

static std::string upperOf(std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; }
static Objective objOf(const Json &j) {
  Objective o;
  o.kind = j["kind"].s("finish"); o.who = j["who"].s(""); o.n = (int)j["n"].n(); o.secs = j["secs"].n();
  return o;
}
static Rival rivalOf(const Json &j) {
  Rival r;
  r.key = j["key"].s(""); r.name = j["name"].s(""); r.full = j["full"].s(""); r.col = j["col"].s("#ffffff"); r.line = j["line"].s("");
  r.num = (int)j["num"].n(); r.agg = j["agg"].n(0.7); r.def = j["def"].n(0.7); r.err = j["err"].n(1);
  for (size_t i = 0; i < 3; i++) r.sk[i] = j["sk"][i].n(1);
  return r;
}
static EventDef eventOf(const Json &j) {
  EventDef e;
  e.key = j["key"].s(""); e.kind = j["kind"].s(e.key); e.title = j["title"].s(j["name"].s("")); e.tier = j["tier"].s("menu");
  e.time = j["time"].s(""); e.weather = j["weather"].s(""); e.who = j["who"].s(""); e.line = j["line"].s(""); e.reward = j["reward"].s("");
  e.lock = j["lock"].s("");
  e.laps = (int)j["laps"].n(3); e.grid = (int)j["grid"].n(); e.start = (int)j["start"].n(); e.noDnf = j["noDnf"].truthy(); e.fog = j["fog"].n();
  e.obj = objOf(j["obj"]);
  for (size_t i = 0; i < j["tracks"].size(); i++) {
    std::string t = j["tracks"][i].s("");
    int laps = 0;
    const size_t c = t.find(':');
    if (c != std::string::npos) { laps = std::atoi(t.c_str() + c + 1); t = t.substr(0, c); }
    if (!t.empty()) e.tracks.push_back({t, laps});
  }
  return e;
}

void Career::load(const std::string &dir) {
  dataDir = dir;
  const Json j = Json::loadOpt(dir + "/career/career.json");
  for (size_t i = 0; i < j["cast"].size(); i++) cast.push_back(rivalOf(j["cast"][i]));
  ghost = rivalOf(j["ghost"]);
  for (size_t i = 0; i < j["paints"].size(); i++) { const Json &p = j["paints"][i]; paints.push_back({p["key"].s(""), p["name"].s(""), p["col"].s("#b9b4a8"), p["line"].s("")}); }
  if (paints.empty()) paints.push_back({"primer", "PRIMER GREY", "#b9b4a8", ""});
  for (size_t i = 0; i < j["points"].size(); i++) points.push_back((int)j["points"][i].n());
  for (size_t s = 0; s < j["seasons"].size(); s++) {
    const Json &q = j["seasons"][s];
    SeasonDef d;
    d.key = q["key"].s(""); d.name = q["name"].s(""); d.car = q["car"].s("f4"); d.tag = q["tag"].s(""); d.team = q["team"].s("");
    d.blurb = q["blurb"].s(""); d.promote = (int)q["promote"].n(99);
    int round = 0;
    for (size_t i = 0; i < q["events"].size(); i++) {
      EventDef e = eventOf(q["events"][i]);
      e.season = (int)s; e.index = (int)i;
      if (e.kind == "round") e.round = ++round;
      d.events.push_back(e);
    }
    seasons.push_back(d);
  }
  for (size_t i = 0; i < j["modes"].size(); i++) { EventDef e = eventOf(j["modes"][i]); e.index = (int)i; modes.push_back(e); }
  const Json s = Json::loadOpt(dir + "/career/story.json");
  for (size_t i = 0; i < s["cards"].size(); i++) {
    const Json &c = s["cards"][i];
    Card k{c["at"].s(""), c["if"].s(""), c["who"].s(""), {}};
    for (size_t q = 0; q < c["lines"].size(); q++) k.lines.push_back(c["lines"][q].s(""));
    cards.push_back(k);
  }
  for (const auto &kv : s["people"].obj) people[kv.first] = {kv.second["col"].s("#f2e9d8"), kv.second["tag"].s(kv.first), kv.second["sub"].s("")};
  const Json t = Json::loadOpt(dir + "/career/ticker.json");
  for (size_t i = 0; i < t["lines"].size(); i++) ticker.push_back(t["lines"][i].s(""));
  if (ticker.empty()) ticker.push_back("racing for all");
  laps = Json::loadOpt(dir + "/career/laps.json");
}

// ---- the save: one thing a line, readable, and forgiving of a line it does not know ------------
void Career::loadState(const std::string &path, bool writable) {
  savePath = writable ? path : "";
  std::ifstream f(path);
  std::string line;
  while (std::getline(f, line)) {
    std::istringstream in(line);
    std::string k;
    in >> k;
    if (k == "paint") in >> paint;
    else if (k == "model") in >> model;
    else if (k == "own") { std::string p; while (in >> p) if (!owns(p)) owned.push_back(p); }
    else if (k == "trophy") { std::string t; std::getline(in >> std::ws, t); if (!t.empty()) trophies.push_back(t); }
    else if (k == "seen") { int c; while (in >> c) if (c >= 0 && c < (int)cards.size()) seenCards.push_back(c); }
    else if (k == "ev") {
      std::string key;
      EvState s;
      int done = 0, met = 0;
      in >> key >> s.tries >> s.pos >> s.n >> s.medal >> s.pts >> done >> met >> s.lap;
      s.done = done != 0; s.met = met != 0;
      if (!key.empty()) { s.table = st[key].table; st[key] = s; }
    } else if (k == "tab") {
      std::string key, kv;
      in >> key;
      while (in >> kv) { const size_t e = kv.rfind('='); if (e != std::string::npos) st[key].table.push_back({kv.substr(0, e), std::atoi(kv.c_str() + e + 1)}); }
    }
  }
  bool ok = false;
  for (const Paint &p : paints) if (p.key == paint) ok = true;
  if (!ok || !owns(paint)) paint = "primer";
}
void Career::saveState() const {
  if (savePath.empty()) return;
  std::ofstream f(savePath);
  f << "v 1\npaint " << paint << "\n";
  if (!model.empty()) f << "model " << model << "\n";
  f << "own";
  for (const auto &p : owned) f << " " << p;
  f << "\n";
  for (const auto &t : trophies) f << "trophy " << t << "\n";
  f << "seen";
  for (int c : seenCards) f << " " << c;
  f << "\n";
  for (const auto &kv : st) {
    const EvState &s = kv.second;
    f << "ev " << kv.first << " " << s.tries << " " << s.pos << " " << s.n << " " << s.medal << " " << s.pts << " " << (s.done ? 1 : 0) << " " << (s.met ? 1 : 0) << " " << s.lap << "\n";
    if (!s.table.empty()) { f << "tab " << kv.first; for (const auto &r : s.table) f << " " << r.first << "=" << r.second; f << "\n"; }
  }
}

// ---- progress -----------------------------------------------------------------------------
const EvState &Career::state(const std::string &key) const {
  static const EvState none;
  const auto it = st.find(key);
  return it == st.end() ? none : it->second;
}
const EventDef *Career::find(const std::string &key) const {
  for (const SeasonDef &s : seasons) for (const EventDef &e : s.events) if (e.key == key) return &e;
  for (const EventDef &e : modes) if (e.key == key) return &e;
  return nullptr;
}
const Rival *Career::rival(const std::string &key) const {
  for (const Rival &r : cast) if (r.key == key) return &r;
  return key == ghost.key ? &ghost : nullptr;
}
bool Career::seasonDone(int s) const {
  if (s < 0 || s >= (int)seasons.size()) return false;
  for (const EventDef &e : seasons[(size_t)s].events) if (!state(e.key).done) return false;
  return true;
}
bool Career::seasonOpen(int s) const {
  if (s <= 0) return s == 0;
  return seasonOpen(s - 1) && seasonDone(s - 1) && place(s - 1) <= seasons[(size_t)s - 1].promote;
}
bool Career::unlocked(const EventDef &e) const {
  if (e.season < 0) return modeOpen(e);
  if (!seasonOpen(e.season)) return false;
  return e.index == 0 || state(seasons[(size_t)e.season].events[(size_t)e.index - 1].key).done;
}
bool Career::modeOpen(const EventDef &m) const { return m.lock.empty() || state(m.lock).done; }
const EventDef *Career::next() const {
  for (const SeasonDef &s : seasons) for (const EventDef &e : s.events) if (!state(e.key).done) return &e;
  return nullptr;
}
int Career::currentSeason() const {
  const EventDef *e = next();
  if (!e) return (int)seasons.size() - 1;
  return seasonOpen(e->season) ? e->season : std::max(0, e->season - 1);
}
std::vector<TableRow> Career::table(int season) const {
  std::vector<TableRow> rows;
  if (season < 0 || season >= (int)seasons.size()) return rows;
  for (const Rival &r : cast) rows.push_back({r.name, r.col, 0, r.num, false});
  rows.push_back({"YOU", paintNow().col, 0, 78, true});
  for (const EventDef &e : seasons[(size_t)season].events) {
    if (e.kind != "round") continue;
    for (const auto &kv : state(e.key).table)
      for (TableRow &r : rows) if (r.name == kv.first) r.pts += kv.second;
  }
  // level on points: the cast keep their order of skill, and you go below a rival you have not beaten yet
  std::stable_sort(rows.begin(), rows.end(), [](const TableRow &a, const TableRow &b) { return a.pts > b.pts; });
  return rows;
}
int Career::place(int season) const {
  const auto rows = table(season);
  for (size_t i = 0; i < rows.size(); i++) if (rows[i].you) return (int)i + 1;
  return 99;
}
std::string Career::trackFor(const EventDef &e, int *lapsOut) const {
  for (const auto &t : e.tracks)
    if (std::filesystem::exists(dataDir + "/tracks/" + t.first + ".json")) { if (lapsOut && t.second > 0) *lapsOut = t.second; return t.first; }
  return "";
}
std::string Career::trackName(const std::string &key) const {
  static std::map<std::string, std::string> cache;
  auto it = cache.find(key);
  if (it != cache.end()) return it->second;
  // only the name is wanted: read the head of the file, not eight megabytes of survey
  std::ifstream f(dataDir + "/tracks/" + key + ".json", std::ios::binary);
  std::string head(600, '\0'), name = upperOf(key);
  f.read(&head[0], (std::streamsize)head.size());
  const size_t a = head.find("\"name\"");
  if (a != std::string::npos) {
    const size_t q0 = head.find('"', head.find(':', a)), q1 = q0 == std::string::npos ? q0 : head.find('"', q0 + 1);
    if (q1 != std::string::npos) name = head.substr(q0 + 1, q1 - q0 - 1);
  }
  std::string clean;
  for (unsigned char c : name) if (c < 128) clean += (char)c;
  return cache[key] = clean;
}
const Paint &Career::paintNow() const {
  for (const Paint &p : paints) if (p.key == paint) return p;
  return paints[0];
}
bool Career::owns(const std::string &k) const { return std::find(owned.begin(), owned.end(), k) != owned.end(); }

static std::string lapText(double s) {
  char b[32];
  std::snprintf(b, sizeof b, "%d:%06.3f", (int)(s / 60), std::fmod(s, 60.0));
  return b;
}
static const char *MEDAL[4] = {"NO MEDAL", "BRONZE", "SILVER", "GOLD"};

bool Career::medalTimes(const std::string &track, const std::string &cls, double ideal, double out[3]) const {
  const Json &m = laps["laps"][track.c_str()][cls.c_str()];
  if (m.isObj()) { out[0] = m["bronze"].n(); out[1] = m["silver"].n(); out[2] = m["gold"].n(); return out[2] > 0; }
  if (ideal > 0) { out[0] = ideal * 1.15; out[1] = ideal * 1.09; out[2] = ideal * 1.06; return true; }   // no reference lap baked: from the ideal line (the spread the baked circuits average)
  out[0] = out[1] = out[2] = 0;
  return false;
}

std::string Career::objText(const EventDef &e, const Launch *Lp) const {
  const Objective &o = e.obj;
  if (o.kind == "top") return o.n <= 1 ? "WIN IT" : e.kind == "elimination" ? "BE ONE OF THE LAST " + std::to_string(o.n) : "FINISH IN THE TOP " + std::to_string(o.n);
  if (o.kind == "beat") { const Rival *r = rival(o.who); return "FINISH AHEAD OF " + (r ? r->name : upperOf(o.who)); }
  if (o.kind == "gain") return "GAIN " + std::to_string(o.n) + " PLACES FROM LAST";
  if (o.kind == "win") return e.kind == "the78" ? "BEAT NUMBER 78" : e.kind == "duel" ? "BEAT CASTELLAN" : "WIN IT";
  if (o.kind == "within") return "FINISH WITHIN " + std::to_string((int)o.secs) + " S OF NUMBER 78";
  if (o.kind == "wrecks") return "WRECK " + std::to_string(o.n) + " OF THEM";
  if (o.kind == "medal") {
    std::string s = std::string("SET A ") + MEDAL[std::max(1, std::min(3, o.n))] + " LAP";
    if (o.n < 3) s += " OR BETTER";
    if (Lp && Lp->medal[std::max(1, std::min(3, o.n)) - 1] > 0) s += " (" + lapText(Lp->medal[std::max(1, std::min(3, o.n)) - 1]) + ")";
    return s;
  }
  return e.kind == "the78" ? "FINISH THE RACE. THAT IS ALL." : "FINISH THE RACE";
}

// ---- the story ------------------------------------------------------------------------------
std::vector<int> Career::pending(const std::string &at, bool met, bool champ) const {
  std::vector<int> out;
  for (size_t i = 0; i < cards.size(); i++) {
    const Card &c = cards[i];
    if (c.at != at || std::find(seenCards.begin(), seenCards.end(), (int)i) != seenCards.end()) continue;
    if ((c.cond == "met" && !met) || (c.cond == "missed" && met) || (c.cond == "champ" && !champ) || (c.cond == "notchamp" && champ)) continue;
    out.push_back((int)i);
  }
  return out;
}
void Career::seen(int c) { if (std::find(seenCards.begin(), seenCards.end(), c) == seenCards.end()) { seenCards.push_back(c); saveState(); } }
std::vector<int> Career::soFar() const { std::vector<int> v = seenCards; std::sort(v.begin(), v.end()); return v; }
bool Career::introSeen() const { return pending("intro", false, false).empty(); }

// ---- an event --------------------------------------------------------------------------------
static unsigned hashOf(const std::string &s) { unsigned h = 2166136261u; for (unsigned char c : s) h = (h ^ c) * 16777619u; return h; }

bool Career::prepare(const EventDef &e, bool career, const std::string &menuTrack, const std::string &menuCar, const std::string &menuTier) {
  clear();
  L.ev = &e; L.career = career; L.kind = e.kind;
  L.season = career ? e.season : menuCar == "f4" ? 0 : menuCar == "gt3" ? 1 : 2;
  L.car = career ? seasons[(size_t)e.season].car : menuCar;
  L.laps = e.laps;
  L.track = e.tracks.empty() ? menuTrack : trackFor(e, &L.laps);
  if (L.track.empty()) return false;
  L.tier = e.tier == "menu" ? menuTier : e.tier;
  L.time = e.time; L.weather = e.weather; L.noDnf = e.noDnf;
  L.seed = 78 + (double)(hashOf(e.key) % 7000) + state(career ? e.key : "mode:" + e.key).tries;
  L.title = e.title;
  const std::string k = e.kind;
  if (k == "hotlap") L.hot = true;
  else if (k == "derby" || k == "rallycross") { L.xingus = true; L.xstyle = k; L.car = "gt3"; }
  else {
    L.custom = true;
    if (k == "duel") { L.grid = 2; L.slot = 2; }
    else if (k == "the78") { L.grid = 2; L.slot = 2; L.haunted = true; L.freePace = true; L.ghost = ghost.name; L.time = "night"; }
    else if (k == "lasttofirst") { L.grid = e.grid > 0 ? e.grid : 22; L.slot = L.grid; }
    else if (k == "elimination") { L.grid = e.grid > 0 ? e.grid : 8; L.laps = L.grid - 1; L.slot = L.grid / 2 + 1; }
    else { L.grid = e.grid > 0 ? e.grid : 12; L.slot = e.start > 0 ? e.start : (int)(L.grid * 0.55 + 0.5); }
    L.slot = std::max(1, std::min(L.grid, L.slot));
  }
  if (career && L.car == "gt3" && !L.xingus) L.model = model;
  L.on = true;
  return true;
}

void Career::fieldUp() const {
  if (!L.on || !L.custom) return;
  const int si = std::max(0, std::min(2, L.season));
  std::vector<const Rival *> who;
  if (L.kind == "duel") who.push_back(rival("juno") ? rival("juno") : &cast[0]);
  else if (L.kind == "the78") who.push_back(&ghost);
  else {
    // the grid is qualifying: the quick ones at the front, give or take a tenth
    std::vector<std::pair<double, const Rival *>> q;
    for (const Rival &r : cast) q.push_back({r.sk[si] + (double)(hashOf(L.ev->key + r.key) % 1000) / 1000.0 * 0.006, &r});
    std::stable_sort(q.begin(), q.end(), [](const auto &a, const auto &b) { return a.first > b.first; });
    for (const auto &p : q) who.push_back(p.second);
  }
  std::vector<DriverProfile> drivers;
  std::vector<Team> teams;
  for (const Rival *r : who) {
    // the ghost is as quick in a quick go as it was the second time you met it
    const double sk = r == &ghost && !L.career ? r->sk[1] : r->sk[si];
    drivers.push_back({r->name, "cx-" + r->key, r->num, r->agg, r->def, r->err, sk});
    Team t;
    t.key = "cx-" + r->key; t.name = r->full; t.col = r->col; t.fg = "#111111"; t.pace = 1;
    teams.push_back(t);
  }
  Team me;
  me.key = "cx-you"; me.name = L.career ? seasons[(size_t)si].team : "TEAM VAN"; me.col = paintNow().col; me.fg = "#111111"; me.pace = 1;
  teams.push_back(me);
  setCustomField(drivers, teams, L.grid - 1 > (int)drivers.size());
}

void Career::started(Race *race) {
  // XBR_CAREERLOG=1: every race-control line of an event on stderr, for checking an event's rules unattended
  if (race && std::getenv("XBR_CAREERLOG")) race->onEvent = [race](const RaceEvent &e) { std::fprintf(stderr, "career: %7.1fs %-8s %s\n", race->time, e.kind.c_str(), e.text.c_str()); };
  if (!race || L.ghost.empty()) return;
  for (Entry &e : race->entries) if (!e.isPlayer && e.name == L.ghost) e.ghost = true;
}

// ELIMINATION, from outside the race. When every running car but the last has
// finished lap k, the last one is out: `retired` (the flag the race itself sets
// on a car that is out) with `atRest` (so the race stops stepping its wreck),
// and the car is lifted off the circuit so nobody drives into a parked one.
std::string Career::tick(Race &race) {
  if (!L.on || L.kind != "elimination" || race.state != RaceState::Green) return "";
  std::vector<Entry *> run;
  for (Entry *e : race.standings) if (!e->retired) run.push_back(e);
  if (run.size() == 1 && run[0]->isPlayer && !run[0]->finished) {
    // everybody else went home (or into a wall): the same three lines the race uses for the last car standing in a derby
    run[0]->finished = true; run[0]->finishTime = race.time; race.state = RaceState::Finish;
    return "LAST ONE RUNNING";
  }
  if (run.size() <= 2) return "";
  Entry *last = run.back();
  for (size_t i = 0; i + 1 < run.size(); i++) if (run[i]->lap < L.elimLap) return "";
  L.elimLap++;
  last->retired = true; last->atRest = true;
  last->car.x += 40000; last->car.y += 40000; last->car.vx = 0.0001; last->car.vy = 0; last->car.r = 0;
  race.log("flag", last->name + " IS ELIMINATED", last, "elim");
  if (last->isPlayer) { wantsEnd = true; return "YOU ARE OUT - P" + std::to_string((int)run.size()); }
  return last->name + " GOES HOME - " + std::to_string((int)run.size() - 1) + " LEFT";
}

std::string Career::lapSet(double best, double ideal) {
  if (!L.on || !L.hot) return "";
  if (L.medal[2] <= 0) medalTimes(L.track, L.car, ideal, L.medal);
  int m = 0;
  for (int i = 0; i < 3; i++) if (L.medal[i] > 0 && best <= L.medal[i]) m = i + 1;
  if (m <= L.lastMedal) return "";
  L.lastMedal = m;
  return std::string(MEDAL[m]) + (m == 3 ? " LAP. THAT IS THE LOT." : " LAP - " + std::string(MEDAL[m + 1]) + " IS " + lapText(L.medal[m]));
}

void Career::reward(const std::string &r, std::vector<std::string> &said) {
  const size_t c = r.find(':');
  if (c == std::string::npos) return;
  const std::string kind = r.substr(0, c), what = r.substr(c + 1);
  if (kind == "paint") {
    if (owns(what)) return;
    owned.push_back(what); paint = what;
    for (const Paint &p : paints) if (p.key == what) said.push_back("NEW PAINT: " + p.name);
  } else if (kind == "model") {
    // only a body that is really on this machine (tools/bakecar.mjs)
    const Json idx = Json::loadOpt(dataDir + "/cars/index.json");
    for (size_t i = 0; i < idx.size(); i++)
      if (idx[i]["key"].s("") == what && model != what) { model = what; said.push_back("NEW CAR FOR YOUR GT3 SEAT: " + upperOf(idx[i]["title"].s(what))); }
  } else if (kind == "trophy") {
    if (std::find(trophies.begin(), trophies.end(), what) == trophies.end()) { trophies.push_back(what); said.push_back("TROPHY: " + what); }
  } else if (kind == "event") {
    for (const EventDef &m : modes) if (m.key == what) said.push_back("NEW IN EVENTS: " + m.title);
  }
}

const Outcome &Career::finish(Race *race, bool hasBest, double best, double ideal) {
  out = Outcome{};
  if (!L.on || !L.ev) return out;
  const EventDef &e = *L.ev;
  const Objective &o = e.obj;
  out.has = true; out.career = L.career; out.key = e.key; out.kind = e.kind; out.title = e.title;
  out.objective = objText(e, &L);
  const std::string sk = L.career ? e.key : "mode:" + e.key;
  EvState &s = st[sk];
  const bool wasDone = s.done, wasMet = s.met;
  const bool seasonWasOpen = L.career && e.season + 1 < (int)seasons.size() && seasonOpen(e.season + 1);
  s.tries++;
  std::vector<std::pair<std::string, int>> tab;
  if (L.hot) {
    if (L.medal[2] <= 0) medalTimes(L.track, L.car, ideal, L.medal);
    out.valid = hasBest; out.lap = hasBest ? best : 0;
    for (int i = 0; i < 3; i++) out.medalT[i] = L.medal[i];
    if (hasBest) for (int i = 0; i < 3; i++) if (L.medal[i] > 0 && best <= L.medal[i]) out.medal = i + 1;
    out.met = out.medal >= std::max(1, o.n);
    out.detail = hasBest ? "BEST LAP " + lapText(best) + "  -  " + MEDAL[out.medal] : "NO TIMED LAP";
    if (out.medal < 3 && L.medal[out.medal] > 0) out.detail += std::string("  -  ") + MEDAL[out.medal + 1] + " IS " + lapText(L.medal[out.medal]);
    if (out.medal > 0) s.done = true;
  } else if (race && race->me) {
    const Entry &me = *race->me;
    const bool elim = e.kind == "elimination", derby = e.kind == "derby";
    out.n = (int)race->entries.size(); out.pos = me.pos;
    out.valid = !me.retired || elim || derby;
    out.gained = L.slot - me.pos;
    const Entry *them = nullptr;
    const Rival *rv = o.kind == "beat" ? rival(o.who) : nullptr;
    for (const Entry &x : race->entries) {
      if (x.isPlayer) continue;
      if (rv && x.name == rv->name) them = &x;
      if (!rv && out.n == 2) them = &x;
    }
    if (o.kind == "top") out.met = out.valid && out.pos <= std::max(1, o.n);
    else if (o.kind == "beat") out.met = out.valid && !me.retired && (!them || them->retired || them->pos > me.pos);
    else if (o.kind == "gain") out.met = out.valid && out.gained >= o.n;
    else if (o.kind == "win") out.met = out.valid && out.pos == 1;
    else if (o.kind == "within") out.met = out.valid && (out.pos == 1 || (me.finished && them && them->finished && me.finishTime - them->finishTime <= o.secs));
    else if (o.kind == "wrecks") out.met = me.wrecks >= o.n;
    else out.met = out.valid;
    char b[160];
    if (!out.valid) std::snprintf(b, sizeof b, "YOU DID NOT MAKE THE FINISH");
    else if (o.kind == "wrecks") std::snprintf(b, sizeof b, "%d WRECKED BY YOU%s", me.wrecks, me.retired ? "  -  THEN SOMEBODY WRECKED YOU" : "");
    else if (o.kind == "gain") std::snprintf(b, sizeof b, "P%d OF %d  -  %s%d PLACES", out.pos, out.n, out.gained >= 0 ? "+" : "", out.gained);
    else if (o.kind == "within" && me.finished && them && them->finished && out.pos != 1) std::snprintf(b, sizeof b, "P2  -  %.1f S BEHIND NUMBER 78", me.finishTime - them->finishTime);
    else std::snprintf(b, sizeof b, "P%d OF %d", out.pos, out.n);
    out.detail = b;
    if (out.valid) s.done = true;
    if (e.kind == "round" && out.valid) {
      out.pts = out.pos >= 1 && out.pos <= (int)points.size() ? points[(size_t)out.pos - 1] : 0;
      for (size_t i = 0; i < race->standings.size() && i < points.size(); i++) {
        const Entry &x = *race->standings[i];
        if (!x.retired) tab.push_back({x.isPlayer ? "YOU" : x.name, points[i]});
      }
      // the round counts once: your best run of it
      if (s.table.empty() || s.pos == 0 || out.pos < s.pos) { s.table = tab; s.pts = out.pts; }
      out.detail += "  -  +" + std::to_string(out.pts) + " PTS";
    }
    if (out.valid && (s.pos == 0 || out.pos < s.pos)) { s.pos = out.pos; s.n = out.n; }
  }
  if (out.medal > s.medal) s.medal = out.medal;
  if (out.lap > 0 && (s.lap <= 0 || out.lap < s.lap)) s.lap = out.lap;
  if (out.met) s.met = true;
  out.firstDone = s.done && !wasDone;
  out.headline = out.met ? "OBJECTIVE MET" : out.valid ? "OBJECTIVE MISSED" : L.hot ? "NO LAP ON THE BOARD" : "DID NOT FINISH";
  if (L.career) {
    out.champPos = place(e.season);
    if (e.kind == "round" && out.valid) out.detail += "  -  P" + std::to_string(out.champPos) + " IN THE TABLE";
    // what it opened: the lock and the trophy come with finishing, the paint and the car with the objective
    const std::string kind = e.reward.substr(0, e.reward.find(':'));
    if (!e.reward.empty() && ((kind == "paint" || kind == "model") ? (out.met && !wasMet) : out.firstDone)) reward(e.reward, out.unlocked);
    if (out.firstDone && e.index + 1 < (int)seasons[(size_t)e.season].events.size()) {
      const EventDef &nx = seasons[(size_t)e.season].events[(size_t)e.index + 1];
      out.unlocked.push_back("NEXT: " + nx.title);
    }
    if (!seasonWasOpen && e.season + 1 < (int)seasons.size() && seasonOpen(e.season + 1))
      out.unlocked.push_back("SEASON " + std::to_string(e.season + 2) + " IS OPEN: " + seasons[(size_t)e.season + 1].tag);
    else if (seasonDone(e.season) && e.season + 1 < (int)seasons.size() && !seasonOpen(e.season + 1))
      out.unlocked.push_back("THE NEXT SEAT NEEDS THE TOP " + std::to_string(seasons[(size_t)e.season].promote) + " OF THE TABLE. RE-RUN A ROUND.");
  }
  saveState();
  return out;
}

}  // namespace xbr
