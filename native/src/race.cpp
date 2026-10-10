// race.cpp — js/race.js, ported line for line: same arithmetic, same order,
// same rng draws. The long comments that say WHY a rule is the way it is live
// in the JS file, next to the same code; the short ones here point at them.
//
// Do not tidy this file against the JS. A reordered sum is a different race.
#include <cstdlib>
#include "race.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace xbr {

static const double INF = std::numeric_limits<double>::infinity();

static const int NEIGH_EVERY = 4;          // substeps between neighbour/racecraft updates
static const double PUSH_TIME = 8;         // s for a crew to heave a car back to the tarmac
static const double BAND_EVERY = 0.5;      // s between OVERTAKES band updates
// SUPERCASUAL's leash (see band()).
static const double LEASH_FROM = 2.5, LEASH_SLOPE = 0.15, LEASH_MIN = 0.62;
static const double MERGE_RATE = 0.55;     // m/s a car drifts from its grid box to the line
// The formation: under a metre between cars, nose to tail and side to side.
static const double FORM_GAP = 0.9, FORM_SIDE = (2.0 + FORM_GAP) / 2;
static const double FORM_PACE = 17.9;      // m/s: 40 mph
// WHAT THE ROAD IS MADE OF, where a track says: tarmac, gravel, packed snow.
static const double ROAD_MU[3] = {1.0, 0.8, 0.62}, ROAD_DRAG[3] = {1, 1.5, 1.3}, ROAD_HOLD[3] = {1, 0.74, 0.62};
// THE OPENING CORNERS.
static const double OPEN_AFTER = 120, OPEN_T = 0.22, OPEN_PAIR = 0.55;
// THE DUEL (js/race.js, at length).
static const int DUEL_N = 3;
static const double DUEL_GAP = 0.55, DUEL_STEP = 0.75, DUEL_FREEZE = 0.45;
static const double K_WAIT = 0.05, K_FIRM = 0.005, K_CHASE = 0.012;
static const double DUEL_DOWN = 0.05, DUEL_UP = 0.025;
static const double TIER_DOWN = 0.11, TIER_UP = 0.05;
static const double DUEL_SLACK = 0.6, DUEL_DOWN_FAR = 0.18;
static const double PUNISH_T = 4;
static const double BUILD_T = 10, TRY_T = 9;
static const double DEF_LUNGE = 0.45;
static const double DRS_GAP = 1.0;
static const int DRS_FROM_LAP = 1;
static const double DRS_CURV = 1.0 / 280;
static const double CHEER_HOLD = 2.0;
static const double SERVICE_PIT_LEN = 60;  // `lane.len > 60`: a lane long enough to be one

static double sgn1(double v) { const double s = sign(v); return s != 0 ? s : 1; }
static double orInf(double v) { return std::isnan(v) ? INF : v; }
static double capMin(double cap, double v) { return std::min(orInf(cap), v); }   // Math.min(cap ?? Infinity, v)
static std::string fix1(double v) { char b[48]; std::snprintf(b, sizeof b, "%.1f", v); return b; }

const Battle *battleFor(const std::string &key) {
  static const Battle B[] = {
    {"easy", "EASY", 0.74, 0.88, 0.45, 0.45, 2.4, 0.03, 220, 1.2, 0.72},
    {"medium", "MEDIUM", 0.80, 0.96, 0.72, 0.72, 1.5, 0.06, 170, 0.9, 0.78},
    {"hard", "HARD", 0.86, 1.01, 0.95, 0.95, 0.9, 0.09, 130, 0.6, 0.86},
  };
  for (const Battle &b : B) if (key == b.key) return &b;
  return nullptr;
}

const char *raceStateName(RaceState s) {
  switch (s) {
    case RaceState::Grid: return "grid";
    case RaceState::Formation: return "formation";
    case RaceState::Green: return "green";
    case RaceState::Finish: return "finish";
    default: return "over";
  }
}

// ---- the wake, in TRACK space (js/aero.js wakeAt) ---------------------------------
static bool wakeAt(double &dirty, double &tow, double gap, double off, const Spec &leadSpec) {
  const double SPREAD = 0.085, REACH = 22.0;
  if (gap <= 0.5 || gap > 90) { dirty = 0; tow = 0; return false; }
  const double halfW = leadSpec.bodyW * 0.5 + gap * SPREAD;
  const double side = off < 0 ? -off : off;
  if (side >= halfW) { dirty = 0; tow = 0; return false; }
  const double t = side / halfW;
  const double lat = 1 - t * t;
  const double decay = 1 / std::pow(1 + gap / REACH, 1.5);
  double core = decay * lat * (leadSpec.CdA / 1.28);
  if (core > 1) core = 1;
  dirty = core; tow = core;
  return true;
}

// ---- the ground (js/terrain.js) -----------------------------------------------------
static const double AX = 1.35, AY = 0.80;      // half the wheelbase and half the track, near enough

Ground::Ground(const Track &track, std::function<double(double)> ry) : t(track), roadY(std::move(ry)) {
  bool any = false;
  for (double b : t.bank) if (b != 0 && !std::isnan(b)) { any = true; break; }
  if (any) table = bankTable(t);
}

double Ground::h(double s, double lat) const {
  double y = roadY ? roadY(s) : 0;
  if (!table.empty()) {
    const double n = t.n;
    const double f = std::fmod(std::fmod(s / t.ds, n) + n, n);
    const int i = (int)std::floor(f), j = (i + 1) % t.n;
    const double k = f - i;
    y += bankY(table, t, i, lat) * (1 - k) + bankY(table, t, j, lat) * k;
  }
  return y;
}

// The plane under the four wheels, written to g (which carries last tick's).
void Ground::under(const Car &car, const Proj &pr, Gnd &g) const {
  const double th = car.hdg - t.hdg[(size_t)pr.i], c = std::cos(th), s = std::sin(th);
  const auto H = [&](double fx, double fy) { return h(pr.s + fx * c - fy * s, pr.lat + fx * s + fy * c); };
  const double fl = H(AX, AY), fr = H(AX, -AY), rl = H(-AX, AY), rr = H(-AX, -AY);
  g.dPitch = -g.pitch; g.dRoll = -g.roll;
  g.gx = (fl + fr - rl - rr) / (4 * AX);            // rise per metre forward
  g.gy = (fl + rl - fr - rr) / (4 * AY);            // rise per metre to the left
  g.pitch = std::atan(g.gx); g.roll = std::atan(g.gy);
  g.dPitch += g.pitch; g.dRoll += g.roll;           // how far the ground turned under it this tick
  g.bank = std::fabs(g.roll) * 180 / PI; g.dir = -sign(g.gy);   // high side right pushes it left
}

double Ground::lift(const Car &car, const Proj &pr) const {
  const double v = std::hypot(car.vx, car.vy);
  if (v < 1) return 0;
  const double th = car.hdg + std::atan2(car.vy, car.vx) - t.hdg[(size_t)pr.i];
  const double d = std::max(3.0, v * 0.06), ds = std::cos(th) * d, dl = std::sin(th) * d;
  return -v * v * (h(pr.s + ds, pr.lat + dl) - 2 * h(pr.s, pr.lat) + h(pr.s - ds, pr.lat - dl)) / (d * d);
}

std::function<double(double)> heightFromSlope(const Track &track, const std::function<double(double)> &slopeAt) {
  const int n = track.n;
  const double ds = track.ds;
  auto H = std::make_shared<std::vector<double>>((size_t)n + 1, 0.0);
  for (int i = 0; i < n; i++) (*H)[(size_t)i + 1] = (*H)[(size_t)i] + slopeAt((i + 0.5) * ds) * ds;
  const double drift = (*H)[(size_t)n] / n;         // a lap ends where it began
  for (int i = 0; i <= n; i++) (*H)[(size_t)i] -= drift * i;
  return [H, n, ds](double s) {
    const double f = std::fmod(std::fmod(s / ds, (double)n) + n, (double)n);
    const int i = (int)std::floor(f);
    return (*H)[(size_t)i] + ((*H)[(size_t)i + 1] - (*H)[(size_t)i]) * (f - i);
  };
}

