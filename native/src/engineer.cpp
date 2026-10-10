// engineer.cpp — see engineer.hpp.
#include "engineer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace xbr {

// ------------------------------------------------------------------ how he says things
// A name as it is said on the radio. The tower may carry "Scuderia Ferrari — Hamilton": he says Hamilton.
static std::string nice(const std::string &full) {
  std::string n = full;
  for (const char *sep : {" \xe2\x80\x94 ", " - "}) if (const size_t i = n.rfind(sep); i != std::string::npos) n = n.substr(i + std::char_traits<char>::length(sep));
  std::string o = n;
  bool start = true;
  for (char &c : o) {
    if (c == ' ' || c == '-') { start = true; continue; }
    c = start ? (char)std::toupper((unsigned char)c) : (char)std::tolower((unsigned char)c);
    start = false;
  }
  return o;
}
static std::string words(int n) {
  static const char *U[] = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
                            "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"};
  static const char *T[] = {"", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"};
  if (n < 0) n = 0;
  if (n < 20) return U[n];
  if (n < 100) return std::string(T[n / 10]) + (n % 10 ? std::string(" ") + U[n % 10] : "");
  return std::to_string(n);
}
// "one point four", "point six": what an engineer says, and what no speech engine can get wrong.
static std::string tenths(double v) {
  const int t = (int)std::floor(std::max(0.0, v) * 10 + 0.5);
  return (t >= 10 ? words(t / 10) + " " : "") + "point " + words(t % 10);
}
// A lap: "one twenty-three point four".
static std::string lapWords(double s) {
  if (!(s > 0)) return "no time";
  const int t = (int)std::floor(s * 10 + 0.5), m = t / 600, sec = (t / 10) % 60, d = t % 10;
  std::string o = m ? words(m) + " " : "";
  o += m && sec < 10 ? "oh " + words(sec) : words(sec);
  return o + " point " + words(d);
}
// A gap, spoken. Past a minute it is not a gap, it is a different race.
static std::string gapWords(double g) { return g > 60 ? "a long way" : tenths(g); }
static bool has(const std::string &t, const char *w) { return t.find(w) != std::string::npos; }
static bool any(const std::string &t, std::initializer_list<const char *> ws) { for (const char *w : ws) if (has(t, w)) return true; return false; }
static bool ends(const std::string &t, const char *w) { const size_t n = std::char_traits<char>::length(w); return t.size() >= n && t.compare(t.size() - n, n, w) == 0; }
static int edits(const std::string &a, const std::string &b) {
  std::vector<int> prev(b.size() + 1), cur(b.size() + 1);
  for (size_t j = 0; j <= b.size(); j++) prev[j] = (int)j;
  for (size_t i = 1; i <= a.size(); i++) {
    cur[0] = (int)i;
    for (size_t j = 1; j <= b.size(); j++) cur[j] = std::min({prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)});
    std::swap(prev, cur);
  }
  return prev[b.size()];
}

static const double FUEL_PER_KM = 1.6;       // kg: a strategy number he tracks, not a weight the car carries (js/engineer.js)

// ------------------------------------------------------------------ the race, read
void Engineer::begin(Race *race) {
  r = race; me = race ? race->me : nullptr;
  inbox.clear(); pending.clear(); cool.clear(); near.clear(); cheerQ.clear(); trail.clear();
  up.reset(nullptr); down.reset(nullptr);
  sampleAt = quietSince = tailT = 0; lapWear = -1; wearPerLap = 0;
  tailOn = hammered = nullptr;
  lastLap = 0; stoppedFor = -1; cheers = talkN = coxN = tyreSaid = 0; lastCheer = -99;
  gridSaid = homeSaid = doneSaid = settledSaid = false; calmUntil = 0;
  if (!r || !me) return;
  fuelLap = FUEL_PER_KM * r->track->length / 1000;
  fuel = fuelLap * (r->laps + 0.4);
  // every race event, as it is logged (and whoever was already listening still hears it)
  auto was = r->onEvent;
  r->onEvent = [this, was](const RaceEvent &ev) { if (was) was(ev); inbox.push_back(ev); };
}

