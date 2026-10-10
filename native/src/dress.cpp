// dress.cpp — see dress.hpp.
#include "dress.hpp"
#include "knock.hpp"

#include <epoxy/gl.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <array>
#include <fstream>
#include <functional>
#include <ft2build.h>
#include FT_FREETYPE_H

namespace xbr {

// ---- shared -----------------------------------------------------------------------
static GLuint compileD(GLenum type, const char *src) {
  const GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, nullptr, log); std::fprintf(stderr, "dress: shader:\n%s\n", log); return 0; }
  return s;
}
static GLuint linkD(const char *vs, const char *fs) {
  const GLuint v = compileD(GL_VERTEX_SHADER, vs), f = compileD(GL_FRAGMENT_SHADER, fs);
  if (!v || !f) return 0;
  const GLuint p = glCreateProgram();
  glAttachShader(p, v); glAttachShader(p, f);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(p, sizeof log, nullptr, log); std::fprintf(stderr, "dress: link:\n%s\n", log); return 0; }
  glDeleteShader(v); glDeleteShader(f);
  return p;
}

// PAM (P7), RGB or RGB_ALPHA, 8 bit — what tools/bakecar.mjs and the Makefile
// write, so the game needs no JPEG or PNG decoder of its own.
static bool readPAM(const std::string &path, int &w, int &h, std::vector<unsigned char> &rgba) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::string tok;
  int depth = 0, maxv = 0;
  w = h = 0;
  f >> tok;
  if (tok != "P7") return false;
  while (f >> tok) {
    if (tok == "ENDHDR") break;
    if (tok == "WIDTH") f >> w;
    else if (tok == "HEIGHT") f >> h;
    else if (tok == "DEPTH") f >> depth;
    else if (tok == "MAXVAL") f >> maxv;
    else if (tok == "TUPLTYPE") f >> tok;
  }
  f.get();
  if (w <= 0 || h <= 0 || maxv != 255 || (depth != 3 && depth != 4)) return false;
  std::vector<unsigned char> raw((size_t)w * h * depth);
  f.read((char *)raw.data(), (std::streamsize)raw.size());
  if (!f) return false;
  if (depth == 4) { rgba.swap(raw); return true; }
  rgba.resize((size_t)w * h * 4);
  for (size_t i = 0, n = (size_t)w * h; i < n; i++) { rgba[i * 4] = raw[i * 3]; rgba[i * 4 + 1] = raw[i * 3 + 1]; rgba[i * 4 + 2] = raw[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return true;
}
static GLuint texture(const std::string &path, bool repeat = true) {
  int w, h;
  std::vector<unsigned char> px;
  if (!readPAM(path, w, h, px)) return 0;
  GLuint t = 0;
  glGenTextures(1, &t);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, t);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  glGenerateMipmap(GL_TEXTURE_2D);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
  if (epoxy_has_gl_extension("GL_EXT_texture_filter_anisotropic") || epoxy_gl_version() >= 46)
    glTexParameterf(GL_TEXTURE_2D, 0x84FE /* TEXTURE_MAX_ANISOTROPY */, 6.0f);
  return t;
}

// ---- the downloaded cars ---------------------------------------------------------------
// Roles, as tools/bakecar.mjs names them.
enum Role { R_TRIM, R_PAINT, R_GLASS, R_TYRE, R_RIM, R_LAMP, R_TAIL, R_CHROME };
static int roleOf(const std::string &s) {
  if (s == "paint") return R_PAINT;
  if (s == "glass") return R_GLASS;
  if (s == "tyre") return R_TYRE;
  if (s == "rim") return R_RIM;
  if (s == "lamp") return R_LAMP;
  if (s == "tail") return R_TAIL;
  if (s == "chrome") return R_CHROME;
  return R_TRIM;
}
struct PackMat { int role = R_TRIM; float col[3] = {1, 1, 1}; float alpha = 1; GLuint map = 0; bool cutout = false; bool see = false; };
// part: 0 body, 1..4 a wheel that spins (fl fr rl rr), 5..8 the same wheel's hub (steers, does not spin)
struct PackGroup { int part = 0, mat = 0; GLuint vao = 0; int count = 0; };
struct PackCar {
  std::string key;
  std::vector<PackMat> mats;
  std::vector<PackGroup> groups;
  GLuint vbo = 0, ebo = 0;
  double wc[4][3] = {}, wr[4] = {0.33, 0.33, 0.33, 0.33};
  double wheelbase = 2.6;
  float eye[3] = {-0.1f, 1.0f, -0.36f};
  size_t tris = 0;
  // the eighty teams this car can race as (data/livery/<key>.json), and the frame they are painted in
  struct Livery {
    float base[3]; float rim[4] = {0, 0, 0, 0}; int finish = 0, nLayers = 0, nStk = 0;
    int type[12]; float col[12][3], q[12][4], side[12];
    float rect[24][4], uv[24][4], tint[24][4], plane[24];
  };
  std::vector<Livery> liveries;
  float frame[4] = {0, 2.3f, 1.2f, 1.0f};
  // where the light comes out: found on the bodywork itself when the car is loaded ([0] left, [1] right)
  float lampP[2][3] = {}, tailP[2][3] = {};
};
size_t Dress::liveryCount(const PackCar &pc) const { return pc.liveries.size(); }
PackInfo packInfo(const PackCar &pc) {
  PackInfo I;
  for (int k = 0; k < 3; k++) I.eye[k] = pc.eye[k];
  I.wheelbase = pc.wheelbase; I.wheelR = pc.wr[0];
  return I;
}

// Lit the way the world is (render.cpp's FS): ambient from sky and ground, the
// sun at 0.78, the same fog. Colours are display values, as they are there.
static const char *CAR_VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
uniform mat4 uVP, uModel;
// DAMAGE, as render.cpp's own cars take it: each dent is where the car was hit
// (x forward, y left, in the pack's frame), how deep, how wide and which way the
// blow went. The bodywork is pushed in THERE. vP stays the undamaged position,
// so a livery is crumpled with the panel it is painted on instead of sliding over it.
uniform int uNDent; uniform vec4 uDent[8]; uniform vec2 uDentN[8];
out vec3 vW, vN, vP, vNo; out vec2 vU; out float vHurt;
void main(){
  vec3 p = aPos; float hurt = 0.0;
  for (int i = 0; i < uNDent; i++) {
    float t = distance(vec2(p.x, -p.z), uDent[i].xy) / uDent[i].w;
    if (t < 1.0) {
      float f = (1.0 - t * t); f *= f;
      float d = uDent[i].z * f;
      // pushed the way the blow went, and folded: a panel does not move in as one sheet
      float fold = 0.72 + 0.28 * sin(aPos.x * 23.0 + aPos.y * 31.0) * sin(aPos.z * 27.0 - aPos.y * 19.0);
      p.x += uDentN[i].x * d * 0.52 * fold; p.z -= uDentN[i].y * d * 0.52 * fold;
      p.y -= d * 0.12 * clamp(p.y * 2.0, 0.0, 1.0);
      hurt += d;
    }
  }
  vHurt = clamp(hurt * 1.6, 0.0, 1.0);
  vec4 w = uModel * vec4(p, 1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vU = aUv; vP = aPos; vNo = aNrm; gl_Position = uVP * w; }
)";
// The livery (data/livery/livery.glsl, one source for this game and the browser's
// garage) is spliced in where the marker is; LIV_STUB stands in if the file is gone.
static const char *LIV_STUB = "vec3 livery(vec3 p, vec3 b){ return b; }\nvec3 stickers(vec3 c, vec3 p, vec3 n, sampler2D s){ return c; }\n";
static const char *CAR_FS_A = R"(#version 330 core
in vec3 vW, vN, vP, vNo; in vec2 vU; in float vHurt;
uniform sampler2D uTex, uSheet; uniform int uHasMap, uRole, uCutout, uLivOn, uLivFinish; uniform float uBrake;
uniform vec3 uLivBase; uniform vec4 uLivFrame, uRim;
)";
static const char *CAR_FS_B = R"(
uniform vec3 uColor, uPaint; uniform float uOpacity;
uniform vec3 uEye, uSun, uSunCol, uSkyAmb, uGndAmb, uFog, uSkyTop; uniform float uFogK;
// EVERY LAMP ON THE CIRCUIT, ON THE PAINT (Adam: "make all light reflect on the cars, especially
// headlights"). Up to eight: xyz where it is and w how bright; xyz which way it shines and w how
// narrow its beam (0 = all round); and its colour.
uniform int uNL; uniform vec4 uLP[8], uLD[8]; uniform vec3 uLC[8];
out vec4 o;
vec3 skyAt(vec3 d){ return mix(uFog, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.55)) * (d.y < 0.0 ? 0.45 : 1.0); }
void main(){
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  vec3 n = normalize(vN);
  // crumpled metal catches the light every which way
  if (vHurt > 0.02) {
    vec3 q = floor(vP * 26.0);
    vec3 j = fract(sin(vec3(dot(q, vec3(12.9898, 78.233, 37.719)), dot(q, vec3(39.346, 11.135, 83.155)), dot(q, vec3(73.156, 52.235, 9.151)))) * 43758.5453) - 0.5;
    n = normalize(n + j * 1.3 * vHurt);
  }
  if (dot(n, V) < 0.0) n = -n;
  vec4 t = uHasMap == 1 ? texture(uTex, vU) : vec4(1.0);
  if (uCutout == 1 && t.a < 0.5) discard;
  vec3 c = uHasMap == 1 ? t.rgb : uColor;
  float a = uOpacity;
  float gloss = 0.0, shine = 24.0, mirror = 0.0;
  // 0 trim  1 paint  2 glass  3 tyre  4 rim  5 lamp  6 tail  7 chrome
  if (uRole == 1) {
    gloss = 0.55; shine = 64.0; mirror = 0.10;
    if (uLivOn == 1) {
      // a team's livery: paint by where the bodywork is, then its stickers
      vec3 p = vec3((vP.x - uLivFrame.x) / uLivFrame.y, vP.y / uLivFrame.z, vP.z / uLivFrame.w);
      c = livery(p, uLivBase);
      c = stickers(c, p, normalize(vNo), uSheet);
      if (uLivFinish == 1) { gloss = 0.07; shine = 10.0; mirror = 0.0; }
      else if (uLivFinish == 2) { gloss = 0.75; shine = 90.0; mirror = 0.16; c *= 0.955 + 0.09 * livHash(floor(vP.xz * 700.0) + floor(vP.y * 700.0)); }
      else if (uLivFinish == 3) { gloss = 0.95; shine = 140.0; mirror = 0.58; c = mix(c, vec3(0.82), 0.22); }
      else if (uLivFinish == 4) { float fr = pow(1.0 - max(dot(n, V), 0.0), 2.0); c = mix(c, c.gbr * 1.1 + 0.06, fr * 0.55); gloss = 0.7; shine = 80.0; mirror = 0.14; }
    } else if (uPaint.x >= 0.0) c = uPaint;
  }
  else if (uRole == 2) { c = vec3(0.03, 0.04, 0.05); gloss = 0.9; shine = 120.0; mirror = 0.35; a = 0.62; }
  else if (uRole == 3) { if (uHasMap == 0) c = vec3(0.045); gloss = 0.04; shine = 8.0; }
  else if (uRole == 4) {
    if (uHasMap == 0 && dot(c, vec3(0.333)) < 0.03) c = vec3(0.17, 0.17, 0.19);
    // a team paints its wheels: the colour is theirs, the light and shade stay the wheel's own
    if (uRim.a > 0.5) c = uRim.rgb * (uHasMap == 1 ? clamp(dot(t.rgb, vec3(0.333)) * 1.5 + 0.25, 0.3, 1.2) : 1.0);
    gloss = 0.45; shine = 40.0; mirror = uRim.a > 0.5 ? 0.12 : 0.22; }
  else if (uRole == 7) { c = vec3(0.62, 0.63, 0.66); gloss = 0.8; shine = 90.0; mirror = 0.6; }
  else { gloss = 0.10; shine = 18.0; }
  // where it was hit the paint is scuffed to the primer and the shine is gone
  if (uRole != 2) { c = mix(c, vec3(dot(c, vec3(0.333)) * 0.45 + 0.03), vHurt * 0.55); gloss *= 1.0 - 0.8 * vHurt; mirror *= 1.0 - 0.9 * vHurt; }
  float ndl = max(dot(n, uSun), 0.0);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 lit = c * (amb + uSunCol * ndl * 0.78);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 h = normalize(uSun + V);
  lit = mix(lit, skyAt(reflect(-V, n)), clamp(mirror + fres * (mirror > 0.0 ? 0.5 : 0.0), 0.0, 0.9));
  lit += uSunCol * pow(max(dot(n, h), 0.0), shine) * gloss;
  // the lamps of every car, on this one: paint, glass, chrome and rims all throw them back
#define LSHINE max(shine, 40.0)
#define LGLOSS (0.15 + gloss)
#define LMIRROR (0.12 + mirror)
  for (int li = 0; li < uNL; li++) {
    vec3 Lv = uLP[li].xyz - vW; float d2 = dot(Lv, Lv); Lv *= inversesqrt(max(d2, 1e-4));
    // is this surface in the lamp's beam? (a headlight shines forward: it does not light the car it is on)
    float beam = uLD[li].w > 0.0 ? smoothstep(uLD[li].w - 0.35, uLD[li].w + 0.25, dot(-Lv, uLD[li].xyz)) : 1.0;
    float att = uLP[li].w * beam / (1.0 + d2 * 0.018);
    float nl = max(dot(n, Lv), 0.0);
    vec3 hl = normalize(Lv + V);
    lit += c * uLC[li] * nl * att * 0.55;                                              // the glow of it on the panel
    lit += uLC[li] * pow(max(dot(n, hl), 0.0), LSHINE) * LGLOSS * att * 2.2 * step(0.0, nl);          // the glint
    lit += uLC[li] * pow(max(dot(reflect(-V, n), Lv), 0.0), 420.0) * LMIRROR * att * 9.0;             // the lamp itself, in the lacquer
  }
  if (uRole == 6) lit += (uHasMap == 1 ? t.rgb : vec3(0.75, 0.05, 0.04)) * (0.40 + 2.4 * uBrake);
  if (uRole == 5) lit += vec3(0.80, 0.86, 0.92) * 1.3;
  if (uRole == 2) a = clamp(a + fres * 0.35, 0.0, 1.0);
  float f = 1.0 - exp(-dist * uFogK);
  o = vec4(mix(lit, uFog, f), a);
}
)";