// ======================================================================================
Race::Race(const RaceOptions &o)
    : track(o.track), lines(o.lines), spec(o.spec), standIn(o.standIn), sideLock(o.sideLock), styles(o.styles),
      openOn(o.opening), xingus(o.xingus), noDnf(o.noDnf), timeLimit(o.timeLimit), laps(o.laps), slots(o.slots), pits(o.pits), seed(o.seed) {
  const Track &t = *track;
  // XINGUS MODE and its STYLES: which tune the car wears, whether anybody else
  // is out there, whether the others have stopped being careful.
  xcar = o.xopt.car;
  xsolo = xingus && o.xopt.solo;
  derby = xingus && o.xopt.derby;
  // RALLYCROSS HAS NO LINE AND NO MANNERS: `loose`. The derby is loose too.
  loose = xingus && (derby || o.xopt.loose);
  // THE JOKER LAP: a track may carry `detours`, a road that forks off the lap and rejoins it.
  for (const Detour &d : t.detours) {
    Fork F;
    F.d = &d;
    for (size_t k = 0; k + 1 < d.pts.size(); k++) {
      const auto &a = d.pts[k], &b = d.pts[k + 1];
      const int n = (int)std::max(1.0, std::ceil(std::hypot(b.first - a.first, b.second - a.second) / 2));
      for (int q = 0; q < n; q++) F.P.push_back({a.first + (b.first - a.first) * q / n, a.second + (b.second - a.second) * q / n});
    }
    F.P.push_back({d.pts.back().first, d.pts.back().second});
    F.cum.push_back(0);
    for (size_t k = 1; k < F.P.size(); k++) F.cum.push_back(F.cum[k - 1] + std::hypot(F.P[k][0] - F.P[k - 1][0], F.P[k][1] - F.P[k - 1][1]));
    F.len = F.cum.back();
    detours.push_back(std::move(F));
  }
  // Wherever there is a fork the rule is ON: one lap through it each, or no finish.
  jokerRule = !detours.empty() && o.xopt.joker;
  // STOCK RULES (an oval): a set of tyres is good for a STINT, a third of the race.
  stock = t.stock;
  stockStint = (int)std::max(3.0, std::min(25.0, jsRound(laps / 3.0)));
  xstakes = xingus && o.xopt.stakes;
  {
    const auto &c = t.corners;
    size_t k = 0;
    while (k + 1 < c.size() && k < 3 && c[k + 1].s0 - c[k].s1 < 250) k++;
    openEnd = !c.empty() ? c[k].s1 + OPEN_AFTER : 600;
  }
  for (const auto &s : o.seats) if (s.klass != o.seats[0].klass) multi = true;
  real = o.real;
  duel = o.duel;
  drsRule = o.drs && o.duel && spec->drs;
  peak = peakSlip(*spec);
  time = 0; state = RaceState::Grid; lights = 3.2;
  safety = 0;
  // The pit lane, made once per session: a path with an entry, an exit and a box per car.
  lane = makeLane(t, std::min(o.grid, (int)slots.size()));
  sub = 0;
  battle = battleFor(o.battle);
  bandAt = 0;
  {
    double sum = 0;
    for (float f : lines->race.v.d) sum += (double)f;
    vRef = sum / (double)lines->race.v.size();
  }

  const int n = xsolo ? 1 : std::min(o.grid, (int)slots.size());
  int playerGrid = o.playerGrid;
  if (xsolo) playerGrid = 1;
  const int nCorners = t.corners.empty() ? 24 : (int)t.corners.size();
  for (int k = 0; k < n; k++) {
    const Slot &slot = slots[(size_t)k];
    // QUALIFYING hands over `order`: grid slot -> driver index, -1 for you.
    const bool isPlayer = o.hasOrder ? o.order[(size_t)k] == -1 : o.player && k == std::min(playerGrid, n) - 1;
    // The roster is everyone BUT you, so the cars behind your slot take the next driver along.
    const int pIdx = !o.hasOrder && o.player ? std::min(playerGrid, n) - 1 : -1;
    const int who = o.hasOrder ? std::max(0, o.order[(size_t)k]) : (pIdx >= 0 && k > pIdx ? k - 1 : k);
    entries.emplace_back();
    Entry &e = entries.back();
    // MULTICLASS: this slot's own car and the line solved for it
    const bool seated = (size_t)k < o.seats.size() && o.seats[(size_t)k].spec && o.seats[(size_t)k].lines;
    Spec *es = seated ? o.seats[(size_t)k].spec : spec;
    e.lines = seated ? o.seats[(size_t)k].lines : lines;
    e.klass = (size_t)k < o.seats.size() ? o.seats[(size_t)k].klass : 0;      // a seat with no car in it is YOURS: the race's own spec and line
    e.car = makeCar(es->key);
    // a rival's car (proSpec) shares its class's key: hand it the spec itself, and the constants rather than the player's aero map
    if (es->pro) { e.car.spec = es; e.car.aero = nullptr; }
    Car &car = e.car;
    double px, py, ph;
    int pi;
    t.point(slot.s, slot.lat, px, py, ph, pi);
    car.x = px; car.y = py; car.hdg = slot.hdg; car.vx = 0.001;
    if (xingus && isPlayer && !standIn) xingusCar(car, xcar, xstakes);
    // WHO this is, WHAT they drive, and HOW they drive it — one table.
    const DriverProfile &prof = driverAt(who);
    const Team &team = teamOf(prof);
    // REAL — SOME CARS ARE BETTER THAN OTHERS (physics.hpp proSpecAt). The car is the TEAM's:
    // where its pace stands among the teams of its league puts it on a curve — one in ten has
    // the best engine, one in ten the worst, a third are ordinary.
    static const bool SAME_CARS = std::getenv("XBR_SAMECARS") != nullptr;      // A/B: every rival in the ordinary car
    if (real && !SAME_CARS && !isPlayer && es->pro) {
      int better = 0, nt = 0;
      for (const Team &q : allTeams()) if (q.league == team.league) { nt++; if (q.pace > team.pace) better++; }
      const double p = nt > 1 ? (double)better / (nt - 1) : 0.5;
      const int lv = p < 0.10 ? 0 : p < 0.32 ? 1 : p < 0.68 ? 2 : p < 0.90 ? 3 : 4;
      if (lv != 2) {
        Spec *ts = &proSpecAt(es->key, lv);
        auto &L = carLines[ts];
        if (!L) { L = std::make_unique<Lines>(buildLines(t, *ts)); L->track = &t; }
        es = ts; e.lines = L.get(); e.car.spec = ts;
      }
    }
    if (isPlayer) {
      if (standIn) { e.driver = makeDriver(seed * 17 + 3, o.tier, nCorners); e.hasDriver = true; }
    } else {
      e.driver = makeDriver(seed * 131 + who, o.tier, nCorners);
      applyProfile(e.driver, prof, team);
      e.hasDriver = true;
      // REAL — THE GRID IS LEAGUES APART (Adam: "getting ahead should feel like im in the
      // big leageus now"). Where you start is how good you are: the front of each class
      // drives at the ceiling, and it falls away behind, gently through the top five and
      // then steeply. The difficulty moves the whole grid, never one end of it.
      if (real) {
        int nk = 0, rk = 0;                                     // cars in this car's class, and how many of them start ahead of it
        for (int q = 0; q < n; q++) {
          const int kq = (size_t)q < o.seats.size() ? o.seats[(size_t)q].klass : 0;
          if (kq == e.klass) { nk++; if (q < k) rk++; }
        }
        const std::string &tk = e.driver.tier;
        const double base = tk == "hard" ? 1.0 : tk == "medium" ? 0.88 : tk == "casual" ? 0.76 : 0.64;
        static const bool REV = std::getenv("XBR_REVGRID") != nullptr;      // a test: the fastest start LAST, so the whole field has someone to pass
        static const bool FASTLAST = std::getenv("XBR_FASTLAST") != nullptr;      // a test: the grid as it is, and the LAST car as fast as the first
        const double r0 = nk > 1 ? (double)rk / (nk - 1) : 0, r = FASTLAST && k == n - 1 ? 0 : REV ? 1 - r0 : r0;
        e.driver.gripFrac = base * (1 - 0.32 * std::pow(r, 1.25));      // 0.32: last is ~7% a lap off first (measured: lap time barely moves with grip near the ceiling, steeply far below it)
        e.driver.paceMul = NaN;
      }
    }
    e.isPlayer = isPlayer; e.idx = k; e.box = k;
    e.name = isPlayer ? "YOU" : prof.n;
    e.num = isPlayer ? 78 : prof.num;
    e.col = isPlayer ? (o.playerTeam ? o.playerTeam->col : "#ffffff") : team.col;
    e.team = isPlayer ? o.playerTeam : &team;
    // Your teammate: the other car of the team you drive for.
    e.mate = !isPlayer && o.playerTeam && &team == o.playerTeam;
    if (!isPlayer) e.drive = std::make_unique<Autopilot>(t, *e.lines, *es, seated ? peakSlip(*es) : peak, &e.driver);
    // Where this car sits relative to the racing line on the grid: the lateral
    // target STARTS at the grid box and drifts to the line after the lights.
    e.biasS = slot.lat - lines->race.off[(size_t)t.idx(slot.s)]; e.merge = true;
    e.proj = t.project(px, py); e.hint = slot.i;
    e.gridPos = k + 1; e.pos = k + 1;
    e.jokerLap = 1 + std::fmod(k * 7 + seed, (double)std::max(1, laps - 1));
  }
  // THE GARAGES: a team's two cars share its garage, in the order the teams
  // first appear on the grid. YOU get the spare garage at the end of the row.
  if (lane.garages) {
    const int G = lane.garages;
    std::vector<std::string> keys;                 // garageOf, in insertion order
    std::vector<int> garageOf;
    std::vector<int> used((size_t)G, 0);
    for (Entry &e : entries) {
      if (e.isPlayer && !e.team) continue;
      const std::string key = e.team ? e.team->name : e.name;
      size_t at = 0;
      while (at < keys.size() && keys[at] != key) at++;
      if (at == keys.size()) { keys.push_back(key); garageOf.push_back((int)(keys.size() - 1) % G); }
      const int g = garageOf[at], j = used[(size_t)g];
      used[(size_t)g] = j + 1;
      e.box = g * 2 + (j % 2);
      if (e.isPlayer) e.garage = g;
    }
    for (Entry &e : entries) {
      if (!(e.isPlayer && !e.team)) continue;
      const int spare = (int)keys.size() < G ? (int)keys.size() : G - 1;
      e.box = spare * 2 + (used[(size_t)spare] ? 1 : 0);
      e.garage = spare;
      break;
    }
  }
  for (Entry &e : entries) if (e.isPlayer) { me = &e; break; }
  // OUT OF THE PITS IN FIVES, A FORMATION LAP, A ROLLING START (an oval's stock rules).
  rolling = stock && pits && lane.len > SERVICE_PIT_LEN && lane.garages > 0 && o.xopt.rolling;
  if (rolling) {
    state = RaceState::Formation;
    const double sg = sgn1(lane.off);
    const int per = lane.garages * 2;
    const auto alongOf = [&](int box) { return std::fmod(std::fmod(lane.boxS(box) - lane.entryS, t.length) + t.length, t.length); };
    // YOUR BOX IS ANYBODY'S: you swap boxes with a rival picked at random — and
    // again if that still leaves you nearest the exit.
    std::vector<double> layer;
    for (size_t k = 0; k < entries.size(); k++) layer.push_back(std::floor((double)k / per));
    if (me && entries.size() > 2) {
      Mulberry rng(seed * 613 + 29);
      const size_t m = (size_t)me->idx;
      for (int tries = 0; tries < 12; tries++) {
        const size_t j = (size_t)std::floor(rng() * (double)entries.size());
        Entry &other = entries[j];
        if (j == m) continue;
        std::swap(me->box, other.box); std::swap(me->garage, other.garage);
        std::swap(layer[m], layer[j]);
        const double mine = alongOf(me->box) - layer[m] * 1e-3;
        bool some = false;
        for (size_t k = 0; k < entries.size(); k++)
          if (&entries[k] != me && alongOf(entries[k].box) - layer[k] * 1e-3 > mine) { some = true; break; }
        if (some) break;
      }
    }
    for (size_t k = 0; k < entries.size(); k++) {
      Entry &e = entries[k];
      const double s = lane.boxS(e.box);
      const int i = t.idx(s);
      double px, py, ph;
      int pi;
      t.point(s, lane.off + sg * (BOX_SIDE + layer[k] * 4.6), px, py, ph, pi);
      e.car.x = px; e.car.y = py; e.car.hdg = t.hdg[(size_t)i]; e.car.vx = 0.001; e.hint = i;
      e.inPit = true; e.pitPhase = PitPhase::Service; e.pitJobs.clear(); e.formK = (int)k;
      e.formAlong = std::fmod(std::fmod(s - lane.entryS, t.length) + t.length, t.length);   // how far down the lane its box is
    }
    // Five every ten seconds, the five nearest the pit EXIT first, two seconds apart within a five.
    std::vector<Entry *> byExit;
    for (Entry &e : entries) byExit.push_back(&e);
    std::stable_sort(byExit.begin(), byExit.end(), [](const Entry *a, const Entry *b) { return b->formAlong - a->formAlong < 0; });
    for (size_t r = 0; r < byExit.size(); r++) {
      Entry &e = *byExit[r];
      e.pitTimer = 4 + std::floor((double)r / 5) * 10 + (double)(r % 5) * 2; e.formR = (int)r;
      if (!r) formLead = &e;
    }
  }
  if (battle) {
    const Battle &B = *battle;
    Mulberry rng(seed * 977 + 5);
    for (Entry &e : entries) {
      if (!e.hasDriver) continue;
      Driver &d = e.driver;
      // Everyone knows the racing line now; what stays personal is how bold they are.
      d.lineKind = "race";
      d.aggression = std::min(1.0, B.aggression * (0.8 + rng() * 0.4));
      d.defence = std::min(1.0, B.defence * (0.8 + rng() * 0.4));
      d.moveGap = B.moveGap;
      d.lungeMax = B.lunge;
      // Their mistake RATE and their wobble come from the submode.
      const double r = B.mistakes / d.T->mistakes;
      d.errScale = (std::isnan(d.errScale) ? 1 : d.errScale) * r;
      d.nextMistake /= std::max(0.2, r);
      d.consistency = B.consistency;
    }
    band();
  }
  // Pace matching around you happens in every tier when you are racing.
  duelOn = duel && me != nullptr;
  order();
  if (real) cast();                    // who thinks how (brain.cpp)
  // RACE CONTROL. `rules: false` is the race before it; Xingus has none at all.
  rc.init(this, o.rules && !xingus, Mulberry(seed * 7919 + 11));
  sideRng = Mulberry(seed * 313 + 5);
}

// ---- the OVERTAKES band ------------------------------------------------------------
// Where in its grip window each rival drives, from how far it is from you.
void Race::band() {
  // REAL: no rubber band (Adam: "cars arent slowing down to battle u theyre speeding up to
  // catch the next car, theyre motivated to win"). Nobody's grip is trimmed toward you, nobody
  // far ahead is held on a leash, and your going off does not wake the field up.
  if (real) return;
  const Battle *B = battle;
  const bool hasMe = me && !me->retired;
  const double pMe = hasMe ? progress(*me) : 0;
  // Who is next to you, counted outward: only these get the duel trim.
  const bool duelNow = duelOn && hasMe && state == RaceState::Green && time > 8;
  if (duelNow) rankAroundMe(pMe);
  const bool punish = hasMe && state == RaceState::Green && time - (std::isnan(meOffAt) ? -1e9 : meOffAt) < PUNISH_T;
  for (Entry &e : entries) {
    if (!e.hasDriver || e.retired || !e.drive) continue;      // `d.ceiling == null`: no autopilot ever resolved it
    Driver &d = e.driver;
    if (!B) {
      // MEDIUM, HARD, CASUAL: only the neighbours are touched, and only inside their own grip.
      if (punish && !e.inPit) {
        // Off the road is an open door: everybody goes for it, flat out.
        const double own = d.grip / d.ceiling;
        e.duelF = std::min(1.0, own + TIER_UP);
        d.gripNow = d.ceiling * e.duelF;
        e.hold = 1;
      } else if (duelNow && e.rank && std::abs(e.rank) <= DUEL_N && !e.inPit) {
        const double own = d.grip / d.ceiling;
        if (std::isnan(e.duelF)) e.duelF = own;
        duelTrim(e, own - TIER_DOWN, std::min(1.0, own + TIER_UP));
        d.gripNow = d.ceiling * e.duelF;
      } else if (!std::isnan(d.gripNow)) { d.gripNow = NaN; e.duelF = NaN; }
      continue;
    }
    const double behindYou = !hasMe ? 0 : pMe - progress(e);
    const double f = std::max(0.0, std::min(1.0, 0.5 + behindYou / (2 * B->band)));
    // The band sets WHERE in the window; the car and the driver still set the order inside it.
    double frac = B->lo + (B->hi - B->lo) * f;
    // Near you the distance band hands over to the duel.
    if (duelNow && e.rank && std::abs(e.rank) <= DUEL_N && !e.inPit) {
      if (std::isnan(e.duelF)) e.duelF = frac;
      // A car that got away because YOU erred may go further down than the window.
      const bool far = e.rank > 0 && e.gapMe > DUEL_GAP + DUEL_STEP * (e.rank - 1) + DUEL_SLACK;
      duelTrim(e, B->lo - (far ? DUEL_DOWN_FAR : DUEL_DOWN), B->hi);
      frac = e.duelF;
    } else e.duelF = NaN;
    if (punish && !e.inPit) { frac = B->hi; e.duelF = frac; }
    d.gripNow = d.ceiling * frac * (std::isnan(d.paceMul) ? 1 : d.paceMul);
    // THE LEASH: a rival more than LEASH_FROM seconds ahead of you drives to a lower target speed.
    const double aheadT = !hasMe ? 0 : -behindYou / vRef;
    // THE DUEL'S LEASH is shorter.
    const double from = duelNow && e.rank > 0 && e.rank <= DUEL_N
      ? std::min(LEASH_FROM, DUEL_GAP + DUEL_STEP * (e.rank - 1) + DUEL_SLACK) : LEASH_FROM;
    e.hold = punish ? 1 : aheadT > from ? std::max(LEASH_MIN, 1 - (aheadT - from) * LEASH_SLOPE) : 1;
  }
}