void Engineer::call(const std::string &text, int pri) {
  if (r) quietSince = r->time;
  if (say && !text.empty()) say(text, pri);
}
bool Engineer::ready(const std::string &key, double gap) {
  auto it = cool.find(key);
  if (it != cool.end() && r->time < it->second) return false;
  cool[key] = r->time + gap;
  return true;
}
double Engineer::wear() const { return std::max(me->car.tyre.wf, me->car.tyre.wr); }
double Engineer::whenAt(const Entry &e, double p) const {
  auto it = trail.find(e.idx);
  if (it == trail.end() || it->second.size() < 2) return NaN;
  const auto &v = it->second;
  if (p < v.front().second) return NaN;
  for (size_t i = v.size() - 1; i > 0; i--) {
    if (v[i - 1].second <= p) {
      const double d = v[i].second - v[i - 1].second;
      return d > 1e-6 ? v[i - 1].first + (v[i].first - v[i - 1].first) * std::min(1.0, (p - v[i - 1].second) / d) : v[i].first;
    }
  }
  return NaN;
}
// THE GAP, as the timing screen has it: how long ago the car in front was HERE. (Metres over your own speed, which is
// what it used to be, reads point nine in a fast corner and one point six on the next straight for the same gap.)
double Engineer::gapTo(const Entry &o) const {
  const double pm = r->progress(*me), po = r->progress(o);
  const double w = po >= pm ? whenAt(o, pm) : whenAt(*me, po);
  if (w == w) {
    return std::max(0.0, trail.find((po >= pm ? o : *me).idx)->second.back().first - w);
  }
  return std::fabs(po - pm) / std::max(r->track->length / lapGuess(), 14.0);
}
double Engineer::lapGuess() const { return me->lastLap > 0 ? me->lastLap : me->bestLap > 0 ? me->bestLap : r->track->length / 55.0; }
Entry *Engineer::ahead() const {
  const int i = me->pos - 1;
  Entry *a = i > 0 && i - 1 < (int)r->standings.size() ? r->standings[i - 1] : nullptr;
  return a && !a->retired ? a : nullptr;
}
Entry *Engineer::behind() const {
  const int i = me->pos;
  Entry *b = i > 0 && i < (int)r->standings.size() ? r->standings[i] : nullptr;
  return b && !b->retired ? b : nullptr;
}
const Corner *Engineer::nextCorner() const {
  const Corner *best = nullptr; double bd = 1e18;
  for (const Corner &c : r->track->corners) {
    double d = c.s0 - me->proj.s;
    if (d < 0) d += r->track->length;
    if (d < bd) { bd = d; best = &c; }
  }
  return best;
}
static std::string cornerName(const Corner *c) { return !c ? "the next one" : !c->name.empty() ? nice(c->name) : "turn " + words(c->n); }

// THE FIELD HAS SETTLED. Before this a gap means nothing: the grid is eight metres apart,
// everybody is three wide, and "he is point one ahead" is true of the whole race.
bool Engineer::settled() const {
  return r->state == RaceState::Green && !r->rc.neutral() && !me->inPit && !me->retired && !me->finished
      && r->time >= calmUntil && r->time - r->greenT > std::max(45.0, 0.6 * lapGuess());
}
// How fast a gap is closing, in seconds a lap: the gap NOW against the gap at this same place ONE LAP AGO. Nothing
// shorter is true — a gap in seconds opens out of every slow corner and closes into the next braking zone, and twenty
// seconds of that read "taking two point six a lap out of him" of a gap that was growing. NaN until the same car has
// been ahead (or behind) for a whole lap.
double Engineer::rate(const Trend &t) const {
  const size_t n = t.g.size(), k = (size_t)std::floor(lapGuess() + 0.5);
  if (k < 20 || n <= k) return NaN;
  // three seconds either side, so one sample taken in a braking zone does not decide it
  double was = 0, now = 0;
  for (size_t i = 0; i < 3; i++) { was += t.g[n - 1 - k + i > n - 1 ? n - 1 : n - 1 - k + i] / 3; now += t.g[n - 1 - i] / 3; }
  return was - now;
}
void Engineer::sample(double dt) {
  sampleAt += dt;
  if (sampleAt < 1) return;
  sampleAt = 0;
  for (const Entry &e : r->entries) {
    if (e.retired) continue;
    auto &v = trail[e.idx];
    v.push_back({r->time, r->progress(e)});
    if (v.size() > 150) v.erase(v.begin());
  }
  auto one = [&](Trend &t, Entry *e) {
    if (!e || e->inPit || me->inPit || r->rc.neutral()) { t.reset(nullptr); return; }
    if (t.who != e) t.reset(e);
    t.g.push_back(gapTo(*e));
    if (t.g.size() > 240) t.g.erase(t.g.begin());
  };
  one(up, ahead()); one(down, behind());
  for (const Entry &e : r->entries) {
    if (&e == me || e.retired || e.inPit) continue;
    if (std::hypot(e.car.x - me->car.x, e.car.y - me->car.y) < 10) near[e.idx] = r->time;
  }
}