const PackCar *Dress::pack(const std::string &key) {
  auto it = packs.find(key);
  if (it != packs.end()) return it->second.get();
  auto &slot = packs[key];                      // remembered even when it fails: do not hit the disk every frame
  const std::string dir = dataDir + "/cars/" + key + "/";
  const Json j = Json::loadOpt(dir + "car.json");
  if (!j.isObj()) { std::fprintf(stderr, "dress: no car pack at %scar.json (node tools/bakecar.mjs %s <folder>)\n", dir.c_str(), key.c_str()); return nullptr; }
  std::ifstream bf(dir + "car.bin", std::ios::binary);
  if (!bf) { std::fprintf(stderr, "dress: %scar.bin is missing\n", dir.c_str()); return nullptr; }
  const size_t nv = (size_t)j["verts"].n(), ni = (size_t)j["tris"].n() * 3;
  std::vector<float> verts(nv * 8);
  std::vector<unsigned> idx(ni);
  bf.read((char *)verts.data(), (std::streamsize)(verts.size() * 4));
  bf.read((char *)idx.data(), (std::streamsize)(idx.size() * 4));
  if (!bf) { std::fprintf(stderr, "dress: %scar.bin is shorter than car.json says\n", dir.c_str()); return nullptr; }

  auto pc = std::make_unique<PackCar>();
  pc->key = key;
  pc->tris = ni / 3;
  pc->wheelbase = j["wheelbase"].n(2.6);
  for (int k = 0; k < 3; k++) pc->eye[k] = (float)j["eye"][(size_t)k].n(pc->eye[k]);
  static const char *WN[4] = {"fl", "fr", "rl", "rr"};
  for (int w = 0; w < 4; w++) {
    const Json &jw = j["wheels"][WN[w]];
    for (int k = 0; k < 3; k++) pc->wc[w][k] = jw["c"][(size_t)k].n();
    pc->wr[w] = jw["r"].n(0.33);
  }
  for (const Json &m : j["materials"].arr) {
    PackMat pm;
    pm.role = roleOf(m["role"].s());
    // the file's colours are linear light; everything here is display values
    for (int k = 0; k < 3; k++) pm.col[k] = (float)std::pow(std::max(0.0, m["color"][(size_t)k].n(1)), 1 / 2.2);
    pm.cutout = m["cutout"].truthy();
    if (m.has("alpha")) { pm.alpha = (float)std::max(0.35, m["alpha"].n(1)); pm.see = true; }
    if (pm.role == R_GLASS) pm.see = true;
    if (m.has("pam")) {
      pm.map = texture(dir + m["pam"].s());
      if (!pm.map) std::fprintf(stderr, "dress: %s: cannot read %s\n", key.c_str(), m["pam"].s().c_str());
    }
    pc->mats.push_back(pm);
  }
  {
    const double lox = j["lo"][(size_t)0].n(), hix = j["hi"][(size_t)0].n(), hiy = j["hi"][(size_t)1].n(), loz = j["lo"][(size_t)2].n(), hiz = j["hi"][(size_t)2].n();
    pc->frame[0] = (float)((lox + hix) / 2); pc->frame[1] = (float)std::max(0.5, (hix - lox) / 2);
    pc->frame[2] = (float)std::max(0.5, hiy); pc->frame[3] = (float)std::max(0.4, std::max(hiz, -loz));
    auto hex = [](const std::string &h, float *o) { const unsigned long v = std::strtoul(h.c_str(), nullptr, 16); o[0] = ((v >> 16) & 255) / 255.0f; o[1] = ((v >> 8) & 255) / 255.0f; o[2] = (v & 255) / 255.0f; };
    const Json lj = Json::loadOpt(dataDir + "/livery/" + key + ".json");
    for (const Json &l : lj.arr) {
      PackCar::Livery L{};
      hex(l["base"].s("d6001c"), L.base);
      L.finish = (int)l["finish"].n();
      if (l["rim"].type == Json::Str) { hex(l["rim"].s(), L.rim); L.rim[3] = 1; }
      for (const Json &y : l["layers"].arr) {
        if (L.nLayers >= 12) break;
        const int k = L.nLayers++;
        L.type[k] = (int)y["t"].n(); hex(y["c"].s(), L.col[k]); L.side[k] = (float)y["s"].n();
        for (int q = 0; q < 4; q++) L.q[k][q] = (float)y["q"][(size_t)q].n();
      }
      for (const Json &y : l["stickers"].arr) {
        if (L.nStk >= 24) break;
        const int k = L.nStk++;
        for (int q = 0; q < 4; q++) { L.rect[k][q] = (float)y["rect"][(size_t)q].n(); L.uv[k][q] = (float)y["uv"][(size_t)q].n(); }
        L.plane[k] = (float)y["plane"].n();
        if (y["tint"].type == Json::Str) { hex(y["tint"].s(), L.tint[k]); L.tint[k][3] = 1; } else L.tint[k][3] = 0;
      }
      pc->liveries.push_back(L);
    }
  }
  glGenBuffers(1, &pc->vbo);
  glBindBuffer(GL_ARRAY_BUFFER, pc->vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(verts.size() * 4), verts.data(), GL_STATIC_DRAW);
  for (const Json &g : j["groups"].arr) {
    PackGroup G;
    const std::string part = g["part"].s();
    G.part = 0;
    for (int w = 0; w < 4; w++) if (part.rfind(WN[w], 0) == 0) G.part = (part.size() > 2 ? 5 : 1) + w;
    G.mat = (int)g["mat"].n();
    if (G.mat < 0 || G.mat >= (int)pc->mats.size()) continue;
    const size_t v0 = (size_t)g["v0"].n(), i0 = (size_t)g["i0"].n(), in = (size_t)g["in"].n();
    if (i0 + in > idx.size()) continue;
    G.count = (int)in;
    GLuint ebo = 0;
    glGenVertexArrays(1, &G.vao);
    glBindVertexArray(G.vao);
    glBindBuffer(GL_ARRAY_BUFFER, pc->vbo);
    // the group's indices count from its own first vertex: point the attributes there
    const GLsizei st = 8 * sizeof(float);
    const size_t base = v0 * 8 * sizeof(float);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)base);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(base + 3 * sizeof(float)));
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, st, (void *)(base + 6 * sizeof(float)));
    glGenBuffers(1, &ebo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(in * 4), &idx[i0], GL_STATIC_DRAW);
    pc->groups.push_back(G);
  }
  glBindVertexArray(0);
  std::fprintf(stderr, "dress: car pack %s — %zu triangles, %zu groups, %zu materials, %zu liveries\n", key.c_str(), pc->tris, pc->groups.size(), pc->mats.size(), pc->liveries.size());
  // WHERE THE LAMPS ARE. Nobody labelled them, so ask the bodywork: the furthest
  // forward point at headlamp height out towards each corner, and the furthest
  // back at tail-lamp height. (A wheel's vertices are about its hub: too low to be picked.)
  {
    const float w = pc->frame[3];
    for (int s = 0; s < 2; s++) {
      float bf = -1e9f, br = 1e9f;
      pc->lampP[s][0] = pc->frame[0] + pc->frame[1] - 0.3f; pc->lampP[s][1] = 0.62f; pc->lampP[s][2] = (s ? 1 : -1) * w * 0.36f;
      pc->tailP[s][0] = pc->frame[0] - pc->frame[1] + 0.1f; pc->tailP[s][1] = 0.78f; pc->tailP[s][2] = (s ? 1 : -1) * w * 0.36f;
      for (size_t v = 0; v < nv; v++) {
        const float x = verts[v * 8], y = verts[v * 8 + 1], z = verts[v * 8 + 2] * (s ? 1 : -1);
        if (z < w * 0.60f || z > w * 0.84f) continue;
        if (y > 0.50f && y < 0.78f && x > bf) { bf = x; pc->lampP[s][0] = x; pc->lampP[s][1] = y; pc->lampP[s][2] = verts[v * 8 + 2]; }
        if (y > 0.58f && y < 0.92f && x < br) { br = x; pc->tailP[s][0] = x; pc->tailP[s][1] = y; pc->tailP[s][2] = verts[v * 8 + 2]; }
      }
    }
  }
  slot = std::move(pc);
  return slot.get();
}

// ---- lights ------------------------------------------------------------------------------
static const char *GLOW_VS = R"(#version 330 core
layout(location=0) in vec2 aQ;
uniform mat4 uVP; uniform vec3 uC, uU, uV;
out vec2 vQ;
void main(){ vQ = aQ; gl_Position = uVP * vec4(uC + uU * aQ.x + uV * aQ.y, 1.0); }
)";
// 0 a lamp: a hard core in a soft halo   1 a brake disc: a ring   2 light lying on the road
static const char *GLOW_FS = R"(#version 330 core
in vec2 vQ; uniform vec4 uCol; uniform int uShape; out vec4 o;
void main(){
  float r = length(vQ), a;
  if (uShape == 1) a = smoothstep(0.36, 0.52, r) * (1.0 - smoothstep(0.84, 1.0, r));
  else if (uShape == 2) a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.8, 1.0, r));
  else a = (exp(-r * r * 6.0) * 0.30 + exp(-r * r * 60.0)) * (1.0 - smoothstep(0.8, 1.0, r));
  o = vec4(uCol.rgb * uCol.a * a, 1.0);
}
)";

void Dress::drawLights(const PackCar &pc, const Mat4 &carM, const void *who, double brake, double speed, double steer, const bool *lost,
                       const double *sag) {
  if (!glowProg) {
    glowProg = linkD(GLOW_VS, GLOW_FS);
    if (!glowProg) return;
    const float q[8] = {-1, -1, 1, -1, -1, 1, 1, 1};
    glGenVertexArrays(1, &glowVao); glGenBuffers(1, &glowVbo);
    glBindVertexArray(glowVao); glBindBuffer(GL_ARRAY_BUFFER, glowVbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof q, q, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
  }
  // THE DISCS' HEAT. Braking from speed pours it in, the air takes it away: a
  // stop from two hundred lights them, and they fade down the next straight.
  Heat &H = heat[who];
  const double dt = H.t < 0 ? 0 : std::clamp(time - H.t, 0.0, 0.1);
  H.t = time;
  const double v = std::fabs(speed);
  H.h = (float)std::clamp(H.h + (std::clamp(brake, 0.0, 1.0) * std::min(1.0, v / 55.0) * 1.5 - H.h * (0.16 + v * 0.004)) * dt, 0.0, 1.4);
  const float hot = std::clamp((H.h - 0.30f) / 0.6f, 0.0f, 1.0f);

  GLint was = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &was);
  const GLboolean cull = glIsEnabled(GL_CULL_FACE);
  glUseProgram(glowProg);
  glUniformMatrix4fv(glGetUniformLocation(glowProg, "uVP"), 1, GL_FALSE, VP.m);
  const GLint uC = glGetUniformLocation(glowProg, "uC"), uU = glGetUniformLocation(glowProg, "uU"), uV = glGetUniformLocation(glowProg, "uV"),
              uCol = glGetUniformLocation(glowProg, "uCol"), uShape = glGetUniformLocation(glowProg, "uShape");
  glEnable(GL_BLEND); glBlendFunc(GL_ONE, GL_ONE);
  glDepthMask(GL_FALSE); glDisable(GL_CULL_FACE);
  glBindVertexArray(glowVao);
  const float *m = carM.m;
  const auto at = [&](float x, float y, float z, float *o) { for (int k = 0; k < 3; k++) o[k] = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]; };
  const float night = look.night;
  // a lamp faces the eye, and is only seen from the end of the car it is on
  const auto lamp = [&](const float *p, float out, float size, const float col[3], float power) {
    float c[3];
    at(p[0] + out * 0.05f, p[1], p[2], c);
    float e[3] = {eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]};
    const float d = std::sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    if (d < 0.3f || d > 900) return;
    for (float &q : e) q /= d;
    const float facing = (e[0] * m[0] + e[1] * m[1] + e[2] * m[2]) * out;
    if (facing < 0.04f) return;
    float r[3] = {e[2], 0, -e[0]};
    const float rl = std::max(1e-4f, std::sqrt(r[0] * r[0] + r[2] * r[2]));
    r[0] /= rl; r[2] /= rl;
    const float u[3] = {e[1] * r[2] - e[2] * r[1], e[2] * r[0] - e[0] * r[2], e[0] * r[1] - e[1] * r[0]};
    // far away a lamp is a point that must not vanish between pixels
    const float s = std::max(size, d * 0.004f);
    glUniform3fv(uC, 1, c);
    glUniform3f(uU, r[0] * s, r[1] * s, r[2] * s); glUniform3f(uV, u[0] * s, u[1] * s, u[2] * s);
    glUniform4f(uCol, col[0], col[1], col[2], power * std::min(1.0f, facing * 3.5f) * std::exp(-d * look.fogK));
    glUniform1i(uShape, 0);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  };
  const float white[3] = {1.0f, 0.95f, 0.84f}, red[3] = {1.0f, 0.07f, 0.04f};
  const float b = (float)std::clamp(brake, 0.0, 1.0);
  for (int s = 0; s < 2; s++) {
    lamp(pc.lampP[s], 1, 0.24f + 0.30f * night, white, 1.2f + 1.6f * night);
    lamp(pc.tailP[s], -1, 0.15f + 0.09f * b + 0.08f * night, red, 0.40f + 0.25f * night + 1.5f * b);
  }
  // the light the headlamps throw: a long pool on the road ahead, at night
  if (night > 0.25f) {
    float c[3];
    at(pc.frame[0] + pc.frame[1] + 8.5f, 0.05f, 0, c);
    glUniform3fv(uC, 1, c);
    glUniform3f(uU, m[0] * 9.5f, m[1] * 9.5f, m[2] * 9.5f); glUniform3f(uV, m[8] * 3.4f, m[9] * 3.4f, m[10] * 3.4f);
    glUniform4f(uCol, white[0], white[1], white[2], 0.42f * night);
    glUniform1i(uShape, 2);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  }
  // the discs: a ring in the plane of each wheel, seen through the spokes
  if (hot > 0.02f) {
    glUniform1i(uShape, 1);
    for (int w = 0; w < 4; w++) {
      if (lost && lost[w]) continue;
      Mat4 hub = carM * Mat4::translate((float)pc.wc[w][0], (float)(pc.wc[w][1] + (sag ? sag[w] : 0)), (float)pc.wc[w][2]);
      if (w < 2) hub = hub * Mat4::rotY((float)steer);
      const float rr = (float)pc.wr[w] * 0.62f, k = hot * (w < 2 ? 1.0f : 0.6f);     // the fronts do most of the stopping
      glUniform3f(uC, hub.m[12], hub.m[13], hub.m[14]);
      glUniform3f(uU, hub.m[0] * rr, hub.m[1] * rr, hub.m[2] * rr); glUniform3f(uV, hub.m[4] * rr, hub.m[5] * rr, hub.m[6] * rr);
      // dull red first, orange when it is really hot
      glUniform4f(uCol, 1.0f, 0.16f + 0.34f * k, 0.03f + 0.10f * k * k, 0.5f + 2.6f * k);
      glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
  }
  glBindVertexArray(0);
  glDepthMask(GL_TRUE); glDisable(GL_BLEND);
  if (cull) glEnable(GL_CULL_FACE);
  glUseProgram((GLuint)was);
}