// The nearest car ahead within `gate` metres laterally and 150 m along.
Entry *Race::laneAhead(Entry &e, double gate) {
  Entry *best = nullptr;
  double bd = 150;
  for (Entry &o : entries) {
    if (&o == &e || o.retired || o.inPit) continue;
    const double ds = track->gap(o.proj.s, e.proj.s);
    if (ds > 0 && ds < bd && std::fabs(o.proj.lat - e.proj.lat) < gate) { bd = ds; best = &o; }
  }
  return best;
}

// e.rank = +1 for the car directly ahead of you, -1 directly behind, 0 for nobody near enough.
void Race::rankAroundMe(double pMe) {
  std::vector<Entry *> up, down;
  for (Entry &e : entries) {
    e.rank = 0;
    if (e.isPlayer || e.retired || e.inPit || e.finished) continue;
    e.gapMe = (progress(e) - pMe) / vRef;
    (e.gapMe > 0 ? up : down).push_back(&e);
  }
  std::stable_sort(up.begin(), up.end(), [](const Entry *a, const Entry *b) { return a->gapMe - b->gapMe < 0; });
  for (size_t k = 0; k < up.size(); k++) up[k]->rank = (int)k + 1;
  std::stable_sort(down.begin(), down.end(), [](const Entry *a, const Entry *b) { return b->gapMe - a->gapMe < 0; });
  for (size_t k = 0; k < down.size(); k++) down[k]->rank = -((int)k + 1);
}

// One step of the duel trim on e.duelF, kept inside [lo, hi].
void Race::duelTrim(Entry &e, double lo, double hi) {
  const int k = e.rank;
  const double gap = e.gapMe;
  const double want = sign(k) * (DUEL_GAP + DUEL_STEP * (std::abs(k) - 1));
  const double err = std::max(-2.0, std::min(2.0, gap - want));   // + = further up the road than wanted
  if (std::fabs(gap) > DUEL_FREEZE) {
    const double rate = k > 0 ? (err > 0 ? K_WAIT : K_FIRM) : (err < 0 ? K_CHASE : K_FIRM);
    e.duelF -= rate * err * BAND_EVERY;
  }
  e.duelF = std::max(lo, std::min(hi, e.duelF));
}

// Which way the next real corner turns within `look` metres: +1 left, -1 right, 0 nothing.
double Race::insideAhead(double s, double look) const {
  const F32 &cur = lines->race.cur;
  const Track &t = *track;
  const int i0 = t.idx(s);
  double turn = 0;
  for (int k = 0; k < look / t.ds; k++) turn += cur[(size_t)((i0 + k) % t.n)] * t.ds;
  return std::fabs(turn) > 0.35 ? sign(turn) : 0;
}

void Race::log(const char *kind, const std::string &text, const Entry *e, const char *code) {
  events.push_back(RaceEvent{time, kind, text, e ? e->idx : -1, code ? code : ""});
  if (onEvent) onEvent(events.back());
  if (events.size() > 300) events.pop_front();
}

void Race::order() {
  std::vector<int> was;
  was.reserve(entries.size());
  for (const Entry &e : entries) was.push_back(e.pos);
  standings.clear();
  for (Entry &e : entries) standings.push_back(&e);
  std::stable_sort(standings.begin(), standings.end(), [this](const Entry *a, const Entry *b) {
    if (a->finished != b->finished) return a->finished;
    // Penalties are applied at the flag.
    if (a->finished && b->finished) return (a->finishTime + a->penalty) - (b->finishTime + b->penalty) < 0;
    return progress(*b) - progress(*a) < 0;
  });
  for (size_t i = 0; i < standings.size(); i++) standings[i]->pos = (int)i + 1;

  // Count passes: the metric that says whether they are RACING or merely queueing. Debounced.
  if (state == RaceState::Green && time > 6) {
    for (size_t k = 0; k < entries.size(); k++) {
      Entry &e = entries[k];
      if (e.pos < was[k] && !e.retired && time - (e.lastPass != 0 ? e.lastPass : -99) > 2) {
        e.lastPass = time;
        e.passes = e.passes + 1;
        passes = passes + 1;
      }
    }
  }
}

// ---- who is near whom, and what that does to the air ---------------------------------
void Race::neighbours() {
  const Track &t = *track;
  double wDirty = 0, wTow = 0;
  for (Entry &e : entries) {
    e.ahead = nullptr; e.behind = nullptr; e.aheadGapT = 99; e.behindGapT = 99;
    double dirty = 0, tow = 0, bestA = 1e9, bestB = 1e9;
    // A car in the pit lane is in a different corridor: not traffic, and not air.
    if (e.inPit) { e.car.dirty = 0; e.car.tow = 0; continue; }
    for (Entry &o : entries) {
      if (&o == &e || o.retired || o.inPit) continue;
      const double ds = t.gap(o.proj.s, e.proj.s);
      const double dl = std::fabs(o.proj.lat - e.proj.lat);
      if (ds > 0 && ds < 90) {
        // One wake, not two effects: dirty air and the tow come from one call.
        if (wakeAt(wDirty, wTow, ds, dl, *o.car.spec)) {
          if (wDirty > dirty) dirty = wDirty;
          if (wTow > tow) tow = wTow;
        }
      }
      if (ds > 0 && ds < bestA) { bestA = ds; e.ahead = &o; e.aheadGapT = ds / std::max(e.car.speed, 12.0); }
      if (ds < 0 && -ds < bestB) { bestB = -ds; e.behind = &o; e.behindGapT = -ds / std::max(o.car.speed, 12.0); }
    }
    // REAL: the wake here is a single-seater's — half the front downforce gone at two car lengths.
    // A GT car makes a fraction of its grip from wings and follows another nose to tail; with the
    // full penalty a car eight seconds a lap quicker could not stay close enough to try a move.
    // The tow is left whole: that is how a GT car passes.
    if (real && e.car.spec->gt) dirty *= 0.25;
    e.car.dirty = dirty; e.car.tow = tow;
  }
}

// Is there a big braking zone within `look` metres?
bool Race::brakingZone(double s, double look) const {
  const F32 &v = lines->race.v;
  const Track &t = *track;
  const int i0 = t.idx(s);
  double vmin = INF;
  for (int k = 0; k < look / t.ds; k++) vmin = std::min(vmin, v[(size_t)((i0 + k) % t.n)]);
  return vmin < v[(size_t)i0] * 0.86;
}

// THE GROUND: one surface, made when the road's gradient has arrived.
const Ground &Race::ground() {
  if (!gnd_ || gndSlope_ != (bool)slopeAt) {
    gndSlope_ = (bool)slopeAt;
    gnd_ = std::make_unique<Ground>(*track, slopeAt ? heightFromSlope(*track, slopeAt) : nullptr);
    crestOk_ = false;
  }
  return *gnd_;
}

// How fast each metre of the lap can be taken without the road dropping away
// faster than a car can fall, braked for from far enough back to make it.
const std::vector<float> *Race::crests() {
  if (!slopeAt) return nullptr;
  const Ground &T = ground();
  if (!crestOk_) {
    crestOk_ = true;
    const Track &t = *track;
    const int n = t.n;
    const double d = 6;
    std::vector<float> v((size_t)n, 999.f);
    bool any = false;
    for (int i = 0; i < n; i++) {
      const double s = i * t.ds, k = -(T.h(s + d, 0) - 2 * T.h(s, 0) + T.h(s - d, 0)) / (d * d);   // 1/m, + = a crest
      if (k > 9.81 * 1.15 / (95.0 * 95)) { v[(size_t)i] = (float)std::sqrt(9.81 * 1.15 / k); any = true; }
    }
    if (any)
      for (int k = 2 * n; k >= 0; k--) {
        const int i = k % n, j = (i + 1) % n;
        const double cap = std::sqrt((double)v[(size_t)j] * (double)v[(size_t)j] + 2 * 9 * t.ds);
        if ((double)v[(size_t)i] > cap) v[(size_t)i] = (float)cap;
      }
    crestAny_ = any;
    crest_ = std::move(v);
  }
  return crestAny_ ? &crest_ : nullptr;
}

// ---- A WRECK KEEPS GOING: retired means nobody is driving it, not that physics is done.
void Race::wreckStep(Entry &e, double dt) {
  const Track &t = *track;
  Car &car = e.car;
  car.throttle = 0; car.brake = 0.5;
  e.proj = t.project(car.x, car.y, e.hint, 8); e.hint = e.proj.i;
  const Proj &pr = e.proj;
  const double al = std::fabs(pr.lat);
  double surface = SURFACE::track;
  if (al > pr.w + pr.run) surface = SURFACE::grass;
  else if (al > pr.w + 1.2) surface = SURFACE::runoff;
  else if (al > pr.w) surface = SURFACE::kerb;
  Gnd &gnd = e.gnd;
  ground().under(car, pr, gnd);
  if (car.airborne) { car.pitch -= gnd.dPitch; car.roll -= gnd.dRoll; }
  Env env;
  env.surface = surface; env.bank = gnd.bank; env.bankDir = gnd.dir; env.dirty = 0; env.tow = 0;
  env.rollMul = dragFor(surface); env.slope = gnd.gx;
  step(car, dt, env);
  const Hit hit = resolveBarrier(car, t, e.hint);
  if (hit.hit && e.isPlayer && hit.closing > 3.5) e.bump = Bump{true, "barrier", hit.closing, hit.harm, hit.part, nullptr};
  const bool still = car.speed < 0.6 && std::fabs(car.vz) < 0.3 && std::fabs(car.pRate) < 0.3 && std::fabs(car.rRate) < 0.3;
  e.restT = still ? e.restT + dt : 0;
  if (e.restT > 1.0) { e.atRest = true; car.vx = 0.0001; car.vy = 0; car.r = 0; car.vz = 0; car.pRate = 0; car.rRate = 0; }
}