void Engineer::tick(double dt) {
  if (!r || !me) return;
  const double t = r->time;
  for (size_t i = 0; i < pending.size();) {
    if (t >= pending[i].at) { auto fn = std::move(pending[i].fn); pending.erase(pending.begin() + i); fn(); }
    else i++;
  }
  std::vector<RaceEvent> evs; evs.swap(inbox);
  for (const RaceEvent &ev : evs) event(ev);

  if (r->state == RaceState::Grid) {
    startPos = me->pos;
    if (!gridSaid && r->lights < 2.6 && r->lights > 0) {
      gridSaid = true;
      call("Radio check, " + driver + ". Loud and clear my end. Clean launch, eyes up.", 1);
    }
    return;
  }
  if (r->state != RaceState::Green || me->retired || me->finished) return;
  const Car &car = me->car;
  fuel = std::max(0.0, fuel - FUEL_PER_KM / 1000 * car.speed * dt * (0.35 + 0.65 * car.throttle) / 0.75);
  sample(dt);
  lapTick();
  strategy();
  company(dt);
}

// ------------------------------------------------------------------ once a lap
void Engineer::lapTick() {
  if (me->lap == lastLap) return;
  lastLap = me->lap;
  const double w = wear();
  if (lapWear >= 0) wearPerLap = std::max(0.001, w - lapWear);
  lapWear = w;
  const int left = lapsLeft();
  if (left <= 0) return;
  std::string s;
  if (left == 1) s = "Last lap, " + driver + "! Last lap. ";
  else if (left == 2) s = "Two to go. ";
  else if (left == 3 && r->laps >= 6) s = "Three to go. ";
  else if (left == 5 && r->laps >= 9) s = "Five to go. ";
  else if (r->laps >= 6 && left == r->laps / 2) s = "Halfway. ";
  const bool pb = me->lap >= 2 && me->bestLap > 0 && me->lastLap > 0 && me->lastLap <= me->bestLap + 1e-6;
  if (pb) s += "Personal best, " + lapWords(me->lastLap) + ". ";
  s += "P" + std::to_string(me->pos) + ". ";
  if (!r->rc.neutral()) {
    if (Entry *a = ahead(); a && !a->inPit) { const double g = gapTo(*a); if (g < 12) s += nice(a->name) + " " + tenths(g) + " ahead. "; }
    else if (!ahead()) { if (Entry *b = behind(); b && !b->inPit) s += "You lead by " + tenths(gapTo(*b)) + ". "; }
  }
  if (me->lap == 1 && r->drsRule && left > 1) s += "DRS is enabled.";
  if (left == 1) s += r->rc.neutral() ? "Stay behind the safety car." : "Everything you have. Empty the tank!";
  while (!s.empty() && s.back() == ' ') s.pop_back();
  call(s, 1);
}

// ------------------------------------------------------------------ strategy
void Engineer::strategy() {
  const Car &car = me->car;
  const int left = lapsLeft();
  // BOX: a lost wing, real damage, or tyres past their life — with laps left to use what a stop buys.
  if (r->pits && !me->inPit && !me->pitRequest && stoppedFor != me->pitStops && left >= 2) {
    std::string why;
    if (car.lostFrontWing || car.lostRearWing) why = std::string("New ") + (car.lostFrontWing ? "front" : "rear") + " wing waiting for you.";
    else if (car.damage > 0.35) why = "We have damage, we need to look at it.";
    else if (!r->stock && wear() > 0.8) why = "Those tyres are finished.";
    if (!why.empty()) {
      stoppedFor = me->pitStops;
      me->pitRequest = true;
      call("Box, box. Box this lap. " + why, 2);
    }
  }
  if (!r->stock && tyreSaid == 0 && wear() > 0.5 && left >= 2) { tyreSaid = 1; call("Tyres are at half life. Look after the rears on the exits.", 0); }

  if (!settled()) return;
  if (settledSaid && r->time - quietSince < 7) return;      // he has only just spoken: one thing at a time
  if (!settledSaid) {
    settledSaid = true;
    std::string s = "Okay " + driver + ", settle in. P" + std::to_string(me->pos);
    const int won = startPos - me->pos;
    s += won >= 2 ? ", up " + words(won) + " places. Mega start!" : won == 1 ? ", up a place. Good start." : won <= -2 ? ". We lost " + words(-won) + " off the line, they are all coming back to you." : ".";
    if (Entry *a = ahead()) s += " " + nice(a->name) + " is " + tenths(gapTo(*a)) + " up the road.";
    else s += " You have the lead. Just drive.";
    call(s, 1);
    cool["pace"] = r->time + 25;
    return;
  }
  Entry *a = ahead(), *b = behind();
  const double ga = a && !a->inPit ? gapTo(*a) : 99, gb = b && !b->inPit ? gapTo(*b) : 99;
  const double ra = rate(up), rb = rate(down);

  // HAMMER TIME — the end of the race, a car in reach, said once per car. Never a start-line reflex.
  if (a && a != hammered && left <= 2 && r->laps >= 3 && me->lap >= 1 && ga < 2.5) {
    hammered = a;
    cool["pace"] = r->time + 40;
    call("Hammer time, " + driver + "! " + nice(a->name) + " is " + tenths(ga) + " ahead and we have " + (left == 1 ? "one lap" : "two laps")
         + " to take him. Everything you have got!", 1);
    return;
  }
  // CATCHING: measured, and said as a rate.
  if (a && ga < 3.5 && ra == ra && ra > 0.15 && ready("pace", 75)) {
    if (ga < 1.0 && r->drsRule && me->lap >= 1) call("You are inside the second on " + nice(a->name) + ". DRS is yours. Go and get him!", 1);
    else call(nice(a->name) + " is " + tenths(ga) + " ahead and you are taking " + tenths(std::min(ra, 2.9)) + " a lap out of him. Keep it coming.", 1);
    return;
  }
  // BEING CAUGHT: who, how fast, and where to put the car.
  if (b && gb < 1.0 && rb == rb && rb > 0.1 && ready("defend", 60)) {
    call(nice(b->name) + " behind, " + tenths(gb) + ", and coming. Cover the inside into " + cornerName(nextCorner()) + ". Make the car wide.", 1);
    return;
  }
  // LOSING THE CAR AHEAD: honest, and useful.
  if (a && ga > 1.5 && ga < 6 && ra == ra && ra < -0.3 && ready("pace", 110)) {
    call(nice(a->name) + " is pulling " + tenths(std::min(-ra, 2.9)) + " a lap on us. Brake a touch later, lean on the exits. Come on.", 0);
    return;
  }
  if (ga > 4 && gb > 4 && ready("lonely", 170)) call("Clear air both ends. Hit your marks and bank the lap time.", 0);
}

