// brain.cpp — THE THINKING DRIVER (not in the JS).
//
// Adam, 2026-10-09: "make a actual ai not a bot following rules, a ai that thinks", "they
// sense not see, a human sees ... their mirrors and whats in front not excatly everything at
// once, they tend to lock in on one thing and lose the other ... that decides their style".
//
// So a driver here has no rule that says "attack on the inside". Several times a second it
// IMAGINES: for each thing it could do (stay on the line, either side of the car ahead, the
// inside or the outside of the next corner, the same with the brakes left late) it runs the
// next few seconds forward — itself and every car it can SEE — and keeps the future it likes
// best. What it likes is its character. What it can see is its eyes: ahead, always; behind,
// only what the mirrors showed at the last glance; alongside, unless that is the thing it loses.
//
//   tier   SMART        looks 3.5 s ahead, thinks five times a second, predicts the others well
//          DUMB         looks 1.2 s ahead, thinks slowly, misjudges gaps, knows two moves
//          SONNY HAYES  SMART, and fearless: the gap that is not there, the outside, the late dive
//   mood   MAD          risk is cheap, positions are everything, and there is a grudge
//          HAPPY        clean, opportunist, leaves room
//          ZEN          loses nothing: sees everything, makes almost no mistakes
// One of each of the nine on every grid (cast); everybody else is an ordinary racer who
// thinks the same way, 2.5 s ahead, and loses one thing at random.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "race.hpp"