// ---- SIDE BY SIDE: alongside is a phase of its own. The pair LOCKS, each holds
// its lane, and then it is decided: the loser lifts and tucks in.
SideFight *Race::sideBySide(Entry &e, bool blocked) {
  const Track &t = *track;
  const double L = spec->bodyL, now = time;
  if (e.side.on) {
    SideFight &S = e.side;
    Entry *p = S.o;
    // A fight is at racing speed or it is not a fight.
    const double vl0 = e.lines->race.v[(size_t)e.proj.i];
    const bool slow = e.car.speed < vl0 * 0.7 || p->car.speed < p->lines->race.v[(size_t)p->proj.i] * 0.7;
    const bool gone = !p || p->retired || p->inPit || p->finished || e.inPit || rc.neutral() || slow
      || std::fabs(t.gap(p->proj.s, e.proj.s)) > L * 2.5
      // A real excursion, not a wheel on the kerb.
      || std::fabs(e.proj.lat) > e.proj.w + 3.5 || std::fabs(p->proj.lat) > p->proj.w + 3.5
      || now > S.until + 4;
    if (gone) { unlock(e); return nullptr; }
    if (now > S.until && !S.done) resolveSide(e);
    const double rel = t.gap(e.proj.s, p->proj.s);              // + : I am ahead
    S.cap = NaN;
    if (S.done) {
      if (S.lose) S.cap = p->car.speed * 0.95;                  // lift, and let them go
      if (std::fabs(rel) > L * 1.3) { unlock(e); return nullptr; }
    } else {
      // Keep level: the one edging ahead eases off until they are door to door.
      if (rel > 1.2) S.cap = std::max(p->car.speed - 6, p->car.speed - (rel - 1.2) * 1.2);
      // Neither car is on the racing line, so neither can carry its speed.
      const double vl = e.lines->race.v[(size_t)e.proj.i] * 0.93;
      S.cap = std::min(orInf(S.cap), vl);
    }
    return &S;
  }
  if (blocked || !sideLock || !duel || state != RaceState::Green || time - greenT < 25) return nullptr;   // not in the lap-one scramble
  // YOU, alongside a bot from behind: the bot you have drawn level with starts the fight.
  const double Lm = spec->bodyL;
  const auto pace = [&](const Entry &x) { return x.car.speed >= x.lines->race.v[(size_t)x.proj.i] * 0.8; };
  if (!pace(e)) return nullptr;
  if (me && me != &e && !me->side.on && !me->retired && !me->inPit && e.behind == me && pace(*me)) {
    const double dsm = t.gap(e.proj.s, me->proj.s), dlm = me->proj.lat - e.proj.lat;
    if (dsm > 0 && dsm < Lm * 1.2 && std::fabs(dlm) > 1.4 && std::fabs(me->proj.lat) <= me->proj.w + 1
        && std::fabs(e.proj.lat) <= e.proj.w + 1 && (e.hasDriver ? e.driver.style.space : 0) <= 0.6) {
      const double keen = std::min(1.0, ((e.hasDriver ? e.driver.style.side : 0.5) + 0.9) / 2 + 0.15);
      const double dur = 2 + 9 * std::min(1.0, keen) * (0.5 + sideRng());
      const double ln = sgn1(-dlm);
      e.side = SideFight{true, me, ln, now + dur, false, NaN, false};
      me->side = SideFight{true, &e, -ln, now + dur, false, NaN, false};
      sideFights = sideFights + 1;
      return &e.side;
    }
  }
  Entry *o = e.ahead;
  if (!o || o->side.on || o->inPit || o->retired || o->recover.on || o->finished || !pace(*o)) return nullptr;
  const double ds = t.gap(o->proj.s, e.proj.s), dl = o->proj.lat - e.proj.lat;
  // Nose at their gearbox and pulled out of line is enough to START the fight.
  if (!(ds > 0 && ds < L * 1.7 && std::fabs(dl) > 1.4)) return nullptr;
  if (std::fabs(e.proj.lat) > e.proj.w + 1 || std::fabs(o->proj.lat) > o->proj.w + 1) return nullptr;
  if (std::fabs(progress(e) - progress(*o)) > t.length * 0.5) return nullptr;   // lapping
  // The cautious do not go wheel to wheel — as the attacker or the defender.
  if ((e.hasDriver ? e.driver.style.space : 0) > 0.6 || (o->hasDriver ? o->driver.style.space : 0) > 0.6) return nullptr;
  const double keen = ((e.hasDriver ? e.driver.style.side : 0.5) + (o->hasDriver ? o->driver.style.side : 0.6)) / 2;
  const double dur = 1.5 + 9 * keen * (0.5 + sideRng());
  const double ln = sgn1(-dl);                                  // my side of them, + = left
  e.side = SideFight{true, o, ln, now + dur, false, NaN, false};
  o->side = SideFight{true, &e, -ln, now + dur, false, NaN, false};
  sideFights = sideFights + 1;
  return &e.side;
}

// Who gives. Boldness, the inside of the next corner, being ahead already, and luck.
void Race::resolveSide(Entry &e) {
  Entry &p = *e.side.o;
  const double inside = insideAhead(e.proj.s, 200);
  const auto score = [&](Entry &x) {
    return (x.hasDriver ? x.driver.aggression : 0.65) + (inside != 0 && x.side.lane == inside ? 0.35 : 0)
      + (track->gap(x.proj.s, x.side.o->proj.s) > 0 ? 0.25 : 0) + 0.6 * sideRng();
  };
  const double se = score(e), sp = score(p);
  const bool eWins = se >= sp;
  e.side.done = p.side.done = true;
  e.side.lose = !eWins; p.side.lose = eWins;
}

void Race::unlock(Entry &e) {
  Entry *p = e.side.on ? e.side.o : nullptr;
  e.side = SideFight{};
  if (p && p->side.on && p->side.o == &e) p->side = SideFight{};
}