// ------------------------------------------------------------------ the friend, and the cox
void Engineer::company(double dt) {
  if (!settled()) { tailT = 0; return; }
  Entry *a = ahead();
  // ON SOMEBODY'S GEARBOX: this is where a cox earns the seat. Short, in rhythm, and never about data.
  if (a && !a->inPit) {
    if (a != tailOn) { tailOn = a; tailT = 0; }
    const double g = gapTo(*a);
    if (g < 0.7) tailT += dt; else if (g > 1.3) tailT = 0;
    if (tailT > 10 && ready("cox", 38)) {
      const std::string n = nice(a->name);
      const std::string L[] = {
        "Stay on him. Stay on him. Exit, exit, exit!",
        "Give me ten good corners, " + driver + ". Ten. Starting now!",
        n + " is looking in his mirrors, he is rattled. Keep the pressure on!",
        "Breathe. Patient hands. Then send it, " + driver + ", send it!",
        "He is defending the inside everywhere. Better exit, then round the outside!",
        "In two, out two. Smooth in, power down. You have him, you have him!",
      };
      call(L[coxN++ % 6], 0);
      tailT = 0;
    }
  } else { tailOn = nullptr; tailT = 0; }
  // The last half of the last lap.
  if (!homeSaid && lapsLeft() == 1 && me->proj.s > 0.62 * r->track->length && me->proj.s < 0.9 * r->track->length) {
    homeSaid = true;
    call(me->pos == 1 ? "Bring it home, " + driver + "! Clean, clean, clean. It is yours!" : "Bring it home. Nothing silly, clean to the flag. Come on!", 1);
  }
  // Nobody has said anything for a long while. A friend says something.
  if (r->time - quietSince > 105 && ready("talk", 105)) {
    const std::string L[] = {
      "Looking good, " + driver + ". Smooth hands, eyes far.",
      "You are doing a mega job. Keep stacking the laps.",
      "Breathe on the straight. Shoulders down. Lovely.",
      "Still here, mate. Car looks happy from the wall.",
      "Rhythm, " + driver + ". Same marks, every lap. Beautiful.",
    };
    call(L[talkN++ % 5], 0);
  }
}

// ------------------------------------------------------------------ the race log, told as radio
void Engineer::cheerSay() {
  std::vector<std::string> q; q.swap(cheerQ);
  if (q.empty() || !me || me->retired) return;
  const std::string name = nice(q.back()), pos = "P" + std::to_string(me->pos);
  const double t = r->time; const bool again = t - lastCheer < 10;
  lastCheer = t; cheers++;
  std::string line;
  if (me->pos == 1) line = again ? "And that is the lead! P1!" : "YES! P1! Get in there " + driver + ", you are leading the race!";
  else if (q.size() > 1) line = "YES! " + words((int)q.size()) + " cars in one go! " + pos + "!";
  else if (again) line = cheers % 2 ? "And another one! " + pos + "!" : "Two in a row! " + pos + "!";
  else {
    const std::string L[] = {
      "YES! Get in there! Great move on " + name + ". " + pos + ".",
      "Mega, mega! " + name + " done. " + pos + ".",
      "That's it! Beautiful, beautiful move. " + pos + ".",
      "Yes mate! " + name + " is behind you. " + pos + ", keep it clean.",
      "Get in! You earned that one. " + pos + ".",
    };
    line = L[cheers % 5];
  }
  call(line, 1);
}

