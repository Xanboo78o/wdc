// ui.cpp — the race screen, as index.html + style.css draw it. See ui.hpp.
#include "multiclass.hpp"
#include "ui.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "drivers.hpp"

namespace xbr {

Rgba hex(const std::string &css, float a) {
  Rgba r{{1, 1, 1, a}};
  if (css.size() >= 7 && css[0] == '#') {
    auto h = [&](int i) { return (float)std::stoi(css.substr((size_t)i, 2), nullptr, 16) / 255.0f; };
    r.c[0] = h(1); r.c[1] = h(3); r.c[2] = h(5);
  }
  return r;
}
Rgba mix(const Rgba &a, const Rgba &b, float t) {
  Rgba r;
  for (int i = 0; i < 4; i++) r.c[i] = a.c[i] * t + b.c[i] * (1 - t);
  return r;
}
static Rgba alpha(const Rgba &a, float t) { Rgba r = a; r.c[3] *= t; return r; }
Rgba inkOn(const Rgba &bg) {
  double L = 0;
  const double w[3] = {0.2126, 0.7152, 0.0722};
  for (int i = 0; i < 3; i++) { const double v = bg.c[i]; L += w[i] * (v <= 0.03928 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4)); }
  return L > 0.36 ? hex("#0a0a0a") : hex("#ffffff");
}

HudTheme HudTheme::forTeam(const std::string &teamKey) {
  HudTheme T;
  std::string ui[4];
  if (!teamKey.empty() && teamUI(teamKey, ui)) {
    T.bg = hex(ui[0]); T.ink = hex(ui[1]); T.pri = hex(ui[2]); T.sec = hex(ui[3]);
    T.onpri = inkOn(T.pri);
  }
  return T;
}

std::string fmtLapTime(double s, bool has) {
  if (!has || !(s == s)) return "--:--.---";
  char b[32];
  std::snprintf(b, sizeof b, "%d:%06.3f", (int)std::floor(s / 60), std::fmod(s, 60));
  return b;
}

static const int I9 = Renderer::HUD_I, B7 = Renderer::HUD_B;
static const Rgba GOOD = hex("#3ddc6a"), WARN = hex("#ffc23d"), BAD = hex("#ff4d3d");

// a four-sided plate, corners in CSS pixels
static void plate(Renderer &R, float k, float x0, float y0, float x1, float y1, float x2, float y2, float x3, float y3, const Rgba &c) {
  const float p[8] = {x0 * k, y0 * k, x1 * k, y1 * k, x2 * k, y2 * k, x3 * k, y3 * k};
  R.poly(p, 4, c);
}
// a bar leaning 14 degrees, the HUD's signature
static void skewBar(Renderer &R, float k, float x, float y, float w, float h, const Rgba &c) {
  const float s = h * 0.2493f / 2;      // tan(14deg), about the centre
  plate(R, k, x + s, y, x + w + s, y, x + w - s, y + h, x - s, y + h, c);
}

// ---- js/main.js interval() and rowText() ------------------------------------------
static std::string interval(Race &race, const Entry &ahead, const Entry &e) {
  const double d = race.progress(ahead) - race.progress(e);
  char b[32];
  if (d > race.track->length * 0.97) {
    const int laps = (int)jsRound(d / race.track->length);
    std::snprintf(b, sizeof b, "+%d LAP%s", laps, laps > 1 ? "S" : "");
    return b;
  }
  std::snprintf(b, sizeof b, "+%.1f", d / std::max(e.car.speed, 14.0));
  return b;
}
static void rowText(Race &race, const Entry &e, size_t i, std::string &cls, std::string &gap) {
  cls.clear(); gap.clear();
  if (e.retired) { cls = "dnf"; gap = "DNF"; return; }
  if (race.state == RaceState::Grid) return;
  if (e.finished) {
    if (i == 0) { gap = fmtLapTime(e.finishTime + e.penalty, true); return; }
    const Entry &lead = *race.standings[0];
    char b[32];
    std::snprintf(b, sizeof b, "+%.1f", (e.finishTime + e.penalty) - (lead.finishTime + lead.penalty));
    gap = b;
    return;
  }
  if (e.inPit) { cls = "pit"; gap = "PIT"; return; }
  if (i == 0) { gap = "LEADER"; return; }
  gap = interval(race, *race.standings[i - 1], e);
}
std::string towerGap(Race &race, size_t i) {
  std::string cls, gap;
  if (i < race.standings.size()) rowText(race, *race.standings[i], i, cls, gap);
  return gap;
}