// ---- racecraft: the part that needs to know the running order ----------------------
void Race::racecraft(Entry &e) {
  const Track &t = *track;
  const int i = e.proj.i;
  Driver &d = e.driver;
  const double lim = std::max(0.3, t.w[(size_t)i] - 1.0);
  double bias = 0, speedCap = NaN, obstDs = NaN, obstV = NaN;

  // (MEASURED AND REJECTED: an opening-lap caution. See the JS.)
  // ---- peeling off for the pit entry: a lateral bias, which lives here.
  const bool pitting = e.pitPhase == PitPhase::Approach;
  // ---- THE OPENING CORNERS: from the braking zone for turn one, a start is a ZIP.
  bool zip = false;
  if (openOn && state == RaceState::Green && e.lap == e.openLap && !e.finished) {
    const double s = e.proj.s;
    if (e.opening) {
      if (s > openEnd && s < openEnd + 1200) { e.opening = false; e.zip = false; }
      else if (!e.zip && e.car.speed > 25 && brakingZone(s, 320)) e.zip = true;
      zip = e.zip;
    }
    // ...and for the rest of the first lap every BRAKING ZONE is zipped the same way.
    if (!e.opening) zip = brakingZone(s, 200);
  }
  // A safety-car restart is a start: race control sets the window as it goes green.
  if (openOn && !zip && time < e.zipUntil && state == RaceState::Green) zip = brakingZone(e.proj.s, 200);
  // Over to the pit side for the entry: three quarters of the way, eased in over the last 350 m.
  double pitBias = 0;
  if (pitting) {
    const double to = t.wrap(lane.entryS - e.proj.s);
    const double ramp = std::max(0.0, std::min(1.0, ((stock ? 650 : 350) - to) / 250));
    pitBias = sgn1(lane.off) * lim * 0.75 * ramp;
    bias += pitBias;
  }
  // ...and OUT of them on an oval: it stays down on the inside until it is up to speed.
  if (stock && e.rejoin && !pitting) {
    if (e.car.speed > 64) e.rejoin = false;
    else { pitBias = sgn1(lane.off) * lim * 0.85; bias += pitBias; }
  }

  // ---- attack: pick the INSIDE of the next corner, commit to it; if the door is shut, go round.
  const double lineOff = lines->race.off[(size_t)i];
  const double L = spec->bodyL;
  const double moveGap = std::isnan(d.moveGap) ? 3.5 : d.moveGap;
  const double lungeMax = std::isnan(d.lungeMax) ? 0.02 : d.lungeMax;
  double want = 0, lunge = 0, pressure = 0;
  const double reach = battle ? 1.8 : 1.4;
  const double dtR = NEIGH_EVERY * FIXED_DT;
  // Which straight this is: a new one begins every time a braking zone ends.
  const bool zoneNow = brakingZone(e.proj.s, 150);
  if (!zoneNow && e.inZone) e.seg++;
  e.inZone = zoneNow;
  // BUILDING: time within striking distance of THIS car ahead fills it.
  if (e.ahead != e.buildOn) { e.buildOn = e.ahead; e.build = 0; e.tryT = 0; }
  if (e.ahead && e.aheadGapT < 0.8) e.build += dtR;
  else if (!e.ahead || e.aheadGapT > 1.5) e.build = std::max(0.0, e.build - 2 * dtR);
  // Under a safety car, a VSC, a red flag, a yellow nobody attacks; nobody races after the flag.
  const bool parade = state == RaceState::Formation;      // nobody races on the formation lap
  const bool noAtk = rc.noAttack(e) || e.finished || zip || parade, noDef = rc.noDefend(e) || e.finished || zip || parade;
  // REAL: no rule decides the attack or the defence. The driver imagines what happens
  // next for each thing it could do, with the cars it can see, and chooses (brain.cpp).
  static const bool NO_BRAIN = std::getenv("XBR_NOBRAIN") != nullptr;      // A/B: the rules it replaces
  double thinkCap = NaN;
  const bool brainOn = real && !NO_BRAIN && e.drive && !loose && !pitting && !e.inPit;
  if (brainOn) {
    const Thought th = think(e, i, lim, lineOff, noAtk, noDef);
    want += th.want; lunge = th.lunge; pressure = th.pressure;
    thinkCap = th.cap;
  }
  if (!brainOn && !pitting && !noAtk && e.ahead && e.aheadGapT < reach && !e.inPit) {
    Entry *o = e.ahead;
    const double ds = t.gap(o->proj.s, e.proj.s);
    const bool braking = brakingZone(e.proj.s, 130);
    // Nose alongside already: it is a fight for the corner, not a dive.
    const bool alongside = ds < L * 1.2 && std::fabs(o->proj.lat - e.proj.lat) > 1.6;
    // A backmarker being lapped, or a car limping, is not a duel.
    const bool lapping = progress(e) - progress(*o) > t.length * 0.5 || o->car.speed < e.car.speed * 0.7 || o->recover.on;
    bool ready = !duel || alongside || lapping || e.build > BUILD_T * (1.5 - d.aggression);
    if (duel && ready && !alongside && (e.tryT = e.tryT + dtR) > TRY_T) {
      e.build = 0; e.tryT = 0; ready = false;
    }
    // Re-plan every 2.5 s, on a new target, or the moment the defender shuts the door.
    const bool shut = e.atkOn == o && o->proj.lat * e.atkSide > 1.4 && std::fabs(o->proj.lat - e.proj.lat) < 1.6;
    if (e.atkOn != o || time - e.atkAt > 2.5 || (shut && time - e.atkAt > 0.8)) {
      const double inside = insideAhead(e.proj.s, 200);
      double side = inside != 0 ? inside : (o->proj.lat > e.proj.lat ? -1 : 1);
      // The door is shut: they are already sitting on the inside.
      if (inside != 0 && o->proj.lat * inside > 1.4) side = -inside;
      e.atkSide = side; e.atkAt = time; e.atkOn = o;
    }
    // Out of the slipstream late, not from a second back.
    const double pull = !ready ? 0 : braking ? 0.75 + 0.5 * d.aggression
                      : ds < 30 ? 0.55 + 0.4 * d.aggression : 0.35;
    want += e.atkSide * pull * std::max(0.8, t.w[(size_t)i] - 2.2) * std::min(1.0, (reach - e.aheadGapT) / 1.0);
    // The dive: brake later than the line says, once you are out of their wake and nearly alongside.
    if (braking && ready && ds < L * (duel ? 1.3 : 2.2) && std::fabs(o->proj.lat - e.proj.lat) > 1.2) {
      lunge = lungeMax * d.aggression;
    }
    if (ds < 25) pressure = 0.6;
    // ...and he never dives at you: he will pass if he is quicker, cleanly.
    if (e.mate && o == me) lunge = 0;
  }

  // ---- defence: into a braking zone, cover the inside; on a straight, go with the car that pulls out.
  const double defendT = battle ? 1.0 : 0.75;
  // YOUR TEAMMATE does not defend against you.
  // MULTICLASS: nobody defends against another class. It is not their race.
  const bool otherClass = multi && e.behind && e.behind->klass != e.klass;
  if (!brainOn && !pitting && !noDef && !otherClass && e.behind && e.behindGapT < defendT && !e.inPit && !(e.mate && e.behind == me)) {
    Entry *o = e.behind;
    const double ds = t.gap(e.proj.s, o->proj.s);          // + : they are behind me
    const double dl = o->proj.lat - e.proj.lat;
    const bool braking = brakingZone(e.proj.s, 150);
    double move = 0;
    if (braking) {
      move = insideAhead(e.proj.s, 220);
      if (move == 0) move = -sign(lineOff);
      if (move == 0) move = 1;
    } else if (d.defence > 0.5 && ds > L * 1.05 && ds < 28 && std::fabs(dl) > 0.9) move = sign(dl);
    // THE DUEL'S DEFENCE: one move per straight, and the inside into every braking zone.
    const bool mayMove = duel
      ? (braking || e.moveSeg != e.seg) && time - e.movedAt > 1.0
      : time - e.movedAt > moveGap;
    if (move != 0 && move != e.lastMove && mayMove) {
      e.lastMove = move; e.movedAt = time; e.moveSeg = e.seg;
    }
    if (move != 0 || time - e.movedAt < 1.2) {
      want += e.lastMove * d.defence * std::max(0.6, t.w[(size_t)i] - 2.4) * 0.85;
    }
    // ...and brake a touch later on the inside when someone is right there.
    if (duel && braking && ds < 22 && e.lastMove == move) {
      lunge = std::max(lunge, DEF_LUNGE * lungeMax * d.defence);
    }
    pressure = std::max(pressure, std::min(1.0, 1 - e.behindGapT / defendT));
  }
  // Off the grid, a car eases across to the line rather than snapping onto it.
  if (e.merge && (std::fabs(e.biasS) < 0.3 || time - greenT > 40)) e.merge = false;
  // THE LAUNCH (STYLE.launch): a darter is across at three times the old rate; a patient one waits.
  const bool stNone = !styles;
  const double stLaunch = stNone ? 0.27 : d.style.launch, stSpace = stNone ? 0 : d.style.space;
  const bool waited = stNone || time - greenT > (1 - stLaunch) * 4;
  const double slew = e.merge
    ? (state == RaceState::Green && waited ? MERGE_RATE * (stNone ? 1 : 0.35 + 2.4 * stLaunch) * NEIGH_EVERY * FIXED_DT : 0)
    : (3.0 + 2.5 * d.aggression) * NEIGH_EVERY * FIXED_DT;
  // SIDE BY SIDE: a locked pair holds its lanes, inside and outside.
  SideFight *sb = brainOn ? nullptr : sideBySide(e, noAtk || pitting);
  if (sb) want = sb->lane * lim * 0.62 - lineOff;
  // Race control's say on the lane.
  want = rc.wantBias(e, want, lineOff, lim);
  bias += e.biasS + std::max(-slew, std::min(slew, want - e.biasS));

  // DO NOT DRIVE INTO SOMEONE WHO IS ALONGSIDE. A clamp cannot be outvoted.
  // A car is 2 m wide; 2.6 is that plus a door. A cautious driver leaves up to 2.4 m more.
  const double ROOM = 2.6 + 2.4 * stSpace;
  double yieldTo = NaN;
  // REAL: you, stopped on the road or hanging off the edge of it — a place for the taking (below)
  const bool meParked = real && me && me != &e && !me->retired && !loose && me->car.speed < 4 && std::fabs(me->proj.lat) <= me->proj.w + 2.5;
  for (Entry &o : entries) {
    if (&o == &e || o.retired || o.inPit || loose) continue;
    if (meParked && &o == me) continue;          // the way round a parked you is worked out whole, not door by door
    if (brainOn && !aware(e, o)) continue;       // REAL: nobody leaves room for a car they have not seen
    if (std::fabs(t.gap(o.proj.s, e.proj.s)) > 7) continue;
    const double dl = o.proj.lat - e.proj.lat;   // + = they are on my left
    const double keep = dl > 0 ? (o.proj.lat - ROOM) - lineOff
                               : (o.proj.lat + ROOM) - lineOff;
    const double before = bias;
    bias = dl > 0 ? std::min(bias, keep) : std::max(bias, keep);
    // AND IF LEAVING ROOM MEANS LEAVING THE CIRCUIT, THERE IS NO ROOM: the brake, not their door.
    if (std::fabs(bias + lineOff) > lim) {
      bias = before;
      // ...but only the car BEHIND brakes.
      if (!duel || t.gap(o.proj.s, e.proj.s) > -0.5) yieldTo = std::min(orInf(yieldTo), o.car.speed * 0.94);
    }
  }

  // Car-following: THE CAR AHEAD IN YOUR LANE, not the nearest car ahead (the duel).
  // ...but not off the grid or through the first corners: twenty-two cars on cold tyres in one
  // braking zone is where the old caution earns its keep (eight lap-one shunts in one race without it).
  const bool close = brainOn && !zip && state == RaceState::Green && time - greenT > brainTune().closeAfter;
  Entry *A = e.ahead;
  if (duel) {
    // REAL: a driver who has pulled out IS out. Its lane is a car and a bit wide, on a straight
    // and under braking alike — or nobody can ever go down the inside (measured: the fastest car
    // on the grid, started last, took five laps to pass three).
    // (and what it imagined tells it when a car that is NOT in its lane yet is about to be: thinkCap, below)
    Entry *la = laneAhead(e, close ? brainTune().gate : brakingZone(e.proj.s, 140) ? std::max(4.5, t.w[(size_t)i] * 1.1) : 3.4);
    A = la ? la : e.ahead;
  }
  // You, off the road, are not the car to follow.
  if (A && A->isPlayer && std::fabs(A->proj.lat) > A->proj.w + 1.0) A = nullptr;
  // ...and stopped or crawling you have a rule of your own below.
  if (A && A->isPlayer && A->car.speed < 20) A = nullptr;
  // THE ZIP: whoever is ahead on the road, any lane — unless the two of you overlap.
  if (zip) {
    A = nullptr;
    double bd = 200;
    for (Entry &o : entries) {
      if (&o == &e || o.retired || o.inPit) continue;
      if (real && &o == me && o.car.speed < 4) continue;      // REAL: a car spun at turn one — on the road or in the gravel — is not the back of the queue
      const double ds = t.gap(o.proj.s, e.proj.s);
      if (ds > spec->bodyL * OPEN_PAIR && ds < bd) { bd = ds; A = &o; }
    }
  }
  if (A && !e.inPit) {
    const double ds = t.gap(A->proj.s, e.proj.s);
    const double dl = std::fabs(A->proj.lat - e.proj.lat);
    const double vA = A->car.speed, v = e.car.speed;
    const double closing = v - vA;
    const bool braking = brakingZone(e.proj.s, 140);
    // REAL: how close to follow is the driver's own business, and it is CLOSE — the old rule kept
    // 30 m back through every braking zone, which is exactly where a quicker car makes its time
    // (traced: the fastest car on the grid sat 33 m behind a backmarker, 5 m/s under its own line speed).
    const double zone = close ? 1.0 : braking ? 1.7 : 1.0;
    // ...and the same caution behind: up to a car length more headway.
    const double headway = close ? brainTune().hwBase + v * brainTune().hwK + std::max(0.0, closing) * 1.0 + stSpace * spec->bodyL
                                   : (6.5 + v * 0.28 + std::max(0.0, closing) * 1.4) * zone + stSpace * spec->bodyL;
    // Into a braking zone the road narrows onto one line: widen the gate to most of the road.
    const double latGate = zip ? INF : close ? brainTune().gate : braking ? std::max(4.5, t.w[(size_t)i] * 1.1) : 3.4;
    // You own the road when you have OVERLAP.
    const bool overlap = !zip && ds < spec->bodyL * 1.15 && dl > 1.9;
    // BRAKE FOR THE CAR AHEAD, NOT JUST THE LINE (the duel).
    if (duel && !overlap && ds > 0 && ds < (close ? headway * 1.6 : 150) && dl < latGate) { obstDs = ds - spec->bodyL * 1.15 - (zip ? 1.5 + v * OPEN_T : 0); obstV = vA; }
    // `ds < headway * 1.3` is load-bearing: beyond following distance you are not following anyone.
    if (!overlap && ds > 0 && ds < headway * 1.3 && dl < latGate) {
      // With room, a bounded run — that is the overtake. Without it, actively SLOWER.
      const double room = ds - spec->bodyL * 1.3;
      const double run = 1.5 + 4.0 * d.aggression;
      speedCap = room > 0
        ? vA + std::min(run, room * 0.22)
        : vA * std::max(0.55, 1 + room * 0.06);
    }
  }

  // NOBODY REAR-ENDS YOU: a rule of your own that no racecraft can switch off.
  {
    // (not in a demo derby: there, nobody is careful round anybody)
    Entry *m = loose ? nullptr : me;
    // REAL — YOU HAVE SPUN AND STOPPED (Adam: "they js wait, and dont take an oppurtuinity").
    // A stopped car is not a hazard to queue behind, it is a free place. However you
    // have come to rest — straight, sideways, half on the grass — the driver measures
    // how much road you block, picks the open side once, and goes. HOW is the driver's
    // own: the brave go by flat with half a metre of air, the cautious lift and leave two.
    if (meParked) {
      const Car &mc = m->car;
      const double dh = mc.hdg - t.hdg[(size_t)m->proj.i];
      const double bw = spec->bodyW != 0 ? spec->bodyW : 2.0, bl = spec->bodyL != 0 ? spec->bodyL : 4.6;
      const double hw = std::fabs(std::sin(dh)) * bl / 2 + std::fabs(std::cos(dh)) * bw / 2;      // road you block, either side of your middle
      const double hl = std::fabs(std::cos(dh)) * bl / 2 + std::fabs(std::sin(dh)) * bw / 2;      // and along it
      const double ds = t.gap(m->proj.s, e.proj.s);
      if (ds > -(hl + bl / 2 + 1.5) && ds < 220) {
        const double W = m->proj.w;
        const double freeL = W - (m->proj.lat + hw), freeR = W + (m->proj.lat - hw);              // lat + is left
        const double need = bw + 0.5;
        const double dlm = e.proj.lat - m->proj.lat;
        if (std::isnan(e.goRound) || time - e.goRoundAt > 6) {
          const double mine = dlm > 0 ? freeL : freeR;
          e.goRound = std::fabs(dlm) > hw + 0.5 && mine >= need ? sign(dlm) : freeL >= freeR ? 1 : -1;
        }
        e.goRoundAt = time;
        const double fr = e.goRound > 0 ? freeL : freeR;
        const double v = e.car.speed;
        const double room = ds - hl - bl / 2 - 2.5;
        if (fr >= need) {
          const double air = std::min(0.45 + 2.0 * stSpace, std::max(0.25, fr - bw - 0.25));
          const double tgt = m->proj.lat + e.goRound * (hw + bw / 2 + air) - lines->race.off[(size_t)i];
          bias = e.goRound > 0 ? std::max(bias, tgt) : std::min(bias, tgt);
          // not yet clear of you across the road: be able to stop short if the gap does not open
          if (ds > 0 && std::fabs(dlm) < hw + bw / 2 + 0.15) {
            const double cap = room > 0 ? std::sqrt(2 * 8 * room) : 0;
            speedCap = capMin(speedCap, cap);
            if (std::isnan(obstDs) || room < obstDs) { obstDs = std::max(0.0, room); obstV = 0; }
          }
          // the cautious lift for a stopped car; the brave do not
          if (ds > 0 && ds < 70 && stSpace > 0.12) speedCap = capMin(speedCap, std::max(22.0, 80 - 75 * stSpace));
        } else if (ds > 0) {
          // you have shut the road: there is nothing to take, and they stop short of you
          speedCap = capMin(speedCap, room > 0 ? std::sqrt(2 * 8 * room) : 0);
          if (std::isnan(obstDs) || room < obstDs) { obstDs = std::max(0.0, room); obstV = 0; }
        }
      }
      m = nullptr;
    }
    // REAL: at racing speed you are a car like any other — dived at, squeezed, followed
    // as closely as they follow each other. The rule below is for you sliding or crawling.
    if (real && m && m != &e && !m->retired) {
      const Car &mc = m->car;
      const bool onRoad = std::fabs(m->proj.lat) <= m->proj.w + 1.0;
      const double vP = std::max(0.0, mc.speed * std::cos(mc.hdg - t.hdg[(size_t)m->proj.i]));
      const bool erratic = onRoad && (std::fabs(mc.vy) > 2 || std::fabs(std::sin(mc.hdg - t.hdg[(size_t)m->proj.i])) > 0.35);
      const bool slow = onRoad && !erratic && vP < std::max(20.0, e.car.speed * 0.6);
      if (onRoad && !erratic && !slow) m = nullptr;
    }
    if (m && m != &e && !m->retired) {
      const double ds = t.gap(m->proj.s, e.proj.s);
      if (ds > 0 && ds < 300) {
        const Car &mc = m->car;
        const bool onRoad = std::fabs(m->proj.lat) <= m->proj.w + 1.0;
        const double vP = std::max(0.0, mc.speed * std::cos(mc.hdg - t.hdg[(size_t)m->proj.i]));
        // ERRATIC and SLOW are different things: sliding, the gate is most of the road;
        // parked, the field goes ROUND you, on the side with more road.
        const bool erratic = onRoad && (std::fabs(mc.vy) > 2 || std::fabs(std::sin(mc.hdg - t.hdg[(size_t)m->proj.i])) > 0.35);
        const bool slow = onRoad && !erratic && vP < std::max(20.0, e.car.speed * 0.6);
        if (slow && ds < 220) {
          const double lm = std::max(0.3, m->proj.w - 1.0), PASS = 3.4;
          const double roomL = lm - m->proj.lat, roomR = m->proj.lat + lm;
          // Decided once, not re-thought every tick.
          const double dlm = e.proj.lat - m->proj.lat;
          if (std::isnan(e.goRound) || time - e.goRoundAt > 6) e.goRound = std::fabs(dlm) > 2.5 ? sign(dlm) : roomL >= roomR ? 1 : -1;
          e.goRoundAt = time;
          // It only ever pushes AWAY from you.
          if ((e.goRound > 0 ? roomL : roomR) >= PASS - 0.4) {
            const double tgt = m->proj.lat + e.goRound * PASS - lines->race.off[(size_t)i];
            bias = e.goRound > 0 ? std::max(bias, tgt) : std::min(bias, tgt);
          }
        }
        const bool unsettled = erratic;
        const double gate = std::max(slow ? 2.5 : brakingZone(e.proj.s, 140) ? std::max(4.5, t.w[(size_t)i] * 1.1) : 3.0,
                                     unsettled ? std::max(5.5, t.w[(size_t)i] * 1.2) : 0.0);
        if (std::fabs(m->proj.lat - e.proj.lat) < gate) {
          const double v = e.car.speed;
          const double room = ds - spec->bodyL * 1.15 - (slow ? 1.5 : 4) - v * 0.3;
          if (std::isnan(obstDs) || room < obstDs) { obstDs = std::max(0.0, room); obstV = vP; }
          const double cap = room > 0 ? vP + std::sqrt(2 * 9 * room) : vP * 0.7;
          speedCap = capMin(speedCap, cap);
        }
      }
      // Passing you, it keeps a car's width of air between you.
      if (ds > -spec->bodyL * 1.6 && ds < spec->bodyL * 1.6) {
        const double off = lines->race.off[(size_t)i];
        // A metre of air past a parked you; a car's width past a moving one.
        const double CLEAR = m->car.speed < 12 ? 3.0 : 3.6;
        if (e.proj.lat >= m->proj.lat) bias = std::max(bias, m->proj.lat + CLEAR - off);
        else bias = std::min(bias, m->proj.lat - CLEAR - off);
      }
    }
  }

  if (!std::isnan(thinkCap)) speedCap = capMin(speedCap, thinkCap);
  // The yield goes on last, so the car-following cap above cannot undo it.
  if (!std::isnan(yieldTo)) speedCap = capMin(speedCap, yieldTo);
  if (loose) {
    // its own lane, drifting from one side to the other, and no speed taken off for whoever is in front
    if (std::isnan(e.lanePh)) { e.lanePh = std::fmod(e.idx * 2.399, 6.283); e.laneF = 0.25 + std::fmod(e.idx * 0.618, 1.0) * 0.3; }
    bias = lim * 0.72 * std::sin(time * e.laneF + e.lanePh) - lines->race.off[(size_t)i];
    speedCap = NaN; obstDs = NaN; obstV = NaN;
    // In a DERBY it is going for the nearest car in reach, yours included.
    if (derby) {
      Entry *tgt = nullptr;
      double bd = 55;
      for (Entry &o : entries) {
        if (&o == &e || o.retired) continue;
        const double ds = t.gap(o.proj.s, e.proj.s);
        if (ds > -6 && ds < bd) { bd = ds; tgt = &o; }
      }
      if (tgt) bias = tgt->proj.lat - lines->race.off[(size_t)i];
    }
  }

  const double off = lines->race.off[(size_t)i];
  bias = std::max(-lim - off, std::min(lim - off, bias));
  // What the slew starts from next time is where the car was ALLOWED to go, pit bias excluded.
  e.biasS = bias - pitBias;
  if (sb && !std::isnan(sb->cap)) speedCap = capMin(speedCap, sb->cap);
  // The cool-down lap is driven at two thirds of racing speed.
  if (e.finished) speedCap = capMin(speedCap, e.lines->race.v[(size_t)i] * 0.66);
  // THE FORMATION: TWO WIDE AND TIGHT. The first car out sets the pace; every
  // rival has a PLACE behind it and drives to that place.
  if (state == RaceState::Formation) {
    Entry *lead = formLead;
    if (&e == lead || !lead || lead->inPit) {
      speedCap = capMin(speedCap, &e == lead ? FORM_PACE : 40);
      if (&e == lead) bias = FORM_SIDE;
    } else {
      // Places fill left then right, row by row — except the fifth car, which takes the OUTER side of row three.
      const int row = e.formR / 2;
      const bool left = e.formR == 4 ? false : e.formR == 5 ? true : e.formR % 2 == 0;
      const double col = left ? 1 : -1;
      double dd = t.gap(lead->proj.s, e.proj.s);                // metres the lead car is ahead of it
      if (dd < -40) dd += t.length;                             // more than half a lap back: still behind, not ahead
      const double bl = e.car.spec->bodyL != 0 ? e.car.spec->bodyL : 4.6;
      const double err = dd - row * (bl + FORM_GAP);
      e.formErr = err;
      // PEOPLE, NOT A TRAIN: sloppy with the pedals, sloppy with the wheel, both, or neither.
      const auto h = [&](double n) { const double x = std::sin((e.idx + 1) * n) * 43758.5453; return x - std::floor(x); };
      const int kind = (int)std::floor(h(12.9898) * 4);
      const bool pedals = kind == 0 || kind == 2, wheel = kind == 1 || kind == 2;
      const double dtc = NEIGH_EVERY * FIXED_DT;
      double gain = 0.6, seen = err, foot = 0;
      if (pedals) {
        const double lag = 0.6 + h(78.233) * 0.8;
        const double fsn = std::isnan(e.formSeen) ? err : e.formSeen;
        e.formSeen = fsn + (err - fsn) * std::min(1.0, dtc / lag);
        seen = e.formSeen;
        gain = h(39.346) < 0.5 ? 1.3 : 0.28;                       // over-corrects, or under-corrects
        foot = std::sin(time * (0.5 + h(11.135) * 0.7) + h(93.989) * 6.28) * 1.6;   // m/s
      }
      // (far from its place it just drives there: the wandering is for holding station)
      const double settle = std::fabs(err) < 25 ? 1 : 0;
      speedCap = capMin(speedCap, std::max(6.0, std::min(62.0, lead->car.speed + (settle != 0 ? seen * gain + foot : err > 0 ? std::sqrt(err * 8) : err * 0.6))));
      const double sway = wheel ? std::sin(time * (0.35 + h(26.651) * 0.5) + h(54.478) * 6.28) * (0.12 + h(61.725) * 0.18)
                                  + std::sin(time * (1.1 + h(17.31) * 0.9) + h(3.77) * 6.28) * 0.08 : 0;
      bias = col * FORM_SIDE + sway * settle;
      if (e.ahead != me) { obstDs = NaN; obstV = NaN; }   // its place is the rule, not the car in front (but never into YOU)
    }
  }
  // A crest is a speed limit: faster than this over it and the road leaves the car.
  const std::vector<float> *crest = crests();
  if (crest && (double)(*crest)[(size_t)i] < 200) speedCap = capMin(speedCap, (double)(*crest)[(size_t)i]);
  DriveCtx ctx;
  ctx.offBias = bias; ctx.speedCap = speedCap; ctx.lunge = !std::isnan(yieldTo) ? 0 : lunge; ctx.pressure = pressure;
  ctx.hold = (std::isnan(e.hold) ? 1 : e.hold) * (std::isnan(e.roadHold) ? 1 : e.roadHold);
  ctx.obstDs = obstDs; ctx.obstV = obstV;
  rc.limit(e, ctx);
  e.ctx = ctx; e.hasCtx = true;
}