void Engineer::event(const RaceEvent &ev) {
  Entry *e = ev.car >= 0 && ev.car < (int)r->entries.size() ? &r->entries[ev.car] : nullptr;
  const bool mine = e && e == me;
  const std::string &k = ev.kind, &x = ev.text, &c = ev.code;
  // Out of the race: he tells you once, and then the race is somebody else's.
  if (me->retired || me->finished) {
    if (mine && !doneSaid && me->retired && k == "crash") { doneSaid = true; call("That is our race, " + driver + ". Are you okay? Talk to me.", 2); }
    if (!(mine && k == "flag" && has(x, " FINISHES P"))) return;
  }

  if (k == "rc") {
    if (c == "yellow" || c == "dyellow") { if (ready("yellow", 45)) call(std::string(c == "dyellow" ? "Double yellow" : "Yellow flag") + (x.find("SECTOR ") != std::string::npos ? ", sector " + words(std::atoi(x.c_str() + x.find("SECTOR ") + 7)) : std::string()) + ". No heroes.", 2); }
    else if (c == "vsc") call("Virtual safety car. Stay positive on the delta.", 2);
    else if (c == "sc") {
      const bool cheap = r->pits && !r->lane.closed && !me->inPit && lapsLeft() >= 3 && (wear() > 0.3 || me->car.damage > 0.15) && stoppedFor != me->pitStops;
      if (cheap) { stoppedFor = me->pitStops; me->pitRequest = true; call("Safety car, safety car! Box this lap, " + driver + ", it is a cheap stop. Box, box.", 2); }
      else call("Safety car, safety car. Slow down, mind the delta, keep heat in the tyres.", 2);
    }
    else if (c == "vscEnd") call("VSC ending. Get ready.", 2);
    else if (c == "scIn") call("Safety car in this lap. Tyres warm, brakes warm. This restart is ours, " + driver + ".", 2);
    else if (c == "green") { calmUntil = r->time + 25; if (r->time - r->greenT > 5) call("Green, green, green! Go, go, go!", 2); }
    else if (c == "red") call("Red flag, red flag. Slow down and come into the pit lane.", 2);
    else if (c == "standing") call("Standing restart. Same as the start: clean launch, eyes up.", 1);
    else if (c == "truck") { if (ready("truck", 60)) call("Recovery vehicle on track. Be careful.", 2); }
    else if (c == "unlap") call("Lapped cars are coming through. Let them go.", 1);
    else if (c == "pitClosed") call("Pit entry is closed. Stay out.", 1);
    else if (mine && c == "giveBack") call("Give that place back, " + driver + ". Do it now, we do not want a penalty.", 2);
    else if (mine && (c == "blue" || c == "blue2")) call(c == "blue2" ? "Blue flag, second time. Let him go NOW." : "Blue flag. Let him through, lose no time.", 2);
    else if (mine && c == "deltaWarn") call("Too quick, you are under the delta. Back off.", 2);
    else if (mine && c == "ten") { if (ready("ten", 70)) call("Close up to the car ahead.", 1); }
    else if (mine && c == "speeding") call("That was too fast into the pit lane. Expect a penalty.", 1);
    return;
  }
  if (k == "penalty" && e) {
    const bool crash = has(x, "CAUSING A COLLISION");
    if (mine) {
      if (has(x, "JUMP START")) call("Jump start, five seconds. Forget it. Head down, we take it back on the road.", 2);
      else if (has(x, "DRIVE THROUGH")) call("Drive through penalty, " + driver + ". Serve it within three laps.", 2);
      else if (crash) { if (ready("ourCrash", 30)) call("That contact was on us. Five seconds. Shake it off, next corner.", 2); }
      else call("We have a penalty. Forget it, we cannot change it. Drive.", 2);
    } else if (crash) {
      auto it = near.find(e->idx);
      if (it != near.end() && it->second > r->time - 2.0) call(nice(e->name) + " gets five seconds for hitting us. Good. You okay?", 1);
    }
    return;
  }
  if (k == "pass" && mine) {
    if (!settledSaid) return;                  // the first corners: counted once, in the settle-in call
    const size_t a = x.find("YOU PASS "), b = x.find(" FOR P");
    if (a != std::string::npos && b != std::string::npos && b > a + 9) {
      cheerQ.push_back(x.substr(a + 9, b - a - 9));
      if (cheerQ.size() == 1) after(1.2, [this] { cheerSay(); });
    }
    return;
  }
  if (k == "crash" && e) {
    const bool out = ends(x, " RETIRES") || has(x, " IS OUT") || has(x, "UPSIDE DOWN");
    if (mine) {
      if (out) { if (!doneSaid) { doneSaid = true; call("That is our race, " + driver + ". Are you okay? Talk to me.", 2); } }
      else if (has(x, "INTO THE BARRIER") && ready("wall", 25)) after(1.6, [this] {
        if (me->retired) return;
        if (me->car.lostFrontWing || me->car.lostRearWing || me->car.damage > 0.35) return;      // the box call says it
        call(me->car.damage > 0.12 ? "You okay? We see some damage, but she will run. Keep going." : "You okay? Car looks fine from here. Reset, go again.", 1);
      });
    } else if (out && ready("retire", 15)) {
      call(nice(e->name) + " is out of the race." + (e->pos < me->pos ? " That is a place for us." : ""), 1);
    }
    return;
  }
  if (k == "flag" && e) {
    if (!mine && ends(x, " WILL PIT")) {
      if (std::abs(e->pos - me->pos) == 1 && r->state == RaceState::Green && ready("undercut", 60))
        call(e->pos < me->pos ? nice(e->name) + " is pitting. Clear track ahead, push now, these are qualifying laps!"
                              : nice(e->name) + " is pitting behind. Watch the undercut, keep the pace up.", 1);
    } else if (mine && ends(x, " PITS")) call("Pit limiter. Hit your marks.", 1);
    else if (mine && has(x, " SERVED")) {
      calmUntil = r->time + 30;
      after(5, [this] {
        std::string s = "Good stop. P" + std::to_string(me->pos) + ".";
        if (Entry *a = ahead(); a && !a->inPit) s += " " + nice(a->name) + " is " + tenths(gapTo(*a)) + " ahead. Fresh tyres, go and get him.";
        call(s, 1);
      });
    }
    else if (mine && c == "tyres" && has(x, "TYRES GONE")) call("Tyres are gone. Box this lap.", 1);
    else if (mine && c == "tyres" && has(x, "STILL OWED")) call("We still owe a pit stop, " + driver + ". Box this lap.", 2);
    else if (mine && c == "joker" && has(x, "STILL TO TAKE")) call("You still owe the joker lap. Take it this lap.", 2);
    else if (mine && c == "jump" && ready("jump", 90)) call("Easy! Wheels on the ground, please, " + driver + ".", 0);
    else if (mine && has(x, " FINISHES P") && !doneSaid) {
      doneSaid = true;
      const int p = me->pos, n = (int)r->entries.size();
      std::string s;
      if (p == 1) s = "P1! YOU WIN! Get in there, " + driver + "! What a drive, what a drive!";
      else if (p <= 3) s = "P" + std::to_string(p) + "! That is a podium, " + driver + "! Brilliant drive, mate. Brilliant.";
      else if (p <= n / 2) s = "Chequered flag. P" + std::to_string(p) + ". Good points, good drive. Proud of that one.";
      else s = "Chequered flag. P" + std::to_string(p) + ". Not our day, but you never lifted. We go again, " + driver + ".";
      call(s, 2);
    }
  }
}