namespace xbr {

BrainTune &brainTune() {
  static BrainTune T = [] {
    BrainTune t;
    if (const char *e = std::getenv("XBR_BT")) {
      std::string s = e;
      size_t at = 0;
      while (at < s.size()) {
        const size_t c = s.find(',', at), q = s.find('=', at);
        const size_t end = c == std::string::npos ? s.size() : c;
        if (q != std::string::npos && q < end) {
          const std::string k = s.substr(at, q - at);
          const double v = std::atof(s.substr(q + 1, end - q - 1).c_str());
          struct { const char *n; double *p; } F[] = {{"lane", &t.lane}, {"passW", &t.passW}, {"defW", &t.defW}, {"riskW", &t.riskW}, {"switchC", &t.switchC},
            {"simPen", &t.simPen}, {"capPen", &t.capPen}, {"hwBase", &t.hwBase}, {"hwK", &t.hwK}, {"gate", &t.gate}, {"closeAfter", &t.closeAfter},
            {"lateK", &t.lateK}, {"confRisk", &t.confRisk}, {"horizonK", &t.horizonK}};
          bool ok = false;
          for (auto &f : F) if (k == f.n) { *f.p = v; ok = true; }
          if (!ok) { std::fprintf(stderr, "XBR_BT: no such constant '%s'\n", k.c_str()); std::exit(2); }
        }
        at = end + 1;
      }
    }
    return t;
  }();
  return T;
}

static double rnd(unsigned &s) { s = s * 1664525u + 1013904223u; return (s >> 8) / 16777216.0; }
static unsigned hashName(const std::string &n, unsigned salt) {
  unsigned h = 2166136261u ^ salt;
  for (char c : n) { h ^= (unsigned char)c; h *= 16777619u; }
  return h;
}

const char *Race::brainTag(const Entry &e) const {
  static const char *T[4][4] = {
    {"", "", "", ""},
    {"SMART", "SMART - MAD", "SMART - HAPPY", "SMART - ZEN"},
    {"DUMB", "DUMB - MAD", "DUMB - HAPPY", "DUMB - ZEN"},
    {"SONNY HAYES", "SONNY HAYES - MAD", "SONNY HAYES - HAPPY", "SONNY HAYES - ZEN"},
  };
  return T[std::clamp(e.brain.tier, 0, 3)][std::clamp(e.brain.mood, 0, 3)];
}

// WHO IS WHO. The tier belongs to the NAME (the same driver is SMART every race); the mood
// is the day they are having, dealt so that each tier has one mad, one happy, one zen.
void Race::cast() {
  std::vector<Entry *> pool;
  for (Entry &e : entries) {
    Brain &b = e.brain;
    b.rng = hashName(e.name, (unsigned)(seed * 977)) | 1u;
    b.lost = (int)(rnd(b.rng) * 4);
    b.glance = 1.0 + rnd(b.rng) * 1.6;
    if (e.hasDriver && !e.isPlayer) pool.push_back(&e);
  }
  // each driver's own tier, and how strongly it is theirs
  std::sort(pool.begin(), pool.end(), [](Entry *a, Entry *b) { return hashName(a->name, 7) < hashName(b->name, 7); });
  std::vector<Entry *> pick[4];
  for (Entry *e : pool) pick[1 + hashName(e->name, 3) % 3].push_back(e);
  // a short grid may have nobody of a tier: borrow from the longest list
  for (int t = 1; t <= 3; t++)
    while (pick[t].size() < 3) {
      int from = 0;
      for (int q = 1; q <= 3; q++) if (pick[q].size() > 3 && (!from || pick[q].size() > pick[from].size())) from = q;
      if (!from) break;
      pick[t].push_back(pick[from].back()); pick[from].pop_back();
    }
  unsigned r = (unsigned)(seed * 7919 + 5) | 1u;
  for (int t = 1; t <= 3; t++) {
    int moods[3] = {1, 2, 3};
    for (int k = 2; k > 0; k--) std::swap(moods[k], moods[(int)(rnd(r) * (k + 1))]);
    for (size_t k = 0; k < pick[t].size() && k < 3; k++) { pick[t][k]->brain.tier = t; pick[t][k]->brain.mood = moods[k]; }
  }
  for (Entry &e : entries) {
    Brain &b = e.brain;
    if (b.tier == 1) { b.horizon = 3.5; b.every = 0.2; b.glance *= 0.7; }
    if (b.tier == 2) { b.horizon = 1.2; b.every = 0.7; b.noise = 0.22; b.glance *= 2.0; b.wDef = 0.6; }
    if (b.tier == 3) { b.horizon = 3.5; b.every = 0.2; b.caution = 0.4; b.margin = 1.9; b.dive = 1.8; b.glance *= 0.6; b.wAtk = 1.3; }
    if (b.mood == 1) { b.caution *= 0.45; b.wAtk *= 1.5; b.wDef *= 1.5; b.lost = rnd(b.rng) < 0.5 ? 1 : 3; }
    if (b.mood == 2) { b.margin += 0.2; }
    if (b.mood == 3) { b.lost = -1; b.caution *= 0.9; b.glance = 0.35; b.every = std::min(b.every, 0.2); }
    if (b.lost == 0) b.glance *= 3.5;                      // loses its mirrors: looks once in a long while
    if (e.hasDriver) {
      Driver &d = e.driver;
      const double err = b.mood == 1 ? 1.7 : b.mood == 3 ? 0.3 : b.tier == 2 ? 1.5 : 1.0;
      d.errScale = (std::isnan(d.errScale) ? 1 : d.errScale) * err;
      d.nextMistake /= std::max(0.3, err);
    }
  }
}

// Does `e` know `o` is there? Ahead: yes, it is looking at it. Behind: only the car the
// mirrors last showed. Alongside: yes — unless that is the thing this driver loses.
bool Race::aware(Entry &e, const Entry &o) {
  Brain &b = e.brain;
  const double ds = track->gap(o.proj.s, e.proj.s);
  if (ds > 2.5) return true;
  if (ds < -2.5) return b.rear == &o && time - b.rearAt < b.glance * 1.5 + 0.5;
  static const bool SEE_ALL = std::getenv("XBR_SEEALL") != nullptr;        // A/B: nobody is ever missed alongside
  if (b.lost != 3 || SEE_ALL) return true;
  // a glance to the side now and then: it sticks for a moment either way
  if (time - b.sideAt > 0.6) { b.sideAt = time; b.sideSeen = rnd(b.rng) < 0.4; }
  return b.sideSeen;
}

namespace {
struct Other { Entry *who; double ds, lat, v, pace; bool behind; };
}

Race::Thought Race::think(Entry &e, int i, double lim, double lineOff, bool noAtk, bool noDef) {
  Brain &b = e.brain;
  const Track &t = *track;
  const Line &line = e.drive ? e.drive->line() : e.lines->race;
  const double L = e.car.spec->bodyL != 0 ? e.car.spec->bodyL : 4.6;
  const double dtR = 4 * FIXED_DT;                       // race.cpp NEIGH_EVERY
  Thought out;

  // ---- THE MIRRORS: a glance, when it is time for one. What it shows is remembered until the next.
  if (time - b.glanceAt > b.glance) {
    b.glanceAt = time;
    b.rear = nullptr;
    double best = 60;
    for (Entry &o : entries) {
      if (&o == &e || o.retired || o.inPit) continue;
      const double ds = t.gap(e.proj.s, o.proj.s);       // + : it is behind me
      if (ds > 2.5 && ds < best) { best = ds; b.rear = &o; }
    }
    if (b.rear) { b.rearAt = time; b.rearDs = best; b.rearLat = b.rear->proj.lat; b.rearV = b.rear->car.speed; }
  }
  // somebody sitting in the mirrors it looks in: that is what pressure is. A driver who never looks feels none.
  const bool hounded = b.rear && time - b.rearAt < b.glance + 0.5 && b.rearDs < std::max(9.0, e.car.speed * 0.55);
  b.pressT = hounded ? std::min(40.0, b.pressT + dtR) : std::max(0.0, b.pressT - 2 * dtR);
  out.pressure = std::min(1.0, b.pressT / 14) * (b.mood == 3 ? 0.25 : 1);

  // ---- the plan it already has, between thoughts
  const auto give = [&]() {
    out.want = b.plan == 0 ? 0 : std::clamp(b.planLat, -lim, lim) - lineOff;
    out.lunge = b.planLate;
    out.cap = b.planCap;
    // OFF THE LINE A CORNER IS TIGHTER. The line's speed is the line's: a car a lane away from it
    // has to arrive slower, and has to start slowing before the corner, not in it (47 cars a race
    // went into the barrier on their own before this — an inside line at the outside line's speed).
    {
      const double dev = std::fabs(e.proj.lat - lineOff) + (b.plan == 1 ? std::fabs(std::clamp(b.planLat, -lim, lim) - e.proj.lat) * 0.5 : 0);
      if (dev > 1.0) {
        const double vTop = std::max(40.0, topSpeed(*e.car.spec));
        for (double d = 0; d <= 130; d += 10) {
          const int idx = t.idx(e.proj.s + d);
          const double vl = std::max(8.0, (double)line.v[(size_t)idx]);
          const double corner = std::clamp((0.9 - vl / vTop) / 0.25, 0.0, 1.0);
          const double va = vl * (1 - brainTune().capPen * corner * std::min(1.0, dev / 3.0)) * (1 + b.planLate);
          const double c = std::sqrt(va * va + 2 * 9.0 * d);
          if (corner > 0 && (std::isnan(out.cap) || c < out.cap)) out.cap = c;
        }
      }
    }
    // the thing it loses, while it is locked on a car ahead or one behind
    const bool locked = b.plan != 0 || hounded;
    if (locked && b.lost == 2) out.want += 0.9 * std::sin(time * 0.9 + (b.rng & 255));             // the line: it wanders off it
    if (locked && b.lost == 1 && brakingZone(e.proj.s, 120)) out.lunge += 0.035;                     // the brake point: late, every time
    return out;
  };
  static const bool NO_PRESS = std::getenv("XBR_NOPRESS") != nullptr;      // A/B: nobody cracks
  if (NO_PRESS) out.pressure = 0;
  if (time - b.planAt < b.every) return give();
  b.planAt = time;

  const BrainTune &BT = brainTune();
  // ---- WHAT IT CAN SEE
  Other seen[6];
  int ns = 0;
  const double vLineNow = std::max(8.0, (double)line.v[(size_t)i]);
  for (Entry &o : entries) {
    if (&o == &e || o.retired || o.inPit || ns >= 6) continue;
    double ds = t.gap(o.proj.s, e.proj.s), lat = o.proj.lat, v = o.car.speed;
    if (ds > 110 || ds < -60) continue;
    if (ds < -2.5) {
      // behind: the mirror's memory of it, run forward to now
      if (b.rear != &o || time - b.rearAt > b.glance * 1.5 + 0.5) continue;
      const double age = time - b.rearAt;
      ds = -(b.rearDs - (b.rearV - e.car.speed) * age); lat = b.rearLat; v = b.rearV;
      if (ds > -2.5) ds = -2.5;
    } else if (ds <= 2.5 && !aware(e, o)) continue;
    if (b.noise > 0) ds *= 1 + (rnd(b.rng) - 0.5) * 2 * b.noise;      // DUMB: the gap is not what it thinks
    const double vl = std::max(8.0, (double)line.v[(size_t)o.proj.i]);
    seen[ns++] = {&o, ds, lat, v, std::clamp(v / vl, 0.6, 1.08), ds < 0};
  }
  // nobody in sight: the line, and nothing to decide
  if (ns == 0) { b.plan = 0; b.planLate = 0; b.planCap = NaN; return give(); }

  // ---- WHAT IT COULD DO
  struct Cand { int plan; double lat; double late; };
  Cand cands[8];
  int nc = 0;
  cands[nc++] = {0, 0, 0};
  const Other *ahead = nullptr, *behind = nullptr;
  for (int k = 0; k < ns; k++) {
    if (!seen[k].behind && seen[k].ds > 2.5 && (!ahead || seen[k].ds < ahead->ds)) ahead = &seen[k];
    if (seen[k].behind && (!behind || seen[k].ds > behind->ds)) behind = &seen[k];
  }
  const double inside = insideAhead(e.proj.s, 220);
  const bool zone = brakingZone(e.proj.s, 140);
  const double lateBy = (std::isnan(e.driver.lungeMax) ? 0.02 : e.driver.lungeMax) * (0.6 + 0.6 * e.driver.aggression) * b.dive;
  if (ahead && ahead->ds < 70 && !noAtk) {
    const double l = ahead->lat + BT.lane, r = ahead->lat - BT.lane;
    const bool lOk = l <= lim, rOk = r >= -lim;
    if (b.tier == 2) {
      // DUMB knows one way past: the side with more road
      if (lOk && (!rOk || lim - ahead->lat > lim + ahead->lat)) cands[nc++] = {1, l, 0};
      else if (rOk) cands[nc++] = {1, r, 0};
    } else {
      if (lOk) cands[nc++] = {1, l, 0};
      if (rOk) cands[nc++] = {1, r, 0};
      if (zone && ahead->ds < 30) {                       // the dive: either side, brakes left late
        if (lOk) cands[nc++] = {1, l, lateBy};
        if (rOk) cands[nc++] = {1, r, lateBy};
      }
    }
  }
  if (b.tier != 2 && inside != 0 && ((behind && !noDef) || (ahead && !noAtk))) {
    cands[nc++] = {1, inside * lim * 0.72, 0};            // the inside of the next corner: to take it, or to keep it
    if (nc < 8) cands[nc++] = {1, -inside * lim * 0.72, 0};
  }

  // ---- IMAGINE EACH ONE
  const double DT = 0.25;
  const int N = (int)std::max(3.0, b.horizon * BT.horizonK / DT);
  const double vTop = std::max(40.0, topSpeed(*e.car.spec));
  const double myPace = std::clamp(e.car.speed / vLineNow, 0.85, 1.05);
  const auto allowed = [&](int idx, double lat, double pace) {
    const double vl = std::max(8.0, (double)line.v[(size_t)idx]);
    const double dev = std::fabs(lat - (double)line.off[(size_t)idx]);
    // off the line costs nothing on a straight and up to 7% of the speed in a corner
    const double corner = std::clamp((0.9 - vl / vTop) / 0.25, 0.0, 1.0);
    return vl * pace * (1 - BT.simPen * corner * std::min(1.0, dev / 3.5));
  };
  double bestU = -1e18, bestCap = NaN;
  int bestK = 0;
  for (int k = 0; k < nc; k++) {
    const Cand &c = cands[k];
    double x = 0, lat = e.proj.lat, v = e.car.speed, risk = 0, cap = NaN;
    Other o[6];
    for (int q = 0; q < ns; q++) o[q] = seen[q];
    for (int j = 0; j < N; j++) {
      const int idx = t.idx(e.proj.s + x);
      const double lm = std::max(0.3, t.w[(size_t)idx] - 1.0);
      const double tgt = c.plan == 0 ? (double)line.off[(size_t)idx] : std::clamp(c.lat, -lm, lm);
      lat += std::clamp(tgt - lat, -3.5 * DT, 3.5 * DT);
      double va = allowed(idx, lat, std::max(myPace, 0.97));
      if (c.late > 0) { va *= 1 + c.late * BT.lateK; if (va < v) risk += 0.5; }     // braking late is a bet, every step it is on
      bool tow = false;
      for (int q = 0; q < ns; q++) {
        Other &p = o[q];
        const double gap = p.ds - x, dl = std::fabs(p.lat - lat);
        if (gap > 0 && gap < 45 && dl < 1.6) tow = true;
        // somebody in my lane, close ahead: I go at their speed, not mine
        if (gap > 0 && gap < L * 1.3 + v * 0.15 && dl < 2.1) {
          va = std::min(va, p.v);
          // in the next second: that is not a prediction any more, it is what the right foot has to do now
          if (j < 4) cap = std::isnan(cap) ? p.v : std::min(cap, p.v);
        }
        // door to door, or through them: this future has a crash in it
        if (std::fabs(gap) < L * 1.05 && dl < b.margin) risk += (b.grudge == p.who ? 0.25 : 1.0) * BT.confRisk;
      }
      if (v < va) v += std::min((std::max(1.0, 9 * (1 - v / vTop)) + (tow ? 0.8 : 0)) * DT, va - v);
      else { const double dv = std::min(13 * DT, v - va); v -= dv; if (v > va * 1.03) risk += (v / va - 1) * 6; }
      x += v * DT;
      // ...and everybody else, as this driver expects them to go
      for (int q = 0; q < ns; q++) {
        Other &p = o[q];
        const int pi = t.idx(e.proj.s + p.ds);
        double pv = b.tier == 2 ? p.v : allowed(pi, p.lat, p.pace);          // DUMB: they will keep doing what they are doing
        const double gap = x - p.ds;                                          // + : I am ahead of them
        // a car behind me, in my lane, cannot go through me
        if (gap > 0 && gap < L * 1.3 + p.v * 0.15 && std::fabs(p.lat - lat) < 2.1) pv = std::min(pv, v);
        // a car ahead comes back to the racing line: that is where the corner is
        if (!p.behind && b.tier != 2) p.lat += std::clamp((double)line.off[(size_t)pi] - p.lat, -2.5 * DT, 2.5 * DT);
        // a car closing from behind goes for the lane I have left it
        if (p.behind && gap > 0 && gap < 30 && std::fabs(p.lat - lat) < 2.1 && b.tier != 2) {
          const double room = lat > 0 ? lat - 2.6 : lat + 2.6;
          p.lat += std::clamp(room - p.lat, -3.0 * DT, 3.0 * DT);
        }
        if (p.v < pv) p.v += std::min(std::max(1.0, 9 * (1 - p.v / vTop)) * DT, pv - p.v); else p.v -= std::min(13 * DT, p.v - pv);
        p.ds += p.v * DT;
      }
    }
    // ---- HOW MUCH IT LIKES THAT FUTURE: road covered, places won and lost, and what it risked
    double U = x;
    for (int q = 0; q < ns; q++) {
      const double end = x - o[q].ds;                     // + : I finish ahead of them
      const double w = b.grudge == seen[q].who ? 2.2 : 1;
      if (!seen[q].behind && end > L * 0.6) U += BT.passW * b.wAtk * w * (0.6 + 0.8 * e.driver.aggression);
      if (seen[q].behind && end < -L * 0.3) U -= BT.defW * b.wDef * (0.5 + e.driver.defence);
      if (seen[q].behind && !noDef) U += std::clamp(end - (-seen[q].ds), -8.0, 8.0) * 0.5 * b.wDef * e.driver.defence;   // even keeping them further back is worth something
    }
    U -= risk * BT.riskW * b.caution;
    // changing its mind costs a little: a driver commits
    const bool same = c.plan == b.plan && (c.plan == 0 || std::fabs(c.lat - b.planLat) < 1.2) && (c.late > 0) == (b.planLate > 0);
    if (!same) U -= (b.tier == 2 ? 0.27 : 1.0) * BT.switchC;
    if (U > bestU) { bestU = U; bestK = k; bestCap = cap; }
  }
  b.plan = cands[bestK].plan; b.planLat = cands[bestK].lat; b.planLate = cands[bestK].late; b.planCap = bestCap;
  {
    // XBR_BRAINDBG=<car index>: what that driver saw and chose, once a second
    static const int DBG = std::getenv("XBR_BRAINDBG") ? std::atoi(std::getenv("XBR_BRAINDBG")) : -1;
    static double last = -9;
    if (e.idx == DBG && time - last >= 1) {
      last = time;
      std::printf("B %6.1f pos %2d s %6.0f lat %5.1f lineOff %5.1f v %5.1f vline %5.1f | plan %d lat %5.1f late %.3f of %d | ahead %s ds %5.1f lat %5.1f v %5.1f | dmg %.2f zone %d\n",
                  time, e.pos, e.proj.s, e.proj.lat, lineOff, e.car.speed, vLineNow, b.plan, b.planLat, b.planLate, nc,
                  ahead ? ahead->who->name.c_str() : "-", ahead ? ahead->ds : 0, ahead ? ahead->lat : 0, ahead ? ahead->v : 0, e.car.damage, zone ? 1 : 0);
    }
  }
  // MAD: whoever hit me last is who this race is about now
  if (b.mood == 1 && e.hitBy && e.hitBy != &e) b.grudge = e.hitBy;
  return give();
}

}  // namespace xbr