// ---- one substep -----------------------------------------------------------------------
void Race::tick(double dt, const PlayerInput *playerInput) {
  const Track &t = *track;
  time += dt;
  const bool laneOk = pits && lane.len > SERVICE_PIT_LEN;
  if (state == RaceState::Grid) {
    lights -= dt;
    if (lights <= 0) {
      state = RaceState::Green;
      greenT = time;
      log("flag", "LIGHTS OUT");
      if (jokerRule) log("flag", "ONE JOKER LAP EACH — ANY LAP YOU LIKE, BUT NO FINISH WITHOUT IT", nullptr, "joker");
      if (stock && laneOk) log("flag", "ONE PIT STOP EACH (P) — ANY LAP YOU LIKE, BUT NO FINISH WITHOUT IT", nullptr, "tyres");
      for (Entry &e : entries) e.lapStart = time;
    }
  }
  if (state == RaceState::Formation) {
    // When the last car is out, ONE MORE LAP in line, and it is green as the lead car crosses the line.
    if (!formSaid_) { formSaid_ = true; log("flag", "FORMATION — FIVE CARS OUT EVERY 10 SECONDS. NO PASSING.", nullptr, "form"); }
    Entry *lead = formLead;
    const double L = t.length;
    bool out = true;
    for (const Entry &e : entries) if (!(e.retired || (!e.inPit && e.pitPhase == PitPhase::None))) { out = false; break; }
    // ...and IN LINE: every rival within 15 m of its place (yours is your business)
    bool formed = out;
    if (formed)
      for (const Entry &e : entries)
        if (!(e.retired || e.isPlayer || &e == lead || std::fabs(std::isnan(e.formErr) ? 99 : e.formErr) < 15)) { formed = false; break; }
    if (formed && lead && std::isnan(formOutAt)) {
      formOutAt = 0;
      log("flag", "ALL OUT — ONE MORE LAP, IN LINE, NO PASSING. GREEN AT THE LINE.", nullptr, "form");
    }
    const double ls = lead ? lead->proj.s : 0;
    const bool crossedLine = lead && !std::isnan(lead->fs) && lead->fs > L * 0.75 && ls < L * 0.25;
    if (lead && !std::isnan(formOutAt) && !std::isnan(lead->fs))
      formOutAt += std::max(0.0, std::min(40.0, std::fmod(std::fmod(ls - lead->fs, L) + L, L)));
    if (lead) lead->fs = ls;
    if (!std::isnan(formOutAt) && formOutAt >= L * 0.4 && crossedLine) {
      state = RaceState::Green; greenT = time;
      log("flag", "GREEN FLAG — ROLLING START. ONE PIT STOP OWED (P).", nullptr, "form");
      log("flag", "ONE PIT STOP EACH (P) — ANY LAP YOU LIKE, BUT NO FINISH WITHOUT IT", nullptr, "tyres");
      for (Entry &e : entries) {
        e.lapStart = time; e.lap = 0; e.crossed0 = false; e.pastHalf = false;
        e.pitStops = 0; e.stockStops = 0; e.stintM = 0; e.stockSaid = 0; e.pitRequest = false;
        e.car.tyre.wf = 0; e.car.tyre.wr = 0;
      }
      lead->crossed0 = true;                            // it is over the line already: lap one is its
    }
  }
  const bool forming = state == RaceState::Formation;
  const bool racing = state == RaceState::Green || state == RaceState::Finish;

  // Neighbours and racecraft change slowly compared with 400 Hz, and they are the O(n^2) part.
  if ((battle || duelOn) && time - bandAt > BAND_EVERY) { bandAt = time; band(); }
  if (sub++ % NEIGH_EVERY == 0) {
    if (me && !me->retired && !me->inPit && std::fabs(me->proj.lat) > me->proj.w + 1.0) meOffAt = time;
    neighbours();
    for (Entry &e : entries) if ((!e.isPlayer || standIn) && !e.retired) racecraft(e);
  }

  static const PlayerInput noInput;
  for (Entry &e : entries) {
    if (e.retired) { if (!e.atRest) wreckStep(e, dt); continue; }
    Car &car = e.car;
    if (e.isPlayer) {
      const PlayerInput &inp = playerInput ? *playerInput : noInput;
      car.throttle = inp.throttle; car.brake = inp.brake;
      if (!std::isnan(inp.delta)) car.delta = inp.delta;
      // DRS is a rule, not a button.
      if (drsRule && !e.drsOk) car.drsOpen = false;
    } else if (e.drive) {
      e.drive->drive(car, e.proj, dt, e.hasCtx ? &e.ctx : nullptr);
      // A rival opens it the moment it is allowed and shuts it for the brakes and any real steering.
      if (drsRule) car.drsOpen = e.drsOk && car.brake < 0.05 && std::fabs(car.delta) < 0.06;
    }
    // A car being pushed is not driving, whoever is nominally at its wheel.
    if (e.recover.on) { car.throttle = 0; car.brake = 0; }

    // ---- the pit stop: AFTER the driver, never before.
    if (stock) {
      if (e.stockStops != e.pitStops) { e.stockStops = e.pitStops; e.stintM = 0; e.stockSaid = 0; }
      if (!e.inPit) e.stintM += car.speed * dt;
      // some sets last a third longer than others, so the stops do not all come on one lap
      const double life = stockStint * t.length * (1 + 0.3 * std::sin(e.idx * 2.4));
      const double w = std::min(1.25, 0.8 * e.stintM / life), off = std::pow(std::min(1.0, w), 1.5);
      car.tyre.wf = car.tyre.wr = w;
      // What a worn set costs: corner speed.
      e.stockHold = 1 - 0.1 * off;
      // A rival's wreck on an oval is a trip to the pits, not the end of its race.
      if (!e.isPlayer && racing) car.damage = std::min(car.damage, 0.7);
      if (car.xg.on) car.xg.gCap = 3.0 * (1 - 0.35 * off);
      // EVERYBODY STOPS ONCE, whatever the length.
      if (!e.isPlayer && racing && !e.pitStops && !e.pitRequest && !e.inPit && !e.finished) {
        const double due = std::min((double)laps - 1, std::floor((double)((e.idx * 7 + 3) % 10) / 10 * laps));
        if (e.lap + (e.pastHalf ? 1 : 0) >= due) { e.pitRequest = true; log("flag", e.name + " WILL PIT", &e); }
      }
      if (e.isPlayer && racing && !e.inPit) {
        const int say = w > 0.8 ? 2 : w > 0.5 ? 1 : 0;
        if (say > e.stockSaid) { e.stockSaid = say; log("flag", say == 2 ? "TYRES GONE — P TO PIT" : "TYRES HALF GONE", &e, "tyres"); }
      }
    }
    if (forming) {
      updateStop(e, t, lane, e.proj, dt, peak, &entries);
      car.damage = 0;                                  // and nobody's race ends on it
    }
    if (racing && (!e.finished || e.cool) && pits) {
      // Their engineers call it on TYRES too, not only damage.
      const bool worn = std::max(car.tyre.wf, car.tyre.wr) > 0.8 && laps - e.lap >= 2;
      if (!e.finished && !e.isPlayer && !e.pitRequest && e.pitPhase != PitPhase::Service && (shouldPit(car) || worn)) {
        e.pitRequest = true;
        log("flag", e.name + " WILL PIT", &e);
      }
      const bool wasIn = e.inPit;
      // Home after the flag: in its box, it is parked for good.
      if (e.cool && e.pitPhase == PitPhase::Service) { e.pitTimer = 5; e.parked = true; }
      if (updateStop(e, t, lane, e.proj, dt, peak, &entries)) {
        std::string jobs;
        for (size_t k = 0; k < e.pitJobs.size(); k++) jobs += (k ? " + " : "") + e.pitJobs[k];
        log("flag", e.name + " SERVED — " + jobs, &e);
        rc.released(e);
      }
      if (e.inPit && !wasIn) { log("flag", e.name + " PITS", &e); rc.pitEntry(e); }
      if (wasIn && !e.inPit) e.rejoin = true;
      // PUSHED BACK INTO THE GARAGE: a car that is staying cannot stay on its mark.
      const bool stay = e.pitPhase == PitPhase::Service && (e.cool || lane.hold);
      if (stay && car.speed < 1) {
        if (std::isnan(e.garageT)) { e.garageT = 0; e.garageS = e.proj.s; e.garageLat = e.proj.lat; e.garageHdg = car.hdg; }
        e.garageT = std::min(3.5, e.garageT + dt);
      } else if (!std::isnan(e.garageT) && !stay) {
        e.garageT -= dt * 1.5;
        if (e.garageT <= 0) e.garageT = NaN;
      }
      if (!std::isnan(e.garageT)) {
        const double k = e.garageT / 3.5, f = k * k * (3 - 2 * k);
        double gx, gy, gh;
        int gi;
        t.point(e.garageS, e.garageLat + sgn1(lane.off) * 9.5 * f, gx, gy, gh, gi);
        car.x = gx; car.y = gy; car.hdg = e.garageHdg;
        car.vx = 0.0001; car.vy = 0; car.r = 0; car.throttle = 0; car.brake = 1;
      }
    }

    // THE START IS A REFLEX: your car is not held on the grid. Go before the lights and you have jumped it.
    const bool held = !racing && !forming && !(e.isPlayer && !standIn && state == RaceState::Grid);
    if (held) { car.throttle = 0; car.brake = 1; car.delta = 0; }
    if (!racing && !forming && !held && !e.jumped && car.speed > 1.5) {
      e.jumped = true;
      if (rc.on) { e.penalty += 5; log("penalty", "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR " + std::to_string(e.num) + " (YOU) — JUMP START", &e, "pen5"); }
    }

    const Proj &pr = e.proj;
    const double al = std::fabs(pr.lat);
    double surface = SURFACE::track;
    if (al > pr.w + pr.run) surface = SURFACE::grass;
    else if (al > pr.w + 1.2) surface = SURFACE::runoff;
    else if (al > pr.w) surface = SURFACE::kerb;

    // On a fork? Off the lap's own road, and within the fork's width of its line.
    int onFork = -1;
    if (!detours.empty() && e.isPlayer && !e.inPit && al > pr.w - 1.5) {
      for (size_t di = 0; di < detours.size(); di++) {
        const Fork &F = detours[di];
        const bool same = e.det.on && e.det.d == (int)di;
        const int last = (int)F.P.size() - 1;
        const int i0 = same ? std::max(0, e.det.i - 30) : 0, i1 = same ? std::min(last, e.det.i + 60) : last;
        int bi = -1;
        double bd = (F.d->w + 2) * (F.d->w + 2);
        for (int k = i0; k <= i1; k++) {
          const auto &q = F.P[(size_t)k];
          const double dd = (q[0] - car.x) * (q[0] - car.x) + (q[1] - car.y) * (q[1] - car.y);
          if (dd < bd) { bd = dd; bi = k; }
        }
        if (bi >= 0) { onFork = (int)di; e.det = OnDetour{true, (int)di, bi, same ? e.det.from : bi}; break; }
      }
    }
    if (onFork < 0 && e.det.on) {
      // back on the lap: a fork driven end to end is a joker lap taken
      const double pl = (double)detours[(size_t)e.det.d].P.size();
      if (e.det.from < pl * 0.2 && e.det.i > pl * 0.8) {
        e.jokers++;
        log("flag", std::string("JOKER LAP TAKEN") + (jokerRule && e.jokers == 1 ? " — THAT IS THE ONE YOU OWED" : ""), &e, "joker");
      }
      e.det.on = false;
    }
    e.onFork = onFork >= 0;
    // A rival's joker: this lap, between the fork's two ends, at the pace the long way round would cost.
    double jokerHold = 1;
    if (jokerRule && !e.isPlayer && !detours.empty() && e.lap + 1 == e.jokerLap) {
      const Fork &F = detours[0];
      const Detour &dd = *F.d;
      const bool inside = dd.s0 <= dd.s1 ? pr.s >= dd.s0 && pr.s <= dd.s1 : pr.s >= dd.s0 || pr.s <= dd.s1;
      if (inside) { jokerHold = std::max(0.35, std::min(1.0, t.wrap(dd.s1 - dd.s0) / F.len)); e.jokers = 1; }
    }
    const int roadCode = onFork >= 0 ? (detours[(size_t)onFork].d->road != 0 ? detours[(size_t)onFork].d->road : 1)
      : !t.road.empty() && al <= pr.w ? (int)t.road[(size_t)pr.i] : 0;
    if (roadCode) surface = ROAD_MU[roadCode];
    e.roadHold = (!t.road.empty() ? ROAD_HOLD[roadCode] : 1) * jokerHold * (std::isnan(e.stockHold) ? 1 : e.stockHold);
    const bool xg = e.isPlayer && car.xg.on;          // Xingus mode: your car only
    if (xg) surface = roadCode ? std::max(surface, car.xg.loose) : xingusSurface(surface);
    const double drag = roadCode ? ROAD_DRAG[roadCode] : dragFor(surface);
    // LEAVING THE GROUND IS PHYSICS, NOT A TRIGGER. THE GROUND UNDER ITS FOUR WHEELS, in the car's own frame.
    const Ground &T = ground();
    Gnd &gnd = e.gnd;
    T.under(car, pr, gnd);
    // In the air the car keeps the attitude it has while the ground turns under it.
    if (car.airborne) { car.pitch -= gnd.dPitch; car.roll -= gnd.dRoll; }
    if (!e.inPit) {
      // Everything is in the ROAD'S frame; along the car's ACTUAL path, not the lap's.
      const double lift = T.lift(car, pr);              // m/s2, + = the ground is leaving
      if (!car.airborne) {
        if (car.speed > 6 && al <= pr.w + pr.run) {
          const double down = 0.5 * 1.225 * car.spec->ClA * car.speed * car.speed / car.spec->m;
          if (lift > (9.81 + down) * 1.02) {
            car.airborne = true; car.airTime = 0; car.z = 0.03; car.vz = 0.05;
            e.flying = true;
            if (e.isPlayer) log("flag", "AIRBORNE", &e, "jump");
          }
        }
        if (e.flying && !car.airborne) e.flying = false;
      } else car.vz += std::max(-60.0, std::min(60.0, lift)) * dt;
    }
    Env env;
    env.surface = surface; env.bank = gnd.bank; env.bankDir = gnd.dir;
    // on an oval the pack lives in each other's air: the tow is kept, the lost downforce is not
    env.dirty = stock ? 0 : car.dirty; env.tow = car.tow; env.rollMul = xg ? xingusDrag(drag) : drag;
    env.slope = gnd.gx;
    step(car, dt, env);
    // A car in the pit lane is seventeen metres from the centreline: no barrier test there.
    Hit hit;
    if (!(e.inPit || e.onFork)) hit = resolveBarrier(car, t, e.hint);
    if (hit.hit && hit.harm != 0) { e.contacts++; log("crash", e.name + " INTO THE BARRIER", &e); }
    // After the barrier, so a wall costs you speed and nothing else.
    if (xg) { car.xg.bank = pr.bank; xingusStep(car, playerInput ? *playerInput : noInput, dt); }
    // ONE PACK (an oval's stock rules): nobody gets away and nobody is dropped.
    if (stock && racing && !e.inPit && !e.finished && !car.airborne && car.vx > 25) {
      const double dA = e.ahead && !e.ahead->inPit ? t.gap(e.ahead->proj.s, pr.s) : 0, dB = e.behind && !e.behind->inPit ? t.gap(pr.s, e.behind->proj.s) : 0;
      // (a car coming up to speed out of the lane is not waited for)
      const double gA = dA > 0 ? dA / car.vx : 0, gB = dB > 0 && e.behind->car.speed > 0.75 * car.vx ? dB / e.behind->car.speed : 0;
      double dv = 0;
      if (gB > 2.5) dv = -std::min(7.0, (gB - 2.5) * 4) * dt;
      // (to 285 km/h and no more)
      else if (gA > 1.2 && car.throttle > 0.5 && car.vx < 79) dv = std::min(4.0, (gA - 1.2) * 2.5) * dt;
      if (dv != 0) { car.vx += dv; if (car.xg.on) car.xg.vPrev = std::hypot(car.vx, car.vy); }
    }
    // The player's own contacts, handed up for the rumble and the toast.
    if (hit.hit && e.isPlayer && hit.closing > 3.5) e.bump = Bump{true, "barrier", hit.closing, hit.harm, hit.part, nullptr};
    // NO DNF: the damage still counts, it just never reaches the retirement line.
    if (e.isPlayer && noDnf) {
      car.damage = std::min(car.damage, 0.95);
      if (car.onRoof && car.speed < 8) {
        car.onRoof = false; car.airborne = false;
        car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
        log("crash", e.name + " BACK ON FOUR WHEELS", &e);
      }
    }
    // Debris: a wing on the road (race control decides yellow or more).
    const bool wingNow = car.hasLost && (car.lostFrontWing || car.lostRearWing);
    if (wingNow && !e.wingWas) rc.incident("debris", &e);
    e.wingWas = wingNow;
    if (car.damage >= 1 && !e.retired) {
      e.retired = true; log("crash", e.name + " RETIRES", &e); rc.incident("retired", &e);
      if (derby) {
        int left = 0;
        for (const Entry &x : entries) if (!x.retired && !x.isPlayer) left++;
        Entry *by = e.hitBy && time - (e.hitAt != 0 ? e.hitAt : -99) < 4 ? e.hitBy : nullptr;
        if (by) by->wrecks = by->wrecks + 1;
        const bool yours = by && by->isPlayer;
        log("flag", (yours ? "YOU WRECKED " + e.name : e.name + " IS OUT") + " — " + std::to_string(left) + " LEFT"
            + (yours ? " · THAT IS " + std::to_string(by->wrecks) : ""), &e, "derby");
        if (left == 0 && me && !me->retired && state == RaceState::Green) {
          log("flag", "LAST ONE RUNNING — " + std::to_string(me->wrecks) + " WRECKED BY YOU", me, "derby");
          me->finished = true; me->finishTime = time; state = RaceState::Finish;
        }
      }
    }
    // A car on its roof is not rejoining. Retire it once it has stopped sliding.
    if (!e.retired && car.onRoof && car.speed < 8) {
      e.retired = true; log("crash", e.name + " IS UPSIDE DOWN", &e);
      rc.incident("roof", &e);
    }
  }

  carContact();

  // ---- a timed race (Xingus ENDURANCE): the clock, not the lap board, says when
  if (timeLimit > 0 && !timeUp && state == RaceState::Green) {
    int lead = 0;
    for (const Entry &e : entries) if (!e.retired) lead = std::max(lead, e.lap);
    if (time - greenT >= timeLimit) {
      timeUp = true; laps = lead + 1;
      log("flag", "TIME IS UP — THE LEADER'S NEXT CROSSING OF THE LINE ENDS IT", nullptr, "time");
    } else laps = std::max(laps, lead + 2);
  }

  // ---- projection, laps, rules ------------------------------------------------------
  for (Entry &e : entries) {
    if (e.retired) continue;
    const double prev = e.proj.s;
    // A tight window: eight samples either side is already absurdly generous.
    e.proj = t.project(e.car.x, e.car.y, e.hint, 8);
    e.hint = e.proj.i;
    if (drsRule) drsTick(e, prev, racing);

    if (e.proj.s > t.length * 0.42 && e.proj.s < t.length * 0.62) e.pastHalf = true;
    const bool crossed = prev > t.length * 0.8 && e.proj.s < t.length * 0.2;
    if (crossed && racing && !e.finished) {
      if (!e.pastHalf && !e.crossed0) {
        // the grid sits behind the line, so the first crossing is the START
        e.crossed0 = true; e.lapStart = time;
      } else if (!e.pastHalf) {
        // Back over the line and forward again without having been anywhere: not a lap.
      } else {
        e.lap++; e.pastHalf = false;
        const double lt = time - e.lapStart;
        e.lapStart = time;
        e.lastLap = lt;
        if (std::isnan(e.bestLap) || e.bestLap == 0 || lt < e.bestLap) e.bestLap = lt;
        const int leftN = laps - e.lap;
        const std::string left = std::to_string(leftN) + " LAP" + (leftN == 1 ? "" : "S") + " LEFT";
        // The joker you owe: said at the end of every lap until it is paid.
        if (jokerRule && e.isPlayer && !e.jokers && e.lap < laps) log("flag", "JOKER LAP STILL TO TAKE — " + left, &e, "joker");
        // ...and on an oval, the stop you owe.
        const bool owesStop = stock && laneOk && !e.pitStops;
        if (owesStop && e.isPlayer && e.lap < laps) log("flag", "ONE PIT STOP STILL OWED (P) — " + left, &e, "tyres");
        if (e.lap >= laps && owesStop) {
          if (e.isPlayer) log("flag", "NOT FINISHED — YOU STILL OWE A PIT STOP. P, AND COME IN THIS LAP.", &e, "tyres");
          e.pitRequest = e.isPlayer ? e.pitRequest : true;
        } else if (e.lap >= laps && jokerRule && !e.jokers) {
          // Not finished: the flag is not yours until the joker is done.
          if (e.isPlayer) log("flag", "NOT FINISHED — YOU STILL OWE THE JOKER LAP. TAKE IT THIS LAP.", &e, "joker");
          else e.jokerLap = e.lap + 1;
        } else if (e.lap >= laps) {
          e.finished = true; e.finishTime = time;
          // THE COOL-DOWN LAP: everybody eases off, drives the lap round, and the pit lane takes them home.
          if (laneOk) { e.cool = true; e.pitRequest = true; }
          log("flag", e.name + " FINISHES P" + std::to_string(e.pos), &e);
          if (state != RaceState::Finish) { state = RaceState::Finish; log("flag", "CHEQUERED FLAG"); }
        }
      }
    }

    // (Track limits used to live here. Deleted on purpose: the runoff already costs you.)

    // Beached. Nobody teleports any more.
    if (racing && !e.finished) {
      if (!e.recover.on && !e.inPit && e.car.speed < 3.2 && std::fabs(e.proj.lat) > e.proj.w) e.stuck += dt;
      else if (!e.recover.on) e.stuck = 0;
      // A RIVAL that is beached is OUT. YOU are not retired by a timer.
      if (e.stuck > 4 && !e.recover.on && !e.isPlayer && !e.retired && rc.on) {
        e.stuck = 0; e.retired = true;
        log("crash", e.name + " IS OUT — BEACHED", &e);
        rc.incident("retired", &e);
      }
      // AND NOBODY PUSHES YOU EITHER: the marshals wave double yellows at it for as long as it sits there.
      if (e.stuck > 4 && !e.recover.on && !e.retired && e.isPlayer) {
        e.stuck = 0;
        if (rc.on) rc.flag(e.proj.s, 2, 8);
      }
      // (What is left below is the race with `rules: false`, for an A/B.)
      if (e.stuck > 4 && !e.recover.on && !e.retired) {
        const double s0 = e.proj.s - 14;
        double lx, ly, lh;
        int li;
        t.point(s0, lines->race.off[(size_t)t.idx(s0)], lx, ly, lh, li);
        e.recover = Recover{true, 0, e.car.x, e.car.y, e.car.hdg, lx, ly, lh};
        e.stuck = 0;
        // People on a live circuit: race control decides what that needs.
        rc.incident("beached", &e);
      }
      // STOPPED ON THE TRACK, on the tarmac: eight seconds of that and it is a safety car.
      // A car standing nose-to-tail behind another stopped car is TRAFFIC, not an incident.
      const bool inTraffic = e.ahead && !e.ahead->retired && e.ahead->car.speed < 6
        && t.gap(e.ahead->proj.s, e.proj.s) > 0 && t.gap(e.ahead->proj.s, e.proj.s) < 30;
      if (!e.recover.on && !e.inPit && !e.retired && e.car.speed < 2 && std::fabs(e.proj.lat) <= e.proj.w
          && !inTraffic && time - greenT > 10) {
        e.stopT = e.stopT + dt;
        if (e.stopT > 8 && !e.stopCalled) { e.stopCalled = true; rc.incident("stopped", &e); }
      } else { e.stopT = 0; if (e.car.speed > 8) e.stopCalled = false; }
      if (e.recover.on) {
        Recover &R = e.recover;
        R.t += dt;
        const double k = std::min(1.0, R.t / PUSH_TIME);
        // Smoothstep: a crew heaves a car, it does not yank it.
        const double f = k * k * (3 - 2 * k);
        e.car.x = R.x0 + (R.toX - R.x0) * f;
        e.car.y = R.y0 + (R.toY - R.y0) * f;
        double dh = R.toHdg - R.h0;
        while (dh > PI) dh -= 2 * PI;
        while (dh < -PI) dh += 2 * PI;
        e.car.hdg = R.h0 + dh * f;
        // Held still while they push.
        e.car.vx = 0; e.car.vy = 0; e.car.r = 0;
        if (k >= 1) { e.recover.on = false; e.car.vx = 6; }
      }
    }
  }

  rc.tick(dt);
  // `safety` is what the rest of the game has always read: non-zero while the race is neutralised.
  safety = rc.neutral() ? 1 : 0;

  order();
  if (duel && me && racing) cheerTick();
  // The race is over when everyone is home — and, if you took the flag, when YOU are back in your garage.
  const bool coming = me && me->finished && me->cool && !me->parked && !me->retired && time - me->finishTime < 240;
  if (state == RaceState::Finish && !coming) {
    bool all = true;
    for (const Entry &e : entries) if (!(e.finished || e.retired)) { all = false; break; }
    if (all) state = RaceState::Over;
  }
  if (state == RaceState::Finish && !coming) {
    if (finishAt == 0) finishAt = time;
    if (time - finishAt > 30) state = RaceState::Over;
  }
}