// ------------------------------------------------------------------ what you asked him
std::string Engineer::gapLine() const {
  Entry *a = ahead(), *b = behind();
  std::string s = a ? nice(a->name) + " ahead, " + gapWords(gapTo(*a)) : "You are leading";
  if (b) s += ". " + nice(b->name) + " behind, " + gapWords(gapTo(*b));
  const double ra = rate(up);
  if (a && settled() && ra == ra && std::fabs(ra) > 0.15) s += ra > 0 ? ". You are catching him" : ". He is edging away";
  return s + ".";
}
double Engineer::spareLaps() const {
  const double L = r->track->length, left = std::max(0.0, r->laps * L - r->progress(*me)) / L;
  return (fuel - fuelLap * left) / fuelLap;
}
std::string Engineer::fuelLine() const {
  const double spare = spareLaps();
  if (spare >= 0.25) return "Fuel is fine. Plus " + tenths(spare) + " of a lap. Race him.";
  if (spare >= -0.05) return "Fuel is right on target. Save where you can.";
  return "We are " + tenths(-spare) + " of a lap short. Lift and coast into the braking zones.";
}
std::string Engineer::tyreLine() const {
  const double w = wear();
  const std::string pct = words((int)std::floor(w * 100 + 0.5)) + " percent worn";
  if (w < 0.1) return "Tyres are in great shape. Lean on them.";
  if (w > 0.8) return "Tyres are gone, " + pct + ". Box when we call it.";
  if (wearPerLap > 0) { const double life = std::max(0.0, (0.8 - w) / wearPerLap); if (life < lapsLeft()) return pct + ". Good for about " + words((int)life) + " more laps."; }
  return pct + ". They will make the end.";
}
std::string Engineer::damageLine() const {
  const Car &c = me->car;
  if (c.lostFrontWing) return "The front wing is gone. Box for a new one.";
  if (c.lostRearWing) return "The rear wing is gone. Box, box.";
  if (c.damage > 0.35) return "We have real damage. I want you in the pits.";
  if (c.damage > 0.08) return "A little damage, nothing that slows you. Keep pushing.";
  return "Car is perfect. No damage.";
}
std::string Engineer::paceLine() const {
  if (!(me->lastLap > 0)) return "No lap on the board yet. Finish this one and I will tell you.";
  std::string s = "Last lap, " + lapWords(me->lastLap) + ".";
  if (me->bestLap > 0 && me->bestLap < me->lastLap - 0.05) s += " Your best is " + lapWords(me->bestLap) + ".";
  if (Entry *a = ahead(); a && a->lastLap > 0) {
    const double d = a->lastLap - me->lastLap;
    s += " " + nice(a->name) + " did " + lapWords(a->lastLap) + (d > 0.05 ? ". You are quicker." : d < -0.05 ? ". He has " + tenths(-d) + " on you." : ". Nothing in it.");
  }
  return s;
}
std::string Engineer::boxAdvice() const {
  const Car &c = me->car;
  if (!r->pits) return "No stops in this one. Stay out.";
  if (lapsLeft() < 2) return "No, stay out. Not enough laps left to make it back.";
  if (c.lostFrontWing || c.lostRearWing || c.damage > 0.35) return "Yes. Box this lap, we need to fix the car.";
  if (r->rc.neutral() && wear() > 0.3) return "Yes, box now. It is a cheap stop under the safety car.";
  if (wear() > 0.7) return "Yes, those tyres are nearly done. Box this lap.";
  if (wear() < 0.1) return "No. Stay out. Those tyres are still fresh.";
  return "No. Stay out. Tyres are " + words((int)(wear() * 100)) + " percent worn, there is life in them yet.";
}
// Whoever you named: a surname on this grid, loosely (speech recognition mangles them), or a famous first name.
Entry *Engineer::driverIn(const std::string &text) const {
  static const char *FIRST[][2] = {{"oscar", "PIASTRI"}, {"lando", "NORRIS"}, {"max", "VERSTAPPEN"}, {"charles", "LECLERC"}, {"lewis", "HAMILTON"},
    {"george", "RUSSELL"}, {"kimi", "ANTONELLI"}, {"fernando", "ALONSO"}, {"lance", "STROLL"}, {"pierre", "GASLY"}, {"franco", "COLAPINTO"},
    {"alex", "ALBON"}, {"carlos", "SAINZ"}, {"nico", "HULKENBERG"}, {"gabriel", "BORTOLETO"}, {"esteban", "OCON"}, {"ollie", "BEARMAN"},
    {"oliver", "BEARMAN"}, {"liam", "LAWSON"}, {"isack", "HADJAR"}, {"arvid", "LINDBLAD"}, {"checo", "PEREZ"}, {"sergio", "PEREZ"},
    {"valtteri", "BOTTAS"}, {"yuki", "TSUNODA"}};
  std::vector<std::string> ws;
  for (size_t i = 0; i < text.size();) { size_t j = text.find(' ', i); if (j == std::string::npos) j = text.size(); if (j > i) ws.push_back(text.substr(i, j - i)); i = j + 1; }
  Entry *best = nullptr; int bd = 99;
  for (Entry &e : r->entries) {
    if (&e == me) continue;
    std::string n = nice(e.name);
    if (const size_t sp_ = n.rfind(' '); sp_ != std::string::npos && n.size() - sp_ > 4) n = n.substr(sp_ + 1);
    for (char &ch : n) ch = (char)std::tolower((unsigned char)ch);
    for (const std::string &w : ws) {
      if (w.size() < 4) { if (w == n) return &e; continue; }
      const int d = edits(w, n), lim = n.size() >= 7 ? 2 : n.size() >= 5 ? 1 : 0;
      if (d <= lim && d < bd) { bd = d; best = &e; }
    }
    for (const auto &f : FIRST) if (e.name == f[1] || ends(e.name, f[1])) for (const std::string &w : ws) if (w == f[0] && bd > 0) { bd = 0; best = &e; }
  }
  return best;
}