void Dress::setDents(const Car *car, double shift) {
  nDent = 0;
  if (!car) return;
  nDent = (int)std::min<size_t>(8, car->dents.size());
  for (int i = 0; i < nDent; i++) {
    const Dent &D = car->dents[(size_t)i];
    dentV[i * 4] = (float)(D.lx - shift); dentV[i * 4 + 1] = (float)D.ly; dentV[i * 4 + 2] = (float)D.depth; dentV[i * 4 + 3] = (float)std::max(0.2, D.r);
    dentN[i * 2] = (float)D.nx; dentN[i * 2 + 1] = (float)D.ny;
  }
}

void Dress::lights(unsigned prog) {
  const Look &L = look;
  if (prog == carProg) {
    glUniform1i(glGetUniformLocation(prog, "uNL"), nLamp);
    if (nLamp) {
      glUniform4fv(glGetUniformLocation(prog, "uLP"), nLamp, lampP);
      glUniform4fv(glGetUniformLocation(prog, "uLD"), nLamp, lampD);
      glUniform3fv(glGetUniformLocation(prog, "uLC"), nLamp, lampC);
    }
  }
  const float sl = std::sqrt(L.sun[0] * L.sun[0] + L.sun[1] * L.sun[1] + L.sun[2] * L.sun[2]);
  glUniformMatrix4fv(glGetUniformLocation(prog, "uVP"), 1, GL_FALSE, VP.m);
  glUniform3f(glGetUniformLocation(prog, "uEye"), eye[0], eye[1], eye[2]);
  glUniform3f(glGetUniformLocation(prog, "uSun"), L.sun[0] / sl, L.sun[1] / sl, L.sun[2] / sl);
  glUniform3fv(glGetUniformLocation(prog, "uSunCol"), 1, L.sunCol);
  glUniform3fv(glGetUniformLocation(prog, "uSkyAmb"), 1, L.skyAmb);
  glUniform3fv(glGetUniformLocation(prog, "uGndAmb"), 1, L.gndAmb);
  glUniform3fv(glGetUniformLocation(prog, "uFog"), 1, L.fog);
  glUniform3fv(glGetUniformLocation(prog, "uSkyTop"), 1, L.skyTop);
  glUniform1f(glGetUniformLocation(prog, "uFogK"), L.fogK);
}

void Dress::drawPack(const PackCar &pc, const Mat4 &carM, double steer, double rolled, const float *paint, const bool *lost,
                     const double *sag, bool glassPass) {
  GLint was = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &was);
  glUseProgram(carProg);
  lights(carProg);
  const GLint uModel = glGetUniformLocation(carProg, "uModel"), uHasMap = glGetUniformLocation(carProg, "uHasMap"),
              uRole = glGetUniformLocation(carProg, "uRole"), uCutout = glGetUniformLocation(carProg, "uCutout"),
              uColor = glGetUniformLocation(carProg, "uColor"), uPaint = glGetUniformLocation(carProg, "uPaint"),
              uOpacity = glGetUniformLocation(carProg, "uOpacity");
  glUniform1i(glGetUniformLocation(carProg, "uTex"), 0);
  glUniform1f(glGetUniformLocation(carProg, "uBrake"), brakeNow);
  if (paint) glUniform3f(uPaint, paint[0], paint[1], paint[2]); else glUniform3f(uPaint, -1, 0, 0);
  // WHICH TEAM. The one asked for (setLivery), else one chosen by the paint
  // colour the game hands every car — so a rival keeps its livery all race and
  // two cars of one team match, with nothing for the game to remember.
  const PackCar::Livery *L = nullptr;
  if (!pc.liveries.empty() && liveryOn) {
    size_t ix;
    if (liveryIx >= 0) ix = (size_t)liveryIx % pc.liveries.size();
    else {
      unsigned h = 2166136261u;
      const float *pp = paint ? paint : pc.liveries[0].base;
      for (int k = 0; k < 3; k++) { h ^= (unsigned)std::lround(pp[k] * 255) + 0x9e3779b9u; h *= 16777619u; }
      ix = (h >> 8) % pc.liveries.size();
    }
    L = &pc.liveries[ix];
    if (!sheet && !sheetTried) { sheet = texture(texDir + "/livery-atlas.pam", false); if (!sheet) { std::fprintf(stderr, "dress: no %s/livery-atlas.pam (run make) — liveries without stickers\n", texDir.c_str()); sheetTried = true; } }
    auto U = [&](const char *n) { return glGetUniformLocation(carProg, n); };
    glUniform3fv(U("uLivBase"), 1, L->base);
    glUniform4fv(U("uLivFrame"), 1, pc.frame);
    glUniform1i(U("uLivFinish"), L->finish);
    glUniform1i(U("uLivN"), L->nLayers);
    glUniform1iv(U("uLivType"), 12, L->type);
    glUniform3fv(U("uLivCol"), 12, &L->col[0][0]);
    glUniform4fv(U("uLivP"), 12, &L->q[0][0]);
    glUniform1fv(U("uLivSide"), 12, L->side);
    glUniform1i(U("uStkN"), sheet ? L->nStk : 0);
    glUniform4fv(U("uStkRect"), 24, &L->rect[0][0]);
    glUniform4fv(U("uStkUv"), 24, &L->uv[0][0]);
    glUniform4fv(U("uStkTint"), 24, &L->tint[0][0]);
    glUniform1fv(U("uStkPlane"), 24, L->plane);
    glUniform1i(U("uSheet"), 4);
    glActiveTexture(GL_TEXTURE4); glBindTexture(GL_TEXTURE_2D, sheet);
  }
  const float noRim[4] = {0, 0, 0, 0};
  glUniform4fv(glGetUniformLocation(carProg, "uRim"), 1, L ? L->rim : noRim);
  const GLint uLivOn = glGetUniformLocation(carProg, "uLivOn");
  Mat4 hub[4], spin[4];
  for (int w = 0; w < 4; w++) {
    hub[w] = carM * Mat4::translate((float)pc.wc[w][0], (float)(pc.wc[w][1] + (sag ? sag[w] : 0)), (float)pc.wc[w][2]);
    if (w < 2) hub[w] = hub[w] * Mat4::rotY((float)steer);
    spin[w] = hub[w] * Mat4::rotZ((float)(-rolled / pc.wr[w]));
  }
  if (glassPass) { glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDepthMask(GL_FALSE); }
  glActiveTexture(GL_TEXTURE0);
  const GLint uNDentL = glGetUniformLocation(carProg, "uNDent");
  if (nDent) { glUniform4fv(glGetUniformLocation(carProg, "uDent"), nDent, dentV); glUniform2fv(glGetUniformLocation(carProg, "uDentN"), nDent, dentN); }
  for (const PackGroup &G : pc.groups) {
    const PackMat &M = pc.mats[(size_t)G.mat];
    if (M.see != glassPass) continue;
    const int w = G.part == 0 ? -1 : (G.part - 1) % 4;
    if (w >= 0 && lost && lost[w]) continue;
    glUniformMatrix4fv(uModel, 1, GL_FALSE, (G.part == 0 ? carM : G.part <= 4 ? spin[w] : hub[w]).m);
    glUniform1i(uNDentL, G.part == 0 ? nDent : 0);                          // the body dents; a wheel's vertices are about its hub
    glUniform1i(uHasMap, M.map ? 1 : 0);
    glUniform1i(uRole, M.role);
    glUniform1i(uLivOn, L && G.part == 0 && M.role == R_PAINT ? 1 : 0);      // paintwork on the body; a wheel's vertices are about its hub
    glUniform1i(uCutout, M.cutout && !(L && G.part == 0 && M.role == R_PAINT) ? 1 : 0);
    glUniform3fv(uColor, 1, M.col);
    glUniform1f(uOpacity, M.alpha);
    if (M.map) glBindTexture(GL_TEXTURE_2D, M.map);
    glBindVertexArray(G.vao);
    glDrawElements(GL_TRIANGLES, G.count, GL_UNSIGNED_INT, nullptr);
  }
  // WHEELS AT SPEED (Adam: "make the wheels blur when going fast, like js the
  // rims and the words on them"). Over each wheel drawn once sharp, the same
  // wheel again across the angle it turns through while a 1/75 s shutter is
  // open, each copy faint: spokes smear into a disc, lettering into a ring.
  // Only for cars close enough to see it; a pack wheel is a lot of triangles.
  const float dx = carM.m[12] - eye[0], dy = carM.m[13] - eye[1], dz = carM.m[14] - eye[2];
  if (!glassPass && wheelSweep > 0.09f && dx * dx + dy * dy + dz * dz < 40.0f * 40.0f) {
    const int N = std::clamp((int)(7 + wheelSweep * 5), 7, 18);
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(-1.0f, -2.0f);
    for (const PackGroup &G : pc.groups) {
      if (G.part < 1 || G.part > 4) continue;
      const PackMat &M = pc.mats[(size_t)G.mat];
      const int w = G.part - 1;
      if (M.see || (lost && lost[w])) continue;
      glUniform1i(uHasMap, M.map ? 1 : 0); glUniform1i(uRole, M.role); glUniform1i(uLivOn, 0); glUniform1i(uCutout, M.cutout ? 1 : 0);
      glUniform3fv(uColor, 1, M.col);
      glUniform1f(uOpacity, 1.55f / N);
      if (M.map) glBindTexture(GL_TEXTURE_2D, M.map);
      glBindVertexArray(G.vao);
      for (int k = 0; k < N; k++) {
        const float off = ((k + 0.5f) / N - 0.5f) * wheelSweep;
        glUniformMatrix4fv(uModel, 1, GL_FALSE, (hub[w] * Mat4::rotZ((float)(-rolled / pc.wr[w]) + off)).m);
        glDrawElements(GL_TRIANGLES, G.count, GL_UNSIGNED_INT, nullptr);
      }
    }
    glDisable(GL_POLYGON_OFFSET_FILL);
    glDepthMask(GL_TRUE); glDisable(GL_BLEND);
  }
  if (glassPass) { glDepthMask(GL_TRUE); glDisable(GL_BLEND); }
  glBindVertexArray(0);
  glUseProgram((GLuint)was);
}