static std::string upper(std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; }

void GameHud::draw(Renderer &R, float k, const HudTheme &T, const HudIn &in) {
  const float W = (float)R.W / k, H = (float)R.H / k;
  const Car &car = *in.car;
  const Rgba PLATE = alpha(T.bg, 0.86f), DIM = mix(T.ink, T.bg, 0.55f);
  Race *race = in.race;
  Entry *me = race ? race->me : nullptr;
  char b[64];
  auto text = [&](float x, float y, float size, const std::string &s, const Rgba &c, Align al, int font, float track = 0) {
    return R.textPx(x * k, y * k, size * k, s, c, al, font, track) / k;
  };
  auto width = [&](float size, const std::string &s, int font, float track = 0) { return R.widthPx(size * k, s, font, track) / k; };

  // ---- #topleft: circuit + car, a title card that fades once you are under way
  if (in.sessionT < 7) {
    R.hudAlpha = in.sessionT < 6 ? 1 : (float)(7 - in.sessionT);
    const std::string name = upper(in.trackName);
    const float w = std::max(width(15, name, I9, 0.1f), width(10, in.carName, B7, 0.14f)) + 36;
    plate(R, k, 22, 18, 22 + w, 18, 22 + w - 10, 65, 22, 65, PLATE);
    R.rect(22 * k, 18 * k, 4 * k, 47 * k, T.pri);
    text(40, 26.5f, 15, name, T.ink, LEFT, I9, 0.1f);
    text(40, 46, 10, in.carName, DIM, LEFT, B7, 0.14f);
    R.hudAlpha = 1;
  }

  // ---- #times: the lap timer, top right
  {
    const bool pos = race != nullptr;
    const float w = 220, x1 = W - 22, x0 = x1 - w;
    const float h = 10 + (pos ? 36 : 0) + 15 + 34 + 19 + 19 + 10;
    plate(R, k, x0 + 10, 18, x1, 18, x1, 18 + h, x0, 18 + h, PLATE);
    plate(R, k, x0 + 10, 18, x1, 18, x1, 21, x0 + 9, 21, T.pri);
    float y = 28;
    const float L = x0 + 22, Rr = x1 - 16;
    if (pos) {
      std::string pv = me->retired ? "DNF" : "P" + std::to_string(me->pos);
      if (me->penalty > 0) pv += " +" + jsNum(me->penalty) + "s";
      text(L, y + 14, 10, "POS", DIM, LEFT, B7, 0.2f);
      text(Rr, y, 30, pv, T.pri, RIGHT, I9);
      y += 36;
    }
    std::string lapNo = std::to_string(std::max(1, in.lap));
    if (race) lapNo = (race->state == RaceState::Formation ? std::string("F") : std::to_string(std::min(race->laps, me->lap + 1))) + "/" + std::to_string(race->laps);
    if (race && race->timeLimit > 0) {
      // a timed race: the lap you are on, and what is left on the clock
      const int left = (int)race->timeLeft();
      char tb[32];
      if (left >= 3600) std::snprintf(tb, sizeof tb, "%d:%02d:%02d", left / 3600, left / 60 % 60, left % 60);
      else std::snprintf(tb, sizeof tb, "%d:%02d", left / 60, left % 60);
      lapNo = std::to_string(me->lap + 1) + "  -  " + (race->timeUp ? std::string("LAST LAP") : std::string(tb) + " LEFT");
    }
    const float lw = text(L, y, 10, "LAP ", DIM, LEFT, B7, 0.2f);
    text(L + lw + 2, y, 10, lapNo, T.ink, LEFT, B7, 0.2f);
    y += 15;
    text(L, y, 30, in.lap > 0 || race ? fmtLapTime(in.lapT, true) : fmtLapTime(0, false), in.invalid ? BAD : T.ink, LEFT, I9);
    y += 34;
    text(L, y + 3, 10, "LAST", DIM, LEFT, B7, 0.2f);
    text(Rr, y, 14, fmtLapTime(in.last, in.hasLast), T.ink, RIGHT, B7, 0.02f);
    y += 19;
    text(L, y + 3, 10, "BEST", DIM, LEFT, B7, 0.2f);
    text(Rr, y, 14, fmtLapTime(in.best, in.hasBest), T.sec, RIGHT, B7, 0.02f);
  }

  // ---- #dash: what is on a real wheel's screen
  {
    const float w = 340, x0 = W / 2 - w / 2, x1 = x0 + w, y1 = H - 20, h = 116, y0 = y1 - h;
    plate(R, k, x0 + 16, y0, x1 - 16, y0, x1, y1, x0, y1, PLATE);
    // fifteen rev lights: five green, five red, five blue, over the top half of
    // the range, flashing blue at the shift point
    const BoxSpec &bx = *in.box->box;
    const double f = (in.box->rpm - (bx.idle + (bx.shiftUp - bx.idle) * 0.45)) / ((bx.shiftUp - bx.idle) * 0.55);
    const int lit = (int)std::max(0.0, std::min(15.0, jsRound(f * 15)));
    const bool over = in.box->rpm >= bx.shiftUp - 60;
    const bool blink = over && std::fmod(in.clock * 1000, 160) < 80;
    const Rgba OFFC = alpha(T.ink, 0.12f), G = hex("#3ddc6a"), Rd = hex("#ff3b2f"), Bl = hex("#4a8cff");
    for (int i = 0; i < 15 && !in.rimLights; i++) {
      const Rgba *c = &OFFC;
      if (blink) c = &Bl;
      else if (i < lit && !over) c = i < 5 ? &G : i < 10 ? &Rd : &Bl;
      skewBar(R, k, W / 2 - 133 + i * 18, y0 + 10, 14, 6, *c);
    }
    const float rowB = y0 + 22 + 47;        // the bottom of the speed / gear row
    std::snprintf(b, sizeof b, "%d", (int)jsRound(car.speed * 2.23694));
    text(W / 2 - 35, rowB - 45, 34, b, T.ink, RIGHT, I9, -0.02f);
    text(W / 2 - 35, rowB - 10, 9, "MPH", DIM, RIGHT, B7, 0.24f);
    const std::string gear = car.selector < 0 ? "R" : std::to_string(in.box->gear + 1);
    text(W / 2, rowB - 47, 52, gear, T.pri, CENTRE, I9);
    // pedals: brake fills from the right, throttle from the left
    const float py = rowB + 8, pw = 140;
    skewBar(R, k, x0 + 26, py, pw, 5, alpha(T.ink, 0.10f));
    skewBar(R, k, x0 + 26 + pw + 8, py, pw, 5, alpha(T.ink, 0.10f));
    if (car.brake > 0.005) skewBar(R, k, x0 + 26 + pw * (1 - (float)car.brake), py, pw * (float)car.brake, 5, BAD);
    if (car.throttle > 0.005) skewBar(R, k, x0 + 26 + pw + 8, py, pw * (float)car.throttle, 5, GOOD);
    // the lights
    struct Lt { std::string t; bool on; float op; };
    std::vector<Lt> ls;
    if (in.spec->drs) ls.push_back({"DRS", car.drsOpen, race && race->drsRule && !car.drsOpen && !(me && me->drsOk) ? 0.35f : 1.0f});
    if (me && (me->pitRequest || me->inPit)) {
      std::string t = "BOX";
      if (me->inPit) { t = "PIT "; if (me->pitTimer > 0) { std::snprintf(b, sizeof b, "%.1f", me->pitTimer); t += b; } }
      ls.push_back({t, me->inPit, 1});
    }
    if (in.usingPad) ls.push_back({"PAD", false, 1});
    float tw = 0;
    for (auto &l : ls) tw += width(9, l.t, B7, 0.2f) + 18 + 6;
    float lx = W / 2 - (tw - 6) / 2;
    for (auto &l : ls) {
      const float w1 = width(9, l.t, B7, 0.2f) + 18;
      R.hudAlpha = l.op;
      skewBar(R, k, lx, py + 12, w1, 15, l.on ? T.pri : alpha(T.ink, 0.08f));
      text(lx + 9, py + 15, 9, l.t, l.on ? T.onpri : DIM, LEFT, B7, 0.2f);
      R.hudAlpha = 1;
      lx += w1 + 6;
    }
  }

  // ---- #msg
  if (!in.msg.empty()) {
    const Rgba sh = hex("#000000", 0.55f);
    text(W / 2 + 0.5f, H * 0.15f + 1, 15, in.msg, sh, CENTRE, I9, 0.24f);
    text(W / 2, H * 0.15f, 15, in.msg, WARN, CENTRE, I9, 0.24f);
  }

  if (!race) return;

  // ---- five lights, then the wait
  if (race->state == RaceState::Grid) {
    const int on = (int)std::max(0.0, std::min(5.0, std::floor((3.2 - race->lights) / 0.5)));
    const float w = 238, x0 = W / 2 - w / 2, y0 = H * 0.13f;
    plate(R, k, x0 + 12, y0, x0 + w - 12, y0, x0 + w, y0 + 54, x0, y0 + 54, PLATE);
    for (int i = 0; i < 5; i++) {
      const float cx = (x0 + 20 + 15 + i * 42) * k, cy = (y0 + 27) * k;
      if (i < on) { R.circle(cx, cy, 22 * k, hex("#ff2a18", 0.22f)); R.circle(cx, cy, 15 * k, hex("#ff6a58")); R.circle(cx, cy, 13 * k, hex("#ff2a18")); }
      else { R.circle(cx, cy, 15 * k, hex("#262c34")); R.circle(cx, cy, 13 * k, hex("#1b1f26")); }
    }
  }

  // ---- the flags (js/flags.js): the panel, the delta, and race control's line to YOU
  {
    float y = 14;
    const char *kind = race->rc.flagFor(me);
    const std::string kd = kind ? kind : "";
    if (!kd.empty()) {
      Rgba bg = hex("#ffd400"), fg = hex("#111111");
      std::string t;
      bool flash = false, cheq = false;
      if (kd == "dyellow") flash = true;
      else if (kd == "blue") { bg = hex("#1f6bff"); fg = hex("#ffffff"); flash = true; }
      else if (kd == "green") { bg = hex("#19c24a"); fg = hex("#ffffff"); }
      else if (kd == "red") { bg = hex("#e8112d"); fg = hex("#ffffff"); }
      else if (kd == "sc") t = "SC";
      else if (kd == "vsc") t = "VSC";
      else if (kd == "vscEnd") { t = "VSC ENDING"; flash = true; }
      else if (kd == "chequered") cheq = true;
      const bool lit = !flash || ((long)(race->time * 4)) % 2 == 0;
      const float w = std::max(132.0f, width(20, t, B7, 0.06f) + 28), x0 = W / 2 - w / 2;
      R.card(x0 * k, y * k, w * k, 46 * k, 8 * k, 2 * k, lit ? bg : hex("#141416", 0.9f), hex("#ffffff", 0.85f));
      if (cheq)
        for (int cy = 0; cy < 5; cy++) for (int cx = 0; cx < (int)(w / 9); cx++)
          if ((cx + cy) & 1) R.rect((x0 + 3 + cx * 9) * k, (y + 2 + cy * 8.4f) * k, 9 * k, 8.4f * k, hex("#111111"));
      if (!t.empty()) text(W / 2, y + 13, 20, t, fg, CENTRE, B7, 0.06f);
      y += 52;
    }
    const double d = race->rc.deltaFor(me);
    if (d == d) {
      std::snprintf(b, sizeof b, "DELTA %s%.1f", d >= 0 ? "+" : "", d);
      const float w = width(15, b, B7, 0.06f) + 20;
      R.rrect((W / 2 - w / 2) * k, y * k, w * k, 23 * k, 6 * k, hex("#0a0c10", 0.82f));
      text(W / 2, y + 4, 15, b, d >= 0 ? hex("#3ee07a") : hex("#ff4d5e"), CENTRE, B7, 0.06f);
      y += 29;
    }
    static const char *ALL[] = {"sc", "scIn", "vsc", "vscEnd", "red", "redPit", "redResume", "standing", "green", "unlap", "pitClosed", "pitOpen"};
    static const char *MINE[] = {"giveBack", "deltaWarn", "blue", "blue2", "ten", "speeding", "pen5", "pen10", "dt", "pen", "incident"};
    const auto &ev = race->events;
    for (auto it = ev.rbegin(); it != ev.rend(); ++it) {
      if (it->t <= seen) break;
      const bool mine = it->car == me->idx;
      bool all = false, min = false;
      for (const char *c : ALL) if (it->code == c) all = true;
      for (const char *c : MINE) if (it->code == c) min = true;
      if ((it->kind == "rc" || it->kind == "penalty") && (all || (mine && (min || it->kind == "penalty")))) { lastEv = *it; hasLast = true; shownAt = race->time; break; }
    }
    if (!ev.empty()) seen = std::max(seen, ev.back().t);
    if (hasLast && race->time - shownAt < 6) {
      const std::string t = upper(lastEv.text);
      const std::string &cd = lastEv.code;
      const Rgba bar = lastEv.kind == "penalty" ? hex("#e8112d")
        : (cd.find("green") != std::string::npos || cd.find("pitOpen") != std::string::npos) ? hex("#19c24a")
        : cd.find("red") != std::string::npos ? hex("#e8112d") : hex("#ffd400");
      const float w = std::min(W * 0.7f, width(14, t, B7, 0.06f) + 28), x0 = W / 2 - w / 2;
      R.rrect(x0 * k, y * k, w * k, 29 * k, 6 * k, hex("#0a0c10", 0.86f));
      R.rect(x0 * k, y * k, 4 * k, 29 * k, bar);
      text(W / 2 + 2, y + 7.5f, 14, t, hex("#ffffff"), CENTRE, B7, 0.06f);
    }
  }

  // ---- #tower: position, who is in front, and by how much
  {
    towerAcc += in.clock - towerT;
    towerT = in.clock;
    if (towerAcc > 0.125 || rows.size() != race->standings.size()) {
      towerAcc = 0;
      rows.clear();
      for (size_t i = 0; i < race->standings.size(); i++) {
        const Entry &e = *race->standings[i];
        Row r;
        r.pos = (int)i + 1; r.chip = hex(e.col); r.name = e.name; r.me = e.isPlayer; r.out = e.retired;
        rowText(*race, e, i, r.cls, r.gap);
        // GT MODE: the number is your place in YOUR class, on your class's colour
        if (race->multi) { r.klassOn = true; r.klass = hex(gtClass(e.klass).col); r.pos = classPos(*race, e); }
        // (Who is SMART, DUMB or SONNY, and in what mood, is NOT shown — Adam: "dont tell me who is
        // what mood and smart". You find out by racing them.)
        rows.push_back(r);
      }
    }
    const float x0 = 22, y0 = 80, w = 236, rh = 19.05f, h = 10 + rh * (float)rows.size();
    R.rect(x0 * k, y0 * k, w * k, h * k, PLATE);
    R.rect(x0 * k, y0 * k, w * k, 3 * k, T.pri);
    float y = y0 + 5;
    for (size_t i = 0; i < rows.size(); i++) {
      const Row &r = rows[i];
      if (i > 0) R.rect(x0 * k, y * k, w * k, 1 * k, alpha(T.ink, 0.06f));
      Rgba posC = DIM, nameC = T.ink, gapC = DIM;
      if (r.me) {
        const bool flash = in.passFlash && ((long)(race->time * 6)) % 2;
        R.rect(x0 * k, y * k, w * k, rh * k, flash ? hex("#1fbf5f") : T.pri);
        posC = nameC = gapC = T.onpri;
      } else if (r.cls == "pit") gapC = WARN;
      else if (r.cls == "dnf") gapC = BAD;
      R.hudAlpha = r.out ? 0.5f : 1;
      if (r.klassOn) { R.rect((x0 + 9) * k, (y + 2.5f) * k, 20 * k, 14 * k, r.klass); posC = hex("#111111"); }
      text(x0 + 26, y + 4, 11, std::to_string(r.pos), posC, RIGHT, I9);
      skewBar(R, k, x0 + 33, y + 3, 4, 13, r.chip);
      std::string nm = r.name;
      while (nm.size() > 3 && width(11, nm, B7, 0.06f) > (r.tag.empty() ? 122 : 92)) nm.pop_back();
      if (!r.tag.empty()) text(x0 + w - 52, y + 6, 7.5f, r.tag, r.me ? posC : r.tagC, RIGHT, B7, 0.1f);
      text(x0 + 44, y + 4, 11, nm, nameC, LEFT, B7, 0.06f);
      text(x0 + w - 10, y + 4.5f, 10, r.gap, gapC, RIGHT, B7, 0.06f);
      R.hudAlpha = 1;
      y += rh;
    }
  }
}