std::string Engineer::hear(const std::string &raw) {
  std::string t;
  for (char ch : raw) { const unsigned char u = (unsigned char)ch; t += std::isalnum(u) || ch == '\'' ? (char)std::tolower(u) : ' '; }
  std::string text; bool sp = true;
  for (char ch : t) { if (ch == ' ') { if (!sp) text += ' '; sp = true; } else { text += ch; sp = false; } }
  while (!text.empty() && text.back() == ' ') text.pop_back();
  if (text.empty()) return "";
  if (has(text, "radio check") || text == "can you hear me" || text == "do you copy") return "Loud and clear, " + driver + ".";
  if (!r || !me || r->state == RaceState::Over || me->retired || me->finished) return "";
  const int words_ = 1 + (int)std::count(text.begin(), text.end(), ' ');

  // About one particular driver: where he is.
  if (Entry *n = driverIn(text); n && any(text, {"where", "gap", "how far", "what about", "position", "tyres"})) {
    return nice(n->name) + " is P" + std::to_string(n->pos) + ", " + gapWords(gapTo(*n)) + (n->pos < me->pos ? " ahead" : " behind") + (n->inPit ? ", in the pits" : "") + ".";
  }
  if (any(text, {"stay out", "no box", "cancel the stop", "not boxing", "staying out"})) { me->pitRequest = false; return "Copy, stay out, stay out."; }
  if (any(text, {"should i box", "should i pit", "do i box", "do i pit", "should we box", "should we pit", "are we boxing", "when do i pit", "when do we box", "when are we boxing"})) return boxAdvice();
  if (words_ <= 6 && any(text, {"box", "pit this lap", "coming in", "i'm pitting", "im pitting"}) && !has(text, "?")) {
    if (!r->pits) return "No pit lane in this one, " + driver + ". Stay out.";
    me->pitRequest = true; stoppedFor = me->pitStops;
    return "Copy, box this lap. We are ready for you.";
  }
  if (any(text, {"gap", "interval", "how far", "who's ahead", "whos ahead", "who is ahead", "who's behind", "whos behind", "who is behind", "am i catching", "catching him"})) return gapLine();
  if (any(text, {"fuel"})) return fuelLine();
  if (any(text, {"tyre", "tire", "rubber", "grip level", "how's the deg", "degradation"})) return tyreLine();
  if (any(text, {"damage", "is the car ok", "car okay", "car ok", "is the wing", "front wing", "rear wing"})) return damageLine();
  if (any(text, {"lap time", "last lap", "my pace", "the pace", "best lap", "how was that lap", "am i quick", "am i fast"})) return paceLine();
  if (any(text, {"who's leading", "whos leading", "who is leading", "who's winning", "who is winning", "who's first", "the leader"})) {
    Entry *l = r->standings.empty() ? nullptr : r->standings[0];
    if (!l) return "";
    return l == me ? "You are, " + driver + ". You are leading the race." : nice(l->name) + " leads. " + gapWords(gapTo(*l)) + " up the road from you.";
  }
  if (any(text, {"penalt"})) return me->penalty > 0 ? "We are carrying " + words((int)me->penalty) + " seconds of penalty. Build a gap." : "No penalties. You are clean.";
  if (any(text, {"laps left", "laps to go", "laps remaining", "how many laps", "how long left", "which lap", "what lap"})) {
    const int left = lapsLeft();
    return left <= 1 ? "This is the last lap." : words(left) + " laps to go. Lap " + words(std::min(r->laps, me->lap + 1)) + " of " + words(r->laps) + ".";
  }
  if (any(text, {"position", "where am i", "what place", "what p am i", "what am i"})) return "P" + std::to_string(me->pos) + " of " + words((int)r->entries.size()) + ".";
  return "";
}