// ---- the woods and the boards -----------------------------------------------------------
//
// ADAM'S FOREST (LOOK.md, the 2026-09-23 amendment; js/forest.js + js/woods.js):
//
//   "3 rows of randomly resized and spun trees, between the 2nd and 3rd row a
//    Short banner (paper thin 2d just flat) of flora, then a taller one behind
//    the 3rd, then from then on 3 layers of cutout trees that slowly rotate to
//    face the player, a little taller than the others, then a big superdark
//    green background, remmber, as things get deeper, they get darker."
//
// Front to back from the TREELINE: row 1, row 2, SHORT BANNER, row 3, TALL
// BANNER, paper 1 2 3, BACKDROP — each layer 0.64 of the light of the one in
// front. The treelines come from the survey (walk out square to the track from
// the run-off; the first wood you step into is where it begins, and how far
// you can keep walking inside it is how deep it is).
//
// AND HOW IT GOES AWAY WITH DISTANCE (Adam, 2026-10-08: "fade the forests by
// removing the back green layer first then the next, then the next then sparse
// trees"): the backdrop goes first, then the paper rows from the back, then
// the banners, and last the real rows thin to one tree in three. FADE below.
namespace {

const double ROW_GAP = 5.0, PAPER_SPACING = 2.6, PAPER_GAP_MIN = 2.5, PAPER_TALLER = 1.15;
const double ROW_SPACING[3] = {5.2, 4.4, 3.8};
const double SHORT_H = 2.4, TALL_H = 6.2, WALL_H = 9.0, LAYER_SHADE = 0.64;
const double STEP = 5, SEARCH = 150, MARCH = 2, JUMP = 8, CLEAR = 1.5, HOLE = 12, FAR_CLEAR = 30, REACH = 700;
// A tree is drawn leaf by leaf only within NEAR_TREES of the eye; past that it
// is two crossed photographs of itself. The hand-over is per TREE, in the
// vertex shader, by the same distance on both sides, so nothing pops and
// nothing is drawn twice. The leaf-by-leaf trees are kept in small cells
// (TCELL) so only the handful near the car are ever sent to the card.
// (It was 150 m by 220 m cells: every tree within 300 m, a million triangles,
// 17.8 ms of a 56 ms frame on the UHD 620.)
const double CELL = 220, NEAR_TREES = 70, TCELL = 56;
// fade ids
enum { F_ROW = 0, F_SHORT = 1, F_TALL = 2, F_PAPER1 = 3, F_PAPER2 = 4, F_PAPER3 = 5, F_BACK = 6, F_FAR = 7, F_NEVER = 8, N_FADE = 9 };
// metres from the eye: starts to go, gone; and the share that never goes (the sparse trees)
const float FADE[N_FADE][3] = {
  {650, 800, 0.34f},     // the real rows thin to one in three — last of all
  {590, 650, 0},         // short banner
  {590, 650, 0},         // tall banner
  {520, 590, 0},         // paper 1
  {450, 520, 0},         // paper 2
  {380, 450, 0},         // paper 3
  {300, 380, 0},         // the backdrop: first to go
  {900, 1100, 0.5f},     // the woods beyond the treelines: half of them stay to the horizon
  {1e9f, 1e9f, 1},       // boards
};
const float FAR0 = 1500, FAR1 = 1800;   // past this nothing of the wood is drawn at all
// texture layers
enum { L_LEAF = 0, L_NEEDLE = 1, L_SHORT = 2, L_TALL = 3, L_BARK = 4, L_BROAD = 5, L_CONE = 6, L_BOARD = 7, N_LAYER = 8 };
const int TEX = 1024;

struct Rnd {
  unsigned s;
  explicit Rnd(unsigned seed) : s(seed ? seed : 1) {}
  double operator()() { s = s * 1664525u + 1013904223u; return s / 4294967296.0; }
};
struct Rect { double x, y, w, h; };

// One vertex of a tree in the kit: pos3 nrm3 uv3 col3 sway1
typedef std::vector<float> Kit;
void kv(Kit &k, double x, double y, double z, double nx, double ny, double nz, double u, double v, double layer, double shade, double sway) {
  const float f[13] = {(float)x, (float)y, (float)z, (float)nx, (float)ny, (float)nz, (float)u, (float)v, (float)layer, (float)shade, (float)shade, (float)shade, (float)sway};
  k.insert(k.end(), f, f + 13);
}
// A bent card, which is every leaf and every sprig (js/forest.js card()).
struct CardOpt { int rows = 2; double bend = 0, tilt = 0, yaw = 0, at[3] = {0, 0, 0}, shade = 1, droop = 0, roll = 0; bool cross = false; };
void card(Kit &k, const Rect &r, int layer, double w, double h, CardOpt o) {
  if (o.cross) {
    CardOpt a = o; a.cross = false; card(k, r, layer, w, h, a);
    a.shade = o.shade * 0.86; a.roll = o.roll + 3.14159265358979 / 2; card(k, r, layer, w, h, a);
    return;
  }
  const double cy = std::cos(o.yaw), sy = std::sin(o.yaw), ct = std::cos(o.tilt), st = std::sin(o.tilt);
  const double wx = std::cos(o.roll), wy = -std::sin(o.roll) * st, wz = std::sin(o.roll) * ct;
  struct V { double p[3], n[3], u, v, c, s; };
  std::vector<V> vs;
  for (int row = 0; row <= o.rows; row++) {
    const double t = (double)row / o.rows, lean = o.bend * t * t, y = h * t * ct - o.droop * t * t, z0 = h * t * st + lean;
    const double sh = o.shade * (0.74 + 0.26 * t);
    for (double sgn : {-0.5, 0.5}) {
      const double x = sgn * w * (1 - 0.12 * t);
      const double lx = x * wx, ly = y + x * wy, lz = z0 + x * wz;
      V v;
      v.p[0] = lx * cy - lz * sy + o.at[0]; v.p[1] = ly + o.at[1]; v.p[2] = lx * sy + lz * cy + o.at[2];
      v.u = r.x + (sgn + 0.5) * r.w; v.v = 1 - (r.y + t * r.h);          // the atlas's rects count v up from the bottom; the picture is stored top first
      if (o.roll == 0) { v.n[0] = -sy * 0.45; v.n[1] = 0.89; v.n[2] = cy * 0.45; }
      else {
        double nx = ct * wz - st * wy, ny = st * wx, nz = -ct * wx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        ny += 0.55;
        const double L = std::hypot(nx, std::hypot(ny, nz));
        nx /= L; ny /= L; nz /= L;
        v.n[0] = nx * cy - nz * sy; v.n[1] = ny; v.n[2] = nx * sy + nz * cy;
      }
      v.c = sh; v.s = t;
      vs.push_back(v);
    }
  }
  for (int row = 0; row < o.rows; row++) {
    const int a = row * 2;
    for (int i : {a, a + 1, a + 3, a, a + 3, a + 2}) { const V &v = vs[(size_t)i]; kv(k, v.p[0], v.p[1], v.p[2], v.n[0], v.n[1], v.n[2], v.u, v.v, layer, v.c, v.s); }
  }
}
// A trunk or a branch: a tapered tube, bark at its true size (UVs are metres / 2).
void trunk(Kit &k, double rBase, double rTop, double h, int sides, double lean, double shade, double yaw = 0, double y0 = 0) {
  auto pt = [&](double a, double t, double out[3], double nn[3]) {
    const double r = rBase + (rTop - rBase) * t;
    double x = std::cos(a) * r, y = h * t, z = std::sin(a) * r;
    // lean: turn about z, then yaw about y
    const double cl = std::cos(lean), sl = std::sin(lean);
    const double x2 = x * cl - y * sl, y2 = x * sl + y * cl;
    const double cyw = std::cos(yaw), syw = std::sin(yaw);
    out[0] = x2 * cyw + z * syw; out[1] = y2 + y0; out[2] = -x2 * syw + z * cyw;
    const double nx = std::cos(a) * cl, ny = std::cos(a) * sl, nz = std::sin(a);
    nn[0] = nx * cyw + nz * syw; nn[1] = ny; nn[2] = -nx * syw + nz * cyw;
  };
  const double circ = 2 * 3.14159265358979 * (rBase + rTop) * 0.5;
  for (int s = 0; s < sides; s++) {
    const double a0 = 2 * 3.14159265358979 * s / sides, a1 = 2 * 3.14159265358979 * (s + 1) / sides;
    double p[4][3], n[4][3];
    pt(a0, 0, p[0], n[0]); pt(a1, 0, p[1], n[1]); pt(a1, 1, p[2], n[2]); pt(a0, 1, p[3], n[3]);
    const double u0 = circ * s / sides / 2, u1 = circ * (s + 1) / sides / 2, uu[4] = {u0, u1, u1, u0}, vv[4] = {0, 0, h / 2, h / 2};
    for (int i : {0, 1, 2, 0, 2, 3}) kv(k, p[i][0], p[i][1], p[i][2], n[i][0], n[i][1], n[i][2], uu[i], vv[i], L_BARK, shade, 0);
  }
}
struct Species { Kit mesh; double frame = 10; float tint[3] = {1, 1, 1}; int layer = L_BROAD; };

void coniferFoliage(Kit &k, const std::vector<Rect> &rects, double h, double spread, int whorls, unsigned seed) {
  Rnd r(seed);
  for (int w = 0; w < whorls; w++) {
    const double t = 0.2 + 0.8 * ((double)w / (whorls - 1)), reach = spread * std::pow(1 - t, 0.72) + 0.4, shade = 0.30 + 0.70 * t;
    for (int j = 0; j < 2; j++) {
      const double yaw = w * 2.3999 + j * 3.14159265358979 + r() * 0.4;
      CardOpt o; o.rows = 2; o.tilt = 1.28 + r() * 0.2; o.bend = -reach * 0.18; o.yaw = yaw; o.shade = shade; o.cross = true; o.droop = reach * 0.22;
      o.at[0] = std::cos(yaw) * reach * 0.18; o.at[1] = h * t; o.at[2] = std::sin(yaw) * reach * 0.18;
      card(k, rects[(size_t)(w + j) % rects.size()], L_NEEDLE, reach * 2.3, reach * 1.45, o);
    }
  }
  CardOpt top; top.rows = 2; top.yaw = 0.7; top.shade = 1; top.at[1] = h * 0.94;
  card(k, rects[0], L_NEEDLE, spread * 0.7, spread * 1.1, top);
}
void palmFoliage(Kit &k, const std::vector<Rect> &rects, double h, double frond, int fronds, unsigned seed) {
  Rnd r(seed);
  for (int f = 0; f < fronds; f++) {
    const double t = (double)f / (fronds - 1), yaw = f * 2.3999 + r() * 0.35;
    const double len = frond * (0.75 + r() * 0.4) * (0.7 + 0.3 * std::sin(t * 3.14159265358979));
    CardOpt o; o.rows = 4; o.tilt = 0.35 + t * 1.25 + r() * 0.2; o.yaw = yaw; o.cross = true; o.droop = len * (0.18 + 0.42 * t); o.shade = 0.95 - 0.45 * t; o.at[1] = h - 0.25;
    card(k, rects[(size_t)f % rects.size()], L_NEEDLE, len * 0.34, len, o);
  }
}
void broadFoliage(Kit &k, const std::vector<Rect> &rects, double h, double crown, double leaf, int cards, unsigned seed) {
  Rnd r(seed);
  for (int c = 0; c < cards; c++) {
    const double t = (double)c / cards, yaw = c * 2.3999 + r() * 0.3;
    const double up = 0.28 + 0.78 * std::sin(t * 3.14159265358979 * 1.6 + r() * 0.5);
    const double out = crown * (0.42 + r() * 0.72) * std::max(0.35, std::sin(up * 3.14159265358979 * 0.85));
    const double size = leaf * (0.78 + r() * 0.55);
    // (0.16 at the darkest in the browser, where the leaf material also glows; here that is a black blob)
    const double shade = 0.40 + 0.60 * std::min(1.0, (out / crown) * 0.55 + up * 0.7);
    CardOpt o; o.rows = 2; o.tilt = 0.55 + r() * 1.0; o.bend = (r() - 0.5) * size * 0.5; o.yaw = yaw; o.shade = shade; o.droop = size * 0.18; o.cross = true;
    o.at[0] = std::cos(yaw) * out; o.at[1] = h * 0.6 + up * crown; o.at[2] = std::sin(yaw) * out;
    card(k, rects[(size_t)c % rects.size()], L_LEAF, size, size * 0.92, o);
  }
}

// "Am I inside one of these polygons?", asked a hundred thousand times.
struct PolyIndex {
  std::vector<std::vector<std::pair<double, double>>> polys;
  std::vector<std::array<double, 4>> box;
  std::map<long long, std::vector<int>> cells;
  static constexpr double G = 40;
  static long long key(double x, double y) { return (long long)std::floor(x / G) * 100003LL + (long long)std::floor(y / G); }
  void add(std::vector<std::pair<double, double>> p) {
    if (p.size() < 3) return;
    std::array<double, 4> b = {1e300, -1e300, 1e300, -1e300};
    for (auto &q : p) { b[0] = std::min(b[0], q.first); b[1] = std::max(b[1], q.first); b[2] = std::min(b[2], q.second); b[3] = std::max(b[3], q.second); }
    const int id = (int)polys.size();
    for (double gx = std::floor(b[0] / G); gx <= std::floor(b[1] / G); gx++)
      for (double gy = std::floor(b[2] / G); gy <= std::floor(b[3] / G); gy++) cells[(long long)gx * 100003LL + (long long)gy].push_back(id);
    polys.push_back(std::move(p)); box.push_back(b);
  }
  bool in(double x, double y) const {
    auto it = cells.find(key(x, y));
    if (it == cells.end()) return false;
    for (int id : it->second) {
      const auto &b = box[(size_t)id];
      if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) continue;
      const auto &p = polys[(size_t)id];
      bool inside = false;
      for (size_t j = 0, i = p.size() - 1; j < p.size(); i = j++)
        if ((p[j].second > y) != (p[i].second > y) && x < (p[i].first - p[j].first) * (y - p[j].second) / (p[i].second - p[j].second) + p[j].first) inside = !inside;
      if (inside) return true;
    }
    return false;
  }
};
// What ESA WorldCover saw from orbit, 10 m to the pixel (data/env/cover).
struct Cover {
  int nx = 0, ny = 0; double x0 = 0, y0 = 0, cell = 10;
  std::vector<unsigned char> cls;
  bool load(const std::string &path) {
    const Json j = Json::loadOpt(path);
    if (!j.isObj()) return false;
    nx = (int)j["nx"].n(); ny = (int)j["ny"].n(); x0 = j["x0"].n(); y0 = j["y0"].n(); cell = j["cell"].n(10);
    cls.assign((size_t)nx * ny, 0);
    const std::string rle = j["rle"].s();
    size_t k = 0, p = 0;
    while (p < rle.size() && k < cls.size()) {
      char *e = nullptr;
      const long v = std::strtol(rle.c_str() + p, &e, 10);
      p = (size_t)(e - rle.c_str()) + 1;
      const long n = std::strtol(rle.c_str() + p, &e, 10);
      p = (size_t)(e - rle.c_str()) + 1;
      for (long i = 0; i < n && k < cls.size(); i++) cls[k++] = (unsigned char)v;
    }
    return nx > 0 && ny > 0;
  }
  bool tree(double x, double y) const {
    if (cls.empty()) return false;
    const int i = (int)std::floor((x - x0) / cell), j = (int)std::floor((y - y0) / cell);
    return i >= 0 && j >= 0 && i < nx && j < ny && cls[(size_t)j * nx + i] == 10;
  }
};
// What grows, circuit by circuit: data/env/forest.js, copied.
struct ForestSpec { const char *key; bool park; double conifer, depth, density, tall; bool palm, cover; };
const ForestSpec FOREST[] = {
  {"monza", false, 0.12, 90, 1.3, 2.3, false, true},   {"suzuka", false, 0.72, 60, 1.15, 1.7, false, true},
  {"nurburgring", false, 0.92, 70, 1.15, 1.8, false, true}, {"sepang", true, 0.7, 90, 1.2, 1.3, true, true},
  {"spa", false, 0.88, 90, 1.3, 2.1, false, true},      {"heiligen", false, 0.92, 400, 1.2, 2.0, false, false},
  {"zandvoort", false, 0.75, 45, 0.85, 1.0, false, true}, {"monaco", true, 0.4, 30, 0.8, 1.0, false, false},
  {"baku", true, 0.06, 30, 0.8, 1.0, false, false},     {"street", false, 0.45, 140, 1.3, 2.0, false, true},
  {"kate2", false, 0.9, 200, 1.4, 2.4, false, false},   {"_", false, 0.5, 45, 1.0, 1.0, false, false},
};