// ---- DRS: detection line, then the zone ---------------------------------------------
// e.drsFor = the zone earned, e.drsOk = in it now.
void Race::drsTick(Entry &e, double prev, bool racing) {
  const Track &t = *track;
  const double s = e.proj.s;
  if (!racing || safety > 0 || e.inPit || e.finished || e.retired) { e.drsFor = nullptr; e.drsOk = false; return; }
  for (const DrsZone &z : t.drs) {
    const double a = t.gap(z.detect, prev), b = t.gap(z.detect, s);
    if (a > 0 && b <= 0 && a < 50) {
      e.drsFor = e.lap >= DRS_FROM_LAP && e.lap >= rc.drsFrom && e.ahead && e.aheadGapT < DRS_GAP ? &z : nullptr;
    }
  }
  const bool inZone = e.drsFor && t.drsZoneAt(s) == e.drsFor;
  if (inZone) e.drsOk = std::fabs(t.curv[(size_t)e.proj.i]) < DRS_CURV;
  else { if (e.drsOk || e.drsIn) e.drsFor = nullptr; e.drsOk = false; }
  e.drsIn = inZone;
}

// ---- celebrate the pass: YOUR overtakes, and only the ones that stuck ---------------
void Race::cheerTick() {
  if (me->retired || me->finished || me->inPit || time < 6) return;
  // No passing under the safety car: a place taken behind it is not a pass.
  if (safety > 0) { for (Entry &o : entries) { o.cheerAt = NaN; o.aheadOfMe = -1; } return; }
  const double pMe = progress(*me), half = track->length / 2, L = spec->bodyL;
  for (Entry &o : entries) {
    if (&o == me) continue;
    const double d = progress(o) - pMe;                    // + = they are ahead of you
    const int was = o.aheadOfMe;
    o.aheadOfMe = d > 0 ? 1 : 0;
    if (o.retired || o.inPit || o.recover.on || std::fabs(d) > half) { o.cheerAt = NaN; continue; }
    if (was == 1 && d <= 0) o.cheerAt = time;
    else if (d > 0) o.cheerAt = NaN;
    const double t0 = o.cheerAt;
    if (!std::isnan(t0) && time - t0 >= CHEER_HOLD && -d > L * 0.5) {
      o.cheerAt = NaN;
      if (o.car.speed < me->car.speed * 0.6) continue;
      cheers.push_back(Cheer{time, t0, o.idx, o.name, me->pos, me->lap + 1});
      log("pass", "YOU PASS " + o.name + " FOR P" + std::to_string(me->pos), me);
    }
  }
}