// What the model is told is true. It may use these numbers and no others.
std::string Engineer::facts() const {
  if (!r || !me) return "Not in a race. The driver is in the menus or the garage.";
  char b[640];
  Entry *a = ahead(), *bh = behind();
  const char *flag = r->state == RaceState::Grid ? "on the grid, waiting for the lights" : r->state == RaceState::Over || me->finished ? "race finished"
                   : me->retired ? "retired from the race" : r->rc.neutral() ? "safety car / neutralised" : me->inPit ? "in the pit lane" : "green flag racing";
  std::snprintf(b, sizeof b,
                "Circuit: %s. Status: %s. Position: P%d of %d. Lap %d of %d. Speed now: %d km/h.\n"
                "Car ahead: %s%s. Car behind: %s%s.\n"
                "Tyre wear: %d%%. Damage: %d%%. Penalty seconds: %d. Pit stops made: %d. Last lap: %s. Best lap: %s.",
                r->track->name.c_str(), flag, me->pos, (int)r->entries.size(), std::min(r->laps, me->lap + 1), r->laps, (int)(me->car.speed * 3.6),
                a ? nice(a->name).c_str() : "nobody (leading)", a ? (", " + std::to_string(gapTo(*a)).substr(0, 4) + " s").c_str() : "",
                bh ? nice(bh->name).c_str() : "nobody", bh ? (", " + std::to_string(gapTo(*bh)).substr(0, 4) + " s").c_str() : "",
                (int)(wear() * 100), (int)(me->car.damage * 100), (int)me->penalty, me->pitStops,
                me->lastLap > 0 ? (std::to_string(me->lastLap).substr(0, 5) + " s").c_str() : "none yet",
                me->bestLap > 0 ? (std::to_string(me->bestLap).substr(0, 5) + " s").c_str() : "none yet");
  return b;
}

}  // namespace xbr