void GameHud::pause(Renderer &R, float k, const HudTheme &T, const std::vector<std::string> &items, int at, const std::string &say) {
  const float W = (float)R.W / k, H = (float)R.H / k;
  const Rgba DIM = mix(T.ink, T.bg, 0.55f);
  R.rect(0, 0, (float)R.W, (float)R.H, alpha(T.bg, 0.70f));
  float w = 340;
  for (const auto &s : items) w = std::max(w, R.widthPx(16 * k, s, I9, 0.1f) / k + 56);
  const float h = 24 + 34 + (say.empty() ? 0 : 18) + 34 * (float)items.size() + 14 + 12 + 18;
  const float x0 = W / 2 - w / 2, y0 = H / 2 - h / 2;
  plate(R, k, x0, y0, x0 + w, y0, x0 + w - 18, y0 + h, x0, y0 + h, T.bg);
  R.rect(x0 * k, y0 * k, w * k, 4 * k, T.pri);
  float y = y0 + 24;
  R.textPx((x0 + 28) * k, y * k, 22 * k, "PAUSED", T.ink, LEFT, I9, 0.18f);
  y += 34;
  if (!say.empty()) { R.textPx((x0 + 28) * k, (y - 6) * k, 11 * k, say, DIM, LEFT, B7, 0.04f); y += 18; }
  pauseBoxes.clear();
  for (size_t i = 0; i < items.size(); i++) {
    const bool on = (int)i == at;
    pauseBoxes.push_back({x0 * k, y * k, w * k, 34 * k});
    if (on) {
      // the lit row: team colour fading out to the right, and a slanted tick
      for (int s = 0; s < 8; s++) R.rect((x0 + w * 0.1f * (float)s) * k, y * k, w * 0.1f * k + 1, 34 * k, alpha(T.pri, 0.24f * (1 - (float)s / 8)));
      skewBar(R, k, x0 + 10, y + 7, 4, 20, T.pri);
    }
    R.textPx((x0 + 28) * k, (y + 9) * k, 16 * k, items[i], on ? T.ink : DIM, LEFT, I9, 0.1f);
    y += 34;
  }
  R.textPx((x0 + 28) * k, (y + 14) * k, 10 * k, "D-PAD MOVE  -  START SELECT  -  ESC CLOSE", DIM, LEFT, B7, 0.16f);
}

