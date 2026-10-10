// home_career.cpp — the front door and the career's pages: THE HUB (home), CAREER,
// EVENTS, a STORY card, and the DEBRIEF after an event. Native only; see
// career.hpp for the rules and data/career/ for every word these pages say.
//
// These pages are laid out on a sheet 900 units tall and at least 1600 wide and
// the sheet is scaled to the window, so 1280x720 is the same page, smaller.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <ctime>

#include "home.hpp"
#include "multiclass.hpp"
#include "homestyle.hpp"
#include "race.hpp"
#include "ui.hpp"

namespace xbr {

namespace {

const int A = Renderer::ANTON, RB = Renderer::RUBIK, MK = Renderer::MARKER;
const Rgba BRONZE = hex("#c9803a"), SILVER = hex("#c9ced6"), GOLD = hex("#f5c542"), MOON = hex("#efe6c8");
// the hard shadow under a card: black in the night paddock, a soft deeper blue in the pro look
static inline Rgba NIGHTC() { return STYLE_PRO ? alpha_(hex("#081d45"), 0.55f) : hex("#07050b"); }

std::string upper(std::string s) { for (char &c : s) c = (char)std::toupper((unsigned char)c); return s; }
std::string lapText(double s) {
  char b[32];
  std::snprintf(b, sizeof b, "%d:%06.3f", (int)(s / 60), std::fmod(s, 60.0));
  return b;
}
const char *kindName(const std::string &k) {
  static const char *T[][2] = {{"hotlap", "HOT LAP"}, {"lasttofirst", "LAST TO FIRST"}, {"elimination", "ELIMINATION"}, {"duel", "DUEL"},
                               {"nightstorm", "NIGHT STORM"}, {"the78", "THE 78"}, {"derby", "DEMO DERBY"}, {"rallycross", "RALLYCROSS"}};
  for (auto &t : T) if (k == t[0]) return t[1];
  return "ROUND";
}

// the sheet: every number below is in its units
struct Pen {
  Renderer &R;
  float k, W, H;
  Pen(Renderer &r, float k0) : R(r) {
    const float w = (float)r.W / k0, h = (float)r.H / k0;
    const float z = std::max(0.4f, std::min(w / 1600.0f, h / 900.0f));
    k = k0 * z; W = (float)r.W / k; H = (float)r.H / k;
  }
  float text(float x, float y, float size, const std::string &s, const Rgba &c, Align al = LEFT, int font = RB, float track = 0) const {
    return R.textPx(x * k, y * k, size * k, s, c, al, font, track) / k;
  }
  float width(float size, const std::string &s, int font = RB, float track = 0) const { return R.widthPx(size * k, s, font, track) / k; }
  void rect(float x, float y, float w, float h, const Rgba &c) const { R.rect(x * k, y * k, w * k, h * k, c); }
  void rr(float x, float y, float w, float h, float r, const Rgba &c) const { R.rrect(x * k, y * k, w * k, h * k, r * k, c); }
  void card(float x, float y, float w, float h, float r, float bw, const Rgba &fill, const Rgba &line) const { R.card(x * k, y * k, w * k, h * k, r * k, bw * k, fill, line); }
  void circle(float x, float y, float r, const Rgba &c) const { R.circle(x * k, y * k, r * k, c); }
  void poly(std::vector<float> p, const Rgba &c) const { for (float &v : p) v *= k; R.poly(p.data(), (int)p.size() / 2, c); }
  void path(std::vector<float> p, float w, const Rgba &c, bool closed = false) const { for (float &v : p) v *= k; R.path(p.data(), (int)p.size() / 2, w * k, c, closed); }
  void rot(float cx, float cy, float deg) const { R.hudRot(cx * k, cy * k, deg); }
  void unrot() const { R.hudRot(0, 0, 0); }
  // cut to fit, with nothing to say it was cut: the callers size their boxes so the usual text fits
  std::string fit(float size, std::string s, int font, float track, float maxw) const {
    while (s.size() > 3 && width(size, s, font, track) > maxw) s.pop_back();
    return s;
  }
  std::vector<std::string> wrap(float size, const std::string &s, int font, float maxw, float track = 0) const {
    std::vector<std::string> out;
    std::string line, word;
    auto flush = [&] {
      if (word.empty()) return;
      const std::string t = line.empty() ? word : line + " " + word;
      if (!line.empty() && width(size, t, font, track) > maxw) { out.push_back(line); line = word; } else line = t;
      word.clear();
    };
    for (char c : s) { if (c == ' ') flush(); else word += c; }
    flush();
    if (!line.empty()) out.push_back(line);
    return out;
  }
};

// ---- a little Halloween, drawn small ------------------------------------------------------
void pumpkin(const Pen &P, float cx, float cy, float s) {
  if (STYLE_PRO) return;                     // the pro menus carry no props
  const Rgba OR = hex("#ff7a14"), DK = hex("#a8440a"), GL = hex("#ffe14d"), ST = hex("#3d6b1f");
  P.rect(cx - s * 0.04f, cy - s * 0.48f, s * 0.1f, s * 0.2f, ST);
  P.rr(cx - s * 0.42f, cy - s * 0.30f, s * 0.84f, s * 0.70f, s * 0.33f, DK);
  P.rr(cx - s * 0.37f, cy - s * 0.25f, s * 0.74f, s * 0.60f, s * 0.28f, OR);
  P.poly({cx - s * 0.24f, cy - s * 0.02f, cx - s * 0.10f, cy - s * 0.13f, cx - s * 0.06f, cy + s * 0.02f}, GL);
  P.poly({cx + s * 0.24f, cy - s * 0.02f, cx + s * 0.10f, cy - s * 0.13f, cx + s * 0.06f, cy + s * 0.02f}, GL);
  P.rr(cx - s * 0.24f, cy + s * 0.12f, s * 0.48f, s * 0.10f, s * 0.05f, GL);
}
void moon(const Pen &P, float cx, float cy, float r) {
  if (STYLE_PRO) return;                     // the pro menus carry no props
  P.circle(cx, cy, r * 1.9f, alpha_(MOON, 0.04f));
  P.circle(cx, cy, r * 1.45f, alpha_(MOON, 0.06f));
  P.circle(cx, cy, r * 1.15f, alpha_(MOON, 0.10f));
  P.circle(cx, cy, r, MOON);
  const Rgba cr = mix(MOON, hex("#8f8a78"), 0.72f);
  P.circle(cx - r * 0.32f, cy - r * 0.22f, r * 0.20f, cr);
  P.circle(cx + r * 0.30f, cy + r * 0.10f, r * 0.14f, cr);
  P.circle(cx - r * 0.05f, cy + r * 0.48f, r * 0.11f, cr);
  P.circle(cx + r * 0.22f, cy - r * 0.50f, r * 0.08f, cr);
}
void bat(const Pen &P, float cx, float cy, float s, double clock, float phase) {
  if (STYLE_PRO) return;                     // the pro menus carry no props
  const float f = (float)std::sin(clock * 5.0 + phase), up = s * 0.45f * f;
  const Rgba c = NIGHTC();
  for (float d : {-1.0f, 1.0f}) {
    P.poly({cx, cy - s * 0.10f, cx + d * s * 0.55f, cy - s * 0.30f - up * 0.5f, cx + d * s * 0.50f, cy + s * 0.10f - up * 0.3f, cx, cy + s * 0.14f}, c);
    P.poly({cx + d * s * 0.50f, cy + s * 0.10f - up * 0.3f, cx + d * s * 0.55f, cy - s * 0.30f - up * 0.5f, cx + d * s * 1.05f, cy - s * 0.12f - up}, c);
    P.poly({cx + d * s * 0.02f, cy - s * 0.10f, cx + d * s * 0.16f, cy - s * 0.34f, cx + d * s * 0.18f, cy - s * 0.08f}, c);      // an ear
  }
  P.circle(cx, cy, s * 0.17f, c);
}
// a cobweb in the top-right corner, and whoever lives in it
void cobweb(const Pen &P, float size, double clock) {
  if (STYLE_PRO) return;                     // the pro menus carry no props
  const Rgba c = alpha_(INK, 0.30f);
  const float ox = P.W, oy = 0;
  const int N = 5;
  float ax[N], ay[N];
  for (int i = 0; i < N; i++) { const float a = (float)(PI * (0.5 + 0.5 * i / (N - 1))); ax[i] = std::cos(a); ay[i] = std::sin(a); }
  for (int i = 0; i < N; i++) P.path({ox, oy, ox + ax[i] * size * (i == 2 ? 1.0f : 0.9f), oy + ay[i] * size * (i == 2 ? 1.0f : 0.9f)}, 1.3f, c);
  for (float ring : {0.30f, 0.52f, 0.76f})
    for (int i = 0; i + 1 < N; i++) {
      // each thread sags toward the corner
      const float x0 = ox + ax[i] * size * ring, y0 = oy + ay[i] * size * ring, x1 = ox + ax[i + 1] * size * ring, y1 = oy + ay[i + 1] * size * ring;
      const float mx = (x0 + x1) / 2 + (ox - (x0 + x1) / 2) * 0.16f, my = (y0 + y1) / 2 + (oy - (y0 + y1) / 2) * 0.16f;
      P.path({x0, y0, mx, my, x1, y1}, 1.1f, c);
    }
  // the spider: on a thread, going up and down very slowly, in no hurry
  const float sx = ox - size * 0.52f, len = size * (0.62f + 0.10f * (float)std::sin(clock * 0.45));
  P.path({sx, 0, sx, len}, 1.0f, c);
  P.circle(sx, len + 5, 5, NIGHTC());
  P.circle(sx, len - 1, 3, NIGHTC());
  for (float d : {-1.0f, 1.0f}) for (int q = 0; q < 3; q++) P.path({sx, len + 3 + q * 2.0f, sx + d * 9, len - 2 + q * 5.0f}, 1.0f, NIGHTC());
}
void medalDisc(const Pen &P, float cx, float cy, float r, int medal, bool lit) {
  const Rgba c = medal == 3 ? GOLD : medal == 2 ? SILVER : BRONZE;
  P.circle(cx, cy, r, lit ? INK : alpha_(INK, 0.25f));
  P.circle(cx, cy, r - 2.5f, lit ? c : CARD);
  if (lit) P.circle(cx - r * 0.25f, cy - r * 0.25f, r * 0.28f, alpha_(hex("#ffffff"), 0.35f));
}
void tick(const Pen &P, float cx, float cy, float s, const Rgba &c) { P.path({cx - s * 0.5f, cy, cx - s * 0.12f, cy + s * 0.38f, cx + s * 0.55f, cy - s * 0.42f}, s * 0.26f, c); }
void cross(const Pen &P, float cx, float cy, float s, const Rgba &c) {
  P.path({cx - s * 0.4f, cy - s * 0.4f, cx + s * 0.4f, cy + s * 0.4f}, s * 0.24f, c);
  P.path({cx + s * 0.4f, cy - s * 0.4f, cx - s * 0.4f, cy + s * 0.4f}, s * 0.24f, c);
}
void padlock(const Pen &P, float cx, float cy, float s, const Rgba &c) {
  P.path({cx - s * 0.26f, cy - s * 0.05f, cx - s * 0.26f, cy - s * 0.36f, cx, cy - s * 0.56f, cx + s * 0.26f, cy - s * 0.36f, cx + s * 0.26f, cy - s * 0.05f}, s * 0.14f, c);
  P.rr(cx - s * 0.40f, cy - s * 0.08f, s * 0.80f, s * 0.58f, s * 0.12f, c);
}
// the dark the pages sit on: the race is still there, behind it
void wash(const Pen &P, float a) { P.R.rect(0, 0, (float)P.R.W, (float)P.R.H, alpha_(PAPER, a)); }

}  // namespace

// ---------------------------------------------------------------------------------------------
// the rules of the pages
// ---------------------------------------------------------------------------------------------
bool Home::startEvent(const EventDef &e, bool inCareer) {
  if (eventOn) { S = S0; eventOn = false; }
  career.out = Outcome{};
  if (!career.prepare(e, inCareer, S.track, S.car, S.tier)) return false;
  Launch &L = career.L;
  if (L.hot) career.medalTimes(L.track, L.car, 0, L.medal);
  if (!savePath.empty()) S.save(savePath);
  S0 = S; eventOn = true;
  S.car = L.car; S.mode = L.hot ? "hotlap" : "race"; S.laps = L.laps; S.grid = L.grid; S.tier = L.tier; S.noDnf = L.noDnf; S.battle = "medium";
  if (!L.time.empty()) S.time = L.time;
  if (!L.weather.empty()) S.weather = L.weather;
  if (L.career) S.model = L.model;
  S.xOn = L.xingus;
  if (L.xingus) {
    S.xStyle = L.xstyle; S.xBots = 0;
    if (L.track.rfind("heil", 0) == 0) { S.xTrack = "heiligen"; S.xHeil = L.track; }
    else { S.xTrack = L.track; if (L.track != "speedway") S.track = L.track; }
  } else S.track = L.track;
  gtLeagues = 7;
  wantStart = true;
  return true;
}
bool Home::startKey(const std::string &key) {
  const EventDef *e = career.find(key);
  if (!e) return false;
  const bool ok = startEvent(*e, e->season >= 0);
  wantStart = false;                               // an unattended run starts the session itself
  return ok;
}
std::string Home::eventBrief() const {
  if (!eventOn || !career.L.ev) return "";
  const Launch &L = career.L;
  if (L.hot && L.medal[2] > 0) return "BRONZE " + lapText(L.medal[0]) + "  -  SILVER " + lapText(L.medal[1]) + "  -  GOLD " + lapText(L.medal[2]);
  return career.objText(*L.ev, &L);
}
HudTheme Home::eventTheme() const {
  HudTheme T;
  T.bg = PAPER; T.ink = INK; T.pri = RED; T.sec = YELL; T.onpri = ONRED;
  return T;
}
void Home::eventResult(Race *race, bool hasBest, double best, double ideal) {
  if (eventOn && !career.out.has) career.finish(race, hasBest, best, ideal);
}
void Home::leaveEvent(Race *race, bool hasBest, double best, double ideal) {
  if (!eventOn) return;
  if (!career.out.has && career.L.hot) career.finish(nullptr, hasBest, best, ideal);      // a hot lap ends when you say so
  landPage = career.out.has ? "debrief" : career.L.career ? "career" : "events";
  // what you changed from the pause menu is yours to keep; the rest was the event's
  S0.cam = S.cam; S0.line = S.line; S0.ffb = S.ffb; S0.volume = S.volume;
  S = S0; eventOn = false;
  career.clear();
  viewSeason = -1;
}
std::string Home::landing() { std::string p = landPage.empty() ? "home" : landPage; landPage.clear(); return p; }

void Home::story(const std::vector<int> &cardsIn, const std::string &head, std::function<void()> then, bool replay) {
  storyQ = cardsIn; storyAt = 0; storyHead = head; storyThen = std::move(then); storyReplay = replay;
  if (storyQ.empty()) { auto t = std::move(storyThen); storyThen = nullptr; if (t) t(); return; }
  show("story");
}
void Home::storyStep(int d) {
  if (storyQ.empty()) { show("career"); return; }
  const bool skip = d > 1;
  if (!storyReplay) { if (skip) for (int c : storyQ) career.seen(c); else if (d > 0) career.seen(storyQ[(size_t)storyAt]); }
  storyAt = skip ? (int)storyQ.size() : std::max(0, storyAt + d);
  if (storyAt < (int)storyQ.size()) return;
  storyQ.clear(); storyAt = 0;
  auto t = std::move(storyThen);
  storyThen = nullptr;
  if (t) t(); else show("career");
}
void Home::launchCareer(const EventDef &e) {
  if (!career.unlocked(e)) {
    if (!career.seasonOpen(e.season)) say("locked. that season needs the top " + std::to_string(career.seasons[(size_t)e.season - 1].promote) + " of the one before.");
    else say("locked. one thing at a time. the one above it first.");
    return;
  }
  const EventDef *ep = &e;
  auto go = [this, ep] { if (!startEvent(*ep, true)) { show("career"); say("that circuit is not on this machine yet."); } };
  auto pre = [this, ep, go] {
    const std::string head = std::string(ep->kind == "round" ? "ROUND " + std::to_string(ep->round) : kindName(ep->kind)) + " - " + ep->title;
    story(career.pending("pre:" + ep->key, false, false), head, go);
  };
  if (!career.introSeen()) story(career.pending("intro", false, false), "CHASING THE WDC", pre);
  else pre();
}
void Home::afterDebrief() {
  const Outcome o = career.out;
  career.out = Outcome{};
  const std::string dest = o.career ? "career" : "events";
  viewSeason = -1;
  const EventDef *e = o.career ? career.find(o.key) : nullptr;
  if (e && o.valid) {
    const bool champ = career.place(e->season) == 1;
    story(career.pending("post:" + o.key, o.met, champ), "AFTER " + o.title, [this, dest] { viewSeason = -1; show(dest); });
    return;
  }
  show(dest);
}

// The strip over the RESULTS screen: what the race meant.
void Home::drawOutcome(Renderer &R, float k0) {
  const Outcome &o = career.out;
  if (!o.has) return;
  const Pen P(R, k0);
  const std::string more = o.unlocked.empty() ? "" : o.unlocked[0];
  const float w = std::min(P.W - 48, std::max({620.0f, P.width(13, o.objective + "   " + o.detail, RB, 0.08f) + 250, P.width(13, more, RB, 0.08f) + 250})), x = P.W / 2 - w / 2, y = 14, h = 76;
  P.rot(P.W / 2, y + h / 2, -0.6f);
  P.rr(x + 5, y + 6, w, h, 14, o.met ? YELL : RED);
  P.card(x, y, w, h, 14, 2.5f, CARD, INK);
  const Rgba hc = o.met ? YELL : o.valid ? RED : SOFT;
  P.circle(x + 40, y + h / 2, 22, hc);
  if (o.met) tick(P, x + 40, y + h / 2, 22, ONRED); else cross(P, x + 40, y + h / 2, 20, ONRED);
  P.text(x + 76, y + 10, 30, o.headline, hc, LEFT, A, 0.03f);
  P.text(x + 76, y + 47, 12, P.fit(12, o.objective + "   -   " + o.detail, RB, 0.08f, w - 96), INK, LEFT, RB, 0.08f);
  if (!more.empty()) P.text(x + w - 18, y + 20, 11, P.fit(11, more, RB, 0.1f, w - 110 - P.width(30, o.headline, A, 0.03f)), SOFT, RIGHT, RB, 0.1f);
  P.unrot();
}

// ---------------------------------------------------------------------------------------------
// THE HUB
// ---------------------------------------------------------------------------------------------
void Home::drawHub(Renderer &R, float k0, double clock) {
  const Pen P(R, k0);
  auto hot = [&](float x, float y, float w, float h, int item) { hots.push_back({x * P.k, y * P.k, w * P.k, h * P.k, item, nullptr}); };
  const float W = P.W, H = P.H;
  if (STYLE_PRO) {
    // ---- THE FILM (ad-cinematic.html). Two black bars and the picture between
    // them; the menu is lettering on the picture, not furniture in front of it.
    const float bar = H * 0.115f, RULE = 3;
    for (int i = 0; i < 28; i++) P.rect((float)i * 22, bar, 22.5f, H - 2 * bar, alpha_(PAPER, 0.62f * (1 - (float)i / 28)));
    for (int i = 0; i < 22; i++) P.rect(W - (float)(i + 1) * 22, bar, 22.5f, H - 2 * bar, alpha_(PAPER, 0.55f * (1 - (float)i / 22)));
    // a moving colour breathes over the photograph too (homestyle.hpp STYLE_MOVING)
    if (STYLE_MOVING || STYLE_BASS > 0.02f) {
      const int N = 22;
      const float amt = (STYLE_MOVING ? 1.0f : 0.0f) + 0.9f * STYLE_BASS + 0.2f * STYLE_PULSE;    // the music fills the picture with it, gently
      for (int q = 0; q < N; q++) {
        const float t = (float)q / (N - 1);
        const float a = (0.10f * (0.5f + 0.5f * std::sin(t * 3.1f + (float)clock * 0.11f)) + 0.03f) * amt;
        P.rect(0, bar + t * (H - 2 * bar), W, (H - 2 * bar) / N + 1, alpha_(mix(STYLE_GLOW, RED, t), a));
      }
    }
    // the photograph turns over every eleven seconds, through black
    {
      const float ph = (float)std::fmod(clock, 11.0), a = std::max(1 - ph / 0.8f, (ph - 10.2f) / 0.8f);
      if (a > 0) P.rect(0, bar, W, H - 2 * bar, alpha_(PAPER, std::min(1.0f, a)));
    }
    P.rect(0, 0, W, bar, PAPER); P.rect(0, H - bar, W, bar, PAPER);
    // the mark, as the film ends on it
    {
      const float x = 56, y = bar / 2 - 23;
      const float ms = 46 * (1 + 0.02f * STYLE_PULSE);                 // the mark bumps on the beat
      const float w1 = P.text(x, y - (ms - 46) / 2, ms, "XB", INK, LEFT, A, 0.02f);
      P.text(x + w1, y - (ms - 46) / 2, ms, "R", RED, LEFT, A, 0.02f);
      P.text(W - 56, bar / 2 - 6, 11, "R A C I N G   F O R   A L L", SOFT, RIGHT, RB, 0.5f);
    }
    const EventDef *nx = career.next();
    const bool open = nx && career.unlocked(*nx);
    auto label = [&](const EventDef &e) { return e.kind == "round" ? "ROUND " + std::to_string(e.round) : std::string(kindName(e.kind)); };
    const Team *team = teamKey().empty() ? nullptr : teamByKey(teamKey());
    int openN = 0;
    for (const EventDef &m : career.modes) if (career.modeOpen(m)) openN++;
    // ---- the list: six words down the left
    {
      const std::string subs[6] = {
        !nx ? "ALL OF IT. DONE." : (open ? "NEXT  -  " : "LOCKED  -  ") + label(*nx) + ": " + upper(nx->title),
        "ANY CIRCUIT  -  " + upper(circuitName(S.track)), std::to_string(openN) + " OF " + std::to_string(career.modes.size()) + " MODES OPEN",
        "ARCADE. DRIFT. NO SPINS.", team ? upper(team->name) : "PICK A TEAM", "SOUND  -  LOOK  -  WHEEL"};
      const char *names[6] = {"CAREER", "RACE", "EVENTS", "XINGUS", "GARAGE", "SETTINGS"};
      const float x = 56, step = (H - 2 * bar - 110) / 6;
      float y = bar + 54;
      for (int i = 0; i < 6; i++) {
        const bool on = at == i;
        hot(x - 16, y - 6, 470, step, i);
        const float size = on ? 58 * (1 + 0.018f * STYLE_PULSE) : 44;    // the word you are on bumps, and eases back
        const float w = P.text(x, y + (on ? 0 : 7), size, names[i], on ? INK : alpha_(INK, 0.46f), LEFT, A, 0.045f);
        if (on) {
          P.rect(x, y + 64, w * (1 + 0.03f * STYLE_PULSE), RULE * (1 + 0.5f * STYLE_PULSE), RED);
          P.text(x + w + 22, y + 26, 11, P.fit(11, subs[i], RB, 0.32f, 430), alpha_(INK, 0.82f), LEFT, RB, 0.32f);
        }
        y += step;
      }
    }
    // ---- tonight: the next career event, as a slug and a title, no poster
    {
      const bool on = at == 6;
      const float pw = 400, px = W - 56 - pw, py = bar + 54;
      hot(px - 14, py - 10, pw + 28, H - 2 * bar - 80, 6);
      if (nx) {
        const SeasonDef &sd = career.seasons[(size_t)nx->season];
        int laps = nx->laps, rounds = 0;
        const std::string trk = career.trackFor(*nx, &laps);
        for (const EventDef &e : sd.events) if (e.kind == "round") rounds++;
        const std::string tag = "TONIGHT  -  " + sd.tag + "  -  " + label(*nx) + (nx->kind == "round" ? " OF " + std::to_string(rounds) : "");
        P.text(px, py, 11, P.fit(11, tag, RB, 0.36f, pw), RED, LEFT, RB, 0.36f);
        drawMap(R, P.k, px - 8, py + 24, pw * 0.72f, 150, trk.empty() ? "monza" : trk, true, clock);
        float ty = py + 190;
        for (const std::string &ln : P.wrap(50, upper(nx->title), A, pw, 0.03f)) { P.text(px, ty, 50, ln, INK, LEFT, A, 0.03f); ty += 54; if (ty > py + 310) break; }
        P.rect(px, ty + 4, 120, RULE, RED);
        std::string facts = upper(trk.empty() ? "NOT ON THIS MACHINE YET" : circuitName(trk));
        if (nx->kind == "hotlap") facts += "  -  ALONE";
        else if (nx->kind == "elimination") facts += "  -  " + std::to_string(nx->grid) + " CARS, ONE OUT A LAP";
        else if (nx->kind == "duel" || nx->kind == "the78") facts += "  -  " + std::to_string(laps) + " LAPS  -  TWO CARS";
        else facts += "  -  " + std::to_string(laps) + " LAP" + (laps == 1 ? "" : "S");
        P.text(px, ty + 22, 11, P.fit(11, facts, RB, 0.32f, pw), alpha_(INK, 0.82f), LEFT, RB, 0.32f);
        P.text(px, ty + 46, 11, P.fit(11, upper(career.objText(*nx)), RB, 0.32f, pw), career.state(nx->key).met ? RED : SOFT, LEFT, RB, 0.32f);
        // the one button, as the film's own: an outline until you are on it
        const float by = H - bar - 86, bw = 250;
        if (on && open) P.rect(px, by, bw, 50, RED);
        else { P.rect(px, by, bw, 50, alpha_(INK, 0.55f)); P.rect(px + 1.5f, by + 1.5f, bw - 3, 47, alpha_(PAPER, 0.72f)); }
        P.text(px + bw / 2, by + 18, 13, open ? "L I G H T S   O U T" : "L O C K E D", INK, CENTRE, RB, 0.3f);
      } else {
        P.text(px, py, 11, "T H E   E N D", RED, LEFT, RB, 0.36f);
        P.text(px, py + 30, 50, "ALL OF IT. DONE.", INK, LEFT, A, 0.03f);
      }
    }
    // ---- the lower bar: what the keys do, and what day it is
    {
      const std::time_t tt = std::time(nullptr);
      std::tm lt = *std::localtime(&tt), d0{};
      d0.tm_year = 126; d0.tm_mon = 9; d0.tm_mday = 3;
      std::tm today = lt; today.tm_hour = today.tm_min = today.tm_sec = 0;
      const int day = (int)std::floor(std::difftime(std::mktime(&today), std::mktime(&d0)) / 86400.0 + 0.5) + 1;
      if (day >= 1) { const float w = P.text(56, H - bar / 2 - 6, 11, "CHASING THE WDC", RED, LEFT, RB, 0.36f); P.text(56 + w + 14, H - bar / 2 - 6, 11, "DAY " + std::to_string(day), INK, LEFT, RB, 0.36f); }
      P.text(W - 56, H - bar / 2 - 6, 10, "ARROWS  -  ENTER  -  G = TONIGHT'S EVENT  -  ESC LEAVES", alpha_(INK, 0.5f), RIGHT, RB, 0.3f);
    }
    return;
  }
  // the dark comes in from both sides and up from the floor; the middle is left to the race
  for (int i = 0; i < 24; i++) P.rect((float)i * 24, 0, 24.5f, H, alpha_(PAPER, 0.72f * (1 - (float)i / 24)));
  for (int i = 0; i < 20; i++) P.rect(W - (float)(i + 1) * 24, 0, 24.5f, H, alpha_(PAPER, 0.62f * (1 - (float)i / 20)));
  for (int i = 0; i < 8; i++) P.rect(0, H - 38 - (float)(i + 1) * 14, W, 14.5f, alpha_(PAPER, 0.5f * (1 - (float)i / 8)));

  // ---- the sky: a moon, a few bats, a cobweb
  const float mx = W * 0.56f, my = 116;
  moon(P, mx, my, 38);
  bat(P, mx - 26 + 8 * (float)std::sin(clock * 0.6), my - 8 + 5 * (float)std::cos(clock * 0.8), 15, clock, 0);
  bat(P, mx + 96 + 12 * (float)std::sin(clock * 0.45 + 1), my + 34 + 8 * (float)std::cos(clock * 0.7), 11, clock, 1.7f);
  bat(P, mx - 150 + 16 * (float)std::sin(clock * 0.38 + 2), my + 58 + 6 * (float)std::cos(clock * 0.9 + 1), 9, clock, 3.1f);
  bat(P, mx + 190 + 10 * (float)std::sin(clock * 0.5 + 4), my - 30 + 7 * (float)std::cos(clock * 0.6 + 2), 8, clock, 4.4f);
  cobweb(P, 170, clock);

  // ---- top bar: the name of the game, and what day it is
  {
    const float tw = P.width(30, "CHASING ", A, 0.03f) + P.width(30, "WDC", A, 0.03f), lw = 16 + 30 + 10 + tw + 16;
    if (STYLE_PRO) {
      // the pro menus: the mark, plainly, on a bar of the page's own colour
      P.rect(0, 0, W, 6, RED);
      P.rr(24, 20, lw, 58, 3, alpha_(PAPER, 0.92f));
      const float w1 = P.text(24 + 18, 27, 30, "CHASING ", INK, LEFT, A, 0.03f);
      P.text(24 + 18 + w1, 27, 30, "WDC", RED, LEFT, A, 0.03f);
      P.text(24 + 18, 60, 10, "RACING FOR ALL", SOFT, LEFT, RB, 0.2f);
    } else {
    P.rr(24, 20, lw, 58, 12, INK);
    pumpkin(P, 24 + 16 + 15, 20 + 29, 34);
    const float x = 24 + 16 + 40;
    const float w1 = P.text(x, 27, 30, "CHASING ", PAPER, LEFT, A, 0.03f);
    P.text(x + w1, 27, 30, "WDC", hex("#d9530a"), LEFT, A, 0.03f);
    P.text(x, 60, 10, "RACING FOR ALL", alpha_(PAPER, 0.7f), LEFT, RB, 0.2f);
    }
    float cx = 24 + lw + 12;
    auto chip = [&](const std::string &small, const std::string &big, const Rgba &bg, const Rgba &fg, const Rgba &sm) {
      const float w = std::max(P.width(9, small, RB, 0.16f), P.width(19, big, A, 0.03f)) + 26;
      P.card(cx, 28, w, 42, 12, 2.5f, bg, INK);
      P.text(cx + 13, 34, 9, small, sm, LEFT, RB, 0.16f);
      P.text(cx + 13, 45, 19, big, fg, LEFT, A, 0.03f);
      cx += w + 10;
    };
    // "Day N of chasing the WDC" began on 2026-10-03
    const std::time_t tt = std::time(nullptr);
    std::tm lt = *std::localtime(&tt);
    std::tm d0{}; d0.tm_year = 126; d0.tm_mon = 9; d0.tm_mday = 3;
    std::tm today = lt; today.tm_hour = today.tm_min = today.tm_sec = 0;
    const int day = (int)std::floor(std::difftime(std::mktime(&today), std::mktime(&d0)) / 86400.0 + 0.5) + 1;
    if (day >= 1) chip("CHASING THE WDC", "DAY " + std::to_string(day), YELL, hex("#121212"), hex("#3d5210"));
    if (lt.tm_mon == 9 && !STYLE_PRO) { const int left = 31 - lt.tm_mday; chip("HALLOWEEN", left == 0 ? "TONIGHT" : std::to_string(left) + " NIGHT" + (left == 1 ? "" : "S"), CARD, INK, SOFT); }
  }

  const EventDef *nx = career.next();
  const bool open = nx && career.unlocked(*nx);
  int doneN = 0, allN = 0;
  for (const SeasonDef &sd : career.seasons) for (const EventDef &e : sd.events) { allN++; if (career.state(e.key).done) doneN++; }
  auto label = [&](const EventDef &e) { return e.kind == "round" ? "ROUND " + std::to_string(e.round) : std::string(kindName(e.kind)); };

  // ---- the stack: big slanted stickers down the left
  float y = 104;
  {
    const bool on = at == 0;
    const float x = on ? 36 : 24, w = 430, h = 138;
    hot(24, y, w + 12, h, 0);
    P.rot(x + w / 2, y + h / 2, -2);
    P.rr(x + 7, y + 9, w, h, 18, on ? INK : NIGHTC());
    P.card(x, y, w, h, 18, 3, RED, INK);
    P.text(x + 24, y + 12, 70, "CAREER", ONRED, LEFT, A, 0.03f);
    if (nx) {
      const std::string tag = career.seasons[(size_t)nx->season].tag;
      const float cw = P.width(15, tag, A, 0.06f) + 22;
      P.rr(x + w - 20 - cw, y + 20, cw, 28, 9, ONRED);
      P.text(x + w - 20 - cw / 2, y + 26, 15, tag, RED, CENTRE, A, 0.06f);
    }
    const std::string sub = !nx ? "ALL OF IT. DONE. (ONE MORE RACE.)" : (open ? "NEXT  -  " : "LOCKED  -  ") + label(*nx) + ": " + nx->title;
    P.text(x + 26, y + 94, 12, P.fit(12, sub, RB, 0.12f, w - 52), ONRED, LEFT, RB, 0.12f);
    P.rr(x + 26, y + 116, w - 52, 7, 3.5f, alpha_(ONRED, 0.25f));
    if (allN) P.rr(x + 26, y + 116, std::max(7.0f, (w - 52) * (float)doneN / (float)allN), 7, 3.5f, ONRED);
    P.unrot();
    y += h + 20;
  }
  {
    const Team *team = teamKey().empty() ? nullptr : teamByKey(teamKey());
    int openN = 0;
    for (const EventDef &m : career.modes) if (career.modeOpen(m)) openN++;
    struct B { const char *label; std::string sub; float w, deg; };
    const B bs[5] = {{"RACE", "ANY CIRCUIT - " + upper(circuitName(S.track)), 350, 1.1f}, {"EVENTS", std::to_string(openN) + " OF " + std::to_string(career.modes.size()) + " MODES OPEN", 320, -0.9f},
                     {"XINGUS", "ARCADE. DRIFT. NO SPINS.", 360, 0.8f}, {"GARAGE", team ? upper(team->name) : "PICK A TEAM", 330, -1.1f}, {"SETTINGS", "", 300, 0.9f}};
    for (int i = 0; i < 5; i++) {
      const B &b = bs[i];
      const bool on = at == 1 + i;
      const float x = on ? 42 : 24, h = 66;
      hot(24, y, b.w + 18, h, 1 + i);
      P.rot(x + b.w / 2, y + h / 2, b.deg);
      P.rr(x + 5, y + 7, b.w, h, 14, on ? RED : NIGHTC());
      P.card(x, y, b.w, h, 14, 2.5f, on ? INK : CARD, INK);
      const float lw = P.text(x + 20, y + 13, 38, b.label, on ? PAPER : INK, LEFT, A, 0.03f);
      if (!b.sub.empty()) P.text(x + b.w - 18, y + 29, 10, P.fit(10, b.sub, RB, 0.12f, b.w - lw - 56), on ? alpha_(PAPER, 0.7f) : SOFT, RIGHT, RB, 0.12f);
      P.unrot();
      y += h + 13;
    }
  }

  // ---- tonight: the poster for the next career event
  {
    const bool on = at == 6;
    const float pw = 392, ph = 536, px = W - 30 - pw, py = 112;
    hot(px, py, pw, ph, 6);
    P.rot(px + pw / 2, py + ph / 2, 1.4f);
    P.rr(px + 7, py + 9, pw, ph, 16, on ? RED : NIGHTC());
    P.card(px, py, pw, ph, 16, 3, CARD, INK);
    const float x0 = px + 22, iw = pw - 44;
    if (nx) {
      const SeasonDef &sd = career.seasons[(size_t)nx->season];
      int laps = nx->laps, rounds = 0;
      const std::string trk = career.trackFor(*nx, &laps);
      for (const EventDef &e : sd.events) if (e.kind == "round") rounds++;
      const std::string tag = "SEASON " + std::to_string(nx->season + 1) + "  -  " + sd.tag + "  -  " + label(*nx) + (nx->kind == "round" ? " OF " + std::to_string(rounds) : "");
      P.text(x0, py + 30, 10, P.fit(10, tag, RB, 0.16f, iw), SOFT, LEFT, RB, 0.16f);
      // (drawMap turns the sheet's numbers into pixels itself)
      drawMap(R, P.k, x0, py + 50, iw, 172, trk.empty() ? "monza" : trk, true, clock);
      if (nx->kind == "the78") { P.circle(x0 + iw - 30, py + 80, 19, alpha_(MOON, 0.25f)); P.circle(x0 + iw - 30, py + 80, 15, MOON); bat(P, x0 + iw - 62, py + 96, 9, clock, 2); }
      float ty = py + 236;
      for (const std::string &ln : P.wrap(36, nx->title, A, iw, 0.02f)) { P.text(x0, ty, 36, ln, INK, LEFT, A, 0.02f); ty += 40; if (ty > py + 300) break; }
      std::string facts = upper(trk.empty() ? "NOT ON THIS MACHINE YET" : circuitName(trk));
      if (nx->kind == "hotlap") facts += "  -  ALONE";
      else if (nx->kind == "elimination") facts += "  -  " + std::to_string(nx->grid) + " CARS, ONE OUT A LAP";
      else if (nx->kind == "duel" || nx->kind == "the78") facts += "  -  " + std::to_string(laps) + " LAPS  -  TWO CARS";
      else facts += "  -  " + std::to_string(laps) + " LAP" + (laps == 1 ? "" : "S");
      P.text(x0, ty + 4, 11, P.fit(11, facts, RB, 0.12f, iw), SOFT, LEFT, RB, 0.12f);
      ty += 30;
      P.rect(x0, ty, iw, 2, alpha_(INK, 0.18f));
      ty += 14;
      // the objective
      P.card(x0, ty, 22, 22, 6, 2, career.state(nx->key).met ? YELL : CARD, INK);
      if (career.state(nx->key).met) tick(P, x0 + 11, ty + 11, 12, ONRED);
      P.text(x0 + 32, ty + 2, 19, P.fit(19, career.objText(*nx), A, 0.03f, iw - 34), INK, LEFT, A, 0.03f);
      ty += 38;
      // somebody has something to say about it
      if (!nx->line.empty()) {
        const auto pit = career.people.find(nx->who);
        const Rival *rv = nullptr;
        for (const Rival &r : career.cast) if (r.name == nx->who) rv = &r;
        const Rgba pc = pit != career.people.end() ? hex(pit->second.col) : rv ? hex(rv->col) : INK;
        const float cw = P.width(12, nx->who, A, 0.08f) + 16;
        P.rr(x0, ty, cw, 20, 6, pc);
        P.text(x0 + 8, ty + 4, 12, nx->who, ONRED, LEFT, A, 0.08f);
        ty += 27;
        int n = 0;
        for (const std::string &ln : P.wrap(17, "\"" + nx->line + "\"", MK, iw)) { if (n++ >= 3) break; P.text(x0, ty, 17, ln, INK, LEFT, MK); ty += 22; }
      }
      const float by = py + ph - 22 - 50;
      P.rr(x0, by, iw, 50, 12, open ? RED : alpha_(INK, 0.2f));
      P.text(x0 + iw / 2, by + 13, 25, open ? "LIGHTS OUT >" : "LOCKED  -  SEE CAREER", open ? ONRED : INK, CENTRE, A, 0.05f);
    } else {
      pumpkin(P, px + pw / 2, py + 150, 150);
      P.text(px + pw / 2, py + 270, 40, "THE END", INK, CENTRE, A, 0.03f);
      P.text(px + pw / 2, py + 322, 18, "(it is never the end.)", INK, CENTRE, MK);
      P.text(px + pw / 2, py + 350, 18, "one more race.", INK, CENTRE, MK);
      const float by = py + ph - 22 - 50;
      P.rr(x0, by, iw, 50, 12, RED);
      P.text(x0 + iw / 2, by + 13, 25, "THE CAREER >", ONRED, CENTRE, A, 0.05f);
    }
    P.unrot();
    // a strip of tape across the top of it
    const float tw = 150, tx = px + pw / 2 - tw / 2, tyy = py - 16;
    P.rot(tx + tw / 2, tyy + 16, -3.5f);
    P.rect(tx, tyy, tw, 32, YELL);
    P.text(tx + tw / 2, tyy + 6, 21, nx && nx->kind == "the78" ? "MIDNIGHT" : "TONIGHT", hex("#121212"), CENTRE, A, 0.08f);
    P.unrot();
  }

  // ---- the voice, and the strip along the bottom
  {
    const float bw = std::min(560.0f, P.width(18, sayText, MK) + 32), bx = 24, by = H - 38 - 22 - 38;
    if (!STYLE_PRO) {                            // the pro menus do not talk to you
    P.rot(bx + bw / 2, by + 19, -1.2f);
    P.card(bx, by, bw, 38, 15, 2.5f, CARD, INK);
    P.text(bx + 16, by + 9, 18, P.fit(18, sayText, MK, 0, bw - 30), INK, LEFT, MK);
    P.unrot();
    }
    P.text(W - 30, STYLE_PRO ? H - 26 : H - 38 - 20, 9, "ARROWS  -  ENTER  -  G = TONIGHT'S EVENT  -  ESC LEAVES", alpha_(INK, 0.55f), RIGHT, RB, 0.16f);
  }
  if (!STYLE_PRO) {                              // ...and carry no ticker
    const float th = 38, ty = H - th;
    P.rect(0, ty, W, th, alpha_(NIGHTC(), 0.94f));
    P.rect(0, ty, W, 2, RED);
    // the ticker: slow, in order, for ever
    const float sep = 56, speed = 34;
    float total = 0;
    std::vector<float> ws;
    for (const std::string &s : career.ticker) { ws.push_back(P.width(13, s, RB, 0.04f)); total += ws.back() + sep; }
    float x = 190 - (float)std::fmod(clock * speed, (double)total);
    for (int pass = 0; pass < 2 + (int)(W / std::max(1.0f, total)); pass++)
      for (size_t i = 0; i < career.ticker.size(); i++) {
        if (x + ws[i] > 0 && x < W) {
          P.text(x, ty + 12, 13, career.ticker[i], INK, LEFT, RB, 0.04f);
          P.poly({x - sep / 2, ty + 14, x - sep / 2 + 5, ty + 19.5f, x - sep / 2, ty + 25, x - sep / 2 - 5, ty + 19.5f}, RED);
        }
        x += ws[i] + sep;
      }
    const float cw = P.width(15, "PADDOCK RADIO", A, 0.06f) + 34;
    P.rect(0, ty, cw + 8, th, NIGHTC());
    P.rect(0, ty + 2, cw, th - 2, YELL);
    P.text(17, ty + 11, 15, "PADDOCK RADIO", hex("#121212"), LEFT, A, 0.06f);
  }
}

// ---------------------------------------------------------------------------------------------
// what the three inner pages share
// ---------------------------------------------------------------------------------------------
namespace {
float pageTitle(const Pen &P, const std::string &t) {
  const float w = P.text(24, 20, 46, t, INK, LEFT, A, 0.02f);
  P.rect(24, 68, w, 7, RED);
  pumpkin(P, 24 + w + 30, 44, 40);
  return w;
}
void sayBubble(const Pen &P, const std::string &s) {
  const float w = std::min(560.0f, P.width(17, s, MK) + 30), x = P.W - 24 - w, y = 30;
  P.rot(x + w / 2, y + 17, -1.2f);
  P.card(x, y, w, 35, 14, 2.5f, CARD, INK);
  P.text(x + 15, y + 8, 17, P.fit(17, s, MK, 0, w - 28), INK, LEFT, MK);
  P.unrot();
}
}  // namespace

// ---------------------------------------------------------------------------------------------
// CAREER
// ---------------------------------------------------------------------------------------------
void Home::drawCareer(Renderer &R, float k0, double clock) {
  const Pen P(R, k0);
  auto hot = [&](float x, float y, float w, float h, int item, std::function<void()> fn = nullptr) { hots.push_back({x * P.k, y * P.k, w * P.k, h * P.k, item, std::move(fn)}); };
  const float W = P.W, H = P.H;
  wash(P, 0.90f);
  cobweb(P, 120, clock);
  pageTitle(P, "CHASING THE WDC");
  sayBubble(P, sayText);
  if (career.seasons.empty()) { P.text(40, 120, 18, "the career's data did not load (data/career/career.json).", INK, LEFT, MK); return; }
  if (viewSeason < 0 || viewSeason >= (int)career.seasons.size()) viewSeason = career.currentSeason();
  const SeasonDef &sd = career.seasons[(size_t)viewSeason];
  const int nEv = (int)sd.events.size();

  // ---- the ladder: three rungs, the one you are looking at in ink
  {
    const int n = (int)career.seasons.size();
    const float gap = 34, w = (W - 48 - gap * (float)(n - 1)) / (float)n, y = 94, h = 70;
    for (int i = 0; i < n; i++) {
      const SeasonDef &q = career.seasons[(size_t)i];
      const bool sel = i == viewSeason, isOpen = career.seasonOpen(i), done = career.seasonDone(i);
      const float x = 24 + (float)i * (w + gap);
      hot(x, y, w, h, -1, [this, i] { viewSeason = i; show("career", 0); });
      P.rot(x + w / 2, y + h / 2, i % 2 ? 0.5f : -0.5f);
      if (sel) P.rr(x + 4, y + 6, w, h, 14, RED);
      P.card(x, y, w, h, 14, 2.5f, sel ? INK : CARD, INK);
      const Rgba fg = sel ? PAPER : isOpen ? INK : SOFT, sm = sel ? alpha_(PAPER, 0.7f) : SOFT;
      P.text(x + 18, y + 11, 10, "SEASON " + std::to_string(i + 1) + "  -  " + q.tag, sm, LEFT, RB, 0.18f);
      P.text(x + 18, y + 27, 30, P.fit(30, q.name, A, 0.02f, w - 150), fg, LEFT, A, 0.02f);
      // where it stands
      std::string stt = !isOpen ? "LOCKED" : done ? "DONE - P" + std::to_string(career.place(i)) : "NOW";
      const float cw = P.width(14, stt, A, 0.06f) + 22 + (!isOpen ? 20 : 0);
      const Rgba cb = !isOpen ? alpha_(SOFT, 0.25f) : done ? YELL : RED;
      P.rr(x + w - 16 - cw, y + 21, cw, 28, 9, cb);
      if (!isOpen) padlock(P, x + w - 16 - cw + 16, y + 37, 16, sel ? PAPER : INK);
      P.text(x + w - 16 - 11, y + 27, 14, stt, !isOpen ? (sel ? PAPER : INK) : hex("#121212"), RIGHT, A, 0.06f);
      P.unrot();
      if (i + 1 < n) P.poly({x + w + 9, y + h / 2 - 10, x + w + gap - 9, y + h / 2, x + w + 9, y + h / 2 + 10}, alpha_(INK, 0.5f));
    }
  }

  const float top = 184, bot = H - 22 - 50 - 16;
  const float lw = std::floor((W - 48) * 0.58f), rx = 24 + lw + 16, rw = W - 24 - rx;
  // ---- the events of this season
  {
    P.card(24, top, lw, bot - top, 14, 2.5f, CARD, INK);
    const float rh = std::min(60.0f, (bot - top - 16) / (float)std::max(1, nEv));
    float y = top + 8;
    const EventDef *nx = career.next();
    for (int i = 0; i < nEv; i++) {
      const EventDef &e = sd.events[(size_t)i];
      const EvState &s = career.state(e.key);
      const bool on = at == i, isOpen = career.unlocked(e), isNext = nx == &e && isOpen;
      hot(24, y, lw, rh, i);
      if (on) { P.rr(24 + 8, y + 1, lw - 16, rh - 2, 10, INK); }
      else if (i > 0) P.rect(24 + 20, y, lw - 40, 1, alpha_(INK, 0.10f));
      const Rgba fg = on ? PAPER : isOpen ? INK : alpha_(SOFT, 0.8f), sm = on ? alpha_(PAPER, 0.72f) : SOFT;
      const float cy = y + rh / 2;
      // done, next, or locked
      if (s.done) { P.circle(24 + 38, cy, 13, s.met ? YELL : alpha_(INK, 0.35f)); tick(P, 24 + 38, cy, 13, s.met ? ONRED : (on ? PAPER : INK)); }
      else if (isNext) { P.circle(24 + 38, cy, 13, RED); P.poly({24 + 34, cy - 7, 24 + 45, cy, 24 + 34, cy + 7}, ONRED); }
      else if (isOpen) { P.circle(24 + 38, cy, 13, alpha_(INK, 0.35f)); }
      else padlock(P, 24 + 38, cy + 4, 20, on ? alpha_(PAPER, 0.6f) : alpha_(SOFT, 0.7f));
      // what kind of thing it is
      const std::string kn = e.kind == "round" ? "ROUND " + std::to_string(e.round) : kindName(e.kind);
      const bool special = e.kind != "round";
      const float kw = 128;
      if (special) P.rr(24 + 64, cy - 11, kw, 22, 7, e.kind == "the78" ? (on ? NIGHTC() : alpha_(MOON, 0.9f)) : on ? alpha_(PAPER, 0.85f) : alpha_(PLUM, 0.85f));
      P.text(24 + 64 + (special ? kw / 2 : 0), cy - 7, 13, kn, special ? (e.kind == "the78" ? (on ? MOON : NIGHTC()) : INK) : sm, special ? CENTRE : LEFT, A, 0.08f);
      int laps = e.laps;
      const std::string trk = career.trackFor(e, &laps);
      const float tx = 24 + 64 + kw + 16, rightW = 190;
      const float tw = P.text(tx, cy - 13, 23, P.fit(23, e.title, A, 0.02f, lw - (tx - 24) - rightW - 150), fg, LEFT, A, 0.02f);
      P.text(tx + tw + 12, cy - 5, 10, P.fit(10, upper(trk.empty() ? "?" : circuitName(trk)), RB, 0.14f, lw - (tx - 24) - tw - rightW - 20), sm, LEFT, RB, 0.14f);
      // how it went
      const float ex = 24 + lw - 22;
      if (s.done && e.kind == "hotlap") {
        for (int m = 1; m <= 3; m++) medalDisc(P, ex - 150 + (float)m * 24, cy, 9, m, s.medal >= m);
        P.text(ex, cy - 6, 12, lapText(s.lap), fg, RIGHT, RB, 0.06f);
      } else if (s.done && e.kind == "round") {
        P.text(ex - 62, cy - 10, 20, "P" + std::to_string(s.pos), fg, RIGHT, A, 0.03f);
        P.text(ex, cy - 6, 12, "+" + std::to_string(s.pts) + " PTS", sm, RIGHT, RB, 0.08f);
      } else if (s.done) P.text(ex, cy - 6, 12, s.met ? "OBJECTIVE MET" : "RUN - NOT MET", s.met ? (on ? PAPER : YELL) : sm, RIGHT, RB, 0.08f);
      else if (isNext) P.text(ex, cy - 6, 12, "NEXT", on ? PAPER : RED, RIGHT, RB, 0.14f);
      else if (!isOpen) P.text(ex, cy - 6, 11, "LOCKED", sm, RIGHT, RB, 0.14f);
      y += rh;
    }
  }
  // ---- the table
  const auto rows = career.table(viewSeason);
  const float trh = 23, th = 40 + trh * (float)rows.size() + 10;
  {
    P.card(rx, top, rw, th, 14, 2.5f, CARD, INK);
    P.text(rx + 18, top + 13, 10, "THE TABLE  -  " + sd.tag, SOFT, LEFT, RB, 0.18f);
    P.text(rx + rw - 18, top + 13, 10, "PTS", SOFT, RIGHT, RB, 0.18f);
    float y = top + 36;
    for (size_t i = 0; i < rows.size(); i++) {
      const TableRow &r = rows[i];
      if (r.you) P.rr(rx + 8, y - 1, rw - 16, trh, 6, RED);
      const Rgba fg = r.you ? ONRED : INK, sm = r.you ? ONRED : SOFT;
      P.text(rx + 40, y + 3, 14, std::to_string(i + 1), sm, RIGHT, A);
      P.rr(rx + 48, y + 3, 6, 15, 2, hex(r.col));
      P.text(rx + 64, y + 4, 13, r.name, fg, LEFT, RB, 0.04f);
      P.text(rx + 64 + 150, y + 5, 10, "#" + std::to_string(r.num), sm, LEFT, RB, 0.1f);
      P.text(rx + rw - 18, y + 3, 14, std::to_string(r.pts), fg, RIGHT, A);
      y += trh;
    }
  }
  // ---- your car, the shelf, the story
  {
    const int iPaint = nEv, iStory = nEv + 1;
    float y = top + th + 12;
    const float hh = (bot - y - 12) / 2;
    {
      const bool on = at == iPaint;
      hot(rx, y, rw, hh, iPaint);
      if (on) P.rr(rx + 4, y + 5, rw, hh, 14, RED);
      P.card(rx, y, rw, hh, 14, on ? 3 : 2.5f, CARD, INK);
      const Paint &pt = career.paintNow();
      P.text(rx + 18, y + 11, 10, "YOUR CAR  -  #78  -  " + sd.team, on ? RED : SOFT, LEFT, RB, 0.18f);
      // the car, from the side, in its paint: a wedge, two wheels, a number
      const float u = std::min(1.5f, (hh - 44) / 40), cx = rx + 22, cy = y + hh - 22;
      P.poly({cx, cy - 6 * u, cx + 26 * u, cy - 22 * u, cx + 78 * u, cy - 26 * u, cx + 112 * u, cy - 12 * u, cx + 112 * u, cy - 2 * u, cx, cy - 2 * u}, hex(pt.col));
      P.circle(cx + 24 * u, cy, 10 * u, NIGHTC()); P.circle(cx + 24 * u, cy, 4 * u, SOFT);
      P.circle(cx + 92 * u, cy, 10 * u, NIGHTC()); P.circle(cx + 92 * u, cy, 4 * u, SOFT);
      P.text(cx + 60 * u, cy - 23 * u, 13 * u, "78", inkOn(hex(pt.col)), CENTRE, A);
      const float nx0 = cx + 112 * u + 30;
      P.text(nx0, y + 34, 30, pt.name, INK, LEFT, A, 0.03f);
      int own = 0;
      for (const Paint &q : career.paints) if (career.owns(q.key)) own++;
      float sx = nx0;
      for (const Paint &q : career.paints) {
        const bool has = career.owns(q.key);
        P.circle(sx + 8, y + hh - 18, q.key == career.paint ? 9 : 7, q.key == career.paint ? INK : alpha_(INK, 0.3f));
        P.circle(sx + 8, y + hh - 18, q.key == career.paint ? 6.5f : 5, has ? hex(q.col) : CARD);
        sx += 24;
      }
      P.text(rx + rw - 18, y + hh - 24, 10, "< > CHANGE  -  " + std::to_string(own) + " OF " + std::to_string(career.paints.size()), SOFT, RIGHT, RB, 0.14f);
    }
    y += hh + 12;
    {
      const bool on = at == iStory;
      const float sw = std::floor(rw * 0.42f);
      hot(rx, y, sw, hh, iStory);
      if (on) P.rr(rx + 4, y + 5, sw, hh, 14, RED);
      P.card(rx, y, sw, hh, 14, on ? 3 : 2.5f, on ? INK : CARD, INK);
      P.text(rx + 18, y + 11, 10, "THE STORY SO FAR", on ? alpha_(PAPER, 0.7f) : SOFT, LEFT, RB, 0.18f);
      P.text(rx + 18, y + 28, 26, std::to_string(career.soFar().size()) + " / " + std::to_string(career.cards.size()), on ? PAPER : INK, LEFT, A, 0.03f);
      P.text(rx + 18, y + hh - 26, 15, "read it again >", on ? PAPER : INK, LEFT, MK);
      // the shelf
      const float tx = rx + sw + 12, tw = rw - sw - 12;
      P.card(tx, y, tw, hh, 14, 2.5f, CARD, INK);
      P.text(tx + 18, y + 11, 10, "THE SHELF", SOFT, LEFT, RB, 0.18f);
      P.rect(tx + 16, y + hh - 18, tw - 32, 4, alpha_(INK, 0.5f));
      float cx = tx + 40;
      const float by = y + hh - 18;
      for (int i = 0; i < (int)career.seasons.size(); i++) {
        const bool has = std::find(career.trophies.begin(), career.trophies.end(), career.seasons[(size_t)i].name) != career.trophies.end();
        const Rgba c = has ? (i == 2 ? GOLD : i == 1 ? SILVER : BRONZE) : alpha_(INK, 0.16f);
        P.rect(cx - 12, by - 6, 24, 6, c); P.rect(cx - 3, by - 20, 6, 14, c);
        P.poly({cx - 15, by - 46, cx + 15, by - 46, cx + 9, by - 20, cx - 9, by - 20}, c);
        cx += 54;
      }
      // the other 78: a helmet, when you have beaten it
      const bool g78 = career.state("s3g1").met;
      P.circle(cx, by - 20, 17, g78 ? MOON : alpha_(INK, 0.16f));
      P.rect(cx - 17, by - 20, 34, 14, g78 ? MOON : alpha_(INK, 0.0f));
      if (g78) { P.rr(cx - 2, by - 28, 20, 9, 3, NIGHTC()); P.text(cx - 8, by - 12, 9, "78", NIGHTC(), CENTRE, A); }
      else P.text(cx, by - 30, 15, "?", alpha_(INK, 0.4f), CENTRE, A);
    }
  }
  // ---- the foot
  {
    const int iGo = nEv + 2;
    const float y = H - 22 - 50;
    const float bw = P.width(26, "< BACK", A, 0.04f) + 60;
    P.card(24, y, bw, 50, 12, 2.5f, CARD, INK);
    hot(24, y, bw, 50, -1, [this] { if (back) back(); });
    P.text(54, y + 13, 26, "< BACK", INK, LEFT, A, 0.04f);
    P.text(W / 2, y + 20, 10, "UP / DOWN AN EVENT  -  LEFT / RIGHT A SEASON  -  ENTER STARTS IT", SOFT, CENTRE, RB, 0.14f);
    const EventDef *nx = career.next();
    const std::string nl = nx ? (career.unlocked(*nx) ? "NEXT EVENT >" : "LOCKED") : "ALL DONE";
    const float w = P.width(26, nl, A, 0.04f) + 60;
    const bool on = at == iGo;
    hot(W - 24 - w, y, w, 50, iGo);
    float yy = y;
    if (on) { yy -= 3; P.rr(W - 24 - w, yy + 6, w, 50, 12, INK); }
    P.card(W - 24 - w, yy, w, 50, 12, 2.5f, RED, INK);
    P.text(W - 24 - w + 30, yy + 13, 26, nl, ONRED, LEFT, A, 0.04f);
  }
}

// ---------------------------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------------------------
void Home::drawEvents(Renderer &R, float k0, double clock) {
  const Pen P(R, k0);
  auto hot = [&](float x, float y, float w, float h, int item, std::function<void()> fn = nullptr) { hots.push_back({x * P.k, y * P.k, w * P.k, h * P.k, item, std::move(fn)}); };
  const float W = P.W, H = P.H;
  wash(P, 0.90f);
  cobweb(P, 120, clock);
  const float tw = pageTitle(P, "EVENTS");
  sayBubble(P, sayText);
  {
    const std::string small = "THE ONES THAT ASK: ON", big = upper(circuitName(S.track)) + "  -  " + upper(carSpec(S.car).full);
    const float x = 24 + tw + 64, w = std::max(P.width(9, small, RB, 0.16f), P.width(19, big, A, 0.03f)) + 26;
    P.card(x, 28, w, 42, 12, 2.5f, YELL, INK);
    P.text(x + 13, 34, 9, small, hex("#3d5210"), LEFT, RB, 0.16f);
    P.text(x + 13, 45, 19, big, hex("#121212"), LEFT, A, 0.03f);
  }
  const int n = (int)career.modes.size(), colsN = 4, rowsN = (n + colsN - 1) / colsN;
  const float top = 100, bot = H - 22 - 50 - 18, gap = 16;
  const float cw = (W - 48 - gap * (float)(colsN - 1)) / (float)colsN, ch = (bot - top - gap * (float)(rowsN - 1)) / (float)std::max(1, rowsN);
  for (int i = 0; i < n; i++) {
    const EventDef &m = career.modes[(size_t)i];
    const EvState &s = career.state("mode:" + m.key);
    const bool on = at == i, isOpen = career.modeOpen(m);
    const float x = 24 + (float)(i % colsN) * (cw + gap);
    float y = top + (float)(i / colsN) * (ch + gap);
    hot(x, y, cw, ch, i);
    P.rot(x + cw / 2, y + ch / 2, (i % 2 ? 0.6f : -0.6f) * (((i / colsN) % 2) ? -1.0f : 1.0f));
    if (on) { y -= 4; P.rr(x + 5, y + 8, cw, ch, 16, RED); }
    P.card(x, y, cw, ch, 16, on ? 3 : 2.5f, on ? INK : CARD, INK);
    const Rgba fg = on ? PAPER : isOpen ? INK : SOFT, sm = on ? alpha_(PAPER, 0.7f) : SOFT, mark = on ? PAPER : INK;
    char no[16];
    std::snprintf(no, sizeof no, "%02d", i + 1);
    P.text(x + 20, y + 16, 12, no, on ? RED : SOFT, LEFT, A, 0.1f);
    // one small picture each, in fat strokes
    {
      const float ix = x + cw - 66, iy = y + 64;
      const Rgba c1 = on ? PAPER : isOpen ? INK : alpha_(SOFT, 0.6f), c2 = isOpen ? RED : alpha_(SOFT, 0.6f);
      if (!isOpen) padlock(P, ix, iy + 10, 44, c1);
      else if (m.kind == "lasttofirst") { for (int q = 0; q < 4; q++) P.rr(ix - 30 + (float)q * 16, iy + 14 - (float)q * 12, 12, 10 + (float)q * 12, 3, q == 3 ? c2 : c1); }
      else if (m.kind == "elimination") { for (int q = 0; q < 4; q++) { P.circle(ix - 27 + (float)q * 18, iy, 7, q == 3 ? c2 : c1); } cross(P, ix + 27, iy, 10, on ? INK : CARD); }
      else if (m.kind == "duel") { P.path({ix - 28, iy + 22, ix + 22, iy - 24}, 6, c1); P.path({ix + 28, iy + 22, ix - 22, iy - 24}, 6, c2); }
      else if (m.kind == "hotlap") { P.circle(ix, iy + 2, 26, c1); P.circle(ix, iy + 2, 20, on ? INK : CARD); P.path({ix, iy + 2, ix + 10, iy - 10}, 4, c2); P.rect(ix - 5, iy - 32, 10, 7, c1); }
      else if (m.kind == "nightstorm") { P.circle(ix - 8, iy - 8, 15, c1); P.circle(ix + 10, iy - 4, 12, c1); P.rr(ix - 26, iy - 6, 50, 14, 7, c1); P.poly({ix + 2, iy + 10, ix - 10, iy + 26, ix - 1, iy + 24, ix - 6, iy + 38, ix + 12, iy + 18, ix + 3, iy + 20}, c2); }
      else if (m.kind == "the78") { moon(P, ix, iy, 22); bat(P, ix - 34, iy + 18, 10, clock, 1); }
      else if (m.kind == "derby") { P.rr(ix - 30, iy - 4, 30, 16, 4, c1); P.rr(ix + 4, iy - 4, 30, 16, 4, c2); for (int q = 0; q < 5; q++) { const float a = (float)q * 1.256f - 1.57f; P.path({ix + 2, iy - 10, ix + 2 + std::cos(a) * 20, iy - 10 + std::sin(a) * 20 - 6}, 3, c1); } }
      else { pumpkin(P, ix, iy + 2, 52); }
    }
    const auto tl = P.wrap(34, m.title, A, cw - 40, 0.02f), ml = P.wrap(16, m.line, MK, cw - 40);
    float ty = y + ch - 78 - (float)tl.size() * 37 - 4 - (float)ml.size() * 20;
    for (const std::string &ln : tl) { P.text(x + 20, ty, 34, ln, fg, LEFT, A, 0.02f); ty += 37; }
    ty += 4;
    for (const std::string &ln : ml) { P.text(x + 20, ty, 16, ln, mark, LEFT, MK); ty += 20; }
    // where it is run, and what you have done in it
    std::string where = m.tracks.empty() ? "YOUR CIRCUIT + CAR" : upper(career.trackFor(m).empty() ? "CIRCUIT NOT HERE YET" : circuitName(career.trackFor(m)));
    if (m.kind == "the78" || m.kind == "duel") where += "  -  YOUR CAR";
    const float by = y + ch - 20;
    P.rect(x + 20, by - 44, cw - 40, 2, alpha_(mark, 0.16f));
    P.text(x + 20, by - 34, 10, P.fit(10, isOpen ? career.objText(m) : "LOCKED  -  THE CAREER OPENS IT", RB, 0.12f, cw - 40), fg, LEFT, RB, 0.12f);
    P.text(x + 20, by - 16, 10, P.fit(10, where, RB, 0.12f, cw - 150), sm, LEFT, RB, 0.12f);
    if (m.kind == "hotlap") { for (int q = 1; q <= 3; q++) medalDisc(P, x + cw - 92 + (float)q * 22, by - 11, 8, q, s.medal >= q); }
    else if (s.done) P.text(x + cw - 20, by - 16, 10, s.met ? "DONE IT" : "BEST P" + std::to_string(s.pos), s.met ? (on ? PAPER : YELL) : sm, RIGHT, RB, 0.12f);
    P.unrot();
  }
  {
    const float y = H - 22 - 50;
    const float bw = P.width(26, "< BACK", A, 0.04f) + 60;
    P.card(24, y, bw, 50, 12, 2.5f, CARD, INK);
    hot(24, y, bw, 50, -1, [this] { if (back) back(); });
    P.text(54, y + 13, 26, "< BACK", INK, LEFT, A, 0.04f);
    P.text(W / 2, y + 20, 10, "ARROWS MOVE  -  ENTER STARTS IT  -  ESC BACK", SOFT, CENTRE, RB, 0.14f);
    const std::string nl = "CIRCUIT + CAR >";
    const float w = P.width(26, nl, A, 0.04f) + 60;
    const bool on = at == n;
    hot(W - 24 - w, y, w, 50, n);
    float yy = y;
    if (on) { yy -= 3; P.rr(W - 24 - w, yy + 6, w, 50, 12, RED); }
    P.card(W - 24 - w, yy, w, 50, 12, 2.5f, on ? INK : CARD, INK);
    P.text(W - 24 - w + 30, yy + 13, 26, nl, on ? PAPER : INK, LEFT, A, 0.04f);
  }
}

// ---------------------------------------------------------------------------------------------
// A STORY CARD
// ---------------------------------------------------------------------------------------------
void Home::drawStory(Renderer &R, float k0, double clock) {
  const Pen P(R, k0);
  const float W = P.W, H = P.H;
  wash(P, 0.93f);
  moon(P, W - 190, 130, 44);
  bat(P, W - 300 + 10 * (float)std::sin(clock * 0.5), 150 + 6 * (float)std::cos(clock * 0.7), 13, clock, 0);
  bat(P, W - 110 + 8 * (float)std::sin(clock * 0.4 + 2), 210 + 6 * (float)std::cos(clock * 0.6), 9, clock, 2);
  cobweb(P, 120, clock);
  if (shotCard >= 0 && shotCard < (int)career.cards.size() && storyQ.empty()) { storyQ = {shotCard}; storyAt = 0; storyHead = "CHASING THE WDC"; }
  if (storyQ.empty() || storyAt >= (int)storyQ.size()) return;
  hots.push_back({0, 0, (float)R.W, (float)R.H, 0, nullptr});          // a click anywhere turns the card
  const Card &c = career.cards[(size_t)storyQ[(size_t)storyAt]];
  const bool pen = c.who.empty();
  const auto pit = career.people.find(c.who);
  const Rgba pc = pit != career.people.end() ? hex(pit->second.col) : RED;

  P.text(W / 2, 96, 12, storyHead, SOFT, CENTRE, RB, 0.3f);
  P.rect(W / 2 - 40, 120, 80, 3, RED);

  const float cw = std::min(1040.0f, W - 120), ch = 360, x = W / 2 - cw / 2, y = H / 2 - ch / 2 - 10;
  P.rot(W / 2, y + ch / 2, pen ? -0.8f : 0.6f);
  P.rr(x + 8, y + 10, cw, ch, 22, pen ? RED : pc);
  P.card(x, y, cw, ch, 22, 3, CARD, INK);
  // who is talking
  float ty = y + 54;
  if (pen) {
    pumpkin(P, x + 62, y + 60, 54);
    ty = y + 112;
  } else {
    const std::string tag = pit != career.people.end() ? pit->second.tag : c.who, sub = pit != career.people.end() ? pit->second.sub : "";
    P.circle(x + 66, y + 66, 34, INK);
    P.circle(x + 66, y + 66, 30.5f, pc);
    P.text(x + 66, y + 46, 38, tag.substr(0, 1), ONRED, CENTRE, A);
    P.text(x + 116, y + 40, 30, tag, INK, LEFT, A, 0.04f);
    P.text(x + 116, y + 76, 10, upper(sub), SOFT, LEFT, RB, 0.2f);
    ty = y + 132;
  }
  const float size = pen ? 31 : 26, lead = pen ? 44 : 38, iw = cw - 120;
  std::vector<std::string> lines;
  for (const std::string &l : c.lines) for (const std::string &w : P.wrap(size, l, pen ? MK : RB, iw)) lines.push_back(w);
  // sit the lines in the middle of the room that is left
  const float room = y + ch - 60 - ty, need = (float)lines.size() * lead;
  ty += std::max(0.0f, (room - need) / 2);
  for (const std::string &l : lines) { P.text(x + 60, ty, size, l, INK, LEFT, pen ? MK : RB); ty += lead; }
  P.unrot();

  // where you are in it, and how to go on
  const int n = (int)storyQ.size();
  const float dy = y + ch + 46;
  for (int i = 0; i < n && n <= 40; i++) P.circle(W / 2 - (float)(n - 1) * 9 + (float)i * 18, dy, i == storyAt ? 6 : 4, i == storyAt ? RED : alpha_(INK, 0.3f));
  const std::string nl = storyAt + 1 < n ? "NEXT >" : storyReplay ? "DONE >" : "OK >";
  const float bw = P.width(24, nl, A, 0.05f) + 56, bx = x + cw - bw, by = y + ch + 24;
  P.rr(bx + 4, by + 6, bw, 46, 12, INK);
  P.card(bx, by, bw, 46, 12, 2.5f, RED, INK);
  P.text(bx + 28, by + 12, 24, nl, ONRED, LEFT, A, 0.05f);
  P.text(x, by + 18, 10, "ENTER NEXT  -  LEFT BACK ONE  -  ESC SKIPS", SOFT, LEFT, RB, 0.16f);
}

// ---------------------------------------------------------------------------------------------
// THE DEBRIEF
// ---------------------------------------------------------------------------------------------
void Home::drawDebrief(Renderer &R, float k0, double clock) {
  const Pen P(R, k0);
  auto hot = [&](float x, float y, float w, float h, int item) { hots.push_back({x * P.k, y * P.k, w * P.k, h * P.k, item, nullptr}); };
  const float W = P.W, H = P.H;
  wash(P, 0.92f);
  cobweb(P, 120, clock);
  const Outcome &o = career.out;
  const EventDef *e = career.find(o.key);
  const Rgba hc = o.met ? YELL : o.valid ? RED : SOFT;
  const float cw = std::min(1100.0f, W - 120), x = W / 2 - cw / 2;
  float y = std::max(84.0f, H / 2 - 330);
  P.text(W / 2, y, 12, (o.career ? "CAREER  -  " : "EVENTS  -  ") + std::string(e && e->kind == "round" ? "ROUND " + std::to_string(e->round) : kindName(o.kind)) + "  -  " + o.title, SOFT, CENTRE, RB, 0.3f);
  y += 34;
  P.rot(W / 2, y + 44, -1.2f);
  const float hw = P.width(84, o.headline, A, 0.03f);
  P.rect(W / 2 - hw / 2 - 16, y + 62, hw + 32, 22, alpha_(hc, 0.28f));
  P.text(W / 2, y, 84, o.headline, hc, CENTRE, A, 0.03f);
  P.unrot();
  y += 124;
  // the objective, ticked or not
  {
    const float h = 84;
    P.card(x, y, cw, h, 16, 2.5f, CARD, INK);
    P.circle(x + 46, y + h / 2, 24, hc);
    if (o.met) tick(P, x + 46, y + h / 2, 24, ONRED); else cross(P, x + 46, y + h / 2, 22, ONRED);
    P.text(x + 90, y + 16, 10, "THE OBJECTIVE", SOFT, LEFT, RB, 0.2f);
    const float dw = std::min(cw * 0.5f, P.width(13, o.detail, RB, 0.08f));
    P.text(x + 90, y + 34, 30, P.fit(30, o.objective, A, 0.03f, cw - 90 - dw - 60), INK, LEFT, A, 0.03f);
    P.text(x + cw - 24, y + 37, 13, P.fit(13, o.detail, RB, 0.08f, cw * 0.5f), INK, RIGHT, RB, 0.08f);
    y += h + 14;
  }
  const float half = (cw - 14) / 2, boxH = 250;
  // left: the medals of a hot lap, or the table as it now stands
  {
    P.card(x, y, half, boxH, 16, 2.5f, CARD, INK);
    if (o.kind == "hotlap") {
      P.text(x + 22, y + 16, 10, "THE CLOCK", SOFT, LEFT, RB, 0.2f);
      const double *m = o.medalT;
      static const char *NAMES[3] = {"BRONZE", "SILVER", "GOLD"};
      for (int q = 2; q >= 0; q--) {
        const float ry = y + 46 + (float)(2 - q) * 56;
        medalDisc(P, x + 50, ry + 20, 20, q + 1, o.medal >= q + 1);
        P.text(x + 86, ry + 6, 26, NAMES[q], o.medal >= q + 1 ? INK : SOFT, LEFT, A, 0.04f);
        P.text(x + half - 24, ry + 10, 18, m[q] > 0 ? lapText(m[q]) : "--", o.medal >= q + 1 ? INK : SOFT, RIGHT, RB, 0.04f);
      }
      if (o.lap > 0) P.text(x + 22, y + boxH - 30, 12, "YOUR BEST  " + lapText(o.lap), INK, LEFT, RB, 0.14f);
    } else if (o.career && e && e->kind == "round") {
      const auto rows = career.table(e->season);
      P.text(x + 22, y + 16, 10, "THE TABLE NOW", SOFT, LEFT, RB, 0.2f);
      int you = 0;
      for (size_t i = 0; i < rows.size(); i++) if (rows[i].you) you = (int)i;
      const int first = std::max(0, std::min((int)rows.size() - 7, you - 3));
      float ry = y + 42;
      for (int i = first; i < first + 7 && i < (int)rows.size(); i++) {
        const TableRow &r = rows[(size_t)i];
        if (r.you) P.rr(x + 12, ry - 2, half - 24, 27, 7, RED);
        const Rgba fg = r.you ? ONRED : INK;
        P.text(x + 50, ry + 3, 16, std::to_string(i + 1), r.you ? ONRED : SOFT, RIGHT, A);
        P.rr(x + 60, ry + 3, 6, 17, 2, hex(r.col));
        P.text(x + 78, ry + 4, 15, r.name, fg, LEFT, RB, 0.04f);
        P.text(x + half - 26, ry + 3, 16, std::to_string(r.pts), fg, RIGHT, A);
        ry += 28;
      }
    } else {
      P.text(x + 22, y + 16, 10, "HOW IT WENT", SOFT, LEFT, RB, 0.2f);
      const EvState &s = career.state(o.career ? o.key : "mode:" + o.key);
      float ry = y + 50;
      auto row = [&](const std::string &a, const std::string &b) { P.text(x + 22, ry + 4, 12, a, SOFT, LEFT, RB, 0.14f); P.text(x + half - 24, ry, 22, b, INK, RIGHT, A, 0.03f); ry += 44; };
      if (o.valid && o.n > 0) row("THIS RUN", "P" + std::to_string(o.pos) + " OF " + std::to_string(o.n));
      else row("THIS RUN", "DID NOT FINISH");
      if (s.pos > 0) row("YOUR BEST", "P" + std::to_string(s.pos));
      row("ATTEMPTS", std::to_string(s.tries));
      if (o.kind == "lasttofirst" && o.valid) row("PLACES GAINED", std::to_string(o.gained));
    }
  }
  // right: what it opened
  {
    const float rx = x + half + 14;
    P.card(rx, y, half, boxH, 16, 2.5f, CARD, INK);
    P.text(rx + 22, y + 16, 10, "WHAT IT OPENED", SOFT, LEFT, RB, 0.2f);
    float ry = y + 44;
    if (o.unlocked.empty()) {
      P.text(rx + 22, ry + 6, 19, o.met ? "nothing new. just the glory." : o.valid ? "nothing yet. it will keep." : "nothing. the wall kept it.", INK, LEFT, MK);
    }
    for (size_t i = 0; i < o.unlocked.size() && i < 5; i++) {
      const std::string &u = o.unlocked[i];
      const bool loud = u.rfind("NEXT:", 0) != 0;
      for (const std::string &ln : P.wrap(15, u, A, half - 80, 0.05f)) {
        const float w = P.width(15, ln, A, 0.05f) + 26;
        P.rot(rx + 22 + w / 2, ry + 15, i % 2 ? 0.8f : -0.8f);
        P.rr(rx + 22, ry, w, 30, 9, loud ? YELL : alpha_(INK, 0.14f));
        P.text(rx + 35, ry + 7, 15, ln, loud ? hex("#121212") : INK, LEFT, A, 0.05f);
        P.unrot();
        ry += 37;
      }
    }
  }
  y += boxH + 22;
  // the two buttons
  {
    // (AGAIN is item 0 and CONTINUE item 1, so LEFT and RIGHT go the way they look)
    const std::string a = "CONTINUE >", b = "AGAIN";
    const float aw = P.width(28, a, A, 0.05f) + 80, bw = P.width(28, b, A, 0.05f) + 64, total = aw + 16 + bw;
    float bx = W / 2 - total / 2;
    for (int i = 1; i >= 0; i--) {
      const bool on = at == 1 - i;
      const float w = i == 0 ? aw : bw, xx = i == 0 ? bx + bw + 16 : bx;
      float yy = y;
      hot(xx, y, w, 58, 1 - i);
      if (on) { yy -= 3; P.rr(xx + 4, yy + 7, w, 58, 14, i == 0 ? INK : RED); }
      P.card(xx, yy, w, 58, 14, 2.5f, i == 0 ? RED : on ? INK : CARD, INK);
      P.text(xx + w / 2, yy + 15, 28, i == 0 ? a : b, i == 0 ? ONRED : on ? PAPER : INK, CENTRE, A, 0.05f);
    }
    P.text(W / 2, y + 76, 10, "LEFT / RIGHT  -  ENTER", SOFT, CENTRE, RB, 0.16f);
  }
  (void)H;
}

}  // namespace xbr