// Only test pairs that are actually near each other: sorted by distance along the track.
void Race::carContact() {
  const Track &t = *track;
  std::vector<Entry *> live;
  for (Entry &e : entries) if (!e.retired && std::isnan(e.garageT)) live.push_back(&e);   // a car in its garage is out of the lane
  std::stable_sort(live.begin(), live.end(), [](const Entry *a, const Entry *b) { return a->proj.s - b->proj.s < 0; });
  for (size_t i = 0; i < live.size(); i++) {
    for (size_t j = i + 1; j < live.size(); j++) {
      const double ds = std::fabs(t.gap(live[j]->proj.s, live[i]->proj.s));
      if (ds > 12) break;                 // sorted, so nothing further can be closer
      // NO inPit GUARD HERE, DELIBERATELY: resolveCars is SAT in WORLD space (see the JS).
      const CarHit hit = resolveCars(live[i]->car, live[j]->car);
      if (hit.hit) { carHits++; if (std::isnan(firstHitAt)) firstHitAt = time; }

      if (hit.hit && (live[i]->isPlayer || live[j]->isPlayer) && hit.closing > 2) {
        Entry *you = live[i]->isPlayer ? live[i] : live[j];
        you->bump = Bump{true, "car", hit.closing, hit.harm, "", live[i]->isPlayer ? live[j] : live[i]};
      }
      // THE DEMO DERBY: every hit that counts breaks the rivals in it a tenth more.
      if (derby && hit.hit && hit.harm > 0.5) {
        Entry *pair[2][2] = {{live[i], live[j]}, {live[j], live[i]}};
        for (auto &xo : pair) {
          Entry *x = xo[0], *o = xo[1];
          x->hitBy = o; x->hitAt = time;
          if (!x->isPlayer) x->car.damage = std::min(1.0, x->car.damage + std::min(0.12, 0.015 + hit.closing * 0.007));
        }
      }
      if (hit.hit && hit.harm > 1.2) {
        Entry *a = live[i], *b = live[j];
        a->contacts++; b->contacts++;
        // Blame sits here because only the session knows the running order: whoever was behind going in.
        Entry *behind = t.gap(a->proj.s, b->proj.s) < 0 ? a : b;
        if (time - (behind->lastBlame != 0 ? behind->lastBlame : -99) > 3 && !xingus) {
          behind->lastBlame = time;
          behind->penalty += 5;
          const Corner *c = t.cornerAt(behind->proj.s);
          const std::string where = c && !c->name.empty() ? c->name : "a straight";
          const double dl = std::fabs(a->proj.lat - b->proj.lat);
          log("penalty",
              behind->name + " +5s CAUSING A COLLISION at " + where + " (closing " + fix1(hit.closing) + " m/s, "
              + (dl < 2.2 ? "nose-to-tail" : "side by side") + ", lap " + std::to_string(behind->lap + 1) + ")",
              behind);
        }
      }
    }
  }
  // The safety car is solid. Driven, not stepped: what the contact does to it is
  // overwritten next substep; what it does to YOU is not.
  SafetyCar &sc = rc.sc;
  if (sc.out && !sc.inLane) {
    for (Entry *e : live) {
      if (std::fabs(t.gap(e->proj.s, sc.s)) > 8) continue;
      const CarHit hit = resolveCars(e->car, sc.car);
      if (hit.hit) { carHits++; if (std::isnan(firstHitAt)) firstHitAt = time; }
      if (hit.hit) {
        rc.scHits = rc.scHits + 1;
        if (e->isPlayer && hit.closing > 2) e->bump = Bump{true, "car", hit.closing, hit.harm, "", nullptr};
      }
    }
  }
}

}  // namespace xbr
