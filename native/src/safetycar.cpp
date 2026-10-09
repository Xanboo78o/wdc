// safetycar.cpp — js/safetycar.js, ported line for line. The numbers and the
// reasons for them are in the JS file; the pointers here say which block is which.
#include "safetycar.hpp"

#include <algorithm>
#include <cmath>

#include "pitstop.hpp"
#include "race.hpp"

namespace xbr {

static const double INF = std::numeric_limits<double>::infinity();
static const double SECTOR = 300;              // m between marshal posts
static const double PICKUP_MIN = 25;           // s the SC leads at least, once it has the leader
static const double QUEUE_GAP = 75;            // m: closer than this to the car ahead = in the queue
static const double QUEUE_WAIT = 75;           // s: after this the SC stops waiting for stragglers
static const double VSC_MIN = 16, VSC_END = 10;
static const double RED_HOLD = 22, RED_WAIT = 240;
static const double CRANE = 38;                // s to lift a retired car clear
// THE RECOVERY: a truck through a gap in the barrier, to the wreck, hook, and back.
static const double TRUCK_BACK = 55, TRUCK_V = 8, TOW_V = 5, HOOK_T = 10, TRUCK_AFTER = 6;
static const double RESTART_ZIP = 45;          // s after a safety-car restart that braking zones stay single file
static int scLapsFor(int laps) { return laps >= 20 ? 3 : laps >= 10 ? 2 : 1; }
static int RANK(RcMode m) {
  switch (m) {
    case RcMode::Green: return 0;
    case RcMode::Vsc: case RcMode::VscEnd: return 1;
    case RcMode::Sc: return 2;
    default: return 3;
  }
}
static const double GIVE_BACK = 12;            // s to hand a place back before the stewards decide
struct Pen { const char *kind; bool dt; int sec; const char *why; };
static const Pen PEN[] = {
  {"sc", true, 0, "OVERTAKING UNDER SAFETY CAR"},
  {"vsc", false, 10, "OVERTAKING UNDER VIRTUAL SAFETY CAR"},
  {"red", false, 10, "OVERTAKING UNDER RED FLAG"},
  {"restart", false, 10, "OVERTAKING BEFORE THE CONTROL LINE"},
  {"yellow", false, 5, "OVERTAKING UNDER YELLOW FLAGS"},
  {"delta", false, 5, "FAILING TO RESPECT THE MINIMUM TIME"},
  {"blue", false, 5, "IGNORING BLUE FLAGS"},
  {"speeding", false, 5, "SPEEDING IN THE PIT LANE"},
  {"unsafe", false, 5, "UNSAFE RELEASE"},
};

static double sgn1(double v) { const double s = sign(v); return s != 0 ? s : 1; }
static bool is(const std::string &a, const char *b) { return a == b; }

// 'Sainte Dévote'.toUpperCase(): ASCII, the Latin-1 letters the circuits use, and ß.
static std::string upper(const std::string &s) {
  std::string o;
  for (size_t i = 0; i < s.size(); i++) {
    const unsigned char c = (unsigned char)s[i];
    if (c == 0xC3 && i + 1 < s.size()) {
      const unsigned char d = (unsigned char)s[i + 1];
      if (d == 0x9F) { o += "SS"; i++; continue; }
      o += (char)c;
      o += (char)(d >= 0xA0 && d <= 0xBE && d != 0xB7 ? d - 0x20 : d);
      i++;
      continue;
    }
    o += (char)(c >= 'a' && c <= 'z' ? c - 32 : c);
  }
  return o;
}

const char *rcModeName(RcMode m) {
  switch (m) {
    case RcMode::Green: return "green";
    case RcMode::Vsc: return "vsc";
    case RcMode::VscEnd: return "vscEnd";
    case RcMode::Sc: return "sc";
    default: return "red";
  }
}
const char *rcPhaseName(RcPhase p) {
  switch (p) {
    case RcPhase::Deploy: return "deploy";
    case RcPhase::Lead: return "lead";
    case RcPhase::In: return "in";
    case RcPhase::Restart: return "restart";
    default: return "";
  }
}

void Director::init(Race *r, bool on_, Mulberry rng_) {
  race = r; on = on_; rng = rng_;
  mode = RcMode::Green; phase = RcPhase::None; since = 0; phaseAt = 0;
  const Track &t = *r->track;
  nSec = (int)std::max(4.0, jsRound(t.length / SECTOR));
  secLen = t.length / nSec;
  yellow.assign((size_t)nSec, Yellow{});
  hasPit = r->lane.len > 60 && !t.open;
  // The safety car is a car: a GT body, driven kinematically along the racing line.
  sc.car = makeCar("gt3");
  scLaps = scLapsFor(r->laps); scFrom = 0;
}

// ---- what everyone else asks ------------------------------------------------------
int Director::sector(double s) const {
  return (int)std::floor(race->track->wrap(s) / secLen) % nSec;
}
int Director::yellowAt(double s) const {
  const Yellow &y = yellow[(size_t)sector(s)];
  return y.set && y.until > race->time ? y.lvl : 0;
}
double Director::vLine(int i) const {
  const double v = race->lines->race.v[(size_t)i];
  return v != 0 && !std::isnan(v) ? v : 30;
}
Entry *Director::leader() const {
  for (Entry *e : race->standings) if (!e->retired && !e->finished) return e;
  return nullptr;
}
std::string Director::tag(const Entry &e) const {
  return e.isPlayer ? "CAR " + std::to_string(e.num) + " (YOU)" : "CAR " + std::to_string(e.num) + " (" + e.name.substr(0, 3) + ")";
}
void Director::rc(const std::string &text, const char *code, Entry *e) { race->log("rc", text, e, code); }

const char *Director::flagFor(const Entry *e) const {
  const Race &r = *race;
  if (!e) return "";
  if (r.state == RaceState::Finish || r.state == RaceState::Over) return "chequered";
  if (mode == RcMode::Red) return "red";
  if (mode == RcMode::Sc) return "sc";
  if (mode == RcMode::Vsc) return "vsc";
  if (mode == RcMode::VscEnd) return "vscEnd";
  int y = yellowAt(e->proj.s);
  if (!y) y = yellowAt(e->proj.s + 150);
  if (y == 2) return "dyellow";
  if (y == 1) return "yellow";
  if (e->blue) return "blue";
  if (r.time - greenAt < 6) return "green";
  return "";
}
double Director::deltaFor(const Entry *e) const {
  if (!e || e->inPit || e->retired) return NaN;
  const double f = deltaF(*e);
  if (f == 0) return NaN;
  return -e->vd / std::max(12.0, vLine(e->proj.i) * f);
}
double Director::deltaF(const Entry &e) const {
  if (mode == RcMode::Vsc || mode == RcMode::VscEnd) return VSC_F;
  if (mode == RcMode::Sc && (phase == RcPhase::Deploy || phase == RcPhase::Lead) && !e.queued) return DELTA_F;
  return 0;
}
bool Director::noAttack(const Entry &e) const {
  return on && (neutral() || yellowAt(e.proj.s) > 0 || yellowAt(e.proj.s + 150) > 0 || e.holdLine);
}

// ---- incidents ----------------------------------------------------------------------
// Everything that can neutralise a race comes through here, from the race.
void Director::incident(const char *kindC, Entry *e) {
  Race &r = *race;
  if (!on || r.state != RaceState::Green || !e || e->finished) return;
  const std::string kind = kindC;
  const double now = r.time, s = e->proj.s, lat = std::fabs(e->proj.lat), w = e->proj.w;
  const bool onTrack = lat <= w + 1.0;
  auto inc = std::make_shared<Incident>(Incident{kind, e, s, now, now + 12, onTrack});
  incidents.push_back(inc);
  const Corner *cn = r.track->cornerAt(s);
  const std::string where = cn ? cn->name : "";
  bool hasWant = false;
  RcMode want = RcMode::Green;
  std::string why;
  if (kind == "debris") {
    // A wing on the road is a yellow. Two within eight seconds and 500 m is a safety car.
    inc->clearAt = now + 14;
    flag(s, 1, 14);
    int near = 0;
    for (const auto &x : incidents)
      if (is(x->kind, "debris") && now - x->t < 8 && std::fabs(r.track->gap(x->s, s)) < 500) near++;
    if (near >= 2) { hasWant = true; want = RcMode::Sc; why = "DEBRIS"; }
  } else if (kind == "beached") {
    inc->clearAt = now + 10;
    flag(s, 2, 14);
    if (lat < w + 9) { hasWant = true; want = RcMode::Vsc; }
    why = "CAR STOPPED";
  } else if (kind == "stopped") {
    inc->clearAt = now + 20;
    flag(s, 2, 25);
    hasWant = true; want = RcMode::Sc; why = "CAR STOPPED ON TRACK";
  } else if (kind == "retired") {
    // A car that is out has to be fetched, wherever it stopped.
    inc->clearAt = now + CRANE * 5;
    flag(s, 2, CRANE + 5);
    hasWant = true; want = RcMode::Sc;
    why = onTrack ? "CAR STOPPED ON TRACK" : "RECOVERY VEHICLE ON TRACK";
    { Job j; j.e = e; j.inc = inc; jobs.push_back(j); }
    int out = 0;
    for (const auto &x : incidents)
      if ((is(x->kind, "retired") || is(x->kind, "roof")) && now - x->t < 6) out++;
    if (out >= 3) { want = RcMode::Red; why = "MULTIPLE CAR INCIDENT"; }
    else if (out >= 2 && RANK(want) < RANK(RcMode::Sc)) { want = RcMode::Sc; why = "MULTIPLE CAR INCIDENT"; }
  } else if (kind == "roof") {
    inc->clearAt = now + CRANE * 1.5;
    flag(s, 2, CRANE * 1.5);
    hasWant = true; want = onTrack ? RcMode::Red : RcMode::Sc; why = "CAR UPSIDE DOWN";
    { Job j; j.e = e; j.inc = inc; jobs.push_back(j); }
  } else if (kind == "rain") {
    inc->clearAt = now + 60;
    hasWant = true; want = RcMode::Red; why = "TRACK CONDITIONS";
  }
  if (kind != "debris" && kind != "rain") {
    rc("INCIDENT INVOLVING " + tag(*e) + (!where.empty() ? " AT " + upper(where) : "") + " NOTED — " + (!why.empty() ? why : "STOPPED"),
       "incident", e);
  }
  if (hasWant) escalate(want);
}

// Yellow in the incident's sector (double if lvl 2), a single yellow in the one before.
void Director::flag(double s, int lvl, double secs) {
  const double now = race->time;
  const int k = sector(s), prev = (k - 1 + nSec) % nSec;
  const auto set = [&](int sec, int l) {
    Yellow &y = yellow[(size_t)sec];
    const bool live = y.set && y.until > now;
    const int was = live ? y.lvl : 0;
    y.lvl = std::max(l, was);
    y.until = std::max(now + secs, live ? y.until : 0.0);
    y.set = true;
    if (l > was && mode == RcMode::Green)
      rc(std::string(l == 2 ? "DOUBLE YELLOW" : "YELLOW") + " IN TRACK SECTOR " + std::to_string(sec + 1), l == 2 ? "dyellow" : "yellow");
  };
  set(k, lvl);
  set(prev, 1);
}

void Director::escalate(RcMode want) {
  if (!hasPit && (want == RcMode::Sc || want == RcMode::Red)) want = RcMode::Vsc;
  const RcMode cur = mode;
  if (RANK(want) < RANK(cur)) return;
  if (RANK(want) == RANK(cur) && !(cur == RcMode::VscEnd && want == RcMode::Vsc)) return;
  if (want == RcMode::Vsc) startVSC();
  else if (want == RcMode::Sc) startSC();
  else if (want == RcMode::Red) startRed();
}

void Director::begin(RcMode m) {
  const double now = race->time;
  if (!hist.empty() && std::isnan(hist.back().t1)) hist.back().t1 = now;
  if (m != RcMode::Green) {
    const Entry *l = leader();
    hist.push_back({m, now, NaN, (l ? l->lap : 0) + 1});
  }
  mode = m; since = now;
}

void Director::startVSC() {
  const RcMode was = mode;
  begin(RcMode::Vsc); count.vsc++;
  if (was != RcMode::VscEnd) graceAll();
  rc("VIRTUAL SAFETY CAR DEPLOYED", "vsc");
  opportunists(0.7);
}

void Director::startSC() {
  Race &r = *race;
  begin(RcMode::Sc); count.sc++;
  phase = RcPhase::Deploy; phaseAt = r.time;
  { const Entry *lead = leader(); scFrom = lead ? r.progress(*lead) : 0; }
  sc.out = false; sc.lights = true; unlapCalled = false;
  graceAll();
  for (Entry &e : r.entries) { e.queued = false; e.unlap = false; e.rcCross = false; }
  rc("SAFETY CAR DEPLOYED", "sc");
  // An incident at the pit entry closes it until the SC has the leader.
  Lane &lane = r.lane;
  if (!incidents.empty() && std::fabs(r.track->gap(incidents.back()->s, lane.entryS)) < 350) {
    lane.closed = true;
    rc("PIT ENTRY CLOSED", "pitClosed");
  }
  opportunists(1.0);
}

void Director::startRed() {
  Race &r = *race;
  begin(RcMode::Red); count.red++;
  phase = RcPhase::In; phaseAt = r.time; parkedAt = NaN;
  sc.out = false; sc.lights = false;
  r.lane.hold = true; r.lane.closed = false;
  // The classification is the order at the moment of the red flag.
  redOrder.clear();
  for (Entry *e : r.standings) if (!e->retired) redOrder.push_back({e, e->lap, e->finished});
  for (Entry &e : r.entries) { e.queued = false; e.unlap = false; if (!e.retired && !e.finished) e.pitRequest = true; }
  rc("RED FLAG", "red");
  rc("ALL CARS TO THE PIT LANE — PROCEED SLOWLY", "redPit");
}

void Director::goGreen(const char *why) {
  Race &r = *race;
  const RcMode was = mode;
  phase0 = phase;
  begin(RcMode::Green); phase = RcPhase::None;
  sc.out = false; sc.lights = false; sc.inLane = false;
  r.lane.closed = false; r.lane.hold = false;
  // NO OVERTAKING BEFORE THE CONTROL LINE: each car races from when IT crosses the line.
  const bool restart = was == RcMode::Sc && phase0 == RcPhase::Restart;
  for (Entry &e : r.entries) {
    e.holdLine = restart && !e.rcCross && !e.retired && !e.finished;
    e.queued = false; e.unlap = false; e.rcCross = false; e.vd = 0;
    // ...and the first corners after it are taken as a start is (THE OPENING CORNERS).
    if (restart) e.zipUntil = r.time + RESTART_ZIP;
  }
  greenAt = r.time;
  if (was == RcMode::Sc) {
    const Entry *lead = leader();
    drsFrom = (lead ? lead->lap : 0) + 2;
    count.restarts++;
  }
  rc(why, "green");
}

// Every car starts its minimum-time delta with a second in hand.
void Director::graceAll() {
  for (Entry &e : race->entries) { e.vd = -std::max(20.0, e.car.speed) * 1.0; e.deltaBad = 0; e.deltaWarned = false; }
}

// A safety car is the cheapest pit stop of the race. The strategists know.
void Director::opportunists(double p) {
  Race &r = *race;
  if (!r.pits) return;
  for (Entry &e : r.entries) {
    if (e.isPlayer || e.retired || e.finished || e.pitRequest || e.inPit) continue;
    const int left = r.laps - e.lap;
    if (left < 2) continue;
    const double wear = std::max(e.car.tyre.wf, e.car.tyre.wr);
    const bool hurt = e.car.damage > 0.25 || (e.car.hasLost && (e.car.lostFrontWing || e.car.lostRearWing));
    const double want = hurt ? 1 : wear > 0.45 ? 0.95 : wear > 0.2 ? 0.7 : wear > 0.08 && left >= 4 ? 0.35 : 0;
    if (rng() < want * p) {
      e.pitRequest = true; e.pitUnder = rcModeName(mode);
      r.log("flag", e.name + " WILL PIT", &e);
    }
  }
}

// ---- racecraft hooks (bots) ---------------------------------------------------------
// Where it wants to be across the road: out of the queue to unlap, off the line for a blue.
double Director::wantBias(Entry &e, double want, double lineOff, double lim) {
  if (!on) return want;
  if (e.unlap) {
    if (e.unlapSide == 0 || std::fabs(lineOff) > 1.5) e.unlapSide = lineOff > 0 ? -1 : 1;
    // Closing on the safety car: commit to the side AWAY from it, once.
    if (sc.out && !sc.inLane && e.unlapSc == 0) {
      const double g = race->track->gap(sc.s, e.proj.s);
      if (g > 0 && g < 160) e.unlapSc = -sgn1(sc.lat);
    }
    return (e.unlapSc != 0 ? e.unlapSc : e.unlapSide) * lim - lineOff;
  }
  if (neutral()) return 0;
  // BLUE: pick the side AWAY from the car lapping you, once, and hold it.
  if (e.blue && e.blueSide != 0) return e.blueSide * std::min(3.2, lim) - lineOff;
  // ...and the car lapping it takes the other side.
  const Entry *b = e.ahead;
  if (b && b->blue == &e && b->blueSide != 0) return -b->blueSide * std::min(3.2, lim) - lineOff;
  return want;
}

// The speed the rules allow this car right now, folded into its ctx.
void Director::limit(Entry &e, DriveCtx &ctx) {
  if (!on || e.inPit || e.finished) return;
  const Race &r = *race;
  const Track &t = *r.track;
  const int i = e.proj.i;
  const double vl = vLine(i), L = r.spec->bodyL;
  bool pred = false;
  double gap = INF, vPred = 0;
  if (e.ahead && !e.ahead->unlap) { pred = true; gap = t.gap(e.ahead->proj.s, e.proj.s); vPred = e.ahead->car.speed; }
  if (sc.out && !sc.inLane) {
    const double g = t.gap(sc.s, e.proj.s);
    if (g > 0 && g < gap) { pred = true; gap = g; vPred = sc.v; }
  }
  double cap = INF;
  bool follow = false;
  const auto byDelta = [&](double f) { return vl * f + std::max(-9.0, std::min(4.0, -(e.vd + 10) * 0.3)); };
  // THE FOLLOWING LAW is the Intelligent Driver Model (Treiber 2000).
  const double A = 9, B = 9, T = 0.3, S0 = 6;
  const auto tail = [&](double v0) {
    const double v = e.car.speed, sg = std::max(0.5, gap - L);
    const double dv = v - vPred;
    const double sStar = S0 + std::max(0.0, v * T + v * dv / (2 * std::sqrt(A * B)));
    const double acc = A * (1 - std::pow(v / std::max(1.0, v0), 4) - (gap < 400 ? (sStar / sg) * (sStar / sg) : 0));
    follow = gap < 60;
    return std::max(0.0, v + std::max(-12.0, acc) * 0.6);
  };
  const double v0d = vl * 0.92;
  switch (mode) {
    case RcMode::Vsc: case RcMode::VscEnd: {
      const double a = byDelta(VSC_F), b = tail(v0d);
      cap = std::min(a, b);
      break;
    }
    case RcMode::Sc: {
      if (e.unlap) { cap = std::min(vl * 0.80, 58.0); break; }
      const Entry *lead = leader();
      if (phase == RcPhase::Restart) {
        if (e.rcCross) break;                                   // past the line: racing
        if (&e == lead) { cap = e.went ? INF : scSpeed(i); if (gap < 80) cap = std::min(cap, tail(vl)); break; }
        cap = tail(vl);
        break;
      }
      // Lights out: the safety car pulls away, the leader does not follow it.
      if (phase == RcPhase::In && &e == lead) { cap = scSpeed(i); break; }
      if (e.queued) cap = tail(v0d);
      else { const double a = byDelta(DELTA_F), b = tail(v0d); cap = std::min(a, b); }
      break;
    }
    case RcMode::Red: {
      const double b = tail(v0d);
      cap = std::min(std::min(vl * 0.55, 45.0), b);
      break;
    }
    default: {
      const int y = std::max(yellowAt(e.proj.s), yellowAt(e.proj.s + 120));
      if (y == 2) cap = vl * 0.80; else if (y == 1) cap = vl * 0.93;
      if ((y && gap < 60) || (e.holdLine && gap < 150)) cap = std::min(cap, tail(v0d));
      if (e.blue && e.blueGap < 30) cap = std::min(cap, vl * 0.92);
    }
  }
  if (cap < INF) ctx.speedCap = std::min(std::isnan(ctx.speedCap) ? INF : ctx.speedCap, cap);
  // Under a neutralisation the car ahead is the queue, and ITS speed is the target.
  if (neutral()) { ctx.obstDs = NaN; ctx.obstV = NaN; }
  if (follow && pred) {
    const double d = gap - L * 1.15;
    if (std::isnan(ctx.obstDs) || d < ctx.obstDs) { ctx.obstDs = d; ctx.obstV = vPred; }
  }
  if (neutral()) { ctx.lunge = 0; ctx.pressure = 0; }
}

// ---- every substep ----------------------------------------------------------------------
void Director::tick(double dt) {
  if (!on) return;
  Race &r = *race;
  const Track &t = *r.track;
  const double now = r.time;
  const bool delta = mode == RcMode::Vsc || mode == RcMode::VscEnd
    || (mode == RcMode::Sc && phase != RcPhase::Restart && phase != RcPhase::In);
  for (Entry &e : r.entries) {
    if (e.retired) continue;
    const double prev = std::isnan(e.rcS) ? e.proj.s : e.rcS;
    e.rcS = e.proj.s;
    if (delta && !e.inPit && !e.finished) {
      const double f = deltaF(e);
      if (f != 0) {
        const double vr = vLine(e.proj.i) * f;
        e.vd = std::max(-vr * 2.5, e.vd + t.gap(e.proj.s, prev) - vr * dt);
      } else e.vd = std::min(e.vd, 0.0);
    }
    if (prev > t.length * 0.8 && e.proj.s < t.length * 0.2) {
      if (mode == RcMode::Sc && phase == RcPhase::Restart) e.rcCross = true;
      e.holdLine = false;
    }
    if (e.holdLine && now - greenAt > 60) e.holdLine = false;
    // Unserved drive-through at the flag: twenty seconds, as the rules say.
    if (e.finished && e.driveThru > 0 && !e.dtConverted) {
      e.dtConverted = true; e.penalty += 20 * e.driveThru;
      rc(tag(e) + " — DRIVE THROUGH NOT SERVED, 20 SECONDS ADDED", "pen", &e);
    }
  }

  // Incidents clear themselves: a car being pushed is still an incident.
  for (auto &inc : incidents) {
    const Entry &e = *inc->e;
    const bool stopped = is(inc->kind, "stopped");
    if ((is(inc->kind, "beached") || stopped) && (e.recover.on || e.stuck > 0 || (stopped && !e.retired && e.car.speed < 3)))
      inc->clearAt = std::max(inc->clearAt, now + 6);
  }
  if (incidents.size() > 40)
    incidents.erase(std::remove_if(incidents.begin(), incidents.end(), [&](const std::shared_ptr<Incident> &x) { return !(x->clearAt > now - 30); }),
                    incidents.end());

  if (r.state == RaceState::Finish || r.state == RaceState::Over) {
    if (mode != RcMode::Green) { begin(RcMode::Green); phase = RcPhase::None; sc.out = false; r.lane.closed = false; r.lane.hold = false; }
    return;
  }

  switch (mode) {
    case RcMode::Vsc:
      if (now - since > VSC_MIN && clear()) {
        mode = RcMode::VscEnd; since = now;
        rc("VIRTUAL SAFETY CAR ENDING", "vscEnd");
      }
      break;
    case RcMode::VscEnd:
      if (now - since > VSC_END) goGreen();
      break;
    case RcMode::Sc: scTick(); break;
    case RcMode::Red: redTick(); break;
    default: break;
  }
  moveSC(dt);
  jobTick(dt);

  dt4 = dt * 4;
  if (sub++ % 4 == 0) {
    queueTick();
    blueTick();
    if (r.me) youTick();
    rainTick();
  }
}

bool Director::clear() const {
  const double now = race->time;
  for (const auto &x : incidents) if (!(x->clearAt <= now)) return false;
  return true;
}

// ---- the safety car's own lap -------------------------------------------------------------
void Director::scTick() {
  Race &r = *race;
  const Track &t = *r.track;
  Lane &lane = r.lane;
  const double now = r.time;
  Entry *lead = leader();
  if (!lead) return;
  switch (phase) {
    case RcPhase::Deploy: {
      if (!sc.out) {
        // Out of the pit exit when the leader is coming — ahead of it.
        const Entry *ref = lead;
        if (lead->inPit) {
          for (Entry *e : r.standings) if (!e->retired && !e->inPit && !e->finished) { ref = e; break; }
        }
        const double d = t.wrap(lane.exitS - ref->proj.s);
        if ((d > 420 && d < 1100) || now - phaseAt > 110) {
          sc.out = true; sc.inLane = true; sc.prog = 0.78; sc.v = 18; sc.lights = true;
          sc.s = t.wrap(lane.entryS + sc.prog * lane.len);
          sc.lat = laneLat(lane, sc.prog);
        }
      } else {
        const double g = t.gap(sc.s, lead->proj.s);
        if (!sc.inLane && ((g > 0 && g < 130) || now - phaseAt > 160)) {
          phase = RcPhase::Lead; phaseAt = now;
          if (lane.closed) { lane.closed = false; rc("PIT ENTRY OPEN", "pitOpen"); }
        }
      }
      break;
    }
    case RcPhase::Lead: {
      const double sinceP = now - phaseAt;
      std::vector<Entry *> live;
      for (Entry &e : r.entries) if (!e.retired && !e.finished && !e.inPit) live.push_back(&e);
      bool formed = true;
      for (Entry *e : live) if (!(e->queued || e->unlap)) { formed = false; break; }
      // Lapped cars may now overtake — once the queue has formed.
      if (!unlapCalled && sinceP > 12 && (formed || sinceP > QUEUE_WAIT)) {
        unlapCalled = true;
        // Only the ones IN the queue, behind the safety car.
        const double P = r.progress(*lead);
        int lapped = 0;
        for (Entry *e : live)
          if (P - r.progress(*e) > t.length * 0.97 && t.gap(e->proj.s, sc.s) < 0) { e->unlap = true; e->unlapAt = now; lapped++; }
        if (lapped) rc("LAPPED CARS MAY NOW OVERTAKE", "unlap");
      }
      for (Entry *e : live) {
        if (!e->unlap) continue;
        // Done once it is clear past the safety car, or it has had a minute.
        if (t.gap(e->proj.s, sc.s) > 25 || now - e->unlapAt > 70) { e->unlap = false; e->unlapSc = 0; e->unlapped = e->unlapped + 1; }
      }
      bool busy = false;
      for (Entry *e : live) if (e->unlap) { busy = true; break; }
      const bool lastLap = lead->lap >= r.laps - 1;
      // ...and the laps are done: counted on the LEADER from the moment the SC was called.
      const bool led = r.progress(*lead) - scFrom >= (scLaps - 1) * t.length;
      const bool ready = lastLap || (clear() && led && sinceP > PICKUP_MIN && (formed || sinceP > QUEUE_WAIT) && unlapCalled && !busy);
      if (ready && (lastLap || t.wrap(lane.entryS - sc.s) > 500)) {
        phase = RcPhase::In; phaseAt = now; sc.lights = false;
        rc("SAFETY CAR IN THIS LAP", "scIn");
      }
      break;
    }
    case RcPhase::In: {
      // Lights out: the safety car pulls away to the pit entry; the leader backs the queue up.
      const double d = t.wrap(lane.entryS - sc.s);
      if (!sc.inLane && (d < 3 || d > t.length - 30)) {
        sc.inLane = true; sc.prog = 0;
        phase = RcPhase::Restart; phaseAt = now;
        for (Entry &e : r.entries) { e.rcCross = false; e.went = false; }
        goD = 150 + rng() * 320;
      }
      break;
    }
    case RcPhase::Restart: {
      // The LEADER dictates. A bot leader picks its moment; you pick yours.
      if (!lead->isPlayer && !lead->went && t.wrap(0 - lead->proj.s) < goD) lead->went = true;
      if (lead->rcCross || now - phaseAt > 140) goGreen("TRACK CLEAR");
      break;
    }
    default: break;
  }
}

void Director::moveSC(double dt) {
  Race &r = *race;
  const Track &t = *r.track;
  const Lane &lane = r.lane;
  if (!sc.out) return;
  const Entry *lead = leader();
  double want;
  const bool inOrRestart = phase == RcPhase::In || phase == RcPhase::Restart;
  if (sc.inLane) {
    want = sc.prog > 0.72 && phase == RcPhase::Deploy ? 26 : PIT_SPEED;
    if (phase == RcPhase::Restart && sc.prog > 0.22) { sc.out = false; sc.inLane = false; return; }
  } else if (inOrRestart) {
    want = std::min(vLine(t.idx(sc.s)) * 0.82, 75.0);
  } else {
    want = scSpeed(t.idx(sc.s));
    // It waits for the leader: a queue is only a queue if it has a head.
    if (lead && !lead->inPit) {
      const double g = t.gap(sc.s, lead->proj.s);
      if (g > 160) want *= 0.7;
    }
  }
  // BRAKING POINTS: it looks 200 m up the road.
  if (!sc.inLane) {
    const auto vAt = [&](int j) { return inOrRestart ? std::min(vLine(j) * 0.82, 75.0) : scSpeed(j); };
    const int i0 = t.idx(sc.s), n = (int)jsRound(200 / t.ds);
    for (int k = 1; k <= n; k += 2) {
      const double va = vAt((i0 + k) % t.n);
      want = std::min(want, std::sqrt(va * va + 2 * 9 * k * t.ds));
    }
  }
  // It drives, it is not on rails: never into the back of a car on the road ahead of it.
  if (!sc.inLane) {
    for (const Entry &e : r.entries) {
      if (e.retired || e.inPit || e.finished) continue;
      const double g = t.gap(e.proj.s, sc.s);
      if (g > 0 && g < 60 && std::fabs(e.proj.lat - sc.lat) < 3.2) want = std::min(want, e.car.speed * std::min(1.0, (g - 8) / 30));
    }
  }
  const double a = want > sc.v ? 7 : -12;
  sc.v = std::max(0.0, a > 0 ? std::min(want, sc.v + a * dt) : std::max(want, sc.v + a * dt));
  Car &c = sc.car;
  const double ox = c.x, oy = c.y;
  if (sc.inLane) {
    sc.prog += sc.v * dt / std::max(1.0, lane.len);
    sc.s = t.wrap(lane.entryS + sc.prog * lane.len);
    sc.lat = laneLat(lane, sc.prog);
    if (sc.prog >= 0.995) sc.inLane = false;
  } else {
    sc.s = t.wrap(sc.s + sc.v * dt);
    // It holds its lane while a lapped car is coming past.
    bool passing = false;
    for (const Entry &e : r.entries)
      if (e.unlap && !e.retired && t.gap(sc.s, e.proj.s) > -8 && t.gap(sc.s, e.proj.s) < 160) { passing = true; break; }
    const double w = t.w[(size_t)t.idx(sc.s)] - 1.5;
    const double tgt = passing ? std::max(-w, std::min(w, sc.lat)) : r.lines->race.off[(size_t)t.idx(sc.s)];
    sc.lat += std::max(-2 * dt, std::min(2 * dt, tgt - sc.lat));
  }
  double px, py, ph;
  int pi;
  t.point(sc.s, sc.lat, px, py, ph, pi);
  sc.i = pi;
  c.x = px; c.y = py;
  const double dx = c.x - ox, dy = c.y - oy;
  c.hdg = std::hypot(dx, dy) > 0.02 && std::hypot(dx, dy) < 5 ? std::atan2(dy, dx) : ph;
  c.vx = sc.v; c.vy = 0; c.r = 0; c.speed = sc.v; c.z = 0;
}

// ---- the recovery truck -------------------------------------------------------------------
// Kinematic, like the safety car. It waits for the wreck to stop and the field to be gathered.
void Director::jobTick(double dt) {
  if (jobs.empty()) return;
  Race &r = *race;
  const Track &t = *r.track;
  const double now = r.time;
  const auto toward = [&](Truck &v, double x, double y, double sp) {
    const double dx = x - v.x, dy = y - v.y, d = std::hypot(dx, dy);
    if (d < sp * dt + 0.05) { v.x = x; v.y = y; return true; }
    v.hdg = std::atan2(dy, dx); v.x += dx / d * sp * dt; v.y += dy / d * sp * dt;
    return false;
  };
  for (Job &j : jobs) {
    Car &c = j.e->car;
    j.t += dt;
    switch (j.st) {
      case 0: {
        const bool safe = mode == RcMode::Red || mode == RcMode::Vsc
          ? now - since > TRUCK_AFTER
          : mode == RcMode::Sc && (phase == RcPhase::Lead || now - since > 45);
        if (!j.e->atRest || !safe) break;
        const Proj pr = t.project(c.x, c.y, j.e->hint, 8);
        const double side = sgn1(pr.lat);
        // The gap in the barrier: up the road, the wreck's side.
        double gx, gy, gh;
        int gi;
        t.point(pr.s - TRUCK_BACK, side * (pr.w + (pr.run != 0 ? pr.run : 8) + 4), gx, gy, gh, gi);
        j.gateX = gx; j.gateY = gy;
        j.truck = Truck{gx, gy, gh, true, false};
        j.hasTruck = true;
        // It stops a truck's length short of the car, on the line between them.
        double d = std::hypot(c.x - gx, c.y - gy);
        if (d == 0) d = 1;
        j.atX = c.x - (c.x - gx) / d * 7; j.atY = c.y - (c.y - gy) / d * 7;
        j.st = 1; j.t = 0;
        rc("RECOVERY VEHICLE ON TRACK", "truck", j.e);
        break;
      }
      case 1:
        if (toward(j.truck, j.atX, j.atY, TRUCK_V)) { j.st = 2; j.t = 0; }
        break;
      case 2:
        if (j.t > HOOK_T) { j.st = 3; j.t = 0; j.truck.towing = true; }
        break;
      case 3: {
        const bool home = toward(j.truck, j.gateX, j.gateY, TOW_V);
        // The car comes backwards on the hook, 7 m behind the truck.
        c.x = j.truck.x - std::cos(j.truck.hdg) * 7; c.y = j.truck.y - std::sin(j.truck.hdg) * 7;
        c.hdg = j.truck.hdg + PI; c.vx = 0.0001; c.vy = 0; c.r = 0; c.z = 0; c.pitch = 0; c.roll = 0;
        if (home) {
          j.st = 4; j.hasTruck = false; j.e->recovered = true;
          j.inc->clearAt = std::min(j.inc->clearAt, now);
          rc(tag(*j.e) + " RECOVERED", "recovered", j.e);
        }
        break;
      }
      default: break;
    }
  }
  jobs.erase(std::remove_if(jobs.begin(), jobs.end(), [](const Job &j) { return j.st == 4; }), jobs.end());
  vehicles.clear();
  for (const Job &j : jobs) if (j.hasTruck) vehicles.push_back(j.truck);
}

// Who is in the queue: close behind the car (or safety car) ahead.
void Director::queueTick() {
  if (mode != RcMode::Sc) return;
  Race &r = *race;
  const Track &t = *r.track;
  for (Entry &e : r.entries) {
    if (e.retired || e.inPit || e.finished) { e.queued = false; continue; }
    double gap = e.ahead ? t.gap(e.ahead->proj.s, e.proj.s) : INF;
    if (sc.out && !sc.inLane) { const double g = t.gap(sc.s, e.proj.s); if (g > 0 && g < gap) gap = g; }
    const bool q = gap < QUEUE_GAP && (phase != RcPhase::Deploy || (sc.out && !sc.inLane));
    e.queued = e.queued ? gap < QUEUE_GAP * 1.6 : q;
    if (e.queued) e.vd = std::min(e.vd, 0.0);
  }
}

// ---- red flag -------------------------------------------------------------------------------
void Director::redTick() {
  Race &r = *race;
  const double now = r.time;
  bool parked = true;
  for (Entry &e : r.entries) {
    if (e.retired || e.finished) continue;
    if (!e.inPit && !e.pitRequest) e.pitRequest = true;
  }
  for (Entry &e : r.entries) {
    if (e.retired || e.finished) continue;
    if (e.pitPhase != PitPhase::Service) { parked = false; break; }
  }
  if (std::isnan(parkedAt) && (parked || now - since > RED_WAIT)) {
    parkedAt = now;
    rc("RACE WILL RESUME — STANDING START", "redResume");
  }
  if (!std::isnan(parkedAt) && now - parkedAt > RED_HOLD) restartStanding();
}

// The grid again, in the red-flag order, with the laps that were complete.
void Director::restartStanding() {
  Race &r = *race;
  const Track &t = *r.track;
  std::vector<RedRow> order;
  for (const RedRow &x : redOrder) if (!x.e->retired) order.push_back(x);
  size_t k = 0;
  for (const RedRow &row : order) {
    if (k >= r.slots.size()) break;
    const Slot &slot = r.slots[k++];
    Entry &e = *row.e;
    Car &car = e.car;
    double px, py, ph;
    int pi;
    t.point(slot.s, slot.lat, px, py, ph, pi);
    car.x = px; car.y = py; car.hdg = slot.hdg;
    car.vx = 0.001; car.vy = 0; car.r = 0; car.speed = 0;
    car.throttle = 0; car.brake = 1; car.delta = 0;
    car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
    car.onRoof = false; car.airborne = false;
    e.inPit = false; e.pitPhase = PitPhase::None; e.pitRequest = false; e.pitTimer = 0;
    e.recover.on = false; e.stuck = 0; e.redFixed = false;
    e.proj = t.project(px, py); e.hint = e.proj.i; e.rcS = e.proj.s;
    e.lap = row.lap; e.crossed0 = false; e.pastHalf = false;
    e.biasS = slot.lat - r.lines->race.off[(size_t)t.idx(slot.s)]; e.merge = true;
    e.opening = true; e.zip = false; e.openLap = row.lap;
    e.build = 0; e.tryT = 0; e.atkOn = nullptr;
  }
  r.lane.hold = false;
  r.state = RaceState::Grid; r.lights = 5.2; r.gridAt = r.time;
  begin(RcMode::Green); phase = RcPhase::None; greenAt = r.time;
  count.restarts++;
  const Entry *lead = order.empty() ? nullptr : order[0].e;
  drsFrom = (lead ? lead->lap : 0) + 2;
  rc("STANDING START PROCEDURE", "standing");
}

// ---- blue flags -----------------------------------------------------------------------------
// A car a lap down, with the car lapping it within a second: show it the blue.
void Director::blueTick() {
  Race &r = *race;
  const double L = r.track->length;
  for (Entry &e : r.entries) {
    e.blue = nullptr;
    if (!(neutral() || e.retired || e.inPit || e.finished || r.state != RaceState::Green)) {
      Entry *o = e.behind;
      // MULTICLASS: a faster CLASS coming through is not a blue flag. The slower car
      // holds its line and the faster one finds the way round — moving a GT4 off the
      // line mid-corner for a prototype put it in the wall (measured, Zandvoort).
      const bool otherClass = r.multi && o && o->klass != e.klass;
      if (o && !otherClass && !o->inPit && !o->retired && e.behindGapT <= 1.0 && r.progress(*o) - r.progress(e) > L * 0.5) {
        e.blue = o; e.blueGap = -r.track->gap(o->proj.s, e.proj.s);
        if (e.blueSide == 0) e.blueSide = sgn1(e.proj.lat - o->proj.lat);
        e.blueAt = r.time;
      }
    }
    // The side is let go once the blues have been off for two seconds.
    if (!e.blue && e.blueSide != 0 && r.time - e.blueAt > 2) e.blueSide = 0;
  }
}

// ---- the rules only YOU can break -----------------------------------------------------------
void Director::youTick() {
  Race &r = *race;
  Entry *me = r.me;
  const double now = r.time;
  if (!me || me->retired || me->finished) return;
  const double P = r.progress(*me);

  // OVERTAKING. A place taken while a rule forbids it must be handed back within GIVE_BACK s.
  const char *rule = mode == RcMode::Sc ? (phase == RcPhase::Restart ? (me->rcCross ? nullptr : "restart") : "sc")
    : mode == RcMode::Vsc || mode == RcMode::VscEnd ? "vsc"
    : mode == RcMode::Red ? "red"
    : me->holdLine ? "restart"
    : yellowAt(me->proj.s) ? "yellow" : nullptr;
  for (Entry &o : r.entries) {
    if (&o == me) continue;
    const bool ahead = r.progress(o) > P;
    const int was = o.youAhead;
    o.youAhead = ahead ? 1 : 0;
    if (was < 0 || me->inPit) continue;
    // Fair: a car that has left the track, or is peeling off into the pits.
    const bool fair = o.retired || o.inPit || o.recover.on || o.unlap || o.car.speed < 8 || o.finished
      || std::fabs(o.proj.lat) > o.proj.w + 1 || o.pitPhase == PitPhase::Approach;
    bool already = false;
    for (const Owed &x : owed) if (x.o == &o) { already = true; break; }
    if (was == 1 && !ahead && rule && !fair && now - since > 3 && !already) {
      owed.push_back({&o, now, rule});
      rc(tag(*me) + " — GIVE THE POSITION BACK TO " + tag(o), "giveBack", me);
    }
  }
  {
    const std::vector<Owed> list = owed;
    owed.clear();
    for (const Owed &x : list) {
      if (x.o->retired || x.o->inPit || r.progress(*x.o) > P) continue;      // handed back, or moot
      if (now - x.t > GIVE_BACK) penalise(me, x.rule);
      else owed.push_back(x);
    }
  }

  // THE MINIMUM TIME. Faster than the delta for a while: a warning, then five.
  const double d = deltaFor(me);
  if (!std::isnan(d) && d < 0) {
    me->deltaBad = me->deltaBad + dt4;
    if (me->deltaBad > 1.5 && !me->deltaWarned) {
      me->deltaWarned = true;
      rc(tag(*me) + " — BELOW THE MINIMUM TIME: WARNING", "deltaWarn", me);
    }
    if (me->deltaBad > 5) { me->deltaBad = 0; penalise(me, "delta"); }
  }

  // BLUE FLAGS, one per marshal post you pass with them showing.
  if (me->blue) {
    const int k = sector(me->proj.s);
    if (me->blueFor != me->blue) {
      me->blueFor = me->blue; me->blueN = 1; me->blueSec = k;
      rc("BLUE FLAG FOR " + tag(*me), "blue", me);
    } else if (k != me->blueSec) {
      me->blueSec = k; me->blueN++;
      if (me->blueN == 2) rc("BLUE FLAG FOR " + tag(*me) + " — SECOND", "blue2", me);
      if (me->blueN == 3) penalise(me, "blue");
    }
    me->blueOff = now;
  } else if (me->blueFor && now - me->blueOff > 3) { me->blueFor = nullptr; me->blueN = 0; }

  // Ten car lengths behind the car in front, in the queue.
  if (mode == RcMode::Sc && phase == RcPhase::Lead && me->ahead && !me->inPit) {
    const double g = r.track->gap(me->ahead->proj.s, me->proj.s);
    if (g > r.spec->bodyL * 10 && g < 400 && me->wasQueued && now - (me->tenAt != 0 ? me->tenAt : -99) > 25) {
      me->tenAt = now;
      rc(tag(*me) + " — MORE THAN TEN CAR LENGTHS BEHIND THE CAR AHEAD", "ten", me);
    }
    if (me->queued) me->wasQueued = true;
  } else me->wasQueued = false;
}

// The race calls this on every entry to the pit lane...
void Director::pitEntry(Entry &e) {
  if (!on) return;
  if (!std::isnan(e.entryV) && e.entryV > PIT_SPEED + 0.8 && !e.driveThru) {
    rc(tag(e) + " CROSSED THE PIT ENTRY LINE AT " + std::to_string((long long)jsRound(e.entryV * 3.6)) + " KM/H", "speeding", &e);
    penalise(&e, "speeding");
  }
  if (neutral() && mode != RcMode::Red) { count.pitsUnder++; e.pitUnderT = race->time; }
}
// ...and on every release from a box.
void Director::released(Entry &e) {
  if (!on) return;
  if (e.unsafe) { e.unsafe = false; penalise(&e, "unsafe"); }
}

void Director::penalise(Entry *e, const char *kind) {
  const Pen *p = nullptr;
  for (const Pen &x : PEN) if (std::string(x.kind) == kind) { p = &x; break; }
  if (!p || !e) return;
  count.pens++;
  if (p->dt) {
    e->driveThru = e->driveThru + 1;
    if (!e->isPlayer) e->pitRequest = true;
    race->log("penalty", "FIA STEWARDS: DRIVE THROUGH PENALTY FOR " + tag(*e) + " — " + p->why, e, "dt");
  } else {
    e->penalty += p->sec;
    const std::string sec = std::to_string(p->sec);
    race->log("penalty", "FIA STEWARDS: " + sec + " SECOND TIME PENALTY FOR " + tag(*e) + " — " + p->why, e, ("pen" + sec).c_str());
  }
}

// ---- rain -----------------------------------------------------------------------------------
// A downpour that ARRIVES mid-race is a red flag, once.
void Director::rainTick() {
  Race &r = *race;
  const double wet = (1 - wetGrip()) / 0.22;
  if (std::isnan(wet0)) { if (r.state == RaceState::Green) wet0 = wet; return; }
  if (!rainRed && wet0 < 0.8 && wet > 0.95 && mode != RcMode::Red) {
    rainT = rainT + dt4;
    if (rainT > 15) {
      rainRed = true;
      Entry *lead = leader();
      if (lead) incident("rain", lead);
    }
  } else rainT = 0;
}

}  // namespace xbr