const char *FLORA_VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aUv;
layout(location=3) in vec3 aCol; layout(location=4) in vec4 aExt;
layout(location=5) in vec4 iPos; layout(location=6) in vec4 iMore;     // instanced trees: xyz scale | yaw shade rnd fadeId
uniform mat4 uVP; uniform vec3 uEye; uniform float uTime; uniform int uInst;
uniform vec3 uFade[9]; uniform vec2 uFar; uniform float uNear;
out vec3 vW, vN, vU, vC; out float vFade;
void main(){
  vec3 p = aPos, n = aNrm, pivot = aPos; float rnd = aExt.z; int id = int(aExt.y + 0.5); float shade = 1.0;
  if (uInst == 1) {
    float c = cos(iMore.x), s = sin(iMore.x);
    vec3 q = aPos * iPos.w;
    // a little wind in the top of the crown
    float sw = aExt.x * sin(uTime * 1.3 + iPos.x * 0.37 + iPos.z * 0.21) * 0.035 * q.y * 0.1;
    q.x += sw; q.z += sw * 0.6;
    p = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + iPos.xyz;
    n = vec3(aNrm.x * c + aNrm.z * s, aNrm.y, -aNrm.x * s + aNrm.z * c);
    pivot = iPos.xyz; rnd = iMore.z; id = int(iMore.w + 0.5); shade = iMore.y;
    if (distance(uEye.xz, pivot.xz) >= uNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }      // too far: its photograph is drawn instead
  } else if (aExt.x > 1.5) {
    // a far tree: two crossed photographs. Its foot is in aNrm; gone when the real tree takes over.
    pivot = vec3(aNrm.x, aPos.y, aNrm.z); n = normalize(vec3(0.25, 0.9, 0.25));
    if (distance(uEye.xz, pivot.xz) < uNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  } else if (aExt.x > 0.5) {
    // a paper tree: one flat cut-out that turns to face you
    vec3 to = uEye - aPos; to.y = 0.0; to = normalize(to);
    p = aPos + vec3(to.z, 0.0, -to.x) * aNrm.x + vec3(0.0, aNrm.y, 0.0);
    n = normalize(to + vec3(0.0, 1.2, 0.0));
  }
  float d = distance(uEye.xz, pivot.xz);
  vec3 F = uFade[id];
  float gone = rnd < F.z ? 0.0 : smoothstep(F.x, F.y, d);
  vFade = (1.0 - gone) * (1.0 - smoothstep(uFar.x, uFar.y, d));
  if (id == 6) vFade *= smoothstep(4.0, 22.0, d);       // you can stand in a wood without the wall going black on you
  vW = p; vN = n; vU = aUv; vC = aCol * shade;
  gl_Position = uVP * vec4(p, 1.0);
}
)";
const char *FLORA_FS = R"(#version 330 core
in vec3 vW, vN, vU, vC; in float vFade;
uniform sampler2DArray uTex; uniform int uBake;
uniform vec3 uEye, uSun, uSunCol, uSkyAmb, uGndAmb, uFog; uniform float uFogK;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  if (vFade < 0.999 && vFade <= hash(gl_FragCoord.xy)) discard;
  vec3 c = vC;
  if (vU.z > -0.5) {
    vec4 t = texture(uTex, vU);
    if (vU.z < 3.5 || vU.z > 4.5) { if (t.a < (vU.z > 4.5 && vU.z < 6.5 ? 0.30 : 0.40)) discard; }      // everything but the bark is a cut-out
    c *= t.rgb;
  }
  vec3 n = normalize(vN);
  float ndl = max(dot(n, uSun), 0.0) * 0.75 + 0.25;                   // wrapped: a wood must not flicker black as the sun crosses it
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 lit = c * (amb + uSunCol * ndl * 0.78);
  if (uBake == 1) { o = vec4(lit, 1.0); return; }
  float f = 1.0 - exp(-distance(uEye, vW) * uFogK);
  o = vec4(mix(lit, uFog, f), 1.0);
}
)";

struct CellMesh {
  std::vector<float> deco, cards;           // 16 floats a vertex
  std::vector<float> inst[2];               // 8 floats a tree, broadleaf then conifer (the small cells only)
  GLuint vao[2] = {0, 0}, vbo[2] = {0, 0}, ivao[2] = {0, 0}, ivbo[2] = {0, 0};
  int n[2] = {0, 0}, ni[2] = {0, 0};
  double cx = 0, cz = 0;
};

}  // namespace

struct Woods {
  GLuint tex = 0, kitVbo[2] = {0, 0};
  int kitN[2] = {0, 0};
  Species sp[2];
  std::map<long long, CellMesh> cells, tcells;      // the wood in 220 m cells; the leaf-by-leaf trees in 56 m ones
  std::vector<CellMesh *> order;                    // the big cells, sorted near to far each frame
  bool ok = false;
  size_t trees = 0, papers = 0;
  // THE MOVABLES (knock.hpp): braking boards and foam blocks. Each keeps its
  // own vertices about its foot; every frame they are put where the car left them.
  struct Mov { int obj = -1; float lift = 0; std::vector<float> v; };
  std::vector<Mov> movs;
  GLuint mvao = 0, mvbo = 0;
  std::vector<float> mbuf;

  static void sv(std::vector<float> &v, const double p[3], double nx, double ny, double nz, double u, double vv, double layer, const float col[3], double mode, int fade, double rnd) {
    const float f[16] = {(float)p[0], (float)p[1], (float)p[2], (float)nx, (float)ny, (float)nz, (float)u, (float)vv, (float)layer, col[0], col[1], col[2], (float)mode, (float)fade, (float)rnd, 0};
    v.insert(v.end(), f, f + 16);
  }
  CellMesh &cell(double x, double z) {
    const long long gx = (long long)std::floor(x / CELL), gz = (long long)std::floor(z / CELL);
    CellMesh &c = cells[gx * 100003LL + gz];
    c.cx = (gx + 0.5) * CELL; c.cz = (gz + 0.5) * CELL;
    return c;
  }
  CellMesh &tcell(double x, double z) {
    const long long gx = (long long)std::floor(x / TCELL), gz = (long long)std::floor(z / TCELL);
    CellMesh &c = tcells[gx * 100003LL + gz];
    c.cx = (gx + 0.5) * TCELL; c.cz = (gz + 0.5) * TCELL;
    return c;
  }
};

static bool loadLayer(const std::string &path, int layer) {
  int w, h;
  std::vector<unsigned char> px;
  if (!readPAM(path, w, h, px) || w != TEX || h != TEX) return false;
  glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, layer, TEX, TEX, 1, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  return true;
}

// The braking boards' faces: the number IS the board, black on white, nothing
// else on it, and a yellow cap on the 50 — the board you brake AT (js/furniture.js).
static const int BOARD_N[6] = {50, 100, 150, 200, 250, 300};
static std::vector<unsigned char> bakeBoards(const std::string &fontPath) {
  std::vector<unsigned char> px((size_t)TEX * TEX * 4, 255);
  for (size_t i = 0; i < px.size(); i += 4) { px[i] = 242; px[i + 1] = 242; px[i + 2] = 238; }
  FT_Library ft = nullptr;
  FT_Face face = nullptr;
  const bool font = !FT_Init_FreeType(&ft) && !FT_New_Face(ft, fontPath.c_str(), 0, &face);
  if (!font) std::fprintf(stderr, "dress: no font at %s — the braking boards will be blank\n", fontPath.c_str());
  const int C = 256;
  for (int k = 0; k < 6; k++) {
    const int x0 = (k % 4) * C, y0 = (k / 4) * C;
    for (int y = 0; y < 24; y++) for (int x = 0; x < C; x++) {
      unsigned char *d = &px[((size_t)(y0 + y) * TEX + x0 + x) * 4];
      if (BOARD_N[k] == 50) { d[0] = 245; d[1] = 197; d[2] = 24; } else { d[0] = 16; d[1] = 16; d[2] = 20; }
    }
    if (!font) continue;
    const std::string txt = std::to_string(BOARD_N[k]);
    int size = 210;
    int width = 0, top = 0;
    for (int pass = 0; pass < 2; pass++) {
      FT_Set_Pixel_Sizes(face, 0, (FT_UInt)size);
      width = 0; top = 0;
      for (char ch : txt) { if (FT_Load_Char(face, (FT_ULong)ch, FT_LOAD_RENDER)) continue; width += (int)(face->glyph->advance.x >> 6); top = std::max(top, (int)face->glyph->bitmap_top); }
      const double fit = std::min(0.90 * C / std::max(1, width), 0.72 * C / std::max(1, top));
      if (pass == 0) size = std::max(20, (int)(size * fit));
    }
    int pen = x0 + (C - width) / 2;
    const int base = y0 + (C + 24) / 2 + top / 2;
    for (char ch : txt) {
      if (FT_Load_Char(face, (FT_ULong)ch, FT_LOAD_RENDER)) continue;
      const FT_GlyphSlot g = face->glyph;
      for (int y = 0; y < (int)g->bitmap.rows; y++) for (int x = 0; x < (int)g->bitmap.width; x++) {
        const int X = pen + g->bitmap_left + x, Y = base - g->bitmap_top + y;
        if (X < x0 || X >= x0 + C || Y < y0 || Y >= y0 + C) continue;
        const int a = g->bitmap.buffer[(size_t)y * g->bitmap.pitch + x];
        unsigned char *d = &px[((size_t)Y * TEX + X) * 4];
        const int ink[3] = {12, 13, 16};
        for (int c = 0; c < 3; c++) d[c] = (unsigned char)((d[c] * (255 - a) + ink[c] * a) / 255);
      }
      pen += (int)(g->advance.x >> 6);
    }
  }
  if (face) FT_Done_Face(face);
  if (ft) FT_Done_FreeType(ft);
  return px;
}

Dress::Dress() = default;
Dress::~Dress() = default;

bool Dress::init(const std::string &data, const std::string &tex) {
  dataDir = data; texDir = tex;
  {
    std::ifstream lf(dataDir + "/livery/livery.glsl");
    std::string glsl((std::istreambuf_iterator<char>(lf)), std::istreambuf_iterator<char>());
    if (glsl.find("vec3 stickers(") == std::string::npos) { std::fprintf(stderr, "dress: no %s/livery/livery.glsl — cars keep the paint they came with\n", dataDir.c_str()); glsl = LIV_STUB; liveryOn = false; }
    const std::string fs = std::string(CAR_FS_A) + glsl + CAR_FS_B;
    carProg = linkD(CAR_VS, fs.c_str());
  }
  if (const char *e = std::getenv("XBR_LIVERY")) { if (std::string(e) == "off") liveryOn = false; else liveryIx = std::atoi(e); }
  floraProg = linkD(FLORA_VS, FLORA_FS);
  return carProg != 0 && floraProg != 0;
}
void Dress::frame(const Mat4 &vp, const float e[3], const Look &l, double t) {
  VP = vp; look = l; time = t;
  for (int k = 0; k < 3; k++) eye[k] = e[k];
}
bool Dress::hasWoods() const { return woods && woods->ok; }

static void staticVao(GLuint &vao, GLuint &vbo, const std::vector<float> &v) {
  glGenVertexArrays(1, &vao); glGenBuffers(1, &vbo);
  glBindVertexArray(vao); glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * 4), v.data(), GL_STATIC_DRAW);
  const GLsizei st = 16 * sizeof(float);
  const int size[5] = {3, 3, 3, 3, 4}, off[5] = {0, 3, 6, 9, 12};
  for (int a = 0; a < 5; a++) { glEnableVertexAttribArray((GLuint)a); glVertexAttribPointer((GLuint)a, size[a], GL_FLOAT, GL_FALSE, st, (void *)(off[a] * sizeof(float))); }
}
// A tree of the kit, drawn once for every entry in an instance buffer.
static void instVao(GLuint &vao, GLuint kitVbo, GLuint instVbo) {
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, kitVbo);
  const GLsizei st = 13 * sizeof(float);
  const int size[5] = {3, 3, 3, 3, 1}, off[5] = {0, 3, 6, 9, 12};
  for (int a = 0; a < 5; a++) { glEnableVertexAttribArray((GLuint)a); glVertexAttribPointer((GLuint)a, size[a], GL_FLOAT, GL_FALSE, st, (void *)(off[a] * sizeof(float))); }
  glBindBuffer(GL_ARRAY_BUFFER, instVbo);
  for (int a = 0; a < 2; a++) {
    glEnableVertexAttribArray((GLuint)(5 + a));
    glVertexAttribPointer((GLuint)(5 + a), 4, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)(a * 4 * sizeof(float)));
    glVertexAttribDivisor((GLuint)(5 + a), 1);
  }
}