void GameHud::loading(Renderer &R, float k, const HudTheme &T, const std::string &text) {
  R.rect(0, 0, (float)R.W, (float)R.H, T.bg);
  R.textPx((float)R.W / 2, (float)R.H / 2 - 6 * k, 12 * k, text, mix(T.ink, T.bg, 0.55f), CENTRE, B7, 0.24f);
}

void GameHud::results(Renderer &R, float k, const HudTheme &T, Race &race, const std::string &title, const std::string &line) {
  const float W = (float)R.W / k, H = (float)R.H / k;
  const Rgba DIM = mix(T.ink, T.bg, 0.55f);
  R.rect(0, 0, (float)R.W, (float)R.H, T.bg);
  // radial-gradient(120% 90% at 50% 0%, pri 9% -> bg 60%): a glow from the top
  for (int i = 0; i < 12; i++) R.rect(0, std::floor(H * 0.05f * (float)i * k), (float)R.W, std::floor(H * 0.05f * (float)(i + 1) * k) - std::floor(H * 0.05f * (float)i * k), alpha(T.pri, 0.09f * (1 - (float)i / 12)));
  const float ts = std::max(34.0f, std::min(66.0f, W * 0.07f));
  // "A <span>B</span>": the second half in the team's colour
  std::string a = title, bq;
  const size_t s0 = title.find("<span>"), s1 = title.find("</span>");
  if (s0 != std::string::npos && s1 != std::string::npos) { a = title.substr(0, s0); bq = title.substr(s0 + 6, s1 - s0 - 6); }
  const float wa = R.widthPx(ts * k, a, I9, 0.16f) / k, wb = R.widthPx(ts * k, bq, I9, 0.16f) / k;
  const int n = (int)race.standings.size();
  const float rowH = 28, tableH = std::min(H * 0.56f, 12 + rowH * (float)n);
  float y = (H - (ts + 34 + 18 + tableH + 18 + 47)) / 2;
  float x = W / 2 - (wa + wb) / 2;
  R.textPx(x * k, y * k, ts * k, a, T.ink, LEFT, I9, 0.16f);
  R.textPx((x + wa + ts * 0.16f) * k, y * k, ts * k, bq, T.pri, LEFT, I9, 0.16f);
  y += ts + 10;
  const Entry *me = race.me;
  std::string facts;
  if (me) {
    if (me->retired) facts = "YOU DID NOT MAKE THE FINISH";
    else {
      facts = "P" + std::to_string(me->pos) + " OF " + std::to_string(n);
      if (me->bestLap == me->bestLap) facts += "  -  BEST LAP " + fmtLapTime(me->bestLap, true);
      if (me->penalty > 0) facts += "  -  " + jsNum(me->penalty) + "S OF PENALTIES";
    }
  }
  R.textPx(W / 2 * k, y * k, 13 * k, upper(line) + "   " + facts, DIM, CENTRE, B7, 0.09f);
  y += 24 + 18;
  const float tw = std::min(600.0f, W - 48), tx = W / 2 - tw / 2;
  R.rect(tx * k, y * k, tw * k, tableH * k, mix(T.ink, T.bg, 0.04f));
  R.rect(tx * k, y * k, tw * k, 4 * k, T.pri);
  float ry = y + 6;
  const int fit = (int)((tableH - 12) / rowH);
  for (int i = 0; i < n && i < fit; i++) {
    const Entry &e = *race.standings[(size_t)i];
    std::string cls, gap;
    rowText(race, e, (size_t)i, cls, gap);
    Rgba posC = DIM, nameC = T.ink, gapC = cls == "pit" ? WARN : cls == "dnf" ? BAD : DIM;
    if (e.isPlayer) { R.rect(tx * k, ry * k, tw * k, rowH * k, T.pri); posC = nameC = gapC = T.onpri; }
    R.hudAlpha = e.retired ? 0.5f : 1;
    R.textPx((tx + 28) * k, (ry + 7.5f) * k, 13 * k, std::to_string(i + 1), posC, RIGHT, I9);
    skewBar(R, k, tx + 35, ry + 7, 4, 13, hex(e.col));
    float nx = tx + 46;
    nx += R.textPx(nx * k, (ry + 7.5f) * k, 13 * k, e.name, nameC, LEFT, B7, 0.06f) / k + 8;
    if (e.penalty > 0) nx += R.textPx(nx * k, (ry + 7.5f) * k, 13 * k, "+" + jsNum(e.penalty) + "s", e.isPlayer ? T.onpri : WARN, LEFT, B7, 0.06f) / k + 8;
    if (e.bestLap == e.bestLap) R.textPx(nx * k, (ry + 9.5f) * k, 10 * k, fmtLapTime(e.bestLap, true), e.isPlayer ? T.onpri : hex("#6c7687"), LEFT, B7, 0.06f);
    R.textPx((tx + tw - 14) * k, (ry + 8) * k, 12 * k, gap, gapC, RIGHT, B7, 0.06f);
    R.hudAlpha = 1;
    ry += rowH;
  }
  y += tableH + 18;
  // MENU: the go button, a parallelogram in the team's colour
  const float bw = R.widthPx(17 * k, "MENU", I9, 0.2f) / k + 124, bx = W / 2 - bw / 2;
  menuBox = {bx * k, y * k, bw * k, 47 * k};
  plate(R, k, bx + 12, y, bx + bw, y, bx + bw - 12, y + 47, bx, y + 47, T.pri);
  R.textPx(W / 2 * k, (y + 15) * k, 17 * k, "MENU", T.onpri, CENTRE, I9, 0.2f);
}

}  // namespace xbr
