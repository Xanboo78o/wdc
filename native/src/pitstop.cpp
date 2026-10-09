// pitstop.cpp — js/pitstop.js, ported line for line.
#include "pitstop.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>

namespace xbr {

static const double ENTRY_DECEL = 10;      // m/s^2: well under what the car can do, on purpose
static const double MARK = 3.6;            // a teammate's mark, either side of centre
static double sgn1(double v) { const double s = sign(v); return s != 0 ? s : 1; }

const char *pitPhaseName(PitPhase p) {
  switch (p) {
    case PitPhase::None: return "none";
    case PitPhase::Approach: return "approach";
    case PitPhase::Lane: return "lane";
    case PitPhase::Service: return "service";
    case PitPhase::Exit: return "exit";
    default: return "";
  }
}

std::string jsNum(double v) {
  char buf[40];
  const auto r = std::to_chars(buf, buf + sizeof buf, v);
  return std::string(buf, r.ptr);
}

std::vector<std::array<double, 2>> resampleLane(const std::vector<std::pair<double, double>> &pts, double step) {
  std::vector<std::array<double, 2>> out;
  double carry = 0;
  for (size_t i = 1; i < pts.size(); i++) {
    const auto &a = pts[i - 1], &b = pts[i];
    const double len = std::hypot(b.first - a.first, b.second - a.second);
    if (len < 1e-6) continue;
    for (double d = carry; d < len; d += step) {
      const double f = d / len;
      out.push_back({a.first + (b.first - a.first) * f, a.second + (b.second - a.second) * f});
    }
    carry = std::fmod(carry - len, step);
    if (carry < 0) carry += step;
  }
  out.push_back({pts.back().first, pts.back().second});
  // three passes of a 1-2-1 kernel, in place
  for (int pass = 0; pass < 3; pass++)
    for (size_t i = 1; i + 1 < out.size(); i++)
      out[i] = {(out[i - 1][0] + 2 * out[i][0] + out[i + 1][0]) / 4, (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4};
  return out;
}

int GarageLayout::idxAt(double m) const {
  return (int)std::max(0.0, std::min((double)P.size() - 1, jsRound(m / 2)));
}

GarageLayout garageLayout(const Track &track) {
  GarageLayout G;
  if (!track.pit.has || track.pit.pts.size() < 3) return G;
  G.ok = true;
  G.P = resampleLane(track.pit.pts, 2);
  const double usable = ((double)G.P.size() - 1) * 2;
  G.n = (int)std::max(3.0, std::min((double)MAX_BOXES, std::floor((usable - 120) / BOX_PITCH)));
  G.startM = std::max(30.0, (usable - G.n * BOX_PITCH) / 2);
  for (int k = 0; k < G.n; k++) {
    const auto &q = G.P[(size_t)G.idxAt(G.startM + (k + 0.5) * BOX_PITCH)];
    G.s.push_back(track.project(q[0], q[1]).s);
  }
  return G;
}

Lane makeLane(const Track &track, int boxes) {
  Lane L;
  L.entryS = track.pit.has ? track.pit.entryS : 0;
  L.exitS = track.pit.has ? track.pit.exitS : 0;
  // `pit.offset` is signed metres, derived from the geometry (track.cpp).
  L.off = track.pit.has ? track.pit.offset : 0;
  L.len = std::fabs(track.gap(L.exitS, L.entryS));
  L.G = garageLayout(track);
  L.garages = L.G.ok && !L.G.s.empty() ? L.G.n : 0;
  L.boxes = boxes;
  L.trackLen = track.length;
  return L;
}

double Lane::boxS(int i) const {
  if (G.ok && !G.s.empty()) {
    const int g = (i / 2) % G.n, j = i % 2;
    return std::fmod(std::fmod(G.s[(size_t)g] + (j - 0.5) * 2 * MARK, trackLen) + trackLen, trackLen);
  }
  return spreadS(i);
}
// The old even spread: boxes fill the middle of the lane.
double Lane::spreadS(int i) const {
  const double t = boxes > 1 ? (double)i / (boxes - 1) : 0.5;
  const double from = 0.22 * len, to = 0.78 * len;
  const double d = from + (to - from) * t;
  return std::fmod(std::fmod(entryS + d, trackLen) + trackLen, trackLen);
}

// A pit lane is a PATH that peels away and rejoins, not a constant offset.
double laneLat(const Lane &lane, double prog) {
  const double IN = 0.10, OUT = 0.88;
  const auto ease = [](double t) { return t * t * (3 - 2 * t); };
  if (prog < IN) return lane.off * ease(std::max(0.0, prog) / IN);
  if (prog > OUT) return lane.off * ease(std::max(0.0, (1 - prog) / (1 - OUT)));
  return lane.off;
}

// 0 at entry, 1 at exit. Wraps: a pit lane can straddle the start/finish line.
double laneProgress(const Track &track, const Lane &lane, double s) {
  const double L = track.length;
  const double d = std::fmod(std::fmod(s - lane.entryS, L) + L, L);
  return lane.len > 0 ? d / lane.len : 1;
}

bool shouldPit(const Car &car) {
  if (car.hasLost && (car.lostFrontWing || car.lostRearWing)) return true;
  return car.damage > 0.55;
}

Service serviceFor(const Car &car) {
  Service sv;
  double t = SERVICE::tyres;
  if (car.hasLost && (car.lostFrontWing || car.lostRearWing)) { sv.jobs.push_back("nose"); t = std::max(t, SERVICE::nose); }
  else if (car.damage > 0.35) { sv.jobs.push_back("floor"); t = std::max(t, SERVICE::floor); }
  sv.jobs.push_back("tyres");
  sv.time = t;
  return sv;
}

// The controller: aims at a lateral offset and a speed, writes the three inputs.
static void drive(Car &car, const Proj &proj, double targetLat, double targetV, double peak) {
  const double err = targetLat - proj.lat;
  // car.hdg is never wrapped: atan2(sin, cos), not a modulo.
  const double dh = car.hdg - proj.hdg;
  const double head = std::atan2(std::sin(dh), std::cos(dh));
  const double want = std::max(-peak, std::min(peak, err * 0.10 - head * 1.35));
  const double slew = 6 * (1.0 / 120);
  car.delta += std::max(-slew, std::min(slew, want - car.delta));

  const double dv = targetV - car.vx;
  if (dv > 0.4) { car.throttle = std::min(1.0, dv * 0.35); car.brake = 0; }
  else if (dv < -0.4) { car.throttle = 0; car.brake = std::min(1.0, -dv * 0.30); }
  else { car.throttle = 0; car.brake = targetV < 0.2 ? 1 : 0; }

  // THE LIMITER: a device on the car.
  if (car.vx > PIT_SPEED) {
    car.throttle = 0;
    car.brake = std::max(car.brake, std::min(1.0, (car.vx - PIT_SPEED) * 0.50));
  }
}

static bool has(const std::vector<std::string> &jobs, const char *j) {
  return std::find(jobs.begin(), jobs.end(), j) != jobs.end();
}

void repair(Car &car, const std::vector<std::string> &jobs) {
  if (has(jobs, "nose")) {
    // The autopilot re-solves at 0.78x grip while the wing is gone: give it back.
    if (car.hasLost) { car.lostFrontWing = false; car.lostRearWing = false; }
    car.hasCrush = true;
    car.crushFront = 0;
    // The dents in the nose go with the nose; the ones down the side do not.
    const double keep = car.spec->bodyL * 0.22;
    car.dents.erase(std::remove_if(car.dents.begin(), car.dents.end(), [&](const Dent &d) { return !(d.lx < keep); }), car.dents.end());
    car.damage = std::max(0.0, car.damage - 0.55);
  }
  if (has(jobs, "floor")) car.damage = std::max(0.0, car.damage - 0.25);
  if (has(jobs, "tyres")) {
    AxleTyre &t = car.tyre;
    t.wf = 0; t.wr = 0; t.age = 0; t.Tf = 80; t.Tr = 80;
  }
}

bool updateStop(Entry &e, const Track &track, Lane &lane, const Proj &proj, double dt, double peak, std::deque<Entry> *others) {
  Car &car = e.car;
  if (e.pitPhase == PitPhase::Undef) e.pitPhase = PitPhase::None;
  // A car a few metres BEFORE the entry line is at a small negative progress.
  double prog = laneProgress(track, lane, proj.s);
  const double lapP = track.length / std::max(1.0, lane.len);
  if (prog > 1 + (lapP - 1) / 2) prog -= lapP;

  switch (e.pitPhase) {
    case PitPhase::None: {
      if (!e.pitRequest) return false;
      if (lane.closed) return false;                // PIT ENTRY CLOSED (race control)
      // Only commit if the entry is genuinely ahead, and far enough out to slow gently.
      const double to = track.wrap(lane.entryS - proj.s);
      if (to > 620) return false;
      e.pitPhase = PitPhase::Approach;
      return false;
    }
    case PitPhase::Approach: {
      // A PHYSICAL braking curve: sqrt(v_limit^2 + 2 a to). It may only ADD braking.
      const double to = track.wrap(lane.entryS - proj.s);
      const double aim = PIT_SPEED * 0.94;
      const double want = to > 500 ? std::numeric_limits<double>::infinity() : std::sqrt(aim * aim + 2 * ENTRY_DECEL * to);
      if (!e.isPlayer && car.vx > want) { car.brake = std::max(car.brake, std::min(1.0, (car.vx - want) * 0.35)); car.throttle = 0; }
      if (to < 4 || (prog >= 0 && prog < 0.10)) { e.pitPhase = PitPhase::Lane; e.inPit = true; e.entryV = car.vx; e.penIn = e.penalty; }
      return false;
    }
    case PitPhase::Lane: {
      e.inPit = true;
      const double toBox = (laneProgress(track, lane, lane.boxS(e.box)) - prog) * lane.len;
      // A DRIVE-THROUGH is the lane at the limiter and out again. Not under a red flag.
      if (e.driveThru > 0 && !lane.hold) {
        drive(car, proj, laneLat(lane, prog), PIT_SPEED, peak);
        if (toBox < -8) {
          e.driveThru--; e.pitRequest = false; e.pitPhase = PitPhase::Exit;
          e.pitJobs = {"DRIVE-THROUGH"};
          return true;
        }
        return false;
      }
      const double v = toBox < 12 ? std::max(0.0, PIT_SPEED * (toBox / 12)) : PIT_SPEED;
      // THE BOX IS BESIDE THE FAST LANE, NOT ON IT: pull over across the last 28 m.
      const double pull = std::max(0.0, std::min(1.0, (28 - toBox) / 20));
      drive(car, proj, laneLat(lane, prog) + BOX_SIDE * sgn1(lane.off) * pull, v, peak);
      if (toBox < 1.2 && car.speed < 0.6) {
        e.pitPhase = PitPhase::Service;
        const Service svc = serviceFor(car);
        e.pitTimer = svc.time;
        e.pitJobs = svc.jobs;
        // A TIME PENALTY is served here. Never under a red flag.
        const double serve = std::min(e.penalty, std::isnan(e.penIn) ? e.penalty : e.penIn);
        if (serve > 0 && !lane.hold) {
          e.pitTimer += serve;
          e.pitJobs.clear();
          e.pitJobs.push_back(jsNum(serve) + "s PENALTY");
          e.pitJobs.insert(e.pitJobs.end(), svc.jobs.begin(), svc.jobs.end());
          e.penServed = e.penServed + serve;
          e.penalty -= serve;
        }
      }
      return false;
    }
    case PitPhase::Service: {
      e.inPit = true;
      car.throttle = 0; car.brake = 1; car.delta = 0;
      e.pitTimer -= dt;
      if (e.pitTimer > 0) return false;
      // RED FLAG: the car waits in its box, and the work is free.
      if (lane.hold) {
        if (!e.redFixed) { repair(car, {"nose", "floor", "tyres"}); e.redFixed = true; }
        e.pitTimer = 0;
        return false;
      }
      e.redFixed = false;
      // THE RELEASE: the lollipop waits for a car in the fast lane within 25 m —
      // except 1 time in 25, which is an UNSAFE RELEASE.
      if (others) {
        const double me = laneProgress(track, lane, proj.s) * lane.len;
        bool near = false;
        for (Entry &o : *others) {
          if (&o != &e && o.inPit && (o.pitPhase == PitPhase::Lane || o.pitPhase == PitPhase::Exit)
              && o.car.speed > 4 && me - laneProgress(track, lane, o.proj.s) * lane.len > 0
              && me - laneProgress(track, lane, o.proj.s) * lane.len < 25) { near = true; break; }
        }
        if (near) {
          if (std::isnan(e.relRoll)) e.relRoll = std::fmod(std::sin(e.idx * 91.7 + e.pitStops * 13.1) * 43758.5453, 1.0);
          const double r = e.relRoll;
          if (std::fabs(r) > 0.04) return false;        // held: the crew waits
          e.unsafe = true;
        }
      }
      e.relRoll = NaN;
      repair(car, e.pitJobs);
      e.pitStops = e.pitStops + 1;
      e.pitRequest = false;
      e.pitPhase = PitPhase::Exit;
      return true;                                      // served, this frame
    }
    case PitPhase::Exit: {
      e.inPit = true;
      drive(car, proj, laneLat(lane, prog), PIT_SPEED, peak);
      if (prog > 0.985 || prog < 0.05) { e.inPit = false; e.pitPhase = PitPhase::None; }
      return false;
    }
    default: break;
  }
  return false;
}

}  // namespace xbr