void Dress::buildWorld(const Track &t, const World &world, const Json &env, const Line &line) {
  knock().clear();                     // the last circuit's boards and blocks
  woods = std::make_unique<Woods>();
  Woods &W = *woods;
  worldTris = 0;
  if (!floraProg) return;
  const ForestSpec *S = &FOREST[sizeof(FOREST) / sizeof(FOREST[0]) - 1];
  for (const ForestSpec &f : FOREST) if (t.key == f.key) S = &f;

  // ---- the photographs -----------------------------------------------------------
  glGenTextures(1, &W.tex);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D_ARRAY, W.tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage3D(GL_TEXTURE_2D_ARRAY, 0, GL_RGBA8, TEX, TEX, N_LAYER, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  static const char *FILES[5] = {"/flora-leaf.pam", "/flora-needle.pam", "/flora-short.pam", "/flora-tall.pam", "/flora-bark.pam"};
  for (int i = 0; i < 5; i++)
    if (!loadLayer(texDir + FILES[i], i)) { std::fprintf(stderr, "dress: no %s%s (run make) — no woods, no numbered boards\n", texDir.c_str(), FILES[i]); return; }
  { const std::vector<unsigned char> b = bakeBoards(dataDir + "/fonts/anton.woff2"); glTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, L_BOARD, TEX, TEX, 1, GL_RGBA, GL_UNSIGNED_BYTE, b.data()); }

  // ---- the cut-outs, measured (data/flora/atlas.json) --------------------------------
  const Json atlas = Json::loadOpt(dataDir + "/flora/atlas.json");
  auto rects = [&](const char *name) {
    std::vector<Rect> r;
    for (const Json &it : atlas[name]["items"].arr) r.push_back({it["x"].n(), it["y"].n(), it["w"].n(), it["h"].n()});
    return r;
  };
  std::vector<Rect> needle = rects("needle"), leaves = rects("leaf"), leaf;
  // two by two leaves out of the atlas make a cluster card
  std::sort(leaves.begin(), leaves.end(), [](const Rect &a, const Rect &b) { return a.x != b.x ? a.x < b.x : a.y < b.y; });
  for (size_t i = 0; i + 4 <= leaves.size(); i += 2) {
    double x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (size_t k = i; k < i + 4; k++) { x0 = std::min(x0, leaves[k].x); y0 = std::min(y0, leaves[k].y); x1 = std::max(x1, leaves[k].x + leaves[k].w); y1 = std::max(y1, leaves[k].y + leaves[k].h); }
    leaf.push_back({x0, y0, x1 - x0, y1 - y0});
  }
  if (leaf.empty()) leaf = leaves;
  if (needle.empty() || leaf.empty()) { std::fprintf(stderr, "dress: data/flora/atlas.json has no leaves — no woods\n"); return; }

  // ---- the kit: one broadleaf, one fir (or palm), grown to this circuit's trees (js/forest.js makeKit)
  {
    const double tall = S->tall, hB = 9.5 * tall, crown = 3.6 * std::pow(tall, 0.85), lf = 3.6 * std::pow(tall, 0.55);
    const double hC = 15 * std::pow(tall, 0.8), girth = std::pow(tall, 0.4), bark = 0.62 / std::pow(tall, 0.7);
    Kit &b = W.sp[0].mesh, &c = W.sp[1].mesh;
    trunk(b, 0.42 * girth, 0.22 * girth, hB, 6, 0, bark);
    Rnd r(12);
    for (int k = 0; k < 4; k++) { const double len = crown * 0.97 * (0.85 + r() * 0.5), lean = 0.62 + r() * 0.25; trunk(b, 0.17, 0.07, len, 4, lean, bark, k * 1.7 + r() * 0.5, hB * 0.62); }
    broadFoliage(b, leaf, hB, crown, lf, std::min(72, (int)std::lround(30 * std::pow(crown / 3.6, 2) / std::pow(lf / 3.6, 2))), 11);
    if (S->palm) {
      const double hP = 11 * std::pow(tall, 0.8);
      trunk(c, 0.3 * girth, 0.22 * girth, hP, 7, 0.03, bark * 0.9);
      palmFoliage(c, needle, hP, 4.8 * std::pow(tall, 0.5), 20, 5);
    } else {
      trunk(c, 0.34 * girth, 0.1, hC, 6, 0, bark);
      coniferFoliage(c, needle, hC, 3.0 * std::pow(tall, 0.55), (int)std::lround(16 * std::pow(tall, 0.6)), 3);
    }
    const float TINT[2][3] = {{0.573f, 0.627f, 0.459f}, {0.576f, 0.639f, 0.459f}};
    for (int s = 0; s < 2; s++) {
      Species &sp = W.sp[s];
      sp.layer = s ? L_CONE : L_BROAD;
      double half = 0, top = 0;
      for (size_t i = 0; i + 12 < sp.mesh.size(); i += 13) {
        half = std::max({half, (double)std::fabs(sp.mesh[i]), (double)std::fabs(sp.mesh[i + 2])}); top = std::max(top, (double)sp.mesh[i + 1]);
        if ((int)(sp.mesh[i + 8] + 0.5f) != L_BARK) for (int k = 0; k < 3; k++) sp.mesh[i + 9 + k] *= TINT[s][k] * 1.9f;   // the scans are pale; the tint and this bring them to a living green
        else { sp.mesh[i + 9] *= 0.62f; sp.mesh[i + 10] *= 0.50f; sp.mesh[i + 11] *= 0.40f; }
      }
      sp.frame = std::max(top, 2 * half) * 1.04;
      glGenBuffers(1, &W.kitVbo[s]);
      glBindBuffer(GL_ARRAY_BUFFER, W.kitVbo[s]);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(sp.mesh.size() * 4), sp.mesh.data(), GL_STATIC_DRAW);
      W.kitN[s] = (int)(sp.mesh.size() / 13);
    }
  }

  // The leaves have to be readable BEFORE the trees are photographed: a
  // texture with no mip chain reads as opaque black, and so did the first trees.
  glBindTexture(GL_TEXTURE_2D_ARRAY, W.tex);
  glGenerateMipmap(GL_TEXTURE_2D_ARRAY);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  // ---- a photograph of each tree, for the paper rows and for trees too far to draw leaf by leaf
  {
    GLint wasFbo = 0, vp[4], wasProg = 0;
    glGetIntegerv(GL_FRAMEBUFFER_BINDING, &wasFbo); glGetIntegerv(GL_VIEWPORT, vp); glGetIntegerv(GL_CURRENT_PROGRAM, &wasProg);
    // Into a sheet of its own, then copied across: a texture cannot be drawn
    // into while the leaves being drawn are read out of it (it came out black).
    GLuint fbo = 0, rb = 0, ivbo = 0, sheet = 0;
    glGenTextures(1, &sheet); glBindTexture(GL_TEXTURE_2D, sheet);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, TEX, TEX, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glBindTexture(GL_TEXTURE_2D_ARRAY, W.tex);
    glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, sheet, 0);
    glGenRenderbuffers(1, &rb); glBindRenderbuffer(GL_RENDERBUFFER, rb);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, TEX, TEX);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, rb);
    glUseProgram(floraProg);
    glUniform1i(glGetUniformLocation(floraProg, "uTex"), 0);
    glUniform1i(glGetUniformLocation(floraProg, "uInst"), 1);
    glUniform1i(glGetUniformLocation(floraProg, "uBake"), 1);
    glUniform1f(glGetUniformLocation(floraProg, "uTime"), 0);
    float far[N_FADE * 3];
    for (int i = 0; i < N_FADE; i++) { far[i * 3] = 1e9f; far[i * 3 + 1] = 2e9f; far[i * 3 + 2] = 1; }
    glUniform3fv(glGetUniformLocation(floraProg, "uFade"), N_FADE, far);
    glUniform2f(glGetUniformLocation(floraProg, "uFar"), 1e9f, 2e9f);
    glUniform1f(glGetUniformLocation(floraProg, "uNear"), 1e9f);
    // the bake keeps the leaf's own colour and its place in the crown; the sun is added when it is drawn
    glUniform3f(glGetUniformLocation(floraProg, "uSun"), 0, 1, 0);
    glUniform3f(glGetUniformLocation(floraProg, "uSunCol"), 0, 0, 0);
    glUniform3f(glGetUniformLocation(floraProg, "uSkyAmb"), 1, 1, 1);
    glUniform3f(glGetUniformLocation(floraProg, "uGndAmb"), 1, 1, 1);
    const float one[8] = {0, 0, 0, 1, 0.6f, 1, 0, (float)F_NEVER};
    glGenBuffers(1, &ivbo); glBindBuffer(GL_ARRAY_BUFFER, ivbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof one, one, GL_STATIC_DRAW);
    glViewport(0, 0, TEX, TEX);
    glEnable(GL_DEPTH_TEST); glDisable(GL_BLEND); glDisable(GL_CULL_FACE);
    for (int s = 0; s < 2; s++) {
      if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { std::fprintf(stderr, "dress: cannot photograph the trees\n"); break; }
      glClearColor(0.17f, 0.25f, 0.11f, 0);      // the leaves' own green, so a small mip of the edge is not a dark fringe
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
      const float Sf = (float)W.sp[s].frame;
      Mat4 O = Mat4::identity();
      O.m[0] = 2 / Sf; O.m[5] = 2 / Sf; O.m[10] = -1 / Sf; O.m[13] = -0.96f;
      glUniformMatrix4fv(glGetUniformLocation(floraProg, "uVP"), 1, GL_FALSE, O.m);
      glUniform3f(glGetUniformLocation(floraProg, "uEye"), 0, Sf / 2, 1000);
      GLuint vao = 0;
      instVao(vao, W.kitVbo[s], ivbo);
      glDrawArraysInstanced(GL_TRIANGLES, 0, W.kitN[s], 1);
      glDeleteVertexArrays(1, &vao);
      glCopyTexSubImage3D(GL_TEXTURE_2D_ARRAY, 0, 0, 0, s ? L_CONE : L_BROAD, 0, 0, TEX, TEX);
    }
    glBindVertexArray(0);
    glDeleteBuffers(1, &ivbo); glDeleteRenderbuffers(1, &rb); glDeleteFramebuffers(1, &fbo); glDeleteTextures(1, &sheet);
    glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)wasFbo);
    glViewport(vp[0], vp[1], vp[2], vp[3]);
    glUseProgram((GLuint)wasProg);
  }
  glBindTexture(GL_TEXTURE_2D_ARRAY, W.tex);
  glGenerateMipmap(GL_TEXTURE_2D_ARRAY);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_S, GL_REPEAT);
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_T, GL_REPEAT);
  // alpha-tested leaves thin out in the small mips; do not let the far ones use the smallest
  glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAX_LEVEL, 3);
  if (epoxy_has_gl_extension("GL_EXT_texture_filter_anisotropic") || epoxy_gl_version() >= 46)
    glTexParameterf(GL_TEXTURE_2D_ARRAY, 0x84FE, 4.0f);

  // XBR_DUMP=dir writes every layer of the wood's texture there (PAM), to look at what was baked
  if (const char *dump = std::getenv("XBR_DUMP")) {
    std::vector<unsigned char> all((size_t)TEX * TEX * 4 * N_LAYER);
    glGetTexImage(GL_TEXTURE_2D_ARRAY, 0, GL_RGBA, GL_UNSIGNED_BYTE, all.data());
    for (int l = 0; l < N_LAYER; l++) {
      std::ofstream o(std::string(dump) + "/layer" + std::to_string(l) + ".pam", std::ios::binary);
      o << "P7\nWIDTH " << TEX << "\nHEIGHT " << TEX << "\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";
      o.write((const char *)&all[(size_t)l * TEX * TEX * 4], (std::streamsize)TEX * TEX * 4);
    }
  }
  // ---- where the woods are ---------------------------------------------------------------
  PolyIndex wood, built;
  auto poly = [](const Json &pts) { std::vector<std::pair<double, double>> p; for (const Json &q : pts.arr) p.push_back({q[(size_t)0].n(), q[(size_t)1].n()}); return p; };
  for (const Json &a : env["areas"].arr) { const std::string k = a["k"].s(); if (k == "forest" || (S->park && k == "park")) wood.add(poly(a["p"])); }
  for (const Json &b : env["buildings"].arr) built.add(poly(b["p"]));
  Cover cover;
  if (S->cover) cover.load(dataDir + "/env/cover/" + t.key + ".json");
  auto inWood = [&](double x, double y) { return wood.in(x, y) || cover.tree(x, y); };
  // metres to the outer edge of the nearest run-off, any leg of the lap; `g` is how far it can see
  auto slackOn = [&](double g) {
    auto cells = std::make_shared<std::map<long long, std::vector<int>>>();
    for (int i = 0; i < t.n; i++) (*cells)[(long long)std::floor(t.x[(size_t)i] / g) * 100003LL + (long long)std::floor(t.y[(size_t)i] / g)].push_back(i);
    return [cells, g, &t](double x, double y) {
      const long long gx = (long long)std::floor(x / g), gy = (long long)std::floor(y / g);
      double best = 1e300;
      for (long long dx = -1; dx <= 1; dx++) for (long long dy = -1; dy <= 1; dy++) {
        auto it = cells->find((gx + dx) * 100003LL + gy + dy);
        if (it == cells->end()) continue;
        for (int i : it->second) best = std::min(best, std::hypot(t.x[(size_t)i] - x, t.y[(size_t)i] - y) - (t.w[(size_t)i] + std::max(t.runL[(size_t)i], t.runR[(size_t)i])));
      }
      return best;
    };
  };
  const auto slack = slackOn(40), slackFar = slackOn(350);
  auto clear = [&](double x, double y) { return slack(x, y) >= CLEAR && !built.in(x, y); };
  const double lift = std::pow(S->tall, 0.75);
  Rnd rnd(7);
  auto shadeOf = [](double layer) { return std::pow(LAYER_SHADE, layer); };

  auto tree = [&](double x, double y, bool con, double scale, double shade, int fade) {
    const double gy = world.groundY(x, y) - 0.15, yaw = rnd() * 6.2831853, r = rnd();
    CellMesh &c = W.cell(x, -y), &tc = W.tcell(x, -y);
    const float in[8] = {(float)x, (float)gy, (float)-y, (float)scale, (float)yaw, (float)shade, (float)r, (float)fade};
    tc.inst[con ? 1 : 0].insert(tc.inst[con ? 1 : 0].end(), in, in + 8);
    // and the same tree as two crossed photographs of itself, for when it is far away
    const Species &sp = W.sp[con ? 1 : 0];
    const double Sz = sp.frame * scale, y0 = gy - 0.02 * Sz, y1 = gy + 0.98 * Sz;
    const float col[3] = {(float)shade, (float)shade, (float)shade};
    for (int k = 0; k < 2; k++) {
      const double a = yaw + k * 1.5707963, dx = std::cos(a) * Sz / 2, dz = std::sin(a) * Sz / 2;
      const double p[4][3] = {{x - dx, y0, -y - dz}, {x + dx, y0, -y + dz}, {x + dx, y1, -y + dz}, {x - dx, y1, -y - dz}};
      const double uu[4] = {0, 1, 1, 0}, vv[4] = {0, 0, 1, 1};
      for (int i : {0, 1, 2, 0, 2, 3}) Woods::sv(c.cards, p[i], x, 0, -y, uu[i], vv[i], sp.layer, col, 2, fade, r);
    }
    W.trees++;
  };
  auto paper = [&](double x, double y, bool con, double scale, double shade, int fade) {
    const Species &sp = W.sp[con ? 1 : 0];
    const double gy = world.groundY(x, y) - 0.15, Sz = sp.frame * PAPER_TALLER * scale, r = rnd();
    const double p[3] = {x, gy, -y};
    const float col[3] = {(float)shade, (float)shade, (float)shade};
    const double ox[4] = {-Sz / 2, Sz / 2, Sz / 2, -Sz / 2}, oy[4] = {-0.02 * Sz, -0.02 * Sz, 0.98 * Sz, 0.98 * Sz}, uu[4] = {0, 1, 1, 0}, vv[4] = {0, 0, 1, 1};
    CellMesh &c = W.cell(x, -y);
    for (int i : {0, 1, 2, 0, 2, 3}) Woods::sv(c.deco, p, ox[i], oy[i], 0, uu[i], vv[i], sp.layer, col, 1, fade, r);
    W.papers++;
  };

  // ---- the treelines, and the stack planted along each -----------------------------------
  struct Sample { double x, y, nx, ny, d, t0; };
  auto plant = [&](const std::vector<Sample> &L) {
    if (L.size() < 2) return;
    // walk the line at `offset` behind the treeline, calling fn every `spacing` metres
    auto walk = [&](double spacing, double offset, const std::function<void(double, double, double, double, double)> &fn) {
      double pos = spacing * rnd();
      for (size_t k = 0; k + 1 < L.size(); k++) {
        const Sample &A = L[k], &B = L[k + 1];
        const double ax = A.x + A.nx * offset, ay = A.y + A.ny * offset, bx = B.x + B.nx * offset, by = B.y + B.ny * offset;
        const double len = std::hypot(bx - ax, by - ay);
        if (len < 1e-6) continue;
        while (pos < len) {
          const double f = pos / len;
          fn(ax + (bx - ax) * f, ay + (by - ay) * f, A.d + (B.d - A.d) * f, A.nx + (B.nx - A.nx) * f, A.ny + (B.ny - A.ny) * f);
          pos += spacing * (0.75 + 0.5 * rnd());
        }
        pos -= len;
      }
    };
    for (int r = 0; r < 3; r++) {
      const double off = r * ROW_GAP;
      walk(ROW_SPACING[r] / S->density, off, [&](double x, double y, double d, double nx, double ny) {
        if (off > d + 0.5) return;
        x += (rnd() - 0.5) * 1.6; y += (rnd() - 0.5) * 1.6;
        if (!clear(x, y)) return;
        tree(x, y, rnd() < S->conifer, 0.7 + 0.6 * rnd(), shadeOf(r) * (0.9 + 0.1 * rnd()), F_ROW);
      });
    }
    walk(PAPER_SPACING, 3 * ROW_GAP, [&](double x, double y, double d, double nx, double ny) {
      const double pg = std::clamp((d - 3 * ROW_GAP) / 3, PAPER_GAP_MIN, ROW_GAP);
      for (int p = 0; p < 3; p++) {
        const double off = 3 * ROW_GAP + p * pg;
        if (off > d + 0.5) break;
        const double px = x + nx * p * pg + (rnd() - 0.5) * 1.2, py = y + ny * p * pg + (rnd() - 0.5) * 1.2;
        if (!clear(px, py)) continue;
        paper(px, py, rnd() < S->conifer, 0.85 + 0.3 * rnd(), shadeOf(3 + p), F_PAPER1 + p);
      }
    });
    // the two banners and the backdrop: flat sheets that follow the treeline
    double arc = 0;
    for (size_t k = 0; k + 1 < L.size(); k++) {
      const Sample &A = L[k], &B = L[k + 1];
      const double seg = std::hypot(B.x - A.x, B.y - A.y), dmin = std::min(A.d, B.d);
      struct Ban { double off, h; int layer, fade; double shade; };
      const Ban bans[2] = {{1.5 * ROW_GAP, SHORT_H, L_SHORT, F_SHORT, shadeOf(1.5)}, {2.5 * ROW_GAP, TALL_H * lift, L_TALL, F_TALL, shadeOf(2.5)}};
      for (const Ban &b : bans) {
        if (b.off > dmin + 0.5) continue;
        const double ax = A.x + A.nx * b.off, ay = A.y + A.ny * b.off, bx = B.x + B.nx * b.off, by = B.y + B.ny * b.off;
        if (!clear(ax, ay) || !clear(bx, by)) continue;
        const double ga = world.groundY(ax, ay) - 0.1, gb = world.groundY(bx, by) - 0.1, wide = b.h * 4;
        const double p[4][3] = {{ax, ga, -ay}, {bx, gb, -by}, {bx, gb + b.h, -by}, {ax, ga + b.h, -ay}};
        const double uu[4] = {arc / wide, (arc + seg) / wide, (arc + seg) / wide, arc / wide}, vv[4] = {0.99, 0.99, 0.01, 0.01};
        // the strips are photographs in full sun; the wood's own shade and green go over them
        const float col[3] = {(float)(b.shade * 1.25), (float)(b.shade * 1.30), (float)(b.shade * 1.05)};
        CellMesh &c = W.cell((ax + bx) / 2, -(ay + by) / 2);
        for (int i : {0, 1, 2, 0, 2, 3}) Woods::sv(c.deco, p[i], -A.nx * 0.5, 0.86, A.ny * 0.5, uu[i], vv[i], b.layer, col, 0, b.fade, 0);
      }
      if (dmin >= 3 * ROW_GAP + 3 * PAPER_GAP_MIN) {
        const double ax = A.x + A.nx * A.d, ay = A.y + A.ny * A.d, bx = B.x + B.nx * B.d, by = B.y + B.ny * B.d;
        const double ga = world.groundY(ax, ay) - 0.3, gb = world.groundY(bx, by) - 0.3, h = WALL_H * lift;
        const float col[3] = {0.030f, 0.046f, 0.026f};      // "the green bg should be like BLACK and still blend in"
        const double p[4][3] = {{ax, ga, -ay}, {bx, gb, -by}, {bx, gb + h, -by}, {ax, ga + h, -ay}};
        CellMesh &c = W.cell((ax + bx) / 2, -(ay + by) / 2);
        for (int i : {0, 1, 2, 0, 2, 3}) Woods::sv(c.deco, p[i], -A.nx * 0.4, 0.9, A.ny * 0.4, 0, 0, -1, col, 0, F_BACK, 0);
        // and a lid of canopy going back from its top, so nothing shows over the wall
        const double q[4][3] = {{ax, ga + h, -ay}, {bx, gb + h, -by}, {bx + B.nx * 40, gb + h, -(by + B.ny * 40)}, {ax + A.nx * 40, ga + h, -(ay + A.ny * 40)}};
        for (int i : {0, 1, 2, 0, 2, 3}) Woods::sv(c.deco, q[i], 0, 1, 0, 0, 0, -1, col, 0, F_BACK, 0);
      }
      arc += seg;
    }
  };
  const int stepN = std::max(1, (int)std::lround(STEP / t.ds));
  size_t lines = 0, samples = 0;
  for (int side : {1, -1}) {
    std::vector<Sample> cur;
    double prevT = -1e9;
    for (int i = 0; i < t.n; i += stepN) {
      const double h = t.hdg[(size_t)i], nx = -std::sin(h) * side, ny = std::cos(h) * side;
      const double base = t.w[(size_t)i] + (side > 0 ? t.runL[(size_t)i] : t.runR[(size_t)i]) + CLEAR;
      bool found = false;
      double t0 = 0, px = 0, py = 0;
      for (double tt = 0; tt <= SEARCH; tt += MARCH) {
        px = t.x[(size_t)i] + nx * (base + tt); py = t.y[(size_t)i] + ny * (base + tt);
        if (tt > 4 && slack(px, py) < CLEAR) break;          // another leg of the lap is in the way
        if (inWood(px, py) && !built.in(px, py)) { found = true; t0 = tt; break; }
      }
      if (!found || std::fabs(t0 - prevT) > JUMP) { plant(cur); if (cur.size() >= 2) lines++; cur.clear(); }
      if (found) {
        double d = 0, hole = 0;
        bool road = false;
        for (double u = 0; u < S->depth; u += MARCH) {
          const double qx = px + nx * u, qy = py + ny * u;
          if (u > 4 && slack(qx, qy) < CLEAR) { road = true; break; }
          if (inWood(qx, qy)) { d = u; hole = 0; } else { hole += MARCH; if (hole > HOLE) break; }
        }
        if (road) d *= 0.5;                                    // a wood between two roads: each side gets half of it
        cur.push_back({px, py, nx, ny, std::max(4.0, d), t0});
        prevT = t0; samples++;
      } else prevT = -1e9;
    }
    plant(cur);
    if (cur.size() >= 2) lines++;
  }

  // ---- the survey's own single trees (Monza's avenue of planes), standing where they stand
  size_t singles = 0;
  for (const Json &tr : env["trees"].arr) {
    if (singles >= 2100) break;
    const double x = tr[(size_t)0].n(), y = tr[(size_t)1].n();
    if (slack(x, y) < 2.5 || built.in(x, y)) continue;
    tree(x, y, rnd() < S->conifer, 0.75 + 0.5 * rnd(), 0.92, F_ROW);
    singles++;
  }
  // ---- the woods beyond the treelines: paper trees, thinning to nothing with distance
  {
    double x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
    for (int i = 0; i < t.n; i++) { x0 = std::min(x0, t.x[(size_t)i]); x1 = std::max(x1, t.x[(size_t)i]); y0 = std::min(y0, t.y[(size_t)i]); y1 = std::max(y1, t.y[(size_t)i]); }
    const double sp = 13 / std::sqrt(S->density);
    size_t far = 0;
    for (double gx = x0 - REACH; gx < x1 + REACH && far < 14000; gx += sp)
      for (double gy = y0 - REACH; gy < y1 + REACH && far < 14000; gy += sp) {
        const double x = gx + rnd() * sp, y = gy + rnd() * sp;
        if (!inWood(x, y)) continue;
        const double sl = slackFar(x, y);
        if (sl < FAR_CLEAR || sl > REACH || built.in(x, y)) continue;
        paper(x, y, rnd() < S->conifer, 0.8 + 0.5 * rnd(), 0.72 + 0.2 * rnd(), F_FAR);      // a wood seen from afar is its sunlit canopy
        far++;
      }
  }

  // ---- braking boards (js/furniture.js buildBoards): only where the solved lap really brakes
  size_t boards = 0;
  {
    double lastEnd = -1e9;
    const float WHITE[3] = {1, 1, 1}, DARK[3] = {0.16f, 0.18f, 0.20f};
    for (const Corner &c : t.corners) {
      const double vApex = line.v[(size_t)t.idx(c.s)];
      double vMax = vApex;
      for (double s = c.s0 - 380; s < c.s0; s += t.ds) vMax = std::max(vMax, line.v[(size_t)t.idx(s)]);
      if (vMax - vApex < 22) continue;                         // not a braking zone
      const bool boarded = c.s0 - lastEnd < 160;               // the second half of a chicane
      lastEnd = c.s1;
      if (boarded) continue;
      const int side = c.dir < 0 ? -1 : 1;
      static const int LONG[6] = {300, 250, 200, 150, 100, 50}, SHORT[4] = {200, 150, 100, 50};
      const int *marks = vMax > 78 ? LONG : SHORT, nm = vMax > 78 ? 6 : 4;
      for (int m = 0; m < nm; m++) {
        const int d = marks[m], i = t.idx(c.s0 - d);
        const double run = side > 0 ? t.runL[(size_t)i] : t.runR[(size_t)i], w = t.w[(size_t)i];
        const double lat = run > 5 ? side * (w + std::clamp(run * 0.35, 2.6, 5.5)) : side * (w + run) - side * std::min(1.6, run * 0.25);
        const double h = t.hdg[(size_t)i];
        const double sx = t.x[(size_t)i] - std::sin(h) * lat, sy = t.y[(size_t)i] + std::cos(h) * lat;
        const double gy = world.trackY(i) + (world.bank.empty() ? 0 : bankY(world.bank, t, i, lat));
        // square to the oncoming car, toed a little toward the road
        const double lx = -std::sin(h), lz = -std::cos(h), tw = -side * 0.35;
        double ux = lx + std::cos(h) * tw, uz = lz - std::sin(h) * tw;
        const double un = std::hypot(ux, uz);
        ux /= un; uz /= un;
        const double half = 0.75, y0 = 0.62, y1 = 2.12, px = sx, pz = -sy;
        int cellIx = 0;
        for (int k = 0; k < 6; k++) if (BOARD_N[k] == d) cellIx = k;
        const double u0 = (cellIx % 4) * 0.25, u1 = u0 + 0.25, v0 = (cellIx / 4) * 0.25, v1 = v0 + 0.25;
        // which way the car comes from: the face looks back down the track
        const double fx = -std::cos(h), fz = std::sin(h);
        const double p[4][3] = {{px + ux * half, gy + y0, pz + uz * half}, {px - ux * half, gy + y0, pz - uz * half}, {px - ux * half, gy + y1, pz - uz * half}, {px + ux * half, gy + y1, pz + uz * half}};
        const double uu[4] = {u0, u1, u1, u0}, vv[4] = {v1, v1, v0, v0};
        // a board can be hit (knock.hpp): it is a movable, drawn about its own foot
        W.movs.emplace_back();
        Woods::Mov &mv = W.movs.back();
        mv.obj = knock().add(KnockObj::BOARD, sx, sy, gy);
        mv.lift = 0.03f;
        auto rel = [&](const double *q, double out[3]) { out[0] = q[0] - px; out[1] = q[1] - gy; out[2] = q[2] - pz; };
        double r3[3];
        for (int q : {0, 1, 2, 0, 2, 3}) { rel(p[q], r3); Woods::sv(mv.v, r3, fx * 0.6, 0.8, fz * 0.6, uu[q], vv[q], L_BOARD, WHITE, 0, F_NEVER, 0); }
        // a plain back, a hand's breadth behind, so the number is not read backwards from the far side
        for (int q : {0, 1, 2, 0, 2, 3}) { const double b[3] = {p[q][0] - fx * 0.03, p[q][1], p[q][2] - fz * 0.03}; rel(b, r3); Woods::sv(mv.v, r3, -fx * 0.6, 0.8, -fz * 0.6, 0, 0, -1, DARK, 0, F_NEVER, 0); }
        for (double e : {0.5, -0.5}) {
          const double bx = px + ux * e, bz = pz + uz * e;
          const double l[4][3] = {{bx - ux * 0.045, gy, bz - uz * 0.045}, {bx + ux * 0.045, gy, bz + uz * 0.045}, {bx + ux * 0.045, gy + y0, bz + uz * 0.045}, {bx - ux * 0.045, gy + y0, bz - uz * 0.045}};
          for (int q : {0, 1, 2, 0, 2, 3}) { rel(l[q], r3); Woods::sv(mv.v, r3, fx * 0.6, 0.8, fz * 0.6, 0, 0, -1, DARK, 0, F_NEVER, 0); }
        }
        boards++;
      }
    }
  }

  // ---- foam blocks (data/knock/<track>.json): the polystyrene you thread through on an escape road.
  // HAND-PLACED, each row given from an anchor on the lap: `s` metres round, then
  // `ahead` metres straight on along the road's heading THERE, and `across` metres to the left.
  size_t foam = 0;
  {
    const Json kd = Json::loadOpt(dataDir + "/knock/" + t.key + ".json");
    for (const Json &grp : kd["foam"].arr) {
      const int i = t.idx(grp["s"].n());
      const double h = grp.has("hdg") ? grp["hdg"].n() * PI / 180 : t.hdg[(size_t)i], ch = std::cos(h), sh = std::sin(h);
      for (const Json &row : grp["rows"].arr) for (const Json &ac : row["across"].arr) {
        const double ahead = row["ahead"].n(), across = ac.n();
        const double sx = t.x[(size_t)i] + ch * ahead - sh * across, sy = t.y[(size_t)i] + sh * ahead + ch * across;
        const double gy = world.heightAt(sx, sy);
        W.movs.emplace_back();
        Woods::Mov &mv = W.movs.back();
        mv.obj = knock().add(KnockObj::FOAM, sx, sy, gy);
        mv.lift = 0.25f;
        const bool hay = row["hay"].truthy();
        if (hay) knock().objs[(size_t)mv.obj].mass = 20;       // a straw bale is the heavier thing to hit
        // a block 1.9 m across the escape road, 0.5 m thick, 1.0 m high; white, with a band of colour
        const double ax = -sh, az = -ch;              // GL: across (to the left)
        const double fx2 = ch, fz2 = -sh;             // GL: along the heading
        const float WHITE2[3] = {0.93f, 0.93f, 0.91f};
        const float BAND[2][3] = {{0.80f, 0.10f, 0.10f}, {0.10f, 0.25f, 0.70f}};
        const float STRAW[3] = {0.78f, 0.66f, 0.34f}, STRAW2[3] = {0.66f, 0.54f, 0.26f};
        const float *band = hay ? STRAW2 : BAND[foam & 1];
        auto face = [&](const double a[3], const double b[3], const double c[3], const double d[3], double nx, double ny, double nz, const float *col) {
          const double *q[6] = {a, b, c, a, c, d};
          for (const double *v : q) Woods::sv(mv.v, v, nx, ny, nz, 0, 0, -1, col, 0, F_NEVER, 0);
        };
        auto pt = [&](double acr, double alo, double y, double out[3]) { out[0] = ax * acr + fx2 * alo; out[1] = y; out[2] = az * acr + fz2 * alo; };
        const double HW = 0.95, HT = 0.25;
        for (int part = 0; part < 2; part++) {
          const double ya = part == 0 ? 0.0 : 0.62, yb = part == 0 ? 0.62 : 1.0;
          const float *col = part == 0 ? (hay ? STRAW : WHITE2) : band;
          double c8[8][3];
          int k = 0;
          for (double y : {ya, yb}) for (double alo : {-HT, HT}) for (double acr : {-HW, HW}) pt(acr, alo, y, c8[k++]);
          // c8: y a/b, alo -/+, acr -/+  ->  index = yi*4 + ai*2 + ci
          face(c8[0], c8[1], c8[5], c8[4], -fx2 * 0.7, 0.7, -fz2 * 0.7, col);     // the face you drive at
          face(c8[3], c8[2], c8[6], c8[7], fx2 * 0.7, 0.7, fz2 * 0.7, col);       // the far face
          face(c8[2], c8[0], c8[4], c8[6], -ax * 0.7, 0.7, -az * 0.7, col);       // one end
          face(c8[1], c8[3], c8[7], c8[5], ax * 0.7, 0.7, az * 0.7, col);         // the other
          if (part == 1) face(c8[4], c8[5], c8[7], c8[6], 0, 1, 0, col);          // the top
        }
        foam++;
      }
    }
    if (foam) std::fprintf(stderr, "woods: %s — %zu foam blocks on the escape road\n", t.key.c_str(), foam);
  }
  if (!W.movs.empty()) {
    glGenVertexArrays(1, &W.mvao); glGenBuffers(1, &W.mvbo);
    glBindVertexArray(W.mvao); glBindBuffer(GL_ARRAY_BUFFER, W.mvbo);
    const GLsizei st = 16 * sizeof(float);
    const int size[5] = {3, 3, 3, 3, 4}, off[5] = {0, 3, 6, 9, 12};
    for (int q = 0; q < 5; q++) { glEnableVertexAttribArray((GLuint)q); glVertexAttribPointer((GLuint)q, size[q], GL_FLOAT, GL_FALSE, st, (void *)(off[q] * sizeof(float))); }
    glBindVertexArray(0);
  }

  // ---- to the card -------------------------------------------------------------------------------
  for (auto &kv2 : W.cells) {
    CellMesh &c = kv2.second;
    const std::vector<float> *src[2] = {&c.deco, &c.cards};
    for (int k = 0; k < 2; k++) if (!src[k]->empty()) { staticVao(c.vao[k], c.vbo[k], *src[k]); c.n[k] = (int)(src[k]->size() / 16); worldTris += (size_t)c.n[k] / 3; }
    c.deco.clear(); c.deco.shrink_to_fit(); c.cards.clear(); c.cards.shrink_to_fit();
    W.order.push_back(&c);
  }
  for (auto &kv2 : W.tcells) {
    CellMesh &c = kv2.second;
    for (int s = 0; s < 2; s++) if (!c.inst[s].empty()) {
      glGenBuffers(1, &c.ivbo[s]); glBindBuffer(GL_ARRAY_BUFFER, c.ivbo[s]);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(c.inst[s].size() * 4), c.inst[s].data(), GL_STATIC_DRAW);
      instVao(c.ivao[s], W.kitVbo[s], c.ivbo[s]);
      c.ni[s] = (int)(c.inst[s].size() / 8);
    }
    for (auto &v : c.inst) { v.clear(); v.shrink_to_fit(); }
  }
  glBindVertexArray(0);
  W.ok = true;
  std::fprintf(stderr, "woods: %s — %zu treelines (%zu samples), %zu real trees (%zu the survey's own), %zu paper trees, %zu braking boards, %zu cells; a tree is %d + %d triangles\n",
               S->key, lines, samples, W.trees, singles, W.papers, boards, W.cells.size(), W.kitN[0] / 3, W.kitN[1] / 3);
}

void Dress::drawWorld() { drawWoods(false); }
// The trees as the sun sees them, for a shadow map: every tree as its two
// photographs, and nothing else — no leaf-by-leaf trees, banners or boards.
void Dress::drawShadow() { drawWoods(true); }

void Dress::drawWoods(bool shadow) {
  if (!woods || !woods->ok) return;
  Woods &W = *woods;
  GLint was = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &was);
  glUseProgram(floraProg);
  lights(floraProg);
  glUniform1i(glGetUniformLocation(floraProg, "uTex"), 0);
  glUniform1i(glGetUniformLocation(floraProg, "uBake"), 0);
  glUniform1f(glGetUniformLocation(floraProg, "uTime"), (float)time);
  glUniform3fv(glGetUniformLocation(floraProg, "uFade"), N_FADE, &FADE[0][0]);
  glUniform2f(glGetUniformLocation(floraProg, "uFar"), FAR0, FAR1);
  glUniform1f(glGetUniformLocation(floraProg, "uNear"), shadow ? 0.0f : (float)NEAR_TREES);
  const GLint uInst = glGetUniformLocation(floraProg, "uInst");
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D_ARRAY, W.tex);
  // near to far, so what is in front hides what is behind before it is shaded
  const float ex = eye[0], ez = eye[2];
  std::sort(W.order.begin(), W.order.end(), [ex, ez](const CellMesh *a, const CellMesh *b) {
    return (a->cx - ex) * (a->cx - ex) + (a->cz - ez) * (a->cz - ez) < (b->cx - ex) * (b->cx - ex) + (b->cz - ez) * (b->cz - ez); });
  const double R = CELL * 0.71, TR = TCELL * 0.71;
  auto unseen = [&](const CellMesh &c, double rad) {
    // behind the camera, or well off to one side of what it sees
    const float cw = VP.m[3] * (float)c.cx + VP.m[7] * eye[1] + VP.m[11] * (float)c.cz + VP.m[15];
    const float cxp = VP.m[0] * (float)c.cx + VP.m[4] * eye[1] + VP.m[8] * (float)c.cz + VP.m[12];
    return cw < -rad || std::fabs(cxp) > std::fabs(cw) + rad * 2.2;
  };
  glUniform1i(uInst, 1);
  if (!shadow) for (auto &kv2 : W.tcells) {
    const CellMesh &c = kv2.second;
    if (std::hypot(c.cx - eye[0], c.cz - eye[2]) - TR > NEAR_TREES || unseen(c, TR)) continue;
    for (int s = 0; s < 2; s++) if (c.ni[s]) { glBindVertexArray(c.ivao[s]); glDrawArraysInstanced(GL_TRIANGLES, 0, W.kitN[s], c.ni[s]); }
  }
  glUniform1i(uInst, 0);
  for (const CellMesh *cp : W.order) {
    const CellMesh &c = *cp;
    const double d = std::hypot(c.cx - eye[0], c.cz - eye[2]) - R;
    if (d > (shadow ? 320.0 : (double)FAR1)) break;                 // sorted: everything after is further still
    if (!shadow && unseen(c, R)) continue;
    if (!shadow && c.n[0]) { glBindVertexArray(c.vao[0]); glDrawArrays(GL_TRIANGLES, 0, c.n[0]); }
    if (c.n[1]) { glBindVertexArray(c.vao[1]); glDrawArrays(GL_TRIANGLES, 0, c.n[1]); }
  }
  // ---- the movables, where the cars have left them (knock.hpp)
  if (!shadow && !W.movs.empty()) {
    W.mbuf.clear();
    const Knock &K = knock();
    for (const Woods::Mov &mv : W.movs) {
      if (mv.obj < 0 || (size_t)mv.obj >= K.objs.size()) continue;
      const KnockObj &o = K.objs[(size_t)mv.obj];
      const float cy = std::cos((float)o.yaw), sy = std::sin((float)o.yaw), ct = std::cos((float)o.tip), stn = std::sin((float)o.tip);
      // tips about the level axis that takes "up" to the way it fell (GL: x, up, -y)
      const float fxg = (float)o.fallX, fzg = (float)-o.fallY, axx = fzg, axz = -fxg;
      const float bx = (float)o.x, by = (float)o.z + std::fabs(stn) * mv.lift, bz = (float)-o.y;
      auto turn = [&](const float *in, float *out) {
        // about the vertical first
        const float x = in[0] * cy + in[2] * sy, y = in[1], z = -in[0] * sy + in[2] * cy;
        // then over: v cos + (a x v) sin + a (a.v)(1 - cos), a = (axx, 0, axz)
        const float dot = axx * x + axz * z;
        const float cxv = -axz * y, cyv = axz * x - axx * z, czv = axx * y;
        out[0] = x * ct + cxv * stn + axx * dot * (1 - ct);
        out[1] = y * ct + cyv * stn;
        out[2] = z * ct + czv * stn + axz * dot * (1 - ct);
      };
      for (size_t i = 0; i + 16 <= mv.v.size(); i += 16) {
        float f[16];
        std::memcpy(f, &mv.v[i], sizeof f);
        float p[3], nn[3];
        turn(&mv.v[i], p); turn(&mv.v[i + 3], nn);
        f[0] = p[0] + bx; f[1] = p[1] + by; f[2] = p[2] + bz;
        f[3] = nn[0]; f[4] = o.state == KnockObj::STANDING ? nn[1] : std::max(0.35f, std::fabs(nn[1])); f[5] = nn[2];
        W.mbuf.insert(W.mbuf.end(), f, f + 16);
      }
    }
    if (!W.mbuf.empty()) {
      const GLboolean cull = glIsEnabled(GL_CULL_FACE);
      glDisable(GL_CULL_FACE);                       // a tumbling board shows both its sides
      glBindVertexArray(W.mvao);
      glBindBuffer(GL_ARRAY_BUFFER, W.mvbo);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(W.mbuf.size() * 4), W.mbuf.data(), GL_STREAM_DRAW);
      glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(W.mbuf.size() / 16));
      if (cull) glEnable(GL_CULL_FACE);
    }
  }
  glBindVertexArray(0);
  glUseProgram((GLuint)was);
}

}  // namespace xbr
